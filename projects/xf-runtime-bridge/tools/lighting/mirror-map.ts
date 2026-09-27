// Lighting mirror, offline prototype (research; nothing in the catalogue uses it yet).
//
// Maps an XF Studio lighting setup onto game light components placed about V in photo mode, and a
// read of game lights back into the Studio's frame. Design and evidence:
// research/runtime/lighting-mirror-design.md, knowledge/photo-mode-lights.md.
//
// Pure arithmetic: no game, no Three. What it encodes, and how sure each part is:
//
// - Frames. The Studio frame is Y up, V faces -Z, V's right = +X, metres from V's feet (the lighting
//   setups' convention). V's local frame in the game is X right, Y forward, Z up, both right-handed,
//   so Studio (x, y, z) = local (x, -z, y), the same map the Studio's mesh export and creator rig use.
//   World placement never assumes a yaw sign: it uses V's measured forward vector (photo.subject's
//   `subject_forward`), so position = origin + x*right + y*forward + z*up with right = forward x up.
// - A spot light's own +Y is its axis (the Blender add-on's convention; knowledge/creator-lighting.md
//   section 2) [hypothesis until the first session places one light].
// - Units. The game light is written in lumens (ELightUnit LU_Lumen, EV 0), the unit every creator
//   light uses. The Studio's reading of lumens is candela = lumen / 4pi (its default "isotropic"
//   form), so the inverse here is lumen = 4pi * candela. The engine's own lumen conversion is not
//   known, but using the exact inverse of the Studio's reading means the mirror reproduces what the
//   Studio drew, and a light carried with its native game values (`game`) needs no conversion at all.
// - Falloff. The decoded engine forms: inverse square saturate(1 - (d/r)^4)^2 / d^2 (Three's physical
//   falloff), and linear 1 - saturate(d/r) with no 1/d^2 term [source]. A Studio spot with decay 2
//   becomes inverse square with radius = its distance; decay 0 (no falloff) becomes a linear light
//   whose radius is long enough to be nearly flat across the head.
// - Directional lights have no local-light equivalent, so each becomes a linear-falloff spot 2 m out
//   along its direction, aimed at the focus, with the same illuminance at the focus.
// - Colour. The Studio keeps linear RGB; the game light keeps an 8-bit sRGB colour. The encode is the
//   exact inverse of the Studio's decode (creator-lighting.ts lightColourLinear), up to quantisation.
// - Cones. Studio half-angle and penumbra; game full inner and outer angles (the Studio's default
//   "full" reading) and a softness exponent (default 2, the creator rig's usual value).

export type Vec3 = readonly [number, number, number];
export type Rgb8 = readonly [number, number, number];
export type Quaternion = { readonly i: number; readonly j: number; readonly k: number; readonly r: number };

/** A light's own game values, carried when a setup came from the game (the creator rig, or a read). */
export type NativeLight = {
  readonly lumen: number;
  readonly falloff: "inverse-square" | "linear";
  /** Attenuation radius, metres. */
  readonly radius: number;
  readonly softness: number;
  /** Full cone angles in degrees, as the resource stores them. */
  readonly outer: number;
  readonly inner: number;
  /** 8-bit sRGB; null = unset (white). */
  readonly colour: Rgb8 | null;
  readonly localShadows: boolean;
  readonly contactShadows: "none" | "character" | "all";
  readonly sourceRadius: number;
  /** The Studio intensity when the native values were taken; a later edit scales the lumens by the ratio. */
  readonly studioIntensity?: number;
};

/** One Studio light, structurally the lighting setups' SetupLight, plus optional native game values. */
export type MirrorSourceLight = {
  readonly id: string;
  readonly name: string;
  readonly type: "directional" | "spot";
  readonly position: Vec3;
  readonly target: Vec3;
  /** Linear RGB, 0-1. */
  readonly colour: Vec3;
  /** Three's intensity: lux for directional, candela for spot. */
  readonly intensity: number;
  readonly shadows: boolean;
  /** Spot half-angle in radians, penumbra fraction, decay exponent, range in metres (0: unlimited). */
  readonly angle: number;
  readonly penumbra: number;
  readonly decay: number;
  readonly distance: number;
  readonly game?: NativeLight;
};

