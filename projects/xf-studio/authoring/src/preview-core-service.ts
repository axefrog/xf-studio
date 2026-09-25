import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentFingerprint, DerivedCache, fileSha256, samePath } from "./derived-cache";
import { EYE_PLATE_RECIPE, sha256Hex, supportedEyePlateSource, type EyePlateRecipe } from "./eye-plate-recipe";
import { decodePng, encodePng } from "./png";
import { adaptMap, checkMap } from "./preview-core-maps";
import { parseMaterialExport, resolveTextureParameter } from "./preview-core-materials";
import { assemblePreviewGlb, verifyPreviewGlb, type PreviewGlbReport } from "./preview-core-assemble";
import { GameAssetExportError, gameContentSource, type ExportSource, type GameAssetExporter } from "./game-asset-export";
import { RENDER_DETAIL_SCHEMA, type CoreDetail } from "./render-detail";
import {
  PREVIEW_CORE_DERIVER_VERSION, PREVIEW_CORE_FILES, PREVIEW_CORE_RECORD_FILE, PREVIEW_CORE_RECIPE, previewCoreCacheKey, previewCoreCacheName,
  previewCoreRecipeSha256, type MapAdapter, type PreviewCoreRecipe,
} from "./preview-core-recipe";

/**
 * Application service: derive the 3D preview core (head, eye plate, eyes and maps) from the
 * player's own Cyberpunk 2077 installation. It owns the source gate, cache policy,
 * verification, progress and cancellation. It is the first consumer of the generic game
 * asset exporter, which owns WolvenKit and the per-resource export cache.
 */

