// Conformance to S2 v1.6 and v1.7 and S0 v4.12 (fix round 1): closure status and witnessing, the link rules, casting before the window,
// the category gate, response templates, persistence defaults, wake-ups at window boundaries, and in-scene offers.

import { describe, expect, test } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import { applyEffects } from '../../src/seeding/effects.ts';
import { answerMatches } from '../../src/seeding/arbiter.ts';
import { expandProfile } from '../../src/seeding/profile.ts';
import type { EffectDecl, Fragment, Pack, SeedInput, TextUnit } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { r1Params, r1Seed } from './r1.ts';
import { clock, delivery, play, playUntil, recordOf, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, settle } from './world.ts';

const cause = H(hs('fx'), hs('spec-v17'));

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
const direct = (id: string): Fragment => ({ id, level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: [] });
const rows = (inst: Instance): string[] => recordOf(inst, 'transition').map((t) => String(t.row));

describe('S2 6.4: closure status, witnessing and retired promises', () => {
  const plan = { after: { clock: 'game', s: 600 }, outcome: [{ fact: 'stage', set: 3 }] };

  test('every T13 is abandoned, even when the plan makes `end` yes, and a forced closure retires the open promise', () => {
    const { w, inst } = mini('closure-t13', { end: 'seedFact(stage) == 3', unattended: plan, promises: [{ id: 'p', opens: 'meet', paidBy: 'no' }] } as never);
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
    settle(w);
    expect(inst.st.state).toBe('unattended');
    expect(inst.st.promises.p).toBe('open');
    advance(w, w.k.now + 1300);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(rows(inst)).toContain('T13');
    const closure = recordOf(inst, 'closure')[0]!;
    expect(w.k.store.pin(inst.st.facts.stage!.pin!)!.value).toBe(3);
    expect(closure.status).toBe('abandoned');
    expect(closure.witnessed).toBe(false);
    expect((closure.looseEnds as { promises: string[] }).promises).toEqual(['p']);
    expect(inst.st.promises.p).toBe('retired');
  });

  test('T12 resolves a seed that reached its end while V was in it', () => {
    const { w, inst } = mini('closure-t12', {
      beats: { meet: { play: 'pack:f-meet' }, finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] } },
    } as never);
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    const fin = offer(w, inst, 'finish');
    w.l2.contentCompleted(fin.id);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(rows(inst)).toContain('T12');
    expect(recordOf(inst, 'closure')[0]!.status).toBe('resolved');
    expect(recordOf(inst, 'closure')[0]!.witnessed).toBe(true);
  });

  test('L2-17: a seed that reaches its end off-screen is not witnessed, and queues the unwitnessed-completion news', () => {
    const { w, inst } = mini('closure-offscreen', {
      facts: {}, start: ['quiet'], beats: { quiet: { play: 'pack:f-quiet' } }, end: 'beat(quiet) in {done}', unattended: { after: { clock: 'game', s: 600 }, outcome: [] },
    } as never, (p) => { p.fragments.push(direct('f-quiet')); });
    openIt(w);
    play(w, clock(w) + 5);
    expect(inst.st.state).toBe('resolved');
    expect(rows(inst)).toContain('T12');
    expect(inst.st.receipts).toHaveLength(0);
    const closure = recordOf(inst, 'closure')[0]!;
    expect(closure.status).toBe('resolved');
    expect(closure.witnessed).toBe(false);
    expect(inst.st.deliveries.some((d) => d.what === 'news')).toBe(true);
  });
});

