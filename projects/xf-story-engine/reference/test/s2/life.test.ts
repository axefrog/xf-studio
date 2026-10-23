// The lifecycle, beats and effects (S2 sections 2.5, 4, 6, 7): SF-2, SF-6, SF-15, SF-16, SF-18 (count form),
// SF-19, SF-20, SF-23, SF-24, SF-60, SF-61, SF-62, SF-63 and the maintenance queue.

import { describe, expect, test } from 'bun:test';
import { H, mintedId, s as hs } from '../../src/id.ts';
import type { Id } from '../../src/types.ts';
import { writeSeedFact } from '../../src/seeding/effects.ts';
import { readSeedFact } from '../../src/seeding/eval.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import type { Pack, SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniFragments, miniPack, miniTexts } from './mini.ts';
import { clock, delivery, firstOffer, play, playUntil, recordOf, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, setGame, settle } from './world.ts';

const cause = H(hs('fx'), hs('life'));

/** The mini seed in a world with its window open (flag = 1), sown, with an adult in the city to cast. */
function mini(name: string, seed: Partial<SeedInput> = {}, mutate?: (p: Pack) => void, opts: Parameters<typeof makeWorld>[1] = {}): { w: World; inst: Instance } {
  const w = makeWorld(name, opts);
  const npc = w.k.root('npc', 'core:person');
  w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
  w.k.pin({ node: npc, slot: 'age', value: 35, reason: 'authored', cause });
  setFact(w, 'x', 0, 0);
  setFact(w, 'flag', 0, 0);
  const pack = miniPack({}, seed);
  mutate?.(pack);
  expect(w.l2.installPack(pack)).toEqual([]);
  const r = w.l2.sow(pack.id, MINI_ID);
  expect(r.ok, JSON.stringify(r.findings)).toBe(true);
  settle(w);
  return { w, inst: w.l2.instance(r.instance!)! };
}

const openIt = (w: World): void => { setFact(w, 'flag', 1, w.k.now + 10); settle(w); };

describe('SF-2: a closing value latches', () => {
  test('readings x = 1 at 10 and x = 0 at 11 arrive in one batch: the window is closed and stays closed; the seed withers once', () => {
    const { w, inst } = mini('SF-2');
    advance(w, 11);
    w.k.reading(w.l2.factNode('x'), 'value', 1, 10);
    w.k.reading(w.l2.factNode('x'), 'value', 0, 11);
    settle(w);
    expect(inst.st.state).toBe('withered');
    expect(inst.st.latches).toEqual(['w']);
    expect(inst.st.record.filter((r) => r.kind === 'transition' && (r.data as { to?: string }).to === 'withered')).toHaveLength(1);
    // The fact reads 0 now, and the window does not reopen.
    expect(w.k.value(w.l2.factNode('x'), 'value')).toBe(0);
    settle(w);
    expect(inst.st.state).toBe('withered');
  });
});

describe('SF-6: a fixed part rejected on a mirrored slot', () => {
  test('the game reads the person elsewhere: the next re-evaluation fails the direct check, and the seed is withdrawn with a fixed-rejected entry', () => {
    const w = makeWorld('SF-6');
    const bar = w.k.root('bar', 'core:place');
    const street = w.k.root('street', 'core:place');
    const npc = setGame(w, 'npc6', 'fx:character', 'alive', 1, 0);
    setGame(w, 'npc6', 'fx:character', 'age-class', 'adult', 0);
    setGame(w, 'npc6', 'fx:character', 'where', bar, 0);
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 1, 0);
    const seed = {
      roles: { npc: { kind: 'core:person', identity: 'game:npc6', must: [{ path: 'age-class', op: 'eq' as const, arg: 'adult' }] } },
      world: [{ target: { role: 'npc', slot: 'where' }, form: { fixed: { f: 'const' as const, value: bar } } }],
    };
    w.l2.installPack(miniPack({}, seed as never));
    const r = w.l2.sow(MINI_PACK, MINI_ID);
    expect(r.ok, JSON.stringify(r.findings)).toBe(true);
    const inst = w.l2.instance(r.instance!)!;
    settle(w);
    playUntil(w, () => delivery(inst, 'meet') !== undefined);
    expect(inst.st.state).toBe('offered');
    expect(inst.st.world[0]!.installed).toBe(true);
    // The game moves the person.
    setGame(w, 'npc6', 'fx:character', 'where', street, w.k.now + 5);
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
    expect(recordOf(inst, 'fixed-rejected')).toHaveLength(1);
    // The kernel reports no contradiction: only layer 2 watches its own fixed parts.
    expect(w.k.resolve(npc, 'where').status).toBe('ok');
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast' && e.valid.to === undefined)).toHaveLength(0);
  });
});

