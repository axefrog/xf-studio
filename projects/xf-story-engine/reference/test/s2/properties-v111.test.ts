import { expect, test } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { miniPack } from './mini.ts';
import { makeWorld } from './world.ts';
import { PackIndex } from '../../src/seeding/packs.ts';
import { resolvePreds } from '../../src/seeding/doc.ts';
import { lintV111 } from '../../src/seeding/lint-v111.ts';
import { nudgeLegal } from '../../src/seeding/nudge.ts';
import { library, vocabulary } from '../s3/library.ts';
import { lcg } from '../sim/feed.ts';
import { applyEffects } from '../../src/seeding/effects.ts';
import { scene } from './v111-fixture.ts';

test('S2 v1.11 property: generated nudge positions, witnesses and wants never pass an unsafe write', () => {
  const draw = lcg(0x2111);
  for (let n = 0; n < 48; n++) {
    const w = makeWorld('nudge-property-' + n), pack = miniPack(), seed = pack.seeds[0];
    const actor = w.k.root('actor', 'fx:character'), target = w.k.root('target', 'core:person');
    seed.nudge = true; delete seed.closing;
    seed.roles.target = { kind: 'core:person' }; seed.roles.site = { kind: 'core:place' };
    seed.facts = {}; seed.start = ['meet']; seed.beats = { meet: { play: 'pack:f-meet' } }; seed.end = 'beat(meet) in {done}';
    seed.windows = [{ id: 'w', opens: 'yes', onClose: 'withdraw' }];
    seed.unattended = { after: { clock: 'game', s: 0 }, outcome: [] };
    pack.fragments = [{ id: 'f-meet', level: 'phrase', roles: ['npc', 'target', 'site'], salience: 'background', forms: { standard: 'pack:t-meet' }, channels: [] }];
    expect(w.l2.installPack(pack)).toEqual([]); const sow = w.l2.sow(pack.id, seed.id); expect(sow.ok, JSON.stringify(sow.findings)).toBe(true);
    const inst = w.l2.instance(sow.instance!)!;
    for (const [role, cast] of Object.entries({ npc: actor, target, site: w.japantown })) inst.st.roles[role] = { committed: false, attempt: 0, ladder: { cursor: 0, relaxed: [] }, cast };
    const variant = Math.floor(draw() * 7);
    for (const edge of w.k.store.edgesFrom(w.v).filter((e) => e.type === 'core:located-in')) w.k.endEdge(edge.id, 0);
    w.k.addEdge({ type: 'core:located-in', from: w.v, to: variant === 0 ? w.japantown : w.city, cause: w.v });
    w.l2.reg.vocabulary = vocabulary;
    w.k.eventKinds.register({ name: 'fixture.visit', producers: ['s2'], roles: ['actor', 'target'], fills: [{ fn: 'wrong', args: { by: 'actor', to: 'target' } }] });
    w.l2.worldRegistry.intends = () => variant !== 3;
    w.l2.worldRegistry.eventWitnesses = () => variant === 2 ? [w.v] : [];
    if (variant === 1) w.l2.reg.sim = { builds: () => true, eval: () => 'open', transitions: () => [], deps: () => ({ interests: [], boundary: false }) };
    if (variant === 5) inst.st.roles.npc.cast = w.v;
    if (variant === 6) w.k.pin({ node: actor, slot: 'where', value: w.city, reason: 'observed', cause: w.v });
    const events = w.k.store.idsOfKind('core:event').length;
    expect(nudgeLegal(w.l2, inst, [{ event: { kind: 'fixture.visit', place: 'site', participants: [{ who: 'npc', role: 'actor' }, { who: 'target', role: 'target' }], effects: [{ on: 'target', effect: 'take' }] } }]), `seed ${n}, variant ${variant}`).toBe(variant === 4);
    expect(w.k.store.idsOfKind('core:event')).toHaveLength(events);
    const minted = applyEffects(w.l2, inst, [{ event: { kind: 'fixture.visit', place: 'site', participants: [{ who: 'npc', role: 'actor' }, { who: 'target', role: 'target' }], effects: [{ on: 'target', effect: 'take' }] } }], { origin: 'beat', tag: 'generated-write' });
    expect(minted.length, `runtime seed ${n}, variant ${variant}`).toBe(variant === 4 ? 1 : 0);
  }
});

