// Resumable significance selection. One generator belongs to one source/camera; supersession drops it.
import type { HoloSolid, Vec3 } from "../types";
import { solidGeometry, SOLID_DRAW_CAP, type SolidInstance } from "./solid-projection";
import type { camera } from "./projection";
type Camera = ReturnType<typeof camera>;
type Candidate = { solid: HoloSolid; extent: number };
export function* selectSolids(solids: readonly HoloSolid[], target: Vec3, C: Camera) {
  const kept: Candidate[] = [];
  const smaller = (a: Candidate, b: Candidate) => a.extent < b.extent || a.extent === b.extent && a.solid.id > b.solid.id;
  let total = 0, index = 0;
  for (const solid of solids) {
    if (index++ % 2 === 0) yield { kept, total };
    const d = Math.hypot(...solid.center.map((n,i)=>n-target[i])); if (d > 350) continue;
    const geometry = solidGeometry(solid); if (d + geometry.radius > 350) continue; total++;
    const upper = C.boundExtent(solid.center, geometry.radius);
    if (!upper || upper < 4 && d > 30 || kept.length === SOLID_DRAW_CAP && upper < kept[0].extent) continue;
    const extent=C.extent(geometry.corners);if(!extent||extent<4&&d>30)continue;
    if(kept.length<SOLID_DRAW_CAP){let i=kept.length;kept.push({solid,extent});while(i>0){const p=(i-1)>>1;if(!smaller(kept[i],kept[p]))break;[kept[i],kept[p]]=[kept[p],kept[i]];i=p;}}
    else if(extent>kept[0].extent||extent===kept[0].extent&&solid.id<kept[0].solid.id){kept[0]={solid,extent};let i=0;for(;;){const l=i*2+1,r=l+1;if(l>=kept.length)break;const child=r<kept.length&&smaller(kept[r],kept[l])?r:l;if(!smaller(kept[child],kept[i]))break;[kept[i],kept[child]]=[kept[child],kept[i]];i=child;}}
  }
  return { kept, total };
}
export function createSolidSelection(now:()=>number=()=>performance.now()) {
  let source:readonly HoloSolid[]|undefined,key="",job:ReturnType<typeof selectSolids>|undefined;
  let result:{instances:SolidInstance[];cut:number;pending:boolean}={instances:[],cut:0,pending:false};
  return {
    step(solids:readonly HoloSolid[],target:Vec3,C:Camera,deadline:number){
      const next=JSON.stringify([target,C.position,C.width,C.height]);
      if(source!==solids||key!==next){source=solids;key=next;job=selectSolids(solids,target,C);result={instances:[],cut:0,pending:true};}
      if(!job)return result;
      let latest:ReturnType<typeof job.next>|undefined;
      while(now()<deadline){latest=job.next();if(latest.done){job=undefined;break;}}
      if(latest){
        const distance=Math.hypot(...C.position.map((n,i)=>n-target[i]));
        result={instances:[...latest.value.kept].sort((a,b)=>Math.hypot(...b.solid.center.map((n,i)=>n-C.position[i]))-Math.hypot(...a.solid.center.map((n,i)=>n-C.position[i]))).map(({solid,extent})=>({kind:"solid",id:solid.id,source:solid,extentPx:extent,opacity:Math.max(0.15,Math.min(1,1.3-Math.hypot(...solid.center.map((n,i)=>n-C.position[i]))/(distance*2.6)))})),cut:Math.max(0,latest.value.total-latest.value.kept.length),pending:!!job};
      }
      return result;
    },
    cancel(){job=undefined;source=undefined;result={instances:[],cut:0,pending:false};},
  };
}
