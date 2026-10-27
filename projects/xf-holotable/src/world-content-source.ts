/** Installed vanilla W1 adapter. One bounded CLI build owns its workers, cache and archive handles. */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Cr2wFile } from "../../xf-studio/authoring/src/native/cr2w-file";
import { Cr2wDecoder } from "../../xf-studio/authoring/src/native/cr2w-reader";
import { NativeArchivePool } from "../../xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../xf-studio/authoring/src/native/oodle";
import { NativeBudgetError, NativeMalformedError, classifyNativeFailure } from "../../xf-studio/authoring/src/native/native-errors";
import { NATIVE_READER_VERSION } from "../../xf-studio/authoring/src/native/resource-document";
import { SECTOR_READER_VERSION } from "../../xf-studio/authoring/src/native/streaming-sector";
import { depotHash } from "../../xf-studio/authoring/src/game/depot-path";
import { vanillaSources } from "./solid-source.ts";
import { createSectorCache, SectorWorkers, type SourceStamp } from "./sector-cache.ts";
import { CONTENT_SECTOR_VERSION, decodeContentSector, list, object, reference, vector } from "./world-content-data.ts";
import { ContentAssembler, CONTENT_FILE_CAP, CONTENT_CAP, CONTENT_POLICY, WORLD_CONTENT_READER, boxOverlapsPlace, checkCounts, count, selectSlice, type WorldContent } from "./world-content.ts";
import { indexJournal, mapMappins, mapWorkspot, type JournalIndex } from "./world-content-resources.ts";
import type { WorldPack, Vec3 } from "./model.ts";

