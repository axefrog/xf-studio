// Pure resource definitions for one packaged collection: the WolvenKit JSON form of the
// plate mesh/morph rewrite, the .app, the character-customization resource and the
// ArchiveXL declaration. No file or process access.
//
// TypeScript port of the resource half of experiments/005-preset-collection/build.py.
// Field order and handle numbering follow that builder, so the converted resources are
// byte-identical to the ones the Python oracle produces.
import { createHash } from "node:crypto";
import type { CollectionPlan } from "./package-bake";

// WolvenKit JSON is untyped here; only the fields the rewrite touches are named.
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const cname = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
export const resourceRef = (path: string, soft = false) => ({
  DepotPath: { $type: "ResourcePath", $storage: "string", $value: path.replaceAll("/", "\\") },
  Flags: soft ? "Soft" : "Default",
});
const cr2wDocument = (root: Json) => ({
  Header: { WolvenKitVersion: "8.17.4", WKitJsonVersion: "0.0.9", GameVersion: 2310, DataType: "CR2W" },
  Data: { Version: 195, BuildVersion: 0, RootChunk: root, EmbeddedFiles: [] },
});
const FULL_CHUNK_MASK = "9223372036854775807";

/** Handle IDs for new chunks; starts above the preserved mesh/morph buffer handles in the imported plate. */
export class HandleCounter {
  private next = 10000;
  handle(data: Json) { return { HandleId: String(this.next++), Data: data }; }
}

/** Stable 64-bit component ID derived from its name (little-endian first 8 SHA-256 bytes; never 0). */
export function componentId(component: string): string {
  const digest = createHash("sha256").update("xfs:component:" + component, "utf8").digest();
  const value = digest.readBigUInt64LE(0);
  return String(value || 1n);
}

const floatValue = (name: string, value: number) => ({ $type: "Float", [name]: value });
const colorValue = (name: string, c: { Red: number; Green: number; Blue: number; Alpha: number }) =>
  ({ $type: "Color", [name]: { $type: "Color", Red: c.Red, Green: c.Green, Blue: c.Blue, Alpha: c.Alpha } });
const WHITE = { Red: 255, Green: 255, Blue: 255, Alpha: 255 };
const softTexture = (plan: CollectionPlan, parameter: string, channel: string) =>
  ({ $type: "rRef:ITexture", [parameter]: resourceRef(`*${plan.depot}/textures/{material}_${channel}.xbm`, true) });
const localInstance = (template: string, values: Json[]) => ({ $type: "CMaterialInstance", audioTag: cname("None"),
  baseMaterial: resourceRef(template), cookingPlatform: "PLATFORM_PC", enableMask: 0, resourceVersion: 4, values });

/** The flat `@preset` instance, unchanged since the Experiment 005 builder. */
function flatMaterial(plan: CollectionPlan) {
  const values: Json[] = ([["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"]] as const)
    .map(([name, channel]) => softTexture(plan, name, channel));
  for (const [name, value] of Object.entries({ DiffuseAlpha: 1, NormalAlpha: 0, RoughnessMetalnessAlpha: 1, AlphaMaskContrast: 0,
    SecondaryMaskInfluence: 0, RoughnessScale: 1, MetalnessScale: 1, RoughnessBias: 0, MetalnessBias: 0 }))
    values.push(floatValue(name, value));
  values.push(colorValue("DiffuseColor", WHITE));
  return localInstance("base/materials/mesh_decal.mt", values);
}

/** `@faceted`: the flat instance plus a normal map composed with the skin normal (NormalsBlendingMode 1). */
function facetedMaterial(plan: CollectionPlan) {
  const values: Json[] = ([["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"],
    ["NormalTexture", "normal"]] as const).map(([name, channel]) => softTexture(plan, name, channel));
  for (const [name, value] of Object.entries({ DiffuseAlpha: 1, NormalAlpha: 1, UseNormalAlphaTex: 0, NormalsBlendingMode: 1,
    RoughnessMetalnessAlpha: 1, AlphaMaskContrast: 0, SecondaryMaskInfluence: 0, RoughnessScale: 1, MetalnessScale: 1,
    RoughnessBias: 0, MetalnessBias: 0 }))
    values.push(floatValue(name, value));
  values.push(colorValue("DiffuseColor", WHITE));
  return localInstance("base/materials/mesh_decal.mt", values);
}

/** One colour-shift preset's gradient-recolour instance: mask and base colour maps plus its shift constants. */
function fresnelMaterialInstance(plan: CollectionPlan, preset: CollectionPlan["presets"][number]) {
  const material = preset.fresnel;
  if (!material) throw Error(`Colour-shift preset ${preset.id} has no planned Fresnel material.`);
  const values: Json[] = ([["MaskTexture", "mask"], ["GradientMap", "gradient"]] as const)
    .map(([name, channel]) => softTexture(plan, name, channel));
  for (const [name, value] of Object.entries(material)) if (typeof value === "number") values.push(floatValue(name, value));
  values.push(colorValue("FresnelColor", material.FresnelColor), colorValue("DiffuseColor", WHITE));
  return localInstance(FRESNEL_TEMPLATE, values);
}
export const FRESNEL_TEMPLATE = "base/materials/mesh_decal_gradientmap_recolor_blendable.mt";

/**
 * Replace the plate's appearances and materials. Each preset binds its route's template entry:
 * `<appearance>@<entry>`, whose `{material}` prefix resolves that preset's textures. Presets that share
 * the seed's template entry stay empty stubs, which ArchiveXL expands from the seed; any other preset
 * names its entry explicitly. A flat-only collection is byte-for-byte the Experiment 005 layout.
 */
