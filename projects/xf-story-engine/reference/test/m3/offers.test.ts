// M3 run 2: the offer kits. Each is a sowable seed in S2's core offer language (a decision with actions that have stances and costs, a decline, a
// null path, a lapse, and a consequence for each answer that something reads), and each is told by a sift pattern of S1's record. These tests
// check that they compile lint-clean at `ready`, that their patterns load, that the words are made of the people the pattern binds and
// nothing else, that the world picks the wording (the same kit reads differently in different situations), and that every answer plays.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { H, s as hs } from '../../src/id.ts';
import { Run, policies } from '../../src/m3/driver.ts';
import { OFFER_PACK, pairings } from '../../src/m3/kits.ts';
import { KITS, offerKitPack, offerPatterns } from '../../src/m3/offers.ts';
import { stateById } from '../../src/m3/states.ts';
import { buildWorld } from '../../src/m3/world.ts';
import { readSeedFact } from '../../src/seeding/eval.ts';
import { WIDE_NAMES } from '../../src/sim/names.ts';
import type { Id } from '../../src/types.ts';

setDefaultTimeout(300_000);

const pack = offerKitPack();
const names = (d: import('../../src/sim/data.ts').S1Data): void => { d.people.names = WIDE_NAMES; };

describe('the kits as data', () => {
  test('every kit compiles lint-clean at ready, and every pattern loads with no finding', () => {
    const w = buildWorld({ name: 'kits-lint', layer3: true, packs: [pack], patterns: offerPatterns(), s1: names });
    expect(w.findings).toEqual([]);
    for (const seed of pack.seeds) {
      expect(seed.maturity).toBe('ready');
      const out = w.l2.compile(OFFER_PACK, seed);
      expect(out.findings, seed.id).toEqual([]);
    }
  });

  test('each kit is sowable as an offer at encounter level: a first delivery on a message, three actions of their own, a decline and a null path', () => {
    for (const k of KITS) {
      const seed = pack.seeds.find((s) => s.id === `${OFFER_PACK}:${k.id}`)!;
      expect(seed.level).toBe('encounter');
      expect((seed.sowable as { serves: string[]; firstClass: number }).serves).toEqual(['offer']);
      expect((seed.sowable as { firstClass: number }).firstClass).toBe(2);
      expect(k.actions.length).toBe(3);
      // no two actions cost the same, and the stances are not all one (L-45; a choice that costs nothing differently is flavour)
      expect(new Set(k.actions.map((a) => JSON.stringify(a.cost))).size).toBe(3);
      expect(new Set(k.actions.map((a) => a.stance)).size).toBeGreaterThanOrEqual(2);
      // the answers lead somewhere: each action has outcomes, and the decline has its own
      for (const a of k.actions) expect(a.outcomes.length).toBeGreaterThanOrEqual(2);
      expect(k.declined.length).toBeGreaterThanOrEqual(1);
    }
    expect(KITS.length).toBeGreaterThanOrEqual(6);
  });

  test('the words name only the roles of the kit, and each kit has many wordings (not a handful of frames)', () => {
    for (const k of KITS) {
      const roles = new Set(Object.keys(k.roles));
      const texts = [...k.opener, ...k.ask, ...k.clause, ...k.actions.flatMap((a) => a.outcomes), ...k.declined].map((p) => p.t);
      for (const t of texts) for (const m of t.matchAll(/\{([a-z]+)\.name\}/g)) expect(roles.has(m[1]!), `${k.id}: ${m[1]}`).toBe(true);
      const frags = pack.fragments.filter((f) => f.id.startsWith(`${k.id}-ask-`));
      expect(frags.length, k.id).toBeGreaterThanOrEqual(120);
    }
    expect(pack.fragments.filter((f) => f.offer).length).toBeGreaterThanOrEqual(900);
  });

  test('stakes are not a price list: the clause is chosen by the world, and a wording needs a condition of the world or is the fallback', () => {
    for (const k of KITS) {
      const conditioned = k.clause.filter((c) => c.when?.length);
      expect(conditioned.length, k.id).toBeGreaterThanOrEqual(4);
      expect(k.clause.filter((c) => !c.when?.length).length, k.id).toBeGreaterThanOrEqual(2);
      // the kinds of world a clause reads: prices, the stalls' view of V, and the police
      const read = new Set(conditioned.flatMap((c) => c.when!));
      for (const c of ['priceHigh', 'trusted', 'crackdown'] as const) expect(read.has(c), `${k.id}: ${c}`).toBe(true);
    }
    // no kit prints a clean tier: the amounts differ from kit to kit
    const amounts = KITS.flatMap((k) => k.clause.flatMap((c) => c.t.match(/\b(?:\w+ hundred(?: and \w+)?|ninety|eighty|seventy|sixty)\b/g) ?? []));
    expect(new Set(amounts).size).toBeGreaterThanOrEqual(8);
  });

  test('the pairings use every ask and give each opener three (or all the asks, if fewer)', () => {
    const ps = pairings(4, 4);
    expect(ps.length).toBe(12);
    expect(new Set(ps.map(([, j]) => j))).toEqual(new Set([0, 1, 2, 3]));
    expect(pairings(3, 2).length).toBe(6);
  });

  test('variety: a kit has a dozen openers-with-asks and many clauses, so one world gives dozens of different frames per kit', () => {
    for (const k of KITS) {
      expect(pairings(k.opener.length, k.ask.length).length, k.id).toBeGreaterThanOrEqual(15);
      expect(k.clause.length, k.id).toBeGreaterThanOrEqual(13);
      // two wordings of each condition it reads, so that a world that makes a condition true still has a choice of how to say it
      const by = new Map<string, number>();
      for (const c of k.clause) for (const w of c.when ?? []) by.set(w, (by.get(w) ?? 0) + 1);
      for (const [w, n] of by) expect(n, `${k.id}: ${w}`).toBeGreaterThanOrEqual(w === 'known' || w === 'strangers' || w === 'feePressed' || w === 'crackdown' ? 1 : 2);
    }
  });
});

