import {expect,test} from "bun:test";
import {join,dirname} from "node:path";
import {existsSync,readFileSync,writeFileSync,unlinkSync,utimesSync,statSync} from "node:fs";
import {tempDir} from "../../xf-studio/authoring/tests/temp-dir";
import {readWorldIndex,listWorldIndex,validateWorldIndex} from "../src/world-content-index";
import {createHash} from "node:crypto";
import {cachedWorldContent,prepareWorldContent,publishWorldContent} from "../src/world-content-publication";
import {acquireSetPublishLock} from "../src/set-publish-lock";
import {worldContentSourceFingerprint} from "../src/world-content-source";
import {coverage,WORLD_CONTENT_READER,type WorldContent} from "../src/world-content";
import {CONTENT_LIMITS} from "../src/world-content-budget";
import type {WorldPack} from "../src/model";
const root={id:"Districts.Test",name:"Test",kind:"district" as const,poly:[[2,3],[8,3],[8,9]] as [number,number][],zlo:-4,zhi:20};
const content=(id:string):WorldContent=>{const counts=coverage();for(const k of ["communities","spots","spawners","pois"]){counts.read[k]=counts.kept[k]=counts.dropped[k]=0;counts.reasons[k]={};}return {schema:"xfh/world-content-1",slice:{id,title:id,places:[root.id]},source:{game:"test",archives:"stamp",reader:WORLD_CONTENT_READER,key:"key",built:"first"},records:{},communities:[],spots:[],pois:[],spawners:[],counts};};
const signal=new AbortController().signal;
async function publish(dir:string,c:WorldContent,fingerprint="shared") {
 const file=join(dir,`${c.slice.id}.content.json`),key=createHash("sha256").update(JSON.stringify(c)+fingerprint).digest("hex"),candidate={...c,source:{...c.source,key}};
 await cachedWorldContent(file,key,async()=>candidate,signal,{fingerprint,slice:{roots:[root]}});return readWorldIndex(dir)!;
}
test("slice index builds, updates without duplicates, preserves other slices and lists without game configuration",async()=>{
 const dir=tempDir("w1-index-"),a=content("test");expect(readWorldIndex(dir)).toBeUndefined();
 await publish(dir,a);await publish(dir,content("other"));a.source.built="second";const index=await publish(dir,a);
 expect(index.slices.map(s=>s.id)).toEqual(["other","test"]);expect(index.slices[1]).toEqual({id:"test",title:"test",places:[root.id],bounds:{min:[2,3,-4],max:[8,9,20]},file:"test.content.json",counts:{communities:0,spots:0,spawners:0,pois:0,records:0},bytes:statSync(join(dir,"test.content.json")).size,built:"second"});
 const listed=Bun.spawnSync([process.execPath,"tools/build-world-content.ts","--list","--out",dir],{cwd:join(import.meta.dir,"..")});
 expect(listed.exitCode).toBe(0);expect(JSON.parse(listed.stdout.toString())).toEqual(index);
 a.source.archives="new";expect((await publish(dir,a)).slices.map(s=>s.id)).toEqual(["test"]);
 const before=readFileSync(join(dir,"index.json"),"utf8"),ctl=new AbortController();ctl.abort();await expect(cachedWorldContent(join(dir,"test.content.json"),a.source.key,async()=>a,ctl.signal,{fingerprint:"x",slice:{roots:[root]}})).rejects.toThrow();expect(readFileSync(join(dir,"index.json"),"utf8")).toBe(before);
});
test("catalogue validation uses the table's nested budget, including 50,001 records",async()=>{
 const dir=tempDir("w1-index-budget-"),large=content("test");large.records=Object.fromEntries(Array.from({length:50_001},(_,i)=>[String(i+1),{kind:"other" as const}]));const index=await publish(dir,large);expect(index.slices[0].counts.records).toBe(50_001);
 for(const count of [50_001,CONTENT_LIMITS.nested])expect(()=>validateWorldIndex({...index,slices:[{...index.slices[0],counts:{...index.slices[0].counts,records:count}}]})).not.toThrow();
 expect(()=>validateWorldIndex({...index,slices:[{...index.slices[0],counts:{...index.slices[0].counts,records:CONTENT_LIMITS.nested+1}}]})).toThrow();
 for(const patch of [{file:"../test.content.json"},{counts:{records:-1}},{places:[null]},{bounds:{min:[9,0,0],max:[1,0,0]}}])expect(()=>validateWorldIndex({...index,slices:[{...index.slices[0],...patch}]})).toThrow();
 writeFileSync(join(dir,"index.json"),"{}");expect(()=>readWorldIndex(dir)).toThrow();
});
test("every non-slice input invalidates other slices through the shared fingerprint",async()=>{
 const dir=tempDir("w1-index-inputs-"),pack:WorldPack={schema:"xfh/world-pack-1",provenance:{game:"test",source:"test",built:"test"},areas:[root],cells:[]};
 const archives=[{path:"game/localisation.archive",size:1,mtimeMs:1}],names=[{path:"tweakdb.bin",size:2,mtimeMs:2},{path:"one.tweak",size:3,mtimeMs:3}];
 const first=worldContentSourceFingerprint(archives,pack,WORLD_CONTENT_READER,names);
 const changed=[worldContentSourceFingerprint([{...archives[0],mtimeMs:2}],pack,WORLD_CONTENT_READER,names),worldContentSourceFingerprint(archives,pack,WORLD_CONTENT_READER,[{...names[0],size:4},names[1]]),worldContentSourceFingerprint(archives,pack,WORLD_CONTENT_READER,[names[0],{...names[1],mtimeMs:4}]),worldContentSourceFingerprint(archives,{...pack,areas:[{...root,zhi:21}]},WORLD_CONTENT_READER,names)];
 for(const fingerprint of changed){expect(fingerprint).not.toBe(first);await publish(dir,content("one"),first);await publish(dir,content("two"),first);expect(readWorldIndex(dir)!.slices).toHaveLength(2);await publish(dir,content("two"),fingerprint);expect(readWorldIndex(dir)!.slices.map(s=>s.id)).toEqual(["two"]);}
});
test("listing reports missing files and a later build prunes them while retaining present siblings",async()=>{
 const dir=tempDir("w1-index-delete-");await publish(dir,content("one"));await publish(dir,content("two"));unlinkSync(join(dir,"one.content.json"));
 expect(listWorldIndex(dir)).toMatchObject({slices:[{id:"two"}],missing:[{id:"one",file:"one.content.json",reason:"content file missing"}]});
 const listed=Bun.spawnSync([process.execPath,"tools/build-world-content.ts","--list","--out",dir],{cwd:join(import.meta.dir,"..")});expect(listed.exitCode).toBe(0);expect(JSON.parse(listed.stdout.toString()).missing[0].id).toBe("one");
 await publish(dir,content("three"));expect(readWorldIndex(dir)!.slices.map(s=>s.id)).toEqual(["three","two"]);
});
test("separate processes publish concurrent slices under the directory lock and recover an abandoned lock",async()=>{
 const dir=tempDir("w1-index-processes-"),lock=join(dir,".world-index.publish.lock"),past=new Date(Date.now()-60_000);writeFileSync(lock,"");utimesSync(lock,past,past);
 const release=await acquireSetPublishLock(lock,AbortSignal.timeout(3000));
 const children=["one","two"].map(id=>Bun.spawn([process.execPath,join(import.meta.dir,"fixtures/world-index-publisher.ts"),dir,id],{stdout:"pipe",stderr:"pipe"}));
 try {
  const deadline=performance.now()+3000;while(!["one","two"].every(id=>existsSync(join(dir,`${id}.ready`)))){if(performance.now()>deadline)throw Error("Publisher startup deadline.");await Bun.sleep(10);}
  expect(readWorldIndex(dir)).toBeUndefined();release();
  expect(await Promise.all(children.map(c=>c.exited))).toEqual([0,0]);expect(readWorldIndex(dir)!.slices.map(s=>s.id)).toEqual(["one","two"]);expect(existsSync(lock)).toBe(false);
 }finally{release();for(const child of children){if(child.exitCode===null)child.kill();await child.exited;}}
});

