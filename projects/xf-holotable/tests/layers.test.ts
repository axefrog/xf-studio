import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync, truncateSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir.ts";
import { KINDS, layerChanges, evaluateLayers, validateManifest, validateRecord, whatsHere, NO_WALL_CLOCK, recordingTime, type LayerManifest, type LayerItem, type LayerData } from "../src/layers.ts";
import { createLayerSpool } from "../src/layer-spool.ts";
import { admitId, ITEM_LIMIT_REASON } from "../src/layer-line.ts";
import { readBatch } from "../src/bounded-input.ts";
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
 test("every kind, anchor and clock is accepted by the same validator",async()=>{
   const examples: LayerItem[] = [item(),item({kind:"path",anchor:{path:[[0,0,0],[1,1,1]]}}),item({kind:"zone",anchor:zone}),item({kind:"zone",anchor:{box:{min:[0,0,0],max:[1,1,1]}}}),item({kind:"zone",anchor:{sphere:{at:[0,0,0],r:2}}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:1,rows:1}},value:{scalars:[0.5]}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:1,rows:1}},value:{vectors:[[1,2]]}}),item({kind:"influence",value:{to:{entity:"a1"}}}),item({kind:"target",value:{from:{at:[1,1,1]}}}),item({kind:"label",cite:undefined}),item({kind:"actor",anchor:zone,value:{name:"Synthetic",role:"fixer",facets:{doing:"waiting"}}}),item({kind:"relation",anchor:{item:"one"},value:{to:{item:"other/two"},type:"knows",strength:0.5,mutual:true}})];
   expect(validateRecord(item({facets:{saying:"x".repeat(500)}}),manifest())).toBeNull();
   expect(validateRecord(item({facets:{saying:"x".repeat(501)}}),manifest())).toBeString();
   for(const e of examples) { expect(validateRecord(e,manifest())).toBeNull(); expect(validateRecord({...e,glyph:"future-glyph",badge:"pending"},manifest())).toBeNull(); }
   for(const kind of ["point","target","label","influence","actor","zone"] as const) expect(validateRecord(item({kind,anchor:{region:"district"},value:kind==="actor"?{name:"A"}:kind==="influence"?{to:{region:"other"}}:undefined}),manifest())).toBeNull();
   for(const clock of ["recording","wall","game"] as const) expect(validateManifest(manifest({clock}))).toBeNull();
 });
 test("refuses every malformed manifest field",async()=>{
   const cases = [null,[],{},manifest({schema:"bad" as any}),manifest({producer:"Upper"}),manifest({layer:"../escape"}),manifest({title:""}),manifest({description:"x".repeat(2001)}),manifest({content:"bad" as any}),manifest({clock:"bad" as any}),manifest({session:""}),manifest({run:-1}),manifest({kinds:[]}),manifest({kinds:["point","point"]}),manifest({branch:""}),{...manifest(),drawing:"red"},manifest({standalone:{set:"s",from:2,to:1,clock:"recording"}})];
   for(const e of cases) expect(validateManifest(e)).toBeString();
   expect(validateManifest(manifest(),"other/layer")).toContain("does not match");
 });
 test("refuses every malformed item dimension and semantic value",async()=>{
   const cases: unknown[] = [null,[],{},item({id:""}),item({id:"a/b"}),item({kind:"unknown" as any}),item({t:"today"}),item({t:2,until:1}),item({anchor:{at:[Infinity,0,0]}}),item({anchor:{path:[[0,0,0],[1,1,1]]}}),item({cite:undefined}),item({cite:"why"}),item({tone:"red" as any}),item({weight:2}),item({label:""}),item({detail:"x".repeat(4001)}),item({facets:{bad:3} as any}),item({value:{name:"A"}}),item({kind:"actor",value:{}}),item({kind:"relation",anchor:{item:"one"},value:{to:{at:[0,0,0]},type:"knows"}}),item({kind:"relation",anchor:{item:"one"},value:{to:{item:"two"},type:"knows",strength:2}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:129,rows:1}},value:{scalars:[]}}),item({kind:"field",anchor:{grid:{origin:[0,0,0],cell:1,cols:2,rows:1}},value:{vectors:[[1,2]]}}),item({kind:"target",value:{name:"bad"}}),item({kind:"influence",value:{}}),{retract:"one"},{retract:"one",t:"wrong"},{...item(),color:"blue"}];
   for(const e of cases) expect(validateRecord(e,manifest())).toBeString();
 });
});

