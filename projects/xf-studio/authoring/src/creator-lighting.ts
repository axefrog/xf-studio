/**
 * The game's character-creator / mirror light rig and camera, as data and arithmetic. Pure: no Three.js,
 * no DOM. Specification and grades: knowledge/creator-lighting.md (§2 rig table, §3 camera, §7 preview
 * mapping). The Three adapter is creator-lighting-rig.ts.
 *
 * What is exact [resource]: every light's position, spot axis, lumens, colour, cone angles, falloff mode
 * and radius, and the camera's 15° field of view and slot heights. What is decoded [source]: the two
 * falloff forms. What is a hypothesis: the lumens-to-intensity conversion, whether cone angles are full
 * or half angles, unset colour = white, the rig's yaw (−125°) and "zoom = distance in metres". The two
 * switches in `CreatorLightingOptions` exist so a capture can choose between the leading readings.
 *
 * Every factor fitted to a capture lives in `CREATOR_CALIBRATION` (knowledge §12), never in the rig table: the table keeps the
 * resource's values, and a new capture refits that one object.
 */

export type Vec3 = readonly [number, number, number];
export type Rgb8 = readonly [number, number, number];
export type BodySex = "female" | "male";
export type LightFalloff = "inverse-square" | "linear";

/** One `worldStaticLightNode` spot light in the Studio frame (Y up, V faces −Z, V's right = +X, metres from V's feet). */
export type CreatorLight = {
  readonly name: string;
  readonly position: Vec3;
  /** Unit spot axis (the node's local +Y). */
  readonly axis: Vec3;
  readonly lumen: number;
  /** 8-bit sRGB; null when the resource does not store a colour (taken to be white, [hypothesis]). */
  readonly colour: Rgb8 | null;
  /** Stored cone angles in degrees; whether they are full or half angles is a switch. */
  readonly outer: number;
  readonly inner: number;
  readonly falloff: LightFalloff;
  readonly radius: number;
  /** Stored `softness`; the engine's cone is pow(…, c) with c from the CPU ([hypothesis] c = softness). */
  readonly softness: number;
  readonly shadows: boolean;
  readonly contactShadows: boolean;
  /** −8 on the magenta rims; not applied by the preview (knowledge §7, "Specular"). */
  readonly roughnessBias: number;
};

const light = (name: string, position: Vec3, axis: Vec3, lumen: number, colour: Rgb8 | null, outer: number, inner: number,
  falloff: LightFalloff, radius: number, extra: Partial<Pick<CreatorLight, "softness" | "shadows" | "contactShadows" | "roughnessBias">> = {}): CreatorLight =>
  Object.freeze({ name, position, axis, lumen, colour, outer, inner, falloff, radius, softness: extra.softness ?? 2,
    shadows: extra.shadows ?? false, contactShadows: extra.contactShadows ?? false, roughnessBias: extra.roughnessBias ?? 0 });

const CYAN_FILL: Rgb8 = [165, 228, 255], MAGENTA: Rgb8 = [255, 25, 128], RIM_CYAN: Rgb8 = [191, 254, 255], RIM_WHITE: Rgb8 = [229, 247, 255];

/**
 * Female rig, sector `quest_fc76e8948d75e8d4` (menu world; the Night City box matches light for light),
 * converted at yaw −125° by research/character-customization/creator-lighting/rig_table.py.
 */
