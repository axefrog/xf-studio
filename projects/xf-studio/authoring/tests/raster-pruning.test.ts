import {expect,test} from "bun:test";
import {coverage,curve,initialRecipe,raster,createRasterJob,type Layer} from "../src/engines/layered-makeup/recipe";
import {convertToBezier} from "../src/engines/layered-makeup/bezier-path";

function compareScalar(layer:Layer,size:number){
  const pixels=raster(layer,size),polygon=curve(layer.points);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    expect(pixels[i]).toBe(255);expect(pixels[i+1]).toBe(255);expect(pixels[i+2]).toBe(255);
    expect(pixels[i+3]).toBe(Math.round(255*coverage((x+.5)/size,(y+.5)/size,layer,polygon)));
  }
}

test("prepared raster pruning preserves frozen pre-optimization complex masks",()=>{
  const layer=initialRecipe().layers[0];
  layer.softness={mode:"boundary",blend:.0000078125};
  layer.points.forEach((p,i)=>{p.weight=i/(layer.points.length-1);p.feather=.001+.04*i/(layer.points.length-1);});
  layer.fields[0].du=.012;layer.fields[0].dv=-.004;
  expect(curve(layer.points)).toHaveLength(170);
  for(const [size,hash] of [[512,"0b3b58383865e9b3fd55f9ff7d496646f38420d8c0f9caa3fc34d6d2b6601d71"],
    [1024,"1e279223b7430a45ddbfb186d6910d69b4a110dc248ac50a8c79dbf10d8549cc"]] as const)
    expect(new Bun.CryptoHasher("sha256").update(raster(layer,size)).digest("hex")).toBe(hash);
});

test("randomized mirrored, warped pigment and softness masks match untouched scalar coverage",()=>{
  let state=917426;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
  for(let fixture=0;fixture<20;fixture++){
    let layer=initialRecipe().layers[0];
    const count=3+fixture%6,cx=.25+random()*.5,cy=.25+random()*.5,uniform=random();
    layer.pathMode="catmull-rom";
    layer.points=Array.from({length:count},(_,i)=>({u:cx+(.06+random()*.15)*Math.cos(i*2*Math.PI/count),
      v:cy+(.06+random()*.15)*Math.sin(i*2*Math.PI/count),weight:fixture%4===0?uniform:random(),feather:.0005+.0595*random()}));
    layer.feather=.0005+.0595*random();layer.opacity=random();layer.symmetry=fixture%3!==0;
    layer.strength=fixture%3===0?{mode:"legacy-nearest"}:{mode:"smooth-boundary",blend:.000125+.019875*random()};
    layer.softness=fixture%4===0?{mode:"uniform"}:{mode:"boundary",blend:10**(-7+4*random())};
    layer.fields=Array.from({length:fixture%9},(_,i)=>({id:`field-${i}`,u:random(),v:random(),
      du:(random()-.5)*.2,dv:(random()-.5)*.2,radius:.005+.195*random()}));
    if(fixture%2===0)layer=convertToBezier(layer);
    compareScalar(layer,fixture%2===0?32:31);
  }
});

test("degenerate paths, crossing ties, saturation boundaries and outside-atlas tangents preserve scalar bytes",()=>{
  const make=(coords:number[][]):Layer=>{
    const layer=initialRecipe().layers[0];layer.pathMode="catmull-rom";layer.fields=[];
    layer.points=coords.map(([u,v],i)=>({u,v,weight:i/(coords.length-1),feather:.0005+.0595*i/(coords.length-1)}));
    layer.softness={mode:"boundary",blend:1e-7};return layer;
  };
  for(const coords of [[[.5,.5],[.5,.5],[.5,.5]],[[.2,.2],[.8,.8],[.8,.2],[.2,.8]],
    [[.2,.2],[.2,.2],[.8,.2],[.8,.8],[.2,.8]]])compareScalar(make(coords),32);
  const boundary=convertToBezier(make([[.265625,.25],[.765625,.25],[.765625,.75],[.265625,.75]]));
  for(const width of [.0005,.03125,.06]){
    boundary.points.forEach(p=>p.feather=width);boundary.feather=width;
    compareScalar(boundary,32);
  }
  const extreme=convertToBezier(make([[.2,.2],[.8,.2],[.8,.8],[.2,.8]]));
  extreme.points[0].handles={mode:"corner",in:{u:-1,v:-1},out:{u:1,v:1}};
  extreme.fields=[{id:"max",u:.5,v:.5,du:.1,dv:-.1,radius:.2}];compareScalar(extreme,17);
  const job=createRasterJob(extreme,32);while(!job.done)job.advance(7);
  expect(job.data).toEqual(raster(extreme,32));
  extreme.enabled=false;compareScalar(extreme,17);
});

test("binary symmetric pairs preserve scalar clipping and one-pixel cooperative slices",()=>{
  const layer=initialRecipe().layers[0];
  layer.pathMode="catmull-rom";layer.fields=[];layer.feather=.06;
  layer.points=[[.01,.05],[.99,.05],[.99,.95],[.01,.95]].map(([u,v],i)=>({u,v,weight:i%2?.73:1}));
  for(const size of [1,2,8,31,32,33])compareScalar(layer,size);
  const reference=structuredClone(layer),job=createRasterJob(layer,32);
  let calls=0,previous=job.data.slice();
  while(!job.done){
    job.advance(1);calls++;
    let writes=0;for(let i=3;i<job.data.length;i+=4)if(previous[i]!==job.data[i])writes++;
    expect(writes).toBeLessThanOrEqual(1);
    previous=job.data.slice();
    // Mutating the source during a split pair cannot affect the pending pixel.
    if(calls===1){layer.symmetry=false;layer.opacity=0;}
    expect(calls).toBeLessThanOrEqual(1024);
  }
  expect(job.data).toEqual(raster(reference,32));
  expect(calls).toBeGreaterThan(0);
});
