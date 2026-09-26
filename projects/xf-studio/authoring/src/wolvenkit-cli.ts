import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { readPeFileVersion } from "./pe-version";
import { raiseLowPriority, runProcessTree, type ProcessTreeResult } from "./process-tree";

/**
 * Process adapter: the one place XF Studio starts WolvenKit CLI. It owns the success policy
 * (exit code, time limit, cancellation, "Unhandled exception" in the log), recognises a missing
 * .NET runtime, and reads the tool's identity without running it. Consumers (eye plate, game
 * asset export, package Build) map its typed errors to their own codes and plain messages.
 */
export type WolvenKitRunCode = "tool_missing" | "tool_failed" | "tool_timeout" | "runtime_missing" | "cancelled";
export class WolvenKitRunError extends Error {
  constructor(readonly code: WolvenKitRunCode, message: string, readonly output = "", readonly exitCode: number | null = null) { super(message); }
}
export type WolvenKitRun = { exitCode: number; stdout: string; stderr: string; output: string };
export type WolvenKitRunOptions = {
  signal?: AbortSignal;
  timeoutMs: number;
  cwd?: string;
  /** Extra environment values; the host environment is inherited. */
  env?: Record<string, string>;
  /** Characters of stdout and of stderr to keep. */
  keep?: number;
  /** Treat this finished run as a success even with a non-zero exit (e.g. a folder import's exit 3 with a complete count). */
  accept?: (run: WolvenKitRun) => boolean;
  /** A log line that means failure despite exit 0; default `Unhandled exception`. */
  failure?: RegExp;
  /** Background work: run below normal process priority, so the machine (and a foreground launch) stays responsive. */
  lowPriority?: boolean;
};

/** WolvenKit versions whose command lines and outputs XF Studio's pipeline has been verified against. */
export const SUPPORTED_WOLVENKIT_VERSIONS = ["8.17.4", "9.0.1"] as const;

// .NET host failures: FrameworkMissingFailure (0x80008096) and the host library being absent (0x80008083).
// Windows can report them as signed or unsigned 32-bit values.
const RUNTIME_EXIT_CODES = new Set([0x80008096, 0x80008096 - 2 ** 32, 0x80008083, 0x80008083 - 2 ** 32]);
const RUNTIME_MESSAGE = /You must install (?:or update )?\.NET|The framework '[^']+', version '[^']+' .*was not found|A fatal error occurred\. The folder \[.*host.fxr\] does not exist/i;

/** The shared plain message for a missing .NET runtime. */
export const WOLVENKIT_RUNTIME_MISSING_MESSAGE = "WolvenKit needs Microsoft's .NET runtime, which isn't installed on this computer.";

/** Did this run fail because the .NET runtime WolvenKit needs is missing? */
export const isRuntimeMissing = (exitCode: number | null, output: string) =>
  (exitCode !== null && RUNTIME_EXIT_CODES.has(exitCode)) || RUNTIME_MESSAGE.test(output);

const isFile = (path: string | null | undefined): path is string => { try { return !!path && statSync(path).isFile(); } catch { return false; } };

/** Classify a finished process result by WolvenKit's success policy. Pure, for tests and every runner. */
export function classifyWolvenKitRun(label: string, result: ProcessTreeResult, options: Pick<WolvenKitRunOptions, "accept" | "failure"> = {}): WolvenKitRun {
  const output = result.stdout + (result.stdout && result.stderr ? "\n" : "") + result.stderr;
  if (result.stopped === "cancelled") throw new WolvenKitRunError("cancelled", `${label} was cancelled.`, output);
  if (result.stopped === "timeout") throw new WolvenKitRunError("tool_timeout", `${label} exceeded its time limit.`, output);
  if (result.error || result.exitCode === null)
    throw new WolvenKitRunError("tool_failed", `${label} could not run: ${result.error?.message ?? "no exit code"}`, output);
  if (isRuntimeMissing(result.exitCode, output))
    throw new WolvenKitRunError("runtime_missing", `${label} needs a .NET runtime that isn't installed.`, output, result.exitCode);
  const run: WolvenKitRun = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, output };
  const failure = options.failure ?? /Unhandled exception/i;
  if ((result.exitCode !== 0 && !options.accept?.(run)) || failure.test(output))
    throw new WolvenKitRunError("tool_failed", `${label} failed (exit ${result.exitCode}).`, output, result.exitCode);
  return run;
}

const runLabel = (cli: string, args: readonly string[]) => `${basename(cli)} ${args.slice(0, args[0] === "convert" ? 2 : 1).join(" ")}`.trim();

