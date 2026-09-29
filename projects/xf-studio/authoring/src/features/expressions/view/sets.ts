/**
 * Expression sets (research/animation/expression-editor-design.md §6.4, phase 3): named, ordered sets of saved expressions, each exported
 * as its own photo-mode expression mod. Composed from the component library only; it reaches the library and the host through its view
 * context (`ctx.presets`: saved expressions, sets and each set's latest Check or Build).
 *
 * - **Sets:** an ItemList of the feature's sets (select, rename in place, delete after a confirm, context menu); New set… opens a value
 *   popover with a suggested name. With no sets, the empty state says what to do next (save an expression first when there is none).
 * - **In this set:** the selected set's expressions in menu order, by the name photo mode shows (renaming here renames that name). A row
 *   is selected while its expression is the one in the Expression panel; clicking a row loads it there. Drag or the keyboard reorders;
 *   Delete removes a row from the set. A saved expression deleted before sets followed deletes stays as a warning row with Remove.
 *   Add… lists the saved expressions not in the set yet, and is unavailable, with the reason, when there are none.
 * - **Mod:** the mod's line (its name and a menu with Rename and Use default name), what the mod is made for (your game, or sharing),
 *   Check, then Build mod files… with the collection Build's confirm, and the latest result in the mod-package pattern: a summary, one
 *   note, what was left out with a Start from it button, the next step after a Build and a Details group. After a verified Build the
 *   result offers Add to my mod manager (the shell's review-then-consent sheet, `ctx.modInstall`, exactly as the Mod package panel) and
 *   Show in folder; nothing is added to the game or a mod manager until the person accepts the reviewed plan.
 */
import { applyCapability, badge, button, emptyState, GroupSection, hasCommands, ItemList, note, openConfirmPopover, openMenu, openValuePopover, progressBar,
  section, Segmented, modLine as modLineItem, type MenuItem } from "../../../studio-ui/components";
import { icon } from "../../../studio-ui/icons";
import { h, setText } from "../../../studio-ui/dom";
import { MOD_NAME_HINT } from "../../../mod-branding";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { FeatureViewContext } from "../../../studio-ui/views/feature-view";
import type { GenericFeatureFacade } from "../../../studio-presentation";
import type { PartPreset, PartPresetSet, PartPresetSetTable, SetExportResult } from "../../../part-presets";
import { defaultSetModName, setExportKey, setMembers, setModName } from "../../../part-preset-sets";
import type { ExportOmission, PackageBuildResult, PackageCheckResult } from "../../../platform/api";
import type { ExpressionAction } from "../core";
import type { ExpressionPart } from "../part";
import { EXPRESSIONS_PANEL_META } from "./contribution";

type Ctx = FeatureViewContext<GenericFeatureFacade>;
/** The set shown, for this page's life (the first set when none is chosen or the chosen one is gone). */
let chosenSet: string | undefined;

const TABLE_OPTIONS = [{ value: "installed" as const, label: "My game" }, { value: "sharing" as const, label: "Sharing" }];
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const body = (preset: PartPreset) => preset.part.body as Partial<ExpressionPart> | null;
/** The name photo mode shows for a saved expression: its own label, else its name. */
const shownName = (preset: PartPreset) => body(preset)?.label?.trim() || preset.name;
/** The facts a Check or Build carries for the Details group. */
type ExpressionDetails = { carried?: { rows: number; provider: string } | null; filler?: { from: number; to: number } | null; guidance?: string[] };

