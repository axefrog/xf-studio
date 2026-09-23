// Run after extracting the current game's female_cco, piercing .app resources and
// exporting their four female morph meshes. The outputs remain ignored local assets.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parsePiercingManifest, type PiercingManifest } from "../src/piercing-preview";

const source = resolve(process.argv[2] ?? resolve(import.meta.dir, "../../../../research/consumers/vanilla-piercings/raw"));
const exports = resolve(process.argv[3] ?? resolve(import.meta.dir, "../../../../research/consumers/vanilla-piercings/export"));
const output = resolve(import.meta.dir, "../public/assets/piercings");
const root = (relative: string) => resolve(source, ...(relative.startsWith("base\\") ? relative : `base\\${relative}`).split("\\"));
const ccoPath = root("gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization.json");
const parse = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const unwrap = (v: any): string => v?.$value;
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
    const parts = appearance.partsOverrides.flatMap((part: any) => part.componentsOverrides.map((component: any) => {
      const id = unwrap(component.componentName);
      const compiled = appearance.compiledData.Data.Chunks.find((c: any) => unwrap(c.name) === id);
      const morph = unwrap(compiled?.morphResource?.DepotPath);
      const filename = morph && basename(morph.replaceAll("\\", "/"));
      if (!filename || !/^i1_000_pwa__morphs_earring_0[1-4]\.morphtarget$/.test(filename))
        throw Error(`Unsupported female piercing component ${id}`);
      const mesh = filename.slice(0, -".morphtarget".length);
      meshNames.add(mesh);
      return { mesh, mask: component.chunkMask as string };
    }));
    const color = definition.color;
    const hex = (n: number) => Number(n).toString(16).padStart(2, "0");
    const swatch = `#${hex(color.Red)}${hex(color.Green)}${hex(color.Blue)}`;
    const label = (unwrap(definition.icon) ?? value).split(".").at(-1)?.replace(/^Piercing_/, "").replaceAll("_", " ") ?? value;
    return { definition: value, index: definition.index as number, label, swatch, parts };
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
const manifest: PiercingManifest = { schema: "xfs/local-vanilla-piercings-1",
  source: `Cyberpunk 2077 ${Number(gameVersion / 1000).toFixed(2)} female customization and basegame_4_appearance`, assets, styles };
parsePiercingManifest(manifest);
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "../evidence/vanilla-piercing-intake.json"), JSON.stringify({
  source: manifest.source, ccoSha256: sha256(readFileSync(ccoPath)), apps: appEvidence,
  assetDigests: assets, styleCount: styles.length, definitionCount: styles.reduce((n, s) => n + s.choices.length, 0),
  note: "Local game-derived geometry and serialized resources are excluded from Git; installed mod precedence and runtime rendering are unverified.",
}, null, 2) + "\n");
console.log(`Prepared ${styles.length} vanilla piercing styles, ${assets.length} morph meshes`);
