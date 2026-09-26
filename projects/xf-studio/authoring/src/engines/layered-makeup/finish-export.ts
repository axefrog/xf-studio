// Game-export route policy for makeup finishes. Pure: no IO, no UI, no WolvenKit.
//
// One authored preset becomes one decal draw on the feature's surface (eye makeup's: the eye plate), so every active layer of a
// preset must be expressible by the same stock material template. The engine facts behind
// each route are in research/materials/finish-designs/ and knowledge/materials-and-shaders.md §6:
//
// - "flat"    base/materials/mesh_decal.mt: colour, roughness and metalness per texel.
//             Matte, Satin, Metallic, and the game-matched single-lobe Glossy.
// - "faceted" the same template plus a tangent normal map in NormalsBlendingMode 1
//             (reoriented composite with the skin normal; flat texels leave it untouched).
//             Game-matched Shimmer; other flat finishes may share the preset.
// - "fresnel" base/materials/mesh_decal_gradientmap_recolor_blendable.mt: a base colour plus
//             FresnelColor·intensity·(1−N·V)^exponent added before the G-buffer square root.
//             The addition is per draw, not per texel, so a colour-shift preset must consist
//             of one colour-shift pigment only.
//
// - "glitter" (diagnostic only) the same template with resolved flakes: a flake normal map, a separate flake
//             mask (NormalAlphaTex) and nested mips (glitter-route.ts), optionally with an emissive accent on a
//             second plate chunk. Only a collection's diagnostic `glitter` knob selects it (export-diagnostics.ts).
//
// The Glitter *finish* has no route: no stock template can show individual sub-pixel glints, so Glitter layers
// are omitted with a reason. The diagnostic route above draws authored flake fields over flat-finish pigment
// layers for an in-game test; it does not make the Glitter finish exportable.
import { canonicalFinish, finishLabel, type Finish } from "./finish";
import type { GameOptics, Layer, Recipe } from "./recipe";

export type ExportRoute = "flat" | "faceted" | "fresnel" | "glitter";
export type ExportAdapterId = "mesh-decal-flat-v1" | "mesh-decal-faceted-v1" | "mesh-decal-fresnel-v1" | "mesh-decal-glitter-diagnostic-v1";
export const ROUTE_ADAPTER: Record<ExportRoute, ExportAdapterId> = {
  flat: "mesh-decal-flat-v1", faceted: "mesh-decal-faceted-v1", fresnel: "mesh-decal-fresnel-v1", glitter: "mesh-decal-glitter-diagnostic-v1",
};
/** Local material template entry each route's presets bind to (`<appearance>@<entry>`). */
export const ROUTE_MATERIAL_ENTRY: Record<Exclude<ExportRoute, "fresnel">, string> = { flat: "@preset", faceted: "@faceted", glitter: "@glitter" };
/** Entry prefix of a diagnostic glitter preset's emissive accent material (one per accent preset, on the accent chunk). */
export const ACCENT_ENTRY_PREFIX = "@accent_";

/**
 * Whether each route's textures may use a plate-local UV window: `mesh_decal` transforms every texture UV by
 * UVScale/UVOffset, so the flat, faceted and diagnostic Glitter routes can; the gradient-recolour template of the
 * Fresnel route has no UV transform (its only UV math is the flipbook), so it stays on head UV. The texture grids
 * themselves are the region's (`LayeredMakeupRegion.textures`).
 */
export const ROUTE_UV_WINDOW: Record<ExportRoute, boolean> = { flat: true, faceted: true, fresnel: false, glitter: true };
/** Entry suffix of a flat or faceted preset that a diagnostic keeps on head UV (no UV transform). */
export const HEAD_UV_ENTRY_SUFFIX = "_head";

