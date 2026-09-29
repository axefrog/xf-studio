/**
 * Cancellation tokens (SPEC §8). The engine reads no host global, so it carries its own controller whose `signal`
 * implements the AbortSignal interface (aborted, reason, addEventListener, removeEventListener, throwIfAborted,
 * onabort). It chains from any AbortSignal-like parent, a host's `AbortSignal` included.
 */

/** What the engine needs of a signal: the AbortSignal interface's cancellation half. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** Thrown by `throwIfAborted`. */
export class AbortedError extends Error {
  constructor(readonly reason: unknown) { super(typeof reason === "string" ? reason : "Aborted."); this.name = "AbortError"; }
}

export class StrataSignal implements AbortSignalLike {
  private state: { aborted: boolean; reason: unknown } = { aborted: false, reason: undefined };
  private listeners: (() => void)[] = [];
  /** Called on abort, after listeners registered before it (as a host signal's `onabort`). */
  onabort: (() => void) | null = null;
  get aborted(): boolean { return this.state.aborted; }
  get reason(): unknown { return this.state.reason; }
  addEventListener(type: "abort", listener: () => void): void {
    if (type === "abort" && !this.state.aborted && !this.listeners.includes(listener)) this.listeners.push(listener);
  }
  removeEventListener(type: "abort", listener: () => void): void {
    if (type === "abort") this.listeners = this.listeners.filter(item => item !== listener);
  }
  throwIfAborted(): void { if (this.state.aborted) throw new AbortedError(this.state.reason); }
  /** @internal */
  fire(reason: unknown): void {
    if (this.state.aborted) return;
    this.state = { aborted: true, reason };
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) listener();
    this.onabort?.();
  }
}

/** A controller: `abort(reason)` aborts its signal once; it is aborted too when any parent is. */
export class Aborter {
  readonly signal = new StrataSignal();
  private unlink: (() => void)[] = [];
  constructor(...parents: readonly (AbortSignalLike | undefined | null)[]) {
    for (const parent of parents) {
      if (!parent) continue;
      if (parent.aborted) { this.abort(parent.reason); return; }
      const listener = () => this.abort(parent.reason);
      parent.addEventListener("abort", listener, { once: true });
      this.unlink.push(() => parent.removeEventListener("abort", listener));
    }
  }
  abort(reason: unknown = "aborted"): void {
    if (this.signal.aborted) return;
    for (const unlink of this.unlink) unlink();
    this.unlink = [];
    this.signal.fire(reason);
  }
}

/** A signal aborted when any of the given signals is. */
export const anySignal = (...signals: readonly (AbortSignalLike | undefined | null)[]): StrataSignal => new Aborter(...signals).signal;

/** Runs `listener` once when `signal` aborts (or never, when it has already; the caller checks `aborted` first). */
export function onAbort(signal: AbortSignalLike | undefined, listener: () => void): void {
  if (signal && !signal.aborted) signal.addEventListener("abort", listener, { once: true });
}
