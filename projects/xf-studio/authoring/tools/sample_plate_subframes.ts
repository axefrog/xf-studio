// Offline experiment: sample the decoded idle at actual Three.js clip times.
// Writes only ignored game-derived geometry under an explicit output path.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../src/idle-animation";
import { extendSkin, restoreFirstWeights, skinSets } from "../src/skin";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, writeSync } from "node:fs";
import { resolve } from "node:path";

const [sourceArg, mapArg, assetArg, outputArg, rateArg, firstArg, lastArg] = process.argv.slice(2);
if (!sourceArg || !mapArg || !assetArg || !outputArg || !rateArg || !firstArg || !lastArg) {
  throw Error("Usage: bun sample_plate_subframes.ts SOURCE_BUILD NATIVE_MAP ASSET_ROOT OUTPUT RATE_HZ FIRST_30HZ_FRAME LAST_30HZ_FRAME");
}
const sourceBuild = resolve(sourceArg), mapPath = resolve(mapArg), assetRoot = resolve(assetArg);
const outputRoot = resolve(outputArg);
const rate = Number(rateArg), firstFrame = Number(firstArg), lastFrame = Number(lastArg);
if (!Number.isInteger(rate) || rate <= 30 || rate % 30 !== 0 ||
    !Number.isInteger(firstFrame) || !Number.isInteger(lastFrame) ||
    firstFrame < 0 || lastFrame > 663 || firstFrame > lastFrame) {
  throw Error("Rate must be a multiple of 30 above 30 Hz; frame range must lie within 0..663");
}
if (existsSync(outputRoot) && readdirSync(outputRoot).length) throw Error("Output must be new and empty");
const build = await Bun.file(resolve(sourceBuild, "build.json")).json();
if (!build.preserveHeadWeights) throw Error("Source build must retain native head weights");
const old = await Bun.file(resolve(sourceBuild, "posed/manifest.json")).json();
const mapping: number[] = (await Bun.file(mapPath).json()).plateToHeadIndices;
if (mapping.length !== 1620 || new Set(mapping).size !== mapping.length) throw Error("Expected native 1620-vertex cut");
const sha = (bytes: ArrayBuffer) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const load = async (path: string) => {
  const bytes = await Bun.file(path).arrayBuffer();
  return { gltf: await new GLTFLoader().parseAsync(bytes, ""), hash: sha(bytes) };
};
const [body, face, head] = await Promise.all([
  load(resolve(assetRoot, "cc-idle-body.glb")),
  load(resolve(assetRoot, "cc-idle-face.glb")),
  load(build.head),
]);
if (body.hash !== old.animationHashes.body || face.hash !== old.animationHashes.facial ||
    head.hash !== old.surfaces.find((s: { name: string }) => s.name === "head")?.sha256) {
  throw Error("Clips or head differ from the original 73-pose run");
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
if (idle.unmapped.length || idle.bindings.length !== 254) throw Error("Unexpected bone binding");
idle.setEnabled(true);
if (Math.ceil(face.gltf.animations[0]!.duration * 30) !== 663) throw Error("Facial duration changed");
const vertexCount = mesh.geometry.getAttribute("position").count;
if (vertexCount !== 7186) throw Error("Head vertex count changed");
const positions = new Float64Array(vertexCount * 3);
const linear = new Float64Array(mapping.length * 9);
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
mkdirSync(outputRoot, { recursive: true });
const positionFd = openSync(resolve(outputRoot, "head.positions.f64"), "wx");
const linearFd = openSync(resolve(outputRoot, "fixed_linear.f64"), "wx");
const firstTick = firstFrame * rate / 30, lastTick = lastFrame * rate / 30;
let reconstructionError = 0;
try {
  for (let tick = firstTick; tick <= lastTick; tick++) {
    idle.seek(tick / rate); scene.updateMatrixWorld(true);
    for (let i = 0; i < vertexCount; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      positions.set(point.toArray(), i * 3);
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
      direct.fromArray(positions, i * 3);
      reconstructionError = Math.max(reconstructionError, point.distanceTo(direct));
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        linear[k * 9 + row * 3 + col] = affine.elements[col * 4 + row]!;
      }
    }
    writeSync(positionFd, new Uint8Array(positions.buffer));
    writeSync(linearFd, new Uint8Array(linear.buffer));
    if (tick === firstTick || tick % rate === 0 || tick === lastTick) {
      console.log(`Sampled ${tick-firstTick+1}/${lastTick-firstTick+1} at ${tick/rate}s`);
    }
  }
} finally {
  closeSync(positionFd); closeSync(linearFd);
}
if (reconstructionError > 1e-10) throw Error(`Skin affine reconstruction invalid: ${reconstructionError}`);
await Bun.write(resolve(outputRoot, "manifest.json"), JSON.stringify({
  schema: "xfs/native-plate-subframe-samples-1",
  firstTick, lastTick, rate, firstFrame, lastFrame,
  sampleCount: lastTick-firstTick+1, headVertices: vertexCount,
  mappedPlateVertices: mapping.length, mappedBones: idle.bindings.length,
  unmappedBones: idle.unmapped, reconstructionError,
  inputHashes: { head: head.hash, body: body.hash, face: face.hash, nativeMap: sha(await Bun.file(mapPath).arrayBuffer()) },
  sourceBuild,
  limit: "Decoded Three.js IdleAnimation/skin adapter at sampled clip times; no REDengine graph or continuous-time guarantee",
}, null, 2) + "\n");
console.log(JSON.stringify({ sampleCount: lastTick-firstTick+1, reconstructionError }));
