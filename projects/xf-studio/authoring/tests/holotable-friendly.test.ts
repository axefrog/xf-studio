import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, lightEvent, type LightElement } from "./light-dom";
import { clusterFallback, clusterPlates, clusterPlateSteps } from "../src/features/holotable/view/clusters";
import { navigation, type Viewpoint } from "../src/features/holotable/view/navigation";
import { camera, ORBITS, project } from "../src/features/holotable/view/projection";
import { addLegend, orderedLegend, FAMILY_TITLES, cardDetail, facetTitle, humanMoment, humanSpan, plainCounts, quietUntil, type LegendEntry } from "../src/features/holotable/view/friendly";
import { createHolotable, type HoloAction } from "../src/features/holotable/service";
import { holotableFacade } from "../src/features/holotable/facade";
import { holotableDetailsPanel } from "../src/features/holotable/view/details-panel";
import { keyBinding } from "../src/app/input-bindings";
import type { AgentAnswer, AgentItem } from "../src/features/holotable/agent-types";
import type { HoloSession } from "../src/features/holotable/types";
import type { ModuleViewContext } from "../src/studio-ui/views/feature-view";
import type { HolotableFacade } from "../src/features/holotable/facade";

const item=(id:string,x=0):AgentItem=>({id,key:`p/a/${id}`,kind:"actor",glyph:"courier",place:[x,0,0],anchor:{at:[x,0,0]},value:{name:id},cite:`agent:p:${id}`});
const session:HoloSession={meta:{session:"s",run:1,start:0,end:864000,from:0,to:864000,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"synthetic",problems:[],standalone:{set:"p/week",title:"Week",clock:"game",branches:[]}},v:[],camera:[],events:[],gaps:[]};
const answer:AgentAnswer={specs:{schema:"xfh/projections-1",kinds:{}},here:[],layers:[{id:"p/a",layer:"a",title:"People",producer:"p",total:31,facet_titles:{gang_affiliation:"Affiliation"},refused:2,reason:"Bad coordinates",notPlaced:["missing"],otherBranches:[],changes:[0,900,7200],items:[{...item("Courier"),t:3600,until:14400,detail:"Waiting for a delivery.\nNear the clinic.\nBecause the road is closed.",facets:{gang_affiliation:"Independent"},relations:["p/a/tie"]},item("Fixer",100),{...item("tie"),kind:"relation",value:{type:"knows"},links:{from:"p/a/Courier",to:"p/a/Fixer"}}]}]};

test("legend groups glyphs and kind fallbacks into stable families, leaving unmarked lines out",()=>{
 const counts=new Map<string,LegendEntry>();
 const add=(kind:string,glyph?:string)=>addLegend(counts,{...item(kind),kind,glyph});
 add("point","held");add("point","vehicle");add("point","goal");add("field");add("target");add("path");add("zone");add("zone","clinic");add("point","story");add("point","warning");add("actor","gang");add("actor");add("actor","courier");add("actor","unknown-future");add("point");add("label");add("relation");add("influence");
 expect(orderedLegend(counts).map(e=>FAMILY_TITLES[e.family])).toEqual(["People","Groups","Events","Story","Places","Areas","Routes","Markers","Fields","Diagnostics","Things","Direction"]);
 expect(counts.get("person")?.count).toBe(3);expect(counts.get("marker")?.count).toBe(3);expect(counts.has("relation")).toBe(false);expect(counts.has("influence")).toBe(false);
 const sparse=new Map<string,LegendEntry>();addLegend(sparse,{...item("only"),glyph:undefined});expect(orderedLegend(sparse).map(e=>FAMILY_TITLES[e.family])).toEqual(["People"]);
});
async function fixture(layers:AgentAnswer=answer){
 const ctl=new AbortController();const service=createHolotable({later:()=>()=>{},transport:async(method)=>({ok:true,status:200,data:{ok:true,result:method==="runs.list"?[{dir:"synthetic",session:"s",run:1,start:0,end:864000,bytes:0,complete:true}]:method==="session.open"?session:method==="world.around"?{provenance:null,areas:[],cells:[]}:method==="layers.watch"?{watch:"test"}:method==="layers.poll"?layers:{}}})},ctl.signal);
 service.shown();await service.dispatch({kind:"holo.refresh"});await service.dispatch({kind:"holo.open",dir:"synthetic"});return {ctl,service};
}

