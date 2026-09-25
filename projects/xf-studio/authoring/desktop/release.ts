import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import desktopPackage from "./package.json";
import { noticesPath, requireLicence } from "./notices";

// Release metadata for the desktop app. `package.json` `version` is the single
// source of truth: the Electrobun config, packaged version.json/About, the
// artifact gate, the tag check and the release title all derive from it. It is
// independent of recipe, collection, library and manifest schema versions.

export const repository = "axefrog/xf-studio";
export const desktopRoot = import.meta.dir;
export const changelogPath = resolve(desktopRoot, "../../CHANGELOG.md");
/** Electrobun 2.0.1 knows only dev/canary/stable; every pre-release channel builds as `canary`. */
export const electrobunChannel = "canary";
export const canarySetupZip = resolve(desktopRoot, "artifacts", "canary-win-x64-XFStudio-Setup-canary.zip");
export const canaryUpdateJson = resolve(desktopRoot, "artifacts", "canary-win-x64-update.json");
/** Attached to every release beside the setup ZIP; the same file is installed with the app. */
export const noticesAssetName = "THIRD_PARTY_NOTICES.md";

export type ReleaseStage = "alpha" | "beta" | "rc" | "stable";
export type ReleaseVersion = Readonly<{
  version: string; major: number; minor: number; patch: number; stage: ReleaseStage; number: number | null;
}>;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;

/** Strict SemVer with only the supported `-alpha.N`, `-beta.N` or `-rc.N` pre-release suffixes. */
export function parseReleaseVersion(value: string): ReleaseVersion {
  const match = SEMVER.exec(value);
  if (!match) throw Error(`Unsupported app version "${value}": use MAJOR.MINOR.PATCH with an optional -alpha.N, -beta.N or -rc.N suffix.`);
  return { version: value, major: +match[1], minor: +match[2], patch: +match[3],
    stage: (match[4] ?? "stable") as ReleaseStage, number: match[5] ? +match[5] : null };
}

export const appVersion = (): ReleaseVersion => parseReleaseVersion(desktopPackage.version);
export const releaseTag = (version: ReleaseVersion) => `v${version.version}`;
export const isPrerelease = (version: ReleaseVersion) => version.stage !== "stable";
export const setupAssetName = (version: ReleaseVersion) => `XFStudio-${version.version}-win-x64-setup.zip`;
export function releaseTitle(version: ReleaseVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const stage = { alpha: "alpha", beta: "beta", rc: "RC", stable: "" }[version.stage];
  return `XF Studio ${core}${stage ? ` ${stage} ${version.number}` : ""}`;
}

/** The tag a push must carry for the checked-in version; anything else fails the release. */
export function checkTag(tag: string, version: ReleaseVersion): void {
  if (tag !== releaseTag(version))
    throw Error(`Tag "${tag}" does not match the app version ${version.version}; expected ${releaseTag(version)}. ` +
      "Change the version in projects/xf-studio/authoring/desktop/package.json, not the tag.");
}

export type ChangelogSection = Readonly<{ version: string; newAndImproved: string; fixes: string }>;
const NEW = "New and improved";
const FIXES = "Fixes and under the hood";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const meaningful = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "").trim();

/** Extract one version's user-facing section; both subsections must have content. */
export function changelogSection(markdown: string, version: string): ChangelogSection {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const heading = new RegExp(`^## \\[?${escapeRegExp(version)}\\]?(?:\\s+[—–-]\\s+.*)?$`);
  const start = lines.findIndex(line => heading.test(line.trim()));
  if (start < 0) throw Error(`CHANGELOG.md has no "## ${version}" section.`);
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  const subsections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of body) {
    const sub = /^### (.+?)\s*$/.exec(line);
    if (sub) {
      if (subsections.has(sub[1])) throw Error(`CHANGELOG.md ${version} repeats "### ${sub[1]}".`);
      current = []; subsections.set(sub[1], current);
    } else if (current) current.push(line);
    else if (meaningful(line)) throw Error(`CHANGELOG.md ${version} has text outside its two subsections.`);
  }
  const unexpected = [...subsections.keys()].filter(name => name !== NEW && name !== FIXES);
  if (unexpected.length) throw Error(`CHANGELOG.md ${version} has unexpected subsections: ${unexpected.join(", ")}.`);
  const text = (name: string) => {
    const value = meaningful((subsections.get(name) ?? []).join("\n"));
    if (!value) throw Error(`CHANGELOG.md ${version} needs a non-empty "### ${name}" subsection.`);
    return value;
  };
  return { version, newAndImproved: text(NEW), fixes: text(FIXES) };
}

