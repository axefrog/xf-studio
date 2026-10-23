// Helpers that drive layer 2 the way the game port would: the play clock a second at a time, the kernel
// settling in between, display reports and V's answers.

import type { Id } from '../../src/types.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import type { Delivery, ExposureGrade } from '../../src/seeding/types.ts';
import { R1_ID, R1_PACK, r1Pack } from './r1.ts';
import { type World, makeWorld, setFact, settle, spots, takemura, advance } from './world.ts';
import type { WorldOpts } from './world.ts';

/** The port's play clock now. */
export const clock = (w: World): number => w.l2.playBase + w.l2.arbiter.play;

/** Play on to the port's second `to`, settling the kernel after each second. */
export function play(w: World, to: number): void {
  for (let s = clock(w) + 1; s <= to; s++) {
    w.l2.advancePlay(s);
    settle(w);
  }
}

/** Play on until `cond` holds, at most `max` seconds. */
export function playUntil(w: World, cond: () => boolean, max = 7200): boolean {
  settle(w);
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    play(w, clock(w) + 1);
  }
  return cond();
}

export const delivery = (inst: Instance, beat: string, states: string[] = ['released', 'displayed']): Delivery | undefined =>
  inst.st.deliveries.find((d) => d.beat === beat && (d.what === 'offer' || d.what === 'beat') && states.includes(d.state));

/** Report how a released delivery was shown. */
export function show(w: World, d: Delivery, grade: ExposureGrade = 'confirmed', channel = d.provenance.channel, extra: { final?: boolean; cue?: { place?: string } } = {}): void {
  w.l2.display({ delivery: d.id, channel, grade, atPlay: clock(w), ...extra });
  settle(w);
}

/** The R1 world, before its window opens: Takemura alive but the quest not done. */
export function r1World(name: string, opts: WorldOpts = {}): { w: World; inst: Instance } {
  const w = makeWorld(name, opts);
  spots(w);
  takemura(w, 0);
  setFact(w, 'q112_done', 0, 0);
  setFact(w, 'q115_point_of_no_return', 0, 0);
  setFact(w, 'q112_takemura_dead', 0, 0);
  const f = w.l2.installPack(r1Pack());
  if (f.length > 0) throw new Error(`pack findings: ${JSON.stringify(f)}`);
  settle(w);
  const inst = w.l2.ofTemplate(R1_ID)[0]!;
  return { w, inst };
}

/** Make R1's window open: q112 done, Takemura alive and allied. */
export function openWindow(w: World, t = 10): void {
  setFact(w, 'q112_done', 1, t);
  settle(w);
}

/** Play until R1's first offer is released, then show it as confirmed. Returns the delivery. */
export function firstOffer(w: World, inst: Instance): Delivery {
  playUntil(w, () => delivery(inst, 'offer-1') !== undefined);
  const d = delivery(inst, 'offer-1')!;
  show(w, d, 'confirmed');
  return d;
}

export const recordOf = (inst: Instance, kind: string): Array<Record<string, unknown>> => inst.st.record.filter((r) => r.kind === kind).map((r) => r.data);

export type { Id };
export { R1_ID, R1_PACK, advance };
