/** Fixed authored fixtures for byte-preserving mask performance comparisons. */
import { initialRecipe, parseRecipe, raster, curve, type Layer } from "../src/engines/layered-makeup/recipe";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const base = initialRecipe().layers[0];
const varied = structuredClone(base);
varied.points.forEach((p,i) => {p.weight=i===0?0:1;p.feather=.001+i*.008;});
varied.strength={mode:"smooth-boundary",blend:.0005};
varied.softness={mode:"boundary",blend:.0000078125};
varied.fields[0].du=.015;varied.fields[0].dv=-.008;
const uniform = structuredClone(varied);uniform.softness={mode:"uniform"};
const broad = structuredClone(varied);broad.points[0].feather=.06;
const fixtures: [string, Layer][] = [["plain",base],["pigment",uniform],["directional",varied],["broad-directional",broad]];
// Optional private reproduction stays outside source control. Only enabled
// layers matter to editing latency; disabled layers deliberately bake as 1px.
const input=process.argv[3];
if(input)fixtures.splice(0,fixtures.length,...parseRecipe(JSON.parse(readFileSync(input,"utf8"))).layers
  .filter(layer=>layer.enabled).map(layer=>[layer.name,layer] as [string,Layer]));
const records=[];
for(const [name,layer] of fixtures) for(const size of input?[1024,2048]:[512,1024]) {
  const start=performance.now();const bytes=raster(layer,size);
  records.push({name,size,segments:curve(layer.points,6).length,ms:performance.now()-start,
    sha256:createHash("sha256").update(bytes).digest("hex"),layer});
}
const output=process.argv[2];
if(output)writeFileSync(output,JSON.stringify({records},null,2)+"\n");
console.log(JSON.stringify(records.map(({layer,...record})=>record),null,2));
