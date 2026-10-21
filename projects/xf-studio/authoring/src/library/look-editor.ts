/**
 * The live editor document over one look's session (profiles design §7, `collection-workspace.ts`' one live look, steps 1–4): the
 * authoring document shows the look its scene names (a `LookRef`), reads it from the look's working copy and writes it back through the
 * look's session (`look.update`, one document, coalescing in the outbox). Nothing here is "the" look: the scene says which look is shown,
 * and showing another one writes the previous one's changes first, lets its session go and opens the next one's.
 *
 * - **Reading.** A look working copy holds its parts and memory as stored; they are read through the part registry, and a look holding a
 *   newer build's data is shown locked (kept exactly as it came, never written from here).
 * - **Writing.** Every change of the document (an edit, a selection, an Undo) is written shortly after it settles (`delayMs`), and at once
 *   whenever something needs the look as it is now (`commit`: a copy, a snapshot, Save version, closing the page). Only a change is
 *   written: the look's stored form is compared with what was written last.
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

/** How long after the document settles its look is written. */
export const LOOK_WRITE_DELAY_MS = 250;
export const RESTORING_LOOK = "This look is still being restored from your last session. It can be changed again in a moment.";
export const CHANGED_ELSEWHERE = "Changed in another window. Undo starts here.";
/** The scope the document is in while its scene shows no look (its collection's last preset was removed): nothing in it can be edited. */
export const NO_LOOK_SCOPE = lookScope({ collection: "none", look: "none" });

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
  readonly delayMs?: number;
  readonly schedule?: (run: () => void, ms: number) => () => void;
  /**
   * Registers a call made just before another window's newer values are taken (`DocumentOutbox.beforeExternal`): the edits waiting for
   * the write delay are recorded then, so they meet the other window's version as a conflict and are never replaced by it.
   */
  readonly beforeExternal?: (record: () => void) => () => void;
};

type Shown = { ref: LookRef; session: LookSession; content: LookContent; written: string; unsubscribe: () => void };

export class LookEditor {
  private shown: Shown | null = null;
  /** The document shows no look (and is empty). */
  private empty = false;
  private cancel: (() => void) | null = null;
  private applying = false;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private readonly unregister: () => void;

  constructor(private readonly deps: LookEditorDeps) {
    this.unsubscribe = deps.document.subscribe(change => {
      if (this.applying || !this.shown || change === "restore" || change === "access") return;
      this.request();
    });
    // The write delay only coalesces: before another window's version is taken, what waits is recorded.
    this.unregister = deps.beforeExternal?.(() => { if (this.cancel) this.commit(); }) ?? (() => {});
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
    let content: LookContent;
    try { content = lookContent(view, this.deps.model); }
    catch (error) { void session.release(); this.deps.report?.(error); this.changed(); return false; }
    const shown: Shown = { ref: { ...ref }, session, content, written: "", unsubscribe: () => {} };
    this.shown = shown;
    shown.written = this.stored(content, content.state)?.key ?? "";
    shown.unsubscribe = session.subscribe(event => {
      if (this.shown !== shown) return;
      // A change taken from elsewhere (or a resolution that kept theirs): the document shows it, and its Undo starts there.
      if (event.kind === "elsewhere" || event.kind === "resolved") this.reload(shown);
      this.blocked();
      this.changed();
    });
    this.display(content.state, lookScope(ref));
    this.blocked();
    this.changed();
    return true;
  }
  private display(state: DocumentState, scope?: string) {
    this.applying = true;
    try { this.deps.document.restore(state, scope); } finally { this.applying = false; }
    this.deps.shown?.();
  }
  /** The look as the library holds it now replaces what the document shows, when it differs from what this window wrote. */
  private reload(shown: Shown) {
    const view = shown.session.look();
    if (!view || view.state !== "live") return;
    let content: LookContent;
    try { content = lookContent(view, this.deps.model); } catch (error) { this.deps.report?.(error); return; }
    const key = this.stored(content, content.state)?.key ?? "";
    if (key === shown.written) return;
    // Nothing is waiting here: edits are recorded before another window's version is taken (`beforeExternal`), and a resolution
    // (Use theirs, or Keep both, which made a copy of mine) is the person's choice.
    this.cancel?.(); this.cancel = null;
    shown.content = content; shown.written = key;
    this.display(content.state);
    this.deps.document.history.clear();
    this.deps.note?.(CHANGED_ELSEWHERE);
  }
  /** The recovery gate: while the shown look is being restored, the document refuses edits with the reason. */
  private blocked() {
    const ref = this.shown?.ref;
    this.deps.document.setBlocked(ref && this.deps.restoring?.(ref) ? RESTORING_LOOK : undefined);
  }
  /** The stored form of a look's content with the document's state written in, and its comparison key. */
  private stored(content: Pick<LookContent, "look" | "memory">, editor: DocumentState) {
    const written = lookStored(content, editor, this.deps.model);
    return written && { ...written, key: JSON.stringify([written.parts, written.memory]) };
  }

  private request() {
    this.cancel?.();
    const schedule = this.deps.schedule ?? ((run, ms) => { const timer = setTimeout(run, ms); return () => clearTimeout(timer); });
    this.cancel = schedule(() => { this.cancel = null; this.commit(); }, this.deps.delayMs ?? LOOK_WRITE_DELAY_MS);
  }
  /**
   * Write the shown look's changes now (nothing when they are written already). False when they couldn't be recorded (the look is being
   * restored, was removed, or this window may not write): they stay in the document and are written with the next change.
   */
  commit(): boolean {
    this.cancel?.(); this.cancel = null;
    const shown = this.shown;
    if (!shown) return true;
    const editor = this.deps.document.export();
    let written: ReturnType<LookEditor["stored"]>;
    try { written = this.stored(shown.content, editor); }
    catch (error) { this.deps.report?.(error); return false; }
    if (!written || written.key === shown.written) return true;
    const update = shown.session.update({ parts: written.parts, memory: written.memory });
    if (!update.ok) { this.blocked(); return false; }
    shown.content = { look: written.look, memory: written.lookMemory, state: editor };
    shown.written = written.key;
    return true;
  }
  /** Whether the shown look has changes not yet written. */
  dirty(): boolean { return this.cancel !== null; }

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
    this.unregister();
    this.listeners.clear();
  }
}
