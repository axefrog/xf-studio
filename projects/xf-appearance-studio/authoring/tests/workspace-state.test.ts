import { test, expect } from "bun:test";
import { freshWorkspace, loadWorkspace, parseWorkspace, workspaceKeys } from "../src/workspace-state";
import { readSavedV } from "../src/save-reader";

test("workspace migration preserves legacy drafts and isolates verification; unreadable work is protected", () => {
  const main = workspaceKeys(false), verify = workspaceKeys(true), draft = freshWorkspace().recipe;
  draft.layers[1].color = "#123456";
  const records = new Map([[main.legacy, JSON.stringify(draft)]]);
  const storage = { getItem: (key: string) => records.get(key) ?? null };
  expect(loadWorkspace(storage, false).state.recipe).toEqual(draft);
  expect(loadWorkspace(storage, true).state.recipe).not.toEqual(draft);
  expect(main.workspace).not.toBe(verify.workspace);
  records.set(main.workspace, "{broken");
  const failed = loadWorkspace(storage, false);
  expect(failed.writable).toBe(false);
  expect(failed.state.recipe).toEqual(draft);
  expect(records.get(main.workspace)).toBe("{broken");
  expect(loadWorkspace({ getItem() { throw Error("denied"); } }, false).writable).toBe(false);
});

test("workspace restores edited selection, camera, library revision and undo without aliasing", () => {
  const state = freshWorkspace();
  state.active = 2; state.selected = 4;
  state.preview.camera = { position: [.2, 1.6, -.4], target: [0, 1.6, 0], fov: 47 };
  state.preview.idle = true; state.preview.idleTime = 12.345;
  state.preview.brows = false;
  state.library = { name: "Unsaved name", selected: "11111111-2222-3333-4444-555555555555",
    current: { id: "11111111-2222-3333-4444-555555555555", revision: 7 } };
  state.panels = { lighting: true, layersScroll: 40, propertiesScroll: 900, pageX: 0, pageY: 50, sidebarLeft: 370, sidebarRight: 410 };
  state.history.push(structuredClone(state.recipe));
  const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
  expect(restored).toEqual(state);
  restored.recipe.layers[0].color = "#000000";
  expect(restored.history[0].layers[0].color).toBe(state.recipe.layers[0].color);
  expect(state.recipe.layers[0].color).not.toBe("#000000");
  state.active = 90; state.selected = -1;
  state.preview.camera.position = [...state.preview.camera.target];
  state.preview.exposure = Infinity;
  state.library.current!.revision = -2;
  const sanitized = parseWorkspace(state);
  expect(sanitized.active).toBe(0); expect(sanitized.selected).toBe(0);
  expect(sanitized.preview.camera).toBeUndefined();
  expect(sanitized.preview.exposure).toBe(1.2);
  expect(sanitized.library.current).toBeUndefined();
  expect(() => parseWorkspace({ ...state, schema: "future" })).toThrow();
  expect(() => parseWorkspace({ ...state, savedV: {} })).toThrow();
});

test("private saved V survives workspace JSON independently of authored makeup and eye override", async () => {
  const file = Bun.file(new URL("../../../../captures/2026-09-23-save-appearance/sav.dat", import.meta.url));
  if (!(await file.exists())) return;
  const state = freshWorkspace();
  state.savedV = readSavedV(await file.bytes());
  state.preview.eyeShape = 5; // User may inspect another eye shape after importing.
  state.recipe.layers[0].color = "#aabbcc";
  const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
  expect(restored.savedV).toEqual(state.savedV);
  expect(restored.preview.eyeShape).toBe(5);
  expect(restored.recipe.layers[0].color).toBe("#aabbcc");
  expect(restored.savedV!.groups.head.find(g => g.name === "character_customization")!.morphs.map(m => m.target))
    .toEqual(["h091", "h012", "h053", "h054", "h145"]);
});
