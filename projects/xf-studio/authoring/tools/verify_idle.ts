// Offline acceptance checks against local decoded assets, not a game-fidelity claim.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../src/idle-animation";
import { extendSkin, restoreFirstWeights } from "../src/skin";
import { writeFileSync } from "node:fs";
const asset = (name: string) => new URL(`../public/assets/${name}`,import.meta.url);
const read = async (name: string) => new GLTFLoader().parseAsync(await Bun.file(asset(name)).arrayBuffer(),"");
const [body,face,head,brows,lashes] = await Promise.all(["cc-idle-body.glb","cc-idle-face.glb","head.glb","brows.glb","lashes.glb"].map(read));
const target = new THREE.Group(), bones: THREE.Bone[] = [], meshes: THREE.SkinnedMesh[] = [];
const browMeshes = new Set<THREE.SkinnedMesh>();
for (const [i,gltf] of [head!,brows!,lashes!].entries()) {
  const weights = restoreFirstWeights(await Bun.file(asset(["head.glb","brows.glb","lashes.glb"][i]!)).arrayBuffer());
  target.add(gltf.scene);
  gltf.scene.traverse(o => {
    if(o instanceof THREE.Bone) bones.push(o);
    if(o instanceof THREE.SkinnedMesh) {
      const a=gltf.parser.associations.get(o),name=gltf.parser.json.meshes[a?.meshes ?? -1]?.name;
      o.geometry.setAttribute("skinWeight",new THREE.BufferAttribute(weights.get(name)!,4));
      extendSkin(o,o.material as THREE.MeshStandardMaterial); meshes.push(o);
      if (i === 1) browMeshes.add(o);
    }
  });
}
target.updateMatrixWorld(true);
const binding = await Bun.file(asset("cc-idle-binding.json")).json();
const idle = new IdleAnimation(body!.scene,body!.animations[0]!,bones,binding.ancestry,{source:face!.scene,clip:face!.animations[0]!});
if(idle.unmapped.length) throw Error(`Unmapped bones: ${idle.unmapped.join(",")}`);
const originals=bones.map(b => b.matrixWorld.clone());
if (process.argv.includes("--controls")) {
  const headBindings = idle.bindings.filter(b => b.bone.name === "Head");
  if (!headBindings.length) throw Error("Missing structural Head targets");
  const tracked = ["l_J_eye_JNT", "r_J_eye_JNT", "mid_J_jaw_JNT", "l_J_eye_lid_up_rowA_1_JNT",
    "l_J_eye_brows_rowA_2_JNT", "r_J_eye_brows_rowA_2_JNT"];
  const samples = new Map<string, number[][]>();
  const browTrajectories: Record<string, { min: THREE.Vector3; max: THREE.Vector3 }[]> = {};
  const savedShapes = ["h091_eyes", "h012_nose", "h053_mouth", "h054_jaw", "h145_ear"];
  let headDrift = 0, maxDeltaMismatch = 0, checkedVertices = 0;
  idle.setContributions({ body: false, face: true }); idle.setEnabled(true);
  const headRest = headBindings.map(b => b.worldBind);
  for (const shape of ["neutral", "saved-face"]) {
    const browBounds = browTrajectories[shape] = [...browMeshes].flatMap(mesh =>
      Array.from({ length: mesh.geometry.getAttribute("position").count }, () => ({
        min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
      })));
    for (const mesh of meshes) for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      mesh.morphTargetInfluences![index] = shape === "saved-face" && savedShapes.includes(name) ? 1 : 0;
    }
    const headMesh = meshes.find(m => m.name === "head")!;
    if (headMesh.morphTargetInfluences!.filter(v => v === 1).length !== (shape === "saved-face" ? 5 : 0))
      throw Error("Expected customization shapes were not actually applied");
    for (let frame = 0; frame <= 663; frame += 3) {
      idle.seek(frame / 30); target.updateMatrixWorld(true);
      headBindings.forEach((b, i) => b.bone.matrixWorld.elements.forEach((v, j) => headDrift = Math.max(headDrift, Math.abs(v - headRest[i]!.elements[j]!))));
      const deltas = new Map<string, THREE.Matrix4>();
      for (const b of idle.bindings) {
        const delta = b.bone.matrixWorld.clone().multiply(b.worldBind.clone().invert()), previous = deltas.get(b.bone.name);
        if (previous) delta.elements.forEach((v, j) => maxDeltaMismatch = Math.max(maxDeltaMismatch, Math.abs(v - previous.elements[j]!)));
        else deltas.set(b.bone.name, delta);
      }
      if (shape === "neutral") for (const name of tracked) {
        const b = idle.bindings.find(b => b.bone.name === name);
        if (!b) throw Error(`Missing facial target ${name}`);
        const values = samples.get(name) ?? []; values.push(b.bone.matrixWorld.toArray()); samples.set(name, values);
      }
      let browIndex = 0;
      for (const mesh of meshes) for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) {
        const point = mesh.getVertexPosition(i, new THREE.Vector3());
        if (!point.toArray().every(Number.isFinite)) throw Error("Nonfinite facial-only vertex");
        if (browMeshes.has(mesh)) {
          browBounds[browIndex]!.min.min(point); browBounds[browIndex]!.max.max(point); browIndex++;
        }
        checkedVertices++;
      }
    }
  }
  const ranges = Object.fromEntries([...samples].map(([name, frames]) => [name,
    Math.max(...frames[0]!.map((_, i) => Math.max(...frames.map(f => f[i]!)) - Math.min(...frames.map(f => f[i]!))))]));
  const browCardTrajectory = Object.fromEntries(Object.entries(browTrajectories).map(([shape, bounds]) => {
    const diagonals = bounds.map(b => b.min.distanceTo(b.max)).sort((a, b) => a - b);
    return [shape, { vertices: bounds.length, minimum: diagonals[0], median: diagonals[Math.floor(diagonals.length / 2)], maximum: diagonals.at(-1) }];
  }));
  if (!browMeshes.size || Object.values(browCardTrajectory).some(v => !v.vertices || !v.maximum || v.maximum < 1e-5))
    throw Error("Facial-only brow card motion is absent");
  if (headDrift > 1e-9 || maxDeltaMismatch > 1e-8 || Object.values(ranges).some(v => v < 1e-5)) throw Error("Facial-only composition failed");
  idle.seek(7.125); idle.setPaused(true);
  const held = bones.map(b => b.matrixWorld.toArray());
  for (let i = 0; i < 100; i++) idle.update(.1);
  const pauseError = Math.max(...bones.flatMap((b, i) => b.matrixWorld.elements.map((v, j) => Math.abs(v - held[i]![j]!))));
  if (idle.time !== 7.125 || pauseError !== 0) throw Error("Paused real-asset pose changed");
  idle.setEnabled(false); target.updateMatrixWorld(true);
  const resetError = Math.max(...bones.flatMap((b, i) => b.matrixWorld.elements.map((v, j) => Math.abs(v - originals[i]!.elements[j]!))));
  if (resetError > 1e-10) throw Error("Real-asset reset failed");
  const report = { mappedBones: bones.length, shapes: ["neutral", "saved-face"], savedShapes, samplesPerShape: 222, sampledSeconds: 22.1,
    headDrift, maxDeltaMismatch, facialTargetMatrixRanges: ranges, browCardTrajectory, checkedVertices, pauseError, resetError,
    limitations: ["Offline local rigs, not game graph/shading parity", "The browser separately attaches two rigid eyeballs; this offline harness does not instantiate those extra bindings."] };
  writeFileSync(new URL('../evidence/idle-controls-offline-check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); process.exit(0);
}
const reference = new Map<string, number[][]>();
const controls=["l_J_eye_JNT","r_J_eye_JNT","mid_J_jaw_JNT","l_J_mug_lip_up_0_JNT","l_J_eye_lid_up_root_1_JNT"];
let maxSharedBoneDifference=0,maxVertexDisplacement=0;
const rest=meshes.map(m => Array.from({length:m.geometry.getAttribute("position").count},(_,i)=>m.getVertexPosition(i,new THREE.Vector3())));
idle.setEnabled(true);
for(let frame=0;frame<=663;frame++) {
  if(frame) idle.update(1/30);
  if(frame%10!==0 && frame!==25 && frame!==663) continue;
  target.updateMatrixWorld(true);
  const same=new Map<string,THREE.Matrix4>();
  for(const b of bones) {
    const previous=same.get(b.name);
    if(previous) maxSharedBoneDifference=Math.max(maxSharedBoneDifference,...b.matrixWorld.elements.map((v,i)=>Math.abs(v-previous.elements[i]!)));
    else same.set(b.name,b.matrixWorld);
  }
  for(const name of controls) {
    const b=face!.scene.getObjectByName(name)!;
    const values=reference.get(name)??[];values.push([...b.position.toArray(),...b.quaternion.toArray()]);reference.set(name,values);
  }
  for(const [mi,m] of meshes.entries()) for(let i=0;i<rest[mi]!.length;i++) {
    const point=m.getVertexPosition(i,new THREE.Vector3());
    if(!point.toArray().every(Number.isFinite)) throw Error(`Non-finite ${m.name} vertex ${i}`);
    maxVertexDisplacement=Math.max(maxVertexDisplacement,point.distanceTo(rest[mi]![i]!));
  }
}
const motion=Object.fromEntries([...reference].map(([name,samples])=>[name,Math.max(...samples[0]!.map((_,i)=>Math.max(...samples.map(x=>x[i]!))-Math.min(...samples.map(x=>x[i]!))))]));
if(Object.values(motion).some(range=>range<1e-5)) throw Error("Expected gaze, mouth and eyelid movement is absent");
idle.setEnabled(false);target.updateMatrixWorld(true);
const restoreError=Math.max(...bones.flatMap((b,i)=>b.matrixWorld.elements.map((v,j)=>Math.abs(v-originals[i]!.elements[j]!))));
if(restoreError>1e-10 || maxVertexDisplacement>0.5) throw Error("Restore failure or implausibly large deformation");
const report={mappedBones:bones.length,unmapped:idle.unmapped,sampledSeconds:663/30,facialControlTransformRanges:motion,maxVertexDisplacement,maxSharedBoneDifference,restoreError,
  limitations:["Duplicate source rigs can have different bind matrices; shared-bone difference is reported, not treated as game parity.","No visual parity, wrinkle shading or animation-graph synchronization proof."]};
writeFileSync(new URL('../evidence/idle-offline-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
