import type { PackageBuild, PackageCheck } from "../../package-action";
import type { ReadonlyDeep } from "../../read-only";
import { applyCapability, badge, button, emptyState, note, section } from "../controls";
import { h, setAttr, setText, setValue } from "../dom";
import type { PanelSpec } from "../dock/dock-view";
import { icon } from "../icons";
import { ItemList } from "../item-list";
import { openMenu } from "../menu";
import type { Frame, StudioRuntime } from "../runtime";
import { collectionMenu, presetMenu } from "../target-menus";

import { PANEL_META } from "../panel-meta";

export type PanelController = { spec: PanelSpec; update(frame: Frame): void };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Library facts derived only from the draft summary and saved list; nothing is guessed. */
export function libraryState(frame: Frame) {
  const library = frame.library, draft = library.draft;
  if (!draft) return { tone: "neutral" as const, label: "Loading library…", detail: "" };
  const stored = library.summaries.find(item => item.id === draft.id);
  if (library.busy && library.progress?.phase === "working") return { tone: "info" as const, label: "Working…", detail: library.progress.message };
  if (draft.revision === undefined) return { tone: "warning" as const, label: "Not in library",
    detail: "This collection has never been saved to the local library. Your draft autosaves in this browser." };
  if (stored && stored.revision > draft.revision) return { tone: "warning" as const, label: `Newer r${stored.revision} saved`,
    detail: `Your draft is based on revision ${draft.revision}; the library has revision ${stored.revision} from elsewhere. Saving will report a conflict — save a copy or reopen it.` };
  return { tone: "neutral" as const, label: `Based on r${draft.revision}`,
    detail: `Draft based on library revision ${draft.revision}. Edits since then are autosaved in this browser; Save to library records a new immutable revision.` };
}

