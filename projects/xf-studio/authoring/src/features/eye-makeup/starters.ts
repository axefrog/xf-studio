/**
 * Eye makeup's contributed starter shapes (profiles design §6; AGENTS.md "Defaults are contributed baselines"): the contours a new
 * layer or a new look starts from, as read-only data. Each sits on the real eye of the head UV, placed from the plate's own geometry
 * (`EYE_LANDMARKS`), is symmetric (drawn on the u < ½ eye and mirrored across the face's centre line) and keeps inside the plate
 * with room for its feather.
 *
 * Where the numbers come from (knowledge/face-makeup.md, "The eye opening is a thin slit in head UV0" and "Landmarks of the eye in
 * UV"): measured on the prepared female and male default plates (`tools/eye-landmarks.ts`); the head UV is shared, so both give the
 * same slit, and the crease agrees between them to within 0.003 v.
 */
import { convertToBezier } from "../../engines/layered-makeup/bezier-path";
import { DEFAULT_STRENGTH_BLEND, MAX_FEATHER, MIN_FEATHER, type Point } from "../../engines/layered-makeup/recipe";
import { shapeOfLayer, type ContributedStarter, type StarterShape } from "../../engines/layered-makeup/starter-shape";
import type { UvWindow } from "../../engines/layered-makeup/plate-uv-window";

type UV = readonly [u: number, v: number];
/**
 * The eye on the u < ½ side of the head UV (the other is its mirror across u = ½), in glTF UV0 (top left, v down).
 *
 * - **The lash line.** The plate's eye opening is a slit whose upper and lower rims fold onto each other in UV (within 0.0006 v),
 *   so one polyline is both the upper and the lower lash line. The lid skin is above it (smaller v), the lower lid below.
 *   Inner to outer. The corners are its ends.
 * - **The crease.** The ridge of concavity (the groove between the lid and the brow bone): per u, the v of the most concave
 *   vertex neighbourhood above the slit, on both default plates. It rises from the outer corner to its peak near u 0.41 and
 *   falls into the inner corner.
 * - **The plate.** Its UV bounds (both eyes: u 0.273 to 0.727; this eye: u 0.273 to 0.481).
 */
export const EYE_LANDMARKS = Object.freeze({
  innerCorner: Object.freeze([0.428, 0.2456]) as UV,
  outerCorner: Object.freeze([0.3735, 0.2515]) as UV,
  lashLine: Object.freeze([[0.428, 0.2456], [0.4255, 0.2461], [0.4182, 0.2495], [0.4063, 0.2544], [0.3931, 0.2563], [0.3826, 0.2544],
    [0.3735, 0.2515]] as UV[]),
  crease: Object.freeze([[0.43, 0.2371], [0.42, 0.2334], [0.41, 0.231], [0.4, 0.2323], [0.39, 0.2343], [0.38, 0.2377], [0.37, 0.244]] as UV[]),
  plate: Object.freeze({ u0: 0.273, u1: 0.727, v0: 0.179, v1: 0.324 }) as UvWindow,
});

/**
 * Natural Bézier handles through `points`: smooth knots take the Catmull–Rom tangent (a sixth of the neighbours' span, equal arms);
 * a corner knot (`true`) has its arms along its neighbouring segments, so an end or a wing tip stays crisp.
 */
function contour(points: readonly (readonly [number, number, true?])[]): Point[] {
  return points.map(([u, v, corner], i) => {
    const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
    if (corner) return { u, v, weight: 1, handles: { in: { u: (before[0] - u) / 3, v: (before[1] - v) / 3 }, out: { u: (after[0] - u) / 3, v: (after[1] - v) / 3 }, mode: "corner" as const } };
    const out = { u: (after[0] - before[0]) / 6, v: (after[1] - before[1]) / 6 };
    return { u, v, weight: 1, handles: { in: { u: -out.u, v: -out.v }, out, mode: "symmetric" as const } };
  });
}
const shape = (points: readonly (readonly [number, number, true?])[], feather: number, opacity: number): StarterShape => {
  if (!(feather >= MIN_FEATHER && feather <= MAX_FEATHER)) throw Error("A starter's feather is outside the supported range.");
  return deepFreeze({ points: contour(points), pathMode: "bezier" as const, feather, softness: { mode: "uniform" as const },
    strength: { mode: "smooth-boundary" as const, blend: DEFAULT_STRENGTH_BLEND }, symmetry: true, opacity, finish: "matte" as const });
};
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}

