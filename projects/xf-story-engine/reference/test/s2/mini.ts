// A small hand-written seed with no profile, for the lint matrix and the lifecycle tests. It is lint-clean at
// `ready`, so a test trips a check by changing one thing and compares with the pass.

import type { Fragment, Pack, SeedInput, TextUnit } from '../../src/seeding/types.ts';

export const MINI_PACK = 'xf.fixture';
export const MINI_ID = 'xf.fixture:mini';

const text = (id: string, t: string, extra: Partial<TextUnit> = {}): TextUnit => ({ id, text: t, origin: 'authored', ...extra });

export function miniSeed(over: Partial<SeedInput> = {}): SeedInput {
  return {
    id: MINI_ID,
    version: 1,
    maturity: 'ready',
    level: 'gig',
    turns: [],
    purpose: { tags: ['errand'], sentence: 'A small errand for the lint and the lifecycle tests.' },
    context: 'yes',
    intent: { prohibitions: [], tone: ['grounded'] },
    roles: {
      npc: { kind: 'core:person', must: [{ path: 'age-class', op: 'eq', arg: 'adult' }], onUnfilled: ['wait', 'withdraw'] },
    },
    facts: { stage: { route: { consumers: ['finish'] }, initial: 0 } },
    windows: [{ id: 'w', opens: 'flag == 1', closes: 'x == 1', onClose: 'withdraw' }],
    start: ['meet'],
    beats: {
      meet: { play: 'pack:f-meet' },
      finish: { play: 'pack:f-finish', links: [{ because: 'meet', on: 'seedFact(stage) == 1' }], leaves: [{ fact: 'stage', set: 3 }] },
    },
    end: 'beat(finish) in {done}',
    unattended: { after: { clock: 'game', s: 600 }, outcome: [{ fact: 'stage', set: 0 }] },
    closing: 'pack:t-closing',
    ...over,
  } as SeedInput;
}

export function miniFragments(): Fragment[] {
  return [
    {
      id: 'f-meet', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-meet' }, channels: ['message'],
      offer: {
        stakes: [{ bearer: 'npc', what: 'errand' }],
        actions: [
          { id: 'go', stance: 'help', foresight: 'pack:t-go', writes: [{ fact: 'stage', set: 1 }] },
          { id: 'skip', stance: 'ignore', foresight: 'pack:t-skip', writes: [{ fact: 'stage', set: 2 }] },
        ],
        nullPath: { id: 'later', content: 'pack:t-later' },
        lapse: { after: { clock: 'play', s: 600 }, then: 'unattended' },
        decline: [{ id: 'no', response: 'pack:t-no' }],
        choice: 'consequential',
      },
    },
    { id: 'f-finish', level: 'exchange', roles: ['npc'], salience: 'foreground', forms: { standard: 'pack:t-finish' }, channels: ['message'] },
  ];
}

export function miniTexts(): TextUnit[] {
  return ['meet', 'go', 'skip', 'later', 'no', 'finish', 'closing'].map((n) => text(`t-${n}`, `Words: ${n}.`));
}

export function miniPack(over: Partial<Pack> = {}, seedOver: Partial<SeedInput> = {}): Pack {
  return { id: MINI_PACK, version: 1, seeds: [miniSeed(seedOver) as never], fragments: miniFragments(), texts: miniTexts(), ...over };
}
