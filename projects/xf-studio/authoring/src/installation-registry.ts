/**
 * Host adapter: one opened installation per launch route, kept and shared by every host consumer in this process (the
 * character details, the grading LUT and the eye plate's head source), so preparing a V no longer scans the mod setup,
 * reads a thousand archive indexes and parses every `.xl` file each time.
 *
 * Staleness. An opened installation records every path its answer depends on, stamped when it was read (resolver-host.ts
 * `Installation.watch`: every scanned folder, every candidate archive and `.xl`, the MO2 settings file and profile mod
 * list, the ArchiveXL bundle and the game executable). Before it is reused, each stamp is read again (in parallel, far
 * cheaper than opening); any difference opens the route again. Adding, removing or renaming a file changes its folder's
 * modification time, and editing a candidate in place changes its own size or time, so a changed mod setup is never
 * served from the old installation. The route's settings and WolvenKit's identity are part of the key, so another
 * route, profile or WolvenKit opens its own installation. A change also bumps the route's `generation`, which the
 * hosts' request keys include (character-detail-host.ts `installationFingerprint`), so answers prepared from the old
 * installation are not reused either.
 *
 * Single flight: requests that arrive while a route is being checked or opened wait for that one check or open.
 *
 * Views. Resources are extracted into a cache folder chosen by each consumer; each folder gets its own resource graph
 * and fetcher over the shared archives (`installationView`). A view's graph remembers what it read, so a later V reuses
 * the resources earlier ones shared. It is replaced by a fresh graph over the same archives when its fetcher answered a
 * resource null for a reason that may not repeat (so that failure is tried again), or when it has read more than
 * `MAX_GRAPH_RESOURCES` resources (to bound memory).
 */
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalJson } from "./eye-plate-recipe";
import { installationView, openInstallation, type Installation, type InstallationOptions } from "./resolver-host";
import { ResourceGraph } from "./resource-graph";
import { routeIdentity, type LaunchRouteSettings } from "./route-fingerprint";
import { pathStamp, type WatchedPath } from "./source-discovery";
import { wolvenKitIdentity, wolvenKitIdentityKey } from "./wolvenkit-cli";

export type InstallationRoute = LaunchRouteSettings & { readonly wolvenKitCli: string };
/** A view's graph is replaced once it holds more resources than this (a few Vs' worth). */
export const MAX_GRAPH_RESOURCES = 6_000;
/** How many stamps are read at once when an installation is checked. */
const CHECK_CONCURRENCY = 64;

type View = { graph: ResourceGraph; fetcher: Installation["fetcher"]; transient: number };
type Entry = {
  core: Installation | null;
  views: Map<string, View>;
  checking: Promise<void> | null;
  opening: Promise<Installation> | null;
  usedAt: number;
};
export type InstallationRegistryOptions = {
  /** Opens a route (default `openInstallation`); a test seam. */
  open?: (options: InstallationOptions) => Installation;
  /** Routes kept open at once (default 2); the least recently used beyond it is dropped. */
  maxRoutes?: number;
  /** Reads a path's stamp (default `lstat`); a test seam. */
  stamp?: (path: string) => Promise<string>;
};

const folderKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const transientOf = (fetcher: Installation["fetcher"] | undefined): number | null =>
  typeof (fetcher as { stats?: { transient?: unknown } } | undefined)?.stats?.transient === "number" ? fetcher!.stats.transient : null;
const defaultStamp = async (path: string) => { try { return pathStamp(await lstat(path)); } catch { return pathStamp(null); } };

/** The registry key of a route: its settings, the WolvenKit path and WolvenKit's identity. */
export function installationRouteKey(route: InstallationRoute): string {
  return canonicalJson({ route: routeIdentity(route), cli: folderKey(route.wolvenKitCli),
    tool: wolvenKitIdentityKey(wolvenKitIdentity(route.wolvenKitCli)) });
}

export class InstallationRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Per route key: how many times its opened installation was found out of date. Never reset while the process runs. */
  private readonly generations = new Map<string, number>();
  private clock = 0;
  readonly stats = { opens: 0, checks: 0, reused: 0, changed: 0 };
  constructor(private readonly options: InstallationRegistryOptions = {}) {}

  /** How many times this route's installation has changed since the process started (part of the hosts' request keys). */
  generation(route: InstallationRoute): number { return this.generations.get(installationRouteKey(route)) ?? 0; }

  /**
   * The installation for `options`' route, reused when its watched stamps are unchanged and opened otherwise, with the
   * graph and fetcher of `options.cacheDir`. Rejects when the route cannot be opened.
   */
  async acquire(options: InstallationOptions): Promise<Installation> {
    const key = installationRouteKey(options);
    let entry = this.entries.get(key);
    if (!entry) { entry = { core: null, views: new Map(), checking: null, opening: null, usedAt: 0 }; this.entries.set(key, entry); }
    entry.usedAt = ++this.clock;
    if (entry.opening) return this.view(entry, await entry.opening, options);
    if (entry.core) {
      await this.validate(key, entry);
      if (entry.core) { this.stats.reused++; return this.view(entry, entry.core, options); }
    }
    return this.view(entry, await this.open(key, entry, options), options);
  }

  /**
   * Check a route's opened installation now (for a host about to reuse an answer): when it is out of date it is dropped
   * and the route's generation moves on. Nothing happens for a route that is not open.
   */
  async revalidate(route: InstallationRoute): Promise<void> {
    const key = installationRouteKey(route), entry = this.entries.get(key);
    if (!entry) return;
    if (entry.opening) { await entry.opening.catch(() => {}); return; }
    if (entry.core) await this.validate(key, entry);
  }

  /** Forget every opened route (tests, or a host shutting down). */
  clear(): void { this.entries.clear(); }

  private validate(key: string, entry: Entry): Promise<void> {
    if (entry.checking) return entry.checking;
    const core = entry.core!;
    const checking = (async () => {
      this.stats.checks++;
      if (await this.unchanged(core.watch)) return;
      if (entry.core !== core) return;
      entry.core = null; entry.views.clear();
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      this.stats.changed++;
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
        if (await stamp(item.path) !== item.stamp) same = false;
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
      entry.core = core;
      entry.views = new Map([[folderKey(options.cacheDir), { graph: core.graph, fetcher: core.fetcher, transient: transientOf(core.fetcher) ?? 0 }]]);
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
      const made = installationView(core, options);
      view = { ...made, transient: made.fetcher.stats.transient };
      entry.views.set(folder, view);
    } else {
      const transient = transientOf(view.fetcher);
      const failed = transient === null ? view.graph.loadErrors.size > 0 : transient > view.transient;
      if (failed || view.graph.size > MAX_GRAPH_RESOURCES) {
        view.graph = new ResourceGraph(core.depot, core.xl, view.graph.port);
        view.transient = transient ?? 0;
      }
    }
    return { ...core, graph: view.graph, fetcher: view.fetcher };
  }

  private evict(keep: string): void {
    const limit = Math.max(1, this.options.maxRoutes ?? 2);
    const idle = [...this.entries].filter(([key, entry]) => key !== keep && !entry.opening && !entry.checking).sort((a, b) => a[1].usedAt - b[1].usedAt);
    while (this.entries.size > limit && idle.length) this.entries.delete(idle.shift()![0]);
  }
}

/** The process's shared registry: every host consumer on the same route uses one opened installation. */
export const installations = new InstallationRegistry();
/** `installations.acquire`, as the hosts' `open` seam. */
export const acquireInstallation = (options: InstallationOptions): Promise<Installation> => installations.acquire(options);
