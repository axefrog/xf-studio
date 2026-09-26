/**
 * The Character panel: every creator option of the shown V, generated from the installed game and mods (the character context's
 * catalogue; character-context-actions.ts). Sections come from the game's creator categories, then rows (options sharing a creator
 * slot; the active one shows), then the row's choices, paged (character-choices.ts). Each row shows the V's current choice, an Off
 * control where the option has one, and Reset to the V's own; where each choice comes from is its accessible description and tooltip.
 * Options the 3D view can't draw say so.
 *
 * Every change is a typed `character.*` action with its own Undo history (CORE-59); the rules live in the application service, so this
 * module only dispatches (the quick action is `character.hideOwnMakeup`, CORE-71). One Undo rule covers the whole panel (UI-81): its
 * Undo and Redo, and Ctrl+Z / Ctrl+Y anywhere in it except a text box, step through the panel's changes (creator choices and
 * Clothing) in the order they were made; the header's Undo covers the makeup only and says so. Nothing here moves the layout on its own (UI-68):
 * one status line of fixed height carries what is on its way or failed, with Try again and Keep my changes inline, and a Details
 * disclosure for the plain lines about what couldn't be used; a row reserves its detail line when any of its options has one, and a
 * row whose choice the 3D view doesn't draw shows a fixed-size marker. Search runs on the host over every choice (UI-72). What the 3D
 * view shows (eye shape, visibility switches) comes before the long list of creator options (UI-96); files come last.
 *
 * An open row's choices are prepared ahead in the background (character-context-actions.ts `prefetch`), the ones in view first; each
 * choice not prepared yet carries a corner mark, one line under the search explains the marks once, and a first-time change says why
 * it takes a moment. Closing the row stops it. The prepared game files' size and "Clear prepared game files" sit with the 3D view's
 * own controls.
 */
import { shortcutLabel } from "../../input-bindings";
import type { CcPanel, CcPanelOption, CcPanelRow, CreatorView } from "../../cc-panel";
import { applyCapability, button, note, section, SelectField, Toggle } from "../controls";
import { h, isTextInput, setAttr, setText } from "../dom";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { characterDetailLine } from "./preview";
import { ChoiceList } from "./character-choices";
import type { ClothingState } from "../../clothing-dressing";
import type { ClothingArea } from "../../save-loadout";

