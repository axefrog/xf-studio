import type { PackageBuildResult, PackageCheckResult } from "../../platform/api";
import { EYE_MAKEUP_MOD } from "../../mod-branding";
import type { ReadonlyDeep } from "../../read-only";
import { applyCapability, badge, button, emptyState, note, section } from "../controls";
import { h, setAttr, setText, setValue } from "../dom";
import { helpTip, setHelp } from "../help-tip";
import type { Command } from "../commands";
import type { PanelSpec } from "../dock/dock-view";
import { icon } from "../icons";
import { ItemList } from "../item-list";
import { progressBar } from "../components/progress";
import { openMenu, openValuePopover, type MenuAnchor, type MenuItem } from "../menu";
import type { PackageProductSummary as ProductSummary } from "../../collection-actions";
type PackageProductSummary = ReadonlyDeep<ProductSummary>;
import type { FeedbackAction } from "../feedback";
import type { Frame, StudioRuntime } from "../runtime";
import { collectionMenu, presetMenu } from "../target-menus";
import { openReportDialog } from "../diagnostics/report-dialog";
import { setupStatus } from "./game-setup";
import { modInstallLabel, openModInstallSheet } from "./mod-install-sheet";

import { PANEL_META } from "../panel-meta";

export type PanelController = { spec: PanelSpec; update(frame: Frame): void;
  /** The panel's own palette commands (its presentation state, e.g. folding), read when the palette opens. */
  commands?(): Command[];
  /** Bring one part of the panel into view and focus it (Settings: a group, `settings-sections.ts`). */
  show?(section?: string): void };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Library facts derived only from the draft summary and saved list; nothing is guessed. */
export function libraryState(frame: Frame) {
  const library = frame.library, draft = library.draft;
  if (!draft) return { tone: "neutral" as const, label: "Loading library…", detail: "" };
  const stored = library.summaries.find(item => item.id === draft.id);
  if (library.busy && library.progress?.phase === "working") return { tone: "info" as const, label: "Working…", detail: library.progress.message };
  // Plain chip labels; version numbers live in the tooltip/detail line.
  if (draft.revision === undefined) return { tone: "warning" as const, label: "Not saved yet",
    detail: "Not in your library yet. Save to keep a version you can return to." };
  if (stored && stored.revision > draft.revision) return { tone: "warning" as const, label: "Newer version saved",
    detail: `Version ${stored.revision} was saved elsewhere; your draft is from version ${draft.revision}. Save as a new collection, or reopen it.` };
  const persistence = frame.persistence;
  if (persistence?.baseline === "known" && !persistence.dirty) return { tone: "neutral" as const, label: "Saved",
    detail: `Matches version ${draft.revision} in your library.` };
  if (persistence?.baseline === "known") {
    const presets = persistence.dirtyPresets.length;
    const what = [persistence.structureDirty ? "the collection's name or order" : "",
      presets ? `${presets} ${presets === 1 ? "preset" : "presets"}` : ""].filter(Boolean).join(" and ");
    return { tone: "info" as const, label: "Unsaved changes",
      detail: `Changed since version ${draft.revision}: ${what}. Saving makes version ${draft.revision + 1}.` };
  }
  return { tone: "neutral" as const, label: "Autosaved draft",
    detail: `Started from version ${draft.revision}. Save to keep a new version.` };
}

