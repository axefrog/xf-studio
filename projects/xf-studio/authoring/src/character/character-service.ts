/**
 * The character owner (profiles design §1.1, §7): every character's document and the decoded saves they come from, and one
 * `CharacterContext` (`CharacterContextActions`) per `CharacterId`, made when a scene first shows the character. There is no current
 * character: every read and command names the character it is about, and the revision it read (`base`).
 *
 * - **Commands** (one `DocumentCommandPort` command each, §2.1): `character.create` (the decoded save, the character and, when asked,
 *   its profile membership, in that order, so a command refused part-way leaves at worst an orphan the retention rules keep, §1.4),
 *   `character.setSource` (replacing `savedV.*`; the decoded save and the character together), `character.rename`, `character.delete`
 *   (a tombstone, after naming the profiles that list it) and `character.update` (what a context's own actions changed).
 * - **A context's changes are written back** as `character.update`, one write at a time, the newest value last. A write refused as stale
 *   marks the character `conflict` and writes nothing over the newer revision: resolving it is phase 1c's (the outbox and conflicts).
 *   A write that fails keeps its changes unsaved (`unsaved`, never dropped); `settle` writes them again and says whether the library
 *   holds them, and a context is released only once it does (the rule of chunk 1a's saved documents, `saved-document.ts`).
 * - **One queue per character.** Commands and write-backs of a character's edits run one at a time, in the order asked, on its queue:
 *   nothing interleaves with a command's check and commit, and `flush` waits for the queue to be empty.
 * - **Commands name their base.** A base is current from the revision the last command left up to the newest (the character's own
 *   write-backs in between don't make it stale). A command checks it when asked, prepares (a save is hashed), checks again, and on the
 *   queue refuses if another command landed meanwhile (a rename, a delete): never undone.
 * - **A context follows its source.** A source change for a character whose context was opened meanwhile goes through that context
 *   (one Undo step), so its queued write-back never writes the earlier source over the command.
 * - **Shared and per character.** Every context shares the page's creator catalogue (creator-catalogue.ts) and is its own requester
 *   (`<id>`, its panel instances `<id>/<instance>`); its Undo history is the history service's `character:<id>` scope.
 * - **Scenes.** A context is bound to the scene ports it was opened with (`showSave` applies a save on that scene's head); several
 *   scenes of one character arrive with the scene runtimes (phase 4a).
 */
import type { CharactersPort, CharacterSummary } from "../platform/api/characters";
import { characterRef } from "../platform/api/characters";
import { refusal, type Capability } from "../platform/api/capability";
import { type CommandWrite, commandKey, type DocumentCommandPort } from "../platform/api/document-commands";
import { commandId } from "../platform/core/document-commands";
import type { HistoryService } from "../platform/core/history-service";
import { parseSavedV, type SavedV } from "../saves/save-reader";
import type { BodyGender } from "./cc-catalogue";
import { parseCcPreset, serializeCcPreset } from "./cc-preset";
import { CharacterContextActions, type CharacterContextPorts, presetLoad } from "./character-context-actions";
import { type CharacterSourceChange, savedDescriptorsOf } from "./character-context";
import { closeCharacterHistory } from "./character-history";
import { CHARACTER_DOCUMENT, CHARACTER_SCHEMA, type CharacterDocument, characterDocumentOf, type CharacterId, characterLabel, decodedSaveId,
  documentOfForm, newCharacterId, SAVED_V_DOCUMENT, type SaveReference, storedOfDocument } from "./character-document";
import type { CreatorCatalogue } from "./creator-catalogue";
import type { ProfileId, ProfileService, ProfileView } from "../app/profiles/profile-service";

