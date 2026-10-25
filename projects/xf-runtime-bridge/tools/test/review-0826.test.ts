// The runner's review fixes (Sol's review of the plan module and the schema-3 runner, 26 October): each test
// reproduces the failure the review found, and passes only with its fix.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runPlan, type Plan } from "../testing/plan.ts";
import { stagedConfigPath } from "../testing/config-ini.ts";
import { fakeApi, fakeHost, go, script, STAGED_INI, stagedMod } from "./batch-fakes.ts";
import { FakeClock } from "./fake-clock.ts";
import { tempDir } from "./helpers.ts";

describe("H1: exceptions never bypass the cleanup", () => {
  test("a report callback that throws doesn't skip the release or the close", async () => {
    const clock = new FakeClock();
    const released: string[] = [];
    const plan: Plan = { id: "p", steps: [{ do: "a" }, { do: "b" }], finally: [{ do: "release" }] };
    const result = await runPlan(plan, {
      clock,
      executor: { run: async (action) => { released.push(action.do); return { ok: true }; } },
      report: () => { throw new Error("the consumer's stream broke"); },
    });
    expect(released).toEqual(["a", "b", "release"]);
    expect(result.reports.at(-1)!.kind).toBe("close");
    expect(result.report_errors!.length).toBeGreaterThan(0);
  });

  test("an executor that throws outside its own guard still ends in one close, after the release", async () => {
    const clock = new FakeClock();
    const done: string[] = [];
    const result = await runPlan({ id: "p", steps: [{ do: "a" }], finally: [{ do: "release" }] }, {
      clock,
      executor: { run: async (action) => { done.push(action.do); return { ok: true }; }, snapshot: async () => { throw new Error("blackboard broke"); } },
    });
    expect(done).toEqual(["a", "release"]);
    expect(result.reports.filter((r) => r.kind === "close").length).toBe(1);
  });

  test("a report that can't be written still lets the teardown restore config.ini and close the connection", async () => {
    const clock = new FakeClock();
    const dir = tempDir("xfb-review-");
    const mod = stagedMod(dir);
    // The manifest's path is taken by a folder, so every report write throws.
    mkdirSync(join(dir, "out", "manifest.json"), { recursive: true });
    const api = fakeApi(clock);
    const rows = [{ id: "r", title: "r", requires: [{ config: "overlay.enabled", equals: "true" }], steps: [{ do: "set", value: 1 }] }];
    const result = await go(script(rows), api, fakeHost({ running: false }), clock, dir, { fixtures: { staged_mod: mod, mo2: { exe: "m", profile: "p", executable: "g" } } });
    expect(readFileSync(stagedConfigPath(mod), "utf8")).toBe(STAGED_INI);
    expect(api.closed).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.cleanupErrors.some((e) => e.includes("report"))).toBe(true);
  });
});
