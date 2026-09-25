import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import config from "../electrobun.config";
import desktopPackage from "../package.json";
import { noticeIssues, requireLicence } from "../notices";
import { appVersion, changelogPath, changelogSection, checkTag, isPrerelease, parseChecksums, parseReleaseVersion,
  noticesAssetName, releaseNotes, releaseTag, releaseTitle, setupAssetName, stageRelease, verifyStaged } from "../release";

const root = mkdtempSync(resolve(tmpdir(), "xfs-desktop-release-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const section = (body: string) => `# Log\n\n## Unreleased\n\n### New and improved\n\n## 0.2.0-alpha.1\n\n${body}\n## 0.1.0-alpha.1\n\n### New and improved\n\n- old\n`;

describe("app version", () => {
  test("package.json is the single source for Electrobun and release metadata", () => {
    expect(config.app.version).toBe(desktopPackage.version);
    expect(appVersion().version).toBe(desktopPackage.version);
  });

  test("accepts strict SemVer with alpha, beta or rc suffixes only", () => {
    expect(parseReleaseVersion("0.1.0-alpha.1")).toEqual({ version: "0.1.0-alpha.1", major: 0, minor: 1, patch: 0, stage: "alpha", number: 1 });
    expect(parseReleaseVersion("1.2.3").stage).toBe("stable");
    for (const bad of ["0.1", "v0.1.0", "0.1.0-alpha", "0.1.0-alpha.0", "01.1.0", "0.1.0-preview.1", "0.1.0+build.5", "0.1.0-alpha.1 "])
      expect(() => parseReleaseVersion(bad)).toThrow("Unsupported app version");
  });

  test("derives tag, title, pre-release flag and asset name", () => {
    const alpha = parseReleaseVersion("0.1.0-alpha.1");
    expect(releaseTag(alpha)).toBe("v0.1.0-alpha.1");
    expect(releaseTitle(alpha)).toBe("XF Studio 0.1.0 alpha 1");
    expect(releaseTitle(parseReleaseVersion("0.3.0-beta.2"))).toBe("XF Studio 0.3.0 beta 2");
    expect(releaseTitle(parseReleaseVersion("1.0.0-rc.1"))).toBe("XF Studio 1.0.0 RC 1");
    expect(releaseTitle(parseReleaseVersion("1.0.0"))).toBe("XF Studio 1.0.0");
    expect(isPrerelease(alpha)).toBe(true);
    expect(isPrerelease(parseReleaseVersion("1.0.0"))).toBe(false);
    expect(setupAssetName(alpha)).toBe("XFStudio-0.1.0-alpha.1-win-x64-setup.zip");
  });

  test("a pushed tag must equal v + the checked-in version", () => {
    const version = parseReleaseVersion("0.1.0-alpha.1");
    expect(() => checkTag("v0.1.0-alpha.1", version)).not.toThrow();
    for (const tag of ["0.1.0-alpha.1", "v0.1.0-alpha.2", "v0.1.0", "v0.1.0-alpha.1-fix"])
      expect(() => checkTag(tag, version)).toThrow("does not match the app version");
  });
});

describe("changelog", () => {
  test("the checked-in changelog has a complete section for the current version", () => {
    const current = changelogSection(readFileSync(changelogPath, "utf8"), appVersion().version);
    expect(current.newAndImproved).toContain("- ");
    expect(current.fixes).toContain("- ");
  });

  test("extracts only the requested version's two subsections", () => {
    const text = section("### New and improved\n\n- Shiny thing.\n\n### Fixes and under the hood\n\n<!-- note -->\n- Faster saves.\n");
    expect(changelogSection(text, "0.2.0-alpha.1")).toEqual({ version: "0.2.0-alpha.1", newAndImproved: "- Shiny thing.", fixes: "- Faster saves." });
    expect(changelogSection("## 0.2.0-alpha.1 — 2026-10-01\n### New and improved\n- a\n### Fixes and under the hood\n- b\n", "0.2.0-alpha.1").fixes).toBe("- b");
  });

  test("fails when the section is missing, empty, partial or malformed", () => {
    expect(() => changelogSection(section(""), "0.9.0")).toThrow('no "## 0.9.0" section');
    expect(() => changelogSection(section("### New and improved\n- a\n"), "0.2.0-alpha.1")).toThrow("Fixes and under the hood");
    expect(() => changelogSection(section("### New and improved\n<!-- later -->\n### Fixes and under the hood\n- b\n"), "0.2.0-alpha.1"))
      .toThrow('non-empty "### New and improved"');
    expect(() => changelogSection(section("Loose text\n### New and improved\n- a\n### Fixes and under the hood\n- b\n"), "0.2.0-alpha.1"))
      .toThrow("outside its two subsections");
    expect(() => changelogSection(section("### New and improved\n- a\n### Fixes and under the hood\n- b\n### Commits\n- c\n"), "0.2.0-alpha.1"))
      .toThrow("unexpected subsections: Commits");
    // A prefix of another version must not match.
    expect(() => changelogSection(section(""), "0.2.0-alpha")).toThrow("no ");
  });
});

describe("release staging and notes", () => {
  const version = parseReleaseVersion("0.1.0-alpha.1");
  const out = resolve(root, "release");
  const setupZip = resolve(root, "setup.zip");
  const updateJson = resolve(root, "update.json");
  const lock = resolve(root, "dependencies.lock");
  const commit = "0123456789abcdef0123456789abcdef01234567";
  writeFileSync(setupZip, "PK fake setup");
  writeFileSync(lock, JSON.stringify({ objects: [{ product: "electrobun", version: "2.0.1", relativeRoot: "releases/electrobun/2.0.1/windows-x64" }] }));

  test("stages the named setup ZIP, build information and sha256sum-format checksums", () => {
    writeFileSync(updateJson, JSON.stringify({ identifier: "dev.axefrog.xf-studio", version: "0.1.0-alpha.1", channel: "canary", hash: "abc123" }));
    const assets = stageRelease({ setupZip, updateJson, outDir: out, commit, version, dependencyLock: lock });
    expect(assets.map(asset => asset.name)).toEqual(["XFStudio-0.1.0-alpha.1-win-x64-setup.zip", "build-info.json", noticesAssetName]);
    expect(assets[0].sha256).toBe(createHash("sha256").update("PK fake setup").digest("hex"));
    const info = JSON.parse(readFileSync(resolve(out, "build-info.json"), "utf8"));
    expect(info).toMatchObject({ version: "0.1.0-alpha.1", tag: "v0.1.0-alpha.1", commit, signed: false, updater: "disabled",
      includesGameAssets: false, electrobunBuildHash: "abc123" });
    expect(JSON.stringify(info)).not.toMatch(/[A-Za-z]:[\\/]|\/Users\//);
    const sums = parseChecksums(readFileSync(resolve(out, "SHA256SUMS.txt"), "utf8"));
    expect(sums.map(entry => entry.name)).toEqual(assets.map(asset => asset.name));
    expect(verifyStaged(out).map(asset => asset.sha256)).toEqual(assets.map(asset => asset.sha256));
  });

  test("refuses to stage or release without a project licence", () => {
    writeFileSync(updateJson, JSON.stringify({ version: "0.1.0-alpha.1", channel: "canary", hash: "abc123" }));
    const missing = resolve(root, "no-such-LICENSE");
    expect(() => requireLicence(missing)).toThrow("No LICENSE file at the repository root");
    expect(() => stageRelease({ setupZip, updateJson, outDir: resolve(root, "unlicensed"), commit, version,
      dependencyLock: lock, licence: missing })).toThrow("No LICENSE file");
    const empty = resolve(root, "EMPTY-LICENSE");
    writeFileSync(empty, "  \n");
    expect(() => requireLicence(empty)).toThrow("No LICENSE file");
    expect(() => requireLicence()).not.toThrow();
  });

  test("refuses mismatched metadata, missing commits and altered files", () => {
    writeFileSync(updateJson, JSON.stringify({ version: "0.1.0", channel: "canary", hash: "abc123" }));
    expect(() => stageRelease({ setupZip, updateJson, outDir: resolve(root, "bad"), commit, version, dependencyLock: lock }))
      .toThrow("does not match the app version");
    writeFileSync(updateJson, JSON.stringify({ version: "0.1.0-alpha.1", channel: "canary", hash: "abc123" }));
    expect(() => stageRelease({ setupZip, updateJson, outDir: resolve(root, "bad"), commit: "main", version, dependencyLock: lock }))
      .toThrow("full commit SHA");
    stageRelease({ setupZip, updateJson, outDir: out, commit, version, dependencyLock: lock });
    writeFileSync(resolve(out, "build-info.json"), "{}");
    expect(() => verifyStaged(out)).toThrow("Checksum mismatch for build-info.json");
  });

  test("notes put the curated changelog first, then checksums, provenance and SmartScreen guidance", () => {
    const notes = releaseNotes({ version: "0.1.0-alpha.1", newAndImproved: "- New editor.", fixes: "- Faster." }, version,
      [{ name: "XFStudio-0.1.0-alpha.1-win-x64-setup.zip", sha256: "a".repeat(64), bytes: 1 }]);
    expect(notes.indexOf("- New editor.")).toBeLessThan(notes.indexOf("- Faster."));
    expect(notes.indexOf("- Faster.")).toBeLessThan(notes.indexOf("Verify your download"));
    expect(notes).toContain("alpha pre-release");
    expect(notes).toContain("a".repeat(64));
    expect(notes).toContain("More info → Run anyway");
    expect(notes).toContain("gh attestation verify XFStudio-0.1.0-alpha.1-win-x64-setup.zip --repo axefrog/xf-studio");
    expect(notes).toContain("https://github.com/axefrog/xf-studio/commits/v0.1.0-alpha.1");
    expect(notes).toContain("have not been tested in the game");
    expect(notes).toContain("MIT-licensed");
    expect(notes).toContain(noticesAssetName);
    expect(notes).toContain("built from your own Cyberpunk 2077 installation");
    expect(() => releaseNotes({ version: "0.1.0-alpha.1", newAndImproved: "a", fixes: "b" }, version, []))
      .toThrow("do not include");
  });
});

describe("third-party notices", () => {
  const notices = readFileSync(resolve(import.meta.dir, "../../../THIRD_PARTY_NOTICES.md"), "utf8");
  const facts = { binaries: ["bun.exe", "launcher.exe", "ElectrobunCore.dll", "libNativeWrapper.dll", "libasar.dll",
    "bspatch.exe", "zig-zstd.exe"], bunVersion: "1.4.0", electrobunVersion: "2.0.1", threeVersion: "0.186.0" };

  test("the checked-in notices cover the known shipped programs and versions", () => {
    expect(noticeIssues(notices, facts)).toEqual([]);
    const authoring = JSON.parse(readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8"));
    expect(authoring.dependencies).toEqual({ three: facts.threeVersion });
  });

  test("a new program, a version bump or a dropped licence text is reported", () => {
    expect(noticeIssues(notices, { ...facts, binaries: [...facts.binaries, "WebView2Loader.dll"] }))
      .toEqual(["Shipped program bin/WebView2Loader.dll is not named."]);
    expect(noticeIssues(notices, { ...facts, bunVersion: "1.4.2" })).toEqual([
      "Bun 1.4.2 is not the version listed.", "Bun's licence link does not point at bun-v1.4.2."]);
    expect(noticeIssues(notices, { ...facts, threeVersion: "0.187.0" })).toEqual(["three.js 0.187.0 is not the version listed."]);
    expect(noticeIssues(notices.replace("### Electrobun (MIT)", ""), facts)).toEqual(["Missing licence text: Electrobun (MIT)."]);
  });
});
