/** Text layout is independent of marker drawing: hiding a label never removes its pick target. */
import type { AgentItem, AgentLayer } from "../agent-types";

export interface AgentLabel {
  key: string; text: string; x: number; y: number; priority: number;
  colour: string; alpha: number; caption?: boolean; overlay?: boolean; align?: "end"; selected?: boolean;
  /** Selected name/caption blocks choose one side of this plate together. */
  plate?: { x:number; y:number; radius:number };
}
export interface PlacedLabel extends AgentLabel { width: number }
export interface LabelBounds { x: number; y: number; width: number }
export interface PlateObstacle { key: string; x: number; y: number; radius: number }
export interface PlateObstacles { add(plate:PlateObstacle):void; overlaps(key:string,x:number,y:number,width:number):boolean }

/** Conservative 8 px occupancy cells keep dense plates from making label checks quadratic.
 * Two distinct owners are enough to ignore an item's own plate without ignoring a neighbour. */
export function createPlateObstacles():PlateObstacles {
  const cells=new Map<string,{owner:string;other:boolean}>(),size=8;
  return { add(plate){
    const {key,x,y,radius}=plate;
    for(let row=Math.floor((y-radius)/size);row<=Math.floor((y+radius)/size);row++)for(let col=Math.floor((x-radius)/size);col<=Math.floor((x+radius)/size);col++){
      const cellKey=`${col}:${row}`,cell=cells.get(cellKey);
      if(!cell)cells.set(cellKey,{owner:key,other:false});else if(cell.owner!==key)cell.other=true;
    }
  },overlaps(key,x,y,width){
    for(let row=Math.floor((y-13)/size);row<=Math.floor((y+4)/size);row++)for(let col=Math.floor(x/size);col<=Math.floor((x+width)/size);col++){
      const cell=cells.get(`${col}:${row}`);if(cell&&(cell.owner!==key||cell.other))return true;
    }
    return false;
  }};
}

