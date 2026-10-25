// The engine's hook material for M3: sift patterns over what S1 writes into Kabuki's record, and the kit seeds layer 3 sows
// from a completed pattern. A hook is a telling of something that happened to named residents, with the cause in it.
//
// Every kit says only what its pattern guarantees: the people are bound by the match and the kit's `must` terms repeat what the
// match fixes (a Tyger Claws collector, a person who has a name), so nothing in the words is a claim the world did not make.
// No kit names a main-story character. Words are plain stand-ins written for the run, in three voices: stall talk, a news line,
// and a message from a contact.

import type { SiftPattern, Sowable } from '../procedural/types.ts';
import type { Fragment, Pack, Seed, TextUnit } from '../seeding/types.ts';

export const HOOK_PACK = 'xf.m3.hooks';

const HAS_NAME = { path: 'name', op: 'in', arg: { r: 'all' } } as const;
const CLAWS = { path: 'affc', op: 'eq', arg: 2 } as const;
const VENDOR = { path: 'role', op: 'eq', arg: 'vendor' } as const;

type Must = NonNullable<Seed['roles'][string]['must']>[number];
interface Voice { voice: 'stall talk' | 'news line' | 'contact message'; text: string }
interface KitDef {
  id: string;
  form: 'rumour' | 'recap' | 'sighting';
  subject: Must[];
  /** The second person; absent for a kit that tells about one person. */
  other?: Must[];
  tags: string[];
  /** The ways the same account may be told: the kit's fragment is drawn from these. */
  voices: Voice[];
}

const KITS: KitDef[] = [
  // a collector's demand, answered by the police
  { id: 'fee-answered', form: 'rumour', tags: ['fee', 'police'], subject: [CLAWS], other: [VENDOR], voices: [
    { voice: 'stall talk', text: '{other.name} says {subject.name}, the Claws collector, leaned on the stall for the Friday fee, and then the NCPD turned up for {subject.name} before the money changed hands. Nobody at the market talks about much else.' },
    { voice: 'news line', text: 'Watson, Kabuki: NCPD detained a Tyger Claws collector, {subject.name}, after a market stallholder, {other.name}, reported a demand for payment at the stall.' },
    { voice: 'contact message', text: 'Heard {subject.name} got picked up squeezing {other.name} at the market. The Claws will want that fee from somebody this Friday. Keep your head down.' },
  ] },
  // a theft, answered
  { id: 'theft-answered', form: 'rumour', tags: ['theft', 'police'], subject: [], other: [], voices: [
    { voice: 'stall talk', text: '{other.name} had a bag lifted in the Kabuki crowd. {subject.name} was the one who took it, people say, and a patrol was on {subject.name} within the hour.' },
    { voice: 'news line', text: 'Kabuki: a patrol took {subject.name} into custody after a theft from {other.name}. The goods have not been recovered.' },
    { voice: 'contact message', text: '{other.name} got robbed by {subject.name} down in Kabuki and the cops picked {subject.name} up. If you see {other.name}, they would like to hear about it.' },
  ] },
  // a beating
  { id: 'beating', form: 'rumour', tags: ['assault'], subject: [], other: [], voices: [
    { voice: 'stall talk', text: '{subject.name} put {other.name} on the pavement outside the market. Nobody saw why, and nobody is saying.' },
    { voice: 'news line', text: 'Kabuki: {other.name} was treated for injuries after an assault. Witnesses name {subject.name}. No arrest has been made.' },
    { voice: 'contact message', text: 'You know {other.name}? {subject.name} beat them up in Kabuki yesterday. Somebody should check on them.' },
    { voice: 'stall talk', text: 'Word at the stalls is that {subject.name} hit {other.name} hard enough to need the clinic. The rest is guesswork.' },
    { voice: 'contact message', text: 'Heard it from three people already: {subject.name} went for {other.name} in the street. Thought you should know before it gets bigger.' },
  ] },
  // a theft
  { id: 'theft', form: 'rumour', tags: ['theft'], subject: [], other: [], voices: [
    { voice: 'stall talk', text: '{other.name} says {subject.name} lifted a bag in the Kabuki crowd and was gone before anyone moved.' },
    { voice: 'news line', text: 'Kabuki: a theft was reported by {other.name}. {subject.name} is named as the person responsible. The goods have not been recovered.' },
    { voice: 'contact message', text: '{subject.name} robbed {other.name} in the Kabuki crowd. If you see either of them, you will know why.' },
    { voice: 'stall talk', text: 'Watch your pockets: {subject.name} is working the crowd again, and {other.name} found out first.' },
  ] },
  // an accident
  { id: 'accident', form: 'sighting', tags: ['accident'], subject: [], voices: [
    { voice: 'stall talk', text: '{subject.name} was hurt in an accident in Kabuki; the street crowded round for a minute and then moved on.' },
    { voice: 'news line', text: 'Kabuki: {subject.name} was taken for treatment after an accident. No one else was injured.' },
  ] },
  // a police sweep
  { id: 'sweep', form: 'sighting', tags: ['police'], subject: [], voices: [
    { voice: 'stall talk', text: 'An NCPD patrol pulled {subject.name} off the street in Kabuki. Nobody stopped to watch.' },
    { voice: 'news line', text: 'Kabuki: police detained {subject.name} during a street sweep. No charge has been announced.' },
  ] },
  // a demand seen
  { id: 'demand', form: 'sighting', tags: ['fee'], subject: [CLAWS], other: [VENDOR], voices: [
    { voice: 'stall talk', text: '{subject.name} was at the stalls again, one hand out, and {other.name} was counting what was in the till.' },
    { voice: 'news line', text: 'Kabuki market: a Tyger Claws collector, {subject.name}, was seen taking payment from {other.name}, a stallholder, as on every Friday.' },
  ] },
];

