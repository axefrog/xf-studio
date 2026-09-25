/**
 * Host adapter: one opened installation per launch route, kept and shared by every host consumer in this process (the
 * character details, the grading LUT and the eye plate's head source), so preparing a V no longer scans the mod setup,
 * reads a thousand archive indexes and parses every `.xl` file each time.
 *
 * Staleness. An opened installation records every path its answer depends on, stamped when it was read (resolver-host.ts
 * `Installation.watch`: every scanned folder, every candidate archive and `.xl`, the MO2 settings file and profile mod
 * list, the ArchiveXL bundle and the game executable). Before it is reused, each stamp is read again (in parallel, far
 * cheaper than opening); any difference opens the route again. Adding, removing or renaming a file changes its folder's
 * modification time on NTFS and ReFS; on other volumes (FAT32, exFAT, network shares) a folder is stamped by its listing
 * instead (volume-info.ts, PIPE-58). Editing a candidate in place changes its own size or time, so a changed mod setup is never
 * served from the old installation. The route's settings and WolvenKit's identity are part of the key, so another
 * route, profile or WolvenKit opens its own installation. A change also bumps the route's `generation`, which the
 * hosts' request keys include (character-detail-host.ts `installationFingerprint`), so answers prepared from the old
 * installation are not reused either.
 *
 * - A host checks the route before it answers a request (`revalidate`) and the preparation it starts acquires the route
 *   moments later: a clean `revalidate` vouches for the next acquire within `CHECK_FRESH_MS`, so a request checks once, not twice
 *   (PIPE-62). An acquire after an acquire always checks.
 * - A route dropped to make room for another (`maxRoutes`) keeps its watch list (PIPE-52): the next check or open of that route
 *   compares it, and a change moves the generation on, so an answer prepared before the eviction is not served after a change.
 * - An installation opened with read errors (an unread archive index, a folder or `.xl` that could not be read: summary
 *   `readErrors`) is opened again once it is `PROBLEM_TTL_MS` old (PIPE-57): those stamps may not change when the problem goes
 *   away. The generation moves on only when the reopened installation's read errors differ.
 * - An installation whose WolvenKit changed in place (its identity now gives another key) can never be acquired again and is
 *   dropped when another opens (PIPE-55).
 *
 * Single flight: requests that arrive while a route is being checked or opened wait for that one check or open.
 *
 * Views. Resources are extracted into a cache folder chosen by each consumer; each folder gets its own resource graph
 * and fetcher over the shared archives (`installationView`). A view's graph remembers what it read (its shapes of meshes,
 * morph targets and `.app`s, and other documents whole), so a later V reuses the resources earlier ones shared. It is
 * replaced by a fresh graph over the same archives when a consumer's read failed in a way that may not repeat (so that read
 * is tried again; a prefetched resource nobody asked for doesn't count, PIPE-54), and the graphs of all routes together keep
 * at most `MAX_GRAPH_BYTES` of JSON: beyond it the least recently used views get fresh graphs (PIPE-55).
 */
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { installationView, openInstallation, type Installation, type InstallationOptions } from "./resolver-host";
import { ResourceGraph } from "./resource-graph";
import { routeIdentity, type LaunchRouteSettings } from "./route-fingerprint";
import { pathStamp, readListingStamp, type WatchedPath } from "./source-discovery";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";

export type InstallationRoute = LaunchRouteSettings & { readonly wolvenKitCli: string };
/**
 * The JSON the views' graphs keep, summed over every open route and cache folder (PIPE-55). The reference setup's three Vs and a
 * few piercing styles keep far less; beyond it the least recently used graphs start afresh.
 */
export const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
/** How long a clean `revalidate` vouches for the next acquire (PIPE-62). */
export const CHECK_FRESH_MS = 250;
/** How long an installation opened with read errors is reused before it is opened again (PIPE-57). */
export const PROBLEM_TTL_MS = 60_000;
/** How many threads read stamps at once when an installation is checked. */
const CHECK_CONCURRENCY = 64;
/** How many dropped routes keep their watch lists (PIPE-52). */
const MAX_RETIRED = 8;

