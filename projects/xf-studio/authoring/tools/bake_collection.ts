// Local build input adapter. Packaging and game installation are separate operations.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { compileFlatPreset } from "../src/preset-compiler";
import { planCollection } from "../src/preset-collection";
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw Error("Usage: bun tools/bake_collection.ts collection.json output-directory");
const plan=planCollection(await Bun.file(source).json()),out=resolve(destination);
mkdirSync(out,{recursive:true});
const records=[];
for(const p of plan.presets) {
  const compiled=compileFlatPreset(p.recipe,1024);
  const maps=[];
  for(const channel of ["diffuse","roughness","metalness"] as const) {
    const data=compiled[channel],file=`${p.appearance}_${channel}.raw`;
    writeFileSync(resolve(out,file),data);
    maps.push({channel,file,bytes:data.byteLength,sha256:createHash("sha256").update(data).digest("hex")});
  }
  records.push({id:p.id,revision:p.revision,size:compiled.size,maps,metadata:compiled.metadata,
    recipeSha256:createHash("sha256").update(JSON.stringify(p.recipe)).digest("hex")});
}
writeFileSync(resolve(out,"plan.json"),JSON.stringify(plan,null,2)+"\n");
writeFileSync(resolve(out,"compiled.json"),JSON.stringify(records,null,2)+"\n");
console.log(`Compiled ${records.length} authored presets; ${records.length*3} map inputs. No installation.`);
