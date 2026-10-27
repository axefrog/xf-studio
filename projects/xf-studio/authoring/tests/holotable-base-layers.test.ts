import { expect, test } from "bun:test";
import { baseCard, baseItem, baseLayerItems, baseLayerSteps, communityTypes, communityOpacity, poiGlyph, poiTitle } from "../src/features/holotable/view/base-layers";
import { camera, ORBITS } from "../src/features/holotable/view/projection";
import { createHolotable } from "../src/features/holotable/service";
import { worldContexts } from "../src/features/holotable/world-context";
import type { HoloContent } from "../src/features/holotable/types";
const on={pois:true,spots:true,communities:true};
test("people summaries use data kinds, strip body codes/digits, preserve affiliation acronyms and collapse labels",()=>{
 const entries=["kab_ncpd_police_ranged2_ma","kab_ncpd_police_ranged1_wa","kab_guard_mb","kab_sitter_wb","kab_runner_fa","kab_vendor_fb","kab_child_mc","kab_child_wc"].map((n,i)=>({name:String(i),record:String(i),recordName:`Character.${n}`,kind:"person" as const,affiliation:{record:"aff",title:"NCPD"},phases:[]}));
 expect(communityTypes(entries)).toBe("8 types of people\nNCPD police ranged\nGuard\nSitter\nRunner\n+2 more");
 expect(communityTypes([{...entries[0],displayName:"Police officer"},{...entries[1],kind:"vehicle"}])).toBe("1 type of person · 1 vehicle\nPolice officer");
 expect(communityTypes([{...entries[0],recordName:"Character.kab_maxtac_ranged2_ma",affiliation:{record:"aff",title:"MaxTac"}}])).toBe("1 type of person\nMaxTac ranged");
 expect(communityTypes([{...entries[0],kind:undefined}])).toBe("1 unknown entry");
 expect(communityTypes([])).toBe("No entries");
});
const content:HoloContent={available:true,slices:["kabuki"],pois:[{id:"p",place:"test",at:[0,0,0],kind:"Ripperdoc",variant:"ServicePointRipperdocVariant",record:"1",journal:"journal/p"}],spots:[
 {id:"s1",place:"test",at:[-10,0,0],yaw:90,workspot:{path:"test.workspot",tags:["stand-around","talk_to_friend"]},communities:["c"]},
 {id:"s2",place:"test",at:[10,0,0],yaw:0,communities:["c"]},
 {id:"far",place:"test",at:[900,0,0],yaw:0,communities:["c"]}],communities:[{id:"c",place:"test",entries:[{name:"resident",record:"1234",recordName:"Character.street_vendor",kind:"person",phases:[{name:"day_shift",spots:["s1","s2","far"]}]}]}]};
