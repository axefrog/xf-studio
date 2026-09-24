import { expect, test } from "bun:test";
import { createBrowserFileDevice } from "../src/browser-file-device";
import { captureBrowserPanels, createBrowserWorkspaceSession, loadBrowserWorkspace } from "../src/browser-workspace-device";
import { freshWorkspace } from "../src/workspace-state";

class Picker extends EventTarget {
  files?: File[];
  value = "";
  onClick?: () => void;
  click() { this.onClick?.(); }
}

test("browser file adapter accepts shell-provided pickers and resolves selection or cancellation", async () => {
  const recipe = new Picker(), collection = new Picker(), savedV = new Picker();
  const device = createBrowserFileDevice({ document: {} as Document,
    pickers: { recipe, collection, savedV } as unknown as Record<"recipe" | "collection" | "savedV", HTMLInputElement> });
  const file = new File(["sample"], "custom.recipe.json");
  recipe.onClick = () => { recipe.files = [file]; recipe.dispatchEvent(new Event("change")); };
  const chosen = await device.pick("recipe");
  expect(chosen?.name).toBe("custom.recipe.json");
  expect(await chosen?.text()).toBe("sample");
  expect(Array.from(await chosen!.bytes())).toEqual(Array.from(new TextEncoder().encode("sample")));
  expect(recipe.value).toBe("");
  savedV.onClick = () => savedV.dispatchEvent(new Event("cancel"));
  expect(await device.pick("savedV")).toBeUndefined();
  expect(collection.files).toBeUndefined();
});

test("workspace browser adapter keeps verification storage isolated and captures only after activation", () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); } };
  const restored = loadBrowserWorkspace(storage, true), workspace = restored.state;
  const windowEvents = new EventTarget(), documentEvents = Object.assign(new EventTarget(), { hidden: false });
  const scroll = new EventTarget(), toggle = new EventTarget();
  const panels = { ...workspace.panels, layersScroll: 41, lighting: true };
  const statuses: string[] = [];
  const session = createBrowserWorkspaceSession({
    workspace, restored, verification: true, storage,
    capture: { editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: [], fieldSelection: {} }),
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined,
      quality: () => 512, preview: () => ({ ...workspace.preview, wire: true,
        camera: { position: [0, 0, 1], target: [0, 0, 0], fov: 42 } }), motion: () => undefined,
      sidebar: () => ({ sidebarLeft: 300, sidebarRight: 400 }), layout: () => panels },
    sources: [], window: windowEvents, document: documentEvents,
    scrollTargets: [scroll], toggleTargets: [toggle], onStatus: s => statuses.push(s.kind),
  });
  documentEvents.dispatchEvent(new Event("input")); session.flush();
  expect(stored.size).toBe(0);
  session.activate();
  scroll.dispatchEvent(new Event("scroll")); session.flush();
  expect(stored.has("xfas.workspace.verification.v1")).toBe(true);
  expect(stored.has("xfas.workspace.v1")).toBe(false);
  const early = JSON.parse(stored.get("xfas.workspace.verification.v1")!);
  expect(early.preview.wire).toBe(false);
  expect(early.panels.layersScroll).toBe(workspace.panels.layersScroll);
  session.setPreviewReady();
  documentEvents.hidden = true;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  const ready = JSON.parse(stored.get("xfas.workspace.verification.v1")!);
  expect(ready.preview.wire).toBe(true);
  expect(ready.panels.layersScroll).toBe(41);
  expect(statuses).toContain("saved");
});

test("panel capture takes geometry from injected elements without page control IDs", () => {
  expect(captureBrowserPanels({ sidebar: () => ({ sidebarLeft: 420, sidebarRight: 450 }),
    lighting: { open: true }, previewQuality: { open: false },
    layers: { scrollTop: 13 }, properties: { scrollTop: 27 },
    page: { scrollX: 2, scrollY: 9 } })).toEqual({ sidebarLeft: 420, sidebarRight: 450,
    lighting: true, previewQuality: false, layersScroll: 13, propertiesScroll: 27, pageX: 2, pageY: 9 });
});
