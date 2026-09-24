// Private PRC intake from explicitly selected, extracted MO2 archive candidates.
// The linked .mesh for slots 50/74 must be present in the local source set;
// game-only morph exports silently lose their skin. No payload is tracked.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { aggregatePrcStyle, parsePiercingManifest, type PiercingManifest } from "../src/piercing-preview";

const root = resolve(import.meta.dir, "../../../../research/consumers/prc-preview");
const output = resolve(import.meta.dir, "../public/assets/prc");
const appDepot = "base\\characters\\head\\player_base_heads\\appearances\\head\\piercings\\i0_000__earring_14.app";
const appPath = resolve(root, "raw/framework", ...appDepot.split("\\"));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pinnedRead = (path: string, expected: string) => {
  const bytes = readFileSync(path);
  if (digest(bytes) !== expected) throw Error(`PRC source changed: ${path}`);
  return bytes;
};
const unwrap = (v: any): string => v?.$value;
const fnv64 = (path: string) => {
  let value = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(path.toLowerCase())) {
    value ^= BigInt(byte);
    value = (value * 1099511628211n) & 18446744073709551615n;
  }
  return value.toString();
};

const appBytes = pinnedRead(appPath, "01d4cf980d5531a76fd7424555356103979f48a4d4a60e297ba67074529abe13");
const appJsonBytes = pinnedRead(`${appPath}.json`, "3c35aa9cb66bdaf8b318bd34e561fa1b5f24cda2b674eb9039ae53e3f8674294");
const app = JSON.parse(appJsonBytes.toString());
if (app.Header.GameVersion !== 2310) throw Error("PRC framework is not the inspected 2.31 source");
const vanillaPath = resolve(import.meta.dir, "../public/assets/piercings/manifest.json");
const vanillaBytes = readFileSync(vanillaPath);
const vanilla = parsePiercingManifest(JSON.parse(vanillaBytes.toString()));
if (vanilla.schema !== "xfs/local-vanilla-piercings-2") throw Error("Missing current vanilla colour reference");
const reference = vanilla.styles.find(s => s.id === "piercings_12" && s.resourceHash === fnv64(appDepot));
if (!reference || reference.choices.length !== 16) throw Error("Missing option-12 colour reference");
const silverPreview = reference.choices.find(c => c.definition.endsWith("__01_silver"))?.previewColor;
if (!silverPreview) throw Error("Missing silver colour reference for the fixed stud chunk");
// The stud's second chunk is always default__02. Its installed candidate .mi
// links a game silver multilayer setup, independently of the framework colour.
const studMiDepot = "base\\eagul\\mat_1.mi";
const studMiPath = resolve(root, "raw/silver", ...studMiDepot.split("\\"));
const studMiBytes = pinnedRead(studMiPath, "4a80b70f8b5391ce0ff317cef1012118c74a46ccf799d481df69fb8f41920d80");
const studMi = JSON.parse(pinnedRead(`${studMiPath}.json`, "22b4f3a8ee29a19655777fe55295f728b3532add17b6460eaebd898bb6056349").toString());
const silverSetupDepot = "base\\characters\\common\\character_customisation_items\\earrings\\textures\\i1_000_pma_c__basehead_earring_01_silver.mlsetup";
const silverMaskDepot = "base\\characters\\common\\character_customisation_items\\earrings\\textures\\i1_000_pma_c__basehead_earring_01.mlmask";
if (unwrap(studMi.Data.RootChunk.baseMaterial.DepotPath) !== "engine\\materials\\multilayered.mt" ||
  unwrap(studMi.Data.RootChunk.values.find((v: any) => v.$type === "rRef:Multilayer_Setup")?.MultilayerSetup?.DepotPath) !== silverSetupDepot ||
  unwrap(studMi.Data.RootChunk.values.find((v: any) => v.$type === "rRef:Multilayer_Mask")?.MultilayerMask?.DepotPath) !== silverMaskDepot)
  throw Error("PRC stud second-chunk material chain changed");
