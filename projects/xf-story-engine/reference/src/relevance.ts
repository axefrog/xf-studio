// Relevance dispatch (spec 10.5, 10.7): semantic changes matched against the registered interests of
// eligible frames, delivered to the declaring frame and its descendants, scored r = pullVia * m * s, and
// emitted when r >= theta_react.
//
// The first implementation scans every registered interest (spec 0.2). The scan is a resumable worklist:
// one unit per interest examined (plus the predicate work that examination consumes), demand roots
// first. Dispatch waits until the frame worklist is empty, so no consumer sees half-updated frames.

import type { Kernel } from './kernel.ts';
import { type Binding, namesNode, selectorMatches } from './predicate.ts';
import { INTEREST_TYPES, type InterestType } from './registry.ts';
import { newOpCtx } from './resolve.ts';
import type { Change, Edge, Id, PendingChange, Selector } from './types.ts';
import { type Budget, LimitExceeded } from './work.ts';

export interface Relevance {
  actor: Id;
  frame: Id;
  change: Change;
  revision: number;
  type: InterestType;
  r: number;
}

interface ScanEntry {
  frame: Id;
  actor: Id;
  type: InterestType;
  index: number;
  selector: Selector;
}

interface Active {
  pc: PendingChange;
  scan: ScanEntry[];
  pos: number;
  bindings: Binding[];
  wild: Extract<Change, { c: 'contribution' }> | null;
  includeEdge?: Edge;
  best: Map<string, { rel: Relevance; ord: number }>;
}

const NO_SLOT = '\u0000none';

export function bindingsOf(change: Change): { bindings: Binding[]; wild: Extract<Change, { c: 'contribution' }> | null } {
  switch (change.c) {
    case 'pin':
    case 'reading':
      return { bindings: [{ node: change.node, slot: change.slot }], wild: null };
    case 'edge':
      return {
        bindings: [
          { node: change.edge.from, role: 'from', edge: change.edge.type },
          { node: change.edge.to, role: 'to', edge: change.edge.type },
        ],
        wild: null,
      };
    case 'event': {
      const out: Binding[] = [{ node: change.event }];
      if (change.place !== undefined) out.push({ node: change.place, role: 'place' });
      for (const p of change.participants) out.push({ node: p.who, role: p.role });
      for (const e of change.effects) out.push({ node: e.on, role: 'target', effect: e.effect });
      return { bindings: out, wild: null };
    }
    case 'minted':
      return { bindings: [{ node: change.node }], wild: null };
    case 'contribution': {
      const sc = change.contribution.target.scope;
      if (sc && 'nodes' in sc) return { bindings: sc.nodes.map((n): Binding => ({ node: n, slot: change.contribution.target.slot })), wild: null };
      return { bindings: [], wild: change };
    }
  }
}

export class Dispatcher {
  private active: Active | null = null;
  readonly emitted: Relevance[] = [];
  private listeners: Array<(r: Relevance) => void> = [];

  constructor(private readonly k: Kernel) {}

  get idle(): boolean {
    return this.active === null && this.k.pending.length === 0;
  }

  onRelevance(cb: (r: Relevance) => void): void {
    this.listeners.push(cb);
  }

  /** Take the emissions made so far. */
  drain(): Relevance[] {
    return this.emitted.splice(0, this.emitted.length);
  }

  /** Drop all in-flight state (a load, spec 14.3). */
  reset(): void {
    this.active = null;
    this.emitted.length = 0;
  }

  private begin(pc: PendingChange): Active {
    const { bindings, wild } = bindingsOf(pc.change);
    const a: Active = { pc, scan: this.k.frames.scanList(), pos: 0, bindings, wild, best: new Map() };
    if (pc.change.c === 'edge' && pc.change.ended) a.includeEdge = pc.change.edge;
    return a;
  }

  private specificity(sel: Selector, node: Id | null, env: ReturnType<Kernel['resolver']['makeEnv']>): number {
    const sp = this.k.config.specificity;
    if (node !== null && namesNode(env, sel, node)) return sp.id;
    let s = 0;
    if ((sel.where ?? []).some((p) => p.path.endsWith(':bucket'))) s = Math.max(s, sp.bucket);
    if (sel.kind !== undefined) s = Math.max(s, sp.kind);
    return s === 0 ? sp.bucket : s;
  }

