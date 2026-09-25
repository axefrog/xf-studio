import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { EyePlateTools } from "./eye-plate-service";
import { runWolvenKit, WolvenKitRunError } from "./wolvenkit-cli";

/** Process adapter: the eye-plate derivation's WolvenKit commands, run through the shared WolvenKit runner. */
const defaultTimeoutMs = 5 * 60_000;

export class ToolRunError extends Error {
  constructor(readonly code: "plate_tool_failed" | "plate_cancelled", message: string, readonly output = "") { super(message); }
}

/** Run one WolvenKit command and map the runner's typed errors to the plate's codes. */
export async function runTool(command: string, args: string[], signal?: AbortSignal, timeoutMs = defaultTimeoutMs): Promise<string> {
  try { return (await runWolvenKit(command, args, { signal, timeoutMs, keep: 64_000 })).output; }
  catch (error) {
    if (!(error instanceof WolvenKitRunError)) throw error;
    if (error.code === "cancelled") throw new ToolRunError("plate_cancelled", "Eye plate preparation was cancelled.", error.output);
    throw new ToolRunError("plate_tool_failed", error.code === "runtime_missing"
      ? "WolvenKit needs Microsoft's .NET runtime, which isn't installed on this computer." : error.message, error.output);
  }
}

/** WolvenKit's regex engine is .NET; depot paths use backslashes, matched literally. */
export function depotPathRegex(paths: readonly string[]): string {
  const literal = (path: string) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^(?:${paths.map(literal).join("|")})$`;
}

export function createWolvenKitEyePlateTools(cli: string, timeoutMs = defaultTimeoutMs): EyePlateTools {
  const require = (path: string, message: string) => { if (!existsSync(path) || !statSync(path).isFile()) throw new ToolRunError("plate_tool_failed", message); };
  return {
    async extract({ gameRoot, archiveDirectory, depotPaths, outDir, signal }) {
      await runTool(cli, ["unbundle", resolve(gameRoot, archiveDirectory), "-o", outDir, "-r", depotPathRegex(depotPaths)], signal, timeoutMs);
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
