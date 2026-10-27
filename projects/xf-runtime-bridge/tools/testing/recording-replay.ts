// Replay the native writer's existing private chunks. Cursor offsets are not another history store.
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import type { Json } from "./windows.ts";
export type FileCursor = { file_chunk?: number; file_offset?: number };

/** Calibrated QPC/UTC mapping. Interpolate between chunk syncs; outside them use the nearest measured offset.
 * Uncertainty is the read interval in milliseconds, separate from UTC's 1 ms representation and OS clock accuracy.
 * An adjusted wall clock can go backwards: forward mapping remains available, but inverse mapping then refuses ambiguity.
 */
export function recordingClock(manifest: Json): { toWallTime: (s: number) => string; fromWallTime: (at: string) => number } {
  const start = manifest.start_sync ?? { s: manifest.start_s, at: manifest.start_at };
  const allPoints = [start, ...(manifest.chunks ?? []).map((c: Json) => c.sync)].map(p => {
    const ms = Date.parse(p?.at);
    if (!Number.isFinite(p?.s) || !Number.isFinite(ms)) throw new Error("Recording has no valid QPC/UTC calibration");
    return { s: Number(p.s), ms };
  }).sort((a, b) => a.s - b.s).filter((p, i, all) => i === 0 || p.s !== all[i - 1]!.s);
  const points: typeof allPoints = [];
  for (const point of allPoints) {
    const previous = points.at(-1);
    // Two reads within one UTC millisecond can have the same ISO representation without a clock adjustment.
    if (previous && point.ms === previous.ms && point.s - previous.s < 0.001) continue;
    points.push(point);
  }
  const map = (value: number, inverse: boolean) => {
    if (!Number.isFinite(value)) throw new Error("Expected a finite recording time");
    if (inverse && points.some((p, i) => i > 0 && p.ms <= points[i - 1]!.ms)) throw new Error("Wall clock changed backwards; inverse recording time is ambiguous");
    const x = (p: typeof points[number]) => inverse ? p.ms : p.s;
    const y = (p: typeof points[number]) => inverse ? p.s : p.ms;
    const scale = inverse ? 0.001 : 1000;
    const first = points[0]!, last = points.at(-1)!;
    if (value <= x(first)) return y(first) + (value - x(first)) * scale;
    if (value >= x(last)) return y(last) + (value - x(last)) * scale;
    const i = points.findIndex(p => x(p) >= value), a = points[i - 1]!, b = points[i]!;
    return y(a) + (value - x(a)) * (y(b) - y(a)) / (x(b) - x(a));
  };
  return { toWallTime: s => new Date(Math.round(map(s, false))).toISOString(), fromWallTime: at => map(Date.parse(at), true) };
}

export function replayRecording(status: Json, after: number, through: number, cursor: FileCursor): { rows: Json[]; next: number; budget: boolean; gap: boolean } {
  const rows: Json[] = [];
  let next = after, budget = 8 * 1024 * 1024, gap = false;
  if (!status.output) return { rows, next, budget: false, gap };
  const root = normalize(status.output);
  if (basename(root) !== `run-${status.run}` || basename(normalize(join(root, ".."))) !== status.session) throw new Error("Unexpected recorder output identity");
  cursor.file_chunk ??= 1; cursor.file_offset ??= 0;
  for (let files = 0; files < 16 && next < through && budget > 0 && rows.length < 1024; files++) {
    const path = join(root, `chunk-${cursor.file_chunk}.jsonl`);
    if (!existsSync(path)) break; // The writer can be a flush behind the ring.
    const size = statSync(path).size;
    if (size > 1024 * 1024 || cursor.file_offset > size) throw new Error("Invalid native recording chunk or offset");
    const count = Math.min(size - cursor.file_offset, budget);
    const data = Buffer.alloc(count), fd = openSync(path, "r");
    let bytes = 0;
    try { bytes = readSync(fd, data, 0, count, cursor.file_offset); } finally { closeSync(fd); }
    budget -= bytes;
    let offset = 0;
    while (offset < bytes && next < through && rows.length < 1024) {
      const end = data.indexOf(10, offset);
      if (end < 0 || end >= bytes) break; // Incomplete writer tail is never parsed or acknowledged.
      if (end - offset > 16384) throw new Error("Native recording row exceeds envelope cap");
      const row = JSON.parse(data.subarray(offset, end).toString("utf8")) as Json;
      offset = end + 1;
      if (!Number.isSafeInteger(row.seq) || row.seq < 1 || row.run !== status.run || row.session !== status.session || row.world_generation !== status.world_generation || !Number.isFinite(row.source_s)) throw new Error("Native recording identity/sequence mismatch");
      if (row.seq <= after) continue; // Ring tail already returned on the previous turn.
      if (row.seq <= next) throw new Error("Native recording sequence went backwards");
      if (row.seq !== next + 1) gap = true;
      // File age was measured when the writer drained; callers need age at this read.
      row.age_s = Math.max(0, status.source_now_s - row.source_s);
      rows.push(row); next = row.seq;
    }
    cursor.file_offset += offset;
    if (next >= through || rows.length >= 1024) break;
    if (cursor.file_offset < size) break; // Partial line, or bounded read; retry at the same line next turn.
    if (!existsSync(join(root, `chunk-${cursor.file_chunk + 1}.jsonl`))) break;
    cursor.file_chunk++; cursor.file_offset = 0;
  }
  return { rows, next, gap, budget: next < through && (budget <= 0 || rows.length >= 1024) };
}
