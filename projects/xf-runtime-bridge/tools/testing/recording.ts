// Private streaming copy of the native recorder. One CommandApi connection, bounded pages/chunks.
// Native files also drain after kill closes the pipe; an interrupted tools copy remains incomplete.
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { clock as defaultClock, read, type Clock, type Json, type TestApi } from "./windows.ts";

export type RecordingOptions = {
  directory: string; channels?: ("v" | "actors" | "camera" | "subtitles" | "voice" | "face" | "ui")[]; actors?: string[];
  duration_s?: number; byte_cap?: number; signal?: AbortSignal; clock?: Clock;
};

/** New private directory required; bounded synchronous writes keep at most one 5-record page in memory. */
export async function recordSources(api: TestApi, options: RecordingOptions): Promise<Json> {
  if (options.signal?.aborted) throw new Error("Recording aborted before start");
  const directory = resolve(options.directory), clock = options.clock ?? defaultClock;
  mkdirSync(directory, { recursive: false });
  const cap = options.byte_cap ?? 64 * 1024 * 1024;
  let start: Json | undefined, last: Json | undefined, cursor = 0, bytes = 0, lost = 0;
  let chunkBytes = 0, chunk = 0, hash = createHash("sha256"), error = "", finalized = false, finished = false;
  const chunks: Json[] = [], calibration: Json[] = [];
  const finishChunk = () => {
    if (!chunk || finalized) return;
    chunks[chunks.length - 1]!.sha256 = hash.digest("hex"); finalized = true;
  };
  const manifest = (): Json => ({ schema: "xfb/recording-copy-1", run: start?.run, source: start,
    status: last, chunks, bytes, cursor, lost, error, clock_calibration: calibration,
    complete: finished && cursor > 0 && !!start && !!last && !last.active && cursor === last.latest && !error && !lost &&
      last.dropped === 0 && last.missed_deadlines === 0 && last.invalid === 0 && !last.file_error });
  const checkpoint = () => {
    writeFileSync(join(directory, "manifest.json.tmp"), JSON.stringify(manifest(), null, 2) + "\n");
    renameSync(join(directory, "manifest.json.tmp"), join(directory, "manifest.json"));
  };
  const savePage = (page: Json) => {
    if (!start || page.run !== start.run || page.session !== start.session || page.world_generation !== start.world_generation ||
        !Array.isArray(page.records) || page.records.length > 5 || !Number.isSafeInteger(page.next) || page.next < cursor || page.next > page.latest ||
        !Number.isSafeInteger(page.lost) || page.lost < 0) throw new Error("Invalid recorder identity or cursor");
    let previous = cursor;
    for (const row of page.records) {
      if (!Number.isSafeInteger(row.seq) || row.seq <= previous || row.seq > page.next || row.run !== start.run ||
          row.session !== start.session || row.world_generation !== start.world_generation || !Number.isFinite(row.source_s) ||
          !Number.isFinite(row.age_s) || typeof row.valid !== "boolean") throw new Error("Invalid source record");
      previous = row.seq;
      const line = JSON.stringify(row) + "\n", size = Buffer.byteLength(line);
      if (size > 16384 || bytes + size > cap) throw new Error("Private recording byte cap reached");
      if (!chunk || chunkBytes + size > 1024 * 1024) {
        finishChunk(); chunk++; chunkBytes = 0; hash = createHash("sha256"); finalized = false;
        const file = `chunk-${chunk}.jsonl`;
        writeFileSync(join(directory, file), "", { flag: "wx" }); chunks.push({ file, bytes: 0 });
      }
      appendFileSync(join(directory, chunks[chunks.length - 1]!.file), line);
      hash.update(line); chunkBytes += size; bytes += size; chunks[chunks.length - 1]!.bytes = chunkBytes;
    }
    // Count unexplained skips independently of the producer's reported loss.
    const unaccounted = page.next - cursor - page.records.length;
    lost += Math.max(page.lost, unaccounted);
    cursor = page.next; last = page; checkpoint();
  };
  try {
    const before = clock.now();
    start = await read(api, "test.record.start", { channels: options.channels ?? ["v", "actors", "camera"],
      actors: options.actors ?? [], rate_hz: 10, duration_s: options.duration_s ?? 60, byte_cap: cap }, options.signal);
    if (!Number.isSafeInteger(start.run) || !start.run || typeof start.session !== "string") throw new Error("Invalid recording start");
    const after = clock.now();
    calibration.push({ host_before_ms: before, host_after_ms: after, source_s: start.source_now_s,
      offset_min_ms: before - start.source_now_s * 1000, offset_max_ms: after - start.source_now_s * 1000,
      uncertainty_ms: (after - before) / 2 });
    checkpoint();
    while (!options.signal?.aborted && clock.now() - after < (options.duration_s ?? 60) * 1000 + 1000) {
      for (let batch = 0; batch < 4; batch++) {
        if (options.signal?.aborted) break;
        const page = await read(api, "test.record.read", { run: start.run, since: cursor, limit: 5 }, options.signal);
        savePage(page);
        if (cursor === page.latest) break;
      }
      if (last && !last.active && cursor === last.latest) break;
      await clock.sleep(250, options.signal);
    }
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  finally {
    if (start) {
      try {
        // No aborted signal on cleanup. Stop is on the emergency route.
        await read(api, "test.record.stop");
        // Ring capacity 512, five rows per page; bounded even with holes and a final ack.
        for (let i = 0; i < 105; i++) {
          const page = await read(api, "test.record.read", { run: start.run, since: cursor, limit: 5 });
          const previous = cursor; savePage(page);
          if (!page.active && cursor === page.latest && previous === cursor) break;
          if (i === 104) throw new Error("Recorder drain did not finish");
        }
      } catch (e) { error += `${error ? "; " : ""}cleanup: ${e instanceof Error ? e.message : String(e)}`; }
    }
    finishChunk(); finished = true; checkpoint();
  }
  return manifest();
}
