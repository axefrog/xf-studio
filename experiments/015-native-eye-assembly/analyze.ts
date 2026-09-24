// Offline source-bound geometry check. Inputs remain in ignored local directories.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../../projects/xf-studio/authoring/src/idle-animation";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "generated");
const assetRoot = process.env.XFS_PRIVATE_ASSETS;
if (!assetRoot) throw Error("Set XFS_PRIVATE_ASSETS to the existing private Studio assets directory");
const paths = {
  native: resolve(root, "eye-export/base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.glb"),
  mesh: resolve(root, "eye-export/base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/he_000_pwa_c__basehead.mesh"),
  head: resolve(assetRoot, "head.glb"), body: resolve(assetRoot, "cc-idle-body.glb"),
  face: resolve(assetRoot, "cc-idle-face.glb"), binding: resolve(assetRoot, "cc-idle-binding.json"),
};
function bytes(path: string) { return readFileSync(path); }
function sha(path: string) { return createHash("sha256").update(bytes(path)).digest("hex"); }
async function glb(path: string) {
  const raw = bytes(path);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  return new GLTFLoader().parseAsync(buffer, "");
}
const [native, historical, body, face] = await Promise.all([paths.native, paths.head, paths.body, paths.face].map(glb));
const binding = JSON.parse(bytes(paths.binding).toString());
const nativeMesh = native.scene.getObjectByName("submesh_01_LOD_1") as THREE.SkinnedMesh;
const oldMesh = historical.scene.getObjectByName("eyes") as THREE.Mesh;
if (!(nativeMesh instanceof THREE.SkinnedMesh) || !oldMesh) throw Error("Expected native or historical eye surface missing");
const historicalHead = historical.scene.getObjectByName("head") as THREE.SkinnedMesh;
if (!(historicalHead instanceof THREE.SkinnedMesh)) throw Error("Historical head skin missing");
const skin = nativeMesh.skeleton;
if (skin.bones.length !== 57) throw Error(`Expected 57 native joints, got ${skin.bones.length}`);
if (sha(paths.native) !== "0e5420a75e5a65eded91bb68338860e119692f0868f78e7ef89c98c0c56eaeba") throw Error("Native eye GLB hash changed");
if (sha(paths.mesh) !== "4d5dfa91efdf54485c5637ad34d64c32ae2f02cad7c52915062f3a0ec0f7aa19") throw Error("Native eye mesh hash changed");

const names = skin.bones.map(b => b.name);
if (new Set(names).size !== 57) throw Error("Duplicate native eye bone names");
const nativeRoot = new THREE.Group(), oldRoot = new THREE.Group();
nativeRoot.add(native.scene); oldRoot.add(historical.scene);
nativeRoot.updateMatrixWorld(true); oldRoot.updateMatrixWorld(true);
const nativeRestWorld = skin.bones.map(b => b.matrixWorld.clone());
const headRestWorld = new Map(historicalHead.skeleton.bones.map(b => [b.name, b.matrixWorld.clone()]));
const missingHeadJoints = skin.bones.map(b => b.name).filter(name => !headRestWorld.has(name));
const nativeRestPositions = Array.from({ length: nativeMesh.geometry.getAttribute("position").count }, (_, i) =>
  nativeMesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(nativeMesh.matrixWorld));
const inverseBindError = Math.max(...skin.bones.flatMap((b, i) =>
  b.matrixWorld.clone().multiply(skin.boneInverses[i]!).elements.map((v, k) => Math.abs(v - new THREE.Matrix4().identity().elements[k]!))));
