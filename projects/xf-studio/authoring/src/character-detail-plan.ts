/**
 * Pure selection step between the generic resolver and the character render record: which resolved
 * drawing components are the V's head skin, brows, lashes, hair and eyes, which of their chunks the preview can
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
 * - **Drawable chunks** are those whose material template the renderer has an adapter for
 *   (render-templates.ts). A component with none (a hair shadow mesh on `glass.mt` or `metal_base.remt`) is
 *   left out; which components are shadow-only is still an open question (knowledge/head-cc-rendering.md).
 *   Layered chunks (`multilayered.mt`) draw only on `LAYERED_SLOTS` (piercings and eyes), so a hair's layered shadow proxy stays
 *   out too. A placeholder template (a decal the preview can't draw yet) is recorded beside drawn chunks, so the renderer can
 *   say plainly that part is not shown, but never makes a component drawable on its own.
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
 * - **Viewer choices**: a slot a viewer may try out (`CHOICE_SLOTS`) lists the creator's options for it (`slotChoices`), and a tried
 *   choice replaces the V's own on that slot before resolution (`applyChoiceOverride`), in every group the creator lists it in.
 */
import type { AppearanceDescriptor, CcoResource } from "./cco-model";
import type { ResolvedAppearance, ResolvedCharacter, ResolvedChunkMaterial, ResolvedComponent, ResolvedParam } from "./character-resolver";
import { refLabel } from "./depot-path";
import type { ChoiceSlot, DetailSlot, DetailSlotState, RenderChoices, RenderMorphTexture, RenderOverride, RenderRgba } from "./render-detail";
import { CHOICE_SLOTS, DETAIL_SLOTS } from "./render-detail";
import { renderTemplate, templateTextures } from "./render-templates";
import type { Provenance } from "./resource-graph";

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
};
export type CharacterPlan = { components: PlannedComponent[]; slots: DetailSlotState[]; choices: RenderChoices[] };
/** Template defaults per template depot path (lower case), read by the host from the `.mt`. */
export type TemplateDefaults = ReadonlyMap<string, readonly ResolvedParam[]>;
/** A template's own `name` and `materialPriority` per template depot path (lower case), read by the host from the `.mt`. */
export type TemplateIdentities = ReadonlyMap<string, { name: string | null; priority: string | null }>;

/** Plain words per slot: the noun, and "aren't … they" or "isn't … it". */
export const SLOT_WORDS: Readonly<Record<DetailSlot, { noun: string; not: string; pronoun: string }>> = Object.freeze({
  skin: { noun: "skin", not: "isn't", pronoun: "it" }, face: { noun: "face details", not: "aren't", pronoun: "they" }, brows: { noun: "eyebrows", not: "aren't", pronoun: "they" }, lashes: { noun: "eyelashes", not: "aren't", pronoun: "they" },
  hair: { noun: "hair", not: "isn't", pronoun: "it" }, eyes: { noun: "eyes", not: "aren't", pronoun: "they" },
  piercings: { noun: "piercings", not: "aren't", pronoun: "they" } });

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

/**
 * The slots whose layered (`multilayered.mt`) chunks draw: piercings and the eye designs. Elsewhere a layered chunk stays out as before:
 * a hair's shadow proxy mixes layered and glass chunks, and which components are shadow-only is still open
 * (knowledge/head-cc-rendering.md §4), so drawing it would add a visible shell the game may not show.
 */
export const LAYERED_SLOTS: readonly DetailSlot[] = ["piercings", "eyes"];

/**
 * Plan one chunk of a slot's component. On the face only decal-family templates draw, with the decal family's inputs; layered
 * templates draw only on `LAYERED_SLOTS`.
 */
