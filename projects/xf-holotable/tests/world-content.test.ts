import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RedHandle, RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir";
import { mapContentNode, CONTENT_SECTOR_VERSION, encodeContentSector, decodeContentSector, type ContentSector, type ContentPlacement } from "../src/world-content-data.ts";
import { ContentAssembler, WORLD_CONTENT_READER, boxOverlapsPlace, checkCounts, coverage, count, defaultPlacement, placementId, placeAt, poiKind, selectSlice, yaw, type WorldContent } from "../src/world-content.ts";
import { ContentBudget, CONTENT_LIMITS } from "../src/world-content-budget.ts";
import { journalHash, indexJournal, mapMappins, mapWorkspot } from "../src/world-content-resources.ts";
import { cachedWorldContent, validateContent, worldContentCacheKey } from "../src/world-content-source.ts";
import { createSectorCache, SectorWorkers, type SourceStamp } from "../src/sector-cache.ts";
import type { Area, WorldPack } from "../src/model.ts";

const obj=(type:string,fields:Record<string,unknown>={})=>new RedObject(type,fields);
const h=(type:string,fields:Record<string,unknown>={})=>new RedHandle(obj(type,fields));
const name=(s:string)=>({$type:"CName",$storage:"string",$value:s});
const id=(s:string)=>obj("worldGlobalNodeID",{hash:s});
const ref=(s:string)=>({DepotPath:{$value:s}});
const area:Area={id:"Districts.Test",name:"Test",kind:"district",poly:[[0,0],[10,0],[10,10],[0,10]],zlo:0,zhi:10};
const venue:Area={...area,id:"Districts.Venue",kind:"venue",parent:area.id,poly:[[2,2],[4,2],[4,4],[2,4]],zlo:1,zhi:3};
const pack:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"synthetic",source:"test",built:"test"},areas:[area,venue],cells:[]};
const pl=(index:number,nodeIndex:number,ref="0"):ContentPlacement=>({index,nodeIndex,ref,at:[3,3,2],orientation:[0,0,0,1]});
const sector=(nodes:ContentSector["nodes"],placements:ContentSector["placements"]):ContentSector=>({version:CONTENT_SECTOR_VERSION,nodes,placements,variantIndices:[0],persistentNodeIndex:-1});
function result(key:string):WorldContent {
  const a=new ContentAssembler(pack,selectSlice(pack,"test"));
  return {schema:"xfh/world-content-1",slice:{id:"test",title:"Test",places:[area.id]},source:{game:"test",archives:"test",reader:WORLD_CONTENT_READER,built:"test",key},communities:[],spots:[],spawners:[],pois:[],counts:a.counts};
}

test("every node class maps stored fields through the actual handles and id structs",()=>{
  const source=h("entEntityID",{hash:"100"}).target!;
  const community=mapContentNode(0,"worldCompiledCommunityAreaNode_Streamable",obj("worldCompiledCommunityAreaNode_Streamable",{
    debugName:name("group"),sourceObjectId:source,area:h("communityArea",{entriesData:[obj("communityCommunityEntrySpotsData",{entryName:name("resident"),phasesData:[obj("communityCommunityEntryPhaseSpotsData",{entryPhaseName:name("day"),timePeriodsData:[obj("communityCommunityEntryPhaseTimePeriodData",{periodName:name("Morning"),spotNodeIds:[id("42")]})]})]})]})}));
  expect(community).toMatchObject({name:"group",sourceId:"100",entries:[{name:"resident",phases:[{name:"day",periods:[{name:"Morning",spots:["42"]}]}]}]});
  expect(mapContentNode(1,"worldCompiledCommunityAreaNode",obj("worldCompiledCommunityAreaNode",{})).refusal).toBe("missing communityArea");
  const registry=mapContentNode(2,"worldCommunityRegistryNode",obj("worldCommunityRegistryNode",{communitiesData:[obj("worldCommunityRegistryItem",{communityId:obj("gameCommunityID",{entityId:source}),template:h("communityCommunityTemplateData",{entries:[h("communitySpawnEntry",{entryName:name("resident"),characterRecordId:{$value:"123456789012345678"}})]})})]}));
  expect(registry.registry).toEqual([{id:"100",entries:[{name:"resident",record:"123456789012345678"}]}]);
  expect(mapContentNode(3,"worldAISpotNode",obj("worldAISpotNode",{spot:h("AIActionSpot",{resource:ref("test.workspot")})})).workspot).toBe("test.workspot");
  expect(mapContentNode(4,"worldPopulationSpawnerNode",obj("worldPopulationSpawnerNode",{objectRecordId:{$value:"888"},spawnOnStart:0}))).toMatchObject({record:"888",onStart:false});
  expect(mapContentNode(4,"worldPopulationSpawnerNode",obj("worldPopulationSpawnerNode",{recordID:{$value:"wrong"}})).record).toBeUndefined();
});

