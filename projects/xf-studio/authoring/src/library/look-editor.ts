/**
 * The live editor document over one look's session (profiles design §7, `collection-workspace.ts`' one live look, steps 1–4): the
 * authoring document shows the look its scene names (a `LookRef`), reads it from the look's working copy and writes it back through the
 * look's session (`look.update`, one document, coalescing in the outbox). Nothing here is "the" look: the scene says which look is shown,
 * and showing another one writes the previous one's changes first, lets its session go and opens the next one's.
 *
 * - **Reading.** A look working copy holds its parts and memory as stored; they are read through the part registry, and a look holding a
 *   newer build's data is shown locked (kept exactly as it came, never written from here).
 * - **Writing.** Every change of the document (an edit, a selection, an Undo) is recorded in the outbox as it is made (`look.update`,
 *   coalescing into the look's unsent entry), so every value taken from elsewhere meets it as a pending change (a conflict, never a
 *   replacement). Only storing it waits: the outbox stores the look's key within `STORE_SOON_MS` (a drag is one storage write per
 *   interval), and at once when something needs it (`commit`: a copy, a snapshot, Save version, Check, Build, closing the page).
 * - **History.** The document's Undo history is the look's scope, `look:<collection>/<look>` (§3.7); it is stored with the look's memory.
 * - **Elsewhere.** A change of the look taken from another window (or a resolution that took theirs) replaces what the document shows, and
 *   its Undo starts there. While the look is being restored from the last session, the document can't be edited (the recovery gate).
 */
import type { AuthoringDocument, DocumentState } from "../app/authoring/authoring-document";
import { liveFeatureStates, liveMemory, livePart, withLiveFeatures, withLiveMemory, withLivePart, type DocumentModel } from "../app/workspace/collection-workspace";
import { emptyRecipe } from "../engines/layered-makeup/recipe";
import { COLLECTION_2, isNewerData, type Look, type LookMemory } from "../platform/api";
import { lookScope } from "../platform/core/history-service";
import { emptyLookHistory } from "../platform/core/look-history";
import type { LookRef, LookWorking } from "./collection-documents";
import { sameLook } from "./collection-documents";
import type { LookSession, LookSessions } from "./look-sessions";

export const RESTORING_LOOK = "This look is still being restored from your last session. It can be changed again in a moment.";
export const CHANGED_ELSEWHERE = "Changed in another window. Undo starts here.";
/** The scope the document is in while its scene shows no look (its collection's last preset was removed): nothing in it can be edited. */
export const NO_LOOK_SCOPE = lookScope({ collection: "none", look: "none" });
/** Why the document refuses edits while the scene's look is removed (the last preset of its collection, until it is restored). */
export const REMOVED_LOOK = "This preset was removed. Restore it, or add a preset, to edit again.";

/** A look working copy as the editor reads it: the look (parsed parts), its memory and the document state it shows. */
export type LookContent = { readonly look: Look; readonly memory: LookMemory; readonly state: DocumentState };

/** Read a look working copy for the editor (a look holding a newer build's data is locked, kept as it came). */
export function lookContent(working: Pick<LookWorking, "id" | "name" | "parts" | "memory">, model: DocumentModel): LookContent {
  const stored = { id: working.id, name: working.name, revision: 1, parts: working.parts };
  let look = model.parts.readPreset(stored, COLLECTION_2, "keep"), memory: LookMemory;
  try { memory = model.parts.readMemory(working.memory, look, "refuse"); }
  catch (error) {
    // Newer data in its memory locks the look too: it is kept exactly as it came.
    if (!isNewerData(error)) throw error;
    look = model.parts.keepLook(stored, COLLECTION_2);
    memory = model.parts.readMemory(working.memory, look);
  }
  const recipe = livePart(look, model), others = liveFeatureStates(look, memory, model);
  const state: DocumentState = { recipe: recipe ? structuredClone(recipe) : emptyRecipe(), ...structuredClone(liveMemory(memory, model)),
    fieldSelection: structuredClone(liveMemory(memory, model).fieldSelection ?? {}),
    ...(others ? { liveFeatures: others } : {}), ...(look.locked ? { liveLocked: look.locked } : {}) };
  return { look, memory, state };
}

