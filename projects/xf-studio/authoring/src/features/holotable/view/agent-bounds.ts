import type { AgentItem } from "../agent-types";
import type { Vec3 } from "../types";
import type { camera } from "./projection";
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

/** View-local immutable bounds; cold paths/vector fields yield while building them. */
export function agentVisibility() {
  const bounds=new WeakMap<AgentItem,Map<string,readonly Vec3[]>>();
  const xy=new Float64Array(16),depths=new Float64Array(8);
  return function* visible(item:AgentItem,C:ReturnType<typeof camera>,draw:string,marker:boolean,label:boolean,radius:number):Generator<void,boolean> {
    const p=item.place!,a=item.resolvedAnchor??item.anchor;
    if(marker){
      const point=C.point(p),extended=["polyline","volume","grid","curve","arrow"].includes(draw)||draw==="crosshair"&&!!item.to||"box" in a||"zone" in a||"sphere" in a;
      // Plates/badges plus a possible 12px fan; labels are submitted within 32px of the edge.
      const margin=label?44:28;
      const far=Math.max(1500,Math.hypot(...C.position.map((n,i)=>n-C.target[i]))+radius);
      if(point&&point[0]>=-margin&&point[0]<=C.width+margin&&point[1]>=-margin&&point[1]<=C.height+margin&&(extended||Math.hypot(...p.map((n,i)=>n-C.position[i]))<=far))return true;
    }
    let byDraw=bounds.get(item);if(!byDraw)bounds.set(item,byDraw=new Map());
    let corners=byDraw.get(draw);
    if(!corners){
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      const add=(p:readonly number[])=>{for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}};
      if(item.to&&["crosshair","curve","arrow"].includes(draw)){add(p);add(item.to);}
      else if(draw==="polyline"&&"path" in a){for(let i=0;i<a.path.length;i++){if(i%64===0)yield;add(a.path[i]);}}
      else if(["volume","diamond"].includes(draw)){
        if("box" in a){add(a.box.min);add(a.box.max);}
        else if("sphere" in a){const s=a.sphere;add(s.at.map(n=>n-s.r));add(s.at.map(n=>n+s.r));}
        else if("zone" in a){for(let i=0;i<a.zone.poly.length;i++){if(i%64===0)yield;const [x,y]=a.zone.poly[i];add([x,y,a.zone.zlo]);add([x,y,a.zone.zhi]);}}
      }else if(draw==="grid"&&"grid" in a){
        const g=a.grid,end=[g.origin[0]+g.cols*g.cell,g.origin[1]+g.rows*g.cell,g.origin[2]];
        add(g.origin);add(end);
        const vectors=item.value?.vectors;
        if(vectors)for(let i=0;i<vectors.length;i++){
          if(i%64===0)yield;const [x,y]=vectors[i];
          add([g.origin[0]+Math.min(0,x),g.origin[1]+Math.min(0,y),g.origin[2]]);
          add([end[0]+Math.max(0,x),end[1]+Math.max(0,y),end[2]]);
        }
      }
      corners=Number.isFinite(lo[0])?Array.from({length:8},(_,n)=>[0,1,2].map(i=>n&(1<<i)?hi[i]:lo[i]) as unknown as Vec3):[];
      byDraw.set(draw,corners);
    }
    if(!corners.length)return false;
    C.projectInto(corners,xy,depths);
    if(depths.every(depth=>depth<1))return false;
    // A near-plane crossing may project through the view even if every anchor/corner is outside.
    if(depths.some(depth=>depth<1))return true;
    // Include fan-out, relation bends, arrowheads and marker/label margins conservatively.
    for(let axis=0;axis<2;axis++){
      let min=Infinity,max=-Infinity;
      for(let i=0;i<8;i++){min=Math.min(min,xy[i*2+axis]);max=Math.max(max,xy[i*2+axis]);}
      if(max< -64||min>(axis?C.height:C.width)+64)return false;
    }
    return true;
  };
}
