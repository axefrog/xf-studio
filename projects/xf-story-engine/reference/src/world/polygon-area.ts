// Exact rational slab integration over integer-mm polygons. No floating point
// comparison decides whether a contact has positive area or meets the 1 mm² gate.
import type { Volume, XY } from './types.ts';

interface Q { n: bigint; d: bigint }
const abs = (n:bigint) => n<0n?-n:n;
function q(n:bigint,d=1n):Q {
  if(d===0n) throw Error('Zero geometry denominator');
  if(d<0n) {n=-n;d=-d;}
  let a=abs(n),b=d; while(b) [a,b]=[b,a%b];
  return {n:n/a,d:d/a};
}
const add=(a:Q,b:Q)=>q(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:Q,b:Q)=>q(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:Q,b:Q)=>q(a.n*b.n,a.d*b.d);
const cmp=(a:Q,b:Q)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const key=(a:Q)=>`${a.n}/${a.d}`;
const half=(a:Q)=>q(a.n,2n*a.d);

function cuts(polygons:readonly (readonly XY[])[]):Q[] {
  const xs=new Map<string,Q>();
  const put=(x:Q)=>xs.set(key(x),x);
  for(const p of polygons) for(const [x] of p) put(q(BigInt(x)));
  for(let i=0;i<polygons.length;i++) for(let j=i+1;j<polygons.length;j++) {
    const p=polygons[i],r=polygons[j];
    for(let a=0;a<p.length;a++) for(let b=0;b<r.length;b++) {
      const u=p[a].map(BigInt),v=p[(a+1)%p.length].map(BigInt),w=r[b].map(BigInt),z=r[(b+1)%r.length].map(BigInt);
      const dx=v[0]-u[0],dy=v[1]-u[1],ex=z[0]-w[0],ey=z[1]-w[1];
      let det=dx*ey-dy*ex,t=(w[0]-u[0])*ey-(w[1]-u[1])*ex,s=(w[0]-u[0])*dy-(w[1]-u[1])*dx;
      if(!det) continue;
      if(det<0n) {det=-det;t=-t;s=-s;}
      if(t>0n&&t<det&&s>0n&&s<det) put(q(u[0]*det+t*dx,det));
    }
  }
  return [...xs.values()].sort(cmp);
}
function intervals(poly:readonly XY[],x:Q):Array<[Q,Q]> {
  const ys:Q[]=[];
  for(let j=0;j<poly.length;j++) {
    const [ax,ay]=poly[j].map(BigInt),[bx,by]=poly[(j+1)%poly.length].map(BigInt);
    if((ax*x.d>x.n)!==(bx*x.d>x.n)) ys.push(q(ay*(bx-ax)*x.d+(by-ay)*(x.n-ax*x.d),(bx-ax)*x.d));
  }
  ys.sort(cmp);
  const out:Array<[Q,Q]>=[];
  for(let j=0;j+1<ys.length;j+=2) out.push([ys[j],ys[j+1]]);
  return out;
}
function unionLength(intervals:Array<[Q,Q]>):Q {
  intervals.sort((a,b)=>cmp(a[0],b[0])||cmp(a[1],b[1]));
  let total=q(0n),current:[Q,Q]|undefined;
  for(const [lo,hi] of intervals) {
    if(!current) current=[lo,hi];
    else if(cmp(lo,current[1])<=0) {if(cmp(hi,current[1])>0)current[1]=hi;}
    else {total=add(total,sub(current[1],current[0]));current=[lo,hi];}
  }
  return current?add(total,sub(current[1],current[0])):total;
}
export function unionAreaMm2(volumes:readonly Volume[]):number {
  const polygons=volumes.map((v)=>v.poly),xs=cuts(polygons);
  let total=q(0n);
  for(let i=1;i<xs.length;i++) {
    const x=half(add(xs[i-1],xs[i]));
    total=add(total,mul(unionLength(polygons.flatMap((p)=>intervals(p,x))),sub(xs[i],xs[i-1])));
  }
  // Convert only the output magnitude; large exact denominators must not become
  // Infinity/Infinity while their ratio is a perfectly ordinary area.
  const scale=1n<<53n;
  return Number(total.n/total.d)+Number((total.n%total.d)*scale/total.d)/Number(scale);
}
export function intersectionAtLeastOneMm2(a:readonly Volume[],b:readonly Volume[]):boolean {
  const xs=cuts([...a,...b].map((v)=>v.poly)); let total=q(0n);
  for(let i=1;i<xs.length;i++) {
    const x=half(add(xs[i-1],xs[i])),intersections:Array<[Q,Q]>=[];
    for(const p of a.flatMap((v)=>intervals(v.poly,x))) for(const r of b.flatMap((v)=>intervals(v.poly,x))) {
      const lo=cmp(p[0],r[0])>0?p[0]:r[0],hi=cmp(p[1],r[1])<0?p[1]:r[1];
      if(cmp(lo,hi)<0) intersections.push([lo,hi]);
    }
    total=add(total,mul(unionLength(intersections),sub(xs[i],xs[i-1])));
    if(total.n>=total.d) return true;
  }
  return false;
}
