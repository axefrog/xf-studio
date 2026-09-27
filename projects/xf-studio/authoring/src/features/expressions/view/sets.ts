/**
 * Expression sets (research/animation/expression-editor-design.md §6.4, phase 3): named, ordered sets of saved expressions, each exported
 * as its own photo-mode expression mod. Composed from the component library only; it reaches the library and the host through its view
 * context (`ctx.presets`: saved expressions, sets and each set's latest Check or Build).
 *
 * - **Sets:** an ItemList of the feature's sets (select, rename in place, delete after a confirm, context menu); New set… opens a value
 *   popover with a suggested name.
 * - **In this set:** the selected set's expressions in menu order (drag or the keyboard to reorder, rename in place renames the saved
 *   expression, which is its menu label, Delete removes it from the set). Add… lists the saved expressions not in it yet; a saved
 *   expression deleted from the library stays listed as gone, with Remove, until the person removes it.
 * - **Mod:** its name (the default "XF Expressions - <set>", changeable), which expression table it carries (For my game, or For
 *   sharing), Check, then Build mod files… with the same confirm the collection's Build has, and the latest result: what can be packaged,
 *   what was left out and why, and after a Build, Show in folder. Nothing is ever added to the game or a mod manager from here.
 */
import { applyCapability, badge, button, ItemList, note, openConfirmPopover, openMenu, openValuePopover, progressBar, propertyList, section,
  Segmented, type MenuItem } from "../../../studio-ui/components";
import { icon } from "../../../studio-ui/icons";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { FeatureViewContext } from "../../../studio-ui/views/feature-view";
import type { GenericFeatureFacade } from "../../../studio-presentation";
import type { PartPreset, PartPresetSet, PartPresetSetTable, SetExportResult } from "../../../part-presets";
import { defaultSetModName, setMembers, setModName } from "../../../part-preset-sets";
import type { ExportOmission } from "../../../platform/api";
import type { ExpressionAction } from "../core";
import type { ExpressionPart } from "../part";
import { EXPRESSIONS_PANEL_META } from "./contribution";

type Ctx = FeatureViewContext<GenericFeatureFacade>;
/** The set shown, for this page's life (the first set when none is chosen or the chosen one is gone). */
let chosenSet: string | undefined;

const TABLE_OPTIONS = [
  { value: "installed" as const, label: "For my game", title: "Keeps every expression your installed mods add to photo mode working beside these" },
  { value: "sharing" as const, label: "For sharing", title: "For a mod to publish: carries only the game's own expressions beside these" },
];
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/** The menu label a saved expression shows in photo mode: its own label, else its name. */
const menuLabel = (preset: PartPreset) => ((preset.part.body as Partial<ExpressionPart> | null)?.label?.trim() || preset.name);

