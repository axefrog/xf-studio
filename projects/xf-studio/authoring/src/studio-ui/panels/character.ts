/**
 * The Character panel: every creator option of the shown V, generated from the installed game and mods (the character context's
 * catalogue; character-context-actions.ts). Sections come from the game's creator categories, then rows (options sharing a creator
 * slot; the active one shows), then the row's choices, paged. Each row shows the V's current choice, an Off control where the option
 * has one, and Reset to the V's own; where each choice comes from shows on hover. Options the 3D view can't draw say so.
 *
 * Every change is a typed `character.*` action with its own Undo history (CORE-59); the V stays on screen while a change prepares,
 * with a small inline "Updating…" line. The preview-only controls (eye shape, visibility toggles) follow below.
 */
import { shortcutLabel } from "../../input-bindings";
import type { CcPanel, CcPanelChoice, CcPanelOption, CcPanelRow, CreatorView } from "../../cc-panel";
import { applyCapability, button, note, section, SelectField, Toggle } from "../controls";
import { h, setText } from "../dom";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { characterDetailLine } from "./preview";

/**
 * The game's creator category (`gamedataCharacterRandomizationCategory`) whose rows are makeup: the one the quick action turns Off.
 * A category of the game's own data, not an option: every row in it, vanilla or modded, is covered.
 */
export const MAKEUP_CATEGORY = "Makeup";
const NOT_SHOWN = "Not shown in the 3D view yet.";
const PAGE = 240;

type RowView = { row: CcPanelRow; section: string; options: CcPanelOption[] };
/** The option a row shows: its active one (from the view), else its first while the view is on its way; null when none is part of the V. */
export function rowOption(panel: Readonly<CcPanel>, row: Readonly<CcPanelRow>, view: Readonly<CreatorView> | null): CcPanelOption | null {
  const options = row.options.map(index => panel.options[index]!);
  if (!view) return options[0] ?? null;
  return options.find(option => view.values[option.id]?.active) ?? null;
}
/** Every makeup row's change to Off, for the active options that have an Off choice and aren't Off already. */
export function makeupOff(panel: Readonly<CcPanel>, view: Readonly<CreatorView> | null): { part: CcPanelOption["part"]; option: string; choice: string }[] {
  if (!view) return [];
  return panel.sections.filter(entry => entry.id === MAKEUP_CATEGORY).flatMap(entry => entry.rows).flatMap(row => {
    const option = rowOption(panel, row, view), value = option && view.values[option.id];
    return option && value && option.off !== null && value.choice !== option.off ? [{ part: option.part, option: option.name, choice: option.off }] : [];
  });
}