/** Colour-shifting base surface: a soft, slightly metallic sheen under the Fresnel tint. */
export const FRESNEL_SURFACE = { roughness: .32, metalness: .25 } as const;
/** Shift strength 1 maps to this FresnelColorIntensity (before scaling by the colour's peak channel). */
export const FRESNEL_MAX_INTENSITY = 2;
/** The template's default exponent; the angle weight is saturate(|1 − N·V|^exponent). */
export const FRESNEL_EXPONENT = 2;
/** The template's vertex program fades the Fresnel term with horizontal camera-to-object distance:
 * w = max(1 + modifier − saturate((d − FadeOutOffset)/FadeOutDistance), 0). Its defaults (0.2 m, 0.5 m)
 * would remove the tint beyond 0.7 m, so exports push the fade far away. */
export const FRESNEL_FADE = { FadeOutOffset: 1000, FadeOutDistance: 1 } as const;

export type LayerExport =
  | { exportable: true; route: ExportRoute; adapter: ExportAdapterId; experimental: boolean; note: string }
  | { exportable: false; reason: string };

type FinishId = ReturnType<typeof canonicalFinish>;
type Surface = { readonly roughness: number; readonly metalness: number };
/** One row of the per-finish export table. */
export interface FinishExportRule {
  /** The finish has a game-matched optics model, and only that model exports; earlier preview models stay preview-only. */
  readonly gameOptics: boolean;
  /** Route that carries an exportable layer; null when no stock material can draw the finish. */
  readonly route: ExportRoute | null;
  /** Built from the game's own materials but not yet confirmed in game. */
  readonly experimental: boolean;
  /** Constant roughness and metalness of a flat-route finish (no per-texel optical map). */
  readonly surface?: Surface;
  /** Check's note on an included layer. */
  readonly layerNote: string;
  /** The finish catalogue's summary of its export status. */
  readonly summary: string;
  /** What a layer's earlier preview model did, named when it cannot be exported. */
  readonly earlierModel?: string;
  /** Why no layer with this finish can be exported. */
  readonly refusal?: string;
}

const FLAT_NOTE = "Flat colour with provisional roughness and metalness.";
const FLAT_SUMMARY = "Can be built into your mod as a flat colour. How it looks in game hasn't been tested yet.";
/**
 * The single per-finish export table: game-optics support, route, surface and user-facing notes. The
 * catalogue, recipe validation, preview surfaces and compiler derive from it. The independent verifier
 * restates it on purpose (mod-verifier/resource-checks.ts); a test fails if the two disagree.
 */
export const FINISH_EXPORT = {
  matte: { gameOptics: false, route: "flat", experimental: false, surface: { roughness: .88, metalness: 0 }, layerNote: FLAT_NOTE, summary: FLAT_SUMMARY },
  regular: { gameOptics: false, route: "flat", experimental: false, surface: { roughness: .38, metalness: 0 }, layerNote: FLAT_NOTE, summary: FLAT_SUMMARY },
  metallic: { gameOptics: false, route: "flat", experimental: false, surface: { roughness: .27, metalness: .65 }, layerNote: FLAT_NOTE, summary: FLAT_SUMMARY },
  // One G-buffer lobe: a low-roughness dielectric. The engine clamps roughness at 0.04 and
  // fixes dielectric F0 at 0.04, so gloss can only sharpen the skin's own reflection.
  glossy: { gameOptics: true, route: "flat", experimental: true, surface: { roughness: .12, metalness: 0 },
    layerNote: "Experimental single-lobe gloss: one smooth reflection, no separate clear coat. Needs in-game confirmation.",
    summary: "Experimental: exports as one smooth reflection (the game has no separate clear coat). Not yet tested in game.",
    earlierModel: "a separate clear coat" },
  shimmer: { gameOptics: true, route: "faceted", experimental: true,
    layerNote: "Experimental facet normals over the skin normal; fine facets merge into a broader sheen at distance. Needs in-game confirmation.",
    summary: "Experimental: exports as fine facet normals that merge into a sheen at distance. Not yet tested in game.",
    earlierModel: "browser-only facet filtering" },
  iridescent: { gameOptics: true, route: "fresnel", experimental: true,
    layerNote: "Experimental two-tone Fresnel tint: one shift colour added toward grazing angles. Needs in-game confirmation.",
    summary: "Experimental: exports as a two-tone Fresnel tint when the whole preset is one colour-shift pigment. Not yet tested in game.",
    earlierModel: "a fixed thin-film study with no chosen shift colour" },
  glitter: { gameOptics: false, route: null, experimental: false, layerNote: "",
    summary: "Preview only for now. Check and Build leave out layers with this finish and tell you which.",
    refusal: "No game material can show individual glitter flakes yet, so Glitter stays preview-only." },
} as const satisfies Record<FinishId, FinishExportRule>;

