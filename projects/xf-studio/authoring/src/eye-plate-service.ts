import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { contentFingerprint, EyePlateCache, fileSha256 } from "./eye-plate-cache";
import { derivePlateDocuments } from "./eye-plate-cut";
import {
  applyHeadPatches, type AppliedHeadPatch, type EyePlateHeadRecord, type HeadArchive, type HeadPatchSource, type HeadResourceSource,
  type HeadRole, type HeadSourcePlan,
} from "./eye-plate-head-source";
import {
  EYE_PLATE_DERIVER_VERSION, EYE_PLATE_RECIPE, eyePlateCacheKey, eyePlateCacheName, eyePlateRecipeSha256,
  supportedEyePlateSource, type EyePlateRecipe, type EyePlateSourceRevision,
} from "./eye-plate-recipe";
import { verifyEyePlate, type EyePlateVerification } from "./eye-plate-verify";
import { EYE_MAKEUP_MOD } from "./mod-branding";
import type { PackagePlate } from "./package-action";

/**
 * Application service: make the built-in expanded eye plate available to Build.
 * It owns the head-source policy, the source gate, cache policy, verification and cancellation;
 * the injected ports own WolvenKit process execution (tools) and route resolution (headSource),
 * and the cache adapter owns file mechanics.
 *
 * Head-source policy: the plate is cut from the head the game is expected to load for the selected
 * launch route, as the generic resolver decides it (archive precedence plus `.xl` patches):
 * - the base game wins and nothing patches plate data: the audited revision gate applies;
 * - a mod supplies the head mesh or morph target, or an `.xl` patch changes plate data: the plate is
 *   cut from those resources when the recipe's topology gates hold (same selected triangles, order and
 *   vertex mapping; same morph target count; mesh and morph base agree), with provenance in the plate
 *   manifest. Otherwise Build stops with a plain message naming the mod and the documented escape
 *   hatch (`headOverride: "base-game"`, which hosts set from XFS_EYE_PLATE_HEAD=base-game).
 */
export interface EyePlateTools {
  /** Extract `depotPaths` from one archive file (or a directory of archives) into `outDir`, keeping depot-relative paths. */
  extract(input: { archive: string; depotPaths: string[]; outDir: string; signal?: AbortSignal }): Promise<void>;
  /** Serialize one CR2W resource to `<outDir>/<name>.json` and return that path. */
  serialize(input: { file: string; outDir: string; signal?: AbortSignal }): Promise<string>;
  /** Convert every JSON document in `jsonDir` to CR2W resources in `outDir`. */
  deserialize(input: { jsonDir: string; outDir: string; names: string[]; signal?: AbortSignal }): Promise<void>;
}

/** Port: which head resources and patches the selected launch route is expected to load. */
export interface EyePlateHeadSourcePort {
  resolve(input: { meshDepotPath: string; morphDepotPath: string; signal?: AbortSignal }): Promise<EyePlateHeadResolution>;
}
export type EyePlateHeadResolution = { plan: HeadSourcePlan; notes: string[] };
export type { EyePlateHeadRecord } from "./eye-plate-head-source";

export type EyePlateErrorCode = "plate_source_missing" | "plate_source_unsupported" | "plate_source_modded" | "plate_tool_failed" |
  "plate_verification_failed" | "plate_cancelled" | "plate_cache_unavailable";
export class EyePlateError extends Error {
  constructor(readonly code: EyePlateErrorCode, message: string, readonly detail = "") { super(message); }
}