/** The stored parts and memory of a look with the editor's state written into it (null: a locked look, never written). */
export function lookStored(content: Pick<LookContent, "look" | "memory">, editor: DocumentState, model: DocumentModel):
  { parts: Record<string, unknown>; memory: unknown; look: Look; lookMemory: LookMemory } | null {
  if (content.look.locked) return null;
  const { recipe, liveFeatures, liveLocked: _locked, ...memory } = editor;
  const look: Look = { ...content.look, parts: withLivePart(content.look, recipe, model) };
  const written = withLiveFeatures(look, withLiveMemory(content.memory, structuredClone(memory), model), liveFeatures, model);
  const next: Look = { ...look, parts: written.parts };
  return { parts: model.parts.minimalLook(next, false).parts, memory: model.parts.writeMemory(written.memory, { lookLevel: true }), look: next, lookMemory: written.memory };
}

export type LookEditorDeps = {
  readonly model: DocumentModel;
  readonly sessions: LookSessions;
  readonly document: AuthoringDocument;
  /** Whether the look's document is being restored from the last session (its edits are refused until the library answers). */
  readonly restoring?: (ref: LookRef) => boolean;
  /** After the document shows another look's content (the preview's layer resources and the UV view follow). */
  readonly shown?: () => void;
  /** A plain note for the person (the look changed elsewhere). */
  readonly note?: (text: string) => void;
  readonly report?: (error: unknown) => void;
  /** Stores what the outbox holds to store soon, now (`DocumentOutbox.store`): `commit` calls it. */
  readonly store?: () => void;
};

/** The look the scene names; `content` is null while it is removed (the document is empty and refuses edits until it is live again). */
type Shown = { ref: LookRef; session: LookSession; content: LookContent | null; unsubscribe: () => void };

