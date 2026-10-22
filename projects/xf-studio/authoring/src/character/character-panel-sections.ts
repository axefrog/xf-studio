/**
 * The Character panel's one hierarchy (research/backlog/cc-controls-and-presets.md, Next 4): the parts of V, then the panel's own
 * sections, then the creator's rows, derived rather than written. Pure application code, so another presentation (or an MCP client) gets
 * the same tree.
 *
 * - **Groups** are the parts of V (`CHARACTER_GROUPS`: Head, Body, Clothing by default). A creator row belongs to the group of its part
 *   (the head's options to Head; body and arm options to Body).
 * - **Sections are the panel's own taxonomy**, not the creator's categories: the creator groups some rows oddly (the vanilla eyelash
 *   colour sits under its Eyebrows category, a lash mod's style under Face), so copying its categories one to one split a detail across
 *   sections and put two switches on one heading. The Studio's sections are contributions (`CHARACTER_CONTRIBUTIONS`): Head holds
 *   Skin, Face (Eyes, Eyebrows, Eyelashes, Nose, Mouth & lips, Ears, Jaw & shape, Makeup, Piercings, Face details), Hair and Teeth; a
 *   section may sit inside another (`parent`). A module adds sections, or extends one's `holds`, the same way.
 * - **Rows land by what they control** (`sectionOfRow`), never by a display name and never by a per-mod table, strongest evidence first:
 *   1. the preview detail its creator slot feeds (character-detail-plan.ts `DETAIL_UI_SLOTS`: the game's own slot names);
 *   2. the words of its identifiers: its creator slot, then its options' names, then their link keys, each split into words
 *      (`identifierWords`: `makeupEyes_color` reads makeup, eyes, color). The first word of an identifier that a section holds decides,
 *      because an identifier names the thing first and its qualities after (a makeup colour for the eyes is makeup; a hair colour hair);
 *   3. the creator category the game (or the mod) declared for it;
 *   and else a group's catch-all (`holds.rest`: Head's Other). A group with no catch-all (Body) keeps the creator's own categories as
 *   sections for rows nothing claims. So a modded row with its own slot lands beside the vanilla rows it resembles.
 * - **Toggles**: each section has at most one show/hide switch, for what it draws (the lashes' switch on Eyelashes, the brows' on
 *   Eyebrows); a section with nothing drawable to switch has none. Toggles are typed actions with their current state read from the
 *   preview (never a mutable field); the panel shows each on its heading row with its capability's reason when unavailable (the reason
 *   tip), and what it shows in the heading's help tip.
 * - **Contributions** are withdrawn with their module (AGENTS.md "reactive graph by default"). One can also join an existing section
 *   (`joins`) to add controls or a toggle, or sit on a group's heading (`onGroup`).
 */
import type { CcPanel, CcPanelRow } from "./cc-panel";
import type { CcoPart } from "./cco-model";
import { DETAIL_UI_SLOTS } from "./character-detail-plan";
import type { ClothingState } from "./clothing-dressing";
import type { DetailSlot } from "./render-detail";

export type CharacterGroupId = string;
export interface CharacterGroup { readonly id: CharacterGroupId; readonly title: string; readonly order: number }
/** The default top-level grouping: by what the part of V is. */
export const CHARACTER_GROUPS: readonly CharacterGroup[] = [
  { id: "head", title: "Head", order: 0 }, { id: "body", title: "Body", order: 1 }, { id: "clothing", title: "Clothing", order: 2 }];
/** The group a creator row's part belongs to. */
export const groupOfPart = (part: CcoPart): CharacterGroupId => part === "head" ? "head" : "body";
/** A creator row's preview detail (from its creator slot), or null. */
export const rowDetail = (row: Pick<CcPanelRow, "slot">): DetailSlot | null => DETAIL_UI_SLOTS[row.slot] ?? null;

/** What a toggle reads: the preview's own switches and the character context's clothing setting. */
export interface CharacterToggleState {
  readonly preview?: { readonly brows?: boolean; readonly lashes?: boolean; readonly hair?: boolean; readonly piercings?: boolean; readonly body?: boolean;
    readonly uncensored?: boolean } | null;
  readonly clothing?: { readonly state: ClothingState } | null;
}
/** The typed actions a toggle dispatches. */
export type CharacterToggleAction =
  | { kind: "preview.setDetail"; detail: "brows" | "lashes"; enabled: boolean }
  | { kind: "preview.setHair" | "preview.setPiercings" | "preview.setBody" | "preview.setUncensored"; enabled: boolean }
  | { kind: "character.setClothing"; state: ClothingState };
