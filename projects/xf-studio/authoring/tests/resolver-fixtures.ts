// Asset-free builders for WolvenKit-shaped CR2W JSON and a synthetic installation, used by resolver tests.
import { type ArchiveFile, buildMountPlan, DepotIndex, type MountedArchive } from "../src/archive-precedence";
import { readArchiveXlConfig, type XlDocument } from "../src/archivexl-config";
import { depotHash, type DepotRef } from "../src/depot-path";
import { type FetchedResource, type ResourceFetchPort, ResourceGraph } from "../src/resource-graph";

export const cn = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
export const rp = (path: string | null, flags = "Default") =>
  ({ DepotPath: { $type: "ResourcePath", $storage: "string", $value: path ?? "" }, Flags: flags });
export const rh = (hash: string) => ({ DepotPath: { $type: "ResourcePath", $storage: "uint64", $value: hash }, Flags: "Default" });
let handles = 0;
export const handle = (data: object) => ({ HandleId: String(handles++), Data: data });
export const cr2w = (root: object) => ({ Header: { WolvenKitVersion: "test", GameVersion: 2310 }, Data: { Version: 195, RootChunk: root } });
export const ALL_CHUNKS = "18446744073709551615";

export const morphComponent = (name: string, morph: string | null, meshAppearance = "default", chunkMask = ALL_CHUNKS) =>
  ({ $type: "entMorphTargetSkinnedMeshComponent", name: cn(name), morphResource: morph ? rp(morph) : rp(null), meshAppearance: cn(meshAppearance), chunkMask });
export const meshComponent = (name: string, mesh: string, meshAppearance = "default", chunkMask = ALL_CHUNKS) =>
  ({ $type: "entSkinnedMeshComponent", name: cn(name), mesh: rp(mesh), meshAppearance: cn(meshAppearance), chunkMask });

export interface AppearanceSpec {
  name: string;
  components?: object[];
  parts?: string[];
  overrides?: { componentName: string; meshAppearance: string; chunkMask?: string }[];
}
export const app = (appearances: AppearanceSpec[]) => cr2w({ $type: "appearanceAppearanceResource", appearances: appearances.map(a => handle({
  $type: "appearanceAppearanceDefinition", name: cn(a.name),
  compiledData: { BufferId: "0", Flags: 0, Data: { Version: 4, Sections: 7, CruidIndex: -1, CruidDict: {}, Chunks: a.components ?? [] } },
  components: a.components ?? [],
  partsValues: (a.parts ?? []).map(part => ({ $type: "appearanceAppearancePart", resource: rp(part, "Soft") })),
  partsOverrides: a.overrides ? [{ $type: "appearanceAppearancePartOverrides", componentsOverrides: a.overrides.map(o => ({
    $type: "appearancePartComponentOverrides", componentName: cn(o.componentName), meshAppearance: cn(o.meshAppearance), chunkMask: o.chunkMask ?? ALL_CHUNKS })) }] : [],
})) });
export const ent = (components: object[]) => cr2w({ $type: "entEntityTemplate", components,
  compiledData: { BufferId: "0", Flags: 0, Data: { Version: 4, Sections: 7, CruidIndex: -1, CruidDict: {}, Chunks: [{ $type: "entEntity" }, ...components] } } });

const blob = (chunks: number) => handle({ $type: "rendRenderMeshBlob", header: { $type: "rendRenderMeshBlobHeader", renderChunkInfos: Array.from({ length: chunks }, () => ({ $type: "rendChunk" })) } });
export const morphtarget = (baseMesh: string, chunks: number | null, targets: [string, string][] = []) => cr2w({
  $type: "MorphTargetMesh", baseMesh: rp(baseMesh), baseMeshAppearance: cn("default"),
  blob: chunks === null ? null : handle({ $type: "rendRenderMorphTargetMeshBlob", baseBlob: blob(chunks), diffsBuffer: { BufferId: "1", Flags: 0, Bytes: "AAAA" } }),
  targets: targets.map(([name, region]) => ({ $type: "MorphTargetMeshEntry", name: cn(name), regionName: cn(region) })),
});
export interface MeshSpec {
  appearances: { name: string; chunkMaterials: string[]; tags?: string[] }[];
  entries: { name: string; local: boolean; index: number }[];
  local?: object[];
  external?: string[];
  chunks?: number | null;
}
export const mesh = (spec: MeshSpec) => cr2w({ $type: "CMesh",
  appearances: spec.appearances.map(a => handle({ $type: "meshMeshAppearance", name: cn(a.name), chunkMaterials: a.chunkMaterials.map(cn), tags: (a.tags ?? []).map(cn) })),
  materialEntries: spec.entries.map(e => ({ $type: "CMeshMaterialEntry", name: cn(e.name), isLocalInstance: e.local ? 1 : 0, index: e.index })),
  localMaterialBuffer: { $type: "meshMeshMaterialBuffer", materials: spec.local ?? [] },
  externalMaterials: (spec.external ?? []).map(path => rp(path, "Soft")),
  renderResourceBlob: spec.chunks === null || spec.chunks === undefined ? null : blob(spec.chunks) });
