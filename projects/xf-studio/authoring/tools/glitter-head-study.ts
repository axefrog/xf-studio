/** Isolated lit-head study. Deliberately imports no workspace, library or editor
 * controller; never edits production recipes or the material's skinning hooks. */
import * as THREE from "three";
import {createScene} from "../src/scene";
import { createRasterJob } from "../src/engines/layered-makeup/recipe";
import {installGlitterMixtureStudy} from "./glitter-study-material";
import {installProceduralGlintStudy} from "./glitter-glint-study";
import { EYE_MAKEUP_REGION, initialRecipe } from "../src/features/eye-makeup/region";

const SIZE=new URLSearchParams(location.search).get("size")==="2048"?2048:1024,
  BASE="#592640",variants=["legacy","sparse","default","default-16sample","dense","maximum","fine160k","fine350k","fine350k-covered","uv-cell-glints","uv-cell-polygons"] as const;
type Variant=typeof variants[number];
type Asset={url:string;sha256:string;data:Uint8Array<ArrayBuffer>;width:number;height:number};
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const status=element<HTMLParagraphElement>("status"),controls=element<HTMLFieldSetElement>("controls"),
  variantInput=element<HTMLSelectElement>("variant"),normalInput=element<HTMLInputElement>("zero-normal"),
  mixtureInput=element<HTMLInputElement>("mixture"),
  roughnessInput=element<HTMLInputElement>("flake-roughness"),environmentInput=element<HTMLInputElement>("environment"),glintStrengthInput=element<HTMLInputElement>("glint-strength"),glintPowerInput=element<HTMLInputElement>("glint-power"),glintSeedInput=element<HTMLInputElement>("glint-seed"),glintDensityInput=element<HTMLInputElement>("glint-density"),glintFineInput=element<HTMLInputElement>("glint-fine"),
  metalInput=element<HTMLInputElement>("zero-metalness"),lightInput=element<HTMLInputElement>("light"),
  blinkInput=element<HTMLInputElement>("blink"),idleInput=element<HTMLInputElement>("idle"),pauseInput=element<HTMLInputElement>("pause");
let viewer:Awaited<ReturnType<typeof createScene>>|undefined,active:Variant|undefined,requested:Variant="default",
  loading=false,error="",generation=0,maskHash="",frames=0;
let sources:Record<string,{url:string;sha256:string;width:number;height:number}>={},manifest:unknown=null,fineManifest:unknown=null,coveredManifest:unknown=null;
let owned:THREE.Texture[]=[],normalTexture:THREE.Texture|undefined,surfaceTexture:THREE.Texture|undefined;
let mixture:ReturnType<typeof installGlitterMixtureStudy>|undefined;
let glint:ReturnType<typeof installProceduralGlintStudy>|undefined;
const fixed=initialRecipe().layers[0]!;
fixed.color=BASE;fixed.opacity=1;fixed.enabled=true;fixed.finish="matte";
const sha=async(data:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data))).map(n=>n.toString(16).padStart(2,"0")).join("");
const wait=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

