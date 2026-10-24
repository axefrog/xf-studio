import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { waitForLoadEnd, refuseContinue } from "../api/load-continue.ts";
import type { CommandContext } from "../api/catalogue.ts";
import { packageScripts } from "../redscript-natives.ts";
import { projectDir, selftestExe, startSelftestHost, tempDir } from "./helpers.ts";
import { CommandApi } from "../api/command-api.ts";
import { catchUp } from "../testing/timeline.ts";
import type { TestApi, Json } from "../testing/windows.ts";

test("load helper requires a fresh observed initial offer, not attachment, origin or a bool", async () => {
  for (const extra of [{ waiting_for_input: true }, { prompt_observed: true, prompt_state: "initial_continue", lifecycle: { fresh: false, complete: true } },
    { prompt_observed: true, prompt_state: "start_screen", lifecycle: { fresh: true, complete: true } },
    { prompt_observed: true, prompt_state: "initial_continue", lifecycle: { fresh: true, complete: false } }]) {
    let now = 0;
    const context = { cid: "test", api: { callBridge: async () => ({ ok: true, result: { phase: "loading", ...extra } }) } } as unknown as CommandContext;
    const result = await waitForLoadEnd(context, { waitMs: 2500, now: () => now, sleep: async ms => { now += ms; } });
    expect(result.reached).toBe("loading"); expect(result.waiting_for_input).not.toBe(true);
  }
});
test("initial offer is returned with its observed state and normal gameplay load needs no prompt", async () => {
  for (const phase of ["loading", "gameplay"]) {
    let now = 0;
    const context = { cid: "test", api: { callBridge: async () => ({ ok: true, result: { phase,
      prompt_state: phase === "loading" ? "initial_continue" : "none", prompt_observed: true, lifecycle: { fresh: true, complete: true, generation: 4 } } }) } } as unknown as CommandContext;
    const result = await waitForLoadEnd(context, { waitMs: 5000, now: () => now, sleep: async ms => { now += ms; } });
    expect(result.reached).toBe(phase === "loading" ? "press_any_key" : "gameplay");
    expect(result.lifecycle.generation).toBe(4); expect(result.prompt_observed).toBe(true);
  }
  expect(() => refuseContinue()).toThrow("uncommissioned");
});
test("native UI observer and declaration stay autonomous; no consumer or quit invocation", () => {
  const normal = packageScripts(projectDir, "writes", false).map(s => s.text).join("\n");
  const autonomous = packageScripts(projectDir, "writes", true).map(s => s.text).join("\n");
  expect(normal).not.toContain("XFBridge_LifecycleMenu");
  expect(autonomous).toContain('GetMenu(n"engagement_screen")');
  const native = readFileSync(join(projectDir, "native/src/plugin/Lifecycle.cpp"), "utf8");
  expect(native).toContain("#ifdef XFB_AUTONOMOUS_TEST_HOOKS");
  expect(native).toContain("resolve(673454961)");
  expect(native).not.toContain('ScriptCall(');
  expect(native).toContain("original(system, value, buffer)");
});
test("unknown placement produces a catch-up warning without inventing contact", async () => {
  const row = { seq: 1, run: 1, session: "s", world_generation: 1, source_s: 10, valid: true,
    channel: "contacts", data: { event: "placement.traffic", traffic_risk: "unknown", position: [1, 2, 3] } };
  const api: TestApi = { run: async (name, input: Json = {}) => ({ ok: true, command: name, cid: "t", result:
    name === "bridge.info" ? { sid: "s" } : name === "test.record.read" ? { run: 1, session: "s", world_generation: 1,
      latest: 1, next: 1, lost: 0, records: input.since ? [] : [row] } : { events: [], latest: 0, next: 0, dropped: 0 } }) };
  const result = await catchUp(api, { run: 1, digest: false });
  expect(result.alerts[0]).toMatchObject({ kind: "traffic_risk", traffic_risk: "unknown" });
  expect(result.contact_summary.observed_since_cursor).toBe(false);
});

test.skipIf(!readFileSync(selftestExe).includes(Buffer.from("XFB_AUTONOMOUS_TEST_HOOKS=1")))("read-only probe crosses the real pipe and refuses a changed generation", async () => {
  const host = await startSelftestHost(["--allow-writes", "--allow-test-hooks"]);
  const dir = tempDir("xfb-lifecycle-api-");
  const api = new CommandApi({ runtimeDir: host.dir, auditDir: join(dir, "audit") });
  try {
    const first = await api.run("game.lifecycle.probe", { generation: 0 });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.result).toMatchObject({ called: false, admissible: false, would_call: null, observed: { prompt_state: "unknown" } });
    const stale = await api.run("game.lifecycle.probe", { generation: 1 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("precondition_failed");
  } finally { api.close(); await host.stop(); }
}, 60000);
