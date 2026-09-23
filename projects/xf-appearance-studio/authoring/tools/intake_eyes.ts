// Local preview only. The selected third-party image is never a distributable asset.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseEyeManifest } from "../src/eye-appearance";

const root = resolve(import.meta.dir, "../../../.."), out = resolve(import.meta.dir, "../public/assets/eyes");
const source = resolve(root, "research/consumers/saved-v-eyes/raw/kala/eye_16_diffuse.png");
const bytes = readFileSync(source), sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== "cc06290fe63cba59b42f11b97c06e364661e704c206b1e63a3b2c9420bc84d35")
  throw Error("Eye diffuse differs from the inspected local source; repeat provenance/UV verification before intake");
if (bytes.readUInt32BE(16) !== 512 || bytes.readUInt32BE(20) !== 512) throw Error("Unexpected eye PNG dimensions");
const manifest = {
  schema: "xfs/local-eye-assets-1",
  entries: [{
    resourceHash: "7132639559252259433", definition: "eye_16_diffuse",
    label: "Kala’s Eyes Standalone V2 — eye 16 (Unique Eyes to CCXL)",
    url: "/assets/eyes/kala-eye-16-diffuse.png", sha256, width: 512, height: 512,
    providers: [
      { name: "Kala’s Eyes Standalone V2", author: "Kala / guidethisonekalaheria; source eye texture: Sarah Cartwright", version: "1.0",
        url: "https://www.nexusmods.com/cyberpunk2077/mods/3242" },
      { name: "Unique Eyes to CCXL", author: "nutboy / brocreate", version: "1.0",
        url: "https://www.nexusmods.com/cyberpunk2077/mods/23263" },
      { name: "ArchiveXL", author: "psiberx and contributors", version: "1.26.3 installed bundle",
        url: "https://github.com/psiberx/cp2077-archive-xl" },
    ],
  }],
  evidence: "research/eye-artistry/modded-eye-resolution.md; research/eye-artistry/eye-preview-adapter-plan.md",
  limitations: "One locally researched saved choice, not general load-order resolution. Diffuse only; no game shader parity. Local preview only; do not redistribute.",
};
parseEyeManifest(manifest);
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "kala-eye-16-diffuse.png"), bytes);
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ output: out, sha256, bytes: bytes.length, width: 512, height: 512 }));
