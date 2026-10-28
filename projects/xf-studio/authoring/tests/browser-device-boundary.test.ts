import { expect, test } from "bun:test";
import { createBrowserFileDevice } from "../src/app/browser/browser-file-device";
import { createBrowserWorkspaceSession, loadBrowserWorkspace } from "../src/app/browser/browser-workspace-device";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";

class Picker extends EventTarget {
  files?: File[];
  value = "";
  onClick?: () => void;
  click() { this.onClick?.(); }
}

test("browser file adapter accepts shell-provided pickers and resolves selection or cancellation", async () => {
  const recipe = new Picker(), collection = new Picker(), savedV = new Picker(), characterPreset = new Picker();
  const device = createBrowserFileDevice({ document: {} as Document,
    pickers: { recipe, collection, savedV, characterPreset } as unknown as Record<"recipe" | "collection" | "savedV" | "characterPreset", HTMLInputElement> });
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

test("browser picker abort resolves its wait and removes selection and cancellation listeners", async () => {
  class ObservedPicker extends Picker {
    readonly active = new Set<string>();
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
      this.active.add(type); super.addEventListener(type, listener, options);
    }
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
      this.active.delete(type); super.removeEventListener(type, listener, options);
    }
  }
  const picker = new ObservedPicker(), life = new AbortController(); let clicks = 0;
  picker.onClick = () => { clicks++; };
  const device = createBrowserFileDevice({ document: {} as Document,
    pickers: { recipe: picker, collection: picker, savedV: picker, characterPreset: picker } as unknown as Record<"recipe" | "collection" | "savedV" | "characterPreset", HTMLInputElement> });
  const pending = device.pick("recipe", life.signal); expect(picker.active.size).toBe(2);
  life.abort(); expect(await pending).toBeUndefined(); expect(picker.active.size).toBe(0);
  picker.files = [new File(["late"], "late.json")]; picker.dispatchEvent(new Event("change"));
  expect(await device.pick("recipe", life.signal)).toBeUndefined(); expect(clicks).toBe(1);
});

test("workspace browser adapter keeps verification storage isolated and captures only after activation", () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); } };
  const restored = loadBrowserWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const windowEvents = new EventTarget(), documentEvents = Object.assign(new EventTarget(), { hidden: false });
  const statuses: string[] = [];
  const session = createBrowserWorkspaceSession({
    workspace, restored, verification: true, storage,
    capture: { editor: () => ({ recipe: workspace.recipe, active: 0, selected: 0, history: [], fieldSelection: {} }),
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined,
      quality: () => 512, preview: () => ({ ...workspace.preview, wire: true,
        camera: { position: [0, 0, 1], target: [0, 0, 0], fov: 42 } }) },
    sources: [], window: windowEvents, document: documentEvents, onStatus: s => statuses.push(s.kind), model: STUDIO_DOCUMENTS,
  });
  documentEvents.dispatchEvent(new Event("input")); session.flush();
  expect(stored.size).toBe(0);
  session.activate();
  documentEvents.dispatchEvent(new Event("change")); session.flush();
  expect(stored.has("xfas.workspace.verification.v1")).toBe(true);
  expect(stored.has("xfas.workspace.v1")).toBe(false);
  const early = JSON.parse(stored.get("xfas.workspace.verification.v1")!);
  expect(early.preview.wire).toBe(false);
  // The retired sidebar shell's panel memory is no longer written.
  expect(early.panels).toBeUndefined();
  session.setPreviewReady();
  documentEvents.hidden = true;
  documentEvents.dispatchEvent(new Event("visibilitychange"));
  const ready = JSON.parse(stored.get("xfas.workspace.verification.v1")!);
  expect(ready.preview.wire).toBe(true);
  expect(statuses).toContain("saved");
});
