// Regression tests for the findings of the second independent review (R2-01 to R2-09, fix round 1) and the test gaps it named.

import { describe, expect, test } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import type { Instance } from '../../src/seeding/layer2.ts';
import type { Finding, Pack, Pred, SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, miniPack } from './mini.ts';
import { r1Pack } from './r1.ts';
import { clock, delivery, play, playUntil, recordOf, show } from './drive.ts';
import { type World, advance, makeWorld, setFact, settle } from './world.ts';

const cause = H(hs('fx'), hs('round2'));

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
const direct = (id: string): Pack['fragments'][number] => ({ id, level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: [] });

describe('R2-01: a batch that ran out of its allowance releases nothing', () => {
  test('twenty compatible commit requirements and a conflicting one, under a small allowance: the offer is not released and nothing is committed', () => {
    const fits = { target: { role: 'npc', slot: 'age' }, form: { fixed: { f: 'set', region: { r: 'ivl', ivls: [[30, 40]] }, allow: true } } };
    const conflicts = { target: { role: 'npc', slot: 'age' }, form: { fixed: { f: 'set', region: { r: 'ivl', ivls: [[36, 36]] }, allow: true } } };
    let released = 0;
    const { w, inst } = mini('r2-01', { world: [...Array.from({ length: 20 }, () => fits), conflicts] } as never, undefined, {
      config: { allowance: 12 }, l2: { hooks: { onRelease: () => { released++; } } },
    });
    openIt(w);
    play(w, clock(w) + 120);
    expect(released).toBe(0);
    expect(inst.st.deliveries.filter((d) => d.state === 'released' || d.state === 'displayed')).toHaveLength(0);
    expect(inst.st.committed).toBe(false);
    expect(w.k.store.allEdges().filter((e) => e.type === 'core:cast')).toHaveLength(0);
    expect(recordOf(inst, 'prepare-failed').some((r) => /allowance/.test(String(r.why)))).toBe(true);
  });
});

describe('R2-02: a load restarts a running play-clock duration and leaves a passed one passed', () => {
  test('two durations on one stamp, one passed and one running, across a save and a load', () => {
    // The seed reads both durations (as turns), which is what makes a load restart them.
    const { w, inst } = mini('r2-02', { turns: [{ level: 'step', what: 'since(state sown) >= 60p' }, { level: 'step', what: 'since(state sown) >= 120p' }] } as never);
    play(w, clock(w) + 80);
    const sown = (s: number): Pred => ({ since: { state: 'sown' }, atLeast: { clock: 'play', s } }) as Pred;
    expect(w.l2.evaluate(inst, sown(60))).toBe('yes');
    expect(w.l2.evaluate(inst, sown(120))).toBe('no');
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!;
    expect(w.l2.evaluate(after, sown(60))).toBe('yes');
    expect(w.l2.evaluate(after, sown(120))).toBe('no');
    // The running one starts again from the load: 120 more play seconds, not 40.
    play(w, clock(w) + 100);
    expect(w.l2.evaluate(after, sown(120))).toBe('no');
    play(w, clock(w) + 25);
    expect(w.l2.evaluate(after, sown(120))).toBe('yes');
    expect(w.l2.evaluate(after, sown(60))).toBe('yes');
  });
});

describe('R2-03: exposure to a canon event wakes the sowing watcher', () => {
  test('a template that sows on confirmed exposure to a shared activity is sown when the event is made, with no reload', () => {
    const w = makeWorld('r2-03');
    const npc = w.k.root('npc', 'core:person');
    w.k.addEdge({ type: 'core:located-in', from: npc, to: w.city, cause });
    const sow = { exposed: { event: { kind: 'shared-activity', participant: 'v' } } } as never;
    expect(w.l2.installPack(miniPack({}, { sow }))).toEqual([]);
    settle(w);
    expect(w.l2.ofTemplate(MINI_ID)).toHaveLength(0);
    const ev = w.k.events.mintEvent({ creator: w.v, cause: w.v, name: 'walk', time: w.k.now, kind: 'shared-activity', participants: [{ who: w.v, role: 'actor' }, { who: npc, role: 'participant' }], witnesses: [w.v] });
    w.k.events.makeCanon(ev, 'observed', w.v);
    settle(w);
    expect(w.l2.ofTemplate(MINI_ID)).toHaveLength(1);
  });
});

