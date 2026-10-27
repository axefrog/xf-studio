import { expect, test } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir";
import { CONTENT_IDLE_MS, worldContentFiles } from "../src/world-content-files";
import { ContentAssembler, WORLD_CONTENT_READER, selectSlice, type WorldContent } from "../src/world-content";
import type { WorldPack } from "../src/model";
import { createService } from "../src/service";
import { emptySolids } from "../src/solid-source";
import { writeFixture } from "./fixture";
const pack:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"test",source:"test",built:"test"},cells:[],areas:[{id:"Districts.Kabuki",name:"Kabuki",kind:"district",poly:[[0,0],[100,0],[100,100],[0,100]],zlo:0,zhi:100}]};
const fixture=():WorldContent=>{
 const out=new ContentAssembler(pack,selectSlice(pack,"kabuki"));out.addPoi({id:"p",at:[10,10,0],variant:"ServicePointRipperdocVariant"});
 return {schema:"xfh/world-content-1",source:{key:"test",game:"test",reader:WORLD_CONTENT_READER,built:"test",archives:"test"},slice:{id:"kabuki",title:"Kabuki",places:["Districts.Kabuki"]},communities:[],spots:[],spawners:[],pois:out.pois,counts:out.counts};
};
test("content is lazy, absent is ordinary, slices follow open places and validated files cache by stamp",()=>{
 const dir=tempDir("holo-content-files-"),owner=worldContentFiles(dir),file=join(dir,"kabuki.content.json"),signal=new AbortController().signal;
 try{
  expect(owner.around(pack,[[10,10,0]],20,true,signal)).toMatchObject({available:false,pois:[]});
  writeFileSync(file,"not parsed while switched off");expect(owner.around(pack,[[10,10,0]],20,false,signal)).toMatchObject({available:true,pois:[]});
  expect(owner.around(pack,[[1000,1000,0]],20,true,signal).slices).toEqual([]);
  writeFileSync(file,JSON.stringify(fixture()));const a=owner.around(pack,[[10,10,0]],20,true,signal),b=owner.around(pack,[[10,10,0]],20,true,signal);
  expect(a.pois[0]).toBe(b.pois[0]);expect(a.pois[0].variant).toBe("ServicePointRipperdocVariant");
  expect(owner.around(pack,[[90,90,0]],5,true,signal).pois).toEqual([]);
  const changed=fixture();changed.pois[0].kind="Medicine";writeFileSync(file,JSON.stringify(changed));expect(owner.around(pack,[[10,10,0]],20,true,signal).pois[0].kind).toBe("Medicine");
  unlinkSync(file);expect(owner.around(pack,[[10,10,0]],20,true,signal).available).toBe(false);
  const ctl=new AbortController();ctl.abort();expect(()=>owner.around(pack,[[0,0,0]],20,true,ctl.signal)).toThrow();
 }finally{owner.close();}
});

test("service demand and release keep shared content warm, including acquisition by a region read",async()=>{
 const f=writeFixture(),world=join(f.root,"world.json"),timers=new Map<()=>void,number>();let now=0;
 writeFileSync(world,JSON.stringify(pack));writeFileSync(join(f.root,"kabuki.content.json"),JSON.stringify(fixture()));
 const service=createService({recordingsRoot:f.root,worldPackPath:world,worldContentDir:f.root,solidSource:{around:async()=>emptySolids()},liveClock:{now:()=>now,later:(ms,fn)=>{timers.set(fn,now+ms);return()=>{timers.delete(fn);};}}}),signal=new AbortController().signal;
 const advance=(ms:number)=>{now+=ms;for(const [fn,at]of [...timers])if(at<=now){timers.delete(fn);fn();}};
 const demand=(consumer:string,wanted:boolean)=>service.handlers["world.content.demand"]({consumer,wanted},signal);
 const read=async(consumer:string)=>((await service.handlers["world.around"]({dir:f.dir,center:[10,10,0],margin:20,content:true,contentConsumer:consumer},signal)) as {content:{pois:unknown[]}}).content.pois[0];
 try{
  await demand("a",true);const first=await read("a");expect(first).toBeDefined();await read("b");await demand("a",false);
  advance(CONTENT_IDLE_MS*2);expect(await read("b")).toBe(first);
  await demand("b",false);advance(CONTENT_IDLE_MS);expect(await read("b")).not.toBe(first);
 }finally{service.close();f.dispose();}expect(timers.size).toBe(0);
});

test("parsed content evicts after the final demand's idle, stays warm for another consumer, and cancels eviction on reacquire",()=>{
 const dir=tempDir("holo-content-idle-"),file=join(dir,"kabuki.content.json"),timers=new Map<()=>void,number>();let now=0;
 const owner=worldContentFiles(dir,{later:(ms,fn)=>{timers.set(fn,now+ms);return()=>{timers.delete(fn);};}}),signal=new AbortController().signal;
 const advance=(ms:number)=>{now+=ms;for(const [fn,at]of [...timers])if(at<=now){timers.delete(fn);fn();}},read=()=>owner.around(pack,[[10,10,0]],20,true,signal).pois[0];
 try{
  writeFileSync(file,JSON.stringify(fixture()));owner.demand("a",true);owner.demand("b",true);const first=read();
  owner.demand("a",false);advance(CONTENT_IDLE_MS*2);expect(read()).toBe(first);expect(timers.size).toBe(0);
  owner.demand("b",false);advance(CONTENT_IDLE_MS-1);expect(read()).toBe(first);
  owner.demand("a",true);advance(CONTENT_IDLE_MS);expect(read()).toBe(first);expect(timers.size).toBe(0);
  owner.demand("a",false);advance(CONTENT_IDLE_MS);owner.demand("b",true);expect(read()).not.toBe(first);
  owner.demand("b",false);expect(timers.size).toBe(1);owner.close();expect(timers.size).toBe(0);
 }finally{owner.close();}
});
