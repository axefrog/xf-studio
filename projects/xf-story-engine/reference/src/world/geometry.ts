import type { CellGeometry, Volume, XY, XYZ } from './types.ts';
import { intersectionAtLeastOneMm2, unionAreaMm2 } from './polygon-area.ts';

export const GRID_MM = 200_000;
export function millimetres(metres:number):number {
  const n=Math.round(metres*1000);
  if(!Number.isSafeInteger(n)) throw Error('Geometry coordinate is outside safe integer millimetres');
  return n===0?0:n;
}
export const quantiseXY=(p:XY):XY=>[millimetres(p[0]),millimetres(p[1])];
export const quantiseXYZ=(p:XYZ):XYZ=>[millimetres(p[0]),millimetres(p[1]),millimetres(p[2])];
export function quantisePolygon(poly:readonly XY[]):XY[] {
  const out=poly.map(quantiseXY);
  return out.filter((p,i)=>pointKey(p)!==pointKey(out[(i+out.length-1)%out.length]));
}
export const quantiseVolume=(v:Volume):Volume=>({poly:quantisePolygon(v.poly),zlo:millimetres(v.zlo),zhi:millimetres(v.zhi)});
export const metresXYZ=(p:XYZ):XYZ=>[p[0]/1000,p[1]/1000,p[2]/1000];
export const metresVolume=(v:Volume):Volume=>({poly:v.poly.map(([x,y])=>[x/1000,y/1000]),zlo:v.zlo/1000,zhi:v.zhi/1000});

const pointKey=(p:XY):string=>`${p[0]},${p[1]}`;
const abs=(n:bigint)=>n<0n?-n:n;
const cmp=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
function signedTwice(poly:readonly XY[]):bigint {
  return poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+BigInt(p[0])*BigInt(q[1])-BigInt(q[0])*BigInt(p[1]);},0n);
}
export const areaMm2=(poly:readonly XY[]):number=>Number(abs(signedTwice(poly)))/2;

/** Closed integer boundary. Doubled query coordinates admit exact midpoints. */
function insideDoubled(poly:readonly XY[],x:bigint,y:bigint):boolean {
  let hit=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const ax=2n*BigInt(poly[j][0]),ay=2n*BigInt(poly[j][1]),bx=2n*BigInt(poly[i][0]),by=2n*BigInt(poly[i][1]);
    const cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
    if(cross===0n&&x>=(ax<bx?ax:bx)&&x<=(ax>bx?ax:bx)&&y>=(ay<by?ay:by)&&y<=(ay>by?ay:by)) return true;
    if((ay>y)!==(by>y) && (by>ay?cross<0n:cross>0n)) hit=!hit;
  }
  return hit;
}
export const insideMm=(poly:readonly XY[],x:number,y:number)=>insideDoubled(poly,2n*BigInt(x),2n*BigInt(y));
export const containsMm=(v:Volume,p:XYZ)=>p[2]>=v.zlo&&p[2]<=v.zhi&&insideMm(v.poly,p[0],p[1]);
export const footprintMm2=(volumes:readonly Volume[])=>volumes.length===1?areaMm2(volumes[0].poly):unionAreaMm2(volumes);
export const overlapsXYMm=(a:Volume|readonly Volume[],b:Volume|readonly Volume[])=>
  intersectionAtLeastOneMm2('poly' in a?[a]:a,'poly' in b?[b]:b);

/** Math.round(n/d), including negative half ties toward +Infinity, exactly. */
function roundRatio(n:bigint,d:bigint):number {
  if(d<0n) {n=-n;d=-d;}
  const numerator=2n*n+d,denominator=2n*d;
  const result=numerator>=0n?numerator/denominator:-((-numerator+denominator-1n)/denominator);
  const number=Number(result);
  if(!Number.isSafeInteger(number)) throw Error('Geometry result exceeds safe integer millimetres');
  return number===0?0:number;
}

/** Boundary graph over integer pairs. Reuse on-line endpoints; round each new
 * cut intersection once to mm. Disconnected runs never acquire exterior bridges. */
