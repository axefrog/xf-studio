/** Read-only Vortex check for one game folder: is it Vortex-managed, which installation and profile deployed it, which mod
 * each deployed file came from (with Nexus ids when Vortex's state is readable), and whether the deployment is out of date.
 * Never starts Vortex and writes nothing. Paths are left out of the output, which names mods and files only.
 *
 * bun tools/vortex-check.ts --game-root <absolute> [--files]
 */
import { discoverSources } from "../src/source-discovery";
import { defaultLocalSettings } from "../src/local-settings";
import { compareWithDeployment } from "../src/vortex-deployment";
import { inspectVortexSetup } from "../src/vortex-host";

const args = process.argv.slice(2);
const at = args.indexOf("--game-root");
const gameRoot = at >= 0 ? args[at + 1] : undefined;
if (!gameRoot) throw Error("Usage: bun tools/vortex-check.ts --game-root <absolute> [--files]");
const setup = inspectVortexSetup(gameRoot, name => process.env[name]);
const scan = discoverSources({ ...defaultLocalSettings(), gameRoot, launchRoute: "direct" });
const gameFiles = scan.candidates.filter(c => c.provider === "game").map(c => ({ virtualPath: c.virtualPath, modifiedMs: c.modifiedMs }));
const report = setup.deployment ? compareWithDeployment(setup.deployment, gameFiles, ["archive/pc/"], setup.state?.game.mods ?? null, setup.state?.current ?? false) : null;
const mods = new Map<string, number>();
for (const row of report?.attributed ?? []) mods.set(row.attribution.modId, (mods.get(row.attribution.modId) ?? 0) + 1);
const game = setup.state?.game;
console.log(JSON.stringify({
  deployed: setup.deployed,
  manifests: setup.manifests.map(({ instance: _instance, ...row }) => ({ ...row, deploymentTime: row.deploymentTimeMs ? new Date(row.deploymentTimeMs).toISOString() : null })),
  state: setup.state ? { location: setup.state.kind, source: setup.state.source, databaseMode: setup.state.databaseMode, current: setup.state.current, gaps: setup.state.gaps,
    backupTime: setup.state.backupTimeMs ? new Date(setup.state.backupTimeMs).toISOString() : null,
    profile: game?.profile?.name ?? game?.profile?.id ?? null, profileActive: game?.profileActive, installedMods: game?.mods.size,
    deploymentMethod: game?.deploymentMethod } : null,
  instanceMatches: setup.instanceMatches, managesThisFolder: setup.managesThisFolder, stagingMarkerFound: !!setup.stagingMarker,
  archiveFolder: report ? { deployedFilesByMod: Object.fromEntries([...mods].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => {
    const identity = game?.mods.get(id);
    return [id, { files: count, name: identity?.name ?? null, version: identity?.version ?? null, nexus: identity?.nexus ?? null, enabled: identity?.enabled ?? null }];
  })), unmanaged: report.unmanaged.filter(path => path.toLowerCase().startsWith("archive/pc/mod/")), missing: report.missing, changed: report.changed, stale: report.stale } : null,
  files: args.includes("--files") ? report?.attributed.map(row => ({ path: row.virtualPath, mod: row.attribution.modId, state: row.attribution.state })) : undefined,
  problems: setup.problems,
}, null, 2));
