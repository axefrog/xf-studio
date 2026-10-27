import type { CellGeometry, Volume, XY, XYZ } from './types.ts';

export const area = (poly: readonly XY[]): number => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/** Closed boundary, matching the W1 reader. */
export function inside(poly: readonly XY[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) <= 1e-8 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) return true;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
export const contains = (v: Volume, p: XYZ): boolean => p[2] >= v.zlo && p[2] <= v.zhi && inside(v.poly, p[0], p[1]);

/** Exact XY union area by vertical slabs. Vertex and edge-intersection Xs
 * partition the plane into slabs where the union's height is linear. This
 * avoids double counting stacked/overlapping venue volumes in the report. */
function slabCuts(volumes: readonly Volume[]): number[] {
  const xs = new Set(volumes.flatMap((v) => v.poly.map((p) => p[0])));
  for (let i = 0; i < volumes.length; i++) for (let j = i + 1; j < volumes.length; j++) {
    const p = volumes[i].poly, q = volumes[j].poly;
    for (let a = 0; a < p.length; a++) for (let b = 0; b < q.length; b++) {
      const u = p[a], v = p[(a+1)%p.length], w = q[b], z = q[(b+1)%q.length];
      const dx = v[0]-u[0], dy = v[1]-u[1], ex = z[0]-w[0], ey = z[1]-w[1], det = dx*ey-dy*ex;
      if (det === 0) continue;
      const t = ((w[0]-u[0])*ey-(w[1]-u[1])*ex)/det;
      const s = ((w[0]-u[0])*dy-(w[1]-u[1])*dx)/det;
      if (t > 0 && t < 1 && s > 0 && s < 1) xs.add(u[0]+t*dx);
    }
  }
  return [...xs].sort((a,b)=>a-b);
}
function intervalsAt(poly: readonly XY[], x: number): Array<[number,number]> {
  const ys: number[] = [];
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j], b = poly[(j+1)%poly.length];
    if ((a[0]>x)!==(b[0]>x)) ys.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
  }
  ys.sort((a,b)=>a-b);
  const intervals: Array<[number,number]> = [];
  for (let j = 0; j+1 < ys.length; j+=2) intervals.push([ys[j],ys[j+1]]);
  return intervals;
}
export function footprint(volumes: readonly Volume[]): number {
  if (volumes.length === 1) return area(volumes[0].poly);
  const cuts = slabCuts(volumes);
  let result = 0;
  for (let i = 1; i < cuts.length; i++) {
    const x = (cuts[i-1]+cuts[i])/2, intervals: Array<[number,number]> = [];
    for (const {poly} of volumes) intervals.push(...intervalsAt(poly,x));
    intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let length = 0, lo = 0, hi = 0, active = false;
    for (const [a,b] of intervals) {
      if (!active) { lo=a; hi=b; active=true; }
      else if (a<=hi) hi=Math.max(hi,b);
      else { length+=hi-lo; lo=a; hi=b; }
    }
    if (active) length+=hi-lo;
    result += length*(cuts[i]-cuts[i-1]);
  }
  return result;
}

/** Positive-area XY intersection, not bounding-bin overlap. Slab cuts include
 * every edge crossing, so a positive interval at a slab midpoint is sufficient. */
export function overlapsXY(a: Volume, b: Volume): boolean {
  const cuts = slabCuts([a,b]);
  for (let i = 1; i < cuts.length; i++) {
    const x = (cuts[i-1]+cuts[i])/2;
    for (const p of intervalsAt(a.poly,x)) for (const q of intervalsAt(b.poly,x))
      if (Math.min(p[1],q[1]) > Math.max(p[0],q[0])) return true;
  }
  return false;
}

const pointKey = (p: XY): string => `${p[0]},${p[1]}`;
const signedTwice = (poly: readonly XY[]) => poly.reduce((s,p,i) => {
  const q = poly[(i+1)%poly.length]; return s+p[0]*q[1]-q[0]*p[1];
},0);

/** Clip one half-plane as a boundary graph. Only intervals actually inside the
 * input polygon are added on the cut line; disconnected runs never acquire a
 * bridge through the exterior. Input rings are simple, without holes. */
