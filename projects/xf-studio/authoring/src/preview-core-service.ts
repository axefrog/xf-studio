import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentFingerprint, DerivedCache, fileSha256, samePath } from "./derived-cache";
import { EYE_PLATE_RECIPE, sha256Hex, supportedEyePlateSource, type EyePlateRecipe } from "./eye-plate-recipe";
import { decodePng, encodePng } from "./png";
import { adaptMap, checkMap } from "./preview-core-maps";
import { decodedTexturePath, parseMaterialExport, resolveTextureParameter } from "./preview-core-materials";
import { assemblePreviewGlb, verifyPreviewGlb, type PreviewGlbReport } from "./preview-core-assemble";
import {
  PREVIEW_CORE_DERIVER_VERSION, PREVIEW_CORE_FILES, PREVIEW_CORE_RECIPE, previewCoreCacheKey, previewCoreCacheName,
  previewCoreRecipeSha256, type MapAdapter, type PreviewCoreRecipe,
} from "./preview-core-recipe";

/**
 * Application service: derive the 3D preview core (head, eye plate, eyes and maps) from the
 * player's own Cyberpunk 2077 installation. It owns the source gate, cache policy,
 * verification, progress and cancellation; the injected tool port owns WolvenKit process
 * execution and the cache adapter owns file mechanics.
 */
export interface PreviewCoreTools {
  /**
   * Uncook `depotPaths` from the game's archives into `outDir`, keeping depot-relative paths:
   * the raw resources, mesh and morph-target GLBs (with skin and morph targets), each mesh's
   * resolved `<name>.Material.json` and every texture those materials use, decoded to PNG.
   */
  uncook(input: { gameRoot: string; archiveDirectory: string; depotPaths: string[]; outDir: string; signal?: AbortSignal }): Promise<void>;
}

export type PreviewCoreErrorCode = "preview_source_missing" | "preview_source_unsupported" | "preview_tool_missing" | "preview_tool_failed" |
  "preview_verification_failed" | "preview_cancelled" | "preview_cache_unavailable";
export class PreviewCoreError extends Error {
  constructor(readonly code: PreviewCoreErrorCode, message: string, readonly detail = "") { super(message); }
}

export const PREVIEW_CORE_MANIFEST_SCHEMA = "xfs/preview-core-cache-1" as const;
export const PREVIEW_CORE_STATUS_SCHEMA = "xfs/preview-core-status-1" as const;
export const PREVIEW_CORE_MANIFEST_FILE = "preview-manifest.json";
export const PREVIEW_CORE_ASSET_DIRECTORY = "assets";

export type PreviewCoreTexture = { file: string; mesh: "head" | "eye"; appearance: string; material: string; baseMaterial: string | null;
  parameter: string; depotPath: string; decodedSha256: string; adapter: MapAdapter; width: number; height: number };
export type PreviewCoreManifest = {
  schema: typeof PREVIEW_CORE_MANIFEST_SCHEMA;
  recipeId: string; recipeRevision: number; plateRecipeId: string; plateRecipeRevision: number; recipeSha256: string;
  deriverVersion: number; cacheKey: string;
  source: { revisionId: string; label: string; headMeshDepotPath: string; headMorphDepotPath: string; eyeMeshDepotPath: string;
    headMeshSha256: string; headMorphSha256: string; eyeMeshSha256: string; textures: PreviewCoreTexture[] };
  files: { name: string; sha256: string; bytes: number }[];
  geometry: PreviewGlbReport;
  limits: string[];
};
export type PreviewCoreStatusState = "ready" | "missing" | "unsupported" | "failed";
export type PreviewCoreStatus = {
  schema: typeof PREVIEW_CORE_STATUS_SCHEMA; recipeId: string; recipeRevision: number; deriverVersion: number;
  state: PreviewCoreStatusState; code: string | null; message: string;
  gameRoot: string; contentFingerprint: string; cacheName: string | null; updatedAt: string;
};
export type PreviewCoreResult = { directory: string; manifest: PreviewCoreManifest; reused: boolean };
export type PreviewCoreStep = "reading" | "checking" | "assembling" | "maps" | "verifying";
export const PREVIEW_CORE_STEPS: readonly { step: PreviewCoreStep; label: string }[] = [
  { step: "reading", label: "Reading the head, eyes and skin textures from your game files" },
  { step: "checking", label: "Checking the head against the supported game version" },
  { step: "assembling", label: "Building the 3D head, eye plate and eyes" },
  { step: "maps", label: "Converting the skin and eye textures" },
  { step: "verifying", label: "Checking the prepared preview files" },
];
export type EnsurePreviewCoreOptions = { gameRoot: string; cacheRoot: string; tools: PreviewCoreTools; recipe?: PreviewCoreRecipe;
  plateRecipe?: EyePlateRecipe; signal?: AbortSignal; progress?: (step: PreviewCoreStep, index: number, total: number, label: string) => void };