export type MirrorSourceSetup = {
  readonly lights: readonly MirrorSourceLight[];
  /** The head the lights are placed about, in the Studio frame. */
  readonly focus: Vec3;
  readonly environment: number;
  readonly backdrop: "studio" | "black";
  readonly display: "aces" | "game";
  readonly exposure: number;
};

/** What a game light component is given (all fields a component carries; scripts can later change only some). */
export type GameLightSpec = {
  readonly id: string;
  readonly name: string;
  readonly type: "spot";
  /** V-local game frame (x right, y forward, z up), metres from V's feet. */
  readonly localPosition: Vec3;
  /** Unit vector, V-local. */
  readonly localAxis: Vec3;
  readonly unit: "lumen";
  readonly intensity: number;
  readonly EV: 0;
  readonly temperature: -1;
  readonly colour: Rgb8;
  readonly outerAngle: number;
  readonly innerAngle: number;
  readonly softness: number;
  readonly attenuation: "inverse-square" | "linear";
  readonly radius: number;
  readonly enableLocalShadows: boolean;
  readonly contactShadows: "none" | "character" | "all";
  readonly sourceRadius: number;
  /** How the values were obtained: carried from the game, converted from the Studio, or a directional stand-in. */
  readonly origin: "native" | "converted" | "directional";
};

export type MirrorOptions = {
  /** One global scale on every intensity (photo mode's exposure differs from the Studio's; fitted per session). */
  readonly strengthScale?: number;
  readonly maxLights?: number;
  readonly maxShadowCasters?: number;
  /** Distance of a directional light's stand-in from the focus, metres. */
  readonly directionalDistance?: number;
  readonly defaultSoftness?: number;
  readonly defaultSourceRadius?: number;
};

export type MirrorPlan = {
  readonly lights: readonly GameLightSpec[];
  /** The focus in V's local game frame (the head the setup was built around). */
  readonly focusLocal: Vec3;
  /** Lights left out, and shadows switched off, each with a plain reason. */
  readonly dropped: readonly { readonly id: string; readonly reason: string }[];
  /** Parts of the setup the game can't reproduce, in plain words. */
  readonly notCarried: readonly string[];
};

export const MIRROR_DEFAULTS = Object.freeze({
  strengthScale: 1, maxLights: 16, maxShadowCasters: 6, directionalDistance: 2, defaultSoftness: 2, defaultSourceRadius: 0.1,
  /** A linear light this many times further than its distance to the focus varies under 1 % per 2 cm across the head. */
  flatRadiusFactor: 20,
  /** Head-and-shoulders radius a directional stand-in's inner cone covers, metres; the outer cone reaches this much further. */
  standInInner: 0.35, standInOuter: 0.8,
});

const FOUR_PI = 4 * Math.PI;
const RAD = Math.PI / 180;

// ----- Vectors and frames -----

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export function normalise(a: Vec3): Vec3 {
  const l = length(a);
  if (!(l > 1e-12)) throw new Error("zero-length vector");
  return scale(a, 1 / l);
}

/** Studio frame to V's local game frame. */
export const studioToLocal = (v: Vec3): Vec3 => [v[0], -v[2], v[1]];
/** V's local game frame to the Studio frame. */
export const localToStudio = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];

// ----- Colour -----

const encode = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const decode = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
/** Linear RGB (0-1) to 8-bit sRGB, the inverse of the Studio's decode. */
export function srgb8FromLinear(c: Vec3): Rgb8 {
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(encode(Math.max(0, Math.min(1, v))) * 255)));
  return [byte(c[0]), byte(c[1]), byte(c[2])];
}
/** 8-bit sRGB (null = white) to linear RGB, as the Studio decodes a creator light's colour. */
export function linearFromSrgb8(c: Rgb8 | null): Vec3 {
  return c ? [decode(c[0] / 255), decode(c[1] / 255), decode(c[2] / 255)] : [1, 1, 1];
}

// ----- The engine forms (for ranking lights and for the directional stand-in) -----