describe('R2-04: witnessing follows the beat that completed last, not equal stamps', () => {
  test('V answers an offer and a channel-free successor completes at once and ends the seed: the ending was not shown', () => {
    const { w, inst } = mini('r2-04', {
      facts: { stage: { route: { consumers: ['quiet'] }, initial: 0 } },
      beats: { meet: { play: 'pack:f-meet' }, quiet: { play: 'pack:f-quiet', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }] } },
      end: 'beat(quiet) in {done}',
    } as never, (p) => { p.fragments.push(direct('f-quiet')); });
    openIt(w);
    const d = offer(w, inst);
    expect(w.l2.respond(d.id, { kind: 'action', id: 'go' })).toBe(true);
    settle(w);
    expect(inst.st.state).toBe('resolved');
    expect(inst.st.beats.meet!.finalAt).toBe(inst.st.beats.quiet!.finalAt);
    expect(inst.st.receipts.some((r) => r.beat === 'meet')).toBe(true);
    const closure = recordOf(inst, 'closure')[0]!;
    expect(closure.witnessed).toBe(false);
    expect(inst.st.deliveries.some((x) => x.what === 'news')).toBe(true);
  });
});

describe('R2-08: a role can name a stand-in that commits later in the order', () => {
  test('an authored belief of the anchored role about a pending stand-in is installed', () => {
    const { w, inst } = mini('r2-08', {
      roles: {
        npc: { kind: 'core:person', anchor: true, must: [{ path: 'age-class', op: 'eq', arg: 'adult' }], onUnfilled: ['wait', 'withdraw'], authored: [{ belief: { about: 'guest', path: 'age', value: 41, reason: 'knows the guest' } }] },
        guest: { kind: 'core:person', must: [{ path: 'age', op: 'range', arg: [40, 45] }], onUnfilled: ['standIn'] },
      },
    } as never);
    openIt(w);
    offer(w, inst);
    const guest = inst.st.roles.guest!.cast!;
    const npc = inst.st.roles.npc!.cast!;
    expect(inst.st.roles.guest!.committed).toBe(true);
    expect(w.k.beliefs.entries().some((e) => e.belief.believer === npc && e.belief.subject === guest && e.belief.path === 'age')).toBe(true);
  });

  test('a commit-time requirement of a stand-in is watched: a higher layer overriding it withdraws the seed', () => {
    const { w, inst } = mini('r2-08-reject', {
      roles: {
        npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }], onUnfilled: ['wait', 'withdraw'] },
        guest: { kind: 'core:person', must: [{ path: 'age', op: 'range', arg: [40, 45] }], onUnfilled: ['standIn'] },
      },
      world: [{ target: { role: 'guest', slot: 'age' }, form: { fixed: { f: 'set', region: { r: 'ivl', ivls: [[41, 43]] }, allow: true } } }],
    } as never);
    openIt(w);
    offer(w, inst);
    const guest = inst.st.roles.guest!.cast!;
    expect(inst.st.state).not.toBe('withdrawn');
    w.k.pin({ node: guest, slot: 'age', value: 44, reason: 'observed', cause });
    settle(w);
    expect(inst.st.state).toBe('withdrawn');
    expect(recordOf(inst, 'fixed-rejected')).toHaveLength(1);
  });
});

describe('R2-09: a game-clock lapse runs on game time', () => {
  const gameLapse = (p: Pack): void => { p.fragments.find((f) => f.id === 'f-meet')!.offer!.lapse = { after: { clock: 'game', s: 600 }, then: 'unattended' }; };

  test('play time alone does not lapse it; game time alone does, at a window boundary', () => {
    const { w, inst } = mini('r2-09', {}, gameLapse);
    openIt(w);
    const d = offer(w, inst);
    play(w, clock(w) + 700);
    expect(d.state).toBe('displayed');
    expect(d.lapseAt).toBeUndefined();
    expect(d.lapseGameAt).toBeDefined();
    expect(inst.st.wakeups.some((x) => x.clock === 'game' && x.reason === 'lapse')).toBe(true);
    advance(w, d.lapseGameAt! - 1);
    settle(w);
    expect(d.state).toBe('displayed');
    advance(w, w.k.now + 1800);
    settle(w);
    expect(d.state).toBe('expired');
    expect(recordOf(inst, 'transition').map((t) => t.row)).toContain('T10');
  });

  test('a load does not restart it', () => {
    const { w, inst } = mini('r2-09-load', {}, gameLapse);
    openIt(w);
    const d = offer(w, inst);
    const at = d.lapseGameAt!;
    w.k.persistence.save('A');
    w.k.persistence.load('A', w.gamePort);
    settle(w);
    const after = w.l2.instance(inst.id)!.st.deliveries.find((x) => x.id === d.id)!;
    expect(after.lapseGameAt).toBe(at);
    expect(after.lapseAt).toBeUndefined();
    advance(w, at + 700);
    settle(w);
    expect(after.state).toBe('expired');
  });
});

