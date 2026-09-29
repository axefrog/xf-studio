import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * Storage adapter for assets XF Studio derives from the player's own game files. A cache
 * lives in host-owned private storage (never the repository, the game folder or a mod
 * manager); each derivation is staged in a private work directory and published
 * atomically into an entry directory named by its cache identity.
 */
export function fileSha256(path: string): string {
  const digest = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), handle = openSync(path, "r");
  try { let count: number; while ((count = readSync(handle, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count)); }
  finally { closeSync(handle); }
  return digest.digest("hex");
}

/** Cheap identity of the game's content archives, so a stale result clears after a game update or repair. */
export function contentFingerprint(gameRoot: string, archiveDirectory: string): string {
  const directory = resolve(gameRoot, archiveDirectory);
  let entries: string[] = [];
  try {
    entries = readdirSync(directory).filter(name => name.toLowerCase().endsWith(".archive")).sort().map(name => {
      const stat = statSync(join(directory, name));
      return `${name}|${stat.size}|${Math.trunc(stat.mtimeMs)}`;
    });
  } catch { entries = ["unavailable"]; }
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

/** Write through a unique temporary sibling and rename, so a reader never sees a half-written cache file. */
export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const staging = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try { writeFileSync(staging, data); renameSync(staging, path); }
  catch (error) { rmSync(staging, { force: true }); throw error; }
}

/** One small text file the host keeps (e.g. the update check's memory): read whole, null while it doesn't exist, and written atomically. */
export function textFileAt(path: string): { read(): string | null; write(text: string): void } {
  return { read: () => existsSync(path) ? readFileSync(path, "utf8") : null,
    write: text => { mkdirSync(dirname(path), { recursive: true }); writeFileAtomic(path, text); } };
}

export const samePath = (left: string, right: string) => process.platform === "win32"
  ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);

export class DerivedCache {
  readonly root: string;
  constructor(root: string, protected readonly label = "derived asset") {
    if (!isAbsolute(root)) throw Error(`The ${label} cache directory must be absolute.`);
    this.root = resolve(root);
  }
  protected get statusFile() { return join(this.root, "status.json"); }
  private guard(path: string) {
    for (let current = resolve(path); ; current = dirname(current)) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error(`The ${this.label} cache uses a linked path.`);
      if (current === this.root || dirname(current) === current) break;
    }
  }
  ensure(): void { mkdirSync(this.root, { recursive: true, mode: 0o700 }); this.guard(this.root); }
  createWork(): string {
    this.ensure();
    const work = join(this.root, `.work-${randomUUID()}`);
    mkdirSync(work, { mode: 0o700 });
    return work;
  }
  remove(path: string): void {
    const target = resolve(path);
    if (!target.startsWith(this.root + sep)) throw Error(`Refusing to remove outside the ${this.label} cache.`);
    rmSync(target, { recursive: true, force: true });
  }
  entry(name: string): string { return join(this.root, name); }
  /** Rename a finished staging directory into place; an existing entry wins a concurrent race. */
  publish(staging: string, name: string): string {
    const target = this.entry(name);
    this.guard(target);
    if (existsSync(target)) this.remove(target);
    renameSync(staging, target);
    return target;
  }
  readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")); }
  writeJson(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); }
  /** Replace the cache's advisory status document atomically. */
  protected writeStatusDocument(value: unknown): void {
    this.ensure();
    const temporary = `${this.statusFile}.${randomUUID()}.tmp`;
    this.writeJson(temporary, value);
    renameSync(temporary, this.statusFile);
  }
  protected readStatusDocument(): unknown {
    try { return this.readJson(this.statusFile); } catch { return null; }
  }
}

/**
 * Conversions kept beside a cache entry (PIPE-130): a converter's JSON of the entry's resources (the eye plate's WolvenKit
 * JSON), so a Build reads them without starting the converter. One folder per converter identity (`keptJsonDirectory`),
 * published by renaming a finished staging folder into place. Its record binds each document to the SHA-256 of the
 * resource bytes it was converted from and to its own SHA-256 and length, so a changed resource, another converter or a
 * damaged document is never read; a reader then converts the resource itself.
 */
export const KEPT_JSON_SCHEMA = "xfs/kept-json-1" as const;
const KEPT_JSON_RECORD = "kept-json.json";
export type KeptJsonRecord = {
  readonly schema: typeof KEPT_JSON_SCHEMA;
  /** The converter that wrote them (`wolvenKitIdentityKey`). */
  readonly converter: string;
  readonly files: readonly { readonly name: string; readonly sha256: string; readonly json: string; readonly jsonSha256: string;
    readonly jsonBytes: number }[];
};
let keptStaging = 0;

/** The folder a cache entry keeps this converter's JSON in. */
export const keptJsonDirectory = (entry: string, converter: string) =>
  join(entry, `json-${createHash("sha256").update(converter).digest("hex").slice(0, 16)}`);

/**
 * The kept JSON documents for these resources, by resource file name, or null unless the record names exactly these
 * resources (by name and SHA-256) converted by this converter and every document still has its recorded length and (with
 * `hashJson`, the default) SHA-256. `hashes` may give the resources' known SHA-256 so nothing is hashed twice. A host
 * passes `hashJson: false` (it must not hash tens of megabytes on its event loop); the builder, which reads them, hashes.
 */
export function readKeptJson(directory: string, converter: string, resources: readonly string[],
  hashes: Readonly<Record<string, string>> = {}, hashJson = true): Record<string, string> | null {
  try {
    const record = JSON.parse(readFileSync(join(directory, KEPT_JSON_RECORD), "utf8")) as KeptJsonRecord;
    if (record?.schema !== KEPT_JSON_SCHEMA || record.converter !== converter || !Array.isArray(record.files) ||
        record.files.length !== resources.length) return null;
    const found: Record<string, string> = {};
    for (const resource of resources) {
      const name = basename(resource), entry = record.files.find(file => file.name === name);
      if (!entry || entry.json !== `${name}.json` || (hashes[resource] ?? fileSha256(resource)) !== entry.sha256) return null;
      const json = join(directory, entry.json);
      if (!statSync(json).isFile() || statSync(json).size !== entry.jsonBytes || (hashJson && fileSha256(json) !== entry.jsonSha256)) return null;
      found[name] = json;
    }
    return found;
  } catch { return null; }
}

/**
 * Keep JSON documents for resources: `converted` maps each resource path to the JSON the converter wrote for exactly those
 * bytes. Copies them into a staging folder beside `directory`, writes the record and renames it into place (replacing a
 * folder that no longer reads). Returns the folder.
 */
export function publishKeptJson(directory: string, converter: string, converted: ReadonlyMap<string, string>,
  hashes: Readonly<Record<string, string>> = {}): string {
  const staging = join(dirname(directory), `.${basename(directory)}-${process.pid}-${++keptStaging}.tmp`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    const files = [...converted].map(([resource, json]) => {
      const name = basename(resource), target = join(staging, `${name}.json`);
      copyFileSync(json, target);
      return { name, sha256: hashes[resource] ?? fileSha256(resource), json: `${name}.json`, jsonSha256: fileSha256(target),
        jsonBytes: statSync(target).size };
    });
    const record: KeptJsonRecord = { schema: KEPT_JSON_SCHEMA, converter, files };
    writeFileSync(join(staging, KEPT_JSON_RECORD), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    try { renameSync(staging, directory); }
    catch (error) { if (!existsSync(join(directory, KEPT_JSON_RECORD))) throw error; } // Another writer published first.
    return directory;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
