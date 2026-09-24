import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import config from "./electrobun.config";

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

function tar(args: string[]): string {
  const result = spawnSync("tar", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
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
  "build/studio-main.js", "build/raster-worker.js"], "Packaged Studio view");
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
console.log(`Verified private Windows setup: ${installer}`);
console.log(`${config.app.version} ${channel} build ${update.hash}; setup SHA-256 ${digest}`);
console.log("Seven allowlisted Studio view files; no bundled private preview assets or update feed.");
