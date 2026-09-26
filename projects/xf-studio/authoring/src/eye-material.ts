/**
 * The game's eye materials for the browser renderer (knowledge/eye-rendering.md): the eyeball of `eye.mt` and
 * `eye_gradient.mt`, and the wetness shell of `eye_shadow.mt`. Both follow the decompiled 2.31 programs
 * (research/materials/shader-eye.md, "the eye reference" below); nothing here names a mod, a colour choice or a texture file.
 *
 * Eyeball, surface (eye reference §5) [observed in the compiled programs unless marked]:
 * - side and fold (§5.1): raw U > 0 takes the "Right" parameters; the folded U puts the pupil at 0.5 on both eyes;
 * - the analytic iris weight in mesh UV (§5.2), 1 inside radius 0.145 and 0 beyond 0.185 with the vanilla scalars;
 * - the refracted/parallax iris coordinate (§5.3): the view ray refracted into the eye's own frame meets a plane
 *   `EyeParallaxPlane` from the centre of a virtual sphere of `EyeRadius`, scaled by `IrisSize/(2·EyeRadius)` (the 9 %
 *   magnification is that scale, not the bending); colour, iris normal and mask are sampled there, V-flipped outside the iris;
 *   the plane's second axis follows the mesh's bitangent (`IRIS_PLANE_ORIENTATION`), so the iris is not mirrored against the sclera;
 * - the iris normal N2 (§5.4) from `Normal` at that coordinate, and the cornea normal N1 (§5.5), an analytic bulge inside the
 *   iris blended into the `NormalBubble` ripple outside it;
 * - `eye_gradient.mt`: base colour `lerp(Albedo, Gradient(IrisMask.R), IrisMask.A)` in linear light (§5.6), the ramp baked from
 *   the resolved `CGradient` stops [bake: hypothesis];
 * - roughness `RoughnessScale · Roughness.R` at the raw UV, neither refracted nor flipped (§5.7), on by default; metalness
 *   `saturate(Specularity)`.
 * Gamma-flagged data textures (`IrisMask`, and a gamma-flagged `Normal` such as Rebecca's) are read raw by default
 * (`IRIS_MASK_ENCODING`); in-game test ask 9 settles raw against decoded (§4).
 *
 * Eyeball, light (eye reference §6): the Eye class's own BRDF replaces Three's direct light: Lambert on N2, one GGX lobe on N1
 * with roughness clamped to [0.04, 1], the eye visibility `0.25/((N1·V + N2·L)(1 − α/2) + α)`, the exp2 Fresnel and no N·L on
 * the specular (§6.1); directional lights (the sun's role) are cut where `L·N2 < 1e-4` (§6.2). Ambient light reaches the eye on
 * N1 (Three's environment and probes, which the Studio stage supplies) and is scaled by 1 + `EYE_AMBIENT_BOOST` (§6.3); there is
 * no subsurface term (§6.4).
 *
 * The per-eye engine vectors the program turns by `EyeHorizAngle*` (§5.3, §11 question 2) are not material data. The preview takes
 * them from the eyeball geometry (`eyeAxes`): the eyes' shared forward (the mean of the two pupils' normals) and the line between
 * the pupils as the lateral vector, skinned with each eye so gaze turns them. On the vanilla meshes each pupil points 3.6° outward
 * of that forward, which is exactly the circle designs' `EyeHorizAngle` of ±3.6; the default ±5 then turns each iris axis outward
 * (`EYE_AXIS_TURN`, [hypothesis], in-game test ask 10).
 *
 * Wetness shell (§7) [observed]: a forward pass after the opaque eye, skin and makeup, blending `out.rgb + dst·alpha`
 * with `alpha = saturate(1 + shadow·(lum − 1))`, `shadow = saturate(Intensity·R^Exponent)`, `lum` the mean of the
 * decoded `ShadowColor`, and a GGX highlight at roughness `clamp(WetnessRoughness·G, 0.04, 1)` on the vertex normal,
 * with the eye's visibility term, no Fresnel, no N·L and no environment, scaled by `WetnessStrength·B`. Both lighting
 * presets blend it in the display's scene-linear target (linear-display.ts), where it is exact; only a GPU without a
 * renderable half-float buffer draws the studio stage straight to the canvas, where it multiplies tone-mapped colour.
 */
import * as THREE from "three";
import type { RenderChunkMaterial, RenderGradientStop } from "./render-detail";

/** How a gamma-flagged eye data texture reaches the program: raw bytes (default) or sRGB-decoded like colour textures. */
export type IrisMaskEncoding = "raw" | "decoded";
/**
 * Internal switch until in-game test ask 9 settles it (knowledge/eye-rendering.md §2.3). It covers every gamma-flagged data texture
 * the eye reads: the iris mask and a `Normal` stored as a gamma colour texture (eye reference §4).
 */
export const IRIS_MASK_ENCODING: IrisMaskEncoding = "raw";
/** The preview's earlier flat eye roughness: used when the eye's own roughness is off, or when the eye has no readable map. */
export const EYE_FLAT_ROUGHNESS = 0.18;
/** Ramp width for a baked `CGradient` (texels at their centres, linear filtering between them). */
export const GRADIENT_RAMP_SIZE = 256;
/** Which way `EyeHorizAngle*` turns each iris axis: outward (away from the nose) or inward. In-game test ask 10 settles it. */
export type EyeAxisTurn = "outward" | "inward";
/**
 * Outward by default [hypothesis]: with it the circle designs' ±3.6° puts their axis exactly on the vanilla meshes' pupils (each
 * 3.6° outward of the eyes' shared forward), which a concentric design needs; inward would put it 7° off.
 */
export const EYE_AXIS_TURN: EyeAxisTurn = "outward";
/**
 * The ambient pass multiplies an Eye pixel's whole indirect light by 1 + `cb6[9].w` [observed]. 0.1 is the vanilla value of the
 * `Editor/Characters/Eyes` `DiffuseBoost` option, which matches that register by role [hypothesis for the pairing] (eye reference §6.3).
 */
export const EYE_AMBIENT_BOOST = 0.1;
/**
 * How the iris plane's second axis is oriented. The program builds it as `S = T2 × A` (§5.3). On the exported eye mesh that axis runs
 * opposite to the mesh's own bitangent (B = cross(N, T)·w, towards decreasing V), so taken literally the iris is drawn mirrored in V
 * against the sclera around it, and across the limbus blend the coordinate sweeps through the pupil, drawing dark arcs at the top and
 * bottom of the iris. In game the iris is not mirrored: the CCXL eye guide's in-game image shows an iris whose brown half is up in
 * the texture drawn with it down, as the V-flipped mesh coordinate draws it [wiki: ccxl-eye-textures.md, `inverted_y_03.png`].
 * "as-mesh" (the default) therefore orients S along the mesh's bitangent; "literal" keeps `T2 × A`. Why the exported frame and the
 * engine's differ here (the per-eye engine vectors' convention, the engine's tangent stream) is not established [hypothesis].
 */
