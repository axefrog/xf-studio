import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyWolvenKitRun, isRuntimeMissing, runWolvenKit, runWolvenKitSync, WOLVENKIT_RUNTIME_MISSING_MESSAGE, wolvenKitIdentity,
  wolvenKitIdentityKey, WolvenKitRunError } from "../src/wolvenkit-cli";
import { createWolvenKitVerifierTools } from "../src/verifier-wolvenkit";
import type { ProcessTreeResult } from "../src/process-tree";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const result = (patch: Partial<ProcessTreeResult>): ProcessTreeResult => ({ exitCode: 0, stdout: "", stderr: "", stopped: null, ...patch });
const failure = (run: () => unknown) => { try { run(); } catch (error) { return error as WolvenKitRunError; } throw Error("expected a failure"); };

test("one success policy: exit code, unhandled exceptions, time limit and cancellation are typed", () => {
  expect(classifyWolvenKitRun("cli uncook", result({ stdout: "Uncooked 2/2 files." })).exitCode).toBe(0);
  expect(failure(() => classifyWolvenKitRun("cli uncook", result({ exitCode: 1, stderr: "boom" })))).toMatchObject({ code: "tool_failed", exitCode: 1 });
  expect(failure(() => classifyWolvenKitRun("cli uncook", result({ stdout: "Unhandled exception: System.IO" })))).toMatchObject({ code: "tool_failed" });
  expect(failure(() => classifyWolvenKitRun("cli uncook", result({ exitCode: null, stopped: "timeout" })))).toMatchObject({ code: "tool_timeout" });
  expect(failure(() => classifyWolvenKitRun("cli uncook", result({ exitCode: null, stopped: "cancelled" })))).toMatchObject({ code: "cancelled" });
  expect(failure(() => classifyWolvenKitRun("cli uncook", result({ exitCode: null, error: Error("ENOENT") })))).toMatchObject({ code: "tool_failed" });
  // Consumers widen or tighten the policy per command.
  const counts = /Imported (\d+)\/(\d+)/;
  const accept = (run: { exitCode: number; output: string }) => run.exitCode === 3 && counts.exec(run.output)?.[1] === counts.exec(run.output)?.[2];
  expect(classifyWolvenKitRun("cli import", result({ exitCode: 3, stdout: "Imported 4/4 file(s)" }), { accept }).exitCode).toBe(3);
  expect(failure(() => classifyWolvenKitRun("cli import", result({ exitCode: 3, stdout: "Imported 3/4 file(s)" }), { accept }))).toMatchObject({ code: "tool_failed" });
  expect(failure(() => classifyWolvenKitRun("cli pack", result({ stdout: "[ Error ] bad" }), { failure: /\bError\s*\]/ }))).toMatchObject({ code: "tool_failed" });
  // The full output is kept for logs.
  const long = "x".repeat(10_000);
  expect(failure(() => classifyWolvenKitRun("cli pack", result({ exitCode: 2, stdout: long }))).output).toHaveLength(10_000);
});

test("a missing .NET runtime is recognised from the host's own message or exit code", () => {
  const message = "You must install .NET to run this application.\r\n\r\nApp: C:\\tools\\WolvenKit.CLI.exe\r\nArchitecture: x64";
  expect(isRuntimeMissing(131, message)).toBe(true);
  expect(isRuntimeMissing(1, "You must install or update .NET to run this application.")).toBe(true);
  expect(isRuntimeMissing(0x80008096, "")).toBe(true);
  expect(isRuntimeMissing(-2147450730, "")).toBe(true);
  expect(isRuntimeMissing(1, "Unhandled exception")).toBe(false);
  expect(failure(() => classifyWolvenKitRun("cli --version", result({ exitCode: 131, stderr: message })))).toMatchObject({ code: "runtime_missing" });
});

test("a missing CLI is typed before any process starts, and identity is read from the files", async () => {
  await expect(runWolvenKit(null, ["--version"], { timeoutMs: 1000 })).rejects.toMatchObject({ code: "tool_missing" });
  await expect(runWolvenKit(join(tmpdir(), "no-such-wolvenkit.exe"), ["--version"], { timeoutMs: 1000 })).rejects.toBeInstanceOf(WolvenKitRunError);
  const root = mkdtempSync(join(tmpdir(), "xfs-wk-identity-")); roots.push(root);
  const cli = join(root, "WolvenKit.CLI.exe");
  writeFileSync(cli, "MZ launcher");
  writeFileSync(join(root, "WolvenKit.CLI.dll"), "MZ managed entry");
  const first = wolvenKitIdentity(cli)!;
  expect(first.version).toBeNull();
  expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(wolvenKitIdentityKey(first)).toStartWith("wolvenkit:unknown:");
  // Replacing the managed entry point changes the identity even when the launcher is unchanged.
  await Bun.sleep(5);
  writeFileSync(join(root, "WolvenKit.CLI.dll"), "MZ managed entry, newer build");
  expect(wolvenKitIdentity(cli)!.sha256).not.toBe(first.sha256);
  expect(wolvenKitIdentityKey(null)).toBe("wolvenkit:none");
});

test("the blocking runner applies the same policy, so the verifier gets the shared .NET-missing message", () => {
  // Bun stands in for WolvenKit: the arguments are a script, so each case controls output and exit code.
  const bun = process.execPath;
  expect(runWolvenKitSync(bun, ["-e", "console.log('Unbundled 3/3')"], { timeoutMs: 30_000 })).toMatchObject({ exitCode: 0, stdout: expect.stringContaining("Unbundled 3/3") });
  const dotnet = "console.error('You must install .NET to run this application.'); process.exit(131)";
  expect(failure(() => runWolvenKitSync(bun, ["-e", dotnet], { timeoutMs: 30_000 }))).toMatchObject({ code: "runtime_missing" });
  expect(failure(() => runWolvenKitSync(bun, ["-e", "process.exit(2)"], { timeoutMs: 30_000 }))).toMatchObject({ code: "tool_failed", exitCode: 2 });
  expect(failure(() => runWolvenKitSync(bun, ["-e", "setTimeout(() => {}, 60_000)"], { timeoutMs: 300 }))).toMatchObject({ code: "tool_timeout" });
  expect(failure(() => runWolvenKitSync(join(tmpdir(), "no-such-wolvenkit.exe"), ["unbundle"], { timeoutMs: 1000 }))).toMatchObject({ code: "tool_missing" });
  // The verifier's adapter maps them to plain messages and leaves exit-code judgement to the verifier.
  expect(() => createWolvenKitVerifierTools(join(tmpdir(), "no-such-wolvenkit.exe"), undefined).unbundle("a", "b")).toThrow("WolvenKit CLI isn't available");
  expect(() => createWolvenKitVerifierTools(bun, undefined).exportTextures("a", "b")).toThrow("Cyberpunk 2077 folder");
  expect(WOLVENKIT_RUNTIME_MISSING_MESSAGE).toContain(".NET runtime");
}, 60_000);
