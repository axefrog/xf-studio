// SF3-60: the composite graphs, real Kabuki residents and R2' share the live kernel stream.
import { expect, test, setDefaultTimeout } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { Sim } from '../../src/sim/sim.ts';
import { kabukiFixture } from '../sim/kabuki-fixture.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { Layer3 } from '../../src/procedural/layer3.ts';
import { factsTable } from '../../src/m3/facts.ts';
import { r2Pack } from '../../src/m3/r2.ts';
import { graphPattern } from './graph-fixture.ts';
import { vocabulary } from './library.ts';
import type { PatternWorldPort } from '../../src/seeding/pattern-types.ts';
import type { StateFill } from '../../src/sim/fillers.ts';
import { fillerId } from '../../src/procedural/graph-world.ts';

setDefaultTimeout(180_000);
const FULL = process.env.S1_FULL === '1';
const index = kabukiFixture();
function week(answer: 'pay' | 'standup' | 'decline', reload = false) {
  const sim = Sim.create({ worldSeed: H(s('SF3-60'), s(answer)), index, only: ['city.mirror'] });
  const port = new ScriptPort(), l2 = attachLayer2(sim, { port, facts: factsTable() });
  const district = sim.w.districts.find((d) => d.simulated)!, cell = district.cellIds.find((c) => sim.k.value(c, 'public') === 'public' && Number(sim.k.value(c, 'headcount')) > 0)!;
  const people = district.cellIds.flatMap((c) => sim.people.residentsOfBlock(c));
  const aiko = people.find((n) => { const p = sim.people.view(n)!; return p.ageClass === 'adult' && p.role === 'vendor'; })!;
  const jun = people.find((n) => { const p = sim.people.view(n)!; return p.ageClass === 'adult' && p.affc === 2; })!;
  const collector = people.find((n) => n !== jun && sim.people.view(n)!.ageClass === 'adult' && sim.people.view(n)!.affc === 2)!;
  const nextCollector = people.find((n) => n !== jun && n !== collector && sim.people.view(n)!.ageClass === 'adult' && sim.people.view(n)!.affc === 2)!;
  expect(aiko).toBeDefined(); expect(jun).toBeDefined();
  const claws = sim.w.group(district.id, 'A1'), mox = sim.w.group(district.id, 'A2');
  l2.reg.vocabulary = structuredClone(vocabulary);
  const patterns = [graphPattern('squeeze'), graphPattern('protection')];
  for (const p of patterns) l2.reg.patterns.set(p.id, p);
  const seedPack = r2Pack({}, { context: 'yes', windows: [{ id: 'friday', opens: 'yes', onClose: 'withdraw' }] });
  const seed = seedPack.seeds[0];
  seed.sow = 'no';
  seed.roles.market.identity = cell; seed.roles.stallholder.identity = aiko; seed.roles.collector.identity = collector;
  delete seed.roles.stallholder.scope; delete seed.roles.collector.scope;
  // Keep the authored seed's text and choices. Its world writes and realises are R2' fixture data.
  seed.roles.incident = { kind: 'core:event' };
  seed.realises = [{ pattern: patterns[0].id, juncture: 'asked', by: 'ask', binds: { '?wk': 'stallholder', '?p': 'v' } },
    { pattern: patterns[0].id, juncture: 'paid', by: 'paid', binds: { '?wk': 'stallholder', '?col': 'collector' } },
    { pattern: patterns[0].id, juncture: 'refused', by: 'standup-scene', binds: { '?wk': 'stallholder', '?col': 'collector' } }];
  seedPack.fragments.find((f) => f.id === 'ff-ask')!.offer!.asker = 'stallholder';
  seedPack.fragments.find((f) => f.id === 'ff-ask')!.roles.push('incident');
  for (const f of seedPack.fragments) delete f.applies;
  sim.k.eventKinds.register({ name: 'fixture.paid', producers: ['s2'], roles: ['actor', 'target'], fills: [{ fn: 'comply', args: { who: 'actor', to: 'target' } }] });
  sim.k.eventKinds.register({ name: 'fixture.guard', producers: ['s2'], roles: ['actor', 'target'], fills: [{ fn: 'protect', args: { guard: 'actor', ward: 'target' } }] });
  sim.k.eventKinds.register({ name: 'fixture.help', producers: ['port'], roles: ['actor', 'target'], fills: [{ fn: 'help', args: { by: 'actor', to: 'target' } }] });
  sim.k.eventKinds.register({ name: 'fixture.refused', producers: ['s2'], roles: ['actor', 'target'], fills: [{ fn: 'refuse', args: { who: 'actor', to: 'target' } }] });
  const dim = sim.k.schema.dims.get('core:event-kind')!; if (dim.value.t === 'enum') dim.value.values.push('fixture.paid', 'fixture.guard', 'fixture.help', 'fixture.refused');
  seed.beats.paid.leaves!.push({ event: { kind: 'fixture.paid', participants: [{ who: 'stallholder', role: 'actor' }, { who: 'collector', role: 'target' }], causes: ['incident'] } });
  seed.beats['standup-scene'].links = [{ because: 'ask', on: { response: 'ask', is: ['action:standup'] } }];
  seed.beats['standup-scene'].leaves!.push({ event: { kind: 'fixture.guard', participants: [{ who: 'v', role: 'actor' }, { who: 'stallholder', role: 'target' }], causes: ['incident'] } });
  seed.beats['standup-scene'].leaves!.push({ event: { kind: 'fixture.refused', participants: [{ who: 'stallholder', role: 'actor' }, { who: 'collector', role: 'target' }], causes: ['incident'] } });
  expect(l2.installPack(seedPack)).toEqual([]);
  const fit = l2.fit(seedPack.id, seed.id); expect(fit.implicitPattern?.junctures['standup-scene'].fn, JSON.stringify(fit.findings)).toBe('refuse');
  // A stub durable registry supplies pre-existing membership, fee duty and protection, as SF3-60 specifies.
  let shake = '', demand = '', guard: string | undefined;
  const strain = H(s('strain'), s(aiko)), duty = fillerId({ norm: { norm: claws, who: aiko } });
  const rules = (fn: string): ReturnType<PatternWorldPort['stateRules']> => {
    const rows: StateFill[] = fn === 'obligate' ? [{ filler: { norm: { norm: claws, who: aiko } }, at: 0, args: { debtor: aiko, creditor: claws }, causes: [] }]
      : fn === 'protect' ? [guard ? { filler: { event: guard }, at: 2400, args: { guard: sim.w.v, ward: aiko }, causes: [shake] }
        : { filler: { edge: H(s('mox-protection'), s(aiko)) }, at: 0, args: { guard: mox, ward: aiko }, causes: [] }]
      : fn === 'want' && shake ? [{ filler: { frame: strain }, at: 0, args: { who: aiko, what: duty }, causes: [demand || shake] }] : [];
    return rows.length ? [{ fn, id: 'fixture:' + fn, durable: true, changes: [], fromChange: () => [], endsBy: () => false,
      search: (arg, node, _at, limit) => ({ fills: rows.filter((r) => r.args[arg] === node).slice(0, limit), truncated: false }), holdsAt: () => 'yes' }] : [];
  };
  const base = l2.reg.patternWorld!;
  l2.reg.patternWorld = { ...base, stateRules: rules, relationSearch: (name, args, at, limit) => name === 'member' && [jun, collector].includes(args.who)
    ? { tuples: [{ id: claws, args: { who: args.who, group: claws } }], truncated: false } : base.relationSearch!(name, args, at, limit) };
  const l3 = new Layer3(l2, { registry: sim.w.kinds, vocabulary, patterns });
  expect(l3.findings.filter((f) => f.level === 'error')).toEqual([]);
  sim.k.settings.set({ tempo: 'steady' }); l3.data.sifter.relevanceGate = true; l2.arbiter.session = 'normal';
  const met = sim.k.events.mintEvent({ creator: sim.w.v, cause: sim.w.v, name: 'met-aiko', kind: 'generic', time: 0, participants: [{ who: sim.w.v, role: 'actor' }, { who: aiko, role: 'target' }] });
  sim.k.events.makeCanon(met, 'observed', sim.w.v);
  sim.k.frames.open({ id: strain, actor: aiko, origin: aiko, cause: met, level: 'goal', retain: true, status: 'active', weight: 1, parents: [], own: {}, payload: { goal: { effects: [{ on: jun, effect: 'give' }] } }, focus: { nodes: [], tier: 0 } });
  // The stub registry includes Aiko's durable reason for asking; holding a goal alone is insufficient.
  sim.k.beliefs.set({ believer: aiko, subject: strain, path: 'status', value: 'active', confidence: 1,
    evidence: [fillerId({ frame: strain })], source: { by: 'inferred', rule: { name: 'fixture-fee-strain', version: 1 }, from: [strain] },
    formed: 0, refreshed: 0, at: 0, memorable: true });
  // Friday at the opening of this fixture's week; the remaining six days test persisted continuation.
  shake = sim.k.events.mintEvent({ creator: sim.k.root('fixture-port', 'core:seed'), cause: met, name: 'friday-fee', kind: 'shakedown', time: 0, place: cell,
    participants: [{ who: jun, role: 'aggressor' }, { who: aiko, role: 'victim' }], effects: [{ on: aiko, effect: 'take' }], witnesses: [sim.w.v], outcome: 'done' });
  sim.k.settle({ to: 1200 }); l3.refresh();
  const friday = l3.state.pool.find((e) => e.pattern === patterns[0].id)!;
  let protection = l3.state.pool.find((e) => e.pattern === patterns[1].id)!;
  expect(friday.graph!.junctures.rule.filler?.id).toBe(shake); expect(friday.graph!.junctures.paid.filler?.id).toBe(shake);
  demand = sim.k.events.mintEvent({ creator: sim.k.expandId('root:fixture-port'), cause: shake, name: 'next-fee', kind: 'price', time: 1200,
    participants: [{ who: collector, role: 'warner' }, { who: aiko, role: 'warned' }], causes: [shake], witnesses: [sim.w.v] });
  sim.k.settle({ to: 1800 }); l3.refresh();
  let squeeze = l3.state.pool.find((e) => e.pattern === patterns[0].id && e.bindings['?col'] === collector)!;
  expect(squeeze).toBeDefined(); expect(protection).toBeDefined();
  expect(squeeze.graph!.junctures.rule.filler?.id).toBe(demand); expect(squeeze.graph!.junctures.paid.filler).toBeUndefined();
  expect(protection.graph!.junctures.struck.filler?.id).toBe(shake); expect(friday.graph!.layers.some((l) => l.with === protection.id)).toBe(true);
  const sow = l2.sow(seedPack.id, seed.id, { overlay: { roles: { incident: { identity: demand } } } }); expect(sow.ok).toBe(true);
  sim.k.settle(); l3.refresh();
  expect(l3.state.pool.find((e) => e.id === squeeze.id)!.graph!.junctures.asked.state).toBe('pending');
  l3.advancePlay(105); l3.refresh();
  let inst = l2.instance(sow.instance!)!;
  expect(l3.sower.collect(l3.counts).some((r) => r.candidate.juncture === 'asked' && r.candidate.entry === squeeze.id)).toBe(false);
  const offer = inst.st.deliveries.find((d) => d.what === 'offer')!; expect(offer, JSON.stringify({ state: inst.st.state, roles: inst.st.roles, beats: inst.st.beats, record: inst.st.record.slice(-5) })).toBeDefined();
  l2.display({ delivery: offer.id, channel: offer.provenance.channel, grade: 'confirmed', atPlay: l2.playTotal() });
  sim.k.settle(); l3.refresh();
  if (reload) {
    const ids = [squeeze.id, protection.id]; sim.k.persistence.save('active-choice'); sim.k.newEpoch(); sim.k.persistence.load('active-choice');
    inst = l2.instance(inst.id)!; squeeze = l3.state.pool.find((e) => e.id === ids[0])!; protection = l3.state.pool.find((e) => e.id === ids[1])!;
    expect(inst.st.deliveries.find((d) => d.id === offer.id)?.state).toBe('displayed');
  }
  expect(l2.respond(offer.id, answer === 'decline' ? { kind: 'decline', id: 'decline' } : { kind: 'action', id: answer })).toBe(true);
  l3.advancePlay(l2.playBase + 210 - l2.baseTotal);
  for (const d of inst.st.deliveries.filter((d) => d.state === 'released')) { l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: l2.playTotal() }); l2.contentCompleted(d.id); }
  sim.k.settle({ to: 2400 }); l3.refresh();
  expect(squeeze.graph!.junctures.asked.state).toBe('matched');
  expect(!!squeeze.graph!.junctures.paid.filler, JSON.stringify({ answer, g: squeeze.graph, record: inst.st.record.slice(-12), buffer: l3.state.buffer })).toBe(answer === 'pay');
  expect(!!squeeze.graph!.junctures.refused.filler, answer).toBe(answer === 'standup');
  const defence = H(s('mox-answer'), s(aiko));
  sim.k.frames.open({ id: defence, actor: mox, origin: mox, cause: shake, level: 'situation', retain: true, status: 'active', weight: 1, parents: [], own: {}, payload: {}, focus: { nodes: [], tier: 0 } });
  sim.k.events.mintEvent({ creator: sim.k.expandId('root:fixture-port'), cause: shake, name: 'mox-answer', kind: 'fixture.help', time: 2400,
    participants: [{ who: mox, role: 'actor' }, { who: aiko, role: 'target' }], effects: [{ on: aiko, effect: 'help' }], causes: [shake], served: defence, witnesses: [sim.w.v] });
  sim.k.settle({ to: 3000 }); l3.refresh();
  expect(protection.graph!.outcome?.name, JSON.stringify({ graph: protection.graph, logs: l3.log.slice(-12) })).toBe('held');
  if (answer === 'pay') expect(inst.st.record.some((r) => r.kind === 'minted' && r.data.path === 'beat/paid/leaves/1')).toBe(true);
  if (answer === 'standup') {
    guard = inst.st.record.filter((r) => r.kind === 'minted').map((r) => String(r.data.event)).find((id) => sim.k.events.mintedSpec(id)?.kind === 'fixture.guard');
    expect(guard).toBeDefined();
    // A new collector makes a new incident; the resolved ward/threat pair has a once tombstone.
    expect(nextCollector).toBeDefined();
    sim.k.events.mintEvent({ creator: sim.k.expandId('root:fixture-port'), cause: guard!, name: 'next-demand', kind: 'price', time: 3000,
      participants: [{ who: nextCollector, role: 'warner' }, { who: aiko, role: 'warned' }], causes: [guard!], witnesses: [sim.w.v] });
    sim.k.settle({ to: 3600 }); l3.refresh();
    expect(l3.state.pool.some((e) => e.pattern === patterns[1].id && e.id !== protection.id && e.bindings['?gd'] === sim.w.v)).toBe(true);
  }
  const steps = FULL ? 1008 : 14;
  // Smaller calls alone do not shorten the run: settle processes every intervening
  // window. Keep the scripted stances and both reloads at either scale, but reserve
  // the week of subsequent history for S1_FULL.
  const horizon = FULL ? 604800 : steps * 600;
  for (let n = 1; n <= steps; n++) {
    sim.k.settle({ to: 3600 + Math.floor(n * horizon / steps) }); l3.refresh();
    if (reload && n === Math.floor(steps / 2)) { sim.k.persistence.save('midweek'); sim.k.newEpoch(); sim.k.persistence.load('midweek'); }
  }
  l3.flush();
  expect(l3.state.skeletons.ring.length).toBeGreaterThan(0);
  expect(l3.log.some((l) => l.rule === 'adaptation')).toBe(false);
  return { pool: l3.state.pool, skeletons: l3.state.skeletons, seed: inst.id,
    tokens: l3.threadView.flatMap((t) => t.tokens ?? []), draws: inst.st.draws, casts: Object.fromEntries(Object.entries(inst.st.roles).map(([r, s]) => [r, s.cast])) };
}
test('SF3-60: a scripted layered Kabuki week with R2 prime replays every stance', () => {
  for (const stance of ['pay', 'standup', 'decline'] as const) expect(week(stance, true)).toEqual(week(stance));
});
