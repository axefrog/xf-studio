// The M3 run driver: a deterministic harness that builds the world and drives it through the offline replay port.
// Game time moves a ten-minute window at a time (S1's boundaries); between windows the play clock runs `PLAY_PER_WINDOW`
// seconds, a second at a time, because layer 2's arbiter and layer 3's slots count play time. The ratio is a driver
// parameter (a judgement, one play second to six game seconds), not a claim about the game.
//
// The synthetic player (policy) is a function of what was shown and nothing else; it never reads a hidden state.

import { rand, s as hs, i as hi } from '../id.ts';
import type { Id } from '../types.ts';
import { quietFrame } from '../procedural/data.ts';
import type { SenseFrame } from '../procedural/types.ts';
import type { Delivery } from '../seeding/types.ts';
import type { Instance } from '../seeding/layer2.ts';
import type { ReplayLine } from '../sim/port.ts';
import { clockOf } from '../sim/week.ts';
import { MAIN_STORY_FACTS } from './facts.ts';
import { type M3World, type WorldOpts, buildWorld } from './world.ts';

export const WINDOW = 600;
export const PLAY_PER_WINDOW = 100;

/** A hand-authored story state: the main-story facts (from the table) and the street around V. */
export interface StoryState {
  id: string;
  /** What the state is for, in plain words (no plot). */
  note: string;
  /** Facts by name; every other fact of the table reads 0. */
  facts: Record<string, number>;
  /** Changes to S1's tunables: a name for each, applied in order. */
  street: Array<{ name: string; apply: (d: import('../sim/data.ts').S1Data) => void }>;
  /** What V did before the run, as replay lines (times are game seconds from the start). */
  history: (key: string) => ReplayLine[];
}

export interface DeliveryRecord {
  id: Id;
  template: string;
  layer: string;
  beat: string;
  what: string;
  game: number;
  play: number;
  clock: string;
  words: string;
  channel: string;
  /** The names the delivery's roles resolve to. */
  names: Record<string, string>;
  /** How V answered, when it was an offer. */
  answer?: string;
}

export interface Policy {
  id: string;
  /** What V answers to an offer, from its fragment and its actions alone. */
  answer(offer: { fragment: string; actions: string[] }): { kind: 'action'; id: string } | { kind: 'decline'; id: string } | { kind: 'null' };
}

export const policies: Record<string, Policy> = {
  'accept-first': { id: 'accept-first', answer: (o) => ({ kind: 'action', id: o.actions[0]! }) },
  'accept-last': { id: 'accept-last', answer: (o) => ({ kind: 'action', id: o.actions[o.actions.length - 1]! }) },
  'accept-middle': { id: 'accept-middle', answer: (o) => ({ kind: 'action', id: o.actions[Math.floor(o.actions.length / 2)]! }) },
  decline: { id: 'decline', answer: () => ({ kind: 'decline', id: 'decline' }) },
  ignore: { id: 'ignore', answer: () => ({ kind: 'null' }) },
};

/** Options of a run beside the world: whether V walks the district, and notes the transcript prints (named changes of the setting). */
export interface RunExtra {
  walk?: boolean;
  notes?: string[];
}

/** A busier district: every kind's base rate times `k` (a named calibration of S1's data, for a run that needs more incidents). */
export const density = (k: number): { name: string; apply: (d: import('../sim/data.ts').S1Data) => void } => ({
  name: `incident rates x${k} (a busier Kabuki, to give the engine enough to tell)`,
  apply: (d) => { for (const kind of Object.keys(d.shape.rate)) d.shape.rate[kind] = d.shape.rate[kind]!.map((x) => x * k) as [number, number, number, number]; },
});

const WALK = ['g1', 'g2', 'g3', 'g4', 'g6', 'g7', 'g8', 'g9', 'g11'];

export class Run {
  readonly w: M3World;
  windowNo = 0;
  play = 0;
  readonly deliveries: DeliveryRecord[] = [];
  private seen = new Set<Id>();
  frame: (at: number) => SenseFrame = (at) => quietFrame(at);

