import { cachedWorldContent } from "../src/world-content-publication";
import {createHash} from "node:crypto";
import { expect, test } from "bun:test";
import { writeFileSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir";
import { CONTENT_IDLE_MS, CONTENT_LEASE_MS, CONTENT_RENEW_MS, estimatedContentBytes, worldContentFiles } from "../src/world-content-files";
import { ContentAssembler, WORLD_CONTENT_READER, selectSlice, type WorldContent } from "../src/world-content";
import type { WorldPack } from "../src/model";
import { createService } from "../src/service";
import { emptySolids } from "../src/solid-source";
import { writeFixture } from "./fixture";
const pack:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"test",source:"test",built:"test"},cells:[],areas:[{id:"Districts.Kabuki",name:"Kabuki",kind:"district",poly:[[0,0],[100,0],[100,100],[0,100]],zlo:0,zhi:100}]};
const fixture=():WorldContent=>{
 const out=new ContentAssembler(pack,selectSlice(pack,"kabuki"));out.addPoi({id:"p",at:[10,10,0],variant:"ServicePointRipperdocVariant"});
 return {schema:"xfh/world-content-1",source:{key:"test",game:"test",reader:WORLD_CONTENT_READER,built:"test",archives:"test"},slice:{id:"kabuki",title:"Kabuki",places:["Districts.Kabuki"]},records:{},communities:[],spots:[],spawners:[],pois:out.pois,counts:out.counts};
};
async function save(file:string,content:WorldContent){const key=createHash("sha256").update(JSON.stringify(content)).digest("hex");await cachedWorldContent(file,key,async()=>({...content,source:{...content.source,key}}),new AbortController().signal,{fingerprint:"fixture",slice:selectSlice(pack,"kabuki")});}
function testClock(){
 let now=0;const timers=new Map<()=>void,number>();
 return {now:()=>now,timers,later(ms:number,fn:()=>void){timers.set(fn,now+ms);return()=>{timers.delete(fn);};},advance(ms:number){
  const end=now+ms;
  for(let n=0;n<1000;n++){
   const next=[...timers].sort((a,b)=>a[1]-b[1])[0];
   if(!next||next[1]>end){now=end;return;}now=next[1];timers.delete(next[0]);next[0]();
  }
  throw Error("Synthetic clock exceeded its callback budget.");
 }};
}
test("content is lazy, absent is ordinary, slices follow open places and validated files cache by stamp",async()=>{
 const dir=tempDir("holo-content-files-"),owner=worldContentFiles(dir),file=join(dir,"kabuki.content.json"),signal=new AbortController().signal;
 try{
  expect(owner.around(pack,[[10,10,0]],20,true,signal)).toMatchObject({available:false,pois:[]});
  await save(file,fixture());writeFileSync(file,"not parsed while switched off");expect(owner.around(pack,[[10,10,0]],20,false,signal)).toMatchObject({available:true,pois:[]});
  expect(owner.around(pack,[[1000,1000,0]],20,true,signal).slices).toEqual([]);
  await save(file,fixture());const a=owner.around(pack,[[10,10,0]],20,true,signal),b=owner.around(pack,[[10,10,0]],20,true,signal);
  expect(a.pois[0]).toBe(b.pois[0]);expect(a.pois[0].variant).toBe("ServicePointRipperdocVariant");
  expect(owner.around(pack,[[90,90,0]],5,true,signal).pois).toEqual([]);
  const changed=fixture();changed.pois[0].kind="Medicine";await save(file,changed);expect(owner.around(pack,[[10,10,0]],20,true,signal).pois[0].kind).toBe("Medicine");
  unlinkSync(file);expect(owner.around(pack,[[10,10,0]],20,true,signal).available).toBe(false);
  const ctl=new AbortController();ctl.abort();expect(()=>owner.around(pack,[[0,0,0]],20,true,ctl.signal)).toThrow();
 }finally{owner.close();}
});