test("the smallest containing place wins across venue, district, Z band and input order",()=>{
  expect(placeAt([area,venue],[3,3,2])?.id).toBe(venue.id);
  expect(placeAt([venue,area],[3,3,4])?.id).toBe(area.id);
  expect(placeAt([venue,area],[3,3,11])).toBeUndefined();
  expect(placeAt([area],[10,10,10])?.id).toBe(area.id);
  expect(selectSlice(pack,"test").places).toEqual([area.id,venue.id]);
  expect(()=>selectSlice({...pack,areas:[{...area,zhi:NaN} ]},"test")).toThrow(NativeMalformedError);
  expect(boxOverlapsPlace([9,9,2],[11,11,3],area)).toBe(true);
  expect(boxOverlapsPlace([9,9,11],[11,11,12],area)).toBe(false);
  const concave={...area,poly:[[0,0],[10,0],[10,2],[2,2],[2,10],[0,10]] as [number,number][]};
  expect(boxOverlapsPlace([4,4,1],[6,6,2],concave)).toBe(false);
  expect(boxOverlapsPlace([-1,1,1],[11,1.5,2],concave)).toBe(true);
});

test("default and persistent ranges use original placement indexes; ids and yaw preserve their meaning",()=>{
  const s={variantIndices:[0,3,5],persistentNodeIndex:2};
  expect([0,3,5].map(i=>defaultPlacement(i,s,[0]))).toEqual([true,false,true]);
  expect(defaultPlacement(3,s,[0,1])).toBe(true);
  expect(placementId("sector",pl(20,0))).toBe("sector:20");
  expect(placementId("sector",pl(20,0,"9007199254740993"))).toBe("9007199254740993");
  expect(yaw([0,0,Math.SQRT1_2,Math.SQRT1_2])).toBeCloseTo(90);
  expect(()=>yaw([0,0,0,0])).toThrow(NativeMalformedError);
});

test("community records and both sides of spot membership join by source id, entry name and spot id",()=>{
  const out=new ContentAssembler(pack,selectSlice(pack,"test"));
  const nodes:ContentSector["nodes"]=[{nodeIndex:0,type:"worldCompiledCommunityAreaNode_Streamable",sourceId:"100",entries:[{name:"resident",phases:[{name:"day",periods:[{name:"Morning",spots:["42","404"]}]}]}]},
    {nodeIndex:1,type:"worldAISpotNode",workspot:"test.workspot"},{nodeIndex:2,type:"worldCommunityRegistryNode",registry:[{id:"100",entries:[{name:"resident",record:"555"}]}]},
    {nodeIndex:3,type:"worldPopulationSpawnerNode",record:"777",onStart:true}];
  const s=sector(nodes,[pl(0,0,"10"),pl(1,1,"42"),pl(2,2),pl(3,3,"43"),{...pl(4,1,"44"),at:[20,20,2]},pl(5,1,"42")]);
  out.addSector("sector",s,[0]);out.finishCommunities();
  expect(out.communities[0]).toMatchObject({id:"10",place:venue.id,entries:[{name:"resident",record:"555",phases:[{name:"day",spots:["42"]}]}]});
  expect(out.spots[0].communities).toEqual(["10"]);
  expect(out.spawners[0]).toMatchObject({record:"777",onStart:true});
  expect(out.counts.reasons.spots).toEqual({"outside slice":1,"duplicate id":1});
  expect(out.counts.reasons["community.spotLinks"]).toEqual({"spot outside slice, inactive or unavailable":1});
  expect(out.counts.dropped["community.time"]).toBe(1);expect(out.communities[0]).not.toHaveProperty("area");
  checkCounts(out.counts);out.counts.kept.spots++;expect(()=>checkCounts(out.counts)).toThrow(NativeMalformedError);
});

