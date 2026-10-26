import { expect, test } from 'bun:test';
import { scene } from './v111-fixture.ts';
import { playUntil, delivery, show } from './drive.ts';
import { resolvePreds } from '../../src/seeding/doc.ts';
import { lintV111 } from '../../src/seeding/lint-v111.ts';
import { PackIndex } from '../../src/seeding/packs.ts';
import { miniPack } from './mini.ts';
import { makeWorld } from './world.ts';
import { Sim } from '../../src/sim/sim.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { factsTable } from '../../src/m3/facts.ts';
import { applyEffects } from '../../src/seeding/effects.ts';
import { vocabulary } from '../s3/library.ts';
import { H, s } from '../../src/id.ts';

test('review 1: a second offer decline cannot authorise its obstacle harm, even after cast aliases resolve', () => {
  for (const accepted of [false, true]) {
    const { w, inst, d } = scene('accepted-harm-' + accepted, (_w, p) => {
      const next = structuredClone(p.fragments[0]); next.id = 'next';
      next.offer!.stakes = [{ bearer: 'v', what: 'the risk' }]; p.fragments.push(next);
      const seed = p.seeds[0];
      seed.beats.next = { play: 'pack:next', links: [{ because: 'meet', on: { response: 'meet', is: ['action:go'] } }] };
      seed.beats.finish = { kind: 'obstacle', play: 'pack:f-finish', links: [{ because: 'next', on: { response: 'next', is: ['action:go'] } }],
        obstacle: { affordances: [{ needs: 'yes', cost: 'time', exposure: 'low', combat: false }, { needs: 'yes', cost: 'risk', exposure: 'high', combat: true }] },
        leaves: [{ kernel: { on: 'v', effect: 'harm' } }] };
      seed.end = 'beat(finish) in {done}'; delete seed.facts!.stage.route;
    });
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    expect(playUntil(w, () => !!delivery(inst, 'next'), 300)).toBe(true);
    const next = delivery(inst, 'next')!;
    if (!accepted) {
      inst.st.document.beats.finish.links = [{ because: 'next', on: { response: 'next', is: ['decline:no'] } }];
      inst.st.document.beats.finish.leaves = [];
    }
    expect(w.l2.respond(next.id, accepted ? { kind: 'action', id: 'go' } : { kind: 'decline', id: 'no' })).toBe(true);
    expect(playUntil(w, () => {
      for (const r of inst.st.deliveries.filter((d) => d.what === 'reply' && d.state === 'released')) { show(w, r); w.l2.contentCompleted(r.id); }
      for (const r of inst.st.deliveries.filter((d) => d.beat === 'finish' && d.state === 'queued')) w.l2.pull(r.id);
      return !!delivery(inst, 'finish');
    }, 300), JSON.stringify({ accepted, state: inst.st.state, logs: w.l2.arbiter.log.slice(-5), ds: inst.st.deliveries.map((d) => [d.beat,d.what,d.state]) })).toBe(true);
    const finish = delivery(inst, 'finish')!;
    // A released legacy declaration must still be checked at the actual world write.
    inst.st.document.roles.riskowner = { kind: 'core:person' };
    inst.st.roles.riskowner = { ...inst.st.roles.npc, cast: w.v };
    inst.st.document.beats.finish.leaves = [{ kernel: { on: 'riskowner', effect: 'harm' } }];
    show(w, finish); w.l2.contentCompleted(finish.id); w.k.settle();
    const harm = w.k.events.canonEvents().filter((id) => w.k.events.mintedSpec(id)?.effects?.some((e) => e.on === w.v && e.effect === 'harm'));
    expect(harm.length).toBe(accepted ? 1 : 0);
  }
  const w = makeWorld('decline-lint'), pack = miniPack(), seed = pack.seeds[0];
  pack.fragments[0].offer!.stakes = [{ bearer: 'v', what: 'risk' }];
  seed.beats.finish.kind = 'obstacle'; seed.beats.finish.obstacle = { affordances: [{ needs: 'yes', cost: 'a', exposure: 'a', combat: false }, { needs: 'yes', cost: 'b', exposure: 'b', combat: true }] };
  seed.beats.finish.links = [{ because: 'meet', on: { response: 'meet', is: ['decline:no'] } }]; seed.beats.finish.leaves = [{ kernel: { on: 'v', effect: 'harm' } }];
  expect(lintV111(resolvePreds(seed), w.l2.lintContext(new PackIndex(pack))).some((f) => f.code === 'L-15')).toBe(true);
});

