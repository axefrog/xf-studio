// The shared publishing contract and pure evaluation. No files, drawing devices or host state.
import type { ContentLevel, Session, Vec3, WorldPack } from "./model.ts";

export const KINDS = ["point", "path", "zone", "field", "influence", "target", "label", "actor", "relation"] as const;
export type LayerKind = typeof KINDS[number];
export type Tone = "signal" | "accent" | "warning" | "danger" | "muted";
export type Anchor = { at: Vec3 } | { entity: string } | { path: Vec3[] } | { zone: { poly: [number, number][]; zlo: number; zhi: number } }
  | { box: { min: Vec3; max: Vec3 } } | { sphere: { at: Vec3; r: number } } | { grid: { origin: Vec3; cell: number; cols: number; rows: number } } | { item: string } | { region: string };
export interface LayerManifest { schema: "xfh/layer-1"; producer: string; producer_title?: string; facet_titles?: Record<string, string>; layer: string; title: string; description?: string; content: ContentLevel; clock: "recording" | "wall" | "game"; session?: string; run?: number; kinds: LayerKind[]; branch?: string; standalone?: { set: string; title?: string; from: number | string; to: number | string; clock: "recording" | "wall" | "game" } }
export interface LayerItem { schema?: "xfh/item-1"; id: string; kind: LayerKind; t?: number | string; until?: number | string; anchor: Anchor; branch?: string; glyph?: string; badge?: string; value?: { scalars?: number[]; vectors?: [number, number][]; to?: Anchor; from?: Anchor; name?: string; role?: string; facets?: Record<string, string>; type?: string; strength?: number; mutual?: boolean }; label?: string; detail?: string; facets?: Record<string, string>; tone?: Tone; weight?: number; cite?: string }
export interface Retraction { retract: string; t: number | string; branch?: string }
export type LayerRecord = LayerItem | Retraction;
export interface LayerData { manifest: LayerManifest; records: LayerRecord[]; refused: number; reason: string }
export interface PlacedItem extends Omit<LayerItem, "t" | "until"> { t?: number; until?: number; key: string; version?: number; place?: Vec3; to?: Vec3; resolvedAnchor?: Anchor; toResolvedAnchor?: Anchor; relations?: string[]; region?: { id: string; name: string; kind: "district" | "cell" }; toRegion?: { id: string; name: string; kind: "district" | "cell" }; links?: { from: string; to: string } }
export interface LayerView { id: string; title: string; producer: string; producer_title?: string; facet_titles?: Record<string, string>; layer: string; items: PlacedItem[]; changes?: number[]; refused: number; reason: string; notPlaced: string[]; otherBranches: string[] }
export interface HereGroup { layer: string; title: string; items: { item: PlacedItem; distance: number; sample?: number | [number, number] }[] }
export const LAYER_BOUNDS = { items: 5000, bytes: 16 * 1024 * 1024, cells: 128, batches: 2 } as const;
export const NO_WALL_CLOCK = "This recording has no wall-clock time; publish with the recording clock instead.";

// This versioned data is returned by the service. Every interpreter consumes the same kind table.
export const PROJECTION_SPECS = {
  schema: "xfh/projections-1",
  tones: { signal: "signal", accent: "accent", warning: "warning", danger: "danger", muted: "text-muted" },
  kinds: {
    point: { style: "tone", label: "{label}", draw: "ring" }, path: { style: "tone", label: "{label}", draw: "polyline" },
    zone: { style: "tone", label: "{label}", draw: "volume" }, field: { style: "tone", label: "{label}", draw: "grid" },
    influence: { style: "tone", label: "{label}", draw: "arrow" }, target: { style: "tone", label: "{label}", draw: "crosshair" },
    label: { style: "tone", label: "{label}", draw: "text" }, actor: { style: "tone", label: "{name}", draw: "diamond" },
    relation: { style: "tone", label: "{type}", draw: "curve" },
  },
} as const;

