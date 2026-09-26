/** Bake the browser candidate's identical raw material inputs for engine trials.
 * Outputs owned research textures, never installs or overwrites game assets.
 */
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bakeFlakes, defaultFlakes } from "../src/engines/layered-makeup/finish";
const output = resolve(
  import.meta.dir,
  "../../../../experiments/002-flake-material/generated",
);
mkdirSync(output, { recursive: true });
const settings = defaultFlakes();
const variants = ["shimmer", "glitter"] as const;
const records = [];
for (const finish of variants) {
  const baked = bakeFlakes(1024, finish, settings);
  for (const [name, bytes] of [
    ["normal", baked.normal],
    ["surface", baked.surface],
  ] as const)
    writeFileSync(resolve(output, `${finish}-${name}.rgba`), bytes);
  records.push({
    finish,
    size: baked.size,
    settings,
    normalConvention:
      "tangent-space XYZ encoded [0,1], UV0 top-left, browser convention; game import convention must be calibrated",
    surfaceChannels: {
      R: "flake coverage",
      G: "roughness",
      B: "metalness",
      A: "one",
    },
  });
}
// Pillow is used only to encode our own generated pixels; no image editing or AI imagery.
const convert = Bun.spawnSync(
  [
    "python",
    "-c",
    `
from pathlib import Path
from PIL import Image
import sys
p=Path(sys.argv[1])
for finish in ['shimmer','glitter']:
 for kind in ['normal','surface']:
  im=Image.frombytes('RGBA',(1024,1024),(p/f'{finish}-{kind}.rgba').read_bytes())
  im.save(p/f'xfas_{finish}_{kind}.png')
  if kind=='surface':
   for index,name in [(0,'coverage'),(1,'roughness'),(2,'metalness')]:
    im.getchannel(index).save(p/f'xfas_{finish}_{name}.png')
`,
    output,
  ],
  { stdout: "pipe", stderr: "pipe" },
);
if (convert.exitCode !== 0)
  throw Error(new TextDecoder().decode(convert.stderr));
const files = variants.flatMap((f) =>
  ["normal", "surface", "coverage", "roughness", "metalness"].map((k) => {
    const name = `xfas_${f}_${k}.png`,
      bytes = readFileSync(resolve(output, name));
    return {
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
);
const report = {
  version: 1,
  variants: records,
  files,
  limitations: [
    "Procedural browser candidate, not an extracted game material or proven game effect.",
    "1024 base level shared exactly with browser; renderer makes ordinary mipmaps. Normal-variance preserving minification is not implemented.",
    "Game normal encoding, blend weights and texture import/compression need verification before packaging.",
  ],
};
writeFileSync(
  resolve(output, "manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      output,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
    },
    null,
    2,
  ),
);
