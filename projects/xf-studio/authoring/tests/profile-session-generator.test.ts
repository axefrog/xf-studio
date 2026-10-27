import { expect, test } from "bun:test";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { ProfileSessions } from "../src/app/profiles/profile-sessions";
import { run } from "./fixtures/profile-session-generator";

test("G3 generator: 2,000 seeds of 20–60 operations, with an independent reference model, navigation invariants and atomic refusals", async () => {
  const started = performance.now();
  // Independent seeds share no state, so they shard across up to six workers (fewer on smaller machines, such as CI runners).
  // The deadline only guards against a hang: correctness is the exact operation count and the laws, never the wall time.
  const workers: Worker[] = [];
  try {
    const shards = Math.max(1, Math.min(6, availableParallelism()));
    const counts = await Promise.all(Array.from({ length: shards }, (_, shard) => new Promise<number>((resolve, reject) => {
      const worker = new Worker(new URL("./fixtures/profile-session-generator.ts", import.meta.url), {
        workerData: { first: Math.floor(shard * 2000 / shards) + 1, last: Math.floor((shard + 1) * 2000 / shards) },
      });
      workers.push(worker);
      const deadline = setTimeout(() => reject(new Error(`G3 worker ${shard} exceeded its 240-second hang deadline`)), 240_000);
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
    const elapsed = performance.now() - started;
    console.log(`G3 generator: 2000 seeds, 79676 generated operations in ${(elapsed / 1000).toFixed(2)} s on ${shards} workers; every-step reference checks, real Undo/Redo and jumps, every-step start/end and Undo/Redo arrangement probes.`);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
}, 250_000);

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


test("G3 seed 670: a later floating split survives replay of an added view pane", () => {
  run(670, [
    { op: "reset", tab: 2, panel: 10, value: 1582 },
    { op: "addView", tab: 0, panel: 11, value: 7369 },
    { op: "split", tab: 15, panel: 8, value: 5403 },
  ]);
});


test("G3 seed 1673: replaying all members rebuilds a floating composite without growing it twice", () => {
  run(1673, [
    { op: "addView", tab: 15, panel: 15, value: 7628 },
    { op: "add", tab: 13, panel: 1, value: 120 },
    { op: "split", tab: 7, panel: 3, value: 3665 },
  ]);
});


test("G3 seed 1727: scene edits update closed fragments sharing that scene before any history passage", () => {
  run(1727, [
    { op: "addView", tab: 1, panel: 6, value: 7186 }, { op: "new", tab: 13, panel: 3, value: 3236 },
    { op: "addView", tab: 4, panel: 14, value: 1913 }, { op: "close", tab: 10, panel: 2, value: 1333 },
    { op: "duplicate", tab: 12, panel: 4, value: 3586 }, { op: "close", tab: 9, panel: 14, value: 5843 },
    { op: "scene", tab: 1, panel: 1, value: 8535 },
  ]);
});


test("G3 seed 1284 (expanded operations): several returning floating groups choose a surviving sibling", () => {
  run(1284, [
    { op: "addView", tab: 10, panel: 4, value: 2959 }, { op: "add", tab: 14, panel: 9, value: 9905 },
    { op: "add", tab: 6, panel: 13, value: 9718 }, { op: "split", tab: 1, panel: 8, value: 7808 },
    { op: "split", tab: 6, panel: 11, value: 5694 },
  ]);
});


test("G3 seed 1742: a resized floating split survives a minimum-width clamp during replay", () => {
  run(1742, [
    { op: "reset", tab: 0, panel: 0, value: 1582 }, { op: "addView", tab: 0, panel: 0, value: 7369 },
    { op: "split", tab: 0, panel: 0, value: 5403 }, { op: "resize", tab: 0, panel: 0, value: 137 },
  ]);
});

test("G3 oracle rejects a binding implementation that records nothing", () => {
  const original = ProfileSessions.prototype.setPanelBinding;
  ProfileSessions.prototype.setPanelBinding = () => {};
  try { expect(() => run(1, [{ op: "add", tab: 0, panel: 0, value: 0 }, { op: "bind", tab: 0, panel: 0, value: 1 }])).toThrow("reference recorded state"); }
  finally { ProfileSessions.prototype.setPanelBinding = original; }
});

test("G3 oracle rejects symmetric Undo/Redo navigation restoration", () => {
  const original = ProfileSessions.prototype.setPanelBinding;
  ProfileSessions.prototype.setPanelBinding = function(tab, instance, binding) {
    original.call(this, tab, instance, binding);
    let last = JSON.stringify(this.panel(instance)?.binding);
    this.subscribe(() => {
      const now = JSON.stringify(this.panel(instance)?.binding);
      if (now !== last) { last = now; this.show(tab); }
    });
  };
  try { expect(() => run(2, [
    { op: "reset", tab: 0, panel: 0, value: 1 }, { op: "new", tab: 0, panel: 0, value: 2 },
    { op: "bind", tab: 0, panel: 0, value: 1 }, { op: "switch", tab: 1, panel: 0, value: 0 },
    { op: "undo", tab: 0, panel: 0, value: 0 },
  ])).toThrow("reference recorded state"); }
  finally { ProfileSessions.prototype.setPanelBinding = original; }
});


test("G3 seed 1875: dragging a peer on a partial Redo branch keeps the retained pane's window size", () => {
  run(1875, [
    { op: "add", tab: 6, panel: 13, value: 8739 }, { op: "addView", tab: 5, panel: 0, value: 7900 },
    { op: "bind", tab: 12, panel: 2, value: 9493 }, { op: "split", tab: 1, panel: 8, value: 2793 },
    { op: "closeView", tab: 1, panel: 2, value: 4955 }, { op: "bind", tab: 9, panel: 12, value: 7896 },
    { op: "add", tab: 12, panel: 15, value: 18 }, { op: "bind", tab: 1, panel: 0, value: 3680 },
    { op: "point", tab: 1, panel: 15, value: 646 }, { op: "split", tab: 3, panel: 12, value: 1749 },
    { op: "undo", tab: 7, panel: 8, value: 500 }, { op: "drag", tab: 14, panel: 14, value: 3579 },
  ]);
});


test("P3-vi generator: tombstone, restore, detach, expiry, purge and restart match the independent retention model", async () => {
  const { generateRecoverySeeds } = await import("./fixtures/profile-session-generator");
  const result = await generateRecoverySeeds(1, 8);
  expect(result).toEqual({ seeds: 8, count: 512, restarts: 24, purges: 8 });
}, 60_000);
