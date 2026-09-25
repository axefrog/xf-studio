// Structural checks on round-tripped (WolvenKit-serialized) package resources. Pure.
// Port of the resource section of experiments/005-preset-collection/verify.py.
// Dynamic expansion checks model inspected ArchiveXL rules; they do not run the game.
import { createHash } from "node:crypto";

// Loose JSON views of WolvenKit's CR2W JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Node = any;

export class VerificationError extends Error {
  constructor(message: string) { super(message); this.name = "VerificationError"; }
}

export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new VerificationError(message);
}

export type VerifierRoute = "flat" | "faceted" | "fresnel" | "glitter";
export type VerifierChannel = "diffuse" | "roughness" | "metalness" | "normal" | "mask" | "gradient" | "flakes" | "accent";

export interface VerifierPreset {
  readonly id: string; readonly name: string; readonly index: number;
  readonly appearance: string; readonly appAppearance: string;
  /** The builder's route and material entry; both must agree with the route re-derived from `recipe`. */
  readonly route: VerifierRoute; readonly material: string;
  /** The packaged (filtered) recipe the preset was compiled from. */
  readonly recipe: Node;
  readonly textures: Partial<Record<VerifierChannel, string>>;
  /** Render chunk of the packaged plate this preset draws (its lift's position in `plan.plate.liftsMm`). */
  readonly plateChunk?: number;
  /** Diagnostic-only export knobs copied from the packaged collection (a prepared test candidate). */
  readonly diagnostics?: { readonly plateLiftMm?: number; readonly surface?: Readonly<Record<string, number>>; readonly uvSpace?: string;
    readonly glitter?: Node };
  /** The builder's texture space: the plate-local window or the head atlas; must equal the re-derived one. */
  readonly uvSpace?: string;
  /** A diagnostic glitter preset's emissive accent entry, bound on the plate's accent chunk. */
  readonly accentMaterial?: string;
}

/**
 * The published per-finish export rules, restated here on purpose instead of imported from the
 * builder's policy (src/finish-export.ts): `route` is the route that carries the finish (null when
 * none can), `gameOptics` that only its game-matched model exports. `satin` is the legacy name of
 * `regular`. tests/mod-verifier-routes.test.ts fails if this table and the builder's disagree.
 */
export const VERIFIER_FINISHES: Readonly<Record<string, { readonly route: VerifierRoute | null; readonly gameOptics: boolean }>> = {
  matte: { route: "flat", gameOptics: false }, regular: { route: "flat", gameOptics: false }, satin: { route: "flat", gameOptics: false },
  metallic: { route: "flat", gameOptics: false }, glossy: { route: "flat", gameOptics: true },
  shimmer: { route: "faceted", gameOptics: true }, iridescent: { route: "fresnel", gameOptics: true },
  glitter: { route: null, gameOptics: false },
};
const finishRule = (finish: unknown) => typeof finish === "string" && Object.hasOwn(VERIFIER_FINISHES, finish) ? VERIFIER_FINISHES[finish] : undefined;
const GAME_MODEL = "game-matched-1";

/** The published per-route resource specification, restated here independently of the builder. */
export const ROUTE_SPEC: Record<VerifierRoute, { template: string; textures: readonly (readonly [string, VerifierChannel])[] }> = {
  flat: { template: "base/materials/mesh_decal.mt",
    textures: [["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"]] },
  faceted: { template: "base/materials/mesh_decal.mt",
    textures: [["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"], ["NormalTexture", "normal"]] },
  fresnel: { template: "base/materials/mesh_decal_gradientmap_recolor_blendable.mt",
    textures: [["MaskTexture", "mask"], ["GradientMap", "gradient"]] },
  // Diagnostic only: resolved flakes with their own normal mask (NormalAlphaTex).
  glitter: { template: "base/materials/mesh_decal.mt",
    textures: [["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"], ["NormalTexture", "normal"],
      ["NormalAlphaTex", "flakes"]] },
};
/** A diagnostic glitter preset's emissive accent material, restated: template and its one mask texture. */
export const ACCENT_SPEC = { template: "base/materials/mesh_decal_emissive_subsurface.mt", textures: [["EmissiveMask", "accent"]] } as const;
export const ACCENT_PREFIX = "@accent_";