const object = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const short = (x: unknown, max = 160): x is string => typeof x === "string" && x.length > 0 && x.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(x);
/** CRLF is one line break; a lone CR remains invalid. */
export const normalizeDetail = (text: string): string => text.replace(/\r\n/g, "\n");
const detail = (x: unknown): boolean => {
  if (typeof x !== "string") return false;
  const text = normalizeDetail(x);
  return text.length > 0 && text.length <= 4000 && text.split("\n").length <= 40 && !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text);
};
const number = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const vector = (x: unknown, n = 3) => Array.isArray(x) && x.length === n && x.every(number);
const slug = (x: unknown) => typeof x === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x) && x.length <= 64;
const unit = (x: unknown) => number(x) && x >= 0 && x <= 1;
const keys = (x: Record<string, unknown>, allowed: string[]) => Object.keys(x).every(k => allowed.includes(k));
const facets = (x: unknown) => object(x) && Object.keys(x).length <= 16 && Object.entries(x).every(([k, v]) => short(k, 40) && short(v, 500));
const time = (x: unknown, clock: LayerManifest["clock"]) => clock !== "wall" ? number(x) : typeof x === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
export const numericTime = (t: number | string) => typeof t === "string" ? Date.parse(t) / 1000 : t;

export function validateManifest(x: unknown, identity?: string): string | null {
  if (!object(x) || !keys(x, ["schema", "producer", "producer_title", "facet_titles", "layer", "title", "description", "content", "clock", "session", "run", "kinds", "branch", "standalone"])) return "Manifest must be an object with known fields.";
  if (x.schema !== "xfh/layer-1") return "Manifest schema must be xfh/layer-1.";
  if (!slug(x.producer) || !slug(x.layer)) return "Producer and layer must be lowercase slugs.";
  if (identity && `${x.producer}/${x.layer}` !== identity) return "Manifest producer/layer does not match the spool.";
  if (!short(x.title) || x.description !== undefined && !short(x.description, 2000)) return "Manifest needs a short title and a text description.";
  if (x.producer_title !== undefined && !short(x.producer_title, 80)) return "Producer title must be 1 to 80 characters without control characters.";
  if (x.facet_titles !== undefined && (!object(x.facet_titles) || Object.keys(x.facet_titles).length > 16 || !Object.entries(x.facet_titles).every(([k, v]) => short(k, 40) && short(v, 60)))) return "Facet titles must have at most 16 text entries: keys 1 to 40 characters and titles 1 to 60, without control characters.";
  if (!["structure", "full"].includes(x.content) || !["recording", "wall", "game"].includes(x.clock)) return "Manifest needs a content level and a recording, wall or game clock.";
  if (x.branch !== undefined && !short(x.branch)) return "Branch must be short text.";
  if (x.standalone !== undefined) {
    const a = x.standalone;
    if (!object(a) || !keys(a, ["set", "title", "from", "to", "clock"]) || !slug(a.set) || a.title !== undefined && !short(a.title) || a.clock !== x.clock || !time(a.from, a.clock) || !time(a.to, a.clock) || numericTime(a.to) <= numericTime(a.from) || x.session !== undefined || x.run !== undefined) return "Standalone needs a set slug, matching clock and increasing from/to, without session or run.";
  }
  if (x.session !== undefined && !short(x.session) || x.run !== undefined && (!Number.isSafeInteger(x.run) || x.run < 1)) return "Session must be text and run must be a positive integer.";
  if (!Array.isArray(x.kinds) || !x.kinds.length || x.kinds.some((k: any) => !KINDS.includes(k)) || new Set(x.kinds).size !== x.kinds.length) return "Manifest kinds must be distinct supported kinds.";
  return null;
}
export function validateAnchor(x: unknown): boolean {
  if (!object(x) || Object.keys(x).length !== 1) return false;
  if ("at" in x) return vector(x.at);
  if ("entity" in x) return short(x.entity);
  if ("region" in x) return short(x.region);
  if ("item" in x) return short(x.item, 300) && /^[^/]+(?:\/[^/]+){0,2}$/.test(x.item);
  if ("path" in x) return Array.isArray(x.path) && x.path.length >= 2 && x.path.length <= 4096 && x.path.every((p: unknown) => vector(p));
  if ("zone" in x) { const z = x.zone; return object(z) && keys(z, ["poly", "zlo", "zhi"]) && Array.isArray(z.poly) && z.poly.length >= 3 && z.poly.length <= 4096 && z.poly.every((p: unknown) => vector(p, 2)) && number(z.zlo) && number(z.zhi) && z.zlo <= z.zhi; }
  if ("box" in x) { const b = x.box; return object(b) && keys(b, ["min", "max"]) && vector(b.min) && vector(b.max) && b.min.every((n: number, i: number) => n <= b.max[i]); }
  if ("sphere" in x) return object(x.sphere) && keys(x.sphere, ["at", "r"]) && vector(x.sphere.at) && number(x.sphere.r) && x.sphere.r > 0;
  if ("grid" in x) { const g = x.grid; return object(g) && keys(g, ["origin", "cell", "cols", "rows"]) && vector(g.origin) && number(g.cell) && g.cell > 0 && [g.cols, g.rows].every(n => Number.isInteger(n) && n > 0 && n <= 128); }
  return false;
}
export function validateRecord(x: unknown, m: LayerManifest): string | null {
  if (!object(x)) return "Item must be an object.";
  if ("retract" in x) return keys(x, ["retract", "t", "branch"]) && short(x.retract) && time(x.t, m.clock) && (x.branch === undefined || short(x.branch)) ? null : "Retraction needs an id, an optional branch and a valid time for the layer clock.";
  if (!keys(x, ["schema", "id", "kind", "t", "until", "anchor", "value", "label", "detail", "facets", "tone", "weight", "cite", "branch", "glyph", "badge"]) || x.schema !== undefined && x.schema !== "xfh/item-1") return "Item has unknown fields or schema.";
  for (const field of ["glyph", "badge"]) if (x[field] !== undefined && (typeof x[field] !== "string" || x[field].length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x[field]))) return `${field === "glyph" ? "Glyph" : "Badge"} must be a lowercase slug of at most 40 characters.`;
  if (x.branch !== undefined && !short(x.branch)) return "Branch must be short text.";
  if (!short(x.id) || x.id.includes("/") || !m.kinds.includes(x.kind)) return "Item needs a stable id and a kind declared in the manifest.";
  if ([x.t, x.until].some(t => t !== undefined && !time(t, m.clock))) return "Item time does not match the layer clock.";
  if (x.t !== undefined && x.until !== undefined && (m.clock === "wall" ? Date.parse(x.until) < Date.parse(x.t) : x.until < x.t)) return "Item ends before it starts.";
  if (!validateAnchor(x.anchor)) return "Item has an invalid anchor (fields are limited to 128 by 128 cells).";
  const a = Object.keys(x.anchor)[0], permitted: Record<LayerKind, string[]> = { point: ["at", "entity", "region", "item"], actor: ["at", "entity", "zone", "box", "sphere", "region", "item"], label: ["at", "entity", "region", "item"], target: ["at", "entity", "region", "item"], influence: ["at", "entity", "region", "item"], path: ["path"], zone: ["zone", "box", "sphere", "region"], field: ["grid"], relation: ["item"] };
  if (!permitted[x.kind as LayerKind]?.includes(a)) return `The ${x.kind} kind cannot use that anchor.`;
  if (x.kind !== "label" && !short(x.cite, 512) || x.cite !== undefined && (typeof x.cite !== "string" || !/^(?:recorder:[^:]+(?::[^:]+)?:\d+|event:[^:]+:\d+|se:.+|agent:[^:]+:.+)$/.test(x.cite))) return "Item needs a recorder, event, se or agent citation.";
  if (x.tone !== undefined && !["signal", "accent", "warning", "danger", "muted"].includes(x.tone) || x.weight !== undefined && !unit(x.weight)) return "Tone must be a Studio tone and weight must be between 0 and 1.";
  if (x.label !== undefined && !short(x.label) || x.detail !== undefined && !detail(x.detail) || x.facets !== undefined && !facets(x.facets)) return "Labels, details and facets must be bounded text.";
  const v = x.value;
  if (["point", "path", "zone", "label"].includes(x.kind)) return v === undefined ? null : "This kind does not take a value.";
  if (!object(v) && x.kind !== "target") return "This kind needs a value object.";
  if (x.kind === "actor") return keys(v, ["name", "role", "facets"]) && short(v.name) && (v.role === undefined || short(v.role)) && (v.facets === undefined || facets(v.facets)) ? null : "Actor needs a name, optional role and text facets.";
  if (x.kind === "field") { const n = x.anchor.grid.cols * x.anchor.grid.rows;
    return keys(v, ["scalars", "vectors"]) && ((Array.isArray(v.scalars) && v.vectors === undefined && v.scalars.length === n && v.scalars.every(number)) || (Array.isArray(v.vectors) && v.scalars === undefined && v.vectors.length === n && v.vectors.every((p: unknown) => vector(p, 2)))) ? null : "Field needs one scalar or vector per cell.";
  }
  if (x.kind === "relation") return keys(v, ["to", "type", "strength", "mutual"]) && validateAnchor(v.to) && "item" in v.to && short(v.type) && (v.strength === undefined || unit(v.strength)) && (v.mutual === undefined || typeof v.mutual === "boolean") ? null : "Relation needs an item target, type, strength from 0 to 1 and optional mutual flag.";
  if (x.kind === "influence") return keys(v, ["to"]) && validateAnchor(v.to) ? null : "Influence needs a target anchor.";
  return v === undefined || object(v) && keys(v, ["from"]) && (v.from === undefined || validateAnchor(v.from)) ? null : "Target takes only an optional from anchor.";
}

