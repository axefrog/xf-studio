// Layer 2 over the simulation layer (S1 9.1, S2 2.16, 2.17): the reads S1 builds become the `city` and `social` atoms of the seeds, and the
// spine S1 keeps is the set of main-story characters the director never casts. Layer 2 holds none of S1's code: it is handed this port.

import { Layer2, type Layer2Options } from '../seeding/layer2.ts';
import { L2Registry } from '../seeding/registries.ts';
import type { Sim } from './sim.ts';

/** Build layer 2 on the kernel of a sim, with its reads attached. */
export function attachLayer2(sim: Sim, opts: Omit<Layer2Options, 'worldRegistry'>): Layer2 {
  const reg = opts.reg ?? new L2Registry();
  reg.sim = sim.reads.port();
  return new Layer2(sim.k, { ...opts, reg, worldRegistry: sim.reads });
}
