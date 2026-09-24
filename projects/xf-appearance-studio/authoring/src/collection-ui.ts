import type { EditorSnapshot } from "./collection-session";
import type { CollectionWorkspace, PresetCommand } from "./collection-workspace";
import { CollectionService, type CollectionRequest } from "./collection-service";
import { collectionTransport } from "./collection-transport";
import type { LibraryState } from "./workspace-state";
import { reorderHandle } from "./reorder-ui";
import type { Recipe } from "./recipe";
import type { StudioApplication } from "./studio-application";

export function setupCollections(read: () => EditorSnapshot, show: (editor: EditorSnapshot) => void,
  restored: CollectionWorkspace | undefined, legacy: LibraryState, changed: () => void,
  download: (blob: Blob, name: string) => void, app: StudioApplication) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const host = $("presets"), layerEditor = $("makeup-editor"), parked = $("parked-layers"), note = $("collection-state");
  const title = $<HTMLInputElement>("collection-name"), savedList = $("saved-collections");
  const files = savedList.closest<HTMLDetailsElement>("details")!;
  const endpoint = new URLSearchParams(location.search).has("verify") ? "/api/verification/collections" : "/api/collections";
  const service = new CollectionService(restored, legacy, read, show, collectionTransport(endpoint));
  app.attach({ collection: service });
  const draft = () => service.view().draft;
  files.open = restored?.filesOpen ?? false;
  files.ontoggle = () => { if (draft() && !service.view().busy) {
    service.dispatch({ kind: "collection.filesOpen", open: files.open }); changed(); } };
  const layerCount = (count: number) => `${count} ${count === 1 ? "layer" : "layers"}`;
  const controls = ["preset-add", "preset-restore", "collection-save", "collection-copy", "collection-export", "collection-plan",
    "collection-package-check", "collection-package-build",
    "collection-import", "collection-refresh", "collection-undo-open"];
  const message = (text: string) => { note.textContent = text; };
  function buttons() {
    const state = service.view();
    for (const id of controls) $<HTMLButtonElement>(id).disabled = state.busy || !state.draft;
    title.disabled = state.busy || !state.draft;
    if (state.draft && !state.busy) {
      $<HTMLButtonElement>("preset-restore").disabled = !service.actionCapability({ kind: "preset.edit", command: { kind: "restore" } }).available;
      $<HTMLButtonElement>("collection-undo-open").disabled = !service.actionCapability({ kind: "collection.undoOpen" }).available;
      for (const [id, request] of [["collection-export", { kind: "exportCollection" }], ["collection-plan", { kind: "exportPlan" }],
        ["collection-package-check", { kind: "package", action: "check" }],
        ["collection-package-build", { kind: "package", action: "build" }]] as const)
        $<HTMLButtonElement>(id).disabled = !service.capability(request).available;
    }
    for (const actions of host.querySelectorAll<HTMLElement>(".preset-actions")) actions.inert = state.busy;
    for (const field of host.querySelectorAll<HTMLInputElement>(".preset-name-label input")) field.disabled = state.busy;
    savedList.inert = state.busy;
    // Layer controls remain editable while an immutable snapshot is being saved.
    layerEditor.inert = false;
  }
  function paint() {
    parked.append(layerEditor); host.replaceChildren();
    const state = draft();
    if (!state) { host.textContent = "Loading presets…"; buttons(); return; }
    title.value = state.collection.name;
    if (!state.collection.presets.length) host.textContent = "No presets yet. Add a preset to begin.";
    for (const [index, preset] of state.collection.presets.entries()) {
      const details = document.createElement("details"); details.className = "preset"; details.dataset.presetId = preset.id;
      details.open = preset.id === state.selected && state.expanded;
      const summary = document.createElement("summary"), heading = document.createElement("span");
      heading.className = "preset-title"; heading.textContent = preset.name;
      const info = document.createElement("small"); info.textContent = layerCount(preset.recipe.layers.length);
      summary.append(heading, info); details.append(summary);
      summary.onclick = e => {
        e.preventDefault();
        if (service.view().busy) return;
        if (draft()!.selected === preset.id) service.dispatch({ kind: "preset.expand", expanded: !draft()!.expanded });
        else service.dispatch({ kind: "preset.select", id: preset.id });
        paint(); changed();
      };
      const actions = document.createElement("div"); actions.className = "preset-actions";
      const button = (text: string, label: string, action: () => void, disabled = false) => {
        const b = document.createElement("button"); b.textContent = text; b.setAttribute("aria-label", label); b.title = label;
        b.disabled = disabled; b.onclick = action; actions.append(b); return b;
      };
      const handle = button("↕", `Drag preset ${preset.name} to reorder`, () => {});
      reorderHandle(handle, details, host, ".preset", () => draft()!.collection.presets.find(p => p.id === preset.id)!.name, target => {
        const to = draft()!.collection.presets.findIndex(p => p.id === target.dataset.presetId);
        edit({ kind: "move", id: preset.id, to });
      });
      button("↑", `Move preset ${preset.name} up`, () => edit({ kind: "move", id: preset.id, to: index - 1 }), index === 0);
      button("↓", `Move preset ${preset.name} down`, () => edit({ kind: "move", id: preset.id, to: index + 1 }), index === state.collection.presets.length - 1);
      button("Duplicate", `Duplicate preset ${preset.name}`, () => edit({ kind: "copy", id: preset.id }));
      button("Remove", `Remove preset ${preset.name}`, () => edit({ kind: "remove", id: preset.id }));
      const label = document.createElement("label"); label.className = "preset-name-label"; label.textContent = "Preset name";
      const name = document.createElement("input"); name.maxLength = 120; name.value = preset.name; label.append(name);
      const commit = () => {
        if (name.value === draft()!.collection.presets.find(p => p.id === preset.id)?.name) return;
        const oldName = draft()!.collection.presets.find(p => p.id === preset.id)!.name;
        try { service.dispatch({ kind: "preset.edit", command: { kind: "rename", id: preset.id, name: name.value } }); const newName = draft()!.collection.presets.find(p => p.id === preset.id)!.name;
          heading.textContent = newName;
          for (const button of actions.querySelectorAll("button")) { button.title = button.title.replace(oldName, newName); button.setAttribute("aria-label", button.title); }
          changed(); } catch (e) { message((e as Error).message); name.value = oldName; }
      };
      name.onchange = name.onblur = commit; name.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); commit(); } };
      details.append(label, actions);
      if (preset.id === state.selected) details.append(layerEditor);
      host.append(details);
    }
    buttons();
  }
  function edit(command: PresetCommand) {
    if (!draft() || service.view().busy) return;
    const outcome = app.dispatch({ kind: "preset.edit", command });
    if (!outcome.ok) { message(outcome.message); return; }
    paint(); changed(); message("Collection draft updated. Save collection to retain a SQLite revision.");
  }
  function paintSavedList() {
    savedList.replaceChildren();
    for (const item of service.view().summaries) {
      const button = document.createElement("button"); button.textContent = `${item.name} · ${item.count} presets · v${item.revision}`;
      button.onclick = () => void run({ kind: "open", id: item.id }); savedList.append(button);
    }
  }
  async function run(request: CollectionRequest) {
    const outcome = await app.execute(request);
    if (!outcome.ok) message(outcome.message);
    if (outcome.ok && outcome.result.kind === "export")
      download(new Blob([outcome.result.json], { type: "application/json" }), outcome.result.name);
    paint();
    if (outcome.ok && request.kind !== "package" && request.kind !== "refresh") changed();
  }
  service.subscribe(() => {
    buttons(); paintSavedList();
    const progress = service.view().progress;
    if (progress) message(progress.message);
  });
  $("preset-add").onclick = () => edit({ kind: "add" }); $("preset-restore").onclick = () => edit({ kind: "restore" });
  $("collection-save").onclick = () => void run({ kind: "save" });
  $("collection-copy").onclick = () => void run({ kind: "saveCopy" });
  $("collection-refresh").onclick = () => void run({ kind: "refresh" });
  $("collection-undo-open").onclick = () => { if (draft() && !service.view().busy) {
    service.dispatch({ kind: "collection.undoOpen" }); paint(); changed(); } };
  const commitTitle = () => {
    if (!draft()) return;
    if (title.value === draft()!.collection.name) return;
    try { service.dispatch({ kind: "collection.rename", name: title.value }); changed(); }
    catch (e) { message((e as Error).message); title.value = draft()!.collection.name; }
  };
  title.onchange = title.onblur = commitTitle;
  title.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); commitTitle(); } };
  $("collection-export").onclick = () => void run({ kind: "exportCollection" });
  $("collection-plan").onclick = () => void run({ kind: "exportPlan" });
  for (const [id, kind] of [["collection-package-check", "check"], ["collection-package-build", "build"]] as const)
    $(id).onclick = () => void run({ kind: "package", action: kind });
  const file = $<HTMLInputElement>("collection-file");
  $("collection-import").onclick = () => file.click();
  file.onchange = () => void (async () => {
    try {
      const source = file.files?.[0]; if (!source) return;
      await run({ kind: "import", text: source.size > 16_000_000 ? "" : await source.text(), bytes: source.size });
    } catch (error) { message((error as Error).message);
    } finally { file.value = ""; }
  })();
  paint();
  void run({ kind: "initialize" });
  return {
    service,
    snapshot: () => service.snapshot(),
    importRecipe(recipe: Recipe, name: string) {
      if (!draft() || service.view().busy) throw Error("Wait for the collection to finish loading or saving.");
      const outcome = app.dispatch({ kind: "collection.importRecipe", recipe, name });
      if (!outcome.ok) throw Error(outcome.message);
      paint(); changed();
    },
    refreshSummary() {
      if (!draft()) return;
      const current = read(), row = host.querySelector<HTMLElement>(`[data-preset-id="${draft()!.selected}"] small`);
      if (row) row.textContent = layerCount(current.recipe.layers.length);
    },
  };
}
