import { parseRecipe, type Recipe } from "./recipe";
import type { LookSummary, StoredLook } from "./library-store";
import type { LibraryState } from "./workspace-state";

export function setupLibrary(getRecipe: () => Recipe, openRecipe: (recipe: Recipe) => void,
  restored: LibraryState, changed: () => void) {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const select = byId<HTMLSelectElement>("library-looks"), name = byId<HTMLInputElement>("look-name");
  const note = byId("library-state"), save = byId<HTMLButtonElement>("library-save");
  const copy = byId<HTMLButtonElement>("library-copy"), open = byId<HTMLButtonElement>("library-open");
  const refresh = byId<HTMLButtonElement>("library-refresh");
  const endpoint = new URLSearchParams(location.search).has("verify") ? "/api/verification/looks" : "/api/looks";
  let current = restored.current;
  let selected = restored.selected;
  name.value = restored.name;
  name.addEventListener("input", changed);
  select.onchange = () => { selected = select.value; changed(); };
  async function api<T>(path = "", data?: unknown, method = "GET"): Promise<T> {
    const response = await fetch(endpoint + path, {
      method, headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!(response.headers.get("Content-Type") ?? "").includes("application/json"))
      throw Error("Library unavailable. Restart the studio server to enable it; your draft is still safe.");
    const value = await response.json();
    if (!response.ok) throw Error(value.error ?? "Library request failed.");
    return value as T;
  }
  async function list(selection = selected) {
    const looks = await api<LookSummary[]>();
    select.replaceChildren(new Option(looks.length ? "Choose a saved look…" : "No saved looks yet", ""));
    for (const look of looks) select.add(new Option(`${look.name} · v${look.revision}`, look.id));
    select.value = selection;
    if (select.selectedIndex < 0) select.value = "";
    selected = select.value;
  }
  async function action(task: () => Promise<void>) {
    for (const button of [save, copy, open, refresh]) button.disabled = true;
    try { await task(); }
    catch (error) { note.textContent = (error as Error).message; }
    finally { for (const button of [save, copy, open, refresh]) button.disabled = false; changed(); }
  }
  function store(asCopy: boolean) {
    // Freeze the submitted snapshot; edits made while saving remain in the browser draft.
    const snapshot = structuredClone(getRecipe()), title = name.value;
    const previous = asCopy ? undefined : current;
    return action(async () => {
      const saved = await api<StoredLook>(previous ? `/${previous.id}` : "", {
        name: title, recipe: snapshot, revision: previous?.revision,
      }, previous ? "PUT" : "POST");
      current = { id: saved.id, revision: saved.revision };
      note.textContent = `Saved “${saved.name}” · revision ${saved.revision}. Further edits stay in the draft until saved.`;
      await list(saved.id);
    });
  }
  save.onclick = () => void store(false);
  copy.onclick = () => void store(true);
  open.onclick = () => void action(async () => {
    if (!select.value) throw Error("Choose a saved look first.");
    const look = await api<StoredLook>(`/${select.value}`);
    openRecipe(parseRecipe(look.recipe));
    current = { id: look.id, revision: look.revision };
    name.value = look.name;
    note.textContent = `Opened “${look.name}” · revision ${look.revision}. Undo can recover the previous draft.`;
  });
  refresh.onclick = () => void action(async () => {
    await list();
    note.textContent = "Library list refreshed. Your draft is unchanged.";
  });
  void action(async () => {
    await list();
    note.textContent = current
      ? `Draft restored for library revision ${current.revision}. Save look checks for newer revisions before writing.`
      : "Save a named look to your local library. Your existing draft is unchanged.";
  });
  return {
    snapshot(): LibraryState { return { selected, name: name.value, current: current ? { ...current } : undefined }; },
    detach() {
      current = undefined;
      selected = "";
      select.value = "";
      name.value = "Imported look";
      note.textContent = "Imported recipe — Save look creates a new library entry.";
      changed();
    },
  };
}
