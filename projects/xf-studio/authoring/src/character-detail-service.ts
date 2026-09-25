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
 * Preparations on one installation share a `CharacterPreparationCache` (the host keeps it per installation fingerprint): a tried choice on
 * the same V re-plans from what the V's own preparation already resolved, read and exported, and resolves and exports only what the
 * choice changes (PREV-68). The written record is what the browser's own reader makes of it (`parseCharacterDetail`), so the host and
 * the page share one rule set (PIPE-40).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { descriptorsFromUiState } from "./cco-model";
import { applyChoiceOverride, planCharacterDetails, recordMorphTexture, SLOT_WORDS, type CharacterPlan, type PlannedChunk, type PlannedComponent } from "./character-detail-plan";
import { inputFromCharacterRequest, type CharacterRequest } from "./character-detail-request";
import { loadMergedCco, resolveCharacter, type CharacterInput, type ResolvedAppearance, type ResolvedCharacter, type ResolvedParam } from "./character-resolver";
import { refFromPath, refLabel, type DepotRef } from "./depot-path";
import { archiveExportSource, GameAssetExportError, type GameAssetExporter } from "./game-asset-export";
import { keepGlbMeshes } from "./glb";
import { layerOverrides, readSetup, readTemplate, type SetupValues, type TemplateValues } from "./layered-setup";
import { templateDefaults } from "./material-template";
import { asArray, cname, isObject, type JsonObject, type MaterialParamValue } from "./red-json";
import { CHARACTER_DETAIL_SCHEMA, CHOICE_NAME_MAX, chunkOfMesh, parseCharacterDetail, RECORD_LIMITS, type CharacterDetail, type DetailSlot, type DetailSlotState, type LayerTextureRole, type RenderChunkMaterial,
  type RenderComponent, type RenderGradient, type RenderLayer, type RenderLayered, type RenderOverride, type RenderProfile, type RenderProfileStop, type RenderRgba,
  type RenderSkinProfile, type RenderSourceRef, type RenderTexture } from "./render-detail";
import { renderTemplate, templateRequired } from "./render-templates";
import type { Installation, InstallationOptions } from "./resolver-host";
import type { Provenance, ResourceGraph } from "./resource-graph";

export type CharacterDetailStep = "reading" | "resolving" | "exporting" | "writing";
export const CHARACTER_DETAIL_STEPS: readonly { step: CharacterDetailStep; label: string }[] = [
  { step: "reading", label: "Reading your installed mods" },
  { step: "resolving", label: "Working out your V's skin, face details, eyes, brows, lashes, hair and piercings" },
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
  /** Test seam: open an installation (defaults to the resolver host). */
  open?: (options: InstallationOptions) => Installation;
  signal?: AbortSignal;
  progress?: (step: CharacterDetailStep, index: number, total: number, label: string) => void;
  log?: (message: string) => void;
  /**
   * What earlier preparations on the same installation made (the host's, per installation fingerprint). Without one, everything is
   * resolved, read and exported afresh, and the installation is opened with `open`.
   */
  cache?: CharacterPreparationCache;
};
export type CharacterDetailResult = { record: CharacterDetail; recordFile: string };

export class CharacterDetailError extends Error {
  constructor(readonly code: "character_cancelled" | "character_tool_missing" | "character_unreadable" | "character_failed",
    message: string, readonly detail = "") { super(message); }
}
const UNREADABLE = "XF Studio couldn't read your game's character-creator files, so your V's own skin, face details, eyes, brows, lashes, hair and piercings aren't shown. The head still works.";
const TOOL_MISSING = "WolvenKit isn't ready, so your V's own skin, face details, eyes, brows, lashes, hair and piercings aren't shown yet. The head still works.";

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
  for (const template of templates) {
    const key = refLabel(template.ref).toLowerCase();
    if (cache.identities.has(key) || !/\.mt$/i.test(key)) continue;
    const loaded = await graph.load(template.ref, "mt");
    const identity = templateIdentity(loaded?.root);
    cache.identities.set(key, identity);
    if (!renderTemplate(key, identity.name)) continue;
    cache.defaults.set(key, loaded ? templateDefaults(loaded.root).map(([name, value]) => ({ name, kind: value.kind, value: paramText(value),
      setBy: `${refLabel(template.ref)} (template default)`,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })) : []);
  }
}