  constructor(readonly opts: WorldOpts, readonly state: StoryState, readonly policy: Policy = policies.decline!, readonly extra: RunExtra = {}) {
    this.w = buildWorld({ ...opts, s1: (d) => { opts.s1?.(d); for (const s of state.street) s.apply(d); } });
    this.settle();
    // the game's facts at the start: every fact of the table has a reading (a fact with none is `maybe`)
    const lines: ReplayLine[] = MAIN_STORY_FACTS.map((f) => ({ t: 1, op: 'fact' as const, name: f.name, value: state.facts[f.name] ?? 0 }));
    for (const name of Object.keys(state.facts)) if (!MAIN_STORY_FACTS.some((f) => f.name === name)) throw new Error(`the story state names a fact that is not in the table: ${name}`);
    this.w.replay.submit([...lines, ...state.history('v')]);
    this.w.l2.arbiter.session = 'normal';
  }

  private settle(): void {
    this.w.sim.k.settle();
    this.w.sim.k.dispatcher.drain();
  }

  /** One window: game time to its end, then its play seconds. */
  step(): void {
    // V walks the district: a new block every game hour, chosen by a keyed draw, so that the fine tier opens around V
    if (this.extra.walk && this.windowNo % 6 === 0) {
      const cell = WALK[Math.floor(rand(hs('m3-walk'), hs(this.opts.name), hi(this.windowNo / 6)) * WALK.length)]!;
      const t = this.windowNo * WINDOW;
      this.w.replay.submit([{ t: t + 1, op: 'reading', node: 'v', slot: 'district', value: 'wat_kab' }, { t: t + 2, op: 'reading', node: 'v', slot: 'cell', value: cell }]);
    }
    this.windowNo++;
    this.w.sim.k.settle({ to: this.windowNo * WINDOW });
    this.w.sim.k.dispatcher.drain();
    for (let i = 0; i < PLAY_PER_WINDOW; i++) {
      this.play++;
      const to = this.w.l2.playBase + this.play;
      if (this.w.l3) this.w.l3.advancePlay(to, this.frame);
      else this.w.l2.advancePlay(to);
      this.settle();
      this.handle();
    }
  }

  runWindows(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  nameOf(node: Id | undefined): string {
    if (node === undefined) return '';
    const k = this.w.sim.k;
    const header = k.persistence.restoreReferencedHeader(node);
    if (!header) return '';
    try {
      const nm = k.value(k.address(node, 'name'), 'display');
      if (typeof nm === 'string') return nm;
    } catch { /* not a named thing */ }
    return '';
  }

  /** V looks at what the arbiter released and answers offers by the policy. */
  private handle(): void {
    const l2 = this.w.l2;
    for (const inst of l2.all()) {
      for (const d of inst.st.deliveries) {
        if (d.state !== 'released' || this.seen.has(d.id)) continue;
        this.seen.add(d.id);
        const rec = this.record(inst, d);
        l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: l2.playBase + this.play });
        this.settle();
        if (d.what === 'offer') {
          const frag = inst.st.closure.fragments.find((f) => f.id === d.fragment);
          const actions = (frag?.offer?.actions ?? []).map((a) => a.id);
          const ans = this.policy.answer({ fragment: d.fragment ?? '', actions });
          if (l2.respond(d.id, ans)) rec.answer = ans.kind === 'null' ? 'not now' : ans.id;
          this.settle();
        } else {
          l2.contentCompleted(d.id);
          this.settle();
        }
      }
    }
  }

  private record(inst: Instance, d: Delivery): DeliveryRecord {
    const roles = { ...Object.fromEntries(Object.entries(inst.st.roles).map(([k, r]) => [k, r.cast])), ...d.bindings };
    const names: Record<string, string> = {};
    for (const [k, node] of Object.entries(roles)) {
      const nm = this.nameOf(node as Id | undefined);
      if (nm) names[k] = nm;
    }
    const game = this.w.sim.k.now;
    const rec: DeliveryRecord = {
      id: d.id, template: inst.st.template.id, layer: inst.st.source.layer, beat: d.beat ?? d.what, what: d.what, game, play: this.play,
      clock: clockOf(this.w.sim, game), words: d.words ?? '', channel: d.provenance.channel, names,
    };
    this.deliveries.push(rec);
    return rec;
  }

  instancesOf(template: string): Instance[] {
    return this.w.l2.ofTemplate(template);
  }
}