export function rewritePlateMesh(mesh: Json, plan: CollectionPlan, handles: HandleCounter): Json {
  const root = mesh.Data.RootChunk, seed = plan.presets[0];
  const entries: string[] = [];
  for (const preset of plan.presets) if (!entries.includes(preset.material)) entries.push(preset.material);
  root.appearances = plan.presets.map((preset, i) => handles.handle({ $type: "meshMeshAppearance", name: cname(preset.appearance),
    chunkMaterials: i === 0 || preset.material !== seed.material || preset.route === "fresnel" ? [cname(preset.appearance + preset.material)] : [],
    tags: [] }));
  root.materialEntries = entries.map((name, index) => ({ $type: "CMeshMaterialEntry", index, isLocalInstance: 1, name: cname(name) }));
  root.localMaterialBuffer.materials = entries.map(name => {
    const preset = plan.presets.find(p => p.material === name)!;
    return preset.route === "flat" ? flatMaterial(plan) : preset.route === "faceted" ? facetedMaterial(plan) : fresnelMaterialInstance(plan, preset);
  });
  root.localMaterialBuffer.rawData = null;
  root.localMaterialBuffer.rawDataHeaders = [];
  return mesh;
}

/** Point the plate morph target at the collection's mesh and seed appearance. */
export function rewritePlateMorph(morph: Json, plan: CollectionPlan): Json {
  const root = morph.Data.RootChunk;
  root.baseMesh = resourceRef(plan.mesh);
  root.baseMeshAppearance = cname(plan.presets[0].appearance);
  return morph;
}

/** The `.app` resource: an empty Off definition and one template whose component ArchiveXL expands per preset. */
export function appearanceResource(plan: CollectionPlan, handles: HandleCounter): Json {
  const seed = plan.presets[0].appearance;
  const component = { $type: "entMorphTargetSkinnedMeshComponent", name: cname(plan.component), id: componentId(plan.component),
    isEnabled: 1, version: 1, autoHideDistance: 50, chunkMask: FULL_CHUNK_MASK, forceLODLevel: -1,
    meshAppearance: cname(seed), morphResource: resourceRef(plan.morph),
    parentTransform: handles.handle({ $type: "entHardTransformBinding", bindName: cname("root"), enabled: 1 }),
    skinning: handles.handle({ $type: "entSkinningBinding", bindName: cname("root"), enabled: 1 }) };
  const overrides = (items: Json[]) => [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: items }];
  const off = { $type: "appearanceAppearanceDefinition", name: cname(plan.offAppearance), components: [],
    partsOverrides: overrides([]) };
  const template = { $type: "appearanceAppearanceDefinition", name: cname(plan.templateAppearance), components: [component],
    partsOverrides: overrides([{ $type: "appearancePartComponentOverrides", componentName: cname(plan.component),
      meshAppearance: cname(seed), chunkMask: FULL_CHUNK_MASK, visualScale: { $type: "Vector3", X: 1, Y: 1, Z: 1 } }]),
    resolvedDependencies: [resourceRef(plan.morph, true)], visualTags: { $type: "redTagList", tags: [cname("Female")] } };
  return cr2wDocument({ $type: "appearanceAppearanceResource", cookingPlatform: "PLATFORM_PC",
    appearances: [handles.handle(off), handles.handle(template)] });
}

/** The selector label comes from the Studio's mod-branding module through the plan; never a local copy. */
export function assertBrandedPlan(plan: { selectorLabel?: unknown }): void {
  if (typeof plan.selectorLabel !== "string" || !plan.selectorLabel.startsWith("XF "))
    throw Error("Export plan lacks an XF-branded selectorLabel; rebake with the current Studio.");
}

/** The one female head customization option: Off at index 0, then one definition per packaged preset. */
export function customizationResource(plan: CollectionPlan, handles: HandleCounter): Json {
  assertBrandedPlan(plan);
  const definitions = [{ $type: "gameuiIndexedAppearanceDefinition", name: cname(plan.offAppearance), index: 0, localizedName: "Common-Off" },
    ...plan.presets.map(preset => ({ $type: "gameuiIndexedAppearanceDefinition", name: cname(preset.appAppearance),
      index: preset.index, localizedName: preset.name }))];
  const option = { $type: "gameuiAppearanceInfo", name: cname(plan.selector), uiSlot: cname(plan.selector),
    localizedName: plan.selectorLabel, enabled: 1, hidden: 0, index: 311, defaultIndex: 0,
    editTags: ["NewGame", "HairDresser", "Ripperdoc"], randomizeCategory: "Makeup", useThumbnails: 0,
    resource: resourceRef(plan.app, true), definitions };
  return cr2wDocument({ $type: "gameuiCharacterCustomizationInfoResource", cookingPlatform: "PLATFORM_PC",
    headCustomizationOptions: [handles.handle(option)],
    headGroups: [{ $type: "gameuiOptionsGroup", name: cname("character_customization"), options: [cname(plan.selector)] }] });
}

/**
 * The `.archive.xl` text placed beside the archive. CRLF line endings: the Python builder wrote
 * this file in Windows text mode, so every candidate built so far has them, and YAML accepts them.
 */
export function archiveXlDeclaration(plan: CollectionPlan): string {
  return ["customizations:", "  female: " + plan.customization.replaceAll("/", "\\"), "resource:", "  scope:",
    "    player_customization.app:", "      - " + plan.app.replaceAll("/", "\\"), ""].join("\r\n");
}

/** Compact JSON with non-ASCII escaped, as the Python builder wrote it, plus a trailing newline. */
export function resourceJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\n";
}
