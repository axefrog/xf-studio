/**
 * Pure selection step between the generic resolver and the character render record: which resolved
 * drawing components are the V's head skin, face details, brows, lashes, hair, eyes, piercings and body, which of their chunks the preview can
 * draw, and each chunk's effective material inputs (instance chain first, then the template's defaults, then the
 * morph target's `baseTexture` rule).
 *
 * Everything is decided from the game's own data, never from mod identities:
 * - **Slot** comes from the character-creator option's `uiSlot` in the effective (merged) CCO. Vanilla and
 *   CCXL options share the vanilla slots (`skin_type`, `eyebrows_color`, `eyelash_color`, `hair_color`, `eyes_color`)
 *   [resource]. The eye colour's appearance draws the eye component: its eyeball chunk (`eye.mt`, `eye_gradient.mt`
 *   or `multilayered.mt`) and its wetness shell (`eye_shadow.mt`). A chunk's role comes from its template, never
 *   its index: the male eye mesh swaps the two (knowledge/eye-rendering.md §1). The skin type's appearance draws the head itself: its morph-target component carries the
 *   `skin.mt` chunk whose instance chain holds the tone (knowledge/head-cc-rendering.md §2).
 * - **Consumer** is the third-person head: only choices listed in the `TPP` or `hairs` groups draw on the
 *   third-person puppet (the FPP hair twins sit in `FPP_hairs`) [resource; consumer wiring hypothesis].
 * - **Level of detail**: the preview draws the highest-detail level (chunks whose LOD mask has bit 0), as a
 *   creator close-up would; lower levels are the same parts again [resource: render chunk `lodMask`].
 * - **Scene chunks**: a chunk draws only when its `renderMask` has `MCF_RenderInScene`; a shadow-only chunk (`MCF_RenderInShadows`
 *   alone: every vanilla hair `*_shadow` mesh) casts shadows and is never drawn [resource: the render blob's chunk flags]. This is
 *   what used to be guessed per slot; a layered chunk now draws on whichever slot brings it (knowledge/head-cc-rendering.md §4).
 * - **Unlisted chunks**: a chunk past the end of its appearance's chunk material list has no material of its own (CCXL hair points its
 *   lower levels of detail at three-vertex stubs this way) and is neither drawn nor counted as skipped (character-resolver.ts `unlistedChunk`).
 * - **Drawable chunks** are those whose material template the renderer has an adapter for
 *   (render-templates.ts). A chunk with none (`glass.mt`, `metal_base.remt`) is left out. A placeholder template (a decal the
 *   preview can't draw yet) is recorded beside drawn chunks, so the renderer can say plainly that part is not shown, but never
 *   makes a component drawable on its own.
 * - **Morph texture rule**: a morph target's `baseTexture` replaces its named parameter's texture (the vanilla eye
 *   morph binds a flat `normal.xbm` to `Normal`; ArchiveXL's eye fix clears it) [hypothesis, eye-rendering.md §1.3].
 * - **Template identity**: a chunk's adapter is chosen by its template's own name (the name the engine finds compiled
 *   programs by), read by the host from the `.mt`; a copied template (e.g. a `mesh_decal` copy with `EMP_Front`) keeps it.
 * - **Face details** (the `face` slot) are chosen by the game's own structure, never by option names: every head choice
 *   consumed by the third-person head's face (`TPP`, `face` or `beards` groups) whose option no other detail claims, drawn
 *   by its components' post-G-buffer decal chunks (the `mesh_decal` family). Vanilla makeup, lipstick, cheeks, blemishes,
 *   scars, tattoos, face cyberware and stubble, and any CCXL option that adds such a decal, qualify the same way;
 *   piercings (layered earrings), teeth (skin) and the face rig do not. The skin type's own decal parts (the personal-link
 *   port) join the face details. Components are ordered by the creator resource's option order (merged CCO, so CCXL
 *   options follow vanilla), the documented fallback for the unknown order between same-priority decals
 *   (knowledge/head-cc-rendering.md §3).
 * - **Piercings** (the `piercings` slot) are the choices on the creator's piercing slot (`piercings_color`), consumed by the face
 *   groups like the face details. Each drawing component of the resolved appearance is planned with its own chunk mask, so a vanilla
 *   style, a framework that replaces the style's `.app` (inline components, one per filled slot; zero-chunk placeholders draw
 *   nothing) and a CCXL option on the slot all resolve through the same rules (knowledge/cc-file-chain.md §6). Their chunks are layered
 *   (`multilayered.mt`): each carries its `.mlsetup` and `.mlmask` references for the host to read into the chunk's layer stack.
 * - **Body** (the `body` slot) is the third-person body the body's consumers read (`BODY_GROUPS`, the feet state's group), less what the
 *   creator's own censorship rules leave under the game's underwear cover (`bodyOptionDraws`); each body component carries the shapes the
 *   resolver applied to it (breast size, nail length), and never follows the face (knowledge/body-rendering.md).
 * - **Clothing** (the `clothing` slot) is what the worn items draw (clothing-resolver.ts): each drawn item's components with their chunk masks,
 *   lower layers first (the layer score: component prefix and size tag), each carrying its clothing area, item record and score. The
 *   body resolves with the items' overrides already applied (its chunk masks), and in the feet group the footwear sets.
 * - **Choices** a viewer makes are the character context's (character-context.ts): the host derives the whole V from them with the
 *   shared R5 rules before planning, so the record lists no choices to try and no override (CORE-58, PIPE-82). An option a slot's
 *   switcher activates belongs to that slot even when its own `uiSlot` is another (`detailSlotOf`).
 */
import { switcherReach, type CcoOption, type CcoResource } from "./cco-model";
import type { CharacterInput, ResolvedAppearance, ResolvedCharacter, ResolvedChunkMaterial, ResolvedComponent, ResolvedParam } from "./character-resolver";
import { refLabel } from "./depot-path";
import type { DetailSlot, DetailSlotState, RenderMorphTexture, RenderRgba } from "./render-detail";
import { clampedList, decalFamilySlot, DETAIL_SLOTS, isChoiceLabel, SLOT_WORDS } from "./render-detail";
import { renderTemplate, templateTextures } from "./render-templates";
import type { Provenance } from "./resource-graph";
import type { ClothingFailure, ResolvedClothing } from "./clothing-resolver";