export function presetsPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const nameInput = h("input", { class: "field title-field", type: "text", maxlength: "120", "aria-label": "Collection name", spellcheck: "false" });
  const commitName = () => {
    const current = port.library.summary().draft?.name;
    if (!current || nameInput.value.trim() === current) { nameInput.value = current ?? ""; return; }
    if (!rt.dispatch({ kind: "collection.rename", name: nameInput.value })) nameInput.value = current;
  };
  nameInput.addEventListener("change", commitName);
  nameInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitName(); nameInput.blur(); }
    if (event.key === "Escape") { nameInput.value = port.library.summary().draft?.name ?? ""; nameInput.blur(); } });
  const libraryChip = h("span", { class: "chip" });
  const collectionMore = button({ label: "Collection actions", icon: "more", iconOnly: true, variant: "ghost",
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
        button({ label: `More actions for ${item.name}`, icon: "more", iconOnly: true, variant: "ghost", small: true,
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
  const empty = emptyState("No presets yet", "A preset is one complete look — one choice in the in-game selector.",
    button({ label: "Add preset", icon: "plus", variant: "primary", onClick: () => rt.dispatch({ kind: "preset.edit", command: { kind: "add" } }) }));
  const element = h("div", { class: "panel-content" },
    h("div", { class: "panel-head" }, h("label", { class: "eyebrow", text: "Collection" }), h("div", { class: "row" }, nameInput, collectionMore),
      h("div", { class: "row wrap gap-s" }, libraryChip)),
    h("div", { class: "list-head" }, h("span", { class: "eyebrow" }, "Presets ", count), addButton),
    empty, list.element,
    h("div", { class: "row wrap gap-s panel-foot" }, restore, importRecipe),
    note("Each preset becomes one choice in the game's single eye-makeup selector, alongside Off."));
  nameInput.addEventListener("contextmenu", event => event.stopPropagation());
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
      empty.hidden = !draft || presets.length > 0;
      list.update(presets.map(preset => ({ id: preset.id, name: preset.name, meta: plural(preset.layers, "layer") })), draft?.selected, busy);
      applyCapability(addButton, port.library.capability({ kind: "preset.edit", command: { kind: "add" } }));
      const removed = draft?.removed.at(-1);
      restore.hidden = !removed;
      if (removed) setText(restore.querySelector("span")!, `Restore “${removed.name}”`);
      applyCapability(restore, port.library.capability({ kind: "preset.edit", command: { kind: "restore" } }));
      applyCapability(importRecipe, port.files.capability({ kind: "recipe.import" }));
    },
  };
}

export function libraryPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const save = button({ label: "Save to library", icon: "save", variant: "primary", onClick: () => void rt.request({ kind: "save" }) });
  const saveCopy = button({ label: "Save a copy", icon: "duplicate", onClick: () => void rt.request({ kind: "saveCopy" }) });
  const stateLine = h("p", { class: "state-line" });
  const progress = h("div", { class: "progress indeterminate", hidden: true, role: "progressbar", "aria-label": "Library request in progress" });
  const refresh = button({ label: "Refresh", icon: "refresh", small: true, variant: "quiet", onClick: () => void rt.request({ kind: "refresh" }, { quietSuccess: true }) });
  const recover = button({ label: "Recover previous draft", icon: "undo", small: true,
    onClick: () => void rt.file({ kind: "collection.recover" }) });
  const recoverNote = note("", "info");
  const saved = h("ul", { class: "saved-list", "aria-label": "Saved collections" });
  const savedEmpty = emptyState("Nothing saved yet", "Save to library creates revision 1 of this collection. Drafts still autosave in this browser.");
  const fileButtons = {
    importCollection: button({ label: "Import collection…", icon: "import", small: true, onClick: () => void rt.file({ kind: "collection.import" }) }),
    exportCollection: button({ label: "Export collection", icon: "export", small: true, onClick: () => void rt.file({ kind: "collection.export" }) }),
    exportPlan: button({ label: "Export build plan", icon: "export", small: true, onClick: () => void rt.file({ kind: "collection.plan" }) }),
    importRecipe: button({ label: "Import recipe as preset…", icon: "import", small: true, onClick: () => void rt.file({ kind: "recipe.import" }) }),
    exportRecipe: button({ label: "Export preset recipe", icon: "export", small: true, onClick: () => void rt.file({ kind: "recipe.export" }) }),
    exportMask: button({ label: "Export layer mask", icon: "export", small: true, onClick: () => void rt.file({ kind: "mask.export" }) }),
  };
  let savedSignature = "";
  const element = h("div", { class: "panel-content" },
    section("Local library", stateLine, progress, h("div", { class: "row wrap gap-s" }, save, saveCopy),
      note("Saving records an immutable revision in the local SQLite library. Edits made while a save runs stay in your draft.")),
    section("Saved collections", h("div", { class: "row between" }, h("span", { class: "muted small", text: "Opening keeps your current draft recoverable." }), refresh),
      savedEmpty, saved, h("div", { class: "row wrap gap-s" }, recover), recoverNote),
    section("Files", h("div", { class: "button-grid" }, fileButtons.importCollection, fileButtons.exportCollection, fileButtons.exportPlan,
      fileButtons.importRecipe, fileButtons.exportRecipe, fileButtons.exportMask),
    note("Collection and recipe files keep editable work. Exporting a collection or build plan saves a library revision first. A build plan is compiler input, not a mod. Masks are 2048² white + alpha PNGs of the selected layer.")));
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
      setText(recoverNote, draft?.previous ? `Previous draft: “${draft.previous.name}”${draft.previous.revision ? ` (r${draft.previous.revision})` : ""}. Recover swaps it back; the current draft becomes recoverable in turn.` : "");
      recoverNote.hidden = !draft?.previous;
      const signature = JSON.stringify([library.summaries, draft?.id, library.busy]);
      if (signature !== savedSignature) {
        savedSignature = signature;
        saved.replaceChildren(...library.summaries.map(item => {
          const current = item.id === draft?.id;
          const open = button({ label: current ? "Reopen" : "Open", small: true, variant: current ? "quiet" : undefined,
            onClick: () => void rt.request({ kind: "open", id: item.id }, { actions: [{ label: "Undo open", run: () => void rt.file({ kind: "collection.recover" }) }] }) });
          applyCapability(open, port.authoring.requestCapability({ kind: "open", id: item.id }));
          return h("li", { class: `saved-row${current ? " current" : ""}` },
            h("div", { class: "saved-main" }, h("strong", { text: item.name }),
              h("span", { class: "muted small", text: `${plural(item.count, "preset")} · r${item.revision} · ${new Date(item.updatedAt).toLocaleString()}` }),
              current ? badge("This draft", "info") : null),
            open);
        }));
      }
      savedEmpty.hidden = library.summaries.length > 0;
      for (const [key, action] of [["importCollection", "collection.import"], ["exportCollection", "collection.export"], ["exportPlan", "collection.plan"],
        ["importRecipe", "recipe.import"], ["exportRecipe", "recipe.export"], ["exportMask", "mask.export"]] as const)
        applyCapability(fileButtons[key], port.files.capability({ kind: action }));
    },
  };
}

