// Preserve Kabuki's cells, affiliations and recipes while using fewer residents
// in the default integration fixtures. FULL/SOAK retain the original index.
import { hrec } from '../../src/canon.ts';
import { H, s } from '../../src/id.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';

export function kabukiFixture(density = 0.1) {
  const index = makeKabukiSlice();
  if (process.env.S1_FULL !== '1' && process.env.S1_SOAK !== '1') {
    for (const district of Object.values(index.districts)) if (district.simulated) district.rho *= density;
    const { hash: _hash, ...content } = index;
    index.hash = H(s('world-index'), hrec(content));
  }
  return index;
}