// ---- The diagnostic glitter knob, restated (src/export-diagnostics.ts) ----
const FLAKE_FIELDS: Readonly<Record<string, readonly [number, number]>> = {
  sizeMm: [.05, 1.2], sizeSigma: [0, 1], cover: [.01, .6], tiltSigmaDeg: [0, 90], tiltMaxDeg: [1, 89], roughness: [0, 1], metalness: [0, 1], seed: [0, 2147483647],
};
const within = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
export interface VerifierFlakes { sizeMm: number; sizeSigma: number; cover: number; tiltSigmaDeg: number; tiltMaxDeg: number; roughness: number; metalness: number; color: string; seed: number }
export interface VerifierGlitter {
  base: { roughness: number; metalness: number };
  regions: { layer: string; mips: "nested" | "box"; flakes: VerifierFlakes; mirrorOf?: string }[];
  accent?: { layer: string; share: number; ev: number };
}
/** A preset's diagnostic glitter knob, validated under the restated rules; mirrored regions resolve to their source's flakes. */
export function glitterOf(preset: VerifierPreset): VerifierGlitter | undefined {
  const knob = preset.diagnostics?.glitter;
  if (knob === undefined) return undefined;
  const where = `Preset ${preset.name}'s diagnostic glitter`;
  ensure(knob && typeof knob === "object" && within(knob.base?.roughness, [0, 1]) && within(knob.base?.metalness, [0, 1]), `${where} has no valid base surface`);
  ensure(Array.isArray(knob.regions) && knob.regions.length >= 1 && knob.regions.length <= 8, `${where} needs one to eight regions`);
  const own = new Map<string, VerifierFlakes>();
  for (const region of knob.regions) if (region?.flakes) {
    const f = region.flakes;
    ensure(Object.entries(FLAKE_FIELDS).every(([key, range]) => within(f[key], range)) && Number.isInteger(f.seed) && /^#[0-9a-f]{6}$/.test(f.color),
      `${where} has flakes outside the diagnostic rules`);
    own.set(region.layer, f);
  }
  const regions = knob.regions.map((region: Node) => {
    ensure(typeof region?.layer === "string" && (region.mips === "nested" || region.mips === "box"), `${where} has an invalid region`);
    ensure((region.flakes === undefined) !== (region.mirrorOf === undefined), `${where} region ${region.layer} must set flakes or mirror another region`);
    const flakes = region.flakes ?? own.get(region.mirrorOf);
    ensure(flakes, `${where} region ${region.layer} mirrors a region without flakes`);
    return { layer: region.layer, mips: region.mips, flakes, ...(region.mirrorOf !== undefined ? { mirrorOf: region.mirrorOf } : {}) };
  });
  ensure(new Set(regions.map((r: { layer: string }) => r.layer)).size === regions.length, `${where} names a layer twice`);
  const accent = knob.accent;
  ensure(accent === undefined || (regions.some((r: { layer: string }) => r.layer === accent.layer) && within(accent.share, [.01, 1]) && within(accent.ev, [-10, 10])),
    `${where} has an invalid accent`);
  return { base: knob.base, regions, ...(accent ? { accent } : {}) };
}
/**
 * The route a preset's own recipe requires, re-derived with the restated rules: every active layer must
 * have a route (and its game-matched model where the finish has one); a colour shift means the Fresnel
 * route with one pigment and nothing else; otherwise any Shimmer means faceted; otherwise flat.
 */
export function expectedRoute(preset: VerifierPreset): VerifierRoute {
  const layers = activeLayers(preset), routes = new Set<VerifierRoute>(), glitter = glitterOf(preset);
  ensure(layers.length > 0, `Preset ${preset.name} has no active layer`);
  for (const layer of layers) {
    const rule = finishRule(layer.finish);
    ensure(rule?.route, `Preset ${preset.name} packages a ${String(layer.finish)} layer, which no export route can draw`);
    ensure(!rule.gameOptics || layer.optics?.model === GAME_MODEL, `Preset ${preset.name} packages a ${layer.finish} layer without its game-matched model`);
    ensure(rule.route !== "faceted" || !(layer.flakes && typeof layer.flakes === "object" && "model" in layer.flakes),
      `Preset ${preset.name} packages a Shimmer layer without the classic flake settings`);
    routes.add(rule.route);
  }
  if (glitter) {
    // The diagnostic glitter route: flat-finish pigment layers only, and every region names one of them.
    ensure(routes.size === 1 && routes.has("flat"), `Preset ${preset.name} carries diagnostic glitter over layers that are not all flat finishes`);
    for (const region of glitter.regions) ensure(layers.some(l => l.id === region.layer), `Preset ${preset.name}'s glitter names layer ${region.layer}, which is not active`);
    return "glitter";
  }
  if (routes.has("fresnel")) { fresnelPigment(preset); return "fresnel"; }
  return routes.has("faceted") ? "faceted" : "flat";
}
/** The builder's route for a preset, which must equal the route its recipe requires. A missing route is not flat. */
export function routeOf(preset: VerifierPreset): VerifierRoute {
  ensure(typeof preset.route === "string" && Object.hasOwn(ROUTE_SPEC, preset.route), `Build record names no export route for preset ${preset.name}`);
  const expected = expectedRoute(preset);
  ensure(preset.route === expected, `Preset ${preset.name} was built for the ${preset.route} route, but its recipe needs the ${expected} route`);
  return expected;
}
export const materialOf = (preset: VerifierPreset): string => {
  ensure(typeof preset.material === "string", `Build record names no material entry for preset ${preset.name}`);
  return preset.material;
};
/** XBM import settings each channel must carry. */
export const CHANNEL_SETUP: Record<VerifierChannel, { isGamma: 0 | 1; compression: string }> = {
  diffuse: { isGamma: 1, compression: "TCM_QualityColor" }, gradient: { isGamma: 1, compression: "TCM_QualityColor" },
  roughness: { isGamma: 0, compression: "TCM_QualityR" }, metalness: { isGamma: 0, compression: "TCM_QualityR" },
  mask: { isGamma: 0, compression: "TCM_QualityR" }, normal: { isGamma: 0, compression: "TCM_Normalmap" },
  flakes: { isGamma: 0, compression: "TCM_QualityR" }, accent: { isGamma: 0, compression: "TCM_QualityR" },
};
/** Side of the uniform Fresnel base-colour texture. */
export const GRADIENT_SIDE = 16;
/** Restated texture grids: flat and faceted presets use the plate-local window unless a diagnostic keeps them on head UV. */
export const VERIFIER_WINDOW_TEXTURE = Object.freeze({ width: 2048, height: 512 });
/** The diagnostic glitter route's window and its accent's head-UV mask side. */
export const VERIFIER_GLITTER_TEXTURE = Object.freeze({ width: 4096, height: 1024 });
export const VERIFIER_ACCENT_TEXTURE = 2048;
export const VERIFIER_HEAD_TEXTURE = 1024;
/** Routes whose template transforms texture UVs (`mesh_decal`); the gradient-recolour template does not. */
export const VERIFIER_ROUTE_WINDOW: Readonly<Record<VerifierRoute, boolean>> = { flat: true, faceted: true, fresnel: false, glitter: true };
export type VerifierUvSpace = "plate-window" | "head";
/**
 * The texture space a preset must use, re-derived: the window where the route's template can transform UVs,
 * unless its diagnostics set `uvSpace: "head"` (allowed only there). The builder's plan must agree.
 */