/** Creator slot → preview detail. Vanilla slot names from the game's character-creator resource. */
export const DETAIL_UI_SLOTS: Readonly<Record<string, DetailSlot>> = Object.freeze({
  skin_type: "skin", eyebrows_color: "brows", eyelash_color: "lashes", hair_color: "hair", eyes_color: "eyes", piercings_color: "piercings" });
/** Groups consumed by the third-person head and hair controllers. */
export const THIRD_PERSON_GROUPS: readonly string[] = ["TPP", "hairs"];
/**
 * Groups whose choices the third-person head's face draws: `TPP` (tattoos, scars, blemishes), `face` (the face controller's
 * makeup, face cyberware and piercings, where CCXL makeup lands) and `beards` (the male beard controller) [resource;
 * consumer wiring hypothesis]. `character_customization` alone is the creator puppet; `finalSceneBruises` is quest-driven.
 */
export const FACE_GROUPS: readonly string[] = ["TPP", "face", "beards"];
/** The groups whose choices draw each slot on the third-person head: the face controller's for piercings, the head and hair controllers' otherwise. */
export const slotGroups = (slot: DetailSlot): readonly string[] => slot === "piercings" || slot === "face" ? FACE_GROUPS : THIRD_PERSON_GROUPS;
/**
 * Plain words for the face details the vanilla creator slots hold, for the label only (selection never uses them);
 * a CCXL option on a slot of its own reads "face detail".
 */
export const FACE_DETAIL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  makeupEyes_color: "eye makeup", makeupLips_color: "lipstick", makeupCheeks_color: "cheeks", makeupPimples_color: "blemishes",
  scars: "scar", facial_tattoo: "tattoo", tattoo: "tattoo", cyberware: "face cyberware", beard_color: "beard", skin_type: "personal link" });

export type PlannedChunk = {
  chunk: number; name: string; template: string | null;
  /** The template's own name and `materialPriority`, when the host could read the template. */
  templateName: string | null; materialPriority: string | null;
  /** The renderer has an adapter for the template; `placeholder` when that adapter only reports the chunk as not drawn. */
  drawn: boolean; placeholder: boolean;
  scalars: Record<string, number>; colours: Record<string, RenderRgba>;
  textures: Record<string, Provenance>; profiles: Record<string, Provenance>; skinProfiles: Record<string, Provenance>;
  gradients: Record<string, Provenance>;
  /** A layered chunk's `.mlsetup` and `.mlmask` (null when the chain names none). */
  layered: { setup: Provenance; mask: Provenance | null } | null;
};
export type PlannedComponent = {
  slot: DetailSlot; option: string; definition: string; component: string;
  /** Resource to export as geometry, and whether it is a morph target (facial shapes follow the head). */
  drawnFrom: Provenance; morphTargets: boolean;
  renderChunks: number; chunks: number[]; materials: PlannedChunk[];
  /** Chunks that are visible in game but not drawn by the preview (unsupported template). */
  skippedChunks: number;
  /** Morph components: the effective `baseTexture` rule (already applied to `materials`). */
  morphTexture: { morph: Provenance; texture: Provenance | null; parameter: string } | null;
  /** Body components: the morph targets the resolver applied (`<target>_<region>`); absent on head parts, which follow the facial shapes. */
  morphs?: string[];
  /** Garment components: the clothing area and item record that brought it, and its layer score. */
  garment?: { area: string; item: string; layer: number | null };
  /**
   * How the reader read this part's files, when that may differ from the game (resource-graph.ts `readerRuleNotes`): a value stored with
   * an older type, a watched property left out. The record's notes carry them.
   */
  readerNotes?: string[];
  /**
   * Body components in the censorship policy (`censorRole`): a `cover` (the game's underwear), or a part `covered` by the covers (the
   * uncensored skin), which is drawn only while every cover is.
   */
  censor?: "cover" | "covered";
};
export type CharacterPlan = { components: PlannedComponent[]; slots: DetailSlotState[];
  /**
   * The game's censored body skin, planned beside the covered one: the host serves it in place of every `covered` component when a cover
   * can't be served (character-detail-service.ts). Empty when the creator resource has no censored twin or it can't be drawn.
   */
  censoredBody: PlannedComponent[] };
/** Template defaults per template depot path (lower case), read by the host from the `.mt`. */
export type TemplateDefaults = ReadonlyMap<string, readonly ResolvedParam[]>;
/** A template's own `name` and `materialPriority` per template depot path (lower case), read by the host from the `.mt`. */
export type TemplateIdentities = ReadonlyMap<string, { name: string | null; priority: string | null }>;

/** Plain words per slot (render-detail.ts, where the record reader uses them too). */
export { SLOT_WORDS };

/** A plain colour or style label from a definition name (`female__05_brown_liquorice` → `brown liquorice`). */
export function choiceLabel(definition: string): string {
  const tail = definition.split("__").pop() ?? definition;
  const words = tail.replace(/^[0-9]+_/, "").replace(/_/g, " ").trim();
  return words || definition;
}

/**
 * A plain skin label from the tone definition and the skin-type option (`h0_000_pwa__basehead__03_ca_senna`,
 * `skin_type_03` → `senna, skin type 3`). Index numbers and the short group code before the tone name are dropped.
 */
export function skinLabel(option: string, definition: string): string {
  const tail = (definition.split("__").pop() ?? definition).split("_").filter(word => word && !/^[0-9]+$/.test(word));
  if (tail.length > 1 && tail[0]!.length <= 2) tail.shift();
  const type = option.replace(/_0*([0-9]+)$/, " $1").replace(/_/g, " ").trim();
  const tone = tail.join(" ");
  return tone ? `${tone}, ${type}` : type;
}

