// Process adapter: the only place the package builder starts WolvenKit CLI. It knows the
// command lines and how WolvenKit reports success; the builder decides what to convert.
import { basename } from "node:path";
import { runProcessTree } from "./process-tree";

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
  exportTextures(input: string, output: string, extension: "dds", gameRoot: string): Promise<ToolStep>;
  pack(input: string, output: string): Promise<ToolStep>;
}

export const DEFAULT_STEP_TIMEOUT_MS = 240_000;
const tail = (value: string) => value.slice(-3000);
const failurePattern = /\bError\s*\]|Unhandled exception|Traceback \(/;

/** Run one WolvenKit command. Abort or timeout stops the process tree. */
async function runStep(cli: string, args: string[], options: { signal?: AbortSignal; timeoutMs: number; cwd?: string;
  env?: Record<string, string>; folderImport?: boolean }): Promise<ToolStep> {
  const result = await runProcessTree(cli, args, { signal: options.signal, timeoutMs: options.timeoutMs, cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined, keep: 2_000_000 });
  const log = result.stdout + "\n" + result.stderr;
  const label = `${basename(cli)} ${args.slice(0, args[0] === "convert" ? 2 : 1).join(" ")}`;
  if (result.stopped === "cancelled") throw new PackageToolError("package_build_cancelled", "Package Build was cancelled.", log);
  if (result.stopped === "timeout") throw new PackageToolError("package_build_timeout", `${label} exceeded its time limit.`, log);
  if (result.error || result.exitCode === null)
    throw new PackageToolError("package_tool_failed", `${label} could not run: ${result.error?.message ?? "no exit code"}`, log);
  // A folder import reports exit 3 even when every file imported; accept it only with a complete count.
  const counts = /Imported (\d+)\/(\d+) file\(s\)/.exec(log);
  const folderSuccess = options.folderImport === true && result.exitCode === 3 && counts !== null &&
    counts[1] === counts[2] && Number(counts[1]) > 0;
  if ((result.exitCode !== 0 && !folderSuccess) || failurePattern.test(log))
    throw new PackageToolError("package_tool_failed", `${label} failed (${result.exitCode}): ${tail(log)}`, log);
  return { exitCode: result.exitCode, log };
}

export function createWolvenKitPackageTools(cli: string, options: { signal?: AbortSignal; stepTimeoutMs?: number; cwd?: string } = {}): PackageResourceTools {
  const base = { signal: options.signal, timeoutMs: options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, cwd: options.cwd };
  return {
    importTextures: (input, output, settings) => runStep(cli, ["import", input, "-o", output], { ...base, folderImport: true,
      env: Object.fromEntries(Object.entries(settings).map(([key, value]) => ["XbmImportArgs__" + key, String(value)])) }),
    serialize: (input, output) => runStep(cli, ["convert", "serialize", input, "-o", output], base),
    deserialize: (input, output) => runStep(cli, ["convert", "deserialize", input, "-o", output], base),
    exportTextures: (input, output, extension, gameRoot) =>
      runStep(cli, ["export", input, "-o", output, "--uext", extension, "--gamepath", gameRoot], base),
    pack: (input, output) => runStep(cli, ["pack", input, "-o", output], base),
  };
}
