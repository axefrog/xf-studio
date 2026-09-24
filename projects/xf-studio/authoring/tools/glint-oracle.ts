/** Deterministic, bounded CPU reference for subpixel glitter reflections.
 * Study only: the response is an illustrative narrow lobe, not REDengine BRDF.
 * The same fixed UV samples are grouped into 1K and 2K pixels. */
import {createHash} from "node:crypto";
import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createFlakeBakeJob,createRegionFlakeCatalogueJob,defaultIrregularFlakes,type Flake,type FlakeRegion,type FlakeNormalStudyMode} from "../src/flake-field";

export type Vec3=readonly [number,number,number];
export type Crop=Readonly<{x:number;y:number;width:number;height:number}>;
export const ORACLE_EYE_REGIONS:readonly FlakeRegion[]=[{minU:.27,maxU:.47,minV:.17,maxV:.28},{minU:.53,maxU:.73,minV:.17,maxV:.28}];
export const ORACLE_CROP_1K:Crop={x:328,y:205,width:40,height:24};
export const ORACLE_WIDTH_RADIANS=.035;
export const ORACLE_HALVES:Readonly<Record<string,Vec3>>={
  frontal:[0,0,1],
  grazingX:[Math.sin(.18),0,Math.cos(.18)],
  grazingY:[0,Math.sin(.18),Math.cos(.18)],
};
const normalise=(n:Vec3):Vec3=>{const d=Math.hypot(...n);if(!(d>0))throw Error("Zero normal");return [n[0]/d,n[1]/d,n[2]/d];};
/** A fixed angular Gaussian proxy for a sharp facet reflection. */
export function facetResponse(normal:Vec3,halfVector:Vec3,widthRadians:number):number{
  if(!(widthRadians>0&&Number.isFinite(widthRadians)))throw Error("Invalid lobe width");
  const n=normalise(normal),h=normalise(halfVector),dot=n[0]*h[0]+n[1]*h[1]+n[2]*h[2];
  return dot<=0?0:Math.exp(-Math.max(0,1-dot)/(.5*widthRadians*widthRadians));
}
/** Integrating each visible facet BEFORE any normal averaging is the reference. */
export function integrateFacetSamples(samples:readonly (Vec3|null)[],halfVector:Vec3,widthRadians:number){
  if(!samples.length)throw Error("No footprint samples");
  let covered=0, reflected=0,nx=0,ny=0,nz=0;
  for(const n of samples)if(n){covered++;reflected+=facetResponse(n,halfVector,widthRadians);nx+=n[0];ny+=n[1];nz+=n[2];}
  const meanNormal:Vec3=covered?normalise([nx,ny,nz]):[0,0,1];
  return {coverage:covered/samples.length,reflected:reflected/samples.length,meanNormal,
    averagedResponse:covered/samples.length*facetResponse(meanNormal,halfVector,widthRadians)};
}
/** Highest global ID wins overlaps, matching the project's deterministic baker. */
export function topFlakeAt(flakes:readonly Flake[],u:number,v:number):Flake|undefined{
  let top:Flake|undefined;
  for(const f of flakes){
    if(f.id<=(top?.id??-1)||u<f.bounds.minU||u>f.bounds.maxU||v<f.bounds.minV||v>f.bounds.maxV)continue;
    let inside=true;
    for(let i=0;i<f.vertices.length;i++){
      const a=f.vertices[i]!,b=f.vertices[(i+1)%f.vertices.length]!;
      if((b.u-a.u)*(v-a.v)-(b.v-a.v)*(u-a.u)<0){inside=false;break;}
    }
    if(inside)top=f;
  }
  return top;
}
function validateCrop(size:number,crop:Crop,axis:number){
  if(!Number.isInteger(size)||size<1||!Number.isInteger(axis)||axis<1||axis>32||
    ![crop.x,crop.y,crop.width,crop.height].every(Number.isInteger)||crop.x<0||crop.y<0||
    crop.width<1||crop.height<1||crop.x+crop.width>size||crop.y+crop.height>size)
    throw Error("Invalid oracle crop");
}
/** Independent direct polygon samples with per-pixel bounding-box candidates.
 * All positions are fixed in UV space, so camera motion never reseeds flakes. */