function parseScalar(param: ResolvedParam): number | RenderRgba | null {
  if (param.kind !== "scalar") return null;
  let value: unknown;
  try { value = JSON.parse(param.value); } catch { return null; }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const colour = value as { $type?: string; Red?: number; Green?: number; Blue?: number; Alpha?: number } | null;
  if (colour && colour.$type === "Color") {
    const channels = [colour.Red, colour.Green, colour.Blue, colour.Alpha ?? 255];
    if (channels.every(c => Number.isInteger(c) && c! >= 0 && c! <= 255)) return channels as RenderRgba;
  }
  return null;
}

/** Instance values nearest-first, then the template's defaults for everything the chain leaves unset. */
export function effectiveParams(material: ResolvedChunkMaterial, defaults: TemplateDefaults): ResolvedParam[] {
  const own = new Map(material.params.map(param => [param.name, param]));
  const template = material.template ? defaults.get(refLabel(material.template.ref).toLowerCase()) ?? [] : [];
  for (const param of template) if (!own.has(param.name)) own.set(param.name, param);
  return [...own.values()];
}

/** The morph `baseTexture` rule for one chunk: the replacement texture when it names a texture input the adapter reads. */
export function morphTextureOverride(rule: PlannedComponent["morphTexture"], textureInputs: readonly string[]): [string, Provenance] | null {
  if (!rule?.texture || !rule.parameter || !textureInputs.includes(rule.parameter) || !/\.xbm$/i.test(rule.texture.ref.path ?? "")) return null;
  return [rule.parameter, rule.texture];
}

/** Whether a template belongs to the post-G-buffer decal family (drawn, or recorded as not drawn yet). */
const isDecal = (inputs: ReturnType<typeof renderTemplate>) => !!inputs && (!!inputs.decal || inputs.adapter === "decal-placeholder");
/** A resolved chunk's template inputs, by the template's own name when the host read it. */
const chunkTemplate = (material: ResolvedChunkMaterial, identities: TemplateIdentities) => {
  const template = material.template ? refLabel(material.template.ref) : null;
  return renderTemplate(template, template ? identities.get(template.toLowerCase())?.name : null);
};

/** Plan one chunk of a slot's component. On the face only decal-family templates draw, with the decal family's inputs. */
function planChunk(material: ResolvedChunkMaterial, defaults: TemplateDefaults, rule: PlannedComponent["morphTexture"],
  identities: TemplateIdentities, slot: DetailSlot): PlannedChunk {
  const faceDetail = slot === "face", decals = decalFamilySlot(slot);
  const template = material.template ? refLabel(material.template.ref) : null;
  const identity = template ? identities.get(template.toLowerCase()) : undefined;
  const found = renderTemplate(template, identity?.name);
  const inputs = found && (!faceDetail || isDecal(found)) ? found : undefined;
  const chunk: PlannedChunk = { chunk: material.chunk, name: material.name, template, templateName: identity?.name ?? null,
    materialPriority: identity?.priority ?? null, drawn: !!inputs, placeholder: !!inputs?.placeholder,
    scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {}, layered: null };
  if (!inputs) return chunk;
  const textureInputs = templateTextures(inputs, decals);
  for (const param of effectiveParams(material, defaults)) {
    const scalar = parseScalar(param);
    if (typeof scalar === "number") chunk.scalars[param.name] = scalar;
    else if (scalar) chunk.colours[param.name] = scalar;
    else if (param.kind === "resource" && param.resource?.ref.path) {
      if (textureInputs.includes(param.name) && /\.xbm$/i.test(param.resource.ref.path)) chunk.textures[param.name] = param.resource;
      if (inputs.profiles.includes(param.name) && /\.hp$/i.test(param.resource.ref.path)) chunk.profiles[param.name] = param.resource;
      if (inputs.skinProfiles.includes(param.name) && /\.sp$/i.test(param.resource.ref.path)) chunk.skinProfiles[param.name] = param.resource;
      if (inputs.gradients?.includes(param.name) && /\.gradient$/i.test(param.resource.ref.path)) chunk.gradients[param.name] = param.resource;
    }
  }
  if (inputs.layered) {
    const params = effectiveParams(material, defaults);
    const layered = (name: string, extension: RegExp) => {
      const param = params.find(entry => entry.name === name);
      return param?.kind === "resource" && param.resource?.ref.path && extension.test(param.resource.ref.path) ? param.resource : null;
    };
    const setup = layered(inputs.layered.setup, /\.mlsetup$/i);
    if (setup) chunk.layered = { setup, mask: layered(inputs.layered.mask, /\.mlmask$/i) };
  }
  const override = morphTextureOverride(rule, textureInputs);
  if (override) chunk.textures[override[0]] = override[1];
  return chunk;
}