export type IrisPlaneOrientation = "as-mesh" | "literal";
export const IRIS_PLANE_ORIENTATION: IrisPlaneOrientation = "as-mesh";
/** How far (folded UV) the nearest vertex may lie from an eye's pupil at (0.5, 0.5) for `eyeAxes` to take it as the pupil. */
export const EYE_PUPIL_TOLERANCE = 0.05;

/** `eye.mt` / `eye_gradient.mt` 2.31 template defaults the preview reads [resource]; the record normally carries them already. */
export const EYE_TEMPLATE_DEFAULTS = Object.freeze({
  RoughnessScale: 0.493420988, Specularity: 0,
  RefractionIndex: 0.970000029, RefractionAmount: 1, IrisSize: 0.737374008, EyeRadius: 0.0152000003, EyeParallaxPlane: 0.0133999996,
  EyeHorizAngleRight: 5, EyeHorizAngleLeft: -5, BubbleNormalTile: 0.631313026, EggFullRadius: 1, EggMarginExponent: 1,
  EggMarginFactor: 0.400000006, EggSubFactor: 0.200000003, IrisCoordFactor: 0.164983004, IrisCoordMargin: 0.0202019997,
});
/** `eye_shadow.mt` 2.31 template defaults [resource]. */
export const SHELL_TEMPLATE_DEFAULTS = Object.freeze({ Intensity: 1, Exponent: 2.20000005, WetnessRoughness: 1, WetnessStrength: 4 });
const SHELL_DEFAULT_COLOUR: readonly number[] = [255, 0, 0, 233];

export type EyeOptics = Record<Exclude<keyof typeof EYE_TEMPLATE_DEFAULTS, "RoughnessScale" | "Specularity">, number>;
export type EyeParameters = {
  roughnessScale: number;
  /** `saturate(Specularity)`, the metalness slot. */
  metalness: number;
  /** The optics scalars (effective values): refraction, iris disc, cornea bulge and the per-eye turn. */
  optics: EyeOptics;
};
export type ShellParameters = { intensity: number; exponent: number; shadowColor: [number, number, number];
  /** `dot(pow(ShadowColor/255, 2.2), 0.33)`: only the colour's mean reaches the program. */
  luminance: number; wetnessRoughness: number; wetnessStrength: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const srgbToLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
function scalars<T extends Record<string, number>>(chunk: Pick<RenderChunkMaterial, "scalars">, defaults: T): T {
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const value = chunk.scalars[name];
    return [name, typeof value === "number" && Number.isFinite(value) ? value : fallback];
  })) as T;
}

export function eyeParameters(chunk: Pick<RenderChunkMaterial, "scalars">): EyeParameters {
  const { RoughnessScale, Specularity, ...optics } = scalars(chunk, EYE_TEMPLATE_DEFAULTS);
  return { roughnessScale: Math.max(0, RoughnessScale), metalness: clamp01(Specularity), optics };
}

export function shellLuminance(colour: readonly number[]): number {
  return [0, 1, 2].reduce((sum, k) => sum + ((colour[k] ?? 0) / 255) ** 2.2, 0) * 0.33;
}

export function shellParameters(chunk: Pick<RenderChunkMaterial, "scalars" | "colours">): ShellParameters {
  const values = scalars(chunk, SHELL_TEMPLATE_DEFAULTS);
  const colour = chunk.colours.ShadowColor ?? SHELL_DEFAULT_COLOUR;
  return { intensity: values.Intensity, exponent: values.Exponent, shadowColor: [colour[0]!, colour[1]!, colour[2]!],
    luminance: shellLuminance(colour), wetnessRoughness: values.WetnessRoughness, wetnessStrength: values.WetnessStrength };
}

/** What the shell multiplies the pixels behind it by, for a mask R in 0–1 (no fog). */
export function shellAlpha(maskR: number, p: Pick<ShellParameters, "intensity" | "exponent" | "luminance">): number {
  const shadow = clamp01(p.intensity * Math.max(0, maskR) ** p.exponent);
  return clamp01(1 + shadow * (p.luminance - 1));
}
/** The shell's wet roughness for a mask G in 0–1. */
export const shellRoughness = (maskG: number, p: Pick<ShellParameters, "wetnessRoughness">) => Math.min(1, Math.max(0.04, p.wetnessRoughness * maskG));
/** The shell's highlight for one light: GGX D times the eye's visibility, no Fresnel and no N·L (the shader's `RE_Direct`). */
export function shellSpecular(dotNH: number, dotNV: number, dotNL: number, roughness: number): number {
  const a = roughness * roughness, a2 = a * a, d = dotNH * dotNH * (a2 - 1) + 1;
  return (a2 / (Math.PI * d * d)) * (0.25 / ((Math.max(0, dotNV) + Math.max(0, dotNL)) * (1 - a / 2) + a));
}

/**
 * The eye program's sampling rule for one raw UV0: which eye's parameters apply (raw U > 0 → "right"), the colour,
 * normal and mask coordinate outside the iris (folded U, flipped V) and the roughness coordinate (the raw UV itself).
 */
export function eyeSampleCoordinates(u: number, v: number): { side: "right" | "left"; colour: [number, number]; roughness: [number, number] } {
  const right = u > 0;
  return { side: right ? "right" : "left", colour: [u + (right ? -1 : 1), 1 - v], roughness: [u, v] };
}

// ---- The eye program's arithmetic, as TypeScript twins of the GLSL below (tests compare both with the reference). ----

export type Vec3 = readonly [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return l > 0 ? scale(a, 1 / l) : [0, 0, 0]; };

/** §5.2: the analytic iris weight at mesh-UV radius `r` from the pupil: 1 inside `factor − margin`, 0 beyond `factor + margin`. */
export const eyeIrisWeight = (r: number, factor: number = EYE_TEMPLATE_DEFAULTS.IrisCoordFactor, margin: number = EYE_TEMPLATE_DEFAULTS.IrisCoordMargin) =>
  clamp01(1 - (r - (factor - margin)) / (2 * margin));

/** HLSL's (and GLSL's) `refract`: `eta·I − (eta·(N·I) + √k)·N`, zero on total internal reflection. */
export function refract(i: Vec3, n: Vec3, eta: number): Vec3 {
  const d = dot(n, i), k = 1 - eta * eta * (1 - d * d);
  if (k < 0) return [0, 0, 0];
  return sub(scale(i, eta), scale(n, eta * d + Math.sqrt(k)));
}

/** §5.3: the eye's optical axis `cos(a)·forward + sin(a)·lateral`, `a = −EyeHorizAngle·π/180`. */
export function eyeOpticalAxis(forward: Vec3, lateral: Vec3, angleDegrees: number): Vec3 {
  const a = -angleDegrees * Math.PI / 180;
  return add(scale(forward, Math.cos(a)), scale(lateral, Math.sin(a)));
}

