// Phases 4 and 5 of M3: the control arms, the blind packet and its scorer, and the automatic critic. These tests check the
// machinery (that the baseline reads no event, that the packet leaks no label, that the scorer does its sums); they make no
// claim about which arm is better. That claim comes from raters.

import { describe, expect, test, setDefaultTimeout } from 'bun:test';
import { readFileSync } from 'node:fs';
import { defaultData as l3Default } from '../../src/procedural/data.ts';
import { TEMPLATES, radiantJob, randomWithinGates } from '../../src/m3/arms.ts';
import { type Arm, type Hook, type RaterAnswer, buildPacket, cardsMarkdown, instructions, pairsMarkdown, score } from '../../src/m3/blind.ts';
import { findings, skeleton, tells } from '../../src/m3/critic.ts';
import { WIDE_NAMES, allNames, peopleIn } from '../../src/sim/names.ts';
import { Run, policies } from '../../src/m3/driver.ts';
import { R2_ID, r2Pack } from '../../src/m3/r2.ts';
import { stateById } from '../../src/m3/states.ts';

import { kabukiFixture } from '../sim/kabuki-fixture.ts';
const index = kabukiFixture(0.25);

setDefaultTimeout(120_000);

describe('A3, the Radiant-style baseline', () => {
  const run = new Run({ index, name: 'a3-test', layer3: false, packs: [] }, stateById('S-early-quiet'), policies.decline!);
  const jobs = Array.from({ length: 24 }, (_, i) => radiantJob(run.w, (id) => run.nameOf(id), 'a3-test', i));

  test('every draw fills a template from real residents, with no placeholder left', () => {
    for (const j of jobs) {
      expect(j).toBeDefined();
      expect(j!.text).not.toMatch(/\[[A-Za-z0-9]+\]|\{[A-Za-z0-9]+\}/);
      for (const n of j!.names) expect(j!.text).toContain(n);
      expect(j!.text).toMatch(/\d+ eddies|eddies/);
    }
    expect(new Set(jobs.map((j) => j!.template)).size).toBeGreaterThanOrEqual(5);
  });

  test('it is deterministic, keyed by the run and the draw', () => {
    const again = Array.from({ length: 24 }, (_, i) => radiantJob(run.w, (id) => run.nameOf(id), 'a3-test', i));
    expect(again).toEqual(jobs);
    expect(radiantJob(run.w, (id) => run.nameOf(id), 'a3-other', 0)).not.toEqual(jobs[0]);
  });

  test('it reads no event, no history, no reputation, no norm and no heat', () => {
    const source = readFileSync(new URL('../../src/m3/arms.ts', import.meta.url), 'utf8');
    const reads = [...source.matchAll(/reads\.eval\('([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(reads).toEqual(['priceLevel']);
    for (const banned of ['ledger', 'normGap', 'band', 'regime', 'weekLines', 'ringEntry', 'beliefs', 'occurrences']) expect(source.includes(`.${banned}(`) || source.includes(`'${banned}'`), banned).toBe(false);
    // a world at the very start, with no incident yet recorded, gives the same job as one a day on, apart from the price it reads
    const later = new Run({ index, name: 'a3-test', layer3: false, packs: [] }, stateById('S-early-quiet'), policies.decline!);
    later.runWindows(10);
    expect(radiantJob(later.w, (id) => later.nameOf(id), 'a3-test', 3)).toEqual(jobs[3]);
  });

  test('the declared slot rule: the nearest eligible resident and place, ties to the smaller identifier', () => {
    const sim = run.w.sim;
    const cell = sim.w.index.names!.g1!;
    const c = sim.w.index.cells[cell]!;
    const rings = [[cell], [...c.adj1].sort(), [...c.adj2].sort()];
    const roles = new Set(['vendor', 'shopkeeper', 'service', 'nightlife', 'technician', 'labourer', 'retired']);
    const eligible = (ring: string[], skip: string[] = []): string[] =>
      ring.flatMap((b) => sim.people.residentsOfBlock(b)).filter((r) => { const v = sim.people.view(r); return v && v.aband >= 1 && roles.has(v.role) && run.nameOf(r) && !skip.includes(r); }).sort();
    const nearest = rings.map((r) => eligible(r)).find((l) => l.length > 0)![0]!;
    const words: Record<string, string> = { vendor: 'the market stalls', bar: 'a bar off the market', clinic: 'the clinic', safehouse: 'a safehouse', lodging: 'a capsule hotel', ripperdoc: 'the ripperdoc', 'fast-travel': 'the metro entrance' };
    const venues: string[] = [];
    for (const ring of rings) for (const sv of ring.flatMap((b) => sim.w.index.cells[b]!.services).sort((a, b) => (a.id < b.id ? -1 : 1))) if (words[sv.type] && !venues.includes(words[sv.type]!)) venues.push(words[sv.type]!);
    const declared = Array.from({ length: 40 }, (_, i) => radiantJob(run.w, (id) => run.nameOf(id), 'a3-rule', i)!);
    for (const j of declared) {
      expect(j.names[0], 'client is the nearest eligible resident, smallest identifier').toBe(run.nameOf(nearest));
      if (/\\bfrom (the|a) /.test(j.text) || j.text.includes('near ')) expect(j.text.includes(venues[0]!), j.text).toBe(true);
    }
    // an escort walks from the nearest place to the next distinct one
    const escort = declared.find((j) => j.template === 'escort');
    if (venues.length > 1 && escort) expect(escort.text).toContain(`from ${venues[0]} to ${venues[1]}`);
    // the rule the rated packet was built with is not this one: its client is a keyed pick among the first four
    const rated = Array.from({ length: 40 }, (_, i) => radiantJob(run.w, (id) => run.nameOf(id), 'a3-rule', i, 'g1', 'rated-v1')!);
    expect(new Set(rated.map((j) => j.names[0])).size).toBeGreaterThan(1);
    expect(new Set(declared.map((j) => j.names[0])).size).toBe(1);
  });

  test('the templates are the eight the dossier names', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['delivery', 'recovery', 'escort', 'removal', 'debt', 'missing', 'tail', 'repair']);
  });
});

describe('A1, random within gates', () => {
  test('it changes only the weights of the ranked draw', () => {
    const base = l3Default();
    const a1 = randomWithinGates(base);
    expect(a1.sower.lambda).toBe(0);
    expect(a1.sower.diversity).toBe(0);
    expect({ ...a1, sower: { ...a1.sower, lambda: 1, diversity: 0.5, kitDiversity: 1 } }).toEqual(base);
  });
});

const hooks = (per: number): Hook[] => (['E', 'A1', 'A3', 'A4'] as Arm[]).flatMap((arm) => Array.from({ length: per }, (_, i) => ({ arm, text: `Card text ${arm}${i} about people in Kabuki.`.replace(arm, 'x'), meta: { i } })));

describe('the blind packet', () => {
  const p = buildPacket(hooks(12), 'test', 4, [['E', 'A3'], ['E', 'A1'], ['A1', 'A3'], ['A4', 'A3']]);

  test('it has one card per hook, opaque ids, and the key apart from the cards', () => {
    expect(p.cards).toHaveLength(48);
    expect(new Set(p.cards.map((c) => c.id)).size).toBe(48);
    expect(JSON.stringify(p.cards)).not.toMatch(/"arm"/);
    expect(Object.keys(p.key)).toHaveLength(48);
    for (const [id, k] of Object.entries(p.key)) expect(['E', 'A1', 'A3', 'A4']).toContain(k.arm), expect(id).toMatch(/^H-\d{3}$/);
  });

  test('every rater has every card once, in blocks that hold one card of each arm, and the next rater has the reverse', () => {
    for (const [r, order] of p.orders.entries()) {
      expect([...order].sort()).toEqual(p.cards.map((c) => c.id).sort());
      if (r % 2 === 0) for (let b = 0; b < 12; b++) expect(new Set(order.slice(b * 4, b * 4 + 4).map((id) => p.key[id]!.arm)).size).toBe(4);
    }
    expect(p.orders[1]).toEqual(p.orders[0]!.slice().reverse());
    expect(p.orders[2]).not.toEqual(p.orders[0]);
  });

  test('the pairs use each hook of an arm once, and the sides are balanced', () => {
    expect(p.pairs).toHaveLength(48);
    const by = new Map<string, Arm[]>();
    for (const x of p.pairs) {
      const k = p.pairKey[x.id]!;
      expect(p.key[x.left]!.arm).toBe(k.leftArm);
      expect(p.key[x.right]!.arm).toBe(k.rightArm);
      const sig = [k.leftArm, k.rightArm].sort().join('|');
      by.set(sig, [...(by.get(sig) ?? []), k.leftArm]);
    }
    for (const [sig, lefts] of by) {
      const first = sig.split('|')[0] as Arm;
      const onLeft = lefts.filter((a) => a === first).length;
      expect(onLeft, sig).toBeGreaterThanOrEqual(3);
      expect(onLeft, sig).toBeLessThanOrEqual(9);
    }
  });

  test('the files a rater is given hold no label', () => {
    const body = `${instructions()}${cardsMarkdown(p, p.orders[0]!)}${pairsMarkdown(p)}`;
    expect(body).not.toMatch(/engine|baseline|Radiant|authored|layer 3|sowing|A1|A3|A4/);
  });

  test('a packet needs equal arms', () => {
    expect(() => buildPacket(hooks(3).slice(1), 'x', 2, [['E', 'A3']])).toThrow();
  });
});

describe('balanced sides (the review fix of run 2)', () => {
  const pairing: Array<[Arm, Arm]> = [['E', 'A3'], ['E', 'A1'], ['A1', 'A3'], ['A4', 'A3']];
  const p = buildPacket(hooks(24), 'sides', 3, pairing, { balancedSides: true });
  const left = (pk: Record<string, { leftArm: Arm; rightArm: Arm }>, first: Arm, second: Arm): string[] =>
    Object.entries(pk).filter(([, k]) => k.leftArm === first && k.rightArm === second).map(([id]) => id);

  test('in each comparison exactly half of the pairs have the first arm on the left, for every rater', () => {
    expect(p.pairsByRater).toHaveLength(3);
    for (const pk of p.pairKeys!) for (const [x, y] of pairing) {
      expect(left(pk, x, y)).toHaveLength(12);
      expect(left(pk, y, x)).toHaveLength(12);
    }
  });

  test('raters 1 and 3 (the two passes of one model) see every pair mirrored; the sheets agree with the keys; the pairs are the same pairs', () => {
    const [a, b, c] = p.pairsByRater! as [typeof p.pairs, typeof p.pairs, typeof p.pairs];
    const by = (xs: typeof p.pairs) => new Map(xs.map((x) => [x.id, x]));
    for (const x of a) {
      expect(by(c).get(x.id)).toEqual({ id: x.id, left: x.right, right: x.left });
      expect(by(b).get(x.id)).toEqual(x);
    }
    for (const [r, pairs] of p.pairsByRater!.entries()) for (const x of pairs) {
      expect(p.key[x.left]!.arm).toBe(p.pairKeys![r]![x.id]!.leftArm);
      expect(p.key[x.right]!.arm).toBe(p.pairKeys![r]![x.id]!.rightArm);
    }
    // the sheet of each rater prints that rater's sides
    expect(pairsMarkdown(p, 2)).not.toBe(pairsMarkdown(p, 0));
    expect(pairsMarkdown(p, 1)).toBe(pairsMarkdown(p, 0));
  });

  test('an odd count differs by one, and the unbalanced packet (run 1) has no per-rater sides', () => {
    const odd = buildPacket(hooks(5), 'odd', 2, [['E', 'A3']], { balancedSides: true });
    expect([left(odd.pairKeys![0]!, 'E', 'A3').length, left(odd.pairKeys![0]!, 'A3', 'E').length].sort()).toEqual([2, 3]);
    expect(buildPacket(hooks(5), 'odd', 2, [['E', 'A3']]).pairsByRater).toBeUndefined();
  });

  test('the scorer reads each answer against the sides of its own sheet: a rater who always takes the engine gives it every pair on every sheet', () => {
    const answer = (sheet: number): RaterAnswer => {
      const pk = p.pairKeys![sheet - 1]!;
      return {
        rater: `r${sheet}`, sheet,
        cards: Object.fromEntries(p.cards.map((cd) => [cd.id, { caused: 4, legible: 4, setting: 4, pull: 4, made_by: 'person' }])),
        pairs: Object.fromEntries(p.pairs.map((x) => [x.id, { follow: pk[x.id]!.leftArm === 'E' || (pk[x.id]!.rightArm !== 'E' && pk[x.id]!.leftArm === 'A4') ? 'left' : 'right', caused: pk[x.id]!.leftArm === 'E' || (pk[x.id]!.rightArm !== 'E' && pk[x.id]!.leftArm === 'A4') ? 'left' : 'right' }])),
      };
    };
    const s = score(p, [answer(1), answer(2), answer(3)]);
    for (const r of s.perRater) {
      const own = r.pairs.find((x) => x.x === 'A3' && x.y === 'E' && x.criterion === 'follow')!;
      expect(own.wins).toBe(0);
      expect(own.n).toBe(24);
    }
    // read against sheet 1's sides instead, the third rater's answers would be mirrored and would not all go to the engine
    const wrong = score(p, [{ ...answer(3), sheet: 1 }]);
    expect(wrong.perRater[0]!.pairs.find((x) => x.x === 'A3' && x.y === 'E' && x.criterion === 'follow')!.wins).toBeGreaterThan(0);
  });
});

describe('the scorer', () => {
  test('raters who prefer one arm give that arm the means and the pair wins', () => {
    const p = buildPacket(hooks(8), 'score', 2, [['E', 'A3']]);
    const mk = (name: string, lead: Arm): RaterAnswer => ({
      rater: name,
      cards: Object.fromEntries(p.cards.map((c) => { const arm = p.key[c.id]!.arm; const v = arm === lead ? 6 : 3; return [c.id, { caused: v, legible: v, setting: v, pull: v, made_by: arm === lead ? 'person' : 'program' }]; })),
      pairs: Object.fromEntries(p.pairs.map((x) => { const k = p.pairKey[x.id]!; const side = (k.leftArm === lead ? 'left' : 'right') as 'left' | 'right'; return [x.id, { follow: side, caused: side }]; })),
    });
    const s = score(p, [mk('r1', 'E'), mk('r2', 'E')]);
    expect(s.arms.E!.mean.caused).toBe(6);
    expect(s.arms.A3!.mean.caused).toBe(3);
    expect(s.arms.E!.detected).toBe(0);
    expect(s.arms.A3!.detected).toBe(s.arms.A3!.detectedOf);
    const row = s.pairs.find((x) => x.x === 'A3' && x.y === 'E' && x.criterion === 'follow')!;
    expect(row.wins).toBe(0);
    expect(row.n).toBe(16);
    // pooled counts carry no significance claim (the items repeat across raters); the direction is read per rater
    expect(Object.keys(row)).not.toContain('p');
    expect(s.perRater.map((r) => r.rater)).toEqual(['r1', 'r2']);
    for (const r of s.perRater) {
      const own = r.pairs.find((x) => x.x === 'A3' && x.y === 'E' && x.criterion === 'follow')!;
      expect(own.wins).toBe(0);
      expect(own.n).toBe(8);
    }
    expect(s.disagreement.caused).toBe(0);
  });
});

describe('the critic', () => {
  test('names and numbers are masked, so a template repeats', () => {
    expect(skeleton('Mina Sato was robbed. 500 eddies.', ['Mina Sato'])).toBe('<P> was robbed. <N> eddies.');
    const h = (text: string): Hook => ({ arm: 'A3', text, meta: {} });
    const t = tells([h('Kai Mori owes Jun Hale 500 eddies.'), h('Rin Sato owes Mia Novak 250 eddies.'), h('Something different happened here.')], (x) => x.text.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) ?? []);
    expect(t.A3!.repeatedSkeleton).toBeCloseTo(0.67, 2);
    expect(t.A3!.maxSkeleton).toBe(2);
    expect(t.A3!.priced).toBeCloseTo(0.67, 2);
    expect(findings(t).some((f) => f.includes('share a masked skeleton'))).toBe(true);
  });

  test('"names two people" counts distinct people, not the tokens that mask names (M3B-03)', () => {
    const h = (text: string): Hook => ({ arm: 'E', text, meta: {} });
    // the masking list holds every token of the registry that appears (a given and a family name for each person), so it is not a person count
    const mask = (x: Hook): string[] => allNames().filter((n) => new RegExp(`\\b${n}\\b`).test(x.text));
    const one = h('Kai Mori says the till is short. Mori asks you to cover it, and Kai will owe you.');
    const two = h('Kai Mori says Mei Sato was at the stall again.');
    expect(mask(one).length).toBe(2);
    const t = tells([one, two], mask, (x) => peopleIn(x.text));
    expect(t.E!.twoPeople).toBe(0.5);
    // the old count (the length of the masking list) called the card of one person a card of two
    expect(tells([one, two], mask).E!.twoPeople).toBe(1);
  });

  test('peopleIn: a person is a given and a family name of the registry, counted once however often it is repeated', () => {
    expect(peopleIn('Kai Mori met Kai Mori again, and Mori left.', WIDE_NAMES)).toEqual(['Kai Mori']);
    expect(peopleIn('Tyger Claws and Night City: no one.', WIDE_NAMES)).toEqual([]);
    expect(peopleIn('Marcus Washington gave Priya Patel the bag.', WIDE_NAMES)).toEqual(['Marcus Washington', 'Priya Patel']);
  });
});

describe('adversarial synthetic players on R2 (B14, first pass)', () => {
  test('every policy ends the seed or leaves it answerable, and nothing is gained by farming', () => {
    const outcomes: Record<string, string> = {};
    for (const p of ['accept-first', 'accept-middle', 'accept-last', 'decline', 'ignore']) {
      const r = new Run({ index, name: 'b14', layer3: false, packs: [r2Pack({}, { unattended: { after: { clock: 'game', s: 21_600 }, outcome: [{ fact: 'exit', set: 5 }] } })] }, stateById('S-mid-squeezed'), policies[p]!);
      r.runWindows(60);
      const inst = r.instancesOf(R2_ID)[0]!;
      outcomes[p] = inst.st.state;
      const offers = r.deliveries.filter((d) => d.what === 'offer');
      // an ignoring V is re-offered a bounded number of times, never without end
      expect(offers.length, p).toBeLessThanOrEqual(4);
      // the seed is never stuck: it resolved, or it is unattended or withered by its own plan
      expect(['resolved', 'unattended', 'withered'], p).toContain(inst.st.state);
    }
    expect(outcomes.decline).toBe('resolved');
  });
});