export const EYE_PLATE_MANIFEST_SCHEMA = "xfs/eye-plate-cache-1" as const;
export type EyePlateManifest = {
  schema: typeof EYE_PLATE_MANIFEST_SCHEMA;
  recipeId: string; recipeRevision: number; recipeSha256: string; deriverVersion: number; cacheKey: string;
  source: { revisionId: string; label: string; meshDepotPath: string; morphDepotPath: string; meshSha256: string; morphSha256: string };
  /** Which head resources were cut. Entries written before head-source resolution lack it and are rebuilt. */
  head?: EyePlateHeadRecord;
  files: { mesh: { name: string; sha256: string; bytes: number }; morph: { name: string; sha256: string; bytes: number } };
  verification: EyePlateVerification;
  limits: string[];
};
export type EyePlateResult = { directory: string; meshFile: string; morphFile: string; manifestFile: string; manifest: EyePlateManifest; reused: boolean };
export type EnsureEyePlateOptions = { gameRoot: string; cacheRoot: string; tools: EyePlateTools; recipe?: EyePlateRecipe;
  /** Route resolution; without it the plate is cut from the base game's content archives. */
  headSource?: EyePlateHeadSourcePort;
  /** Escape hatch: cut from the base-game head even when an installed mod changes it. */
  headOverride?: "base-game";
  signal?: AbortSignal; progress?: (message: string) => void };

/** The package manifest's record of a derived plate; hosts and the builder compare exactly this value. */
export function packagePlateRecord(manifest: EyePlateManifest): PackagePlate {
  return { source: "derived", recipeId: manifest.recipeId, recipeRevision: manifest.recipeRevision,
    sourceRevision: manifest.source.revisionId, cacheKey: manifest.cacheKey,
    meshSha256: manifest.files.mesh.sha256, morphSha256: manifest.files.morph.sha256,
    ...(manifest.head ? { head: manifest.head } : {}) };
}

export const EYE_PLATE_RESOURCE_DIRECTORY = "resources";
export const EYE_PLATE_MANIFEST_FILE = "plate-manifest.json";
/** Environment value hosts read for the escape hatch. */
export const EYE_PLATE_HEAD_OVERRIDE_ENV = "XFS_EYE_PLATE_HEAD";
export const eyePlateHeadOverride = (env: Record<string, string | undefined>): "base-game" | undefined =>
  env[EYE_PLATE_HEAD_OVERRIDE_ENV]?.trim().toLowerCase() === "base-game" ? "base-game" : undefined;

const LIMITS = [
  "Offline verification proves the plate's bytes equal the installed head's selected rows; it does not prove game rendering.",
  "The neutral cut coincides with the head surface and has no designed clearance.",
];
const OVERRIDE_LIMIT = "An installed mod changes the head, but XFS_EYE_PLATE_HEAD=base-game cut the plate from the unmodified game head; the makeup may not sit exactly on the head the game shows.";
const MODDED_LIMIT = "The plate was cut from the head as changed by installed mods (see head provenance); which archive and patches the game really loads is a tool-source expectation, not runtime evidence.";

const readDocument = (cache: EyePlateCache, path: string) => cache.readJson(path) as any;
const placeholderMeshPath = (recipe: EyePlateRecipe) => `xfs\\eye_plate\\${recipe.output.stem}.mesh`;
const depotFile = (root: string, depotPath: string) => join(root, ...depotPath.split("\\"));

function unsupportedMessage(recipe: EyePlateRecipe): string {
  const labels = recipe.source.supported.map(item => item.label).join(", ");
  return `Your installed Cyberpunk 2077 has a different female player head from the one XF Studio's built-in eye plate was checked against (${labels}). ` +
    "This usually means a newer game patch. Update XF Studio to a version that supports your game, then build again. Nothing was changed.";
}
const MISSING_MESSAGE = "Build could not find the female player head in your Cyberpunk 2077 content archives. " +
  "Check that the Cyberpunk 2077 folder in Local setup is correct, or verify the game files in your launcher, then build again.";
function moddedMessage(providers: string[]): string {
  const names = providers.length ? providers.join(", ") : "an installed mod";
  return `Your installed head mod ${names} changes the head's shape data in a way ${EYE_MAKEUP_MOD.modName} doesn't support yet, so nothing was built. ` +
    "To build anyway, disable that mod in the profile chosen in Local setup, or start XF Studio with the setting " +
    `${EYE_PLATE_HEAD_OVERRIDE_ENV}=base-game to use the unmodified game head (the makeup may then not sit exactly on your modded head).`;
}