test("replacement, expiry, retraction and clock binding preserve historical moments",async()=>{
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

test("item anchors validate on markers and influence ends, and resolve current places across layers",()=>{
 const markers = ["point","target","label","actor","influence"] as const;
 for (const kind of markers) expect(validateRecord(item({kind,anchor:{item:"places/cell"},value:kind==="actor"?{name:"A"}:kind==="influence"?{to:{item:"places/cell"}}:kind==="target"?{from:{item:"places/cell"}}:undefined}),manifest())).toBeNull();
 const marks=data([
   item({id:"event",anchor:{item:"places/cell"}}),
   item({id:"follow",kind:"actor",anchor:{item:"places/moving"},value:{name:"Follower"}}),
   item({id:"chain",anchor:{item:"event"}}),
   item({id:"edge",kind:"influence",anchor:{item:"places/cell"},value:{to:{item:"other/places/foreign"}}}),
   item({id:"target",kind:"target",anchor:{item:"places/moving"},value:{from:{item:"places/cell"}}}),
   item({id:"missing",anchor:{item:"places/absent"}}),
   item({id:"cycle-a",anchor:{item:"cycle-b"}}),item({id:"cycle-b",anchor:{item:"cycle-a"}}),
   item({id:"relation",kind:"relation",anchor:{item:"chain"},value:{to:{item:"places/moving"},type:"near"}}),
 ]);
 const places=data([item({id:"cell",kind:"zone",anchor:zone}),item({id:"moving",kind:"actor",anchor:{at:[1,2,3]},value:{name:"Mover"}}),item({id:"moving",kind:"actor",t:1005,anchor:{at:[4,5,6]},value:{name:"Mover"}})],manifest({layer:"places"}));
 const foreign=data([item({id:"foreign",anchor:{at:[20,30,40]}})],manifest({producer:"other",layer:"places"}));
 for(const level of ["full","structure"] as const){
   const views=evaluateLayers([marks,places,foreign],session(),1006,level), byId=new Map(views[0].items.map(i=>[i.id,i]));
   expect(byId.get("event")?.place).toEqual([10,10,10]);expect(byId.get("event")?.resolvedAnchor).toEqual({at:[10,10,10]});
   expect(byId.get("chain")?.place).toEqual([10,10,10]);expect(byId.get("follow")?.place).toEqual([4,5,6]);
   expect(byId.get("edge")?.to).toEqual([20,30,40]);expect(byId.get("target")?.to).toEqual([10,10,10]);
   expect(byId.get("relation")?.place).toEqual([10,10,10]);expect(byId.get("relation")?.to).toEqual([4,5,6]);
   expect(views[0].notPlaced).toEqual(["missing","cycle-a","cycle-b"]);
 }
 expect(evaluateLayers([marks,places,foreign],session(),1004,"full")[0].items.find(i=>i.id==="follow")?.place).toEqual([1,2,3]);
 expect(evaluateLayers([marks,places,foreign],session(),1006,"full",["test/places"])[0].notPlaced).toContain("event");
 expect(evaluateLayers([marks,places,places,foreign],session(),1006,"full")[0].notPlaced).toContain("event");
});

test("facets, names, details and relation types never leave the structure boundary",async()=>{
 const d=data([item({kind:"actor",label:"secret label",detail:"secret detail",facets:{thinking:"secret thought"},value:{name:"secret name",role:"generated fixer",facets:{saying:"secret line"}}}),item({id:"edge",kind:"relation",anchor:{item:"one"},value:{to:{item:"one"},type:"secret tie"}})]);
 const safe=evaluateLayers([d],session(),1000,"structure"); expect(JSON.stringify(safe)).not.toContain("secret"); expect(safe[0].items[0].value?.name).toBe("generated fixer");
 expect(JSON.stringify(evaluateLayers([d],session(),1000,"full"))).toContain("secret thought");
});

test("What's here samples fields, contains zones, sorts paths and points, and respects hidden layers",async()=>{
 const d=data([item({id:"near",anchor:{at:[1,1,10]}}),item({id:"far",anchor:{at:[40,0,10]}}),item({id:"zone",kind:"zone",anchor:zone}),item({id:"path",kind:"path",anchor:{path:[[0,0,10],[30,0,10]]}}),item({id:"field",kind:"field",anchor:{grid:{origin:[0,0,10],cell:10,cols:2,rows:1}},value:{scalars:[2,4]}})]);
 const views=evaluateLayers([d],session(),1000,"full"), here=whatsHere(views,[1,1,10]);
 expect(here[0].items.map(e=>e.item.id).sort()).toEqual(["field","near","path","zone"]);
 expect(here[0].items.find(e=>e.item.id==="field")?.sample).toBe(2);
 expect(whatsHere(views,[1,1,10],[views[0].id])).toEqual([]);
});

test("entity samples and regions resolve without inventing positions; relation endpoints include targets and zones",async()=>{
 const s=session(); ingest({channel:"actors",source_s:1000,seq:1,data:{actors:[{who:"a1",entity:"entity-1",valid:true,position:[5,6,10]}]}},s,()=>"event:test:1",new Map());
 const world:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"synthetic",source:"test",built:""},areas:[{id:"district",name:"Synthetic district",kind:"district",poly:zone.zone.poly,zlo:0,zhi:20,labelPoint:[8,9,10]}],cells:[]};
 const d=data([item({anchor:{entity:"a1"}}),item({id:"area",kind:"zone",anchor:{region:"district"}}),item({id:"unknown",anchor:{region:"missing"}}),item({id:"edge",kind:"relation",anchor:{item:"one"},value:{to:{item:"area"},type:"knows"}})]);
 const view=evaluateLayers([d],s,1000,"full",[],world)[0]; expect(view.items[0].place).toEqual([5,6,10]);expect(view.items.find(i=>i.id==="edge")?.to).toEqual([8,9,10]);expect(view.notPlaced).toEqual(["unknown"]);
 expect(evaluateLayers([d],s,1001,"full",[],world)[0].notPlaced).toContain("one");
});