export function falloffAt(attenuation: "inverse-square" | "linear", radius: number, d: number): number {
  if (attenuation === "linear") return Math.max(0, 1 - Math.min(1, d / radius));
  const x = Math.min(1, Math.pow(d / radius, 4));
  return Math.pow(1 - x, 2) / Math.max(d * d, 1e-4);
}
/** The engine cone read as a linear ramp in cos between the outer and inner half-angles, raised to the softness [hypothesis]. */
export function coneAt(outerFull: number, innerFull: number, softness: number, cosAngle: number): number {
  const co = Math.cos((outerFull / 2) * RAD), ci = Math.cos(Math.max(innerFull / 2, 0.005) * RAD);
  const t = Math.max(0, Math.min(1, (cosAngle - co) / Math.max(ci - co, 1e-4)));
  return Math.pow(t, softness);
}
/** Illuminance at a point under the Studio's isotropic reading (candela = lumen / 4pi), no Lambert term. */
export function illuminanceAt(spec: GameLightSpec, point: Vec3): number {
  const to = sub(point, spec.localPosition), d = length(to);
  const cos = d > 0 ? dot(scale(to, 1 / d), spec.localAxis) : 1;
  return (spec.intensity / FOUR_PI) * falloffAt(spec.attenuation, spec.radius, d) * coneAt(spec.outerAngle, spec.innerAngle, spec.softness, cos);
}

// ----- Studio setup to game lights -----

function nativeSpec(l: MirrorSourceLight, n: NativeLight, s: number): Omit<GameLightSpec, "id" | "name" | "localPosition" | "localAxis"> {
  const edit = n.studioIntensity && n.studioIntensity > 0 ? l.intensity / n.studioIntensity : 1;
  return {
    type: "spot", unit: "lumen", EV: 0, temperature: -1, intensity: n.lumen * edit * s, colour: n.colour ?? [255, 255, 255],
    outerAngle: n.outer, innerAngle: n.inner, softness: n.softness, attenuation: n.falloff, radius: n.radius,
    enableLocalShadows: n.localShadows, contactShadows: n.contactShadows, sourceRadius: n.sourceRadius, origin: "native",
  };
}

function convertedSpot(l: MirrorSourceLight, dFocus: number, o: Required<MirrorOptions>): Omit<GameLightSpec, "id" | "name" | "localPosition" | "localAxis"> {
  const outer = Math.min(179, Math.max(0.5, 2 * l.angle / RAD));
  const inner = Math.max(0.25, outer * (1 - Math.max(0, Math.min(1, l.penumbra))));
  const shadows = { enableLocalShadows: l.shadows, contactShadows: l.shadows ? "character" as const : "none" as const };
  const base = { type: "spot" as const, unit: "lumen" as const, EV: 0 as const, temperature: -1 as const, colour: srgb8FromLinear(l.colour),
    outerAngle: outer, innerAngle: inner, softness: o.defaultSoftness, sourceRadius: o.defaultSourceRadius, origin: "converted" as const, ...shadows };
  if (l.decay === 0) {
    // No falloff in the Studio: a linear light long enough to be flat, with the Studio's illuminance at the focus.
    const radius = Math.max(20, MIRROR_DEFAULTS.flatRadiusFactor * dFocus);
    return { ...base, attenuation: "linear", radius, intensity: FOUR_PI * l.intensity / (1 - dFocus / radius) * o.strengthScale };
  }
  const radius = l.distance > 0 ? l.distance : Math.max(10, 2 * dFocus);
  return { ...base, attenuation: "inverse-square", radius, intensity: FOUR_PI * l.intensity * o.strengthScale };
}