face.scene.updateMatrixWorld(true);
const sourceBones = new Map<string, THREE.Object3D>();
face.scene.traverse(o => sourceBones.set(o.name, o));
const bindDiffs = names.map(name => {
  const target = skin.bones.find(b => b.name === name)!;
  const source = sourceBones.get(name);
  if (!source) throw Error(`Facial source lacks ${name}`);
  const ta = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
  const so = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
  const tq = new THREE.Quaternion().setFromRotationMatrix(target.matrixWorld);
  const sq = new THREE.Quaternion().setFromRotationMatrix(source.matrixWorld);
  return { name, position: ta.distanceTo(so), angleRad: tq.angleTo(sq), nativePosition: ta.toArray(), facialPosition: so.toArray() };
});
const oldPos = oldMesh.geometry.getAttribute("position");
const eyeBones = ["l_J_eye_JNT", "r_J_eye_JNT"].map(name => {
  const ref = sourceBones.get(name)!;
  const b = new THREE.Bone(); b.name = name;
  ref.matrixWorld.decompose(b.position, b.quaternion, b.scale);
  return b;
});
const oldGeo = oldMesh.geometry.clone();
const indices = new Uint16Array(oldPos.count * 4), weights = new Float32Array(oldPos.count * 4);
const point = new THREE.Vector3();
for (let i = 0; i < oldPos.count; i++) {
  point.fromBufferAttribute(oldPos, i).applyMatrix4(oldMesh.matrixWorld);
  indices[i * 4] = point.distanceToSquared(eyeBones[0]!.position) < point.distanceToSquared(eyeBones[1]!.position) ? 0 : 1;
  weights[i * 4] = 1;
}
oldGeo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
oldGeo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
const rigid = new THREE.SkinnedMesh(oldGeo);
rigid.position.copy(oldMesh.position); rigid.quaternion.copy(oldMesh.quaternion); rigid.scale.copy(oldMesh.scale);
oldMesh.parent!.add(rigid); oldRoot.add(...eyeBones); oldRoot.updateMatrixWorld(true);
rigid.bind(new THREE.Skeleton(eyeBones), rigid.matrixWorld);
const oldRestWorld = eyeBones.map(b => b.matrixWorld.clone());
const oldTriangles = oldGeo.index;
if (!oldTriangles) throw Error("Historical eye has no triangle index");
for (let i = 0; i < oldTriangles.count; i += 3) {
  const a = indices[oldTriangles.getX(i) * 4];
  if (a !== indices[oldTriangles.getX(i + 1) * 4] || a !== indices[oldTriangles.getX(i + 2) * 4]) throw Error("Historical triangle spans both eyes");
}

