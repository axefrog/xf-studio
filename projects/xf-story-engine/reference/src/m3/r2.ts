// Reference scenario R2 (M3): "The Friday Fee", an authored Kabuki storyline over what S1's core already simulates.
// A market stallholder, a generated resident, is squeezed by the Tyger Claws' Friday fee and asks V what they will do.
// V can help pay, broker a deal, stand up to the collector, or stay out of it. The seed reads the fee norm, the gang's
// state, the stallholders' view of V (the reputation carrier) and the market's incident heat, through registered reads.
//
// It is written in S2 v1.10's core language the way Appendix A.4 writes R1: an expanded beat graph with no profile,
// only core constructs, lint-clean at `ready`. One presentation slot is an author-fill stand-in (D-23): the
// confrontation scene, with an implied partner that plays when no human-written scene is installed.
// It has no connection to any main-story character; its facts are the quest-progress facts the context reads.

import { parsePred } from '../seeding/pred.ts';
import type { Fragment, Pack, Pred, Seed, SeedInput, TextUnit } from '../seeding/types.ts';

export const R2_PACK = 'xf.m3';
export const R2_ID = 'xf.m3:friday-fee';
export const R2_LAPSE = 7 * 86_400;

const text = (id: string, t: string, extra: Partial<TextUnit> = {}): TextUnit => ({ id, text: t, origin: 'authored', ...extra });

/** A city or social read in the tree form (the text form has no shorter way to name a scope). */
const city = (read: Record<string, Record<string, unknown>>, is: string[]): Pred => ({ city: read, is });
const social = (read: Record<string, Record<string, unknown>>, is: string[]): Pred => ({ social: read, is });
const DISTRICT = 'wat_kab';
/** "Has a name": S1's residents all carry one, and this is how a seed says its text may name them (L-17). */
const HAS_NAME = { path: 'name', op: 'in', arg: { r: 'all' } } as const;

/** The gap between what the stalls think and what they do about the fee norm: the squeeze. */
export const feeStrained = (): Pred => social({ normGap: { norm: 'fee', scope: DISTRICT } }, ['gap', 'wide']);
export const stallsTrust = (): Pred => social({ label: { audience: 'stalls', subject: 'v', axis: 'decent' } }, ['mid', 'high']);
/** The incident heat of the market's own cell (a role key names the cell the seed cast). */
export const marketHot = (): Pred => city({ band: { cell: 'market' } }, ['hot', 'flashpoint']);
export const crackdownOn = (): Pred => city({ regimeIs: { scope: DISTRICT, kind: 'crackdown' } }, ['yes']);

export function r2Seed(over: Partial<SeedInput> = {}): SeedInput {
  return {
    id: R2_ID,
    version: 1,
    maturity: 'ready',
    level: 'gig',
    stakeScale: 'person',
    turns: [{ level: 'concern', who: 'stallholder', kind: 'standing', what: 'seedFact(stance) > 0' }],
    purpose: { tags: ['pressure', 'fee', 'neighbourhood'], sentence: 'A stallholder is squeezed by the gang that collects on Fridays, and asks V what they will do.' },
    context: 'q000_done == 1',
    intent: { prohibitions: [], tone: ['grounded', 'wary'] },
    roles: {
      // the market the stall stands in: a public cell with people living in it (the residents are found under it)
      market: {
        kind: 'xf:cell', onUnfilled: ['wait', 'withdraw'],
        must: [{ path: 'public', op: 'eq', arg: 'public' }, { path: 'headcount', op: 'range', arg: { r: 'ivl', ivls: [[1, 65535]] } }],
      },
      stallholder: {
        kind: 'xf:resident', scope: { under: 'market' }, anchor: true, onLost: 'withdraw', onUnfilled: ['wait', 'withdraw'], textAttrs: ['name'],
        // an adult by S1's age bands (band 1 is 18 to 24), which resolves from the profile and is far cheaper to search than the age class
        must: [{ path: 'role', op: 'eq', arg: 'vendor' }, { path: 'aband', op: 'range', arg: { r: 'ivl', ivls: [[1, 7]] } }, HAS_NAME],
      },
      collector: {
        kind: 'xf:resident', scope: { under: 'market' }, onLost: 'withdraw', onUnfilled: ['wait', 'withdraw'], textAttrs: ['name'],
        // the Claws' members in S1's rosters are all adults, so the search leaves the age class out (it is costly over a gang's size)
        must: [{ path: 'affc', op: 'eq', arg: 2 }, HAS_NAME],
      },
    },
    facts: {
      stance: { route: { consumers: ['paid', 'broker-talk', 'standup-scene'] }, initial: 0 },
      exit: { route: { consumers: ['end'] }, initial: 0 },
    },
    windows: [
      {
        id: 'friday',
        // V is out of the first stretch of the story, and the stalls are under strain over the fee: the offer is made while the norm is gapped
        opens: { all: [parsePred('q001_done == 1'), feeStrained()] },
        closes: 'q115_point_of_no_return == 1',
        lead: 'preferred',
        onClose: 'coda',
        closeContent: 'pack:ff-coda',
      },
    ],
    start: ['ask'],
    beats: {
      ask: { play: 'pack:ff-ask', kind: 'decision', decision: { atStake: 'stallholder', stances: ['help', 'bargain', 'oppose', 'refuse'] } },
      paid: {
        play: { alternates: ['pack:ff-paid-known', 'pack:ff-paid-plain'] }, kind: 'exit', join: 'any',
        links: [{ because: 'ask', on: 'seedFact(stance) == 1' }],
        leaves: [{ fact: 'exit', set: 1 }],
      },
      'broker-talk': {
        play: { alternates: ['pack:ff-broker-heard', 'pack:ff-broker-rebuffed'] }, kind: 'exit', join: 'any',
        links: [{ because: 'ask', on: 'seedFact(stance) == 2' }],
        leaves: [{ fact: 'exit', set: 2 }],
      },
      'standup-scene': {
        play: { alternates: ['pack:ff-standup-scene', 'pack:ff-standup-implied'] }, kind: 'exit', join: 'any',
        links: [{ because: 'ask', on: 'seedFact(stance) == 3' }],
        leaves: [{ fact: 'exit', set: 3 }],
      },
      'stay-out': {
        play: 'pack:ff-stay-out', kind: 'exit', join: 'any',
        links: [{ because: 'ask', on: { response: 'ask', is: ['decline'] } }],
        leaves: [{ fact: 'exit', set: 4 }],
      },
    },
    end: 'seedFact(exit) > 0',
    unattended: { after: { clock: 'game', s: R2_LAPSE }, outcome: [{ fact: 'exit', set: 5 }] },
    closing: 'pack:ff-closing',
    ...over,
  } as SeedInput;
}

