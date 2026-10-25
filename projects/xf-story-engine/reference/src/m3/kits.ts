// The builder of M3 run 2's offer kits: a compact description of a kit (who it is about, how the account is told, what is asked, what the
// ask is worth, what each of V's answers leads to) becomes a sowable seed in S2's core offer language, with its fragments and words.
//
// A kit is written as parts, not as sentences. The account of the incident (the opener) and the request (the ask) each have several wordings.
// A third part, the clause, says what the request is worth and what is at stake, and each of its wordings may be conditioned on the world: who
// the people are, whether they know one another, what the district's prices are, how the stalls stand with V, how hard the fee norm is pressed,
// whether the police are pressing the district. The builder writes a fragment for each opener with two of the asks and each clause. A beat's
// alternates are then chosen by S2's rule: of the fragments whose `applies` holds, the most specific (most atoms) win, and the draw picks
// among them. So the same kit reads differently in different situations, and the world, not a price list, sets the stakes and the reward.
// Only the clause is conditioned: S2's rule keeps the most specific wording, so a conditioned opener would shut out its generic siblings.
//
// The builder adds no engine rule. It writes pack data: seeds, fragments and texts, the same shape R2 has.

import type { SiftPattern, Sowable } from '../procedural/types.ts';
import type { Fragment, Pack, Pred, Role, Seed, TextUnit } from '../seeding/types.ts';

export const OFFER_PACK = 'xf.m3b.offers';
const DISTRICT = 'wat_kab';

// ---- world conditions ----

/** Conditions on the world a wording may ask for. Two conditions of one group exclude each other. */
export type CondId =
  | 'known' | 'strangers'
  | 'priceHigh' | 'priceLow'
  | 'trusted' | 'unknownV'
  | 'feePressed' | 'feeQuiet'
  | 'crackdown'
  | 'senderVendor' | 'senderShop' | 'senderOther'
  | 'subjectGang' | 'subjectCivilian' | 'subjectClaws';

const GROUP: Record<CondId, string> = {
  known: 'tie', strangers: 'tie', priceHigh: 'price', priceLow: 'price', trusted: 'standing', unknownV: 'standing', feePressed: 'fee', feeQuiet: 'fee', crackdown: 'regime',
  senderVendor: 'senderRole', senderShop: 'senderRole', senderOther: 'senderRole', subjectGang: 'subjectClass', subjectCivilian: 'subjectClass', subjectClaws: 'subjectClass',
};

interface Ctx { subject: string; other: string; sender: string }

function pred(c: CondId, ctx: Ctx): Pred {
  const role = (r: string, path: string, arg: string | number): Pred => ({ role: r, p: { path, op: 'eq', arg } });
  switch (c) {
    case 'known': return { social: { tied: { a: ctx.subject, b: ctx.other, type: 'xf:tie' } }, is: ['yes'] };
    case 'strangers': return { social: { tied: { a: ctx.subject, b: ctx.other, type: 'xf:tie' } }, is: ['no'] };
    case 'priceHigh': return { city: { priceLevel: { district: DISTRICT } }, is: ['high', 'extreme'] };
    case 'priceLow': return { city: { priceLevel: { district: DISTRICT } }, is: ['low'] };
    case 'trusted': return { social: { label: { audience: 'stalls', subject: 'v', axis: 'decent' } }, is: ['mid', 'high'] };
    case 'unknownV': return { social: { label: { audience: 'stalls', subject: 'v', axis: 'decent' } }, is: ['unknown', 'low'] };
    case 'feePressed': return { social: { normGap: { norm: 'fee', scope: DISTRICT } }, is: ['gap', 'wide'] };
    case 'feeQuiet': return { social: { normGap: { norm: 'fee', scope: DISTRICT } }, is: ['aligned'] };
    case 'crackdown': return { city: { regimeIs: { scope: DISTRICT, kind: 'crackdown' } }, is: ['yes'] };
    case 'senderVendor': return role(ctx.sender, 'role', 'vendor');
    case 'senderShop': return role(ctx.sender, 'role', 'shopkeeper');
    case 'senderOther': return { not: { any: [role(ctx.sender, 'role', 'vendor'), role(ctx.sender, 'role', 'shopkeeper')] } };
    case 'subjectClaws': return role(ctx.subject, 'affc', 2);
    case 'subjectGang': return role(ctx.subject, 'role', 'gang');
    case 'subjectCivilian': return { not: role(ctx.subject, 'role', 'gang') };
  }
}

/** One wording of a part, and the conditions it asks the world for. */
export interface Part { t: string; when?: CondId[] }