/** What a scene gives the character it shows: applying a save on its head, its V's preparation, its choice previews. */
export type CharacterScenePorts = Pick<CharacterContextPorts, "showSave" | "details" | "previews">;
export type CharacterServiceDeps = {
  readonly documents: DocumentCommandPort;
  /** The page's one creator catalogue, shared by every character. */
  readonly catalogue: CreatorCatalogue;
  /** The session's history service: each character's steps are its `character:<id>` scope. */
  readonly history: HistoryService;
  /** For `character.create` with a profile membership. */
  readonly profiles?: ProfileService;
  readonly random?: () => number;
};
export type CharacterAnswer = { ok: true; character: CharacterId; revision: number } | { ok: false; code: Capability["code"]; reason: string };
/** `character.setSource` as the service takes it: the character, the revision read, the new source and, for a save, where it is. */
export type SetSourceCommand = { kind: "character.setSource"; character: CharacterId; base: number; source: CharacterSourceChange; save?: SaveReference };

type Entry = {
  readonly id: CharacterId;
  revision: number;
  /** Null once deleted (the tombstone's revision is kept). */
  doc: CharacterDocument | null;
  conflict: boolean;
  context: CharacterContextActions | null;
  unsubscribe: (() => void) | null;
  /** The revision the last command (or the load, or `create`) left: a base from here on is current. */
  commandRevision: number;
  /** The end of the character's queue, and how many tasks are queued or running on it. */
  tail: Promise<void>;
  queued: number;
  /** A write-back of the context's edits is queued and hasn't started (later edits join it). */
  writeQueued: boolean;
  /** The context holds changes the library doesn't have yet (set on every change, cleared once a write of them is acknowledged). */
  dirty: boolean;
  /** Why the last write-back failed, while its changes are unsaved. */
  failure: string | null;
};
const entryOf = (id: CharacterId, revision: number, doc: CharacterDocument | null): Entry =>
  ({ id, revision, doc, conflict: false, context: null, unsubscribe: null, commandRevision: revision, tail: Promise.resolve(), queued: 0,
    writeQueued: false, dirty: false, failure: null });

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
const failed = (capability: Capability): CharacterAnswer => ({ ok: false, code: capability.code, reason: capability.reason ?? "That can't be done." });

export class CharacterService implements CharactersPort {
  private readonly entries = new Map<CharacterId, Entry>();
  private readonly saves = new Map<string, { revision: number; value: SavedV }>();
  private readonly saveIds = new WeakMap<SavedV, Promise<string>>();
  private readonly listeners = new Set<() => void>();
  private summaries: readonly CharacterSummary[] | null = null;
  private order = 0;
  private readonly made = new Map<CharacterId, number>();

  constructor(private readonly deps: CharacterServiceDeps) {}

