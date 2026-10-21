/**
 * The character owner (profiles design §1.1, §7): every character's document and the decoded saves they come from, and one
 * `CharacterContext` (`CharacterContextActions`) per `CharacterId`, made when a scene first shows the character. There is no current
 * character: every read and command names the character it is about, and the revision it read (`base`).
 *
 * - **The outbox is the one write path** (`platform/core/document-outbox.ts`, §2.2). A character as this window sees it is its library
 *   value with this window's outbox entries on top (`outbox.document`); nothing here keeps a queue or a copy of its own.
 * - **Commands** are recorded in the outbox at once and reach the library in the background: `character.create` (the decoded save, the
 *   character and, when asked, its profile membership: one command), `character.setSource` (replacing `savedV.*`), `character.rename`,
 *   `character.delete` (a tombstone, after naming the profiles that list it), and `character.update`, what a context changed.
 * - **A context mirrors into the outbox.** Every change a context makes, its source included, is recorded as the character's next value
 *   in the same turn (`mirror`); a decoded save's ID is hashed synchronously for it. The context therefore always shows exactly what the
 *   document holds here. A source change asked of the service while a scene shows the character goes through that context, as one step
 *   of its Undo, and is mirrored like any other change.
 * - **Changes from elsewhere** (a revision check, or a resolved conflict that took the other window's version) replace what the context
 *   shows, and its Undo starts there (`CharacterContextActions.replace`).
 * - **Bases.** `revision` (what commands name as their `base`) moves with every command recorded here and every change taken from
 *   elsewhere; a context's own edits don't move it.
 * - **Shared and per character.** Every context shares the page's creator catalogue (creator-catalogue.ts) and is its own requester
 *   (`<id>`, its panel instances `<id>/<instance>`); its Undo history is the history service's `character:<id>` scope.
 */
import type { CharactersPort, CharacterSummary } from "../platform/api/characters";
import { characterRef } from "../platform/api/characters";
import { refusal, type Capability } from "../platform/api/capability";
import { type DocumentRef, isTombstone, tombstoneOf } from "../platform/api/document-commands";
import type { DocumentStorePort } from "../platform/api/document-store";
import type { DocumentOutbox, OutboxEdit } from "../platform/core/document-outbox";
import type { HistoryService } from "../platform/core/history-service";
import { parseSavedV, type SavedV } from "../saves/save-reader";
import type { BodyGender } from "./cc-catalogue";
import { parseCcPreset, serializeCcPreset } from "./cc-preset";
import { CharacterContextActions, type CharacterContextPorts, type CharacterDocumentPort, presetLoad } from "./character-context-actions";
import { type CharacterSourceChange, savedDescriptorsOf } from "./character-context";
import { closeCharacterHistory } from "./character-history";
import { CHARACTER_DOCUMENT, CHARACTER_SCHEMA, type CharacterDocument, type CharacterSource, characterDocumentOf, type CharacterId, characterLabel, decodedSaveId,
  documentOfForm, newCharacterId, SAVED_V_DOCUMENT, type SaveReference, storedOfDocument } from "./character-document";
import type { CreatorCatalogue } from "./creator-catalogue";
import { PROFILE_DOCUMENT, profileDocumentOf, type ProfileId, type ProfileService, type ProfileView } from "../app/profiles/profile-service";
import { sameSubject } from "../platform/api/subjects";

/** What a scene gives the character it shows: applying a save on its head, its V's preparation, its choice previews. */
export type CharacterScenePorts = Pick<CharacterContextPorts, "showSave" | "details" | "previews">;
export type CharacterServiceDeps = {
  /** The library's documents, read once at `load`. */
  readonly documents: Pick<DocumentStorePort, "list">;
  /** Every change goes through the outbox. */
  readonly outbox: DocumentOutbox;
  /** The page's one creator catalogue, shared by every character. */
  readonly catalogue: CreatorCatalogue;
  /** The session's history service: each character's steps are its `character:<id>` scope. */
  readonly history: HistoryService;
  /** For `character.create` with a profile membership, and Keep both. */
  readonly profiles?: ProfileService;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly report?: (error: unknown) => void;
};
export type CharacterAnswer = { ok: true; character: CharacterId; revision: number } | { ok: false; code: Capability["code"]; reason: string };
/** `character.setSource` as the service takes it: the character, the revision read, the new source and, for a save, where it is. */
export type SetSourceCommand = { kind: "character.setSource"; character: CharacterId; base: number; source: CharacterSourceChange; save?: SaveReference };

