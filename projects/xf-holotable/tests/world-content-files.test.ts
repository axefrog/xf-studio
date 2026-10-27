import { expect, test } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../xf-studio/authoring/tests/temp-dir";
import { worldContentFiles } from "../src/world-content-files";
import { ContentAssembler, WORLD_CONTENT_READER, selectSlice, type WorldContent } from "../src/world-content";
import type { WorldPack } from "../src/model";
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
