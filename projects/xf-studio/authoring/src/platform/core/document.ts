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
import { canonicalJson, COLLECTION_1, COLLECTION_2, type Look, type LookCollection, type LookMemory, type PartEnvelope,
  type PartMemory } from "../api/document";
import type { AnyFeatureModule } from "../api/feature";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEATURE_KEY = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120;
export const COLLECTION_MESSAGE = "Expected a named XF Studio collection with a stable UUID and at least one preset.";
export const PRESET_MESSAGE = "Preset identities must be unique UUIDs with a name and positive revision.";
/** Undo entries kept per look and feature; more on restore means older ones were dropped. */
export const HISTORY_LIMIT = 80;

/** A collection-1 preset as older builds stored it. */
export type LegacyPreset = { id: string; name: string; revision: number; [field: string]: unknown };
export type LegacyCollection = { schema: typeof COLLECTION_1; id: string; name: string; presets: LegacyPreset[] };
/** Stored per-feature memory: the editor, the part schema of its history entries and those entries. */
export type StoredPartMemory = { editor?: unknown; partSchema?: string; history?: unknown[]; historyTrimmed?: true };

export class PartRegistry {
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
    if (!module.part.accepts.includes(envelope.schema))
      throw Error(`This look's ${module.label.toLowerCase()} was saved by a newer version of XF Studio (${envelope.schema}).`);
    const part = module.part.serialize(module.part.parse(envelope));
    if (checkSize && JSON.stringify(part.body).length > module.part.maxBytes)
      throw Error(`This look's ${module.label.toLowerCase()} exceeds the ${Math.round(module.part.maxBytes / 1e6)} MB limit for one part.`);
    return part;
  }
  /** The parsed value of a registered feature's part, or undefined when the look does not have one. */
  part<P>(look: Pick<Look, "parts">, feature: string): P | undefined {
    const module = this.byId.get(feature), envelope = look.parts[feature];
    return module && envelope ? module.part.parse(envelope) as P : undefined;
  }
  /** Wrap a registered feature's parsed part (no copy). */
  envelope(feature: string, part: unknown): PartEnvelope {
    const module = this.byId.get(feature);
    if (!module) throw Error(`Feature ${feature} is not registered.`);
    return module.part.serialize(part);
  }
  /** Canonical text of a look's parts: equal for equal content, whatever key order or older schema. */
  canonicalParts(parts: Readonly<Record<string, PartEnvelope>>): string {
    return canonicalJson(Object.fromEntries(Object.keys(parts).sort().map(feature => [feature, this.readPart(feature, parts[feature])])));
  }
  /** Primitive facts of one look for views; a feature the look lacks contributes nothing. */
  summary(look: Pick<Look, "parts">, feature: string): Readonly<Record<string, number | string | boolean>> | undefined {
    const module = this.byId.get(feature), envelope = look.parts[feature];
    return module && envelope ? module.part.summary(envelope.body) : undefined;
  }

  /** One stored preset of either collection schema, as a look. */
  readPreset(value: unknown, schema: string): Look {
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
  /** Read a stored collection of either schema. Identity is independent of names, revisions and order. */
  readCollection(value: unknown, allowEmpty = false): LookCollection {
    const input = value as { schema?: unknown; id?: string; name?: unknown; presets?: unknown[] };
    if (!input || (input.schema !== COLLECTION_1 && input.schema !== COLLECTION_2) || !UUID.test(input.id ?? "") ||
        !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
      throw Error(COLLECTION_MESSAGE);
    const seen = new Set<string>();
    const presets = input.presets.map(preset => {
      const look = this.readPreset(preset, input.schema as string);
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
    if (!owner || !legacy || features.length !== 1 || features[0] !== owner.id) return undefined;
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
  minimalPart(feature: string, envelope: PartEnvelope): PartEnvelope {
    const module = this.byId.get(feature);
    if (!module) return structuredClone(envelope);
    const part = this.parsedPart(module, envelope);
    for (const schema of module.part.accepts) {
      if (schema === module.part.current) break;
      const older = module.part.downgrade?.(part, schema);
      if (older) return structuredClone(older);
    }
    return structuredClone(module.part.serialize(part));
  }
  /**
   * The parsed value of an in-memory part: a look's registered parts are already parsed at their
   * current schema (`readPart`), so writers use the body as it is (no second parse, which could
   * reorder keys); any other schema is parsed.
   */
  private parsedPart(module: AnyFeatureModule, envelope: PartEnvelope): unknown {
    return envelope.schema === module.part.current ? envelope.body : module.part.parse(envelope);
  }
  /** A look with each part in the oldest part schema that holds it. */
  private minimalLook(look: Look): Look {
    return { id: look.id, name: look.name, revision: look.revision,
      parts: Object.fromEntries(Object.entries(look.parts).map(([feature, part]) => [feature, this.minimalPart(feature, part)])) };
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
        parts: Object.fromEntries(Object.entries(look.parts).map(([feature, part]) => [feature, this.readPart(feature, part)])) })) };
  }

  /** Per-feature memory of one look, as stored in `xfs/workspace-2`; damaged history entries are skipped. */
  readMemory(value: unknown, look: Pick<Look, "parts"> | undefined): LookMemory {
    const memory: LookMemory = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return memory;
    for (const [feature, stored] of Object.entries(value as Record<string, StoredPartMemory>)) {
      if (!FEATURE_KEY.test(feature) || !stored || typeof stored !== "object") continue;
      const module = this.byId.get(feature);
      // A newer build's feature memory is kept verbatim, like its parts.
      if (!module) { memory[feature] = structuredClone(stored) as PartMemory; continue; }
      memory[feature] = this.readFeatureMemory(feature, stored.editor, stored.partSchema ?? module.part.current,
        stored.history, stored.historyTrimmed === true, look);
    }
    return memory;
  }
  /**
   * One registered feature's memory: its editor state parsed against the look's part (or the
   * empty part when the look lacks it) and history entries read as parts of `partSchema`.
   * At most `HISTORY_LIMIT` entries are kept; dropping older ones sets `historyTrimmed`.
   */
  readFeatureMemory(feature: string, editor: unknown, partSchema: string, history: unknown, trimmed: boolean,
    look: Pick<Look, "parts"> | undefined): PartMemory {
    const module = this.byId.get(feature)!;
    const part = (look && this.part(look, feature)) ?? module.part.empty();
    const entries: unknown[] = [];
    if (Array.isArray(history)) for (const body of history.slice(-HISTORY_LIMIT)) {
      try { entries.push(module.part.parse({ schema: partSchema, body })); } catch { /* One damaged Undo entry must not lose the draft. */ }
    }
    return { editor: module.editor.parse(editor, part), history: entries,
      ...(trimmed || (Array.isArray(history) && history.length > HISTORY_LIMIT) ? { historyTrimmed: true as const } : {}) };
  }
  /** The stored form of one look's memory. */
  writeMemory(memory: LookMemory): Record<string, StoredPartMemory> {
    return Object.fromEntries(Object.entries(memory).map(([feature, entry]) => {
      const module = this.byId.get(feature);
      if (!module) return [feature, structuredClone(entry)];
      return [feature, { editor: module.editor.serialize(entry.editor), partSchema: module.part.current,
        history: entry.history.map(part => module.part.serialize(part).body), ...(entry.historyTrimmed ? { historyTrimmed: true } : {}) }];
    }));
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
