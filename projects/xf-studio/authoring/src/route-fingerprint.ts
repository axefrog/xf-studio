import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readConfiguredMo2Instance } from "./install-detection-host";
import { describeMo2Instance } from "./mo2-instance";

/**
 * The one cheap fingerprint of a launch route, shared by every host consumer: the eye plate's route key (persisted with
 * the plate cache), the character details' request key and the grading LUT's key (character-detail-host.ts
 * `installationFingerprint`), and the installation registry's route key (installation-registry.ts).
 *
 * It is the route's settings plus the size and time of the places that change when mods are installed, removed,
 * enabled, disabled or reordered: the game's mod folder and its `modlist.txt`, the MO2 profile's `modlist.txt`, MO2's
 * overwrite folder (where the instance's ModOrganizer.ini puts them) and a manual mod folder. Six `stat` calls, so it is
 * cheap enough for every request. It does not see files edited, added or removed inside an existing MO2 mod folder; the
 * installation registry's watched-path check (the same mechanism's second, deeper tier, run before an installation is
 * reused) does.
 */
export type LaunchRouteSettings = {
  gameRoot: string;
  launchRoute: "direct" | "mo2";
  mo2Root?: string | null;
  mo2ProfileId?: string | null;
  manualModRoot?: string | null;
};

/** The route's settings, in a fixed order. */
export const routeIdentity = (route: LaunchRouteSettings): (string | null)[] =>
  [resolve(route.gameRoot), route.launchRoute, route.mo2Root ?? null, route.mo2ProfileId ?? null, route.manualModRoot ?? null];

const stamp = (path: string | null) => {
  if (!path) return "-";
  try { const s = statSync(path); return `${s.size}|${s.mtimeMs}`; } catch { return "missing"; }
};

/** Each MO2 instance's profiles and overwrite folders, read from its ModOrganizer.ini while the ini's stamp holds. */
const instances = new Map<string, { ini: string; paths: { profiles: string; overwrite: string } }>();
/**
 * Where an MO2 instance keeps its profiles and overwrite folder: as its ModOrganizer.ini configures them, which may move
 * them elsewhere (PIPE-05); MO2's default layout when the ini is absent or can't be read. One `stat` while the ini is unchanged.
 */
function mo2Folders(root: string): { profiles: string; overwrite: string } {
  const ini = stamp(join(root, "ModOrganizer.ini")), known = instances.get(root);
  if (known?.ini === ini) return known.paths;
  let paths: { profiles: string; overwrite: string };
  try { paths = readConfiguredMo2Instance(root).paths; } catch { paths = describeMo2Instance(null, root, "configured", "instance").paths; }
  instances.set(root, { ini, paths });
  return paths;
}

/** Size and time of the route's mod lists and mod folders (see the module comment). */
export function routeStamps(route: LaunchRouteSettings): string[] {
  const mods = join(route.gameRoot, "archive", "pc", "mod");
  const mo2 = route.mo2Root ? mo2Folders(route.mo2Root) : null;
  const profile = mo2 && route.mo2ProfileId ? join(mo2.profiles, route.mo2ProfileId) : null;
  return [stamp(mods), stamp(join(mods, "modlist.txt")), stamp(profile && join(profile, "modlist.txt")),
    stamp(mo2 ? mo2.overwrite : null), stamp(route.manualModRoot ?? null)];
}
