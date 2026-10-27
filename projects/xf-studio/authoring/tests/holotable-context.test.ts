import { expect, test } from "bun:test";
import { createHolotable } from "../src/features/holotable/service";
import type { HoloSession, HoloTransport } from "../src/features/holotable/types";
const settle = () => new Promise(resolve=>setTimeout(resolve,0));
const session: HoloSession = { meta:{session:"layers:p/week",run:0,start:0,end:604800,from:0,to:604800,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"",problems:[],standalone:{set:"p/week",title:"Kabuki week",clock:"game",branches:[],extent:{min:[-10000,-10000,0],max:[10000,10000,0]}}},v:[],camera:[],events:[],gaps:[] };
const world = {provenance:null,areas:[],cells:[]};
const agents={layers:[],here:[],specs:{schema:"xfh/projections-1",kinds:{}}};
const ok=(result:unknown)=>({ok:true,status:200,data:{ok:true,result}});
const runs=[{session:"s",run:1,dir:"recording",start:0,end:10,bytes:0,complete:true},{session:"p",run:0,dir:"layers:p/week",title:"Kabuki week",standalone:true,start:0,end:604800,bytes:0,complete:true}];

test("optional world failures never reject recording opens",async()=>{
 const ctl=new AbortController();const service=createHolotable({later:()=>()=>{},transport:async(method)=>{
  if(method==="runs.list")return ok(runs);
  if(method==="session.open")return ok({...session,meta:{...session.meta,standalone:undefined}});
  if(method.startsWith("world."))throw Error("This path exceeds the collider preparation budget.");
  if(method==="layers.watch")return ok({watch:"w"});return ok(agents);
 }},ctl.signal);
 service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"recording"});
 expect(service.snapshot().phase).toBe("ready");expect(service.snapshot().open?.dir).toBe("recording");expect(service.snapshot().openError).toBeNull();ctl.abort();
});

test("standalone opens without waiting for context, refreshes after 150 m and rejects stale or hidden responses",async()=>{
 const ctl=new AbortController(), requests:{params:Record<string,unknown>;signal:AbortSignal;resolve:(value:any)=>void}[]=[];
 const service=createHolotable({later:()=>()=>{},transport:async(method,params,signal)=>{
  if(method==="runs.list")return ok(runs);if(method==="session.open")return ok(session);
  if(method==="world.status")throw Error("Standalone must not preflight the whole extent");
  if(method==="world.around")return await new Promise(resolve=>requests.push({params,signal,resolve}));
  if(method==="layers.watch")return ok({watch:"w"});return ok(agents);
 }},ctl.signal);
 service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"layers:p/week"});
 expect(service.snapshot().open?.dir).toBe("layers:p/week");expect(service.snapshot().runs[0].standalone).toBe(true);
 expect(requests).toHaveLength(1);expect(requests[0].params).toMatchObject({center:[0,0,0],margin:350});
 await service.dispatch({kind:"holo.focus",position:[149,0,0]});expect(requests).toHaveLength(1);
 await service.dispatch({kind:"holo.focus",position:[151,0,0]});expect(requests).toHaveLength(2);expect(requests[0].signal.aborted).toBe(true);
 requests[0].resolve(ok({...world,areas:[{id:"stale"}]}));requests[1].resolve(ok({...world,areas:[{id:"current"}]}));await settle();
 expect(service.snapshot().open?.world.areas[0].id).toBe("current");
 await service.dispatch({kind:"holo.focus",position:[500,0,0]});service.withdraw();expect(requests[2].signal.aborted).toBe(true);
 requests[2].resolve(ok({...world,areas:[{id:"hidden"}]}));await settle();expect(service.snapshot().open?.world.areas[0].id).toBe("current");ctl.abort();
});

