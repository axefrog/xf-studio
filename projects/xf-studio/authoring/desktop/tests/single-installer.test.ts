import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INNO_DATA_FORMAT, INNO_DATA_MARKER, INNO_SETUP, WRAPPER_BUDGET, WRAPPER_MEASURED, WRAPPER_PLAIN_TEXT, innoSetupHome, payloadMembers,
  quadVersion, setupProgramName, singleInstallerWrapper, wrapperTexts } from "../single-installer";
import { contentIssues } from "../package-content-scan";

const bytes = (text: string) => Buffer.from(text, "latin1");
const members = [
  { name: payloadMembers[0], bytes: bytes("MZ electrobun setup program") },
  { name: payloadMembers[1], bytes: bytes('{"identifier":"dev.axefrog.xf-studio"}') },
  { name: payloadMembers[2], bytes: Buffer.alloc(4096, 7) },
];
const exe = (...parts: Uint8Array[]) => Buffer.concat(parts);
const loader = bytes("MZ inno loader ");
/** The setup data as InternalCompressLevel=none stores it: the marker, then the script's strings as UTF-16 text (REL-04). */
const header = Buffer.concat([bytes(`${INNO_DATA_MARKER} header `), Buffer.from(WRAPPER_PLAIN_TEXT.join(" | "), "utf16le")]);
/** The same data compressed, as Inno Setup stores it by default: nothing readable. */
const compressed = bytes(`${INNO_DATA_MARKER} \x78\x9c\x01\x02\x03 compressed`);

describe("single-file setup", () => {
  test("wraps Electrobun's canary setup program and its two hidden payload files", () => {
    expect(setupProgramName).toBe("XF Studio-Setup-canary.exe");
    expect([...payloadMembers]).toEqual(["XF Studio-Setup-canary.exe", ".installer/XF Studio-Setup-canary.metadata.json",
      ".installer/XF Studio-Setup-canary.tar.zst"]);
    // Each pre-release its own Windows file version, in release order, the release itself highest (REL-06).
    expect(["0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-beta.1", "0.1.0-rc.1", "0.1.0", "0.1.1-alpha.1"].map(quadVersion))
      .toEqual(["0.1.0.1001", "0.1.0.1002", "0.1.0.2001", "0.1.0.3001", "0.1.0.65535", "0.1.1.1001"]);
    expect(quadVersion("12.3.40")).toBe("12.3.40.65535");
    expect(quadVersion("1.2.3-alpha.4+build.7")).toBe("1.2.3.1004");
    expect(() => quadVersion("v1")).toThrow("Windows file version");
    expect(() => quadVersion("70000.0.0")).toThrow("Windows file version");
    for (const version of ["0.1.0-alpha", "0.1.0-canary.1", "0.1.0-alpha.1000", "0.1.0-alpha.0"]) expect(() => quadVersion(version), version).toThrow("distinct Windows file version");
  });

  test("Inno Setup is pinned to one official release and unpacked outside the source tree", () => {
    expect(INNO_SETUP.url).toStartWith("https://github.com/jrsoftware/issrc/releases/download/");
    expect(INNO_SETUP.url).toContain(INNO_SETUP.version);
    expect(INNO_SETUP.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(innoSetupHome({})).toEndWith(`installer-tools${require("node:path").sep}innosetup-${INNO_SETUP.version}`);
    expect(innoSetupHome({ XFS_INNO_SETUP_HOME: resolve("/tools/inno") })).toBe(resolve("/tools/inno"));
  });

  test("accepts the verified payload inside Inno Setup's wrapper and returns only the wrapper bytes", () => {
    const wrapper = singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, members[2].bytes, header), members);
    expect(wrapper.equals(exe(loader, header))).toBe(true);
  });

  test("refuses a changed, missing, repeated or padded payload", () => {
    const changed = Buffer.from(members[2].bytes); changed[100] = 8;
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, changed, header), members))
      .toThrow(`does not carry the verified ${payloadMembers[2]}`);
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[2].bytes, header), members))
      .toThrow(`does not carry the verified ${payloadMembers[1]}`);
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, members[2].bytes, members[1].bytes, header), members))
      .toThrow("more than once");
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, members[2].bytes, header,
      Buffer.alloc(WRAPPER_BUDGET, 1)), members)).toThrow("bytes besides the verified payload");
  });

  test("refuses a setup whose own data is compressed, since the content scan would read compressed bytes (REL-04)", () => {
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, members[2].bytes, compressed), members))
      .toThrow("InternalCompressLevel=none");
    // The budget is the measured wrapper plus a little room for the script's text, not another file's worth.
    expect(WRAPPER_BUDGET).toBeGreaterThan(WRAPPER_MEASURED);
    expect(WRAPPER_BUDGET - WRAPPER_MEASURED).toBeLessThan(100_000);
  });

  test("refuses a file that is not an Inno Setup Windows executable", () => {
    expect(() => singleInstallerWrapper(exe(bytes("PK"), members[0].bytes, members[1].bytes, members[2].bytes, header), members))
      .toThrow("not a Windows executable");
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, members[2].bytes), members))
      .toThrow(`Inno Setup ${INNO_SETUP.version} (its ${INNO_DATA_FORMAT} setup-data marker is missing)`);
  });

  test("the wrapper content scan reads Latin-1 and UTF-16 strings", () => {
    const planted = ["C:\\", "Users\\", "jdoe\\build\\x.iss"].join("");
    for (const encoded of [Buffer.from(planted, "latin1"), Buffer.from(planted, "utf16le"), exe(bytes("x"), Buffer.from(planted, "utf16le"))]) {
      const issues = wrapperTexts(exe(loader, encoded, header)).flatMap(text => contentIssues("setup.exe", text));
      expect(issues.map(issue => issue.kind)).toContain("user-path");
    }
    expect(wrapperTexts(exe(loader, header)).flatMap(text => contentIssues("setup.exe", text))).toEqual([]);
  });

  test("the Inno Setup script keeps the wrapper per-user, uninstall-free and path-free", () => {
    const script = readFileSync(resolve(import.meta.dir, "../installer/xf-studio-setup.iss"), "utf8");
    for (const line of ["PrivilegesRequired=lowest", "CreateAppDir=no", "Uninstallable=no", "Compression=none", "ArchitecturesAllowed=x64compatible",
      // Setup's own data readable by the content scan (REL-04); one setup at a time (REL-06).
      "InternalCompressLevel=none", "SetupMutex=dev.axefrog.xf-studio.setup"])
      expect(script).toContain(line);
    expect(script).not.toMatch(/[A-Za-z]:\\/);
    // The plain-text proof reads strings the script really compiles in.
    for (const text of WRAPPER_PLAIN_TEXT) expect(script).toContain(text);
  });

  test("custom exit codes stay clear of Inno Setup's own 1-8, and are documented (REL-05)", () => {
    const script = readFileSync(resolve(import.meta.dir, "../installer/xf-studio-setup.iss"), "utf8");
    const codes = [...script.matchAll(/InstallExitCode := (\d+);/g)].map(match => Number(match[1]));
    expect(codes).toEqual([100, 101]);
    const readme = readFileSync(resolve(import.meta.dir, "../README.md"), "utf8");
    for (const code of codes) {
      expect(script).toMatch(new RegExp(`^;\\s+${code}\\s`, "m"));
      expect(readme).toContain(`exit code ${code}`);
    }
  });
});