export function integrateCrop(flakes:readonly Flake[],size:number,crop:Crop,axis:number,halves:Readonly<Record<string,Vec3>>,widthRadians:number){
  validateCrop(size,crop,axis);
  const names=Object.keys(halves);if(!names.length)throw Error("No half vectors");
  const candidates:Flake[][]=Array.from({length:crop.width*crop.height},()=>[]);
  for(const f of flakes){
    const x0=Math.max(crop.x,Math.floor(f.bounds.minU*size)),x1=Math.min(crop.x+crop.width-1,Math.floor(f.bounds.maxU*size));
    const y0=Math.max(crop.y,Math.floor(f.bounds.minV*size)),y1=Math.min(crop.y+crop.height-1,Math.floor(f.bounds.maxV*size));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)candidates[(y-crop.y)*crop.width+x-crop.x]!.push(f);
  }
  const channels=Object.fromEntries(names.map(name=>[name,new Float32Array(candidates.length)])) as Record<string,Float32Array>;
  const coverage=new Float32Array(candidates.length);
  const normalSums={x:new Float32Array(candidates.length),y:new Float32Array(candidates.length),z:new Float32Array(candidates.length)};
  let facetHits=0,overlapHits=0,maxCandidates=0;
  for(let py=0;py<crop.height;py++)for(let px=0;px<crop.width;px++){
    const i=py*crop.width+px,local=candidates[i]!;maxCandidates=Math.max(maxCandidates,local.length);
    const totals=names.map(()=>0);let hits=0,nx=0,ny=0,nz=0;
    for(let sy=0;sy<axis;sy++)for(let sx=0;sx<axis;sx++){
      const u=(crop.x+px+(sx+.5)/axis)/size,v=(crop.y+py+(sy+.5)/axis)/size;
      const winner=topFlakeAt(local,u,v);if(!winner)continue;
      hits++;facetHits++;
      nx+=winner.normal[0];ny+=winner.normal[1];nz+=winner.normal[2];
      if(local.filter(f=>f.id!==winner.id&&u>=f.bounds.minU&&u<=f.bounds.maxU&&v>=f.bounds.minV&&v<=f.bounds.maxV&&
        f.vertices.every((a,k)=>{const b=f.vertices[(k+1)%f.vertices.length]!;return (b.u-a.u)*(v-a.v)-(b.v-a.v)*(u-a.u)>=0;})).length)overlapHits++;
      for(let j=0;j<names.length;j++)totals[j]!+=facetResponse(winner.normal,halves[names[j]!]!,widthRadians);
    }
    coverage[i]=hits/(axis*axis);
    normalSums.x[i]=nx/(axis*axis);normalSums.y[i]=ny/(axis*axis);normalSums.z[i]=nz/(axis*axis);
    for(let j=0;j<names.length;j++)channels[names[j]!]![i]=totals[j]!/(axis*axis);
  }
  return {channels,coverage,normalSums,diagnostics:{sampleCount:candidates.length*axis*axis,facetHits,overlapHits,maxCandidates}};
}
export function downsample2x2(source:Float32Array,width:number,height:number):Float32Array{
  if(width<2||height<2||width%2||height%2||source.length!==width*height)throw Error("Invalid 2x2 source");
  const out=new Float32Array(source.length/4),half=width/2;
  for(let y=0;y<height/2;y++)for(let x=0;x<half;x++){
    const i=(2*y)*width+2*x;
    out[y*half+x]=(source[i]!+source[i+1]!+source[i+width]!+source[i+width+1]!)/4;
  }
  return out;
}
/** Isolates information lost by averaging with the SAME dense coverage/samples.
 * This removes the 4x4 bake's spatial sampling and 8-bit encoding as causes. */
