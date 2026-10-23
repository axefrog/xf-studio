// The crash-point sweep (S2 section 14.1): save and load between every pair of adjacent steps of R1. After the
// load every instance is in the state it was saved in (S2-I-6), and the story goes on to the same end.

import { describe, expect, test } from 'bun:test';
import { LAPSE_AFTER, R1_ID } from './r1.ts';
import { clock, delivery, play, playUntil, r1World, r1WorldWith, show } from './drive.ts';
import { r1Params } from './r1.ts';
import { advance, setFact, settle, type World } from './world.ts';
import type { Instance } from '../../src/seeding/layer2.ts';

type Step = { name: string; run: (w: World, inst: () => Instance) => void };

/** A step that answers the delivery of a beat: it plays until it is released, shows it, and answers. */
const answer = (beat: string, resp: { kind: 'action' | 'decline'; id: string } | { kind: 'null' }): Step => ({
  name: `answer ${beat} with ${resp.kind}`,
  run: (w, inst) => {
    playUntil(w, () => delivery(inst(), beat) !== undefined);
    const d = delivery(inst(), beat)!;
    if (d.state === 'released') show(w, d, 'confirmed');
    expect(w.l2.respond(d.id, resp)).toBe(true);
    settle(w);
  },
});

const activity = (n: number): Step => ({
  name: `shared activity ${n}`,
  run: (w) => {
    const taken = w.k.mirrored('takemura', 'fx:character');
    const ev = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: `walk-${n}`, time: w.k.now, kind: 'shared-activity', participants: [{ who: w.v, role: 'actor' }, { who: taken, role: 'participant' }], witnesses: [w.v] });
    w.k.events.makeCanon(ev, 'observed', w.v);
    settle(w);
  },
});

const play1 = (beat: string): Step => ({
  name: `play ${beat}`,
  run: (w, inst) => {
    playUntil(w, () => delivery(inst(), beat) !== undefined);
    const d = delivery(inst(), beat)!;
    if (d.state === 'released') show(w, d, 'presented');
    w.l2.contentCompleted(d.id);
    settle(w);
  },
});

const ACCEPT: Step[] = [
  { name: 'open the window', run: (w) => { setFact(w, 'q112_done', 1, 10); settle(w); } },
  answer('offer-1', { kind: 'action', id: 'accept' }), activity(1),
  answer('offer-2', { kind: 'action', id: 'accept' }), activity(2),
  answer('offer-3', { kind: 'action', id: 'accept' }),
  play1('intimate'),
];

const DECLINE: Step[] = [
  { name: 'open the window', run: (w) => { setFact(w, 'q112_done', 1, 10); settle(w); } },
  answer('offer-1', { kind: 'decline', id: 'decline' }),
  play1('exit-decline'),
  { name: 'the world settles it', run: (w) => { advance(w, 10 + LAPSE_AFTER + 700); settle(w); } },
  { name: 'play the closing deliveries', run: (w, inst) => {
    playUntil(w, () => inst().st.deliveries.filter((d) => ['closing', 'coda', 'news'].includes(d.what)).every((d) => d.state !== 'queued'), 4000);
  } },
];

const NOT_NOW: Step[] = [
  { name: 'open the window', run: (w) => { setFact(w, 'q112_done', 1, 10); settle(w); } },
  answer('offer-1', { kind: 'null' }), activity(1),
  answer('offer-1', { kind: 'action', id: 'accept' }), activity(2),
  answer('offer-2', { kind: 'decline', id: 'decline' }),
  play1('exit-decline'),
];

/** What the story means at the end, apart from the session: states, facts, responses, and the events minted. */
function fingerprint(w: World, inst: Instance): unknown {
  const st = inst.st;
  const fact = (key: string): unknown => (st.facts[key]?.pin ? w.k.store.pin(st.facts[key]!.pin!)?.value : undefined);
  return {
    state: st.state,
    facts: { rung: fact('rung'), exit: fact('exit') },
    beats: Object.fromEntries(Object.entries(st.beats).map(([k, b]) => [k, b.state])),
    responses: st.record.filter((r) => r.kind === 'response').map((r) => (r.data as { kind: string }).kind),
    closure: st.closed ? { status: st.closed.status, witnessed: st.closed.witnessed } : null,
    transitions: st.record.filter((r) => r.kind === 'transition').map((r) => (r.data as { row: string }).row),
    roles: Object.fromEntries(Object.entries(st.roles).map(([k, r]) => [k, [r.committed, r.cast !== undefined]])),
  };
}

type Make = (name: string) => { w: World; inst: Instance };

