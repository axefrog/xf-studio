// Work accounting (spec 10.7): the shared allowance of an atomic operation, the defect log, and the
// budgeted, resumable worklists.

import type { Id, ResolveStatus } from './types.ts';

/** Thrown inside an atomic operation when a hard limit is hit; the outer operation turns it into `failed`. */
export class LimitExceeded extends Error {
  constructor(public readonly reason: string) {
    super(`work limit exceeded: ${reason}`);
  }
}

/**
 * A nested resolution failed. The outer operation fails with it, never reading the failed slot as a
 * missing value and carrying on with an incomplete answer (spec 8.4, SPEC-NOTES 54). An unavailable slot
 * is still an ordinary missing value.
 */
export class NestedFailure extends LimitExceeded {
  constructor(what: string) {
    super(`a nested resolution failed: ${what}`);
  }
}

/** Throw `NestedFailure` when a nested read came back `failed`. */
export function failIfFailed(status: ResolveStatus, what: string): void {
  if (status === 'failed') throw new NestedFailure(what);
}

/** One counter per outer operation (a resolution or a query). Nested work draws on the same counter. */
export class Allowance {
  used = 0;
  constructor(public readonly limit: number) {}

  /** Spend `n` units. Exhausting the allowance throws LimitExceeded. */
  spend(n = 1): void {
    this.used += n;
    if (this.used > this.limit) throw new LimitExceeded(`the shared allowance of ${this.limit} units`);
  }
}

export interface Defect {
  kind: string;
  detail: string;
  node?: Id;
  slot?: string;
}

/** Defects are recorded for inspection and never persisted (spec 5, 10.7). */
export class DefectLog {
  readonly items: Defect[] = [];
  record(d: Defect): void {
    this.items.push(d);
  }
  ofKind(kind: string): Defect[] {
    return this.items.filter((d) => d.kind === kind);
  }
  clear(): void {
    this.items.length = 0;
  }
}

/** A budget of work units for one tick. */
export class Budget {
  constructor(public remaining: number) {}
  get exhausted(): boolean {
    return this.remaining <= 0;
  }
  spend(n: number): void {
    this.remaining -= n;
  }
}

export interface StepResult {
  /** Work units the step consumed. */
  cost: number;
  /** True when the item is finished and leaves the list. */
  done: boolean;
}

/**
 * A worklist runs in a fixed order, and stops and resumes deterministically. A step either finishes
 * its head item or leaves it at the head with updated internal state, so a stop between two steps
 * loses nothing. The first step of a run is always taken, even if it costs more than the budget, so a
 * run always makes progress; an atomic item can therefore overshoot by at most its own cost.
 */
export class Worklist<T> {
  private items: T[] = [];

  get length(): number {
    return this.items.length;
  }
  get isEmpty(): boolean {
    return this.items.length === 0;
  }
  push(item: T): void {
    this.items.push(item);
  }
  peek(): T | undefined {
    return this.items[0];
  }
  clear(): void {
    this.items.length = 0;
  }
  snapshot(): T[] {
    return [...this.items];
  }

  /** Run steps until the list is empty or the budget runs out. Returns the number of steps taken. */
  run(budget: Budget, step: (item: T) => StepResult): number {
    let steps = 0;
    while (this.items.length > 0 && (steps === 0 || !budget.exhausted)) {
      const head = this.items[0]!;
      const r = step(head);
      budget.spend(r.cost);
      steps++;
      if (r.done) this.items.shift();
    }
    return steps;
  }
}
