import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { StackProbe } from "./dock-strip-stack-probe-page";

/**
 * A stack of vertical strips (a column whose groups all collapsed) with the real studio.css (tests/dock-strip-stack-probe-page.ts, in
 * headless Chrome), shrunk from 900 px to 240 px and grown back. Each strip's room follows its natural length, never how far it had
 * condensed, so at every height the strips match a dock rendered afresh at that height: a strip condensed in a short window gets its
 * labels back when the window grows (UI-120). Needs a local Chrome; public CI has none and skips, and XFS_REQUIRE_ORACLES=1 turns the
 * skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "dock-strip-stack-probe-page.ts");
const css = readFileSync(resolve(import.meta.dir, "../public/studio.css"), "utf8");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("dock strip stack regrowth", () => {
  let probe: StackProbe;
  beforeAll(async () => { probe = await runProbePage<StackProbe>(PAGE, "", 60_000, { STUDIO_CSS: JSON.stringify(css) }); }, 120_000);

  test("the page rendered every step", () => {
    expect(probe.failure ?? "").toBe("");
    expect(probe.ok).toBe(true);
    expect(probe.steps.every(step => step.resized.length === 2 && step.fresh.length === 2)).toBe(true);
  });

  test("at every height the strips match a fresh render, whichever way the window moved to get there", () => {
    const problems = probe.steps.flatMap(step => step.resized.flatMap((strip, i) => {
      const fresh = step.fresh[i]!;
      return strip.stage !== fresh.stage || Math.abs(strip.height - fresh.height) > 1 || strip.overflowed !== fresh.overflowed
        ? [`${step.height} px ${strip.group}: ${strip.stage} ${strip.height} px (${strip.overflowed} in the menu), fresh ${fresh.stage} ${fresh.height} px (${fresh.overflowed})`] : [];
    }));
    expect(problems).toEqual([]);
  });

  test("grown back to 900 px, every strip shows its labels in full again", () => {
    const first = probe.steps[0]!, last = probe.steps.at(-1)!;
    expect(first.resized.map(strip => strip.stage)).toEqual(["full", "full"]);
    expect(last.resized.map(strip => strip.stage)).toEqual(["full", "full"]);
    expect(last.resized.map(strip => strip.height)).toEqual(first.resized.map(strip => strip.height));
    // The short window did condense them.
    expect(probe.steps.find(step => step.height === 240)!.resized.every(strip => strip.stage !== "full")).toBe(true);
  });
});
