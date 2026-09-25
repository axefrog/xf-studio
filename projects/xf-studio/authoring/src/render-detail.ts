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
 * - `xfs/render-detail-4`: the character record gains the `face` slot (the V's own face decals: eye makeup, lipstick,
 *   cheeks and freckles, blemishes, scars, facial tattoos, face cyberware, stubble and the personal-link port, each a
 *   morph-skinned decal mesh over the head, in the documented draw order), and every chunk carries its template's own
 *   `templateName` (the name the engine finds the compiled programs by; a copied template keeps it) and
 *   `materialPriority`. A v4 reader refuses v2 and v3 character records and still accepts a core head under any schema.
 * - `xfs/render-detail-5`: the character record gains the `piercings` slot (the V's earring and piercing parts, selected by the
 *   creator's piercing slot and its chunk masks), each layered (`multilayered.mt`) chunk's `layered` stack (the `.mlsetup` layers
 *   with their `.mltemplate` values and textures, the `.mlmask` layers as raw channels), the creator's `choices` for the slots a
 *   viewer may try out (the piercing styles and colours), and the `override` the host applied for such a choice. A v5 reader
 *   refuses v2 to v4 character records and still accepts a core head under any schema.
 */
export const RENDER_DETAIL_SCHEMA = "xfs/render-detail-1" as const;
export const CHARACTER_DETAIL_SCHEMA = "xfs/render-detail-5" as const;
/** Earlier character schemas a reader recognises only to refuse them plainly. */
export const RETIRED_CHARACTER_SCHEMAS: readonly string[] = ["xfs/render-detail-2", "xfs/render-detail-3", "xfs/render-detail-4"];
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
// Version 5: the character record (the resolved head skin, face details, brows, lashes, hair, eyes and piercings of the player's own game).

export type DetailSlot = "skin" | "face" | "brows" | "lashes" | "hair" | "eyes" | "piercings";
/** Record and load order: the skin first, so decals over it can blend against the resolved skin colour. */
export const DETAIL_SLOTS: readonly DetailSlot[] = ["skin", "face", "brows", "lashes", "hair", "eyes", "piercings"];
/** Slots whose creator choice a viewer may try out in the viewport without changing the V (the host resolves the choice). */
export type ChoiceSlot = "piercings";
export const CHOICE_SLOTS: readonly ChoiceSlot[] = ["piercings"];
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
/** A resource the record read values from (not a served file): its depot path, winning archive and extracted-byte hash. */
export type RenderSourceRef = { depotPath: string; archive: string | null; sha256: string | null };
/** The four surface maps of a layer template (`.mltemplate`), plus the layer's own microblend and its mask layer. */
export const LAYER_TEXTURES = ["color", "normal", "roughness", "metalness", "microblend", "mask"] as const;
export type LayerTextureRole = typeof LAYER_TEXTURES[number];
/**
 * One `Multilayer_Layer` of a `.mlsetup`, with the values its CNames select from its template's override tables (the template's
 * own `defaultOverrides` name when the layer's name is not in the table), as stored: the renderer's layered adapter interprets them.
 * `names` keeps the CNames the values came from, for provenance.
 */
export type RenderLayer = {
  /** The layer template's depot path and where it was read, or null when the layer names none or it was unreadable. */
  template: RenderSourceRef | null;
  opacity: number;
  matTile: number;
  /** The template's `tilingMultiplier` (1 when unset). */
  tilingMultiplier: number;
  offsetU: number; offsetV: number;
  mbTile: number; microblendContrast: number; microblendNormalStrength: number; microblendOffsetU: number; microblendOffsetV: number;
  colorScale: [number, number, number];
  normalStrength: number;
  roughLevelsIn: [number, number]; roughLevelsOut: [number, number];
  metalLevelsIn: [number, number]; metalLevelsOut: [number, number];
  /** The template's colour-mask levels (`colorMaskLevelsIn/Out`). */
  colorMaskLevelsIn: [number, number]; colorMaskLevelsOut: [number, number];
  names: { colorScale: string; normalStrength: string; roughLevelsIn: string; roughLevelsOut: string; metalLevelsIn: string; metalLevelsOut: string };
  /** Served textures by role; a role the layer lacks (or that could not be read) is absent. `mask` is this layer's `.mlmask` layer. */
  textures: Partial<Record<LayerTextureRole, RenderTexture>>;
};
/** A `multilayered.mt` chunk's layer stack: the `.mlsetup` (in stored order, bottom first) and the `.mlmask` it is masked by. */
export type RenderLayered = { setup: RenderSourceRef; mask: (RenderSourceRef & { layers: number }) | null; ratio: number; useNormal: boolean;
  layers: RenderLayer[] };
/** One creator choice a viewer may try: an option (a style) and its definitions (colours), in the creator's order. */
export type RenderChoiceOption = { option: string; index: number; definitions: { name: string; index: number }[] };
export type RenderChoices = { slot: ChoiceSlot; options: RenderChoiceOption[] };
/** A viewer's choice the host applied in place of the V's own for one slot. */
export type RenderOverride = { slot: ChoiceSlot; option: string; definition: string };
export type RenderChunkMaterial = {
  chunk: number;
  /** The mesh appearance's material name for this chunk. */
  name: string;
  /** Template depot path the instance chain ends at (`.mt`/`.remt`), or null when unresolved. */
  template: string | null;
  /** The template's own name (`CMaterialTemplate.name`), which selects its programs and the renderer's adapter; null when unreadable. */
  templateName: string | null;
  /** The template's `materialPriority` (`EMP_Normal`, `EMP_Front`), or null when unreadable. Decals draw by it first. */
  materialPriority: string | null;
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
  /** A layered (`multilayered.mt`) chunk's layer stack. */
  layered?: RenderLayered;
};
/** WolvenKit names each exported render chunk `submesh_<chunk>_LOD_<lod>` (optionally with a suffix). */
export function chunkOfMesh(name: string): number | null {
  const match = /^submesh_(\d+)_LOD_\d+/.exec(name);
  return match ? Number(match[1]) : null;
}

export type RenderComponent = {
  /** Stable within the record: slot, component name and geometry hash. */
  id: string;
  slot: DetailSlot;
  /** The character-creator option and choice that brought this component (data from the game's own resources). */
  option: string;
  definition: string;
  component: string;
  /**
   * The resource whose render blob draws (a patch or copy source when ArchiveXL supplies it), exported to GLB. The host
   * serves only the meshes of the chunks the record lists (`materials`), with sparse morph deltas (PREV-53).
   */
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
  character: { source: "default" | "save"; bodyGender: "female" | "male";
    /** The viewer's choice the host resolved in place of the V's own (a piercing style tried in the viewport). */
    override?: RenderOverride };
  provenance: { label: string; notes: string[]; tool?: string };
  components: RenderComponent[];
  slots: DetailSlotState[];
  /** What a viewer may try per choice slot: the creator's options on this installation (vanilla and custom alike). */
  choices: RenderChoices[];
};

/** A framework that fills slots with inline components (one per filled slot) can bring many parts to one piercing choice. */
const LIMITS = { components: 96, chunks: 64, params: 160, textures: 16, stops: 32, layers: 20, options: 64, definitions: 64 };
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
    templateName: item?.templateName === null ? null : paramName(item?.templateName, `${what} template name`),
    materialPriority: item?.materialPriority === null ? null
      : /^EMP_[A-Za-z]{1,32}$/.test(String(item?.materialPriority)) ? item.materialPriority : fail(`${what} priority is invalid.`),
    scalars: entries(item?.scalars, `${what} scalars`, LIMITS.params, (v, label) => finite(v, label)),
    colours: entries(item?.colours, `${what} colours`, LIMITS.params, (v, label) => {
      if (!Array.isArray(v) || v.length !== 4) fail(`${label} is not RGBA.`);
      return (v as number[]).map((c, k) => int(c, `${label} ${k}`, 0, 255)) as RenderRgba;
    }),
    textures: entries(item?.textures, `${what} textures`, LIMITS.textures, texture),
    profiles: entries(item?.profiles, `${what} profiles`, 4, profile),
    skinProfiles: entries(item?.skinProfiles, `${what} skin profiles`, 4, skinProfile),
    gradients: entries(item?.gradients, `${what} gradients`, 4, gradient),
    ...(item?.layered === undefined ? {} : { layered: layered(item.layered, `${what} layers`) }) };
}