test("a failed session retains its title and plain reason, and retry clears the error",async()=>{
 const ctl=new AbortController();let fail=true;const service=createHolotable({later:()=>()=>{},transport:async(method)=>{
  if(method==="runs.list")return ok(runs);if(method==="session.open"){if(fail)throw Error("Spool is unreadable.");return ok(session);}
  if(method==="layers.watch")return ok({watch:"w"});return ok(agents);
 }},ctl.signal);
 service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"layers:p/week"});
 expect(service.snapshot().openError).toEqual({dir:"layers:p/week",title:"Kabuki week",reason:"Spool is unreadable."});expect(service.snapshot().phase).toBe("failed");
 fail=false;await service.dispatch({kind:"holo.open",dir:"layers:p/week"});expect(service.snapshot().openError).toBeNull();expect(service.snapshot().phase).toBe("ready");ctl.abort();
});

test("a late startup poll after hide/re-show cannot schedule a second watch loop",async()=>{
 const ctl=new AbortController(), timers=new Set<()=>void>();let watchCount=0,pollCount=0,releaseWatch!:(v:any)=>void,releasePoll!:(v:any)=>void;
 const firstWatch=new Promise<any>(resolve=>releaseWatch=resolve),firstPoll=new Promise<any>(resolve=>releasePoll=resolve);
 const transport:HoloTransport=async(method)=>{
  if(method==="runs.list")return ok(runs);if(method==="session.open")return ok(session);if(method==="world.around")return ok(world);
  if(method==="layers.watch")return ++watchCount===1?await firstWatch:ok({watch:"new"});
  if(method==="layers.poll")return ++pollCount===1?await firstPoll:ok(agents);return ok({});
 };
 const service=createHolotable({transport,later:(ms,fn)=>{if(ms===1000)timers.add(fn);return()=>timers.delete(fn);}},ctl.signal);
 service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"layers:p/week"});releaseWatch(ok({watch:"old"}));await settle();
 service.withdraw();service.shown();await settle();expect(timers.size).toBe(1);
 releasePoll(ok(agents));await settle();expect(timers.size).toBe(1);ctl.abort();expect(timers.size).toBe(0);
});


test("each real service view lease fetches its own target and its end drops only its own geometry",async()=>{
 const ctl=new AbortController(),a=new AbortController(),b=new AbortController(),timers=new Set<()=>void>(),calls:{params:Record<string,unknown>;signal:AbortSignal}[]=[];
 const box=(id:string,x:number)=>({id,kind:"box" as const,center:[x,0,0] as const,axes:[[1,0,0],[0,1,0],[0,0,1]] as const,size:[1,1,1] as const});
 const service=createHolotable({later:(ms,fn)=>{if(ms===250)timers.add(fn);return()=>{timers.delete(fn);};},transport:async(method,params,signal)=>{
  if(method==="runs.list")return ok(runs);if(method==="session.open")return ok({...session,meta:{...session.meta,standalone:undefined}});
  if(method==="layers.watch")return ok({watch:"w"});
  if(method==="world.around"&&params.center){calls.push({params,signal});const x=(params.center as number[])[0];return ok({...world,solids:[box(String(x),x)]});}
  return ok(method==="world.around"?world:agents);
 }},ctl.signal);
 try{
  service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"recording"});
  const generation=service.snapshot().openGeneration;await service.dispatch({kind:"holo.open",dir:"recording"});expect(service.snapshot().openGeneration).toBe(generation+1);
  service.context(a.signal).want([0,0,0],true);service.context(b.signal).want([1000,0,0],true);
  expect(calls).toHaveLength(0);for(const run of [...timers]){timers.delete(run);run();}await settle();
  expect(calls.map(call=>call.params)).toEqual([{dir:"recording",center:[0,0,0],margin:350},{dir:"recording",center:[1000,0,0],margin:350}]);
  expect(service.snapshot().open!.world.solids!.map(s=>s.id)).toEqual(["0","1000"]);
  a.abort();expect(service.snapshot().open!.world.solids!.map(s=>s.id)).toEqual(["1000"]);
  b.abort();expect(service.snapshot().open!.world.solids).toEqual([]);expect(timers.size).toBe(0);
 }finally{a.abort();b.abort();ctl.abort();}
});
