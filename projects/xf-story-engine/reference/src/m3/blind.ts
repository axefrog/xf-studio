// The blind pass of M3 (D23 5.5, panels P-A and P-D against A3): every arm's hooks rendered as one neutral card each, with no
// label of origin, in a balanced order; a scoring sheet built from the quality bar; forced-choice pairs; and the scorer that
// turns raters' answers into per-criterion results. Nothing here decides anything about the engine.
//
// The packet carries nothing but the card text. The key (which card is which arm) is a separate file the raters never see.

import { rand, s as hs, i as hi } from '../id.ts';

export type Arm = 'E' | 'A1' | 'A3' | 'A4';
export const ARM_NAMES: Record<Arm, string> = { E: 'engine (ranked sowing)', A1: 'random within gates', A3: 'Radiant-style baseline', A4: 'authored seed R2' };

export interface Hook { arm: Arm; text: string; meta: Record<string, string | number> }
export interface Card { id: string; text: string }
export interface Pair { id: string; left: string; right: string }
export interface Packet {
  cards: Card[];
  /** One balanced order per rater, as card ids. */
  orders: string[][];
  pairs: Pair[];
  key: Record<string, { arm: Arm; meta: Hook['meta'] }>;
  pairKey: Record<string, { leftArm: Arm; rightArm: Arm }>;
}

const keyed = (seed: string, tag: string, ...n: number[]): number => rand(hs('m3-blind'), hs(seed), hs(tag), ...n.map(hi));