type Located = { depotPath: string; archive: { id: string; name: string; provider: string } };
function locate(graph: ResourceGraph, ref: DepotRef): Located | null {
  const { entry, lookup } = graph.locate(ref);
  const path = entry.path ?? graph.named(entry).path;
  if (!lookup.winner || !path) return null;
  return { depotPath: path, archive: { id: lookup.winner.id, name: lookup.winner.name, provider: lookup.winner.providerName } };
}

/** Group depot paths by winning archive so each archive is read by one tool call per kind. */
function byArchive(items: readonly Located[]) {
  const groups = new Map<string, { archive: Located["archive"]; paths: Set<string> }>();
  for (const item of items) {
    const group = groups.get(item.archive.id) ?? { archive: item.archive, paths: new Set<string>() };
    group.paths.add(item.depotPath);
    groups.set(item.archive.id, group);
  }
  return [...groups.values()];
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

/** A served component as the writing step made it, with the notes it earned and the texels its distinct textures take. */
type BuiltComponent = { component: RenderComponent; notes: string[]; textures: Map<string, number> };
/**
 * What preparations on one installation share (PREV-68). A host keeps one per installation fingerprint (the launch route, the mod lists'
 * stamps and WolvenKit's identity; character-detail-host.ts) and passes it to every preparation on that installation, so a tried choice
 * on the same V re-plans from the V it already resolved: the installation is opened once, each appearance descriptor is resolved once,
 * templates, setups, profiles and gradients are read once, each archive file is exported once, and a component whose plan is unchanged
 * is served exactly as before. Only what the tried choice changes is resolved and exported. Nothing here is written to disk; the
 * exporter's own cache and the content-addressed store already are. Entries are only added once complete, so a cancelled preparation
 * leaves nothing half-made.
 */
export class CharacterPreparationCache {
  /** The opened installation (resolver-host.ts), reused while the fingerprint holds. */
  installation: Installation | null = null;
  readonly cco = new Map<string, Awaited<ReturnType<typeof loadMergedCco>>>();
  /** Resolved appearances by descriptor (part, option, app, definition) and the V's morphs. */
  readonly appearances = new Map<string, ResolvedAppearance>();
  readonly defaults = new Map<string, ResolvedParam[]>();
  readonly identities = new Map<string, { name: string | null; priority: string | null }>();
  readonly profiles = new Map<string, RenderProfile | null>();
  readonly skinProfiles = new Map<string, RenderSkinProfile | null>();
  readonly gradients = new Map<string, RenderGradient | null>();
  readonly setups = new Map<string, { values: SetupValues; source: RenderSourceRef } | null>();
  readonly layerTemplates = new Map<string, { values: TemplateValues; source: RenderSourceRef } | null>();
  readonly gamma = new Map<string, boolean | null>();
  /** Exports by `archive id|depot path` (lower case). A tool failure is never kept, so the next preparation tries again. */
  readonly geometry = new Map<string, { glb: string | null; complete: boolean }>();
  readonly textures = new Map<string, { png: string }>();
  readonly masks = new Map<string, { layers: string[] }>();
  /** Served components by their plan (canonical JSON), within this installation. */
  readonly components = new Map<string, BuiltComponent>();
  /** The export tool that read these files (the record names it even when nothing new is exported). */
  toolLabel: string | undefined;
}

/** Resolve the V through the cache: each distinct descriptor once per installation and set of morphs, in `resolveCharacter`'s order. */
async function resolveThrough(graph: ResourceGraph, input: CharacterInput, cco: Awaited<ReturnType<typeof loadMergedCco>>,
  cache: CharacterPreparationCache): Promise<{ resolved: ResolvedCharacter; reused: number }> {
  const morphKey = canonical([...input.morphs].map(morph => `${morph.region}|${morph.target}`).sort());
  const keyOf = (descriptor: CharacterInput["appearances"][number]) =>
    `${input.bodyGender}|${descriptor.part}|${descriptor.option}|${descriptor.app.hash}|${descriptor.definition}|${morphKey}`;
  const unique = new Map<string, string[]>();
  for (const descriptor of input.appearances) { const key = keyOf(descriptor); unique.set(key, [...unique.get(key) ?? [], descriptor.group]); }
  const missing = input.appearances.filter(descriptor => !cache.appearances.has(keyOf(descriptor)));
  const fresh = await resolveCharacter(graph, { ...input, appearances: missing }, cco);
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

export async function prepareCharacterDetails(options: PrepareCharacterOptions): Promise<CharacterDetailResult> {
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
  if (!cache.installation) {
    const open = options.open ?? (await import("./resolver-host")).openInstallation;
    try { cache.installation = open({ ...options.route, cacheDir: options.resolverCache, log }); }
    catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).stack ?? String(error)); }
  }
  const { graph, summary } = cache.installation;
  time("open");
  cancelled();

  progress("resolving");
  let cco = cache.cco.get(request.bodyGender);
  if (!cco) {
    try { cco = await loadMergedCco(graph, request.bodyGender); }
    catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).message); }
    cache.cco.set(request.bodyGender, cco);
  }
  let input: CharacterInput;
  if (request.source === "default") {
    const derived = descriptorsFromUiState(cco.merged.cco, {});
    input = { bodyGender: request.bodyGender, origin: "ui-state", appearances: derived.appearances, morphs: derived.morphs };
  } else input = inputFromCharacterRequest(request);
  // A choice the viewer tries (a piercing style) replaces the V's own on its slot; one the creator doesn't offer is ignored.
  let override: RenderOverride | undefined;
  if (request.override) {
    const appearances = applyChoiceOverride(input.appearances, cco.merged.cco, request.override);
    if (appearances) { input = { ...input, appearances }; override = { ...request.override }; }
    else log(`The tried ${request.override.slot} choice ${request.override.choice} (${request.override.definition}) is not offered; showing the V's own.`);
  }
  const { resolved, reused: reusedAppearances } = await resolveThrough(graph, input, cco, cache);
  cancelled();
  const templates = resolved.appearances.flatMap(entry => entry.components.flatMap(component => component.materials
    .map(material => material.template).filter((template): template is Provenance => !!template)));
  await loadTemplates(graph, templates, cache);
  const plan: CharacterPlan = planCharacterDetails(resolved, cco.merged.cco, cache.defaults, cache.identities);
  time("resolve and plan");
  cancelled();

  progress("exporting");
  const slots = new Map<DetailSlot, DetailSlotState>(plan.slots.map(slot => [slot.slot, { ...slot }]));
  // Face details are many independent parts: one that can't be read leaves the others shown (decided after export).
  const partial = new Map<DetailSlot, "export" | "tool">();
  const failSlot = (slot: DetailSlot, why: "export" | "tool") => {
    if (slot === "face") { partial.set(slot, partial.get(slot) === "tool" ? "tool" : why); return; }
    unavailable(slot, why);
  };
  const unavailable = (slot: DetailSlot, why: "export" | "tool") => {
    const current = slots.get(slot)!;
    const { noun, not, pronoun } = SLOT_WORDS[slot];
    slots.set(slot, { slot, state: "unavailable", label: current.label, message: why === "tool"
      ? `WolvenKit couldn't read your V's ${noun} from your game files, so ${pronoun} ${not} shown.`
      : `XF Studio couldn't read your V's ${noun} from your game files, so ${pronoun} ${not} shown.` });
  };
  // A component whose plan is unchanged on this installation is served as it was (a tried choice changes only its own slot).
  const planKey = (component: PlannedComponent) => canonical(component);
  const fresh = plan.components.filter(component => !cache.components.has(planKey(component)));
  const gameRoot = options.route.gameRoot;
  const toolFailures = new Set<string>();
  let toolLabel: string | undefined = cache.toolLabel;
  const exportGroup = async <T>(kind: "geometry" | "textures" | "masks", group: ReturnType<typeof byArchive>[number], into: Map<string, T>): Promise<void> => {
    const known = (path: string) => into.has(`${group.archive.id}|${path.toLowerCase()}`);
    const paths = [...group.paths].filter(path => !known(path));
    if (!paths.length) return;
    const session = options.exporter.open(archiveExportSource(group.archive.id, gameRoot), signal);
    toolLabel ??= session.tool.label;
    cache.toolLabel = toolLabel;
    try {
      const exported = await session[kind](paths) as unknown as Map<string, T>;
      for (const [path, value] of exported) into.set(`${group.archive.id}|${path.toLowerCase()}`, value);
    } catch (error) {
      if (error instanceof GameAssetExportError) {
        if (error.code === "cancelled" || signal?.aborted) throw new CharacterDetailError("character_cancelled", "Preparing your V's details was cancelled.");
        if (error.code === "tool_missing" || error.code === "runtime_missing") throw new CharacterDetailError("character_tool_missing", TOOL_MISSING, error.message);
        toolFailures.add(group.archive.id);
        log(`WolvenKit could not export from ${group.archive.name}: ${error.message}`);
        return;
      }
      throw error;
    } finally { session.close(); }
  };
  // Geometry: the resource whose blob draws, from its winning archive (ArchiveXL copies followed).
  const geometryAt = new Map<PlannedComponent, Located>();
  for (const component of fresh) {
    const located = locate(graph, component.drawnFrom.ref);
    if (located) geometryAt.set(component, located);
  }
  for (const group of byArchive([...geometryAt.values()])) { await exportGroup("geometry", group, cache.geometry); cancelled(); }
  // Textures and hair profiles of the drawn chunks.
  const textureAt = new Map<string, Located>();
  for (const component of fresh) for (const material of component.materials)
    for (const provenance of Object.values(material.textures)) {
      const located = locate(graph, provenance.ref);
      if (located) textureAt.set(refLabel(provenance.ref).toLowerCase(), located);
    }
  const readOnce = async <T>(into: Map<string, T | null>, provenance: Provenance, kind: string, read: (root: JsonObject, loaded: NonNullable<Awaited<ReturnType<ResourceGraph["load"]>>>) => T | null) => {
    const key = refLabel(provenance.ref).toLowerCase();
    if (into.has(key)) return;
    const loaded = await graph.load(provenance.ref, kind);
    into.set(key, loaded ? read(loaded.root, loaded) : null);
  };
  for (const component of fresh) for (const material of component.materials) {
    for (const provenance of Object.values(material.profiles)) await readOnce(cache.profiles, provenance, "hp", (root, loaded) => {
      const stops = hairProfileStops(root);
      return stops ? { depotPath: refLabel(provenance.ref), archive: loaded.provenance.archive, sha256: hexSha(loaded.provenance.extractedSha256), ...stops } : null;
    });
    for (const provenance of Object.values(material.skinProfiles)) await readOnce(cache.skinProfiles, provenance, "sp", (root, loaded) => {
      const values = skinProfileValues(root);
      return values ? { depotPath: refLabel(provenance.ref), archive: loaded.provenance.archive, sha256: hexSha(loaded.provenance.extractedSha256), ...values } : null;
    });
    for (const provenance of Object.values(material.gradients)) await readOnce(cache.gradients, provenance, "gradient", (root, loaded) => {
      const stops = gradientStops(root);
      return stops ? { depotPath: refLabel(provenance.ref), archive: loaded.provenance.archive, sha256: hexSha(loaded.provenance.extractedSha256), stops } : null;
    });
  }
  // Layered chunks: the winning setup and templates, then their maps, microblends and mask layers with the other textures.
  const readLayered = async (chunk: PlannedChunk) => {
    if (!chunk.layered) return;
    const key = refLabel(chunk.layered.setup.ref).toLowerCase();
    if (!cache.setups.has(key)) {
      const loaded = await graph.load(chunk.layered.setup.ref, "mlsetup");
      const values = loaded ? readSetup(loaded.root) : null;
      cache.setups.set(key, values ? { values, source: { depotPath: refLabel(loaded!.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256) } } : null);
    }
    for (const layer of cache.setups.get(key)?.values.layers ?? []) {
      if (!layer.template) continue;
      const templateKey = refLabel(layer.template).toLowerCase();
      if (cache.layerTemplates.has(templateKey)) continue;
      const loaded = await graph.load(layer.template, "mltemplate");
      const values = loaded ? readTemplate(loaded.root) : null;
      cache.layerTemplates.set(templateKey, values ? { values, source: { depotPath: refLabel(loaded!.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256) } } : null);
    }
  };
  for (const component of fresh) for (const material of component.materials) await readLayered(material);
  /** A layer the renderer blends in: a visible opacity (a layer at zero opacity changes nothing; knowledge/materials-and-shaders.md §4.6). */
  const layerDraws = (opacity: number) => opacity > 0;
  const layerTextures = (chunk: PlannedChunk) => {
    const setup = chunk.layered ? cache.setups.get(refLabel(chunk.layered.setup.ref).toLowerCase()) : null;
    const out: DepotRef[] = [];
    for (const layer of setup?.values.layers ?? []) {
      if (!layerDraws(layer.opacity)) continue;
      const template = layer.template ? cache.layerTemplates.get(refLabel(layer.template).toLowerCase()) : null;
      for (const ref of [template?.values.textures.color, template?.values.textures.normal, template?.values.textures.roughness,
        template?.values.textures.metalness, layer.microblend]) if (ref?.path && /\.xbm$/i.test(ref.path)) out.push(ref);
    }
    return out;
  };
  for (const component of fresh) for (const material of component.materials)
    for (const ref of layerTextures(material)) {
      const located = locate(graph, ref);
      if (located) textureAt.set(refLabel(ref).toLowerCase(), located);
    }
  const maskAt = new Map<string, Located>();
  for (const component of fresh) for (const material of component.materials) {
    const mask = material.layered?.mask;
    if (!mask) continue;
    const located = locate(graph, mask.ref);
    if (located) maskAt.set(refLabel(mask.ref).toLowerCase(), located);
  }
  for (const group of byArchive([...textureAt.values()])) { await exportGroup("textures", group, cache.textures); cancelled(); }
  for (const group of byArchive([...maskAt.values()])) { await exportGroup("masks", group, cache.masks); cancelled(); }
  await Promise.all([...textureAt.keys()].filter(key => !cache.gamma.has(key)).map(async key => {
    const loaded = await graph.load(refFromPath(key), "xbm");
    cache.gamma.set(key, textureIsGamma(loaded?.root));
  }));
  time(`read and export ${fresh.length} of ${plan.components.length} part(s)`);
  cancelled();

  progress("writing");
  const notes: string[] = [...plan.choiceNotes];
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
    const stored = store(options.storeRoot, png, "png"), size = stored.size;
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
  /** Write one planned component; null when it can't be served (the slot's outcome is decided by the caller). */
  const build = (component: PlannedComponent): RenderComponent | "tool" | "export" => {
    const located = geometryAt.get(component) ?? locate(graph, component.drawnFrom.ref) ?? undefined;
    const exported = located ? cache.geometry.get(`${located.archive.id}|${located.depotPath.toLowerCase()}`) : undefined;
    if (!located || !exported?.glb) return located && toolFailures.has(located.archive.id) ? "tool" : "export";
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
      const required = new Set(inputs ? templateRequired(inputs, component.slot === "face") : unread.map(entry => entry.param));
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
    if (!materials.length || (component.slot !== "face" && !materials.some(material => !renderTemplate(material.template, material.templateName)?.placeholder)))
      return "export";
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
      ...(component.morphTexture ? { morphTexture: recordMorphTexture(component.morphTexture)! } : {}) };
  };
  let reusedComponents = 0;
  for (const component of plan.components) {
    const key = planKey(component), known = cache.components.get(key);
    // An unchanged plan on this installation is served as before, while its textures still fit the record's budget.
    if (known && [...known.textures].every(([file, texels]) => spend(file, texels))) {
      components.push(known.component); notes.push(...known.notes); reusedComponents++;
      continue;
    }
    componentNotes = []; componentTextures = new Map();
    const built = build(component);
    notes.push(...componentNotes);
    if (typeof built === "string") { failSlot(component.slot, built); continue; }
    components.push(built);
    cache.components.set(key, { component: built, notes: componentNotes, textures: componentTextures });
  }
  if (cache.components.size > 2048) for (const key of [...cache.components.keys()].slice(0, 512)) cache.components.delete(key);
  if (overBudget) notes.push(`${overBudget} texture(s) are over what the preview can load for one V, so the parts that need them are drawn without them.`);
  for (const [slot, why] of partial) {
    const current = slots.get(slot)!, { noun } = SLOT_WORDS[slot];
    if (components.some(item => item.slot === slot))
      slots.set(slot, { ...current, message: `Some of your V's ${noun} couldn't be read from your game files, so not all of them are shown.` });
    else unavailable(slot, why);
  }
  // A slot whose components all failed is unavailable; one with some drawn stays shown.
  for (const [slot, state] of slots) if (state.state === "shown" && !components.some(item => item.slot === slot)) unavailable(slot, "export");
  if (summary.scanGaps.length) notes.push("Some installed mod files could not be read; the resolved details may differ from the game.");
  const body = {
    schema: CHARACTER_DETAIL_SCHEMA, detail: "character" as const, origin: "game-files" as const,
    character: { source: request.source, bodyGender: request.bodyGender, ...(override ? { override } : {}) },
    provenance: { label: `Your ${summary.route === "mo2" ? "Mod Organizer 2 profile" : "game"}'s installed files`,
      notes: [...new Set(notes)].slice(0, 32).map(line => line.slice(0, 500)), ...(toolLabel ? { tool: toolLabel } : {}) },
    components, slots: [...slots.values()], choices: plan.choices,
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
  log(`Prepared ${request.override ? "a tried choice" : "the V"} in ${((performance.now() - started) / 1000).toFixed(2)} s: ${timings.join(", ")}; ` +
    `${reusedAppearances} appearance(s) and ${reusedComponents} of ${plan.components.length} part(s) reused.`);
  return { record, recordFile: recordName };
}