test("overlapping plates merge transitively and split on reprojection, with fixed grid work even at 5,000 coincident plates",()=>{
 const plates=[{item:item("a"),x:100,y:100},{item:item("b",10),x:116,y:100},{item:item("c",20),x:132,y:100}];
 const merged=clusterPlates(plates);expect(merged.clusters).toHaveLength(1);expect(merged.clusters[0].items).toHaveLength(3);expect(merged.hidden.size).toBe(3);
 expect(clusterPlates(plates.map((p,n)=>({...p,x:100+n*40}))).clusters).toHaveLength(0);
 const dense=Array.from({length:5000},(_,n)=>({item:item(String(n)),x:100,y:100})),result=clusterPlates(dense);
 const job=clusterPlateSteps(dense);let yields=0,step=job.next();while(!step.done){yields++;step=job.next();}expect(yields).toBeGreaterThan(200);expect(step.value.hidden.size).toBe(5000);
 expect(result.clusters).toHaveLength(1);expect(result.visits).toBeLessThanOrEqual(dense.length*16);
 expect(clusterPlates(dense.slice(0,12),true).clusters).toHaveLength(0);expect(clusterPlates(dense.slice(0,13),true).clusters).toHaveLength(1);
});

test("focus stores eight detached viewpoints; back animates for 300 ms and reduced motion is instant",()=>{
 let time=0;const nav=navigation(()=>time),start={center:[0,0,0] as const,orbit:{...ORBITS.tilt}};
 let current:Viewpoint=start;
 for(let n=1;n<=10;n++)current=nav.focus(current,{center:[n,0,0],orbit:{...ORBITS.top,distance:100+n}},false);
 expect(nav.depth).toBe(8);expect(nav.frame(current).center[0]).toBe(9);time=150;expect(nav.frame(current).center[0]).toBeGreaterThan(9);time=300;expect(nav.frame(current)).toEqual(current);expect(nav.moving).toBe(false);
 for(let n=9;n>=2;n--){current=nav.back(current,true)!;expect(current.center[0]).toBe(n);expect(nav.moving).toBe(false);}
 expect(nav.back(current,true)).toBeUndefined();nav.reset();expect(nav.depth).toBe(0);
});

test("navigation actions require the named registered view and refuse missing bindings and released views",async()=>{
 const {service,ctl}=await fixture();const viewCtl=new AbortController();let focused="",backs=1;
 try{
 service.navigation("view-a",{available:()=>true,focus:t=>{focused=t.layer??t.id??"";return true;},back:()=>{backs--;return true;},canBack:()=>backs>0},viewCtl.signal);
 const facade=holotableFacade(service);
 for(const kind of ["holo.view.focus","holo.view.back"] as const){
   const action=kind==="holo.view.focus"?{kind,view:"",id:"p/a/Courier"}:{kind,view:""};
   expect(facade.capability(action)).toMatchObject({available:false,code:"missing_target",reason:"Open a Holotable view first"});
   expect((await facade.dispatch(action)).ok).toBe(false);expect(focused).toBe("");expect(backs).toBe(1);
 }
 expect(facade.nextVisibleChange()).toBe(900);
 expect((await service.dispatch({kind:"holo.view.focus",view:"view-a",layer:"p/a"})).ok).toBe(true);expect(focused).toBe("p/a");
 await service.dispatch({kind:"holo.view.back",view:"view-a"});expect(service.capability({kind:"holo.view.back",view:"view-a"}).available).toBe(false);
 viewCtl.abort();expect((await service.dispatch({kind:"holo.view.focus",view:"view-a",id:"a"})).ok).toBe(false);
 }finally{viewCtl.abort();ctl.abort();}
});

test("Esc belongs to Holotable only outside text fields and dialogs",()=>{
 expect(keyBinding("holotable",{key:"Escape"})?.id).toBe("holo.view.back");
 expect(keyBinding("holotable",{key:"Escape"},{textInput:true})).toBeUndefined();expect(keyBinding("holotable",{key:"Escape"},{modalOpen:true})).toBeUndefined();
 expect(keyBinding("head",{key:"Escape"})).toBeUndefined();
});

test("human recording and game times, spans, producer facet titles and cause lines",()=>{
 expect(humanMoment(86400+14*3600+30*60,true)).toBe("Day 2 · 14:30");expect(humanMoment(3723,false,60)).toBe("1:01:03");
 expect(humanSpan({},true)).toBe("Throughout");expect(humanSpan({t:32400},true)).toBe("From Day 1 · 09:00");
 expect(humanSpan({t:0,until:10800},true)).toBe("Day 1 · 00:00, for 3 h");expect(humanSpan({until:65},false)).toBe("Until 1:05");
 expect(facetTitle("constructor",{})).toBe("Constructor");
 expect(facetTitle("gang_affiliation")).toBe("Gang affiliation");expect(facetTitle("gang-affiliation",{"gang-affiliation":"Affiliation"})).toBe("Affiliation");
 expect(cardDetail("Waiting.\nBecause it rained.\nCause: delay")).toEqual({summary:"Waiting.",why:"Because it rained.\nCause: delay"});
 expect(plainCounts(answer.layers[0])).toBe("3 on the map now · of 31 in this set");
});

