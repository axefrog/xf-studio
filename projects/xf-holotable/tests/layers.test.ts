import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync, truncateSync } from "node:fs";
import { join, resolve } from "node:path";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir.ts";
import { KINDS, evaluateLayers, validateManifest, validateRecord, whatsHere, NO_WALL_CLOCK, recordingTime, type LayerManifest, type LayerItem, type LayerData } from "../src/layers.ts";
import { createLayerSpool, withinItemBudget } from "../src/layer-spool.ts";
import { standaloneSession } from "../src/layer-timelines.ts";
import { validateFiles } from "../src/layer-validation.ts";
import { createService } from "../src/service.ts";
import { emptySolids } from "../src/solid-source.ts";
import { FakeBridge, settle } from "./live-fake.ts";
import { writeFixture } from "./fixture.ts";
import { readRun, ingest } from "../src/recording.ts";
import type { Session, WorldPack } from "../src/model.ts";

const manifest = (extra: Partial<LayerManifest> = {}): LayerManifest => ({ schema:"xfh/layer-1", producer:"test",layer:"diagnostics",title:"Diagnostics",content:"full",clock:"recording",kinds:[...KINDS],...extra });
const item = (extra: Partial<LayerItem> = {}): LayerItem => ({id:"one",kind:"point",anchor:{at:[0,0,10]},cite:"agent:test:one",...extra});
const data = (records: LayerData["records"], m = manifest()): LayerData => ({manifest:m,records,refused:0,reason:""});
const session = (): Session => ({meta:{schema:"xfh/session-1",session:"abc123",run:1,worldGeneration:1,pluginVersion:"",start:1000,end:1010,from:1000,to:1010,channels:[],complete:true,dropped:0,missedDeadlines:0,largestGapS:0,coverage:"test",problems:[]},v:[],camera:[],gaps:[],events:[]});
const zone = {zone:{poly:[[0,0],[20,0],[20,20],[0,20]] as [number,number][],zlo:0,zhi:20}};

describe("shared layer validation",()=>{
 test("every kind, anchor and clock is accepted by the same validator",()=>{
   const examples: LayerItem[] = [item(),item({kind:"path",anchor:{path:[[0,0,0],[1,1,1]]}}),item({kind:"zone",anchor:zone}),item({kind:"zone",anchor:{box:{min:[0,0,0],max:[1,1,1]}}}),item({kind:"zone",anchor:{sphere:{at:[0,0,0],r:2}}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:1,rows:1}},value:{scalars:[0.5]}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:1,rows:1}},value:{vectors:[[1,2]]}}),item({kind:"influence",value:{to:{entity:"a1"}}}),item({kind:"target",value:{from:{at:[1,1,1]}}}),item({kind:"label",cite:undefined}),item({kind:"actor",anchor:zone,value:{name:"Synthetic",role:"fixer",facets:{doing:"waiting"}}}),item({kind:"relation",anchor:{item:"one"},value:{to:{item:"other/two"},type:"knows",strength:0.5,mutual:true}})];
   expect(validateRecord(item({facets:{saying:"x".repeat(500)}}),manifest())).toBeNull();
   expect(validateRecord(item({facets:{saying:"x".repeat(501)}}),manifest())).toBeString();
   for(const e of examples) expect(validateRecord(e,manifest())).toBeNull();
   for(const kind of ["point","target","label","influence","actor","zone"] as const) expect(validateRecord(item({kind,anchor:{region:"district"},value:kind==="actor"?{name:"A"}:kind==="influence"?{to:{region:"other"}}:undefined}),manifest())).toBeNull();
   for(const clock of ["recording","wall","game"] as const) expect(validateManifest(manifest({clock}))).toBeNull();
 });
 test("refuses every malformed manifest field",()=>{
   const cases = [null,[],{},manifest({schema:"bad" as any}),manifest({producer:"Upper"}),manifest({layer:"../escape"}),manifest({title:""}),manifest({description:"x".repeat(2001)}),manifest({content:"bad" as any}),manifest({clock:"bad" as any}),manifest({session:""}),manifest({run:-1}),manifest({kinds:[]}),manifest({kinds:["point","point"]}),manifest({branch:""}),{...manifest(),drawing:"red"},manifest({standalone:{set:"s",from:2,to:1,clock:"recording"}})];
   for(const e of cases) expect(validateManifest(e)).toBeString();
   expect(validateManifest(manifest(),"other/layer")).toContain("does not match");
 });
 test("refuses every malformed item dimension and semantic value",()=>{
   const cases: unknown[] = [null,[],{},item({id:""}),item({id:"a/b"}),item({kind:"unknown" as any}),item({t:"today"}),item({t:2,until:1}),item({anchor:{at:[Infinity,0,0]}}),item({anchor:{path:[[0,0,0],[1,1,1]]}}),item({cite:undefined}),item({cite:"why"}),item({tone:"red" as any}),item({weight:2}),item({label:""}),item({detail:"x".repeat(4001)}),item({facets:{bad:3} as any}),item({value:{name:"A"}}),item({kind:"actor",value:{}}),item({kind:"relation",anchor:{item:"one"},value:{to:{at:[0,0,0]},type:"knows"}}),item({kind:"relation",anchor:{item:"one"},value:{to:{item:"two"},type:"knows",strength:2}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:129,rows:1}},value:{scalars:[]}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:2,rows:1}},value:{vectors:[[1,2]]}}),item({kind:"target",value:{name:"bad"}}),item({kind:"influence",value:{}}),{retract:"one"},{retract:"one",t:"wrong"},{...item(),color:"blue"}];
   for(const e of cases) expect(validateRecord(e,manifest())).toBeString();
 });
});

