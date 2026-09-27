/**
 * Easing curves for operations that move many values by one control (the Expression panel's Adjust all › Intensity): each maps the
 * control's travel `x` (0–1, from its rest position) to the change applied (0–1). Pure; the chosen curve is a UI preference
 * (`easing.set`, per operation).
 *
 * - **Linear:** the change follows the control.
 * - **Ease in:** small at first, faster near the end (`x²`): fine control around rest.
 * - **Ease out:** fast at first, gentle near the end (`1 − (1 − x)²`): fine control near full.
 * - **Ease in-out:** gentle at both ends (smoothstep, `3x² − 2x³`).
 */
export type EasingId = "linear" | "in" | "out" | "inOut";
export const EASING_IDS: readonly EasingId[] = ["linear", "in", "out", "inOut"];
export const EASING_LABELS: Readonly<Record<EasingId, string>> = { linear: "Linear", in: "Ease in", out: "Ease out", inOut: "Ease in-out" };
export const isEasing = (value: unknown): value is EasingId => typeof value === "string" && (EASING_IDS as readonly string[]).includes(value);

export function ease(easing: EasingId, x: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  switch (easing) {
    case "in": return t * t;
    case "out": return 1 - (1 - t) * (1 - t);
    case "inOut": return t * t * (3 - 2 * t);
    default: return t;
  }
}

/**
 * A centred control's position (0–100, rest at 50) as the signed, eased amount of change: above 50, `ease((t − 50) / 50)`; below,
 * `−ease((50 − t) / 50)`. Continuous through 50, where the amount is 0.
 */
export function centredAmount(position: number, easing: EasingId): number {
  const t = Math.max(0, Math.min(100, Number.isFinite(position) ? position : 50));
  return t >= 50 ? ease(easing, (t - 50) / 50) : -ease(easing, (50 - t) / 50);
}
