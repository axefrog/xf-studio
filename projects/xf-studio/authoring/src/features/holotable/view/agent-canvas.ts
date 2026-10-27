/** Canvas interpreter of the service's versioned projection table. Geometry and picking share a draw list. */
import type { AgentAnswer, AgentAnchor, AgentItem } from "../agent-types";
import type { Vec3 } from "../types";
import type { camera } from "./projection";
import { clusterPlateSteps, clearSelectedPlate, clusterRadius, type PlateCluster } from "./clusters";
import { addLegend, orderedLegend, FAMILY_TITLES, type LegendEntry } from "./friendly";
import { actorCaption, createPlateObstacles, labelContext, labelPriority, placeLabels, type AgentLabel, type LabelBounds, type PlacedLabel } from "./agent-labels";

import { BADGE_TONES, glyphIcon } from "./glyphs";
import { playbackEffects, EFFECT_MARKERS, type PaintedMarker } from "./playback-effects";
import { icon, isIconName } from "../../../studio-ui/icons";
import { agentInRange } from "./agent-bounds";

type Camera = ReturnType<typeof camera>;
type XY = readonly [number, number];
export function agentCanvas(canvas: HTMLCanvasElement, changed: () => void, now: () => number = () => performance.now()) {
  const context = canvas.getContext("2d"); if (!context) throw Error("Canvas 2D is unavailable for Agent layers.");
  const ctx = context;
  let stageColour = "", currentCamera: Camera | undefined, currentRadius = 350;
  let currentEnabled: Readonly<Record<string, boolean>> = {};
  const motionCanvas = document.createElement("canvas"); motionCanvas.style.cssText = canvas.style.cssText; motionCanvas.setAttribute("aria-hidden", "true");
  const motion = motionCanvas.getContext("2d")!;
  const effects = playbackEffects(now);
  let currentAnswer:AgentAnswer|undefined;
  let currentCollapsed=new Set<string>(),screenClusters:PlateCluster[]=[];
  const legend=new Map<string,LegendEntry>();
  let preparation:ReturnType<typeof prepare>|undefined,prepared:ReturnType<ReturnType<typeof prepare>["next"]>["value"]|undefined,clusterCursor=0,clusterMember=0;
  function* prepare(answer:AgentAnswer,enabled:Readonly<Record<string,boolean>>,C:Camera,radius:number,selected:string|null,hovered:string|null){
    const items:AgentItem[]=[],layerIds=new Map<string,string>(),missing=new Set(effects.keys());let work=0;
    for(const layer of answer.layers){
      if(enabled[layer.id]===false)continue;
      const notPlaced=new Set(layer.notPlaced);
      for(const item of layer.items){if(work++%64===0)yield;missing.delete(item.key);if(item.place&&!notPlaced.has(item.id)){items.push(item);layerIds.set(item.key,layer.id);}}
    }
    const positions=new Map<string,XY>(),coincident=new Map<string,AgentItem[]>();
    for(const item of items){if(work++%64===0)yield;
      for(const i of [item,...(item.kind!=="relation"&&item.to?[{...item,key:item.key+":to",region:item.toRegion,place:item.to}]:[])]){
        if(["point","target","label","actor","influence"].includes(i.kind)){const key=JSON.stringify(i.place),group=coincident.get(key)??[];group.push(i);coincident.set(key,group);}
        const p=C.point(i.place!);if(p)positions.set(i.key,p);
      }
    }
    for(const group of coincident.values()){if(work++%64===0)yield;if(group.length<=12)group.sort((a,b)=>a.key.localeCompare(b.key));const center=positions.get(group[0].key);if(!center)continue;
      if(group.length>1&&group.length<=12)group.forEach((i,n)=>{const a=n/group.length*2*Math.PI;positions.set(i.key,[center[0]+Math.cos(a)*12,center[1]+Math.sin(a)*12]);});
    }
    const projected=[];
    for(const item of items){if(work++%64===0)yield;const p=positions.get(item.key);
      if(answer.specs.kinds[item.kind]&&item.key!==selected&&p&&agentInRange(item,C.target,radius)&&p[0]>=0&&p[0]<=C.width&&p[1]>=0&&p[1]<=C.height&&(glyphIcon(item.glyph,isIconName).known||["point","actor","target"].includes(item.kind)))projected.push({item,x:p[0],y:p[1]});
    }
    const plan=yield* clusterPlateSteps(projected,Math.hypot(...C.position.map((n,i)=>n-C.target[i]))<=100);
    const selectedPoint=selected?positions.get(selected):undefined;if(selectedPoint)plan.clusters=plan.clusters.map(c=>clearSelectedPlate(c,selectedPoint));
    return {items,layerIds,missing,positions,important:labelContext(items,selected,hovered),plan};
  }
  let motionKey = "", previousPlaying = false;
  let painted = new Map<string, PaintedMarker>(), paintFailed = false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const stopMotion = () => { effects.clear(); motion.clearRect(0, 0, motionCanvas.width, motionCanvas.height); changed(); };
  reduced.addEventListener("change", stopMotion);
  const paths = new Map<string, { path: Path2D; fill: boolean; dash: string; faint: boolean }[]>();
  function iconShapes(name: string) {
    let shapes = paths.get(name);
    if (!shapes && isIconName(name)) { shapes = [...icon(name).children].map(path => ({ path: new Path2D(path.getAttribute("d")!), fill: path.getAttribute("fill") === "currentColor", dash: path.getAttribute("stroke-dasharray") ?? "", faint: !!path.getAttribute("stroke-opacity") })); paths.set(name, shapes); }
    return shapes ?? [];
  }
  function defaultMark(ctx: CanvasRenderingContext2D, draw: string, xy: XY, size: number) {
    const [x,y] = xy; ctx.beginPath();
    if (draw === "diamond" || draw === "volume") { ctx.moveTo(x,y-size); ctx.lineTo(x+size,y); ctx.lineTo(x,y+size); ctx.lineTo(x-size,y); ctx.closePath(); }
    else if (draw === "crosshair") { ctx.moveTo(x-size,y); ctx.lineTo(x+size,y); ctx.moveTo(x,y-size); ctx.lineTo(x,y+size); }
    else if (["polyline", "curve", "arrow"].includes(draw)) { ctx.moveTo(x-size,y+size/2); ctx.lineTo(x,y-size/2); ctx.lineTo(x+size,y+size/2); }
    else if (draw === "grid") { ctx.rect(x-size,y-size,size*2,size*2); ctx.moveTo(x-size,y); ctx.lineTo(x+size,y); ctx.moveTo(x,y-size); ctx.lineTo(x,y+size); }
    else if (draw === "text") { ctx.moveTo(x-size,y-size); ctx.lineTo(x+size,y-size); ctx.moveTo(x,y-size); ctx.lineTo(x,y+size); }
    else ctx.arc(x,y,size,0,Math.PI*2);
    ctx.stroke();
  }
  function plate(ctx: CanvasRenderingContext2D, item: {glyph?:string;badge?:string}, draw: string, xy: XY, selected: boolean, colour: string, alpha: number, opacity = 1) {
    const glyph = glyphIcon(item.glyph, isIconName); if (!glyph.known) return false;
    const radius = selected ? 11 : 9;
    ctx.globalAlpha = opacity; ctx.lineWidth = 1.5; ctx.fillStyle = stageColour;
    ctx.beginPath(); ctx.arc(...xy,radius,0,Math.PI*2); ctx.fill(); ctx.globalAlpha = alpha * opacity; ctx.stroke(); ctx.fillStyle = colour;
    if (glyph.icon) {
      ctx.save(); ctx.translate(xy[0]-6,xy[1]-6); ctx.scale(0.75,0.75); ctx.lineWidth = 1.5;
      for (const shape of iconShapes(glyph.icon)) { ctx.globalAlpha = alpha * opacity * (shape.faint ? 0.45 : 1); ctx.setLineDash(shape.dash ? shape.dash.split(/\s+/).map(Number) : []); if (shape.fill) ctx.fill(shape.path); else ctx.stroke(shape.path); }
      ctx.restore();
    } else defaultMark(ctx,draw,xy,4.5);
    const tone = item.badge && Object.hasOwn(BADGE_TONES,item.badge) ? BADGE_TONES[item.badge] : undefined;
    if (tone) { ctx.globalAlpha = opacity; ctx.fillStyle = palette[tone] ?? colour; ctx.beginPath(); ctx.arc(xy[0]+radius*0.72,xy[1]-radius*0.72,3,0,Math.PI*2); ctx.fill(); ctx.stroke(); }
    return true;
  }
  function animate() {
    const frame = effects.frame(), dpr = window.devicePixelRatio || 1;
    motion.setTransform(dpr,0,0,dpr,0,0); motion.clearRect(0,0,motionCanvas.width/dpr,motionCanvas.height/dpr);
    const deadline = performance.now()+1, C = currentCamera;
    for (const effect of frame.effects) {
      if (performance.now() > deadline) break;
      if (!C || currentCollapsed.has(effect.marker.key) || currentEnabled[effect.marker.layer] === false) continue;
      const marker = effect.marker;
      if (Math.hypot(...marker.point.map((n,i)=>n-C.target[i])) > currentRadius) continue;
      const projected = C.point(marker.point); if (!projected) continue;
      const xy: XY = [projected[0]+marker.offset[0],projected[1]+marker.offset[1]];
      const colour = palette[marker.tone] ?? palette.signal, opacity = 1-effect.progress;
      motion.globalAlpha = opacity; motion.strokeStyle = colour; motion.fillStyle = colour; motion.setLineDash([]);
      if (effect.kind === "pulse") {
        const size = marker.glyph && glyphIcon(marker.glyph,isIconName).known ? 9 : 6.8;
        motion.lineWidth = 1.5; motion.beginPath(); motion.arc(...xy,size+3+effect.progress*10,0,Math.PI*2); motion.stroke();
      } else if (!plate(motion,marker,marker.marker,xy,false,colour,1,opacity)) {
        motion.lineWidth = 2.4; defaultMark(motion,marker.marker,xy,6.8);
      }
    }
    motion.globalAlpha = 1; return frame.pending;
  }
  const labels = document.createElement("canvas"); labels.style.cssText = canvas.style.cssText; labels.setAttribute("aria-hidden", "true"); canvas.after(labels); labels.after(motionCanvas);
  const text = labels.getContext("2d")!;
  let candidates: AgentLabel[] = [], labelsPainted = false, previousHover: string | null = null;
  let overlayLabels: PlacedLabel[] = [], previousOverlay = "";
  let badges: LabelBounds[] = [];
  let plates = createPlateObstacles();
  const swatches = new Map<string, HTMLElement>();
  let palette: Record<string, string> = {}, hits: { key: string; points: XY[]; fill: boolean; priority: number }[] = [];
  const invalidate = () => { effects.clear(); palette = {}; previous = undefined; changed(); }, theme = new MutationObserver(invalidate);
  for (const root of [document.documentElement, document.body]) theme.observe(root, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  const media = matchMedia("(prefers-color-scheme: dark)"); media.addEventListener("change", invalidate);
  let previous: AgentAnswer | undefined, previousEnabled: Readonly<Record<string, boolean>> | undefined, previousCamera = "", previousSelection: string | null = null, cursor = 0, fieldCell = 0;
  const path = (ctx: CanvasRenderingContext2D, ps: readonly XY[], closed = false) => { if (!ps.length) return; ctx.moveTo(...ps[0]); for (let i = 1; i < ps.length; i++) ctx.lineTo(...ps[i]); if (closed) ctx.closePath(); };
  function clear(width: number, height: number) {
    painted = new Map(); paintFailed = false;legend.clear();screenClusters=[];currentCollapsed=new Set();preparation=undefined;prepared=undefined;clusterCursor=0;clusterMember=0;
    previous = undefined; cursor = 0; fieldCell = 0; candidates = []; labelsPainted = false; badges = []; plates = createPlateObstacles(); overlayLabels = [];
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    labels.width = Math.round(width * dpr); labels.height = Math.round(height * dpr);
    text.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height); hits = [];
    if (!palette.signal) palette = Object.fromEntries([...swatches].map(([t, e]) => [t, getComputedStyle(e).color]));
  }
  function paintItem(item:AgentItem,layer:string,C:Camera,selected:string|null,hovered:string|null,positions:ReadonlyMap<string,XY>,important:ReadonlySet<string>,radius:number,deadline:number,ctx:CanvasRenderingContext2D):"drawn"|"skip"|"pending" {
    let cell=fieldCell;
    const far=Math.max(1500,Math.hypot(...C.position.map((n,i)=>n-C.target[i]))+radius),fade=Math.max(1800,far*1.2);
    const answer=currentAnswer!;
    const p = item.place!; if (!agentInRange(item, C.target, radius)) return "skip";
    const rule = answer.specs.kinds[item.kind]; if (!rule) return "skip";
    const area = item.resolvedAnchor ?? item.anchor;
    const extended = ["polyline", "volume", "grid", "curve", "arrow"].includes(rule.draw) || rule.draw === "crosshair" && !!item.to || "box" in area || "zone" in area || "sphere" in area;
    const clipped = item.to ? C.line([p,item.to]) : [];
    const geometryXY=positions.get(item.links?.from??item.key);
    const markerXY = currentCollapsed.has(item.key)?undefined:geometryXY;
    const xy = geometryXY ?? clipped[0]?.points[0] ?? (extended ? C.point(C.target) : null); if (!xy) return "skip";
    if (Math.hypot(...p.map((n, j) => n - C.position[j])) > far || xy[0] < -64 || xy[0] > C.width + 64 || xy[1] < -64 || xy[1] > C.height + 64) {
      if (!extended) return "skip";
    }
    const weight = item.weight ?? 0.7, size = 4 + weight * 4, alpha = (0.35 + weight * 0.65) * Math.max(0.12, 1 - Math.hypot(...p.map((n, j) => n - C.position[j])) / fade);
    const colour = palette[rule.style === "tone" ? item.tone ?? "signal" : rule.style] ?? palette.signal;
    ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 1 + weight * 2; ctx.globalAlpha = alpha; ctx.setLineDash([]);
    const hit = (ps: XY[], fill = false, priority = fill ? 1 : 2) => { hits.push({ key: item.key, points: ps, fill, priority }); };
    const stroke = (ps: readonly Vec3[], opacity = 1, closed = false) => { for (const run of C.line(ps, closed)) { ctx.beginPath(); path(ctx,run.points); ctx.globalAlpha = alpha * opacity; ctx.stroke(); hit(run.points); } ctx.globalAlpha = alpha; };
    const polygon = (ps: Vec3[], opacity: number) => { const projected = C.polygon(ps); ctx.beginPath(); path(ctx,projected, true); ctx.globalAlpha = alpha * opacity; ctx.fill(); hit(projected, true); ctx.globalAlpha = alpha; };
    const volume = (a: AgentAnchor, fill: boolean) => {
      let poly: readonly (readonly [number, number])[] = [], lo = p[2], hi = p[2];
      if ("zone" in a) { poly = a.zone.poly; lo = a.zone.zlo; hi = a.zone.zhi; }
      else if ("box" in a) { const b = a.box; poly = [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]]; lo = b.min[2]; hi = b.max[2]; }
      else if ("sphere" in a) { const s = a.sphere; poly = Array.from({ length: 32 }, (_, n) => [s.at[0] + Math.cos(n * Math.PI / 16) * s.r, s.at[1] + Math.sin(n * Math.PI / 16) * s.r] as const); lo = s.at[2] - s.r * 0.6; hi = s.at[2] + s.r * 0.6; }
      if (!poly.length) return;
      const bottom = poly.map(([x, y]): Vec3 => [x, y, lo]), top = poly.map(([x, y]): Vec3 => [x, y, hi]);
      if (fill) polygon(bottom, weight * 0.1);
      stroke(bottom, fill ? 0.7 : 0.2, true); stroke(top, 0.12, true);
    };
    const arrow = (a: XY, b: XY) => { const angle = Math.atan2(b[1] - a[1], b[0] - a[0]); ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(b[0] - 7 * Math.cos(angle - 0.45), b[1] - 7 * Math.sin(angle - 0.45)); ctx.moveTo(...b); ctx.lineTo(b[0] - 7 * Math.cos(angle + 0.45), b[1] - 7 * Math.sin(angle + 0.45)); ctx.stroke(); };
    const addLabel = (value: string, at: XY, caption = false) => { if (value && !currentCollapsed.has(item.key)) candidates.push({ key: item.key, text: value, x: at[0], y: at[1], priority: caption ? 1.5 : item.key === hovered ? -2 : item.key === selected ? -1 : labelPriority(item, important), colour: selected===item.key?palette.signal:caption ? palette.muted ?? colour : colour, alpha: item.key===selected?1:caption ? 0.85 : alpha, caption,selected:!caption&&item.key===selected,plate:item.key===selected&&markerXY?{x:xy[0],y:xy[1],radius:glyphIcon(item.glyph,isIconName).known?11:size}:undefined }); };
    let label = rule.label.replace("{label}", item.label ?? "").replace("{name}", item.value?.name ?? "actor").replace("{type}", item.value?.type ?? "");
    const a = item.resolvedAnchor ?? item.anchor;
    if (item.region && selected === item.key && !["actor", "zone"].includes(item.kind)) volume(a, false);
    if (item.toRegion && item.toResolvedAnchor && selected === item.key) volume(item.toResolvedAnchor, false);
    if (rule.draw === "crosshair" && item.to) { ctx.setLineDash([4, 4]); stroke([p, item.to], 0.7); ctx.setLineDash([]); }
    if (rule.draw === "polyline" && "path" in a) stroke(a.path);
    else if (rule.draw === "volume") volume(a, true);
    else if (rule.draw === "grid" && "grid" in a) {
      const g = a.grid; if (Math.max(C.scale(g.origin), C.scale(C.target)) * g.cell < 2) return "skip";
      const scalars = item.value?.scalars, vectors = item.value?.vectors;
      const max = scalars ? Math.max(1e-9, ...scalars.map(Math.abs)) : 1;
      for (; cell < g.rows * g.cols; cell++) {
        if (cell % 16 === 0 && performance.now() > deadline) { fieldCell=cell; return "pending"; }
        const row = Math.floor(cell / g.cols), col = cell % g.cols, n = cell;
        const x = g.origin[0] + col * g.cell, y = g.origin[1] + row * g.cell, z = g.origin[2];
        if (scalars) polygon([[x, y, z], [x + g.cell, y, z], [x + g.cell, y + g.cell, z], [x, y + g.cell, z]], 0.05 + Math.abs(scalars[n]) / max * 0.4);
        else if (vectors) { const v = vectors[n], start: Vec3 = [x + g.cell / 2, y + g.cell / 2, z], end: Vec3 = [start[0] + v[0], start[1] + v[1], z]; stroke([start, end]); const pa = C.point(start), pb = C.point(end); if (pa && pb) arrow(pa, pb); }
      }
      cell = 0;
    } else if ((rule.draw === "curve" || rule.draw === "arrow") && item.to) {
      const to = positions.get(item.links?.to ?? item.key + ":to") ?? C.point(item.to) ?? clipped.at(-1)?.points.at(-1); if (!to) return "skip";
      if (rule.draw === "curve") {
        ctx.lineWidth = 1 + (item.value?.strength ?? weight) * 3;
        const dx = to[0] - xy[0], dy = to[1] - xy[1], len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(24, len * 0.16), mid: XY = [(xy[0] + to[0]) / 2 - dy / len * bend, (xy[1] + to[1]) / 2 + dx / len * bend];
        const points = Array.from({ length: 17 }, (_, n): XY => { const k = n / 16; return [(1-k)**2*xy[0]+2*(1-k)*k*mid[0]+k*k*to[0], (1-k)**2*xy[1]+2*(1-k)*k*mid[1]+k*k*to[1]]; });
        ctx.beginPath(); path(ctx,points); ctx.stroke(); hit(points);
        if (!item.value?.mutual) arrow(points[15], to);
        if (label) addLabel(label, [points[8][0] + 4, points[8][1] - 4]); label = "";
      } else { ctx.beginPath(); path(ctx,[xy, to]); ctx.stroke(); hit([xy, to]); arrow(xy, to); }
    } else {
      if (!markerXY) { if (rule.draw === "diamond") volume(area, false); return rule.draw === "crosshair" && item.to ? "drawn" : "skip"; }
      if (glyphIcon(item.glyph,isIconName).known) { if (rule.draw === "diamond") volume(a,false); }
      else if (rule.draw === "diamond") { volume(a, false); ctx.beginPath(); path(ctx,[[xy[0], xy[1]-size], [xy[0]+size,xy[1]], [xy[0],xy[1]+size], [xy[0]-size,xy[1]]], true); ctx.stroke(); }
      else if (rule.draw === "ring") { ctx.beginPath(); ctx.arc(...xy, size, 0, Math.PI*2); ctx.stroke(); }
      else if (rule.draw === "crosshair") {
        ctx.beginPath(); ctx.moveTo(xy[0]-size,xy[1]); ctx.lineTo(xy[0]+size,xy[1]); ctx.moveTo(xy[0],xy[1]-size); ctx.lineTo(xy[0],xy[1]+size); ctx.stroke();
      }
      hit([[xy[0]-size-3,xy[1]-size-3], [xy[0]+Math.max(size+3, rule.draw === "text" ? label.length*7 : size+3),xy[1]-size-3], [xy[0]+size+3,xy[1]+size+3], [xy[0]-size-3,xy[1]+size+3]], true, 3);
    }
    const plated = markerXY ? plate(ctx,item,rule.draw,xy,selected === item.key,colour,alpha) : false;
    if (plated) { hit([[xy[0]-12,xy[1]-12],[xy[0]+12,xy[1]-12],[xy[0]+12,xy[1]+12],[xy[0]-12,xy[1]+12]],true,3);
      // Index construction belongs to this marker's existing budgeted slice, including resumed frames.
      if(xy[0]>=-16&&xy[0]<=C.width+16&&xy[1]>=-16&&xy[1]<=C.height+16) plates.add({key:item.key,x:xy[0],y:xy[1],radius:selected===item.key?15:10}); }
    else if(markerXY&&xy[0]>=-16&&xy[0]<=C.width+16&&xy[1]>=-16&&xy[1]<=C.height+16&&["ring","diamond","crosshair"].includes(rule.draw))plates.add({key:item.key,x:xy[0],y:xy[1],radius:size+2});
    if (label && xy[0] >= -32 && xy[0] <= C.width+32 && xy[1] >= -32 && xy[1] <= C.height+32) addLabel(label, [xy[0]+(plated ? 11 : size)+4, xy[1]-4]);
    const facet = Object.entries(item.facets ?? item.value?.facets ?? {})[0];
    if (facet && rule.draw === "diamond") addLabel(actorCaption(facet[1]), [xy[0]+(plated ? 11 : size)+4, xy[1]+13], true);
    if (selected === item.key) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(...xy, plated ? 14 : size+5, 0, Math.PI*2); ctx.stroke(); }
    if (markerXY && xy[0]>=0 && xy[0]<=C.width && xy[1]>=0 && xy[1]<=C.height && (plated || ["ring","diamond","crosshair"].includes(rule.draw))) {
      if (painted.size < EFFECT_MARKERS) {
        const projected = C.point(p);
        if (projected) painted.set(item.key,{ key:item.key,id:item.id,layer,version:item.version??item.t??0,screen:[...xy],point:[...p],offset:[xy[0]-projected[0],xy[1]-projected[1]],tone:rule.style==="tone"?item.tone??"signal":rule.style,marker:rule.draw,glyph:item.glyph,fades:item.kind!=="path"&&item.kind!=="zone" });
      } else paintFailed = true;
    }
    fieldCell=0;
    return "drawn";
  }
  return {
    clear: (width: number, height: number) => { effects.clear(); motion.clearRect(0,0,motionCanvas.width,motionCanvas.height); clear(width,height); }, animate,
    overlayLabels: () => overlayLabels,
    clusters: () => screenClusters,
    legend: () => orderedLegend(legend),
    drawLegend(target: CanvasRenderingContext2D, width:number,height:number) {
      const entries=orderedLegend(legend);if(!entries.length)return;
      target.save();target.font="11px "+getComputedStyle(canvas).getPropertyValue("--font-mono");target.lineJoin="round";target.lineWidth=3;
      entries.forEach((entry,n)=>{const xy:XY=[22,height-52-(entries.length-1-n)*24],colour=palette[entry.tone]??palette.signal;target.strokeStyle=colour;target.fillStyle=colour;target.globalAlpha=1;
        const draw=currentAnswer?.specs.kinds[entry.kind]?.draw??"ring";if(!plate(target,entry,draw,xy,false,colour,1))defaultMark(target,draw,xy,5);
        const label=`${FAMILY_TITLES[entry.family]??entry.family} ${entry.count}`;target.strokeStyle=stageColour;target.lineWidth=3;target.strokeText(label,38,xy[1]+4,Math.max(20,width-62));target.fillStyle=palette.muted??colour;target.fillText(label,38,xy[1]+4,Math.max(20,width-62));
      });target.restore();
    },
    draw(answer: AgentAnswer, enabled: Readonly<Record<string, boolean>>, C: Camera, selected: string | null, budgetMs = 8, hovered: string | null = null, overlays: readonly AgentLabel[] = [], radius = 350, playback = { playing: false, epoch: "" }) {
      const deadline = performance.now() + budgetMs;
      currentCamera=C;currentRadius=radius;currentAnswer=answer;currentEnabled=enabled;
      for (const [tone, token] of Object.entries(answer.specs.tones ?? {})) if (!swatches.has(tone) && /^[a-z-]+$/.test(token)) {
        const span = document.createElement("span"); span.style.cssText = `position:absolute;visibility:hidden;color:var(--${token})`;
        canvas.parentElement!.append(span); swatches.set(tone, span); palette = {};
      }
      for (const [name, token] of [["good", "success"], ["stage", "pv-ground"]]) if (!swatches.has(name)) { const span = document.createElement("span"); span.style.cssText = `position:absolute;visibility:hidden;color:var(--${token})`; canvas.parentElement!.append(span); swatches.set(name,span); palette = {}; }
      const cameraKey = JSON.stringify([C.position, C.ray(C.width / 2, C.height / 2).direction, C.width, C.height, radius]);
      const overlayKey = JSON.stringify(overlays);
      const key = JSON.stringify([playback.epoch,enabled]);
      effects.configure(playback.playing,key,reduced.matches);
      const fresh = previousPlaying !== playback.playing || motionKey !== key || previous !== answer || previousEnabled !== enabled || previousCamera !== cameraKey || previousSelection !== selected || previousHover !== hovered || previousOverlay !== overlayKey;
      if (fresh) {
        motionKey = key; previousPlaying = playback.playing;
        clear(C.width, C.height); previous = answer; previousEnabled = enabled; previousCamera = cameraKey; previousSelection = selected; previousHover = hovered; previousOverlay = overlayKey; }
      if (answer.specs.schema !== "xfh/projections-1") { effects.clear(); return; }
      const dpr = window.devicePixelRatio || 1;
      if (motionCanvas.width !== Math.round(C.width*dpr) || motionCanvas.height !== Math.round(C.height*dpr)) { motionCanvas.width = Math.round(C.width*dpr); motionCanvas.height = Math.round(C.height*dpr); }
      stageColour = palette.stage;
      if(performance.now()>deadline){paintFailed=true;effects.clear();return {pending:true,drawn:0,total:0};}
      ctx.font = "11px " + getComputedStyle(canvas).getPropertyValue("--font-mono"); ctx.lineJoin = "round";
      if(!prepared){
        preparation??=prepare(answer,enabled,C,radius,selected,hovered);
        while(performance.now()<=deadline){const step=preparation.next();if(step.done){prepared=step.value;preparation=undefined;break;}}
        if(!prepared){paintFailed=true;effects.clear();return {pending:true,drawn:0,total:0};}
      }
      const {items,layerIds,missing,positions,important,plan}=prepared;
      currentCollapsed=plan.hidden;screenClusters=plan.clusters;
      for(;clusterCursor<screenClusters.length;clusterCursor++){
        if(performance.now()>deadline){paintFailed=true;effects.clear();return {pending:true,drawn:0,total:items.length};}
        const cluster=screenClusters[clusterCursor];
        if(clusterMember===0){
        const colour=palette[cluster.tone]??palette.signal;ctx.globalAlpha=1;ctx.strokeStyle=colour;ctx.fillStyle=stageColour;ctx.lineWidth=1.5;
        const radius=clusterRadius(cluster.items.length);ctx.beginPath();ctx.arc(cluster.x,cluster.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=colour;ctx.textAlign="center";ctx.fillText(String(cluster.items.length),cluster.x,cluster.y+4);ctx.textAlign="start";
        hits.push({key:cluster.key,points:[[cluster.x-radius,cluster.y-radius],[cluster.x+radius,cluster.y-radius],[cluster.x+radius,cluster.y+radius],[cluster.x-radius,cluster.y+radius]],fill:true,priority:3});
        plates.add({key:cluster.key,x:cluster.x,y:cluster.y,radius:radius+2});
        }
        for(;clusterMember<cluster.items.length;clusterMember++){
          if(clusterMember%64===0&&performance.now()>deadline){paintFailed=true;effects.clear();return {pending:true,drawn:0,total:items.length};}
          addLegend(legend,cluster.items[clusterMember]);
        }
        clusterMember=0;
      }
      let drawn = 0;
      for (; cursor < items.length; cursor++) {
        const item = items[cursor];
        if (performance.now() > deadline) { paintFailed=true; effects.clear(); break; }
        const result=paintItem(item,layerIds.get(item.key)!,C,selected,hovered,positions,important,radius,deadline,ctx);
        if(result==="pending"){paintFailed=true;effects.clear();return {pending:true,drawn,total:items.length};}
        if(result==="drawn"){drawn++;if(!currentCollapsed.has(item.key))addLegend(legend,item);}
      }
      if (cursor >= items.length && !labelsPainted) {
        text.font = ctx.font;
        text.strokeStyle = stageColour; text.lineWidth = 3; text.lineJoin = "round";
        const placed = placeLabels([...candidates, ...overlays], value => text.measureText(value).width, C.width, C.height, 40, badges,plates);
        overlayLabels = placed.filter(label => label.overlay);
        for (const label of placed.filter(label => !label.overlay)) {
          text.globalAlpha = label.alpha; text.fillStyle = label.colour;
          text.strokeText(label.text, label.x, label.y);
          text.fillText(label.text, label.x, label.y);
        }
        if (paintFailed || performance.now()>deadline) effects.clear();
        else {
          const layers = new Map(answer.layers.map(layer=>[layer.id,layer]));
          effects.paint(painted,marker=>{
            const layer=layers.get(marker.layer);
            return missing.has(marker.key) && !!layer && enabled[marker.layer]!==false && !layer.notPlaced.includes(marker.id) && !layer.reason;
          });
        }
        labelsPainted = true;
      }
      ctx.globalAlpha = 1; return { pending: cursor < items.length, drawn, total: items.length };
    },
    pick(x: number, y: number): string | null {
      for (const priority of [3, 2, 1]) for (let n = hits.length - 1; n >= 0; n--) {
        const h = hits[n]; if (h.priority !== priority) continue;
        if (h.fill) { let inside = false; for (let i = 0, j = h.points.length - 1; i < h.points.length; j = i++) { const a = h.points[i], b = h.points[j]; if ((a[1]>y)!==(b[1]>y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside = !inside; } if (inside) return h.key; }
        for (let i = 1; i < h.points.length; i++) { const a = h.points[i-1], b = h.points[i], dx=b[0]-a[0], dy=b[1]-a[1], k=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1))); if (Math.hypot(x-a[0]-k*dx,y-a[1]-k*dy) < 6) return h.key; }
      }
      return null;
    },
    dispose() { effects.clear(); motionCanvas.remove(); reduced.removeEventListener("change",stopMotion); labels.remove(); theme.disconnect(); media.removeEventListener("change", invalidate); for (const e of swatches.values()) e.remove(); },
  };
}