test('review 2: attached S1 empty agent roles cannot bypass a new pack kind want or D-30', () => {
  const sim = Sim.create({ worldSeed: H(s('new-pack-actors')), index: makeKabukiSlice(), only: ['city.mirror'] });
  const l2 = attachLayer2(sim, { port: new ScriptPort(), facts: factsTable() }); l2.reg.vocabulary = vocabulary;
  sim.k.eventKinds.register({ name: 'pack.theft', producers: ['s2'], roles: ['thief', 'victim'], fills: [{ fn: 'wrong', args: { by: 'thief', to: 'victim' } }] });
  const p = miniPack(), seed = p.seeds[0]; seed.nudge = true; delete seed.closing; seed.context = 'no';
  seed.beats = { meet: { kind: 'texture', play: 'pack:silent' } }; seed.facts = {}; seed.end = 'no'; seed.windows = [{ id: 'w', opens: 'yes', onClose: 'withdraw' }];
  seed.unattended = { after: { clock: 'game', s: 0 }, outcome: [] }; seed.roles.other = { kind: 'core:person' };
  p.fragments = [{ id: 'silent', level: 'phrase', roles: ['npc', 'other'], salience: 'background', forms: { standard: 'pack:t-meet' }, channels: [] }];
  expect(l2.installPack(p)).toEqual([]); const sow = l2.sow(p.id, seed.id); expect(sow.ok).toBe(true);
  const inst = l2.instance(sow.instance!)!, actor = sim.k.root('actor', 'core:person'), other = sim.k.root('other', 'core:person');
  for (const [r, n] of Object.entries({ npc: actor, other })) inst.st.roles[r] = { committed: false, attempt: 0, ladder: { cursor: 0, relaxed: [] }, cast: n };
  const write = [{ event: { kind: 'pack.theft', participants: [{ who: 'npc', role: 'thief' }, { who: 'other', role: 'victim' }], effects: [{ on: 'other', effect: 'take' as const }] } }];
  expect(l2.worldRegistry.agentRoles?.('pack.theft')).toEqual([]);
  expect(applyEffects(l2, inst, write, { origin: 'beat', tag: 'no-want' })).toEqual([]);
  sim.k.frames.open({ id: H(s('want-theft')), actor, origin: actor, cause: actor, level: 'goal', weight: 1, retain: true, own: {}, payload: { goal: { effects: [{ on: other, effect: 'take' }] } }, focus: { nodes: [], tier: 0 } });
  expect(applyEffects(l2, inst, write, { origin: 'beat', tag: 'wanted' })).toHaveLength(1);
  const act = sim.k.events.mintEvent({ creator: sim.w.v, cause: sim.w.v, name: 'V-theft', kind: 'pack.theft', time: 0, participants: [{ who: sim.w.v, role: 'thief' }, { who: other, role: 'victim' }] });
  inst.st.document.nudge = false; inst.st.source.by = 'director'; inst.st.roles.told = { ...inst.st.roles.npc, cast: act };
  const tell = [{ event: { kind: 'tell', participants: [{ who: 'npc', role: 'teller' }, { who: 'other', role: 'listener' }, { who: 'told', role: 'told' }] } }];
  expect(applyEffects(l2, inst, tell, { origin: 'beat', tag: 'director' })).toEqual([]);
  inst.st.source.by = 'pack'; expect(applyEffects(l2, inst, tell, { origin: 'beat', tag: 'authored' })).toHaveLength(1);
});

test('review 5: selectable V text reused as ordinary content fails at that use site', () => {
  const w = makeWorld('V-text-use'), p = miniPack();
  p.texts.push({ id: 'v-line', text: 'I will.', speaker: 'v' }); p.fragments[0].offer!.actions[0].say = { text: 'pack:v-line' };
  const check = () => lintV111(resolvePreds(p.seeds[0]), w.l2.lintContext(new PackIndex(p))).filter((f) => f.code === 'L-142');
  expect(check()).toEqual([]); p.fragments[1].forms.standard = 'pack:v-line'; expect(check()).toHaveLength(1);
});