export interface CharacterToggle {
  readonly id: string;
  /** Its accessible name (the heading names what it shows). */
  readonly label: string;
  action(shown: boolean): CharacterToggleAction;
  shown(state: CharacterToggleState): boolean;
  /** What the heading's help tip says about what it shows (informational, so never an inline line: help-tip.ts), when it has something. */
  help?(state: CharacterToggleState): string;
}
/** What rows a section claims (see the module note for the order the rules apply in). */
export interface CharacterSectionHolds {
  /** Preview details whose creator slots it holds. */
  readonly details?: readonly DetailSlot[];
  /** Words of row identifiers (slot, option names, link keys) it holds, lower case. */
  readonly words?: readonly string[];
  /** Creator categories (the game's or a mod's declared category ids) whose otherwise unclaimed rows it holds. */
  readonly categories?: readonly string[];
  /** Every row of its group that nothing else claims (one per group at most). */
  readonly rest?: boolean;
}
export interface CharacterSectionContribution {
  readonly id: string;
  /** The module that contributes it (withdrawn with the module). */
  readonly module: string;
  readonly group: CharacterGroupId;
  /** A section of its own: its title and its place among its siblings (below 0 before the sections of the creator's categories). */
  readonly title?: string;
  readonly order: number;
  /** The id of the section it sits inside (another contribution's), if any. */
  readonly parent?: string;
  /** The rows it claims. */
  readonly holds?: CharacterSectionHolds;
  /** Adds its toggle and controls to the section with this id instead of adding a section. */
  readonly joins?: string;
  /** On the group's heading row (toggle) and at the top of the group (controls), not in a section. */
  readonly onGroup?: boolean;
  /** Its show/hide switch: at most one per section, for what the section draws. */
  readonly toggle?: CharacterToggle;
  /** Controls the panel draws in the section's body, by ID (the presentation's control factories). */
  readonly controls?: readonly string[];
}

export interface CharacterPanelSection {
  /** `<group>/<contribution id or creator category>`: stable across paints. */
  readonly key: string;
  readonly title: string;
  /** The creator category it shows the rows of, for a section taken from the creator (a group without a catch-all); else null. */
  readonly creator: string | null;
  readonly rows: readonly CcPanelRow[];
  /** Its show/hide switch, when it has one (at most one). */
  readonly toggles: readonly CharacterToggle[];
  readonly controls: readonly string[];
  /** The sections inside it, in order. */
  readonly children: readonly CharacterPanelSection[];
}
export interface CharacterPanelGroup {
  readonly id: CharacterGroupId; readonly title: string;
  readonly toggles: readonly CharacterToggle[]; readonly controls: readonly string[];
  readonly sections: readonly CharacterPanelSection[];
}

const previewToggle = (id: string, label: string, key: "brows" | "lashes" | "hair" | "piercings", action: (shown: boolean) => CharacterToggleAction,
  help?: CharacterToggle["help"]): CharacterToggle => ({ id, label, action, shown: state => !!state.preview?.[key], ...(help ? { help } : {}) });

/**
 * The Studio's own sections and the 3D view's switches and controls, each on the part of V it shows. The words are anatomy and makeup
 * vocabulary that identifiers (vanilla or modded) are built from, not option names.
 */
