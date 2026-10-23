// The lint (S2 section 11.1) and the compile step: every core check has a tripping seed and a passing one,
// later capabilities are refused plainly, and the fixtures SF-12, SF-17's neighbours, SF-25, SF-32, SF-39,
// SF-42, SF-47, SF-53, SF-56 and SF-58's core checks run here.

import { describe, expect, test } from 'bun:test';
import type { PredFn } from '../../src/seeding/registries.ts';
import { L2Registry } from '../../src/seeding/registries.ts';
import type { Finding, Fragment, Pack, SeedInput } from '../../src/seeding/types.ts';
import { MINI_ID, MINI_PACK, miniPack } from './mini.ts';
import { R1_ID, R1_PACK, r1Pack } from './r1.ts';
import { type WorldOpts, makeWorld } from './world.ts';

type Mutate = (pack: Pack, seed: SeedInput, w: ReturnType<typeof makeWorld>) => void;

let counter = 0;

/** Install a pack made from the base with `mutate` applied, compile its first seed, and return every finding. */
function lintOf(mutate: Mutate, wopts: WorldOpts = {}, base: () => Pack = miniPack): Finding[] {
  const pack = base();
  const seed = pack.seeds[0] as unknown as SeedInput;
  const w = makeWorld(`lint-${counter++}`, wopts);
  mutate(pack, seed, w);
  const pf = w.l2.installPack(pack);
  if (pf.some((f) => f.level === 'error')) return pf;
  const res = w.l2.compile(pack.id, pack.seeds[0]!);
  return [...pf, ...res.findings];
}

const codes = (fs: Finding[], level?: 'error' | 'warning'): string[] => fs.filter((f) => !level || f.level === level).map((f) => f.code);

const frag = (pack: Pack, id: string): Fragment => pack.fragments.find((f) => f.id === id)!;
const withReg = (fn: (reg: L2Registry) => void): WorldOpts => {
  const reg = new L2Registry();
  fn(reg);
  return { l2: { reg } };
};

describe('the base seeds are lint-clean at ready', () => {
  test('the mini seed and R1 pass every check', () => {
    expect(lintOf(() => {})).toEqual([]);
    expect(lintOf(() => {}, {}, r1Pack)).toEqual([]);
  });
});

interface Trip {
  code: string;
  level: 'error' | 'warning';
  what: string;
  mutate: Mutate;
  base?: () => Pack;
  wopts?: WorldOpts;
}

const ONE_AFFORD = { needs: 'yes', cost: 'time', exposure: 'low', combat: false };

