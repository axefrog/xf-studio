// Profiles (S2 section 2.10): a pack-provided partial seed with parameters. The first implementation has one,
// the relationship ladder (Appendix A), expanded entirely into core constructs.
//
// Expansion generates the parts from the parameters; the seed's own fields merge over them, field by field,
// and win except where the profile marks a part fixed (L-02). Every generated part records the parameter it
// came from, so a finding can point at what the author wrote (S2 section 11.1, source maps).

import { canonicalEqual } from '../canon.ts';
import type { Beat, ContentRef, Duration, EventPattern, FactKey, Finding, Pred, PredInput, SeedInput } from './types.ts';

export interface LadderParams {
  with: string;
  rungs: string[];
  offers: Record<string, { offer: string; notNow: ContentRef }>;
  exits: { decline: ContentRef; stay: ContentRef; lapse: ContentRef };
  pacing: { acts: EventPattern[]; perRung: number };
  lapseAfter: Duration;
  absence?: { after: Duration; reunion: string };
  intimate?: { scene: string; fade: string; contentTag: string };
  boundaries?: Array<{ fact: FactKey; set: number; by: string }>;
  reoffers?: number;
}

export const LADDER_ID = 'relationship-ladder';

export interface Expansion {
  seed: SeedInput;
  findings: Finding[];
  /** Generated part path → the parameter it came from. */
  sourceMap: Record<string, string>;
  /** The parts the profile fixed (a seed may not change them). */
  fixed: string[];
}

const err = (code: string, message: string, at?: string): Finding => {
  const f: Finding = { code, level: 'error', message };
  if (at) f.at = at;
  return f;
};

/** The names of the beats the ladder generates for these parameters, for the lint's "fixed parts" list. */
export function ladderBeatKeys(p: LadderParams): string[] {
  const n = p.rungs.length;
  const out: string[] = [];
  for (let i = 1; i < n; i++) out.push(`offer-${i}`);
  out.push('exit-decline', 'exit-stay', 'exit-lapse');
  if (p.intimate) out.push('intimate');
  return out;
}

export function expandProfile(seed: SeedInput): Expansion {
  const findings: Finding[] = [];
  if (!seed.profile) return { seed, findings, sourceMap: {}, fixed: [] };
  if (seed.profile.id !== LADDER_ID) {
    findings.push(err('profile', `The profile "${seed.profile.id}" is not supported yet. The first version has one profile: "${LADDER_ID}".`, 'profile.id'));
    return { seed, findings, sourceMap: {}, fixed: [] };
  }
  return expandLadder(seed, seed.profile.params as unknown as LadderParams);
}