/** Plans the game lights for a Studio setup. Pure; the bridge places the result about V (placeInWorld). */
export function planMirror(setup: MirrorSourceSetup, options: MirrorOptions = {}): MirrorPlan {
  const o: Required<MirrorOptions> = { ...MIRROR_DEFAULTS, ...options };
  const focusLocal = studioToLocal(setup.focus);
  const dropped: { id: string; reason: string }[] = [];
  const planned: GameLightSpec[] = [];
  for (const l of setup.lights) {
    if (!(l.intensity > 0)) { dropped.push({ id: l.id, reason: "It is switched off (strength 0)." }); continue; }
    const position = studioToLocal(l.position), target = studioToLocal(l.target);
    if (l.type === "directional") {
      // Same illuminance at the focus from a linear-falloff spot placed along the light's direction.
      const from = normalise(sub(position, target)), d = o.directionalDistance;
      const radius = MIRROR_DEFAULTS.flatRadiusFactor * d;
      planned.push({
        id: l.id, name: l.name, type: "spot", localPosition: add(focusLocal, scale(from, d)), localAxis: scale(from, -1),
        unit: "lumen", EV: 0, temperature: -1, intensity: FOUR_PI * l.intensity / (1 - d / radius) * o.strengthScale,
        colour: srgb8FromLinear(l.colour), outerAngle: 2 * Math.atan(MIRROR_DEFAULTS.standInOuter / d) / RAD,
        innerAngle: 2 * Math.atan(MIRROR_DEFAULTS.standInInner / d) / RAD, softness: o.defaultSoftness, attenuation: "linear", radius,
        enableLocalShadows: l.shadows, contactShadows: l.shadows ? "character" : "none", sourceRadius: o.defaultSourceRadius, origin: "directional",
      });
      continue;
    }
    const axis = normalise(sub(target, position)), dFocus = length(sub(focusLocal, position));
    const values = l.game ? nativeSpec(l, l.game, o.strengthScale) : convertedSpot(l, dFocus, o);
    planned.push({ id: l.id, name: l.name, localPosition: position, localAxis: axis, ...values });
  }
  // Budget: keep the lights that give the focus the most light; shadows go to the strongest casters.
  const strength = new Map(planned.map(p => [p.id, illuminanceAt(p, focusLocal)] as const));
  const byStrength = [...planned].sort((a, b) => strength.get(b.id)! - strength.get(a.id)!);
  const kept = new Set(byStrength.slice(0, o.maxLights).map(p => p.id));
  for (const p of byStrength.slice(o.maxLights)) dropped.push({ id: p.id, reason: `Over the ${o.maxLights}-light limit; it gave the face the least light.` });
  const casts = (p: GameLightSpec) => p.enableLocalShadows || p.contactShadows !== "none";
  const casters = new Set(byStrength.filter(p => kept.has(p.id) && casts(p)).slice(0, o.maxShadowCasters).map(p => p.id));
  // The lights stay in the setup's own order.
  const lights = planned.filter(p => kept.has(p.id)).map(p => {
    if (!casts(p) || casters.has(p.id)) return p;
    dropped.push({ id: p.id, reason: `Its shadows are off: over the ${o.maxShadowCasters}-shadow limit.` });
    return { ...p, enableLocalShadows: false, contactShadows: "none" as const };
  });
  const notCarried: string[] = [];
  if (setup.environment > 0) notCarried.push("The room light: the game has no equivalent, so the world's own surroundings light V instead.");
  if (setup.backdrop === "studio") notCarried.push("The backdrop: photo mode shows the world behind V.");
  notCarried.push(setup.display === "game"
    ? "Exposure: photo mode adjusts to the scene by itself, so overall brightness can differ; the game's colour grade applies in both."
    : "Exposure and tone: photo mode adjusts to the scene by itself and uses the game's colour grade, not the Studio's.");
  return { lights, focusLocal, dropped, notCarried };
}

// ----- Placing about V -----

/** Where V is: feet (the puppet's origin), the live head slot if read, and V's facing, all in world space (Z up). */
export type Anchor = { readonly feet: Vec3; readonly head?: Vec3; readonly forward: Vec3 };
export type Placement = { readonly position: Vec3; readonly axis: Vec3; readonly orientation: Quaternion };

function basis(anchor: Anchor) {
  const up: Vec3 = [0, 0, 1];
  const forward = normalise([anchor.forward[0], anchor.forward[1], 0]);
  const right = normalise(cross(forward, up));
  return { right, forward, up };
}
const toWorld = (b: ReturnType<typeof basis>, v: Vec3): Vec3 => add(add(scale(b.right, v[0]), scale(b.forward, v[1])), scale(b.up, v[2]));

/** The rotation taking an entity's own +Y onto `dir` by the shortest arc (the spot is symmetric about its axis). */
export function quatFromYAxis(dir: Vec3): Quaternion {
  const d = normalise(dir), y: Vec3 = [0, 1, 0], c = dot(y, d);
  if (c < -1 + 1e-9) return { i: 0, j: 0, k: 1, r: 0 }; // 180 degrees about Z
  const a = cross(y, d), w = 1 + c, n = Math.hypot(a[0], a[1], a[2], w);
  return { i: a[0] / n, j: a[1] / n, k: a[2] / n, r: w / n };
}
/** Rotates a vector by a quaternion. */
export function rotate(q: Quaternion, v: Vec3): Vec3 {
  const u: Vec3 = [q.i, q.j, q.k], t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.r)), cross(u, t));
}