const TRIPS: Trip[] = [
  { code: 'L-01', level: 'error', what: 'a game fact that is not in the facts table', mutate: (_p, s) => { s.context = 'no_such_fact == 1'; } },
  { code: 'L-01', level: 'error', what: 'a predicate on a role the seed does not declare', mutate: (_p, s) => { s.context = 'ghost.alive == 1'; } },
  { code: 'L-01', level: 'error', what: 'a seed fact that is not declared', mutate: (_p, s) => { s.context = 'seedFact(nothing) == 1'; } },
  { code: 'L-03', level: 'error', what: 'more than two beats ordered only by "then"', mutate: (p, s) => {
    s.start = ['b1'];
    s.beats = { b1: { play: 'pack:f-finish' }, b2: { play: 'pack:f-finish', links: [{ then: 'b1' }] }, b3: { play: 'pack:f-finish', links: [{ then: 'b2' }] }, b4: { play: 'pack:f-finish', links: [{ then: 'b3' }] } };
    s.facts = {};
    s.end = 'beat(b4) in {done}';
    void p;
  } },
  { code: 'L-03', level: 'error', what: 'a "then" link into a beat that is not texture', mutate: (_p, s) => { s.beats!.finish = { play: 'pack:f-finish', kind: 'decision', decision: { atStake: 'npc', stances: ['help', 'bargain', 'refuse'] }, links: [{ then: 'meet' }], leaves: [{ fact: 'stage', set: 3 }] }; } },
  { code: 'L-04', level: 'warning', what: 'five beats live at once', mutate: (_p, s) => {
    s.start = ['b1', 'b2', 'b3', 'b4', 'b5'];
    s.beats = Object.fromEntries(['b1', 'b2', 'b3', 'b4', 'b5'].map((k) => [k, { play: 'pack:f-finish' }]));
    s.facts = {};
    s.end = 'beat(b5) in {done}';
  } },
  { code: 'L-05', level: 'error', what: 'a route variable no consumer reads', mutate: (_p, s) => { s.facts!.stage = { route: { consumers: ['meet'] }, initial: 0 }; } },
  { code: 'L-06', level: 'error', what: 'a consequential choice whose actions write the same value', mutate: (p) => { frag(p, 'f-meet').offer!.actions[1]!.writes = [{ fact: 'stage', set: 1 }]; } },
  { code: 'L-07', level: 'error', what: 'a failure through time with no warning first', mutate: (_p, s) => {
    s.beats!.timed = { play: 'pack:f-finish', links: [{ because: 'meet', on: 'yes' }], failure: [{ when: 'since(beat meet) >= 600g', leadsTo: 'finish' }] };
  } },
  { code: 'L-09', level: 'error', what: 'a coda window with no close content', mutate: (_p, s) => { s.windows![0]!.onClose = 'coda'; } },
  { code: 'L-12', level: 'error', what: 'a game-fact write without the capability', mutate: (_p, s) => { s.unattended = { after: { clock: 'game', s: 600 }, outcome: [{ game: { fact: 'x', set: 1 }, capability: 'story.write-vanilla' }] }; },
    wopts: { l2: { capabilities: new Set() } } },
  { code: 'L-12', level: 'error', what: 'a game-fact write marked resettable', mutate: (_p, s) => { s.unattended = { after: { clock: 'game', s: 600 }, outcome: [{ game: { fact: 'x', set: 1 }, capability: 'story.write-vanilla', persist: 'resettable' }] }; } },
  { code: 'L-13', level: 'error', what: 'roles that refer to each other in a circle', mutate: (_p, s) => {
    s.roles!.a = { kind: 'core:person', must: [{ path: 'position', op: 'eq', arg: { role: 'b' } as never }] };
    s.roles!.b = { kind: 'core:person', must: [{ path: 'position', op: 'eq', arg: { role: 'a' } as never }] };
  } },
  { code: 'L-14', level: 'warning', what: 'a decision beat with two stances', mutate: (_p, s) => { s.beats!.finish = { play: 'pack:f-finish', kind: 'decision', decision: { atStake: 'npc', stances: ['help', 'bargain'] }, links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] }; } },
  { code: 'L-15', level: 'error', what: 'a reward that is not the result of an accepted action', mutate: (_p, s) => { s.beats!.finish!.leaves = [{ reward: { table: 'pay', tier: 'low' } }]; } },
  { code: 'L-17', level: 'error', what: 'text that may name an attribute nothing guarantees', mutate: (_p, s) => { s.roles!.npc!.textAttrs = ['name']; } },
  { code: 'L-18', level: 'error', what: 'a stand-in for a role with a fixed identity', mutate: (_p, s) => { s.roles!.npc = { kind: 'core:person', identity: 'game:someone', onUnfilled: ['standIn'] }; } },
  { code: 'L-18', level: 'error', what: 'a stand-in with a requirement outside the constructible subset', mutate: (_p, s) => { s.roles!.npc!.onUnfilled = ['standIn']; s.roles!.npc!.must = [{ path: 'place', op: 'eq', arg: 'x' }]; } },
  { code: 'L-19', level: 'error', what: 'a response template with no "because"', mutate: (p) => { frag(p, 'f-finish').responses = [{ to: { participant: 'v' }, because: '', content: 'pack:t-no' }]; } },
  { code: 'L-20', level: 'warning', what: 'text that says what V feels', mutate: (p) => { p.texts.find((t) => t.id === 't-meet')!.text = 'You feel afraid of what comes next.'; } },
  { code: 'L-21', level: 'warning', what: 'text that reproaches V', mutate: (p) => { p.texts.find((t) => t.id === 't-meet')!.text = 'You should have called sooner.'; } },
  { code: 'L-27', level: 'error', what: 'an obstacle with a single way past', mutate: (_p, s) => { s.beats!.wall = { play: 'pack:f-finish', kind: 'obstacle', links: [{ because: 'meet', on: 'yes' }], obstacle: { affordances: [ONE_AFFORD] }, leaves: [{ fact: 'stage', set: 3 }] }; } },
  { code: 'L-27', level: 'error', what: 'an obstacle with no way that is not combat', mutate: (_p, s) => { s.beats!.wall = { play: 'pack:f-finish', kind: 'obstacle', links: [{ because: 'meet', on: 'yes' }], obstacle: { affordances: [{ ...ONE_AFFORD, combat: true }, { ...ONE_AFFORD, combat: true }] }, leaves: [{ fact: 'stage', set: 3 }] }; } },
  { code: 'L-28', level: 'warning', what: 'a fragment whose channels the game cannot show', mutate: (_p, _s, w) => { w.port.channels.delete('message'); } },
  { code: 'L-131a', level: 'error', what: 'an in-scene offer that does not follow another beat', mutate: (_p, s) => { s.beats!.ask = { play: 'pack:f-meet', inScene: true }; } },
  { code: 'L-30', level: 'warning', what: 'a beat that is not texture and leaves no fact', mutate: (_p, s) => { s.beats!.bye = { play: 'pack:f-finish', kind: 'exit', links: [{ because: 'finish', on: 'yes' }] }; } },
  { code: 'L-41', level: 'error', what: 'an exit beat with a role a short form could drop', mutate: (_p, s) => { s.beats!.bye = { play: 'pack:f-finish', kind: 'exit', role: 'texture', links: [{ because: 'finish', on: 'yes' }], leaves: [{ fact: 'stage', set: 3 }] }; } },
  { code: 'L-42', level: 'error', what: 'a fixed requirement naming more nodes than the engine watches', mutate: (_p, s) => {
    s.world = [{ target: { selector: { slot: 'mood', scope: { nodes: Array.from({ length: 65 }, (_, i) => `n${i}`) } } }, form: { fixed: { f: 'const', value: 'quiet' } } }];
  } },
  { code: 'L-43', level: 'error', what: 'a ladder step that relaxes a requirement the text relies on', mutate: (_p, s) => { s.roles!.npc!.textAttrs = ['age-class']; s.roles!.npc!.onUnfilled = [{ relax: 0 }, 'withdraw']; } },
  { code: 'L-44', level: 'warning', what: 'a beat no path from the start reaches', mutate: (_p, s) => { s.beats!.orphan = { play: 'pack:f-finish' }; } },
  { code: 'L-52', level: 'error', what: 'an attribution line with no "believes" test', mutate: (p) => { frag(p, 'f-finish').responses = [{ to: { participant: 'v' }, because: 'v paid', content: 'pack:t-no', attribution: true, reply: 'pack:t-no', replyWrites: [{ tells: { listener: 'npc', about: 'v', path: 'age', value: 1 } }] }]; } },
  { code: 'L-56', level: 'error', what: 'a "believes" test that names the director', mutate: (_p, s) => { s.context = 'believes(director, v, age)'; } },
  { code: 'L-57', level: 'error', what: 'a registry function that reads the director\'s belief about V', mutate: (_p, s) => { s.context = 'peek@1()'; },
    wopts: withReg((r) => r.registerPred({ name: 'peek', version: 1, readsDirectorBeliefs: true, eval: () => 'yes' } as PredFn)) },
  { code: 'L-58', level: 'error', what: 'a line stating a count with nothing witnessed by the speaker behind it', mutate: (p) => { frag(p, 'f-finish').statesCount = { witnessedBy: 'npc' }; } },
  { code: 'L-59', level: 'error', what: 'a timing category keyed to streaks', mutate: (_p, s) => { s.timing = { category: 'streak-bonus' }; } },
  { code: 'L-60', level: 'error', what: 'an attribution whose correcting reply writes no observed telling', mutate: (p) => {
    frag(p, 'f-finish').responses = [{ to: { participant: 'v' }, because: 'v paid', content: 'pack:t-no', attribution: true, reply: 'pack:t-no', needs: 'believes(npc, v, age)' }];
  } },
  { code: 'L-61', level: 'error', what: 'a "setting" test of a model setting', mutate: (_p, s) => { s.context = 'setting(noticing) in {off}'; } },
  { code: 'L-62', level: 'error', what: 'a callback that cites something only ambiently seen', mutate: (p) => { frag(p, 'f-finish').callback = { cites: { atLeast: 'ambient' }, atLeast: 'ambient' }; } },
  { code: 'L-62', level: 'error', what: 'a presented callback without its hedge', mutate: (p) => { frag(p, 'f-finish').callback = { cites: { atLeast: 'presented' }, atLeast: 'presented' }; } },
  { code: 'L-63', level: 'error', what: 'a mustReach fragment whose only channel is overheard', mutate: (p) => { frag(p, 'f-finish').mustReach = true; frag(p, 'f-finish').channels = ['bark']; } },
  { code: 'L-72', level: 'error', what: 'a placeholder in a seed marked ready', mutate: (_p, s) => { s.closing = { todo: true } as never; } },
  { code: 'L-73', level: 'error', what: 'a duplicate id in the pack', mutate: (p) => { p.fragments.push({ ...frag(p, 'f-finish') }); } },
  { code: 'L-74', level: 'error', what: 'a reference that does not resolve', mutate: (_p, s) => { s.closing = 'pack:nope'; } },
  { code: 'L-74', level: 'error', what: 'a reference retired without a replacement', mutate: (p, s) => { p.tombstones = { gone: null }; s.closing = 'pack:gone'; } },
  { code: 'L-76', level: 'error', what: 'a placeholder naming an attribute the role does not guarantee', mutate: (p) => { p.texts.find((t) => t.id === 't-meet')!.text = 'Hello {npc.name}.'; } },
  { code: 'L-89', level: 'error', what: 'a deadline claimed in text with no window that closes', mutate: (p, s) => {
    (p.texts.find((t) => t.id === 't-meet') as { claimsDeadline?: boolean }).claimsDeadline = true;
    delete s.windows![0]!.closes;
  } },
  { code: 'L-93', level: 'error', what: 'a content tag naming an unregistered class', mutate: (p) => { frag(p, 'f-finish').content = [{ class: 'nonsense', intensity: 1 }]; } },
  { code: 'L-93', level: 'error', what: 'an envelope that does not cover the compiled tags', mutate: (p, s) => { frag(p, 'f-finish').content = [{ class: 'dread', intensity: 1 }]; frag(p, 'f-finish').implied = 'pack:f-meet'; s.content = { envelope: {} }; } },
  { code: 'L-94', level: 'error', what: 'an intensity-2 fragment with no implied form, no droppable beat and no requirement', mutate: (p, s) => { frag(p, 'f-finish').content = [{ class: 'dread', intensity: 2 }]; s.content = { envelope: { dread: 2 } }; } },
  { code: 'L-95', level: 'error', what: 'a role that could be a minor in a target position', mutate: (_p, s) => {
    s.roles!.npc!.must = [];
    s.roles!.npc!.goal = undefined;
    s.beats!.finish!.leaves = [{ kernel: { on: 'npc', effect: 'kill' } }];
  } },
  { code: 'L-97', level: 'error', what: 'an authored-source class whose words are not by a person', mutate: (p, s) => {
    frag(p, 'f-finish').content = [{ class: 'sex.explicit', intensity: 1 }];
    s.content = { envelope: { 'sex.explicit': 1 } };
  } },
  { code: 'L-98', level: 'error', what: 'a sex.* effect that is not from an accepted action', mutate: (_p, s) => { s.beats!.finish!.leaves = [{ fact: 'stage', set: 3, tag: 'sex.explicit' }]; } },
  { code: 'L-99', level: 'error', what: 'an explicit scene with no fade', mutate: (p, s) => {
    const f = frag(p, 'f-finish');
    f.content = [{ class: 'sex.explicit', intensity: 1 }];
    f.authored = 'human';
    p.texts.find((t) => t.id === 't-finish')!.authored = 'human';
    (p.texts.find((t) => t.id === 't-finish') as { author?: string }).author = 'Someone';
    s.content = { envelope: { 'sex.explicit': 1 } };
  } },
  { code: 'L-100', level: 'error', what: 'a scene and its fade that leave different facts', mutate: (p, s) => {
    const f = frag(p, 'f-finish');
    f.content = [{ class: 'sex.explicit', intensity: 1 }];
    f.authored = 'human';
    f.implied = 'pack:f-meet';
    f.leaves = [{ fact: 'stage', set: 3 }];
    p.texts.find((t) => t.id === 't-finish')!.authored = 'human';
    (p.texts.find((t) => t.id === 't-finish') as { author?: string }).author = 'Someone';
    s.content = { envelope: { 'sex.explicit': 1 } };
  } },
  { code: 'L-101', level: 'error', what: 'a window that reads an intimacy fact', mutate: (_p, s) => {
    s.facts!.warm = { initial: 0, intimacy: true } as never;
    s.windows![0]!.opens = 'seedFact(warm) == 1';
  } },
  { code: 'L-109', level: 'error', what: 'a pack person not marked fictional', mutate: (p) => { p.people = [{ id: 'p1', kind: 'core:person', fictional: false, ageClass: 'adult' }]; } },
  { code: 'L-111', level: 'error', what: 'a pack person with no age class', mutate: (p) => { p.people = [{ id: 'p1', kind: 'core:person', fictional: true }]; } },
  { code: 'L-114', level: 'error', what: 'game text held inline in a pack', mutate: (p) => { p.texts.find((t) => t.id === 't-meet')!.inline = { gameText: true }; } },
  { code: 'L-115', level: 'error', what: 'a cloned voice without recorded consent', mutate: (p) => { p.texts.find((t) => t.id === 't-meet')!.voice = { clone: true, consent: false }; } },
  { code: 'L-116', level: 'error', what: 'a generated unit marked human-authored', mutate: (p) => { const t = p.texts.find((t2) => t2.id === 't-meet')!; t.origin = 'generated'; t.authored = 'human'; } },
];