test("typed node refusals, inactive variants and missing mandatory records are counted",()=>{
  const out=new ContentAssembler(pack,selectSlice(pack,"test"));
  const s=sector([{nodeIndex:0,type:"worldAISpotNode",refusal:"NativeUnsupportedError"},{nodeIndex:1,type:"worldPopulationSpawnerNode"}], [pl(0,0),pl(1,1),pl(2,0)]);s.variantIndices=[0,2];
  out.addSector("sector",s,[0]);
  expect(out.counts.reasons.spots).toEqual({NativeUnsupportedError:1,"inactive variant":1});
  expect(out.counts.reasons.spawners).toEqual({"missing objectRecordId":1});checkCounts(out.counts);
});

test("workspot activity comes only from a stored root idle, tags from the tree, without filename guesses",()=>{
  const counts=coverage(),root=obj("workWorkspotResource",{workspotTree:h("workWorkspotTree",{rootEntry:h("workSequence",{idleAnim:name("sit_idle")}),tags:obj("redTagList",{tags:[name("Seated")]})})});
  expect(mapWorkspot(root,"misleading_file.workspot",counts)).toEqual({path:"misleading_file.workspot",activity:"sit_idle",tags:["Seated"]});
  const empty=obj("workWorkspotResource",{workspotTree:h("workWorkspotTree",{rootEntry:h("workSequence")})});
  expect(mapWorkspot(empty,"eat.workspot",counts).activity).toBeUndefined();expect(counts.dropped["workspot.activity"]).toBe(1);
  expect(()=>mapWorkspot(obj("workWorkspotResource"),"bad.workspot",counts)).toThrow(NativeMalformedError);checkCounts(counts);
});

test("cooked pins join journal paths by hash, keep unknown variants, and cover multi/GPS positions",()=>{
  const pin=h("gameJournalPointOfInterestMappin",{id:"shop",recommendedLevelID:{$value:"991"},mappinData:obj("gamemappinsPointOfInterestMappinData",{typedVariant:h("gamemappinsPointOfInterestVariant",{variant:"FutureVendorVariant"})})});
  const journal=indexJournal(obj("gameJournalResource",{entry:h("gameJournalRootFolderEntry",{entries:[h("gameJournalContainerEntry",{id:"points_of_interest",entries:[pin]})]})}));
  const path="points_of_interest/shop",hash=journalHash(path);expect(journal.get(hash)).toEqual({path,record:"991",variant:"FutureVendorVariant"});
  // Independently computed with the existing research Python's Murmur3 implementation.
  expect(journalHash("quests/main_quest")).toBe(1422594314);
  const pos=obj("Vector3",{X:3,Y:3,Z:2}),row=obj("gameCookedMappinData",{journalPathHash:hash,position:pos});
  const out=new ContentAssembler(pack,selectSlice(pack,"test"));
  mapMappins(obj("gameMappinResource",{cookedData:[row],cookedMultiData:[obj("gameCookedMultiMappinData",{journalPathHash:hash,positions:[pos,pos]})],cookedGpsData:[obj("gameCookedGpsMappinData",{journalPathHash:hash,positions:[pos]})]}),"pins",journal,out);
  expect(out.pois).toHaveLength(4);expect(out.pois[0]).toMatchObject({kind:"FutureVendorVariant",journal:path,record:"991",place:venue.id});
  expect(poiKind("ServicePointRipperdocVariant")).toBe("Ripperdoc");expect(poiKind("__proto__")).toBe("__proto__");
  journal.set(hash,null);mapMappins(obj("gameMappinResource",{cookedData:[row]}),"pins2",journal,out);
  expect(out.counts.reasons.pois["ambiguous journal hash"]).toBe(1);checkCounts(out.counts);
});