type View = { graph: ResourceGraph; fetcher: Installation["fetcher"]; usedAt: number };
type Entry = {
  core: Installation | null;
  /** The options it was opened with (to recompute its key: a WolvenKit changed in place gives another). */
  route: InstallationRoute | null;
  views: Map<string, View>;
  checking: Promise<number | null> | null;
  opening: Promise<Installation> | null;
  usedAt: number;
  /**
   * When the installation was opened; when the check a clean `revalidate` ran started (null: no vouch pending); when an acquire last
   * reused it. A vouch holds only for the first acquire after its check (no acquire reused the installation since that check began).
   */
  openedAt: number;
  vouchedAt: number | null;
  reusedAt: number;
  /** The installation's read errors, as one text (null: none). */
  problems: string | null;
  /** The read errors of an installation dropped because it was old (compared with the next open's). */
  expired: string | null | undefined;
};
export type InstallationRegistryOptions = {
  /** Opens a route (default `openInstallation`); a test seam. */
  open?: (options: InstallationOptions) => Installation;
  /** Routes kept open at once (default 2); the least recently used beyond it is dropped. */
  maxRoutes?: number;
  /** Reads a path's time stamp (default `lstat`); a test seam. Listing stamps are read by listing the folder. */
  stamp?: (path: string) => Promise<string>;
  /** JSON the views' graphs keep in total (default `MAX_GRAPH_BYTES`). */
  maxGraphBytes?: number;
  /** Test seams: the clock, how long a clean `revalidate` vouches for the next acquire and how long an installation with read errors is reused. */
  now?: () => number;
  checkFreshMs?: number;
  problemTtlMs?: number;
};

const folderKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const defaultStamp = async (path: string) => { try { return pathStamp(await lstat(path)); } catch { return pathStamp(null); } };
const problemsOf = (core: Installation): string | null => {
  // A synthetic installation (a test's) may carry no summary.
  const summary = core.summary as Installation["summary"] | undefined;
  const errors = summary?.readErrors ?? summary?.indexErrors ?? [];
  return errors.length ? JSON.stringify(errors) : null;
};

/** The registry key of a route: its settings, the WolvenKit path and WolvenKit's identity. */
export function installationRouteKey(route: InstallationRoute): string {
  return canonicalJson({ route: routeIdentity(route), cli: folderKey(route.wolvenKitCli),
    tool: wolvenKitIdentityKey(wolvenKitIdentity(route.wolvenKitCli)) });
}

