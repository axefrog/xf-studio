// Writes glitter-board.collection.json: the asset-free diagnostic collection for the Glitter board, now board 2
// (glitter flakes 2, experiment 032). Six presets (plus Off in the XF selector), each a Satin pigment on both upper lids,
// with flakes added through the diagnostic `glitter` knob (export-diagnostics.ts), which is the only way into the diagnostic
// Glitter route. The flakes reproduce the Studio's glint models (glitter-studio-flakes.ts). Deterministic; rerun after edits.
//
//   bun experiments/021-glitter-board/make-board.ts
//
// UV placement uses the eye plate's glTF UV0 (top-left origin), as the finish board does
// (experiments/016-finish-board/make-board.ts): the left upper lid is u 0.300–0.444, v 0.211–0.248, and the right lid
// mirrors u around 0.5. Board 1 (session 6, 29 September) is in git history; its Glitter A recipe survives as the left lid of B.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultClusteredGlintFlakes, defaultDirectGlintFlakes } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/direct-glint-settings";
import { studioGlitterFlakes } from "../../projects/xf-studio/authoring/src/glitter-studio-flakes";

type Rect = [u0: number, v0: number, u1: number, v1: number];
const PLUM = "#6d4a7e", GOLD = "#e8c46a", WINE = "#620422";
const corner = { mode: "corner", in: { u: 0, v: 0 }, out: { u: 0, v: 0 } } as const;
const mirror = ([u0, v0, u1, v1]: Rect): Rect => [1 - u1, v0, 1 - u0, v1];
const LID: Rect = [.300, .211, .444, .248];

let serial = 0;
/** One Satin pigment patch: a straight-edged Bézier rectangle with the finish board's feather. */
function patch(name: string, rect: Rect, color = PLUM) {
  const [u0, v0, u1, v1] = rect;
  return {
    id: `glitter-${++serial}`, name, enabled: true, color, finish: "regular", opacity: 1, feather: .004, symmetry: false,
    pathMode: "bezier", points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => ({ u, v, weight: 1, handles: structuredClone(corner) })),
    fields: [], strength: { mode: "smooth-boundary", blend: .0005 }, softness: { mode: "uniform" },
  };
}
const recipe = (layers: unknown[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });

/** The maintainer's reference glitter layer ("Glitterati", read from the library read-only): Dense fine speckles at full strength. */
const GLITTERATI = { model: "uv-cell-direct-3", density: .88, fineShare: .88, strength: 16, seed: 2077, color: "#fa006c" } as const;
const reference = studioGlitterFlakes(GLITTERATI);
/** Board 1's Glitter A recipe (experiment 018's base): 0.2 mm, 15 %, tilt |N(0, 25°)| to 50°, roughness 0.22, metalness 0.85, gold. */
const BOARD_1 = { sizeMm: .2, sizeSigma: .35, cover: .15, tiltSigmaDeg: 25, tiltMaxDeg: 50, roughness: .22, metalness: .85, color: GOLD, seed: 2077 };
/** Every preset's pigment surface under the flakes: the Studio's glint base (roughness 0.55, metalness 0). */
const SURFACE = reference.base;
type Flakes = Record<string, number | string>;
type Region = { layer: string; mips: "nested" | "box"; flakes?: Flakes; mirrorOf?: string };

const presets: { id: string; name: string; revision: number; recipe: unknown }[] = [];
const knobs: Record<string, { glitter: { base: typeof SURFACE; regions: Region[]; accent?: { layer: string; share: number; ev: number } } }> = {};
function preset(key: string, name: string, layers: ReturnType<typeof patch>[], regions: Region[], accent?: { layer: string; share: number; ev: number }) {
  const id = `0210a5e5-2e55-4c02-9d0b-00000000000${"ABCDEF".indexOf(key) + 1}`;
  if (name.length > 24) throw Error(`Preset name too long for the selector: ${name}`);
  presets.push({ id, name, revision: 1, recipe: recipe(layers) });
  knobs[id] = { glitter: { base: SURFACE, regions, ...(accent ? { accent } : {}) } };
}
/** Both lids in one colour, the right lid's flakes the left lid's mirrored. */
function bothLids(key: string, name: string, color: string, flakes: Flakes, mips: "nested" | "box" = "nested") {
  const left = patch(`${name} left`, LID, color), right = patch(`${name} right`, mirror(LID), color);
  preset(key, name, [left, right], [{ layer: left.id, mips: "nested", flakes }, { layer: right.id, mips, mirrorOf: left.id }]);
}

