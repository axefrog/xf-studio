// The protected set over time (S1 4.4, 5.4). An occurrence is cast from recorded history as of its own time, and an occurrence within the
// ring regenerates from that history: the protected set it read when it was first cast must be the one it reads again. The kernel holds
// the causes of protection while they are live (a `core:cast` edge of a live seed, an `observed` pin, a quest link), and drops the ended
// edge and the old reading when it saves. This module keeps their spans in the S1 record from each save, for as long as an occurrence can
// still regenerate, and answers "protected at `t`" for a time before now from the kernel's state and the spans together.
//
// The spans of a node are kept as their union, in order: a game that restates a quest link after a load makes a new reading inside a span
// already held, and the record must not depend on whether the game was saved and loaded.

import { edgeActive } from '../predicate.ts';
import type { GameTime, Id } from '../types.ts';
import type { Span } from './record.ts';
import type { Sim } from './sim.ts';

const covers = (s: Span, t: GameTime): boolean => s.from <= t && (s.to === undefined || t < s.to);

/** The union of spans, in order: overlapping and touching spans become one, and an open span takes in everything after it starts. */
export function unionOf(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((s) => s.to === undefined || s.to > s.from).map((s) => ({ ...s })).sort((a, b) => a.from - b.from || (a.to ?? Infinity) - (b.to ?? Infinity));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && (last.to === undefined || s.from <= last.to)) {
      if (last.to !== undefined && (s.to === undefined || s.to > last.to)) {
        if (s.to === undefined) delete last.to;
        else last.to = s.to;
      }
    } else out.push(s);
  }
  return out;
}

export class Protection {
  constructor(private readonly sim: Sim) {}

  private get k() {
    return this.sim.k;
  }

  /** Whether a recorded span of the node holds at `t`. */
  recordedAt(n: Id, t: GameTime): boolean {
    for (const s of this.sim.record.protect[n] ?? []) if (covers(s, t)) return true;
    return false;
  }

  /**
   * Whether the node was protected at a time before now, by what the kernel still holds or by what a save recorded. A cast edge counts for
   * the interval it was live in: what is protected as of `t` does not change when the cause later ends, or when the game is saved and loaded.
   */
  protectedBefore(n: Id, t: GameTime): boolean {
    const k = this.k;
    for (const e of k.store.edgesTo(n)) if (e.type === 'core:cast' && edgeActive(e, t)) return true;
    for (const p of k.store.pinsOfNode(n)) {
      if (p.reason !== 'observed' || p.at > t) continue;
      const w = k.store.withdrawn.get(p.id);
      if (w === undefined || w.at > t) return true;
    }
    return this.recordedAt(n, t);
  }

  /**
   * Write the spans the kernel holds into the record (a save calls this before it takes the record): every cast edge, observed pin and
   * quest-link reading, with the end of those that have ended, joined to the spans already recorded. Spans that ended before the oldest
   * occurrence that can regenerate are dropped.
   */
  capture(): void {
    const k = this.k;
    const held = new Map<Id, Span[]>();
    const add = (node: Id, s: Span): void => {
      const list = held.get(node);
      if (list) list.push(s);
      else held.set(node, [s]);
    };
    for (const e of k.store.allEdges()) {
      if (e.type === 'core:cast') add(e.to, e.valid.to === undefined ? { from: e.valid.from } : { from: e.valid.from, to: e.valid.to });
    }
    for (const p of k.store.allPins()) {
      if (p.reason === 'observed') {
        const w = k.store.withdrawn.get(p.id);
        add(p.node, w === undefined ? { from: p.at } : { from: p.at, to: Math.max(p.at, w.at) });
      } else if (p.reason === 'game' && p.slot === 'quest-linked' && p.value === 'yes') {
        add(p.node, p.valid.to === undefined ? { from: p.valid.from } : { from: p.valid.from, to: p.valid.to });
      }
    }
    const rec = this.sim.record.protect;
    for (const [node, spans] of held) rec[node] = unionOf([...(rec[node] ?? []), ...spans]);
    const keep = k.now - (this.sim.data.events.heatHorizon + 1) * this.sim.data.time.W;
    for (const node of Object.keys(rec)) {
      const spans = rec[node]!.filter((s) => s.to === undefined || s.to > keep);
      if (spans.length === 0) delete rec[node];
      else rec[node] = spans;
    }
  }
}
