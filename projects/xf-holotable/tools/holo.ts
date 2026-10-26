// Holotable from the command line: the same service methods the Studio and agents use.
//   bun tools/holo.ts runs
//   bun tools/holo.ts report <run folder> [--at <seconds from start>] [--full]
import { createService, defaultOptions } from "../src/service.ts";

const [cmd, dir, ...rest] = process.argv.slice(2);
const { handlers } = createService(defaultOptions());
const signal = new AbortController().signal;
if (cmd === "runs") {
  for (const r of handlers["runs.list"]({}, signal) as any[]) console.log(`${r.session} run-${r.run}  ${(r.end - r.start).toFixed(0)} s  ${(r.bytes / 1e6).toFixed(1)} MB${r.complete ? "" : "  (incomplete)"}  ${r.dir}`);
} else if (cmd === "report" && dir) {
  const at = rest.includes("--at") ? Number(rest[rest.indexOf("--at") + 1]) : undefined;
  const s = handlers["session.open"]({ dir, level: "structure" }, signal) as any;
  const t = at === undefined ? s.meta.to : s.meta.from + at;
  console.log(handlers["session.report"]({ dir, t, level: rest.includes("--full") ? "full" : "structure" }, signal));
} else {
  console.error("Usage: bun tools/holo.ts runs | report <run folder> [--at <seconds>] [--full]");
  process.exit(2);
}