const nativeIdle = new IdleAnimation(body.scene, body.animations[0]!, skin.bones, binding.ancestry, { source: face.scene, clip: face.animations[0]! });
const oldIdle = new IdleAnimation(body.scene, body.animations[0]!, eyeBones, binding.ancestry, { source: face.scene, clip: face.animations[0]! });
const headIdle = new IdleAnimation(body.scene, body.animations[0]!, historicalHead.skeleton.bones, binding.ancestry, { source: face.scene, clip: face.animations[0]! });
if (nativeIdle.unmapped.length || oldIdle.unmapped.length || headIdle.unmapped.length) throw Error(`Unmapped joints: ${[...nativeIdle.unmapped, ...oldIdle.unmapped, ...headIdle.unmapped]}`);
nativeIdle.setEnabled(true); oldIdle.setEnabled(true); headIdle.setEnabled(true);
// The same source is driven twice; seek both to each phase before reading geometry.
const nativeCount = nativeMesh.geometry.getAttribute("position").count;
const oldCount = oldPos.count;
const nativeBind: THREE.Vector3[] = [], oldBind: THREE.Vector3[] = [];
const nativeSides: number[][] = [[], []], oldSides: number[][] = [[], []];
function sample(mesh: THREE.SkinnedMesh, count: number) {
  mesh.updateMatrixWorld(true);
  return Array.from({ length: count }, (_, i) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
}
// At time zero, this is the idle's phase-zero pose. Track displacement relative to it.
nativeBind.push(...sample(nativeMesh, nativeCount)); oldBind.push(...sample(rigid, oldCount));
nativeBind.forEach((p, i) => nativeSides[p.x < 0 ? 0 : 1]!.push(i));
oldBind.forEach((p, i) => oldSides[p.x < 0 ? 0 : 1]!.push(i));
function centroid(points: THREE.Vector3[], ids: number[]) {
  return ids.reduce((sum, i) => sum.add(points[i]!), new THREE.Vector3()).multiplyScalar(1 / ids.length);
}
const n0 = nativeSides.map(ids => centroid(nativeBind, ids));
const o0 = oldSides.map(ids => centroid(oldBind, ids));
let maxNativeMotion = 0, maxOldMotion = 0, maxCentroidTrajectoryGap = 0;
let maxNativeVsRigidDelta = 0, maxNativeVsRigidVertex = -1, maxNativeVsRigidFrame = -1;
let maxJointWorldDisagreement = 0;
let maxJointDeltaDisagreement = 0;
let maxHeadJointDeltaDisagreement = 0;
let maxHeadJointPositionGap = 0;
let maxPhaseZeroNativeDrift = 0;
const named = ["l_J_eye_JNT", "r_J_eye_JNT"];
const perSide = [0, 1].map(() => ({ nativeMotion: 0, oldMotion: 0, centroidGap: 0 }));
const skinIndex = nativeMesh.geometry.getAttribute("skinIndex");
const skinWeight = nativeMesh.geometry.getAttribute("skinWeight");
const boneBindWorld = skin.bones.map(b => b.matrixWorld.clone());
const eyeIndex = named.map(name => names.indexOf(name));
if (eyeIndex.some(i => i < 0)) throw Error("Eye joint absent in native skin");
let influencedByEye = 0, influencedByOther = 0;
const otherJointInfluence = new Map<string, number>();
const pupilVertices = new Set<number>();
for (let i = 0; i < nativeCount; i++) {
  let eye = 0, other = 0;
  for (let k = 0; k < 4; k++) {
    const w = skinWeight.getComponent(i, k), j = skinIndex.getComponent(i, k);
    if (eyeIndex.includes(j)) eye += w; else { other += w; if (w > 0) otherJointInfluence.set(names[j]!, (otherJointInfluence.get(names[j]!) ?? 0) + w); }
  }
  if (eye > 1e-6) influencedByEye++; if (other > 1e-6) { influencedByOther++; pupilVertices.add(i); }
}
nativeBind.forEach((v, i) => maxPhaseZeroNativeDrift = Math.max(maxPhaseZeroNativeDrift, v.distanceTo(nativeRestPositions[i]!)));
const mismatches: { distance: number; vertex: number; frame: number; weights: { name: string; weight: number }[] }[] = [];
let maxGazeOnlyRigidDifference = 0, maxPupilRigidDifference = 0;
for (let frame = 0; frame < 663; frame++) {
  const time = frame / 30;
  nativeIdle.seek(time); oldIdle.seek(time); headIdle.seek(time);
  nativeRoot.updateMatrixWorld(true); oldRoot.updateMatrixWorld(true);
  for (const nativeBone of skin.bones) {
    const headBone = historicalHead.skeleton.bones.find(b => b.name === nativeBone.name);
    if (!headBone) continue;
    if (!frame) maxHeadJointPositionGap = Math.max(maxHeadJointPositionGap,
      new THREE.Vector3().setFromMatrixPosition(nativeBone.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld)));
    const nd = nativeBone.matrixWorld.clone().multiply(nativeRestWorld[names.indexOf(nativeBone.name)]!.clone().invert());
    const hd = headBone.matrixWorld.clone().multiply(headRestWorld.get(headBone.name)!.clone().invert());
    maxHeadJointDeltaDisagreement = Math.max(maxHeadJointDeltaDisagreement, ...nd.elements.map((v, k) => Math.abs(v - hd.elements[k]!)));
  }
  for (const name of named) {
    const a = skin.bones.find(b => b.name === name)!, b = eyeBones.find(b => b.name === name)!;
    maxJointWorldDisagreement = Math.max(maxJointWorldDisagreement, ...a.matrixWorld.elements.map((x, k) => Math.abs(x - b.matrixWorld.elements[k]!)));
    const ai = names.indexOf(name), bi = named.indexOf(name);
    const ad = a.matrixWorld.clone().multiply(nativeRestWorld[ai]!.clone().invert());
    const bd = b.matrixWorld.clone().multiply(oldRestWorld[bi]!.clone().invert());
    maxJointDeltaDisagreement = Math.max(maxJointDeltaDisagreement, ...ad.elements.map((x, k) => Math.abs(x - bd.elements[k]!)));
  }
  const n = sample(nativeMesh, nativeCount), o = sample(rigid, oldCount);
  for (let i = 0; i < n.length; i++) {
    const dist = n[i]!.distanceTo(nativeBind[i]!);
    maxNativeMotion = Math.max(maxNativeMotion, dist);
    const side = n[i]!.x < 0 ? 0 : 1;
    perSide[side]!.nativeMotion = Math.max(perSide[side]!.nativeMotion, dist);
    // Rigid counterfactual on this same native vertex around its named eye joint.
    const joint = skin.bones[eyeIndex[side]!]!, bind = boneBindWorld[eyeIndex[side]!]!;
    const rigidPoint = nativeBind[i]!.clone().applyMatrix4(bind.clone().invert()).applyMatrix4(joint.matrixWorld);
    const mismatch = n[i]!.distanceTo(rigidPoint);
    if (pupilVertices.has(i)) maxPupilRigidDifference = Math.max(maxPupilRigidDifference, mismatch);
    else maxGazeOnlyRigidDifference = Math.max(maxGazeOnlyRigidDifference, mismatch);
    if (mismatch > maxNativeVsRigidDelta) { maxNativeVsRigidDelta = mismatch; maxNativeVsRigidVertex = i; maxNativeVsRigidFrame = frame; }
    if (mismatch > 0.0001 && mismatches.length < 2000) mismatches.push({ distance: mismatch, vertex: i, frame,
      weights: Array.from({ length: 4 }, (_, k) => ({ name: names[skinIndex.getComponent(i, k)]!, weight: skinWeight.getComponent(i, k) })).filter(v => v.weight > 1e-6) });
  }
  for (let i = 0; i < o.length; i++) {
    const dist = o[i]!.distanceTo(oldBind[i]!);
    maxOldMotion = Math.max(maxOldMotion, dist);
    const side = o[i]!.x < 0 ? 0 : 1;
    perSide[side]!.oldMotion = Math.max(perSide[side]!.oldMotion, dist);
  }
  for (let side = 0; side < 2; side++) {
    const nc = centroid(n, nativeSides[side]!), oc = centroid(o, oldSides[side]!);
    const gap = nc.clone().sub(n0[side]!).sub(oc.clone().sub(o0[side]!)).length();
    maxCentroidTrajectoryGap = Math.max(maxCentroidTrajectoryGap, gap);
    perSide[side]!.centroidGap = Math.max(perSide[side]!.centroidGap, gap);
  }
}
nativeIdle.setEnabled(false); oldIdle.setEnabled(false); headIdle.setEnabled(false);
nativeRoot.updateMatrixWorld(true); oldRoot.updateMatrixWorld(true);
const nativeRestore = sample(nativeMesh, nativeCount);
const maxNativeRestoreError = Math.max(...nativeRestore.map((v, i) => v.distanceTo(nativeRestPositions[i]!)));
const nativeParts = ["submesh_00_LOD_1_doubled", "submesh_01_LOD_1", "submesh_02_LOD_1"].map(name => {
  const part = native.scene.getObjectByName(name) as THREE.SkinnedMesh;
  if (!(part instanceof THREE.SkinnedMesh)) throw Error(`Missing native ${name}`);
  const index = part.geometry.getAttribute("skinIndex"), weight = part.geometry.getAttribute("skinWeight");
  const groups = { gaze: 0, pupil: 0, eyelid: 0, other: 0 };
  for (let i = 0; i < index.count; i++) for (let k = 0; k < 4; k++) {
    const w = weight.getComponent(i, k); if (w < 1e-6) continue;
    const bone = names[index.getComponent(i, k)]!;
    const group = bone.includes("eye_pupil") ? "pupil" : bone.endsWith("eye_JNT") ? "gaze" : bone.includes("eye_lid") ? "eyelid" : "other";
    groups[group] += w;
  }
  return { name, vertices: index.count, summedWeightByJointRole: groups };
});
const report = {
  inputSha256: Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, sha(p)])),
  source: { nativeVertices: nativeCount, oldVertices: oldCount, nativeJoints: names.length, sampledPhases: 663, durationSeconds: face.animations[0]!.duration },
  bind: { maximumPositionGap: Math.max(...bindDiffs.map(v => v.position)), maximumAngleGapRad: Math.max(...bindDiffs.map(v => v.angleRad)),
    eyeJoints: bindDiffs.filter(v => named.includes(v.name)), nativeCentroids: n0.map(v => v.toArray()), oldCentroids: o0.map(v => v.toArray()),
    centroidDistances: n0.map((v, i) => v.distanceTo(o0[i]!)), influencedByEye, influencedByOther,
    inverseBindError, phaseZeroDisplacementFromRestWithBodyClip: maxPhaseZeroNativeDrift, maxNativeRestoreError,
    otherJointInfluence: [...otherJointInfluence].sort((a,b) => b[1]-a[1]).slice(0, 12) },
  trajectory: { maxNativeVertexMotion: maxNativeMotion, maxHistoricalRigidVertexMotion: maxOldMotion,
    maxCentroidMotionDifference: maxCentroidTrajectoryGap, maxSharedEyeJointMatrixDifference: maxJointWorldDisagreement,
    maxSharedEyeJointDeltaDifference: maxJointDeltaDisagreement,
    maxNativeVsCurrentHeadJointDeltaDifference: maxHeadJointDeltaDisagreement,
    maxNativeVsCurrentHeadJointPositionGap: maxHeadJointPositionGap,
    maxNativeVsRigidOnNativeVertex: maxNativeVsRigidDelta, maxNativeVsRigidVertex, maxNativeVsRigidFrame,
    maxGazeOnlyRigidDifference, maxPupilRigidDifference,
    perSide, largestOtherWeightMismatches: mismatches.sort((a,b) => b.distance-a.distance).slice(0, 8) },
  nativeParts, missingHeadJoints,
};
if (inverseBindError > 1e-5 || maxJointDeltaDisagreement > 1e-5 || maxHeadJointDeltaDisagreement > 1e-5 || maxNativeRestoreError > 1e-5)
  throw Error(`Bind/delta check failed: ${inverseBindError}, ${maxJointDeltaDisagreement}, ${maxHeadJointDeltaDisagreement}, ${maxNativeRestoreError}`);
writeFileSync(resolve(import.meta.dir, "evidence.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