test("standalone game sets and branches remain separate, with unbranched context",async()=>{
 const m=manifest({clock:"game",standalone:{set:"week",title:"Synthetic week",from:0,to:604800,clock:"game"}});
 const d=data([item({t:0}),item({id:"a",t:0,branch:"save-a"}),item({id:"b",t:0,branch:"save-b"})],m),s=standaloneSession([d],"layers:test/week");
 expect(s.meta.standalone?.branches).toEqual(["save-a","save-b"]);
 expect(evaluateLayers([d],s,1,"full",[],undefined,"save-a")[0].items.map(i=>i.id)).toEqual(["one","a"]);
});

test("standalone framing bounds include both branches, area height, field size and influence ends",async()=>{
 const m=manifest({clock:"game",standalone:{set:"extent",from:0,to:100,clock:"game"}});
 const d=data([item({branch:"a",anchor:{at:[-100,0,0]}}),item({branch:"b",id:"sphere",kind:"actor",anchor:{sphere:{at:[200,100,50],r:20}},value:{name:"Synthetic group"}}),item({id:"field",kind:"field",anchor:{grid:{origin:[0,0,0],cell:10,cols:2,rows:3}},value:{scalars:[0,0,0,0,0,0]}}),item({id:"edge",kind:"influence",value:{to:{at:[500,400,200]}}})],m);
 expect(standaloneSession([d],"layers:test/extent").meta.standalone?.extent).toEqual({min:[-100,0,0],max:[500,400,200]});
 expect(standaloneSession([data([d.records[1]],m)],"layers:test/extent").meta.standalone?.extent).toEqual({min:[180,80,30],max:[220,120,70]});
 expect(standaloneSession([data([d.records[2]],m)],"layers:test/extent").meta.standalone?.extent).toEqual({min:[0,0,0],max:[20,30,0]});
 expect(standaloneSession([data([item({kind:"zone",anchor:zone})],m)],"layers:test/extent").meta.standalone?.extent).toEqual({min:[0,0,0],max:[20,20,20]});
});

test("game-clock mappings interpolate and bound extrapolation without inventing a rate",async()=>{
 const s=session(),m=manifest({clock:"game"});s.meta.gameTimeSamples=[{source:1000,game:3600},{source:1010,game:3620}];
 expect(recordingTime(3610,m,s)).toBe(1005);
 expect(recordingTime(3660,m,s)).toBe(1030);
 expect(()=>recordingTime(3700,m,s)).toThrow("outside");
});

test("a branched retraction removes only that branch; an unbranched retraction applies to every branch",async()=>{
 const m=manifest({clock:"game",standalone:{set:"branches",from:0,to:100,clock:"game"}});
 const d=data([item({t:0}),{retract:"one",t:10,branch:"save-a"},item({id:"branch-marker",t:0,branch:"save-b"})],m),s=standaloneSession([d],"layers:test/branches");
 expect(evaluateLayers([d],s,20,"full",[],undefined,"save-a")[0].items.some(i=>i.id==="one")).toBe(false);
 expect(evaluateLayers([d],s,20,"full",[],undefined,"save-b")[0].items.some(i=>i.id==="one")).toBe(true);
 d.records.push({retract:"one",t:30});
 expect(evaluateLayers([d],s,40,"full",[],undefined,"save-b")[0].items.some(i=>i.id==="one")).toBe(false);
 const inherited=data([item({t:0,branch:"save-b"}),{retract:"one",t:10}],{...m,branch:"save-a"});
 expect(evaluateLayers([inherited],s,20,"full",[],undefined,"save-b")[0].items.some(i=>i.id==="one")).toBe(true);
});

test("spool appends incrementally, preserves partial UTF8 lines and survives truncation and rotation",async()=>{
 const root=tempDir("holo-layers-"),spool=createLayerSpool(root);mkdirSync(join(root,"test"));const path=join(root,"test/diagnostics.jsonl");
 writeFileSync(path,JSON.stringify(manifest())+"\n");(await spool.scan());appendFileSync(path,JSON.stringify(item()).slice(0,20));(await spool.scan());expect(spool.snapshot()[0].records).toHaveLength(0);
 appendFileSync(path,JSON.stringify(item()).slice(20)+"\n{bad}\n");(await spool.scan());expect(spool.snapshot()[0].records).toHaveLength(1);expect(spool.snapshot()[0].refused).toBe(1);(await spool.scan());expect(spool.snapshot()[0].refused).toBe(1);
 writeFileSync(path,JSON.stringify(manifest())+"\n");(await spool.scan());expect(spool.snapshot()[0].records).toHaveLength(0);
 renameSync(path,path+".old");writeFileSync(path,[manifest(),item({id:"new"})].map(x=>JSON.stringify(x)).join("\n")+"\n");(await spool.scan());expect((spool.snapshot()[0].records[0] as LayerItem).id).toBe("new");spool.close();
});

