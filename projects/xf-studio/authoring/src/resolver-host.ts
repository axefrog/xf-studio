/**
 * Host adapter for the character resolver: finds the mounted archives and `.xl` files of a launch route,
 * reads RDAR indexes, and extracts resources to JSON with WolvenKit CLI into an ignored cache
 * (default `authoring/data/resolver-cache/`). All filesystem and process access lives here; the domain
 * modules (archive-precedence, archivexl-config, cco-model, resource-graph, character-resolver) are pure.
 *
 * Read-only towards the game and MO2: archives are opened for reading and WolvenKit writes only into the
 * cache directory. Cache entries are keyed by (depot hash, archive path+size+mtime fingerprint) and store
 * the serialized JSON with base64 buffers trimmed, plus the SHA-256 of the extracted resource bytes.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type ArchiveFile, buildMountPlan, DepotIndex, type MountedArchive, type MountPlan } from "./archive-precedence";
import { type ArchiveXlConfig, readArchiveXlConfig, type XlDocument } from "./archivexl-config";
import { depotHash, type DepotRef } from "./depot-path";
import { defaultLocalSettings, type LocalSettings } from "./local-settings";
import { parseRdarHeader, parseRdarIndexHashes, RDAR_HEADER_BYTES } from "./rdar-index";
import { type FetchedResource, type ResourceFetchPort, ResourceGraph } from "./resource-graph";
import { discoverSources, type SourceCandidate } from "./source-discovery";

export interface InstallationOptions {
  readonly gameRoot: string;
  readonly launchRoute: "direct" | "mo2";
  readonly mo2Root?: string | null;
  readonly mo2ProfileId?: string | null;
  readonly manualModRoot?: string | null;
  readonly wolvenKitCli: string;
  readonly cacheDir: string;
  readonly log?: (message: string) => void;
}

export interface Installation {
  readonly plan: MountPlan;
  readonly depot: DepotIndex;
  readonly xl: ArchiveXlConfig;
  readonly graph: ResourceGraph;
  readonly fetcher: WolvenKitFetcher;
  readonly summary: {
    readonly route: "direct" | "mo2";
    readonly scanComplete: boolean;
    readonly scanIssues: readonly string[];
    /** Blocking scan issues that may hide an archive, `.xl` or modlist file (see SourceIssue.mayHideSources). */
    readonly scanGaps: readonly string[];
    readonly mountedArchives: number;
    readonly unmountedArchives: number;
    readonly indexErrors: readonly string[];
    /** Mounted archives whose RDAR index could not be read, with their lookup rank (0 is searched first). */
    readonly unreadIndexes: readonly UnreadIndex[];
    readonly xlFiles: number;
    readonly xlIssues: readonly string[];
    readonly ep1Installed: boolean;
    readonly modOrder: MountPlan["modOrder"];
  };
}

export interface UnreadIndex { readonly id: string; readonly name: string; readonly providerName: string; readonly rank: number; readonly error: string }

const lower = (value: string) => value.toLowerCase();
const XL_LOCATIONS = [/^red4ext\/plugins\/archivexl\/bundle\/.+\.xl$/, /^archive\/pc\/mod\/.+\.xl$/];

/** The game-folder ArchiveXL bundle is outside source discovery's `archive/pc` scan. */
function gameBundleFiles(gameRoot: string): SourceCandidate[] {
  const bundle = join(gameRoot, "red4ext", "plugins", "ArchiveXL", "Bundle");
  if (!existsSync(bundle) || lstatSync(bundle).isSymbolicLink()) return [];
  const now = new Date().toISOString();
  return readdirSync(bundle).filter(name => /\.(archive|xl)$/i.test(name)).map(name => {
    const physicalPath = join(bundle, name), stat = statSync(physicalPath);
    return { id: `game:bundle:${lower(name)}`, provider: "game", providerName: "Installed game", route: "direct", profileId: null,
      virtualPath: `red4ext/plugins/ArchiveXL/Bundle/${name}`, physicalPath, kind: /\.xl$/i.test(name) ? "archive-xl" : "archive",
      active: true, priority: null, priorityEvidence: null, sizeBytes: stat.size, modifiedMs: stat.mtimeMs, sha256: null,
      discoveredAt: now, limitations: [] } satisfies SourceCandidate;
  });
}

