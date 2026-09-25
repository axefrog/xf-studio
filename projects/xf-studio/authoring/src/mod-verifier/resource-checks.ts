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

export interface VerifierPreset {
  readonly id: string; readonly name: string; readonly index: number;
  readonly appearance: string; readonly appAppearance: string;
  readonly textures: Record<"diffuse" | "roughness" | "metalness", string>;
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
  readonly textures: Record<"diffuse" | "roughness" | "metalness", string>;
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
  textureSizes: readonly number[], morphTargets: number | null): ResourceSummary {
  const { mesh, morph, app, customization: cc } = r;
  for (const field of ["renderResourceBlob", "boneNames", "boneRigMatrices", "boundingBox"])
    ensure(field in mesh && sameJson(mesh[field], r.sourceMesh[field], IGNORED), `Mesh ${field} differs from the source plate`);
  for (const field of ["blob", "targets"])
    ensure(sameJson(morph[field], r.sourceMorph[field], IGNORED), `Morph ${field} differs from the source plate`);
  ensure(dep(morph.baseMesh) === plan.mesh, "Morph baseMesh does not reference the planned mesh");
  const targetCount = Array.isArray(morph.targets) ? morph.targets.length : 0;
  ensure(morphTargets === null ? targetCount > 0 : targetCount === morphTargets,
    `Morph target count is ${targetCount}, not the plate recipe's ${morphTargets ?? "non-zero count"}`);
  ensure(mesh.materialEntries?.length === 1, "Mesh must have exactly one material entry");
  ensure(value(mesh.materialEntries[0].name) === "@preset", "Mesh material entry is not @preset");
  const materials = mesh.localMaterialBuffer?.materials;
  ensure(materials?.length === 1, "Mesh must have exactly one local material");
  const material = materials[0];
  ensure(dep(material.baseMaterial) === "base/materials/mesh_decal.mt", "Material is not based on mesh_decal.mt");
  const params: Record<string, Node> = {};
  for (const item of material.values) for (const [key, v] of Object.entries(item)) if (key !== "$type") params[key] = v;
  ensure(params.NormalAlpha === 0 && params.AlphaMaskContrast === 0 && params.SecondaryMaskInfluence === 0, "Material normal/mask parameters are not zero");
  ensure([params.DiffuseAlpha, params.RoughnessMetalnessAlpha, params.RoughnessScale, params.MetalnessScale].every(v => v === 1),
    "Material alpha/scale parameters are not one");
  ensure(sameJson(params.DiffuseColor, { $type: "Color", Red: 255, Green: 255, Blue: 255, Alpha: 255 }), "DiffuseColor is not opaque white");
  ensure(params.RoughnessBias === 0 && params.MetalnessBias === 0, "Material biases are not zero");
  const appearances = mesh.appearances.map((a: Node) => value(a.Data.name));
  ensure(sameJson(appearances, plan.presets.map(p => p.appearance)), "Mesh appearances differ from the planned presets");
  const seed = mesh.appearances[0].Data;
  ensure(sameJson(seed.chunkMaterials.map(value), [plan.presets[0].appearance + "@preset"]), "Seed appearance does not use the @preset template");
  ensure(mesh.appearances.slice(1).every((a: Node) => !a.Data.chunkMaterials?.length), "Only the seed appearance may carry chunk materials");

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
    for (const [parameter, channel] of [["DiffuseTexture", "diffuse"], ["RoughnessTexture", "roughness"], ["MetalnessTexture", "metalness"]] as const) {
      const reference = params[parameter];
      ensure(reference?.Flags === "Soft", `${parameter} is not a Soft reference`);
      const pattern = dep(reference);
      ensure(pattern.startsWith("*"), `${parameter} is not a dynamic path`);
      const path = pattern.slice(1).replaceAll("{material}", suffix);
      ensure(path === preset.textures[channel] && r.archiveHas(path), `${parameter} resolves to ${path}, not the planned generated texture`);
      expanded[channel] = path;
      const metadata = r.texture(path), setup = metadata.setup;
      ensure(metadata.width === textureSizes[i] && metadata.height === textureSizes[i], `${path} has unexpected dimensions`);
      ensure(setup.hasMipchain === 1 && setup.isGamma === (channel === "diffuse" ? 1 : 0), `${path} has unexpected mip/gamma settings`);
      ensure(setup.compression === (channel === "diffuse" ? "TCM_QualityColor" : "TCM_QualityR"), `${path} has unexpected compression`);
    }
    resolved.push({ appearance: preset.appAppearance, chunkMaterial: suffix + "@preset", textures: expanded });
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
