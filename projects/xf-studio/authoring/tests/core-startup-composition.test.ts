import { expect, test } from "bun:test";
import { EMPTY_STARTUP_COMPOSITION as EMPTY, STUDIO_STARTUP_COMPOSITION as NORMAL, selectStartupComposition } from "../src/compose/startup-composition";
import { loadCompositionWorkspace, createBrowserWorkspaceSession } from "../src/app/browser/browser-workspace-device";
import { registeredStarters } from "../src/app/starters/feature-starters";
import { studioLayoutDefaults } from "../src/compose/layout-defaults";
import { OFF_EXPERIMENTS } from "../src/platform/core/experiments";
import { migrationSnapshot, sessionOfWorkspace, dockPanels } from "../src/app/profiles/profiles-migration-data";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { openTestLibrary } from "./fixtures/library-file";
import { libraryPort } from "./fixtures/profile-studio";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { serializeWorkspace } from "../src/app/workspace/workspace-state";
import { editorComposition, SYNTHETIC_LAYERED } from "./fixtures/editor-composition";
import { Registry } from "../src/platform/core/registry";

test("alternate composition selection refuses before normal workspace startup", () => {
  expect(selectStartupComposition("")).toBe(NORMAL);
  expect(selectStartupComposition("?composition=normal")).toBe(NORMAL);
  for (const query of ["?composition=empty", "?verify=0&composition=empty", "?verify&composition=empty", "?composition=unknown"])
    expect(() => selectStartupComposition(query)).toThrow("?verify=1");
  expect(selectStartupComposition("?verify=1&composition=empty")).toBe(EMPTY);
  expect(() => selectStartupComposition("?verify=1&composition=unknown")).toThrow("Unknown verification composition");
  const fixture = editorComposition([SYNTHETIC_LAYERED]);
  const synthetic = { ...EMPTY, documents: { parts: fixture.parts }, registry: new Registry([...EMPTY.registry.owners(), ...fixture.registry.owners()]) };
  expect(() => selectStartupComposition("", synthetic)).toThrow("?verify=1");
  expect(selectStartupComposition("?verify=1", synthetic)).toBe(synthetic);
});

test("empty startup uses neutral workspace, shell catalogue and shell layout only", () => {
  const reads: string[] = [];
  const restored = loadCompositionWorkspace({ getItem(key) { reads.push(key); return null; } }, true, EMPTY);
  expect(reads.every(key => key.includes("verification"))).toBe(true);
  expect("recipe" in restored.state).toBe(false);
  expect(restored.state.liveFeatures).toBeUndefined();
  expect(EMPTY.documents.parts.features()).toEqual([]);
  expect(EMPTY.registry.owners().every(owner => owner.owner === "system")).toBe(true);
  expect(registeredStarters(EMPTY.registry, EMPTY.documents)).toBeUndefined();
  expect(EMPTY.renderers).toEqual([]); expect(EMPTY.surfaces.size).toBe(0); expect(EMPTY.facePoses).toEqual([]);
  const layouts = studioLayoutDefaults(OFF_EXPERIMENTS, undefined, { modules: EMPTY.modules, views: EMPTY.views, catalogue: EMPTY.view.catalogue });
  expect(layouts.contributed.list()).toEqual([]);
  expect(layouts.catalogue().ids).toEqual(EMPTY.view.catalogue.ids);
  expect(layouts.catalogue().ids).not.toContain("uv");
  expect(layouts.known.panel("layers")).toBe(false); expect(layouts.known.tool("eye-makeup.surface")).toBe(false);
  const session = sessionOfWorkspace(restored.state, { tab: "Empty" }, () => .2, layouts.initial);
  expect(session.tabs[0]!.panels.some(panel => panel.type === "view")).toBe(true);
  expect(session.tabs[0]!.panels.every(panel => panel.type === "view" || EMPTY.view.catalogue.ids.includes(panel.type))).toBe(true);
  expect(dockPanels(layouts.initial.dock)).not.toContain("uv");
  const migration = migrationSnapshot(restored.state, EMPTY.documents, "empty");
  expect(migration.drafts.every(draft => draft.looks.every(look => Object.keys(look.parts).length === 0))).toBe(true);
});

