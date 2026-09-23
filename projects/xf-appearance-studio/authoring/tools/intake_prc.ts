// Private, bounded PRC intake. Extract the enabled framework .app and the
// fpm72 item archive first; no third-party resource is checked into Git.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parsePiercingManifest, type PiercingManifest } from "../src/piercing-preview";

const root = resolve(import.meta.dir, "../../../../research/consumers/prc-preview");
const output = resolve(import.meta.dir, "../public/assets/prc");
const appDepot = "base\\characters\\head\\player_base_heads\\appearances\\head\\piercings\\i0_000__earring_14.app";
const morphDepot = "eagul\\piercingmorphs\\female\\fpm72.morphtarget";
const appPath = resolve(root, "raw/framework", ...appDepot.split("\\"));
const morphPath = resolve(root, "raw/rings72", ...morphDepot.split("\\"));
const glbPath = resolve(root, "export/fpm72.morphtarget.glb");
const unwrap = (v: any): string => v?.$value;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fnv64 = (path: string) => {
  let value = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(path.toLowerCase())) {
    value ^= BigInt(byte);
    value = (value * 1099511628211n) & 18446744073709551615n;
  }
  return value.toString();
};
const appBytes = readFileSync(appPath), morphBytes = readFileSync(morphPath), glbBytes = readFileSync(glbPath);
const appJson = readFileSync(`${appPath}.json`), morphJson = readFileSync(`${morphPath}.json`);
const pinned = {
  app: "01d4cf980d5531a76fd7424555356103979f48a4d4a60e297ba67074529abe13",
  appJson: "3c35aa9cb66bdaf8b318bd34e561fa1b5f24cda2b674eb9039ae53e3f8674294",
  morph: "d7b5238fd9cd4990fb9b3f4a53fa8148b0ae7b9fc60c9fe8f16b4b576008fc32",
  morphJson: "b263db5118d676f1d3c58a3c936f50400fab630d014cdae6538b034abe5e0062",
  glb: "b243873de5c4d5ed07198c61174b53a401a9eaa752af384a43cbb1a0738c6d2a",
};
if (digest(appBytes) !== pinned.app || digest(appJson) !== pinned.appJson ||
  digest(morphBytes) !== pinned.morph || digest(morphJson) !== pinned.morphJson || digest(glbBytes) !== pinned.glb)
  throw Error("PRC source bytes changed; audit the archive/version and regenerate this intake fixture");
const app = JSON.parse(appJson.toString()), morph = JSON.parse(morphJson.toString());
if (app.Header.GameVersion !== morph.Header.GameVersion || app.Header.GameVersion !== 2310)
  throw Error("PRC resources do not match inspected game 2.31");
if (unwrap(morph.Data.RootChunk.baseMesh.DepotPath) !==
  "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\i1_000_pwa_c__basehead_earring_03.mesh")
  throw Error("PRC fpm72 base mesh changed");
const appearance = app.Data.RootChunk.appearances
  .map((a: any) => a.Data)
  .find((a: any) => unwrap(a.name) === "i0_000_pwa__earring__01_silver");
if (!appearance) throw Error("PRC framework lacks the female silver appearance");
const component = appearance.compiledData.Data.Chunks.find((c: any) => unwrap(c.name) === "fpm72");
// PRC's 128 extra components live directly in compiledData, unlike the
// vanilla three-part piercings that carry a per-part appearance override.
if (!component || unwrap(component.morphResource.DepotPath) !== fnv64(morphDepot) ||
  unwrap(component.meshAppearance) !== "silver" || component.chunkMask !== "9223372036854775807")
  throw Error("PRC fpm72 component does not match the selected item");
if (glbBytes.toString("ascii", 0, 4) !== "glTF" || glbBytes.byteLength > 4 * 1024 * 1024)
  throw Error("PRC GLB missing or exceeds private preview budget");
const glb = JSON.parse(glbBytes.toString("utf8", 20, 20 + glbBytes.readUInt32LE(12)));
if (glb.meshes?.length !== 1 || glb.skins?.length !== 1 || !glb.skins[0].joints?.length ||
  glb.meshes[0].primitives?.length !== 1 ||
  !/submesh_00_LOD_\d+/.test(glb.meshes[0].name) ||
  glb.meshes[0].primitives[0].attributes.JOINTS_0 === undefined ||
  glb.meshes[0].primitives[0].attributes.WEIGHTS_0 === undefined ||
  glb.meshes[0].primitives[0].attributes.JOINTS_1 === undefined ||
  glb.meshes[0].primitives[0].attributes.WEIGHTS_1 === undefined ||
  !glb.meshes[0].primitives[0].targets?.length)
  throw Error("PRC fpm72 lacks the expected skinned and morphed geometry");
const manifest: PiercingManifest = {
  schema: "xfs/local-prc-piercings-1",
  source: "MO2 2025 (again): eagul PRC v1.1 plus enabled front nostril item; offline source expectation",
  assets: [{ id: "prc_fpm72", url: "/assets/prc/prc_fpm72.glb", sha256: digest(glbBytes) }],
  styles: [{ id: "prc_fpm72", index: 72, label: "PRC · front nostril ring (slot 72)",
    resourceHash: fnv64(appDepot), choices: [{ definition: "i0_000_pwa__earring__01_silver",
      index: 1, label: "Silver (approx.)", swatch: "#d6d5d3",
      parts: [{ mesh: "prc_fpm72", mask: component.chunkMask }] }] }],
};
parsePiercingManifest(manifest);
mkdirSync(output, { recursive: true });
copyFileSync(glbPath, resolve(output, "prc_fpm72.glb"));
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "../evidence/prc-piercing-intake.json"), JSON.stringify({
  source: manifest.source, appDepot, appSha256: digest(appBytes), appJsonSha256: digest(appJson), morphDepot,
  morphSha256: digest(morphBytes), morphJsonSha256: digest(morphJson), exportedGlbSha256: digest(glbBytes),
  definition: manifest.styles[0].choices[0].definition, chunkMask: component.chunkMask,
  status: "One local skinned slot preview; material and effective runtime archive order unverified. Not redistributable.",
}, null, 2) + "\n");
console.log("Prepared one private PRC style: slot 72");