test("quiet stretches follow visible changes and jumping pauses at the next one",async()=>{
 const {service,ctl}=await fixture();try{
 expect(quietUntil(service.snapshot(),service.nextVisibleChange())).toBe(900);await service.dispatch({kind:"holo.change.next"});expect(service.snapshot().t).toBe(900);expect(service.snapshot().playing).toBe(false);
 await service.dispatch({kind:"holo.agentLayer",id:"p/a",on:false});expect(quietUntil(service.snapshot(),service.nextVisibleChange())).toBeUndefined();
 }finally{ctl.abort();}
});

test("overview districts fade to nothing at 300 m",()=>{
 const world={provenance:null,areas:[{id:"district",name:"Synthetic district",kind:"district" as const,poly:[[-10,-10],[10,-10],[10,10],[-10,10]] as [number,number][],zlo:0,zhi:10}],cells:[]};
 const layers={v:false,camera:false,people:false,events:false,gaps:false,areas:true,cells:false,solids:false};
 const far=project(session,world,0,layers,{...ORBITS.top,distance:450},850,500,null).primitives;
 expect(far.some(p=>p.kind==="text"&&p.text==="Synthetic district"&&p.opacity===1)).toBe(true);
 expect(project(session,world,0,layers,{...ORBITS.top,distance:300},850,500,null).primitives.some(p=>p.kind==="text"&&p.text==="Synthetic district")).toBe(false);
});

beforeAll(()=>installLightDom());afterAll(()=>uninstallLightDom());
test("inspector card sections, Technical default and remembered state, producer notes and Focus layer menu",async()=>{
 const {service,ctl}=await fixture(),facade=holotableFacade(service);let menu:any;const actions:HoloAction[]=[];
 const ctx={facade,changed(){},targets:()=>({view:"bound-view"}),targetMenu:(m:unknown)=>{menu=m;},dispatch:async(action:HoloAction)=>{actions.push(action);return (await service.dispatch(action)).ok;}} as unknown as ModuleViewContext<HolotableFacade>;
 const panel=holotableDetailsPanel(ctx),root=panel.spec.element as unknown as LightElement;
 try{
 await service.dispatch({kind:"holo.select",id:"p/a/Courier"});panel.update(undefined as never);
 expect(root.textContent).toContain("Waiting for a delivery.\nNear the clinic.");expect(root.textContent).toContain("for 3 h");expect(root.textContent).toContain("Involved");expect(root.textContent).toContain("Because the road is closed.");expect(root.textContent).toContain("Affiliation");expect(root.textContent).toContain("Producer notes");
 const technical=()=>root.querySelectorAll("button").find(b=>b.textContent==="Technical")!;
 expect(technical().getAttribute("aria-expanded")).toBe("false");technical().dispatchEvent(lightEvent("click"));expect(facade.preference("technical")).toBe(true);
 await service.dispatch({kind:"holo.select",id:"p/a/Fixer"});panel.update(undefined as never);expect(technical().getAttribute("aria-expanded")).toBe("true");
 const row=root.querySelectorAll(".toggle-row").find(e=>e.dataset.holotableLayer==="p/a")!;row.dispatchEvent(lightEvent("contextmenu"));
 expect(menu.items.find((i:any)=>i.label==="Focus on this layer").action).toEqual({kind:"holo.view.focus",view:"bound-view",layer:"p/a"});
 facade.remember("key",false,"bound-view");expect(facade.preference("key","bound-view")).toBe(false);expect(facade.preference("key","other-view")).toBe(true);
 }finally{panel.dispose?.();ctl.abort();}
});