export const CHARACTER_CONTRIBUTIONS: readonly CharacterSectionContribution[] = [
  { id: "skin", module: "character", group: "head", title: "Skin", order: 0, holds: { details: ["skin"], words: ["skin", "complexion"], categories: ["Skin"] } },
  { id: "face", module: "character", group: "head", title: "Face", order: 10 },
  { id: "eyes", module: "character", group: "head", parent: "face", title: "Eyes", order: 11, controls: ["eyeShape"],
    holds: { details: ["eyes"], words: ["eye", "eyes", "iris", "pupil", "pupils", "sclera"], categories: ["Eyes"] } },
  { id: "eyebrows", module: "character", group: "head", parent: "face", title: "Eyebrows", order: 12,
    holds: { details: ["brows"], words: ["eyebrow", "eyebrows", "brow", "brows"], categories: ["Eyebrows"] },
    toggle: previewToggle("brows", "Show eyebrows in the 3D view", "brows", enabled => ({ kind: "preview.setDetail", detail: "brows", enabled })) },
  { id: "eyelashes", module: "character", group: "head", parent: "face", title: "Eyelashes", order: 13,
    holds: { details: ["lashes"], words: ["eyelash", "eyelashes", "lash", "lashes"] },
    toggle: previewToggle("lashes", "Show eyelashes in the 3D view", "lashes", enabled => ({ kind: "preview.setDetail", detail: "lashes", enabled })) },
  { id: "nose", module: "character", group: "head", parent: "face", title: "Nose", order: 14, holds: { words: ["nose", "nostril", "nostrils"] } },
  { id: "mouth", module: "character", group: "head", parent: "face", title: "Mouth & lips", order: 15, holds: { words: ["mouth", "lip", "lips"] } },
  { id: "ears", module: "character", group: "head", parent: "face", title: "Ears", order: 16, holds: { words: ["ear", "ears"] } },
  { id: "jaw", module: "character", group: "head", parent: "face", title: "Jaw & shape", order: 17,
    holds: { words: ["jaw", "chin", "cheekbone", "cheekbones", "shape"], categories: ["Face"] } },
  { id: "makeup", module: "character", group: "head", parent: "face", title: "Makeup", order: 18,
    holds: { words: ["makeup", "lipstick", "eyeliner", "eyeshadow", "blush", "mascara"], categories: ["Makeup"] } },
  { id: "piercings", module: "character", group: "head", parent: "face", title: "Piercings", order: 19, holds: { details: ["piercings"], words: ["piercing", "piercings"] },
    toggle: previewToggle("piercings", "Show piercings in the 3D view", "piercings", enabled => ({ kind: "preview.setPiercings", enabled })) },
  { id: "details", module: "character", group: "head", parent: "face", title: "Face details", order: 20,
    holds: { words: ["scar", "scars", "tattoo", "tattoos", "freckle", "freckles", "mole", "moles", "cyberware", "implant", "implants", "beard", "stubble"],
      categories: ["Scars", "Tattoos", "FaceModification"] } },
  { id: "hair", module: "character", group: "head", title: "Hair", order: 30, holds: { details: ["hair"], words: ["hair", "hairs", "hairstyle", "hairstyles"], categories: ["Hair"] },
    toggle: previewToggle("hair", "Show hair in the 3D view", "hair", enabled => ({ kind: "preview.setHair", enabled }),
      () => "Hair physics is not simulated: the 3D view shows each hairstyle at rest, as it is modelled.") },
  { id: "teeth", module: "character", group: "head", title: "Teeth", order: 40, holds: { details: ["teeth"], words: ["teeth", "tooth"] } },
  { id: "other", module: "character", group: "head", title: "Other", order: 90, holds: { rest: true } },
  { id: "view.body", module: "character", group: "body", onGroup: true, order: 0, controls: ["uncensored"],
    // Absent means shown (workspace-state.ts).
    toggle: { id: "body", label: "Show the body in the 3D view", action: enabled => ({ kind: "preview.setBody", enabled }), shown: state => state.preview?.body ?? true,
      help: state => state.preview?.uncensored ? "The body and the clothes on it." : "The body and the clothes on it. Where no clothes are shown, the game's own underwear covers it." } },
  { id: "view.clothing", module: "character", group: "clothing", onGroup: true, order: 0, controls: ["clothingState", "clothingAreas"],
    // Hidden is the game's own minimum: underwear only.
    toggle: { id: "clothing", label: "Show clothes in the 3D view", action: shown => ({ kind: "character.setClothing", state: shown ? "saved" : "underwear" }),
      shown: state => !!state.clothing && state.clothing.state !== "underwear" } },
];

/** An identifier's words, lower case: split at case changes, digits and punctuation (`makeupEyes_color01` → makeup, eyes, color). */
export function identifierWords(identifier: string): string[] {
  return identifier.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
}
/** Every word a section contribution holds (the vocabulary rows are matched by). */
export const sectionWords = (contributions: readonly CharacterSectionContribution[] = CHARACTER_CONTRIBUTIONS) =>
  [...new Set(contributions.flatMap(contribution => contribution.holds?.words ?? []))];

/**
 * The section (a contribution's id) a creator row lands in, of the candidate sections of its group; null when none claims it. See the
 * module note for the rules.
 */
export function sectionOfRow(panel: Readonly<CcPanel>, row: Readonly<CcPanelRow>, category: string,
  candidates: readonly CharacterSectionContribution[]): string | null {
  const detail = rowDetail(row);
  if (detail) { const found = candidates.find(section => section.holds?.details?.includes(detail)); if (found) return found.id; }
  const byWord = new Map<string, string>();
  for (const section of candidates) for (const word of section.holds?.words ?? []) if (!byWord.has(word)) byWord.set(word, section.id);
  const options = row.options.map(index => panel.options[index]).filter(option => !!option);
  const identifiers = [row.slot, ...options.map(option => option.name), ...options.flatMap(option => option.link ? [option.link.key] : [])];
  for (const identifier of identifiers) for (const word of identifierWords(identifier)) { const found = byWord.get(word); if (found) return found; }
  return candidates.find(section => section.holds?.categories?.includes(category))?.id ?? candidates.find(section => section.holds?.rest)?.id ?? null;
}