export const CREATOR_RIG_FEMALE: readonly CreatorLight[] = Object.freeze([
  light("Main_Face", [-0.304, 1, -0.794], [0.364, 0.707, 0.606], 40, null, 45, 15, "linear", 5, { contactShadows: true }),
  light("Main_Eyes", [-0.779, 1.75, -3.607], [0.157, 0, 0.988], 40, null, 30, 1, "linear", 5, { softness: 5 }),
  light("Main_Top", [-1.577, 4, -2.253], [0.348, -0.726, 0.593], 250, null, 50, 25, "inverse-square", 7.5, { softness: 5 }),
  light("Main_Body", [-0.405, 0.95, -1.717], [0.145, -0.048, 0.988], 65, null, 60, 30, "linear", 5, { shadows: true }),
  light("Main_Feet", [-0.405, 0.65, -1.717], [0.115, -0.307, 0.945], 35, null, 30, 15, "linear", 5),
  light("Fill_Upper", [0.553, 0, -0.936], [-0.196, 0.928, 0.317], 100, CYAN_FILL, 50, 1, "linear", 5, { shadows: true }),
  light("Fill_Base", [2.253, 0, -1.577], [-0.838, 0.162, 0.52], 10, CYAN_FILL, 40, 1, "linear", 7.5),
  light("Fill_Left", [2.253, 3, -1.577], [-0.593, -0.726, 0.348], 10, CYAN_FILL, 90, 30, "linear", 7.5),
  light("Fill_Lower", [0.991, 0.93, -0.328], [-0.815, 0.263, 0.517], 2.5, CYAN_FILL, 45, 30, "linear", 3),
  light("Highlight_Right", [-2.048, 2, -1.007], [0.856, -0.251, 0.453], 50, null, 15, 10, "linear", 5, { shadows: true }),
  light("Highlight_Body", [-1.794, 0, -1.185], [0.849, 0.289, 0.443], 75, null, 55, 1, "linear", 5, { shadows: true }),
  light("Rim_Right", [-2.253, 1.5, 1.577], [0.788, -0.156, -0.595], 600, RIM_CYAN, 75, 1, "inverse-square", 5, { contactShadows: true }),
  light("Rim_Top", [-0.123, 3, 0.696], [0.087, -0.866, -0.493], 600, RIM_WHITE, 25, 1, "linear", 1.65, { shadows: true, contactShadows: true }),
  light("Rim_Left_Head", [0.656, 0.5, 1.982], [-0.521, 0.676, -0.521], 450, MAGENTA, 90, 1, "inverse-square", 5, { contactShadows: true, roughnessBias: -8 }),
  light("Rim_Left_Body", [0.942, 0.78, 1.782], [-0.674, 0.016, -0.739], 450, MAGENTA, 60, 1, "inverse-square", 2.25, { roughnessBias: -8 }),
]);

/** Male rig, sector `quest_a0f0cd2476942221`: the same layout without Main_Feet, some lights moved or dimmer. */
export const CREATOR_RIG_MALE: readonly CreatorLight[] = Object.freeze([
  light("Main_Face", [-0.488, 1, -0.696], [0.5, 0.707, 0.5], 35, null, 45, 15, "linear", 5, { contactShadows: true }),
  light("Main_Eyes", [-1.628, 1.75, -3.311], [0.391, 0, 0.92], 25, RIM_WHITE, 30, 1, "linear", 5, { softness: 5 }),
  light("Main_Top", [-1.577, 4, -2.253], [0.348, -0.726, 0.593], 200, RIM_WHITE, 50, 25, "inverse-square", 7.5, { softness: 5 }),
  light("Main_Body", [-0.405, 0.8, -1.717], [0.145, -0.048, 0.988], 40, null, 75, 30, "linear", 5, { shadows: true }),
  light("Fill_Upper", [0.553, 0, -0.936], [-0.196, 0.928, 0.317], 75, [165, 227, 255], 50, 1, "linear", 5, { shadows: true }),
  light("Fill_Base", [2.253, 0, -1.577], [-0.838, 0.162, 0.52], 10, CYAN_FILL, 40, 1, "linear", 7.5),
  light("Fill_Left", [2.253, 3, -1.577], [-0.593, -0.726, 0.348], 10, CYAN_FILL, 90, 30, "linear", 7.5),
  light("Fill_Lower", [0.991, 0.93, -0.328], [-0.815, 0.263, 0.517], 2.5, CYAN_FILL, 45, 30, "linear", 3),
  light("Highlight_Right", [-2.048, 2, -1.007], [0.856, -0.251, 0.453], 50, null, 15, 10, "linear", 5, { shadows: true }),
  light("Highlight_Body", [-1.794, 0, -1.185], [0.849, 0.289, 0.443], 35, null, 55, 1, "linear", 5, { shadows: true }),
  light("Rim_Right", [-2.253, 1.5, 1.577], [0.788, -0.156, -0.595], 600, RIM_CYAN, 75, 1, "inverse-square", 5, { contactShadows: true }),
  light("Rim_Top", [-0.123, 3, 0.696], [0.087, -0.866, -0.493], 600, RIM_WHITE, 25, 1, "linear", 1.65, { shadows: true, contactShadows: true }),
  light("Rim_Left_Head", [0.656, 0.5, 1.982], [-0.521, 0.676, -0.521], 250, MAGENTA, 90, 1, "inverse-square", 5, { contactShadows: true, roughnessBias: -8 }),
  light("Rim_Left_Body", [0.942, 0.78, 1.782], [-0.674, 0.016, -0.739], 250, MAGENTA, 60, 1, "inverse-square", 2.25, { roughnessBias: -8 }),
]);

