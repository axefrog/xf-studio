// Reference scenario R1 (S2 Appendix A): the authored romance side quest for a main-story character, as a
// relationship-ladder profile with its parameters. The fixture pack `xf.example` holds its fragments and words.

import type { LadderParams } from '../../src/seeding/profile.ts';
import type { Fragment, Pack, Seed, SeedInput, TextUnit } from '../../src/seeding/types.ts';

export const R1_PACK = 'xf.example';
export const R1_ID = 'xf.example:takemura-quiet-hour';
export const LAPSE_AFTER = 1_209_600;

const rungs = ['acquainted', 'confided', 'close', 'partner'];

export function r1Params(over: Partial<LadderParams> = {}): LadderParams {
  return {
    with: 'takemura',
    rungs,
    offers: {
      confided: { offer: 'pack:qh-offer-acquainted', notNow: 'pack:t-notnow-1' },
      close: { offer: 'pack:qh-offer-confided', notNow: 'pack:t-notnow-2' },
      partner: { offer: 'pack:qh-offer-close', notNow: 'pack:t-notnow-3' },
    },
    exits: { decline: 'pack:qh-exit-decline', stay: 'pack:qh-exit-stay', lapse: 'pack:qh-exit-lapse' },
    pacing: { acts: [{ kind: 'shared-activity' }], perRung: 1 },
    lapseAfter: { clock: 'game', s: LAPSE_AFTER },
    absence: { after: { clock: 'game', s: 604_800 }, reunion: 'pack:qh-reunion' },
    intimate: { scene: 'pack:qh-intimate-scene', fade: 'pack:qh-intimate-fade', contentTag: 'romance-intimate' },
    ...over,
  };
}

/** The R1 template in the text form of S2 section 2.6: every predicate is an expression. */
export function r1Seed(over: Partial<SeedInput> = {}, params: Partial<LadderParams> = {}): SeedInput {
  return {
    id: R1_ID,
    version: 1,
    maturity: 'ready',
    level: 'arc',
    turns: [{ level: 'concern', who: 'takemura', kind: 'tie', what: 'seedFact(rung) > 0' }],
    purpose: { tags: ['bond', 'aftermath', 'loyalty'], sentence: 'Two people who survived the same betrayal find out what they are to each other.' },
    context: 'q115_point_of_no_return == 0 and takemura.in-city == 1',
    intent: { prohibitions: [], tone: ['restraint', 'grief'] },
    content: { envelope: { 'romance-intimate': 3 } },
    roles: {
      takemura: {
        kind: 'core:person', identity: 'game:takemura', anchor: true, onLost: 'withdraw', onUnfilled: ['wait', 'withdraw'],
        must: [{ path: 'alive', op: 'eq', arg: 1 }, { path: 'age-class', op: 'eq', arg: 'adult' }], textAttrs: ['name'],
      },
      place: {
        kind: 'core:place',
        prefer: [
          { p: { path: 'mood', op: 'eq', arg: 'quiet' }, strength: 2 },
          { p: { path: '', op: 'has-edge', arg: { edge: 'core:located-in', to: 'root:japantown' } }, strength: 2 },
        ],
        onUnfilled: ['wait', 'withdraw'],
      },
    },
    windows: [
      {
        id: 'main',
        opens: 'decided(q112_takemura_dead) and q112_takemura_dead == 0 and q112_done == 1 and takemura.allied == 1',
        closes: 'q115_point_of_no_return == 1',
        lead: 'preferred',
        onClose: 'coda',
        closeContent: 'pack:quiet-hour-coda',
      },
    ],
    closing: 'pack:quiet-hour-closing',
    profile: { id: 'relationship-ladder', params: r1Params(params) as unknown as Record<string, unknown> },
    ...over,
  } as SeedInput;
}

const text = (id: string, t: string, extra: Partial<TextUnit> = {}): TextUnit => ({ id, text: t, origin: 'authored', ...extra });

