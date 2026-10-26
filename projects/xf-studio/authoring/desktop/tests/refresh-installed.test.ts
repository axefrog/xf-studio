import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tempDir } from "../../tests/temp-dir";
import { instanceName } from "../single-instance";
import { installedInstanceName, installedUserData } from "../tools/installed-instance-name";

// tools/refresh-installed.ps1's helper (tools/refresh-helper.py), run for real against fixtures: a fake setup that installs (or fails to
// install) files into a temporary app folder, a temporary mutex name and a temporary HKCU key standing in for Electrobun's uninstall entry.
const python = join(process.env.LOCALAPPDATA ?? "", "Python", "pythoncore-3.14-64", "python.exe");
const helper = resolve(import.meta.dir, "..", "tools", "refresh-helper.py");
const runnable = process.platform === "win32" && existsSync(python);
const hash = "fixturehash01";
const files: Record<string, string> = { "Resources/version.json": JSON.stringify({ hash }), "bin/launcher.exe": "launcher", "Resources/app/bun/index.js": "main();" };
const listing = [
  "drwxrwxrwx  0 0      0           0 Oct 26 13:12 XFStudio-canary/",
  "drwxrwxrwx  0 0      0           0 Oct 26 13:12 XFStudio-canary/bin/",
  ...Object.entries(files).map(([path, text]) => `-rw-rw-rw-  0 0      0 ${String(Buffer.byteLength(text)).padStart(10)} Oct 26 13:12 XFStudio-canary/${path}`),
].join("\n");
const fakeSetup = `
import json, os, sys, time
mode, app, build_hash, marker, files = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], json.loads(sys.argv[5])
open(os.path.join(marker, "setup-ran"), "w").write(os.environ.get("XFS_INSTALL_REFRESH", "unset") + " " + str(os.getpid()))
if mode == "sleep":
    time.sleep(120)
for path, text in files.items():
    if mode == "missing" and path == "bin/launcher.exe":
        continue
    if mode == "wrong-hash" and path == "Resources/version.json":
        text = json.dumps({"hash": "someotherbuild"})
    target = os.path.join(app, *path.split("/"))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    open(target, "w").write(text)
`;
const holdMutex = `
import ctypes, sys, time
k = ctypes.WinDLL("kernel32")
k.CreateMutexW.restype = ctypes.c_void_p
h = k.CreateMutexW(None, False, sys.argv[1])
k.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
assert k.WaitForSingleObject(h, 0) == 0
print("held", flush=True)
time.sleep(30)
`;

type Result = { outcome: string; reason: string; current: boolean; setupExit: number | null; problems: string[] };
const reg = (...args: string[]) => spawnSync("reg.exe", args, { windowsHide: true, encoding: "utf8" });

function scenario(mode: string, options: { timeoutSec?: number; skipIfCurrent?: boolean; uninstallEntry?: boolean; preinstalled?: boolean } = {}) {
  const dir = tempDir("xfs-refresh-helper-");
  const app = join(dir, "app"), marker = join(dir, "marker"), resultFile = join(dir, "result.json");
  mkdirSync(app, { recursive: true }); mkdirSync(marker, { recursive: true });
  writeFileSync(join(dir, "listing.txt"), listing);
  writeFileSync(join(dir, "fake-setup.py"), fakeSetup);
  const key = `Software\\XFStudioTest\\refresh-${crypto.randomUUID()}`;
  if (options.uninstallEntry !== false) reg("add", `HKCU\\${key}`, "/f");
  if (options.preinstalled) for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(app, ...path.split("/").slice(0, -1)), { recursive: true }); writeFileSync(join(app, ...path.split("/")), text);
  }
  const mutex = `Local\\XFStudioTest-${crypto.randomUUID()}`;
  const config = { mutex, localAppData: process.env.LOCALAPPDATA, appDir: app, hash, uninstallKey: key, listingFile: join(dir, "listing.txt"),
    skipIfCurrent: options.skipIfCurrent ?? false, timeoutSec: options.timeoutSec ?? 60, result: resultFile,
    setup: [python, join(dir, "fake-setup.py"), mode, app, hash, marker, JSON.stringify(files)] };
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  const cleanup = () => { reg("delete", `HKCU\\${key}`, "/f"); };
  const run = () => {
    const done = spawnSync(python, [helper, join(dir, "config.json")], { windowsHide: true, encoding: "utf8" });
    expect(done.status).toBe(0);
    const ran = existsSync(join(marker, "setup-ran")) ? readFileSync(join(marker, "setup-ran"), "utf8") : null;
    return { result: JSON.parse(readFileSync(resultFile, "utf8")) as Result, ran };
  };
  return { mutex, run, cleanup };
}

