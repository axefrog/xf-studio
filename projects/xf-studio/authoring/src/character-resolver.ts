/**
 * Generic character resolver: (installed game + mod sources + a character's CC choices) → a renderable
 * description (`ResolvedCharacter`). Pure apart from the resource fetch port. There is no mod- or
 * framework-specific code: PRC, CCXL packs and hair-colour packs resolve through the same rules as vanilla.
 *
 * Rule numbers follow knowledge/cc-file-chain.md section 8. Each decision carries its evidence grade;
 * where a rule is unproven the output records an ambiguity instead of guessing silently.
 */
import { CUSTOMIZATION_SCOPE, inScope } from "./archivexl-config";
import { type AppearanceDescriptor, type CcoPart, type CcoResource, type MergedCco, type MorphDescriptor,
  mergeCustomizations, overrideKey, readCco } from "./cco-model";
import { extensionOf, refFromHash, refFromPath, type DepotRef, refLabel } from "./depot-path";
import { depotRef, depotText, materialParams, type JsonObject, type MaterialParamValue } from "./red-json";
import { type Ambiguity, type RuleNote, note } from "./resolution-evidence";
import { type AppDefinitionModel, type ComponentModel, type MeshAppearanceModel, type MeshModel, type Provenance,
  type ResourceGraph, isRenderable } from "./resource-graph";

export type BodyGender = "female" | "male";
export interface CharacterInput {
  readonly bodyGender: BodyGender;
  readonly origin: "save" | "ui-state" | "descriptors";
  readonly appearances: readonly AppearanceDescriptor[];
  readonly morphs: readonly MorphDescriptor[];
}

export interface ResolvedParam {
  readonly name: string;
  readonly kind: MaterialParamValue["kind"];
  readonly value: string;
  /** Material instance that set this value (nearest in the chain wins). */
  readonly setBy: string;
  readonly resource?: Provenance;
  readonly dynamic?: { readonly template: string; readonly expanded: string | null; readonly optional: boolean };
}
export interface MaterialLink { readonly label: string; readonly provenance: Provenance | null; readonly baseMaterial: string | null }
export interface ResolvedChunkMaterial {
  readonly chunk: number;
  readonly name: string;
  /** `none`: the chunk is past the end of its appearance's chunk material list, so it has no material of its own (`unlistedChunk`). */
  readonly route: "entry" | "patch-entry" | "template" | "unresolved" | "none";
  readonly entry: { readonly mesh: string; readonly local: boolean; readonly index: number } | null;
  readonly dynamic: { readonly template: string; readonly material: string; readonly context: Readonly<Record<string, string>> } | null;
  readonly chain: readonly MaterialLink[];
  readonly template: Provenance | null;
  readonly params: readonly ResolvedParam[];
  readonly gaps: readonly string[];
}
export interface ResolvedComponent {
  readonly name: string;
  readonly type: string;
  readonly origin: { readonly kind: "inline" | "part"; readonly source: string; readonly partHash?: string; readonly alsoIn?: string };
  readonly meshAppearance: string;
  readonly chunkMask: string;
  readonly overriddenBy: readonly string[];
  readonly geometry: {
    readonly morphTarget: Provenance | null;
    readonly mesh: Provenance | null;
    readonly renderChunks: number | null;
    /** Each render chunk's LOD mask (bit 0 = highest detail), when known. */
    readonly chunkLods: readonly number[] | null;
    /** Whether each render chunk draws in the scene (its `renderMask` has `MCF_RenderInScene`), when known. */
    readonly chunkInScene: readonly boolean[] | null;
    readonly visibleChunks: readonly number[] | null;
    readonly drawsNothing: boolean;
    readonly patchedFrom: readonly string[];
    /**
     * The resource whose render blob the game draws: the morph target (or the source ArchiveXL patched
     * its blob from), else the mesh (or its render-blob patch source). A renderer exports this one.
     */
    readonly drawnFrom: Provenance | null;
    /**
     * The effective morph target's `baseTexture` rule (after ArchiveXL patches): the named material parameter is
     * bound to a runtime texture built from `texture` [hypothesis: knowledge/eye-rendering.md §1.3]. Null for a
     * plain mesh component; `texture` null or `parameter` empty means the material's own value stands.
     */
    readonly morphTexture: { readonly texture: Provenance | null; readonly parameter: string } | null;
  } | null;
  /** Morph target regions and names this component carries. */
  readonly morphRegions: Readonly<Record<string, number>>;
  readonly appliedMorphs: readonly { region: string; target: string }[];
  readonly meshAppearanceResolved: { readonly requested: string; readonly used: string | null; readonly expandedFrom: string | null; readonly patchedFrom: string | null } | null;
  readonly materials: readonly ResolvedChunkMaterial[];
  readonly notes: readonly RuleNote[];
}
export interface ResolvedAppearance {
  readonly option: string;
  readonly part: CcoPart;
  readonly groups: readonly string[];
  readonly definition: string;
  readonly requestedApp: DepotRef;
  readonly app: Provenance | null;
  readonly appOverride: { readonly to: DepotRef; readonly registeredBy: string } | null;
  readonly choice: { readonly providedBy: string; readonly optionDefinedBy: string } | null;
  /**
   * `missing`: no mounted archive provides the appearance (or its definition); `unreadable`: an archive provides the app, but the export
   * tool couldn't read it (e.g. WolvenKit refusing a mod's `.app` written with an older property type).
   */
  readonly appearance: { readonly status: "defined" | "dynamic" | "missing" | "unreadable"; readonly source: string | null; readonly patchedBy: readonly string[] };
  readonly components: readonly ResolvedComponent[];
  readonly notes: readonly RuleNote[];
}
export interface ResolvedCharacter {
  readonly schema: "xfs/resolved-character-1";
  readonly bodyGender: BodyGender;
  readonly origin: CharacterInput["origin"];
  readonly cco: { readonly base: Provenance; readonly customResources: readonly { path: string; declaredBy: string; provenance: Provenance }[]; readonly hairColorTags: readonly string[] };
  readonly appearances: readonly ResolvedAppearance[];
  readonly morphs: readonly { region: string; target: string; groups: string[]; components: number }[];
  readonly ambiguities: readonly Ambiguity[];
  readonly gaps: readonly { code: string; subject: string; detail: string }[];
  readonly rules: readonly RuleNote[];
}