Object.defineProperty(window,"glitterStudyDiagnostics",{value:()=>({
  study:"isolated-irregular-glitter-lit-head",ready:!!viewer&&!!active&&!loading&&!error,
  activeVariant:active,requestedVariant:requested,loading,error,
  size:SIZE,base:BASE,fixedLayer:structuredClone(fixed),maskSha256:maskHash,sources:structuredClone(sources),sourceManifest:structuredClone(manifest),fineManifest:structuredClone(fineManifest),coveredManifest:structuredClone(coveredManifest),
  camera:viewer?.cameraState(),lightAngle:Number(lightInput.value),environmentIntensity:Number(environmentInput.value),flakeRoughness:Number(roughnessInput.value),glintStrength:Number(glintStrengthInput.value),glintAngularPower:Number(glintPowerInput.value),glintSeed:Number(glintSeedInput.value),glintDensity:Number(glintDensityInput.value)/100,glintFineShare:Number(glintFineInput.value)/100,
  pose:{importedSave:false,eyeShape:"scene-default",blink:Number(blinkInput.value),idle:viewer?.idle?.enabled??false,
    idlePaused:viewer?.idle?.paused??false,idleTime:viewer?.idle?.time??0},
  diagnosticOverrides:{zeroNormal:normalInput.checked,zeroMetalness:metalInput.checked,twoBRDFMixture:mixtureInput.checked&&active!=="legacy"&&active!=="uv-cell-glints"&&active!=="uv-cell-polygons",uvCellGlints:active==="uv-cell-glints"||active==="uv-cell-polygons",uvCellShape:active==="uv-cell-polygons"?"polygon":"circle"},
  frameCallbacks:frames,renderCount:viewer?.renderer.info.render.frame,
  material:viewer?{normalScale:viewer.materials[0]!.normalScale.toArray(),metalness:viewer.materials[0]!.metalness,
    roughness:viewer.materials[0]!.roughness,color:viewer.materials[0]!.color.getHexString(),
    mapSpace:viewer.materials[0]!.map?.colorSpace,normalSpace:viewer.materials[0]!.normalMap?.colorSpace,
    skinProgram:viewer.materials[0]!.customProgramCacheKey(),
    maps:[viewer.materials[0]!.map,viewer.materials[0]!.normalMap,viewer.materials[0]!.roughnessMap].map(t=>{
      const image=t?.image as {width:number;height:number}|undefined;return image?{width:image.width,height:image.height}:null;
    })}:null,
  renderer:viewer?{exposure:viewer.renderer.toneMappingExposure,pixelRatio:viewer.renderer.getPixelRatio(),memory:{...viewer.renderer.info.memory}}:null,
}),writable:false,configurable:false});