// A · the reference model: the maintainer's preset's glitter model (pink over wine), on both lids.
bothLids("A", "Glitter A · reference", WINE, reference.flakes);
// B · board 1 against board 2 at the same size, cover and colours: board 1's recipe on the left lid (what session 6 judged); on
// the right the same flake sizes and cover with glitter flakes 2's tilts (14° floor, |N(0, 16°)| to 65°), per-flake surfaces and
// clustering, so the pair isolates the normals and surfaces. The one other difference: the base is 0.55, not 0.5.
const SECOND = studioGlitterFlakes({ ...GLITTERATI, color: GOLD }).flakes;
{ const left = patch("Board 1 left", LID), right = patch("Board 2 normals right", mirror(LID));
  preset("B", "Glitter B · 1 vs 2", [left, right], [{ layer: left.id, mips: "nested", flakes: BOARD_1 },
    { layer: right.id, mips: "nested", flakes: { ...BOARD_1, seed: 4242, tiltMinDeg: SECOND.tiltMinDeg!, tiltSigmaDeg: SECOND.tiltSigmaDeg, tiltMaxDeg: SECOND.tiltMaxDeg,
      roughness: SECOND.roughness, roughnessMax: SECOND.roughnessMax!, metalness: SECOND.metalness, metalnessMin: SECOND.metalnessMin!,
      clusterMm: SECOND.clusterMm!, clusterFloor: SECOND.clusterFloor! } }]); }
// C · the Studio's Direct-light glints at their defaults (champagne flakes over plum), on both lids.
bothLids("C", "Glitter C · direct", PLUM, studioGlitterFlakes(defaultDirectGlintFlakes()).flakes);
// D · the Studio's Clustered fine glints at their defaults, on both lids.
bothLids("D", "Glitter D · clustered", PLUM, studioGlitterFlakes(defaultClusteredGlintFlakes()).flakes);
// E · mips: the reference flakes mirrored on both lids (identical level 0); nested mips left, plain BOX mips right.
bothLids("E", "Glitter E · mips", WINE, reference.flakes, "box");
// F · accent: the reference flakes on both lids; 8 % of the left lid's flakes also drive the emissive accent chunk.
// ACCENT_EV is the accent's EmissiveEV. mesh_decal_emissive_subsurface writes EmissiveEV × EmissiveColor as a plain product
// (research/materials/shader-decal.md §5.4), so 0 is black; 1 writes the flake colour itself, the brightest value that keeps
// every channel within the colour's own 0–1 range (no over-range emission for bloom to catch).
const ACCENT_EV = 1;
{ const left = patch("Accent left", LID, WINE), right = patch("No accent right", mirror(LID), WINE);
  preset("F", "Glitter F · accent", [left, right], [{ layer: left.id, mips: "nested", flakes: reference.flakes }, { layer: right.id, mips: "nested", mirrorOf: left.id }],
    { layer: left.id, share: .08, ev: ACCENT_EV }); }

const collection = {
  schema: "xfas/collection-1", id: "0210a5e5-2e55-4c02-9d0b-0000000000b0", name: "XF glitter board 2 (diagnostic)", presets,
  diagnostics: { schema: "xfs/export-diagnostics-1", presets: knobs },
};
writeFileSync(resolve(import.meta.dir, "glitter-board.collection.json"), JSON.stringify(collection, null, 2) + "\n");
console.log(`Wrote ${presets.length} presets: ${presets.map(p => p.name).join(", ")}.`);
