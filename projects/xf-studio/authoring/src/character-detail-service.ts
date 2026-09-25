/**
 * Host application service: prepare the character render record (head skin, brows, lashes, hair and eyes) for one V from
 * the installation the launch route loads. It opens the route with the generic resolver (the same source
 * discovery, archive precedence and ArchiveXL rules Build uses), resolves the V's choices, plans the
 * drawable components (character-detail-plan.ts), exports each winning resource through the generic
 * game-asset exporter (GLB for geometry, PNG for textures, cached per depot hash and archive fingerprint),
 * and writes a content-addressed record the renderer loads. Read-only towards the game and MO2.
 *
 * There is no mod-specific code: a CCXL hair, brow, lash or eye pack resolves exactly like vanilla, and so does a
 * complexion mod, whether it replaces textures or skin profiles at their vanilla paths (archive precedence) or
 * patches the head mesh's appearances through ArchiveXL (the resolver follows the patch's materials).
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { descriptorsFromUiState } from "./cco-model";
import { planCharacterDetails, recordMorphTexture, SLOT_WORDS, type CharacterPlan, type PlannedComponent } from "./character-detail-plan";
import { inputFromCharacterRequest, type CharacterRequest } from "./character-detail-request";
import { loadMergedCco, resolveCharacter, type CharacterInput, type ResolvedParam } from "./character-resolver";
import { refFromPath, refLabel, type DepotRef } from "./depot-path";
import { archiveExportSource, GameAssetExportError, type GameAssetExporter } from "./game-asset-export";
import { templateDefaults } from "./material-template";
import { asArray, isObject, type JsonObject, type MaterialParamValue } from "./red-json";
import { CHARACTER_DETAIL_SCHEMA, type CharacterDetail, type DetailSlot, type DetailSlotState, type RenderChunkMaterial,
  type RenderComponent, type RenderGradient, type RenderProfile, type RenderProfileStop, type RenderRgba, type RenderSkinProfile,
  type RenderTexture } from "./render-detail";
import { renderTemplate } from "./render-templates";
import type { Installation, InstallationOptions } from "./resolver-host";
import type { Provenance, ResourceGraph } from "./resource-graph";

export type CharacterDetailStep = "reading" | "resolving" | "exporting" | "writing";
export const CHARACTER_DETAIL_STEPS: readonly { step: CharacterDetailStep; label: string }[] = [
  { step: "reading", label: "Reading your installed mods" },
  { step: "resolving", label: "Working out your V's skin, eyes, brows, lashes and hair" },
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
};
export type CharacterDetailResult = { record: CharacterDetail; recordFile: string };

export class CharacterDetailError extends Error {
  constructor(readonly code: "character_cancelled" | "character_tool_missing" | "character_unreadable" | "character_failed",
    message: string, readonly detail = "") { super(message); }
}
const UNREADABLE = "XF Studio couldn't read your game's character-creator files, so your V's own skin, eyes, brows, lashes and hair aren't shown. The head still works.";
const TOOL_MISSING = "WolvenKit isn't ready, so your V's own skin, eyes, brows, lashes and hair aren't shown yet. The head still works.";

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

/** Template defaults as resolved params, for every drawable template the plan meets. */
async function loadTemplateDefaults(graph: ResourceGraph, templates: Iterable<Provenance>): Promise<Map<string, ResolvedParam[]>> {
  const out = new Map<string, ResolvedParam[]>();
  for (const template of templates) {
    const key = refLabel(template.ref).toLowerCase();
    if (out.has(key) || !renderTemplate(key)) continue;
    const loaded = await graph.load(template.ref, "mt");
    out.set(key, loaded ? templateDefaults(loaded.root).map(([name, value]) => ({ name, kind: value.kind, value: paramText(value),
      setBy: `${refLabel(template.ref)} (template default)`,
      ...(value.kind === "resource" && value.ref ? { resource: graph.provenance(value.ref) } : {}) })) : []);
  }
  return out;
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

/** Copy an exported file into the content-addressed store; returns its served name and hash. */
function store(storeRoot: string, file: string, extension: "glb" | "png"): { file: string; sha256: string; bytes: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(file));
  const hash = sha256(bytes), name = `${hash}.${extension}`, target = join(storeRoot, "files", name);
  if (!existsSync(target) || statSync(target).size !== bytes.length) {
    mkdirSync(join(storeRoot, "files"), { recursive: true, mode: 0o700 });
    const staging = `${target}.${process.pid}.tmp`;
    copyFileSync(file, staging);
    renameSync(staging, target);
  }
  return { file: name, sha256: hash, bytes };
}

