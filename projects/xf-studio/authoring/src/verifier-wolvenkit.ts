// Process adapter: the independent verifier's three WolvenKit commands (unbundle, serialize, texture
// export), run through the shared WolvenKit runner. The verifier (src/mod-verifier) imports nothing
// from the Studio, so hosts inject these tools; the verifier still applies its own success checks
// to each result and writes the logs.
import { statSync } from "node:fs";
import type { ToolResult, VerifierTools } from "./mod-verifier/verify-build";
import { runWolvenKitSync, WOLVENKIT_RUNTIME_MISSING_MESSAGE, WolvenKitRunError } from "./wolvenkit-cli";

export const VERIFIER_STEP_TIMEOUT_MS = 240_000;
const isDirectory = (path: string | undefined) => { try { return !!path && statSync(path).isDirectory(); } catch { return false; } };

/** Tools for `verifyBuild`. `gamepath` is the game folder WolvenKit's `export` command reads (read only). */
export function createWolvenKitVerifierTools(cli: string, gamepath: string | undefined,
  options: { timeoutMs?: number } = {}): VerifierTools {
  const run = (args: string[]): ToolResult => {
    try {
      // The verifier judges exit codes and log lines itself; the runner only stops on a run that could not finish.
      const result = runWolvenKitSync(cli, args, { timeoutMs: options.timeoutMs ?? VERIFIER_STEP_TIMEOUT_MS, keep: 2_000_000,
        accept: () => true, failure: /(?!)/ });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (!(error instanceof WolvenKitRunError)) throw error;
      throw Error(error.code === "runtime_missing" ? WOLVENKIT_RUNTIME_MISSING_MESSAGE
        : error.code === "tool_missing" ? "WolvenKit CLI isn't available, so the build could not be checked."
        : `${error.message}${error.output ? ` ${error.output.slice(-2000)}` : ""}`);
    }
  };
  return {
    unbundle: (archive, output) => run(["unbundle", archive, "-o", output]),
    serialize: (input, output) => run(["convert", "serialize", input, "-o", output]),
    exportTextures: (input, output) => {
      if (!isDirectory(gamepath)) throw Error("WolvenKit's texture export needs the Cyberpunk 2077 folder.");
      return run(["export", input, "-o", output, "--uext", "dds", "--gamepath", gamepath!]);
    },
  };
}
