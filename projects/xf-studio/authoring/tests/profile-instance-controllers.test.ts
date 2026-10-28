import { createLayeredEditorAdapters } from "../src/preview/browser/layered-editor-adapters";
import { withEmptyChoices } from "../src/studio-ui/panels/empty-choices";
import type { Recipe } from "../src/engines/layered-makeup/recipe";
import { recipeFile } from "../src/legacy/eye-makeup/recipe-schema";
import type { StudioPickedFile } from "../src/app/studio-file-operations";
import { presetMenu } from "../src/studio-ui/target-menus";
import { closeMenus, closePopovers, openMenu } from "../src/studio-ui/menu";
import { EYE_MAKEUP_VIEW_BINDING } from "../src/features/eye-makeup/view";
import { featureCommands } from "../src/studio-ui/views/feature-context";
import { easingScopeFor, parseUIPreferences } from "../src/app/ui-preferences";
import { tabDefaults } from "../src/app/profiles/profile-window";
import { openPalette } from "../src/studio-ui/commands";
import { generateInstanceCommands } from "./fixtures/profile-session-generator";
import { SaveExplorerSessions, saveExplorerFacade } from "../src/features/save-explorer";
import { explorerPanel } from "../src/features/save-explorer/view/panel";
import { moduleViewContext } from "../src/studio-ui/views/feature-context";
import { syntheticSave } from "./fixtures/synthetic-explorer-save";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, uninstallLightDom, lightEvent, LightElement, lightDocument } from "./light-dom";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { StudioRuntime, Frame, type Port } from "../src/studio-ui/runtime";
import { InstancePanels } from "../src/studio-ui/panels/instance-panels";
import { instanceViewPane } from "../src/studio-ui/panels/instance-view-pane";
import { viewPaneCallbacks } from "../src/studio-ui/app";
import { ViewPanels } from "../src/studio-ui/panels/view-panels";
import type { PanelController } from "../src/studio-ui/panels/collection";
import { headPanel } from "../src/studio-ui/panels/viewports";
import { presetsPanel, libraryPanel } from "../src/features/eye-makeup/view/collection";
import { finishPanel } from "../src/features/eye-makeup/view/inspector";
import { uvPanel } from "../src/features/eye-makeup/view/uv";
import { characterPanel } from "../src/studio-ui/panels/character";
import { featureViewContext } from "../src/studio-ui/views/feature-context";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { serializeDockState } from "../src/studio-ui/dock/persist";
import { captureFocusedRuntime, captureRuntime } from "../src/studio-ui/captured-runtime";
import { viewScope } from "../src/platform/core/history-service";
import { MemoryViewState, bindViewState, scopedViewState } from "../src/studio-ui/view-state";
import { createPanelUV } from "../src/preview/browser/panel-uv";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import type { Feedback } from "../src/studio-ui/feedback";
import type { createUVEditor } from "../src/legacy/eye-makeup/browser/uv-editor";

const originalGlobals = { window: globalThis.window, addEventListener: globalThis.addEventListener, removeEventListener: globalThis.removeEventListener };
const testWindow = Object.assign(new LightElement("window"), { innerWidth: 1400, innerHeight: 900 });
beforeAll(() => { installLightDom(); Object.assign(globalThis, { window: testWindow,
  addEventListener: testWindow.addEventListener.bind(testWindow), removeEventListener: testWindow.removeEventListener.bind(testWindow) }); });
afterAll(() => { uninstallLightDom(); Object.assign(globalThis, originalGlobals); });
const toasts: string[] = [];
const feedback = { toast(_tone: string, _source: string, message: string) { toasts.push(message); }, record() {}, announce() {} } as unknown as Feedback;
const node = (value: Element) => value as unknown as LightElement;
function arrange(s: Awaited<ReturnType<typeof profileContextStudio>>, ids: string[]) {
  const tree = { root: ids.length ? { kind: "group" as const, id: "controllers", panels: ids, active: ids[0]! } : null, floating: [], closed: [] };
  s.session.arrangeInstances(s.session.tabId(), serializeDockState({ wide: tree, compact: tree }));
}
function owner(s: Awaited<ReturnType<typeof profileContextStudio>>, available = () => true, generation?: (type: string) => unknown) {
  let changes = 0;
  const root = new StudioRuntime(s.port, feedback, STUDIO_CATALOGUE);
  const catalogue = { ...STUDIO_CATALOGUE, get ids() { return available() ? STUDIO_CATALOGUE.ids : []; } };
  const panels = new InstancePanels(root, { catalogue: () => catalogue, generation, changed() { changes++; }, make: (instance, rt) => instance.type === "character" ? characterPanel(rt)
    : instance.type === "library" ? libraryPanel(featureViewContext(rt, "eye-makeup"))
    : instance.type === "finish" ? finishPanel(featureViewContext(rt, "eye-makeup"))
    : instance.type === "save-explorer.explorer" ? explorerPanel(moduleViewContext(rt, "save-explorer") as never)
    : instance.type === "uv" ? uvPanel(featureViewContext(rt, "eye-makeup")) : presetsPanel(featureViewContext(rt, "eye-makeup")) });
  const paint = () => { panels.sync(); for (const panel of panels.controllers()) { document.body.append(panel.spec.element); panel.update(new Frame(s.port)); } };
  return { panels, root, paint, get changes() { return changes; } };
}
async function readyCharacters(ui: ReturnType<typeof owner>, ids: string[]) {
  const deadline = performance.now() + 5000;
  while (ids.some(id => !ui.panels.runtime(id)?.authoring.characterPanel()?.sections.some(section => section.rows.length))) {
    if (performance.now() > deadline) throw Error("Character rows did not load within five seconds");
    await Bun.sleep(5); ui.paint();
  }
  ui.paint();
}

