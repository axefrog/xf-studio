// Bind the simulation context once; S3 receives no mutable Sim reference.
import type { PatternWorldPort } from '../seeding/pattern-types.ts';
import type { Sim } from './sim.ts';
import { groupOf } from './outcomes.ts';

export function patternWorld(sim: Sim): PatternWorldPort {
  return {
    stateRules: (fn) => sim.stateRules.filter((r) => r.fn === fn).map((r) => ({
      fn: r.fn, id: r.id, durable: r.durable, changes: structuredClone(r.changes),
      fromChange: (c) => structuredClone(r.fromChange(c, sim)), endsBy: (c, f) => r.endsBy(c, f, sim),
      search: (a, n, t, limit) => structuredClone(r.search(a, n, t, sim, limit)), holdsAt: (f, t) => r.holdsAt(f, t, sim),
    })),
    relation: (name, args, at) => {
      if (name === 'member') { const g = groupOf(sim, args[0], at); return g === undefined ? 'maybe' : g === args[1] ? 'yes' : 'no'; }
      if (name === 'tied') return sim.reads.tiedAt(args[0], args[1], args[2], at) as 'yes' | 'no' | 'maybe';
      if (name === 'alive') return sim.people.alive(args[0], at) ? 'yes' : 'no';
      return 'maybe';
    },
    relationSearch: (name, bound, at, limit) => {
      const rows: Array<{ id: string; args: Record<string, string> }> = [];
      if (name === 'member' && bound.who) {
        const group = groupOf(sim, bound.who, at);
        if (group) rows.push({ id: group, args: { who: bound.who, group } });
      } else if (name === 'member' && bound.group) {
        // The built S1 has no reverse index of implicit profile memberships.
        // Read its materialised reverse index; never sweep the population here.
        sim.k.persistence.recoverIfSaved(bound.group);
        for (const edge of sim.k.store.edgesTo(bound.group)) if (edge.type === 'core:member-of' && edge.valid.from <= at
          && (edge.valid.to === undefined || at < edge.valid.to)) rows.push({ id: edge.id, args: { who: edge.from, group: bound.group } });
      }
      rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return { tuples: rows.slice(0, limit), truncated: rows.length > limit };
    },
  };
}