/** The panel's tree from the creator projection (null while it loads) and the contributions, in group, then section order. */
export function characterPanelTree(panel: Readonly<CcPanel> | null, contributions: readonly CharacterSectionContribution[] = CHARACTER_CONTRIBUTIONS,
  groups: readonly CharacterGroup[] = CHARACTER_GROUPS): CharacterPanelGroup[] {
  type Draft = { id: string; key: string; title: string; creator: string | null; parent: string | null; rows: { row: CcPanelRow; at: number }[];
    toggles: CharacterToggle[]; controls: string[]; order: number };
  const known = new Set(groups.map(group => group.id));
  const drafts = new Map<CharacterGroupId, Map<string, Draft>>(groups.map(group => [group.id, new Map()]));
  const groupParts = new Map<CharacterGroupId, { toggles: CharacterToggle[]; controls: string[] }>(groups.map(group => [group.id, { toggles: [], controls: [] }]));
  const sorted = [...contributions].sort((a, b) => a.order - b.order);
  // The contributed sections first (a module's contribution naming an id already taken joins it).
  for (const contribution of sorted) {
    if (!known.has(contribution.group) || contribution.onGroup || contribution.joins) continue;
    const sections = drafts.get(contribution.group)!;
    if (sections.has(contribution.id)) continue;
    sections.set(contribution.id, { id: contribution.id, key: `${contribution.group}/${contribution.id}`, title: contribution.title ?? contribution.id, creator: null,
      parent: contribution.parent ?? null, rows: [], toggles: [], controls: [], order: contribution.order });
  }
  // Then every creator row, by what it controls; a row nothing claims keeps its creator category (after the contributed sections).
  const candidates = new Map<CharacterGroupId, CharacterSectionContribution[]>(groups.map(group => [group.id,
    sorted.filter(contribution => contribution.group === group.id && !contribution.onGroup && !contribution.joins && contribution.holds)]));
  const creatorCount = panel?.sections.length ?? 0;
  let at = 0;
  (panel?.sections ?? []).forEach((section, index) => {
    for (const row of section.rows) {
      const group = groupOfPart(row.part);
      const sections = drafts.get(group);
      if (!sections) continue;
      const id = sectionOfRow(panel!, row, section.id, candidates.get(group)!) ?? `creator:${section.id}`;
      let draft = sections.get(id);
      if (!draft) sections.set(id, draft = { id, key: `${group}/${section.id}`, title: section.label, creator: section.id, parent: null, rows: [], toggles: [], controls: [],
        order: index });
      draft.rows.push({ row, at: at++ });
    }
  });
  // Toggles and controls: on the group's heading, on a section joined, or on the contribution's own section.
  for (const contribution of sorted) {
    if (!known.has(contribution.group)) continue;
    if (contribution.onGroup) {
      const parts = groupParts.get(contribution.group)!;
      if (contribution.toggle) parts.toggles.push(contribution.toggle);
      parts.controls.push(...contribution.controls ?? []);
      continue;
    }
    const target = drafts.get(contribution.group)!.get(contribution.joins ?? contribution.id);
    if (!target) continue;
    // At most one switch per section: a second one (a module's) is not shown there.
    if (contribution.toggle && !target.toggles.length) target.toggles.push(contribution.toggle);
    target.controls.push(...contribution.controls ?? []);
  }
  const order = (draft: Draft) => draft.creator === null ? draft.order < 0 ? draft.order - 1000 : creatorCount + draft.order : draft.order;
  const build = (all: Map<string, Draft>, parent: string | null): CharacterPanelSection[] => [...all.values()]
    .filter(draft => draft.parent === parent && (parent === null || all.has(parent)) && draft.id !== parent)
    .sort((a, b) => order(a) - order(b))
    .map(draft => ({ key: draft.key, title: draft.title, creator: draft.creator, rows: draft.rows.sort((a, b) => a.at - b.at).map(entry => entry.row),
      toggles: draft.toggles, controls: draft.controls, children: build(all, draft.id) }));
  return [...groups].sort((a, b) => a.order - b.order).map(group => {
    const all = drafts.get(group.id)!;
    // A section whose parent isn't there shows at the top level.
    for (const draft of all.values()) if (draft.parent && !all.has(draft.parent)) draft.parent = null;
    return { id: group.id, title: group.title, ...groupParts.get(group.id)!, sections: build(all, null) };
  });
}
/** Every section of a group's tree, depth first (a parent before its children). */
export const allSections = (sections: readonly CharacterPanelSection[]): CharacterPanelSection[] => sections.flatMap(section => [section, ...allSections(section.children)]);
