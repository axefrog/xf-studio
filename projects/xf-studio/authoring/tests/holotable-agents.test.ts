import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, lightDocument, lightEvent, type LightElement } from "./light-dom";
import { createHolotable, type HoloState } from "../src/features/holotable/service";
import { momentItems, openNotice } from "../src/features/holotable/view/panel";
import { holotableDetailsPanel } from "../src/features/holotable/view/details-panel";
import { holotableFacade } from "../src/features/holotable/facade";
import type { ModuleViewContext } from "../src/studio-ui/views/feature-view";
import type { HolotableFacade } from "../src/features/holotable/facade";
import type { AgentAnswer } from "../src/features/holotable/agent-types";
import type { HoloSession } from "../src/features/holotable/types";
beforeAll(()=>installLightDom());afterAll(()=>uninstallLightDom());
const settle=()=>new Promise(r=>setTimeout(r,0));
const full:AgentAnswer={specs:{schema:"xfh/projections-1",kinds:{}},here:[],layers:[{id:"writer/actors",title:"Actors",producer:"writer",layer:"actors",refused:2,reason:"Bad coordinates.",notPlaced:["missing"],otherBranches:[],items:[{id:"a",key:"writer/actors/a",kind:"actor",glyph:"courier",badge:"pending",anchor:{at:[0,0,0]},place:[0,0,0],value:{name:"Synthetic Mira",role:"generated fixer",facets:{thinking:"Wait for the courier"}},relations:["writer/actors/tie"],cite:"agent:writer:1"},{id:"kai",key:"writer/actors/kai",kind:"actor",anchor:{at:[1,0,0]},place:[1,0,0],value:{name:"Synthetic Kai"}},{id:"tie",key:"writer/actors/tie",kind:"relation",anchor:{item:"a"},value:{type:"loyal to",mutual:true},links:{from:"writer/actors/kai",to:"writer/actors/a"},cite:"agent:writer:2"}]},{id:"writer/places",title:"Places",producer:"writer",layer:"places",refused:0,reason:"",notPlaced:[],otherBranches:[],items:[]}]};
const session:HoloSession={meta:{session:"s",run:1,start:0,end:10,from:0,to:10,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"synthetic",problems:[]},v:[],camera:[],events:[],gaps:[]};
test("producer switches compose layer rows; inspector shows facets, relations, placement and What's here",async()=>{
 const ctl=new AbortController();let stops=0;
 const service=createHolotable({later:()=>()=>{},transport:async(method,p)=>{
   let result:unknown={};
   if(method==="runs.list")result=[{session:"s",run:1,dir:"fixture",start:0,end:10,bytes:0,complete:true}];
   if(method==="session.open")result=session;
   if(method==="world.around")result={provenance:null,areas:[],cells:[]};
   if(method==="layers.watch")result={watch:"lease"};
   if(method==="layers.stop")stops++;
   if(method==="layers.poll")result=p.level==="full"?{...full,here:p.position?[{layer:"writer/actors",title:"Actors",items:full.layers[0].items.map(item=>({item,distance:0}))}]:[]}:{...full,layers:full.layers.map(l=>({...l,items:l.items.map(i=>({...i,value:i.kind==="actor"?{name:"generated fixer"}:{}}))})),here:[]};
   return{ok:true,status:200,data:{ok:true,result}};
 }},ctl.signal);
 service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"fixture"});
 const facade=holotableFacade(service),ctx={facade,changed(){},dispatch:async(action:any)=>(await service.dispatch(action)).ok} as ModuleViewContext<HolotableFacade>;
 const panel=holotableDetailsPanel(ctx);lightDocument.body.append(panel.spec.element as unknown as LightElement);panel.update(undefined as never);
 expect(panel.spec.element.textContent).toContain("Agent layers");expect(panel.spec.element.textContent).toContain("2 refused");
 const story=lightDocument.body.querySelectorAll("input").find(i=>i.parentNode?.textContent.includes("Story content"));expect(story?.checked).toBe(true);
 await service.dispatch({kind:"holo.select",id:"writer/actors/a"});panel.update(undefined as never);
 expect(panel.spec.element.textContent).toContain("Wait for the courier");expect(panel.spec.element.textContent).toContain("loyal to ↔ Synthetic Kai");
 await service.dispatch({kind:"holo.producer",producer:"writer",on:false});panel.update(undefined as never);expect(service.snapshot().agentEnabled).toEqual({"writer/actors":false,"writer/places":false});
 await service.dispatch({kind:"holo.producer",producer:"writer",on:true});await service.dispatch({kind:"holo.place",position:[0,0,0]});panel.update(undefined as never);expect(panel.spec.element.textContent).toContain("What's here");expect(panel.spec.element.textContent).toContain("loyal to ↔ Synthetic Kai");
 await service.dispatch({kind:"holo.level",level:"structure"});panel.update(undefined as never);expect(panel.spec.element.textContent).not.toContain("Wait for the courier");expect(service.snapshot().agents.layers[0].items[0].glyph).toBe("courier");expect(service.snapshot().agents.layers[0].items[0].badge).toBe("pending");
 service.withdraw();await settle();expect(stops).toBe(1);ctl.abort();panel.dispose?.();
});