test("watch leases stop polling and publish enforces rate, set consistency and spool size",async()=>{
 const root=tempDir("holo-publish-"),jobs=new Set<()=>void>();let now=0;
 const spool=createLayerSpool(root,{now:()=>now,interval:fn=>{jobs.add(fn);return()=>jobs.delete(fn);}});
 const watch=(await spool.watch());expect(jobs.size).toBe(1);spool.stop(watch.watch);expect(jobs.size).toBe(0);
 expect((await spool.publish("test/diagnostics",[manifest(),item()])).refused).toBe(0);
 expect((await spool.publish("test/diagnostics",[item({id:"two"})])).accepted).toBe(1);
 expect((await spool.publish("test/diagnostics",[item({id:"three"})])).reasons[0]).toContain("2 batches");now=1001;
 const m=manifest({layer:"other",standalone:{set:"set",from:0,to:2,clock:"recording"}});(await spool.publish("test/other",[m]));
 expect((await spool.publish("test/another",[{...m,layer:"another",standalone:{...m.standalone,to:3}}])).reasons[0]).toContain("must agree");
 expect((await spool.publish("test/bad",[{}])).refused).toBe(1);expect(spool.snapshot().find(d=>d.manifest.layer==="bad")?.refused).toBe(1);
 (await spool.watch()); now+=15001;for(const job of jobs)job();expect(jobs.size).toBe(0);spool.close();
});

test("concurrent layers cannot admit conflicting spans into one standalone set",async()=>{
 const root=tempDir("holo-set-admission-"),spool=createLayerSpool(root);
 try {
  const results=await Promise.all(["a","b"].map((layer,i)=>spool.publish(`test/${layer}`,[manifest({layer,standalone:{set:"week",from:0,to:10+i,clock:"recording"}}),item()])));
  expect(results.map(r=>r.accepted).sort()).toEqual([0,2]);expect(results.find(r=>r.refused)?.reasons[0]).toContain("must agree");
  expect((await spool.read()).filter(d=>d.manifest.standalone).length).toBe(1);
 }finally{spool.close();}
});

