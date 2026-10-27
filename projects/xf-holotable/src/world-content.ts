/** Pure W1 slice selection, joins and accounting. No I/O, UI or mutable game objects. */
import type { Area, Vec3, WorldPack } from "./model.ts";
import { footprint, inside } from "./world.ts";
import type { ContentNode, ContentPlacement, ContentSector, RegistryItem } from "./world-content-data.ts";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import { ContentBudget, stringBytes, type ContentUsage } from "./world-content-budget.ts";

// The four provisional Story Engine decisions live here; none is inferred by an adapter.
export const CONTENT_POLICY = Object.freeze({ files: "per-slice", workspots: "activity-and-tags", characters: "record-ids", variants: "defaults" });
export const WORLD_CONTENT_READER = "w1.5";
/** Prepared slices, shared by the reader and the demand-driven service. */
export const WORLD_CONTENT_SLICES = [{ id: "kabuki", place: "Districts.Kabuki" }] as const;
export const CONTENT_CAP = 50_000, CONTENT_FILE_CAP = 32 * 1024 * 1024;
export interface Affiliation { record:string; recordName?:string; title?:string }
export interface Community { id: string; place: string; name?: string; affiliation?:Affiliation; entries: { name: string; record?: string; recordName?: string; kind?:"person"|"vehicle"; displayName?:string; affiliation?:Affiliation; phases: { name: string; time?: [number, number]; spots: string[] }[] }[] }
export interface Spot { id: string; place: string; at: Vec3; yaw: number; workspot?: { path: string; activity?: string; tags: string[] }; communities: string[] }
export interface Spawner { id: string; place: string; at: Vec3; yaw: number; record: string; onStart?: boolean }
export interface Poi { id: string; place: string; at: Vec3; kind: string; variant?: string; title?: string; record?: string; journal?: string }
export interface Coverage { read: Record<string, number>; kept: Record<string, number>; dropped: Record<string, number>; reasons: Record<string, Record<string, number>> }
export interface WorldContent {
  schema: "xfh/world-content-1"; slice: { id: string; title: string; places: string[] };
  source: { game: string; archives: string; reader: string; built: string; key: string };
  communities: Community[]; spots: Spot[]; spawners: Spawner[]; pois: Poi[]; counts: Coverage;
}
export function coverage(): Coverage { return { read: {}, kept: {}, dropped: {}, reasons: {} }; }
export function count(c: Coverage, collection: string, reason?: string) {
  c.read[collection] = (c.read[collection] ?? 0) + 1;
  c.kept[collection] ??= 0; c.dropped[collection] ??= 0; c.reasons[collection] ??= {};
  if (reason) { c.dropped[collection]++; const r = c.reasons[collection]; r[reason] = (r[reason] ?? 0) + 1; }
  else c.kept[collection]++;
}
export function checkCounts(c: Coverage) {
  for (const key of Object.keys(c.read)) {
    const values=[c.read[key],c.kept[key],c.dropped[key],...Object.values(c.reasons[key]??{})];
    if(values.some(v=>!Number.isSafeInteger(v)||v<0)||!c.reasons[key]||c.read[key] !== c.kept[key] + c.dropped[key] || c.dropped[key] !== Object.values(c.reasons[key]).reduce((a, b) => a + b, 0))
      throw new NativeMalformedError(`Content counts do not balance: ${key}.`);
  }
}
function containsXY(a:Area,x:number,y:number):boolean {
  return inside(x,y,a.poly)||a.poly.some((p,i)=>{
    const q=a.poly[(i+1)%a.poly.length];
    return (q[0]-p[0])*(y-p[1])===(q[1]-p[1])*(x-p[0])&&x>=Math.min(p[0],q[0])&&x<=Math.max(p[0],q[0])&&y>=Math.min(p[1],q[1])&&y<=Math.max(p[1],q[1]);
  });
}
export function contains(a: Area, p: Vec3): boolean { return p[2] >= a.zlo && p[2] <= a.zhi && containsXY(a,p[0],p[1]); }
export function placeAt(areas: readonly Area[], p: Vec3): Area | undefined {
  return areas.filter(a => contains(a, p)).sort((a, b) => footprint(a.poly) - footprint(b.poly) || a.id.localeCompare(b.id))[0];
}
export function selectSlice(pack: WorldPack, id: string) {
  for(const a of pack.areas)if(!Array.isArray(a.poly)||a.poly.length<3||a.poly.length>100_000||!Number.isFinite(a.zlo)||!Number.isFinite(a.zhi)||a.zlo>a.zhi||a.poly.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new NativeMalformedError("Invalid world-pack place outline.");
  const place = WORLD_CONTENT_SLICES.find(slice=>slice.id===id.toLowerCase())?.place ?? `Districts.${id}`;
  const roots = pack.areas.filter(a => a.kind === "district" && a.id.toLowerCase() === place.toLowerCase());
  if (!roots.length) throw new NativeMalformedError(`No district outline for slice ${id}.`);
  const ids = new Set(roots.map(a => a.id));
  let changed = true;
  while (changed) { changed = false; for (const a of pack.areas) if (a.parent && ids.has(a.parent) && !ids.has(a.id)) { ids.add(a.id); changed = true; } }
  // Some venue records lack a parent; spatially contained venues still belong to the slice.
  for (const a of pack.areas) if (a.kind === "venue" && a.poly.every(([x,y]) => roots.some(r => a.zhi>=r.zlo&&a.zlo<=r.zhi&&containsXY(r,x,y)))) ids.add(a.id);
  return { id: id.toLowerCase(), title: roots[0].name, roots, places: [...ids].sort() };
}
const cross = (a: number[], b: number[], c: number[]) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function segments(a: number[], b: number[], c: number[], d: number[]) {
  const within = (p:number[],q:number[],r:number[]) => r[0]>=Math.min(p[0],q[0]) && r[0]<=Math.max(p[0],q[0]) && r[1]>=Math.min(p[1],q[1]) && r[1]<=Math.max(p[1],q[1]);
  const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);
  return x*y<0&&z*w<0 || x===0&&within(a,b,c) || y===0&&within(a,b,d) || z===0&&within(c,d,a) || w===0&&within(c,d,b);
}
export function boxOverlapsPlace(min: Vec3, max: Vec3, a: Area): boolean {
  if (max[2]<a.zlo || min[2]>a.zhi) return false;
  const box: [number,number][] = [[min[0],min[1]],[max[0],min[1]],[max[0],max[1]],[min[0],max[1]]];
  if (a.poly.some(([x,y])=>x>=min[0]&&x<=max[0]&&y>=min[1]&&y<=max[1]) || box.some(([x,y])=>inside(x,y,a.poly))) return true;
  return a.poly.some((p,i)=>box.some((q,j)=>segments(p,a.poly[(i+1)%a.poly.length],q,box[(j+1)%4])));
}
export function defaultPlacement(index: number, s: Pick<ContentSector,"variantIndices"|"persistentNodeIndex">, ranges: readonly number[]): boolean {
  let range=0; while (range+1<s.variantIndices.length && index>=s.variantIndices[range+1]) range++;
  return ranges.includes(range) || range===s.persistentNodeIndex;
}
export const placementId = (sectorHash: string, p: ContentPlacement) => p.ref !== "0" ? p.ref : `${sectorHash}:${p.index}`;
export function yaw(q: ContentPlacement["orientation"]): number {
  const [x,y,z,w]=q, norm=Math.hypot(...q); if(!Number.isFinite(norm)||norm<1e-8) throw new NativeMalformedError("Invalid content orientation.");
  // Degrees about world Z, matching registry AISpotPersistentData.yaw.
  return Math.atan2(2*(w*z+x*y),norm*norm-2*(y*y+z*z))*180/Math.PI;
}
// Unknown enum names are deliberately returned unchanged.
export const POI_KINDS: Readonly<Record<string,string>> = Object.freeze({
  FixerVariant:"Fixer", ServicePointRipperdocVariant:"Ripperdoc", ServicePointFoodVariant:"Food vendor", ServicePointBarVariant:"Bar",
  ServicePointClothesVariant:"Clothing", ServicePointGunsVariant:"Gun shop", ServicePointDropPointVariant:"Drop point", ServicePointMedsVariant:"Medicine",
  ServicePointJunkVariant:"Junk shop", ServicePointMeleeTrainerVariant:"Melee trainer", ServicePointNetTrainerVariant:"Netrunner trainer",
  ServicePointProstituteVariant:"Sex worker", ServicePointTechVariant:"Tech vendor", ServicePointCyberwareVariant:"Cyberware",
  Zzz14_ServicePointBlackMarketVariant:"Black market", ApartmentVariant:"Apartment", Zzz05_ApartmentToPurchaseVariant:"Apartment for sale",
  TarotVariant:"Tarot", DefaultQuestVariant:"Quest", ExclamationMarkVariant:"Quest marker", FastTravelVariant:"Fast travel",
  GangWatchVariant:"Gang activity", HiddenStashVariant:"Hidden stash", ResourceVariant:"Resources", OutpostVariant:"Outpost",
  HuntForPsychoVariant:"Cyberpsycho", ThieveryVariant:"Theft", RetrievingVariant:"Retrieval", SabotageVariant:"Sabotage",
  ClientInDistressVariant:"Client in distress", BountyHuntVariant:"Bounty hunt", Zzz01_CarForPurchaseVariant:"Car for sale",
  Zzz02_MotorcycleForPurchaseVariant:"Motorcycle for sale", Zzz09_CourierSandboxActivityVariant:"Courier activity", Zzz13_DogtownGateVariant:"Dogtown gate",
  Zzz18_RacingVariant:"Race", Zzz17_NCARTVariant:"Metro", SmugglersDenVariant:"Smuggler hideout",
});
export const poiKind = (variant: string) => Object.hasOwn(POI_KINDS,variant) ? POI_KINDS[variant] : variant;

