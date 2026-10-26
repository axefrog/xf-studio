// Ray intersections in the solid's affine local space. No selection policy or state.
import type { HoloSolid, Vec3 } from "../types";
import type { camera } from "./projection";
const dot = (a: Vec3, b: Vec3) => a.reduce((n, x, i) => n + x * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export function pickPlace(C: ReturnType<typeof camera>, x: number, y: number, solids: readonly HoloSolid[], groundZ: number): Vec3 | null {
  const ray = C.ray(x, y); let closest = Infinity;
  for (const s of solids) {
    const [a,b,c] = s.axes, bc = cross(b,c), ca = cross(c,a), ab = cross(a,b), det = dot(a,bc); if (Math.abs(det) < 1e-12) continue;
    const local = (p: Vec3): Vec3 => [dot(p,bc)/det,dot(p,ca)/det,dot(p,ab)/det];
    const o = local(ray.origin.map((v,i)=>v-s.center[i]) as unknown as Vec3), d = local(ray.direction);
    const candidates: number[] = [];
    const sphere = (z: number, radius: number, hemisphere = 0) => {
      const q: Vec3 = [o[0],o[1],o[2]-z], A=dot(d,d), B=2*dot(q,d), D=B*B-4*A*(dot(q,q)-radius*radius); if (D<0 || !A) return;
      for (const t of [(-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A)]) if (t>=0 && (!hemisphere || (o[2]+d[2]*t-z)*hemisphere>=0)) candidates.push(t);
    };
    if (s.kind === "box") {
      let lo=0,hi=Infinity;
      for (let i=0;i<3;i++) { if (Math.abs(d[i])<1e-12) { if (Math.abs(o[i])>s.size[i]) hi=-1; } else { const a=(-s.size[i]-o[i])/d[i],b=(s.size[i]-o[i])/d[i]; lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b)); } }
      if (lo<=hi) candidates.push(lo);
    } else if (s.kind === "sphere") sphere(0,s.size[0]);
    else {
      const radius=s.size[0], half=s.size[1]/2, A=d[0]*d[0]+d[1]*d[1],B=2*(o[0]*d[0]+o[1]*d[1]),D=B*B-4*A*(o[0]*o[0]+o[1]*o[1]-radius*radius);
      if (A && D>=0) for (const t of [(-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A)]) if(t>=0 && Math.abs(o[2]+d[2]*t)<=half) candidates.push(t);
      sphere(-half,radius,-1);sphere(half,radius,1);
    }
    for (const t of candidates) closest=Math.min(closest,t);
  }
  if (!Number.isFinite(closest)) { const t=(groundZ-ray.origin[2])/ray.direction[2]; if(t<0 || !Number.isFinite(t)) return null; closest=t; }
  return ray.origin.map((n,i)=>n+ray.direction[i]*closest) as unknown as Vec3;
}
