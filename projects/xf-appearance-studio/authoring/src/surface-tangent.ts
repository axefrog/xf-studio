import * as THREE from "three";
import { anchorPosition, type Anchor, type UV } from "./surface-map";

/** A vector-control plane derived from a real, deformed parent triangle.
 * Positions outside that triangle are UI projections, never mesh anchors. */
export type TangentFrame = {origin:THREE.Vector3; du:THREE.Vector3; dv:THREE.Vector3;
  normal:THREE.Vector3; uv:UV};
export function tangentFrame(geometry:THREE.BufferGeometry, anchor:Anchor, uv:UV,
  vertex:(i:number)=>THREE.Vector3):TangentFrame | undefined {
  const coordinates=geometry.getAttribute("uv"), [a,b,c]=anchor.indices;
  const u1=coordinates.getX(b)-coordinates.getX(a),v1=coordinates.getY(b)-coordinates.getY(a),
    u2=coordinates.getX(c)-coordinates.getX(a),v2=coordinates.getY(c)-coordinates.getY(a),det=u1*v2-u2*v1;
  if(!Number.isFinite(det)||Math.abs(det)<1e-12)return;
  const p=vertex(a),e1=vertex(b).clone().sub(p),e2=vertex(c).clone().sub(p);
  const du=e1.clone().multiplyScalar(v2).addScaledVector(e2,-v1).divideScalar(det),
    dv=e2.clone().multiplyScalar(u1).addScaledVector(e1,-u2).divideScalar(det),
    normal=e1.clone().cross(e2),area=normal.lengthSq(),scale=e1.lengthSq()*e2.lengthSq();
  const gram=du.lengthSq()*dv.lengthSq(),cross=du.clone().cross(dv).lengthSq();
  if(!Number.isFinite(gram)||!Number.isFinite(area)||scale<=0||area<=scale*1e-12||gram<=0||cross<=gram*1e-10)return;
  return {origin:anchorPosition(anchor,vertex,.0007),du,dv,normal:normal.normalize(),uv:{...uv}};
}
export function tangentWorld(frame:TangentFrame,uv:UV):THREE.Vector3 {
  return frame.origin.clone().addScaledVector(frame.du,uv.u-frame.uv.u).addScaledVector(frame.dv,uv.v-frame.uv.v);
}
export function tangentRayUV(frame:TangentFrame,ray:THREE.Ray):UV | undefined {
  const incidence=frame.normal.dot(ray.direction);
  if(!Number.isFinite(incidence)||Math.abs(incidence)<1e-4)return;
  const distance=frame.normal.dot(frame.origin.clone().sub(ray.origin))/incidence;
  if(!Number.isFinite(distance)||distance<0)return;
  const delta=ray.at(distance,new THREE.Vector3()).sub(frame.origin),
    uu=frame.du.lengthSq(),vv=frame.dv.lengthSq(),uv=frame.du.dot(frame.dv),det=uu*vv-uv*uv,
    x=delta.dot(frame.du),y=delta.dot(frame.dv);
  const result={u:frame.uv.u+(x*vv-y*uv)/det,v:frame.uv.v+(y*uu-x*uv)/det};
  return Number.isFinite(result.u)&&Number.isFinite(result.v)?result:undefined;
}
