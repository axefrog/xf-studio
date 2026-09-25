// Game-export route policy for makeup finishes. Pure: no IO, no UI, no WolvenKit.
//
// One authored preset becomes one decal draw on the eye plate, so every active layer of a
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
// Glitter has no route: no stock template can show individual sub-pixel glints.
import { canonicalFinish, type Finish } from "./finish";
import type { GameOptics, Layer, Recipe } from "./recipe";

export type ExportRoute = "flat" | "faceted" | "fresnel";
export type ExportAdapterId = "mesh-decal-flat-v1" | "mesh-decal-faceted-v1" | "mesh-decal-fresnel-v1";
export const ROUTE_ADAPTER: Record<ExportRoute, ExportAdapterId> = {
  flat: "mesh-decal-flat-v1", faceted: "mesh-decal-faceted-v1", fresnel: "mesh-decal-fresnel-v1",
};
/** Local material template entry each route's presets bind to (`<appearance>@<entry>`). */
export const ROUTE_MATERIAL_ENTRY: Record<Exclude<ExportRoute, "fresnel">, string> = { flat: "@preset", faceted: "@faceted" };

/** Constant surface values for finishes that carry no per-texel optical map. */
export const FLAT_SURFACE: Readonly<Record<"matte" | "regular" | "metallic" | "glossy", { roughness: number; metalness: number }>> = {
  matte: { roughness: .88, metalness: 0 },
  regular: { roughness: .38, metalness: 0 },
  metallic: { roughness: .27, metalness: .65 },
  // One G-buffer lobe: a low-roughness dielectric. The engine clamps roughness at 0.04 and
  // fixes dielectric F0 at 0.04, so gloss can only sharpen the skin's own reflection.
  glossy: { roughness: .12, metalness: 0 },
};
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

const gameModel = (layer: Pick<Layer, "optics">): layer is { optics: GameOptics } => layer.optics?.model === "game-matched-1";
const earlierModel = (label: string, what: string) =>
  `This layer uses the earlier ${label} preview (${what}), which the game cannot draw. Switch it to the game-matched model in the Finish panel to include it.`;

/** Export status of one layer's finish, independent of the rest of its preset. */
export function layerExport(layer: Pick<Layer, "finish" | "optics" | "flakes">): LayerExport {
  const finish = canonicalFinish(layer.finish);
  if (finish === "matte" || finish === "regular" || finish === "metallic")
    return { exportable: true, route: "flat", adapter: ROUTE_ADAPTER.flat, experimental: false,
      note: "Flat colour with provisional roughness and metalness." };
  if (finish === "glossy") return gameModel(layer)
    ? { exportable: true, route: "flat", adapter: ROUTE_ADAPTER.flat, experimental: true,
      note: "Experimental single-lobe gloss: one smooth reflection, no separate clear coat. Needs in-game confirmation." }
    : { exportable: false, reason: earlierModel("Glossy", "a separate clear coat") };
  if (finish === "shimmer") {
    if (!gameModel(layer)) return { exportable: false, reason: earlierModel("Shimmer", "browser-only facet filtering") };
    if (layer.flakes && "model" in layer.flakes) return { exportable: false, reason: "Shimmer needs the classic flake settings." };
    return { exportable: true, route: "faceted", adapter: ROUTE_ADAPTER.faceted, experimental: true,
      note: "Experimental facet normals over the skin normal; fine facets merge into a broader sheen at distance. Needs in-game confirmation." };
  }
  if (finish === "iridescent") return gameModel(layer) && layer.optics.shift
    ? { exportable: true, route: "fresnel", adapter: ROUTE_ADAPTER.fresnel, experimental: true,
      note: "Experimental two-tone Fresnel tint: one shift colour added toward grazing angles. Needs in-game confirmation." }
    : { exportable: false, reason: earlierModel("Colour-shifting", "a fixed thin-film study with no chosen shift colour") };
  return { exportable: false, reason: "No game material can show individual glitter flakes yet, so Glitter stays preview-only." };
}

const active = (layer: Pick<Layer, "enabled" | "opacity">) => layer.enabled && layer.opacity > 0;
const fresnelKey = (layer: Layer) => JSON.stringify([layer.color.toLowerCase(), layer.optics?.shift?.color.toLowerCase(), layer.optics?.shift?.strength]);
export const FRESNEL_PRESET_RULE = "Colour-shifting exports only when every active layer in the preset is Colour-shifting with the same colour, shift colour and strength: the game adds one shift tint to the whole preset.";

export type PresetExportPlan = {
  route: ExportRoute;
  /** Active layers the route can carry, in recipe order. */
  included: Layer[];
  /** Active layers the route cannot carry, with the reason. */
  excluded: { layer: Layer; reason: string }[];
};

/** Choose one route for a preset and split its active layers into included and excluded. */
export function planPresetExport(recipe: Pick<Recipe, "layers">): PresetExportPlan {
  const layers = recipe.layers.filter(active);
  const status = layers.map(layer => ({ layer, result: layerExport(layer) }));
  const excluded: PresetExportPlan["excluded"] = [];
  const exportable: { layer: Layer; route: ExportRoute }[] = [];
  for (const { layer, result } of status) {
    if (result.exportable) exportable.push({ layer, route: result.route });
    else excluded.push({ layer, reason: result.reason });
  }
  const fresnel = exportable.filter(item => item.route === "fresnel");
  if (fresnel.length) {
    const whole = fresnel.length === layers.length && new Set(fresnel.map(item => fresnelKey(item.layer))).size === 1;
    if (whole) return { route: "fresnel", included: fresnel.map(item => item.layer), excluded: [] };
    for (const item of fresnel) excluded.push({ layer: item.layer, reason: FRESNEL_PRESET_RULE });
  }
  const included = exportable.filter(item => item.route !== "fresnel");
  const route: ExportRoute = included.some(item => item.route === "faceted") ? "faceted" : "flat";
  const order = new Map(layers.map((layer, i) => [layer, i]));
  excluded.sort((a, b) => order.get(a.layer)! - order.get(b.layer)!);
  return { route, included: included.map(item => item.layer), excluded };
}

/** Route of an already-filtered preset (every active layer is carried); lenient for unfiltered input. */
export function presetRoute(recipe: Pick<Recipe, "layers">): ExportRoute {
  return planPresetExport(recipe).route;
}

/** Texture channels each route writes per preset, in plan order. */
export const ROUTE_CHANNELS = {
  flat: ["diffuse", "roughness", "metalness"],
  faceted: ["diffuse", "roughness", "metalness", "normal"],
  fresnel: ["mask", "gradient"],
} as const satisfies Record<ExportRoute, readonly string[]>;
export type TextureChannel = "diffuse" | "roughness" | "metalness" | "normal" | "mask" | "gradient";

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
  const id = canonicalFinish(finish);
  if (id === "matte" || id === "regular" || id === "metallic")
    return { adapter: "flat-provisional", note: "Can be built into your mod as a flat colour. How it looks in game hasn't been tested yet." };
  if (id === "glossy") return { adapter: "experimental", note: "Experimental: exports as one smooth reflection (the game has no separate clear coat). Not yet tested in game." };
  if (id === "shimmer") return { adapter: "experimental", note: "Experimental: exports as fine facet normals that merge into a sheen at distance. Not yet tested in game." };
  if (id === "iridescent") return { adapter: "experimental", note: "Experimental: exports as a two-tone Fresnel tint when the whole preset is one colour-shift pigment. Not yet tested in game." };
  return { adapter: "none", note: "Preview only in this alpha. Check and Build leave out layers with this finish and tell you which." };
}