export function presetsPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const nameInput = h("input", { class: "field title-field", type: "text", maxlength: "120", "aria-label": "Collection name", spellcheck: "false" });
  const commitName = () => {
    const current = port.library.summary().draft?.name;
    if (!current || nameInput.value.trim() === current) { nameInput.value = current ?? ""; return; }
    // The naming rules (a name can't be blank or too long) are the application's; a refusal says why and keeps the old name (UI-93).
    if (!rt.dispatch({ kind: "collection.rename", name: nameInput.value })) nameInput.value = current;
  };
  nameInput.addEventListener("change", commitName);
  nameInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitName(); nameInput.blur(); }
    if (event.key === "Escape") { nameInput.value = port.library.summary().draft?.name ?? ""; nameInput.blur(); } });
  const libraryChip = h("span", { class: "chip" });
  const collectionMore = button({ label: "Collection actions", icon: "more", iconOnly: true, variant: "ghost", menu: true,
    onClick: event => collectionMenu(rt, event.currentTarget as Element, event.currentTarget as Element) });
  const addButton = button({ label: "Add preset", icon: "plus", small: true,
    onClick: () => { if (rt.dispatch({ kind: "preset.edit", command: { kind: "add" } })) rt.feedback.announce("Preset added and selected"); } });
  const count = h("span", { class: "count" });
  const list = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Presets in this collection", noun: "preset", maxLength: 120,
    onSelect: id => rt.dispatch({ kind: "preset.select", id }),
    onMove: (id, to) => rt.dispatch({ kind: "preset.edit", command: { kind: "move", id, to } }),
    onRename: (id, name) => rt.dispatch({ kind: "preset.edit", command: { kind: "rename", id, name } }),
    onDelete: id => removePreset(id),
    onDuplicate: id => rt.dispatch({ kind: "preset.edit", command: { kind: "copy", id } }),
    onMenu: (id, anchor, invoker) => presetMenu(rt, id, anchor, invoker),
    decorate: (item, row, selected) => {
      if (!row.trailing.childElementCount) row.trailing.append(
        button({ label: `Duplicate ${item.name}`, icon: "duplicate", iconOnly: true, variant: "ghost", small: true,
          onClick: () => rt.dispatch({ kind: "preset.edit", command: { kind: "copy", id: item.id } }) }),
        button({ label: `More actions for ${item.name}`, icon: "more", iconOnly: true, variant: "ghost", small: true, menu: true,
          onClick: event => presetMenu(rt, item.id, event.currentTarget as Element, event.currentTarget as Element) }));
      for (const control of row.trailing.querySelectorAll("button")) {
        control.tabIndex = selected ? 0 : -1;
        const label = control.getAttribute("aria-label") ?? "";
        control.setAttribute("aria-label", label.replace(/(Duplicate|More actions for) .*/, `$1 ${item.name}`));
      }
      if (!row.lead.childElementCount) row.lead.append(h("span", { class: "preset-mark", "aria-hidden": "true" }));
    },
  });
  function removePreset(id: string) {
    const name = port.library.summary().draft?.presets.find(preset => preset.id === id)?.name ?? "Preset";
    if (rt.dispatch({ kind: "preset.edit", command: { kind: "remove", id } }))
      rt.feedback.toast("info", "Presets", `Removed “${name}”. The last 20 removals can be restored.`,
        [{ label: "Restore", run: () => {
          // Restore brings back the most recent removal; refuse if that is now another preset.
          if (port.library.summary().draft?.removed.at(-1)?.id !== id)
            rt.feedback.toast("warning", "Presets", `“${name}” is no longer the most recent removal. Use Restore in the Presets panel to step back through removals.`);
          else rt.dispatch({ kind: "preset.edit", command: { kind: "restore" } });
        } }]);
  }
  const restore = button({ label: "Restore removed", icon: "reset", small: true, variant: "quiet",
    onClick: () => { if (rt.dispatch({ kind: "preset.edit", command: { kind: "restore" } })) rt.feedback.announce("Preset restored"); } });
  const importRecipe = button({ label: "Import recipe as preset…", icon: "import", small: true, variant: "quiet",
    onClick: () => void rt.file({ kind: "recipe.import" }) });
  const failed = emptyState("Library unavailable", "Your library couldn't be read. Your draft still works. Try again, or restart XF Studio.",
    button({ label: "Retry", icon: "refresh", onClick: () => void rt.request({ kind: "initialize" }) }));
  const empty = emptyState("No presets yet", "A preset is one complete look — one choice in the in-game selector.",
    button({ label: "Add preset", icon: "plus", variant: "primary", onClick: () => rt.dispatch({ kind: "preset.edit", command: { kind: "add" } }) }));
  const element = h("div", { class: "panel-content" },
    h("div", { class: "panel-head" }, h("label", { class: "eyebrow", text: "Collection" }), h("div", { class: "row" }, nameInput, collectionMore),
      h("div", { class: "row wrap gap-s" }, libraryChip)),
    h("div", { class: "list-head" }, h("span", { class: "control-line" }, h("span", { class: "eyebrow" }, "Presets ", count),
      helpTip("presets", "Each preset becomes one choice in the game's single eye-makeup selector, alongside Off.")), addButton),
    failed, empty, list.element,
    h("div", { class: "row wrap gap-s panel-foot" }, restore, importRecipe));
  rt.anchors.register("presets.list", list.element);
  return {
    spec: { id: "presets", ...PANEL_META["presets"], element },
    update(frame) {
      const library = frame.library, draft = library.draft, busy = library.busy;
      if (draft) setValue(nameInput, draft.name);
      nameInput.disabled = busy || !draft;
      const state = libraryState(frame);
      setText(libraryChip, state.label); libraryChip.className = `chip ${state.tone}`; libraryChip.title = state.detail;
      const presets = draft?.presets ?? [];
      setText(count, String(presets.length));
      failed.hidden = !!draft || library.busy || library.progress?.phase !== "error";
      empty.hidden = !draft || presets.length > 0;
      list.update(presets.map(preset => ({ id: preset.id, name: preset.name,
        meta: preset.locked ? "Made with a newer XF Studio · kept as it is" : plural(preset.layers, "layer") })), draft?.selected, busy);
      applyCapability(addButton, port.library.capability({ kind: "preset.edit", command: { kind: "add" } }));
      const removed = draft?.removed.at(-1);
      restore.hidden = !removed;
      if (removed) setText(restore.querySelector("span")!, `Restore “${removed.name}”`);
      applyCapability(restore, port.library.capability({ kind: "preset.edit", command: { kind: "restore" } }));
      applyCapability(importRecipe, port.files.capability({ kind: "recipe.import" }));
    },
  };
}

