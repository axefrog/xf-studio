/** Offline Bun worker benchmark, including transfer and repeated-output hashes. Run under the memory guard. */
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { hairAtlasSteps, defaultHairAtlas, type HairAtlas, type HairAtlasDescription } from "../src/features/hair-lab/textures";
import { hairAtlasStripSteps, type PreparedHairAtlas } from "../src/features/hair-lab/strand-strips";

type Reply = { atlas: HairAtlas; strips: PreparedHairAtlas; generationMs: number; stripMs: number; maxBatchMs: number };
if (!isMainThread) {
  parentPort!.on("message", (description: HairAtlasDescription) => {
    const start = performance.now(), work = hairAtlasSteps(description); let maxBatchMs = 0;
    while (true) {
      const batchStart = performance.now(), next = work.next(); maxBatchMs = Math.max(maxBatchMs, performance.now() - batchStart);
      if (!next.done) continue;
      const atlas = next.value, generationMs = performance.now() - start;
      const stripStart = performance.now(), preparation = hairAtlasStripSteps(atlas); let prepared = preparation.next();
      while (!prepared.done) {
        const t = performance.now(); prepared = preparation.next(); maxBatchMs = Math.max(maxBatchMs, performance.now() - t);
      }
      const strips = prepared.value, stripMs = performance.now() - stripStart;
      const buffers = [...atlas.levels, ...strips.strips.flatMap(s => s.levels)].flatMap(m => [m.alpha, m.id, m.gradient, m.flow]).map(map => {
        if (!(map.buffer instanceof ArrayBuffer)) throw Error("Atlas output must use transferable ArrayBuffers.");
        return map.buffer;
      });
      parentPort!.postMessage({ atlas, strips, generationMs, stripMs, maxBatchMs } satisfies Reply, buffers); break;
    }
  });
} else {
  const out = resolve(process.argv[2] ?? "build/hair-lab-wip");
  if (!out.replaceAll("\\", "/").includes("/build/")) throw Error("Benchmark output must be in an ignored build folder.");
  const worker = new Worker(import.meta.filename);
  const run = async () => {
    const start = performance.now();
    const reply = await new Promise<Reply>((accept, reject) => { worker.once("message", accept); worker.once("error", reject); worker.postMessage(defaultHairAtlas()); });
    const elapsedMs = performance.now() - start, hash = createHash("sha256");
    let bytes = 0, stripBytes = 0;
    for (const level of reply.atlas.levels) for (const map of [level.alpha, level.id, level.gradient, level.flow]) { hash.update(map); bytes += map.byteLength; }
    for (const strip of reply.strips.strips) for (const level of strip.levels) for (const map of [level.alpha, level.id, level.gradient, level.flow]) { hash.update(map); stripBytes += map.byteLength; }
    return { generationMs: reply.generationMs, stripMs: reply.stripMs, requestThroughTransferMs: elapsedMs, maxBatchMs: reply.maxBatchMs,
      bytes, stripBytes, totalBytes: bytes + stripBytes, maxMipError: Math.max(...reply.strips.strips.flatMap(s => s.coverage.map(c => Math.abs(c.corrected - c.target)))), sha256: hash.digest("hex") };
  };
  try {
    const runs = [await run(), await run(), await run()];
    if (new Set(runs.map(r => r.sha256)).size !== 1) throw Error("Worker atlas output was not deterministic.");
    mkdirSync(out, { recursive: true });
    const report = { runtime: `Bun ${Bun.version}`, size: 2048, runs, medianGenerationMs: runs.map(r => r.generationMs).sort((a, b) => a - b)[1] };
    writeFileSync(join(out, "atlas-worker-bench.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await worker.terminate(); }
}
