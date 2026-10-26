/**
 * The history service (feature-module platform §3): every Undo history of the session, as scoped stacks over one stack type
 * (`HistoryStack`). DOM-free; imports only the platform API and the platform's own history pieces.
 *
 * - **Scopes** (profiles design §3.7). `look:<collection>/<look>` is one look's history (its stack is persisted with the look's
 *   working copy as `xfs/look-history-1`); `character:<id>` is one V's creator choices, Clothing and own makeup (session-only);
 *   `view:<profile>` is a profile session's View and lighting history; `doc:<id>` is one experiment document's (Hair Lab's grooms). Each scope's
 *   target (`HistoryTarget`) owns its state: the scope reads and applies values through it and owns the steps, Redo
 *   validity, jumps, coalescing and transactions.
 * - **Redo validity** (CORE-46). Redo stays valid only while the top step is the one the last Undo, Redo or jump left and the
 *   target's content is what it left (its `revision`, else its `fingerprint`); an open transaction's checkpoint hides Redo
 *   and cancelling it brings Redo back. Otherwise the undone steps are discarded at the next move.
 * - **Moves apply once.** Undo, Redo and a jump over several steps apply the values they reach as one change. A target that
 *   refuses them (an inconsistent replay, CORE-94) leaves target, Undo and Redo unchanged so the owner can repair or retry.
 * - **Transactions.** `begin` opens the platform's `HistoryTransaction` over the scope: one checkpoint, labelled by the first
 *   change, discarded when empty, reverted on cancel without Redo (CORE-42).
 * - **The editing context** (§3.7) is the focus service's (`focus`, platform/core/focus.ts), never this service's: a step kept in a look's
 *   or a V's history (an edit, an Undo, a look shown again) makes that scope the editing context there, and an experiment's document
 *   takes it when it records or moves. Undo and Redo act on the scope they name; the input layer names it, from the editing contexts
 *   newest first, through `acting`: the first that can act now (an open scope, or a document its experiment offers). There is no other
 *   fallback: with none, Undo is unavailable. The View and lighting history has commands of its own (`view.undo`, `view.redo`); its
 *   owner, the profile session, makes it the editing context when it records a tab operation (`ProfileSessions`).
 * - **One move at a time.** An Undo, Redo or jump asked for while a move is settling (from a listener) waits and runs once it has
 *   settled, so each move applies and publishes whole.
 * - **Documents.** `documents` is the `DocumentHistory` API over the `doc:*` scopes: a step keeps the document's value after it
 *   by reference (no copy, whatever its size), and moving hands back the value to restore.
 */
import type { Capability } from "../api/capability";
import { HISTORY_LIMIT, HISTORY_START_ID, UNKNOWN_HISTORY_LABEL, type DocumentHistory, type HistoryMove, type HistoryEntryId,
  type HistoryJumpPlan, type HistoryLabel, type HistoryParticipant, type HistoryParts, type HistoryScope as StoredScope,
  type HistoryScopeId, type HistorySnapshot, type HistoryState, type HistoryStep, type HistoryTarget, type LookHistoryData } from "../api/history";
import { HistoryStack, ReferenceStore, WHOLE_VALUES, type LookReader } from "./history-stack";
import { HistoryTransaction, type TransactionHost, type TransactionPolicy } from "./history-transaction";
import { FocusService } from "./focus";
import { notifyAll } from "./listeners";

const VIEW_PREFIX = "view:";
/** A profile session's View and lighting history (`view:<profile>`, §3.7): its views and lighting, never a look's. */
export const viewScope = (profile: string) => `${VIEW_PREFIX}${profile}`;
/** The View and lighting history of a view graph no profile session holds (fixtures and tools). */
export const LOCAL_VIEW_SCOPE = viewScope("local");
const DOCUMENT_PREFIX = "doc:";
export const LOOK_SCOPE_PREFIX = "look:";
const CHARACTER_PREFIX = "character:";
/** One look's history scope (`look:<collection>/<look>`, §3.7). */
export const lookScope = (ref: { readonly collection: string; readonly look: string }) => `${LOOK_SCOPE_PREFIX}${ref.collection}/${ref.look}`;
export const isLookScope = (id: string) => id.startsWith(LOOK_SCOPE_PREFIX);
/** Scopes whose kept steps make them the editing context: looks and Vs (documents take it through their own focus). */
const editing = (id: string) => id.startsWith(LOOK_SCOPE_PREFIX) || id.startsWith(CHARACTER_PREFIX);

