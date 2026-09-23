/** Isolated irregular glitter study. Not a production recipe or calibrated game material.
 * Geometry is UV anchored; normal-map filtering still loses subpixel normal variance. */
export type IrregularFlakes = {
  model: "irregular-planar-1"; count: number; radius: number; spread: number;
  tilt: number; seed: number; color: string;
};
export const FLAKE_LIMITS = Object.freeze({count: 32768, minRadius: .0004, maxRadius: .003, maxSeed: 2147483647, minSize: 32, maxSize: 4096});
export const REGION_FLAKE_STUDY_LIMITS=Object.freeze({count:500000,minRadius:.00025,maxRadius:.0006,maxRegions:2,maxArea:.16,maxRetained:80000});
export const FLAKE_MATERIAL = Object.freeze({baseRoughness: .7, flakeRoughness: .2, baseMetalness: 0, flakeMetalness: .95});
export const FLAKE_TILE_SIZE = 32;
export const FLAKE_SUBSAMPLES = Object.freeze([Object.freeze([.25, .25]), Object.freeze([.75, .25]), Object.freeze([.25, .75]), Object.freeze([.75, .75])]);
export const FLAKE_SUBSAMPLES_16 = Object.freeze(Array.from({length: 16}, (_, i) => Object.freeze([(i % 4 + .5) / 4, (Math.floor(i / 4) + .5) / 4])));
export type FlakeNormalStudyMode="surface-average"|"covered-average";
export const defaultIrregularFlakes = (): IrregularFlakes => ({model: "irregular-planar-1", count: 16000, radius: .0012, spread: .7, tilt: .35, seed: 2077, color: "#f5df9f"});
/** Browser-editor default, calibrated to the bounded fine-eye experiment. The
 * legacy 16k study default above remains reproducible as a separate fixture. */
export const defaultStudioIrregularFlakes = (): IrregularFlakes => ({model:"irregular-planar-1",count:350000,
  radius:.00045,spread:.7,tilt:.35,seed:2077,color:"#d6b69e"});
/** The two regions cover the authored eye plate with margin. They are a
 * deliberate operational scope, not an image-space crop or a procedural tile. */
export const STUDIO_FINE_REGIONS: readonly FlakeRegion[] = Object.freeze([
  Object.freeze({minU:.20,maxU:.50,minV:.12,maxV:.36}),
  Object.freeze({minU:.50,maxU:.80,minV:.12,maxV:.36}),
]);
export function validStudioIrregularSettings(value: unknown): value is IrregularFlakes {
  if (!value || typeof value!=="object" || Array.isArray(value)) return false;
  const p=value as IrregularFlakes;
  const fine=Number.isInteger(p.count) && p.count>FLAKE_LIMITS.count;
  return Object.keys(p).sort().join()==="color,count,model,radius,seed,spread,tilt" &&
    p.model==="irregular-planar-1" && Number.isInteger(p.count) && p.count>=0 &&
    p.count<=REGION_FLAKE_STUDY_LIMITS.count && Number.isFinite(p.radius) &&
    p.radius >= (fine?REGION_FLAKE_STUDY_LIMITS.minRadius:FLAKE_LIMITS.minRadius) &&
    p.radius <= (fine?REGION_FLAKE_STUDY_LIMITS.maxRadius:FLAKE_LIMITS.maxRadius) &&
    Number.isFinite(p.spread) && p.spread>=0 && p.spread<=1 &&
    Number.isFinite(p.tilt) && p.tilt>=0 && p.tilt<=1 &&
    Number.isInteger(p.seed) && p.seed>=0 && p.seed<=FLAKE_LIMITS.maxSeed && validHex(p.color);
}
export type Flake = Readonly<{
  id: number; u: number; v: number; radius: number; aspect: number; angle: number;
  normal: readonly [number, number, number];
  vertices: readonly Readonly<{u: number; v: number}>[];
  bounds: Readonly<{minU: number; minV: number; maxU: number; maxV: number}>;
}>;
export type FlakeRegion=Readonly<{minU:number;minV:number;maxU:number;maxV:number}>;
export type FlakeCatalogue = Readonly<{settings: Readonly<IrregularFlakes>; flakes: readonly Flake[];
  studyRegion?:Readonly<{regions:readonly FlakeRegion[];globalCount:number;retained:number;centreHalo:number}>}>;
