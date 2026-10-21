/**
 * Test doubles for the platform's injected sources: a clock the test drives, a promise settler, and the document store's
 * port over a real store (an in-memory SQLite library unless a file is given).
 */
import type { Clock } from "../../src/platform/core/clock";
import type { DocumentStorePort } from "../../src/platform/api/document-store";
import type { DocumentStore } from "../../src/platform/persistence/document-store";
import { openTestLibrary } from "./library-file";

type Timer = { id: number; due: number; run: () => void; cancelled?: boolean };

/** A clock whose time moves only when the test advances it; timers run in due order (ties in the order they were set). */
export class ManualClock implements Clock {
  /** Monotonic time, from 0. */
  time = 0;
  private timers: Timer[] = [];
  private next = 1;
  /** `epoch`: the wall time at monotonic time 0 (1 January 2026, UTC). */
  constructor(readonly epoch = 1_767_225_600_000) {}
  now(): number { return this.epoch + this.time; }
  monotonic(): number { return this.time; }
  after(ms: number, run: () => void, signal?: AbortSignal): void {
    if (signal?.aborted) return;
    const timer: Timer = { id: this.next++, due: this.time + Math.max(0, ms), run };
    this.timers.push(timer);
    signal?.addEventListener("abort", () => { timer.cancelled = true; }, { once: true });
  }
  frame(run: (time: number) => void, signal?: AbortSignal): void { this.after(16, () => run(this.time), signal); }
  /** Timers still to run, earliest first. */
  pending(): readonly { due: number }[] {
    this.timers = this.timers.filter(timer => !timer.cancelled);
    return [...this.timers].sort((a, b) => a.due - b.due || a.id - b.id);
  }
  /** Moves time on by `ms`, running every timer that falls due, in order. */
  advance(ms: number): void {
    const until = this.time + Math.max(0, ms);
    for (;;) {
      const timer = this.pending()[0] as Timer | undefined;
      if (!timer || timer.due > until) break;
      this.timers = this.timers.filter(item => item !== timer);
      this.time = Math.max(this.time, timer.due);
      timer.run();
    }
    this.time = until;
  }
}

/** Lets pending promise reactions run. */
export async function settle(turns = 24): Promise<void> { for (let i = 0; i < turns; i++) await Promise.resolve(); }

/** The document store's port over a real store (in memory by default; a file's is closed with the test library). */
export function storeDocuments(path = ":memory:"): DocumentStorePort & { store: DocumentStore } {
  const store = openTestLibrary(path).documents;
  return { store, list: async kind => store.list(kind), put: async (kind, id, value, revision) => store.put(kind, id, value, revision) };
}