export type ScopeOptions = {
  /** Steps kept (default `HISTORY_LIMIT`). */
  limit?: number;
  /** The scope's steps to start from (a restored look's, already validated). Default: an empty stack. */
  stack?: HistoryStack;
  /** How values split into chunks; without it values are kept whole and by reference (a session-only scope). */
  parts?: HistoryParts;
  /** The timeline's start ID (default `HISTORY_START_ID`) and each step's ID there (default `step-<id>`). */
  startId?: string;
  stepId?(id: HistoryEntryId): string;
  /** Global Undo and Redo while the scope is focused, when it moves otherwise than through its own steps (an experiment's participant). */
  command?(action: HistoryMove): boolean;
  capability?(action: HistoryMove): Capability;
  /** What Undo and Redo would change next, when the scope words it otherwise (a document's: its timeline steps). */
  state?(timeline: HistorySnapshot): HistoryState;
  /** The name of what the scope's steps change (the History panel's "Changes to …"), when it is not the look. */
  documentLabel?(): string | undefined;
  /** Called after every change to the scope's steps or Redo. */
  changed?(): void;
};
export type CheckpointFlags = {
  /** Joins the top step while it is unsealed under the same key (CORE-95). */
  coalesce?: string;
  /** Reads the values as they were before the change, when the target already shows the change. */
  read?: LookReader;
  /** `look`: one transaction over several parts (stored with the look's history). */
  scope?: StoredScope;
  /** Whether the step records its time (default true). */
  timed?: boolean;
  /** Add a step even when the top step holds the same values (a document records every edit). */
  distinct?: boolean;
};

export interface HistoryScope {
  readonly id: HistoryScopeId;
  /** Record `keys` as they are now (before a change); the new step's ID, or undefined when no step was added. */
  checkpoint(keys: readonly string[], label?: HistoryLabel, options?: CheckpointFlags): HistoryEntryId | undefined;
  relabel(step: HistoryEntryId, label: HistoryLabel): void;
  /** Remove `step` only while it is the top step (an empty transaction's checkpoint). */
  discard(step: HistoryEntryId): boolean;
  /** End the current continuous edit (a slider was released). */
  seal(): void;
  /** Drop every step and Redo (a change the history does not hold would leave them naming what no longer exists). */
  clear(): void;
  /** Open a transaction over `keys`: one step for a gesture's frames or a control's edits. */
  begin(keys: readonly string[], policy: TransactionPolicy, options?: { present?: () => boolean; label?: HistoryLabel; scope?: StoredScope }):
    HistoryTransaction<HistoryEntryId>;
  /** Restore a cancelled transaction's start without Redo: its own `step` comes off; without one the top step's values are shown. */
  revertTransaction(step: HistoryEntryId | undefined): boolean;
  undo(): boolean;
  redo(): boolean;
  /** Go to the state right after step `stepId` (or the start) as one change. */
  jumpTo(stepId: string): boolean;
  plan(stepId: string): HistoryJumpPlan | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Global Undo, Redo or a jump while this scope is focused, and whether it is available. */
  command(action: HistoryMove): boolean;
  capability(action: HistoryMove): Capability;
  state(): HistoryState;
  timeline(): HistorySnapshot;
  /** The step the next Undo reverts, if any. */
  top(): HistoryEntryId | undefined;
  /** IDs retained by Undo, Redo or a displaced limit entry, for owners' session-only replay metadata. */
  held(): Set<HistoryEntryId>;
  /** Whether checkpoints record (false inside `withoutHistory`). */
  readonly recording: boolean;
  withoutHistory<T>(apply: () => T): T;
  /** Replace the steps (a preset switch or restore); Redo goes with them. */
  replace(stack: HistoryStack): void;
  readonly trimmed: boolean;
  /** Plain data of the kept steps (only the look's is persisted). */
  data(): LookHistoryData;
  stats(): { chunks: number; units: number };
}