export class LookEditor {
  private shown: Shown | null = null;
  /** The document shows no look (and is empty). */
  private empty = false;
  /** A change of the document couldn't be recorded (the look is being restored, or this window may not write): the next one tries again. */
  private unrecorded = false;
  private applying = false;
  /** A change of the Undo history alone waits for the end of the turn (an edit in the same turn records it). */
  private historyWaits = false;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: LookEditorDeps) {
    // Every change of the look's content or selection is recorded as it is made: nothing of it waits outside the outbox. A change of the
    // Undo history alone (a step's checkpoint, which an edit follows at once in the same turn, or a label) is recorded at the end of the
    // turn unless the edit recorded it already, so an edit is recorded once.
    this.unsubscribe = deps.document.subscribe(change => {
      if (this.applying || !this.shown || change === "restore" || change === "access") return;
      if (change !== "history") { this.historyWaits = false; this.record(); return; }
      if (this.historyWaits) return;
      this.historyWaits = true;
      queueMicrotask(() => { if (this.historyWaits) { this.historyWaits = false; this.record(); } });
    });
  }

  /** The look the document shows (undefined: none). */
  ref(): LookRef | undefined { return this.shown ? { ...this.shown.ref } : undefined; }
  /** The shown look's session (its conflicts and resolutions). */
  session(): LookSession | undefined { return this.shown?.session; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of [...this.listeners]) listener(); }

  /**
   * Show `ref` (undefined: no look). The look shown before is written first and its session let go; a look that is already shown is left
   * as it is. Answers whether the document shows `ref` now (false: it can't be read).
   */
  show(ref: LookRef | undefined): boolean {
    if (ref && this.shown && sameLook(ref, this.shown.ref)) return true;
    if (!ref && !this.shown && this.empty) return true;
    // An open gesture or control run settles on the look it began on, and is recorded with it, before another look is shown.
    this.deps.document.replacing();
    this.commit();
    this.close();
    this.empty = !ref;
    if (!ref) {
      // No look shown: the document is empty (edits are refused while no preset owns it).
      this.display({ recipe: emptyRecipe(), active: 0, selected: 0, fieldSelection: {}, history: emptyLookHistory() }, NO_LOOK_SCOPE);
      this.blocked(); this.changed();
      return true;
    }
    const session = this.deps.sessions.open(ref), view = session.look();
    if (!view) { void session.release(); this.changed(); return false; }
    let content: LookContent | null = null;
    if (view.state === "live") {
      try { content = lookContent(view, this.deps.model); }
      catch (error) { void session.release(); this.deps.report?.(error); this.changed(); return false; }
    }
    const shown: Shown = { ref: { ...ref }, session, content, unsubscribe: () => {} };
    this.shown = shown;
    shown.unsubscribe = session.subscribe(event => {
      if (this.shown !== shown) return;
      // The look removed (its collection's last preset stays named by the scene) or restored: the document follows it.
      const live = shown.session.look()?.state === "live";
      if (live !== !!shown.content) this.present(shown);
      // A change taken from elsewhere (or a resolution that kept theirs): the document shows it, and its Undo starts there.
      else if (live && (event.kind === "elsewhere" || event.kind === "resolved")) this.reload(shown);
      this.blocked();
      this.changed();
    });
    this.present(shown);
    this.blocked();
    this.changed();
    return true;
  }
  /** Show the look as it is now: its content with its Undo history when live, else an empty document that refuses edits. */
  private present(shown: Shown) {
    const view = shown.session.look();
    if (view?.state !== "live") {
      shown.content = null;
      this.display({ recipe: emptyRecipe(), active: 0, selected: 0, fieldSelection: {}, history: emptyLookHistory() }, lookScope(shown.ref));
      return;
    }
    let content: LookContent;
    try { content = lookContent(view, this.deps.model); } catch (error) { this.deps.report?.(error); return; }
    shown.content = content;
    this.display(content.state, lookScope(shown.ref));
  }
  private display(state: DocumentState, scope?: string) {
    this.applying = true;
    try { this.deps.document.restore(state, scope); } finally { this.applying = false; }
    this.deps.shown?.();
  }
  /** The look as the library holds it now replaces what the document shows, when it differs from what this window wrote. */
  private reload(shown: Shown) {
    const view = shown.session.look();
    if (!shown.content) return;
    if (!view || view.state !== "live") return;
    let content: LookContent;
    try { content = lookContent(view, this.deps.model); } catch (error) { this.deps.report?.(error); return; }
    // Unchanged from what the document shows (this window's own value): nothing to show.
    if (shown.content && this.stored(content, content.state)?.key === this.stored(shown.content, this.deps.document.export())?.key) return;
    // Nothing of this window's waits outside the outbox (every change is recorded as it is made), so another window's version arrives
    // only over a look with no change pending here; a resolution (Use theirs, or Keep both, which made a copy of mine) is the person's.
    shown.content = content;
    this.deps.document.replacing();
    this.display(content.state);
    this.deps.document.history.clear();
    this.deps.note?.(CHANGED_ELSEWHERE);
  }
  /** The recovery gate: while the shown look is being restored, the document refuses edits with the reason. */
  private blocked() {
    const shown = this.shown, ref = shown?.ref;
    this.deps.document.setBlocked(ref && this.deps.restoring?.(ref) ? RESTORING_LOOK : shown && !shown.content ? REMOVED_LOOK : undefined);
  }
  /** The stored form of a look's content with the document's state written in, and its comparison key. */
  private stored(content: Pick<LookContent, "look" | "memory">, editor: DocumentState) {
    const written = lookStored(content, editor, this.deps.model);
    return written && { ...written, key: JSON.stringify([written.parts, written.memory]) };
  }
  /** Records the document's state as the look's next value (`look.update`, stored soon). False when it couldn't be recorded. */
  private record(): boolean {
    const shown = this.shown;
    if (!shown || !shown.content) return true;
    const content = shown.content, editor = this.deps.document.export();
    let written: ReturnType<typeof lookStored>;
    try { written = lookStored(content, editor, this.deps.model); }
    catch (error) { this.deps.report?.(error); this.unrecorded = true; return false; }
    if (!written) return true;
    const update = shown.session.update({ parts: written.parts, memory: written.memory }, { store: "soon" });
    if (!update.ok) { this.unrecorded = true; this.blocked(); return false; }
    this.unrecorded = false;
    shown.content = { look: written.look, memory: written.lookMemory, state: editor };
    return true;
  }
  /**
   * Make sure the shown look's latest state is recorded and stored now (a copy, a snapshot, Save version, Check, Build, closing the page).
   * False when it couldn't be recorded (the look is being restored, or this window may not write): it stays in the document and is
   * recorded with the next change.
   */
  commit(): boolean {
    // A change of the Undo history alone still waiting for the end of the turn (a settled run's discarded checkpoint) is recorded now,
    // with the look it belongs to, before another look is shown.
    const pending = this.unrecorded || this.historyWaits;
    this.historyWaits = false;
    const ok = !pending || this.record();
    this.deps.store?.();
    return ok;
  }
  /** Whether a change of the shown look couldn't be recorded yet. */
  dirty(): boolean { return this.unrecorded; }

  private close() {
    const shown = this.shown;
    if (!shown) return;
    this.shown = null;
    shown.unsubscribe();
    void shown.session.release().catch(error => this.deps.report?.(error));
  }
  dispose() {
    this.commit();
    this.close();
    this.unsubscribe();
    this.listeners.clear();
  }
}
