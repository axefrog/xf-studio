/**
 * One writer per workspace ([profiles design §2.3](../../../../../../research/authoring/profiles-views-layouts-design.md#23-flush-close-and-one-writer-per-workspace)).
 *
 * A workspace (the localhost browser's, or the desktop host's file; the `?verify` one apart) is written by one page at a time:
 * the **lease holder**. Another page opens read-only and refuses every dispatch with `unavailable`. **Use it here** asks the
 * holder to release; the holder ends any open gesture, stops accepting edits, drains its pending saves and writes the workspace a
 * last time. Only when every one of those succeeded does it release, confirm and retire its autosave; otherwise it keeps the lease,
 * says its latest changes couldn't be saved, and offers Try again. A holder that doesn't answer is waited for, never stolen from:
 * the lease moves only when it is released or its page ends. Every lease carries a **generation**, which the host uses to refuse a
 * late write from a released page (fencing); a page that can't get one is never writable.
 *
 * This module is the pure part: the phases, their transitions (`leaseTransition`) and the controller that drives one adapter
 * with an injected clock. The adapters hold the mechanics: Web Locks and a `BroadcastChannel` on localhost, a host route and the
 * page's lifetime on desktop (`app/browser/workspace-lease-device.ts`).
 */
import { refusal, type Capability } from "../../platform/api/capability";
import { WORKSPACE_LEASE_DESCRIPTORS } from "../studio-action-descriptors";

/** The lease's actions: Use it here, and Try again after a handover that couldn't save. */
export type WorkspaceLeaseAction = { kind: "workspace.takeOver" } | { kind: "workspace.retryRelease" } | { kind: "workspace.cancelTakeOver" };
export type WorkspaceLeaseOutcome = { ok: true } | { ok: false; code: string; message: string };

export const LEASE_MESSAGES = {
  unsupported: "This browser lacks a feature XF Studio needs to keep two tabs from overwriting each other. Use an up-to-date browser to edit this workspace.",
  readOnly: "This workspace is open in another window.",
  takingOver: "Taking over from the other window…",
  waiting: "Waiting for the other window to finish saving. Close the other window to continue.",
  releasing: "Handing this workspace to another window…",
  starting: "Opening the workspace…",
  releaseFailed: "Your latest changes couldn't be saved, so this window kept the workspace. Try again, or export this window's copy to keep them.",
  disconnected: "This window lost its connection to XF Studio, so it can't save here. Reload the window to continue.",
  reconciling: "Checking whether the other window has the workspace now…",
  /** The refusal every dispatch gets while this page doesn't hold the workspace. */
  refused: "This workspace is open in another window. Choose Use it here to edit in this window.",
} as const;

/**
 * - `starting`: asking for the lease.
 * - `holder`: this page writes the workspace.
 * - `releasing`: asked to release; edits are refused while pending saves drain and the workspace is written a last time.
 * - `release-failed`: a release step couldn't save; this page keeps the lease and its edits, says so, and offers Try again.
 * - `read-only`: another page holds the workspace (or this one released it).
 * - `taking-over`: Use it here was chosen; the holder has been asked to release.
 * - `waiting`: the holder hasn't released within the grace period; this page waits for it to finish or close.
 * - `taken-over`: this page now holds the lease after a takeover; the page restarts from the released workspace.
 * - `reconciling`: a release was sent but its answer was lost; this page may not write until the host (or the browser) says who
 *   holds the lease now.
 * - `unsupported`: the browser lacks the APIs needed to guarantee one writer; no edits or takeover are allowed.
 * - `disconnected`: this page can't hold the lease safely (its host stream ended, or the host issued no generation); it writes nothing.
 */
export type LeasePhase = "starting" | "holder" | "releasing" | "release-failed" | "reconciling" | "read-only" | "taking-over" | "waiting"
  | "taken-over" | "disconnected" | "unsupported";
