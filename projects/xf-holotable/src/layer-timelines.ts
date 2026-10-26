import type { Session, Vec3, WorldPack } from "./model.ts";
import { anchorPlace, numericTime, resolveRegion, type LayerData } from "./layers.ts";

export function standaloneSets(data: readonly LayerData[]) {
  const sets = new Map<string, { dir: string; title: string; data: LayerData[]; from: number; to: number; clock: "wall" | "game" | "recording" }>();
  for (const d of data) {
    const a = d.manifest.standalone; if (!a) continue;
    const id = `${d.manifest.producer}/${a.set}`, previous = sets.get(id);
    if (previous) {
      if (previous.from !== numericTime(a.from) || previous.to !== numericTime(a.to) || previous.clock !== a.clock) continue;
      previous.data.push(d);
    } else sets.set(id, { dir: `layers:${id}`, title: a.title ?? a.set, data: [d], from: numericTime(a.from), to: numericTime(a.to), clock: a.clock });
  }
  return [...sets.values()];
}
export function standaloneSession(data: readonly LayerData[], dir: string, world?: WorldPack): Session {
  const set = standaloneSets(data).find(s => s.dir === dir); if (!set) throw Error("That layers-only set isn't available.");
  const branches = [...new Set(set.data.flatMap(d => [d.manifest.branch, ...d.records.map(r => r.branch)]).filter((b): b is string => !!b))].sort();
  const session: Session = { meta: { schema: "xfh/session-1", session: dir, run: 0, worldGeneration: 0, pluginVersion: "", start: set.from, end: set.to, from: set.from, to: set.to,
    channels: [], complete: true, dropped: 0, missedDeadlines: 0, largestGapS: 0, coverage: "Layers only; no recorded observation of V or the game.", problems: [],
    standalone: { set: dir.slice(7), title: set.title, clock: set.clock, branches } }, v: [], camera: [], events: [], gaps: [] };
  const points = layerExtent(data, session, world);
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (const axis of [0,1,2]) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
  session.meta.standalone!.extent = { min, max };
  return session;
}
export function layerExtent(data: readonly LayerData[], session: Session, world?: WorldPack): Vec3[] {
  const points: Vec3[] = [];
  const include = (a: Parameters<typeof resolveRegion>[0]) => {
    if ("region" in a) { const id = a.region, label = world?.areas.find(p => p.id === id)?.labelPoint ?? world?.cells.find(p => p.id === id)?.labelPoint; if (label) points.push(label); }
    a = resolveRegion(a, world);
    if ("path" in a) points.push(...a.path);
    else if ("box" in a) points.push(a.box.min, a.box.max);
    else if ("sphere" in a) { const radius = a.sphere.r; points.push(a.sphere.at.map(n => n - radius) as Vec3, a.sphere.at.map(n => n + radius) as Vec3); }
    else if ("zone" in a) for (const [x, y] of a.zone.poly) points.push([x, y, a.zone.zlo], [x, y, a.zone.zhi]);
    else if ("grid" in a) { const g = a.grid; points.push(g.origin, [g.origin[0] + g.cell * g.cols, g.origin[1] + g.cell * g.rows, g.origin[2]]); }
    else { const p = anchorPlace(a, session, session.meta.from); if (p) points.push(p); }
  };
  for (const set of standaloneSets(data)) if (set.dir === session.meta.session) for (const d of set.data) for (const r of d.records) if (!("retract" in r)) {
    include(r.anchor);
    if (r.value && "to" in r.value && r.value.to) include(r.value.to);
    if (r.value && "from" in r.value && r.value.from) include(r.value.from);
  }
  return points.length ? points : [[0, 0, 0]];
}
export function setConflict(m: LayerData["manifest"], others: readonly LayerData[]): string | null {
  const a = m.standalone; if (!a) return null;
  const previous = others.find(d => d.manifest.producer === m.producer && d.manifest.layer !== m.layer && d.manifest.standalone?.set === a.set)?.manifest.standalone;
  return previous && (numericTime(previous.from) !== numericTime(a.from) || numericTime(previous.to) !== numericTime(a.to) || previous.clock !== a.clock) ? "Layers in a standalone set must agree on from, to and clock." : null;
}
