/** Deterministic generated-versus-resolved count audit for the browser eye shape.
 * Run: bun experiments/007-irregular-glitter/measure-studio-visibility.ts
 * It reads no private asset and makes no game-rendering claim. */
import { coverage, raster } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/recipe";
import { createRegionFlakeCatalogueJob, createFlakeBakeJob, defaultStudioIrregularFlakes } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/flake-field";
import { EYE_MAKEUP_REGION, initialRecipe } from "../../projects/xf-studio/authoring/src/features/eye-makeup/region";

const layer=initialRecipe().layers[0];
const base=defaultStudioIrregularFlakes();
function run(count:number,radius:number){
  const settings={...base,count,radius};
  const catalogueJob=createRegionFlakeCatalogueJob(settings,EYE_MAKEUP_REGION.fineGlitter.regions);
  const begun=performance.now();
  while(!catalogueJob.done)catalogueJob.advance(256);
  const catalogue=catalogueJob.catalogue!;
  const catalogueMs=performance.now()-begun;
  const maskCentres=catalogue.flakes.filter(f=>coverage(f.u, f.v, layer, EYE_MAKEUP_REGION.mirror)>0).length;
  const diameters=catalogue.flakes.map(f=>f.radius*2).sort((a,b)=>a-b);
  const sizes=[1024,2048].map(size=>{
    const mask=raster(layer, size, EYE_MAKEUP_REGION.mirror),job=createFlakeBakeJob(catalogue,size,4,"covered-average");
    while(!job.done)job.advance(512);
    let painted=0,resolved=0,strong=0,veryStrong=0,coveredSum=0;
    for(let i=0;i<size*size;i++)if(mask[i*4+3]){
      painted++;
      const c=job.surface[i*4]!/255;
      coveredSum+=c;
      if(c>0)resolved++;
      if(c>=.25)strong++;
      if(c>=.5)veryStrong++;
    }
    return {size,paintedMaskPixels:painted,resolvedCoveragePixels:resolved,
      coverageAtLeastQuarter:strong,coverageAtLeastHalf:veryStrong,
      meanCoverageInPaint:coveredSum/painted,
      centralFlakeDiameterPixels:{median:diameters[Math.floor(diameters.length/2)]!*size,
        p95:diameters[Math.floor(diameters.length*.95)]!*size},
      bakeDiagnostics:job.diagnostics};
  });
  return {settings:{count,radius,spread:settings.spread,seed:settings.seed},
    regionRetained:catalogue.flakes.length,centresInsideMask:maskCentres,
    catalogueMs,sizes};
}
console.log(JSON.stringify([run(350000,.00045),run(500000,.00025)],null,2));
