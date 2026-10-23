/**
 * The composition root reads the scene runtime owner only once it exists (experiment 043 §11). Wiring made before the owner may read the
 * shown head through `shownHead`, which answers nothing until the owner is made: several such readers run at once when they are made (the
 * live face starts following, the UV editor draws its first frame), and a direct `heads.` there stopped the page with a ReferenceError
 * (4a-iv, found by the first in-browser run of 4a-v). No test starts the real page, so this checks the source's order.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("nothing in studio-startup.ts reads `heads` before the scene runtime owner is made", () => {
  const source = readFileSync(resolve(import.meta.dir, "../src/compose/studio-startup.ts"), "utf8");
  const made = source.indexOf("const heads = createBrowserSceneHeads(");
  expect(made).toBeGreaterThan(0);
  // Comments blanked out (their words are not reads), keeping line numbers.
  const code = source.slice(0, made).replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  const early = [...code.matchAll(/\bheads\.\w/g)].map(match => code.slice(0, match.index).split("\n").length);
  expect(early).toEqual([]);
});
