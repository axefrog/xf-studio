import {describe,expect,test} from "bun:test";
import {downsample2x2,errorMetrics,facetResponse,idealAveragedResponse,integrateCrop,integrateFacetSamples,runGlintOracle,topFlakeAt,type Vec3} from "../tools/glint-oracle";
import type {Flake} from "../src/flake-field";

function rectangle(id:number,x0:number,y0:number,x1:number,y1:number,normal:Vec3):Flake{
  return {id,u:(x0+x1)/2,v:(y0+y1)/2,radius:Math.max(x1-x0,y1-y0)/2,aspect:1,angle:0,normal,
    vertices:[{u:x0,v:y0},{u:x1,v:y0},{u:x1,v:y1},{u:x0,v:y1}],
    bounds:{minU:x0,minV:y0,maxU:x1,maxV:y1}};
}

describe("independent glint integration oracle",()=>{
  test("sharp response is directional and the physical response precedes normal averaging",()=>{
    const tilt=.18,a:Vec3=[Math.sin(tilt),0,Math.cos(tilt)],b:Vec3=[-a[0],0,a[2]],h:Vec3=[0,0,1];
    expect(facetResponse(h,h,.035)).toBe(1);
    expect(facetResponse(a,h,.035)).toBeLessThan(.00001);
    const samples=integrateFacetSamples([a,b],h,.035);
    expect(samples.coverage).toBe(1);
    expect(samples.meanNormal[0]).toBeCloseTo(0,12);
    expect(samples.reflected).toBeLessThan(.00001);
    expect(samples.averagedResponse).toBeCloseTo(1,12);
    const ideal=idealAveragedResponse(new Float32Array([1]),{x:new Float32Array([0]),y:new Float32Array([0]),z:new Float32Array([Math.cos(tilt)])},h,.035,"covered-average");
    expect(ideal[0]).toBeCloseTo(1,7);
    const sparse=integrateFacetSamples([null,a],a,.035);
    expect(sparse.coverage).toBe(.5);
    expect(sparse.reflected).toBeCloseTo(.5,12);
    expect(sparse.averagedResponse).toBeCloseTo(.5,12);
    expect(integrateFacetSamples([null,null],h,.035).reflected).toBe(0);
    expect(()=>facetResponse(a,h,0)).toThrow();
  });
  test("overlap uses highest stable global ID, independent of candidate order",()=>{
    const flat:Vec3=[0,0,1],tilted:Vec3=[.2,0,Math.sqrt(.96)];
    const a=rectangle(4,0,0,.04,.04,flat),b=rectangle(21,.015,.015,.03,.03,tilted);
    expect(topFlakeAt([a,b],.02,.02)?.id).toBe(21);
    expect(topFlakeAt([b,a],.02,.02)?.id).toBe(21);
    expect(topFlakeAt([b,a],.005,.005)?.id).toBe(4);
    expect(topFlakeAt([a,b],.05,.05)).toBeUndefined();
  });
  test("aligned 1K and 2K UV pixels partition the exact same fixed sample field",()=>{
    const flat:Vec3=[0,0,1],tilted:Vec3=[.2,0,Math.sqrt(.96)],
      flakes=[rectangle(4,0,0,.04,.04,flat),rectangle(21,.015,.015,.03,.03,tilted)];
    const h={front:flat,tilted};
    const a=integrateCrop(flakes,32,{x:0,y:0,width:2,height:2},4,h,.035);
    const b=integrateCrop(flakes,64,{x:0,y:0,width:4,height:4},2,h,.035);
    expect(a.diagnostics.sampleCount).toBe(64);
    expect(b.diagnostics.sampleCount).toBe(64);
    expect(a.diagnostics.overlapHits).toBeGreaterThan(0);
    for(const name of Object.keys(h)){
      const grouped=downsample2x2(b.channels[name]!,4,4);
      for(let i=0;i<a.channels[name]!.length;i++)expect(a.channels[name]![i]).toBeCloseTo(grouped[i]!,7);
    }
    const groupedCoverage=downsample2x2(b.coverage,4,4);
    expect([...a.coverage]).toEqual([...groupedCoverage]);
    for(const channel of ["x","y","z"] as const){
      const grouped=downsample2x2(b.normalSums[channel],4,4);
      for(let i=0;i<grouped.length;i++)expect(a.normalSums[channel][i]).toBeCloseTo(grouped[i]!,7);
    }
    expect(()=>integrateCrop(flakes,32,{x:31,y:0,width:2,height:1},4,h,.035)).toThrow();
    expect(()=>downsample2x2(new Float32Array(9),3,3)).toThrow();
  });
  test("error report exposes false and missed bright pixels without hiding signed bias",()=>{
    const stats=errorMetrics(new Float32Array([0,.03,.03]),new Float32Array([.03,0,.03]));
    expect(stats.mae).toBeCloseTo(.02,7);
    expect(stats.bias).toBeCloseTo(0,7);
    expect(stats.missedBrightPixels).toBe(1);
    expect(stats.falseBrightPixels).toBe(1);
    expect(()=>errorMetrics(new Float32Array([1]),new Float32Array(2))).toThrow();
  });
  // Runs the whole fixed 1K/2K oracle study (about 1.2 s locally); slower CI runners need more than the 5 s default.
  test("the full fixed study remains deterministic and shows nontrivial normal-filtering loss",()=>{
    const study=runGlintOracle();
    expect(study.oracleDiagnostics.sampleCount).toBe(245760);
    expect(study.oracleDiagnostics.overlapHits).toBeGreaterThan(0);
    expect(study.retainedFlakes).toBe(15760);
    expect(study.oracleCoverage1KSha256).toBe("daec0a3b823300fc7952d2026addbe2d6aef00de5c8ebc48888c9d62ac1217ec");
    expect(study.oracleCoverage2KSha256).toBe("13f5ff33c9cfac71a95d049146f8a1ed2fb4db87239d12d904f1b5d235a6e362");
    const surface1=study.comparisons.find(c=>c.size===1024&&c.normalMode==="surface-average")!;
    const covered1=study.comparisons.find(c=>c.size===1024&&c.normalMode==="covered-average")!;
    const covered2=study.comparisons.find(c=>c.size===2048&&c.normalMode==="covered-average")!;
    expect(covered1.halfVectors.frontal!.oracleSha256).toBe("2800008f47c8705d0b51212f7cf5bcd1c0f1a9cbd56e2785992869b6044aa561");
    expect(covered2.halfVectors.frontal!.oracleSha256).toBe("65bbc38662c794d949de9b015d8c86491bf97a486bfbf142f379da281dc4e16e");
    expect(surface1.surfaceCropSha256).toBe(covered1.surfaceCropSha256);
    expect(surface1.halfVectors.frontal!.error.falseBrightPixels).toBeGreaterThan(200);
    expect(covered1.halfVectors.frontal!.error.falseBrightPixels).toBeLessThan(10);
    expect(covered1.halfVectors.grazingX!.error.missedBrightPixels).toBeGreaterThan(0);
    expect(surface1.halfVectors.frontal!.intrinsicAveragingError.falseBrightPixels).toBeGreaterThan(200);
  }, 30_000);
});