export function recordingTime(t: number | string | undefined, m: LayerManifest, s: Session): number | undefined {
  if (t === undefined) return undefined;
  if (s.meta.standalone) return numericTime(t);
  if (m.clock === "recording") return t as number;
  if (m.clock === "game") {
    const samples = [...(s.meta.gameTimeSamples ?? []), ...s.v.filter(v => v.gameTime !== undefined).map(v => ({ source: v.t, game: v.gameTime! }))].sort((a,b)=>a.source-b.source);
    if (!samples.length) throw Error("This recording has no game-clock time; publish with the recording clock instead.");
    for (let i = 1; i < samples.length; i++) { const a = samples[i - 1], b = samples[i]; if (a.game <= (t as number) && b.game >= (t as number) && b.game > a.game) return a.source + ((t as number) - a.game) / (b.game - a.game) * (b.source - a.source); }
    const exact = samples.find(v => v.game === t); if (exact) return exact.source;
    const pair = (t as number) < samples[0].game ? samples.slice(0,2) : samples.slice(-2);
    if (pair.length === 2 && pair[1].game > pair[0].game) {
      const source = pair[0].source + ((t as number) - pair[0].game) / (pair[1].game - pair[0].game) * (pair[1].source - pair[0].source);
      if (Math.min(...pair.map(p=>Math.abs(p.source-source))) <= 30) return source;
    }
    throw Error("Game-clock time is outside this recording's mapped samples.");
  }
  if (!s.meta.wallStart) throw Error(NO_WALL_CLOCK);
  return s.meta.start + (Date.parse(t as string) - Date.parse(s.meta.wallStart)) / 1000;
}
const dist = (a: Vec3, b: Vec3) => Math.hypot(...a.map((n, i) => n - b[i]));
export function resolveRegion(a: Anchor, world?: WorldPack): Anchor {
  if (!("region" in a)) return a;
  const area = world?.areas.find(p => p.id === a.region);
  if (area) return { zone: { poly: area.poly, zlo: area.zlo, zhi: area.zhi } };
  const cell = world?.cells.find(p => p.id === a.region);
  return cell ? { box: { min: cell.min, max: cell.max } } : a;
}
function regionPoint(a: Anchor, world: WorldPack | undefined, fallback: Vec3 | undefined) {
  if (!("region" in a)) return fallback;
  return world?.areas.find(p => p.id === a.region)?.labelPoint ?? world?.cells.find(p => p.id === a.region)?.labelPoint ?? fallback;
}
function regionMeta(a: Anchor, world?: WorldPack): PlacedItem["region"] {
  if (!("region" in a)) return undefined;
  const area = world?.areas.find(p => p.id === a.region), cell = world?.cells.find(p => p.id === a.region);
  return area || cell ? { id: a.region, name: area?.name ?? cell?.name ?? a.region, kind: area ? "district" : "cell" } : undefined;
}
export function anchorPlace(a: Anchor, s: Session, t: number): Vec3 | undefined {
  if ("at" in a) return a.at;
  if ("entity" in a) {
    const history = [...(s.actors ?? [])].reverse(), alias = history.find(x => x.t <= t && x.entity === a.entity)?.who;
    const sample = history.find(x => x.t <= t && (x.who === (alias ?? a.entity)));
    return sample && t - sample.t <= 0.5 ? sample.position : undefined;
  }
  if ("path" in a) return a.path[0];
  if ("sphere" in a) return a.sphere.at;
  if ("grid" in a) return a.grid.origin;
  if ("box" in a) return a.box.min.map((n, i) => (n + a.box.max[i]) / 2) as Vec3;
  if ("zone" in a) { const c = centroid(a.zone.poly); return [c[0], c[1], (a.zone.zlo + a.zone.zhi) / 2]; }
}
function centroid(poly: [number,number][]): [number,number] {
  let area=0,x=0,y=0; for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],k=a[0]*b[1]-b[0]*a[1];area+=k;x+=(a[0]+b[0])*k;y+=(a[1]+b[1])*k;}
  return Math.abs(area)>1e-12?[x/(3*area),y/(3*area)]:[poly.reduce((n,p)=>n+p[0],0)/poly.length,poly.reduce((n,p)=>n+p[1],0)/poly.length];
}
const changeCache = new WeakMap<LayerRecord[], { length: number; session: Session; clock: string; branch?: string; times: number[] }>();
/** Projection and stepping share clock admission and the ordering of untimed revisions. */
function revisionStart(r: LayerRecord, m: LayerManifest, s: Session): number {
  if (!s.meta.standalone && m.clock === "wall" && !s.meta.wallStart) throw Error(NO_WALL_CLOCK);
  if (!s.meta.standalone && m.clock === "game" && !s.meta.gameTimeSamples?.length && !s.v.some(v => v.gameTime !== undefined)) throw Error("This recording has no game-clock time; publish with the recording clock instead.");
  return recordingTime(r.t, m, s) ?? -Infinity;
}
/** Story-free timeline of effective publications, replacements and expirations on this branch. */
export function layerChanges(d: LayerData, s: Session, branch?: string): number[] {
  const clock = [s.meta.from,s.meta.to,s.meta.start,s.meta.wallStart,s.v.length,s.meta.gameTimeSamples?.length].join(":");
  const cached = changeCache.get(d.records);
  if (cached?.clock === clock && cached.length === d.records.length && cached.session === s && cached.branch === branch) return cached.times;
  const byId = new Map<string, { r: LayerRecord; t: number; order: number; until?: number; refusedEnd: boolean }[]>();
  d.records.forEach((r, order) => {
    if ((r.branch ?? d.manifest.branch) && (r.branch ?? d.manifest.branch) !== branch) return;
    try {
      const t = revisionStart(r, d.manifest, s);
      let until: number | undefined, refusedEnd = false;
      try { until = "retract" in r ? undefined : recordingTime(r.until, d.manifest, s); }
      catch { refusedEnd = true; } // Still supersedes the previous revision, as it does in projection.
      const id = "retract" in r ? r.retract : r.id, rows = byId.get(id) ?? [];
      rows.push({ r, t, order, until, refusedEnd }); byId.set(id, rows);
    } catch { /* Evaluation reports clock refusals; no invented change time. */ }
  });
  const times = new Set<number>();
  for (const rows of byId.values()) {
    rows.sort((a,b) => a.t-b.t || a.order-b.order);
    let active = false;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]; if (rows[i+1]?.t === row.t) continue;
      const exists = !row.refusedEnd && !("retract" in row.r) && (row.until === undefined || row.until > row.t);
      if (active || exists) {
        if (row.t !== -Infinity) times.add(row.t);
        else if (exists && (row.until === undefined || row.until > s.meta.from) && (rows[i+1] === undefined || rows[i+1].t > s.meta.from)) times.add(s.meta.from);
      }
      active = exists;
      if (exists && row.until !== undefined && (rows[i+1] === undefined || row.until < rows[i+1].t)) { times.add(row.until); active = false; }
    }
  }
  const result = [...times].filter(t => t >= s.meta.from && t <= s.meta.to).sort((a,b)=>a-b);
  changeCache.set(d.records,{length:d.records.length,session:s,clock,branch,times:result});
  return result;
}

