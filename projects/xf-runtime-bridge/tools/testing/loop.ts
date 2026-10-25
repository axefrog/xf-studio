// --loop: the fix-and-restart loop inside one session. After a halt the runner has torn down and closed the game;
// it then waits, with no game running, for the coordinator's edit (a script, a tool, CET Lua, or a native rebuild)
// and its signal: a file named "go" in the report folder (or "go" typed when run in a terminal); "stop" ends the
// loop. On go it runs the fixtures' restage hook (the coordinator's own staging command), then starts the next
// attempt as a fresh process, so edited tools and scripts are read anew: that process reruns the preflight,
// relaunches the game and continues from resume.json into the same report folder, whose report spans every attempt.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlanClock } from "./plan.ts";

export type LoopSignal = "go" | "stop";

/** The rows still to run, from a report folder's resume.json. */
export function readResume(outDir: string): { attempt: number; rows: string[]; halt?: unknown } | null {
  const path = join(outDir, "resume.json");
  if (!existsSync(path)) return null;
  const resume = JSON.parse(readFileSync(path, "utf8"));
  return resume?.schema === "xfb/session-resume-1" ? { attempt: resume.attempt, rows: resume.rows_remaining ?? [], halt: resume.halt } : null;
}

/**
 * Waits for the signal: <outDir>/go or <outDir>/stop (the file is removed once read), or a line typed on stdin
 * when lines is given. Polls the files every pollMs; there is no deadline: the coordinator decides when the fix is in.
 */
export async function waitForSignal(outDir: string, clock: PlanClock, options: { pollMs?: number; lines?: AsyncIterable<string>; signal?: AbortSignal } = {}): Promise<LoopSignal> {
  const files: [LoopSignal, string][] = [["stop", join(outDir, "stop")], ["go", join(outDir, "go")]];
  let typed: LoopSignal | undefined;
  if (options.lines) {
    void (async () => {
      for await (const line of options.lines!) {
        const word = line.trim().toLowerCase();
        if (word === "go" || word === "stop") { typed = word; break; }
      }
    })();
  }
  for (;;) {
    if (typed) return typed;
    if (options.signal?.aborted) return "stop";
    for (const [kind, path] of files) {
      if (existsSync(path)) {
        rmSync(path, { force: true });
        return kind;
      }
    }
    await clock.sleep(options.pollMs ?? 2000, options.signal);
  }
}

/** The fixtures' restage hook (a command line run by the shell), its output kept beside the attempt's telemetry. */
export function runRestage(command: string, outDir: string, attempt: number): { ok: boolean; status: number | null; log: string } {
  const log = join(outDir, "telemetry", `restage-before-a${attempt}.log`);
  const run = spawnSync(command, { shell: true, encoding: "utf8", windowsHide: true, timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(log, `$ ${command}\nexit ${run.status}\n\n${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  return { ok: run.status === 0, status: run.status, log };
}

/** The next attempt's arguments: the same script and options, into the same folder, continuing from resume.json. */
export function nextAttemptArgs(args: string[], outDir: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (["--rows", "--out"].includes(args[i])) { i++; continue; }
    if (["--resume", "--force"].includes(args[i])) continue;
    out.push(args[i]);
  }
  return [...out, "--out", outDir, "--resume"];
}
