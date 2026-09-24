import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {bakeFlakes,createFlakeJob,defaultFlakes,type Flakes} from "../src/finish";
import {createRasterProcessor,type RasterResponse} from "../src/raster-processor";
import {initialRecipe,raster} from "../src/recipe";

// Captured from the unmodified synchronous baker before this scheduling change.
const frozen: {size:number;finish:"shimmer"|"glitter";p:Flakes;sha256:string}[] = [
  {size:32,finish:"shimmer",p:defaultFlakes(),sha256:"ff1b5341a17b0c0307ab6b69d90e5cdbab26304de2deb1fd5b2e5eca468bf9fe"},
  {size:33,finish:"glitter",p:{cells:32,density:0,tilt:1,seed:0},sha256:"4dac8f70e45f307c3b8a559ddd32760aeca21f0c104792b71d720a3dd6805e1a"},
  {size:127,finish:"shimmer",p:{cells:256,density:1,tilt:1,seed:2147483647},sha256:"2aa1635b6deadf23c17b82a9e9a21ed4d86c08252d79ef16284bc6928a158e38"},
  {size:256,finish:"glitter",p:defaultFlakes(),sha256:"d8d50b6ac3439d19ca0fdb24aa8aa5f26c3feaece27f9a51606be41eb285c2f6"},
  {size:1024,finish:"shimmer",p:defaultFlakes(),sha256:"32aabee6b21279527b7243dcb1b0abdca56176c445f54bc618863c1c951ff19a"},
  {size:2048,finish:"glitter",p:defaultFlakes(),sha256:"c8700b15aaad3cf9fab7244317368d70ae33cdccfa04b6f1277b1ac4511967df"},
];
const digest=(maps:{normal:Uint8Array;surface:Uint8Array})=>createHash("sha256").update(maps.normal).update(maps.surface).digest("hex");

test("sliced flake jobs preserve frozen original byte hashes through 2048",()=>{
  for(const fixture of frozen){const job=createFlakeJob(fixture.size,fixture.finish,fixture.p);
    for(const chunk of[1,7,13,257,511]){job.advance(chunk);if(job.done)break;}
    while(!job.done)job.advance(8191);
    expect(digest(job)).toBe(fixture.sha256);
    expect(digest(bakeFlakes(fixture.size,fixture.finish,fixture.p))).toBe(fixture.sha256);
    expect(job.advance(1)).toBe(true);
  }
});

test("cell setup is bounded even when almost all cells contain no pixels",()=>{
  const source={...defaultFlakes(),cells:256},snapshot={...source},job=createFlakeJob(32,"shimmer",source);
  job.advance(1);expect(job.done).toBe(false);expect(job.normal.some(x=>x!==0)).toBe(false);
  job.advance(1);expect(job.normal[3]).toBe(255);
  source.seed=1;source.density=0;source.cells=32;
  let advances=0;while(!job.done){job.advance(1);advances++;}
  expect(advances).toBeGreaterThan(256*256);
  expect(digest(job)).toBe(digest(bakeFlakes(32,"shimmer",snapshot)));
  expect(()=>job.advance(0)).toThrow();expect(()=>job.advance(.5)).toThrow();expect(()=>job.advance(NaN)).toThrow();
});

test("4096 output is complete and bounds remain enforced",()=>{
  const job=createFlakeJob(4096,"glitter",{cells:32,density:0,tilt:1,seed:0});
  job.advance(1024);expect(job.done).toBe(false);job.advance(Infinity);
  expect(job.normal.length).toBe(4096*4096*4);expect(job.surface.length).toBe(job.normal.length);
  let bad=0;for(let i=0;i<job.normal.length;i+=4){if(job.normal[i]!==128||job.normal[i+1]!==128||job.normal[i+2]!==255||job.normal[i+3]!==255||job.surface[i]!==0||job.surface[i+1]!==179||job.surface[i+2]!==0||job.surface[i+3]!==255)bad++;}
  expect(bad).toBe(0);
  for(const size of[31,4097,1.5,NaN])expect(()=>createFlakeJob(size,"glitter",defaultFlakes())).toThrow();
});

test("optical phase yields and cancels without publishing a mask-only result",async()=>{
  const responses:RasterResponse[]=[],resumes:(()=>void)[]=[];let clock=0;
  const processor=createRasterProcessor(r=>responses.push(r),()=>new Promise(resolve=>resumes.push(resolve)),()=>++clock*10);
  const layer=initialRecipe().layers[0];layer.finish="glitter";layer.feather=.0005;layer.fields=[];layer.symmetry=false;
  layer.points=Array.from({length:3},()=>({u:.5,v:.5,weight:1}));layer.pathMode="catmull-rom";
  const pending=processor.start({i:0,version:1,layer,size:32,bakeOptics:true});
  await Promise.resolve();expect(resumes.length).toBe(1);expect(responses).toEqual([]); // Between phases.
  resumes.shift()!();await Promise.resolve();await Promise.resolve();
  expect(resumes.length).toBe(1);expect(responses).toEqual([]); // Inside optical cells.
  processor.cancel(1);resumes.shift()!();await pending;
  expect(responses).toEqual([{i:0,version:1,cancelled:true}]);
});

test("complete optical bundles use immutable requested settings and matching resolution",async()=>{
  const responses:RasterResponse[]=[],resumes:(()=>void)[]=[];let clock=0;
  const processor=createRasterProcessor(r=>responses.push(r),()=>new Promise(resolve=>resumes.push(resolve)),()=>++clock*10);
  const layer=initialRecipe().layers[0];layer.finish="shimmer";layer.flakes=defaultFlakes();
  const original=structuredClone(layer);let done=false;
  const pending=processor.start({i:3,version:10,layer,size:33,bakeOptics:true}).then(()=>{done=true;});
  layer.finish="matte";layer.enabled=false;layer.flakes.seed=0;layer.opacity=0;
  while(!done){resumes.shift()?.();await Promise.resolve();}
  await pending;expect(responses.length).toBe(1);
  const result=responses[0];expect(result.cancelled).not.toBe(true);
  if(!result.cancelled){expect(result.size).toBe(33);expect(result.data).toEqual(raster(original,33));expect(result.optics?.size).toBe(33);expect(digest(result.optics!)).toBe(digest(bakeFlakes(33,"shimmer",original.flakes!)));}
});

test("nonoptical, disabled and opt-out requests avoid the optical phase",async()=>{
  for(const [enabled,finish,bakeOptics]of[[true,"matte",true],[false,"glitter",true],[true,"glitter",false]]as const){
    const layer=initialRecipe().layers[0];layer.enabled=enabled;layer.finish=finish;let result:RasterResponse|undefined;
    const processor=createRasterProcessor(r=>{result=r;},async()=>{},()=>0);
    await processor.start({i:0,version:1,layer,size:32,bakeOptics});
    expect(result?.cancelled).not.toBe(true);if(result&&!result.cancelled){expect(result.size).toBe(32);expect(result.optics).toBeUndefined();expect(result.data).toEqual(raster(layer,32));}
  }
});
