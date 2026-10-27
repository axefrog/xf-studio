/** Isolated UI client. World content is served privately by capture-w1-layers; nothing is bundled. */
import { createHolotable, type HoloAction } from "../../xf-studio/authoring/src/features/holotable/service";
import { holotableFacade, type HolotableFacade } from "../../xf-studio/authoring/src/features/holotable/facade";
import { holotablePanel, type HolotableFrame } from "../../xf-studio/authoring/src/features/holotable/view/panel";
import { holotableDetailsPanel } from "../../xf-studio/authoring/src/features/holotable/view/details-panel";
import { GroupSection, Toggle, propertyList } from "../../xf-studio/authoring/src/studio-ui/components";
import { h } from "../../xf-studio/authoring/src/studio-ui/dom";
import type { ModuleViewContext } from "../../xf-studio/authoring/src/studio-ui/views/feature-view";
import type { HoloSession, Vec3 } from "../../xf-studio/authoring/src/features/holotable/types";
import type { AgentAnswer } from "../../xf-studio/authoring/src/features/holotable/agent-types";
const q=new URLSearchParams(location.search);if(q.get("verify")!=="1")throw Error("Verification workspace required");
document.documentElement.dataset.theme=q.get("theme")??"light";
const center:Vec3=await (await fetch("/center")).json(),width=Number(q.get("width"))||850,ctl=new AbortController();let missing=false;
const session:HoloSession={meta:{session:"w1-preview",run:0,start:0,end:100,from:0,to:100,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"Offline verification",problems:[],standalone:{set:"w1",title:"Kabuki",clock:"game",branches:[],extent:{min:[center[0]-180,center[1]-180,center[2]],max:[center[0]+180,center[1]+180,center[2]+15]}}},v:[],camera:[],events:[],gaps:[]};
const agents:AgentAnswer={layers:[],here:[],specs:{schema:"xfh/projections-1",tones:{signal:"signal",muted:"text-muted"},kinds:{point:{style:"tone",draw:"ring",label:"{label}"},label:{style:"tone",draw:"text",label:"{label}"}}}};
// Motion measurement keeps authored overlays in the scene, independently of base-detail density.
if(q.has("motion"))agents.layers=[{id:"fixture/story",producer:"fixture",producer_title:"Story Engine fixture",layer:"story",title:"Observers",items:Array.from({length:12},(_,n)=>({id:String(n),key:`fixture/story/${n}`,kind:"point",glyph:"person",label:`Observer ${n+1}`,place:[center[0]+(n%4-1.5)*28,center[1]+(Math.floor(n/4)-1)*28,center[2]],anchor:{at:center},version:1})),notPlaced:[],otherBranches:[],refused:0,reason:"",changes:[0]}];
if(q.has("dense")){
 agents.specs={...agents.specs,kinds:{...agents.specs.kinds,field:{style:"tone",draw:"grid",label:""}}};
 agents.layers=[...agents.layers,{id:"fixture/fields",producer:"fixture",producer_title:"Dense field fixture",layer:"fields",title:"Four 128 × 128 fields",items:Array.from({length:4},(_,i)=>{
  const origin:Vec3=[center[0]-128+(i%2)*20,center[1]-128+Math.floor(i/2)*20,center[2]+i*.1];
  return {id:`field-${i}`,key:`fixture/fields/${i}`,kind:"field",anchor:{grid:{origin,cell:4,rows:128,cols:128}},place:center,value:{scalars:Array.from({length:128*128},(_,n)=>(Math.sin(n%128/16+i)+Math.cos(Math.floor(n/128)/12+i)+2)/4)},version:1};
 }),notPlaced:[],otherBranches:[],refused:0,reason:"",changes:[0]}];
}
const service=createHolotable({transport:async(method,p,signal)=>{
 let result:unknown={};if(method==="runs.list")result=[{dir:"preview",session:"w1-preview",run:0,start:0,end:100,bytes:0,complete:true,title:"Kabuki",standalone:true}];
 if(method==="session.open")result=session;if(method==="layers.watch")result={watch:"synthetic"};if(method==="layers.poll")result=agents;
 if(method==="world.around")result=await (await fetch("/world",{method:"POST",body:JSON.stringify({...p,missing}),signal})).json();
 return {ok:true,status:200,data:{ok:true,result}};
}},ctl.signal);
const facade=holotableFacade(service),frames:HolotableFrame[]=[],panels:ReturnType<typeof holotablePanel>[]=[],paint=()=>{for(const panel of panels)panel.update(undefined as never);};
const ctx={facade,instance:(id:string)=>id,targets:()=>({view:"holotable.view"}),changed:paint,dispatch:async(action:HoloAction)=>(await service.dispatch(action)).ok} as ModuleViewContext<HolotableFacade>;
const view=holotablePanel(ctx,frame=>{frames.push(frame);if(q.has("motion"))(frame as any).at=performance.now();if(frames.length>2000)frames.shift();}),details=holotableDetailsPanel(ctx);panels.push(view,details);
const reference=new GroupSection({title:"Library patterns",key:"w1-reference",expanded:true}),toggle=new Toggle({label:"Layer toggle",onChange(){}});toggle.update(true,{note:"8 on the map now"});reference.body.append(toggle.element,propertyList([["Kind","Point of interest"]]));
const section=(title:string,element:HTMLElement,w:number)=>h("section",{style:`width:${w}px;min-width:0;flex:none;background:var(--bg-panel);border:1px solid var(--line)`},h("h2",{style:"font-size:14px;margin:0;padding:12px;border-bottom:1px solid var(--line)",text:title}),h("div",{style:"height:650px;overflow:auto"},element));
document.body.replaceChildren(h("main",{style:"padding:20px;width:max-content"},h("h1",{style:"font-size:20px;margin:0 0 8px",text:"Holotable · Kabuki world content"}),h("p",{class:"note muted",text:"Isolated verification · private offline world data"}),h("div",{style:"display:flex;gap:16px;align-items:flex-start"},section("Kabuki",view.spec.element,width),section("Selected and Show",details.spec.element,width),section("Component reference",reference.element,260))));
service.subscribe(paint);service.shown();await new Promise(r=>setTimeout(r,0));await service.dispatch({kind:"holo.open",dir:"preview"});
for(const id of ["pois","spots","communities"] as const)await service.dispatch({kind:"holo.layer",id,on:true});paint();
(globalThis as any).w1={service,frames,paint,async missing(){missing=true;await service.dispatch({kind:"holo.layer",id:"pois",on:false});await service.dispatch({kind:"holo.layer",id:"pois",on:true});},async focus(type:"pois"|"spots"|"communities"){
 const c=service.snapshot().open!.world.content!;
 const named=q.has("names")&&type==="communities"?c.communities.find(r=>r.entries.some(e=>e.record&&c.records?.[e.record]?.name?.includes(".kab_"))&&r.entries.every(e=>e.record&&c.records?.[e.record]?.name)):undefined;
 const record=named||c[type].find(r=>type==="communities"?"entries" in r&&r.entries.length===1&&r.entries[0].phases.length<5:type!=="pois"||"kind" in r&&r.kind==="Ripperdoc")||c[type].find(r=>"entries" in r&&r.entries.length===1&&r.entries[0].phases.length<5)||c[type][0];if(!record)throw Error(`No ${type}`);
 const id=`base:${type}:${record.id}`;await service.dispatch({kind:"holo.select",id});if(type!=="communities")await service.dispatch({kind:"holo.view.focus",view:"holotable.view",id});paint();
}};
document.body.dataset.ready="true";
addEventListener("pagehide",()=>{ctl.abort();for(const panel of panels)panel.dispose?.();},{once:true});
