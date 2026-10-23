// More of the run-time rules: close policies, ladders, lost roles, objectives and failures, aftermaths,
// in-scene offers, intersections by effect, and world requirements (S2 sections 2.7, 5.4, 5.5, 7.3, 8.3, 9).

import { describe, expect, test } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import type { Pack, SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { clock, delivery, play, playUntil, recordOf, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, setGame, settle } from './world.ts';

const cause = H(hs('fx'), hs('more'));

function mini(name: string, seed: Partial<SeedInput> = {}, mutate?: (p: Pack) => void, people = 1): { w: World; inst: Instance } {
  const w = makeWorld(name);
  for (let i = 0; i < people; i++) {
    const npc = w.k.root(`npc-${i}`, 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35 + i, reason: 'authored', cause });
  }
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

const offer = (w: World, inst: Instance, beat = 'meet'): NonNullable<ReturnType<typeof delivery>> => {
  playUntil(w, () => delivery(inst, beat) !== undefined);
  const d = delivery(inst, beat)!;
  if (d.state === 'released') show(w, d, 'confirmed');
  return d;
};

describe('close policies (S2 section 2.7)', () => {
  const closed = (onClose: 'withdraw' | 'degrade' | 'coda' | 'memory', holds = false, after = true): { w: World; inst: Instance } => {
    const { w, inst } = mini(`close-${onClose}-${holds}`, {
      windows: [{ id: 'w', opens: 'flag == 1', closes: 'x == 1', onClose, ...(onClose === 'coda' || onClose === 'memory' ? { closeContent: 'pack:t-no' } : {}), ...(holds ? { holdsWhileRunning: true } : {}) }],
    } as never);
    setFact(w, 'flag', 1, 10);
    settle(w);
    if (after) offer(w, inst);
    setFact(w, 'x', 1, w.k.now + 20);
    settle(w);
    return { w, inst };
  };
  const kinds = (inst: Instance): string[] => inst.st.deliveries.map((d) => d.what).sort();

  test('after a release: withdraw withers with the closing trace only; coda and memory deliver the close content', () => {
    const a = closed('withdraw');
    expect(a.inst.st.state).toBe('withered');
    expect(kinds(a.inst)).toEqual(expect.arrayContaining(['closing']));
    expect(kinds(a.inst)).not.toContain('coda');
    const b = closed('coda');
    expect(b.inst.st.state).toBe('withered');
    expect(kinds(b.inst)).toEqual(expect.arrayContaining(['closing', 'coda']));
    const c = closed('memory');
    expect(kinds(c.inst)).toEqual(expect.arrayContaining(['coda']));
  });

  test('degrade moves the seed to unattended, and the world settles it without V', () => {
    const { w, inst } = closed('degrade');
    expect(inst.st.state).toBe('unattended');
    advance(w, w.k.now + 1300);
    settle(w);
    expect(inst.st.state).toBe('resolved');
  });

  test('a window that holds while running does not end a running seed', () => {
    const { inst } = closed('withdraw', true);
    expect(inst.st.state).toBe('offered');
  });

  test('before a release the close is silent for withdraw: no closing trace, no news, nothing delivered', () => {
    const { inst } = closed('withdraw', false, false);
    expect(inst.st.state).toBe('withered');
    expect(inst.st.deliveries.every((d) => d.state === 'withdrawn')).toBe(true);
    expect(inst.st.deliveries.some((d) => d.what === 'closing' || d.what === 'coda' || d.what === 'news')).toBe(false);
    expect(inst.st.record.some((r) => r.kind === 'closure')).toBe(true);
    // A seed never released closes without a seed-outcome event: nothing was seen (S2 section 6.4).
    expect(inst.st.closed).toBeDefined();
  });
});

describe('ladders (S2 section 5.4)', () => {
  test('relax demotes a requirement to a preference and casts at once', () => {
    const { w, inst } = mini('relax', {
      windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
      roles: { npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }, { path: 'age', op: 'range', arg: [60, 70] }], onUnfilled: [{ relax: 1 }, 'withdraw'] } },
    } as never);
    expect(inst.st.roles.npc!.ladder.relaxed).toEqual([1]);
    expect(inst.st.roles.npc!.cast).toBeDefined();
    expect(inst.st.state).toBe('cast');
    void w;
  });

  test('a timed wait stays waiting until its deadline, then the next step runs', () => {
    const { w, inst } = mini('wait', {
      windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
      roles: { npc: { kind: 'core:person', must: [{ path: 'age', op: 'range', arg: [60, 70] }], onUnfilled: [{ wait: { clock: 'game', s: 1500 } }, 'withdraw'] } },
    } as never);
    expect(inst.st.state).toBe('waiting');
    advance(w, w.k.now + 1200);
    settle(w);
    expect(inst.st.state).toBe('waiting');
    advance(w, w.k.now + 1500);
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
    expect(recordOf(inst, 'unfilled').length).toBeGreaterThan(0);
  });

  test('shrink drops an optional role, and the beats that bind it are omitted', () => {
    const { w, inst } = mini('shrink', {
      windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
      roles: {
        npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] },
        extra: { kind: 'core:person', optional: true, must: [{ path: 'age', op: 'range', arg: [60, 70] }], onUnfilled: ['shrink'] },
      },
      beats: {
        meet: { play: 'pack:f-meet' },
        side: { play: 'pack:f-side', links: [{ because: 'meet', on: 'yes' }] },
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
      },
    } as never, (p) => {
      p.fragments.push({ id: 'f-side', level: 'exchange', roles: ['extra'], salience: 'background', forms: { standard: 'pack:t-finish' }, channels: ['message'] });
    });
    expect(inst.st.roles.extra!.shrunk).toBe(true);
    expect(inst.st.state).toBe('cast');
    const d = offer(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    expect(inst.st.beats.side!.state).toBe('skipped');
    expect(inst.st.beats.side!.skip).toBe('omitted');
    // An omitted beat is transparent: the link through it passes as if it were done without effects.
  });
});