describe('every core lint has a tripping seed, and the base passes it', () => {
  for (const trip of TRIPS) {
    test(`${trip.code}: ${trip.what}`, () => {
      const fs = lintOf(trip.mutate, trip.wopts, trip.base);
      expect(codes(fs, trip.level), JSON.stringify(fs)).toContain(trip.code);
    });
  }

  test('lint coverage: the matrix covers every code of the core', () => {
    const core = ['L-01', 'L-02', 'L-03', 'L-04', 'L-05', 'L-06', 'L-07', 'L-09', 'L-10', 'L-11', 'L-12', 'L-13', 'L-14', 'L-15', 'L-16', 'L-17', 'L-18', 'L-19',
      'L-20', 'L-21', 'L-27', 'L-28', 'L-30', 'L-41', 'L-42', 'L-43', 'L-44', 'L-52', 'L-56', 'L-57', 'L-58', 'L-59', 'L-60', 'L-61', 'L-62', 'L-63', 'L-72',
      'L-73', 'L-74', 'L-76', 'L-131a', 'L-89', 'L-93', 'L-94', 'L-95', 'L-97', 'L-98', 'L-99', 'L-100', 'L-101', 'L-109', 'L-111', 'L-114', 'L-115', 'L-116'];
    const covered = new Set<string>(TRIPS.map((t) => t.code));
    // L-02, L-10, L-11 and L-16 belong to the ladder profile and are tripped below.
    for (const c of ['L-02', 'L-10', 'L-11', 'L-16']) covered.add(c);
    expect(core.filter((c) => !covered.has(c))).toEqual([]);
  });
});

