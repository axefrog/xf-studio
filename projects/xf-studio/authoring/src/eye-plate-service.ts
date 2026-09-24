import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { contentFingerprint, EyePlateCache, fileSha256 } from "./eye-plate-cache";
import { derivePlateDocuments } from "./eye-plate-cut";
import {
  EYE_PLATE_DERIVER_VERSION, EYE_PLATE_RECIPE, eyePlateCacheKey, eyePlateCacheName, eyePlateRecipeSha256,
  supportedEyePlateSource, type EyePlateRecipe,
} from "./eye-plate-recipe";
import { verifyEyePlate, type EyePlateVerification } from "./eye-plate-verify";

/**
 * Application service: make the built-in expanded eye plate available to Build.
 * It owns the source gate, cache policy, verification and cancellation; the injected
 * tool port owns WolvenKit process execution and the cache adapter owns file mechanics.
 */
export interface EyePlateTools {
  /** Extract `depotPaths` from the game's content archives into `outDir`, keeping depot-relative paths. */
  extract(input: { gameRoot: string; archiveDirectory: string; depotPaths: string[]; outDir: string; signal?: AbortSignal }): Promise<void>;
  /** Serialize one CR2W resource to `<outDir>/<name>.json` and return that path. */
  serialize(input: { file: string; outDir: string; signal?: AbortSignal }): Promise<string>;
  /** Convert every JSON document in `jsonDir` to CR2W resources in `outDir`. */
  deserialize(input: { jsonDir: string; outDir: string; names: string[]; signal?: AbortSignal }): Promise<void>;
}

export type EyePlateErrorCode = "plate_source_missing" | "plate_source_unsupported" | "plate_tool_failed" |
  "plate_verification_failed" | "plate_cancelled" | "plate_cache_unavailable";
export class EyePlateError extends Error {
  constructor(readonly code: EyePlateErrorCode, message: string, readonly detail = "") { super(message); }
}

export const EYE_PLATE_MANIFEST_SCHEMA = "xfs/eye-plate-cache-1" as const;
export type EyePlateManifest = {
  schema: typeof EYE_PLATE_MANIFEST_SCHEMA;
  recipeId: string; recipeRevision: number; recipeSha256: string; deriverVersion: number; cacheKey: string;
  source: { revisionId: string; label: string; meshDepotPath: string; morphDepotPath: string; meshSha256: string; morphSha256: string };
  files: { mesh: { name: string; sha256: string; bytes: number }; morph: { name: string; sha256: string; bytes: number } };
  verification: EyePlateVerification;
  limits: string[];
};
export type EyePlateResult = { directory: string; meshFile: string; morphFile: string; manifestFile: string; manifest: EyePlateManifest; reused: boolean };
export type EnsureEyePlateOptions = { gameRoot: string; cacheRoot: string; tools: EyePlateTools; recipe?: EyePlateRecipe;
  signal?: AbortSignal; progress?: (message: string) => void };

export const EYE_PLATE_RESOURCE_DIRECTORY = "resources";
export const EYE_PLATE_MANIFEST_FILE = "plate-manifest.json";
const LIMITS = [
  "Offline verification proves the plate's bytes equal the installed head's selected rows; it does not prove game rendering.",
  "The neutral cut coincides with the head surface and has no designed clearance.",
];

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

/** Validate a cached entry against its manifest and the expected cache identity. */
function loadCached(cache: EyePlateCache, directory: string, key: string, recipe: EyePlateRecipe): EyePlateResult | null {
  const manifestFile = join(directory, EYE_PLATE_MANIFEST_FILE);
  if (!existsSync(manifestFile)) return null;
  try {
    const manifest = cache.readJson(manifestFile) as EyePlateManifest;
    if (manifest.schema !== EYE_PLATE_MANIFEST_SCHEMA || manifest.cacheKey !== key || manifest.recipeId !== recipe.id ||
        manifest.recipeRevision !== recipe.revision) return null;
    const resources = join(directory, EYE_PLATE_RESOURCE_DIRECTORY);
    const meshFile = join(resources, manifest.files.mesh.name), morphFile = join(resources, manifest.files.morph.name);
    for (const [file, entry] of [[meshFile, manifest.files.mesh], [morphFile, manifest.files.morph]] as const)
      if (!existsSync(file) || statSync(file).size !== entry.bytes || fileSha256(file) !== entry.sha256) return null;
    return { directory: resources, meshFile, morphFile, manifestFile, manifest, reused: true };
  } catch { return null; }
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
  try {
    progress("Reading the female player head from your game files");
    const extracted = join(work, "source");
    mkdirSync(extracted);
    await tools.extract({ gameRoot, archiveDirectory: recipe.source.archiveDirectory, outDir: extracted, signal,
      depotPaths: [recipe.source.meshDepotPath, recipe.source.morphDepotPath] });
    cancelled();
    const meshSource = depotFile(extracted, recipe.source.meshDepotPath);
    const morphSource = depotFile(extracted, recipe.source.morphDepotPath);
    if (!existsSync(meshSource) || !existsSync(morphSource)) {
      status("missing", "plate_source_missing", MISSING_MESSAGE);
      throw new EyePlateError("plate_source_missing", MISSING_MESSAGE);
    }
    const hashes = { meshSha256: fileSha256(meshSource), morphSha256: fileSha256(morphSource) };
    const revision = supportedEyePlateSource(recipe, hashes);
    if (!revision) {
      const message = unsupportedMessage(recipe);
      status("unsupported", "plate_source_unsupported", message);
      throw new EyePlateError("plate_source_unsupported", message, `mesh ${hashes.meshSha256}, morph ${hashes.morphSha256}`);
    }
    const key = eyePlateCacheKey(recipe, hashes);
    const name = eyePlateCacheName(recipe, key);
    const cached = loadCached(cache, cache.entry(name), key, recipe);
    if (cached) { status("ready", null, "The built-in eye plate is ready.", name); return cached; }

    progress("Cutting the expanded eye plate from the head");
    const sourceJson = join(work, "source-json");
    mkdirSync(sourceJson);
    const headMeshJson = await tools.serialize({ file: meshSource, outDir: sourceJson, signal });
    const headMorphJson = await tools.serialize({ file: morphSource, outDir: sourceJson, signal });
    cancelled();
    const headMesh = readDocument(cache, headMeshJson), headMorph = readDocument(cache, headMorphJson);
    let documents;
    try { documents = derivePlateDocuments(headMesh, headMorph, recipe, placeholderMeshPath(recipe)); }
    catch (error) {
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
      status("failed", "plate_verification_failed", "The derived eye plate failed verification.");
      throw new EyePlateError("plate_verification_failed", "The derived eye plate failed verification, so Build stopped.", (error as Error).message);
    }
    const file = (path: string) => ({ name: basename(path), sha256: fileSha256(path), bytes: statSync(path).size });
    const manifest: EyePlateManifest = {
      schema: EYE_PLATE_MANIFEST_SCHEMA, recipeId: recipe.id, recipeRevision: recipe.revision,
      recipeSha256: eyePlateRecipeSha256(recipe), deriverVersion: EYE_PLATE_DERIVER_VERSION, cacheKey: key,
      source: { revisionId: revision.id, label: revision.label, meshDepotPath: recipe.source.meshDepotPath,
        morphDepotPath: recipe.source.morphDepotPath, ...hashes },
      files: { mesh: file(join(resources, meshName)), morph: file(join(resources, morphName)) },
      verification, limits: LIMITS,
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
