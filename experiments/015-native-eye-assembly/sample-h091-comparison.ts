// Private h091 eye/head morph-bind comparison at four fixed UI-idle phases.
// XFS_PRIVATE_ASSETS points to the existing ignored CC-idle intake.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../../projects/xf-studio/authoring/src/idle-animation";
import { extendSkin, restoreFirstWeights } from "../../projects/xf-studio/authoring/src/skin";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dir;
const generated = resolve(here, "generated");
const assets = process.env.XFS_PRIVATE_ASSETS;
if (!assets) throw Error("Set XFS_PRIVATE_ASSETS to the existing private CC-idle assets");
const paths = {
  head: resolve(here, "../013-native-preview-core/generated/visual-study/candidate/head.glb"),
  eye: resolve(generated, "eye-morph-export/base/characters/head/player_base_heads/player_female_average/he_000_pwa__morphs.morphtarget.glb"),
  headMeshJson: resolve(here, "../013-native-preview-core/generated/visual-study/source/base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead.mesh.json"),
  eyeMeshJson: resolve(here, "../013-native-preview-core/generated/visual-study/eye-export/base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.mesh.json"),
  headMorphJson: resolve(generated, "graph-trace-json/h0_000_pwa__morphs.morphtarget.json"),
  eyeMorphJson: resolve(generated, "graph-trace-json/he_000_pwa__morphs.morphtarget.json"),
  headMorphRaw: resolve(generated, "graph-trace/base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget"),
  eyeMorphRaw: resolve(generated, "graph-trace/base/characters/head/player_base_heads/player_female_average/he_000_pwa__morphs.morphtarget"),
  body: resolve(assets, "cc-idle-body.glb"), face: resolve(assets, "cc-idle-face.glb"),
  binding: resolve(assets, "cc-idle-binding.json"),
};
const expected = {
  head: "0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730",
  eye: "90ec2ee3396c598da5061d7d51f5945c34f7ccbff95246393e11c433e3fc3fdf",
  headMeshJson: "be95ec07441a7c894de67eec7269e966c090f649d076167006083bc73eda6066",
  eyeMeshJson: "4c1dfbe1ea15e9d94b67767c0e8a4227f66b45efe424822e10d60fc5f9955cd2",
  headMorphJson: "232131a62f0131f0e6f2968f31e9fd5bcfd6e3ddd73aded76b27399a0353f72d",
  eyeMorphJson: "29804e40b7ec86429a44e4629bd3a75ae996dd1349eb431db09f095c17698724",
  headMorphRaw: "3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e",
  eyeMorphRaw: "42a19b6a4d2f4060f6785de525d8c55f663fb2a13db804cd84e929e5110d1323",
  body: "b2f9ee12cbf5f19bffeb43c367439b0710f289ad38b75088943ba15fbdf8a8e8",
  face: "5a52d9b9e59acc2630336c3a280e179e57ad4ca5815f97d5397cf15748f2b3e7",
  binding: "72712873bcd65190207c9b83ff44a4a8dd2dd0190b20cea21beb1571deabe568",
};
const inputs = Object.fromEntries(Object.entries(paths).map(([key, path]) => {
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (sha256 !== expected[key as keyof typeof expected]) throw Error(`Unexpected ${key} source ${sha256}`);
  return [key, { sha256, path }];
}));
async function glb(path: string) {
  const raw = readFileSync(path);
  return new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), "");
}
const [head, eye, body, face] = await Promise.all([paths.head, paths.eye, paths.body, paths.face].map(glb));
const binding = JSON.parse(readFileSync(paths.binding, "utf8"));
let foundHead: THREE.SkinnedMesh | undefined;
head.scene.traverse(o => { if (o instanceof THREE.SkinnedMesh) { if (foundHead) throw Error("Multiple head skins"); foundHead = o; } });
if (!(foundHead instanceof THREE.SkinnedMesh)) throw Error("No native head skin");
const headMesh = foundHead;
const eyeParts = ["submesh_00_LOD_1_doubled", "submesh_01_LOD_1", "submesh_02_LOD_1"].map(name => {
  const mesh = eye.scene.getObjectByName(name);
  if (!(mesh instanceof THREE.SkinnedMesh)) throw Error(`Missing eye part ${name}`);
  return mesh;
});
const rawHead = readFileSync(paths.head);
const firstWeights = restoreFirstWeights(rawHead.buffer.slice(rawHead.byteOffset, rawHead.byteOffset + rawHead.byteLength));
const association = head.parser.associations.get(headMesh);
const name = head.parser.json.meshes[association?.meshes ?? -1]?.name;
const weights = firstWeights.get(name);
if (!weights) throw Error(`Missing head first weight set for ${name}`);
headMesh.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
extendSkin(headMesh, new THREE.MeshStandardMaterial());
const saved = ["h091_eyes", "h012_nose", "h053_mouth", "h054_jaw", "h145_ear"];
for (const morph of saved) if (headMesh.morphTargetDictionary?.[morph] === undefined) throw Error(`Missing head ${morph}`);
for (const part of eyeParts) if (part.morphTargetDictionary?.h091_eyes === undefined) throw Error("Missing eye h091_eyes");

