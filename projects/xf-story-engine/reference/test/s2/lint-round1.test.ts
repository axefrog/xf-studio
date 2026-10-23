// Fix round 1 on the lint: L-06 (S2 section 2.9), L-99 under negation and alternatives (L2-02), the scene labels of L-131a,
// the lapse contract of the ladder (L2-10) and the check of later capabilities across the whole closure (L2-15).

import { describe, expect, test } from 'bun:test';
import type { Finding, Fragment, Pack, Pred, SeedInput } from '../../src/seeding/types.ts';
import { miniPack } from './mini.ts';
import { r1Pack } from './r1.ts';
import { makeWorld } from './world.ts';

type Mutate = (pack: Pack, seed: SeedInput) => void;
let counter = 0;

function lintOf(mutate: Mutate, base: () => Pack = miniPack): Finding[] {
  const pack = base();
  const seed = pack.seeds[0] as unknown as SeedInput;
  const w = makeWorld(`lint-r1-${counter++}`);
  mutate(pack, seed);
  const pf = w.l2.installPack(pack);
  if (pf.some((f) => f.level === 'error')) return pf;
  const res = w.l2.compile(pack.id, pack.seeds[0]!);
  return [...pf, ...res.findings];
}
const codes = (fs: Finding[], level?: 'error' | 'warning'): string[] => fs.filter((f) => !level || f.level === level).map((f) => f.code);
const frag = (pack: Pack, id: string): Fragment => pack.fragments.find((f) => f.id === id)!;
const act = (id: string): Pred => ({ response: 'meet', is: [`action:${id}`] }) as Pred;

describe('L-06: every action has a consequence something reads, and no two have the same one', () => {
  test('an action whose only write nothing reads, and no link reads its response, changes nothing anyone sees', () => {
    const noConsequence = lintOf((p, s) => {
      s.facts!.unread = { initial: 0 };
      frag(p, 'f-meet').offer!.actions[1]!.writes = [{ fact: 'unread', set: 1 }];
    });
    expect(codes(noConsequence, 'error')).toContain('L-06');
    expect(noConsequence.find((f) => f.code === 'L-06')!.message).toContain('"skip"');
    // The same action with a link that reads its response has a consequence.
    const withLink = lintOf((p, s) => {
      s.beats!.thanks = { play: 'pack:f-finish', links: [{ because: 'meet', on: act('skip') }], leaves: [{ fact: 'stage', set: 3 }] };
      frag(p, 'f-meet').offer!.actions[1]!.writes = undefined;
    });
    expect(codes(withLink, 'error')).not.toContain('L-06');
  });

  test('two actions that write the same thing are told apart only by a link that names one of them', () => {
    const same = lintOf((p) => { frag(p, 'f-meet').offer!.actions[1]!.writes = [{ fact: 'stage', set: 1 }]; });
    expect(codes(same, 'error')).toContain('L-06');
    const apart = lintOf((p, s) => {
      frag(p, 'f-meet').offer!.actions[1]!.writes = [{ fact: 'stage', set: 1 }];
      s.beats!.thanks = { play: 'pack:f-finish', links: [{ because: 'meet', on: act('skip') }], leaves: [{ fact: 'stage', set: 3 }] };
    });
    expect(codes(apart, 'error')).not.toContain('L-06');
    // Reading every action at once ("action:*") tells nothing apart.
    const all = lintOf((p, s) => {
      frag(p, 'f-meet').offer!.actions[1]!.writes = undefined;
      frag(p, 'f-meet').offer!.actions[0]!.writes = undefined;
      s.beats!.thanks = { play: 'pack:f-finish', links: [{ because: 'meet', on: { response: 'meet', is: ['action:*'] } as Pred }], leaves: [{ fact: 'stage', set: 3 }] };
    });
    expect(codes(all, 'error')).toContain('L-06');
  });

  test('a shared write is a side effect: actions that differ in another write still differ', () => {
    const fs = lintOf((p, s) => {
      s.facts!.mood = { route: { consumers: ['finish'] }, initial: 0 };
      s.beats!.finish!.links = [{ because: 'meet', on: { all: [{ seedFact: 'stage', op: 'ge', value: 1 }, { seedFact: 'mood', op: 'ge', value: 0 }] } as Pred }];
      frag(p, 'f-meet').offer!.actions[0]!.writes = [{ fact: 'stage', set: 1 }, { fact: 'mood', set: 1 }];
      frag(p, 'f-meet').offer!.actions[1]!.writes = [{ fact: 'stage', set: 1 }, { fact: 'mood', set: 2 }];
    });
    expect(codes(fs, 'error')).not.toContain('L-06');
  });
});