export type LeaseState = { readonly phase: LeasePhase; readonly generation: number | null };
export type LeaseEvent =
  | { kind: "acquired"; generation: number }
  | { kind: "held-elsewhere" }
  | { kind: "takeover-requested" }
  | { kind: "grace-elapsed" }
  | { kind: "granted"; generation: number }
  | { kind: "takeover-failed" }
  | { kind: "release-requested" }
  | { kind: "release-failed" }
  | { kind: "release-uncertain" }
  | { kind: "still-held" }
  | { kind: "released" }
  | { kind: "lost" }
  | { kind: "unsupported" };

/**
 * A release that stopped before anything was released: this page's own last writes didn't land, so it still holds the lease. Any other
 * failure of `WorkspaceLeaseAdapter.release` leaves the outcome uncertain (the release may have been granted elsewhere).
 */
export class ReleaseUnsaved extends Error {}
/** The device cannot guarantee one writer in this browser. */
export class UnsupportedWorkspaceLease extends Error {}

/** The read-only view of the lease for the presentation. */
export type WorkspaceLeaseSnapshot = {
  readonly phase: LeasePhase;
  /** Whether this page may edit and write (`holder`, and `release-failed`, which kept the lease). */
  readonly writable: boolean;
  /** What the page says about the workspace; empty while it holds it normally. */
  readonly message: string;
  /** Whether Use it here is offered (read-only, before a takeover starts). */
  readonly canTakeOver: boolean;
  /** Whether Try again is offered (a handover that couldn't save). */
  readonly canRetry: boolean;
  readonly canCancel?: boolean;
  /** The reason every refused control shows while this page may not write; empty while it may. */
  readonly refusal: string;
};

export const INITIAL_LEASE: LeaseState = { phase: "starting", generation: null };
const asking = (phase: LeasePhase) => phase === "taking-over" || phase === "waiting";
const writing = (phase: LeasePhase) => phase === "holder" || phase === "release-failed";

/** The pure transition: an event that doesn't apply to the phase changes nothing. */
export function leaseTransition(state: LeaseState, event: LeaseEvent): LeaseState {
  switch (event.kind) {
    case "unsupported": return state.phase === "starting" ? { phase: "unsupported", generation: null } : state;
    case "acquired": return state.phase === "starting" ? { phase: "holder", generation: event.generation } : state;
    case "held-elsewhere": return state.phase === "starting" ? { phase: "read-only", generation: null } : state;
    case "takeover-requested": return state.phase === "read-only" ? { phase: "taking-over", generation: null } : state;
    case "grace-elapsed": return state.phase === "taking-over" ? { phase: "waiting", generation: null } : state;
    case "granted": return asking(state.phase) ? { phase: "taken-over", generation: event.generation } : state;
    case "takeover-failed": return asking(state.phase) ? { phase: "read-only", generation: null } : state;
    case "release-requested": return writing(state.phase) ? { phase: "releasing", generation: state.generation } : state;
    case "release-failed": return state.phase === "releasing" ? { phase: "release-failed", generation: state.generation } : state;
    // The answer was lost: the lease may already be another page's. Nothing is written until that is settled.
    case "release-uncertain": return state.phase === "releasing" ? { phase: "reconciling", generation: state.generation } : state;
    case "still-held": return state.phase === "reconciling" ? { phase: "release-failed", generation: state.generation } : state;
    case "released": return state.phase === "releasing" || state.phase === "reconciling" ? { phase: "read-only", generation: null } : state;
    case "lost": return state.phase === "disconnected" || state.phase === "taken-over" ? state : { phase: "disconnected", generation: null };
  }
}