/**
 * §5.3: where the view ray, refracted at the virtual cornea, meets the iris plane, in iris UV. `view` is the unit vector from the
 * camera to the surface point, `normal` and `tangent` the interpolated vertex frame, `axis` the optical axis. The frame is
 * {T2, A, S} with `T2 = normalize(T − (T·A)A)` and `S = T2 × A`; the height above the plane is `EyeRadius·(N·A) − EyeParallaxPlane`.
 * With a `bitangent` (the "as-mesh" orientation, `IRIS_PLANE_ORIENTATION`) S is turned to point along it.
 */
export function irisPlaneCoordinate(view: Vec3, normal: Vec3, tangent: Vec3, axis: Vec3, optics: Pick<EyeOptics,
  "RefractionIndex" | "RefractionAmount" | "IrisSize" | "EyeRadius" | "EyeParallaxPlane">, bitangent?: Vec3): { uv: [number, number]; height: number; refracted: Vec3 } {
  const t2 = normalize(sub(tangent, scale(axis, dot(tangent, axis))));
  const literal = cross(t2, axis);
  const s = bitangent && dot(literal, bitangent) < 0 ? scale(literal, -1) : literal;
  const il: Vec3 = [dot(view, t2), dot(view, axis), dot(view, s)], nl: Vec3 = [dot(normal, t2), dot(normal, axis), dot(normal, s)];
  const r = refract(il, nl, optics.RefractionIndex);
  const height = Math.max(0, optics.EyeRadius * dot(normal, axis) - optics.EyeParallaxPlane);
  const depth = optics.RefractionAmount * height / Math.max(1e-4, Math.abs(r[1]));
  const k = optics.IrisSize / (2 * optics.EyeRadius);
  return { uv: [0.5 + (r[0] * depth + optics.EyeRadius * nl[0]) * k, 0.5 + (r[2] * depth + optics.EyeRadius * nl[2]) * k], height, refracted: r };
}

/**
 * §5.1–5.3 for one fragment: the side, the iris weight and the coordinate colour, iris normal and mask are sampled at
 * (`lerp((fold(u), 1 − v), iris plane, iris)`). `forward` and `lateral` are the eye's engine vectors (here from `eyeAxes`).
 */
export function eyeColourCoordinate(input: { uv: readonly [number, number]; normal: Vec3; tangent: Vec3; view: Vec3; forward: Vec3; lateral: Vec3;
  optics: EyeOptics; bitangent?: Vec3 }): { side: "right" | "left"; uv: [number, number]; iris: number; height: number } {
  const [u, v] = input.uv, { optics } = input;
  const side = u > 0 ? "right" : "left", fu = u + (u > 0 ? -1 : 1);
  const iris = eyeIrisWeight(Math.hypot(fu - 0.5, 0.5 - v), optics.IrisCoordFactor, optics.IrisCoordMargin);
  const axis = eyeOpticalAxis(input.forward, input.lateral, side === "right" ? optics.EyeHorizAngleRight : optics.EyeHorizAngleLeft);
  const plane = irisPlaneCoordinate(input.view, input.normal, input.tangent, axis, optics, input.bitangent);
  return { side, iris, height: plane.height, uv: [fu + (plane.uv[0] - fu) * iris, 1 - v + (plane.uv[1] - (1 - v)) * iris] };
}

/** A normal texel's stored R and G (0–1) as the program unpacks them: `xy = 2·RG − 1`, `z = √max(0, 1 − x² − y²)`, no Y flip. */
export function unpackNormalRG(r: number, g: number): Vec3 {
  const x = 2 * r - 1, y = 2 * g - 1;
  return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
}

/**
 * §5.5: the cornea normal N1 in tangent space at the folded offset `d = (fu − 0.5, 0.5 − v)` (radius `r = |d|`): inside
 * `EggFullRadius` the analytic bulge `normalize(q·(E/|q|) − q)` with `q = (d, E·EggSubFactor)`, its z raised by 0.5 after
 * normalising, its xy damped by `saturate(1 − EggMarginFactor·r/√(E² − s²))^EggMarginExponent`; blended by `1 − iris` into the
 * unpacked `NormalBubble` texel.
 */
export function corneaNormal(d: readonly [number, number], bubble: Vec3, iris: number,
  optics: Pick<EyeOptics, "EggFullRadius" | "EggMarginExponent" | "EggMarginFactor" | "EggSubFactor">): Vec3 {
  const full = optics.EggFullRadius, s = full * optics.EggSubFactor, r = Math.hypot(d[0], d[1]);
  const q: Vec3 = [d[0], d[1], s], length = Math.hypot(...q);
  let e: Vec3 = [0, 0, 1.5];
  if (full * s / length > s) {
    const k = normalize(sub(scale(q, full / length), q));
    e = [k[0], k[1], k[2] + 0.5];
  }
  const margin = clamp01(1 - optics.EggMarginFactor * r / Math.sqrt(full * full - s * s)) ** optics.EggMarginExponent;
  const bulge = normalize([e[0] * margin, e[1] * margin, e[2]]);
  return normalize(add(bulge, scale(sub(bubble, bulge), 1 - iris)));
}

/** GGX distribution for `alpha = roughness²` (§6.1). */
export function ggxDistribution(dotNH: number, alpha: number): number {
  const a2 = alpha * alpha, d = dotNH * dotNH * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}
/** The Eye class's visibility: `0.25 / ((N1·V + N2·L)(1 − α/2) + α)` (§6.1). At normal incidence 0.125, half a Standard lobe. */
export const eyeVisibility = (dotN1V: number, dotN2L: number, alpha: number) => 0.25 / ((dotN1V + dotN2L) * (1 - alpha / 2) + alpha);
/** The spherical-Gaussian Schlick approximation the light uses: `F0 + (1 − F0)·2^((−5.55473·VH − 6.98316)·VH)` (§6.1). */
export const eyeFresnel = (f0: number, dotVH: number) => f0 + (1 - f0) * 2 ** ((-5.55473 * dotVH - 6.98316) * dotVH);

/**
 * §6.1: one light on an Eye pixel, per unit light colour: Lambert on the iris normal N2, one GGX lobe on the cornea normal N1
 * (roughness clamped to [0.04, 1], α = r²) with the eye visibility and Fresnel (F0 = lerp(0.04, albedo, metalness)) and no N·L.
 * `sun` applies §6.2's cut: nothing where `L·N2 < 1e-4`.
 */
export function eyeDirectLight(input: { n1: Vec3; n2: Vec3; light: Vec3; view: Vec3; roughness: number; albedo: Vec3; metalness: number; sun?: boolean }):
  { diffuse: [number, number, number]; specular: [number, number, number] } {
  const { n1, n2, light, view, albedo, metalness } = input;
  if (input.sun && dot(n2, light) < 1e-4) return { diffuse: [0, 0, 0], specular: [0, 0, 0] };
  const r = Math.min(1, Math.max(0.04, input.roughness)), alpha = r * r;
  const n2l = clamp01(dot(n2, light)), n1v = Math.min(1, Math.max(1e-5, dot(n1, view)));
  const h = normalize(add(light, view)), n1h = clamp01(dot(n1, h)), vh = clamp01(dot(view, h));
  const lobe = ggxDistribution(n1h, alpha) * eyeVisibility(n1v, n2l, alpha);
  const map = (f: (k: number) => number) => [0, 1, 2].map(f) as [number, number, number];
  return {
    diffuse: map(k => albedo[k]! * (1 - metalness) / Math.PI * n2l),
    specular: map(k => lobe * eyeFresnel(0.04 + (albedo[k]! - 0.04) * metalness, vh)),
  };
}

