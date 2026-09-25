/**
 * Which female head the built-in eye plate is cut from: the resources the game is expected to load for the
 * selected launch route, not always the base-game copies. Pure: callers pass the route's depot index and
 * ArchiveXL additions (resolver-host) and, later, the extracted resources' JSON.
 *
 * Rules, all shared with the generic resolver (knowledge/mod-loading.md):
 * - the winning archive for a depot path is the first mounted provider (archive-precedence.ts); ArchiveXL
 *   `resource.copy`/`resource.link` apply only when no archive has the path [source: ArchiveXL ResourceLink];
 * - `.xl` patches that target the head mesh or morph are applied as ArchiveXL 1.27.3
 *   ResourcePatch/Extension.cpp does in OnMeshResourceLoad and OnMorphTargetResourceLoad [source], restricted
 *   to the properties that flow into the plate. A patch source is never itself patched.
 * Nothing here knows about any particular mod: a mod "wins" or "patches" only through these rules.
 */
import type { DepotLookup, MountGroup } from "./archive-precedence";
import { type DepotAdditions, patchModifies, type XlPatch } from "./archivexl-config";
import { depotHash } from "./depot-path";

export type HeadRole = "mesh" | "morph";
/** The part of DepotIndex the planner needs. */
export interface HeadDepot { lookup(hash: string): DepotLookup }

export interface HeadArchive {
  /** Archive file name, e.g. `basegame_4_appearance.archive`. */
  readonly name: string;
  readonly group: MountGroup | "directory";
  /** Installed game, or the MO2 mod / manual folder that provides the archive. */
  readonly provider: string;
  /** Physical path of the archive (private; never written to a package manifest). */
  readonly file: string;
}
export interface HeadResourceSource {
  readonly role: HeadRole;
  /** Depot path the game requests (the recipe's). */
  readonly depotPath: string;
  /** Depot path inside `archive` (differs only after an ArchiveXL copy or link). */
  readonly entryPath: string;
  readonly archive: HeadArchive;
  /** True when the provider is the base game's content or EP1 group. */
  readonly baseGame: boolean;
  /** Other mounted providers that lost, as "name (group, provider)". */
  readonly alternatives: readonly string[];
  readonly notes: readonly string[];
}
export interface HeadPatchSource {
  readonly target: HeadRole;
  readonly sourcePath: string;
  readonly entryPath: string;
  readonly archive: HeadArchive;
  readonly declaredBy: string;
  /** Declared `props` (empty: every property). */
  readonly props: readonly string[];
  readonly order: number;
  /** Plate-relevant properties this patch may change under ArchiveXL's rules. */
  readonly mayChange: readonly string[];
}
export interface IgnoredHeadPatch {
  readonly target: HeadRole; readonly sourcePath: string; readonly declaredBy: string; readonly reason: string;
}
export interface HeadSourcePlan {
  readonly mesh: HeadResourceSource | null;
  readonly morph: HeadResourceSource | null;
  /** Patches that may change the plate, in ArchiveXL application order per target. */
  readonly patches: readonly HeadPatchSource[];
  /** Patches of the head that cannot change the plate (e.g. skin appearances), recorded for provenance. */
  readonly ignoredPatches: readonly IgnoredHeadPatch[];
  /** Base-game providers of the two paths, for the documented base-game escape hatch. */
  readonly baseGame: { readonly mesh: HeadResourceSource | null; readonly morph: HeadResourceSource | null };
  /** True when a mod supplies either resource or a patch may change the plate. */
  readonly modded: boolean;
}

const BASE_GROUPS: ReadonlySet<string> = new Set(["content", "ep1"]);
/** Mesh properties ArchiveXL copies with a replaced render blob (OnMeshResourceLoad). */
export const MESH_BLOB_FIELDS = ["renderResourceBlob", "boneNames", "boneRigMatrices", "boneVertexEpsilons", "lodBoneMask",
  "lodLevelInfo", "floatTrackNames", "boundingBox", "surfaceAreaPerAxis", "objectType", "castGlobalShadowsCachedInCook",
  "castLocalShadowsCachedInCook", "useRayTracingShadowLODBias", "castsRayTracedShadowsFromOriginalGeometry", "isShadowMesh",
  "isPlayerShadowMesh", "constrainAutoHideDistanceToTerrainHeightMap"] as const;
/** Properties the plate replaces with its own values, so a patch of them cannot change the plate. */
const REPLACED_BY_PLATE: Record<HeadRole, readonly string[]> = {
  mesh: ["appearances"], morph: ["baseMesh", "baseMeshAppearance", "baseTexture"],
};

