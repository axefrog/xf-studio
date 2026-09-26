import {describe,test,expect} from "bun:test";
import { curve, warpFields, DEFAULT_SOFTNESS_BLEND, type Layer, type Point } from "../src/engines/layered-makeup/recipe";
import {editSoftness} from "../src/engines/layered-makeup/softness-edit";
import {bezierAt,splitBezierSegment} from "../src/engines/layered-makeup/bezier-path";
import {insertPathPoint} from "../src/engines/layered-makeup/path-edit";
import { coverage, raster, initialRecipe, transformLayer } from "./fixtures/eye-region";
import { readRecipe as parseRecipe, parseRecipeFile } from "../src/recipe-schema";

function strip(): Layer {
  const l=editSoftness(initialRecipe().layers[0],{kind:"variable-softness",enabled:true});
  l.points=[{u:.2,v:.4,weight:1,feather:.001},{u:.8,v:.4,weight:1,feather:.001},{u:.8,v:.404,weight:1,feather:.04},{u:.2,v:.404,weight:1,feather:.04}];
  l.points=l.points.map((p,i,all)=>{const a=all[(i+all.length-1)%all.length],b=all[(i+1)%all.length];return {...p,handles:{mode:"corner",in:{u:(a.u-p.u)/3,v:(a.v-p.v)/3},out:{u:(b.u-p.u)/3,v:(b.v-p.v)/3}}};});
  l.fields=[];l.opacity=1;l.symmetry=false;l.feather=.0005;
  return l;
}

