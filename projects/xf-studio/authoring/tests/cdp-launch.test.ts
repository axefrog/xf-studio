// The headless Chrome launcher's wait for its page target (tools/cdp.ts): a slow start on a busy machine is waited for with a bounded
// backoff, a Chrome that exits is reported at once, and a start that never exposes a page ends with a clear message. No Chrome runs here.
import { describe, expect, test } from "bun:test";
import { type PageTarget, removeStaleBrowserFolders, waitForPageTarget } from "../tools/cdp";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./temp-dir";

test("stale cleanup removes only our old throwaway folders, keeping fresh, explicit profiles and unrelated temp", async () => {
  const root = tempDir("xfs-cdp-cleanup-");
  const now = Date.now(), old = new Date(now - 25 * 3600_000);
  for (const name of ["xfs-ui-chrome-old", "xfs-ui-data-old", "xfs-ui-chrome-kept", "xfs-ui-chrome-young", "scoped_dir123", "other-old"]) {
    const path = join(root, name);
    mkdirSync(path); writeFileSync(join(path, "child"), "scratch");
    if (!name.endsWith("young")) utimesSync(path, old, old);
  }
  writeFileSync(join(root, "xfs-ui-data-file"), "not a folder");
  await removeStaleBrowserFolders(root, now, join(root, "xfs-ui-chrome-kept"));
  for (const name of ["xfs-ui-chrome-old", "xfs-ui-data-old"]) expect(existsSync(join(root, name))).toBe(false);
  for (const name of ["xfs-ui-chrome-kept", "xfs-ui-chrome-young", "scoped_dir123", "other-old", "xfs-ui-data-file"]) expect(existsSync(join(root, name))).toBe(true);
});

const page: PageTarget = { type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/1" };
const limits = { deadlineMs: 2_000, firstDelayMs: 1, maxDelayMs: 8 };

describe("waiting for Chrome's page target", () => {
  test("a slow start is waited for: refused connections and an empty target list are retried, with a growing delay", async () => {
    let asked = 0;
    const delays: number[] = [];
    const found = await waitForPageTarget(async () => {
      asked++;
      if (asked <= 3) throw Error("connection refused");
      if (asked <= 5) return asked === 4 ? null : [{ type: "service_worker", webSocketDebuggerUrl: "" }];
      return [page];
    }, () => true, limits, async ms => { delays.push(ms); });
    expect(found).toBe(page);
    expect(asked).toBe(6);
    expect(delays).toEqual([1, 2, 3, 5, 8]);
  });

  test("a Chrome that exits is reported at once with what was seen", async () => {
    let asked = 0;
    await expect(waitForPageTarget(async () => { asked++; throw Error("connection refused"); }, () => asked < 2, limits, async () => {}))
      .rejects.toThrow("Chrome exited before it exposed a page target (Chrome's debugging port didn't answer (connection refused))");
    expect(asked).toBe(2);
  });

  test("a start that never exposes a page ends at the deadline with a clear message", async () => {
    await expect(waitForPageTarget(async () => [], () => true, { deadlineMs: 30, firstDelayMs: 5, maxDelayMs: 10 }))
      .rejects.toThrow(/did not expose a page target within 0 s \(Chrome listed 0 target\(s\), none a page\)/);
  });
});
