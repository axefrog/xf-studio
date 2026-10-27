// Resumable significance selection. One generator belongs to one source/camera; supersession drops it.
import type { HoloSolid, Vec3 } from "../types";
import { solidGeometry, SOLID_DRAW_CAP, type SolidInstance } from "./solid-projection";
import type { camera } from "./projection";
type Camera = ReturnType<typeof camera>;
type Candidate = { solid: HoloSolid; extent: number };
export function* selectSolids(solids: readonly HoloSolid[], target: Vec3, C: Camera, cap = SOLID_DRAW_CAP) {
  const kept: Candidate[] = [];
  const smaller = (a: Candidate, b: Candidate) => a.extent < b.extent || a.extent === b.extent && a.solid.id > b.solid.id;
  let total = 0, index = 0;
  for (const solid of solids) {
    if (cap === 0) break;
    if (index++ % 32 === 0) yield { kept, total };
    const dx=solid.center[0]-target[0],dy=solid.center[1]-target[1],dz=solid.center[2]-target[2];
    const d = Math.sqrt(dx*dx+dy*dy+dz*dz); if (d > 350) continue;
    const geometry = solidGeometry(solid); if (d + geometry.radius > 350) continue; total++;
    const upper = C.boundExtent(solid.center, geometry.radius);
    if (!upper || upper < 4 && d > 30 || kept.length === cap && upper < kept[0].extent) continue;
    const extent=C.extent(geometry.corners);if(!extent||extent<4&&d>30)continue;
    if(kept.length<cap){let i=kept.length;kept.push({solid,extent});while(i>0){const p=(i-1)>>1;if(!smaller(kept[i],kept[p]))break;[kept[i],kept[p]]=[kept[p],kept[i]];i=p;}}
    else if(extent>kept[0].extent||extent===kept[0].extent&&solid.id<kept[0].solid.id){kept[0]={solid,extent};let i=0;for(;;){const l=i*2+1,r=l+1;if(l>=kept.length)break;const child=r<kept.length&&smaller(kept[r],kept[l])?r:l;if(!smaller(kept[child],kept[i]))break;[kept[i],kept[child]]=[kept[child],kept[i]];i=child;}}
  }
  return { kept, total };
}
export function createSolidSelection(now:()=>number=()=>performance.now()) {
  let source:readonly HoloSolid[]|undefined,key="",job:ReturnType<typeof selectSolids>|undefined;
  let result:{instances:SolidInstance[];cut:number;pending:boolean}={instances:[],cut:0,pending:false};
  return {
    step(solids:readonly HoloSolid[],target:Vec3,C:Camera,deadline:number,cap=SOLID_DRAW_CAP){
      cap=Math.max(0,Math.min(SOLID_DRAW_CAP,Math.floor(cap)));
      const next=JSON.stringify([target,C.position,C.width,C.height,cap]);
      if(source!==solids||key!==next){source=solids;key=next;job=selectSolids(solids,target,C,cap);result={instances:[],cut:0,pending:true};}
      if(!job)return result;
      let latest:ReturnType<typeof job.next>|undefined;
      while(deadline===Infinity||now()<deadline){latest=job.next();if(latest.done){job=undefined;break;}}
      if(latest){
        const distance=Math.hypot(...C.position.map((n,i)=>n-target[i]));
        const ordered = latest.value.kept.map(candidate => {
          const p = candidate.solid.center;
          return { ...candidate, distance: Math.hypot(p[0]-C.position[0], p[1]-C.position[1], p[2]-C.position[2]) };
        }).sort((a,b)=>b.distance-a.distance);
        result={instances:ordered.map(({solid,extent,distance:fromCamera})=>({kind:"solid",id:solid.id,source:solid,extentPx:extent,opacity:Math.max(0.15,Math.min(1,1.3-fromCamera/(distance*2.6)))})),cut:Math.max(0,latest.value.total-latest.value.kept.length),pending:!!job};
      }
      return result;
    },
    cancel(){job=undefined;source=undefined;result={instances:[],cut:0,pending:false};},
  };
}