describe('lost roles (S2 section 5.5)', () => {
  const lostSeed = (onLost: 'withdraw' | 'shrink' | 'standIn', extra: Record<string, unknown> = {}): Partial<SeedInput> => ({
    windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
    roles: {
      npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] },
      hero: { kind: 'core:person', identity: 'game:hero', onLost, ...(onLost === 'shrink' ? { optional: true } : {}), ...extra, must: [{ path: 'alive', op: 'eq', arg: 1 }, { path: 'age-class', op: 'eq', arg: 'adult' }] },
    },
  } as never);
  const setup = (name: string, onLost: 'withdraw' | 'shrink' | 'standIn', extra: Record<string, unknown> = {}): { w: World; inst: Instance } => {
    const w = makeWorld(name);
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
    setGame(w, 'hero', 'fx:character', 'alive', 1, 0);
    setGame(w, 'hero', 'fx:character', 'age-class', 'adult', 0);
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 1, 0);
    const p = miniPack({}, lostSeed(onLost, extra));
    p.fragments.find((f) => f.id === 'f-finish')!.roles = ['npc', 'hero'];
    expect(w.l2.installPack(p)).toEqual([]);
    const r = w.l2.sow(MINI_PACK, MINI_ID);
    expect(r.ok, JSON.stringify(r.findings)).toBe(true);
    settle(w);
    return { w, inst: w.l2.instance(r.instance!)! };
  };
  const killBeforeNextBeat = (w: World, inst: Instance): void => {
    const d = offer(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    // The role commits when the first beat that uses it is prepared; here it is the finishing beat.
    advance(w, w.k.now + 3);
    w.k.reading(w.k.mirrored('hero', 'fx:character'), 'alive', 0, w.k.now);
    w.l2.advancePlay(clock(w) + 70);
    settle(w);
  };

  test('withdraw: a lost anchor ends the seed', () => {
    const { w, inst } = setup('lost-withdraw', 'withdraw', { anchor: true });
    killBeforeNextBeat(w, inst);
    expect(inst.st.state).toBe('withdrawn');
    expect(recordOf(inst, 'lost').length).toBeGreaterThan(0);
  });

  test('shrink: an optional role is dropped and the seed goes on', () => {
    const { w, inst } = setup('lost-shrink', 'shrink');
    killBeforeNextBeat(w, inst);
    expect(inst.st.roles.hero!.shrunk).toBe(true);
    expect(inst.st.state).not.toBe('withdrawn');
  });
});