/**
 * Opening keeps a bounded queue of browser drafts. Warn only when the next open
 * would evict the oldest recoverable draft.
 */
export function confirmReplace(rt: StudioRuntime, anchor: MenuAnchor, title: string, run: () => void) {
  // Opening and importing share one consequence: the application says what would be lost.
  const consequence = rt.port.authoring.consequences({ file: { kind: "collection.import" } });
  const oldest = consequence.discards.find(item => item.kind === "recovery-draft");
  if (!consequence.confirm || !oldest) { run(); return; }
  // A draft holding a look made with a newer version can't be saved to the library here: exporting it is how it's kept (CORE-49).
  const detail = oldest.locked
    ? `Your current draft joins the recovery queue, and its oldest draft “${oldest.label}” will be discarded. It has a look made with a newer version of XF Studio, which can't be saved to the library here, so that draft may be its only copy. Export it first to keep it.`
    : `Your current draft joins the recovery queue, and its oldest draft “${oldest.label}” will be discarded. To keep it, recover it and save it to the library first.`;
  const request = { kind: "exportCollection" as const, draft: oldest.id };
  openMenu([{ kind: "heading", label: `${title}?`, detail },
    ...(oldest.locked && oldest.id ? [{ kind: "action" as const, label: "Export collection", icon: "export" as const,
      capability: rt.port.authoring.requestCapability(request), run: () => void rt.request(request) }] : []),
    { kind: "action", label: "Continue", icon: "import", run },
    { kind: "action", label: "Recover earlier drafts", icon: "undo", capability: rt.port.files.capability({ kind: "collection.recover" }),
      run: () => void rt.file({ kind: "collection.recover" }) }],
  anchor, { label: `${title} confirmation`, invoker: anchor instanceof Element ? anchor : undefined });
}
/**
 * “Undo open/import” swaps back to the draft that was current before the request, but
 * only while that is still the recoverable draft; otherwise it would swap the wrong one.
 */
export function undoReplaceAction(rt: StudioRuntime, label: string): FeedbackAction {
  const before = rt.port.library.summary().draft?.id;
  return { label, run: () => {
    if (!before || rt.port.library.summary().draft?.previous?.id !== before) {
      rt.feedback.toast("warning", "Library", "The draft from before that change is no longer the recoverable draft. Use Recover previous draft in the Library panel if it is listed there.");
      return;
    }
    void rt.file({ kind: "collection.recover" });
  } };
}
/** Shared by the Library panel and the command palette. */
export function importCollection(rt: StudioRuntime, anchor: MenuAnchor) {
  confirmReplace(rt, anchor, "Import a collection", () => void rt.file({ kind: "collection.import" }, { actions: [undoReplaceAction(rt, "Undo import")] }));
}

