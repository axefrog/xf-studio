/**
 * One writer per workspace ([profiles design §2.3](../../../../../../research/authoring/profiles-views-layouts-design.md#23-flush-close-and-one-writer-per-workspace)).
 *
 * A workspace (the localhost browser's, or the desktop host's file; the `?verify` one apart) is written by one page at a time:
 * the **lease holder**. Another page opens read-only and refuses every dispatch with `unavailable`. **Use it here** asks the
 * holder to release; the holder stops accepting edits at once, runs its release steps (drain pending saves, stop its timers,
 * write the workspace a last time), releases and confirms. A holder that doesn't answer is waited for, never stolen from: the
 * lease moves only when it is released or its page ends. Every lease carries a **generation**, which the host uses to refuse
 * a late write from a released page (fencing).
 *
 * This module is the pure part: the phases, their transitions (`leaseTransition`) and the controller that drives one adapter
 * with an injected clock. The adapters hold the mechanics: Web Locks and a `BroadcastChannel` on localhost, a host route and the
 * page's lifetime on desktop (`app/browser/workspace-lease-device.ts`).
 */
import { refusal, type Capability } from "../../platform/api/capability";
import { WORKSPACE_LEASE_DESCRIPTORS } from "../studio-action-descriptors";

/** The lease's one action: Use it here. */
export type WorkspaceLeaseAction = { kind: "workspace.takeOver" };
export type WorkspaceLeaseOutcome = { ok: true } | { ok: false; code: string; message: string };

export const LEASE_MESSAGES = {
  readOnly: "This workspace is open in another window.",
  takingOver: "Taking over from the other window…",
  waiting: "Waiting for the other window to finish saving. Close it to continue.",
  releasing: "Handing this workspace to another window…",
  starting: "Opening the workspace…",
  /** The refusal every dispatch gets while this page doesn't hold the workspace. */
  refused: "This workspace is open in another window. Choose Use it here to edit in this window.",
} as const;

/**
 * - `starting`: asking for the lease.
 * - `holder`: this page writes the workspace.
 * - `releasing`: asked to release; edits are refused while pending saves drain and the workspace is written a last time.
 * - `read-only`: another page holds the workspace (or this one released it).
 * - `taking-over`: Use it here was chosen; the holder has been asked to release.
 * - `waiting`: the holder hasn't released within the grace period; this page waits for it to finish or close.
 * - `taken-over`: this page now holds the lease after a takeover; the page restarts from the released workspace.
 */
export type LeasePhase = "starting" | "holder" | "releasing" | "read-only" | "taking-over" | "waiting" | "taken-over";
export type LeaseState = { readonly phase: LeasePhase; readonly generation: number | null };
export type LeaseEvent =
  | { kind: "acquired"; generation: number | null }
  | { kind: "held-elsewhere" }
  | { kind: "takeover-requested" }
  | { kind: "grace-elapsed" }
  | { kind: "granted"; generation: number | null }
  | { kind: "release-requested" }
  | { kind: "released" };

/** The read-only view of the lease for the presentation. */
export type WorkspaceLeaseSnapshot = {
  readonly phase: LeasePhase;
  /** Whether this page may edit and write (`holder` only). */
  readonly writable: boolean;
  /** What the page says about the workspace; empty while it holds it. */
  readonly message: string;
  /** Whether Use it here is offered (read-only, before a takeover starts). */
  readonly canTakeOver: boolean;
};

export const INITIAL_LEASE: LeaseState = { phase: "starting", generation: null };

/** The pure transition: an event that doesn't apply to the phase changes nothing. */
export function leaseTransition(state: LeaseState, event: LeaseEvent): LeaseState {
  switch (event.kind) {
    case "acquired": return state.phase === "starting" ? { phase: "holder", generation: event.generation } : state;
    case "held-elsewhere": return state.phase === "starting" ? { phase: "read-only", generation: null } : state;
    case "takeover-requested": return state.phase === "read-only" ? { phase: "taking-over", generation: null } : state;
    case "grace-elapsed": return state.phase === "taking-over" ? { phase: "waiting", generation: null } : state;
    case "granted": return state.phase === "taking-over" || state.phase === "waiting" ? { phase: "taken-over", generation: event.generation } : state;
    case "release-requested": return state.phase === "holder" ? { phase: "releasing", generation: state.generation } : state;
    case "released": return state.phase === "releasing" ? { phase: "read-only", generation: null } : state;
  }
}

export function leaseSnapshot(state: LeaseState): WorkspaceLeaseSnapshot {
  const message = state.phase === "read-only" ? LEASE_MESSAGES.readOnly : state.phase === "taking-over" ? LEASE_MESSAGES.takingOver
    : state.phase === "waiting" ? LEASE_MESSAGES.waiting : state.phase === "releasing" ? LEASE_MESSAGES.releasing
    : state.phase === "starting" ? LEASE_MESSAGES.starting : "";
  return { phase: state.phase, writable: state.phase === "holder", message, canTakeOver: state.phase === "read-only" };
}

/** The mechanics one host supplies. Every call settles; none steals the lease. */
export interface WorkspaceLeaseAdapter {
  /** Takes the lease if it is free, without waiting: its generation (null when the host issued none), or null when another page holds it. */
  acquire(signal: AbortSignal): Promise<{ generation: number | null } | null>;
  /** Asks the holder to release, then waits (as long as it takes) until this page holds the lease. */
  takeOver(signal: AbortSignal): Promise<{ generation: number | null }>;
  /** `listener` runs when another page asks this one, the holder, to release. */
  onReleaseRequested(listener: () => void): void;
  /** Gives the lease up and confirms it to the page that asked. */
  release(): Promise<void>;
}