describe('SF-15: missed, not declined', () => {
  test('an offer released but never displayed past the display timeout: no offer event, back to cast, the beat available, attempt + 1', () => {
    const { w, inst } = mini('SF-15');
    openIt(w);
    playUntil(w, () => delivery(inst, 'meet', ['released']) !== undefined);
    const first = delivery(inst, 'meet', ['released'])!;
    expect(inst.st.state).toBe('offered');
    play(w, clock(w) + 601);
    expect(first.state).toBe('expired');
    expect(first.offerEvent).toBeUndefined();
    expect(w.k.store.header(first.id)).toBeUndefined();
    expect(recordOf(inst, 'missed')).toHaveLength(1);
    expect(inst.st.state).not.toBe('unattended');
    expect(inst.st.beats.meet!.attempt).toBe(1);
    // It is pushed again (a new release, with the next offer Id), within the total attempt bound.
    playUntil(w, () => delivery(inst, 'meet', ['released']) !== undefined);
    const again = delivery(inst, 'meet', ['released'])!;
    expect(again.id).toBe(mintedId(inst.id, inst.id, 'offer:meet:1'));
    expect(again.attempts).toBe(2);
  });
});

describe('SF-62: the total attempt bound', () => {
  test('an offer that keeps going unseen across channels and two reloads is pushed at most maxAttempts times, and then waits for pull', () => {
    const { w } = mini('SF-62', {}, (p) => { p.fragments.find((f) => f.id === 'f-meet')!.channels = ['toast', 'pin']; });
    openIt(w);
    const inst = (): Instance => w.l2.ofTemplate(MINI_ID)[0]!;
    const pushes = (): number => inst().st.record.filter((r) => r.kind === 'release' && (r.data as { what?: string }).what === 'offer').length;
    playUntil(w, () => delivery(inst(), 'meet', ['released']) !== undefined);
    // The toast earns only the ambient grade and ends: released once more, on a different channel.
    const d1 = delivery(inst(), 'meet', ['released'])!;
    expect(d1.provenance.channel).toBe('toast');
    show(w, d1, 'ambient', 'toast', { final: true });
    playUntil(w, () => pushes() === 2);
    expect(delivery(inst(), 'meet', ['released'])!.provenance.channel).toBe('pin');
    // A reload; the pin is never seen either and times out.
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    play(w, clock(w) + 2000);
    // And another reload.
    w.k.persistence.save('b');
    w.k.persistence.load('b', w.gamePort);
    settle(w);
    play(w, clock(w) + 4000);
    expect(pushes()).toBeLessThanOrEqual(3);
    const last = inst().st.deliveries.filter((d) => d.what === 'offer').pop()!;
    expect(last.state === 'queued' && last.stopped === true).toBe(true);
    // It stays available by pull, and only a pull pushes it again.
    expect(w.l2.pull(last.id)).toBe(true);
    playUntil(w, () => pushes() === 4, 600);
    expect(pushes()).toBe(4);
  });
});