test("replacement, expiry, retraction and clock binding preserve historical moments",()=>{
 const d=data([item({t:1001}),item({t:1003,until:1005,label:"new"}),{retract:"one",t:1004}]);
 expect(evaluateLayers([d],session(),1000,"full")[0].items).toHaveLength(0);
 expect(evaluateLayers([d],session(),1002,"full")[0].items[0].label).toBeUndefined();
 expect(evaluateLayers([d],session(),1003,"full")[0].items[0].label).toBe("new");
 expect(evaluateLayers([d],session(),1004,"full")[0].items).toHaveLength(0);
 expect(evaluateLayers([data([item()],manifest({session:"another"}))],session(),1004,"full")).toHaveLength(0);
 const wall=data([item({t:"2026-10-27T00:00:02Z"})],manifest({clock:"wall"}));
 expect(evaluateLayers([wall],session(),1004,"full")[0].reason).toBe(NO_WALL_CLOCK);
 const mapped=session();mapped.meta.wallStart="2026-10-27T00:00:00Z";
 expect(evaluateLayers([wall],mapped,1002,"full")[0].items[0].t).toBe(1002);
 const game=data([item({t:10})],manifest({clock:"game"})); expect(evaluateLayers([game],session(),1002,"full")[0].reason).toContain("no game-clock");
});

test("facets, names, details and relation types never leave the structure boundary",()=>{
 const d=data([item({kind:"actor",label:"secret label",detail:"secret detail",facets:{thinking:"secret thought"},value:{name:"secret name",role:"generated fixer",facets:{saying:"secret line"}}}),item({id:"edge",kind:"relation",anchor:{item:"one"},value:{to:{item:"one"},type:"secret tie"}})]);
 const safe=evaluateLayers([d],session(),1000,"structure"); expect(JSON.stringify(safe)).not.toContain("secret"); expect(safe[0].items[0].value?.name).toBe("generated fixer");
 expect(JSON.stringify(evaluateLayers([d],session(),1000,"full"))).toContain("secret thought");
});

