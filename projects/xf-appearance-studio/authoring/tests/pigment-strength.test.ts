import { describe, expect, test } from "bun:test";
import { preparePigmentStrength } from "../src/pigment-strength";
import { coverage, curve, initialRecipe, parseRecipe, raster, warpFields,
  DEFAULT_STRENGTH_BLEND, MIN_STRENGTH_BLEND, MAX_STRENGTH_BLEND,
  type Layer, type Point } from "../src/recipe";

const points = (values: number[][]): Point[] => values.map(([u, v, weight]) => ({ u, v, weight }));
const square = points([[.3,.3,0],[.7,.3,0],[.7,.7,1],[.3,.7,1]]);
const thin = points([[.3,.498,0],[.7,.498,0],[.7,.502,1],[.3,.502,1]]);
const crossing = points([[.3,.3,0],[.7,.7,0],[.3,.7,1],[.7,.3,1]]);
function layer(polygon: Point[] = square): Layer {
  return { ...initialRecipe().layers[0], pathMode: "catmull-rom", points: structuredClone(polygon), fields: [], symmetry: false, opacity: 1 };
}
// Independent midpoint quadrature, with no analytical primitive in common with
// production. Resolution is sufficient for epsilon .002 even on the boundary.
function quadrature(polygon: Point[], u: number, v: number, blend: number, bins = 20000): number {
  let numerator = 0, denominator = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.u-a.u, b.v-a.v);
    for (let j = 0; j < bins; j++) {
      const t = (j + .5) / bins;
      const x = a.u * (1-t) + b.u*t, y = a.v * (1-t) + b.v*t;
      const kernel = length / bins / ((u-x)**2 + (v-y)**2 + blend**2);
      numerator += (a.weight*(1-t)+b.weight*t)*kernel;
      denominator += kernel;
    }
  }
  return numerator / denominator;
}

