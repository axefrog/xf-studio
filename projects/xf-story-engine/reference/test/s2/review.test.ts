// Regression tests for the findings of the independent review of the core (R-3 to R-16; R-1 and R-2 are in
// test/v4.test.ts with the staged batch, R-7 in lint.test.ts with the later capabilities).

import { describe, expect, test } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import type { Pack, SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, miniPack } from './mini.ts';
import { clock, delivery, play, playUntil, recordOf, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, settle } from './world.ts';

const cause = H(hs('fx'), hs('review'));

function mini(name: string, seed: Partial<SeedInput> = {}, mutate?: (p: Pack) => void, opts: Parameters<typeof makeWorld>[1] = {}): { w: World; inst: Instance } {
  const w = makeWorld(name, opts);
  const npc = w.k.root('npc', 'core:person');
  w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
  w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
  setFact(w, 'x', 0, 0);
  setFact(w, 'flag', 0, 0);
  setFact(w, 'y', 0, 0);
  const pack = miniPack({}, seed);
  mutate?.(pack);
  expect(w.l2.installPack(pack)).toEqual([]);
  const r = w.l2.sow(pack.id, MINI_ID);
  expect(r.ok, JSON.stringify(r.findings)).toBe(true);
  settle(w);
  return { w, inst: w.l2.instance(r.instance!)! };
}

const openIt = (w: World): void => { setFact(w, 'flag', 1, w.k.now + 10); settle(w); };

const offer = (w: World, inst: Instance, beat = 'meet'): NonNullable<ReturnType<typeof delivery>> => {
  playUntil(w, () => delivery(inst, beat) !== undefined);
  const d = delivery(inst, beat)!;
  if (d.state === 'released') show(w, d, 'confirmed');
  return d;
};

describe('R-3: a channel-free beat with an objective keeps running', () => {
  test('the objective, not the content, completes it', () => {
    const { w, inst } = mini('R-3', {
      beats: {
        meet: { play: 'pack:f-meet' },
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], objective: { succeeds: 'y == 7' }, leaves: [{ fact: 'stage', set: 3 }] },
      },
    } as never, (p) => { p.fragments.find((f) => f.id === 'f-finish')!.channels = []; });
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w);
    expect(inst.st.beats.finish!.state).toBe('running');
    expect(inst.st.state).toBe('running');
    setFact(w, 'y', 7, w.k.now + 5);
    settle(w);
    expect(inst.st.beats.finish!.state).toBe('done');
  });
});

describe('R-4 and R-8: an unreleased expiry keeps one delivery per id and counts towards the bound', () => {
  test('retries under a busy UI never duplicate an id, count as attempts, and the retried offer can still be shown and answered', () => {
    const { w, inst } = mini('R-4');
    openIt(w);
    w.port.busy = true;
    play(w, clock(w) + 1800 * 2 + 40);
    const offers = inst.st.deliveries.filter((d) => d.what === 'offer');
    expect(new Set(offers.map((d) => d.id)).size).toBe(offers.length);
    expect(offers[0]!.attempts).toBeGreaterThanOrEqual(2);
    w.port.busy = false;
    const d = offer(w, inst);
    expect(d.state).toBe('displayed');
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
  });

  test('with a busy UI throughout, the offer is stopped at the bound and waits for pull', () => {
    const { w, inst } = mini('R-8');
    openIt(w);
    w.port.busy = true;
    play(w, clock(w) + 1800 * 6);
    const last = inst.st.deliveries.filter((d) => d.what === 'offer').pop()!;
    expect(last.attempts).toBeGreaterThanOrEqual(w.l2.tun.maxAttempts);
    expect(last.stopped === true || last.state !== 'queued').toBe(true);
  });
});

