import { ACCENT_ENTRY_PREFIX, fresnelMaterial, HEAD_UV_ENTRY_SUFFIX, planPresetExport, ROUTE_CHANNELS, ROUTE_MATERIAL_ENTRY, ROUTE_UV_WINDOW,
  type ExportRoute, type FresnelMaterial, type TextureChannel } from "./engines/layered-makeup/finish-export";
import { accentConstants, parseExportDiagnostics, surfaceKey, type ExportDiagnostics, type PresetDiagnostics } from "./export-diagnostics";
import { checkRegionPlan } from "./glitter-region";
import { EYE_MAKEUP_MOD } from "./mod-branding";
import { PLATE_LIFT_MM } from "./plate-lift";
import type { Recipe } from "./engines/layered-makeup/recipe";
import { EYE_MAKEUP_FEATURE, EYE_MAKEUP_PART_2, parseEyeMakeupPart, readRecipeFile, recipeFile, type RecipeFile } from "./recipe-schema";
import { COLLECTION_2, type Look, type LookCollection } from "./platform/api";

/**
 * A look, or one part of a look, that the eye-makeup mod does not package, as its view of a
 * collection records it (CORE-34): a look without eye makeup, or a part of another feature,
 * which has no mod exporter yet. Check, Build and the manifest report each one.
 */
export type LookOmission = { presetId: string; presetName: string; reason: string;
  /** The omitted part's feature; absent when the whole look is omitted. */
  feature?: string };
export const NO_EYE_MAKEUP_REASON = "It has no eye makeup.";
export const NO_EXPORTER_REASON = "XF Studio can't make mod files for this part yet.";
export const NEWER_LOOK_REASON = "It was made with a newer version of XF Studio.";

