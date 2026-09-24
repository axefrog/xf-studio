// Local reference intake only. Extraction inputs stay outside releasable assets.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, "../../../.."),
  out = resolve(import.meta.dir, "../public/assets");
const files = [
  [
    "brows.glb",
    "saved-v-brows/base/raw/base/characters/head/player_base_heads/player_female_average/heb_000_pwa__morphs.morphtarget.glb",
  ],
  ["brows-alpha.png", "saved-v-brows/raw/ark_heb__base_d18.png"],
  [
    "lashes.glb",
    "saved-v-lashes/raw/softnatural_eyelashes_pwa.morphtarget.glb",
  ],
  [
    "lashes-alpha.png",
    "saved-v-lashes/raw/softnatural_eyelashes_single_lash_alpha.png",
  ],
];
const outputs = files.map(([file, input]) => {
  const source = resolve(root, "research/consumers", input),
    target = resolve(out, file);
  copyFileSync(source, target);
  const b = readFileSync(target);
  return {
    file,
    source,
    bytes: b.length,
    sha256: createHash("sha256").update(b).digest("hex"),
  };
});
writeFileSync(
  resolve(import.meta.dir, "../evidence/details-manifest.json"),
  JSON.stringify(
    {
      date: "2026-09-23",
      outputs,
      brows: {
        appearanceHash: "10685882159528859062",
        appearance: "ark_eyebrows_02_ccxl_18",
        definition: "10_brown_ombre",
        geometry:
          "ArchiveXL .xl copies vanilla female brow morph blob/boundingBox/targets and mesh renderResourceBlob into the mod stubs. Export uses those vanilla geometry sources.",
        texture: "Arkhe Beautiful EYEBROWS II FULLER style 18",
        morphs: 105,
      },
      lashes: {
        appearanceHash: "6047185506343464350",
        appearance: "icxrus_softnaturaleyelashes",
        definition: "05_brown_liquorice",
        geometry:
          "Soft Natural Eyelashes female morph + base mesh, exported using isolated archive context",
        morphs: 21,
      },
      limitations: [
        "Reference study; not a general installed-resource resolver or verified MO2 winner.",
        "Brow/lash colours and shaders approximated; gradient maps, secondary diffuse, anisotropy and packed normals not reproduced.",
        "Blink remains synthetic, extended to lash rig; no game animation proof.",
        "Third-party/game assets must not be redistributed.",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(outputs);
