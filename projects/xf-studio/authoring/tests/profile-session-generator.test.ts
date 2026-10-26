import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { run } from "./fixtures/profile-session-generator";

test("G3 generator: 2,000 seeds of 20–60 operations, with exact history round trips and atomic refusals", async () => {
  // Independent seeds share no state. Six bounded workers keep the every-step laws within the responsiveness budget.
  const workers: Worker[] = [];
  try {
    const shards = 6;
    const counts = await Promise.all(Array.from({ length: shards }, (_, shard) => new Promise<number>((resolve, reject) => {
      const worker = new Worker(new URL("./fixtures/profile-session-generator.ts", import.meta.url), {
        workerData: { first: Math.floor(shard * 2000 / shards) + 1, last: Math.floor((shard + 1) * 2000 / shards) },
      });
      workers.push(worker);
      const deadline = setTimeout(() => reject(new Error(`G3 worker ${shard} exceeded its 120-second deadline`)), 120_000);
      let replied = false;
      worker.once("message", (message: { count: number; error?: string }) => {
        clearTimeout(deadline);
        replied = true;
        if (message.error) reject(new Error(message.error)); else resolve(message.count);
      });
      worker.once("error", error => { clearTimeout(deadline); reject(error); });
      worker.once("exit", code => { clearTimeout(deadline); if (!replied) reject(new Error(`G3 worker exited without a result (${code})`)); });
    })));
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(79676);
    console.log("G3 generator: 2000 seeds, 79676 generated operations, every-step start/end and Undo/Redo probes.");
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}, 130_000);

test("G3 seed 717: a parked peer remains an ordering reference across Add/Reset/Duplicate and partial jumps", () => {
  run(717, [
    { op: "add", tab: 14, panel: 15, value: 6156 }, { op: "reset", tab: 3, panel: 8, value: 7877 },
    { op: "add", tab: 8, panel: 8, value: 3620 }, { op: "duplicate", tab: 12, panel: 3, value: 1210 },
    { op: "bind", tab: 9, panel: 4, value: 1544 }, { op: "park", tab: 0, panel: 14, value: 3660 },
    { op: "start", tab: 6, panel: 10, value: 931 }, { op: "point", tab: 6, panel: 13, value: 7789 },
  ]);
});

test("G3 seed 1284: later drags retain floating-window order while several Add steps replay together", () => {
  run(1284, [
    { op: "reset", tab: 3, panel: 0, value: 7799 }, { op: "add", tab: 5, panel: 7, value: 7073 },
    { op: "drag", tab: 5, panel: 8, value: 8334 }, { op: "drag", tab: 7, panel: 1, value: 7354 },
    { op: "add", tab: 15, panel: 3, value: 8085 }, { op: "drag", tab: 2, panel: 12, value: 8516 },
  ]);
});
