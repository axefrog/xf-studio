/** Reproducible owned-pixel study; no game assets, browser state or installation. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createFlakeJob, defaultFlakes } from "../src/engines/layered-makeup/finish";
import { createFlakeCatalogue, createRegionFlakeCatalogueJob, createFlakeBakeJob, composeFlakeColour, defaultIrregularFlakes, type IrregularFlakes, type FlakeRegion,type FlakeNormalStudyMode } from "../src/engines/layered-makeup/flake-field";
import { raster } from "../src/engines/layered-makeup/recipe";
import { EYE_MAKEUP_REGION, initialRecipe } from "../src/features/eye-makeup/region";

const output = resolve(import.meta.dir, "../../../../experiments/007-irregular-glitter/generated");
mkdirSync(output, { recursive: true });
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const base = "#592640", candidate = defaultIrregularFlakes();
const eyeRegions:readonly FlakeRegion[]=[{minU:.27,maxU:.47,minV:.17,maxV:.28},{minU:.53,maxU:.73,minV:.17,maxV:.28}];
const fineOnly=process.argv.includes("--fine");
const coveredOnly=process.argv.includes("--covered");
type Spec={name:string;settings:IrregularFlakes|null;sizes:number[];sampleAxis?:2|4;regions?:readonly FlakeRegion[];normalMode?:FlakeNormalStudyMode};
const original:Spec[] = [
  { name: "legacy", settings: null, sizes: [1024, 2048] },
  { name: "sparse", settings: { ...candidate, count: 6000 }, sizes: [1024, 2048] },
  { name: "default", settings: candidate, sizes: [1024, 2048] },
  { name: "default-16sample", settings: candidate, sizes: [1024, 2048], sampleAxis: 4 as const },
  { name: "dense", settings: { ...candidate, count: 30000 }, sizes: [1024, 2048] },
  { name: "maximum", settings: { ...candidate, count: 32768, radius: 0.003, spread: 1, tilt: 1 }, sizes: [1024, 2048] },
];
const fine:Spec[]=[
  {name:"fine160k",settings:{...candidate,count:160000,radius:.0006},sizes:[1024,2048],sampleAxis:4,regions:eyeRegions},
  {name:"fine350k",settings:{...candidate,count:350000,radius:.00045},sizes:[1024,2048],sampleAxis:4,regions:eyeRegions},
];
const covered:Spec[]=[{...fine[1]!,name:"fine350k-covered",normalMode:"covered-average"}];
const specs=coveredOnly?covered:fineOnly?fine:original;
const fixed=initialRecipe().layers[0]!;fixed.color=base;fixed.opacity=1;fixed.enabled=true;
const regionMaskEvidence=Object.fromEntries([1024,2048].map(size=>{
  const mask=raster(fixed, size, EYE_MAKEUP_REGION.mirror);let nonzeroPixels=0,unsupportedPixels=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(mask[(y*size+x)*4+3]){
    nonzeroPixels++;
    // Require the full pixel footprint, not only its centre, to lie in the ROI.
    if(!eyeRegions.some(r=>x/size>=r.minU&&(x+1)/size<=r.maxU&&y/size>=r.minV&&(y+1)/size<=r.maxV))unsupportedPixels++;
  }
  if(unsupportedPixels)throw Error(`Study regions miss ${unsupportedPixels} painted pixels at ${size}`);
  return [size,{nonzeroPixels,unsupportedPixels,maskSha256:sha(new Uint8Array(mask))}];
}));
const records = [];
for (const spec of specs) {
  const startCatalogue = performance.now();
  let catalogue=spec.settings&&!spec.regions?createFlakeCatalogue(spec.settings):null;
  let catalogueMaxSliceMs=0,catalogueSlices=0;
  if(spec.regions&&spec.settings){
    const generation=createRegionFlakeCatalogueJob(spec.settings,spec.regions);
    while(!generation.done){const started=performance.now();generation.advance(2048);catalogueMaxSliceMs=Math.max(catalogueMaxSliceMs,performance.now()-started);catalogueSlices++;}
    catalogue=generation.catalogue!;
  }
  const catalogueMs = performance.now() - startCatalogue;
  const radii = catalogue?.flakes.map(f => f.radius).sort((a,b) => a-b);
  const quantiles = radii ? [0, .1, .5, .9, 1].map(q => radii[Math.floor(q * (radii.length - 1))]) : null;
  for (const size of spec.sizes) {
    const started = performance.now();
    const job = catalogue ? createFlakeBakeJob(catalogue, size, spec.sampleAxis ?? 2,spec.normalMode??"surface-average") : createFlakeJob(size, "glitter", defaultFlakes());
    let slices = 0, maxSliceMs = 0;
    while (!job.done) {
      const slice = performance.now();
      job.advance(4096);
      maxSliceMs = Math.max(maxSliceMs, performance.now() - slice);
      slices++;
    }
    const bakeMs = performance.now() - started;
    const color = composeFlakeColour(job.surface, base, spec.settings?.color ?? base);
    const files = [];
    for (const [kind, data] of [["normal", job.normal], ["surface", job.surface], ["color", color]] as const) {
      const name = `${spec.name}-${size}-${kind}.rgba`;
      writeFileSync(resolve(output, name), data);
      files.push({ name, bytes: data.byteLength, sha256: sha(data) });
    }
    const record = { name: spec.name, size, settings: spec.settings ?? defaultFlakes(), sampleAxis: spec.sampleAxis ?? 2,normalMode:spec.normalMode??"surface-average", base, catalogueMs,catalogueSlices,catalogueMaxSliceMs,
      studyRegion:catalogue?.studyRegion??null,regionMaskEvidence:spec.regions?regionMaskEvidence[size]:null,radiusQuantiles: quantiles,
      bakeMs, maxSliceMs, slices, diagnostics: "diagnostics" in job ? job.diagnostics : null, files };
    records.push(record);
    console.log(JSON.stringify({ name: spec.name, size, bakeMs, maxSliceMs }));
  }
}
writeFileSync(resolve(output, coveredOnly?"covered-manifest.json":fineOnly?"fine-manifest.json":"manifest.json"), JSON.stringify({ study: "irregular-planar-1 prototype",regionDisclaimer:"Region study maps match the global deterministic ID field only inside their explicit valid regions; outside is incomplete. No production schema accepts these wider bounds.",records }, null, 2) + "\n");
console.log(output);
