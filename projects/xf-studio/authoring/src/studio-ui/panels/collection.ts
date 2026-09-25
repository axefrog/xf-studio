import type { PackageBuild, PackageCheck } from "../../package-action";
import type { LocalSetupFields } from "../../local-settings-server";
import { EYE_MAKEUP_MOD } from "../../mod-branding";
import type { ReadonlyDeep } from "../../read-only";
import { applyCapability, badge, button, emptyState, note, section } from "../controls";
import { h, setAttr, setText, setValue } from "../dom";
import type { PanelSpec } from "../dock/dock-view";
import { icon } from "../icons";
import { ItemList } from "../item-list";
import { openMenu, type MenuAnchor } from "../menu";
import type { FeedbackAction } from "../feedback";
import type { Frame, StudioRuntime } from "../runtime";
import { collectionMenu, presetMenu } from "../target-menus";

import { PANEL_META } from "../panel-meta";

export type PanelController = { spec: PanelSpec; update(frame: Frame): void;
  /** Mod package only: open Game & tools and put focus on the first field to fill in. */
  showSetup?(): void };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Library facts derived only from the draft summary and saved list; nothing is guessed. */
export function libraryState(frame: Frame) {
  const library = frame.library, draft = library.draft;
  if (!draft) return { tone: "neutral" as const, label: "Loading library…", detail: "" };
  const stored = library.summaries.find(item => item.id === draft.id);
  if (library.busy && library.progress?.phase === "working") return { tone: "info" as const, label: "Working…", detail: library.progress.message };
  // Plain chip labels; version numbers live in the tooltip/detail line.
  if (draft.revision === undefined) return { tone: "warning" as const, label: "Not saved yet",
    detail: "This collection hasn't been saved to your library yet. Your draft autosaves on this computer; Save to library keeps a version you can return to." };
  if (stored && stored.revision > draft.revision) return { tone: "warning" as const, label: "Newer version saved",
    detail: `Your library has a newer version of this collection (version ${stored.revision}) saved elsewhere; your draft started from version ${draft.revision}. Saving will report a conflict — save a copy or reopen it.` };
  const persistence = frame.persistence;
  if (persistence?.baseline === "known" && !persistence.dirty) return { tone: "neutral" as const, label: "Saved",
    detail: `Matches version ${draft.revision} in your library.` };
  if (persistence?.baseline === "known") {
    const presets = persistence.dirtyPresets.length;
    const what = [persistence.structureDirty ? "the collection name or preset order" : "",
      presets ? `${presets} ${presets === 1 ? "preset" : "presets"}` : ""].filter(Boolean).join(" and ");
    return { tone: "info" as const, label: "Unsaved changes",
      detail: `Last saved as version ${draft.revision} in your library; saving creates version ${draft.revision + 1}. Changed since then: ${what}. Your draft autosaves on this computer.` };
  }
  return { tone: "neutral" as const, label: "Autosaved draft",
    detail: `Started from version ${draft.revision} in your library. Your draft autosaves on this computer; Save to library keeps a new version.` };
}