test("separate processes serialize conflicting standalone-set admission",async()=>{
 const root=tempDir("holo-set-processes-"),source=pathToFileURL(resolve(import.meta.dir,"../src/layer-spool.ts")).href;
 const children=["a","b"].map((layer,i)=>{
   const m=manifest({layer,standalone:{set:"week",from:0,to:10+i,clock:"recording"}});
   const code=`import {createLayerSpool} from ${JSON.stringify(source)};import {existsSync,writeFileSync} from 'node:fs';
     const spool=createLayerSpool(${JSON.stringify(root)});writeFileSync(${JSON.stringify(join(root,layer+".ready"))},'');
     try{const deadline=Date.now()+5000;while(!existsSync(${JSON.stringify(join(root,"go"))})){if(Date.now()>deadline)throw Error('Start barrier timed out');await Bun.sleep(2);}
     const result=await spool.publish(${JSON.stringify("test/"+layer)},[${JSON.stringify(m)},...Array.from({length:8000},()=>(${JSON.stringify(item())}))]);console.log(JSON.stringify({accepted:result.accepted,refused:result.refused,reason:result.reasons[0]}));}finally{spool.close();}`;
   return Bun.spawn([process.execPath,"-e",code],{stdout:"pipe",stderr:"pipe"});
 });
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
   const deadline=performance.now()+5000;
   while(!["a","b"].every(layer=>existsSync(join(root,layer+".ready")))){if(performance.now()>deadline)throw Error("Publishers did not reach the start barrier.");await Bun.sleep(2);}
   writeFileSync(join(root,"go"),"");
   const completed=Promise.all(children.map(async child=>({code:await child.exited,out:JSON.parse(await new Response(child.stdout).text()),err:await new Response(child.stderr).text()})));
   const results=await Promise.race([completed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Set publishers timed out.")),5000);})]);
   for(const result of results){expect(result.err).toBe("");expect(result.code).toBe(0);}
   expect(results.map(r=>r.out.accepted).sort((a,b)=>a-b)).toEqual([0,8001]);expect(results.find(r=>r.out.refused)?.out.reason).toContain("must agree");
   expect(existsSync(join(root,"test/.set-week.publish.lock"))).toBe(false);
 }finally{if(timer)clearTimeout(timer);for(const child of children)if(child.exitCode===null)child.kill();await Promise.all(children.map(child=>child.exited));}
});

test("5,000 distinct ids bounds history even after retraction; replacements retain their id",async()=>{
 const ids=new Set<string>();for(let i=0;i<5000;i++)expect(admitId(item({id:String(i)}),ids)).toBe(true);
 expect(admitId(item({id:"overflow"}),ids)).toBe(false);
 expect(admitId({retract:"0",t:2},ids)).toBe(true);
 expect(admitId(item({id:"0",t:3}),ids)).toBe(true);
 expect(admitId(item({id:"new-after-retract",t:4}),ids)).toBe(false);
});

test("validate reports line numbers, exits nonzero and writes nothing",async()=>{
 const root=tempDir("holo-validate-"),path=join(root,"input.jsonl");writeFileSync(path,[manifest(),item(),"broken"].map(x=>typeof x==="string"?x:JSON.stringify(x)).join("\n")+"\n");const before=statSync(path).mtimeMs;
 expect(validateFiles(path).map(e=>e.line)).toEqual([3]);expect(statSync(path).mtimeMs).toBe(before);
 const proc=Bun.spawn([process.execPath,resolve(import.meta.dir,"../tools/holo.ts"),"validate",root],{stdout:"pipe",stderr:"pipe"});
 expect(await proc.exited).toBe(1);expect(await new Response(proc.stderr).text()).toContain(":3: Line is not valid JSON.");expect(statSync(path).mtimeMs).toBe(before);
});

test("an oversized spool is refused once, and one publisher's rate persists for another",async()=>{
 const root=tempDir("holo-byte-budget-"),spool=createLayerSpool(root,{now:()=>100});
 expect((await spool.publish("test/diagnostics",[manifest(),item()])).refused).toBe(0);
 const other=createLayerSpool(root,{now:()=>100});expect((await other.publish("test/diagnostics",[item({id:"second"})])).refused).toBe(0);
 expect((await spool.publish("test/diagnostics",[item({id:"third"})])).reasons[0]).toContain("2 batches");
 truncateSync(join(root,"test/diagnostics.jsonl"),16*1024*1024+1);(await spool.scan());
 expect(spool.snapshot()[0].reason).toContain("16 MB");const refused=spool.snapshot()[0].refused;(await spool.scan());expect(spool.snapshot()[0].refused).toBe(refused);spool.close();other.close();
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


test("8,000 replacements ingest in under 200 ms and yield to a timer",async()=>{
 const root=tempDir("holo-sliced-"),spool=createLayerSpool(root);mkdirSync(join(root,"test"));
 writeFileSync(join(root,"test/diagnostics.jsonl"),[manifest(),...Array.from({length:8000},(_,t)=>item({t}))].map(r=>JSON.stringify(r)).join("\n")+"\n");
 let yielded=false;setTimeout(()=>{yielded=true;},0);const start=performance.now();
 const rows=await spool.read();const elapsed=performance.now()-start;
 expect(rows[0].records).toHaveLength(8000);expect(yielded).toBe(true);expect(elapsed).toBeLessThan(200);spool.close();
});

test("publish and ingestion share raw-line and field refusals",async()=>{
 const root=tempDir("holo-shared-line-"),spool=createLayerSpool(root);
 const over=" ".repeat(1024*1024)+JSON.stringify(item()),bad=JSON.stringify(item({detail:"x".repeat(4001)}));
 const result=await spool.publish("test/diagnostics",[manifest(),over,bad]);
 expect(result.refused).toBe(2);expect(result.reasons[0]).toBe("Item line exceeds 1 MB.");
 const raw=tempDir("holo-raw-line-");mkdirSync(join(raw,"test"));writeFileSync(join(raw,"test/diagnostics.jsonl"),[JSON.stringify(manifest()),over,bad].join("\n")+"\n");
 const reader=createLayerSpool(raw);const rows=await reader.read();expect(rows[0].refused).toBe(2);expect(rows[0].reason).toBe(result.reasons[0]);reader.close();spool.close();
});

test("a rewritten prefix with unchanged final 64 bytes invalidates consumed data",async()=>{
 const root=tempDir("holo-prefix-"),spool=createLayerSpool(root);mkdirSync(join(root,"test"));const path=join(root,"test/diagnostics.jsonl");
 const first=[manifest(),item({label:"before"}),item({id:"unchanged",detail:"x".repeat(200)})].map(r=>JSON.stringify(r)).join("\n")+"\n";
 writeFileSync(path,first);await spool.read();const stamp=statSync(path).mtimeMs+1000;writeFileSync(path,first.replace('"before"','"after!"'));utimesSync(path,new Date(stamp),new Date(stamp));
 const rows=await spool.read();expect((rows[0].records[0] as LayerItem).label).toBe("after!");expect(rows[0].records).toHaveLength(2);spool.close();
});

test("bounded batch reading cancels file/stdin streams on the first oversized chunk",async()=>{
 let reads=0,cancelled=false;
 const input=new ReadableStream<Uint8Array>({pull(c){reads++;c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}},{highWaterMark:0});
 await expect(readBatch(input)).rejects.toThrow("Batch exceeds 16 MB.");expect(reads).toBe(17);expect(cancelled).toBe(true);
});

test("a structure manifest cannot disclose story fields or free citation text",async()=>{
 const d=data([item({kind:"actor",label:"secret-label",detail:"secret-detail",facets:{thinking:"secret-facet"},value:{name:"secret-name",role:"generated fixer",facets:{doing:"secret-caption"}},cite:"agent:test:secret-note"}),item({id:"r",kind:"relation",anchor:{item:"one"},value:{to:{item:"one"},type:"secret-relation"},cite:"se:secret-citation"})],manifest({content:"structure"}));
 const safe=evaluateLayers([d],session(),1000,"structure");expect(JSON.stringify(safe)).not.toContain("secret");expect(safe[0].items[0].value?.name).toBe("generated fixer");
 expect(JSON.stringify(evaluateLayers([d],session(),1000,"full"))).toContain("secret");
});


test("standalone solids use a 350 m point region, recordings retain their observed path",async()=>{
 const root=tempDir("holo-context-"),fixture=writeFixture(),calls:{path:readonly (readonly number[])[];margin:number}[]=[];
 const service=createService({recordingsRoot:fixture.root,worldPackPath:"",layersRoot:root,liveBridge:new FakeBridge(),solidSource:{around:async(path,margin)=>{calls.push({path,margin});return emptySolids();}}});
 const signal=new AbortController().signal;
 try{
  const m=manifest({clock:"game",standalone:{set:"large",from:0,to:100,clock:"game"}});
  await service.layers.publish("test/diagnostics",[m,item({anchor:{at:[-10000,0,0]}}),item({id:"far",anchor:{at:[10000,0,0]}})]);
  const list=await service.handlers["runs.list"]({},signal) as any[];expect(list[0].standalone).toBe(true);
  await service.handlers["world.around"]({dir:"layers:test/large",center:[123,456,0]},signal);expect(calls[0]).toEqual({path:[[123,456,0]],margin:350});
  await service.handlers["world.around"]({dir:fixture.dir},signal);expect(calls[1].path.length).toBeGreaterThan(1);expect(calls[1].margin).toBe(250);
 }finally{service.close();fixture.dispose();}
});


test("ingestion yields for cancellation and watch renewal",async()=>{
 const root=tempDir("holo-cancel-ingest-"),spool=createLayerSpool(root,{interval:()=>()=>{}}),lease=await spool.watch();mkdirSync(join(root,"test"));
 writeFileSync(join(root,"test/diagnostics.jsonl"),[manifest(),...Array.from({length:8000},(_,t)=>item({t}))].map(r=>JSON.stringify(r)).join("\n")+"\n");
 const ctl=new AbortController();let renewed=false;
 const cancelled=spool.read(ctl.signal);setTimeout(()=>{spool.renew(lease.watch);renewed=true;ctl.abort();},0);
 await expect(cancelled).rejects.toThrow();expect(renewed).toBe(true);await spool.scan();expect(spool.snapshot()[0].records).toHaveLength(8000);spool.close();
});

test("publishing refuses a new 5,001st id with the agreed reason",async()=>{
 const root=tempDir("holo-distinct-"),spool=createLayerSpool(root);
 const result=await spool.publish("test/diagnostics",[manifest(),...Array.from({length:5001},(_,i)=>item({id:String(i)}))]);
 expect(result.accepted).toBe(5001);expect(result.reasons).toEqual([ITEM_LIMIT_REASON]);expect(spool.snapshot()[0].records).toHaveLength(5000);spool.close();
});


test("CLI rejects oversized stdin before its writer sends EOF",async()=>{
 const root=tempDir("holo-stdin-limit-");
 const proc=Bun.spawn([process.execPath,resolve(import.meta.dir,"../tools/holo.ts"),"publish","test/diagnostics"],{env:{...process.env,HOLOTABLE_LAYERS:root},stdin:"pipe",stdout:"pipe",stderr:"pipe"});
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try {
  const chunk=new Uint8Array(1024*1024);
  try {for(let i=0;i<17;i++){proc.stdin.write(chunk);await proc.stdin.flush();}}catch{/* The bounded reader may already have closed the pipe. */}
  const code=await Promise.race([proc.exited,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("CLI waited for EOF after exceeding the byte cap.")),2000);})]);
  expect(code).toBe(1);expect(await new Response(proc.stderr).text()).toContain("Batch exceeds 16 MB.");
 } finally {if(deadline)clearTimeout(deadline);if(proc.exitCode===null)proc.kill();try{proc.stdin.end();}catch{}await proc.exited;}
});


