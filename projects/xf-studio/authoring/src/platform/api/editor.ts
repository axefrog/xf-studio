/**
 * Per-feature editor construction (CORE-03 slices 2–4). The look owner keeps the parts in
 * LiveFeatures and opens their one HistoryService scope; an editor observes only its own state.
 * Actions still use the module's action table. This is neither a document nor another registry.
 */
import type { HistoryEntryId, HistoryLabel, HistoryScopeId } from "./history";
import type { ReadonlyDeep } from "./read-only";

/** Detached plain data from one FeatureDocument. An absent part stays absent. */
export type FeatureEditorState = { readonly part?: unknown; readonly editor: unknown };

export interface FeatureEditorHost {
  /** Fixed destination for this editor's whole lifetime; never follows focus. */
  readonly look: { readonly collection: string; readonly look: string };
  /** The existing look-wide history scope, shared by all its feature editors. */
  readonly scope: HistoryScopeId;
  /** The look-context owner aborts this before releasing its state and history target. */
  readonly signal: AbortSignal;
  /** A detached snapshot of this feature's part and per-look editor memory, using its codecs. */
  snapshot(): FeatureEditorState;
  /** Live publication and transaction ports, scoped to this feature by the look owner. */
  readonly editing?: FeatureEditHost;
  /** Observe edits, restores and selection changes; the host removes the listener on abort. */
  subscribe(listener: () => void): void;
}

/**
 * A feature-owned projection (geometry, selection, etc.). The core carries it opaquely; only
 * the feature interprets S. Every snapshot is detached plain data, never live document objects.
 * Construction must reject an already-aborted host. On abort the editor releases its own
 * subscriptions/caches and refuses further reads; there is no second disposal protocol.
 */
export interface FeatureEditor<S = unknown> {
  snapshot(): ReadonlyDeep<S>;
}

/** Registered on the feature itself; PartRegistry exposes that same registration to the core. */
export type FeatureEditorFactory = (host: FeatureEditorHost) => FeatureEditor;

/** Mutable ports are available only to the registered editor, never to a presentation snapshot. */
export interface FeatureEditHost {
  state(): { part: unknown; editor: unknown };
  set(part: unknown, editor: unknown): void;
  changed(): void;
  readonly history: {
    readonly id: HistoryScopeId;
    checkpoint(keys: readonly string[], label?: HistoryLabel): HistoryEntryId | undefined;
    declareSelectionChange(keys: readonly string[]): void;
    begin(keys: readonly string[], policy: { empty: "unchanged" | "same-content"; revert: "changed" | "content-differs" },
      options?: { present?: () => boolean }): { readonly changed: boolean; applied(changed: boolean, label: () => HistoryLabel): void; commit(): void; cancel(): void };
  };
  action(kind: string): unknown;
  readonly gestures?: unknown;
  readonly memory?: unknown;
  key(): string;
  newId(): string;
  onReplacing(listener: () => void): void;
  observeReplay(replay: { editor(previous: FeatureEditorState, part: unknown): unknown; restored(previous: unknown): void }): void;
}
