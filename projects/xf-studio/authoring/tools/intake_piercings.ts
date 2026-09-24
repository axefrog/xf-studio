// Run after extracting the current game's female_cco, piercing .app/base mesh
// resources, 48 linked .mi files, 16 .mlsetup files and 15 referenced
// .mltemplate files, and exporting the four female morph meshes. The material
// files live under a separate ignored root (optional third argument).
// Generated geometry and manifest remain ignored local assets.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parsePiercingManifest, type PiercingManifest } from "../src/piercing-preview";
import { piercingPaletteColor } from "../src/piercing-palette";

const source = resolve(process.argv[2] ?? resolve(import.meta.dir, "../../../../research/consumers/vanilla-piercings/raw"));
const exports = resolve(process.argv[3] ?? resolve(import.meta.dir, "../../../../research/consumers/vanilla-piercings/export"));
const materials = resolve(process.argv[4] ?? resolve(import.meta.dir, "../../../../research/consumers/vanilla-piercing-materials/raw"));
const output = resolve(import.meta.dir, "../public/assets/piercings");
const root = (relative: string) => resolve(source, ...(relative.startsWith("base\\") ? relative : `base\\${relative}`).split("\\"));
const ccoPath = root("gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization.json");
const parse = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const unwrap = (v: any): string => v?.$value;
const materialRoot = (depot: string) => resolve(materials, ...depot.split("\\"));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fnv64 = (path: string) => {
  let value = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(path.toLowerCase())) {
    value ^= BigInt(byte);
    value = (value * 1099511628211n) & 18446744073709551615n;
  }
  return value.toString();
};
const ccoDocument = parse(ccoPath), cco = ccoDocument.Data.RootChunk;
const gameVersion = ccoDocument.Header.GameVersion;
if (!Number.isSafeInteger(gameVersion) || gameVersion < 2000) throw Error("Unknown game-resource version");
const materialEvidence = new Map<string, string>();
const materialCache = new Map<string, string>();
const materialDocument = (depot: string) => {
  if (!/^base\\[a-z0-9_\\]+\.(mesh|mi|mlsetup|mltemplate)$/i.test(depot))
    throw Error(`Invalid piercing material path ${depot}`);
  const path = depot.endsWith(".mesh") ? root(`${depot}.json`) : materialRoot(`${depot}.json`);
  const bytes = readFileSync(path), document = JSON.parse(bytes.toString());
  if (document.Header.GameVersion !== gameVersion) throw Error(`Mismatched material version: ${depot}`);
  materialEvidence.set(depot, sha256(bytes));
  return document.Data.RootChunk;
};
const previewColor = (meshId: string, appearance: string): string => {
  const key = `${meshId}:${appearance}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const suffix = /^i1_000_pwa__morphs_earring_(0[1-4])$/.exec(meshId)?.[1];
  if (!suffix) throw Error(`Unexpected piercing mesh ${meshId}`);
  const mesh = materialDocument(`base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\i1_000_pwa_c__basehead_earring_${suffix}.mesh`);
  const entries = mesh.materialEntries.filter((entry: any) => entry.isLocalInstance === 1 &&
    unwrap(entry.name)?.startsWith(`${appearance}__`));
  if (!entries.length) throw Error(`${meshId} lacks material ${appearance}`);
  const depots = [...new Set(entries.map((entry: any) =>
    unwrap(mesh.localMaterialBuffer.materials[entry.index]?.baseMaterial?.DepotPath)))];
  if (depots.length !== 1 || typeof depots[0] !== "string" || !depots[0].endsWith(".mi"))
    throw Error(`${meshId} has ambiguous material ${appearance}`);
  const instance = materialDocument(depots[0]);
  if (unwrap(instance.baseMaterial?.DepotPath) !== "engine\\materials\\multilayered.mt")
    throw Error(`Unexpected piercing shader ${depots[0]}`);
  const values = Array.isArray(instance.values) ? instance.values : [instance.values];
  const setups = values.map((value: any) => unwrap(value?.MultilayerSetup?.DepotPath)).filter(Boolean);
  if (setups.length !== 1) throw Error(`Missing or ambiguous multilayer setup for ${depots[0]}`);
  const setup = materialDocument(setups[0]);
  const layers = setup.layers.filter((layer: any) => layer.opacity > 0).map((layer: any) => {
    const template = materialDocument(unwrap(layer.material?.DepotPath));
    const colour = template.overrides?.colorScale?.find((entry: any) => unwrap(entry.n) === unwrap(layer.colorScale));
    if (!colour) throw Error(`Unresolved piercing palette ${unwrap(layer.colorScale)}`);
    return { rgb: colour.v.Elements as number[], opacity: layer.opacity as number };
  });
  const color = piercingPaletteColor(layers);
  materialCache.set(key, color);
  return color;
};
const options = cco.headCustomizationOptions.map((o: any) => o.Data);
const switcher = options.find((o: any) => unwrap(o.name) === "piercings" && o.$type === "gameuiSwitcherInfo");
if (!switcher) throw Error("Current female customization has no piercing switcher");
const appEvidence: { path: string; sha256: string }[] = [];
const meshNames = new Set<string>();
const styles = switcher.options.flatMap((switchChoice: any) => {
  const name = unwrap(switchChoice.names?.[0]);
  if (name === "piercings_00") return [];
  const option = options.find((o: any) => unwrap(o.name) === name && o.$type === "gameuiAppearanceInfo");
  if (!option || !Array.isArray(option.definitions) || !option.definitions.length)
    throw Error(`Missing piercing appearance option ${name}`);
  const depot = unwrap(option.resource?.DepotPath);
  if (!depot || !/^base\\characters\\head\\player_base_heads\\appearances\\head\\piercings\\i0_000__earring_\d\d\.app$/i.test(depot))
    throw Error(`Unsupported vanilla piercing resource for ${name}`);
  const appPath = root(`${depot}.json`), appBytes = readFileSync(appPath), appDocument = JSON.parse(appBytes.toString());
  if (appDocument.Header.GameVersion !== gameVersion) throw Error(`Mismatched game-resource version: ${depot}`);
  const app = appDocument.Data.RootChunk;
  appEvidence.push({ path: depot, sha256: sha256(appBytes) });
  const choices = option.definitions.map((definition: any) => {
    const value = unwrap(definition.name);
    const appearance = app.appearances.find((a: any) => unwrap(a.Data.name) === value)?.Data;
    if (!appearance) throw Error(`${depot} lacks definition ${value}`);
    const sourceColors: string[] = [];
    const parts = appearance.partsOverrides.flatMap((part: any) => part.componentsOverrides.map((component: any) => {
      const id = unwrap(component.componentName);
      const compiled = appearance.compiledData.Data.Chunks.find((c: any) => unwrap(c.name) === id);
      const morph = unwrap(compiled?.morphResource?.DepotPath);
      const filename = morph && basename(morph.replaceAll("\\", "/"));
      if (!filename || !/^i1_000_pwa__morphs_earring_0[1-4]\.morphtarget$/.test(filename))
        throw Error(`Unsupported female piercing component ${id}`);
      const mesh = filename.slice(0, -".morphtarget".length);
      sourceColors.push(previewColor(mesh, unwrap(component.meshAppearance)));
      meshNames.add(mesh);
      return { mesh, mask: component.chunkMask as string };
    }));
    if (new Set(sourceColors).size !== 1) throw Error(`${value} uses distinct component palettes; add per-part preview colours`);
    const color = definition.color;
    const hex = (n: number) => Number(n).toString(16).padStart(2, "0");
    const swatch = `#${hex(color.Red)}${hex(color.Green)}${hex(color.Blue)}`;
    const label = (unwrap(definition.icon) ?? value).split(".").at(-1)?.replace(/^Piercing_/, "").replaceAll("_", " ") ?? value;
    // The first seven creator swatches are useful approximations. Choices 8–16
    // have black placeholder swatches; their tint comes from the source palette.
    return { definition: value, index: definition.index as number, label, swatch,
      previewColor: swatch === "#000000" ? sourceColors[0]! : swatch, parts };
  });
  return [{ id: name, index: switchChoice.index as number, label: `Piercing ${String(switchChoice.index).padStart(2, "0")}`,
    resourceHash: fnv64(depot), choices }];
});
if (!styles.length || styles.length > 32 || !meshNames.size || meshNames.size > 8)
  throw Error("Piercing catalog exceeds intake bounds");