export function evaluateLayers(data: readonly LayerData[], s: Session, t: number, level: ContentLevel, hidden: readonly string[] = [], world?: WorldPack, branch?: string): LayerView[] {
  const views: LayerView[] = [];
  for (const d of data) {
    const m = d.manifest, id = `${m.producer}/${m.layer}`;
    if (s.meta.standalone ? !m.standalone || `${m.producer}/${m.standalone.set}` !== s.meta.standalone.set : m.standalone) continue;
    if (m.session !== undefined && m.session !== s.meta.session || m.run !== undefined && m.run !== s.meta.run) continue;
    const view: LayerView = { id, title: m.title, producer: m.producer, ...(m.producer_title === undefined ? {} : { producer_title: m.producer_title }), ...(m.facet_titles === undefined ? {} : { facet_titles: m.facet_titles }), layer: m.layer, items: [], changes: layerChanges(d, s, branch), refused: d.refused, reason: d.reason, notPlaced: [], otherBranches: [] };
    const active = new Map<string, { record: LayerRecord; t: number; order: number }>();
    const shared = new Map<string, { record: LayerRecord; t: number; order: number }>();
    const other = new Map<string, { record: LayerRecord; t: number; order: number; branch: string }>();
    d.records.forEach((r, order) => {
      const recordBranch = r.branch ?? m.branch;
      try {
        const start = revisionStart(r, m, s), key = "retract" in r ? r.retract : r.id;
        if (start > t) return;
        if (!recordBranch) {
          const old = shared.get(key); if (!old || start > old.t || start === old.t && order > old.order) shared.set(key, { record: r, t: start, order });
        } else if (recordBranch !== branch) {
          const otherKey = `${recordBranch}/${key}`, old = other.get(otherKey);
          if (!old || start > old.t || start === old.t && order > old.order) other.set(otherKey, { record: r, t: start, order, branch: recordBranch });
          return;
        }
        const old = active.get(key);
        if (start <= t && (!old || start > old.t || start === old.t && order > old.order)) active.set(key, { record: r, t: start, order });
      } catch (e) { view.refused++; view.reason ||= String((e as Error).message); }
    });
    for (const version of other.values()) {
      const r = version.record; if ("retract" in r) continue;
      const common = shared.get(r.id);
      if (common && (common.t > version.t || common.t === version.t && common.order > version.order)) continue;
      try { const end = recordingTime(r.until, m, s); if (end === undefined || t < end) view.otherBranches.push(version.branch); } catch { /* The malformed clock is counted at ingestion above. */ }
    }
    for (const { record: r, order } of active.values()) {
      if ("retract" in r) continue;
      let until: number | undefined;
      try { until = recordingTime(r.until, m, s); } catch (e) { view.refused++; view.reason ||= String((e as Error).message); continue; }
      if (until !== undefined && t >= until) continue;
      const resolvedAnchor = resolveRegion(r.anchor, world);
      const item: PlacedItem = { ...r, t: recordingTime(r.t, m, s), until, key: `${id}/${r.id}`, version: order, resolvedAnchor, place: anchorPlace(resolvedAnchor, s, t) };
      if ("region" in r.anchor) {
        const id = r.anchor.region, area = world?.areas.find(p => p.id === id), cell = world?.cells.find(p => p.id === id);
        if (area || cell) item.region = { id, name: area?.name ?? cell?.name ?? id, kind: area ? "district" : "cell" };
        if (r.kind !== "actor") item.place = regionPoint(r.anchor, world, item.place);
      }
      if (r.kind === "influence" && r.value?.to) item.to = regionPoint(r.value.to, world, anchorPlace(resolveRegion(r.value.to, world), s, t));
      if (r.kind === "target" && r.value?.from) item.to = regionPoint(r.value.from, world, anchorPlace(resolveRegion(r.value.from, world), s, t));
      const other = r.kind === "influence" ? r.value?.to : r.kind === "target" ? r.value?.from : undefined;
      if (other) { item.toRegion = regionMeta(other, world); item.toResolvedAnchor = resolveRegion(other, world); }
      if (level === "structure") {
        delete item.detail; delete item.facets; delete item.label;
        if (item.cite && /^(agent|se):/.test(item.cite)) delete item.cite;
        if (item.value) {
          const { name: _name, facets: _facets, type: _type, ...safe } = item.value;
          item.value = safe;
          if (item.kind === "actor") item.value = { ...safe, name: safe.role ?? "actor" };
        }
      }
      view.items.push(item);
    }
    views.push(view);
  }
  const visible = views.filter(v => !hidden.includes(v.id));
  const layerCounts = new Map<string, number>(); for (const layer of visible) layerCounts.set(layer.id, (layerCounts.get(layer.id) ?? 0) + 1);
  const byKey = new Map(visible.flatMap(l => l.items.map(i => [i.key, i] as const)));
  const resolve = (ref: string, layer: LayerView) => {
    const parts = ref.split("/"), key = parts.length === 1 ? `${layer.id}/${ref}` : parts.length === 2 ? `${layer.producer}/${ref}` : ref;
    if (layerCounts.get(key.slice(0, key.lastIndexOf("/"))) !== 1) return undefined;
    const item = byKey.get(key);
    return item && ["actor", "point", "target", "zone"].includes(item.kind) ? item : undefined;
  };
  const owners = new Map(views.flatMap(l => l.items.map(i => [i.key, l] as const))), placed = new Set<string>();
  // Walk reference chains iteratively: forward references work and cycles cannot exhaust the stack.
  for (const layer of views) for (const item of layer.items) {
    if (item.kind === "relation" || !("item" in item.anchor) || placed.has(item.key)) continue;
    const chain: PlacedItem[] = [], seen = new Set<string>(); let end: PlacedItem | undefined = item;
    while (end && "item" in end.anchor && !placed.has(end.key)) {
      if (seen.has(end.key)) { end = undefined; break; }
      seen.add(end.key); chain.push(end); end = resolve(end.anchor.item, owners.get(end.key)!);
    }
    for (const link of chain) { link.place = end?.place; link.resolvedAnchor = end?.place ? { at: end.place } : link.anchor; placed.add(link.key); }
  }
  for (const layer of views) for (const item of layer.items) {
    const other = item.kind === "influence" ? item.value?.to : item.kind === "target" ? item.value?.from : undefined;
    if (other && "item" in other) { item.to = resolve(other.item, layer)?.place; item.toResolvedAnchor = item.to ? { at: item.to } : other; }
    if (item.kind === "relation" && "item" in item.anchor && item.value?.to && "item" in item.value.to) {
      const a = resolve(item.anchor.item, layer), b = resolve(item.value.to.item, layer);
      item.place = a?.place; item.to = b?.place;
      if (a && b) item.links = { from: a.key, to: b.key };
      if (!hidden.includes(layer.id)) for (const endpoint of [a, b]) if (endpoint) (endpoint.relations ??= []).push(item.key);
    }
    if (!item.place || ["relation", "influence"].includes(item.kind) && !item.to || item.kind === "target" && item.value?.from && !item.to) layer.notPlaced.push(item.id);
  }
  return views;
}

