// Regression tests for the findings of the independent review of the layer-2 core (fix round 1), one describe per finding.
// L2-01, L2-04, L2-12 and L2-13 are kernel findings and are in test/round1.test.ts and test/s2/round1.test.ts; the lint's
// are in test/s2/lint-round1.test.ts.

import { describe, expect, test } from 'bun:test';
import { H, rootId, s as hs } from '../../src/id.ts';
import { ln } from '../../src/fdlibm-log.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import type { Pack, Pred, SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { clock, delivery, play, playUntil, recordOf, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, settle } from './world.ts';

const cause = H(hs('fx'), hs('findings'));

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
const rows = (inst: Instance): string[] => recordOf(inst, 'transition').map((t) => String(t.row));

describe('L2-03: a lapse or an expiry re-evaluates the seed, so the new state\'s wake-ups are installed', () => {
  test('a first offer that lapses with then: unattended settles by the plan, with nothing else waking the seed', () => {
    const { w, inst } = mini('l2-03-lapse');
    openIt(w);
    offer(w, inst);
    play(w, clock(w) + 601);
    expect(inst.st.state).toBe('unattended');
    expect(inst.st.wakeups.some((x) => x.clock === 'game' && x.reason === 'unattended')).toBe(true);
    advance(w, w.k.now + 1300);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(rows(inst)).toEqual(expect.arrayContaining(['T10', 'T13']));
  });

  test('a first request that expires unreleased with onExpire: unattended settles the same way', () => {
    const { w, inst } = mini('l2-03-expiry', { timing: { maxWait: { clock: 'play', s: 120 }, onExpire: 'unattended' } } as never);
    w.port.busy = true;
    openIt(w);
    play(w, clock(w) + 125);
    expect(inst.st.state).toBe('unattended');
    expect(rows(inst)).toContain('T14');
    expect(inst.st.wakeups.some((x) => x.reason === 'unattended')).toBe(true);
    w.port.busy = false;
    advance(w, w.k.now + 1300);
    settle(w);
    expect(inst.st.state).toBe('resolved');
  });

  test('a lapse that offers again leaves the beat deferred and the seed cast, and the next offer follows without an unrelated change', () => {
    const { w, inst } = mini('l2-03-reoffer', {
      beats: { meet: { play: 'pack:f-meet', reoffer: { when: 'since(beat meet) >= 120p', max: 3 } }, finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] } },
    } as never, (p) => { p.fragments.find((f) => f.id === 'f-meet')!.offer!.lapse.then = 'reoffer'; });
    openIt(w);
    const first = offer(w, inst);
    play(w, clock(w) + 601);
    expect(first.state).toBe('expired');
    expect(inst.st.beats.meet!.state).toBe('deferred');
    expect(inst.st.state).toBe('cast');
    // The reoffer's condition runs on the play clock: 120 play seconds after the lapse, with no other change, the offer is made again.
    expect(inst.st.wakeups.some((x) => x.clock === 'play')).toBe(true);
    play(w, clock(w) + 125);
    expect(inst.st.deliveries.filter((d) => d.beat === 'meet').length).toBeGreaterThan(1);
  });
});

describe('L2-05 and L2-06: committing roles', () => {
  test('two roles bound to the same node have two cast edges, one per role', () => {
    const w = makeWorld('l2-06');
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setFact(w, 'flag', 0, 0);
    setFact(w, 'x', 0, 0);
    const person = (): never => ({ kind: 'core:person', identity: npc, must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] }) as never;
    const pack = miniPack({}, { roles: { npc: person(), friend: person() } } as never);
    expect(w.l2.installPack(pack)).toEqual([]);
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    openIt(w);
    offer(w, inst);
    const edges = w.k.store.allEdges().filter((e) => e.type === 'core:cast');
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => (e.data as { role: string }).role).sort()).toEqual(['friend', 'npc']);
    expect(new Set(Object.values(inst.st.edges)).size).toBe(2);
    expect(inst.st.roles.npc!.committed && inst.st.roles.friend!.committed).toBe(true);
    // Ending the seed ends both edges.
    w.l2.withdraw(inst, 'the test ends it');
    settle(w);
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast' && e.valid.to === undefined)).toHaveLength(0);
  });

  test('a stand-in\'s commit-time world requirement is installed and holds', () => {
    const { w, inst } = mini('l2-05', {
      roles: {
        npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }], onUnfilled: ['wait', 'withdraw'] },
        guest: { kind: 'core:person', must: [{ path: 'age', op: 'range', arg: [40, 45] }], onUnfilled: ['standIn'] },
      },
      world: [{ target: { role: 'guest', slot: 'age' }, form: { fixed: { f: 'set', region: { r: 'ivl', ivls: [[41, 43]] }, allow: true } } }],
    } as never);
    expect(inst.st.roles.guest!.standIn).toBeDefined();
    openIt(w);
    offer(w, inst);
    const guest = inst.st.roles.guest!;
    expect(guest.committed).toBe(true);
    expect(guest.cast).toBeDefined();
    expect(inst.st.world[0]!.installed).toBe(true);
    expect(inst.st.world[0]!.contribution).toBeDefined();
    const age = w.k.value(guest.cast!, 'age') as number;
    expect(age).toBeGreaterThanOrEqual(41);
    expect(age).toBeLessThanOrEqual(43);
    // That the requirement is watched for rejection is tested in round2.test.ts (R2-08).
    expect(inst.st.state).not.toBe('withdrawn');
  });
});