test("a late layer watch from an earlier showing is released after hide and re-show",async()=>{
 const ctl=new AbortController();let finishFirst!:(value:any)=>void,watches=0;const stopped:string[]=[];
 const first=new Promise(resolve=>{finishFirst=resolve;});
 const service=createHolotable({later:()=>()=>{},transport:async(method,p)=>{
   let result:unknown={};
   if(method==="layers.watch")result=++watches===1?await first:{watch:"new"};
   if(method==="layers.stop")stopped.push(String(p.watch));
   if(method==="runs.list")result=[];
   return{ok:true,status:200,data:{ok:true,result}};
 }},ctl.signal);
 service.shown();await settle();service.withdraw();service.shown();await settle();finishFirst({watch:"old"});await settle();
 expect(stopped).toContain("old");expect(stopped).not.toContain("new");service.withdraw();await settle();expect(stopped).toContain("new");ctl.abort();
});


test("failed opens render their title and reason in place with the library retry button",()=>{
 const ctl=new AbortController(), service=createHolotable({transport:null},ctl.signal);let retried="";
 const state={...service.snapshot(),phase:"failed" as const,openError:{dir:"layers:writer/week",title:"Kabuki week",reason:"Spool is unreadable."}};
 const notice=openNotice(state,dir=>{retried=dir;});
 expect(notice.textContent).toContain("Couldn't open Kabuki week: Spool is unreadable.");expect(notice.textContent).not.toContain("No recording open");
 const retry=(notice as unknown as LightElement).querySelectorAll("button").find(b=>b.textContent.includes("Try again"))!;
 retry.dispatchEvent(lightEvent("click"));expect(retried).toBe("layers:writer/week");ctl.abort();
});

test("layers-only switches hide recording controls and restore them on a recording or live session",()=>{
 const ctl=new AbortController(),service=createHolotable({transport:null},ctl.signal);
 let state:HoloState={...service.snapshot(),open:{dir:"layers:writer/week",session:{...session,meta:{...session.meta,standalone:{set:"writer/week",title:"Week",clock:"game",branches:[]}}},world:{provenance:null,areas:[],cells:[]}}};
 const facade=holotableFacade(service),ctx={facade:{...facade,snapshot:()=>state},dispatch:()=>Promise.resolve({ok:true})} as unknown as ModuleViewContext<HolotableFacade>;
 const panel=holotableDetailsPanel(ctx);lightDocument.body.append(panel.spec.element as unknown as LightElement);
 const row=(label:string)=>(panel.spec.element as unknown as LightElement).querySelectorAll("input").find(i=>i.parentNode?.textContent.includes(label))!.closest(".toggle-row")!;
 panel.update(undefined as never);
 for(const label of ["V and trail","Camera","Events with a place","Recorder gaps"])expect(row(label).hidden).toBe(true);
 for(const label of ["Districts","Streaming cells","Solid shapes","Story content"])expect(row(label).hidden).toBe(false);
 for(const dir of ["recording","live"]){state={...state,open:{...state.open!,dir,session}};panel.update(undefined as never);for(const label of ["V and trail","Camera","Events with a place","Recorder gaps"])expect(row(label).hidden).toBe(false);}
 state={...state,selected:"cluster:[0,0,0]",agents:{...full,layers:full.layers.map(l=>({...l,items:l.items.map(i=>({...i,place:[0,0,0] as const}))}))}};panel.update(undefined as never);
 expect(panel.spec.element.textContent).toContain("Synthetic Mira");expect(panel.spec.element.textContent).toContain("Synthetic Kai");
 ctl.abort();panel.dispose?.();
});

test("layers-only readout counts active items in visible layers, with a singular and empty state",()=>{
 const ctl=new AbortController(),service=createHolotable({transport:null},ctl.signal),base={...service.snapshot(),agents:full};
 expect(momentItems(base)).toBe("3 items at this moment");expect(momentItems({...base,agentEnabled:{"writer/actors":false}})).toBe("");
 expect(momentItems({...base,agents:{...full,layers:[{...full.layers[0],items:full.layers[0].items.slice(0,1)}]}})).toBe("1 item at this moment");ctl.abort();
});