test("What's here samples fields, contains zones, sorts paths and points, and respects hidden layers",()=>{
 const d=data([item({id:"near",anchor:{at:[1,1,10]}}),item({id:"far",anchor:{at:[40,0,10]}}),item({id:"zone",kind:"zone",anchor:zone}),item({id:"path",kind:"path",anchor:{path:[[0,0,10],[30,0,10]]}}),item({id:"field",kind:"field",anchor:{grid:{origin:[0,0,10],cell:10,cols:2,rows:1}},value:{scalars:[2,4]}})]);
 const views=evaluateLayers([d],session(),1000,"full"), here=whatsHere(views,[1,1,10]);
 expect(here[0].items.map(e=>e.item.id).sort()).toEqual(["field","near","path","zone"]);
 expect(here[0].items.find(e=>e.item.id==="field")?.sample).toBe(2);
 expect(whatsHere(views,[1,1,10],[views[0].id])).toEqual([]);
});

test("entity samples and regions resolve without inventing positions; relation endpoints include targets and zones",()=>{
 const s=session(); ingest({channel:"actors",source_s:1000,seq:1,data:{actors:[{who:"a1",entity:"entity-1",valid:true,position:[5,6,10]}]}},s,()=>"event:test:1",new Map());
 const world:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"synthetic",source:"test",built:""},areas:[{id:"district",name:"Synthetic district",kind:"district",poly:zone.zone.poly,zlo:0,zhi:20,labelPoint:[8,9,10]}],cells:[]};
 const d=data([item({anchor:{entity:"a1"}}),item({id:"area",kind:"zone",anchor:{region:"district"}}),item({id:"unknown",anchor:{region:"missing"}}),item({id:"edge",kind:"relation",anchor:{item:"one"},value:{to:{item:"area"},type:"knows"}})]);
 const view=evaluateLayers([d],s,1000,"full",[],world)[0]; expect(view.items[0].place).toEqual([5,6,10]);expect(view.items.find(i=>i.id==="edge")?.to).toEqual([8,9,10]);expect(view.notPlaced).toEqual(["unknown"]);
 expect(evaluateLayers([d],s,1001,"full",[],world)[0].notPlaced).toContain("one");
});

test("standalone game sets and branches remain separate, with unbranched context",()=>{
 const m=manifest({clock:"game",standalone:{set:"week",title:"Synthetic week",from:0,to:604800,clock:"game"}});
 const d=data([item({t:0}),item({id:"a",t:0,branch:"save-a"}),item({id:"b",t:0,branch:"save-b"})],m),s=standaloneSession([d],"layers:test/week");
 expect(s.meta.standalone?.branches).toEqual(["save-a","save-b"]);
 expect(evaluateLayers([d],s,1,"full",[],undefined,"save-a")[0].items.map(i=>i.id)).toEqual(["one","a"]);
});

test("standalone framing bounds include both branches, area height, field size and influence ends",()=>{
 const m=manifest({clock:"game",standalone:{set:"extent",from:0,to:100,clock:"game"}});
 const d=data([item({branch:"a",anchor:{at:[-100,0,0]}}),item({branch:"b",id:"sphere",kind:"actor",anchor:{sphere:{at:[200,100,50],r:20}},value:{name:"Synthetic group"}}),item({id:"field",kind:"field",anchor:{grid:{origin:[0,0,0],cell:10,cols:2,rows:3}},value:{scalars:[0,0,0,0,0,0]}}),item({id:"edge",kind:"influence",value:{to:{at:[500,400,200]}}})],m);
 expect(standaloneSession([d],"layers:test/extent").meta.standalone?.extent).toEqual({min:[-100,0,0],max:[500,400,200]});
 expect(standaloneSession([data([d.records[1]],m)],"layers:test/extent").meta.standalone?.extent).toEqual({min:[180,80,30],max:[220,120,70]});
 expect(standaloneSession([data([d.records[2]],m)],"layers:test/extent").meta.standalone?.extent).toEqual({min:[0,0,0],max:[20,30,0]});
 expect(standaloneSession([data([item({kind:"zone",anchor:zone})],m)],"layers:test/extent").meta.standalone?.extent).toEqual({min:[0,0,0],max:[20,20,20]});
});

test("game-clock mappings interpolate and bound extrapolation without inventing a rate",()=>{
 const s=session(),m=manifest({clock:"game"});s.meta.gameTimeSamples=[{source:1000,game:3600},{source:1010,game:3620}];
 expect(recordingTime(3610,m,s)).toBe(1005);
 expect(recordingTime(3660,m,s)).toBe(1030);
 expect(()=>recordingTime(3700,m,s)).toThrow("outside");
});