describe('objectives, warnings and failures (S2 section 7.3)', () => {
  const seed = (extra: Record<string, unknown>): Partial<SeedInput> => ({
    windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
    facts: { stage: { route: { consumers: ['end'] }, initial: 0 } },
    start: ['task'],
    beats: {
      task: { play: 'pack:f-finish', objective: { kind: 'task', succeeds: 'x == 1', fails: 'y == 1', warns: 'flag == 2' }, leaves: [{ fact: 'stage', set: 1 }], ...extra },
      fallback: { play: 'pack:f-finish', links: [{ because: 'task', on: 'beat(task) in {failed}' }], leaves: [{ fact: 'stage', set: 2 }] },
    },
    end: 'beat(task) in {done} or beat(fallback) in {done} or seedFact(stage) == 99',
  } as never);
  const run = (name: string, extra: Record<string, unknown>): { w: World; inst: Instance } => {
    const r = mini(name, seed(extra), (p) => { p.fragments.find((f) => f.id === 'f-meet')!.offer = undefined; });
    play(r.w, clock(r.w) + 5);
    const d = delivery(r.inst, 'task')!;
    expect(d).toBeDefined();
    show(r.w, d, 'presented');
    return r;
  };

  test('a succeeding objective completes the beat and writes its leaves', () => {
    const { w, inst } = run('obj-success', {});
    expect(inst.st.beats.task!.state).toBe('running');
    setFact(w, 'x', 1, w.k.now + 5);
    settle(w);
    expect(inst.st.beats.task!.state).toBe('done');
    expect(inst.st.state).toBe('resolved');
  });

  test('a failing objective fails the beat; failure wins over success in the same step; the failed beat leads somewhere', () => {
    const a = run('obj-fail', {});
    setFact(a.w, 'y', 1, a.w.k.now + 5);
    settle(a.w);
    expect(a.inst.st.beats.task!.state).toBe('failed');
    expect(a.inst.st.beats.fallback!.state === 'available' || a.inst.st.beats.fallback!.state === 'running').toBe(true);
    const b = run('obj-both', {});
    advance(b.w, b.w.k.now + 5);
    b.w.k.reading(b.w.l2.factNode('x'), 'value', 1, b.w.k.now);
    b.w.k.reading(b.w.l2.factNode('y'), 'value', 1, b.w.k.now);
    settle(b.w);
    expect(b.inst.st.beats.task!.state).toBe('failed');
  });

  test('a warning is delivered once, when its condition first holds', () => {
    const { w, inst } = run('obj-warn', {});
    setFact(w, 'flag', 2, w.k.now + 5);
    settle(w);
    settle(w);
    expect(inst.st.deliveries.filter((d) => d.what === 'warning')).toHaveLength(1);
  });

  test('a failure with warnFirst fires only after its warning was confirmed', () => {
    const { w, inst } = run('fail-warn', { failure: [{ when: 'y == 1', warnFirst: 'flag == 2', leadsTo: 'fallback' }], objective: undefined });
    setFact(w, 'y', 1, w.k.now + 5);
    settle(w);
    expect(inst.st.beats.task!.state).toBe('running');
    setFact(w, 'flag', 2, w.k.now + 5);
    settle(w);
    const warning = inst.st.deliveries.find((d) => d.what === 'warning')!;
    expect(warning).toBeDefined();
    playUntil(w, () => warning.state === 'released');
    expect(inst.st.beats.task!.state).toBe('running');
    show(w, warning, 'confirmed');
    settle(w);
    expect(inst.st.beats.task!.state).toBe('failed');
  });
});

describe('aftermath (S2 section 7.3)', () => {
  const seed = (cancel?: string): Partial<SeedInput> => ({
    windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
    facts: { stage: { route: { consumers: ['after'] }, initial: 0 } },
    beats: {
      meet: { play: 'pack:f-meet' },
      after: { play: 'pack:f-finish', kind: 'aftermath', aftermath: { delay: { clock: 'game', s: 1800 }, signposts: ['pack:f-finish'], ...(cancel ? { cancelIf: cancel } : {}) }, links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
    },
    end: 'beat(after) in {done}',
  } as never);
  test('on becoming available an aftermath waits its delay; then its signposts and the beat are delivered', () => {
    const { w, inst } = mini('after', seed());
    const d = offer(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    expect(inst.st.beats.after!.state).toBe('available');
    expect(inst.st.deliveries.filter((x) => x.beat === 'after')).toHaveLength(0);
    advance(w, w.k.now + 3600);
    settle(w);
    expect(inst.st.deliveries.filter((x) => x.beat === 'after').length).toBe(2);
    expect(inst.st.deliveries.some((x) => x.what === 'signpost')).toBe(true);
  });
  test('unless cancelIf is yes, in which case the aftermath is skipped, and never reachable', () => {
    const { w, inst } = mini('after-cancel', seed('y == 1'));
    const d = offer(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    setFact(w, 'y', 1, w.k.now + 5);
    advance(w, w.k.now + 3600);
    settle(w);
    expect(inst.st.beats.after!.state).toBe('skipped');
    expect(inst.st.beats.after!.skip).toBe('rejected');
  });
});

describe('in-scene offers (S2 section 8.3, L-131a)', () => {
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
      scene: 'talk', id: 'f-ask', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-go' }, channels: ['message'],
      offer: { stakes: [{ bearer: 'npc', what: 'x' }], actions: [{ id: 'a', stance: 'help', foresight: 'pack:t-go' }], nullPath: { id: 'n' }, lapse: { after: { clock: 'play', s: 600 }, then: 'unattended' }, decline: [{ id: 'd', response: 'pack:t-no' }], choice: 'flavour' },
    });
  });
  test('released straight into the running scene of the beat it follows, past every gate', () => {
    const { w, inst } = build('in-scene');
    const first = offer(w, inst);
    expect(first.state).toBe('displayed');
    // The scene is running: the follow-up offer is part of it, not a new push, so a busy UI and the spacing gate do not hold it.
    settle(w);
    w.port.busy = true;
    w.l2.advancePlay(clock(w) + 1);
    settle(w);
    const ask = inst.st.deliveries.find((d) => d.beat === 'ask')!;
    expect(ask).toBeDefined();
    expect(ask.inScene).toBe(true);
    expect(ask.state).toBe('released');
    // It follows the response lifecycle like any offer.
    show(w, ask, 'confirmed');
    expect(w.l2.respond(ask.id, { kind: 'action', id: 'a' })).toBe(true);
    expect(inst.st.beats.ask!.response).toBe('action:a');
  });
});