function planChunk(material: ResolvedChunkMaterial, defaults: TemplateDefaults, rule: PlannedComponent["morphTexture"],
  identities: TemplateIdentities, slot: DetailSlot): PlannedChunk {
  const faceDetail = slot === "face";
  const template = material.template ? refLabel(material.template.ref) : null;
  const identity = template ? identities.get(template.toLowerCase()) : undefined;
  const found = renderTemplate(template, identity?.name);
  const inputs = found && (!faceDetail || isDecal(found)) && (!found.layered || LAYERED_SLOTS.includes(slot)) ? found : undefined;
  const chunk: PlannedChunk = { chunk: material.chunk, name: material.name, template, templateName: identity?.name ?? null,
    materialPriority: identity?.priority ?? null, drawn: !!inputs, placeholder: !!inputs?.placeholder,
    scalars: {}, colours: {}, textures: {}, profiles: {}, skinProfiles: {}, gradients: {}, layered: null };
  if (!inputs) return chunk;
  const textureInputs = templateTextures(inputs, faceDetail);
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
  const lods = geometry.chunkLods;
  const morphTexture = geometry.morphTexture && geometry.morphTarget
    ? { morph: geometry.morphTarget, texture: geometry.morphTexture.texture, parameter: geometry.morphTexture.parameter } : null;
  const materials = component.materials.filter(material => !lods || ((lods[material.chunk] ?? 1) & 1) === 1)
    .map(material => planChunk(material, defaults, morphTexture, identities, slot));
  const drawn = materials.filter(material => material.drawn);
  // A face detail made only of decal templates the preview can't draw yet is still recorded, so the renderer can say so.
  if (slot === "face" ? !drawn.length : !drawn.some(material => !material.placeholder)) return null;
  return { slot, option: entry.option, definition: entry.definition, component: component.name, drawnFrom: geometry.drawnFrom,
    morphTargets: component.type === "entMorphTargetSkinnedMeshComponent", renderChunks: geometry.renderChunks,
    chunks: drawn.map(material => material.chunk), materials: drawn, skippedChunks: materials.length - drawn.length, morphTexture };
}

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
  const entries = resolved.appearances.filter(entry => entry.part === "head" && !DETAIL_UI_SLOTS[options.get(entry.option)?.option.uiSlot ?? ""] &&
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
  const missing = [...new Set(unshown)].join(", ");
  if (!components.length) return { components, state: { slot: "face", state: "unavailable", label: missing,
    message: `XF Studio can't draw your V's ${noun} (${missing}) yet, so ${pronoun} ${not} shown.` } };
  return { components, state: { slot: "face", state: "shown", label: labels.join(", "),
    ...(unshown.length ? { message: `Some of your V's ${noun} (${missing}) ${not} shown yet.` } : {}) } };
}

/**
 * Select the head skin, face details, brows, lashes, hair and eyes of a resolved character. Each slot reports one outcome:
 * shown, none (the V has no such detail, e.g. hair "none"), or unavailable with one plain line.
 */