/**
 * Every WolvenKit launch this process made, by command (`uncook`, `unbundle`, `convert s`, …), with the wall time each took. Read by
 * measurements and the prepare log: most of a first-time choice's time is launches, and each costs seconds before doing any work.
 */
export const wolvenKitRunStats = { launches: 0, ms: 0, byCommand: new Map<string, { launches: number; ms: number }>() };

/** Raise every WolvenKit run started with `lowPriority` that is still running to normal priority (foreground work may wait on it). */
export const raiseBackgroundWolvenKit = (): void => raiseLowPriority();

/** Run one WolvenKit command; abort or timeout stops the whole process tree. */
export async function runWolvenKit(cli: string | null, args: readonly string[], options: WolvenKitRunOptions): Promise<WolvenKitRun> {
  if (!isFile(cli)) throw new WolvenKitRunError("tool_missing", "WolvenKit CLI isn't available.");
  const label = runLabel(cli, args);
  if (options.signal?.aborted) throw new WolvenKitRunError("cancelled", `${label} was cancelled.`);
  const started = performance.now();
  const result = await runProcessTree(cli, args, { signal: options.signal, timeoutMs: options.timeoutMs, cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined, keep: options.keep ?? 64_000, lowPriority: options.lowPriority });
  const ms = performance.now() - started, command = args.slice(0, args[0] === "convert" ? 2 : 1).join(" ");
  const entry = wolvenKitRunStats.byCommand.get(command) ?? { launches: 0, ms: 0 };
  entry.launches++; entry.ms += ms; wolvenKitRunStats.launches++; wolvenKitRunStats.ms += ms;
  wolvenKitRunStats.byCommand.set(command, entry);
  return classifyWolvenKitRun(label, result, options);
}

/**
 * Blocking form of `runWolvenKit` for synchronous callers (the independent verifier) with the same success
 * policy and typed errors. It cannot be cancelled; the time limit stops WolvenKit itself (not grandchildren,
 * which WolvenKit CLI does not start).
 */
export function runWolvenKitSync(cli: string | null, args: readonly string[], options: Omit<WolvenKitRunOptions, "signal">): WolvenKitRun {
  if (!isFile(cli)) throw new WolvenKitRunError("tool_missing", "WolvenKit CLI isn't available.");
  const keep = options.keep ?? 64_000;
  const result = spawnSync(cli, [...args], { cwd: options.cwd, env: options.env ? { ...process.env, ...options.env } : undefined,
    encoding: "utf8", timeout: options.timeoutMs, windowsHide: true, maxBuffer: 256 << 20 });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return classifyWolvenKitRun(runLabel(cli, args), { exitCode: timedOut ? null : result.status, stdout: (result.stdout ?? "").slice(-keep),
    stderr: (result.stderr ?? "").slice(-keep), stopped: timedOut ? "timeout" : null, ...(result.error && !timedOut ? { error: result.error } : {}) }, options);
}

/** Identity of one WolvenKit installation, read from its files: the version resource and a hash of its entry points. */
export type WolvenKitIdentity = { version: string | null; sha256: string };
const identityMemo = new Map<string, WolvenKitIdentity>();
const stamp = (path: string) => { try { const s = statSync(path); return `${s.size}|${s.mtimeMs}`; } catch { return "missing"; } };

function peVersion(path: string): string | null {
  let handle: number | null = null;
  try {
    handle = openSync(path, "r");
    const fd = handle;
    const version = readPeFileVersion((offset, length) => {
      const bytes = new Uint8Array(length);
      return readSync(fd, bytes, 0, length, offset) === length ? bytes : null;
    });
    const match = version && /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
  } catch { return null; }
  finally { if (handle !== null) closeSync(handle); }
}

/**
 * Version and content hash of the CLI (its launcher and, for .NET builds, the managed entry DLL beside it).
 * No process is started. Memoised by file size and time, so an in-place upgrade changes the identity.
 */
