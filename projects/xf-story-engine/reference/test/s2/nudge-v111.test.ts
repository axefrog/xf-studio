import { expect, test } from 'bun:test';
import { H, s } from '../../src/id.ts';
import type { Pack, Seed } from '../../src/seeding/types.ts';
import { MINI_ID, miniPack } from './mini.ts';
import { makeWorld, setFact, settle, advance } from './world.ts';
import { delivery, playUntil, show } from './drive.ts';
import { library, vocabulary } from '../s3/library.ts';
import { lintV111 } from '../../src/seeding/lint-v111.ts';
import { resolvePreds } from '../../src/seeding/doc.ts';
import { PackIndex } from '../../src/seeding/packs.ts';

function fixture(name: string, wants = true) {
  const w = makeWorld(name), cause = H(s('nudge-test'));
  const actor = w.k.root('npc', 'fx:character'), target = w.k.root('recipient', 'core:person');
  for (const npc of [actor, target]) {
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
  }
  w.k.eventKinds.register({ name: 'collector-visit', producers: ['s2'], roles: ['collector', 'victim'], fills: [{ fn: 'wrong', args: { by: 'collector', to: 'victim' } }] });
  w.l2.reg.vocabulary = vocabulary;
  for (const p of library) w.l2.reg.patterns.set(p.id, p);
  const pack = miniPack();
  const seed = pack.seeds[0];
  seed.nudge = true; delete seed.closing;
  seed.roles.npc.identity = actor;
  seed.roles.target = { kind: 'core:person', identity: target, must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] };
  seed.roles.site = { kind: 'core:place', identity: w.japantown, scope: { nodes: [w.japantown] } };
  if (wants) seed.roles.npc.goal = { effects: [{ on: 'target', effect: 'take' }] };
  seed.beats = { meet: { play: 'pack:f-meet', leaves: [{ event: { kind: 'collector-visit', place: 'site', participants: [{ who: 'npc', role: 'collector' }, { who: 'target', role: 'victim' }], effects: [{ on: 'target', effect: 'take' }] } }] } };
  seed.end = 'beat(meet) in {done}'; seed.facts = {};
  seed.unattended = { after: { clock: 'game', s: 0 }, outcome: [] };
  pack.fragments = [{ id: 'f-meet', level: 'exchange', roles: ['npc', 'target', 'site'], forms: { standard: 'pack:t-meet' }, channels: [], salience: 'background' }];
  setFact(w, 'flag', 0, 0); setFact(w, 'x', 0, 0);
  return { w, actor, pack, seed };
}
test('SF-68: nudge lint rejects an offer, V identity, authored beliefs and an uncaused tell', () => {
  const { w, pack, seed } = fixture('SF68');
  const check = (p: Pack) => lintV111(resolvePreds(p.seeds[0]), w.l2.lintContext(new PackIndex(p))).filter((f) => f.code === 'L-140');
  expect(check(pack)).toEqual([]);
  const twins = [
    (p: Pack) => { p.fragments[0].channels = ['message']; },
    (p: Pack) => { p.seeds[0].roles.npc.identity = 'v'; },
    (p: Pack) => { p.seeds[0].roles.npc.identity = 'root:v'; },
    (p: Pack) => { p.seeds[0].roles.npc.authored = [{ belief: { about: 'target', path: 'alive', value: 1, reason: 'test' } }]; },
    (p: Pack) => { p.seeds[0].beats.meet.leaves = [{ event: { kind: 'tell', participants: [{ who: 'npc', role: 'teller' }] } }]; },
  ];
  for (const mutate of twins) { const p = structuredClone(pack); mutate(p); expect(check(p)).toHaveLength(1); }
});
test('SF-69/70: an off-screen nudge commits silently; an actor without a goal is held', () => {
  for (const wants of [true, false]) {
    const { w, pack } = fixture(`SF69-${wants}`, wants);
    expect(w.l2.installPack(pack)).toEqual([]);
    const result = w.l2.sow(pack.id, MINI_ID); expect(result.ok, JSON.stringify(result.findings)).toBe(true);
    setFact(w, 'flag', 1, 10); settle(w);
    const inst = w.l2.instance(result.instance!)!;
    if (wants) {
      expect(inst.st.state, JSON.stringify({ roles: inst.st.roles, record: inst.st.record })).toBe('resolved');
      expect(inst.st.closed?.witnessed).toBe(false);
      expect(inst.st.record.some((r) => r.kind === 'transition' && r.data.row === 'T8n')).toBe(true);
    } else {
      expect(inst.st.state).toBe('cast'); expect(inst.st.committed).toBe(false);
      expect(inst.st.record.some((r) => r.kind === 'nudge-held' && r.data.rule === 4)).toBe(true);
      expect(Object.values(inst.st.edges)).toEqual([]);
    }
    expect(inst.st.deliveries).toEqual([]); expect(w.l2.arbiter.log).toEqual([]);
  }
});
test('SF-69: V in the event cell holds the silent start until V moves away', () => {
  const { w, pack } = fixture('SF69-position');
  const cause = H(s('v-location'));
  const edge = w.k.addEdge({ type: 'core:located-in', from: w.v, to: w.japantown, cause });
  expect(w.l2.installPack(pack)).toEqual([]);
  const result = w.l2.sow(pack.id, MINI_ID); expect(result.ok).toBe(true);
  setFact(w, 'flag', 1, 10); settle(w);
  const inst = w.l2.instance(result.instance!)!;
  expect(inst.st.state).toBe('cast');
  expect(inst.st.record.some((r) => r.kind === 'nudge-held' && r.data.rule === 1)).toBe(true);
  w.k.endEdge(edge.id, w.k.now);
  w.l2.queueReeval(inst, 'V moved'); settle(w);
  expect(inst.st.state).toBe('resolved');
});