export function presetsPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const nameInput = h("input", { class: "field title-field", type: "text", maxlength: "120", "aria-label": "Collection name", spellcheck: "false" });
  const commitName = () => {
    const current = port.library.summary().draft?.name;
    if (!current || nameInput.value.trim() === current) { nameInput.value = current ?? ""; return; }
    if (!nameInput.value.trim()) { rt.feedback.toast("warning", "Presets", "A collection needs a name; the previous name was kept."); nameInput.value = current; return; }
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
  const failed = emptyState("Library unavailable", "The local library could not be read. Your draft layers are still editable; retry once the studio server is running.",
    button({ label: "Retry", icon: "refresh", onClick: () => void rt.request({ kind: "initialize" }) }));
  const empty = emptyState("No presets yet", "A preset is one complete look — one choice in the in-game selector.",
    button({ label: "Add preset", icon: "plus", variant: "primary", onClick: () => rt.dispatch({ kind: "preset.edit", command: { kind: "add" } }) }));
  const element = h("div", { class: "panel-content" },
    h("div", { class: "panel-head" }, h("label", { class: "eyebrow", text: "Collection" }), h("div", { class: "row" }, nameInput, collectionMore),
      h("div", { class: "row wrap gap-s" }, libraryChip)),
    h("div", { class: "list-head" }, h("span", { class: "eyebrow" }, "Presets ", count), addButton),
    failed, empty, list.element,
    h("div", { class: "row wrap gap-s panel-foot" }, restore, importRecipe),
    note("Each preset becomes one choice in the game's single eye-makeup selector, alongside Off."));
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
  openMenu([{ kind: "heading", label: `${title}?`, detail: `Your current draft joins the recovery queue, and its oldest draft “${oldest.label}” will be discarded. To keep it, recover it and save it to the library first.` },
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
  const progress = h("div", { class: "progress indeterminate", hidden: true, role: "progressbar", "aria-label": "Library request in progress" });
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
  const element = h("div", { class: "panel-content" },
    section("Local library", stateLine, progress, h("div", { class: "row wrap gap-s" }, save, saveCopy),
      note("Saving records an immutable revision in the local SQLite library. Edits made while a save runs stay in your draft.")),
    section("Saved collections", h("div", { class: "row between" }, h("span", { class: "muted small", text: "Opening keeps your current draft recoverable." }), refresh),
      savedEmpty, saved, h("div", { class: "row wrap gap-s" }, recover), recoverNote),
    section("Files", h("div", { class: "button-grid" }, fileButtons.importCollection, fileButtons.exportCollection, fileButtons.exportPlan,
      fileButtons.importRecipe, fileButtons.exportRecipe, fileButtons.exportMask),
    note("Collection and recipe files keep editable work. Exporting a collection or compiler plan saves a library revision first. A compiler plan is input for the offline compiler, not a mod. Masks are 2048² white + alpha PNGs of the selected layer.")));
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
      for (const [key, action] of [["importCollection", "collection.import"], ["exportCollection", "collection.export"], ["exportPlan", "collection.plan"],
        ["importRecipe", "recipe.import"], ["exportRecipe", "recipe.export"], ["exportMask", "mask.export"]] as const)
        applyCapability(fileButtons[key], port.files.capability({ kind: action }));
    },
  };
}

