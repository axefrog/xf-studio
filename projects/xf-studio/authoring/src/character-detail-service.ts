/**
 * Host application service: prepare the character render record (head skin, face details, brows, lashes, hair, eyes and piercings) for one V from
 * the installation the launch route loads. It opens the route with the generic resolver (the same source
 * discovery, archive precedence and ArchiveXL rules Build uses), resolves the V's choices, plans the
 * drawable components (character-detail-plan.ts), exports each winning resource through the generic
 * game-asset exporter (GLB for geometry, PNG for textures, cached per depot hash and archive fingerprint),
 * and writes a content-addressed record the renderer loads. Read-only towards the game and MO2.
 *
 * There is no mod-specific code: a CCXL hair, brow, lash or eye pack resolves exactly like vanilla, and so does a
 * complexion mod, whether it replaces textures or skin profiles at their vanilla paths (archive precedence) or
 * patches the head mesh's appearances through ArchiveXL (the resolver follows the patch's materials), and so does a
 * piercing framework that replaces a vanilla style's `.app` and fills its slots from item archives.
 *
 * Layered (`multilayered.mt`) chunks also get their layer stack: the winning `.mlsetup` and each layer's `.mltemplate` are read
 * through the resolver (layered-setup.ts), their maps and microblends exported like any texture, and the `.mlmask` exported as one
 * raw image per mask layer.
 *
 * A request's creator choices (the character context, character-context.ts) are interpreted into the V's descriptors (`derive`: the
 * host's structural catalogue of the merged creator resource this preparation loads, cc-catalogue-service.ts `structuralInput`;
 * PIPE-80); a request without choices is the default V or the save as stored. When the choices can't be interpreted, the V is shown
 * without them and the result says so in one plain line (`note`), and the host prepares it again next time.
 *
 * Preparations on one installation share a `CharacterPreparationCache` (the host keeps it per installation fingerprint): a changed
 * choice on the same V re-plans from what earlier preparations already resolved, read and exported, and resolves and exports only what
 * the choice changes (PREV-68). A preparation that met a failure which may not repeat (a WolvenKit run that timed out, a resource the
 * fetcher answered null for such a reason) is **degraded**: nothing it derived from a missing input is kept, and the host prepares it
 * again next time instead of serving it as final (PIPE-53). The written record is what the browser's own reader makes of it
 * (`parseCharacterDetail`), so the host and the page share one rule set (PIPE-40).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { descriptorsFromUiState } from "./cco-model";
import { type BodyScope, planCharacterDetails, previewInput, recordMorphTexture, SLOT_WORDS, type CharacterPlan, type PlannedChunk, type PlannedComponent } from "./character-detail-plan";
import { inputFromCharacterRequest, type CharacterRequest } from "./character-detail-request";
import { type ComponentOverrides, loadMergedCco, NO_OVERRIDES, overridesKey, resolveCharacter, type CharacterInput, type ResolvedAppearance, type ResolvedCharacter,
  type ResolvedParam } from "./character-resolver";
import { type ClothingFailure, resolveClothing, type ResolvedClothing } from "./clothing-resolver";
import { clothingPorts } from "./clothing-host";
import { refFromPath, refLabel, type DepotRef } from "./depot-path";
import { archiveExportSource, type ExportKind, GameAssetExportError, type GameAssetExporter } from "./game-asset-export";
import { keepGlbMeshes } from "./glb";
import { decodePngHalved, encodePngAsync, type RgbaImage } from "./png";
import { layerOverrides, readSetup, readTemplate, type SetupValues, type TemplateValues } from "./layered-setup";
import { templateDefaults } from "./material-template";
import { asArray, cname, isObject, type JsonObject, type MaterialParamValue } from "./red-json";
import { CHARACTER_DETAIL_SCHEMA, CHOICE_NAME_MAX, chunkOfMesh, decalFamilySlot, parseCharacterDetail, RECORD_LIMITS, type CharacterDetail, type DetailSlot, type DetailSlotState, type LayerTextureRole, type RenderChunkMaterial,
  type RenderComponent, type RenderGradient, type RenderLayer, type RenderLayered, type RenderProfile, type RenderProfileStop, type RenderRgba,
  type RenderSkinProfile, type RenderSourceRef, type RenderTexture, UNCOVERED_BODY } from "./render-detail";
import { renderTemplate, templateRequired } from "./render-templates";
import { manifestOf, writeChoiceManifest, xlIdentity } from "./choice-manifest";
import type { LowPriority } from "./process-tree";
import type { Installation, InstallationOptions } from "./resolver-host";
import type { Provenance, ResourceGraph } from "./resource-graph";
import { NO_TRACE, type DiagnosticTrace } from "./diagnostics/model";
import { RESOLUTION_TRACE_OPTIONS, resolutionTrace } from "./diagnostics/resolution-trace";

export type CharacterDetailStep = "reading" | "resolving" | "exporting" | "writing";
export const CHARACTER_DETAIL_STEPS: readonly { step: CharacterDetailStep; label: string }[] = [
  { step: "reading", label: "Reading your installed mods" },
  { step: "resolving", label: "Working out your V's skin, face details, eyes, brows, lashes, hair, piercings, body and clothes" },
  { step: "exporting", label: "Reading their shapes and textures from your game files" },
  { step: "writing", label: "Getting them ready for the preview" },
];
export type CharacterRoute = Omit<InstallationOptions, "cacheDir" | "log">;
export type PrepareCharacterOptions = {
  request: CharacterRequest;
  route: CharacterRoute;
  /** Host-owned store for the served files and records (`files/`, `records/`). */
  storeRoot: string;
  /** Resolver JSON and archive-index cache. */
  resolverCache: string;
  exporter: GameAssetExporter;
  /** The installation to prepare from (defaults to the host's shared, long-lived one: installation-registry.ts). */
  open?: (options: InstallationOptions) => Installation | Promise<Installation>;
  signal?: AbortSignal;
  progress?: (step: CharacterDetailStep, index: number, total: number, label: string) => void;
  log?: (message: string) => void;
  /** The rolling diagnostics window (docs/diagnostics.md): the request, the resolution and the outcome, as references. */
  trace?: DiagnosticTrace;
  /**
   * What earlier preparations on the same installation made (the host's, per installation fingerprint). Without one, everything is
   * resolved, read and exported afresh, and the installation is opened with `open`.
   */
  cache?: CharacterPreparationCache;
  /**
   * The V's descriptors for a request with creator choices, interpreted from the merged creator resource this preparation loaded (the
   * host's `structuralInput`). Without it, a request's choices are ignored with a log line.
   */
  derive?: (request: CharacterRequest, cco: Awaited<ReturnType<typeof loadMergedCco>>) => CharacterInput | Promise<CharacterInput>;
  /**
   * Where to keep what a finished preparation depended on (choice-manifest.ts), so a later session knows the request is ready without
   * preparing it: the folder and the request's manifest name on this route. Without it, nothing is kept.
   */
  manifests?: { dir: string; key: (request: CharacterRequest) => string };
  /** Background work (a prefetch): WolvenKit runs below normal priority. */
  lowPriority?: LowPriority;
  /** The native decode worker a packaged host ships (clothing-host.ts); the source file next to the reader otherwise. */
  nativeDecodeWorker?: string;
};
/**
 * `degraded`: a failure that may not repeat affected it; the host prepares it again next time (PIPE-53). `note`: one plain line about
 * what the V is shown without (its creator choices, when they couldn't be interpreted; PIPE-80).
 */
export type CharacterDetailResult = { record: CharacterDetail; recordFile: string; degraded: boolean; note?: string };
const CHOICES_LEFT_OUT = "Your creator changes couldn't be applied, so your V is shown without them. Try again, or undo the last change.";

export class CharacterDetailError extends Error {
  constructor(readonly code: "character_cancelled" | "character_tool_missing" | "character_unreadable" | "character_failed",
    message: string, readonly detail = "") { super(message); }
}
const UNREADABLE = "XF Studio couldn't read your game's character-creator files, so your V's own skin, face details, eyes, brows, lashes, hair, piercings and body aren't shown. The head still works.";
const TOOL_MISSING = "WolvenKit isn't ready, so your V's own skin, face details, eyes, brows, lashes, hair, piercings and body aren't shown yet. The head still works.";

/** The record's file names are content-addressed: `<sha256>.<ext>`. */
export const STORE_FILE = /^[a-f0-9]{64}\.(glb|png|json)$/;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
/** A resource hash worth recording (the resolver reports SHA-256 of the extracted bytes when it measured them). */
const hexSha = (value: string | null | undefined) => value && /^[a-f0-9]{64}$/.test(value) ? value : null;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);

/** PNG width and height from its header (the exporter's output; no decode needed). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[12] !== 0x49 || bytes[13] !== 0x48) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** `CBitmapTexture.setup.isGamma`, or null when the resource's JSON is unavailable. */
export function textureIsGamma(root: JsonObject | null | undefined): boolean | null {
  const setup = root && isObject(root.setup) ? root.setup : null;
  if (!setup || (setup.isGamma !== 0 && setup.isGamma !== 1 && typeof setup.isGamma !== "boolean")) return null;
  return setup.isGamma === 1 || setup.isGamma === true;
}

/** A serialized `CHairProfile` as the record carries it (stored order and 8-bit colours kept). */
export function hairProfileStops(root: JsonObject): Pick<RenderProfile, "sampleCount" | "id" | "rootToTip"> | null {
  if (root.$type !== "CHairProfile") return null;
  const read = (entries: unknown): RenderProfileStop[] => asArray(entries).filter(isObject).map(entry => {
    const colour = isObject(entry.color) ? entry.color : {};
    const channel = (value: unknown) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    return { value: Math.max(0, Math.min(1, Number(entry.value) || 0)), color: [channel(colour.Red), channel(colour.Green), channel(colour.Blue)] };
  });
  const id = read(root.gradientEntriesID), rootToTip = read(root.gradientEntriesRootToTip);
  const sampleCount = Number(root.sampleCount);
  if (!id.length || !rootToTip.length || !Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 1024) return null;
  return { sampleCount, id: id.slice(0, 32), rootToTip: rootToTip.slice(0, 32) };
}

