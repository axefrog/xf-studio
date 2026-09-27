/**
 * The Character panel: every creator option of the shown V, generated from the installed game and mods (the character context's
 * catalogue; character-context-actions.ts). Sections come from the game's creator categories, then rows (options sharing a creator
 * slot; the active one shows), then the row's choices, paged (character-choices.ts). Each row shows the V's current choice, an Off
 * control where the option has one, and Reset to the V's own; where each choice comes from is its accessible description and tooltip.
 * Options the 3D view can't draw say so.
 *
 * Every change is a typed `character.*` action with its own Undo history (CORE-59); the rules live in the application service, so this
 * module only dispatches (the V's own makeup is a switch, `character.setOwnMakeup`: instant and undoable; CORE-71). One Undo rule covers the whole panel (UI-81): its
 * Undo and Redo, and Ctrl+Z / Ctrl+Y anywhere in it except a text box, step through the panel's changes (creator choices,
 * Clothing and the V's own makeup) in the order they were made; the header's Undo covers the makeup only and says so. Nothing here moves the layout on its own (UI-68):
 * one status line of fixed height carries what is on its way or failed, with Try again and Keep my changes inline, and a Details
 * disclosure for the plain lines about what couldn't be used; a row reserves its detail line when any of its options has one, and a
 * row whose choice the 3D view doesn't draw shows a fixed-size marker. Search runs on the host over every choice (UI-72); files come last.
 *
 * **One hierarchy** (character-panel-sections.ts): the parts of V (Head, Body, Clothing), then the panel's own sections (Face holds
 * Eyes, Eyebrows, Eyelashes and the rest as subsections; rows land by what they control, not by the creator's categories), then rows. What the 3D view shows is part of it, not a list of its own: each show/hide switch sits on the
 * heading row of what it shows (Hair on Hair, the body on Body, clothes on Clothing), the eye shape in Eyes, and the uncensored setting
 * in Body. The tree is derived from the creator projection and the contributions, so a module adds sections without this module
 * changing; a switch that can't change says why in the line reserved under its heading and stays focusable (UI-84). Colour rows draw
 * every choice as a narrow swatch derived from the resource that wins for it, with the game's icons (character-choices.ts).
 *
 * **Folding** (expander.ts): the parts of V, their sections, the rows and a row's author groups all fold with one expander. A group's
 * or section's fold is remembered (the `folded.set` UI preference, keyed `character:<key>`); a section with rows has Expand all /
 * Collapse all at the far right of its heading (and in the palette), which opens or closes its rows and unfolds their author groups.
 * A search leaves folds alone: a folded heading holding matches shows how many.
 *
 * **Help, not notes** (help-tip.ts): what a heading, row or control is (hair physics, a row that follows a switcher, what the body
 * switch covers, what a save import does) is in a help tip beside it; inline lines are kept for what the person can act on.
 *
 * An open row's choices are prepared ahead in the background (character-context-actions.ts `prefetch`), the ones in view first; each
 * choice not prepared yet carries a corner mark, one line under the search explains the marks once, and a first-time change says why
 * it takes a moment. Closing the row stops it. The prepared game files' size and "Clear prepared game files" sit with the 3D view's
 * own controls.
 */
import { shortcutLabel } from "../../input-bindings";
import type { CcPanel, CcPanelOption, CcPanelRow, CreatorView } from "../../cc-panel";
import { applyCapability, button, note, section, SelectField, Toggle } from "../controls";
import { h, isTextInput, setAttr, setText, setUnavailable, uid } from "../dom";
import { ExpandAll, expander, expanderLabel, isExpanded, setExpanded } from "../expander";
import { ChoiceList, propertyList, SearchField } from "../components";
import { helpTip, setHelp } from "../help-tip";
import type { Command } from "../commands";
import { allSections, CHARACTER_CONTRIBUTIONS, characterPanelTree, type CharacterPanelGroup, type CharacterPanelSection, type CharacterSectionContribution,
  type CharacterToggle, type CharacterToggleState } from "../../character-panel-sections";