/** Validate a cached entry against its manifest and the expected cache identity. */
function loadCached(cache: EyePlateCache, directory: string, key: string, recipe: EyePlateRecipe): EyePlateResult | null {
  const manifestFile = join(directory, EYE_PLATE_MANIFEST_FILE);
  if (!existsSync(manifestFile)) return null;
  try {
    const manifest = cache.readJson(manifestFile) as EyePlateManifest;
    if (manifest.schema !== EYE_PLATE_MANIFEST_SCHEMA || manifest.cacheKey !== key || manifest.recipeId !== recipe.id ||
        manifest.recipeRevision !== recipe.revision || !manifest.head) return null;
    const resources = join(directory, EYE_PLATE_RESOURCE_DIRECTORY);
    const meshFile = join(resources, manifest.files.mesh.name), morphFile = join(resources, manifest.files.morph.name);
    for (const [file, entry] of [[meshFile, manifest.files.mesh], [morphFile, manifest.files.morph]] as const)
      if (!existsSync(file) || statSync(file).size !== entry.bytes || fileSha256(file) !== entry.sha256) return null;
    return { directory: resources, meshFile, morphFile, manifestFile, manifest, reused: true };
  } catch { return null; }
}

/** Without a route resolver: the base game's content archives, as a directory. */
function contentPlan(recipe: EyePlateRecipe, gameRoot: string): HeadSourcePlan {
  const archive: HeadArchive = { name: recipe.source.archiveDirectory, group: "directory", provider: "Installed game",
    file: resolve(gameRoot, recipe.source.archiveDirectory) };
  const entry = (role: HeadRole, depotPath: string): HeadResourceSource =>
    ({ role, depotPath, entryPath: depotPath, archive, baseGame: true, alternatives: [], notes: [] });
  const mesh = entry("mesh", recipe.source.meshDepotPath), morph = entry("morph", recipe.source.morphDepotPath);
  return { mesh, morph, patches: [], ignoredPatches: [], baseGame: { mesh, morph }, modded: false };
}

