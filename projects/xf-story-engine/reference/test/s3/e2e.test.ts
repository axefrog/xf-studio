import { expect, test, setDefaultTimeout } from 'bun:test';
import { H, s } from '../../src/id.ts';
import { Layer3 } from '../../src/procedural/layer3.ts';
import { quietFrame } from '../../src/procedural/data.ts';
import { Sim } from '../../src/sim/sim.ts';
import { makeKabukiSlice } from '../../src/sim/slices.ts';
import { defaultData as simData } from '../../src/sim/data.ts';
import { attachLayer2 } from '../../src/sim/layer2-wire.ts';
import { ScriptPort } from '../../src/seeding/port.ts';
import { ReplayPort } from '../../src/sim/port.ts';
import type { SiftPattern } from '../../src/procedural/types.ts';
import { child, inject } from '../sim/helpers.ts';
import { pack, pattern, registry } from './helpers.ts';
import { r1WorldWith, delivery, show } from '../s2/drive.ts';
import { r1Seed, LAPSE_AFTER } from '../s2/r1.ts';
import { setFact, settle, advance } from '../s2/world.ts';
setDefaultTimeout(30000);

function firefight(at: number) {
  return quietFrame(
    at,
    at >= 100 && at < 130
      ? { health: 0.5, downed: true, hostileAware: true, hostileAwareNear: true }
      : { health: at >= 130 ? 0.5 : 1 },
  );
}
function r1Run(attached: boolean) {
  const seed = r1Seed();
  const { w, inst } = r1WorldWith('SF3-36', {
    windows: seed.windows.map((x) => ({ ...x, lead: 'early' })),
    timing: { intensity: 0.2, maxWait: { clock: 'play', s: 1800 } },
  });
  w.k.settings.set({ tempo: 'off' });
  w.l2.arbiter.session = 'normal';
  const l3 = attached ? new Layer3(w.l2, { registry }) : undefined;
  for (let at = 0; at <= 215; at++) {
    const before = () => {
      if (at === 105) setFact(w, 'q112_done', 1, 105);
    };
    if (l3) l3.advancePlay(at, firefight, before);
    else {
      before();
      settle(w);
      w.l2.advancePlay(at);
      settle(w);
    }
  }
  const first = delivery(inst, 'offer-1')!;
  expect(first).toBeDefined();
  const releasedAt = first.releasedAt;
  show(w, first);
  expect(w.l2.respond(first.id, { kind: 'decline', id: 'decline' })).toBe(true);
  settle(w);
  for (let at = 216; at <= 400; at++) {
    if (l3) l3.advancePlay(at, firefight);
    else w.l2.advancePlay(at);
    settle(w);
    const exit = delivery(inst, 'exit-decline');
    if (exit) {
      show(w, exit, 'presented');
      w.l2.contentCompleted(exit.id);
      settle(w);
      break;
    }
  }
  advance(w, w.k.now + LAPSE_AFTER + 1200);
  settle(w);
  return {
    releasedAt,
    l3,
    semantic: {
      id: inst.id,
      offer: first.id,
      draws: Object.fromEntries(Object.entries(inst.st.draws).map(([k, v]) => [k, v.value])),
      roles: Object.fromEntries(Object.entries(inst.st.roles).map(([k, v]) => [k, v.cast])),
      state: inst.st.state,
      closure: inst.st.closed,
    },
  };
}
test('SF3-36 authored R1 with sowing off is paced, then follows the same decline and outcome', () => {
  const fitted = r1Run(true),
    absent = r1Run(false);
  expect(fitted.releasedAt).toBe(215);
  expect(absent.releasedAt).toBe(105);
  expect(fitted.semantic).toEqual(absent.semantic);
  expect(fitted.l3!.log.some((l) => l.rule === 'phase-peak')).toBe(true);
  expect(fitted.l3!.log.some((l) => l.kind === 'sow')).toBe(false);
});

