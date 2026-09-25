/**
 * Typed records the renderer loads details from. A record names each renderable resource
 * (geometry or texture), where to fetch it, its expected bytes, and which game resources it
 * came from (depot paths, materials, parameters and the adapter applied), so the renderer
 * never guesses identities from fixed URLs. Hosts produce records. Pure: no IO.
 *
 * Versions:
 * - `xfs/render-detail-1`: the core head (`detail: "core-head"`: head, plate, eyes and four maps),
 *   derived from the base game's files. Still what the core preview writes.
 * - `xfs/render-detail-2`: adds the character record (`detail: "character"`): per resolved drawing
 *   component (the head's skin, brows, lashes, hair), its geometry, visible chunks and, per chunk, the
 *   material template with its scalars, colours, textures (raw channels plus `isGamma`), hair profiles
 *   and skin profiles, exactly as the generic resolver found them for the player's own installation on
 *   the launch route. The record never interprets channels; the renderer's material adapters do. A v2
 *   reader also accepts a v2 core head. The `skin` slot (the head component with its `skin.mt` chunk)
 *   joined v2 with step P1.
 * - `xfs/render-detail-3`: the character record gains the `eyes` slot (the eye-colour option's component with its
 *   eyeball and wetness-shell chunks, each chunk's role taken from its template), a per-chunk `gradients` map
 *   (`CGradient` stops, e.g. the iris colour ramp) and, per morph component, the effective morph target's
 *   `baseTexture` rule, already applied to the chunk textures it replaces. A v3 reader refuses v2 character
 *   records (the host prepares again) and still accepts a core head under any of the three schemas.
 */
export const RENDER_DETAIL_SCHEMA = "xfs/render-detail-1" as const;
export const CHARACTER_DETAIL_SCHEMA = "xfs/render-detail-3" as const;
/** Earlier character schemas a reader recognises only to refuse them plainly. */
export const RETIRED_CHARACTER_SCHEMAS: readonly string[] = ["xfs/render-detail-2"];
export const CORE_DETAIL_URL = "/assets/preview-core.json";
/** Where character records and their files are served; file names are content-addressed. */
export const CHARACTER_DETAIL_ASSETS = "/assets/character/";

export type RenderSource = { depotPath: string; sha256?: string; material?: string; parameter?: string; adapter?: string;
  /** Winning archive file name (never a local path) and its provider, when resolved. */
  archive?: string; provider?: string };
export type RenderResource = {
  /** File name under `/assets/`. */
  file: string;
  /** Expected SHA-256 of the served bytes. */
  sha256: string;
  sources: RenderSource[];
};
/** The morph resource that supplied one mesh node's facial targets (paired across nodes by target and region). */
export type RenderMorphSource = { node: string; depotPath: string; sha256: string | null };
export type CoreTextureSlot = "head.albedo" | "head.normal" | "head.roughness" | "eyes.albedo";
export const CORE_TEXTURE_SLOTS: readonly CoreTextureSlot[] = ["head.albedo", "head.normal", "head.roughness", "eyes.albedo"];
export const CORE_TEXTURE_COLOUR: Record<CoreTextureSlot, "srgb" | "linear"> =
  { "head.albedo": "srgb", "head.normal": "linear", "head.roughness": "linear", "eyes.albedo": "srgb" };
export type CoreDetail = {
  schema: typeof RENDER_DETAIL_SCHEMA;
  detail: "core-head";
  /** Stable identity of this exact derivation (the host's cache key). */
  identity: string;
  origin: "game-files";
  /** `tool` names the program that decoded the game files (e.g. "WolvenKit CLI 9.0.1"), when there was one. */
  provenance: { label: string; notes: string[]; tool?: string };
  geometry: RenderResource & { nodes: { head: string; plate: string; eyes: string };
    /** Morph resource per mesh node. */
    morphs: RenderMorphSource[] };
  textures: Record<CoreTextureSlot, RenderResource>;
};