test("G1/G1b: three real Presets and Character controllers retain their separate writers, histories and DOM IDs", async () => {
  const s = await profileContextStudio(), ids = [0, 1, 2].flatMap(i => [`presets--scene${i}`, `character--target${i}`]);
  arrange(s, ids); const ui = owner(s);
  try {
    ui.paint(); expect(ui.panels.controllers()).toHaveLength(6);
    await readyCharacters(ui, ids.filter(id => id.startsWith("character")));
    for (const i of [0, 1, 2]) {
      s.session.focus.focusView(s.session.session().views.views[(i + 1) % 3]!.id); ui.paint();
      const panel = ui.panels.controllers().find(panel => panel.spec.id === `presets--scene${i}`)!;
      const name = node(panel.spec.element).querySelector('input[aria-label="Collection name"]')!;
      name.value = `Controller ${i}`; name.dispatchEvent(lightEvent("change"));
      const port = ui.panels.runtime(panel.spec.id)!;
      expect(port.library.summary().draft?.name).toBe(`Controller ${i}`);
      const layer = port.feature("eye-makeup").view().layer()!;
      expect(port.feature("eye-makeup").dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .21 + i * .1 }).ok).toBe(true);
      const before = s.vs.map(id => s.services.characters.document(id));
      const character = ui.panels.controllers().find(panel => panel.spec.id === `character--target${i}`)!;
      const toggle = node(character.spec.element).querySelector('input[type="checkbox"]');
      expect(toggle).toBeTruthy(); toggle!.checked = false; toggle!.dispatchEvent(lightEvent("change"));
      for (const peer of [0, 1, 2].filter(n => n !== i)) expect(s.services.characters.document(s.vs[peer]!)).toEqual(before[peer]);
      expect(ui.panels.runtime(character.spec.id)!.panels.historyScope(character.spec.id)).toBe(`character:${s.vs[i]}`);
    }
    const allIds = ui.panels.controllers().flatMap(panel => node(panel.spec.element).querySelectorAll("[id]").map(element => element.id));
    expect(allIds.filter(id => id.includes("cc-choices-")).length).toBeGreaterThan(3);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const panel of ui.panels.controllers()) for (const control of node(panel.spec.element).querySelectorAll("[aria-controls]")) {
      const id = control.getAttribute("aria-controls")!;
      expect(node(panel.spec.element).querySelectorAll("[id]").filter(element => element.id === id)).toHaveLength(1);
    }
    const snapshot = s.stored(); ui.panels.dispose(); await s.dispose();
    const restarted = await profileContextStudio({ restart: snapshot }); const again = owner(restarted);
    try { again.paint(); expect(again.panels.controllers().map(panel => panel.spec.id).sort()).toEqual([...ids].sort()); }
    finally { again.panels.dispose(); await restarted.dispose(); }
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("G2: captured shell input keeps focus-moved target and refuses rebind-away/back, removal/Undo and release without a history step", async () => {
  const s = await profileContextStudio(); arrange(s, ["presets--scene0"]); const ui = owner(s);
  try {
    ui.paint(); const origin = new StudioRuntime(ui.panels.runtime("presets--scene0")!, feedback, STUDIO_CATALOGUE);
    const held = captureRuntime(origin), layer = held.runtime.port.feature("eye-makeup").view().layer()!;
    s.session.focus.focusView(s.session.session().views.views[1]!.id);
    expect(held.runtime.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .32 })).toBe(true);
    const scope = s.history.scope(viewScope(s.session.profile))!;
    const dest = s.session.panelTarget("presets--scene0"), binding = s.session.panel(dest.instance)!.binding!;
    s.session.setPanelBinding(dest.tab, dest.instance, { policy: "pinned", target: { look: s.looks[1]! } });
    s.session.setPanelBinding(dest.tab, dest.instance, binding);
    const before = JSON.stringify(s.session.session()), count = scope.timeline().steps.length;
    expect(held.runtime.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .99 })).toBe(false);
    expect(JSON.stringify(s.session.session())).toBe(before); expect(scope.timeline().steps).toHaveLength(count);
    held.release(); expect(s.targets.held()).toBe(0);
    ui.paint(); const removed = captureRuntime(new StudioRuntime(ui.panels.runtime(dest.instance)!, feedback, STUDIO_CATALOGUE));
    s.session.setPanelsOpen(dest.tab, [dest.instance], false, () => null); scope.undo();
    const revision = removed.runtime.port.feature("eye-makeup").view().revision();
    expect(removed.runtime.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .99 })).toBe(false);
    expect(removed.runtime.port.feature("eye-makeup").view().revision()).toBe(revision); removed.release();
    const released = captureRuntime(origin); released.release();
    expect(released.runtime.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .99 })).toBe(false);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("controllers release on empty tab, park and contribution withdrawal; re-enable preserves identities and memory", async () => {
  let available = true; const s = await profileContextStudio({ available: () => available }); arrange(s, ["presets--scene0", "character--target1"]);
  const ui = owner(s, () => available);
  try {
    ui.paint(); const baseline = s.authoring.contexts.held().length;
    bindViewState(new MemoryViewState()); scopedViewState("a").setExpanded(["row"], true);
    expect(scopedViewState("b").expanded("row")).toBeUndefined();
    const session = JSON.stringify(s.session.session()); available = false; ui.paint();
    expect(ui.panels.controllers()).toHaveLength(0); expect(JSON.stringify(s.session.session())).toBe(session);
    available = true; ui.paint(); expect(ui.panels.controllers()).toHaveLength(2);
    expect(s.authoring.contexts.held().length).toBe(baseline);
    arrange(s, []); ui.paint(); expect(ui.panels.controllers()).toHaveLength(0); expect(s.targets.held()).toBe(0);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); bindViewState(); }
});

