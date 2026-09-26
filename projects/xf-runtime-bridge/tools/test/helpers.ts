// Shared test helpers: synthetic windows and the self-test bridge host.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readSession, type BridgeSession } from "../bridge-lib.ts";

export const projectDir = resolve(import.meta.dir, "..", "..");
// No test may ever press a key on this machine's desktop (photo.open's sender refuses with this set);
// child processes inherit it.
process.env.XFB_NO_INPUT = "1";
export const selftestExe = join(projectDir, "build", "Release", "xfb_selftest.exe");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Synthetic = { hwnd: bigint; width: number; height: number; close: () => void };

/**
 * Opens tools/test/synthetic-window.ps1: a borderless, non-activating window with an exact client
 * size and a known pattern. By default it sits off-screen (x = -9000), so it never covers anything.
 */
export async function openSyntheticWindow(width: number, height: number, options: { x?: number; y?: number; topMost?: boolean; seconds?: number } = {}): Promise<Synthetic> {
  const args = ["-NoProfile", "-File", join(import.meta.dir, "synthetic-window.ps1"), "-Width", String(width), "-Height", String(height), `-X:${options.x ?? -9000}`, `-Y:${options.y ?? 0}`, "-Seconds", String(options.seconds ?? 30)];
  if (options.topMost) args.push("-TopMost");
  const child = spawn("pwsh", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr!.on("data", (d) => (stderr += String(d)));
  const line = await new Promise<string>((resolveLine, reject) => {
    let out = "";
    child.stdout!.on("data", (d) => {
      out += String(d);
      if (out.includes("\n")) resolveLine(out);
    });
    child.once("exit", (code) => reject(new Error(`synthetic window exited (${code}): ${stderr}`)));
    setTimeout(() => reject(new Error(`synthetic window did not start: ${stderr}`)), 20000);
  });
  const match = /HWND=(\d+) CLIENT=(\d+)x(\d+)/.exec(line);
  if (!match) throw new Error(`unexpected synthetic window output: ${line}`);
  await sleep(200); // first paint
  return { hwnd: BigInt(match[1]), width: Number(match[2]), height: Number(match[3]), close: () => child.kill() };
}

export type Host = { child: ChildProcess; dir: string; session: BridgeSession; log: string[]; stop: () => Promise<void> };

/** Starts build/Release/xfb_selftest.exe: the real bridge core and pipe with a simulated game. */
export async function startSelftestHost(extraArgs: string[] = [], seconds = 60): Promise<Host> {
  if (!existsSync(selftestExe)) throw new Error(`missing ${selftestExe}; build first: cmake --build build --config Release`);
  const dir = mkdtempSync(join(tmpdir(), "xfb-test-"));
  const log: string[] = [];
  const child = spawn(selftestExe, ["--runtime-dir", dir, "--seconds", String(seconds), ...extraArgs], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => log.push(...String(d).split(/\r?\n/).filter(Boolean)));
  child.stderr!.on("data", (d) => log.push(...String(d).split(/\r?\n/).filter(Boolean)));
  for (let i = 0; i < 100; i++) {
    const session = readSession(dir);
    if (session) {
      return {
        child,
        dir,
        session,
        log,
        stop: async () => {
          if (child.exitCode === null) child.kill();
          await sleep(200);
          rmSync(dir, { recursive: true, force: true });
        },
      };
    }
    await sleep(50);
  }
  child.kill();
  throw new Error(`host did not write session.json; log:\n${log.join("\n")}`);
}

export function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}
