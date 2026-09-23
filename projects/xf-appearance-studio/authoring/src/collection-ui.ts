import { CollectionSession, type EditorSnapshot } from "./collection-session";
import { collectionDraft, type CollectionWorkspace, type PresetCommand } from "./collection-workspace";
import { parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import type { CollectionSummary, StoredCollection } from "./collection-store";
import type { LibraryState } from "./workspace-state";
import { reorderHandle } from "./reorder-ui";
import type { Recipe } from "./recipe";

export function setupCollections(read: () => EditorSnapshot, show: (editor: EditorSnapshot) => void,
  restored: CollectionWorkspace | undefined, legacy: LibraryState, changed: () => void, download: (blob: Blob, name: string) => void) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const host = $("presets"), layerEditor = $("makeup-editor"), parked = $("parked-layers"), note = $("collection-state");
  const title = $<HTMLInputElement>("collection-name"), savedList = $("saved-collections");
  const files = savedList.closest<HTMLDetailsElement>("details")!;
  const endpoint = new URLSearchParams(location.search).has("verify") ? "/api/verification/collections" : "/api/collections";
  let session = restored ? new CollectionSession(restored, read, show) : undefined, busy = false;
  files.open = restored?.filesOpen ?? false;
  files.ontoggle = () => { if (session) { session.state.filesOpen = files.open; changed(); } };
  const layerCount = (count: number) => `${count} ${count === 1 ? "layer" : "layers"}`;
  const controls = ["preset-add", "preset-restore", "collection-save", "collection-copy", "collection-export", "collection-plan",
    "collection-import", "collection-refresh", "collection-undo-open"];
  const message = (text: string) => { note.textContent = text; };
  async function api<T>(path = "", value?: unknown): Promise<T> {
    const response = await fetch(endpoint + path, { method: value ? "POST" : "GET",
      headers: value ? { "Content-Type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined });
    if (!(response.headers.get("Content-Type") ?? "").includes("application/json")) throw Error("Restart the studio server to enable collection storage. Your draft is safe.");
    const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Collection request failed."); return data;
  }
  function buttons() {
    for (const id of controls) $<HTMLButtonElement>(id).disabled = busy || !session;
    title.disabled = busy || !session;
    if (session && !busy) {
      $<HTMLButtonElement>("preset-restore").disabled = !session.state.removed.length;
      $<HTMLButtonElement>("collection-undo-open").disabled = !session.state.previous;
    }
    for (const actions of host.querySelectorAll<HTMLElement>(".preset-actions")) actions.inert = busy;
    for (const field of host.querySelectorAll<HTMLInputElement>(".preset-name-label input")) field.disabled = busy;
    savedList.inert = busy;
    // Layer controls remain editable while an immutable snapshot is being saved.
    layerEditor.inert = false;
  }
  function paint() {
    parked.append(layerEditor); host.replaceChildren();
    if (!session) { host.textContent = "Loading presets…"; buttons(); return; }
    const state = session.state; title.value = state.collection.name;
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
        if (busy) return;
        if (session!.state.selected === preset.id) session!.state.expanded = !session!.state.expanded;
        else session!.select(preset.id);
        paint(); changed();
      };
      const actions = document.createElement("div"); actions.className = "preset-actions";
      const button = (text: string, label: string, action: () => void, disabled = false) => {
        const b = document.createElement("button"); b.textContent = text; b.setAttribute("aria-label", label); b.title = label;
        b.disabled = disabled; b.onclick = action; actions.append(b); return b;
      };
      const handle = button("↕", `Drag preset ${preset.name} to reorder`, () => {});
      reorderHandle(handle, details, host, ".preset", () => session!.state.collection.presets.find(p => p.id === preset.id)!.name, target => {
        const to = session!.state.collection.presets.findIndex(p => p.id === target.dataset.presetId);
        edit({ kind: "move", id: preset.id, to });
      });
      button("↑", `Move preset ${preset.name} up`, () => edit({ kind: "move", id: preset.id, to: index - 1 }), index === 0);
      button("↓", `Move preset ${preset.name} down`, () => edit({ kind: "move", id: preset.id, to: index + 1 }), index === state.collection.presets.length - 1);
      button("Duplicate", `Duplicate preset ${preset.name}`, () => edit({ kind: "copy", id: preset.id }));
      button("Remove", `Remove preset ${preset.name}`, () => edit({ kind: "remove", id: preset.id }));
      const label = document.createElement("label"); label.className = "preset-name-label"; label.textContent = "Preset name";
      const name = document.createElement("input"); name.maxLength = 120; name.value = preset.name; label.append(name);
      const commit = () => {
        if (name.value === session!.state.collection.presets.find(p => p.id === preset.id)?.name) return;
        const oldName = session!.state.collection.presets.find(p => p.id === preset.id)!.name;
        try { session!.edit({ kind: "rename", id: preset.id, name: name.value }); const newName = session!.state.collection.presets.find(p => p.id === preset.id)!.name;
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
    if (!session || busy) return;
    try { session.edit(command); paint(); changed(); message("Collection draft updated. Save collection to retain a SQLite revision."); }
    catch (e) { message((e as Error).message); }
  }
  async function action(task: () => Promise<void>) {
    if (busy) return; busy = true; buttons();
    try { await task(); } catch (e) { message((e as Error).message); }
    finally { busy = false; buttons(); changed(); }
  }
  async function list() {
    const summaries = await api<CollectionSummary[]>(); savedList.replaceChildren();
    for (const item of summaries) {
      const button = document.createElement("button"); button.textContent = `${item.name} · ${item.count} presets · v${item.revision}`;
      button.onclick = () => void action(async () => {
        const saved = await api<StoredCollection>(`/${item.id}`); session!.open(saved.collection, saved.revision); paint();
        message(`Opened “${saved.collection.name}”. Undo collection open restores the previous draft.`);
      }); savedList.append(button);
    }
    return summaries;
  }
  async function store(copy = false) {
    if (!session) throw Error("Collection is not ready.");
    const snapshot = session.snapshot(), sourceId = snapshot.collection.id;
    if (copy) { snapshot.collection.id = crypto.randomUUID(); snapshot.revision = undefined; }
    const saved = await api<StoredCollection>("", { collection: snapshot.collection, revision: snapshot.revision });
    session.saved(saved, sourceId); await list();
    message(`Saved “${saved.collection.name}” · revision ${saved.revision}. Changes made during saving remain in your draft.`);
    return saved;
  }
  $("preset-add").onclick = () => edit({ kind: "add" }); $("preset-restore").onclick = () => edit({ kind: "restore" });
  $("collection-save").onclick = () => void action(async () => { await store(); });
  $("collection-copy").onclick = () => void action(async () => { await store(true); });
  $("collection-refresh").onclick = () => void action(async () => { await list(); message("Saved collection list refreshed; draft retained."); });
  $("collection-undo-open").onclick = () => { if (session && !busy) { session.undoOpen(); paint(); changed(); } };
  const commitTitle = () => {
    if (!session) return;
    if (title.value === session.state.collection.name) return;
    try { session.stash(); session.state.collection = parseCollection({ ...session.state.collection, name: title.value.trim() }, true); changed(); }
    catch (e) { message((e as Error).message); title.value = session.state.collection.name; }
  };
  title.onchange = title.onblur = commitTitle;
  title.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); commitTitle(); } };
  for (const [id, plan] of [["collection-export", false], ["collection-plan", true]] as const) $(id).onclick = () => void action(async () => {
    parseCollection(session!.snapshot().collection); // Reject empty export before writing a revision.
    const saved = await store(), value = plan ? planCollection(saved.collection) : saved.collection;
    download(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), plan ? "xfs.build-plan.json" : "xfs.collection.json");
    message(plan ? "Build plan exported for the offline compiler; this is not an installable mod." : "Saved snapshot exported. Recipes and stable preset identities are included.");
  });
  const file = $<HTMLInputElement>("collection-file");
  $("collection-import").onclick = () => file.click();
  file.onchange = () => void action(async () => {
    try {
      const source = file.files?.[0]; if (!source) return;
      if (source.size > 16_000_000) throw Error("Collection exceeds the current 16 MB import budget.");
      const collection = parseCollection(JSON.parse(await source.text())); session!.open(collection); paint();
      message("Imported collection draft. Existing IDs are preserved; Save a copy creates a separate collection. Undo collection open recovers the previous draft.");
    } finally { file.value = ""; }
  });
  paint();
  void action(async () => {
    const summaries = await list();
    if (!session) {
      const stored = await api<StoredCollection>(`/${summaries[0].id}`), draft = collectionDraft(stored.collection, stored.revision), current = read();
      const id = legacy.current?.id ?? crypto.randomUUID(), existing = draft.collection.presets.find(p => p.id === id);
      if (existing) { existing.recipe = current.recipe; existing.name = legacy.name.trim() || existing.name; }
      else draft.collection.presets.push({ id, name: legacy.name.trim() || "Unsaved preset", revision: 1, recipe: current.recipe });
      draft.selected = id; draft.editors[id] = { active: current.active, selected: current.selected, fieldSelection: current.fieldSelection, history: current.history };
      session = new CollectionSession(draft, read, show);
      message("Existing looks and your current draft are retained. Save collection to store this arrangement.");
    } else message("Collection draft restored without replacing unsaved edits from SQLite.");
    paint();
  });
  return {
    snapshot: () => session?.snapshot(),
    importRecipe(recipe: Recipe, name: string) {
      if (!session || busy) throw Error("Wait for the collection to finish loading or saving.");
      session.importRecipe(recipe, name); paint(); changed();
    },
    refreshSummary() {
      if (!session) return;
      const current = read(), row = host.querySelector<HTMLElement>(`[data-preset-id="${session.state.selected}"] small`);
      if (row) row.textContent = layerCount(current.recipe.layers.length);
    },
  };
}
