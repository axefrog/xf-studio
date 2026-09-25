/**
 * Effective game resources: where each depot path comes from (archive precedence plus ArchiveXL copies and
 * links) and what it contains after ArchiveXL fixes and patches. Pure apart from the fetch port, which the
 * adapter implements (e.g. WolvenKit CLI extraction to JSON).
 *
 * Rules and grades (knowledge/cc-file-chain.md section 8, knowledge/mod-loading.md):
 * - R1 archive precedence: archive-precedence.ts.
 * - R3 `resource.copy`/`resource.link`: consulted only when no archive provides the path [source: ArchiveXL
 *   ResourceLink rejects copies/links that name an existing resource].
 * - R3 `resource.fix names` on meshes and `resource.patch` of meshes (appearances, renderResourceBlob),
 *   morph targets (baseMesh, baseMeshAppearance, blob, boundingBox, targets) and `.app` definitions
 *   (appearances, partsValues, partsOverrides) [source: ArchiveXL ResourcePatch/Extension.cpp
 *   OnMeshResourceLoad, OnMorphTargetResourceLoad, OnAppearanceResourceLoad].
 */
import { type DepotLookup, type DepotIndex, type MountGroup, type MountedArchive } from "./archive-precedence";
import { type ArchiveXlConfig, type DepotAdditions, type XlPatch, patchModifies, settleDepotAdditions } from "./archivexl-config";
import { refFromHash, refFromPath, type DepotRef, refLabel } from "./depot-path";
import { asArray, cname, cr2wRoot, depotRef, depotText, HandleScope, isObject, materialParams, packageChunks,
  type JsonObject, type MaterialParamValue } from "./red-json";
import { type Ambiguity, type RuleNote, note } from "./resolution-evidence";

/** Adapter port: read one resource's serialized JSON out of a specific mounted archive. */
export interface ResourceFetchPort {
  /** `extension` is the expected resource extension when the reference carries no path (e.g. "mesh"). */
  fetch(archive: MountedArchive, ref: DepotRef, extension: string | null): Promise<FetchedResource | null>;
}
export interface FetchedResource {
  readonly document: unknown;
  /** SHA-256 of the extracted resource bytes, when the adapter measured them. */
  readonly extractedSha256: string | null;
  /** Depot path learned from the archive's own file listing, if the reference had none. */
  readonly path?: string | null;
  /** The adapter extracted it just now (not from its cache): the resources it names are likely not cached either. */
  readonly fresh?: boolean;
}

/** Where a resource came from and why that source won. Contains no physical paths. */
export interface Provenance {
  readonly ref: DepotRef;
  readonly status: "archive" | "missing";
  readonly archive: string | null;
  readonly group: MountGroup | null;
  readonly provider: string | null;
  /** Mounted archives that also index this hash and lost. */
  readonly alternatives: readonly string[];
  readonly rule: RuleNote;
  /** ArchiveXL copy/link hops taken before reaching an archive entry. */
  readonly via: readonly { kind: "copy" | "link"; to: DepotRef }[];
  readonly extractedSha256: string | null;
  readonly ambiguities: readonly string[];
}

export interface LoadedResource {
  readonly ref: DepotRef;
  readonly root: JsonObject;
  readonly provenance: Provenance;
}

export interface ComponentModel {
  readonly name: string;
  readonly type: string;
  readonly morphResource: DepotRef | null;
  readonly mesh: DepotRef | null;
  meshAppearance: string;
  chunkMask: string;
}
export interface ComponentOverride { readonly componentName: string; readonly meshAppearance: string; readonly chunkMask: string; readonly partResource: DepotRef | null }
export interface AppDefinitionModel {
  readonly name: string;
  readonly partsValues: DepotRef[];
  /** Each `partsOverrides` entry, in order. */
  readonly partsOverrides: { partResource: DepotRef | null; componentsOverrides: ComponentOverride[] }[];
  readonly components: ComponentModel[];
  readonly componentsSource: "compiledData" | "components" | "none";
  readonly patchedBy: string[];
}
export interface AppModel { readonly loaded: LoadedResource; readonly appearances: AppDefinitionModel[]; readonly patchNotes: RuleNote[] }