test("publication reuses cache-hit bytes without serialising the content again",async()=>{
 const dir=tempDir("w1-index-bytes-"),c=content("test"),file=join(dir,"test.content.json");writeFileSync(file,JSON.stringify(c));const bytes=statSync(file).size;
 const prepared=await prepareWorldContent(file,c.source.key,async()=>c,signal);
 Object.defineProperty(prepared.content,"toJSON",{value(){throw Error("Content must not be serialised for catalogue bytes.");}});
 await publishWorldContent(file,prepared,signal,{fingerprint:"shared",slice:{roots:[root]}});expect(readWorldIndex(dir)!.slices[0].bytes).toBe(bytes);
});

test("competing same-slice processes keep the newer file and its matching catalogue metadata",async()=>{
 const dir=tempDir("w1-same-slice-"),script=join(import.meta.dir,"fixtures/world-index-publisher.ts"),children:ReturnType<typeof Bun.spawn>[]=[];
 const a=Bun.spawn([process.execPath,script,dir,"same","A","wait","source-a"],{stdout:"pipe",stderr:"pipe"});children.push(a);
 try{
  const deadline=performance.now()+3000;while(!existsSync(join(dir,"A.ready"))){if(performance.now()>deadline)throw Error("First publisher preparation deadline.");await Bun.sleep(5);}
  // Preparation is complete, but neither the slice nor its catalogue may be published yet.
  expect(existsSync(join(dir,"same.content.json"))).toBe(false);expect(readWorldIndex(dir)).toBeUndefined();
  const b=Bun.spawn([process.execPath,script,dir,"same","B","","source-b"],{stdout:"pipe",stderr:"pipe"});children.push(b);expect(await b.exited).toBe(0);
  const file=join(dir,"same.content.json"),newerFile=readFileSync(file,"utf8"),newerIndex=readFileSync(join(dir,"index.json"),"utf8");
  expect(JSON.parse(newerFile).source.built).toBe("B");expect(readWorldIndex(dir)!.slices[0]).toMatchObject({built:"B",bounds:{max:[1,1,2]},counts:{records:1},bytes:Buffer.byteLength(newerFile)});
  writeFileSync(join(dir,"A.go"),"");expect(await a.exited).toBe(0);
  expect(JSON.parse(readFileSync(join(dir,"A.result.json"),"utf8"))).toMatchObject({built:"B",key:"B",cached:true,superseded:true});
  expect(readFileSync(file,"utf8")).toBe(newerFile);expect(readFileSync(join(dir,"index.json"),"utf8")).toBe(newerIndex);
 }finally{for(const child of children){if(child.exitCode===null)child.kill();await child.exited;}}
});
test("a cache hit revalidates under the lock and adopts a newer fingerprint without rewriting its index",async()=>{
 const dir=tempDir("w1-superseded-hit-"),file=join(dir,"test.content.json");await publish(dir,content("test"),"source-old");
 const old=JSON.parse(readFileSync(file,"utf8")) as WorldContent;
 const prepared=await prepareWorldContent(file,old.source.key,async()=>{throw Error("Expected a cache hit.");},signal,"source-old");expect(prepared.cached).toBe(true);
 const newer=content("test");newer.source.built="newer";newer.source.key="newer-key";newer.records={"123":{kind:"other"}};
 await cachedWorldContent(file,newer.source.key,async()=>newer,signal,{fingerprint:"source-new",slice:{roots:[{...root,zhi:99}]}});
 const bytes=readFileSync(file,"utf8"),index=readFileSync(join(dir,"index.json"),"utf8");
 const result=await publishWorldContent(file,prepared,signal,{fingerprint:"source-old",slice:{roots:[root]}});
 expect(result).toMatchObject({cached:true,superseded:true,content:{source:{built:"newer",key:"newer-key",fingerprint:"source-new"}}});
 expect(result.bytes).toBe(Buffer.byteLength(bytes));expect(readFileSync(file,"utf8")).toBe(bytes);expect(readFileSync(join(dir,"index.json"),"utf8")).toBe(index);expect(readWorldIndex(dir)!.slices[0].bounds.max[2]).toBe(99);
});
test("a deleted cache hit is not resurrected, and failed source validation publishes neither file",async()=>{
 const dir=tempDir("w1-publication-refusal-"),file=join(dir,"test.content.json");await publish(dir,content("test"));const old=JSON.parse(readFileSync(file,"utf8")) as WorldContent;
 const hit=await prepareWorldContent(file,old.source.key,async()=>old,signal,"shared");unlinkSync(file);
 await expect(publishWorldContent(file,hit,signal,{fingerprint:"shared",slice:{roots:[root]}})).rejects.toThrow("disappeared or became invalid");expect(existsSync(file)).toBe(false);
 const other=join(tempDir("w1-source-publication-"),"test.content.json"),c=content("test"),built=await prepareWorldContent(other,c.source.key,async()=>c,signal,"shared");
 await expect(publishWorldContent(other,built,signal,{fingerprint:"shared",slice:{roots:[root]},check(){throw Error("Inputs changed");}})).rejects.toThrow("Inputs changed");
 expect(existsSync(other)).toBe(false);expect(readWorldIndex(dirname(other))).toBeUndefined();
});