function sourceRef(value: unknown, what: string): RenderSourceRef {
  const item = value as RenderSourceRef;
  return { depotPath: text(item?.depotPath, `${what} depot path`), archive: item?.archive === null ? null : text(item?.archive, `${what} archive`),
    sha256: optionalSha(item?.sha256 ?? null, what) };
}
const pair = (value: unknown, what: string): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) return fail(`${what} is not a pair.`);
  return [finite(value[0], what), finite(value[1], what)];
};
function layer(value: unknown, what: string): RenderLayer {
  const item = value as RenderLayer;
  if (!item || typeof item !== "object") fail(`${what} is missing.`);
  const colour = item.colorScale;
  if (!Array.isArray(colour) || colour.length !== 3) fail(`${what} colour is not RGB.`);
  const names = item.names ?? {} as RenderLayer["names"];
  const name = (key: keyof RenderLayer["names"]) => typeof names[key] === "string" && names[key].length < 128 ? names[key] : fail(`${what} ${key} name is invalid.`);
  const textures = item.textures;
  if (!textures || typeof textures !== "object" || Array.isArray(textures)) fail(`${what} textures are missing.`);
  for (const role of Object.keys(textures)) if (!(LAYER_TEXTURES as readonly string[]).includes(role)) fail(`${what} texture role ${role} is unknown.`);
  return { template: item.template === null ? null : sourceRef(item.template, `${what} template`),
    opacity: finite(item.opacity, `${what} opacity`), matTile: finite(item.matTile, `${what} tile`), tilingMultiplier: finite(item.tilingMultiplier, `${what} tiling`),
    offsetU: finite(item.offsetU, `${what} offset`), offsetV: finite(item.offsetV, `${what} offset`), mbTile: finite(item.mbTile, `${what} microblend tile`),
    microblendContrast: finite(item.microblendContrast, `${what} microblend contrast`),
    microblendNormalStrength: finite(item.microblendNormalStrength, `${what} microblend normal`),
    microblendOffsetU: finite(item.microblendOffsetU, `${what} microblend offset`), microblendOffsetV: finite(item.microblendOffsetV, `${what} microblend offset`),
    colorScale: colour.map((c, k) => finite(c, `${what} colour ${k}`)) as [number, number, number],
    normalStrength: finite(item.normalStrength, `${what} normal strength`),
    roughLevelsIn: pair(item.roughLevelsIn, `${what} roughness in`), roughLevelsOut: pair(item.roughLevelsOut, `${what} roughness out`),
    metalLevelsIn: pair(item.metalLevelsIn, `${what} metalness in`), metalLevelsOut: pair(item.metalLevelsOut, `${what} metalness out`),
    colorMaskLevelsIn: pair(item.colorMaskLevelsIn, `${what} colour mask in`), colorMaskLevelsOut: pair(item.colorMaskLevelsOut, `${what} colour mask out`),
    names: { colorScale: name("colorScale"), normalStrength: name("normalStrength"), roughLevelsIn: name("roughLevelsIn"), roughLevelsOut: name("roughLevelsOut"),
      metalLevelsIn: name("metalLevelsIn"), metalLevelsOut: name("metalLevelsOut") },
    textures: Object.fromEntries(Object.entries(textures).map(([role, entry]) => [role, texture(entry, `${what} ${role}`)])) };
}
function layered(value: unknown, what: string): RenderLayered {
  const item = value as RenderLayered;
  if (!item || typeof item !== "object" || !Array.isArray(item.layers) || !item.layers.length || item.layers.length > LIMITS.layers) fail(`${what} are invalid.`);
  if (typeof item.useNormal !== "boolean") fail(`${what} normal flag is missing.`);
  return { setup: sourceRef(item.setup, `${what} setup`),
    mask: item.mask === null ? null : { ...sourceRef(item.mask, `${what} mask`), layers: int(item.mask?.layers, `${what} mask layers`, 0, 64) },
    ratio: finite(item.ratio, `${what} ratio`), useNormal: item.useNormal, layers: item.layers.map((entry, index) => layer(entry, `${what} ${index}`)) };
}