const gameMaterialRoot = resolve(import.meta.dir, "../../../../research/consumers/prc-stud-material/raw");
const setupPath = resolve(gameMaterialRoot, ...silverSetupDepot.split("\\"));
const maskPath = resolve(gameMaterialRoot, ...silverMaskDepot.split("\\"));
const setupBytes = pinnedRead(setupPath, "9fa81fa675862cc29d9df59905a7c795b3e0805d36930e4222e11a9841ac6cb1");
const setup = JSON.parse(pinnedRead(`${setupPath}.json`, "abaa96721ef4db53da364552ccd9c16cba1e35e970d4d70a55409b514636eb7d").toString());
const maskBytes = pinnedRead(maskPath, "970713a741875f4c8d20054e85225673b31295cbfe68dd6424cb5ab12b5b0cd4");
const mask = JSON.parse(pinnedRead(`${maskPath}.json`, "5c762796b88c6ff7151aaa0266745a0155156c8256b9eeb8438305a14fbcba86").toString());
const setupLayers = setup.Data.RootChunk.layers;
if (setupLayers.length !== 3 ||
  unwrap(setupLayers[0].material.DepotPath) !== "base\\surfaces\\materials\\metal\\silver\\silver_brushed_01_300.mltemplate" ||
  setupLayers[0].opacity !== 1 || setupLayers[1].opacity !== 0 ||
  Math.abs(setupLayers[2].opacity - .07) > 1e-6 ||
  mask.Data.RootChunk.$type !== "Multilayer_Mask")
  throw Error("PRC stud silver multilayer source changed");
const femaleAppearances = app.Data.RootChunk.appearances.map((a: any) => a.Data)
  .filter((a: any) => unwrap(a.name)?.startsWith("i0_000_pwa__earring__"));
if (femaleAppearances.length !== 16) throw Error("Unexpected PRC female colour bank");
const appearances = new Map<string, any>(femaleAppearances.map((a: any) => [unwrap(a.name), a]));
for (const colour of reference.choices) {
  const chunks = appearances.get(colour.definition)?.compiledData?.Data?.Chunks;
  if (!Array.isArray(chunks) || chunks.length !== 128 ||
    chunks.some((c: any, i: number) => unwrap(c.name) !== `fpm${i + 1}`))
    throw Error(`Incomplete PRC slot bank in ${colour.definition}`);
}
if (appearances.size !== 16) throw Error("Duplicate PRC female appearance");

const slots = [
  {
    index: 50, folder: "stud", label: "PRC · inspect nose stud (slot 50)",
    archiveSha: "982c70c5eba41ca7072c4d40d1ea8b0f116a700f615c0650282d9108e0945c50",
    morphSha: "42b4c7e82f7e4fbf3500d2f79e7c1f6ac89eeda773d4bfbc2137c08ce707374f",
    morphJsonSha: "71f76d67c23e76604558ded8e98b82dd8c9018856ef4c60dd3acb642398c5bd1",
    baseDepot: "eagul\\piercingmorphs\\female\\fpm50_linked.mesh",
    baseFolder: "stud", baseSha: "7b61b2688aebb55356e3f08341bb7e6158eb92a02fdc40cb48c9d121750fc2b1",
    baseJsonSha: "a95e5680869e9f237aa7311d919f3a152e10248177fc1240a8df0f087209c142",
    glbSha: "1287c387b61da88bb7248d495c9958c18aab65bd2a53cd0d1ce7508183fa0f10",
    meshes: 2, bones: 6, targets: 21,
  },
  {
    index: 72, folder: "rings72", label: "PRC · inspect front nostril ring (slot 72)",
    archiveSha: "0fd967c071ca5c5c77ce9911accaf426ebe8c896dd72324326e6fc72e87b4cc5",
    morphSha: "d7b5238fd9cd4990fb9b3f4a53fa8148b0ae7b9fc60c9fe8f16b4b576008fc32",
    morphJsonSha: "b263db5118d676f1d3c58a3c936f50400fab630d014cdae6538b034abe5e0062",
    baseDepot: "base\\characters\\head\\player_base_heads\\player_female_average\\h0_000_pwa_c__basehead\\i1_000_pwa_c__basehead_earring_03.mesh",
    baseFolder: "", baseSha: "", baseJsonSha: "",
    glbSha: "b243873de5c4d5ed07198c61174b53a401a9eaa752af384a43cbb1a0738c6d2a",
    meshes: 1, bones: 6, targets: 21,
  },
  {
    index: 74, folder: "rings74", label: "PRC · inspect front nostril ring (slot 74)",
    archiveSha: "8a412861555b0cf6695bb7f6dd05175203851a4cb92dde830f5534062cd0a355",
    morphSha: "6908833655c4b99ab60eca15331bccdc7d24b6c76ec687b43410a04a2973c40e",
    morphJsonSha: "c1249dc8a90f1a23865d1b6a7ddded3287c83b4ed884f48d1cfee96b19ae7039",
    baseDepot: "eagul\\piercingmorphs\\wa_linked.mesh",
    baseFolder: "framework", baseSha: "f166cc07958fdd2288d3746a40b971d700c4615a87f76126d85314a546034bf6",
    baseJsonSha: "33ef1c739a9fd867e0bd71ce30ad88ed0ac5570fd3faecb2d3c3f03e302d7c5a",
    glbSha: "e34cbff636f5d2bb03f78477f488b48d6a1f3b6d08e2a73565916902580cd246",
    meshes: 1, bones: 254, targets: 105,
  },
] as const;