const fail = (message: string): never => { throw Error(`Render detail: ${message}`); };
const text = (value: unknown, name: string) => typeof value === "string" && value.length > 0 && value.length < 512 ? value : fail(`${name} is invalid.`);
const file = (value: unknown, name: string) => /^[a-z0-9][a-z0-9._-]{0,95}\.(glb|png)$/.test(String(value)) ? String(value) : fail(`${name} is not a plain asset file name.`);
const sha = (value: unknown, name: string) => /^[a-f0-9]{64}$/.test(String(value)) ? value as string : fail(`${name} hash is invalid.`);
const optionalSha = (value: unknown, name: string) => value === null ? null : sha(value, name);

function resource(value: unknown, name: string): RenderResource {
  const item = value as RenderResource;
  if (!item || typeof item !== "object" || !Array.isArray(item.sources)) fail(`${name} is missing.`);
  return { file: file(item.file, name), sha256: sha(item.sha256, name), sources: item.sources.map((source, index) => ({
    depotPath: text(source?.depotPath, `${name} source ${index}`),
    ...(source.sha256 !== undefined ? { sha256: sha(source.sha256, `${name} source ${index}`) } : {}),
    ...(source.material !== undefined ? { material: text(source.material, `${name} material`) } : {}),
    ...(source.parameter !== undefined ? { parameter: text(source.parameter, `${name} parameter`) } : {}),
    ...(source.adapter !== undefined ? { adapter: text(source.adapter, `${name} adapter`) } : {}),
    ...(source.archive !== undefined ? { archive: text(source.archive, `${name} archive`) } : {}),
    ...(source.provider !== undefined ? { provider: text(source.provider, `${name} provider`) } : {}),
  })) };
}

function morphSources(value: unknown): RenderMorphSource[] {
  if (!Array.isArray(value) || value.length > 16) fail("geometry morphs are invalid.");
  return (value as RenderMorphSource[]).map((entry, index) => ({ node: text(entry?.node, `morph ${index} node`),
    depotPath: text(entry?.depotPath, `morph ${index} source`), sha256: optionalSha(entry?.sha256 ?? null, `morph ${index}`) }));
}

/** Strict parse: an unexpected field shape never reaches the loader. */
export function parseCoreDetail(value: unknown): CoreDetail {
  const doc = value as CoreDetail;
  // A v2 reader accepts the unchanged core-head shape under either schema.
  if (!doc || (doc.schema !== RENDER_DETAIL_SCHEMA && (doc.schema as string) !== CHARACTER_DETAIL_SCHEMA &&
      !RETIRED_CHARACTER_SCHEMAS.includes(doc.schema as string)) || doc.detail !== "core-head")
    fail("not a core head record.");
  if (doc.origin !== "game-files") fail("origin is invalid.");
  const nodes = doc.geometry?.nodes;
  if (!nodes || typeof nodes !== "object") fail("geometry nodes are missing.");
  const textures = Object.fromEntries(CORE_TEXTURE_SLOTS.map(slot => [slot, resource(doc.textures?.[slot], slot)])) as CoreDetail["textures"];
  return {
    schema: RENDER_DETAIL_SCHEMA, detail: "core-head", identity: text(doc.identity, "identity"), origin: doc.origin,
    provenance: { label: text(doc.provenance?.label, "provenance label"),
      notes: Array.isArray(doc.provenance?.notes) ? doc.provenance.notes.map(note => text(note, "note")) : [],
      ...(doc.provenance?.tool === undefined ? {} : { tool: text(doc.provenance.tool, "provenance tool") }) },
    geometry: { ...resource(doc.geometry, "geometry"), nodes: { head: text(nodes.head, "head node"), plate: text(nodes.plate, "plate node"), eyes: text(nodes.eyes, "eyes node") },
      morphs: morphSources(doc.geometry.morphs) },
    textures,
  };
}