function clipHalf(poly:XY[],axis:number,bound:number,sign:number):XY[][] {
  const other=1-axis,direction=axis===0?-sign:sign;
  const edges:Array<{a:XY;b:XY;used:boolean}>=[],boundary=new Map<string,XY>();
  const add=(a:XY,b:XY)=>{if(pointKey(a)!==pointKey(b))edges.push({a,b,used:false});};
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],ia=sign*(a[axis]-bound)>=0,ib=sign*(b[axis]-bound)>=0;
    if(a[axis]===bound)boundary.set(pointKey(a),a);
    if(a[axis]===bound&&b[axis]===bound)continue;
    if(ia&&ib)add(a,b);
    else if(ia!==ib) {
      let p:XY;
      if(a[axis]===bound)p=a;
      else if(b[axis]===bound)p=b;
      else {
        const denominator=BigInt(b[axis])-BigInt(a[axis]);
        const numerator=BigInt(a[other])*denominator+(BigInt(bound)-BigInt(a[axis]))*(BigInt(b[other])-BigInt(a[other]));
        p=[0,0];p[axis]=bound;p[other]=roundRatio(numerator,denominator);
      }
      boundary.set(pointKey(p),p);
      if(ia)add(a,p);else add(p,b);
    }
  }
  const cuts=[...boundary.values()].sort((a,b)=>a[other]-b[other]);
  for(let i=1;i<cuts.length;i++) {
    const a=cuts[i-1],b=cuts[i],mid=BigInt(a[other])+BigInt(b[other]);
    const on=poly.findIndex((p,j)=>p[axis]===bound&&poly[(j+1)%poly.length][axis]===bound&&
      mid>2n*BigInt(Math.min(p[other],poly[(j+1)%poly.length][other]))&&mid<2n*BigInt(Math.max(p[other],poly[(j+1)%poly.length][other])));
    const keep=on>=0?direction*(poly[(on+1)%poly.length][other]-poly[on][other])>0:
      insideDoubled(poly,BigInt(a[0])+BigInt(b[0]),BigInt(a[1])+BigInt(b[1]));
    if(keep)direction>0?add(a,b):add(b,a);
  }
  const outgoing=new Map<string,typeof edges>();
  for(const e of edges){const list=outgoing.get(pointKey(e.a))??[];list.push(e);outgoing.set(pointKey(e.a),list);}
  const result:XY[][]=[];
  for(const first of edges) {
    if(first.used)continue;
    const ring:XY[]=[];let edge=first;
    for(let steps=0;steps<=edges.length;steps++) {
      edge.used=true;ring.push(edge.a);
      if(pointKey(edge.b)===pointKey(first.a))break;
      const dx=BigInt(edge.b[0])-BigInt(edge.a[0]),dy=BigInt(edge.b[1])-BigInt(edge.a[1]);
      const next=(outgoing.get(pointKey(edge.b))??[]).filter((e)=>!e.used);
      const angle=(e:typeof edge):[bigint,bigint]=>{const x=BigInt(e.b[0])-BigInt(e.a[0]),y=BigInt(e.b[1])-BigInt(e.a[1]);return[-dx*x-dy*y,dx*y-dy*x];};
      next.sort((a,b)=>{
        const p=angle(a),q=angle(b),half=(v:[bigint,bigint])=>v[1]>0n||v[1]===0n&&v[0]>=0n?0:1;
        return half(p)-half(q)||cmp(q[0]*p[1]-p[0]*q[1],0n);
      });
      if(!next.length)throw Error('Polygon clipping produced an open boundary');
      edge=next[0];
      if(steps===edges.length)throw Error('Polygon clipping exceeded boundary budget');
    }
    if(ring.length>=3&&signedTwice(ring)!==0n)result.push(ring);
  }
  return result;
}
export function clipMm(poly:readonly XY[],xmin:number,ymin:number,xmax:number,ymax:number):XY[][] {
  if([...poly.flat(),xmin,ymin,xmax,ymax].some((n)=>!Number.isSafeInteger(n)))throw Error('Clipping requires integer millimetres');
  let rings=[poly.map((p)=>[...p]as XY)];
  if(signedTwice(rings[0])<0n)rings[0].reverse();
  for(const [axis,bound,sign]of[[0,xmin,1],[0,xmax,-1],[1,ymin,1],[1,ymax,-1]])rings=rings.flatMap((ring)=>clipHalf(ring,axis,bound,sign));
  return rings.map((ring)=>{
    let first=0;
    for(let i=1;i<ring.length;i++)if(ring[i][0]<ring[first][0]||ring[i][0]===ring[first][0]&&ring[i][1]<ring[first][1])first=i;
    return[...ring.slice(first),...ring.slice(0,first)];
  }).sort((a,b)=>a[0][0]-b[0][0]||a[0][1]-b[0][1]);
}
export function squaredDistanceMm(a:XYZ,b:XYZ):bigint {
  const dx=BigInt(a[0])-BigInt(b[0]),dy=BigInt(a[1])-BigInt(b[1]),dz=BigInt(a[2])-BigInt(b[2]);
  return dx*dx+dy*dy+dz*dz;
}
/** Footprint-weighted volume centroid, rounded once to an integer mm centre. */
export function centreMm(volumes:Volume[]):XYZ {
  let total=0n,x=0n,y=0n,z=0n;
  for(const v of volumes) {
    const twice=signedTwice(v.poly),weight=abs(twice),sign=twice<0n?-1n:1n;
    for(let i=0;i<v.poly.length;i++) {
      const [ax,ay]=v.poly[i].map(BigInt),[bx,by]=v.poly[(i+1)%v.poly.length].map(BigInt),cross=ax*by-bx*ay;
      x+=sign*(ax+bx)*cross;y+=sign*(ay+by)*cross;
    }
    total+=weight;z+=weight*(BigInt(v.zlo)+BigInt(v.zhi));
  }
  if(!total)throw Error('Geometry has no positive area after mm quantisation');
  return[roundRatio(x,3n*total),roundRatio(y,3n*total),roundRatio(z,2n*total)];
}
export function cellAtMm(geometry:Record<string,CellGeometry>,p:XYZ):string|undefined {
  const cells=Object.entries(geometry).sort(([,a],[,b])=>{
    if(a.place&&b.place)return a.place<b.place?-1:a.place>b.place?1:0;
    if(a.place||b.place)return a.place?-1:1;
    return a.grid![0]-b.grid![0]||a.grid![1]-b.grid![1];
  });
  return cells.find(([,g])=>g.place&&g.volumes.some((v)=>containsMm(v,p)))?.[0]??cells.find(([,g])=>g.grid&&g.volumes.some((v)=>containsMm(v,p)))?.[0];
}