function clipHalf(poly: XY[], axis: number, bound: number, sign: number): XY[][] {
  const other = 1-axis, direction = axis === 0 ? -sign : sign;
  const edges: Array<{a:XY;b:XY;used:boolean}> = [], boundary = new Map<string,XY>();
  const add = (a:XY,b:XY) => { if (pointKey(a)!==pointKey(b)) edges.push({a,b,used:false}); };
  for (let i=0;i<poly.length;i++) {
    const a=poly[i], b=poly[(i+1)%poly.length], ia=sign*(a[axis]-bound)>=0, ib=sign*(b[axis]-bound)>=0;
    if (a[axis]===bound) boundary.set(pointKey(a),a);
    if (a[axis]===bound && b[axis]===bound) continue; // rebuilt as disjoint intervals below
    if (ia && ib) add(a,b);
    else if (ia!==ib) {
      const t=(bound-a[axis])/(b[axis]-a[axis]);
      const p:XY=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]; p[axis]=bound;
      boundary.set(pointKey(p),p);
      if (ia) add(a,p); else add(p,b);
    }
  }
  const cuts=[...boundary.values()].sort((a,b)=>a[other]-b[other]);
  for (let i=1;i<cuts.length;i++) {
    const a=cuts[i-1], b=cuts[i], mid:XY=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const on=poly.findIndex((p,j)=>p[axis]===bound && poly[(j+1)%poly.length][axis]===bound &&
      mid[other]>Math.min(p[other],poly[(j+1)%poly.length][other]) && mid[other]<Math.max(p[other],poly[(j+1)%poly.length][other]));
    const keep=on>=0 ? direction*(poly[(on+1)%poly.length][other]-poly[on][other])>0 : inside(poly,mid[0],mid[1]);
    if (keep) direction>0 ? add(a,b) : add(b,a);
  }
  const outgoing=new Map<string,typeof edges>();
  for (const e of edges) { const list=outgoing.get(pointKey(e.a))??[]; list.push(e); outgoing.set(pointKey(e.a),list); }
  const result:XY[][]=[];
  for (const first of edges) {
    if (first.used) continue;
    const ring:XY[]=[]; let edge=first;
    for (let steps=0;steps<=edges.length;steps++) {
      edge.used=true; ring.push(edge.a);
      if (pointKey(edge.b)===pointKey(first.a)) break;
      const dx=edge.b[0]-edge.a[0],dy=edge.b[1]-edge.a[1];
      const next=(outgoing.get(pointKey(edge.b))??[]).filter((e)=>!e.used);
      // Follow the face on the left, including at tangential contact vertices.
      const angle=(e:typeof edge):XY=>{ const x=e.b[0]-e.a[0],y=e.b[1]-e.a[1]; return [-dx*x-dy*y,dx*y-dy*x]; };
      next.sort((a,b)=>{
        const p=angle(a),q=angle(b),half=(v:XY)=>v[1]>0||v[1]===0&&v[0]>=0?0:1;
        return half(p)-half(q) || q[0]*p[1]-p[0]*q[1];
      });
      if (!next.length) throw Error('Polygon clipping produced an open boundary');
      edge=next[0];
      if (steps===edges.length) throw Error('Polygon clipping exceeded boundary budget');
    }
    if (ring.length>=3 && area(ring)>0) result.push(ring);
  }
  return result;
}

/** Rectangle intersection as separate simple polygon components, using binary64
 * coordinates. No artificial cut-line bridges become membership boundaries. */
export function clip(poly: readonly XY[], xmin: number, ymin: number, xmax: number, ymax: number): XY[][] {
  let rings=[poly.map((p)=>[...p] as XY)];
  if (signedTwice(rings[0])<0) rings[0].reverse();
  for (const [axis,bound,sign] of [[0,xmin,1],[0,xmax,-1],[1,ymin,1],[1,ymax,-1]])
    rings=rings.flatMap((ring)=>clipHalf(ring,axis,bound,sign));
  // Canonical starts/component order make persisted polygons deterministic.
  return rings.map((ring)=>{
    let first=0;
    for(let i=1;i<ring.length;i++) if(ring[i][0]<ring[first][0] || ring[i][0]===ring[first][0]&&ring[i][1]<ring[first][1]) first=i;
    return [...ring.slice(first),...ring.slice(0,first)];
  }).sort((a,b)=>a[0][0]-b[0][0]||a[0][1]-b[0][1]);
}
/** Fixed binary64 operation order; selection never depends on sqrt/hypot. */
export function squaredDistance(a:XYZ,b:XYZ):number {
  const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2];
  return (dx*dx+dy*dy)+dz*dz;
}
export function centre(volumes: Volume[]): XYZ {
  let sum = 0, x = 0, y = 0, z = 0;
  for (const v of volumes) {
    let twice = 0, cx = 0, cy = 0;
    for (let i = 0; i < v.poly.length; i++) {
      const a = v.poly[i], b = v.poly[(i + 1) % v.poly.length], c = a[0] * b[1] - b[0] * a[1];
      twice += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
    }
    const w = Math.abs(twice) / 2;
    if (!w) continue;
    sum += w; x += cx / (3 * twice) * w; y += cy / (3 * twice) * w; z += (v.zlo + v.zhi) / 2 * w;
  }
  return [x / sum, y / sum, z / sum];
}
/** Venue precedence and the caller's canonical cell order settle boundary ties. */
export function cellAt(geometry: Record<string, CellGeometry>, p: XYZ): string | undefined {
  if (!p.every(Number.isFinite)) return undefined;
  const cells = Object.entries(geometry).sort(([, a], [, b]) => {
    if (a.place && b.place) return a.place < b.place ? -1 : a.place > b.place ? 1 : 0;
    if (a.place || b.place) return a.place ? -1 : 1;
    return a.grid![0] - b.grid![0] || a.grid![1] - b.grid![1];
  });
  return cells.find(([, g]) => g.place && g.volumes.some((v) => contains(v, p)))?.[0]
    ?? cells.find(([, g]) => g.grid && g.volumes.some((v) => contains(v, p)))?.[0];
}
