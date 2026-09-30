/**
 * The cost of the compaction keep-set as streams grow: one node's stream of `n` entries, and another node's stream of
 * `n` entries each pinning one of them (an entry reference), so every pin is looked up by seq and read at its point.
 * With entries looked up by seq and points found by binary search, doubling `n` roughly doubles the time (it was
 * quadratic: each lookup walked the stream). `bun tests/bench/compaction.ts` prints the times.
 */
import { keepSet } from "../../src/compaction";
import type { Stream } from "../../src/compaction";
import { SYNTHETIC_TYPES } from "../../src/testing/synthetic";
import type { Entry } from "../../src/types";

const defs = (type: string) => SYNTHETIC_TYPES.find(def => def.type === type);
const entry = (id: string, seq: number, pos: number, op: Entry["op"]): Entry =>
  ({ node: { type: "item", id }, seq, pos, commit: `${id}-${seq}`, actor: "a", actorSeq: pos, at: pos, schema: "2", op }) as Entry;

/** Two streams of `n` entries: a target, and a holder whose every entry pins one of the target's. */
export function pinnedStreams(n: number): Stream[] {
  const target: Entry[] = [entry("t", 1, 1, { kind: "create", state: { name: "t", own: {}, layers: [], trashed: false, retracted: false } })];
  for (let seq = 2; seq <= n; seq++) target.push(entry("t", seq, seq, { kind: "set", path: ["title"], value: `v${seq}` }));
  const holder: Entry[] = [entry("h", 1, n + 1, { kind: "create", state: { name: "h", own: {}, layers: [], trashed: false, retracted: false } })];
  for (let seq = 2; seq <= n; seq++) holder.push(entry("h", seq, n + seq, { kind: "set", path: ["pin"], value: { node: { type: "item", id: "t" }, seq } }));
  return [{ ref: { type: "item", id: "t" }, entries: target }, { ref: { type: "item", id: "h" }, entries: holder }];
}

/** Milliseconds for the keep-set of `pinnedStreams(n)` (the best of three). */
export function keepSetMs(n: number): number {
  const streams = pinnedStreams(n);
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    keepSet(streams, defs);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

if (import.meta.main) for (const n of [2_000, 4_000, 8_000, 16_000]) console.log(`${n} pins: ${keepSetMs(n).toFixed(1)} ms`);