export class ContentAssembler {
  readonly counts=coverage(); readonly communities:Community[]=[]; readonly spots:Spot[]=[]; readonly spawners:Spawner[]=[]; readonly pois:Poi[]=[];
  private registries = new Map<string,RegistryItem>(); private communitySources:{ row:Community; node:ContentNode; key:string }[]=[];
  private ids = new Set<string>();
  constructor(readonly pack:WorldPack, readonly slice:ReturnType<typeof selectSlice>, readonly budget=new ContentBudget()) {
    for(const c of ["communities","spots","spawners","pois","workspots","registries"]) { this.counts.read[c]=this.counts.kept[c]=this.counts.dropped[c]=0; this.counts.reasons[c]={}; }
  }
  private admit(collection:string,id:string,at:Vec3) {
    if(!at.every(Number.isFinite)) { count(this.counts,collection,"invalid position");return; }
    if(!this.slice.roots.some(a=>contains(a,at))) { count(this.counts,collection,"outside slice");return; }
    const place=placeAt(this.pack.areas,at);
    if(!place) {count(this.counts,collection,"no containing place");return;}
    const key=collection+":"+id;
    if(this.ids.has(key)) {count(this.counts,collection,"duplicate id");return;}
    if(this.ids.size>=CONTENT_CAP) throw new NativeBudgetError("Slice exceeds 50,000 records; use a smaller slice.");
    this.budget.charge({records:1,bytes:256+stringBytes(id)+stringBytes(place.id)});
    this.ids.add(key);count(this.counts,collection);return place.id;
  }
  addSector(hash:string,s:ContentSector,ranges:readonly number[]) {
    const nodes=new Map(s.nodes.map(n=>[n.nodeIndex,n]));
    for(const p of s.placements) {
      const n=nodes.get(p.nodeIndex); if(!n) throw new NativeMalformedError("Content placement lacks its node.");
      const collection=n.type==="worldCommunityRegistryNode"?"registries":n.type==="worldAISpotNode"?"spots":n.type==="worldPopulationSpawnerNode"?"spawners":"communities";
      if(!defaultPlacement(p.index,s,ranges)) {count(this.counts,collection,"inactive variant");continue;}
      if(n.refusal) {this.budget.charge({bytes:64+stringBytes(n.refusal)});count(this.counts,collection,n.refusal);continue;}
      if(collection==="registries") {
        for(const r of n.registry??[]) if(r.id&&!this.registries.has(r.id)) {
          this.budget.charge({nested:1,bytes:64+stringBytes(r.id)});
          for(const e of r.entries)this.budget.charge({nested:1,bytes:64+stringBytes(e.name)+stringBytes(e.record)});
          this.registries.set(r.id,r);
        }
        count(this.counts,collection);continue;
      }
      const id=placementId(hash,p);
      if(collection==="spawners"&&!n.record) {count(this.counts,collection,"missing objectRecordId");continue;}
      const place=this.admit(collection,id,p.at);if(!place)continue;
      if(collection==="spots") {this.budget.charge({bytes:stringBytes(n.workspot)});this.spots.push({id,place,at:p.at,yaw:yaw(p.orientation),communities:[],...(n.workspot?{workspot:{path:n.workspot,tags:[]}}:{})});}
      else if(collection==="spawners") {this.budget.charge({bytes:stringBytes(n.record)});count(this.counts,"spawner.onStart",n.onStart!==undefined?undefined:"spawnOnStart not stored");this.spawners.push({id,place,at:p.at,yaw:yaw(p.orientation),record:n.record!,...(n.onStart!==undefined?{onStart:n.onStart}:{})});}
      else {this.budget.charge({bytes:stringBytes(n.name)});const row:Community={id,place,name:n.name,entries:[]};this.communities.push(row);this.communitySources.push({row,node:n,key:`${hash}:${n.nodeIndex}`});}
    }
  }
  finishCommunities() {
    const spots=new Map(this.spots.map(s=>[s.id,s]));
    const expanded=new Map<string,{entries:Community["entries"];linked:Spot[];counts:Coverage;cost:ContentUsage}>();
    const expand=(node:ContentNode)=>{
      const before=this.budget.snapshot(),counts=coverage(),entries:Community["entries"]=[],linked=new Set<Spot>();
      const registry=node.sourceId?this.registries.get(node.sourceId):undefined;
      for(const e of node.entries??[]) {
        if(!e.name) {count(counts,"community.entries","missing entryName");continue;}
        const record=registry?.entries.find(r=>r.name===e.name)?.record;
        this.budget.charge({nested:1,bytes:64+stringBytes(e.name)+stringBytes(record)});
        count(counts,"community.record",record?undefined:"registry record unavailable");
        const phases:Community["entries"][number]["phases"]=[];
        for(const p of e.phases) {
          if(!p.name) {count(counts,"community.phases","missing entryPhaseName");continue;}
          this.budget.charge({nested:1,bytes:64+stringBytes(p.name)});
          // The format has one phase interval; compiled periods do not supply a verified end.
          count(counts,"community.time","compiled period end not verified");
          const ids:string[]=[],seen=new Set<string>();
          for(const t of p.periods)for(const id of t.spots) {
            if(seen.has(id))continue;
            this.budget.charge({links:1,bytes:48+stringBytes(id)});seen.add(id);
            const spot=spots.get(id);count(counts,"community.spotLinks",spot?undefined:"spot outside slice, inactive or unavailable");
            if(spot) {ids.push(id);if(!linked.has(spot)){this.budget.charge({bytes:32});linked.add(spot);}}
          }
          phases.push({name:p.name,spots:ids});count(counts,"community.phases");
        }
        entries.push({name:e.name,...(record?{record}:{}),phases});count(counts,"community.entries");
      }
      const after=this.budget.snapshot(),cost={records:0,nested:after.nested-before.nested,links:after.links-before.links,bytes:after.bytes-before.bytes};
      return {entries,linked:[...linked],counts,cost};
    };
    for(const {row,node,key} of this.communitySources) {
      let data=expanded.get(key);
      if(!data){data=expand(node);expanded.set(key,data);}
      else this.budget.charge(data.cost); // Shared in memory, but every serialized placement still consumes the output budget.
      row.entries=data.entries;
      count(this.counts,"community.area","not stored by communityArea (spot bindings only)");
      for(const key of Object.keys(data.counts.read)) {
        for(const field of ["read","kept","dropped"] as const)this.counts[field][key]=(this.counts[field][key]??0)+data.counts[field][key];
        const reasons=this.counts.reasons[key]??={};
        for(const [reason,n] of Object.entries(data.counts.reasons[key]))reasons[reason]=(reasons[reason]??0)+n;
      }
      // Each admitted community id is unique and linked is a set, so no quadratic membership scan is needed.
      for(const spot of data.linked) {
        this.budget.charge({links:1,bytes:8+stringBytes(row.id)});spot.communities.push(row.id);
      }
    }
    this.communitySources=[];
  }
  addPoi(p: Omit<Poi,"place"|"kind"> & {variant?:string}) {
    if(!p.variant) {count(this.counts,"pois","journal variant unavailable");return;}
    const place=this.admit("pois",p.id,p.at);if(!place)return;
    this.budget.charge({bytes:stringBytes(p.variant)+stringBytes(poiKind(p.variant))+stringBytes(p.title)+stringBytes(p.record)+stringBytes(p.journal)});
    const {variant,...row}=p;this.pois.push({...row,variant,place,kind:poiKind(variant)});
  }
}