export type ReleaseAsset = Readonly<{ name: string; sha256: string; bytes: number }>;
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Parse `SHA256SUMS.txt` (`<hex>  <name>` lines, the `sha256sum` format). */
export function parseChecksums(text: string): { name: string; sha256: string }[] {
  return text.replace(/\r\n/g, "\n").split("\n").filter(Boolean).map(line => {
    const match = /^([0-9a-f]{64}) [ *]([A-Za-z0-9._+-]+)$/.exec(line);
    if (!match) throw Error(`Malformed checksum line: ${line}`);
    return { sha256: match[1], name: match[2] };
  });
}

/** Release body: the curated changelog section first, then verification and SmartScreen guidance. */
export function releaseNotes(section: ChangelogSection, version: ReleaseVersion, assets: readonly ReleaseAsset[]): string {
  const tag = releaseTag(version);
  const setup = setupAssetName(version);
  if (!assets.some(asset => asset.name === setup)) throw Error(`Release assets do not include ${setup}.`);
  const rows = assets.map(asset => `| \`${asset.name}\` | \`${asset.sha256}\` |`).join("\n");
  const warning = isPrerelease(version)
    ? `> **This is an ${version.stage === "rc" ? "release candidate" : version.stage} pre-release for testing.** It is unsigned, ` +
      "has no automatic updates, and the mod files it builds have not been tested in the game. Keep backups of anything you make."
    : "> This build is unsigned and has no automatic updates.";
  return [
    `## ${NEW}`, "", section.newAndImproved, "",
    `## ${FIXES}`, "", section.fixes, "",
    "---", "",
    warning, "",
    "## Install", "",
    `1. Download \`${setup}\` and check its SHA-256 (below) before running anything.`,
    "2. Extract the whole ZIP (the setup program needs its hidden `.installer` folder) and run `XF Studio-Setup-canary.exe`.",
    "3. The installer is not code-signed yet, so Windows SmartScreen may show **Windows protected your PC**. " +
      "Only if the checksum matched, choose **More info → Run anyway**. If Smart App Control is on, Windows blocks unsigned apps and offers no per-app override.",
    "4. XF Studio needs the Microsoft Edge WebView2 Runtime, which most Windows 10 and 11 PCs already have. " +
      "If it's missing, the app tells you and opens Microsoft's download page.", "",
    "5. It installs for your Windows user only and includes no game or mod files. The UV editor, your library and Check work straight away. " +
      "The 3D head preview isn't available in this alpha, and building the mod files still needs a developer setup.", "",
    "## Licence", "",
    `XF Studio is MIT-licensed ([LICENSE](https://github.com/${repository}/blob/${tag}/LICENSE)). ` +
      `The app includes third-party software; its notices are attached as \`${noticesAssetName}\` and shown under **About → Licences**.`, "",
    "## Verify your download", "",
    "| File | SHA-256 |", "|---|---|", rows, "",
    "In PowerShell: `(Get-FileHash .\\" + setup + " -Algorithm SHA256).Hash.ToLower()` must equal the value above " +
      "(the same list is attached as `SHA256SUMS.txt`).", "",
    `Each file also has a GitHub build-provenance attestation linking it to the workflow run and commit that built it: ` +
      `\`gh attestation verify ${setup} --repo ${repository}\`.`, "",
    `Full commit list: https://github.com/${repository}/commits/${tag}`, "",
  ].join("\n");
}

type StageInput = { setupZip?: string; updateJson?: string; outDir: string; commit: string; version?: ReleaseVersion;
  dependencyLock?: string; notices?: string; licence?: string };