import { icon } from "../icons";
import type { Frame, Port, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { characterDetailLine, characterDetailRows } from "./preview";
import { ChoiceList as CreatorChoiceList, swatchLook } from "./character-choices";
import { wolvenKitStepButton } from "../wolvenkit-step";
import type { ClothingState } from "../../clothing-dressing";
import type { ClothingArea } from "../../save-loadout";

const NOT_SHOWN = "Not shown in the 3D view yet.";
const CLOTHES_HELP = "Your V's clothes as your save records them. They are drawn without the game's garment fitting, so layers can clip at the edges.";
/** The status line while a choice that wasn't prepared ahead is prepared. */
const FIRST_TIME = "Updating… The first time takes a few seconds.";
const LEGEND = "Not prepared yet";
const LEGEND_FETCHING = "Preparing";
/** What the marks mean, in the legend's help tip. */
const LEGEND_HELP = "A choice that isn't prepared yet is read from your game files when you choose it, which takes a few seconds the first time. Choices are prepared in the background, the ones in view first.";
/** One line each (the legend's line never grows); every choice still works either way. */
const STOPPED: Record<"time" | "disk" | "setup", string> = {
  time: "Preparing ahead paused for this row.",
  disk: "Preparing ahead paused: this session's disk space is used.",
  setup: "Choices are prepared once WolvenKit is set up.",
};
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
/** The part of the page a list scrolls in (its nearest scrolling ancestor, clipped to the window), or null without layout. */
function scrollView(from: HTMLElement): { top: number; bottom: number } | null {
  if (typeof getComputedStyle !== "function" || typeof from.getBoundingClientRect !== "function") return null;
  let top = 0, bottom = typeof innerHeight === "number" ? innerHeight : 0;
  for (let node = from.parentElement; node; node = node.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
    break;
  }
  return bottom > top ? { top, bottom } : null;
}

type RowView = { row: CcPanelRow; section: string; options: CcPanelOption[] };
/** The option a row shows: the one the view marks active, else its first while the view is on its way (cc-panel.ts `rowOption`). */
const rowOption = (panel: Readonly<CcPanel>, row: Readonly<CcPanelRow>, view: Readonly<CreatorView> | null): CcPanelOption | null => {
  const options = row.options.map(index => panel.options[index]!);
  return view ? options.find(option => view.values[option.id]?.active) ?? null : options[0] ?? null;
};

/**
 * A show/hide switch on a heading row: a compact switch whose accessible name says what it shows. When it can't change it stays
 * focusable, marked `aria-disabled`, and its reason is its description and the page's reason tip (UI-84); the switch then snaps back.
 */
class HeadingToggle {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private unavailable = false;
  constructor(readonly toggle: CharacterToggle, onChange: (shown: boolean) => void) {
    this.input = h("input", { type: "checkbox", role: "switch", class: "switch", "aria-label": toggle.label });
    this.element = h("label", { class: "toggle cc-heading-toggle", title: toggle.label }, this.input, h("span", { class: "switch-track", "aria-hidden": "true" }),
      h("span", { class: "toggle-label", text: "Shown" }));
    this.input.addEventListener("click", event => { if (this.unavailable) event.preventDefault(); });
    this.input.addEventListener("change", () => { if (!this.unavailable) onChange(this.input.checked); });
  }
  update(shown: boolean, unavailable: string | null) {
    if (this.input.checked !== shown) this.input.checked = shown;
    this.unavailable = !!unavailable;
    setUnavailable(this.input, !!unavailable, unavailable ?? undefined);
    this.element.classList.toggle("unavailable", !!unavailable);
    this.element.title = unavailable ?? this.toggle.label;
  }
}
/** The controls contributions name, by ID: the panel's own; a module passes its own beside them. */
export type CharacterControls = Readonly<Record<string, HTMLElement>>;

/** The Character panel with the Studio's own contributions. */
export const characterPanel = (rt: StudioRuntime): PanelController => characterPanelWith(rt);
/** The Character panel with a module's contributions and the controls they name (beside the panel's own). */
export function characterPanelWith(rt: StudioRuntime, contributions: readonly CharacterSectionContribution[] = CHARACTER_CONTRIBUTIONS,
  moduleControls: CharacterControls = {}): PanelController {
  const port = rt.port;
  const dispatch = (action: Parameters<StudioRuntime["dispatch"]>[0]) => rt.dispatch(action);

  // ---- The V and its source ----
  const source = h("p", { class: "cc-source" });
  const loadSave = button({ label: "Load a save…", icon: "import", small: true, onClick: () => void rt.file({ kind: "savedV.import" }) });
  const loadPreset = button({ label: "Load preset…", icon: "import", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "characterPreset.import" }) });
  const savePreset = button({ label: "Save preset…", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "characterPreset.export" }) });
  // The creator's two default Vs, one per body (the voice is not a body choice and changes nothing drawn).
  const defaultButton = (bodyGender: "female" | "male", word: string) => button({ label: `Default V (${word})`, icon: "character", small: true,
    variant: "quiet", title: `Show the character creator's default ${word} V (Undo shows your V again)`,
    onClick: () => dispatch({ kind: "character.useDefault", bodyGender }) });
  const useDefault = defaultButton("female", "feminine"), useDefaultMale = defaultButton("male", "masculine");
  // The panel's one Undo and Redo (UI-81): creator choices and Clothing, in the order they were made.
  const undo = button({ label: "Undo in the Character panel", icon: "undo", iconOnly: true, small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.undo" }) });
  const redo = button({ label: "Redo in the Character panel", icon: "redo", iconOnly: true, small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.redo" }) });
  // A switch, not a one-way action: the V's own makeup hides and shows again at once, and the panel's Undo steps it back.
  const ownMakeup = new Toggle({ label: "Show my V's own makeup", onChange: shown => dispatch({ kind: "character.setOwnMakeup", shown }),
    help: "Turn it off to see only the makeup you're making on your V. Your V's creator choices don't change, and the panel's Undo turns it back on." });
  const resetAll = button({ label: "Reset all", icon: "reset", small: true, variant: "quiet", title: "Every creator change back to your V's own (Undo brings them back)",
    onClick: () => dispatch({ kind: "character.resetAll" }) });
  // One status line of fixed height: the text is clamped to one line, and its actions keep their place when not offered (UI-68).
  const statusText = h("span", { class: "cc-status-text", role: "status", "aria-live": "polite" });
  const retry = button({ label: "Try again", icon: "refresh", small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.retry" }) });
  const keep = button({ label: "Keep my changes", icon: "check", small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.keepChanges" }) });
  // Offered when the V's details or the creator's labels wait for WolvenKit (NATIVE-46, NATIVE-47).
  const setupWolvenKit = wolvenKitStepButton(rt);
  const detailsToggle = button({ label: "Details", small: true, variant: "quiet", className: "cc-details-toggle",
    onClick: () => { showMessages = !showMessages; rt.changed(); } });
  detailsToggle.setAttribute("aria-expanded", "false"); detailsToggle.setAttribute("aria-controls", "cc-messages");
  const status = h("div", { class: "cc-status" }, statusText, retry, setupWolvenKit.element, keep, detailsToggle);
  const messages = h("div", { class: "cc-messages", id: "cc-messages", hidden: true });
  let showMessages = false;
  // The library's search field (icon, clear button, Escape clears; the same as Poses): the panel filters on its pause, and each paint
  // reads the query from its input.
  const searchField = new SearchField({ label: "Find a creator option or choice", placeholder: "Find an option or choice", className: "cc-search-field",
    onFilter: () => rt.changed() });
  const search = searchField.input;
  search.classList.add("cc-search");
  // One line explains the marks on choices not prepared yet (fixed height: it never moves the rows).
  const legendText = h("span", { class: "cc-legend-text" },
    h("span", { class: "cc-fetch-mark", "data-fetch": "pending", "aria-hidden": "true" }), ` ${LEGEND} · `,
    h("span", { class: "cc-fetch-mark", "data-fetch": "fetching", "aria-hidden": "true" }), ` ${LEGEND_FETCHING}`, helpTip("the marks on choices", LEGEND_HELP));
  const legendStopped = h("span", { class: "cc-legend-text", hidden: true });
  const legend = h("p", { class: "note cc-legend" }, legendText, legendStopped);
  const noMatch = note("No option or choice matches.");
  noMatch.hidden = true;

  // ---- Clothing: which of V's clothes the 3D view shows (a viewing setting; the panel's Undo steps it too) ----
  // Every state on offer shown at once (show the options): long labels, so one full-width row each (ChoiceList `rows`).
  const clothingState = new ChoiceList<ClothingState>({ label: "Clothes in the 3D view", layout: "rows", onSelect: state => dispatch({ kind: "character.setClothing", state }),
    help: CLOTHES_HELP });
  // One switch per clothing area the save dresses; switching one picks the areas yourself (the setting becomes "Choose areas").
  const areaToggles = new Map<ClothingArea, Toggle>();
  const clothingAreas = h("div", { class: "cc-clothing-areas" });
  // What is on its way or couldn't be drawn (a status; what the setting is lives in its help tip).
  const clothingNote = note("");

  // ---- Controls contributions name (character-panel-sections.ts): the eye shape, the uncensored look, the clothes ----
  // A numbered set (1–22, by head): an even grid of tiles (ChoiceList `tiles`), each named "Eye shape n".
  const eyeShape = new ChoiceList<string>({ label: "Eye shape in the 3D view", layout: "tiles", onSelect: value => dispatch({ kind: "preview.setEyeShape", index: Number(value) }),
    help: "The 3D view's eye shape, which eye makeup is placed on. It overrides your V's Eyes row in the 3D view only." });
  // One reserved line: why the eye shape waits, or that it overrides the saved one (never appears or vanishes).
  const eyeNote = note("");
  eyeNote.classList.add("cc-reserved-note");
  const uncensored = new Toggle({ label: "Show my V uncensored", onChange: enabled => dispatch({ kind: "preview.setUncensored", enabled }),
    help: ["Off: the game's censored look, with its underwear.", "On: your V as the game shows it when nudity is allowed: nipples and genitals as you chose them, with no underwear."] });
  const exportV = button({ label: "Export appearance data", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "savedV.export" }) });
  const detailNote = note("");
  // The V's details as the 3D view draws them (ui-copy-and-layout-review.md §3.10): a folded list, one row per part of V, the reason for
  // anything not shown in that row's help tip, and the renderer's limits in one row of their own.
  const detailsBodyId = uid("cc-details");
  const detailsCount = h("span", { class: "expander-count" });
  const detailsExpander = expander("subsection", { expanded: false, controls: detailsBodyId }, expanderLabel("In the 3D view"), detailsCount);
  const detailsBody = h("div", { class: "cc-details-body", id: detailsBodyId, hidden: true });
  const detailsMessage = note("");
  detailsExpander.addEventListener("click", () => { const open = !isExpanded(detailsExpander); setExpanded(detailsExpander, open); detailsBody.hidden = !open; detailsBlock.hidden = !open; });
  // Its heading leads the panel's one status line (the line's fixed height, so an empty status leaves no band of its own; showing or
  // hiding the heading moves only the status text sideways, never anything below), and its list opens under the line.
  const detailsHead = h("div", { class: "control-line cc-details-head", hidden: true }, h("h4", { class: "cc-details-title" }, detailsExpander),
    helpTip("what the 3D view shows", "Your V's details as the 3D view draws them. Shading and lighting are approximate."));
  const detailsBlock = h("div", { class: "cc-details", hidden: true }, detailsBody);
  status.insertBefore(detailsHead, statusText);
  // The game files prepared for the 3D view on this computer, and clearing them.
  const preparedText = h("span", { class: "cc-prepared-text" });
  const clearPrepared = button({ label: "Clear prepared game files", icon: "trash", small: true, variant: "quiet",
    title: "Removes the files XF Studio prepared from your game for the 3D view. They are read from your game again when needed; your makeup, presets and settings stay.",
    onClick: () => dispatch({ kind: "character.clearPreparedFiles" }) });

  const controls_: CharacterControls = {
    eyeShape: h("div", { class: "cc-control" }, eyeShape.element, eyeNote),
    uncensored: h("div", { class: "cc-control" }, uncensored.element),
    clothingState: h("div", { class: "cc-control" }, h("div", { class: "row gap-s cc-clothing" }, clothingState.element), clothingNote),
    clothingAreas,
    ...moduleControls,
  };
  const groupsHost = h("div", { class: "cc-groups" });
  const element = h("div", { class: "panel-content cc-panel" },
    // Two rows: which V (a save or a default V) with the panel's history, then character presets with Reset all (§4 L2).
    section("Your V", source, h("div", { class: "row wrap gap-s" }, loadSave, useDefault, useDefaultMale, h("span", { class: "cc-history" }, undo, redo)),
      h("div", { class: "row wrap gap-s" }, loadPreset, savePreset, h("span", { class: "cc-history" }, resetAll)), status, messages, detailNote, detailsBlock),
    h("section", { class: "section cc-quick" }, ownMakeup.element),
    h("div", { class: "cc-find" }, searchField.element, legend, noMatch),
    groupsHost,
    section({ title: "Files", help: "A save is read on this computer and never changed or uploaded." }, h("div", { class: "row wrap gap-s" }, exportV),
      h("div", { class: "row wrap gap-s cc-prepared" }, preparedText, clearPrepared)));

  // One rule (UI-81): inside this panel the Undo keys step through the panel's own changes (creator choices and Clothing), whatever has
  // focus (a switch, a list, a button), never the makeup's history. Only a text box keeps its own text Undo.
  element.addEventListener("keydown", event => {
    if (isTextInput(event.target) && (event.target as Element).tagName.toLowerCase() !== "select") return;
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey || (key !== "z" && key !== "y")) return;
    event.preventDefault();
    dispatch({ kind: key === "y" || event.shiftKey ? "character.redo" : "character.undo" });
  });

  // ---- Rows ----
  type RowControls = { view: RowView; element: HTMLElement; main: HTMLButtonElement; label: HTMLElement; value: HTMLElement; swatch: HTMLElement;
    notShown: HTMLElement; off: HTMLButtonElement; reset: HTMLButtonElement;
    /** What the row is (it follows a switcher, the 3D view can't draw it), in a help tip; only on rows where an option has something to say. */
    help: HTMLButtonElement | null; list: CreatorChoiceList;
    open: boolean; query: string;
    /** The option whose choices are being prepared ahead, and their positions in the order to prepare them (in view first). */
    prefetching: string | null; positions: number[]; loaded: number };
  type Heading = { toggles: HeadingToggle[]; help: HTMLButtonElement | null; expander: HTMLButtonElement; count: HTMLElement; expandAll: ExpandAll | null };
  /** `fold`: its key in the `folded` UI preference; `body`: what folding hides (everything under the heading). */
  /** `rows`: every row in it, its sections' included (what Expand all, a search count and its showing go by); `own`: its own rows. */
  type SectionControls = { element: HTMLElement; heading: Heading; rows: RowControls[]; own: RowControls[]; fixed: boolean; fold: string; body: HTMLElement;
    title: string; parent: SectionControls | null; children: SectionControls[] };
  /** `sections`: every section of the group, depth first (a parent before its children). */
  type GroupControls = { element: HTMLElement; heading: Heading; sections: SectionControls[]; fold: string; body: HTMLElement; title: string };
  let built: { identity: string; rows: RowControls[]; groups: GroupControls[] } | null = null;
  const openRows = new Set<string>();
  /** The one open row whose choices are prepared ahead: the one opened or pointed at last. */
  let aheadRow: string | null = null;
  const rowKey = (view: RowView) => `${view.row.part}/${view.row.slot}`;
  /** Coverage that hides the row now: not drawn at all, or drawn only in the uncensored look while it is off. */
  const notDrawn = (option: CcPanelOption, uncensoredOn: boolean) => option.coverage[0] === "not-rendered" || (option.coverage[0] === "uncensored" && !uncensoredOn);
  const staticDetail = (panel: Readonly<CcPanel>, option: CcPanelOption, uncensoredOn: boolean) => [notDrawn(option, uncensoredOn) ? panel.notes[option.coverage[1]] || NOT_SHOWN : "",
    option.dependsOn.length ? `Choose ${option.dependsOn.join(" or ")} first: this follows it.` : ""].filter(Boolean).join(" ");

  // ---- Folding: the headings folded, remembered in the UI preferences (read each paint, changed at once on a press) ----
  const FOLD = "character:";
  let folded = new Set<string>();
  const readFolds = (keys: readonly string[] | undefined) => { folded = new Set((keys ?? []).filter(key => key.startsWith(FOLD))); };
  function setFolds(keys: readonly string[], fold: boolean) {
    if (!keys.length) return;
    for (const key of keys) if (fold) folded.add(key); else folded.delete(key);
    const action = { kind: "folded.set" as const, keys, folded: fold };
    // Presentation state: the fold shows at once; remembering it is best effort (a full store still folds for this session).
    const preferences = port.preferences as Port["preferences"] | undefined;
    if (preferences?.capability(action).available) preferences.dispatch(action);
    paintFolds(search.value.trim().toLowerCase());
    rt.changed();
  }

  /** A heading row: an expander with its title, the help tip, the switches for what it shows and, for a section with rows, Expand all. */
  function heading(level: "group" | "section" | "subsection", title: string, toggles: readonly CharacterToggle[], body: string, onFold: () => void,
    onExpandAll: ((expand: boolean) => void) | null): { row: HTMLElement; heading: Heading } {
    const switches = toggles.map(toggle => new HeadingToggle(toggle, shown => dispatch(toggle.action(shown))));
    // While a search runs, a folded heading says how many rows in it match.
    const count = h("span", { class: "expander-count cc-match-count", hidden: true });
    const button = expander(level, { expanded: true, controls: body }, expanderLabel(title), count);
    button.addEventListener("click", onFold);
    const help = toggles.some(toggle => toggle.help) ? helpTip(title) : null;
    const expandAll = onExpandAll ? new ExpandAll(title, onExpandAll) : null;
    const row = h("div", { class: `cc-heading ${level === "group" ? "cc-group-head" : "cc-section-head"}` },
      h(level === "group" ? "h3" : level === "section" ? "h4" : "h5", { class: level === "group" ? "cc-group-title" : "cc-section-title" }, button), help,
      h("span", { class: "cc-heading-end" }, ...switches.map(toggle => toggle.element), expandAll?.element));
    return { row, heading: { toggles: switches, help, expander: button, count, expandAll } };
  }
  /** Open or close every row of a section; expanding also unfolds the section and its rows' author groups. */
  function expandSection(section: SectionControls, expand: boolean) {
    const within = (entry: SectionControls): SectionControls[] => [entry, ...entry.children.flatMap(within)];
    if (expand) setFolds(within(section).map(entry => entry.fold).filter(key => folded.has(key)), false);
    for (const row of section.rows) {
      if (row.element.hidden) continue;
      if (row.open !== expand) toggle(row, false);
      if (expand) row.list.setAllFolded(false);
    }
    rt.changed();
  }
  /** Whether a section's Expand all expands now: it is folded, or one of its shown rows is closed or has a folded author group. */
  const sectionExpands = (section: SectionControls): boolean => folded.has(section.fold) || section.children.some(child => folded.has(child.fold))
    || section.rows.some(row => !row.element.hidden && (!row.open || row.list.anyFolded()));
  /** The tree's shape: what decides a rebuild (a catalogue or the contributions changing, never a paint). */
  const treeIdentity = (panel: Readonly<CcPanel> | null, tree: readonly CharacterPanelGroup[]) =>
    `${panel?.identity ?? ""}
${tree.map(group => `${group.id}:${group.toggles.map(t => t.id)}:${group.controls}:${allSections(group.sections).map(section =>
      `${section.key}/${section.children.length}/${section.rows.length}/${section.toggles.map(t => t.id)}/${section.controls}`).join(",")}`).join(";")}`;

  function buildTree(panel: Readonly<CcPanel> | null, tree: readonly CharacterPanelGroup[]) {
    for (const controls of built?.rows ?? []) stopPrefetch(controls);
    const rows: RowControls[] = [];
    let serial = 0;
    const groups: GroupControls[] = tree.map(group => {
      const flat: SectionControls[] = [];
      // A section, then the sections inside it (a subsection's heading is one level down).
      const buildSection = (entry: CharacterPanelSection, parent: SectionControls | null): SectionControls => {
        const rowsHost = h("div", { class: "cc-rows" });
        const own: RowControls[] = [];
        for (const row of panel ? entry.rows : []) {
          const view: RowView = { row, section: entry.title, options: row.options.map(index => panel!.options[index]!) };
          const controls = buildRow(panel!, view, `cc-choices-${++serial}`);
          rowsHost.append(controls.element);
          rows.push(controls); own.push(controls);
        }
        const bodyId = `cc-section-${++serial}`, fold = `${FOLD}${entry.key}`;
        const extras = entry.controls.flatMap(id => controls_[id] ? [controls_[id]!] : []);
        const body = h("div", { class: "cc-section-body", id: bodyId }, ...extras, rowsHost);
        const controls: SectionControls = { element: body, heading: null!, rows: own, own, fixed: extras.length > 0 || entry.toggles.length > 0, fold, body,
          title: entry.title, parent, children: [] };
        flat.push(controls);
        controls.children = entry.children.map(child => buildSection(child, controls));
        if (controls.children.length) body.append(h("div", { class: "cc-subsections" }, ...controls.children.map(child => child.element)));
        controls.rows = [...own, ...controls.children.flatMap(child => child.rows)];
        controls.fixed ||= controls.children.some(child => child.fixed);
        const head = heading(parent ? "subsection" : "section", entry.title, entry.toggles, bodyId, () => setFolds([fold], !folded.has(fold)),
          // Expand all only where it does more than a row's own chevron: two rows or more.
          controls.rows.length > 1 ? expand => expandSection(controls, expand) : null);
        controls.heading = head.heading;
        controls.element = h("section", { class: `cc-section${parent ? " cc-subsection" : ""}`, "data-section": entry.key }, head.row, body);
        return controls;
      };
      const top = group.sections.map(entry => buildSection(entry, null));
      const sections = flat;
      const bodyId = `cc-group-${group.id}`, fold = `${FOLD}group/${group.id}`;
      const extras = group.controls.flatMap(id => controls_[id] ? [controls_[id]!] : []);
      const body = h("div", { class: "cc-group-body", id: bodyId }, ...extras, h("div", { class: "cc-sections" }, ...top.map(section => section.element)));
      const head = heading("group", group.title, group.toggles, bodyId, () => setFolds([fold], !folded.has(fold)), null);
      const element = h("section", { class: "cc-group", "data-group": group.id }, head.row, body);
      return { element, heading: head.heading, sections, fold, body, title: group.title };
    });
    groupsHost.replaceChildren(...groups.map(group => group.element));
    built = { identity: treeIdentity(panel, tree), rows, groups };
  }

  function buildRow(panel: Readonly<CcPanel>, view: RowView, id: string): RowControls {
        const label = h("span", { class: "expander-label cc-row-label" }), swatch = h("span", { class: "swatch cc-row-swatch", hidden: true });
        const value = h("span", { class: "cc-row-value" });
        const notShown = h("span", { class: "cc-row-not-shown", title: NOT_SHOWN, "aria-hidden": "true" }, icon("eyeOff"));
        const main = expander("row", { expanded: false, controls: id }, label, h("span", { class: "cc-row-current" }, swatch, value), notShown);
        main.classList.add("cc-row-main");
        const controls: RowControls = { view, element: h("div", { class: "cc-row", "data-slot": view.row.slot }), main, label, value, swatch, notShown,
          off: h("button", { class: "chip-button cc-off", type: "button", text: "Off" }),
          reset: button({ label: "Back to your V's own", icon: "reset", iconOnly: true, small: true, variant: "quiet", onClick: () => {} }),
          // A help tip only where one of the row's options has something to say; it keeps its place when the shown one has nothing (UI-68).
          help: view.options.some(option => staticDetail(panel, option, false)) ? helpTip(view.options[0]!.label) : null,
          list: new CreatorChoiceList(id, choice => {
            const option = current(controls);
            if (option) dispatch({ kind: "character.setOption", part: option.part, option: option.name, choice: choice.key, ...(choice.activates ? { activates: [...choice.activates] } : {}) });
          }, choice => {
            // A hovered or focused choice is prepared next (its row becomes the one prepared ahead).
            if (aheadRow !== rowKey(controls.view)) { aheadRow = rowKey(controls.view); rt.changed(); return; }
            if (controls.prefetching && controls.positions.length) port.authoring.characterPrefetch(controls.prefetching, controls.positions, choice.position);
          }),
          open: openRows.has(rowKey(view)), query: "",
          prefetching: null, positions: [], loaded: -1 };
        main.addEventListener("click", () => toggle(controls));
        controls.off.addEventListener("click", () => {
          const option = current(controls);
          if (option?.off !== null && option) dispatch({ kind: "character.setOption", part: option.part, option: option.name, choice: option.off });
        });
        controls.reset.addEventListener("click", () => {
          const option = current(controls);
          if (option) dispatch({ kind: "character.reset", part: option.part, option: option.name });
        });
        controls.list.element.hidden = true;
        controls.element.append(h("div", { class: "cc-row-head" }, main, controls.help, h("span", { class: "cc-row-actions" }, controls.off, controls.reset)),
          controls.list.element);
        return controls;
  }
  const current = (controls: RowControls): CcPanelOption | null => {
    const panel = port.authoring.characterPanel();
    return panel ? rowOption(panel, controls.view.row, port.authoring.characterView()) : null;
  };
  function toggle(controls: RowControls, paint = true) {
    controls.open = !controls.open;
    const key = rowKey(controls.view);
    if (controls.open) { openRows.add(key); aheadRow = key; }
    else { openRows.delete(key); stopPrefetch(controls); if (aheadRow === key) aheadRow = [...openRows].at(-1) ?? null; }
    // The chevron turns at once; the list follows on the next paint.
    setExpanded(controls.main, controls.open);
    if (paint) rt.changed();
  }
  /** Stop preparing a row's choices ahead (it closed, or shows another option or a search). */
  function stopPrefetch(controls: RowControls) {
    if (controls.prefetching) port.authoring.characterStopPrefetch(controls.prefetching);
    controls.prefetching = null; controls.positions = []; controls.loaded = -1;
  }
  /** Prepare an open row's choices ahead, the ones in view first, and return their states. */
  function prefetchRow(controls: RowControls, option: CcPanelOption) {
    if (controls.prefetching !== option.id) { stopPrefetch(controls); controls.prefetching = option.id; }
    return port.authoring.characterPrefetch(option.id, controls.positions);
  }
  // Scrolling brings other choices into view: they are prepared first. The panel scrolls in its dock, so the page's scrolls are heard.
  let scrollFrame = 0;
  if (typeof document !== "undefined" && typeof requestAnimationFrame === "function") document.addEventListener("scroll", () => {
    if (scrollFrame || !element.isConnected) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      for (const controls of built?.rows ?? []) if (controls.open && controls.prefetching) {
        controls.positions = controls.list.visiblePositions(scrollView(controls.list.list));
        port.authoring.characterPrefetch(controls.prefetching, controls.positions);
      }
    });
  }, { capture: true, passive: true });

  function updateRows(frame: Frame, panel: Readonly<CcPanel> | null, view: Readonly<CreatorView> | null) {
    const tree = characterPanelTree(panel, contributions);
    if (built?.identity !== treeIdentity(panel, tree)) buildTree(panel, tree);
    const query = search.value.trim().toLowerCase();
    // The host searches every choice, not only those loaded (UI-72); rows matching by name show while it answers.
    const found = query ? port.authoring.characterSearch(query) : null;
    let stopped: "time" | "disk" | "setup" | null = null;
    const details = frame.status.assets.characterDetails, drawn = new Set(details?.drawn ?? []);
    const uncensoredOn = frame.preview.preview?.uncensored === true;
    let visibleRows = 0;
    for (const controls of panel ? built!.rows : []) {
      const option = rowOption(panel!, controls.view.row, view), creator = panel!;
      const value = option ? view?.values[option.id] : undefined;
      const rowText = `${controls.view.section} ${controls.view.options.map(entry => entry.label).join(" ")}`.toLowerCase();
      const rowMatches = !query || rowText.includes(query);
      const choiceMatches = !!query && !rowMatches && !!option && !!found?.options?.has(option.id);
      // A row whose active option offers one choice (an Off placeholder of its slot) has nothing to choose, as in the creator.
      const visible = !!option && option.count > 1 && (rowMatches || choiceMatches);
      controls.element.hidden = !visible;
      if (!option || !visible) continue;
      visibleRows++;
      setText(controls.label, option.label);
      const chosenLabel = value?.label ?? (view ? "" : "…");
      setText(controls.value, value ? (value.choice === option.off ? "Off" : chosenLabel) : chosenLabel);
      // The current choice's swatch: what wins for it (the row's swatches once open, else the view's), else its own colour.
      const rowSwatches = option.grid && controls.open ? port.authoring.characterSwatches(option.id) : null;
      const look = value ? swatchLook({ position: value.position, color: value.color },
        rowSwatches ?? (value.swatch ? { swatches: { [value.position]: value.swatch } as unknown as string[], icons: [], sheets: new Map(), pending: false } : null)) : null;
      controls.swatch.hidden = !look || look.kind === "none" || isOffChoice(option, value);
      if (look && look.kind !== "none") {
        controls.swatch.style.setProperty("--swatch", look.background || "transparent");
        controls.swatch.style.setProperty("--swatch-image", look.image);
        controls.swatch.style.setProperty("--swatch-size", look.size);
        controls.swatch.style.setProperty("--swatch-position", look.position);
      }
      controls.element.classList.toggle("changed", !!value?.set);
      setExpanded(controls.main, controls.open);
      // Honest coverage: what the 3D view can't draw says so; a conditional option settles from what the shown V draws.
      const isOff = !!value && value.choice === option.off;
      const conditionalHidden = option.coverage[0] === "conditional" && option.type === "appearance" && !!value && !isOff && details?.phase === "ready" && !drawn.has(option.name);
      const from = option.mod >= 0 ? `From ${creator.mods[option.mod]}` : "From the game";
      const own = value && value.choice !== value.own ? `Your V's own: ${value.ownLabel}.` : "";
      const describe = [from, own, conditionalHidden ? NOT_SHOWN : ""].filter(Boolean).join(". ").replace(/\.\./g, ".");
      controls.main.title = `${option.label}: ${value?.label ?? ""} · ${describe}`;
      setAttr(controls.main, "aria-description", describe);
      controls.notShown.classList.toggle("on", conditionalHidden);
      // Off where the option has one; Reset once it differs from the V's own. Both keep their place when unavailable (no layout shift).
      controls.off.hidden = option.off === null;
      setAttr(controls.off, "aria-pressed", String(isOff));
      applyCapability(controls.off, isOff ? { available: false, reason: `${option.label} is already Off.` }
        : port.authoring.capability({ kind: "character.setOption", part: option.part, option: option.name, choice: option.off ?? "" }));
      controls.reset.title = value?.set ? `Back to your V's own: ${value.ownLabel}` : "This is your V's own choice.";
      setAttr(controls.reset, "aria-label", controls.reset.title);
      applyCapability(controls.reset, port.authoring.capability({ kind: "character.reset", part: option.part, option: option.name }));
      if (controls.help) {
        setHelp(controls.help, staticDetail(creator, option, uncensoredOn));
        setAttr(controls.help, "aria-label", `About ${option.label}`);
      }
      controls.element.classList.toggle("not-shown", notDrawn(option, uncensoredOn) || conditionalHidden);
      const opening = controls.open && controls.list.element.hidden;
      controls.list.element.hidden = !controls.open;
      // A row that opens shows the V's choice: its group opens and it is scrolled into view once it has loaded.
      if (opening) controls.list.revealChosenNext();
      if (!controls.open) continue;
      // An open row lists every choice, or with a search that only its choices match, the matching ones.
      controls.query = rowMatches ? "" : query;
      // Every choice (show the options): the row's pages load one after another, each appended as it arrives; nothing waits behind a button.
      const loaded = port.authoring.characterChoices(option.id, Number.MAX_SAFE_INTEGER, controls.query);
      // Its choices are prepared ahead while it shows them all, when the 3D view draws the option.
      const ahead = !controls.query && option.coverage[0] !== "not-rendered" && aheadRow === rowKey(controls.view);
      if (!ahead) stopPrefetch(controls);
      const fetch = ahead ? prefetchRow(controls, option) : null;
      if (fetch?.stopped) stopped = fetch.stopped;
      controls.list.update({ option: option.id, query: controls.query, label: option.label, grid: option.grid, choices: loaded?.choices ?? [],
        selected: value?.position ?? null, mods: creator.mods, loading: loaded?.loading ?? true, error: loaded?.error ?? null, fetch: fetch?.states ?? null,
        swatches: option.grid ? rowSwatches : null, preparing: !!details?.updating,
        groups: option.groups > 1 ? { list: creator.groups, modGroups: creator.modGroups, pooled: creator.pools[option.pool] ?? [] } : null });
      if (ahead && (loaded?.choices.length ?? 0) !== controls.loaded) {
        controls.loaded = loaded?.choices.length ?? 0;
        controls.positions = controls.list.visiblePositions(scrollView(controls.list.list));
        prefetchRow(controls, option);
      }
    }
    // A section shows while it has a row to show, or controls of its own (not while a search finds nothing in it); a group while a section does.
    for (const group of built!.groups) {
      let any = false;
      for (const section of group.sections) {
        const shown = section.rows.some(row => !row.element.hidden) || (section.fixed && !query);
        section.element.hidden = !shown;
        any ||= shown;
      }
      group.element.hidden = !any && !!query;
    }
    readFolds(frame.preferences?.folded);
    paintFolds(query);
    updateHeadings(frame);
    noMatch.hidden = !query || visibleRows > 0 || !!found?.loading;
    legendText.hidden = !!stopped; legendStopped.hidden = !stopped;
    if (stopped) { setText(legendStopped, STOPPED[stopped]); legendStopped.title = STOPPED[stopped]; }
    return visibleRows;
  }
  /** Every heading's fold (the remembered ones), its match count while a search runs, and each section's Expand all. */
  function paintFolds(query: string) {
    const matches = (rows: readonly RowControls[]) => rows.filter(row => !row.element.hidden).length;
    const count = (heading: Heading, isFolded: boolean, rows: number) => {
      const shown = isFolded && !!query && rows > 0;
      heading.count.hidden = !shown;
      setText(heading.count, shown ? String(rows) : "");
      if (shown) setAttr(heading.expander, "aria-description", `${rows} matching ${rows === 1 ? "row" : "rows"} inside`);
      else heading.expander.removeAttribute("aria-description");
    };
    for (const group of built?.groups ?? []) {
      const groupFolded = folded.has(group.fold);
      group.body.hidden = groupFolded;
      setExpanded(group.heading.expander, !groupFolded);
      count(group.heading, groupFolded, matches(group.sections.filter(section => !section.parent).flatMap(section => section.rows)));
      for (const section of group.sections) {
        const sectionFolded = folded.has(section.fold);
        section.body.hidden = sectionFolded;
        setExpanded(section.heading.expander, !sectionFolded);
        count(section.heading, sectionFolded, matches(section.rows));
        section.heading.expandAll?.update(sectionExpands(section));
      }
    }
  }
  const isOffChoice = (option: CcPanelOption, value: { choice: string } | undefined) => !!value && option.off !== null && value.choice === option.off;

  /** Every heading switch: its state from the preview and why it can't change when it can't (the reason tip); what it shows in the help tip. */
  function updateHeadings(frame: Frame) {
    const preview = frame.preview.preview, clothing = frame.preview.character?.clothing;
    const state: CharacterToggleState = { preview: preview ?? null, clothing: clothing ? { state: clothing.state } : null };
    const loading = (frame.viewport.head.error ?? frame.viewport.head.message) ?? "This works once the 3D preview is ready.";
    const paint = (heading: Heading) => {
      const help: string[] = [];
      for (const control of heading.toggles) {
        const toggle = control.toggle, shown = toggle.shown(state);
        const clothes = toggle.action(true).kind === "character.setClothing";
        const ready = clothes ? !!clothing : !!preview;
        const allowed = ready ? port.authoring.capability(toggle.action(!shown) as Parameters<typeof port.authoring.capability>[0]) : { available: false, reason: loading };
        control.update(shown && ready, allowed.available ? null : allowed.reason || loading);
        const text = toggle.help?.(state);
        if (text) help.push(text);
      }
      if (heading.help) setHelp(heading.help, [...new Set(help)]);
    };
    for (const group of built?.groups ?? []) { paint(group.heading); for (const section of group.sections) paint(section.heading); }
  }

  const ancestors = (section: SectionControls): SectionControls[] => section.parent ? [...ancestors(section.parent), section.parent] : [];
  /** The palette's fold commands: Expand all / Collapse all for each section with rows, and every section folded or open at once. */
  function commands(): Command[] {
    const groups = built?.groups ?? [];
    const sections = groups.flatMap(group => group.sections.filter(section => section.rows.length > 1).map(section => ({ group, section })));
    const reveal = () => { if (typeof rt.dock?.reveal === "function") rt.dock.reveal("character", false); };
    const ready = () => sections.length ? { available: true } : { available: false, reason: "The creator options are still being read from your game." };
    const every = groups.flatMap(group => [group.fold, ...group.sections.map(section => section.fold)]);
    return [
      { id: "character.fold.openAll", title: "Open every Character section", group: "Character", icon: "expandAll", keywords: "expand unfold sections headings",
        capability: () => groups.length ? { available: true } : { available: false, reason: "The Character panel has no sections yet." },
        run: () => { reveal(); setFolds(every.filter(key => folded.has(key)), false); } },
      { id: "character.fold.closeAll", title: "Fold every Character section", group: "Character", icon: "collapseAll", keywords: "collapse fold sections headings",
        capability: () => groups.length ? { available: true } : { available: false, reason: "The Character panel has no sections yet." },
        run: () => { reveal(); setFolds(groups.flatMap(group => group.sections.filter(section => !section.parent).map(section => section.fold)).filter(key => !folded.has(key)), true); } },
      ...sections.map(({ group, section }) => {
        const expand = sectionExpands(section);
        const path = [group.title, ...ancestors(section).map(entry => entry.title), section.title].join(" › ");
        return { id: `character.fold.${section.fold.slice(FOLD.length)}`, title: `${expand ? "Expand" : "Collapse"} everything in ${path}`,
          group: "Character", icon: expand ? "expandAll" as const : "collapseAll" as const, keywords: "expand collapse all rows fold unfold section",
          capability: ready, run: () => {
            reveal();
            // Whatever holds it opens too, so what it expands shows.
            setFolds([group.fold, ...ancestors(section).map(entry => entry.fold)].filter(key => folded.has(key)), false);
            expandSection(section, expand);
          } };
      }),
    ];
  }

  return {
    commands,
    spec: { id: "character", ...PANEL_META["character"], element },
    update(frame) {
      const state = frame.preview, context = state.character, preview = state.preview, saved = state.savedV, assets = frame.status.assets;
      const details = assets.characterDetails;
      const panel = port.authoring.characterPanel(), view = port.authoring.characterView();
      // The V and its source.
      const origin = context?.origin;
      setText(source, !context ? "Your V appears once the 3D preview is ready." : origin?.kind === "save" ? "From your save" + (saved.gameVersion ? ` · game ${(saved.gameVersion / 1000).toFixed(2)}` : "")
        : origin?.kind === "preset" ? `From the preset “${origin.name ?? "Untitled"}”`
        : `The creator's default ${context.bodyGender === "male" ? "masculine" : "feminine"} V`);
      applyCapability(loadSave, port.files.capability({ kind: "savedV.import" }));
      applyCapability(loadPreset, port.files.capability({ kind: "characterPreset.import" }));
      applyCapability(savePreset, port.files.capability({ kind: "characterPreset.export" }));
      applyCapability(useDefault, port.authoring.capability({ kind: "character.useDefault", bodyGender: "female" }));
      applyCapability(useDefaultMale, port.authoring.capability({ kind: "character.useDefault", bodyGender: "male" }));
      const keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo") };
      applyCapability(undo, port.authoring.capability({ kind: "character.undo" }));
      applyCapability(redo, port.authoring.capability({ kind: "character.redo" }));
      undo.title = context?.undo ? `Undo: ${context.undo} (${keys.undo} in this panel). Covers creator options and Clothing; the header's Undo covers your makeup.`
        : "No change in this panel to undo.";
      redo.title = context?.redo ? `Redo: ${context.redo} (${keys.redo} in this panel)` : "No undone change in this panel to redo.";
      setAttr(undo, "aria-label", context?.undo ? `Undo in the Character panel: ${context.undo}` : "Undo in the Character panel");
      setAttr(redo, "aria-label", context?.redo ? `Redo in the Character panel: ${context.redo}` : "Redo in the Character panel");
      // What couldn't be used, in plain lines, behind Details: labels the catalogue couldn't read first (NATIVE-46).
      const labels = context?.phase === "ready" && context.next ? context.message : "";
      const lines = [...(labels ? [labels] : []), ...(view?.missing.summary.map(item => item.message) ?? []), ...(context?.notes ?? []),
        ...(context?.viewError ? [context.viewError] : [])];
      // The V's details waiting for WolvenKit are said here too, with the same next step (NATIVE-47).
      const detailsNeed = details?.need === "wolvenkit" ? details.updateError ?? details.message : "";
      const messageKey = JSON.stringify(lines);
      if (messages.dataset.key !== messageKey) {
        messages.dataset.key = messageKey;
        messages.replaceChildren(...lines.map(text => note(text, "warning")));
      }
      // The one status line: what is on its way, what failed (with Try again), else the first of the Details lines.
      const line = !context ? "" : context.phase === "preparing" ? context.message || "Reading your game's character-creator options…"
        : context.phase === "failed" ? context.message
          : details?.updating || context.viewing ? (details?.updating && context.firstTime ? FIRST_TIME : "Updating…")
            : details?.updateError ?? (detailsNeed || (lines.length ? lines[0]! : ""));
      setText(statusText, line);
      statusText.title = line;
      status.classList.toggle("warning", !!line && (line === details?.updateError || line === detailsNeed || context?.phase === "failed" || lines.includes(line)));
      status.classList.toggle("busy", line === "Updating…" || line === FIRST_TIME || context?.phase === "preparing");
      retry.classList.toggle("cc-unoffered", !context?.retry);
      applyCapability(retry, port.authoring.capability({ kind: "character.retry" }));
      setupWolvenKit.update(frame, (!!detailsNeed && line === detailsNeed) || (context?.phase === "ready" && context.next === "wolvenkit" && line === labels));
      keep.classList.toggle("cc-unoffered", !context?.keepable);
      setText(keep.querySelector("span")!, context?.keepable ? `Keep my ${context.keepable === 1 ? "change" : `${context.keepable} changes`}` : "Keep my changes");
      applyCapability(keep, port.authoring.capability({ kind: "character.keepChanges" }));
      keep.title = context?.keepable ? "Put the changes you made on the previous V back on this one" : "";
      detailsToggle.classList.toggle("cc-unoffered", !lines.length);
      setText(detailsToggle.querySelector("span")!, lines.length > 1 ? `Details (${lines.length})` : "Details");
      setAttr(detailsToggle, "aria-expanded", String(showMessages && !!lines.length));
      messages.hidden = !showMessages || !lines.length;
      // The quick actions.
      const makeupShown = context?.ownMakeup ?? true, makeupChange = port.authoring.capability({ kind: "character.setOwnMakeup", shown: !makeupShown });
      ownMakeup.update(makeupShown, { disabled: !makeupChange.available, reason: makeupChange.reason });
      applyCapability(resetAll, port.authoring.capability({ kind: "character.resetAll" }));
      search.disabled = !panel;
      legend.hidden = !panel;
      // The hierarchy is there before the creator options arrive (the 3D view's switches and controls), and fills in with them.
      updateRows(frame, panel, view);

      // Clothing.
      const clothing = context?.clothing;
      clothingState.setOptions(clothing?.states ?? []);
      clothingState.update(clothing?.state, undefined, clothing ? {} : { disabled: true, reason: "Your V appears once the 3D preview is ready." });
      // The switches follow the areas the save dresses (built once per area, so a change never rebuilds them).
      for (const { area, label } of clothing?.areas ?? []) if (!areaToggles.has(area)) {
        const toggle = new Toggle({ label, onChange: shown => dispatch({ kind: "character.setClothingArea", area, shown }) });
        areaToggles.set(area, toggle);
        clothingAreas.append(toggle.element);
      }
      for (const [area, toggle] of areaToggles) {
        toggle.element.hidden = !clothing?.worn.includes(area);
        toggle.update(!!clothing?.shown.includes(area), { disabled: !clothing });
      }
      clothingAreas.hidden = !clothing?.worn.length;
      const clothesSlot = details?.slots.find(slot => slot.slot === "clothing");
      setText(clothingNote, clothing?.note || (clothesSlot?.state === "unavailable" || clothesSlot?.message ? clothesSlot.message ?? "" : ""));
      clothingNote.hidden = !clothingNote.textContent;

      // Preview-only controls.
      const shapes = state.eyeShapeOptions?.choices ?? [];
      // Plain names; the head's own shape IDs show only with research tools (UI-85).
      const research = !!frame.preferences?.researchTools;
      const shapeLabel = (index: number) => {
        const choice = shapes.find(entry => entry.index === index);
        return choice ? `Eye shape ${Number(choice.number)}${research ? choice.target ? ` (${choice.target})` : " (base)" : ""}` : "";
      };
      // The shown eye shape is the preview's own state; the view keeps no default of its own (UI-93).
      eyeShape.setOptions(shapes.map(choice => ({ value: String(choice.index), label: String(Number(choice.number)), name: shapeLabel(choice.index) })));
      eyeShape.update(preview ? String(preview.eyeShape) : undefined, undefined, !preview || !shapes.length
        ? { disabled: true, reason: (frame.viewport.head.error ?? frame.viewport.head.message) ?? (preview ? "This head has no eye shapes." : "Preview is still loading.") } : {});
      const loading = (frame.viewport.head.error ?? frame.viewport.head.message) ?? "These work once the 3D preview is ready.";
      const overriding = saved.suggestedEyeShape !== undefined && preview && saved.suggestedEyeShape !== preview.eyeShape
        ? `Your V's own is ${shapeLabel(saved.suggestedEyeShape)}; this changes the 3D view only.` : "";
      // Before the preview is ready this line says why the section waits, once (UI-90).
      setText(eyeNote, !preview ? loading : overriding);
      // The game's own nudity setting, as the viewer chooses; off is the game's censored look (knowledge/body-rendering.md §3).
      const uncensoredOn = preview?.uncensored === true, uncensoredAllowed = port.authoring.capability({ kind: "preview.setUncensored", enabled: !uncensoredOn });
      uncensored.update(!!preview && uncensoredOn, { disabled: !preview || !uncensoredAllowed.available, reason: uncensoredAllowed.reason ?? loading });
      applyCapability(exportV, port.files.capability({ kind: "savedV.export" }));
      const prepared = context?.prepared;
      setText(preparedText, !prepared ? "" : prepared.clearing ? "Clearing the prepared game files…"
        : prepared.bytes === null ? "Prepared game files: checking their size…"
          : `Prepared game files: ${prepared.bytes ? size(prepared.bytes) : "none"}${prepared.freed ? ` · cleared ${size(prepared.freed)}` : ""}`);
      applyCapability(clearPrepared, port.authoring.capability({ kind: "character.clearPreparedFiles" }));
      // While the details are on their way (or failed) one line says so; the WolvenKit need is said once, by the status line.
      const detailLine = characterDetailLine(details);
      setText(detailNote, detailsNeed && detailLine.text === detailsNeed ? "" : detailLine.text);
      detailNote.hidden = !detailNote.textContent;
      const detailRows = characterDetailRows(details);
      detailsHead.hidden = !detailRows;
      detailsBody.hidden = !detailRows || !isExpanded(detailsExpander);
      detailsBlock.hidden = detailsBody.hidden;
      const detailsKey = JSON.stringify(detailRows);
      if (detailRows && detailsBody.dataset.key !== detailsKey) {
        detailsBody.dataset.key = detailsKey;
        const value = (text: string, term: string, tip?: string | readonly string[]) => h("span", { class: "control-line" }, h("span", { text }), tip ? helpTip(term, tip) : null);
        const notShown = detailRows.rows.filter(row => !row.shown && row.value !== "None").length;
        setText(detailsCount, notShown ? `${notShown} not shown` : "");
        detailsBody.replaceChildren(propertyList([
          ...detailRows.rows.map(row => ({ term: row.term, value: value(row.value, row.term, row.note) })),
          ...(detailRows.limits.length ? [{ term: "Limits", value: value(`${detailRows.limits.length} to know`, "the preview's limits", detailRows.limits) }] : []),
        ], { label: "Your V's details in the 3D view", className: "cc-detail-list" }), ...(detailRows.message ? [note(detailRows.message)] : []));
      }
    },
  };
}
