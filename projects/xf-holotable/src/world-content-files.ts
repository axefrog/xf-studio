/** Read-demand owner for prepared content. No archive reads or generation on a view request. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { boxOf, region, type Box } from "./world.ts";
import type { Vec3, WorldPack } from "./model.ts";
import { CONTENT_FILE_CAP, WORLD_CONTENT_SLICES, type WorldContent } from "./world-content.ts";
import { validateContent } from "./world-content-validation.ts";

export const CONTENT_IDLE_MS = 30_000;
export function worldContentFiles(directory: string, clock = { later(ms:number, run:()=>void) { const timer=setTimeout(run,ms);timer.unref?.();return()=>clearTimeout(timer); } }) {
  const cache = new Map<string, { stamp: string; content: WorldContent }>();
  const consumers = new Set<string>();
  let stopIdle:(()=>void)|undefined;
  const idle = () => { if (!consumers.size && cache.size && !stopIdle) stopIdle=clock.later(CONTENT_IDLE_MS,()=>{stopIdle=undefined;cache.clear();}); };
  return {
    demand(consumer:string, wanted:boolean) {
      if(wanted){consumers.add(consumer);stopIdle?.();stopIdle=undefined;}
      else {consumers.delete(consumer);idle();}
    },
    around(pack: WorldPack | undefined, path: Vec3[], margin: number, wanted: boolean, signal: AbortSignal) {
      signal.throwIfAborted();
      const box: Box = boxOf(path), places = new Set(pack ? region(pack, box, margin).areas.map(a => a.id.toLowerCase()) : []);
      const slices = WORLD_CONTENT_SLICES.filter(s => places.has(s.place.toLowerCase()));
      const output = { available: false, slices: slices.map(s => s.id), communities: [] as WorldContent["communities"], spots: [] as WorldContent["spots"], pois: [] as WorldContent["pois"] };
      for (const slice of slices) {
        const file = join(directory, `${slice.id}.content.json`);
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
        output.communities.push(...ready.content.communities.filter(c => ids.has(c.id)));
      }
      return output;
    },
    close() { stopIdle?.();stopIdle=undefined;consumers.clear();cache.clear(); },
  };
}