/** Copy the verified setup ZIP under its release name and write checksums plus asset-free build information. */
export function stageRelease(input: StageInput): ReleaseAsset[] {
  const version = input.version ?? appVersion();
  const setupZip = input.setupZip ?? canarySetupZip;
  const update = JSON.parse(readFileSync(input.updateJson ?? canaryUpdateJson, "utf8"));
  if (update.version !== version.version || update.channel !== electrobunChannel)
    throw Error("The built update metadata does not match the app version and canary channel.");
  if (!/^[0-9a-f]{40}$/.test(input.commit)) throw Error("A full commit SHA is required for build information.");
  requireLicence(input.licence);
  rmSync(input.outDir, { recursive: true, force: true });
  mkdirSync(input.outDir, { recursive: true });
  const setupName = setupAssetName(version);
  copyFileSync(setupZip, resolve(input.outDir, setupName));
  copyFileSync(input.notices ?? noticesPath, resolve(input.outDir, noticesAssetName));
  const lockPath = input.dependencyLock ?? resolve(desktopRoot, ".hutch", "dependencies.lock");
  const toolchain = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")).objects : null;
  const info = {
    schema: "xfs/desktop-build-info-1", app: "XF Studio", identifier: update.identifier,
    version: version.version, tag: releaseTag(version), prerelease: isPrerelease(version),
    electrobunChannel, electrobunBuildHash: update.hash, commit: input.commit, repository,
    signed: false, updater: "disabled", includesGameAssets: false, toolchain,
  };
  writeFileSync(resolve(input.outDir, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
  const assets = [setupName, "build-info.json", noticesAssetName].map(name => {
    const path = resolve(input.outDir, name);
    return { name, sha256: sha256(path), bytes: statSync(path).size };
  });
  writeFileSync(resolve(input.outDir, "SHA256SUMS.txt"), assets.map(asset => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
  return assets;
}

/** Re-read staged files and prove they still match SHA256SUMS.txt (used again after artifact transfer). */
export function verifyStaged(dir: string): ReleaseAsset[] {
  return parseChecksums(readFileSync(resolve(dir, "SHA256SUMS.txt"), "utf8")).map(entry => {
    const path = resolve(dir, entry.name);
    if (sha256(path) !== entry.sha256) throw Error(`Checksum mismatch for ${entry.name}.`);
    return { ...entry, bytes: statSync(path).size };
  });
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const version = appVersion();
  if (command === "metadata") {
    // --ref refs/tags/vX: enforce tag/version agreement and a complete changelog section.
    const ref = option(args, "--ref") ?? "";
    const tag = ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : null;
    if (tag) {
      requireLicence();
      checkTag(tag, version);
      changelogSection(readFileSync(changelogPath, "utf8"), version.version);
    }
    const lines = [`version=${version.version}`, `tag=${releaseTag(version)}`, `title=${releaseTitle(version)}`,
      `prerelease=${isPrerelease(version)}`, `setup=${setupAssetName(version)}`, `release=${tag ? "true" : "false"}`];
    console.log(lines.join("\n"));
  } else if (command === "stage") {
    const outDir = resolve(option(args, "--out") ?? resolve(desktopRoot, "artifacts", "release"));
    const assets = stageRelease({ outDir, commit: option(args, "--commit") ?? "" });
    for (const asset of assets) console.log(`${asset.sha256}  ${asset.name} (${asset.bytes} bytes)`);
  } else if (command === "notes") {
    const dir = resolve(option(args, "--assets") ?? resolve(desktopRoot, "artifacts", "release"));
    const out = option(args, "--out");
    requireLicence();
    const section = changelogSection(readFileSync(changelogPath, "utf8"), version.version);
    const notes = releaseNotes(section, version, verifyStaged(dir));
    if (out) writeFileSync(out, notes); else console.log(notes);
  } else {
    console.error("Usage: bun release.ts metadata [--ref <git ref>] | stage --commit <sha> [--out <dir>] | notes [--assets <dir>] [--out <file>]");
    process.exit(2);
  }
}
