/** Reproducible offline production-mask / compiler validation.
 * Run from authoring: bun tools/validate-pigment.ts
 * All generated files are ignored under data/pigment-validation/. Pillow is
 * needed only for the labelled comparison PNG; numerical checks are Bun-only.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { initialRecipe, raster, curve, type Layer, type Recipe } from "../src/engines/layered-makeup/recipe";
import { compileFlatPreset } from "../src/engines/layered-makeup/preset-compiler";

const directory = resolve(import.meta.dir, "../data/pigment-validation");
await mkdir(directory, { recursive: true });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const alpha = (rgba: Uint8ClampedArray) => Uint8Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3]);
const legacy = (layer: Layer): Layer => ({ ...structuredClone(layer), strength: { mode: "legacy-nearest" } });
const petal = initialRecipe().layers[0];
// Preserve the version-4 comparison fixture independently of new curve defaults.
petal.pathMode = "catmull-rom";
petal.points = petal.points.map(({ handles: _handles, ...point }) => point);
petal.points.forEach((p, i) => p.weight = [0, .15, .4, .8, 1, .4][i]);
const thin: Layer = {
  ...structuredClone(petal), fields: [], symmetry: false, opacity: 1,
  points: [[.3,.3,0],[.7,.3,0],[.7,.304,1],[.3,.304,1]].map(([u,v,weight])=>({u,v,weight})),
  feather: .001,
};
const warped = structuredClone(petal);
warped.fields[0].du = .035; warped.fields[0].dv = .016;
warped.fields.push({ ...warped.fields[0], id: "counter", u: .43, du: -.018, radius: .03 });
const fixtures: Record<string, { layer: Layer; crop: number[] }> = {
  petal: { layer: petal, crop: [.27,.18,.50,.29] },
  thin: { layer: thin, crop: [.24,.287,.76,.317] },
  warped: { layer: warped, crop: [.27,.18,.50,.29] },
};
const statistics = (a: Uint8Array, b: Uint8Array) => {
  let changed=0, max=0, sum=0, active=0;
  const histogram = new Uint32Array(256);
  for(let i=0;i<a.length;i++) {
    if(a[i] || b[i]) {
      active++; const delta=Math.abs(a[i]-b[i]);
      if(delta) changed++; max=Math.max(max,delta); sum+=delta; histogram[delta]++;
    }
  }
  let count=0, p95=0;
  for(let i=0;i<256;i++) {count+=histogram[i];if(count>=active*.95){p95=i;break;}}
  return { pixels:a.length, activePixels:active, changedPixels:changed, maxByteDifference:max,
    meanActiveByteDifference: active ? sum/active : 0, p95ActiveByteDifference:p95 };
};
const downsample = (hi: Uint8Array, size: number) => {
  const lo=new Uint8Array(size*size), width=size*2;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const i=2*y*width+2*x;
    lo[y*size+x]=Math.round((hi[i]+hi[i+1]+hi[i+width]+hi[i+width+1])/4);
  }
  return lo;
};
const results:any={
  createdAt:new Date().toISOString(), runtime:Bun.version,
  sources:Object.fromEntries(await Promise.all(["recipe.ts","pigment-strength.ts","preset-compiler.ts"].map(async name=>
    [name,hash(new Uint8Array(await Bun.file(resolve(import.meta.dir,"../src/engines/layered-makeup",name)).arrayBuffer()))]))),
  notes:[
    "Production raster, not a research substitute. Legacy and smooth share geometry, opacity, feather and warp.",
    "Smooth footprint is .0005 control UV. At 1024 it spans .512 texels; it is mathematically continuous but not supersampled.",
    "Downsample differences compare texel-centre 1024 with four averaged 2048 samples; they are not an antialiasing error bound.",
    "Compiler alpha comparison uses quantized raster coverage, then round(255*sqrt(alpha/255)); not unquantized analytic coverage.",
    "Game filtering, mipmaps, compression, optical rendering and final visual approval remain outside this check.",
  ], fixtures:{}, benchmark:{},
};
for(const [name,{layer,crop}] of Object.entries(fixtures)) {
  const masks = new Map<string,Uint8Array>();
  const item:any={ recipe:{...initialRecipe(),layers:[layer]},crop, files:{}, comparisons:{}, compiler:[] };
  for(const size of [1024,2048]) {
    for(const mode of ["legacy","smooth"]) {
      const mask=alpha(raster(mode==="legacy"?legacy(layer):layer,size));
      masks.set(`${mode}-${size}`,mask);
      const file=`${name}-${mode}-${size}.alpha`;
      await Bun.write(resolve(directory,file),mask);
      item.files[`${mode}-${size}`]={path:file,sha256:hash(mask),width:size,height:size,format:"uint8 alpha row-major"};
    }
    item.comparisons[size]=statistics(masks.get(`legacy-${size}`)!,masks.get(`smooth-${size}`)!);
  }
  item.resolutionComparison=Object.fromEntries(["legacy","smooth"].map(mode=>[
    mode,statistics(masks.get(`${mode}-1024`)!,downsample(masks.get(`${mode}-2048`)!,1024)),
  ]));
  for(const size of [128,256]) for(const mode of ["legacy","smooth"]) {
    const selected=mode==="legacy"?legacy(layer):layer;
    const recipe:Recipe={...initialRecipe(),layers:[selected]},mask=alpha(raster(selected,size));
    const compiled=compileFlatPreset(recipe,size);
    let mismatch=0,covered=0;
    for(let i=0;i<mask.length;i++) {
      if(mask[i]) covered++;
      if(compiled.diffuse[i*4+3]!==Math.round(255*Math.sqrt(mask[i]/255))) mismatch++;
    }
    item.compiler.push({size,mode,pixels:mask.length,covered,mismatches:mismatch,reportedCovered:compiled.metadata.coveredTexels});
    if(mismatch || covered!==compiled.metadata.coveredTexels) throw Error(`Compiler mismatch ${name}/${mode}/${size}`);
  }
  results.fixtures[name]=item;
}

// This increases control count from 6 to 24 by sampling the same initial curve.
// Retessellating the sampled knots is only an approximate shape match; timings
// are illustrative workloads, never a comparison claiming identical geometry.
const dense={...structuredClone(petal),points:curve(petal.points,4)};
for(const [name,layer] of [["six-knots",petal],["24-knots",dense]] as const) {
  results.benchmark[name]={knots:layer.points.length,polygonEdges:curve(layer.points).length};
  for(const size of [1024,2048]) {
    raster(layer,size);
    const durations=[];
    for(let i=0;i<3;i++) {const start=performance.now();raster(layer,size);durations.push(performance.now()-start);}
    results.benchmark[name][size]={warmRunsMs:durations,medianMs:[...durations].sort((a,b)=>a-b)[1]};
  }
}
await Bun.write(resolve(directory,"results.json"),JSON.stringify(results,null,2)+"\n");

// Generated procedural data only: this creates a new diagnostic plot, not an
// edit of supplied reference photos. Keep the same colour scale across panels.
const plot = String.raw`
import json,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(sys.argv[1]); data=json.loads((root/'results.json').read_text())
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',19)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
w,h=1200,940; out=Image.new('RGB',(w,h),'#151b20'); draw=ImageDraw.Draw(out)
draw.text((24,18),'Pigment strength: same path, different gradient evaluator',font=font,fill='white')
draw.text((24,48),'2048 masks | left: legacy nearest edge | right: continuous boundary blend (.0005 UV)',font=small,fill='#c8d3db')
for row,(name,fixture) in enumerate(data['fixtures'].items()):
    top=90+row*245
    draw.text((24,top),name.capitalize(),font=font,fill='white')
    for col,mode in enumerate(['legacy','smooth']):
        info=fixture['files'][mode+'-2048']; size=info['width']
        mask=Image.frombytes('L',(size,size),(root/info['path']).read_bytes())
        crop=tuple(round(v*size) for v in fixture['crop'])
        mask=mask.crop(crop); mask.thumbnail((560,195),Image.Resampling.NEAREST)
        heat=Image.merge('RGB',(mask,mask.point(lambda x:round(x*.54)),mask.point(lambda x:round(x*.23))))
        out.paste(heat,(24+col*588,top+33))
        if name=='thin':
            full=Image.frombytes('L',(size,size),(root/info['path']).read_bytes())
            detail=full.crop(tuple(round(v*size) for v in [.495,.298,.505,.306]))
            detail=detail.resize((150,120),Image.Resampling.NEAREST)
            heat=Image.merge('RGB',(detail,detail.point(lambda x:round(x*.54)),detail.point(lambda x:round(x*.23))))
            out.paste(heat,(24+col*588,top+91))
            draw.text((186+col*588,top+130),'Centre detail',font=small,fill='#c8d3db')
            draw.text((186+col*588,top+153),'nearest-pixel enlargement',font=small,fill='#c8d3db')
draw.text((24,836),'Black = no coverage; bright orange = opaque. Panels share one alpha scale.',font=small,fill='#c8d3db')
draw.text((24,861),'Thin shape deliberately exaggerates opposite strengths. Zoomed texels are not antialiased.',font=small,fill='#c8d3db')
draw.text((24,886),'These are generated masks, not browser lighting or game-render equivalence evidence.',font=small,fill='#c8d3db')
out.save(root/'comparison.png')
`;
const plotting=Bun.spawn(["python","-c",plot,directory],{stdout:"pipe",stderr:"pipe"});
const plotStatus=await plotting.exited;
if(plotStatus) throw Error(`Numerical checks passed; plot failed: ${await new Response(plotting.stderr).text()}`);
console.log(JSON.stringify({directory,compilerMismatches:0,benchmark:results.benchmark,
  comparisons:Object.fromEntries(Object.entries(results.fixtures).map(([name,item]:[string,any])=>[
    name,{masks:item.comparisons,resolution:item.resolutionComparison}]))},null,2));
