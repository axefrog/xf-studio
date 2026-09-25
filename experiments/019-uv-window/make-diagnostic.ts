// Writes uv-window.collection.json: an asset-free XF Studio collection that puts the old head-UV texel
// density and the new plate-local UV window side by side in one XF selector. Every look appears twice:
// "new" on the plate window (the production layout) and "old" kept on the 1024 head atlas by the
// diagnostic knob `uvSpace: "head"`. Deterministic; rerun after edits.
//
//   bun experiments/019-uv-window/make-diagnostic.ts
//
// UV placement uses the eye plate's glTF UV0 (top-left origin); see experiments/016-finish-board/make-board.ts.
// On the lids one unit of u is about 569 mm and one unit of v about 405 mm (experiment 018).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Rect = [u0: number, v0: number, u1: number, v1: number];
const MM_PER_U = 569, MM_PER_V = 405;
const corner = { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } as const;
const mirror = ([u0, v0, u1, v1]: Rect): Rect => [1 - u1, v0, 1 - u0, v1];
const round = (x: number) => Math.round(x * 1e6) / 1e6;

let serial = 0;
/** A straight-edged patch with the sharpest edge the recipe allows (feather 0.0005: about 0.28 × 0.20 mm). */
function patch(name: string, rect: Rect, color = "#2a1830", extra: Record<string, unknown> = {}) {
  const [u0, v0, u1, v1] = rect.map(round);
  return {
    id: `uvw-${++serial}`, name, enabled: true, color, finish: "matte", opacity: 1, feather: .0005, symmetry: false,
    pathMode: "bezier", points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => ({ u, v, weight: 1, handles: structuredClone(corner) })),
    fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" }, ...extra,
  };
}
const recipe = (layers: unknown[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });

// Left upper lid: four horizontal lines 0.3, 0.6, 1.2 and 2.4 mm tall, each followed by an equal gap
// (line pairs at 1.7, 0.83, 0.42 and 0.21 cycles per mm). Old texels are about 0.40 mm tall there, new about 0.12 mm.
const lines: Rect[] = [];
let v = .2135;
for (const mm of [.3, .6, 1.2, 2.4]) { const h = mm / MM_PER_V; lines.push([.302, v, .442, v + h]); v += 2 * h; }
// Right upper lid: rows of eight, six and four square dots 0.5, 1 and 2 mm wide with equal gaps, from u 0.600
// (22 layers in all; a recipe holds at most 32).
const dots: Rect[] = [];
let row = .2135;
for (const [mm, count] of [[.5, 8], [1, 6], [2, 4]]) {
  const w = mm / MM_PER_U, h = mm / MM_PER_V;
  for (let k = 0; k < count; k++) dots.push([.600 + 2 * k * w, row, .600 + (2 * k + 1) * w, row + h]);
  row += 2 * h;
}
const lineLayers = () => [...lines.map((r, i) => patch(`Line ${[.3, .6, 1.2, 2.4][i]} mm`, r)),
  ...dots.map((r, i) => patch(`Dot ${i + 1}`, r))];

// The finest Shimmer the recipe allows (256 cells, doubled for Shimmer: facets about 0.7 × 0.5 mm) over both lids.
const GAME = { model: "game-matched-1" } as const;
const shimmer = (rect: Rect, name: string) => ({ ...patch(name, rect, "#6d4a7e", { finish: "shimmer", optics: GAME,
  flakes: { cells: 256, density: .7, tilt: 1, seed: 1904 } }), feather: .004 });
const shimmerLayers = () => [shimmer([.300, .211, .444, .248], "Fine shimmer left"), shimmer(mirror([.300, .211, .444, .248]), "Fine shimmer right")];

// Board 1 of the finish board, unchanged, so its flat finishes can be compared at both densities.
const board = JSON.parse(readFileSync(resolve(import.meta.dir, "../016-finish-board/finish-board.collection.json"), "utf8"));
const board1 = board.presets[0].recipe.layers;

const pairs: [string, unknown[]][] = [["Lines", lineLayers()], ["Board 1", board1], ["Fine shimmer", shimmerLayers()]];
const presets: { id: string; name: string; revision: number; recipe: unknown }[] = [], head: Record<string, { uvSpace: "head" }> = {};
pairs.forEach(([name, layers], i) => {
  for (const [j, density] of ["new", "old"].entries()) {
    const id = `019a0b1c-2d3e-4f50-8a6b-0000000000${String(2 * i + j + 1).padStart(2, "0")}`;
    presets.push({ id, name: `${name} · ${density} density`.replace("Fine shimmer · ", "Shimmer · "), revision: 1, recipe: recipe(structuredClone(layers)) });
    if (density === "old") head[id] = { uvSpace: "head" };
  }
});
for (const p of presets) if (p.name.length > 24) throw Error(`Preset name too long: ${p.name}`);

const collection = {
  schema: "xfas/collection-1", id: "019a0b1c-2d3e-4f50-8a6b-0000000000b0", name: "XF UV window (diagnostic)", presets,
  diagnostics: { schema: "xfs/export-diagnostics-1", presets: head },
};
writeFileSync(resolve(import.meta.dir, "uv-window.collection.json"), JSON.stringify(collection, null, 2) + "\n");
console.log(`Wrote ${presets.length} presets: ${presets.map(p => p.name).join(", ")}.`);