/**
 * Chunk-mask and mesh-appearance overrides worn items apply to every component of the player, as ArchiveXL registers them
 * (Garment/Extension.cpp `RegisterComponentOverrides`: an item `.app` definition's `partsOverrides` without a part resource, and the
 * `overrides.tags` rules of its definition's `visualTags`) and applies them (States.cpp `ApplyChunkMaskOverride`: the component's own mask,
 * ORed with every showing mask for its name and for its prefix, then ANDed with every hiding mask) [source]. Keys are component names or
 * prefixes (`h0_`: Prefix.cpp, the name up to its first `_` when that `_` is at index 2 to 5).
 */
export interface ComponentOverrides {
  readonly masks: ReadonlyMap<string, { readonly show: bigint; readonly hide: bigint; readonly by: readonly string[] }>;
  /** A mesh appearance per component name (an entity-wide `partsOverrides` entry that names one). */
  readonly appearances: ReadonlyMap<string, { readonly appearance: string; readonly by: string }>;
}
export const NO_OVERRIDES: ComponentOverrides = Object.freeze({ masks: new Map(), appearances: new Map() });
/** ArchiveXL's component prefix (Prefix.cpp `GetPrefix`), with its `_`, or null. */
export function componentPrefix(name: string): string | null {
  let end = 2;
  while (end < 6 && end < name.length && name[end] !== "_") end++;
  return end < 6 && name[end] === "_" ? name.slice(0, end + 1) : null;
}
/** A component's chunk mask after the overrides for its name and prefix, and which overrides changed it. */
export function overriddenMask(name: string, chunkMask: string, overrides: ComponentOverrides): { mask: string; by: string[] } | null {
  const byName = overrides.masks.get(name), prefix = componentPrefix(name), byPrefix = prefix ? overrides.masks.get(prefix) : undefined;
  if (!byName && !byPrefix) return null;
  let mask: bigint; try { mask = BigInt(chunkMask); } catch { mask = ALL; }
  mask = ((mask | (byName?.show ?? 0n) | (byPrefix?.show ?? 0n)) & (byName?.hide ?? ALL) & (byPrefix?.hide ?? ALL)) & ALL;
  return { mask: mask.toString(), by: [...byName?.by ?? [], ...byPrefix?.by ?? []] };
}
/** A stable key of a set of overrides (for caches keyed by what was resolved). */
export const overridesKey = (overrides: ComponentOverrides) => !overrides.masks.size && !overrides.appearances.size ? ""
  : JSON.stringify([[...overrides.masks].map(([key, value]) => [key, value.show.toString(), value.hide.toString()]).sort(),
    [...overrides.appearances].map(([key, value]) => [key, value.appearance]).sort()]);

const ALL = 18446744073709551615n;
export function visibleChunks(mask: string, count: number): number[] {
  let bits: bigint; try { bits = BigInt(mask); } catch { bits = ALL; }
  return Array.from({ length: count }, (_, i) => i).filter(i => i >= 64 || ((bits >> BigInt(i)) & 1n) === 1n);
}

/** R2: the CCO pair in use. Phantom Liberty installs the `_ep1` twins [resource: saved EP1 face-rig hash]. */
export function ccoPath(bodyGender: BodyGender, ep1: boolean): string {
  return ep1 ? `ep1\\gameplay\\gui\\fullscreen\\main_menu\\${bodyGender}_cco_ep1.inkcharcustomization`
    : `base\\gameplay\\gui\\fullscreen\\main_menu\\${bodyGender}_cco.inkcharcustomization`;
}

/** Descriptors from a decoded save node (it stores resolved appearances per consumer group). */
export function inputFromSave(saved: { isMale: boolean; groups: Record<CcoPart, { name: string; appearances: { resourceHash: string; definition: string; name: string }[]; morphs: { region: string; target: string }[] }[]> }): CharacterInput {
  const appearances: AppearanceDescriptor[] = [], morphs: MorphDescriptor[] = [];
  for (const part of ["head", "body", "arms"] as const) for (const group of saved.groups[part] ?? []) {
    for (const item of group.appearances) appearances.push({ part, group: group.name, option: item.name, app: refFromHash(item.resourceHash), definition: item.definition });
    for (const morph of group.morphs) morphs.push({ part, group: group.name, region: morph.region, target: morph.target });
  }
  return { bodyGender: saved.isMale ? "male" : "female", origin: "save", appearances, morphs };
}

/** The provenance label a custom resource's options and choices carry (`definedBy`, `providedBy`). */
export const customLabel = (path: string, provenance: Provenance) => `${path} (${provenance.provider ?? "unknown"})`;

type LoadedCco = { merged: MergedCco; base: Provenance; customs: ResolvedCharacter["cco"]["customResources"]; gaps: ResolvedCharacter["gaps"];
  /** The precedence ambiguities of the resources the merge read (`ResourceGraph.collect`), reported with every V it serves. */
  ambiguities: Ambiguity[] };
type CcoReader = (root: JsonObject, label: string) => CcoResource;
/**
 * The merged CCO of each graph, reader and body gender, made once: merging a few hundred custom resources is the costliest
 * step of resolving a V, and a graph (one installation's resources) always merges them the same way. A merge that met a
 * resource the fetch port could not read is not kept, so it is tried again. Callers treat the result as read-only.
 */
const mergedCcos = new WeakMap<ResourceGraph, Map<CcoReader, Map<BodyGender, Promise<LoadedCco>>>>();

/**
 * Load the effective CCO: the installed base resource merged with every `.xl`-registered custom resource (R2–R4).
 * `read` reads each resource (default `readCco`); a reader may attach extra fields to options and choices, which the
 * merge carries along with them (the creator catalogue attaches presentation data this way).
 */