export type PresetCollection = {
  // File-format compatibility ID; product branding does not change existing inputs.
  schema: "xfas/collection-1"; id: string; name: string;
  /** Each preset's recipe as a recipe file: collection-1 input keeps its schema; a look's part is written in the oldest that holds it. */
  presets: { id: string; name: string; revision: number; recipe: RecipeFile }[];
  /** Diagnostic-only export knobs of a prepared test candidate (export-diagnostics.ts); never authored in the Studio. */
  diagnostics?: ExportDiagnostics;
  /** Looks and parts of the source collection this view leaves out; absent when it holds everything. */
  omitted?: LookOmission[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const title = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120;
const FEATURE_KEY = /^[a-z][a-zA-Z0-9]*(?:-[a-z0-9]+)*$/;
const COLLECTION_MESSAGE = "Expected a named XF Studio collection with a stable UUID and at least one preset.";
const PRESET_MESSAGE = "Preset identities must be unique UUIDs with a name and positive revision.";

/**
 * The eye-makeup package pipeline's view of a collection: `xfas/collection-1`, one recipe per
 * preset. It reads `xfas/collection-1` as it always has, and `xfs/collection-2` by reading each
 * look's eye-makeup part itself (the exporter needs no other feature's codec), so exported files
 * of either schema build the same. Looks and parts it leaves out are listed in `omitted`.
 * Identity is independent of display names, revisions and collection order.
 */
export function parseCollection(value: unknown, allowEmpty = false): PresetCollection {
  if ((value as { schema?: unknown } | null)?.schema === COLLECTION_2) {
    const view = eyeMakeupView(readStoredLooks(value, allowEmpty), false);
    if (!allowEmpty && !view.presets.length) throw Error("This collection has no eye-makeup looks to build.");
    return view;
  }
  const input = value as PresetCollection;
  if (!input || input.schema !== "xfas/collection-1" || !uuid.test(input.id ?? "") || !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
    throw Error(COLLECTION_MESSAGE);
  const seen = new Set<string>();
  const presets = input.presets.map(p => {
    if (!p || !uuid.test(p.id ?? "") || seen.has(p.id) || !title(p.name) || !Number.isSafeInteger(p.revision) || p.revision < 1)
      throw Error(PRESET_MESSAGE);
    seen.add(p.id);
    return { id:p.id,name:p.name,revision:p.revision,recipe:readRecipeFile(p.recipe) };
  });
  const omitted = readOmitted(input.omitted);
  return { schema:input.schema,id:input.id,name:input.name,presets, ...(omitted ? { omitted } : {}) };
}

/**
 * The eye-makeup view of an in-memory look collection (its parts already parsed, as the draft's
 * are): each look that has an eye-makeup part, with that part as its recipe file (the oldest
 * recipe schema that holds it). A look without one is not eye makeup, and another feature's part
 * has no exporter yet: both are listed in `omitted`, never dropped silently.
 */
export function eyeMakeupCollection(collection: LookCollection): PresetCollection {
  return eyeMakeupView(collection, true);
}

function eyeMakeupView(collection: LookCollection, parsed: boolean): PresetCollection {
  const omitted: LookOmission[] = [];
  const presets = collection.presets.flatMap(look => {
    // A look this build cannot read (kept exactly as it came) cannot become mod files here.
    if (look.locked) { omitted.push({ presetId: look.id, presetName: look.name, reason: NEWER_LOOK_REASON }); return []; }
    for (const feature of Object.keys(look.parts)) if (feature !== EYE_MAKEUP_FEATURE)
      omitted.push({ presetId: look.id, presetName: look.name, feature, reason: NO_EXPORTER_REASON });
    const envelope = look.parts[EYE_MAKEUP_FEATURE];
    if (!envelope) { omitted.push({ presetId: look.id, presetName: look.name, reason: NO_EYE_MAKEUP_REASON }); return []; }
    const recipe = parsed && envelope.schema === EYE_MAKEUP_PART_2 ? envelope.body as Recipe : parseEyeMakeupPart(envelope);
    // Every layer model this build registers has a recipe schema; one without needs its own exporter first.
    const file = recipeFile(recipe);
    if (!file) throw Error(`${look.name} uses a layer model the eye-makeup export cannot build yet.`);
    return [{ id: look.id, name: look.name, revision: look.revision, recipe: structuredClone(file) }];
  });
  return { schema: "xfas/collection-1", id: collection.id, name: collection.name, presets,
    ...(omitted.length ? { omitted } : {}) };
}

/** A stored `xfs/collection-2` collection's identities and part envelopes (parts are read by the view). */
function readStoredLooks(value: unknown, allowEmpty: boolean): LookCollection {
  const input = value as { id?: string; name?: unknown; presets?: unknown };
  if (!uuid.test(input.id ?? "") || !title(input.name) || !Array.isArray(input.presets) || (!allowEmpty && !input.presets.length))
    throw Error(COLLECTION_MESSAGE);
  const seen = new Set<string>();
  const presets = input.presets.map((item): Look => {
    const p = item as Partial<Look> | null;
    if (!p || !uuid.test(p.id ?? "") || seen.has(p.id!) || !title(p.name) || !Number.isSafeInteger(p.revision) || p.revision! < 1)
      throw Error(PRESET_MESSAGE);
    seen.add(p.id!);
    const parts = p.parts;
    if (!parts || typeof parts !== "object" || Array.isArray(parts)) throw Error(`Preset ${p.name} has no parts.`);
    for (const [feature, envelope] of Object.entries(parts))
      if (!FEATURE_KEY.test(feature) || feature.length > 64 || !envelope || typeof envelope !== "object" ||
          typeof (envelope as { schema?: unknown }).schema !== "string" || !("body" in envelope))
        throw Error(`Preset ${p.name} has a damaged part.`);
    return { id: p.id!, name: p.name!, revision: p.revision!, parts };
  });
  return { schema: COLLECTION_2, id: input.id!, name: input.name as string, presets };
}

/** The `omitted` list a view carries to the package host (validated, bounded). */
function readOmitted(value: unknown): LookOmission[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 4096) throw Error("Invalid omitted looks.");
  return value.map(item => {
    const entry = item as Partial<LookOmission> | null;
    if (!entry || !uuid.test(entry.presetId ?? "") || !title(entry.presetName) || typeof entry.reason !== "string" ||
        !entry.reason || entry.reason.length > 240 ||
        (entry.feature !== undefined && (typeof entry.feature !== "string" || !FEATURE_KEY.test(entry.feature) || entry.feature.length > 64)))
      throw Error("Invalid omitted looks.");
    return { presetId: entry.presetId!, presetName: entry.presetName!, reason: entry.reason,
      ...(entry.feature !== undefined ? { feature: entry.feature } : {}) };
  });
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
  // A diagnostic glitter accent draws on one more chunk after them, at the lift of the presets that carry one.
  const accentLifts = [...new Set(collection.presets.filter(p => diagnostics?.presets[p.id]?.glitter?.accent).map(p => liftOf(p.id)))];
  if (accentLifts.length > 1) throw Error("Glitter accents in one collection must share one plate lift.");
  const accentChunk = accentLifts.length ? liftsMm.length : undefined;
  if (accentLifts.length) liftsMm.push(accentLifts[0]);
  const namespace = `xfs_c${key}`, depot = `axefrog/appearance_studio/collections/${key}`;
  const presets = collection.presets.map((preset, i) => {
    const appearance = `xfs_p${preset.id.replaceAll("-", "")}`;
    // The export route decides the material template entry and which texture channels exist.
    const exported = planPresetExport(preset.recipe), glitter = diagnostics?.presets[preset.id]?.glitter;
    // The diagnostic Glitter route draws flakes over flat-finish pigment layers; only its knob selects it.
    if (glitter) {
      if (exported.route !== "flat" || exported.excluded.length)
        throw Error(`Diagnostic glitter needs flat-finish pigment layers only; ${preset.name} is ${exported.route}.`);
      const active = new Set(exported.included.map(layer => layer.id));
      for (const region of glitter.regions) if (!active.has(region.layer))
        throw Error(`Diagnostic glitter for ${preset.name} names layer ${region.layer}, which is not one of its active layers.`);
      // Region geometry and the flake budget are planning rules, so Check refuses what Build would (PIPE-69, PIPE-71).
      checkRegionPlan(preset.name, new Map(exported.included.map(layer => [layer.id, layer])), glitter.regions);
    }
    const route: ExportRoute = glitter ? "glitter" : exported.route;
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
    // A glitter accent: its own emissive material entry, bound on the accent chunk, and one more texture.
    const accent = glitter?.accent ? { accentMaterial:`${ACCENT_ENTRY_PREFIX}${preset.id.replaceAll("-", "")}`, accent:accentConstants(glitter) } : {};
    const channels: readonly TextureChannel[] = [...ROUTE_CHANNELS[route], ...(glitter?.accent ? ["accent" as const] : [])];
    return { ...preset, index:i+1, appearance, appAppearance:`${namespace}__${appearance}`, route, material, uvSpace, ...(fresnel ? { fresnel } : {}),
      plateChunk:liftsMm.indexOf(liftOf(preset.id)), ...accent, ...(presetDiagnostics ? { diagnostics:presetDiagnostics } : {}),
      textures:Object.fromEntries(channels.map(channel => [channel,`${depot}/textures/${appearance}_${channel}.xbm`])) as PlanTextures };
  });
  // Branding (modName/selectorLabel) is display text, never part of a resource identity.
  return { schema:"xfas/export-plan-1" as const, collectionId:collection.id, name:collection.name,
    modName:EYE_MAKEUP_MOD.modName, selectorLabel:EYE_MAKEUP_MOD.selectorLabel, namespace, depot,
    selector:namespace, component:`${namespace}_makeup`, offAppearance:"xfs_off", templateAppearance:`${namespace}__xfs_template`,
    app:`${depot}/xfs_collection.app`, customization:`${depot}/xfs_collection.inkcharcustomization`,
    mesh:`${depot}/models/xfs_eye_plate.mesh`, morph:`${depot}/models/xfs_eye_plate.morphtarget`,
    // The packaged plate: one render chunk per lift (mm along the head's normals), in this order; a diagnostic glitter
    // accent adds one last chunk (`accentChunk`) at its presets' lift.
    plate:{ liftsMm, ...(accentChunk !== undefined ? { accentChunk } : {}) },
    presets, requirements:{ArchiveXL:"1.27.3",game:"2.31"},
    limitations:["Appearance names are stable; game save/index persistence across reorder/removal still requires runtime proof.",
      "One pack creates one selector. Multi-pack aggregation into one global selector is not implemented."],
    // What the source collection holds that this plan leaves out, and why (PIPE-45). Only a plan exported from a
    // draft carries it: the package pipeline plans its packaged copy, which never does. An optional addition, so
    // `xfas/export-plan-1` readers that don't know it are unaffected.
    ...(collection.omitted ? { omitted:collection.omitted } : {}) };
}
