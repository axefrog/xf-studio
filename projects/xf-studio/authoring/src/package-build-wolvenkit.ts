// Process adapter: the package builder's WolvenKit command lines and how WolvenKit reports success
// for them; the shared WolvenKit runner owns the process. The builder decides what to convert.
import { runWolvenKit, WOLVENKIT_RUNTIME_MISSING_MESSAGE, wolvenKitIdentity, wolvenKitIdentityKey, WolvenKitRunError } from "./wolvenkit-cli";
import type { ResourceTools, ToolStep } from "./platform/api";
export type { TextureImportSettings, ToolStep } from "./platform/api";

export type PackageToolCode = "package_tool_failed" | "package_build_cancelled" | "package_build_timeout";
export class PackageToolError extends Error {
  constructor(readonly code: PackageToolCode, message: string, readonly log = "") { super(message); }
}

/** The WolvenKit operations one package build needs (the platform's `ResourceTools`). Each resolves with the step's exit code and log. */
export type PackageResourceTools = ResourceTools;

export const DEFAULT_STEP_TIMEOUT_MS = 240_000;
const tail = (value: string) => value.slice(-3000);
const failurePattern = /\bError\s*\]|Unhandled exception|Traceback \(/;

/** Run one WolvenKit command through the shared runner and map its typed errors to Build codes. */
async function runStep(cli: string, args: string[], options: { signal?: AbortSignal; timeoutMs: number; cwd?: string;
  env?: Record<string, string>; folderImport?: boolean }): Promise<ToolStep> {
  // A folder import reports exit 3 even when every file imported; accept it only with a complete count.
  const accept = (run: { exitCode: number; output: string }) => {
    const counts = /Imported (\d+)\/(\d+) file\(s\)/.exec(run.output);
    return options.folderImport === true && run.exitCode === 3 && counts !== null && counts[1] === counts[2] && Number(counts[1]) > 0;
  };
  try {
    const run = await runWolvenKit(cli, args, { signal: options.signal, timeoutMs: options.timeoutMs, cwd: options.cwd,
      env: options.env, keep: 2_000_000, accept, failure: failurePattern });
    return { exitCode: run.exitCode, log: run.stdout + "\n" + run.stderr };
  } catch (error) {
    if (!(error instanceof WolvenKitRunError)) throw error;
    if (error.code === "cancelled") throw new PackageToolError("package_build_cancelled", "Package Build was cancelled.", error.output);
    if (error.code === "tool_timeout") throw new PackageToolError("package_build_timeout", error.message, error.output);
    const reason = error.code === "runtime_missing" ? WOLVENKIT_RUNTIME_MISSING_MESSAGE : error.message;
    throw new PackageToolError("package_tool_failed", `${reason}${error.output ? `: ${tail(error.output)}` : ""}`, error.output);
  }
}

/**
 * How many WolvenKit processes one Build runs at once. Each takes about 1.2 GB of private memory whatever its input
 * (PIPE-130, measured with WolvenKit 9.0.1), so two keeps a Build's tree near 3.5 GB while independent steps overlap.
 */
export const DEFAULT_WOLVENKIT_CONCURRENCY = 2;

/**
 * A counting gate: at most `limit` of the tasks run at once, the rest start in the order they were queued. A finishing task hands its
 * slot straight to the first waiter (the count never drops in between), so a caller arriving before that waiter resumes can't take the
 * slot too and run `limit + 1` at once.
 */
export function concurrencyGate(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async task => {
    if (running >= limit) await new Promise<void>(go => waiting.push(go));
    else running++;
    try { return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else running--; }
  };
}

export function createWolvenKitPackageTools(cli: string, options: { signal?: AbortSignal; stepTimeoutMs?: number; cwd?: string;
  concurrency?: number } = {}): PackageResourceTools {
  const base = { signal: options.signal, timeoutMs: options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, cwd: options.cwd };
  const gate = concurrencyGate(Math.max(1, options.concurrency ?? DEFAULT_WOLVENKIT_CONCURRENCY));
  const identity = wolvenKitIdentity(cli);
  return {
    importTextures: (input, output, settings) => gate(() => runStep(cli, ["import", input, "-o", output], { ...base, folderImport: true,
      env: Object.fromEntries(Object.entries(settings).map(([key, value]) => ["XbmImportArgs__" + key, String(value)])) })),
    serialize: (input, output) => gate(() => runStep(cli, ["convert", "serialize", input, "-o", output], base)),
    deserialize: (input, output) => gate(() => runStep(cli, ["convert", "deserialize", ...[input].flat(), "-o", output], base)),
    pack: (input, output) => gate(() => runStep(cli, ["pack", input, "-o", output], base)),
    ...identity ? { identity: wolvenKitIdentityKey(identity) } : {},
  };
}
