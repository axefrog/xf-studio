/** Eye makeup owns its collection and presets panels; all actions cross the typed view context. */
import { applyCapability, button, setButtonLabel, emptyState, section } from "../../../studio-ui/controls";
import { h, setText, setValue } from "../../../studio-ui/dom";
import { ItemList } from "../../../studio-ui/item-list";
import { ConflictNotice, helpTip, progressBar, RecordList, recordTime, setHelp, type ConflictKeep } from "../../../studio-ui/components";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { EyeMakeupViewContext } from "./actions";
import { EYE_MAKEUP_PANEL_META } from "./contribution";

/** How a recent draft stands against the library, in words (its row's meta line). */
const DRAFT_STATE: Record<"never" | "same" | "edited" | "unknown", (revision?: number) => string> = {
  never: () => "Draft · no version yet",
  same: revision => `Draft · same as saved version ${revision}`,
  edited: revision => `Draft · changed since version ${revision}`,
  unknown: revision => `Draft · started from version ${revision}`,
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function presetsPanel(ctx: EyeMakeupViewContext): PanelController {
  const collection = ctx.collection;
  const nameInput = h("input", { class: "field title-field", type: "text", maxlength: "120", "aria-label": "Collection name", spellcheck: "false" });
  const commitName = () => {
    const current = collection.summary().draft?.name;
    if (!current || nameInput.value.trim() === current) { nameInput.value = current ?? ""; return; }
    // The naming rules (a name can't be blank or too long) are the application's; a refusal says why and keeps the old name (UI-93).
    if (!ctx.platform({ kind: "collection.rename", name: nameInput.value })) nameInput.value = current;
  };
  nameInput.addEventListener("change", commitName);
  nameInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitName(); nameInput.blur(); }
    if (event.key === "Escape") { nameInput.value = collection.summary().draft?.name ?? ""; nameInput.blur(); } });
  let collectionMenuKey = "";
  const collectionMore = button({ label: "Collection actions", icon: "more", iconOnly: true, variant: "ghost", menu: true,
    onClick: event => collection.menu(event.currentTarget as Element, event.currentTarget as Element) });
  const addButton = button({ label: "Add preset", icon: "plus", small: true,
    onClick: () => { if (ctx.platform({ kind: "preset.edit", command: { kind: "add" } })) ctx.feedback.announce("Preset added and selected"); } });
  const count = h("span", { class: "count" });
  const list = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Presets in this collection", noun: "preset", maxLength: 120,
    onSelect: id => { const draft = collection.summary().draft; if (draft) ctx.platform({ kind: "scene.setLook", look: { collection: draft.id, look: id } }); },
    onMove: (id, to) => ctx.platform({ kind: "preset.edit", command: { kind: "move", id, to } }),
    onRename: (id, name) => ctx.platform({ kind: "preset.edit", command: { kind: "rename", id, name } }),
    onDelete: id => removePreset(id),
    onDuplicate: id => ctx.platform({ kind: "preset.edit", command: { kind: "copy", id } }),
    onMenu: (id, anchor, invoker) => collection.presetMenu(id, anchor, invoker),
    decorate: (item, row, selected) => {
      if (!row.trailing.childElementCount) row.trailing.append(
        button({ label: `Duplicate ${item.name}`, icon: "duplicate", iconOnly: true, variant: "ghost", small: true,
          onClick: () => ctx.platform({ kind: "preset.edit", command: { kind: "copy", id: item.id } }) }),
        button({ label: `More actions for ${item.name}`, icon: "more", iconOnly: true, variant: "ghost", small: true, menu: true,
          onClick: event => collection.presetMenu(item.id, event.currentTarget as Element, event.currentTarget as Element) }));
      for (const control of row.trailing.querySelectorAll("button")) {
        control.tabIndex = selected ? 0 : -1;
        const label = control.getAttribute("aria-label") ?? "";
        control.setAttribute("aria-label", label.replace(/(Duplicate|More actions for) .*/, `$1 ${item.name}`));
      }
      if (!row.lead.childElementCount) row.lead.append(h("span", { class: "preset-mark", "aria-hidden": "true" }));
    },
  });
  function removePreset(id: string) {
    const name = collection.summary().draft?.presets.find(preset => preset.id === id)?.name ?? "Preset";
    if (ctx.platform({ kind: "preset.edit", command: { kind: "remove", id } }))
      ctx.feedback.toast("info", "Presets", `Removed “${name}”. The last 20 removals can be restored.`,
        [{ label: "Restore", run: () => {
          // Restore brings back the most recent removal; refuse if that is now another preset.
          if (collection.summary().draft?.removed.at(-1)?.id !== id)
            ctx.feedback.toast("warning", "Presets", `“${name}” is no longer the most recent removal. Use Restore in the Presets panel to step back through removals.`);
          else ctx.platform({ kind: "preset.edit", command: { kind: "restore" } });
        } }]);
  }
  const restore = button({ label: "Restore removed", icon: "reset", small: true, variant: "quiet",
    onClick: () => { if (ctx.platform({ kind: "preset.edit", command: { kind: "restore" } })) ctx.feedback.announce("Preset restored"); } });
  const importRecipe = button({ label: "Import recipe as preset…", icon: "import", small: true, variant: "quiet",
    onClick: () => void collection.file({ kind: "recipe.import" }) });
  const failed = emptyState("Library unavailable", "Your library couldn't be read. The look you have open still works. Try again, or restart XF Studio.",
    button({ label: "Retry", icon: "refresh", onClick: () => void collection.request({ kind: "initialize" }) }));
  const empty = emptyState("No presets yet", "A preset is one complete look — one choice in the in-game selector.",
    button({ label: "Add preset", icon: "plus", variant: "primary", onClick: () => ctx.platform({ kind: "preset.edit", command: { kind: "add" } }) }));
  // Changed in another window (t-conflict): one notice per conflict on the collection or a preset, under its name, while it waits.
  const conflicts = h("div", { class: "stack-s doc-conflicts" });
  let conflictsKey = "";
  const notices = new Map<string, ConflictNotice>();
  const element = h("div", { class: "panel-content" },
    // The library chip is the header's alone (one place per state, release-readiness-audit.md C-18).
    h("div", { class: "panel-head" }, h("label", { class: "eyebrow", text: "Collection" }), h("div", { class: "row" }, nameInput, collectionMore)),
    conflicts,
    h("div", { class: "list-head" }, h("span", { class: "control-line" }, h("span", { class: "eyebrow" }, "Presets ", count),
      helpTip("presets", "Each preset becomes one choice in the game's single eye-makeup selector, alongside Off.")), addButton),
    failed, empty, list.element,
    h("div", { class: "row wrap gap-s panel-foot" }, restore, importRecipe));
  ctx.anchors.register("presets.list", list.element);
  return {
    spec: { id: "presets", ...EYE_MAKEUP_PANEL_META["presets"], element },
    emptyChoices: "alongside",
    update(frame) {
      const library = frame.library, draft = library.draft, busy = library.busy;
      if (draft) setValue(nameInput, draft.name);
      const waiting = draft?.conflicts ?? [];
      const key = JSON.stringify([waiting, busy]);
      if (key !== conflictsKey) {
        conflictsKey = key;
        for (const id of [...notices.keys()]) if (!waiting.some(item => item.id === id)) notices.delete(id);
        conflicts.replaceChildren(...waiting.map(item => {
          let notice = notices.get(item.id);
          if (!notice) {
            const request = (keep: ConflictKeep) => ({ kind: "resolveConflict" as const, conflict: item.id, keep });
            notices.set(item.id, notice = new ConflictNotice({ onResolve: keep => void collection.request(request(keep)),
              capability: keep => collection.requestCapability(request(keep)) }));
          }
          notice.update(item);
          return notice.element;
        }));
        conflicts.hidden = !waiting.length;
      }
      nameInput.disabled = busy || !draft;
      const presets = draft?.presets ?? [];
      setText(count, String(presets.length));
      failed.hidden = !!draft || library.busy || library.progress?.phase !== "error";
      empty.hidden = !draft || presets.length > 0;
      list.update(presets.map(preset => ({ id: preset.id, name: preset.name,
        meta: preset.locked ? "Made with a newer XF Studio · kept as it is" : plural(preset.layers, "layer") })), draft?.selected, busy);
      applyCapability(addButton, collection.capability({ kind: "preset.edit", command: { kind: "add" } }));
      const removed = draft?.removed.at(-1);
      restore.hidden = !removed;
      if (removed) setButtonLabel(restore, `Restore “${removed.name}”`);
      applyCapability(restore, collection.capability({ kind: "preset.edit", command: { kind: "restore" } }));
      applyCapability(importRecipe, collection.fileCapability({ kind: "recipe.import" }));
      // A "…" whose menu would hold nothing to act on is unavailable with its reason, never a button that does nothing (UI-139). Asked
      // only when the collection's state changes, not on every paint.
      const menuKey = JSON.stringify([draft?.id, draft?.name, busy]);
      if (menuKey !== collectionMenuKey) {
        collectionMenuKey = menuKey;
        applyCapability(collectionMore, collection.menuCapability(collectionMore));
      }
    },
  };
}