// ---- The engine's per-eye vectors, from the eyeball geometry. ----

/** A geometry's raw arrays for `eyeAxes`: positions and normals (xyz), raw UV0 (uv). */
export type EyeAxisInput = { position: ArrayLike<number>; normal: ArrayLike<number>; uv: ArrayLike<number> };
export type EyeAxisEvidence = {
  /** Eyeballs whose pupil was found (the nearest vertex within `EYE_PUPIL_TOLERANCE` of the folded (0.5, 0.5)). */
  eyes: number;
  /** Each found pupil's normal against the shared forward, degrees, positive outward (vanilla: 3.6 each). */
  pupilTurn: { right?: number; left?: number };
  /** Whether both eyes gave a lateral vector: with one eye alone the axis is its pupil and `EyeHorizAngle*` turns nothing. */
  lateral: boolean;
  turn: EyeAxisTurn;
};

/**
 * The per-eye forward and lateral vectors the program turns by `EyeHorizAngle*` (§5.3), from the eyeball meshes alone, per vertex
 * in the geometry's own (bind) space. Every vertex carries the same two vectors; the renderer skins them with the vertex, so each
 * eye's copy turns with that eye's joint when it looks around. Each side's pupil is the vertex nearest the folded (0.5, 0.5) on
 * that side of U = 0 (§5.1). With two pupils the forward is their normals' mean (the eyes' shared straight-ahead direction) and
 * the lateral runs from the "Right" eye's pupil (raw U > 0) towards the other's, so a positive
 * `EyeHorizAngleRight` and a negative `EyeHorizAngleLeft` both turn outward (`turn` "inward" reverses it). With one pupil its normal
 * is the forward and there is no lateral; with none every vector is zero and the preview draws the iris unrefracted.
 */
export function eyeAxes(geometries: readonly EyeAxisInput[], turn: EyeAxisTurn = EYE_AXIS_TURN):
  { attributes: { axis: Float32Array; lateral: Float32Array }[]; evidence: EyeAxisEvidence } {
  type Pupil = { distance: number; position: Vec3; normal: Vec3 };
  const pupils: { right?: Pupil; left?: Pupil } = {};
  const at = (a: ArrayLike<number>, i: number, n: number): Vec3 => [a[i * n]!, a[i * n + 1]!, n === 3 ? a[i * n + 2]! : 0];
  for (const g of geometries) {
    const count = Math.min(g.position.length / 3, g.normal.length / 3, g.uv.length / 2);
    for (let i = 0; i < count; i++) {
      const u = g.uv[i * 2]!, v = g.uv[i * 2 + 1]!, side = u > 0 ? "right" : "left";
      const distance = Math.hypot(u + (u > 0 ? -1 : 1) - 0.5, v - 0.5);
      if (distance > EYE_PUPIL_TOLERANCE || (pupils[side] && pupils[side]!.distance <= distance)) continue;
      pupils[side] = { distance, position: at(g.position, i, 3), normal: normalize(at(g.normal, i, 3)) };
    }
  }
  const { right, left } = pupils;
  const found = [right, left].filter((p): p is Pupil => !!p);
  const forward: Vec3 = found.length ? normalize(found.reduce<Vec3>((sum, p) => add(sum, p.normal), [0, 0, 0])) : [0, 0, 0];
  let lateral: Vec3 = [0, 0, 0];
  if (right && left) {
    const across = sub(left.position, right.position);
    lateral = normalize(sub(across, scale(forward, dot(across, forward))));
    if (turn === "inward") lateral = scale(lateral, -1);
  }
  const outward = (p: Pupil | undefined, sign: number) => {
    if (!p || !right || !left) return undefined;
    const towardsOther = normalize(sub(sign > 0 ? left.position : right.position, p.position));
    const angle = Math.acos(Math.min(1, dot(p.normal, forward))) * 180 / Math.PI;
    return dot(sub(p.normal, forward), towardsOther) > 0 ? -angle : angle;
  };
  const attributes = geometries.map(g => {
    const count = g.position.length / 3, axis = new Float32Array(count * 3), across = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { axis.set(forward, i * 3); across.set(lateral, i * 3); }
    return { axis, lateral: across };
  });
  return { attributes, evidence: { eyes: found.length, pupilTurn: { ...(right && left ? { right: outward(right, 1), left: outward(left, -1) } : {}) },
    lateral: !!(right && left), turn } };
}

/**
 * Make sure an eyeball geometry carries the frame the program uses: the exported tangent with its sign (B = cross(N, T)·w points
 * towards decreasing V, the game's "green up" convention, as the exported eye meshes carry it), or one computed from the UVs
 * with Three's sign reversed to match. Returns where it came from; a geometry that can't have one draws through the shader's
 * derivative frame, which follows the same convention.
 */
export function ensureEyeTangents(geometry: THREE.BufferGeometry): "exported" | "computed" | "none" {
  if (geometry.getAttribute("tangent")) return "exported";
  if (!geometry.index || !geometry.getAttribute("position") || !geometry.getAttribute("normal") || !geometry.getAttribute("uv")) return "none";
  geometry.computeTangents();
  const tangent = geometry.getAttribute("tangent") as THREE.BufferAttribute;
  // Three's sign makes cross(N, T)·w follow increasing V; the game's follows decreasing V.
  for (let i = 0; i < tangent.count; i++) tangent.setW(i, -tangent.getW(i));
  tangent.needsUpdate = true;
  return "computed";
}

/**
 * Prepare the eyeball geometries of one eye component (or the core eye) for the eye material: the tangent frame and the per-eye
 * vectors (`xfsEyeAxis`, `xfsEyeLateral`). Idempotent per geometry; the evidence lands in each geometry's `userData.xfsEyeAxes`.
 */
export function prepareEyeballGeometry(geometries: readonly THREE.BufferGeometry[], turn: EyeAxisTurn = EYE_AXIS_TURN): EyeAxisEvidence & { tangents: string[] } {
  const usable = geometries.filter(g => g.getAttribute("position") && g.getAttribute("normal") && g.getAttribute("uv"));
  const tangents = usable.map(ensureEyeTangents);
  const array = (g: THREE.BufferGeometry, name: string) => {
    const attribute = g.getAttribute(name) as THREE.BufferAttribute;
    const size = attribute.itemSize, out = new Float32Array(attribute.count * size);
    for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attribute.getComponent(i, k);
    return out;
  };
  const { attributes, evidence } = eyeAxes(usable.map(g => ({ position: array(g, "position"), normal: array(g, "normal"), uv: array(g, "uv") })), turn);
  usable.forEach((g, i) => {
    g.setAttribute("xfsEyeAxis", new THREE.BufferAttribute(attributes[i]!.axis, 3));
    g.setAttribute("xfsEyeLateral", new THREE.BufferAttribute(attributes[i]!.lateral, 3));
    g.userData.xfsEyeAxes = { ...evidence, tangents: tangents[i] };
  });
  return { ...evidence, tangents };
}

