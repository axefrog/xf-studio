import {expect,test} from "bun:test";
import * as THREE from "three";
import {initialRecipe,parseRecipe,raster} from "../src/recipe";
import {defaultFlakes} from "../src/finish";
import {defaultIrregularFlakes,defaultStudioIrregularFlakes} from "../src/flake-field";
import {createRasterProcessor,type RasterResponse} from "../src/raster-processor";
import {createMakeupStack} from "../src/makeup-stack";
import {assessPreviewQuality} from "../src/preview-quality";
import {freshWorkspace,parseWorkspace} from "../src/workspace-state";
import {parseCollection} from "../src/preset-collection";
import {LookLibrary} from "../src/library-store";
import {UnsupportedMaterialError,compileFlatPreset} from "../src/preset-compiler";
import { storedWorkspace } from "./fixtures/looks";

test("recipe-7 opt-in is strict while recipe-6 glitter preserves its legacy model",()=>{
  const recipe=initialRecipe(),layer=recipe.layers[0];layer.finish="glitter";
  const legacy={...recipe,schema:"xfs/recipe-6"};
  expect(parseRecipe(legacy).layers[0].flakes).toBeUndefined();
  layer.flakes=defaultIrregularFlakes();
  expect(parseRecipe(recipe).layers[0].flakes).toEqual(layer.flakes);
  expect(()=>parseRecipe({...recipe,schema:"xfs/recipe-6"})).toThrow();
  for(const flakes of [{...layer.flakes,model:"future"},{...layer.flakes,extra:1},
    {...layer.flakes,color:"#fff"},{...layer.flakes,count:Infinity}])
    expect(()=>parseRecipe({...recipe,layers:[{...layer,flakes}]})).toThrow();
  expect(()=>parseRecipe({...recipe,layers:[{...layer,finish:"shimmer"}]})).toThrow();
  layer.flakes=defaultFlakes();
  expect(parseRecipe(recipe).layers[0].flakes).toEqual(defaultFlakes());
});

test("new settings survive workspace, collection and SQLite while game export stays gated",()=>{
  const recipe=initialRecipe();recipe.layers[0].finish="glitter";recipe.layers[0].color="#351747";
  recipe.layers[0].flakes={...defaultIrregularFlakes(),color:"#ffe1a3",count:4096};
  const workspace=freshWorkspace(recipe);workspace.history=[initialRecipe()];
  const restored=parseWorkspace(storedWorkspace(workspace));
  expect(restored.recipe.layers[0].flakes).toEqual(recipe.layers[0].flakes);
  expect(restored.history[0].layers[0].finish).toBe("matte");
  const collection=parseCollection({schema:"xfas/collection-1",id:crypto.randomUUID(),name:"Study",
    presets:[{id:crypto.randomUUID(),name:"Gold over purple",revision:1,recipe}]});
  expect(collection.presets[0].recipe.layers[0].flakes).toEqual(recipe.layers[0].flakes);
  const db=new LookLibrary(":memory:");
  try {const saved=db.save({name:"Study",recipe});expect(db.get(saved.id).recipe.layers[0].flakes).toEqual(recipe.layers[0].flakes);}
  finally {db.close();}
  expect(()=>compileFlatPreset(recipe,32)).toThrow(UnsupportedMaterialError);
});

test("combined worker publishes exact shape alpha and independent pale flakes, then reuses field on colour edit",async()=>{
  const layer=initialRecipe().layers[0];layer.finish="glitter";layer.color="#271044";
  layer.flakes={...defaultIrregularFlakes(),count:1000,radius:.003,color:"#f5df9f"};
  const result:RasterResponse[]=[];
  const processor=createRasterProcessor(x=>result.push(x));
  await processor.start({i:0,version:1,layer,size:64,bakeOptics:true});
  const first=result[0];expect(first.cancelled).not.toBe(true);
  if(first.cancelled)return;
  expect(first.data).toEqual(raster(layer,64));
  expect(first.optics).toBeDefined();expect(first.albedo).toBeDefined();
  expect(first.glitterStats?.generated).toBe(1000);
  expect(first.glitterStats?.maskCentres).toBeLessThanOrEqual(first.glitterStats!.regionRetained);
  let coloured=0;
  for(let i=0;i<first.data.length;i+=4){
    expect(first.albedo!.data[i+3]).toBe(first.data[i+3]);
    if(first.optics!.surface[i]>0 && first.albedo!.data[i]>first.albedo!.data[i+2])coloured++;
  }
  expect(coloured).toBeGreaterThan(0);
  layer.color="#110033";layer.flakes.color="#ffffff";
  await processor.start({i:0,version:2,layer,size:64,bakeOptics:false});
  const second=result[1];expect(second.cancelled).not.toBe(true);
  if(second.cancelled)return;
  expect(second.optics).toBeUndefined();expect(second.albedo?.key).not.toBe(first.albedo?.key);
  expect(second.data).toEqual(first.data);
  expect(second.glitterStats).toEqual(first.glitterStats);
});