export async function prepareCharacterDetails(options: PrepareCharacterOptions): Promise<CharacterDetailResult> {
  const { request, signal } = options;
  const log = options.log ?? (() => {});
  const total = CHARACTER_DETAIL_STEPS.length;
  const progress = (step: CharacterDetailStep) => {
    const index = CHARACTER_DETAIL_STEPS.findIndex(item => item.step === step);
    options.progress?.(step, index, total, CHARACTER_DETAIL_STEPS[index]!.label);
  };
  const cancelled = () => { if (signal?.aborted) throw new CharacterDetailError("character_cancelled", "Preparing your V's details was cancelled."); };

  progress("reading");
  const open = options.open ?? (await import("./resolver-host")).openInstallation;
  let installation: Installation;
  try { installation = open({ ...options.route, cacheDir: options.resolverCache, log }); }
  catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).stack ?? String(error)); }
  const { graph, summary } = installation;
  cancelled();

  progress("resolving");
  let cco: Awaited<ReturnType<typeof loadMergedCco>>;
  try { cco = await loadMergedCco(graph, request.bodyGender); }
  catch (error) { throw new CharacterDetailError("character_unreadable", UNREADABLE, (error as Error).message); }
  let input: CharacterInput;
  if (request.source === "default") {
    const derived = descriptorsFromUiState(cco.merged.cco, {});
    input = { bodyGender: request.bodyGender, origin: "ui-state", appearances: derived.appearances, morphs: derived.morphs };
  } else input = inputFromCharacterRequest(request);
  const resolved = await resolveCharacter(graph, input, cco);
  cancelled();
  const templates = resolved.appearances.flatMap(entry => entry.components.flatMap(component => component.materials
    .map(material => material.template).filter((template): template is Provenance => !!template)));
  const plan: CharacterPlan = planCharacterDetails(resolved, cco.merged.cco, await loadTemplateDefaults(graph, templates));
  cancelled();

  progress("exporting");
  const slots = new Map<DetailSlot, DetailSlotState>(plan.slots.map(slot => [slot.slot, { ...slot }]));
  const failSlot = (slot: DetailSlot, why: "export" | "tool") => {
    const current = slots.get(slot)!;
    const { noun, not, pronoun } = SLOT_WORDS[slot];
    slots.set(slot, { slot, state: "unavailable", label: current.label, message: why === "tool"
      ? `WolvenKit couldn't read your V's ${noun} from your game files, so ${pronoun} ${not} shown.`
      : `XF Studio couldn't read your V's ${noun} from your game files, so ${pronoun} ${not} shown.` });
  };
  const gameRoot = options.route.gameRoot;
  const toolFailures = new Set<string>();
  let toolLabel: string | undefined;
  const exportGroup = async <T>(kind: "geometry" | "textures", group: ReturnType<typeof byArchive>[number]): Promise<Map<string, T>> => {
    const session = options.exporter.open(archiveExportSource(group.archive.id, gameRoot), signal);
    toolLabel ??= session.tool.label;
    try { return await session[kind]([...group.paths]) as unknown as Map<string, T>; }
    catch (error) {
      if (error instanceof GameAssetExportError) {
        if (error.code === "cancelled" || signal?.aborted) throw new CharacterDetailError("character_cancelled", "Preparing your V's details was cancelled.");
        if (error.code === "tool_missing" || error.code === "runtime_missing") throw new CharacterDetailError("character_tool_missing", TOOL_MISSING, error.message);
        toolFailures.add(group.archive.id);
        log(`WolvenKit could not export from ${group.archive.name}: ${error.message}`);
        return new Map();
      }
      throw error;
    } finally { session.close(); }
  };
  // Geometry: the resource whose blob draws, from its winning archive (ArchiveXL copies followed).
  const geometryAt = new Map<PlannedComponent, Located>();
  for (const component of plan.components) {
    const located = locate(graph, component.drawnFrom.ref);
    if (located) geometryAt.set(component, located);
  }
  const geometry = new Map<string, { glb: string | null; complete: boolean }>();
  for (const group of byArchive([...geometryAt.values()])) {
    const exported = await exportGroup<{ glb: string | null; complete: boolean }>("geometry", group);
    for (const [path, value] of exported) geometry.set(`${group.archive.id}|${path.toLowerCase()}`, value);
    cancelled();
  }
  // Textures and hair profiles of the drawn chunks.
  const textureAt = new Map<string, Located>();
  for (const component of plan.components) for (const material of component.materials)
    for (const provenance of Object.values(material.textures)) {
      const located = locate(graph, provenance.ref);
      if (located) textureAt.set(refLabel(provenance.ref).toLowerCase(), located);
    }
  const textures = new Map<string, { png: string }>();
  for (const group of byArchive([...textureAt.values()])) {
    const exported = await exportGroup<{ png: string }>("textures", group);
    for (const [path, value] of exported) textures.set(`${group.archive.id}|${path.toLowerCase()}`, value);
    cancelled();
  }
  const gammaOf = new Map<string, boolean | null>();
  await Promise.all([...textureAt.keys()].map(async key => {
    const loaded = await graph.load(refFromPath(key), "xbm");
    gammaOf.set(key, textureIsGamma(loaded?.root));
  }));
  const profileOf = new Map<string, RenderProfile | null>();
  for (const component of plan.components) for (const material of component.materials)
    for (const provenance of Object.values(material.profiles)) {
      const key = refLabel(provenance.ref).toLowerCase();
      if (profileOf.has(key)) continue;
      const loaded = await graph.load(provenance.ref, "hp");
      const stops = loaded ? hairProfileStops(loaded.root) : null;
      profileOf.set(key, stops ? { depotPath: refLabel(provenance.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256), ...stops } : null);
    }
  const skinProfileOf = new Map<string, RenderSkinProfile | null>();
  for (const component of plan.components) for (const material of component.materials)
    for (const provenance of Object.values(material.skinProfiles)) {
      const key = refLabel(provenance.ref).toLowerCase();
      if (skinProfileOf.has(key)) continue;
      const loaded = await graph.load(provenance.ref, "sp");
      const values = loaded ? skinProfileValues(loaded.root) : null;
      skinProfileOf.set(key, values ? { depotPath: refLabel(provenance.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256), ...values } : null);
    }
  const gradientOf = new Map<string, RenderGradient | null>();
  for (const component of plan.components) for (const material of component.materials)
    for (const provenance of Object.values(material.gradients)) {
      const key = refLabel(provenance.ref).toLowerCase();
      if (gradientOf.has(key)) continue;
      const loaded = await graph.load(provenance.ref, "gradient");
      const stops = loaded ? gradientStops(loaded.root) : null;
      gradientOf.set(key, stops ? { depotPath: refLabel(provenance.ref), archive: loaded!.provenance.archive,
        sha256: hexSha(loaded!.provenance.extractedSha256), stops } : null);
    }
  cancelled();

  progress("writing");
  const notes: string[] = [];
  const components: RenderComponent[] = [];
  for (const component of plan.components) {
    const located = geometryAt.get(component);
    const exported = located ? geometry.get(`${located.archive.id}|${located.depotPath.toLowerCase()}`) : undefined;
    if (!located || !exported?.glb) {
      if (located && toolFailures.has(located.archive.id)) failSlot(component.slot, "tool"); else failSlot(component.slot, "export");
      continue;
    }
    const glb = store(options.storeRoot, exported.glb, "glb");
    const materials: RenderChunkMaterial[] = [];
    for (const material of component.materials) {
      const chunkTextures: Record<string, RenderTexture> = {};
      const unread: string[] = [];
      for (const [param, provenance] of Object.entries(material.textures)) {
        const key = refLabel(provenance.ref).toLowerCase(), at = textureAt.get(key);
        const png = at ? textures.get(`${at.archive.id}|${at.depotPath.toLowerCase()}`)?.png : undefined;
        if (!at || !png) { unread.push(`${param} (${at ? "not exported" : "not in any mounted archive"})`); continue; }
        const stored = store(options.storeRoot, png, "png"), size = pngSize(stored.bytes);
        if (!size) { unread.push(`${param} (unreadable image)`); continue; }
        const gamma = gammaOf.get(key);
        if (gamma === null || gamma === undefined) notes.push(`${refLabel(provenance.ref)}: colour flag unreadable; treated as linear.`);
        chunkTextures[param] = { file: stored.file, sha256: stored.sha256, depotPath: refLabel(provenance.ref), ...size, isGamma: !!gamma,
          sources: [{ depotPath: at.depotPath, archive: at.archive.name, provider: at.archive.provider, parameter: param,
            ...(hexSha(provenance.extractedSha256) ? { sha256: hexSha(provenance.extractedSha256)! } : {}) }] };
      }
      const chunkProfiles: Record<string, RenderProfile> = {};
      for (const [param, provenance] of Object.entries(material.profiles)) {
        const profile = profileOf.get(refLabel(provenance.ref).toLowerCase());
        if (profile) chunkProfiles[param] = profile; else unread.push(param);
      }
      const chunkSkinProfiles: Record<string, RenderSkinProfile> = {};
      for (const [param, provenance] of Object.entries(material.skinProfiles)) {
        const profile = skinProfileOf.get(refLabel(provenance.ref).toLowerCase());
        if (profile) chunkSkinProfiles[param] = profile; else unread.push(param);
      }
      const chunkGradients: Record<string, RenderGradient> = {};
      for (const [param, provenance] of Object.entries(material.gradients)) {
        const gradient = gradientOf.get(refLabel(provenance.ref).toLowerCase());
        if (gradient) chunkGradients[param] = gradient; else unread.push(param);
      }
      // A chunk missing an input its adapter reads is left out rather than drawn wrongly.
      if (unread.length) {
        notes.push(`${component.component} chunk ${material.chunk}: ${unread.join(", ")} could not be read; the chunk is not drawn.`);
        continue;
      }
      materials.push({ chunk: material.chunk, name: material.name, template: material.template, scalars: material.scalars,
        colours: material.colours, textures: chunkTextures, profiles: chunkProfiles, skinProfiles: chunkSkinProfiles, gradients: chunkGradients });
    }
    // Placeholder chunks alone draw nothing: the component needs one chunk the renderer really draws.
    if (!materials.some(material => !renderTemplate(material.template)?.placeholder)) { failSlot(component.slot, "export"); continue; }
    if (component.skippedChunks) notes.push(`${component.component}: ${component.skippedChunks} chunk(s) use materials the preview doesn't draw yet.`);
    const hash = component.drawnFrom.ref.hash;
    components.push({ id: `${component.slot}:${component.component}:${hash}`, slot: component.slot, option: component.option,
      definition: component.definition, component: component.component,
      geometry: { file: glb.file, sha256: glb.sha256, depotPath: located.depotPath, depotHash: hash, morphTargets: component.morphTargets,
        sources: [{ depotPath: located.depotPath, archive: located.archive.name, provider: located.archive.provider,
          ...(hexSha(component.drawnFrom.extractedSha256) ? { sha256: hexSha(component.drawnFrom.extractedSha256)! } : {}) }] },
      renderChunks: component.renderChunks, chunks: materials.map(material => material.chunk), materials,
      ...(component.morphTexture ? { morphTexture: recordMorphTexture(component.morphTexture)! } : {}) });
  }
  // A slot whose components all failed is unavailable; one with some drawn stays shown.
  for (const [slot, state] of slots) if (state.state === "shown" && !components.some(item => item.slot === slot)) failSlot(slot, "export");
  if (summary.scanGaps.length) notes.push("Some installed mod files could not be read; the resolved details may differ from the game.");
  const body = {
    schema: CHARACTER_DETAIL_SCHEMA, detail: "character" as const, origin: "game-files" as const,
    character: { source: request.source, bodyGender: request.bodyGender },
    provenance: { label: `Your ${summary.route === "mo2" ? "Mod Organizer 2 profile" : "game"}'s installed files`,
      notes: [...new Set(notes)].slice(0, 32).map(note => note.slice(0, 500)), ...(toolLabel ? { tool: toolLabel } : {}) },
    components, slots: [...slots.values()],
  };
  const identity = sha256(canonical(body));
  const record: CharacterDetail = { ...body, identity };
  const recordName = `${identity}.json`;
  mkdirSync(join(options.storeRoot, "records"), { recursive: true, mode: 0o700 });
  const target = join(options.storeRoot, "records", recordName);
  if (!existsSync(target)) {
    const staging = `${target}.${process.pid}.tmp`;
    writeFileSync(staging, JSON.stringify(record), { mode: 0o600 });
    renameSync(staging, target);
  }
  return { record, recordFile: recordName };
}
