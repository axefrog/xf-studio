// Private posed surfaces for finite native-eye/head contact and visibility checks.
// Run with XFS_PRIVATE_ASSETS and XFS_NATIVE_HEAD set to existing ignored sources.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../../projects/xf-studio/authoring/src/idle-animation";
import { extendSkin, restoreFirstWeights } from "../../projects/xf-studio/authoring/src/skin";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dir, generated = resolve(here, "generated");
const assets = process.env.XFS_PRIVATE_ASSETS, headPath = process.env.XFS_NATIVE_HEAD;
if (!assets || !headPath) throw Error("Set XFS_PRIVATE_ASSETS and XFS_NATIVE_HEAD to private local inputs");
const paths = {
  eye: resolve(generated, "eye-export/base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.glb"),
  head: resolve(headPath), body: resolve(assets, "cc-idle-body.glb"), face: resolve(assets, "cc-idle-face.glb"),
  binding: resolve(assets, "cc-idle-binding.json"),
};
const expected = {
  eye: "0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba",
  head: "0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730",
  body: "b2f9ee12cbf5f19bffeb43c367439b0710f289ad38b75088943ba15fbdf8a8e8",
  face: "5a52d9b9e59acc2630336c3a280e179e57ad4ca5815f97d5397cf15748f2b3e7",
  binding: "72712873bcd65190207c9b83ff44a4a8dd2dd0190b20cea21beb1571deabe568",
};
const inputs = Object.fromEntries(Object.entries(paths).map(([key, path]) => {
  const buffer = readFileSync(path), hash = createHash("sha256").update(buffer).digest("hex");
  if (hash !== expected[key as keyof typeof expected]) throw Error(`Unexpected ${key} hash ${hash}`);
  return [key, { path, sha256: hash }];
}));
async function glb(path: string) {
  const raw = readFileSync(path);
  return new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), "");
}
const [eye, head, body, face] = await Promise.all([paths.eye, paths.head, paths.body, paths.face].map(glb));
const binding = JSON.parse(readFileSync(paths.binding, "utf8"));
let headMesh: THREE.SkinnedMesh | undefined;
head.scene.traverse(o => { if (o instanceof THREE.SkinnedMesh) { if (headMesh) throw Error("Multiple native head skins"); headMesh = o; } });
if (!(headMesh instanceof THREE.SkinnedMesh)) throw Error("Expected native head skin");
const eyeParts = ["submesh_00_LOD_1_doubled", "submesh_01_LOD_1", "submesh_02_LOD_1"].map(name => {
  const mesh = eye.scene.getObjectByName(name);
  if (!(mesh instanceof THREE.SkinnedMesh)) throw Error(`Expected skinned ${name}`);
  return mesh;
});
const headRaw = readFileSync(paths.head);
const rawWeights = restoreFirstWeights(headRaw.buffer.slice(headRaw.byteOffset, headRaw.byteOffset + headRaw.byteLength));
const association = head.parser.associations.get(headMesh);
const meshName = head.parser.json.meshes[association?.meshes ?? -1]?.name;
const weights = rawWeights.get(meshName);
if (!weights) throw Error(`Missing native head first weight set for ${meshName}`);
headMesh.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
extendSkin(headMesh, new THREE.MeshStandardMaterial());
const saved = ["h091_eyes", "h012_nose", "h053_mouth", "h054_jaw", "h145_ear"];
for (const name of saved) if (headMesh.morphTargetDictionary?.[name] === undefined) throw Error(`Missing ${name} morph`);
const headBones = headMesh.skeleton.bones, eyeBones = eyeParts[0]!.skeleton.bones;
const headIdle = new IdleAnimation(body.scene, body.animations[0]!, headBones, binding.ancestry,
  { source: face.scene, clip: face.animations[0]! });
const eyeIdle = new IdleAnimation(body.scene, body.animations[0]!, eyeBones, binding.ancestry,
  { source: face.scene, clip: face.animations[0]! });
