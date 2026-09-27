import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { oracleDescribe } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { TreeProbe } from "./tree-view-probe-page";

/**
 * The tree view laid out with the real studio.css (tests/tree-view-probe-page.ts, in headless Chrome): the empty message shows at the
 * top of the tree (UI-117); a tree grown taller draws every row in view without waiting for an update or a scroll (UI-118); the loading
 * status stays in the frame's corner however far the rows are scrolled (UI-123); and F on a focused Favourites row keeps focus in the
 * tree (UI-119). Needs a local Chrome; public CI has none and skips, and XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const PAGE = resolve(import.meta.dir, "tree-view-probe-page.ts");
const css = readFileSync(resolve(import.meta.dir, "../public/studio.css"), "utf8");

oracleDescribe(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("tree view geometry", () => {
  let probe: TreeProbe;
  beforeAll(async () => { probe = await runProbePage<TreeProbe>(PAGE, "", 60_000, { STUDIO_CSS: JSON.stringify(css) }); }, 120_000);

  test("the page measured every case", () => {
    expect(probe.failure ?? "").toBe("");
    expect(probe.ok).toBe(true);
  });

  test("the empty message sits at the top of the tree, inside its frame", () => {
    const { frame, message, shown } = probe.empty;
    expect(shown).toBe(true);
    expect(message.top - frame.top).toBeLessThanOrEqual(2);
    expect(message.bottom).toBeLessThanOrEqual(frame.bottom);
  });

  test("a tree grown taller draws every row in view with no update or scroll", () => {
    expect(probe.grown.viewHeight).toBeGreaterThan(700);
    expect(probe.grown.drawnInView).toBe(probe.grown.rowsInView);
  });

  test("the loading status stays in the frame's top corner while the rows scroll", () => {
    const { frame, status, scrollTop } = probe.status;
    expect(scrollTop).toBeGreaterThan(1000);
    expect(status.top).toBeGreaterThanOrEqual(frame.top);
    expect(status.top - frame.top).toBeLessThan(12);
    expect(status.right).toBeLessThanOrEqual(frame.right);
  });

  test("F on a focused Favourites row keeps focus in the tree, on the row that took its place", () => {
    expect(probe.focus).toEqual({ before: "fav\u001fp1", after: "fav\u001fp2" });
  });
});