describe('L2-07: a claim read decodes every form of `play`', () => {
  test('fixed alternates under a beats-span claim do not crash the claim read', () => {
    const { w, inst } = mini('l2-07', {
      roles: { npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }], onUnfilled: ['wait', 'withdraw'], claim: { span: 'beats', share: 'none' } } },
      beats: {
        meet: { play: { fixed: { alternates: ['pack:f-meet', 'pack:f-alt'] } } },
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
      },
    } as never, (p) => {
      const alt = structuredClone(p.fragments.find((f) => f.id === 'f-meet')!);
      alt.id = 'f-alt';
      alt.applies = 'no';
      p.fragments.push(alt);
    });
    openIt(w);
    offer(w, inst);
    expect(inst.st.beats.meet!.state).toBe('running');
    const node = inst.st.roles.npc!.cast!;
    expect(() => w.l2.claimConflict(node, 'beats', 'none')).not.toThrow();
    expect(w.l2.claimConflict(node, 'beats', 'none')).toBe(true);
  });
});

describe('L2-08: durations read their own clock', () => {
  const sinceMeet = (clockName: 'game' | 'play', s: number): Pred => ({ since: { beat: 'meet' }, atLeast: { clock: clockName, s } }) as Pred;

  test('a play-clock `since` follows the play clock and a game-clock one follows game time, however they diverge', () => {
    const { w, inst } = mini('l2-08-since');
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w);
    expect(inst.st.beats.meet!.state).toBe('done');
    // Game time passes with no play: only the game clause becomes true.
    advance(w, w.k.now + 1800);
    settle(w);
    expect(w.l2.evaluate(inst, sinceMeet('game', 600))).toBe('yes');
    expect(w.l2.evaluate(inst, sinceMeet('play', 60))).toBe('no');
    // Play passes with game time held: only the play clause becomes true, then a long game wait does not change it.
    play(w, clock(w) + 61);
    expect(w.l2.evaluate(inst, sinceMeet('play', 60))).toBe('yes');
    expect(w.l2.evaluate(inst, sinceMeet('game', 600))).toBe('yes');
    const { w: w2, inst: inst2 } = mini('l2-08-since-b');
    openIt(w2);
    const d2 = offer(w2, inst2);
    expect(w2.l2.respond(d2.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w2);
    play(w2, clock(w2) + 90);
    expect(w2.l2.evaluate(inst2, sinceMeet('play', 60))).toBe('yes');
    expect(w2.l2.evaluate(inst2, sinceMeet('game', 600))).toBe('no');
  });

  const ghost = (wait: Pred | { clock: 'game' | 'play'; s: number }) => ({
    roles: {
      npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }], onUnfilled: ['wait', 'withdraw'] },
      ghost: { kind: 'core:person', must: [{ path: 'age', op: 'eq', arg: 99 }], onUnfilled: [{ wait }, 'withdraw'] },
    },
  }) as never;

  test('a timed casting wait on the play clock runs out on play time, and the arbiter wakes the seed for it', () => {
    const { w, inst } = mini('l2-08-wait-play', ghost({ clock: 'play', s: 60 }));
    expect(inst.st.state).toBe('waiting');
    expect(inst.st.wakeups.some((x) => x.clock === 'play')).toBe(true);
    // Game time runs with the play clock held: the wait does not end.
    advance(w, w.k.now + 5000);
    settle(w);
    expect(inst.st.state).not.toBe('withdrawn');
    play(w, clock(w) + 70);
    expect(inst.st.state).toBe('withdrawn');
  });

  test('a timed casting wait on the game clock ignores play time and runs out at the window boundary', () => {
    const { w, inst } = mini('l2-08-wait-game', ghost({ clock: 'game', s: 1200 }));
    play(w, clock(w) + 400);
    expect(inst.st.state).not.toBe('withdrawn');
    expect(inst.st.wakeups.some((x) => x.clock === 'game' && x.reason.startsWith('wait:'))).toBe(true);
    advance(w, w.k.now + 2400);
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
  });

  test('a play-clock wait that was running restarts from a load', () => {
    const { w, inst } = mini('l2-08-wait-load', ghost({ clock: 'play', s: 60 }));
    play(w, clock(w) + 40);
    expect(inst.st.state).toBe('waiting');
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    // 40 of the 60 seconds had passed; after the load the wait starts again, so 40 more seconds do not end it.
    play(w, clock(w) + 40);
    expect(after.st.state).not.toBe('withdrawn');
    play(w, clock(w) + 30);
    expect(after.st.state).toBe('withdrawn');
  });
});

