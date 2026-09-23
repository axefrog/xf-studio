import {describe, expect, test} from "bun:test";
import {composeFlakeColour, createFlakeBakeJob, createFlakeCatalogue, createRegionFlakeCatalogueJob, createFlakeColourJob, defaultIrregularFlakes, FLAKE_LIMITS, FLAKE_MATERIAL, type Flake, type IrregularFlakes} from "../src/flake-field";

function inside(f: Flake, u: number, v: number) {
  // Independent enclosing-radius rejection; no reuse of raster bounds or tile index.
  if(Math.abs(u-f.u)>f.radius || Math.abs(v-f.v)>f.radius) return false;
  return f.vertices.every((a,k) => {const b = f.vertices[(k+1)%6]!; return (b.u-a.u)*(v-a.v)-(b.v-a.v)*(u-a.u) >= 0;});
}
const byte = (x: number) => Math.round(Math.max(0,Math.min(1,x))*255);
describe("isolated irregular planar flake study", () => {
  test("count appends stable geometry, independent of colour and source mutation", () => {
    const settings = {...defaultIrregularFlakes(),count: 20};
    const small = createFlakeCatalogue(settings);
    settings.radius = .003;
    const large = createFlakeCatalogue({...defaultIrregularFlakes(),count: 100,color:"#0000ff"});
    expect(large.flakes.slice(0,20)).toEqual([...small.flakes]);
    expect(small.settings.radius).toBe(.0012);
    expect(Object.isFrozen(small.flakes[0]!.vertices[0])).toBe(true);
    expect(Object.isFrozen(small.flakes[0]!.normal)).toBe(true);
    expect(Object.isFrozen(small.settings)).toBe(true);
  });
  test("bounds, convexity and bounded positive-Z unit facet normals", () => {
    const catalogue = createFlakeCatalogue({...defaultIrregularFlakes(),count:4096,spread:1,tilt:1,radius:.003});
    let minRadius = Infinity, maxRadius = 0;
    for (const f of catalogue.flakes) {
      minRadius = Math.min(minRadius,f.radius); maxRadius = Math.max(maxRadius,f.radius);
      expect(f.u >= 0 && f.u < 1 && f.v >= 0 && f.v < 1).toBe(true);
      expect(Math.hypot(...f.normal)).toBeCloseTo(1,12);
      expect(f.normal[2]).toBeGreaterThanOrEqual(Math.cos(1.1));
      expect(f.vertices.every((a,i) => {
        const b=f.vertices[(i+1)%6]!,c=f.vertices[(i+2)%6]!;
        return (b.u-a.u)*(c.v-b.v)-(b.v-a.v)*(c.u-b.u)>0 && a.u>=f.bounds.minU && a.u<=f.bounds.maxU && a.v>=f.bounds.minV && a.v<=f.bounds.maxV;
      })).toBe(true);
    }
    expect(minRadius).toBeGreaterThanOrEqual(.003*.2);
    expect(maxRadius).toBeLessThan(.006);
    const uniform=createFlakeCatalogue({...defaultIrregularFlakes(),count:32,spread:0});
    expect(uniform.flakes.every(f=>f.radius===uniform.settings.radius)).toBe(true);
  });
  test("cooperative output equals complete output, with fixed tile scratch at every resolution", () => {
    const catalogue = createFlakeCatalogue({...defaultIrregularFlakes(),count:1500,radius:.003});
    const a=createFlakeBakeJob(catalogue,129),b=createFlakeBakeJob(catalogue,129,2);
    a.advance(Infinity);
    while(!b.advance(7)) {}
    expect(b.normal).toEqual(a.normal); expect(b.surface).toEqual(a.surface);
    expect(new Bun.CryptoHasher("sha256").update(a.normal).digest("hex")).toBe("7e6567c62a8500b861a356b25165e44751bf175ba3d64a55e4ab005e92af8011");
    expect(new Bun.CryptoHasher("sha256").update(a.surface).digest("hex")).toBe("e226b0cb3d83aa81e156c24a7bd7921f6ea45b9257f548648154f1793bcfb72b");
    expect(b.diagnostics.candidateVisits).toBe(a.diagnostics.candidateVisits);
    expect(b.diagnostics.pixels).toBe(129**2);
    expect(b.diagnostics.subsampleTests).toBe(b.diagnostics.candidateVisits*4);
    const large=createFlakeBakeJob(catalogue,4096);
    expect(large.diagnostics.scratchBytes).toBe(a.diagnostics.scratchBytes);
    expect(large.diagnostics.scratchBytes).toBe(32*32*4*4);
    expect(large.advance(1)).toBe(false);
    expect(large.diagnostics.indexedFlakes).toBe(1);
    expect(large.diagnostics.pixels).toBe(0);
  });
  for(const sampleAxis of [2,4] as const) test(`${sampleAxis}x${sampleAxis} tile boundaries and topmost overlap agree with independent exhaustive samples`, () => {
    const catalogue=createFlakeCatalogue({...defaultIrregularFlakes(),count:1600,radius:.003,spread:1,tilt:1});
    const size=65,job=createFlakeBakeJob(catalogue,size,sampleAxis),conditional=createFlakeBakeJob(catalogue,size,sampleAxis,"covered-average");
    job.advance(Infinity);conditional.advance(Infinity);
    expect(conditional.surface).toEqual(job.surface);
    const samples=Array.from({length:sampleAxis**2},(_,i)=>[(i%sampleAxis+.5)/sampleAxis,(Math.floor(i/sampleAxis)+.5)/sampleAxis]);
    let overlapSamples=0,edgeHits=0,mixedFacets=0,emptyPixels=0,partialPixels=0;
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      let nx=0,ny=0,nz=0,coveredZ=0,n=0;
      const facets=new Set<number>();
      for(const s of samples) {
        const hits=catalogue.flakes.filter(f=>inside(f,(x+s[0]!)/size,(y+s[1]!)/size));
        if(hits.length>1) overlapSamples++;
        const f=hits.at(-1);
        if(f) {nx+=f.normal[0];ny+=f.normal[1];nz+=f.normal[2];coveredZ+=f.normal[2];n++;facets.add(f.id);if(x===31||x===32||y===31||y===32)edgeHits++;} else nz++;
      }
      const i=(y*size+x)*4, length=Math.hypot(nx,ny,nz),c=n/sampleAxis**2;
      expect(Array.from(job.normal.subarray(i,i+4))).toEqual([byte(nx/length*.5+.5),byte(ny/length*.5+.5),byte(nz/length*.5+.5),255]);
      expect(Array.from(job.surface.subarray(i,i+4))).toEqual([byte(c),byte(FLAKE_MATERIAL.baseRoughness*(1-c)+FLAKE_MATERIAL.flakeRoughness*c),byte(FLAKE_MATERIAL.flakeMetalness*c),255]);
      if(!n){emptyPixels++;coveredZ=1;}else if(n<samples.length)partialPixels++;
      if(facets.size>1)mixedFacets++;
      const coveredLength=Math.hypot(nx,ny,coveredZ);
      expect(Array.from(conditional.normal.subarray(i,i+4))).toEqual([byte(nx/coveredLength*.5+.5),byte(ny/coveredLength*.5+.5),byte(coveredZ/coveredLength*.5+.5),255]);
    }
    expect(overlapSamples).toBeGreaterThan(0); expect(edgeHits).toBeGreaterThan(0);
    expect(mixedFacets).toBeGreaterThan(0);expect(emptyPixels).toBeGreaterThan(0);expect(partialPixels).toBeGreaterThan(0);
    expect(conditional.normal).not.toEqual(job.normal);expect(conditional.diagnostics.normalMode).toBe("covered-average");
    expect(job.diagnostics.sampleCount).toBe(sampleAxis**2);
    expect(job.diagnostics.subsampleTests).toBe(job.diagnostics.candidateVisits*sampleAxis**2);
    expect(job.diagnostics.scratchBytes).toBe(32*32*sampleAxis**2*4);
    const sliced=createFlakeBakeJob(catalogue,size,sampleAxis);
    while(!sliced.advance(43)) {}
    expect(sliced.normal).toEqual(job.normal);expect(sliced.surface).toEqual(job.surface);
  });
  test("fully covered fragment interiors have one flat normal, zero count is base material", () => {
    const catalogue=createFlakeCatalogue({...defaultIrregularFlakes(),count:1,radius:.003,spread:0,tilt:1});
    const job=createFlakeBakeJob(catalogue,1024); job.advance(Infinity);
    const expected=catalogue.flakes[0]!.normal.map(n=>byte(n*.5+.5)); let full=0;
    for(let i=0;i<job.surface.length;i+=4) if(job.surface[i]===255) {expect(Array.from(job.normal.subarray(i,i+3))).toEqual(expected);full++;}
    expect(full).toBeGreaterThan(2);
    const empty=createFlakeBakeJob(createFlakeCatalogue({...defaultIrregularFlakes(),count:0}),33);empty.advance(Infinity);
    for(let i=0;i<empty.surface.length;i+=4) {
      expect(Array.from(empty.normal.subarray(i,i+4))).toEqual([128,128,255,255]);
      expect(Array.from(empty.surface.subarray(i,i+4))).toEqual([0,179,0,255]);
    }
    expect(empty.diagnostics.candidateVisits).toBe(0);
  });
  test("colour mixing is linear light, colour-independent coverage and exact arbitrary shape alpha", () => {
    const surface=new Uint8Array([0,1,2,255,128,3,4,255,255,5,6,255]);
    const alpha=new Uint8Array([0,137,255]);
    const result=composeFlakeColour(surface,"#000000","#ffffff",alpha);
    expect(Array.from(result)).toEqual([0,0,0,0,188,188,188,137,255,255,255,255]);
    const rgbaAlpha=new Uint8ClampedArray([4,5,6,0,8,9,10,137,11,12,13,255]);
    const job=createFlakeColourJob(surface,"#000000","#ffffff",rgbaAlpha);
    expect(job.advance(1)).toBe(false); expect(job.advance(2)).toBe(true);expect(job.rgba).toEqual(result);
    expect(composeFlakeColour(surface,"#cf12ab","#cf12ab",alpha)).toEqual(new Uint8Array([207,18,171,0,207,18,171,137,207,18,171,255]));
    expect(Array.from(surface)).toEqual([0,1,2,255,128,3,4,255,255,5,6,255]);
  });
  test("operational inputs reject malformed or excessive allocations", () => {
    for(const change of [{count:-1},{count:FLAKE_LIMITS.count+1},{count:1.5},{radius:0},{radius:Infinity},{spread:NaN},{tilt:2},{seed:-1},{color:"#fff"},{model:"other"},{extra:1}])
      expect(()=>createFlakeCatalogue({...defaultIrregularFlakes(),...change} as IrregularFlakes)).toThrow();
    const catalogue=createFlakeCatalogue({...defaultIrregularFlakes(),count:0});
    for(const size of [0,31,4097,NaN,Infinity,32.1]) expect(()=>createFlakeBakeJob(catalogue,size)).toThrow();
    for(const axis of [0,1,3,5,NaN,Infinity]) expect(()=>createFlakeBakeJob(catalogue,32,axis as 2)).toThrow();
    expect(()=>createFlakeBakeJob(catalogue,32,2,"other" as "surface-average")).toThrow();
    expect(()=>createFlakeBakeJob({...catalogue},32)).toThrow();
    const job=createFlakeBakeJob(catalogue,32);
    for(const work of [0,-1,.5,NaN]) expect(()=>job.advance(work)).toThrow();
    expect(()=>composeFlakeColour(new Uint8Array(3),"#000000","#ffffff")).toThrow();
    expect(()=>composeFlakeColour(new Uint8Array(4),"#000000","#ffffff",new Uint8Array(2))).toThrow();
    expect(()=>composeFlakeColour(new Uint8Array(4),"#abc","#ffffff")).toThrow();
  });
  test("bounded region catalogue preserves global IDs, prefix and complete-map samples inside its ROI",()=>{
    const settings={...defaultIrregularFlakes(),count:16000,radius:.0006},regions=[{minU:.27,maxU:.47,minV:.17,maxV:.28}];
    const whole=createFlakeCatalogue(settings),generation=createRegionFlakeCatalogueJob(settings,regions);
    expect(generation.advance(17)).toBe(false);expect(generation.catalogue).toBeUndefined();expect(generation.diagnostics().scanned).toBe(17);
    settings.color="#000000";regions[0]!.minU=.1;
    while(!generation.advance(97)){}
    const subset=generation.catalogue!;
    expect(subset.settings.color).toBe(defaultIrregularFlakes().color);expect(subset.studyRegion!.regions[0]!.minU).toBe(.27);
    expect(subset.flakes.length).toBeLessThan(1000);
    expect(subset.flakes.every(f=>JSON.stringify(f)===JSON.stringify(whole.flakes[f.id]))).toBe(true);
    const size=512,full=createFlakeBakeJob(whole,size,4),region=createFlakeBakeJob(subset,size,4);full.advance(Infinity);region.advance(Infinity);
    const roi=subset.studyRegion!.regions[0]!;
    for(let y=Math.ceil(roi.minV*size);y<Math.floor(roi.maxV*size);y++)for(let x=Math.ceil(roi.minU*size);x<Math.floor(roi.maxU*size);x++){
      const i=(y*size+x)*4;expect(region.normal.subarray(i,i+4)).toEqual(full.normal.subarray(i,i+4));expect(region.surface.subarray(i,i+4)).toEqual(full.surface.subarray(i,i+4));
    }
    const larger=createRegionFlakeCatalogueJob({...subset.settings,count:32000},subset.studyRegion!.regions);larger.advance(Infinity);
    expect(larger.catalogue!.flakes.filter(f=>f.id<16000)).toEqual([...subset.flakes]);
  });
  test("fine region study has separate bounds and yields without creating a partial catalogue",()=>{
    const regions=[{minU:.27,maxU:.47,minV:.17,maxV:.28}],settings={...defaultIrregularFlakes(),count:350000,radius:.00045};
    expect(()=>createFlakeCatalogue(settings)).toThrow();
    const job=createRegionFlakeCatalogueJob(settings,regions);job.advance(2048);
    expect(job.diagnostics().scanned).toBe(2048);expect(job.catalogue).toBeUndefined();expect(job.done).toBe(false);
    for(const invalid of [{...settings,count:500001},{...settings,radius:.0001},{...settings,radius:.0007}])expect(()=>createRegionFlakeCatalogueJob(invalid,regions)).toThrow();
    expect(()=>createRegionFlakeCatalogueJob(settings,[{minU:0,minV:0,maxU:1,maxV:1}])).toThrow();
    expect(()=>createRegionFlakeCatalogueJob(settings,[{...regions[0]!,minU:NaN}])).toThrow();
    expect(()=>job.advance(0)).toThrow();
  });
});