export function planCharacterDetails(resolved: ResolvedCharacter, cco: CcoResource, defaults: TemplateDefaults = new Map(),
  identities: TemplateIdentities = new Map()): CharacterPlan {
  const slotOf = new Map(cco.parts.head.options.map(option => [option.name, DETAIL_UI_SLOTS[option.uiSlot]]));
  const components: PlannedComponent[] = [];
  const slots: DetailSlotState[] = [];
  const skinDecals: { entry: ResolvedAppearance; component: ResolvedComponent }[] = [];
  for (const slot of DETAIL_SLOTS) {
    if (slot === "face") {
      const face = planFace(resolved, cco, defaults, identities, skinDecals);
      components.push(...face.components);
      slots.push(face.state);
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
    const label = [...new Set(entries.map(entry => slot === "skin" ? skinLabel(entry.option, entry.definition)
      : slot === "piercings" ? piercingLabel(cco, entry.option, entry.definition) : choiceLabel(entry.definition)))].join(", ");
    if (!planned.length) {
      const missing = entries.some(entry => entry.appearance.status === "missing");
      const { noun, not, pronoun } = SLOT_WORDS[slot];
      slots.push({ slot, state: "unavailable", label, message: missing
        ? `Your V's ${noun} (${label}) ${not} in your installed game files, so ${pronoun} ${not} shown.`
        : `XF Studio can't draw your V's ${noun} (${label}) yet, so ${pronoun} ${not} shown.` });
      continue;
    }
    components.push(...planned);
    slots.push({ slot, state: "shown", label });
  }
  return { components, slots, choices: CHOICE_SLOTS.map(slot => ({ slot, options: slotChoices(cco, slot) })) };
}

/** Creator slot names (`uiSlot`) that feed one detail slot. */
const creatorSlots = (slot: DetailSlot) => new Set(Object.entries(DETAIL_UI_SLOTS).filter(([, detail]) => detail === slot).map(([name]) => name));
/** The creator's switchers that choose between the options of a detail slot (the piercing style switcher for `piercings_color`). */
function slotSwitchers(cco: CcoResource, slot: DetailSlot) {
  const names = creatorSlots(slot);
  return cco.parts.head.options.flatMap(option => option.type === "switcher" && option.uiSlots.some(name => names.has(name)) ? [option] : []);
}

/**
 * The options a viewer may try on a choice slot, as the creator offers them: every appearance option on the slot's creator slot that has
 * an appearance resource and at least one named definition (so "Off" is not a choice to try; the V's own is), in the order of the slot's
 * switcher (its choice index), then the resource's option order. Vanilla and CCXL options alike; never a mod name.
 */
export function slotChoices(cco: CcoResource, slot: ChoiceSlot): RenderChoices["options"] {
  const names = creatorSlots(slot);
  const switchIndex = new Map<string, number>();
  for (const switcher of slotSwitchers(cco, slot)) for (const choice of switcher.options) for (const name of choice.names)
    if (!switchIndex.has(name)) switchIndex.set(name, choice.index);
  const seen = new Set<string>();
  return cco.parts.head.options.flatMap((option, order) => {
    if (option.type !== "appearance" || !names.has(option.uiSlot) || !option.resource || !option.name || seen.has(option.name)) return [];
    seen.add(option.name);
    const definitions = option.definitions.filter(definition => definition.name).slice(0, 64)
      .map(definition => ({ name: definition.name, index: Math.min(definition.index, 1024) }));
    return definitions.length ? [{ option: option.name, index: Math.min(switchIndex.get(option.name) ?? 1024, 1024), order, definitions }] : [];
  }).sort((a, b) => a.index - b.index || a.order - b.order).slice(0, 64).map(({ option, index, definitions }) => ({ option, index, definitions }));
}

/**
 * A viewer's tried choice in place of the V's own on one slot: every descriptor of an option on that slot is dropped, and the chosen
 * option's definition is listed in each group the creator lists the option in. Returns null when the creator doesn't offer that choice
 * (a stale or foreign request), so the V is shown as saved.
 */
export function applyChoiceOverride(appearances: readonly AppearanceDescriptor[], cco: CcoResource, override: RenderOverride): AppearanceDescriptor[] | null {
  const offered = slotChoices(cco, override.slot).find(entry => entry.option === override.option);
  const option = cco.parts.head.options.find(entry => entry.name === override.option);
  if (!offered || !offered.definitions.some(entry => entry.name === override.definition) || option?.type !== "appearance" || !option.resource) return null;
  const names = creatorSlots(override.slot);
  const onSlot = new Set(cco.parts.head.options.filter(entry => names.has(entry.uiSlot)).map(entry => entry.name));
  const groups = cco.parts.head.groups.filter(group => group.options.includes(option.name)).map(group => group.name);
  if (!groups.length) return null;
  return [...appearances.filter(entry => entry.part !== "head" || !onSlot.has(entry.option)),
    ...groups.map(group => ({ part: "head" as const, group, option: option.name, app: option.resource!, definition: override.definition }))];
}

/**
 * A plain piercing label: the style's number as the creator's switcher shows it, and the colour (`piercings_09`,
 * `i0_000_pwa__earring__03_black` → `style 09, black`). A choice outside a numbered switcher reads as its colour only.
 */
export function piercingLabel(cco: CcoResource, option: string, definition: string): string {
  const style = slotSwitchers(cco, "piercings").flatMap(switcher => switcher.options).find(choice => choice.names.includes(option))?.localizedName ?? "";
  const colour = choiceLabel(definition);
  return /^[0-9]{1,3}$/.test(style) ? `style ${style}, ${colour}` : colour;
}