export const CREATOR_RIGS: Readonly<Record<BodySex, readonly CreatorLight[]>> = Object.freeze({ female: CREATOR_RIG_FEMALE, male: CREATOR_RIG_MALE });

/** Face and hair camera slots (the controller's `cameraSetup` slots; x offset −0.03 m ignored) [resource]. */
export const CREATOR_HEAD_SLOT: Readonly<Record<BodySex, Vec3>> = Object.freeze({ female: [0, 1.62, 0], male: [0, 1.67, 0] });

/** The render-to-texture camera: `target_face.ent`, fov 15, near 0.1 [resource]; vertical axis [hypothesis]. */
export const CREATOR_CAMERA = Object.freeze({ fov: 15, near: 0.1 });
export type CreatorCameraPage = "face" | "hair";
/**
 * "Zoom" read as metres from the slot [hypothesis]: `UI_Eyes`, `UI_HeadPreview` and the other face pages 1.2;
 * `UI_Hairs` and `UI_Skin` 2.0 [resource values].
 */
export const CREATOR_PAGE_DISTANCE: Readonly<Record<CreatorCameraPage, number>> = Object.freeze({ face: 1.2, hair: 2.0 });

/** Camera state for a creator page: frontal (yaw from the capture fit, [hypothesis]) at the page distance. */
export function creatorCamera(sex: BodySex, page: CreatorCameraPage): { position: number[]; target: number[]; fov: number } {
  const [x, y, z] = CREATOR_HEAD_SLOT[sex];
  return { position: [x, y, z - CREATOR_PAGE_DISTANCE[page]], target: [x, y, z], fov: CREATOR_CAMERA.fov };
}

/** lumens → candela: Φ/4π (the starting hypothesis) or spread over the spot cone, Φ/(2π(1 − cos θ)). */
export type IntensityForm = "isotropic" | "cone";
/** The stored angles are full cone angles (Three half-angle = outer/2) or already half angles. */
export type ConeReading = "full" | "half";
/** `shadows`: the flagged lights cast shadow maps onto the V (knowledge §12); off only to compare, or on a GPU that can't afford them. */
export type CreatorLightingOptions = { readonly intensity: IntensityForm; readonly cone: ConeReading; readonly exposure: number; readonly shadows: boolean };
export const INTENSITY_FORMS: readonly IntensityForm[] = Object.freeze(["isotropic", "cone"]);
export const CONE_READINGS: readonly ConeReading[] = Object.freeze(["full", "half"]);
/** Exposure bounds for the diagnostic control; the scalar multiplies scene-linear colour before the LUT. */
export const CREATOR_EXPOSURE_RANGE = Object.freeze({ min: 0.01, max: 20 });

/**
 * The creator preset's calibration: every factor that comes from matching a capture rather than from the game's data, in one place.
 * Grade [runtime, one matched pair]: fitted on 27 September 2026 to one matched Studio/game pair of the face page (same V, makeup,
 * hair and framing), region by region in scene-linear light after inverting the installed grade, with the shadow casters on
 * (knowledge/creator-lighting.md §12). One capture cannot separate a light's lumens conversion from its cone, colour or occlusion, so
 * these are provisional: refit them from the next matched captures and change nothing else.
 *
 * - `gains`: a multiplier per rig light on top of its data-derived intensity (a light not named keeps 1). A gain far from 1 says the
 *   data-to-intensity conversion for that light is unknown, not that the light is misplaced.
 * - `exposure`: the scalar k before the grade, fitted on the forehead.
 */
export const CREATOR_CALIBRATION: Readonly<{ fitted: string; gains: Readonly<Record<string, number>>; exposure: number }> = Object.freeze({
  fitted: "2026-09-27, one matched face-page pair",
  // The pair's shading is carried mostly by Main_Face, the designers' key with character contact shadows (its nose shadow runs up
  // toward V's right inner eye). A luminance-only fit also wants the cyan floor fills far weaker, but that turns the skin redder, away
  // from the game, so the fills keep their data strength until the skin's scatter is ported (knowledge §12).
  gains: Object.freeze({ Main_Face: 3 }),
  exposure: 0.5,
});
/** A light's calibration gain (1 when the calibration doesn't name it). */
export const calibrationGain = (name: string) => CREATOR_CALIBRATION.gains[name] ?? 1;

