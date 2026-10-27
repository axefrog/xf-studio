import { expect,test } from "bun:test";
import { camera,fitOrbit,ORBITS,orbitTarget,project } from "../src/features/holotable/view/projection";
import { groundPoint,panOrbit,clampTarget } from "../src/features/holotable/view/pan";
import { worldContexts,CONTEXT_SOLID_CAP } from "../src/features/holotable/world-context";
import { HOLOTABLE_POINTER_BINDINGS,holotablePointerBinding,keyBinding,bindingReference } from "../src/app/input-bindings";
import type { HoloSolid,HoloWorld,HoloSession,Vec3 } from "../src/features/holotable/types";
const empty:HoloWorld={provenance:null,areas:[],cells:[],solids:[]};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test("ground grabbing keeps the press point under the moving cursor within half a pixel in every preset and panel width",()=>{
 for(const initial of Object.values(ORBITS))for(const width of [300,460,850])for(const height of [300,600]){
  const center:Vec3=[123,-45,32],press=groundPoint(camera(center,initial,width,height),width*.45,height*.65)!;
  expect(press).not.toBeNull();let orbit={...initial};
  for(const [x,y] of [[width*.50,height*.6],[width*.62,height*.7],[width*.4,height*.5]]){
   orbit=panOrbit(orbit,center,press,x,y,width,height) as typeof orbit;
   const projected=camera(orbitTarget(center,orbit),orbit,width,height).point(press)!;
   expect(Math.hypot(projected[0]-x,projected[1]-y)).toBeLessThan(.5);
  }
 }
});
test("pan clamp is one orbit distance outside the extent, including corners, and leaves height unchanged",()=>{
 const extent={min:[-10,-20,0] as Vec3,max:[30,40,100] as Vec3};
 expect(clampTarget([10,10,5],extent,100)).toEqual([10,10,5]);
 expect(clampTarget([1000,0,5],extent,100)).toEqual([130,0,5]);
 const corner=clampTarget([-1000,1000,5],extent,100);
 expect(Math.hypot(corner[0]+10,corner[1]-40)).toBeCloseTo(100,8);expect(corner[2]).toBe(5);
});
test("fit and every preset reset pan, while replay follows V with a persistent XY offset",()=>{
 const orbit={...ORBITS.tilt,pan:[45,-23] as const};
 expect(fitOrbit({min:[0,0,0],max:[100,100,20]},orbit,850,600).pan).toEqual([0,0]);
 for(const preset of Object.values(ORBITS))expect(preset.pan).toEqual([0,0]);
 const s:HoloSession={meta:{session:"s",run:1,start:0,end:1,from:0,to:1,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"",problems:[]},v:[0,1].map(t=>({t,seq:t,position:[t*100,t*50,10] as Vec3,yaw:0,speed:1,health:1,healthMax:1,inCombat:false,vehicle:false,busy:""})),camera:[],events:[],gaps:[]};
 const layers={v:true,camera:false,people:false,events:false,gaps:false,areas:false,cells:false,solids:false};
 expect(project(s,empty,0,layers,orbit,850,600,null).solidCamera.target).toEqual([45,-23,10]);
 expect(project(s,empty,1,layers,orbit,850,600,null).solidCamera.target).toEqual([145,27,10]);
 expect(orbit.pan).toEqual([45,-23]);
});
function timer(){let at=0;const jobs=new Set<{at:number;run:()=>void}>();return{
 later(ms:number,run:()=>void){const job={at:at+ms,run};jobs.add(job);return()=>{jobs.delete(job);};},
 advance(ms:number){at+=ms;for(const job of [...jobs])if(job.at<=at){jobs.delete(job);job.run();}},size:()=>jobs.size,
};}
function fixture(){
 const clock=timer(),ctl=new AbortController(),requests:{params:Record<string,unknown>;signal:AbortSignal;resolve:(world:HoloWorld)=>void}[]=[];let world=empty;
 const owner=worldContexts({source:()=>({identity:"s",params:{dir:"s"}}),load:(params,signal)=>new Promise(resolve=>requests.push({params,signal,resolve})),later:clock.later,changed:value=>{world=value;}},ctl.signal);
 return{clock,ctl,requests,owner,world:()=>world};
}
const solid=(id:string,x=0):HoloSolid=>({id,kind:"box",center:[x,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],size:[1,1,1]});
test("world leases debounce 250 ms per view and a newer pan aborts only that view, refusing late results",async()=>{
 const f=fixture(),a=new AbortController(),b=new AbortController();try{
  const one=f.owner.lease(a.signal),two=f.owner.lease(b.signal);
  one.want([0,0,0],true);two.want([1000,0,0],true);f.clock.advance(249);expect(f.requests).toHaveLength(0);
  one.want([10,0,0],true);f.clock.advance(1);expect(f.requests).toHaveLength(1);expect(f.requests[0].params.center).toEqual([1000,0,0]);
  f.clock.advance(249);expect(f.requests).toHaveLength(2);
  one.want([20,0,0],true);expect(f.requests[1].signal.aborted).toBe(true);expect(f.requests[0].signal.aborted).toBe(false);
  f.requests[1].resolve({...empty,solids:[solid("stale")]});await settle();expect(f.world().solids).toEqual([]);
  a.abort();expect(f.requests[0].signal.aborted).toBe(false);expect(f.clock.size()).toBe(0);
  f.requests[0].resolve({...empty,solids:[solid("two",1000)]});await settle();expect(f.world().solids?.map(s=>s.id)).toEqual(["two"]);
  b.abort();expect(f.world().solids).toEqual([]);
 }finally{f.ctl.abort();}
});
test("matching regions share one read until the last lease cancels",async()=>{
 const f=fixture(),a=new AbortController(),b=new AbortController();try{
  f.owner.lease(a.signal).want([0,0,0]);f.owner.lease(b.signal).want([0,0,0]);f.clock.advance(250);
  expect(f.requests).toHaveLength(1);a.abort();expect(f.requests[0].signal.aborted).toBe(false);
  f.requests[0].resolve({...empty,solids:[solid("shared")]});await settle();expect(f.world().solids).toHaveLength(1);
  b.abort();expect(f.world().solids).toEqual([]);
 }finally{f.ctl.abort();}
 const last=fixture(),life=new AbortController();last.owner.lease(life.signal).want([0,0,0]);last.clock.advance(250);life.abort();expect(last.requests[0].signal.aborted).toBe(true);last.ctl.abort();
});
test("the unique union is capped at 12,000 with equal shares and a released lease's solids leave immediately",async()=>{
 const f=fixture(),a=new AbortController(),b=new AbortController();try{
  f.owner.lease(a.signal).want([0,0,0]);f.owner.lease(b.signal).want([1000,0,0]);f.clock.advance(250);
  const first=Array.from({length:12000},(_,i)=>solid(`a${i}`)),second=Array.from({length:12000},(_,i)=>solid(`b${i}`,1000));
  f.requests[0].resolve({...empty,solids:first});f.requests[1].resolve({...empty,solids:second});await settle();
  expect(f.world().solids).toHaveLength(CONTEXT_SOLID_CAP);expect(f.world().solids!.filter(s=>s.id.startsWith("a"))).toHaveLength(6000);expect(f.world().solids!.filter(s=>s.id.startsWith("b"))).toHaveLength(6000);
  a.abort();expect(f.world().solids).toHaveLength(6000);expect(f.world().solids!.every(s=>s.id.startsWith("b"))).toBe(true);
  f.clock.advance(250);expect(f.requests).toHaveLength(3);f.requests[2].resolve({...empty,solids:second});await settle();expect(f.world().solids).toHaveLength(12000);
  b.abort();expect(f.world().solids).toHaveLength(0);
 }finally{f.ctl.abort();}
});
test("Holotable reference lists both pan gestures and never binds Shift+arrows",()=>{
 expect(holotablePointerBinding("right-drag")?.effect).toBe("pan");expect(holotablePointerBinding("middle-drag")?.effect).toBe("pan");
 const rows=bindingReference().find(section=>section.id==="holotable")!.rows;
 for(const binding of HOLOTABLE_POINTER_BINDINGS)expect(rows.some(row=>row.ids.includes(binding.id))).toBe(true);
 for(const key of ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"])expect(keyBinding("holotable",{key,shiftKey:true})).toBeUndefined();
});
