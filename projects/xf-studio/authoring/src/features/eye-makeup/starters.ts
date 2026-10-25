/**
 * Eye makeup's contributed starter shapes (profiles design §6; AGENTS.md "Defaults are contributed baselines"): the contours a new
 * layer or a new look starts from, as read-only data. Each sits on the real eye of the head UV, placed from where the game's own
 * eye makeup is painted (`EYE_LANDMARKS`), is symmetric (drawn on the u < ½ eye and mirrored across the face's centre line) and keeps
 * inside the plate with room for its feather.
 *
 * Where the numbers come from (knowledge/face-makeup.md, "Landmarks of the eye in UV"): the vanilla character creator's 36 eye makeup
 * styles share one decal mesh whose vertices sit 0.40 mm over the head's own, so each style's texture can be laid onto the head UV
 * exactly (`tools/eye-landmarks.ts`). Lid wash is the contour of the vanilla lid washes (styles 01, 03, 04); Classic wing joins the
 * clean liner (05) to the winged liner's flick (02, 14); Crease / smoky sits on the fold the lid washes end at, blending up toward the
 * brow bone as the vanilla smoky styles (24 to 26) do; Lower-lash smudge follows the vanilla lower-lid bands (22, 27). The head UV is shared
 * by both default bodies, so the same contours serve both.
 */
import { convertToBezier } from "../../engines/layered-makeup/bezier-path";
import { DEFAULT_STRENGTH_BLEND, MAX_FEATHER, MIN_FEATHER, type Point } from "../../engines/layered-makeup/recipe";
import { shapeOfLayer, type ContributedStarter, type StarterShape } from "../../engines/layered-makeup/starter-shape";
import type { UvWindow } from "../../engines/layered-makeup/plate-uv-window";

type UV = readonly [u: number, v: number];
/**
 * The eye on the u < ½ side of the head UV (the other is its mirror across u = ½), in glTF UV0 (top left, v down). Inner to outer unless
 * said. Measured on the vanilla eye makeup coverage (the 0.5 contour of the lid and liner styles, median over the styles named), not on
 * the plate's geometry alone: the plate's rolled lid margin is a band of UV that carries no makeup in game.
 *
 * - **The slit.** The plate's eye opening: its upper and lower rims fold onto each other in UV (within 0.0006 v), so one polyline. The
 *   corners are its ends. It is not where makeup ends: the rolled lid margin lies between it and the lid.
 * - **The upper lash line (lid edge).** Where vanilla lid makeup ends, 0.003 to 0.006 above the slit in the middle of the eye.
 * - **The crease (the lid's fold).** Where vanilla lid washes end at the top (styles 01, 03, 04, 13, 18, 19, median): the fold between the
 *   mobile lid and the brow bone. It is about 0.025 above the upper lash line at the middle of the eye, higher than the plate's most concave
 *   vertices, which sit on the margin.
 * - **The lower lash line (lower lid edge).** Where vanilla lower-lid bands begin, below the margin of the lower lid.
 * - **The plate.** Its UV bounds (both eyes: u 0.273 to 0.727; this eye: u 0.273 to 0.481).
 */
export const EYE_LANDMARKS = Object.freeze({
  innerCorner: Object.freeze([0.428, 0.2456]) as UV,
  outerCorner: Object.freeze([0.3735, 0.2515]) as UV,
  slit: Object.freeze([[0.428, 0.2456], [0.4255, 0.2461], [0.4182, 0.2495], [0.4063, 0.2544], [0.3931, 0.2563], [0.3826, 0.2544],
    [0.3735, 0.2515]] as UV[]),
  upperLashLine: Object.freeze([[0.43, 0.2478], [0.42, 0.2453], [0.41, 0.2493], [0.4, 0.2523], [0.39, 0.252], [0.38, 0.2498], [0.37, 0.2505], [0.36, 0.2483], [0.35, 0.245]] as UV[]),
  crease: Object.freeze([[0.43, 0.2298], [0.42, 0.224], [0.41, 0.2213], [0.4, 0.22], [0.39, 0.2228], [0.38, 0.2248], [0.37, 0.2263], [0.36, 0.2298], [0.35, 0.232]] as UV[]),
  lowerLashLine: Object.freeze([[0.43, 0.2615], [0.42, 0.2563], [0.41, 0.2583], [0.4, 0.261], [0.39, 0.2618], [0.38, 0.2595], [0.37, 0.2563], [0.36, 0.2563], [0.35, 0.2563]] as UV[]),
  plate: Object.freeze({ u0: 0.273, u1: 0.727, v0: 0.179, v1: 0.324 }) as UvWindow,
});