export function loadMergedCco(graph: ResourceGraph, bodyGender: BodyGender, read: CcoReader = readCco): Promise<LoadedCco> {
  let byReader = mergedCcos.get(graph);
  if (!byReader) { byReader = new Map(); mergedCcos.set(graph, byReader); }
  let byGender = byReader.get(read);
  if (!byGender) { byGender = new Map(); byReader.set(read, byGender); }
  const known = byGender.get(bodyGender);
  if (known) return known;
  // Only a read that may succeed next time makes the merge worth redoing (PIPE-54); a lasting failure, or a prefetched resource no
  // consumer asked for, does not.
  const failures = graph.retryableFailures;
  const pending = graph.collect(() => mergeCco(graph, bodyGender, read)).then(({ value, ambiguities }) => ({ ...value, ambiguities }));
  byGender.set(bodyGender, pending);
  const forget = () => { if (byGender!.get(bodyGender) === pending) byGender!.delete(bodyGender); };
  pending.then(() => { if (graph.retryableFailures !== failures) forget(); }, forget);
  return pending;
}

async function mergeCco(graph: ResourceGraph, bodyGender: BodyGender, read: CcoReader): Promise<Omit<LoadedCco, "ambiguities">> {
  const gaps: { code: string; subject: string; detail: string }[] = [];
  const path = ccoPath(bodyGender, graph.depot.plan.ep1Installed);
  const baseRef = refFromPath(path);
  const loaded = await graph.load(baseRef, "inkcharcustomization");
  if (!loaded) throw Error(`The installed ${bodyGender} character-creator resource was not found.`);
  const base = read(loaded.root, "base game");
  const declared = graph.xl.customizations[bodyGender];
  const customs = await Promise.all(declared.map(async custom => {
    const ref = refFromPath(custom.path);
    const resource = await graph.load(ref, "inkcharcustomization");
    // A resource an archive provides but that could not be read is not the same gap as one no archive provides (PIPE-66).
    const unread = resource ? undefined : graph.loadErrors.get(ref.hash);
    if (unread) gaps.push({ code: "custom-cco-unreadable", subject: custom.path, detail: `Registered by ${custom.declaredBy}; ${unread} Its options are left out.` });
    else if (!resource) gaps.push({ code: "custom-cco-missing", subject: custom.path, detail: `Registered by ${custom.declaredBy} but no mounted archive provides it (ArchiveXL logs and skips).` });
    return { custom, resource };
  }));
  const present = customs.filter(entry => entry.resource);
  const aliasesOf = (hash: string) => [...graph.additions.links].filter(([, target]) => target === hash).map(([alias]) => alias);
  const merged = mergeCustomizations(base, graph.xl.fixes.get(baseRef.hash),
    present.map(({ custom, resource }) => read(resource!.root, customLabel(custom.path, resource!.provenance))), aliasesOf);
  return { merged, base: loaded.provenance, gaps,
    customs: present.map(({ custom, resource }) => ({ path: custom.path, declaredBy: custom.declaredBy, provenance: resource!.provenance })) };
}

interface Context { graph: ResourceGraph; ambiguities: Ambiguity[]; gaps: { code: string; subject: string; detail: string }[]; overrides: ComponentOverrides }

/** ArchiveXL `FixCustomizationAppearance` (Customization/Extension.cpp 779–883) [source]. */
function dynamicAppearance(appearances: readonly AppDefinitionModel[], requested: string): { definition: AppDefinitionModel; source: string } | null {
  if (!appearances.length || requested.length < 3) return null;
  let meshAppearance = requested, source: AppDefinitionModel | undefined;
  const numbered = (text: string) => text[2] === "_" && /[0-9]/.test(text[0]!);
  if (numbered(meshAppearance)) { meshAppearance = meshAppearance.slice(3); source = appearances[appearances.length > 1 ? 1 : 0]; }
  else {
    const delimiter = meshAppearance.lastIndexOf("__");
    if (delimiter >= 0) {
      if (appearances.length === 1) source = appearances[0];
      else source = appearances.find(a => a.name.slice(0, delimiter) === requested.slice(0, delimiter));
      meshAppearance = meshAppearance.slice(delimiter + 2);
      if (meshAppearance.length < 3) return null;
      if (numbered(meshAppearance)) meshAppearance = meshAppearance.slice(3);
    }
    source ??= appearances[appearances.length > 1 ? 1 : 0];
  }
  if (!source) return null;
  const fixed = source.partsOverrides.length === 1 && source.partsOverrides[0]!.componentsOverrides.length === 1 &&
    !source.partsOverrides[0]!.componentsOverrides[0]!.componentName;
  if (source.partsOverrides.length && fixed) return { definition: source, source: source.name };
  const clone: AppDefinitionModel = structuredClone(source);
  (clone as { name: string }).name = requested;
  if (clone.partsOverrides.length) for (const override of clone.partsOverrides[0]!.componentsOverrides)
    (override as { meshAppearance: string }).meshAppearance = meshAppearance;
  else clone.partsOverrides.push({ partResource: null, componentsOverrides: [{ componentName: "", meshAppearance, chunkMask: ALL.toString(), partResource: null }] });
  return { definition: clone, source: source.name };
}

/** ArchiveXL ExpandResourcePath / DynamicAppearanceController::ProcessString [source]. */
export function expandDynamicPath(text: string, context: ReadonlyMap<string, string>, material: ReadonlyMap<string, string>):
  { dynamic: boolean; value: string | null; optional: boolean } {
  if (!text.startsWith("*")) return { dynamic: false, value: text, optional: false };
  let out = "", rest = text.slice(1), used = 0, missed = false;
  while (rest) {
    const open = rest.indexOf("{");
    if (open < 0) { out += rest; rest = ""; break; }
    const close = rest.indexOf("}");
    if (close < 0) break;
    out += rest.slice(0, open);
    const attr = rest.slice(open + 1, close);
    rest = rest.slice(close + 1); used++;
    const value = material.get(attr) ?? context.get(attr);
    if (value === undefined) missed = true; else out += value;
  }
  if (rest || !used) return { dynamic: true, value: null, optional: false };
  const optional = out.endsWith("?");
  if (optional) out = out.slice(0, -1);
  return { dynamic: true, value: missed ? null : out, optional };
}

function materialAttrs(materialName: string): Map<string, string> {
  const attrs = new Map<string, string>([["material", materialName]]);
  materialName.split("+").filter(Boolean).forEach((part, i) => attrs.set(`material.${i + 1}`, part));
  return attrs;
}