describe('L2-09: the sowing watcher waits on everything a sowing predicate reads', () => {
  const sowing = (name: string, sow: string, mutate?: (w: World) => void): { w: World; count: () => number } => {
    const w = makeWorld(name);
    setFact(w, 'q112_done', 0, 0);
    setFact(w, 'q112_takemura_dead', 0, 0);
    setFact(w, 'flag', 0, 0);
    setFact(w, 'x', 0, 0);
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    mutate?.(w);
    expect(w.l2.installPack(miniPack({}, { sow } as never))).toEqual([]);
    settle(w);
    return { w, count: () => w.l2.ofTemplate(MINI_ID).length };
  };

  test('a guarded fact: the guard turning yes is what sows it (the review\'s scenario)', () => {
    // q112_takemura_dead is read as 0 all along, but `maybe` until its guard (q112_done == 1) holds.
    const { w, count } = sowing('l2-09-guard', 'q112_takemura_dead == 0');
    expect(count()).toBe(0);
    setFact(w, 'q112_done', 1, 20);
    settle(w);
    expect(count()).toBe(1);
  });

  test('a setting: changing it sows the template', () => {
    const { w, count } = sowing('l2-09-setting', 'setting(tempo) in {calm}');
    expect(count()).toBe(0);
    w.k.settings.set({ tempo: 'calm' });
    settle(w);
    expect(count()).toBe(1);
  });

  test('another seed\'s state: its change sows the template', () => {
    const { w, count } = sowing('l2-09-seed', 'seed(xf.other:one) in {withdrawn}');
    expect(count()).toBe(0);
    const other = miniPack({ id: 'other' }, { id: 'xf.other:one', sow: 'no' } as never);
    expect(w.l2.installPack(other)).toEqual([]);
    const o = w.l2.sow('other', 'xf.other:one');
    expect(o.ok).toBe(true);
    settle(w);
    w.l2.withdraw(w.l2.instance(o.instance!)!, 'for the test');
    settle(w);
    expect(count()).toBe(1);
  });

  test('the hour: the boundary that reaches it sows the template', () => {
    const { w, count } = sowing('l2-09-hour', 'hour in [8, 9)');
    expect(count()).toBe(0);
    advance(w, 8 * 3600 + 60);
    settle(w);
    expect(count()).toBe(1);
  });
});

