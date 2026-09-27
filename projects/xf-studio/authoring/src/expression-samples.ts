/**
 * The built-in expression starting points: the natural-expression samples (research/animation/natural-expressions.md §4), read from
 * their data files in `data/expression-samples/` (part-preset rows in the editor's preset format). The facial host hands them out with
 * its state (`FacialHostState.samples`), so both hosts carry them (the files are bundled with the host) and the Expression drawer lists
 * them as "Natural (XF)" even before the game files are read. Adding a sample is adding its file here; tests/expression-samples.test.ts
 * checks every file in the folder is listed and that each reads through the expressions part codec.
 */
import confusion from "../data/expression-samples/confusion.json";
import disgust from "../data/expression-samples/disgust.json";
import mildSurprise from "../data/expression-samples/mild-surprise.json";
import thinking from "../data/expression-samples/thinking.json";
import warmSmile from "../data/expression-samples/warm-smile.json";
import { vectorIssue } from "./engines/facial-rig/vector";
import type { FacialSample } from "./platform/api/facial";

type SampleFile = { feature: string; name: string; part: { schema: string; body: { controls?: unknown; links?: unknown } };
  facs?: { actionUnits?: { au: string; name: string }[] } };

/** The sample files by name, in the order the drawer lists them. */
export const SAMPLE_FILES: Readonly<Record<string, SampleFile>> = Object.freeze({
  "warm-smile": warmSmile, "mild-surprise": mildSurprise, "confusion": confusion, "thinking": thinking, "disgust": disgust,
} as Record<string, SampleFile>);

const PAIR = /^[A-Za-z][A-Za-z0-9_]{0,95}$/;

/** The samples as start points: `xf-sample:<file>` ids, names without the library's "(natural)" suffix, a summary of their action units. */
export const EXPRESSION_SAMPLES: readonly FacialSample[] = Object.freeze(Object.entries(SAMPLE_FILES).map(([file, row]) => {
  const { controls, links = {} } = row.part.body;
  const issue = row.feature !== "expressions" ? "isn't an expression" : vectorIssue(controls)
    ?? (typeof links === "object" && links && Object.entries(links).every(([key, value]) => PAIR.test(key) && typeof value === "boolean") ? undefined : "has damaged links");
  if (issue) throw Error(`The expression sample ${file} ${issue}.`);
  const units = row.facs?.actionUnits ?? [];
  return Object.freeze({ id: `xf-sample:${file}`, name: row.name.replace(/\s*\(natural\)$/i, ""),
    summary: units.map(unit => `${unit.au} ${unit.name.toLowerCase()}`).join(", "),
    controls: Object.freeze({ ...(controls as Record<string, number>) }), links: Object.freeze({ ...(links as Record<string, boolean>) }) });
}));