// ---- Gradient eyes. ----

/** A `CGradient`'s 8-bit colour at `t`: linear between the stops around it, clamped to the end stops (stops sorted by value). */
export function gradientColourAt(stops: readonly RenderGradientStop[], t: number): [number, number, number, number] {
  if (!stops.length) return [0, 0, 0, 255];
  const first = stops[0]!, last = stops[stops.length - 1]!;
  if (t <= first.value) return [...first.color];
  if (t >= last.value) return [...last.color];
  const next = stops.findIndex(stop => stop.value >= t);
  const a = stops[next - 1]!, b = stops[next]!, span = b.value - a.value;
  const f = span > 0 ? (t - a.value) / span : 1;
  return [0, 1, 2, 3].map(k => a.color[k]! + (b.color[k]! - a.color[k]!) * f) as [number, number, number, number];
}

/** The baked ramp: RGBA bytes, texel `i` holding the gradient at its centre `(i + 0.5) / size`. */
export function bakeGradientRamp(stops: readonly RenderGradientStop[], size = GRADIENT_RAMP_SIZE): Uint8Array {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const colour = gradientColourAt(stops, (i + 0.5) / size);
    for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.round(Math.min(255, Math.max(0, colour[k]!)));
  }
  return out;
}

/** The gradient coordinate from the mask's stored R (0–1) under an encoding. */
export const irisCoordinate = (maskR: number, encoding: IrisMaskEncoding = IRIS_MASK_ENCODING) =>
  encoding === "raw" ? clamp01(maskR) : srgbToLinear(clamp01(maskR));

/**
 * The linear base colour of one `eye_gradient.mt` texel: the (linear) albedo, the ramp at the mask's R, blended by
 * the mask's A. Mirrors the shader and its baked ramp.
 */
export function irisBaseColour(albedo: readonly number[], maskR: number, maskA: number, stops: readonly RenderGradientStop[],
  encoding: IrisMaskEncoding = IRIS_MASK_ENCODING): [number, number, number] {
  const ramp = gradientColourAt(stops, irisCoordinate(maskR, encoding));
  return [0, 1, 2].map(k => {
    const g = srgbToLinear(ramp[k]! / 255);
    return albedo[k]! + (g - albedo[k]!) * clamp01(maskA);
  }) as [number, number, number];
}