export interface HistoryService {
  /** Open (or reopen, replacing it) a scope over `target`. */
  open(id: HistoryScopeId, target: HistoryTarget, options?: ScopeOptions): HistoryScope;
  close(id: HistoryScopeId): void;
  scope(id: HistoryScopeId): HistoryScope | undefined;
  /** The focus service whose editing context this service records into (§3.7): steps kept in a look's or a V's scope, documents' focus. */
  readonly focus: FocusService;
  /** The first of `scopes` (editing contexts, newest first) that can act now: an open scope, or a document its experiment offers. */
  acting(scopes: readonly HistoryScopeId[]): HistoryScope | null;
  /** The experiments' document histories: the existing API over `doc:*` scopes. */
  readonly documents: DocumentHistory;
  /** The documents an experiment currently offers to global Undo (`HistoryParticipant`); returns the unregister. */
  participants(provider: () => readonly HistoryParticipant[]): () => void;
  /** Calls `listener` after every change to any scope or the focus. */
  subscribe(listener: () => void): () => void;
}

const refusal = (reason: string, code: Capability["code"] = "invalid_value"): Capability => ({ available: false, code, reason });

class Scope implements HistoryScope {
  private stack: HistoryStack;
  /** The scope as the last Undo, Redo or jump left it: the target's revision and content, and the top step. */
  private expected?: { revision: unknown; fingerprint: string; top?: HistoryEntryId };
  private recordingNow = true;
  constructor(readonly id: HistoryScopeId, private readonly target: HistoryTarget, private readonly options: ScopeOptions,
    private readonly service: { changed(scope: Scope, kept: boolean): void }) {
    this.stack = options.stack ?? new HistoryStack(options.parts ?? WHOLE_VALUES, options.limit ?? HISTORY_LIMIT,
      options.parts ? undefined : new ReferenceStore());
  }
  private readonly read: LookReader = key => this.target.read(key);
  private changed(kept = false) { this.options.changed?.(); this.service.changed(this, kept); }

  get recording() { return this.recordingNow; }
  get trimmed() { return this.stack.trimmed; }
  withoutHistory<T>(apply: () => T): T {
    const was = this.recordingNow; this.recordingNow = false;
    try { return apply(); } finally { this.recordingNow = was; }
  }
  checkpoint(keys: readonly string[], label?: HistoryLabel, options: CheckpointFlags = {}): HistoryEntryId | undefined {
    if (!this.recordingNow) return undefined;
    const added = this.stack.checkpoint(options.read ?? this.read, keys, { label, coalesce: options.coalesce, scope: options.scope,
      timed: options.timed, distinct: options.distinct });
    this.changed(true);
    return added;
  }
  private checkpointOpen(keys: readonly string[], label: HistoryLabel | undefined, scope: StoredScope | undefined) {
    const added = this.stack.checkpoint(this.read, keys, { label, scope });
    this.changed();
    return added;
  }
  relabel(step: HistoryEntryId, label: HistoryLabel) { this.stack.relabel(step, label); }
  discard(step: HistoryEntryId) { const removed = this.stack.discard(step); if (removed) this.changed(); return removed; }
  seal() { this.stack.seal(); }
  clear() { this.stack.clear(); this.expected = undefined; this.changed(); }
  replace(stack: HistoryStack) { this.stack = stack; this.expected = undefined; this.changed(true); }
  top() { return this.stack.topId; }
  data() { return this.stack.data(); }
  stats() { return this.stack.stats(); }

  begin(keys: readonly string[], policy: TransactionPolicy, options: { present?: () => boolean; label?: HistoryLabel; scope?: StoredScope } = {}) {
    const host: TransactionHost<HistoryEntryId> = {
      checkpoint: () => this.checkpointOpen(keys, options.label, options.scope), top: () => this.stack.topId,
      relabel: (step, label) => this.relabel(step, label), discard: step => this.discard(step),
      revert: step => { this.revertTransaction(step); }, content: () => this.target.fingerprint?.(keys) ?? "",
      // A kept step is a change to this scope like any other checkpoint.
      kept: () => this.service.changed(this, true),
    };
    return HistoryTransaction.open(host, policy, options.present ?? (() => true));
  }
  revertTransaction(step: HistoryEntryId | undefined): boolean {
    const values = step === undefined ? (this.stack.canUndo ? this.stack.stepParts(this.stack.depth - 1) : undefined)
      : this.stack.isTop(step) ? this.stack.revert() : undefined;
    if (!values) return false;
    if (step !== undefined) this.changed();
    const applied = this.target.apply(values, "revert");
    this.target.settled?.();
    return applied;
  }

