// Writes glitter-board.collection.json: the asset-free diagnostic collection for experiment 018's Glitter board.
// Six presets (plus Off in the XF selector), each a plum Satin pigment on the upper lids, with gold flakes added
// through the diagnostic `glitter` knob (export-diagnostics.ts), which is the only way into the diagnostic Glitter
// route. Deterministic; rerun after edits.
//
//   bun experiments/021-glitter-board/make-board.ts
//
// UV placement uses the eye plate's glTF UV0 (top-left origin), as the finish board does
// (experiments/016-finish-board/make-board.ts): the left upper lid is u 0.300–0.444, v 0.211–0.248, three stripes
// outer to inner, and the right lid mirrors u around 0.5.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Rect = [u0: number, v0: number, u1: number, v1: number];
const PIGMENT = "#6d4a7e", GOLD = "#e8c46a";
const corner = { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } as const;
const mirror = ([u0, v0, u1, v1]: Rect): Rect => [1 - u1, v0, 1 - u0, v1];
const LID: Rect = [.300, .211, .444, .248];
// Abutting stripes overlap by half the feather, so coverage stays 1 across each seam (experiment 016).
const STRIPES: Rect[] = [[.300, .211, .350, .248], [.346, .211, .398, .248], [.394, .211, .444, .248]];

let serial = 0;
/** One Satin pigment patch: a straight-edged Bézier rectangle with the finish board's feather. */
function patch(name: string, rect: Rect) {
  const [u0, v0, u1, v1] = rect;
  return {
    id: `glitter-${++serial}`, name, enabled: true, color: PIGMENT, finish: "regular", opacity: 1, feather: .004, symmetry: false,
    pathMode: "bezier", points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => ({ u, v, weight: 1, handles: structuredClone(corner) })),
    fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" },
  };
}
const recipe = (layers: unknown[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });

/** Experiment 018's base recipe: 0.2 mm, 15 %, tilt 25°/50°, roughness 0.22, metalness 0.85, gold. */
const BASE = { sizeMm: .2, sizeSigma: .35, cover: .15, tiltSigmaDeg: 25, tiltMaxDeg: 50, roughness: .22, metalness: .85, color: GOLD, seed: 2077 };
type Flakes = typeof BASE;
/** The pigment under every glitter region: the calibrated Satin candidate (experiment 017, Gloss D). */
const SURFACE = { roughness: .5, metalness: 0 };
type Region = { layer: string; mips: "nested" | "box"; flakes?: Flakes; mirrorOf?: string };

const presets: { id: string; name: string; revision: number; recipe: unknown }[] = [];
const knobs: Record<string, { glitter: { base: typeof SURFACE; regions: Region[]; accent?: { layer: string; share: number; ev: number } } }> = {};
function preset(key: string, name: string, layers: ReturnType<typeof patch>[], regions: Region[], accent?: { layer: string; share: number; ev: number }) {
  const id = `0210a5e5-2e55-4c02-9d0b-00000000000${"ABCDEF".indexOf(key) + 1}`;
  if (name.length > 24) throw Error(`Preset name too long for the selector: ${name}`);
  presets.push({ id, name, revision: 1, recipe: recipe(layers) });
  knobs[id] = { glitter: { base: SURFACE, regions, ...(accent ? { accent } : {}) } };
}

// A · base: the primary recipe on the left lid; the same pigment without flakes on the right (Satin control).
{ const left = patch("Glitter left", LID), right = patch("Satin control right", mirror(LID));
  preset("A", "Glitter A · base", [left, right], [{ layer: left.id, mips: "nested", flakes: BASE }]); }
// B · mips: the same flakes mirrored on both lids (identical level 0); nested mips left, plain BOX mips right.
{ const left = patch("Nested mips left", LID), right = patch("BOX mips right", mirror(LID));
  preset("B", "Glitter B · mips", [left, right], [{ layer: left.id, mips: "nested", flakes: BASE }, { layer: right.id, mips: "box", mirrorOf: left.id }]); }
// Stripe presets: outer to inner on the left lid with one parameter varied, mirrored on the right (other seeds).
function striped(key: string, name: string, label: (i: number, side: string) => string, left: (i: number) => Partial<Flakes>, right: (i: number) => Partial<Flakes>) {
  const layers = [...STRIPES.map((r, i) => patch(label(i, "left"), r)), ...STRIPES.map((r, i) => patch(label(i, "right"), mirror(r)))];
  // Each stripe gets its own seed, so neighbouring stripes do not repeat one flake pattern at another size.
  preset(key, name, layers, layers.map((l, k) => ({ layer: l.id, mips: "nested" as const,
    flakes: { ...BASE, ...(k < 3 ? left(k) : right(k - 3)), seed: (k < 3 ? 2077 : 4242) + (k % 3) } })));
}
const SIZES = [.12, .25, .5], ROUGH = [.12, .22, .35], METAL = [1, .6, .25], TILT = [[10, 20], [25, 50], [40, 70]];
// C · size: flake width 0.12, 0.25 and 0.5 mm.
striped("C", "Glitter C · size", (i, side) => `${SIZES[i]} mm ${side}`, i => ({ sizeMm: SIZES[i] }), i => ({ sizeMm: SIZES[i] }));
// D · surface: left flake roughness 0.12, 0.22, 0.35 at metalness 0.85; right metalness 1.0, 0.6, 0.25 at roughness 0.22.
striped("D", "Glitter D · surface", (i, side) => side === "left" ? `Roughness ${ROUGH[i]} left` : `Metalness ${METAL[i]} right`,
  i => ({ roughness: ROUGH[i] }), i => ({ metalness: METAL[i] }));
// E · accent: the base recipe on both lids (mirrored flakes); 8 % of the left lid's flakes also drive the emissive accent chunk.
// ACCENT_EV is the accent's EmissiveEV. mesh_decal_emissive_subsurface writes EmissiveEV × EmissiveColor as a plain product
// (research/materials/shader-decal.md §5.4), so 0 is black; 1 writes the flake colour itself, the brightest value that keeps
// every channel within the colour's own 0–1 range (no over-range emission for bloom to catch).
const ACCENT_EV = 1;
{ const left = patch("Glitter + accent left", LID), right = patch("Glitter right", mirror(LID));
  preset("E", "Glitter E · accent", [left, right], [{ layer: left.id, mips: "nested", flakes: BASE }, { layer: right.id, mips: "nested", mirrorOf: left.id }],
    { layer: left.id, share: .08, ev: ACCENT_EV }); }
// F · tilt: tilt σ/max 10°/20°, 25°/50° and 40°/70°.
striped("F", "Glitter F · tilt", (i, side) => `Tilt ${TILT[i][0]}/${TILT[i][1]} ${side}`,
  i => ({ tiltSigmaDeg: TILT[i][0], tiltMaxDeg: TILT[i][1] }), i => ({ tiltSigmaDeg: TILT[i][0], tiltMaxDeg: TILT[i][1] }));

const collection = {
  schema: "xfas/collection-1", id: "0210a5e5-2e55-4c02-9d0b-0000000000b0", name: "XF glitter board (diagnostic)", presets,
  diagnostics: { schema: "xfs/export-diagnostics-1", presets: knobs },
};
writeFileSync(resolve(import.meta.dir, "glitter-board.collection.json"), JSON.stringify(collection, null, 2) + "\n");
console.log(`Wrote ${presets.length} presets: ${presets.map(p => p.name).join(", ")}.`);
