import {expect,test} from "bun:test";
import * as THREE from "three";
import {tangentFrame,tangentRayUV,tangentWorld} from "../src/surface-tangent";
import type {Anchor} from "../src/surface-map";

function fixture(reflected=false){
  const geometry=new THREE.BufferGeometry();
  const sourceUV=[.1,.2,.3,.2,.1,.4];
  geometry.setAttribute("uv",new THREE.BufferAttribute(new Float64Array(sourceUV.map((value,i)=>reflected&&i%2===0?1-value:value)),2));
  const positions=[new THREE.Vector3(0,0,0),new THREE.Vector3(2,.2,.1),new THREE.Vector3(.4,1.5,.3)];
  const anchor:Anchor={indices:[0,1,2],weights:[.2,.3,.5]},uv={u:reflected?.84:.16,v:.3};
  return {geometry,positions,anchor,uv};
}

test("projected tangent inverse is exact outside the triangle and follows deformed vertices",()=>{
  const {geometry,positions,anchor,uv}=fixture();
  for(const transform of [new THREE.Matrix4(),new THREE.Matrix4().compose(new THREE.Vector3(.2,-.1,.5),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(.4,-.3,.2)),new THREE.Vector3(1.4,.7,1.1))]){
    const deformed=positions.map(p=>p.clone().applyMatrix4(transform));
    const frame=tangentFrame(geometry,anchor,uv,i=>deformed[i])!;
    expect(frame).toBeDefined();
    for(const endpoint of [{u:.17,v:.32},{u:.8,v:-.2},{u:-.5,v:1.1}]){
      const world=tangentWorld(frame,endpoint),ray=new THREE.Ray(world.clone().addScaledVector(frame.normal,2),frame.normal.clone().negate());
      const result=tangentRayUV(frame,ray)!;
      expect(result.u).toBeCloseTo(endpoint.u,10);expect(result.v).toBeCloseTo(endpoint.v,10);
    }
    const parent=tangentWorld(frame,uv);
    expect(parent.distanceTo(frame.origin)).toBe(0);
    expect(frame.normal.length()).toBeCloseTo(1,12);
  }
});

test("reflected UV orientation reverses its derivative without reversing world front-face normal",()=>{
  const a=fixture(),b=fixture(true),
    left=tangentFrame(a.geometry,a.anchor,a.uv,i=>a.positions[i])!,
    right=tangentFrame(b.geometry,b.anchor,b.uv,i=>b.positions[i])!;
  expect(left.normal.distanceTo(right.normal)).toBeLessThan(1e-12);
  expect(left.du.clone().add(right.du).length()).toBeLessThan(1e-12);
  expect(left.dv.distanceTo(right.dv)).toBeLessThan(1e-12);
  const world=tangentWorld(left,{u:.4,v:.1}),mirrored=tangentWorld(right,{u:.6,v:.1});
  expect(world.distanceTo(mirrored)).toBeLessThan(1e-12);
  const ray=new THREE.Ray(world.clone().addScaledVector(left.normal,2),left.normal.clone().negate());
  expect(tangentRayUV(right,ray)!.u).toBeCloseTo(.6,12);
});

test("singular, ill-conditioned, grazing and rearward projections refuse to fabricate UVs",()=>{
  const {geometry,positions,anchor,uv}=fixture(),frame=tangentFrame(geometry,anchor,uv,i=>positions[i])!;
  expect(tangentRayUV(frame,new THREE.Ray(frame.origin.clone().add(frame.normal),frame.du.clone().normalize()))).toBeUndefined();
  expect(tangentRayUV(frame,new THREE.Ray(frame.origin.clone().add(frame.normal),frame.normal.clone()))).toBeUndefined();
  expect(tangentFrame(geometry,anchor,uv,i=>new THREE.Vector3(i,0,0))).toBeUndefined();
  expect(tangentFrame(geometry,anchor,uv,i=>new THREE.Vector3(i,i===2?1e-10:0,0))).toBeUndefined();
  geometry.setAttribute("uv",new THREE.BufferAttribute(new Float64Array([0,0,0,0,0,0]),2));
  expect(tangentFrame(geometry,anchor,uv,i=>positions[i])).toBeUndefined();
});