export function libraryPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const save = button({ label: "Save to library", icon: "save", variant: "primary", onClick: () => void rt.request({ kind: "save" }) });
  const saveCopy = button({ label: "Save as new collection", icon: "duplicate", title: "Stores a copy with a new identity; you continue editing the copy.",
    onClick: () => void rt.request({ kind: "saveCopy" }) });
  const stateLine = h("p", { class: "state-line" });
  const progress = progressBar({ label: "Library request in progress" }).element;
  progress.hidden = true;
  const refresh = button({ label: "Refresh", icon: "refresh", small: true, variant: "quiet", onClick: () => void rt.request({ kind: "refresh" }, { quietSuccess: true }) });
  const recover = button({ label: "Recover previous draft", icon: "undo", small: true,
    onClick: () => void rt.file({ kind: "collection.recover" }) });
  const recoverNote = note("", "info");
  const saved = h("ul", { class: "saved-list", "aria-label": "Saved collections" });
  const savedEmpty = emptyState("Nothing saved yet", "Save to library keeps the first version of this collection. Drafts still autosave on this computer.");
  const fileButtons = {
    importCollection: button({ label: "Import collection…", icon: "import", small: true, onClick: event => importCollection(rt, event.currentTarget as Element) }),
    exportCollection: button({ label: "Export collection", icon: "export", small: true, onClick: () => void rt.file({ kind: "collection.export" }) }),
    exportPlan: button({ label: "Export compiler plan", icon: "export", small: true, onClick: () => void rt.file({ kind: "collection.plan" }) }),
    importRecipe: button({ label: "Import recipe as preset…", icon: "import", small: true, onClick: () => void rt.file({ kind: "recipe.import" }) }),
    exportRecipe: button({ label: "Export preset recipe", icon: "export", small: true, onClick: () => void rt.file({ kind: "recipe.export" }) }),
    exportMask: button({ label: "Export layer mask", icon: "export", small: true, onClick: () => void rt.file({ kind: "mask.export" }) }),
  };
  let savedSignature = "";
  // What the files are, in the Files heading's help tip; with research tools (UI-85) it adds what a compiler plan is.
  const filesHelp = "Collection and recipe files keep your work editable, to back it up or share it. Exporting a collection saves a version in your library first. A layer mask is a picture of the selected layer's shape.";
  const researchHelp = "Research: a compiler plan is input for the offline compiler, not a mod. Exporting one saves a version first.";
  const filesSection = section({ title: "Files", help: filesHelp }, h("div", { class: "button-grid" }, fileButtons.importCollection, fileButtons.exportCollection,
    fileButtons.exportPlan, fileButtons.importRecipe, fileButtons.exportRecipe, fileButtons.exportMask));
  const filesTip = filesSection.querySelector<HTMLElement>(".help-tip")!;
  const element = h("div", { class: "panel-content" },
    section({ title: "Local library", help: ["Saving keeps a version of this collection in your library on this computer. Edits you make while it saves stay in your draft.",
      "Your draft also saves itself on this computer as you work."] },
      stateLine, progress, h("div", { class: "row wrap gap-s" }, save, saveCopy)),
    section({ title: "Saved collections", help: "Opening one keeps your current draft: Recover previous draft brings it back." }, h("div", { class: "row between" }, h("span"), refresh),
      savedEmpty, saved, h("div", { class: "row wrap gap-s" }, recover), recoverNote),
    filesSection);
  return {
    spec: { id: "library", ...PANEL_META["library"], element },
    update(frame) {
      const library = frame.library, draft = library.draft;
      const state = libraryState(frame);
      setText(stateLine, state.detail || state.label);
      stateLine.className = `state-line ${state.tone}`;
      progress.hidden = !library.busy;
      applyCapability(save, port.authoring.requestCapability({ kind: "save" }));
      applyCapability(saveCopy, port.authoring.requestCapability({ kind: "saveCopy" }));
      applyCapability(refresh, port.authoring.requestCapability({ kind: "refresh" }));
      const recovery = frame.files.recovery;
      applyCapability(recover, recovery);
      setText(recoverNote, draft?.previous ? `Next draft: “${draft.previous.name}”${draft.previous.revision ? ` (version ${draft.previous.revision})` : ""}. ${draft.recoveryCount} of ${draft.recoveryLimit} drafts recoverable; recover again to walk through them.` : "");
      recoverNote.hidden = !draft?.previous;
      const signature = JSON.stringify([library.summaries, draft?.id, library.busy]);
      if (signature !== savedSignature) {
        savedSignature = signature;
        saved.replaceChildren(...library.summaries.map(item => {
          const current = item.id === draft?.id;
          const open = button({ label: current ? "Reopen" : "Open", small: true, variant: current ? "quiet" : undefined,
            onClick: event => confirmReplace(rt, event.currentTarget as Element, `Open “${item.name}”`,
              () => void rt.request({ kind: "open", id: item.id }, { actions: [undoReplaceAction(rt, "Undo open")] })) });
          applyCapability(open, port.authoring.requestCapability({ kind: "open", id: item.id }));
          return h("li", { class: `saved-row${current ? " current" : ""}` },
            h("div", { class: "saved-main" }, h("strong", { text: item.name }),
              h("span", { class: "muted small", text: `${plural(item.count, "preset")} · version ${item.revision} · ${new Date(item.updatedAt).toLocaleString()}` }),
              current ? badge("This draft", "info") : null),
            open);
        }));
      }
      savedEmpty.hidden = library.summaries.length > 0;
      const research = !!frame.preferences?.researchTools;
      fileButtons.exportPlan.hidden = !research; setHelp(filesTip, research ? [filesHelp, researchHelp] : filesHelp);
      for (const [key, action] of [["importCollection", "collection.import"], ["exportCollection", "collection.export"], ["exportPlan", "collection.plan"],
        ["importRecipe", "recipe.import"], ["exportRecipe", "recipe.export"], ["exportMask", "mask.export"]] as const)
        applyCapability(fileButtons[key], port.files.capability({ kind: action }));
    },
  };
}