mkdirSync(output, { recursive: true });
const assets = [...meshNames].sort().map(id => {
  const file = `${id}.morphtarget.glb`, data = readFileSync(resolve(exports, file));
  if (data.toString("ascii", 0, 4) !== "glTF") throw Error(`Invalid GLB ${file}`);
  const json = JSON.parse(data.toString("utf8", 20, 20 + data.readUInt32LE(12)));
  if (!json.skins?.length || json.meshes?.some((mesh: any) => mesh.primitives.some((p: any) =>
    p.attributes.JOINTS_0 === undefined || p.attributes.WEIGHTS_0 === undefined ||
    (p.attributes.JOINTS_1 === undefined) !== (p.attributes.WEIGHTS_1 === undefined))))
    throw Error(`${file} lacks complete skin weight sets`);
  copyFileSync(resolve(exports, file), resolve(output, `${id}.glb`));
  return { id, url: `/assets/piercings/${id}.glb`, sha256: sha256(data) };
});
const manifest: PiercingManifest = { schema: "xfs/local-vanilla-piercings-2",
  source: `Cyberpunk 2077 ${Number(gameVersion / 1000).toFixed(2)} female customization and basegame_4_appearance`, assets, styles };
parsePiercingManifest(manifest);
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "../evidence/vanilla-piercing-intake.json"), JSON.stringify({
  source: manifest.source, ccoSha256: sha256(readFileSync(ccoPath)), apps: appEvidence,
  materialResources: [...materialEvidence].map(([path, sha256]) => ({ path, sha256 })),
  assetDigests: assets, styleCount: styles.length, definitionCount: styles.reduce((n, s) => n + s.choices.length, 0),
  note: "Local game-derived geometry and serialized resources are excluded from Git; installed mod precedence and runtime rendering are unverified.",
}, null, 2) + "\n");
console.log(`Prepared ${styles.length} vanilla piercing styles, ${assets.length} morph meshes`);