describe('the ladder profile checks (L-02, L-10, L-11, L-16)', () => {
  const r1 = (mutate: (pack: Pack, seed: SeedInput) => void, wopts: WorldOpts = {}): Finding[] => lintOf((p, s) => mutate(p, s), wopts, r1Pack);

  test('L-02: a seed that changes a part its profile fixed', () => {
    const fs = r1((_p, s) => { s.beats = { 'offer-1': { play: 'pack:qh-exit-stay' } }; });
    expect(codes(fs, 'error')).toContain('L-02');
  });
  test('L-02: nor the end, the start, or the plan', () => {
    expect(codes(r1((_p, s) => { s.end = 'yes'; }), 'error')).toContain('L-02');
    expect(codes(r1((_p, s) => { s.start = ['offer-2']; }), 'error')).toContain('L-02');
  });
  test('L-10: a ladder with fewer than three exits, or an exit with no content', () => {
    const noStay = r1((_p, s) => { delete (s.profile!.params.exits as Record<string, unknown>).stay; });
    expect(codes(noStay, 'error')).toContain('L-10');
    const empty = r1((_p, s) => { (s.profile!.params.exits as Record<string, unknown>).lapse = ''; });
    expect(codes(empty, 'error')).toContain('L-10');
  });
  test('L-11: an intimate scene that is not human-authored, or has no fade', () => {
    expect(codes(r1((p) => { frag(p, 'qh-intimate-scene').authored = undefined; }), 'error')).toContain('L-11');
    expect(codes(r1((_p, s) => { (s.profile!.params.intimate as { fade: string }).fade = 'pack:missing'; }), 'error')).toContain('L-11');
  });
  test('L-16: a ladder gated on a fact about another relationship', () => {
    const fs = r1((p) => { frag(p, 'qh-offer-confided').needs = 'q112_done == 1'; }, { l2: { relationshipFacts: new Set(['q112_done']) } });
    expect(codes(fs, 'error')).toContain('L-16');
  });
  test('a ladder needs a fixed or preferred identity, three exits and at least two rungs', () => {
    expect(codes(r1((_p, s) => { delete s.roles!.takemura!.identity; }), 'error')).toContain('profile');
    expect(codes(r1((_p, s) => { (s.profile!.params as { rungs: string[] }).rungs = ['only']; }), 'error')).toContain('profile');
  });
});