export const instance = (base: string, values: object[] = []) => ({ $type: "CMaterialInstance", baseMaterial: rp(base), values });
export const mi = (base: string, values: object[] = []) => cr2w(instance(base, values));
export const tex = (name: string, path: string) => ({ $type: "rRef:ITexture", [name]: rp(path, path.startsWith("*") ? "Soft" : "Default") });
export const nameParam = (name: string, value: string) => ({ $type: "CName", [name]: cn(value) });

type Option = Record<string, unknown>;
export const appearanceOption = (name: string, resource: string | null, definitions: string[], extra: Option = {}) => handle({
  $type: "gameuiAppearanceInfo", name: cn(name), resource: rp(resource, "Soft"), uiSlot: cn(extra.uiSlot as string ?? "None"),
  link: cn(extra.link as string ?? "None"), linkController: extra.linkController ?? 0, enabled: extra.enabled ?? 1, hidden: extra.hidden ?? 0,
  index: 0, defaultIndex: extra.defaultIndex ?? 0, localizedName: "", editTags: [],
  definitions: definitions.map((definition, index) => ({ $type: "gameuiIndexedAppearanceDefinition", name: cn(definition), index, localizedName: "", tags: { $type: "redTagList", tags: [] } })),
});
export const switcherOption = (name: string, choices: [string, string[]][], extra: Option = {}) => handle({
  $type: "gameuiSwitcherInfo", name: cn(name), uiSlot: cn("None"), link: cn("None"), linkController: 0, enabled: extra.enabled ?? 1, hidden: 0,
  index: 0, defaultIndex: extra.defaultIndex ?? 0, localizedName: "", editTags: [], uiSlots: [],
  options: choices.map(([localizedName, names], index) => ({ $type: "gameuiSwitcherOption", index, localizedName, names: names.map(cn) })),
});
export const morphOption = (name: string, targets: string[]) => handle({
  $type: "gameuiMorphInfo", name: cn(name), uiSlot: cn(name), link: cn("None"), linkController: 0, enabled: 1, hidden: 0, index: 0, defaultIndex: 0,
  localizedName: "", editTags: [], morphNames: ["None", ...targets].map((morphName, index) => ({ $type: "gameuiIndexedMorphName", index, localizedName: String(index + 1).padStart(2, "0"), morphName: cn(morphName) })),
});
export const cco = (head: object[], groups: Record<string, string[]>) => cr2w({ $type: "gameuiCharacterCustomizationInfoResource", version: 12,
  headCustomizationOptions: head, headGroups: Object.entries(groups).map(([name, options]) => ({ $type: "gameuiOptionsGroup", name: cn(name), options: options.map(cn) })),
  bodyCustomizationOptions: [], bodyGroups: [], armsCustomizationOptions: [], armsGroups: [] });

/** A synthetic installation: archives (by virtual path) holding path-keyed JSON resources, plus `.xl` documents. */
export interface FixtureArchive { virtualPath: string; provider?: ArchiveFile["provider"]; providerName?: string; priority?: number | null; active?: boolean; files: Record<string, object> }
export function fixtureInstallation(archives: FixtureArchive[], xl: XlDocument[] = [], modlist: string | null = null) {
  const files: ArchiveFile[] = archives.map((archive, i) => ({ id: `fixture-${i}:${archive.virtualPath}`, virtualPath: archive.virtualPath,
    provider: archive.provider ?? "game", providerName: archive.providerName ?? archive.virtualPath.split("/").pop()!,
    active: archive.active ?? true, priority: archive.priority ?? null }));
  const plan = buildMountPlan(files, modlist);
  const content = new Map<string, Map<string, object>>();
  const indexes = new Map<string, BigUint64Array>();
  archives.forEach((archive, i) => {
    const byHash = new Map(Object.entries(archive.files).map(([path, document]) => [depotHash(path), document]));
    content.set(files[i]!.id, byHash);
    indexes.set(files[i]!.id, BigUint64Array.from([...byHash.keys()].map(BigInt)).sort());
  });
  const fetched: { archive: string; ref: DepotRef }[] = [];
  const port: ResourceFetchPort = {
    async fetch(archive: MountedArchive, ref: DepotRef): Promise<FetchedResource | null> {
      fetched.push({ archive: archive.name, ref });
      const document = content.get(archive.id)?.get(ref.hash);
      return document ? { document: structuredClone(document), extractedSha256: `sha-${archive.name}-${ref.hash}` } : null;
    },
  };
  const depot = new DepotIndex(plan, indexes);
  const graph = new ResourceGraph(depot, readArchiveXlConfig(xl), port);
  return { plan, depot, graph, fetched };
}
