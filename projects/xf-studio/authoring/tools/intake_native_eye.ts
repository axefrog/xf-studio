// Stage one exact, private vanilla female morph-eye export for future A/B preview.
// This tool deliberately does not enable it in the Studio renderer.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NATIVE_EYE_SOURCE, parseNativeEyeManifest, validateNativeEyeParts, verifyNativeEyeBytes,
  type NativeEyeManifest } from "../src/native-eye-intake";

const [glbPath, meshPath, morphPath] = process.argv.slice(2);
if (!glbPath || !meshPath || !morphPath)
  throw Error("Usage: bun tools/intake_native_eye.ts <morph-eye.glb> <base-eye.mesh> <eye.morphtarget>");

const readExact = (path: string, expected: string, label: string) => {
  const bytes = readFileSync(resolve(path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw Error(`${label} source SHA-256 differs from the pinned 2.31 study`);
  return bytes;
};
const mesh = readExact(meshPath, NATIVE_EYE_SOURCE.meshSha256, "Eye mesh");
const morph = readExact(morphPath, NATIVE_EYE_SOURCE.morphSha256, "Eye morph");
const glb = readExact(glbPath, NATIVE_EYE_SOURCE.glbSha256, "Eye morph GLB");
const manifest: NativeEyeManifest = parseNativeEyeManifest({
  schema: "xfs/local-native-eye-1", status: "staged-research-only", source: NATIVE_EYE_SOURCE,
  asset: { url: "/assets/native-eye/eye-h091.glb", sha256: NATIVE_EYE_SOURCE.glbSha256, bytes: glb.byteLength },
  limitation: "morph-bind-and-material-policy-unproven",
});
await verifyNativeEyeBytes(glb, manifest);
const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
const loaded = await new GLTFLoader().parseAsync(buffer, "");
const parts: THREE.SkinnedMesh[] = [];
loaded.scene.traverse(o => { if (o instanceof THREE.SkinnedMesh) parts.push(o); });
validateNativeEyeParts(parts.map(part => ({ name: part.name,
  vertices: part.geometry.getAttribute("position").count,
  morphs: Object.keys(part.morphTargetDictionary ?? {}),
  bones: part.skeleton.bones.map(b => b.name),
})));
// Hash and structural checks finish before anything is written. Source resources
// are consumed only as evidence; the staged asset remains ignored and private.
const out = resolve(import.meta.dir, "../public/assets/native-eye");
mkdirSync(out, { recursive: true });
const staged = resolve(out, "eye-h091.glb.tmp");
writeFileSync(staged, glb);
renameSync(staged, resolve(out, "eye-h091.glb"));
const stagedManifest = resolve(out, "manifest.json.tmp");
writeFileSync(stagedManifest, JSON.stringify(manifest, null, 2) + "\n");
renameSync(stagedManifest, resolve(out, "manifest.json"));
console.log(JSON.stringify({ staged: manifest.asset.url, sourceMeshBytes: mesh.byteLength,
  sourceMorphBytes: morph.byteLength, chunks: parts.length, status: manifest.status }));