test("fine studio default reports bounded-region and resolved-coverage counts",async()=>{
  const layer=initialRecipe().layers[0];layer.finish="glitter";layer.flakes=defaultStudioIrregularFlakes();
  const results:RasterResponse[]=[];
  const worker=createRasterProcessor(r=>results.push(r));
  await worker.start({i:0,version:1,layer,size:512,bakeOptics:true});
  const result=results[0];expect(result.cancelled).not.toBe(true);
  if(result.cancelled)return;
  expect(result.albedo?.data.length).toBe(512*512*4);
  expect(result.glitterStats?.generated).toBe(350000);
  expect(result.glitterStats!.regionRetained).toBeGreaterThan(45000);
  expect(result.glitterStats!.maskCentres).toBeGreaterThan(3000);
  expect(result.glitterStats!.coveredPixels).toBeGreaterThan(result.glitterStats!.quarterCoveragePixels);
  let painted=0,coverage=0;
  for(let i=0;i<result.data.length;i+=4)if(result.data[i+3]){
    painted++;coverage+=result.optics!.surface[i]!/255;
  }
  expect(painted).toBeGreaterThan(1000);
  expect(coverage/painted).toBeGreaterThan(.06);
  expect(coverage/painted).toBeLessThan(.2);
  const outside={...layer,points:layer.points.map(p=>({...p,u:p.u-.2}))};
  await worker.start({i:0,version:2,layer:outside,size:512,bakeOptics:false});
  expect(results).toHaveLength(2);
  expect(results[1]).toEqual({i:0,version:2,cancelled:true,error:expect.stringContaining("Fine Glitter supports the eye UV area")});
});

test("cancelled candidate work never publishes a partial mask or albedo",async()=>{
  const layer=initialRecipe().layers[0];layer.finish="glitter";
  layer.flakes={...defaultIrregularFlakes(),count:4096};
  const responses:RasterResponse[]=[],resumes:(()=>void)[]=[];
  let clock=0,finished=false;
  const processor=createRasterProcessor(x=>responses.push(x),()=>new Promise(resolve=>resumes.push(resolve)),()=>++clock*10);
  const pending=processor.start({i:0,version:1,layer,size:64,bakeOptics:true}).then(()=>finished=true);
  await Promise.resolve();expect(responses).toEqual([]);
  processor.cancel(1);
  while(!finished){resumes.shift()?.();await Promise.resolve();}
  await pending;
  expect(responses).toEqual([{i:0,version:1,cancelled:true}]);
});

test("candidate material binds one complete RGBA albedo and disposes it on legacy restoration",()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0],3));
  geometry.setAttribute("skinIndex",new THREE.Uint16BufferAttribute([0,0,0,0],4));
  geometry.setAttribute("skinWeight",new THREE.Float32BufferAttribute([1,0,0,0],4));
  const anchor=new THREE.SkinnedMesh(geometry);new THREE.Group().add(anchor);
  anchor.skeleton=new THREE.Skeleton([new THREE.Bone()]);
  const stack=createMakeupStack(anchor,4),canvas=()=>({width:32,height:32}) as HTMLCanvasElement;
  stack.setCanvases([canvas()]);
  const layer=initialRecipe().layers[0];layer.finish="glitter";layer.flakes={...defaultIrregularFlakes(),count:0};
  const results:RasterResponse[]=[];
  const processor=createRasterProcessor(x=>results.push(x));
  return processor.start({i:0,version:1,layer,size:32,bakeOptics:true}).then(()=>{
    const result=results[0];if(result.cancelled)throw Error("Unexpected cancellation");
    stack.updateLayer(0,layer,result.optics,result.albedo);
    const material=stack.materials[0],albedo=material.map!;
    expect(material.color.getHexString()).toBe("ffffff");
    expect(albedo).not.toBe(stack.textures[0]);
    expect(albedo.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(albedo.generateMipmaps).toBe(true);
    expect(stack.diagnostics()[0].mapCount).toBe(4);
    let disposed=0;albedo.addEventListener("dispose",()=>disposed++);
    const changed={...layer,color:"#223344"};
    stack.updateLayer(0,changed);
    expect(material.map).toBe(albedo);expect(material.color.getHexString()).toBe("ffffff");
    stack.setLayerCanvas(0,canvas());expect(material.map).toBe(albedo);
    stack.updateLayer(0,{...layer,flakes:defaultFlakes()},
      {size:32,normal:new Uint8Array(32*32*4),surface:new Uint8Array(32*32*4)});
    expect(disposed).toBe(1);expect(material.map).toBe(stack.textures[0]);
    stack.setCanvases([]);
  });
});

test("fourth map and worker scratch enforce the default 4K limit",()=>{
  const recipe=initialRecipe();recipe.layers[0].finish="glitter";recipe.layers[0].flakes=defaultIrregularFlakes();
  const at2K=assessPreviewQuality(recipe,2048,8192),at4K=assessPreviewQuality(recipe,4096,8192);
  expect(at2K.accepted).toBe(true);expect(at2K.generatedMaps).toBe(4);
  expect(at4K.accepted).toBe(false);
  expect(at4K.estimatedBytes).toBeGreaterThan(1024**3);
});