describe("versioned boundary edge softness",()=>{
  test("all old schemas migrate to uniform without changing their masks",()=>{
    for(const version of[1,2,3,4,5]){
      const reference=initialRecipe();reference.layers.forEach(l=>{l.strength={mode:"legacy-nearest"};l.fields[0].du=.004;if(version<5){l.pathMode="catmull-rom";l.points=l.points.map(({handles:_,...p})=>p)}});
      const old:any=structuredClone(reference);old.schema=version===1?"eye-artistry/recipe-1":`xfs/recipe-${version}`;
      for(const l of old.layers){delete l.softness;if(version<5)delete l.pathMode;if(version<4)delete l.strength;if(version<3){const{id:_,...field}=l.fields[0];l.field=field;delete l.fields;}}
      const before=JSON.stringify(old),loaded=parseRecipe(old);
      expect(parseRecipeFile(old).schema).toBe("xfs/recipe-7");expect(loaded.layers.every(l=>l.softness.mode==="uniform")).toBe(true);
      expect(raster(loaded.layers[0],128)).toEqual(raster(reference.layers[0],128));
      expect(JSON.stringify(old)).toBe(before);
      const ambiguous=structuredClone(old);ambiguous.layers[0].softness={mode:"uniform"};expect(()=>parseRecipe(ambiguous)).toThrow();
      const pointAmbiguous=structuredClone(old);pointAmbiguous.layers[0].points[0].feather=.01;expect(()=>parseRecipe(pointAmbiguous)).toThrow();
    }
  });

  test("strict current parsing bounds widths and positive blend without discarding uniform memories",()=>{
    const recipe=initialRecipe();recipe.layers[0]=strip();
    expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    for(const change of[
      (r:any)=>delete r.layers[0].softness,
      (r:any)=>{r.layers[0].softness.blend=0},
      (r:any)=>{r.layers[0].softness.blend=1e-8},
      (r:any)=>{r.layers[0].softness.blend=.002},
      (r:any)=>{r.layers[0].softness={mode:"uniform",blend:DEFAULT_SOFTNESS_BLEND}},
      (r:any)=>delete r.layers[0].points[0].feather,
      (r:any)=>{r.layers[0].points[0].feather=.00049},
      (r:any)=>{r.layers[0].points[0].feather=.061},
      (r:any)=>{r.layers[0].points[0].feather=NaN},
    ]){const r=structuredClone(recipe);change(r);expect(()=>parseRecipe(r)).toThrow();}
    recipe.layers[0].softness={mode:"uniform"};delete recipe.layers[0].points[1].feather;
    expect(parseRecipe(recipe).layers[0].points).toEqual(recipe.layers[0].points);
    recipe.layers[0].points[0].feather=0;expect(()=>parseRecipe(recipe)).toThrow();
  });

  test("uniform and constant point widths have exact alpha bytes for both pigment modes",()=>{
    for(const strength of["legacy-nearest","smooth-boundary"]as const)for(const width of[.0005,.012,.06])for(const varied of[false,true]){
      const l=initialRecipe().layers[0];l.strength=strength==="legacy-nearest"?{mode:strength}:{mode:strength,blend:.0005};l.feather=width;
      l.points.forEach((p,i)=>p.weight=varied?i/5:.37);l.fields[0].du=.003;l.fields[0].dv=-.002;
      const b=editSoftness(l,{kind:"variable-softness",enabled:true});b.feather=.001;
      expect(raster(b,128)).toEqual(raster(l,128));
      const off=editSoftness(b,{kind:"variable-softness",enabled:false});off.feather=width;
      expect(raster(off,128)).toEqual(raster(l,128));
    }
  });

  test("editing is immutable and toggling preserves custom widths independently of pigment",()=>{
    const original=initialRecipe().layers[0],before=structuredClone(original);
    let changed=editSoftness(original,{kind:"variable-softness",enabled:true});
    expect(changed.points.every(p=>p.feather===original.feather)).toBe(true);
    changed=editSoftness(changed,{kind:"point-softness",index:2,value:.04});
    const widths=changed.points.map(p=>p.feather);
    changed=editSoftness(changed,{kind:"variable-softness",enabled:false});
    changed=editSoftness(changed,{kind:"uniform-softness",value:.008});
    expect(changed.points.map(p=>p.feather)).toEqual(widths);
    changed=editSoftness(changed,{kind:"variable-softness",enabled:true});
    expect(changed.points.map(p=>p.feather)).toEqual(widths);
    expect(changed.points.map(p=>p.weight)).toEqual(original.points.map(p=>p.weight));
    expect(changed.strength).toEqual(original.strength);expect(original).toEqual(before);
    expect(()=>editSoftness(original,{kind:"point-softness",index:0,value:.01})).toThrow();
    expect(()=>editSoftness(changed,{kind:"point-softness",index:100,value:.01})).toThrow();
    expect(()=>editSoftness(changed,{kind:"point-softness",index:0,value:NaN})).toThrow();
    expect(()=>editSoftness(changed,{kind:"uniform-softness",value:.1})).toThrow();
  });

  test("opposing widths blend continuously with independent pigment and half-alpha boundary",()=>{
    const l=strip();
    expect(curve(l.points).length).toBe(4);
    expect(Math.abs(coverage(.5,.402-1e-8,l)-coverage(.5,.402+1e-8,l))).toBeLessThan(2e-6);
    expect(coverage(.5,.402,l)).toBeCloseTo(.6444842645927948,12);
    expect(coverage(.5,.4,l)).toBeCloseTo(.5,12);expect(coverage(.5,.404,l)).toBeCloseTo(.5,12);
    let previous=0;
    for(let i=0;i<=100;i++){const alpha=coverage(.5,.398+.004*i/100,l);expect(alpha).toBeGreaterThanOrEqual(previous-1e-12);previous=alpha;}
    const pigment=structuredClone(l);pigment.points.forEach(p=>p.weight=.4);pigment.opacity=.7;
    expect(coverage(.5,.4,pigment)).toBeCloseTo(.5*.4*.7,12);
    for(const p of l.points)p.feather=.001;
    expect(coverage(.5,.402,l)).toBe(1);
  });

  test("width follows inverse warp and reflected source coordinates with conservative raster bounds",()=>{
    const source=strip(),l=structuredClone(source);l.symmetry=true;l.fields=[{id:"warp",u:.5,v:.4,du:.025,dv:-.008,radius:.1}];
    for(const q of[{u:.46,v:.4},{u:.51,v:.407},{u:.4,v:.42}]){
      const [u,v]=warpFields(q.u,q.v,l.fields),[mu,mv]=warpFields(1-q.u,q.v,l.fields);
      expect(coverage(q.u,q.v,l)).toBeCloseTo(Math.max(coverage(u,v,source),coverage(mu,mv,source)),12);
      expect(coverage(1-q.u,q.v,l)).toBeCloseTo(coverage(q.u,q.v,l),12);
    }
    const size=128,data=raster(l,size);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)expect(data[(y*size+x)*4+3]).toBe(Math.round(coverage((x+.5)/size,(y+.5)/size,l)*255));
    expect(coverage(.5,.412,source)).toBeGreaterThan(0); // Beyond fallback feather padding.
  });

  test("curve attributes and both insertion styles interpolate widths without inventing old keys",()=>{
    const b=strip(),t=.373;
    const split=splitBezierSegment(b.points,1,t)!;
    expect(split[2].feather).toBeCloseTo(.001*(1-t)+.04*t,14);
    for(const s of[0,.1,.5,.9,1]){
      expect(bezierAt(split,1,s).feather).toBeCloseTo(bezierAt(b.points,1,t*s).feather!,14);
      expect(bezierAt(split,2,s).feather).toBeCloseTo(bezierAt(b.points,1,t+(1-t)*s).feather!,14);
    }
    const legacy=structuredClone(b);legacy.pathMode="catmull-rom";legacy.points=legacy.points.map(({handles:_,...p})=>p);
    const samples=curve(legacy.points);expect(samples[15].feather).toBeCloseTo(.0205,14);
    const inserted=insertPathPoint(legacy.points,{u:.81,v:.402},{u:1000,v:1000})!;
    expect(inserted.point.feather).toBeCloseTo(.001*(1-inserted.t)+.04*inserted.t,14);
    const old=initialRecipe().layers[0];
    expect(curve(old.points).every(p=>!("feather"in p))).toBe(true);
    expect(splitBezierSegment(old.points,0,.5)!.every(p=>!("feather"in p))).toBe(true);
    expect(bezierAt(old.points,0,.5)).not.toHaveProperty("feather");
  });

  test("scale changes all remembered widths and blend; rotation/translation retain scalar widths",()=>{
    const l=strip(),scaled=transformLayer(l,{kind:"scale",pivot:{u:.5,v:.402},factor:1.1})!;
    expect(scaled).not.toBeNull();expect(scaled.points.map(p=>p.feather)).toEqual(l.points.map(p=>p.feather!*1.1));
    expect(scaled.softness).toEqual({mode:"boundary",blend:DEFAULT_SOFTNESS_BLEND*1.1});
    for(const q of[{u:.5,v:.4},{u:.5,v:.402},{u:.5,v:.41}])expect(coverage(.5+(q.u-.5)*1.1,.402+(q.v-.402)*1.1,scaled)).toBeCloseTo(coverage(q.u,q.v,l),11);
    const moved=transformLayer(l,{kind:"translate",du:.03,dv:.03})!,rotated=transformLayer(l,{kind:"rotate",pivot:{u:.5,v:.402},radians:.2})!;
    for(const result of[moved,rotated]){expect(result.softness).toEqual(l.softness);expect(result.points.map(p=>p.feather)).toEqual(l.points.map(p=>p.feather));}
    l.softness={mode:"uniform"};const hidden=transformLayer(l,{kind:"scale",pivot:{u:.5,v:.402},factor:1.1})!;
    expect(hidden.points.map(p=>p.feather)).toEqual(l.points.map(p=>p.feather!*1.1));
    l.points[0].feather=.06;expect(transformLayer(l,{kind:"scale",pivot:{u:.5,v:.402},factor:1.1})).toBeNull();
  });

  test("splitting schema-bound widths cannot introduce out-of-range rounding",()=>{
    for(const width of[.0005,.06]) {
      const r=initialRecipe();r.layers[0]=editSoftness(r.layers[0],{kind:"variable-softness",enabled:true});r.layers[0].points.forEach(p=>p.feather=width);
      for(let i=1;i<1000;i++){
        const split=splitBezierSegment(r.layers[0].points,0,i/1000)!;
        expect(split[1].feather).toBe(width);
        expect(parseRecipe({...r,layers:[{...r.layers[0],points:split}]}).layers[0].points[1].feather).toBe(width);
      }
      expect(curve(r.layers[0].points).every(p=>p.feather===width)).toBe(true);
    }
  });

  test("conflicting crossing widths stay finite at the smallest regularizer",()=>{
    const l=strip();l.softness={mode:"boundary",blend:1e-7};
    const rows=[[.3,.3,.001],[.7,.7,.001],[.3,.7,.04],[.7,.3,.04]];
    l.points=rows.map(([u,v,feather])=>({u,v,feather,weight:1}));
    l.points=l.points.map((p,i,all)=>{const a=all[(i+all.length-1)%all.length],b=all[(i+1)%all.length];return {...p,handles:{mode:"corner",in:{u:(a.u-p.u)/3,v:(a.v-p.v)/3},out:{u:(b.u-p.u)/3,v:(b.v-p.v)/3}}};});
    expect(coverage(.5,.5,l)).toBeCloseTo(.5,11);
    for(const e of[1e-4,1e-6,1e-8,1e-10])for(const [du,dv]of[[e,e],[e,-e],[-e,e],[-e,-e]]) {
      const alpha=coverage(.5+du,.5+dv,l);expect(Number.isFinite(alpha)).toBe(true);expect(alpha).toBeGreaterThanOrEqual(0);expect(alpha).toBeLessThanOrEqual(1);
    }
  });
});