export function uvSpaceOf(preset: VerifierPreset): VerifierUvSpace {
  const route = routeOf(preset), knob = preset.diagnostics?.uvSpace;
  ensure(knob === undefined || (knob === "head" && VERIFIER_ROUTE_WINDOW[route]), `Preset ${preset.name} has an invalid diagnostic uvSpace`);
  const expected: VerifierUvSpace = VERIFIER_ROUTE_WINDOW[route] && knob !== "head" ? "plate-window" : "head";
  ensure(preset.uvSpace === expected, `Preset ${preset.name} was built on ${String(preset.uvSpace)} UV, but its route and diagnostics need ${expected}`);
  return expected;
}
/** Level-0 size each channel of a preset must have. */
export function textureDims(preset: VerifierPreset, channel: VerifierChannel): { width: number; height: number } {
  if (channel === "gradient") return { width: GRADIENT_SIDE, height: GRADIENT_SIDE };
  if (channel === "accent") return { width: VERIFIER_ACCENT_TEXTURE, height: VERIFIER_ACCENT_TEXTURE };
  if (routeOf(preset) === "glitter") return { ...VERIFIER_GLITTER_TEXTURE };
  return uvSpaceOf(preset) === "plate-window" ? { ...VERIFIER_WINDOW_TEXTURE } : { width: VERIFIER_HEAD_TEXTURE, height: VERIFIER_HEAD_TEXTURE };
}
/** The material UV transform parameters, which only window entries carry. */
export const UV_PARAMETERS = ["UVScaleX", "UVOffsetX", "UVScaleY", "UVOffsetY"] as const;

const srgbDecode = (v: number) => (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** WolvenKit stores material scalars as float32 and prints nine significant digits. */
const sameFloat32 = (actual: unknown, want: number) => typeof actual === "number" && Math.abs(actual - Math.fround(want)) <= 1e-7 * Math.max(1, Math.abs(want));
const toByte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);

/** Active layers of a preset's packaged recipe. */
function activeLayers(preset: VerifierPreset): Node[] {
  ensure(Array.isArray(preset.recipe?.layers), `Build record lacks the recipe of preset ${preset.name}`);
  return preset.recipe.layers.filter((l: Node) => l && l.enabled && l.opacity > 0);
}

/** The one colour-shift pigment of a Fresnel preset, read from its recipe: base colour, shift colour and strength. */
export function fresnelPigment(preset: VerifierPreset): { color: string; shift: { color: string; strength: number } } {
  const layers = activeLayers(preset);
  ensure(layers.length > 0, `Fresnel preset ${preset.name} has no active layer`);
  const keys = new Set(layers.map(l => JSON.stringify([String(l.color).toLowerCase(), String(l.optics?.shift?.color).toLowerCase(), l.optics?.shift?.strength])));
  ensure(keys.size === 1 && layers.every(l => finishRule(l.finish)?.route === "fresnel" && l.optics?.model === GAME_MODEL && l.optics.shift),
    `Fresnel preset ${preset.name} is not one colour-shift pigment`);
  return { color: layers[0].color, shift: layers[0].optics.shift };
}

/** Flat-material scalars a diagnostic surface override may replace, with their accepted ranges (restated). */
export const VERIFIER_SURFACE_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  RoughnessScale: [0, 2], RoughnessBias: [-1, 1], MetalnessScale: [0, 2], MetalnessBias: [-1, 1], RoughnessMetalnessAlpha: [0, 1],
};
/** The diagnostic surface override of a preset, validated; undefined when it has none. */
export function surfaceOf(preset: VerifierPreset): Readonly<Record<string, number>> | undefined {
  const surface = preset.diagnostics?.surface;
  if (surface === undefined) return undefined;
  ensure(surface && typeof surface === "object" && Object.keys(surface).length > 0, `Preset ${preset.name} has an empty diagnostic surface`);
  for (const [name, number] of Object.entries(surface)) {
    const range = VERIFIER_SURFACE_RANGES[name];
    ensure(range && typeof number === "number" && number >= range[0] && number <= range[1], `Preset ${preset.name} overrides ${name} outside the diagnostic rules`);
  }
  return surface;
}
/** 32-bit FNV-1a of UTF-16 code units, eight hex digits (restated for the diagnostic entry name). */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/** Material entry a flat preset with a diagnostic surface must use: one per distinct override. */
export const diagnosticEntryOf = (surface: Readonly<Record<string, number>>) =>
  "@flat_" + fnv1a32(JSON.stringify(Object.keys(surface).sort().map(key => [key, surface[key]])));
/** Suffix of the entry of a flat or faceted preset a diagnostic keeps on head UV. */
export const HEAD_ENTRY_SUFFIX = "_head";
/** Entry bound to unused plate chunks when the plate carries several lifts, and its all-zero alphas. */
export const HIDDEN_ENTRY = "xfs_hidden";
export const HIDDEN_VALUES: Readonly<Record<string, number>> = { DiffuseAlpha: 0, NormalAlpha: 0, RoughnessMetalnessAlpha: 0 };

/**
 * Expected scalar and colour parameters of each route's material instance (the published specification).
 * `uv` is the verifier's own window transform, required and added for plate-window presets.
 */
