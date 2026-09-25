/**
 * Pure selection step between the generic resolver and the character render record: which resolved
 * drawing components are the V's brows, lashes and hair, which of their chunks the preview can draw,
 * and each chunk's effective material inputs (instance chain first, then the template's defaults).
 *
 * Everything is decided from the game's own data, never from mod identities:
 * - **Slot** comes from the character-creator option's `uiSlot` in the effective (merged) CCO. Vanilla and
 *   CCXL options share the vanilla slots (`eyebrows_color`, `eyelash_color`, `hair_color`) [resource].
 * - **Consumer** is the third-person head: only choices listed in the `TPP` or `hairs` groups draw on the
 *   third-person puppet (the FPP hair twins sit in `FPP_hairs`) [resource; consumer wiring hypothesis].
 * - **Level of detail**: the preview draws the highest-detail level (chunks whose LOD mask has bit 0), as a
 *   creator close-up would; lower levels are the same parts again [resource: render chunk `lodMask`].
 * - **Drawable chunks** are those whose material template the renderer has an adapter for
 *   (render-templates.ts). A component with none (a hair shadow mesh on `glass.mt` or `metal_base.remt`) is
 *   left out; which components are shadow-only is still an open question (knowledge/head-cc-rendering.md).
 */
import type { CcoResource } from "./cco-model";
import type { ResolvedAppearance, ResolvedCharacter, ResolvedChunkMaterial, ResolvedComponent, ResolvedParam } from "./character-resolver";
import { refLabel } from "./depot-path";
import type { DetailSlot, DetailSlotState, RenderRgba } from "./render-detail";
import { DETAIL_SLOTS } from "./render-detail";
import { renderTemplate } from "./render-templates";
import type { Provenance } from "./resource-graph";

/** Creator slot → preview detail. Vanilla slot names from the game's character-creator resource. */
export const DETAIL_UI_SLOTS: Readonly<Record<string, DetailSlot>> = Object.freeze({
  eyebrows_color: "brows", eyelash_color: "lashes", hair_color: "hair" });
/** Groups consumed by the third-person head and hair controllers. */
export const THIRD_PERSON_GROUPS: readonly string[] = ["TPP", "hairs"];

export type PlannedChunk = {
  chunk: number; name: string; template: string | null; drawn: boolean;
  scalars: Record<string, number>; colours: Record<string, RenderRgba>;
  textures: Record<string, Provenance>; profiles: Record<string, Provenance>;
};
export type PlannedComponent = {
  slot: DetailSlot; option: string; definition: string; component: string;
  /** Resource to export as geometry, and whether it is a morph target (facial shapes follow the head). */
  drawnFrom: Provenance; morphTargets: boolean;
  renderChunks: number; chunks: number[]; materials: PlannedChunk[];
  /** Chunks that are visible in game but not drawn by the preview (unsupported template). */
  skippedChunks: number;
};
export type CharacterPlan = { components: PlannedComponent[]; slots: DetailSlotState[] };
/** Template defaults per template depot path (lower case), read by the host from the `.mt`. */
export type TemplateDefaults = ReadonlyMap<string, readonly ResolvedParam[]>;

/** Plain words per slot: the noun, and "aren't … they" or "isn't … it". */
export const SLOT_WORDS: Readonly<Record<DetailSlot, { noun: string; not: string; pronoun: string }>> = Object.freeze({
  brows: { noun: "eyebrows", not: "aren't", pronoun: "they" }, lashes: { noun: "eyelashes", not: "aren't", pronoun: "they" },
  hair: { noun: "hair", not: "isn't", pronoun: "it" } });

/** A plain colour or style label from a definition name (`female__05_brown_liquorice` → `brown liquorice`). */
export function choiceLabel(definition: string): string {
  const tail = definition.split("__").pop() ?? definition;
  const words = tail.replace(/^[0-9]+_/, "").replace(/_/g, " ").trim();
  return words || definition;
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

function planChunk(material: ResolvedChunkMaterial, defaults: TemplateDefaults): PlannedChunk {
  const template = material.template ? refLabel(material.template.ref) : null;
  const inputs = renderTemplate(template);
  const chunk: PlannedChunk = { chunk: material.chunk, name: material.name, template, drawn: !!inputs,
    scalars: {}, colours: {}, textures: {}, profiles: {} };
  if (!inputs) return chunk;
  for (const param of effectiveParams(material, defaults)) {
    const scalar = parseScalar(param);
    if (typeof scalar === "number") chunk.scalars[param.name] = scalar;
    else if (scalar) chunk.colours[param.name] = scalar;
    else if (param.kind === "resource" && param.resource?.ref.path) {
      if (inputs.textures.includes(param.name) && /\.xbm$/i.test(param.resource.ref.path)) chunk.textures[param.name] = param.resource;
      if (inputs.profiles.includes(param.name) && /\.hp$/i.test(param.resource.ref.path)) chunk.profiles[param.name] = param.resource;
    }
  }
  return chunk;
}

function planComponent(slot: DetailSlot, entry: ResolvedAppearance, component: ResolvedComponent,
  defaults: TemplateDefaults): PlannedComponent | null {
  const geometry = component.geometry;
  if (!geometry || geometry.drawsNothing || !geometry.drawnFrom || geometry.drawnFrom.status !== "archive" || !geometry.visibleChunks?.length ||
      !geometry.renderChunks) return null;
  const lods = geometry.chunkLods;
  const materials = component.materials.filter(material => !lods || ((lods[material.chunk] ?? 1) & 1) === 1)
    .map(material => planChunk(material, defaults));
  const drawn = materials.filter(material => material.drawn);
  if (!drawn.length) return null;
  return { slot, option: entry.option, definition: entry.definition, component: component.name, drawnFrom: geometry.drawnFrom,
    morphTargets: component.type === "entMorphTargetSkinnedMeshComponent", renderChunks: geometry.renderChunks,
    chunks: drawn.map(material => material.chunk), materials: drawn, skippedChunks: materials.length - drawn.length };
}

/**
 * Select the brows, lashes and hair of a resolved character. Each slot reports one outcome: shown, none
 * (the V has no such detail, e.g. hair "none"), or unavailable with one plain line.
 */
export function planCharacterDetails(resolved: ResolvedCharacter, cco: CcoResource, defaults: TemplateDefaults = new Map()): CharacterPlan {
  const slotOf = new Map(cco.parts.head.options.map(option => [option.name, DETAIL_UI_SLOTS[option.uiSlot]]));
  const components: PlannedComponent[] = [];
  const slots: DetailSlotState[] = [];
  for (const slot of DETAIL_SLOTS) {
    const entries = resolved.appearances.filter(entry => entry.part === "head" && slotOf.get(entry.option) === slot &&
      entry.groups.some(group => THIRD_PERSON_GROUPS.includes(group)));
    if (!entries.length) { slots.push({ slot, state: "none", label: "None" }); continue; }
    const planned = entries.flatMap(entry => entry.components.map(component => planComponent(slot, entry, component, defaults))
      .filter((item): item is PlannedComponent => !!item));
    const label = [...new Set(entries.map(entry => choiceLabel(entry.definition)))].join(", ");
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
  return { components, slots };
}