  private overlaps(sel: Selector, t: Selector): boolean {
    const schema = this.k.schema;
    if (sel.kind !== undefined && t.kind !== undefined) {
      if (!schema.hasKind(sel.kind) || !schema.hasKind(t.kind)) return false;
      if (!schema.isKind(sel.kind, t.kind) && !schema.isKind(t.kind, sel.kind)) return false;
    }
    if (sel.slot !== '*' && t.slot !== '*' && sel.slot !== t.slot) return false;
    if (sel.scope && t.scope && 'nodes' in sel.scope && 'nodes' in t.scope) {
      const a = new Set(sel.scope.nodes.map((n) => this.k.expandId(n)));
      return t.scope.nodes.some((n) => a.has(this.k.expandId(n)));
    }
    return true;
  }

  /** Examine one interest against the active change. Returns the work units used. */
  private examine(a: Active, e: ScanEntry): number {
    const k = this.k;
    const ctx = newOpCtx(k.config.allowance);
    let bestS = -1;
    try {
      for (const b of a.bindings) {
        const env = k.resolver.makeEnv(ctx, a.pc.time, undefined, b);
        if (a.includeEdge) env.includeEdge = a.includeEdge;
        if (selectorMatches(env, e.selector, b.node, b.slot ?? NO_SLOT)) {
          bestS = Math.max(bestS, this.specificity(e.selector, b.node, env));
        }
      }
      if (a.wild && this.overlaps(e.selector, a.wild.contribution.target)) {
        const env = k.resolver.makeEnv(ctx, a.pc.time);
        bestS = Math.max(bestS, this.specificity(e.selector, null, env));
      }
    } catch (err) {
      if (!(err instanceof LimitExceeded)) throw err;
      k.defects.record({ kind: 'limit', detail: `matching an interest: ${err.message}` });
    }
    const fr = k.frames;
    if (bestS >= 0) {
      const m = k.config.matchWeight[e.type];
      const memo = new Map<Id, number>();
      const full = new Map<Id, number>();
      for (const d of fr.deliveryTargets(e.frame)) {
        const r = fr.pullVia(d, e.frame, memo, full) * m * bestS;
        const df = fr.frame(d)!;
        const key = `${d}|${e.type}`;
        const ord = a.pos;
        const have = a.best.get(key);
        if (!have || r > have.rel.r || (r === have.rel.r && ord < have.ord)) {
          a.best.set(key, { rel: { actor: df.actor, frame: d, change: a.pc.change, revision: a.pc.revision, type: e.type, r }, ord });
        }
      }
    }
    return 1 + ctx.allowance.used;
  }

  private finish(a: Active): void {
    const fr = this.k.frames;
    const typeIdx = (t: InterestType): number => INTEREST_TYPES.indexOf(t);
    const rows = [...a.best.values()].filter((x) => x.rel.r >= this.k.config.thetaReact);
    rows.sort((x, y) => {
      const rx = fr.demandRoots.has(x.rel.actor) ? 0 : 1;
      const ry = fr.demandRoots.has(y.rel.actor) ? 0 : 1;
      return (
        rx - ry ||
        (x.rel.actor < y.rel.actor ? -1 : x.rel.actor > y.rel.actor ? 1 : 0) ||
        (x.rel.frame < y.rel.frame ? -1 : x.rel.frame > y.rel.frame ? 1 : 0) ||
        typeIdx(x.rel.type) - typeIdx(y.rel.type) ||
        x.ord - y.ord
      );
    });
    for (const row of rows) {
      this.emitted.push(row.rel);
      for (const l of this.listeners) l(row.rel);
    }
  }

  /**
   * Run dispatch within a budget. It does nothing until the frame worklist is empty. The first step is
   * always taken; each step is one interest, so a step never overshoots by more than its own predicate work.
   */
  run(budget: Budget): number {
    if (!this.k.frames.worklist.isEmpty) return 0;
    let steps = 0;
    for (;;) {
      if (!this.active) {
        const pc = this.k.pending.shift();
        if (!pc) break;
        if (pc.epoch !== this.k.epoch) continue;
        this.active = this.begin(pc);
      }
      const a = this.active;
      while (a.pos < a.scan.length) {
        if (steps > 0 && budget.exhausted) return steps;
        budget.spend(this.examine(a, a.scan[a.pos]!));
        a.pos++;
        steps++;
      }
      this.finish(a);
      this.active = null;
      if (steps > 0 && budget.exhausted) break;
    }
    return steps;
  }
}
