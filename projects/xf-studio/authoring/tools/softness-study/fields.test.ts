import {expect,test} from "bun:test";
import {preparePigmentStrength} from "../../src/pigment-strength";
import {fixtures,strip,widthField,prepareCoverage,subdivide} from "./fields";

test("positive smooth widths remove medial-axis winner seams and remain bounded",()=>{
 const p=strip(.004),nearest=prepareCoverage(p,null);
 expect(Math.abs(nearest(.5,.402-1e-8)-nearest(.5,.402+1e-8))).toBeGreaterThan(.4);
 for(const mode of["linear","log"]as const){const f=widthField(p,.000125,mode),alpha=prepareCoverage(p,f);
  expect(Math.abs(alpha(.5,.402-1e-8)-alpha(.5,.402+1e-8))).toBeLessThan(1e-5);
  for(let y=0;y<100;y++){const v=.38+y*.05/99;expect(f(.5,v)).toBeGreaterThanOrEqual(.001-1e-15);expect(f(.5,v)).toBeLessThanOrEqual(.04+1e-15);expect(Number.isFinite(alpha(.5,v))).toBe(true);}
 }
});

test("uniform width fast path returns exact value for both encodings",()=>{
 for(const width of[.0005,.001,.012,.06])for(const mode of["linear","log"]as const){const p=fixtures.corner.map(p=>({...p,width})),f=widthField(p,.000125,mode);
  for(const[u,v]of[[.2,.2],[.3,.3],[.5,.5],[.7,.3],[.8,.8]])expect(f(u,v)).toBe(width);
 }
});

test("width interpolation is invariant to subdivision in its declared space",()=>{
 for(const mode of["linear","log"]as const)for(const p of Object.values(fixtures)){
  const a=widthField(p,.000125,mode),b=widthField(subdivide(p,mode,11),.000125,mode);
  for(let y=0;y<=10;y++)for(let x=0;x<=10;x++)expect(Math.abs(a(.2+x*.06,.2+y*.06)-b(.2+x*.06,.2+y*.06))).toBeLessThan(1e-11);
 }
});

test("geometric boundary remains half pigment even at opposing-width crossings",()=>{
 for(const mode of["linear","log"]as const)for(const p of Object.values(fixtures)){
  const a=prepareCoverage(p,widthField(p,.000125,mode)),pigment=preparePigmentStrength(p,.0005);
  for(let i=0;i<p.length;i++){const q=p[i],r=p[(i+1)%p.length];for(let j=0;j<=20;j++){const u=q.u+(r.u-q.u)*j/20,v=q.v+(r.v-q.v)*j/20;expect(Math.abs(a(u,v)-.5*pigment(u,v))).toBeLessThan(1e-11);}}
 }
});

test("log blend demonstrably limits sharp-edge widening but does not eliminate it",()=>{
 const p=strip(.004),linear=widthField(p,.000125,"linear")(.5,.4),log=widthField(p,.000125,"log")(.5,.4);
 expect(linear/.001).toBeGreaterThan(2);
 expect(log/.001).toBeGreaterThan(1.1);expect(log/.001).toBeLessThan(1.15);
 const crossing=fixtures.crossing;
 expect(widthField(crossing,.000125,"linear")(.5,.5)).toBeCloseTo(.0205,10);
 expect(widthField(crossing,.000125,"log")(.5,.5)).toBeCloseTo(Math.sqrt(.001*.04),10);
});

test("record log-width inward opacity reversal instead of hiding the failure",()=>{
 const p=strip(.004);
 for(const mode of["linear","log"]as const){
  const a=prepareCoverage(p,widthField(p,.0000078125,mode));let peak=0,maxDrop=0;
  for(let i=0;i<=1000;i++){const alpha=a(.5,.4+.002*i/1000);peak=Math.max(peak,alpha);maxDrop=Math.max(maxDrop,peak-alpha);}
  if(mode==="log")expect(maxDrop).toBeGreaterThan(.06);
  else expect(maxDrop).toBeLessThan(1e-12);
 }
});
