/** Editable data lifetime over LookSessions. Panels share a document, selection, in-progress edits and writer by LookRef.
 * No inspector acquisition reaches a renderer, a head or a raster scheduler. The drawn input is a separate compatibility attachment.
 */
import { createAuthoringEditing, type StudioComposition, type createTrustedAuthoringCore } from "../app/trusted-authoring-core";
import type { StudioApplication } from "../app/studio-application";
import type { WorkspaceState } from "../app/workspace/workspace-state";
import type { DocumentOutbox } from "../platform/core/document-outbox";
import { lookScope } from "../platform/core/history-service";
import { lookRef, type LookRef } from "./collection-documents";
import { LookEditor, lookContent } from "./look-editor";
import type { LookSessions } from "./look-sessions";
import type { CollectionOwner } from "./collection-owner";
import type { Recipe } from "../engines/layered-makeup/recipe";

type Core = ReturnType<typeof createTrustedAuthoringCore>;
export type LookEditContext = ReturnType<typeof createAuthoringEditing> & { readonly app: StudioApplication; readonly writer: LookEditor; readonly ref: LookRef };
type Entry = { context: LookEditContext; wants: number };
export type LookEditHandle = { readonly context: LookEditContext; release(): void };

export class LookEditContexts {
  private readonly entries = new Map<string, Entry>();
  private readonly off: () => void;
  constructor(private readonly deps: {
    core: Core; composition: StudioComposition; workspace: Pick<WorkspaceState, "glitterChoices">;
    owner: CollectionOwner; sessions: LookSessions; outbox: DocumentOutbox;
    resetStack(ref: LookRef, previous: Recipe): void;
    note?(text: string): void; report?(error: unknown): void; shown?(ref: LookRef): void;
  }) {
    // A failed write retains its sole document/writer even after the final requester leaves. Retry at the owner's next event.
    this.off = deps.outbox.subscribe(() => {
      for (const [key, entry] of this.entries) if (!entry.wants && entry.context.writer.dirty()) {
        queueMicrotask(() => { if (this.entries.get(key) === entry && !entry.wants) this.retire(key, entry); });
      }
    });
  }
  acquire(ref: LookRef, signal: AbortSignal): LookEditHandle | undefined {
    if (signal.aborted) return undefined;
    const key = lookScope(ref);
    let entry = this.entries.get(key);
    if (!entry) {
      const view = this.deps.owner.look(ref);
      if (!view || !this.deps.owner.collection(ref.collection)) return undefined;
      const seed = view.state === "live" ? lookContent(view, this.deps.composition.documents).state : undefined;
      // The empty document is only an input seed; LookEditor immediately displays the removed state and blocks it.
      const state = seed ?? this.deps.core.document.export();
      const editing = createAuthoringEditing({ ...this.deps.workspace, ...state }, {
        history: this.deps.core.history, scope: key, selectedCollection: () => ref.look,
        resetStack: previous => this.deps.resetStack(ref, previous),
      }, this.deps.composition);
      const app = this.deps.core.app.fork({ ...editing, collection: undefined, files: undefined,
        characterContext: undefined, characterDetails: undefined, savedV: undefined });
      const writer = new LookEditor({ model: this.deps.composition.documents, sessions: this.deps.sessions, document: editing.document,
        store: () => this.deps.outbox.store(), restoring: target => this.deps.outbox.recovering(lookRef(target)),
        note: this.deps.note, report: this.deps.report, shown: () => this.deps.shown?.(ref) });
      if (!writer.show(ref)) { writer.dispose(); app.dispose(); editing.document.dispose(); return undefined; }
      entry = { wants: 0, context: { ...editing, app, writer, ref: { ...ref } } };
      this.entries.set(key, entry);
    }
    entry.wants++;
    const held = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; signal.removeEventListener("abort", release);
      if (!--held.wants) this.retire(key, held);
    };
    signal.addEventListener("abort", release, { once: true });
    return { context: held.context, release };
  }
  private retire(key: string, entry: Entry) {
    const { app, writer, document } = entry.context;
    app.settleEdits();
    if (!writer.commit()) return;
    this.entries.delete(key);
    writer.dispose(); app.dispose(); document.dispose();
  }
  commit(): boolean {
    let ok = true;
    for (const entry of this.entries.values()) { entry.context.app.settleEdits(); if (!entry.context.writer.commit()) ok = false; }
    return ok;
  }
  held(): readonly { ref: LookRef; wants: number; dirty: boolean }[] {
    return [...this.entries.values()].map(({ context, wants }) => ({ ref: { ...context.ref }, wants, dirty: context.writer.dirty() }));
  }
  dispose() { this.commit(); this.off(); for (const [key, entry] of this.entries) { entry.wants = 0; this.retire(key, entry); } }
}
