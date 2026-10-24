import { expect, test } from 'bun:test';
import { world, event, type World } from './helpers.ts';
import { quietFrame } from '../../src/procedural/data.ts';
import { Director } from '../../src/procedural/director.ts';
import type { SenseFrame } from '../../src/procedural/types.ts';
import { auditState } from '../../src/procedural/audit.ts';

function script(salt = '') {
  const w = world('SF3-37', { s3: { salt } });
  w.k.settings.set({ tempo: 'steady' });
  w.l2.arbiter.session = 'normal';
  let first = '';
  const shown: string[] = [];
  const before = (at: number) => {
    w.k.settle({ to: at });
    for (const inst of w.l2.all())
      for (const d of inst.st.deliveries)
        if (d.state === 'released') {
          w.l2.display({ delivery: d.id, channel: d.provenance.channel, grade: 'presented', atPlay: at });
          w.l2.contentCompleted(d.id);
          shown.push(d.id);
        }
    if (at === 1000) first = event(w, 'first-insult', 'insult', at).id;
    if (at === 1100)
      event(w, 'first-assault', 'assault', at, { effects: [{ on: w.b, effect: 'harm' }], causes: [first] });
    if (at === 2200) event(w, 'tombstoned', 'insult', at);
    if (at === 2400) event(w, 'second-insult', 'insult', at);
    if (at === 2500) {
      const second = [...w.l3.state.pool].find((e) => e.firstTime === 2400);
      event(w, 'second-assault', 'assault', at, {
        effects: [{ on: w.b, effect: 'harm' }],
        causes: second ? [second.stages[0].event] : [first],
      });
    }
    if (at === 2600) {
      const ev = w.l3.kv.event(first)!;
      w.k.emit({ c: 'event', event: first, kind: 'insult', participants: ev.participants, effects: ev.effects }, 1000);
    }
  };
  w.l3.advancePlay(3000, quietFrame, before);
  expect(w.l3.state.pool.filter((e) => e.complete)).toHaveLength(2);
  expect(w.l2.all()).toHaveLength(0);
  // SF3-37's prose assumes earlier live slots; its exact defaults first go live at 11333.
  if (salt === '') {
    expect(w.l3.keys.slot(2, 4500)).toEqual({ time: 11333, u: 0.27321332442272095 });
  }
  w.l3.advancePlay(22000, quietFrame, before);
  expect(auditState(w.l3)).toEqual([]);
  return {
    shown,
    decisions: w.l2.all().map((i) => ({
      id: i.id,
      source: i.st.source,
      state: i.st.state,
      roles: Object.fromEntries(Object.entries(i.st.roles).map(([k, r]) => [k, r.cast])),
    })),
    sows: w.l3.log.filter((l) => l.rule === 'sow').map((l) => ({ at: l.at.playTotal, request: l.data.request })),
    state: w.l3.state,
  };
}
test('SF3-37 literal event script uses actual nested slots, sows each occurrence once, then goes empty', () => {
  const a = script();
  expect(a.sows.map((s) => s.at)).toEqual([11333, 21175]);
  expect(a.decisions).toHaveLength(2);
  expect(new Set(a.decisions.map((i) => i.source.decision)).size).toBe(2);
  expect(a.shown).toHaveLength(2);
  expect(a.decisions.every((i) => i.state === 'resolved')).toBe(true);
});
test('SF3-33 extraneous telemetry perturbs no pacing, hold or joint output', () => {
  const run = (perturb: boolean) => {
    const logs: unknown[] = [];
    const d = new Director(world('perturb', { patterns: [] }).l3.data, (...args) => logs.push(args));
    const states: unknown[] = [];
    for (let at = 0; at < 230; at++) {
      const f = quietFrame(
        at,
        at >= 100 && at < 130
          ? { health: 0.5, downed: true, hostileAwareNear: true, hostileAware: true }
          : { health: at >= 130 ? 0.5 : 1 },
      );
      d.tick(
        perturb
          ? ({
              ...f,
              sessionLength: 999,
              idleTime: 123,
              loadCount: 77,
              quitCount: 6,
              timeOfDay: 'midnight',
              wallClock: 1000000,
            } as SenseFrame)
          : f,
      );
      states.push([
        d.A,
        d.N,
        d.T,
        d.phase,
        d.joint({ playClock: at, playTotal: at, jointLatched: false, attention: [] }),
      ]);
    }
    return { states, logs };
  };
  expect(run(true)).toEqual(run(false));
});
test('joints do not report during engagement, driving or speaking, or on the first session frame', () => {
  const d = new Director(world('joint-closed', { patterns: [] }).l3.data, () => {});
  const ctx = { playClock: 0, playTotal: 0, jointLatched: false, attention: [] as string[] };
  d.tick(quietFrame(0, { questCompleted: true }));
  expect(d.joint(ctx, true)).toBeNull();
  d.tick(quietFrame(1, { hostileAwareNear: true, questCompleted: true }));
  expect(d.joint(ctx, true)).toBeNull();
  d.tick(quietFrame(2, { questCompleted: true }));
  expect(d.joint({ ...ctx, attention: ['driving'] }, true)).toBeNull();
  expect(d.joint({ ...ctx, attention: ['speaking'] }, true)).toBeNull();
});