test("POIs map only to Places glyphs and unknown raw variants say Place",()=>{
 expect(poiGlyph(content.pois[0])).toBe("clinic");expect(poiTitle(content.pois[0])).toBe("Ripperdoc");
 expect(poiGlyph({...content.pois[0],kind:"Food vendor"})).toBe("market");expect(poiGlyph({...content.pois[0],kind:"FutureVariant"})).toBe("place");expect(poiTitle({...content.pois[0],kind:"FutureVariant"})).toBe("Place");
});
test("POI selection shows a resolved title, while the map keeps its kind label",()=>{
 const named={...content,pois:[{...content.pois[0],title:"A local doctor"}]};
 expect(baseCard(named,"base:pois:p")).toMatchObject({title:"A local doctor",summary:"Ripperdoc"});
 expect(baseLayerItems(named,on).find(i=>i.base==="pois")?.label).toBe("Ripperdoc");
 expect(baseCard({...named,pois:[{...named.pois[0],title:undefined,kind:"FutureVariant"}]},"base:pois:p")?.title).toBe("FutureVariant");
 const card=baseCard(content,"base:communities:c")!;
 expect(card.summary).not.toContain("1234");expect(card.technical).toContainEqual(["Character records","1234"]);expect(card.technical).toContainEqual(["Record names","Character.street_vendor"]);
});
test("visible linked spots determine a community centroid and the overview fade",()=>{
 const C=camera([0,0,0],{...ORBITS.top,distance:300},850,500),items=baseLayerItems(content,on,C),community=items.find(i=>i.base==="communities")!;
 expect(community.place).toEqual([0,0,0]);expect(community.label).toBe("Community · 2 spots");
 expect(communityOpacity(100)).toBe(0);expect(communityOpacity(150)).toBe(.5);expect(communityOpacity(200)).toBe(1);
 expect(baseLayerItems(content,on,camera([0,0,0],{...ORBITS.top,distance:90},850,500)).find(i=>i.base==="communities")).toMatchObject({opacity:0,communitySpots:2});
});
test("dot work is capped nearest first, with cooperative source traversal",()=>{
 const dense={...content,spots:Array.from({length:5000},(_,i)=>({id:String(i),place:"test",at:[5000-i,0,0] as const,yaw:0,communities:[]}))};
 const steps=baseLayerSteps(dense,{pois:false,spots:true,communities:false});let yields=0,step=steps.next();while(!step.done){yields++;step=steps.next();}
 expect(yields).toBeGreaterThan(70);expect(step.value.length).toBe(2000);expect(baseItem(dense,"base:spots:0")?.place).toEqual([5000,0,0]);expect(step.value[0].id).toBe("4999");expect(step.value.at(-1)?.id).toBe("3000");expect(step.value.every(i=>!i.label&&!i.glyph)).toBe(true);
});
test("base cards keep raw values in Technical and expose phases and bounded chips",()=>{
 expect(baseCard(content,"base:pois:p")).toMatchObject({title:"Ripperdoc",summary:"Point of interest",technical:[["Id","p"],["Variant","ServicePointRipperdocVariant"],["Record","1"],["Journal","journal/p"]]});
 expect(baseCard(content,"base:spots:s1")).toMatchObject({title:"Spot",summary:"Stand around, Talk to friend",involved:[{key:"base:communities:c",label:"Community"}]});
 expect(baseCard(content,"base:communities:c")).toMatchObject({summary:"1 type of person\nStreet vendor",when:"1 time phase",more:0,involved:[{key:"base:spots:s1",label:"Spot · stand around"},{key:"base:spots:s2",label:"Spot · 2"},{key:"base:spots:far",label:"Spot · 3"}]});
 const many={...content,spots:Array.from({length:20},(_,i)=>({...content.spots[0],id:String(i)})),communities:[{...content.communities[0],entries:[{name:"resident",record:"12345",phases:[{name:"night",spots:Array.from({length:20},(_,i)=>String(i))}]}]}]};
 expect(baseCard(many,"base:communities:c")).toMatchObject({summary:"1 unknown entry",more:8});expect(baseCard(many,"base:communities:c")?.involved).toHaveLength(12);
});

test("community chips resolve only nearby response spots and count distant links separately",()=>{
 const nearby={...content,spots:[content.spots[0]],communities:[{...content.communities[0],entries:[{name:"resident",phases:[{name:"Morning",spots:["s1","distant","s1"]}]}]}]};
 const card=baseCard(nearby,"base:communities:c")!;
 expect(card.involved).toEqual([{key:"base:spots:s1",label:"Spot · stand around"}]);
 expect(card.more).toBe(0);expect(card.furtherAway).toBe(1);
 for(const chip of card.involved)expect(baseItem(nearby,chip.key)).toBeDefined();
 expect(baseCard({...nearby,spots:[]},"base:communities:c")).toMatchObject({involved:[],more:0,furtherAway:2});
});

test("community size order is prepared once per content response and cooperates with the frame budget",()=>{
 let sizesRead=0;
 const communities=Array.from({length:200},(_,i)=>({id:String(i),place:"test",get entries(){sizesRead++;return [{name:"resident",phases:[{name:"Morning",spots:Array.from({length:i+1},(_,s)=>String(s))}]}];}}));
 const dense={...content,communities,spots:[{...content.spots[0],communities:communities.map(c=>c.id)}]};
 const prepare=()=>{const steps=baseLayerSteps(dense,{pois:false,spots:false,communities:true});let yields=0,step=steps.next();while(!step.done){yields++;step=steps.next();}return {items:step.value,yields};};
 const first=prepare();expect(first.items.map(i=>i.id)).toEqual(communities.map(c=>c.id).reverse());expect(first.yields).toBeGreaterThan(300);expect(sizesRead).toBe(200);
 expect(prepare().items.map(i=>i.id)).toEqual(first.items.map(i=>i.id));expect(sizesRead).toBe(200);
 baseLayerItems({...dense}, {pois:false,spots:false,communities:true});expect(sizesRead).toBe(400);
});

