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
 * - `xfs/render-detail-6`: a viewer's choice is the creator's **switcher choice** (its `localizedName`, the creator's own choice identity)
 *   plus a definition of the option that choice drives, so every target of the choice and its linked followers resolve by the shared R5
 *   rules (cco-model.ts); the record's `override` names `choice`, not an option. Each choice and definition carries the one plain `label`
 *   the host words (no index sentinel). A reader drops one bad component, choice or override, with a note, instead of refusing the whole
 *   record, and the host runs this reader over its own output before writing it, so what it writes always parses. A v6 reader refuses v2
 *   to v5 character records.
 * - `xfs/render-detail-7`: the record no longer lists the `choices` a viewer may try or the `override` the host applied: every creator
 *   choice is the character context's (character-context.ts), which the host derives into the V before planning (CORE-58, PIPE-82). A
 *   v7 reader refuses v2 to v6 character records, so a page and a host of different versions say so (the version-skew notice).
 * - `xfs/render-detail-8`: the character record gains the `body` slot (the V's third-person body, arms, hands and nails, feet and body
 *   decals such as tattoos, scars and the game's own underwear cover, selected by the body's consumer groups and the creator's censorship
 *   rules; knowledge/body-rendering.md), and a component may carry the `morphs` the resolver applied to it (`<target>_<region>`, e.g.
 *   the breast size and nail length, which the body does not share with the head's facial shapes). A v8 reader refuses v2 to v7
 *   character records.
 * - `xfs/render-detail-9`: the character record gains the `clothing` slot (the garments V wears, resolved from worn item records through
 *   their factories, root entities and `.app`s; knowledge/clothing.md), each garment component carrying its `garment` (clothing area, item
 *   record ID and layer score), and body components whose chunk masks worn items changed (ArchiveXL tag rules, entity-wide parts
 *   overrides). A v9 reader refuses v2 to v8 character records.
 * - `xfs/render-detail-10`: body components carry their part in the censorship policy (`censor`: the game's underwear `cover`, or a part
 *   `covered` by it, the uncensored skin), so every reader fails closed: a record whose covered parts outlive a cover withdraws the body
 *   (`withdrawUncoveredBody`), and covers are kept within the part cap. A v10 reader refuses v2 to v9 character records, whose body carried
 *   no such marker.
 */
export const RENDER_DETAIL_SCHEMA = "xfs/render-detail-1" as const;
export const CHARACTER_DETAIL_SCHEMA = "xfs/render-detail-10" as const;
/** Earlier character schemas a reader recognises only to refuse them plainly. */
export const RETIRED_CHARACTER_SCHEMAS: readonly string[] = ["xfs/render-detail-2", "xfs/render-detail-3", "xfs/render-detail-4", "xfs/render-detail-5",
  "xfs/render-detail-6", "xfs/render-detail-7", "xfs/render-detail-8", "xfs/render-detail-9"];

/**
 * A record from a host of another version: older (a retired schema) or newer (a schema this reader doesn't know yet). It means the host
 * and the page were built apart (the app was updated while it ran), so the presentation asks for a restart instead of saying nothing.
 */
export class RenderDetailVersionError extends Error {
  constructor(readonly direction: "older" | "newer", readonly schema: string) {
    super(`Render detail: the record version ${schema} is ${direction === "older" ? "retired; prepare it again" : "newer than this page reads"}.`);
  }
}
/** Whether a schema string names a render-detail version newer than this reader's. */
const newerSchema = (schema: unknown) => {
  const match = /^xfs\/render-detail-([0-9]{1,4})$/.exec(String(schema));
  return !!match && Number(match[1]) > Number(CHARACTER_DETAIL_SCHEMA.split("-").pop());
};

/** The longest CName a layer's value names are kept to in a record (the host cuts longer ones before writing; PIPE-40). */
export const CHOICE_NAME_MAX = 127;
/** A plain label the host words for the presentation: 1 to 127 characters, no control characters. */
export const isChoiceLabel = (value: unknown): value is string => typeof value === "string" && /^[^\u0000-\u001f\u007f]{1,127}$/.test(value);
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
/** The longest slot label and slot message the record carries. */
export const SLOT_LABEL_MAX = 199, SLOT_MESSAGE_MAX = 511;
/**
 * A list of names as one label within `max` characters (PIPE-56): as many whole names as fit, then "and N more". Mod-supplied names
 * are unbounded, so every label the host builds from them goes through this.
 */
export function clampedList(items: readonly string[], max = SLOT_LABEL_MAX): string {
  const all = items.join(", ");
  if (all.length <= max) return all;
  for (let n = items.length - 1; n >= 1; n--) {
    const shortened = `${items.slice(0, n).join(", ")} and ${items.length - n} more`;
    if (shortened.length <= max) return shortened;
  }
  const more = items.length > 1 ? ` and ${items.length - 1} more` : "";
  return clampedText(items[0] ?? "", max - more.length) + more;
}
/** Text cut to `max` characters with an ellipsis. */
export const clampedText = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1)}…`;
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
// The character record (the resolved head skin, face details, brows, lashes, hair, eyes, piercings and body of the player's own game).

export type DetailSlot = "skin" | "face" | "brows" | "lashes" | "hair" | "eyes" | "piercings" | "body" | "clothing";
/**
 * Record and load order: the skin first, so decals over it can blend against the resolved skin colour; then the body (its own skin loads
 * before its decals, and the head's parts keep their order and draw order), and the clothes last, over the body they follow.
 */
export const DETAIL_SLOTS: readonly DetailSlot[] = ["skin", "face", "brows", "lashes", "hair", "eyes", "piercings", "body", "clothing"];
/**
 * Slots whose decal chunks draw through the post-G-buffer decal family (face-decal-material.ts) over the skin under them: the face's
 * decals over the head, and the body's (tattoos, scars, the underwear cover) over the body.
 */
export const decalFamilySlot = (slot: DetailSlot) => slot === "face" || slot === "body";
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
  /** The layer template's depot path and where it was read, or null when the layer names none. */
  template: RenderSourceRef | null;
  /** The layer names a template the host could not read: its values are neutral, and the bake leaves the layer out (PREV-67). */
  templateUnreadable?: true;
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
  /**
   * Body components: the morph targets the resolver applied to this component (`<target>_<region>`, as the exported geometry names its
   * shape keys), each at full weight. Head parts follow the head's facial shapes instead.
   */
  morphs?: string[];
  /**
   * Garment components (the `clothing` slot): the clothing area and item record (the save's decimal TweakDB record ID) that brought it,
   * and its layer score (component prefix and size tag; null when its prefix has none), which orders coincident layers.
   */
  garment?: { area: string; item: string; layer: number | null };
  /**
   * Body components in the censorship policy (character-detail-plan.ts `censorRole`): a `cover` is the game's underwear; a `covered` part
   * (the uncensored skin) is drawn only while every cover of the record is (`withdrawUncoveredBody`).
   */
  censor?: "cover" | "covered";
};
/** One plain line for a body withdrawn because its underwear couldn't be read or loaded (PIPE-97). */
export const UNCOVERED_BODY = "XF Studio couldn't load the underwear the game draws on your V, so the body isn't shown.";
/**
 * The fail-closed rule every reader of a record applies (PIPE-97): a `covered` part is drawn only while the record's covers all are.
 * `covers` counts the covers the record lists and `present` the ones still there (parsed or loaded); if any covered part remains while a
 * cover is missing (or the record lists none), every body part is withdrawn: a body without its skin is not the body, and never more than
 * the underwear shows. Returns the parts kept and whether the body was withdrawn.
 */
export function withdrawUncoveredBody<T>(parts: readonly T[], componentOf: (part: T) => RenderComponent, covers: number): { kept: T[]; withdrawn: boolean } {
  const covered = parts.some(part => componentOf(part).censor === "covered");
  const present = parts.filter(part => componentOf(part).censor === "cover").length;
  if (!covered || (covers > 0 && present >= covers)) return { kept: [...parts], withdrawn: false };
  return { kept: parts.filter(part => componentOf(part).slot !== "body"), withdrawn: true };
}
export type DetailSlotState = { slot: DetailSlot; state: "shown" | "none" | "unavailable";
  /** Short plain label (the resolved choice), for the character panel. */
  label: string;
  /** One plain line when the slot could not be shown in full. */
  message?: string;
  /** A shown slot drawn only in part, as the host found it: `part-unread` when some of its parts couldn't be prepared (PIPE-84). */
  limits?: HostSlotLimit[] };
/**
 * The limit codes a host sets on a record's slot (detail-limits.ts words every code; this module stays free of it so pure engines that
 * read records reach nothing more). Each is also in `DETAIL_LIMITS`.
 */
export const HOST_SLOT_LIMITS = ["part-unread"] as const;
export type HostSlotLimit = typeof HOST_SLOT_LIMITS[number];
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

/** A framework that fills slots with inline components (one per filled slot) can bring many parts to one piercing choice. */
export const RECORD_LIMITS = Object.freeze({ components: 128, chunks: 64, params: 160, textures: 16, stops: 32, layers: 20, notes: 64,
  /**
   * Decoded texels one record may serve, over every distinct texture (PIPE-43): about four times what the reference save's skin, hair,
   * face details, eyes and piercings take together. The host leaves textures beyond it out with a note; the loader refuses a record
   * over it before decoding anything.
   */
  decodedPixels: 256 * 1024 * 1024 });
const LIMITS = RECORD_LIMITS;
/**
 * Plausible ranges for a layer's stored numbers (PIPE-43). Vanilla setups and templates stay far inside them; a hostile or broken
 * value (a tile of 1e38 makes the sampling coordinate NaN) is clamped by the host's readers and again by the bake.
 */
export const LAYER_RANGES = Object.freeze({ opacity: [0, 1], tile: [-256, 256], offset: [-256, 256], contrast: [0, 16], normal: [-16, 16],
  colour: [0, 16], levels: [-64, 64], ratio: [1 / 64, 64], tableEntries: [0, 4096] } as const);
/** A finite number clamped to one of `LAYER_RANGES`, or the fallback when it is not a finite number. */
export function clampLayer(value: unknown, range: keyof typeof LAYER_RANGES, fallback: number): number {
  const [low, high] = LAYER_RANGES[range];
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}
/** Plain words per slot: the noun, and "aren't … they" or "isn't … it". */
export const SLOT_WORDS: Readonly<Record<DetailSlot, { noun: string; not: string; pronoun: string }>> = Object.freeze({
  skin: { noun: "skin", not: "isn't", pronoun: "it" }, face: { noun: "face details", not: "aren't", pronoun: "they" }, brows: { noun: "eyebrows", not: "aren't", pronoun: "they" }, lashes: { noun: "eyelashes", not: "aren't", pronoun: "they" },
  hair: { noun: "hair", not: "isn't", pronoun: "it" }, eyes: { noun: "eyes", not: "aren't", pronoun: "they" },
  piercings: { noun: "piercings", not: "aren't", pronoun: "they" }, body: { noun: "body", not: "isn't", pronoun: "it" },
  clothing: { noun: "clothes", not: "aren't", pronoun: "they" } });
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
  if (item.templateUnreadable !== undefined && item.templateUnreadable !== true) fail(`${what} template flag is invalid.`);
  return { template: item.template === null ? null : sourceRef(item.template, `${what} template`),
    ...(item.templateUnreadable ? { templateUnreadable: true as const } : {}),
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
  const morphs = item.morphs;
  if (morphs !== undefined && (!Array.isArray(morphs) || morphs.length > 16)) fail(`${what} morphs are invalid.`);
  const censor = item.censor;
  if (censor !== undefined && (item.slot !== "body" || (censor !== "cover" && censor !== "covered"))) fail(`${what} censorship part is invalid.`);
  const garment = item.garment;
  if (garment !== undefined && (!garment || typeof garment !== "object" || item.slot !== "clothing" || !/^[A-Za-z]{1,32}$/.test(String(garment.area)) ||
    !/^[1-9][0-9]{0,19}$/.test(String(garment.item)) || !(garment.layer === null || (Number.isInteger(garment.layer) && Math.abs(garment.layer) <= 100_000))))
    fail(`${what} garment is invalid.`);
  return { id: text(item.id, `${what} id`), slot: item.slot, option: text(item.option, `${what} option`),
    definition: text(item.definition, `${what} definition`), component: text(item.component, `${what} component`),
    geometry: { ...resource(geometry, `${what} geometry`), depotPath: text(geometry?.depotPath, `${what} geometry path`),
      depotHash: /^[0-9]{1,20}$/.test(String(geometry?.depotHash)) ? String(geometry.depotHash) : fail(`${what} geometry hash is invalid.`),
      morphTargets: typeof geometry?.morphTargets === "boolean" ? geometry.morphTargets : fail(`${what} geometry kind is missing.`) },
    renderChunks, chunks, materials,
    ...(rule ? { morphTexture: { morph: text(rule.morph, `${what} morph`), texture: rule.texture === null ? null : text(rule.texture, `${what} morph texture`),
      parameter: rule.parameter === null ? null : paramName(rule.parameter, `${what} morph texture parameter`) } } : {}),
    ...(morphs ? { morphs: morphs.map((name, k) => paramName(name, `${what} morph ${k}`)) } : {}),
    ...(garment ? { garment: { area: garment.area, item: garment.item, layer: garment.layer } } : {}), ...(censor ? { censor } : {}) };
}
/** A record entry that says it is a cover (before it is parsed: a cover the parser drops still counts, so its covered parts go too). */
const isRawCover = (item: unknown) => !!item && typeof item === "object" && (item as RenderComponent).slot === "body" && (item as RenderComponent).censor === "cover";

/**
 * Parse of a character record: an unexpected field shape never reaches the loader. The record's frame (schema, origin, character, slot
 * outcomes) is strict; its parts are not all-or-nothing (PIPE-40): a component that breaks a rule is
 * left out with a note, and a slot left with nothing to show becomes unavailable with one plain line. Components beyond
 * `RECORD_LIMITS.components` are left out the same way. A record of another version throws `RenderDetailVersionError`. Parsing its own
 * output again changes nothing, which the host relies on (it writes this parser's output).
 */
export function parseCharacterDetail(value: unknown): CharacterDetail {
  const doc = value as CharacterDetail;
  if (RETIRED_CHARACTER_SCHEMAS.includes(String(doc?.schema)) && doc?.detail === "character") throw new RenderDetailVersionError("older", String(doc.schema));
  if (doc?.detail === "character" && newerSchema(doc.schema)) throw new RenderDetailVersionError("newer", String(doc.schema));
  if (!doc || doc.schema !== CHARACTER_DETAIL_SCHEMA || doc.detail !== "character") fail("not a character record.");
  if (doc.origin !== "game-files") fail("origin is invalid.");
  if (doc.character?.source !== "default" && doc.character?.source !== "save") fail("character source is invalid.");
  if (doc.character.bodyGender !== "female" && doc.character.bodyGender !== "male") fail("body gender is invalid.");
  const left: string[] = [];
  const dropped = (what: string) => { left.push(what); };
  if (!Array.isArray(doc.components)) fail("components are invalid.");
  const parsedParts: RenderComponent[] = [], ids = new Set<string>();
  // The covers are kept within the part cap first (PIPE-97): the parts they cover are never kept while they are cut.
  const covers = Math.min(LIMITS.components, doc.components.filter(isRawCover).length);
  let others = 0, keptCovers = 0;
  doc.components.forEach((item, index) => {
    const cover = isRawCover(item);
    if (cover ? keptCovers >= covers : others >= LIMITS.components - covers) { dropped(`a part beyond the first ${LIMITS.components}`); return; }
    if (cover) keptCovers++; else others++;
    let parsed: RenderComponent;
    try { parsed = component(item, index); } catch { dropped(`${DETAIL_SLOTS.includes((item as RenderComponent)?.slot) ? `a ${(item as RenderComponent).slot}` : "a"} part`); return; }
    if (ids.has(parsed.id)) { dropped(`a repeated ${parsed.slot} part`); return; }
    ids.add(parsed.id); parsedParts.push(parsed);
  });
  // Every cover the record lists must have been kept for the parts it covers to be (fail closed).
  const { kept: components, withdrawn } = withdrawUncoveredBody(parsedParts, part => part, doc.components.filter(isRawCover).length);
  if (withdrawn) dropped("the body, because the underwear the game draws on it couldn't be read");
  if (!Array.isArray(doc.slots) || doc.slots.length !== DETAIL_SLOTS.length) fail("slot outcomes are invalid.");
  const slots = DETAIL_SLOTS.map((slot): DetailSlotState => {
    const entry = doc.slots.find(item => item?.slot === slot);
    if (!entry || !["shown", "none", "unavailable"].includes(entry.state)) return fail(`${slot} outcome is invalid.`);
    // A label or message too long for the record is cut with a note rather than refusing the V (PIPE-56).
    if (typeof entry.label !== "string") return fail(`${slot} label is invalid.`);
    if (entry.label.length > SLOT_LABEL_MAX) dropped(`the end of the ${slot} label`);
    const label = clampedText(entry.label, SLOT_LABEL_MAX);
    if (typeof entry.message === "string" && entry.message.length > SLOT_MESSAGE_MAX) dropped(`the end of the ${slot} message`);
    const message = entry.message === undefined ? undefined : text(typeof entry.message === "string" ? clampedText(entry.message, SLOT_MESSAGE_MAX) : entry.message, `${slot} message`);
    if (slot === "body" && withdrawn) return { slot, state: "unavailable", label, message: UNCOVERED_BODY };
    if (entry.state === "shown" && !components.some(item => item.slot === slot)) {
      const { noun, not, pronoun } = SLOT_WORDS[slot];
      return { slot, state: "unavailable", label, message: `XF Studio couldn't read your V's ${noun} from the prepared details, so ${pronoun} ${not} shown.` };
    }
    // Limit codes this reader knows, on a shown slot only; another version's codes are left out.
    const limits = entry.state === "shown" && Array.isArray(entry.limits)
      ? [...new Set((entry.limits as unknown[]).filter((code): code is HostSlotLimit => (HOST_SLOT_LIMITS as readonly unknown[]).includes(code)))] : [];
    return { slot, state: entry.state, label, ...(message === undefined ? {} : { message }), ...(limits.length ? { limits } : {}) };
  });
  const notes = Array.isArray(doc.provenance?.notes) ? doc.provenance.notes.map(entry => text(entry, "note")) : [];
  if (left.length) {
    const counts = new Map<string, number>();
    for (const what of left) counts.set(what, (counts.get(what) ?? 0) + 1);
    notes.push(`Left out of the prepared details: ${[...counts].slice(0, 6).map(([what, n]) => n > 1 ? `${what} (${n})` : what).join(", ")}${counts.size > 6 ? " and more" : ""}.`.slice(0, 500));
  }
  return { schema: CHARACTER_DETAIL_SCHEMA, detail: "character", identity: text(doc.identity, "identity"), origin: "game-files",
    character: { source: doc.character.source, bodyGender: doc.character.bodyGender },
    provenance: { label: text(doc.provenance?.label, "provenance label"), notes: notes.slice(-LIMITS.notes),
      ...(doc.provenance?.tool === undefined ? {} : { tool: text(doc.provenance.tool, "provenance tool") }) },
    components, slots };
}

/** Version dispatch: a v1 record is a core head; a later record is a core head or, under the current schema, a character. */
export function parseRenderDetail(value: unknown): CoreDetail | CharacterDetail {
  const doc = value as { schema?: unknown; detail?: unknown };
  if (doc?.detail === "character") return parseCharacterDetail(value);
  if (doc?.schema === RENDER_DETAIL_SCHEMA || doc?.schema === CHARACTER_DETAIL_SCHEMA || RETIRED_CHARACTER_SCHEMAS.includes(String(doc?.schema)))
    return parseCoreDetail(value);
  if (newerSchema(doc?.schema)) throw new RenderDetailVersionError("newer", String(doc?.schema));
  return fail(`unsupported record version ${String(doc?.schema)}.`);
}