export function expectedMaterialValues(route: VerifierRoute, preset: VerifierPreset, uv?: Readonly<Record<string, number>>): Record<string, Node> {
  const white = { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 };
  const flat = { DiffuseAlpha: 1, NormalAlpha: 0, RoughnessMetalnessAlpha: 1, AlphaMaskContrast: 0, SecondaryMaskInfluence: 0,
    RoughnessScale: 1, MetalnessScale: 1, RoughnessBias: 0, MetalnessBias: 0, DiffuseColor: white };
  const windowed = route !== "fresnel" && uvSpaceOf(preset) === "plate-window";
  ensure(!windowed || uv, `Preset ${preset.name} needs the plate's UV window`);
  const transform = windowed ? Object.fromEntries(UV_PARAMETERS.map(name => [name, uv![name]])) : {};
  if (route === "flat") return { ...flat, ...(surfaceOf(preset) ?? {}), ...transform };
  if (route === "faceted") return { ...flat, NormalAlpha: 1, UseNormalAlphaTex: 0, NormalsBlendingMode: 1, ...transform };
  if (route === "glitter") return { ...flat, NormalAlpha: 1, UseNormalAlphaTex: 1, NormalsBlendingMode: 1, ...transform };
  const { shift } = fresnelPigment(preset);
  const linear = [1, 3, 5].map(i => srgbDecode(parseInt(shift.color.slice(i, i + 2), 16) / 255)), peak = Math.max(...linear);
  const [Red, Green, Blue] = peak > 0 ? linear.map(v => toByte(v / peak)) : [0, 0, 0];
  return { DiffuseAlpha: 1, RoughnessMetalnessAlpha: 1, NormalAlpha: 0, AlphaMaskContrast: 0, SecondaryMaskInfluence: 0,
    RoughnessScale: 0, RoughnessBias: .32, MetalnessScale: 0, MetalnessBias: .25, FadeOutOffset: 1000, FadeOutDistance: 1,
    FresnelColorIntensity: round6(2 * shift.strength * peak), FresnelExponent: 2,
    FresnelColor: { $type: "Color", Red, Green, Blue, Alpha: 255 }, DiffuseColor: white };
}

export interface VerifierPlan {
  readonly namespace: string; readonly selector: string; readonly selectorLabel: unknown; readonly component: string;
  readonly offAppearance: string; readonly templateAppearance: string;
  readonly mesh: string; readonly morph: string; readonly app: string; readonly customization: string;
  readonly presets: readonly VerifierPreset[];
  /** The packaged plate's lifts in millimetres, one render chunk each; a glitter accent's chunk comes last. */
  readonly plate?: { readonly liftsMm: readonly number[]; readonly accentChunk?: number };
}

/** Expected constants of a glitter accent (restated): red mask channel, the flake colour's sRGB bytes, the knob's EV, no threshold. */
export function expectedAccentValues(preset: VerifierPreset): Record<string, Node> {
  const glitter = glitterOf(preset);
  ensure(glitter?.accent, `Preset ${preset.name} has no glitter accent`);
  const color = glitter.regions.find(r => r.layer === glitter.accent!.layer)!.flakes.color;
  const [Red, Green, Blue] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  return { EmissiveMaskChannel: { $type: "Vector4", X: 1, Y: 0, Z: 0, W: 0 }, EmissiveColor: { $type: "Color", Red, Green, Blue, Alpha: 255 },
    EmissiveEV: glitter.accent.ev, AlphaThreshold: 0 };
}

/**
 * The plate lifts a plan must use, re-derived from its presets: each preset's diagnostic lift or the
 * restated production lift, distinct values ascending; every preset must draw its own lift's chunk.
 */
export function expectedPlateLifts(plan: VerifierPlan, productionLiftMm: number): number[] {
  const liftOf = (preset: VerifierPreset) => {
    const lift = preset.diagnostics?.plateLiftMm;
    ensure(lift === undefined || (typeof lift === "number" && lift >= 0 && lift <= 1), `Preset ${preset.name} has an invalid diagnostic plate lift`);
    return lift ?? productionLiftMm;
  };
  const lifts = [...new Set(plan.presets.map(liftOf))].sort((a, b) => a - b);
  // A diagnostic glitter accent adds one last chunk at the lift its presets share.
  const accentLifts = [...new Set(plan.presets.filter(preset => glitterOf(preset)?.accent).map(liftOf))];
  ensure(accentLifts.length <= 1, "Glitter accents must share one plate lift");
  const accentChunk = accentLifts.length ? lifts.length : undefined;
  if (accentLifts.length) lifts.push(accentLifts[0]);
  ensure(sameJson(plan.plate?.liftsMm, lifts), `Plan plate lifts ${JSON.stringify(plan.plate?.liftsMm)} differ from the presets' lifts ${JSON.stringify(lifts)}`);
  ensure(plan.plate?.accentChunk === accentChunk, `Plan accent chunk ${String(plan.plate?.accentChunk)} differs from the expected ${String(accentChunk)}`);
  for (const preset of plan.presets) {
    ensure(preset.plateChunk === lifts.indexOf(liftOf(preset)), `Preset ${preset.name} does not draw its lift's plate chunk`);
    const accentEntry = glitterOf(preset)?.accent ? ACCENT_PREFIX + preset.id.replaceAll("-", "") : undefined;
    ensure(preset.accentMaterial === accentEntry, `Preset ${preset.name} has accent entry ${String(preset.accentMaterial)}, expected ${String(accentEntry)}`);
  }
  return lifts;
}