test("Save Explorer first keeps its viewless default during startup layout construction", () => {
  const saveExplorer = NORMAL.modules.modules.find(module => module.id === "save-explorer")!;
  expect(saveExplorer.defaults![0]!.fragment.views).toEqual([]);
  const modules = { ...NORMAL.modules, modules: [saveExplorer, ...NORMAL.modules.modules.filter(module => module !== saveExplorer)] };
  const layouts = studioLayoutDefaults(OFF_EXPERIMENTS, undefined, { modules, views: NORMAL.views, catalogue: NORMAL.view.catalogue });
  expect(layouts.initial.origin).toBe("save-explorer/default");
  expect(layouts.initial.dock as unknown).toEqual(saveExplorer.defaults![0]!.fragment.tab.dock);
  expect(dockPanels(layouts.initial.dock)).not.toContain("head");
  const { state: workspace } = loadCompositionWorkspace({ getItem: () => null }, true, NORMAL);
  const session = sessionOfWorkspace(workspace, { tab: "Save Explorer" }, () => .2, layouts.initial);
  expect(session.tabs[0]!.origin).toBe("save-explorer/default");
  expect(session.tabs[0]!.panels.some(panel => panel.type === "save-explorer.explorer")).toBe(true);
});

test("neutral session flush keeps workspace and normal storage isolated", () => {
  const stored = new Map([["xfas.workspace.v1", "normal-sentinel"]]);
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } };
  const restored = loadCompositionWorkspace(storage, true, EMPTY), workspace = restored.state;
  const session = createBrowserWorkspaceSession({ workspace, restored, storage, verification: true, model: EMPTY.documents,
    capture: { editor: () => ({ features: workspace.liveFeatures, history: workspace.history }), uvView: () => workspace.uvView,
      savedV: () => workspace.savedV, collections: () => workspace.collections, quality: () => workspace.preview.textureSize, preview: () => undefined },
    sources: [], window: new EventTarget(), document: Object.assign(new EventTarget(), { hidden: false }), onStatus() {} });
  try {
    session.activate(); expect(session.flush()).toBe(true);
    expect(stored.get("xfas.workspace.v1")).toBe("normal-sentinel");
    const saved = JSON.parse(stored.get("xfas.workspace.verification.v1")!);
    expect(saved.look.parts).toEqual({}); expect(saved.look.memory).toEqual({});
    expect(saved.look).toEqual(serializeWorkspace(workspace, EMPTY.documents).look);
  } finally { session.retire(); }
});

test("registered normal starters preserve defaults, parts and feature-wide memory", async () => {
  const { state: workspace } = loadCompositionWorkspace({ getItem: () => null }, true, NORMAL);
  const library = openTestLibrary(), documents = libraryPort(library), outbox = new DocumentOutbox(documents, memoryOutboxStorage()); outbox.open();
  try {
    const feature = NORMAL.documents.live!, contribution = registeredStarters(NORMAL.registry, NORMAL.documents)!;
    const starter = contribution.create({ workspace, documents, outbox, writable: () => true, note() {}, report(error) { throw error; } });
    await starter.shapes.load();
    expect(starter.actions.port().snapshot().defaultId).toBe(NORMAL.region!.defaultStarter);
    expect(starter.part()).toEqual(NORMAL.region!.starter(starter.shapes.shapeOf()));
    workspace.featureMemory![feature] = { ...workspace.featureMemory![feature] as object, choices: { retained: true } };
    const alternate = starter.shapes.list().find(item => item.id !== starter.shapes.defaultId())!;
    expect(starter.shapes.setDefault(alternate.id).ok).toBe(true);
    expect(workspace.featureMemory![feature]).toMatchObject({ choices: { retained: true }, defaultStarter: alternate.id });
    expect(starter.part()).toEqual(NORMAL.region!.starter(alternate.shape));
  } finally { outbox.stop(); library.close(); }
});

test("normal neutral capture maps document fields without replacing feature-wide preferences", () => {
  const restored = loadCompositionWorkspace({ getItem: () => null }, true, NORMAL), workspace = restored.state;
  const feature = NORMAL.documents.live!;
  workspace.featureMemory![feature] = { choices: { retained: true }, defaultStarter: "retained-choice" };
  const before = serializeWorkspace(workspace, NORMAL.documents);
  const session = createBrowserWorkspaceSession({ workspace, restored, storage: { setItem() {} }, verification: true, model: NORMAL.documents,
    capture: { editor: () => ({ features: workspace.liveFeatures, history: workspace.history, locked: workspace.liveLocked }),
      uvView: () => workspace.uvView, savedV: () => workspace.savedV, collections: () => workspace.collections,
      quality: () => workspace.preview.textureSize, preview: () => undefined },
    sources: [], window: new EventTarget(), document: Object.assign(new EventTarget(), { hidden: false }), onStatus() {} });
  try {
    const captured = session.snapshot();
    expect("features" in captured).toBe(false); expect("locked" in captured).toBe(false);
    expect(captured.liveFeatures).toEqual(workspace.liveFeatures);
    expect(serializeWorkspace(captured, NORMAL.documents)).toEqual(before);
  } finally { session.retire(); }
});