async function loadAsset(variant:Variant,kind:string):Promise<Asset>{
  const url=`/assets/glitter-study/${variant}-${SIZE}-${kind}.png`,response=await fetch(url);
  if(!response.ok)throw Error(`${response.status} loading ${url}`);
  const bytes=new Uint8Array(await response.arrayBuffer()),digest=await sha(bytes);
  const bitmap=await createImageBitmap(new Blob([bytes],{type:"image/png"}),{premultiplyAlpha:"none",colorSpaceConversion:"none"});
  try{
    if(bitmap.width!==SIZE||bitmap.height!==SIZE)throw Error(`Expected ${SIZE}x${SIZE} map: ${url}`);
    const canvas=document.createElement("canvas");canvas.width=canvas.height=SIZE;
    const context=canvas.getContext("2d",{willReadFrequently:true})!;context.drawImage(bitmap,0,0);
    const data=new Uint8Array(context.getImageData(0,0,SIZE,SIZE).data);
    return {url,sha256:digest,data,width:SIZE,height:SIZE};
  }finally{bitmap.close();}
}
function texture(data:Uint8Array<ArrayBuffer>,colour=false){
  const t=new THREE.DataTexture(data,SIZE,SIZE,THREE.RGBAFormat);
  t.flipY=false;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;
  t.colorSpace=colour?THREE.SRGBColorSpace:THREE.NoColorSpace;
  t.anisotropy=viewer!.renderer.capabilities.getMaxAnisotropy();t.needsUpdate=true;return t;
}
function applyOverrides(){
  if(!viewer||!active)return;
  const material=viewer.materials[0]!;
  const procedural=active==="uv-cell-glints"||active==="uv-cell-polygons";
  material.normalMap=normalTexture!;material.normalScale.setScalar(normalInput.checked?0:1);
  material.roughnessMap=material.metalnessMap=procedural?null:surfaceTexture!;
  material.roughness=procedural ? .7 : 1;material.metalness=procedural ? 0 : metalInput.checked ? 0 : 1;
  material.normalScale.setScalar(procedural||normalInput.checked?0:1);
  mixtureInput.disabled=active==="legacy"||procedural;
  roughnessInput.disabled=active==="legacy"||procedural;
  normalInput.disabled=procedural;metalInput.disabled=procedural;
  glintStrengthInput.disabled=!procedural;glintPowerInput.disabled=!procedural;glintSeedInput.disabled=!procedural;
  glintDensityInput.disabled=active!=="uv-cell-polygons";
  glintFineInput.disabled=active!=="uv-cell-polygons";
  mixture?.setSurface(surfaceTexture!);mixture?.setFlakeMetalness(metalInput.checked?0:.95);
  mixture?.setFlakeRoughness(Number(roughnessInput.value));
  mixture?.setEnabled(mixtureInput.checked&&active!=="legacy"&&!procedural);
  glint?.setStrength(Number(glintStrengthInput.value));glint?.setPower(Number(glintPowerInput.value));
  glint?.setSeed(Number(glintSeedInput.value));glint?.setShape(active==="uv-cell-polygons"?"polygon":"circle");glint?.setEnabled(procedural);
  glint?.setDensity(Number(glintDensityInput.value)/100);
  glint?.setFineShare(Number(glintFineInput.value)/100);
}
async function selectVariant(variant:Variant,alpha:Uint8ClampedArray<ArrayBuffer>){
  const token=++generation;requested=variant;loading=true;error="";
  status.textContent=`Loading ${variant} - retaining the previous complete material...`;
  try{
    const procedural=variant==="uv-cell-glints"||variant==="uv-cell-polygons";
    const sourceVariant=procedural?"fine350k":variant;
    const [normal,surface,colour]=await Promise.all([loadAsset(sourceVariant,"normal"),loadAsset(sourceVariant,"surface"),loadAsset(sourceVariant,"color")]);
    if(token!==generation)return;
    // The candidate colour image was composed in linear light by the pure study
    // baker. Only copy authoritative alpha here; Canvas source-over is not used.
    const rgba=variant==="legacy"||procedural?new Uint8Array(alpha):colour.data;
    for(let i=3;i<rgba.length;i+=4)rgba[i]=alpha[i]!;
    const next=[texture(rgba,true),texture(normal.data),texture(surface.data)],material=viewer!.materials[0]!;
    material.map=next[0]!;normalTexture=next[1];surfaceTexture=next[2];
    material.color.set(variant==="legacy"||procedural?BASE:"#ffffff");material.opacity=1;
    material.clearcoat=0;material.iridescence=0;material.needsUpdate=true;viewer!.plates[0]!.visible=true;
    const previous=owned;owned=next;active=variant;applyOverrides();for(const t of previous)t.dispose();
    sources=Object.fromEntries([["normal",normal],["surface",surface],["color",colour]].map(([name,value])=>{
      const a=value as Asset;return [name,{url:a.url,sha256:a.sha256,width:a.width,height:a.height}];
    }));
    loading=false;status.textContent=`Ready: ${variant}. ${SIZE}² mask and optical maps; UV-cell pilot uses fixed procedural facets over the same purple mask.`;
  }catch(cause){
    if(token!==generation)return;
    loading=false;error=cause instanceof Error?cause.message:String(cause);status.textContent=`Study load failed: ${error}`;
  }
}
async function main(){
  const sizeInput=element<HTMLSelectElement>("size");sizeInput.value=String(SIZE);
  sizeInput.addEventListener("change",()=>{const url=new URL(location.href);url.searchParams.set("size",sizeInput.value);location.assign(url);});
  const job=createRasterJob(fixed, SIZE, EYE_MAKEUP_REGION.mirror);
  while(!job.done){const end=performance.now()+8;do{job.advance(16);}while(!job.done&&performance.now()<end);if(!job.done)await wait();}
  maskHash=await sha(new Uint8Array(job.data));
  const canvas=document.createElement("canvas");canvas.width=canvas.height=SIZE;canvas.getContext("2d")!.putImageData(new ImageData(job.data,SIZE,SIZE),0,0);
  status.textContent="Loading the local studio head...";
  viewer=await createScene(element("viewport"), [canvas], EYE_MAKEUP_REGION.fineGlitter);viewer.updateLayer(0,fixed);
  mixture=installGlitterMixtureStudy(viewer.materials[0]!,{baseColor:BASE,flakeColor:"#f5df9f"});
  glint=installProceduralGlintStudy(viewer.materials[0]!);
  viewer.onFrame(()=>frames++);viewer.setIdle(false);viewer.setBlink(0);viewer.setLightAngle(Number(lightInput.value));
  controls.disabled=false;
  variantInput.addEventListener("change",()=>{const v=variantInput.value as Variant;if(variants.includes(v))void selectVariant(v,job.data);});
  normalInput.addEventListener("change",applyOverrides);metalInput.addEventListener("change",applyOverrides);
  mixtureInput.addEventListener("change",applyOverrides);
  roughnessInput.addEventListener("input",applyOverrides);
  glintStrengthInput.addEventListener("input",applyOverrides);
  glintDensityInput.addEventListener("input",()=>{element("glint-density-value").textContent=`${glintDensityInput.value}%`;applyOverrides();});
  glintFineInput.addEventListener("input",()=>{element("glint-fine-value").textContent=`${glintFineInput.value}%`;applyOverrides();});
  glintPowerInput.addEventListener("input",applyOverrides);
  glintSeedInput.addEventListener("change",()=>{
    const proposed=Number(glintSeedInput.value);
    glintSeedInput.value=String(Number.isFinite(proposed)?Math.max(0,Math.min(65535,Math.round(proposed))):0);
    applyOverrides();
  });
  environmentInput.addEventListener("input",()=>{viewer!.scene.environmentIntensity=Number(environmentInput.value);});
  lightInput.addEventListener("input",()=>{viewer!.setLightAngle(Number(lightInput.value));element("light-value").textContent=`${lightInput.value}°`;});
  element("front").addEventListener("click",()=>viewer!.front());
  element("close").addEventListener("click",()=>viewer!.restoreCamera({position:[.05,1.702,-.17],target:[.026,1.702,.004],fov:30}));
  element("distant").addEventListener("click",()=>viewer!.restoreCamera({position:[0,1.67,-.95],target:[0,1.67,.005],fov:30}));
  blinkInput.addEventListener("input",()=>{viewer!.setBlink(Number(blinkInput.value));element("blink-value").textContent=`${Math.round(Number(blinkInput.value)*100)}%`;});
  idleInput.disabled=!viewer.idle;pauseInput.disabled=!viewer.idle;
  idleInput.addEventListener("change",()=>{
    viewer!.setIdle(idleInput.checked);viewer!.setIdlePaused(pauseInput.checked);blinkInput.disabled=idleInput.checked;
    blinkInput.value="0";element("blink-value").textContent="0%";
  });
  pauseInput.addEventListener("change",()=>viewer!.setIdlePaused(pauseInput.checked));
  // Optional provenance only; a missing manifest does not fabricate a match.
  void fetch("/assets/glitter-study/manifest.json").then(async r=>{if(r.ok)manifest=await r.json();}).catch(()=>{});
  void fetch("/assets/glitter-study/fine-manifest.json").then(async r=>{if(r.ok)fineManifest=await r.json();}).catch(()=>{});
  void fetch("/assets/glitter-study/covered-manifest.json").then(async r=>{if(r.ok)coveredManifest=await r.json();}).catch(()=>{});
  await selectVariant("default",job.data);
}
void main().catch(cause=>{error=cause instanceof Error?cause.message:String(cause);status.textContent=`Study initialization failed: ${error}`;});
