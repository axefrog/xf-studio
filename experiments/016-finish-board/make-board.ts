// Writes finish-board.collection.json: an asset-free XF Studio collection whose presets are
// side-by-side diagnostic patches for the next in-game session. Deterministic; rerun after edits.
//
//   bun experiments/016-finish-board/make-board.ts
//
// UV placement uses the eye plate's glTF UV0 (top-left origin). The left eye's upper lid spans
// roughly u 0.30–0.45, v 0.21–0.25 (lash line near v 0.255); the under-eye band roughly v 0.265–0.29. The right eye mirrors
// u around 0.5. Patches are Bézier rectangles with zero-length (corner) handles, so edges are straight.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Finish = "matte" | "regular" | "metallic" | "glossy" | "shimmer" | "iridescent";
type Rect = [u0: number, v0: number, u1: number, v1: number];
const GAME = { model: "game-matched-1" } as const;
const PIGMENT = "#6d4a7e"; // one mid plum for every finish patch, so only the finish differs
const corner = { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } as const;
const mirror = ([u0, v0, u1, v1]: Rect): Rect => [1 - u1, v0, 1 - u0, v1];

let serial = 0;
function layer(name: string, finish: Finish, rect: Rect, extra: Record<string, unknown> = {}, weights?: [number, number]) {
  const [u0, v0, u1, v1] = rect, [left, right] = weights ?? [1, 1], mid = (left + right) / 2, um = (u0 + u1) / 2;
  const points = weights
    ? [[u0, v0, left], [um, v0, mid], [u1, v0, right], [u1, v1, right], [um, v1, mid], [u0, v1, left]]
    : [[u0, v0, 1], [u1, v0, 1], [u1, v1, 1], [u0, v1, 1]];
  return {
    id: `board-${++serial}`, name, enabled: true, color: PIGMENT, finish, opacity: 1, feather: .004, symmetry: false,
    pathMode: "bezier", points: points.map(([u, v, weight]) => ({ u, v, weight, handles: structuredClone(corner) })),
    fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" },
    ...(finish === "glossy" || finish === "shimmer" ? { optics: GAME } : {}),
    ...extra,
  };
}
const recipe = (layers: unknown[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });

// Three stripes across the left upper lid, and their mirrors on the right lid.
// Abutting stripes that overlap by half the feather, so coverage stays 1 across each seam (sharp gaps
// between patches compress badly in the small mips and would read as texture damage).
const lid: Rect[] = [[.300, .212, .350, .248], [.346, .212, .398, .248], [.394, .212, .444, .248]];
const under: Rect[] = [[.330, .268, .364, .288], [.370, .270, .404, .290], [.410, .268, .444, .288]];
const fine = { flakes: { cells: 128, density: .65, tilt: .65, seed: 2077 } };
const coarse = { flakes: { cells: 32, density: .8, tilt: 1, seed: 4242 } };

const presets = [
  { id: "7a6d3c10-1f01-4a51-9c3e-000000000001", name: "Board 1 · flat finishes", layers: [
    layer("Matte", "matte", lid[0]), layer("Satin", "regular", lid[1]), layer("Glossy (single lobe)", "glossy", lid[2]),
    layer("Metallic", "metallic", mirror(lid[0])), layer("Glossy (single lobe) right", "glossy", mirror(lid[1])), layer("Matte right", "matte", mirror(lid[2])),
  ] },
  { id: "7a6d3c10-1f01-4a51-9c3e-000000000002", name: "Board 2 · shimmer", layers: [
    layer("Satin control", "regular", lid[0]), layer("Shimmer fine", "shimmer", lid[1], fine), layer("Shimmer coarse (glitter proxy)", "shimmer", lid[2], coarse),
    layer("Glossy control", "glossy", mirror(lid[0])), layer("Shimmer fine right", "shimmer", mirror(lid[1]), fine), layer("Matte control", "matte", mirror(lid[2])),
  ] },
  ...[[.8, "Board 3 · colour shift"], [0, "Board 4 · shift control"]].map(([strength, name], i) => ({
    id: `7a6d3c10-1f01-4a51-9c3e-00000000000${3 + i}`, name: name as string, layers: [
      { ...layer("Duochrome lid", "iridescent", [.300, .211, .444, .248], {
        color: "#3a2350", optics: { ...GAME, shift: { color: "#3fd4c2", strength } } }), symmetry: true },
    ] })),
  { id: "7a6d3c10-1f01-4a51-9c3e-000000000005", name: "Board 5 · blend steps", layers:
    [.25, .5, .75].map((opacity, i) => ({ ...layer(`Black ${opacity * 100}%`, "matte", under[i], { color: "#000000", opacity }), symmetry: true })) },
  { id: "7a6d3c10-1f01-4a51-9c3e-000000000006", name: "Board 6 · metal ramp", layers: [
    layer("Satin base left", "regular", [.300, .211, .444, .248]),
    // Metallic (0.65) at 46.2 % over full Satin coverage: metalness = 0.65 × 0.462 × weight, 0 → 0.3 across u.
    layer("Metal ramp 0 to 0.3", "metallic", [.300, .211, .444, .248], { opacity: .462 }, [0, 1]),
    layer("Satin base right", "regular", mirror([.300, .211, .444, .248])),
    // Five steps: metalness 0.05, 0.1, 0.15, 0.2, 0.3 (opacity = metalness / 0.65).
    ...[.05, .1, .15, .2, .3].map((metal, i) => layer(`Metal ${metal}`, "metallic",
      mirror([.302 + i * .0286, .215, .302 + i * .0286 + .024, .244]), { opacity: Math.round(metal / .65 * 1000) / 1000 })),
  ] },
];

const collection = {
  schema: "xfas/collection-1", id: "7a6d3c10-1f01-4a51-9c3e-0000000000b0", name: "XF finish board (diagnostic)",
  presets: presets.map(p => ({ id: p.id, name: p.name, revision: 1, recipe: recipe(p.layers) })),
};
writeFileSync(resolve(import.meta.dir, "finish-board.collection.json"), JSON.stringify(collection, null, 2) + "\n");
console.log(`Wrote ${presets.length} presets.`);