const evidence = [];
const assets: PiercingManifest["assets"] = [];
const styles: PiercingManifest["styles"] = [];
const sharedMaterials = new Map<string, string>();
for (const slot of slots) {
  const name = `fpm${slot.index}`;
  const morphDepot = `eagul\\piercingmorphs\\female\\${name}.morphtarget`;
  const morphPath = resolve(root, `raw/${slot.folder}`, ...morphDepot.split("\\"));
  const glbPath = resolve(root, `export/${name}.morphtarget.glb`);
  const morphBytes = pinnedRead(morphPath, slot.morphSha);
  const morphJsonBytes = pinnedRead(`${morphPath}.json`, slot.morphJsonSha);
  const glbBytes = pinnedRead(glbPath, slot.glbSha);
  const morph = JSON.parse(morphJsonBytes.toString());
  if (morph.Header.GameVersion !== 2310 || unwrap(morph.Data.RootChunk.baseMesh.DepotPath) !== slot.baseDepot)
    throw Error(`PRC ${name} morph/base link changed`);
  if (slot.baseFolder) {
    const basePath = resolve(root, `raw/${slot.baseFolder}`, ...slot.baseDepot.split("\\"));
    pinnedRead(basePath, slot.baseSha);
    const baseJson = JSON.parse(pinnedRead(`${basePath}.json`, slot.baseJsonSha).toString());
    if (baseJson.Header.GameVersion !== 2310 || baseJson.Data.RootChunk.boneNames.length !== slot.bones)
      throw Error(`PRC ${name} linked mesh/rig changed`);
    if (slot.index === 50) {
      const mesh = baseJson.Data.RootChunk;
      const entry = mesh.materialEntries.find((e: any) => unwrap(e.name) === "default__02");
      if (entry?.index !== 3 || unwrap(mesh.localMaterialBuffer.materials[entry.index]?.baseMaterial?.DepotPath) !== studMiDepot ||
        mesh.appearances.some((a: any) => !reference.choices.some(c =>
          unwrap(a.Data.name) === appearances.get(c.definition)?.compiledData?.Data?.Chunks[49]?.meshAppearance?.$value) &&
          unwrap(a.Data.name) !== "default") ||
        mesh.appearances.some((a: any) => unwrap(a.Data.chunkMaterials[1]) !== "default__02"))
        throw Error("PRC stud second mesh chunk no longer resolves the fixed silver material");
    }
  }
  const choices = reference.choices.map(colour => {
    const component = appearances.get(colour.definition).compiledData.Data.Chunks[slot.index - 1];
    const material = unwrap(component.meshAppearance);
    if (unwrap(component.name) !== name || unwrap(component.morphResource.DepotPath) !== fnv64(morphDepot) ||
      !material || component.chunkMask !== "9223372036854775807")
      throw Error(`PRC ${name} framework component changed in ${colour.definition}`);
    const shared = sharedMaterials.get(colour.definition);
    if (shared && shared !== material) throw Error(`PRC slots have differing materials in ${colour.definition}`);
    sharedMaterials.set(colour.definition, material);
    return { definition: colour.definition, index: colour.index,
      label: `${colour.label} (approx.)`, swatch: colour.previewColor,
      previewColor: colour.previewColor,
      parts: [{ mesh: `prc_${name}`, mask: component.chunkMask as string,
        ...(slot.index === 50 ? { chunkColors: [{ index: 1, color: silverPreview }] } : {}) }] };
  });
  if (glbBytes.toString("ascii", 0, 4) !== "glTF" || glbBytes.byteLength > 4 * 1024 * 1024)
    throw Error(`PRC ${name} GLB exceeds private preview budget`);
  const glb = JSON.parse(glbBytes.toString("utf8", 20, 20 + glbBytes.readUInt32LE(12)));
  if (glb.meshes?.length !== slot.meshes || glb.skins?.length !== 1 ||
    glb.skins[0].joints?.length !== slot.bones ||
    glb.meshes.some((mesh: any, i: number) =>
      mesh.name !== `submesh_0${i}_LOD_1` || mesh.primitives?.length !== 1 ||
      mesh.primitives[0].targets?.length !== slot.targets ||
      mesh.primitives[0].attributes.JOINTS_0 === undefined ||
      mesh.primitives[0].attributes.WEIGHTS_0 === undefined ||
      (slot.bones > 6 && (mesh.primitives[0].attributes.JOINTS_1 === undefined ||
        mesh.primitives[0].attributes.WEIGHTS_1 === undefined))))
    throw Error(`PRC ${name} lacks the expected skinned and morphed geometry`);
  const id = `prc_${name}`;
  assets.push({ id, url: `/assets/prc/${id}.glb`, sha256: digest(glbBytes) });
  styles.push({ id, index: slot.index, label: slot.label, resourceHash: fnv64(appDepot),
    choices });
  evidence.push({ slot: slot.index, sourceArchiveSha256: slot.archiveSha,
    morphDepot, morphSha256: digest(morphBytes),
    morphJsonSha256: digest(morphJsonBytes), baseMeshDepot: slot.baseDepot,
    baseMeshSha256: slot.baseSha || "game-archive", exportedGlbSha256: digest(glbBytes),
    baseMeshJsonSha256: slot.baseJsonSha || "game-archive",
    meshes: slot.meshes, bones: slot.bones, morphTargets: slot.targets,
    chunkMask: choices[0]!.parts[0]!.mask });
}
styles.unshift(aggregatePrcStyle(styles));
const manifest: PiercingManifest = {
  schema: "xfs/local-prc-piercings-1",
  source: "MO2 2025 (again): candidate eagul PRC slots 50, 72, 74; shared-colour approximation, not a runtime winner",
  assets, styles,
};
parsePiercingManifest(manifest);
mkdirSync(output, { recursive: true });
for (const asset of assets) {
  const slot = asset.id.slice("prc_fpm".length);
  copyFileSync(resolve(root, `export/fpm${slot}.morphtarget.glb`), resolve(output, `${asset.id}.glb`));
}
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "../evidence/prc-piercing-intake.json"), JSON.stringify({
  source: manifest.source, frameworkArchiveSha256: "6e73610b3cdd85552aeb61f6a5a7c7fd3a9cf0f26b4d4f475977b255c8e17499",
  appDepot, appSha256: digest(appBytes), appJsonSha256: digest(appJsonBytes),
  vanillaOption12ManifestSha256: digest(vanillaBytes),
  studFixedChunk: { chunk: 1, materialDepot: studMiDepot, materialSha256: digest(studMiBytes),
    setupDepot: silverSetupDepot, setupSha256: digest(setupBytes), maskDepot: silverMaskDepot,
    maskSha256: digest(maskBytes), browserColor: silverPreview,
    note: "All inspected fpm50 colour appearances use default__02 on chunk 1. Its candidate material links game silver brushed multilayer setup. Browser colour is an approximation; runtime winner and exact surface response unverified." },
  frameworkColours: reference.choices.map(choice => ({ definition: choice.definition,
    meshAppearance: sharedMaterials.get(choice.definition), previewColor: choice.previewColor })),
  aggregateStyle: styles[0]!.id, definition: styles[0]!.choices[0]!.definition, slots: evidence,
  status: "Three local skinned slots, combined under a shared approximate framework colour or individually inspectable. Stud chunk 1 uses a fixed silver approximation from its installed-candidate source chain; exact REDengine response and runtime archive winners unverified. Not redistributable.",
}, null, 2) + "\n");
console.log("Prepared one aggregate and three diagnostic private PRC styles, each with 16 approximate colours");