function expandLadder(seed: SeedInput, p: LadderParams): Expansion {
  const findings: Finding[] = [];
  const sourceMap: Record<string, string> = {};
  const fixed: string[] = [];
  const n = p.rungs.length;
  const bad = (m: string, at: string): void => { findings.push(err('profile', m, at)); };
  if (n < 2) bad('A relationship ladder needs at least two rungs.', 'profile.params.rungs');
  const role = seed.roles?.[p.with];
  if (!role) bad(`The ladder is with the role "${p.with}", which the seed does not declare.`, 'profile.params.with');
  else {
    const b = role.identity;
    const hasIdentity = b !== undefined && !(typeof b === 'object' && b !== null && 'open' in (b as object));
    if (!hasIdentity) bad(`The ladder's role "${p.with}" needs a fixed or preferred identity: a ladder is with a particular person.`, 'profile.params.with');
  }
  for (let i = 1; i < n; i++) {
    if (!p.offers?.[p.rungs[i]!]) bad(`The ladder has no offer for the rung "${p.rungs[i]}".`, `profile.params.offers.${p.rungs[i]}`);
  }
  for (const k of ['decline', 'stay', 'lapse'] as const) {
    const c = p.exits?.[k];
    if (c === undefined || (typeof c === 'object' && 'todo' in c)) {
      // L-10 reports it; the beat still needs something to play.
    }
  }
  if (findings.length > 0) return { seed, findings, sourceMap, fixed };

  const perRung = p.pacing?.perRung ?? 1;
  const withRole = p.with;
  const acts = (p.pacing?.acts ?? []).map((a): EventPattern => ({ participant: withRole, ...a }));
  const countSince = (since: { beat: string }, atLeast: number, op: 'ge' | 'eq' = 'ge'): Pred => {
    const parts: Pred[] = acts.map((a) => ({ count: a, since, op, value: atLeast }));
    return parts.length === 1 ? parts[0]! : { any: parts };
  };
  const exitKey = 'exit';
  const rungKey = 'rung';
  const reoffers = p.reoffers ?? 2;

  const beats: Record<string, Beat> = {};
  const facts: NonNullable<SeedInput['facts']> = {};
  const consumersRung = new Set<string>(['end']);
  const consumersExit = new Set<string>(['exit-decline', 'exit-stay', 'exit-lapse', 'end']);

  // Offer beats.
  for (let i = 1; i < n; i++) {
    const key = `offer-${i}`;
    const offer = p.offers[p.rungs[i]!]!;
    const beat: Beat = { play: offer.offer };
    const links: NonNullable<Beat['links']> = [];
    if (i > 1) {
      const prev = `offer-${i - 1}`;
      const on: Pred = { all: [{ seedFact: rungKey, op: 'eq', value: i - 1 }, countSince({ beat: prev }, perRung)] };
      links.push({ because: prev, on: on as PredInput });
      consumersRung.add(key);
    }
    if (links.length > 0) beat.links = links;
    beat.reoffer = { when: countSince({ beat: key }, perRung) as PredInput, max: reoffers + 1 };
    beats[key] = beat;
    sourceMap[`beats.${key}`] = `profile.params.offers.${p.rungs[i]}`;
  }
  if (p.intimate) consumersRung.add('intimate');

  // Exit beats: decline and stay follow the answers; lapse follows the clock (its fragment's `needs` say when).
  const offerKeys = Array.from({ length: n - 1 }, (_, i) => `offer-${i + 1}`);
  const exitBeat = (which: 'decline' | 'stay' | 'lapse', value: number, others: string[]): Beat => {
    const content = p.exits[which];
    const beat: Beat = { kind: 'exit', play: typeof content === 'string' ? content : '', leaves: [{ fact: exitKey, set: value }] };
    const links: NonNullable<Beat['links']> = [];
    if (which !== 'lapse') {
      beat.join = 'any';
      for (const o of offerKeys) links.push({ because: o, on: { response: o, is: [which === 'decline' ? 'decline' : 'action:stay'] } as PredInput });
    }
    for (const o of others) links.push({ obstructedBy: o });
    beat.links = links;
    return beat;
  };
  beats['exit-decline'] = exitBeat('decline', 1, ['exit-stay', 'exit-lapse']);
  beats['exit-stay'] = exitBeat('stay', 2, ['exit-decline', 'exit-lapse']);
  beats['exit-lapse'] = exitBeat('lapse', 3, ['exit-decline', 'exit-stay']);
  for (const k of ['decline', 'stay', 'lapse']) sourceMap[`beats.exit-${k}`] = `profile.params.exits.${k}`;

  // The intimate beat: the top rung only.
  if (p.intimate) {
    beats.intimate = {
      play: { alternates: [p.intimate.scene, p.intimate.fade] },
      links: [{ because: `offer-${n - 1}`, on: { seedFact: rungKey, op: 'eq', value: n - 1 } as PredInput }],
    };
    sourceMap['beats.intimate'] = 'profile.params.intimate';
  }

  // Facts.
  facts[rungKey] = { route: { consumers: [...consumersRung].sort() }, initial: 0 };
  facts[exitKey] = { route: { consumers: [...consumersExit].sort() }, initial: 0 };
  sourceMap['facts.rung'] = 'profile.params.rungs';
  sourceMap['facts.exit'] = 'profile.params.exits';
  for (const b of p.boundaries ?? []) {
    facts[b.fact] = { authoredOnly: true, initial: 0 };
    sourceMap[`facts.${b.fact}`] = 'profile.params.boundaries';
  }

  // Boundaries: each is set by its authored beat.
  const own = { ...(seed.beats ?? {}) };
  for (const b of p.boundaries ?? []) {
    const target = own[b.by];
    if (!target) {
      findings.push(err('profile', `The boundary "${b.fact}" is set by the beat "${b.by}", which the seed does not have.`, 'profile.params.boundaries'));
      continue;
    }
    own[b.by] = { ...target, leaves: [...(target.leaves ?? []), { fact: b.fact, set: b.set }] };
  }

  // End: the top rung and its beats are final, or an exit has been taken.
  const top: Pred = p.intimate
    ? { all: [{ seedFact: rungKey, op: 'eq', value: n - 1 }, { beat: 'intimate', state: ['done', 'skipped'] }] }
    : { all: [{ seedFact: rungKey, op: 'eq', value: n - 1 }, { beat: `offer-${n - 1}`, state: ['done'] }] };
  // An exit ends the ladder once its content is done (A.2 step 7: "any exit beat is `done`"), not when the answer is written:
  // otherwise a decline would end the seed before its exit could play (SPEC-NOTES 59).
  const exitDone: Pred = { any: ['exit-decline', 'exit-stay', 'exit-lapse'].map((b) => ({ beat: b, state: ['done'] })) as Pred[] };
  const end: Pred = { any: [top, { all: [{ seedFact: exitKey, op: 'gt', value: 0 }, exitDone] }] };
  const unattended = { after: p.lapseAfter, outcome: [{ fact: exitKey, set: 3 }] };
  const turns = [{ level: 'concern' as const, who: withRole, kind: 'tie' as const, what: { seedFact: rungKey, op: 'gt', value: 0 } as PredInput }];
  const start = ['offer-1'];
  sourceMap.end = 'profile.params.rungs';
  sourceMap.unattended = 'profile.params.lapseAfter';
  sourceMap.start = 'profile.params.rungs';

  // Merge: the seed's own fields win, except the parts the profile fixed (L-02).
  const merged: SeedInput = { ...seed };
  const conflict = (path: string, own: unknown, gen: unknown): void => {
    if (own !== undefined && !canonicalEqual(own, gen)) {
      findings.push(err('L-02', `The seed changes "${path}", which the ${LADDER_ID} profile fixes. Change the profile's parameters instead.`, path));
    }
  };
  for (const [k, gen] of Object.entries(beats)) {
    fixed.push(`beats.${k}`);
    conflict(`beats.${k}`, seed.beats?.[k], gen);
  }
  for (const [k, gen] of Object.entries(facts)) {
    fixed.push(`facts.${k}`);
    conflict(`facts.${k}`, seed.facts?.[k], gen);
  }
  for (const [k, gen] of [['start', start], ['end', end], ['unattended', unattended]] as const) {
    fixed.push(k);
    conflict(k, seed[k], gen);
  }
  merged.beats = { ...own, ...beats };
  merged.facts = { ...(seed.facts ?? {}), ...facts };
  merged.start = start;
  merged.end = end as PredInput;
  merged.unattended = unattended;
  merged.turns = seed.turns ?? turns;
  return { seed: merged, findings, sourceMap, fixed };
}
