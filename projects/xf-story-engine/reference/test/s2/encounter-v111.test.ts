import { expect, test } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { processCause } from '../../src/evolution.ts';
import { applyEffects } from '../../src/seeding/effects.ts';
import { readSeedFact } from '../../src/seeding/eval.ts';
import { scene } from './v111-fixture.ts';
import { lintV111 } from '../../src/seeding/lint-v111.ts';
import { resolvePreds } from '../../src/seeding/doc.ts';
import { PackIndex } from '../../src/seeding/packs.ts';
import { miniPack } from './mini.ts';
import { makeWorld } from './world.ts';

test('SF-72: encounter writes require an uninterrupted world hunt and restless tempo every time', () => {
  for (const variant of ['authorised', 'relented', 'tempo', 'predates-hunt', 'forged']) {
    let current = 'hunt', initial = 'hunt';
    const { w, inst } = scene(`SF72-${variant}`, (w, pack) => {
      for (const [name, values] of [['core:event-kind', ['confront', 'decide.punish']], ['core:participant-role', ['group', 'confronted']]] as const) {
        const dim = w.k.schema.dims.get(name)!;
        if (dim.value.t === 'enum') dim.value.values.push(...values);
      }
      const group = w.k.root('hunters', 'core:group'), cause = H(s('hunt'));
      const decision = w.k.events.mintEvent({ creator: processCause('group.decide'), cause, name: 'decide', time: 0, kind: 'decide.punish', participants: [{ who: group, role: 'group' }] });
      const confront = w.k.events.mintEvent({ creator: processCause('scene.acts'), cause, name: 'confront', time: 0, kind: 'confront', participants: [{ who: w.v, role: 'confronted' }], causes: [decision] });
      pack.seeds[0].roles.encounter = { kind: 'core:event', identity: confront, scope: { nodes: [confront] }, must: [{ path: 'kind', op: 'eq', arg: 'confront' }] };
      pack.fragments[0].roles.push('encounter');
      w.k.settings.set({ tempo: 'restless' });
      w.l2.reg.sim = { builds: (n) => n === 'intentAgainst', eval: () => current,
        transitions: (_n, _a, from, to) => [{ t: from, value: initial }, ...(to > from ? [{ t: to, value: current }] : [])],
        deps: () => ({ interests: [], boundary: false }) };
    });
    if (variant === 'relented') current = 'none';
    if (variant === 'tempo') w.k.settings.set({ tempo: 'steady' });
    if (variant === 'predates-hunt') initial = 'none';
    if (variant === 'forged') {
      const ev = w.k.events.mintEvent({ creator: inst.id, cause: inst.id, name: 'forged', time: 0, kind: 'confront', participants: [{ who: w.v, role: 'confronted' }] });
      inst.st.roles.encounter.cast = ev;
    }
    applyEffects(w.l2, inst, [{ fact: 'stage', set: 9 }], { origin: 'beat', tag: 'later' });
    if (variant === 'authorised') expect(readSeedFact(w.l2, inst, 'stage')).toBe(9);
    else { expect(readSeedFact(w.l2, inst, 'stage')).toBe(0); expect(inst.st.state).toBe('withdrawn'); }
  }
});
test('SF-72: arbitrary harm and harm asserted by a group encounter fail L-15', () => {
  const w = makeWorld('SF72-lint'), pack = miniPack(), seed = pack.seeds[0];
  seed.beats.finish.leaves = [{ kernel: { on: 'v', effect: 'harm' } }];
  const check = () => lintV111(resolvePreds(seed), w.l2.lintContext(new PackIndex(pack))).filter((f) => f.code === 'L-15');
  expect(check()).toHaveLength(1);
  pack.fragments[0].offer!.actions[0].writes!.push({ kernel: { on: 'v', effect: 'harm' } });
  expect(check()).toHaveLength(2); // Acceptance alone does not replace the required obstacle.
  pack.fragments[0].offer!.actions[0].writes!.pop();
  seed.roles.encounter = { kind: 'core:event', must: [{ path: 'kind', op: 'eq', arg: 'confront' }] };
  pack.fragments[0].offer!.actions[0].writes!.push({ kernel: { on: 'v', effect: 'harm' } });
  expect(check()).toHaveLength(2);
});

test('review 4 / SF-72: lost authority blocks display, response, promise and completion before their mutations', () => {
  for (const action of ['display', 'response', 'completion']) for (const lost of [false, true]) {
    let current = 'hunt';
    const { w, inst, d } = scene(`encounter-step-${action}-${lost}`, (w, pack) => {
      const group = w.k.root('hunters', 'core:group');
      for (const [name, values] of [['core:event-kind', ['confront', 'decide.punish']], ['core:participant-role', ['group', 'confronted']]] as const) {
        const dim = w.k.schema.dims.get(name)!; if (dim.value.t === 'enum') dim.value.values.push(...values);
      }
      const decision = w.k.events.mintEvent({ creator: processCause('group.decide'), cause: group, name: 'decision', kind: 'decide.punish', time: 0, participants: [{ who: group, role: 'group' }] });
      const confront = w.k.events.mintEvent({ creator: processCause('scene.acts'), cause: decision, name: 'encounter', kind: 'confront', time: 0, participants: [{ who: w.v, role: 'confronted' }], causes: [decision] });
      pack.seeds[0].roles.encounter = { kind: 'core:event', identity: confront, must: [{ path: 'kind', op: 'eq', arg: 'confront' }] }; pack.fragments[0].roles.push('encounter');
      w.k.settings.set({ tempo: 'restless' });
      w.l2.reg.sim = { builds: () => true, eval: () => current, transitions: (_n, _a, from, to) => [{ t: from, value: 'hunt' }, { t: to, value: current }], deps: () => ({ interests: [], boundary: false }) };
    });
    if (lost) current = 'none';
    if (action === 'completion') {
      w.l2.contentCompleted(d.id);
      expect(d.state === 'answered').toBe(!lost);
      if (lost) expect(inst.st.state).toBe('withdrawn');
      continue;
    }
    if (action === 'display') w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'confirmed', atPlay: 1 });
    else expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(!lost);
    const kinds = w.k.events.canonEvents().flatMap((id) => { const e = w.k.events.mintedSpec(id); return e?.creator === inst.id ? [e.kind] : []; });
    if (lost) { expect(kinds.some((k) => ['offer', 'response', 'promise'].includes(k))).toBe(false); expect(inst.st.receipts).toEqual([]); expect(inst.st.state).toBe('withdrawn'); }
    else { expect(kinds).toContain('offer'); if (action === 'response') expect(kinds).toEqual(expect.arrayContaining(['response', 'promise'])); }
  }
});

test('review 4: response and promise roll back together if a later authorised write throws', () => {
  const { w, inst, d } = scene('atomic-answer', (_w, p) => { p.fragments[0].offer!.actions[0].writes!.push({ reward: { table: 'fixture', tier: 'small' } }); });
  const before = structuredClone(inst.st), ids = w.k.events.canonEvents();
  w.port.reward = () => { throw new Error('port rejected reward'); };
  expect(() => w.l2.respond(d.id, { kind: 'action', id: 'go' })).toThrow('port rejected reward');
  expect(inst.st).toEqual(before); expect(w.k.events.canonEvents()).toEqual(ids);
});
