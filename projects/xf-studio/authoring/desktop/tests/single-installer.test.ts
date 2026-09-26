import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INNO_DATA_MARKER, INNO_SETUP, WRAPPER_BUDGET, innoSetupHome, payloadMembers, quadVersion, setupProgramName,
  singleInstallerWrapper, wrapperTexts } from "../single-installer";
import { contentIssues } from "../package-content-scan";

const bytes = (text: string) => Buffer.from(text, "latin1");
const members = [
  { name: payloadMembers[0], bytes: bytes("MZ electrobun setup program") },
  { name: payloadMembers[1], bytes: bytes('{"identifier":"dev.axefrog.xf-studio"}') },
  { name: payloadMembers[2], bytes: Buffer.alloc(4096, 7) },
];
const exe = (...parts: Uint8Array[]) => Buffer.concat(parts);
const loader = bytes("MZ inno loader ");
const header = bytes(`${INNO_DATA_MARKER} compressed header`);

describe("single-file setup", () => {
  test("wraps Electrobun's canary setup program and its two hidden payload files", () => {
    expect(setupProgramName).toBe("XF Studio-Setup-canary.exe");
    expect([...payloadMembers]).toEqual(["XF Studio-Setup-canary.exe", ".installer/XF Studio-Setup-canary.metadata.json",
      ".installer/XF Studio-Setup-canary.tar.zst"]);
    expect(quadVersion("0.1.0-alpha.1")).toBe("0.1.0.0");
    expect(quadVersion("12.3.40")).toBe("12.3.40.0");
    expect(() => quadVersion("v1")).toThrow("Windows file version");
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

  test("refuses a file that is not an Inno Setup Windows executable", () => {
    expect(() => singleInstallerWrapper(exe(bytes("PK"), members[0].bytes, members[1].bytes, members[2].bytes, header), members))
      .toThrow("not a Windows executable");
    expect(() => singleInstallerWrapper(exe(loader, members[0].bytes, members[1].bytes, members[2].bytes), members))
      .toThrow(`Inno Setup ${INNO_SETUP.version}`);
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
    for (const line of ["PrivilegesRequired=lowest", "CreateAppDir=no", "Uninstallable=no", "Compression=none", "ArchitecturesAllowed=x64compatible"])
      expect(script).toContain(line);
    expect(script).not.toMatch(/[A-Za-z]:\\/);
  });
});