function planComponent(slot: DetailSlot, entry: ResolvedAppearance, component: ResolvedComponent,
  defaults: TemplateDefaults, identities: TemplateIdentities = new Map()): PlannedComponent | null {
  const geometry = component.geometry;
  if (!geometry || geometry.drawsNothing || !geometry.drawnFrom || geometry.drawnFrom.status !== "archive" || !geometry.visibleChunks?.length ||
      !geometry.renderChunks) return null;
  const lods = geometry.chunkLods, scene = geometry.chunkInScene;
  const morphTexture = geometry.morphTexture && geometry.morphTarget
    ? { morph: geometry.morphTarget, texture: geometry.morphTexture.texture, parameter: geometry.morphTexture.parameter } : null;
  // The highest level of detail, and only chunks the scene draws (a shadow-only chunk is neither drawn nor "skipped"). A chunk past the
  // end of its appearance's chunk material list has no material of its own (a CCXL stub chunk), so it is not "skipped" either.
  const materials = component.materials.filter(material => (!lods || ((lods[material.chunk] ?? 1) & 1) === 1) && scene?.[material.chunk] !== false &&
      material.route !== "none")
    .map(material => planChunk(material, defaults, morphTexture, identities, slot));
  const drawn = materials.filter(material => material.drawn);
  // A face or body decal made only of decal templates the preview can't draw yet is still recorded, so the renderer can say so.
  if (decalFamilySlot(slot) ? !drawn.length : !drawn.some(material => !material.placeholder)) return null;
  const readerNotes = [...new Set([...entry.notes, ...component.notes].filter(item => READER_RULES.has(item.rule)).map(item => item.basis))];
  return { slot, option: entry.option, definition: entry.definition, component: component.name, drawnFrom: geometry.drawnFrom,
    morphTargets: component.type === "entMorphTargetSkinnedMeshComponent", renderChunks: geometry.renderChunks,
    chunks: drawn.map(material => material.chunk), materials: drawn, skippedChunks: materials.length - drawn.length, morphTexture,
    ...(slot === "body" ? { morphs: [...new Set(component.appliedMorphs.map(morph => `${morph.target}_${morph.region}`))].slice(0, 16) } : {}),
    ...(readerNotes.length ? { readerNotes: readerNotes.slice(0, 4) } : {}) };
}
/** The resolver's notes about how a file was read (resource-graph.ts `readerRuleNotes`). */
const READER_RULES = new Set(["R11-stored-type", "R12-property-absent"]);

/** The record's form of a planned morph texture rule. */
export const recordMorphTexture = (rule: PlannedComponent["morphTexture"]): RenderMorphTexture | undefined =>
  rule ? { morph: refLabel(rule.morph.ref), texture: rule.texture ? refLabel(rule.texture.ref) : null, parameter: rule.parameter || null } : undefined;

/** Whether a planned component draws only decal-family chunks (the skin type's personal-link port, for example). */
const decalOnly = (component: PlannedComponent) => component.materials.every(material => isDecal(renderTemplate(material.template, material.templateName)));

/**
 * The face details: the V's own decals over the head, in the draw-order fallback (creator option order), and one outcome.
 * `skinDecals` are the decal parts the skin type's appearance brings.
 */
function planFace(resolved: ResolvedCharacter, cco: CcoResource, defaults: TemplateDefaults, identities: TemplateIdentities,
  skinDecals: readonly { entry: ResolvedAppearance; component: ResolvedComponent }[]): { components: PlannedComponent[]; state: DetailSlotState } {
  const options = new Map(cco.parts.head.options.map((option, index) => [option.name, { option, index }]));
  const toneLinks = new Set(cco.parts.head.options.filter(option => option.uiSlot === "skin_type" && option.link).map(option => option.link));
  const claimed = detailSlotOf(cco);
  const entries = resolved.appearances.filter(entry => entry.part === "head" && !claimed.has(entry.option) &&
    entry.groups.some(group => FACE_GROUPS.includes(group)));
  const planned: { component: PlannedComponent; order: number; label: string }[] = [];
  const unshown: string[] = [];
  const label = (entry: ResolvedAppearance) => {
    const option = options.get(entry.option)?.option;
    const word = FACE_DETAIL_WORDS[option?.uiSlot ?? ""] ?? "face detail";
    // A colour that follows the skin tone (tattoos, face cyberware) is the tone, not a choice worth repeating.
    const colour = option && toneLinks.has(option.link) ? "" : choiceLabel(entry.definition);
    return colour && colour !== word ? `${word} (${colour})` : word;
  };
  for (const { entry, component } of skinDecals) {
    const item = planComponent("face", entry, component, defaults, identities);
    if (item) planned.push({ component: item, order: options.get(entry.option)?.index ?? -1, label: FACE_DETAIL_WORDS.skin_type! });
  }
  for (const entry of entries) {
    const items = entry.components.map(component => planComponent("face", entry, component, defaults, identities))
      .filter((item): item is PlannedComponent => !!item);
    const order = options.get(entry.option)?.index ?? Number.MAX_SAFE_INTEGER;
    if (items.length) { for (const item of items) planned.push({ component: item, order, label: label(entry) }); continue; }
    // A face decal that resolved but can't be drawn (its geometry is missing) is reported. Layered earrings, the teeth and
    // the face rig are not decals and stay out silently.
    if (entry.components.some(component => component.materials.some(material => isDecal(chunkTemplate(material, identities)))))
      unshown.push(label(entry));
  }
  // Stable: components of one choice keep their order.
  planned.sort((a, b) => a.order - b.order);
  const labels = [...new Set(planned.map(item => item.label))];
  const components = planned.map(item => item.component);
  if (!components.length && !unshown.length) return { components, state: { slot: "face", state: "none", label: "None" } };
  const { noun, not, pronoun } = SLOT_WORDS.face;
  // Labels come from mod-supplied names: bounded, so one long name never costs the V its record (PIPE-56).
  const missing = clampedList([...new Set(unshown)], 160);
  if (!components.length) return { components, state: { slot: "face", state: "unavailable", label: clampedList([...new Set(unshown)]),
    message: `XF Studio can't draw your V's ${noun} (${missing}) yet, so ${pronoun} ${not} shown.` } };
  return { components, state: { slot: "face", state: "shown", label: clampedList(labels),
    ...(unshown.length ? { message: `Some of your V's ${noun} (${missing}) ${not} shown yet.` } : {}) } };
}

/**
 * Groups the third-person body's consumers read [resource: the creator resources' `perspectiveInfo` and groups]:
 * - body part: `TPP_Body` (the third-person half of the `FPP_Body` perspective pair: the body skin, nipples, body tattoos and scars, the
 *   censorship underwear) and `genitals` (the genitals controller's lower group), plus the feet controller's group for the feet state
 *   (`FEET_GROUPS`);
 * - arms part: the default holster state's third-person group, `holstered_default_tpp` (feminine; the masculine creator resource does
 *   not split it: `holstered_default`). The other states belong to equipped arm cyberware, which a creator V never has.
 * The breast size (group `breast`) and nail length (`nails`) are morphs, applied to every body component that carries the pair.
 */
