// The configuration of M3 run 2 (iteration 2: hooks that ask something of the protagonist). One place says what a run 2 world is made of, so
// the hook runs, the tests and the packet are built from the same settings:
//   - the wide name registry (S1 pack data, src/sim/names.ts);
//   - the run 1 texture tier (S3's plants: sown news as a trace) and the new offer tier (hooks with an ask);
//   - layer 3's tunables, tuned as data and nothing else (the ranking weights below);
//   - arm A1 as the same data with the selection switched off, as in run 1.
// No engine rule is changed: the weights are `Layer3Data` fields S3 defines (S3 2.1) and the names are pack data.

import { defaultData as l3Default } from '../procedural/data.ts';
import type { Layer3Data, Tempo } from '../procedural/types.ts';
import { WIDE_NAMES } from '../sim/names.ts';
import { density } from './driver.ts';
import type { WorldOpts } from './world.ts';
import { randomWithinGates } from './arms.ts';
import { hookPack, hookPatterns } from './hooks.ts';
import { offerKitPack, offerPatterns } from './offers.ts';
import { r2Pack } from './r2.ts';

/**
 * What layer 3's ranking weighs (S3 6.5, 7.4) and how the data is tuned so that it favours what run 1 found missing.
 *
 * The four features of a completed match, each banded across the slot's candidates:
 *   F3  stakes: distinct (who, effect) pairs with a harmful effect over the match's events (harm, take, protect, rescue, kill, expose). The
 *       offer patterns each carry one, so among offers it is constant and is skipped; against a texture candidate it is the same one. It would
 *       rank a chain that harms and then protects above a single incident, but S1 opens almost no such chains near V (see the results).
 *   F5  personal link: the people the match binds that V has been shown (presented), plus 2 if V took part. An offer exists only where V took
 *       part in a stage's event (gate 5: V was told), so every offer candidate carries at least 2 and a texture candidate usually carries none.
 *       It is how the ranking prefers a hook about people V has met over news about people V has not.
 *   F6  irreversibility: kill or expose. The kits tell nothing that irreversible, so it is constant and is skipped.
 *   F11 timeliness: how recent the last event is.
 * A completed match stays a candidate for one game day, not three (`sifter.candidateTtl`): the pool is what a slot ranks, and a pool of three days of
 * incidents makes every run slower without making a hook more timely.
 * Weights double the first two and keep the rest; `lambda` is raised so that the bands tilt the draw clearly (the default tilt of one
 * natural-log unit makes the best candidate only 2.7 times likelier than the worst); `diversity` is raised so that a kit or a place that was
 * sown lately is much less likely to be sown again (the repeated frames run 1's critics named).
 */
export function run2Layer3(): Layer3Data {
  const d = l3Default();
  d.sower.featureWeights = { F3: 2, F5: 2, F6: 1, F11: 1 };
  d.sower.lambda = 3;
  d.sower.diversity = 1;
  d.sifter.candidateTtl = 86_400;
  return d;
}

export type Run2Arm = 'E' | 'A1';

export function run2World(name: string, arm: Run2Arm, tempo: Tempo): { opts: WorldOpts; notes: string[] } {
  const dens = density(8);
  const data = run2Layer3();
  return {
    opts: {
      name, layer3: true, tempo,
      packs: [r2Pack(), hookPack(), offerKitPack()],
      patterns: [...hookPatterns(), ...offerPatterns()],
      s1: (d) => { dens.apply(d); d.people.names = WIDE_NAMES; },
      l3Data: arm === 'A1' ? randomWithinGates(data) : data,
    },
    notes: [
      dens.name,
      'the wide name registry of S1\'s pack (origins weighted by affiliation class and district)',
      'layer 3 data: feature weights F3 2, F5 2, F6 1, F11 1; lambda 3; diversity 1; a completed match is a candidate for one game day',
      'V is told of the incidents that open where V stands (the report of what V saw, stood in for by the driver: RunExtra.witness)',
      arm === 'A1' ? 'arm A1: layer 3 chooses at random among what passes its gates' : 'arm E: layer 3 ranks and chooses',
    ],
  };
}
