import {expect,test} from "bun:test";
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {createSurfaceOcclusion} from "../src/surface-occlusion";
import {extendSkin,restoreFirstWeights} from "../src/skin";

function reference(mesh:THREE.Mesh,ray:THREE.Ray,limit:number){
  const caster=new THREE.Raycaster();caster.ray.copy(ray);
  return caster.intersectObject(mesh,false).some(hit=>hit.distance<limit);
}
test("occlusion BVH matches material sides, groups, draw range and reflected world transforms",()=>{
  const materials=[THREE.FrontSide,THREE.BackSide,THREE.DoubleSide,THREE.FrontSide,THREE.DoubleSide,THREE.BackSide]
    .map(side=>new THREE.MeshBasicMaterial({side}));
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1,3,3,3),materials),helper=createSurfaceOcclusion(mesh);
  for(const reflected of [false,true]){
    mesh.scale.x=reflected?-1.2:1.2;mesh.rotation.set(.13,.21,-.07);mesh.updateMatrixWorld();
    for(let i=0;i<24;i++){
      const origin=new THREE.Vector3(Math.cos(i)*2,Math.sin(i*.7)*2,Math.sin(i)*2),ray=new THREE.Ray(origin,origin.clone().negate().normalize());
      for(const limit of [.5,1.5,4])expect(helper.occluded(ray,limit)).toBe(reference(mesh,ray,limit));
    }
  }
  mesh.geometry.setDrawRange(18,42);
  for(let i=0;i<12;i++){
    const origin=new THREE.Vector3(Math.cos(i)*2,Math.sin(i*.7)*2,Math.sin(i)*2),ray=new THREE.Ray(origin,origin.clone().negate().normalize());
    expect(helper.occluded(ray,4)).toBe(reference(mesh,ray,4));
  }
  expect(helper.diagnostics().refits).toBe(3);
});

test("unchanged poses reuse samples; morph, bone, bind, geometry and world changes invalidate",()=>{
  const geometry=new THREE.PlaneGeometry(1,1,4,4),count=geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(new Uint16Array(count*4),4));
  const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute("skinWeight",new THREE.Float32BufferAttribute(weights,4));
  geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(new Float32Array(count*3).fill(.1),3)];geometry.morphTargetsRelative=true;
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),bone=new THREE.Bone();
  mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.updateMatrixWorld(true);
  const helper=createSurfaceOcclusion(mesh),ray=new THREE.Ray(new THREE.Vector3(0,0,2),new THREE.Vector3(0,0,-1));
  const query=()=>helper.occluded(ray,3);
  expect(query()).toBe(true);for(let i=0;i<20;i++)query();
  expect(helper.diagnostics().refits).toBe(1);expect(helper.diagnostics().sampledVertices).toBe(count);
  const changes=[()=>{mesh.morphTargetInfluences![0]=.5;},()=>{bone.rotation.y=.1;mesh.updateMatrixWorld(true);},
    ()=>{mesh.bindMatrix.elements[12]=.01;},()=>{geometry.getAttribute("position").needsUpdate=true;},
    ()=>{mesh.position.x=.01;mesh.updateMatrixWorld(true);},()=>{geometry.setAttribute("position",geometry.getAttribute("position").clone());}];
  for(const change of changes){const before=helper.diagnostics();change();query();
    expect(helper.diagnostics().refits).toBe(before.refits+1);expect(helper.diagnostics().sampledVertices).toBe(before.sampledVertices+count);
    query();expect(helper.diagnostics().refits).toBe(before.refits+1);}
});

test("local real head BVH matches eight-influence ray picking through rest, morph and skin poses",async()=>{
  const bytes=await Bun.file(new URL("../public/assets/head.glb",import.meta.url)).arrayBuffer(),
    gltf=await new GLTFLoader().parseAsync(bytes,""),weights=restoreFirstWeights(bytes);
  const head=gltf.scene.getObjectByName("head") as THREE.SkinnedMesh;
  expect(head instanceof THREE.SkinnedMesh).toBe(true);
  const association=gltf.parser.associations.get(head),name=gltf.parser.json.meshes[association?.meshes??-1].name;
  head.geometry.setAttribute("skinWeight",new THREE.BufferAttribute(weights.get(name)!,4));
  const material=new THREE.MeshStandardMaterial({side:THREE.DoubleSide});head.material=material;extendSkin(head,material);
  head.morphTargetInfluences!.fill(0);gltf.scene.updateMatrixWorld(true);
  const helper=createSurfaceOcclusion(head),index=head.geometry.index!,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const bone=head.skeleton.bones.find(bone=>/eye_lid.*rowA_1/.test(bone.name))??head.skeleton.bones[0];
  const morph=head.morphTargetDictionary?.h091_eyes;expect(morph).toBeDefined();
  let hits=0,misses=0;
  for(let pose=0;pose<3;pose++){
    if(pose===1)head.morphTargetInfluences![morph!]=.8;
    if(pose===2)bone.rotation.x+=.08;
    gltf.scene.updateMatrixWorld(true);head.computeBoundingSphere();
    for(let i=0;i<16;i++){
      const triangle=Math.floor((i+.37)*(index.count/3)/16)*3;
      head.getVertexPosition(index.getX(triangle),a).applyMatrix4(head.matrixWorld);
      head.getVertexPosition(index.getX(triangle+1),b).applyMatrix4(head.matrixWorld);
      head.getVertexPosition(index.getX(triangle+2),c).applyMatrix4(head.matrixWorld);
      const centre=a.clone().add(b).add(c).divideScalar(3),normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const origin=centre.clone().addScaledVector(normal,.3),ray=new THREE.Ray(origin,normal.negate());
      for(const limit of [.2999,.3001]){
        const expected=reference(head,ray,limit);if(expected)hits++;else misses++;
        expect(helper.occluded(ray,limit)).toBe(expected);
      }
    }
  }
  expect(hits).toBeGreaterThan(0);expect(misses).toBeGreaterThan(0);
  expect(helper.diagnostics().refits).toBe(3);
  expect(helper.diagnostics().sampledVertices).toBe(3*head.geometry.getAttribute("position").count);
  console.log("Real head projected-control occlusion",{...helper.diagnostics(),rays:48,thresholdComparisons:96,hits,misses});
});
