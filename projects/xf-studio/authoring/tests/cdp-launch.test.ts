// The headless Chrome launcher's wait for its page target (tools/cdp.ts): a slow start on a busy machine is waited for with a bounded
// backoff, a Chrome that exits is reported at once, and a start that never exposes a page ends with a clear message. No Chrome runs here.
import { describe, expect, test } from "bun:test";
import { type PageTarget, waitForPageTarget } from "../tools/cdp";

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