export function wolvenKitIdentity(cli: string): WolvenKitIdentity | null {
  if (!isFile(cli)) return null;
  const dll = join(dirname(cli), basename(cli).replace(/\.exe$/i, "") + ".dll");
  const files = [cli, ...(existsSync(dll) ? [dll] : [])];
  const key = files.map(file => `${file}|${stamp(file)}`).join("\n");
  const known = identityMemo.get(key);
  if (known) return known;
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${basename(file).toLowerCase()}\n`).update(readFileSync(file));
  const identity = { version: peVersion(files.at(-1)!) ?? peVersion(cli), sha256: digest.digest("hex") };
  identityMemo.set(key, identity);
  return identity;
}

/** Stable text for cache keys: version plus a short content hash. */
export const wolvenKitIdentityKey = (identity: WolvenKitIdentity | null) =>
  identity ? `wolvenkit:${identity.version ?? "unknown"}:${identity.sha256.slice(0, 16)}` : "wolvenkit:none";

export type WolvenKitProbeResult = { ok: true; version: string } | { ok: false; code: "tool_missing" | "runtime_missing" | "unsupported" | "commands"; issue: string };
const probeMemo = new Map<string, { result: WolvenKitProbeResult; until: number }>();

type ProbeOutput = { status: number | null; text: string; failed: boolean };
/** Pure: judge the `--version` and `--help` outputs. */
function judgeProbe(version: ProbeOutput, help: () => ProbeOutput | Promise<ProbeOutput>): WolvenKitProbeResult | Promise<WolvenKitProbeResult> {
  const found = new RegExp(`\\b(${SUPPORTED_WOLVENKIT_VERSIONS.map(value => value.replace(/\./g, "\\.")).join("|")})\\b`).exec(version.text);
  if (isRuntimeMissing(version.status, version.text))
    return { ok: false, code: "runtime_missing", issue: WOLVENKIT_RUNTIME_MISSING_MESSAGE };
  if (version.failed || version.status !== 0 || !found)
    return { ok: false, code: "unsupported", issue: `WolvenKit CLI must be a verified ${SUPPORTED_WOLVENKIT_VERSIONS.join(" or ")} installation.` };
  const judge = (output: ProbeOutput): WolvenKitProbeResult => output.failed || output.status !== 0 ||
      !["import", "export", "convert", "pack", "extract", "uncook", "unbundle"].every(name => new RegExp(`\\b${name}\\b`, "i").test(output.text))
    ? { ok: false, code: "commands", issue: "WolvenKit CLI does not offer the commands XF Studio needs." }
    : { ok: true, version: found[1]! };
  const output = help();
  return output instanceof Promise ? output.then(judge) : judge(output);
}
const remember = (key: string, result: WolvenKitProbeResult, now: number) => {
  probeMemo.set(key, { result, until: result.ok ? Infinity : now + 10_000 });
  return result;
};

/** The cached probe result for this exact file, or null when it has not been checked recently. */
export function cachedWolvenKitProbeResult(cli: string, now = Date.now()): WolvenKitProbeResult | null {
  if (!isFile(cli)) return { ok: false, code: "tool_missing", issue: "WolvenKit CLI isn't available." };
  const cached = probeMemo.get(`${cli}|${stamp(cli)}`);
  return cached && now < cached.until ? cached.result : null;
}

/**
 * Run the CLI's `--version` and `--help` and check it is a verified version with the commands the
 * pipeline uses. Cached per file stamp; a failure is retried after a short interval. Blocks; hosts
 * answering requests use `probeWolvenKitCliAsync` instead.
 */
export function probeWolvenKitCli(cli: string, now = Date.now()): WolvenKitProbeResult {
  const cached = cachedWolvenKitProbeResult(cli, now);
  if (cached) return cached;
  const run = (args: string[]): ProbeOutput => {
    const result = spawnSync(cli, args, { encoding: "utf8", timeout: 15_000, windowsHide: true });
    return { status: result.status, text: `${result.stdout ?? ""}${result.stderr ?? ""}`, failed: !!result.error };
  };
  return remember(`${cli}|${stamp(cli)}`, judgeProbe(run(["--version"]), () => run(["--help"])) as WolvenKitProbeResult, now);
}

const probesInFlight = new Map<string, Promise<WolvenKitProbeResult>>();
/** The same checks without blocking the event loop; concurrent callers share one run per file. */
export function probeWolvenKitCliAsync(cli: string): Promise<WolvenKitProbeResult> {
  const cached = cachedWolvenKitProbeResult(cli);
  if (cached) return Promise.resolve(cached);
  const key = `${cli}|${stamp(cli)}`;
  let pending = probesInFlight.get(key);
  if (!pending) {
    const run = async (args: string[]): Promise<ProbeOutput> => {
      const result = await runProcessTree(cli, args, { timeoutMs: 15_000, keep: 16_000 });
      return { status: result.exitCode, text: result.stdout + result.stderr, failed: !!result.error || !!result.stopped };
    };
    pending = (async () => remember(key, await judgeProbe(await run(["--version"]), () => run(["--help"])), Date.now()))()
      .finally(() => probesInFlight.delete(key));
    probesInFlight.set(key, pending);
  }
  return pending;
}