const frag = (k: KitDef, i: number): string => `f-${k.id}-${i}`;

export function kitSeed(k: KitDef): Seed {
  const personRole = (must: unknown[], also: unknown[] = []) => ({ kind: 'core:person', onUnfilled: ['wait'], textAttrs: ['name'], must: [...must, ...also, HAS_NAME] });
  return {
    id: `${HOOK_PACK}:${k.id}`, version: 1, level: 'glance', stakeScale: 'person', turns: [], maturity: 'ready',
    purpose: { tags: ['report', ...k.tags], sentence: 'An account of something that happened in the district, told in the words of whoever tells it.' },
    context: 'yes', intent: { prohibitions: [], tone: ['grounded'] },
    roles: Object.fromEntries([['subject', personRole(k.subject)], ...(k.other ? [['other', personRole(k.other)]] : [])]) as Seed['roles'],
    windows: [{ id: 'w', opens: 'yes', onClose: 'withdraw' }],
    start: ['tell'], beats: { tell: { kind: 'texture', play: { alternates: k.voices.map((_, i) => `pack:${frag(k, i)}`) } } }, end: 'beat(tell) in {done}',
    unattended: { after: { clock: 'game', s: 3600 }, outcome: [] },
    sow: 'no', sowable: { serves: [k.form], firstClass: 0 } satisfies Sowable,
  } as Seed;
}

export function kitFragments(): Fragment[] {
  return KITS.flatMap((k) => k.voices.map((_, i): Fragment => ({
    id: frag(k, i), level: 'phrase', roles: k.other ? ['subject', 'other'] : ['subject'], salience: 'background', forms: { standard: `pack:t-${k.id}-${i}` }, channels: ['trace'],
  })));
}

export function kitTexts(): TextUnit[] {
  return [
    ...KITS.flatMap((k) => k.voices.map((v, i): TextUnit => ({ id: `t-${k.id}-${i}`, text: v.text, origin: 'authored', voiceClass: v.voice === 'news line' ? 'news' : 'npc' }))),
    { id: 'closing', text: 'The talk moved on.', origin: 'authored' },
  ];
}

export function hookPack(): Pack {
  return { id: HOOK_PACK, version: 1, seeds: KITS.map(kitSeed), fragments: kitFragments(), texts: kitTexts(), authors: [], source: 'procedural' };
}

const person = { kind: 'core:person' } as const;
const two = { '?a': person, '?v': person };
const pair = (kind: string, a: string, v: string, effects?: SiftPattern['stages'][number]['effects']): SiftPattern['stages'][number] => ({
  kind, who: [{ role: a, as: '?a' }, { role: v, as: '?v' }], ...(effects ? { effects } : {}),
});

/** The sift patterns of the run: each names the kits that may tell it. */
export function hookPatterns(): SiftPattern[] {
  const answered = (id: string, first: string, effect: 'take' | 'harm', tags: string[]): SiftPattern => ({
    id: `xf.m3:${id}`, version: 1, roles: two,
    stages: [pair(first, 'aggressor', 'victim', [{ on: '?v', effect }]), { kind: 'police-action', who: [{ role: 'target', as: '?a' }, { role: 'victim', as: '?v' }] }],
    within: 172_800, once: ['?a', '?v'], tags,
    telling: { form: 'rumour', kit: `${HOOK_PACK}:${id}`, binds: { subject: '?a', other: '?v' } },
  });
  const alone = (id: string, kind: string, effect: 'take' | 'harm', form: 'rumour' | 'sighting', tags: string[]): SiftPattern => ({
    id: `xf.m3:${id}`, version: 1, roles: two, stages: [pair(kind, 'aggressor', 'victim', [{ on: '?v', effect }])], within: 3600, once: ['?a', '?v'], tags,
    telling: { form, kit: `${HOOK_PACK}:${id}`, binds: { subject: '?a', other: '?v' } },
  });
  const one = (id: string, kind: string, role: string, effect: 'harm' | 'take', tags: string[]): SiftPattern => ({
    id: `xf.m3:${id}`, version: 1, roles: { '?s': person }, stages: [{ kind, who: [{ role, as: '?s' }], effects: [{ on: '?s', effect }] }], within: 3600, once: ['?s'], tags,
    telling: { form: 'sighting', kit: `${HOOK_PACK}:${id}`, binds: { subject: '?s' } },
  });
  return [
    answered('fee-answered', 'shakedown', 'take', ['fee', 'police']),
    answered('theft-answered', 'theft', 'take', ['theft', 'police']),
    alone('beating', 'assault', 'harm', 'rumour', ['assault']),
    alone('theft', 'theft', 'take', 'rumour', ['theft']),
    alone('demand', 'shakedown', 'take', 'sighting', ['fee']),
    one('accident', 'accident', 'victim', 'harm', ['accident']),
    one('sweep', 'police-action', 'target', 'take', ['police']),
  ];
}
