import { test, expect } from "bun:test";
import { freshWorkspace, loadWorkspace, parseWorkspace, workspaceKeys } from "../src/workspace-state";
import { readSavedV } from "../src/save-reader";
import { initialRecipe, newLayerTemplate, parseRecipe } from "../src/recipe";

test("an absent browser workspace starts with one editable four-point makeup area", () => {
  const keys = workspaceKeys(false);
  const empty = { getItem: () => null };
  const starter = loadWorkspace(empty, false);
  expect(starter.writable).toBe(true);
  expect(starter.state.recipe.layers).toHaveLength(1);
  const layer = starter.state.recipe.layers[0];
  expect(layer.enabled).toBe(true);
  expect(layer.points).toEqual(newLayerTemplate().points);
  expect(layer.fields).toEqual([]);
  expect(layer.symmetry).toBe(true);
  expect(layer.finish).toBe("matte");
  expect(parseRecipe(starter.state.recipe)).toEqual(starter.state.recipe);

  const saved = structuredClone(starter.state);
  saved.recipe.layers[0].points[0].u += .004;
  saved.recipe.layers[0].color = "#123456";
  const restored = loadWorkspace({ getItem: key => key === keys.workspace ? JSON.stringify(saved) : null }, false);
  expect(restored.state.recipe).toEqual(saved.recipe);

  const historical = initialRecipe();
  expect(historical.layers).toHaveLength(4);
  const legacy = loadWorkspace({ getItem: key => key === keys.legacy ? JSON.stringify(historical) : null }, false);
  expect(legacy.state.recipe).toEqual(historical);
});

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
  state.history.push(structuredClone(state.recipe));
  const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
  expect(restored).toEqual(state);
  // A workspace saved with the retired sidebar shell's panel memory still restores; that memory is dropped.
  const older = parseWorkspace({ ...JSON.parse(JSON.stringify(state)), panels: { lighting: true, previewQuality: true, layersScroll: 40,
    propertiesScroll: 900, pageX: 0, pageY: 50, sidebarLeft: 1370, sidebarRight: 1410 } });
  expect(older).toEqual(state);
  expect("panels" in older).toBe(false);
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

test("far narrow-FOV framing survives reload but out-of-range orbit does not", () => {
  const state = freshWorkspace();
  state.preview.camera = { position: [.03, 1.69, -3.02], target: [.03, 1.69, .005], fov: 10 };
  expect(parseWorkspace(JSON.parse(JSON.stringify(state))).preview.camera).toEqual(state.preview.camera);
  state.preview.camera.position[2] = -4;
  expect(parseWorkspace(state).preview.camera).toBeUndefined();
});

test("preview texture size persists independently of recipes; older documents keep defaults", () => {
  const state = freshWorkspace(), originalRecipe = structuredClone(state.recipe);
  expect(state.preview.textureSize).toBe(1024);
  for (const size of [512,1024,2048,4096] as const) {
    state.preview.textureSize = size;
    const restored = parseWorkspace(JSON.parse(JSON.stringify(state)));
    expect(restored.preview.textureSize).toBe(size);
    expect(restored.recipe).toEqual(originalRecipe);
  }
  const old = JSON.parse(JSON.stringify(state)); delete old.preview.textureSize;
  const migrated = parseWorkspace(old);
  expect(migrated.preview.textureSize).toBe(1024);
  for (const size of [null,"2048",0,768,8192,NaN,Infinity]) {
    const malformed = parseWorkspace({...state,preview:{...state.preview,textureSize:size},panels:{previewQuality:"true"}});
    expect(malformed.preview.textureSize).toBe(1024);
    expect(malformed.recipe).toEqual(originalRecipe);
  }
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

test("paused idle and contribution choices round trip, and legacy workspaces preserve both motions", () => {
  const state = freshWorkspace();
  state.preview.idle = true; state.preview.idlePaused = true; state.preview.idleTime = 19.125;
  state.preview.idleBody = false; state.preview.idleFace = true;
  state.preview.camera = { position: [.03, 1.66, -.6], target: [.03, 1.66, .005], fov: 22 };
  expect(parseWorkspace(JSON.parse(JSON.stringify(state)))).toEqual(state);
  const old = JSON.parse(JSON.stringify(state));
  delete old.preview.idlePaused; delete old.preview.idleBody; delete old.preview.idleFace;
  const migrated = parseWorkspace(old);
  expect(migrated.preview.idlePaused).toBe(false); expect(migrated.preview.idleBody).toBe(true);
  expect(migrated.preview.idleFace).toBe(true); expect(migrated.preview.idleTime).toBe(19.125);
  const malformed = parseWorkspace({ ...state, preview: { ...state.preview, idlePaused: "true", idleBody: 0, idleFace: null } });
  expect(malformed.preview.idlePaused).toBe(false); expect(malformed.preview.idleBody).toBe(true); expect(malformed.preview.idleFace).toBe(true);
  state.preview.idle = false;
  const disabled = parseWorkspace(state);
  expect(disabled.preview.idlePaused).toBe(false); expect(disabled.preview.idleBody).toBe(false);
  expect(disabled.preview.camera).toEqual(state.preview.camera);
});