/** Export rule of a finish (the legacy `satin` reads as Satin, `regular`). */
export const finishExportRule = (finish: Finish): FinishExportRule => FINISH_EXPORT[canonicalFinish(finish)];
/** Constant surface of a flat-route finish; undefined for finishes with per-texel optics or no route. */
export const flatSurface = (finish: Finish): Surface | undefined => finishExportRule(finish).surface;
/** The finish has a game-matched optics model (recipe validation, finish actions and export read this). */
export const hasGameOptics = (finish: Finish): boolean => finishExportRule(finish).gameOptics;

const gameModel = (layer: Pick<Layer, "optics">): layer is { optics: GameOptics } => layer.optics?.model === "game-matched-1";
const capitalised = (finish: Finish) => { const name = finishLabel(finish); return name[0].toUpperCase() + name.slice(1); };
const earlierModel = (finish: Finish, what: string) =>
  `This layer uses the earlier ${capitalised(finish)} preview (${what}), which the game cannot draw. Switch it to the game-matched model in the Finish panel to include it.`;

/** Export status of one layer's finish, independent of the rest of its preset. */
export function layerExport(layer: Pick<Layer, "finish" | "optics" | "flakes">): LayerExport {
  const rule = finishExportRule(layer.finish);
  if (!rule.route) return { exportable: false, reason: rule.refusal ?? "The game cannot draw this finish yet." };
  if (rule.gameOptics && !gameModel(layer)) return { exportable: false, reason: earlierModel(layer.finish, rule.earlierModel ?? "a browser-only study") };
  const finish = canonicalFinish(layer.finish);
  if (finish === "shimmer" && layer.flakes && "model" in layer.flakes) return { exportable: false, reason: "Shimmer needs the classic flake settings." };
  if (finish === "iridescent" && !layer.optics?.shift) return { exportable: false, reason: earlierModel(layer.finish, rule.earlierModel ?? "no chosen shift colour") };
  return { exportable: true, route: rule.route, adapter: ROUTE_ADAPTER[rule.route], experimental: rule.experimental, note: rule.layerNote };
}

const active = (layer: Pick<Layer, "enabled" | "opacity">) => layer.enabled && layer.opacity > 0;
const fresnelKey = (layer: Layer) => JSON.stringify([layer.color.toLowerCase(), layer.optics?.shift?.color.toLowerCase(), layer.optics?.shift?.strength]);
export const FRESNEL_PRESET_RULE = "Colour-shifting exports only when every other layer the game can draw in this preset is Colour-shifting with the same colour, shift colour and strength: the game adds one shift tint to the whole preset.";

export type PresetExportPlan = {
  route: ExportRoute;
  /** Active layers the route can carry, in recipe order. */
  included: Layer[];
  /** Active layers the route cannot carry, with the reason. */
  excluded: { layer: Layer; reason: string }[];
};

/** Choose one route for a preset and split its active layers into included and excluded.
 * Layers no route can carry (Glitter, earlier preview models) are left out first; the
 * colour-shift "one pigment" rule then applies to the layers that remain exportable. */
