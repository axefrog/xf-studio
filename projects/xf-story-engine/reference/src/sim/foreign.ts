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

/**
 * The index of the events other creators than S1's made, found at the moment they are minted and kept only for the windows that can still
 * take them (the last seven, S1 7.8). It is derived from the events themselves: a load clears it, and the first scan after one rebuilds it
 * from the headers the replay put back, so a run that went on and a run that was saved and loaded hold the same entries. Each window then
 * looks at a handful of entries, not at every header of the world, and an entry leaves the index when its window has passed.
 */
export class ForeignEvents {
  /** Event Id to its minted time, for the events of seeds and of the port that are still within reach. */
  private readonly entries = new Map<Id, GameTime>();
  private readonly own: Set<Id>;
  /** True until the first scan after a load (or at the start), which looks at every saved and live event header once. */
  private rebuild = true;

  constructor(private readonly sim: Sim) {
    this.own = ownCreatorsOf(sim);
    sim.k.events.mintObservers.push((id, spec) => {
      if (this.own.has(spec.creator) || /^item:\d+$/.test(spec.name)) return;
      this.entries.set(id, spec.time);
    });
    sim.k.loadHooks.push(() => this.reset());
  }

  /** Forget everything derived: a replacement load (S0 14.3) leaves nothing of the branch it discards. */
  reset(): void {
    this.entries.clear();
    this.rebuild = true;
  }

  /** The number of events the index holds, for the bounded-index test. */
  get size(): number {
    return this.entries.size;
  }

  private rebuildFrom(lowest: GameTime): void {
    const sim = this.sim;
    this.rebuild = false;
    for (const id of sim.k.persistence.discoveryIdsOfKind('core:event')) {
      const h = sim.k.persistence.restoreReferencedHeader(id);
      if (!h || h.origin.by !== 'minted' || this.own.has(h.origin.creator) || /^item:\d+$/.test(h.origin.name)) continue;
      const time = sim.k.value(id, 'time');
      if (typeof time === 'number' && time >= lowest) this.entries.set(id, time);
    }
  }

  /** The events of the kinds, from other creators, in the last seven windows and before this one began, not in `seen`, in `(time, Id)` order. */
  scan(kinds: readonly string[], w: number, T: GameTime, seen: ReadonlySet<Id>): Array<{ id: Id; ev: EventView }> {
    const sim = this.sim;
    const lowest = sim.windowStart(Math.max(0, w - 6));
    if (this.rebuild) this.rebuildFrom(lowest);
    const found: Array<{ id: Id; time: GameTime }> = [];
    for (const [id, minted] of [...this.entries]) {
      if (minted < lowest) { this.entries.delete(id); continue; }
      if (seen.has(id)) continue;
      const h = sim.k.persistence.restoreReferencedHeader(id);
      if (!h) { this.entries.delete(id); continue; }
      const kind = sim.k.value(id, 'kind');
      const time = sim.k.value(id, 'time');
      if (typeof kind !== 'string' || typeof time !== 'number' || !kinds.includes(kind) || time < lowest) continue;
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
