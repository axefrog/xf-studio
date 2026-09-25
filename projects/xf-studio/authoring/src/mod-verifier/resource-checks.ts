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

export type VerifierRoute = "flat" | "faceted" | "fresnel";
export type VerifierChannel = "diffuse" | "roughness" | "metalness" | "normal" | "mask" | "gradient";

export interface VerifierPreset {
  readonly id: string; readonly name: string; readonly index: number;
  readonly appearance: string; readonly appAppearance: string;
  /** Absent in builds made before the faceted and Fresnel routes: those are flat `@preset` presets. */
  readonly route?: VerifierRoute; readonly material?: string;
  readonly recipe?: Node;
  readonly textures: Partial<Record<VerifierChannel, string>>;
}

/** The published per-route resource specification, restated here independently of the builder. */
export const ROUTE_SPEC: Record<VerifierRoute, { template: string; textures: readonly (readonly [string, VerifierChannel])[] }> = {
  flat: { template: "base/materials/mesh_decal.mt",
    textures: [["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"]] },
  faceted: { template: "base/materials/mesh_decal.mt",
    textures: [["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"], ["NormalTexture", "normal"]] },
  fresnel: { template: "base/materials/mesh_decal_gradientmap_recolor_blendable.mt",
    textures: [["MaskTexture", "mask"], ["GradientMap", "gradient"]] },
};
export const routeOf = (preset: VerifierPreset): VerifierRoute => preset.route ?? "flat";
export const materialOf = (preset: VerifierPreset): string => preset.material ?? "@preset";
/** XBM import settings each channel must carry. */
export const CHANNEL_SETUP: Record<VerifierChannel, { isGamma: 0 | 1; compression: string }> = {
  diffuse: { isGamma: 1, compression: "TCM_QualityColor" }, gradient: { isGamma: 1, compression: "TCM_QualityColor" },
  roughness: { isGamma: 0, compression: "TCM_QualityR" }, metalness: { isGamma: 0, compression: "TCM_QualityR" },
  mask: { isGamma: 0, compression: "TCM_QualityR" }, normal: { isGamma: 0, compression: "TCM_Normalmap" },
};
/** Side of the uniform Fresnel base-colour texture. */
export const GRADIENT_SIDE = 16;

const srgbDecode = (v: number) => (v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** WolvenKit stores material scalars as float32 and prints nine significant digits. */
const sameFloat32 = (actual: unknown, want: number) => typeof actual === "number" && Math.abs(actual - Math.fround(want)) <= 1e-7 * Math.max(1, Math.abs(want));
const toByte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);

/** The one colour-shift pigment of a Fresnel preset, read from its recipe: base colour, shift colour and strength. */
export function fresnelPigment(preset: VerifierPreset): { color: string; shift: { color: string; strength: number } } {
  const layers: Node[] = (preset.recipe?.layers ?? []).filter((l: Node) => l.enabled && l.opacity > 0);
  ensure(layers.length > 0, `Fresnel preset ${preset.name} has no active layer`);
  const keys = new Set(layers.map(l => JSON.stringify([String(l.color).toLowerCase(), String(l.optics?.shift?.color).toLowerCase(), l.optics?.shift?.strength])));
  ensure(keys.size === 1 && layers.every(l => l.finish === "iridescent" && l.optics?.model === "game-matched-1"),
    `Fresnel preset ${preset.name} is not one colour-shift pigment`);
  return { color: layers[0].color, shift: layers[0].optics.shift };
}

/** Expected scalar and colour parameters of each route's material instance (the published specification). */
export function expectedMaterialValues(route: VerifierRoute, preset: VerifierPreset): Record<string, Node> {
  const white = { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 };
  const flat = { DiffuseAlpha: 1, NormalAlpha: 0, RoughnessMetalnessAlpha: 1, AlphaMaskContrast: 0, SecondaryMaskInfluence: 0,
    RoughnessScale: 1, MetalnessScale: 1, RoughnessBias: 0, MetalnessBias: 0, DiffuseColor: white };
  if (route === "flat") return flat;
  if (route === "faceted") return { ...flat, NormalAlpha: 1, UseNormalAlphaTex: 0, NormalsBlendingMode: 1 };
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
}

const value = (x: Node) => x?.$value;
const dep = (x: Node): string => String(value(x?.DepotPath)).replaceAll("\\", "/");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const IGNORED = new Set(["HandleId", "BufferId", "HandleRefId"]);

/** Python-style structural equality: object key order ignored; list order kept. */
export function sameJson(a: Node, b: Node, ignore: ReadonlySet<string> = new Set()): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item: Node, i: number) => sameJson(item, b[i], ignore));
  const left = Object.keys(a).filter(k => !ignore.has(k)), right = Object.keys(b).filter(k => !ignore.has(k));
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && !ignore.has(key) && sameJson(a[key], b[key], ignore));
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
  readonly materialTemplates: number;
  readonly meshAppearances: number;
  readonly selectorOptionCount: number;
  readonly resolved: ResolvedPreset[];
}

