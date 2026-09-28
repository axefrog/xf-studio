import {expect,test} from "bun:test";
import {assessPreviewQuality,DEFAULT_PREVIEW_BUDGET_BYTES,DEFAULT_PREVIEW_TEXTURE_SIZE,isPreviewTextureSize,
  parsePreviewTextureSize,PREVIEW_TEXTURE_SIZES} from "../src/preview-quality";
import { initialRecipe } from "./fixtures/eye-region";

test("preview texture sizes validate strictly while saved invalid preferences use the default",()=>{
  expect(DEFAULT_PREVIEW_TEXTURE_SIZE).toBe(1024);
  for(const size of PREVIEW_TEXTURE_SIZES){expect(isPreviewTextureSize(size)).toBe(true);expect(parsePreviewTextureSize(size)).toBe(size);}
  for(const value of [undefined,null,"512",true,0,256,768,8192,Infinity,NaN,{},[]]){
    expect(isPreviewTextureSize(value)).toBe(false);expect(parsePreviewTextureSize(value)).toBe(1024);
    const result=assessPreviewQuality(initialRecipe(),value,8192);
    expect(result.accepted).toBe(false);expect(result.error).toBeDefined();expect(result.textureSize).toBeUndefined();
  }
});

test("memory assessment counts enabled allocations, shared optical maps, exact mips and largest staging bundle",()=>{
  const recipe=initialRecipe(),before=structuredClone(recipe);
  for(const size of PREVIEW_TEXTURE_SIZES){
    const base=4*size**2;
    const gpu=Array.from({length:Math.log2(size)+1},(_,i)=>4*(size/2**i)**2).reduce((a,b)=>a+b,0);
    const plain=assessPreviewQuality(recipe,size,8192,Number.MAX_SAFE_INTEGER);
    expect(plain.accepted).toBe(true);expect(plain.error).toBeUndefined();
    expect(plain.enabledLayers).toBe(1);expect(plain.plainLayers).toBe(1);expect(plain.opticalLayers).toBe(0);expect(plain.generatedMaps).toBe(1);
    expect(plain.cpuBytes).toBe(base);expect(plain.gpuBytes).toBe(gpu);
    expect(plain.stagingBytes).toBe(base+gpu);expect(plain.workerBytes).toBe(base);
    expect(plain.estimatedBytes).toBe(3*base+2*gpu);
    const mixed=structuredClone(recipe);mixed.layers.forEach(l=>l.enabled=true);
    mixed.layers[0].finish="shimmer";mixed.layers[1].finish="glitter";mixed.layers[2].finish="satin";mixed.layers[3].finish="glossy";
    mixed.layers[3].opacity=0; // Allocated while enabled, even if transparent.
    const optical=assessPreviewQuality(mixed,size,8192,Number.MAX_SAFE_INTEGER);
    expect(optical.enabledLayers).toBe(4);expect(optical.plainLayers).toBe(2);expect(optical.opticalLayers).toBe(2);expect(optical.generatedMaps).toBe(8);
    expect(optical.cpuBytes).toBe(8*base);expect(optical.gpuBytes).toBe(8*gpu);
    expect(optical.stagingBytes).toBe(3*(base+gpu));expect(optical.workerBytes).toBe(base);
    expect(optical.estimatedBytes).toBe(12*base+11*gpu);
    mixed.layers[0].enabled=false;mixed.layers[1].enabled=false;
    const inactive=assessPreviewQuality(mixed,size,8192,Number.MAX_SAFE_INTEGER);
    expect(inactive.opticalLayers).toBe(0);expect(inactive.generatedMaps).toBe(2);expect(inactive.stagingBytes).toBe(base+gpu);
  }
  expect(recipe).toEqual(before);
});