// ---------------------------------------------------------------------------------------------
// Version 3: the character record (the resolved head skin, brows, lashes, hair and eyes of the player's own game).

export type DetailSlot = "skin" | "brows" | "lashes" | "hair" | "eyes";
/** Record and load order: the skin first, so decals over it can blend against the resolved skin colour. */
export const DETAIL_SLOTS: readonly DetailSlot[] = ["skin", "brows", "lashes", "hair", "eyes"];
/** A texture as the game stores it: raw decoded channels, plus the resource's own colour flag. */
export type RenderTexture = RenderResource & { depotPath: string; width: number; height: number; isGamma: boolean };
export type RenderProfileStop = { value: number; color: [number, number, number] };
/** A `CHairProfile` as serialized: unsorted gradient stops in stored 8-bit values, and its sample count. */
export type RenderProfile = { depotPath: string; archive: string | null; sha256: string | null; sampleCount: number;
  id: RenderProfileStop[]; rootToTip: RenderProfileStop[] };
export type RenderRgba = [number, number, number, number];
/**
 * A `CSkinProfile` (`.sp`) as serialized: the dual specular lobe (roughness scales and mix) and the
 * subsurface blur inputs (size, diffuse and falloff colours in stored 8-bit values).
 */
export type RenderSkinProfile = { depotPath: string; archive: string | null; sha256: string | null;
  roughness0: number; roughness1: number; lobeMix: number; blurSize: number;
  diffuse: [number, number, number]; falloff: [number, number, number] };
/** One `CGradient` entry: its position and 8-bit RGBA colour as stored. */
export type RenderGradientStop = { value: number; color: RenderRgba };
/** A `CGradient` (e.g. `IrisColorGradient`), its stops sorted by value. The renderer bakes the ramp. */
export type RenderGradient = { depotPath: string; archive: string | null; sha256: string | null; stops: RenderGradientStop[] };
/**
 * A morph component's effective `baseTexture` rule: the morph target (after ArchiveXL patches) binds a runtime
 * texture built from `texture` to the material parameter `parameter`. When both are set, the chunk textures of
 * that parameter in this record already are `texture`; `texture: null` (ArchiveXL's eye fix) leaves the material's own.
 */
export type RenderMorphTexture = { morph: string; texture: string | null; parameter: string | null };
export type RenderChunkMaterial = {
  chunk: number;
  /** The mesh appearance's material name for this chunk. */
  name: string;
  /** Template depot path the instance chain ends at (`.mt`/`.remt`), or null when unresolved. */
  template: string | null;
  /** Effective values: nearest material instance first, then the template's defaults. */
  scalars: Record<string, number>;
  /** 8-bit RGBA as stored. */
  colours: Record<string, RenderRgba>;
  /** Only the inputs the renderer's adapter for this template reads (see render-templates.ts). */
  textures: Record<string, RenderTexture>;
  profiles: Record<string, RenderProfile>;
  /** Skin profiles the template's skin parameters bind (`skin.mt` `SkinProfile`). */
  skinProfiles: Record<string, RenderSkinProfile>;
  /** Gradients the template's gradient parameters bind (`eye_gradient.mt` `IrisColorGradient`). */
  gradients: Record<string, RenderGradient>;
};
export type RenderComponent = {
  /** Stable within the record: slot, component name and geometry hash. */
  id: string;
  slot: DetailSlot;
  /** The character-creator option and choice that brought this component (data from the game's own resources). */
  option: string;
  definition: string;
  component: string;
  /** The resource whose render blob draws (a patch or copy source when ArchiveXL supplies it), exported to GLB. */
  geometry: RenderResource & { depotPath: string; depotHash: string; morphTargets: boolean };
  renderChunks: number;
  /** Visible chunks after the chunk mask. */
  chunks: number[];
  materials: RenderChunkMaterial[];
  /** Morph components only: the effective morph target's `baseTexture` rule. */
  morphTexture?: RenderMorphTexture;
};
export type DetailSlotState = { slot: DetailSlot; state: "shown" | "none" | "unavailable";
  /** Short plain label (the resolved choice), for the character panel. */
  label: string;
  /** One plain line when the slot could not be shown in full. */
  message?: string };