export interface ActionDef {
  id: string;
  stance: 'help' | 'bargain' | 'oppose' | 'refuse' | 'ignore';
  /** What V is shown the action as. */
  foresight: string;
  /** What it costs, and whom (S2 2.9): each action's own, so that no two cost the same. */
  cost: { bearer: 'v' | 'third' | string; what: string; when: 'now' | 'later'; shown: 'trace' | 'named' | 'quiet' };
  /** How it turns out: the first wording whose conditions hold, most specific first, by S2's alternates rule. */
  outcomes: Part[];
}

export interface OfferKit {
  /** The template's local name; the template id is `${OFFER_PACK}:${id}`. */
  id: string;
  tags: string[];
  /** The person roles the pattern binds: `subject` and `other` always; `extra` roles are cast by layer 2. */
  roles: { subject: Role; other: Role; [extra: string]: Role };
  /** The role that speaks the offer (the message comes from them). */
  sender: string;
  /** The stake of the offer, as the overview of S2 2.9 names it. */
  stakeOf: string;
  opener: Part[];
  ask: Part[];
  /** What the request is worth and what is at stake, by the state of the world; wordings with no condition are the fallback. */
  clause: Part[];
  actions: [ActionDef, ActionDef, ActionDef];
  declined: Part[];
  /** What the world does without V, after three game days. */
  settles: string;
  closing: string;
  notNow: string;
  /** The sift pattern this kit tells: its stages and how its roles bind. */
  pattern: Pick<SiftPattern, 'roles' | 'stages' | 'within' | 'once' | 'tags'> & { binds: Record<string, string> };
  weight?: number;
}

const text = (id: string, t: string, voiceClass: TextUnit['voiceClass']): TextUnit => ({ id, text: t, origin: 'authored', voiceClass });

/** The pairs of opener and ask a kit writes: each opener with `per` of the asks, taken in turn, so that every ask is used. */
export function pairings(openers: number, asks: number, per = 2): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < openers; i++) for (let j = 0; j < Math.min(per, asks); j++) out.push([i, (i + j) % asks]);
  return out;
}

/** Every combination of one wording from each part that the world can make true at once (no two conditions of one group). */
function combos(parts: Part[][]): Array<{ idx: number[]; t: string; when: CondId[] }> {
  const out: Array<{ idx: number[]; t: string; when: CondId[] }> = [];
  const walk = (i: number, idx: number[], when: CondId[]): void => {
    if (i === parts.length) {
      out.push({ idx, t: idx.map((x, p) => parts[p]![x]!.t).filter((x) => x.length > 0).join(' '), when });
      return;
    }
    parts[i]!.forEach((w, x) => {
      const next = [...when];
      for (const c of w.when ?? []) {
        if (next.includes(c)) continue;
        if (next.some((o) => GROUP[o] === GROUP[c])) return;
        next.push(c);
      }
      walk(i + 1, [...idx, x], next);
    });
  };
  walk(0, [], []);
  return out;
}

const allOf = (cs: CondId[], ctx: Ctx): Pred | undefined => (cs.length === 0 ? undefined : cs.length === 1 ? pred(cs[0]!, ctx) : { all: cs.map((c) => pred(c, ctx)) });

const HAS_NAME = { path: 'name', op: 'in', arg: { r: 'all' } } as const;

