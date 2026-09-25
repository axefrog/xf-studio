import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

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
