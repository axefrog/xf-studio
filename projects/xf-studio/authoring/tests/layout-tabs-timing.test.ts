import { expect } from "bun:test";
import { resolve } from "node:path";
import { oracleTest } from "./optional-oracles";
import { CHROME, chromeInstalled, runProbePage } from "./webgl-harness";
import type { TabSwitchProbe } from "./layout-tabs-probe-page";

oracleTest(chromeInstalled(), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("P2-iv: synthetic tab switches load, rebind and paint with no main-thread task of 50 ms or more", async () => {
  const result = await runProbePage<TabSwitchProbe>(resolve(import.meta.dir, "layout-tabs-probe-page.ts"), "", 30_000,
    { STUDIO_CSS: JSON.stringify(await Bun.file(resolve(import.meta.dir, "../public/studio.css")).text()) });
  if (process.env.XFS_PROBE_PRINT === "1") console.log(JSON.stringify(result, null, 1));
  expect(result.failure).toBeUndefined();
  expect(result.supported).toBe(true);
  expect(result.switches).toHaveLength(16);
  expect(result.longTasks).toEqual([]);
  for (const row of result.switches) {
    expect(row).toMatchObject({ rebound: true, loaded: true, reused: true, loads: 1 });
    expect(row.dispatchMs).toBeLessThan(50); expect(row.paintTaskMs).toBeLessThan(50);
  }
}, 180_000);
