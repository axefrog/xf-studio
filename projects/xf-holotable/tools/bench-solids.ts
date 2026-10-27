/** Offline W0 measurements. Run under tools/memory_guard.py. --out must name private/ignored output.
 * Uses HOLOTABLE_RECORDINGS / HOLOTABLE_WORLD_PACK, the ordinary service defaults and installed-game Settings.
 * Writes geometry only to the requested private output; measurements.json contains counts/times, never poses or local paths.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createService, defaultOptions } from "../src/service.ts";
import { listRuns } from "../src/recording.ts";
import type { Session, SolidRegion } from "../src/model.ts";
import { ORBITS, project } from "../../xf-studio/authoring/src/features/holotable/view/projection";
import type { HoloWorld } from "../../xf-studio/authoring/src/features/holotable/types";

const args = process.argv.slice(2), out = args[args.indexOf("--out") + 1];
if (!args.includes("--out") || !out) throw Error("Supply --out <private ignored folder>; use a new folder for a cold preparation.");
mkdirSync(out, { recursive: true });
const options = { ...defaultOptions(), solidCacheDir: join(out, "cache") }, runs = listRuns(options.recordingsRoot);
const run4 = runs.find(r => r.session.startsWith("82068e42") && r.run === 4), largest = [...runs].sort((a, b) => b.bytes - a.bytes)[0];
if (!run4 || !largest) throw Error("The requested run 4 and a largest recording must be available.");
const signal = AbortSignal.timeout(120_000), results = [];
for (const r of args.includes("--run4-only") ? [run4] : args.includes("--largest-only") ? [largest] : [run4, largest]) {
  const h = createService(options).handlers;
  let t = performance.now();
  const s = await h["session.open"]({ dir: r.dir }, signal) as Session;
  const status = await h["world.status"]({ dir: r.dir }, signal);
  const w = await h["world.around"]({ dir: r.dir }, signal) as HoloWorld & SolidRegion;
  const coldMs = performance.now() - t;
  t = performance.now(); await h["world.around"]({ dir: r.dir }, signal); const memoryMs = performance.now() - t;
  t = performance.now(); await createService(options).handlers["world.around"]({ dir: r.dir }, signal); const diskMs = performance.now() - t;
  const metrics: Record<string, unknown> = {};
  for (const width of args.includes("--source-only") ? [] : [300, 800]) for (const [name, orbit] of Object.entries(ORBITS)) {
    const ms: number[] = [], drawn: number[] = []; let cut = 0;
    for (let i = 0; i < 240; i++) {
      const at = s.meta.from + (s.meta.to - s.meta.from) * (i % 40 / 39); t = performance.now();
      const scene = project(s, w, at, { v: true, camera: true, people: false, events: true, gaps: true, areas: true, cells: false, solids: true, pois: false, spots: false, communities: false }, orbit, width, 480, null);
      if (i >= 120) { ms.push(performance.now() - t); drawn.push(scene.solidsDrawn); cut = Math.max(cut, scene.solidsCut); }
    }
    ms.sort((a, b) => a - b);
    metrics[`${width}/${name}`] = { median: ms[60], p95: ms[114], max: ms[119], drawn: [Math.min(...drawn), Math.max(...drawn)], cut };
  }
  const result = { session: r.session, run: r.run, bytes: r.bytes, samples: s.v.length, status, coldMs, memoryMs, diskMs, solidInfo: w.solidInfo, metrics };
  results.push(result); console.log(JSON.stringify(result));
  writeFileSync(join(out, `world-${r.session}-${r.run}.json`), JSON.stringify(w));
  writeFileSync(join(out, `session-${r.session}-${r.run}.json`), JSON.stringify(s));
}
writeFileSync(join(out, "measurements.json"), JSON.stringify(results, null, 2));
