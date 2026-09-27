/**
 * The Character panel's one hierarchy (research/backlog/cc-controls-and-presets.md, Next 4): the parts of V, then sections, then the
 * creator's rows, derived rather than written. Pure application code, so another presentation (or an MCP client) gets the same tree.
 *
 * - **Groups** are the parts of V (`CHARACTER_GROUPS`: Head, Body, Clothing by default). A creator row belongs to the group of its part
 *   (the head's options to Head; body and arm options to Body), so one creator section can appear in two groups with the rows of each.
 * - **Sections** are the creator's own categories (cc-panel.ts, from TweakDB), in their order, plus the sections that contributions add.
 * - **Contributions** (`CharacterSectionContribution`) are what modules add to the tree: a show/hide toggle for the 3D view, controls,
 *   or a section of their own. One naming a preview detail (`detail`) joins the creator section that holds a row of that detail (a row's
 *   detail is its creator slot's, character-detail-plan.ts `DETAIL_UI_SLOTS`: the game's own slot names), so the Hair toggle sits on the
 *   Hair heading whatever the section is called; with no such row it is a section of its own. `onGroup` puts it on the group's heading.
 *   The Studio's own contributions are `CHARACTER_CONTRIBUTIONS`; a later module adds its own list, and withdraws it when hidden
 *   (AGENTS.md "reactive graph by default").
 * - **Toggles** are typed actions with their current state read from the preview (never a mutable field): the panel shows each on its
 *   heading row with its capability's reason when unavailable.
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
  /** One plain line under the heading, when it has something to say. */
  note?(state: CharacterToggleState): string;
}
export interface CharacterSectionContribution {
  readonly id: string;
  /** The module that contributes it (withdrawn with the module). */
  readonly module: string;
  readonly group: CharacterGroupId;
  /** Joins the creator section holding a row of this detail; without one (or no such row), a section of its own. */
  readonly detail?: DetailSlot;
  /** On the group's heading row (toggle) and at the top of the group (controls), not in a section. */
  readonly onGroup?: boolean;
  /** A section of its own: its title, and its place (below 0 before the creator's sections, else after them). */
  readonly title?: string;
  readonly order: number;
  readonly toggle?: CharacterToggle;
  /** Controls the panel draws in the section's body, by ID (the presentation's control factories). */
  readonly controls?: readonly string[];
}

export interface CharacterPanelSection {
  /** `<group>/<creator section or contribution id>`: stable across paints. */
  readonly key: string;
  readonly title: string;
  /** The creator section (cc-panel.ts) it shows rows of, or null for a contributed section. */
  readonly creator: string | null;
  readonly makeup: boolean;
  readonly rows: readonly CcPanelRow[];
  readonly toggles: readonly CharacterToggle[];
  readonly controls: readonly string[];
}
export interface CharacterPanelGroup {
  readonly id: CharacterGroupId; readonly title: string;
  readonly toggles: readonly CharacterToggle[]; readonly controls: readonly string[];
  readonly sections: readonly CharacterPanelSection[];
}

const previewToggle = (id: string, label: string, key: "brows" | "lashes" | "hair" | "piercings", action: (shown: boolean) => CharacterToggleAction,
  note?: CharacterToggle["note"]): CharacterToggle => ({ id, label, action, shown: state => !!state.preview?.[key], ...(note ? { note } : {}) });