describe('the kits played', () => {
  const early = stateById('S-early-quiet');

  /** Two adults of the district (the first a gang member when the kit needs the Claws), named. */
  function people(r: Run, claws: boolean): [Id, Id] {
    const sim = r.w.sim;
    const found: Id[] = [];
    let collector: Id | undefined;
    for (const c of sim.w.districts[0]!.cellIds) {
      for (const x of sim.people.residentsOfBlock(c)) {
        const v = sim.people.view(x);
        if (!v || v.aband < 1 || !r.nameOf(x)) continue;
        if (v.affc === 2 && !collector) collector = x;
        else if (v.affc === 0 && v.role === 'vendor') found.push(x);
        if (collector && found.length > 0) break;
      }
      if (collector && found.length > 0) break;
    }
    return [claws ? collector! : found[1] ?? found[0]!, found[0]!];
  }

  function sow(kitId: string, name: string, policy: string, windows = 40) {
    const r = new Run({ name, layer3: true, tempo: 'steady', packs: [pack], s1: names }, early, policies[policy]!);
    const [subject, other] = people(r, kitId === 'fee-shortfall');
    const k = KITS.find((x) => x.id === kitId)!;
    const roles: Record<string, { identity: Id }> = k.roles.subject ? { subject: { identity: subject }, other: { identity: other } } : { other: { identity: other } };
    const res = r.w.l2.sowRequest({ template: `${OFFER_PACK}:${kitId}`, pack: OFFER_PACK, overlay: { roles }, localName: name, decision: H(hs('sow-test'), hs(name)) });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    r.runWindows(windows);
    const inst = r.instancesOf(`${OFFER_PACK}:${kitId}`)[0]!;
    return { r, inst };
  }

  for (const k of KITS) {
    test(`${k.id}: the offer is made in the words of the people, with a cause, an ask and what it is worth`, () => {
      const { r } = sow(k.id, `kit-ask-${k.id}`, 'decline');
      const offer = r.deliveries.find((d) => d.what === 'offer')!;
      expect(offer, 'an offer was delivered').toBeDefined();
      expect(offer.words).not.toMatch(/\[[a-z]+\.[a-z]+\]|\{[a-z.]+\}/);
      for (const n of Object.values(offer.names)) expect(offer.words).toContain(n);
      // a cause (what happened), an ask (a request) and a stake or reward clause: three sentences at least
      expect(offer.words.split(/(?<=[.?!])\s+/).length).toBeGreaterThanOrEqual(3);
      expect(offer.words).toMatch(/\?|Find|Cover|Carry|Deliver|Watch|Pay|Take|Track|Trace|Ask|Will you|Can you|Someone|Somebody|Speak|Whoever|Get the bag/);
    });
  }

  const answers: Array<[string, number]> = [['accept-first', 1], ['accept-middle', 2], ['accept-last', 3], ['decline', 4]];
  for (const k of KITS) {
    for (const [policy, exit] of answers) {
      test(`${k.id} answered by ${policy}: its own consequence plays, a fact is written that the exit reads, and the seed resolves`, () => {
        const { r, inst } = sow(k.id, `kit-${k.id}-${policy}`, policy);
        expect(inst.st.state).toBe('resolved');
        expect(readSeedFact(r.w.l2, inst, 'exit')).toBe(exit);
        const beats = r.deliveries.filter((d) => d.template === `${OFFER_PACK}:${k.id}`).map((d) => d.beat);
        expect(beats[0]).toBe('ask');
        expect(beats).toContain(exit <= 3 ? `x-${k.actions[exit - 1]!.id}` : 'x-decline');
        const out = r.deliveries.find((d) => d.beat.startsWith('x-'))!;
        expect(out.words.length).toBeGreaterThan(20);
        expect(out.words).not.toMatch(/\[[a-z]+\.[a-z]+\]/);
      });
    }
  }

  test('the world picks the wording: the same kit offered in a crackdown and in a quiet district reads differently', () => {
    const seen = new Map<string, Set<string>>();
    for (const state of ['S-early-quiet', 'S-mid-crackdown', 'S-mid-squeezed']) {
      const r = new Run({ name: 'kit-world', layer3: true, tempo: 'steady', packs: [pack], s1: names }, stateById(state), policies.decline!);
      const [subject, other] = people(r, false);
      for (const kit of ['goods-back', 'assault-why']) {
        const res = r.w.l2.sowRequest({ template: `${OFFER_PACK}:${kit}`, pack: OFFER_PACK, overlay: { roles: { subject: { identity: subject }, other: { identity: other } } }, localName: `${kit}-${state}`, decision: H(hs('world-test'), hs(kit), hs(state)) });
        expect(res.ok).toBe(true);
      }
      r.runWindows(60);
      for (const d of r.deliveries.filter((x) => x.what === 'offer')) {
        const key = `${d.template}`;
        const set = seen.get(key) ?? new Set<string>();
        set.add(`${state}: ${d.words.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '<P>')}`);
        seen.set(key, set);
      }
    }
    // each kit was told in three worlds, and the three tellings are not one text
    for (const [, set] of seen) expect(new Set([...set].map((x) => x.replace(/^[^:]+: /, ''))).size).toBeGreaterThanOrEqual(2);
  });
});