/** The ramp as a texture the sampler decodes from sRGB, linear filtering, clamped at the ends. */
export function gradientTexture(stops: readonly RenderGradientStop[]): THREE.DataTexture {
  const texture = new THREE.DataTexture(bakeGradientRamp(stops), GRADIENT_RAMP_SIZE, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.name = "xfs_iris_gradient";
  texture.needsUpdate = true;
  return texture;
}

export type EyeballHandle = {
  readonly role: "eyeball";
  readonly parameters: EyeParameters;
  /** Whether the iris colour comes from a gradient ramp (`eye_gradient.mt`). */
  readonly gradient: boolean;
  /** Whether a source roughness map is bound (the switch has no effect without one). */
  readonly hasSourceRoughness: boolean;
  readonly sourceRoughness: boolean;
  /** Source roughness R × `RoughnessScale` (the default), or the flat preview roughness. */
  setSourceRoughness(enabled: boolean): void;
};
export type EyeShellHandle = { readonly role: "shell"; readonly parameters: ShellParameters };
export type EyeHandle = EyeballHandle | EyeShellHandle;

// ---- The eyeball's shader. ----

/**
 * The program's arithmetic as GLSL functions (fragment scope, after Three's `common`), shared by the eyeball material and the
 * GPU probe (tests/webgl-eye-probe-page.ts). Each cites the eye reference section it follows.
 */
export const EYE_GLSL_FUNCTIONS = /* glsl */`
// §5.2: the analytic iris weight at mesh-UV radius r.
float xfsEyeIrisWeight( const in float r, const in float factor, const in float margin ) {
	return saturate( 1.0 - ( r - ( factor - margin ) ) / ( 2.0 * margin ) );
}
// §5.3: the refracted view ray meets the iris plane; optics = (RefractionIndex, RefractionAmount, IrisSize, EyeRadius). With alongB 1
// the second axis S = T2 × A is turned to point along the mesh's bitangent b (IRIS_PLANE_ORIENTATION "as-mesh"); 0 keeps it literal.
vec2 xfsEyeIrisPlane( const in vec3 view, const in vec3 n, const in vec3 t, const in vec3 b, const in vec3 axis, const in vec4 optics, const in float plane,
		const in float alongB ) {
	vec3 t2 = normalize( t - dot( t, axis ) * axis );
	vec3 s = cross( t2, axis );
	s *= alongB > 0.5 && dot( s, b ) < 0.0 ? -1.0 : 1.0;
	vec3 il = vec3( dot( view, t2 ), dot( view, axis ), dot( view, s ) );
	vec3 nl = vec3( dot( n, t2 ), dot( n, axis ), dot( n, s ) );
	vec3 r = refract( il, nl, optics.x );
	float height = max( 0.0, optics.w * dot( n, axis ) - plane );
	float depth = optics.y * height / max( 1e-4, abs( r.y ) );
	return 0.5 + ( r.xz * depth + optics.w * nl.xz ) * optics.z / ( 2.0 * optics.w );
}
// A normal texel: xy = 2·RG − 1, z reconstructed, no Y flip (§4).
vec3 xfsEyeUnpack( const in vec4 texel ) {
	vec2 xy = texel.xy * 2.0 - 1.0;
	return vec3( xy, sqrt( max( 1.0 - dot( xy, xy ), 0.0 ) ) );
}
// §5.5: the cornea normal N1 in tangent space; egg = (EggFullRadius, EggMarginExponent, EggMarginFactor, EggSubFactor).
vec3 xfsEyeCornea( const in vec2 d, const in float r, const in vec4 egg, const in vec3 bubble, const in float iris ) {
	float s = egg.x * egg.w;
	vec3 q = vec3( d, s );
	float len = length( q );
	vec3 e = vec3( 0.0, 0.0, 1.5 );
	if ( egg.x * s / len > s ) {
		vec3 k = normalize( q * ( egg.x / len ) - q );
		e = vec3( k.xy, k.z + 0.5 );
	}
	float margin = pow( saturate( 1.0 - egg.z * r / sqrt( egg.x * egg.x - s * s ) ), egg.y );
	e = normalize( vec3( e.xy * margin, e.z ) );
	return normalize( mix( e, bubble, 1.0 - iris ) );
}
// §6.1: the Eye class's BRDF for one light, per unit light colour.
void xfsEyeBRDF( const in vec3 n1, const in vec3 n2, const in vec3 l, const in vec3 v, const in float roughness, const in vec3 albedo,
		const in float metalness, out vec3 diffuse, out vec3 specular ) {
	float r = clamp( roughness, 0.04, 1.0 );
	float a = r * r;
	float a2 = a * a;
	float n2l = saturate( dot( n2, l ) );
	float n1v = clamp( dot( n1, v ), 1e-5, 1.0 );
	vec3 h = normalize( l + v );
	float n1h = saturate( dot( n1, h ) );
	float vh = saturate( dot( v, h ) );
	float d = n1h * n1h * ( a2 - 1.0 ) + 1.0;
	float lobe = a2 / ( PI * d * d ) * 0.25 / ( ( n1v + n2l ) * ( 1.0 - 0.5 * a ) + a );
	float e = exp2( ( -5.55473 * vh - 6.98316 ) * vh );
	vec3 f0 = mix( vec3( 0.04 ), albedo, metalness );
	specular = lobe * ( f0 + ( 1.0 - f0 ) * e );
	diffuse = albedo * ( 1.0 - metalness ) * RECIPROCAL_PI * n2l;
}
`;

const EYE_VERTEX_DECLARATIONS = /* glsl */`
attribute vec3 xfsEyeAxis;
attribute vec3 xfsEyeLateral;
varying vec3 vXfsEyeAxis;
varying vec3 vXfsEyeLateral;
`;
/** The per-eye vectors follow the eye like its normal: skinned (each eye by its own joint), then into view space. */
const EYE_VERTEX_AXIS = /* glsl */`
vec3 xfsAxisObject = xfsEyeAxis, xfsLateralObject = xfsEyeLateral;
#ifdef USE_SKINNING
xfsAxisObject = ( skinMatrix * vec4( xfsAxisObject, 0.0 ) ).xyz;
xfsLateralObject = ( skinMatrix * vec4( xfsLateralObject, 0.0 ) ).xyz;
#endif
vXfsEyeAxis = normalMatrix * xfsAxisObject;
vXfsEyeLateral = normalMatrix * xfsLateralObject;
`;

const EYE_DECLARATIONS = /* glsl */`
uniform sampler2D xfsIrisMask;
uniform sampler2D xfsIrisGradient;
uniform sampler2D xfsEyeRoughness;
uniform sampler2D xfsEyeBubble;
uniform vec3 xfsEyeSurface;
uniform vec4 xfsEyeOptics;
uniform vec4 xfsEyePlane;
uniform vec4 xfsEyeEgg;
uniform vec4 xfsEyeTurn;
uniform float xfsEyeAmbient;
uniform float xfsEyeAlongB;
varying vec3 vXfsEyeAxis;
varying vec3 vXfsEyeLateral;
vec3 xfsEyeN1 = vec3( 0.0, 0.0, 1.0 );
vec3 xfsEyeN2 = vec3( 0.0, 0.0, 1.0 );
vec3 xfsEyeBase = vec3( 0.0 );
float xfsEyeRough = 1.0;
float xfsEyeSunCut = 0.0;
${EYE_GLSL_FUNCTIONS}`;

/** The eyeball's surface (eye reference §5): replaces `map_fragment`; the normals and roughness it leaves are read by later chunks. */
const EYE_SURFACE = /* glsl */`
#ifdef USE_MAP
vec2 xfsEyeUv = vMapUv;
// §5.1 side and fold: raw U > 0 is the "Right" parameter set; the folded U puts the pupil at 0.5 on both eyes.
bool xfsEyeLeft = xfsEyeUv.x <= 0.0;
float xfsEyeFu = xfsEyeUv.x + ( xfsEyeLeft ? 1.0 : -1.0 );
vec2 xfsEyeD = vec2( xfsEyeFu - 0.5, 0.5 - xfsEyeUv.y );
float xfsEyeR = length( xfsEyeD );
// §5.2 the analytic iris weight, in mesh UV.
float xfsEyeIris = xfsEyeIrisWeight( xfsEyeR, xfsEyePlane.z, xfsEyePlane.w );
// The interpolated vertex frame: N, T and B = cross(N, T)·w (towards decreasing V).
vec3 xfsEyeN = normalize( vNormal );
#ifdef USE_TANGENT
vec3 xfsEyeT = normalize( vTangent );
vec3 xfsEyeB = normalize( vBitangent );
#else
vec3 xfsEyeQ0 = dFdx( - vViewPosition ), xfsEyeQ1 = dFdy( - vViewPosition );
vec2 xfsEyeSt0 = dFdx( xfsEyeUv ), xfsEyeSt1 = dFdy( xfsEyeUv );
vec3 xfsEyeQ1p = cross( xfsEyeQ1, xfsEyeN ), xfsEyeQ0p = cross( xfsEyeN, xfsEyeQ0 );
vec3 xfsEyeT = normalize( xfsEyeQ1p * xfsEyeSt0.x + xfsEyeQ0p * xfsEyeSt1.x );
vec3 xfsEyeB = - normalize( xfsEyeQ1p * xfsEyeSt0.y + xfsEyeQ0p * xfsEyeSt1.y );
#endif
// §5.3 the optical axis: the eye's forward turned by EyeHorizAngle about its lateral vector (cos, sin per side in xfsEyeTurn).
float xfsEyeHasAxis = step( 0.25, dot( vXfsEyeAxis, vXfsEyeAxis ) );
vec3 xfsEyeFwd = xfsEyeHasAxis > 0.5 ? normalize( vXfsEyeAxis ) : xfsEyeN;
vec3 xfsEyeLat = vXfsEyeLateral - dot( vXfsEyeLateral, xfsEyeFwd ) * xfsEyeFwd;
xfsEyeLat = dot( xfsEyeLat, xfsEyeLat ) > 1e-6 ? normalize( xfsEyeLat ) : vec3( 0.0 );
vec2 xfsEyeTurnSide = xfsEyeLeft ? xfsEyeTurn.zw : xfsEyeTurn.xy;
vec3 xfsEyeAxisA = normalize( xfsEyeTurnSide.x * xfsEyeFwd + xfsEyeTurnSide.y * xfsEyeLat );
// §5.3 the refracted iris coordinate: the colour, iris normal and mask are sampled there inside the iris, V-flipped outside.
vec3 xfsEyeView = isOrthographic ? vec3( 0.0, 0.0, - 1.0 ) : normalize( - vViewPosition );
vec2 xfsEyeUvI = xfsEyeIrisPlane( xfsEyeView, xfsEyeN, xfsEyeT, xfsEyeB, xfsEyeAxisA, xfsEyeOptics, xfsEyePlane.x, xfsEyeAlongB );
vec2 xfsEyeUvC = mix( vec2( xfsEyeFu, 1.0 - xfsEyeUv.y ), xfsEyeUvI, xfsEyeIris * xfsEyeHasAxis );
// The fold jumps by a whole tile at U = 0 (behind the eye); the raw derivatives keep the mip level continuous.
vec2 xfsEyeDx = dFdx( xfsEyeUv ), xfsEyeDy = dFdy( xfsEyeUv );
vec3 xfsEyeAlbedo = textureGrad( map, xfsEyeUvC, xfsEyeDx, xfsEyeDy ).rgb;
#ifdef XFS_EYE_GRADIENT
// §5.6 the gradient: the ramp at the mask's R, blended over the albedo by its A, in linear light.
vec4 xfsIris = textureGrad( xfsIrisMask, xfsEyeUvC, xfsEyeDx, xfsEyeDy );
vec3 xfsIrisColour = texture2D( xfsIrisGradient, vec2( xfsIris.r, 0.5 ) ).rgb;
xfsEyeAlbedo = mix( xfsEyeAlbedo, xfsIrisColour, xfsIris.a );
#endif
diffuseColor.rgb *= xfsEyeAlbedo;
xfsEyeBase = diffuseColor.rgb;
// §5.4 the iris normal N2: the relief at the refracted coordinate, in the vertex frame.
vec3 xfsEyeRelief = xfsEyeUnpack( textureGrad( normalMap, xfsEyeUvC, xfsEyeDx, xfsEyeDy ) );
xfsEyeN2 = normalize( xfsEyeRelief.x * xfsEyeT + xfsEyeRelief.y * xfsEyeB + xfsEyeRelief.z * xfsEyeN );
// §5.5 the cornea normal N1: the bulge over the iris, the bubble ripple (at BubbleNormalTile·(fold(u), 1 − v)) outside it.
vec3 xfsEyeRipple = xfsEyeUnpack( textureGrad( xfsEyeBubble, xfsEyePlane.y * vec2( xfsEyeFu, 1.0 - xfsEyeUv.y ),
	xfsEyePlane.y * xfsEyeDx, xfsEyePlane.y * xfsEyeDy ) );
vec3 xfsEyeCorneaT = xfsEyeCornea( xfsEyeD, xfsEyeR, xfsEyeEgg, xfsEyeRipple, xfsEyeIris );
xfsEyeN1 = normalize( xfsEyeCorneaT.x * xfsEyeT + xfsEyeCorneaT.y * xfsEyeB + xfsEyeCorneaT.z * xfsEyeN );
#endif
`;

/** §6.1–6.2: the Eye-class light replaces Three's direct light (appended after `lights_physical_pars_fragment`). */
const EYE_LIGHT = /* glsl */`
void RE_Direct_XfsEye( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	// §6.2: the sun's shadow mask is zeroed where L·N2 < 1e-4, removing both terms; Three's directional lights play the sun.
	if ( xfsEyeSunCut > 0.5 && dot( xfsEyeN2, directLight.direction ) < 1e-4 ) return;
	vec3 diffuse, specular;
	xfsEyeBRDF( geometryNormal, xfsEyeN2, directLight.direction, geometryViewDir, xfsEyeRough, xfsEyeBase, material.metalness, diffuse, specular );
	reflectedLight.directDiffuse += directLight.color * diffuse;
	reflectedLight.directSpecular += directLight.color * specular;
}
#undef RE_Direct
#define RE_Direct RE_Direct_XfsEye
`;

const SUN_LOOP = "#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )";
const DIRECTIONAL_LOOP = "#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )";

/** Three's `lights_fragment_begin` with the sun cut switched on before its sun and directional lights (they follow point and spot). */
export function eyeLightsBeginChunk(chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>): string {
  const chunk = chunks.lights_fragment_begin ?? "";
  const marker = chunk.includes(SUN_LOOP) ? SUN_LOOP : DIRECTIONAL_LOOP;
  const directional = chunk.indexOf(DIRECTIONAL_LOOP), start = chunk.indexOf(marker);
  if (directional < 0 || start < 0 || chunk.indexOf("#if ( NUM_SPOT_LIGHTS > 0 )") > start || chunk.indexOf("#if ( NUM_POINT_LIGHTS > 0 )") > start)
    throw Error("The eye shader expects the directional lights after point and spot lights in this Three.js build.");
  return chunk.replace(marker, `xfsEyeSunCut = 1.0;\n${marker}`);
}

/** Patch a `MeshStandardMaterial` program for the eyeball; throws when this Three.js build lacks an expected chunk. */
export function patchEyeShader<T extends { fragmentShader: string; vertexShader?: string }>(shader: T,
  chunks: Record<string, string> = THREE.ShaderChunk as unknown as Record<string, string>): T {
  const replace = (source: string, find: string, by: string) => {
    if (!source.includes(find)) throw Error(`The eye shader expects ${find} in this Three.js build.`);
    return source.replace(find, by);
  };
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>\n${EYE_DECLARATIONS}`);
  fragment = replace(fragment, "#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>\n${EYE_LIGHT}`);
  fragment = replace(fragment, "#include <map_fragment>", EYE_SURFACE);
  // §5.7 roughness at the raw UV (not folded, flipped or refracted) × RoughnessScale, or the flat preview value; metalness = Specularity.
  fragment = replace(fragment, "#include <roughnessmap_fragment>",
    "float roughnessFactor = mix( roughness, texture2D( xfsEyeRoughness, vMapUv ).r * xfsEyeSurface.x, xfsEyeSurface.y );\nxfsEyeRough = roughnessFactor;");
  fragment = replace(fragment, "#include <metalnessmap_fragment>", "float metalnessFactor = xfsEyeSurface.z;");
  // The shading normal is the cornea normal N1: specular, and the ambient light (§6.3), use it; the direct diffuse uses N2.
  fragment = replace(fragment, "#include <normal_fragment_maps>", "#ifdef USE_MAP\nnormal = xfsEyeN1;\n#endif");
  fragment = replace(fragment, "#include <lights_fragment_begin>", eyeLightsBeginChunk(chunks));
  // §6.3 the eye's whole indirect light × (1 + DiffuseBoost).
  fragment = replace(fragment, "#include <lights_fragment_end>",
    "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= xfsEyeAmbient;\nreflectedLight.indirectSpecular *= xfsEyeAmbient;");
  shader.fragmentShader = fragment;
  if (shader.vertexShader !== undefined) {
    let vertex = shader.vertexShader;
    vertex = replace(vertex, "#include <common>", `#include <common>\n${EYE_VERTEX_DECLARATIONS}`);
    // After the normal is skinned (Three's chunk, or extendSkin's replacement of it, both name the matrix `skinMatrix`).
    vertex = replace(vertex, "#include <skinnormal_vertex>", `#include <skinnormal_vertex>\n${EYE_VERTEX_AXIS}`);
    shader.vertexShader = vertex;
  }
  return shader;
}

