import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { recordingClock } from "../testing/recording-replay.ts";
import { requireAutonomousSelftest, startSelftestHost, sleep } from "./helpers.ts";

test("manifest clock interpolates chunk calibrations and round trips UTC milliseconds", () => {
  const manifest = { start_s: 10, start_at: "2026-10-27T00:00:00.000Z",
    chunks: [{ sync: { s: 20, at: "2026-10-27T00:00:10.002Z", uncertainty_ms: 0.01 } }] };
  const clock = recordingClock(manifest);
  expect(clock.toWallTime(15)).toBe("2026-10-27T00:00:05.001Z");
  for (const s of [0, 10, 15, 20, 30]) expect(clock.fromWallTime(clock.toWallTime(s))).toBeCloseTo(s, 3);
  expect(() => recordingClock({})).toThrow("calibration");
  expect(() => clock.fromWallTime("not a date")).toThrow("finite");
  const adjusted = recordingClock({ start_s: 10, start_at: manifest.start_at, chunks: [{ sync: { s: 20, at: "2026-10-26T23:59:59.000Z" } }] });
  expect(adjusted.toWallTime(20)).toBe("2026-10-26T23:59:59.000Z");
  expect(() => adjusted.fromWallTime(manifest.start_at)).toThrow("ambiguous");
  const quantized = recordingClock({ ...manifest, chunks: [{ sync: { s: 10.0001, at: manifest.start_at } }] });
  expect(quantized.fromWallTime(quantized.toWallTime(10.0001))).toBeCloseTo(10.0001, 3);
});

test("writer observations reach reader session.events and detailed catchup; native manifest agrees with live start", async () => {
  requireAutonomousSelftest();
  const host = await startSelftestHost(["--allow-test-hooks"]);
  const options = { runtimeDir: host.dir, idleCloseMs: 60000, auditDir: join(host.dir, "audit") };
  const writer = new CommandApi(options), reader = new CommandApi({ ...options, readOnly: true });
  try {
    const start = await writer.run("test.record.start", { channels: ["v"], duration_s: 3 });
    expect(start.ok).toBe(true); if (!start.ok) return;
    const run = (start.result as any).run;
    const observation = await writer.run("world.probe", { around_v: true, count: 1, radius_m: 5 });
    expect(observation.ok).toBe(true);
    const events = await reader.run("session.events", { kinds: ["observe.result"] });
    expect(events.ok).toBe(true);
    if (events.ok) {
      const row = (events.result as any).events.at(-1);
      expect(row.data.command).toBe("world.probe");
      expect(row.data.cid).toBe(observation.cid); expect(row.data.connection).toBeGreaterThan(0);
      expect(row.data.truncated).toBe(false);
      if (observation.ok) expect(row.data.result).toEqual(observation.result);
    }
    await sleep(150);
    const catchup = await reader.run("game.catchup", { run, detail: true });
    expect(catchup.ok).toBe(true);
    if (catchup.ok) expect((catchup.result as any).events.some((e: any) => e.kind === "observe.result" && e.data.cid === observation.cid)).toBe(true);
    const live = await reader.run("recorder.status");
    expect(live.ok).toBe(true);
    expect((await writer.run("test.record.stop")).ok).toBe(true);
    // The writer owns finalisation; no arbitrary sleeps or unbounded polling.
    let page: any;
    for (let i = 0; i < 100; ++i) {
      const read = await writer.run("test.record.read", { run });
      expect(read.ok).toBe(true); if (!read.ok) return;
      page = read.result;
      if (!page.writer_pending) break;
      await sleep(20);
    }
    expect(page.writer_pending).toBe(false);
    const manifest = JSON.parse(readFileSync(join(page.output, "manifest.json"), "utf8"));
    if (live.ok) expect(manifest.start_sync).toEqual((live.result as any).start);
    expect(manifest.start_at).toBe(manifest.start_sync.at);
    expect(manifest.chunks[0].sync.uncertainty_ms).toBeGreaterThanOrEqual(0);
    const clock = recordingClock(manifest);
    expect(clock.fromWallTime(clock.toWallTime(manifest.start_s))).toBeCloseTo(manifest.start_s, 3);
  } finally { writer.close(); reader.close(); await host.stop(); }
}, 15000);

