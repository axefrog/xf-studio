// Fixtures for the simulation layer's tests: worlds over the fixture slice FX-3 and the Kabuki stand-in (S1 14).

import { H, s } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { type S1Data, defaultData } from '../../src/sim/data.ts';
import { fx3Slice, makeKabukiSlice } from '../../src/sim/slices.ts';
import { World } from '../../src/sim/world.ts';

export const seedOf = (name: string): Id => H(s('fixture'), s(name));

/** The unit-fixture data (S1 14): flat propensity, `cGeo` 4, defaults otherwise. */
export function fxData(tweak: (d: S1Data) => void = () => {}): S1Data {
  const d = defaultData();
  d.events.flatPropensity = true;
  d.ties.cGeo = 4;
  tweak(d);
  return d;
}

export function fxWorld(name: string, tweak?: (d: S1Data) => void): World {
  return World.create({ worldSeed: seedOf(name), index: fx3Slice(), data: fxData(tweak) });
}

let kabukiIndex: ReturnType<typeof makeKabukiSlice> | undefined;
export function kabukiWorld(name: string, tweak?: (d: S1Data) => void): World {
  kabukiIndex ??= makeKabukiSlice();
  const data = defaultData();
  tweak?.(data);
  return World.create({ worldSeed: seedOf(name), index: kabukiIndex, data });
}