export type EyeTextures = { albedo: THREE.Texture; roughness?: THREE.Texture; irisMask?: THREE.Texture; gradient?: THREE.Texture;
  /** `Normal`, the iris relief (after the morph's `baseTexture` rule); flat when absent. */
  normal?: THREE.Texture;
  /** `NormalBubble`, the sclera ripple of the cornea normal; flat when absent. */
  bubble?: THREE.Texture };

/** `cos` and `sin` of `a = −EyeHorizAngle·π/180` for the "Right" then the "Left" parameters (§5.3). */
export function eyeTurnUniform(optics: Pick<EyeOptics, "EyeHorizAngleRight" | "EyeHorizAngleLeft">): [number, number, number, number] {
  const right = -optics.EyeHorizAngleRight * Math.PI / 180, left = -optics.EyeHorizAngleLeft * Math.PI / 180;
  return [Math.cos(right), Math.sin(right), Math.cos(left), Math.sin(left)];
}

/**
 * Build the eyeball material. `albedo` carries its colour space (sRGB when the resource is gamma); roughness, normals and the
 * bubble are data; the mask's colour space is the chosen `IrisMaskEncoding` (data for raw). Every eye texture repeats: UV0 spans
 * tiles. The geometry should be prepared with `prepareEyeballGeometry` (tangents and the per-eye vectors); without the vectors
 * the iris is drawn unrefracted. The eye's own roughness is on by default.
 */