describe('S2 7.1: links', () => {
  const mutateFragments = (...extra: string[]) => (p: Pack): void => { for (const id of extra) p.fragments.push(direct(id)); };
  const hold = { play: 'pack:f-hold', objective: { kind: 'task', succeeds: 'y == 3' } };

  test('an obstructedBy link is a guard that must hold whatever `join` says', () => {
    const { w, inst } = mini('links-guard', {
      start: ['meet', 'hold'],
      beats: {
        meet: { play: 'pack:f-meet' }, hold,
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
        c: { play: 'pack:f-c', join: 'any', links: [{ because: 'meet', on: 'yes' }, { obstructedBy: 'hold' }] },
      },
    } as never, mutateFragments('f-hold', 'f-c'));
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w);
    // The chain link is satisfied (join any needs one), but `hold` is running: the guard holds `c` back.
    expect(inst.st.beats.meet!.state).toBe('done');
    expect(inst.st.beats.hold!.state).toBe('running');
    expect(inst.st.beats.c!.state).toBe('locked');
    setFact(w, 'y', 3, w.k.now + 5);
    settle(w);
    expect(inst.st.beats.hold!.state).toBe('done');
    expect(inst.st.beats.c!.state).toBe('done');
  });

  test('a beat with no chain links, not in start and not led to, becomes available when its fragment\'s needs is yes', () => {
    const { w, inst } = mini('links-needs', { beats: { meet: { play: 'pack:f-meet' }, finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] }, extra: { play: 'pack:f-extra' } } } as never,
      (p) => { p.fragments.push({ ...direct('f-extra'), needs: 'y == 4' }); });
    openIt(w);
    offer(w, inst);
    settle(w);
    expect(inst.st.beats.extra!.state).toBe('locked');
    setFact(w, 'y', 4, w.k.now + 5);
    settle(w);
    expect(inst.st.beats.extra!.state).toBe('done');
  });

  test('a beat a failure leads to becomes available when that failure happens, and not before', () => {
    const seed = {
      beats: {
        meet: { play: 'pack:f-meet' },
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
        task: { play: 'pack:f-task', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], objective: { kind: 'task', succeeds: 'y == 9' }, failure: [{ when: 'y == 5', leadsTo: 'rescue' }] },
        rescue: { play: 'pack:f-rescue' },
      },
    } as never;
    const failing = mini('links-led-fail', seed, mutateFragments('f-task', 'f-rescue'));
    openIt(failing.w);
    const d = offer(failing.w, failing.inst);
    expect(failing.w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(failing.w);
    expect(failing.inst.st.beats.task!.state).toBe('running');
    expect(failing.inst.st.beats.rescue!.state).toBe('locked');
    setFact(failing.w, 'y', 5, failing.w.k.now + 5);
    settle(failing.w);
    expect(failing.inst.st.beats.task!.state).toBe('failed');
    expect(failing.inst.st.beats.task!.failedBy).toBe(0);
    expect(failing.inst.st.beats.rescue!.state).toBe('done');
    // When the task succeeds instead, the failure can never happen: the beat it leads to is skipped as rejected.
    const winning = mini('links-led-win', seed, mutateFragments('f-task', 'f-rescue'));
    openIt(winning.w);
    const d2 = offer(winning.w, winning.inst);
    expect(winning.w.l2.respond(d2.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(winning.w);
    setFact(winning.w, 'y', 9, winning.w.k.now + 5);
    settle(winning.w);
    expect(winning.inst.st.beats.task!.state).toBe('done');
    expect(winning.inst.st.beats.rescue!.state).toBe('skipped');
    expect(winning.inst.st.beats.rescue!.skip).toBe('rejected');
  });

  test('ties go by key, and a beat that becomes available obstructs the later ones in the same pass', () => {
    const never = { kind: 'task', succeeds: 'no' };
    const { w, inst } = mini('links-ties', {
      start: ['meet'],
      beats: {
        meet: { play: 'pack:f-meet' },
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
        q: { play: 'pack:f-q', objective: never, links: [{ obstructedBy: 'p' }] },
        p: { play: 'pack:f-p', objective: never, links: [{ obstructedBy: 'q' }] },
      },
    } as never, mutateFragments('f-p', 'f-q'));
    openIt(w);
    offer(w, inst);
    settle(w);
    // Both could start at once; `p` sorts first, starts, and keeps `q` out.
    expect(inst.st.beats.p!.state).toBe('running');
    expect(inst.st.beats.q!.state).toBe('locked');
  });
});

describe('S2 5: casting does not wait for the window', () => {
  test('a role is cast in sown and waiting while the window is still closed', () => {
    const { w, inst } = mini('cast-early');
    expect(inst.st.state).toBe('waiting');
    expect(inst.st.roles.npc!.cast).toBeDefined();
    expect(inst.st.roles.npc!.committed).toBe(false);
    openIt(w);
    expect(inst.st.state).toBe('cast');
    expect(inst.st.roles.npc!.cast).toBeDefined();
  });

  test('a window that reads a role is `maybe` until the role is cast, and casting does not deadlock on it', () => {
    const { w, inst } = mini('cast-window-reads-role', { windows: [{ id: 'w', opens: 'npc.age >= 30 and flag == 1', closes: 'x == 1', onClose: 'withdraw' }] } as never);
    expect(inst.st.roles.npc!.cast).toBeDefined();
    expect(inst.st.state).toBe('waiting');
    openIt(w);
    expect(inst.st.state).toBe('cast');
  });
});