export function planPresetExport(recipe: Pick<Recipe, "layers">): PresetExportPlan {
  const layers = recipe.layers.filter(active);
  const status = layers.map(layer => ({ layer, result: layerExport(layer) }));
  const excluded: PresetExportPlan["excluded"] = [];
  const exportable: { layer: Layer; route: ExportRoute }[] = [];
  for (const { layer, result } of status) {
    if (result.exportable) exportable.push({ layer, route: result.route });
    else excluded.push({ layer, reason: result.reason });
  }
  const order = new Map(layers.map((layer, i) => [layer, i]));
  const sorted = () => excluded.sort((a, b) => order.get(a.layer)! - order.get(b.layer)!);
  const fresnel = exportable.filter(item => item.route === "fresnel");
  if (fresnel.length) {
    const whole = fresnel.length === exportable.length && new Set(fresnel.map(item => fresnelKey(item.layer))).size === 1;
    if (whole) return { route: "fresnel", included: fresnel.map(item => item.layer), excluded: sorted() };
    for (const item of fresnel) excluded.push({ layer: item.layer, reason: FRESNEL_PRESET_RULE });
  }
  const included = exportable.filter(item => item.route !== "fresnel");
  const route: ExportRoute = included.some(item => item.route === "faceted") ? "faceted" : "flat";
  return { route, included: included.map(item => item.layer), excluded: sorted() };
}

/** Texture channels each route writes per preset, in plan order. */
export const ROUTE_CHANNELS = {
  flat: ["diffuse", "roughness", "metalness"],
  faceted: ["diffuse", "roughness", "metalness", "normal"],
  fresnel: ["mask", "gradient"],
  // `flakes` is the NormalAlphaTex flake mask; a preset with an emissive accent adds `accent` (its head-UV mask).
  glitter: ["diffuse", "roughness", "metalness", "normal", "flakes"],
} as const satisfies Record<ExportRoute, readonly string[]>;
export type TextureChannel = "diffuse" | "roughness" | "metalness" | "normal" | "mask" | "gradient" | "flakes" | "accent";

const toByte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Fresnel colour constants for a shift colour and strength (0–1). The colour is normalised to its
 * peak linear channel (most byte precision) and the peak moves into the intensity. */
export function fresnelConstants(shift: { color: string; strength: number }) {
  const linear = [1, 3, 5].map(i => srgbDecode(parseInt(shift.color.slice(i, i + 2), 16) / 255)), peak = Math.max(...linear);
  const [Red, Green, Blue] = peak > 0 ? linear.map(v => toByte(v / peak)) : [0, 0, 0];
  return { FresnelColor: { Red, Green, Blue, Alpha: 255 },
    FresnelColorIntensity: Math.round(FRESNEL_MAX_INTENSITY * shift.strength * peak * 1e6) / 1e6,
    FresnelExponent: FRESNEL_EXPONENT };
}

/** Material constants of a Fresnel preset: fixed surface, distance fade pushed away and the shift colour. */
export function fresnelMaterial(shift: { color: string; strength: number }) {
  return { DiffuseColor: "white", DiffuseAlpha: 1, RoughnessMetalnessAlpha: 1, NormalAlpha: 0, AlphaMaskContrast: 0,
    SecondaryMaskInfluence: 0, RoughnessScale: 0, RoughnessBias: FRESNEL_SURFACE.roughness, MetalnessScale: 0,
    MetalnessBias: FRESNEL_SURFACE.metalness, ...FRESNEL_FADE, ...fresnelConstants(shift) };
}
export type FresnelMaterial = ReturnType<typeof fresnelMaterial>;

/** User-facing description of a finish's export status, shared by the catalogue and Check. */
export function finishExportSummary(finish: Finish): { adapter: "flat-provisional" | "experimental" | "none"; note: string } {
  const rule = finishExportRule(finish);
  return { adapter: !rule.route ? "none" : rule.experimental ? "experimental" : "flat-provisional", note: rule.summary };
}