test("game-matched Shimmer's grain is counted at its own fixed size, with its composite and worker peak (PREV-183)",()=>{
  const recipe=initialRecipe();recipe.layers[0].finish="shimmer";recipe.layers[0].optics={model:"game-matched-1"};
  const grainBase=2048*1024*4;let grainChain=0;
  for(let w=2048,h=1024;;w=Math.max(1,w/2),h=Math.max(1,h/2)){grainChain+=w*h*4;if(w===1&&h===1)break;}
  const composite=Math.round(2048*1024*2*(10+11*4/3));
  const bySize=PREVIEW_TEXTURE_SIZES.map(size=>{
    const base=4*size**2,gpu=Array.from({length:Math.log2(size)+1},(_,i)=>4*(size/2**i)**2).reduce((a,b)=>a+b,0);
    const q=assessPreviewQuality(recipe,size,8192,Number.MAX_SAFE_INTEGER);
    expect(q.grainLayers).toBe(1);expect(q.opticalLayers).toBe(1);expect(q.generatedMaps).toBe(3);
    expect(q.cpuBytes).toBe(base+2*grainChain);expect(q.gpuBytes).toBe(gpu+2*grainChain+composite);
    expect(q.stagingBytes).toBe(base+gpu+4*grainChain);
    expect(q.workerBytes).toBe(base+2*grainChain+14*grainBase/4);
    return q;
  });
  // What the grain adds does not grow with the preview size: 4096 costs more than 512 only by its larger mask, as a plain layer does.
  const plain=initialRecipe(),at=(r:typeof recipe,size:number)=>assessPreviewQuality(r,size,8192,Number.MAX_SAFE_INTEGER).estimatedBytes;
  expect(bySize[3]!.estimatedBytes-bySize[0]!.estimatedBytes).toBe(at(plain,4096)-at(plain,512));
  // One game-matched Shimmer layer fits the default budget at every size, 4096 included (it used to need 805 MB of worker planes).
  for(const size of PREVIEW_TEXTURE_SIZES)expect(assessPreviewQuality(recipe,size,8192).accepted).toBe(true);
});

test("hardware and memory limits reject explicitly without downgrading the requested size",()=>{
  const recipe=initialRecipe();
  const unsupported=assessPreviewQuality(recipe,4096,2048);
  expect(unsupported.accepted).toBe(false);expect(unsupported.textureSize).toBe(4096);expect(unsupported.error).toContain("2048");
  expect(unsupported.estimatedBytes).toBeGreaterThan(0);
  for(const limit of [0,-1,NaN,Infinity,1024.5])expect(assessPreviewQuality(recipe,512,limit).accepted).toBe(false);
  for(const budget of [-1,NaN,Infinity,2.5])expect(assessPreviewQuality(recipe,512,8192,budget).accepted).toBe(false);
  const exact=assessPreviewQuality(recipe,1024,1024);
  expect(assessPreviewQuality(recipe,1024,1024,exact.estimatedBytes).accepted).toBe(true);
  const oneShort=assessPreviewQuality(recipe,1024,1024,exact.estimatedBytes-1);
  expect(oneShort.accepted).toBe(false);expect(oneShort.textureSize).toBe(1024);expect(oneShort.error).toContain("budget");
  expect(exact.budgetBytes).toBe(DEFAULT_PREVIEW_BUDGET_BYTES);
  recipe.layers[0].finish="glitter";
  expect(assessPreviewQuality(recipe,4096,8192).accepted).toBe(true);
  recipe.layers[1].enabled=true;recipe.layers[1].finish="glitter";
  expect(assessPreviewQuality(recipe,4096,8192).accepted).toBe(false);
  const many=initialRecipe();many.layers=Array.from({length:32},(_,i)=>({...structuredClone(many.layers[0]),id:`layer-${i}`,enabled:true}));
  expect(assessPreviewQuality(many,4096,8192).accepted).toBe(false);
  expect(assessPreviewQuality(many,1024,8192).accepted).toBe(true);
});

test("empty and fully disabled stacks need no large generated bundles but still respect hardware selection",()=>{
  for(const recipe of [{layers:[]},(()=>{const r=initialRecipe();r.layers.forEach(l=>l.enabled=false);return r;})()]){
    const result=assessPreviewQuality(recipe,4096,4096,0);
    expect(result.accepted).toBe(true);expect(result.estimatedBytes).toBe(0);expect(result.cpuBytes).toBe(0);expect(result.gpuBytes).toBe(0);
    expect(result.stagingBytes).toBe(0);expect(result.workerBytes).toBe(0);expect(result.enabledLayers).toBe(0);expect(result.generatedMaps).toBe(0);
    expect(assessPreviewQuality(recipe,4096,2048,0).accepted).toBe(false);
  }
});