const paramText = (value: MaterialParamValue): string =>
  value.kind === "resource" ? (value.text ?? (value.ref ? refLabel(value.ref) : "")) : value.kind === "name" ? value.value : JSON.stringify(value.value);

/** Walk a material instance chain to its template, collecting effective params (R10). */
async function materialChain(ctx: Context, start: { label: string; instance: JsonObject; provenance: Provenance | null },
  dynamic: { context: ReadonlyMap<string, string>; material: ReadonlyMap<string, string>; contextParams: [string, MaterialParamValue][] } | null) {
  const chain: MaterialLink[] = [], params = new Map<string, ResolvedParam>(), gaps: string[] = [];
  let template: Provenance | null = null;
  let current: { label: string; instance: JsonObject; provenance: Provenance | null } | null = start;
  for (let depth = 0; current && depth < 12; depth++) {
    let values = materialParams(current.instance.values);
    if (dynamic && depth === 0) values = values.map(([name, value]) => {
      const override = dynamic.contextParams.find(([contextName, contextValue]) => contextName === name && contextValue.kind === value.kind);
      return override ? [name, override[1]] as [string, MaterialParamValue] : [name, value];
    });
    for (const [name, value] of values) {
      if (params.has(name)) continue;
      let resource: Provenance | undefined, expansion: ResolvedParam["dynamic"];
      if (value.kind === "resource") {
        const text = value.text;
        if (text?.startsWith("*")) {
          const expanded = dynamic ? expandDynamicPath(text, dynamic.context, dynamic.material) : { dynamic: true, value: null, optional: false };
          expansion = { template: text, expanded: expanded.value, optional: expanded.optional };
          if (expanded.value) resource = ctx.graph.provenance(refFromPath(expanded.value));
          else if (!expanded.optional) gaps.push(`Param ${name}: dynamic path ${text} is unresolvable here.`);
        } else if (value.ref) resource = ctx.graph.provenance(value.ref);
      }
      params.set(name, { name, kind: value.kind, value: expansion?.expanded ?? paramText(value), setBy: current.label, resource, dynamic: expansion });
    }
    const baseText = depotText(current.instance.baseMaterial);
    let baseRef = depotRef(current.instance.baseMaterial);
    if (baseText?.startsWith("*")) {
      const expanded = dynamic ? expandDynamicPath(baseText, dynamic.context, dynamic.material) : { dynamic: true, value: null, optional: false };
      baseRef = expanded.value ? refFromPath(expanded.value) : null;
      if (!baseRef) gaps.push(`Base material ${baseText} of ${current.label} is unresolvable here.`);
    }
    chain.push({ label: current.label, provenance: current.provenance, baseMaterial: baseRef ? refLabel(ctx.graph.named(baseRef)) : baseText });
    if (!baseRef) break;
    const extension = extensionOf(ctx.graph.named(baseRef));
    if (extension === "mt" || extension === "remt") { template = ctx.graph.provenance(baseRef); break; }
    const next = await ctx.graph.load(baseRef, "mi");
    if (!next) { gaps.push(`Base material ${refLabel(ctx.graph.named(baseRef))} is not provided by any mounted archive.`); template = ctx.graph.provenance(baseRef); break; }
    const nextType = next.root.$type;
    if (nextType !== "CMaterialInstance") { template = next.provenance; break; }
    current = { label: refLabel(next.ref), instance: next.root, provenance: next.provenance };
  }
  return { chain, params: [...params.values()], template, gaps };
}

/** ArchiveXL ProcessAppearance expansion of an appearance without chunk materials [source: Mesh/Extension.cpp 88–166]. */
function expandAppearance(mesh: MeshModel, appearance: MeshAppearanceModel): { chunkMaterials: string[]; expandedFrom: string | null } {
  if (appearance.chunkMaterials.length) return { chunkMaterials: appearance.chunkMaterials, expandedFrom: null };
  const expansionName = appearance.expansionTag || mesh.contextAttrs.get("appearance_expansion_source") || "";
  const index = Math.max(0, mesh.appearances.findIndex(a => a.name === expansionName));
  const source = mesh.appearances[index];
  if (!source || source === appearance) return { chunkMaterials: [], expandedFrom: null };
  return { expandedFrom: source.name, chunkMaterials: source.chunkMaterials.map(name => {
    const at = name.indexOf("@");
    if (at >= 0) return appearance.name + name.slice(at);
    return name === source.name ? appearance.name : name;
  }) };
}

/**
 * A render chunk past the end of its appearance's chunk material list: it has no material of its own (`route: "none"`). CCXL
 * meshes do this on purpose, pointing their lower levels of detail at three-vertex stub chunks. When ArchiveXL patched the
 * appearance, it appends the patch source's tag to the list, so the first unlisted chunk gets the tag's empty placeholder material
 * (`s_dummyMaterial`, a `CMaterialInstance` with no base) [source: ArchiveXL Mesh/Extension.cpp `ProcessAppearance`,
 * `ProcessDynamicMaterials`]. Neither has a template, so neither draws in the preview; how the engine draws them is unread [hypothesis].
 */
function unlistedChunk(chunk: number, listed: number, patchSource: string | null): ResolvedChunkMaterial {
  const gap = patchSource && chunk === listed
    ? `The appearance lists ${listed} chunk material(s); ArchiveXL appends the tag of its patch source (${patchSource}), so this chunk gets that tag's empty placeholder material.`
    : `The appearance lists ${listed} chunk material(s), so this chunk has no material of its own.`;
  return { chunk, name: "", route: "none", entry: null, dynamic: null, chain: [], template: null, params: [], gaps: [gap] };
}

