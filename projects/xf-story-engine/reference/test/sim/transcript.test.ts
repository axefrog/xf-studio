// A small frozen transcript of the simulation layer (S1 14.3): a short story over FX-3 that touches what the independent review found wanting
// (a regime that closes and reopens in one second, the protected set of a past time, a tie that ended and opened again, the facts of an event
// behind a memorable belief across a load, the divergence log) and writes what the world says as lines. The lines are hashed and the digest is
// frozen, so a change anywhere in the layer that alters one answer fails here, and a native core must write the same lines. Beside the digest
// the test states, independently of the code, what some of the lines must say.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, id as hid, i as hi, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import type { EventsState } from '../../src/sim/proc-events.ts';
import { Sim } from '../../src/sim/sim.ts';
import { fx3Slice } from '../../src/sim/slices.ts';
import { fxData, seedOf } from './helpers.ts';

// Bun 1.4 gives the default set in test/setup.ts to the first test file only
setDefaultTimeout(120_000);

const W = 600;
const adult = { alive: 'yes', 'age-class': 'adult' } as const;

/** The digest the transcript below must hash to. A deliberate change of the layer's behaviour changes it, with the reason in the commit. */
/** Change it only for a deliberate change of the layer's answers, with the reason in the commit. */
const FROZEN = '158e89e481c3cd72aaf891c55c1c75f1';

