// Writes depth-candidate.collection.json: the asset-free diagnostic collection for the next in-game
// session (plate depth, finish gloss, stronger shimmer). Deterministic; rerun after edits.
//
//   bun experiments/017-plate-depth/make-candidate.ts
//
// It uses the finish board's patch layout (experiments/016-finish-board/make-board.ts) and adds the
// diagnostic-only `diagnostics` knobs (projects/xf-studio/authoring/src/export-diagnostics.ts):
// a per-preset plate lift, and flat-material surface overrides. Presets without a knob use the
// production lift (0.4 mm) and the production finish values.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Finish = "matte" | "regular" | "metallic" | "glossy" | "shimmer";
type Rect = [u0: number, v0: number, u1: number, v1: number];
const GAME = { model: "game-matched-1" } as const;
const PIGMENT = "#6d4a7e"; // the finish board's plum, so results compare with the first session
const corner = { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } as const;
const mirror = ([u0, v0, u1, v1]: Rect): Rect => [1 - u1, v0, 1 - u0, v1];

let serial = 0;
function layer(name: string, finish: Finish, rect: Rect, extra: Record<string, unknown> = {}, weights?: [number, number]) {
  const [u0, v0, u1, v1] = rect, [left, right] = weights ?? [1, 1], mid = (left + right) / 2, um = (u0 + u1) / 2;
  const points = weights
    ? [[u0, v0, left], [um, v0, mid], [u1, v0, right], [u1, v1, right], [um, v1, mid], [u0, v1, left]]
    : [[u0, v0, 1], [u1, v0, 1], [u1, v1, 1], [u0, v1, 1]];
  return {
    id: `depth-${++serial}`, name, enabled: true, color: PIGMENT, finish, opacity: 1, feather: .004, symmetry: false,
    pathMode: "bezier", points: points.map(([u, v, weight]) => ({ u, v, weight, handles: structuredClone(corner) })),
    fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" },
    ...(finish === "glossy" || finish === "shimmer" ? { optics: GAME } : {}),
    ...extra,
  };
}
const recipe = (layers: unknown[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });

// Finish board geometry: three abutting stripes per upper lid; the whole lid; an under-eye band.
const lid: Rect[] = [[.300, .212, .350, .248], [.346, .212, .398, .248], [.394, .212, .444, .248]];
const wholeLid: Rect = [.300, .211, .444, .248];
const underEye: Rect = [.330, .266, .444, .286];
const fine = { flakes: { cells: 128, density: .65, tilt: .65, seed: 2077 } }; // Board 2's fine Shimmer
// Stronger Shimmer: half the cells (facets twice as wide, so they survive two more mip levels at face
// distance) and full tilt (0.4 rad, about 23°, so nearly every facet passes the ~11.5° mode-1 gate).
const strong = { flakes: { cells: 64, density: .8, tilt: 1, seed: 2078 } };

/** The first session's close-up look: a Satin lid and a Matte under-eye band on both eyes. */
const depthLook = () => [
  { ...layer("Satin lid", "regular", wholeLid), symmetry: true },
  { ...layer("Matte under-eye", "matte", underEye), symmetry: true },
];
/** Board 1's stripes: Matte · Satin · Glossy on the left lid, Metallic · Glossy · Matte on the right. */
const board1 = () => [
  layer("Matte", "matte", lid[0]), layer("Satin", "regular", lid[1]), layer("Glossy (single lobe)", "glossy", lid[2]),
  layer("Metallic", "metallic", mirror(lid[0])), layer("Glossy right", "glossy", mirror(lid[1])), layer("Matte right", "matte", mirror(lid[2])),
];

const id = (n: number) => `0170d3e0-1f01-4a51-9c3e-${String(n).padStart(12, "0")}`;
type Preset = { n: number; name: string; layers: unknown[]; diagnostics?: Record<string, unknown> };
const presets: Preset[] = [
  // Question 1: how far off the skin the plate must sit. Same look, four lifts (0 = the first session's plate).
  { n: 1, name: "Depth A · 0 mm control", layers: depthLook(), diagnostics: { plateLiftMm: 0 } },
  { n: 2, name: "Depth B · +0.1 mm", layers: depthLook(), diagnostics: { plateLiftMm: .1 } },
  { n: 3, name: "Depth C · +0.2 mm", layers: depthLook(), diagnostics: { plateLiftMm: .2 } },
  { n: 4, name: "Depth D · +0.4 mm", layers: depthLook() }, // the production default (vanilla decal offset)
  // Question 2: Board 1 again, lifted, with surface alternatives that separate the possible causes.
  { n: 5, name: "Gloss A · as before", layers: board1() },
  { n: 6, name: "Gloss B · skin rough", layers: board1(), diagnostics: { surface: { RoughnessMetalnessAlpha: 0 } } },
  { n: 7, name: "Gloss C · all rough", layers: board1(),
    diagnostics: { surface: { RoughnessScale: 0, RoughnessBias: 1, MetalnessScale: 0, MetalnessBias: 0 } } },
  { n: 8, name: "Gloss D · rough +0.12", layers: board1(), diagnostics: { surface: { RoughnessBias: .12 } } },
  // Question 3: one stronger Shimmer beside Board 2's fine Shimmer and a Satin control.
  { n: 9, name: "Shimmer · strong", layers: [
    layer("Satin control", "regular", lid[0]), layer("Shimmer fine (Board 2)", "shimmer", lid[1], fine), layer("Shimmer strong", "shimmer", lid[2], strong),
    layer("Shimmer strong right", "shimmer", mirror(lid[0]), strong), layer("Shimmer fine right", "shimmer", mirror(lid[1]), fine),
    layer("Satin control right", "regular", mirror(lid[2])),
  ] },
  // Board 6 again, lifted: were its angular highlight shapes the depth breakup, and is there a seam near 0.1?
  { n: 10, name: "Metal ramp · lifted", layers: [
    layer("Satin base left", "regular", wholeLid),
    layer("Metal ramp 0 to 0.3", "metallic", wholeLid, { opacity: .462 }, [0, 1]),
    layer("Satin base right", "regular", mirror(wholeLid)),
    ...[.05, .1, .15, .2, .3].map((metal, i) => layer(`Metal ${metal}`, "metallic",
      mirror([.302 + i * .0286, .215, .302 + i * .0286 + .024, .244]), { opacity: Math.round(metal / .65 * 1000) / 1000 })),
  ] },
];
for (const preset of presets) if (preset.name.length > 24) throw Error(`Preset name too long for the selector: ${preset.name}`);

const collection = {
  schema: "xfas/collection-1", id: "0170d3e0-1f01-4a51-9c3e-0000000000c0", name: "XF plate depth candidate (diagnostic)",
  presets: presets.map(p => ({ id: id(p.n), name: p.name, revision: 1, recipe: recipe(p.layers) })),
  diagnostics: { schema: "xfs/export-diagnostics-1",
    presets: Object.fromEntries(presets.filter(p => p.diagnostics).map(p => [id(p.n), p.diagnostics])) },
};
writeFileSync(resolve(import.meta.dir, "depth-candidate.collection.json"), JSON.stringify(collection, null, 2) + "\n");
console.log(`Wrote ${presets.length} presets.`);