describe('L2-14: a receipt is stamped when its grade is reached', () => {
  test('presented at one moment and confirmed later: recent-exposure predicates see the confirmation at its own time, also after a reload', () => {
    const { w, inst } = mini('l2-14');
    openIt(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    const d = delivery(inst, 'meet')!;
    show(w, d, 'presented');
    const early = inst.st.receipts.find((r) => r.delivery === d.id)!;
    const presentedAt = early.playTotal;
    expect(early.grade).toBe('presented');
    play(w, clock(w) + 11);
    show(w, d, 'confirmed');
    const receipt = inst.st.receipts.find((r) => r.delivery === d.id)!;
    expect(receipt.grade).toBe('confirmed');
    expect(receipt.playTotal).toBe(presentedAt + 11);
    const confirmedRecently: Pred = { exposed: { delivery: d.id, since: { clock: 'play', s: 5 }, atLeast: 'confirmed' } } as Pred;
    expect(w.l2.evaluate(inst, confirmedRecently)).toBe('yes');
    // A grade already held is not restamped by another report of it.
    play(w, clock(w) + 20);
    show(w, d, 'confirmed');
    expect(inst.st.receipts.find((r) => r.delivery === d.id)!.playTotal).toBe(presentedAt + 11);
    expect(w.l2.evaluate(inst, confirmedRecently)).toBe('no');
    // The stamps survive a reload, and a later upgrade after it uses the cumulative play time of its own session.
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    expect(after.st.receipts.find((r) => r.delivery === d.id)!.playTotal).toBe(presentedAt + 11);
    expect(w.l2.playTotal()).toBeGreaterThanOrEqual(presentedAt + 31);
  });

  test('an offer presented before a reload and confirmed after it: the receipt carries the later cumulative play time', () => {
    const { w, inst } = mini('l2-14-reload');
    openIt(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    const d = delivery(inst, 'meet')!;
    show(w, d, 'presented');
    const presentedAt = inst.st.receipts.find((r) => r.delivery === d.id)!.playTotal;
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    play(w, clock(w) + 30);
    const again = after.st.deliveries.find((x) => x.id === d.id)!;
    expect(['queued', 'released', 'displayed']).toContain(again.state);
    if (again.state === 'queued') playUntil(w, () => again.state === 'released');
    show(w, again, 'confirmed');
    const receipt = after.st.receipts.find((r) => r.delivery === d.id)!;
    expect(receipt.grade).toBe('confirmed');
    expect(receipt.playTotal).toBeGreaterThan(presentedAt);
  });
});

describe('L2-16: resituating admits one cue from the last-attended seed, or one class-0 hook', () => {
  const resituating = (name: string, mutate?: (inst: Instance) => void): { w: World; inst: Instance } => {
    const { w, inst } = mini(name);
    w.l2.arbiter.session = 'resituating';
    w.l2.arbiter.sessionSince = clock(w);
    mutate?.(inst);
    openIt(w);
    return { w, inst };
  };

  test('with no seed attended, a class-2 offer waits for the end of the orientation', () => {
    const { w, inst } = resituating('l2-16-none');
    play(w, clock(w) + 100);
    expect(w.l2.arbiter.session).toBe('resituating');
    expect(inst.st.deliveries.filter((d) => d.what === 'offer' && d.state !== 'queued')).toHaveLength(0);
    play(w, clock(w) + 25);
    expect(w.l2.arbiter.session).toBe('normal');
    playUntil(w, () => delivery(inst, 'meet') !== undefined, 200);
    expect(delivery(inst, 'meet')).toBeDefined();
  });

  test('with a seed attended, its cue passes at once, and only one', () => {
    const { w, inst } = resituating('l2-16-last', (i) => {
      i.st.receipts.push({ delivery: H(hs('earlier')), seed: i.id, template: i.st.template.id, grade: 'presented', channels: ['message'], cites: [], cue: {}, at: 0, playTotal: 5 });
    });
    play(w, clock(w) + 3);
    expect(delivery(inst, 'meet')).toBeDefined();
    expect(w.l2.arbiter.cueReleased).toBe(true);
  });

  test('a cue from a seed that is not the last attended does not pass', () => {
    const { w, inst } = resituating('l2-16-other');
    const other = miniPack({ id: 'other' }, { id: 'xf.other:one', sow: 'no' } as never);
    expect(w.l2.installPack(other)).toEqual([]);
    const o = w.l2.instance(w.l2.sow('other', 'xf.other:one').instance!)!;
    o.st.receipts.push({ delivery: H(hs('earlier-other')), seed: o.id, template: o.st.template.id, grade: 'presented', channels: ['message'], cites: [], cue: {}, at: 0, playTotal: 9 });
    play(w, clock(w) + 100);
    expect(inst.st.deliveries.filter((d) => d.what === 'offer' && d.state !== 'queued')).toHaveLength(0);
  });
});

describe('note 74: the draws of modes and variants keep the raw and clamped fit weights', () => {
  test('a mode draw under a fit hook records what the hook returned and what the draw used', () => {
    const { inst } = mini('note-74', { variation: { modes: [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }] } } as never, undefined, { l2: { hooks: { fit: () => 99 } } });
    expect(inst.st.draws.mode).toBeDefined();
    expect(inst.st.draws.mode!.raw).toBe(99);
    expect(inst.st.draws.mode!.clamped).toBeCloseTo(ln(1.5), 12);
  });
});

void MINI_PACK;