export interface MeshAppearanceModel {
  name: string;
  chunkMaterials: string[];
  expansionTag: string | null;
  /** Patch mesh whose material entries serve this appearance (null: the target mesh itself). */
  patchSource: DepotRef | null;
  /** Patch mesh that supplied the appearance, if any. */
  patchedFrom: DepotRef | null;
}
export interface MaterialEntryModel { name: string; local: boolean; index: number }
export interface MeshModel {
  readonly loaded: LoadedResource;
  readonly appearances: MeshAppearanceModel[];
  readonly entries: MaterialEntryModel[];
  readonly localMaterials: JsonObject[];
  readonly externalMaterials: { ref: DepotRef | null; text: string | null }[];
  readonly renderChunks: number | null;
  /** Each render chunk's LOD mask (bit 0 = the highest-detail level), when the blob lists them. */
  readonly renderChunkLods: readonly number[] | null;
  /** snake_case context attributes from the `@context` local material and `resource.fix context`. */
  readonly contextAttrs: Map<string, string>;
  /** Raw `@context` params, which override same-named params of instantiated templates. */
  readonly contextParams: [string, MaterialParamValue][];
  readonly renderBlobFrom: DepotRef | null;
  readonly notes: RuleNote[];
}
export interface MorphModel {
  readonly loaded: LoadedResource;
  readonly baseMesh: DepotRef | null;
  readonly baseMeshAppearance: string;
  readonly renderChunks: number | null;
  /** Each render chunk's LOD mask (bit 0 = the highest-detail level), when the blob lists them. */
  readonly renderChunkLods: readonly number[] | null;
  readonly targets: { name: string; region: string }[];
  readonly blobFrom: DepotRef | null;
  /**
   * `baseTexture` and `baseTextureParamName` after ArchiveXL patches: the morph component renders with a runtime
   * texture built from this base and binds it to the named material parameter (knowledge/eye-rendering.md §1.3).
   */
  readonly baseTexture: DepotRef | null;
  readonly baseTextureParam: string;
  readonly notes: RuleNote[];
}

const RENDERABLE = new Set(["entMorphTargetSkinnedMeshComponent", "entSkinnedMeshComponent", "entGarmentSkinnedMeshComponent",
  "entMeshComponent", "entSkinnedClothComponent", "entPhysicalMeshComponent"]);
export const isRenderable = (type: string) => RENDERABLE.has(type);

function readComponent(data: JsonObject): ComponentModel | null {
  const type = typeof data.$type === "string" ? data.$type : "";
  if (!type || type === "entEntity" || type === "gameObject") return null;
  return { name: cname(data.name), type, morphResource: depotRef(data.morphResource), mesh: depotRef(data.mesh),
    meshAppearance: cname(data.meshAppearance), chunkMask: typeof data.chunkMask === "string" ? data.chunkMask : String(data.chunkMask ?? "18446744073709551615") };
}

/** Components of an appearance definition or entity template: its compiled package when present, else `components`. */
export function readComponents(owner: JsonObject, scope: HandleScope): { components: ComponentModel[]; source: AppDefinitionModel["componentsSource"] } {
  const compiled = packageChunks(owner.compiledData).map(readComponent).filter((c): c is ComponentModel => !!c);
  if (compiled.length) return { components: compiled, source: "compiledData" };
  const inline = asArray(owner.components).map(item => scope.data(item)).filter((d): d is JsonObject => !!d)
    .map(readComponent).filter((c): c is ComponentModel => !!c);
  return { components: inline, source: inline.length ? "components" : "none" };
}

function readDefinition(data: JsonObject, scope: HandleScope): AppDefinitionModel {
  const { components, source } = readComponents(data, scope);
  return {
    name: cname(data.name),
    partsValues: asArray(data.partsValues).filter(isObject).map(part => depotRef(part.resource)).filter((r): r is DepotRef => !!r),
    partsOverrides: asArray(data.partsOverrides).filter(isObject).map(entry => ({
      partResource: depotRef(entry.partResource),
      componentsOverrides: asArray(entry.componentsOverrides).filter(isObject).map(override => ({
        componentName: cname(override.componentName), meshAppearance: cname(override.meshAppearance),
        chunkMask: typeof override.chunkMask === "string" ? override.chunkMask : String(override.chunkMask ?? "18446744073709551615"),
        partResource: depotRef(entry.partResource) })),
    })),
    components, componentsSource: source, patchedBy: [],
  };
}

