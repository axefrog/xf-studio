/**
 * The Studio lighting preset's adjustable rig, as data (no Three here; `studio-light-rig.ts` is the adapter).
 *
 * The studio stage lights V with the room environment (image-based light), a warm key, a cool fill and an optional rim, then
 * tone-maps with ACES at an exposure. Everything here is a workspace preference: it never enters recipes, Undo or export.
 *
 * - **Strengths** are multiples of the stage's reference intensities (`STUDIO_BASE_INTENSITY`), so 1 is the original rig.
 * - **Key direction** is an azimuth (the existing `lightAngle`, 0° = from the camera, increasing towards V's right, +X) and an
 *   elevation above the head's horizontal plane.
 * - **Neutral** replaces the warm key and cool fill with greys of the same luminance, for judging colour.
 * - **Setups** are named starting points, applied in one step and freely adjustable afterwards. Soft studio is today's look and
 *   the default: every workspace saved before these controls loads with it.
 */
export type StudioLights = {
  /** Room environment (ambient and reflections) strength, × the stage's own. */
  environment: number;
  /** Key light strength, × 2.5. */
  key: number;
  /** Key light elevation in degrees above the head's horizontal plane. */
  elevation: number;
  /** Fill light strength, × 1. */
  fill: number;
  /** Rim light strength (from behind V's right), × 2.5; off in the original rig. */
  rim: number;
  /** Untinted lights (the same luminance) instead of the warm key and cool fill. */
  neutral: boolean;
};
export type StudioLightKey = "environment" | "key" | "elevation" | "fill" | "rim";
export const STUDIO_LIGHT_KEYS: readonly StudioLightKey[] = Object.freeze(["environment", "key", "elevation", "fill", "rim"]);
export const STUDIO_LIGHT_RANGES: Readonly<Record<StudioLightKey, { readonly min: number; readonly max: number }>> = Object.freeze({
  environment: Object.freeze({ min: 0, max: 3 }), key: Object.freeze({ min: 0, max: 4 }), elevation: Object.freeze({ min: -30, max: 80 }),
  fill: Object.freeze({ min: 0, max: 4 }), rim: Object.freeze({ min: 0, max: 4 }),
});
/** Studio exposure: ±3 stops around 1 (it was 0.5–2). ACES then tone-maps. */
export const STUDIO_EXPOSURE_RANGE = Object.freeze({ min: 0.125, max: 8 });
export const STUDIO_KEY_ANGLE_RANGE = Object.freeze({ min: 0, max: 360 });

/** The original rig's reference intensities and colours (sRGB hex), unchanged. */
export const STUDIO_BASE_INTENSITY = Object.freeze({ key: 2.5, fill: 1, rim: 2.5 });
export const STUDIO_LIGHT_COLOURS = Object.freeze({ key: 0xfff2e9, fill: 0xc6dafa, rim: 0xe6eeff });
/** The head the key and rim aim at, and the key's distance from it (only the direction matters to a directional light). */
export const STUDIO_LIGHT_TARGET: readonly [number, number, number] = Object.freeze([0, 1.67, 0]);
/** The fill stays where it was: in front of V's right cheek, level with the eyes. */
export const STUDIO_FILL_POSITION: readonly [number, number, number] = Object.freeze([0.4, 1.65, -0.2]);
/** The rim comes from behind V's right shoulder, above the head. */
export const STUDIO_RIM_DIRECTION = Object.freeze({ azimuth: 150, elevation: 35 });

export const DEFAULT_STUDIO_EXPOSURE = 1.2;
export const DEFAULT_KEY_ANGLE = 329;
/** The original key sat at (−0.3, 1.9, −0.5) aiming at the head: 0.23 m above it over 0.583 m, about 21.5°. Kept exactly. */
export const DEFAULT_KEY_ELEVATION = Math.atan2(1.9 - 1.67, Math.hypot(0.3, 0.5)) * 180 / Math.PI;
export const DEFAULT_STUDIO_LIGHTS: Readonly<StudioLights> = Object.freeze({
  environment: 1, key: 1, elevation: DEFAULT_KEY_ELEVATION, fill: 1, rim: 0, neutral: false });