/** Default exposure `k`: the calibration's fitted value (`defaultCreatorExposure` gives the earlier synthetic forehead reading). */
export const DEFAULT_CREATOR_EXPOSURE = CREATOR_CALIBRATION.exposure;
export const DEFAULT_CREATOR_LIGHTING: CreatorLightingOptions = Object.freeze({ intensity: "isotropic", cone: "full", exposure: DEFAULT_CREATOR_EXPOSURE,
  shadows: true });

export function validCreatorLighting(value: unknown): value is CreatorLightingOptions {
  const v = value as CreatorLightingOptions;
  return !!v && typeof v === "object" && INTENSITY_FORMS.includes(v.intensity) && CONE_READINGS.includes(v.cone) &&
    typeof v.exposure === "number" && Number.isFinite(v.exposure) &&
    v.exposure >= CREATOR_EXPOSURE_RANGE.min && v.exposure <= CREATOR_EXPOSURE_RANGE.max && typeof v.shadows === "boolean";
}
/** Stored options, or null: options saved before the shadow switch existed read with shadows on. */
export function readCreatorLighting(value: unknown): CreatorLightingOptions | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CreatorLightingOptions>;
  const options = { intensity: v.intensity, cone: v.cone, exposure: v.exposure, shadows: v.shadows === undefined ? true : v.shadows };
  return validCreatorLighting(options) ? options : null;
}

const RAD = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalise = (a: Vec3): Vec3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const saturate = (x: number) => Math.min(1, Math.max(0, x));

/** Decoded inverse-square falloff [source]: saturate(1 − (d/r)⁴)² / max(d², 1e−4) (Three's physical falloff with decay 2). */
export function inverseSquareFalloff(distance: number, radius: number): number {
  return saturate(1 - (distance / radius) ** 4) ** 2 / Math.max(distance * distance, 1e-4);
}
/** Decoded linear falloff [source]: 1 − saturate(d/r), with no inverse-square term. */
export function linearFalloff(distance: number, radius: number): number {
  return 1 - saturate(distance / radius);
}
export function falloff(l: Pick<CreatorLight, "falloff" | "radius">, distance: number): number {
  return l.falloff === "inverse-square" ? inverseSquareFalloff(distance, l.radius) : linearFalloff(distance, l.radius);
}

/** Outer and inner half-angles in degrees under a cone reading; Three's spot angle is capped below 90°. */
export function halfAngles(l: Pick<CreatorLight, "outer" | "inner">, cone: ConeReading): { outer: number; inner: number } {
  const k = cone === "full" ? 0.5 : 1;
  return { outer: Math.min(89.9, l.outer * k), inner: Math.min(89.9, l.inner * k) };
}

/** Candela from lumens under an intensity form (the cone form uses the outer half-angle of the cone reading). */
export function lumensToCandela(l: Pick<CreatorLight, "lumen" | "outer" | "inner">, form: IntensityForm, cone: ConeReading): number {
  if (form === "isotropic") return l.lumen / (4 * Math.PI);
  const half = halfAngles(l, cone).outer * RAD;
  return l.lumen / (2 * Math.PI * (1 - Math.cos(half)));
}

/**
 * The engine's spot cone, `pow(saturate(a·cosθ + b), c)`, read as a linear ramp in cos θ between the outer and
 * inner half-angles, raised to the softness [hypothesis, as rig_gains.py]. The preview's Three lights use a
 * smoothstep over the same angles instead; the lights that matter aim within a few degrees of the head.
 */
export function coneFactor(l: Pick<CreatorLight, "outer" | "inner" | "softness">, cone: ConeReading, cosAngle: number): number {
  const h = halfAngles(l, cone);
  const co = Math.cos(h.outer * RAD), ci = Math.cos(Math.max(h.inner, 0.005) * RAD);
  return saturate((cosAngle - co) / Math.max(ci - co, 1e-4)) ** l.softness;
}

