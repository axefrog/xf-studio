/** Read-demand owner for prepared content. No archive reads or generation on a view request. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readWorldIndex } from "./world-content-index.ts";
import { boxOf, region, type Box } from "./world.ts";
import type { Vec3, WorldPack } from "./model.ts";
import { CONTENT_FILE_CAP, type WorldContent } from "./world-content.ts";
import { validateContent } from "./world-content-validation.ts";

export const CONTENT_IDLE_MS = 30_000;
export const CONTENT_RENEW_MS = 5_000;
export const CONTENT_LEASE_MS = 2 * CONTENT_RENEW_MS;
export function worldContentFiles(directory: string, clock = { now:()=>performance.now(),later(ms:number, run:()=>void) { const timer=setTimeout(run,ms);timer.unref?.();return()=>clearTimeout(timer); } }) {
  const cache = new Map<string, { stamp: string; content: WorldContent }>();
  const consumers = new Map<string,number>();
  let stopIdle:(()=>void)|undefined,stopExpiry:(()=>void)|undefined;
  const idle = () => { if (!consumers.size && cache.size && !stopIdle) stopIdle=clock.later(CONTENT_IDLE_MS,()=>{stopIdle=undefined;cache.clear();}); };
  // One expiry timer for this owner, independent of the number of views/consumers.
  function expire(){
    stopExpiry?.();stopExpiry=undefined;
    const now=clock.now();let next=Infinity;
    for(const [id,until]of consumers){if(until<=now)consumers.delete(id);else next=Math.min(next,until);}
    if(next!==Infinity)stopExpiry=clock.later(next-now,expire);
    idle();
  }
  return {
    demand(consumer:string, wanted:boolean) {
      if(wanted){consumers.set(consumer,clock.now()+CONTENT_LEASE_MS);stopIdle?.();stopIdle=undefined;}
      else consumers.delete(consumer);
      expire();
    },
    around(pack: WorldPack | undefined, path: Vec3[], margin: number, wanted: boolean, signal: AbortSignal) {
      signal.throwIfAborted();
      const box: Box = boxOf(path), places = new Set(pack ? region(pack, box, margin).areas.map(a => a.id.toLowerCase()) : []);
      const slices = (readWorldIndex(directory)?.slices??[]).filter(s => s.places.some(p=>places.has(p.toLowerCase())));
      const output = { available: false, slices: slices.map(s => s.id), records: Object.create(null) as WorldContent["records"], communities: [] as WorldContent["communities"], spots: [] as WorldContent["spots"], pois: [] as WorldContent["pois"] };
      for (const slice of slices) {
        const file = join(directory, slice.file);
        let stamp: string;
        try { const st = statSync(file); if (st.size > CONTENT_FILE_CAP) throw Error("World content exceeds 32 MiB."); stamp = `${st.size}:${st.mtimeMs}:${st.ctimeMs}`; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { cache.delete(file); continue; } throw error; }
        output.available = true;
        if (!wanted) continue;
        let ready = cache.get(file);
        if (ready?.stamp !== stamp) {
          const value = JSON.parse(readFileSync(file, "utf8"));
          validateContent(value, value?.source?.key);
          if (value.slice.id !== slice.id) throw Error("World-content slice disagrees with its file.");
          ready = { stamp, content: value }; cache.set(file, ready);idle();
        }
        signal.throwIfAborted();
        const near = (at: Vec3) => at[0] >= box.min[0]-margin && at[0] <= box.max[0]+margin && at[1] >= box.min[1]-margin && at[1] <= box.max[1]+margin;
        const spots = ready.content.spots.filter(s => near(s.at)), ids = new Set(spots.flatMap(s => s.communities));
        output.spots.push(...spots); output.pois.push(...ready.content.pois.filter(p => near(p.at)));
        const communities=ready.content.communities.filter(c => ids.has(c.id));
        output.communities.push(...communities);
        for(const c of communities)for(const e of c.entries)if(e.record)output.records[e.record]=ready.content.records[e.record];
      }
      return output;
    },
    close() { stopIdle?.();stopExpiry?.();stopIdle=stopExpiry=undefined;consumers.clear();cache.clear(); },
  };
}