/**
 * Natural Bézier handles through `points`: smooth knots take the Catmull–Rom tangent (a sixth of the neighbours' span, equal arms);
 * a corner knot (`true`) has its arms along its neighbouring segments, so an end or a wing tip stays crisp.
 */
function contour(points: readonly (readonly [number, number, true?])[]): Point[] {
  // `+ 0` turns a negative zero into zero: a shape must read back equal after the library's JSON.
  const z = (value: number) => value + 0;
  return points.map(([u, v, corner], i) => {
    const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
    if (corner) return { u, v, weight: 1, handles: { in: { u: z((before[0] - u) / 3), v: z((before[1] - v) / 3) }, out: { u: z((after[0] - u) / 3), v: z((after[1] - v) / 3) }, mode: "corner" as const } };
    const out = { u: z((after[0] - before[0]) / 6), v: z((after[1] - before[1]) / 6) };
    return { u, v, weight: 1, handles: { in: { u: z(-out.u), v: z(-out.v) }, out, mode: "symmetric" as const } };
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
    description: "A soft wash over the lid, from the upper lash line up to the crease, and out past the outer corner.",
    // The 0.5 contour of vanilla lid wash 01: top on the fold (0.2195 at u 0.39), bottom on the lid edge (0.2515 at u 0.39), reaching u 0.343 outward.
    shape: shape([[0.343, 0.229], [0.36, 0.2238], [0.38, 0.2198], [0.4, 0.22], [0.418, 0.225], [0.43, 0.234], [0.4335, 0.241],
      [0.423, 0.245], [0.405, 0.2505], [0.388, 0.2515], [0.37, 0.248], [0.355, 0.24]], 0.006, 0.7) },
  { id: "classic-wing", name: "Classic wing",
    description: "A clean liner along the upper lash line, thickening outward, with a flick past the outer corner angled up toward the brow's tail.",
    // Top edge nearly level like vanilla liner 05 (0.2395), raised past winged liner 02's 0.236 to 0.2335 at the middle so it reads in 3D, thickest (0.019)
    // at u 0.40; the flick leaves u 0.366 for its tip at (0.3435, 0.2245), about 33 degrees up in millimetres (569 x 405 mm per unit UV), 20 mm out.
    shape: shape([[0.4315, 0.2455], [0.4265, 0.2405], [0.418, 0.2375], [0.405, 0.235], [0.39, 0.2335], [0.377, 0.2335], [0.366, 0.234], [0.356, 0.2305],
      [0.348, 0.2275], [0.3435, 0.2245, true], [0.35, 0.2345], [0.358, 0.24], [0.366, 0.245], [0.372, 0.249], [0.38, 0.2498], [0.39, 0.252], [0.4, 0.2523],
      [0.41, 0.2493], [0.42, 0.2453]], 0.002, 0.9) },
  { id: "crease-smoky", name: "Crease / smoky",
    description: "A soft crescent in the crease, blending up toward the brow bone, clear of the lid itself.",
    // Centred on the fold (crease 0.2195 at u 0.40): 0.0175 above it at the top (0.202, as vanilla smoky styles 24 to 26 reach 0.204 to 0.209) and 0.012
    // below at the bottom; tapering to the outer end (0.346, 0.238) and the inner end (0.4375, 0.234).
    shape: shape([[0.346, 0.238], [0.355, 0.222], [0.37, 0.209], [0.39, 0.2025], [0.41, 0.2035], [0.425, 0.211], [0.435, 0.223], [0.4375, 0.234],
      [0.425, 0.2395], [0.405, 0.2318], [0.385, 0.2325], [0.368, 0.2365], [0.355, 0.2415]], 0.014, 0.75) },
  { id: "lower-lash-smudge", name: "Lower-lash smudge",
    description: "A soft smudge under the lower lash line, fuller toward the outer corner.",
    // From the lower lid's edge (vanilla lower bands 22, 27 begin 0.262 at u 0.39, past the lid's margin) down to 0.2755 at the middle, outer end the fullest.
    shape: shape([[0.36, 0.2568], [0.375, 0.259], [0.39, 0.2626], [0.405, 0.2615], [0.42, 0.2578], [0.4255, 0.259], [0.415, 0.264], [0.4, 0.2722],
      [0.385, 0.2764], [0.37, 0.2762]], 0.008, 0.65) },
  { id: "wing-original", name: "Wing (original)",
    description: "The shape new layers started from before starters: a lid shape with a wing tip at the outer end.",
    shape: originalWing() },
]);

/** The window a starter thumbnail shows: the eye with room for the wing tip and the smoky crescent (every starter's outline lies inside it, so all thumbnails share one frame and one scale). */
export const EYE_THUMBNAIL_WINDOW: UvWindow = Object.freeze({ u0: 0.3, u1: 0.45, v0: 0.19, v1: 0.29 });