/** Three's spot cone for the same angles: smoothstep from the outer to the inner half-angle (`penumbra` = 1 − inner/outer). */
export function threeConeFactor(l: Pick<CreatorLight, "outer" | "inner">, cone: ConeReading, cosAngle: number): number {
  const h = halfAngles(l, cone);
  const co = Math.cos(h.outer * RAD), ci = Math.cos(h.inner * RAD);
  if (ci <= co) return cosAngle >= co ? 1 : 0;
  const t = saturate((cosAngle - co) / (ci - co));
  return t * t * (3 - 2 * t);
}

/**
 * The cone fold: the engine's cone (`coneFactor`) over Three's smoothstep at the head point, as an intensity factor, so each preview
 * light has the engine form's strength at the face (like the linear-falloff fold). 1 where Three's cone misses the head. Within a
 * few degrees of the head the two shapes agree; this corrects the lights aimed 10–25° off it.
 */
export function coneFold(l: CreatorLight, cone: ConeReading, head: Vec3): number {
  const cos = dot(normalise(sub(head, l.position)), normalise(l.axis));
  const three = threeConeFactor(l, cone, cos);
  return three > 1e-3 ? coneFactor(l, cone, cos) / three : 1;
}

/** sRGB 8-bit to linear (unset colour = white). */
export function lightColourLinear(colour: Rgb8 | null): Vec3 {
  if (!colour) return [1, 1, 1];
  const decode = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return [decode(colour[0]), decode(colour[1]), decode(colour[2])];
}

/** Parameters for one Three `SpotLight`, in the Studio frame. */
export type SpotLightSpec = {
  readonly name: string;
  readonly position: Vec3;
  readonly target: Vec3;
  /** Linear-light colour. */
  readonly colour: Vec3;
  /** Candela, including the linear-falloff and cone folds and the calibration gain. */
  readonly intensity: number;
  readonly decay: number;
  readonly distance: number;
  /** Three's half-angle in radians and penumbra fraction. */
  readonly angle: number;
  readonly penumbra: number;
  readonly falloff: LightFalloff;
  /** Whether it casts a shadow map onto the V (`creatorShadowCasters`). */
  readonly castShadow: boolean;
};

/**
 * Three parameters for a rig light (knowledge §7, §12). Inverse-square lights are Three's physical falloff
 * (`decay` 2, `distance` = radius), which matches the decoded form exactly. Three has no linear falloff, so
 * a linear light gets `decay` 0, `distance` 0 and its intensity multiplied by `1 − d/r` measured to the
 * head point (within a few percent across the head for these distances). The cone fold does the same for the engine's cone shape,
 * and the calibration gain comes last.
 */
export function spotLightSpec(l: CreatorLight, options: Pick<CreatorLightingOptions, "intensity" | "cone">, head: Vec3, castShadow = false): SpotLightSpec {
  const h = halfAngles(l, options.cone);
  const candela = lumensToCandela(l, options.intensity, options.cone);
  const linear = l.falloff === "linear";
  const fold = linear ? linearFalloff(length(sub(head, l.position)), l.radius) : 1;
  return Object.freeze({
    name: l.name, position: l.position,
    target: [l.position[0] + l.axis[0], l.position[1] + l.axis[1], l.position[2] + l.axis[2]] as Vec3,
    colour: lightColourLinear(l.colour), intensity: candela * fold * coneFold(l, options.cone, head) * calibrationGain(l.name),
    decay: linear ? 0 : 2, distance: linear ? 0 : l.radius,
    angle: h.outer * RAD, penumbra: h.outer > 0 ? saturate(1 - h.inner / h.outer) : 0, falloff: l.falloff, castShadow,
  });
}

export function creatorRigSpecs(sex: BodySex, options: Pick<CreatorLightingOptions, "intensity" | "cone"> & { shadows?: boolean }): SpotLightSpec[] {
  const head = CREATOR_HEAD_SLOT[sex], casters = new Set(options.shadows ? creatorShadowCasters(sex, options) : []);
  return CREATOR_RIGS[sex].map(l => spotLightSpec(l, options, head, casters.has(l.name)));
}

/**
 * Shadows (knowledge §12). The resource flags which lights shadow: `enableLocalShadows` (shadow maps) and `contactShadows`
 * (`CSR_CharacterOnly`: screen-space, character only). The preview gives both kinds one shadow map each, scoped to the V's head and
 * shoulders. Each map costs a texture unit in every lit material, so at most `budget` lights cast: the character-only contact lights
 * first (the designers flagged them for the character), then the shadow-map lights by their strength at the head.
 */
