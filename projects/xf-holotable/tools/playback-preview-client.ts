import { moduleTargetMenu } from "../../xf-studio/authoring/src/studio-ui/target-menus";
// Asset-free isolated verification fixture. Uses the real service, panels, components and renderer.
import { createHolotable } from "../../xf-studio/authoring/src/features/holotable/service";
import { holotableFacade, type HolotableFacade } from "../../xf-studio/authoring/src/features/holotable/facade";
import { holotablePanel } from "../../xf-studio/authoring/src/features/holotable/view/panel";
import { holotableDetailsPanel } from "../../xf-studio/authoring/src/features/holotable/view/details-panel";
import { GroupSection, Segmented, iconButton } from "../../xf-studio/authoring/src/studio-ui/components";
import { h } from "../../xf-studio/authoring/src/studio-ui/dom";
import type { ModuleViewContext } from "../../xf-studio/authoring/src/studio-ui/views/feature-view";
import type { AgentAnswer, AgentItem } from "../../xf-studio/authoring/src/features/holotable/agent-types";
import type { HoloSession } from "../../xf-studio/authoring/src/features/holotable/types";
const query=new URLSearchParams(location.search);if(query.get("verify")!=="1")throw Error("Verification workspace required");
document.documentElement.dataset.theme=query.get("theme")??"light";
const game=query.get("clock")==="game", panelWidth=Number(query.get("width"))||850, ctl=new AbortController();
let clock=0,tick=()=>{};const contexts:{center:unknown;signal:AbortSignal}[]=[];
const specs={schema:"xfh/projections-1",tones:{signal:"signal",accent:"accent",warning:"warning",danger:"danger",muted:"text-muted"},kinds:{
  actor:{style:"tone",label:"{name}",draw:"diamond"},point:{style:"tone",label:"{label}",draw:"ring"},zone:{style:"tone",label:"{label}",draw:"volume"},path:{style:"tone",label:"{label}",draw:"polyline"},target:{style:"tone",label:"{label}",draw:"crosshair"}}};
const item=(id:string,place:readonly[number,number,number],glyph:string,badge:string,extra:Partial<AgentItem>={}):AgentItem=>({id,key:`synthetic/glyphs/${id}`,kind:"actor",glyph,badge,place,anchor:{at:place},value:{name:id},cite:`agent:synthetic:${id}`,version:0,...extra});
const items=[item("Fixer",[-40,30,0],"fixer","ready",{tone:"accent",detail:"Cause one\nCause two\nA long cause continues to wrap inside the inspector rather than escaping its property row."}),item("Courier",[0,0,0],"courier","pending"),
  item("Future glyph",[40,-30,0],"future-glyph","new",{tone:"warning"}),item("Clinic",[-65,-45,0],"clinic","done",{kind:"point",label:"Clinic"}),
  item("Blocked",[60,50,0],"goal","blocked",{kind:"target",label:"Blocked"}),item("Matched",[65,5,0],"person","matched"),
  item("Territory",[-10,50,0],"place","new",{kind:"zone",label:"Territory",anchor:{box:{min:[-25,40,0],max:[5,65,8]}}}),
  item("Route",[0,-55,0],"waypoint","pending",{kind:"path",label:"Route",anchor:{path:[[-10,-65,0],[0,-55,0],[25,-50,0]]}})];
const threshold=game?600:1;
let producerTitle:string|undefined="Story Engine";
const answer=(t:number):AgentAnswer=>({specs,here:[],layers:[{id:"synthetic/glyphs",producer:"synthetic",producer_title:producerTitle,facet_titles:{doing:"Doing"},layer:"glyphs",title:"Stories",refused:0,reason:"",notPlaced:[],otherBranches:[],changes:[0,threshold,threshold*2],
  items:items.filter(i=>t<threshold*2||i.id!=="Courier").map(i=>({...i,version:i.id==="Fixer"&&t>=threshold?1:0}))}]});
const session:HoloSession={meta:{session:"synthetic",run:1,start:0,end:game?604800:60,from:0,to:game?604800:60,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"Synthetic verification only",problems:[],
  standalone:{set:"synthetic/glyphs",title:"Glyph plates",clock:game?"game":"recording",branches:[],extent:{min:[-100,-100,0],max:[100,100,30]}}},v:[],camera:[],events:[{id:"synthetic-event",kind:"line",t:0,seq:1,summary:"Synthetic event",detail:"Said line one\nSaid line two",level:"full",cite:"synthetic:event"}],gaps:[]};