export const BODY_GROUPS: Readonly<Record<"body" | "arms", readonly string[]>> = Object.freeze({
  body: ["TPP_Body", "genitals"], arms: ["holstered_default_tpp", "holstered_default"] });
/**
 * The feet state (female V; the masculine creator resource has no feet groups): `flat` with no footwear, `lifted` in ordinary shoes
 * [wiki: ArchiveXL's `{feet}` substitution table]. Worn footwear (a later step) sets it; the V without clothing stands on flat feet. The
 * `HighHeels` and `FlatShoes` states are garment tags that mask body chunks instead of choosing a creator group (knowledge/clothing.md §4.3).
 */
export type FeetState = "flat" | "lifted";
export const FEET_GROUPS: Readonly<Record<FeetState, string>> = Object.freeze({ flat: "flat_feet", lifted: "lifted_feet" });
/** The body's state as worn items would set it; the default is the V with no clothing. */
export type BodyState = { readonly feet: FeetState };
export const DEFAULT_BODY_STATE: BodyState = Object.freeze({ feet: "flat" });
/** The groups the third-person body reads in one part for a body state. */
export const bodyGroups = (part: "body" | "arms", state: BodyState = DEFAULT_BODY_STATE): readonly string[] =>
  part === "body" ? [...BODY_GROUPS.body, FEET_GROUPS[state.feet]] : BODY_GROUPS.arms;
/** Plain words for the body's parts, by creator slot, for the label only (selection never uses them); others read "arms" or "body detail". */
export const BODY_DETAIL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  body_color: "body", flat_feet: "feet", lifted_feet: "feet", underpants: "underwear", body_tattoo: "tattoo", body_scars: "scars",
  nails_color: "nails", nipples: "nipples", genitals: "genitals" });

/**
 * A body option as the censorship policy reads it: its creator slot, link, kind and censorship rule (a `CcoOption` or the catalogue's
 * coverage input; `type` and `link` absent read as an appearance option without a link).
 */
export type CensorOption = { readonly name: string; readonly uiSlot: string; readonly type?: string;
  readonly link?: string | { readonly key: string } | null; readonly censor?: { readonly flag: string; readonly action: "activate" | "deactivate" } };
/**
 * A body option's part in the preview's censorship policy (knowledge/body-rendering.md §3). The preview shows the V as the game does with
 * nudity allowed and no clothing, under the game's own censorship underwear; the policy (never more than the game's uncensored mode, with
 * underwear on) is the Studio's, each rule's data the creator resource's:
 * - `plain`: no censorship rule, or not an appearance (morphs always apply: the breast size shapes the body under the underwear); draws;
 * - `cover`: an option the rule only turns on, with no twin (the underwear); draws, standing in for the underwear V wears in game;
 * - `uncensored`: the one of a swapped pair the rule turns off (the body skin, whose albedo carries the female nipples); draws **only while
 *   every cover draws** (the plan, the host, the record reader and the loader each fail closed on it);
 * - `censored`: its twin the rule turns on (the game's own censored skin); draws only in place of the uncensored one when a cover can't;
 * - `hidden`: an option the rule turns off with no twin (nipples, genitals); never draws, the underwear sits over it;
 * - `unknown`: not in the merged creator resource; never draws (PIPE-98).
 * A twin is another appearance option on the same creator slot and link with the same flag and the opposite action.
 */
export type CensorRole = "plain" | "cover" | "uncensored" | "censored" | "hidden" | "unknown";
const linkKey = (link: CensorOption["link"]) => typeof link === "string" ? link : link?.key ?? "";
const isAppearance = (option: CensorOption) => option.type === undefined || option.type === "appearance";
export function censorRole(options: readonly CensorOption[], name: string): CensorRole {
  const option = options.find(entry => entry.name === name);
  if (!option) return "unknown";
  const rule = option.censor;
  if (!rule || !isAppearance(option)) return "plain";
  const twin = !!option.uiSlot && options.some(other => other !== option && isAppearance(other) && other.uiSlot === option.uiSlot &&
    linkKey(other.link) === linkKey(option.link) && other.censor?.flag === rule.flag && other.censor.action !== rule.action);
  return rule.action === "activate" ? twin ? "censored" : "cover" : twin ? "uncensored" : "hidden";
}
/** Whether a body option draws while the V wears the game's underwear cover (`censorRole`: plain, cover or uncensored). */
export function bodyOptionDraws(options: readonly CensorOption[], name: string): boolean {
  const role = censorRole(options, name);
  return role === "plain" || role === "cover" || role === "uncensored";
}
/** The cover options a body state's consumer groups list (every one must draw for an uncensored option to draw). */
export function requiredCovers(cco: CcoResource, body: BodyState = DEFAULT_BODY_STATE): Set<string> {
  const out = new Set<string>();
  for (const part of ["body", "arms"] as const) {
    const groups = bodyGroups(part, body);
    for (const group of cco.parts[part].groups) if (groups.includes(group.name))
      for (const name of group.options) if (censorRole(cco.parts[part].options, name) === "cover") out.add(`${part}|${name}`);
  }
  return out;
}

/**
 * The V's descriptors the preview resolves: every head descriptor and morph, and of the body and arms only the appearances their
 * third-person consumers read for the body state (a save and the default V list every perspective and holster state, whose first-person
 * and arm-cyberware parts the preview never draws) plus their morphs (breast size, nail length).
 */
export function previewInput(input: CharacterInput, body: BodyState = DEFAULT_BODY_STATE, withBody = true): CharacterInput {
  const appearances = input.appearances.filter(item => item.part === "head" || (withBody && bodyGroups(item.part, body).includes(item.group)));
  const morphs = withBody ? input.morphs : input.morphs.filter(item => item.part === "head");
  return appearances.length === input.appearances.length && morphs.length === input.morphs.length ? input : { ...input, appearances, morphs };
}
/**
 * Whether a request's body is drawn: `drawn`; `hidden` (the viewer turned the body off, so neither it nor its clothes are prepared); or
 * `male` (the preview has no male body yet: no male fixtures or evidence, so the host refuses it in plain words).
 */