// Set XFB_OBSERVER_ROUNDS=20 for the published measurement. Every reader keeps its own returned cursor and
// starts one detail:true catch-up a second, alongside one real game-thread writer request a second.
test("measure three versus six 1 Hz detailed catchup readers beside a writer", async () => {
  requireAutonomousSelftest();
  const rounds = Math.max(3, Math.min(60, Number(process.env.XFB_OBSERVER_ROUNDS) || 3));
  const figures: any[] = [];
  for (const slots of [3, 6]) {
    const host = await startSelftestHost(["--reader-slots", String(slots), "--allow-test-hooks", "--allow-writes", "--write-classes", "world"]);
    expect(host.session.read_only_pipes).toHaveLength(slots);
    const options = { runtimeDir: host.dir, idleCloseMs: 60000, auditDir: join(host.dir, "audit"), rateLimitPatienceMs: 0 };
    const writer = new CommandApi(options);
    const readers = Array.from({ length: slots }, () => new CommandApi({ ...options, readOnly: true }));
    const cursors: any[] = [], latency: number[] = [], readerErrors: Record<string, number> = {};
    const errorExamples: unknown[] = [];
    let reads = 0, writerFailures = 0;
    try {
      const start = await writer.run("test.record.start", { channels: ["v", "actors", "camera"], duration_s: rounds + 10 });
      expect(start.ok).toBe(true); if (!start.ok) return;
      // Measure persistent observers, with pipe discovery/connection setup outside the timed rounds.
      const ready = await Promise.all(readers.map(reader => reader.run("recorder.status")));
      expect(ready.every(r => r.ok)).toBe(true);
      const before = await writer.run("bridge.info");
      expect(before.ok).toBe(true);
      const begun = performance.now();
      for (let round = 0; round < rounds; ++round) {
        await sleep(Math.max(0, begun + round * 1000 - performance.now()));
        await Promise.all([
          (async () => { const at = performance.now(); const r = await writer.run("world.time.set", { hours: 12 }); latency.push(performance.now() - at); if (!r.ok) writerFailures++; })(),
          ...readers.map(async (reader, i) => {
            const r = await reader.run("game.catchup", { run: (start.result as any).run, ...(cursors[i] ? { cursor: cursors[i] } : {}), detail: true, now: false });
            if (r.ok) { cursors[i] = (r.result as any).cursor; reads++; }
            else { readerErrors[r.error.code] = (readerErrors[r.error.code] ?? 0) + 1; if (errorExamples.length < 2) errorExamples.push(r.error); }
          }),
        ]);
      }
      const elapsed = performance.now() - begun;
      const after = await writer.run("bridge.info"); expect(after.ok).toBe(true);
      const firstWriterMs = latency[0];
      latency.sort((a, b) => a - b);
      figures.push({ slots, rounds, elapsed_ms: Math.round(elapsed), reads, reader_errors: readerErrors, error_examples: errorExamples, writer_failures: writerFailures,
        pipe_cpu_ms: before.ok && after.ok ? (after.result as any).pipe_cpu_ms - (before.result as any).pipe_cpu_ms : null,
        writer_first_ms: firstWriterMs, writer_mean_ms: latency.reduce((a, b) => a + b, 0) / latency.length, writer_p95_ms: latency[Math.ceil(latency.length * 0.95) - 1], writer_max_ms: latency.at(-1) });
      expect(writerFailures).toBe(0); expect(reads + Object.values(readerErrors).reduce((a, b) => a + b, 0)).toBe(slots * rounds);
      expect(readerErrors).toEqual({});
    } finally { writer.close(); for (const reader of readers) reader.close(); await host.stop(); }
  }
  console.log("OBSERVER MEASUREMENT " + JSON.stringify(figures));
}, 150000);