if (headIdle.unmapped.length || eyeIdle.unmapped.length) throw Error("Idle joint mapping incomplete");
headIdle.setEnabled(true); eyeIdle.setEnabled(true);
const eyeJoint = eye.scene.getObjectByName("l_J_eye_JNT")!, pupilJoint = eye.scene.getObjectByName("l_J_eye_pupil_JNT")!;
const upper = eye.scene.getObjectByName("l_J_eye_lid_up_rowA_1_JNT")!;
const lower = eye.scene.getObjectByName("l_J_eye_lid_dn_rowA_1_JNT")!;
const eyeBind = eyeJoint.matrixWorld.clone(), pupilBind = pupilJoint.matrixWorld.clone();
const pupilRelativeBind = eyeBind.clone().invert().multiply(pupilBind);
const frameMetrics: { frame: number; lidGap: number; gazeX: number; pupilRelativeShift: number }[] = [];
const y = new THREE.Vector3(), z = new THREE.Vector3(), temp = new THREE.Matrix4();
for (let frame = 0; frame < 663; frame++) {
  headIdle.seek(frame / 30); eyeIdle.seek(frame / 30);
  head.scene.updateMatrixWorld(true); eye.scene.updateMatrixWorld(true);
  const lidGap = y.setFromMatrixPosition(upper.matrixWorld).y - z.setFromMatrixPosition(lower.matrixWorld).y;
  const gazeX = new THREE.Vector3(0, 0, -1).transformDirection(temp.copy(eyeJoint.matrixWorld).multiply(eyeBind.clone().invert())).x;
  const pupilRelativeShift = new THREE.Vector3().setFromMatrixPosition(
    temp.copy(eyeJoint.matrixWorld).invert().multiply(pupilJoint.matrixWorld).multiply(pupilRelativeBind.clone().invert()));
  frameMetrics.push({ frame, lidGap, gazeX, pupilRelativeShift: pupilRelativeShift.length() });
}
function extremum(key: "lidGap" | "gazeX" | "pupilRelativeShift", mode: "min" | "max") {
  return frameMetrics.reduce((best, row) => mode === "min" ? row[key] < best[key] ? row : best : row[key] > best[key] ? row : best).frame;
}
const selection = {
  first: 0, pupilDivergenceFromRigidStudy: 27, last: 662,
  mostClosedLid: extremum("lidGap", "min"), mostOpenLid: extremum("lidGap", "max"),
  leftGazeExtreme: extremum("gazeX", "min"), rightGazeExtreme: extremum("gazeX", "max"),
  maximumPupilRelativeShift: extremum("pupilRelativeShift", "max"),
  priorPlateContactA: 298, priorPlateContactB: 299,
};
const frames = [...new Set(Object.values(selection))].sort((a, b) => a - b);
const out = resolve(generated, "clearance"); mkdirSync(out, { recursive: true });
const shapes = ["neutral", "saved-five-morph"];
const surfaces = [headMesh, ...eyeParts];
const surfaceNames = ["head", "native-lash", "native-eye", "native-wetness"];
const output: Record<string, { file: string; vertices: number; triangles: number; sha256: string }> = {};
const point = new THREE.Vector3();
for (const shape of shapes) {
  headMesh.morphTargetInfluences!.fill(0);
  if (shape !== "neutral") for (const name of saved) headMesh.morphTargetInfluences![headMesh.morphTargetDictionary![name]!] = 1;
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
      if (!vertices.every(Number.isFinite)) throw Error(`Nonfinite ${surfaceNames[s]} at ${frame}`);
      const file = `${shape}-${String(frame).padStart(3, "0")}-${surfaceNames[s]}.f64`;
      const buffer = Buffer.from(vertices.buffer);
      writeFileSync(resolve(out, file), buffer);
      output[`${shape}/${frame}/${surfaceNames[s]}`] = { file, vertices: count,
        triangles: mesh.geometry.index!.count / 3,
        sha256: createHash("sha256").update(buffer).digest("hex") };
    }
  }
}
const meshIndices = Object.fromEntries(surfaces.map((mesh, s) => {
  const index = mesh.geometry.index;
  if (!index) throw Error(`Missing triangle indices for ${surfaceNames[s]}`);
  const values = Array.from({ length: index.count }, (_, i) => index.getX(i));
  const file = `${surfaceNames[s]}.indices.json`;
  writeFileSync(resolve(out, file), JSON.stringify(values));
  return [surfaceNames[s], { file, sha256: createHash("sha256").update(readFileSync(resolve(out, file))).digest("hex") }];
}));
const manifest = { schema: "xfs/native-eye-finite-samples-1", inputs, sampleRate: 30, frames, selection,
  frameMetrics: Object.fromEntries(frames.map(frame => [frame, frameMetrics[frame]])),
  shapes, savedMorphs: saved, surfaces: output, meshIndices };
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ frames, selection, shapes, surfaces: surfaceNames }));