export function packagePanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  // The game and mod manager are chosen in Settings (UI-109); here, one line says whether Build and Add are ready, with the way there.
  const showSetup = () => rt.settings.open("game");
  const setupLine = h("p", { class: "setup-status", role: "status" });
  const setup = section({ title: "Game & tools", help: "Your game folder, mod manager and WolvenKit are chosen in Settings › Game and Settings › Tools." },
    setupLine, h("div", { class: "row wrap gap-s" }, button({ label: "Open Settings", icon: "settings", small: true, onClick: showSetup })));
  const check = button({ label: "Check", icon: "check", title: "Check which presets and layers can become mod files (creates no files)", onClick: () => void runPackage("check") });
  const build = button({ label: "Build mod files…", icon: "package", variant: "primary", onClick: event => confirmBuild(event.currentTarget as Element) });
  // While the latest Build is current, its result's Add is the one primary action: Build again is a secondary one.
  const rebuild = button({ label: "Build mod files…", icon: "package", onClick: event => confirmBuild(event.currentTarget as Element) });
  // The progress line keeps its place while nothing runs, so starting or finishing work never moves the panel (UI-90).
  const progressText = h("p", { class: "progress-text" });
  const progress = h("div", { class: "package-progress idle" }, progressBar({ label: "Package request in progress" }).element, progressText);
  const result = h("div", { class: "package-result", "aria-live": "polite" });
  let resultSignature = "";
  // Which XF mods the draft builds: one by default, named after its feature; the person may rename a mod and, once the
  // collection has more than one exportable feature, move a feature into a mod of its own (feature-module platform §6).
  const mods = h("ul", { class: "result-list package-mods", "aria-label": "Mods this collection builds" });
  let modsSignature = "";
  const renameMod = (product: PackageProductSummary, anchor: Element) => {
    const make = (modName: string) => ({ kind: "package.rename" as const, productId: product.id, modName });
    openValuePopover({ kind: "text", label: "Mod name (as it appears in your mod manager)", value: product.modName, maxLength: 80 }, anchor,
      { title: "Rename mod", apply: "Rename", validate: value => port.authoring.capability(make(String(value))),
        commit: value => { if (rt.dispatch(make(String(value)))) rt.feedback.announce(`Mod renamed to ${String(value).trim() || "its default name"}`); } });
  };
  const modMenu = (product: PackageProductSummary, products: readonly PackageProductSummary[], anchor: Element) => {
    const items: MenuItem[] = [{ kind: "action", label: "Rename…", icon: "rename", run: () => renameMod(product, anchor) }];
    if (product.nameSource === "plan") items.push({ kind: "action", label: "Use the default name", icon: "reset",
      capability: port.authoring.capability({ kind: "package.rename", productId: product.id, modName: "" }),
      run: () => { rt.dispatch({ kind: "package.rename", productId: product.id, modName: "" }); } });
    // Moving features between mods is offered only where there is something to move.
    if (product.features.length > 1) for (const feature of product.features) items.push({ kind: "action", label: `Make ${feature.label.toLowerCase()} a mod of its own`,
      icon: "export", capability: port.authoring.capability({ kind: "package.split", feature: feature.id }),
      run: () => { rt.dispatch({ kind: "package.split", feature: feature.id }); } });
    for (const other of products) if (other.id !== product.id) items.push({ kind: "action", label: `Merge into “${other.modName}”`, icon: "import",
      capability: port.authoring.capability({ kind: "package.merge", productId: product.id, intoId: other.id }),
      run: () => { rt.dispatch({ kind: "package.merge", productId: product.id, intoId: other.id }); } });
    openMenu(items, anchor, { label: `${product.modName} options`, invoker: anchor });
  };
  const renderMods = (products: readonly PackageProductSummary[], planIssue?: string) => {
    const signature = JSON.stringify([products, planIssue ?? null]);
    if (signature === modsSignature) return;
    modsSignature = signature;
    // A plan made with a newer version (or damaged) is kept as it came; the service says why in plain words (CORE-91).
    if (planIssue) mods.replaceChildren(h("li", {}, icon("warning"), h("span", { text: planIssue })));
    else mods.replaceChildren(...products.map(product => h("li", {}, icon("package"),
      h("span", {}, h("strong", { text: product.modName }), h("span", { class: "muted", text: ` · ${product.features.map(feature => feature.label).join(", ")}` })),
      button({ label: `${product.modName} options`, icon: "more", iconOnly: true, variant: "ghost", small: true, menu: true,
        onClick: event => modMenu(product, products, event.currentTarget as Element) }))));
    mods.hidden = !products.length && !planIssue;
  };
  // After Build, each mod offers "Add to my mod manager…" (a reviewed plan, then consent) and "Show in folder" (UI-82). The rows
  // live outside the result card, so a repaint updates them in place.
  const installRows = new Map<string, { element: HTMLElement; add: HTMLButtonElement; show: HTMLButtonElement; line: HTMLElement }>();
  const installRow = (product: string) => {
    let row = installRows.get(product);
    if (!row) {
      const add: HTMLButtonElement = button({ label: "Add to my mod manager…", icon: "package", small: true, variant: "primary",
        onClick: () => { openModInstallSheet(rt, product, { openSetup: showSetup, rename: () => {
          // A name MO2 or the game folder can't take: rename the mod where its name is set (UI-99).
          const summary = port.library.summary().products?.find(item => item.id === product);
          if (summary) renameMod(summary, add);
        } }); } });
      const show = button({ label: "Show in folder", icon: "folder", small: true, onClick: () => void port.modInstall.dispatch({ kind: "modInstall.reveal", product })
        .then(outcome => { if (!outcome.ok) rt.feedback.toast("warning", "Mod package", outcome.message, [], { code: outcome.code }); }) });
      const line = h("p", { class: "install-line small", role: "status" });
      row = { element: h("div", { class: "install-row" }, h("div", { class: "row wrap gap-s" }, add, show), line), add, show, line };
      installRows.set(product, row);
    }
    return row;
  };
  async function runPackage(action: "check" | "build") {
    await rt.request({ kind: "package", action }, { quietSuccess: false });
  }
  function confirmBuild(anchor: Element) {
    openMenu([{ kind: "heading", label: "Build your mod files?", detail: "Uses the current draft, including unsaved edits. Takes a few minutes and can't be cancelled once started. Nothing is added to your game or mod manager until you choose to." },
      { kind: "action", label: "Build now", icon: "package", capability: buildCapability(), run: () => void runPackage("build") },
      { kind: "action", label: "Check first", icon: "check", capability: port.files.capability({ kind: "package.check" }), run: () => void runPackage("check") }],
    anchor, { label: "Confirm build", invoker: anchor });
  }
  // Build readiness (including the host's Build setup) is part of the file capability.
  const buildCapability = () => port.files.capability({ kind: "package.build" });
  const finishList = h("ul", { class: "finish-status" }, rt.finishes.map(finish => h("li", {},
    h("span", { text: finish.label }), badge(finish.exportAdapter === "none" ? "Preview only" : finish.exportAdapter === "experimental" ? "Experimental" : "Can be built",
      finish.exportAdapter === "flat-provisional" ? "success" : "warning"))));
  const element = h("div", { class: "panel-content" },
    section({ title: "Mod package", help: [`Builds your own copy of your XF mods from your current draft, unsaved edits included.`,
      `Eye makeup becomes ${EYE_MAKEUP_MOD.modName}: each preset is one choice in the character creator's “${EYE_MAKEUP_MOD.selectorLabel}” selector.`] },
      // Check, then the primary Build last; the progress takes the rest of the same row (one line, reserved), so it adds no band.
      mods, h("div", { class: "row gap-s package-actions" }, check, build, rebuild, progress)),
    result,
    setup,
    section({ title: "What can be packaged", help: ["Check decides what is built; this list is a guide.",
      "Preview-only layers are left out and named in the result. Experimental finishes may look different in game."] }, finishList));
  rt.anchors.register("package.check", check);
  return {
    spec: { id: "package", ...PANEL_META["package"], element },
    update(frame) {
      const files = frame.files, library = frame.library;
      applyCapability(check, port.files.capability({ kind: "package.check" }));
      applyCapability(build, buildCapability());
      applyCapability(rebuild, buildCapability());
      const builtCurrent = files.package?.kind === "packageBuild" && files.package.freshness === "current";
      build.hidden = builtCurrent; rebuild.hidden = !builtCurrent;
      renderMods(frame.library.products ?? [], frame.library.packagePlanIssue);
      const line = setupStatus(frame);
      setText(setupLine, line.text); setupLine.className = `setup-status ${line.tone}`;
      const working = library.busy && library.progress?.code === "package";
      progress.classList.toggle("idle", !working);
      setText(progressText, working ? library.progress!.message : "");
      progressText.title = progressText.textContent ?? "";
      const lastError = files.last && !files.last.ok && (files.last.kind === "package.check" || files.last.kind === "package.build") ? files.last : undefined;
      const signature = JSON.stringify([files.package, lastError, library.draft?.presets.map(p => [p.id, p.name])]);
      if (signature !== resultSignature) {
        resultSignature = signature;
        const pkg = files.package;
        result.replaceChildren(pkg ? renderResult(pkg, library.draft?.presets ?? [], installRow, showSetup) : lastError ? failureCard(rt, lastError)
          : emptyState("No check yet", "Run Check to see which presets and layers can become mod files. Check creates no files."));
      }
      // The install rows follow every paint: availability, and what happened last.
      const installs = frame.modInstall, route = frame.localSetup.view?.fields.launchRoute;
      for (const [product, row] of installRows) {
        setText(row.add.querySelector("span")!, modInstallLabel(route));
        applyCapability(row.add, port.modInstall.capability({ kind: "modInstall.review", product }));
        applyCapability(row.show, port.modInstall.capability({ kind: "modInstall.reveal", product }));
        const outcome = installs.outcomes[product];
        setText(row.line, outcome?.message ?? "");
        row.line.className = `install-line small${outcome ? outcome.ok ? " done" : " warning" : ""}`;
      }
      const buildNext = result.querySelector<HTMLElement>("[data-build-next]");
      const built = files.package?.kind === "packageBuild" ? files.package.result.products.map(product => product.productId) : [];
      if (buildNext) buildNext.hidden = built.length > 0 && built.every(product => installs.outcomes[product]?.ok);
    },
  };
}

