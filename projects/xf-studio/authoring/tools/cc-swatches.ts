/**
 * Work out the Character panel's colour swatches for a real installation, read-only, and print their cost and a sample: how many keys,
 * how long resolving, reading and texture mips took, and a few rows' swatches. The swatches name installed mods' colours, so the full
 * list is written only into the ignored resolver cache.
 *
 *   bun tools/cc-swatches.ts [--gender female|male] [--fresh] [--rows head/hair_color1,head/eyes_color] [--no-wolvenkit]
 *
 * `--fresh` ignores the swatch cache (a cold run of the swatch work; the resolver's own caches stay). The game folder and launch route
 * come from the Studio's saved setup (or XFS_RESOLVER_GAME_ROOT, XFS_RESOLVER_MO2_ROOT, XFS_RESOLVER_MO2_PROFILE).
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { loadCreatorCatalogue } from "../src/cc-catalogue-host";
import { readSwatch, swatchPlan } from "../src/cc-swatch";
import { CreatorSwatches } from "../src/cc-swatch-host";
import { CreatorIcons } from "../src/cc-icon-host";
import { LocalSettingsStore } from "../src/local-settings-store";
import { openInstallation, openNativeRoute } from "../src/resolver-host";

const args = Bun.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? null : null; };
const settings = (() => { try { return new LocalSettingsStore().load().settings; } catch { return null; } })();
const gameRoot = process.env.XFS_RESOLVER_GAME_ROOT ?? settings?.gameRoot;
const mo2Root = process.env.XFS_RESOLVER_MO2_ROOT ?? (settings?.launchRoute === "mo2" ? settings.mo2Root : null);
const profile = process.env.XFS_RESOLVER_MO2_PROFILE ?? (settings?.launchRoute === "mo2" ? settings.mo2ProfileId : null);
if (!gameRoot) { console.error("Set the game folder in the Studio's setup (or the XFS_RESOLVER_* variables) first."); process.exit(2); }
const cacheDir = resolve(import.meta.dir, "..", "data", "resolver-cache");
const gender = (option("gender") ?? "female") as "female" | "male";
const native = await openNativeRoute(gameRoot);
const installation = openInstallation({ gameRoot, launchRoute: mo2Root ? "mo2" : "direct", mo2Root, mo2ProfileId: profile, wolvenKitCli: args.includes("--no-wolvenkit") ? null : process.env.XFS_WOLVENKIT_CLI ?? settings?.wolvenKitCli ?? null, cacheDir, native,
  log: message => console.error(`[swatches] ${message}`) });
const { catalogue } = await loadCreatorCatalogue({ installation, gameRoot, cacheDir, log: () => {} }, gender);
const began = performance.now();
const plan = swatchPlan(catalogue);
const planMs = performance.now() - began;
const rowChoices = [...plan.options.values()].reduce((n, keys) => n + keys.length, 0);
console.log(`plan: ${plan.options.size} colour rows, ${rowChoices} of ${catalogue.counts.choices} choices, ${plan.targets.size} swatch keys in ${plan.families.size} families (${planMs.toFixed(0)} ms)`);
const routeKey = `${gameRoot}\n${mo2Root ?? ""}\n${profile ?? ""}`;
if (args.includes("--fresh")) {
  const probe = new CreatorSwatches(installation, catalogue, { cacheDir, gender, routeKey });
  rmSync((probe as unknown as { file: string }).file, { force: true });
}
const swatches = new CreatorSwatches(installation, catalogue, { cacheDir, gender, routeKey, log: message => console.error(`[swatches] ${message}`) });
const t0 = performance.now();
await swatches.start();
const stats = swatches.progress;
console.log(`swatches: ${stats.done}/${stats.keys} in ${((performance.now() - t0) / 1000).toFixed(1)} s; ${stats.fromCache} from the cache, ${stats.derived} derived; ` +
  `resolve ${(stats.resolveMs / 1000).toFixed(1)} s, reads ${(stats.readMs / 1000).toFixed(1)} s, ${stats.textures} texture mips ${(stats.textureMs / 1000).toFixed(1)} s`);
let withSwatch = 0, replaced = 0, gradients = 0;
for (const [id, keys] of plan.options) keys.forEach((key, position) => {
  const swatch = key ? readSwatch(swatches.swatchOf(id, position) ?? "") : null;
  if (!swatch) return;
  withSwatch++; if (swatch.replaced) replaced++; if (swatch.colors.length > 1) gradients++;
});
console.log(`choices with a swatch: ${withSwatch} of ${rowChoices}; gradients ${gradients}; replaced ${replaced}`);
for (const id of (option("rows") ?? "head/hair_color1,head/eyebrows_color1,head/eyelash_color,head/eyes_color,head/skin_color,head/makeupEyes_01,arms/nails_color").split(",")) {
  const answer = swatches.answer(id);
  if (!answer) { console.log(`${id}: not a colour row`); continue; }
  const row = catalogue.options.find(o => o.id === id)!;
  console.log(`${id}: ${answer.swatches.filter(Boolean).length}/${answer.swatches.length} ` +
    answer.swatches.slice(0, 8).map((s, i) => `${row.choices[i]?.key.split("__").pop()}=${s || "-"}`).join(" "));
}
const icons = new CreatorIcons(installation, catalogue, { cacheDir, log: message => console.error(`[icons] ${message}`) });
const t1 = performance.now();
await icons.start();
console.log(`icons: ${icons.stats.atlases} atlas(es), ${icons.stats.parts} parts in use, ${((performance.now() - t1) / 1000).toFixed(1)} s (${icons.stats.fromCache} sheet(s) from the cache, ${icons.stats.built} made, ${icons.stats.missing} missing)`);
for (const id of ["head/eyes_color", "head/skin_color", "head/hair_color1"]) {
  const answer = icons.answer(id);
  console.log(`${id}: ${answer.icons.filter(Boolean).length}/${answer.icons.length} icons; sheets ${answer.sheets.map(sheet => `${sheet.id} ${sheet.columns}x${sheet.rows} ${sheet.key}`).join(", ")}`);
}
native.decoder?.close();