const LIMITS = [
  "Geometry and textures are the installed game's own data, decoded by WolvenKit; they are private to this computer and must not be redistributed.",
  "Skin, normal and roughness maps are approximations for the browser renderer, not the game's skin shader.",
  "The eye shows the vanilla eye base texture; the game's brown iris gradient, refraction and wetness are not reproduced.",
  "Brows, lashes, hair, piercings and the character-creator idle are not derived here.",
];
const ARCHIVE_DIRECTORY = "archive/pc/content";

export class PreviewCoreCache extends DerivedCache {
  constructor(root: string) { super(root, "3D preview"); }
  writeStatus(status: Omit<PreviewCoreStatus, "schema" | "updatedAt">): void {
    this.writeStatusDocument({ schema: PREVIEW_CORE_STATUS_SCHEMA, ...status, updatedAt: new Date().toISOString() });
  }
  readStatus(): PreviewCoreStatus | null {
    const status = this.readStatusDocument() as PreviewCoreStatus | null;
    return status?.schema === PREVIEW_CORE_STATUS_SCHEMA ? status : null;
  }
}

const depotFile = (root: string, depotPath: string) => join(root, ...depotPath.split("\\"));
const glbFor = (depotPath: string) => depotPath.endsWith(".mesh") ? depotPath.replace(/\.mesh$/, ".glb") : depotPath + ".glb";

function unsupportedMessage(plate: EyePlateRecipe): string {
  const labels = plate.source.supported.map(item => item.label).join(", ");
  return `Your Cyberpunk 2077 has a different female player head from the one XF Studio checks against (${labels}). ` +
    "This usually means a newer game patch. Update XF Studio to a version that supports your game. Nothing was changed.";
}
const MISSING_MESSAGE = "XF Studio could not find the female player head in your Cyberpunk 2077 files. " +
  "Check that the game folder is correct, or verify the game files in your launcher, then try again.";

/** Validate a cached entry against its manifest and the expected identity; `key` null accepts any matching recipe entry. */
export function loadPreviewCoreEntry(cache: PreviewCoreCache, name: string, key: string | null,
  recipe: PreviewCoreRecipe = PREVIEW_CORE_RECIPE, plate: EyePlateRecipe = EYE_PLATE_RECIPE): PreviewCoreResult | null {
  const directory = cache.entry(name);
  const manifestFile = join(directory, PREVIEW_CORE_MANIFEST_FILE);
  if (!existsSync(manifestFile)) return null;
  try {
    const manifest = cache.readJson(manifestFile) as PreviewCoreManifest;
    if (manifest.schema !== PREVIEW_CORE_MANIFEST_SCHEMA || (key !== null && manifest.cacheKey !== key) || manifest.recipeId !== recipe.id ||
        manifest.recipeRevision !== recipe.revision || manifest.deriverVersion !== PREVIEW_CORE_DERIVER_VERSION ||
        manifest.recipeSha256 !== previewCoreRecipeSha256(recipe, plate)) return null;
    const assets = join(directory, PREVIEW_CORE_ASSET_DIRECTORY);
    const names = manifest.files.map(file => file.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([...PREVIEW_CORE_FILES].sort())) return null;
    for (const entry of manifest.files) {
      const file = join(assets, entry.name);
      if (!existsSync(file) || statSync(file).size !== entry.bytes || fileSha256(file) !== entry.sha256) return null;
    }
    return { directory: assets, manifest, reused: true };
  } catch { return null; }
}