export type CharacterDetail = {
  schema: typeof CHARACTER_DETAIL_SCHEMA;
  detail: "character";
  identity: string;
  origin: "game-files";
  character: { source: "default" | "save"; bodyGender: "female" | "male" };
  provenance: { label: string; notes: string[]; tool?: string };
  components: RenderComponent[];
  slots: DetailSlotState[];
};

const LIMITS = { components: 32, chunks: 64, params: 160, textures: 16, stops: 32 };
const paramName = (value: unknown, what: string) => typeof value === "string" && /^[A-Za-z0-9_.@:+ -]{1,96}$/.test(value) ? value : fail(`${what} is invalid.`);
const int = (value: unknown, what: string, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fail(`${what} is out of range.`);
const finite = (value: unknown, what: string) => typeof value === "number" && Number.isFinite(value) ? value : fail(`${what} is not a number.`);
function entries<T>(value: unknown, what: string, max: number, read: (item: unknown, label: string) => T): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${what} is missing.`);
  const items = Object.entries(value as Record<string, unknown>);
  if (items.length > max) fail(`${what} has too many entries.`);
  return Object.fromEntries(items.map(([key, item]) => [paramName(key, `${what} name`), read(item, `${what} ${key}`)]));
}

function stops(value: unknown, what: string): RenderProfileStop[] {
  if (!Array.isArray(value) || !value.length || value.length > LIMITS.stops) fail(`${what} stops are invalid.`);
  return (value as RenderProfileStop[]).map((stop, index) => {
    const at = finite(stop?.value, `${what} stop ${index}`);
    if (at < 0 || at > 1 || !Array.isArray(stop.color) || stop.color.length !== 3) fail(`${what} stop ${index} is invalid.`);
    return { value: at, color: stop.color.map((c, k) => int(c, `${what} stop ${index} colour ${k}`, 0, 255)) as [number, number, number] };
  });
}

function texture(value: unknown, what: string): RenderTexture {
  const item = value as RenderTexture;
  return { ...resource(item, what), depotPath: text(item?.depotPath, `${what} depot path`),
    width: int(item?.width, `${what} width`, 1, 16384), height: int(item?.height, `${what} height`, 1, 16384),
    isGamma: typeof item?.isGamma === "boolean" ? item.isGamma : fail(`${what} colour flag is missing.`) };
}

function profile(value: unknown, what: string): RenderProfile {
  const item = value as RenderProfile;
  return { depotPath: text(item?.depotPath, `${what} depot path`), archive: item?.archive === null ? null : text(item?.archive, `${what} archive`),
    sha256: optionalSha(item?.sha256 ?? null, what), sampleCount: int(item?.sampleCount, `${what} sample count`, 2, 1024),
    id: stops(item?.id, `${what} ID`), rootToTip: stops(item?.rootToTip, `${what} root-to-tip`) };
}

const rgb = (value: unknown, what: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3) return fail(`${what} is not RGB.`);
  return value.map((c, k) => int(c, `${what} ${k}`, 0, 255)) as [number, number, number];
};
function skinProfile(value: unknown, what: string): RenderSkinProfile {
  const item = value as RenderSkinProfile;
  const ranged = (v: unknown, name: string, max: number) => { const n = finite(v, `${what} ${name}`); return n >= 0 && n <= max ? n : fail(`${what} ${name} is out of range.`); };
  return { depotPath: text(item?.depotPath, `${what} depot path`), archive: item?.archive === null ? null : text(item?.archive, `${what} archive`),
    sha256: optionalSha(item?.sha256 ?? null, what), roughness0: ranged(item?.roughness0, "roughness0", 16), roughness1: ranged(item?.roughness1, "roughness1", 16),
    lobeMix: ranged(item?.lobeMix, "lobe mix", 16), blurSize: ranged(item?.blurSize, "blur size", 64),
    diffuse: rgb(item?.diffuse, `${what} diffuse`), falloff: rgb(item?.falloff, `${what} falloff`) };
}

function gradient(value: unknown, what: string): RenderGradient {
  const item = value as RenderGradient;
  if (!Array.isArray(item?.stops) || !item.stops.length || item.stops.length > LIMITS.stops) fail(`${what} stops are invalid.`);
  const read = item.stops.map((stop, index) => {
    const at = finite(stop?.value, `${what} stop ${index}`);
    if (at < 0 || at > 1 || !Array.isArray(stop.color) || stop.color.length !== 4) fail(`${what} stop ${index} is invalid.`);
    return { value: at, color: stop.color.map((c, k) => int(c, `${what} stop ${index} colour ${k}`, 0, 255)) as RenderRgba };
  });
  if (read.some((stop, index) => index > 0 && stop.value < read[index - 1]!.value)) fail(`${what} stops are not sorted.`);
  return { depotPath: text(item?.depotPath, `${what} depot path`), archive: item?.archive === null ? null : text(item?.archive, `${what} archive`),
    sha256: optionalSha(item?.sha256 ?? null, what), stops: read };
}

function chunkMaterial(value: unknown, what: string): RenderChunkMaterial {
  const item = value as RenderChunkMaterial;
  return { chunk: int(item?.chunk, `${what} chunk`, 0, 63),
    name: typeof item?.name === "string" && item.name.length < 256 ? item.name : fail(`${what} name is invalid.`),
    template: item?.template === null ? null : text(item?.template, `${what} template`),
    scalars: entries(item?.scalars, `${what} scalars`, LIMITS.params, (v, label) => finite(v, label)),
    colours: entries(item?.colours, `${what} colours`, LIMITS.params, (v, label) => {
      if (!Array.isArray(v) || v.length !== 4) fail(`${label} is not RGBA.`);
      return (v as number[]).map((c, k) => int(c, `${label} ${k}`, 0, 255)) as RenderRgba;
    }),
    textures: entries(item?.textures, `${what} textures`, LIMITS.textures, texture),
    profiles: entries(item?.profiles, `${what} profiles`, 4, profile),
    skinProfiles: entries(item?.skinProfiles, `${what} skin profiles`, 4, skinProfile),
    gradients: entries(item?.gradients, `${what} gradients`, 4, gradient) };
}

function component(value: unknown, index: number): RenderComponent {
  const item = value as RenderComponent, what = `component ${index}`;
  if (!DETAIL_SLOTS.includes(item?.slot)) fail(`${what} slot is invalid.`);
  const renderChunks = int(item.renderChunks, `${what} render chunks`, 1, LIMITS.chunks);
  if (!Array.isArray(item.chunks) || !item.chunks.length || item.chunks.length > renderChunks) fail(`${what} chunks are invalid.`);
  const chunks = item.chunks.map((chunk, k) => int(chunk, `${what} chunk ${k}`, 0, renderChunks - 1));
  if (new Set(chunks).size !== chunks.length) fail(`${what} lists a chunk twice.`);
  if (!Array.isArray(item.materials) || item.materials.length > chunks.length) fail(`${what} materials are invalid.`);
  const materials = item.materials.map((material, k) => chunkMaterial(material, `${what} material ${k}`));
  if (materials.some(material => !chunks.includes(material.chunk))) fail(`${what} has a material for a hidden chunk.`);
  const geometry = item.geometry;
  const rule = item.morphTexture;
  if (rule !== undefined && (!rule || typeof rule !== "object")) fail(`${what} morph texture rule is invalid.`);
  return { id: text(item.id, `${what} id`), slot: item.slot, option: text(item.option, `${what} option`),
    definition: text(item.definition, `${what} definition`), component: text(item.component, `${what} component`),
    geometry: { ...resource(geometry, `${what} geometry`), depotPath: text(geometry?.depotPath, `${what} geometry path`),
      depotHash: /^[0-9]{1,20}$/.test(String(geometry?.depotHash)) ? String(geometry.depotHash) : fail(`${what} geometry hash is invalid.`),
      morphTargets: typeof geometry?.morphTargets === "boolean" ? geometry.morphTargets : fail(`${what} geometry kind is missing.`) },
    renderChunks, chunks, materials,
    ...(rule ? { morphTexture: { morph: text(rule.morph, `${what} morph`), texture: rule.texture === null ? null : text(rule.texture, `${what} morph texture`),
      parameter: rule.parameter === null ? null : paramName(rule.parameter, `${what} morph texture parameter`) } } : {}) };
}

/** Strict parse of a character record: an unexpected field shape never reaches the loader. */
export function parseCharacterDetail(value: unknown): CharacterDetail {
  const doc = value as CharacterDetail;
  if (RETIRED_CHARACTER_SCHEMAS.includes(String(doc?.schema)) && doc?.detail === "character") fail(`the record version ${doc.schema} is retired; prepare it again.`);
  if (!doc || doc.schema !== CHARACTER_DETAIL_SCHEMA || doc.detail !== "character") fail("not a character record.");
  if (doc.origin !== "game-files") fail("origin is invalid.");
  if (doc.character?.source !== "default" && doc.character?.source !== "save") fail("character source is invalid.");
  if (doc.character.bodyGender !== "female" && doc.character.bodyGender !== "male") fail("body gender is invalid.");
  if (!Array.isArray(doc.components) || doc.components.length > LIMITS.components) fail("components are invalid.");
  const components = doc.components.map(component);
  if (new Set(components.map(item => item.id)).size !== components.length) fail("component ids repeat.");
  if (!Array.isArray(doc.slots) || doc.slots.length !== DETAIL_SLOTS.length) fail("slot outcomes are invalid.");
  const slots = DETAIL_SLOTS.map((slot): DetailSlotState => {
    const entry = doc.slots.find(item => item?.slot === slot);
    if (!entry || !["shown", "none", "unavailable"].includes(entry.state)) return fail(`${slot} outcome is invalid.`);
    if (entry.state === "shown" && !components.some(item => item.slot === slot)) fail(`${slot} is shown without components.`);
    return { slot, state: entry.state, label: typeof entry.label === "string" && entry.label.length < 200 ? entry.label : fail(`${slot} label is invalid.`),
      ...(entry.message === undefined ? {} : { message: text(entry.message, `${slot} message`) }) };
  });
  return { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: text(doc.identity, "identity"), origin: "game-files",
    character: { source: doc.character.source, bodyGender: doc.character.bodyGender },
    provenance: { label: text(doc.provenance?.label, "provenance label"),
      notes: Array.isArray(doc.provenance?.notes) ? doc.provenance.notes.map(entry => text(entry, "note")) : [],
      ...(doc.provenance?.tool === undefined ? {} : { tool: text(doc.provenance.tool, "provenance tool") }) },
    components, slots };
}

/** Version dispatch: a v1 record is a core head; a v2 or v3 record is a core head, and a v3 record may be a character. */
export function parseRenderDetail(value: unknown): CoreDetail | CharacterDetail {
  const doc = value as { schema?: unknown; detail?: unknown };
  if (doc?.detail === "character") return parseCharacterDetail(value);
  if (doc?.schema === RENDER_DETAIL_SCHEMA || doc?.schema === CHARACTER_DETAIL_SCHEMA || RETIRED_CHARACTER_SCHEMAS.includes(String(doc?.schema)))
    return parseCoreDetail(value);
  return fail(`unsupported record version ${String(doc?.schema)}.`);
}