const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const inverseC = C.clone().invert();
const rawMatrix = (m: any) => new THREE.Matrix4().fromArray(
  ["X", "Y", "Z", "W"].flatMap(row => ["X", "Y", "Z", "W"].map(column => m[row][column])));
const value = (x: any) => x.$value as string;
const baseMatrices = (path: string) => {
  const root = JSON.parse(readFileSync(path, "utf8")).Data.RootChunk;
  return new Map<string, THREE.Matrix4>(root.boneNames.map((n: any, i: number) => [value(n), rawMatrix(root.boneRigMatrices[i])]));
};
const morphMatrices = (path: string, targetName: string) => {
  const root = JSON.parse(readFileSync(path, "utf8")).Data.RootChunk;
  const target = root.targets.find((t: any) => value(t.name) === targetName);
  if (!target || value(target.regionName) !== "eyes") throw Error(`Missing eyes-region ${targetName}`);
  return new Map<string, THREE.Matrix4>(target.boneNames.map((n: any, i: number) => [value(n), rawMatrix(target.boneRigMatrices[i])]));
};
const headBase = baseMatrices(paths.headMeshJson), eyeBase = baseMatrices(paths.eyeMeshJson);
const headTarget = morphMatrices(paths.headMorphJson, "h091"), eyeTarget = morphMatrices(paths.eyeMorphJson, "h091");
head.scene.updateMatrixWorld(true); eye.scene.updateMatrixWorld(true);
const headBones = headMesh.skeleton.bones, eyeBones = eyeParts[0]!.skeleton.bones;
const baseWorld = new Map<string, Map<string, THREE.Matrix4>>();
for (const [key, bones] of [["head", headBones], ["eye", eyeBones]] as const)
  baseWorld.set(key, new Map(bones.map(b => [b.name, b.matrixWorld.clone()])));
const targetWorld = new Map<string, Map<string, THREE.Matrix4>>();
let maximumSourceBindPositionError = 0;
for (const [key, bones, base, target] of [["head", headBones, headBase, headTarget], ["eye", eyeBones, eyeBase, eyeTarget]] as const) {
  const adjusted = new Map<string, THREE.Matrix4>();
  for (const bone of bones) {
    const b = base.get(bone.name), t = target.get(bone.name);
    if (!b || !t) throw Error(`Missing ${key} source matrix for ${bone.name}`);
    const sourceBasePosition = new THREE.Vector3().setFromMatrixPosition(b.clone().invert()).applyMatrix4(C);
    const glbBasePosition = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    maximumSourceBindPositionError = Math.max(maximumSourceBindPositionError,
      sourceBasePosition.distanceTo(glbBasePosition));
    const delta = C.clone().multiply(t.clone().invert()).multiply(b).multiply(inverseC);
    const result = delta.multiply(bone.matrixWorld);
    const sourceTargetPosition = new THREE.Vector3().setFromMatrixPosition(t.clone().invert()).applyMatrix4(C);
    if (new THREE.Vector3().setFromMatrixPosition(result).distanceTo(sourceTargetPosition) > 2e-5)
      throw Error(`Target bind position conversion mismatch ${key}/${bone.name}`);
    adjusted.set(bone.name, result);
  }
  targetWorld.set(key, adjusted);
}
if (maximumSourceBindPositionError > 2e-5) throw Error(`Base bind conversion gap ${maximumSourceBindPositionError}`);
const shared = [...headTarget.keys()].filter(key => eyeTarget.has(key));
if (shared.length !== 34 || shared.some(key => !headTarget.get(key)!.equals(eyeTarget.get(key)!)))
  throw Error("Source head/eye h091 shared bind mismatch");
