import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { EventCaptures } from "../testing/event-captures.ts";
import type { Json, TestApi } from "../testing/windows.ts";
import { projectDir, tempDir } from "./helpers.ts";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const ok = (result: Json = {}) => ({ v: 1 as const, id: 1, cid: "review", ok: true as const, result });
function owner(call: (method: string) => Promise<ReturnType<typeof ok>>) {
  const dir = tempDir("xfb-review-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "review", pid: process.pid, pipe: "fixture", token: "t", started_at: new Date().toISOString(), plugin_version: "test", allow_writes: true }));
  return new CommandApi({ runtimeDir: dir, auditDir: dir, transport: async () => ({ call, close() {} }), controlTransport: async () => ({ call: async () => ok(), close() {} }) });
}
function initial(block = Promise.resolve()): TestApi {
  return { run: async name => {
    await block;
    return { ok: true, command: name, cid: "review", result: name === "bridge.info" ? { sid: "review" } : name === "test.record.read" ?
      { run: 1, session: "review", world_generation: 1, active: true, latest: 0, next: 0, lost: 0, source_now_s: 1, records: [] } :
      { events: [], next: 0, latest: 0, dropped: 0 } };
  } };
}
const armInput = { run: 1, event: "toast.created", capture: "screenshot" as const };

test("spawn guards use an entity-only reader with no watcher subscription or event drain", () => {
  const cpp = readFileSync(join(projectDir, "native/src/plugin/HandlersDm080.cpp"), "utf8");
  const guard = cpp.split("json DmGuardPresent()")[1]!.split("void StopDm")[0]!;
  expect(guard).not.toContain(".Spawned(");
  const script = readFileSync(join(projectDir, "redscript-dm/XFRuntimeBridgeDm.reds"), "utf8");
  const presence = script.split("public static func Presence(")[1]?.split("public static func")[0];
  expect(presence).toBeDefined();
  expect(presence).not.toMatch(/Listen\(|DrainEvents\(/);
});
test("stop cancels an earlier start still waiting in the outer queue", async () => {
  const gate = deferred(), calls: string[] = [];
  const api = owner(async method => { calls.push(method); return ok(); });
  try {
    (api as any).queue = gate.promise;
    const start = api.run("test.record.start", { duration_s: 60 });
    await api.run("test.record.stop");
    gate.resolve();
    expect((await start).ok).toBe(false);
    expect(calls).not.toContain("test.record.start");
    expect((api as any).recordingActive).toBe(false);
    expect((await api.run("test.record.start")).ok).toBe(true);
  } finally { gate.resolve(); api.close(); }
});
test("a start response arriving after stop cannot restore the owner lease", async () => {
  const gate = deferred(), entered = deferred();
  const api = owner(async method => { if (method === "test.record.start") { entered.resolve(); await gate.promise; } return ok(); });
  try {
    const start = api.run("test.record.start"); await entered.promise;
    await api.run("test.record.stop"); gate.resolve(); await start;
    expect((api as any).recordingActive).toBe(false);
  } finally { gate.resolve(); api.close(); }
});
test("recorder heartbeat bypasses a busy local command queue and ends on stop", async () => {
  const gate = deferred(), calls: string[] = [];
  const api = owner(async method => { calls.push(method); return ok(); });
  try {
    await api.run("test.record.start", { duration_s: 60 });
    (api as any).queue = gate.promise; // A local burst owns the outer queue, without a pipe request.
    await Bun.sleep(2150);
    expect(calls).toContain("ping");
    await api.run("test.record.stop");
    const count = calls.length;
    await Bun.sleep(30); expect(calls.length).toBe(count);
  } finally { gate.resolve(); api.close(); }
});
test("pending arm reserves its slot and disarm prevents its later installation", async () => {
  const gate = deferred(), arms = new EventCaptures(initial());
  const pending = arms.arm(armInput, initial(gate.promise));
  const settled = pending.catch(e => e);
  expect(arms.status().armed).toBe(true);
  await expect(arms.arm(armInput, initial())).rejects.toThrow("already armed");
  arms.cancel(); gate.resolve(); await settled;
  expect(arms.status().armed).toBe(false);
});
test("heartbeat does not time out behind native traffic already using the connection", async () => {
  const gate = deferred(), entered = deferred(), calls: string[] = [];
  const api = owner(async method => { calls.push(method); if (method === "test.record.read") { entered.resolve(); await gate.promise; } return ok(); });
  try {
    await api.run("test.record.start");
    const native = api.callBridge("test.record.read", { run: 1 }, "review"); await entered.promise;
    await Bun.sleep(2150); expect(calls).not.toContain("ping"); expect((api as any).recordingActive).toBe(true);
    gate.resolve(); await native;
  } finally { gate.resolve(); api.close(); }
});
test("stopped source cannot trigger retained events, including a count-one arm", async () => {
  for (const count of [1, 2]) {
    let captures = 0;
    const api: TestApi = { run: async name => {
      if (name.startsWith("capture.")) captures++;
      return { ok: true, command: name, cid: "review", result: { cursor: {}, complete: true, source: { active: false }, records: [],
        events: [{ kind: "toast.created", source_s: 1, data: {} }], calibration: { source_s: 1, host_before_ms: 0, host_after_ms: 0 } } };
    } };
    const arms = new EventCaptures(api, { now: () => 0, sleep: async () => {} });
    try { await arms.arm({ ...armInput, count }, initial()); await arms.poll(); expect(captures).toBe(0); expect(arms.status().armed).toBe(false); }
    finally { arms.cancel(); }
  }
});
test("disconnect and close cancel an arm still reading its initial timeline", async () => {
  for (const action of ["disconnect", "close"] as const) {
    const gate = deferred(), api = owner(async () => ok());
    const pending = api.eventCaptures.arm(armInput, initial(gate.promise)).catch(e => e);
    api[action](); gate.resolve(); await pending;
    expect(api.eventCaptures.status().armed).toBe(false); api.close();
  }
});
test("owner disconnect aborts an event capture already waiting on its delay", async () => {
  const api = owner(async () => ok()), sleeping = deferred(); let signal: AbortSignal | undefined;
  (api.eventCaptures as any).api = { run: async () => ({ ok: true, result: { cursor: {}, complete: true, source: { active: true }, records: [],
    events: [{ kind: "toast.created", source_s: 1, data: {} }], calibration: { source_s: 1, host_before_ms: 0, host_after_ms: 0 } } }) };
  (api.eventCaptures as any).clock = { now: () => 0, sleep: async (_ms: number, s: AbortSignal) => { signal = s; sleeping.resolve(); await new Promise<void>(r => s.addEventListener("abort", () => r(), { once: true })); } };
  await api.eventCaptures.arm(armInput, initial()); const poll = api.eventCaptures.poll(); await sleeping.promise;
  api.disconnect();
  try { expect(signal?.aborted).toBe(true); expect(api.eventCaptures.status().armed).toBe(false); }
  finally { api.eventCaptures.cancel(); await poll; api.close(); }
});