/** A serialized `CSkinProfile` as the record carries it (8-bit colours kept), or null when it is not one. */
export function skinProfileValues(root: JsonObject): Omit<RenderSkinProfile, "depotPath" | "archive" | "sha256"> | null {
  if (root.$type !== "CSkinProfile") return null;
  const number = (value: unknown, fallback: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
  };
  const colour = (value: unknown): [number, number, number] => {
    const c = isObject(value) ? value : {};
    const channel = (v: unknown) => Math.max(0, Math.min(255, Math.round(Number(v ?? 255)) || 0));
    return [channel(c.Red), channel(c.Green), channel(c.Blue)];
  };
  // Serializers omit fields at their type defaults; a missing field reads as the class default (1 for scales, white colours).
  return { roughness0: number(root.roughness0, 1, 16), roughness1: number(root.roughness1, 1, 16), lobeMix: number(root.lobeMix, 0, 16),
    blurSize: number(root.blurSize, 0, 64), diffuse: colour(root.diffuse), falloff: colour(root.falloff) };
}

/** A serialized `CGradient` as the record carries it: 8-bit RGBA stops sorted by value (stored order is not sorted). */
export function gradientStops(root: JsonObject): RenderGradient["stops"] | null {
  if (root.$type !== "CGradient") return null;
  const channel = (value: unknown, fallback: number) => {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : fallback;
  };
  const stops = asArray(root.gradientEntries).filter(isObject).map(entry => {
    const colour = isObject(entry.color) ? entry.color : {};
    // Serializers omit a field at its type default: 0 for the position and channels, 255 for alpha.
    return { value: Math.max(0, Math.min(1, Number(entry.value) || 0)),
      color: [channel(colour.Red, 0), channel(colour.Green, 0), channel(colour.Blue, 0), channel(colour.Alpha, 255)] as RenderRgba };
  }).sort((a, b) => a.value - b.value);
  return stops.length ? stops.slice(0, 32) : null;
}

const paramText = (value: MaterialParamValue) => value.kind === "scalar" ? JSON.stringify(value.value) : value.kind === "name" ? value.value
  : value.text ?? (value.ref ? refLabel(value.ref) : "");

/** A material template's own identity: its `name` (which selects its compiled programs) and `materialPriority` (absent = `EMP_Normal`). */
export function templateIdentity(root: JsonObject | null | undefined): { name: string | null; priority: string | null } {
  if (!root || root.$type !== "CMaterialTemplate") return { name: null, priority: null };
  const name = cname(root.name) || null;
  const priority = typeof root.materialPriority === "string" && /^EMP_[A-Za-z]{1,32}$/.test(root.materialPriority) ? root.materialPriority : "EMP_Normal";
  return { name, priority };
}

/**
 * Every material template the plan meets, read once per installation: its own name and priority (a mod's copy of a vanilla template
 * keeps the name the engine finds programs by), and, for the templates the renderer draws, their parameter defaults.
 */
async function loadTemplates(graph: ResourceGraph, templates: Iterable<Provenance>, cache: CharacterPreparationCache): Promise<void> {
  // Read together, so templates not read yet share one extraction batch.
  const wanted = new Map<string, Provenance>();
  for (const template of templates) {
    const key = refLabel(template.ref).toLowerCase();
    if (!cache.identities.has(key) && /\.mt$/i.test(key)) wanted.set(key, template);
  }
  await Promise.all([...wanted].map(async ([key, template]) => {
    const loaded = await graph.load(template.ref, "mt");
    const identity = templateIdentity(loaded?.root);
    cache.identities.set(key, identity);
    if (!renderTemplate(key, identity.name)) return;
    cache.defaults.set(key, loaded ? templateDefaults(loaded.root).map(([name, value]) => ({ name, kind: value.kind, value: paramText(value),
      setBy: `${refLabel(template.ref)} (template default)`,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })) : []);
  }));
}

type Located = { depotPath: string; archive: { id: string; name: string; provider: string } };
function locate(graph: ResourceGraph, ref: DepotRef): Located | null {
  const { entry, lookup } = graph.locate(ref);
  const path = entry.path ?? graph.named(entry).path;
  if (!lookup.winner || !path) return null;
  return { depotPath: path, archive: { id: lookup.winner.id, name: lookup.winner.name, provider: lookup.winner.providerName } };
}

/**
 * The hash and size of an exported file, remembered by its path, size and modification time: re-reading and hashing every served map
 * on every preparation cost seconds (PREV-68). The exporter's cache writes a new file for new content, so a changed file is read again.
 */
const hashed = new Map<string, { stamp: string; sha256: string; bytes: number; size: { width: number; height: number } | null }>();
const fileStamp = (file: string) => { const s = statSync(file); return `${s.size}|${s.mtimeMs}`; };
/** Copy an exported file into the content-addressed store; returns its served name, hash and (for a PNG) its size. */
function store(storeRoot: string, file: string, extension: "glb" | "png"): { file: string; sha256: string; size: { width: number; height: number } | null } {
  const stamp = fileStamp(file), known = hashed.get(file);
  if (known?.stamp === stamp && existsSync(join(storeRoot, "files", `${known.sha256}.${extension}`)))
    return { file: `${known.sha256}.${extension}`, sha256: known.sha256, size: known.size };
  const bytes = new Uint8Array(readFileSync(file));
  const stored = storeBytes(storeRoot, bytes, extension), size = extension === "png" ? pngSize(bytes) : null;
  hashed.set(file, { stamp, sha256: stored.sha256, bytes: bytes.length, size });
  if (hashed.size > 20_000) hashed.delete(hashed.keys().next().value!);
  return { file: stored.file, sha256: stored.sha256, size };
}
function storeBytes(storeRoot: string, bytes: Uint8Array, extension: "glb" | "png"): { file: string; sha256: string } {
  const hash = sha256(bytes), name = `${hash}.${extension}`, target = join(storeRoot, "files", name);
  if (!existsSync(target) || statSync(target).size !== bytes.length) {
    mkdirSync(join(storeRoot, "files"), { recursive: true, mode: 0o700 });
    const staging = `${target}.${process.pid}.tmp`;
    writeFileSync(staging, bytes, { mode: 0o600 });
    renameSync(staging, target);
  }
  return { file: name, sha256: hash };
}

/** 1: the drawn chunks' meshes, sparse POSITION/NORMAL morph deltas, no TANGENT deltas (glb.ts `keepGlbMeshes`). */
export const CHUNK_GEOMETRY_VERSION = 1;
/**
 * The served geometry of a component: only the meshes of the chunks it draws (PREV-53). WolvenKit exports every render
 * chunk with dense deltas for every facial target, so one scar chunk of 273 vertices arrived as a 45.6 MB file. The copy
 * is keyed in the store by the export's hash, the chunk list and `CHUNK_GEOMETRY_VERSION`, so it is made once. A file
 * the copy can't read (not a GLB, or parts it does not carry) is served whole, and the loader still keeps only the drawn
 * chunks. Returns the stored file and whether it is the chunk copy.
 */
export function storeChunkGeometry(storeRoot: string, file: string, chunks: readonly number[]): { file: string; sha256: string; trimmed: boolean } {
  const stamp = fileStamp(file), known = hashed.get(file);
  let source = known?.stamp === stamp ? known.sha256 : null, bytes: Uint8Array | null = null;
  if (!source) {
    bytes = new Uint8Array(readFileSync(file));
    source = sha256(bytes);
    hashed.set(file, { stamp, sha256: source, bytes: bytes.length, size: null });
  }
  const wanted = [...new Set(chunks)].sort((a, b) => a - b);
  const key = join(storeRoot, "chunks", `${source}-${wanted.join("_") || "none"}-v${CHUNK_GEOMETRY_VERSION}.json`);
  try {
    const known = JSON.parse(readFileSync(key, "utf8")) as { file: string; sha256: string; trimmed: boolean };
    if (STORE_FILE.test(known.file) && existsSync(join(storeRoot, "files", known.file))) return known;
  } catch { /* Not made yet. */ }
  bytes ??= new Uint8Array(readFileSync(file));
  let result: { file: string; sha256: string; trimmed: boolean };
  try {
    const copy = keepGlbMeshes(bytes, mesh => wanted.includes(chunkOfMesh(String(mesh.name ?? "")) ?? -1));
    const stored = storeBytes(storeRoot, copy, "glb");
    result = { file: stored.file, sha256: stored.sha256, trimmed: true };
  } catch {
    const stored = storeBytes(storeRoot, bytes, "glb");
    result = { file: stored.file, sha256: stored.sha256, trimmed: false };
  }
  mkdirSync(join(storeRoot, "chunks"), { recursive: true, mode: 0o700 });
  const staging = `${key}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(result), { mode: 0o600 });
  renameSync(staging, key);
  return result;
}

/**
 * The largest texture side the preview is served (PREV-body): larger game textures (a body texture mod's 8192² skin maps) are halved
 * until they fit, so one V's maps stay within the record's texel budget and a GPU's memory. Every vanilla head, face and eye map is at
 * most 4096², so those are served as exported.
 */
export const SERVED_TEXTURE_MAX = 4096;
/** 1: 2×2 box means of the stored bytes per halving (like a mip level), alpha kept when the source has any. */
export const SCALED_TEXTURE_VERSION = 1;
/** An image halved by 2×2 box means of its bytes (odd edges repeat their last texel). */
export function halveImage(image: RgbaImage): RgbaImage {
  const width = Math.max(1, image.width >> 1), height = Math.max(1, image.height >> 1), data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.min(image.width - 1, x * 2), x1 = Math.min(image.width - 1, x * 2 + 1);
    const y0 = Math.min(image.height - 1, y * 2), y1 = Math.min(image.height - 1, y * 2 + 1);
    for (let k = 0; k < 4; k++) {
      const at = (xx: number, yy: number) => image.data[(yy * image.width + xx) * 4 + k]!;
      data[(y * width + x) * 4 + k] = (at(x0, y0) + at(x1, y0) + at(x0, y1) + at(x1, y1) + 2) >> 2;
    }
  }
  return { width, height, data };
}
/**
 * The served copy of an exported texture larger than `SERVED_TEXTURE_MAX` on a side: halved until it fits, keyed in the store by the
 * export's hash, the limit and `SCALED_TEXTURE_VERSION`, so it is made once. Returns null when the texture fits as it is. The decode and
 * halving stream (png.ts `decodePngHalved`: never the whole 8K image in memory) and the compression runs on zlib's thread pool, so the
 * host's event loop keeps serving while an 8K body map is scaled (PREV-107); the bytes are the same as the halving `halveImage` describes.
 */
export async function storeScaledTexture(storeRoot: string, file: string, size: { width: number; height: number }, max = SERVED_TEXTURE_MAX):
  Promise<{ file: string; sha256: string; size: { width: number; height: number } } | null> {
  if (size.width <= max && size.height <= max) return null;
  const stamp = fileStamp(file), known = hashed.get(file);
  let source = known?.stamp === stamp ? known.sha256 : null, bytes: Uint8Array | null = null;
  if (!source) { bytes = new Uint8Array(await readFile(file)); source = sha256(bytes); }
  const key = join(storeRoot, "scaled", `${source}-${max}-v${SCALED_TEXTURE_VERSION}.json`);
  try {
    const kept = JSON.parse(readFileSync(key, "utf8")) as { file: string; sha256: string; size: { width: number; height: number } };
    if (STORE_FILE.test(kept.file) && existsSync(join(storeRoot, "files", kept.file))) return kept;
  } catch { /* Not made yet. */ }
  const image = await decodePngHalved(bytes ?? new Uint8Array(await readFile(file)), max);
  bytes = null;
  let alpha = false;
  for (let i = 3; i < image.data.length && !alpha; i += 4) alpha = image.data[i] !== 255;
  const stored = storeBytes(storeRoot, await encodePngAsync(image, { alpha }), "png");
  const result = { file: stored.file, sha256: stored.sha256, size: { width: image.width, height: image.height } };
  mkdirSync(join(storeRoot, "scaled"), { recursive: true, mode: 0o700 });
  const staging = `${key}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(result), { mode: 0o600 });
  renameSync(staging, key);
  return result;
}

