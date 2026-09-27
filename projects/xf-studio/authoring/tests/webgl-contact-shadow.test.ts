import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { ContactProbe } from "./webgl-contact-shadow-probe-page";

/**
 * Character contact shadows on a real GPU (tests/webgl-contact-shadow-probe-page.ts; PREV-148): a 3 mm ridge on a skin plane hides the
 * plane behind it from a grazing light flagged for contact shadows, which no shadow map in the preview resolves at that scale; the same
 * light unflagged, or the term switched off, leaves it lit. Needs a local Chrome; public CI has none and skips.
 */
const PAGE = resolve(import.meta.dir, "webgl-contact-shadow-probe-page.ts");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("contact shadows on a real GPU", () => {
  let probe: ContactProbe;
  beforeAll(async () => { probe = await runProbePage<ContactProbe>(PAGE); }, 120_000);

  test("the skin program compiles with the term and every frame draws", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.errors).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  test("a flagged light is hidden behind a millimetre-scale ridge", () => {
    expect(probe.count.flagged).toBe(1);
    expect(probe.flagged).toBeLessThan(0.3);
  });

  test("unflagged, or with the term off, the same light lights the crease", () => {
    expect(probe.count.unflagged).toBe(0);
    expect(probe.unflagged).toBeGreaterThan(0.9);
    expect(probe.off).toBeGreaterThan(0.9);
  });
});