describe("continuous pigment strength", () => {
  test("analytical field matches independent line integration including boundary and exterior", () => {
    for (const polygon of [square, thin, crossing, curve(layer().points)]) {
      const evaluate = preparePigmentStrength(polygon, .002);
      for (const [u,v] of [[.5,.5],[.4,.3],[.9,.3],[.34,.498],[.499,.501]])
        expect(Math.abs(evaluate(u,v)-quadrature(polygon,u,v,.002))).toBeLessThan(2e-8);
    }
    const fine=preparePigmentStrength(thin,MIN_STRENGTH_BLEND);
    for(const [u,v] of [[.42,.498],[.3,.498],[.7,.502]])
      expect(Math.abs(fine(u,v)-quadrature(thin,u,v,MIN_STRENGTH_BLEND,200000))).toBeLessThan(2e-8);
  });

  test("nearest-boundary switch no longer introduces a full-opacity interior seam", () => {
    const smooth = layer(), legacy = { ...smooth, strength: { mode: "legacy-nearest" as const } };
    const jump = (l: Layer, delta: number) => Math.abs(coverage(.5,.5-delta,l,square)-coverage(.5,.5+delta,l,square));
    expect(jump(legacy,1e-8)).toBe(1);
    expect(jump(smooth,1e-8)).toBeLessThan(1e-7);
    expect(jump(smooth,1e-9)).toBeLessThan(jump(smooth,1e-8)/9);
  });

  test("crossings and thin opposed edges are finite, bounded, continuous and order independent", () => {
    for (const polygon of [crossing, thin]) {
      for (const blend of [MIN_STRENGTH_BLEND,DEFAULT_STRENGTH_BLEND,MAX_STRENGTH_BLEND]) {
        const evaluate = preparePigmentStrength(polygon,blend);
        const reversed = preparePigmentStrength([...polygon].reverse(),blend);
        expect(evaluate(.5,.5)).toBeCloseTo(.5,10);
        for (let i=0;i<101;i++) {
          const u=.49+i*.0002, v=.5+(i%3-1)*1e-8, value=evaluate(u,v);
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
          expect(value).toBeCloseTo(reversed(u,v),10);
        }
        expect(Math.abs(evaluate(.5-1e-8,.5-1e-8)-evaluate(.5+1e-8,.5-1e-8))).toBeLessThan(1e-6);
      }
    }
  });

  test("adding collinear samples, reordering, rotating and mirroring do not repaint a boundary", () => {
    const split = square.flatMap((a,i) => {
      const b=square[(i+1)%square.length];
      const count=i===1?17:1;
      return Array.from({length:count},(_,j)=>({u:a.u+(b.u-a.u)*j/count,v:a.v+(b.v-a.v)*j/count,
        weight:a.weight+(b.weight-a.weight)*j/count}));
    });
    const angle=.72, rotate=(u:number,v:number)=>({u:u*Math.cos(angle)-v*Math.sin(angle),v:u*Math.sin(angle)+v*Math.cos(angle)});
    const base=preparePigmentStrength(square,.0005), subdivided=preparePigmentStrength(split,.0005);
    const rotated=preparePigmentStrength(square.map(p=>({...p,...rotate(p.u,p.v)})),.0005);
    const mirrored=preparePigmentStrength(square.map(p=>({...p,u:1-p.u})),.0005);
    for(let i=0;i<100;i++) {
      const u=.25+i*.005, v=.31+(i%13)*.03, q=rotate(u,v);
      expect(subdivided(u,v)).toBeCloseTo(base(u,v),11);
      expect(rotated(q.u,q.v)).toBeCloseTo(base(u,v),11);
      expect(mirrored(1-u,v)).toBeCloseTo(base(u,v),11);
    }
  });

  test("collapsed, repeated and very short edges have a defined finite limit", () => {
    const collapsed=points([[.5,.5,0],[.5,.5,.5],[.5,.5,1]]);
    const mean=preparePigmentStrength(collapsed,.0005);
    expect(mean(.5,.5)).toBe(.5);
    expect(mean(1,1)).toBe(.5);
    expect(preparePigmentStrength([],.0005)(.5,.5)).toBe(0);
    for(const step of [1e-5,1e-9,1e-13]) {
      const polygon=points([[.5,.5,0],[.5+step,.5,1],[.5+step,.5,1],[.5,.5,0]]);
      const evaluate=preparePigmentStrength(polygon,.0005);
      for(const [u,v] of [[.5,.5],[.8,.7],[0,0]]) {
        expect(Number.isFinite(evaluate(u,v))).toBe(true);
        expect(evaluate(u,v)).toBeCloseTo(quadrature(polygon,u,v,.0005,1000),8);
      }
    }
    for(const blend of [0,-1,NaN,Infinity]) expect(()=>preparePigmentStrength(square,blend)).toThrow();
    const collapsedLayer=layer(collapsed), polygon=curve(collapsed);
    expect(Number.isFinite(coverage(.5,.5,collapsedLayer,polygon))).toBe(true);
    expect(raster(collapsedLayer,128).every(Number.isFinite)).toBe(true);
  });

  test("prepared fields are immutable snapshots without stale cross-render caches", () => {
    const polygon=structuredClone(square), prepared=preparePigmentStrength(polygon,.0005);
    const before=prepared(.4,.4);
    polygon[0].weight=1; polygon[1].u=.9;
    expect(prepared(.4,.4)).toBe(before);
    expect(preparePigmentStrength(polygon,.0005)(.4,.4)).not.toBe(before);
    const changing=layer(), old=raster(changing,96);
    changing.points[0].weight=1;
    expect(raster(changing,96)).not.toEqual(old);
  });

  test("uniform smooth masks retain legacy bytes with zero, varied and mirrored warps", () => {
    for(const weight of [0,.37,1]) for(const symmetry of [false,true]) {
      const smooth=initialRecipe().layers[0];
      smooth.points.forEach(p=>p.weight=weight); smooth.symmetry=symmetry;
      smooth.fields[0].du=.03; smooth.fields[0].dv=-.02;
      smooth.fields.push({...smooth.fields[0],id:"opposed",u:.4,du:-.012,dv:.01,radius:.027});
      expect(raster(smooth,256)).toEqual(raster({...smooth,strength:{mode:"legacy-nearest"}},256));
    }
  });

  test("raster and scalar evaluation use the same inverse-warped strength including symmetry", () => {
    const warped=initialRecipe().layers[0];
    warped.points.forEach((p,i)=>p.weight=i%2);
    warped.fields[0].du=.035; warped.fields[0].dv=.016;
    warped.fields.push({...warped.fields[0],id:"other",u:.43,du:-.018,radius:.03});
    const unwarped={...warped,symmetry:false,fields:[]}, polygon=curve(warped.points), size=96;
    const pixels=raster(warped,size);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const u=(x+.5)/size,v=(y+.5)/size;
      const a=warpFields(u,v,warped.fields),b=warpFields(1-u,v,warped.fields);
      const expected=Math.max(coverage(...a,unwarped,polygon),coverage(...b,unwarped,polygon));
      expect(pixels[(y*size+x)*4+3]).toBe(Math.round(255*expected));
    }
  });

  test("current recipe persists explicit semantics and rejects ambiguous legacy and invalid blend values", () => {
    const recipe=initialRecipe();
    expect(recipe.schema).toBe("xfs/recipe-6");
    expect(recipe.layers[0].strength).toEqual({mode:"smooth-boundary",blend:DEFAULT_STRENGTH_BLEND});
    recipe.layers[1].strength={mode:"legacy-nearest"};
    expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    const v3:any=structuredClone(recipe);v3.schema="xfs/recipe-3";
    expect(()=>parseRecipe(v3)).toThrow();
    v3.layers.forEach((l:any)=>{ delete l.strength; delete l.pathMode; delete l.softness; l.points.forEach((p:any)=>{ delete p.handles; delete p.feather; }); });
    const original=JSON.stringify(v3),converted=parseRecipe(v3);
    expect(converted.layers.every(l=>l.strength.mode==="legacy-nearest")).toBe(true);
    expect(JSON.stringify(v3)).toBe(original);
    expect(parseRecipe(converted)).toEqual(converted);
    for(const strength of [undefined,null,{},[],{mode:"bad"},{mode:"legacy-nearest",blend:.001},
      ...[0,MIN_STRENGTH_BLEND/2,MAX_STRENGTH_BLEND*2,NaN,Infinity].map(blend=>({mode:"smooth-boundary",blend}))]) {
      const bad:any=structuredClone(recipe);bad.layers[0].strength=strength;
      expect(()=>parseRecipe(bad)).toThrow();
    }
    for(const blend of [MIN_STRENGTH_BLEND,MAX_STRENGTH_BLEND]) {
      recipe.layers[0].strength={mode:"smooth-boundary",blend};
      expect(parseRecipe(recipe)).toEqual(recipe);
    }
  });
});