type ScaledCopy = { file: string; sha256: string; size: { width: number; height: number } } | { why: string };
/**
 * The served copies of the exported textures among `located` that are larger than `SERVED_TEXTURE_MAX`, by export file: made (or found in
 * the store) one at a time, each off the event loop (`storeScaledTexture`), and remembered per export file and stamp for the installation.
 */
async function scaleTextures(cache: CharacterPreparationCache, storeRoot: string, located: readonly Located[], cancelled: () => void): Promise<Map<string, ScaledCopy>> {
  const out = new Map<string, ScaledCopy>();
  for (const at of located) {
    const png = cache.textures.get(`${at.archive.id}|${at.depotPath.toLowerCase()}`)?.png;
    if (!png || out.has(png)) continue;
    const size = pngFileSize(png);
    if (!size || (size.width <= SERVED_TEXTURE_MAX && size.height <= SERVED_TEXTURE_MAX)) continue;
    const key = `${png}|${fileStamp(png)}`, known = cache.scaled.get(key);
    if (known) { out.set(png, known); continue; }
    cancelled();
    let copy: ScaledCopy;
    try { copy = (await storeScaledTexture(storeRoot, png, size)) ?? { why: "unreadable image" }; }
    catch (error) { copy = { why: String((error as Error)?.message ?? error).slice(0, 120) }; }
    // A copy made is kept for the installation; a failure is tried again next time.
    if (!("why" in copy)) cache.scaled.set(key, copy);
    out.set(png, copy);
  }
  return out;
}

/** An exported PNG's size from its header, without reading the whole file (null when it isn't a PNG). */
function pngFileSize(file: string): { width: number; height: number } | null {
  const handle = openSync(file, "r");
  try { const head = new Uint8Array(24); readSync(handle, head, 0, 24, 0); return pngSize(head); }
  catch { return null; }
  finally { closeSync(handle); }
}

/** A served component as the writing step made it, with the notes it earned and the texels its distinct textures take. */
type BuiltComponent = { component: RenderComponent; notes: string[]; textures: Map<string, number> };
/**
 * What preparations on one installation derive and share (PREV-68), layered on the registry's long-lived `Installation`
 * (installation-registry.ts), which already keeps the opened archives, the resource graph and the merged creator resource. A host keeps
 * one per installation fingerprint (the route, its stamps, WolvenKit's identity and the registry's generation; character-detail-host.ts)
 * and passes it to every preparation, so a tried choice on the same V re-plans from the V it already resolved: each appearance descriptor
 * is resolved once, templates, setups, profiles and gradients are interpreted once, each archive file is exported once, and a component
 * whose plan is unchanged is served exactly as before. When the registry hands out another installation (the mod setup changed), the
 * cache starts afresh (`reset`). Only what the tried choice changes is resolved and exported. Nothing here is written to disk; the
 * exporter's own cache and the content-addressed store already are. Entries are only added once complete, so a cancelled preparation
 * leaves nothing half-made.
 *
 * Each preparation or prefetch batch runs as a `CacheRun`, followed through its async work (`AsyncLocalStorage`): the cache records
 * which run added each entry and which earlier runs' entries a run was served. A degraded run forgets only the entries it added, never
 * one another run added meanwhile (PREV-102), and a run's manifest names the reads behind every entry it was served from memory, not
 * only its own (PREV-103).
 */
export class CharacterPreparationCache {
  /** The registry's installation this cache was derived from (its `depot` identifies it; the registry owns it). */
  installation: Installation | null = null;
  /** Resolved appearances by descriptor (part, option, app, definition) and the V's morphs. */
  readonly appearances = new RunMap<string, ResolvedAppearance>();
  readonly defaults = new RunMap<string, ResolvedParam[]>();
  readonly identities = new RunMap<string, { name: string | null; priority: string | null }>();
  readonly profiles = new RunMap<string, RenderProfile | null>();
  readonly skinProfiles = new RunMap<string, RenderSkinProfile | null>();
  readonly gradients = new RunMap<string, RenderGradient | null>();
  readonly setups = new RunMap<string, { values: SetupValues; source: RenderSourceRef } | null>();
  readonly layerTemplates = new RunMap<string, { values: TemplateValues; source: RenderSourceRef } | null>();
  readonly gamma = new RunMap<string, boolean | null>();
  /** Exports by `archive id|depot path` (lower case). A tool failure is never kept, so the next preparation tries again. */
  readonly geometry = new RunMap<string, { glb: string | null; complete: boolean; repair?: string | null }>();
  readonly textures = new RunMap<string, { png: string }>();
  readonly masks = new RunMap<string, { layers: string[] }>();
  /** Served components by their plan (canonical JSON), within this installation. */
  readonly components = new RunMap<string, BuiltComponent>();
  /** Served copies of textures larger than the preview takes, by export file and stamp (PREV-107). */
  readonly scaled = new Map<string, { file: string; sha256: string; size: { width: number; height: number } }>();
  /** The export tool that read these files (the record names it even when nothing new is exported). */
  toolLabel: string | undefined;
  private maps(): RunMap<string, unknown>[] {
    return [this.appearances, this.defaults, this.identities, this.profiles, this.skinProfiles, this.gradients, this.setups,
      this.layerTemplates, this.gamma, this.geometry, this.textures, this.masks, this.components] as RunMap<string, unknown>[];
  }
  /**
   * Forget every entry `run` added that still holds what it added (a degraded preparation's results: nulls and parts made without
   * inputs; PIPE-53). Entries another run added meanwhile stay (PREV-102).
   */
  forget(run: CacheRun): void {
    const maps = new Set<unknown>(this.maps());
    for (const { map, key, value } of run.added.splice(0)) if (maps.has(map)) map.forgetAdded(key, value);
  }
  /** Forget everything derived from an earlier installation. */
  reset(): void {
    for (const map of this.maps()) map.clear();
    this.scaled.clear();
    this.toolLabel = undefined;
    this.installation = null;
  }
}

/**
 * One preparation or prefetch batch using a `CharacterPreparationCache` (PREV-102, PREV-103): the entries it added (so a degraded run
 * forgets only its own), the runs whose entries it was served, and what it read from the resource graph (`reads`).
 */
export class CacheRun {
  readonly added: { map: RunMap<unknown, unknown>; key: unknown; value: unknown }[] = [];
  readonly used = new Set<CacheRun>();
  /** The resources this run read (its graph recording, plus its merged creator resource's files). */
  readonly reads = new Set<string>();
  /**
   * The reads of every run whose entries this run was served from memory, and of the runs those were served from: what an entry this
   * run didn't make itself depends on. This run's own reads are not included.
   */
  inherited(): Set<string> {
    const out = new Set<string>(), seen = new Set<CacheRun>([this]), stack = [...this.used];
    while (stack.length) {
      const run = stack.pop()!;
      if (seen.has(run)) continue;
      seen.add(run);
      for (const hash of run.reads) out.add(hash);
      for (const next of run.used) if (!seen.has(next)) stack.push(next);
    }
    return out;
  }
}
const cacheRuns = new AsyncLocalStorage<CacheRun>();
/** Run `work` as `run`: every cache entry it adds or is served, through all the async work it starts, is attributed to `run`. */
export const withCacheRun = <T>(run: CacheRun, work: () => Promise<T>): Promise<T> => cacheRuns.run(run, work);

/** A `Map` that attributes each entry to the `CacheRun` that added it and records which runs another run was served from. */
export class RunMap<K, V> extends Map<K, V> {
  // Declared without an initializer: `Map`'s constructor may call `set` before field initializers run.
  private origins: Map<K, CacheRun> | undefined;
  override set(key: K, value: V): this {
    const run = cacheRuns.getStore();
    if (run && !super.has(key)) {
      run.added.push({ map: this as RunMap<unknown, unknown>, key, value });
      (this.origins ??= new Map()).set(key, run);
    }
    return super.set(key, value);
  }
  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined || super.has(key)) this.served(key);
    return value;
  }
  override has(key: K): boolean {
    const found = super.has(key);
    if (found) this.served(key);
    return found;
  }
  override delete(key: K): boolean { this.origins?.delete(key); return super.delete(key); }
  override clear(): void { this.origins?.clear(); super.clear(); }
  /** Forget `key` when it still holds `value` (what one run added). */
  forgetAdded(key: K, value: V): void { if (super.has(key) && super.get(key) === value) this.delete(key); }
  private served(key: K): void {
    const run = cacheRuns.getStore(), origin = this.origins?.get(key);
    if (run && origin && origin !== run) run.used.add(origin);
  }
}

/** The installation fetcher's count of null answers for a reason that may not repeat (resolver-host.ts `WolvenKitFetcher.stats`). */
const transientFailures = (installation: Installation) => {
  const count = (installation.fetcher as { stats?: { transient?: unknown } } | undefined)?.stats?.transient;
  return typeof count === "number" ? count : 0;
};

