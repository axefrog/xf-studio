// Builds a world pack from the places research's derived game data (research/consumers/quest-corpus/json/_derived-d:
// loc_areas.json, districts.json, descriptors.json; see its scripts/places_index.py). Game-derived and private:
// the output goes to an ignored folder, never into the repository.
//   bun tools/build-world-pack.ts --derived <folder> --out <repo>/local/holotable/world-pack.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Area, Cell, WorldPack } from "../src/model.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const derived = args.get("derived"), out = args.get("out");
if (!derived || !out) { console.error("Usage: bun tools/build-world-pack.ts --derived <folder> --out <file>"); process.exit(2); }

type Json = Record<string, any>;
const read = (name: string) => JSON.parse(readFileSync(join(derived, name), "utf8"));
const districts = new Map<string, Json>((read("districts.json") as Json[]).map(d => [d.id, d]));
const areas: Area[] = [];
for (const a of read("loc_areas.json") as Json[]) {
  if (!a.enabled || !a.poly?.length || a.district === "Districts.0") continue;
  const rec = districts.get(a.district);
  areas.push({
    id: a.district, name: rec?.name ?? String(a.district).replace(/^Districts\./, ""),
    kind: a.type === "worldLocationAreaNode" ? "district" : "venue", parent: rec?.parent,
    poly: a.poly.map((p: number[]) => [p[0], p[1]] as [number, number]), zlo: a.zlo, zhi: a.zhi,
  });
}
const cells: Cell[] = [];
for (const d of read("descriptors.json") as Json[]) {
  // Near-detail cells only: exterior level 0 and interiors. Coarser levels add boxes kilometres wide.
  if (!(d.cat === "Exterior" && d.level === 0) && d.cat !== "Interior") continue;
  const b = d.box as number[];
  cells.push({ level: d.level, category: d.cat, min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] });
}
const pack: WorldPack = {
  schema: "xfh/world-pack-1",
  provenance: { game: "2.31", source: "places research derived data (loc_areas, districts, descriptors)", built: new Date().toISOString() },
  areas, cells,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(pack));
console.log(`${areas.length} areas, ${cells.length} cells -> ${out}`);
