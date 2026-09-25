// Process adapter: the package builder's WolvenKit command lines and how WolvenKit reports success
// for them; the shared WolvenKit runner owns the process. The builder decides what to convert.
import { runWolvenKit, WolvenKitRunError } from "./wolvenkit-cli";

export type PackageToolCode = "package_tool_failed" | "package_build_cancelled" | "package_build_timeout";
export class PackageToolError extends Error {
  constructor(readonly code: PackageToolCode, message: string, readonly log = "") { super(message); }
}

/** WolvenKit's XBM import settings, passed as `XbmImportArgs__*` environment values. */
export interface TextureImportSettings {
  IsGamma: boolean; TextureGroup: string; RawFormat: string; Compression: string;
  GenerateMipMaps: boolean; IsStreamable: boolean; PremultiplyAlpha: boolean;
}
export interface ToolStep { readonly exitCode: number; readonly log: string }

/** The WolvenKit operations one package build needs. Each resolves with the step's exit code and log. */
export interface PackageResourceTools {
  importTextures(input: string, output: string, settings: TextureImportSettings): Promise<ToolStep>;
  serialize(input: string, output: string): Promise<ToolStep>;
  deserialize(input: string, output: string): Promise<ToolStep>;
  pack(input: string, output: string): Promise<ToolStep>;
}

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
    const reason = error.code === "runtime_missing" ? "WolvenKit needs Microsoft's .NET runtime, which isn't installed on this computer." : error.message;
    throw new PackageToolError("package_tool_failed", `${reason}${error.output ? `: ${tail(error.output)}` : ""}`, error.output);
  }
}

export function createWolvenKitPackageTools(cli: string, options: { signal?: AbortSignal; stepTimeoutMs?: number; cwd?: string } = {}): PackageResourceTools {
  const base = { signal: options.signal, timeoutMs: options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, cwd: options.cwd };
  return {
    importTextures: (input, output, settings) => runStep(cli, ["import", input, "-o", output], { ...base, folderImport: true,
      env: Object.fromEntries(Object.entries(settings).map(([key, value]) => ["XbmImportArgs__" + key, String(value)])) }),
    serialize: (input, output) => runStep(cli, ["convert", "serialize", input, "-o", output], base),
    deserialize: (input, output) => runStep(cli, ["convert", "deserialize", input, "-o", output], base),
    pack: (input, output) => runStep(cli, ["pack", input, "-o", output], base),
  };
}