test('S2 v1.11 property: generated harmful action writes need an accepted obstacle, not acceptance alone', () => {
  const w = makeWorld('harm-property');
  for (const effect of ['harm', 'kill', 'take', 'expose'] as const) for (const origin of ['action', 'beat', 'unattended'] as const) {
    const pack = miniPack(), e = { kernel: { on: 'v', effect } };
    if (origin === 'action') pack.fragments[0].offer!.actions[0].writes = [e];
    if (origin === 'beat') pack.seeds[0].beats.finish.leaves = [e];
    if (origin === 'unattended') pack.seeds[0].unattended.outcome = [e];
    expect(lintV111(resolvePreds(pack.seeds[0]), w.l2.lintContext(new PackIndex(pack))).some((f) => f.code === 'L-15')).toBe(true);
  }
  for (const effect of ['harm', 'kill', 'take', 'expose'] as const) for (const answer of ['go', 'no', 'null']) {
    const { w, inst, d } = scene(`runtime-harm-${effect}-${answer}`);
    expect(w.l2.respond(d.id, answer === 'go' ? { kind: 'action', id: 'go' } : answer === 'no' ? { kind: 'decline', id: 'no' } : { kind: 'null' })).toBe(true);
    inst.st.document.beats.finish.kind = 'obstacle';
    inst.st.document.beats.finish.links = [{ because: 'meet', on: { response: 'meet', is: ['action:go'] } }];
    inst.st.document.beats.finish.obstacle = { affordances: [{ needs: 'yes', cost: 'a', exposure: 'a', combat: false }, { needs: 'yes', cost: 'b', exposure: 'b', combat: true }] };
    inst.st.closure.fragments.find((f) => f.id === 'f-meet')!.offer!.stakes = [{ bearer: 'v', what: 'risk' }];
    const written = applyEffects(w.l2, inst, [{ kernel: { on: 'v', effect } }], { origin: 'beat', tag: 'harm', path: 'beat/finish/leaves' });
    expect(written.length).toBe(answer === 'go' ? 1 : 0);
    expect(written.every((id) => w.k.events.mintedSpec(id)?.effects?.some((e) => e.on === w.v && e.effect === effect))).toBe(true);
  }
});

test('S2 v1.11 property: realises bindings and the implicit beat function agree across role renamings', () => {
  const w = makeWorld('realises-property'); w.l2.reg.vocabulary = vocabulary;
  for (const p of library) w.l2.reg.patterns.set(p.id, p);
  for (let n = 0; n < 24; n++) {
    const pack = miniPack(), role = 'asker' + n;
    pack.seeds[0].roles[role] = pack.seeds[0].roles.npc; delete pack.seeds[0].roles.npc;
    pack.fragments.forEach((f) => { f.roles = f.roles.map((r) => r === 'npc' ? role : r); });
    pack.fragments[0].offer!.asker = role;
    pack.seeds[0].realises = [{ pattern: 'xf.composite:squeeze', juncture: 'asked', by: 'meet', binds: { '?wk': role, '?p': 'v' } }];
    const result = lintV111(resolvePreds(pack.seeds[0]), w.l2.lintContext(new PackIndex(pack)));
    expect(result.filter((f) => f.code === 'L-138')).toEqual([]);
    delete pack.seeds[0].realises[0].binds['?wk'];
    expect(lintV111(resolvePreds(pack.seeds[0]), w.l2.lintContext(new PackIndex(pack))).filter((f) => f.code === 'L-138')).toHaveLength(1);
    const { w: runtime, inst, d, asker } = scene('runtime-realises-' + n, (runtime, p) => {
      runtime.l2.reg.vocabulary = vocabulary; for (const pattern of library) runtime.l2.reg.patterns.set(pattern.id, pattern);
      p.seeds[0].roles[role] = p.seeds[0].roles.npc; delete p.seeds[0].roles.npc;
      for (const f of p.fragments) { f.roles = f.roles.map((r) => r === 'npc' ? role : r); if (f.offer) f.offer.asker = role; }
      p.seeds[0].end = 'seedFact(stage) == 1'; p.seeds[0].realises = [{ pattern: 'xf.composite:debt', juncture: 'paid', by: 'end', binds: { '?d': 'v', '?c': role } }];
    });
    expect(runtime.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true); runtime.k.settle();
    expect(inst.st.closed).toBeDefined(); expect(runtime.l2.realisedBy(inst.st.closed!.event)).toEqual([{ fn: 'repay', args: { debtor: runtime.v, creditor: asker } }]);
  }
});
