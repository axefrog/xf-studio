// Run after resolving/extracting a local source. Never put game/mod files in Git.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Usage: bun tools/intake_hair.ts [<extracted raw dir>] [--out <asset dir>] [--mi-json <lm_hair__long.mi.json>]
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const outOption = option("--out"), miOption = option("--mi-json");
const source = resolve(args[0] ?? resolve(import.meta.dir, "../../../../research/consumers/saved-v-hair/raw"));
const output = resolve(outOption ?? resolve(import.meta.dir, "../public/assets/hair"));
mkdirSync(output, { recursive: true });
const expected: Record<string, string> = {
  "lm127_hair_pt1.glb": "54d8cfa24b6276426e04fedd2e33ac688a057ee05c6569f00e813bbf8b3201d7",
  "lm097_hair_pt2.glb": "29383e1f186d25666c6b0e006cc860deadb6d2a9641736eb42726b683e0b2517",
  "hair_lm60_a.png": "e77359fef7ac863dc3df3cc3293c57c95fc88e8fad560e90ae259f8e95d52d00",
  "hair_lm60_id.png": "7c4db9f0517cac6baff902e743d73d94cd98d3cdf0dc967126e6ad3d75d18780",
  "hair_lm60_grad.png": "7b3d00a81c741485567a8c89fc54b866fdb8dc61cff10da146a829ec419e25cc",
  "hh_110_wa__wizzy_cap_mask.png": "8137373f101516ffeb25a3771744237e4d746fd17c813afb0fc333fdfc1f73ee",
  "hh_cap_grad__ash_brown.png": "388ac349d09372bfbe78c90944615a3f962b160d44b56207f7d865e5eb57f70c",
  "ash_brown.hp": "c2d53c6216104329ccc522cafe7e3d2dd2021d053bf63d6f7207c42bcf798b9a",
};
const names = Object.keys(expected).filter(name => name.endsWith(".png") || name.endsWith(".glb"));
const files = names.map(name => {
  const bytes = readFileSync(resolve(source, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected[name]) throw Error(`Unexpected source bytes: ${name}`);
  if (name.endsWith(".glb")) {
    if (bytes.toString("ascii", 0, 4) !== "glTF") throw Error(`Invalid GLB: ${name}`);
    const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    if (!gltf.skins?.length || gltf.meshes?.some((mesh: { primitives: { attributes: Record<string, number> }[] }) =>
      mesh.primitives.some(p => p.attributes.JOINTS_1 === undefined || p.attributes.WEIGHTS_1 === undefined)))
      throw Error(`Hair part lacks full skin weights: ${name}`);
  }
  return { name, bytes: bytes.length, sha256 };
});
const hpDigest = createHash("sha256").update(readFileSync(resolve(source, "ash_brown.hp"))).digest("hex");
if (hpDigest !== expected["ash_brown.hp"]) throw Error("Unexpected ash_brown.hp source bytes");
// Stops decoded once from this exact HP using WolvenKit 8.17.4. Pinning both
// the source HP digest and all decoded values avoids trusting a stale JSON export.
const id = [
  { value: 0.115999997, color: [129, 122, 106] },
  { value: 0.551999986, color: [173, 168, 180] },
  { value: 0.996183276, color: [94, 94, 94] },
  { value: 1, color: [255, 255, 255] },
  { value: 1, color: [255, 255, 255] },
];
// hair.mt scalar overrides from the strand material instance (lm_hair__long.mi, SHA-256 pinned below).
const miRaw = resolve(source, "base/mel_ccxl_hair/materials/custom_tx/lm_hair__long.mi");
if (createHash("sha256").update(readFileSync(miRaw)).digest("hex") !== "bba2c075b3cb35a70e004abc2e2ce1dbb78cd2a1f3b1d2071fbeb0f5558a9eb0")
  throw Error("Unexpected lm_hair__long.mi source bytes");
const scalarNames: Record<string, string> = { AlphaCutoff: "alphaCutoff", RoughnessScale: "roughnessScale",
  RoughnessBias: "roughnessBias", ShadowStrength: "shadowStrength", ShadowMin: "shadowMin", ShadowMax: "shadowMax",
  ShadowRoughness: "shadowRoughness", FlowStrength: "flowStrength", Scattering: "scattering" };
const miJson = JSON.parse(readFileSync(resolve(miOption ?? resolve(source, "../json/lm_hair__long.mi.json")), "utf8"));
if (miJson.Data.RootChunk.baseMaterial.DepotPath.$value !== String.raw`base\materials\hair.mt`)
  throw Error("Strand material instance does not derive directly from hair.mt");
const material: Record<string, number> = {};
for (const value of miJson.Data.RootChunk.values as Record<string, unknown>[])
  for (const [key, entry] of Object.entries(value))
    if (scalarNames[key] && typeof entry === "number") material[scalarNames[key]!] = entry;
// CHairProfile.sampleCount of the same pinned ash_brown.hp (decoded with WolvenKit).
const sampleCount = 127;
const rootToTip = [
  { value: 0.146297738, color: [16, 10, 8] },
  { value: 0.410755992, color: [186, 165, 142] },
  { value: 0.56844908, color: [143, 123, 110] },
  { value: 0.830762982, color: [65, 47, 41] },
  { value: 1, color: [193, 168, 149] },
];
for (const name of names) copyFileSync(resolve(source, name), resolve(output, name));
const url = (file: typeof files[number]) => ({ url: `/assets/hair/${file.name}`, sha256: file.sha256 });
const byName = (name: string) => url(files.find(file => file.name === name)!);
const manifest = { schema: "xfs/local-hair-assets-3", entries: [{
  resourceHash: "14407260537193084196", definition: "38_ash_brown", label: "MELUMINARY Long Length Pak Vol 3 #011",
  parts: [byName("lm127_hair_pt1.glb"), byName("lm097_hair_pt2.glb")],
  alpha: byName("hair_lm60_a.png"), strandId: byName("hair_lm60_id.png"),
  strandGradient: byName("hair_lm60_grad.png"),
  capMask: byName("hh_110_wa__wizzy_cap_mask.png"),
  capGradient: byName("hh_cap_grad__ash_brown.png"),
  profile: { sourceSha256: hpDigest, sampleCount, id, rootToTip },
  material,
}] };
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "../evidence/hair-intake-manifest.json"), JSON.stringify({
  date: "2026-09-25", source: "MELUMINARY LONG LENGTH PAK VOL 3 #011, Hair Profiles CCXL ash_brown.hp and vanilla Wizzy cap mask",
  url: "https://www.nexusmods.com/cyberpunk2077/mods/27125",
  app: "base\\mel_ccxl_hair\\appearances\\lm097_hair.app",
  componentMeshes: ["base\\mel_ccxl_hair\\meshes\\lm127_hair_pt1.mesh", "base\\mel_ccxl_hair\\meshes\\lm097_hair_pt2.mesh"],
  ...manifest, files,
  limitations: ["Source files are ignored local assets, not redistribution content.",
    "Installed archive and XL match the save reference; effective runtime winner is not proven.",
    "Browser colour follows the compiled 2.31 hair.mt base-colour arithmetic (truncated profile lookup, luminance-switched overlay, vertex-red shadow term); the sRGB decode of profile stops is a hypothesis and the deferred hair lighting, anisotropy and physics are not reproduced. See knowledge/hair-shading.md.",
    "Source XBM/HP hashes and provenance are recorded in research/eye-artistry/saved-hair-profile-resolution.md."],
}, null, 2) + "\n");
console.log(`Prepared ${files.length} ignored local hair assets and manifest`);
