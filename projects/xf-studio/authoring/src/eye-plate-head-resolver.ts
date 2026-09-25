/**
 * Host adapter for the eye plate's head-source port: opens the selected launch route with the generic
 * resolver (source discovery, archive mount order, RDAR indexes and `.xl` files; resolver-host.ts) and asks
 * the pure planner which head mesh, morph target and patches the game is expected to load.
 *
 * Read-only towards the game and MO2. Archive index caches are written only below `cacheDir`, which hosts
 * place inside their private plate cache.
 */
import { settleDepotAdditions } from "./archivexl-config";
import { planHeadSource } from "./eye-plate-head-source";
import type { EyePlateHeadSourcePort } from "./eye-plate-service";
import type { LaunchRoute } from "./local-settings";
import { openInstallation } from "./resolver-host";

export interface InstalledHeadRoute {
  readonly gameRoot: string;
  readonly launchRoute: LaunchRoute;
  readonly mo2Root?: string | null;
  readonly mo2ProfileId?: string | null;
  readonly manualModRoot?: string | null;
  readonly wolvenKitCli: string;
}

export function createInstalledHeadSource(route: InstalledHeadRoute, cacheDir: string): EyePlateHeadSourcePort {
  return {
    async resolve({ meshDepotPath, morphDepotPath }) {
      const installation = openInstallation({ gameRoot: route.gameRoot, launchRoute: route.launchRoute, mo2Root: route.mo2Root ?? null,
        mo2ProfileId: route.mo2ProfileId ?? null, manualModRoot: route.manualModRoot ?? null, wolvenKitCli: route.wolvenKitCli, cacheDir });
      const { depot, xl, summary } = installation;
      const additions = settleDepotAdditions(xl, hash => depot.lookup(hash).winner !== null);
      const plan = planHeadSource({ meshDepotPath, morphDepotPath }, depot, additions, xl.paths);
      const notes = [`${summary.route} route: ${summary.mountedArchives} mounted archives, ${summary.xlFiles} .xl files` +
        (summary.scanComplete ? "" : " (source scan incomplete)"),
      ...summary.indexErrors.map(error => `Archive index not read: ${error}`)];
      return { plan, notes };
    },
  };
}