export function expressionSets(ctx: Ctx): PanelController {
  const report = (outcome: { ok: boolean; message?: string }) => { if (!outcome.ok) ctx.feedback.toast("warning", "Expression sets", outcome.message ?? "That didn't work."); };
  const current = (): PartPresetSet | undefined => { const items = ctx.presets.sets().items; return items.find(item => item.id === chosenSet) ?? items[0]; };
  const saved = () => ctx.presets.list().items;
  const presetOf = (id: string) => saved().find(item => item.id === id);
  const rowOf = (list: ItemList<{ id: string; name: string; meta: string; secondary?: string }>, id: string) =>
    list.element.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? list.element;

  // ---- Sets ----
  const newSet = button({ label: "New set…", icon: "plus", small: true, onClick: event => createSet(event.currentTarget as Element) });
  const sets = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Your expression sets", noun: "set", maxLength: 120,
    onSelect: id => { chosenSet = id; ctx.changed(); },
    onMove: () => {},
    onRename: (id, name) => { const set = find(id); if (set) void ctx.presets.execute({ kind: "partPresetSet.rename", id, name, revision: set.revision }).then(report); },
    onDelete: id => deleteSet(id, rowOf(sets, id)),
    onMenu: (id, anchor) => setMenu(id, anchor),
    decorate: (item, row, selected) => {
      if (!row.trailing.childElementCount) row.trailing.append(button({ label: `More actions for ${item.name}`, icon: "more", iconOnly: true, variant: "ghost",
        small: true, menu: true, onClick: event => setMenu(item.id, event.currentTarget as Element) }));
      for (const control of row.trailing.querySelectorAll("button")) { control.tabIndex = selected ? 0 : -1; control.setAttribute("aria-label", `More actions for ${item.name}`); }
      row.element.querySelector(".item-grip")?.setAttribute("hidden", "");
    },
  });
  const openExpression = button({ label: "Open Expression", icon: "character", small: true, onClick: () => ctx.reveal("expressions.controls", true) });
  const setsEmptyHost = h("div");
  const setsNote = note("", "warning");

  // ---- In this set ----
  const setTitle = h("span", { text: "In this set" });
  const add = button({ label: "Add…", icon: "plus", small: true, menu: true, onClick: event => addMenu(event.currentTarget as Element) });
  const removeFrom = (id: string) => { const set = current(); if (set) setMembersTo(set, set.members.filter(member => member !== id)); };
  const members = new ItemList<{ id: string; name: string; meta: string; secondary?: string }>({
    label: "Expressions in this set, in photo mode's order", noun: "expression", maxLength: 64,
    onSelect: id => startFrom(id),
    onMove: (id, to) => { const set = current(); if (!set) return; const next = set.members.filter(member => member !== id); next.splice(to, 0, id); setMembersTo(set, next); },
    onRename: (id, name) => renameShown(id, name),
    onDelete: id => removeFrom(id),
    onMenu: (id, anchor) => memberMenu(id, anchor),
    decorate: (item, row, selected) => {
      const missing = !presetOf(item.id);
      if (!row.trailing.childElementCount) row.trailing.append(button({ label: `Remove ${item.name} from this set`, icon: "minus", iconOnly: true, variant: "ghost",
        small: true, onClick: () => removeFrom(item.id) }));
      for (const control of row.trailing.querySelectorAll("button")) { control.tabIndex = selected ? 0 : -1; control.setAttribute("aria-label", `Remove ${item.name} from this set`); }
      row.trailing.hidden = missing;
      // A saved expression deleted before deletes took it out of its sets: a warning row with Remove in view.
      row.lead.replaceChildren(...(missing ? [icon("warning")] : []));
      row.label.classList.toggle("muted", missing);
      let remove = row.element.querySelector<HTMLButtonElement>(":scope > .set-remove");
      if (missing && !remove) {
        remove = button({ label: "Remove", small: true, variant: "quiet", className: "set-remove", onClick: () => removeFrom(item.id) });
        row.element.insertBefore(remove, row.trailing);
      } else if (!missing && remove) remove.remove();
    },
  });
  const membersEmpty = h("p", { class: "muted small", text: "No expressions in this set yet. Add your saved expressions; their order here is their order in photo mode." });

  // ---- Mod ----
  const modLine = h("ul", { class: "result-list package-mods", "aria-label": "The mod this set builds" });
  const table = new Segmented<PartPresetSetTable>({ label: "Made for", options: TABLE_OPTIONS, reserveNote: true,
    help: ["Photo mode keeps its expressions in one list that only one mod can provide.",
      "My game: the list your game uses now, with these added, so the expressions your other mods add keep working.",
      "Sharing: the game's own list with these added, for a mod you publish. With another expression mod installed, whichever list loads first decides which expressions work."],
    onSelect: value => { const set = current(); if (set && (set.table ?? "installed") !== value) void ctx.presets.execute({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision, table: value }).then(report); } });
  const check = button({ label: "Check", icon: "check", small: true, title: "See which expressions can become mod files (creates no files)", onClick: () => void run("check") });
  const build = button({ label: "Build mod files…", icon: "package", small: true, variant: "primary", onClick: event => confirmBuild(event.currentTarget as Element) });
  // While the set's latest Build is current, its result's Add is the one primary action: Build again is a secondary one.
  const rebuild = button({ label: "Build mod files…", icon: "package", small: true, onClick: event => confirmBuild(event.currentTarget as Element) });
  const progressText = h("span", { class: "muted small" });
  const progress = h("div", { class: "package-progress idle" }, progressBar({ label: "Set export in progress" }).element, progressText);
  // A Build takes a minute or two and the host reports no steps of its own yet, so the line says what it is doing and how long it
  // usually takes, never a bare "Building…" (UI-142; step-by-step progress needs a progress stream from the export host).
  const paintProgress = (running: string | undefined) => {
    setText(progressText, running === "build" ? "Making and checking the mod files. This usually takes a minute or two…" : running === "check" ? "Checking…" : "");
    progressText.title = progressText.textContent ?? "";
  };
  const result = h("div", { class: "package-result", "aria-live": "polite" });
  const modSection = section({ title: "Mod", help: ["Each set becomes its own mod: its expressions join photo mode's expression list, for female and male V.",
    "Build makes the files and checks them. Nothing is added to your game or mod manager until you add it from the result, or show its folder to copy it by hand or zip it for a mod page."] },
  modLine, table.element, h("div", { class: "row gap-s package-actions" }, check, build, rebuild, progress), result);

  const membersSection = h("section", { class: "section", "aria-label": "In this set", "data-view-key": "expressions.set-members" },
    h("div", { class: "section-head" }, h("h3", { class: "section-title" }, setTitle), h("span", { class: "block-actions" }, add)), members.element, membersEmpty);
  const element = h("div", { class: "panel-content expr-sets" },
    h("section", { class: "section", "aria-label": "Sets", "data-view-key": "expressions.sets" },
      h("div", { class: "section-head" }, h("h3", { class: "section-title", text: "Sets" }), h("span", { class: "block-actions" }, newSet)),
      setsNote, sets.element, setsEmptyHost),
    membersSection, modSection);

  function find(id: string) { return ctx.presets.sets().items.find(item => item.id === id); }
  function setMembersTo(set: PartPresetSet, next: string[]) {
    void ctx.presets.execute({ kind: "partPresetSet.setMembers", id: set.id, members: next, revision: set.revision }).then(report);
  }
  function startFrom(id: string) {
    const preset = presetOf(id);
    if (!preset) return;
    const part = body(preset);
    ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: preset.id, name: preset.name }, controls: part?.controls ?? {},
      ...(part?.links ? { links: part.links } : {}) } as ExpressionAction);
  }
  /** Rename what photo mode shows: the saved expression's name, with its own label dropped so the name is what ships. */
  function renameShown(id: string, name: string) {
    const preset = presetOf(id);
    if (!preset) return;
    const part = body(preset);
    const { label: _label, ...rest } = part ?? {};
    void ctx.presets.execute({ kind: "partPreset.rename", id, name, revision: preset.revision,
      ...(part?.label ? { part: { schema: preset.part.schema, body: rest } } : {}) }).then(report);
  }
  function createSet(anchor: Element) {
    const names = new Set(ctx.presets.sets().items.map(item => item.name.toLowerCase()));
    let n = 1; while (names.has(`my expressions${n === 1 ? "" : ` ${n}`}`)) n++;
    openValuePopover({ kind: "text", label: "Name", value: `My expressions${n === 1 ? "" : ` ${n}`}`, maxLength: 120 }, anchor, {
      title: "New expression set", apply: "Create",
      validate: value => ctx.presets.capability({ kind: "partPresetSet.create", name: String(value) }),
      commit: value => void ctx.presets.execute({ kind: "partPresetSet.create", name: String(value).trim() }).then(outcome => {
        if (outcome.ok && outcome.set) { chosenSet = outcome.set.id; ctx.feedback.announce(`Created the set “${outcome.set.name}”.`); ctx.changed(); } else report(outcome);
      }),
    });
  }
  function renameSet(id: string, anchor: Element | { x: number; y: number }) {
    const set = find(id);
    if (!set) return;
    openValuePopover({ kind: "text", label: "Name", value: set.name, maxLength: 120 }, anchor, {
      title: "Rename set", apply: "Rename",
      validate: value => ctx.presets.capability({ kind: "partPresetSet.rename", id, name: String(value), revision: set.revision }),
      commit: value => void ctx.presets.execute({ kind: "partPresetSet.rename", id, name: String(value).trim(), revision: set.revision }).then(report),
    });
  }
  function deleteSet(id: string, anchor: Element | { x: number; y: number }) {
    const set = find(id);
    if (!set) return;
    openConfirmPopover(anchor, { title: "Delete set", message: `Delete the set “${set.name}”? Its saved expressions stay in your library. This can't be undone.`,
      confirm: "Delete", danger: true,
      onConfirm: () => void ctx.presets.execute({ kind: "partPresetSet.delete", id, revision: set.revision }).then(outcome => {
        report(outcome); if (outcome.ok) ctx.feedback.announce(`Deleted the set “${set.name}”.`); }) });
  }
  function setMenu(id: string, anchor: Element | { x: number; y: number }) {
    const set = find(id);
    if (!set) return;
    openMenu([
      { kind: "heading", label: set.name },
      { kind: "action", label: "Rename…", icon: "rename", shortcut: "F2", capability: ctx.presets.capability({ kind: "partPresetSet.rename", id, name: set.name, revision: set.revision }),
        run: () => renameSet(id, anchor) },
      { kind: "separator" },
      { kind: "action", label: "Delete…", icon: "trash", shortcut: "Del", danger: true,
        capability: ctx.presets.capability({ kind: "partPresetSet.delete", id, revision: set.revision }), run: () => deleteSet(id, anchor) },
    ], anchor, { label: `${set.name} actions` });
  }
  const outsideOf = (set: PartPresetSet) => saved().filter(preset => !set.members.includes(preset.id));
  /** The Add… menu's commands: each saved expression not in the set yet, and all of them. */
  function addItems(set: PartPresetSet): MenuItem[] {
    const outside = outsideOf(set);
    return [{ kind: "heading", label: "Add a saved expression" }, ...outside.map((preset): MenuItem => ({ kind: "action", label: shownName(preset), icon: "plus",
      run: () => setMembersTo(set, [...set.members, preset.id]) })),
      ...(outside.length > 1 ? [{ kind: "separator" } as MenuItem, { kind: "action", label: `Add all ${outside.length}`, icon: "plus",
        run: () => setMembersTo(set, [...set.members, ...outside.map(preset => preset.id)]) } as MenuItem] : [])];
  }
  /** Add… is unavailable, with the reason, when its menu would hold no command (`hasCommands`). */
  function addCapability(set: PartPresetSet | undefined) {
    if (!set) return { available: false, reason: "Choose a set first." };
    if (!hasCommands(addItems(set))) return { available: false, reason: saved().length ? "Every saved expression is in this set already."
      : "Save an expression in the Expression panel first." };
    return ctx.presets.capability({ kind: "partPresetSet.setMembers", id: set.id, members: set.members, revision: set.revision });
  }
  function addMenu(anchor: Element) {
    const set = current();
    if (!set || !addCapability(set).available) return;
    openMenu(addItems(set), anchor, { label: "Add to set" });
  }
  function memberMenu(id: string, anchor: Element | { x: number; y: number }) {
    const set = current(), preset = presetOf(id);
    if (!set) return;
    const index = set.members.indexOf(id);
    const move = (to: number) => { const next = set.members.filter(member => member !== id); next.splice(to, 0, id); setMembersTo(set, next); };
    // Only what applies to this row: moves that can happen, and loading or renaming only while its saved expression exists.
    openMenu([
      { kind: "heading", label: preset ? shownName(preset) : "Deleted expression", ...(preset ? {} : { detail: "It was deleted from your library." }) },
      ...(preset ? [{ kind: "action", label: "Start from it", icon: "play", capability: ctx.facade.editable(), run: () => startFrom(id) } as MenuItem,
        { kind: "action", label: "Rename…", icon: "rename", shortcut: "F2", run: () => renameMember(id, anchor) } as MenuItem] : []),
      ...(index > 0 ? [{ kind: "action", label: "Move up", icon: "arrowUp", run: () => move(index - 1) } as MenuItem] : []),
      ...(index < set.members.length - 1 ? [{ kind: "action", label: "Move down", icon: "arrowDown", run: () => move(index + 1) } as MenuItem] : []),
      { kind: "separator" },
      { kind: "action", label: "Remove from set", icon: "minus", shortcut: "Del", run: () => removeFrom(id) },
    ], anchor, { label: "Expression actions" });
  }
  function renameMember(id: string, anchor: Element | { x: number; y: number }) {
    const preset = presetOf(id);
    if (!preset) return;
    openValuePopover({ kind: "text", label: "Name in photo mode", value: shownName(preset), maxLength: 64 }, anchor, {
      title: "Rename expression", apply: "Rename",
      validate: value => ctx.presets.capability({ kind: "partPreset.rename", id, name: String(value), revision: preset.revision }),
      commit: value => renameShown(id, String(value).trim()),
    });
  }
  function renameModPopover(anchor: Element | { x: number; y: number }) {
    const set = current();
    if (!set) return;
    openValuePopover({ kind: "text", label: "Mod name", value: setModName(set), maxLength: 80 }, anchor, {
      title: "Rename mod", apply: "Rename", hint: MOD_NAME_HINT,
      validate: value => ctx.presets.capability({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision, modName: String(value) }),
      // The default name goes back to following the set's name.
      commit: value => { const name = String(value).trim();
        void ctx.presets.execute({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision,
          modName: name === defaultSetModName(set.feature, set.name) ? "" : name }).then(report); },
    });
  }
  function modMenu(anchor: Element) {
    const set = current();
    if (!set) return;
    openMenu([
      { kind: "action", label: "Rename…", icon: "rename", run: () => renameModPopover(anchor) },
      ...(set.modName ? [{ kind: "action", label: "Use default name", icon: "reset", hint: defaultSetModName(set.feature, set.name),
        run: () => void ctx.presets.execute({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision, modName: "" }).then(report) } as MenuItem] : []),
    ], anchor, { label: `${setModName(set)} options`, invoker: anchor });
  }
  async function run(action: "check" | "build") {
    const set = current();
    if (!set) return;
    const outcome = await ctx.presets.execute({ kind: action === "build" ? "partPresetSet.build" : "partPresetSet.check", id: set.id });
    if (outcome.ok) ctx.feedback.announce(action === "build" ? `Built ${setModName(set)}.` : `Checked ${set.name}.`);
  }
  function confirmBuild(anchor: Element) {
    const set = current();
    if (!set) return;
    openMenu([{ kind: "heading", label: "Build this set's mod files?", detail: "Reads photo mode's expression list from your game files. Takes a minute or two. Nothing is added to your game or mod manager until you choose to." },
      { kind: "action", label: "Build now", icon: "package", capability: ctx.presets.capability({ kind: "partPresetSet.build", id: set.id }), run: () => void run("build") },
      { kind: "action", label: "Check first", icon: "check", capability: ctx.presets.capability({ kind: "partPresetSet.check", id: set.id }), run: () => void run("check") }],
    anchor, { label: "Build mod files", invoker: anchor });
  }

  /** What was left out, each with the button that fixes it (load the expression to change it). */
  function leftOut(omissions: readonly ExportOmission[]): HTMLElement | null {
    const lines = omissions.filter((item): item is Extract<ExportOmission, { kind: "preset" }> => item.kind === "preset");
    if (!lines.length) return null;
    return h("div", { class: "omissions" }, h("span", { class: "eyebrow", text: "Left out" }),
      h("ul", { class: "result-list" }, lines.map(item => h("li", {}, icon("warning"), h("span", { text: item.reason }),
        presetOf(item.presetId) ? button({ label: "Start from it", icon: "play", small: true, variant: "quiet", onClick: () => startFrom(item.presetId) }) : null))));
  }
  /** The facts behind the result, folded: where the expression list comes from, how it grows, and any further guidance. */
  function details(r: PackageCheckResult | PackageBuildResult): HTMLElement {
    const facts = (r.products[0]?.features[0]?.details ?? {}) as ExpressionDetails;
    const rows: string[] = [...(facts.guidance ?? [])];
    if (facts.carried) rows.push(`Photo mode's list: ${plural(facts.carried.rows, "expression")} from ${facts.carried.provider}, then these.`);
    if (facts.filler) rows.push(`Empty places ${facts.filler.from} to ${facts.filler.to - 1} show a neutral face, so these always sit at the same place.`);
    const group = new GroupSection({ title: "Details", key: "expressions.set-result-details", level: "subsection", heading: 5, expanded: false });
    group.body.append(...rows.map(text => h("p", { class: "muted small", text })));
    return group.element;
  }
  // After a verified Build: "Add to my mod manager…" (the shell's reviewed plan, then consent) and "Show in folder", as the Mod package
  // panel offers them (UI-82). A row per built mod lives outside the result card, so each paint updates it in place.
  const installRows = new Map<string, { element: HTMLElement; add: HTMLButtonElement; show: HTMLButtonElement; line: HTMLElement; note: HTMLElement; set: string }>();
  function installRow(set: PartPresetSet, product: string) {
    let row = installRows.get(product);
    if (!row) {
      const add: HTMLButtonElement = button({ label: "Add to my mod manager…", icon: "package", small: true, variant: "primary",
        onClick: () => ctx.modInstall.review(product, { rename: () => renameModPopover(add) }) });
      const show = button({ label: "Show in folder", icon: "folder", small: true, onClick: () => void ctx.presets.execute({ kind: "partPresetSet.reveal", id: set.id }).then(report) });
      const line = h("p", { class: "install-line small", role: "status" });
      // The next step until the mod is added; once it is, the line above says where it is.
      const next = note("Add it to your mod manager, or show its folder to copy it by hand.", "info");
      row = { element: h("div", { class: "install-row" }, h("div", { class: "row wrap gap-s" }, add, show), line), add, show, line, note: next, set: set.id };
      installRows.set(product, row);
    }
    return row;
  }
  /** The latest Check or Build of the set shown, in the mod-package result pattern. */
  function renderResult(set: PartPresetSet, last: SetExportResult | undefined, presets: readonly PartPreset[]): HTMLElement[] {
    if (!last) return [];
    // Stale when the set or any of its expressions changed since (PIPE-120).
    const stale = last.key !== setExportKey(set, presets);
    // A Check made before the game files were read is provisional (Check runs again by itself once they are): no Current badge.
    const provisional = last.kind === "check" && !!last.result.products.some(product => product.features.some(feature =>
      (feature.details as { provisional?: unknown }).provisional === true));
    const staleNote = () => h("div", { class: "row gap-s" }, note("This set changed after this result.", "warning"),
      button({ label: "Check", icon: "check", small: true, onClick: () => void run("check") }));
    const head = (title: string, current = !provisional) => h("div", { class: "result-head" }, h("strong", { text: title }),
      stale ? badge("Stale", "warning") : current ? badge("Current", "success") : null);
    if (last.kind === "failed") {
      // Nothing could be packaged: a finished Check with what to fix, not a failure.
      if (last.code === "no_exportable_content" && last.omissions?.length) return [h("div", { class: "result-card stale" },
        head("Nothing in this set can become mod files yet", false), leftOut(last.omissions), stale ? staleNote() : null)];
      return [h("div", { class: "result-card error" }, icon("warning"),
        h("div", {}, h("strong", { text: last.action === "build" ? "Build didn't finish" : "Check didn't finish" }), h("p", { text: last.message })))];
    }
    const r = last.result, isBuild = last.kind === "build";
    const packaged = r.products.flatMap(product => product.features.flatMap(feature => feature.presets));
    const omissions = [...r.omissions, ...r.products.flatMap(product => product.features.flatMap(feature => feature.omissions))];
    const firstNote = r.products.flatMap(product => product.features.flatMap(feature => feature.notes))[0];
    const modName = r.products[0]?.modName ?? setModName(set);
    const card = h("div", { class: `result-card ${stale ? "stale" : "ok"}` }, head(isBuild ? "Build result" : "Check result"));
    if (isBuild) {
      card.append(h("p", { class: "result-summary", text: `Built ${modName}: ${plural(packaged.length, "expression")}.` }));
      const product = r.products[0]?.productId;
      if (product) { const row = installRow(set, product); card.append(row.element, row.note); }
      card.append(h("p", { class: "muted small", text: "In photo mode they're at the end of the Expression list, for female and male V." }));
    } else {
      card.append(h("p", { class: "result-summary", text: `${packaged.length} of ${plural(r.originalPresetCount, "expression")} can become mod files. This check created no files.` }),
        h("div", { class: "result-product" }, h("p", { class: "muted small" }, "Mod ", h("strong", { text: modName })),
          h("ul", { class: "result-list" }, packaged.map(look => h("li", {}, icon("check"),
            h("span", { text: String((look as { label?: unknown }).label ?? presetOf(look.id)?.name ?? look.id) }))))));
    }
    if (firstNote) card.append(note(firstNote, "info"));
    const out = leftOut(omissions);
    if (out) card.append(out);
    card.append(details(r));
    if (stale) card.append(staleNote());
    return [card];
  }

  let signature = "";
  return {
    spec: { id: "expressions.sets", ...EXPRESSIONS_PANEL_META["expressions.sets"], element },
    update() {
      const list = ctx.presets.sets(), presets = ctx.presets.list(), set = current(), exports = ctx.presets.exports();
      setsNote.hidden = list.phase !== "failed";
      setText(setsNote, list.phase === "failed" ? list.reason ?? "Your sets are unavailable right now." : "");
      sets.update(list.items.map(item => ({ id: item.id, name: item.name, meta: plural(item.members.length, "expression") })), set?.id);
      const empty = list.phase === "ready" && !list.items.length;
      const emptyKey = empty ? (presets.items.length ? "some" : "none") : "";
      if (setsEmptyHost.dataset.state !== emptyKey) {
        setsEmptyHost.dataset.state = emptyKey;
        setsEmptyHost.replaceChildren(...(!empty ? [] : presets.items.length
          ? [emptyState("No sets yet", "A set is a group of your saved expressions that becomes one photo-mode mod. Make one with New set.")]
          : [emptyState("No sets yet", "A set is a group of saved expressions that becomes one photo-mode mod. Make an expression and save it first.", openExpression)]));
      }
      applyCapability(newSet, ctx.presets.capability({ kind: "partPresetSet.create", name: "x" }));
      membersSection.hidden = !set; modSection.hidden = !set;
      if (!set) { installRows.clear(); signature = ""; result.replaceChildren(); return; }
      setText(setTitle, `In “${set.name}”`);
      // The row whose expression the Expression panel holds is selected (its Remove is then reachable from the keyboard).
      const origin = (ctx.facade.view()?.part as ExpressionPart | undefined)?.origin;
      const loaded = origin?.kind === "preset" && set.members.includes(origin.id) ? origin.id : undefined;
      members.update(setMembers(set, presets.items).map(member => {
        const preset = member.preset ? presetOf(member.id) : undefined;
        // The name photo mode shows; the saved name beside it when it differs.
        const secondary = preset && preset.name !== shownName(preset) ? `saved as “${preset.name}”` : undefined;
        return { id: member.id, name: preset ? shownName(preset) : "Deleted expression", meta: "", ...(secondary ? { secondary } : {}) };
      }), loaded);
      membersEmpty.hidden = set.members.length > 0;
      applyCapability(add, addCapability(set));
      const name = setModName(set);
      if (modLine.dataset.name !== `${name}|${!!set.modName}`) {
        modLine.dataset.name = `${name}|${!!set.modName}`;
        // While the name is the default the menu would hold only Rename…, so the line's action renames directly (UI-143).
        modLine.replaceChildren(modLineItem({ name, kind: "Expressions",
          action: set.modName ? button({ label: `${name} options`, icon: "more", iconOnly: true, variant: "ghost", small: true, menu: true, onClick: event => modMenu(event.currentTarget as Element) })
            : button({ label: `Rename ${name}…`, icon: "rename", iconOnly: true, variant: "ghost", small: true, onClick: event => renameModPopover(event.currentTarget as Element) }) }));
      }
      const running = exports.busy?.id === set.id ? exports.busy.action : undefined;
      table.update(set.table ?? "installed", () => ctx.presets.capability({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision }), {
        note: (set.table ?? "installed") === "sharing" ? "For a mod you publish: carries only the game's own expressions." : "Keeps your other expression mods working." });
      applyCapability(check, ctx.presets.capability({ kind: "partPresetSet.check", id: set.id }));
      applyCapability(build, ctx.presets.capability({ kind: "partPresetSet.build", id: set.id }));
      applyCapability(rebuild, ctx.presets.capability({ kind: "partPresetSet.build", id: set.id }));
      const last = exports.results[set.id], builtCurrent = last?.kind === "build" && last.key === setExportKey(set, presets.items);
      build.hidden = builtCurrent; rebuild.hidden = !builtCurrent;
      progress.classList.toggle("idle", !running || running === "reveal");
      paintProgress(running);
      const next = JSON.stringify([set.id, set.revision, exports.results[set.id], presets.items.map(item => [item.id, item.name, item.revision])]);
      if (next !== signature) {
        signature = next; result.replaceChildren(...renderResult(set, exports.results[set.id], presets.items));
        // Only the rows the shown result holds are kept: a row of another set, a deleted one or an older result goes (CORE-119).
        for (const [product, row] of installRows) if (!result.contains(row.element)) installRows.delete(product);
      }
      // The install rows follow every paint: availability, and what happened last.
      for (const [product, row] of installRows) {
        setText(row.add.querySelector("span")!, ctx.modInstall.label());
        applyCapability(row.add, ctx.modInstall.capability(product));
        applyCapability(row.show, ctx.presets.capability({ kind: "partPresetSet.reveal", id: row.set }));
        const outcome = ctx.modInstall.outcome(product);
        setText(row.line, outcome?.message ?? "");
        row.line.className = `install-line small${outcome ? outcome.ok ? " done" : " warning" : ""}`;
        row.note.hidden = !!outcome?.ok;
      }
    },
  };
}