describe('SF-16: a promise', () => {
  test('a seed whose end is yes while a promise is open stays running until paidBy is yes, then resolves', () => {
    const { w, inst } = mini('SF-16', { promises: [{ id: 'p', opens: 'meet', paidBy: 'seedFact(stage) == 3' }], end: 'beat(meet) in {done}' });
    openIt(w);
    const d = firstOfferOf(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w);
    expect(inst.st.promises.p).toBe('open');
    expect(inst.st.state).toBe('running');
    // `end` is yes, but the promise is open: the seed does not succeed.
    expect(w.l2.evaluate(inst, inst.st.document.end)).toBe('yes');
    play(w, clock(w) + 200);
    expect(inst.st.state).toBe('running');
    // The finishing beat pays it.
    playUntil(w, () => delivery(inst, 'finish') !== undefined);
    const fin = delivery(inst, 'finish')!;
    show(w, fin, 'presented');
    w.l2.contentCompleted(fin.id);
    settle(w);
    expect(inst.st.promises.p).toBe('paid');
    expect(inst.st.state).toBe('resolved');
    expect(recordOf(inst, 'closure')[0]!.status).toBe('resolved');
  });
  test('a promise marked mayStayOpen does not hold the seed back', () => {
    const { w, inst } = mini('SF-16b', { promises: [{ id: 'p', opens: 'meet', paidBy: 'no', mayStayOpen: true }], end: 'beat(meet) in {done}' });
    openIt(w);
    const d = firstOfferOf(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    expect(inst.st.state).toBe('resolved');
  });
});

function firstOfferOf(w: World, inst: Instance): NonNullable<ReturnType<typeof delivery>> {
  playUntil(w, () => delivery(inst, 'meet') !== undefined);
  const d = delivery(inst, 'meet')!;
  if (d.state === 'released') show(w, d, 'confirmed');
  return d;
}

describe('SF-19, SF-20 and SF-63: seed facts', () => {
  const resettableSeed = { facts: { stage: { route: { consumers: ['finish'] }, initial: 0 }, mood: { initial: 0 } } };

  test('SF-20: write stage = 1, then stage = 2: it reads 2, with exactly one current pin; the first is withdrawn and kept as history', () => {
    const { w, inst } = mini('SF-20');
    writeSeedFact(w.l2, inst, 'stage', 1, 'lasting');
    const first = inst.st.facts.stage!.pin!;
    writeSeedFact(w.l2, inst, 'stage', 2, 'lasting');
    expect(readSeedFact(w.l2, inst, 'stage')).toBe(2);
    expect(w.k.value(H(hs('mint'), hs('x')) as Id, 'value')).toBeUndefined();
    const node = mintedId(inst.id, inst.id, 'fact:stage');
    expect(w.k.value(node, 'value')).toBe(2);
    expect(w.k.store.livePinsOn(node, 'value')).toHaveLength(1);
    expect(w.k.store.isWithdrawn(first)).toBe(true);
    expect(w.k.store.pin(first)!.value).toBe(1);
    // A rewrite of an earlier value is a new pin, not the withdrawn one.
    writeSeedFact(w.l2, inst, 'stage', 1, 'lasting');
    expect(readSeedFact(w.l2, inst, 'stage')).toBe(1);
    expect(w.k.store.livePinsOn(node, 'value')).toHaveLength(1);
  });

  test('SF-19: a resettable write at game time t with reset 7 days: at t + 7 days the pin is withdrawn and the fact reads its initial', () => {
    const { w, inst } = mini('SF-19', resettableSeed);
    writeSeedFact(w.l2, inst, 'mood', 5, 'resettable');
    const at = w.k.now;
    const pin = inst.st.facts.mood!.pin!;
    expect(readSeedFact(w.l2, inst, 'mood')).toBe(5);
    advance(w, at + 6 * 86_400);
    settle(w);
    expect(readSeedFact(w.l2, inst, 'mood')).toBe(5);
    advance(w, at + 7 * 86_400 + 600);
    settle(w);
    expect(w.k.store.isWithdrawn(pin)).toBe(true);
    expect(readSeedFact(w.l2, inst, 'mood')).toBe(0);
    expect(w.l2.global.maintenance.filter((j) => j.kind === 'reset')).toHaveLength(0);
  });

  test('the player\'s reset scale multiplies the reset', () => {
    const { w, inst } = mini('SF-19b', resettableSeed);
    w.k.settings.set({ resetScale: 2 });
    writeSeedFact(w.l2, inst, 'mood', 5, 'resettable');
    const at = w.k.now;
    advance(w, at + 8 * 86_400);
    settle(w);
    expect(readSeedFact(w.l2, inst, 'mood')).toBe(5);
    advance(w, at + 14 * 86_400 + 600);
    settle(w);
    expect(readSeedFact(w.l2, inst, 'mood')).toBe(0);
  });

  test('SF-63: a seed writes a resettable fact and resolves the same day; the maintenance queue still withdraws the pin at the reset time, across a load', () => {
    const { w, inst } = mini('SF-63', { ...resettableSeed, end: 'seedFact(mood) == 5' });
    openIt(w);
    writeSeedFact(w.l2, inst, 'mood', 5, 'resettable');
    const at = w.k.now;
    const pin = inst.st.facts.mood!.pin!;
    // Make it running so that T12 can resolve it.
    const d = firstOfferOf(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(w.l2.global.maintenance.some((j) => j.kind === 'reset')).toBe(true);
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    advance(w, at + 7 * 86_400 + 600);
    settle(w);
    expect(w.k.store.isWithdrawn(pin)).toBe(true);
    expect(w.l2.global.maintenance.filter((j) => j.kind === 'reset')).toHaveLength(0);
  });
});

describe('SF-23 and SF-61: a failed release leaks nothing', () => {
  const hero = (w: World): Id => {
    const n = setGame(w, 'hero', 'fx:character', 'alive', 1, 0);
    setGame(w, 'hero', 'fx:character', 'age-class', 'adult', 0);
    return n;
  };
  const seedOf = (extra: Partial<SeedInput> = {}): Partial<SeedInput> => ({
    roles: { npc: { kind: 'core:person', identity: 'game:hero', must: [{ path: 'alive', op: 'eq', arg: 1 }, { path: 'age-class', op: 'eq', arg: 'adult' }] } },
    ...extra,
  } as never);

  test('SF-23: the tentative cast is killed while its delivery is queued: preparation fails, nothing reaches V, no cast edge is in effect, the role\'s ladder runs', () => {
    const w = makeWorld('SF-23');
    hero(w);
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 1, 0);
    w.l2.installPack(miniPack({}, seedOf()));
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    expect(inst.st.state).toBe('cast');
    const queued = delivery(inst, 'meet', ['queued'])!;
    expect(queued).toBeDefined();
    // The game kills the person; no re-evaluation has run when the arbiter steps.
    advance(w, w.k.now + 5);
    w.k.reading(w.k.mirrored('hero', 'fx:character'), 'alive', 0, w.k.now);
    w.l2.advancePlay(clock(w) + 1);
    expect(queued.state).toBe('queued');
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast')).toHaveLength(0);
    expect(inst.st.roles.npc!.committed).toBe(false);
    expect(recordOf(inst, 'lost')).toHaveLength(1);
    expect(inst.st.record.some((r) => r.kind === 'release')).toBe(false);
    expect(w.k.pending.filter((p) => p.change.c === 'edge')).toHaveLength(0);
    // The ladder runs: wait, then withdraw (the default for an anchor-less role is its ladder's last step).
    settle(w);
    expect(['waiting', 'withdrawn']).toContain(inst.st.state as string);
    expect(inst.st.roles.npc!.cast).toBeUndefined();
  });

  test('SF-61: a fixed part rejected inside the staged batch: no belief, edge, frame, contribution or dilemma ever takes effect or is dispatched', () => {
    const w = makeWorld('SF-61');
    const bar = w.k.root('bar', 'core:place');
    const street = w.k.root('street', 'core:place');
    const hero1 = hero(w);
    setGame(w, 'hero', 'fx:character', 'where', street, 0);
    setFact(w, 'x', 0, 0);
    setFact(w, 'flag', 1, 0);
    const x = w.k.root('x-person', 'core:person');
    w.k.frames.open({ actor: hero1, level: 'concern', origin: H(hs('fam')), weight: 1, cause, own: { protects: [{ slot: '*', scope: { nodes: [x] } }] } });
    const seed = seedOf({
      roles: {
        npc: {
          kind: 'core:person', identity: 'game:hero', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }],
          goal: { effects: [{ on: x, effect: 'kill' }] }, authored: [{ belief: { about: 'v', path: 'age', value: 30, reason: 'seed' } }],
        },
      },
      world: [{ target: { role: 'npc', slot: 'where' }, form: { fixed: { f: 'const', value: bar } } }],
    } as never);
    w.l2.installPack(miniPack({}, seed));
    const inst = w.l2.instance(w.l2.sow(MINI_PACK, MINI_ID).instance!)!;
    settle(w);
    const rev = w.k.revision;
    const frames = w.k.frames.all().length;
    const edges = w.k.store.allEdges().length;
    const beliefs = w.k.beliefs.entries().length;
    const contributions = w.k.store.allContributions().length;
    w.k.frames.drainDilemmas();
    w.l2.advancePlay(clock(w) + 1);
    settle(w);
    // The release was prepared in a batch and discarded; the world is as it was (S2-I-3, SF-61).
    expect(inst.st.record.filter((r) => r.kind === 'prepare-failed').length).toBeGreaterThan(0);
    expect(inst.st.state).toBe('withdrawn');
    expect(w.k.frames.all().filter((f) => f.actor === hero1 && f.level === 'goal')).toHaveLength(0);
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast')).toHaveLength(0);
    expect(w.k.beliefs.entries()).toHaveLength(beliefs);
    expect(w.k.store.allContributions().length).toBe(contributions);
    expect(w.k.frames.drainDilemmas()).toHaveLength(0);
    expect(w.k.frames.all().length).toBeLessThanOrEqual(frames);
    expect(w.k.store.allEdges().length).toBe(edges);
    void rev;
  });
});

