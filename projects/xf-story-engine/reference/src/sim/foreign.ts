// The events of other creators than S1's own (S1 7.3 find-and-deduplicate, 7.8, 7.10): the wrongs, favours, promises and repairs that a
// seed or the port minted. S1's own events are thousands; these are few. They are found by their headers, not by a query over every event,
// and each is taken once, by its canonical origin, through the reader's `seen` list.

import { processCause } from '../evolution.ts';
import type { GameTime, Id } from '../types.ts';
import type { EventFact } from './occ.ts';
import type { EventView } from './policies.ts';
import { partiesOf } from './outcomes.ts';
import type { Sim } from './sim.ts';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Every creator that is S1's own (the processes, the policies' record node): an event made by one of them is never a seed's or the port's. */
export const ownCreatorsOf = (sim: Sim): Set<Id> =>
  new Set<Id>([sim.w.s1, ...['city.events', 'city.mirror', 'order.norms', 'group.decide', 'scene.acts', 'people.goals'].map((p) => processCause(p))]);

export class ForeignEvents {
  /**
   * Facts that never change (an event of S1's, of another kind, or too old to be taken): a cache that a reload may lose without changing a
   * result, since the first window of a session looks at the saved events as well.
   */
  private readonly settled = new Set<Id>();
  private readonly own: Set<Id>;

  constructor(private readonly sim: Sim, private readonly kinds: readonly string[]) {
    this.own = ownCreatorsOf(sim);
  }

  /** The events of the kinds, from other creators, in the last seven windows and before this one began, not in `seen`, in `(time, Id)` order. */
  scan(w: number, T: GameTime, seen: ReadonlySet<Id>): Array<{ id: Id; ev: EventView }> {
    const sim = this.sim;
    const lowest = sim.windowStart(Math.max(0, w - 6));
    const found: Array<{ id: Id; time: GameTime }> = [];
    const candidates = this.settled.size === 0 ? sim.k.persistence.discoveryIdsOfKind('core:event') : [...sim.k.store.eachIdOfKind('core:event')];
    for (const id of candidates) {
      if (this.settled.has(id) || seen.has(id)) continue;
      const h = sim.k.persistence.restoreReferencedHeader(id);
      if (!h || h.origin.by !== 'minted' || this.own.has(h.origin.creator) || /^item:\d+$/.test(h.origin.name)) { this.settled.add(id); continue; }
      const kind = sim.k.value(id, 'kind');
      const time = sim.k.value(id, 'time');
      if (typeof kind !== 'string' || typeof time !== 'number') continue;
      if (!this.kinds.includes(kind) || time < lowest) { this.settled.add(id); continue; }
      if (time <= T - 1) found.push({ id, time });
    }
    found.sort((a, b) => a.time - b.time || cmp(a.id, b.id));
    return found
      .map((x) => ({ id: x.id, ev: sim.policies.viewEvent(x.id) }))
      .filter((x): x is { id: Id; ev: EventView } => x.ev !== undefined && x.ev.creator !== undefined && !this.own.has(x.ev.creator));
  }

  /** The typed fact of an event of a seed or the port, as the feeds carry it (S1 7.2), or undefined if its place is not a cell of the index. */
  factOf(id: Id, e: EventView, w: number): EventFact | undefined {
    const sim = this.sim;
    const cell = e.place !== undefined ? sim.w.index.cells[e.place] : undefined;
    if (!cell) return undefined;
    const pub = cell.public === 'public' && e.witnesses.length >= sim.data.norms.publicMinWitnesses;
    return {
      id, kind: e.kind, size: 1, w, time: e.time, cell: e.place!, district: cell.district, public: pub, witnesses: e.witnesses.length, policeChild: false, creator: 'sim',
      outcome: (e.outcome as EventFact['outcome'] | undefined) ?? 'done', parties: partiesOf(sim, e.participants, e.time), effects: e.effects.map((x) => ({ ...x })),
    };
  }
}