function choices(value: unknown): RenderChoices[] {
  if (!Array.isArray(value) || value.length > CHOICE_SLOTS.length) return fail("choices are invalid.");
  const seen = new Set<string>();
  return value.map((entry: RenderChoices, index) => {
    if (!CHOICE_SLOTS.includes(entry?.slot) || seen.has(entry.slot)) fail(`choice slot ${index} is invalid.`);
    seen.add(entry.slot);
    if (!Array.isArray(entry.options) || entry.options.length > LIMITS.options) fail(`${entry.slot} choices are invalid.`);
    const options = new Set<string>();
    return { slot: entry.slot, options: entry.options.map((option, k) => {
      const name = paramName(option?.option, `${entry.slot} choice ${k}`);
      if (options.has(name)) fail(`${entry.slot} choice ${name} repeats.`);
      options.add(name);
      if (!Array.isArray(option.definitions) || !option.definitions.length || option.definitions.length > LIMITS.definitions) fail(`${entry.slot} choice ${name} has no definitions.`);
      return { option: name, index: int(option.index, `${entry.slot} choice ${name} index`, 0, 1024),
        definitions: option.definitions.map((definition, d) => ({ name: paramName(definition?.name, `${entry.slot} choice ${name} definition ${d}`),
          index: int(definition?.index, `${entry.slot} choice ${name} definition ${d} index`, 0, 1024) })) };
    }) };
  });
}
function override(value: unknown): RenderOverride {
  const item = value as RenderOverride;
  if (!item || !CHOICE_SLOTS.includes(item.slot)) return fail("override is invalid.");
  return { slot: item.slot, option: paramName(item.option, "override option"), definition: paramName(item.definition, "override definition") };
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
  const applied = doc.character.override === undefined ? undefined : override(doc.character.override);
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
    character: { source: doc.character.source, bodyGender: doc.character.bodyGender, ...(applied ? { override: applied } : {}) },
    provenance: { label: text(doc.provenance?.label, "provenance label"),
      notes: Array.isArray(doc.provenance?.notes) ? doc.provenance.notes.map(entry => text(entry, "note")) : [],
      ...(doc.provenance?.tool === undefined ? {} : { tool: text(doc.provenance.tool, "provenance tool") }) },
    components, slots, choices: choices(doc.choices) };
}

/** Version dispatch: a v1 record is a core head; a v2 to v5 record is a core head, and a v5 record may be a character. */
export function parseRenderDetail(value: unknown): CoreDetail | CharacterDetail {
  const doc = value as { schema?: unknown; detail?: unknown };
  if (doc?.detail === "character") return parseCharacterDetail(value);
  if (doc?.schema === RENDER_DETAIL_SCHEMA || doc?.schema === CHARACTER_DETAIL_SCHEMA || RETIRED_CHARACTER_SCHEMAS.includes(String(doc?.schema)))
    return parseCoreDetail(value);
  return fail(`unsupported record version ${String(doc?.schema)}.`);
}