/** A seeded shuffle (Fisher-Yates from a keyed draw). */
export function shuffle<T>(xs: readonly T[], seed: string, tag: string): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(keyed(seed, tag, i) * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Build the packet. Every arm must have the same number of hooks (the caller samples to the smallest). Card ids are opaque and
 * assigned in a shuffled order. Each rater's order is made of blocks that hold one card of each arm, shuffled inside each block,
 * so every arm is spread evenly through the sequence; the next rater's order is the previous one reversed.
 */
export function buildPacket(hooks: Hook[], seed: string, raters: number, pairing: Array<[Arm, Arm]>): Packet {
  const arms = [...new Set(hooks.map((h) => h.arm))].sort() as Arm[];
  const per = arms.map((a) => hooks.filter((h) => h.arm === a));
  const n = per[0]!.length;
  if (per.some((p) => p.length !== n)) throw new Error('every arm needs the same number of hooks');
  const ids = shuffle(hooks.map((_, i) => i), seed, 'ids');
  const label = (i: number): string => `H-${String(ids.indexOf(i) + 1).padStart(3, '0')}`;
  const cards: Card[] = hooks.map((h, i) => ({ id: label(i), text: h.text })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const key: Packet['key'] = Object.fromEntries(hooks.map((h, i) => [label(i), { arm: h.arm, meta: h.meta }]));
  const byArm = (a: Arm): string[] => shuffle(hooks.flatMap((h, i) => (h.arm === a ? [label(i)] : [])), seed, `arm-${a}`);
  const lists = Object.fromEntries(arms.map((a) => [a, byArm(a)])) as Record<Arm, string[]>;
  const orders: string[][] = [];
  for (let r = 0; r < raters; r++) {
    if (r % 2 === 1) {
      orders.push(orders[r - 1]!.slice().reverse());
      continue;
    }
    const order: string[] = [];
    for (let b = 0; b < n; b++) order.push(...shuffle(arms.map((a) => lists[a][(b + r) % n]!), seed, `block-${r}-${b}`));
    orders.push(order);
  }
  const pairs: Pair[] = [];
  const pairKey: Packet['pairKey'] = {};
  pairing.forEach(([x, y], pi) => {
    const xs = lists[x], ys = shuffle(lists[y], seed, `pair-${pi}`);
    for (let i = 0; i < n; i++) {
      const flip = keyed(seed, 'flip', pi, i) < 0.5;
      const id = `P-${String(pairs.length + 1).padStart(3, '0')}`;
      const left = flip ? ys[i]! : xs[i]!, right = flip ? xs[i]! : ys[i]!;
      pairs.push({ id, left, right });
      pairKey[id] = flip ? { leftArm: y, rightArm: x } : { leftArm: x, rightArm: y };
    }
  });
  return { cards, orders, pairs: shuffle(pairs, seed, 'pair-order'), key, pairKey };
}

// ---- the sheet and the instructions ----

export const CRITERIA = [
  { id: 'caused', ask: 'Does it read as something that happened for a reason (rather than being arranged to give you a task)? 1 = no reason at all, 7 = clearly caused.', bar: 'Causality (bar 1; C1)' },
  { id: 'legible', ask: 'Is it clear what is going on and what a person in your position could do about it? 1 = baffling, 7 = completely clear.', bar: 'Legibility (bar 3; C4)' },
  { id: 'setting', ask: 'Does it sound like it belongs in a Night City district: its people, its pressures, its voice? 1 = could be anywhere, 7 = unmistakably here.', bar: 'Setting fidelity (bar 6; C9)' },
  { id: 'pull', ask: 'Would you want to follow this up? 1 = not at all, 7 = at once.', bar: 'Hook strength (bar 2 and 4; C2, C11)' },
] as const;

export function instructions(): string {
  return `# Blind rating: hooks in a city district

You are one of several independent raters. You will read short pieces of text, each a "card". Each card is something that reaches the player character, V, in the Kabuki district of Night City in the game Cyberpunk 2077. The cards come from different sources. You are not told which, and you should not try to find out from anything but the text itself.

Rate each card on the four scales below, on your own, before looking at any other card's rating. Then answer the two guess questions. Then do the pairs: for each pair, pick the one you would rather follow up and the one that reads as more caused.

Scales (1 to 7, whole numbers):
${CRITERIA.map((c) => `- **${c.id}**: ${c.ask}`).join('\n')}

Guess questions, for each card:
- **made_by**: "person" if you think a person wrote this card for this exact situation, "program" if you think a program put it together from a template or parts. Say one word.
- **cue**: in a few words, what in the text gave it away, or "none".

Answer in JSON only, in this shape:

{"rater": "<your name or id>", "cards": {"H-001": {"caused": 4, "legible": 5, "setting": 3, "pull": 4, "made_by": "program", "cue": "..."}, ...}, "pairs": {"P-001": {"follow": "left", "caused": "right"}, ...}, "critic": "<optional: after finishing, a paragraph naming what made some cards read as generated, and which patterns you saw repeat>"}

Use the cards in the order given to you. Do not skip any.
`;
}

export function cardsMarkdown(p: Packet, order: string[]): string {
  const by = new Map(p.cards.map((c) => [c.id, c]));
  return order.map((id) => `### ${id}\n\n${by.get(id)!.text}\n`).join('\n');
}

export function pairsMarkdown(p: Packet): string {
  const by = new Map(p.cards.map((c) => [c.id, c]));
  return p.pairs.map((x) => `### ${x.id}\n\nLeft: ${by.get(x.left)!.text}\n\nRight: ${by.get(x.right)!.text}\n`).join('\n');
}

// ---- scoring ----

export interface RaterAnswer {
  rater: string;
  cards: Record<string, { caused: number; legible: number; setting: number; pull: number; made_by: string; cue?: string }>;
  pairs: Record<string, { follow: 'left' | 'right'; caused: 'left' | 'right' }>;
  critic?: string;
}

/** The two-sided exact binomial (sign) test for `wins` out of `n` against 0.5. */
export function signTest(wins: number, n: number): number {
  if (n === 0) return 1;
  const logC = (k: number): number => {
    let r = 0;
    for (let i = 1; i <= k; i++) r += Math.log((n - k + i) / i);
    return r;
  };
  const pk = (k: number): number => Math.exp(logC(k) + n * Math.log(0.5));
  const obs = pk(wins);
  let p = 0;
  for (let k = 0; k <= n; k++) if (pk(k) <= obs + 1e-12) p += pk(k);
  return Math.min(1, p);
}

export interface ArmScore { n: number; mean: Record<string, number>; detected: number; detectedOf: number }
export interface Score {
  raters: string[];
  arms: Record<string, ArmScore>;
  /** For each pair of arms X over Y: the share of forced choices the first won, on each of the two questions, with the sign test. */
  pairs: Array<{ x: Arm; y: Arm; criterion: 'follow' | 'caused'; wins: number; n: number; p: number }>;
  /** The share of raters' per-card scores in which two raters of one card differ by 2 or more points, by criterion. */
  disagreement: Record<string, number>;
}

export function score(p: Packet, answers: RaterAnswer[]): Score {
  const arms: Record<string, { sums: Record<string, number>; n: number; det: number; detOf: number }> = {};
  for (const a of answers) {
    for (const [id, c] of Object.entries(a.cards)) {
      const arm = p.key[id]?.arm;
      if (!arm) continue;
      const row = (arms[arm] ??= { sums: {}, n: 0, det: 0, detOf: 0 });
      row.n++;
      for (const cr of CRITERIA) row.sums[cr.id] = (row.sums[cr.id] ?? 0) + (c[cr.id] ?? 0);
      row.detOf++;
      if (/program/i.test(c.made_by)) row.det++;
    }
  }
  const armScores = Object.fromEntries(Object.entries(arms).map(([arm, r]) => [arm, { n: r.n, mean: Object.fromEntries(Object.entries(r.sums).map(([k, v]) => [k, Math.round((v / r.n) * 100) / 100])), detected: r.det, detectedOf: r.detOf }]));
  const wins: Record<string, { w: number; n: number }> = {};
  for (const a of answers) {
    for (const [id, c] of Object.entries(a.pairs)) {
      const k = p.pairKey[id];
      if (!k) continue;
      for (const crit of ['follow', 'caused'] as const) {
        const side = c[crit];
        const winner = side === 'left' ? k.leftArm : k.rightArm;
        const loser = side === 'left' ? k.rightArm : k.leftArm;
        const [x, y] = [winner, loser].sort() as [Arm, Arm];
        const key = `${x}|${y}|${crit}`;
        const row = (wins[key] ??= { w: 0, n: 0 });
        row.n++;
        if (winner === x) row.w++;
      }
    }
  }
  const pairs = Object.entries(wins).map(([key, v]) => {
    const [x, y, criterion] = key.split('|') as [Arm, Arm, 'follow' | 'caused'];
    return { x, y, criterion, wins: v.w, n: v.n, p: Math.round(signTest(v.w, v.n) * 1e4) / 1e4 };
  });
  const dis: Record<string, { d: number; n: number }> = {};
  for (const cr of CRITERIA) dis[cr.id] = { d: 0, n: 0 };
  for (const c of p.cards) for (const cr of CRITERIA) {
    const vals = answers.map((a) => a.cards[c.id]?.[cr.id]).filter((v): v is number => typeof v === 'number');
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) { dis[cr.id]!.n++; if (Math.abs(vals[i]! - vals[j]!) >= 2) dis[cr.id]!.d++; }
  }
  return {
    raters: answers.map((a) => a.rater), arms: armScores, pairs,
    disagreement: Object.fromEntries(Object.entries(dis).map(([k, v]) => [k, v.n ? Math.round((v.d / v.n) * 100) / 100 : 0])),
  };
}