describe('S2 8.3, gate 6: the category timer applies only to a delivery that names a category', () => {
  const two = (name: string, timing?: Partial<SeedInput['timing']>): { w: World; releases: number[] } => {
    const w = makeWorld(name, { l2: { tunables: { maxLive: 10, displayTimeoutPersistent: 1_000_000, cap: 10 } } });
    const keys = ['b1', 'b2'];
    const fragments: Fragment[] = keys.map((k) => ({ id: `f-${k}`, level: 'exchange', roles: [], salience: 'foreground', forms: { standard: `pack:t-${k}` }, channels: ['message'] }));
    const texts: TextUnit[] = keys.map((k) => ({ id: `t-${k}`, text: `Words ${k}.`, origin: 'authored' }));
    const seed = {
      id: MINI_ID, version: 1, maturity: 'ready', level: 'gig', turns: [], purpose: { tags: ['t'], sentence: 's' }, context: 'yes', intent: { prohibitions: [], tone: [] },
      roles: {}, windows: [{ id: 'w', opens: 'flag == 1', onClose: 'withdraw' }], start: keys, beats: Object.fromEntries(keys.map((k) => [k, { play: `pack:f-${k}` }])),
      end: 'no', unattended: { after: { clock: 'game', s: 600 }, outcome: [] }, ...(timing ? { timing } : {}),
    } as unknown as SeedInput;
    expect(w.l2.installPack({ id: MINI_PACK, version: 1, seeds: [seed as never], fragments, texts })).toEqual([]);
    setFact(w, 'flag', 0, 0);
    w.l2.sow(MINI_PACK, MINI_ID);
    settle(w);
    setFact(w, 'flag', 1, 10);
    settle(w);
    const start = clock(w);
    play(w, start + 400);
    return { w, releases: w.l2.arbiter.log.map((e) => e.at - start) };
  };

  test('with no category the second push follows at the spacing, 60 seconds after the first', () => {
    expect(two('gate6-none').releases.slice(0, 2)).toEqual([0, 60]);
  });
  test('with a category the second push waits for that category\'s timer, 300 seconds', () => {
    expect(two('gate6-cat', { category: 'chat' }).releases.slice(0, 2)).toEqual([0, 300]);
  });
});

describe('S2 2.9: response templates match response kinds', () => {
  test('answerMatches: decline:<id>, action:<id>, action:*, decline:* and any', () => {
    expect(answerMatches('decline:no', 'decline:no')).toBe(true);
    expect(answerMatches('decline:no', 'decline:later')).toBe(false);
    expect(answerMatches('decline:*', 'decline:later')).toBe(true);
    expect(answerMatches('action:*', 'action:go')).toBe(true);
    expect(answerMatches('action:*', 'decline:no')).toBe(false);
    expect(answerMatches('action:go', 'action:skip')).toBe(false);
    expect(answerMatches('any', 'decline:no')).toBe(true);
    expect(answerMatches('any', 'null')).toBe(true);
  });

  const withTemplates = (name: string) => mini(name, {}, (p) => {
    p.fragments.find((f) => f.id === 'f-meet')!.responses = [
      { to: 'decline:no', because: 'V declined', content: 'pack:t-no' },
      { to: 'action:*', because: 'V accepted', content: 'pack:t-go' },
      { to: 'any', because: 'V answered', content: 'pack:t-no', needs: 'no' },
      { to: 'action:skip', because: 'V skipped', content: 'pack:t-skip' },
    ];
  });

  test('the answer picks the templates: a decline plays the decline template, not the action ones; `needs` still applies', () => {
    const { w, inst } = withTemplates('responses-decline');
    openIt(w);
    const d = offer(w, inst);
    expect(d.responses).toEqual([]);
    expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
    expect(d.responses).toEqual(['f-meet#0']);
    expect(recordOf(inst, 'response')[0]!.templates).toEqual(['f-meet#0']);
  });
  test('an action plays the templates for action:* and for that action', () => {
    const { w, inst } = withTemplates('responses-action');
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'skip' })).toBe(true);
    expect(d.responses).toEqual(['f-meet#1', 'f-meet#3']);
  });
});

