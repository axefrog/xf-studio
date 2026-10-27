/** Installed vanilla W1 adapter. One bounded CLI build owns its workers, cache and archive handles. */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { Cr2wFile } from "../../xf-studio/authoring/src/native/cr2w-file";
import { Cr2wDecoder } from "../../xf-studio/authoring/src/native/cr2w-reader";
import { NativeArchivePool } from "../../xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../xf-studio/authoring/src/native/oodle";
import { NativeBudgetError, NativeMalformedError, classifyNativeFailure } from "../../xf-studio/authoring/src/native/native-errors";
import { NATIVE_READER_VERSION } from "../../xf-studio/authoring/src/native/resource-document";
import { SECTOR_READER_VERSION, readStreamingSectorContent } from "../../xf-studio/authoring/src/native/streaming-sector";
import { depotHash } from "../../xf-studio/authoring/src/game/depot-path";
import { vanillaSources } from "./solid-source.ts";
import { createSectorCache, SectorWorkers, type SourceStamp } from "./sector-cache.ts";
import { CONTENT_SECTOR_VERSION, decodeContentSector, mapRegistryQuantities, list, object, reference, vector } from "./world-content-data.ts";
import { ContentAssembler, CONTENT_POLICY, WORLD_CONTENT_READER, boxOverlapsPlace, count, defaultPlacement, selectSlice, type WorldContent } from "./world-content.ts";
import { validateContent } from "./world-content-validation.ts";
export { validateContent } from "./world-content-validation.ts";
import { indexJournal, mapMappins, mapWorkspot, type JournalIndex } from "./world-content-resources.ts";
import type { WorldPack, Vec3 } from "./model.ts";
import { TextTable, gameTextPaths } from "../../xf-studio/authoring/src/game/game-text";
import { worldNameSources, worldRecordNames, checkWorldNameSources } from "./world-content-names.ts";
import { addWorldTexts, resolvePoiTitles } from "./world-content-titles.ts";
import { resolveContentRecords } from "./world-content-people.ts";
import { tweakDbOf } from "../../xf-studio/authoring/src/character/host/clothing-host";

import { cachedWorldContent } from "./world-content-publication.ts";
export { cachedWorldContent } from "./world-content-publication.ts";

const BASE="base\\worlds\\03_night_city\\_compiled\\default\\";
const BLOCKS=[BASE+"blocks\\all.streamingblock",BASE+"ep1\\blocks\\all.streamingblock"];
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function worldContentSourceFingerprint(sources:readonly SourceStamp[],pack:WorldPack,reader=WORLD_CONTENT_READER,names:readonly SourceStamp[]=[]) {
  return digest({sources,names,pack,reader,native:NATIVE_READER_VERSION,sector:SECTOR_READER_VERSION,contentSector:CONTENT_SECTOR_VERSION,policy:CONTENT_POLICY,publication:2,localisation:gameTextPaths("en-us",sources.some(s=>/[\\/]ep1[\\/]/.test(s.path)))});
}
export function worldContentCacheKey(sources:readonly SourceStamp[],pack:WorldPack,slice:string,reader=WORLD_CONTENT_READER,names:readonly SourceStamp[]=[]) {
  return digest({fingerprint:worldContentSourceFingerprint(sources,pack,reader,names),slice});
}
interface Descriptor { resource:string; min:Vec3; max:Vec3; ranges:number[]; source:number; level:number }
export async function buildWorldContent(options:{root:string;pack:WorldPack;slice:string;directory:string;signal:AbortSignal;now?:()=>string}) {
  const {root,pack,directory,signal}=options,slice=selectSlice(pack,options.slice),sources=vanillaSources(root),ep1=sources.some(s=>/[\\/]ep1[\\/]/.test(s.path));
  const names=worldNameSources(root,ep1),fingerprint=worldContentSourceFingerprint(sources,pack,WORLD_CONTENT_READER,names.sources),key=digest({fingerprint,slice:slice.id});
  const unchanged=()=>{for(const s of sources){const now=statSync(s.path);if(now.size!==s.size||now.mtimeMs!==s.mtimeMs)throw Error("Vanilla archives changed during the build; rerun.");}
    if(digest(vanillaSources(root))!==digest(sources))throw Error("Vanilla mount list changed during the build; rerun.");
    checkWorldNameSources(names);};
  const result=await cachedWorldContent(join(directory,`${slice.id}.content.json`),key,async()=>{
    const db=tweakDbOf(root,ep1);
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
      const registryResources:Descriptor[]=[];
      for(const d of descriptors) {
        signal.throwIfAborted();
        const sector=await cache.read({root,resource:d.resource,source:sources[d.source]},signal);
        if(sector.nodes.some(n=>n.type==="worldCommunityRegistryNode"&&!n.refusal))registryResources.push(d);
        out.addSector(depotHash(d.resource).toString(),sector,d.ranges);count(out.counts,"sectors");
      }
      // Native schedules are enriched only for admitted source ids. Reusing the full
      // registry's phases in every sector cache would exceed the existing nested cap.
      const wanted=out.registrySourceIds();
      if(wanted.size)for(const d of registryResources) {
        signal.throwIfAborted();
        const sector=readStreamingSectorContent(read(d.resource),oodle.decompress);
        for(const n of sector.nodes)if(n.type==="worldCommunityRegistryNode"&&n.object&&sector.placements.some((p,index)=>p.nodeIndex===n.nodeIndex&&defaultPlacement(index,sector,d.ranges))) {
          const rows=mapRegistryQuantities(n.object,wanted);
          for(const [index,p] of sector.placements.entries())if(p.nodeIndex===n.nodeIndex&&defaultPlacement(index,sector,d.ranges)) {
            const id=p.questPrefabRefHash!=="0"?p.questPrefabRefHash:`${depotHash(d.resource)}:${index}`;
            out.addRegistryQuantities(rows,id);
          }
        }
      }
      out.finishCommunities();
      const records=worldRecordNames(names.files);
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
      const texts=new TextTable("en-us");
      for(const path of gameTextPaths("en-us",ep1))if(owner(path)>=0)addWorldTexts(texts,decode(path),path);
      const recordTable=resolveContentRecords(out.communities,out.spawners,db?.blob??null,records,texts,out.counts,out.budget);
      for(const spot of out.spots) {count(out.counts,"spot.capacity","not stored in workspot data");count(out.counts,"spot.posture","not stored in workspot data");}
      resolvePoiTitles(out.pois,journal,db?.blob??null,texts,out.counts);
      for(const poi of out.pois)count(out.counts,"poi.record",poi.record?undefined:"linked record not stored");
      unchanged();signal.throwIfAborted();
      return {schema:"xfh/world-content-1",slice:{id:slice.id,title:slice.title,places:slice.places},
        source:{game:pack.provenance.game,archives:digest(sources),reader:WORLD_CONTENT_READER,built:(options.now??(()=>new Date().toISOString()))(),key},
        records:recordTable,communities:out.communities,spots:out.spots,spawners:out.spawners,pois:out.pois,counts:out.counts};
    } finally {try {await workers.shutdown();cache.trim();}finally{cache.end();pool.close();oodle.close();}}
  },signal,{slice,fingerprint,check:unchanged});
  return result;
}