test("glyph and badge accept bounded lowercase slugs and survive both content levels",()=>{
 for(const field of ["glyph","badge"] as const){
  for(const value of ["", "Upper", "two words", "bad_name", "bad/name", "-leading", "trailing-", "a".repeat(41), 1, null, true]) expect(validateRecord({...item(),[field]:value},manifest())).toContain("lowercase slug of at most 40 characters");
  expect(validateRecord({...item(),[field]:"a".repeat(40)},manifest())).toBeNull();
 }
 const d=data([item({glyph:"not-yet-known",badge:"pending",label:"story"})]);
 for(const level of ["structure","full"] as const){const row=evaluateLayers([d],session(),1000,level)[0].items[0];expect(row.glyph).toBe("not-yet-known");expect(row.badge).toBe("pending");}
});


test("glyph and badge names have the shared 40-character bound and remain structural through publish, validation and service",async()=>{
 const root=tempDir("holo-glyphs"), spool=createLayerSpool(root);
 const m=manifest({standalone:{set:"glyphs",from:0,to:10,clock:"recording"}});
 const record=item({t:0,glyph:"x".repeat(40),badge:"ready",label:"private story"});
 try {
   for(const field of ["glyph","badge"]){
     expect(validateRecord({...record,[field]:"x".repeat(40)},m)).toBeNull();
     for(const bad of ["x".repeat(41),"Bad","has space","",12,null,"bad/name"])
       expect(validateRecord({...record,[field]:bad},m)).toBeString();
   }
   expect((await spool.publish("test/diagnostics",[m,record])).refused).toBe(0);
   expect(validateFiles(root)).toEqual([]);
   const service=createService({recordingsRoot:"",worldPackPath:"",layersRoot:root});
   try {
     const result=await service.handlers["layers.at"]({dir:"layers:test/glyphs",t:0,level:"structure"},new AbortController().signal) as {layers:{items:LayerItem[]}[]};
     expect(result.layers[0].items[0]).toMatchObject({glyph:"x".repeat(40),badge:"ready"});expect(result.layers[0].items[0].label).toBeUndefined();
   }finally{service.close();}
 }finally{spool.close();}
});