export type PreviewCoreErrorCode = "preview_source_missing" | "preview_source_unsupported" | "preview_tool_missing" | "preview_tool_failed" |
  "preview_runtime_missing" | "preview_verification_failed" | "preview_cancelled" | "preview_cache_unavailable" | "preview_failed";
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
    headMeshSha256: string; headMorphSha256: string; eyeMeshSha256: string;
    headGlbSha256: string; eyeGlbSha256: string; headMaterialsSha256: string; eyeMaterialsSha256: string;
    /** The program that decoded the game files, and its identity key (version and content hash). */
    tool: { label: string; key: string };
    textures: PreviewCoreTexture[] };
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
export type EnsurePreviewCoreOptions = { gameRoot: string; cacheRoot: string; exporter: GameAssetExporter;
  /** Archive source to read; defaults to the game's own content archives. */
  source?: ExportSource; recipe?: PreviewCoreRecipe;
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


function unsupportedMessage(plate: EyePlateRecipe): string {
  const labels = plate.source.supported.map(item => item.label).join(", ");
  return `Your Cyberpunk 2077 has a different female player head from the one XF Studio checks against (${labels}). ` +
    "This usually means a newer game patch. Update XF Studio to a version that supports your game. Nothing was changed.";
}
const MISSING_MESSAGE = "XF Studio could not find the female player head in your Cyberpunk 2077 files. " +
  "Check that the game folder is correct, or verify the game files in your launcher, then try again.";
const TOOL_FAILED_MESSAGE = "WolvenKit could not read your game files. Try again; if it keeps happening, check the WolvenKit CLI in Build setup.";
const RUNTIME_MESSAGE = "WolvenKit needs Microsoft's .NET runtime, which isn't installed on this computer. Install it, then try again.";
const STORAGE_ERRORS = new Set(["EACCES", "EPERM", "ENOSPC", "EROFS", "EBUSY", "EMFILE", "ENFILE", "EDQUOT", "EIO", "ENOENT", "ENOTDIR", "EEXIST"]);

/** Map a failure that is not already a PreviewCoreError: tool failures by their typed code, storage by errno. */
function classifyFailure(error: unknown, aborted: boolean): PreviewCoreError {
  if (aborted) return new PreviewCoreError("preview_cancelled", "Preparing the 3D preview was cancelled.");
  if (error instanceof GameAssetExportError) {
    const detail = `${error.message}\n${error.output.slice(-4000)}`;
    switch (error.code) {
      case "cancelled": return new PreviewCoreError("preview_cancelled", "Preparing the 3D preview was cancelled.");
      case "tool_missing": return new PreviewCoreError("preview_tool_missing", "XF Studio needs WolvenKit CLI to read your game files, and it isn't set up yet.", detail);
      case "runtime_missing": return new PreviewCoreError("preview_runtime_missing", RUNTIME_MESSAGE, detail);
      case "tool_failed": return new PreviewCoreError("preview_tool_failed", TOOL_FAILED_MESSAGE, detail);
    }
  }
  const errno = (error as { code?: unknown })?.code;
  if (typeof errno === "string" && STORAGE_ERRORS.has(errno))
    return new PreviewCoreError("preview_cache_unavailable", errno === "ENOSPC" || errno === "EDQUOT"
      ? "XF Studio needs more free disk space for the 3D preview. Free some space on the drive that holds its data folder, then try again."
      : "XF Studio couldn't write the 3D preview into its data folder. Check that the folder isn't read-only or in use, then try again.",
      `${errno}: ${(error as Error).message}`);
  return new PreviewCoreError("preview_failed", "Something went wrong while preparing the 3D preview. Try again; if it keeps happening, restart XF Studio.",
    (error as Error)?.stack ?? String(error));
}

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
  const { exporter, signal, gameRoot } = options;
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
  let session: ReturnType<GameAssetExporter["open"]> | null = null;
  try {
    progress("reading");
    session = exporter.open(options.source ?? gameContentSource(gameRoot), signal);
    const headMesh = plate.source.meshDepotPath, headMorph = plate.source.morphDepotPath, eyeMesh = recipe.eye.meshDepotPath;
    const geometry = await session.geometry([headMorph, headMesh, eyeMesh]);
    cancelled();

    progress("checking");
    const notExported = [headMesh, headMorph, eyeMesh].filter(depot => !geometry.has(depot));
    if (notExported.length) {
      // Only the game's own archive index can say a resource is absent; otherwise the tool produced nothing.
      const present = session.present(notExported);
      const absent = present ? notExported.filter(depot => !present.has(depot)) : [];
      if (absent.length) fail("preview_source_missing", MISSING_MESSAGE, absent.join(", "), "missing");
      fail("preview_tool_failed", TOOL_FAILED_MESSAGE, `WolvenKit exported nothing for ${notExported.join(", ")}` +
        (present ? " although the game's archives contain them." : "; the game's archive index could not be read."));
    }
    const hashes = { meshSha256: geometry.get(headMesh)!.rawSha256, morphSha256: geometry.get(headMorph)!.rawSha256 };
    const revision = supportedEyePlateSource(plate, hashes);
    if (!revision) fail("preview_source_unsupported", unsupportedMessage(plate), `mesh ${hashes.meshSha256}, morph ${hashes.morphSha256}`, "unsupported");
    const eyeMeshSha256 = geometry.get(eyeMesh)!.rawSha256;
    const exported = (file: string | null, depot: string, what: string) => {
      if (!file || !existsSync(file)) fail("preview_tool_failed", `WolvenKit did not export the ${what}. Try again; if it keeps happening, check the WolvenKit CLI in Build setup.`, depot);
      return file!;
    };
    const headGlb = exported(geometry.get(headMorph)!.glb, headMorph, "head with its facial shapes");
    const eyeGlb = exported(geometry.get(eyeMesh)!.glb, eyeMesh, "eyes");
    const materialExport = (depot: string, what: string) => {
      const file = exported(geometry.get(depot)!.materials, depot, what);
      try { return parseMaterialExport(cache.readJson(file)); }
      catch (error) { return fail("preview_tool_failed", `WolvenKit's export of the ${what} could not be read. Try again.`, `${depot}: ${(error as Error).message}`); }
    };
    const materials = { head: materialExport(headMesh, "head materials"), eye: materialExport(eyeMesh, "eye materials") };
    const exportHashes = { headGlbSha256: geometry.get(headMorph)!.glbSha256!, eyeGlbSha256: geometry.get(eyeMesh)!.glbSha256!,
      headMaterialsSha256: geometry.get(headMesh)!.materialsSha256!, eyeMaterialsSha256: geometry.get(eyeMesh)!.materialsSha256! };
    const resolved = recipe.maps.map(map => {
      const choice = map.mesh === "head" ? recipe.head : recipe.eye;
      try { return { map, resolved: resolveTextureParameter(materials[map.mesh], choice.appearance, choice.chunk, map.parameter) }; }
      catch (error) { return fail("preview_verification_failed", "The installed game's head or eye materials are not the kind XF Studio expects.", (error as Error).message); }
    });
    const decoded = await session.textures([...new Set(resolved.map(entry => entry.resolved.depotPath))]);
    cancelled();
    const sources = resolved.map(({ map, resolved: parameter }) => {
      const texture = decoded.get(parameter.depotPath);
      if (!texture) fail("preview_tool_failed", "WolvenKit did not export a skin or eye texture. Check the WolvenKit CLI in Build setup.", parameter.depotPath);
      const bytes = readFileSync(texture!.png);
      return { map, resolved: parameter, bytes, decodedSha256: sha256Hex(bytes) };
    });
    const textures = Object.fromEntries(sources.map(source => [source.map.file, source.decodedSha256]));
    const key = previewCoreCacheKey(recipe, plate, { headMeshSha256: hashes.meshSha256, headMorphSha256: hashes.morphSha256, eyeMeshSha256,
      ...exportHashes, tool: session.tool.key, textures });
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
    let report: PreviewGlbReport;
    try {
      report = verifyPreviewGlb(readFileSync(join(assets, "head.glb")), plate);
      for (const source of sources) {
        const written = decodePng(readFileSync(join(assets, source.map.file)));
        const expected = adaptMap(decodePng(source.bytes), source.map.adapter);
        if (written.width !== expected.width || written.height !== expected.height || !written.data.every((value, index) => value === expected.data[index]))
          throw Error(`${source.map.file} does not decode to its adapted source pixels.`);
      }
    } catch (error) { return fail("preview_verification_failed", "The prepared 3D preview failed verification.", (error as Error).message); }
    const file = (fileName: string) => { const path = join(assets, fileName); return { name: fileName, sha256: fileSha256(path), bytes: statSync(path).size }; };
    // The render detail record: what the renderer loads, with hashes and game-resource provenance.
    const record: CoreDetail = {
      schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: key, origin: "game-files",
      provenance: { label: `Your Cyberpunk 2077 files (${revision!.label})`, notes: LIMITS, tool: session.tool.label },
      geometry: { file: "head.glb", sha256: file("head.glb").sha256, nodes: { head: "head", plate: "makeup_plate", eyes: "eyes" },
        sources: [{ depotPath: headMorph, sha256: hashes.morphSha256 }, { depotPath: headMesh, sha256: hashes.meshSha256 },
          { depotPath: eyeMesh, sha256: eyeMeshSha256 }] },
      textures: Object.fromEntries(recipe.maps.map(map => {
        const texture = records.find(entry => entry.file === map.file)!;
        return [map.slot, { file: map.file, sha256: file(map.file).sha256, sources: [{ depotPath: texture.depotPath, material: texture.material,
          parameter: texture.parameter, adapter: texture.adapter }] }];
      })) as CoreDetail["textures"],
    };
    cache.writeJson(join(assets, PREVIEW_CORE_RECORD_FILE), record);
    const manifest: PreviewCoreManifest = {
      schema: PREVIEW_CORE_MANIFEST_SCHEMA, recipeId: recipe.id, recipeRevision: recipe.revision, plateRecipeId: plate.id,
      plateRecipeRevision: plate.revision, recipeSha256: previewCoreRecipeSha256(recipe, plate), deriverVersion: PREVIEW_CORE_DERIVER_VERSION, cacheKey: key,
      source: { revisionId: revision!.id, label: revision!.label, headMeshDepotPath: headMesh, headMorphDepotPath: headMorph, eyeMeshDepotPath: eyeMesh,
        headMeshSha256: hashes.meshSha256, headMorphSha256: hashes.morphSha256, eyeMeshSha256, ...exportHashes,
        tool: { label: session.tool.label, key: session.tool.key }, textures: records },
      files: PREVIEW_CORE_FILES.map(file),
      geometry: report, limits: LIMITS,
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
    const failure = classifyFailure(error, !!signal?.aborted);
    status("failed", failure.code, failure.message);
    throw failure;
  } finally {
    session?.close();
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