const renderChunkCount = (blob: unknown, scope: HandleScope): number | null => {
  const data = scope.data(blob);
  if (!data) return null;
  const header = isObject(data.header) ? data.header : null;
  return header ? asArray(header.renderChunkInfos).length : null;
};

const chunkLodMasks = (blob: unknown, scope: HandleScope): number[] | null => {
  const data = scope.data(blob);
  const header = data && isObject(data.header) ? data.header : null;
  if (!header) return null;
  return asArray(header.renderChunkInfos).map(info => {
    const mask = isObject(info) ? Number(info.lodMask) : NaN;
    return Number.isInteger(mask) && mask > 0 ? mask : 1;
  });
};

/**
 * Prefetch: when a resource is read, the resources of these kinds that it names are requested at once, in the same
 * extraction batch as whatever else is being read, instead of one batch each when a consumer later asks for them one at
 * a time (an `.app`'s part entities, and the templates, profiles, gradients and layer setups a mesh or material names,
 * which the character details read one by one). Only a resource that a consumer asked for and that the fetch port had
 * to extract just now (`FetchedResource.fresh`: its neighbours are likely not cached either) is expanded, one step deep,
 * except that a fresh layer setup's templates are always requested with it. A cached resource is never expanded, so a V
 * whose resources are cached starts no extraction it does not need. Prefetch changes when a resource is read, never what
 * is read for it: the same archive precedence and fetch port answer, and a consumer later gets the same promise.
 */
export const PREFETCH: Readonly<Record<string, readonly string[]>> = {
  app: ["ent"],
  mesh: ["mt", "hp", "sp", "gradient", "mlsetup"],
  mi: ["mt", "hp", "sp", "gradient", "mlsetup"],
  mlsetup: ["mltemplate"],
};
const CASCADE = new Set(["mlsetup"]);
const extensionOf = (path: string | null | undefined) => path ? /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? null : null;

export const snakeCase = (value: string) => {
  let out = "", split = false;
  for (const ch of value) {
    if (ch >= "A" && ch <= "Z") { if (split) { out += "_"; split = false; } out += ch.toLowerCase(); }
    else { out += ch; split = ch !== "_"; }
  }
  return out;
};

export class ResourceGraph {
  readonly additions: DepotAdditions;
  private readonly loads = new Map<string, Promise<LoadedResource | null>>();
  private readonly lookups = new Map<string, DepotLookup>();
  private readonly apps = new Map<string, Promise<AppModel | null>>();
  private readonly meshes = new Map<string, Promise<MeshModel | null>>();
  private readonly morphs = new Map<string, Promise<MorphModel | null>>();
  /** hash → known path text: from `.xl` files and every string reference read so far. */
  readonly paths = new Map<string, string>();
  /** Resources a mounted archive provides but the fetch port could not read. */
  readonly loadErrors = new Map<string, string>();
  /** Precedence ambiguities met while resolving provenance, keyed by code and subject. */
  readonly observedAmbiguities = new Map<string, Ambiguity>();

  /** Named references (by kind) each loaded resource makes, kept until it is expanded (`PREFETCH`). */
  private readonly children = new Map<string, string[]>();
  /** Resources a consumer asked for, as opposed to prefetched ones. */
  private readonly requested = new Set<string>();

  constructor(readonly depot: DepotIndex, readonly xl: ArchiveXlConfig, readonly port: ResourceFetchPort, private readonly prefetch = true) {
    for (const [hash, path] of xl.paths) this.paths.set(hash, path);
    this.additions = settleDepotAdditions(xl, hash => this.lookup(hash).winner !== null);
  }

  lookup(hash: string): DepotLookup {
    let found = this.lookups.get(hash);
    if (!found) { found = this.depot.lookup(hash); this.lookups.set(hash, found); }
    return found;
  }

  /** Fill in a known path for a hash-only reference. */
  named(ref: DepotRef): DepotRef {
    if (ref.path) { this.paths.set(ref.hash, ref.path); return ref; }
    const path = this.paths.get(ref.hash);
    return path ? { hash: ref.hash, path } : ref;
  }