  /** Read every character and decoded save from the library. */
  async load(signal?: AbortSignal): Promise<void> {
    const [characters, saves] = await Promise.all([this.deps.documents.list(CHARACTER_DOCUMENT, signal), this.deps.documents.list(SAVED_V_DOCUMENT, signal)]);
    for (const save of saves) {
      if (save.deleted) continue;
      try { this.saves.set(save.id, { revision: save.revision, value: parseSavedV(save.value) }); } catch { /* A save this build can't read stays in the library. */ }
    }
    for (const document of characters) {
      const doc = document.deleted ? null : characterDocumentOf(document.value);
      this.entries.set(document.id, entryOf(document.id, document.revision, doc));
      this.made.set(document.id, this.order++);
    }
    this.changed();
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { this.summaries = null; for (const listener of [...this.listeners]) listener(); }

  list(): readonly CharacterSummary[] {
    this.summaries ??= Object.freeze([...this.entries.values()].filter(entry => entry.doc)
      .sort((a, b) => (this.made.get(a.id) ?? 0) - (this.made.get(b.id) ?? 0))
      .map(entry => Object.freeze({ id: entry.id, label: characterLabel(entry.doc), body: entry.doc!.body, origin: entry.doc!.source.kind,
        revision: entry.revision, conflict: entry.conflict, unsaved: entry.dirty && entry.failure !== null })));
    return this.summaries;
  }
  character(id: CharacterId): CharacterSummary | null { return this.list().find(summary => summary.id === id) ?? null; }
  /** A character's document as the library holds it (a copy), or null. */
  document(id: CharacterId): CharacterDocument | null { const doc = this.entries.get(id)?.doc; return doc ? structuredClone(doc) : null; }
  /** A decoded save by its content ID (shared, never changed), or null. */
  decoded(id: string): SavedV | null { return this.saves.get(id)?.value ?? null; }
  private live(id: CharacterId, base?: number): Entry | Capability {
    const entry = this.entries.get(id);
    if (!entry?.doc) return refusal("missing_target", "That V doesn't exist any more.");
    if (base !== undefined && (base < entry.commandRevision || base > entry.revision)) return refusal("stale", "That V changed since it was read.");
    return entry;
  }
  private saveId(save: SavedV): Promise<string> {
    let id = this.saveIds.get(save);
    if (!id) this.saveIds.set(save, id = decodedSaveId(save));
    return id;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Contexts

  /** The character's one context, made the first time a scene shows it (`ports`: that scene's). */
  context(id: CharacterId, ports: CharacterScenePorts): CharacterContextActions {
    const entry = this.live(id);
    if (!("id" in entry)) throw Error(entry.reason);
    if (entry.context) return entry.context;
    const doc = entry.doc!, save = doc.source.kind === "save" ? this.saves.get(doc.source.decoded)?.value : undefined;
    const context = new CharacterContextActions({ ...ports, catalogue: this.deps.catalogue, requester: id, history: { service: this.deps.history, id } },
      { stored: storedOfDocument(doc), ...(save ? { save } : {}) });
    entry.context = context;
    entry.unsubscribe = context.subscribe(() => this.persist(entry));
    return context;
  }
  /**
   * No scene shows the character any more: its context goes (its history stays for the session), once the library holds its changes.
   * False (and the context stays) when they couldn't be written: nothing unsaved is dropped.
   */
  async release(id: CharacterId): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry?.context) return true;
    if (!await this.settle(id)) return false;
    // On the queue, so an edit made after the settle is never dropped.
    return this.enqueue(entry, async () => {
      if (entry.dirty) return false;
      this.drop(entry);
      return true;
    });
  }
  private drop(entry: Entry) {
    entry.unsubscribe?.();
    entry.context?.dispose();
    entry.context = null; entry.unsubscribe = null;
  }
  /** Resolves once the character's queue (or every character's, without `id`) is empty. */
  async flush(id?: CharacterId): Promise<void> {
    for (const entry of this.held(id)) while (entry.queued) await entry.tail;
  }
  /**
   * True once the library holds every change of the character (or of every one, without `id`): changes whose write failed are written
   * again now. False when one still couldn't be written, or is in conflict.
   */
  async settle(id?: CharacterId): Promise<boolean> {
    await this.flush(id);
    for (const entry of this.held(id)) if (entry.dirty && entry.context && !entry.conflict) this.persist(entry);
    await this.flush(id);
    return this.held(id).every(entry => !entry.dirty);
  }
  private held(id?: CharacterId): Entry[] { return id ? [this.entries.get(id)].filter(Boolean) as Entry[] : [...this.entries.values()]; }