export async function ensurePreviewCore(options: EnsurePreviewCoreOptions): Promise<PreviewCoreResult> {
  const recipe = options.recipe ?? PREVIEW_CORE_RECIPE, plate = options.plateRecipe ?? EYE_PLATE_RECIPE;
  const { tools, signal, gameRoot } = options;
  const total = PREVIEW_CORE_STEPS.length;
  const progress = (step: PreviewCoreStep) => {
    const index = PREVIEW_CORE_STEPS.findIndex(item => item.step === step);
    options.progress?.(step, index, total, PREVIEW_CORE_STEPS[index]!.label);
  };
  if (recipe.plateRecipeId !== plate.id) throw new PreviewCoreError("preview_verification_failed", "The preview recipe names a different eye plate recipe.");
  let cache: PreviewCoreCache, work: string;
  try { cache = new PreviewCoreCache(options.cacheRoot); work = cache.createWork(); }
  catch (error) { throw new PreviewCoreError("preview_cache_unavailable", "XF Studio could not open its private 3D preview cache.", (error as Error).message); }
  const fingerprint = contentFingerprint(gameRoot, ARCHIVE_DIRECTORY);
  const status = (state: PreviewCoreStatusState, code: string | null, message: string, cacheName: string | null = null) => {
    try { cache.writeStatus({ recipeId: recipe.id, recipeRevision: recipe.revision, deriverVersion: PREVIEW_CORE_DERIVER_VERSION,
      state, code, message, gameRoot, contentFingerprint: fingerprint, cacheName }); }
    catch { /* Status is advisory; the result carries the real outcome. */ }
  };
  const cancelled = () => { if (signal?.aborted) throw new PreviewCoreError("preview_cancelled", "Preparing the 3D preview was cancelled."); };
  const fail = (code: PreviewCoreErrorCode, message: string, detail = "", state: PreviewCoreStatusState = "failed"): never => {
    status(state, code, message);
    throw new PreviewCoreError(code, message, detail);
  };
  try {
    progress("reading");
    const extracted = join(work, "uncook");
    mkdirSync(extracted);
    const headMesh = plate.source.meshDepotPath, headMorph = plate.source.morphDepotPath, eyeMesh = recipe.eye.meshDepotPath;
    await tools.uncook({ gameRoot, archiveDirectory: plate.source.archiveDirectory, outDir: extracted, signal,
      depotPaths: [headMorph, headMesh, eyeMesh] });
    cancelled();

    progress("checking");
    for (const depot of [headMesh, headMorph, eyeMesh])
      if (!existsSync(depotFile(extracted, depot))) fail("preview_source_missing", MISSING_MESSAGE, depot, "missing");
    const hashes = { meshSha256: fileSha256(depotFile(extracted, headMesh)), morphSha256: fileSha256(depotFile(extracted, headMorph)) };
    const revision = supportedEyePlateSource(plate, hashes);
    if (!revision) fail("preview_source_unsupported", unsupportedMessage(plate), `mesh ${hashes.meshSha256}, morph ${hashes.morphSha256}`, "unsupported");
    const eyeMeshSha256 = fileSha256(depotFile(extracted, eyeMesh));
    const exported = (depot: string, what: string) => {
      const file = depotFile(extracted, depot);
      if (!existsSync(file)) fail("preview_tool_failed", `WolvenKit did not export the ${what}. Check the WolvenKit CLI in Build setup.`, depot);
      return file;
    };
    const headGlb = exported(glbFor(headMorph), "head with its facial shapes");
    const eyeGlb = exported(glbFor(eyeMesh), "eyes");
    const materials = {
      head: parseMaterialExport(cache.readJson(exported(headMesh.replace(/\.mesh$/, ".Material.json"), "head materials"))),
      eye: parseMaterialExport(cache.readJson(exported(eyeMesh.replace(/\.mesh$/, ".Material.json"), "eye materials"))),
    };
    const sources = recipe.maps.map(map => {
      const choice = map.mesh === "head" ? recipe.head : recipe.eye;
      let resolved;
      try { resolved = resolveTextureParameter(materials[map.mesh], choice.appearance, choice.chunk, map.parameter); }
      catch (error) { return fail("preview_verification_failed", "The installed game's head or eye materials are not the kind XF Studio expects.", (error as Error).message); }
      const png = join(extracted, ...decodedTexturePath(resolved.depotPath));
      if (!existsSync(png)) fail("preview_tool_failed", "WolvenKit did not export a skin or eye texture. Check the WolvenKit CLI in Build setup.", resolved.depotPath);
      const bytes = readFileSync(png);
      return { map, resolved, bytes, decodedSha256: sha256Hex(bytes) };
    });
    const textures = Object.fromEntries(sources.map(source => [source.map.file, source.decodedSha256]));
    const key = previewCoreCacheKey(recipe, plate, { headMeshSha256: hashes.meshSha256, headMorphSha256: hashes.morphSha256, eyeMeshSha256, textures });
    const name = previewCoreCacheName(recipe, key);
    const cached = loadPreviewCoreEntry(cache, name, key, recipe, plate);
    if (cached) { status("ready", null, "The 3D preview is ready.", name); return cached; }
    cancelled();

    progress("assembling");
    const staging = join(work, "entry"), assets = join(staging, PREVIEW_CORE_ASSET_DIRECTORY);
    mkdirSync(assets, { recursive: true });
    let assembly;
    try { assembly = assemblePreviewGlb(readFileSync(headGlb), readFileSync(eyeGlb), plate, recipe.eye.surfaceMesh); }
    catch (error) { return fail("preview_verification_failed", "The head exported from your game did not pass XF Studio's checks.", (error as Error).message); }
    writeFileSync(join(assets, "head.glb"), assembly.glb, { mode: 0o600 });
    cancelled();

    progress("maps");
    const records: PreviewCoreTexture[] = [];
    for (const source of sources) {
      let image;
      try { image = adaptMap(decodePng(source.bytes), source.map.adapter); }
      catch (error) { return fail("preview_verification_failed", "A skin or eye texture from your game could not be read.", (error as Error).message); }
      const problems = checkMap(image, source.map.adapter);
      if (problems.length) fail("preview_verification_failed", "A skin or eye texture from your game did not pass XF Studio's checks.", problems.join("; "));
      writeFileSync(join(assets, source.map.file), encodePng(image, { alpha: false }), { mode: 0o600 });
      records.push({ file: source.map.file, mesh: source.map.mesh, appearance: source.resolved.appearance, material: source.resolved.material,
        baseMaterial: source.resolved.baseMaterial, parameter: source.map.parameter, depotPath: source.resolved.depotPath,
        decodedSha256: source.decodedSha256, adapter: source.map.adapter, width: image.width, height: image.height });
      cancelled();
    }

    progress("verifying");
    let geometry: PreviewGlbReport;
    try {
      geometry = verifyPreviewGlb(readFileSync(join(assets, "head.glb")), plate);
      for (const source of sources) {
        const written = decodePng(readFileSync(join(assets, source.map.file)));
        const expected = adaptMap(decodePng(source.bytes), source.map.adapter);
        if (written.width !== expected.width || written.height !== expected.height || !written.data.every((value, index) => value === expected.data[index]))
          throw Error(`${source.map.file} does not decode to its adapted source pixels.`);
      }
    } catch (error) { return fail("preview_verification_failed", "The prepared 3D preview failed verification.", (error as Error).message); }
    const file = (fileName: string) => { const path = join(assets, fileName); return { name: fileName, sha256: fileSha256(path), bytes: statSync(path).size }; };
    const manifest: PreviewCoreManifest = {
      schema: PREVIEW_CORE_MANIFEST_SCHEMA, recipeId: recipe.id, recipeRevision: recipe.revision, plateRecipeId: plate.id,
      plateRecipeRevision: plate.revision, recipeSha256: previewCoreRecipeSha256(recipe, plate), deriverVersion: PREVIEW_CORE_DERIVER_VERSION, cacheKey: key,
      source: { revisionId: revision!.id, label: revision!.label, headMeshDepotPath: headMesh, headMorphDepotPath: headMorph, eyeMeshDepotPath: eyeMesh,
        headMeshSha256: hashes.meshSha256, headMorphSha256: hashes.morphSha256, eyeMeshSha256, textures: records },
      files: PREVIEW_CORE_FILES.map(file),
      geometry, limits: LIMITS,
    };
    cache.writeJson(join(staging, PREVIEW_CORE_MANIFEST_FILE), manifest);
    cache.publish(staging, name);
    const published = loadPreviewCoreEntry(cache, name, key, recipe, plate);
    if (!published) fail("preview_cache_unavailable", "The 3D preview cache changed while it was being written.");
    status("ready", null, "The 3D preview is ready.", name);
    return { ...published!, reused: false };
  } catch (error) {
    if (error instanceof PreviewCoreError) {
      if (error.code === "preview_cancelled") status("failed", "preview_cancelled", error.message);
      throw error;
    }
    const code = (error as { code?: string }).code;
    if (code === "preview_cancelled" || signal?.aborted) {
      status("failed", "preview_cancelled", "Preparing the 3D preview was cancelled.");
      throw new PreviewCoreError("preview_cancelled", "Preparing the 3D preview was cancelled.");
    }
    if (code === "preview_tool_missing") {
      status("failed", code, (error as Error).message);
      throw new PreviewCoreError("preview_tool_missing", (error as Error).message);
    }
    status("failed", "preview_tool_failed", "WolvenKit could not read your game files.");
    throw new PreviewCoreError("preview_tool_failed", "WolvenKit could not read your game files. Check the WolvenKit CLI in Build setup, then try again.",
      `${(error as Error).message}\n${(error as { output?: string }).output ?? ""}`);
  } finally {
    try { cache.remove(work); } catch { /* Best-effort cleanup of private intermediates. */ }
  }
}

