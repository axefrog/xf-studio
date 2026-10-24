import { expect, test } from 'bun:test';
import { world } from './helpers.ts';
import { miniPack } from '../s2/mini.ts';

function run(noticing: 'off' | 'acts' | 'full', sensitive = false, floor = false) {
  const w = world('SF3-34', { patterns: [] });
  w.k.settings.set({ noticing, tempo: 'off', ...(floor ? { modelFloor: 100 } : {}) });
  const p = miniPack({}, { sow: 'no', windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }] });
  p.fragments[0].features = { verb: 'help', relationship: 'acquaintance', outcome: 'delivered', tone: 'quiet' };
  if (sensitive) {
    w.l2.reg.classes.set('private', { id: 'private', sensitive: true });
    p.fragments[0].content = [{ class: 'private', intensity: 1 }];
    p.seeds[0].content = { envelope: { private: 1 } };
  }
  expect(w.l2.installPack(p).filter((f) => f.level === 'error')).toEqual([]);
  expect(w.l2.sow(p.id, p.seeds[0].id).ok).toBe(true);
  w.k.settle();
  w.l2.arbiter.session = 'normal';
  w.l3.advancePlay(100);
  const inst = w.l2.ofTemplate(p.seeds[0].id)[0],
    d = inst.st.deliveries.find((d) => d.state === 'released')!;
  expect(d).toBeDefined();
  w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'confirmed', atPlay: w.l2.arbiter.play });
  w.l3.refresh();
  w.l3.refresh();
  expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
  w.k.settle();
  w.l3.refresh();
  return w;
}
test('SF3-34 evidence is inert; offers and responses carry exact play stamps and structural facets', () => {
  const off = run('off'),
    on = run('acts');
  expect(on.l3.state).toEqual(off.l3.state);
  expect(on.l2.all().map((i) => i.st)).toEqual(off.l2.all().map((i) => i.st));
  expect(on.l3.log.filter((l) => l.kind !== 'evidence')).toEqual(
    off.l3.log
      .filter((l) => l.kind !== 'evidence')
      .map((l, i) => ({ ...l, seq: on.l3.log.filter((l) => l.kind !== 'evidence')[i].seq })),
  );
  const entries = on.l3.log.filter((l) => l.kind === 'evidence');
  expect(entries).toHaveLength(2);
  expect(entries[0].data.features).toMatchObject({
    verb: 'help',
    relationship: 'acquaintance',
    outcome: 'delivered',
    channel: 'message',
  });
  expect(entries[0].data.playTotal).toBe(100);
  expect(entries[1].data).toMatchObject({ kind: 'decline:no', playTotal: 100 });
  expect(off.l3.log.some((l) => l.kind === 'evidence')).toBe(false);
  expect(
    run('full')
      .l3.log.filter((l) => l.kind === 'evidence')
      .map((l) => l.data),
  ).toEqual(entries.map((l) => l.data));
});
test('evidence respects model floor and sensitive content classes', () => {
  expect(run('acts', true).l3.log.some((l) => l.kind === 'evidence')).toBe(false);
  expect(run('acts', false, true).l3.log.some((l) => l.kind === 'evidence')).toBe(false);
});
test('typed exclusions are recorded in SettingsSet and round-trip as hard filters', () => {
  const w = world('settings-exclusions');
  const exclusions = [
    { kind: 'tag' as const, value: 'report' },
    { kind: 'verb' as const, value: 'help' },
  ];
  w.k.settings.set({ storyExclusions: exclusions });
  w.k.persistence.save('filters');
  w.k.settings.set({ storyExclusions: [] });
  w.k.persistence.load('filters');
  expect(w.k.settings.current().storyExclusions).toEqual(exclusions);
});