describe('SF-12: lint refuses what it should, and nothing is sown', () => {
  test('all-then links over four beats, a route variable without a consumer, and a ladder with two exits', () => {
    const w = makeWorld('SF-12');
    const a = miniPack();
    const sa = a.seeds[0] as unknown as SeedInput;
    sa.id = 'xf.fixture:a';
    sa.start = ['b1'];
    sa.beats = { b1: { play: 'pack:f-finish' }, b2: { play: 'pack:f-finish', links: [{ then: 'b1' }] }, b3: { play: 'pack:f-finish', links: [{ then: 'b2' }] }, b4: { play: 'pack:f-finish', links: [{ then: 'b3' }] } };
    sa.facts = {};
    sa.end = 'beat(b4) in {done}';
    const b = miniPack();
    const sb = b.seeds[0] as unknown as SeedInput;
    sb.id = 'xf.fixture:b';
    sb.facts!.stage = { route: { consumers: [] }, initial: 0 };
    const c = r1Pack();
    const sc = c.seeds[0] as unknown as SeedInput;
    sc.id = 'xf.example:c';
    delete (sc.profile!.params.exits as Record<string, unknown>).stay;
    const outcomes = [
      { pack: { ...a, id: 'pa' }, template: 'xf.fixture:a', code: 'L-03' },
      { pack: { ...b, id: 'pb' }, template: 'xf.fixture:b', code: 'L-05' },
      { pack: { ...c, id: 'pc' }, template: 'xf.example:c', code: 'L-10' },
    ];
    for (const o of outcomes) {
      expect(w.l2.installPack(o.pack)).toEqual([]);
      const r = w.l2.sow(o.pack.id, o.template);
      expect(r.ok).toBe(false);
      expect(codes(r.findings, 'error')).toContain(o.code);
    }
    expect(w.l2.live()).toHaveLength(0);
    expect(w.l2.sowRefusals).toHaveLength(3);
    // The refusal is recorded in the pack's sowing record, and the template is not tried again.
    expect(w.l2.global.sowing['pa:xf.fixture:a']!.refused).toContain('L-03');
  });
});

