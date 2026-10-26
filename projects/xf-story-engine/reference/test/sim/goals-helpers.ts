// Fixtures for the goals, the intentions against the protagonist and the goal acts (S1 7.2, 7.8.1, 7.10): worlds over FX-3 with the processes
// a fixture studies, facts fed to the digests the processes read, and people found by their group and role.

import { hrec } from '../../src/canon.ts';
import { H, s as hs } from '../../src/id.ts';
import type { WorldIndex } from '../../src/sim/index-types.ts';
import type { Change, Id } from '../../src/types.ts';
import type { S1Data } from '../../src/sim/data.ts';
import type { EventFact } from '../../src/sim/occ.ts';
import type { GoalsDigest, GoalsState, GoalRec } from '../../src/sim/proc-goals.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { quietData, seedOf } from './helpers.ts';

export const W = 600;

/** FX-3 with no incidents of its own, running only the named processes. */
export const goalSim = (name: string, tweak: (d: S1Data) => void = () => {}, only = ['people.goals']): Sim => Sim.create({ worldSeed: seedOf(name), index: fx3Slice(), data: quietData(tweak), only });

export const district = (sim: Sim): Id => sim.w.districts[0]!.id;
export const gnode = (sim: Sim, aff: 'A1' | 'A2'): Id => sim.w.group(district(sim), aff);

/** Adult residents of the district by affiliation class index (0 civilian, 2 A1, 3 A2) and, if given, profile role, in block order. */
export function adults(sim: Sim, affc: number, role?: string): Id[] {
  const out: Id[] = [];
  for (const cell of sim.w.districts[0]!.cellIds) for (const r of sim.people.residentsOfBlock(cell)) {
    const v = sim.people.view(r);
    if (v && v.affc === affc && v.ageClass === 'adult' && (role === undefined || v.role === role)) out.push(r);
  }
  return out;
}

/** The facts the processes read: `city.events` digests as the processes publish them. */
export const feedEvents = (sim: Sim, w: number, facts: EventFact[], counts: Array<{ district: Id; kind: string; size: number; n: number }> = []): void => {
  sim.k.evolution.stateOf('city.events').digest = { v: 1, through: w, facts: { windows: [{ w, items: facts }] }, counts: { windows: [{ w, items: counts }] }, changes: { windows: [] } };
};

export const fact = (sim: Sim, over: Partial<EventFact> & Pick<EventFact, 'kind' | 'parties'>): EventFact => ({
  id: H(hs('fact'), hs(over.kind), hs(JSON.stringify(over.parties)), hs(String(over.time ?? 0))), size: 2, w: 5, time: 5 * W + 10, cell: sim.w.districts[0]!.cellIds[0]!, district: sim.w.districts[0]!.id,
  public: false, witnesses: 0, policeChild: false, creator: 'sim', outcome: 'done', ...over,
});

export const pair = (a: Id, v: Id, kind = 'assault'): Pick<EventFact, 'kind' | 'parties'> => ({ kind, parties: [{ role: 'aggressor', who: a }, { role: 'victim', who: v }] });

/** The digest of `people.goals` as applied, and the one of the newest outstanding batch (what the next boundary applies). */
export const goalsApplied = (sim: Sim): GoalsDigest | undefined => sim.digestOf<GoalsDigest>('people.goals');
export const goalsNow = (sim: Sim): GoalsDigest | undefined => {
  const st = sim.k.evolution.states.get('people.goals')!;
  return (st.outstanding.at(-1)?.digest as GoalsDigest | undefined) ?? (st.digest as GoalsDigest | undefined);
};
export const goalsState = (sim: Sim): GoalsState => {
  const st = sim.k.evolution.states.get('people.goals')!;
  return structuredClone((st.outstanding.at(-1)?.state ?? st.state) as GoalsState);
};
export const goalList = (sim: Sim, kind?: GoalRec['kind']): GoalRec[] => (goalsNow(sim)?.goals ?? []).filter((g) => kind === undefined || g.kind === kind);

/** Collect every change the kernel emits from now on. */
export function watchChanges(sim: Sim): Change[] {
  const out: Change[] = [];
  const emit = sim.k.emit.bind(sim.k);
  sim.k.emit = (ch: Change): void => {
    out.push(ch);
    emit(ch);
  };
  return out;
}

/** A resident cast by a live seed from time `from` (a protected person; a person a seed owns). */
export function castBySeed(sim: Sim, person: Id, from = 0, to?: number): { seed: Id; edge: Id } {
  const seed = sim.k.root(`live-seed-${person.slice(0, 8)}`, 'core:seed');
  sim.k.retention.setSeed({ id: seed, state: {}, nodes: [person] });
  const e = sim.k.addEdge({ type: 'core:cast', from: seed, to: person, data: { role: 'target' }, cause: seed, valid: to === undefined ? { from } : { from, to } });
  return { seed, edge: e.id };
}

/** Put a goal into the state of `people.goals` as if it had opened earlier, with its retained frame (a fixture's initial state). */
export function plantGoal(sim: Sim, over: Partial<GoalRec> & Pick<GoalRec, 'owner'>): GoalRec {
  const id = over.id ?? H(hs('planted-goal'), hs(over.owner), hs(String(over.motive ?? 0)), hs(over.kind ?? 'redress'), hs(over.source ?? ''));
  const rec: GoalRec = { id, kind: 'redress', source: H(hs('planted-source'), hs(id)), acts: ['assault'], motive: 0.5, opened: 0, expires: 100000, state: 'active', ...over };
  sim.setState('people.goals', (st) => {
    const s = st as GoalsState;
    s.goals.push(rec);
    s.goals.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (rec.post) s.posts.push({ person: rec.owner, cell: rec.post.cell, periods: [...rec.post.periods], from: 0, goal: rec.id, ...(rec.ward !== undefined ? { ward: rec.ward } : {}) });
  });
  if (rec.kind !== 'role') {
    const aim = rec.target ?? rec.ward;
    sim.k.frames.open({
      id, actor: rec.owner, level: 'goal', origin: rec.source, weight: rec.motive, cause: rec.source, retain: true,
      payload: { goal: { effects: rec.target !== undefined ? [{ on: rec.target, effect: 'harm' }] : [] } }, focus: { nodes: aim !== undefined ? [aim] : [], tier: 0 },
    });
  }
  return rec;
}

/** FX-3 with `scale` times the people: enough gang members for a group to give duties to (FX-3's 90 residents hold three adult gang members of the first group, and two of them sit in its seats). */
export function bigSlice(scale = process.env.S1_FULL === '1' ? 8 : 4): WorldIndex {
  const ix = structuredClone(fx3Slice());
  const d = Object.values(ix.districts)[0]!;
  d.entry.total = d.entry.total * scale;
  for (const b of d.entry.byAff) b.q = b.q * scale;
  for (const c of Object.values(ix.cells)) c.pop = c.pop.map((x) => x * scale) as typeof c.pop;
  const { hash: _h, ...rest } = ix;
  void _h;
  ix.hash = H(hs('world-index'), hrec(rest as unknown as Record<string, unknown>));
  return ix;
}

/** The same world over the larger slice. */
export const bigSim = (name: string, tweak: (d: S1Data) => void = () => {}, only = ['people.goals'], scale?: number): Sim => Sim.create({ worldSeed: seedOf(name), index: bigSlice(scale), data: quietData(tweak), only });