export interface RoundTrippedResources {
  readonly mesh: Node; readonly morph: Node; readonly app: Node; readonly customization: Node;
  readonly sourceMesh: Node; readonly sourceMorph: Node;
  /** RootChunk of an XBM's round-tripped JSON, by depot path. */
  readonly texture: (depotPath: string) => Node;
  /** Whether the generated (pre-pack) archive tree contains a depot path. */
  readonly archiveHas: (depotPath: string) => boolean;
}

export interface ResolvedPreset {
  readonly appearance: string; readonly chunkMaterial: string;
  readonly textures: Partial<Record<VerifierChannel, string>>;
  /** Render chunk of the packaged plate this preset draws (its lift's position in `plan.plate.liftsMm`). */
  readonly plateChunk?: number;
  /** Diagnostic-only export knobs copied from the packaged collection (a prepared test candidate). */
  readonly diagnostics?: { readonly plateLiftMm?: number; readonly surface?: Readonly<Record<string, number>> };
}

const value = (x: Node) => x?.$value;
const dep = (x: Node): string => String(value(x?.DepotPath)).replaceAll("\\", "/");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** Serialization handles that WolvenKit renumbers; never part of a resource's content. */
export const HANDLE_KEYS: ReadonlySet<string> = new Set(["HandleId", "BufferId", "HandleRefId"]);
const IGNORED = HANDLE_KEYS;

/** Python-style structural equality: object key order ignored; list order kept. */
export function sameJson(a: Node, b: Node, ignore: ReadonlySet<string> = new Set()): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item: Node, i: number) => sameJson(item, b[i], ignore));
  const left = Object.keys(a).filter(k => !ignore.has(k)), right = Object.keys(b).filter(k => !ignore.has(k));
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && !ignore.has(key) && sameJson(a[key], b[key], ignore));
}

/** Where two JSON values first differ under `sameJson`'s rules (e.g. `header.renderLODs[0]`), or null when equal. */
export function firstDifference(a: Node, b: Node, ignore: ReadonlySet<string> = new Set(), path = ""): string | null {
  if (a === b) return null;
  const here = path || "(root)";
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return here;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return here;
    for (let i = 0; i < a.length; i++) { const found = firstDifference(a[i], b[i], ignore, `${path}[${i}]`); if (found) return found; }
    return null;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (ignore.has(key)) continue;
    const at = path ? `${path}.${key}` : key;
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) return at;
    const found = firstDifference(a[key], b[key], ignore, at);
    if (found) return found;
  }
  return null;
}

/**
 * Fields of the packaged plate the build owns; every other top-level field must be the plate input's.
 * The render and morph blobs are compared whole in plate-geometry.ts, which re-derives what the lift changes.
 */
export const PLATE_MESH_BUILD_FIELDS: readonly string[] = ["appearances", "materialEntries", "localMaterialBuffer", "renderResourceBlob"];
export const PLATE_MORPH_BUILD_FIELDS: readonly string[] = ["baseMesh", "baseMeshAppearance", "blob"];
function sameAsSource(label: string, packaged: Node, source: Node, owned: readonly string[]) {
  ensure(isMap(packaged) && isMap(source), `${label} is not a resource`);
  for (const key of new Set([...Object.keys(packaged), ...Object.keys(source)])) {
    if (owned.includes(key) || IGNORED.has(key)) continue;
    ensure(Object.hasOwn(packaged, key) && Object.hasOwn(source, key) && sameJson(packaged[key], source[key], IGNORED),
      `${label} ${key} differs from the source plate`);
  }
}

/** Stable 64-bit component ID derived from its collection component name (0 maps to 1). */
export function componentId(component: string): bigint {
  const digest = createHash("sha256").update("xfs:component:" + component, "utf8").digest();
  return digest.readBigUInt64LE(0) || 1n;
}

function uint64(x: Node, label: string): bigint {
  ensure(typeof x === "string" ? /^[0-9]+$/.test(x) : Number.isSafeInteger(x), `${label} is not an exact unsigned integer`);
  return BigInt(x);
}

export interface ResourceSummary {
  readonly appearanceNames: string[];
  readonly morphTargets: number;
  readonly materialTemplates: number;
  readonly meshAppearances: number;
  readonly selectorOptionCount: number;
  readonly resolved: ResolvedPreset[];
}

/**
 * Structural checks of the package resources. `morphTargets` is the plate recipe's target count;
 * null (a developer override plate) accepts the source plate's own non-zero count.
 */
