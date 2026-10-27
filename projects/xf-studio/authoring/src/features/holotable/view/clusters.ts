/** Conservative 6 px occupancy grid: fixed work per 18 px plate, including dense coincident input.
 * A shared cell joins plates (at most 6 px of padding); union/find avoids all-pairs neighbour scans. */
import type { AgentItem } from "../agent-types";
import type { Vec3 } from "../types";
import { familyOf } from "./friendly";
export interface ProjectedPlate {item:AgentItem;x:number;y:number}
export interface PlateCluster {key:string;x:number;y:number;items:AgentItem[];center:Vec3;tone:string}
export function* clusterPlateSteps(plates:readonly ProjectedPlate[], expandCoincident=false) {
  const parent=plates.map((_,i)=>i),size=plates.map(()=>1),cells=new Map<string,number>();let visits=0;
  const root=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<plates.length;i++){
    if(i%64===0)yield;
    const p=plates[i];
    for(let y=Math.floor((p.y-9)/6);y<=Math.floor((p.y+9)/6);y++)for(let x=Math.floor((p.x-9)/6);x<=Math.floor((p.x+9)/6);x++){
      visits++;const key=`${x}:${y}`,other=cells.get(key);
      if(other===undefined)cells.set(key,i);else{let a=root(i),b=root(other);if(a!==b){if(size[a]<size[b])[a,b]=[b,a];parent[b]=a;size[a]+=size[b];}}
    }
  }
  const groups=new Map<number,ProjectedPlate[]>();
  for(let i=0;i<plates.length;i++){if(i%64===0)yield;const p=plates[i],r=root(i),g=groups.get(r);if(g)g.push(p);else groups.set(r,[p]);}
  const clusters:PlateCluster[]=[],hidden=new Set<string>();
  let processed=0;
  for(const group of groups.values())if(group.length>1){
    if(processed++%64===0)yield;
    if(expandCoincident&&group.length<=12&&group.every(p=>JSON.stringify(p.item.place)===JSON.stringify(group[0].item.place)))continue;
    const counts=new Map<string,{count:number;tone:string}>();let dominant={count:0,tone:"signal"};let x=0,y=0;const center=[0,0,0];
    for(let n=0;n<group.length;n++){if(n%64===0)yield;const p=group[n];hidden.add(p.item.key);x+=p.x;y+=p.y;for(let a=0;a<3;a++)center[a]+=p.item.place![a];const f=familyOf(p.item),entry=counts.get(f)??{count:0,tone:p.item.tone??"signal"};entry.count++;counts.set(f,entry);if(entry.count>dominant.count)dominant=entry;}
    clusters.push({key:`plates:${group[0].item.key}`,x:x/group.length,y:y/group.length,center:center.map(n=>n/group.length) as unknown as Vec3,items:group.map(p=>p.item),tone:dominant.tone});
  }
  return {clusters,hidden,visits};
}

/** Synchronous form for explicit focus searches and pure model checks. Frame work uses the steps. */
export function clusterPlates(plates:readonly ProjectedPlate[],expandCoincident=false){
  const job=clusterPlateSteps(plates,expandCoincident);let step=job.next();while(!step.done)step=job.next();return step.value;
}

export const clusterRadius=(count:number)=>Math.max(12,Math.min(22,8+String(count).length*4));
/** Only the count plate moves: the selected ring and its 2 px clearance keep both hit targets reachable. */
export function clearSelectedPlate(cluster:PlateCluster,selected:readonly[number,number]):PlateCluster {
  const dx=cluster.x-selected[0],dy=cluster.y-selected[1],distance=Math.hypot(dx,dy),minimum=clusterRadius(cluster.items.length)+16;
  if(distance>=minimum)return cluster;
  const x=distance?dx/distance:-1,y=distance?dy/distance:0;
  return {...cluster,x:selected[0]+x*minimum,y:selected[1]+y*minimum};
}