  /** Run `task` on the character's queue, after everything asked before it. */
  private enqueue<T>(entry: Entry, task: () => Promise<T>): Promise<T> {
    entry.queued++;
    const run = entry.tail.then(task);
    entry.tail = run.then(() => {}, () => {}).then(() => { entry.queued--; });
    return run;
  }
  /** A context changed: a write-back is queued (edits made before it starts join it). */
  private persist(entry: Entry) {
    entry.dirty = true;
    if (entry.writeQueued) return;
    entry.writeQueued = true;
    void this.enqueue(entry, async () => {
      entry.writeQueued = false;
      try { await this.writeBack(entry); }
      catch (error) {
        // The changes stay unsaved and are written again on the next change or `settle`; the failure is reported.
        entry.failure = (error as Error)?.message || "The V couldn't be saved.";
        this.changed();
      }
    });
  }
  private async writeBack(entry: Entry) {
    const context = entry.context;
    if (!context || !entry.doc || entry.conflict) return;
    const save = context.shownSave(), decoded = save ? await this.saveId(save) : null;
    const next = documentOfForm(entry.id, context.form(), context.shownBody(), decoded, entry.doc);
    if (canonical(next) === canonical(entry.doc)) { if (!entry.writeQueued) { entry.dirty = false; entry.failure = null; } return; }
    const writes: CommandWrite[] = [];
    if (decoded && save && !this.saves.has(decoded)) writes.push({ kind: SAVED_V_DOCUMENT, id: decoded, base: 0, value: save });
    writes.push({ kind: CHARACTER_DOCUMENT, id: entry.id, base: entry.revision, value: next });
    const answer = await this.deps.documents.commit({ id: commandId("character.update", this.deps.random), command: "character.update", writes });
    if (!answer.ok) {
      if (answer.reason === "stale") entry.conflict = true;
      else entry.failure = "This workspace is now open in another window, so this V's changes weren't saved here.";
      this.changed();
      return;
    }
    if (decoded && save) this.saves.set(decoded, { revision: answer.revisions[commandKey(SAVED_V_DOCUMENT, decoded)] ?? 1, value: save });
    entry.revision = answer.revisions[commandKey(CHARACTER_DOCUMENT, entry.id)]!;
    entry.doc = next;
    // Acknowledged: unsaved only if a newer change is waiting for its own write.
    if (!entry.writeQueued) { entry.dirty = false; entry.failure = null; }
    this.changed();
  }
  /** On the queue: the character still exists and no other command landed since `issued` (the command revision it was asked at). */
  private stillAsAsked(entry: Entry, issued: number): Capability {
    if (!entry.doc) return refusal("missing_target", "That V doesn't exist any more.");
    return entry.commandRevision === issued ? { available: true } : refusal("stale", "That V changed since it was read.");
  }

  // -------------------------------------------------------------------------------------------------------------
  // Commands

  /** A document's source and choices for `source` (a new V clears the choices made on the previous one), and its decoded save. */
  private async sourced(source: CharacterSourceChange, base: { id: CharacterId; prior?: CharacterDocument }, save?: SaveReference):
    Promise<{ doc: CharacterDocument; decoded: { id: string; value: SavedV } | null } | Capability> {
    const keep = base.prior ? (({ clothing, ownMakeup, name, voice }) => ({ ...(clothing ? { clothing } : {}), ...(ownMakeup ? { ownMakeup } : {}),
      ...(name ? { name } : {}), ...(voice ? { voice } : {}) }))(base.prior) : {};
    const doc = (body: BodyGender, rest: Pick<CharacterDocument, "source" | "choices">): CharacterDocument =>
      ({ ...keep, schema: CHARACTER_SCHEMA, id: base.id, body, ...rest });
    if (source.kind === "default") {
      if (source.bodyGender !== "female" && source.bodyGender !== "male") return refusal("invalid_value", "A V's body is feminine or masculine.");
      return { doc: doc(source.bodyGender, { source: { kind: "default" }, choices: [] }), decoded: null };
    }
    if (source.kind === "save") {
      let value: SavedV;
      try { value = parseSavedV(source.value); savedDescriptorsOf(value); } catch (error) { return refusal("invalid_value", (error as Error).message); }
      const id = await this.saveId(value);
      return { doc: doc(value.isMale ? "male" : "female", { source: { kind: "save", decoded: id, ...(save ? { save } : {}) }, choices: [] }),
        decoded: { id, value: this.saves.get(id)?.value ?? value } };
    }
    if (source.kind === "preset") {
      let loaded: ReturnType<typeof presetLoad>, name: string | null;
      try { const preset = parseCcPreset(source.value); loaded = presetLoad(preset); name = preset.name; } catch (error) { return refusal("invalid_value", (error as Error).message); }
      return { doc: doc(loaded.kept.bodyGender, { source: { kind: "preset", ...(name ? { name } : {}), kept: serializeCcPreset(loaded.kept) },
        choices: loaded.choices }), decoded: null };
    }
    return refusal("invalid_value", "That isn't somewhere a V can come from.");
  }