/** Resolve the V through the cache: each distinct descriptor once per installation and set of morphs, in `resolveCharacter`'s order. */
async function resolveThrough(graph: ResourceGraph, input: CharacterInput, cco: Awaited<ReturnType<typeof loadMergedCco>>,
  cache: CharacterPreparationCache, overrides: ComponentOverrides = NO_OVERRIDES): Promise<{ resolved: ResolvedCharacter; reused: number }> {
  const morphKey = canonical([...input.morphs].map(morph => `${morph.region}|${morph.target}`).sort());
  // Worn items' overrides change the body's and arms' parts, never the head's (character-resolver.ts), so only those keys carry them.
  const worn = overridesKey(overrides);
  const keyOf = (descriptor: CharacterInput["appearances"][number]) =>
    `${input.bodyGender}|${descriptor.part}|${descriptor.option}|${descriptor.app.hash}|${descriptor.definition}|${morphKey}${descriptor.part === "head" || !worn ? "" : `|${worn}`}`;
  const unique = new Map<string, string[]>();
  for (const descriptor of input.appearances) { const key = keyOf(descriptor); unique.set(key, [...unique.get(key) ?? [], descriptor.group]); }
  const missing = input.appearances.filter(descriptor => !cache.appearances.has(keyOf(descriptor)));
  const fresh = await resolveCharacter(graph, { ...input, appearances: missing }, cco, overrides);
  // `resolveCharacter` resolves each distinct descriptor once, in first-seen order: the same order as these keys.
  const missingKeys = [...new Set(missing.map(keyOf))];
  const freshByKey = new Map(fresh.appearances.map((entry, index) => [missingKeys[index]!, entry]));
  for (const [key, entry] of freshByKey) cache.appearances.set(key, entry);
  if (cache.appearances.size > 4096) for (const key of [...cache.appearances.keys()].slice(0, 1024)) cache.appearances.delete(key);
  let reused = 0;
  const appearances = [...unique].flatMap(([key, groups]) => {
    const entry = freshByKey.get(key) ?? cache.appearances.get(key);
    if (!freshByKey.has(key)) reused++;
    return entry ? [{ ...entry, groups }] : [];
  });
  return { resolved: { ...fresh, appearances }, reused };
}

/** A layer the renderer blends in: a visible opacity (a layer at zero opacity changes nothing; knowledge/materials-and-shaders.md §4.6). */
const layerDraws = (opacity: number) => opacity > 0;

/** What reading and exporting fresh parts needs from its preparation (or prefetch). */
type GatherContext = {
  graph: ResourceGraph;
  cache: CharacterPreparationCache;
  exporter: GameAssetExporter;
  gameRoot: string;
  storeRoot: string;
  signal?: AbortSignal;
  log: (message: string) => void;
  /** Background work (a prefetch): WolvenKit runs at a lower priority. */
  lowPriority?: LowPriority;
};
/** Where each fresh part's geometry, textures and masks come from, and the archives WolvenKit failed on. */
type Gathered = { geometryAt: Map<PlannedComponent, Located>; textureAt: Map<string, Located>; maskAt: Map<string, Located>;
  toolFailures: Set<string>; toolLabel: string | undefined };

const cancelledError = () => new CharacterDetailError("character_cancelled", "Preparing your V's details was cancelled.");

/**
 * Export located resources into the preparation cache's maps: every archive's geometry, textures and masks together, in as few
 * WolvenKit launches as the exporter can make (`exportAll`: one, when the archives' requested resources don't collide), or a session
 * per archive and kind for an exporter without it. What is kept never points into an exporter's work folder: a partial geometry export
 * the exporter did not cache is kept in the content-addressed store.
 */
async function exportLocated(ctx: GatherContext, items: readonly { kind: ExportKind; at: Located }[], toolFailures: Set<string>): Promise<string | undefined> {
  const { cache, exporter, signal, log } = ctx;
  const into = (kind: ExportKind) => (kind === "geometry" ? cache.geometry : kind === "textures" ? cache.textures : cache.masks) as Map<string, unknown>;
  const groups = new Map<string, { archive: Located["archive"]; geometry: Set<string>; textures: Set<string>; masks: Set<string> }>();
  for (const { kind, at } of items) {
    if (into(kind).has(`${at.archive.id}|${at.depotPath.toLowerCase()}`)) continue;
    const group = groups.get(at.archive.id) ?? { archive: at.archive, geometry: new Set<string>(), textures: new Set<string>(), masks: new Set<string>() };
    group[kind].add(at.depotPath);
    groups.set(at.archive.id, group);
  }
  if (!groups.size) return undefined;
  const keep = (kind: ExportKind, archive: string, path: string, value: unknown) => {
    let kept = value;
    const geometry = value as { glb: string | null; complete: boolean };
    // A partial export an exporter did not cache may live in its session's work folder, which is removed: keep the GLB in the
    // content-addressed store, which outlives the session.
    if (kind === "geometry" && geometry.glb && !geometry.complete && existsSync(geometry.glb))
      kept = { ...geometry, glb: join(ctx.storeRoot, "files", store(ctx.storeRoot, geometry.glb, "glb").file) };
    into(kind).set(`${archive}|${path.toLowerCase()}`, kept);
  };
  const failed = (error: unknown, archives: readonly Located["archive"][]) => {
    if (!(error instanceof GameAssetExportError)) throw error;
    if (error.code === "cancelled" || signal?.aborted) throw cancelledError();
    if (error.code === "tool_missing" || error.code === "runtime_missing") throw new CharacterDetailError("character_tool_missing", TOOL_MISSING, error.message);
    for (const archive of archives) { toolFailures.add(archive.id); log(`WolvenKit could not export from ${archive.name}: ${error.message}`); }
  };
  const list = [...groups.values()];
  if (exporter.exportAll) {
    try {
      const answers = await exporter.exportAll(list.map(group => ({ source: archiveExportSource(group.archive.id, ctx.gameRoot),
        geometry: [...group.geometry], textures: [...group.textures], masks: [...group.masks] })), signal, { lowPriority: ctx.lowPriority });
      answers.forEach((answer, index) => {
        const archive = list[index]!.archive;
        if (answer.failed) { failed(answer.failed, [archive]); return; }
        for (const kind of ["geometry", "textures", "masks"] as const) for (const [path, value] of answer[kind]) keep(kind, archive.id, path, value);
      });
    } catch (error) { failed(error, list.map(group => group.archive)); }
    return exporter.tool?.label;
  }
  let label: string | undefined;
  for (const group of list) for (const kind of ["geometry", "textures", "masks"] as const) {
    if (!group[kind].size) continue;
    const session = exporter.open(archiveExportSource(group.archive.id, ctx.gameRoot), signal);
    label ??= session.tool.label;
    try { for (const [path, value] of await session[kind]([...group[kind]])) keep(kind, group.archive.id, path, value); }
    catch (error) { failed(error, [group.archive]); }
    finally { session.close(); }
    if (signal?.aborted) throw cancelledError();
  }
  return label;
}

/**
 * Read and export what fresh parts draw with (PREV-68: only what earlier preparations on this installation didn't). The reads a plan
 * implies (hair and skin profiles, gradients, layer setups, each texture's colour flag) are asked for together, so they share one
 * extraction batch, and the export of the parts' geometry, textures and masks runs alongside them. Only a layered chunk's own maps wait
 * for its layer setup and templates; they are exported and read together afterwards.
 */
async function gatherParts(ctx: GatherContext, fresh: readonly PlannedComponent[]): Promise<Gathered> {
  const { graph, cache, signal } = ctx;
  const toolFailures = new Set<string>();
  const geometryAt = new Map<PlannedComponent, Located>();
  for (const component of fresh) {
    const located = locate(graph, component.drawnFrom.ref);
    if (located) geometryAt.set(component, located);
  }
  const textureAt = new Map<string, Located>(), maskAt = new Map<string, Located>();
  for (const component of fresh) for (const material of component.materials) {
    for (const provenance of Object.values(material.textures)) {
      const located = locate(graph, provenance.ref);
      if (located) textureAt.set(refLabel(provenance.ref).toLowerCase(), located);
    }
    const mask = material.layered?.mask;
    const located = mask ? locate(graph, mask.ref) : null;
    if (mask && located) maskAt.set(refLabel(mask.ref).toLowerCase(), located);
  }
  const firstTextures = new Set(textureAt.keys());
  // A failure is held until the reads it runs beside have settled, so nothing is left running unobserved.
  const settle = <T>(work: Promise<T>) => work.then(value => ({ value }), (error: unknown) => ({ error }));
  const exportedFirst = settle(exportLocated(ctx, [...[...geometryAt.values()].map(at => ({ kind: "geometry" as const, at })),
    ...[...textureAt.values()].map(at => ({ kind: "textures" as const, at })), ...[...maskAt.values()].map(at => ({ kind: "masks" as const, at }))], toolFailures));

  const readOnce = async <T>(into: Map<string, T | null>, provenance: Provenance, kind: string, read: (root: JsonObject, loaded: NonNullable<Awaited<ReturnType<ResourceGraph["load"]>>>) => T | null) => {
    const key = refLabel(provenance.ref).toLowerCase();
    if (into.has(key)) return;
    const loaded = await graph.load(provenance.ref, kind);
    into.set(key, loaded ? read(loaded.root, loaded) : null);
  };
  const gamma = (keys: Iterable<string>) => [...keys].filter(key => !cache.gamma.has(key)).map(async key => {
    const loaded = await graph.load(refFromPath(key), "xbm");
    cache.gamma.set(key, textureIsGamma(loaded?.root));
  });
  // Layered chunks: the winning setup, then its templates (requested as the setup arrives, graph `PREFETCH`).
  const readLayered = async (chunk: PlannedChunk) => {
    if (!chunk.layered) return;
    const key = refLabel(chunk.layered.setup.ref).toLowerCase();
    if (!cache.setups.has(key)) {
      const loaded = await graph.load(chunk.layered.setup.ref, "mlsetup");
      const values = loaded ? readSetup(loaded.root) : null;
      cache.setups.set(key, values ? { values, source: { depotPath: refLabel(loaded!.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256) } } : null);
    }
    await Promise.all((cache.setups.get(key)?.values.layers ?? []).map(async layer => {
      if (!layer.template) return;
      const templateKey = refLabel(layer.template).toLowerCase();
      if (cache.layerTemplates.has(templateKey)) return;
      const loaded = await graph.load(layer.template, "mltemplate");
      const values = loaded ? readTemplate(loaded.root) : null;
      cache.layerTemplates.set(templateKey, values ? { values, source: { depotPath: refLabel(loaded!.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256) } } : null);
    }));
  };
  const reads: Promise<void>[] = [...gamma(firstTextures)];
  for (const component of fresh) for (const material of component.materials) {
    for (const provenance of Object.values(material.profiles)) reads.push(readOnce(cache.profiles, provenance, "hp", (root, loaded) => {
      const stops = hairProfileStops(root);
      return stops ? { depotPath: refLabel(provenance.ref), archive: loaded.provenance.archive, sha256: hexSha(loaded.provenance.extractedSha256), ...stops } : null;
    }));
    for (const provenance of Object.values(material.skinProfiles)) reads.push(readOnce(cache.skinProfiles, provenance, "sp", (root, loaded) => {
      const values = skinProfileValues(root);
      return values ? { depotPath: refLabel(provenance.ref), archive: loaded.provenance.archive, sha256: hexSha(loaded.provenance.extractedSha256), ...values } : null;
    }));
    for (const provenance of Object.values(material.gradients)) reads.push(readOnce(cache.gradients, provenance, "gradient", (root, loaded) => {
      const stops = gradientStops(root);
      return stops ? { depotPath: refLabel(provenance.ref), archive: loaded.provenance.archive, sha256: hexSha(loaded.provenance.extractedSha256), stops } : null;
    }));
    reads.push(readLayered(material));
  }
  const readsDone = await settle(Promise.all(reads));
  if (signal?.aborted) { await exportedFirst; throw cancelledError(); }
  // A layered chunk's maps and microblends, known once its setup and templates are read.
  const layered: Located[] = [];
  for (const component of fresh) for (const material of component.materials) {
    const setup = material.layered ? cache.setups.get(refLabel(material.layered.setup.ref).toLowerCase()) : null;
    for (const layer of setup?.values.layers ?? []) {
      if (!layerDraws(layer.opacity)) continue;
      const template = layer.template ? cache.layerTemplates.get(refLabel(layer.template).toLowerCase()) : null;
      for (const ref of [template?.values.textures.color, template?.values.textures.normal, template?.values.textures.roughness,
        template?.values.textures.metalness, layer.microblend]) {
        if (!ref?.path || !/\.xbm$/i.test(ref.path)) continue;
        const key = refLabel(ref).toLowerCase(), located = locate(graph, ref);
        if (!located || textureAt.has(key)) continue;
        textureAt.set(key, located);
        layered.push(located);
      }
    }
  }
  const later = [...textureAt.keys()].filter(key => !firstTextures.has(key));
  const [exportedLater, laterReads] = await Promise.all([
    settle(exportLocated(ctx, layered.map(at => ({ kind: "textures" as const, at })), toolFailures)), settle(Promise.all(gamma(later)))]);
  const first = await exportedFirst;
  for (const outcome of [first, exportedLater, readsDone, laterReads]) if ("error" in outcome) throw outcome.error;
  const toolLabel = ("value" in first ? first.value : undefined) ?? ("value" in exportedLater ? exportedLater.value : undefined);
  return { geometryAt, textureAt, maskAt, toolFailures, toolLabel };
}

