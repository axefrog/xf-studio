import {expect,test} from "bun:test";
import * as THREE from "three";
import {initialRecipe,parseRecipe,raster} from "../src/recipe";
import {defaultDirectGlintFlakes} from "../src/direct-glint-settings";
import {createRasterProcessor,type RasterResponse} from "../src/raster-processor";
import {createMakeupStack} from "../src/makeup-stack";
import {assessPreviewQuality} from "../src/preview-quality";
import {UnsupportedMaterialError,compileFlatPreset} from "../src/preset-compiler";
import {freshWorkspace,parseWorkspace} from "../src/workspace-state";
import {parseCollection} from "../src/preset-collection";
import {LookLibrary} from "../src/library-store";

test("direct-light model is explicit recipe-8 browser data and stays game-export gated",()=>{
  const recipe=initialRecipe();recipe.schema="xfs/recipe-8";
  recipe.layers[0]!.finish="glitter";recipe.layers[0]!.flakes=defaultDirectGlintFlakes();
  expect(parseRecipe(recipe).layers[0]!.flakes).toEqual(recipe.layers[0]!.flakes);
  expect(parseWorkspace(freshWorkspace(recipe)).recipe.layers[0]!.flakes).toEqual(recipe.layers[0]!.flakes);
  const collection=parseCollection({schema:"xfas/collection-1",id:crypto.randomUUID(),name:"Direct study",
    presets:[{id:crypto.randomUUID(),name:"Purple glints",revision:1,recipe}]});
  expect(collection.presets[0]!.recipe.layers[0]!.flakes).toEqual(recipe.layers[0]!.flakes);
  const db=new LookLibrary(":memory:");
  try{const saved=db.save({name:"Direct study",recipe});
    expect(db.get(saved.id).recipe.layers[0]!.flakes).toEqual(recipe.layers[0]!.flakes);
  }finally{db.close();}
  expect(()=>parseRecipe({...recipe,schema:"xfs/recipe-7"})).toThrow();
  for(const flakes of [{...recipe.layers[0]!.flakes,density:2},
    {...recipe.layers[0]!.flakes,model:"uv-cell-direct-2"},
    {...recipe.layers[0]!.flakes,extra:1}])
    expect(()=>parseRecipe({...recipe,layers:[{...recipe.layers[0],flakes}]})).toThrow();
  expect(()=>compileFlatPreset(recipe,32)).toThrow(UnsupportedMaterialError);
});

test("direct-light model uses the cancellable mask worker without optical textures",async()=>{
  const layer=initialRecipe().layers[0]!;layer.finish="glitter";layer.flakes=defaultDirectGlintFlakes();
  const responses:RasterResponse[]=[];
  const worker=createRasterProcessor(r=>responses.push(r));
  await worker.start({i:0,version:1,layer,size:64,bakeOptics:false});
  const result=responses[0]!;expect(result.cancelled).not.toBe(true);
  if(result.cancelled)return;
  expect(result.data).toEqual(raster(layer,64));
  expect(result.optics).toBeUndefined();expect(result.albedo).toBeUndefined();
  const quality=assessPreviewQuality({layers:[layer]},2048,4096);
  expect(quality.accepted).toBe(true);expect(quality.generatedMaps).toBe(1);
});

test("direct-light shader waits for the complete mask and disposes on finish change",()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0],3));
  geometry.setAttribute("skinIndex",new THREE.Uint16BufferAttribute([0,0,0,0],4));
  geometry.setAttribute("skinWeight",new THREE.Float32BufferAttribute([1,0,0,0],4));
  const anchor=new THREE.SkinnedMesh(geometry);new THREE.Group().add(anchor);
  anchor.skeleton=new THREE.Skeleton([new THREE.Bone()]);
  const stack=createMakeupStack(anchor,4);
  stack.setCanvases([{width:64,height:64} as HTMLCanvasElement]);
  const layer=initialRecipe().layers[0]!;layer.finish="glitter";layer.flakes=defaultDirectGlintFlakes();
  const material=stack.materials[0]!,prior=material.onBeforeCompile;
  stack.updateLayer(0,layer);
  expect(stack.diagnostics()[0]!.directGlints).toBe(false);
  stack.updateLayer(0,layer,undefined,undefined,true);
  expect(stack.diagnostics()[0]!.directGlints).toBe(true);
  expect(material.onBeforeCompile).not.toBe(prior);
  expect(material.normalMap).toBeNull();expect(material.map).toBe(stack.textures[0]);
  expect(material.clearcoat).toBeGreaterThan(0);
  stack.updateLayer(0,{...layer,finish:"matte",flakes:undefined});
  expect(stack.diagnostics()[0]!.directGlints).toBe(false);
  expect(material.onBeforeCompile).toBe(prior);
});