test("a branched retraction removes only that branch; an unbranched retraction applies to every branch",()=>{
 const m=manifest({clock:"game",standalone:{set:"branches",from:0,to:100,clock:"game"}});
 const d=data([item({t:0}),{retract:"one",t:10,branch:"save-a"},item({id:"branch-marker",t:0,branch:"save-b"})],m),s=standaloneSession([d],"layers:test/branches");
 expect(evaluateLayers([d],s,20,"full",[],undefined,"save-a")[0].items.some(i=>i.id==="one")).toBe(false);
 expect(evaluateLayers([d],s,20,"full",[],undefined,"save-b")[0].items.some(i=>i.id==="one")).toBe(true);
 d.records.push({retract:"one",t:30});
 expect(evaluateLayers([d],s,40,"full",[],undefined,"save-b")[0].items.some(i=>i.id==="one")).toBe(false);
 const inherited=data([item({t:0,branch:"save-b"}),{retract:"one",t:10}],{...m,branch:"save-a"});
 expect(evaluateLayers([inherited],s,20,"full",[],undefined,"save-b")[0].items.some(i=>i.id==="one")).toBe(true);
});

test("spool appends incrementally, preserves partial UTF8 lines and survives truncation and rotation",()=>{
 const root=tempDir("holo-layers-"),spool=createLayerSpool(root);mkdirSync(join(root,"test"));const path=join(root,"test/diagnostics.jsonl");
 writeFileSync(path,JSON.stringify(manifest())+"\n");spool.scan();appendFileSync(path,JSON.stringify(item()).slice(0,20));spool.scan();expect(spool.snapshot()[0].records).toHaveLength(0);
 appendFileSync(path,JSON.stringify(item()).slice(20)+"\n{bad}\n");spool.scan();expect(spool.snapshot()[0].records).toHaveLength(1);expect(spool.snapshot()[0].refused).toBe(1);spool.scan();expect(spool.snapshot()[0].refused).toBe(1);
 writeFileSync(path,JSON.stringify(manifest())+"\n");spool.scan();expect(spool.snapshot()[0].records).toHaveLength(0);
 renameSync(path,path+".old");writeFileSync(path,[manifest(),item({id:"new"})].map(x=>JSON.stringify(x)).join("\n")+"\n");spool.scan();expect((spool.snapshot()[0].records[0] as LayerItem).id).toBe("new");spool.close();
});

test("watch leases stop polling and publish enforces rate, set consistency and spool size",()=>{
 const root=tempDir("holo-publish-"),jobs=new Set<()=>void>();let now=0;
 const spool=createLayerSpool(root,{now:()=>now,interval:fn=>{jobs.add(fn);return()=>jobs.delete(fn);}});
 const watch=spool.watch();expect(jobs.size).toBe(1);spool.stop(watch.watch);expect(jobs.size).toBe(0);
 expect(spool.publish("test/diagnostics",[manifest(),item()]).refused).toBe(0);
 expect(spool.publish("test/diagnostics",[item({id:"two"})]).accepted).toBe(1);
 expect(spool.publish("test/diagnostics",[item({id:"three"})]).reasons[0]).toContain("2 batches");now=1001;
 const m=manifest({layer:"other",standalone:{set:"set",from:0,to:2,clock:"recording"}});spool.publish("test/other",[m]);
 expect(spool.publish("test/another",[{...m,layer:"another",standalone:{...m.standalone,to:3}}]).reasons[0]).toContain("must agree");
 expect(spool.publish("test/bad",[{}]).refused).toBe(1);expect(spool.snapshot().find(d=>d.manifest.layer==="bad")?.refused).toBe(1);
 spool.watch(); now+=15001;for(const job of jobs)job();expect(jobs.size).toBe(0);spool.close();
});