export function r2Fragments(): Fragment[] {
  const beat = (id: string, extra: Partial<Fragment> = {}): Fragment => ({
    id, level: 'exchange', roles: ['stallholder', 'collector'], salience: 'foreground', forms: { standard: `pack:t-${id}` }, channels: ['message'], ...extra,
  });
  return [
    {
      ...beat('ff-ask'),
      offer: {
        stakes: [{ bearer: 'stallholder', what: 'the stall' }],
        actions: [
          { id: 'pay', stance: 'help', foresight: 'pack:t-fore-pay', writes: [{ fact: 'stance', set: 1, persist: 'lasting' }] },
          { id: 'broker', stance: 'bargain', foresight: 'pack:t-fore-broker', writes: [{ fact: 'stance', set: 2, persist: 'lasting' }] },
          { id: 'standup', stance: 'oppose', foresight: 'pack:t-fore-standup', writes: [{ fact: 'stance', set: 3, persist: 'lasting' }] },
        ],
        nullPath: { id: 'not-now', content: 'pack:t-notnow' },
        lapse: { after: { clock: 'play', s: 1800 }, then: 'reoffer' },
        // `decline` writes nothing: the `stay-out` exit reads the response (the way R1's exits do)
        decline: [{ id: 'decline' }],
        choice: 'consequential',
      },
    },
    beat('ff-paid-known', { applies: stallsTrust() }),
    beat('ff-paid-plain', { applies: { not: stallsTrust() } }),
    beat('ff-broker-heard', { applies: { not: marketHot() } }),
    beat('ff-broker-rebuffed', { applies: marketHot() }),
    beat('ff-standup-scene', { authored: 'human', implied: 'pack:ff-standup-implied', applies: { not: crackdownOn() } }),
    beat('ff-standup-implied', { applies: crackdownOn() }),
    beat('ff-stay-out'),
  ];
}

export function r2Texts(): TextUnit[] {
  return [
    text('t-ff-ask', '{stallholder.name} messages you: {collector.name} was at the stall again for the Friday fee the Claws collect, and I am short. Can you do something about it?', { voiceClass: 'npc' }),
    text('t-fore-pay', 'Cover what is owed.'),
    text('t-fore-broker', 'Offer to speak to {collector.name} for them.'),
    text('t-fore-standup', 'Tell {collector.name} the stalls are done paying.'),
    text('t-notnow', 'Another time.'),
    text('t-ff-paid-known', '{stallholder.name} counted the notes twice and said nothing, then pressed a skewer into your hand. The other stalls have noticed who looks after people here.', { voiceClass: 'narrator' }),
    text('t-ff-paid-plain', '{stallholder.name} took the money, relieved and a little ashamed. {collector.name} will be back next Friday.', { voiceClass: 'narrator' }),
    text('t-ff-broker-heard', '{collector.name} listened, shrugged, and settled for half. {stallholder.name} will take the smaller fee.', { voiceClass: 'narrator' }),
    text('t-ff-broker-rebuffed', '{collector.name} did not want to hear it. The market is on edge this week, and the Claws are not bargaining.', { voiceClass: 'narrator' }),
    text('t-ff-standup-scene', 'A scene written by a person, standing in for the real confrontation at the stall.', { authored: 'human', author: 'Stand-in Author' }),
    text('t-ff-standup-implied', 'You told {collector.name} to leave. They looked at you for a long moment before they went.', { voiceClass: 'narrator' }),
    text('t-ff-stay-out', '{stallholder.name} nodded, as if they had expected nothing else, and went back to the counter.', { voiceClass: 'narrator' }),
    text('ff-closing', 'That Friday is over.', { voiceClass: 'narrator' }),
    text('ff-coda', 'The stalls opened and closed the way they always do, and the fee was paid or it was not.', { channels: ['message'], voiceClass: 'narrator' }),
  ];
}

export function r2Pack(over: Partial<Pack> = {}, seedOver: Partial<SeedInput> = {}): Pack {
  return { id: R2_PACK, version: 1, seeds: [r2Seed(seedOver) as Seed], fragments: r2Fragments(), texts: r2Texts(), authors: ['Stand-in Author'], ...over };
}
