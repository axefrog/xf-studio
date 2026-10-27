/** A look's state and one shared history, independent of any feature's document or editor. */
import type { HistoryParts, LookHistoryData } from "../../platform/api/history";
import type { ReadonlyDeep } from "../../platform/api/read-only";
import { createHistoryService, lookScope, type HistoryScope, type HistoryService } from "../../platform/core/history-service";
import { emptyLookHistory, LookHistory } from "../../platform/core/look-history";
import { LiveFeatures, type LiveFeatureChange, type LiveFeatureState } from "../../platform/core/live-features";
import { notifyAll } from "../../platform/core/listeners";

export type DocumentState = { features?: Record<string, LiveFeatureState>; history?: LookHistoryData; locked?: string };
export type DocumentChange = "part" | "history" | "restore" | "access";
export type DocumentHistoryOptions = { signal: AbortSignal; history?: HistoryService; scope?: string; activate?: boolean };
export const LOCAL_LOOK_SCOPE = lookScope({ collection: "local", look: "local" });
const ENDED = "This look's editing context has ended.";

export class AuthoringDocument {
  readonly features: LiveFeatures;
  private scope: HistoryScope;
  private readonly service: HistoryService;
  private readonly parts: HistoryParts;
  private readonly listeners = new Set<(change: DocumentChange, features?: LiveFeatureChange) => void>();
  private readonly replacingListeners = new Set<() => void>();
  private revision = 0;
  private inPlaceRevision = 0;
  private restoring = false;
  private lockedReason?: string;
  private blockedReason?: string;
  constructor(initial: DocumentState, documents: { features: LiveFeatures; parts: HistoryParts },
    private readonly options: DocumentHistoryOptions) {
    this.alive();
    this.features = documents.features; this.parts = documents.parts;
    const state = this.features.prepare(structuredClone(initial.features)), stack = this.stack(initial.history);
    this.service = options.history ?? createHistoryService();
    let off = () => {}, released = false;
    const release = () => {
      if (released) return;
      released = true; options.signal.removeEventListener("abort", release); off();
      try { notifyAll(this.replacingListeners); }
      finally {
        try { if (this.scope && this.service.scope(this.scope.id) === this.scope) this.service.close(this.scope.id); }
        finally { this.listeners.clear(); this.replacingListeners.clear(); }
      }
    };
    // Both loading parts and replacing history publish synchronously: cleanup must already be installed.
    options.signal.addEventListener("abort", release, { once: true });
    try {
      this.alive(); this.features.loadPrepared(state); this.lockedReason = initial.locked; this.alive();
      this.scope = this.open(options.scope ?? LOCAL_LOOK_SCOPE, stack);
      this.scope.replace(stack, options.activate !== false); this.alive();
      off = this.features.subscribe(change => {
        if (options.signal.aborted) return;
        this.revision++;
        if (!this.restoring) this.notify("part", change);
      });
    } catch (error) { release(); throw error; }
  }
  private alive() { if (this.options.signal.aborted) throw Error(ENDED); }
  private stack(data: LookHistoryData = emptyLookHistory()): LookHistory {
    const stack = LookHistory.fromData(this.parts, data);
    if (stack.features().some(feature => !this.features.has(feature)))
      throw Error("This look's Undo history changes parts this editor cannot show.");
    return stack;
  }
  private open(id: string, stack: LookHistory) {
    let publish: (() => void) | undefined;
    return this.service.open(id, {
      read: feature => { this.alive(); return this.features.read(feature); },
      apply: values => {
        if (this.options.signal.aborted || Object.keys(values).some(feature => !this.features.has(feature))) return false;
        let prepared: ReturnType<LiveFeatures["prepareRestore"]>;
        try { prepared = this.features.prepareRestore(values); } catch { return false; }
        if (this.options.signal.aborted) return false;
        publish = this.features.restorePrepared(prepared);
        return true;
      },
      settled: () => { const pending = publish; publish = undefined; if (!this.options.signal.aborted) pending?.(); },
      // Retirement can still read history metadata, but never a released look's content.
      revision: () => this.revision, fingerprint: keys => this.options.signal.aborted ? "" : this.features.content(keys),
      unavailable: () => this.locked,
    }, { stack, changed: () => { if (!this.options.signal.aborted && !this.restoring) this.notify("history"); } });
  }
  get history(): HistoryScope { this.alive(); return this.scope; }
  get version() { return this.features.partVersion + this.inPlaceRevision; }
  get scopeId() { return this.scope.id; }
  get locked() { return this.options.signal.aborted ? ENDED : this.lockedReason ?? this.blockedReason; }
  setBlocked(reason: string | undefined) { this.alive(); if (reason !== this.blockedReason) { this.blockedReason = reason; this.notify("access"); } }
  /** In-place feature edits announce their content change explicitly, just as applied results do. */
  changed(features: readonly string[] = this.features.features()) {
    this.alive(); this.revision++; if (features.length) this.inPlaceRevision++;
    this.notify("part", { kind: "set", features: [...features] });
  }
  subscribe(listener: (change: DocumentChange, features?: LiveFeatureChange) => void) { this.alive(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onReplacing(listener: () => void) { this.alive(); this.replacingListeners.add(listener); return () => this.replacingListeners.delete(listener); }
  replacing() { this.alive(); notifyAll(this.replacingListeners); }
  private notify(change: DocumentChange, features?: LiveFeatureChange) { notifyAll(this.listeners, change, features); }
  export() { this.alive(); return { features: this.features.export(), history: this.scope.data() }; }
  snapshot(): ReadonlyDeep<ReturnType<AuthoringDocument["export"]>> { return this.export(); }
  restore(value: DocumentState, scope = this.scope.id) {
    this.alive();
    const state = this.features.prepare(structuredClone(value.features)), stack = this.stack(value.history);
    this.replacing(); this.alive();
    this.restoring = true;
    try {
      this.features.loadPrepared(state); this.lockedReason = value.locked; this.revision++; this.alive();
      if (scope !== this.scope.id) { this.service.close(this.scope.id); this.alive(); this.scope = this.open(scope, stack); }
      this.scope.replace(stack, this.options.activate !== false); this.alive();
    } finally { this.restoring = false; }
    this.notify("restore");
  }
}