export function leaseSnapshot(state: LeaseState): WorkspaceLeaseSnapshot {
  const messages: Partial<Record<LeasePhase, string>> = { "read-only": LEASE_MESSAGES.readOnly, "taking-over": LEASE_MESSAGES.takingOver,
    waiting: LEASE_MESSAGES.waiting, releasing: LEASE_MESSAGES.releasing, starting: LEASE_MESSAGES.starting,
    "release-failed": LEASE_MESSAGES.releaseFailed, disconnected: LEASE_MESSAGES.disconnected, reconciling: LEASE_MESSAGES.reconciling, unsupported: LEASE_MESSAGES.unsupported };
  const refusal = writing(state.phase) ? "" : state.phase === "starting" ? LEASE_MESSAGES.starting
    : state.phase === "unsupported" ? LEASE_MESSAGES.unsupported : state.phase === "disconnected" ? LEASE_MESSAGES.disconnected : state.phase === "reconciling" ? LEASE_MESSAGES.reconciling : LEASE_MESSAGES.refused;
  return { phase: state.phase, writable: writing(state.phase), message: messages[state.phase] ?? "", canTakeOver: state.phase === "read-only",
    canRetry: state.phase === "release-failed", canCancel: state.phase === "waiting", refusal };
}

/** The mechanics one host supplies. Every call settles; none steals the lease. */
export interface WorkspaceLeaseAdapter {
  /**
   * Takes the lease if it is free, without waiting: its generation, or null when another page holds it. Rejects when the lease can't
   * be held safely (no generation from the host, a lost host): the page is then `disconnected`, never writable without a fence.
   */
  acquire(signal: AbortSignal): Promise<{ generation: number } | null>;
  /** Asks the holder to release, then waits (as long as it takes) until this page holds the lease; aborting withdraws the request. */
  takeOver(signal: AbortSignal): Promise<{ generation: number }>;
  /** `listener` runs when another page asks this one, the holder, to release. */
  onReleaseRequested(listener: () => void): void;
  /** `listener` runs when this page can no longer hold the lease safely (the desktop host's stream ended). */
  onLost?(listener: () => void): void;
  /**
   * Gives the lease up and confirms it to the page that asked. Rejects with `ReleaseUnsaved` (nothing released) when this page's own
   * last writes didn't land; any other rejection means the outcome is unknown (the answer was lost), and `reconcile` is asked.
   */
  release(): Promise<void>;
  /** Who holds the lease now, after a release whose answer was lost: still this page, or released. Rejects when it can't tell. */
  reconcile?(): Promise<"held" | "released">;
  /** Ends this adapter's lifetime after its workspace and pending writes have been secured. */
  stop?(): Promise<void>;
}

/** The clock source's timers (the page passes its own; tests a simulated one). */
export type LeaseClock = { after(ms: number, run: () => void, signal?: AbortSignal): void };

/** How long a takeover says "Taking over…" before it says it is waiting for the other page. */
export const TAKEOVER_GRACE_MS = 1500;

