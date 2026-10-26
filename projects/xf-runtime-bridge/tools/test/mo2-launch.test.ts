import { expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";
import { createMo2Launcher, mo2Failure, mo2LogAppended, mo2LogCursor, windowsArgument, type Mo2Port } from "../testing/host.ts";

const spec = { exe: "C:\\mods\\O'Brien MO2\\ModOrganizer.exe", profile: "Test profile", executable: "Game", arguments: "-skipStartScreen" };
function fake(states = ["", "starting", "ready"]) {
  let time = 0;
  const shells: string[] = [], forwarded: unknown[] = [];
  let log = "", dialog: string | null = null;
  const port: Mo2Port = {
    async shell(command) { shells.push(command); return { code: 0, out: command.includes("Invoke-CimMethod") ? "" : states.shift() ?? "starting" }; },
    async forward(...args) { forwarded.push(args); return null; },
    dialog: () => dialog,
    cursor: () => ({ size: 123, ino: 7 }),
    appended(_path, cursor) { expect(cursor).toEqual({ size: 123, ino: 7 }); return log; },
    now: () => time,
    async sleep(ms) { time += ms; },
  };
  return { port, shells, forwarded, setLog: (s: string) => { log = s; dialog = "Cannot launch program"; }, time: () => time };
}

test("fresh MO2 starts with WMI and profile/cwd, then forwards only once its window exists", async () => {
  const f = fake();
  const result = await createMo2Launcher(f.port).launch(spec);
  expect(result.started).toBe(true);
  expect(f.shells[1]).toContain("Invoke-CimMethod -ClassName Win32_Process -MethodName Create");
  expect(f.shells[1]).toContain('"-p" "Test profile"');
  expect(f.shells[1]).toContain("CurrentDirectory = 'C:\\mods\\O''Brien MO2'");
  expect(f.forwarded).toEqual([[spec.exe, ["-p", spec.profile, "run", "-e", "Game", "--arguments", "-skipStartScreen"]]]);
  expect(f.time()).toBe(500);
});
test("an existing ready MO2 only receives the run command", async () => {
  const f = fake(["ready"]);
  expect((await createMo2Launcher(f.port).launch(spec)).started).toBe(true);
  expect(f.shells).toHaveLength(1);
  expect(f.forwarded).toHaveLength(1);
});
test("an existing starting MO2 is awaited without starting a second instance", async () => {
  const f = fake(["starting", "ready"]);
  expect((await createMo2Launcher(f.port).launch(spec)).started).toBe(true);
  expect(f.shells.every((s) => !s.includes("Invoke-CimMethod"))).toBe(true);
});
test("window wait is bounded, with no game forwarding on timeout", async () => {
  const f = fake(["starting"]);
  expect((await createMo2Launcher(f.port).launch(spec)).error).toContain("30 seconds");
  expect(f.time()).toBe(30_000);
  expect(f.forwarded).toHaveLength(0);
});
test("WMI failure does not forward", async () => {
  const f = fake(); const shell = f.port.shell;
  f.port.shell = async (s) => s.includes("Invoke-CimMethod") ? { code: 1, out: "WMI refused" } : shell(s);
  expect((await createMo2Launcher(f.port).launch(spec)).error).toContain("WMI refused");
  expect(f.forwarded).toHaveLength(0);
});
test("cancellation before startup or during window wait never forwards", async () => {
  const f = fake(); const controller = new AbortController(); controller.abort();
  expect((await createMo2Launcher(f.port).launch(spec, controller.signal)).started).toBe(false);
  expect(f.shells).toHaveLength(0);
  const waiting = new AbortController();
  f.port.sleep = async () => { waiting.abort(); };
  expect((await createMo2Launcher(f.port).launch(spec, waiting.signal)).started).toBe(false);
  expect(f.forwarded).toHaveLength(0);
});
test("failure diagnosis reads only this attempt's new log data and preserves the Windows error", async () => {
  const f = fake(["ready"]); const launcher = createMo2Launcher(f.port);
  expect(await launcher.blocked()).toBeNull();
  await launcher.launch(spec);
  f.setLog("Error 5 ERROR_ACCESS_DENIED\nMO elevated: no");
  expect(await launcher.blocked()).toContain("restricted process");
  expect(await launcher.blocked()).toContain("ERROR_ACCESS_DENIED");
  f.setLog("Error 2 ERROR_FILE_NOT_FOUND");
  expect(await launcher.blocked()).toContain("ERROR_FILE_NOT_FOUND");
  expect(await launcher.blocked()).not.toContain("restricted");
  f.setLog("");
  expect(await launcher.blocked()).toContain("no new Windows error");
});
test("unknown failures never invent antivirus and Windows arguments preserve quotes and trailing slashes", () => {
  expect(mo2Failure("")).not.toContain("antivirus");
  expect(windowsArgument('a"b\\')).toBe('"a\\"b\\\\"');
});
test("forwarding errors retain the OS error", async () => {
  const f = fake(["ready"]);
  f.port.forward = async () => "ENOENT: executable missing";
  expect((await createMo2Launcher(f.port).launch(spec)).error).toContain("ENOENT");
});
test("log cursor excludes old access denied errors and reads a fresh Windows error", () => {
  const path = join(tempDir("xfb-mo2-log-"), "mo_interface.log");
  writeFileSync(path, "old Error 5 ERROR_ACCESS_DENIED\n");
  const cursor = mo2LogCursor(path);
  expect(mo2LogAppended(path, cursor)).toBe("");
  appendFileSync(path, "new Error 2 ERROR_FILE_NOT_FOUND\n");
  const detail = mo2Failure(mo2LogAppended(path, cursor));
  expect(detail).toContain("ERROR_FILE_NOT_FOUND");
  expect(detail).not.toContain("ACCESS_DENIED");
});
test("missing, truncated and large logs are tolerated with a bounded tail", () => {
  const path = join(tempDir("xfb-mo2-log-"), "mo_interface.log");
  expect(mo2LogCursor(path)).toBeNull();
  expect(mo2LogAppended(path, null)).toBe("");
  writeFileSync(path, "old".repeat(100));
  const cursor = mo2LogCursor(path);
  writeFileSync(path, "Error 740 ERROR_ELEVATION_REQUIRED\n");
  expect(mo2LogAppended(path, cursor)).toContain("ERROR_ELEVATION_REQUIRED");
  writeFileSync(path, "x".repeat(100_000) + "\nError 2 ERROR_FILE_NOT_FOUND");
  expect(mo2LogAppended(path, null).length).toBeLessThanOrEqual(65536);
  expect(mo2LogAppended(path, null)).toEndWith("ERROR_FILE_NOT_FOUND");
});
