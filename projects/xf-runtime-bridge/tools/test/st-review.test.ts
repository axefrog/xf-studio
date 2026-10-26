// The ST review packet's findings (scripted session 1, local/sessions/scripted-1/st-review-packet): rows marked PASS
// whose captures didn't show their named state, bursts at the wrong spacing, and plugin logs lost to restarts.
// Fake bridges and hosts; nothing reaches a game.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

describe("bursts keep their spacing", () => {
  test("a burst step's interval_ms reaches capture.burst (it was taken as the plan's polling interval and dropped)", async () => {
    const { FakeClock } = await import("./fake-clock.ts");
    const { fakeApi, fakeHost, go, script } = await import("./batch-fakes.ts");
    const clock = new FakeClock();
    const api = fakeApi(clock);
    const rows = [{ id: "r", title: "r", steps: [
      { label: "b", do: "burst", name: "pulse", frames: 12, interval_ms: 200, clear_overlay: false, rect: { x: 0, y: 0, width: 8, height: 8 } },
      { label: "polled", do: "run", command: "game.status", input: {}, until: { path: "phase", equals: "gameplay" }, interval_ms: 250, deadline_ms: 2000 },
    ] }];
    await go(script(rows as never), api, fakeHost(), clock, tempDir("xfb-str-"));
    expect(api.calls.find((c) => c.name === "capture.burst")!.input.interval_ms).toBe(200);
    // Beside until it is still the polling interval, never sent to the command.
    expect(api.calls.filter((c) => c.name === "game.status").every((c) => c.input.interval_ms === undefined)).toBe(true);
  });

  test("the plan core: interval_ms is the action's own without until", async () => {
    const { actionOf } = await import("../testing/plan.ts");
    expect(actionOf({ do: "burst", interval_ms: 240 } as never)).toEqual({ do: "burst", interval_ms: 240 });
    expect(actionOf({ do: "run", until: { ok: true }, interval_ms: 240 } as never)).toEqual({ do: "run" });
  });
});