export type BodyScope = "drawn" | "hidden" | "male";

type BodyEntry = ResolvedAppearance & { part: "body" | "arms" };
const isBodyEntry = (entry: ResolvedAppearance): entry is BodyEntry => entry.part === "body" || entry.part === "arms";

/**
 * The V's third-person body: the resolved body and arms appearances its consumer groups read (`BODY_GROUPS`), minus what the censorship
 * policy leaves out (`bodyOptionDraws`), each drawing component with its own chunk mask and the morphs applied to it. A part listed
 * twice (one appearance can list a component under one name twice) draws once [hypothesis: one component per name in an entity]. The
 * skin's components come first, so decals over the body (tattoos, scars, the underwear) blend against the loaded body skin, then in the
 * creator's option order (body before arms), which is also the decals' draw order (knowledge/body-rendering.md).
 */
function planBody(resolved: ResolvedCharacter, cco: CcoResource, defaults: TemplateDefaults, identities: TemplateIdentities, body: BodyState,
  scope: BodyScope = "drawn"): { components: PlannedComponent[]; censored: PlannedComponent[]; state: DetailSlotState } {
  const { noun, not, pronoun } = SLOT_WORDS.body;
  if (scope === "hidden") return { components: [], censored: [], state: { slot: "body", state: "none", label: "Hidden" } };
  // No male body is drawn until male fixtures and evidence exist (PIPE-98).
  if (scope === "male" || resolved.bodyGender === "male") return { components: [], censored: [], state: { slot: "body", state: "unavailable", label: noun,
    message: `XF Studio doesn't draw a male V's ${noun} yet, so ${pronoun} ${not} shown.` } };
  const index = new Map((["body", "arms"] as const).flatMap((part, p) =>
    cco.parts[part].options.map((option, i) => [`${part}|${option.name}`, p * 100_000 + i] as const)));
  const entries = resolved.appearances.filter(isBodyEntry).filter(entry => entry.groups.some(group => bodyGroups(entry.part, body).includes(group)));
  const planned: { component: PlannedComponent; order: number; skin: boolean; label: string; role: CensorRole; option: string }[] = [];
  const seen = new Set<string>();
  const unshown: string[] = [];
  const label = (entry: BodyEntry) => {
    const option = cco.parts[entry.part].options.find(item => item.name === entry.option);
    const word = BODY_DETAIL_WORDS[option?.uiSlot ?? ""] ?? (entry.part === "arms" ? "arms" : "body detail");
    // A nail design's definition ends in its template kind (`…__nails_01_red_heart__multilayer`): the design's own words name it.
    if (word !== "nails") return word;
    const design = choiceLabel(entry.definition.replace(/__multilayer$/i, "")).replace(/^nails\s+/, "").replace(/^[0-9]+\s+/, "");
    return `nails (${design || "nails"})`;
  };
  const roleOf = (entry: BodyEntry) => censorRole(cco.parts[entry.part].options, entry.option);
  for (const entry of entries) {
    const role = roleOf(entry);
    // Never drawn: what the underwear covers, and a descriptor the creator resource doesn't define.
    if (role === "hidden" || role === "unknown") continue;
    const items = entry.components.map(component => planComponent("body", entry, component, defaults, identities))
      .filter((item): item is PlannedComponent => !!item);
    if (!items.length) {
      // An appearance the game files don't give (missing or unreadable), or parts that draw but can't be planned, are reported. The
      // censored skin is a stand-in only, so its absence is not.
      const unread = entry.appearance.status === "missing" || entry.appearance.status === "unreadable";
      if (role !== "censored" && (unread || entry.components.some(component => component.geometry && !component.geometry.drawsNothing))) unshown.push(label(entry));
      continue;
    }
    for (const item of items) {
      const key = `${role}|${item.component}|${item.drawnFrom.ref.hash}|${item.chunks.join(",")}|${item.materials.map(material => material.name).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const skin = item.materials.some(material => renderTemplate(material.template, material.templateName)?.adapter === "skin");
      planned.push({ component: item, order: index.get(`${entry.part}|${entry.option}`) ?? Number.MAX_SAFE_INTEGER, skin, label: label(entry), role,
        option: `${entry.part}|${entry.option}` });
    }
  }
  // Fail closed (PIPE-97): the uncensored skin draws only while every cover the consumer groups list is planned; otherwise the game's
  // censored skin stands in (and with neither, no skin draws). A creator resource that lists no cover never shows the uncensored skin.
  const covers = requiredCovers(cco, body);
  const coveredOk = covers.size > 0 && [...covers].every(cover => planned.some(item => item.role === "cover" && item.option === cover));
  const censored = planned.filter(item => item.role === "censored").map(item => item.component);
  const hadUncensored = planned.some(item => item.role === "uncensored");
  const drawn = planned.filter(item => item.role === (coveredOk ? "uncensored" : "censored") || (item.role !== "uncensored" && item.role !== "censored"));
  // Stable: the skin first, the covers after every other body option, then the creator's order; components of one choice keep theirs.
  drawn.sort((a, b) => Number(b.skin) - Number(a.skin) || Number(a.role === "cover") - Number(b.role === "cover") || a.order - b.order);
  const components = drawn.map(item => item.role === "cover" ? { ...item.component, censor: "cover" as const }
    : item.role === "uncensored" ? { ...item.component, censor: "covered" as const } : item.component);
  const names = [...new Set(unshown)], missing = clampedList(names, 160);
  // Neither the covered skin nor its censored twin can draw: nothing of the body is shown rather than a body without its skin.
  if (hadUncensored && !coveredOk && !censored.length) return { components: [], censored: [], state: { slot: "body", state: "unavailable", label: noun,
    message: `XF Studio couldn't read the underwear the game draws on your V, so the ${noun} ${not} shown.` } };
  // A V whose creator choices bring no body part at all (a creator resource without body options) has none to show.
  if (!components.length && !entries.length) return { components, censored: [], state: { slot: "body", state: "none", label: "None" } };
  if (!components.length) return { components, censored: [], state: { slot: "body", state: "unavailable", label: clampedList(names) || noun,
    message: names.length ? `Your V's ${noun} (${missing}) couldn't be read from your game files, so ${pronoun} ${not} shown.`
      : `XF Studio can't draw your V's ${noun} yet, so ${pronoun} ${not} shown.` } };
  const fallback = hadUncensored && !coveredOk ? `The underwear the game draws on your V couldn't be read, so the ${noun} is shown in the game's censored look.` : "";
  const partly = names.length ? `Some parts of your V's ${noun} (${missing}) couldn't be read from your game files, so they aren't shown.` : "";
  const message = [fallback, partly].filter(Boolean).join(" ");
  return { components, censored: coveredOk ? censored : [], state: { slot: "body", state: "shown", label: clampedList([...new Set(drawn.map(item => item.label))]),
    ...(message ? { message } : {}) } };
}

/**
 * The clothes V wears (clothing-resolver.ts): every drawn item's drawable components, lower layers first (a stable sort, so one item's
 * components keep their order), and one outcome: shown (with the items' words), none (nothing worn, or everything hidden), or unavailable.
 * An item that can't be followed to its meshes, or whose meshes can't be drawn, is named in the slot's line.
 */
export function planClothing(clothing: ResolvedClothing | ClothingFailure | null | undefined, defaults: TemplateDefaults, identities: TemplateIdentities):
  { components: PlannedComponent[]; state: DetailSlotState } {
  const { noun, not, pronoun } = SLOT_WORDS.clothing;
  // The clothes couldn't be worked out at all (PIPE-100): said, never shown as "none".
  if (clothing && "failed" in clothing) return { components: [], state: { slot: "clothing", state: "unavailable", label: noun,
    message: clothing.failed === "records-unreadable" ? `XF Studio couldn't read the game's item records, so your V's ${noun} ${not} shown.`
      : `XF Studio couldn't work out your V's ${noun} from your game files, so ${pronoun} ${not} shown.` } };
  if (!clothing || !clothing.garments.length) return { components: [], state: { slot: "clothing", state: "none", label: "None" } };
  const planned: PlannedComponent[] = [], shown: string[] = [], unshown: string[] = [], reasons: string[] = [];
  for (const garment of clothing.garments) {
    if (garment.status === "hidden") continue;
    if (garment.status === "unresolved") { unshown.push(garment.label); if (garment.gap) reasons.push(garment.gap.code); continue; }
    const entry = { option: garment.area, definition: garment.definition ?? garment.label } as ResolvedAppearance;
    const items = garment.components.map(component => planComponent("clothing", entry, component, defaults, identities))
      .filter((item): item is PlannedComponent => !!item)
      .map(item => ({ ...item, garment: { area: garment.area, item: garment.item, layer: garment.layers[item.component] ?? null } }));
    if (items.length) { planned.push(...items); shown.push(garment.label); } else unshown.push(garment.label);
  }
  planned.sort((a, b) => (a.garment!.layer ?? 0) - (b.garment!.layer ?? 0));
  const missing = clampedList([...new Set(unshown)], 160);
  const hiddenBySave = clothing.garments.length > 0 && clothing.garments.every(garment => garment.hiddenBy?.kind === "saved");
  if (!planned.length && !unshown.length) return { components: [], state: { slot: "clothing", state: "none", label: "None",
    ...(hiddenBySave ? { message: "Your save hides every clothing area (a mod, such as an outfit manager, may dress V instead), so no clothes are shown from it." } : {}) } };
  const why = reasons.includes("records-unreadable") ? " (the game's item records couldn't be read)"
    : reasons.includes("item-unknown") ? " (items a mod adds aren't read yet)" : reasons.includes("item-dynamic") ? " (ArchiveXL dynamic items aren't read yet)" : "";
  if (!planned.length) return { components: [], state: { slot: "clothing", state: "unavailable", label: clampedList([...new Set(unshown)]),
    message: `XF Studio can't draw your V's ${noun} (${missing})${why} yet, so ${pronoun} ${not} shown.` } };
  return { components: planned, state: { slot: "clothing", state: "shown", label: clampedList([...new Set(shown)]),
    ...(unshown.length ? { message: `Some of your V's ${noun} (${missing})${why} ${not} shown yet.` } : {}) } };
}

/**
 * Select the head skin, face details, brows, lashes, hair, eyes, piercings and body of a resolved character. Each slot reports one outcome:
 * shown, none (the V has no such detail, e.g. hair "none"), or unavailable with one plain line.
 */
export function planCharacterDetails(resolved: ResolvedCharacter, cco: CcoResource, defaults: TemplateDefaults = new Map(),
  identities: TemplateIdentities = new Map(), body: BodyState = DEFAULT_BODY_STATE, clothing: ResolvedClothing | ClothingFailure | null = null,
  scope: BodyScope = "drawn"): CharacterPlan {
  const slotOf = detailSlotOf(cco);
  const components: PlannedComponent[] = [];
  const slots: DetailSlotState[] = [];
  const skinDecals: { entry: ResolvedAppearance; component: ResolvedComponent }[] = [];
  let censoredBody: PlannedComponent[] = [];
  for (const slot of DETAIL_SLOTS) {
    if (slot === "face" || slot === "body" || slot === "clothing") {
      if (slot === "body") {
        const planned = planBody(resolved, cco, defaults, identities, body, scope);
        censoredBody = planned.censored;
        components.push(...planned.components);
        slots.push(planned.state);
        continue;
      }
      const planned = slot === "face" ? planFace(resolved, cco, defaults, identities, skinDecals)
        // With the body hidden, its clothes are too (the Body switch hides both).
        : scope === "hidden" ? { components: [], state: { slot: "clothing", state: "none", label: "Hidden" } as DetailSlotState }
        : planClothing(clothing, defaults, identities);
      components.push(...planned.components);
      slots.push(planned.state);
      continue;
    }
    const entries = resolved.appearances.filter(entry => entry.part === "head" && slotOf.get(entry.option) === slot &&
      entry.groups.some(group => slotGroups(slot).includes(group)));
    if (!entries.length) { slots.push({ slot, state: "none", label: "None" }); continue; }
    const planned = entries.flatMap(entry => entry.components.map(component => {
      const item = planComponent(slot, entry, component, defaults, identities);
      // The skin type's decal parts (the personal-link port) are face details, not the skin.
      if (item && slot === "skin" && decalOnly(item)) { skinDecals.push({ entry, component }); return null; }
      return item;
    }).filter((item): item is PlannedComponent => !!item));
    const names = [...new Set(entries.map(entry => slot === "skin" ? skinLabel(entry.option, entry.definition)
      : slot === "piercings" ? piercingLabel(cco, entry.option, entry.definition) : choiceLabel(entry.definition)))];
    const label = clampedList(names), inMessage = clampedList(names, 160);
    if (!planned.length) {
      const missing = entries.some(entry => entry.appearance.status === "missing");
      // Installed but unreadable is not "not installed": name the archive WolvenKit couldn't read.
      const unreadable = entries.find(entry => entry.appearance.status === "unreadable");
      const { noun, not, pronoun } = SLOT_WORDS[slot];
      slots.push({ slot, state: "unavailable", label, message: unreadable
        ? `WolvenKit couldn't read your V's ${noun} (${inMessage})${unreadable.app?.archive ? ` from ${unreadable.app.archive}` : ""}, so ${pronoun} ${not} shown.`
        : missing ? `Your V's ${noun} (${inMessage}) ${not} in your installed game files, so ${pronoun} ${not} shown.`
        : `XF Studio can't draw your V's ${noun} (${inMessage}) yet, so ${pronoun} ${not} shown.` });
      continue;
    }
    components.push(...planned);
    slots.push({ slot, state: "shown", label });
  }
  return { components, slots, censoredBody };
}

/** Creator slot names (`uiSlot`) that feed one detail slot. */
const creatorSlots = (slot: DetailSlot) => new Set(Object.entries(DETAIL_UI_SLOTS).filter(([, detail]) => detail === slot).map(([name]) => name));
/** The creator's switchers that choose between the options of a detail slot (the piercing style switcher for `piercings_color`). */
function slotSwitchers(cco: CcoResource, slot: DetailSlot) {
  const names = creatorSlots(slot);
  return cco.parts.head.options.flatMap(option => option.type === "switcher" && option.uiSlots.some(name => names.has(name)) ? [option] : []);
}

/**
 * The detail slot of every head option that feeds one: by its own creator slot (`uiSlot`), else by the slot of a switcher that can
 * activate it (a piercing style's linked part on a creator slot of its own belongs to the piercings, as the style switcher turns it on).
 * Whether the option draws on the third-person head is still decided by its groups.
 */
export function detailSlotOf(cco: CcoResource): Map<string, DetailSlot> {
  const out = new Map<string, DetailSlot>();
  for (const option of cco.parts.head.options) { const slot = DETAIL_UI_SLOTS[option.uiSlot]; if (option.name && slot) out.set(option.name, slot); }
  for (const slot of DETAIL_SLOTS) for (const switcher of slotSwitchers(cco, slot))
    for (const name of switcherReach(cco, "head", switcher.name)) if (!out.has(name)) out.set(name, slot);
  return out;
}

type AppearanceOption = Extract<CcoOption, { type: "appearance" }>;
/** A switcher choice's targets as options, in the choice's order. */
const choiceTargets = (cco: CcoResource, names: readonly string[]) => names.flatMap(name => {
  const option = cco.parts.head.options.find(entry => entry.name === name);
  return option ? [option] : [];
});
/**
 * The option a switcher choice's colours come from: its link controller (the one the creator's colour control drives), else its first
 * appearance target with a resource and a named definition. Null for a choice that turns the slot off.
 */
function choiceController(cco: CcoResource, names: readonly string[]): AppearanceOption | null {
  const targets = choiceTargets(cco, names).filter((option): option is AppearanceOption =>
    option.type === "appearance" && !!option.resource && option.definitions.some(definition => definition.name));
  return targets.find(option => option.linkController) ?? targets[0] ?? null;
}

/**
 * The one plain label of a switcher choice (UI-49), lower case: `style 09` for the creator's numbered styles; a readable name the
 * creator gives (not a localisation key), with underscores as spaces; otherwise the words of the option it drives.
 */
export function styleLabel(localizedName: string, controller: string): string {
  if (/^[0-9]{1,3}$/.test(localizedName)) return `style ${localizedName.padStart(2, "0")}`;
  const words = localizedName.replace(/_+/g, " ").trim();
  if (words && !/^LocKey#/i.test(localizedName) && isChoiceLabel(words)) return words;
  return choiceLabel(controller);
}

/** The switcher choice of a slot that activates `option`, and its switcher. */
function switcherChoiceOf(cco: CcoResource, slot: DetailSlot, option: string) {
  for (const switcher of slotSwitchers(cco, slot)) for (const choice of switcher.options)
    if (choice.names.includes(option)) return { switcher, choice };
  return null;
}

/**
 * A plain piercing label (`styleLabel`): the style as the creator's switcher names it, and the
 * colour (`piercings_09`, `i0_000_pwa__earring__03_black` → `style 09, black`). An option no switcher offers reads as its colour only.
 */
export function piercingLabel(cco: CcoResource, option: string, definition: string): string {
  const colour = choiceLabel(definition);
  const found = switcherChoiceOf(cco, "piercings", option);
  if (!found) return colour;
  const controller = choiceController(cco, found.choice.names);
  return `${styleLabel(found.choice.localizedName, controller?.name ?? option)}, ${colour}`;
}