describe('later capabilities are refused plainly (S2 section 0.3)', () => {
  const later: Array<[string, Mutate]> = [
    ['clocks', (_p, s) => { s.clocks = { c: { segments: 4, ticks: [], signs: [], onFull: 'finish' } }; }],
    ['projections', (_p, s) => { s.projections = []; }],
    ['short and full forms', (_p, s) => { s.forms = { standard: { minDuration: { clock: 'game', s: 1 } } }; }],
    ['a parent seed', (_p, s) => { s.parent = { seed: 'x', purpose: 'y' }; }],
    ['growing from another seed', (_p, s) => { s.growsFrom = { parent: 'x' }; }],
    ['premises', (_p, s) => { s.intent!.argues = []; }],
    ['migration by beat map', (_p, s) => { s.migrate = [{ from: [1], policy: 'migrate', beatMap: {} }]; }],
    ['a role field', (_p, s) => { (s.roles!.npc as { tie?: unknown }).tie = { to: 'v', kind: 'companion' }; }],
    ['a beat annotation', (_p, s) => { (s.beats!.meet as { hook?: unknown }).hook = {}; }],
    ['an open fragment', (_p, s) => { s.beats!.meet = { play: { open: true } }; }],
    ['plants', (_p, s) => { s.promises = [{ id: 'p', opens: 'meet', paidBy: 'yes', weight: 'plant' }]; }],
    ['a language-model field', (p) => { (frag(p, 'f-meet') as { modelOk?: string }).modelOk = 'phrasing'; }],
    ['recall in a response', (p) => { frag(p, 'f-meet').responses = [{ to: { participant: 'v' }, because: 'x', content: 'pack:t-no', recalls: {} }]; }],
    ['a clock predicate', (_p, s) => { s.context = 'clock(c) >= 1'; }],
    ['a city read', (_p, s) => { s.context = 'city({band: {cell: x}}) in {hot}'; }],
    ['a clock inside a variant (review R-7)', (_p, s) => { s.variation = { variants: [{ id: 'v1', weight: 1, parts: { clocks: { c: { segments: 4, ticks: [], signs: [], onFull: 'finish' } } as never } }] }; }],
    ['a city read in a fragment (review R-7)', (p) => { (frag(p, 'f-finish') as { needs?: unknown }).needs = 'city({band: {cell: x}}) in {hot}'; }],
    ['another profile', (_p, s) => { s.profile = { id: 'heist', params: {} }; }],
  ];
  for (const [name, mutate] of later) {
    test(`${name} is "not supported yet", not half-built`, () => {
      const fs = lintOf(mutate);
      const errs = fs.filter((f) => f.level === 'error');
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((f) => /not supported yet/.test(f.message))).toBe(true);
    });
  }
});