const NOT_SHOWN = "Not shown in the 3D view yet.";
/** The status line while a choice that wasn't prepared ahead is prepared. */
const FIRST_TIME = "Updating… A first-time choice is read from your game files, so it takes a few seconds; after that it's instant.";
const LEGEND = "Not prepared yet: the first time, XF Studio reads it from your game files, which takes a few seconds.";
const LEGEND_FETCHING = "Being prepared in the background.";
const STOPPED: Record<"time" | "disk", string> = {
  time: "Preparing ahead has paused for this row. Every choice still works; the first time takes a few seconds.",
  disk: "Preparing ahead has paused: it used its disk space for this session. Every choice still works; the first time takes a few seconds.",
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
const PAGE = 240;

type RowView = { row: CcPanelRow; section: string; options: CcPanelOption[] };
/** The option a row shows: the one the view marks active, else its first while the view is on its way (cc-panel.ts `rowOption`). */
const rowOption = (panel: Readonly<CcPanel>, row: Readonly<CcPanelRow>, view: Readonly<CreatorView> | null): CcPanelOption | null => {
  const options = row.options.map(index => panel.options[index]!);
  return view ? options.find(option => view.values[option.id]?.active) ?? null : options[0] ?? null;
};

export function characterPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const dispatch = (action: Parameters<StudioRuntime["dispatch"]>[0]) => rt.dispatch(action);

  // ---- The V and its source ----
  const source = h("p", { class: "cc-source" });
  const loadSave = button({ label: "Load a save…", icon: "import", small: true, onClick: () => void rt.file({ kind: "savedV.import" }) });
  const loadPreset = button({ label: "Load preset…", icon: "import", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "characterPreset.import" }) });
  const savePreset = button({ label: "Save preset…", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "characterPreset.export" }) });
  const useDefault = button({ label: "Default V", icon: "character", small: true, variant: "quiet",
    title: "Show the character creator's default V (Undo shows your V again)",
    onClick: () => dispatch({ kind: "character.useDefault", bodyGender: "female" }) });
  // The panel's one Undo and Redo (UI-81): creator choices and Clothing, in the order they were made.
  const undo = button({ label: "Undo in the Character panel", icon: "undo", iconOnly: true, small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.undo" }) });
  const redo = button({ label: "Redo in the Character panel", icon: "redo", iconOnly: true, small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.redo" }) });
  const hide = button({ label: "Hide my V's own makeup", icon: "eye", variant: "primary", onClick: () => dispatch({ kind: "character.hideOwnMakeup" }) });
  const resetAll = button({ label: "Reset all", icon: "reset", small: true, variant: "quiet", title: "Every creator change back to your V's own (Undo brings them back)",
    onClick: () => dispatch({ kind: "character.resetAll" }) });
  const hideNote = note("Turns every makeup row Off in one step, so only the makeup you're making shows on your V. Undo brings it back.");
  // One status line of fixed height: the text is clamped to one line, and its actions keep their place when not offered (UI-68).
  const statusText = h("span", { class: "cc-status-text", role: "status", "aria-live": "polite" });
  const retry = button({ label: "Try again", icon: "refresh", small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.retry" }) });
  const keep = button({ label: "Keep my changes", icon: "check", small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.keepChanges" }) });
  const detailsToggle = h("button", { class: "btn small quiet cc-details-toggle", type: "button", "aria-expanded": "false", "aria-controls": "cc-messages" },
    h("span", { text: "Details" }));
  const status = h("div", { class: "cc-status" }, statusText, retry, keep, detailsToggle);
  const messages = h("div", { class: "cc-messages", id: "cc-messages", hidden: true });
  let showMessages = false;
  detailsToggle.addEventListener("click", () => { showMessages = !showMessages; rt.changed(); });
  const search = h("input", { class: "field cc-search", type: "search", placeholder: "Find an option or choice", "aria-label": "Find a creator option or choice",
    autocomplete: "off", spellcheck: "false" });
  // One line explains the marks on choices not prepared yet (fixed height: it never moves the rows).
  const legendText = h("span", { class: "cc-legend-text" },
    h("span", { class: "cc-fetch-mark", "data-fetch": "pending", "aria-hidden": "true" }), ` ${LEGEND} `,
    h("span", { class: "cc-fetch-mark", "data-fetch": "fetching", "aria-hidden": "true" }), ` ${LEGEND_FETCHING}`);
  const legendStopped = h("span", { class: "cc-legend-text", hidden: true });
  const legend = h("p", { class: "note cc-legend" }, legendText, legendStopped);
  const sections = h("div", { class: "cc-sections" });
  const noMatch = note("No option or choice matches.");
  noMatch.hidden = true;

  // ---- Clothing: which of V's clothes the 3D view shows (a viewing setting; the panel's Undo steps it too) ----
  const clothingState = new SelectField<ClothingState>({ label: "Clothes in the 3D view", onChange: state => dispatch({ kind: "character.setClothing", state }) });
  // One switch per clothing area the save dresses; switching one picks the areas yourself (the setting becomes "Choose areas").
  const areaToggles = new Map<ClothingArea, Toggle>();
  const clothingAreas = h("div", { class: "cc-clothing-areas" });
  const clothingNote = note("");

  // ---- Preview-only controls (not creator choices) ----
  const eyeShape = new SelectField<string>({ label: "Eye shape in the 3D view", onChange: value => dispatch({ kind: "preview.setEyeShape", index: Number(value) }) });
  const eyeNote = note("");
  const brows = new Toggle({ label: "Eyebrows", onChange: enabled => dispatch({ kind: "preview.setDetail", detail: "brows", enabled }) });
  const lashes = new Toggle({ label: "Eyelashes", onChange: enabled => dispatch({ kind: "preview.setDetail", detail: "lashes", enabled }) });
  const hair = new Toggle({ label: "Hair", onChange: enabled => dispatch({ kind: "preview.setHair", enabled }) });
  const piercings = new Toggle({ label: "Piercings", onChange: enabled => dispatch({ kind: "preview.setPiercings", enabled }) });
  const body = new Toggle({ label: "Body", onChange: enabled => dispatch({ kind: "preview.setBody", enabled }) });
  const exportV = button({ label: "Export appearance data", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "savedV.export" }) });
  const detailNote = note("");
  // The game files prepared for the 3D view on this computer, and clearing them.
  const preparedText = h("span", { class: "cc-prepared-text" });
  const clearPrepared = button({ label: "Clear prepared game files", icon: "trash", small: true, variant: "quiet",
    title: "Removes the files XF Studio prepared from your game for the 3D view. They are read from your game again when needed; your makeup, presets and settings stay.",
    onClick: () => dispatch({ kind: "character.clearPreparedFiles" }) });

  const element = h("div", { class: "panel-content cc-panel" },
    section("Your V", source, h("div", { class: "row wrap gap-s" }, loadSave, loadPreset, savePreset, useDefault,
      h("span", { class: "cc-history" }, undo, redo)), status, messages),
    h("section", { class: "section cc-quick" }, h("div", { class: "row wrap gap-s" }, hide, resetAll), hideNote),
    section("Clothing", h("div", { class: "row gap-s cc-clothing" }, clothingState.element), clothingAreas, clothingNote),
    // What the 3D view shows sits above the long list of creator options, so its switches are found without scrolling (UI-96).
    section("In the 3D view", eyeShape.element, eyeNote, brows.element, lashes.element, hair.element, piercings.element, body.element, detailNote,
      note("These change what the 3D view shows, never your V or your makeup.")),
    h("section", { class: "section" }, h("h3", { class: "section-title", text: "Creator options" }), search, legend, sections, noMatch),
    section("Files", h("div", { class: "row wrap gap-s" }, exportV),
      h("div", { class: "row wrap gap-s cc-prepared" }, preparedText, clearPrepared),
      note("A save is read on this computer and never changed or uploaded.")));

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
    notShown: HTMLElement; off: HTMLButtonElement; reset: HTMLButtonElement; detail: HTMLElement | null; list: ChoiceList; more: HTMLButtonElement;
    open: boolean; query: string;
    /** The option whose choices are being prepared ahead, and their positions in the order to prepare them (in view first). */
    prefetching: string | null; positions: number[]; loaded: number };
  let built: { identity: string; rows: RowControls[] } | null = null;
  const openRows = new Set<string>();
  /** The one open row whose choices are prepared ahead: the one opened or pointed at last. */
  let aheadRow: string | null = null;
  const rowKey = (view: RowView) => `${view.row.part}/${view.row.slot}`;
  const staticDetail = (panel: Readonly<CcPanel>, option: CcPanelOption) => [option.coverage[0] === "not-rendered" ? panel.notes[option.coverage[1]] || NOT_SHOWN : "",
    option.dependsOn.length ? `Choose ${option.dependsOn.join(" or ")} first: this follows it.` : ""].filter(Boolean).join(" ");

  function buildRows(panel: Readonly<CcPanel>) {
    const rows: RowControls[] = [];
    let serial = 0;
    sections.replaceChildren(...panel.sections.map(entry => {
      const body = h("div", { class: "cc-rows" });
      for (const row of entry.rows) {
        const view: RowView = { row, section: entry.label, options: row.options.map(index => panel.options[index]!) };
        const id = `cc-choices-${++serial}`;
        const label = h("span", { class: "cc-row-label" }), swatch = h("span", { class: "swatch cc-row-swatch", hidden: true });
        const value = h("span", { class: "cc-row-value" });
        const notShown = h("span", { class: "cc-row-not-shown", title: NOT_SHOWN, "aria-hidden": "true" }, icon("eyeOff"));
        const main = h("button", { class: "cc-row-main", type: "button", "aria-expanded": "false", "aria-controls": id },
          icon("chevronRight"), label, h("span", { class: "cc-row-current" }, swatch, value), notShown);
        const controls: RowControls = { view, element: h("div", { class: "cc-row" }), main, label, value, swatch, notShown,
          off: h("button", { class: "chip-button cc-off", type: "button", text: "Off" }),
          reset: button({ label: "Back to your V's own", icon: "reset", iconOnly: true, small: true, variant: "quiet", onClick: () => {} }),
          // A detail line is reserved only where one of the row's options has one, so it never appears or vanishes (UI-68).
          detail: view.options.some(option => staticDetail(panel, option)) ? h("p", { class: "cc-row-detail" }) : null,
          list: new ChoiceList(id, choice => {
            const option = current(controls);
            if (option) dispatch({ kind: "character.setOption", part: option.part, option: option.name, choice: choice.key, ...(choice.activates ? { activates: [...choice.activates] } : {}) });
          }, choice => {
            // A hovered or focused choice is prepared next (its row becomes the one prepared ahead).
            if (aheadRow !== rowKey(controls.view)) { aheadRow = rowKey(controls.view); rt.changed(); return; }
            if (controls.prefetching && controls.positions.length) port.authoring.characterPrefetch(controls.prefetching, controls.positions, choice.position);
          }),
          more: h("button", { class: "btn small quiet cc-more", type: "button", hidden: true }), open: openRows.has(rowKey(view)), query: "",
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
        controls.more.addEventListener("click", () => {
          const option = current(controls);
          if (option) port.authoring.characterChoices(option.id, (port.authoring.characterChoices(option.id, undefined, controls.query)?.choices.length ?? 0) + PAGE, controls.query);
        });
        controls.list.element.hidden = true;
        controls.element.append(h("div", { class: "cc-row-head" }, main, h("span", { class: "cc-row-actions" }, controls.off, controls.reset)),
          ...(controls.detail ? [controls.detail] : []), controls.list.element, controls.more);
        body.append(controls.element);
        rows.push(controls);
      }
      return h("section", { class: "cc-section", "data-section": entry.id }, h("h4", { class: "cc-section-title", text: entry.label }), body);
    }));
    built = { identity: panel.identity, rows };
  }
  const current = (controls: RowControls): CcPanelOption | null => {
    const panel = port.authoring.characterPanel();
    return panel ? rowOption(panel, controls.view.row, port.authoring.characterView()) : null;
  };
  function toggle(controls: RowControls) {
    controls.open = !controls.open;
    const key = rowKey(controls.view);
    if (controls.open) { openRows.add(key); aheadRow = key; }
    else { openRows.delete(key); stopPrefetch(controls); if (aheadRow === key) aheadRow = [...openRows].at(-1) ?? null; }
    rt.changed();
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

  function updateRows(frame: Frame, panel: Readonly<CcPanel>, view: Readonly<CreatorView> | null) {
    if (built?.identity !== panel.identity) buildRows(panel);
    const query = search.value.trim().toLowerCase();
    // The host searches every choice, not only those loaded (UI-72); rows matching by name show while it answers.
    const found = query ? port.authoring.characterSearch(query) : null;
    let stopped: "time" | "disk" | null = null;
    const details = frame.status.assets.characterDetails, drawn = new Set(details?.drawn ?? []);
    let visibleRows = 0;
    for (const controls of built!.rows) {
      const option = rowOption(panel, controls.view.row, view);
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
      controls.swatch.hidden = !value?.color;
      if (value?.color) controls.swatch.style.setProperty("--swatch", value.color);
      controls.element.classList.toggle("changed", !!value?.set);
      setAttr(controls.main, "aria-expanded", String(controls.open));
      // Honest coverage: what the 3D view can't draw says so; a conditional option settles from what the shown V draws.
      const isOff = !!value && value.choice === option.off;
      const conditionalHidden = option.coverage[0] === "conditional" && option.type === "appearance" && !!value && !isOff && details?.phase === "ready" && !drawn.has(option.name);
      const from = option.mod >= 0 ? `From ${panel.mods[option.mod]}` : "From the game";
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
      if (controls.detail) setText(controls.detail, staticDetail(panel, option));
      controls.element.classList.toggle("not-shown", option.coverage[0] === "not-rendered" || conditionalHidden);
      controls.list.element.hidden = !controls.open;
      if (!controls.open) { controls.more.hidden = true; continue; }
      // An open row lists every choice, or with a search that only its choices match, the matching ones.
      controls.query = rowMatches ? "" : query;
      const loaded = port.authoring.characterChoices(option.id, undefined, controls.query);
      // Its choices are prepared ahead while it shows them all, when the 3D view draws the option.
      const ahead = !controls.query && option.coverage[0] !== "not-rendered" && aheadRow === rowKey(controls.view);
      if (!ahead) stopPrefetch(controls);
      const fetch = ahead ? prefetchRow(controls, option) : null;
      if (fetch?.stopped) stopped = fetch.stopped;
      controls.list.update({ option: option.id, query: controls.query, label: option.label, grid: option.grid, choices: loaded?.choices ?? [],
        selected: value?.position ?? null, mods: panel.mods, loading: loaded?.loading ?? true, error: loaded?.error ?? null, fetch: fetch?.states ?? null });
      if (ahead && (loaded?.choices.length ?? 0) !== controls.loaded) {
        controls.loaded = loaded?.choices.length ?? 0;
        controls.positions = controls.list.visiblePositions(scrollView(controls.list.list));
        prefetchRow(controls, option);
      }
      const remaining = (loaded?.total ?? 0) - (loaded?.choices.length ?? 0);
      controls.more.hidden = remaining <= 0;
      setText(controls.more, `Show ${Math.min(PAGE, remaining)} more of ${remaining}`);
    }
    for (const node of sections.querySelectorAll<HTMLElement>(".cc-section"))
      node.hidden = ![...node.querySelectorAll<HTMLElement>(".cc-row")].some(row => !row.hidden);
    noMatch.hidden = !query || visibleRows > 0 || !!found?.loading;
    legendText.hidden = !!stopped; legendStopped.hidden = !stopped;
    if (stopped) { setText(legendStopped, STOPPED[stopped]); legendStopped.title = STOPPED[stopped]; }
    return visibleRows;
  }
  search.addEventListener("input", () => rt.changed());

  return {
    spec: { id: "character", ...PANEL_META["character"], element },
    update(frame) {
      const state = frame.preview, context = state.character, preview = state.preview, saved = state.savedV, assets = frame.status.assets;
      const details = assets.characterDetails;
      const panel = port.authoring.characterPanel(), view = port.authoring.characterView();
      // The V and its source.
      const origin = context?.origin;
      setText(source, !context ? "Your V appears once the 3D preview is ready." : origin?.kind === "save" ? "Your V from your save" + (saved.gameVersion ? ` (game ${(saved.gameVersion / 1000).toFixed(2)})` : "") + "."
        : origin?.kind === "preset" ? `The V from the preset “${origin.name ?? "Untitled"}”.` : "The character creator's default V.");
      applyCapability(loadSave, port.files.capability({ kind: "savedV.import" }));
      applyCapability(loadPreset, port.files.capability({ kind: "characterPreset.import" }));
      applyCapability(savePreset, port.files.capability({ kind: "characterPreset.export" }));
      applyCapability(useDefault, port.authoring.capability({ kind: "character.useDefault", bodyGender: "female" }));
      const keys = { undo: shortcutLabel("shell.undo"), redo: shortcutLabel("shell.redo") };
      applyCapability(undo, port.authoring.capability({ kind: "character.undo" }));
      applyCapability(redo, port.authoring.capability({ kind: "character.redo" }));
      undo.title = context?.undo ? `Undo: ${context.undo} (${keys.undo} in this panel). Covers creator options and Clothing; the header's Undo covers your makeup.`
        : "No change in this panel to undo.";
      redo.title = context?.redo ? `Redo: ${context.redo} (${keys.redo} in this panel)` : "No undone change in this panel to redo.";
      setAttr(undo, "aria-label", context?.undo ? `Undo in the Character panel: ${context.undo}` : "Undo in the Character panel");
      setAttr(redo, "aria-label", context?.redo ? `Redo in the Character panel: ${context.redo}` : "Redo in the Character panel");
      // What couldn't be used, in plain lines, behind Details.
      const lines = [...(view?.missing.summary.map(item => item.message) ?? []), ...(context?.notes ?? []), ...(context?.viewError ? [context.viewError] : [])];
      const messageKey = JSON.stringify(lines);
      if (messages.dataset.key !== messageKey) {
        messages.dataset.key = messageKey;
        messages.replaceChildren(...lines.map(text => note(text, "warning")));
      }
      // The one status line: what is on its way, what failed (with Try again), else the first of the Details lines.
      const line = !context ? "" : context.phase === "preparing" ? context.message || "Reading your game's character-creator options…"
        : context.phase === "failed" ? context.message
          : details?.updating || context.viewing ? (details?.updating && context.firstTime ? FIRST_TIME : "Updating…")
            : details?.updateError ?? (lines.length ? lines[0]! : "");
      setText(statusText, line);
      statusText.title = line;
      status.classList.toggle("warning", !!line && (line === details?.updateError || context?.phase === "failed" || lines.includes(line)));
      status.classList.toggle("busy", line === "Updating…" || line === FIRST_TIME || context?.phase === "preparing");
      retry.classList.toggle("cc-unoffered", !context?.retry);
      applyCapability(retry, port.authoring.capability({ kind: "character.retry" }));
      keep.classList.toggle("cc-unoffered", !context?.keepable);
      setText(keep.querySelector("span")!, context?.keepable ? `Keep my ${context.keepable === 1 ? "change" : `${context.keepable} changes`}` : "Keep my changes");
      applyCapability(keep, port.authoring.capability({ kind: "character.keepChanges" }));
      keep.title = context?.keepable ? "Put the changes you made on the previous V back on this one" : "";
      detailsToggle.classList.toggle("cc-unoffered", !lines.length);
      setText(detailsToggle.querySelector("span")!, lines.length > 1 ? `Details (${lines.length})` : "Details");
      setAttr(detailsToggle, "aria-expanded", String(showMessages && !!lines.length));
      messages.hidden = !showMessages || !lines.length;
      // The quick actions.
      applyCapability(hide, port.authoring.capability({ kind: "character.hideOwnMakeup" }));
      applyCapability(resetAll, port.authoring.capability({ kind: "character.resetAll" }));
      search.disabled = !panel;
      legend.hidden = !panel;
      if (panel) updateRows(frame, panel, view);
      else if (built) { for (const controls of built.rows) stopPrefetch(controls); sections.replaceChildren(); built = null; }

      // Clothing.
      const clothing = context?.clothing;
      clothingState.update(clothing?.states ?? [], clothing?.state, !clothing, "Your V appears once the 3D preview is ready.");
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
      setText(clothingNote, clothing?.note || (clothesSlot?.state === "unavailable" || clothesSlot?.message ? clothesSlot.message ?? ""
        : "Your V's clothes as your save records them. They are drawn without the game's garment fitting, so layers can clip at the edges."));

      // Preview-only controls.
      const shapes = state.eyeShapeOptions?.choices ?? [];
      // Plain names; the head's own shape IDs show only with research tools (UI-85).
      const research = !!frame.preferences?.researchTools;
      const shapeLabel = (index: number) => {
        const choice = shapes.find(entry => entry.index === index);
        return choice ? `Eye shape ${Number(choice.number)}${research ? choice.target ? ` (${choice.target})` : " (base)" : ""}` : "";
      };
      // The shown eye shape is the preview's own state; the view keeps no default of its own (UI-93).
      eyeShape.update(shapes.map(choice => ({ value: String(choice.index), label: shapeLabel(choice.index) })), preview ? String(preview.eyeShape) : undefined,
        !preview || !shapes.length, (frame.viewport.head.error ?? frame.viewport.head.message) ?? (preview ? "This head has no eye shapes." : "Preview is still loading."));
      const loading = (frame.viewport.head.error ?? frame.viewport.head.message) ?? "These work once the 3D preview is ready.";
      const overriding = saved.suggestedEyeShape !== undefined && preview && saved.suggestedEyeShape !== preview.eyeShape
        ? `Overriding the saved eye shape (${shapeLabel(saved.suggestedEyeShape)}) in this viewport only.` : "";
      // Before the preview is ready this line says why the section waits, once (UI-90).
      setText(eyeNote, !preview ? loading : overriding || "The 3D view's eye shape, which eye makeup is placed on. It overrides your V's Eyes row in the 3D view.");
      for (const [control, detail] of [[brows, "brows"], [lashes, "lashes"]] as const) {
        const enabled = !!preview?.[detail], allowed = port.authoring.capability({ kind: "preview.setDetail", detail, enabled: true });
        control.update(enabled, { disabled: !preview || (!enabled && !allowed.available), reason: allowed.reason ?? loading });
      }
      const hairAllowed = port.authoring.capability({ kind: "preview.setHair", enabled: true });
      hair.update(!!preview?.hair, { disabled: !preview || (!preview.hair && !hairAllowed.available), reason: hairAllowed.reason ?? loading, note: "Hair physics is not simulated." });
      const piercingAllowed = port.authoring.capability({ kind: "preview.setPiercings", enabled: true });
      piercings.update(!!preview?.piercings, { disabled: !preview || (!preview.piercings && !piercingAllowed.available), reason: piercingAllowed.reason ?? loading });
      // Absent means shown (workspace-state.ts); a head-only preview can't show a body.
      const bodyShown = preview?.body ?? true, bodyAllowed = port.authoring.capability({ kind: "preview.setBody", enabled: !bodyShown });
      body.update(!!preview && bodyShown && bodyAllowed.available, { disabled: !preview || !bodyAllowed.available, reason: bodyAllowed.reason ?? loading,
        note: "The body and the clothes on it. Where no clothes are shown, the game's own underwear covers it." });
      applyCapability(exportV, port.files.capability({ kind: "savedV.export" }));
      const prepared = context?.prepared;
      setText(preparedText, !prepared ? "" : prepared.clearing ? "Clearing the prepared game files…"
        : prepared.bytes === null ? "Prepared game files: checking their size…"
          : `Prepared game files on this computer: ${prepared.bytes ? size(prepared.bytes) : "none"}.${prepared.freed ? ` Cleared ${size(prepared.freed)}.` : ""}`);
      applyCapability(clearPrepared, port.authoring.capability({ kind: "character.clearPreparedFiles" }));
      const detailLine = characterDetailLine(details);
      setText(detailNote, detailLine.text);
      detailNote.hidden = !detailNote.textContent;
    },
  };
}
