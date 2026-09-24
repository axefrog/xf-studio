import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { EyePlateRecipe } from "./eye-plate-recipe";

/**
 * Storage adapter for derived eye plates. The cache lives in host-owned private storage
 * (never the repository, the game folder or a mod manager). Each derivation is published
 * atomically into a directory named by recipe revision and cache key.
 */
export const EYE_PLATE_STATUS_SCHEMA = "xfs/eye-plate-status-1" as const;
export type EyePlateStatusState = "ready" | "missing" | "unsupported" | "failed";
export type EyePlateStatus = {
  schema: typeof EYE_PLATE_STATUS_SCHEMA;
  recipeId: string; recipeRevision: number;
  state: EyePlateStatusState; code: string | null; message: string;
  gameRoot: string; contentFingerprint: string; cacheName: string | null; updatedAt: string;
};

export function fileSha256(path: string): string {
  const digest = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024), handle = openSync(path, "r");
  try { let count: number; while ((count = readSync(handle, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count)); }
  finally { closeSync(handle); }
  return digest.digest("hex");
}

/** Cheap identity of the game's content archives, so a stale failure clears after a game update or repair. */
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

const samePath = (left: string, right: string) => process.platform === "win32"
  ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);

export class EyePlateCache {
  readonly root: string;
  constructor(root: string) {
    if (!isAbsolute(root)) throw Error("Eye plate cache directory must be absolute.");
    this.root = resolve(root);
  }
  private get statusFile() { return join(this.root, "status.json"); }
  private guard(path: string) {
    for (let current = resolve(path); ; current = dirname(current)) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error("Eye plate cache uses a linked path.");
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
    if (!target.startsWith(this.root + sep)) throw Error("Refusing to remove outside the eye plate cache.");
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
  writeStatus(status: Omit<EyePlateStatus, "schema" | "updatedAt">): void {
    this.ensure();
    const temporary = `${this.statusFile}.${randomUUID()}.tmp`;
    this.writeJson(temporary, { schema: EYE_PLATE_STATUS_SCHEMA, ...status, updatedAt: new Date().toISOString() });
    renameSync(temporary, this.statusFile);
  }
  readStatus(): EyePlateStatus | null {
    try {
      const status = this.readJson(this.statusFile) as EyePlateStatus;
      return status?.schema === EYE_PLATE_STATUS_SCHEMA ? status : null;
    } catch { return null; }
  }
}

export type EyePlateReadiness = { issue: { code: string; reason: string } | null; limit: string };
/**
 * Advisory Build readiness from the last recorded derivation. A missing or unsupported head
 * only blocks while the same game folder's content archives are unchanged, so repairing or
 * updating the game (or XF Studio's recipe) lets the next Build try again.
 */
export function eyePlateReadiness(cacheRoot: string | null, gameRoot: string | null, recipe: EyePlateRecipe): EyePlateReadiness {
  const labels = recipe.source.supported.map(item => item.label).join(", ");
  const limit = `The expanded eye plate is built from your installed game on first Build (supports ${labels}) and cached privately.`;
  if (!cacheRoot || !gameRoot) return { issue: null, limit };
  let status: EyePlateStatus | null = null;
  try { status = new EyePlateCache(cacheRoot).readStatus(); } catch { return { issue: null, limit }; }
  if (!status || status.recipeId !== recipe.id || status.recipeRevision !== recipe.revision || !samePath(status.gameRoot, gameRoot) ||
      (status.state !== "missing" && status.state !== "unsupported") ||
      status.contentFingerprint !== contentFingerprint(gameRoot, recipe.source.archiveDirectory))
    return { issue: null, limit };
  return { issue: { code: status.state === "missing" ? "plate_source_missing" : "plate_source_unsupported", reason: status.message }, limit };
}