async function resolveChunkMaterial(ctx: Context, target: MeshModel, source: MeshModel, chunk: number, name: string): Promise<ResolvedChunkMaterial> {
  const unresolved = (gap: string): ResolvedChunkMaterial =>
    ({ chunk, name, route: "unresolved", entry: null, dynamic: null, chain: [], template: null, params: [], gaps: [gap] });
  type Found = { kind: "local"; start: { label: string; instance: JsonObject; provenance: Provenance | null } }
    | { kind: "external"; ref: DepotRef | null } | null;
  const instanceOf = (mesh: MeshModel, entryIndex: number): Found => {
    const entry = mesh.entries[entryIndex]!;
    if (entry.local) {
      const instance = mesh.localMaterials[entry.index];
      return instance ? { kind: "local", start: { label: `${refLabel(mesh.loaded.ref)} local material ${entry.index} (${entry.name})`, instance, provenance: null } } : null;
    }
    return { kind: "external", ref: mesh.externalMaterials[entry.index]?.ref ?? null };
  };
  const plain = async (mesh: MeshModel, index: number, route: "entry" | "patch-entry") => {
    const entry = mesh.entries[index]!;
    const found = instanceOf(mesh, index);
    const meta = { mesh: refLabel(mesh.loaded.ref), local: entry.local, index: entry.index };
    if (!found) return { ...unresolved(`Local material ${entry.index} is missing from ${meta.mesh}.`), route, entry: meta };
    if (found.kind === "local") {
      const walked = await materialChain(ctx, found.start, null);
      return { chunk, name, route, entry: meta, dynamic: null, ...walked };
    }
    const ref = found.ref;
    if (!ref) return { ...unresolved(`External material ${entry.index} of ${meta.mesh} has no path.`), route, entry: meta };
    const extension = extensionOf(ctx.graph.named(ref));
    if (extension === "mt" || extension === "remt")
      return { chunk, name, route, entry: meta, dynamic: null, chain: [], template: ctx.graph.provenance(ref), params: [], gaps: [] };
    const loaded = await ctx.graph.load(ref, "mi");
    if (!loaded) return { chunk, name, route, entry: meta, dynamic: null, chain: [], template: null, params: [],
      gaps: [`${refLabel(ctx.graph.named(ref))} is not provided by any mounted archive.`] };
    const walked = await materialChain(ctx, { label: refLabel(loaded.ref), instance: loaded.root, provenance: loaded.provenance }, null);
    return { chunk, name, route, entry: meta, dynamic: null, ...walked };
  };
  const isTemplate = (entryName: string) => entryName.startsWith("@");
  const targetIndex = target.entries.findIndex(entry => entry.name === name && !isTemplate(entry.name));
  if (targetIndex >= 0) return plain(target, targetIndex, "entry");
  if (source !== target) {
    const sourceIndex = source.entries.findIndex(entry => entry.name === name && !isTemplate(entry.name));
    if (sourceIndex >= 0) return plain(source, sourceIndex, "patch-entry");
  }
  const at = name.indexOf("@");
  const templateName = at >= 0 ? name.slice(at) : "@material";
  const materialName = at >= 0 ? name.slice(0, at) : name;
  const templateIndex = source.entries.findIndex(entry => entry.name === templateName);
  if (templateIndex < 0) return unresolved(`Material ${name} is not defined and template ${templateName} does not exist in ${refLabel(source.loaded.ref)} (ArchiveXL logs an error).`);
  const context = { context: target.contextAttrs, material: materialAttrs(materialName), contextParams: target.contextParams };
  const entry = source.entries[templateIndex]!;
  const meta = { mesh: refLabel(source.loaded.ref), local: entry.local, index: entry.index };
  const dynamicMeta = { template: templateName, material: materialName, context: Object.fromEntries(target.contextAttrs) };
  let start: { label: string; instance: JsonObject; provenance: Provenance | null } | null = null;
  const gaps: string[] = [];
  if (entry.local) {
    const instance = source.localMaterials[entry.index];
    if (instance) start = { label: `${meta.mesh} template ${templateName}`, instance, provenance: null };
  } else {
    const external = source.externalMaterials[entry.index];
    const text = external?.text ?? (external?.ref ? refLabel(external.ref) : null);
    const expanded = text ? expandDynamicPath(text, context.context, context.material) : null;
    const ref = expanded?.value ? refFromPath(expanded.value) : external?.ref ?? null;
    const loaded = ref ? await ctx.graph.load(ref, "mi") : null;
    if (loaded) start = { label: refLabel(loaded.ref), instance: loaded.root, provenance: loaded.provenance };
    else gaps.push(`Template source ${text ?? "(none)"} could not be loaded.`);
  }
  if (!start) return { chunk, name, route: "template", entry: meta, dynamic: dynamicMeta, chain: [], template: null, params: [], gaps };
  const walked = await materialChain(ctx, start, context);
  return { chunk, name, route: "template", entry: meta, dynamic: dynamicMeta, ...walked, gaps: [...gaps, ...walked.gaps] };
}

