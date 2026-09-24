import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { EyePlateTools } from "./eye-plate-service";

/** Process adapter: the only place the eye-plate derivation starts external tools. */
const defaultTimeoutMs = 5 * 60_000;
const tail = (value: string) => value.slice(-4000);

export class ToolRunError extends Error {
  constructor(readonly code: "plate_tool_failed" | "plate_cancelled", message: string, readonly output = "") { super(message); }
}

/** Run one command; abort or timeout kills the whole process tree. */
export function runTool(command: string, args: string[], signal?: AbortSignal, timeoutMs = defaultTimeoutMs): Promise<string> {
  return new Promise((done, reject) => {
    if (signal?.aborted) { reject(new ToolRunError("plate_cancelled", "Eye plate preparation was cancelled.")); return; }
    const child = spawn(command, args, { windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "", stopped: string | null = null, settled = false;
    const keep = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-64_000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const stop = (reason: string) => {
      if (settled || stopped) return;
      stopped = reason;
      if (!child.pid) { child.kill(); return; }
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const abort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (stopped === "cancelled") reject(new ToolRunError("plate_cancelled", "Eye plate preparation was cancelled.", tail(output)));
      else if (stopped === "timeout") reject(new ToolRunError("plate_tool_failed", `${basename(command)} exceeded its time limit.`, tail(output)));
      else if (error || code !== 0 || /Unhandled exception/i.test(output))
        reject(new ToolRunError("plate_tool_failed", `${basename(command)} ${args[0]} failed${code === null ? "" : ` (exit ${code})`}.`, tail(output)));
      else done(output);
    };
    child.on("error", error => finish(null, error));
    child.on("close", code => finish(code));
  });
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
