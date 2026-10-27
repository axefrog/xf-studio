/** One editable look per key. Requesters share its state, registered editors, history and persistence writer. */
import { createAuthoringEditing, type AuthoringEditing, type EditingComposition } from "../app/trusted-authoring-core";
import type { DocumentOutbox } from "../platform/core/document-outbox";
import { lookScope, type HistoryService } from "../platform/core/history-service";
import { lookRef, type LookRef } from "./collection-documents";
import { LookEditor, lookContent } from "./look-editor";
import type { LookSessions } from "./look-sessions";
import type { CollectionOwner } from "./collection-owner";

export type LookEditContext<T extends object = object> = Omit<AuthoringEditing, keyof T> & T & {
  readonly lookDocument: AuthoringEditing["document"]; readonly writer: LookEditor; readonly ref: LookRef };
type Entry<T extends object> = { context: LookEditContext<T>; wants: number; life: AbortController };
export type LookEditHandle<T extends object = object> = { readonly context: LookEditContext<T>; release(): void };
export type LookEditContextDeps<T extends object = object> = {
  composition: EditingComposition; history: HistoryService;
  owner: CollectionOwner; sessions: LookSessions; outbox: DocumentOutbox;
  /** Temporary application projections attach to the same owner; the core never interprets them. */
  attach?(editing: AuthoringEditing, ref: LookRef): T;
  note?(text: string): void; report?(error: unknown): void; shown?(ref: LookRef): void;
};

export class LookEditContexts<T extends object = object> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly off: () => void;
  private closed = false;
  constructor(private readonly deps: LookEditContextDeps<T>) {
    this.off = deps.outbox.subscribe(() => {
      for (const [key, entry] of this.entries) if (!entry.wants) {
        queueMicrotask(() => { if (this.entries.get(key) === entry && !entry.wants) this.retire(key, entry); });
      }
    });
  }
  acquire(ref: LookRef, signal: AbortSignal): LookEditHandle<T> | undefined {
    if (this.closed || signal.aborted) return undefined;
    const key = lookScope(ref);
    let entry = this.entries.get(key);
    if (!entry) {
      const view = this.deps.owner.look(ref);
      if (!view || !this.deps.owner.collection(ref.collection)) return undefined;
      let state: Parameters<typeof createAuthoringEditing>[0];
      try { state = view.state === "live" ? lookContent(view, this.deps.composition.documents).state : {}; }
      catch (error) { this.deps.report?.(error); return undefined; }
      const life = new AbortController();
      let writer: LookEditor | undefined;
      try {
        const editing = createAuthoringEditing(state, { signal: life.signal, history: this.deps.history,
          scope: key, look: ref, activate: false }, this.deps.composition);
        const attachment = this.deps.attach?.(editing, ref);
        writer = new LookEditor({ model: this.deps.composition.documents, sessions: this.deps.sessions, document: editing.document,
          store: () => this.deps.outbox.store(), restoring: target => this.deps.outbox.recovering(lookRef(target)),
          note: this.deps.note, report: this.deps.report, shown: () => this.deps.shown?.(ref) });
        if (!writer.show(ref) || signal.aborted || this.closed) { writer.dispose(); life.abort(); return undefined; }
        entry = { wants: 0, life, context: { ...editing, ...attachment, writer, ref: Object.freeze({ ...ref }) } as unknown as LookEditContext<T> };
        this.entries.set(key, entry);
      } catch (error) { try { writer?.dispose(); } finally { life.abort(); } throw error; }
    }
    entry.wants++;
    const held = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; signal.removeEventListener("abort", release);
      if (this.entries.get(key) === held && held.wants && !--held.wants) this.retire(key, held);
    };
    signal.addEventListener("abort", release, { once: true });
    return { context: held.context, release };
  }
  private retire(key: string, entry: Entry<T>) {
    if (this.entries.get(key) !== entry) return;
    const { writer, lookDocument } = entry.context;
    lookDocument.replacing();
    if (!writer.commit()) return;
    this.entries.delete(key);
    try { writer.dispose(); } finally { entry.life.abort(); }
    if (this.closed && !this.entries.size) this.off();
  }
  commit(): boolean {
    let ok = true;
    for (const [key, entry] of this.entries) {
      if (!entry.context.writer.commit()) ok = false;
      else if (!entry.wants) this.retire(key, entry);
    }
    return ok;
  }
  settleEdits() { for (const entry of this.entries.values()) entry.context.lookDocument.replacing(); }
  held(): readonly { ref: LookRef; wants: number; dirty: boolean }[] {
    return [...this.entries.values()].map(({ context, wants }) => ({ ref: { ...context.ref }, wants, dirty: context.writer.dirty() }));
  }
  dispose() {
    this.closed = true;
    this.settleEdits();
    for (const [key, entry] of this.entries) { entry.wants = 0; this.retire(key, entry); }
    // Retained dirty contexts keep the retry subscription until their last successful write.
    if (!this.entries.size) this.off();
  }
}
