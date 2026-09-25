import { fresnelMaterial, HEAD_UV_ENTRY_SUFFIX, planPresetExport, ROUTE_CHANNELS, ROUTE_MATERIAL_ENTRY, ROUTE_UV_WINDOW, type ExportRoute,
  type FresnelMaterial, type TextureChannel } from "./finish-export";
import { parseExportDiagnostics, surfaceKey, type ExportDiagnostics, type PresetDiagnostics } from "./export-diagnostics";
import { EYE_MAKEUP_MOD } from "./mod-branding";
import { PLATE_LIFT_MM } from "./plate-lift";
import type { Recipe, RecipeFile } from "./recipe";
import { readRecipeFile, recipeFile } from "./recipe-schema";
import { EYE_MAKEUP_FEATURE, STUDIO_PARTS } from "./compose/studio-registry";
import { COLLECTION_2, type LookCollection } from "./platform/api";

export type PresetCollection = {
  // File-format compatibility ID; product branding does not change existing inputs.
  schema: "xfas/collection-1"; id: string; name: string;
  /** Each preset's recipe as a recipe file: collection-1 input keeps its schema; a look's part is written in the oldest that holds it. */
  presets: { id: string; name: string; revision: number; recipe: RecipeFile }[];
  /** Diagnostic-only export knobs of a prepared test candidate (export-diagnostics.ts); never authored in the Studio. */
  diagnostics?: ExportDiagnostics;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120;

/**
 * The eye-makeup package pipeline's view of a collection: `xfas/collection-1`, one recipe per
 * preset. It reads `xfas/collection-1` as it always has, and `xfs/collection-2` through the
 * look reader (`eyeMakeupCollection`), so exported files of either schema build the same.
 * Identity is independent of display names, revisions and collection order.
 */
export function parseCollection(value: unknown, allowEmpty = false): PresetCollection {
  if ((value as { schema?: unknown } | null)?.schema === COLLECTION_2) {
    const view = eyeMakeupCollection(STUDIO_PARTS.readCollection(value, allowEmpty));
    if (!allowEmpty && !view.presets.length) throw Error("This collection has no eye-makeup looks to build.");
    return view;
  }
  const input = value as PresetCollection;
  if (!input || input.schema !== "xfas/collection-1" || !uuid.test(input.id ?? "") || !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
    throw Error("Expected a named XF Studio collection with a stable UUID and at least one preset.");
  const seen = new Set<string>();
  const presets = input.presets.map(p => {
    if (!p || !uuid.test(p.id ?? "") || seen.has(p.id) || !title(p.name) || !Number.isSafeInteger(p.revision) || p.revision < 1)
      throw Error("Preset identities must be unique UUIDs with a name and positive revision.");
    seen.add(p.id);
    return { id:p.id,name:p.name,revision:p.revision,recipe:readRecipeFile(p.recipe) };
  });
  return { schema:input.schema,id:input.id,name:input.name,presets };
}

/**
 * The eye-makeup view of a look collection: each look that has an eye-makeup part, with that
 * part as its recipe file (the oldest recipe schema that holds it). A look without one is not
 * eye makeup, so the eye-makeup mod has nothing of it to package. Each recipe is a copy.
 */
export function eyeMakeupCollection(collection: LookCollection): PresetCollection {
  return { schema: "xfas/collection-1", id: collection.id, name: collection.name,
    presets: collection.presets.flatMap(look => {
      const recipe = STUDIO_PARTS.part<Recipe>(look, EYE_MAKEUP_FEATURE);
      if (!recipe) return [];
      // Every layer model this build registers has a recipe schema; one without needs its own exporter first.
      const file = recipeFile(recipe);
      if (!file) throw Error(`${look.name} uses a layer model the eye-makeup export cannot build yet.`);
      return [{ id: look.id, name: look.name, revision: look.revision, recipe: file }];
    }) };
}

/** Texture depot paths of one preset; the channels present depend on its export route. */
export type PlanTextures = Partial<Record<TextureChannel, string>>;

/** 32-bit FNV-1a of a string's UTF-16 code units, as eight hex digits (browser-safe; not a security hash). */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/** Material entry of a flat preset with a diagnostic surface override: one entry per distinct override. */
export const diagnosticFlatEntry = (surface: NonNullable<PresetDiagnostics["surface"]>) => "@flat_" + fnv1a32(surfaceKey(surface));

export function planCollection(value: unknown) {
  const collection = parseCollection(value), key = collection.id.replaceAll("-", "");
  // Diagnostic knobs travel only inside exported files (export-diagnostics.ts); a normal collection has none.
  const diagnostics = parseExportDiagnostics((value as { diagnostics?: unknown } | null)?.diagnostics, collection.presets.map(p => p.id));
  const liftOf = (id: string) => diagnostics?.presets[id]?.plateLiftMm ?? PLATE_LIFT_MM;
  // One plate render chunk per distinct lift, ascending; a normal collection has the one production lift.
  const liftsMm = [...new Set(collection.presets.map(p => liftOf(p.id)))].sort((a, b) => a - b);
  const namespace = `xfs_c${key}`, depot = `axefrog/appearance_studio/collections/${key}`;
  const presets = collection.presets.map((preset, i) => {
    const appearance = `xfs_p${preset.id.replaceAll("-", "")}`;
    // The export route decides the material template entry and which texture channels exist.
    const exported = planPresetExport(preset.recipe), route: ExportRoute = exported.route;
    const surface = diagnostics?.presets[preset.id]?.surface;
    if (surface && route !== "flat") throw Error(`Diagnostic surface overrides apply only to flat presets; ${preset.name} is ${route}.`);
    // Texture space: the plate-local UV window where the route's template can transform UVs, unless a
    // diagnostic keeps the preset on head UV. Head-UV flat/faceted presets use their own material entry.
    const headKnob = diagnostics?.presets[preset.id]?.uvSpace === "head";
    if (headKnob && !ROUTE_UV_WINDOW[route]) throw Error(`The ${route} route is always on head UV; ${preset.name} cannot set uvSpace.`);
    const uvSpace: "plate-window" | "head" = ROUTE_UV_WINDOW[route] && !headKnob ? "plate-window" : "head";
    const material = route === "fresnel" ? `@fresnel_${preset.id.replaceAll("-", "")}`
      : (surface ? diagnosticFlatEntry(surface) : ROUTE_MATERIAL_ENTRY[route]) + (headKnob ? HEAD_UV_ENTRY_SUFFIX : "");
    const presetDiagnostics = diagnostics?.presets[preset.id];
    // A colour-shift preset's material constants (its one shift colour) are part of the plan.
    const fresnel: FresnelMaterial | undefined = route === "fresnel" ? fresnelMaterial(exported.included[0].optics!.shift!) : undefined;
    return { ...preset, index:i+1, appearance, appAppearance:`${namespace}__${appearance}`, route, material, uvSpace, ...(fresnel ? { fresnel } : {}),
      plateChunk:liftsMm.indexOf(liftOf(preset.id)), ...(presetDiagnostics ? { diagnostics:presetDiagnostics } : {}),
      textures:Object.fromEntries(ROUTE_CHANNELS[route].map(channel => [channel,`${depot}/textures/${appearance}_${channel}.xbm`])) as PlanTextures };
  });
  // Branding (modName/selectorLabel) is display text, never part of a resource identity.
  return { schema:"xfas/export-plan-1" as const, collectionId:collection.id, name:collection.name,
    modName:EYE_MAKEUP_MOD.modName, selectorLabel:EYE_MAKEUP_MOD.selectorLabel, namespace, depot,
    selector:namespace, component:`${namespace}_makeup`, offAppearance:"xfs_off", templateAppearance:`${namespace}__xfs_template`,
    app:`${depot}/xfs_collection.app`, customization:`${depot}/xfs_collection.inkcharcustomization`,
    mesh:`${depot}/models/xfs_eye_plate.mesh`, morph:`${depot}/models/xfs_eye_plate.morphtarget`,
    // The packaged plate: one render chunk per lift (mm along the head's normals), in this order.
    plate:{ liftsMm },
    presets, requirements:{ArchiveXL:"1.27.3",game:"2.31"},
    limitations:["Appearance names are stable; game save/index persistence across reorder/removal still requires runtime proof.",
      "One pack creates one selector. Multi-pack aggregation into one global selector is not implemented."] };
}