describe('the named test gaps', () => {
  test('an ordinary push over its attempt bound is stopped (the comparison for the in-scene exemption)', () => {
    const { w, inst } = mini('gap-bound');
    w.port.busy = true;
    openIt(w);
    const d = inst.st.deliveries.find((x) => x.beat === 'meet')!;
    expect(d.state).toBe('queued');
    d.attempts = w.l2.tun.maxAttempts + 1;
    play(w, clock(w) + 3);
    expect(d.stopped).toBe(true);
  });

  test('a variant draw keeps the raw and clamped fit weights too', () => {
    const { inst } = mini('gap-variant', { variation: { variants: [{ id: 'v1', weight: 1, parts: {} }] } } as never, undefined, { l2: { hooks: { fit: () => -99 } } });
    expect(inst.st.draws.variant!.value).toBe('v1');
    expect(inst.st.draws.variant!.raw).toBe(-99);
    expect(inst.st.draws.variant!.clamped).toBeLessThan(0);
  });
});

describe('lint: the R2 scenarios', () => {
  let n = 0;
  const lintOf = (mutate: (p: Pack, s: SeedInput) => void, base: () => Pack = miniPack): Finding[] => {
    const pack = base();
    const w = makeWorld(`lint-r2-${n++}`);
    mutate(pack, pack.seeds[0] as unknown as SeedInput);
    const pf = w.l2.installPack(pack);
    if (pf.some((f) => f.level === 'error')) return pf;
    return [...pf, ...w.l2.compile(pack.id, pack.seeds[0]!).findings];
  };
  const errs = (fs: Finding[]): string[] => fs.filter((f) => f.level === 'error').map((f) => f.code);

  test('R2-05: a grouped response test does not tell identical actions apart', () => {
    const both = lintOf((p, s) => {
      p.fragments.find((f) => f.id === 'f-meet')!.offer!.actions.forEach((a) => { a.writes = [{ fact: 'stage', set: 1 }]; });
      s.beats!.finish!.links = [{ because: 'meet', on: { all: [{ seedFact: 'stage', op: 'ge', value: 1 }, { response: 'meet', is: ['action:go', 'action:skip'] }] } as Pred }];
    });
    expect(errs(both)).toContain('L-06');
    const apart = lintOf((p, s) => {
      p.fragments.find((f) => f.id === 'f-meet')!.offer!.actions.forEach((a) => { a.writes = [{ fact: 'stage', set: 1 }]; });
      s.beats!.finish!.links = [{ because: 'meet', on: { all: [{ seedFact: 'stage', op: 'ge', value: 1 }, { response: 'meet', is: ['action:go'] }] } as Pred }];
    });
    expect(errs(apart)).not.toContain('L-06');
  });

  test('R2-06: the lapse gate cannot be bypassed by an alternative or a negation', () => {
    const original = 'since(beat offer-1) >= 1209600g and count({kind: shared-activity, participant: takemura}, beat offer-1) == 0';
    expect(errs(lintOf((p) => { p.fragments.find((f) => f.id === 'qh-exit-lapse')!.needs = original; }, r1Pack))).toEqual([]);
    expect(errs(lintOf((p) => { p.fragments.find((f) => f.id === 'qh-exit-lapse')!.needs = `yes or (${original})`; }, r1Pack))).toContain('L-10');
    expect(errs(lintOf((p) => { p.fragments.find((f) => f.id === 'qh-exit-lapse')!.needs = `not (not (${original}))`; }, r1Pack))).toContain('L-10');
  });

  test('R2-07: a predicate in a fragment an unchosen variant plays is refused too', () => {
    const fs = lintOf((p, s) => {
      p.fragments.push({ ...direct('f-city'), needs: 'city({band: {cell: x}}) in {hot}' } as never);
      s.variation = { variants: [{ id: 'v1', weight: 1, parts: { beats: { ...s.beats, finish: { play: 'pack:f-city', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] } } } as never }] };
    });
    expect(fs.filter((f) => f.level === 'error').some((f) => /not supported yet/.test(f.message))).toBe(true);
  });
});