/** Every export a plan's parts are served from, as the preparation cache holds them now: [kind, depot path, archive]. */
function planExports(graph: ResourceGraph, cache: CharacterPreparationCache, plan: CharacterPlan): [ExportKind, string, string][] {
  const out: [ExportKind, string, string][] = [];
  const add = (kind: ExportKind, ref: DepotRef) => {
    const at = locate(graph, ref);
    const into = kind === "geometry" ? cache.geometry : kind === "textures" ? cache.textures : cache.masks;
    if (at && into.has(`${at.archive.id}|${at.depotPath.toLowerCase()}`)) out.push([kind, at.depotPath, at.archive.id]);
  };
  for (const component of plan.components) {
    add("geometry", component.drawnFrom.ref);
    for (const material of component.materials) {
      for (const provenance of Object.values(material.textures)) add("textures", provenance.ref);
      if (material.layered?.mask) add("masks", material.layered.mask.ref);
      const setup = material.layered ? cache.setups.get(refLabel(material.layered.setup.ref).toLowerCase()) : null;
      for (const layer of setup?.values.layers ?? []) {
        if (!layerDraws(layer.opacity)) continue;
        const template = layer.template ? cache.layerTemplates.get(refLabel(layer.template).toLowerCase()) : null;
        for (const ref of [template?.values.textures.color, template?.values.textures.normal, template?.values.textures.roughness,
          template?.values.textures.metalness, layer.microblend]) if (ref?.path && /\.xbm$/i.test(ref.path)) add("textures", ref);
      }
    }
  }
  return out;
}
/** The merged creator resource's own files (read once per graph, so a later preparation's recording doesn't see them). */
const creatorReads = (cco: Awaited<ReturnType<typeof loadMergedCco>>): string[] =>
  [cco.base.ref.hash, ...cco.customs.map(custom => custom.provenance.ref.hash)];
/** WolvenKit's identity as the installation's fetcher caches by it (`WolvenKitFetcher.tool`). */
const fetcherTool = (installation: Installation) => (installation.fetcher as { tool?: string } | undefined)?.tool ?? "unknown";