export function checkResources(plan: VerifierPlan, r: RoundTrippedResources, artifactPaths: readonly string[],
  uv: Readonly<Record<string, number>> | undefined, morphTargets: number | null): ResourceSummary {
  const { mesh, morph, app, customization: cc } = r;
  // Everything the build does not own is the plate input's; the blobs are checked against the planned
  // lifts in plate-geometry.ts.
  sameAsSource("Mesh", mesh, r.sourceMesh, PLATE_MESH_BUILD_FIELDS);
  sameAsSource("Morph", morph, r.sourceMorph, PLATE_MORPH_BUILD_FIELDS);
  const chunks = Array.isArray(plan.plate?.liftsMm) ? plan.plate!.liftsMm.length : 0;
  ensure(chunks > 0, "Plan names no plate lift");
  ensure(dep(morph.baseMesh) === plan.mesh, "Morph baseMesh does not reference the planned mesh");
  ensure(value(morph.baseMeshAppearance) === plan.presets[0]?.appearance, "Morph baseMeshAppearance is not the seed appearance");
  const targetCount = Array.isArray(morph.targets) ? morph.targets.length : 0;
  ensure(morphTargets === null ? targetCount > 0 : targetCount === morphTargets,
    `Morph target count is ${targetCount}, not the plate recipe's ${morphTargets ?? "non-zero count"}`);
  // Material entries: one per distinct template entry, in first-use order across presets.
  const entryNames: string[] = [];
  for (const preset of plan.presets) if (!entryNames.includes(materialOf(preset))) entryNames.push(materialOf(preset));
  const accented = plan.presets.filter(preset => glitterOf(preset)?.accent);
  for (const preset of accented) entryNames.push(ACCENT_PREFIX + preset.id.replaceAll("-", ""));
  if (chunks > 1) entryNames.push(HIDDEN_ENTRY);
  ensure(mesh.materialEntries?.length === entryNames.length,
    entryNames.length === 1 ? "Mesh must have exactly one material entry" : `Mesh must have exactly ${entryNames.length} material entries`);
  mesh.materialEntries.forEach((entry: Node, i: number) => ensure(value(entry.name) === entryNames[i] && entry.index === i && entry.isLocalInstance === 1,
    entryNames.length === 1 ? "Mesh material entry is not @preset" : `Mesh material entry ${i} is not the local ${entryNames[i]}`));
  const materials = mesh.localMaterialBuffer?.materials;
  ensure(materials?.length === entryNames.length,
    entryNames.length === 1 ? "Mesh must have exactly one local material" : `Mesh must have exactly ${entryNames.length} local materials`);
  const paramsByEntry = new Map<string, Record<string, Node>>();
  entryNames.forEach((name, i) => {
    const material = materials[i];
    if (name === HIDDEN_ENTRY) {
      ensure(dep(material.baseMaterial) === ROUTE_SPEC.flat.template, "Hidden chunk material is not based on mesh_decal.mt");
      const params: Record<string, Node> = {};
      for (const item of material.values) for (const [key, v] of Object.entries(item)) if (key !== "$type") params[key] = v;
      ensure(sameJson(Object.keys(params).sort(), Object.keys(HIDDEN_VALUES).sort()) &&
        Object.entries(HIDDEN_VALUES).every(([key, want]) => sameFloat32(params[key], want)), "Hidden chunk material must write nothing (all alphas 0)");
      return;
    }
    const accentPreset = accented.find(p => ACCENT_PREFIX + p.id.replaceAll("-", "") === name);
    if (accentPreset) {
      ensure(dep(material.baseMaterial) === ACCENT_SPEC.template, `Accent material ${name} is not based on ${ACCENT_SPEC.template}`);
      const params: Record<string, Node> = {};
      for (const item of material.values) for (const [key, v] of Object.entries(item)) if (key !== "$type") params[key] = v;
      const expected = expectedAccentValues(accentPreset);
      for (const [key, want] of Object.entries(expected))
        ensure(typeof want === "object" ? sameJson(params[key], want) : sameFloat32(params[key], want),
          `Accent material ${name} ${key} is ${JSON.stringify(params[key])}, expected ${JSON.stringify(want)}`);
      const extra = Object.keys(params).filter(key => !(key in expected) && key !== "EmissiveMask");
      ensure(!extra.length, `Accent material ${name} sets unexpected parameters: ${extra.join(", ")}`);
      paramsByEntry.set(name, params);
      return;
    }
    const preset = plan.presets.find(p => materialOf(p) === name)!, route = routeOf(preset);
    ensure(route !== "fresnel" || plan.presets.filter(p => materialOf(p) === name).length === 1, `Fresnel material ${name} is shared`);
    const surface = route === "flat" ? surfaceOf(preset) : undefined;
    ensure(route === "flat" || preset.diagnostics?.surface === undefined, `Preset ${preset.name} carries a diagnostic surface on the ${route} route`);
    const head = route !== "fresnel" && uvSpaceOf(preset) === "head" ? HEAD_ENTRY_SUFFIX : "";
    ensure(route === "fresnel" ? name.startsWith("@fresnel_")
      : name === (surface ? diagnosticEntryOf(surface) : route === "flat" ? "@preset" : route === "glitter" ? "@glitter" : "@faceted") + head,
      `Material entry ${name} does not match its ${route} route`);
    ensure(plan.presets.filter(p => materialOf(p) === name).every(p => sameJson(p.diagnostics?.surface, preset.diagnostics?.surface) &&
      uvSpaceOf(p) === uvSpaceOf(preset)), `Material entry ${name} is shared by presets with different surfaces or texture spaces`);
    ensure(dep(material.baseMaterial) === ROUTE_SPEC[route].template,
      route === "flat" ? "Material is not based on mesh_decal.mt" : `Material ${name} is not based on ${ROUTE_SPEC[route].template}`);
    const params: Record<string, Node> = {};
    for (const item of material.values) for (const [key, v] of Object.entries(item)) if (key !== "$type") params[key] = v;
    const expected = expectedMaterialValues(route, preset, uv);
    if (route === "flat" && !surface) {
      ensure(params.NormalAlpha === 0 && params.AlphaMaskContrast === 0 && params.SecondaryMaskInfluence === 0, "Material normal/mask parameters are not zero");
      ensure([params.DiffuseAlpha, params.RoughnessMetalnessAlpha, params.RoughnessScale, params.MetalnessScale].every(v => v === 1),
        "Material alpha/scale parameters are not one");
      ensure(sameJson(params.DiffuseColor, expected.DiffuseColor), "DiffuseColor is not opaque white");
      ensure(params.RoughnessBias === 0 && params.MetalnessBias === 0, "Material biases are not zero");
    }
    for (const [key, want] of Object.entries(expected))
      ensure(typeof want === "object" ? sameJson(params[key], want) : sameFloat32(params[key], want),
        `Material ${name} ${key} is ${JSON.stringify(params[key])}, expected ${JSON.stringify(want)}`);
    const textureParams: string[] = ROUTE_SPEC[route].textures.map(([parameter]) => parameter);
    const extra = Object.keys(params).filter(key => !(key in expected) && !textureParams.includes(key));
    ensure(!extra.length, `Material ${name} sets unexpected parameters: ${extra.join(", ")}`);
    paramsByEntry.set(name, params);
  });
  const appearances = mesh.appearances.map((a: Node) => value(a.Data.name));
  ensure(sameJson(appearances, plan.presets.map(p => p.appearance)), "Mesh appearances differ from the planned presets");
  const seedPreset = plan.presets[0], seed = mesh.appearances[0].Data;
  // One chunk per lift: with several, every appearance names each chunk, its own with its material and the rest hidden.
  const bound = (preset: VerifierPreset) => chunks > 1
    ? Array.from({ length: chunks }, (_, chunk) => chunk === preset.plateChunk ? preset.appearance + materialOf(preset)
      : chunk === plan.plate?.accentChunk && glitterOf(preset)?.accent ? preset.appearance + ACCENT_PREFIX + preset.id.replaceAll("-", "") : HIDDEN_ENTRY)
    : [preset.appearance + materialOf(preset)];
  ensure(sameJson(seed.chunkMaterials.map(value), bound(seedPreset)), `Seed appearance does not use the ${materialOf(seedPreset)} template`);
  // Stubs expand from the seed; a preset on another entry, or any Fresnel preset, names its own.
  const explicit = (preset: VerifierPreset) => chunks > 1 || materialOf(preset) !== materialOf(seedPreset) || routeOf(preset) === "fresnel";
  mesh.appearances.slice(1).forEach((a: Node, i: number) => {
    const preset = plan.presets[i + 1];
    if (explicit(preset)) ensure(sameJson(a.Data.chunkMaterials?.map(value), bound(preset)),
      `Appearance ${preset.appearance} must name ${materialOf(preset)}`);
    else ensure(!a.Data.chunkMaterials?.length, "Only the seed appearance may carry chunk materials");
  });

  ensure(app.appearances?.length === 2, "App must define exactly Off and the template");
  const [off, template] = app.appearances.map((a: Node) => a.Data);
  ensure(value(off.name) === plan.offAppearance && !off.components?.length, "Off appearance is not an empty definition");
  ensure(Array.isArray(off.partsOverrides?.[0]?.componentsOverrides) && off.partsOverrides[0].componentsOverrides.length === 0,
    "Off appearance must carry one empty override array");
  ensure(value(template.name) === plan.templateAppearance && template.components?.length === 1, "Template must define exactly one component");
  const component = template.components[0];
  ensure(component.$type === "entMorphTargetSkinnedMeshComponent", "Template component is not a morph-target skinned mesh");
  ensure(value(component.name) === plan.component && dep(component.morphResource) === plan.morph, "Template component name or morph resource differs");
  const expectedId = componentId(plan.component);
  ensure(uint64(component.id, "Component id") === expectedId, "Component id is not the stable derived id");
  ensure(sameJson(template.compiledData?.Data?.CruidDict, { "0": expectedId.toString() }), "Compiled CRUID does not match the component id");
  ensure(value(component.meshAppearance) === plan.presets[0].appearance, "Component mesh appearance is not the seed");
  ensure(template.compiledData.Data.Chunks?.length, "Component was not compiled into its binary package");
  const override = template.partsOverrides?.[0]?.componentsOverrides;
  ensure(override?.length === 1 && value(override[0].componentName) === plan.component, "Template must name one component override");
  // Handles may serialize as references after the compiled package is expanded.
  const handles = new Map<string, Node>();
  const collect = (x: Node) => {
    if (Array.isArray(x)) x.forEach(collect);
    else if (x && typeof x === "object") {
      if ("HandleId" in x) handles.set(String(x.HandleId), x.Data);
      Object.values(x).forEach(collect);
    }
  };
  collect(app);
  for (const [field, kind] of [["parentTransform", "entHardTransformBinding"], ["skinning", "entSkinningBinding"]]) {
    const handle = component[field], binding = handle?.Data || handles.get(String(handle?.HandleRefId));
    ensure(binding?.$type === kind && value(binding.bindName) === "root" && binding.enabled === 1, `Component ${field} is not an enabled root ${kind}`);
  }
  const o = component.localTransform?.Orientation;
  ensure(o && o.i === 0 && o.j === 0 && o.k === 0 && o.r === 1, "Component orientation is not identity");
  ensure(component.isEnabled === 1, "Component is disabled");

  ensure(cc.headCustomizationOptions?.length === 1, "Customization must have exactly one head option");
  const option = cc.headCustomizationOptions[0].Data;
  ensure(option.$type === "gameuiAppearanceInfo" && option.enabled === 1 && option.hidden === 0, "Selector is not an enabled visible appearance option");
  // Branding is display text supplied by the Studio plan (src/mod-branding.ts), never an identity.
  ensure(typeof plan.selectorLabel === "string" && /^XF(\s|$)/.test(plan.selectorLabel), "Plan lacks an XF-branded selector label");
  ensure(option.localizedName === plan.selectorLabel, "Selector label differs from the plan");
  const names = [plan.namespace, plan.selector, plan.component, value(off.name), value(template.name),
    ...plan.presets.map(p => p.appearance), ...plan.presets.map(p => p.appAppearance)];
  ensure(names.every(name => typeof name === "string" && name.startsWith("xfs_")), "A generated name lacks the xfs_ prefix");
  ensure(artifactPaths.every(path => baseName(path).startsWith("xfs_")), "A generated resource filename lacks the xfs_ prefix");
  ensure(value(option.name) === plan.selector && plan.selector === value(option.uiSlot) && dep(option.resource) === plan.app,
    "Selector name, slot or resource differs from the plan");
  ensure(option.definitions?.length === plan.presets.length + 1, "Selector must list Off plus every preset");
  ensure(value(option.definitions[0].name) === plan.offAppearance && option.defaultIndex === 0, "Selector default must be Off");
  // Restated independently of the builder: the creator screen reads `character_customization`; gameplay and
  // photo mode read `face` (vanilla eye makeup sits in both). A selector missing from `face` shows only in the creator.
  const groups = (cc.headGroups ?? []) as { name?: unknown; options?: unknown[] }[];
  ensure(sameJson(groups.map(group => value(group.name)), ["character_customization", "face"]),
    "Head groups must be exactly character_customization and face");
  ensure(groups.every(group => sameJson(group.options?.map(value), [plan.selector])), "A head group does not list exactly the selector");

  const resolved: ResolvedPreset[] = [];
  plan.presets.forEach((preset, i) => {
    const definition = option.definitions[i + 1];
    ensure(value(definition.name) === preset.appAppearance && definition.index === preset.index, `Selector definition ${i + 1} differs from the plan`);
    ensure(definition.localizedName === preset.name, `Selector definition ${i + 1} label differs from the preset name`);
    // Source-derived expansion model: app suffix -> mesh stub -> shared @preset template.
    const full = value(definition.name) as string, cut = full.lastIndexOf("__");
    ensure(cut >= 0, `Selector definition ${full} has no preset suffix`);
    const suffix = full.slice(cut + 2);
    ensure(suffix === preset.appearance && suffix.startsWith("xfs_"), `Selector suffix ${suffix} does not name the preset appearance`);
    const expanded = {} as ResolvedPreset["textures"];
    // Explicit chunk material, or the seed's template expanded with this appearance as its prefix.
    const entry = explicit(preset) ? materialOf(preset) : materialOf(seedPreset);
    const params = paramsByEntry.get(entry)!, route = routeOf(preset);
    ensure(entry === materialOf(preset), `Preset ${preset.name} would resolve to ${entry}, not its ${materialOf(preset)} material`);
    const accentEntry = glitterOf(preset)?.accent ? ACCENT_PREFIX + preset.id.replaceAll("-", "") : undefined;
    const bindings: (readonly [string, VerifierChannel, Record<string, Node>])[] = [
      ...ROUTE_SPEC[route].textures.map(([parameter, channel]) => [parameter, channel, params] as const),
      ...(accentEntry ? ACCENT_SPEC.textures.map(([parameter, channel]) => [parameter, channel as VerifierChannel, paramsByEntry.get(accentEntry)!] as const) : [])];
    const planned = Object.keys(preset.textures).sort(), routed: string[] = bindings.map(([, channel]) => channel).sort();
    ensure(sameJson(planned, routed), `Preset ${preset.name} plans textures ${planned.join(", ")} for its ${route} route`);
    for (const [parameter, channel, values] of bindings) {
      const reference = values[parameter];
      ensure(reference?.Flags === "Soft", `${parameter} is not a Soft reference`);
      const pattern = dep(reference);
      ensure(pattern.startsWith("*"), `${parameter} is not a dynamic path`);
      const path = pattern.slice(1).replaceAll("{material}", suffix);
      ensure(path === preset.textures[channel] && r.archiveHas(path), `${parameter} resolves to ${path}, not the planned generated texture`);
      expanded[channel] = path;
      const metadata = r.texture(path), setup = metadata.setup, dims = textureDims(preset, channel);
      ensure(metadata.width === dims.width && metadata.height === dims.height,
        `${path} is ${metadata.width}x${metadata.height}, expected ${dims.width}x${dims.height}`);
      ensure(setup.hasMipchain === 1 && setup.isGamma === CHANNEL_SETUP[channel].isGamma, `${path} has unexpected mip/gamma settings`);
      ensure(setup.compression === CHANNEL_SETUP[channel].compression, `${path} has unexpected compression`);
    }
    resolved.push({ appearance: preset.appAppearance, chunkMaterial: suffix + entry, textures: expanded });
  });
  return { appearanceNames: appearances, morphTargets: targetCount, materialTemplates: materials.length, meshAppearances: mesh.appearances.length,
    selectorOptionCount: option.definitions.length, resolved };
}