export class InstallationRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Per route key: how many times its opened installation was found out of date. Never reset while the process runs. */
  private readonly generations = new Map<string, number>();
  /** Watch lists of routes dropped to make room, by key, until the route is opened again (PIPE-52). */
  private readonly retired = new Map<string, readonly WatchedPath[]>();
  private clock = 0;
  readonly stats = { opens: 0, checks: 0, reused: 0, changed: 0, expired: 0, evicted: 0, graphsReplaced: 0 };
  constructor(private readonly options: InstallationRegistryOptions = {}) {}

  private now() { return this.options.now?.() ?? Date.now(); }

  /** How many times this route's installation has changed since the process started (part of the hosts' request keys). */
  generation(route: InstallationRoute): number { return this.generations.get(installationRouteKey(route)) ?? 0; }

  /** How many routes are open now, and the JSON their graphs keep. */
  footprint(): { routes: number; views: number; graphBytes: number } {
    let views = 0, graphBytes = 0;
    for (const entry of this.entries.values()) for (const view of entry.views.values()) { views++; graphBytes += view.graph.retainedBytes; }
    return { routes: [...this.entries.values()].filter(entry => entry.core).length, views, graphBytes };
  }

  /**
   * The installation for `options`' route, reused when its watched stamps are unchanged and opened otherwise, with the
   * graph and fetcher of `options.cacheDir`. Rejects when the route cannot be opened.
   */
  async acquire(options: InstallationOptions): Promise<Installation> {
    const key = installationRouteKey(options);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { core: null, route: null, views: new Map(), checking: null, opening: null, usedAt: 0, openedAt: 0, vouchedAt: null, reusedAt: -Infinity, problems: null, expired: undefined };
      this.entries.set(key, entry);
    }
    entry.usedAt = ++this.clock;
    if (entry.opening) return this.view(entry, await entry.opening, options);
    if (entry.core) {
      // A clean check the host ran for this request a moment ago stands (PIPE-62); otherwise check now.
      const now = this.now();
      const vouched = entry.vouchedAt !== null && now - entry.vouchedAt < (this.options.checkFreshMs ?? CHECK_FRESH_MS) && entry.reusedAt < entry.vouchedAt;
      entry.vouchedAt = null;
      if (!vouched) await this.validate(key, entry);
      if (entry.core) { entry.reusedAt = this.now(); this.stats.reused++; return this.view(entry, entry.core, options); }
    }
    return this.view(entry, await this.open(key, entry, options), options);
  }

  /**
   * Check a route's opened installation now (for a host about to reuse an answer): when it is out of date it is dropped
   * and the route's generation moves on. A route dropped to make room is checked against its kept watch list.
   */
  async revalidate(route: InstallationRoute): Promise<void> {
    const key = installationRouteKey(route), entry = this.entries.get(key);
    if (entry?.opening) { await entry.opening.catch(() => {}); return; }
    if (entry?.core) { const clean = await this.validate(key, entry); if (clean !== null && entry.core) entry.vouchedAt = clean; return; }
    await this.checkRetired(key);
  }

  /** Forget every opened route (tests, or a host shutting down). */
  clear(): void { this.entries.clear(); this.retired.clear(); }

  private bump(key: string): void { this.generations.set(key, (this.generations.get(key) ?? 0) + 1); }

  /** Compare a dropped route's kept watch list; a change moves its generation on (PIPE-52). */
  private async checkRetired(key: string): Promise<void> {
    const watch = this.retired.get(key);
    if (!watch) return;
    this.stats.checks++;
    if (await this.unchanged(watch)) return;
    if (this.retired.get(key) !== watch) return;
    this.retired.delete(key);
    this.bump(key);
    this.stats.changed++;
  }

  /**
   * Check an opened installation. Resolves with the time the check started when it found the installation unchanged and kept it,
   * else null (it changed, or it was dropped for its age).
   */
  private validate(key: string, entry: Entry): Promise<number | null> {
    if (entry.checking) return entry.checking;
    const started = this.now();
    const core = entry.core!;
    const checking = (async () => {
      this.stats.checks++;
      const same = await this.unchanged(core.watch);
      if (entry.core !== core) return null;
      if (!same) {
        entry.core = null; entry.views.clear(); entry.expired = undefined; entry.vouchedAt = null;
        this.bump(key);
        this.stats.changed++;
        return null;
      }
      // Read errors may clear without any stamp changing: such an installation is opened again once it is old (PIPE-57).
      if (entry.problems !== null && started - entry.openedAt >= (this.options.problemTtlMs ?? PROBLEM_TTL_MS)) {
        entry.core = null; entry.views.clear(); entry.expired = entry.problems;
        this.stats.expired++;
        return null;
      }
      return started;
    })();
    entry.checking = checking;
    const done = () => { if (entry.checking === checking) entry.checking = null; };
    checking.then(done, done);
    return checking;
  }

  private async unchanged(watch: readonly WatchedPath[] | undefined): Promise<boolean> {
    if (!watch) return true;
    const stamp = this.options.stamp ?? defaultStamp;
    let next = 0, same = true;
    const worker = async () => {
      while (same && next < watch.length) {
        const item = watch[next++]!;
        const now = item.stamp.startsWith("list|") ? await readListingStamp(item.path) : await stamp(item.path);
        if (now !== item.stamp) same = false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, watch.length) }, worker));
    return same;
  }

  private open(key: string, entry: Entry, options: InstallationOptions): Promise<Installation> {
    if (entry.opening) return entry.opening;
    const opening = (async () => {
      // Let the request that asked answer its caller's other work first; opening is synchronous file work.
      await new Promise(resolve => setTimeout(resolve, 0));
      this.stats.opens++;
      const core = (this.options.open ?? openInstallation)(options);
      const problems = problemsOf(core);
      // Reopened because it was old: the answer changed only if its read errors did.
      if (entry.expired !== undefined && entry.expired !== problems) this.bump(key);
      entry.expired = undefined;
      // Dropped earlier to make room: anything changed since (even during this open) moves the generation on (PIPE-52).
      await this.checkRetired(key);
      this.retired.delete(key);
      entry.core = core; entry.route = { ...options }; entry.problems = problems;
      entry.openedAt = this.now(); entry.vouchedAt = null;
      entry.views = new Map([[folderKey(options.cacheDir), { graph: core.graph, fetcher: core.fetcher, usedAt: ++this.clock }]]);
      this.forgetLeftBehind(key);
      this.evict(key);
      return core;
    })();
    entry.opening = opening;
    const done = () => { if (entry.opening === opening) entry.opening = null; };
    opening.then(done, done);
    return opening;
  }

  private view(entry: Entry, core: Installation, options: InstallationOptions): Installation {
    const folder = folderKey(options.cacheDir);
    let view = entry.views.get(folder);
    if (!view) {
      view = { ...installationView(core, options), usedAt: 0 };
      entry.views.set(folder, view);
    } else if (view.graph.retryableFailures > 0) {
      // A consumer's read failed in a way that may not repeat: read it again (PIPE-54).
      view.graph = new ResourceGraph(core.depot, core.xl, view.graph.port);
      this.stats.graphsReplaced++;
    }
    view.usedAt = ++this.clock;
    this.bound(view);
    return { ...core, graph: view.graph, fetcher: view.fetcher };
  }

  /**
   * Keep the views' graphs within `maxGraphBytes` in total (PIPE-55): the least recently used start afresh first, the view being
   * handed out last (a preparation that has it keeps its graph; only the registry lets go of it).
   */
  private bound(current: View): void {
    const limit = this.options.maxGraphBytes ?? MAX_GRAPH_BYTES;
    const views: { view: View; entry: Entry }[] = [];
    let total = 0;
    for (const entry of this.entries.values()) for (const view of entry.views.values()) { views.push({ view, entry }); total += view.graph.retainedBytes; }
    if (total <= limit) return;
    views.sort((a, b) => (a.view === current ? 1 : 0) - (b.view === current ? 1 : 0) || a.view.usedAt - b.view.usedAt);
    for (const { view, entry } of views) {
      if (total <= limit) break;
      if (!view.graph.retainedBytes || !entry.core) continue;
      total -= view.graph.retainedBytes;
      view.graph = new ResourceGraph(entry.core.depot, entry.core.xl, view.graph.port);
      this.stats.graphsReplaced++;
    }
  }

  /** Drop routes whose WolvenKit changed in place since they opened: their key can never be asked for again (PIPE-55). */
  private forgetLeftBehind(keep: string): void {
    for (const [key, entry] of this.entries) {
      if (key === keep || entry.opening || entry.checking || !entry.route) continue;
      if (installationRouteKey(entry.route) !== key) { this.entries.delete(key); this.retired.delete(key); this.stats.evicted++; }
    }
  }

  private evict(keep: string): void {
    const limit = Math.max(1, this.options.maxRoutes ?? 2);
    const idle = [...this.entries].filter(([key, entry]) => key !== keep && !entry.opening && !entry.checking).sort((a, b) => a[1].usedAt - b[1].usedAt);
    while (this.entries.size > limit && idle.length) {
      const [key, entry] = idle.shift()!;
      this.entries.delete(key);
      this.stats.evicted++;
      // Its watch list stays, so a change made while it is closed is still noticed (PIPE-52).
      if (entry.core?.watch) {
        this.retired.set(key, entry.core.watch);
        // A route whose watch list is let go can't be vouched for any more: its generation moves on.
        while (this.retired.size > MAX_RETIRED) { const oldest = this.retired.keys().next().value!; this.retired.delete(oldest); this.bump(oldest); }
      }
    }
  }
}

/** The process's shared registry: every host consumer on the same route uses one opened installation. */
export const installations = new InstallationRegistry();
/** `installations.acquire`, as the hosts' `open` seam. */
export const acquireInstallation = (options: InstallationOptions): Promise<Installation> => installations.acquire(options);