export function expressionSets(ctx: Ctx): PanelController {
  const report = (outcome: { ok: boolean; message?: string }) => { if (!outcome.ok) ctx.feedback.toast("warning", "Expression sets", outcome.message ?? "That didn't work."); };
  const current = (): PartPresetSet | undefined => { const items = ctx.presets.sets().items; return items.find(item => item.id === chosenSet) ?? items[0]; };
  const saved = () => ctx.presets.list().items;

  // ---- Sets ----
  const newSet = button({ label: "New set…", icon: "plus", small: true, onClick: event => createSet(event.currentTarget as Element) });
  const sets = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Your expression sets", noun: "set", maxLength: 120,
    onSelect: id => { chosenSet = id; ctx.changed(); },
    onMove: () => {},
    onRename: (id, name) => { const set = find(id); if (set) void ctx.presets.execute({ kind: "partPresetSet.rename", id, name, revision: set.revision }).then(report); },
    onDelete: id => deleteSet(id, sets.element.querySelector(`[data-id="${CSS.escape(id)}"]`) ?? sets.element),
    onMenu: (id, anchor) => setMenu(id, anchor),
    decorate: (item, row, selected) => {
      if (!row.trailing.childElementCount) row.trailing.append(button({ label: `More actions for ${item.name}`, icon: "more", iconOnly: true, variant: "ghost",
        small: true, menu: true, onClick: event => setMenu(item.id, event.currentTarget as Element) }));
      for (const control of row.trailing.querySelectorAll("button")) { control.tabIndex = selected ? 0 : -1; control.setAttribute("aria-label", `More actions for ${item.name}`); }
      row.element.querySelector(".item-grip")?.setAttribute("hidden", "");
    },
  });
  const setsEmpty = h("div", { class: "empty" }, h("p", { class: "empty-title", text: "No sets yet" }),
    h("p", { class: "empty-body", text: "A set is a group of your saved expressions that becomes one photo-mode mod. Save an expression, then make a set for it." }));
  const setsNote = note("", "warning");

  // ---- In this set ----
  const setTitle = h("span", { text: "In this set" });
  const add = button({ label: "Add…", icon: "plus", small: true, menu: true, onClick: event => addMenu(event.currentTarget as Element) });
  const members = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Expressions in this set, in menu order", noun: "expression", maxLength: 120,
    onSelect: id => startFrom(id),
    onMove: (id, to) => { const set = current(); if (!set) return; const next = set.members.filter(member => member !== id); next.splice(to, 0, id); setMembersTo(set, next); },
    onRename: (id, name) => { const preset = saved().find(item => item.id === id); if (preset) void ctx.presets.execute({ kind: "partPreset.rename", id, name, revision: preset.revision }).then(report); },
    onDelete: id => { const set = current(); if (set) setMembersTo(set, set.members.filter(member => member !== id)); },
    onMenu: (id, anchor) => memberMenu(id, anchor),
    decorate: (item, row, selected) => {
      if (!row.trailing.childElementCount) row.trailing.append(button({ label: `Remove ${item.name} from this set`, icon: "minus", iconOnly: true, variant: "ghost",
        small: true, onClick: () => { const set = current(); if (set) setMembersTo(set, set.members.filter(member => member !== item.id)); } }));
      for (const control of row.trailing.querySelectorAll("button")) { control.tabIndex = selected ? 0 : -1; control.setAttribute("aria-label", `Remove ${item.name} from this set`); }
      row.element.classList.toggle("missing", !saved().some(preset => preset.id === item.id));
    },
  });
  const membersEmpty = h("p", { class: "muted small", text: "No expressions in this set yet. Add your saved expressions; their order here is their order in photo mode." });

  // ---- Mod ----
  const modName = h("strong", { class: "set-mod-name" });
  const renameMod = button({ label: "Rename mod…", icon: "rename", small: true, variant: "quiet", onClick: event => renameModPopover(event.currentTarget as Element) });
  const table = new Segmented<PartPresetSetTable>({ label: "Expression list", options: TABLE_OPTIONS, reserveNote: true,
    help: ["Photo mode keeps its expressions in one list that only one mod can provide.",
      "For my game: the list your game uses now, with these added, so the expressions your other mods add keep working.",
      "For sharing: the game's own list with these added, for a mod you publish. It carries no other mod's expressions, so with another expression mod installed, whichever list your mod manager loads first decides which expressions work."],
    onSelect: value => { const set = current(); if (set && (set.table ?? "installed") !== value) void ctx.presets.execute({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision, table: value }).then(report); } });
  const check = button({ label: "Check", icon: "check", small: true, title: "See which expressions can become mod files (creates no files)", onClick: () => void run("check") });
  const build = button({ label: "Build mod files…", icon: "package", small: true, variant: "primary", onClick: event => confirmBuild(event.currentTarget as Element) });
  const progressText = h("span", { class: "muted small" });
  const progress = h("div", { class: "package-progress idle" }, progressBar({ label: "Set export in progress" }).element, progressText);
  const result = h("div", { class: "package-result", "aria-live": "polite" });
  const modSection = section({ title: "Mod", help: ["Each set becomes its own mod: its expressions join photo mode's expression list, for female and male V.",
    "Build makes the files and checks them. Nothing is added to your game or mod manager: Show in folder, then copy them in by hand or zip them for a mod page."] },
  propertyList([{ term: "Name", value: h("span", { class: "row gap-s" }, modName, renameMod) }], { label: "Mod" }),
  table.element, h("div", { class: "row gap-s package-actions" }, check, build, progress), result);

  const membersSection = h("section", { class: "section", "aria-label": "In this set", "data-view-key": "expressions.set-members" },
    h("div", { class: "section-head" }, h("h3", { class: "section-title" }, setTitle), h("span", { class: "block-actions" }, add)), members.element, membersEmpty);
  const element = h("div", { class: "panel-content expr-sets" },
    h("section", { class: "section", "aria-label": "Sets", "data-view-key": "expressions.sets" },
      h("div", { class: "section-head" }, h("h3", { class: "section-title", text: "Sets" }), h("span", { class: "block-actions" }, newSet)),
      setsNote, sets.element, setsEmpty),
    membersSection, modSection);

  function find(id: string) { return ctx.presets.sets().items.find(item => item.id === id); }
  function setMembersTo(set: PartPresetSet, next: string[]) {
    void ctx.presets.execute({ kind: "partPresetSet.setMembers", id: set.id, members: next, revision: set.revision }).then(report);
  }
  function startFrom(id: string) {
    const preset = saved().find(item => item.id === id);
    if (!preset) return;
    const body = preset.part.body as Partial<ExpressionPart> | null;
    ctx.dispatch({ kind: "expression.startFrom", origin: { kind: "preset", id: preset.id, name: preset.name }, controls: body?.controls ?? {},
      ...(body?.links ? { links: body.links } : {}) } as ExpressionAction);
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
  function addMenu(anchor: Element) {
    const set = current();
    if (!set) return;
    const outside = saved().filter(preset => !set.members.includes(preset.id));
    const items: MenuItem[] = outside.length
      ? [{ kind: "heading", label: "Add a saved expression" }, ...outside.map((preset): MenuItem => ({ kind: "action", label: preset.name, icon: "plus",
        capability: ctx.presets.capability({ kind: "partPresetSet.setMembers", id: set.id, members: [...set.members, preset.id], revision: set.revision }),
        run: () => setMembersTo(set, [...set.members, preset.id]) })),
        ...(outside.length > 1 ? [{ kind: "separator" } as MenuItem, { kind: "action", label: `Add all ${outside.length}`, icon: "plus",
          run: () => setMembersTo(set, [...set.members, ...outside.map(preset => preset.id)]) } as MenuItem] : [])]
      : [{ kind: "heading", label: "Nothing to add", detail: saved().length ? "Every saved expression is in this set already." : "Save an expression in the Expression panel first." }];
    openMenu(items, anchor, { label: "Add to set" });
  }
  function memberMenu(id: string, anchor: Element | { x: number; y: number }) {
    const set = current(), preset = saved().find(item => item.id === id);
    if (!set) return;
    const index = set.members.indexOf(id);
    const move = (to: number) => { const next = set.members.filter(member => member !== id); next.splice(to, 0, id); setMembersTo(set, next); };
    openMenu([
      { kind: "heading", label: preset ? preset.name : "Deleted expression", ...(preset ? {} : { detail: "It was deleted from your library." }) },
      ...(preset ? [{ kind: "action", label: "Start from it", icon: "play", capability: ctx.facade.editable(), run: () => startFrom(id) } as MenuItem,
        { kind: "action", label: "Rename…", icon: "rename", shortcut: "F2", run: () => renameMember(id, anchor) } as MenuItem] : []),
      { kind: "action", label: "Move up", icon: "arrowUp", capability: index > 0 ? { available: true } : { available: false, reason: "It's first already." }, run: () => move(index - 1) },
      { kind: "action", label: "Move down", icon: "arrowDown", capability: index < set.members.length - 1 ? { available: true } : { available: false, reason: "It's last already." },
        run: () => move(index + 1) },
      { kind: "separator" },
      { kind: "action", label: "Remove from set", icon: "minus", shortcut: "Del", run: () => setMembersTo(set, set.members.filter(member => member !== id)) },
    ], anchor, { label: "Expression actions" });
  }
  function renameMember(id: string, anchor: Element | { x: number; y: number }) {
    const preset = saved().find(item => item.id === id);
    if (!preset) return;
    openValuePopover({ kind: "text", label: "Name", value: preset.name, maxLength: 120 }, anchor, {
      title: "Rename saved expression", apply: "Rename",
      validate: value => ctx.presets.capability({ kind: "partPreset.rename", id, name: String(value), revision: preset.revision }),
      commit: value => void ctx.presets.execute({ kind: "partPreset.rename", id, name: String(value).trim(), revision: preset.revision }).then(report),
    });
  }
  function renameModPopover(anchor: Element) {
    const set = current();
    if (!set) return;
    openValuePopover({ kind: "text", label: "Mod name (as it appears in your mod manager)", value: setModName(set), maxLength: 80 }, anchor, {
      title: "Rename mod", apply: "Rename",
      validate: value => ctx.presets.capability({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision, modName: String(value) }),
      // The default name goes back to following the set's name.
      commit: value => { const name = String(value).trim();
        void ctx.presets.execute({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision,
          modName: name === defaultSetModName(set.feature, set.name) ? "" : name }).then(report); },
    });
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
    openMenu([{ kind: "heading", label: "Build this set's mod files?", detail: "Reads photo mode's expression list from your game files. Takes a minute or two. Nothing is added to your game or mod manager." },
      { kind: "action", label: "Build now", icon: "package", capability: ctx.presets.capability({ kind: "partPresetSet.build", id: set.id }), run: () => void run("build") },
      { kind: "action", label: "Check first", icon: "check", capability: ctx.presets.capability({ kind: "partPresetSet.check", id: set.id }), run: () => void run("check") }],
    anchor, { label: "Build mod files", invoker: anchor });
  }

  /** The latest Check or Build of the set shown, in the collection's result-card pattern. */
  function renderResult(set: PartPresetSet, last: SetExportResult | undefined): HTMLElement[] {
    if (!last) return [];
    const stale = last.revision !== set.revision;
    if (last.kind === "failed") return [h("div", { class: "result-card error" }, icon("warning"),
      h("div", {}, h("strong", { text: last.action === "build" ? "Build didn't finish" : "Check didn't finish" }), h("p", { text: last.message }),
        h("p", { class: "muted small", text: "Your set is unchanged." })))];
    const r = last.result, isBuild = last.kind === "build";
    const packaged = r.products.flatMap(product => product.features.flatMap(feature => feature.presets));
    const total = r.originalPresetCount + last.missing;
    const card = h("div", { class: `result-card ${stale ? "stale" : "ok"}` },
      h("div", { class: "result-head" }, h("strong", { text: isBuild ? "Build result" : "Check result" }),
        stale ? badge("Stale — set changed since", "warning") : badge("Current", "success")),
      h("p", { class: "result-summary", text: `${packaged.length} of ${plural(total, "expression")} can become mod files.${isBuild ? "" : " This check created no files."}` }));
    const byId = new Map(saved().map(preset => [preset.id, preset]));
    for (const product of r.products) {
      const block = h("div", { class: "result-product" }, h("p", { class: "muted small" }, "Mod ", h("strong", { text: product.modName })));
      if (!isBuild) block.append(h("ul", { class: "result-list" }, product.features.flatMap(feature => feature.presets.map(look => {
        const preset = byId.get(look.id);
        return h("li", {}, icon("check"), h("span", { text: preset ? menuLabel(preset) : String(look.id) }));
      }))));
      card.append(block);
    }
    for (const text of new Set(r.products.flatMap(product => product.features.flatMap(feature => feature.notes)))) card.append(note(text, "info"));
    const omissions: ExportOmission[] = [...r.omissions, ...r.products.flatMap(product => product.features.flatMap(feature => feature.omissions))];
    const lines = omissions.map(item => item.kind === "feature" ? `${item.label} — ${item.reason}` : `“${item.presetName}” — ${item.reason}`);
    if (last.missing) lines.unshift(`${plural(last.missing, "expression")} deleted from your library — remove ${last.missing === 1 ? "it" : "them"} from the set`);
    if (lines.length) card.append(h("div", { class: "omissions" }, h("span", { class: "eyebrow", text: "Left out" }),
      h("ul", { class: "result-list" }, lines.map(text => h("li", {}, icon("warning"), h("span", { text }))))));
    if (isBuild) {
      const show = button({ label: "Show in folder", icon: "folder", small: true, onClick: () => void ctx.presets.execute({ kind: "partPresetSet.reveal", id: set.id }).then(report) });
      applyCapability(show, ctx.presets.capability({ kind: "partPresetSet.reveal", id: set.id }));
      card.append(h("div", { class: "row gap-s" }, show),
        note("Your mod was built and checked. Nothing is in your game yet: copy its archive and r6 folders into your game folder or mod manager. " +
          "How the expressions look in photo mode hasn't been checked yet.", "info"));
    }
    if (stale) card.append(note("This set changed after this result. Run Check again.", "warning"));
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
      setsEmpty.hidden = list.phase !== "ready" || list.items.length > 0;
      applyCapability(newSet, ctx.presets.capability({ kind: "partPresetSet.create", name: "x" }));
      membersSection.hidden = !set; modSection.hidden = !set;
      if (!set) return;
      setText(setTitle, `In “${set.name}”`);
      const byId = new Map(presets.items.map(preset => [preset.id, preset]));
      members.update(setMembers(set, presets.items).map(member => {
        const preset = byId.get(member.id);
        const label = preset ? menuLabel(preset) : "";
        return { id: member.id, name: preset?.name ?? "Deleted expression", meta: !preset ? "deleted from your library" : label !== preset.name ? `shows as “${label}”` : "" };
      }), undefined);
      membersEmpty.hidden = set.members.length > 0;
      setText(modName, setModName(set));
      renameMod.title = set.modName ? "Rename the mod (clear it to follow the set's name again)" : "Give the mod its own name";
      const running = exports.busy?.id === set.id ? exports.busy.action : undefined;
      table.update(set.table ?? "installed", () => ctx.presets.capability({ kind: "partPresetSet.setExport", id: set.id, revision: set.revision }), {
        note: (set.table ?? "installed") === "sharing" ? "Carries only the game's own expressions beside these." : "Keeps your other expression mods working." });
      applyCapability(check, ctx.presets.capability({ kind: "partPresetSet.check", id: set.id }));
      applyCapability(build, ctx.presets.capability({ kind: "partPresetSet.build", id: set.id }));
      progress.classList.toggle("idle", !running || running === "reveal");
      setText(progressText, running === "build" ? "Building…" : running === "check" ? "Checking…" : "");
      const next = JSON.stringify([set.id, set.revision, exports.results[set.id], presets.items.map(item => [item.id, item.name, item.revision])]);
      if (next !== signature) { signature = next; result.replaceChildren(...renderResult(set, exports.results[set.id])); }
    },
  };
}