export function packagePanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const check = button({ label: "Check mod export", icon: "check", onClick: () => void runPackage("check") });
  const build = button({ label: "Build mod files…", icon: "package", variant: "primary", onClick: event => confirmBuild(event.currentTarget as Element) });
  const progress = h("div", { class: "package-progress", hidden: true },
    h("div", { class: "progress indeterminate", role: "progressbar", "aria-label": "Package request in progress" }),
    h("p", { class: "progress-text" }), note("A started build cannot be cancelled here. Closing the page does not stop it.", "warning"));
  const result = h("div", { class: "package-result", "aria-live": "polite" });
  let resultSignature = "";
  async function runPackage(action: "check" | "build") {
    await rt.request({ kind: "package", action }, { quietSuccess: false });
  }
  function confirmBuild(anchor: Element) {
    openMenu([{ kind: "heading", label: "Build local mod files?", detail: "Uses the current draft, including unsaved edits. Several minutes; cannot be cancelled once started. Nothing is installed." },
      { kind: "action", label: "Build now", icon: "package", capability: port.files.capability({ kind: "package.build" }), run: () => void runPackage("build") },
      { kind: "action", label: "Check first", icon: "check", capability: port.files.capability({ kind: "package.check" }), run: () => void runPackage("check") }],
    anchor, { label: "Confirm build", invoker: anchor });
  }
  const element = h("div", { class: "panel-content" },
    section("Mod package", note("Creates private Cyberpunk mod files for ONE in-game eye-makeup selector (plus Off) from the current draft, including unsaved edits. Your collection and library revisions are never changed."),
      h("div", { class: "row wrap gap-s" }, check, build), progress),
    result,
    section("What can be packaged", h("ul", { class: "finish-status" }, rt.finishes.map(finish => h("li", {},
      h("span", { text: finish.label }), badge(finish.exportAdapter === "none" ? "Preview study" : "Flat adapter", finish.exportAdapter === "none" ? "warning" : "success")))),
    note("Active layers with preview-study finishes are omitted and named in the result; a preset left with nothing exportable is omitted whole. Check decides — this list is informational.")));
  return {
    spec: { id: "package", ...PANEL_META["package"], element },
    update(frame) {
      const files = frame.files, library = frame.library;
      applyCapability(check, port.files.capability({ kind: "package.check" }));
      applyCapability(build, port.files.capability({ kind: "package.build" }));
      const working = library.busy && library.progress?.code === "package";
      progress.hidden = !working;
      if (working) setText(progress.querySelector(".progress-text")!, library.progress!.message);
      const lastError = files.last && !files.last.ok && (files.last.kind === "package.check" || files.last.kind === "package.build") ? files.last : undefined;
      const signature = JSON.stringify([files.package, lastError, library.draft?.presets.map(p => [p.id, p.name])]);
      if (signature === resultSignature) return;
      resultSignature = signature;
      const pkg = files.package;
      if (!pkg && !lastError) { result.replaceChildren(emptyState("No check yet", "Run Check to see which presets and layers can become mod files. Check creates no files.")); return; }
      if (lastError && !pkg) { result.replaceChildren(h("div", { class: "result-card error" }, icon("error"),
        h("div", {}, h("strong", { text: lastError.kind === "package.build" ? "Build failed" : "Check failed" }), h("p", { text: lastError.message }),
          h("p", { class: "muted small", text: `Code: ${lastError.code}. Your collection is unchanged.` })))); return; }
      result.replaceChildren(renderResult(pkg!, library.draft?.presets ?? []));
    },
  };
}

type PackageResultView = ReadonlyDeep<{ kind: "packageCheck"; result: PackageCheck; freshness: "current" | "stale" } |
  { kind: "packageBuild"; result: PackageBuild; freshness: "current" | "stale" }>;
function renderResult(pkg: PackageResultView, presets: readonly { id: string; name: string }[]) {
  const name = (id: string) => presets.find(preset => preset.id === id)?.name ?? "Preset no longer in draft";
  const isBuild = pkg.kind === "packageBuild";
  const r = pkg.result;
  const build = r as ReadonlyDeep<PackageBuild>, check = r as ReadonlyDeep<PackageCheck>;
  const retained = isBuild ? build.presetCount : check.presets.length;
  const card = h("div", { class: `result-card ${pkg.freshness === "stale" ? "stale" : "ok"}` },
    h("div", { class: "result-head" }, h("strong", { text: isBuild ? "Build result" : "Check result" }),
      pkg.freshness === "current" ? badge("Current", "success") : badge("Stale — draft changed since", "warning")),
    h("p", { class: "result-summary", text: `${retained} of ${r.originalPresetCount} preset${r.originalPresetCount === 1 ? "" : "s"} can become mod files.${isBuild ? "" : " This check created no files."}` }));
  if (!isBuild) card.append(h("ul", { class: "result-list" }, check.presets.map(preset =>
    h("li", {}, icon("check"), h("span", { text: name(preset.id) }), h("code", { class: "muted", text: preset.appearance })))));
  if (r.omissions.length) card.append(h("div", { class: "omissions" }, h("span", { class: "eyebrow", text: "Omitted from the package" }),
    h("ul", { class: "result-list" }, r.omissions.map(item => h("li", {}, icon("warning"),
      h("span", { text: item.kind === "layer" ? `Layer “${item.layerName}” in “${item.presetName}” — ${item.reason}` : `Whole preset “${item.presetName}” — ${item.reason}` }))))));
  if (isBuild) {
    const b = build;
    card.append(h("dl", { class: "facts" },
      h("dt", { text: "Package" }), h("dd", {}, h("code", { text: b.package })),
      h("dt", { text: "Manifest" }), h("dd", {}, h("code", { text: b.manifest })),
      h("dt", { text: "Archive SHA-256" }), h("dd", {}, h("code", { class: "hash", text: b.archiveSha256 }))),
    h("div", { class: "row wrap gap-s" }, badge("Not installed", "neutral"), badge("Not game-tested", "warning"), badge("Offline verified", "success")));
  }
  card.append(h("p", { class: "muted small" }, "Packaged collection SHA-256 ", h("code", { class: "hash", text: r.packagedCollectionSha256 })));
  if (pkg.freshness === "stale") card.append(note("This result describes an earlier snapshot of the draft. Run Check again before relying on it.", "warning"));
  setAttr(card, "data-freshness", pkg.freshness);
  return card;
}