test("sector transport bounds reject wrong versions, placements, ranges and oversized data",()=>{
  const s=sector([{nodeIndex:0,type:"worldAISpotNode"}],[pl(0,0)]);
  expect(decodeContentSector(encodeContentSector(s))).toEqual(s);
  for(const bad of [{...s,version:0},{...s,variantIndices:[2,1]},{...s,placements:[{...pl(0,0),at:[null,0,0]}]},{...s,placements:[pl(0,9)]}])expect(()=>decodeContentSector(new TextEncoder().encode(JSON.stringify(bad)))).toThrow(NativeMalformedError);
  expect(()=>decodeContentSector(new Uint8Array(32*1024*1024+1))).toThrow(NativeBudgetError);
  expect(()=>decodeContentSector(new TextEncoder().encode("broken"))).toThrow(NativeMalformedError);
  const content=result("key");content.spots=Array(50_001).fill({});expect(()=>validateContent(content,"key")).toThrow(NativeBudgetError);
});

test("cache identity includes ordered archive stamps, reader, slice and places; assembled reuse avoids work",async()=>{
  const stamps:SourceStamp[]=[{path:"game/a.archive",size:12,mtimeMs:1},{path:"game/b.archive",size:13,mtimeMs:2}],key=worldContentCacheKey(stamps,pack,"test");
  for(const changed of [[{...stamps[0],size:14},stamps[1]],[{...stamps[0],mtimeMs:3},stamps[1]],[{...stamps[0],path:"other"},stamps[1]],[stamps[1],stamps[0]]])expect(worldContentCacheKey(changed,pack,"test")).not.toBe(key);
  expect(worldContentCacheKey(stamps,pack,"other")).not.toBe(key);expect(worldContentCacheKey(stamps,pack,"test","next")).not.toBe(key);
  expect(worldContentCacheKey(stamps,{...pack,areas:[{...area,zhi:20}]},"test")).not.toBe(key);
  const dir=tempDir("w1-cache-"),file=join(dir,"test.json"),signal=new AbortController().signal;let reads=0;
  const build=async()=>{reads++;return result(key);};
  expect((await cachedWorldContent(file,key,build,signal)).cached).toBe(false);
  expect((await cachedWorldContent(file,key,build,signal)).cached).toBe(true);expect(reads).toBe(1);
  writeFileSync(file,"broken");expect((await cachedWorldContent(file,key,build,signal)).cached).toBe(false);expect(reads).toBe(2);
  const saved=readFileSync(file,"utf8"),ctl=new AbortController();
  await expect(cachedWorldContent(file,"changed",async()=>{ctl.abort();return result("changed");},ctl.signal)).rejects.toThrow();expect(readFileSync(file,"utf8")).toBe(saved);
  expect(existsSync(file)).toBe(true);
});

test("the content codec reuses W0's per-sector owner and isolates its disk identity",async()=>{
  const dir=tempDir("w1-sector-"),request={root:"game",resource:"sector.streamingsector",source:{path:"vanilla.archive",size:1,mtimeMs:2}};
  const data=encodeContentSector(sector([],[])),codec={version:CONTENT_SECTOR_VERSION,decode:decodeContentSector};let reads=0;
  const reader=async()=>{reads++;return data;};
  const owner=createSectorCache(dir,reader,codec),signal=new AbortController().signal;
  await owner.read(request,signal);await createSectorCache(dir,reader,codec).read(request,signal);expect(reads).toBe(1);
  await createSectorCache(dir,reader,{...codec,version:CONTENT_SECTOR_VERSION+1}).read(request,signal);expect(reads).toBe(2);
});