export function characterPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const dispatch = (action: Parameters<StudioRuntime["dispatch"]>[0]) => rt.dispatch(action);

  // ---- The V and its source ----
  const source = h("p", { class: "cc-source" });
  const loadSave = button({ label: "Load a save…", icon: "import", small: true, onClick: () => void rt.file({ kind: "savedV.import" }) });
  const loadPreset = button({ label: "Load preset…", icon: "import", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "characterPreset.import" }) });
  const savePreset = button({ label: "Save preset…", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "characterPreset.export" }) });
  const useDefault = button({ label: "Default V", icon: "character", small: true, variant: "quiet",
    title: "Show the character creator's default V (your save stays loaded; Undo brings it back)",
    onClick: () => dispatch({ kind: "character.useDefault", bodyGender: "female" }) });
  const undo = button({ label: "Undo character change", icon: "undo", iconOnly: true, small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.undo" }) });
  const redo = button({ label: "Redo character change", icon: "redo", iconOnly: true, small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.redo" }) });
  const hide = button({ label: "Hide my V's own makeup", icon: "eye", variant: "primary", onClick: () => {
    const panel = port.authoring.characterPanel(), changes = panel ? makeupOff(panel, port.authoring.characterView()) : [];
    if (changes.length) dispatch({ kind: "character.setOptions", changes, label: "Hide my V's own makeup" });
  } });
  const hideNote = note("Turns every makeup row Off in one step, so only the makeup you're making shows on your V. Undo brings it back.");
  const keep = button({ label: "Keep my changes", icon: "check", small: true, variant: "quiet", onClick: () => dispatch({ kind: "character.keepChanges" }) });
  /** One line that never moves the layout: what is on its way, or why something isn't shown. */
  const status = h("p", { class: "cc-status", role: "status", "aria-live": "polite" });
  const messages = h("div", { class: "cc-messages" });
  const search = h("input", { class: "field cc-search", type: "search", placeholder: "Find an option or choice", "aria-label": "Find a creator option or choice",
    autocomplete: "off", spellcheck: "false" });
  const sections = h("div", { class: "cc-sections" });

  // ---- Preview-only controls (not creator choices) ----
  const eyeShape = new SelectField<string>({ label: "Eye shape in the 3D view", onChange: value => dispatch({ kind: "preview.setEyeShape", index: Number(value) }) });
  const eyeNote = note("");
  const brows = new Toggle({ label: "Eyebrows", onChange: enabled => dispatch({ kind: "preview.setDetail", detail: "brows", enabled }) });
  const lashes = new Toggle({ label: "Eyelashes", onChange: enabled => dispatch({ kind: "preview.setDetail", detail: "lashes", enabled }) });
  const hair = new Toggle({ label: "Hair", onChange: enabled => dispatch({ kind: "preview.setHair", enabled }) });
  const piercings = new Toggle({ label: "Piercings", onChange: enabled => dispatch({ kind: "preview.setPiercings", enabled }) });
  const exportV = button({ label: "Export appearance data", icon: "export", small: true, variant: "quiet", onClick: () => void rt.file({ kind: "savedV.export" }) });
  const detailNote = note("");

  const element = h("div", { class: "panel-content cc-panel" },
    section("Your V", source, h("div", { class: "row wrap gap-s" }, loadSave, loadPreset, savePreset, useDefault,
      h("span", { class: "cc-history" }, undo, redo)), status, keep, messages),
    h("section", { class: "section cc-quick" }, hide, hideNote),
    h("section", { class: "section" }, h("h3", { class: "section-title", text: "Creator options" }), search, sections),
    section("3D view only", eyeShape.element, eyeNote, brows.element, lashes.element, hair.element, piercings.element, detailNote,
      h("div", { class: "row wrap gap-s" }, exportV),
      note("These change what the 3D view shows, never your V or your makeup. A save is read locally and never changed or uploaded.")));

  // Creator changes have their own Undo: inside this panel the Undo keys step through them, not the makeup's history.
  element.addEventListener("keydown", event => {
    if (event.target instanceof HTMLInputElement && event.target.type !== "radio") return;
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey || (key !== "z" && key !== "y")) return;
    event.preventDefault();
    dispatch({ kind: key === "y" || event.shiftKey ? "character.redo" : "character.undo" });
  });

  // ---- Rows ----
  type RowControls = { view: RowView; element: HTMLElement; main: HTMLButtonElement; label: HTMLElement; value: HTMLElement; swatch: HTMLElement;
    off: HTMLButtonElement; reset: HTMLButtonElement; detail: HTMLElement; choices: HTMLElement; more: HTMLButtonElement; open: boolean; option: string | null };
  let built: { identity: string; rows: RowControls[] } | null = null;
  let openRows = new Set<string>();
  const rowKey = (view: RowView) => `${view.row.part}/${view.row.slot}`;

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
        const main = h("button", { class: "cc-row-main", type: "button", "aria-expanded": "false", "aria-controls": id },
          icon("chevronRight"), label, h("span", { class: "cc-row-current" }, swatch, value));
        const controls: RowControls = { view, element: h("div", { class: "cc-row" }), main, label, value, swatch,
          off: h("button", { class: "chip-button cc-off", type: "button", text: "Off" }),
          reset: button({ label: "Back to your V's own", icon: "reset", iconOnly: true, small: true, variant: "quiet", onClick: () => {} }),
          detail: h("p", { class: "cc-row-detail" }), choices: h("div", { class: "cc-choices", id, role: "radiogroup", hidden: true }),
          more: h("button", { class: "btn small quiet cc-more", type: "button", hidden: true }), open: openRows.has(rowKey(view)), option: null };
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
          if (option) port.authoring.characterChoices(option.id, (port.authoring.characterChoices(option.id)?.choices.length ?? 0) + PAGE);
        });
        controls.choices.addEventListener("keydown", event => roveChoices(controls.choices, event));
        controls.element.append(h("div", { class: "cc-row-head" }, main, h("span", { class: "cc-row-actions" }, controls.off, controls.reset)),
          controls.detail, controls.choices, controls.more);
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
    if (controls.open) openRows.add(key); else openRows.delete(key);
    controls.choices.dataset.key = "";
    rt.changed();
  }

  /** Arrow keys move between choices; Home and End jump; Enter or Space chooses (the buttons' own behaviour). */
  function roveChoices(group: HTMLElement, event: KeyboardEvent) {
    const items = [...group.querySelectorAll<HTMLButtonElement>("button.cc-choice:not([hidden])")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const columns = group.classList.contains("grid") ? Math.max(1, Math.round(group.clientWidth / Math.max(1, items[0]!.offsetWidth + 4))) : 1;
    const next = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "ArrowDown" ? at + columns
      : event.key === "ArrowUp" ? at - columns : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = items[Math.max(0, Math.min(items.length - 1, next))]!;
    for (const item of items) item.tabIndex = item === target ? 0 : -1;
    target.focus();
  }

  function drawChoices(controls: RowControls, option: CcPanelOption, panel: Readonly<CcPanel>, chosen: string | undefined, query: string, rowMatches: boolean) {
    const loaded = port.authoring.characterChoices(option.id);
    const shown = (loaded?.choices ?? []).filter(choice => !query || rowMatches || choice.label.toLowerCase().includes(query) || choice.key.toLowerCase().includes(query));
    const key = JSON.stringify([option.id, chosen, query, rowMatches, loaded?.choices.length, loaded?.loading, loaded?.error]);
    if (controls.choices.dataset.key === key) return;
    controls.choices.dataset.key = key;
    controls.choices.classList.toggle("grid", option.grid);
    controls.choices.setAttribute("aria-label", `${option.label} choices`);
    // Off first, as the creator lists it.
    const ordered = [...shown.filter(choice => choice.off), ...shown.filter(choice => !choice.off)];
    const provenance = (choice: CcPanelChoice) => choice.mod >= 0 ? `From ${panel.mods[choice.mod]}` : "From the game";
    const items = ordered.map(choice => {
      const selected = choice.key === chosen;
      const item = h("button", { class: `cc-choice${option.grid ? " swatch-choice" : ""}${choice.off ? " off" : ""}`, type: "button", role: "radio",
        "aria-checked": String(selected), tabindex: selected ? "0" : "-1", title: `${choice.label} · ${provenance(choice)}`,
        "aria-label": `${choice.label}${choice.mod >= 0 ? `, from ${panel.mods[choice.mod]}` : ""}` },
        option.grid ? h("span", { class: "swatch", style: choice.color ? `--swatch:${choice.color}` : undefined, "data-empty": choice.color ? undefined : "true" }) : null,
        option.grid && !choice.off && choice.color ? null : h("span", { class: "cc-choice-label", text: choice.off ? "Off" : choice.label }));
      item.addEventListener("click", () => dispatch({ kind: "character.setOption", part: option.part, option: option.name, choice: choice.key }));
      return item;
    });
    if (!items.some(item => item.tabIndex === 0) && items[0]) items[0].tabIndex = 0;
    controls.choices.replaceChildren(...items, ...(loaded?.loading && !items.length ? [h("p", { class: "note", text: "Loading choices…" })] : []),
      ...(loaded?.error ? [note(loaded.error, "warning")] : []), ...(!loaded?.loading && !items.length && !loaded?.error ? [note("No choice matches.")] : []));
    const remaining = (loaded?.total ?? 0) - (loaded?.choices.length ?? 0);
    controls.more.hidden = remaining <= 0 || !!query;
    setText(controls.more, `Show ${Math.min(PAGE, remaining)} more of ${remaining}`);
  }

  function updateRows(frame: Frame, panel: Readonly<CcPanel>, view: Readonly<CreatorView> | null) {
    if (built?.identity !== panel.identity) buildRows(panel);
    const query = search.value.trim().toLowerCase();
    const details = frame.status.assets.characterDetails, drawn = new Set(details?.drawn ?? []);
    let visibleRows = 0;
    for (const controls of built!.rows) {
      const option = rowOption(panel, controls.view.row, view);
      const value = option ? view?.values[option.id] : undefined;
      const rowText = `${controls.view.section} ${controls.view.options.map(entry => entry.label).join(" ")}`.toLowerCase();
      const rowMatches = !query || rowText.includes(query);
      const choiceMatches = !!query && !rowMatches && !!option && (port.authoring.characterChoices(option.id)?.choices ?? [])
        .some(choice => choice.label.toLowerCase().includes(query));
      // A row whose active option offers one choice (an Off placeholder of its slot) has nothing to choose, as in the creator.
      const visible = !!option && option.count > 1 && (rowMatches || choiceMatches);
      controls.element.hidden = !visible;
      if (!option) continue;
      if (visible) visibleRows++;
      setText(controls.label, option.label);
      const chosenLabel = value?.label ?? (view ? "" : "…");
      setText(controls.value, value ? (value.choice === option.off ? "Off" : chosenLabel) : chosenLabel);
      controls.swatch.hidden = !value?.color;
      if (value?.color) controls.swatch.style.setProperty("--swatch", value.color);
      controls.element.classList.toggle("changed", !!value?.set);
      controls.main.setAttribute("aria-expanded", String(controls.open));
      const from = option.mod >= 0 ? `From ${panel.mods[option.mod]}` : "From the game";
      controls.main.title = `${option.label}: ${value?.label ?? ""}${value && value.choice !== value.own ? ` (your V's own: ${value.ownLabel})` : ""} · ${from}`;
      // Off where the option has one; Reset once it differs from the V's own. Both keep their place when unavailable (no layout shift).
      controls.off.hidden = option.off === null;
      const isOff = !!value && value.choice === option.off;
      controls.off.setAttribute("aria-pressed", String(isOff));
      applyCapability(controls.off, isOff ? { available: false, reason: `${option.label} is already Off.` }
        : port.authoring.capability({ kind: "character.setOption", part: option.part, option: option.name, choice: option.off ?? "" }));
      controls.reset.title = value?.set ? `Back to your V's own: ${value.ownLabel}` : "This is your V's own choice.";
      controls.reset.setAttribute("aria-label", controls.reset.title);
      applyCapability(controls.reset, port.authoring.capability({ kind: "character.reset", part: option.part, option: option.name }));
      // Honest coverage: what the 3D view can't draw says so; a conditional option settles from what the shown V draws.
      const [status, noteIndex] = option.coverage;
      const coverage = status === "not-rendered" ? panel.notes[noteIndex] || NOT_SHOWN
        : status === "conditional" && option.type === "appearance" && value && !isOff && details?.phase === "ready" && !drawn.has(option.name)
          ? NOT_SHOWN : "";
      const depends = option.dependsOn.length ? `Turned on by ${option.dependsOn.join(" or ")}.` : "";
      setText(controls.detail, [coverage, depends].filter(Boolean).join(" "));
      controls.detail.hidden = !controls.detail.textContent;
      controls.element.classList.toggle("not-shown", !!coverage);
      controls.choices.hidden = !controls.open;
      if (controls.open) drawChoices(controls, option, panel, value?.choice, query, rowMatches);
      else controls.more.hidden = true;
    }
    for (const node of sections.querySelectorAll<HTMLElement>(".cc-section"))
      node.hidden = ![...node.querySelectorAll<HTMLElement>(".cc-row")].some(row => !row.hidden);
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
      undo.title = context?.undo ? `Undo: ${context.undo} (${keys.undo} in this panel)` : "No character change to undo.";
      redo.title = context?.redo ? `Redo: ${context.redo} (${keys.redo} in this panel)` : "No undone character change to redo.";
      keep.hidden = !context?.keepable;
      setText(keep.querySelector("span")!, context?.keepable ? `Keep my ${context.keepable === 1 ? "change" : `${context.keepable} changes`} on this V` : "Keep my changes");
      // One status line, always present so nothing below it moves.
      const line = !context ? "" : context.phase === "preparing" ? context.message || "Reading your game's character-creator options…"
        : context.phase === "failed" ? context.message
          : details?.updating || context.viewing ? "Updating…"
            : details?.updateError ?? "";
      setText(status, line);
      status.classList.toggle("warning", !!details?.updateError && line === details.updateError || context?.phase === "failed");
      status.classList.toggle("busy", line === "Updating…");
      // What couldn't be honoured, in plain lines.
      const lines = [...(view?.missing.summary.map(item => item.message) ?? []), ...(context?.viewError ? [context.viewError] : [])];
      const messageKey = JSON.stringify(lines);
      if (messages.dataset.key !== messageKey) {
        messages.dataset.key = messageKey;
        messages.replaceChildren(...lines.map(text => note(text, "warning")));
      }
      // The quick action: available while some makeup row isn't Off.
      const offChanges = panel ? makeupOff(panel, view) : [];
      applyCapability(hide, !panel ? { available: false, reason: context?.phase === "failed" ? context.message : "The creator options are still loading." }
        : !view ? { available: false, reason: "Your V's current choices are still loading." }
          : offChanges.length ? port.authoring.capability({ kind: "character.setOptions", changes: offChanges, label: "Hide my V's own makeup" })
            : { available: false, reason: "Every makeup row on your V is already Off." });
      search.disabled = !panel;
      if (panel) updateRows(frame, panel, view);
      else if (built) { sections.replaceChildren(); built = null; }

      // Preview-only controls.
      const shapes = state.eyeShapeOptions?.choices ?? [];
      const shapeLabel = (index: number) => {
        const choice = shapes.find(entry => entry.index === index);
        return choice ? `Eye shape ${choice.number}${choice.target ? ` (${choice.target})` : " (base)"}` : "";
      };
      eyeShape.update(shapes.map(choice => ({ value: String(choice.index), label: shapeLabel(choice.index) })), String(preview?.eyeShape ?? 9),
        !preview || !shapes.length, (frame.viewport.head.error ?? frame.viewport.head.message) ?? (preview ? "This head has no eye shapes." : "Preview is still loading."));
      const overriding = saved.suggestedEyeShape !== undefined && preview && saved.suggestedEyeShape !== preview.eyeShape
        ? `Overriding the saved eye shape (${shapeLabel(saved.suggestedEyeShape)}) in this viewport only.` : "";
      setText(eyeNote, overriding || "The 3D view's eye shape, which eye makeup is placed on. It overrides your V's Eyes row in the 3D view.");
      const loading = (frame.viewport.head.error ?? frame.viewport.head.message) ?? "Preview is still loading.";
      for (const [control, detail] of [[brows, "brows"], [lashes, "lashes"]] as const) {
        const enabled = !!preview?.[detail], allowed = port.authoring.capability({ kind: "preview.setDetail", detail, enabled: true });
        control.update(enabled, { disabled: !preview || (!enabled && !allowed.available), reason: allowed.reason ?? loading });
      }
      const hairAllowed = port.authoring.capability({ kind: "preview.setHair", enabled: true });
      hair.update(!!preview?.hair, { disabled: !preview || (!preview.hair && !hairAllowed.available), reason: hairAllowed.reason ?? loading, note: "Hair physics is not simulated." });
      const piercingAllowed = port.authoring.capability({ kind: "preview.setPiercings", enabled: true });
      piercings.update(!!preview?.piercings, { disabled: !preview || (!preview.piercings && !piercingAllowed.available), reason: piercingAllowed.reason ?? loading });
      applyCapability(exportV, port.files.capability({ kind: "savedV.export" }));
      const detailLine = characterDetailLine(details);
      setText(detailNote, detailLine.text);
      detailNote.hidden = !detailNote.textContent;
    },
  };
}