/**
 * The shape new layers started from before starters: four knots from the outer wing tip over the lid to the inner corner. Kept as
 * the "Wing (original)" starter, exactly as it was.
 */
function originalWing(): StarterShape {
  return deepFreeze(shapeOfLayer(convertToBezier({ id: "original-wing", name: "Wing (original)", enabled: true, color: "#905774", finish: "matte", opacity: 0.85,
    strength: { mode: "smooth-boundary", blend: DEFAULT_STRENGTH_BLEND }, softness: { mode: "uniform" }, feather: 0.006, symmetry: true, fields: [],
    pathMode: "catmull-rom", points: [[0.311, 0.236], [0.335, 0.215], [0.402, 0.214], [0.434, 0.246]].map(([u, v]) => ({ u, v, weight: 1 })) })));
}

export const EYE_DEFAULT_STARTER = "lid-wash";
export const EYE_STARTERS: readonly ContributedStarter[] = Object.freeze([
  { id: "lid-wash", name: "Lid wash",
    description: "A soft wash over the lid, from the upper lash line to just above the crease.",
    // Its lower edge sits 0.002 above the lash line; its top reaches 0.007 above the crease; both ends pass the corners by about 0.004.
    shape: shape([[0.4268, 0.2432], [0.4125, 0.2498], [0.3931, 0.2541], [0.379, 0.2514], [0.37, 0.2455], [0.3745, 0.2352], [0.39, 0.2268],
      [0.408, 0.2238], [0.425, 0.2262], [0.4318, 0.2345]], 0.008, 0.7) },
  { id: "classic-wing", name: "Classic wing",
    description: "A clean liner along the upper lash line, flicking out from the outer corner.",
    // A band 0.002 to 0.005 thick on the lash line; the wing leaves the outer corner at about 27 degrees (569 x 405 mm per unit UV) and is about 10 mm long.
    shape: shape([[0.4262, 0.244], [0.4125, 0.2486], [0.3931, 0.252], [0.379, 0.248], [0.366, 0.243], [0.3595, 0.2403], [0.3555, 0.2388, true],
      [0.3625, 0.2437], [0.3735, 0.2512], [0.3826, 0.2541], [0.3931, 0.2558], [0.4063, 0.2541], [0.4182, 0.2493], [0.4255, 0.2458]], 0.002, 0.9) },
  { id: "crease-smoky", name: "Crease / smoky",
    description: "A soft crescent along the crease, deepest at the outer corner, with blended edges.",
    // Follows the crease (0.003 to 0.011 above it at the top edge, 0.008 to 0.011 below it at the lower) and closes toward the outer corner.
    shape: shape([[0.365, 0.2492], [0.369, 0.2405], [0.379, 0.2315], [0.395, 0.2248], [0.411, 0.222], [0.425, 0.226], [0.433, 0.2335], [0.4345, 0.2415],
      [0.425, 0.2425], [0.411, 0.2395], [0.395, 0.2422], [0.383, 0.248], [0.3735, 0.2497]], 0.012, 0.75) },
  { id: "lower-lash-smudge", name: "Lower-lash smudge",
    description: "A soft smudge under the lower lash line, fuller toward the outer corner.",
    // Hugs the lower lash line (0.0008 below it) and runs about 0.007 down at its fullest, from the outer corner to two thirds of the way in.
    shape: shape([[0.3695, 0.2548], [0.376, 0.2536], [0.3826, 0.2559], [0.3928, 0.2578], [0.4055, 0.2554], [0.4165, 0.2518], [0.4225, 0.2538],
      [0.412, 0.2582], [0.4, 0.264], [0.388, 0.2652], [0.379, 0.2622]], 0.006, 0.65) },
  { id: "wing-original", name: "Wing (original)",
    description: "The shape new layers started from before starters: a lid shape with a wing tip at the outer end.",
    shape: originalWing() },
]);