test("repeated placements expand a shared community once, while every serialized copy consumes budget",()=>{
  let expansions=0;
  const entries=Array.from({length:1000},(_,i)=>({name:`resident${i}`,phases:[]}));
  const node={nodeIndex:0,type:"worldCompiledCommunityAreaNode_Streamable",get entries(){expansions++;return entries;}};
  const placements=Array.from({length:100},(_,i)=>pl(i,0));
  const out=new ContentAssembler(pack,selectSlice(pack,"test"));
  out.addSector("sector",sector([node],placements),[0]);out.finishCommunities();
  expect(expansions).toBe(1);expect(out.communities).toHaveLength(100);
  expect(out.communities[99].entries).toBe(out.communities[0].entries);
  expect(out.counts.kept["community.entries"]).toBe(100_000);
  expect(out.budget.snapshot().nested).toBe(100_000);
  const bounded=new ContentAssembler(pack,selectSlice(pack,"test"),new ContentBudget({...CONTENT_LIMITS,nested:1500}));
  bounded.addSector("sector",sector([node],placements),[0]);
  expect(()=>bounded.finishCommunities()).toThrow(NativeBudgetError);
  expect(expansions).toBe(2);expect(bounded.communities[1].entries).toHaveLength(0);
});

test("nested, link and estimated byte limits refuse before allocating a result past the budget",()=>{
  const node={nodeIndex:0,type:"worldCompiledCommunityAreaNode_Streamable",entries:[{name:"resident",phases:[{name:"day",periods:[{spots:["42","43"]}]}]}]};
  const s=sector([node,{nodeIndex:1,type:"worldAISpotNode"}],[pl(0,0),pl(1,1,"42"),pl(2,1,"43")]);
  for(const limits of [{...CONTENT_LIMITS,nested:1},{...CONTENT_LIMITS,links:1},{...CONTENT_LIMITS,bytes:1}]) {
    const out=new ContentAssembler(pack,selectSlice(pack,"test"),new ContentBudget(limits));
    expect(()=>{out.addSector("sector",s,[0]);out.finishCommunities();}).toThrow(NativeBudgetError);
    const used=out.budget.snapshot();expect(used.nested).toBeLessThanOrEqual(limits.nested);expect(used.links).toBeLessThanOrEqual(limits.links);expect(used.bytes).toBeLessThanOrEqual(limits.bytes);
  }
});

test("valid-JSON damage in every assembled collection and nested structure rebuilds the file",async()=>{
  const dir=tempDir("w1-damaged-file-"),file=join(dir,"content.json"),signal=new AbortController().signal;
  const invalid:[keyof Pick<WorldContent,"spots"|"communities"|"spawners"|"pois">,unknown][]=[
    ["spots",{id:"s",place:area.id}],
    ["spots",{id:"s",place:area.id,at:[1,2,3],yaw:0,communities:[],workspot:{path:"x",tags:[null]}}],
    ["communities",{id:"c",place:area.id,entries:[null]}],
    ["communities",{id:"c",place:area.id,entries:[{name:"e",phases:[{name:"p",spots:[null]}]}]}],
    ["spawners",{id:"sp",place:area.id,at:[1,2,3],yaw:0}],
    ["pois",{id:"poi",place:area.id,at:[1,2,3]}],
  ];
  let rebuilds=0;
  for(const [collection,row] of invalid) {
    const value=result("key");(value[collection] as unknown[]).push(row);count(value.counts,collection);
    expect(()=>validateContent(value,"key")).toThrow(NativeMalformedError);
    writeFileSync(file,JSON.stringify(value));
    const loaded=await cachedWorldContent(file,"key",async()=>{rebuilds++;return result("key");},signal);
    expect(loaded.cached).toBe(false);expect(loaded.content[collection]).toHaveLength(0);
  }
  expect(rebuilds).toBe(invalid.length);
});