test("change timelines include replacements, effective expiries, both ends and chosen branches, excluding superseded expiries and empty retractions",()=>{
 const s=session();s.meta.from=0;s.meta.to=10;
 const d=data([item({t:0,until:6}),item({t:2,until:4}),{retract:"one",t:3},item({t:5,until:10}),item({id:"branch",t:1,branch:"b"}),{retract:"missing",t:7}]);
 expect(layerChanges(d,s)).toEqual([0,2,3,5,10]);expect(layerChanges(d,s,"b")).toEqual([0,1,2,3,5,10]);
 expect(evaluateLayers([d],s,0,"structure")[0].changes).toEqual([0,2,3,5,10]);
 expect(evaluateLayers([d],s,2,"structure")[0].items[0].version).toBe(1);
 const wall=data([item({t:"2026-10-27T00:00:02Z",until:"2026-10-27T00:00:04Z"})],manifest({clock:"wall"}));
 s.meta.start=0;s.meta.wallStart="2026-10-27T00:00:00Z";expect(layerChanges(wall,s)).toEqual([2,4]);
});


test("change history reuse invalidates when the live span grows or a spool appends",()=>{
 const s=session();s.meta.from=0;s.meta.to=2;const d=data([item({t:1}),{retract:"one",t:4}]);
 const first=layerChanges(d,s);expect(layerChanges(d,s)).toBe(first);expect(first).toEqual([1]);
 s.meta.to=5;expect(layerChanges(d,s)).toEqual([1,4]);d.records.push(item({t:5}));expect(layerChanges(d,s)).toEqual([1,4,5]);
});


test("stepping derives from timestamp-first, spool-order-second revisions including gap tombstones",()=>{
 const s=session();s.meta.from=0;s.meta.to=10;
 const d=data([item({t:4,label:"latest timestamp"}),item({t:2,label:"late spool older time"}),{retract:"one",t:5},item({t:5,label:"same-time revision after tombstone"}),{retract:"one",t:7},item({label:"untimed published last"}),{retract:"one",t:8},item({t:9})]);
 expect(layerChanges(d,s)).toEqual([0,2,4,5,7,9]);
 expect(evaluateLayers([d],s,4,"full")[0].items[0].label).toBe("latest timestamp");
 expect(evaluateLayers([d],s,5,"full")[0].items[0].label).toBe("same-time revision after tombstone");
 expect(evaluateLayers([d],s,7,"full")[0].items).toEqual([]);
 expect(evaluateLayers([d],s,8,"full")[0].items).toEqual([]);
 const off=data([item({t:5}),{retract:"one",t:5}]);expect(layerChanges(off,s)).toEqual([]);
});

test("unmapped clocks and a refused expiry match projection rather than reviving older items",()=>{
 const s=session();s.meta.from=0;s.meta.to=10;
 for(const clock of ["wall","game"] as const){const d=data([item()],manifest({clock}));expect(layerChanges(d,s)).toEqual([]);expect(evaluateLayers([d],s,0,"full")[0].items).toEqual([]);}
 s.meta.gameTimeSamples=[{source:0,game:0},{source:10,game:10}];
 const d=data([item({t:0}),item({t:5,until:1000})],manifest({clock:"game"}));
 expect(layerChanges(d,s)).toEqual([0,5]);expect(evaluateLayers([d],s,5,"full")[0].items).toEqual([]);
});


test("explicit world centres are honoured for recordings and live watches, with shared sectors delegated to the existing source owner",async()=>{
 const fixture=writeFixture(),root=tempDir("holo-pan-centres-"),bridge=new FakeBridge(),calls:{path:readonly (readonly number[])[];signal:AbortSignal}[]=[];
 const service=createService({recordingsRoot:fixture.root,worldPackPath:"",layersRoot:root,liveBridge:bridge,liveClock:bridge.clock,solidSource:{around:async(path,_margin,signal)=>{calls.push({path,signal});return emptySolids();}}});
 const ctl=new AbortController();
 try{
  await service.handlers["world.around"]({dir:fixture.dir,center:[1000,2000,10]},ctl.signal);expect(calls.at(-1)!.path).toEqual([[1000,2000,10]]);
  await expect(Promise.resolve(service.handlers["world.around"]({dir:fixture.dir,center:[1,2,Infinity]},ctl.signal))).rejects.toThrow("Centre must be three finite coordinates");
  bridge.pages.push(bridge.page([{schema:"xfb/source-record-1",session:"abc123",run:1,world_generation:1,seq:1,source_s:1000,channel:"v",valid:true,data:{position:[0,0,10],yaw:0}}]));
  const watch=await service.handlers["live.watch"]({},ctl.signal) as {watch:string};await settle();
  await service.handlers["world.around"]({...watch,center:[-1000,500,30]},ctl.signal);expect(calls.at(-1)!.path).toEqual([[-1000,500,30]]);
 }finally{ctl.abort();service.close();fixture.dispose();}
});