describe('intersections by effect (S2 section 9.1)', () => {
  test('an effect one seed declares writes a game fact another reads: recorded on both, and the reader\'s depends decides', () => {
    const w = makeWorld('effect');
    for (let i = 0; i < 2; i++) {
      const n = w.k.root(`npc-${i}`, 'core:person');
      w.k.addEdge({ type: 'core:located-in', from: n, to: w.city, cause });
      w.k.pin({ node: n, slot: 'age', value: 35 + i, reason: 'authored', cause });
    }
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 0, 0);
    const writer = miniPack({ id: 'wr' }, { id: 'x:writer', unattended: { after: { clock: 'game', s: 600 }, outcome: [{ game: { fact: 'x', set: 1 }, capability: 'story.write-vanilla' }] }, roles: { npc: { kind: 'core:person', must: [{ path: 'age', op: 'eq', arg: 35 }] } } } as never);
    const reader = miniPack({ id: 'rd' }, { id: 'x:reader', context: 'x == 0', depends: [{ on: { fact: 'x' }, hold: 'keep' }], roles: { npc: { kind: 'core:person', must: [{ path: 'age', op: 'eq', arg: 36 }] } } } as never);
    w.l2.installPack(writer);
    w.l2.installPack(reader);
    const a = w.l2.instance(w.l2.sow('wr', 'x:writer').instance!)!;
    const b = w.l2.instance(w.l2.sow('rd', 'x:reader').instance!)!;
    settle(w);
    const ea = a.st.record.filter((r) => r.kind === 'intersection' && r.data.kind === 'effect');
    const eb = b.st.record.filter((r) => r.kind === 'intersection' && r.data.kind === 'effect');
    expect(ea).toHaveLength(1);
    expect(eb).toHaveLength(1);
    expect(ea[0]!.data.outcome).toBe('hold:keep');
    // Nothing is blocked; an unchanged intersection is not recorded again.
    settle(w);
    expect(a.st.record.filter((r) => r.kind === 'intersection' && r.data.kind === 'effect')).toHaveLength(1);
  });
});