test("existing status polls renew shared content and a dropped final release expires before idle eviction",async()=>{
 const f=writeFixture(),world=join(f.root,"world.json"),clock=testClock();
 writeFileSync(world,JSON.stringify(pack));await save(join(f.root,"kabuki.content.json"),fixture());
 const service=createService({recordingsRoot:f.root,worldPackPath:world,worldContentDir:f.root,solidSource:{around:async()=>emptySolids()},liveClock:clock,liveBridge:{discover:async()=>({available:false,reason:"synthetic"}),catchup:async()=>({}),close(){}}}),signal=new AbortController().signal;
 const demand=(consumer:string,wanted:boolean)=>service.handlers["world.content.demand"]({consumer,wanted},signal);
 const read=async(consumer:string)=>((await service.handlers["world.around"]({dir:f.dir,center:[10,10,0],margin:20,content:true,contentConsumer:consumer},signal)) as {content:{pois:unknown[]}}).content.pois[0];
 try{
  await demand("a",true);const first=await read("a");expect(first).toBeDefined();await read("b");await demand("a",false);
  for(let n=0;n<12;n++){clock.advance(CONTENT_RENEW_MS);await service.handlers["live.status"]({contentConsumer:"b"},signal);}
  expect(await read("b")).toBe(first);
  // The final release is lost in transport; no further client request reaches the service.
  clock.advance(CONTENT_LEASE_MS+CONTENT_IDLE_MS);expect(await read("next-client")).not.toBe(first);
 }finally{service.close();f.dispose();}expect(clock.timers.size).toBe(0);
});

test("parsed content evicts after the final demand's idle, stays warm for another consumer, and cancels eviction on reacquire",async()=>{
 const dir=tempDir("holo-content-idle-"),file=join(dir,"kabuki.content.json"),clock=testClock();
 const owner=worldContentFiles(dir,clock),signal=new AbortController().signal,read=()=>owner.around(pack,[[10,10,0]],20,true,signal).pois[0];
 try{
  await save(file,fixture());owner.demand("a",true);owner.demand("b",true);const first=read();
  owner.demand("a",false);for(let n=0;n<12;n++){clock.advance(CONTENT_RENEW_MS);owner.demand("b",true);}expect(read()).toBe(first);expect(clock.timers.size).toBe(1);
  owner.demand("b",false);clock.advance(CONTENT_IDLE_MS-1);expect(read()).toBe(first);
  owner.demand("a",true);for(let n=0;n<6;n++){clock.advance(CONTENT_RENEW_MS);owner.demand("a",true);}expect(read()).toBe(first);expect(clock.timers.size).toBe(1);
  owner.demand("a",false);clock.advance(CONTENT_IDLE_MS);owner.demand("b",true);expect(read()).not.toBe(first);
  owner.demand("b",false);expect(clock.timers.size).toBe(1);owner.close();expect(clock.timers.size).toBe(0);
 }finally{owner.close();}
});

test("an abandoned consumer expires without stealing a healthy consumer's cache, and cannot pin it after the healthy release",async()=>{
 const dir=tempDir("holo-content-abandoned-"),clock=testClock(),owner=worldContentFiles(dir,clock),signal=new AbortController().signal;
 const read=()=>owner.around(pack,[[10,10,0]],20,true,signal).pois[0];
 try{
  await save(join(dir,"kabuki.content.json"),fixture());owner.demand("abandoned",true);owner.demand("healthy",true);const first=read();
  expect(clock.timers.size).toBe(1); // A shared expiry timer, not one per consumer.
  for(let n=0;n<12;n++){clock.advance(CONTENT_RENEW_MS);owner.demand("healthy",true);expect(read()).toBe(first);expect(clock.timers.size).toBe(1);}
  owner.demand("healthy",false);clock.advance(CONTENT_IDLE_MS-1);expect(read()).toBe(first);
  clock.advance(1);expect(read()).not.toBe(first);
 }finally{owner.close();}expect(clock.timers.size).toBe(0);
});

test("an unrenewed lease lasts two poll intervals, then the full thirty-second idle grace",async()=>{
 const dir=tempDir("holo-content-expiry-"),clock=testClock(),owner=worldContentFiles(dir,clock),signal=new AbortController().signal;
 const read=()=>owner.around(pack,[[10,10,0]],20,true,signal).pois[0];
 try{
  await save(join(dir,"kabuki.content.json"),fixture());owner.demand("lost-client",true);const first=read();
  clock.advance(CONTENT_LEASE_MS-1);expect(read()).toBe(first);
  clock.advance(1);clock.advance(CONTENT_IDLE_MS-1);expect(read()).toBe(first);
  clock.advance(1);expect(read()).not.toBe(first);
 }finally{owner.close();}expect(clock.timers.size).toBe(0);
});

