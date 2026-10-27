/** Static world content projected into the existing marker/cluster vocabulary. No timeline or effects. */
import type { HoloContent, HoloPoi, Vec3 } from "../types";
import type { AgentItem } from "../agent-types";
import type { camera } from "./projection";

export const SPOT_DOT_CAP = 2000;
export const POI_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  Ripperdoc: "clinic", Medicine: "clinic", Cyberware: "clinic", "Food vendor": "market", Bar: "market", Clothing: "market",
  "Gun shop": "market", "Junk shop": "market", "Tech vendor": "market", "Black market": "market",
  Apartment: "refuge", "Apartment for sale": "refuge", "Hidden stash": "hideout", "Smuggler hideout": "hideout",
  "Gang activity": "hazard", Cyberpsycho: "hazard", Outpost: "hazard",
  Fixer:"place", "Drop point":"place", "Melee trainer":"place", "Netrunner trainer":"place", "Sex worker":"place",
  Tarot:"place", Quest:"place", "Quest marker":"place", "Fast travel":"place", Resources:"place", Theft:"place",
  Retrieval:"place", Sabotage:"place", "Client in distress":"place", "Bounty hunt":"place", "Car for sale":"place",
  "Motorcycle for sale":"place", "Courier activity":"place", "Dogtown gate":"place", Race:"place", Metro:"place",
});
export const poiTitle = (p: HoloPoi) => Object.hasOwn(POI_GLYPHS,p.kind) ? p.kind : "Place";
export const poiGlyph = (p: HoloPoi) => Object.hasOwn(POI_GLYPHS,p.kind) ? POI_GLYPHS[p.kind] : "place";
export const readable = (s: string) => { const text=s.replace(/[-_]+/g," ").trim();return text ? text[0].toUpperCase()+text.slice(1) : text; };
export const communityOpacity = (distance: number) => Math.max(0, Math.min(1, (distance-100)/100));
const AFFILIATION_TITLES:Readonly<Record<string,string>>=Object.freeze({"No Affiliation":"Unaffiliated"});
const affiliationTitle = (title:string) => Object.hasOwn(AFFILIATION_TITLES,title)?AFFILIATION_TITLES[title]:title;
const communityLabel = (c:HoloContent["communities"][number],n:number) => `${c.affiliation?.title?affiliationTitle(c.affiliation.title):"Community"} · ${n} ${n===1?"spot":"spots"}`;
export type BaseSwitches = Readonly<{ pois: boolean; spots: boolean; communities: boolean }>;
const marker = (type: "pois"|"spots"|"communities", id: string, at: Vec3, label: string): AgentItem => ({
  id, key:`base:${type}:${id}`, base:type, kind:type==="communities"?"label":"point", anchor:{at}, place:at, label, tone:"muted",
});
const communityOrders=new WeakMap<HoloContent,readonly HoloContent["communities"][number][]>();
/** Stable source-size order belongs to a content response, not to a camera frame. */
function* communityOrder(content:HoloContent):Generator<void,readonly HoloContent["communities"][number][]> {
  const cached=communityOrders.get(content);if(cached)return cached;
  let work=0,rows:{community:HoloContent["communities"][number];size:number}[]=[];
  for(const community of content.communities){
    if(work++%64===0)yield;const ids=new Set<string>();
    for(const entry of community.entries){if(work++%64===0)yield;for(const phase of entry.phases){if(work++%64===0)yield;for(const id of phase.spots){if(work++%64===0)yield;ids.add(id);}}}
    rows.push({community,size:ids.size});
  }
  // Cooperative merge sort also bounds the first load's uninterrupted work.
  for(let span=1;span<rows.length;span*=2){
    const next:typeof rows=[];
    for(let start=0;start<rows.length;start+=2*span){
      const mid=Math.min(start+span,rows.length),end=Math.min(start+2*span,rows.length);let a=start,b=mid;
      while(a<mid||b<end){if(work++%64===0)yield;
        const left=rows[a],right=rows[b];
        if(b>=end||a<mid&&(left.size>right.size||left.size===right.size&&left.community.id.localeCompare(right.community.id)<=0))next.push(rows[a++]);else next.push(rows[b++]);
      }
    }
    rows=next;
  }
  const ordered:HoloContent["communities"][number][]=[];for(const row of rows){if(work++%64===0)yield;ordered.push(row.community);}communityOrders.set(content,ordered);return ordered;
}
/** Every source traversal and initial community ordering yields after 64 records. */
export function* baseLayerSteps(content: HoloContent | undefined, on: BaseSwitches, C?: ReturnType<typeof camera>): Generator<void, AgentItem[]> {
  if(!content)return [];
  let work=0;const items:AgentItem[]=[],spots:typeof content.spots[number][]=[];
  const visible=(at:Vec3)=>{if(!C)return true;const p=C.point(at);return !!p&&Math.hypot(at[0]-C.target[0],at[1]-C.target[1],at[2]-C.target[2])<=350&&p[0]>=0&&p[0]<=C.width&&p[1]>=0&&p[1]<=C.height;};
  if(on.pois)for(const p of content.pois){if(work++%64===0)yield;if(visible(p.at))items.push({...marker("pois",p.id,p.at,poiTitle(p)),glyph:poiGlyph(p),tone:"signal"});}
  if(on.spots||on.communities)for(const s of content.spots){if(work++%64===0)yield;if(visible(s.at))spots.push(s);}
  if(on.spots){
    const center=C?.target??[0,0,0],distance=(at:Vec3)=>(at[0]-center[0])**2+(at[1]-center[1])**2+(at[2]-center[2])**2;
    // Max heap keeps the nearest 2,000 without an unyielding sort of the whole source.
    const heap:{spot:typeof spots[number];distance:number}[]=[],compare=(a:typeof heap[number],b:typeof heap[number])=>a.distance-b.distance||a.spot.id.localeCompare(b.spot.id);
    for(const spot of spots){
      if(work++%64===0)yield;const row={spot,distance:distance(spot.at)};
      if(heap.length<SPOT_DOT_CAP){heap.push(row);let i=heap.length-1;while(i){const parent=(i-1)>>1;if(compare(heap[parent],heap[i])>=0)break;[heap[parent],heap[i]]=[heap[i],heap[parent]];i=parent;}}
      else if(compare(row,heap[0])<0){heap[0]=row;let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&compare(heap[child+1],heap[child])>0)child++;if(compare(heap[i],heap[child])>=0)break;[heap[i],heap[child]]=[heap[child],heap[i]];i=child;}}
    }
    heap.sort(compare);
    for(const {spot:s} of heap){if(work++%64===0)yield;items.push(marker("spots",s.id,s.at,""));}
  }
  if(on.communities){
    const alpha=C?communityOpacity(Math.hypot(...C.position.map((n,i)=>n-C.target[i]))):1;
      const sums=new Map<string,{at:[number,number,number];n:number}>();
      for(const s of spots){if(work++%64===0)yield;for(const id of s.communities){if(work++%64===0)yield;const sum=sums.get(id)??{at:[0,0,0],n:0};sum.n++;for(let i=0;i<3;i++)sum.at[i]+=s.at[i];sums.set(id,sum);}}
      // Keep presence independent of label opacity: the Show count includes close communities.
      for(const c of yield* communityOrder(content)){if(work++%64===0)yield;const sum=sums.get(c.id);if(sum)items.push({...marker("communities",c.id,sum.at.map(n=>n/sum.n) as [number,number,number],communityLabel(c,sum.n)),opacity:alpha,communitySpots:sum.n});}
  }
  return items;
}
export function baseLayerItems(content:HoloContent|undefined,on:BaseSwitches,C?:ReturnType<typeof camera>) { const steps=baseLayerSteps(content,on,C);let step=steps.next();while(!step.done)step=steps.next();return step.value; }