export async function prepareCharacterDetails(options: PrepareCharacterOptions): Promise<CharacterDetailResult> {
  // What the preparation reads is recorded until it ends, however it ends; the cache attributes what it adds and uses to this run.
  const recordings: { end(): void }[] = [];
  const run = new CacheRun();
  try { return await withCacheRun(run, () => prepareOnce(options, graph => { const recording = graph.beginReads(); recordings.push(recording); return recording; }, run)); }
  finally { for (const recording of recordings) recording.end(); }
}
async function prepareOnce(options: PrepareCharacterOptions, beginReads: (graph: ResourceGraph) => { reads: Set<string> }, run: CacheRun): Promise<CharacterDetailResult> {
  const { request, signal } = options;
  const log = options.log ?? (() => {});
  const cache = options.cache ?? new CharacterPreparationCache();
  const started = performance.now(), timings: string[] = [];
  let lap = started;
  const time = (label: string) => { const now = performance.now(); timings.push(`${label} ${((now - lap) / 1000).toFixed(2)} s`); lap = now; };
  const total = CHARACTER_DETAIL_STEPS.length;
  const progress = (step: CharacterDetailStep) => {
    const index = CHARACTER_DETAIL_STEPS.findIndex(item => item.step === step);
    options.progress?.(step, index, total, CHARACTER_DETAIL_STEPS[index]!.label);
  };
  const cancelled = () => { if (signal?.aborted) throw new CharacterDetailError("character_cancelled", "Preparing your V's details was cancelled."); };

  progress("reading");
  // The shared, long-lived installation (installation-registry.ts), checked against the mod setup on every acquire. Everything the
  // cache holds came from one installation: another one (the setup changed) starts the cache afresh.
  const open = options.open ?? (await import("./installation-registry")).acquireInstallation;
  let installation: Installation;
  try { installation = await open({ ...options.route, cacheDir: options.resolverCache, log }); }
  catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).stack ?? String(error)); }
  // The registry hands out a fresh view object per acquire (its own graph over the shared archives); the opened archives (`depot`)
  // are what identify one installation, and a reopened one has new ones.
  cancelled();
  if (cache.installation && cache.installation.depot !== installation.depot) cache.reset();
  cache.installation = installation;
  const { graph, summary } = installation;
  // The rolling diagnostics window (docs/diagnostics.md): the request, what the installation looks like, the resolution and the outcome.
  const trace = options.trace ?? NO_TRACE;
  graph.trace = trace;
  trace.event("character", "prepare", { source: request.source, bodyGender: request.bodyGender, choices: request.choices ?? [],
    appearances: request.source === "save" ? request.appearances.length : 0, installation: summary });
  // What this preparation adds to the cache, and the fetcher's count of failures that may not repeat: if it grows, or WolvenKit fails
  // on an archive, the preparation is degraded and what it added is forgotten (PIPE-53).
  const transientBefore = transientFailures(installation);
  time("open");
  cancelled();

  progress("resolving");
  // The merged creator resource is memoised by the resolver per graph (character-resolver.ts `loadMergedCco`).
  let cco: Awaited<ReturnType<typeof loadMergedCco>>;
  // What this preparation reads, kept (with what it exports) so a later session knows the request is ready (choice-manifest.ts).
  const recording = beginReads(graph);
  try { cco = await loadMergedCco(graph, request.bodyGender); }
  catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).message); }
  for (const hash of creatorReads(cco)) run.reads.add(hash);
  // The V as stored (a save's descriptors) or the default V: what is shown when there are no choices, or they can't be interpreted.
  const plainV = (): CharacterInput => {
    if (request.source !== "default") return inputFromCharacterRequest(request);
    const derived = descriptorsFromUiState(cco.merged.cco, {});
    return { bodyGender: request.bodyGender, origin: "ui-state", appearances: derived.appearances, morphs: derived.morphs };
  };
  let input: CharacterInput, choicesNote: string | undefined, choicesFailed = false;
  if (request.choices?.length && options.derive) {
    // The creator choices a person set, interpreted from the merged resource just loaded (rule R5; the save's own descriptors where
    // nothing changed). Choices that can't be interpreted leave the V as it is, with a plain line, instead of failing it (PIPE-80).
    try { input = await options.derive(request, cco); }
    catch (error) {
      log(`The creator choices couldn't be interpreted; showing the V without them: ${(error as Error)?.stack ?? error}`);
      input = plainV(); choicesNote = CHOICES_LEFT_OUT; choicesFailed = true;
    }
  } else {
    if (request.choices?.length) log("Creator choices were sent without the creator catalogue; showing the V without them.");
    input = plainV();
  }
  cancelled();
  // What V wears first: the feet group and the items' overrides of the body follow from it. A body turned off (or a male one, which the
  // preview doesn't draw yet) is neither dressed nor resolved (PREV-108, PIPE-98).
  const scope = bodyScopeOf(request);
  const dressed = scope === "drawn" ? await dress(graph, request, options, log) : null;
  const clothing = dressed && !("failed" in dressed) ? dressed : null;
  cancelled();
  const bodyState = { feet: clothing?.feet ?? "flat" } as const;
  // Only what the preview can draw is resolved: the head, and the body parts its third-person consumers read.
  input = previewInput(input, bodyState, scope === "drawn");
  const { resolved, reused: reusedAppearances } = await resolveThrough(graph, input, cco, cache, clothing?.overrides);
  trace.event("character", "resolved", resolutionTrace(resolved), RESOLUTION_TRACE_OPTIONS);
  cancelled();
  const templates = [...resolved.appearances.flatMap(entry => entry.components), ...clothingComponents(clothing)].flatMap(component => component.materials
    .map(material => material.template).filter((template): template is Provenance => !!template));
  await loadTemplates(graph, templates, cache);
  const plan: CharacterPlan = planCharacterDetails(resolved, cco.merged.cco, cache.defaults, cache.identities, bodyState, dressed, scope);
  time("resolve and plan");
  cancelled();

  progress("exporting");
  const slots = new Map<DetailSlot, DetailSlotState>(plan.slots.map(slot => [slot.slot, { ...slot }]));
  // A slot is many independent parts (face details; a hair and its extra parts; a piercing style's parts): one that can't be read
  // leaves the others shown, and the slot is unavailable only when none of its parts could be served (decided after export).
  const partial = new Map<DetailSlot, "export" | "tool">();
  const failSlot = (slot: DetailSlot, why: "export" | "tool") => { partial.set(slot, partial.get(slot) === "tool" ? "tool" : why); };
  const unavailable = (slot: DetailSlot, why: "export" | "tool") => {
    const current = slots.get(slot)!;
    const { noun, not, pronoun } = SLOT_WORDS[slot];
    slots.set(slot, { slot, state: "unavailable", label: current.label, message: why === "tool"
      ? `WolvenKit couldn't read your V's ${noun} from your game files, so ${pronoun} ${not} shown.`
      : `XF Studio couldn't read your V's ${noun} from your game files, so ${pronoun} ${not} shown.` });
  };
  // A component whose plan is unchanged on this installation is served as it was (a tried choice changes only its own slot).
  const planKey = (component: PlannedComponent) => canonical(component);
  const fresh = [...plan.components, ...plan.censoredBody].filter(component => !cache.components.has(planKey(component)));
  const gathered = await gatherParts({ graph, cache, exporter: options.exporter, gameRoot: options.route.gameRoot, storeRoot: options.storeRoot, signal, log }, fresh);
  const { geometryAt, textureAt, maskAt, toolFailures } = gathered;
  const toolLabel = cache.toolLabel ?? gathered.toolLabel;
  if (toolLabel) cache.toolLabel = toolLabel;
  time(`read and export ${fresh.length} of ${plan.components.length} part(s)`);
  cancelled();
  // Textures larger than the preview is served are scaled now, off the event loop (PREV-107), so writing the record only looks them up.
  const scaled = await scaleTextures(cache, options.storeRoot, [...textureAt.values()], cancelled);

  progress("writing");
  const notes: string[] = [];
  const components: RenderComponent[] = [];
  /** Decoded texels of the distinct textures served so far, against the record's budget (PIPE-43). */
  const served = new Map<string, number>();
  let pixels = 0, overBudget = 0;
  const spend = (file: string, texels: number) => {
    if (served.has(file)) return true;
    if (pixels + texels > RECORD_LIMITS.decodedPixels) { overBudget++; return false; }
    served.set(file, texels); pixels += texels;
    return true;
  };
  /** One component's writing, with its notes and textures collected so an unchanged plan can be served again as it is. */
  let componentNotes: string[] = [], componentTextures = new Map<string, number>();
  const note = (line: string) => { componentNotes.push(line); };
  /** One exported texture as the record serves it: raw channels, the resource's own colour flag, and where it came from. */
  const serveTexture = (ref: DepotRef, parameter: string, extractedSha256?: string | null): { texture: RenderTexture } | { why: string } => {
    const key = refLabel(ref).toLowerCase(), at = textureAt.get(key) ?? locate(graph, ref) ?? undefined;
    const png = at ? cache.textures.get(`${at.archive.id}|${at.depotPath.toLowerCase()}`)?.png : undefined;
    if (!at || !png) return { why: at ? "not exported" : "not in any mounted archive" };
    // A texture larger than the preview is served (a body texture mod's 8K maps) is served halved until it fits; others as exported.
    const exported = pngFileSize(png);
    let stored: { file: string; sha256: string; size: { width: number; height: number } | null };
    if (exported && (exported.width > SERVED_TEXTURE_MAX || exported.height > SERVED_TEXTURE_MAX)) {
      const copy = scaled.get(png);
      if (!copy) return { why: "too large to prepare" };
      if ("why" in copy) return { why: `too large to prepare (${copy.why})` };
      note(`${refLabel(ref)}: ${exported.width}×${exported.height} in the game files; the preview uses it at ${copy.size.width}×${copy.size.height}.`);
      stored = copy;
    } else stored = store(options.storeRoot, png, "png");
    const size = stored.size;
    if (!size) return { why: "unreadable image" };
    if (!spend(stored.file, size.width * size.height)) return { why: "over the preview's texture budget" };
    componentTextures.set(stored.file, size.width * size.height);
    const gamma = cache.gamma.get(key);
    if (gamma === null || gamma === undefined) note(`${refLabel(ref)}: colour flag unreadable; treated as linear.`);
    return { texture: { file: stored.file, sha256: stored.sha256, depotPath: refLabel(ref), ...size, isGamma: !!gamma,
      sources: [{ depotPath: at.depotPath, archive: at.archive.name, provider: at.archive.provider, parameter,
        ...(hexSha(extractedSha256) ? { sha256: hexSha(extractedSha256)! } : {}) }] } };
  };
  /**
   * A layered chunk's stack for the record: every setup layer with its template's values, and for each layer that draws, its maps,
   * microblend and mask layer (raw greyscale, never colour-decoded). A map or mask that could not be read leaves that input out
   * with a note (the adapter uses the neutral value); a setup that could not be read leaves the chunk undrawn.
   */
  const layeredStack = (chunk: PlannedChunk, owner: string): RenderLayered | null => {
    if (!chunk.layered) return null;
    const setup = cache.setups.get(refLabel(chunk.layered.setup.ref).toLowerCase());
    if (!setup || !setup.values.layers.length) return null;
    const maskRef = chunk.layered.mask, maskAtArchive = maskRef ? maskAt.get(refLabel(maskRef.ref).toLowerCase()) ?? locate(graph, maskRef.ref) ?? undefined : undefined;
    const maskFiles = maskAtArchive ? cache.masks.get(`${maskAtArchive.archive.id}|${maskAtArchive.depotPath.toLowerCase()}`)?.layers ?? [] : [];
    if (maskRef && !maskFiles.length) note(`${owner} chunk ${chunk.chunk}: its layer mask ${refLabel(maskRef.ref)} could not be read; drawn without it.`);
    const missing = new Set<string>();
    const layers = setup.values.layers.map((layer, index): RenderLayer => {
      const template = layer.template ? cache.layerTemplates.get(refLabel(layer.template).toLowerCase()) ?? null : null;
      if (layer.template && !template) missing.add(refLabel(layer.template));
      const values = layerOverrides(layer, template?.values ?? null);
      const maps: Partial<Record<LayerTextureRole, RenderTexture>> = {};
      if (layerDraws(layer.opacity)) {
        const textures = template?.values.textures;
        for (const [role, ref] of [["color", textures?.color], ["normal", textures?.normal], ["roughness", textures?.roughness], ["metalness", textures?.metalness],
          ["microblend", layer.microblend]] as [LayerTextureRole, DepotRef | null | undefined][]) {
          if (!ref?.path || !/\.xbm$/i.test(ref.path)) continue;
          const texture = serveTexture(ref, `layer ${index} ${role}`);
          if ("texture" in texture) maps[role] = texture.texture; else missing.add(refLabel(ref));
        }
        const maskFile = maskFiles[index];
        if (maskFile && maskAtArchive) {
          const stored = store(options.storeRoot, maskFile, "png"), size = stored.size;
          if (size && spend(stored.file, size.width * size.height)) {
            componentTextures.set(stored.file, size.width * size.height);
            maps.mask = { file: stored.file, sha256: stored.sha256, depotPath: refLabel(maskRef!.ref), ...size, isGamma: false,
              sources: [{ depotPath: maskAtArchive.depotPath, archive: maskAtArchive.archive.name, provider: maskAtArchive.archive.provider,
                parameter: `mask layer ${index}`, ...(hexSha(maskRef!.extractedSha256) ? { sha256: hexSha(maskRef!.extractedSha256)! } : {}) }] };
          } else missing.add(`${refLabel(maskRef!.ref)} layer ${index}`);
        }
      }
      // CNames are unbounded; the record keeps each as provenance, cut to the record's name length.
      const names = Object.fromEntries(Object.entries(values.names).map(([key, name]) => [key, name.slice(0, CHOICE_NAME_MAX)])) as RenderLayer["names"];
      return { template: template?.source ?? (layer.template ? { depotPath: refLabel(layer.template), archive: null, sha256: null } : null),
        ...(layer.template && !template ? { templateUnreadable: true as const } : {}),
        opacity: layer.opacity, matTile: layer.matTile, tilingMultiplier: template?.values.tilingMultiplier ?? 1,
        offsetU: layer.offsetU, offsetV: layer.offsetV, mbTile: layer.mbTile, microblendContrast: layer.microblendContrast,
        microblendNormalStrength: layer.microblendNormalStrength, microblendOffsetU: layer.microblendOffsetU, microblendOffsetV: layer.microblendOffsetV,
        colorScale: values.colorScale, normalStrength: values.normalStrength, roughLevelsIn: values.roughLevelsIn, roughLevelsOut: values.roughLevelsOut,
        metalLevelsIn: values.metalLevelsIn, metalLevelsOut: values.metalLevelsOut,
        colorMaskLevelsIn: template?.values.colorMaskLevelsIn ?? [0, 1], colorMaskLevelsOut: template?.values.colorMaskLevelsOut ?? [0, 1],
        names, textures: maps };
    });
    if (missing.size) note(`${owner} chunk ${chunk.chunk}: ${[...missing].slice(0, 4).join(", ")}${missing.size > 4 ? ` and ${missing.size - 4} more` : ""} could not be read; those layer inputs use neutral values, and a layer without its template is left out.`);
    return { setup: setup.source, mask: maskRef ? { depotPath: refLabel(maskRef.ref), archive: maskAtArchive?.archive.name ?? null,
      sha256: hexSha(maskRef.extractedSha256), layers: maskFiles.length } : null, ratio: setup.values.ratio, useNormal: setup.values.useNormal, layers };
  };
  /**
   * One plain line naming a part that is left out and why. It feeds the record's notes (ahead of every informational note, so the cap
   * never cuts it), the slot's `part-unread` limit, and the diagnostics window's `prepared` event (PIPE-84).
   */
  const drops: string[] = [];
  const dropped = (component: PlannedComponent, why: string) => {
    const line = `Part ${component.component} of your V's ${SLOT_WORDS[component.slot].noun} isn't shown: ${why}`;
    drops.push(line);
    note(line);
  };
  /**
   * Write one planned component, or say why it can't be served (the slot's outcome is decided by the caller). Every path that leaves the
   * component out adds a `dropped` note.
   */
  const build = (component: PlannedComponent): RenderComponent | "tool" | "export" => {
    const located = geometryAt.get(component) ?? locate(graph, component.drawnFrom.ref) ?? undefined;
    const geometryKey = located ? `${located.archive.id}|${located.depotPath.toLowerCase()}` : "";
    const exported = located ? cache.geometry.get(geometryKey) : undefined;
    const shape = refLabel(component.drawnFrom.ref);
    // An export whose file has gone (cleared by hand, or a work folder removed) fails only this part, and is exported again next time.
    if (exported?.glb && !existsSync(exported.glb)) {
      cache.geometry.delete(geometryKey);
      dropped(component, `its exported shape (${shape}) was removed before it could be used; it is exported again next time.`);
      return "export";
    }
    if (!located) { dropped(component, `its shape (${shape}) isn't in any archive your game loads.`); return "export"; }
    if (!exported?.glb) {
      const tool = toolFailures.has(located.archive.id);
      dropped(component, tool ? `WolvenKit couldn't read ${located.archive.name}.`
        : `WolvenKit couldn't export its shape (${located.depotPath}) from ${located.archive.name}.`);
      return tool ? "tool" : "export";
    }
    if (exported.repair) note(`${component.component}: WolvenKit couldn't export its shape as it is, so it was exported from a repaired copy: ${exported.repair}.`);
    const materials: RenderChunkMaterial[] = [];
    for (const material of component.materials) {
      const chunkTextures: Record<string, RenderTexture> = {};
      const unread: { param: string; why?: string }[] = [];
      for (const [param, provenance] of Object.entries(material.textures)) {
        const texture = serveTexture(provenance.ref, param, provenance.extractedSha256);
        if ("why" in texture) { unread.push({ param, why: texture.why }); continue; }
        chunkTextures[param] = texture.texture;
      }
      let layered: RenderLayered | undefined;
      if (material.layered) {
        const built = layeredStack(material, component.component);
        // Without its stack the chunk is kept, and the layered adapter leaves it out with a limit code the presentation words.
        if (built) layered = built; else note(`${component.component} chunk ${material.chunk}: its layer setup ${refLabel(material.layered.setup.ref)} could not be read.`);
      }
      const chunkProfiles: Record<string, RenderProfile> = {};
      for (const [param, provenance] of Object.entries(material.profiles)) {
        const profile = cache.profiles.get(refLabel(provenance.ref).toLowerCase());
        if (profile) chunkProfiles[param] = profile; else unread.push({ param });
      }
      const chunkSkinProfiles: Record<string, RenderSkinProfile> = {};
      for (const [param, provenance] of Object.entries(material.skinProfiles)) {
        const profile = cache.skinProfiles.get(refLabel(provenance.ref).toLowerCase());
        if (profile) chunkSkinProfiles[param] = profile; else unread.push({ param });
      }
      const chunkGradients: Record<string, RenderGradient> = {};
      for (const [param, provenance] of Object.entries(material.gradients)) {
        const gradient = cache.gradients.get(refLabel(provenance.ref).toLowerCase());
        if (gradient) chunkGradients[param] = gradient; else unread.push({ param });
      }
      // A chunk missing an input its adapter can't draw without is left out rather than drawn wrongly. An optional input
      // (the adapter falls back to the template's neutral value) or one recorded for a later adapter only earns a note.
      const inputs = renderTemplate(material.template, material.templateName);
      const required = new Set(inputs ? templateRequired(inputs, decalFamilySlot(component.slot)) : unread.map(entry => entry.param));
      const words = (entries: typeof unread) => entries.map(entry => entry.why ? `${entry.param} (${entry.why})` : entry.param).join(", ");
      const blocking = unread.filter(entry => required.has(entry.param)), optional = unread.filter(entry => !required.has(entry.param));
      if (blocking.length) {
        note(`${component.component} chunk ${material.chunk}: ${words(unread)} could not be read; the chunk is not drawn.`);
        continue;
      }
      if (optional.length) note(`${component.component} chunk ${material.chunk}: ${words(optional)} could not be read; drawn without ${optional.length > 1 ? "them" : "it"}.`);
      materials.push({ chunk: material.chunk, name: material.name.slice(0, 255), template: material.template, templateName: material.templateName,
        materialPriority: material.materialPriority, scalars: material.scalars,
        colours: material.colours, textures: chunkTextures, profiles: chunkProfiles, skinProfiles: chunkSkinProfiles, gradients: chunkGradients,
        ...(layered ? { layered } : {}) });
    }
    // Placeholder chunks alone draw nothing: the component needs one chunk the renderer really draws. A face detail made only of
    // decal templates the preview can't draw yet is kept, hidden, so the renderer reports it (limit `decal-template`).
    if (!materials.length) {
      dropped(component, `none of its ${component.materials.length} chunk(s) could be drawn, because an input they need couldn't be read.`);
      return "export";
    }
    if (!decalFamilySlot(component.slot) && !materials.some(material => !renderTemplate(material.template, material.templateName)?.placeholder)) {
      dropped(component, "its chunks use only materials the preview can't draw yet.");
      return "export";
    }
    const glb = storeChunkGeometry(options.storeRoot, exported.glb, materials.map(material => material.chunk));
    if (!glb.trimmed) note(`${component.component}: the exported geometry is served whole.`);
    if (component.skippedChunks) note(`${component.component}: ${component.skippedChunks} chunk(s) use materials the preview doesn't draw yet.`);
    const hash = component.drawnFrom.ref.hash;
    // Two choices can draw the same mesh (face cyberware reuses the freckle mesh), so the option is part of the identity.
    return { id: `${component.slot}:${component.option}:${component.component}:${hash}`, slot: component.slot, option: component.option,
      definition: component.definition, component: component.component,
      geometry: { file: glb.file, sha256: glb.sha256, depotPath: located.depotPath, depotHash: hash, morphTargets: component.morphTargets,
        sources: [{ depotPath: located.depotPath, archive: located.archive.name, provider: located.archive.provider,
          ...(hexSha(component.drawnFrom.extractedSha256) ? { sha256: hexSha(component.drawnFrom.extractedSha256)! } : {}) }] },
      renderChunks: component.renderChunks, chunks: materials.map(material => material.chunk), materials,
      ...(component.morphTexture ? { morphTexture: recordMorphTexture(component.morphTexture)! } : {}),
      ...(component.morphs ? { morphs: component.morphs } : {}), ...(component.garment ? { garment: component.garment } : {}),
      ...(component.censor ? { censor: component.censor } : {}) };
  };
  let reusedComponents = 0;
  /** Serve one planned component (as before when its plan is unchanged), or say why it can't be (null). */
  const serve = (component: PlannedComponent): RenderComponent | null => {
    const key = planKey(component), known = cache.components.get(key);
    // An unchanged plan on this installation is served as before, while its textures still fit the record's budget.
    if (known && [...known.textures].every(([file, texels]) => spend(file, texels))) {
      notes.push(...known.notes); reusedComponents++;
      return known.component;
    }
    componentNotes = []; componentTextures = new Map();
    let built: ReturnType<typeof build>;
    // One part that can't be built leaves only its slot unshown; it never costs the V's other details.
    try { built = build(component); }
    catch (error) {
      log(`${component.component} could not be served: ${(error as Error)?.stack ?? error}`);
      dropped(component, `it couldn't be prepared (${String((error as Error)?.message ?? error).slice(0, 160)}).`);
      built = "export";
    }
    notes.push(...componentNotes);
    if (typeof built === "string") { failSlot(component.slot, built); return null; }
    cache.components.set(key, { component: built, notes: componentNotes, textures: componentTextures });
    return built;
  };
  // Fail closed (PIPE-97): the underwear covers are served first, so the texture budget never leaves one out while the parts it covers
  // are served; if one can't be served, the covered skin is replaced by the game's censored skin, and without that the body isn't shown.
  const coverParts = new Map(plan.components.filter(component => component.censor === "cover").map(component => [component, serve(component)] as const));
  const coversServed = [...coverParts.values()].every(item => !!item);
  const firstCovered = plan.components.find(component => component.censor === "covered");
  const toServe = coversServed || !firstCovered ? plan.components
    : plan.components.flatMap(component => component === firstCovered ? plan.censoredBody : component.censor === "covered" ? [] : [component]);
  const censoredServed = new Set<RenderComponent>();
  for (const component of toServe) {
    const item = coverParts.has(component) ? coverParts.get(component)! : serve(component);
    if (!item) continue;
    components.push(item);
    if (plan.censoredBody.includes(component)) censoredServed.add(item);
  }
  const bodyWithdrawn = !coversServed && !!firstCovered && !censoredServed.size;
  if (bodyWithdrawn) for (let i = components.length - 1; i >= 0; i--) if (components[i]!.slot === "body") components.splice(i, 1);
  if (cache.components.size > 2048) for (const key of [...cache.components.keys()].slice(0, 512)) cache.components.delete(key);
  if (overBudget) notes.push(`${overBudget} texture(s) are over what the preview can load for one V, so the parts that need them are drawn without them.`);
  for (const [slot, why] of partial) {
    const current = slots.get(slot)!, { noun, pronoun } = SLOT_WORDS[slot];
    const all = pronoun === "it" ? "not all of it is" : "not all of them are";
    // Shown in part: the page words the `part-unread` code, so a part left out is never silent (PIPE-84).
    if (components.some(item => item.slot === slot))
      slots.set(slot, { ...current, message: `Some of your V's ${noun} couldn't be read from your game files, so ${all} shown.`,
        limits: [...new Set([...(current.limits ?? []), "part-unread" as const])] });
    else unavailable(slot, why);
  }
  // A slot whose components all failed is unavailable; one with some drawn stays shown.
  for (const [slot, state] of slots) if (state.state === "shown" && !components.some(item => item.slot === slot)) unavailable(slot, "export");
  if (bodyWithdrawn) slots.set("body", { slot: "body", state: "unavailable", label: slots.get("body")!.label, message: UNCOVERED_BODY });
  else if (!coversServed && censoredServed.size) slots.set("body", { ...slots.get("body")!, message: CENSORED_BODY });
  if (summary.scanGaps.length) notes.push("Some installed mod files could not be read; the resolved details may differ from the game.");
  const body = {
    schema: CHARACTER_DETAIL_SCHEMA, detail: "character" as const, origin: "game-files" as const,
    character: { source: request.source, bodyGender: request.bodyGender },
    provenance: { label: `Your ${summary.route === "mo2" ? "Mod Organizer 2 profile" : "game"}'s installed files`,
      notes: recordNotes(drops, notes), ...(toolLabel ? { tool: toolLabel } : {}) },
    components, slots: [...slots.values()],
  };
  // What is written is what the browser's reader makes of it (PIPE-40): one shared rule set, and a part that breaks it is left out
  // with a note here, not discovered by the page.
  const { identity: _pending, ...checked } = parseCharacterDetail({ ...body, identity: "pending" });
  const identity = sha256(canonical(checked));
  const record: CharacterDetail = { ...checked, identity };
  const recordName = `${identity}.json`;
  mkdirSync(join(options.storeRoot, "records"), { recursive: true, mode: 0o700 });
  const target = join(options.storeRoot, "records", recordName);
  if (!existsSync(target)) {
    const staging = `${target}.${process.pid}.tmp`;
    writeFileSync(staging, JSON.stringify(record), { mode: 0o600 });
    renameSync(staging, target);
  }
  time("write");
  const degraded = choicesFailed || toolFailures.size > 0 || transientFailures(installation) > transientBefore;
  if (degraded) {
    cache.forget(run);
    log("Some files couldn't be read this time (WolvenKit or a resource failed in a way that may not repeat); the V will be prepared again next time.");
  }
  // What it read, and what the entries it was served from memory were read from (PREV-103).
  for (const hash of recording.reads) run.reads.add(hash);
  if (!degraded && options.manifests) writeChoiceManifest(options.manifests.dir, options.manifests.key(request),
    manifestOf(graph, [...run.reads, ...run.inherited()], planExports(graph, cache, plan), fetcherTool(installation), xlIdentity(installation)));
  log(`Prepared ${request.choices?.length ? `the V with ${request.choices.length} creator choice(s)` : "the V"} in ${((performance.now() - started) / 1000).toFixed(2)} s: ${timings.join(", ")}; ` +
    `${reusedAppearances} appearance(s) and ${reusedComponents} of ${plan.components.length} part(s) reused.`);
  trace.event("character", "prepared", { record: recordName, degraded, note: choicesNote ?? null, timings, slots: record.slots,
    dropped: [...new Set(drops)].slice(0, 50),
    components: record.components.map(item => ({ slot: item.slot, option: item.option, definition: item.definition, component: item.component,
      geometry: item.geometry.depotPath, sources: item.geometry.sources.map(source => ({ path: source.depotPath, archive: source.archive ?? null, provider: source.provider ?? null })), chunks: item.chunks })),
    loadErrors: [...graph.loadErrors].slice(0, 50), ambiguities: [...graph.observedAmbiguities.values()].slice(0, 50) });
  return { record, recordFile: recordName, degraded, ...(choicesNote ? { note: choicesNote } : {}) };
}

