/**
 * The natural-expression samples (data/expression-samples/, research/animation/natural-expressions.md): each file is a part-preset row
 * the library accepts as is, its part reads through the expressions codec, its controls are real face-control names (none from the
 * cutscene, tongue or neck-corrective groups, which a still expression shouldn't use), and every pair authored with different sides is
 * unlinked so a drawer edit keeps the asymmetry.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expressionPart } from "../src/features/expressions";
import { controlGroup, isDirectionPair, mirrorName, pairKey } from "../src/engines/facial-rig/vocabulary";
import { EXPRESSION_SAMPLES, SAMPLE_FILES } from "../src/expression-samples";

const folder = resolve(import.meta.dir, "..", "data", "expression-samples");
const files = readdirSync(folder).filter(name => name.endsWith(".json")).sort();

test("the five natural-expression samples are there", () => {
  expect(files).toEqual(["confusion.json", "disgust.json", "mild-surprise.json", "thinking.json", "warm-smile.json"]);
});

test.each(files)("%s is a valid expression preset", file => {
  const sample = JSON.parse(readFileSync(resolve(folder, file), "utf8"));
  expect(sample.feature).toBe("expressions");
  expect(typeof sample.name).toBe("string");
  const part = expressionPart.parse(sample.part);
  const names = Object.keys(part.controls);
  expect(names.length).toBeGreaterThan(5);
  for (const name of names) {
    expect(["brows", "lids", "gaze", "nose", "cheeks", "mouth", "jaw"]).toContain(controlGroup(name));
    const value = part.controls[name]!;
    expect(value).toBeGreaterThan(0);
    // Natural faces stay well below the rig's extremes.
    expect(value).toBeLessThanOrEqual(0.9);
  }
  for (const name of names) {
    const key = pairKey(name);
    if (!key || isDirectionPair(name)) continue;
    if ((part.controls[name] ?? 0) !== (part.controls[mirrorName(name)] ?? 0)) expect(part.links[key]).toBe(false);
  }
  // Every control is explained by an action unit in the documentation block.
  const explained = new Set((sample.facs.actionUnits as { controls: string[] }[]).flatMap(step => step.controls));
  expect(names.filter(name => !explained.has(name))).toEqual([]);
});

test("the host hands out every sample file as a built-in starting point, with its controls and links", () => {
  expect(Object.keys(SAMPLE_FILES).map(name => `${name}.json`).sort()).toEqual(files);
  expect(EXPRESSION_SAMPLES.map(sample => sample.id)).toEqual(Object.keys(SAMPLE_FILES).map(name => `xf-sample:${name}`));
  for (const sample of EXPRESSION_SAMPLES) {
    const file = JSON.parse(readFileSync(resolve(folder, `${sample.id.slice(10)}.json`), "utf8"));
    const part = expressionPart.parse(file.part);
    expect(sample.controls).toEqual(file.part.body.controls);
    expect(sample.links).toEqual(part.links);
    expect(sample.name).not.toContain("(natural)");
    expect(sample.summary).toMatch(/^AU/);
  }
});