export function checkResources(plan: VerifierPlan, r: RoundTrippedResources, artifactPaths: readonly string[],
  textureSizes: readonly number[]): ResourceSummary {
  const { mesh, morph, app, customization: cc } = r;
  for (const field of ["renderResourceBlob", "boneNames", "boneRigMatrices", "boundingBox"])
    ensure(field in mesh && sameJson(mesh[field], r.sourceMesh[field], IGNORED), `Mesh ${field} differs from the source plate`);
  for (const field of ["blob", "targets"])
    ensure(sameJson(morph[field], r.sourceMorph[field], IGNORED), `Morph ${field} differs from the source plate`);
  ensure(dep(morph.baseMesh) === plan.mesh, "Morph baseMesh does not reference the planned mesh");
  ensure(morph.targets?.length === 105, "Morph target count is not 105");
  // Material entries: one per distinct template entry, in first-use order across presets.
  const entryNames: string[] = [];
  for (const preset of plan.presets) if (!entryNames.includes(materialOf(preset))) entryNames.push(materialOf(preset));
  ensure(mesh.materialEntries?.length === entryNames.length,
    entryNames.length === 1 ? "Mesh must have exactly one material entry" : `Mesh must have exactly ${entryNames.length} material entries`);
  mesh.materialEntries.forEach((entry: Node, i: number) => ensure(value(entry.name) === entryNames[i] && entry.index === i && entry.isLocalInstance === 1,
    entryNames.length === 1 ? "Mesh material entry is not @preset" : `Mesh material entry ${i} is not the local ${entryNames[i]}`));
  const materials = mesh.localMaterialBuffer?.materials;
  ensure(materials?.length === entryNames.length,
    entryNames.length === 1 ? "Mesh must have exactly one local material" : `Mesh must have exactly ${entryNames.length} local materials`);
  const paramsByEntry = new Map<string, Record<string, Node>>();
  entryNames.forEach((name, i) => {
    const preset = plan.presets.find(p => materialOf(p) === name)!, route = routeOf(preset), material = materials[i];
    ensure(route !== "fresnel" || plan.presets.filter(p => materialOf(p) === name).length === 1, `Fresnel material ${name} is shared`);
    ensure(route === "fresnel" ? name.startsWith("@fresnel_") : name === (route === "flat" ? "@preset" : "@faceted"),
      `Material entry ${name} does not match its ${route} route`);
    ensure(dep(material.baseMaterial) === ROUTE_SPEC[route].template,
      route === "flat" ? "Material is not based on mesh_decal.mt" : `Material ${name} is not based on ${ROUTE_SPEC[route].template}`);
    const params: Record<string, Node> = {};
    for (const item of material.values) for (const [key, v] of Object.entries(item)) if (key !== "$type") params[key] = v;
    const expected = expectedMaterialValues(route, preset);
    if (route === "flat") {
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
  ensure(sameJson(seed.chunkMaterials.map(value), [seedPreset.appearance + materialOf(seedPreset)]),
    `Seed appearance does not use the ${materialOf(seedPreset)} template`);
  // Stubs expand from the seed; a preset on another entry, or any Fresnel preset, names its own.
  const explicit = (preset: VerifierPreset) => materialOf(preset) !== materialOf(seedPreset) || routeOf(preset) === "fresnel";
  mesh.appearances.slice(1).forEach((a: Node, i: number) => {
    const preset = plan.presets[i + 1];
    if (explicit(preset)) ensure(sameJson(a.Data.chunkMaterials?.map(value), [preset.appearance + materialOf(preset)]),
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
  ensure(typeof plan.selectorLabel === "string" && plan.selectorLabel.startsWith("XF "), "Plan lacks an XF-branded selector label");
  ensure(option.localizedName === plan.selectorLabel, "Selector label differs from the plan");
  const names = [plan.namespace, plan.selector, plan.component, value(off.name), value(template.name),
    ...plan.presets.map(p => p.appearance), ...plan.presets.map(p => p.appAppearance)];
  ensure(names.every(name => typeof name === "string" && name.startsWith("xfs_")), "A generated name lacks the xfs_ prefix");
  ensure(artifactPaths.every(path => baseName(path).startsWith("xfs_")), "A generated resource filename lacks the xfs_ prefix");
  ensure(value(option.name) === plan.selector && plan.selector === value(option.uiSlot) && dep(option.resource) === plan.app,
    "Selector name, slot or resource differs from the plan");
  ensure(option.definitions?.length === plan.presets.length + 1, "Selector must list Off plus every preset");
  ensure(value(option.definitions[0].name) === plan.offAppearance && option.defaultIndex === 0, "Selector default must be Off");
  ensure(sameJson(cc.headGroups?.[0]?.options?.map(value), [plan.selector]), "Head group does not list exactly the selector");

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
    const planned = Object.keys(preset.textures).sort(), routed: string[] = ROUTE_SPEC[route].textures.map(([, channel]) => channel).sort();
    ensure(sameJson(planned, routed), `Preset ${preset.name} plans textures ${planned.join(", ")} for its ${route} route`);
    for (const [parameter, channel] of ROUTE_SPEC[route].textures) {
      const reference = params[parameter];
      ensure(reference?.Flags === "Soft", `${parameter} is not a Soft reference`);
      const pattern = dep(reference);
      ensure(pattern.startsWith("*"), `${parameter} is not a dynamic path`);
      const path = pattern.slice(1).replaceAll("{material}", suffix);
      ensure(path === preset.textures[channel] && r.archiveHas(path), `${parameter} resolves to ${path}, not the planned generated texture`);
      expanded[channel] = path;
      const metadata = r.texture(path), setup = metadata.setup, side = channel === "gradient" ? GRADIENT_SIDE : textureSizes[i];
      ensure(metadata.width === side && metadata.height === side, `${path} has unexpected dimensions`);
      ensure(setup.hasMipchain === 1 && setup.isGamma === CHANNEL_SETUP[channel].isGamma, `${path} has unexpected mip/gamma settings`);
      ensure(setup.compression === CHANNEL_SETUP[channel].compression, `${path} has unexpected compression`);
    }
    resolved.push({ appearance: preset.appAppearance, chunkMaterial: suffix + entry, textures: expanded });
  });
  return { appearanceNames: appearances, materialTemplates: materials.length, meshAppearances: mesh.appearances.length,
    selectorOptionCount: option.definitions.length, resolved };
}
