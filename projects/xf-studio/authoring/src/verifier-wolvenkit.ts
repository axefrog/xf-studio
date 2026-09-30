// Process adapter: the verifiers' three WolvenKit commands (unbundle, serialize, texture export), run
// through the shared WolvenKit runner. The product verifier (platform/export) and each feature's
// independent verifier (eye makeup's in features/eye-makeup/verify) import nothing from the Studio, so
// hosts inject these tools; the verifiers still apply their own success checks to each result and write the logs.
//
// The steps are asynchronous and cancellable, so a verifier can run its independent steps side by side
// (`sideBySide`); at most `concurrency` WolvenKit processes run at once (by default the Build's own limit,
// DEFAULT_WOLVENKIT_CONCURRENCY: each takes about 1.2 GB whatever its input).
import { statSync } from "node:fs";
import type { ToolResult, VerifierTools } from "./platform/api";
import { concurrencyGate, DEFAULT_WOLVENKIT_CONCURRENCY } from "./package-build-wolvenkit";
import { runWolvenKit, WOLVENKIT_RUNTIME_MISSING_MESSAGE, WolvenKitRunError } from "./wolvenkit-cli";

export const VERIFIER_STEP_TIMEOUT_MS = 240_000;
const isDirectory = (path: string | undefined) => { try { return !!path && statSync(path).isDirectory(); } catch { return false; } };

/** A verifier step stopped because the Build was cancelled or a sibling step failed. */
export class VerifierStepCancelled extends Error {}

/** Tools for the verifiers. `gamepath` is the game folder WolvenKit's `export` command reads (read only). */
export function createWolvenKitVerifierTools(cli: string, gamepath: string | undefined,
  options: { timeoutMs?: number; concurrency?: number; signal?: AbortSignal } = {}): VerifierTools {
  const gate = concurrencyGate(Math.max(1, options.concurrency ?? DEFAULT_WOLVENKIT_CONCURRENCY));
  const run = (args: string[], step?: AbortSignal): Promise<ToolResult> => gate(async () => {
    const signal = step && options.signal ? AbortSignal.any([step, options.signal]) : step ?? options.signal;
    try {
      // The verifier judges exit codes and log lines itself; the runner only stops on a run that could not finish.
      const result = await runWolvenKit(cli, args, { signal, timeoutMs: options.timeoutMs ?? VERIFIER_STEP_TIMEOUT_MS, keep: 2_000_000,
        accept: () => true, failure: /(?!)/ });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (!(error instanceof WolvenKitRunError)) throw error;
      if (error.code === "cancelled") throw new VerifierStepCancelled("The check was stopped.");
      throw Error(error.code === "runtime_missing" ? WOLVENKIT_RUNTIME_MISSING_MESSAGE
        : error.code === "tool_missing" ? "WolvenKit isn't available, so the build could not be checked."
        : `${error.message}${error.output ? ` ${error.output.slice(-2000)}` : ""}`);
    }
  });
  return {
    unbundle: (archive, output, signal) => run(["unbundle", archive, "-o", output], signal),
    serialize: (input, output, signal) => run(["convert", "serialize", ...[input].flat(), "-o", output], signal),
    exportTextures: async (input, output, signal) => {
      if (!isDirectory(gamepath)) throw Error("WolvenKit's texture export needs the Cyberpunk 2077 folder.");
      return run(["export", input, "-o", output, "--uext", "dds", "--gamepath", gamepath!], signal);
    },
  };
}