test("registration replacement retires only that contribution's controllers and captures", async () => {
  const s = await profileContextStudio(); arrange(s, ["presets--scene0", "character--target0"]);
  let generation = 1; const ui = owner(s, () => true, type => type === "presets" ? generation : 0);
  try {
    ui.paint(); const character = ui.panels.controllers().find(panel => panel.spec.id === "character--target0")!;
    const original = ui.panels.controllerRuntime("presets--scene0")!, held = captureRuntime(original);
    generation++; ui.paint();
    expect(ui.panels.controllers().find(panel => panel.spec.id === "character--target0")).toBe(character);
    expect(ui.panels.controllerRuntime("presets--scene0")).not.toBe(original);
    expect(held.active()).toBe(false); expect(s.targets.held()).toBe(0);
    const command = character.commands!()[0]!; ui.panels.dispose();
    const preferences = s.port.preferences.snapshot(); command.run();
    expect(command.capability().available).toBe(false); expect(s.port.preferences.snapshot()).toEqual(preferences);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("shell pane creation and reconciliation accept real view instance IDs and withdraw only the closed pane's anchor", async () => {
  const s = await profileContextStudio({ viewPanels: true }), root = new StudioRuntime(s.port, feedback, STUDIO_CATALOGUE);
  const context = { view: { summaries: () => [], badge: () => undefined }, guidance: {} as never, appearance: {} as never };
  let shown = s.session.graph.snapshot().views.slice(0, 2).map(view => ({ view: view.id, panel: s.session.instance(view.panel) }));
  const panels: PanelController[] = [], byId = new Map<string, PanelController>();
  const empty = { root: null, floating: [], closed: [] }, state = { wide: empty, compact: empty };
  const panes = new ViewPanels({ views: () => shown, drawn: () => ({}), arrangement: () => ({ layout: null }),
    restore() {}, save() {}, catalogue() {}, attach() {}, spec: pane => pane.spec,
    dock: { addPanels() {}, removePanels() {}, dockState: state },
    make: id => instanceViewPane(root, context, id, headPanel), ...viewPaneCallbacks(panels, byId) });
  try {
    expect(shown.map(view => view.panel)).toEqual(["view--scene0", "view--scene1"]);
    expect(() => panes.start()).not.toThrow();
    for (const pane of panels) document.body.append(pane.spec.element);
    expect([...byId.keys()]).toEqual(shown.map(view => view.panel));
    expect(root.anchors.element("panel.head")).toBe(panels[0]!.spec.element);
    const survivor = panels[1]!;
    shown = shown.slice(1); expect(() => panes.sync()).not.toThrow();
    expect([...byId.keys()]).toEqual(["view--scene1"]);
    expect(root.anchors.element("panel.head")).toBe(survivor.spec.element);
    expect(root.anchors.registered()).not.toContain("panel.view--scene0");
    shown = []; panes.sync(); expect(root.anchors.element("panel.head")).toBeUndefined();
    expect(panels).toHaveLength(0); expect(byId.size).toBe(0);
  } finally { panes.dispose(); await s.dispose(); s.library.close(); }
});

test("real head panes bind their own view and look while the renderer attachment stays shared", async () => {
  const s = await profileContextStudio({ viewPanels: true }), root = new StudioRuntime(s.port, feedback, STUDIO_CATALOGUE), runtimes: StudioRuntime[] = [];
  const context = { view: { summaries: () => [], badge: () => undefined }, guidance: {} as never, appearance: {} as never };
  const panes = s.session.graph.snapshot().views.slice(0, 2).map(view => instanceViewPane(root, context, s.session.instance(view.panel), (rt, ctx, id) => {
    runtimes.push(rt); return headPanel(rt, ctx, id);
  }));
  try {
    for (let i = 0; i < panes.length; i++) {
      panes[i]!.update(new Frame(s.port));
      expect(runtimes[i]!.port.focus.targets().look).toEqual(s.looks[i]);
      const layer = runtimes[i]!.port.feature("eye-makeup").view().layer()!;
      expect(runtimes[i]!.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .4 + i * .1 })).toBe(true);
    }
    s.session.focus.focusView(s.session.session().views.views[2]!.id);
    expect(runtimes[0]!.port.focus.targets().look).toEqual(s.looks[0]);
    expect(runtimes[1]!.port.focus.targets().look).toEqual(s.looks[1]);
  } finally { for (const pane of panes) pane.dispose?.(); await s.dispose(); s.library.close(); }
});

test("two real UV controllers have separate canvases, navigation and bound gesture input, with no shared scheduler", async () => {
  const adapters: { canvas: HTMLCanvasElement; hooks: Parameters<typeof createUVEditor>[2]; disposed: boolean }[] = [];
  const factory = ((canvas: Parameters<typeof createUVEditor>[0], _controls: Parameters<typeof createUVEditor>[1], hooks: Parameters<typeof createUVEditor>[2], initial: Parameters<typeof createUVEditor>[3]) => {
    const adapter = { canvas, hooks, disposed: false }; adapters.push(adapter); let view = initial;
    return { snapshot: () => view, draw() {}, resize() {}, inputCapture: () => false, selection: () => undefined,
      viewCommand: (command: string) => { view = { ...view, mode: command === "single" ? "single" : "both" }; return true; }, navigate: () => true,
      cancelInput: () => hooks.cancel(), dispose: () => { adapter.disposed = true; }, hitAt: () => undefined };
  }) as unknown as typeof createUVEditor;
  const s = await profileContextStudio({ panelViewport: input => createPanelUV(input, { adapters: createLayeredEditorAdapters(STUDIO_COMPOSITION.region, { flat: factory }), canvases: () => [], albedo: () => undefined }) });
  const ids = [0, 1].map(i => s.session.addPanel(s.session.tabId(), "uv", { binding: { policy: "pinned", target: { look: s.looks[i]! } } }));
  arrange(s, ids); const ui = owner(s);
  try {
    ui.paint(); expect(ui.panels.controllers()).toHaveLength(2); expect(adapters).toHaveLength(2);
    expect(adapters[0]!.canvas).not.toBe(adapters[1]!.canvas);
    ui.panels.runtime(ids[0]!)!.viewport.uvCommand("single");
    expect(ui.panels.runtime(ids[1]!)!.viewport.snapshot().uv!.view?.mode).toBe("both");
    const before = ui.panels.runtime(ids[1]!)!.feature("eye-makeup").view().selected();
    adapters[0]!.hooks.select(1);
    expect(ui.panels.runtime(ids[0]!)!.feature("eye-makeup").view().selected()).toBe(1);
    expect(ui.panels.runtime(ids[1]!)!.feature("eye-makeup").view().selected()).toBe(before);
    ui.panels.dispose(); expect(adapters.every(adapter => adapter.disposed)).toBe(true);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("two Save Explorer controllers own separate sessions and a removed controller cannot recreate its session", async () => {
  const sessions = new SaveExplorerSessions({ list: async () => ({ available: true, saves: [{ folder: "ManualSave-7", kind: "manual", savedAt: "2026-09-20T10:00:00.000Z", location: "Watson", level: 3, lifePath: "Nomad", gameVersion: "2.31", saveVersion: 269, bytes: 100, screenshot: false, modded: false }] }),
    read: async () => syntheticSave(), pick: async () => undefined, thumbnail: () => null,
    names: async () => ({ engine: { enums: [], bitfields: [], classes: [], properties: [] }, scripts: { available: true, names: [] } }) }, () => Promise.resolve());
  const s = await profileContextStudio({ modules: [saveExplorerFacade(sessions)] });
  const ids = [0, 1].map(() => s.session.addPanel(s.session.tabId(), "save-explorer.explorer")); arrange(s, ids); const ui = owner(s);
  try {
    ui.paint(); for (const panel of ui.panels.controllers()) panel.spec.visibility?.(true);
    await Bun.sleep(10); ui.paint();
    const open = node(ui.panels.controllers()[0]!.spec.element).querySelector("button.save-row")!; open.click();
    await Bun.sleep(20); ui.paint();
    expect(sessions.snapshot(ids[0]!).open.phase).toBe("ready"); expect(sessions.snapshot(ids[1]!).open.phase).toBe("none");
    s.session.setPanelsOpen(s.session.tabId(), [ids[0]!], false, () => null); ui.paint(); open.click(); await Bun.sleep(5);
    expect(sessions.instances()).not.toContain(ids[0]!);
    const tab = s.session.tabId(), copy = s.session.duplicate(tab); ui.paint();
    expect(ui.panels.controllers().every(panel => !ids.includes(panel.spec.id))).toBe(true);
    s.session.show(tab); ui.paint(); expect(ui.panels.controllers().map(panel => panel.spec.id)).toEqual([ids[1]!]);
    s.session.close(tab); s.session.close(copy); ui.paint(); expect(ui.panels.controllers()).toHaveLength(0);
    expect(sessions.instances()).toHaveLength(0);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("P3-iii generator: 16 seeds of membership, capture, focus and live withdrawal return controllers/handles to baseline", async () => {
  let total = 0;
  for (let seed = 1; seed <= 16; seed++) {
    let available = true; const s = await profileContextStudio({ available: () => available }), ids = [0, 1, 2].map(i => `presets--scene${i}`);
    arrange(s, ids); const open = new Set(ids), ui = owner(s, () => available), captures: ReturnType<typeof captureRuntime>[] = [];
    try {
      for (const command of generateInstanceCommands(seed)) {
        const id = ids[command.panel]!;
        if (command.op === "park" || command.op === "show") { s.session.setPanelsOpen(s.session.tabId(), [id], command.op === "show", () => null); if (command.op === "show") open.add(id); else open.delete(id); }
        else if (command.op === "withdraw") available = false;
        else if (command.op === "resume") available = true;
        else if (command.op === "focus") s.session.focus.focusView(s.session.session().views.views[command.panel]!.id);
        else if (command.op === "capture") { const port = ui.panels.runtime(id); if (port) captures.push(captureRuntime(new StudioRuntime(port, feedback, STUDIO_CATALOGUE))); }
        else captures.pop()?.release();
        ui.paint();
        expect(ui.panels.controllers().map(panel => panel.spec.id).sort()).toEqual(available ? [...open].sort() : []); total++;
      }
    } finally { for (const held of captures) held.release(); ui.panels.dispose(); expect(s.targets.held()).toBe(0); await s.dispose(); s.library.close(); }
  }
  expect(total).toBe(768);
});

test("G2 real shell menu → naming popover transfers one capture; focus movement keeps A and dismissal refuses retained callbacks", async () => {
  const previous = globalThis.window;
  Object.assign(globalThis, { window: { innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {} } });
  const s = await profileContextStudio(); arrange(s, ["presets--follow"]); const ui = owner(s);
  try {
    s.session.focus.focusView(s.session.session().views.views[0]!.id); ui.paint();
    const rt = ui.panels.controllerRuntime("presets--follow")!, preset = rt.port.library.summary().draft!.selected!;
    const anchor = document.createElement("button"); document.body.append(anchor);
    presetMenu(rt, preset, anchor);
    expect(s.targets.held()).toBe(1);
    const rename = node(document.body).querySelectorAll(".menu-item").find(item => item.querySelector(".menu-label")?.textContent === "Rename…")!;
    rename.click(); expect(s.targets.held()).toBe(1);
    s.session.focus.focusView(s.session.session().views.views[1]!.id); ui.paint();
    const form = node(document.body).querySelector("form.popover")!, input = form.querySelector("input")!;
    input.value = "Captured original"; form.dispatchEvent(lightEvent("submit"));
    expect(s.services.collections.look(s.looks[0]!)?.name).toBe("Captured original");
    expect(s.services.collections.look(s.looks[1]!)?.name).not.toBe("Captured original"); expect(s.targets.held()).toBe(0);
    const before = JSON.stringify(s.session.session()), steps = s.history.scope(viewScope(s.session.profile))!.timeline().steps.length;
    input.value = "Late mutation"; form.dispatchEvent(lightEvent("submit")); rename.click();
    expect(s.services.collections.look(s.looks[0]!)?.name).toBe("Captured original");
    expect(JSON.stringify(s.session.session())).toBe(before); expect(s.history.scope(viewScope(s.session.profile))!.timeline().steps).toHaveLength(steps);
    const current = ui.panels.controllerRuntime("presets--follow")!, own = current.port.library.summary().draft!.selected!;
    presetMenu(current, own, anchor); expect(s.targets.held()).toBe(1);
    closeMenus(false); expect(s.targets.held()).toBe(0);
  } finally { closeMenus(false); ui.panels.dispose(); await s.dispose(); s.library.close(); Object.assign(globalThis, { window: previous }); }
});

test("G2 palette dismissal releases its capture and retained callbacks leave no Undo step", async () => {
  const s = await profileContextStudio(); arrange(s, ["presets--scene0"]); const ui = owner(s);
  try {
    ui.paint(); const held = captureRuntime(ui.panels.controllerRuntime("presets--scene0")!), layer = held.runtime.port.feature("eye-makeup").view().layer()!;
    openPalette(() => [{ id: "test.opacity", title: "Opacity", group: "Edit", capability: () => held.runtime.port.authoring.capability({ kind: "layer.setOpacity", layerId: layer.id, opacity: .4 }),
      run: () => { held.runtime.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .4 }); } }], { onClose: held.release });
    const dialog = node(document.body).querySelector("dialog.palette")!, option = dialog.querySelector(".palette-item")!;
    dialog.dispatchEvent(lightEvent("cancel")); expect(s.targets.held()).toBe(0);
    const revision = ui.panels.runtime("presets--scene0")!.feature("eye-makeup").view().revision();
    option.click(); expect(ui.panels.runtime("presets--scene0")!.feature("eye-makeup").view().revision()).toBe(revision);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("an instance observes asynchronous file-owner transitions and releases its source subscription", async () => {
  let answer!: (file: StudioPickedFile | undefined) => void;
  const s = await profileContextStudio({ pick: () => new Promise(done => { answer = done; }) }); arrange(s, ["presets--scene0"]); const ui = owner(s);
  try {
    ui.paint(); const port = ui.panels.runtime("presets--scene0")!, before = ui.changes;
    const pending = port.files.execute({ kind: "recipe.import" });
    expect(ui.changes).toBeGreaterThan(before);
    ui.panels.dispose(); const released = ui.changes; answer(undefined); await pending;
    expect(ui.changes).toBe(released); expect(s.targets.held()).toBe(0);
  } finally { answer?.(undefined); ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("G2 a palette-selected file request transfers its concrete writer before the palette closes", async () => {
  let answer!: (file: StudioPickedFile | undefined) => void;
  const s = await profileContextStudio({ pick: () => new Promise(done => { answer = done; }) }); arrange(s, ["presets--follow"]); const ui = owner(s);
  let pending: ReturnType<StudioRuntime["file"]> | undefined;
  try {
    s.session.focus.focusView(s.session.session().views.views[0]!.id); ui.paint();
    const origin = ui.panels.runtime("presets--follow")!, held = captureRuntime(ui.panels.controllerRuntime("presets--follow")!);
    const recipe = structuredClone(held.runtime.port.feature("eye-makeup").view().recipe()) as unknown as Recipe; recipe.layers[0]!.opacity = .61;
    openPalette(() => [{ id: "test.import", title: "Import recipe", group: "File", capability: () => held.runtime.port.files.capability({ kind: "recipe.import" }),
      run: () => { pending = held.runtime.file({ kind: "recipe.import" }); } }], { onClose: held.release });
    s.session.focus.focusView(s.session.session().views.views[1]!.id); ui.paint();
    node(document.body).querySelector(".palette-item")!.click();
    expect(origin.files.snapshot().busy).toBe("recipe.import");
    expect(ui.panels.runtime("presets--follow")!.files.snapshot().busy).toBe("recipe.import");
    expect(held.active()).toBe(false); expect(pending).toBeDefined();
    s.session.focus.focusView(s.session.session().views.views[1]!.id); ui.paint();
    answer({ name: "palette.json", size: 1, text: async () => JSON.stringify(recipeFile(recipe)), bytes: async () => new Uint8Array() });
    expect(await pending).toMatchObject({ ok: true });
    const a = s.bind("presets--scene0");
    expect(a.context.current().feature("eye-makeup").view().layer()!.opacity).toBe(.61); a.life.abort();
    expect(s.targets.held()).toBe(0);
  } finally { answer?.(undefined); await pending; ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("G1 real Presets rows add, rename, remove, restore and choose only their named scene after every focus move", async () => {
  const s = await profileContextStudio(), ids = [0, 1, 2].map(i => `presets--scene${i}`); arrange(s, ids); const ui = owner(s);
  try {
    let next = 0;
    const focus = () => { s.session.focus.focusView(s.session.session().views.views[++next % 3]!.id); ui.paint(); };
    const element = (id: string) => node(ui.panels.controllers().find(panel => panel.spec.id === id)!.spec.element);
    for (let i = 0; i < 3; i++) {
      const id = ids[i]!, scenes = s.session.graph.viewIds().map(view => s.session.graph.node(view, "scene").id), before = scenes.map(scene => s.session.knownScene(scene));
      focus(); element(id).querySelectorAll("button").find(button => button.textContent === "Add preset")!.click(); ui.paint();
      const added = ui.panels.runtime(id)!.library.summary().draft!.selected!;
      expect(s.session.knownScene(scenes[i]!)!.look?.look).toBe(added);
      focus(); const main = element(id).querySelector(`li[data-id="${added}"]`)!.querySelector("button.item-main")!;
      main.dispatchEvent(lightEvent("dblclick")); const input = element(id).querySelector("input.item-rename")!;
      input.value = `Pane ${i}`; input.dispatchEvent(lightEvent("keydown", { key: "Enter" })); ui.paint();
      expect(ui.panels.runtime(id)!.library.summary().draft!.presets.find(preset => preset.id === added)!.name).toBe(`Pane ${i}`);
      focus(); element(id).querySelector(`li[data-id="${added}"]`)!.querySelector("button.item-main")!.dispatchEvent(lightEvent("keydown", { key: "Delete" })); ui.paint();
      expect(ui.panels.runtime(id)!.library.summary().draft!.removed.at(-1)?.id).toBe(added);
      focus(); element(id).querySelectorAll("button").find(button => button.textContent === `Restore “Pane ${i}”`)!.click(); ui.paint();
      expect(ui.panels.runtime(id)!.library.summary().draft!.presets.some(preset => preset.id === added)).toBe(true);
      focus(); element(id).querySelector(`li[data-id="${s.looks[i]!.look}"]`)!.querySelector("button.item-main")!.click(); ui.paint();
      expect(s.session.knownScene(scenes[i]!)!.look).toEqual(s.looks[i]);
      for (const peer of [0, 1, 2].filter(peer => peer !== i)) expect(s.session.knownScene(scenes[peer]!)).toEqual(before[peer]);
    }
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("review High: the palette captures the focused unseen inspector, then keeps it across focus movement", async () => {
  const s = await profileContextStudio(), inspector = s.session.addPanel(s.session.tabId(), "finish", { binding: { policy: "pinned", target: { look: s.looks[2]! } } });
  arrange(s, ["presets--scene0", inspector]); const ui = owner(s);
  try {
    ui.paint(); s.port.focus.panel(inspector);
    const a = JSON.stringify(ui.panels.runtime("presets--scene0")!.feature("eye-makeup").view().recipe());
    const held = captureFocusedRuntime(ui.root, id => ui.panels.controllerRuntime(id))!, layer = held.runtime.port.feature("eye-makeup").view().layer()!;
    expect(held.runtime.port.focus.targets().look).toEqual(s.looks[2]);
    openPalette(() => [{ id: "opacity", title: "Set opacity", group: "Edit", capability: () => ({ available: true }),
      run: () => { held.runtime.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .43 }); } }], { signal: held.signal, onClose: held.release });
    s.port.focus.panel("presets--scene0"); node(document.body).querySelector(".palette-item")!.click();
    expect(ui.panels.runtime(inspector)!.feature("eye-makeup").view().layer()!.opacity).toBe(.43);
    expect(JSON.stringify(ui.panels.runtime("presets--scene0")!.feature("eye-makeup").view().recipe())).toBe(a);
    expect(s.authoring.drawn.ref()).toEqual(s.looks[0]); expect(s.targets.held()).toBe(0);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("review capture handoff: real palette → starter menu → naming popover each owns and releases its capture", async () => {
  const s = await profileContextStudio({ starters: true }); arrange(s, ["presets--unseen"]); const ui = owner(s);
  try {
    ui.paint(); const origin = ui.panels.controllerRuntime("presets--unseen")!;
    expect(origin.dispatch({ kind: "starters.save", layerId: origin.port.feature("eye-makeup").view().layer()!.id, name: "Own shape" })).toBe(true);
    const held = captureRuntime(origin);
    openPalette(() => featureCommands(EYE_MAKEUP_VIEW_BINDING, featureViewContext(held.runtime, "eye-makeup")).filter(command => command.id === "starters.rename"),
      { signal: held.signal, onClose: held.release });
    node(document.body).querySelector(".palette-item")!.click();
    expect(held.active()).toBe(false); expect(s.targets.held()).toBe(1);
    const item = node(document.body).querySelectorAll(".menu-item").find(item => item.querySelector(".menu-label")?.textContent === "Own shape")!;
    s.session.focus.focusView(s.session.graph.viewIds()[0]!); item.click(); expect(s.targets.held()).toBe(1);
    const form = node(document.body).querySelector("form.popover")!, input = form.querySelector("input")!;
    input.value = "Renamed own shape"; form.dispatchEvent(lightEvent("submit"));
    expect(s.starters!.list().some(item => item.name === "Renamed own shape")).toBe(true); expect(s.targets.held()).toBe(0);
    input.value = "Late rename"; form.dispatchEvent(lightEvent("submit")); item.click();
    expect(s.starters!.list().some(item => item.name === "Late rename")).toBe(false);
  } finally { closeMenus(false); closePopovers(false); ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("review closed-menu rule: dismissed own-default Delete refuses clicks, secondary keys and the row Delete key", async () => {
  const s = await profileContextStudio(), defaults = tabDefaults(s.session, s.services), tab = s.session.tabId();
  try {
    defaults.dispatch({ kind: "tabs.saveAsDefault", tab, name: "Kept default" });
    const own = s.services.defaults.list().find(item => item.name === "Kept default")!; expect(own).toBeDefined();
    const anchor = document.createElement("button"); document.body.append(anchor);
    const action = { kind: "defaults.delete" as const, default: own.id }; expect(defaults.capability(action).available).toBe(true);
    const items = [{ kind: "action" as const, label: own.name, run() {}, secondary: { icon: "trash" as const, name: "Delete default", run: () => defaults.dispatch(action) } }];
    openMenu(items, anchor);
    const row = node(document.body).querySelector(".menu-item")!, remove = node(document.body).querySelector('[aria-label="Delete default"]')!;
    closeMenus(false); const before = JSON.stringify(s.services.defaults.list()), session = JSON.stringify(s.session.session());
    row.click(); remove.click(); remove.dispatchEvent(lightEvent("keydown", { key: "Enter" }));
    remove.dispatchEvent(lightEvent("keydown", { key: "Delete" })); row.dispatchEvent(lightEvent("keydown", { key: "Delete" }));
    expect(JSON.stringify(s.services.defaults.list())).toBe(before); expect(JSON.stringify(s.session.session())).toBe(session);
    openMenu(items, anchor); node(document.body).querySelector('[aria-label="Delete default"]')!.click();
    expect(s.services.defaults.list().some(item => item.id === own.id)).toBe(false);
  } finally { closeMenus(false); await s.dispose(); s.library.close(); }
});

test("review disposal rule: global listeners return to baseline through park, reopen, rebind and tab cycles", async () => {
  const s = await profileContextStudio(), tab = s.session.tabId(), chars = ["character--target0", "character--target1"];
  const libraries = [0, 1].map(i => s.session.addPanel(tab, "library", { binding: { policy: "pinned", target: { scene: s.session.graph.node(s.session.graph.viewIds()[i]!, "scene").id } } }));
  const ids = [...chars, ...libraries]; arrange(s, ids); const ui = owner(s);
  const counts = () => [lightDocument.listenerCount("scroll"), lightDocument.listenerCount("visibilitychange"), testWindow.listenerCount("focus"), testWindow.listenerCount("scroll")];
  const baseline = counts(), active = () => { const now = counts(); expect(now.slice(0, 3)).toEqual(baseline.slice(0, 3).map(value => value + 2)); };
  try {
    ui.paint(); await readyCharacters(ui, chars); active();
    s.session.setPanelsOpen(tab, ids, false, () => null); ui.paint(); expect(counts()).toEqual(baseline);
    s.session.setPanelsOpen(tab, ids, true, () => null); ui.paint(); await readyCharacters(ui, chars); active();
    s.session.setPanelBinding(tab, chars[0]!, { policy: "pinned", target: { subject: { kind: "character", id: s.vs[2]! } } });
    ui.paint(); await readyCharacters(ui, chars); active();
    const other = s.session.duplicate(tab); ui.paint(); active();
    for (let i = 0; i < 3; i++) { s.session.show(tab); ui.paint(); active(); s.session.show(other); ui.paint(); active(); }
    ui.panels.dispose(); expect(counts()).toEqual(baseline);
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});

test("review preference rule: instance curves persist through the real preference port and stay separate", async () => {
  const s = await profileContextStudio(); arrange(s, ["presets--scene0", "presets--scene1"]); const ui = owner(s);
  try {
    ui.paint(); const a = featureViewContext(ui.panels.controllerRuntime("presets--scene0")!, "expressions"), b = featureViewContext(ui.panels.controllerRuntime("presets--scene1")!, "expressions");
    a.easing.set("expression-intensity", "inOut"); expect(a.easing.get("expression-intensity")).toBe("inOut");
    expect(b.easing.get("expression-intensity")).toBeUndefined(); b.easing.set("expression-intensity", "out");
    const stored = s.port.preferences.snapshot(), restored = parseUIPreferences(JSON.parse(JSON.stringify(stored)));
    expect(restored.easings?.[easingScopeFor("expression-intensity", "presets--scene0")]).toBe("inOut");
    expect(restored.easings?.[easingScopeFor("expression-intensity", "presets--scene1")]).toBe("out");
    expect(a.easing.get("expression-intensity")).toBe("inOut");
  } finally { ui.panels.dispose(); await s.dispose(); s.library.close(); }
});


test("P3-vi real controllers: last look removal keeps collection recovery/imports; subject restoration reacquires its own context", async () => {
  const s = await profileContextStudio(), look = s.looks[2]!, character = s.vs[2]!, preset = "presets--scene2", person = "character--target2";
  arrange(s, [preset, person]);
  const root = new StudioRuntime(s.port, feedback, STUDIO_CATALOGUE);
  const panels = new InstancePanels(root, { catalogue: () => STUDIO_CATALOGUE, changed() {}, make: (instance, rt) =>
    withEmptyChoices(rt, instance.type === "character" ? characterPanel(rt) : presetsPanel(featureViewContext(rt, "eye-makeup"))) });
  const paint = () => { panels.sync(); for (const p of panels.controllers()) { document.body.append(p.spec.element); p.update(new Frame(s.port)); } };
  const visible = (n: LightElement) => { for (let at: LightElement | null = n; at; at = at.parentNode) if (at.hidden) return false; return true; };
  try {
    paint(); const before = s.session.session().views.scenes.map(scene => structuredClone(scene));
    const collection = s.services.collections.collection(look.collection)!;
    expect(collection.looks).toHaveLength(1);
    s.services.collections.dispatch({ kind: "collection.removeLook", collection: collection.id, base: collection.revision, look: look.look }); paint();
    const rt = panels.runtime(preset)!;
    expect(rt.library.summary().draft!.removed.map(item => item.id)).toContain(look.look);
    const content = node(panels.controllers().find(p => p.spec.id === preset)!.spec.element);
    expect(content.querySelectorAll("button").some(b => visible(b) && b.textContent.startsWith("Restore "))).toBe(true);
    expect(content.querySelectorAll("button").some(b => visible(b) && b.textContent.includes("Import recipe as preset"))).toBe(true);
    expect(content.querySelectorAll("button").some(b => visible(b) && b.textContent === "Create a look")).toBe(false);
    const restoreLook = s.emptyChoices.snapshot(preset)!.choices.find(c => "restore" in c.action.choice)!.action;
    expect(await s.emptyChoices.execute(restoreLook)).toEqual({ ok: true }); paint();
    expect(panels.runtime(preset)!.library.summary().draft!.selected).toBe(look.look);
    const ready = async () => { const deadline = performance.now() + 5000;
      while (!panels.runtime(person)!.authoring.characterPanel() && performance.now() < deadline) { await Bun.sleep(5); paint(); }
      expect(panels.runtime(person)!.authoring.characterPanel()).not.toBeNull(); };
    await ready();
    await s.services.characters.delete(character, s.services.characters.character(character)!.revision); paint();
    expect(panels.runtime(person)!.authoring.characterPanel()).toBeNull();
    const restoreV = s.emptyChoices.snapshot(person)!.choices.find(c => "restore" in c.action.choice)!.action;
    expect(await s.emptyChoices.execute(restoreV)).toEqual({ ok: true }); paint(); await ready();
    expect(panels.runtime(person)!.authoring.characterPanel()).not.toBeNull();
    expect(s.session.session().views.scenes).toEqual(before);
    expect(s.targets.describe(person).statuses.subject).toMatchObject({ state: "present", instance: person, owner: { kind: "character", id: character } });
  } finally { panels.dispose(); await s.dispose(); s.library.close(); }
});


for (const route of ["root", "scene", "pin"] as const) test(`P3-vi: ${route} imports remain usable beside a removed last look and replace only the captured destination`, async () => {
  const s = await profileContextStudio(), ref = s.looks[2]!, view = s.session.graph.viewIds()[2]!, scene = s.session.graph.node(view, "scene").id;
  try {
    const recipe = s.bind("presets--unseen").context.current().feature("eye-makeup").view().recipe(), text = JSON.stringify(recipeFile(structuredClone(recipe) as Recipe));
    s.fileDevice.pick = async () => ({ name: "recovery-import.json", size: text.length, text: async () => text, bytes: async () => new TextEncoder().encode(text) });
    s.draw(view); const collection = s.services.collections.collection(ref.collection)!;
    s.services.collections.dispatch({ kind: "collection.removeLook", collection: ref.collection, base: collection.revision, look: ref.look });
    const port = route === "root" ? s.port : s.bind(route === "scene" ? "presets--scene2" : "presets--unseen").context.current();
    const before = s.session.session().views.scenes;
    expect((await port.files.execute({ kind: "recipe.import" })).ok).toBe(true);
    expect(s.services.collections.targetStatus(ref).state).toBe("removed");
    const added = s.services.collections.collection(ref.collection)!.looks[0]!; expect(added).not.toBe(ref.look);
    if (route === "pin") { expect(s.session.scene(scene).look).toEqual(ref); expect(s.session.panel("presets--unseen")!.binding).toEqual({ policy: "pinned", target: { look: { collection: ref.collection, look: added } } }); }
    else expect(s.session.scene(scene).look).toEqual({ collection: ref.collection, look: added });
    for (const peer of before.filter(s => s.id !== scene)) expect(s.session.scene(peer.id)).toEqual({ subject: peer.subject, look: peer.look, gen: peer.gen });
    expect(s.targets.held()).toBe(0);
  } finally { await s.dispose(); s.library.close(); }
});

test("P3-vi: restoring a removed look while its import picker is open refuses the old recovery capture", async () => {
  let answer!: (file: StudioPickedFile | undefined) => void;
  const s = await profileContextStudio({ pick: () => new Promise(resolve => { answer = resolve; }) }), ref = s.looks[2]!;
  let pending: Promise<unknown> | undefined;
  try {
    const text = JSON.stringify(recipeFile(structuredClone(s.bind("presets--unseen").context.current().feature("eye-makeup").view().recipe()) as Recipe));
    const collection = s.services.collections.collection(ref.collection)!;
    s.services.collections.dispatch({ kind: "collection.removeLook", collection: ref.collection, base: collection.revision, look: ref.look });
    pending = s.bind("presets--scene2").context.current().files.execute({ kind: "recipe.import" });
    expect(s.targets.held()).toBeGreaterThan(0);
    const removed = s.services.collections.collection(ref.collection)!;
    s.services.collections.dispatch({ kind: "collection.restoreLook", collection: ref.collection, base: removed.revision, look: ref.look });
    answer({ name: "late.json", size: text.length, text: async () => text, bytes: async () => new TextEncoder().encode(text) });
    expect(await pending).toMatchObject({ ok: false, code: "missing_target" });
    expect(s.services.collections.collection(ref.collection)!.looks).toEqual([ref.look]); expect(s.targets.held()).toBe(0);
  } finally { answer?.(undefined); await pending; await s.dispose(); s.library.close(); }
});
