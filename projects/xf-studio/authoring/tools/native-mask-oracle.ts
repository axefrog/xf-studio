/**
 * Oracle for XF Studio's layer mask reader (src/native/mlmask.ts) against WolvenKit's exports (R&D; read-only towards the game, MO2 and
 * the caches): every `.mlmask` WolvenKit exported into an export cache (`<cache>/<hash>-<source>/entry.json` with `layer-<i>.png`) is
 * read natively from the exact archive it was exported from (the entry's source fingerprint), its layers rebuilt, and each layer compared
 * with WolvenKit's PNG texel for texel (its red channel; WolvenKit writes grey RGBA). Offline evidence, not game evidence.
 *
 *   bun tools/native-mask-oracle.ts (--game <folder> [--mods <MO2 mods folder>] | --route) --cache <export cache resources folder> [--cache ...]
 *
 * `--route` takes the archives the installed settings' launch route mounts (its mount plan) instead of a folder walk.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { archiveExportSource } from "../src/game-asset-export";
import { NativeArchivePool } from "../src/native/archive-reader";
import { readCr2w } from "../src/native/cr2w-reader";
import { DecodeSession } from "../src/native/limits";
import { decodeMaskLayers, maskLayout } from "../src/native/mlmask";
import { loadGameOodle } from "../src/native/oodle";
import { TEXTURE_READ_LIMITS } from "../src/native/texture-decode";
import { decodePng } from "../src/png";
import { LocalSettingsStore } from "../src/local-settings-store";
import { openInstallation } from "../src/resolver-host";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const many = (name: string) => args.flatMap((arg, i) => arg === `--${name}` ? [args[i + 1]!] : []);
const route = args.includes("--route") ? new LocalSettingsStore().load().settings : null;
const game = option("game") ?? route?.gameRoot ?? undefined, mods = option("mods"), caches = many("cache");
if (!game || !caches.length) { console.error("usage: bun tools/native-mask-oracle.ts --game <folder> [--mods <MO2 mods>] --cache <folder> [--cache ...]"); process.exit(2); }

const archives: string[] = [];
const addDir = (dir: string) => { if (existsSync(dir)) for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".archive")) archives.push(join(dir, name)); };
for (const group of ["content", "ep1", "mod"]) addDir(join(game, "archive", "pc", group));
addDir(join(game, "red4ext", "plugins", "ArchiveXL", "Bundle"));
if (mods && existsSync(mods)) for (const mod of readdirSync(mods)) addDir(join(mods, mod, "archive", "pc", "mod"));
if (route) {
  archives.length = 0;
  const installation = openInstallation({ gameRoot: game, launchRoute: route.launchRoute, mo2Root: route.mo2Root, mo2ProfileId: route.mo2ProfileId,
    manualModRoot: route.manualModRoot, wolvenKitCli: null, cacheDir: join(tmpdir(), "xfs-mask-oracle-index") });
  archives.push(...installation.plan.archives.map(archive => archive.id));
}
const oodle = loadGameOodle(game);
const pool = new NativeArchivePool(oodle.decompress);
/** The archives that list a hash (the entry's source names the archive only through WolvenKit's identity, so every holder is tried). */
const holders = (hash: string) => archives.filter(path => { try { return pool.get(path).has(hash); } catch { return false; } });
let masks = 0, equal = 0, flippedEqual = 0;
for (const cache of caches) for (const name of readdirSync(cache)) {
  const dir = join(cache, name);
  if (!existsSync(join(dir, "layer-0.png")) || !existsSync(join(dir, "entry.json"))) continue;
  const entry = JSON.parse(readFileSync(join(dir, "entry.json"), "utf8")) as { depotPath: string; source: string };
  const found = holders(depotHash(entry.depotPath));
  const label = `${entry.depotPath.split("\\").pop()}`;
  if (!found.length) { console.log(`skip ${label} (no archive lists it)`); continue; }
  masks++;
  let layers: ReturnType<typeof decodeMaskLayers> | undefined, ms = 0, from = "";
  const tries: { archive: string; layers: ReturnType<typeof decodeMaskLayers> }[] = [];
  for (const archive of found) {
    const started = performance.now();
    try {
      const bytes = pool.read(archive, depotHash(entry.depotPath))!;
      tries.push({ archive, layers: decodeMaskLayers(maskLayout(readCr2w(bytes, oodle.decompress, new DecodeSession(TEXTURE_READ_LIMITS)))) });
      ms = performance.now() - started;
    } catch (error) { console.log(`refused ${label} in ${archive.split(/[\\/]/).pop()}: ${(error as Error).message}`); }
  }
  if (!tries.length) continue;
  const theirs = readdirSync(dir).filter(file => /^layer-\d+\.png$/.test(file)).length;
  let report: string[] = [], same = false, flipSame = false;
  for (const attempt of tries) {
    layers = attempt.layers; from = attempt.archive.split(/[\\/]/).pop()!;
    report = []; same = theirs === layers.length; flipSame = same;
    layers.forEach((layer, i) => {
      const file = join(dir, `layer-${i}.png`);
      if (!existsSync(file)) { report.push(`layer ${i}: no PNG`); same = flipSame = false; return; }
      const png = decodePng(new Uint8Array(readFileSync(file)));
      if (png.width !== layer.width || png.height !== layer.height) { report.push(`layer ${i}: ${layer.width}x${layer.height} against ${png.width}x${png.height}`); same = flipSame = false; return; }
      let differ = 0, differFlipped = 0, worst = 0;
      for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) {
        const mine = layer.pixels[y * layer.width + x]!, red = png.data[(y * png.width + x) * 4]!, redFlipped = png.data[((png.height - 1 - y) * png.width + x) * 4]!;
        if (mine !== red) { differ++; worst = Math.max(worst, Math.abs(mine - red)); }
        if (mine !== redFlipped) differFlipped++;
      }
      if (differ) { same = false; report.push(`layer ${i}: ${differ} texels differ (worst ${worst}), flipped ${differFlipped}`); }
      if (differFlipped) flipSame = false;
    });
    if (same || flipSame) break;
  }
  if (same) equal++;
  if (flipSame) flippedEqual++;
  console.log(`${same ? "equal" : flipSame ? "equal flipped" : "DIFFERENT"} ${label} (${from}): ${layers!.length} layers (WolvenKit ${theirs}), ${layers!.map(l => `${l.width}`).join("/")}, ${ms.toFixed(1)} ms${report.length ? `\n  ${report.slice(0, 6).join("\n  ")}` : ""}`);
}
console.log(`${masks} mask(s): ${equal} equal as stored, ${flippedEqual} equal flipped`);
