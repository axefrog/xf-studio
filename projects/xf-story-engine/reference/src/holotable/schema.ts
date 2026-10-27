// Producer-side subset of xfh/layer-1 and xfh/item-1. The independent consumer
// validator remains the interoperability oracle; this module has no host imports.
export type Kind = 'zone' | 'actor' | 'relation' | 'point' | 'target';
export type Vec3 = [number, number, number];
export type Box = { box: { min: Vec3; max: Vec3 } };
export type Zone = { zone: { poly: [number, number][]; zlo: number; zhi: number } };
export type Anchor = { region: string } | { entity: string } | { at: Vec3 } | { item: string } | Box | Zone;
export interface Manifest {
  schema: 'xfh/layer-1'; producer: 'story-engine'; layer: string; title: string; description?: string;
  producer_title?: string; facet_titles?: Record<string, string>;
  content: 'full'; clock: 'game' | 'recording'; kinds: Kind[]; branch?: string;
  session?: string; run?: number;
  standalone?: { set: string; title?: string; from: number; to: number; clock: 'game' };
}
export interface Item {
  schema: 'xfh/item-1'; id: string; kind: Kind; t: number; until?: number;
  anchor: Anchor; cite: string; label?: string; detail?: string; branch?: string;
  glyph?: string; badge?: string;
  tone?: 'muted' | 'signal' | 'accent' | 'warning' | 'danger'; facets?: Record<string, string>;
  value?: { name?: string; role?: string; to?: { item: string }; type?: string; strength?: number; mutual?: boolean };
}
export interface Retraction { retract: string; t: number; branch?: string }
export type RecordLine = Item | Retraction;
export const BOUNDS = { items: 5000, bytes: 16 * 1024 * 1024, line: 1024 * 1024, people: 4000 } as const;
const kinds: Kind[] = ['zone', 'actor', 'relation', 'point', 'target'];
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const text = (v: unknown, max = 160): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
const detailText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4000 && v.split('\n').length <= 40 && !/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const slug = (v: unknown) => typeof v === 'string' && v.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const unit = (v: unknown) => num(v) && v >= 0 && v <= 1;
export function validateManifest(v: unknown): asserts v is Manifest {
  if (!obj(v) || !keys(v, ['schema', 'producer', 'layer', 'title', 'description', 'content', 'clock', 'kinds', 'branch', 'standalone', 'session', 'run', 'producer_title', 'facet_titles']) ||
    v.schema !== 'xfh/layer-1' || v.producer !== 'story-engine' || !slug(v.layer) || !text(v.title) ||
    v.content !== 'full' || !['game', 'recording'].includes(v.clock) || !Array.isArray(v.kinds) || !v.kinds.length ||
    v.kinds.some((k: Kind) => !kinds.includes(k)) || new Set(v.kinds).size !== v.kinds.length ||
    v.description !== undefined && !text(v.description, 2000) || v.branch !== undefined && !text(v.branch)) throw Error('Invalid Holotable manifest');
  if (v.producer_title !== undefined && !text(v.producer_title, 80) || v.facet_titles !== undefined && (!obj(v.facet_titles) || Object.keys(v.facet_titles).length > 16 || !Object.entries(v.facet_titles).every(([k, x]) => text(k, 40) && text(x, 60)))) throw Error('Invalid Holotable content hooks');
  if (v.clock === 'recording') {
    if (!text(v.session) || !Number.isSafeInteger(v.run) || v.run < 1 || v.standalone !== undefined) throw Error('Invalid recording binding');
    return;
  }
  if (!obj(v.standalone) || v.session !== undefined || v.run !== undefined) throw Error('Invalid standalone binding');
  const s = v.standalone;
  if (!keys(s, ['set', 'title', 'from', 'to', 'clock']) || !slug(s.set) || s.title !== undefined && !text(s.title) ||
    s.clock !== 'game' || !num(s.from) || !num(s.to) || s.to <= s.from) throw Error('Invalid standalone timeline');
}
function anchor(v: unknown): v is Anchor {
  return obj(v) && Object.keys(v).length === 1 &&
    (text(v.region) || text(v.entity) || text(v.item) && /^[^/]+(?:\/[^/]+){0,2}$/.test(v.item) ||
      Array.isArray(v.at) && v.at.length === 3 && v.at.every(num) || obj(v.zone) && keys(v.zone, ['poly', 'zlo', 'zhi']) &&
      Array.isArray(v.zone.poly) && v.zone.poly.length >= 3 && v.zone.poly.length <= 4096 &&
      v.zone.poly.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(num)) && num(v.zone.zlo) && num(v.zone.zhi) && v.zone.zlo <= v.zone.zhi ||
      obj(v.box) && keys(v.box, ['min', 'max']) &&
      [v.box.min, v.box.max].every((a) => Array.isArray(a) && a.length === 3 && a.every(num)) && v.box.min.every((n: number, i: number) => n <= v.box.max[i]));
}
export function validateRecord(v: unknown, m: Manifest): asserts v is RecordLine {
  if (!obj(v)) throw Error('Item must be an object');
  if ('retract' in v) {
    if (!keys(v, ['retract', 't', 'branch']) || !text(v.retract) || v.retract.includes('/') || !num(v.t) ||
      v.branch !== undefined && !text(v.branch)) throw Error('Invalid retraction');
    return;
  }
  if (!keys(v, ['schema', 'id', 'kind', 't', 'until', 'anchor', 'cite', 'label', 'detail', 'tone', 'facets', 'value', 'branch', 'glyph', 'badge']) ||
    v.schema !== 'xfh/item-1' || !text(v.id) || v.id.includes('/') || !m.kinds.includes(v.kind) || !num(v.t) ||
    v.until !== undefined && (!num(v.until) || v.until < v.t) || !anchor(v.anchor) ||
    !text(v.cite, 512) || !/^se:(event|node|edge|frame|belief|seed|inst|sow|stage):[^\s]+$/.test(v.cite) ||
    v.label !== undefined && !text(v.label) || v.detail !== undefined && !detailText(v.detail) ||
    v.branch !== undefined && !text(v.branch) || v.glyph !== undefined && (!slug(v.glyph) || v.glyph.length > 32) || v.badge !== undefined && (!slug(v.badge) || v.badge.length > 32) ||
    v.tone !== undefined && !['muted', 'signal', 'accent', 'warning', 'danger'].includes(v.tone))
    throw Error('Invalid Holotable item, citation or time');
  if (v.facets !== undefined && (!obj(v.facets) || Object.keys(v.facets).length > 16 ||
    !Object.entries(v.facets).every(([k, x]) => text(k, 40) && text(x, 500)))) throw Error('Facets exceed bounded text');
  const a = Object.keys(v.anchor)[0];
  if (v.kind === 'relation') {
    const x = v.value;
    if (a !== 'item' || !obj(x) || !keys(x, ['to', 'type', 'strength', 'mutual']) || !anchor(x.to) || !('item' in x.to) ||
      !text(x.type) || x.strength !== undefined && !unit(x.strength) || x.mutual !== undefined && typeof x.mutual !== 'boolean') throw Error('Invalid relation');
  } else if (v.kind === 'actor') {
    if (!['region', 'entity', 'at', 'box', 'item'].includes(a) || !obj(v.value) || !keys(v.value, ['name', 'role']) || !text(v.value.name) ||
      v.value.role !== undefined && !text(v.value.role)) throw Error('Invalid actor');
  } else if ((v.kind === 'zone' ? !['region', 'box', 'zone'].includes(a) : !['region', 'entity', 'at', 'item'].includes(a)) || v.value !== undefined) throw Error('Invalid spatial item');
}