/** Explicit selection/focus is independent of the drawing cap and the camera. */
export function baseItem(content:HoloContent|undefined,key:string):AgentItem|undefined {
  if(!content)return;
  const p=content.pois.find(p=>`base:pois:${p.id}`===key);
  if(p)return {...marker("pois",p.id,p.at,poiTitle(p)),glyph:poiGlyph(p),tone:"signal"};
  const s=content.spots.find(s=>`base:spots:${s.id}`===key);
  if(s)return marker("spots",s.id,s.at,"");
  const c=content.communities.find(c=>`base:communities:${c.id}`===key);
  if(c){const spots=content.spots.filter(s=>s.communities.includes(c.id));if(!spots.length)return;
    return {...marker("communities",c.id,[0,1,2].map(axis=>spots.reduce((sum,s)=>sum+s.at[axis],0)/spots.length) as [number,number,number],communityLabel(c,spots.length)),communitySpots:spots.length};}
}

export interface BaseCard { title:string; summary:string; when?:string; involved:{key:string;label:string}[]; more:number; furtherAway:number; technical:[string,string][] }
/** Verified district/content prefixes in Kabuki's record census; never strip role/person words. */
const COMMUNITY_TECHNICAL_PREFIXES=new Set([
  "arr","cpz","gle","kab","lch","wat", // district codes
  "cs","mws","ow","sa","sts", // content codes
  "q000","q001","q004","q105","q305","mq019","mq024","mq025","mq026","mq028","mq038","mq057","sq017",
]);
/** Counts come from compiled record types. Name cleanup is display-only fallback. */
export function communityTypes(entries:HoloContent["communities"][number]["entries"]):string {
  if(!entries.length)return "No entries";
  const people=entries.filter(e=>e.kind==="person"),vehicles=entries.filter(e=>e.kind==="vehicle").length,unknown=entries.length-people.length-vehicles;
  const unique=new Map(people.map(e=>[e.record??e.name,e]));
  const labelsOf=[...unique.values()],tails=labelsOf.map(e=>e.recordName?.split(".").at(-1)??"");
  const vocabulary=new Map<string,string>();
  for(const e of people)for(const token of e.affiliation?.title?.match(/[\p{L}\p{N}]+/gu)??[])if(/^[A-Z]{2,}$|[a-z][A-Z]/.test(token))vocabulary.set(token.toLowerCase(),token);
  const labels=tails.map((t,i)=>{
    if(labelsOf[i].displayName)return labelsOf[i].displayName!;
    const tokens=t.split(/[_-]+/).filter(Boolean);
    if(tokens.length>1&&/^(ma|wa|mb|wb|fa|fb|mc|wc)$/i.test(tokens.at(-1)!))tokens.pop();
    if(tokens.length>1&&COMMUNITY_TECHNICAL_PREFIXES.has(tokens[0].toLowerCase()))tokens.shift();
    const words=tokens.join(" ").replace(/(\p{L})\d+\b/gu,"$1").trim().toLowerCase();
    if(!words)return "Unnamed person type";
    return words.split(" ").map((word,i)=>vocabulary.get(word)??(i===0?word[0].toUpperCase()+word.slice(1):word)).join(" ");
  });
  const distinct=[...new Set(labels)],shown=distinct.slice(0,4),more=distinct.length-shown.length;
  if(more)shown.push(`+${more} more`);
  const counts=[...(unique.size?[unique.size===1?"1 type of person":`${unique.size} types of people`]:[]),...(vehicles?[`${vehicles} ${vehicles===1?"vehicle":"vehicles"}`]:[]),...(unknown?[`${unknown} unknown ${unknown===1?"entry":"entries"}`]:[])];
  return [counts.join(" · "),...shown].join("\n");
}
export function baseCard(content:HoloContent|undefined,key:string):BaseCard|undefined {
  if(!content)return;
  const card:BaseCard={title:"",summary:"",involved:[],more:0,furtherAway:0,technical:[]};
  const p=content.pois.find(p=>`base:pois:${p.id}`===key);
  if(p){card.title=p.title??p.kind;card.summary=p.title?poiTitle(p):poiTitle(p)==="Place"?"Map pin":"Point of interest";card.technical=[["Id",p.id],["Variant",p.variant??p.kind],...(p.record?[["Record",p.record] as [string,string]]:[]),...(p.journal?[["Journal",p.journal] as [string,string]]:[])];return card;}
  const s=content.spots.find(s=>`base:spots:${s.id}`===key);
  if(s){card.title="Spot";card.summary=s.workspot?.tags.map(readable).filter(Boolean).join(", ")||"No activity recorded";card.involved=s.communities.map(id=>({key:`base:communities:${id}`,label:"Community"}));card.technical=[["Id",s.id],["Yaw",`${s.yaw}°`],...(s.workspot?[["Workspot",s.workspot.path] as [string,string]]:[])];return card;}
  const c=content.communities.find(c=>`base:communities:${c.id}`===key);
  if(c){
    card.title="Community";const phases=new Set<string>(),spots=new Set<string>();
    for(const e of c.entries)for(const p of e.phases){phases.add(p.name);for(const id of p.spots)spots.add(id);}
    if(c.affiliation?.title)card.title=communityLabel(c,spots.size);
    const raw=[...new Set(c.entries.flatMap(e=>e.record?[e.record]:[]))];
    card.summary=communityTypes(c.entries);
    const names=[...new Set(c.entries.flatMap(e=>e.recordName?[e.recordName]:[]))];
    const affiliations=[...new Set(c.entries.flatMap(e=>e.affiliation?[`${e.affiliation.recordName??e.affiliation.record} (${e.affiliation.record})`]:[]))];
    const affiliationNames=[...new Set([c.affiliation?.title,...c.entries.map(e=>e.affiliation?.title)].filter((title):title is string=>!!title))];
    // Names containing code punctuation/digits, or <=3 characters, aren't presented as times.
    const coded=[...phases].some(name=>name.trim().length<=3||!/^\p{L}+(?:[ '\u2019-]\p{L}+)*$/u.test(name));
    card.when=coded?`${phases.size} time ${phases.size===1?"phase":"phases"}`:[...phases].join(", ");
    const byId=new Map(content.spots.map(s=>[s.id,s]));
    const nearby=[...spots].filter(id=>byId.has(id));
    card.involved=nearby.slice(0,12).map((id,index)=>{const tag=byId.get(id)?.workspot?.tags[0]?.replace(/[-_]+/g," ").trim();return {key:`base:spots:${id}`,label:`Spot · ${tag||index+1}`};});
    card.more=Math.max(0,nearby.length-12);card.furtherAway=spots.size-nearby.length;card.technical=[["Id",c.id],...(raw.length?[["Character records",raw.join(", ")] as [string,string]]:[]),...(names.length?[["Record names",names.join(", ")] as [string,string]]:[]),...(affiliations.length?[["Affiliation records",affiliations.join(", ")] as [string,string]]:[]),...(affiliationNames.length?[["Affiliation names",affiliationNames.join(", ")] as [string,string]]:[]),...(coded?[["Time phases",[...phases].join(", ")] as [string,string]]:[])];return card;
  }
}