test("minimum-zoom nearby distinct plates retain both exact members in Details",async()=>{
 const items=[item("Near A"),item("Near B",0.001)],C=camera([0,0,0],{...ORBITS.top,distance:40},300,400);
 const clusters=clusterPlates(items.map(i=>{const [x,y]=C.point(i.place!)!;return {item:i,x,y};}),true).clusters;
 expect(clusters).toHaveLength(1);expect(clusters[0].items).toHaveLength(2);
 const selection=clusterFallback(clusters[0]);expect(selection.members).toEqual(items.map(i=>i.key));
 const {service,ctl}=await fixture({...answer,layers:[{...answer.layers[0],items:[...items,item("Unrelated",10)]}]}),facade=holotableFacade(service);
 const panel=holotableDetailsPanel({facade,changed(){},dispatch:(action:HoloAction)=>service.dispatch(action)} as unknown as ModuleViewContext<HolotableFacade>),root=panel.spec.element as unknown as LightElement;
 try{
 await service.dispatch({kind:"holo.select",...selection});panel.update(undefined as never);
 expect(root.textContent).toContain("2 at this spot");expect(root.querySelectorAll("button").filter(b=>b.textContent==="Near A"||b.textContent==="Near B")).toHaveLength(2);expect(root.textContent).not.toContain("Unrelated");
 const colocated=clusterFallback({...clusters[0],items:[items[0],{...items[1],place:items[0].place}]});
 expect(colocated.members).toEqual(items.map(i=>i.key));
 await service.dispatch({kind:"holo.select",id:"cluster:[0,0,0]"});panel.update(undefined as never);expect(root.textContent).toContain("1 at this spot");
 await service.dispatch({kind:"holo.select",id:"p/a/Near A"});expect(service.snapshot().selectedCluster).toBeUndefined();
 }finally{panel.dispose?.();ctl.abort();}
});

test("Quiet until and its jump ignore step scope while step buttons keep it",async()=>{
 const {service,ctl}=await fixture({...answer,layers:[answer.layers[0],{...answer.layers[0],id:"p/b",layer:"b",changes:[0,450,1200,9000],items:[]}]});
 try{
 await service.dispatch({kind:"holo.change.scope",layer:"p/a"});expect(quietUntil(service.snapshot(),service.nextVisibleChange())).toBe(450);
 await service.dispatch({kind:"holo.change.next"});expect(service.snapshot().t).toBe(900);
 await service.dispatch({kind:"holo.seek",t:0});await service.dispatch({kind:"holo.change.next",allVisible:true});expect(service.snapshot().t).toBe(450);expect(service.snapshot().changeScope).toBe("p/a");expect(service.snapshot().playing).toBe(false);
 await service.dispatch({kind:"holo.change.previous"});expect(service.snapshot().t).toBe(0);
 await service.dispatch({kind:"holo.agentLayer",id:"p/b",on:false});expect(quietUntil(service.snapshot(),service.nextVisibleChange())).toBe(900);
 await service.dispatch({kind:"holo.agentLayer",id:"p/b",on:true});await service.dispatch({kind:"holo.seek",t:7200});
 expect(service.capability({kind:"holo.change.next"}).available).toBe(false);expect(quietUntil(service.snapshot(),service.nextVisibleChange())).toBe(9000);expect(service.capability({kind:"holo.change.next",allVisible:true}).available).toBe(true);
 await service.dispatch({kind:"holo.change.next",allVisible:true});expect(service.snapshot().t).toBe(9000);
 }finally{ctl.abort();}
});

test("legend family tone is independent of representative item tone",()=>{
 for(const tone of ["accent","warning","good"]){const counts=new Map<string,LegendEntry>();addLegend(counts,{...item("Fixer"),tone});expect(counts.get("person")?.tone).toBe("signal");}
});


test("Details routes pinned and follow-focus bindings as supplied by the platform, and never substitutes an unbound view",async()=>{
 const {service,ctl}=await fixture(),facade=holotableFacade(service),calls:string[]=[];let bound:string|undefined="pinned",menu:any;
 for(const view of ["pinned","follow"])service.navigation(view,{available:()=>true,focus:()=>{calls.push(view);return true;},back:()=>true,canBack:()=>true},ctl.signal);
 const panel=holotableDetailsPanel({facade,changed(){},targets:()=>({view:bound}),targetMenu:(m:unknown)=>{menu=m;},dispatch:(action:HoloAction)=>service.dispatch(action)} as unknown as ModuleViewContext<HolotableFacade>),root=panel.spec.element as unknown as LightElement;
 try{
 for(const view of ["pinned","follow",undefined]){
   bound=view;await service.dispatch({kind:"holo.select",id:"p/a/Courier"});panel.update(undefined as never);
   root.querySelectorAll("button").find(b=>b.textContent.includes("Fixer"))!.dispatchEvent(lightEvent("click"));
   expect(service.snapshot().selected).toBe("p/a/Fixer");expect(calls).toEqual(view==="pinned"?["pinned"]:["pinned","follow"]);
   root.querySelectorAll(".toggle-row").find(e=>e.dataset.holotableLayer==="p/a")!.dispatchEvent(lightEvent("contextmenu"));
   const focus=menu.items.find((i:any)=>i.label==="Focus on this layer").action;
   expect(focus.view).toBe(view??"");
   if(!view)expect(facade.capability(focus)).toMatchObject({available:false,reason:"Open a Holotable view first"});
 }
 }finally{panel.dispose?.();ctl.abort();}
});
