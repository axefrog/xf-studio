/**
 * The platform's document codec (feature-module platform §2): reads `xfas/collection-1` and
 * `xfs/collection-2` collections and per-look editor memory through the registered features'
 * part and editor codecs, and writes them back. DOM-free; imports only the platform API.
 *
 * - Reading never changes appearance: a registered part is parsed by its codec, a part of an
 *   unregistered feature is kept verbatim, and a collection-1 preset's legacy field becomes the
 *   claiming feature's part.
 * - Comparison is canonical: two looks are equal when their parts serialize to the same
 *   canonical JSON after parsing, whatever key order or older schema they were stored in.
 * - Writing is minimal where it matters for older builds: `writeMinimal` produces
 *   `xfas/collection-1` whenever every look holds exactly the legacy feature's part in a form
 *   that schema holds exactly, and `xfs/collection-2` otherwise.
 */
import { canonicalJson, COLLECTION_1, COLLECTION_2, isNewerData, KEPT_MEMORY, LOOK_MEMORY, NEWER_LOOK_MESSAGE, NewerDataError, type Look,
  type LookCollection, type LookMemory, type PartEnvelope, type PartMemory } from "../api/document";
import type { AnyFeatureModule } from "../api/feature";
import { HISTORY_LIMIT, LOOK_HISTORY_1, type HistoryParts, type LookHistoryData, type StoredLookEntry } from "../api/history";
import { emptyLookHistory, isEmptyLookHistory, LookHistory, lookHistoryBodies, pruneLookHistory } from "./look-history";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEATURE_KEY = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120;
export const COLLECTION_MESSAGE = "Expected a named XF Studio collection with a stable UUID and at least one preset.";
export const PRESET_MESSAGE = "Preset identities must be unique UUIDs with a name and positive revision.";

/** A collection-1 preset as older builds stored it. */
export type LegacyPreset = { id: string; name: string; revision: number; [field: string]: unknown };
export type LegacyCollection = { schema: typeof COLLECTION_1; id: string; name: string; presets: LegacyPreset[] };
/** Stored per-feature memory: the editor, the part schema of its history entries and those entries. */
export type StoredPartMemory = { editor?: unknown; partSchema?: string; history?: unknown[]; historyTrimmed?: true };
/**
 * What a reader does with data from a newer build (`NewerDataError`): `refuse` throws it, so the
 * store holding it is protected; `omit` leaves the newer entries out of a read-only view (the
 * caller must then never write that view back over the store); `keep` keeps a look holding it
 * verbatim and locked (`Look.locked`), so the rest stays editable and writers put it back unchanged
 * (collection drafts and collection files; step 5).
 */
export type NewerPolicy = "refuse" | "omit" | "keep";

export class PartRegistry implements HistoryParts {
  private readonly byId = new Map<string, AnyFeatureModule>();
  private readonly legacyOwner?: AnyFeatureModule;
  constructor(features: readonly AnyFeatureModule[]) {
    let legacy: AnyFeatureModule | undefined;
    for (const feature of features) {
      if (this.byId.has(feature.id)) throw Error(`Feature ${feature.id} registers its part twice.`);
      if (!feature.part.accepts.includes(feature.part.current)) throw Error(`Feature ${feature.id} must accept its current part schema.`);
      this.byId.set(feature.id, feature);
      if (feature.part.legacy) {
        if (legacy) throw Error(`Features ${legacy.id} and ${feature.id} both claim the collection-1 preset field.`);
        if (!feature.part.accepts.includes(feature.part.legacy.schema)) throw Error(`Feature ${feature.id} must accept its legacy part schema.`);
        legacy = feature;
      }
    }
    this.legacyOwner = legacy;
  }
  features(): readonly string[] { return [...this.byId.keys()]; }
  /**
   * The look history's chunks of a parsed part (its codec's `chunks`, else the whole body as one chunk).
   * A feature this build does not register is one chunk too.
   */
  chunks(feature: string, body: unknown): readonly unknown[] {
    const chunks = this.byId.get(feature)?.part.chunks;
    return chunks ? chunks(body) : [body];
  }
  /** The parsed part body the look history's chunks hold (the inverse of `chunks`, key order included). */
  join(feature: string, chunks: readonly unknown[]): unknown {
    const join = this.byId.get(feature)?.part.join;
    return join ? join(chunks) : chunks[0];
  }
  feature(id: string): AnyFeatureModule | undefined { return this.byId.get(id); }
  /** The feature whose data `xfas/collection-1` presets and `xfas/workspace-1` editors hold. */
  legacyFeature(): string | undefined { return this.legacyOwner?.id; }

