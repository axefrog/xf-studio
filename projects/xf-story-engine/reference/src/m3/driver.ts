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
  /**
   * V is told of what happens where V stands (M3 run 2). S1 opens an incident into people only where a root's focus is (the fine tier, "seen up
   * close"), so every incident with named people happened where something was looking. With this on, the driver stands in for the game's report
   * of what V saw: for each incident that opened at the block V stood in, or at a block next to it (within earshot), when a sift pattern of the
   * offer tier has matched it, it mints a report (`witnessReport`): a `tell` event, the person it happened to telling V, naming the other
   * people of the incident as its subjects and the incident as its cause. The pattern's second stage matches that report (the same people,
   * and a cause of the first stage's kind), so the V-link and the recorded cause that S3's gates 3 and 5 ask of an offer are in the record,
   * not assumed. The report is a passive observation: S1's witness, tie and absorb policies ignore a `tell`, so it forms no belief, no tie
   * to V and no regard (`test/m3/witness.test.ts` compares the whole of S1's record with and without it). Off, the driver does nothing of the kind.
   */
  witness?: boolean;
}

/**
 * The report of what V saw, as the replay line the game's feed would carry (`RunExtra.witness`): the person the incident happened to tells V
 * (listener) about it, the other people of the incident are the subjects, and the incident is the report's cause and one of its subjects, so
 * the report carries its source occurrence. The kind is `tell`, which S1 mints for one person telling another about someone and which no S1 policy turns into a tie,
 * a belief or an absorbed act; a `disclosure` would (S1 4.7 gives it warmth and trust deltas, a tie and a disclosure count).
 */
export function witnessReport(t: number, place: Id, incident: Id, teller: Id, subjects: readonly Id[]): ReplayLine {
  return {
    t, op: 'event', kind: 'tell', place,
    participants: [{ who: teller, role: 'teller' }, { who: 'v', role: 'listener' }, ...subjects.map((who) => ({ who, role: 'subject' })), { who: incident, role: 'subject' }],
    causes: [incident],
  };
}

/** A busier district: every kind's base rate times `k` (a named calibration of S1's data, for a run that needs more incidents). */
export const density = (k: number): { name: string; apply: (d: import('../sim/data.ts').S1Data) => void } => ({
  name: `incident rates x${k} (a busier Kabuki, to give the engine enough to tell)`,
  apply: (d) => { for (const kind of Object.keys(d.shape.rate)) d.shape.rate[kind] = d.shape.rate[kind]!.map((x) => x * k) as [number, number, number, number]; },
});

const WALK = ['g1', 'g2', 'g3', 'g4', 'g6', 'g7', 'g8', 'g9', 'g11'];

/** The block V stands in during window `w`: the keyed draw of `Run.step`, recomputed (a pure function of the run's name and the window). */
export const walkCellAt = (name: string, w: number): string => WALK[Math.floor(rand(hs('m3-walk'), hs(name), hi(Math.floor(w / 6))) * WALK.length)]!;

export class Run {
  readonly w: M3World;
  windowNo = 0;
  play = 0;
  readonly deliveries: DeliveryRecord[] = [];
  private seen = new Set<Id>();
  private told = new Set<Id>();
  /** How many incidents V was told of (the `witness` option). */
  witnessed = 0;
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
      const cell = walkCellAt(this.opts.name, this.windowNo);
      const t = this.windowNo * WINDOW;
      this.w.replay.submit([{ t: t + 1, op: 'reading', node: 'v', slot: 'district', value: 'wat_kab' }, { t: t + 2, op: 'reading', node: 'v', slot: 'cell', value: cell }]);
    }
    this.windowNo++;
    this.w.sim.k.settle({ to: this.windowNo * WINDOW });
    this.w.sim.k.dispatcher.drain();
    if (this.extra.witness && this.extra.walk && this.w.l3) this.tellV();
    for (let i = 0; i < PLAY_PER_WINDOW; i++) {
      this.play++;
      const to = this.w.l2.playBase + this.play;
      if (this.w.l3) this.w.l3.advancePlay(to, this.frame);
      else this.w.l2.advancePlay(to);
      this.settle();
      this.handle();
    }
  }

  /** The `witness` option: V is told of the incidents the offer tier has matched that opened at the block V stood in (see RunExtra). */
  private tellV(): void {
    const l3 = this.w.l3!;
    const names = this.w.sim.w.index.names!;
    for (const e of l3.state.pool) {
      if (e.complete || e.stages.length !== 1 || !e.pattern.startsWith('xf.m3b:') || this.told.has(e.id)) continue;
      const ev = l3.kv.event(e.stages[0]!.event);
      if (!ev || ev.place === undefined) continue;
      const here = names[walkCellAt(this.opts.name, Math.floor(ev.time / WINDOW))]!;
      if (here !== ev.place && !this.w.sim.w.index.cells[here]!.adj1.includes(ev.place)) continue;
      const teller = ev.participants.find((p) => p.role === 'victim') ?? ev.participants.find((p) => p.role === 'participant');
      if (!teller) continue;
      this.told.add(e.id);
      this.witnessed++;
      // the others the incident bound (the pattern's own roles, in the order of its bindings) are the report's subjects
      const subjects = Object.keys(e.bindings).sort().map((r) => e.bindings[r]!).filter((who) => who !== teller.who);
      this.w.replay.submit([witnessReport(this.windowNo * WINDOW + 1, ev.place, ev.id, teller.who, subjects)]);
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