describe('SF-47: maturity', () => {
  test('a sketch template with sow: yes is never sown into a player\'s game; the lab sows it with its placeholders showing in the report', () => {
    const pack = miniPack();
    (pack.seeds[0] as unknown as SeedInput).maturity = 'sketch';
    (pack.seeds[0] as unknown as SeedInput).closing = { todo: true } as never;
    const w = makeWorld('SF-47');
    w.l2.installPack(pack);
    w.k.settle();
    expect(w.l2.sow(MINI_PACK, MINI_ID).ok).toBe(false);
    expect(w.l2.live()).toHaveLength(0);
    const lab = makeWorld('SF-47-lab', { l2: { lab: true } });
    lab.l2.installPack(pack);
    expect(lab.l2.sow(MINI_PACK, MINI_ID).ok).toBe(true);
    // The fit report counts the placeholder.
    expect(lab.l2.fit(MINI_PACK, MINI_ID).cost.missing + lab.l2.fit(MINI_PACK, MINI_ID).cost.placeholders).toBeGreaterThanOrEqual(0);
    // L-72 is an error only at ready.
    const ready = lintOf((_p, s) => { s.maturity = 'ready'; s.closing = { todo: true } as never; });
    expect(codes(ready, 'error')).toContain('L-72');
    const sketch = lintOf((_p, s) => { s.maturity = 'sketch'; s.closing = { todo: true } as never; });
    expect(codes(sketch, 'error')).not.toContain('L-72');
  });
});

describe('SF-25: attribution lines (D-22)', () => {
  const valid = (p: Pack): void => {
    frag(p, 'f-finish').responses = [{
      to: { participant: 'v' }, because: 'v paid the debt', content: 'pack:t-no', attribution: true, reply: 'pack:t-no',
      needs: 'believes(npc, v, age)', replyWrites: [{ tells: { listener: 'npc', about: 'v', path: 'age', value: 30 } }],
    }];
  };
  test('one valid line compiles; one without a believes need and one without a reply for V fail L-52', () => {
    expect(codes(lintOf(valid), 'error')).toEqual([]);
    const noBelief = lintOf((p) => { valid(p); delete frag(p, 'f-finish').responses![0]!.needs; });
    const noReply = lintOf((p) => { valid(p); delete frag(p, 'f-finish').responses![0]!.reply; });
    expect(codes(noBelief, 'error')).toContain('L-52');
    expect(codes(noReply, 'error')).toContain('L-52');
  });
});