  canUndo() { return this.stack.canUndo; }
  canRedo() { return this.redoValid(); }
  undo() { return this.settledFirst(() => this.stack.canUndo && this.move({ direction: "undo", count: 1 })); }
  redo() { return this.settledFirst(() => this.move({ direction: "redo", count: 1 })); }
  /**
   * Run a move once any move in progress has settled. A move asked for while one is settling (a listener that undoes again) waits in
   * order and runs after it, so each move applies and publishes whole; it answers true (accepted), and does nothing when it can't run then.
   */
  private settledFirst(run: () => boolean): boolean {
    if (this.moving) { this.waiting.push(run); return true; }
    this.moving = true;
    try { return run(); }
    finally {
      this.moving = false;
      // The next waiting move, in the order asked (each one's own finally runs the one after it).
      const next = this.waiting.shift();
      if (next) this.settledFirst(next);
    }
  }
  private moving = false;
  private readonly waiting: (() => boolean)[] = [];
  plan(stepId: string): HistoryJumpPlan | undefined {
    const timeline = this.timeline();
    const index = stepId === timeline.startId ? -1 : timeline.steps.findIndex(step => step.id === stepId);
    if (index < 0 && stepId !== timeline.startId) return undefined;
    const delta = index - timeline.current;
    return { direction: delta < 0 ? "undo" : delta > 0 ? "redo" : "none", count: Math.abs(delta) };
  }
  jumpTo(stepId: string) {
    return this.settledFirst(() => { const plan = this.plan(stepId); return !!plan && plan.direction !== "none" && this.move(plan); });
  }
  command(action: HistoryMove): boolean {
    if (this.options.command) return this.options.command(action);
    return action.kind === "history.jumpTo" ? this.jumpTo(action.entryId) : action.kind === "history.undo" ? this.undo() : this.redo();
  }
  capability(action: HistoryMove): Capability {
    const held = this.target.unavailable?.();
    if (held) return refusal(held, "not_ready");
    if (this.options.capability) return this.options.capability(action);
    if (action.kind === "history.jumpTo") {
      const plan = this.plan(action.entryId);
      return !plan ? refusal("That history step no longer exists.", "missing_target") :
        plan.direction === "none" ? refusal("This is already the current step.") : { available: true };
    }
    if (action.kind === "history.undo") return this.stack.canUndo ? { available: true } : refusal("There is no change to undo.");
    return this.redoValid() ? { available: true } : refusal("There is no undone change to redo.");
  }
  state(): HistoryState {
    if (this.options.state) return this.options.state(this.timeline());
    const valid = this.redoValid(), redo = valid ? this.stack.redoSteps()[0]?.label : undefined;
    return { undo: this.stack.canUndo ? this.stack.topLabel() : undefined, redo: redo && { ...redo }, depth: this.stack.depth,
      redoDepth: valid ? this.stack.redoDepth : 0 };
  }
  /** Kept steps oldest first, then the redo-able ones in Redo order (only while Redo is valid). */
  timeline(): HistorySnapshot {
    const stepId = this.options.stepId ?? (id => `step-${id}`);
    const done: HistoryStep[] = this.stack.list().map(entry => ({ ...(entry.label ?? UNKNOWN_HISTORY_LABEL), id: stepId(entry.id),
      ...(entry.at === undefined ? {} : { at: entry.at }), state: "done" }));
    const undone: HistoryStep[] = (this.redoValid() ? this.stack.redoSteps() : []).map(entry => ({ ...entry.label, id: stepId(entry.id),
      ...(entry.at === undefined ? {} : { at: entry.at }), state: "undone" }));
    const documentLabel = this.options.documentLabel?.();
    return { startId: this.options.startId ?? HISTORY_START_ID, steps: [...done, ...undone], current: done.length - 1,
      redoCount: undone.length, trimmed: this.stack.trimmed, ...(documentLabel === undefined ? {} : { documentLabel }) };
  }

