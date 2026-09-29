/**
 * Host adapter: a launch route's source discovery kept across restarts (research/backlog/performance.md, warm restart). Discovering an MO2
 * route walks every mod folder synchronously (about 10,000 folders and files on the reference installation: 1.6–2.0 s with the host's one
 * thread blocked). The discovery already names everything its answer depends on, with a stamp taken when it was read (`watched`: every
 * folder walked, every candidate, the MO2 settings file and mod list, the Vortex manifests); when none of them changed, a fresh walk finds
 * the same sources (source-discovery.ts). That is the rule the installation registry reuses an opened installation by, so a snapshot is
 * reused by it too: its watched stamps are read again, in parallel and without blocking (about 40–90 ms for the reference installation's
 * 10,209 paths), and any difference discovers again.
 *
 * A snapshot also names the route (its settings), the scan limits, the host code that wrote it (host-code-identity.ts) and its own
 * version, so another route, another XF Studio or an edited source file never reuses one. It holds physical paths: private host
 * metadata in the resolver cache folder, never served to a page.
 *
 * `watchUnchanged` is the one watched-stamp check, shared with the installation registry and the prepared answers (prepared-answers.ts).
 */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { writeFileAtomic } from "./derived-cache";
import { pathStamp, readListingStamp, type SourceDiscovery, type WatchedPath } from "./source-discovery";

export const DISCOVERY_SNAPSHOT_SCHEMA = "xfs/discovery-snapshot-1" as const;
/** How many threads read stamps at once. */
export const WATCH_CHECK_CONCURRENCY = 64;

/** A path's stamp now (`pathStamp` of its `lstat`), "missing" when it can't be read. */
export const currentStamp = async (path: string): Promise<string> => { try { return pathStamp(await lstat(path)); } catch { return pathStamp(null); } };

/**
 * Whether every watched path still has its stamp (a folder stamped by its listing is listed again). Stops at the first difference. A
 * missing list is unchanged (nothing was watched).
 */
export async function watchUnchanged(watch: readonly WatchedPath[] | undefined, stamp: (path: string) => Promise<string> = currentStamp,
  concurrency = WATCH_CHECK_CONCURRENCY): Promise<boolean> {
  if (!watch) return true;
  let next = 0, same = true;
  const worker = async () => {
    while (same && next < watch.length) {
      const item = watch[next++]!;
      const now = item.stamp.startsWith("list|") ? await readListingStamp(item.path) : await stamp(item.path);
      if (now !== item.stamp) same = false;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, watch.length) }, worker));
  return same;
}

/** A digest of a watch list (its paths and stamps, in order): what a prepared answer names the installation it came from by. */
export const watchDigest = (watch: readonly WatchedPath[]): string =>
  createHash("sha256").update(watch.map(item => `${item.path}\u0000${item.stamp}`).join("\n")).digest("hex").slice(0, 32);

type Snapshot = { schema: typeof DISCOVERY_SNAPSHOT_SCHEMA; key: string; discovery: SourceDiscovery };

/**
 * Issues from a read that failed (PIPE-127): a folder or entry that couldn't be listed or inspected, a profile or manifest that couldn't be
 * read. Such a failure may not repeat and changes no stamp (the folder is stamped before it is read), so a discovery that met one is
 * never kept or reused: the next start walks again.
 */
export const TRANSIENT_DISCOVERY_ISSUES: ReadonlySet<string> = new Set(["directory_unreadable", "entry_unreadable", "profile_unreadable", "vortex_manifest_unreadable"]);
/** Whether a discovery may be kept for a later start: it met no read failure that may not repeat. */
export const keepableDiscovery = (discovery: SourceDiscovery): boolean =>
  Array.isArray(discovery.issues) && !discovery.issues.some(issue => TRANSIENT_DISCOVERY_ISSUES.has(issue?.code));

/** The snapshots of one cache folder. `key`: the route's settings and scan limits; `code`: the host code identity. */
export class DiscoverySnapshots {
  constructor(private readonly options: { code: () => Promise<string>; stamp?: (path: string) => Promise<string> }) {}

  private file(cacheDir: string, key: string) { return join(cacheDir, "discovery", `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`); }
  /** The snapshot's full key, or null when the host code identity can't be read (then nothing is kept or reused: PIPE-128). */
  private async fullKey(route: unknown): Promise<string | null> {
    try { return canonicalJson({ schema: DISCOVERY_SNAPSHOT_SCHEMA, route, code: await this.options.code() }); }
    catch { return null; }
  }

  /**
   * The kept discovery of `route` when every stamp it depends on is unchanged, else null (none kept, another version, changed, or one that
   * met a read failure). Never throws: anything that goes wrong is a walk.
   */
  async read(cacheDir: string, route: unknown): Promise<SourceDiscovery | null> {
    const key = await this.fullKey(route);
    if (!key) return null;
    let snapshot: Snapshot;
    try { snapshot = JSON.parse(await readFile(this.file(cacheDir, key), "utf8")) as Snapshot; } catch { return null; }
    if (snapshot?.schema !== DISCOVERY_SNAPSHOT_SCHEMA || snapshot.key !== key || !Array.isArray(snapshot.discovery?.watched)
      || !Array.isArray(snapshot.discovery?.candidates) || !keepableDiscovery(snapshot.discovery)) return null;
    try { return await watchUnchanged(snapshot.discovery.watched, this.options.stamp) ? snapshot.discovery : null; }
    catch { return null; }
  }

  /**
   * Keep a fresh discovery of `route` (advisory: a failed write only means the next start walks again). A discovery that met a read failure
   * that may not repeat (`keepableDiscovery`) is not kept.
   */
  async write(cacheDir: string, route: unknown, discovery: SourceDiscovery): Promise<void> {
    if (!keepableDiscovery(discovery)) return;
    const key = await this.fullKey(route);
    if (!key) return;
    try {
      mkdirSync(join(cacheDir, "discovery"), { recursive: true });
      writeFileAtomic(this.file(cacheDir, key), JSON.stringify({ schema: DISCOVERY_SNAPSHOT_SCHEMA, key, discovery } satisfies Snapshot));
    } catch { /* Advisory. */ }
  }
}
