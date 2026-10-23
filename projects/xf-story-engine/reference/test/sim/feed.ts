// Helpers for the fixtures that run a sim through calls, saves and loads: a deterministic generator, a transfer to a fresh process, and the
// game restating what it knows after a load.

import type { SaveRecord } from '../../src/persistence.ts';
import { ReplayPort, type ReplayLine } from '../../src/sim/port.ts';
import type { Sim } from '../../src/sim/sim.ts';

/** A small deterministic generator: the named stream of a fixture (its seed is logged by whoever draws from it). */
export function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

export const chainOf = (sim: Sim): Map<string, SaveRecord> => (sim.k.persistence as unknown as { chain: Map<string, SaveRecord> }).chain;

/** A fresh process of the same lineage: a new sim that holds the save chain of `from`, under another epoch, loaded at `key`. */
export function transfer(from: Sim, key: string, make: () => Sim, epochs = 7): Sim {
  const fresh = make();
  for (const [k, r] of chainOf(from)) chainOf(fresh).set(k, structuredClone(r));
  for (let i = 0; i < epochs; i++) fresh.k.newEpoch();
  fresh.k.persistence.load(key);
  return fresh;
}

/** What the game states again after a load: the latest of every reading, and the events that have not happened yet. */
export function restate(sim: Sim, lines: readonly ReplayLine[]): void {
  const now = sim.k.now;
  const latest = new Map<string, ReplayLine>();
  const out: ReplayLine[] = [];
  for (const l of lines) {
    if (l.op === 'event') {
      if (l.t >= now) out.push(l);
    } else if (l.op === 'reading') {
      if (l.t <= now) latest.set(`${l.node}|${l.slot}`, { ...l, t: now });
      else out.push(l);
    } else if (l.op === 'person') {
      if (l.t <= now) {
        const have = latest.get(`person|${l.key}`);
        const slots = { ...(have && have.op === 'person' ? have.slots : {}), ...l.slots };
        latest.set(`person|${l.key}`, { ...l, slots, t: now });
      } else out.push(l);
    }
  }
  new ReplayPort(sim).submit([...latest.values(), ...out]);
}
