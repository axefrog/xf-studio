import { createRasterJob, type Layer } from "./recipe";
import { createFlakeJob, defaultFlakes, isIrregular, type FlakeMaps } from "./finish";
import { createFlakeCatalogueJob, createRegionFlakeCatalogueJob, createFlakeBakeJob, createFlakeColourJob,
  FLAKE_LIMITS, STUDIO_FINE_REGIONS } from "./flake-field";
import { maskAlphaKey, studioIrregularOpticalKey, irregularAlbedoKey } from "./makeup-dependencies";

export type RasterRequest = { i: number; version: number; layer: Layer; size: number; bakeOptics?: boolean };
export type RasterResponse = { i: number; version: number } & (
  { cancelled: true; error?: string } | { cancelled?: false; size: number; data: Uint8ClampedArray<ArrayBuffer>;
    optics?: FlakeMaps; albedo?: {key:string; data:Uint8Array<ArrayBuffer>}; ms: number }
);

const CACHE_CAP = 64 * 1024 * 1024;
type Channel = {key:string; size:number; data:Uint8Array};
/** One current job with cooperative cancellation. Only complete bundles publish.
 * The compact one-channel caches are independent of transferred RGBA outputs. */
export function createRasterProcessor(post: (result: RasterResponse) => void,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
  now: () => number = () => performance.now()) {
  let active: { i: number; version: number; cancelled: boolean } | undefined;
  let cachedAlpha: Channel | undefined, cachedCoverage: Channel | undefined;
  return {
    cancel(version: number) { if (active?.version === version) active.cancelled = true; },
    async start(request: RasterRequest) {
      if (active) active.cancelled = true;
      const snapshot = structuredClone(request);
      const token = { i: snapshot.i, version: snapshot.version, cancelled: false };
      active = token;
      const drain = async (job: {done: boolean; advance(work: number): boolean}, work: number) => {
        while (!job.done && !token.cancelled) {
          const deadline = now() + 8;
          do { job.advance(work); } while (!job.done && now() < deadline);
          if (!job.done) await pause();
        }
      };
      try {
        const start = now(), layer = snapshot.layer, size = snapshot.size;
        const candidate=layer.flakes;
        const irregular = layer.enabled && layer.finish === "glitter" && isIrregular(candidate);
        const alphaKey = irregular ? maskAlphaKey(layer,size) : undefined;
        let data: Uint8ClampedArray<ArrayBuffer>;
        if (irregular && cachedAlpha && cachedAlpha.key === alphaKey && cachedAlpha.size === size) {
          data = new Uint8ClampedArray(size * size * 4);
          const alpha = cachedAlpha!.data;
          let pixel = 0;
          await drain({get done(){return pixel === size*size;}, advance(work:number){
            const end=Math.min(size*size,pixel+work);
            for(;pixel<end;pixel++){const i=pixel*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=alpha[pixel]!;}
            return pixel===size*size;
          }},4096);
        } else {
          const job = createRasterJob(layer, size);
          await drain(job,16);
          data = job.data;
        }
        let optics: FlakeMaps | undefined, albedo: {key:string;data:Uint8Array<ArrayBuffer>} | undefined;
        if (!token.cancelled && irregular) {
          const settings=candidate as import("./flake-field").IrregularFlakes;
          const opticalKey=studioIrregularOpticalKey(settings,size), fine=settings.count>FLAKE_LIMITS.count;
          if (fine) {
            // Fixed atlas scope keeps the optical key independent of shape.
            // Check every painted pixel before using a clipped catalogue, even
            // on a cache hit after a shape edit.
            let pixel=0, outside=false;
            await drain({get done(){return pixel===size*size || outside;},advance(work:number){
              const end=Math.min(size*size,pixel+work);
              for(;pixel<end;pixel++)if(data[pixel*4+3]){
                const x=pixel%size,y=Math.floor(pixel/size);
                if(!STUDIO_FINE_REGIONS.some(r=>x/size>=r.minU&&(x+1)/size<=r.maxU &&
                  y/size>=r.minV&&(y+1)/size<=r.maxV)){outside=true;break;}
              }
              return pixel===size*size || outside;
            }},4096);
            if (!token.cancelled && outside) {
              post({i:token.i,version:token.version,cancelled:true,error:"Fine Glitter supports the eye UV area; move or narrow this shape before previewing it."});
              return;
            }
          }
          let coverage = cachedCoverage?.key===opticalKey && cachedCoverage.size===size ? cachedCoverage.data : undefined;
          if (snapshot.bakeOptics || !coverage) {
            await pause();
            if (!token.cancelled) {
              const catalogueJob=fine ? createRegionFlakeCatalogueJob(settings,STUDIO_FINE_REGIONS)
                : createFlakeCatalogueJob(settings);
              await drain(catalogueJob,128);
              await pause();
              if (!token.cancelled) {
                const optical=createFlakeBakeJob(catalogueJob.catalogue!,size,4,"covered-average");
                await drain(optical,256);
                if (!token.cancelled) {
                  optics={size,normal:optical.normal,surface:optical.surface};
                  const channel=new Uint8Array(size*size);
                  let pixel=0;
                  await drain({get done(){return pixel===size*size;},advance(work:number){
                    const end=Math.min(size*size,pixel+work);
                    for(;pixel<end;pixel++)channel[pixel]=optical.surface[pixel*4]!;
                    return pixel===size*size;
                  }},4096);
                  if (!token.cancelled) coverage=channel;
                }
              }
            }
          }
          if (!token.cancelled && coverage) {
            await pause();
          }
          if (!token.cancelled && coverage) {
            const surface=new Uint8Array(size*size*4);
            let pixel=0;
            await drain({get done(){return pixel===size*size;},advance(work:number){
              const end=Math.min(size*size,pixel+work);
              for(;pixel<end;pixel++)surface[pixel*4]=coverage![pixel]!;
              return pixel===size*size;
            }},4096);
            if (!token.cancelled) {
              await pause();
            }
            if (!token.cancelled) {
              const colour=createFlakeColourJob(surface,layer.color,settings.color,data);
              await drain(colour,4096);
              if (!token.cancelled) albedo={key:irregularAlbedoKey(opticalKey,alphaKey!,layer.color,settings.color),data:colour.rgba};
            }
          }
          if (!token.cancelled && coverage && size*size*2<=CACHE_CAP) {
            const alpha=new Uint8Array(size*size);
            let pixel=0;
            await drain({get done(){return pixel===size*size;},advance(work:number){
              const end=Math.min(size*size,pixel+work);
              for(;pixel<end;pixel++)alpha[pixel]=data[pixel*4+3]!;
              return pixel===size*size;
            }},4096);
            if (!token.cancelled) {
              cachedCoverage={key:opticalKey,size,data:coverage};
              cachedAlpha={key:alphaKey!,size,data:alpha};
            }
          }
        } else if (!token.cancelled && snapshot.bakeOptics && layer.enabled && (layer.finish === "shimmer" || layer.finish === "glitter")) {
          await pause();
          if (!token.cancelled) {
            const optical = createFlakeJob(size,layer.finish,isIrregular(layer.flakes) ? defaultFlakes() : layer.flakes ?? defaultFlakes());
            await drain(optical,256);
            if (!token.cancelled) optics = {size: optical.size,normal: optical.normal,surface: optical.surface};
          }
        }
        if (token.cancelled) post({ i: token.i, version: token.version, cancelled: true });
        else post({ i: token.i, version: token.version, size, data, ...(optics ? {optics} : {}),
          ...(albedo ? {albedo} : {}), ms: now() - start });
      } finally {
        if (active === token) active = undefined;
      }
    },
  };
}