// Metre-facing adapters for consumers of the serialised index and direct tests.
// The importer calls the Mm functions only, and projects back to metres once.
export const area=(poly:readonly XY[])=>areaMm2(quantisePolygon(poly))/1_000_000;
export const inside=(poly:readonly XY[],x:number,y:number)=>insideMm(quantisePolygon(poly),millimetres(x),millimetres(y));
export const contains=(v:Volume,p:XYZ)=>containsMm(quantiseVolume(v),quantiseXYZ(p));
export const footprint=(v:readonly Volume[])=>footprintMm2(v.map(quantiseVolume))/1_000_000;
export const overlapsXY=(a:Volume,b:Volume)=>overlapsXYMm(quantiseVolume(a),quantiseVolume(b));
export const clip=(p:readonly XY[],xmin:number,ymin:number,xmax:number,ymax:number):XY[][]=>
  clipMm(quantisePolygon(p),millimetres(xmin),millimetres(ymin),millimetres(xmax),millimetres(ymax)).map((ring)=>ring.map(([x,y])=>[x/1000,y/1000]));
export const squaredDistance=(a:XYZ,b:XYZ)=>Number(squaredDistanceMm(quantiseXYZ(a),quantiseXYZ(b)))/1_000_000;
export const centre=(v:Volume[])=>metresXYZ(centreMm(v.map(quantiseVolume)));
export function cellAt(geometry:Record<string,CellGeometry>,p:XYZ):string|undefined {
  if(!p.every(Number.isFinite))return undefined;
  return cellAtMm(Object.fromEntries(Object.entries(geometry).map(([id,g])=>[id,{...g,volumes:g.volumes.map(quantiseVolume)}])),quantiseXYZ(p));
}
