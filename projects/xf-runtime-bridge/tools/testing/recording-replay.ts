// Replay the native writer's existing private chunks. Cursor offsets are not another history store.
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import type { Json } from "./windows.ts";
export type FileCursor = { file_chunk?: number; file_offset?: number };

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