describe("friendly manifest metadata and multiline detail contract",()=>{
 test("producer title accepts both bounds and refuses empty, non-text and controls",()=>{
  for(const producer_title of ["S","S".repeat(80)]) expect(validateManifest(manifest({producer_title}))).toBeNull();
  for(const producer_title of ["","S".repeat(81),1,null,"Story\nEngine","Story\rEngine","Story\tEngine","Story\u007fEngine","Story\u0085Engine"]) expect(validateManifest({...manifest(),producer_title})).toBeString();
 });
 test("facet titles accept bounded keys and names and refuse every invalid dimension",()=>{
  for(const facet_titles of [{},{a:"B"},{["k".repeat(40)]:"T".repeat(60)},Object.fromEntries(Array.from({length:16},(_,i)=>[`k${i}`,"Title"]))]) expect(validateManifest(manifest({facet_titles}))).toBeNull();
  const bad=[null,[],"title",1,{"":"Title"},{["k".repeat(41)]:"Title"},{k:""},{k:"T".repeat(61)},{k:1},{k:null},Object.fromEntries(Array.from({length:17},(_,i)=>[`k${i}`,"Title"]))];
  for(const control of ["\0","\t","\n","\r","\u001f","\u007f","\u0085","\u009f"]) bad.push({[`k${control}`]:"Title"},{k:`Title${control}`});
  for(const facet_titles of bad) expect(validateManifest({...manifest(),facet_titles})).toBeString();
 });
 test("detail permits LF and canonical CRLF within 4,000 characters and 40 lines",()=>{
  for(const detail of ["x","x".repeat(4000),Array(40).fill("cause").join("\n"),"x".repeat(3998)+"\r\nx","first\r\nsecond\nthird"]) expect(validateRecord(item({detail}),manifest())).toBeNull();
  for(const detail of ["","x".repeat(4001),Array(41).fill("cause").join("\n"),Array(41).fill("cause").join("\r\n"),null,1]) expect(validateRecord({...item(),detail},manifest())).toBeString();
  for(const control of ["\0","\t","\r","\u000b","\u001f","\u007f","\u0085","\u009f"]) expect(validateRecord(item({detail:`cause${control}next`}),manifest())).toBeString();
  expect(validateRecord(item({label:"first\nsecond"}),manifest())).toBeString();
 });
 test("CLI validate/publish, raw spool and service preserve structural titles and normalize detail",async()=>{
  const root=tempDir("holo-friendly-"),source=tempDir("holo-friendly-source-"),signal=new AbortController().signal;
  const m=manifest({producer_title:"Story Engine",facet_titles:{doing:"Doing"},standalone:{set:"friendly",from:0,to:10,clock:"recording"}}),record=item({t:0,detail:"Cause one\r\nCause two\nCause three"});
  const path=join(source,"input.jsonl");writeFileSync(path,[m,record].map(x=>JSON.stringify(x)).join("\n")+"\n");
  for(const args of [["validate",path],["publish","test/diagnostics",path]]){
   const proc=Bun.spawn([process.execPath,resolve(import.meta.dir,"../tools/holo.ts"),...args],{env:{...process.env,HOLOTABLE_LAYERS:root},stdout:"pipe",stderr:"pipe"});
   const [exit,stdout,stderr]=await Promise.all([proc.exited,new Response(proc.stdout).text(),new Response(proc.stderr).text()]);
   expect({exit,stderr}).toEqual({exit:0,stderr:""});expect(stdout.length).toBeGreaterThan(0);
  }
  expect(record.detail).toContain("\r\n"); // Canonicalization never mutates caller data.
  const stored=readFileSync(join(root,"test/diagnostics.jsonl"),"utf8").trim().split("\n").map(x=>JSON.parse(x));
  expect(stored[0]).toEqual(m);expect(stored[1].detail).toBe("Cause one\nCause two\nCause three");expect(await validateFiles(root)).toEqual([]);
  const raw=tempDir("holo-friendly-raw-");mkdirSync(join(raw,"test"));writeFileSync(join(raw,"test/diagnostics.jsonl"),[m,record].map(x=>JSON.stringify(x)).join("\n")+"\n");
  const spool=createLayerSpool(raw);
  try{const rows=await spool.read();expect(rows[0].manifest).toEqual(m);expect((rows[0].records[0] as LayerItem).detail).toBe(stored[1].detail);}finally{spool.close();}
  const service=createService({recordingsRoot:"",worldPackPath:"",layersRoot:root});
  try{
   const full=await service.handlers["layers.at"]({dir:"layers:test/friendly",t:0,level:"full"},signal) as any;
   expect(full.layers[0].producer_title).toBe("Story Engine");expect(full.layers[0].facet_titles).toEqual({doing:"Doing"});expect(full.layers[0].items[0].detail).toBe(stored[1].detail);
   const safe=await service.handlers["layers.at"]({dir:"layers:test/friendly",t:0,level:"structure"},signal) as any;
   expect(safe.layers[0].producer_title).toBe("Story Engine");expect(safe.layers[0].facet_titles).toEqual({doing:"Doing"});expect(safe.layers[0].items[0].detail).toBeUndefined();
   const result=await service.handlers["layers.publish"]({layer:"test/extra",lines:[{...m,layer:"extra"},item({t:0,detail:"New\r\nCause"}),item({id:"bad",detail:"Bare\rreturn"}),item({id:"lines",detail:Array(41).fill("x").join("\n")})]},signal) as any;
   expect(result.accepted).toBe(2);expect(result.refused).toBe(2);
   const after=await service.handlers["layers.at"]({dir:"layers:test/friendly",t:0,level:"full"},signal) as any;
   expect(after.layers.find((l:any)=>l.id==="test/extra").items[0].detail).toBe("New\nCause");
  }finally{service.close();}
 });
});


test("layer totals count distinct branch-relevant ids across time without story text at structure",()=>{
 const d=data([item({id:"past",t:1000,until:1001}),item({id:"now",t:1001}),item({id:"now",t:1002,label:"Changed"}),item({id:"future",t:1009}),item({id:"other",branch:"elsewhere"})]);
 const view=evaluateLayers([d],session(),1003,"structure")[0];expect(view.total).toBe(3);expect(view.items).toHaveLength(1);expect(view.items[0].label).toBeUndefined();
});