  private move(plan: HistoryJumpPlan): boolean {
    if (this.target.unavailable?.() || plan.direction === "none") return false;
    if (plan.direction === "undo" && this.stack.depth < plan.count) return false;
    if (plan.direction === "redo") {
      // An externally changed target invalidates the obsolete redo branch (CORE-46); this is separate from refusing an apply.
      if (!this.redoValid()) { this.clearRedo(); return false; }
      if (this.stack.redoDepth < plan.count) return false;
    }
    const expected = this.expected && { ...this.expected };
    let accepted = false;
    try {
      accepted = this.stack.attempt(() => {
        if (plan.direction === "undo" && !this.redoValid()) this.clearRedo();
        const moved = plan.direction === "undo" ? this.stack.undo(this.read, plan.count) : this.stack.redo(this.read, plan.count);
        return !!moved && this.target.apply(moved.parts, plan.direction === "undo" ? "undo" : "redo");
      });
    } finally { if (!accepted) this.expected = expected; }
    if (!accepted) return false;
    this.expected = { revision: this.target.revision?.(), fingerprint: this.target.fingerprint?.() ?? "", top: this.stack.topId };
    // The target settles even when a listener throws, so it never stays half published.
    try { this.changed(true); } finally { this.target.settled?.(); }
    return true;
  }
  private redoValid() {
    const expected = this.expected;
    if (!this.stack.redoDepth || !expected) return false;
    // Any step added since (an edit, or an open transaction's checkpoint) hides Redo; a cancelled transaction removes its own
    // step again, so Redo comes back.
    if (this.stack.topId !== expected.top) return false;
    // The cheap shortcut only for a target that has a revision; otherwise the content decides.
    const revision = this.target.revision?.();
    if (this.target.revision && revision === expected.revision) return true;
    // A change that records no step (CORE-46) hides Redo, which would overwrite it; one that republishes the same content keeps it.
    if ((this.target.fingerprint?.() ?? "") !== expected.fingerprint) return false;
    expected.revision = revision;
    return true;
  }
  /** Drop the undone steps (a document's new step replaces its redo branch). */
  clearRedo() { this.stack.clearRedo(); this.expected = undefined; }
  /** The step IDs the scope still holds: done, undone and displaced at the limit. */
  held(): Set<HistoryEntryId> { return this.stack.heldIds(); }
}