export async function ensureEyePlate(options: EnsureEyePlateOptions): Promise<EyePlateResult> {
  const recipe = options.recipe ?? EYE_PLATE_RECIPE;
  const { tools, signal, gameRoot } = options;
  const progress = options.progress ?? (() => {});
  let cache: EyePlateCache, work: string;
  try { cache = new EyePlateCache(options.cacheRoot); work = cache.createWork(); }
  catch (error) { throw new EyePlateError("plate_cache_unavailable", "XF Studio could not open its private eye plate cache.", (error as Error).message); }
  const fingerprint = contentFingerprint(gameRoot, recipe.source.archiveDirectory);
  const status = (state: "ready" | "missing" | "unsupported" | "failed", code: string | null, message: string, cacheName: string | null = null) => {
    try { cache.writeStatus({ recipeId: recipe.id, recipeRevision: recipe.revision, state, code, message, gameRoot, contentFingerprint: fingerprint, cacheName }); }
    catch { /* Status is advisory; the Build result carries the real outcome. */ }
  };
  const cancelled = () => { if (signal?.aborted) throw new EyePlateError("plate_cancelled", "Eye plate preparation was cancelled."); };
  const missing = () => { status("missing", "plate_source_missing", MISSING_MESSAGE); return new EyePlateError("plate_source_missing", MISSING_MESSAGE); };
  const unsupported = (hashes: { meshSha256: string; morphSha256: string }) => {
    const message = unsupportedMessage(recipe);
    status("unsupported", "plate_source_unsupported", message);
    return new EyePlateError("plate_source_unsupported", message, `mesh ${hashes.meshSha256}, morph ${hashes.morphSha256}`);
  };
  try {
    // 1. Which head the route loads: winning archives and the `.xl` patches that may change plate data.
    progress("Finding the female player head your game loads");
    const resolution = options.headSource
      ? await options.headSource.resolve({ meshDepotPath: recipe.source.meshDepotPath, morphDepotPath: recipe.source.morphDepotPath, signal })
      : { plan: contentPlan(recipe, gameRoot), notes: [] };
    cancelled();
    for (const note of resolution.notes) progress(note);
    const { plan } = resolution;
    if (!plan.mesh || !plan.morph) throw missing();
    const override = plan.modded && options.headOverride === "base-game";
    const mesh = override ? plan.baseGame.mesh : plan.mesh, morph = override ? plan.baseGame.morph : plan.morph;
    if (!mesh || !morph) throw missing();
    const patches = override ? [] : plan.patches;

    // 2. Extract the chosen resources and patch sources, one WolvenKit call per archive.
    progress("Reading the female player head from your game files");
    const wanted: { archive: HeadArchive; entryPath: string }[] = [mesh, morph, ...patches];
    const byArchive = new Map<string, { archive: HeadArchive; paths: Set<string>; dir: string }>();
    for (const item of wanted) {
      const group = byArchive.get(item.archive.file) ??
        { archive: item.archive, paths: new Set<string>(), dir: join(work, "source", String(byArchive.size)) };
      group.paths.add(item.entryPath);
      byArchive.set(item.archive.file, group);
    }
    for (const group of byArchive.values()) {
      mkdirSync(group.dir, { recursive: true });
      await tools.extract({ archive: group.archive.file, depotPaths: [...group.paths], outDir: group.dir, signal });
      cancelled();
    }
    const fileOf = (item: { archive: HeadArchive; entryPath: string }) => depotFile(byArchive.get(item.archive.file)!.dir, item.entryPath);
    const meshSource = fileOf(mesh), morphSource = fileOf(morph);
    if (!existsSync(meshSource) || !existsSync(morphSource)) throw missing();
    for (const patch of patches) if (!existsSync(fileOf(patch)))
      throw new EyePlateError("plate_tool_failed", "WolvenKit could not read a head patch resource.", patch.sourcePath);
    const hashes = { meshSha256: fileSha256(meshSource), morphSha256: fileSha256(morphSource) };
    const archiveHashes = new Map<string, string | null>();
    const archiveHash = (archive: HeadArchive) => {
      if (archive.group === "content" || archive.group === "ep1" || archive.group === "directory") return null;
      if (!archiveHashes.has(archive.file)) archiveHashes.set(archive.file, fileSha256(archive.file));
      return archiveHashes.get(archive.file)!;
    };
    cancelled();

    // 3. Serialize, apply the patches as ArchiveXL does, and decide which kind of source this is.
    const sourceJson = join(work, "source-json");
    mkdirSync(sourceJson);
    const serialize = async (file: string, index: number) => {
      const dir = join(sourceJson, String(index));
      mkdirSync(dir);
      return readDocument(cache, await tools.serialize({ file, outDir: dir, signal }));
    };
    // Serializing the head costs seconds, so an unpatched head is read only on a cache miss.
    let head: { mesh: any; morph: any } | null = null;
    const readHead = async () => head ??= { mesh: await serialize(meshSource, 0), morph: await serialize(morphSource, 1) };
    const patchDocuments: { patch: HeadPatchSource; document: unknown }[] = [];
    let patchedMesh = { applied: [] as AppliedHeadPatch[], document: null as any }, patchedMorph = { ...patchedMesh };
    if (patches.length) {
      const { mesh: rawMesh, morph: rawMorph } = await readHead();
      for (const [index, patch] of patches.entries()) patchDocuments.push({ patch, document: await serialize(fileOf(patch), index + 2) });
      cancelled();
      patchedMesh = applyHeadPatches("mesh", rawMesh, patchDocuments);
      patchedMorph = applyHeadPatches("morph", rawMorph, patchDocuments);
    }
    const applied: AppliedHeadPatch[] = [...patchedMesh.applied, ...patchedMorph.applied];
    const patchOf = (item: { target: HeadRole; sourcePath: string }) =>
      patches.find(candidate => candidate.sourcePath === item.sourcePath && candidate.target === item.target)!;
    const kind: EyePlateHeadRecord["kind"] = override ? "base-game-override"
      : !mesh.baseGame || !morph.baseGame || applied.length ? "installed-mods" : "base-game";
    const modProviders = [...new Set([...[mesh, morph].filter(item => !item.baseGame).map(item => item.archive.provider),
      ...applied.map(item => patchOf(item).archive.provider)])];

    // 4. Revision gate: base-game resources used without a patch must be an audited revision.
    let revision: EyePlateSourceRevision | null;
    if (kind === "installed-mods") {
      const supported = recipe.source.supported;
      const meshOk = !mesh.baseGame || patchedMesh.applied.length > 0 || supported.some(item => item.meshSha256 === hashes.meshSha256);
      const morphOk = !morph.baseGame || patchedMorph.applied.length > 0 || supported.some(item => item.morphSha256 === hashes.morphSha256);
      if (!meshOk || !morphOk) throw unsupported(hashes);
      revision = { id: "installed-mods", label: `Installed head changed by ${modProviders.join(", ")}`, ...hashes };
    } else {
      revision = supportedEyePlateSource(recipe, hashes);
      if (!revision) throw unsupported(hashes);
    }
    const provenance: EyePlateHeadRecord = {
      kind,
      resources: ([[mesh, hashes.meshSha256], [morph, hashes.morphSha256]] as const).map(([source, sha]) => ({
        role: source.role, depotPath: source.depotPath, entryPath: source.entryPath, archive: source.archive.name,
        group: source.archive.group, provider: source.archive.provider, resourceSha256: sha, archiveSha256: archiveHash(source.archive) })),
      patches: applied.map(item => {
        const patch = patchOf(item);
        return { target: item.target, source: item.sourcePath, declaredBy: item.declaredBy, changed: item.changed,
          archive: patch.archive.name, provider: patch.archive.provider, resourceSha256: fileSha256(fileOf(patch)),
          archiveSha256: archiveHash(patch.archive) };
      }),
      ignoredPatches: [
        ...plan.ignoredPatches.map(item => ({ target: item.target, source: item.sourcePath, declaredBy: item.declaredBy, reason: item.reason })),
        ...(override ? plan.patches.map(item => ({ target: item.target, source: item.sourcePath, declaredBy: item.declaredBy,
          reason: `not applied: ${EYE_PLATE_HEAD_OVERRIDE_ENV}=base-game` })) : []),
        ...patches.filter(patch => !applied.some(item => item.sourcePath === patch.sourcePath && item.target === patch.target))
          .map(item => ({ target: item.target, source: item.sourcePath, declaredBy: item.declaredBy, reason: "changes no plate data" })),
      ],
    };
    const key = eyePlateCacheKey(recipe, hashes, provenance);
    const name = eyePlateCacheName(recipe, key);
    const cached = loadCached(cache, cache.entry(name), key, recipe);
    if (cached) { status("ready", null, "The built-in eye plate is ready.", name); return cached; }

    // 5. Cut, convert and verify against the head actually used.
    progress("Cutting the expanded eye plate from the head");
    const raw = await readHead();
    cancelled();
    const headMesh = patchedMesh.document ?? raw.mesh, headMorph = patchedMorph.document ?? raw.morph;
    const unsupportedHead = (detail: string) => {
      const message = moddedMessage(modProviders);
      status("failed", "plate_source_modded", message);
      return new EyePlateError("plate_source_modded", message, detail);
    };
    let documents;
    try { documents = derivePlateDocuments(headMesh, headMorph, recipe, placeholderMeshPath(recipe)); }
    catch (error) {
      if (kind === "installed-mods") throw unsupportedHead((error as Error).message);
      status("failed", "plate_verification_failed", "The installed head does not match the audited plate selection.");
      throw new EyePlateError("plate_verification_failed", "The installed head does not match the audited plate selection.", (error as Error).message);
    }
    const meshName = `${recipe.output.stem}.mesh`, morphName = `${recipe.output.stem}.morphtarget`;
    const plateJson = join(work, "plate-json");
    mkdirSync(plateJson);
    cache.writeJson(join(plateJson, `${meshName}.json`), documents.mesh);
    cache.writeJson(join(plateJson, `${morphName}.json`), documents.morph);
    const staging = join(work, "entry");
    const resources = join(staging, EYE_PLATE_RESOURCE_DIRECTORY);
    mkdirSync(resources, { recursive: true });
    await tools.deserialize({ jsonDir: plateJson, outDir: resources, names: [meshName, morphName], signal });
    cancelled();

    progress("Verifying the eye plate against the installed head");
    const readback = join(work, "readback-json");
    mkdirSync(readback);
    const meshReadback = await tools.serialize({ file: join(resources, meshName), outDir: readback, signal });
    const morphReadback = await tools.serialize({ file: join(resources, morphName), outDir: readback, signal });
    cancelled();
    let verification: EyePlateVerification;
    try { verification = verifyEyePlate(recipe, headMesh, headMorph, readDocument(cache, meshReadback), readDocument(cache, morphReadback)); }
    catch (error) {
      if (kind === "installed-mods") throw unsupportedHead((error as Error).message);
      status("failed", "plate_verification_failed", "The derived eye plate failed verification.");
      throw new EyePlateError("plate_verification_failed", "The derived eye plate failed verification, so Build stopped.", (error as Error).message);
    }
    const file = (path: string) => ({ name: basename(path), sha256: fileSha256(path), bytes: statSync(path).size });
    const manifest: EyePlateManifest = {
      schema: EYE_PLATE_MANIFEST_SCHEMA, recipeId: recipe.id, recipeRevision: recipe.revision,
      recipeSha256: eyePlateRecipeSha256(recipe), deriverVersion: EYE_PLATE_DERIVER_VERSION, cacheKey: key,
      source: { revisionId: revision.id, label: revision.label, meshDepotPath: recipe.source.meshDepotPath,
        morphDepotPath: recipe.source.morphDepotPath, ...hashes },
      head: provenance,
      files: { mesh: file(join(resources, meshName)), morph: file(join(resources, morphName)) },
      verification,
      limits: [...LIMITS, ...(kind === "installed-mods" ? [MODDED_LIMIT] : kind === "base-game-override" ? [OVERRIDE_LIMIT] : [])],
    };
    cache.writeJson(join(staging, EYE_PLATE_MANIFEST_FILE), manifest);
    const directory = cache.publish(staging, name);
    status("ready", null, "The built-in eye plate is ready.", name);
    const published = loadCached(cache, directory, key, recipe);
    if (!published) throw new EyePlateError("plate_cache_unavailable", "The eye plate cache changed while it was being written.");
    return { ...published, reused: false };
  } catch (error) {
    if (error instanceof EyePlateError) throw error;
    const code = (error as { code?: string }).code;
    if (code === "plate_cancelled" || signal?.aborted) throw new EyePlateError("plate_cancelled", "Eye plate preparation was cancelled.");
    status("failed", "plate_tool_failed", "WolvenKit could not prepare the eye plate.");
    throw new EyePlateError("plate_tool_failed", "WolvenKit could not prepare the built-in eye plate. Check the WolvenKit CLI in Local setup.",
      `${(error as Error).message}\n${(error as { output?: string }).output ?? ""}`);
  } finally {
    try { cache.remove(work); } catch { /* Best-effort cleanup of private intermediates. */ }
  }
}