/** The clock source's timers (the page passes its own; tests a simulated one). */
export type LeaseClock = { after(ms: number, run: () => void, signal?: AbortSignal): void };

/** How long a takeover says "Taking over…" before it says it is waiting for the other page. */
export const TAKEOVER_GRACE_MS = 1500;

/** One page's lease: the one owner of whether it may write its workspace. */
export class WorkspaceLease {
  private state: LeaseState = INITIAL_LEASE;
  private listeners = new Set<() => void>();
  private steps: (() => Promise<void> | void)[] = [];
  private takeoverRun: AbortController | null = null;
  private releasing: Promise<void> | null = null;
  constructor(private readonly adapter: WorkspaceLeaseAdapter, private readonly options: {
    clock: LeaseClock; graceMs?: number;
    /** The page's lifetime: aborting it abandons a takeover still waiting. */
    signal?: AbortSignal;
    /** A release step failed: reported, and the release still goes ahead (the host's fencing refuses anything that lands late). */
    report?: (error: unknown) => void;
  }) {
    adapter.onReleaseRequested(() => { void this.release(); });
  }
  snapshot(): WorkspaceLeaseSnapshot { return leaseSnapshot(this.state); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /** Whether this page may edit and write now. */
  writable() { return this.state.phase === "holder"; }
  /** The generation writes carry: the holder's, and still while it drains (`releasing`); null otherwise. */
  generation(): number | null { return this.state.phase === "holder" || this.state.phase === "releasing" ? this.state.generation : null; }
  /** Whether this page may still write what it already had in flight (holder, or draining as it releases). */
  draining() { return this.state.phase === "holder" || this.state.phase === "releasing"; }
  /** The refusal every dispatch gets while this page doesn't hold the workspace; undefined while it does. */
  refusal(): (Capability & { available: false }) | undefined {
    return this.state.phase === "holder" ? undefined : refusal("unavailable", this.state.phase === "starting" ? LEASE_MESSAGES.starting : LEASE_MESSAGES.refused);
  }
  /**
   * The steps a release runs, in order, once edits are refused: drain pending document saves, stop timers and callbacks, write
   * the workspace a last time. Each is awaited.
   */
  onRelease(step: () => Promise<void> | void) { this.steps.push(step); }

  private apply(event: LeaseEvent) {
    const next = leaseTransition(this.state, event);
    if (next === this.state) return false;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  descriptors() { return structuredClone(WORKSPACE_LEASE_DESCRIPTORS); }
  capability(action: WorkspaceLeaseAction): Capability {
    if (action?.kind !== "workspace.takeOver") return refusal("invalid_value", "Unknown command.");
    if (this.state.phase === "holder") return refusal("unavailable", "This workspace is already editable here.");
    if (this.state.phase === "taking-over" || this.state.phase === "waiting" || this.state.phase === "taken-over")
      return refusal("busy", this.snapshot().message || LEASE_MESSAGES.takingOver);
    if (this.state.phase !== "read-only") return refusal("not_ready", this.snapshot().message);
    return { available: true };
  }
  /** Use it here, through the port: resolves once this page holds the workspace, or with why it couldn't. */
  async dispatch(action: WorkspaceLeaseAction): Promise<WorkspaceLeaseOutcome> {
    const allowed = this.capability(action);
    if (!allowed.available) return { ok: false, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Not available right now." };
    const done = await this.takeOver();
    return done.ok ? { ok: true } : { ok: false, code: "unavailable", message: done.message ?? "The workspace couldn't be taken over." };
  }

  /** Takes the lease if it is free; otherwise the page is read-only. Resolves with the result. */
  async start(): Promise<WorkspaceLeaseSnapshot> {
    const signal = this.options.signal ?? new AbortController().signal;
    let held: { generation: number | null } | null;
    try { held = await this.adapter.acquire(signal); }
    catch (error) { this.options.report?.(error); held = null; }
    this.apply(held ? { kind: "acquired", generation: held.generation } : { kind: "held-elsewhere" });
    return this.snapshot();
  }

  /** Use it here: asks the holder to release and waits for it. Resolves once this page holds the lease (`taken-over`). */
  async takeOver(): Promise<{ ok: boolean; message?: string }> {
    if (!this.apply({ kind: "takeover-requested" })) return { ok: false, message: "This workspace is already editable here, or is being taken over." };
    const run = new AbortController();
    this.takeoverRun = run;
    const stop = () => run.abort();
    this.options.signal?.addEventListener("abort", stop, { once: true });
    this.options.clock.after(this.options.graceMs ?? TAKEOVER_GRACE_MS, () => { this.apply({ kind: "grace-elapsed" }); }, run.signal);
    try {
      const granted = await this.adapter.takeOver(run.signal);
      run.abort();
      this.apply({ kind: "granted", generation: granted.generation });
      return { ok: true };
    } catch (error) {
      run.abort();
      if (!this.options.signal?.aborted) this.options.report?.(error);
      return { ok: false, message: "The workspace couldn't be taken over. Close the other window, then try again." };
    } finally {
      this.options.signal?.removeEventListener("abort", stop);
      if (this.takeoverRun === run) this.takeoverRun = null;
    }
  }

  /**
   * Releases the lease for another page: refuses edits at once, runs the release steps in order, releases and confirms. Called
   * when another page asks; a second request while one runs joins it.
   */
  release(): Promise<void> {
    if (this.releasing) return this.releasing;
    if (!this.apply({ kind: "release-requested" })) return Promise.resolve();
    this.releasing = (async () => {
      for (const step of this.steps) {
        try { await step(); } catch (error) { this.options.report?.(error); }
      }
      try { await this.adapter.release(); } catch (error) { this.options.report?.(error); }
      this.apply({ kind: "released" });
    })().finally(() => { this.releasing = null; });
    return this.releasing;
  }
}
