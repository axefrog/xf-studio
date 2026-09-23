// Run after resolving/extracting a local source. Never put game/mod files in Git.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? resolve(import.meta.dir, "../../../../research/consumers/saved-v-hair/raw"));
const output = resolve(import.meta.dir, "../public/assets/hair");
mkdirSync(output, { recursive: true });
const names = ["lm127_hair_pt1.glb", "lm097_hair_pt2.glb", "hair_lm60_a.png"];
const files = names.map(name => {
  const bytes = readFileSync(resolve(source, name));
  if (name.endsWith(".glb")) {
    if (bytes.toString("ascii", 0, 4) !== "glTF") throw Error(`Invalid GLB: ${name}`);
    const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    if (!gltf.skins?.length || gltf.meshes?.some((mesh: { primitives: { attributes: Record<string, number> }[] }) =>
      mesh.primitives.some(p => p.attributes.JOINTS_1 === undefined || p.attributes.WEIGHTS_1 === undefined)))
      throw Error(`Hair part lacks full skin weights: ${name}`);
  }
  copyFileSync(resolve(source, name), resolve(output, name));
  return { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const url = (file: typeof files[number]) => ({ url: `/assets/hair/${file.name}`, sha256: file.sha256 });
const manifest = { schema: "xfs/local-hair-assets-1", entries: [{
  resourceHash: "14407260537193084196", definition: "38_ash_brown", label: "MELUMINARY Long Length Pak Vol 3 #011",
  parts: files.slice(0, 2).map(url), alpha: url(files[2]!),
}] };
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "../evidence/hair-intake-manifest.json"), JSON.stringify({
  date: "2026-09-23", source: "MELUMINARY LONG LENGTH PAK VOL 3 #011, installed MO2 package 6.0.0.0",
  url: "https://www.nexusmods.com/cyberpunk2077/mods/27125",
  app: "base\\mel_ccxl_hair\\appearances\\lm097_hair.app",
  componentMeshes: ["base\\mel_ccxl_hair\\meshes\\lm127_hair_pt1.mesh", "base\\mel_ccxl_hair\\meshes\\lm097_hair_pt2.mesh"],
  ...manifest, files,
  limitations: ["Source files are ignored local assets, not redistribution content.",
    "Installed archive and XL match the save reference; effective runtime winner is not proven.",
    "Saved colour is approximated; dynamic hair profile, strand shader, cap map and physics are not reproduced."],
}, null, 2) + "\n");
console.log(`Prepared ${files.length} ignored local hair assets and manifest`);