const catalogues = new WeakSet<FlakeCatalogue>();
const validHex = (s: unknown): s is string => typeof s === "string" && /^#[\da-f]{6}$/i.test(s);
function validateSettings(p: IrregularFlakes,limits:{count:number;minRadius:number;maxRadius:number}=FLAKE_LIMITS) {
  if (!p || typeof p !== "object" || Array.isArray(p) ||
      Object.keys(p).sort().join() !== "color,count,model,radius,seed,spread,tilt" || p.model !== "irregular-planar-1" ||
      !Number.isInteger(p.count) || p.count < 0 || p.count > limits.count ||
      !Number.isFinite(p.radius) || p.radius < limits.minRadius || p.radius > limits.maxRadius ||
      !Number.isFinite(p.spread) || p.spread < 0 || p.spread > 1 ||
      !Number.isFinite(p.tilt) || p.tilt < 0 || p.tilt > 1 ||
      !Number.isInteger(p.seed) || p.seed < 0 || p.seed > FLAKE_LIMITS.maxSeed || !validHex(p.color))
    throw Error("Invalid irregular flake settings");
}
function random(seed: number, id: number, salt: number) {
  let h = Math.imul(id + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ h >>> 16, 0x7feb352d);
  h = Math.imul(h ^ h >>> 15, 0x846ca68b);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
/** Each ID owns independent hash lanes, so count appends a stable prefix.
 * Six ordered ellipse points stay strictly convex; unequal angular gaps provide
 * fragment silhouettes without radial normal domes or grid-centred placement. */
function createFragment(settings:Readonly<IrregularFlakes>,id:number):Flake {
    const q = random(settings.seed, id, 2), u = random(settings.seed, id, 0), v = random(settings.seed, id, 1);
    const radius = settings.radius * (1 + settings.spread * (1.8 * q * q - .8));
    const angle = random(settings.seed, id, 3) * Math.PI * 2, aspect = .48 + .52 * random(settings.seed, id, 4);
    const azimuth = random(settings.seed, id, 5) * Math.PI * 2;
    const tilt = Math.sqrt(random(settings.seed, id, 6)) * settings.tilt * 1.1;
    const normal = Object.freeze([Math.sin(tilt) * Math.cos(azimuth), Math.sin(tilt) * Math.sin(azimuth), Math.cos(tilt)] as const);
    const c = Math.cos(angle), s = Math.sin(angle);
    const vertices = Array.from({length: 6}, (_, k) => {
      const a = (k + .5 * (random(settings.seed, id, 7 + k) - .5)) * Math.PI / 3;
      const x = radius * Math.cos(a), y = radius * aspect * Math.sin(a);
      return Object.freeze({u: u + x * c - y * s, v: v + x * s + y * c});
    });
    const bounds = Object.freeze({minU: Math.min(...vertices.map(p => p.u)), maxU: Math.max(...vertices.map(p => p.u)), minV: Math.min(...vertices.map(p => p.v)), maxV: Math.max(...vertices.map(p => p.v))});
    return Object.freeze({id,u,v,radius,aspect,angle,normal,vertices: Object.freeze(vertices),bounds});
}
export function createFlakeCatalogue(input: IrregularFlakes): FlakeCatalogue {
  validateSettings(input);
  const settings = Object.freeze({...input}), flakes: Flake[] = [];
  for (let id = 0; id < settings.count; id++) flakes.push(createFragment(settings,id));
  const catalogue = Object.freeze({settings, flakes: Object.freeze(flakes)});
  catalogues.add(catalogue);
  return catalogue;
}
/** Production catalogue construction is sliced so a cancelled request can stop
 * before all fragments have been materialized. It has the same ID order as the
 * synchronous study helper. */
export function createFlakeCatalogueJob(input: IrregularFlakes) {
  validateSettings(input);
  const settings = Object.freeze({...input}), flakes: Flake[] = [];
  let id = 0, catalogue: FlakeCatalogue | undefined;
  return {get done() {return !!catalogue;}, get catalogue() {return catalogue;},
    advance(workBudget: number) {
      validateWork(workBudget);
      const end = Math.min(settings.count, id + workBudget);
      for (; id < end; id++) flakes.push(createFragment(settings,id));
      if (id === settings.count && !catalogue) {
        catalogue = Object.freeze({settings, flakes: Object.freeze(flakes)});
        catalogues.add(catalogue);
      }
      return !!catalogue;
    }};
}
/** Bounded study-only alternative to materializing half a million JS objects.
 * Scans the SAME resolution-independent global IDs and retains every fragment
 * that could reach one of the explicit valid regions. Output outside those
 * regions is incomplete; this is not a portable recipe or automatic LOD.
 * Dropping the job cancels work; no catalogue is exposed before completion. */
export function createRegionFlakeCatalogueJob(input:IrregularFlakes,inputRegions:readonly FlakeRegion[]){
  validateSettings(input,REGION_FLAKE_STUDY_LIMITS);
  const limits=REGION_FLAKE_STUDY_LIMITS;
  if(!Array.isArray(inputRegions)||!inputRegions.length||inputRegions.length>limits.maxRegions||inputRegions.some(r=>
    !r||Object.keys(r).sort().join()!=="maxU,maxV,minU,minV"||
    ![r.minU,r.minV,r.maxU,r.maxV].every(Number.isFinite)||r.minU<0||r.minV<0||r.maxU>1||r.maxV>1||r.maxU<=r.minU||r.maxV<=r.minV)||
    inputRegions.reduce((a,r)=>a+(r.maxU-r.minU)*(r.maxV-r.minV),0)>limits.maxArea)throw Error("Invalid bounded flake study regions");
  const settings=Object.freeze({...input}),regions=Object.freeze(inputRegions.map(r=>Object.freeze({...r}))),
    centreHalo=settings.radius*(1+settings.spread),flakes:Flake[]=[];
  let next=0,catalogue:FlakeCatalogue|undefined;
  return {get done(){return !!catalogue;},get catalogue(){return catalogue;},
    diagnostics:()=>({scanned:next,retained:flakes.length,globalCount:settings.count,centreHalo,regions}),
    advance(workBudget:number){
      validateWork(workBudget);
      const end=Math.min(settings.count,next+workBudget);
      for(;next<end;next++){
        const u=random(settings.seed,next,0),v=random(settings.seed,next,1);
        if(regions.some(r=>u>=r.minU-centreHalo&&u<=r.maxU+centreHalo&&v>=r.minV-centreHalo&&v<=r.maxV+centreHalo)){
          if(flakes.length>=limits.maxRetained)throw Error("Flake study retained-fragment budget exceeded; narrow the regions");
          flakes.push(createFragment(settings,next));
        }
      }
      if(next===settings.count&&!catalogue){
        catalogue=Object.freeze({settings,flakes:Object.freeze(flakes),studyRegion:Object.freeze({regions,globalCount:settings.count,retained:flakes.length,centreHalo})});
        catalogues.add(catalogue);
      }
      return !!catalogue;
    },
  };
}
function contains(f: Flake, u: number, v: number) {
  for (let k = 0; k < 6; k++) {
    const a = f.vertices[k]!, b = f.vertices[(k + 1) % 6]!;
    if ((b.u - a.u) * (v - a.v) - (b.v - a.v) * (u - a.u) < 0) return false;
  }
  return true;
}
function validateWork(work: number) {
  if (!(work > 0) || (work !== Infinity && !Number.isInteger(work))) throw Error("Invalid flake work budget");
}
const byte = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
/** Only the two output atlases are full size. Scratch holds 32x32x(4 or 16) IDs.
 * advance() accounts for indexing, tile setup, candidate pixels and output pixels;
 * candidate tests within one unit are bounded to sixteen six-edge polygon queries.
 * sampleAxis and normalMode are study-only ablations, not released schema
 * properties. Covered averaging excludes uncovered base-Z samples; it cannot
 * recover individual facets or their normal distribution after filtering. */
export function createFlakeBakeJob(catalogue: FlakeCatalogue, size: number, sampleAxis: 2 | 4 = 2,normalMode:FlakeNormalStudyMode="surface-average") {
  if (!catalogues.has(catalogue)) throw Error("Expected a catalogue created by createFlakeCatalogue");
  if (!Number.isInteger(size) || size < FLAKE_LIMITS.minSize || size > FLAKE_LIMITS.maxSize) throw Error("Invalid flake map size");
  if (sampleAxis !== 2 && sampleAxis !== 4) throw Error("Invalid flake sampling study axis");
  if(normalMode!=="surface-average"&&normalMode!=="covered-average")throw Error("Invalid flake normal study mode");
  const samples = sampleAxis === 2 ? FLAKE_SUBSAMPLES : FLAKE_SUBSAMPLES_16, sampleCount = sampleAxis * sampleAxis;
  const normal = new Uint8Array(size * size * 4), surface = new Uint8Array(normal.length);
  const edge = FLAKE_TILE_SIZE, across = Math.ceil(size / edge), bins: number[][] = Array.from({length: across * across}, () => []);
  const winners = new Int32Array(edge * edge * sampleCount);
  const diagnostics = {sampleCount,normalMode, candidateVisits: 0, subsampleTests: 0, coveredSamples: 0, pixels: 0, tiles: 0, indexedFlakes: 0, slices: 0, scratchBytes: winners.byteLength};
  let indexed = 0, tile = -1, nextCandidate = 0, done = false, output = 0;
  let x0 = 0, y0 = 0, width = 0, height = 0, candidate: Flake | undefined,candidateIndex=0;
  let px = 0, py = 0, cx0 = 0, cx1 = 0, cy1 = 0;
  const bounds = (f: Flake) => ({
    x0: Math.max(0, Math.floor(f.bounds.minU * size)), y0: Math.max(0, Math.floor(f.bounds.minV * size)),
    x1: Math.min(size - 1, Math.floor(f.bounds.maxU * size)), y1: Math.min(size - 1, Math.floor(f.bounds.maxV * size)),
  });
  return {size, normal, surface, diagnostics, get done() {return done;},
    advance(workBudget: number) {
      validateWork(workBudget); diagnostics.slices++;
      let work = 0;
      while (!done && work++ < workBudget) {
        if (indexed < catalogue.flakes.length) {
          const b = bounds(catalogue.flakes[indexed]!);
          for (let y = Math.floor(b.y0 / edge); y <= Math.floor(b.y1 / edge); y++)
            for (let x = Math.floor(b.x0 / edge); x <= Math.floor(b.x1 / edge); x++) bins[y * across + x]!.push(indexed);
          indexed++; diagnostics.indexedFlakes++; continue;
        }
        if (tile < 0 || output >= width * height) {
          if (++tile >= bins.length) {done = true; break;}
          x0 = tile % across * edge; y0 = Math.floor(tile / across) * edge;
          width = Math.min(edge, size - x0); height = Math.min(edge, size - y0);
          winners.fill(-1); output = 0; nextCandidate = 0; diagnostics.tiles++; candidate = undefined; continue;
        }
        if (!candidate && nextCandidate < bins[tile]!.length) {
          candidateIndex=bins[tile]![nextCandidate++]!;candidate = catalogue.flakes[candidateIndex]!;
          const b = bounds(candidate);
          cx0 = Math.max(x0, b.x0); cx1 = Math.min(x0 + width - 1, b.x1); cy1 = Math.min(y0 + height - 1, b.y1);
          px = cx0; py = Math.max(y0, b.y0);
        }
        if (candidate) {
          diagnostics.candidateVisits++;
          const local = ((py - y0) * edge + px - x0) * sampleCount;
          for (let s = 0; s < sampleCount; s++) {
            const sample = samples[s]!;
            diagnostics.subsampleTests++;
            const previous=winners[local+s]!;
            if (contains(candidate, (px + sample[0]!) / size, (py + sample[1]!) / size) &&
              (previous<0||candidate.id>catalogue.flakes[previous]!.id)) winners[local + s] = candidateIndex;
          }
          if (++px > cx1) {px = cx0; if (++py > cy1) candidate = undefined;}
          continue;
        }
        const x = output % width, y = Math.floor(output / width), i = ((y0 + y) * size + x0 + x) * 4;
        const local = (y * edge + x) * sampleCount;
        let nx = 0, ny = 0, nz = 0, covered = 0;
        for (let s = 0; s < sampleCount; s++) {
          const id = winners[local + s]!;
          if (id < 0) {if(normalMode==="surface-average")nz++;}
          else {const n = catalogue.flakes[id]!.normal; nx += n[0]; ny += n[1]; nz += n[2]; covered++;}
        }
        if(!covered&&normalMode==="covered-average")nz=1;
        const length = Math.hypot(nx, ny, nz), coverage = covered / sampleCount;
        normal[i] = byte(nx / length * .5 + .5); normal[i + 1] = byte(ny / length * .5 + .5); normal[i + 2] = byte(nz / length * .5 + .5); normal[i + 3] = 255;
        surface[i] = byte(coverage);
        surface[i + 1] = byte(FLAKE_MATERIAL.baseRoughness * (1 - coverage) + FLAKE_MATERIAL.flakeRoughness * coverage);
        surface[i + 2] = byte(FLAKE_MATERIAL.baseMetalness * (1 - coverage) + FLAKE_MATERIAL.flakeMetalness * coverage); surface[i + 3] = 255;
        diagnostics.coveredSamples += covered; diagnostics.pixels++; output++;
      }
      return done;
    },
  };
}
function linearColour(hex: string) {
  if (!validHex(hex)) throw Error("Expected six-digit sRGB hex colour");
  return [1,3,5].map(i => {const s = parseInt(hex.slice(i, i + 2), 16) / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;});
}
function srgb(l: number) {return byte(l <= .0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - .055);}
/** Source arrays are immutable caller-owned inputs until completion. Optional alpha
 * accepts one byte per pixel or an RGBA procedural mask; colour never changes it. */
export function createFlakeColourJob(surface: Uint8Array, baseHex: string, flakeHex: string, maskAlpha?: Uint8Array | Uint8ClampedArray) {
  if (!(surface instanceof Uint8Array) || !surface.length || surface.length % 4 || surface.length > FLAKE_LIMITS.maxSize ** 2 * 4) throw Error("Invalid flake coverage surface");
  const count = surface.length / 4;
  if (maskAlpha && (!(maskAlpha instanceof Uint8Array || maskAlpha instanceof Uint8ClampedArray) || (maskAlpha.length !== count && maskAlpha.length !== surface.length))) throw Error("Invalid shape alpha");
  const base = linearColour(baseHex), flake = linearColour(flakeHex), rgba = new Uint8Array(surface.length);
  const alphaStride = maskAlpha?.length === count ? 1 : 4;
  // Coverage has only 256 encoded values; this avoids three powers per texel.
  const lut = new Uint8Array(256 * 3);
  for (let a = 0; a < 256; a++) for (let c = 0; c < 3; c++) lut[a * 3 + c] = srgb(base[c]! * (1 - a / 255) + flake[c]! * a / 255);
  let pixel = 0;
  return {rgba, get done() {return pixel === count;}, advance(workBudget: number) {
    validateWork(workBudget);
    const end = Math.min(count, pixel + workBudget);
    for (; pixel < end; pixel++) {
      const i = pixel * 4, l = surface[i]! * 3;
      rgba[i] = lut[l]!; rgba[i + 1] = lut[l + 1]!; rgba[i + 2] = lut[l + 2]!;
      rgba[i + 3] = maskAlpha ? maskAlpha[pixel * alphaStride + alphaStride - 1]! : 255;
    }
    return pixel === count;
  }};
}
export function composeFlakeColour(surface: Uint8Array, baseHex: string, flakeHex: string, maskAlpha?: Uint8Array | Uint8ClampedArray) {
  const job = createFlakeColourJob(surface, baseHex, flakeHex, maskAlpha); job.advance(Infinity); return job.rgba;
}
