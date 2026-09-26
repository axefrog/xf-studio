/**
 * Build the character-creator catalogue for a real installation, read-only, and print its shape: sections, rows,
 * options per section, CCXL additions, label sources and what the preview can draw. The full catalogue names installed
 * mods, so it is written only into the ignored resolver cache.
 *
 *   bun tools/cc-catalogue.ts [--gender female|male] [--language en-us] [--out <file>] [--no-wolvenkit]
 *
 * The game folder, launch route and WolvenKit come from the Studio's saved setup (or XFS_RESOLVER_GAME_ROOT,
 * XFS_RESOLVER_MO2_ROOT, XFS_RESOLVER_MO2_PROFILE, XFS_WOLVENKIT_CLI).
 */
import { resolve } from "node:path";
import { loadCreatorCatalogue } from "../src/cc-catalogue-host";
import { userFacing } from "../src/cc-catalogue";
import { catalogueCoverage } from "../src/cc-render-coverage";
import { LocalSettingsStore } from "../src/local-settings-store";
import { openInstallation, openNativeRoute } from "../src/resolver-host";

const args = Bun.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const settings = (() => { try { return new LocalSettingsStore().load().settings; } catch { return null; } })();
const gameRoot = process.env.XFS_RESOLVER_GAME_ROOT ?? settings?.gameRoot;
// `--no-wolvenkit`: XF Studio's own reader alone, as the app reads without WolvenKit set up.
const cli = args.includes("--no-wolvenkit") ? null : process.env.XFS_WOLVENKIT_CLI ?? settings?.wolvenKitCli ?? null;
const mo2Root = process.env.XFS_RESOLVER_MO2_ROOT ?? (settings?.launchRoute === "mo2" ? settings.mo2Root : null);
const profile = process.env.XFS_RESOLVER_MO2_PROFILE ?? (settings?.launchRoute === "mo2" ? settings.mo2ProfileId : null);
if (!gameRoot) { console.error("Set the game folder in the Studio's setup (or the XFS_RESOLVER_* variables) first."); process.exit(2); }
const cacheDir = resolve(import.meta.dir, "..", "data", "resolver-cache");
const gender = (option("gender") ?? "female") as "female" | "male";

const started = performance.now();
// Native first, as the hosts read (XFS_NATIVE_READER=0: WolvenKit alone, for comparisons).
const native = await openNativeRoute(gameRoot);
const installation = openInstallation({ gameRoot, launchRoute: mo2Root ? "mo2" : "direct", mo2Root, mo2ProfileId: profile, wolvenKitCli: cli, cacheDir, native,
  log: message => console.error(`[catalogue] ${message}`) });
const opened = performance.now();
const load = await loadCreatorCatalogue({ installation, gameRoot, cacheDir, language: option("language"),
  log: message => console.error(`[catalogue] ${message}`) }, gender);
const built = performance.now();
native.decoder?.close();
const { catalogue, evidence } = load;
const out = resolve(option("out") ?? resolve(cacheDir, "reports", `cc-catalogue-${gender}.json`));
await Bun.write(out, JSON.stringify({ evidence, catalogue }, null, 1));

const labelSources = new Map<string, number>();
for (const item of catalogue.options.filter(o => userFacing(o))) labelSources.set(item.label.source, (labelSources.get(item.label.source) ?? 0) + 1);
const choiceSources = new Map<string, number>();
for (const item of catalogue.options.filter(o => userFacing(o))) for (const choice of item.choices)
  choiceSources.set(choice.label.source, (choiceSources.get(choice.label.source) ?? 0) + 1);
console.log(`${gender} catalogue in ${((built - started) / 1000).toFixed(1)} s (route open ${((opened - started) / 1000).toFixed(1)} s, catalogue ${((built - opened) / 1000).toFixed(1)} s); ` +
  `WolvenKit launches ${installation.fetcher.stats.cliCalls}; native reads ${installation.fetcher.nativeStats?.native ?? "off"}, fallbacks ${installation.fetcher.nativeStats?.fallback ?? "-"}; language ${evidence.language.code} (${evidence.language.from}); TweakDB ${evidence.tweakDb}`);
console.log(`texts: ${evidence.texts.map(t => `${t.kind}:${t.entries}${t.archive ? "" : " MISSING"}`).join(", ")}`);
console.log(`options ${catalogue.counts.options} (user-facing ${catalogue.counts.userFacing}), choices ${catalogue.counts.choices}; ` +
  `mod options ${catalogue.counts.modOptions}, mod choices ${catalogue.counts.modChoices} (${catalogue.counts.modChoicesOnVanillaOptions} on vanilla options); ${evidence.customResources} custom resources`);
console.log(`option labels by source: ${JSON.stringify(Object.fromEntries(labelSources))}; choice labels: ${JSON.stringify(Object.fromEntries(choiceSources))}`);
// Preview coverage is the preview's projection of the catalogue, not stored in it (CORE-60).
const coverage = catalogueCoverage(catalogue);
const coverageCounts = { rendered: 0, conditional: 0, "not-rendered": 0 };
for (const item of catalogue.options.filter(o => userFacing(o))) coverageCounts[coverage.get(item.id)!.status]++;
console.log(`preview coverage of user-facing options: ${JSON.stringify(coverageCounts)}`);
for (const section of catalogue.sections) {
  console.log(`\n[${section.order}] ${section.label.text} (${section.id}, ${section.source}): ${section.rows.length} rows, ${catalogue.counts.perSection[section.id]} options`);
  for (const row of section.rows) {
    const first = catalogue.options.find(o => o.id === row.options[0])!, render = coverage.get(first.id)!;
    const mods = row.options.filter(id => catalogue.options.find(o => o.id === id)!.provenance.kind === "mod").length;
    console.log(`   ${String(row.order).padStart(5)} ${row.part}/${row.slot}: "${first.label.text}" [${first.type}, ${first.label.source}] ${row.options.length} option(s)${mods ? ` (${mods} from mods)` : ""}; ` +
      `${first.choices.length} choices; preview: ${render.status}${render.detail ? ` (${render.detail})` : ""}`);
  }
}
console.log(`\ngaps (${catalogue.gaps.length}): ${catalogue.gaps.slice(0, 12).map(g => `${g.code} ${g.subject}`).join("; ")}`);
console.error(`[catalogue] report ${out}`);
