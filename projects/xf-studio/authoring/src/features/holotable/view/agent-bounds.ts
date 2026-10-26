import type { AgentItem } from "../agent-types";
import type { Vec3 } from "../types";
/** Conservative XY bounds against the view circle; never reject a crossing item by its anchor. */
export function agentInRange(item: AgentItem, target: Vec3, radius: number): boolean {
  const point = (p: Vec3, extra = 0) => Math.hypot(p[0]-target[0], p[1]-target[1]) <= radius + extra;
  const box = (min: readonly number[], max: readonly number[]) => Math.hypot(Math.max(min[0]-target[0], 0, target[0]-max[0]), Math.max(min[1]-target[1], 0, target[1]-max[1])) <= radius;
  const segment = (a: Vec3, b: Vec3) => {
    const dx=b[0]-a[0], dy=b[1]-a[1], k=Math.max(0,Math.min(1,((target[0]-a[0])*dx+(target[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(a[0]+k*dx-target[0], a[1]+k*dy-target[1]) <= radius;
  };
  const a = item.resolvedAnchor ?? item.anchor;
  if (item.place && item.to && ["relation", "influence", "target"].includes(item.kind)) return segment(item.place, item.to);
  if ("path" in a) return a.path.some((p,i)=>i > 0 && segment(a.path[i-1], p));
  if ("box" in a) return box(a.box.min,a.box.max);
  if ("sphere" in a) return point(a.sphere.at,a.sphere.r);
  if ("zone" in a) {
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for (const [x,y] of a.zone.poly) { x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y); }
    return box([x0,y0],[x1,y1]);
  }
  if ("grid" in a) { const g=a.grid; return box(g.origin,[g.origin[0]+g.cols*g.cell,g.origin[1]+g.rows*g.cell]); }
  return !!item.place && point(item.place);
}