test("valid-JSON sector damage is refused and regenerated by the per-sector cache",async()=>{
  const dir=tempDir("w1-damaged-sector-"),request={root:"game",resource:"sector.streamingsector",source:{path:"vanilla.archive",size:1,mtimeMs:2}};
  const invalid=sector([{nodeIndex:0,type:"worldCompiledCommunityAreaNode_Streamable",entries:[null as never]}],[pl(0,0)]);
  const damaged=encodeContentSector(invalid),good=encodeContentSector(sector([],[]));
  expect(()=>decodeContentSector(damaged)).toThrow(NativeMalformedError);
  // Write a structurally invalid, valid-JSON disk entry with a permissive previous decoder.
  const signal=new AbortController().signal;
  await createSectorCache(dir,async()=>damaged,{version:CONTENT_SECTOR_VERSION,decode:()=>invalid}).read(request,signal);
  let rebuilt=0;
  const owner=createSectorCache(dir,async()=>{rebuilt++;return good;},{version:CONTENT_SECTOR_VERSION,decode:decodeContentSector});
  expect((await owner.read(request,signal)).nodes).toEqual([]);expect(rebuilt).toBe(1);
  for(const entries of [[{name:"e",phases:[null]}],[{name:"e",phases:[{name:"p",periods:[{spots:[null]}]}]}]]) {
    expect(()=>decodeContentSector(encodeContentSector(sector([{nodeIndex:0,type:"worldCompiledCommunityAreaNode",entries:entries as never}],[pl(0,0)])))).toThrow(NativeMalformedError);
  }
});

test("explicit owner shutdown terminates a stalled decode within its deadline after cancellation",async()=>{
  const shared=new SharedArrayBuffer(4),state=new Int32Array(shared);
  const workers=new SectorWorkers(1,"content",()=>{const w=new Worker(new URL("./fixtures/stalled-sector-worker.ts",import.meta.url).href);w.postMessage({state:shared});return w;});
  const ctl=new AbortController(),read=workers.read({root:"game",resource:"sector",source:{path:"archive",size:1,mtimeMs:1}},ctl.signal);
  const outcome=read.then(()=>false,()=>true);
  try {
    const deadline=performance.now()+2000;
    while(Atomics.load(state,0)===0&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    expect(Atomics.load(state,0)).toBe(1);
    ctl.abort();expect(await outcome).toBe(true);
    const start=performance.now();await workers.shutdown(30);expect(performance.now()-start).toBeLessThan(1000);
    await workers.shutdown(30); // idempotent, and no later reader can restart the owner
    await expect(workers.read({root:"game",resource:"next",source:{path:"archive",size:1,mtimeMs:1}},new AbortController().signal)).rejects.toThrow("shut down");
  }finally{ctl.abort();await workers.shutdown(30);}
});

test("W0 requester cancellation and closeIdle preserve an active worker for the next reader",async()=>{
  const sent:unknown[]=[],worker={onmessage:null as null|((event:{data:unknown})=>void),onerror:null,postMessage:(m:unknown)=>{sent.push(m);},terminate:()=>{throw Error("Shared worker must not terminate.");}};
  const workers=new SectorWorkers(1,"collisions",()=>worker as unknown as Worker);
  const request={root:"game",resource:"sector",source:{path:"archive",size:1,mtimeMs:1}},a=new AbortController(),b=new AbortController();
  const first=workers.read(request,a.signal),firstOutcome=first.then(()=>false,()=>true);
  const second=workers.read(request,b.signal);
  a.abort();expect(await firstOutcome).toBe(true);await workers.closeIdle();expect(sent).toHaveLength(1);
  worker.onmessage!({data:{data:new Uint8Array([1])}}); // cancelled active read drains; queued reader then starts
  expect(sent).toHaveLength(2);worker.onmessage!({data:{data:new Uint8Array([2])}});
  expect(await second).toEqual(new Uint8Array([2]));
  const closed=workers.closeIdle();expect(sent[2]).toEqual({close:true});worker.onmessage!({data:{closed:true}});await closed;
  await workers.shutdown();
});