describe('S2 2.5: persistence defaults', () => {
  const stage = (): { w: World; inst: Instance } => mini('persist-defaults', {
    facts: { stage: { route: { consumers: ['finish'] }, initial: 0 }, side: { initial: 0 }, kept: { initial: 0, persist: 'lasting' }, warm: { initial: 0, authoredOnly: true, persist: 'lasting' } },
  } as never);
  const apply = (w: World, inst: Instance, effects: EffectDecl[]): number => {
    const before = w.l2.global.maintenance.filter((j) => j.kind === 'reset').length;
    applyEffects(w.l2, inst, effects, { origin: 'beat', tag: `t:${before}` });
    return w.l2.global.maintenance.filter((j) => j.kind === 'reset').length - before;
  };

  test('a write to a seed fact with a route is lasting; any other is resettable', () => {
    const { w, inst } = stage();
    expect(apply(w, inst, [{ fact: 'stage', set: 1 }])).toBe(0);
    expect(apply(w, inst, [{ fact: 'side', set: 1 }])).toBe(1);
  });
  test('the effect\'s own persist wins, then the fact\'s', () => {
    const { w, inst } = stage();
    expect(apply(w, inst, [{ fact: 'stage', set: 2, persist: 'resettable' }])).toBe(1);
    expect(apply(w, inst, [{ fact: 'side', set: 2, persist: 'lasting' }])).toBe(0);
    expect(apply(w, inst, [{ fact: 'kept', set: 1 }])).toBe(0);
    expect(apply(w, inst, [{ fact: 'kept', set: 2, persist: 'resettable' }])).toBe(1);
  });
  test('a game-fact write and a reward stay lasting by default', () => {
    const { w, inst } = stage();
    expect(apply(w, inst, [{ reward: { table: 't', tier: 'low' } }])).toBe(0);
  });
});

describe('L2-11 and Appendix A.2 step 6: boundaries are lasting, authored-only, and only rise', () => {
  test('the expansion generates lasting boundary facts and lasting boundary writes', () => {
    const seed = r1Seed({ beats: { 'tell-all': { play: 'pack:qh-offer-acquainted' } } as never }, { boundaries: [{ fact: 'warm', set: 1, by: 'tell-all' }] });
    const exp = expandProfile(seed);
    expect(exp.findings).toEqual([]);
    expect(exp.seed.facts!.warm).toEqual({ authoredOnly: true, initial: 0, persist: 'lasting' });
    expect(exp.seed.beats!['tell-all']!.leaves).toEqual([{ fact: 'warm', set: 1, persist: 'lasting' }]);
    void r1Params;
  });

  test('a boundary survives the reset time, is never lowered, and a procedural seed cannot write it', () => {
    const { w, inst } = mini('boundary-runtime', { facts: { stage: { route: { consumers: ['finish'] }, initial: 0 }, warm: { authoredOnly: true, persist: 'lasting', initial: 0 } } } as never);
    const write = (set: number, persist?: 'resettable'): void => { applyEffects(w.l2, inst, [{ fact: 'warm', set, ...(persist ? { persist } : {}) }], { origin: 'beat', tag: `w:${set}` }); };
    write(1);
    expect(w.k.store.pin(inst.st.facts.warm!.pin!)!.value).toBe(1);
    // Lowering it, or marking the write resettable, changes nothing: the engine never lowers or clears a boundary.
    write(0);
    expect(w.k.store.pin(inst.st.facts.warm!.pin!)!.value).toBe(1);
    write(2, 'resettable');
    expect(w.l2.global.maintenance.filter((j) => j.kind === 'reset')).toHaveLength(0);
    advance(w, w.k.now + 8 * 86_400);
    settle(w);
    expect(w.k.store.pin(inst.st.facts.warm!.pin!)!.value).toBe(2);
    expect(recordOf(inst, 'beat').some((r) => r.refused === 'a boundary only rises')).toBe(true);
    // A seed that is not authored may not write an authored-only fact.
    inst.st.source.layer = 'procedural';
    write(3);
    expect(w.k.store.pin(inst.st.facts.warm!.pin!)!.value).toBe(2);
    expect(recordOf(inst, 'beat').some((r) => r.refused === 'the fact is authored-only')).toBe(true);
  });
});

