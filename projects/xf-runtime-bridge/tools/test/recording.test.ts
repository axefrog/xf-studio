import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordSources } from "../testing/recording.ts";
import { CommandApi } from "../api/command-api.ts";
import { startSelftestHost, tempDir, type Host, sleep, selftestExe } from "./helpers.ts";
import type { TestApi, Json } from "../testing/windows.ts";

function fixture(mode = "normal") {
  const controller = new AbortController();
  let now = 0, active = true, stopped = false, cursor = 0;
  const row = (seq: number) => ({ schema: "xfb/source-record-1", run: 7, session: "fixture", world_generation: 1,
    seq, source_s: seq * 0.1, age_s: 0, valid: true, channel: "v", data: { position: [seq, 0, 0] } });
  const calls: string[] = [], starts: Json[] = [];
  const api: TestApi = { run: async (name, input) => {
    calls.push(name);
    if (mode === "disconnect" && stopped && name === "test.record.read") return { ok: false, command: name, cid: "x", error: { code: "disconnected", message: "kill closed the pipe" } };
    let result: Json;
    if (name === "test.record.start") { starts.push(input as Json); result = { run: 7, session: "fixture", world_generation: 1, source_now_s: 0, output: "native-private-copy" }; }
    else if (name === "test.record.stop") { stopped = true; active = false; result = {}; }
    else {
      const since = Number((input as Json)?.since ?? 0);
      cursor = Math.min(8, since + 5);
      if (mode === "abort") controller.abort();
      if (mode === "disconnect") throw new Error("source transport lost");
      result = { run: 7, session: mode === "wrong_session" ? "other" : "fixture", world_generation: 1,
        active: active && cursor < 8, latest: 8, next: cursor, lost: mode === "loss" ? 1 : 0,
        dropped: mode === "loss" ? 1 : 0, invalid: mode === "invalid" ? 1 : 0,
        missed_deadlines: mode === "slow" ? 1 : 0, records: Array.from({ length: cursor - since }, (_, i) => row(since + i + 1)) };
    }
    return { ok: true, command: name, cid: "x", result };
  } };
  return { api, calls, starts, controller, clock: { now: () => now, sleep: async (ms: number) => { now += ms; } } };
}

test("stream private chunks, hash and finalize after bounded drain", async () => {
  const f = fixture(), directory = join(tempDir("xfb-recording-"), "private");
  const manifest = await recordSources(f.api, { directory, duration_s: 1, clock: f.clock });
  expect(manifest.complete).toBe(true); expect(manifest.cursor).toBe(8);
  expect(manifest.chunks).toHaveLength(1); expect(manifest.chunks[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(readFileSync(join(directory, "chunk-1.jsonl"), "utf8").trim().split("\n")).toHaveLength(8);
  expect(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")).complete).toBe(true);
  expect(f.calls).toContain("test.record.stop");
  expect(f.starts[0]!.channels).toContain("contacts");
});
for (const mode of ["loss", "invalid", "slow", "wrong_session", "disconnect"]) test(`${mode} cannot claim a complete recording`, async () => {
  const f = fixture(mode);
  const result = await recordSources(f.api, { directory: join(tempDir("xfb-recording-"), "private"), duration_s: 1, clock: f.clock });
  expect(result.complete).toBe(false); expect(f.calls).toContain("test.record.stop");
});
test("cancel stops and drains without passing the aborted signal into cleanup", async () => {
  const f = fixture("abort");
  const result = await recordSources(f.api, { directory: join(tempDir("xfb-recording-"), "private"), signal: f.controller.signal, clock: f.clock });
  expect(f.calls).toContain("test.record.stop"); expect(result.cursor).toBe(8); expect(result.complete).toBe(true);
});
test("existing private directory is never overwritten", async () => {
  const f = fixture();
  await expect(recordSources(f.api, { directory: tempDir("xfb-recording-"), clock: f.clock })).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});

let host: Host, api: CommandApi;
const candidate = readFileSync(selftestExe).includes(Buffer.from("XFB_AUTONOMOUS_TEST_HOOKS=1"));
beforeAll(async () => {
  if (!candidate) return;
  host = await startSelftestHost(["--allow-writes", "--allow-test-hooks"]);
  const dir = tempDir("xfb-record-api-");
  api = new CommandApi({ runtimeDir: host.dir, auditDir: join(dir, "audit"), captureRoot: join(dir, "capture"), idleCloseMs: 3000 });
}, 60000);
afterAll(async () => { api?.close(); if (host) await host.stop(); });
test.skipIf(!candidate)("real pipe registers recorder, samples at source, stops through emergency route and drains", async () => {
  const start = await api.run("test.record.start", { channels: ["v"], duration_s: 2 });
  expect(start.ok).toBe(true); if (!start.ok) return;
  const run = (start.result as Json).run;
  await sleep(350);
  const stop = await api.run("test.record.stop", {}); expect(stop.ok).toBe(true);
  const page = await api.run("test.record.read", { run }); expect(page.ok).toBe(true);
  if (page.ok) {
    const p = page.result as Json;
    expect(p.active).toBe(false); expect(p.sample_ticks).toBeGreaterThanOrEqual(2);
    expect(p.records[0].data.simulated).toBe(true); expect(p.records[0].source_s).toBeGreaterThan(0);
    expect(p.records[0].channel).toBe("v");
  }
});
