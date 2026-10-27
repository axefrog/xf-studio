import {expect,test} from "bun:test";
import {join} from "node:path";
import {readFileSync,writeFileSync} from "node:fs";
import {tempDir} from "../../xf-studio/authoring/tests/temp-dir";
import {readWorldIndex,updateWorldIndex,validateWorldIndex} from "../src/world-content-index";
import {coverage,WORLD_CONTENT_READER,type WorldContent} from "../src/world-content";
const root={id:"Districts.Test",name:"Test",kind:"district" as const,poly:[[2,3],[8,3],[8,9]] as [number,number][],zlo:-4,zhi:20};
const content=(id:string):WorldContent=>({schema:"xfh/world-content-1",slice:{id,title:id,places:[root.id]},source:{game:"test",archives:"stamp",reader:WORLD_CONTENT_READER,key:"key",built:"first"},records:{},communities:[],spots:[],pois:[],spawners:[],counts:coverage()});
const signal=new AbortController().signal;
test("slice index builds, updates without duplicates, preserves other slices and lists without game configuration",()=>{
 const dir=tempDir("w1-index-"),a=content("test");expect(readWorldIndex(dir)).toBeUndefined();
 updateWorldIndex(dir,a,{roots:[root]},signal);updateWorldIndex(dir,content("other"),{roots:[root]},signal);
 a.source.built="second";const index=updateWorldIndex(dir,a,{roots:[root]},signal);
 expect(index.slices.map(s=>s.id)).toEqual(["other","test"]);expect(index.slices[1]).toEqual({id:"test",title:"test",places:[root.id],bounds:{min:[2,3,-4],max:[8,9,20]},file:"test.content.json",counts:{communities:0,spots:0,spawners:0,pois:0,records:0},bytes:Buffer.byteLength(JSON.stringify(a)),built:"second"});
 const listed=Bun.spawnSync([process.execPath,"tools/build-world-content.ts","--list","--out",dir],{cwd:join(import.meta.dir,"..")});
 expect(listed.exitCode).toBe(0);expect(JSON.parse(listed.stdout.toString())).toEqual(index);
 a.source.archives="new";expect(updateWorldIndex(dir,a,{roots:[root]},signal).slices.map(s=>s.id)).toEqual(["test"]);
 const before=readFileSync(join(dir,"index.json"),"utf8"),ctl=new AbortController();ctl.abort();expect(()=>updateWorldIndex(dir,a,{roots:[root]},ctl.signal)).toThrow();expect(readFileSync(join(dir,"index.json"),"utf8")).toBe(before);
});
test("catalogue validation refuses traversal, corrupt fields and reversed bounds",()=>{
 const dir=tempDir("w1-index-bad-"),index=updateWorldIndex(dir,content("test"),{roots:[root]},signal);
 for(const patch of [{file:"../test.content.json"},{counts:{records:-1}},{places:[null]},{bounds:{min:[9,0,0],max:[1,0,0]}}])expect(()=>validateWorldIndex({...index,slices:[{...index.slices[0],...patch}]})).toThrow();
 writeFileSync(join(dir,"index.json"),"{}");expect(()=>readWorldIndex(dir)).toThrow();
});