function segmentDistance(p: Vec3, a: Vec3, b: Vec3) {
  const d = b.map((n, i) => n - a[i]), l = d.reduce((n, x) => n + x * x, 0), k = l ? Math.max(0, Math.min(1, d.reduce((n, x, i) => n + x * (p[i] - a[i]), 0) / l)) : 0;
  return dist(p, a.map((n, i) => n + k * d[i]) as Vec3);
}
function contains(poly: [number, number][], p: Vec3) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (segmentDistance([p[0], p[1], 0], [...a, 0], [...b, 0]) < 1e-7) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function whatsHere(layers: readonly LayerView[], p: Vec3, hidden: readonly string[] = []): HereGroup[] {
  const groups: HereGroup[] = [];
  for (const layer of layers) {
    if (hidden.includes(layer.id)) continue;
    const items: HereGroup["items"] = [];
    for (const item of layer.items) {
      if (!item.place || layer.notPlaced.includes(item.id)) continue;
      const a = item.resolvedAnchor ?? item.anchor; let distance = dist(p, item.place), hit = false, sample: number | [number, number] | undefined;
      if ("zone" in a) hit = p[2] >= a.zone.zlo && p[2] <= a.zone.zhi && contains(a.zone.poly, p);
      else if ("box" in a) hit = p.every((n, i) => n >= a.box.min[i] && n <= a.box.max[i]);
      else if ("sphere" in a) hit = distance <= a.sphere.r;
      else if ("path" in a) { distance = Math.min(...a.path.slice(1).map((b, i) => segmentDistance(p, a.path[i], b))); hit = distance <= 5; }
      else if ("grid" in a) {
        const g = a.grid, col = Math.floor((p[0] - g.origin[0]) / g.cell), row = Math.floor((p[1] - g.origin[1]) / g.cell);
        hit = col >= 0 && col < g.cols && row >= 0 && row < g.rows;
        if (hit) sample = item.value?.scalars?.[row * g.cols + col] ?? item.value?.vectors?.[row * g.cols + col];
      } else if (item.kind === "relation" || item.kind === "influence") { distance = item.to ? segmentDistance(p, item.place, item.to) : Infinity; hit = distance <= 5; }
      else hit = distance <= 15;
      if (hit) items.push({ item, distance: ["zone", "field"].includes(item.kind) ? 0 : distance, ...(sample === undefined ? {} : { sample }) });
    }
    if (items.length) groups.push({ layer: layer.id, title: layer.title, items: items.sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id)) });
  }
  return groups.sort((a, b) => a.items[0].distance - b.items[0].distance || a.layer.localeCompare(b.layer));
}