describe('L2-02, L-99: every enabling path implies the accepted action', () => {
  const link = (on: Pred, s: SeedInput): void => {
    s.beats = { ...s.beats, finish: { play: 'pack:f-finish', links: [{ because: 'meet', on }] } };
  };
  const explicit = (on: Pred, extra?: Mutate): Finding[] => lintOf((p, s) => {
    p.fragments.push({ id: 'f-fade', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: ['message'], leaves: [{ fact: 'stage', set: 3 }] });
    const f = frag(p, 'f-finish');
    f.content = [{ class: 'sex.explicit', intensity: 1 }];
    f.authored = 'human';
    f.implied = 'pack:f-fade';
    f.leaves = [{ fact: 'stage', set: 3 }];
    p.texts.find((t) => t.id === 't-finish')!.authored = 'human';
    (p.texts.find((t) => t.id === 't-finish') as { author?: string }).author = 'Someone';
    s.content = { envelope: { 'sex.explicit': 1 } };
    link(on, s);
    extra?.(p, s);
  });
  const unreachable = (fs: Finding[]): boolean => fs.some((f) => f.code === 'L-99' && /accepted/.test(f.message));

  test('a test only the accept action can make true passes', () => {
    expect(unreachable(explicit({ seedFact: 'stage', op: 'eq', value: 1 } as Pred))).toBe(false);
    expect(unreachable(explicit(act('go')))).toBe(false);
    expect(unreachable(explicit({ all: [act('go'), { seedFact: 'stage', op: 'ge', value: 0 }] } as Pred))).toBe(false);
  });
  test('a negated response does not, alone or beside a test the initial value satisfies (the review\'s scenario)', () => {
    expect(unreachable(explicit({ not: act('go') } as Pred))).toBe(true);
    expect(unreachable(explicit({ all: [{ not: act('go') }, { seedFact: 'stage', op: 'ge', value: 0 }] } as Pred))).toBe(true);
  });
  test('an alternative does not unless every branch implies it', () => {
    expect(unreachable(explicit({ any: [act('go'), { response: 'meet', is: ['decline:no'] }] } as Pred))).toBe(true);
    expect(unreachable(explicit({ any: [act('go'), act('skip')] } as Pred))).toBe(false);
  });
  test('a test the initial value already satisfies, a bare test, or no test does not', () => {
    expect(unreachable(explicit({ seedFact: 'stage', op: 'ge', value: 0 } as Pred))).toBe(true);
    expect(unreachable(explicit({ seedFact: 'stage', op: 'ne', value: 5 } as Pred))).toBe(true);
    expect(unreachable(explicit('yes'))).toBe(true);
  });
  test('a test another write can satisfy does not: a decline, the null path, or the plan', () => {
    const eq1 = { seedFact: 'stage', op: 'eq', value: 1 } as Pred;
    expect(unreachable(explicit(eq1, (p) => { frag(p, 'f-meet').offer!.decline[0]!.writes = [{ fact: 'stage', set: 1 }]; }))).toBe(true);
    expect(unreachable(explicit(eq1, (p) => { frag(p, 'f-meet').offer!.nullPath.writes = [{ fact: 'stage', set: 1 }]; }))).toBe(true);
    expect(unreachable(explicit(eq1, (_p, s) => { s.unattended = { after: { clock: 'game', s: 600 }, outcome: [{ fact: 'stage', set: 1 }] }; }))).toBe(true);
  });
  test('a beat that is in start, offered again, or led to by a failure can be reached without it', () => {
    expect(unreachable(explicit(act('go'), (_p, s) => { s.start = ['meet', 'finish']; }))).toBe(true);
    expect(unreachable(explicit(act('go'), (_p, s) => { s.beats!.finish!.reoffer = { when: 'yes', max: 2 }; }))).toBe(true);
    expect(unreachable(explicit(act('go'), (_p, s) => { s.beats!.meet!.failure = [{ when: 'y == 3', leadsTo: 'finish' }]; }))).toBe(true);
  });
  test('join any needs every chain link to prove it, and a then link cannot', () => {
    expect(unreachable(explicit(act('go'), (_p, s) => { s.beats!.finish!.join = 'any'; s.beats!.finish!.links!.push({ then: 'meet' }); }))).toBe(true);
    expect(unreachable(explicit(act('go'), (_p, s) => { s.beats!.finish!.join = 'any'; s.beats!.finish!.links!.push({ because: 'meet', on: 'yes' }); }))).toBe(true);
    expect(unreachable(explicit(act('go'), (_p, s) => { s.beats!.finish!.links!.push({ then: 'meet' }); }))).toBe(false);
  });
});