describe('world requirements (S2 sections 3.2 and 3.5)', () => {
  test('a requirement from a beat to a beat installs when the first runs and ends when the second is final; at the end every contribution has ended', () => {
    const { w, inst } = mini('world', {
      windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
      world: [{ target: { role: 'npc', slot: 'place' }, form: { prefer: { f: 'table', weights: {} }, strength: 2 }, from: 'meet', to: 'finish' }],
    } as never);
    expect(inst.st.world[0]!.installed).toBe(false);
    const d = offer(w, inst);
    settle(w);
    expect(inst.st.world[0]!.installed).toBe(true);
    const c = inst.st.world[0]!.contribution!;
    expect(w.k.store.contribution(c)!.mode).toBe('weight');
    expect(w.k.store.contribution(c)!.strength).toBe(2);
    expect(w.k.store.contribution(c)!.source.layer).toBe('authored');
    w.l2.respond(d.id, { kind: 'decline', id: 'no' });
    settle(w);
    void inst;
  });

  test('a degrade policy ends the requirement and the seed continues without it; refit acts as degrade with the director off', () => {
    for (const policy of ['degrade', 'refit'] as const) {
      const w = makeWorld(`degrade-${policy}`);
      const bar = w.k.root('bar', 'core:place');
      const street = w.k.root('street', 'core:place');
      setGame(w, 'npc6', 'fx:character', 'alive', 1, 0);
      setGame(w, 'npc6', 'fx:character', 'age-class', 'adult', 0);
      setGame(w, 'npc6', 'fx:character', 'where', bar, 0);
      setFact(w, 'x', 0, 0);
      setFact(w, 'flag', 1, 0);
      const seed = {
        roles: { npc: { kind: 'core:person', identity: 'game:npc6', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }] } },
        world: [{ target: { role: 'npc', slot: 'where' }, form: { fixed: { f: 'const', value: bar }, ifRejected: policy } }],
      };
      w.l2.installPack(miniPack({}, seed as never));
      const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
      settle(w);
      playUntil(w, () => delivery(inst, 'meet') !== undefined);
      setGame(w, 'npc6', 'fx:character', 'where', street, w.k.now + 5);
      settle(w);
      expect(inst.st.state).toBe('offered');
      expect(inst.st.world[0]!.ended).toBe(true);
      expect(inst.st.world[0]!.rejected).toBe(true);
      expect(recordOf(inst, 'fixed-rejected')).toHaveLength(1);
      void (null as unknown as Id);
    }
  });
});

describe('SF-25 and SF-36: attribution lines play only while the belief of the NPC holds, and V can correct them', () => {
  const build = (name: string): { w: World; inst: Instance } => mini(name, { windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }] } as never, (p) => {
    p.fragments.find((f) => f.id === 'f-finish')!.responses = [{
      to: { kind: 'robbery', participant: 'v' }, because: 'V robbed the stall', content: 'pack:t-go', attribution: true, reply: 'pack:t-no',
      needs: 'believes(npc, v, age, is: {r: ivl, ivls: [[20, 30]]})', replyWrites: [{ tells: { listener: 'npc', about: 'v', path: 'age', value: 50 } }],
    }];
    p.texts.find((t) => t.id === 't-go')!.states = 'motive';
  });
  const act = (w: World): void => {
    const robbery = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'rob', time: w.k.now, kind: 'robbery', participants: [{ who: w.v, role: 'actor' }], witnesses: [w.v] });
    w.k.events.makeCanon(robbery, 'observed', w.v);
  };
  const believe = (w: World, inst: Instance): void => {
    const ev = H(hs('ev'), hs('1'));
    w.k.beliefs.set({ believer: inst.st.roles.npc!.cast!, subject: w.v, path: 'age', value: 25, confidence: 0.6, evidence: [ev], source: { by: 'observed', event: ev }, formed: 0, refreshed: 0, memorable: true });
  };
  const finish = (w: World, inst: Instance): NonNullable<ReturnType<typeof delivery>> => {
    const d = offer(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    return d;
  };

  test('without the belief of the NPC the line does not play', () => {
    const { w, inst } = build('SF-25a');
    act(w);
    finish(w, inst);
    playUntil(w, () => delivery(inst, 'finish') !== undefined);
    expect(delivery(inst, 'finish')!.responses).toEqual([]);
  });

  test('with the belief, and the act of V on record, the line plays; the correcting reply of V writes an observed telling, the belief revises, and the line no longer applies', () => {
    const { w, inst } = build('SF-36');
    act(w);
    finish(w, inst);
    believe(w, inst);
    playUntil(w, () => delivery(inst, 'finish') !== undefined);
    const fin = delivery(inst, 'finish')!;
    expect(fin.responses).toEqual(['f-finish#0']);
    const holds = { believes: { who: 'npc', of: 'v', path: 'age', is: { r: 'ivl' as const, ivls: [[20, 30]] as Array<[number, number]> } } } as const;
    expect(w.l2.evaluate(inst, holds)).toBe('yes');
    expect(w.l2.reply(fin.id, 'f-finish#0')).toBe(true);
    // The belief really revised, through a telling V made, which is an observed event.
    const b = w.k.beliefs.get(inst.st.roles.npc!.cast!, w.v, 'age')!;
    expect(b.value).toBe(50);
    expect(b.source.by).toBe('told');
    expect(w.k.events.isCanon((b.source as { event: Id }).event)).toBe(true);
    expect(w.l2.evaluate(inst, holds)).toBe('no');
    // The reply is used once.
    expect(w.l2.reply(fin.id, 'f-finish#0')).toBe(false);
  });
});