/**
 * World placement of a planned light. Mode "head" (default) moves the whole setup so its focus lands on V's live head slot
 * (a posed or seated V is still lit where the Studio lit her); "feet" keeps the rig about V's feet exactly as authored.
 */
export function placeInWorld(spec: GameLightSpec, focusLocal: Vec3, anchor: Anchor, mode: "head" | "feet" = "head"): Placement {
  const b = basis(anchor);
  const origin = mode === "head" && anchor.head ? sub(anchor.head, toWorld(b, focusLocal)) : anchor.feet;
  const axis = normalise(toWorld(b, spec.localAxis));
  return { position: add(origin, toWorld(b, spec.localPosition)), axis, orientation: quatFromYAxis(axis) };
}

// ----- The reverse direction: a game light read back into the Studio -----

/** What a read of a game light component returns (lights.read), in world space. */
export type GameLightReading = {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  /** The entity's world orientation; the spot axis is its +Y. */
  readonly orientation: Quaternion;
  readonly type: "spot" | "point" | "area";
  readonly unit: "lumen" | "watt" | "lux" | "nit" | "ev100";
  readonly intensity: number;
  readonly EV: number;
  readonly colour: Rgb8;
  readonly outerAngle: number;
  readonly innerAngle: number;
  readonly softness: number;
  readonly attenuation: "inverse-square" | "linear";
  readonly radius: number;
  readonly enableLocalShadows: boolean;
  readonly contactShadows: "none" | "character" | "all";
  readonly sourceRadius: number;
};

/**
 * A game light as a Studio spot light about the same V, carrying its native values, so mirroring it again reproduces it exactly.
 * Only lumen lights at EV 0 convert; anything else is refused with a reason (their scale against lumens is not known).
 */
export function readingToStudio(reading: GameLightReading, anchor: Anchor, focusStudio: Vec3, mode: "head" | "feet" = "head"): MirrorSourceLight | { refused: string } {
  if (reading.unit !== "lumen" || reading.EV !== 0) return { refused: `Its brightness is in ${reading.unit} at EV ${reading.EV}, which the Studio can't convert yet.` };
  const b = basis(anchor), focusLocal = studioToLocal(focusStudio);
  const origin = mode === "head" && anchor.head ? sub(anchor.head, toWorld(b, focusLocal)) : anchor.feet;
  const fromWorld = (v: Vec3): Vec3 => [dot(v, b.right), dot(v, b.forward), dot(v, b.up)];
  const localPosition = fromWorld(sub(reading.position, origin));
  const localAxis = reading.type === "spot" ? normalise(fromWorld(rotate(reading.orientation, [0, 1, 0]))) : normalise(sub(focusLocal, localPosition));
  const position = localToStudio(localPosition), target = localToStudio(add(localPosition, localAxis));
  const candela = reading.intensity / FOUR_PI, linear = reading.attenuation === "linear";
  const dFocus = length(sub(focusLocal, localPosition));
  const outer = reading.type === "spot" ? reading.outerAngle : 179;
  const inner = reading.type === "spot" ? reading.innerAngle : 179;
  const intensity = linear ? candela * falloffAt("linear", reading.radius, dFocus) : candela;
  return {
    id: reading.id, name: reading.name, type: "spot", position, target, colour: linearFromSrgb8(reading.colour), intensity,
    shadows: reading.enableLocalShadows || reading.contactShadows !== "none",
    angle: Math.min(89.9, outer / 2) * RAD, penumbra: outer > 0 ? Math.max(0, Math.min(1, 1 - inner / outer)) : 0,
    decay: linear ? 0 : 2, distance: linear ? 0 : reading.radius,
    game: { lumen: reading.intensity, falloff: reading.attenuation, radius: reading.radius, softness: reading.softness, outer, inner,
      colour: reading.colour, localShadows: reading.enableLocalShadows, contactShadows: reading.contactShadows, sourceRadius: reading.sourceRadius,
      studioIntensity: intensity },
  };
}
