/**
 * The stages of a cold takeover (README §16): reads the T-e trials of a G4 run (`<cache>-T-e-measure.json`, from `measure-tabs.ts`) and
 * prints, per trial, how long each stage took, from the page's own marks (`xfs:character:*` and `xfs:phase:*`, character-timing.ts).
 *   bun experiments/044-profile-tabs/cold-breakdown.ts generated/g4/<run>/warm-T-e-measure.json [more files]
 */
import { readFileSync } from "node:fs";

type Raw = { t0: number; presented: number | null; marks?: [string, number, unknown][]; long: [number, number][] };
/** A stage: what it covers, from the mark that ends the one before to the mark that ends it (the first starts at the click). */
const STAGES: [string, string][] = [
  ["the runtime built (core head, rig): click to the host being asked", "character:ask"],
  ["the host's answer", "character:answer"],
  ["the record read", "character:record"],
  ["parts loaded (files fetched and decoded unless shared, parts built)", "character:loaded"],
  ["the V's maps uploaded, programs compiled", "phase:details:uploads"],
  ["the wait for the GPU, programs' first use", "phase:details:drained"],
  ["the V placed", "character:placed"],
  ["the runtime's programs", "phase:run:programs"],
  ["morph textures and maps", "phase:run:textures-done"],
  ["the editor's parts", "phase:run:work"],
  ["the hidden warm-up draws", "phase:run:warm-up"],
];

export function breakdown(raw: Raw): { stage: string; ms: number }[] | null {
  const marks = new Map((raw.marks ?? []).map(([name, at]) => [name.replace(/^xfs:/, ""), at] as const));
  if (raw.presented === null || !STAGES.every(([, mark]) => marks.has(mark))) return null;
  const rows: { stage: string; ms: number }[] = [];
  let at = 0;
  for (const [stage, mark] of STAGES) { const end = marks.get(mark)!; rows.push({ stage, ms: Math.round(Math.max(0, end - at)) }); at = Math.max(at, end); }
  rows.push({ stage: "to the first presented frame", ms: Math.round(raw.presented - raw.t0 - at) });
  return rows;
}

if (import.meta.main) {
  for (const file of process.argv.slice(2)) {
    const trials = (JSON.parse(readFileSync(file, "utf8")) as { runs: { raw: Raw }[] }).runs;
    const rows = trials.map(trial => breakdown(trial.raw));
    console.log(`\n${file}`);
    if (rows.some(row => !row)) { console.log("A trial has no marks (a run before the marks were recorded)."); continue; }
    console.log(["| Stage", ...trials.map((_, i) => `trial ${i + 1} ms`), "|"].join(" | ").replace("| |", "|"));
    for (const [i, { stage }] of rows[0]!.entries()) console.log(`| ${stage} | ${rows.map(row => row![i]!.ms).join(" | ")} |`);
    console.log(`| **Click to presented** | ${trials.map(t => Math.round(t.raw.presented! - t.raw.t0)).map(ms => `**${ms}**`).join(" | ")} |`);
    console.log(`Tasks of 50 ms or more: ${trials.map(t => t.raw.long.filter(([, ms]) => ms >= 50).length).join(", ")}`);
  }
}