const archiveOf = (winner: DepotLookup["winner"] & object): HeadArchive =>
  ({ name: winner.name, group: winner.group, provider: winner.providerName, file: winner.id });

/** Follow ArchiveXL copies and links to the archive entry that supplies a path, as ResourceGraph.locate does. */
function locate(depot: HeadDepot, additions: DepotAdditions, paths: ReadonlyMap<string, string>, path: string) {
  let hash = depotHash(path), entryPath: string | null = path;
  const notes: string[] = [];
  for (let hop = 0; hop < 8; hop++) {
    const lookup = depot.lookup(hash);
    if (lookup.winner) return { lookup, entryPath, notes };
    const copy = additions.copies.get(hash), link = additions.links.get(hash);
    const next = copy ?? link;
    if (!next) return { lookup, entryPath, notes };
    notes.push(`ArchiveXL resource.${copy ? "copy" : "link"} of ${entryPath ?? `#${hash}`}`);
    hash = next;
    entryPath = paths.get(next) ?? null;
  }
  return { lookup: depot.lookup(hash), entryPath, notes };
}

function source(role: HeadRole, depotPath: string, found: ReturnType<typeof locate>): HeadResourceSource | null {
  const winner = found.lookup.winner;
  if (!winner || !found.entryPath) return null;
  return { role, depotPath, entryPath: found.entryPath, archive: archiveOf(winner), baseGame: BASE_GROUPS.has(winner.group),
    alternatives: found.lookup.candidates.slice(1).map(c => `${c.name} (${c.group}, ${c.providerName})`),
    notes: [...found.notes, found.lookup.rule.basis, ...found.lookup.ambiguities.map(a => `${a.code}: ${a.detail}`)] };
}

/** First base-game provider of a path, ignoring mods. */
function baseGameSource(role: HeadRole, depotPath: string, depot: HeadDepot): HeadResourceSource | null {
  const candidate = depot.lookup(depotHash(depotPath)).candidates.find(c => BASE_GROUPS.has(c.group));
  return candidate ? { role, depotPath, entryPath: depotPath, archive: archiveOf(candidate), baseGame: true, alternatives: [],
    notes: ["Base-game provider chosen by the XFS_EYE_PLATE_HEAD=base-game escape hatch."] } : null;
}

/**
 * Plate-relevant properties a patch may change. `renderResourceBlob` and the morph `blob` are overwrites
 * (the head always has one), so ArchiveXL applies them only when named explicitly.
 */
export function plateRelevantProps(role: HeadRole, patch: Pick<XlPatch, "props">): string[] {
  const asPatch = patch as XlPatch;
  if (role === "mesh") return patchModifies(asPatch, "renderResourceBlob", true) ? ["renderResourceBlob"] : [];
  return [
    ...(patchModifies(asPatch, "blob", true) ? ["blob"] : []),
    ...(patchModifies(asPatch, "boundingBox") ? ["boundingBox"] : []),
    ...(patchModifies(asPatch, "targets") ? ["targets"] : []),
    ...(patchModifies(asPatch, "baseTextureParamName", false) ? ["baseTextureParamName"] : []),
  ];
}

/** Resolve the head mesh and morph target for the route, and every `.xl` patch that may change the plate. */
export function planHeadSource(paths: { meshDepotPath: string; morphDepotPath: string }, depot: HeadDepot,
  additions: DepotAdditions, knownPaths: ReadonlyMap<string, string> = new Map()): HeadSourcePlan {
  const roles = [["mesh", paths.meshDepotPath], ["morph", paths.morphDepotPath]] as const;
  const resolved = Object.fromEntries(roles.map(([role, path]) =>
    [role, source(role, path, locate(depot, additions, knownPaths, path))])) as Record<HeadRole, HeadResourceSource | null>;
  const patches: HeadPatchSource[] = [], ignoredPatches: IgnoredHeadPatch[] = [];
  for (const [role, path] of roles) {
    const hash = depotHash(path);
    // ResourcePatch: a patch source is never itself patched.
    if (additions.patchSources.has(hash)) continue;
    for (const patch of additions.patchesByTarget.get(hash) ?? []) {
      const mayChange = plateRelevantProps(role, patch);
      if (!mayChange.length) {
        const replaced = [...patch.props].filter(prop => REPLACED_BY_PLATE[role].includes(prop));
        ignoredPatches.push({ target: role, sourcePath: patch.sourcePath, declaredBy: patch.declaredBy,
          reason: patch.props.size === 0 || replaced.length
            ? `changes only properties the plate replaces (${REPLACED_BY_PLATE[role].join(", ")}) or overwrites it does not name`
            : `changes only ${[...patch.props].join(", ")}` });
        continue;
      }
      const found = locate(depot, additions, knownPaths, patch.sourcePath);
      if (!found.lookup.winner || !found.entryPath) {
        ignoredPatches.push({ target: role, sourcePath: patch.sourcePath, declaredBy: patch.declaredBy,
          reason: "its patch resource is not provided by any mounted archive" });
        continue;
      }
      patches.push({ target: role, sourcePath: patch.sourcePath, entryPath: found.entryPath, archive: archiveOf(found.lookup.winner),
        declaredBy: patch.declaredBy, props: [...patch.props], order: patch.order, mayChange });
    }
  }
  const modded = !!resolved.mesh && !!resolved.morph && (!resolved.mesh.baseGame || !resolved.morph.baseGame || patches.length > 0);
  return { mesh: resolved.mesh, morph: resolved.morph, patches, ignoredPatches, modded,
    baseGame: { mesh: baseGameSource("mesh", paths.meshDepotPath, depot), morph: baseGameSource("morph", paths.morphDepotPath, depot) } };
}

/** Asset-free record (plate and package manifests) of the head resources a plate was cut from. No physical paths. */
export type EyePlateHeadRecord = {
  kind: "base-game" | "installed-mods" | "base-game-override";
  resources: { role: HeadRole; depotPath: string; entryPath: string; archive: string; group: string; provider: string;
    resourceSha256: string; archiveSha256: string | null }[];
  patches: { target: HeadRole; source: string; declaredBy: string; changed: string[]; archive: string; provider: string;
    resourceSha256: string; archiveSha256: string | null }[];
  ignoredPatches: { target: HeadRole; source: string; declaredBy: string; reason: string }[];
};

// ---- Applying patches to the extracted JSON documents (WolvenKit CR2W JSON) ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;
export interface AppliedHeadPatch { readonly target: HeadRole; readonly sourcePath: string; readonly declaredBy: string; readonly changed: string[] }

const present = (value: unknown) => value !== null && value !== undefined;
const handleData = (value: Doc) => value && typeof value === "object" && "Data" in value ? value.Data : value;
const cname = (value: Doc): string => typeof value === "string" ? value : String(value?.$value ?? "");

/**
 * Apply the plate-relevant part of each patch to a head document, in order, as ArchiveXL does at load time.
 * Returns a new document; the inputs are not modified.
 */
export function applyHeadPatches(role: HeadRole, head: Doc, patches: readonly { patch: HeadPatchSource; document: Doc }[]):
  { document: Doc; applied: AppliedHeadPatch[] } {
  const document = structuredClone(head), root = document.Data.RootChunk;
  const applied: AppliedHeadPatch[] = [];
  for (const { patch, document: patchDocument } of patches) {
    if (patch.target !== role) continue;
    const source = patchDocument?.Data?.RootChunk;
    if (!source) throw Error(`Patch resource ${patch.sourcePath} could not be read.`);
    const xl = { props: new Set(patch.props) } as unknown as XlPatch;
    const changed: string[] = [];
    if (role === "mesh") {
      if (present(handleData(source.renderResourceBlob)) && patchModifies(xl, "renderResourceBlob", present(handleData(root.renderResourceBlob)))) {
        for (const field of MESH_BLOB_FIELDS) if (field in source) root[field] = structuredClone(source[field]);
        changed.push("renderResourceBlob");
      }
    } else {
      if (present(handleData(source.blob)) && patchModifies(xl, "blob", present(handleData(root.blob)))) {
        root.blob = structuredClone(source.blob); changed.push("blob");
      }
      const box = source.boundingBox;
      if (box && Number(box.Max?.X) > Number(box.Min?.X) && patchModifies(xl, "boundingBox")) {
        root.boundingBox = structuredClone(box); changed.push("boundingBox");
      }
      if (patchModifies(xl, "baseTextureParamName", !cname(source.baseTextureParamName) || cname(source.baseTextureParamName) === "None")) {
        root.baseTextureParamName = structuredClone(source.baseTextureParamName); changed.push("baseTextureParamName");
      }
      if (patchModifies(xl, "targets") && Array.isArray(source.targets) && source.targets.length) {
        const targets: Doc[] = Array.isArray(root.targets) ? root.targets : (root.targets = []);
        for (const target of source.targets) {
          const index = targets.findIndex(existing => cname(existing.name) === cname(target.name));
          if (index >= 0) targets[index] = structuredClone(target); else targets.push(structuredClone(target));
        }
        changed.push("targets");
      }
    }
    if (changed.length) applied.push({ target: role, sourcePath: patch.sourcePath, declaredBy: patch.declaredBy, changed });
  }
  return { document, applied };
}