export function createEyeMaterial(textures: EyeTextures, parameters: EyeParameters): { material: THREE.MeshStandardMaterial; handle: EyeballHandle; owned: THREE.Texture[] } {
  const owned: THREE.Texture[] = [];
  const constant = (rgba: number[]) => {
    const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    owned.push(t);
    return t;
  };
  const placeholder = () => constant([255, 255, 255, 255]);
  const flat = () => constant([128, 128, 255, 255]);
  const gradient = !!(textures.irisMask && textures.gradient);
  // The normal map (flat when the eye has none) also turns on Three's tangent attribute for the eye's frame.
  const material = new THREE.MeshStandardMaterial({ map: textures.albedo, normalMap: textures.normal ?? flat(), roughness: EYE_FLAT_ROUGHNESS, metalness: 0 });
  if (gradient) material.defines = { XFS_EYE_GRADIENT: "" };
  const { optics } = parameters;
  const hasSourceRoughness = !!textures.roughness;
  let sourceRoughness = hasSourceRoughness;
  const uniforms = {
    xfsIrisMask: { value: textures.irisMask ?? placeholder() }, xfsIrisGradient: { value: textures.gradient ?? placeholder() },
    xfsEyeRoughness: { value: textures.roughness ?? placeholder() }, xfsEyeBubble: { value: textures.bubble ?? flat() },
    xfsEyeSurface: { value: new THREE.Vector3(parameters.roughnessScale, sourceRoughness ? 1 : 0, parameters.metalness) },
    xfsEyeOptics: { value: new THREE.Vector4(optics.RefractionIndex, optics.RefractionAmount, optics.IrisSize, optics.EyeRadius) },
    xfsEyePlane: { value: new THREE.Vector4(optics.EyeParallaxPlane, optics.BubbleNormalTile, optics.IrisCoordFactor, optics.IrisCoordMargin) },
    xfsEyeEgg: { value: new THREE.Vector4(optics.EggFullRadius, optics.EggMarginExponent, optics.EggMarginFactor, optics.EggSubFactor) },
    xfsEyeTurn: { value: new THREE.Vector4(...eyeTurnUniform(optics)) },
    xfsEyeAmbient: { value: 1 + EYE_AMBIENT_BOOST },
    xfsEyeAlongB: { value: IRIS_PLANE_ORIENTATION === "as-mesh" ? 1 : 0 },
  };
  material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); patchEyeShader(shader); };
  material.customProgramCacheKey = () => `xfs-eye-2${gradient ? "-gradient" : ""}`;
  material.name = gradient ? "xfs_eye_gradient" : "xfs_eye";
  const handle: EyeballHandle = { role: "eyeball", parameters, gradient, hasSourceRoughness,
    get sourceRoughness() { return sourceRoughness; },
    setSourceRoughness(enabled) { sourceRoughness = enabled && hasSourceRoughness; uniforms.xfsEyeSurface.value.y = sourceRoughness ? 1 : 0; } };
  return { material, handle, owned };
}

/** The shell's surface and blend output; `RE_Direct` is replaced by its highlight (no diffuse, no environment). */
const SHELL_DECLARATIONS = /* glsl */`
uniform vec4 xfsShell;
uniform float xfsShellStrength;
float xfsShellRw = 1.0;
`;
const SHELL_LIGHT = /* glsl */`
void RE_Direct_XfsShell( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotNH = saturate( dot( geometryNormal, halfDir ) );
	float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	float alpha = xfsShellRw * xfsShellRw;
	float visibility = 0.25 / ( ( dotNV + dotNL ) * ( 1.0 - alpha * 0.5 ) + alpha );
	reflectedLight.directSpecular += directLight.color * D_GGX( alpha, dotNH ) * visibility;
}
#undef RE_Direct
#define RE_Direct RE_Direct_XfsShell
`;
const SHELL_SURFACE = /* glsl */`
vec4 xfsShellMask = texture2D( map, vMapUv );
float xfsShellShadow = clamp( xfsShell.x * pow( max( xfsShellMask.r, 0.0 ), xfsShell.y ), 0.0, 1.0 );
float xfsShellAlpha = clamp( 1.0 + xfsShellShadow * ( xfsShell.z - 1.0 ), 0.0, 1.0 );
xfsShellRw = clamp( xfsShell.w * xfsShellMask.g, 0.04, 1.0 );
diffuseColor.rgb = vec3( 0.0 );
`;

export function patchEyeShellShader(shader: { fragmentShader: string }) {
  const replace = (source: string, find: string, by: string) => {
    if (!source.includes(find)) throw Error(`The eye shell shader expects ${find} in this Three.js build.`);
    return source.replace(find, by);
  };
  let fragment = shader.fragmentShader;
  fragment = replace(fragment, "#include <common>", `#include <common>\n${SHELL_DECLARATIONS}`);
  fragment = replace(fragment, "#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>\n${SHELL_LIGHT}`);
  fragment = replace(fragment, "#include <map_fragment>", SHELL_SURFACE);
  // No environment reflection: the program walks the probes but weighs them by zero.
  fragment = replace(fragment, "#include <lights_fragment_maps>", "");
  // out = (highlight, alpha); the blend state makes it `out.rgb + dst · alpha`.
  fragment = replace(fragment, "#include <opaque_fragment>",
    "gl_FragColor = vec4( reflectedLight.directSpecular * xfsShellStrength * xfsShellMask.b, xfsShellAlpha );");
  shader.fragmentShader = fragment;
  return shader;
}

/** The wetness shell: its mask is data at the raw UV; drawn blended after everything opaque, never writing depth. */
export function createEyeShellMaterial(mask: THREE.Texture, parameters: ShellParameters): { material: THREE.MeshStandardMaterial; handle: EyeShellHandle } {
  const material = new THREE.MeshStandardMaterial({ map: mask, color: 0xffffff, roughness: 1, metalness: 0,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
    // The drawing buffer's alpha is not the shell's business.
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const uniforms = {
    xfsShell: { value: new THREE.Vector4(parameters.intensity, parameters.exponent, parameters.luminance, parameters.wetnessRoughness) },
    xfsShellStrength: { value: parameters.wetnessStrength },
  };
  material.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); patchEyeShellShader(shader); };
  material.customProgramCacheKey = () => "xfs-eye-shell-1";
  material.name = "xfs_eye_shell";
  return { material, handle: { role: "shell", parameters } };
}