/** The components of the garments a V draws. */
const clothingComponents = (clothing: ResolvedClothing | null) => clothing?.garments.flatMap(garment => garment.status === "drawn" ? garment.components : []) ?? [];

/**
 * What a request's V wears (clothing-resolver.ts), or null without clothing. The item records come from the installation's TweakDB and the
 * cooked visual-tag preset (clothing-host.ts). A failure leaves V without clothes, with a log line and a plain outcome (PIPE-100), rather
 * than failing the V; nothing about it is kept, so the next preparation tries again.
 */
async function dress(graph: ResourceGraph, request: CharacterRequest, options: { route: CharacterRoute; resolverCache: string; nativeDecodeWorker?: string },
  log: (message: string) => void):
  Promise<ResolvedClothing | ClothingFailure | null> {
  if (!request.clothing) return null;
  try {
    const ports = await clothingPorts(graph, options.route.gameRoot, options.resolverCache, log, { decodeWorker: options.nativeDecodeWorker });
    return await resolveClothing(graph, { ...request.clothing, bodyGender: request.bodyGender }, ports);
  } catch (error) {
    log(`V's clothes couldn't be resolved; showing V without them: ${(error as Error)?.stack ?? error}`);
    return { failed: "unresolved" };
  }
}

/** Whether a request's body is drawn: off by the viewer's Body switch, or a male V's (not drawn yet), else drawn. */
export const bodyScopeOf = (request: CharacterRequest): BodyScope => request.body === false ? "hidden" : request.bodyGender === "male" ? "male" : "drawn";
/** A body whose covered skin was replaced by the game's censored skin because its underwear couldn't be served (PIPE-97). */
export const CENSORED_BODY = "The underwear the game draws on your V couldn't be prepared, so the body is shown in the game's censored look.";