function offerFragment(i: number, name: string): Fragment {
  return {
    id: name, level: 'exchange', roles: ['takemura'], salience: 'foreground',
    forms: { standard: `pack:t-${name}` }, channels: ['message'],
    offer: {
      stakes: [{ bearer: 'takemura', what: 'tie' }],
      actions: [
        { id: 'accept', stance: 'help', foresight: `pack:t-fore-accept-${i}`, writes: [{ fact: 'rung', set: i, persist: 'lasting' }] },
        { id: 'stay', stance: 'bargain', foresight: `pack:t-fore-stay-${i}`, writes: [{ fact: 'exit', set: 2, persist: 'lasting' }] },
      ],
      nullPath: { id: 'not-now', content: `pack:t-notnow-${i}` },
      lapse: { after: { clock: 'play', s: 1800 }, then: 'reoffer' },
      decline: [{ id: 'decline', response: 'pack:qh-exit-decline', writes: [{ fact: 'exit', set: 1, persist: 'lasting' }] }],
      choice: 'consequential',
    },
  };
}

export function r1Fragments(): Fragment[] {
  const exit = (name: string, extra: Partial<Fragment> = {}): Fragment => ({
    id: name, level: 'exchange', roles: ['takemura'], salience: 'foreground', forms: { standard: `pack:t-${name}` }, channels: ['message'], ...extra,
  });
  return [
    offerFragment(1, 'qh-offer-acquainted'),
    offerFragment(2, 'qh-offer-confided'),
    offerFragment(3, 'qh-offer-close'),
    exit('qh-exit-decline'),
    exit('qh-exit-stay'),
    exit('qh-exit-lapse', {
      needs: 'since(beat offer-1) >= 1209600g and count({kind: shared-activity, participant: takemura}, beat offer-1) == 0',
    }),
    {
      id: 'qh-intimate-scene', level: 'exchange', roles: ['takemura'], salience: 'foreground', forms: { standard: 'pack:t-qh-intimate-scene' },
      channels: ['message'], authored: 'human', content: [{ class: 'romance-intimate', intensity: 3 }], implied: 'pack:qh-intimate-fade',
      applies: 'setting(content.romance-intimate) in {3}',
    },
    {
      id: 'qh-intimate-fade', level: 'exchange', roles: ['takemura'], salience: 'foreground', forms: { standard: 'pack:t-qh-intimate-fade' },
      channels: ['message'], applies: 'not setting(content.romance-intimate) in {3}',
    },
  ];
}

export function r1Texts(): TextUnit[] {
  return [
    text('t-qh-offer-acquainted', 'Meet me at the quiet place, {takemura.name}? We should talk.'),
    text('t-qh-offer-confided', 'There is something I never told anyone, {takemura.name}.'),
    text('t-qh-offer-close', 'I would like you to stay, {takemura.name}.'),
    text('t-fore-accept-1', 'Go and listen.'),
    text('t-fore-accept-2', 'Keep the confidence.'),
    text('t-fore-accept-3', 'Stay.'),
    text('t-fore-stay-1', 'Stay as friends.'),
    text('t-fore-stay-2', 'Stay as friends.'),
    text('t-fore-stay-3', 'Stay as friends.'),
    text('t-notnow-1', 'Another time.'),
    text('t-notnow-2', 'Another time.'),
    text('t-notnow-3', 'Another time.'),
    text('t-qh-exit-decline', 'Understood.'),
    text('t-qh-exit-stay', 'Friends, then.'),
    text('t-qh-exit-lapse', 'It has been a long while.'),
    text('t-qh-intimate-scene', 'A scene written by a person, standing in for the real one.', { authored: 'human', author: 'Test Author', class: 'romance-intimate' }),
    text('t-qh-intimate-fade', 'The door closes.'),
    text('quiet-hour-closing', 'The quiet hour is over.'),
    text('quiet-hour-coda', 'You two spoke once, and it mattered.', { channels: ['message'] }),
  ];
}

export function r1Pack(over: Partial<Pack> = {}, seedOver: Partial<SeedInput> = {}): Pack {
  return { id: R1_PACK, version: 1, seeds: [r1Seed(seedOver) as Seed], fragments: r1Fragments(), texts: r1Texts(), authors: ['Test Author'], ...over };
}