function story(): { lines: string[]; sim: Sim; facts: Record<string, unknown> } {
  const sim = Sim.create({
    worldSeed: seedOf('S1-TRANSCRIPT'), index: fx3Slice(),
    data: fxData((d) => {
      for (const k of Object.keys(d.shape.rate)) d.shape.rate[k] = d.shape.rate[k]!.map((x) => x * 20) as [number, number, number, number];
      d.minds.tellBase = 1e9;
    }),
  });
  const d = sim.w.districts[0]!;
  const names = new Map<Id, string>([...d.cellIds.map((c, i): [Id, string] => [c, `c${i + 1}`]), [d.id, 'D1']]);
  const nm = (id: Id | undefined): string => (id === undefined ? '-' : (names.get(id) ?? id.slice(0, 6)));
  const port = new ReplayPort(sim);
  port.submit([
    { t: 0, op: 'reading', node: 'v', slot: 'district', value: 'fx_d1' },
    { t: 0, op: 'reading', node: 'v', slot: 'cell', value: 'c1' },
    { t: 0, op: 'person', key: 'vendor', slots: { affiliation: 'civilian', ...adult } },
    { t: 0, op: 'person', key: 'claw', slots: { affiliation: 'GA', ...adult } },
    { t: 0, op: 'person', key: 'quest', slots: { affiliation: 'civilian', 'quest-linked': 'yes', ...adult } },
    { t: 3000, op: 'person', key: 'quest', slots: { 'quest-linked': 'no' } },
    { t: 0, op: 'person', key: 'target', slots: { affiliation: 'civilian', ...adult } },
    { t: 3000, op: 'event', kind: 'game.death', place: 'c1', participants: [{ who: 'vendor', role: 'victim' }, { who: 'v', role: 'actor' }], effects: [{ on: 'vendor', effect: 'kill' }], witnesses: 4 },
    { t: 3700, op: 'event', kind: 'game.heat.3', participants: [] },
    { t: 4200, op: 'event', kind: 'enf.fee.word', place: 'c1', participants: [{ who: 'claw', role: 'enforcer' }, { who: 'vendor', role: 'target' }], witnesses: 6 },
  ]);
  sim.advance(16);
  const k = sim.k;
  const residents = d.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
  // a seed's cast over one resident, live for a stretch of the story and ended before the save
  const cast = residents[7]!;
  const seed = k.root('live-seed', 'core:seed');
  k.retention.setSeed({ id: seed, state: {}, nodes: [cast] });
  const edge = k.addEdge({ type: 'core:cast', from: seed, to: cast, data: { role: 'target' }, cause: seed, valid: { from: 5000 } });
  sim.advance(4);
  k.endEdge(edge.id, 5400);
  // a tie that is materialised, ended and materialised again
  const [a, b] = [residents[20]!, residents[60]!];
  const tie = sim.tiePolicy.materialise(a, b)!;
  const tM1 = k.now;
  sim.advance(2);
  k.endEdge(tie.id, k.now);
  const tE = k.now;
  sim.advance(2);
  sim.tiePolicy.materialise(a, b);
  const tM2 = k.now;
  // a memorable belief about a harm, in the listener's interest, and a belief that contradicts the game
  const teller = residents[0]!;
  const listener = residents[30]!;
  const victim = residents[31]!;
  const quest = port.node('quest');
  const mv = port.node('target');
  sim.spine.add(mv);
  k.frames.open({
    actor: listener, level: 'concern', origin: H(hs('transcript-frame')), weight: 1, cause: sim.w.city,
    own: { protects: [{ slot: '*', scope: { nodes: [victim] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] },
  });
  k.settle();
  const E = k.events.mintEvent({
    creator: sim.w.port, cause: sim.w.port, name: 'story-harm', time: 7000, kind: 'assault', place: d.cellIds[0]!,
    participants: [{ who: mv, role: 'aggressor' }, { who: victim, role: 'victim' }], effects: [{ on: victim, effect: 'harm' }], witnesses: [teller],
  });
  k.beliefs.set({ believer: teller, subject: mv, path: 'did.harm', at: 7000, value: victim, confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: k.now, refreshed: k.now, memorable: true });
  k.beliefs.set({ believer: teller, subject: mv, path: 'alive', at: k.now, value: 'no', confidence: 1, evidence: [E], source: { by: 'observed', event: E }, formed: k.now, refreshed: k.now, memorable: true });
  sim.advance(2);
  const before = { score: sim.policies.tellScore(k.beliefs.activeOf(teller).find((x) => x.path === 'did.harm')!, teller, listener), view: JSON.stringify(sim.policies.viewEvent(E)) };
  // save, load into the same world, and the story goes on
  k.persistence.save('T');
  k.persistence.load('T');
  k.frames.open({
    actor: listener, level: 'concern', origin: H(hs('transcript-frame')), weight: 1, cause: sim.w.city,
    own: { protects: [{ slot: '*', scope: { nodes: [victim] }, where: [{ path: '@effect', op: 'eq', arg: 'harm' }] }] },
  });
  k.settle();
  // the game restates what it knows after a load
  new ReplayPort(sim).submit([
    { t: k.now, op: 'person', key: 'quest', slots: { affiliation: 'civilian', 'quest-linked': 'no', ...adult } },
    { t: k.now, op: 'person', key: 'target', slots: { affiliation: 'civilian', ...adult } },
    { t: k.now, op: 'person', key: 'vendor', slots: { affiliation: 'civilian', ...adult } },
    { t: k.now, op: 'person', key: 'claw', slots: { affiliation: 'GA', ...adult } },
  ]);
  sim.advance(4);
  const after = { score: sim.policies.tellScore(k.beliefs.activeOf(teller).find((x) => x.path === 'did.harm')!, teller, listener), view: JSON.stringify(sim.policies.viewEvent(E)) };
  for (let w = 1; w <= 6; w++) sim.policies.encounter(teller, listener, w);

  // ---- the transcript ----
  const lines: string[] = [];
  const st = sim.stateOf<EventsState>('city.events')!;
  const recent = sim.windowNow() - 6;
  for (const e of [...st.ring].filter((x) => x.w >= recent).sort((x, y) => x.w - y.w || (x.id < y.id ? -1 : 1))) lines.push(`ring ${e.w} ${nm(e.cell)} ${e.kind} ${e.event ? `event s${e.event.size}` : `summary n${e.count}`}`);
  for (const c of d.cellIds) lines.push(`band ${nm(c)} ${sim.reads.eval('band', [c])} ${JSON.stringify(sim.reads.transitions('band', [c], k.now - 3 * W, k.now).map((x) => [x.t, x.value]))}`);
  lines.push(`regime ${sim.reads.eval('regime', ['fx_d1'])} price ${sim.reads.eval('priceLevel', ['fx_d1'])} refuge ${sim.reads.eval('refuge', ['fx_d1'])}`);
  lines.push(`label ${sim.reads.eval('label', ['stalls', 'v', sim.data.ledger.axes[0]!])} normGap ${sim.reads.eval('normGap', ['fee', 'fx_d1'])} groupGap ${sim.reads.eval('groupGap', [sim.w.group(d.id, 'A1')])}`);
  for (const t of [2000, 4000, 5200, 5600, 9000]) lines.push(`protected ${t} cast=${sim.people.protectedAt(cast, t)} quest=${sim.people.protectedAt(quest, t)} where=${sim.people.where(cast, t).cause}`);
  for (const t of [0, tM1 - 1, tM1, tE - 1, tE, tM2 - 1, tM2, k.now]) lines.push(`tied ${t - tM1} ${sim.reads.eval('tied', [a, b, 'xf:tie'], t)}`);
  lines.push(`tie intervals ${JSON.stringify(sim.tiePolicy.intervalsOf(a, b))}`);
  lines.push(`divergence ${sim.reads.eval('divergence', [teller, mv], 0)} ${sim.reads.eval('divergence', [teller, mv], 6500)} ${sim.reads.eval('divergence', [teller, mv])}`);
  lines.push(`tell score ${before.score} ${after.score}`);
  for (const e of sim.record.log) lines.push(`log ${e.w} ${e.proc} ${e.kind} ${e.reason}`);
  lines.push(`record ${Object.keys(sim.record.protect).length} ${Object.keys(sim.record.evidence).length}`);
  return { lines, sim, facts: { before, after, cast, mv, quest, a, b, E, teller, listener } };
}

describe('the frozen transcript of the simulation layer', () => {
  const run = story();

  test('the lines hash to the frozen digest', () => {
    const digest = H(hs(run.lines.join('\n')));
    expect(digest, run.lines.join('\n')).toBe(FROZEN);
  });

  test('what some of the lines must say, stated independently of the code', () => {
    const { lines, facts } = run;
    const text = lines.join('\n');
    // the cast held the resident from 5000 to 5400 and not before or after, though the edge was ended and the world saved and loaded since
    expect(text).toContain('protected 4000 cast=false');
    expect(text).toContain('protected 5200 cast=true');
    expect(text).toContain('protected 5600 cast=false');
    expect(text).toContain('cast=true quest=false where=protected-present');
    // the quest-linked person was protected until the game said otherwise at 3000, whatever was loaded since
    expect(text).toContain('protected 2000 cast=false quest=true');
    expect(text).toContain('protected 4000 cast=false quest=false');
    // the tie of the pair: not before it was materialised, live, a gap after it ended, live again; two intervals in the record
    const tied = lines.filter((l) => l.startsWith('tied ')).map((l) => l.split(' ')[2]);
    expect(tied).toEqual(['no', 'no', 'yes', 'yes', 'no', 'no', 'yes', 'yes']);
    expect(text).toMatch(/tie intervals \[\{"from":\d+,"to":\d+\},\{"from":\d+\}\]/);
    // the divergence of the teller's belief that the quest person is dead: none before it was held, large once it is
    expect(text).toMatch(/divergence none none large/);
    // the telling score is the same before the load and after it, and positive
    expect(facts.before).toEqual(facts.after);
    expect((facts.before as { score: number }).score).toBeGreaterThan(0);
    expect(text).toMatch(/log \d+ social decision tell/);
  });

  test('the same story twice writes the same lines', () => {
    expect(story().lines).toEqual(run.lines);
  });
});

void hid;
void hi;
