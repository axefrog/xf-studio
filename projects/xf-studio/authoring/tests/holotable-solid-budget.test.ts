import { expect, test } from "bun:test";
import { createSolidSelection } from "../src/features/holotable/view/solid-selection";
import { camera, ORBITS, project } from "../src/features/holotable/view/projection";
import { pickPlace } from "../src/features/holotable/view/place-picking";
import type { HoloSession, HoloSolid } from "../src/features/holotable/types";
const axes=[[1,0,0],[0,1,0],[0,0,1]] as const;
test("solid selection yields, converges on the synchronous significance set, and abandons superseded work",()=>{
 const solids:HoloSolid[]=Array.from({length:1200},(_,i)=>({id:String(i),kind:"box",center:[(i%40-20)*3,(Math.floor(i/40)-15)*3,0],axes,size:[1,1,1]}));
 const C=camera([0,0,0],ORBITS.tilt,800,500);let clock=0;
 const selection=createSolidSelection(()=>clock++);let result=selection.step(solids,[0,0,0],C,2);expect(result.pending).toBe(true);
 for(let i=0;i<200&&result.pending;i++)result=selection.step(solids,[0,0,0],C,clock+20);
 expect(result.pending).toBe(false);expect(result.instances).toHaveLength(900);
 const s:HoloSession={meta:{session:"s",run:0,start:0,end:1,from:0,to:1,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"test",problems:[]},v:[],camera:[],events:[],gaps:[]};
 const sync=project(s,{provenance:null,areas:[],cells:[],solids},0,{v:false,camera:false,events:false,gaps:false,areas:false,cells:false,solids:true},ORBITS.tilt,800,500,null);
 expect(result.instances.map(i=>i.id).sort()).toEqual(sync.solids.map(i=>i.id).sort());
 selection.cancel();result=selection.step([], [1000,1000,0], camera([1000,1000,0],ORBITS.tilt,800,500),clock+10);expect(result.instances).toEqual([]);expect(result.pending).toBe(false);
});
test("place picking intersects ground and affine solid surfaces",()=>{
 const C=camera([0,0,0],ORBITS.top,800,500);
 const ground=pickPlace(C,400,250,[],0)!;expect(ground[0]).toBeCloseTo(0);expect(ground[1]).toBeCloseTo(0);expect(ground[2]).toBeCloseTo(0);
 const sphere:HoloSolid={id:"sphere",kind:"sphere",center:[0,0,0],axes,size:[2,0,0]};const hit=pickPlace(C,400,250,[sphere],0)!;expect(Math.hypot(...hit)).toBeCloseTo(2);
 const box:HoloSolid={id:"box",kind:"box",center:[0,0,0],axes,size:[2,2,2]};expect(pickPlace(C,400,250,[box],0)![2]).toBeCloseTo(2);
});
