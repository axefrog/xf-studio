/** Copy already extracted private D05 maps into the ignored local study directory. */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const raw = process.argv[2];
if (!raw) throw Error("Usage: bun tools/stage-private-skin-study.ts <saved-skin/raw directory>");
const root = resolve(import.meta.dir, "../public/assets");
const headHash = "72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
if (hash(readFileSync(resolve(root, "head.glb"))) !== headHash)
  throw Error("Preview head changed; redo native UV correspondence before staging maps");

const rows = [
  ["base-albedo", "map-png/base-albedo/h0_000_pwa_c__basehead_d05.png", "2e066e187efcde185c254ec722308e84e360cd7f30625319167af755e785af4b"],
  ["base-normal", "map-png/base-normal/h0_001_pwa_c__basehead_n01.png", "015f9b8f730cb01ffc6f1bef543e83ce48b2c999850a485394dce586bbfc648e"],
  ["arkhe-albedo", "map-png/mod-albedo/h0_000_pwa_c__basehead_d05.png", "a89753c3e5b4126fd12d6caed1c75c48f160726040907640f41a4a66e634522c"],
  ["arkhe-normal", "map-png/mod-normal/h0_001_pwa_c__basehead_n01.png", "0b1b0d68691abba974dbc3b1ff3c9b67f6193582445eeed227aab057025b59e5"],
  ["base-roughness", "roughness-png/h0_000_wa_c__basehead_rm01.png", "5a258560cb9b7056159d28d0f17dd9f90aad5caf833760c3562779a57dd102d4"],
] as const;
const checked = rows.map(([name, source, expected]) => {
  const path = resolve(raw, source);
  if (hash(readFileSync(path)) !== expected) throw Error(`Private source map hash changed: ${name}`);
  return { name, path, url: `/assets/skin-study/${name}.png`, sha256: expected };
});
const target = resolve(root, "skin-study");
mkdirSync(target, { recursive: true });
for (const row of checked) copyFileSync(row.path, resolve(target, `${row.name}.png`));
const item = (name: string) => { const row = checked.find(row => row.name === name)!; return { url: row.url, sha256: row.sha256 }; };
const manifest = {
  schema: "xfs/private-skin-study-1", headGlbSha256: headHash,
  roughness: item("base-roughness"),
  base: { albedo: item("base-albedo"), normal: item("base-normal") },
  arkheCandidate: { albedo: item("arkhe-albedo"), normal: item("arkhe-normal") },
};
writeFileSync(resolve(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Staged five ignored, hash-verified maps for /render-fidelity-study.html");