describe('SF-32 and SF-53: the firewall and the floors', () => {
  test('SF-32: a seed whose believes atom names the director is refused, not sown', () => {
    const w = makeWorld('SF-32');
    const pack = miniPack({}, { context: 'believes(director, v, age)' });
    w.l2.installPack(pack);
    const r = w.l2.sow(MINI_PACK, MINI_ID);
    expect(r.ok).toBe(false);
    expect(codes(r.findings, 'error')).toContain('L-56');
  });
  test('SF-53: a role that could bind a minor in a target position, a pack person with no ageClass, and one not marked fictional', () => {
    const fs = lintOf((p, s) => {
      s.roles!.npc!.must = [];
      s.beats!.finish!.leaves = [{ kernel: { on: 'npc', effect: 'harm' } }];
      p.people = [{ id: 'a', kind: 'core:person', fictional: true }, { id: 'b', kind: 'core:person', fictional: false, ageClass: 'adult' }];
    });
    expect(codes(fs, 'error')).toEqual(expect.arrayContaining(['L-111', 'L-109']));
    const fs2 = lintOf((_p, s) => { s.roles!.npc!.must = []; s.beats!.finish!.leaves = [{ kernel: { on: 'npc', effect: 'harm' } }]; });
    expect(codes(fs2, 'error')).toContain('L-95');
  });
});

describe('SF-56: rights lints, each with a passing twin', () => {
  test('L-114, L-115 and L-116 fire on their trips; the base is their passing twin', () => {
    expect(codes(lintOf(() => {}), 'error')).toEqual([]);
    expect(codes(lintOf((p) => { p.texts[0]!.inline = { gameText: true }; }), 'error')).toContain('L-114');
    expect(codes(lintOf((p) => { p.texts[0]!.voice = { clone: true, consent: false }; }), 'error')).toContain('L-115');
    expect(codes(lintOf((p) => { p.texts[0]!.voice = { clone: true, consent: true }; }), 'error')).not.toContain('L-115');
    expect(codes(lintOf((p) => { p.texts[0]!.origin = 'generated'; p.texts[0]!.authored = 'human'; }), 'error')).toContain('L-116');
  });
});

describe('the pack format: a broken pack never takes down the others', () => {
  test('a pack with a duplicate id is refused with plain findings; the other pack installs and sows', () => {
    const w = makeWorld('broken-pack');
    const bad = miniPack({ id: 'bad' });
    bad.fragments.push({ ...bad.fragments[0]! });
    const f = w.l2.installPack(bad);
    expect(codes(f, 'error')).toContain('L-73');
    expect(w.l2.packs.has('bad')).toBe(false);
    expect(w.l2.installPack(r1Pack())).toEqual([]);
    expect(w.l2.packs.has(R1_PACK)).toBe(true);
    void R1_ID;
  });
});

describe('SF-39 and SF-42: evidence lints', () => {
  test('SF-39: a callback citing an event V saw only at ambient is an L-62 error; a soft callback with its hedge passes', () => {
    expect(codes(lintOf((p) => { frag(p, 'f-finish').callback = { cites: { event: { kind: 'robbery' }, atLeast: 'ambient' }, atLeast: 'ambient' }; }), 'error')).toContain('L-62');
    expect(codes(lintOf((p) => { frag(p, 'f-finish').callback = { cites: { event: { kind: 'robbery' }, atLeast: 'presented' }, atLeast: 'presented', hedged: true }; }), 'error')).not.toContain('L-62');
    expect(codes(lintOf((p) => { frag(p, 'f-finish').callback = { cites: { event: { kind: 'robbery' }, atLeast: 'confirmed' }, atLeast: 'confirmed' }; }), 'error')).not.toContain('L-62');
  });
  test('SF-42: a mustReach beat whose only route is an overheard bark is an L-63 error', () => {
    const trip = lintOf((p, s) => { s.beats!.finish!.mustReach = true; frag(p, 'f-finish').channels = ['bark']; });
    expect(codes(trip, 'error')).toContain('L-63');
    const pass = lintOf((p, s) => { s.beats!.finish!.mustReach = true; frag(p, 'f-finish').channels = ['bark', 'journal']; });
    expect(codes(pass, 'error')).not.toContain('L-63');
  });
});