export function labelPriority(item: AgentItem, important: ReadonlySet<string>): number {
  return important.has(item.key) ? 0 : item.kind === "actor" ? 1 : ["target", "point"].includes(item.kind) ? 2 : item.kind === "relation" ? 3 : 4;
}
export function labelContext(items: readonly AgentItem[], selected: string | null, hovered: string | null): Set<string> {
  const keys = new Set([selected, hovered].filter((k): k is string => !!k));
  for (const item of items) if (item.links && (keys.has(item.key) || item.links.from === selected || item.links.to === selected || item.links.from === hovered || item.links.to === hovered)) {
    keys.add(item.links.from); keys.add(item.links.to);
  }
  return keys;
}
export function actorCaption(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > 28 ? line.slice(0, 27).trimEnd() + "…" : line;
}
/** Greedy, deterministic label culling. Important labels displace ordinary text by being placed first. */
export function placeLabels(candidates: readonly AgentLabel[], measure: (text: string) => number, width: number, height: number, cap = 40, reserved: readonly LabelBounds[] = [],plates:readonly PlateObstacle[]|PlateObstacles=[]): PlacedLabel[] {
  const placed: PlacedLabel[] = [], names = new Set<string>(), consumed=new Set<AgentLabel>();
  if (width < 8 || height < 18) return placed;
  const obstacles="overlaps" in plates?plates:createPlateObstacles();
  if(!("overlaps" in plates))for(const plate of plates)obstacles.add(plate);
  const ordered = [...candidates].sort((a, b) => Number(!!b.selected)-Number(!!a.selected) || a.priority - b.priority || Number(!!a.caption) - Number(!!b.caption) || a.key.localeCompare(b.key));
  const fitText=(candidate:AgentLabel)=>{
    let text=candidate.text,size=measure(text);
    if(size>width-8){
      const chars=Array.from(text);let low=0,high=chars.length;
      while(low<high){const mid=Math.ceil((low+high)/2);if(measure(chars.slice(0,mid).join("")+"…")<=width-8)low=mid;else high=mid-1;}
      text=chars.slice(0,low).join("")+"…";size=measure(text);
    }
    return {...candidate,text,width:size};
  };
  for (const candidate of ordered) {
    if (placed.length >= cap) break;
    if(consumed.has(candidate))continue;
    if (candidate.caption && !names.has(candidate.key)) continue;
    if(candidate.selected&&candidate.plate&&!candidate.caption){
      const caption=ordered.find(c=>c.caption&&c.key===candidate.key),lines=[fitText(candidate),...(caption&&placed.length+1<cap?[fitText(caption)]:[])];
      const blockWidth=Math.max(...lines.map(l=>l.width)),{x:px,y:py,radius}=candidate.plate,lineGap=17,lastBaseline=(lines.length-1)*lineGap;
      const sides=[{x:px+radius+4,y:py-4},{x:px-radius-4-blockWidth,y:py-4},{x:px-blockWidth/2,y:py-radius-6-lastBaseline},{x:px-blockWidth/2,y:py+radius+19}];
      // At most four block probes (eight grid queries for a name and caption), independent of plate count.
      const side=sides.find(p=>p.x>=4&&p.x+blockWidth<=width-4&&p.y>=14&&p.y+lastBaseline<=height-4&&lines.every((line,n)=>!obstacles.overlaps(candidate.key,p.x,p.y+n*lineGap,line.width)))??{x:Math.max(4,Math.min(width-blockWidth-4,sides[0].x)),y:Math.max(14,Math.min(height-lastBaseline-4,sides[0].y))};
      lines.forEach((line,n)=>placed.push({...line,x:side.x,y:side.y+n*lineGap}));
      names.add(candidate.key);if(caption)consumed.add(caption);continue;
    }
    const fitted=fitText(candidate),value=fitted.text,size=fitted.width;
    const x = Math.max(4, Math.min(width - size - 4, candidate.x - (candidate.align === "end" ? size : 0))), y = Math.max(14, Math.min(height - 4, candidate.y));
    const overlaps = (p: LabelBounds) => x < p.x + p.width + 4 && x + size + 4 > p.x && y - 12 < p.y + 3 && y + 3 > p.y - 12;
    if (size > width - 8 || !candidate.selected&&(obstacles.overlaps(candidate.key,x,y,size)||reserved.some(overlaps)||placed.some(overlaps))) continue;
    placed.push({ ...candidate, text: value, x, y, width: size });
    if (!candidate.caption) names.add(candidate.key);
  }
  return placed;
}

export function itemTitle(item: AgentItem, items: readonly AgentItem[], owner?: string): string {
  if (item.kind !== "relation") return item.value?.name ?? item.label ?? item.kind;
  const incoming = owner !== undefined && item.links?.to === owner && item.links.from !== owner;
  const end = items.find(i => i.key === (incoming ? item.links?.from : item.links?.to));
  const name = end ? end.value?.name ?? end.label ?? end.kind : "unplaced item", type = item.value?.type ?? "Relation";
  return item.value?.mutual ? `${type} ↔ ${name}` : incoming ? `${name} → ${type}` : `${type} → ${name}`;
}
export function layerCounts(layer: AgentLayer): string {
  return [`${layer.items.length} ${layer.items.length === 1 ? "item" : "items"}`, layer.refused ? `${layer.refused} refused` : "", layer.notPlaced.length ? `${layer.notPlaced.length} not placed` : "", layer.otherBranches.length ? `${layer.otherBranches.length} on other branches` : ""].filter(Boolean).join(" · ");
}
export function gameSpan(seconds: number): string {
  const hours = Math.floor(Math.max(0, seconds) / 3600), days = Math.floor(hours / 24), remainder = hours % 24;
  return [days ? `${days} ${days === 1 ? "day" : "days"}` : "", remainder ? `${remainder} h` : ""].filter(Boolean).join(" ") || "<1 h";
}
