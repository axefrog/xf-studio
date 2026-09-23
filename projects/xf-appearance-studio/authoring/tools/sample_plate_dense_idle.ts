// Sample every baked facial frame for the plate contact study. Writes only ignored research data.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../src/idle-animation";
import { extendSkin, restoreFirstWeights, skinSets } from "../src/skin";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [sourceBuild, assetRoot, outputRoot] = process.argv.slice(2).map(path => resolve(path));
if (!sourceBuild || !assetRoot || !outputRoot) {
  throw Error("Usage: bun sample_plate_dense_idle.ts SOURCE_BUILD ASSET_ROOT OUTPUT_ROOT");
}
const build = await Bun.file(resolve(sourceBuild, "build.json")).json();
if (!build.preserveHeadWeights) throw Error("Source build must retain native head weights");
const old = await Bun.file(resolve(sourceBuild, "posed/manifest.json")).json();
const mapping: number[] = (await Bun.file(build.mapping).json()).plateToHeadIndices;
const sha = (bytes: ArrayBuffer) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const load = async (path: string) => {
  const bytes = await Bun.file(path).arrayBuffer();
  return { gltf: await new GLTFLoader().parseAsync(bytes, ""), hash: sha(bytes), path };
};
const [body, face, head] = await Promise.all([
  load(resolve(assetRoot, "cc-idle-body.glb")),
  load(resolve(assetRoot, "cc-idle-face.glb")),
  load(build.head),
]);
if (body.hash !== old.animationHashes.body || face.hash !== old.animationHashes.facial ||
    head.hash !== old.surfaces.find((s: { name: string }) => s.name === "head")?.sha256) {
  throw Error("Source clips or head differ from the original 73-pose run");
}
const binding = await Bun.file(resolve(assetRoot, "cc-idle-binding.json")).json();
const scene = head.gltf.scene, bones: THREE.Bone[] = [], meshes: THREE.SkinnedMesh[] = [];
const weights = restoreFirstWeights(await Bun.file(build.head).arrayBuffer());
scene.traverse(o => {
  if (o instanceof THREE.Bone) bones.push(o);
  if (!(o instanceof THREE.SkinnedMesh)) return;
  const association = head.gltf.parser.associations.get(o);
  const name = head.gltf.parser.json.meshes[association?.meshes ?? -1]?.name;
  if (!weights.has(name)) throw Error("Missing full head weights");
  o.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights.get(name)!, 4));
  extendSkin(o, new THREE.MeshStandardMaterial());
  o.morphTargetInfluences!.fill(0);
  for (const morph of ["h091_eyes", "h012_nose", "h053_mouth", "h054_jaw", "h145_ear"]) {
    const index = o.morphTargetDictionary?.[morph];
    if (index === undefined) throw Error(`Missing ${morph}`);
    o.morphTargetInfluences![index] = 1;
  }
  meshes.push(o);
});
if (meshes.length !== 1) throw Error("Expected one head mesh");
scene.updateMatrixWorld(true);
const mesh = meshes[0]!, sets = skinSets(mesh.geometry);
const idle = new IdleAnimation(body.gltf.scene, body.gltf.animations[0]!, bones, binding.ancestry,
  { source: face.gltf.scene, clip: face.gltf.animations[0]! });
if (idle.unmapped.length) throw Error(`Unmapped bones: ${idle.unmapped.join(",")}`);
idle.setEnabled(true);
const rate = 30, lastFrame = Math.ceil(face.gltf.animations[0]!.duration * rate);
if (lastFrame !== 663 || Math.max(...old.frames) !== lastFrame) throw Error("Facial duration differs from original sample");
const frames = Array.from({ length: lastFrame + 1 }, (_, i) => i);
const vertexCount = mesh.geometry.getAttribute("position").count;
const positions = new Float64Array(frames.length * vertexCount * 3);
const linear = new Float64Array(frames.length * mapping.length * 9);
const rest = new Float64Array(mapping.length * 3);
const matrix = new THREE.Matrix4(), sum = new THREE.Matrix4(), affine = new THREE.Matrix4();
const point = new THREE.Vector3(), delta = new THREE.Vector3(), direct = new THREE.Vector3();
for (let k = 0; k < mapping.length; k++) {
  const i = mapping[k]!;
  point.fromBufferAttribute(mesh.geometry.getAttribute("position"), i);
  mesh.morphTargetInfluences!.forEach((weight, j) => {
    if (weight) point.addScaledVector(delta.fromBufferAttribute(mesh.geometry.morphAttributes.position![j]!, i), weight);
  });
  rest.set(point.toArray(), k * 3);
}
let reconstructionError = 0;
for (const frame of frames) {
  idle.seek(frame / rate); scene.updateMatrixWorld(true);
  for (let i = 0; i < vertexCount; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
    positions.set(point.toArray(), (frame * vertexCount + i) * 3);
  }
  for (let k = 0; k < mapping.length; k++) {
    const i = mapping[k]!;
    sum.elements.fill(0);
    for (const set of sets) for (let c = 0; c < 4; c++) {
      const weight = mesh.geometry.getAttribute(set.w).getComponent(i, c);
      if (!weight) continue;
      const bone = mesh.geometry.getAttribute(set.j).getComponent(i, c);
      matrix.multiplyMatrices(mesh.skeleton.bones[bone]!.matrixWorld, mesh.skeleton.boneInverses[bone]!);
      for (let q = 0; q < 16; q++) sum.elements[q]! += weight * matrix.elements[q]!;
    }
    affine.copy(mesh.bindMatrixInverse).multiply(sum).multiply(mesh.bindMatrix);
    affine.elements[3] = affine.elements[7] = affine.elements[11] = 0;
    affine.elements[15] = 1;
    affine.premultiply(mesh.matrixWorld);
    point.fromArray(rest, k * 3).applyMatrix4(affine);
    direct.fromArray(positions, (frame * vertexCount + i) * 3);
    reconstructionError = Math.max(reconstructionError, point.distanceTo(direct));
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      linear[(frame * mapping.length + k) * 9 + row * 3 + col] = affine.elements[col * 4 + row]!;
    }
  }
  if (frame % 100 === 0) console.log(`Sampled ${frame}/${lastFrame}`);
}
if (!positions.every(Number.isFinite) || !linear.every(Number.isFinite) || reconstructionError > 1e-10) {
  throw Error(`Dense pose or affine reconstruction invalid: ${reconstructionError}`);
}
mkdirSync(outputRoot, { recursive: true });
await Bun.write(resolve(outputRoot, "head.positions.f64"), new Uint8Array(positions.buffer));
await Bun.write(resolve(outputRoot, "fixed_linear.f64"), new Uint8Array(linear.buffer));
await Bun.write(resolve(outputRoot, "manifest.json"), JSON.stringify({
  frames, rate, headVertices: vertexCount, mappedPlateVertices: mapping.length,
  mappedBones: idle.bindings.length, unmappedBones: idle.unmapped,
  reconstructionError, inputHashes: { head: head.hash, body: body.hash, face: face.hash },
  sourceBuild, limit: "Decoded adapter and baked 30 Hz facial clip; no REDengine graph or between-frame claim",
}, null, 2) + "\n");
console.log(JSON.stringify({ frames: frames.length, vertexCount, mappedPlateVertices: mapping.length, reconstructionError }));