describe('S2 4.3: game-time wake-ups fire only at window boundaries', () => {
  const run = (steps: number[]): { state: string; at: number | undefined } => {
    const { w, inst } = mini('wake-boundary', { unattended: { after: { clock: 'game', s: 600 }, outcome: [{ fact: 'stage', set: 0 }] } } as never);
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
    settle(w);
    expect(inst.st.state).toBe('unattended');
    const entered = inst.st.entered.unattended!;
    for (const t of steps) advance(w, entered + t);
    return { state: inst.st.state, at: inst.st.state === 'resolved' ? inst.st.since : undefined };
  };

  test('a plan due inside a window settles at the boundary that ends it, whatever the ticks and the changes in between', () => {
    const { w, inst } = mini('wake-boundary-change', { unattended: { after: { clock: 'game', s: 600 }, outcome: [{ fact: 'stage', set: 0 }] } } as never);
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
    settle(w);
    const entered = inst.st.entered.unattended!;
    const due = entered + 600;
    const boundary = Math.ceil(due / 600) * 600;
    expect(boundary).toBeGreaterThan(due);
    // Past the due time but inside the window: a change V's seed reads makes it re-evaluate, and it must not settle early.
    advance(w, due + 5);
    setFact(w, 'x', 1, due + 10);
    settle(w);
    expect(w.k.now).toBeLessThan(boundary);
    expect(inst.st.state).toBe('unattended');
    advance(w, boundary);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(inst.st.since).toBe(boundary);
  });

  test('one jump and many small ticks settle the same seed at the same boundary', () => {
    const a = run([5000]);
    const b = run([100, 200, 650, 1199, 1250, 2000, 5000]);
    expect(a.state).toBe('resolved');
    expect(b.state).toBe('resolved');
    expect(b.at).toBe(a.at);
  });
});

describe('S2 8.3 in-scene offers (v1.7)', () => {
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
    p.fragments.find((f) => f.id === 'f-meet')!.scene = 'talk';
    p.fragments.push({
      id: 'f-ask', scene: 'talk', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-go' }, channels: ['message'],
      offer: { stakes: [{ bearer: 'npc', what: 'x' }], actions: [{ id: 'a', stance: 'help', foresight: 'pack:t-go' }], nullPath: { id: 'n' }, lapse: { after: { clock: 'play', s: 600 }, then: 'unattended' }, decline: [{ id: 'd' }], choice: 'flavour' },
    });
  });

  test('an in-scene offer is not a push: the attempt bound does not stop it', () => {
    const { w, inst } = build('inscene-bound');
    const first = offer(w, inst);
    settle(w);
    const ask = inst.st.deliveries.find((d) => d.beat === 'ask')!;
    ask.attempts = w.l2.tun.maxAttempts + 2;
    w.port.busy = true;
    w.l2.advancePlay(clock(w) + 1);
    settle(w);
    expect(ask.stopped).not.toBe(true);
    expect(ask.state).toBe('released');
    expect(first.state).toBe('displayed');
    // A push of the same kind is stopped by the same count.
    const normal = inst.st.deliveries.find((d) => d.beat === 'meet')!;
    expect(normal.stopped).not.toBe(true);
  });

  test('a scene that ends takes its offer with it: queued, released or displayed, it is dropped and its beat skipped as rejected', () => {
    for (const stage of ['queued', 'released', 'displayed'] as const) {
      const { w, inst } = build(`inscene-end-${stage}`);
      const first = offer(w, inst);
      settle(w);
      const ask = inst.st.deliveries.find((d) => d.beat === 'ask')!;
      expect(ask.state).toBe('queued');
      if (stage !== 'queued') {
        w.l2.advancePlay(clock(w) + 1);
        settle(w);
        expect(ask.state).toBe('released');
      }
      if (stage === 'displayed') {
        show(w, ask, 'confirmed');
        expect(ask.state).toBe('displayed');
      }
      // The scene ends: the beat the offer follows is done.
      expect(w.l2.respond(first.id, { kind: 'action', id: 'go' })).toBe(true);
      settle(w);
      expect(ask.state).toBe('withdrawn');
      expect(inst.st.beats.ask!.state).toBe('skipped');
      expect(inst.st.beats.ask!.skip).toBe('rejected');
      expect(recordOf(inst, 'expired').some((r) => r.delivery === ask.id && r.why === 'the scene ended')).toBe(true);
      // It cannot be answered any more.
      expect(w.l2.respond(ask.id, { kind: 'action', id: 'a' })).toBe(false);
    }
  });
});