describe('L-131a: an in-scene offer links because a beat whose fragment has the same scene label', () => {
  const build = (mutate: Mutate): Finding[] => lintOf((p, s) => {
    p.fragments.push({
      id: 'f-ask', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-go' }, channels: ['message'],
      offer: { stakes: [{ bearer: 'npc', what: 'x' }], actions: [{ id: 'a', stance: 'help', foresight: 'pack:t-go' }], nullPath: { id: 'n' }, lapse: { after: { clock: 'play', s: 600 }, then: 'unattended' }, decline: [{ id: 'd' }], choice: 'flavour' },
    });
    s.beats!.ask = { play: 'pack:f-ask', inScene: true, links: [{ because: 'meet', on: 'yes' }] };
    mutate(p, s);
  });
  test('no label, one label, or two different labels is an error; the same label is not', () => {
    expect(codes(build(() => {}), 'error')).toContain('L-131a');
    expect(codes(build((p) => { frag(p, 'f-ask').scene = 'talk'; }), 'error')).toContain('L-131a');
    expect(codes(build((p) => { frag(p, 'f-ask').scene = 'talk'; frag(p, 'f-meet').scene = 'brawl'; }), 'error')).toContain('L-131a');
    expect(codes(build((p) => { frag(p, 'f-ask').scene = 'talk'; frag(p, 'f-meet').scene = 'talk'; }), 'error')).not.toContain('L-131a');
  });
});

describe('L2-10: the ladder\'s lapse exit carries the lapse gate the profile cannot generate', () => {
  const r1 = (mutate: Mutate): Finding[] => lintOf(mutate, r1Pack);
  test('the base passes; no needs, a different duration, or no condition on the pacing acts is refused with a plain message', () => {
    expect(codes(r1(() => {}), 'error')).toEqual([]);
    const none = r1((p) => { delete frag(p, 'qh-exit-lapse').needs; });
    expect(codes(none, 'error')).toContain('L-10');
    expect(none.find((f) => f.code === 'L-10')!.message).toContain('lapse exit');
    expect(codes(r1((p) => { frag(p, 'qh-exit-lapse').needs = 'since(beat offer-1) >= 600g and count({kind: shared-activity, participant: takemura}, beat offer-1) == 0'; }), 'error')).toContain('L-10');
    expect(codes(r1((p) => { frag(p, 'qh-exit-lapse').needs = 'since(beat offer-1) >= 1209600g'; }), 'error')).toContain('L-10');
  });
  test('a parameterised lapse passes with the fragment that matches its lapseAfter', () => {
    const other = r1((p, s) => {
      (s.profile!.params as { lapseAfter: { clock: string; s: number } }).lapseAfter = { clock: 'game', s: 86_400 };
      frag(p, 'qh-exit-lapse').needs = 'since(beat offer-1) >= 86400g and count({kind: shared-activity, participant: takemura}, beat offer-1) == 0';
    });
    expect(codes(other, 'error')).toEqual([]);
  });
});

describe('L2-15: a later capability is refused anywhere the closure reaches', () => {
  test('in the fallback of a fallback, but not in a fragment nothing reaches', () => {
    const viaImplied = lintOf((p) => {
      p.fragments.push({ id: 'f-fallback', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: ['message'], render: { phrasings: [] } } as never);
      frag(p, 'f-finish').implied = 'pack:f-fallback';
    });
    expect(viaImplied.filter((f) => f.level === 'error').some((f) => /not supported yet/.test(f.message) && /render/.test(f.message))).toBe(true);
    const unreached = lintOf((p) => {
      p.fragments.push({ id: 'f-lonely', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: ['message'], render: { phrasings: [] } } as never);
    });
    expect(unreached.filter((f) => f.level === 'error')).toEqual([]);
  });
  test('in a fragment a variant plays', () => {
    const viaVariant = lintOf((p, s) => {
      p.fragments.push({ id: 'f-var', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: ['message'], says: 'x' } as never);
      s.variation = { variants: [{ id: 'v1', weight: 1, parts: { beats: { ...s.beats, finish: { play: 'pack:f-var', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] } } } as never }] };
    });
    expect(viaVariant.filter((f) => f.level === 'error').some((f) => /not supported yet/.test(f.message))).toBe(true);
  });
});