  /**
   * Make a character: its decoded save (when it comes from one), the character and, with `profile`, its membership there, in one
   * command. Default: the creator's default feminine V.
   */
  async create(input: { source?: CharacterSourceChange; name?: string; save?: SaveReference; profile?: { id: ProfileId; base: number } } = {}): Promise<CharacterAnswer> {
    const id = newCharacterId(this.deps.random);
    const made = await this.sourced(input.source ?? { kind: "default", bodyGender: "female" }, { id }, input.save);
    if (!("doc" in made)) return failed(made);
    const name = input.name?.trim();
    const doc: CharacterDocument = name && name.length <= 80 ? { ...made.doc, name } : made.doc;
    const writes: CommandWrite[] = [];
    if (made.decoded && !this.saves.has(made.decoded.id)) writes.push({ kind: SAVED_V_DOCUMENT, id: made.decoded.id, base: 0, value: made.decoded.value });
    writes.push({ kind: CHARACTER_DOCUMENT, id, base: 0, value: doc });
    let membership: { committed(revision: number): void } | null = null;
    if (input.profile) {
      if (!this.deps.profiles) return failed(refusal("unavailable", "Profiles aren't available here."));
      const planned = this.deps.profiles.membership(input.profile.id, input.profile.base, characterRef(id));
      if (!("write" in planned)) return failed(planned);
      writes.push(planned.write);
      membership = planned;
    }
    const answer = await this.deps.documents.commit({ id: commandId("character.create", this.deps.random), command: "character.create", writes });
    if (!answer.ok) return { ok: false, code: answer.reason === "stale" ? "stale" : "unavailable",
      reason: answer.reason === "stale" ? "That profile changed since it was read." : "This workspace is now open in another window." };
    if (made.decoded) this.saves.set(made.decoded.id, { revision: answer.revisions[commandKey(SAVED_V_DOCUMENT, made.decoded.id)] ?? 1, value: made.decoded.value });
    const revision = answer.revisions[commandKey(CHARACTER_DOCUMENT, id)]!;
    this.entries.set(id, entryOf(id, revision, doc));
    this.made.set(id, this.order++);
    if (input.profile) membership?.committed(answer.revisions[commandKey("profile", input.profile.id)]!);
    this.changed();
    return { ok: true, character: id, revision };
  }