  /** Does the depot (archives, copies or links) provide this hash? */
  exists(hash: string): boolean {
    return this.lookup(hash).winner !== null || this.additions.copies.has(hash) || this.additions.links.has(hash);
  }

  /** Follow ArchiveXL copies and links to the archive entry that supplies a reference. */
  locate(ref: DepotRef): { entry: DepotRef; lookup: DepotLookup; via: { kind: "copy" | "link"; to: DepotRef }[] } {
    const via: { kind: "copy" | "link"; to: DepotRef }[] = [];
    let current = this.named(ref);
    for (let hop = 0; hop < 8; hop++) {
      const lookup = this.lookup(current.hash);
      if (lookup.winner) return { entry: current, lookup, via };
      const copy = this.additions.copies.get(current.hash);
      const link = this.additions.links.get(current.hash);
      const next = copy ?? link;
      if (!next) return { entry: current, lookup, via };
      current = this.named(refFromHash(next));
      via.push({ kind: copy ? "copy" : "link", to: current });
    }
    return { entry: current, lookup: this.lookup(current.hash), via };
  }

  provenance(ref: DepotRef, extractedSha256: string | null = null): Provenance {
    const named = this.named(ref);
    const { lookup, via } = this.locate(named);
    for (const ambiguity of lookup.ambiguities)
      this.observedAmbiguities.set(`${ambiguity.code}|${ambiguity.subject}`, { ...ambiguity, subject: refLabel(named) });
    return { ref: named, status: lookup.winner ? "archive" : "missing", archive: lookup.winner?.name ?? null,
      group: lookup.winner?.group ?? null, provider: lookup.winner?.providerName ?? null,
      alternatives: lookup.candidates.slice(1).map(c => `${c.name} (${c.group}, ${c.providerName})`),
      rule: via.length ? note(`R3-${via[0]!.kind}`, "source", `ArchiveXL resource.${via[0]!.kind} → ${refLabel(via[via.length - 1]!.to)}; ${lookup.rule.basis}`) : lookup.rule,
      via, extractedSha256, ambiguities: lookup.ambiguities.map(a => `${a.code}: ${a.detail}`) };
  }

  /** How many resources this graph has read or is reading. */
  get size(): number { return this.loads.size; }

  load(ref: DepotRef, extension: string | null = null): Promise<LoadedResource | null> {
    const pending = this.read(ref, extension);
    const hash = this.named(ref).hash;
    if (this.prefetch && !this.requested.has(hash)) { this.requested.add(hash); pending.then(() => this.expand(hash), () => {}); }
    return pending;
  }

  /** Request the prefetchable resources a loaded resource names (see `PREFETCH`), once. */
  private expand(hash: string): void {
    const children = this.children.get(hash);
    if (!children) return;
    this.children.delete(hash);
    for (const path of children) {
      const child = refFromPath(path);
      if (this.loads.has(child.hash) || !this.exists(child.hash)) continue;
      // A prefetch that fails is not this caller's failure; a consumer that asks for the resource gets the same answer.
      const loaded = this.read(child, extensionOf(path));
      loaded.then(() => { if (CASCADE.has(extensionOf(path)!)) this.expand(child.hash); }, () => {});
    }
  }

