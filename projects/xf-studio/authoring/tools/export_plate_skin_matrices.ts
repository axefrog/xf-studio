// Diagnostic affine skin transport for a fixed saved shape. No asset mutation.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IdleAnimation } from "../src/idle-animation";
import { extendSkin, restoreFirstWeights, skinSets } from "../src/skin";
import { resolve } from "node:path";
const experiment = resolve(import.meta.dir, "../../../../experiments/006-plate-clearance");
const root = (await Bun.file(resolve(experiment, "latest-build.json")).json()).root;
const build = await Bun.file(resolve(root, "build.json")).json();
if (!build.preserveHeadWeights) throw Error("Requires retained native weights");
const manifest = await Bun.file(resolve(root, "posed/manifest.json")).json();
const mapping: number[] = (await Bun.file(build.mapping).json()).plateToHeadIndices;
const assets = resolve(import.meta.dir, "../public/assets");
const hash = (a: ArrayBuffer) => new Bun.CryptoHasher("sha256").update(a).digest("hex");
const load = async (path: string) => {
  const bytes = await Bun.file(path).arrayBuffer();
  return { gltf: await new GLTFLoader().parseAsync(bytes, ""), bytes, sha256: hash(bytes), path };
};
const [body, face, head] = await Promise.all([load(resolve(assets,"cc-idle-body.glb")), load(resolve(assets,"cc-idle-face.glb")), load(build.head)]);
const binding = await Bun.file(resolve(assets, "cc-idle-binding.json")).json();
if (body.sha256 !== manifest.animationHashes.body || face.sha256 !== manifest.animationHashes.facial) throw Error("Animation differs from retained samples");
if (head.sha256 !== manifest.surfaces.find((s: any)=>s.name === "head").sha256) throw Error("Head differs from retained samples");
const scene = head.gltf.scene, bones: THREE.Bone[] = [], meshes: THREE.SkinnedMesh[] = [];
const weights = restoreFirstWeights(head.bytes);
scene.traverse(o => {
  if (o instanceof THREE.Bone) bones.push(o);
  if (!(o instanceof THREE.SkinnedMesh)) return;
  const a = head.gltf.parser.associations.get(o), name = head.gltf.parser.json.meshes[a?.meshes ?? -1]?.name;
  if (!weights.has(name)) throw Error("Missing original weights");
  o.geometry.setAttribute("skinWeight",new THREE.BufferAttribute(weights.get(name)!,4));
  extendSkin(o,new THREE.MeshStandardMaterial());
  o.morphTargetInfluences!.fill(0);
  for (const name of ["h091_eyes","h012_nose","h053_mouth","h054_jaw","h145_ear"]) {
    const i = o.morphTargetDictionary?.[name]; if (i === undefined) throw Error(name);
    o.morphTargetInfluences![i] = 1;
  }
  meshes.push(o);
});
if (meshes.length !== 1) throw Error("Expected one head");
scene.updateMatrixWorld(true);
const mesh = meshes[0]!, sets = skinSets(mesh.geometry);
const idle = new IdleAnimation(body.gltf.scene,body.gltf.animations[0]!,bones,binding.ancestry,{source:face.gltf.scene,clip:face.gltf.animations[0]!});
if (idle.unmapped.length) throw Error("Unmapped bones");
idle.setEnabled(true);
const old = new Float64Array(await Bun.file(resolve(root,"posed/head.positions.f64")).arrayBuffer());
const count = mesh.geometry.getAttribute("position").count;
const linear = new Float64Array(manifest.frames.length*mapping.length*9);
const translation = new Float64Array(manifest.frames.length*mapping.length*3);
const rest = new Float64Array(mapping.length*3);
const m = new THREE.Matrix4(), sum = new THREE.Matrix4(), affine = new THREE.Matrix4();
const p = new THREE.Vector3(), d = new THREE.Vector3(), direct = new THREE.Vector3(), reconstructed = new THREE.Vector3();
let reconstructionError=0, priorSampleError=0, perturbationError=0;
for (let k=0;k<mapping.length;k++) {
  const i=mapping[k]!;
  p.fromBufferAttribute(mesh.geometry.getAttribute("position"),i);
  mesh.morphTargetInfluences!.forEach((w,j)=> {if(w) p.addScaledVector(d.fromBufferAttribute(mesh.geometry.morphAttributes.position![j]!,i),w);});
  rest.set(p.toArray(),k*3);
}
for (let s=0;s<manifest.frames.length;s++) {
  idle.seek(manifest.frames[s]/30); scene.updateMatrixWorld(true);
  for (let k=0;k<mapping.length;k++) {
    const i=mapping[k]!; sum.elements.fill(0);
    for (const set of sets) for(let c=0;c<4;c++) {
      const w=mesh.geometry.getAttribute(set.w).getComponent(i,c); if(!w) continue;
      const j=mesh.geometry.getAttribute(set.j).getComponent(i,c);
      m.multiplyMatrices(mesh.skeleton.bones[j]!.matrixWorld,mesh.skeleton.boneInverses[j]!);
      for(let q=0;q<16;q++) sum.elements[q]!+=w*m.elements[q]!;
    }
    affine.copy(mesh.bindMatrixInverse).multiply(sum).multiply(mesh.bindMatrix);
    // CPU Vector3 adapter retains xyz without homogeneous division, then applies world.
    affine.elements[3]=affine.elements[7]=affine.elements[11]=0; affine.elements[15]=1;
    affine.premultiply(mesh.matrixWorld);
    p.fromArray(rest,k*3); reconstructed.copy(p).applyMatrix4(affine);
    mesh.getVertexPosition(i,direct).applyMatrix4(mesh.matrixWorld);
    reconstructionError=Math.max(reconstructionError,direct.distanceTo(reconstructed));
    d.fromArray(old,(s*count+i)*3); priorSampleError=Math.max(priorSampleError,d.distanceTo(direct));
    for(let row=0;row<3;row++) {
      translation[(s*mapping.length+k)*3+row]=affine.elements[12+row]!;
      for(let col=0;col<3;col++) linear[(s*mapping.length+k)*9+row*3+col]=affine.elements[col*4+row]!;
    }
    // Independent direct adapter perturbation versus exported affine for three basis axes.
    for(let axis=0;axis<3;axis++) {
      d.copy(p);d.setComponent(axis,d.getComponent(axis)+.00025);
      reconstructed.copy(d).applyMatrix4(affine);
      mesh.applyBoneTransform(i,d).applyMatrix4(mesh.matrixWorld);
      perturbationError=Math.max(perturbationError,d.distanceTo(reconstructed));
    }
  }
}
if(Math.max(reconstructionError,priorSampleError,perturbationError)>1e-10) throw Error("Skin reconstruction tolerance exceeded");
for(const [name,data] of [["linear",linear],["translation",translation],["rest",rest]] as const) await Bun.write(resolve(root,`fixed_${name}.f64`),new Uint8Array(data.buffer));
const report={root,frames:manifest.frames,vertices:mapping.length,mappedBones:idle.bindings.length,sets:sets.length,reconstructionError,priorSampleError,perturbationError,tolerance:1e-10,layout:"little-endian float64; sample, mapped plate vertex, row-major matrix (9) or xyz (3); rest has no sample axis",inputs:[head,body,face].map(({path,sha256})=>({path,sha256})),limits:["Exact affine adapter reconstruction is not REDengine shader/animation graph validation.","Fixed pre-skin displacement is in the saved five-morph head's local coordinates."]};
await Bun.write(resolve(root,"fixed_skin_manifest.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));
