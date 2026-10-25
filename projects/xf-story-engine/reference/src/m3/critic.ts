// The adversarial critic pass, automatic half (D23 B9, B14; the model critics' half is in the blind packet's `critic` field).
// It reads only the cards' text and the names the record says each card uses, and names what would give a card away as built from
// parts: a skeleton that repeats once the names and numbers are masked, a narrow vocabulary, no marker of a cause, one length. It
// decides nothing about the engine; its findings go to the author of the material, as the dossier asks (cues returned to P4, P5).

import type { Arm, Hook } from './blind.ts';

export interface ArmTells {
  n: number;
  /** The share of cards whose masked skeleton also appears on another card of the arm. */
  repeatedSkeleton: number;
  /** The most cards sharing one skeleton. */
  maxSkeleton: number;
  /** Distinct word pairs over all word pairs, across the arm's cards (1 is all different). */
  bigramDiversity: number;
  /** The share of cards that carry a word that names a cause or an order of events. */
  causeMarker: number;
  meanWords: number;
  /** The share of cards that end in a reward line or a number (a job's price). */
  priced: number;
  /** The share of cards that name two people. */
  twoPeople: number;
  skeletons: Array<{ skeleton: string; count: number }>;
}

const CAUSE = /\b(after|because|then|before|since|so that|turned up|picked up|reported|named|led to)\b/i;

/** The skeleton of a card: names, numbers and the quoted place words masked. */
export function skeleton(text: string, names: string[]): string {
  let t = text;
  for (const n of [...new Set(names)].sort((a, b) => b.length - a.length)) if (n) t = t.split(n).join('<P>');
  t = t.replace(/\b\d[\d,]*\b/g, '<N>').replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '<P>');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * `namesOf` gives the strings to mask from a card (every name token, so that a skeleton hides the names); `peopleOf` gives the distinct people the
 * card names, which is what `twoPeople` counts. They are different lists: a masking list that holds a given name and a family name for one person
 * would make every named person two. Without `peopleOf`, `namesOf` serves for both (run 1's report, whose list is the pairs of capitalised words).
 */
export function tells(hooks: Hook[], namesOf: (h: Hook) => string[], peopleOf: (h: Hook) => string[] = namesOf): Record<string, ArmTells> {
  const out: Record<string, ArmTells> = {};
  for (const arm of [...new Set(hooks.map((h) => h.arm))] as Arm[]) {
    const cards = hooks.filter((h) => h.arm === arm);
    const skel = cards.map((h) => skeleton(h.text, namesOf(h)));
    const count = new Map<string, number>();
    for (const k of skel) count.set(k, (count.get(k) ?? 0) + 1);
    const grams = new Set<string>();
    let total = 0;
    for (const h of cards) {
      const w = h.text.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
      for (let i = 0; i + 1 < w.length; i++) { grams.add(`${w[i]} ${w[i + 1]}`); total++; }
    }
    out[arm] = {
      n: cards.length,
      repeatedSkeleton: round(skel.filter((k) => count.get(k)! > 1).length / Math.max(1, cards.length)),
      maxSkeleton: Math.max(0, ...count.values()),
      bigramDiversity: round(grams.size / Math.max(1, total)),
      causeMarker: round(cards.filter((h) => CAUSE.test(h.text)).length / Math.max(1, cards.length)),
      meanWords: round(cards.reduce((a, h) => a + h.text.split(/\s+/).length, 0) / Math.max(1, cards.length)),
      priced: round(cards.filter((h) => /\beddies\b/i.test(h.text)).length / Math.max(1, cards.length)),
      twoPeople: round(cards.filter((h) => new Set(peopleOf(h)).size >= 2).length / Math.max(1, cards.length)),
      skeletons: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => ({ skeleton: k, count: c })),
    };
  }
  return out;
}

const round = (x: number): number => Math.round(x * 100) / 100;

/** The findings in words: what stands out between arms, for the author. */
export function findings(t: Record<string, ArmTells>): string[] {
  const out: string[] = [];
  for (const [arm, v] of Object.entries(t)) {
    if (v.repeatedSkeleton >= 0.5) out.push(`${arm}: ${Math.round(v.repeatedSkeleton * 100)} % of cards share a masked skeleton with another (the most common is on ${v.maxSkeleton} cards): a reader will see the template.`);
    if (v.causeMarker <= 0.2) out.push(`${arm}: only ${Math.round(v.causeMarker * 100)} % of cards carry a word of cause or order.`);
    if (v.priced >= 0.8) out.push(`${arm}: ${Math.round(v.priced * 100)} % of cards end in a price in eddies: the job-board tell.`);
    if (v.bigramDiversity <= 0.7) out.push(`${arm}: word pairs are ${Math.round((1 - v.bigramDiversity) * 100)} % repeats across the arm's cards.`);
  }
  return out;
}
