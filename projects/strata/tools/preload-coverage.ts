/**
 * Preloaded by `tools/coverage.ts` (`bun test --preload`): instruments every engine file with branch probes as it is
 * loaded, and writes the hit counts to STRATA_COV_OUT.
 */
import { plugin } from "bun";
import { afterAll } from "bun:test";
import { writeFileSync } from "node:fs";
import { coverageProbes, isEngineFile, relativeName } from "./instrument";
import type { Probe } from "./instrument";

const files = new Map<string, { probes: Probe[]; counts: Int32Array }>();
const loaded = new Map<string, Probe[]>();
(globalThis as Record<string, unknown>).__strataCov = (file: string) => (count: number) => {
  const counts = new Int32Array(count * 2);
  files.set(file, { probes: loaded.get(file)!, counts });
  return counts;
};

plugin({
  name: "strata-branch-coverage",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async args => {
      const text = await Bun.file(args.path).text();
      if (!isEngineFile(args.path)) return { contents: text, loader: "ts" };
      const name = relativeName(args.path);
      const { probes, instrumented } = await coverageProbes(text);
      loaded.set(name, probes);
      return { contents: instrumented(`globalThis.__strataCov(${JSON.stringify(name)})`), loader: "js" };
    });
  },
});

// Written after every test file (cumulative), since the process exit hook does not run under `bun test`.
afterAll(() => {
  const out = process.env.STRATA_COV_OUT;
  if (!out) return;
  const data = Object.fromEntries([...files].map(([file, { probes, counts }]) => [file, probes.map(probe => ({ ...probe, hits: probe.outcomes.map((_, i) => counts[2 * probe.id + i]) }))]));
  writeFileSync(out, JSON.stringify(data));
});