/** One page's lease: the one owner of whether it may write its workspace. */
export class WorkspaceLease {
  private state: LeaseState = INITIAL_LEASE;
  private listeners = new Set<() => void>();
  private steps: (() => Promise<boolean | void> | boolean | void)[] = [];
  private settles: (() => void)[] = [];
  private releasedHooks: (() => void)[] = [];
  private releasing: Promise<boolean> | null = null;
  private takeover: AbortController | null = null;
  private stopped = false;
  private stopping?: Promise<void>;
  constructor(private readonly adapter: WorkspaceLeaseAdapter, private readonly options: {
    clock: LeaseClock; graceMs?: number;
    /** The page's lifetime: aborting it abandons a takeover still waiting. */
    signal?: AbortSignal;
    /** A step, release or takeover that failed (the diagnostics log). */
    report?: (error: unknown) => void;
  }) {
    adapter.onReleaseRequested(() => { void this.release(); });
    adapter.onLost?.(() => { this.apply({ kind: "lost" }); });
  }
  snapshot(): WorkspaceLeaseSnapshot { return leaseSnapshot(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Whether this page may edit and write now. */
  writable() { return writing(this.state.phase); }
  /** The generation writes carry: while this page holds the lease, and still while it drains (`releasing`); null otherwise. */
  generation(): number | null { return this.draining() ? this.state.generation : null; }
  /** Whether this page may still write what it already had in flight (holding the lease, or draining as it releases). */
  draining() { return writing(this.state.phase) || this.state.phase === "releasing"; }
  // `reconciling` is neither: a page whose release answer was lost writes nothing until it knows it still holds the lease.
  /** The refusal every dispatch gets while this page may not write; undefined while it may. */
  refusal(): (Capability & { available: false }) | undefined {
    return this.writable() ? undefined : refusal("unavailable", this.snapshot().refusal);
  }
  /**
   * The steps a release runs, in order, once edits are refused: drain pending document saves, write the workspace a last time. Each
   * is awaited and answers whether it succeeded: `false` or a throw stops the release, and the page keeps the lease (`release-failed`).
   */
  onRelease(step: () => Promise<boolean | void> | boolean | void) { this.steps.push(step); }
  /**
   * What a release does first, before it stops accepting edits: end any open gesture or form-control run under its own transaction
   * rules (committed as a pointer release or a finished drag would), so the last workspace write holds it whole.
   */
  onReleaseStart(settle: () => void) { this.settles.push(settle); }
  /** What runs once the lease is released and confirmed: autosave retires (its timers stop and it never writes again). */
  onReleased(done: () => void) { this.releasedHooks.push(done); }

  private apply(event: LeaseEvent) {
    const next = leaseTransition(this.state, event);
    if (next === this.state) return false;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  descriptors() { return structuredClone(WORKSPACE_LEASE_DESCRIPTORS); }
  capability(action: WorkspaceLeaseAction): Capability {
    if (action?.kind === "workspace.cancelTakeOver")
      return this.state.phase === "waiting" ? { available: true } : refusal("unavailable", "There’s no waiting request to cancel.");
    if (action?.kind === "workspace.retryRelease")
      return this.state.phase === "release-failed" ? { available: true } : refusal("unavailable", "There's nothing to try again.");
    if (action?.kind !== "workspace.takeOver") return refusal("invalid_value", "Unknown command.");
    if (this.takeover) return refusal("busy", "Finishing the previous request. Try again in a moment.");
    if (this.writable()) return refusal("unavailable", "This workspace is already editable here.");
    if (asking(this.state.phase) || this.state.phase === "taken-over") return refusal("busy", this.snapshot().message || LEASE_MESSAGES.takingOver);
    if (this.state.phase !== "read-only") return refusal("not_ready", this.snapshot().message);
    return { available: true };
  }
  /** Use it here or Try again, through the port: resolves once done, or with why it couldn't be. */
  async dispatch(action: WorkspaceLeaseAction): Promise<WorkspaceLeaseOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Not available right now." };
    if (action.kind === "workspace.cancelTakeOver") {
      this.takeover?.abort();
      this.apply({ kind: "takeover-failed" });
      return { ok: true };
    }
    if (action.kind === "workspace.retryRelease")
      return await this.retryRelease() ? { ok: true } : { ok: false, code: "unavailable", message: LEASE_MESSAGES.releaseFailed };
    const done = await this.takeOver();
    return done.ok ? { ok: true } : { ok: false, code: "unavailable", message: done.message ?? "The workspace couldn't be taken over." };
  }

  /** Takes the lease if it is free; otherwise the page is read-only, or `disconnected` when it can't be held safely. */
  async start(): Promise<WorkspaceLeaseSnapshot> {
    if (this.stopped) return this.snapshot();
    const signal = this.options.signal ?? new AbortController().signal;
    let held: { generation: number } | null;
    try { held = await this.adapter.acquire(signal); }
    catch (error) { if (!this.stopped) { this.options.report?.(error); this.apply({ kind: error instanceof UnsupportedWorkspaceLease ? "unsupported" : "lost" }); } return this.snapshot(); }
    if (this.stopped) return this.snapshot();
    if (held && !Number.isSafeInteger(held.generation)) { this.apply({ kind: "lost" }); return this.snapshot(); }
    this.apply(held ? { kind: "acquired", generation: held.generation } : { kind: "held-elsewhere" });
    return this.snapshot();
  }

  /**
   * Use it here: asks the holder to release and waits for it. Resolves once this page holds the lease (`taken-over`). A takeover that
   * fails withdraws its request and returns to `read-only`, where it can be tried again.
   */
  async takeOver(): Promise<{ ok: boolean; message?: string }> {
    if (this.stopped) return { ok: false, message: "This workspace was released." };
    if (this.takeover) return { ok: false, message: "The previous request is still finishing." };
    if (!this.apply({ kind: "takeover-requested" })) return { ok: false, message: "This workspace is already editable here, or is being taken over." };
    const run = new AbortController();
    this.takeover = run;
    const stop = () => run.abort();
    this.options.signal?.addEventListener("abort", stop, { once: true });
    this.options.clock.after(this.options.graceMs ?? TAKEOVER_GRACE_MS, () => { this.apply({ kind: "grace-elapsed" }); }, run.signal);
    try {
      const granted = await this.adapter.takeOver(run.signal);
      if (run.signal.aborted || this.stopped) {
        // A grant already in transit when Cancel was pressed is returned without writing anything.
        try { await this.adapter.release(); } catch (error) { this.options.report?.(error); this.apply({ kind: "lost" }); }
        return { ok: true };
      }
      if (!Number.isSafeInteger(granted?.generation)) throw Error("The host issued no lease generation.");
      this.apply({ kind: "granted", generation: granted.generation });
      return { ok: true };
    } catch (error) {
      if (run.signal.aborted) return { ok: true };
      this.options.report?.(error);
      this.apply({ kind: "takeover-failed" });
      return { ok: false, message: "The workspace couldn't be taken over. Close the other window, then try again." };
    } finally {
      if (this.takeover === run) this.takeover = null;
      run.abort();
      this.options.signal?.removeEventListener("abort", stop);
    }
  }

  /**
   * Releases the lease for another page: settles open edits, refuses edits, runs the release steps in order, then releases and
   * confirms. If a step or the release fails, nothing is released: the page keeps the lease (`release-failed`) and says so. Called when
   * another page asks; a second request while one runs joins it.
   */
  release(): Promise<boolean> {
    if (this.releasing) return this.releasing;
    if (this.state.phase !== "holder") return Promise.resolve(false);
    return this.run();
  }
  /** Try again after a release that couldn't save. */
  retryRelease(): Promise<boolean> {
    if (this.releasing) return this.releasing;
    if (this.state.phase !== "release-failed") return Promise.resolve(false);
    return this.run();
  }
  private run(): Promise<boolean> {
    for (const settle of this.settles) { try { settle(); } catch (error) { this.options.report?.(error); } }
    if (!this.apply({ kind: "release-requested" })) return Promise.resolve(false);
    this.releasing = (async () => {
      for (const step of this.steps) {
        let ok: boolean | void;
        try { ok = await step(); } catch (error) { this.options.report?.(error); ok = false; }
        if (ok === false) { this.apply({ kind: "release-failed" }); return false; }
      }
      try { await this.adapter.release(); }
      catch (error) {
        this.options.report?.(error);
        if (error instanceof ReleaseUnsaved) { this.apply({ kind: "release-failed" }); return false; }
        // The release may have happened: ask who holds the lease before this page may write again.
        this.apply({ kind: "release-uncertain" });
        let outcome: "held" | "released";
        try {
          if (!this.adapter.reconcile) throw Error("Who holds the workspace can't be checked.");
          outcome = await this.adapter.reconcile();
        } catch (failure) { this.options.report?.(failure); this.apply({ kind: "lost" }); return false; }
        if (outcome === "held") { this.apply({ kind: "still-held" }); return false; }
      }
      this.apply({ kind: "released" });
      for (const done of this.releasedHooks) { try { done(); } catch (error) { this.options.report?.(error); } }
      return true;
    })().finally(() => { this.releasing = null; });
    return this.releasing;
  }
  /** Application retirement, after workspace release and durable outbox stop; never used for a refused workspace release. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.takeover?.abort();
    this.apply({ kind: "lost" });
    this.listeners.clear(); this.steps = []; this.settles = []; this.releasedHooks = [];
    return this.stopping = this.adapter.stop?.() ?? Promise.resolve();
  }
}