const index = makeKabukiSlice();
function kabuki(patternOverride?: SiftPattern) {
  const data = simData();
  data.events.flatPropensity = true;
  data.events.offspring = [0, 0, 0, 0];
  for (const name of Object.keys(data.shape.rate)) data.shape.rate[name] = [0, 0, 0, 0];
  for (const r of data.regimes) r.arrival = 0;
  const sim = Sim.create({
    worldSeed: H(s('fixture'), s('SF3-Kabuki')),
    index,
    data,
    only: ['city.events', 'city.mirror'],
  });
  const port = new ScriptPort(),
    l2 = attachLayer2(sim, { port });
  expect(l2.installPack(pack())).toEqual([]);
  const p = pattern({
    stages: [
      {
        kind: 'assault',
        who: [
          { role: 'aggressor', as: '?a' },
          { role: 'victim', as: '?b' },
        ],
        effects: [{ on: '?b', effect: 'harm' }],
      },
    ],
    unless: undefined,
    telling: { form: 'rumour', binds: { subject: '?a', other: '?b' } },
    within: 600,
  });
  const l3 = new Layer3(l2, { registry: sim.w.kinds, patterns: [patternOverride ?? p] });
  expect(l3.findings).toEqual([]);
  sim.k.settings.set({ tempo: 'restless' });
  const cell = sim.w.districts.find((d) => d.simulated)!.cellIds[0];
  inject(sim, child(sim, 'S3-assault', 0, 0, 'assault', 2, cell));
  sim.k.settle();
  return { sim, l2, l3, port };
}
function kabukiRun(crashAt?: number, crashEvery = false) {
  let w = kabuki();
  let total = 0;
  const decisions: string[] = [],
    releases: string[] = [];
  for (let boundary = 1; boundary <= 5; boundary++) {
    const game = boundary * 600;
    w.sim.k.settle({ to: game });
    // Resolve one real schedule slot after the completed S1 incident reaches the chronological horizon.
    const to = boundary === 3 ? w.l3.keys.slot(1, 4500).time : total + 10;
    w.l2.baseTotal = to - (w.l2.arbiter.play + 1);
    w.l3.state.slots.open.next = boundary === 3 ? 1 : w.l3.state.slots.open.next;
    w.l3.advancePlay(w.l2.playBase + w.l2.arbiter.play + 1, (at) => quietFrame(at));
    total = w.l2.playTotal();
    // Class-0 traces are exercised through S2's real prepare, casting, release and display path.
    w.l2.arbiter.session = 'normal';
    w.l3.advancePlay(w.l2.playBase + w.l2.arbiter.play + 1, (at) => quietFrame(at));
    for (const inst of w.l2.all())
      for (const d of inst.st.deliveries)
        if (d.state === 'released') {
          releases.push(d.id);
          w.l2.display({
            delivery: d.id,
            channel: d.provenance.channel,
            grade: 'presented',
            atPlay: w.l2.playBase + w.l2.arbiter.play,
          });
          w.l2.contentCompleted(d.id);
        }
    w.sim.k.settle();
    w.l3.refresh();
    w.l3.flush();
    for (const l of w.l3.log) if (l.rule === 'sow') decisions.push((l.data.request as { decision: string }).decision);
    w.l3.log.length = 0;
    if (boundary === crashAt || crashEvery) {
      const key = 'boundary-' + boundary;
      w.sim.k.persistence.save(key);
      const fresh = kabuki();
      for (const [key, rec] of w.sim.k.persistence.chain) fresh.sim.k.persistence.chain.set(key, structuredClone(rec));
      fresh.sim.k.newEpoch();
      fresh.sim.k.persistence.load(key);
      w = fresh;
    }
  }
  return {
    decisions,
    releases,
    state: w.l3.state,
    instances: w.l2.all().map((i) => ({
      id: i.id,
      template: i.st.template,
      source: i.st.source,
      state: i.st.state,
      roles: Object.fromEntries(Object.entries(i.st.roles).map(([k, r]) => [k, r.cast])),
      deliveries: i.st.deliveries.map((d) => ({ id: d.id, state: d.state, bindings: d.bindings })),
      closure: i.st.closed,
    })),
  };
}
test('Kabuki S1 → completed pattern → S2 sow, cast, release; crash at every window boundary', () => {
  const baseline = kabukiRun();
  expect(baseline.decisions).toHaveLength(1);
  expect(baseline.releases.length).toBeGreaterThan(0);
  expect(baseline.instances[0].roles.subject).toBeDefined();
  for (let crash = 1; crash <= 5; crash++) expect(kabukiRun(crash)).toEqual(baseline);
  expect(kabukiRun(undefined, true)).toEqual(baseline);
});
test('SF3-38 real S1 simulation publishes before an earlier mirror event; buffer restores chronology', () => {
  const p = pattern({
    stages: [
      { kind: 'assault', who: [{ role: 'victim', as: '?a' }], effects: [{ on: '?a', effect: 'kill' }] },
      { kind: 'assault', who: [{ role: 'victim', as: '?b' }], effects: [{ on: '?b', effect: 'harm' }] },
    ],
    unless: undefined,
    once: undefined,
    telling: { form: 'rumour', binds: { subject: '?a', other: '?b' } },
  });
  const run = (reload: boolean) => {
    const w = kabuki(p);
    new ReplayPort(w.sim).submit([
      {
        t: 100,
        op: 'event',
        kind: 'game.death',
        place: w.sim.w.districts.find((d) => d.simulated)!.cellIds[0],
        participants: [{ who: 'mirrored-victim', role: 'victim' }],
      },
    ]);
    w.sim.k.settle({ to: 600 });
    expect(w.l3.state.buffer).toHaveLength(1);
    expect(w.l3.state.pool).toHaveLength(0);
    if (reload) {
      w.sim.k.persistence.save('chronology');
      w.sim.k.persistence.load('chronology');
    }
    w.sim.k.settle({ to: 1200 });
    expect(w.l3.state.pool).toHaveLength(1);
    expect(w.l3.state.pool[0].complete).toBe(true);
    expect(w.l3.state.pool[0].stages.map((s) => s.time)).toEqual([100, 496]);
    return w.l3.state;
  };
  expect(run(true)).toEqual(run(false));
});