function sweep(name: string, steps: Step[], make: Make = r1World): void {
  describe(`crash-point sweep: ${name}`, () => {
    const baseline = (): unknown => {
      const { w } = make(`sweep-${name}`);
      const inst = (): Instance => w.l2.ofTemplate(R1_ID)[0]!;
      for (const s of steps) s.run(w, inst);
      return fingerprint(w, inst());
    };
    const base = baseline();

    for (let cut = 0; cut < steps.length; cut++) {
      test(`save and load after step ${cut} (${steps[cut]!.name}) goes on to the same end`, () => {
        const { w } = make(`sweep-${name}`);
        const inst = (): Instance => w.l2.ofTemplate(R1_ID)[0]!;
        for (let i = 0; i <= cut; i++) steps[i]!.run(w, inst);
        const before = fingerprint(w, inst());
        const ids = inst().st.deliveries.map((d) => [d.id, d.state === 'released' ? 'queued' : d.state]);
        w.k.persistence.save(`cut-${cut}`);
        w.k.persistence.load(`cut-${cut}`, w.gamePort);
        settle(w);
        // S2-I-6: every instance is in the state it was saved in; offers keep their Ids.
        expect(fingerprint(w, inst())).toEqual(before);
        expect(inst().st.deliveries.map((d) => [d.id, d.state])).toEqual(ids as never);
        for (let i = cut + 1; i < steps.length; i++) steps[i]!.run(w, inst);
        expect(fingerprint(w, inst())).toEqual(base as never);
      });
    }
  });
}

/** The first offer is ignored until it lapses with no reoffer left (T10); then the world settles the seed, with no change in between that could wake it. */
const LAPSE: Step[] = [
  { name: 'open the window', run: (w) => { setFact(w, 'q112_done', 1, 10); settle(w); } },
  { name: 'the first offer is shown and ignored', run: (w, inst) => { playUntil(w, () => delivery(inst(), 'offer-1') !== undefined); show(w, delivery(inst(), 'offer-1')!, 'confirmed'); } },
  { name: 'the offer lapses on the play clock', run: (w, inst) => { play(w, clock(w) + 1801); expect(inst().st.state).toBe('unattended'); } },
  { name: 'the world settles it', run: (w) => { advance(w, w.k.now + LAPSE_AFTER + 700); settle(w); } },
  { name: 'play the closing deliveries', run: (w, inst) => { playUntil(w, () => inst().st.deliveries.filter((d) => ['closing', 'coda', 'news'].includes(d.what)).every((d) => d.state !== 'queued'), 4000); } },
];

/** The first request waits out its maxWait unreleased (a busy interface throughout): T14; then the same settling. */
const EXPIRY: Step[] = [
  { name: 'the interface is busy, and the window opens', run: (w) => { w.port.busy = true; setFact(w, 'q112_done', 1, 10); settle(w); } },
  { name: 'the request expires unreleased', run: (w, inst) => { play(w, clock(w) + 125); expect(inst().st.state).toBe('unattended'); } },
  { name: 'the interface is free again, and the world settles it', run: (w) => { w.port.busy = false; advance(w, w.k.now + LAPSE_AFTER + 700); settle(w); } },
  { name: 'play the closing deliveries', run: (w, inst) => { playUntil(w, () => inst().st.deliveries.filter((d) => ['closing', 'coda', 'news'].includes(d.what)).every((d) => d.state !== 'queued'), 4000); } },
];

sweep('the accepting path', ACCEPT);
sweep('the declining path', DECLINE);
sweep('"not now", then accept, then decline', NOT_NOW);
sweep('an ignored offer that lapses', LAPSE, (n) => r1WorldWith(n, { profile: { id: 'relationship-ladder', params: r1Params({ reoffers: 0 }) as never } }));
sweep('a request that expires unreleased', EXPIRY, (n) => r1WorldWith(n, { timing: { maxWait: { clock: 'play', s: 120 }, onExpire: 'unattended' } } as never));

describe('the sweep is not vacuous', () => {
  test('the accepting path ends resolved; the declining path ends resolved by its exit; the lapse and the expiry end by the plan; the clock moved', () => {
    const { w } = r1World('sweep-check');
    const inst = (): Instance => w.l2.ofTemplate(R1_ID)[0]!;
    for (const s of ACCEPT) s.run(w, inst);
    expect(inst().st.state).toBe('resolved');
    expect(clock(w)).toBeGreaterThan(0);
    const { w: w2 } = r1World('sweep-check-2');
    const inst2 = (): Instance => w2.l2.ofTemplate(R1_ID)[0]!;
    for (const s of DECLINE) s.run(w2, inst2);
    expect(inst2().st.state).toBe('resolved');
    expect(inst2().st.record.some((r) => r.kind === 'transition' && (r.data as { row?: string }).row === 'T12')).toBe(true);
    for (const [label, steps, make] of [['lapse', LAPSE, (n: string) => r1WorldWith(n, { profile: { id: 'relationship-ladder', params: r1Params({ reoffers: 0 }) as never } })], ['expiry', EXPIRY, (n: string) => r1WorldWith(n, { timing: { maxWait: { clock: 'play', s: 120 }, onExpire: 'unattended' } } as never)]] as const) {
      const { w: w3 } = make(`sweep-check-${label}`);
      const inst3 = (): Instance => w3.l2.ofTemplate(R1_ID)[0]!;
      for (const s of steps) s.run(w3, inst3);
      expect(inst3().st.state).toBe('resolved');
      const rowsOf = inst3().st.record.filter((r) => r.kind === 'transition').map((r) => (r.data as { row: string }).row);
      expect(rowsOf).toEqual(expect.arrayContaining([label === 'lapse' ? 'T10' : 'T14', 'T13']));
      expect(inst3().st.closed!.status).toBe('abandoned');
    }
    expect(play).toBeDefined();
  });
});