async function resolveComponent(ctx: Context, component: ComponentModel, origin: ResolvedComponent["origin"], overriddenBy: string[],
  morphs: readonly { region: string; target: string }[]): Promise<ResolvedComponent> {
  const notes: RuleNote[] = [];
  const base = { name: component.name, type: component.type, origin, meshAppearance: component.meshAppearance,
    chunkMask: component.chunkMask, overriddenBy, morphRegions: {}, appliedMorphs: [], meshAppearanceResolved: null, materials: [] };
  if (!isRenderable(component.type)) return { ...base, geometry: null, notes };
  let morph = null, meshRef: DepotRef | null = component.mesh, renderChunks: number | null = null;
  let chunkLods: readonly number[] | null = null, chunkScene: readonly boolean[] | null = null;
  const patchedFrom: string[] = [];
  let morphProvenance: Provenance | null = null;
  let blobFrom: DepotRef | null = null;
  let morphTexture: { texture: Provenance | null; parameter: string } | null = null;
  const morphRegions: Record<string, number> = {};
  if (component.morphResource) {
    // A morph component names its base mesh too (usually the morph target's own): read it with the morph target, not after it.
    if (component.mesh) ctx.graph.prefetchRef(component.mesh, "mesh");
    morph = await ctx.graph.morph(component.morphResource);
    morphProvenance = ctx.graph.provenance(component.morphResource, morph?.loaded.provenance.extractedSha256 ?? null);
    if (morph) {
      meshRef = morph.baseMesh; renderChunks = morph.renderChunks; chunkLods = morph.renderChunkLods; chunkScene = morph.renderChunkScene; notes.push(...morph.notes);
      if (morph.blobFrom) { patchedFrom.push(refLabel(morph.blobFrom)); blobFrom = morph.blobFrom; }
      morphTexture = { texture: morph.baseTexture ? ctx.graph.provenance(morph.baseTexture) : null, parameter: morph.baseTextureParam };
      for (const target of morph.targets) morphRegions[target.region] = (morphRegions[target.region] ?? 0) + 1;
    } else ctx.gaps.push({ code: "morphtarget-missing", subject: refLabel(ctx.graph.named(component.morphResource)), detail: `Component ${component.name} names a morph target no mounted archive provides.` });
  }
  const mesh = meshRef ? await ctx.graph.mesh(meshRef) : null;
  if (meshRef && !mesh) ctx.gaps.push({ code: "mesh-missing", subject: refLabel(ctx.graph.named(meshRef)), detail: `Component ${component.name}: mesh not provided by any mounted archive.` });
  if (mesh) { notes.push(...mesh.notes); if (!component.morphResource) { renderChunks = mesh.renderChunks; chunkLods = mesh.renderChunkLods; chunkScene = mesh.renderChunkScene; } if (mesh.renderBlobFrom) patchedFrom.push(refLabel(mesh.renderBlobFrom)); }
  // Morph components draw their morph target's blob; plain mesh components draw the mesh's render blob.
  const drawnRef = component.morphResource ? (morph ? blobFrom ?? component.morphResource : null)
    : mesh ? mesh.renderBlobFrom ?? meshRef : null;
  const visible = renderChunks === null ? null : visibleChunks(component.chunkMask, renderChunks);
  const appliedMorphs = morph ? morphs.filter(m => morph!.targets.some(t => t.name === m.target && t.region === m.region))
    .map(({ region, target }) => ({ region, target })) : [];
  const drawsNothing = renderChunks === 0 || (visible !== null && visible.length === 0);
  if (renderChunks === 0) notes.push(note("R8-zero-chunks", "resource", "Geometry with zero render chunks draws nothing (e.g. an unfilled slot placeholder)."));
  let materials: ResolvedChunkMaterial[] = [], meshAppearanceResolved: ResolvedComponent["meshAppearanceResolved"] = null;
  if (mesh && visible && visible.length) {
    const requested = component.meshAppearance || (morph?.baseMeshAppearance ?? "") || "default";
    let appearance = mesh.appearances.find(a => a.name === requested);
    if (!appearance) {
      ctx.ambiguities.push({ code: "mesh-appearance-missing", subject: `${refLabel(mesh.loaded.ref)}:${requested}`, grade: "hypothesis",
        chosen: mesh.appearances[0]?.name, detail: "Requested mesh appearance is absent; the first appearance is assumed (engine fallback unread)." });
      appearance = mesh.appearances[0];
    }
    if (appearance) {
      const { chunkMaterials, expandedFrom } = expandAppearance(mesh, appearance);
      const source = appearance.patchSource ? await ctx.graph.mesh(appearance.patchSource) : mesh;
      meshAppearanceResolved = { requested, used: appearance.name, expandedFrom, patchedFrom: appearance.patchedFrom ? refLabel(appearance.patchedFrom) : null };
      materials = await Promise.all(visible.map(chunk => {
        const name = chunkMaterials[chunk];
        if (name === undefined) return Promise.resolve(unlistedChunk(chunk, chunkMaterials.length, appearance!.patchedFrom ? refLabel(ctx.graph.named(appearance!.patchedFrom)) : null));
        return resolveChunkMaterial(ctx, mesh, source ?? mesh, chunk, name);
      }));
      if (visible.some(chunk => chunk >= chunkMaterials.length))
        notes.push(note("R10-short-chunk-list", "hypothesis", `Appearance ${appearance.name} lists ${chunkMaterials.length} chunk material(s) for ${renderChunks} render chunks; the chunks past the list have no material of their own (ArchiveXL gives a patched appearance's first unlisted chunk its empty placeholder material; engine drawing of an unlisted chunk unread).`));
    }
  }
  return { ...base, morphRegions, appliedMorphs, meshAppearanceResolved, materials,
    geometry: { morphTarget: morphProvenance, mesh: meshRef ? ctx.graph.provenance(meshRef, mesh?.loaded.provenance.extractedSha256 ?? null) : null,
      renderChunks, chunkLods, chunkInScene: chunkScene, visibleChunks: visible, drawsNothing, patchedFrom,
      drawnFrom: drawnRef ? ctx.graph.provenance(drawnRef) : null, morphTexture }, notes };
}

async function resolveAppearance(ctx: Context, merged: MergedCco, descriptor: AppearanceDescriptor, groups: string[],
  morphs: readonly { region: string; target: string }[]): Promise<ResolvedAppearance> {
  const notes: RuleNote[] = [];
  const graph = ctx.graph;
  const requested = graph.named(descriptor.app);
  const override = merged.appOverrides.get(overrideKey(requested.hash, descriptor.definition));
  const appRef = override ? graph.named(refFromHash(override.app)) : requested;
  if (override) notes.push(note("R6-app-override", "source", `ArchiveXL rewrites (${refLabel(requested)}, ${descriptor.definition}) to ${refLabel(appRef)} (${override.registeredBy}).`));
  const option = merged.cco.parts[descriptor.part].options.find(o => o.name === descriptor.option);
  const choiceDef = option?.type === "appearance" ? option.definitions.find(d => d.name === descriptor.definition) : undefined;
  if (!choiceDef) ctx.ambiguities.push({ code: "choice-not-in-cco", subject: `${descriptor.option}:${descriptor.definition}`, grade: "resource",
    detail: "The effective character-creator resource has no such option/definition; the saved descriptor is resolved as stored." });
  // Worn items' overrides reach the body and arms; the head keeps its parts (the preview's head is the makeup's canvas), and what an
  // item would hide there is reported as a gap instead.
  const found = await resolveDefinition(ctx, appRef, descriptor.definition, inScope(graph.xl, CUSTOMIZATION_SCOPE, appRef.hash), morphs,
    descriptor.part === "head" ? "report" : "apply");
  return { option: descriptor.option, part: descriptor.part, groups, definition: descriptor.definition, requestedApp: requested,
    app: found.app, appOverride: override ? { to: appRef, registeredBy: override.registeredBy } : null,
    choice: choiceDef && option ? { providedBy: choiceDef.providedBy, optionDefinedBy: option.definedBy } : null,
    appearance: found.appearance, components: [...found.components], notes: [...notes, ...found.notes] };
}