  private read(ref: DepotRef, extension: string | null): Promise<LoadedResource | null> {
    const named = this.named(ref);
    let pending = this.loads.get(named.hash);
    if (!pending) {
      pending = (async () => {
        const { entry, lookup } = this.locate(named);
        if (!lookup.winner) return null;
        const fetched = await this.port.fetch(lookup.winner, entry, extension);
        if (!fetched) { this.loadErrors.set(named.hash, `${lookup.winner.name} provides it, but it could not be extracted or converted.`); return null; }
        if (fetched.path && !entry.path) this.paths.set(entry.hash, fetched.path);
        if (fetched.path && !named.path && entry.hash === named.hash) this.paths.set(named.hash, fetched.path);
        const { root } = cr2wRoot(fetched.document);
        const found: string[] = [];
        this.learnPaths(root, 0, found);
        const kinds = this.prefetch && fetched.fresh ? PREFETCH[extensionOf(this.named(named).path) ?? extension ?? ""] : undefined;
        if (kinds) {
          const wanted = [...new Set(found.filter(path => !/[*{]/.test(path) && kinds.includes(extensionOf(path) ?? "")))];
          if (wanted.length) this.children.set(named.hash, wanted);
        }
        return { ref: this.named(named), root, provenance: this.provenance(named, fetched.extractedSha256) };
      })();
      this.loads.set(named.hash, pending);
    }
    return pending;
  }

  private learnPaths(value: unknown, depth = 0, found?: string[]): void {
    if (depth > 64) return;
    if (Array.isArray(value)) { for (const item of value) this.learnPaths(item, depth + 1, found); return; }
    if (!isObject(value)) return;
    if (value.$type === "ResourcePath" && value.$storage === "string" && typeof value.$value === "string" && value.$value) {
      const ref = depotRef(value); if (ref) { this.paths.set(ref.hash, value.$value); found?.push(value.$value); }
      return;
    }
    for (const [key, item] of Object.entries(value)) if (key !== "Bytes") this.learnPaths(item, depth + 1, found);
  }

  patchesFor(hash: string): readonly XlPatch[] { return this.additions.patchesByTarget.get(hash) ?? []; }

  app(ref: DepotRef): Promise<AppModel | null> {
    let pending = this.apps.get(ref.hash);
    if (!pending) { pending = this.buildApp(ref); this.apps.set(ref.hash, pending); }
    return pending;
  }

  /**
   * Start reading a resource's ArchiveXL patch sources together with it: they are applied in order afterwards, but read
   * in one extraction batch instead of one batch per patch (a vanilla mesh several mods patch has many).
   */
  private readPatchSources(ref: DepotRef, extension: string, applies: (patch: XlPatch) => boolean = () => true): void {
    for (const patch of this.patchesFor(ref.hash))
      if (applies(patch)) this.load(refFromHash(patch.source, patch.sourcePath), extension).catch(() => {});
  }

  private async buildApp(ref: DepotRef): Promise<AppModel | null> {
    this.readPatchSources(ref, "app", patch => patchModifies(patch, "appearances"));
    const loaded = await this.load(ref, "app");
    if (!loaded) return null;
    const scope = new HandleScope(loaded.root);
    const appearances = asArray(loaded.root.appearances).map(item => scope.data(item)).filter((d): d is JsonObject => !!d)
      .map(data => readDefinition(data, scope));
    const patchNotes: RuleNote[] = [];
    for (const patch of this.patchesFor(ref.hash)) {
      if (!patchModifies(patch, "appearances")) continue;
      const source = await this.load(refFromHash(patch.source, patch.sourcePath), "app");
      if (!source) continue;
      const sourceScope = new HandleScope(source.root);
      const added = new Set<string>();
      for (const definition of asArray(source.root.appearances).map(item => sourceScope.data(item)).filter((d): d is JsonObject => !!d)
        .map(data => readDefinition(data, sourceScope))) {
        const multi = !definition.name;
        let isNew = !multi;
        for (const existing of appearances) {
          if (!multi) { if (existing.name !== definition.name) continue; isNew = false; if (added.has(definition.name)) break; }
          if (patchModifies(patch, "partsValues"))
            for (const part of definition.partsValues)
              if (this.exists(part.hash) && !existing.partsValues.some(p => p.hash === part.hash)) existing.partsValues.push(part);
          if (patchModifies(patch, "partsOverrides")) existing.partsOverrides.push(...definition.partsOverrides);
          if (patchModifies(patch, "components") && definition.components.length) existing.components.push(...definition.components);
          existing.patchedBy.push(patch.sourcePath);
          if (!multi) break;
        }
        if (isNew) { appearances.push({ ...definition, patchedBy: [patch.sourcePath] }); added.add(definition.name); }
      }
      patchNotes.push(note("R3-app-patch", "source", `${patch.sourcePath} patches appearances (${patch.declaredBy}); component merge is approximated.`));
    }
    return { loaded, appearances, patchNotes };
  }

  /** Components of a part `.ent` (compiled package first). */
  async entityComponents(ref: DepotRef): Promise<{ loaded: LoadedResource; components: ComponentModel[] } | null> {
    const loaded = await this.load(ref, "ent");
    if (!loaded) return null;
    return { loaded, components: readComponents(loaded.root, new HandleScope(loaded.root)).components };
  }

  mesh(ref: DepotRef): Promise<MeshModel | null> {
    let pending = this.meshes.get(ref.hash);
    if (!pending) { pending = this.buildMesh(ref); this.meshes.set(ref.hash, pending); }
    return pending;
  }

  private async buildMesh(ref: DepotRef): Promise<MeshModel | null> {
    this.readPatchSources(ref, "mesh");
    const loaded = await this.load(ref, "mesh");
    if (!loaded) return null;
    const read = (root: JsonObject) => {
      const scope = new HandleScope(root);
      return {
        scope,
        appearances: asArray(root.appearances).map(item => scope.data(item)).filter((d): d is JsonObject => !!d).map(data => ({
          name: cname(data.name), chunkMaterials: asArray(data.chunkMaterials).map(cname),
          tags: asArray(data.tags).map(cname) })),
        entries: asArray(root.materialEntries).filter(isObject).map(entry => ({ name: cname(entry.name), local: entry.isLocalInstance === 1 || entry.isLocalInstance === true, index: Number(entry.index ?? 0) })),
        localMaterials: (() => {
          const buffer = isObject(root.localMaterialBuffer) ? asArray(root.localMaterialBuffer.materials) : [];
          const items = buffer.length ? buffer : asArray(root.preloadLocalMaterialInstances);
          return items.map(item => scope.data(item)).filter((d): d is JsonObject => !!d);
        })(),
        externalMaterials: (asArray(root.externalMaterials).length ? asArray(root.externalMaterials) : asArray(root.preloadExternalMaterials))
          .map(item => ({ ref: depotRef(item), text: depotText(item) })),
        renderChunks: renderChunkCount(root.renderResourceBlob, scope),
        renderChunkLods: chunkLodMasks(root.renderResourceBlob, scope),
      };
    };
    const base = read(loaded.root);
    const notes: RuleNote[] = [];
    const fix = this.xl.fixes.get(ref.hash);
    if (fix?.names.size) {
      for (const appearance of base.appearances) appearance.chunkMaterials = appearance.chunkMaterials.map(name => fix.names.get(name) ?? name);
      for (const entry of base.entries) entry.name = fix.names.get(entry.name) ?? entry.name;
      notes.push(note("R3-fix-names", "source", `resource.fix names remap material names (${fix.declaredBy.join(", ")}).`));
    }
    const appearances: MeshAppearanceModel[] = base.appearances.map(a => ({ name: a.name, chunkMaterials: a.chunkMaterials,
      expansionTag: a.tags.length === 1 ? a.tags[0]! : null, patchSource: null, patchedFrom: null }));
    let renderChunks = base.renderChunks, renderChunkLods = base.renderChunkLods, renderBlobFrom: DepotRef | null = null;
    for (const patch of this.patchesFor(ref.hash)) {
      const source = await this.load(refFromHash(patch.source, patch.sourcePath), "mesh");
      if (!source) continue;
      const patchMesh = read(source.root);
      if (patchModifies(patch, "appearances") && patchMesh.appearances.length) {
        let expansionTag: string | null = null;
        for (const appearance of patchMesh.appearances) {
          if (appearance.tags.length === 1) expansionTag = appearance.tags[0]!;
          // MeshExtension::RegisterMeshPatch tags a patch as material source only if it has material entries.
          const clone: MeshAppearanceModel = { name: appearance.name, chunkMaterials: [...appearance.chunkMaterials], expansionTag,
            patchSource: patchMesh.entries.length ? source.ref : null, patchedFrom: source.ref };
          const index = appearances.findIndex(existing => existing.name === clone.name);
          if (index < 0) appearances.push(clone);
          else if (!appearances[index]!.chunkMaterials.length || clone.chunkMaterials.length) appearances[index] = clone;
        }
        notes.push(note("R3-mesh-patch-appearances", "source", `${patch.sourcePath} adds/replaces mesh appearances (${patch.declaredBy}).`));
      }
      if (patchMesh.renderChunks !== null && patchModifies(patch, "renderResourceBlob", base.renderChunks !== null)) {
        renderChunks = patchMesh.renderChunks; renderChunkLods = patchMesh.renderChunkLods; renderBlobFrom = source.ref;
        notes.push(note("R3-mesh-patch-blob", "source", `${patch.sourcePath} replaces the render blob (${patch.declaredBy}).`));
      }
    }
    // MeshState: the `@context` entry must be the first, local material entry.
    const contextAttrs = new Map<string, string>();
    let contextParams: [string, MaterialParamValue][] = [];
    const first = base.entries[0];
    if (first && first.local && first.name === "@context") {
      const instance = base.localMaterials[first.index];
      if (instance) {
        contextParams = materialParams(instance.values);
        for (const [name, value] of contextParams) if (value.kind === "name") contextAttrs.set(snakeCase(name), value.value);
      }
    }
    if (fix) for (const [name, value] of fix.context) contextAttrs.set(snakeCase(name), value);
    return { loaded, appearances, entries: base.entries, localMaterials: base.localMaterials, externalMaterials: base.externalMaterials,
      renderChunks, renderChunkLods, contextAttrs, contextParams, renderBlobFrom, notes };
  }

  morph(ref: DepotRef): Promise<MorphModel | null> {
    let pending = this.morphs.get(ref.hash);
    if (!pending) { pending = this.buildMorph(ref); this.morphs.set(ref.hash, pending); }
    return pending;
  }

  private async buildMorph(ref: DepotRef): Promise<MorphModel | null> {
    if (!this.additions.patchSources.has(ref.hash)) this.readPatchSources(ref, "morphtarget");
    const loaded = await this.load(ref, "morphtarget");
    if (!loaded) return null;
    const read = (root: JsonObject) => {
      const scope = new HandleScope(root);
      const blob = scope.data(root.blob);
      return {
        baseMesh: depotRef(root.baseMesh), baseMeshAppearance: cname(root.baseMeshAppearance),
        baseTexture: depotRef(root.baseTexture), baseTextureParam: cname(root.baseTextureParamName),
        blob, renderChunks: blob ? renderChunkCount(blob.baseBlob, scope) : null,
        renderChunkLods: blob ? chunkLodMasks(blob.baseBlob, scope) : null,
        targets: asArray(root.targets).filter(isObject).map(target => ({ name: cname(target.name), region: cname(target.regionName) })),
      };
    };
    const base = read(loaded.root);
    const notes: RuleNote[] = [];
    let { baseMesh, baseMeshAppearance, renderChunks, renderChunkLods, baseTexture, baseTextureParam } = base;
    const targets = [...base.targets];
    let blobFrom: DepotRef | null = null;
    // A patch source is never itself patched (OnMorphTargetResourceLoad returns early).
    if (!this.additions.patchSources.has(ref.hash)) for (const patch of this.patchesFor(ref.hash)) {
      const source = await this.load(refFromHash(patch.source, patch.sourcePath), "morphtarget");
      if (!source) continue;
      const patchMorph = read(source.root);
      if (patchMorph.baseMesh && patchModifies(patch, "baseMesh")) baseMesh = patchMorph.baseMesh;
      if (patchModifies(patch, "baseMeshAppearance", !patchMorph.baseMeshAppearance)) baseMeshAppearance = patchMorph.baseMeshAppearance;
      // OnMorphTargetResourceLoad: an empty source value overwrites only when the patch names the property.
      if (patchModifies(patch, "baseTexture", !patchMorph.baseTexture)) baseTexture = patchMorph.baseTexture;
      if (patchModifies(patch, "baseTextureParamName", !patchMorph.baseTextureParam)) baseTextureParam = patchMorph.baseTextureParam;
      if (patchMorph.blob && patchModifies(patch, "blob", !!base.blob)) { renderChunks = patchMorph.renderChunks; renderChunkLods = patchMorph.renderChunkLods; blobFrom = source.ref; }
      if (patchModifies(patch, "targets")) for (const target of patchMorph.targets) {
        const index = targets.findIndex(existing => existing.name === target.name);
        if (index >= 0) targets[index] = target; else targets.push(target);
      }
      notes.push(note("R3-morph-patch", "source", `${patch.sourcePath} patches this morph target (${[...patch.props].join(", ") || "all props"}; ${patch.declaredBy}).`));
    }
    return { loaded, baseMesh, baseMeshAppearance, renderChunks, renderChunkLods, targets, blobFrom, baseTexture, baseTextureParam, notes };
  }
}
