import { expect, test } from 'bun:test';
import { defaultData } from '../../src/procedural/data.ts';
import { rankCandidates } from '../../src/procedural/sower.ts';
import type { Candidate } from '../../src/procedural/types.ts';
import { complete, event, kit, pattern, world, type World } from './helpers.ts';

function due(w: World, k = 1): number {
  const t = w.l3.keys.slot(k, w.l3.data.schedule.slotGap).time;
  w.l2.baseTotal = t;
  w.l3.state.slots.open.next = k;
  return t;
}
function resolve(w: World): void {
  w.l3.refresh();
  w.l3.sower.resolve(w.l3.counts);
  w.l3.flush();
}
test('SF3-2 slots resolve once independently of pacing; stale windows lapse', () => {
  const w = world('SF3-2');
  w.k.settings.set({ tempo: 'restless' });
  complete(w);
  due(w);
  w.l3.director.phase = 'rest';
  resolve(w);
  expect(w.l3.state.pending).toHaveLength(1);
  expect(w.l3.state.slots.open.next).toBe(2);
  resolve(w);
  expect(w.l2.all()).toHaveLength(1);
  w.l3.state.slots.open.next = 0;
  w.l2.baseTotal = 2 * w.l3.data.schedule.slotGap;
  resolve(w);
  expect(w.l3.log.filter((l) => l.rule === 'slot-lapsed')).toHaveLength(2);
});
test('SF3-11 opening budgets block only engine sowing and never withdraw', () => {
  for (const counts of [
    { A: 4, L: 0, S: 0, C: 0 },
    { A: 0, L: 2, S: 0, C: 0 },
    { A: 0, L: 0, S: 8, C: 0 },
  ]) {
    const w = world('SF3-11' + JSON.stringify(counts));
    w.k.settings.set({ tempo: 'restless' });
    complete(w);
    due(w);
    w.l3.sower.resolve(counts);
    expect(w.l3.log.at(-1)?.rule).toBe('slot-budget');
    expect(w.l2.all()).toHaveLength(0);
    expect(w.l2.sow('xf.fixture', 'xf.fixture:rumour-kit').ok).toBe(true);
    expect(w.l3.log.some((l) => l.kind === 'withdraw')).toBe(false);
  }
});
test('SF3-12 pending equality, reload and off tempo retain finite lifetime', () => {
  const w = world('SF3-12');
  w.k.settings.set({ tempo: 'restless' });
  complete(w);
  const at = due(w);
  resolve(w);
  const id = w.l3.state.pending[0].instance;
  w.l2.baseTotal = at + 3000;
  w.k.settings.set({ tempo: 'off' });
  w.k.persistence.save('pending');
  w.k.persistence.load('pending');
  w.l2.baseTotal = at + 3600;
  w.l3.refresh();
  expect(w.l3.state.pending).toHaveLength(1);
  w.l2.baseTotal = at + 3601;
  w.l3.refresh();
  expect(w.l3.state.pending).toHaveLength(0);
  expect(w.l2.instance(id)?.st.state).toBe('withdrawn');
  expect(w.l3.log.filter((l) => l.kind === 'withdraw')).toHaveLength(1);
});
test('SF3-12 any shown grade leaves pending and is never withdrawn', () => {
  const w = world('pending-seen');
  w.k.settings.set({ tempo: 'restless' });
  complete(w);
  due(w);
  resolve(w);
  w.k.settle();
  const inst = w.l2.all()[0],
    d = inst.st.deliveries[0];
  expect(d).toBeDefined();
  w.l2.record(inst, 'display', { delivery: d.id, grade: 'ambient' });
  w.l3.refresh();
  expect(w.l3.state.pending).toHaveLength(0);
  w.l2.baseTotal += 5000;
  w.l3.refresh();
  expect(inst.st.state).not.toBe('withdrawn');
});
test('SF3-20 features count distinct effects, personal links and timeliness', () => {
  const w = world('SF3-20');
  complete(w);
  const ev = event(w, 'seen', 'insult', 2, { participants: [{ who: w.a, role: 'actor' }], witnesses: [w.v] });
  w.k.events.makeCanon(ev.id, 'observed', w.v);
  const c = w.l3.sower.collect({ A: 0, L: 0, C: 0, S: 0 })[0].candidate;
  expect(c.features).toEqual({ F3: 1, F5: 1, F6: 0, F11: 1 });
  expect(w.l2.exposedNode(w.a, 'presented')).toBe(true);
});
test('SF3-22 gates report dead evidence, causality, V-link, spine, exclusions and cooldown', () => {
  const w = world('SF3-22');
  complete(w);
  const e = w.l3.state.pool[0];
  w.k.now = e.lastTime + w.l3.data.sifter.candidateTtl + 1;
  expect(w.l3.sower.collect({ A: 0, L: 0, C: 0, S: 0 })).toEqual([]);
  expect(w.l3.log.at(-1)?.rule).toBe('gate-1');
  w.k.now = 0;
  w.k.settings.set({ exclusions: [w.a] });
  expect(w.l3.sower.collect({ A: 0, L: 0, C: 0, S: 0 })).toEqual([]);
  expect(w.l3.log.some((l) => l.rule === 'gate-7')).toBe(true);
  w.k.settings.set({ exclusions: [] });
  e.cooldownUntil = 10;
  expect(w.l3.sower.collect({ A: 0, L: 0, C: 0, S: 0 })).toEqual([]);
  expect(w.l3.log.at(-1)?.rule).toBe('gate-10');
});
test('SF3-23 bands use candidate-key ties, constant features skip, diversity is frozen', () => {
  const data = defaultData();
  const cs: Candidate[] = [0, 1, 2, 3].map((n) => ({
    key: String(n),
    entry: String(n),
    pattern: 'p',
    stage: 1,
    features: { F3: n, F5: 1, F6: 0, F11: 1 },
  }));
  const ranked = rankCandidates(cs, [{ pattern: 'p', kit: 'k', at: 0 }], data);
  expect(ranked.map((c) => c.bands)).toEqual([{ F3: 0 }, { F3: 1 }, { F3: 2 }, { F3: 2 }]);
  expect(ranked.map((c) => c.score)).toEqual([-0.5, 0, 0.5, 0.5]);
  const equal = rankCandidates(
    cs.map((c) => ({ ...c, features: cs[0].features })),
    [],
    data,
  );
  expect(equal.every((c) => c.composite === 0.5)).toBe(true);
});
test('SF3-24 removing a loser with scores fixed preserves candidate and kit winners', () => {
  const w = world('SF3-24');
  const salted = world('SF3-24', { s3: { salt: 'fresh-draws' } });
  complete(w);
  complete(salted);
  expect(salted.l3.state.pool).toEqual(w.l3.state.pool);
  const match = w.l3.state.pool[0].id;
  expect(salted.l3.keys.decision(salted.l3.keys.candidate(match, 1))).toBe(
    w.l3.keys.decision(w.l3.keys.candidate(match, 1)),
  );
  expect(salted.l3.keys.slot(0, 4500)).not.toEqual(w.l3.keys.slot(0, 4500));
  for (const name of ['s3-pick', 's3-kit'] as const) {
    const options = Array.from({ length: 10 }, (_, n) => ({
      key: name === 's3-pick' ? n.toString(16).padStart(32, '0') : 'kit' + n,
      score: n / 10,
    }));
    const before = w.l3.keys.ranked(name, [], options);
    const after = w.l3.keys.ranked(
      name,
      [],
      options.filter((o) => o.key !== before.at(-1)!.key),
    );
    expect(after[0].key).toBe(before[0].key);
    expect(after[0].total).toBe(before[0].total);
  }
});
test('SF3-25/28 refusal rolls back kernel and S2 mutations; one refusal per candidate', () => {
  const w = world('SF3-25');
  w.k.settings.set({ tempo: 'restless' });
  complete(w);
  due(w);
  const original = w.l2.sowRequest.bind(w.l2);
  w.l2.sowRequest = () => {
    w.k.root('refused', 'core:thing');
    w.l2.global.sowing.bad = { instances: 3 };
    return { ok: false, findings: [] };
  };
  const revision = w.k.revision;
  resolve(w);
  expect(w.k.store.header(w.k.expandId('root:refused'))).toBeUndefined();
  expect(w.l2.global.sowing.bad).toBeUndefined();
  expect(w.l3.state.pool[0].refusals).toBe(1);
  expect(w.l2.all()).toHaveLength(0);
  expect(w.l3.state.pending).toHaveLength(0);
  expect(w.k.batch).toBeNull();
  expect(w.k.revision).toBeGreaterThanOrEqual(revision);
  w.l2.sowRequest = original;
  due(w, 2);
  resolve(w);
  expect(w.l2.all()).toHaveLength(1);
  expect(w.l3.state.pending).toHaveLength(1);
});
test('SF3-26 idempotent sow and bookkeeping survive replacement loads', () => {
  const w = world('SF3-26');
  w.k.settings.set({ tempo: 'restless' });
  complete(w);
  due(w);
  resolve(w);
  const state = structuredClone(w.l3.state),
    request = w.l3.log.find((l) => l.rule === 'sow')!.data.request as Parameters<typeof w.l2.sowRequest>[0];
  w.k.persistence.save('sown');
  w.k.persistence.load('sown');
  expect(w.l3.state.pool[0].seed).toBe(state.pool[0].seed);
  expect(w.l3.state.pending).toEqual(state.pending);
  expect(w.l2.sowRequest(request)).toEqual({ ok: true, instance: state.pending[0].instance, existing: true });
  expect(w.l2.all()).toHaveLength(1);
});
test('SF3-28 split sow is repaired without another instance', () => {
  const w = world('SF3-28');
  complete(w);
  const e = w.l3.state.pool[0],
    key = w.l3.keys.candidate(e.id, 1),
    p = pattern();
  const result = w.l2.sowRequest({
    pack: 'xf.fixture',
    template: 'xf.fixture:rumour-kit',
    overlay: { roles: w.l3.sower.overlay(p, e) },
    decision: w.l3.keys.decision(key),
    localName: key.slice(0, 16),
  });
  expect(result.ok).toBe(true);
  w.k.persistence.save('split');
  w.k.persistence.load('split');
  expect(w.l3.state.pool[0].seed).toBe(w.l2.all()[0].id);
  expect(w.l3.log.some((l) => l.rule === 'sow-repaired')).toBe(true);
  expect(w.l3.state.pending).toHaveLength(1);
});
test('SF3-29 forks inherit the selected whole state; new lineage starts empty', () => {
  const w = world('SF3-29');
  complete(w);
  w.l3.state.pool[0].refusals = 2;
  w.l3.state.pool[0].cooldownUntil = 4000;
  w.l3.state.openLockUntil = 5000;
  w.k.persistence.save('one');
  const saved = structuredClone(w.l3.state);
  w.l3.state.openLockUntil = 10000;
  w.l3.state.pool[0].cooldownUntil = 8000;
  w.k.persistence.save('two');
  w.k.persistence.load('one');
  expect(w.l3.state).toEqual(saved);
  const other = world('new-lineage');
  expect(other.l3.state.pool).toEqual([]);
  expect(other.l3.state.openLockUntil).toBe(0);
});
test('SF3-30 tempo off closes frames, preserves fitting and sweeps expired entries', () => {
  const w = world('SF3-30');
  complete(w);
  w.k.settings.set({ tempo: 'off' });
  w.l3.advancePlay(0);
  expect(w.k.frames.frame(w.l3.keys.frame(pattern().id))?.status).toBe('abandoned');
  const next = w.l3.state.slots.open.next;
  event(w, 'ignored', 'insult', 600);
  w.k.settle({ to: 1200 });
  expect(w.l3.state.pool).toHaveLength(1);
  w.k.settle({ to: 260000 });
  expect(w.l3.state.pool).toHaveLength(0);
  expect(w.l3.state.slots.open.next).toBe(next);
  w.k.settings.set({ tempo: 'steady' });
  w.l3.advancePlay(1);
  expect(w.k.frames.frame(w.l3.keys.frame(pattern().id))?.status).toBe('active');
});
test('SF3-35 absent record starts empty at current cumulative schedule window', () => {
  const w = world('SF3-35');
  complete(w);
  w.l2.baseTotal = 10000;
  w.l3.flush();
  w.k.retention.seeds.delete(w.l3.keys.record);
  const hook = w.k.saveHooks.pop()!;
  w.k.persistence.save('legacy');
  w.k.saveHooks.push(hook);
  w.k.persistence.load('legacy');
  expect(w.l3.state.pool).toEqual([]);
  expect(w.l3.state.slots.open.next).toBe(2);
  expect(w.l3.log.some((l) => l.rule === 'match-lost')).toBe(false);
});