/** The most notes a record's provenance carries. */
export const RECORD_NOTE_CAP = 32;
/** A record's notes: each once, drop notes first, so the cap cuts informational notes and never a part left out (PIPE-84). */
export function recordNotes(drops: readonly string[], notes: readonly string[]): string[] {
  return [...new Set([...drops, ...notes])].slice(0, RECORD_NOTE_CAP).map(line => line.slice(0, 500));
}

export type WarmOptions = Omit<PrepareCharacterOptions, "request" | "progress"> & {
  /** The requests to make ready (one body gender): a row's choices, each set on the same V. */
  requests: readonly CharacterRequest[];
};
/** Per request: whether it is ready now (a later preparation of it needs no WolvenKit), or failed in a way that may not repeat. */
export type WarmOutcome = { ready: boolean; note?: string };

/**
 * Make several requests ready without writing their records (the Character panel's prefetch, choice-prefetch.ts): everything a
 * preparation of each would read or export is read and exported now, together. Every level of every request's resource chain is read in
 * one extraction batch (the requests resolve side by side on the shared graph, whose reads share batches), and every part they draw is
 * exported in one WolvenKit launch where the archives allow it. The shared preparation cache keeps what was resolved and exported, so a
 * person's click on one of them only plans and writes. A request whose preparation met a failure that may not repeat is not ready, and
 * what the batch added is forgotten (PIPE-53); the others' manifests are kept (`manifests`).
 */
export async function warmCharacters(options: WarmOptions): Promise<WarmOutcome[]> {
  const run = new CacheRun();
  return withCacheRun(run, () => warmOnce(options, run));
}
async function warmOnce(options: WarmOptions, run: CacheRun): Promise<WarmOutcome[]> {
  const { requests, signal } = options;
  const log = options.log ?? (() => {});
  const cache = options.cache ?? new CharacterPreparationCache();
  if (!requests.length) return [];
  const cancelled = () => { if (signal?.aborted) throw cancelledError(); };
  const open = options.open ?? (await import("./installation-registry")).acquireInstallation;
  let installation: Installation;
  try { installation = await open({ ...options.route, cacheDir: options.resolverCache, log }); }
  catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).stack ?? String(error)); }
  // A batch stopped while the installation opened must not start the shared cache afresh under a person's own change (PREV-102).
  cancelled();
  if (cache.installation && cache.installation.depot !== installation.depot) cache.reset();
  cache.installation = installation;
  const { graph } = installation;
  const transientBefore = transientFailures(installation);
  const recording = graph.beginReads();
  try {
    const cco = await loadMergedCco(graph, requests[0]!.bodyGender);
    for (const hash of creatorReads(cco)) run.reads.add(hash);
    cancelled();
    const inputs = await Promise.all(requests.map(async request => {
      if (request.choices?.length && options.derive) {
        try { return await options.derive(request, cco); } catch { return null; }
      }
      if (request.source !== "default") return inputFromCharacterRequest(request);
      const derived = descriptorsFromUiState(cco.merged.cco, {});
      return { bodyGender: request.bodyGender, origin: "ui-state" as const, appearances: derived.appearances, morphs: derived.morphs };
    }));
    // Every request resolves at once, so each level of their chains is one extraction batch.
    const clothes = await Promise.all(requests.map(request => bodyScopeOf(request) === "drawn" ? dress(graph, request, options, log) : null));
    cancelled();
    const scopes = requests.map(bodyScopeOf);
    const worn = clothes.map(entry => entry && !("failed" in entry) ? entry : null);
    const resolved = await Promise.all(inputs.map((input, index) => input ? resolveThrough(graph, previewInput(input, { feet: worn[index]?.feet ?? "flat" },
      scopes[index] === "drawn"), cco, cache, worn[index]?.overrides).then(result => result.resolved) : null));
    cancelled();
    await loadTemplates(graph, resolved.flatMap((entry, index) => entry ? [...entry.appearances.flatMap(appearance => appearance.components), ...clothingComponents(worn[index] ?? null)]
      .flatMap(component => component.materials.map(material => material.template).filter((template): template is Provenance => !!template)) : []), cache);
    const plans = resolved.map((entry, index) => entry ? planCharacterDetails(entry, cco.merged.cco, cache.defaults, cache.identities,
      { feet: worn[index]?.feet ?? "flat" }, clothes[index] ?? null, scopes[index]) : null);
    cancelled();
    const fresh = new Map<string, PlannedComponent>();
    for (const plan of plans) for (const component of [...plan?.components ?? [], ...plan?.censoredBody ?? []]) {
      const key = canonical(component);
      if (!cache.components.has(key)) fresh.set(key, component);
    }
    const gathered = await gatherParts({ graph, cache, exporter: options.exporter, gameRoot: options.route.gameRoot, storeRoot: options.storeRoot,
      signal, log, lowPriority: options.lowPriority }, [...fresh.values()]);
    // Stopped while its reads finished (a person's own change started): nothing is forgotten and no manifest is written (PREV-102).
    cancelled();
    if (gathered.toolLabel) cache.toolLabel ??= gathered.toolLabel;
    const degraded = gathered.toolFailures.size > 0 || transientFailures(installation) > transientBefore;
    if (degraded) {
      cache.forget(run);
      log("Some files couldn't be read while preparing choices ahead (WolvenKit or a resource failed in a way that may not repeat); they are tried again later.");
    }
    for (const hash of recording.reads) run.reads.add(hash);
    const reads = [...run.reads, ...run.inherited()], tool = fetcherTool(installation), xl = xlIdentity(installation);
    return requests.map((request, index) => {
      const plan = plans[index];
      if (!plan) return { ready: false, note: "The choice couldn't be interpreted." };
      if (degraded) return { ready: false, note: "Some files couldn't be read this time." };
      // The batch's reads together: a change to any of them makes each of its choices checked again (reading only what changed).
      if (options.manifests) writeChoiceManifest(options.manifests.dir, options.manifests.key(request), manifestOf(graph, reads, planExports(graph, cache, plan), tool, xl));
      return { ready: true };
    });
  } finally { recording.end(); }
}
