/**
 * S1 timing gates: commit to acknowledgement and main-thread cost per committed edit, outbox write included, over the real host
 * (HTTP, the library owner, WAL with the durability flush) on a scratch library.
 *   bun tools/s1-latency.ts <scratch-dir> <look.json>            the window in Bun, outbox in a synchronously written file
 *   bun tools/s1-latency.ts <scratch-dir> <look.json> --browser  serves bench.html; open it in a browser, results printed
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TransactRequest, TransactResult } from "../prototype/host";
import { FileOutbox } from "../prototype/storage";
import { runScript, type Timing } from "../harness/edit-script";
import { HERE, percentile, startHost, terminate } from "./kit";

const [scratch, lookPath, mode] = process.argv.slice(2);
const dir = join(scratch, mode === "--browser" ? "latency-browser" : "latency-bun");
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const summary = (timing: Timing) => ({ cadence: timing.cadence, edits: timing.edits, commands: timing.commands,
  mainMs: { p50: +percentile(timing.mainMs, 50).toFixed(3), p95: +percentile(timing.mainMs, 95).toFixed(3), max: +Math.max(...timing.mainMs).toFixed(3) },
  ackMs: { p50: +percentile(timing.ackMs, 50).toFixed(1), p95: +percentile(timing.ackMs, 95).toFixed(1), max: +Math.max(...timing.ackMs).toFixed(1) } });

if (mode === "--browser") {
  const statics = join(dir, "static");
  mkdirSync(statics);
  const built = await Bun.build({ entrypoints: [join(HERE, "harness/bench-page.ts")], target: "browser", outdir: statics, naming: "bench.js" });
  if (!built.success) throw Error(built.logs.join("\n"));
  writeFileSync(join(statics, "bench.html"), `<!doctype html><meta charset="utf-8"><title>S1 bench</title><p id="status">Loading…</p><script type="module" src="bench.js"></script>`);
  copyFileSync(lookPath, join(statics, "look.json"));
  const host = await startHost(join(dir, "library.sqlite"), join(dir, "port"), undefined, undefined, statics);
  console.log(`open http://127.0.0.1:${readFileSync(join(dir, "port"), "utf8")}/bench.html`);
  const line = await host.wait(text => text.startsWith("results "), 600_000);
  await terminate(host);
  if (!line) throw Error("No results.");
  const results = JSON.parse(line.slice(8)) as { agent: string; units: number; setItem: number[]; results: Timing[] };
  console.log(JSON.stringify({ agent: results.agent, units: results.units,
    setItemMs: { p50: percentile(results.setItem, 50), p95: percentile(results.setItem, 95) }, runs: results.results.map(summary) }, null, 1));
} else {
  const host = await startHost(join(dir, "library.sqlite"), join(dir, "port"));
  const base = `http://127.0.0.1:${readFileSync(join(dir, "port"), "utf8")}`;
  const port = { async transact(request: TransactRequest) {
    return await (await fetch(`${base}/transact`, { method: "POST", body: JSON.stringify(request), headers: { "Content-Type": "application/json" } })).json() as TransactResult;
  } };
  const look = JSON.parse(readFileSync(lookPath, "utf8")) as Record<string, unknown>;
  const runs = [];
  for (const [cadence, edits] of [["person", 120], ["stress", 300]] as const)
    runs.push(summary(await runScript(port, new FileOutbox(join(dir, `outbox-${cadence}.json`)), look, cadence, edits, `c-bun/${cadence}`)));
  await terminate(host);
  console.log(JSON.stringify({ units: JSON.stringify(look).length, runs }, null, 1));
}
process.exit(0);