export function idealAveragedResponse(coverage:Float32Array,normalSums:{x:Float32Array;y:Float32Array;z:Float32Array},
  halfVector:Vec3,widthRadians:number,mode:FlakeNormalStudyMode):Float32Array{
  const count=coverage.length;
  if(normalSums.x.length!==count||normalSums.y.length!==count||normalSums.z.length!==count||
    (mode!=="surface-average"&&mode!=="covered-average"))throw Error("Invalid average reference inputs");
  const out=new Float32Array(count);
  for(let i=0;i<count;i++){
    const c=coverage[i]!;if(!c)continue;
    const n:Vec3=[normalSums.x[i]!,normalSums.y[i]!,normalSums.z[i]!+(mode==="surface-average"?1-c:0)];
    out[i]=c*facetResponse(n,halfVector,widthRadians);
  }
  return out;
}
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const floatSha=(a:Float32Array)=>sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
function mapCrop(normal:Uint8Array,surface:Uint8Array,size:number,crop:Crop,halves:Readonly<Record<string,Vec3>>,widthRadians:number){
  const names=Object.keys(halves),channels=Object.fromEntries(names.map(n=>[n,new Float32Array(crop.width*crop.height)])) as Record<string,Float32Array>;
  const coverage=new Float32Array(crop.width*crop.height),normalCrop=new Uint8Array(crop.width*crop.height*4),surfaceCrop=new Uint8Array(normalCrop.length);
  for(let y=0;y<crop.height;y++)for(let x=0;x<crop.width;x++){
    const j=y*crop.width+x,i=((y+crop.y)*size+x+crop.x)*4;
    normalCrop.set(normal.subarray(i,i+4),j*4);surfaceCrop.set(surface.subarray(i,i+4),j*4);
    const n:Vec3=[normal[i]!/255*2-1,normal[i+1]!/255*2-1,normal[i+2]!/255*2-1],c=surface[i]!/255;
    coverage[j]=c;
    for(const name of names)channels[name]![j]=c*facetResponse(n,halves[name]!,widthRadians);
  }
  return {channels,coverage,normalSha256:sha(normalCrop),surfaceSha256:sha(surfaceCrop)};
}
export function errorMetrics(reference:Float32Array,prediction:Float32Array){
  if(!reference.length||reference.length!==prediction.length)throw Error("Mismatched response arrays");
  let ae=0,se=0,bias=0,max=0,refMean=0,predMean=0,missed=0,falseBright=0,brightReference=0,brightPrediction=0;
  for(let i=0;i<reference.length;i++){
    const a=reference[i]!,b=prediction[i]!,d=b-a,ad=Math.abs(d);
    ae+=ad;se+=d*d;bias+=d;max=Math.max(max,ad);refMean+=a;predMean+=b;
    if(a>.02)brightReference++;if(b>.02)brightPrediction++;
    if(a>.02&&b<.005)missed++;if(b>.02&&a<.005)falseBright++;
  }
  const n=reference.length;
  return {mae:ae/n,rmse:Math.sqrt(se/n),max,bias:bias/n,referenceMean:refMean/n,predictedMean:predMean/n,
    referenceBrightPixels:brightReference,predictedBrightPixels:brightPrediction,missedBrightPixels:missed,falseBrightPixels:falseBright};
}
export function runGlintOracle(){
  const settings={...defaultIrregularFlakes(),count:350000,radius:.00045},started=performance.now();
  const generator=createRegionFlakeCatalogueJob(settings,ORACLE_EYE_REGIONS);
  while(!generator.done)generator.advance(8192);
  const catalogue=generator.catalogue!,catalogueMs=performance.now()-started;
  const crop2:Crop={x:ORACLE_CROP_1K.x*2,y:ORACLE_CROP_1K.y*2,width:ORACLE_CROP_1K.width*2,height:ORACLE_CROP_1K.height*2};
  const oracleStart=performance.now();
  const fine=integrateCrop(catalogue.flakes,2048,crop2,8,ORACLE_HALVES,ORACLE_WIDTH_RADIANS);
  const oracleMs=performance.now()-oracleStart;
  const groundTruth:Record<string,{at1K:Float32Array;at2K:Float32Array}>={};
  for(const [name,a]of Object.entries(fine.channels))groundTruth[name]={at2K:a,at1K:downsample2x2(a,crop2.width,crop2.height)};
  const coverage1=downsample2x2(fine.coverage,crop2.width,crop2.height);
  const normalSums1={x:downsample2x2(fine.normalSums.x,crop2.width,crop2.height),
    y:downsample2x2(fine.normalSums.y,crop2.width,crop2.height),z:downsample2x2(fine.normalSums.z,crop2.width,crop2.height)};
  const comparisons=[];
  for(const size of [1024,2048] as const)for(const normalMode of ["surface-average","covered-average"] as const){
    const start=performance.now(),job=createFlakeBakeJob(catalogue,size,4,normalMode);
    while(!job.done)job.advance(8192);
    const bakeMs=performance.now()-start,crop=size===1024?ORACLE_CROP_1K:crop2;
    const map=mapCrop(job.normal,job.surface,size,crop,ORACLE_HALVES,ORACLE_WIDTH_RADIANS);
    const truthCoverage=size===1024?coverage1:fine.coverage;
    const truthNormalSums=size===1024?normalSums1:fine.normalSums;
    const entries=Object.fromEntries(Object.entries(map.channels).map(([name,prediction])=>{
      const reference=size===1024?groundTruth[name]!.at1K:groundTruth[name]!.at2K;
      const idealAverage=idealAveragedResponse(truthCoverage,truthNormalSums,ORACLE_HALVES[name]!,ORACLE_WIDTH_RADIANS,normalMode);
      return [name,{oracleSha256:floatSha(reference),idealAverageSha256:floatSha(idealAverage),averagedMapResponseSha256:floatSha(prediction),
        intrinsicAveragingError:errorMetrics(reference,idealAverage),bakeAndEncodingError:errorMetrics(idealAverage,prediction),error:errorMetrics(reference,prediction)}];
    }));
    comparisons.push({size,normalMode,bakeMs,normalCropSha256:map.normalSha256,surfaceCropSha256:map.surfaceSha256,
      coverageError:errorMetrics(truthCoverage,map.coverage),halfVectors:entries});
  }
  return {study:"xfs-fine-glint-cpu-oracle-1",method:"16x16 fixed UV samples per 1K pixel; same samples regrouped 8x8 per 2K pixel; highest fragment ID wins; Gaussian angular lobe before vs after pixel normal averaging",settings,
    regions:ORACLE_EYE_REGIONS,crop1K:ORACLE_CROP_1K,crop2K:crop2,lobeWidthRadians:ORACLE_WIDTH_RADIANS,halfVectors:ORACLE_HALVES,
    retainedFlakes:catalogue.flakes.length,globalCount:catalogue.studyRegion?.globalCount,catalogueMs,oracleMs,oracleDiagnostics:fine.diagnostics,
    oracleCoverage1KSha256:floatSha(coverage1),oracleCoverage2KSha256:floatSha(fine.coverage),comparisons,
    limitations:"Study-only narrow Gaussian lobe and fixed UV footprint; no REDengine BRDF, occlusion, game lighting, camera motion, anisotropic filtering or validated GPU cost. The retained field is incomplete outside the two regions."};
}
if(import.meta.main){
  const report=runGlintOracle();
  if(process.argv.includes("--write-evidence"))writeFileSync(resolve(import.meta.dir,"../../../../experiments/007-irregular-glitter/glint-oracle-evidence.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