type Entry = {
  readonly id: CharacterId;
  /** What commands name as their base (see the header). */
  revision: number;
  context: CharacterContextActions | null;
  unsubscribe: (() => void) | null;
  /** Why the last change of this character couldn't be recorded here (the window no longer holds its workspace), until the next one is. */
  failure: string | null;
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const failed = (capability: Capability): CharacterAnswer => ({ ok: false, code: capability.code, reason: capability.reason ?? "That can't be done." });
const docRef = (id: CharacterId): DocumentRef => ({ kind: CHARACTER_DOCUMENT, id });
const saveRef = (id: string): DocumentRef => ({ kind: SAVED_V_DOCUMENT, id });
const ELSEWHERE_NOTE = "Changed in another window. Undo starts here.";
const CONFLICT_MESSAGE = "You changed this V here too. Which version should it keep?";
const RESTORING = "This V is still being restored from your last session. It can be changed again in a moment.";
const SAVE_MISSING = "This V's save isn't on this computer. Import the same save again to keep working on this V.";
const RESTORED_NOTE = "Restored from your last session. Undo starts here.";

export class CharacterService implements CharactersPort {
  private readonly entries = new Map<CharacterId, Entry>();
  /** Decoded saves by content ID, parsed once (they never change). */
  private readonly parsed = new Map<string, SavedV>();
  private readonly saveIds = new WeakMap<SavedV, string>();
  private readonly listeners = new Set<() => void>();
  private summaries: readonly CharacterSummary[] | null = null;

  constructor(private readonly deps: CharacterServiceDeps) {
    deps.outbox.subscribe(event => {
      if (event.kind === "status") { if (this.entries.size) this.changed(); return; }
      // A decoded save arriving here (put by any V, read from the library, kept with a restored command): every context of a V that
      // comes from it and couldn't show it yet shows it now, before it takes another change.
      const saves = (event.kind === "acknowledged" || event.kind === "conflict" ? event.entry.writes : event.refs).filter(ref => ref.kind === SAVED_V_DOCUMENT);
      for (const ref of saves) this.saveArrived(ref.id);
      // Another owner's command (a profile's) or this service's own: what a character reads as may have changed.
      if (event.kind === "recorded") { if (event.refs.some(ref => ref.kind === CHARACTER_DOCUMENT)) { this.summaries = null; } return; }
      if (event.kind === "external") { for (const ref of event.refs) if (ref.kind === CHARACTER_DOCUMENT) this.fromElsewhere(ref.id); }
      else if (event.kind === "resolved") {
        for (const ref of event.refs) if (ref.kind === CHARACTER_DOCUMENT) {
          this.entryOf(ref.id);
          if (event.how !== "mine" && event.entry.writes.some(write => write.kind === CHARACTER_DOCUMENT && write.id === ref.id)) this.fromElsewhere(ref.id);
        }
      } else for (const write of event.entry.writes) if (write.kind === CHARACTER_DOCUMENT) this.entryOf(write.id);
      // A conflict that came or went shows in the Character panel of each V it touches.
      if (event.kind === "conflict" || event.kind === "resolved")
        for (const write of event.entry.writes) if (write.kind === CHARACTER_DOCUMENT) this.entries.get(write.id)?.context?.documentChanged();
      this.changed();
    });
  }

  /** Read every character and decoded save from the library. */
  async load(signal?: AbortSignal): Promise<void> {
    const [characters, saves] = await Promise.all([this.deps.documents.list(CHARACTER_DOCUMENT, signal), this.deps.documents.list(SAVED_V_DOCUMENT, signal)]);
    for (const save of saves) this.deps.outbox.hold(saveRef(save.id), { revision: save.revision, value: save.value });
    // A V shown before its save was here shows it now (whether or not the outbox announced the save's arrival).
    for (const save of saves) this.saveArrived(save.id);
    for (const document of characters) {
      this.deps.outbox.hold(docRef(document.id), { revision: document.revision, value: document.value });
      this.entryOf(document.id);
    }
    this.changed();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.summaries = null; for (const listener of [...this.listeners]) listener(); }
  private entryOf(id: CharacterId): Entry {
    let entry = this.entries.get(id);
    if (!entry) this.entries.set(id, entry = { id, revision: this.deps.outbox.document(docRef(id))?.revision ?? 0, context: null, unsubscribe: null, failure: null });
    return entry;
  }

  list(): readonly CharacterSummary[] {
    this.summaries ??= Object.freeze([...this.entries.values()].flatMap(entry => {
      const doc = this.doc(entry.id), held = this.deps.outbox.document(docRef(entry.id));
      if (!doc || !held) return [];
      const status = this.deps.outbox.status();
      return [Object.freeze({ id: entry.id, label: characterLabel(doc), body: doc.body, origin: doc.source.kind, revision: entry.revision,
        conflict: !!held.conflict, unsaved: (held.pending && status.failing) || entry.failure !== null })];
    }));
    return this.summaries;
  }
  character(id: CharacterId): CharacterSummary | null { return this.list().find(summary => summary.id === id) ?? null; }
  /** A character's document as this window holds it (a copy), or null (none, or deleted). */
  document(id: CharacterId): CharacterDocument | null { const doc = this.doc(id); return doc ? structuredClone(doc) : null; }
  private doc(id: CharacterId): CharacterDocument | null {
    const value = this.deps.outbox.document(docRef(id))?.value;
    return value === undefined || isTombstone(value) ? null : characterDocumentOf(value);
  }
  /** A decoded save by its content ID (shared, never changed), or null. */
  decoded(id: string): SavedV | null {
    let save = this.parsed.get(id);
    if (!save) {
      const value = this.deps.outbox.document(saveRef(id))?.value;
      if (value === undefined || isTombstone(value)) return null;
      try { save = parseSavedV(value); } catch { return null; }
      this.parsed.set(id, save);
    }
    return save;
  }
  private live(id: CharacterId, base?: number): Entry | Capability {
    const entry = this.entries.get(id);
    if (!entry || !this.doc(id)) return refusal("missing_target", "That V doesn't exist any more.");
    if (base !== undefined && base !== entry.revision) return refusal("stale", "That V changed since it was read.");
    return entry;
  }
  private saveId(save: SavedV): string {
    let id = this.saveIds.get(save);
    if (!id) this.saveIds.set(save, id = decodedSaveId(save));
    return id;
  }
  /**
   * A decoded save, written once by its own command (an immutable, content-addressed document: an equal copy written elsewhere is
   * acknowledged, never a conflict, and no resolution removes it). Commands naming it wait until it is in the library (`record`).
   */
  private putSave(id: string | null, save: SavedV | null) {
    if (!id || !save) return;
    this.parsed.set(id, save);
    this.deps.outbox.put(saveRef(id), save);
  }
  /** The decoded saves a command's character values come from: it is sent only once each is in the library. */
  private requires(edits: readonly OutboxEdit[]): DocumentRef[] {
    return edits.flatMap(edit => {
      if (edit.kind !== CHARACTER_DOCUMENT || isTombstone(edit.value)) return [];
      const source = (edit.value as CharacterDocument | undefined)?.source;
      return source?.kind === "save" ? [saveRef(source.decoded)] : [];
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Contexts

  /** The character's one context, made the first time a scene shows it (`ports`: that scene's). */
  context(id: CharacterId, ports: CharacterScenePorts): CharacterContextActions {
    const entry = this.live(id);
    if (!("id" in entry)) throw Error(entry.reason);
    if (entry.context) return entry.context;
    const doc = this.doc(id)!, save = doc.source.kind === "save" ? this.decoded(doc.source.decoded) ?? undefined : undefined;
    const document: CharacterDocumentPort = {
      conflict: () => {
        const conflict = this.deps.outbox.document(docRef(id))?.conflict;
        return conflict ? { message: CONFLICT_MESSAGE, keepBoth: conflict.writes.some(write => write.kind === CHARACTER_DOCUMENT && write.id === id) } : null;
      },
      resolve: keep => this.resolve(id, keep),
      restoring: () => this.blocked(id),
      namesSave: value => this.namesSave(id, value),
      importSave: value => this.importSave(id, value),
    };
    const context = new CharacterContextActions({ ...ports, catalogue: this.deps.catalogue, requester: id, history: { service: this.deps.history, id }, document },
      { stored: storedOfDocument(doc), ...(save ? { save } : {}) });
    entry.context = context;
    entry.unsubscribe = context.subscribe(() => this.mirror(entry));
    return context;
  }
  /**
   * No scene shows the character any more: its context goes (its history stays for the session), once the library holds its changes.
   * False (and the context stays) when they couldn't be sent yet: the outbox keeps them and sends them again.
   */
  async release(id: CharacterId): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry?.context) return true;
    if (!await this.deps.outbox.settle([docRef(id)])) return false;
    this.drop(entry);
    return true;
  }
  /**
   * The scene showing the character let it go at once (its head is made again, for another body): its context goes now. Nothing is lost:
   * every change a context makes is in the outbox the same turn, and the character's history stays (`character:<id>`), so the next
   * context (`context`) shows the document as it is and moves through the same steps.
   */
  detach(id: CharacterId, context: CharacterContextActions): void {
    const entry = this.entries.get(id);
    if (entry?.context === context) this.drop(entry);
  }
  private drop(entry: Entry) {
    entry.unsubscribe?.();
    entry.context?.dispose();
    entry.context = null; entry.unsubscribe = null;
  }
  /** Resolves once the library holds every change of the character (or of every one), or a send failed meanwhile. */
  async flush(id?: CharacterId): Promise<void> { await this.settle(id); }
  /**
   * True once the library holds every change of the character (or of every one, without `id`); false when one couldn't be sent (it is
   * sent again shortly) or is in conflict.
   */
  async settle(id?: CharacterId): Promise<boolean> {
    const refs = (id ? [id] : [...this.entries.keys()]).map(docRef);
    return await this.deps.outbox.settle(refs) && refs.every(ref => !this.deps.outbox.document(ref)?.conflict);
  }

  /** A context changed: its state becomes the character's next value here, in the same turn (nothing changes when it is the same). */
  private mirror(entry: Entry) {
    const context = entry.context, doc = this.doc(entry.id);
    if (!context || !doc) return;
    // A context that can't show the save its V comes from (it isn't here yet) shows a stand-in: nothing of it is the V's, so nothing is
    // recorded until the save arrives and the context is brought up to the document (`saveArrived`). Its changes are refused meanwhile.
    if (doc.source.kind === "save" && this.blocked(entry.id) === SAVE_MISSING) return;
    const save = context.shownSave(), decoded = save ? this.saveId(save) : null;
    const next = documentOfForm(entry.id, context.form(), context.shownBody(), decoded, doc);
    if (canonical(next) === canonical(doc)) return;
    const sourceChanged = canonical(next.source) !== canonical(doc.source) || next.body !== doc.body;
    try {
      this.putSave(decoded, save);
      const edits = [{ ...docRef(entry.id), value: next }];
      this.deps.outbox.commit(sourceChanged ? "character.setSource" : "character.update", edits, { requires: this.requires(edits) });
      entry.failure = null;
    } catch (error) {
      entry.failure = (error as Error).message;
      this.deps.report?.(error);
    }
    this.changed();
  }
  /** A decoded save is here now: each context of a V from it that couldn't show it yet is brought up to its document, with the save. */
  private saveArrived(saveId: string) {
    for (const entry of this.entries.values()) {
      const doc = entry.context ? this.doc(entry.id) : null;
      if (!doc || doc.source.kind !== "save" || doc.source.decoded !== saveId) continue;
      const save = this.decoded(saveId), shown = entry.context!.shownSave();
      if (!save || (shown && this.saveId(shown) === saveId)) continue;
      entry.context!.replace(storedOfDocument(doc), save, RESTORED_NOTE);
    }
  }
  /** Whether `value` is the very save this V comes from while it can't show it (missing here, or being restored): importing it only puts it. */
  private namesSave(id: CharacterId, value: unknown): boolean {
    const doc = this.doc(id);
    if (doc?.source.kind !== "save" || !this.blocked(id)) return false;
    try { return this.saveId(parseSavedV(value)) === doc.source.decoded; } catch { return false; }
  }
  /**
   * Import the save a V comes from again (style guide t-recovering): an immutable put, which changes no V and is taken while restoring;
   * every context of a V from it shows it at once, and commands waiting for it are sent.
   */
  private importSave(_id: CharacterId, value: unknown): void {
    const save = parseSavedV(value), saveId = this.saveId(save);
    this.putSave(saveId, save);
    this.saveArrived(saveId);
  }
  /** Why a V can't take changes now: still being restored, or its save isn't here to show (a change made then would drop its source). */
  private blocked(id: CharacterId): string | null {
    if (this.deps.outbox.recovering(docRef(id))) return RESTORING;
    // (Its content not being here at all: a context mid-way through changing the V's source shows another save for a moment.)
    const doc = this.doc(id);
    if (doc?.source.kind === "save" && !this.decoded(doc.source.decoded)) return SAVE_MISSING;
    return null;
  }
  /** The character's document changed from elsewhere: a context shows it, its Undo starting there; commands read before it are stale. */
  private fromElsewhere(id: CharacterId) {
    const entry = this.entryOf(id);
    entry.revision++;
    const doc = this.doc(id);
    if (!entry.context) return;
    if (!doc) { this.drop(entry); return; }
    const save = doc.source.kind === "save" ? this.decoded(doc.source.decoded) ?? undefined : undefined;
    entry.context.replace(storedOfDocument(doc), save, ELSEWHERE_NOTE);
  }

  /** Keep mine, Use theirs, or Keep both (mine becomes a copy of the V, in the profiles that list it), each one outbox write. */
  private resolve(id: CharacterId, keep: "mine" | "theirs" | "both"): Capability {
    const conflict = this.deps.outbox.document(docRef(id))?.conflict;
    if (!conflict) return refusal("invalid_value", "Nothing about this V changed in another window.");
    try {
      if (keep === "mine") this.deps.outbox.keepMine(conflict.id);
      else if (keep === "theirs") this.deps.outbox.useTheirs(conflict.id);
      else this.deps.outbox.keepBoth(conflict.id, mine => this.copyOf(id, mine));
    } catch (error) { return refusal("unavailable", (error as Error).message); }
    return { available: true };
  }
  /**
   * Keep both: this window's version of `id` as a new V named "(this window)", added to every profile that lists the original, now
   * (theirs) or in mine (a `character.create` whose membership went stale). Each membership is written over the profile as it is now
   * (the outbox has taken theirs before calling this), so mine's other changes to a profile never land over theirs.
   */
  private copyOf(id: CharacterId, mine: readonly OutboxEdit[]): OutboxEdit[] {
    const value = mine.find(edit => edit.kind === CHARACTER_DOCUMENT && edit.id === id)?.value;
    const doc = value === undefined || isTombstone(value) ? null : characterDocumentOf(value);
    if (!doc) return [];
    const copy = newCharacterId(this.deps.random);
    const name = `${characterLabel(doc).slice(0, 66)} (this window)`;
    this.entryOf(copy);
    const profiles = this.deps.profiles;
    const listed = new Set((profiles?.holding(characterRef(id)) ?? []).map(profile => profile.id));
    for (const edit of mine) if (edit.kind === PROFILE_DOCUMENT && !isTombstone(edit.value) &&
      profileDocumentOf(edit.value)?.subjects.some(ref => sameSubject(ref, characterRef(id)))) listed.add(edit.id);
    return [{ ...docRef(copy), value: { ...doc, id: copy, name } satisfies CharacterDocument },
      ...[...listed].flatMap(profileId => {
        const profile = profiles?.profile(profileId);
        if (!profile) return [];
        const planned = profiles!.membership(profile.id, profile.revision, characterRef(copy));
        return "edit" in planned ? [planned.edit] : [];
      })];
  }

  // -------------------------------------------------------------------------------------------------------------
  // Commands

  /** What a source change sets on a document (a new V clears the choices made on the previous one), and its decoded save. */
  private prepareSource(source: CharacterSourceChange, save?: SaveReference):
    { body: BodyGender; source: CharacterSource; choices: CharacterDocument["choices"]; decoded: { id: string; value: SavedV } | null } | Capability {
    if (source?.kind === "default") {
      if (source.bodyGender !== "female" && source.bodyGender !== "male") return refusal("invalid_value", "A V's body is feminine or masculine.");
      return { body: source.bodyGender, source: { kind: "default" }, choices: [], decoded: null };
    }
    if (source?.kind === "save") {
      let value: SavedV;
      try { value = parseSavedV(source.value); savedDescriptorsOf(value); } catch (error) { return refusal("invalid_value", (error as Error).message); }
      const id = this.saveId(value);
      return { body: value.isMale ? "male" : "female", source: { kind: "save", decoded: id, ...(save ? { save } : {}) }, choices: [],
        decoded: { id, value: this.decoded(id) ?? value } };
    }
    if (source?.kind === "preset") {
      let loaded: ReturnType<typeof presetLoad>, name: string | null;
      try { const preset = parseCcPreset(source.value); loaded = presetLoad(preset); name = preset.name; } catch (error) { return refusal("invalid_value", (error as Error).message); }
      return { body: loaded.kept.bodyGender, source: { kind: "preset", ...(name ? { name } : {}), kept: serializeCcPreset(loaded.kept) }, choices: loaded.choices, decoded: null };
    }
    return refusal("invalid_value", "That isn't somewhere a V can come from.");
  }
  /** Records one command; a refusal when this window may not record it (it doesn't hold its workspace). */
  private record(command: string, edits: OutboxEdit[]): Capability {
    try { this.deps.outbox.commit(command, edits, { requires: this.requires(edits) }); return { available: true }; }
    catch (error) { return refusal("unavailable", (error as Error).message); }
  }

  /**
   * Make a character: its decoded save (when it comes from one), the character and, with `profile`, its membership there, as one
   * command. Default: the creator's default feminine V.
   */
  async create(input: { source?: CharacterSourceChange; name?: string; save?: SaveReference; profile?: { id: ProfileId; base: number } } = {}): Promise<CharacterAnswer> {
    const id = newCharacterId(this.deps.random);
    const made = this.prepareSource(input.source ?? { kind: "default", bodyGender: "female" }, input.save);
    if (!("source" in made)) return failed(made);
    const name = input.name?.trim();
    const doc: CharacterDocument = { schema: CHARACTER_SCHEMA, id, ...(name && name.length <= 80 ? { name } : {}), body: made.body, source: made.source,
      choices: made.choices };
    const edits: OutboxEdit[] = [{ ...docRef(id), value: doc }];
    if (input.profile) {
      if (!this.deps.profiles) return failed(refusal("unavailable", "Profiles aren't available here."));
      const planned = this.deps.profiles.membership(input.profile.id, input.profile.base, characterRef(id));
      if (!("edit" in planned)) return failed(planned);
      edits.push(planned.edit);
    }
    if (!this.deps.outbox.status().stopped) {
      try { this.putSave(made.decoded?.id ?? null, made.decoded?.value ?? null); }
      catch (error) { return failed(refusal("unavailable", (error as Error).message)); }
    }
    const recorded = this.record("character.create", edits);
    if (!recorded.available) return failed(recorded);
    const entry = this.entryOf(id);
    entry.revision = 1;
    this.changed();
    return { ok: true, character: id, revision: entry.revision };
  }

  capability(command: SetSourceCommand): Capability {
    const entry = this.live(command.character, command.base);
    if (!("id" in entry)) return entry;
    return entry.context ? entry.context.capability({ kind: "character.setSource", source: command.source }) : { available: true };
  }
  /**
   * Where the V comes from (`character.setSource`, replacing `savedV.*`), checked against the base the caller read. While a scene shows the
   * character, its context makes the change (one step of its Undo, applied on that scene) and it is mirrored; otherwise it is recorded here.
   */
  async setSource(command: SetSourceCommand): Promise<CharacterAnswer> {
    const allowed = this.capability(command);
    if (!allowed.available) return failed(allowed);
    const entry = this.entries.get(command.character)!, doc = this.doc(entry.id)!;
    const made = this.prepareSource(command.source, command.save);
    if (!("source" in made)) return failed(made);
    // The save the V already comes from: nothing changes (its choices stay); a scene shows it again.
    const same = made.source.kind === "save" && doc.source.kind === "save" && doc.source.decoded === made.source.decoded;
    if (entry.context) {
      try { entry.context.dispatch({ kind: "character.setSource", source: made.decoded ? { kind: "save", value: made.decoded.value } : command.source }); }
      catch (error) { return failed(refusal("invalid_value", (error as Error).message)); }
      if (entry.failure) return failed(refusal("unavailable", entry.failure));
    } else if (!same) {
      try { this.putSave(made.decoded?.id ?? null, made.decoded?.value ?? null); }
      catch (error) { return failed(refusal("unavailable", (error as Error).message)); }
      const recorded = this.record("character.setSource",
        [{ ...docRef(entry.id), value: { ...doc, body: made.body, source: made.source, choices: made.choices } satisfies CharacterDocument }]);
      if (!recorded.available) return failed(recorded);
    }
    // A save reference names where the save is on disk; the context's mirror keeps the one it had for the same save.
    const now = this.doc(entry.id)!;
    if (command.save && now.source.kind === "save" && made.source.kind === "save" && now.source.decoded === made.source.decoded && canonical(now.source.save) !== canonical(command.save)) {
      const recorded = this.record("character.setSource", [{ ...docRef(entry.id), value: { ...now, source: { ...now.source, save: command.save } } }]);
      if (!recorded.available) return failed(recorded);
    }
    if (!same) entry.revision++;
    this.changed();
    return { ok: true, character: entry.id, revision: entry.revision };
  }
  async rename(character: CharacterId, base: number, name: string): Promise<CharacterAnswer> {
    const entry = this.live(character, base);
    if (!("id" in entry)) return failed(entry);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) return failed(refusal("invalid_value", "A V's name is 1 to 80 characters."));
    const recorded = this.record("character.rename", [{ ...docRef(character), value: { ...this.doc(character)!, name: trimmed } }]);
    if (!recorded.available) return failed(recorded);
    entry.revision++;
    this.changed();
    return { ok: true, character, revision: entry.revision };
  }
  /**
   * Delete a character: a tombstone (restorable for 30 days, §1.4). The answer names the profiles that still list it; their references
   * stay and show Restore. Its context and history go.
   */
  async delete(character: CharacterId, base: number): Promise<CharacterAnswer & { holding?: readonly ProfileView[] }> {
    const entry = this.live(character, base);
    if (!("id" in entry)) return failed(entry);
    const holding = this.deps.profiles?.holding(characterRef(character)) ?? [];
    const recorded = this.record("character.delete", [{ ...docRef(character), value: tombstoneOf(this.doc(character), (this.deps.now ?? Date.now)()) }]);
    if (!recorded.available) return failed(recorded);
    this.drop(entry);
    entry.revision++;
    closeCharacterHistory({ service: this.deps.history, id: character });
    this.changed();
    return { ok: true, character, revision: entry.revision, holding };
  }
}
