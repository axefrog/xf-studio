// Research prototypes only. Production recipe-2 evaluation remains unchanged.
import { clamp, type Point } from '../../src/engines/layered-makeup/recipe';
export type Sample = { inside: boolean; distance: number; boundaryWeight: number };
export type Field = (u: number, v: number) => number;

export function geometry(u: number, v: number, polygon: Point[]): Sample {
  let inside = false, best = Infinity, boundaryWeight = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], dx = b.u - a.u, dy = b.v - a.v;
    if ((a.v > v) !== (b.v > v) && u < (b.u-a.u)*(v-a.v)/(b.v-a.v)+a.u) inside = !inside;
    const t = clamp(((u-a.u)*dx + (v-a.v)*dy)/(dx*dx+dy*dy || 1));
    const d2 = (u-a.u-dx*t)**2+(v-a.v-dy*t)**2;
    if (d2 < best) { best = d2; boundaryWeight = a.weight*(1-t)+b.weight*t; }
  }
  return { inside, distance: Math.sqrt(best), boundaryWeight };
}

// Regularized inverse-square point kernels: cheap, positive and smooth, but
// changes when the same boundary is represented with a different knot density.
export function pointKernel(points: Point[], epsilon: number): Field {
  const e2 = epsilon*epsilon;
  return (u,v) => {
    let numerator = 0, denominator = 0;
    for (const p of points) {
      const k = 1 / ((p.u-u)**2+(p.v-v)**2+e2);
      numerator += p.weight*k; denominator += k;
    }
    return numerator / denominator;
  };
}

// Integrate the same kernel along the boundary, weighted by physical arclength.
// Along a straight segment w(s) is linear. Both integrals have closed forms;
// splitting a segment with interpolated weight leaves the result unchanged.
export function boundaryKernel(polygon: Point[], epsilon: number): Field {
  const e2 = epsilon*epsilon;
  const edges = polygon.map((a,i) => {
    const b = polygon[(i+1)%polygon.length], length = Math.hypot(b.u-a.u,b.v-a.v);
    return { u:a.u, v:a.v, x:(b.u-a.u)/(length||1), y:(b.v-a.v)/(length||1), length,
      weight:a.weight, slope:(b.weight-a.weight)/(length||1) };
  }).filter(e=>e.length>1e-12);
  return (u,v) => {
    let numerator = 0, denominator = 0;
    for (const e of edges) {
      const du=u-e.u, dv=v-e.v, along=du*e.x+dv*e.y, across=du*e.y-dv*e.x;
      if(epsilon===0 && Math.abs(across)<1e-12 && along>=0 && along<=e.length)
        return clamp(e.weight+e.slope*along);
      const h2=across*across+e2, h=Math.sqrt(h2), end=e.length-along;
      // atan2 avoids subtracting near-equal +/-pi/2 values outside a segment.
      // The collinear exterior limit is finite even though this quotient is 0/0.
      const integral=h<1e-15 ? 1/(along-e.length)-1/along : Math.atan2(e.length*h,h2-along*end)/h;
      const firstMoment=.5*Math.log((end*end+h2)/(along*along+h2))+along*integral;
      numerator += e.weight*integral+e.slope*firstMoment;
      denominator += integral;
    }
    return clamp(numerator/denominator);
  };
}

// Boundary-conditioned comparison, not production: a rectangular grid solves
// Laplace's equation inside the polygon. Outside nodes are fixed to nearest-edge
// weights. Bilinear lookup is continuous inside the grid, but the stair-stepped
// boundary, lack of ghost distances and external blending make this approximate.
export function harmonicGrid(polygon: Point[], cells: number, exterior: Field) {
  const minU=Math.min(...polygon.map(p=>p.u)), minV=Math.min(...polygon.map(p=>p.v));
  const width=Math.max(...polygon.map(p=>p.u))-minU, height=Math.max(...polygon.map(p=>p.v))-minV;
  const step=Math.max(width,height)/cells, x0=minU-step*2, y0=minV-step*2;
  const nx=Math.ceil(width/step)+5, ny=Math.ceil(height/step)+5;
  const values=new Float64Array(nx*ny), inside=new Uint8Array(nx*ny);
  let unknowns=0;
  for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
    const u=x0+x*step, v=y0+y*step, g=geometry(u,v,polygon), i=y*nx+x;
    inside[i]=Number(g.inside && g.distance>step*.01); unknowns+=inside[i];
    values[i]=inside[i] ? .5 : g.boundaryWeight;
  }
  const omega=1.7, limit=8000, tolerance=1e-8;
  let iteration=0, residual=Infinity;
  for(;iteration<limit;iteration++) {
    residual=0;
    // Red/black SOR has deterministic ordering and no directional scan bias.
    for(let parity=0;parity<2;parity++) for(let y=1;y<ny-1;y++) for(let x=1;x<nx-1;x++) {
      if((x+y)%2!==parity) continue;
      const i=y*nx+x; if(!inside[i]) continue;
      const delta=(values[i-1]+values[i+1]+values[i-nx]+values[i+nx])*.25-values[i];
      values[i]+=omega*delta; residual=Math.max(residual,Math.abs(delta));
    }
    if(residual<tolerance) break;
  }
  const at=(u:number,v:number) => {
    const gx=(u-x0)/step, gy=(v-y0)/step;
    if(gx<0||gy<0||gx>=nx-1||gy>=ny-1) return exterior(u,v);
    const x=Math.floor(gx),y=Math.floor(gy),tx=gx-x,ty=gy-y,i=y*nx+x;
    const interpolated=(values[i]*(1-tx)+values[i+1]*tx)*(1-ty)+(values[i+nx]*(1-tx)+values[i+nx+1]*tx)*ty;
    const g=geometry(u,v,polygon);
    if(g.inside) return clamp(interpolated);
    // Smoothly connect the grid boundary to the globally defined smooth field.
    const t=clamp(g.distance/(step*1.5)), blend=t*t*(3-2*t);
    return clamp(interpolated*(1-blend)+exterior(u,v)*blend);
  };
  return { at, stats:{cells,nx,ny,step,unknowns,bufferBytes:values.byteLength+inside.byteLength,iterations:iteration+1,residual,converged:residual<tolerance} };
}

export function subdivide(polygon: Point[], edge: number, divisions=8): Point[] {
  return polygon.flatMap((a,i) => {
    if(i!==edge) return [{...a}];
    const b=polygon[(i+1)%polygon.length];
    return Array.from({length:divisions},(_,j)=> {
      const t=j/divisions;
      return {u:a.u*(1-t)+b.u*t,v:a.v*(1-t)+b.v*t,weight:a.weight*(1-t)+b.weight*t};
    });
  });
}
