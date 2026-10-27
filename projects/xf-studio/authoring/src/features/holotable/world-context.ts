/** One owner for view-requested world regions. Leases debounce and supersede independently; identical reads share work. */
import type { HoloSolid, HoloWorld, HoloPoi, HoloSpot, HoloCommunity, Vec3 } from "./types";
export const CONTEXT_SOLID_CAP = 12000;
export type WorldContextLease = { want(position: Vec3, moved?: boolean): void; contentAvailable(): boolean|undefined };
type Source = { identity: string; params: Record<string,unknown> };
type Row = { stop?: () => void; ctl?: AbortController; source?: Source; position?: Vec3; world?: HoloWorld; cut?: number };
type Job = { ctl: AbortController; promise: Promise<HoloWorld>; waiters: number };
const empty = (): HoloWorld => ({provenance:null,areas:[],cells:[],solids:[]});
export function worldContexts(options: {
  source(): Source | undefined;
  load(params: Record<string,unknown>, signal: AbortSignal): Promise<HoloWorld>;
  later(ms:number, run:()=>void): ()=>void;
  changed(world:HoloWorld): void;
}, signal: AbortSignal) {
  const rows=new Set<Row>(),jobs=new Map<string,Job>();
  function cancel(row: Row){row.stop?.();row.stop=undefined;row.ctl?.abort();row.ctl=undefined;}
  function publish(){
    const ready=[...rows].filter(row=>row.world),union=new Map<string,HoloSolid>();
    // Round-robin unique solids: a large first view cannot consume another view's fair share.
    for(let i=0;union.size<CONTEXT_SOLID_CAP;i++){
      let any=false;
      for(const row of ready){const solid=row.world!.solids?.[i];if(!solid)continue;any=true;if(union.size<CONTEXT_SOLID_CAP)union.set(solid.id,union.get(solid.id)??solid);}
      if(!any)break;
    }
    const areas=new Map<string,HoloWorld["areas"][number]>(),cells=new Map<string,HoloWorld["cells"][number]>();
    const pois=new Map<string,HoloPoi>(),spots=new Map<string,HoloSpot>(),communities=new Map<string,HoloCommunity>(),slices=new Set<string>();let contentAvailable=false;
    let cut=0,omitted=0,available=false;
    for(const row of ready){
      const world=row.world!,kept=(world.solids??[]).filter(s=>union.has(s.id)).map(s=>union.get(s.id)!);
      row.cut=(row.cut??0)+(world.solids?.length??0)-kept.length;
      cut+=(world.solidInfo?.cut??0)+row.cut;
      omitted=Math.max(omitted,world.solidInfo?.omittedMeshShapes??0);available||=world.solidInfo?.available??false;
      // Retain only the capped union. Shared identities refer to the same object; released-only solids are collectible.
      row.world={...world,solids:kept};
      if(world.content){contentAvailable ||= world.content.available;for(const id of world.content.slices)slices.add(id);
        for(const item of world.content.pois)pois.set(item.id,item);for(const item of world.content.spots)spots.set(item.id,item);for(const item of world.content.communities)communities.set(item.id,item);}
      for(const area of world.areas)areas.set(area.id,area);
      for(const cell of world.cells)cells.set(JSON.stringify(cell),cell);
    }
    options.changed({...empty(),provenance:ready[0]?.world?.provenance??null,extent:ready[0]?.world?.extent,
      areas:[...areas.values()],cells:[...cells.values()],solids:[...union.values()],
      solidInfo:{available,omittedMeshShapes:omitted,cut,cap:CONTEXT_SOLID_CAP},content:{available:contentAvailable,slices:[...slices],pois:[...pois.values()],spots:[...spots.values()],communities:[...communities.values()]}});
  }
  async function read(source: Source, position: Vec3, signal: AbortSignal){
    const params={...source.params,center:position,margin:350},key=JSON.stringify([source.identity,source.params,position]);
    let job=jobs.get(key);
    if(!job){
      const ctl=new AbortController(),promise=options.load(params,ctl.signal);job={ctl,promise,waiters:0};jobs.set(key,job);
      const mine=job;void promise.finally(()=>{if(jobs.get(key)===mine)jobs.delete(key);}).catch(()=>{});
    }
    const mine=job;mine.waiters++;
    return new Promise<HoloWorld>((resolve,reject)=>{
      let done=false;
      const finish=(error?:unknown,world?:HoloWorld)=>{
        if(done)return;done=true;signal.removeEventListener("abort",abort);
        if(--mine.waiters===0&&signal.aborted){mine.ctl.abort();if(jobs.get(key)===mine)jobs.delete(key);}
        if(error)reject(error);else resolve(world!);
      };
      const abort=()=>finish(signal.reason??new DOMException("Cancelled","AbortError"));
      signal.addEventListener("abort",abort,{once:true});mine.promise.then(world=>finish(undefined,world),finish);if(signal.aborted)abort();
    });
  }
  function want(row:Row,position:Vec3,moved=false,force=false){
    const source=options.source();if(!source||signal.aborted||!rows.has(row))return;
    const same=row.source?.identity===source.identity;
    if(!force&&same&&row.position&&Math.hypot(...position.map((n,i)=>n-row.position![i]))<=(moved?0:150))return;
    cancel(row);row.source=source;row.position=[...position] as Vec3;
    const ctl=new AbortController();row.ctl=ctl;
    row.stop=options.later(250,()=>{
      row.stop=undefined;
      void read(source,row.position!,ctl.signal).then(world=>{
        if(!ctl.signal.aborted&&rows.has(row)&&options.source()?.identity===source.identity){row.ctl=undefined;row.world=world;row.cut=0;publish();}
      }).catch(()=>{
        if(row.ctl===ctl){row.ctl=undefined;if(!ctl.signal.aborted)row.source=undefined;}
        // Optional geometry retains the previous region; cancellation never publishes a stale answer.
      });
    });
  }
  function reset(){for(const row of rows){cancel(row);row.source=undefined;row.position=undefined;row.world=undefined;row.cut=0;}}
  signal.addEventListener("abort",()=>{reset();rows.clear();},{once:true});
  return {
    lease(lifetime:AbortSignal):WorldContextLease {
      const row:Row={};if(!signal.aborted&&!lifetime.aborted)rows.add(row);
      lifetime.addEventListener("abort",()=>{
        cancel(row);if(!rows.delete(row))return;publish();
        // A departing view frees its quota. Remaining views can recover their full selection from the shared sector cache.
        for(const other of rows)if(other.position&&other.world&&!other.ctl)want(other,other.position,false,true);
      },{once:true});
      return {want:(position,moved)=>want(row,position,moved),contentAvailable:()=>row.world?.content?.available};
    },
    reset,
    /** Live observations refresh only regions still wanted; a pan already pending keeps its own debounce. */
    refresh(force=false) { for (const row of rows) if (row.position && (force || !row.ctl)) want(row, row.position, false, true); },
    active:()=>rows.size>0,
  };
}