  capability(command: SetSourceCommand): Capability {
    const entry = this.live(command.character, command.base);
    if (!("id" in entry)) return entry;
    return entry.context ? entry.context.capability({ kind: "character.setSource", source: command.source }) : { available: true };
  }
  /**
   * Where the V comes from (`character.setSource`, replacing `savedV.*`). A character a scene shows changes through its context (one
   * Undo step, the save applied on that scene) and is written back; one no scene shows is written at once.
   */
  async setSource(command: SetSourceCommand): Promise<CharacterAnswer> {
    const allowed = this.capability(command);
    if (!allowed.available) return failed(allowed);
    const entry = this.entries.get(command.character)!;
    const viaContext = async (): Promise<CharacterAnswer> => {
      if (!await this.settle(entry.id)) return failed(refusal(entry.conflict ? "stale" : "unavailable",
        entry.conflict ? "That V changed in another window." : entry.failure ?? "The V couldn't be saved."));
      return { ok: true, character: entry.id, revision: entry.revision };
    };
    if (entry.context) {
      // Checked and applied in one turn: nothing lands between the base check and the change.
      entry.context.dispatch({ kind: "character.setSource", source: command.source });
      return viaContext();
    }
    const issued = entry.commandRevision;
    const made = await this.sourced(command.source, { id: entry.id, prior: entry.doc! }, command.save);
    if (!("doc" in made)) return failed(made);
    // Preparing (hashing a save) took a while: the V must still be as the command read it.
    const still = this.live(command.character, command.base);
    if (!("id" in still)) return failed(still);
    const answer = await this.enqueue(entry, async (): Promise<CharacterAnswer | "context"> => {
      const now = this.stillAsAsked(entry, issued);
      if (!now.available) return failed(now);
      // A context opened meanwhile shows the V: the change goes through it, so its write-back carries the new source.
      if (entry.context) { this.follow(entry, command.source); return "context"; }
      const writes: CommandWrite[] = [];
      if (made.decoded && !this.saves.has(made.decoded.id)) writes.push({ kind: SAVED_V_DOCUMENT, id: made.decoded.id, base: 0, value: made.decoded.value });
      const done = await this.commitCharacter(entry, "character.setSource", made.doc, writes, made.decoded);
      // A context opened while the command was being written started from the earlier source: it follows the new one first.
      if (done.ok && entry.context) this.follow(entry, command.source);
      return done;
    });
    return answer === "context" ? viaContext() : answer;
  }
  /** The context shows the character's new source (one Undo step), so what it writes back carries it. */
  private follow(entry: Entry, source: CharacterSourceChange) {
    const context = entry.context!, action = { kind: "character.setSource" as const, source };
    if (context.capability(action).available) context.dispatch(action);
  }
  async rename(character: CharacterId, base: number, name: string): Promise<CharacterAnswer> {
    const entry = this.live(character, base);
    if (!("id" in entry)) return failed(entry);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) return failed(refusal("invalid_value", "A V's name is 1 to 80 characters."));
    const issued = entry.commandRevision;
    return this.enqueue(entry, async () => {
      const now = this.stillAsAsked(entry, issued);
      return now.available ? this.commitCharacter(entry, "character.rename", { ...entry.doc!, name: trimmed }, []) : failed(now);
    });
  }
  /**
   * Delete a character: a tombstone (restorable for 30 days, §1.4). The answer names the profiles that still list it; their references
   * stay and show Restore. Its context and history go.
   */
  async delete(character: CharacterId, base: number): Promise<CharacterAnswer & { holding?: readonly ProfileView[] }> {
    const entry = this.live(character, base);
    if (!("id" in entry)) return failed(entry);
    const holding = this.deps.profiles?.holding(characterRef(character)) ?? [];
    const issued = entry.commandRevision;
    if (!await this.settle(character)) return failed(refusal("unavailable", "This V's changes couldn't be saved, so it wasn't deleted."));
    return this.enqueue(entry, async (): Promise<CharacterAnswer & { holding?: readonly ProfileView[] }> => {
      const now = this.stillAsAsked(entry, issued);
      if (!now.available) return failed(now);
      this.drop(entry);
      const answer = await this.deps.documents.commit({ id: commandId("character.delete", this.deps.random), command: "character.delete",
        writes: [{ kind: CHARACTER_DOCUMENT, id: character, base: entry.revision, tombstone: true, value: entry.doc }] });
      if (!answer.ok) return failed(refusal(answer.reason === "stale" ? "stale" : "unavailable", "That V changed since it was read."));
      entry.revision = entry.commandRevision = answer.revisions[commandKey(CHARACTER_DOCUMENT, character)]!;
      entry.doc = null;
      closeCharacterHistory({ service: this.deps.history, id: character });
      this.changed();
      return { ok: true, character, revision: entry.revision, holding };
    });
  }
  /** One command over the character's document, run on its queue (its base is the revision the queue left, which `current` checked). */
  private async commitCharacter(entry: Entry, command: string, doc: CharacterDocument, before: CommandWrite[], decoded?: { id: string; value: SavedV } | null): Promise<CharacterAnswer> {
    const answer = await this.deps.documents.commit({ id: commandId(command, this.deps.random), command,
      writes: [...before, { kind: CHARACTER_DOCUMENT, id: entry.id, base: entry.revision, value: doc }] });
    if (!answer.ok) return failed(refusal(answer.reason === "stale" ? "stale" : "unavailable",
      answer.reason === "stale" ? "That V changed since it was read." : "This workspace is now open in another window."));
    if (decoded) this.saves.set(decoded.id, { revision: answer.revisions[commandKey(SAVED_V_DOCUMENT, decoded.id)] ?? 1, value: decoded.value });
    entry.revision = entry.commandRevision = answer.revisions[commandKey(CHARACTER_DOCUMENT, entry.id)]!;
    entry.doc = doc;
    this.changed();
    return { ok: true, character: entry.id, revision: entry.revision };
  }
}
