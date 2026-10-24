// Staged batches (spec 14.2a, v4, V4-26): layer 2 tries a set of changes, checks them, and keeps them only
// if the checks pass.
//
//   1. open: `Kernel.stage()`. What the batch writes is visible to resolution, `trace` and queries made
//      through it (and, since the reference model applies the writes to the live tables, to nothing else
//      that can run: no other write is interleaved with an open batch).
//   2. silence: while it is open the batch emits no changes, relevance or dilemmas; its writes are not
//      persisted. The changes it would have emitted wait in `changes`.
//   3. commit: the writes stay, the revision advances, and the changes are dispatched in the order the
//      operations were made.
//   4. discard: the kernel's tables, the revision and every cache go back to what they were. No operation,
//      change or revision remains.
//
// The reference model implements the batch by snapshot and restore, as the specification allows.

import type { Kernel } from './kernel.ts';
import { type OpCtx, type Trace, newOpCtx } from './resolve.ts';
import { Allowance } from './work.ts';
import type { GameTime, Id, PendingChange, Query, QueryOutcome, ResolveResult, SlotPath, Value } from './types.ts';

interface Mark {
  revision: number;
  store: unknown;
  frames: unknown;
  beliefs: unknown;
  events: unknown;
  groups: unknown;
  retention: unknown;
  summaries: unknown;
  settings: unknown;
  defects: number;
}

export class StagedBatch {
  /** The changes the batch's writes made, in order. They are dispatched on commit. */
  readonly changes: PendingChange[] = [];
  /** Notifications the batch's writes made to layers outside the kernel's tables (a belief changed): delivered on commit, dropped with a discard. */
  readonly after: Array<() => void> = [];
  state: 'open' | 'committed' | 'discarded' = 'open';
  private mark: Mark;
  /** The one allowance every read made through the batch draws on (spec 14.2a, 10.7). */
  private readonly allowance: Allowance;

  constructor(private readonly k: Kernel) {
    this.allowance = newOpCtx(k.config.allowance).allowance;
    this.mark = {
      revision: k.revision,
      store: k.store.capture(),
      frames: k.frames.capture(),
      beliefs: k.beliefs.capture(),
      events: k.events.capture(),
      groups: k.groups.capture(),
      retention: k.retention.capture(),
      summaries: k.summaries.capture(),
      settings: k.settings.capture(),
      defects: k.defects.items.length,
    };
  }

  private assertOpen(): void {
    if (this.state !== 'open') throw new Error(`the staged batch is ${this.state}`);
  }

  /** Run kernel writes inside the batch. Everything written is visible through the batch, silent, and discarded with it. */
  write<T>(fn: (k: Kernel) => T): T {
    this.assertOpen();
    const was = this.k.batchWriting;
    this.k.batchWriting = true;
    try {
      return fn(this.k);
    } finally {
      this.k.batchWriting = was;
    }
  }

  // ---- reads through the batch ----

  /** The work allowance the batch has used so far (spec 14.2a). */
  get used(): number {
    return this.allowance.used;
  }

  /** The shared allowance ran out: a read made through the batch failed, so nothing it checked can be trusted (R2-01). */
  get exhausted(): boolean {
    return this.allowance.used > this.allowance.limit;
  }

  /** A fresh operation context that draws on the batch's shared allowance. */
  private ctx(): OpCtx {
    return { allowance: this.allowance, stack: new Set(), depth: 0, peak: 0 };
  }

  resolve(node: Id, path: SlotPath, t?: GameTime): ResolveResult {
    this.assertOpen();
    return this.k.resolver.resolve(node, path, t ?? this.k.now, this.ctx());
  }

  value(node: Id, path: SlotPath, t?: GameTime): Value | undefined {
    const r = this.resolve(node, path, t);
    return r.status === 'ok' || r.status === 'contradiction' ? r.value : undefined;
  }

  trace(node: Id, path: SlotPath, t?: GameTime): Trace {
    this.assertOpen();
    return this.k.resolver.trace(node, path, t ?? this.k.now, this.ctx());
  }

  query(q: Query): QueryOutcome {
    this.assertOpen();
    return this.k.queries.run(q, this.ctx());
  }

  // ---- ending ----

  /** Keep the writes: they persist from now, the revision advances, and their changes are dispatched in order. */
  commit(): void {
    this.assertOpen();
    if (this.exhausted) throw new Error('the staged batch ran out of its work allowance: it is discarded, not committed (spec 14.2a)');
    this.state = 'committed';
    this.k.batch = null;
    this.k.pending.push(...this.changes);
    this.k.bump();
    // delivered with the batch no longer open, as if the writes had been made now
    const after = this.after.splice(0);
    for (const f of after) f();
  }

  /** Drop the writes: tables, revision and caches go back to what they were. */
  discard(): void {
    this.assertOpen();
    this.state = 'discarded';
    const k = this.k;
    k.batch = null;
    k.store.restoreFrom(this.mark.store);
    k.frames.restoreFrom(this.mark.frames);
    k.beliefs.restoreFrom(this.mark.beliefs);
    k.events.restoreFrom(this.mark.events);
    k.groups.restoreFrom(this.mark.groups);
    k.retention.restoreFrom(this.mark.retention);
    k.summaries.restoreFrom(this.mark.summaries);
    k.settings.restoreFrom(this.mark.settings);
    k.defects.items.length = this.mark.defects;
    k.revision = this.mark.revision;
    k.invalidateCaches();
    this.changes.length = 0;
    this.after.length = 0;
  }
}
