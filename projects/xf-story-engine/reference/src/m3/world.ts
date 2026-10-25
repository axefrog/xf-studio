// The M3 world: Kabuki through S1, layer 2 with the packs, and layer 3 when sowing is on. Everything is built from a
// name (the world seed) and the options, and nothing here reads a clock or a random source of its own.
//
// The district is S1's Kabuki slice: the game's real figures for the district (entry quantity 2,964, the gang counts) over
// a generated stand-in graph, until the real world index is built (SPEC-NOTES, S1 3.2).

import { H, s } from '../id.ts';
import { Layer3 } from '../procedural/layer3.ts';
import type { Layer3Data, SiftPattern, Tempo } from '../procedural/types.ts';
import { ScriptPort } from '../seeding/port.ts';
import type { Layer2 } from '../seeding/layer2.ts';
import type { Pack, Finding } from '../seeding/types.ts';
import { type S1Data, defaultData } from '../sim/data.ts';
import { attachLayer2 } from '../sim/layer2-wire.ts';
import { ReplayPort } from '../sim/port.ts';
import { Sim } from '../sim/sim.ts';
import { makeKabukiSlice } from '../sim/slices.ts';
import { factsTable } from './facts.ts';

let slice: ReturnType<typeof makeKabukiSlice> | undefined;

export interface WorldOpts {
  /** The name the world seed is made from: the same name and options give the same world. */
  name: string;
  /** Sowing on or off (layer 3 attached or not). */
  layer3: boolean;
  tempo?: Tempo;
  packs: Pack[];
  patterns?: SiftPattern[];
  /** Changes to S1's tunables for the run (recorded by name in the transcript). */
  s1?: (d: S1Data) => void;
  l3Data?: Layer3Data;
}

export interface M3World {
  sim: Sim;
  l2: Layer2;
  l3?: Layer3;
  port: ScriptPort;
  replay: ReplayPort;
  findings: Finding[];
}

export function buildWorld(o: WorldOpts): M3World {
  slice ??= makeKabukiSlice();
  const data = defaultData();
  o.s1?.(data);
  const sim = Sim.create({ worldSeed: H(s('m3'), s(o.name)), index: slice, data });
  // S2's casting searches the kernel for residents, and S1 realises a resident only when something touches its block. Demand every block
  // of the simulated district once, as the host would for a district V stands in, so that a seed can cast from the people who live there.
  for (const d of sim.w.districts) for (const cell of d.cellIds) sim.people.residentsOfBlock(cell);
  const port = new ScriptPort();
  const l2 = attachLayer2(sim, { port, facts: factsTable() });
  const findings: Finding[] = [];
  for (const pack of o.packs) findings.push(...l2.installPack(pack));
  const l3 = o.layer3 ? new Layer3(l2, { registry: sim.w.kinds, patterns: o.patterns ?? [], ...(o.l3Data ? { data: o.l3Data } : {}) }) : undefined;
  if (l3) findings.push(...l3.findings);
  sim.k.settings.set({ tempo: o.layer3 ? (o.tempo ?? 'steady') : 'off' });
  sim.k.settle();
  return { sim, l2, ...(l3 ? { l3 } : {}), port, replay: new ReplayPort(sim), findings };
}