export function kitPieces(k: OfferKit): { seed: Seed; fragments: Fragment[]; texts: TextUnit[] } {
  const ctx: Ctx = { subject: 'subject', other: 'other', sender: k.sender };
  const fragments: Fragment[] = [];
  const texts: TextUnit[] = [];
  const roleKeys = Object.keys(k.roles);
  const sid = k.id;

  // the ask: every combination of opener, ask and stake
  const askIds: string[] = [];
  const actionIds = k.actions.map((a) => a.id);
  const offer: NonNullable<Fragment['offer']> = {
    stakes: [{ bearer: k.sender, what: k.stakeOf }],
    actions: k.actions.map((a, i) => ({
      id: a.id, stance: a.stance, foresight: `pack:t-${sid}-fore-${a.id}`,
      writes: [{ fact: 'stance', set: i + 1, persist: 'lasting' as const }],
      costs: [a.cost as never],
    })),
    nullPath: { id: 'not-now', content: `pack:t-${sid}-notnow` },
    lapse: { after: { clock: 'play', s: 1800 }, then: 'reoffer' },
    decline: [{ id: 'decline' }],
    choice: 'consequential',
  };
  const pairs = pairings(k.opener.length, k.ask.length);
  // a pair is one wording of the account and one of the request, joined; the clause is chosen against the world
  const joined: Part[] = pairs.map(([i, j]) => ({ t: `${k.opener[i]!.t} ${k.ask[j]!.t}` }));
  combos([joined, k.clause]).forEach((c, n) => {
    const id = `${sid}-ask-${n}`;
    const applies = allOf(c.when, ctx);
    fragments.push({ id, level: 'exchange', roles: roleKeys, salience: 'foreground', forms: { standard: `pack:t-${id}` }, channels: ['message'], offer, ...(applies ? { applies } : {}) });
    texts.push(text(`t-${id}`, c.t, 'npc'));
    askIds.push(`pack:${id}`);
  });
  for (const a of k.actions) texts.push(text(`t-${sid}-fore-${a.id}`, a.foresight, 'template'));
  texts.push(text(`t-${sid}-notnow`, k.notNow, 'template'));
  texts.push(text(`${sid}-closing`, k.closing, 'narrator'));

  // the exits: one beat for each answer, each with outcomes conditioned on the world
  const exitRefs: Record<string, string[]> = {};
  const exits: Array<[string, Part[]]> = [...k.actions.map((a): [string, Part[]] => [a.id, a.outcomes]), ['decline', k.declined]];
  for (const [key, parts] of exits) {
    exitRefs[key] = [];
    parts.forEach((p, n) => {
      const id = `${sid}-out-${key}-${n}`;
      const applies = allOf(p.when ?? [], ctx);
      fragments.push({ id, level: 'exchange', roles: roleKeys, salience: 'foreground', forms: { standard: `pack:t-${id}` }, channels: ['message'], ...(applies ? { applies } : {}) });
      texts.push(text(`t-${id}`, p.t, 'narrator'));
      exitRefs[key]!.push(`pack:${id}`);
    });
  }

  const roles: Record<string, Role> = {};
  for (const [key, r] of Object.entries(k.roles)) roles[key] = { ...r, textAttrs: ['name'], must: [...(r.must ?? []), HAS_NAME] };

  const beats: Seed['beats'] = {
    ask: { play: { alternates: askIds }, kind: 'decision', decision: { atStake: k.sender, stances: ['help', 'bargain', 'oppose', 'refuse'] } },
  };
  k.actions.forEach((a, i) => {
    beats[`x-${a.id}`] = {
      play: { alternates: exitRefs[a.id]! }, kind: 'exit', join: 'any',
      links: [{ because: 'ask', on: `seedFact(stance) == ${i + 1}` }],
      leaves: [{ fact: 'exit', set: i + 1 }],
    };
  });
  beats['x-decline'] = {
    play: { alternates: exitRefs.decline! }, kind: 'exit', join: 'any',
    links: [{ because: 'ask', on: { response: 'ask', is: ['decline'] } }],
    leaves: [{ fact: 'exit', set: 4 }],
  };

  const sowable: Sowable = { serves: ['offer'], firstClass: 2, ...(k.weight !== undefined ? { weight: k.weight } : {}), tags: k.tags };
  const seed = {
    id: `${OFFER_PACK}:${sid}`, version: 1, maturity: 'ready', level: 'encounter', stakeScale: 'person',
    turns: [{ level: 'step', who: k.sender, kind: 'standing', what: 'seedFact(stance) > 0' }],
    purpose: { tags: ['offer', ...k.tags], sentence: 'Someone asks the player character for something, because of what happened to people near them, and says what it is worth.' },
    context: 'yes', intent: { prohibitions: [], tone: ['grounded', 'wary'] },
    roles,
    facts: {
      stance: { route: { consumers: k.actions.map((a) => `x-${a.id}`) }, initial: 0 },
      exit: { route: { consumers: ['end'] }, initial: 0 },
    },
    windows: [{ id: 'w', opens: 'q001_done == 1', closes: 'q115_point_of_no_return == 1', onClose: 'withdraw' }],
    start: ['ask'], beats,
    end: 'seedFact(exit) > 0',
    unattended: { after: { clock: 'game', s: 3 * 86_400 }, outcome: [{ fact: 'exit', set: 5 }] },
    closing: `pack:${sid}-closing`,
    sow: 'no', sowable,
  } as unknown as Seed;
  void actionIds;
  return { seed, fragments, texts };
}

export function offerPack(kits: OfferKit[]): Pack {
  const pieces = kits.map(kitPieces);
  return {
    id: OFFER_PACK, version: 1, seeds: pieces.map((p) => p.seed), fragments: pieces.flatMap((p) => p.fragments),
    texts: pieces.flatMap((p) => p.texts), authors: [], source: 'procedural',
  };
}

/** The sift pattern of a kit: the telling is an offer over the kit's own template. */
export function offerPattern(k: OfferKit): SiftPattern {
  return {
    id: `xf.m3b:${k.id}`, version: 1, roles: k.pattern.roles, stages: k.pattern.stages, ...(k.pattern.within !== undefined ? { within: k.pattern.within } : {}),
    ...(k.pattern.once ? { once: k.pattern.once } : {}), tags: k.pattern.tags,
    telling: { form: 'offer', kit: `${OFFER_PACK}:${k.id}`, binds: k.pattern.binds },
  };
}