  /**
   * A registered part, parsed and written at its current schema; an unregistered one verbatim.
   * `checkSize` refuses a part over its codec's `maxBytes` (on reads of stored or imported data).
   */
  readPart(feature: string, value: unknown, checkSize = true): PartEnvelope {
    const envelope = value as PartEnvelope;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || typeof envelope.schema !== "string" ||
        !envelope.schema || envelope.schema.length > 128 || !("body" in envelope))
      throw Error(`The ${feature} part of a look is damaged.`);
    const module = this.byId.get(feature);
    if (!module) return structuredClone({ schema: envelope.schema, body: envelope.body });
    if (!module.part.accepts.includes(envelope.schema)) throw this.newer(module, envelope.schema);
    const part = module.part.serialize(module.part.parse(envelope));
    if (checkSize && JSON.stringify(part.body).length > module.part.maxBytes)
      throw Error(`This look's ${module.label.toLowerCase()} exceeds the ${Math.round(module.part.maxBytes / 1e6)} MB limit for one part.`);
    return part;
  }
  private newer(module: AnyFeatureModule, schema: string) {
    return new NewerDataError(`This look's ${module.label.toLowerCase()} was saved by a newer version of XF Studio (${schema}).`);
  }
  /**
   * The parsed value of a registered feature's part, or undefined when the look does not have one.
   * A look's in-memory parts are already parsed at their feature's current schema (`readPart`), so
   * those bodies are returned as they are (no copy); a part in another schema is parsed.
   */
  part<P>(look: Pick<Look, "parts" | "locked">, feature: string): P | undefined {
    const module = this.byId.get(feature), envelope = look.parts[feature];
    // A locked look's parts are kept as stored: this build cannot read them.
    return module && envelope && !look.locked ? this.parsedPart(module, envelope) as P : undefined;
  }
  /** Wrap a registered feature's parsed part (no copy). */
  envelope(feature: string, part: unknown): PartEnvelope {
    const module = this.byId.get(feature);
    if (!module) throw Error(`Feature ${feature} is not registered.`);
    return module.part.serialize(part);
  }
  /**
   * Canonical text of a look's parts: equal for equal content, whatever key order or older schema.
   * A registered part at its current schema is an in-memory (parsed) body and is not parsed again
   * (CORE-35); any other schema is read first.
   */
  canonicalParts(parts: Readonly<Record<string, PartEnvelope>>): string {
    return canonicalJson(Object.fromEntries(Object.keys(parts).sort().map(feature => {
      const module = this.byId.get(feature), envelope = parts[feature];
      if (module && envelope?.schema === module.part.current) return [feature, envelope];
      // A part this build cannot read (a locked look's) cannot change here: its stored text is its content.
      try { return [feature, this.readPart(feature, envelope)]; }
      catch (error) { if (!isNewerData(error)) throw error; return [feature, envelope]; }
    })));
  }
  /** Primitive facts of one look for views; a feature the look lacks contributes nothing. */
  summary(look: Pick<Look, "parts" | "locked">, feature: string): Readonly<Record<string, number | string | boolean>> | undefined {
    const module = this.byId.get(feature), envelope = look.parts[feature];
    return module && envelope && !look.locked ? module.part.summary(envelope.body) : undefined;
  }

  /**
   * One stored preset of either collection schema, as a look. With `newer` `keep`, a look holding a newer
   * build's data is kept verbatim and locked (`keepLook`) instead of refused.
   */
  readPreset(value: unknown, schema: string, newer: NewerPolicy = "refuse"): Look {
    try { return this.readPresetParts(value, schema); }
    catch (error) {
      if (newer !== "keep" || !isNewerData(error)) throw error;
      return this.keepLook(value, schema);
    }
  }
  /**
   * A stored preset this build cannot read, kept exactly as stored and locked: its identity is checked,
   * its parts are copied verbatim (a collection-1 preset's legacy field becomes the claiming feature's
   * part in its legacy schema, as that field has always been read).
   */
  keepLook(value: unknown, schema: string): Look {
    const input = value as LegacyPreset & { parts?: unknown };
    if (!input || typeof input !== "object" || !UUID.test(input.id ?? "") || !title(input.name) ||
        !Number.isSafeInteger(input.revision) || input.revision < 1) throw Error(PRESET_MESSAGE);
    const parts: Record<string, PartEnvelope> = {};
    if (schema === COLLECTION_1) {
      const owner = this.legacyOwner, legacy = owner?.part.legacy;
      if (!owner || !legacy) throw Error("This version of XF Studio cannot read xfas/collection-1 collections.");
      parts[owner.id] = { schema: legacy.schema, body: structuredClone(input[legacy.presetField]) };
    } else {
      const stored = input.parts;
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw Error(`Preset ${input.name} has no parts.`);
      for (const [feature, envelope] of Object.entries(stored as Record<string, PartEnvelope>)) {
        if (!FEATURE_KEY.test(feature) || feature.length > 64 || !envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
            typeof envelope.schema !== "string" || !envelope.schema || envelope.schema.length > 128 || !("body" in envelope))
          throw Error(`The ${feature} part of a look is damaged.`);
        parts[feature] = { schema: envelope.schema, body: structuredClone(envelope.body) };
      }
    }
    return { id: input.id, name: input.name, revision: input.revision, parts, locked: NEWER_LOOK_MESSAGE };
  }
  private readPresetParts(value: unknown, schema: string): Look {
    const input = value as LegacyPreset & { parts?: unknown };
    if (!input || typeof input !== "object" || !UUID.test(input.id ?? "") || !title(input.name) ||
        !Number.isSafeInteger(input.revision) || input.revision < 1) throw Error(PRESET_MESSAGE);
    const parts: Record<string, PartEnvelope> = {};
    if (schema === COLLECTION_1) {
      const legacy = this.legacyOwner?.part.legacy;
      if (!legacy || !this.legacyOwner) throw Error("This version of XF Studio cannot read xfas/collection-1 collections.");
      parts[this.legacyOwner.id] = this.readPart(this.legacyOwner.id, { schema: legacy.schema, body: input[legacy.presetField] });
    } else {
      const stored = input.parts;
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw Error(`Preset ${input.name} has no parts.`);
      for (const [feature, envelope] of Object.entries(stored)) {
        if (!FEATURE_KEY.test(feature) || feature.length > 64) throw Error(`Preset ${input.name} has an invalid feature ID.`);
        parts[feature] = this.readPart(feature, envelope);
      }
    }
    return { id: input.id, name: input.name, revision: input.revision, parts };
  }
  /**
   * Read a stored collection of either schema. Identity is independent of names, revisions and order.
   * `newer` `keep` keeps looks holding a newer build's data verbatim and locked; by default they are refused.
   * A `locked` key in the input is never trusted (CORE-45): stored data and imported files never carry
   * it, so a look is locked only when reading its parts meets a newer build's data. In-memory drafts are
   * validated again with `rereadCollection`.
   */
  readCollection(value: unknown, allowEmpty = false, newer: NewerPolicy = "refuse"): LookCollection {
    return this.readLooks(value, allowEmpty, newer, false);
  }
  /**
   * Validate an in-memory collection again (after a rename or a preset edit): as `readCollection` with
   * `keep`, except that a look this session already locked stays locked, read from its kept parts (a look
   * can be locked by newer data in its Undo history while its parts read). Never for stored or imported data.
   */
  rereadCollection(collection: LookCollection, allowEmpty = true): LookCollection {
    return this.readLooks(collection, allowEmpty, "keep", true);
  }
  private readLooks(value: unknown, allowEmpty: boolean, newer: NewerPolicy, trusted: boolean): LookCollection {
    const input = value as { schema?: unknown; id?: string; name?: unknown; presets?: unknown[] };
    if (!input || (input.schema !== COLLECTION_1 && input.schema !== COLLECTION_2) || !UUID.test(input.id ?? "") ||
        !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
      throw Error(COLLECTION_MESSAGE);
    const seen = new Set<string>();
    const presets = input.presets.map(preset => {
      // Only an in-memory look this session locked is read again from its kept parts.
      const look = trusted && (preset as Look | undefined)?.locked
        ? this.keepLook(preset, input.schema as string) : this.readPreset(preset, input.schema as string, newer);
      if (seen.has(look.id)) throw Error(PRESET_MESSAGE);
      seen.add(look.id);
      return look;
    });
    return { schema: COLLECTION_2, id: input.id!, name: input.name as string, presets };
  }
  /**
   * Only the identity of a stored collection (for lists): its ID, name and preset count, without
   * parsing any part, so a collection holding parts from a newer build still lists.
   */
  readIdentity(value: unknown): { id: string; name: string; count: number } {
    const input = value as { schema?: unknown; id?: string; name?: unknown; presets?: unknown[] };
    if (!input || (input.schema !== COLLECTION_1 && input.schema !== COLLECTION_2) || !UUID.test(input.id ?? "") ||
        !title(input.name) || !Array.isArray(input.presets)) throw Error(COLLECTION_MESSAGE);
    return { id: input.id!, name: input.name as string, count: input.presets.length };
  }

  /** The collection-1 form of one look, when that format holds it exactly; otherwise undefined. */
  legacyPreset(look: Look): LegacyPreset | undefined {
    const owner = this.legacyOwner, legacy = owner?.part.legacy;
    const features = Object.keys(look.parts);
    // A locked look is written in the look form, where a build that cannot read it refuses it cleanly.
    if (!owner || !legacy || look.locked || features.length !== 1 || features[0] !== owner.id) return undefined;
    const envelope = look.parts[owner.id];
    const body = envelope.schema === legacy.schema ? envelope.body
      : owner.part.downgrade?.(this.parsedPart(owner, envelope), legacy.schema)?.body;
    return body === undefined ? undefined
      : { id: look.id, name: look.name, revision: look.revision, [legacy.presetField]: structuredClone(body) };
  }
  /**
   * A part in the oldest schema its codec accepts that holds it exactly (`accepts` lists them
   * oldest first; `downgrade` decides), else its current schema. Unregistered parts stay verbatim.
   */
  minimalPart(feature: string, envelope: PartEnvelope, copy = true): PartEnvelope {
    const module = this.byId.get(feature);
    const clone = <T>(value: T) => copy ? structuredClone(value) : value;
    if (!module) return clone(envelope);
    const part = this.parsedPart(module, envelope);
    for (const schema of module.part.accepts) {
      if (schema === module.part.current) break;
      const older = module.part.downgrade?.(part, schema);
      if (older) return clone(older);
    }
    return clone(module.part.serialize(part));
  }
  /**
   * The parsed value of an in-memory part: a look's registered parts are already parsed at their
   * current schema (`readPart`), so writers use the body as it is (no second parse, which could
   * reorder keys); any other schema is parsed.
   */
  private parsedPart(module: AnyFeatureModule, envelope: PartEnvelope): unknown {
    return envelope.schema === module.part.current ? envelope.body : module.part.parse(envelope);
  }
  /**
   * A look with each part in the oldest part schema that holds it. With `copy` false the result
   * shares structure with `look` (for a writer that serializes it at once, like the workspace).
   */
  minimalLook(look: Look, copy = true): Look {
    // A locked look's parts are written exactly as they were read.
    if (look.locked) return { id: look.id, name: look.name, revision: look.revision, parts: copy ? structuredClone(look.parts) : look.parts };
    return { id: look.id, name: look.name, revision: look.revision,
      parts: Object.fromEntries(Object.entries(look.parts).map(([feature, part]) => [feature, this.minimalPart(feature, part, copy)])) };
  }
  /** The stored form of one look: collection-1 preset fields when they hold it exactly, else its minimal parts. */
  writePresetMinimal(look: Look): LegacyPreset | Look { return this.legacyPreset(look) ?? this.minimalLook(look); }
  /**
   * The oldest collection schema that holds this collection exactly: `xfas/collection-1` (readable
   * by 0.1.0-alpha.1) when every look is legacy-representable, else `xfs/collection-2` with each
   * part in the oldest part schema that holds it.
   */
  writeMinimal(collection: LookCollection): LegacyCollection | LookCollection {
    const presets = collection.presets.map(look => this.legacyPreset(look));
    return presets.every((preset): preset is LegacyPreset => preset !== undefined)
      ? { schema: COLLECTION_1, id: collection.id, name: collection.name, presets }
      : { schema: COLLECTION_2, id: collection.id, name: collection.name,
        presets: collection.presets.map(look => this.minimalLook(look)) };
  }
  /** The collection-2 stored form (a validated copy). */
  write(collection: LookCollection): LookCollection {
    return { schema: COLLECTION_2, id: collection.id, name: collection.name,
      presets: collection.presets.map(look => ({ id: look.id, name: look.name, revision: look.revision,
        parts: look.locked ? structuredClone(look.parts)
          : Object.fromEntries(Object.entries(look.parts).map(([feature, part]) => [feature, this.readPart(feature, part)])) })) };
  }

  /**
   * A look's Undo history from its memory (`LOOK_MEMORY`). A memory built by hand in the older in-memory
   * form (registered features' whole-part `history`) is read as that; none is an empty history.
   */
  lookHistory(memory: LookMemory | undefined): LookHistoryData {
    const own = memory?.[LOOK_MEMORY]?.editor as LookHistoryData | undefined;
    if (own) return own;
    const legacy = Object.entries(memory ?? {}).filter(([feature, entry]) => this.byId.has(feature) && Array.isArray(entry.history));
    const data = this.fromBodies(legacy.filter(([, entry]) => entry.history!.length).map(([feature, entry]) => [feature, entry.history!]));
    return legacy.some(([, entry]) => entry.historyTrimmed === true) ? { ...data, trimmed: true } : data;
  }
  /**
   * `memory` with its Undo history set (absent when empty and untrimmed). Registered features' older
   * whole-part histories are dropped from it, since the look history now holds them.
   */
  withLookHistory(memory: LookMemory, history: LookHistoryData): LookMemory {
    const result: LookMemory = {};
    for (const [feature, entry] of Object.entries(memory)) {
      if (feature === LOOK_MEMORY) continue;
      if (this.byId.has(feature) && (entry.history || entry.historyTrimmed)) {
        const { history: _history, historyTrimmed: _trimmed, ...rest } = entry;
        result[feature] = rest;
      } else result[feature] = entry;
    }
    if (!isEmptyLookHistory(history)) result[LOOK_MEMORY] = { editor: history };
    return result;
  }
  /**
   * The editor memory of one look, as stored in `xfs/workspace-2`, in memory form: each feature's editor
   * state by feature, and the look's one Undo history (`LOOK_MEMORY`). The history is read from either
   * stored form (see `writeMemory`); damaged steps are skipped. Steps from a newer build are never
   * skipped as damage: see `NewerPolicy` (omitted ones are reported as trimmed history).
   */
  readMemory(value: unknown, look: Pick<Look, "parts" | "locked"> | undefined, newer: NewerPolicy = "refuse"): LookMemory {
    const memory: LookMemory = {};
    // A locked look's memory is kept exactly as stored (`KEPT_MEMORY`); nothing in it is read.
    if (look?.locked) return { [KEPT_MEMORY]: { editor: structuredClone(value) } };
    if (!value || typeof value !== "object" || Array.isArray(value)) return memory;
    const bodies: [string, unknown[]][] = [];
    let trimmed = false, lookLevel = false;
    for (const [feature, stored] of Object.entries(value as Record<string, StoredPartMemory>)) {
      if (!FEATURE_KEY.test(feature) || !stored || typeof stored !== "object") continue;
      const module = this.byId.get(feature);
      // A newer build's feature memory is kept verbatim, like its parts.
      if (!module) { memory[feature] = structuredClone(stored) as PartMemory; continue; }
      memory[feature] = { editor: module.editor.parse(stored.editor, (look && this.part(look, feature)) ?? module.part.empty()) };
      if (stored.historyTrimmed === true) trimmed = true;
      if (stored.partSchema === LOOK_HISTORY_1) { lookLevel = true; continue; }
      const read = this.readSteps(module, stored.partSchema ?? module.part.current, stored.history, newer);
      if (read.trimmed) trimmed = true;
      if (read.bodies.length) bodies.push([feature, read.bodies]);
    }
    // The look-level form: stored (its features name `xfs/look-history-1`) or in memory (a copy of a draft).
    const own = (value as Record<string, { editor?: unknown } | undefined>)[LOOK_MEMORY];
    const history = own && typeof own === "object" ? this.readLookLevel(own.editor, newer)
      : lookLevel ? { ...emptyLookHistory(), trimmed: true as const } : this.fromBodies(bodies);
    if (trimmed && !history.trimmed) history.trimmed = true;
    return this.withLookHistory(memory, history);
  }
  /**
   * One registered feature's memory from its editor state and its Undo history as whole parts of
   * `partSchema` (how `xfas/workspace-1` stored an editor), as a look's memory.
   */
  readFeatureMemory(feature: string, editor: unknown, partSchema: string, history: unknown, trimmed: boolean,
    look: Pick<Look, "parts"> | undefined, newer: NewerPolicy = "refuse"): LookMemory {
    const module = this.byId.get(feature)!;
    const read = this.readSteps(module, partSchema, history, newer);
    const data = this.fromBodies(read.bodies.length ? [[feature, read.bodies]] : []);
    if (trimmed || read.trimmed) data.trimmed = true;
    return this.withLookHistory({ [feature]: { editor: module.editor.parse(editor, (look && this.part(look, feature)) ?? module.part.empty()) } }, data);
  }
  /**
   * Whole-part Undo entries of `partSchema`, oldest first: at most `HISTORY_LIMIT` are kept (dropping
   * older ones reports `trimmed`), a damaged one is skipped, and one from a newer build (a schema this
   * build does not accept, or a newer model inside it) follows `newer`.
   */
  private readSteps(module: AnyFeatureModule, partSchema: string, history: unknown, newer: NewerPolicy): { bodies: unknown[]; trimmed: boolean } {
    if (!Array.isArray(history) || !history.length) return { bodies: [], trimmed: false };
    if (!module.part.accepts.includes(partSchema)) {
      if (newer !== "omit") throw this.newer(module, partSchema);
      return { bodies: [], trimmed: true };
    }
    const bodies: unknown[] = [];
    let omitted = false;
    for (const body of history.slice(-HISTORY_LIMIT)) {
      try { bodies.push(module.part.parse({ schema: partSchema, body })); }
      catch (error) {
        if (!isNewerData(error)) continue; // One damaged Undo entry must not lose the draft.
        if (newer !== "omit") throw error;
        omitted = true;
      }
    }
    return omitted ? { bodies: [], trimmed: true } : { bodies, trimmed: history.length > HISTORY_LIMIT };
  }
  /** A look history from whole-part entries by feature (older workspaces kept one feature's). */
  private fromBodies(bodies: readonly [string, unknown[]][]): LookHistoryData {
    if (!bodies.length) return emptyLookHistory();
    // No build wrote whole-part histories for several features of one look; they are kept in feature order.
    return LookHistory.fromSteps(this, bodies.flatMap(([feature, list]) => list.map(body => ({ feature, body })))).data();
  }
  /**
   * A stored look-level history (`xfs/look-history-1`): each step's parts are rebuilt and parsed by
   * their codec, so a damaged step is skipped like a damaged whole-part entry. A step that touches a
   * part this build cannot edit (an unregistered feature's, or a newer model) is newer data.
   */
  private readLookLevel(value: unknown, newer: NewerPolicy): LookHistoryData {
    const input = value as LookHistoryData | undefined;
    if (!input || input.schema !== LOOK_HISTORY_1 || !Array.isArray(input.entries) || !input.chunks || typeof input.chunks !== "object")
      return emptyLookHistory();
    // A step naming a chunk the data lacks is damaged: it is skipped, the others stay.
    const whole = (entry: StoredLookEntry) => !!entry && typeof entry === "object" && !!entry.before && typeof entry.before === "object" &&
      Object.values(entry.before).every(ids => ids === null || Array.isArray(ids) && ids.every(id => typeof id === "string" && Object.hasOwn(input.chunks, id)));
    let history: LookHistory;
    try { history = LookHistory.fromData(this, { ...input, entries: input.entries.filter(whole) }); }
    catch { return emptyLookHistory(); }
    const data = history.data(), kept: StoredLookEntry[] = [];
    let omitted = false;
    for (const [index, entry] of data.entries.entries()) {
      try {
        for (const [feature, ids] of Object.entries(entry.before)) {
          const module = this.byId.get(feature);
          if (!module) throw new NewerDataError(`This look's Undo history changes a part this version of XF Studio does not know (${feature}).`);
          if (ids) module.part.parse({ schema: module.part.current, body: this.join(feature, ids.map(id => data.chunks[id])) });
        }
        kept.push(data.entries[index]);
      } catch (error) {
        if (!isNewerData(error)) continue;
        if (newer !== "omit") throw error;
        omitted = true;
      }
    }
    if (omitted) return { ...emptyLookHistory(), trimmed: true };
    return pruneLookHistory({ ...data, entries: kept });
  }
  /**
   * The stored form of one look's memory. The look history is written in the oldest form that holds
   * it: while every step is a part step of one registered feature (all this build makes), as that
   * feature's whole parts in the oldest part schema that holds every entry (`partSchema`, `history`),
   * which every build since workspace-2 reads; otherwise as `xfs/look-history-1` under `LOOK_MEMORY`,
   * with each registered feature's memory naming that schema so an older build opens the workspace
   * read-only instead of losing the history. `lookLevel` asks for the look-level form for any history
   * with steps: the storage budget uses it when whole parts do not fit (CORE-39), since a step of one
   * layer then costs one layer chunk instead of the whole part.
   */
  writeMemory(memory: LookMemory, options: { lookLevel?: boolean } = {}): Record<string, StoredPartMemory> {
    // A locked look's memory goes back exactly as it was read.
    // (A look stored without memory has none to write: `undefined` leaves its key out of the stored JSON.)
    if (memory[KEPT_MEMORY]) return structuredClone(memory[KEPT_MEMORY].editor) as Record<string, StoredPartMemory>;
    const history = this.lookHistory(memory), stored: Record<string, StoredPartMemory> = {};
    const bodies = options.lookLevel && history.entries.length ? undefined : lookHistoryBodies(history, this);
    // Whole parts hold the history only for a registered feature (no reader accepts steps of any other).
    const single = bodies && (bodies.feature === undefined || this.byId.has(bodies.feature)) ? bodies : undefined;
    const registered = Object.keys(memory).filter(feature => feature !== LOOK_MEMORY && this.byId.has(feature));
    for (const [feature, entry] of Object.entries(memory)) {
      if (feature === LOOK_MEMORY) continue;
      const module = this.byId.get(feature);
      if (!module) { stored[feature] = structuredClone(entry); continue; }
      const trimmedHere = history.trimmed && (!single?.bodies.length || single.feature === feature);
      if (single) {
        const { schema, bodies } = this.minimalHistory(module, single.feature === feature ? single.bodies : []);
        stored[feature] = { editor: module.editor.serialize(entry.editor), partSchema: schema, history: bodies,
          ...(trimmedHere ? { historyTrimmed: true } : {}) };
      } else stored[feature] = { editor: module.editor.serialize(entry.editor), partSchema: LOOK_HISTORY_1, history: [LOOK_MEMORY],
        ...(history.trimmed ? { historyTrimmed: true } : {}) };
    }
    if (single?.feature !== undefined && single.bodies.length && !registered.includes(single.feature)) {
      // The steps' feature has no editor memory in this look: give it its default one to carry them.
      const module = this.byId.get(single.feature)!;
      const { schema, bodies } = this.minimalHistory(module, single.bodies);
      stored[single.feature] = { editor: module.editor.serialize(module.editor.empty()), partSchema: schema, history: bodies,
        ...(history.trimmed ? { historyTrimmed: true } : {}) };
    }
    if (!single) {
      for (const feature of new Set(history.entries.flatMap(entry => Object.keys(entry.before))))
        if (this.byId.has(feature) && !stored[feature]) stored[feature] = { editor: this.byId.get(feature)!.editor.serialize(
          this.byId.get(feature)!.editor.empty()), partSchema: LOOK_HISTORY_1, history: [LOOK_MEMORY] };
      stored[LOOK_MEMORY] = { editor: history };
    }
    return stored;
  }
  /** The oldest part schema every entry downgrades to exactly (`accepts` is oldest first), with the bodies in it. */
  private minimalHistory(module: AnyFeatureModule, history: readonly unknown[]): { schema: string; bodies: unknown[] } {
    for (const schema of module.part.accepts) {
      if (schema === module.part.current) break;
      const bodies: unknown[] = [];
      for (const part of history) {
        const older = module.part.downgrade?.(part, schema);
        if (!older) break;
        bodies.push(older.body);
      }
      if (bodies.length === history.length) return { schema, bodies };
    }
    return { schema: module.part.current, bodies: history.map(part => module.part.serialize(part).body) };
  }
  /** Feature-wide memory by feature, as stored; unregistered features' entries are kept verbatim. */
  readFeatureWide(value: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [feature, stored] of Object.entries(value)) {
      if (!FEATURE_KEY.test(feature)) continue;
      const module = this.byId.get(feature);
      result[feature] = module ? module.memory?.parse(stored) : structuredClone(stored);
      if (result[feature] === undefined) delete result[feature];
    }
    return result;
  }
  writeFeatureWide(memory: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(memory).map(([feature, value]) => {
      const module = this.byId.get(feature);
      return [feature, module?.memory ? module.memory.serialize(value) : structuredClone(value)];
    }));
  }
}