const BASE="base\\worlds\\03_night_city\\_compiled\\default\\";
const BLOCKS=[BASE+"blocks\\all.streamingblock",BASE+"ep1\\blocks\\all.streamingblock"];
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function worldContentCacheKey(sources:readonly SourceStamp[],pack:WorldPack,slice:string,reader=WORLD_CONTENT_READER) {
  return digest({sources,pack,slice,reader,native:NATIVE_READER_VERSION,sector:SECTOR_READER_VERSION,contentSector:CONTENT_SECTOR_VERSION,policy:CONTENT_POLICY});
}
export function validateContent(content:WorldContent,key:string) {
  if(content?.schema!=="xfh/world-content-1"||content.source?.key!==key||content.source.reader!==WORLD_CONTENT_READER)throw new NativeMalformedError("Invalid world-content identity.");
  const collections=[content.communities,content.spots,content.spawners,content.pois];
  if(collections.some(c=>!Array.isArray(c))||collections.reduce((n,c)=>n+c.length,0)>CONTENT_CAP)throw new NativeBudgetError("Slice exceeds 50,000 records; use a smaller slice.");
  checkCounts(content.counts);
  for(const [name,rows] of [["communities",content.communities],["spots",content.spots],["spawners",content.spawners],["pois",content.pois]] as const) {
    if(content.counts.kept[name]!==rows.length)throw new NativeMalformedError("World-content collection count disagrees.");
    const ids=new Set<string>();for(const row of rows) {
      if(!row.id||!row.place||ids.has(row.id))throw new NativeMalformedError("Invalid world-content record identity.");ids.add(row.id);
      if("at" in row&&(!Array.isArray(row.at)||row.at.length!==3||!row.at.every(Number.isFinite)))throw new NativeMalformedError("Invalid world-content position.");
    }
  }
}
/** Probe the small assembled file before opening archive indexes. Damaged entries rebuild atomically. */
export async function cachedWorldContent(file:string,key:string,build:()=>Promise<WorldContent>,signal:AbortSignal) {
  signal.throwIfAborted();
  try {
    const size=statSync(file).size;
    if(size>0&&size<=CONTENT_FILE_CAP) {const content=JSON.parse(readFileSync(file,"utf8")) as WorldContent;validateContent(content,key);return {content,cached:true};}
  } catch { /* A miss, changed key or damaged file is regenerated. */ }
  const content=await build();signal.throwIfAborted();validateContent(content,key);
  const json=JSON.stringify(content);
  if(Buffer.byteLength(json)>CONTENT_FILE_CAP)throw new NativeBudgetError("Slice exceeds 32 MiB; use a smaller slice.");
  mkdirSync(dirname(file),{recursive:true});const tmp=join(dirname(file),`.${randomUUID()}.tmp`);
  try {writeFileSync(tmp,json,{flag:"wx"});signal.throwIfAborted();renameSync(tmp,file);}finally{rmSync(tmp,{force:true});}
  return {content,cached:false};
}
interface Descriptor { resource:string; min:Vec3; max:Vec3; ranges:number[]; source:number; level:number }
export async function buildWorldContent(options:{root:string;pack:WorldPack;slice:string;directory:string;signal:AbortSignal;now?:()=>string}) {
  const {root,pack,directory,signal}=options,slice=selectSlice(pack,options.slice),sources=vanillaSources(root),key=worldContentCacheKey(sources,pack,slice.id);
  const unchanged=()=>{for(const s of sources){const now=statSync(s.path);if(now.size!==s.size||now.mtimeMs!==s.mtimeMs)throw Error("Vanilla archives changed during the build; rerun.");}
    if(digest(vanillaSources(root))!==digest(sources))throw Error("Vanilla mount list changed during the build; rerun.");};
  const result=await cachedWorldContent(join(directory,`${slice.id}.content.json`),key,async()=>{
    const oodle=loadGameOodle(root),pool=new NativeArchivePool(oodle.decompress),workers=new SectorWorkers(1,"content");
    const cache=createSectorCache(join(directory,"sectors"),workers.read,{version:CONTENT_SECTOR_VERSION,decode:decodeContentSector});
    cache.begin();
    try {
      const archives=sources.map(s=>pool.get(s.path));
      const owner=(path:string)=>archives.findIndex(a=>a.has(depotHash(path)));
      const read=(path:string)=>{signal.throwIfAborted();const source=owner(path);if(source<0)throw Error(`Missing vanilla resource: ${path}.`);return pool.read(sources[source].path,depotHash(path))!;};
      const decode=(path:string)=>{const f=new Cr2wFile(read(path));return new Cr2wDecoder(f,oodle.decompress).exportObject(0);};
      const descriptors:Descriptor[]=[],seen=new Set<string>();
      for(const block of BLOCKS) {
        if(owner(block)<0&&block===BLOCKS[1])continue;
        const fields=decode(block).fields;
        for(const raw of list(fields.descriptors)) {
          const f=object(raw),bb=object(f.streamingBox),min=vector(bb.Min),max=vector(bb.Max),resource=reference(f.data);
          if(!min||!max||!resource)throw new NativeMalformedError("Incomplete content streaming descriptor.");
          if(!slice.roots.some(a=>boxOverlapsPlace(min,max,a))||seen.has(resource))continue;
          seen.add(resource);const source=owner(resource);if(source<0)throw Error("Selected vanilla sector is missing.");
          descriptors.push({resource,min,max,source,level:Number(f.level??0),ranges:[0,...list(f.variants).filter(v=>object(v).enabledByDefault).map(v=>Number(object(v).rangeIndex??0))]});
        }
      }
      if(descriptors.length>40_000)throw new NativeBudgetError("Too many sectors for a content slice.");
      descriptors.sort((a,b)=>a.level-b.level||a.resource.localeCompare(b.resource));
      const out=new ContentAssembler(pack,slice);
      for(const d of descriptors) {
        signal.throwIfAborted();
        const sector=await cache.read({root,resource:d.resource,source:sources[d.source]},signal);
        out.addSector(depotHash(d.resource).toString(),sector,d.ranges);count(out.counts,"sectors");
      }
      out.finishCommunities();
      const workspots=new Map<string,ReturnType<typeof mapWorkspot>|null>();
      for(const spot of out.spots) {
        const path=spot.workspot?.path;
        if(!path) {count(out.counts,"spot.workspot","resource not stored on AISpot");continue;}
        if(!workspots.has(path)) {
          signal.throwIfAborted();
          if(owner(path)<0) {workspots.set(path,null);count(out.counts,"workspots","resource not in vanilla archives");}
          else {
            try {const root=decode(path);if(root.type!=="workWorkspotResource")throw new NativeMalformedError("Expected a workspot resource.");
              workspots.set(path,mapWorkspot(root,path,out.counts));count(out.counts,"workspots");}
            catch(error) {const failure=classifyNativeFailure(error);if(failure==="internal")throw error;workspots.set(path,null);count(out.counts,"workspots",failure);}
          }
        }
        const detail=workspots.get(path);
        if(detail) {spot.workspot=detail;count(out.counts,"spot.workspot");}
        else {delete spot.workspot;count(out.counts,"spot.workspot","workspot resource unavailable");}
      }
      const journal:JournalIndex=new Map();
      for(const path of ["base\\journal\\cooked_journal.journal","ep1\\journal\\cooked_journal.journal"])if(owner(path)>=0)indexJournal(decode(path),journal);
      for(const ext of ["mappins","poimappins"]) {const path=BASE+"03_night_city."+ext;mapMappins(decode(path),depotHash(path).toString(),journal,out);}
      // These optional display fields have no proven direct source in the compiled pins.
      for(const poi of out.pois) {count(out.counts,"poi.title","localized title not resolved");count(out.counts,"poi.record",poi.record?undefined:"linked record not stored");}
      unchanged();signal.throwIfAborted();
      return {schema:"xfh/world-content-1",slice:{id:slice.id,title:slice.title,places:slice.places},
        source:{game:pack.provenance.game,archives:digest(sources),reader:WORLD_CONTENT_READER,built:(options.now??(()=>new Date().toISOString()))(),key},
        communities:out.communities,spots:out.spots,spawners:out.spawners,pois:out.pois,counts:out.counts};
    } finally {try {await workers.closeIdle();cache.trim();}finally{cache.end();pool.close();oodle.close();}}
  },signal);
  unchanged();return result;
}
