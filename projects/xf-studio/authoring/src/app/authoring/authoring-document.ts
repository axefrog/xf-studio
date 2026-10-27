/** A look's state and one shared history, independent of any feature's document or editor. */
import type { HistoryParts, LookHistoryData } from "../../platform/api/history";
import type { ReadonlyDeep } from "../../platform/api/read-only";
import { createHistoryService, lookScope, type HistoryScope, type HistoryService } from "../../platform/core/history-service";
import { emptyLookHistory, LookHistory } from "../../platform/core/look-history";
import { LiveFeatures, type LiveFeatureChange, type LiveFeatureState } from "../../platform/core/live-features";

export type DocumentState = { features?: Record<string, LiveFeatureState>; history?: LookHistoryData; locked?: string };
export type DocumentChange = "part" | "history" | "restore" | "access";
export type DocumentHistoryOptions = { signal: AbortSignal; history?: HistoryService; scope?: string; activate?: boolean };
export const LOCAL_LOOK_SCOPE = lookScope({ collection: "local", look: "local" });

export class AuthoringDocument {
  readonly features: LiveFeatures;
  private scope: HistoryScope;
  private readonly service: HistoryService;
  private readonly parts: HistoryParts;
  private readonly listeners = new Set<(change: DocumentChange, features?: LiveFeatureChange) => void>();
  private readonly replacingListeners = new Set<() => void>();
  private revision = 0;
  private restoring = false;
  private lockedReason?: string;
  private blockedReason?: string;
  constructor(initial: DocumentState, documents: { features: LiveFeatures; parts: HistoryParts },
    private readonly options: DocumentHistoryOptions) {
    this.alive();
    this.features = documents.features; this.parts = documents.parts;
    const state = this.features.prepare(structuredClone(initial.features)), stack = this.stack(initial.history);
    this.features.loadPrepared(state); this.lockedReason = initial.locked;
    this.service = options.history ?? createHistoryService();
    this.scope = this.open(options.scope ?? LOCAL_LOOK_SCOPE, stack);
    this.scope.replace(stack, options.activate !== false);
    const off = this.features.subscribe(change => {
      this.revision++;
      if (!this.restoring) this.notify("part", change);
    });
    options.signal.addEventListener("abort", () => {
      this.replacing(); off(); this.service.close(this.scope.id);
      this.listeners.clear(); this.replacingListeners.clear();
    }, { once: true });
  }
  private alive() { if (this.options.signal.aborted) throw Error("This look's editing context has ended."); }
  private stack(data: LookHistoryData = emptyLookHistory()): LookHistory {
    const stack = LookHistory.fromData(this.parts, data);
    if (stack.features().some(feature => !this.features.has(feature)))
      throw Error("This look's Undo history changes parts this editor cannot show.");
    return stack;
  }
  private open(id: string, stack: LookHistory) {
    return this.service.open(id, {
      read: feature => this.features.read(feature),
      apply: values => {
        if (Object.keys(values).some(feature => !this.features.has(feature))) return false;
        let prepared: ReturnType<LiveFeatures["prepareRestore"]>;
        try { prepared = this.features.prepareRestore(values); } catch { return false; }
        this.features.restorePrepared(prepared);
        return true;
      },
      revision: () => this.revision, fingerprint: keys => this.features.content(keys),
      unavailable: () => this.locked,
    }, { stack, changed: () => { if (!this.restoring) this.notify("history"); } });
  }
  get history(): HistoryScope { return this.scope; }
  get scopeId() { return this.scope.id; }
  get locked() { return this.lockedReason ?? this.blockedReason; }
  setBlocked(reason: string | undefined) { if (reason !== this.blockedReason) { this.blockedReason = reason; this.notify("access"); } }
  /** In-place feature edits announce their content change explicitly, just as applied results do. */
  changed(features: readonly string[] = this.features.features()) {
    this.revision++; this.notify("part", { kind: "set", features: [...features] });
  }
  subscribe(listener: (change: DocumentChange, features?: LiveFeatureChange) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onReplacing(listener: () => void) { this.replacingListeners.add(listener); return () => this.replacingListeners.delete(listener); }
  replacing() { for (const listener of [...this.replacingListeners]) listener(); }
  private notify(change: DocumentChange, features?: LiveFeatureChange) { for (const listener of this.listeners) listener(change, features); }
  export() { this.alive(); return { features: this.features.export(), history: this.scope.data() }; }
  snapshot(): ReadonlyDeep<ReturnType<AuthoringDocument["export"]>> { return this.export(); }
  restore(value: DocumentState, scope = this.scope.id) {
    this.alive();
    const state = this.features.prepare(structuredClone(value.features)), stack = this.stack(value.history);
    this.replacing();
    this.restoring = true;
    try {
      this.features.loadPrepared(state); this.lockedReason = value.locked; this.revision++;
      if (scope !== this.scope.id) { this.service.close(this.scope.id); this.scope = this.open(scope, stack); }
      this.scope.replace(stack, this.options.activate !== false);
    } finally { this.restoring = false; }
    this.notify("restore");
  }
}
