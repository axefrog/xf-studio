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
for (const [i,gltf] of [head!,brows!,lashes!].entries()) {
  const weights = restoreFirstWeights(await Bun.file(asset(["head.glb","brows.glb","lashes.glb"][i]!)).arrayBuffer());
  target.add(gltf.scene);
  gltf.scene.traverse(o => {
    if(o instanceof THREE.Bone) bones.push(o);
    if(o instanceof THREE.SkinnedMesh) {
      const a=gltf.parser.associations.get(o),name=gltf.parser.json.meshes[a?.meshes ?? -1]?.name;
      o.geometry.setAttribute("skinWeight",new THREE.BufferAttribute(weights.get(name)!,4));
      extendSkin(o,o.material as THREE.MeshStandardMaterial); meshes.push(o);
    }
  });
}
target.updateMatrixWorld(true);
const binding = await Bun.file(asset("cc-idle-binding.json")).json();
const idle = new IdleAnimation(body!.scene,body!.animations[0]!,bones,binding.ancestry,{source:face!.scene,clip:face!.animations[0]!});
if(idle.unmapped.length) throw Error(`Unmapped bones: ${idle.unmapped.join(",")}`);
const originals=bones.map(b => b.matrixWorld.clone());
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
