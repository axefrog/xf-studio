import { expect, test } from "bun:test";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { contextCandidates, type StudioContextHit } from "../src/studio-context-targets";
import { convertToBezier } from "../src/engines/layered-makeup/bezier-path";
import { matchCommands } from "../src/studio-ui/commands";
import { libraryState } from "../src/studio-ui/panels/collection";
import { Frame, type Port } from "../src/studio-ui/runtime";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { activitySource } from "../src/studio-ui/views/contribution";
const sourceLabel = (kind: string) => activitySource(kind, STUDIO_CATALOGUE);
import { studioShortcut } from "../src/studio-ui/shortcuts";
import { CONTEXT_LABELS, undoHint } from "../src/studio-ui/target-menus";
import { initialRecipe } from "./fixtures/eye-region";

const key = (key: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}) =>
  ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift });
const plain = { textInput: false, modalOpen: false };

test("shortcuts: Undo/Redo in either case, never inside text fields; palette, save, regions and help", () => {
  expect(studioShortcut(key("z", { ctrl: true }), plain)).toBe("undo");
  expect(studioShortcut(key("Z", { ctrl: true }), plain)).toBe("undo");
  expect(studioShortcut(key("Z", { ctrl: true, shift: true }), plain)).toBe("redo");
  expect(studioShortcut(key("y", { meta: true }), plain)).toBe("redo");
  expect(studioShortcut(key("Y", { ctrl: true, shift: true }), plain)).toBeUndefined();
  expect(studioShortcut(key("z", { ctrl: true }), { ...plain, textInput: true })).toBeUndefined();
  expect(studioShortcut(key("z"), plain)).toBeUndefined();
  expect(studioShortcut(key("K", { ctrl: true }), { ...plain, textInput: true })).toBe("palette");
  expect(studioShortcut(key("p", { ctrl: true, shift: true }), plain)).toBe("palette");
  expect(studioShortcut(key("s", { meta: true }), { ...plain, textInput: true })).toBe("save");
  expect(studioShortcut(key("F6", { shift: true }), plain)).toBe("regions-back");
  expect(studioShortcut(key("?"), plain)).toBe("help");
  expect(studioShortcut(key("?"), { ...plain, modalOpen: true })).toBeUndefined();
  expect(studioShortcut(key("?"), { ...plain, textInput: true })).toBeUndefined();
});

test("palette search requires every term in the title, group or keywords", () => {
  const commands = [{ title: "Export collection", group: "Files" }, { title: "Build mod files", group: "Mod package", keywords: "archive build" },
    { title: "Undo", group: "Edit" }];
  expect(matchCommands(commands, "")).toHaveLength(3);
  expect(matchCommands(commands, "  FILES  ").map(item => item.title)).toEqual(["Export collection", "Build mod files"]);
  expect(matchCommands(commands, "archive mod").map(item => item.title)).toEqual(["Build mod files"]);
  expect(matchCommands(commands, "export archive")).toEqual([]);
});

test("every context-menu candidate has a label, and destructive entries name their recovery path", () => {
  const recipe = initialRecipe(), layer = recipe.layers[0];
  recipe.layers[1] = convertToBezier(recipe.layers[1]);
  const bezier = recipe.layers[1];
  const hits: StudioContextHit[] = [{ kind: "collection" }, { kind: "preset", id: "p" }, { kind: "layer", id: layer.id },
    { kind: "shape", layerId: layer.id }, { kind: "point", layerId: layer.id, index: 0 },
    { kind: "tangent", layerId: bezier.id, index: 0, side: "outgoing" }, { kind: "field", layerId: layer.id, id: "f" }, { kind: "uv-empty" }];
  const ids = new Set(hits.flatMap(hit => contextCandidates(hit, recipe).map(candidate => candidate.id)));
  expect(ids.has("point.mode.corner")).toBe(true);
  expect([...ids].filter(id => !CONTEXT_LABELS[id])).toEqual([]);
  expect(undoHint("part", "layer.remove")).toBe("Undo with Ctrl+Z");
  expect(undoHint("recovery", "preset.remove")).toBe("Restorable from the Presets panel");
  expect(undoHint("part", "layer.duplicate")).toBeUndefined();
});

test("every action ID has an activity source label", () => {
  expect(Object.keys(ACTION_DESCRIPTORS).filter(kind => sourceLabel(kind) === "Studio")).toEqual([]);
  expect(sourceLabel("history.redo")).toBe("Undo");
  expect(sourceLabel("shape.transform")).toBe("Shape");
  expect(sourceLabel("layer.setOpacity")).toBe("Colour & finish");
});

test("a paint frame reads each port source at most once", () => {
  let reads = 0;
  const port = { feature: () => ({ view: () => ({ recipe: () => (reads++, initialRecipe()) }) }), library: { summary: () => (reads++, {}) } } as unknown as Port;
  const frame = new Frame(port);
  void frame.recipe; void frame.recipe; void frame.library; void frame.library;
  expect(reads).toBe(2);
});

test("the library chip distinguishes unsaved, saved, newer-elsewhere and busy states", () => {
  const frame = (library: object, persistence?: object) => ({ library, persistence }) as unknown as Frame;
  const draft = { id: "c", name: "C", revision: 3, presets: [] };
  expect(libraryState(frame({ summaries: [] })).label).toBe("Loading library…");
  expect(libraryState(frame({ summaries: [], draft: { ...draft, revision: undefined } })).label).toBe("Not saved yet");
  expect(libraryState(frame({ summaries: [{ id: "c", revision: 5 }], draft })).label).toBe("Newer version saved");
  expect(libraryState(frame({ busy: true, progress: { phase: "working", message: "Saving" }, summaries: [], draft })).label).toBe("Working…");
  expect(libraryState(frame({ summaries: [], draft }, { baseline: "known", dirty: false, dirtyPresets: [] })).label).toBe("Saved");
  const dirty = libraryState(frame({ summaries: [], draft }, { baseline: "known", dirty: true, dirtyPresets: ["a", "b"], structureDirty: true }));
  expect(dirty).toMatchObject({ label: "Unsaved changes", tone: "info" });
  expect(dirty.detail).toContain("Last saved as version 3 in your library; saving creates version 4");
  expect(dirty.detail).toContain("the collection name or preset order and 2 presets");
  expect(libraryState(frame({ summaries: [], draft }, { baseline: "unknown", dirtyPresets: [] })).label).toBe("Autosaved draft");
});
