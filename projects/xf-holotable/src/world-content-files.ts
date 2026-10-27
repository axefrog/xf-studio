/** Read-demand owner for prepared content. No archive reads or generation on a view request. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readWorldIndex } from "./world-content-index.ts";
import { boxOf, region, type Box } from "./world.ts";
import type { Vec3, WorldPack } from "./model.ts";
import { CONTENT_FILE_CAP, type WorldContent } from "./world-content.ts";
import { NativeBudgetError } from "../../xf-studio/authoring/src/native/native-errors";
import { validateContent } from "./world-content-validation.ts";

export const CONTENT_IDLE_MS = 30_000;
export const CONTENT_RENEW_MS = 5_000;
export const CONTENT_LEASE_MS = 2 * CONTENT_RENEW_MS;
export const CONTENT_PARSED_CACHE_CAP=256*1024*1024;
/** Conservative heap estimate, including parsed nodes, strings and bookkeeping; reserved before JSON.parse. */
export const estimatedContentBytes=(fileBytes:number)=>32*fileBytes+64*1024;
export function worldContentFiles(directory: string, clock = { now:()=>performance.now(),later(ms:number, run:()=>void) { const timer=setTimeout(run,ms);timer.unref?.();return()=>clearTimeout(timer); } }, options:{maxParsedBytes?:number}={}) {
  const limit=options.maxParsedBytes??CONTENT_PARSED_CACHE_CAP;
  if(!Number.isSafeInteger(limit)||limit<=0)throw Error("Invalid parsed-content cache budget.");
  const cache = new Map<string, { stamp: string; content: WorldContent; bytes:number }>();
  const consumers = new Map<string,{until:number;files:Set<string>}>();
  let cachedBytes=0;
  const forget=(file:string)=>{const row=cache.get(file);if(row){cachedBytes-=row.bytes;cache.delete(file);}};
  const clear=()=>{cache.clear();cachedBytes=0;};
  let stopIdle:(()=>void)|undefined,stopExpiry:(()=>void)|undefined;
  const idle = () => { if (!consumers.size && cache.size && !stopIdle) stopIdle=clock.later(CONTENT_IDLE_MS,()=>{stopIdle=undefined;clear();}); };
  // One expiry timer for this owner, independent of the number of views/consumers.
  function expire(){
    stopExpiry?.();stopExpiry=undefined;
    const now=clock.now();let next=Infinity;
    for(const [id,row]of consumers){if(row.until<=now)consumers.delete(id);else next=Math.min(next,row.until);}
    if(next!==Infinity)stopExpiry=clock.later(next-now,expire);
    idle();
  }
  return {
    demand(consumer:string, wanted:boolean) {
      if(wanted){consumers.set(consumer,{until:clock.now()+CONTENT_LEASE_MS,files:consumers.get(consumer)?.files??new Set()});stopIdle?.();stopIdle=undefined;}
      else consumers.delete(consumer);
      expire();
    },
    around(pack: WorldPack | undefined, path: Vec3[], margin: number, wanted: boolean, signal: AbortSignal, consumer?:string) {
      signal.throwIfAborted();expire();
      const box: Box = boxOf(path), places = new Set(pack ? region(pack, box, margin).areas.map(a => a.id.toLowerCase()) : []);
      const slices = (readWorldIndex(directory)?.slices??[]).filter(s => s.places.some(p=>places.has(p.toLowerCase())));
      const output = { available: false, slices: slices.map(s => s.id), records: Object.create(null) as WorldContent["records"], communities: [] as WorldContent["communities"], spots: [] as WorldContent["spots"], pois: [] as WorldContent["pois"] };
      const requested:{slice:typeof slices[number];file:string;stamp:string;bytes:number;fileBytes:number}[]=[];
      for(const slice of slices){
        const file=join(directory,slice.file);
        try{const st=statSync(file);if(st.size>CONTENT_FILE_CAP)throw Error("World content exceeds 32 MiB.");
          requested.push({slice,file,stamp:`${st.size}:${st.mtimeMs}:${st.ctimeMs}`,bytes:estimatedContentBytes(st.size),fileBytes:st.size});
        }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;forget(file);}
      }
      output.available=requested.length>0;if(!wanted)return output;
      // Reserve the whole view before parsing any slice. A refused view cannot leave a partial answer.
      if(requested.reduce((n,s)=>n+s.bytes,0)>limit)throw new NativeBudgetError("This view's world-content slices exceed the total parsed-content cache budget; request a smaller region.");
      const protectedFiles=new Set(requested.map(s=>s.file));
      for(const [id,row]of consumers)if(id!==consumer)for(const file of row.files)protectedFiles.add(file);
      for(const s of requested)if(cache.get(s.file)?.stamp!==s.stamp)forget(s.file);
      let needed=requested.reduce((n,s)=>n+(cache.has(s.file)?0:s.bytes),0);
      for(const file of cache.keys()){if(cachedBytes+needed<=limit)break;if(!protectedFiles.has(file))forget(file);}
      if(cachedBytes+needed>limit)throw new NativeBudgetError("Active consumers claim the total parsed-content cache budget; release content demand or request fewer slices.");
      for (const {slice,file,stamp,bytes,fileBytes} of requested) {
        signal.throwIfAborted();let ready=cache.get(file);
        if(!ready){
          const json=readFileSync(file,"utf8");if(Buffer.byteLength(json)!==fileBytes)throw Error("Prepared content changed size during the read; retry.");
          const value=JSON.parse(json);validateContent(value,value?.source?.key);
          if(value.slice.id!==slice.id)throw Error("World-content slice disagrees with its file.");
          ready={stamp,content:value,bytes};cachedBytes+=bytes;needed-=bytes;
        }
        // Map insertion order is LRU order; claimed slices are protected from pressure eviction.
        cache.delete(file);cache.set(file,ready);idle();
        const near = (at: Vec3) => at[0] >= box.min[0]-margin && at[0] <= box.max[0]+margin && at[1] >= box.min[1]-margin && at[1] <= box.max[1]+margin;
        const spots = ready.content.spots.filter(s => near(s.at)), ids = new Set(spots.flatMap(s => s.communities));
        output.spots.push(...spots); output.pois.push(...ready.content.pois.filter(p => near(p.at)));
        const communities=ready.content.communities.filter(c => ids.has(c.id));output.communities.push(...communities);
        for(const c of communities)for(const e of c.entries)if(e.record)output.records[e.record]=ready.content.records[e.record];
      }
      const claim=consumer?consumers.get(consumer):undefined;if(claim)claim.files=new Set(requested.map(s=>s.file));
      return output;
    },
    usage(){return {estimatedParsedBytes:cachedBytes,limit,files:[...cache.keys()]};},
    close() { stopIdle?.();stopExpiry?.();stopIdle=stopExpiry=undefined;consumers.clear();clear(); },
  };
}