describe('R-5 and R-12: in-scene follow-ups', () => {
  const seed: Partial<SeedInput> = {
    windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
    facts: { stage: { route: { consumers: ['finish'] }, initial: 0 } },
    beats: {
      meet: { play: 'pack:f-meet' },
      ask: { play: 'pack:f-ask', inScene: true, links: [{ because: 'meet', on: 'yes' }] },
      finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }] },
    },
  } as never;
  const build = (name: string): { w: World; inst: Instance } => mini(name, seed, (p) => {
    p.fragments.push({
      id: 'f-ask', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-go' }, channels: ['message'],
      offer: { stakes: [{ bearer: 'npc', what: 'x' }], actions: [{ id: 'a', stance: 'help', foresight: 'pack:t-go' }], nullPath: { id: 'n' }, lapse: { after: { clock: 'play', s: 600 }, then: 'unattended' }, decline: [{ id: 'd', response: 'pack:t-no' }], choice: 'flavour' },
    });
  });

  test('R-5: answering the follow-up does not answer the first offer: the seed stays offered', () => {
    const { w, inst } = build('R-5');
    const first = offer(w, inst);
    settle(w);
    w.l2.advancePlay(clock(w) + 1);
    settle(w);
    const ask = inst.st.deliveries.find((d) => d.beat === 'ask')!;
    show(w, ask, 'confirmed');
    expect(w.l2.respond(ask.id, { kind: 'action', id: 'a' })).toBe(true);
    expect(inst.st.state).toBe('offered');
    expect(inst.st.beats.meet!.response).toBeUndefined();
    expect(inst.st.firstOffer).toBe(first.id);
    // Answering the first offer is T9.
    expect(w.l2.respond(first.id, { kind: 'action', id: 'go' })).toBe(true);
    expect(inst.st.state).toBe('running');
  });

  test('R-12: once the scene it follows is over, the follow-up is not released', () => {
    const { w, inst } = build('R-12');
    const first = offer(w, inst);
    expect(w.l2.respond(first.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w);
    // The meet beat is done: the scene is over. A follow-up that was still waiting is dropped, never shown.
    w.port.busy = true;
    play(w, clock(w) + 5);
    const ask = inst.st.deliveries.find((d) => d.beat === 'ask');
    if (ask) expect(['withdrawn', 'queued', 'expired']).toContain(ask.state);
    expect(inst.st.beats.ask!.state).not.toBe('running');
  });
});

describe('R-6: readers of settings, other seeds and exposure are told', () => {
  test('a window that opens when a setting changes opens at the change', () => {
    const { w, inst } = mini('R-6-settings', {
      windows: [{ id: 'w', opens: 'flag == 1 and setting(tempo) in {calm}', closes: 'x == 1', onClose: 'withdraw' }],
    } as never);
    openIt(w);
    play(w, clock(w) + 30);
    expect(delivery(inst, 'meet')).toBeUndefined();
    w.k.settings.set({ tempo: 'calm' });
    settle(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined, 600);
    expect(delivery(inst, 'meet')).toBeDefined();
  });

  test('a window that opens when another seed resolves opens at the transition', () => {
    const w = makeWorld('R-6-seeds');
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 1, 0);
    const a = miniPack({ id: 'pa' }, { id: 'x:a' } as never);
    const b = miniPack({ id: 'pb' }, { id: 'x:b', windows: [{ id: 'w', opens: 'seed(x:a) in {withdrawn}', closes: 'x == 1', onClose: 'withdraw' }] } as never);
    expect(w.l2.installPack(a)).toEqual([]);
    expect(w.l2.installPack(b)).toEqual([]);
    const ra = w.l2.sow('pa', 'x:a');
    const rb = w.l2.sow('pb', 'x:b');
    expect(ra.ok && rb.ok, JSON.stringify([ra.findings, rb.findings])).toBe(true);
    settle(w);
    const ib = w.l2.instance(rb.instance!)!;
    const ia = w.l2.instance(ra.instance!)!;
    play(w, clock(w) + 20);
    expect(delivery(ib, 'meet')).toBeUndefined();
    w.l2.withdraw(ia, 'a test');
    settle(w);
    playUntil(w, () => delivery(ib, 'meet') !== undefined, 600);
    expect(delivery(ib, 'meet')).toBeDefined();
  });
});

describe('R-9: a game-clock wait does not restart at a load', () => {
  test('the delivery keeps the game time it was submitted at', () => {
    const { w, inst } = mini('R-9');
    openIt(w);
    w.port.busy = true;
    play(w, clock(w) + 20);
    const d = inst.st.deliveries.find((x) => x.what === 'offer')!;
    const was = d.submittedGame;
    advance(w, w.k.now + 100);
    settle(w);
    expect(w.k.now).toBeGreaterThan(was);
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    const after = w.l2.ofTemplate(MINI_ID)[0]!.st.deliveries.find((x) => x.what === 'offer')!;
    expect(after.submittedGame).toBe(was);
  });
});

describe('R-10: a migration that withdraws applies to a saved instance at the load', () => {
  test('a fresh host with version 2 withdraws the version-1 instance it loads', () => {
    const { w, inst } = mini('R-10');
    openIt(w);
    w.k.persistence.save('a');
    const rec = w.k.persistence.chain.get('a')!;
    expect(rec).toBeDefined();
    const v2 = miniPack({ version: 2 }, { version: 2, migrate: [{ from: [1], policy: 'withdraw' }] } as never);
    w.l2.packs.get('xf.fixture')!.pack.seeds = v2.seeds;
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    const loaded = w.l2.ofTemplate(MINI_ID)[0]!;
    expect(loaded.id).toBe(inst.id);
    expect(loaded.st.state).toBe('withdrawn');
  });
});