test("content demand follows active leases, layer demand, reset and lifetime release",()=>{
 const ctl=new AbortController(),a=new AbortController(),b=new AbortController(),demands:boolean[]=[],timers=new Set<()=>void>();let enabled=true;
 const contexts=worldContexts({source:()=>({identity:"test",params:{content:enabled}}),later:(_ms,fn)=>{timers.add(fn);return()=>{timers.delete(fn);};},load:async()=>({provenance:null,areas:[],cells:[]}),changed(){},contentDemand:wanted=>demands.push(wanted)},ctl.signal);
 try{
  const one=contexts.lease(a.signal),two=contexts.lease(b.signal);expect(demands).toEqual([]);
  one.want([0,0,0]);two.want([100,0,0]);expect(demands).toEqual([true]);
  a.abort();expect(demands).toEqual([true]);enabled=false;contexts.refresh(true);expect(demands).toEqual([true,false]);
  enabled=true;contexts.refresh(true);expect(demands).toEqual([true,false,true]);b.abort();expect(demands).toEqual([true,false,true,false]);
  const c=new AbortController(),three=contexts.lease(c.signal);three.want([0,0,0]);contexts.reset();expect(demands.slice(-2)).toEqual([true,false]);
  three.want([0,0,0]);ctl.abort();expect(demands.slice(-2)).toEqual([true,false]);c.abort();expect(timers.size).toBe(0);
 }finally{a.abort();b.abort();ctl.abort();}
});
test("view leases acquire content only while a base layer is enabled and static content never adds a change",async()=>{
 const ctl=new AbortController(),view=new AbortController(),timers=new Set<()=>void>(),calls:Record<string,unknown>[]=[],demands:Record<string,unknown>[]=[];
 const session={meta:{session:"test",run:1,start:0,end:100,from:0,to:100,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"",problems:[]},v:[],camera:[],events:[],gaps:[]};
 const service=createHolotable({later:(ms,fn)=>{if(ms===250)timers.add(fn);return()=>timers.delete(fn);},transport:async(method,p)=>{let result:unknown={};if(method==="runs.list")result=[{dir:"r",session:"test",run:1}];if(method==="session.open")result=session;if(method==="world.content.demand")demands.push(p);if(method==="world.around"){calls.push(p);result={provenance:null,areas:[],cells:[],content:{...content,...(p.content?{}:{pois:[],spots:[],communities:[]})}};}return {ok:true,status:200,data:{ok:true,result}};}},ctl.signal);
 const settle=()=>new Promise(r=>setTimeout(r,0)),flush=async()=>{for(const fn of [...timers]){timers.delete(fn);fn();}await settle();};
 try{
  service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"r"});service.context(view.signal).want([0,0,0]);await flush();expect(calls.every(c=>!c.content)).toBe(true);
  expect(service.snapshot().layers).toMatchObject({pois:false,spots:false,communities:false});await service.dispatch({kind:"holo.layer",id:"pois",on:true});await flush();expect(calls.at(-1)?.content).toBe(true);expect(service.nextVisibleChange()).toBeUndefined();
  await service.dispatch({kind:"holo.layer",id:"pois",on:false});await flush();expect(calls.at(-1)?.content).toBeUndefined();
  await service.dispatch({kind:"holo.layer",id:"communities",on:true});await flush();
  view.abort();expect(service.snapshot().open?.world.content?.pois).toEqual([]);await settle();
  expect(demands.map(p=>p.wanted)).toEqual([true,false,true,false]);expect(new Set(demands.map(p=>p.consumer)).size).toBe(1);expect(calls.at(-1)?.contentConsumer).toBe(demands[0].consumer);
 }finally{view.abort();ctl.abort();}
});

test("separate view leases retain only their own nearby content and file availability",async()=>{
 const ctl=new AbortController(),a=new AbortController(),b=new AbortController(),timers=new Set<()=>void>();let published:HoloContent|undefined;
 const contexts=worldContexts({source:()=>({identity:"test",params:{content:true}}),later:(_ms,fn)=>{timers.add(fn);return()=>timers.delete(fn);},load:async p=>{
  const x=(p.center as number[])[0];return {provenance:null,areas:[],cells:[],content:{...content,available:x===0,pois:x===0?content.pois:[],spots:x===0?content.spots:[],communities:x===0?content.communities:[]}};
 },changed:world=>{published=world.content;}},ctl.signal);
 try{
  const first=contexts.lease(a.signal),second=contexts.lease(b.signal);first.want([0,0,0]);second.want([2000,0,0]);
  for(const fn of [...timers]){timers.delete(fn);fn();}await new Promise(r=>setTimeout(r,0));
  expect(published?.pois.length).toBe(1);expect(first.contentAvailable()).toBe(true);expect(second.contentAvailable()).toBe(false);
  a.abort();expect(published?.pois).toEqual([]);expect(published?.spots).toEqual([]);expect(second.contentAvailable()).toBe(false);
  b.abort();expect(published?.communities).toEqual([]);
 }finally{a.abort();b.abort();ctl.abort();}
});

