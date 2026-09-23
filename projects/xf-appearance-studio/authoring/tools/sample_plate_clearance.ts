// Sample actual converted head/plate geometry under the current decoded idle adapter.
// Does not execute the game's animation graph; all outputs are local research data.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../src/idle-animation";
import { extendSkin, restoreFirstWeights } from "../src/skin";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const experiment = resolve(import.meta.dir, "../../../../experiments/006-plate-clearance");
const root = (await Bun.file(resolve(experiment, "latest-build.json")).json()).root;
const build = await Bun.file(resolve(root, "build.json")).json();
const assets = resolve(import.meta.dir, "../public/assets");
const load = async (path: string) => {
  const bytes = await Bun.file(path).arrayBuffer();
  return { gltf: await new GLTFLoader().parseAsync(bytes, ""), bytes };
};
const [body, face] = await Promise.all(["cc-idle-body.glb", "cc-idle-face.glb"].map(n => load(resolve(assets,n))));
const binding = await Bun.file(resolve(assets, "cc-idle-binding.json")).json();
const cases: {name: string; path: string}[] = [{name:"head",path:build.head}, {name:"zero",path:build.zeroControl},
  ...build.candidates.map((c: {name:string; roundtrip:string}) => ({name:c.name,path:c.roundtrip}))];
const scene = new THREE.Group(), bones: THREE.Bone[] = [];
const surfaces: {name:string; mesh:THREE.SkinnedMesh; hash:string}[] = [];
for (const c of cases) {
  const {gltf,bytes} = await load(c.path), weights = restoreFirstWeights(bytes);
  scene.add(gltf.scene);
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse(o => {
    if (o instanceof THREE.Bone) bones.push(o);
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const a = gltf.parser.associations.get(o), name = gltf.parser.json.meshes[a?.meshes ?? -1]?.name;
    if (!weights.has(name)) throw Error(`Missing full weights for ${c.name}`);
    o.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights.get(name)!,4));
    extendSkin(o, new THREE.MeshStandardMaterial());
    o.morphTargetInfluences!.fill(0);
    for (const morph of ["h091_eyes","h012_nose","h053_mouth","h054_jaw","h145_ear"]) {
      const index = o.morphTargetDictionary?.[morph];
      if (index === undefined) throw Error(`Missing morph ${morph}`);
      o.morphTargetInfluences![index] = 1;
    }
    meshes.push(o);
  });
  if (meshes.length !== 1) throw Error(`Expected one surface in ${c.name}`);
  surfaces.push({name:c.name,mesh:meshes[0]!,hash:new Bun.CryptoHasher("sha256").update(bytes).digest("hex")});
}
scene.updateMatrixWorld(true);
const idle = new IdleAnimation(body!.gltf.scene,body!.gltf.animations[0]!,bones,binding.ancestry,
  {source:face!.gltf.scene,clip:face!.gltf.animations[0]!});
if (idle.unmapped.length) throw Error(`Unmapped bones: ${idle.unmapped.join(",")}`);
idle.setEnabled(true);
const frames = Math.ceil(face!.gltf.animations[0]!.duration*30);
const selected = new Set(Array.from({length:Math.floor(frames/10)+1},(_,i) => i*10));
selected.add(frames);
const extrema: Record<string,{min:number;max:number;minFrame:number;maxFrame:number}> = {};
for (let frame=0;frame<=frames;frame++) {
  idle.seek(frame/30);
  for (const side of ["l","r"]) for (const row of [1,2]) {
    const upper = face!.gltf.scene.getObjectByName(`${side}_J_eye_lid_up_rowA_${row}_JNT`);
    const lower = face!.gltf.scene.getObjectByName(`${side}_J_eye_lid_dn_rowA_${row}_JNT`);
    if (!upper || !lower) throw Error("Missing eyelid sampling anchors");
    const distance = upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3()));
    const key = `${side}_${row}`, value = extrema[key] ?? {min:Infinity,max:-Infinity,minFrame:0,maxFrame:0};
    if (distance < value.min) {value.min=distance;value.minFrame=frame;}
    if (distance > value.max) {value.max=distance;value.maxFrame=frame;}
    extrema[key]=value;
  }
}
for (const e of Object.values(extrema)) {
  if (e.max-e.min < 1e-5) throw Error("Eyelid sampling anchors have no measurable motion");
  selected.add(e.minFrame);selected.add(e.maxFrame);
}
const folder = resolve(root,"posed"); mkdirSync(folder,{recursive:true});
const samples = [...selected].sort((a,b)=>a-b), point = new THREE.Vector3(), normal = new THREE.Vector4(), delta = new THREE.Vector3();
for (const {name,mesh} of surfaces) {
  const vertexCount = mesh.geometry.getAttribute("position").count;
  const positions = new Float64Array(samples.length*vertexCount*3);
  const normals = name === "head" ? new Float64Array(positions.length) : undefined;
  const normalMatrix = new THREE.Matrix3();
  for (const [sample,frame] of samples.entries()) {
    idle.seek(frame/30); scene.updateMatrixWorld(true);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let i=0;i<vertexCount;i++) {
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
      const index = (sample*vertexCount+i)*3;
      positions.set(point.toArray(),index);
      if (normals) {
        point.fromBufferAttribute(mesh.geometry.getAttribute("normal"),i);
        mesh.morphTargetInfluences!.forEach((weight,j) => {
          if (weight) point.addScaledVector(delta.fromBufferAttribute(mesh.geometry.morphAttributes.normal![j]!,i),weight);
        });
        normal.set(point.x,point.y,point.z,0);
        mesh.applyBoneTransform(i, normal);
        point.set(normal.x,normal.y,normal.z).applyMatrix3(normalMatrix).normalize();
        normals.set(point.toArray(),index);
      }
    }
  }
  if (!positions.every(Number.isFinite) || (normals && !normals.every(Number.isFinite))) throw Error("Non-finite posed geometry");
  await Bun.write(resolve(folder,`${name}.positions.f64`),new Uint8Array(positions.buffer));
  if (normals) await Bun.write(resolve(folder,`${name}.normals.f64`),new Uint8Array(normals.buffer));
  console.log(`Sampled ${name}: ${samples.length} poses, ${vertexCount} vertices`);
}
const manifest = {root,frames:samples,rate:30,seconds:samples.map(f=>f/30),extrema,
  surfaces:surfaces.map(s=>({name:s.name,vertices:s.mesh.geometry.getAttribute("position").count,sha256:s.hash})),
  mappedBones:idle.bindings.length,unmappedBones:idle.unmapped,
  animationHashes:Object.fromEntries([body!,face!].map((a,i)=>[i?"facial":"body",new Bun.CryptoHasher("sha256").update(a.bytes).digest("hex")])),
  limitations:["Current decoded idle adapter, not execution of the REDengine animation graph.",
    "One saved morph combination, samples every ten frames plus eyelid-anchor distance extrema; not a continuous collision proof.",
    "Includes all eight skin influences and actual resource quantization; rendering and depth-buffer precision are not tested."]};
await Bun.write(resolve(folder,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({samples:samples.length,frames,mappedBones:idle.bindings.length,extrema}));
