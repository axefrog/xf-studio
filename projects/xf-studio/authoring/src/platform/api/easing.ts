/**
 * The Studio's easing curves (research/animation/expression-editor-design.md §5.5): one catalogue for everything that maps a 0–1 progress to a
 * 0–1 amount. Today that is Adjust all › Intensity (a control's travel from rest to the change it applies) and the animated transition
 * between faces (time to blend); the planned timeline editor reuses it for the interpolation between keyframes. Pure data and maths.
 *
 * **The model.** Every curve is a CSS-style cubic Bézier from (0, 0) to (1, 1) with two control points `[x1, y1, x2, y2]`: x is progress
 * (time, or a control's travel), y the amount. `x1` and `x2` stay within 0–1, so the curve is a function of x; `y1` and `y2` may leave
 * 0–1 (an overshoot, which a user of the curve clamps if its values can't overshoot). A stored curve (`EasingCurve`) is a preset's ID or
 * a custom `{ bezier }`, so a keyframe or a preference keeps a short name when it is a preset, and any curve a future handle editor
 * draws fits the same field.
 *
 * **The presets** (`EASINGS`, in the order a curve picker shows them):
 * - **Linear:** steady from start to end. Photo mode's face graph blends between expressions this way, over 1 s.
 * - **Ease in** (`x²`), **Ease out** (`1 − (1 − x)²`), **Ease in-out** (smoothstep, `3x² − 2x³`): the gentle curves Adjust all ›
 *   Intensity has always used. Each is exactly a cubic Bézier with its x controls at ⅓ and ⅔; the closed form is kept as the evaluator.
 * - **Strong ease in-out** (cubic in-out): a slower start and finish and a quicker middle, a deliberate change.
 * - **Strong ease out** (cubic out): most of the change at once, then a long settle, like a spontaneous reaction.
 */
export type EasingId = "linear" | "in" | "out" | "inOut" | "inOutStrong" | "outStrong";
/** A cubic Bézier's two control points, `[x1, y1, x2, y2]`, between (0, 0) and (1, 1). */
export type CubicBezier = readonly [number, number, number, number];
/** A stored curve: a preset by ID, or a custom Bézier (a future curve editor's). */
export type EasingCurve = EasingId | { readonly bezier: CubicBezier };
export type EasingPreset = {
  readonly id: EasingId;
  readonly label: string;
  /** One plain sentence on how it moves. */
  readonly hint: string;
  readonly bezier: CubicBezier;
  /** The exact closed form, where there is one (the Bézier gives the same values to rounding). */
  readonly exact?: (x: number) => number;
};

const THIRD = 1 / 3, TWO_THIRDS = 2 / 3;
export const EASINGS: readonly EasingPreset[] = Object.freeze([
  { id: "linear", label: "Linear", hint: "Steady from start to end.", bezier: [0, 0, 1, 1], exact: (x: number) => x },
  { id: "in", label: "Ease in", hint: "Starts slowly and speeds up into the end.", bezier: [THIRD, 0, TWO_THIRDS, THIRD], exact: (x: number) => x * x },
  { id: "out", label: "Ease out", hint: "Starts quickly and slows into the end.", bezier: [THIRD, TWO_THIRDS, TWO_THIRDS, 1], exact: (x: number) => 1 - (1 - x) * (1 - x) },
  { id: "inOut", label: "Ease in-out", hint: "Gentle at both ends.", bezier: [THIRD, 0, TWO_THIRDS, 1], exact: (x: number) => x * x * (3 - 2 * x) },
  { id: "inOutStrong", label: "Strong ease in-out", hint: "A slow start and finish around a quick middle.", bezier: [0.65, 0, 0.35, 1] },
  { id: "outStrong", label: "Strong ease out", hint: "Most of the change at once, then a long settle.", bezier: [0.33, 1, 0.68, 1] },
].map(preset => Object.freeze({ ...preset, bezier: Object.freeze(preset.bezier) as unknown as CubicBezier })) as EasingPreset[]);
const BY_ID = new Map(EASINGS.map(preset => [preset.id, preset]));

export const EASING_IDS: readonly EasingId[] = Object.freeze(EASINGS.map(preset => preset.id));
export const EASING_LABELS: Readonly<Record<EasingId, string>> = Object.freeze(Object.fromEntries(EASINGS.map(preset => [preset.id, preset.label])) as Record<EasingId, string>);
export const isEasing = (value: unknown): value is EasingId => typeof value === "string" && BY_ID.has(value as EasingId);
export const easingPreset = (id: EasingId): EasingPreset => BY_ID.get(id)!;

/** How far a custom Bézier's y controls may overshoot (a curve editor's handles stay in a sane box). */
export const BEZIER_Y_RANGE = { min: -1, max: 2 } as const;
/** Why a value can't be a custom Bézier, or undefined. */
export function bezierIssue(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(n => typeof n === "number" && Number.isFinite(n))) return "A curve is four numbers.";
  const [x1, y1, x2, y2] = value as number[];
  if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) return "A curve's handles stay between its start and end in time.";
  if (y1! < BEZIER_Y_RANGE.min || y1! > BEZIER_Y_RANGE.max || y2! < BEZIER_Y_RANGE.min || y2! > BEZIER_Y_RANGE.max) return "A curve's handles are too far out.";
  return undefined;
}
/** A stored curve read back: a known preset ID, or a valid custom Bézier; undefined otherwise. */
export function parseEasingCurve(value: unknown): EasingCurve | undefined {
  if (isEasing(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && !bezierIssue((value as { bezier?: unknown }).bezier))
    return { bezier: Object.freeze([...(value as { bezier: number[] }).bezier]) as unknown as CubicBezier };
  return undefined;
}
/** A curve's control points (a preset's, or the custom ones). */
export const easingBezier = (curve: EasingCurve): CubicBezier => typeof curve === "string" ? (BY_ID.get(curve) ?? BY_ID.get("linear")!).bezier : curve.bezier;

/**
 * A cubic Bézier's y at progress x (the WebKit UnitBezier method): Newton's method for the parameter whose x matches, bisection where
 * Newton stalls, then y at that parameter. Exact at the ends.
 */
export function bezierAt(points: CubicBezier, x: number): number {
  const [x1, y1, x2, y2] = points;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x1 === y1 && x2 === y2) return x;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const error = sampleX(t) - x;
    if (Math.abs(error) < 1e-9) return ((ay * t + by) * t + cy) * t;
    const slope = slopeX(t);
    if (Math.abs(slope) < 1e-9) break;
    t -= error / slope;
  }
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < 60 && hi - lo > 1e-12; i++) {
    const value = sampleX(t);
    if (Math.abs(value - x) < 1e-9) break;
    if (value < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

/** The curve's amount at progress `x` (clamped to 0–1; 0 for anything non-finite). A preset uses its exact form where it has one. */
export function ease(curve: EasingCurve, x: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  if (typeof curve === "string") {
    const preset = BY_ID.get(curve) ?? BY_ID.get("linear")!;
    return preset.exact ? preset.exact(t) : bezierAt(preset.bezier, t);
  }
  return bezierAt(curve.bezier, t);
}

/**
 * A centred control's position (0–100, rest at 50) as the signed, eased amount of change: above 50, `ease((t − 50) / 50)`; below,
 * `−ease((50 − t) / 50)`. Continuous through 50, where the amount is 0.
 */
export function centredAmount(position: number, easing: EasingCurve): number {
  const t = Math.max(0, Math.min(100, Number.isFinite(position) ? position : 50));
  return t >= 50 ? ease(easing, (t - 50) / 50) : -ease(easing, (50 - t) / 50);
}
