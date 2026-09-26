/**
 * The creator catalogue's on-screen text resources read by WolvenKit alone (R&D; read-only towards the game and mods). Every text
 * resource the route's text plan names (the game's own, then each ArchiveXL `localization` declaration) is read from its winning
 * archive through the resolver's WolvenKit fetcher, in its JSON-resource mode (the catalogue's fallback, PIPE-50), into
 * `<cache>/json`: the shape tools/native-cr2w-diff.ts compares the native reader against, leaf for leaf.
 *
 *   bun tools/catalogue-texts-oracle.ts --cache <folder> [--language en-us | --all-languages]
 *
 * The game folder, launch route and WolvenKit come from the Studio's saved setup (or XFS_RESOLVER_GAME_ROOT, XFS_RESOLVER_MO2_ROOT,
 * XFS_RESOLVER_MO2_PROFILE, XFS_WOLVENKIT_CLI). Run it under the memory guard: its launches load the text archives.
 */
import { resolve } from "node:path";
import { refFromPath } from "../src/depot-path";
import { textPlan } from "../src/game-text";
import { LocalSettingsStore } from "../src/local-settings-store";
import { openInstallation, WolvenKitFetcher } from "../src/resolver-host";

const args = Bun.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const settings = (() => { try { return new LocalSettingsStore().load().settings; } catch { return null; } })();
const gameRoot = process.env.XFS_RESOLVER_GAME_ROOT ?? settings?.gameRoot;
const cli = process.env.XFS_WOLVENKIT_CLI ?? settings?.wolvenKitCli;
const mo2Root = process.env.XFS_RESOLVER_MO2_ROOT ?? (settings?.launchRoute === "mo2" ? settings.mo2Root : null);
const profile = process.env.XFS_RESOLVER_MO2_PROFILE ?? (settings?.launchRoute === "mo2" ? settings.mo2ProfileId : null);
const cache = option("cache");
if (!gameRoot || !cli || !cache) { console.error("usage: bun tools/catalogue-texts-oracle.ts --cache <folder> [--language en-us | --all-languages] (with the game folder and WolvenKit set up)"); process.exit(2); }
const cacheDir = resolve(cache);

const started = performance.now();
const installation = openInstallation({ gameRoot, launchRoute: mo2Root ? "mo2" : "direct", mo2Root, mo2ProfileId: profile, wolvenKitCli: cli, cacheDir });
const languages = new Set<string>([option("language") ?? "en-us"]);
if (args.includes("--all-languages")) for (const unit of installation.xl.localization) for (const code of unit.onscreens.keys()) languages.add(code);
const paths = new Set<string>();
for (const language of languages) for (const item of textPlan(language, installation.plan.ep1Installed, installation.xl.localization)) paths.add(item.path);
const wolvenKit = new WolvenKitFetcher(cli, cacheDir, (archive, hash) => installation.depot.archiveContains(archive, hash), message => console.error(`[texts] ${message}`));
const opened = performance.now();
let read = 0, missing = 0, unreadable = 0;
await Promise.all([...paths].map(async path => {
  const ref = refFromPath(path);
  const winner = installation.graph.lookup(ref.hash).winner;
  if (!winner) { missing++; return; }
  if (await wolvenKit.fetch(winner, ref, "json")) read++; else { unreadable++; console.error(`[texts] ${winner.name}: ${path} was not read`); }
}));
console.log(JSON.stringify({ languages: [...languages], paths: paths.size, read, missing, unreadable, launches: wolvenKit.stats.cliCalls,
  extracted: wolvenKit.stats.extracted, routeOpenS: +((opened - started) / 1000).toFixed(1), readS: +((performance.now() - opened) / 1000).toFixed(1),
  failures: wolvenKit.stats.failures.slice(0, 10) }, null, 1));