test('SF-80: a delayed write checks V location, recent observation and unanswered offers at its own time', () => {
  for (const variant of ['clear', 'position', 'observed', 'offer']) {
    const { w, pack, actor, seed } = fixture(`SF80-${variant}`), cause = H(s('tell-subject'));
    for (const [name, values] of [['core:event-kind', ['tell']], ['core:participant-role', ['teller', 'listener', 'told']]] as const) {
      const dim = w.k.schema.dims.get(name)!; if (dim.value.t === 'enum') dim.value.values.push(...values);
    }
    w.k.eventKinds.register({ name: 'tell', producers: ['s2'], roles: ['teller', 'listener', 'told'] });
    const told = w.k.events.mintEvent({ creator: cause, cause, name: 'subject', kind: 'generic', time: 0, witnesses: [actor] });
    w.k.beliefs.observe(actor, told); w.l2.worldRegistry.areTied = () => true;
    seed.roles.subject = { kind: 'core:event', identity: told, scope: { nodes: [told] } };
    for (const role of Object.values(seed.roles)) role.claim = { span: 'seed', share: 'any' };
    seed.beats.meet.leaves = [];
    seed.beats.later = { play: 'pack:f-tell', kind: 'aftermath', links: [{ because: 'meet' }], aftermath: { delay: { clock: 'game', s: 1 }, signposts: [] },
      leaves: [{ event: { kind: 'tell', place: 'site', participants: [{ who: 'npc', role: 'teller' }, { who: 'target', role: 'listener' }, { who: 'subject', role: 'told' }] } }] };
    seed.end = 'beat(later) in {done}';
    pack.fragments.push({ ...pack.fragments[0], id: 'f-tell', roles: ['npc', 'target', 'site', 'subject'] });
    expect(w.l2.installPack(pack)).toEqual([]);
    const sow = w.l2.sow(pack.id, MINI_ID); expect(sow.ok, JSON.stringify(sow.findings)).toBe(true);
    setFact(w, 'flag', 1, 10); settle(w);
    const inst = w.l2.instance(sow.instance!)!; expect(inst.st.state).toBe('running');
    if (variant === 'position') w.k.addEdge({ type: 'core:located-in', from: w.v, to: w.japantown, cause });
    if (variant === 'observed') w.k.pin({ node: actor, slot: 'where', value: w.city, reason: 'observed', cause });
    if (variant === 'offer') {
      const other = miniPack(); other.id = 'xf.other'; other.seeds[0].id = 'xf.other:offer';
      other.seeds[0].roles.npc.identity = inst.st.roles.target.cast;
      other.seeds[0].roles.npc.claim = { span: 'seed', share: 'any' };
      expect(w.l2.installPack(other)).toEqual([]);
      const sown = w.l2.sow(other.id, other.seeds[0].id); expect(sown.ok).toBe(true); settle(w);
      const offer = w.l2.instance(sown.instance!)!;
      expect(playUntil(w, () => !!delivery(offer, 'meet'), 200)).toBe(true); show(w, delivery(offer, 'meet')!);
    }
    advance(w, 600); settle(w);
    const tells = inst.st.record.filter((r) => r.kind === 'minted');
    if (variant === 'clear') { expect(tells).toHaveLength(1); expect(inst.st.state).toBe('resolved'); }
    else {
      expect(tells).toEqual([]); expect(inst.st.beats.later.state).toBe('available');
      const rule = variant === 'position' ? 1 : variant === 'observed' ? 2 : 3;
      expect(inst.st.record.some((r) => r.kind === 'nudge-held' && r.data.rule === rule)).toBe(true);
    }
  }
});
