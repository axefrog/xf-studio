import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { EyePlateTools } from "./eye-plate-service";
import { runProcessTree } from "./process-tree";

/** Process adapter: the only place the eye-plate derivation starts external tools. */
const defaultTimeoutMs = 5 * 60_000;
const tail = (value: string) => value.slice(-4000);

export class ToolRunError extends Error {
  constructor(readonly code: "plate_tool_failed" | "plate_cancelled", message: string, readonly output = "") { super(message); }
}

/** Run one command; abort or timeout kills the whole process tree. */
export async function runTool(command: string, args: string[], signal?: AbortSignal, timeoutMs = defaultTimeoutMs): Promise<string> {
  if (signal?.aborted) throw new ToolRunError("plate_cancelled", "Eye plate preparation was cancelled.");
  const result = await runProcessTree(command, args, { signal, timeoutMs, keep: 64_000 });
  const output = result.stdout + result.stderr;
  if (result.stopped === "cancelled") throw new ToolRunError("plate_cancelled", "Eye plate preparation was cancelled.", tail(output));
  if (result.stopped === "timeout") throw new ToolRunError("plate_tool_failed", `${basename(command)} exceeded its time limit.`, tail(output));
  if (result.error || result.exitCode !== 0 || /Unhandled exception/i.test(output))
    throw new ToolRunError("plate_tool_failed", `${basename(command)} ${args[0]} failed${result.exitCode === null ? "" : ` (exit ${result.exitCode})`}.`, tail(output));
  return output;
}

/** WolvenKit's regex engine is .NET; depot paths use backslashes, matched literally. */
export function depotPathRegex(paths: readonly string[]): string {
  const literal = (path: string) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^(?:${paths.map(literal).join("|")})$`;
}

export function createWolvenKitEyePlateTools(cli: string, timeoutMs = defaultTimeoutMs): EyePlateTools {
  const require = (path: string, message: string) => { if (!existsSync(path) || !statSync(path).isFile()) throw new ToolRunError("plate_tool_failed", message); };
  return {
    async extract({ archive, depotPaths, outDir, signal }) {
      await runTool(cli, ["unbundle", resolve(archive), "-o", outDir, "-r", depotPathRegex(depotPaths)], signal, timeoutMs);
    },
    async serialize({ file, outDir, signal }) {
      await runTool(cli, ["convert", "serialize", file, "-o", outDir], signal, timeoutMs);
      const json = join(outDir, basename(file) + ".json");
      require(json, `WolvenKit did not serialize ${basename(file)}.`);
      return json;
    },
    async deserialize({ jsonDir, outDir, names, signal }) {
      await runTool(cli, ["convert", "deserialize", jsonDir, "-o", outDir], signal, timeoutMs);
      for (const name of names) require(join(outDir, name), `WolvenKit did not convert ${name}.`);
    },
  };
}
