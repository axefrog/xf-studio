/** Stage the already extracted style-18 packed normal for the locked browser study. */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = process.argv[2];
if (!source) throw Error("Usage: bun tools/stage-private-brow-study.ts <extracted ark_heb__base_n18.png>");
const root = resolve(import.meta.dir, "../public/assets");
const hashes = {
  head: "72b46566276bf87786d2b8025800278b41833194b45359792d380009bc3f82e8",
  brow: "da1e38700d2549335d6c6b9bf8ad12899fc8dbb2d9b25c8ce70de77db80edcae",
  normal: "2426e263edecb13d79ba8b902780c82a5f15ca13f4bbb3fcf5e8474b0bc84584",
};
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
for (const [label, path, expected] of [
  ["head", resolve(root, "head.glb"), hashes.head],
  ["brow", resolve(root, "brows.glb"), hashes.brow],
  ["brow normal", resolve(source), hashes.normal],
] as const) if (digest(path) !== expected) throw Error(`${label} source digest changed`);
const target = resolve(root, "brow-study");
mkdirSync(target, { recursive: true });
copyFileSync(resolve(source), resolve(target, "normal.png"));
writeFileSync(resolve(target, "manifest.json"), JSON.stringify({
  schema: "xfs/private-brow-study-1", glbSha256: hashes.brow,
  normal: { url: "/assets/brow-study/normal.png", sha256: hashes.normal },
}, null, 2) + "\n");
console.log("Staged ignored, hash-verified brow packed normal for /render-fidelity-study.html");
