/** Presentation data, shared by the canvas and inspector. No story text is invented here. */
import type { AgentItem, AgentLayer } from "../agent-types";
import type { HoloState } from "../service";
import { changeMoment } from "../playback";
import { GLYPHS } from "./glyphs";

export const facetTitle = (key: string, titles?: Readonly<Record<string, string>>) => titles&&Object.hasOwn(titles,key)?titles[key]:key.replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());
export function humanMoment(t: number, game: boolean, from = 0): string {
  if (game) return `Day ${Math.floor(t / 86400) + 1} · ${String(Math.floor(t / 3600) % 24).padStart(2,"0")}:${String(Math.floor(t / 60) % 60).padStart(2,"0")}`;
  const seconds = Math.max(0, Math.round(t-from)), minutes = Math.floor(seconds/60), hours = Math.floor(minutes/60);
  return hours ? `${hours}:${String(minutes%60).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}` : `${minutes}:${String(seconds%60).padStart(2,"0")}`;
}
export function humanSpan(item: Pick<AgentItem,"t"|"until">, game: boolean, from = 0): string {
  if (item.t === undefined && item.until === undefined) return "Throughout";
  if (item.t === undefined) return `Until ${humanMoment(item.until!,game,from)}`;
  const start=humanMoment(item.t,game,from);
  if (item.until === undefined) return `From ${start}`;
  const duration=Math.max(0,item.until-item.t), hours=duration/3600, minutes=duration/60;
  return `${start}, for ${duration>=3600?`${Number(hours.toFixed(1))} h`:duration>=60?`${Number(minutes.toFixed(1))} min`:`${Number(duration.toFixed(1))} s`}`;
}
export function cardDetail(detail = "") {
  const summary:string[]=[],why:string[]=[];
  for(const line of detail.split("\n")) (/^(cause\b|because\b|why\s*:)/i.test(line.trim())?why:summary).push(line);
  return {summary:summary.join("\n").trim(),why:why.join("\n").trim()};
}
export const familyOf = (item: Pick<AgentItem,"glyph"|"kind">) => item.glyph && Object.hasOwn(GLYPHS,item.glyph) ? GLYPHS[item.glyph].family : item.kind;
export const FAMILY_TITLES:Readonly<Record<string,string>>={person:"People",group:"Groups",event:"Events",story:"Story",place:"Places",area:"Areas",route:"Routes",marker:"Markers",field:"Fields",diagnostic:"Diagnostics",item:"Things",direction:"Direction"};
const LEGEND_ORDER=["person","group","event","story","place","area","route","marker","field","diagnostic","item","direction"] as const;
const KIND_FAMILIES:Readonly<Record<string,string>>={actor:"person",zone:"area",path:"route",field:"field",point:"marker",target:"marker",label:"marker"};
export interface LegendEntry { family:string; count:number; glyph?:string; kind:string; tone:string }
export const orderedLegend=(counts:ReadonlyMap<string,LegendEntry>)=>LEGEND_ORDER.flatMap(family=>{const entry=counts.get(family);return entry?[entry]:[];});
export function addLegend(counts: Map<string,LegendEntry>,item:AgentItem) {
  const family=item.glyph&&Object.hasOwn(GLYPHS,item.glyph)?GLYPHS[item.glyph].family:Object.hasOwn(KIND_FAMILIES,item.kind)?KIND_FAMILIES[item.kind]:undefined;
  if(!family)return;
  const old=counts.get(family);
  if(old)old.count++;else counts.set(family,{family,count:1,glyph:item.glyph,kind:item.kind,tone:item.tone??"signal"});
}
export function plainCounts(layer:AgentLayer,on=true) {
  const missing=new Set(layer.notPlaced),count=on?layer.items.filter(i=>i.place&&!missing.has(i.id)).length:0,total=layer.total??layer.items.length;
  return `${count} on the map now${count!==total?` · of ${total} in this set`:""}`;
}
export function quietUntil(state:HoloState):number|undefined {
  if(!state.open||state.live.following)return;
  const next=changeMoment(state,1),threshold=state.open.session.meta.standalone?.clock==="game"?300:10;
  if(next===undefined||next>state.open.session.meta.to||next-state.t<threshold)return;
  const session=state.open.session;
  for(const rows of [state.layers.v?session.v:[],state.layers.camera?session.camera:[],state.layers.people?session.actors??[]:[],state.layers.events?session.events:[]]){
    let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].t<=state.t)lo=mid+1;else hi=mid;}
    if(rows[lo]&&rows[lo].t<next)return;
  }
  return next;
}