/** An `.app` definition resolved to its drawing components (rules R6–R10), whatever asked for it: a creator choice or a worn item. */
export type ResolvedDefinition = {
  readonly app: Provenance | null;
  readonly appearance: ResolvedAppearance["appearance"];
  /** The definition's own `visualTags`. */
  readonly visualTags: readonly string[];
  /** The visual tags of the part entities it draws (`visualTagsSchema`), by part depot path. */
  readonly partTags: ReadonlyMap<string, readonly string[]>;
  /** Entity-wide `partsOverrides` entries (no part resource): ArchiveXL applies them to every component of the player. */
  readonly entityOverrides: readonly { readonly componentName: string; readonly meshAppearance: string; readonly chunkMask: string }[];
  readonly components: readonly ResolvedComponent[];
  readonly notes: readonly RuleNote[];
};

async function resolveDefinition(ctx: Context, appRef: DepotRef, definitionName: string, customizationScope: boolean,
  morphs: readonly { region: string; target: string }[], overrideMode: "apply" | "report" = "apply"): Promise<ResolvedDefinition> {
  const notes: RuleNote[] = [];
  const graph = ctx.graph;
  const empty = (status: "missing" | "unreadable", detail: string): ResolvedDefinition => {
    ctx.gaps.push({ code: `appearance-${status}`, subject: `${refLabel(appRef)}:${definitionName}`, detail });
    return { app: graph.provenance(appRef), appearance: { status, source: null, patchedBy: [] }, visualTags: [], partTags: new Map(), entityOverrides: [],
      components: [], notes };
  };
  const app = await graph.app(appRef);
  if (!app) {
    const unread = graph.loadErrors.get(appRef.hash);
    return unread ? empty("unreadable", unread) : empty("missing", "No mounted archive provides the appearance resource.");
  }
  notes.push(...app.patchNotes);
  let definition = app.appearances.find(a => a.name === definitionName);
  let status: ResolvedAppearance["appearance"]["status"] = "defined", sourceName: string | null = definition?.name ?? null;
  if (!definition && customizationScope) {
    const dynamic = dynamicAppearance(app.appearances, definitionName);
    if (dynamic) { definition = dynamic.definition; status = "dynamic"; sourceName = dynamic.source;
      notes.push(note("R6-dynamic-appearance", "source", `ArchiveXL FixCustomizationAppearance builds ${definitionName} from ${dynamic.source} (app is in the ${CUSTOMIZATION_SCOPE} scope).`)); }
  }
  if (!definition) return empty("missing", customizationScope ? "Appearance absent and no template could be derived." : "Appearance absent and the app is outside ArchiveXL's customization scope.");
  // Garment OnResolveDefinition: parts whose resource does not exist are dropped [source].
  const parts = definition.partsValues.filter(part => {
    if (graph.exists(part.hash)) return true;
    ctx.gaps.push({ code: "part-missing", subject: refLabel(graph.named(part)), detail: "partsValues entry dropped: resource does not exist (ArchiveXL removes it)." });
    return false;
  });
  const components: { model: ComponentModel; origin: ResolvedComponent["origin"] }[] = [];
  const inline = structuredClone(definition.components);
  for (const model of inline) components.push({ model, origin: { kind: "inline", source: `${refLabel(appRef)}:${definition.name} (${definition.componentsSource})` } });
  // The appearance's parts are read together (one extraction batch), and only this appearance's (PIPE-64).
  const entities = await Promise.all(parts.map(part => graph.entityComponents(part)));
  const partTags = new Map<string, readonly string[]>();
  for (const [index, part] of parts.entries()) {
    const entity = entities[index];
    if (!entity) continue;
    if (entity.tags.length) partTags.set(refLabel(entity.loaded.ref), entity.tags);
    for (const model of entity.components) {
      const existing = components.find(c => c.model.name === model.name);
      if (existing) { (existing.origin as { alsoIn?: string }).alsoIn = refLabel(entity.loaded.ref); continue; }
      components.push({ model: structuredClone(model), origin: { kind: "part", source: refLabel(entity.loaded.ref), partHash: part.hash } });
    }
  }
  const names = components.map(c => c.model.name).filter(Boolean);
  for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i)))
    ctx.ambiguities.push({ code: "duplicate-component-name", subject: `${refLabel(appRef)}:${definition.name}:${name}`, grade: "hypothesis",
      detail: `${names.filter(n => n === name).length} components share this name; overrides are applied to all of them and each is kept (engine handling unread).` });
  if (components.some(c => c.origin.alsoIn))
    notes.push(note("R7-dedupe-by-name", "hypothesis", "Inline and part components with the same name are treated as one (cooked apps mirror part components inline)."));
  // R7: partsOverrides apply by component name; an override without partResource applies entity-wide [source: ArchiveXL RegisterComponentOverrides; native order hypothesis].
  const overriddenBy = new Map<string, string[]>();
  for (const entry of definition.partsOverrides) for (const override of entry.componentsOverrides) {
    for (const { model, origin } of components) {
      if (override.componentName !== model.name) continue;
      if (entry.partResource && origin.kind === "part" && entry.partResource.hash !== origin.partHash) continue;
      if (override.meshAppearance) model.meshAppearance = override.meshAppearance;
      model.chunkMask = override.chunkMask;
      overriddenBy.set(model.name, [...(overriddenBy.get(model.name) ?? []), "partsOverrides"]);
    }
  }
  if (customizationScope && definition.partsOverrides[0]) {
    // FixCustomizationComponents: the appearance package's own mesh components take the first override's mesh appearance.
    for (const override of definition.partsOverrides[0].componentsOverrides)
      for (const { model, origin } of components) {
        if (origin.kind !== "inline" || !isRenderable(model.type)) continue;
        if (override.componentName && override.componentName !== model.name) continue;
        if (model.meshAppearance && model.meshAppearance !== "default" && override.meshAppearance) {
          model.meshAppearance = override.meshAppearance;
          overriddenBy.set(model.name, [...(overriddenBy.get(model.name) ?? []), "ArchiveXL FixCustomizationComponents"]);
        }
      }
  }
  // Worn items' overrides of every component of the player (ArchiveXL ApplyAppearanceOverride, ApplyChunkMaskOverride) [source].
  for (const { model } of components) {
    if (!isRenderable(model.type)) continue;
    if (overrideMode === "report") {
      const masked = overriddenMask(model.name, model.chunkMask, ctx.overrides);
      if (masked && masked.mask !== model.chunkMask) ctx.gaps.push({ code: "worn-item-hides-head", subject: model.name,
        detail: `A worn item hides this head part in game (${masked.by.join(", ")}); the preview keeps it shown.` });
      continue;
    }
    const appearance = ctx.overrides.appearances.get(model.name);
    if (appearance) { model.meshAppearance = appearance.appearance; overriddenBy.set(model.name, [...(overriddenBy.get(model.name) ?? []), `worn item (${appearance.by})`]); }
    const masked = overriddenMask(model.name, model.chunkMask, ctx.overrides);
    if (masked && masked.mask !== model.chunkMask) {
      model.chunkMask = masked.mask;
      overriddenBy.set(model.name, [...(overriddenBy.get(model.name) ?? []), ...masked.by.map(by => `worn item (${by})`)]);
    }
  }
  const resolved = await Promise.all(components.map(({ model, origin }) => resolveComponent(ctx, model, origin, overriddenBy.get(model.name) ?? [], morphs)));
  const entityOverrides = definition.partsOverrides.filter(entry => !entry.partResource).flatMap(entry => entry.componentsOverrides)
    .filter(override => !!override.componentName).map(({ componentName, meshAppearance, chunkMask }) => ({ componentName, meshAppearance, chunkMask }));
  return { app: app.loaded.provenance, appearance: { status, source: sourceName, patchedBy: definition.patchedBy },
    visualTags: definition.visualTags ?? [], partTags, entityOverrides, components: resolved, notes };
}