const service=createHolotable({transport:async(method,p,signal)=>{if(method==="world.around"&&p.center)contexts.push({center:p.center,signal});return({ok:true,status:200,data:{ok:true,result:method==="runs.list"?[{dir:"synthetic",session:"synthetic",run:1,start:0,end:session.meta.to,bytes:1,complete:true,standalone:true}]:method==="session.open"?session:method==="layers.watch"?{watch:"synthetic"}:method==="layers.poll"?answer(Number(p.t)):method==="world.around"?{provenance:null,areas:[],cells:[]}:{} }});},
  every:(_ms,fn)=>{tick=fn;return()=>{tick=()=>{};};},later:(ms,fn)=>{if(ms!==250)return()=>{};const id=setTimeout(fn,ms);return()=>clearTimeout(id);}},ctl.signal);
const facade=holotableFacade(service),panels:ReturnType<typeof holotablePanel>[]=[],frames:unknown[]=[];
const paint=()=>{for(const panel of panels)panel.update(undefined as never);};
const ctx={facade,changed:paint,targetMenu:(definition,anchor,invoker)=>{moduleTargetMenu(facade,definition,action=>{void ctx.dispatch(action as never);},anchor,{invoker});},dispatch:async action=>(await service.dispatch(action)).ok} as ModuleViewContext<HolotableFacade>;
const view=holotablePanel(ctx,f=>{frames.push(f);if(frames.length>100)frames.shift();},()=>clock),details=holotableDetailsPanel(ctx);panels.push(view,details);
const reference=new GroupSection({title:"Component reference",key:"verification:playback",expanded:true});
const pattern=new Segmented({label:"Compact Segmented",compact:true,options:[{value:1,label:"1×"},{value:4,label:"4×"},{value:16,label:"16×"}],onSelect(){}});pattern.update(4);
reference.body.append(pattern.element,h("div",{class:"control-line"},iconButton({label:"Previous change",title:"Previous change ([)",icon:"dot",small:true}),iconButton({label:"Next change",title:"Next change (])",icon:"dot",small:true})));
const section=(title:string,width:number,content:HTMLElement,height:number)=>h("section",{style:`width:${width}px;flex:none;min-width:0;background:var(--bg-panel);border:1px solid var(--line)`},h("h2",{style:"font-size:14px;margin:0;padding:12px;border-bottom:1px solid var(--line)",text:title}),h("div",{style:`height:${height}px;overflow:auto`},content));
document.body.replaceChildren(h("main",{style:"padding:20px;width:max-content"},h("h1",{style:"font-size:20px;margin:0 0 8px",text:"Holotable playback and glyphs"}),h("p",{class:"note muted",text:"Isolated verification · synthetic content · no game assets"}),h("div",{style:"display:flex;gap:16px;align-items:flex-start"},section(game?"Game clock":"Recording replay",panelWidth,view.spec.element,580),section("Layer diagnostics",300,details.spec.element,580),section("Library patterns",280,reference.element,580))));
service.subscribe(paint);service.shown();
for(let n=0;n<30;n++)await Promise.resolve();await service.dispatch({kind:"holo.open",dir:"synthetic"});await service.dispatch({kind:"holo.select",id:"synthetic/glyphs/Fixer"});paint();
await service.dispatch({kind:"holo.change.scope",layer:"synthetic/glyphs"});paint();
(globalThis as any).holoVerification={service,frames,contexts,paint,async producerTitle(title?:string){producerTitle=title;await service.dispatch({kind:"holo.seek",t:service.snapshot().t});paint();},async pulse(){await service.dispatch({kind:"holo.seek",t:threshold-.01});await service.dispatch({kind:"holo.play",on:true});tick();for(let n=0;n<30;n++)await Promise.resolve();clock=150;paint();},async fade(){await service.dispatch({kind:"holo.seek",t:threshold*2-.01});await service.dispatch({kind:"holo.play",on:true});tick();for(let n=0;n<30;n++)await Promise.resolve();clock=300;paint();}};
document.body.dataset.ready="true";
addEventListener("pagehide",()=>{ctl.abort();for(const panel of panels)panel.dispose?.();},{once:true});