describe('R-11: answering an offer that was released but not reported confirms it first', () => {
  test('the offer event, the grade and the receipt exist before the response', () => {
    const { w, inst } = mini('R-11');
    openIt(w);
    playUntil(w, () => delivery(inst, 'meet', ['released']) !== undefined);
    const d = delivery(inst, 'meet', ['released'])!;
    expect(d.state).toBe('released');
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    expect(d.offerEvent).toBeDefined();
    expect(d.grade).toBe('confirmed');
    expect(inst.st.receipts.some((r) => r.delivery === d.id && r.grade === 'confirmed')).toBe(true);
  });
});

describe('R-13: a cosmetic effect writes no pin', () => {
  test('the mark exists, nothing reads the fact', () => {
    const { w, inst } = mini('R-13', {}, (p) => {
      const o = p.fragments.find((f) => f.id === 'f-meet')!.offer!;
      o.actions[0]!.writes = [{ fact: 'stage', set: 1, persist: 'cosmetic', carrier: { kind: 'place', at: w0(), durability: 'permanent' } } as never];
    });
    function w0(): string { return 'npc'; }
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    expect(inst.st.facts.stage?.pin).toBeUndefined();
  });
});

describe('R-14: closing deliveries expire and release their references', () => {
  test('after closeExpiry an unshown closing delivery is expired and its maintenance job is gone', () => {
    const { w, inst } = mini('R-14');
    openIt(w);
    const d = offer(w, inst);
    w.l2.respond(d.id, { kind: 'decline', id: 'no' });
    settle(w);
    w.l2.withdraw(inst, 'a test');
    settle(w);
    expect(w.l2.global.maintenance.some((j) => j.kind === 'closing')).toBe(true);
    // No channel is free for it: it waits, then expires with its job.
    w.port.channels.clear();
    w.k.settle({ to: w.k.now + 4 * 86_400 });
    settle(w);
    expect(w.l2.global.maintenance.some((j) => j.kind === 'closing')).toBe(false);
    const closing = inst.st.deliveries.filter((x) => x.what === 'closing');
    expect(closing.every((x) => x.state !== 'queued')).toBe(true);
  });
});

describe('R-15: retractQuietly is delivered', () => {
  test('the quiet reply is not cancelled by the retraction', () => {
    const { w, inst } = mini('R-15', {}, (p) => {
      const o = p.fragments.find((f) => f.id === 'f-meet')!.offer!;
      o.retractQuietly = 'pack:t-no';
    });
    openIt(w);
    const d = offer(w, inst);
    expect(d.timing.class).toBeGreaterThanOrEqual(2);
    expect(w.l2.respond(d.id, { kind: 'retract' })).toBe(true);
    const reply = inst.st.deliveries.find((x) => x.what === 'reply');
    expect(reply).toBeDefined();
    expect(reply!.state).toBe('queued');
    playUntil(w, () => inst.st.deliveries.find((x) => x.what === 'reply')!.state !== 'queued', 600);
    expect(['released', 'displayed', 'answered']).toContain(inst.st.deliveries.find((x) => x.what === 'reply')!.state);
  });
});

describe('R-16: L-06 asks for distinct values of a consumed fact, and allows shared side effects', () => {
  const lint = (mutate: (p: Pack) => void): string[] => {
    const w = makeWorld('R-16');
    const pack = miniPack();
    mutate(pack);
    w.l2.installPack(pack);
    const r = w.l2.sow(pack.id, MINI_ID);
    return (r.findings ?? []).filter((f) => f.level === 'error').map((f) => f.code);
  };
  test('a shared write alongside distinct consumed values passes; identical consumed writes fail', () => {
    const shared = lint((p) => {
      const o = p.fragments.find((f) => f.id === 'f-meet')!.offer!;
      o.actions[0]!.writes = [{ fact: 'stage', set: 1 }, { fact: 'stage2', set: 9 } as never];
      o.actions[1]!.writes = [{ fact: 'stage', set: 2 }, { fact: 'stage2', set: 9 } as never];
      (p.seeds[0] as unknown as SeedInput).facts = { stage: { route: { consumers: ['finish'] }, initial: 0 }, stage2: { initial: 0 } } as never;
    });
    expect(shared).not.toContain('L-06');
    const same = lint((p) => {
      const o = p.fragments.find((f) => f.id === 'f-meet')!.offer!;
      o.actions[0]!.writes = [{ fact: 'stage', set: 1 }];
      o.actions[1]!.writes = [{ fact: 'stage', set: 1 }];
    });
    expect(same).toContain('L-06');
  });
});

void recordOf;