test("existing shared status traffic renews only active content demand, even if the final release is lost",async()=>{
 const ctl=new AbortController(),a=new AbortController(),b=new AbortController(),c=new AbortController(),timers=new Map<()=>void,number>(),statuses:Record<string,unknown>[]=[],demands:Record<string,unknown>[]=[];
 const session={meta:{session:"test",run:1,start:0,end:1,from:0,to:1,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"",problems:[],standalone:{set:"test",title:"Test",clock:"game",branches:[]}},v:[],camera:[],events:[],gaps:[]};
 const service=createHolotable({later:(ms,fn)=>{timers.set(fn,ms);return()=>{timers.delete(fn);};},transport:async(method,p)=>{
  if(method==="live.status")statuses.push(p);
  if(method==="world.content.demand"){demands.push(p);if(!p.wanted)throw Error("Dropped final release");}
  const result=method==="runs.list"?[{dir:"r",session:"test",run:1}]:method==="session.open"?session:method==="layers.watch"?{watch:"synthetic"}:{};
  return {ok:true,status:200,data:{ok:true,result}};
 }},ctl.signal);
 const settle=()=>new Promise(r=>setTimeout(r,0)),poll=async()=>{
  const status=[...timers].filter(([,ms])=>ms===5000);expect(status).toHaveLength(1);timers.delete(status[0][0]);status[0][0]();await settle();
 };
 try{
  service.shown();await settle();await service.dispatch({kind:"holo.open",dir:"r"});expect(statuses.at(-1)).toEqual({});
  await service.dispatch({kind:"holo.layer",id:"pois",on:true});service.context(a.signal).want([0,0,0]);service.context(b.signal).want([1000,0,0]);await settle();
  const consumer=demands[0].consumer;await poll();expect(statuses.at(-1)).toEqual({contentConsumer:consumer});
  a.abort();await poll();expect(statuses.at(-1)).toEqual({contentConsumer:consumer});
  b.abort();await settle();expect(demands.at(-1)?.wanted).toBe(false);await poll();expect(statuses.at(-1)).toEqual({});
  service.context(c.signal).want([0,0,0]);await poll();expect(statuses.at(-1)).toEqual({contentConsumer:consumer});
  await service.dispatch({kind:"holo.layer",id:"pois",on:false});await poll();expect(statuses.at(-1)).toEqual({});
  expect([...timers.values()].every(ms=>[250,1000,5000].includes(ms))).toBe(true);
  service.withdraw();expect([...timers.values()].filter(ms=>ms===5000)).toEqual([]);
 }finally{a.abort();b.abort();c.abort();ctl.abort();}expect(timers.size).toBe(0);
});


test("short or coded phases use a count and raw Technical names; words retain their wording",()=>{
 const make=(names:string[])=>({...content,communities:[{...content.communities[0],entries:[{name:"resident",phases:names.map(name=>({name,spots:["s1"]}))}]}]});
 const coded=baseCard(make(["A","B"]),"base:communities:c")!;
 expect(coded.when).toBe("2 time phases");expect(coded.technical).toContainEqual(["Time phases","A, B"]);
 expect(baseCard(make(["AB_01"]),"base:communities:c")?.when).toBe("1 time phase");
 expect(baseCard(make(["Morning","late evening"]),"base:communities:c")?.when).toBe("Morning, late evening");
 expect(baseCard(content,"base:spots:s2")?.summary).toBe("No activity recorded");
 const one={...content,spots:[content.spots[0]],communities:content.communities};
 expect(baseLayerItems(one,on).find(i=>i.base==="communities")?.label).toBe("Community · 1 spot");
});

test("affiliation labels match cards, drawing and explicit selection; unknown stays Community",()=>{
 const c={...content.communities[0],affiliation:{record:"10",title:"NCPD"}},named={...content,communities:[c]};
 expect(baseCard(named,"base:communities:c")?.title).toBe("NCPD · 3 spots");
 expect(baseLayerItems(named,on).find(i=>i.base==="communities")?.label).toBe("NCPD · 3 spots");
 expect(baseItem(named,"base:communities:c")?.label).toBe("NCPD · 3 spots");
 expect(baseCard(content,"base:communities:c")?.title).toBe("Community");
});

test("No Affiliation displays as Unaffiliated on cards and map labels while Technical keeps the raw text",()=>{
 const affiliation={record:"10",recordName:"Factions.Unit",title:"No Affiliation"};
 const named={...content,communities:[{...content.communities[0],affiliation}]};
 const card=baseCard(named,"base:communities:c")!;
 expect(card.title).toBe("Unaffiliated · 3 spots");
 expect(baseLayerItems(named,on).find(i=>i.base==="communities")?.label).toBe("Unaffiliated · 3 spots");
 expect(baseItem(named,"base:communities:c")?.label).toBe("Unaffiliated · 3 spots");
 expect(card.technical).toContainEqual(["Affiliation names","No Affiliation"]);
 expect(affiliation.title).toBe("No Affiliation");
});
