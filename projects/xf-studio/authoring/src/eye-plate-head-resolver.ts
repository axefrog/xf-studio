/**
 * Host adapter for the eye plate's head-source port: opens the selected launch route with the generic
 * resolver (source discovery, archive mount order, RDAR indexes and `.xl` files; resolver-host.ts) and asks
 * the pure planner which head mesh, morph target and patches the game is expected to load.
 *
 * Build stops (plate_source_incomplete) instead of guessing when the route could not be read completely
 * enough to trust that answer: a scan gap that may hide an archive or `.xl` file (a skipped link to a text
 * file does not count), or an unreadable archive index that the game searches before the head's winning
 * archive (it could hide a head mod).
 *
 * Read-only towards the game and MO2. The route is opened through the process's installation registry
 * (installation-registry.ts), which reuses an installation the preview already opened while every folder and file it
 * read is unchanged, and opens it again otherwise. Archive index caches are written only below a host-private cache
 * folder: `cacheDir` here, or the preview's resolver cache when the preview opened the route first.
 */
import { settleDepotAdditions } from "./archivexl-config";
import { planHeadSource, type HeadSourcePlan } from "./eye-plate-head-source";
import { EyePlateError, type EyePlateHeadSourcePort } from "./eye-plate-service";
import type { LaunchRoute } from "./local-settings";
import { installations } from "./installation-registry";
import type { UnreadIndex } from "./resolver-host";

export interface InstalledHeadRoute {
  readonly gameRoot: string;
  readonly launchRoute: LaunchRoute;
  readonly mo2Root?: string | null;
  readonly mo2ProfileId?: string | null;
  readonly manualModRoot?: string | null;
  readonly wolvenKitCli: string;
}

export const INCOMPLETE_SCAN_MESSAGE = "Build stopped because XF Studio couldn't read all of your installed mods, so it can't tell " +
  "which head your game loads. Check the game and mod folders in Local setup, close any tool that is changing mod files, then build again.";
function unreadMessage(archives: readonly UnreadIndex[]): string {
  const named = archives.slice(0, 3).map(item => `“${item.name}” (${item.providerName})`).join(", ");
  const more = archives.length > 3 ? ` and ${archives.length - 3} more` : "";
  return `Build stopped because XF Studio couldn't read the mod archive ${named}${more}. The game checks ` +
    `${archives.length === 1 ? "it" : "them"} before the head it would otherwise use, so a head mod could be hiding there. ` +
    "Reinstall or remove that mod, then build again.";
}

/**
 * Pure gate over one route's scan: an error when the route was not read completely enough to trust which
 * head it loads. An unread index matters only when the game searches it before a winning head archive, or
 * when a head resource or plate-relevant patch source was found nowhere.
 */
export function incompleteHeadSource(scan: { scanGaps: readonly string[]; unreadIndexes: readonly UnreadIndex[] },
  plan: HeadSourcePlan, rankOf: (archiveFile: string) => number | undefined): EyePlateError | null {
  if (scan.scanGaps.length) return new EyePlateError("plate_source_incomplete", INCOMPLETE_SCAN_MESSAGE, scan.scanGaps.join("\n"));
  if (!scan.unreadIndexes.length) return null;
  const found = [plan.mesh, plan.morph, ...plan.patches];
  const deepest = found.some(item => !item) || plan.ignoredPatches.some(item => item.sourceMissing) ? Infinity
    : Math.max(...found.map(item => rankOf(item!.archive.file) ?? Infinity));
  const relevant = scan.unreadIndexes.filter(item => item.rank < deepest).sort((a, b) => a.rank - b.rank);
  return relevant.length ? new EyePlateError("plate_source_incomplete", unreadMessage(relevant),
    relevant.map(item => `${item.name}: ${item.error}`).join("\n")) : null;
}

export function createInstalledHeadSource(route: InstalledHeadRoute, cacheDir: string): EyePlateHeadSourcePort {
  return {
    async resolve({ meshDepotPath, morphDepotPath }) {
      // The process's shared installation for the route, checked against the mod setup before it is reused.
      const installation = await installations.acquire({ gameRoot: route.gameRoot, launchRoute: route.launchRoute, mo2Root: route.mo2Root ?? null,
        mo2ProfileId: route.mo2ProfileId ?? null, manualModRoot: route.manualModRoot ?? null, wolvenKitCli: route.wolvenKitCli, cacheDir });
      const { depot, xl, summary } = installation;
      const additions = settleDepotAdditions(xl, hash => depot.lookup(hash).winner !== null);
      const plan = planHeadSource({ meshDepotPath, morphDepotPath }, depot, additions, xl.paths);
      const ranks = new Map(installation.plan.archives.map(archive => [archive.id, archive.rank]));
      const incomplete = incompleteHeadSource(summary, plan, file => ranks.get(file));
      if (incomplete) throw incomplete;
      const skipped = summary.scanIssues.length - summary.scanGaps.length;
      const notes = [`${summary.route} route: ${summary.mountedArchives} mounted archives, ${summary.xlFiles} .xl files` +
        (skipped ? ` (${skipped} linked non-mod file${skipped === 1 ? "" : "s"} skipped)` : ""),
        ...summary.indexErrors.map(error => `Archive index not read (searched after the head, so it cannot change it): ${error}`)];
      return { plan, notes };
    },
  };
}