export function libraryPanel(ctx: EyeMakeupViewContext): PanelController {
  const collection = ctx.collection;
  const save = button({ label: "Save version", icon: "save", variant: "primary", onClick: () => void collection.request({ kind: "save" }) });
  const saveCopy = button({ label: "Save as new collection", icon: "duplicate", title: "Stores a copy with a new identity; you continue editing the copy.",
    onClick: () => void collection.request({ kind: "saveCopy" }) });
  const stateLine = h("p", { class: "state-line" });
  const progress = progressBar({ label: "Library request in progress" }).element;
  progress.hidden = true;
  // The saved list updates itself (release-readiness-audit.md item 13): read quietly whenever this panel is shown or the window comes
  // back (another window of XF Studio may have saved), so there is no Refresh button.
  const syncList = () => collection.refresh();
  window.addEventListener("focus", syncList);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncList(); });
  // Recent drafts, newest first (item 13): the library's other collections never saved as a version, each shown again with its Reopen.
  const drafts = new RecordList({ label: "Recent drafts" });
  const draftsSection = section({ title: "Recent drafts", help: ["Collections in your library that were never saved as a version: an import, or an earlier draft. Reopen shows one; the collection you have open stays in your library.",
    "Each line says it has no version yet, so a draft is never mistaken for a saved collection of the same name."] }, drafts.element);
  let draftsSignature = "";
  const saved = new RecordList({ label: "Saved collections" });
  const savedEmpty = emptyState("No versions yet", "Save version keeps the first version of this collection. Your work saves itself to your library as you go.");
  const fileButtons = {
    importCollection: button({ label: "Import collection…", icon: "import", small: true, onClick: () => collection.import() }),
    exportCollection: button({ label: "Export collection", icon: "export", small: true, onClick: () => void collection.file({ kind: "collection.export" }) }),
    exportPlan: button({ label: "Export compiler plan", icon: "export", small: true, onClick: () => void collection.file({ kind: "collection.plan" }) }),
    importRecipe: button({ label: "Import recipe as preset…", icon: "import", small: true, onClick: () => void collection.file({ kind: "recipe.import" }) }),
    exportRecipe: button({ label: "Export preset recipe", icon: "export", small: true, onClick: () => void collection.file({ kind: "recipe.export" }) }),
    exportMask: button({ label: "Export layer mask", icon: "export", small: true, onClick: () => void collection.file({ kind: "mask.export" }) }),
  };
  let savedSignature = "";
  // What the files are, in the Files heading's help tip; with research tools (UI-85) it adds what a compiler plan is.
  const filesHelp = "Collection and recipe files keep your work editable, as a separate copy or to share. Exporting a collection saves a version in your library first.";
  const researchHelp = "Research: a compiler plan is input for the offline compiler, not a mod; exporting one saves a version first. A layer mask is a picture of the selected layer's shape.";
  const filesSection = section({ title: "Files", help: filesHelp }, h("div", { class: "button-grid" }, fileButtons.importCollection, fileButtons.exportCollection,
    fileButtons.exportPlan, fileButtons.importRecipe, fileButtons.exportRecipe, fileButtons.exportMask));
  const filesTip = filesSection.querySelector<HTMLElement>(".help-tip")!;
  const element = h("div", { class: "panel-content" },
    section({ title: "Local library", help: ["Save version keeps a version of this collection in your library on this computer that you can go back to. Edits you make while it saves are kept.",
      "Your work also saves itself to your library as you go."] },
      stateLine, progress, h("div", { class: "row wrap gap-s" }, save, saveCopy)),
    section({ title: "Saved collections", help: "The versions saved in your library on this computer. Open one to work on it." }, savedEmpty, saved.element),
    draftsSection,
    filesSection);
  return {
    spec: { id: "library", ...EYE_MAKEUP_PANEL_META["library"], element, visibility: visible => { if (visible) syncList(); } },
    emptyChoices: "alongside",
    update(frame) {
      const library = frame.library, draft = library.draft;
      const state = collection.state(frame);
      setText(stateLine, state.detail || state.label);
      stateLine.className = `state-line ${state.tone}`;
      progress.hidden = !library.busy;
      applyCapability(save, collection.requestCapability({ kind: "save" }));
      applyCapability(saveCopy, collection.requestCapability({ kind: "saveCopy" }));
      const queue = draft?.recovery ?? [], draftsKey = JSON.stringify([queue, library.busy]);
      draftsSection.hidden = !queue.length;
      if (draftsKey !== draftsSignature) {
        draftsSignature = draftsKey;
        drafts.update(queue.map(entry => {
          const recover = button({ label: "Reopen", icon: "undo", small: true, title: `Reopen “${entry.name}”; the collection you have open stays in your library`,
            onClick: () => void collection.file({ kind: "collection.recover", draft: entry.id }) });
          applyCapability(recover, collection.fileCapability({ kind: "collection.recover", draft: entry.id }));
          return { id: entry.id, name: entry.name, meta: [...DRAFT_STATE[entry.saved](entry.revision).split(" · "), plural(entry.presets, "preset")], action: recover };
        }));
      }
      const signature = JSON.stringify([library.summaries, draft?.id, library.busy]);
      if (signature !== savedSignature) {
        savedSignature = signature;
        saved.update(library.summaries.map(item => {
          const current = item.id === draft?.id;
          // The row open now says so with its badge and background, and offers no Open: there is nothing to do with it here (C5).
          const meta = [plural(item.count, "preset"), `version ${item.revision}`, recordTime(item.updatedAt)];
          if (current) return { id: item.id, name: item.name, current, meta, badge: { text: "Open now", tone: "info" as const } };
          const open = button({ label: "Open", small: true,
            onClick: () => void collection.request({ kind: "open", id: item.id }, { actions: [collection.reopenPreviousAction()] }) });
          applyCapability(open, collection.requestCapability({ kind: "open", id: item.id }));
          return { id: item.id, name: item.name, meta, action: open };
        }));
      }
      savedEmpty.hidden = library.summaries.length > 0;
      const research = !!frame.preferences?.researchTools;
      // The compiler plan and the raw layer mask are research outputs (release-readiness-audit.md item 6).
      fileButtons.exportPlan.hidden = !research; fileButtons.exportMask.hidden = !research;
      setHelp(filesTip, research ? [filesHelp, researchHelp] : filesHelp);
      for (const [key, action] of [["importCollection", "collection.import"], ["exportCollection", "collection.export"], ["exportPlan", "collection.plan"],
        ["importRecipe", "recipe.import"], ["exportRecipe", "recipe.export"], ["exportMask", "mask.export"]] as const)
        applyCapability(fileButtons[key], collection.fileCapability({ kind: action }));
    },
  };
}