const toArchiveFile = (candidate: SourceCandidate): ArchiveFile => ({ id: candidate.physicalPath, virtualPath: candidate.virtualPath,
  provider: candidate.provider, providerName: candidate.providerName, active: candidate.active, priority: candidate.priority });

/** Visible winner of each loose virtual file (same VFS rule as archives). */
function visibleLoose(candidates: readonly SourceCandidate[]): SourceCandidate[] {
  const byPath = new Map<string, SourceCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.active) continue;
    const key = lower(candidate.virtualPath);
    byPath.set(key, [...(byPath.get(key) ?? []), candidate]);
  }
  return [...byPath.values()].map(copies => {
    const mo2 = copies.filter(c => c.provider.startsWith("mo2-")).sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
    return mo2[0] ?? copies[0]!;
  });
}

function fingerprint(path: string): string {
  const stat = statSync(path);
  return createHash("sha256").update(`${path}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 24);
}

function readIndex(path: string, cacheDir: string): BigUint64Array {
  const key = join(cacheDir, "index", `${fingerprint(path)}.u64`);
  if (existsSync(key)) { const bytes = readFileSync(key); return new BigUint64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
  const fd = openSync(path, "r");
  try {
    const header = new Uint8Array(RDAR_HEADER_BYTES);
    readSync(fd, header, 0, RDAR_HEADER_BYTES, 0);
    const { indexOffset, indexSize } = parseRdarHeader(header);
    if (indexOffset + indexSize > statSync(path).size) throw Error("RDAR index lies outside the file.");
    const index = new Uint8Array(indexSize);
    readSync(fd, index, 0, indexSize, indexOffset);
    const hashes = parseRdarIndexHashes(index);
    mkdirSync(join(cacheDir, "index"), { recursive: true });
    writeFileSync(key, new Uint8Array(hashes.buffer));
    return hashes;
  } finally { closeSync(fd); }
}

/** Replace base64 payloads with their length so cached JSON stays small; nothing else is altered. */
export function trimBuffers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimBuffers);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = key === "Bytes" && typeof item === "string" ? { $trimmedBase64Length: item.length } : trimBuffers(item);
  return out;
}

interface Pending { ref: DepotRef; extension: string | null; waiters: ((value: FetchedResource | null) => void)[] }

/** Batched WolvenKit CLI extraction with a persistent JSON cache. */
export class WolvenKitFetcher implements ResourceFetchPort {
  private readonly pending = new Map<string, { archive: MountedArchive; items: Map<string, Pending> }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();
  private batch = 0;
  readonly stats = { cacheHits: 0, extracted: 0, cliCalls: 0, failures: [] as string[] };

  constructor(private readonly cli: string, private readonly cacheDir: string, private readonly contains: (archiveId: string, hash: string) => boolean,
    private readonly log: (message: string) => void = () => {}) {}

  private cachePath(archive: MountedArchive, hash: string) { return join(this.cacheDir, "json", `${hash}-${fingerprint(archive.id)}.json`); }

  fetch(archive: MountedArchive, ref: DepotRef, extension: string | null): Promise<FetchedResource | null> {
    const cached = this.cachePath(archive, ref.hash);
    // A resource WolvenKit could not convert stays failed until its container changes (the key includes it).
    if (existsSync(`${cached}.failed`)) { this.stats.cacheHits++; return Promise.resolve(null); }
    if (existsSync(cached)) {
      this.stats.cacheHits++;
      const entry = JSON.parse(readFileSync(cached, "utf8"));
      return Promise.resolve({ document: entry.document, extractedSha256: entry.meta.extractedSha256, path: entry.meta.path });
    }
    return new Promise(resolve => {
      const queue = this.pending.get(archive.id) ?? { archive, items: new Map<string, Pending>() };
      const item = queue.items.get(ref.hash) ?? { ref, extension, waiters: [] };
      item.waiters.push(resolve);
      queue.items.set(ref.hash, item);
      this.pending.set(archive.id, queue);
      if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.running = this.running.then(() => this.flush()); }, 30);
    });
  }

  private async run(args: string[]): Promise<string> {
    this.stats.cliCalls++;
    const child = Bun.spawn([this.cli, ...args], { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited;
    return out + err;
  }

  private async flush(): Promise<void> {
    const queues = [...this.pending.values()];
    this.pending.clear();
    if (!queues.length) return;
    // Archives in one CLI call must not both contain a requested hash, or outputs would collide.
    const batches: (typeof queues)[] = [];
    for (const queue of queues) {
      const fits = batches.find(batch => batch.every(other =>
        ![...queue.items.keys()].some(hash => this.contains(other.archive.id, hash)) &&
        ![...other.items.keys()].some(hash => this.contains(queue.archive.id, hash))));
      if (fits) fits.push(queue); else batches.push([queue]);
    }
    for (const batch of batches) await this.extract(batch);
    if (this.pending.size) await this.flush();
  }

  private async extract(batch: { archive: MountedArchive; items: Map<string, Pending> }[]): Promise<void> {
    const dir = join(this.cacheDir, "tmp", `batch-${process.pid}-${++this.batch}`);
    const raw = join(dir, "raw");
    mkdirSync(raw, { recursive: true });
    const hashes = [...new Set(batch.flatMap(queue => [...queue.items.keys()]))];
    writeFileSync(join(dir, "hashes.txt"), hashes.join("\n") + "\n");
    this.log(`WolvenKit: extracting ${hashes.length} resource(s) from ${batch.length} archive(s)`);
    try {
      await this.run(["unbundle", ...batch.map(queue => queue.archive.id), "-o", raw, "--hash", join(dir, "hashes.txt")]);
      const found = new Map<string, { file: string; path: string | null }>();
      const walk = (folder: string) => {
        for (const name of readdirSync(folder)) {
          const full = join(folder, name);
          if (lstatSync(full).isDirectory()) { walk(full); continue; }
          if (name.endsWith(".json")) continue;
          const rel = relative(raw, full).split(sep).join("\\");
          const numeric = /^(\d+)\.[^.\\]+$/.exec(rel);
          if (numeric) found.set(BigInt(numeric[1]!).toString(), { file: full, path: null });
          else found.set(depotHash(rel), { file: full, path: rel });
        }
      };
      walk(raw);
      // Unnamed outputs get the expected extension so WolvenKit's converter recognises them.
      for (const queue of batch) for (const [hash, item] of queue.items) {
        const hit = found.get(hash);
        if (hit && !hit.path && item.extension && !hit.file.endsWith(`.${item.extension}`)) {
          const renamed = `${hit.file.replace(/\.[^.\\/]+$/, "")}.${item.extension}`;
          renameSync(hit.file, renamed); hit.file = renamed;
        }
      }
      if (found.size) await this.run(["convert", "s", raw]);
      mkdirSync(join(this.cacheDir, "json"), { recursive: true });
      for (const queue of batch) for (const [hash, item] of queue.items) {
        const hit = found.get(hash);
        let result: FetchedResource | null = null;
        let document: unknown = null;
        try { if (hit && existsSync(`${hit.file}.json`)) document = trimBuffers(JSON.parse(readFileSync(`${hit.file}.json`, "utf8"))); }
        catch (error) { this.stats.failures.push(`${queue.archive.name}: ${item.ref.path ?? hash}: ${(error as Error).message}`); }
        if (hit && document) {
          const bytes = readFileSync(hit.file);
          const extractedSha256 = createHash("sha256").update(bytes).digest("hex");
          const path = hit.path ?? item.ref.path;
          writeFileSync(this.cachePath(queue.archive, hash), JSON.stringify({ meta: { hash, path, archive: queue.archive.name,
            group: queue.archive.group, extractedSha256, bytes: bytes.length, cachedAt: new Date().toISOString() }, document }));
          result = { document, extractedSha256, path };
          this.stats.extracted++;
        } else if (!document) {
          this.stats.failures.push(`${queue.archive.name}: ${item.ref.path ?? hash} was not extracted or converted.`);
          if (hit) writeFileSync(`${this.cachePath(queue.archive, hash)}.failed`, JSON.stringify({ hash, path: hit.path ?? item.ref.path,
            archive: queue.archive.name, reason: "WolvenKit extracted the resource but produced no readable JSON.", at: new Date().toISOString() }));
        }
        for (const waiter of item.waiters) waiter(result);
      }
    } catch (error) {
      for (const queue of batch) for (const item of queue.items.values()) for (const waiter of item.waiters) waiter(null);
      this.stats.failures.push(String(error));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

/** Discover the route's sources, mount archives, read indexes and `.xl` files, and open a resource graph. */
export function openInstallation(options: InstallationOptions): Installation {
  const log = options.log ?? (() => {});
  const settings: LocalSettings = { ...defaultLocalSettings(), gameRoot: options.gameRoot, launchRoute: options.launchRoute,
    mo2Root: options.mo2Root ?? null, mo2ProfileId: options.mo2ProfileId ?? null, manualModRoot: options.manualModRoot ?? null };
  const discovery = discoverSources(settings, { maxEntries: 1_000_000, maxDepth: 24 });
  const candidates = [...discovery.candidates, ...gameBundleFiles(options.gameRoot)];
  const archives = candidates.filter(c => c.kind === "archive").map(toArchiveFile);
  const modlist = visibleLoose(candidates.filter(c => c.kind === "archive-modlist"))[0];
  const plan = buildMountPlan(archives, modlist ? readFileSync(modlist.physicalPath, "utf8") : null);
  log(`Mounted ${plan.archives.length} archives (${plan.unmounted.length} not mounted); reading indexes`);
  const indexes = new Map<string, BigUint64Array>();
  const indexErrors: string[] = [], unreadIndexes: UnreadIndex[] = [];
  for (const archive of plan.archives) {
    try { indexes.set(archive.id, readIndex(archive.id, options.cacheDir)); }
    catch (error) {
      indexErrors.push(`${archive.name}: ${(error as Error).message}`);
      unreadIndexes.push({ id: archive.id, name: archive.name, providerName: archive.providerName, rank: archive.rank, error: (error as Error).message });
    }
  }
  const depot = new DepotIndex(plan, indexes);
  const xlFiles = visibleLoose(candidates.filter(c => c.kind === "archive-xl"))
    .filter(c => XL_LOCATIONS.some(pattern => pattern.test(lower(c.virtualPath))))
    .sort((a, b) => {
      const bundle = (c: SourceCandidate) => lower(c.virtualPath).startsWith("red4ext/") ? 0 : 1;
      return bundle(a) - bundle(b) || (lower(a.virtualPath) < lower(b.virtualPath) ? -1 : lower(a.virtualPath) > lower(b.virtualPath) ? 1 : 0);
    });
  const xlIssues: string[] = [];
  const documents: XlDocument[] = [];
  for (const file of xlFiles) {
    try {
      const text = readFileSync(file.physicalPath, "utf8");
      if (/!exclude\b/.test(text)) xlIssues.push(`${file.virtualPath}: uses !exclude; the YAML reader drops tags, so exclusions are treated as targets.`);
      documents.push({ id: file.virtualPath, document: Bun.YAML.parse(text) });
    } catch (error) { xlIssues.push(`${file.virtualPath}: ${(error as Error).message}`); }
  }
  const xl = readArchiveXlConfig(documents);
  const contains = (archiveId: string, hash: string) => {
    const index = indexes.get(archiveId); if (!index) return false;
    const value = BigInt(hash); let low = 0, high = index.length - 1;
    while (low <= high) { const mid = (low + high) >>> 1; if (index[mid] === value) return true; if (index[mid]! < value) low = mid + 1; else high = mid - 1; }
    return false;
  };
  const fetcher = new WolvenKitFetcher(options.wolvenKitCli, options.cacheDir, contains, log);
  const graph = new ResourceGraph(depot, xl, fetcher);
  return { plan, depot, xl, graph, fetcher, summary: { route: options.launchRoute, scanComplete: discovery.complete,
    scanIssues: discovery.issues.filter(issue => issue.blocking).map(issue => `${issue.code}: ${issue.detail}`),
    scanGaps: discovery.issues.filter(issue => issue.blocking && issue.mayHideSources !== false).map(issue => `${issue.code}: ${issue.detail}`),
    mountedArchives: plan.archives.length, unmountedArchives: plan.unmounted.length, indexErrors, unreadIndexes,
    xlFiles: documents.length, xlIssues: [...xlIssues, ...xl.issues], ep1Installed: plan.ep1Installed, modOrder: plan.modOrder } };
}
