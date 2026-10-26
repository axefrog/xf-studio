// Headless CLI. Validation never starts a service or writes a spool.
import { resolve } from "node:path";
import { createService, defaultOptions } from "../src/service.ts";
import { createLayerSpool } from "../src/layer-spool.ts";
import { readBatch } from "../src/bounded-input.ts";
import { validateFiles } from "../src/layer-validation.ts";

const [cmd, target, ...rest] = process.argv.slice(2);
let status = 0;
try {
  if (cmd === "validate" && target) {
    const errors = validateFiles(resolve(target));
    for (const e of errors) console.error(`${e.file}:${e.line}: ${e.reason}`);
    console.log(errors.length ? `${errors.length} refusals.` : "Valid: no refusals."); status = errors.length ? 1 : 0;
  } else if (cmd === "publish" && target) {
    const text = await readBatch((rest[0] ? Bun.file(rest[0]) : Bun.stdin).stream());
    const spool = createLayerSpool(defaultOptions().layersRoot!);
    try {
      const result = await spool.publish(target, text.split("\n"));
      console.log(`${result.accepted} ${result.accepted === 1 ? "line" : "lines"} published; ${result.refused} refused.`);
      for (const reason of result.reasons) console.error(reason);
      status = result.refused ? 1 : 0;
    } finally { spool.close(); }
  } else if (cmd === "runs" || cmd === "report" && target) {
    const service = createService(defaultOptions()), signal = new AbortController().signal;
    try {
      if (cmd === "runs") {
        for (const r of await service.handlers["runs.list"]({}, signal) as any[]) console.log(`${r.title ?? `${r.session} run-${r.run}`}  ${r.standalone ? "layers only · " : ""}${(r.end - r.start).toFixed(0)} s  ${r.dir}`);
      } else {
        const at = rest.includes("--at") ? Number(rest[rest.indexOf("--at") + 1]) : undefined;
        const s = await service.handlers["session.open"]({ dir: target, level: "structure" }, signal) as any;
        const t = at === undefined ? s.meta.to : s.meta.from + at;
        const position = rest.includes("--position") ? rest[rest.indexOf("--position") + 1].split(",").map(Number) : undefined;
        const branch = rest.includes("--branch") ? rest[rest.indexOf("--branch") + 1] : undefined;
        console.log(await service.handlers["session.report"]({ dir: target, t, level: rest.includes("--structure") ? "structure" : "full", position, branch }, signal));
      }
    } finally { service.close(); }
  } else { console.error("Usage: bun projects/xf-holotable/tools/holo.ts runs | publish <producer/layer> [file] | validate <file|folder> | report <run folder|layers:producer/set> [--at seconds] [--structure] [--branch name] [--position x,y,z]"); status = 2; }
} catch (e) { console.error(String((e as Error).message)); status = 1; }
process.exitCode = status;