export function packagePanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  // Paths a person may need to type. The Bun runtime is XF Studio's own and has no field.
  const setupFields = [
    ["gameRoot", "Cyberpunk 2077 folder"],
    ["wolvenKitCli", "Your own WolvenKit (optional)"],
    ["mo2Root", "MO2 instance folder"],
    ["mo2ProfileId", "MO2 profile name"], ["manualModRoot", "Additional direct mod folder (optional)"],
  ] as const;
  type SetupField = typeof setupFields[number][0];
  const hints: Partial<Record<SetupField, string>> = {
    wolvenKitCli: "Leave this empty and XF Studio can download WolvenKit for you.",
  };
  const inputs = Object.fromEntries(setupFields.map(([key, label]) => [key,
    h("input", { class: "field", type: "text", "aria-label": label, spellcheck: "false", oninput: () => { dirty = true; } })])) as Record<SetupField, HTMLInputElement>;
  const field = (key: SetupField) => h("label", { class: "control" },
    h("span", { class: "control-label", text: setupFields.find(([name]) => name === key)![1] }), inputs[key],
    hints[key] ? h("span", { class: "control-help", text: hints[key] }) : null);
  const route = h("select", { class: "field", "aria-label": "How you install mods", onchange: () => { dirty = true; showRoute(); } },
    h("option", { value: "direct", text: "Game folder (Vortex or manual)" }), h("option", { value: "mo2", text: "Mod Organizer 2" }));
  // Build normally cuts the eye plate from the head your mods load; this is the way round an unsupported head mod.
  // The host's setup view names the choice and its options, so this form and Build's messages agree.
  const plateHead = h("select", { class: "field", onchange: () => { dirty = true; } });
  const plateHeadLabel = h("span", { class: "control-label" });
  let dirty = false, loadedRevision = -1;
  const mo2Fields = h("div", {}, field("mo2Root"), field("mo2ProfileId"));
  const directFields = h("div", {}, field("manualModRoot"));
  const showRoute = () => { mo2Fields.hidden = route.value !== "mo2"; directFields.hidden = route.value !== "direct"; };
  const setupState = note("Loading your settings…");
  const setupReadiness = note("");
  const saveSetup = button({ label: "Save settings", icon: "check", onClick: () => void (async () => {
    const fields: Partial<LocalSetupFields> = { launchRoute: route.value as LocalSetupFields["launchRoute"],
      eyePlateHead: plateHead.value as LocalSetupFields["eyePlateHead"] };
    for (const [key] of setupFields) fields[key] = inputs[key].value.trim() || null;
    const result = await port.localSetup.dispatch({ kind: "setup.update", fields });
    if (result.ok) { dirty = false; rt.feedback.toast("success", "Game & tools", "Settings saved on this computer."); }
    else rt.feedback.toast("error", "Game & tools", result.message);
  })() });
  const restoreSetup = button({ label: "Restore previous settings", onClick: () => void (async () => {
    const result = await port.localSetup.dispatch({ kind: "setup.restorePrevious" });
    if (result.ok) { dirty = false; rt.feedback.toast("success", "Game & tools", "Previous settings restored."); }
    else rt.feedback.toast("error", "Game & tools", result.message);
  })() });
  const refreshSetup = button({ label: "Reload settings", onClick: event => {
    const reload = () => void (async () => {
      const result = await port.localSetup.dispatch({ kind: "setup.refresh" });
      if (result.ok) { dirty = false; loadedRevision = -1; }
      else rt.feedback.toast("error", "Game & tools", result.message);
    })();
    if (!dirty) { reload(); return; }
    const anchor = event.currentTarget as Element;
    openMenu([{ kind: "heading", label: "Discard unsaved changes to these settings?" },
      { kind: "action", label: "Reload saved settings", run: reload }], anchor,
    { label: "Reload saved settings", invoker: anchor });
  } });
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
      { kind: "action", label: "Build now", icon: "package", capability: buildCapability(), run: () => void runPackage("build") },
      { kind: "action", label: "Check first", icon: "check", capability: port.files.capability({ kind: "package.check" }), run: () => void runPackage("check") }],
    anchor, { label: "Confirm build", invoker: anchor });
  }
  // Build readiness (including the host's Build setup) is part of the file capability.
  const buildCapability = () => port.files.capability({ kind: "package.build" });
  const setupSection = h("details", { class: "section" }, h("summary", { text: "Game & tools" }),
    note("Saved on this computer only. XF Studio finds your game and sets up WolvenKit for you; fill these in only to change what it chose."),
    h("label", { class: "control" }, h("span", { class: "control-label", text: "How you install mods" }), route),
    field("gameRoot"), field("wolvenKitCli"), mo2Fields, directFields,
    h("label", { class: "control" }, plateHeadLabel, plateHead),
    setupState, setupReadiness,
    h("div", { class: "row wrap gap-s" }, saveSetup, refreshSetup, restoreSetup));
  const element = h("div", { class: "panel-content" },
    section("Mod package", note(`Builds your own copy of ${EYE_MAKEUP_MOD.modName}, the eye-makeup mod, from the current draft (including unsaved edits). Each preset becomes one choice in the character creator's “${EYE_MAKEUP_MOD.selectorLabel}” selector, alongside Off. Your collection and library are never changed.`),
      h("div", { class: "row wrap gap-s" }, check, build), progress),
    result,
    setupSection,
    section("What can be packaged", h("ul", { class: "finish-status" }, rt.finishes.map(finish => h("li", {},
      h("span", { text: finish.label }), badge(finish.exportAdapter === "none" ? "Preview only" : finish.exportAdapter === "experimental" ? "Experimental" : "Can be built",
        finish.exportAdapter === "flat-provisional" ? "success" : "warning")))),
    note("Layers with preview-only finishes are left out and named in the result; a preset with nothing left to build is left out whole. Experimental finishes are built from the game's own decal materials in their game-matched model, but nobody has seen them in game yet. Check decides — this list is a guide.")));
  rt.anchors.register("package.check", check);
  return {
    spec: { id: "package", ...PANEL_META["package"], element },
    showSetup() {
      setupSection.open = true;
      setupSection.scrollIntoView({ block: "nearest" });
      const empty = [inputs.gameRoot, inputs.wolvenKitCli].find(input => !input.value) ?? inputs.gameRoot;
      requestAnimationFrame(() => empty.focus());
    },
    update(frame) {
      const files = frame.files, library = frame.library;
      applyCapability(check, port.files.capability({ kind: "package.check" }));
      applyCapability(build, buildCapability());
      const setup = frame.localSetup;
      if (setup.view && !dirty && setup.view.revision !== loadedRevision) {
        loadedRevision = setup.view.revision;
        route.value = setup.view.fields.launchRoute;
        const choice = setup.view.eyePlateHead;
        setText(plateHeadLabel, choice.label);
        setAttr(plateHead, "aria-label", choice.label);
        if (plateHead.options.length !== choice.options.length)
          plateHead.replaceChildren(...choice.options.map(option => h("option", { value: option.value, text: option.label })));
        plateHead.value = setup.view.fields.eyePlateHead;
        for (const [key] of setupFields) setValue(inputs[key], setup.view.fields[key] ?? "");
        showRoute();
      }
      setText(setupState, setup.error ?? (setup.view?.source === "backup" ?
        "The current settings file is damaged. Restore its previous copy before editing." : setup.view ? "" : "Loading your settings…"));
      setupState.hidden = !setupState.textContent;
      setText(setupReadiness, setup.view?.readiness.build.ready ? "Ready to build your mod files." :
        setup.view?.readiness.build.issues.map(issue => issue.reason).join(" ") ?? "");
      applyCapability(saveSetup, port.localSetup.capability({ kind: "setup.save", fields: setup.view?.fields ?? {} as LocalSetupFields }));
      applyCapability(refreshSetup, port.localSetup.capability({ kind: "setup.refresh" }));
      applyCapability(restoreSetup, port.localSetup.capability({ kind: "setup.restorePrevious" }));
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
          h("p", { class: "muted small", text: "Your collection is unchanged." }),
          technicalDetails([["Code", lastError.code], ["Message", lastError.message], ["Time", new Date(lastError.at).toLocaleString()]],
            "The desktop app also keeps a log in its data folder (About shows where).")))); return; }
      result.replaceChildren(renderResult(pkg!, library.draft?.presets ?? []));
    },
  };
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
  // Results restored from before mod branding lack these fields; show them only when present.
  if (r.modName) card.append(h("p", { class: "muted small" }, "Mod ", h("strong", { text: r.modName }),
    r.selectorLabel ? ` · in-game selector “${r.selectorLabel}”` : ""));
  if (!isBuild) card.append(h("ul", { class: "result-list" }, check.presets.map(preset =>
    h("li", {}, icon("check"), h("span", { text: name(preset.id) }), h("code", { class: "muted", text: preset.appearance })))));
  // e.g. before any plate was prepared for this route, Check cannot tell which looks reach the eye area; Build does.
  if (!isBuild) for (const text of check.notes ?? []) card.append(note(text, "info"));
  if (r.omissions.length) card.append(h("div", { class: "omissions" }, h("span", { class: "eyebrow", text: "Omitted from the package" }),
    h("ul", { class: "result-list" }, r.omissions.map(item => h("li", {}, icon("warning"),
      h("span", { text: item.kind === "layer" ? `Layer “${item.layerName}” in “${item.presetName}” — ${item.reason}` :
        item.kind === "part" ? `The ${item.feature} part of “${item.presetName}” — ${item.reason}` :
        `Whole preset “${item.presetName}” — ${item.reason}` }))))));
  if (isBuild) {
    const b = build;
    card.append(h("dl", { class: "facts" },
      h("dt", { text: "Mod files" }), h("dd", {}, h("code", { text: b.package }))),
    note("Your mod was built and checked. It hasn't been tested in game yet, and nothing was installed.", "info"));
  }
  // Technical facts stay available for bug reports without crowding the result.
  card.append(technicalDetails([
    ...(isBuild ? [["Manifest", build.manifest], ["Archive SHA-256", build.archiveSha256]] as [string, string][] : []),
    ["Collection fingerprint (SHA-256)", r.packagedCollectionSha256]]));
  if (pkg.freshness === "stale") card.append(note("This result describes an earlier snapshot of the draft. Run Check again before relying on it.", "warning"));
  setAttr(card, "data-freshness", pkg.freshness);
  return card;
}