/** The Studio's own contributions: the 3D view's show/hide switches and controls, each on the part of V it shows. */
export const CHARACTER_CONTRIBUTIONS: readonly CharacterSectionContribution[] = [
  { id: "view.eyes", module: "character", group: "head", detail: "eyes", title: "Eyes", order: 10, controls: ["eyeShape"] },
  { id: "view.brows", module: "character", group: "head", detail: "brows", title: "Eyebrows", order: 20,
    toggle: previewToggle("brows", "Show eyebrows in the 3D view", "brows", enabled => ({ kind: "preview.setDetail", detail: "brows", enabled })) },
  { id: "view.lashes", module: "character", group: "head", detail: "lashes", title: "Eyelashes", order: 30,
    toggle: previewToggle("lashes", "Show eyelashes in the 3D view", "lashes", enabled => ({ kind: "preview.setDetail", detail: "lashes", enabled })) },
  { id: "view.hair", module: "character", group: "head", detail: "hair", title: "Hair", order: 40,
    toggle: previewToggle("hair", "Show hair in the 3D view", "hair", enabled => ({ kind: "preview.setHair", enabled }), () => "Hair physics is not simulated.") },
  { id: "view.piercings", module: "character", group: "head", detail: "piercings", title: "Piercings", order: 50,
    toggle: previewToggle("piercings", "Show piercings in the 3D view", "piercings", enabled => ({ kind: "preview.setPiercings", enabled })) },
  { id: "view.body", module: "character", group: "body", onGroup: true, order: 0, controls: ["uncensored"],
    // Absent means shown (workspace-state.ts).
    toggle: { id: "body", label: "Show the body in the 3D view", action: enabled => ({ kind: "preview.setBody", enabled }), shown: state => state.preview?.body ?? true,
      note: state => state.preview?.uncensored ? "The body and the clothes on it." : "The body and the clothes on it. Where no clothes are shown, the game's own underwear covers it." } },
  { id: "view.clothing", module: "character", group: "clothing", onGroup: true, order: 0, controls: ["clothingState", "clothingAreas"],
    // Hidden is the game's own minimum: underwear only.
    toggle: { id: "clothing", label: "Show clothes in the 3D view", action: shown => ({ kind: "character.setClothing", state: shown ? "saved" : "underwear" }),
      shown: state => !!state.clothing && state.clothing.state !== "underwear" } },
];

/** The panel's tree from the creator projection (null while it loads) and the contributions, in group, then section order. */
export function characterPanelTree(panel: Readonly<CcPanel> | null, contributions: readonly CharacterSectionContribution[] = CHARACTER_CONTRIBUTIONS,
  groups: readonly CharacterGroup[] = CHARACTER_GROUPS): CharacterPanelGroup[] {
  type Draft = { key: string; title: string; creator: string | null; makeup: boolean; rows: CcPanelRow[]; toggles: CharacterToggle[]; controls: string[]; order: number };
  const drafts = new Map<CharacterGroupId, Draft[]>(groups.map(group => [group.id, []]));
  const groupParts = new Map<CharacterGroupId, { toggles: CharacterToggle[]; controls: string[] }>(groups.map(group => [group.id, { toggles: [], controls: [] }]));
  (panel?.sections ?? []).forEach((section, index) => {
    const byGroup = new Map<CharacterGroupId, CcPanelRow[]>();
    for (const row of section.rows) {
      const group = groupOfPart(row.part);
      if (!drafts.has(group)) continue;
      const list = byGroup.get(group);
      if (list) list.push(row); else byGroup.set(group, [row]);
    }
    for (const [group, rows] of byGroup) drafts.get(group)!.push({ key: `${group}/${section.id}`, title: section.label, creator: section.id, makeup: section.makeup,
      rows, toggles: [], controls: [], order: index });
  });
  const creatorCount = panel?.sections.length ?? 0;
  for (const contribution of [...contributions].sort((a, b) => a.order - b.order)) {
    const sections = drafts.get(contribution.group);
    if (!sections) continue;
    if (contribution.onGroup) {
      const parts = groupParts.get(contribution.group)!;
      if (contribution.toggle) parts.toggles.push(contribution.toggle);
      parts.controls.push(...contribution.controls ?? []);
      continue;
    }
    const detail = contribution.detail;
    let target = detail ? sections.find(section => section.creator && section.rows.some(row => rowDetail(row) === detail)) : undefined;
    // Two contributions naming the same own section (by title) share it.
    target ??= sections.find(section => !section.creator && section.title === contribution.title);
    if (!target) {
      target = { key: `${contribution.group}/${contribution.id}`, title: contribution.title ?? contribution.id, creator: null, makeup: false, rows: [], toggles: [], controls: [],
        order: contribution.order < 0 ? contribution.order - 1000 : creatorCount + contribution.order };
      sections.push(target);
    }
    if (contribution.toggle) target.toggles.push(contribution.toggle);
    target.controls.push(...contribution.controls ?? []);
  }
  return [...groups].sort((a, b) => a.order - b.order).map(group => ({ id: group.id, title: group.title, ...groupParts.get(group.id)!,
    sections: drafts.get(group.id)!.sort((a, b) => a.order - b.order).map(({ order: _order, ...section }) => section) }));
}
