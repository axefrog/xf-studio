// Provenance and explanation (spec 13): the trace is the complete account (I-8); `explain` is a
// labelled heuristic over it; and every record names its cause.

import { ln } from './fdlibm-log.ts';
import type { Kernel } from './kernel.ts';
import type { Constraint } from './resolve.ts';
import type { GameTime, Id, SlotPath, Value } from './types.ts';

export interface ExplainEntry {
  /** The contribution Id, or "prior". */
  id: Id | 'prior';
  kind: 'prior' | 'weight' | 'replaced-prior';
  strength: number;
  /** strength * (ln f_hat(v*) - ln f_hat(v2)): positive favoured the winner over the runner-up. */
  effect: number;
}

export type Explanation =
  | {
      mode: 'discriminating';
      /** Labelled a heuristic (spec 13). */
      heuristic: true;
      value: Value;
      runnerUp: Value;
      /** The top k contributions by absolute effect, signed. */
      entries: ExplainEntry[];
      /** Every contribution's effect summed: the winner's score lead before noise. */
      scoreLead: number;
    }
  | { mode: 'constraints'; value: Value; active: Constraint[] }
  | { mode: 'none'; reason: string };

export interface CauseProblem {
  record: string;
  id: Id;
  problem: string;
}

const cmpId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class Provenance {
  constructor(private readonly k: Kernel) {}

  /**
   * Explain a resolution. With two or more feasible values: the top k contributions by absolute
   * discriminating effect, signed, the prior included as an entry (SPEC-NOTES 28). With one: the active
   * constraints that produced it.
   */
  explain(node: Id, path: SlotPath, t: GameTime = this.k.now): Explanation {
    this.k.persistence.recoverIfSaved(node);
    const tr = this.k.trace(node, path, t);
    if (tr.value === undefined) return { mode: 'none', reason: `the slot is ${tr.status}` };
    if (tr.mode === 'derived' || tr.mode === 'mirrored') return { mode: 'none', reason: `a ${tr.mode} slot has no draw to explain` };
    if (tr.winner && tr.runnerUp && tr.scores.length >= 2) {
      const entries: ExplainEntry[] = tr.factors.map((f) => {
        const lnW = ln(f.atWinner);
        const lnR = ln(f.atRunnerUp ?? f.atWinner);
        return { id: f.id, kind: f.kind, strength: f.strength, effect: f.strength * (lnW - lnR) };
      });
      const scoreLead = entries.reduce((a, e) => a + e.effect, 0);
      entries.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || cmpId(String(a.id), String(b.id)));
      return {
        mode: 'discriminating', heuristic: true, value: tr.winner.value, runnerUp: tr.runnerUp.value,
        entries: entries.slice(0, this.k.config.explainTopK), scoreLead,
      };
    }
    return { mode: 'constraints', value: tr.value, active: tr.constraints.filter((c) => c.active) };
  }

  /** The cause a record names, or undefined. A belief's cause is the event that supports it. */
  causeOf(id: Id): Id | string | undefined {
    this.k.persistence.recoverIfSaved(id);
    const k = this.k;
    const pin = k.store.pin(id);
    if (pin) return pin.cause;
    const c = k.store.contribution(id);
    if (c) return c.source.origin;
    const e = k.store.edges.get(id);
    if (e) return e.cause;
    const f = k.frames.frame(id);
    if (f) return f.cause;
    const h = k.store.header(id);
    if (h) return h.origin.by === 'minted' ? h.origin.cause : undefined;
    for (const { belief: b } of k.beliefs.entries()) {
      if (b.id === id) return b.source.by === 'inferred' ? b.source.from[0] ?? b.subject : b.source.event;
    }
    for (const d of k.frames.dilemmas) if (d.id === id) return d.cause;
    return undefined;
  }

  /** The chain of causes from a record, following each cause that is itself a record (bounded). */
  causeChain(id: Id, limit = 16): Array<Id | string> {
    this.k.persistence.recoverIfSaved(id);
    const out: Array<Id | string> = [];
    let cur: Id | string | undefined = this.causeOf(id);
    while (cur !== undefined && out.length < limit && !out.includes(cur)) {
      out.push(cur);
      cur = this.causeOf(cur);
    }
    return out;
  }

  /** Every pin, contribution, edge, belief, minted event, frame and dilemma must name a cause (spec 13). */
  verifyCauses(): CauseProblem[] {
    const k = this.k;
    const bad: CauseProblem[] = [];
    const need = (record: string, id: Id, cause: Id | string | undefined): void => {
      if (cause === undefined || cause === '') bad.push({ record, id, problem: 'no cause' });
    };
    for (const p of k.store.allPins()) need('pin', p.id, p.cause);
    for (const c of k.store.allContributions()) need('contribution', c.id, c.source.origin);
    for (const e of k.store.allEdges()) need('edge', e.id, e.cause);
    for (const { belief: b } of k.beliefs.entries()) need('belief', b.id, this.causeOf(b.id));
    for (const f of k.frames.all()) need('frame', f.id, f.cause);
    for (const d of k.frames.dilemmas) need('dilemma', d.id, d.cause);
    for (const h of k.store.headers.values()) {
      if (h.origin.by === 'minted') need(h.kind.includes('event') ? 'event' : 'minted', h.id, h.origin.cause);
    }
    return bad;
  }
}
