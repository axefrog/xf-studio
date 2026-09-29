/**
 * Preloaded by `tools/mutate.ts` (`bun test --preload`): loads the one engine file named by STRATA_MUTANT
 * (`<file>#<start>:<end>:<replacement as JSON>`) with that single change applied; every other file loads as it is.
 */
import { plugin } from "bun";
import { applyMutant, isEngineFile, relativeName, toJs } from "./instrument";

const spec = process.env.STRATA_MUTANT ?? "";
const hash = spec.indexOf("#");
const file = spec.slice(0, hash);
const [start, end, ...rest] = spec.slice(hash + 1).split(":");
const replacement = JSON.parse(rest.join(":")) as string;

plugin({
  name: "strata-mutant",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async args => {
      const text = await Bun.file(args.path).text();
      if (!isEngineFile(args.path) || relativeName(args.path) !== file) return { contents: text, loader: "ts" };
      return { contents: applyMutant(toJs(text), { start: Number(start), end: Number(end), replacement }), loader: "js" };
    });
  },
});
