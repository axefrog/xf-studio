import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import config from "./electrobun.config";
import { WEBVIEW2_BOOTSTRAPPER, verifyMicrosoftSignature, webView2Folder } from "./prepare-webview2";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { builtVersions, licencePath, noticeIssues, noticesPath, packagedLicence, packagedNotices } from "./notices";
import { BUILD_TOOLS_SCHEMA, builderEntry } from "./build";

// A private packaging gate. The checked files are the actual installer/update
// artifacts, not the source `static` tree that Electrobun consumes.
const root = import.meta.dir;
const channel = "canary";
const platform = "win-x64";
const compactName = config.app.name.replaceAll(" ", "");
const bundle = `${compactName}-${channel}`;
const prefix = `${channel}-${platform}-`;
const artifactDir = resolve(root, "artifacts");
const archive = resolve(artifactDir, `${prefix}${bundle}.tar.zst`);
const installer = resolve(artifactDir, `${prefix}${compactName}-Setup-${channel}.zip`);
const updateFile = resolve(artifactDir, `${prefix}update.json`);

function requireFile(path: string) {
  if (!existsSync(path) || !statSync(path).isFile()) throw Error(`Missing packaging artifact: ${path}`);
}

// Windows' bundled bsdtar reads .tar.zst and .zip; a GNU tar earlier on PATH (e.g. Git's
// usr/bin on CI runners) cannot, so prefer the system copy explicitly.
const systemTar = process.platform === "win32" && process.env.SystemRoot ?
  resolve(process.env.SystemRoot, "System32", "tar.exe") : "";
const tarCommand = systemTar && existsSync(systemTar) ? systemTar : "tar";

function tar(args: string[]): string {
  const result = spawnSync(tarCommand, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`Cannot inspect archive: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function tarBytes(args: string[]): Buffer {
  const result = spawnSync(tarCommand, args, { maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(`Cannot inspect archive: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function sameMembers(actual: string[], expected: string[], label: string) {
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort()))
    throw Error(`${label} members differ: ${actual.join(", ")}`);
}

for (const file of [archive, installer, updateFile]) requireFile(file);
const update = JSON.parse(readFileSync(updateFile, "utf8"));
if (update.schemaVersion !== 1 || update.identifier !== config.app.identifier ||
  update.version !== config.app.version || update.channel !== channel ||
  update.platform !== "win" || update.arch !== "x64" ||
  update.artifact?.file !== `${prefix}${bundle}.tar.zst` ||
  typeof update.hash !== "string" || !/^[a-z0-9]{8,64}$/.test(update.hash))
  throw Error("Canary update metadata does not match the pinned app identity and artifact.");

const members = tar(["-tf", archive]).trim().split(/\r?\n/);
const views = `${bundle}/Resources/app/views/studio/`;
const viewFiles = members.filter(name => name.startsWith(views) && !name.endsWith("/"))
  .map(name => name.slice(views.length));
sameMembers(viewFiles, ["index.html", "studio.css", "about.css", "desktop-bootstrap.js", "check-worker.js",
  "build/studio-main.js", "build/raster-worker.js", "boot-watchdog.js", packagedNotices, packagedLicence], "Packaged Studio view");
// The installed app must carry the current licence and notices, and the notices
// must name every shipped program and the versions actually built in.
for (const [name, source] of [[packagedNotices, noticesPath], [packagedLicence, licencePath]] as const)
  if (!tarBytes(["-xOf", archive, views + name]).equals(readFileSync(source)))
    throw Error(`Packaged ${name} differs from ${source}.`);
const binaries = members.filter(name => name.startsWith(`${bundle}/bin/`) && !name.endsWith("/"))
  .map(name => name.slice(`${bundle}/bin/`.length));
const issues = noticeIssues(readFileSync(noticesPath, "utf8"), { binaries, ...builtVersions() });
if (issues.length) throw Error(`THIRD_PARTY_NOTICES.md is out of date:\n${issues.join("\n")}`);
const toolPrefix = `${bundle}/Resources/app/build-tools/`;
const toolFiles = members.filter(name => name.startsWith(toolPrefix) && !name.endsWith("/"))
  .map(name => name.slice(toolPrefix.length));
sameMembers(toolFiles, ["manifest.json", builderEntry], "Packaged build tools");
const toolManifest = JSON.parse(tar(["-xOf", archive, toolPrefix + "manifest.json"]));
if (toolManifest.schema !== BUILD_TOOLS_SCHEMA ||
    JSON.stringify(Object.keys(toolManifest.files).sort()) !== JSON.stringify(toolFiles.filter(name => name !== "manifest.json").sort()))
  throw Error("Packaged build tool manifest is incomplete.");
for (const name of toolFiles.filter(name => name !== "manifest.json")) {
  if (createHash("sha256").update(tarBytes(["-xOf", archive, toolPrefix + name])).digest("hex") !== toolManifest.files[name])
    throw Error(`Packaged build tool changed: ${name}`);
}
// Exactly one extra resource: Microsoft's WebView2 bootstrapper, unmodified and Microsoft-signed.
const extraPrefix = `${bundle}/Resources/app/webview2/`;
sameMembers(members.filter(name => name.startsWith(extraPrefix) && !name.endsWith("/")).map(name => name.slice(extraPrefix.length)),
  [WEBVIEW2_BOOTSTRAPPER], "Packaged WebView2 bootstrapper");
const packagedBootstrapper = tarBytes(["-xOf", archive, extraPrefix + WEBVIEW2_BOOTSTRAPPER]);
if (!packagedBootstrapper.equals(readFileSync(resolve(webView2Folder, WEBVIEW2_BOOTSTRAPPER))))
  throw Error("Packaged WebView2 bootstrapper differs from the verified download.");
const scratch = mkdtempSync(resolve(tmpdir(), "xfs-webview2-check-"));
try { writeFileSync(resolve(scratch, WEBVIEW2_BOOTSTRAPPER), packagedBootstrapper); verifyMicrosoftSignature(resolve(scratch, WEBVIEW2_BOOTSTRAPPER)); }
finally { rmSync(scratch, { recursive: true, force: true }); }
if (members.some(name => /(?:^|\/)(?:assets|preview-assets|data)(?:\/|$)|\.sqlite(?:-wal|-shm)?$|\.(?:glb|blend|sav)$/i.test(name)))
  throw Error("Canary bundle contains a private asset or data path.");

const packagedVersion = JSON.parse(tar(["-xOf", archive, `${bundle}/Resources/version.json`]));
if (packagedVersion.identifier !== config.app.identifier || packagedVersion.version !== config.app.version ||
  packagedVersion.channel !== channel || packagedVersion.hash !== update.hash || packagedVersion.baseUrl !== "")
  throw Error("Packaged local version differs from the canary metadata or unexpectedly enables an update feed.");

const setupMembers = tar(["-tf", installer]).trim().split(/\r?\n/);
sameMembers(setupMembers, [
  `${config.app.name}-Setup-${channel}.exe`,
  `.installer/${config.app.name}-Setup-${channel}.metadata.json`,
  `.installer/${config.app.name}-Setup-${channel}.tar.zst`,
], "Windows setup ZIP");

const digest = createHash("sha256").update(readFileSync(installer)).digest("hex");
console.log(`Verified unsigned Windows setup: ${installer.slice(root.length + 1)}`);
console.log(`${config.app.version} ${channel} build ${update.hash}; setup SHA-256 ${digest}`);
console.log("Ten allowlisted Studio view files (licence and third-party notices included), current notices, Microsoft's signed WebView2 bootstrapper, and one hashed asset-free build tool; no private preview assets or update feed.");