export const CREATOR_SHADOW = Object.freeze({
  budget: 6,
  /** Radius (m) around the head slot that each shadow map covers: head, neck and the tops of the shoulders. */
  focusRadius: 0.45,
  /** Penumbra width (m) at the receiver: source radius 0.1 m at about 1 m over a nose-to-cheek gap of 2–3 cm [hypothesis]. */
  penumbra: 0.003,
  /** Depth bias, and normal bias in metres, against acne on skin at these map densities. */
  bias: -0.0002,
  normalBias: 0.0015,
});
export function creatorShadowCasters(sex: BodySex, options: Pick<CreatorLightingOptions, "intensity" | "cone">): string[] {
  const head = CREATOR_HEAD_SLOT[sex], strength = (l: CreatorLight) => contribution(l, options, head).illuminance;
  const flagged = CREATOR_RIGS[sex].filter(l => (l.shadows || l.contactShadows) && strength(l) > 0);
  const contact = flagged.filter(l => l.contactShadows).sort((a, b) => strength(b) - strength(a));
  const maps = flagged.filter(l => !l.contactShadows).sort((a, b) => strength(b) - strength(a));
  return [...contact, ...maps].slice(0, CREATOR_SHADOW.budget).map(l => l.name);
}
/** Shadow-map size for a preview quality (the generated-texture size): the map follows it, from 512 up to 2048. */
export function creatorShadowMapSize(textureSize: number): number {
  return Math.min(2048, Math.max(512, 2 ** Math.round(Math.log2(Math.max(1, textureSize)))));
}
/** PCF filter radius in shadow-map texels that gives `CREATOR_SHADOW.penumbra` at the head. */
export const creatorShadowRadius = (mapSize: number) => CREATOR_SHADOW.penumbra * mapSize / (2 * CREATOR_SHADOW.focusRadius);

/** One light's illuminance at a point (no Lambert term), under the engine-form cone and the decoded falloff. */
export function contribution(l: CreatorLight, options: Pick<CreatorLightingOptions, "intensity" | "cone">, point: Vec3): { illuminance: number; falloff: number; cone: number } {
  const toPoint = sub(point, l.position), d = length(toPoint);
  const att = falloff(l, d), c = coneFactor(l, options.cone, dot(normalise(toPoint), normalise(l.axis)));
  return { illuminance: lumensToCandela(l, options.intensity, options.cone) * att * c, falloff: att, cone: c };
}

/** Linear RGB irradiance on a surface with normal `n` at `point` (Lambert-weighted sum over the rig). */
export function rigIrradiance(sex: BodySex, options: Pick<CreatorLightingOptions, "intensity" | "cone">, point: Vec3, normal: Vec3): Vec3 {
  const n = normalise(normal), total = [0, 0, 0];
  for (const l of CREATOR_RIGS[sex]) {
    const lambert = Math.max(0, dot(n, normalise(sub(l.position, point))));
    if (!lambert) continue;
    const e = contribution(l, options, point).illuminance * lambert, c = lightColourLinear(l.colour);
    for (let i = 0; i < 3; i++) total[i] += e * c[i]!;
  }
  return total as unknown as Vec3;
}

/** Rec. 709 luminance of linear RGB. */
export const luminance = (rgb: Vec3 | readonly number[]) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;

/**
 * The exposure that maps a front-facing forehead of the given linear albedo to scene value `grey` under the
 * default rig: k = grey / (albedo · E / π). Used to pin DEFAULT_CREATOR_EXPOSURE; the capture fits the real k.
 */
export function defaultCreatorExposure(albedo = 0.35, grey = 0.18, sex: BodySex = "female"): number {
  const head = CREATOR_HEAD_SLOT[sex];
  const forehead: Vec3 = [head[0], head[1] + 0.06, head[2] - 0.09];
  const e = luminance(rigIrradiance(sex, DEFAULT_CREATOR_LIGHTING, forehead, [0, 0.35, -1]));
  return grey / (albedo * e / Math.PI);
}

/** The viewport's lighting presets: the ordinary studio stage (default) or the game's creator screen. */
export type LightingPreset = "studio" | "creator";
export const LIGHTING_PRESETS: readonly LightingPreset[] = Object.freeze(["studio", "creator"]);
export const DEFAULT_LIGHTING_PRESET: LightingPreset = "studio";
