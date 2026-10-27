/** View-local ground grabbing. Intersections use the same camera rays as drawing and picking. */
import { camera, orbitTarget, type Orbit } from "./projection";
import type { HoloSession, HoloWorld, Vec3 } from "../types";
export type Extent = { readonly min: Vec3; readonly max: Vec3 };
export function groundPoint(C: ReturnType<typeof camera>, x: number, y: number, z = C.target[2]): Vec3 | null {
  const ray = C.ray(x,y), t = (z-ray.origin[2])/ray.direction[2];
  return t < 0 || !Number.isFinite(t) ? null : ray.origin.map((n,i)=>n+ray.direction[i]*t) as unknown as Vec3;
}
/** One orbit distance outside the extent, including a round limit beyond its corners. */
export function clampTarget(target: Vec3, extent: Extent, distance: number): Vec3 {
  const near = [0,1].map(i=>Math.max(extent.min[i],Math.min(extent.max[i],target[i])));
  const dx=target[0]-near[0],dy=target[1]-near[1],length=Math.hypot(dx,dy),scale=length>distance?distance/length:1;
  return [near[0]+dx*scale,near[1]+dy*scale,target[2]];
}
export function panOrbit(orbit: Orbit, center: Vec3, press: Vec3, x: number, y: number, width: number, height: number, extent?: Extent): Orbit {
  const target=orbitTarget(center,orbit), under=groundPoint(camera(target,orbit,width,height),x,y,press[2]);
  if(!under)return orbit;
  let next: Vec3=[target[0]+press[0]-under[0],target[1]+press[1]-under[1],target[2]];
  if(extent)next=clampTarget(next,extent,orbit.distance);
  return {...orbit,pan:[next[0]-center[0],next[1]-center[1]]};
}
/** A full pack/set extent wins; without one, stay within the observed recording's known span. */
export function panExtent(session: HoloSession, world: HoloWorld): Extent | undefined {
  if(session.meta.standalone?.extent)return session.meta.standalone.extent;
  if(world.extent)return world.extent;
  if(!session.v.length)return;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const sample of session.v)for(let i=0;i<3;i++){min[i]=Math.min(min[i],sample.position[i]);max[i]=Math.max(max[i],sample.position[i]);}
  return {min:min as unknown as Vec3,max:max as unknown as Vec3};
}
