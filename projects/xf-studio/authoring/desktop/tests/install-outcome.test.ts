import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { innoSetupHome } from "../single-installer";

// The single setup decides success by what is installed (installer/install-outcome.iss). These tests compile that Pascal code into a
// small harness setup with the pinned Inno Setup and run it silently with fake facts: no Electrobun setup runs and nothing is
// installed. They need Windows and the pinned compiler (unpacked by `bun run build:installer`, or XFS_INNO_SETUP_HOME).
const iscc = resolve(innoSetupHome(), "compiler", "ISCC.exe");
const available = process.platform === "win32" && existsSync(iscc);
const harness = resolve(import.meta.dir, "install-outcome-harness.iss");

const io = { installed: 0, filesOnly: 1, appOpen: 2, setupBusy: 3, failed: 4, notStarted: 5 } as const;
const ellipsis = "\u2026";

let compiled: string | null = null;
/** The harness setup, compiled once for this file (removed after its tests). */
function harnessSetup(): string {
  if (compiled) return compiled;
  const work = mkdtempSync(resolve(tmpdir(), "xfs-outcome-"));
  const compile = spawnSync(iscc, [`/DOutputDir=${work}`, "/Q", harness], { encoding: "utf8", cwd: import.meta.dir, timeout: 120_000, windowsHide: true });
  if (compile.status !== 0) throw Error(`The harness did not compile:\n${compile.stdout}${compile.stderr}`);
  return compiled = resolve(work, "outcome-harness.exe");
}
afterAll(() => { if (compiled) rmSync(resolve(compiled, ".."), { recursive: true, force: true }); });