describe.skipIf(!runnable)("the install-refresh helper", () => {
  test("a complete install is installed, and the setup got the switch that stops the app's own launch", () => {
    const s = scenario("ok");
    try {
      const { result, ran } = s.run();
      expect(result).toMatchObject({ outcome: "installed", current: false, setupExit: 0, problems: [] });
      expect(ran?.startsWith("1 ")).toBe(true);
    } finally { s.cleanup(); }
  }, 30_000);

  test("a missing file fails the install, naming it", () => {
    const s = scenario("missing");
    try {
      const { result } = s.run();
      expect(result.outcome).toBe("failed");
      expect(result.problems).toContain("missing: bin/launcher.exe");
      expect(result.reason).toContain("incomplete");
    } finally { s.cleanup(); }
  }, 30_000);

  test("a version.json naming another build fails the install", () => {
    const s = scenario("wrong-hash");
    try {
      const { result } = s.run();
      expect(result.outcome).toBe("failed");
      expect(result.problems.join("\n")).toContain("someotherbuild");
    } finally { s.cleanup(); }
  }, 30_000);

  test("a missing uninstall entry fails the install", () => {
    const s = scenario("ok", { uninstallEntry: false });
    try {
      const { result } = s.run();
      expect(result.outcome).toBe("failed");
      expect(result.problems).toContain("Electrobun's uninstall entry is missing");
    } finally { s.cleanup(); }
  }, 30_000);

  test("a setup that outlasts the deadline fails, and nothing it started is left running", async () => {
    const s = scenario("sleep", { timeoutSec: 1 });
    try {
      const started = Date.now();
      const { result, ran } = s.run();
      expect(result.outcome).toBe("failed");
      expect(result.reason).toContain("did not finish");
      expect(Date.now() - started).toBeLessThan(15_000);
      const pid = Number(ran!.split(" ")[1]);
      const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      for (let i = 0; i < 50 && alive(); i++) await Bun.sleep(100);
      expect(alive()).toBe(false);
    } finally { s.cleanup(); }
  }, 30_000);

  test("a running app (its instance lock held) is left alone: pending, and the setup never starts", async () => {
    const s = scenario("ok");
    const holder = Bun.spawn([python, "-c", holdMutex, s.mutex], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    try {
      const reader = holder.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("held");
      const { result, ran } = s.run();
      expect(result.outcome).toBe("pending");
      expect(ran).toBeNull();
    } finally { holder.kill(); s.cleanup(); }
  }, 30_000);

  test("an install that is already complete is current only when asked, and then runs no setup", () => {
    const current = scenario("ok", { preinstalled: true, skipIfCurrent: true });
    try {
      const { result, ran } = current.run();
      expect(result).toMatchObject({ outcome: "installed", current: true, setupExit: null });
      expect(ran).toBeNull();
    } finally { current.cleanup(); }
    const asked = scenario("ok", { preinstalled: true });
    try { expect(asked.run().ran).not.toBeNull(); } finally { asked.cleanup(); }
  }, 30_000);
});

describe("the installed app's instance lock name", () => {
  test("is the one main.ts claims for the data folder Electrobun gives an installed app", () => {
    const local = String.raw`C:\Users\Someone\AppData\Local`;
    expect(installedUserData(local, "dev.axefrog.xf-studio", "canary")).toBe(String.raw`C:\Users\Someone\AppData\Local\dev.axefrog.xf-studio\canary`);
    const name = installedInstanceName(local, "dev.axefrog.xf-studio", "canary");
    expect(name).toBe(instanceName(String.raw`c:\users\someone\appdata\local\dev.axefrog.xf-studio\canary`));
    expect(name).toMatch(/^Local\\XFStudio-[0-9a-f]{40}$/);
    expect(installedInstanceName(local, "dev.axefrog.xf-studio", "stable")).not.toBe(name);
    // The two halves of the pairing: main.ts claims the lock for Utils.paths.userData, and this module names it from that path's parts.
    expect(readFileSync(resolve(import.meta.dir, "..", "main.ts"), "utf8")).toContain("claimSingleInstance(Utils.paths.userData");
  });
});