describe('SF-24: a stuck seed', () => {
  test('a running seed whose only remaining beat links because a failed beat, on a seed fact nothing writes: stuck, withered, with a stuck entry', () => {
    const { w, inst } = mini('SF-24', {
      facts: { stage: { route: { consumers: ['end'] }, initial: 0 }, never: { initial: 0 } },
      beats: {
        meet: { play: 'pack:f-meet' },
        meet2: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(never) == 1' }] },
      },
      end: 'beat(meet2) in {done} or seedFact(stage) == 99',
    } as never, (p) => { p.fragments.find((f) => f.id === 'f-meet')!.offer!.actions[0]!.writes = [{ fact: 'stage', set: 1 }]; });
    openIt(w);
    const d = firstOfferOf(w, inst);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    expect(inst.st.state).toBe('withered');
    expect(recordOf(inst, 'stuck')).toHaveLength(1);
    expect(recordOf(inst, 'closure')[0]!.status).toBe('abandoned');
  });
});

describe('SF-60: branch safety', () => {
  const seed: Partial<SeedInput> = {
    facts: { stage: { route: { consumers: ['end'] }, initial: 0 } },
    beats: {
      meet: { play: 'pack:f-meet' },
      acc: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'response(meet) is {action}' }], leaves: [{ fact: 'stage', set: 3 }] },
      heavy: { play: 'pack:f-heavy', droppable: true, links: [{ because: 'meet', on: 'yes' }], leaves: [{ fact: 'stage', set: 4 }] },
      acc2: { play: 'pack:f-finish', links: [{ because: 'heavy', on: 'response(meet) is {action}' }], leaves: [{ fact: 'stage', set: 5 }] },
    },
    end: 'beat(acc) in {done} or seedFact(stage) == 99',
  } as never;
  const withHeavy = (p: Pack): void => {
    p.fragments.push({ id: 'f-heavy', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: ['message'], content: [{ class: 'violence.gore', intensity: 3 }] });
    p.seeds[0]!.content = { envelope: { 'violence.gore': 3 } } as never;
    p.fragments.find((f) => f.id === 'f-meet')!.offer!.actions[0]!.writes = [{ fact: 'stage', set: 1 }];
    p.fragments.find((f) => f.id === 'f-meet')!.offer!.actions[1]!.writes = [{ fact: 'stage', set: 2 }];
  };

  test('an acceptance-only successor is never reachable after a decline; an omitted beat\'s link still evaluates its condition', () => {
    const { w, inst } = mini('SF-60', seed, withHeavy);
    // The player's ceiling for violence is 0: the droppable heavy beat is omitted, never played.
    w.k.settings.set({ content: { ceiling: { 'violence.gore': 0 } } });
    openIt(w);
    const d = firstOfferOf(w, inst);
    expect(w.l2.respond(d.id, { kind: 'decline', id: 'no' })).toBe(true);
    settle(w);
    expect(inst.st.beats.acc!.state).toBe('skipped');
    expect(inst.st.beats.acc!.skip).toBe('rejected');
    expect(inst.st.beats.heavy!.state).toBe('skipped');
    expect(inst.st.beats.heavy!.skip).toBe('omitted');
    // The omitted beat is transparent, yet the successor's own condition (acceptance) still decides: it is never reachable.
    expect(inst.st.beats.acc2!.state).toBe('skipped');
    expect(inst.st.beats.acc2!.skip).toBe('rejected');
  });

  test('after missing content the seed does not stall: the delivery is skipped with a neutral entry', () => {
    const { w, inst } = mini('SF-60b', { facts: { stage: { route: { consumers: ['finish'] }, initial: 0 } } });
    openIt(w);
    // The pack is updated under the live instance: the text of the finishing beat no longer exists.
    const d = firstOfferOf(w, inst);
    const edited = miniPack();
    edited.texts = miniTexts().filter((t) => t.id !== 't-finish');
    w.l2.installPack(edited);
    w.l2.respond(d.id, { kind: 'action', id: 'go' });
    settle(w);
    playUntil(w, () => inst.st.record.some((r) => r.kind === 'expired' && (r.data as { why?: string }).why === 'missing-content'));
    expect(inst.st.beats.finish!.state).toBe('skipped');
    expect(inst.st.state).not.toBe('stuck');
    void miniFragments;
  });
});