/**
 * Resolve one `.app` definition outside the creator (a worn item's appearance): the same rules as a creator choice's (R6–R10), with the
 * worn items' component overrides. Its gaps and ambiguities are returned with it.
 */
export async function resolveAppDefinition(graph: ResourceGraph, appRef: DepotRef, definition: string,
  options: { overrides?: ComponentOverrides; morphs?: readonly { region: string; target: string }[] } = {}):
  Promise<ResolvedDefinition & { gaps: ResolvedCharacter["gaps"]; ambiguities: readonly Ambiguity[] }> {
  const ctx: Context = { graph, ambiguities: [], gaps: [], overrides: options.overrides ?? NO_OVERRIDES };
  const { value, ambiguities } = await graph.collect(() => resolveDefinition(ctx, graph.named(appRef), definition, false, options.morphs ?? []));
  return { ...value, gaps: ctx.gaps, ambiguities: [...ctx.ambiguities, ...ambiguities] };
}

/** `overrides`: what worn items change on every component of the player (their chunk masks and mesh appearances). */
export async function resolveCharacter(graph: ResourceGraph, input: CharacterInput,
  preloaded?: Awaited<ReturnType<typeof loadMergedCco>>, overrides: ComponentOverrides = NO_OVERRIDES): Promise<ResolvedCharacter> {
  const ctx: Context = { graph, ambiguities: [...graph.depot.plan.ambiguities], gaps: [], overrides };
  const cco = preloaded ?? await loadMergedCco(graph, input.bodyGender);
  ctx.gaps.push(...cco.gaps);
  ctx.ambiguities.push(...cco.merged.ambiguities);
  // One resolution per (app, definition); the save repeats a choice in every consuming group.
  const unique = new Map<string, { descriptor: AppearanceDescriptor; groups: string[] }>();
  for (const descriptor of input.appearances) {
    const key = `${descriptor.part}|${descriptor.option}|${descriptor.app.hash}|${descriptor.definition}`;
    const entry = unique.get(key);
    if (entry) entry.groups.push(descriptor.group); else unique.set(key, { descriptor, groups: [descriptor.group] });
  }
  const morphKeys = new Map<string, { region: string; target: string; groups: string[] }>();
  for (const morph of input.morphs) {
    const key = `${morph.region}|${morph.target}`;
    const entry = morphKeys.get(key);
    if (entry) entry.groups.push(morph.group); else morphKeys.set(key, { region: morph.region, target: morph.target, groups: [morph.group] });
  }
  const morphs = [...morphKeys.values()];
  // The precedence ambiguities this V's own reads met, and the merged creator resource's (PIPE-63).
  const { value: appearances, ambiguities: observed } = await graph.collect(() =>
    Promise.all([...unique.values()].map(({ descriptor, groups }) => resolveAppearance(ctx, cco.merged, descriptor, groups, morphs))));
  const precedence = new Map([...(cco.ambiguities ?? []), ...observed].map(entry => [`${entry.code}|${entry.subject}|${entry.detail}`, entry]));
  const applied = (region: string, target: string) => appearances.reduce((sum, a) => sum + a.components.filter(c => c.appliedMorphs.some(m => m.region === region && m.target === target)).length, 0);
  return { schema: "xfs/resolved-character-1", bodyGender: input.bodyGender, origin: input.origin,
    cco: { base: cco.base, customResources: cco.customs, hairColorTags: cco.merged.hairColorTags },
    appearances, morphs: morphs.map(m => ({ ...m, components: applied(m.region, m.target) })),
    ambiguities: [...ctx.ambiguities, ...precedence.values()], gaps: ctx.gaps,
    rules: [...graph.depot.plan.rules, ...cco.merged.rules,
      note("R9-morphs", "hypothesis", "A (target, region) pair applies to every morph component whose targets contain it; manager semantics unread."),
      note("R10-materials", "source", "Mesh appearance → chunk materials → entries or ArchiveXL templates (@name, @context, *{attr} paths) → instance chain to .mt/.remt; Mesh/Extension.cpp replicated for static and template routes.")] };
}

