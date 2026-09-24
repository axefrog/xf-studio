import { initialRecipe, curve, raster, coverage, type Point, type Layer } from '../../src/recipe';
// Freeze the historical study geometry when production defaults evolve.
const studyLayer = (): Layer => { const l=initialRecipe().layers[0]; l.pathMode='catmull-rom'; l.points=l.points.map(({handles: _handles,...p})=>p); return l; };
import { boundaryKernel, pointKernel, harmonicGrid, geometry, subdivide, type Field } from './fields';
import { mkdir } from 'node:fs/promises';

const epsilon=.002;
const points=(rows:number[][]):Point[]=>rows.map(([u,v,weight])=>({u,v,weight}));
const fixtures:Record<string,Point[]>={
  opposing:points([[.3,.3,0],[.7,.3,0],[.7,.7,1],[.3,.7,1]]),
  narrowWing:points([[.3,.24,0],[.38,.23,.2],[.47,.239,1],[.38,.246,.2]]),
  concaveU:points([[.25,.25,0],[.65,.25,0],[.65,.65,1],[.55,.65,1],[.55,.35,0],[.35,.35,0],[.35,.65,1],[.25,.65,1]]),
  nearbyOpposed:points([[.3,.3,0],[.7,.3,0],[.7,.304,1],[.3,.304,1]]),
  petal:curve(studyLayer().points.map((p,i)=>({...p,weight:[0,.15,.4,.8,1,.4][i]}))),
};
const rng=(()=>{let s=729283;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();
const samples=Array.from({length:1500},()=>({u:.2+rng()*.6,v:.18+rng()*.55}));
const maxDelta=(a:Field,b:Field,pts=samples)=>Math.max(...pts.map(p=>Math.abs(a(p.u,p.v)-b(p.u,p.v))));
const transform=(p:Point,angle:number,reflect=false):Point=>{
  const u=(p.u-.5)*(reflect?-1:1),v=p.v-.5,c=Math.cos(angle),s=Math.sin(angle);
  return {...p,u:.5+u*c-v*s,v:.5+u*s+v*c};
};
const results:any={date:'2026-09-23',runtime:Bun.version,epsilon,notes:['Research-only. Production recipe masks unchanged.','Timing includes CPU allocation and full RGBA image initialization; one layer, warm median of three.','Harmonic results include approximate stair-step boundary and continuation outside shape.'],fixtures:{}};
for(const [name,polygon] of Object.entries(fixtures)) {
  const p=pointKernel(polygon,epsilon), b=boundaryKernel(polygon,epsilon);
  const hStart=performance.now(), h=harmonicGrid(polygon,144,b), hMs=performance.now()-hStart;
  const inside=samples.filter(q=>geometry(q.u,q.v,polygon).inside);
  // Also sample a regular local grid, to cover even thin wings/opposed boundaries.
  const loU=Math.min(...polygon.map(p=>p.u)),hiU=Math.max(...polygon.map(p=>p.u));
  const loV=Math.min(...polygon.map(p=>p.v)),hiV=Math.max(...polygon.map(p=>p.v));
  for(let y=0;y<=30;y++) for(let x=0;x<=30;x++) {
    const q={u:loU+(hiU-loU)*x/30,v:loV+(hiV-loV)*y/30};
    if(geometry(q.u,q.v,polygon).inside) inside.push(q);
  }
  const split=subdivide(polygon,0,12), rotated=polygon.map(p=>transform(p,.637)), reflected=polygon.map(p=>transform(p,0,true));
  const hRot=harmonicGrid(rotated,144,boundaryKernel(rotated,epsilon));
  const hSplit=harmonicGrid(split,144,boundaryKernel(split,epsilon));
  const boundarySamples=polygon.flatMap((a,i)=>{
    const b=polygon[(i+1)%polygon.length];
    return Array.from({length:21},(_,j)=>({u:a.u+(b.u-a.u)*j/20,v:a.v+(b.v-a.v)*j/20,weight:a.weight+(b.weight-a.weight)*j/20}));
  });
  const metrics=(field:Field,rot:Field,ref:Field,split:Field)=>({
    range:[Math.min(...inside.map(q=>field(q.u,q.v))),Math.max(...inside.map(q=>field(q.u,q.v)))],
    splitMax:maxDelta(field,split,inside),
    rotatedMax:Math.max(...inside.map(q=>{const r=transform({...q,weight:0},.637);return Math.abs(field(q.u,q.v)-rot(r.u,r.v));})),
    reflectedMax:Math.max(...inside.map(q=>{const r=transform({...q,weight:0},0,true);return Math.abs(field(q.u,q.v)-ref(r.u,r.v));})),
    boundaryMax:Math.max(...boundarySamples.map(q=>Math.abs(field(q.u,q.v)-q.weight))),
    boundaryMean:boundarySamples.reduce((s,q)=>s+Math.abs(field(q.u,q.v)-q.weight),0)/boundarySamples.length,
  });
  results.fixtures[name]={samples:inside.length,harmonicSolveMs:hMs,harmonicStats:h.stats,
    point:metrics(p,pointKernel(rotated,epsilon),pointKernel(reflected,epsilon),pointKernel(split,epsilon)),
    boundary:metrics(b,boundaryKernel(rotated,epsilon),boundaryKernel(reflected,epsilon),boundaryKernel(split,epsilon)),
    boundaryLimit:metrics(boundaryKernel(polygon,0),boundaryKernel(rotated,0),boundaryKernel(reflected,0),boundaryKernel(split,0)),
    harmonic:metrics(h.at,hRot.at,harmonicGrid(reflected,144,boundaryKernel(reflected,epsilon)).at,hSplit.at),
    boundaryVsHarmonicInteriorMax:maxDelta(b,h.at,inside),
  };
}

const square=fixtures.opposing;
const b=boundaryKernel(square,epsilon),p=pointKernel(square,epsilon),h=harmonicGrid(square,144,b);
const legacy=studyLayer(); legacy.strength={mode:"legacy-nearest"}; Object.assign(legacy,{symmetry:false,opacity:1,feather:.01,points:square,fields:[{id:"study",u:.5,v:.5,du:0,dv:0,radius:.07}]});
results.centerContinuity=[.01,.0001,.000001,.00000001].map(e=>({e,
  old:coverage(.5,.5+e,legacy)-coverage(.5,.5-e,legacy),
  point:p(.5,.5+e)-p(.5,.5-e),boundary:b(.5,.5+e)-b(.5,.5-e),harmonic:h.at(.5,.5+e)-h.at(.5,.5-e),
}));
results.uniform={};
for(const value of [0,.37,1]) {
  const polygon=fixtures.petal.map(p=>({...p,weight:value}));
  const bp=boundaryKernel(polygon,epsilon),pp=pointKernel(polygon,epsilon),hp=harmonicGrid(polygon,96,bp);
  results.uniform[value]={point:maxDelta(pp,()=>value),boundary:maxDelta(bp,()=>value),harmonic:maxDelta(hp.at,()=>value)};
}
// Self-crossing paths are currently representable. Conflicting weights at a
// crossing prevent ANY field from being both continuous and exact on each edge.
const crossed=points([[.3,.3,0],[.7,.7,0],[.3,.7,1],[.7,.3,1]]);
results.crossing= [0,.00025,.0005,.001,.002].map(epsilon=>{
  const field=boundaryKernel(crossed,epsilon);
  return {epsilon, exact:field(.5,.5),reverse:boundaryKernel([...crossed].reverse(),epsilon)(.5,.5),
    nearby:[.001,.000001,.00000001].map(d=>({d,onFirst:field(.5+d,.5+d),onSecond:field(.5+d,.5-d),gap:Math.abs(field(.5+d,.5+d)-field(.5+d,.5-d))}))};
});
results.regularizationSweep=[.000125,.00025,.0005,.001,.002].map(epsilon=>({epsilon,
  cases:Object.fromEntries(['nearbyOpposed','petal','narrowWing'].map(name=>{
    const poly=fixtures[name],field=boundaryKernel(poly,epsilon);
    const knots=poly.map(p=>Math.abs(field(p.u,p.v)-p.weight));
    return [name,{knotMax:Math.max(...knots),knotMean:knots.reduce((a,b)=>a+b,0)/knots.length}];
  }))
}));

function candidateRaster(layer:Layer,size:number,factory:(polygon:Point[])=>Field) {
  const data=new Uint8ClampedArray(size*size*4),polygon=curve(layer.points),field=factory(polygon);
  for(let i=0;i<data.length;i+=4) data[i]=data[i+1]=data[i+2]=255;
  const pad=layer.feather, minV=Math.min(...polygon.map(p=>p.v))-pad,maxV=Math.max(...polygon.map(p=>p.v))+pad;
  let minU=Math.min(...polygon.map(p=>p.u))-pad,maxU=Math.max(...polygon.map(p=>p.u))+pad;
  if(layer.symmetry){const a=minU;minU=Math.min(minU,1-maxU);maxU=Math.max(maxU,1-a);}
  const one=(u:number,v:number)=>{
    const g=geometry(u,v,polygon),x=Math.max(0,Math.min(1,.5+(g.inside?1:-1)*g.distance/layer.feather));
    return x===0?0:x*x*(3-2*x)*field(u,v)*layer.opacity;
  };
  for(let y=Math.floor(minV*size);y<Math.ceil(maxV*size);y++) for(let x=Math.floor(minU*size);x<Math.ceil(maxU*size);x++) {
    const u=(x+.5)/size,v=(y+.5)/size;
    data[(y*size+x)*4+3]=Math.round(255*(layer.symmetry?Math.max(one(u,v),one(1-u,v)):one(u,v)));
  }
  return data;
}
function bakedField(polygon:Point[],cells:number,field:Field) {
  const pad=.06,x0=Math.min(...polygon.map(p=>p.u))-pad,y0=Math.min(...polygon.map(p=>p.v))-pad;
  const width=Math.max(...polygon.map(p=>p.u))+pad-x0,height=Math.max(...polygon.map(p=>p.v))+pad-y0;
  const dx=width/cells,dy=height/cells,n=cells+1,data=new Float64Array(n*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)data[y*n+x]=field(x0+x*dx,y0+y*dy);
  return (u:number,v:number)=>{
    const gx=(u-x0)/dx,gy=(v-y0)/dy;
    if(gx<0||gy<0||gx>=cells||gy>=cells)return field(u,v);
    const x=Math.floor(gx),y=Math.floor(gy),tx=gx-x,ty=gy-y,i=y*n+x;
    return (data[i]*(1-tx)+data[i+1]*tx)*(1-ty)+(data[i+n]*(1-tx)+data[i+n+1]*tx)*ty;
  };
}
const layer=studyLayer(); layer.strength={mode:"legacy-nearest"};layer.points=layer.points.map((p,i)=>({...p,weight:[0,.15,.4,.8,1,.4][i]}));
const methods:Record<string,(size:number)=>Uint8ClampedArray>={
  legacy:size=>raster(layer,size),
  point:size=>candidateRaster(layer,size,poly=>pointKernel(poly,epsilon)),
  boundary:size=>candidateRaster(layer,size,poly=>boundaryKernel(poly,epsilon)),
  boundaryLimit:size=>candidateRaster(layer,size,poly=>boundaryKernel(poly,0)),
  boundaryGrid128:size=>candidateRaster(layer,size,poly=>bakedField(poly,128,boundaryKernel(poly,epsilon))),
  harmonic144:size=>candidateRaster(layer,size,poly=>harmonicGrid(poly,144,boundaryKernel(poly,epsilon)).at),
};
results.rasters={};
for(const size of [1024,2048]) {
  const row:any={};const outputs:Record<string,Uint8ClampedArray>={};
  for(const [name,run] of Object.entries(methods)) {
    run(size);const times=[];
    for(let i=0;i<3;i++){const t=performance.now();outputs[name]=run(size);times.push(performance.now()-t);}
    row[name]={ms:times.sort((a,b)=>a-b)[1]};
  }
  const exact=outputs.boundary,approx=outputs.boundaryGrid128;let changed=0,max=0,sum=0,nonzero=0;
  for(let i=3;i<exact.length;i+=4){const d=Math.abs(exact[i]-approx[i]);changed+=Number(d!==0);max=Math.max(max,d);sum+=d;nonzero+=Number(exact[i]!==0);}
  row.gridError={changed,maxByte:max,meanOverNonzero:sum/nonzero,nonzero};
  results.rasters[size]=row;
}
results.uniformRasterDiffs={};
for(const value of [0,.37,1]) {
  const uniform=structuredClone(layer);uniform.points.forEach(p=>p.weight=value);
  const old=raster(uniform,1024),next=candidateRaster(uniform,1024,poly=>boundaryKernel(poly,.0005));
  let changed=0;for(let i=3;i<old.length;i+=4)changed+=Number(old[i]!==next[i]);
  results.uniformRasterDiffs[value]=changed;
}
const fine=boundaryKernel(curve(layer.points,80),.0005);
results.curveApproximation=[10,20,40].map(steps=>({steps,maxDifferenceFrom80:maxDelta(boundaryKernel(curve(layer.points,steps),.0005),fine)}));
const dense=structuredClone(layer);dense.points=Array.from({length:24},(_,i)=>({u:.37+.07*Math.cos(i/24*2*Math.PI),v:.23+.022*Math.sin(i/24*2*Math.PI),weight:i/23}));
results.dense24Knots={};
for(const size of [1024,2048]) {
  const row:any={};
  for(const [name,run] of Object.entries({legacy:()=>raster(dense,size),boundary:()=>candidateRaster(dense,size,poly=>boundaryKernel(poly,.0005))})) {
    run();const times=[];for(let i=0;i<3;i++){const t=performance.now();run();times.push(performance.now()-t);}
    row[name]=times.sort((a,b)=>a-b)[1];
  }
  results.dense24Knots[size]=row;
}
await mkdir('data/weight-study',{recursive:true});
await Bun.write('data/weight-study/results.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