const headIdle = new IdleAnimation(body.scene, body.animations[0]!, headBones, binding.ancestry,
  { source: face.scene, clip: face.animations[0]! });
const eyeIdle = new IdleAnimation(body.scene, body.animations[0]!, eyeBones, binding.ancestry,
  { source: face.scene, clip: face.animations[0]! });
if (headIdle.unmapped.length || eyeIdle.unmapped.length) throw Error("Unmapped idle joints");
headIdle.setEnabled(true); eyeIdle.setEnabled(true);
const frames = [0, 169, 331, 490], shapes = ["neutral", "saved-five-morph"];
const surfaceNames = ["head", "native-lash", "native-eye", "native-wetness"];
const surfaces = [headMesh, ...eyeParts];
const out = resolve(generated, "h091-comparison"); mkdirSync(out, { recursive: true });
const output: Record<string, { file: string; vertices: number; triangles: number; sha256: string }> = {};
function configure(shape: string) {
  const corrected = shape !== "neutral";
  headMesh.morphTargetInfluences!.fill(0);
  for (const part of eyeParts) part.morphTargetInfluences!.fill(0);
  if (corrected) {
    for (const morph of saved) headMesh.morphTargetInfluences![headMesh.morphTargetDictionary![morph]!] = 1;
    for (const part of eyeParts) part.morphTargetInfluences![part.morphTargetDictionary!.h091_eyes!] = 1;
  }
  for (const [key, idle, meshes] of [["head", headIdle, [headMesh]], ["eye", eyeIdle, eyeParts]] as const) {
    const world = corrected ? targetWorld.get(key)! : baseWorld.get(key)!;
    for (const b of idle.bindings) b.worldBind.copy(world.get(b.bone.name)!);
    for (const mesh of meshes) for (let i = 0; i < mesh.skeleton.bones.length; i++) {
      const bone = mesh.skeleton.bones[i]!;
      mesh.skeleton.boneInverses[i]!.copy(world.get(bone.name)!).invert();
    }
  }
}
const point = new THREE.Vector3();
for (const shape of shapes) {
  configure(shape);
  for (const frame of frames) {
    headIdle.seek(frame / 30); eyeIdle.seek(frame / 30);
    head.scene.updateMatrixWorld(true); eye.scene.updateMatrixWorld(true);
    for (let s = 0; s < surfaces.length; s++) {
      const mesh = surfaces[s]!, count = mesh.geometry.getAttribute("position").count;
      const vertices = new Float64Array(count * 3);
      for (let i = 0; i < count; i++) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        vertices.set(point.toArray(), i * 3);
      }
      if (!vertices.every(Number.isFinite)) throw Error(`Nonfinite ${shape}/${frame}/${surfaceNames[s]}`);
      const file = `${shape}-${String(frame).padStart(3, "0")}-${surfaceNames[s]}.f64`;
      const buffer = Buffer.from(vertices.buffer); writeFileSync(resolve(out, file), buffer);
      output[`${shape}/${frame}/${surfaceNames[s]}`] = { file, vertices: count,
        triangles: mesh.geometry.index!.count / 3,
        sha256: createHash("sha256").update(buffer).digest("hex") };
    }
  }
}
const meshIndices = Object.fromEntries(surfaces.map((mesh, s) => {
  const index = mesh.geometry.index!;
  const values = Array.from({ length: index.count }, (_, i) => index.getX(i));
  const file = `${surfaceNames[s]}.indices.json`;
  writeFileSync(resolve(out, file), JSON.stringify(values));
  return [surfaceNames[s], { file, sha256: createHash("sha256").update(readFileSync(resolve(out, file))).digest("hex") }];
}));
const manifest = { schema: "xfs/native-eye-h091-samples-1", inputs, sampleRate: 30, frames, shapes,
  savedMorphs: saved, eyeMorph: "h091_eyes", bindSelection: "h091 on both head and eye; other four head vertex morphs retained",
  maximumSourceBindPositionError, sharedExactH091Matrices: shared.length, surfaces: output, meshIndices };
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ frames, shapes, maximumSourceBindPositionError, shared: shared.length }));