/**
 * A failed Check or Build (UI-94): what failed in plain words, that the collection is unchanged, and "Report this problem" with
 * the failure's reference when it wasn't an ordinary refusal. The code and time stay in Details for the report.
 */
function failureCard(rt: StudioRuntime, failed: ReadonlyDeep<{ kind: string; code: string; message: string; at: number }>) {
  const build = failed.kind === "package.build";
  const expected = rt.port.diagnostics.expected(failed.code);
  const report = button({ label: "Report this problem", icon: "warning", small: true, onClick: () => { openReportDialog(rt, null); } });
  applyCapability(report, rt.port.diagnostics.capability({ kind: "diagnostics.prepareReport" }));
  return h("div", { class: "result-card error" }, icon(expected ? "warning" : "error"),
    h("div", {}, h("strong", { text: build ? "Build didn't finish" : "Check didn't finish" }), h("p", { text: failed.message }),
      h("p", { class: "muted small", text: "Your collection is unchanged." }),
      expected ? null : h("div", { class: "row wrap gap-s" }, report),
      technicalDetails([["Code", failed.code], ["Time", new Date(failed.at).toLocaleString()]])));
}

/** A collapsed "Details" block with a Copy button: codes, hashes and paths for bug reports. */
function technicalDetails(rows: [string, string][], footnote?: string) {
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const copy = button({ label: "Copy details", icon: "duplicate", small: true, variant: "quiet", onClick: () => {
    void navigator.clipboard?.writeText(text).then(() => setText(copy.querySelector("span")!, "Copied"), () => {});
  } });
  return h("details", { class: "result-details" }, h("summary", { text: "Details" }),
    h("dl", { class: "facts" }, ...rows.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", {}, h("code", { class: "hash", text: value }))])),
    footnote ? h("p", { class: "muted small", text: footnote }) : null, copy);
}

type PackageResultView = ReadonlyDeep<{ kind: "packageCheck"; result: PackageCheckResult; freshness: "current" | "stale" } |
  { kind: "packageBuild"; result: PackageBuildResult; freshness: "current" | "stale" }>;
function renderResult(pkg: PackageResultView, presets: readonly { id: string; name: string }[],
  installRow: (product: string) => { element: HTMLElement }, openSetup: () => void) {
  const name = (id: string) => presets.find(preset => preset.id === id)?.name ?? "Preset no longer in draft";
  const isBuild = pkg.kind === "packageBuild";
  const r = pkg.result;
  const retained = new Set(r.products.flatMap(product => product.features.flatMap(feature => feature.presets.map(look => look.id)))).size;
  const card = h("div", { class: `result-card ${pkg.freshness === "stale" ? "stale" : "ok"}` },
    h("div", { class: "result-head" }, h("strong", { text: isBuild ? "Build result" : "Check result" }),
      pkg.freshness === "current" ? badge("Current", "success") : badge("Stale — draft changed since", "warning")),
    h("p", { class: "result-summary", text: `${retained} of ${r.originalPresetCount} preset${r.originalPresetCount === 1 ? "" : "s"} can become mod files.${isBuild ? "" : " This check created no files."}` }));
  // One block per mod the collection builds (one by default); each feature in it has its own selector.
  for (const product of r.products) {
    // The product line says whom each feature's part is for when the feature says (eye makeup: a feminine and a masculine V).
    const block = h("div", { class: "result-product" }, h("p", { class: "muted small" }, "Mod ", h("strong", { text: product.modName }),
      product.features.map(feature => ` · ${feature.label} in the “${feature.selectorLabel}” selector${feature.audience ? `, ${feature.audience}` : ""}`).join("")));
    // The game's own names for the looks (appearance IDs) are in Details, not the list (UI-85).
    if (!isBuild) block.append(h("ul", { class: "result-list" }, product.features.flatMap(feature => feature.presets.map(preset =>
      h("li", {}, icon("check"), h("span", { text: name(preset.id) }))))));
    // A built mod is added to the mod manager, or its folder shown, from here; its path is in Details (UI-82).
    if (isBuild) block.append(installRow(product.productId).element);
    card.append(block);
    // What the mod falls short of (eye makeup: not for a masculine V this time): one warning each, the reason and the step,
    // directly under its product and above the build note, with the button that takes the step.
    for (const warning of new Set(product.features.flatMap(feature => feature.warnings ?? []))) {
      card.append(note(warning.text, "warning"));
      if (warning.next === "settings.game") card.append(h("div", { class: "row wrap gap-s" },
        button({ label: "Open Settings", icon: "settings", small: true, onClick: openSetup })));
    }
  }
  // e.g. before any plate was prepared for this route, Check cannot tell which looks reach the eye area; Build does. A Build's
  // notes say what the mod is not made for (a masculine V, when his eye plate couldn't be prepared).
  for (const text of new Set(r.products.flatMap(product => product.features.flatMap(feature => feature.notes)))) card.append(note(text, "info"));
  // Each omission once: whole looks, parts and features (the host decided them), then each feature's own, labelled with
  // its feature when several features export (PIPE-88; the same order as `resultOmissions` in the export contract).
  const features = r.products.flatMap(product => product.features), several = new Set(features.map(feature => feature.feature)).size > 1;
  const omissions = [...r.omissions.map(omission => ({ omission, label: undefined as string | undefined })),
    ...features.flatMap(feature => feature.omissions.map(omission => ({ omission, label: several ? feature.label : undefined })))];
  if (omissions.length) card.append(h("div", { class: "omissions" }, h("span", { class: "eyebrow", text: "Omitted from the package" }),
    h("ul", { class: "result-list" }, omissions.map(({ omission: item, label }) => h("li", {}, icon("warning"),
      h("span", { text: item.kind === "layer" ? `${label ? `${label} layer` : "Layer"} “${item.layerName}” in “${item.presetName}” — ${item.reason}` :
        item.kind === "part" ? `The ${item.feature} part of “${item.presetName}” — ${item.reason}` :
        item.kind === "feature" ? `${item.label} — ${item.reason}` :
        label ? `${label} of “${item.presetName}” — ${item.reason}` :
        `Whole preset “${item.presetName}” — ${item.reason}` }))))));
  // The next step until every mod is added (hidden then: each install line says where its mod is).
  if (isBuild) {
    const next = note(r.products.length === 1 ? "Add it to your mod manager, or show its folder to copy it by hand."
      : "Add them to your mod manager, or show their folders to copy them by hand.", "info");
    next.dataset.buildNext = "";
    card.append(next);
  }
  // Technical facts stay available for bug reports without crowding the result.
  card.append(technicalDetails([
    ...(isBuild ? (r as ReadonlyDeep<PackageBuildResult>).products.flatMap(product => [[`${product.modName} files`, product.package],
      [`${product.modName} manifest`, product.manifest],
      [`${product.modName} archive SHA-256`, product.archiveSha256]] as [string, string][]) : []),
    ...(!isBuild ? r.products.flatMap(product => product.features.flatMap(feature => feature.presets.map(preset =>
      [`“${name(preset.id)}” in game`, String(preset.appearance ?? "")] as [string, string]))) : []),
    ["Collection fingerprint (SHA-256)", r.collectionSha256],
    ...r.products.flatMap(product => product.features.map(feature => [`${feature.label} fingerprint (SHA-256)`, feature.packagedSha256] as [string, string]))]));
  if (pkg.freshness === "stale") card.append(note("Your draft changed after this result. Run Check again.", "warning"));
  setAttr(card, "data-freshness", pkg.freshness);
  return card;
}