/** `focus`: the session's focus service, which holds the editing context (default: one of its own, for a service used alone). */
export function createHistoryService(options: { focus?: FocusService } = {}): HistoryService {
  const focus = options.focus ?? new FocusService();
  const scopes = new Map<HistoryScopeId, Scope>();
  const listeners = new Set<() => void>(), documentListeners = new Set<() => void>();
  const providers = new Set<() => readonly HistoryParticipant[]>();
  const emit = (set: Set<() => void>) => notifyAll(set);
  /** Inside `batch`, listeners hear once at the end, however many changes the operation made. */
  let batching = 0, pending = { all: false, documents: false };
  const notify = (documentChange: boolean) => {
    if (batching) { pending.all = true; pending.documents ||= documentChange; return; }
    notifyAll([...(documentChange ? [() => emit(documentListeners)] : []), () => emit(listeners)]);
  };
  const batch = <T>(work: () => T): T => {
    batching++;
    try { return work(); }
    finally {
      if (--batching === 0 && pending.all) {
        const documentChange = pending.documents;
        pending = { all: false, documents: false };
        notify(documentChange);
      }
    }
  };
  // A change of the editing context is a change of what Undo would do: every listener hears it.
  let editingNow = focus.editing();
  focus.subscribe(() => { if (focus.editing() !== editingNow) { editingNow = focus.editing(); notify(true); } });
  const hub = { changed(scope: Scope, kept: boolean) {
    // A step kept in a look's or a V's history (an edit, an Undo, a look shown again) makes it the editing context.
    if (kept && editing(scope.id)) focus.edited(scope.id);
    notify(scope.id.startsWith(DOCUMENT_PREFIX));
  } };
  const participant = (id: string) => {
    for (const provider of providers) { const found = provider().find(item => item.id === id); if (found) return found; }
  };
  const openScope = (id: HistoryScopeId, target: HistoryTarget, options: ScopeOptions = {}): Scope => {
    const scope = new Scope(id, target, options, hub);
    scopes.set(id, scope);
    return scope;
  };
  // ----- Documents -----
  /** Each document's value as its history last left it (a step keeps the value after it), and its label and step IDs. */
  const held = new Map<string, unknown>(), labels = new Map<string, string>();
  const stepIds = new Map<string, Map<HistoryEntryId, string>>();
  const documentScope = (id: string) => scopes.get(DOCUMENT_PREFIX + id);
  const ensureDocument = (id: string): Scope => documentScope(id) ?? openScope(DOCUMENT_PREFIX + id, {
    read: () => held.get(id),
    apply: values => { held.set(id, values[id]); return true; },
  }, { startId: `${id}:start`, stepId: step => stepIds.get(id)?.get(step) ?? `step-${step}`,
    // Global Undo and Redo move the document through its experiment, which restores and saves the value.
    command: action => {
      const found = participant(id);
      if (!found) return false;
      if (!found.dispatch(action)) throw Error("That history step could not be applied.");
      return true;
    },
    state: t => ({ undo: t.steps[t.current], redo: t.steps[t.current + 1], depth: t.current + 1, redoDepth: t.redoCount }),
    documentLabel: () => labels.get(id),
    capability: action => {
      const t = snapshot(id);
      const available = action.kind === "history.undo" ? t.current >= 0 : action.kind === "history.redo" ? t.redoCount > 0
        : action.entryId === t.startId || t.steps.some(step => step.id === action.entryId);
      return available ? { available: true } : refusal("There is no matching change in this document.", "unavailable");
    } });
  const snapshot = (id: string): HistorySnapshot => {
    const scope = documentScope(id);
    return scope ? scope.timeline() : { startId: `${id}:start`, steps: [], current: -1, redoCount: 0, trimmed: false };
  };
  const documents: DocumentHistory = {
    selected: () => { const id = focus.editing(); return id?.startsWith(DOCUMENT_PREFIX) ? id.slice(DOCUMENT_PREFIX.length) : null; },
    focus: id => {
      if (id !== null) { focus.edited(DOCUMENT_PREFIX + id); return; }
      // No document focused: global Undo goes back to the editing context before the documents.
      focus.withdraw(item => item.startsWith(DOCUMENT_PREFIX));
    },
    snapshot,
    record: (id, documentLabel, entry, change) => batch(() => {
      const scope = ensureDocument(id), known = held.has(id);
      // A step after the current one drops the redo branch. Its "before" is the value the history last left (the first step's
      // is the caller's), so a step always undoes to the value after the one before it.
      scope.clearRedo();
      const { id: external, ...label } = entry;
      const added = scope.checkpoint([id], label, { read: () => known ? held.get(id) : change.before, timed: false, distinct: true });
      // Step IDs of steps the history no longer holds (dropped at the limit or with a redo branch) are forgotten.
      const ids = stepIds.get(id) ?? new Map<HistoryEntryId, string>(), kept = scope.held();
      for (const step of [...ids.keys()]) if (!kept.has(step)) ids.delete(step);
      if (added !== undefined) ids.set(added, external);
      stepIds.set(id, ids);
      held.set(id, change.after); labels.set(id, documentLabel);
      focus.edited(DOCUMENT_PREFIX + id); notify(true);
    }),
    move: (id, current) => batch(() => {
      const scope = documentScope(id);
      if (!scope) return undefined;
      const t = scope.timeline(), bounded = Math.max(-1, Math.min(t.steps.length - 1, current));
      if (bounded !== t.current) scope.jumpTo(bounded < 0 ? t.startId : t.steps[bounded].id);
      focus.edited(DOCUMENT_PREFIX + id); notify(true);
      return held.get(id);
    }),
    subscribe(listener) { documentListeners.add(listener); return () => { documentListeners.delete(listener); }; },
  };

  return {
    open: openScope,
    close(id) { scopes.delete(id); },
    scope: id => scopes.get(id),
    focus,
    acting(ids) {
      for (const id of ids) {
        if (id.startsWith(DOCUMENT_PREFIX)) {
          const document = id.slice(DOCUMENT_PREFIX.length);
          if (participant(document)) return ensureDocument(document);
        } else {
          const scope = scopes.get(id);
          if (scope) return scope;
        }
      }
      return null;
    },
    documents,
    participants(provider) { providers.add(provider); return () => { providers.delete(provider); }; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