/** Run every case in one silent run of the harness; one answer per case. */
function run(cases: readonly string[]): string[] {
  const work = mkdtempSync(resolve(tmpdir(), "xfs-outcome-run-"));
  try {
    const input = resolve(work, "cases.txt"), output = resolve(work, "results.txt");
    writeFileSync(input, cases.join("\r\n") + "\r\n");
    spawnSync(harnessSetup(), ["/VERYSILENT", "/SUPPRESSMSGBOXES", `/CASES=${input}`, `/OUT=${output}`], { timeout: 120_000, windowsHide: true });
    if (!existsSync(output)) throw Error("The harness wrote no results.");
    return readFileSync(output, "utf8").split(/\r?\n/).slice(0, cases.length);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

describe.skipIf(!available)("single setup outcome (Inno Setup Pascal, Windows)", () => {
  test("success is decided by what is installed, then by Electrobun's closing error, never by its exit code alone", () => {
    const cases: [string, number][] = [
      // Files and integration in place: installed, whatever Electrobun printed (it returns 1 for errors raised after committing files).
      ["classify|1|1|1|", io.installed],
      ["classify|1|1|1|InvalidUninstallLocation", io.installed],
      // This build's files committed but no uninstall entry: the 27 September report (Electrobun ran inside another app's storage).
      ["classify|1|1|0|InvalidUninstallLocation", io.filesOnly],
      ["classify|1|1|0|", io.filesOnly],
      // Nothing new installed: the reason from Electrobun's closing error name.
      ["classify|1|0|0|AccessDenied", io.appOpen],
      ["classify|1|0|0|FileBusy", io.appOpen],
      ["classify|1|0|0|PermissionDenied", io.appOpen],
      ["classify|1|0|0|InstallationAlreadyInProgress", io.setupBusy],
      ["classify|1|0|0|MissingInstallerArchive", io.failed],
      ["classify|1|0|0|", io.failed],
      // An older registration alone (this build's files missing) is not success.
      ["classify|1|0|1|", io.failed],
      ["classify|0|0|0|", io.notStarted],
      ["classify|0|1|1|", io.notStarted],
    ];
    expect(run(cases.map(([line]) => line))).toEqual(cases.map(([, outcome]) => String(outcome)));
  });

  test("each outcome has its exit code, a heading and one plain next step", () => {
    const outcomes = Object.values(io);
    const results = run([...outcomes.map(outcome => `exit|${outcome}`), ...outcomes.map(outcome => `heading|${outcome}`),
      ...outcomes.map(outcome => `text|${outcome}`)]);
    const exits = results.slice(0, outcomes.length), headings = results.slice(outcomes.length, 2 * outcomes.length);
    const texts = results.slice(2 * outcomes.length);
    expect(exits).toEqual(["0", "103", "101", "101", "101", "100"]);
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome === io.installed) continue;
      expect(headings[index], `heading ${outcome}`).toMatch(/^[A-Z][^.]+$/);
      // One next step, in plain words: never a bare "failed", an error name or a path.
      expect(texts[index], `text ${outcome}`).toMatch(outcome === io.notStarted ? /run the new copy\.$/ : /Try again/);
      expect(texts[index]).not.toMatch(/failed|error|Electrobun|[A-Z]:\\|exit code/i);
    }
  });

  test("Electrobun's output: phases shown in plain words, the closing error name read", () => {
    expect(run([
      "phase|Preparing installation...", "phase|Decompressing application...", "phase|Extracting application files...",
      "phase|Installing application files...", "phase|Creating shortcuts and integration...", "phase|Installation failed.",
      "fatal|error: InvalidUninstallLocation", "fatal|error: AccessDenied ", "fatal|Warning: error.AccessDenied", "fatal|Installation failed.",
    ])).toEqual(["", `Unpacking XF Studio${ellipsis}`, `Unpacking XF Studio${ellipsis}`, `Copying XF Studio to your computer${ellipsis}`,
      `Adding XF Studio to your Start menu${ellipsis}`, "", "InvalidUninstallLocation", "AccessDenied", "", ""]);
  });

  test("the installed build and its uninstall entry are recognised exactly", () => {
    const version = '{"version":"0.1.0-alpha.1","hash":"t616yf10pay6","channel":"canary","baseUrl":"","name":"XFStudio-canary"}';
    expect(run([
      `version|${version}|t616yf10pay6`, `version|${version}|s07bb9n790wi`, `version|${version}|t616yf10pay`, `version|${version}|`,
      "location|C:\\Users\\Someone\\AppData\\Local\\dev.axefrog.xf-studio\\canary\\app|C:\\Users\\Someone\\AppData\\Local\\dev.axefrog.xf-studio\\canary\\app",
      "location|c:\\users\\someone\\appdata\\local\\dev.axefrog.xf-studio\\canary\\app\\|C:\\Users\\Someone\\AppData\\Local\\dev.axefrog.xf-studio\\canary\\app",
      "location|C:\\Users\\Someone\\AppData\\Local\\dev.axefrog.xf-studio\\stable\\app|C:\\Users\\Someone\\AppData\\Local\\dev.axefrog.xf-studio\\canary\\app",
      "location||C:\\Users\\Someone\\AppData\\Local\\dev.axefrog.xf-studio\\canary\\app",
    ])).toEqual(["yes", "no", "no", "no", "yes", "yes", "no", "no"]);
  });

  test("a Microsoft Store app's private storage is told apart from the real local app data folder", () => {
    const root = "\\\\?\\C:\\Users\\Someone\\AppData\\Local";
    expect(run([
      "strip|\\\\?\\C:\\x\\y", "strip|\\\\?\\UNC\\server\\share\\x", "strip|C:\\x",
      `redirected|${root}|${root}\\xfs-setup-probe-1|xfs-setup-probe-1`,
      `redirected|${root}|\\\\?\\c:\\users\\someone\\appdata\\local\\XFS-SETUP-PROBE-1|xfs-setup-probe-1`,
      `redirected|${root}|${root}\\Packages\\SomeApp_abc123\\LocalCache\\Local\\xfs-setup-probe-1|xfs-setup-probe-1`,
      `redirected||${root}\\xfs-setup-probe-1|xfs-setup-probe-1`,
      `redirected|${root}||xfs-setup-probe-1`,
    ])).toEqual(["C:\\x\\y", "\\\\server\\share\\x", "C:\\x", "no", "no", "yes", "no", "no"]);
  });

  test("the physical-path lookup reads a real folder through the Windows API", () => {
    const folder = mkdtempSync(resolve(tmpdir(), "xfs-physical-"));
    try {
      const [physical, missing] = run([`physical|${folder}`, `physical|${resolve(folder, "missing")}`]);
      expect(physical!.toLowerCase()).toBe(realpathSync.native(folder).toLowerCase());
      expect(missing).toBe("");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