describe('SF-18 (count form): consumed events are committed and counted once, across a load', () => {
  test('three canon events matching a count pattern: the value is 3 before the save and after the load, then 4; each matched field is pinned committed', () => {
    const seed = {
      beats: {
        meet: { play: 'pack:f-meet' },
        finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1 and count({kind: collector-visit}) >= 3' }], leaves: [{ fact: 'stage', set: 3 }] },
      },
    };
    const { w, inst: i0 } = mini('SF-18', seed as never);
    const visit = (n: number): Id => {
      const ev = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: `visit-${n}`, time: w.k.now, kind: 'collector-visit', participants: [{ who: w.v, role: 'participant' }], witnesses: [w.v] });
      w.k.events.makeCanon(ev, 'observed', w.v);
      settle(w);
      return ev;
    };
    const evs = [visit(0), visit(1), visit(2)];
    const count = (inst: Instance): number => inst.st.consumed.filter((c) => c.sub.length > 0).length;
    expect(count(i0)).toBe(3);
    for (const e of evs) expect(w.k.store.livePinsOn(e, 'kind').some((p) => p.reason === 'committed' && p.cause === i0.id)).toBe(true);
    w.k.persistence.save('a');
    w.k.persistence.load('a', w.gamePort);
    settle(w);
    const i1 = w.l2.instance(i0.id)!;
    expect(count(i1)).toBe(3);
    visit(3);
    expect(count(w.l2.instance(i0.id)!)).toBe(4);
    // Each event is consumed once however often it is seen again.
    settle(w);
    expect(count(w.l2.instance(i0.id)!)).toBe(4);
  });
});