test("indexed slice responses carry exactly their community record metadata",async()=>{
 const dir=tempDir("w1-record-response-"),value=fixture();
 value.records={"1":{kind:"person",name:"Character.guard",displayName:"Guard",affiliation:"2",affiliationTitle:"Unit"},"9":{kind:"vehicle"}};
 value.communities=[{id:"c",place:"Districts.Kabuki",entries:[{name:"guard",record:"1",phases:[{name:"day",spots:["s"]}]}]}];value.spots=[{id:"s",place:"Districts.Kabuki",at:[10,10,0],yaw:0,communities:["c"]}];
 for(const key of ["communities","spots"]){value.counts.read[key]=value.counts.kept[key]=1;}
 await save(join(dir,"kabuki.content.json"),value);const owner=worldContentFiles(dir);
 try{const response=owner.around(pack,[[10,10,0]],20,true,new AbortController().signal);expect(response.records).toEqual({"1":value.records["1"]});expect(response.communities[0].entries[0]).not.toHaveProperty("recordName");}
 finally{owner.close();}
});

async function severalSlices(){
 const dir=tempDir("w1-many-slices-"),many:WorldPack={...pack,areas:["aaa","bbb","ccc"].map((id,i)=>({...pack.areas[0],id:`Districts.${id}`,name:id,poly:[[i*1000,0],[i*1000+100,0],[i*1000+100,100],[i*1000,100]]}))};
 const sizes:number[]=[];
 for(const [i,area]of many.areas.entries()){
  const c=fixture();c.slice={id:area.name,title:area.name,places:[area.id]};c.pois[0]={...c.pois[0],id:area.name,place:area.id,at:[i*1000+10,10,0]};
  const file=join(dir,`${area.name}.content.json`);await cachedWorldContent(file,c.source.key,async()=>c,new AbortController().signal,{fingerprint:"fixture",slice:{roots:[area]}});sizes.push(estimatedContentBytes(statSync(file).size));
 }
 return {dir,pack:many,cap:2*Math.max(...sizes)};
}
test("a total parsed-size budget evicts only unclaimed least-recently-used slices",async()=>{
 const f=await severalSlices(),owner=worldContentFiles(f.dir,undefined,{maxParsedBytes:f.cap}),signal=new AbortController().signal;
 const read=(i:number)=>owner.around(f.pack,[[i*1000+10,10,0]],20,true,signal).pois[0];
 try{
  const a=read(0),b=read(1);expect(read(0)).toBe(a);read(2);
  expect(owner.usage().estimatedParsedBytes).toBeLessThanOrEqual(f.cap);expect(owner.usage().files.map(p=>p.split(/[\\/]/).at(-1))).toEqual(["aaa.content.json","ccc.content.json"]);
  expect(read(1)).not.toBe(b);expect(owner.usage().files).toHaveLength(2);
 }finally{owner.close();}expect(owner.usage().estimatedParsedBytes).toBe(0);
});
test("live claims prevent eviction, release/expiry free them, and one oversized view refuses before parsing",async()=>{
 const f=await severalSlices(),clock=testClock(),owner=worldContentFiles(f.dir,clock,{maxParsedBytes:f.cap}),signal=new AbortController().signal;
 const read=(i:number,consumer:string)=>owner.around(f.pack,[[i*1000+10,10,0]],20,true,signal,consumer).pois[0];
 try{
  expect(()=>owner.around(f.pack,[[10,10,0],[2010,10,0]],20,true,signal,"wide")).toThrow("This view's");expect(owner.usage().files).toHaveLength(0);
  owner.demand("alice",true);const a=read(0,"alice");owner.demand("bob",true);read(1,"bob");owner.demand("charlie",true);
  expect(()=>read(2,"charlie")).toThrow("Active consumers");expect(read(0,"alice")).toBe(a);
  owner.demand("bob",false);read(2,"charlie");expect(read(0,"alice")).toBe(a);expect(owner.usage().estimatedParsedBytes).toBeLessThanOrEqual(f.cap);
  clock.advance(CONTENT_LEASE_MS);read(1,"new");expect(owner.usage().estimatedParsedBytes).toBeLessThanOrEqual(f.cap);
 }finally{owner.close();}expect(clock.timers.size).toBe(0);
});