/** The whole studio stage as the controls set it: the rig, plus the existing exposure and key angle. */
export type StudioStage = { lights: StudioLights; exposure: number; angle: number };
export const DEFAULT_STUDIO_STAGE: Readonly<StudioStage> = Object.freeze({
  lights: DEFAULT_STUDIO_LIGHTS, exposure: DEFAULT_STUDIO_EXPOSURE, angle: DEFAULT_KEY_ANGLE });

export const STUDIO_SETUP_IDS = ["soft", "key", "flat", "rim", "mirror"] as const;
export type StudioSetupId = typeof STUDIO_SETUP_IDS[number];
export type StudioSetup = { id: StudioSetupId; label: string; title: string } & StudioStage;
const setup = (id: StudioSetupId, label: string, title: string, angle: number, exposure: number, lights: Partial<StudioLights>): StudioSetup =>
  Object.freeze({ id, label, title, angle, exposure, lights: Object.freeze({ ...DEFAULT_STUDIO_LIGHTS, ...lights }) });
/**
 * Named setups. Soft studio is the original rig. The others trade the room's ambient for direct light so the key's direction
 * reads, and raise exposure to keep skin at about the same brightness (checked in the browser on the default V).
 */
export const STUDIO_SETUPS: Readonly<Record<StudioSetupId, StudioSetup>> = Object.freeze({
  soft: setup("soft", "Soft studio", "Even, soft authoring light: the room, a warm key and a cool fill (the default)",
    DEFAULT_KEY_ANGLE, DEFAULT_STUDIO_EXPOSURE, {}),
  key: setup("key", "Key light", "One strong light from the side and above with little ambient, so shape and shine read",
    305, 1.4, { environment: 0.2, key: 2.4, elevation: 35, fill: 0.25 }),
  flat: setup("flat", "Flat", "Even, untinted light from all round with almost no direction, for judging colour",
    0, 1.3, { environment: 1.4, key: 0.25, elevation: 10, fill: 0, neutral: true }),
  rim: setup("rim", "Rim / dramatic", "A hard side key and a bright rim from behind on a dark room",
    285, 1.3, { environment: 0.08, key: 2.8, elevation: 25, fill: 0, rim: 2.5 }),
  mirror: setup("mirror", "Mirror", "Untinted light from in front and slightly above, like a lit mirror, with a soft room",
    0, 1.2, { environment: 0.5, key: 1.6, elevation: 20, fill: 0.3, neutral: true }),
});

const finite = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
export const validStudioLightValue = (key: StudioLightKey, value: unknown): value is number => finite(value, STUDIO_LIGHT_RANGES[key]);
export const validStudioExposure = (value: unknown): value is number => finite(value, STUDIO_EXPOSURE_RANGE);
/** A stored rig: every field present and in range, nothing else read. */
export function validStudioLights(value: unknown): value is StudioLights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return STUDIO_LIGHT_KEYS.every(key => validStudioLightValue(key, record[key])) && typeof record.neutral === "boolean";
}
export const sameStudioLights = (a: Readonly<StudioLights>, b: Readonly<StudioLights>) =>
  STUDIO_LIGHT_KEYS.every(key => a[key] === b[key]) && a.neutral === b.neutral;
export const sameStudioStage = (a: Readonly<StudioStage>, b: Readonly<StudioStage>) =>
  a.exposure === b.exposure && a.angle === b.angle && sameStudioLights(a.lights, b.lights);
export const isDefaultStudioStage = (stage: Readonly<StudioStage>) => sameStudioStage(stage, DEFAULT_STUDIO_STAGE);
/** The named setup the stage matches exactly (null once anything was adjusted). */
export function matchingStudioSetup(stage: Readonly<StudioStage>): StudioSetupId | null {
  return STUDIO_SETUP_IDS.find(id => sameStudioStage(stage, STUDIO_SETUPS[id])) ?? null;
}

/** Unit vector from the head towards a light at `azimuth` and `elevation` degrees (0° azimuth = the camera's side, −Z). */
export function lightDirection(azimuth: number, elevation: number): [number, number, number] {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