const isMap = (x: Node): boolean => !!x && typeof x === "object" && !Array.isArray(x);
const keysAre = (x: Node, keys: readonly string[]) => isMap(x) && sameJson(Object.keys(x).sort(), [...keys].sort());
const depotText = (path: string) => path.replaceAll("/", "\\");

/**
 * The parsed `.archive.xl` declaration must hold exactly the female customization registration and the
 * app's `player_customization.app` scope membership, with the planned depot paths, and nothing else.
 */
export function checkArchiveXl(plan: VerifierPlan, declaration: Node): void {
  ensure(keysAre(declaration, ["customizations", "resource"]), "ArchiveXL declaration must contain exactly customizations and resource");
  const custom = declaration.customizations;
  ensure(keysAre(custom, ["female"]), "ArchiveXL customizations must declare only the female list");
  const female = Array.isArray(custom.female) ? custom.female : [custom.female];
  ensure(sameJson(female, [depotText(plan.customization)]), "ArchiveXL declaration does not register exactly the planned customization");
  ensure(keysAre(declaration.resource, ["scope"]) && keysAre(declaration.resource.scope, ["player_customization.app"]),
    "ArchiveXL resource section must hold only the player_customization.app scope");
  const members = declaration.resource.scope["player_customization.app"];
  ensure(sameJson(Array.isArray(members) ? members : [members], [depotText(plan.app)]),
    "ArchiveXL scope does not list exactly the planned app");
}