export type PreviewCoreReadiness =
  | { state: "ready"; directory: string; manifest: PreviewCoreManifest }
  | { state: "none" }
  | { state: "blocked"; code: string; message: string };
/**
 * Fast readiness without running WolvenKit: the last recorded derivation for this game folder,
 * valid only while the game's content archives are unchanged and the cached files verify.
 * A missing or unsupported head stays blocked until the game or XF Studio's recipe changes.
 */
export function previewCoreReadiness(cacheRoot: string | null, gameRoot: string | null,
  recipe: PreviewCoreRecipe = PREVIEW_CORE_RECIPE, plate: EyePlateRecipe = EYE_PLATE_RECIPE): PreviewCoreReadiness {
  if (!cacheRoot || !gameRoot) return { state: "none" };
  let cache: PreviewCoreCache, status: PreviewCoreStatus | null;
  try { cache = new PreviewCoreCache(cacheRoot); status = cache.readStatus(); } catch { return { state: "none" }; }
  if (!status || status.recipeId !== recipe.id || status.recipeRevision !== recipe.revision || status.deriverVersion !== PREVIEW_CORE_DERIVER_VERSION ||
      !samePath(status.gameRoot, gameRoot) || status.contentFingerprint !== contentFingerprint(gameRoot, ARCHIVE_DIRECTORY)) return { state: "none" };
  if (status.state === "ready" && status.cacheName) {
    const entry = loadPreviewCoreEntry(cache, status.cacheName, null, recipe, plate);
    return entry ? { state: "ready", directory: entry.directory, manifest: entry.manifest } : { state: "none" };
  }
  if (status.state === "missing" || status.state === "unsupported") return { state: "blocked", code: status.code ?? status.state, message: status.message };
  return { state: "none" };
}