test("5,000 live items is a temporal budget; replacement and retraction free capacity",()=>{
 const records=Array.from({length:5000},(_,i)=>item({id:String(i),t:1}));expect(withinItemBudget(records,manifest())).toBe(true);
 expect(withinItemBudget([...records,item({id:"overflow",t:2})],manifest())).toBe(false);
 expect(withinItemBudget([...records,{retract:"0",t:2},item({id:"replacement",t:3})],manifest())).toBe(true);
});

test("validate reports line numbers, exits nonzero and writes nothing",async()=>{
 const root=tempDir("holo-validate-"),path=join(root,"input.jsonl");writeFileSync(path,[manifest(),item(),"broken"].map(x=>typeof x==="string"?x:JSON.stringify(x)).join("\n")+"\n");const before=statSync(path).mtimeMs;
 expect(validateFiles(path).map(e=>e.line)).toEqual([3]);expect(statSync(path).mtimeMs).toBe(before);
 const proc=Bun.spawn([process.execPath,resolve(import.meta.dir,"../tools/holo.ts"),"validate",root],{stdout:"pipe",stderr:"pipe"});
 expect(await proc.exited).toBe(1);expect(await new Response(proc.stderr).text()).toContain(":3: Line is not valid JSON.");expect(statSync(path).mtimeMs).toBe(before);
});

test("an oversized spool is refused once, and one publisher's rate persists for another",()=>{
 const root=tempDir("holo-byte-budget-"),spool=createLayerSpool(root,{now:()=>100});
 expect(spool.publish("test/diagnostics",[manifest(),item()]).refused).toBe(0);
 const other=createLayerSpool(root,{now:()=>100});expect(other.publish("test/diagnostics",[item({id:"second"})]).refused).toBe(0);
 expect(spool.publish("test/diagnostics",[item({id:"third"})]).reasons[0]).toContain("2 batches");
 truncateSync(join(root,"test/diagnostics.jsonl"),16*1024*1024+1);spool.scan();
 expect(spool.snapshot()[0].reason).toContain("16 MB");const refused=spool.snapshot()[0].refused;spool.scan();expect(spool.snapshot()[0].refused).toBe(refused);spool.close();other.close();
});

test("CLI publication reaches replay and live fake clients, including reports",async()=>{
 const root=tempDir("holo-service-"),fixture=writeFixture(),bridge=new FakeBridge(),signal=new AbortController().signal;
 const service=createService({recordingsRoot:fixture.root,worldPackPath:"",layersRoot:root,liveBridge:bridge,liveClock:bridge.clock,solidSource:{around:async()=>emptySolids()}});
 try {
   const file=join(root,"batch.jsonl");writeFileSync(file,[manifest(),item({label:"CLI mark"})].map(x=>JSON.stringify(x)).join("\n")+"\n");
   const proc=Bun.spawn([process.execPath,resolve(import.meta.dir,"../tools/holo.ts"),"publish","test/diagnostics",file],{env:{...process.env,HOLOTABLE_LAYERS:root},stdout:"pipe",stderr:"pipe"});
   expect(await proc.exited).toBe(0);
   const watch=await service.handlers["layers.watch"]({},signal) as any;
   const result=await service.handlers["layers.poll"]({...watch,dir:fixture.dir,t:1000,level:"full",position:[0,0,10]},signal) as any;expect(result.layers[0].items[0].label).toBe("CLI mark");expect(result.here).toHaveLength(1);
   expect(await service.handlers["session.report"]({dir:fixture.dir,t:1000,level:"full",position:[0,0,10]},signal)).toContain("CLI mark");
   bridge.pages.push(bridge.page([{schema:"xfb/source-record-1",session:"abc123",run:1,world_generation:1,seq:1,source_s:1000,channel:"v",valid:true,data:{position:[0,0,10],yaw:0}}]));
   const live=await service.handlers["live.watch"]({},signal) as any;await settle();
   const liveResult=await service.handlers["layers.poll"]({...watch,liveWatch:live.watch,t:1000,level:"full"},signal) as any;expect(liveResult.layers[0].items[0].label).toBe("CLI mark");
 } finally {service.close();fixture.dispose();}
});
