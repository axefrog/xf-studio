// Finding a value by the name the game shows, for cc.apply's label and photo.expression.set's label
// (0.4.2). Session 4 found a hairstyle by probing indices one by one, because the creator's value names
// ("Grace - Side Swept Bob - V4", "VALBY CURTAIN BOB") are hard to guess exactly. The match is tried in
// order, and the first stage with exactly one hit wins:
//   exact       the same text, ignoring case
//   normalised  the same letters and digits, ignoring case, spaces and punctuation ("valby curtain bob")
//   contains    the normalised text contains the wanted text ("viessa")
//   words       every word asked for appears in the text ("grace bob v4" in "Grace - Side Swept Bob - V4")
// Several hits in a stage is ambiguous and refused with the candidates, rather than falling through to a
// looser stage that might pick something else.

export type LabelCandidate = { index: number; texts: string[] };
export type LabelMatch = { index: number; text: string; matched_by: "exact" | "normalised" | "contains" | "words" };
export type LabelMiss = { ambiguous: boolean; candidates: { index: number; text: string }[] };

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export function matchLabel(candidates: LabelCandidate[], wanted: string): LabelMatch | LabelMiss {
  const target = wanted.trim();
  const n = normalise(target);
  const w = words(target);
  const stages: [LabelMatch["matched_by"], (text: string) => boolean][] = [
    ["exact", (text) => text.trim().toLowerCase() === target.toLowerCase()],
    ["normalised", (text) => n.length > 0 && normalise(text) === n],
    ["contains", (text) => n.length > 0 && normalise(text).includes(n)],
    ["words", (text) => w.length > 0 && w.every((word) => words(text).includes(word))],
  ];
  for (const [stage, test] of stages) {
    const hits: { index: number; text: string }[] = [];
    for (const candidate of candidates) {
      const text = candidate.texts.find((t) => t && test(t));
      if (text !== undefined) hits.push({ index: candidate.index, text });
    }
    if (hits.length === 1) return { index: hits[0].index, text: hits[0].text, matched_by: stage };
    if (hits.length > 1) return { ambiguous: true, candidates: hits.slice(0, 8) };
  }
  return { ambiguous: false, candidates: [] };
}

export const isMatch = (result: LabelMatch | LabelMiss): result is LabelMatch => "matched_by" in result;
