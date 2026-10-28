import { afterAll, beforeAll, expect, test } from "bun:test";
import * as THREE from "three";
import { installLightDom, uninstallLightDom, LightElement } from "./light-dom";
import { profileContextStudio } from "./fixtures/profile-context-studio";
import { editorComposition, SYNTHETIC_LAYERED } from "./fixtures/editor-composition";
import { Registry } from "../src/platform/core/registry";
import { STUDIO_OWNERS } from "../src/compose/studio-registry";
import { createPanelUV } from "../src/preview/browser/panel-uv";
import { createBrowserViewportDevice } from "../src/preview/browser/browser-viewport-device";
import { registeredEditorAdapters, type BrowserEditorAdapters } from "../src/preview/browser/editor-adapters";
import { createLayeredEditorAdapters } from "../src/preview/browser/layered-editor-adapters";
import { createSceneEditors } from "../src/preview/browser/scene-editors";
import type { createSurfaceEditor } from "../src/legacy/eye-makeup/browser/surface-editor";
import { EYE_REGION } from "./fixtures/eye-region";
import { featureViewContext } from "../src/studio-ui/views/feature-context";
import { StudioRuntime } from "../src/studio-ui/runtime";

const previous = globalThis.window;
beforeAll(() => { installLightDom(); Object.assign(globalThis, { window: new LightElement("window") }); });
afterAll(() => { uninstallLightDom(); Object.assign(globalThis, { window: previous }); });

test("two registered surface adapters edit their own looks in two views; commit, Escape and abort stay independent", async () => {
  const s = await profileContextStudio();
  const hooks: Parameters<typeof createSurfaceEditor>[1][] = [], disposed: number[] = [];
  const adapters = createLayeredEditorAdapters(EYE_REGION, { surface: ((_viewer: unknown, given: Parameters<typeof createSurfaceEditor>[1]) => {
    const index = hooks.push(given) - 1;
    return { resize() {}, inputCapture: () => false, hitAt: () => undefined, setEnabled() {},
      cancelInput: () => given.cancel(), dispose: () => disposed.push(index) };
  }) as unknown as typeof createSurfaceEditor });
  const registry = new Registry(STUDIO_OWNERS.map(owner => owner.owner === "feature" && owner.id === "eye-makeup" ? { ...owner, editors: adapters } : owner));
  const lives = [new AbortController(), new AbortController()];
  const devices: ReturnType<typeof createBrowserViewportDevice>[] = [], releases: (() => void)[] = [];
  try {
    const cores = lives.map((life, i) => ({ ...s.core, ...s.authoring.contexts.acquire(s.looks[i]!, life.signal)!.context }));
    for (const [i, core] of cores.entries()) {
      core.app.useActionRegistry(registry);
      const plate = { geometry: new THREE.PlaneGeometry(1, 1) } as unknown as THREE.SkinnedMesh;
      const renderer = { feature: "eye-makeup" };
      const scene = { slot: {}, feature: () => ({ surface: plate }), dispose() {} };
      const viewport = createBrowserViewportDevice({ headHost: document.createElement("div"), surface: registeredEditorAdapters(core)?.surface,
        queryContext: hit => core.app.contextQuery(hit), deviceFactory: (() => ({ show() {} })) as never, sceneFactory: (async () => scene) as never });
      devices.push(viewport); viewport.showHead(await viewport.buildHead());
      const editors = createSceneEditors({ core, surfaces: new Map([["eye-makeup", renderer]]) as never, look: { feature: "eye-makeup", preview: {} as never },
        naming: { look: () => s.looks[i], complete: action => ({ ...action, look: s.looks[i] }) as never }, drawn: () => i ? "side" : "main",
        viewport, attach() {}, message() {} });
      releases.push(editors.mount({ scene, surfaceControls: () => true, onSurfaceControls: () => () => {} } as never, i ? "side" : "main"));
    }
    expect(hooks).toHaveLength(2);
    const [a, b] = hooks, before = cores.map(core => structuredClone(core.geometry.recipe()));
    a!.select(1); expect(cores[0]!.presentation.selected).toBe(1); expect(cores[1]!.presentation.selected).toBe(0);
    a!.begin(); b!.begin();
    expect(a!.apply({ kind: "point.replace", index: 0, next: { u: before[0]!.layers[0]!.points[0]!.u + .001 } })).toBe(true);
    expect(b!.apply({ kind: "point.replace", index: 0, next: { v: before[1]!.layers[0]!.points[0]!.v + .001 } })).toBe(true);
    a!.finish!(); b!.cancel();
    expect(cores[0]!.geometry.recipe()).not.toEqual(before[0]); expect(cores[1]!.geometry.recipe()).toEqual(before[1]);
    expect(cores[0]!.app.dispatch({ kind: "history.undo", scope: cores[0]!.document.scopeId }).ok).toBe(true);
    expect(cores[0]!.geometry.recipe()).toEqual(before[0]);
    releases[0]!(); expect(disposed).toEqual([0]);
    expect(() => { a!.select(2); a!.begin(); }).not.toThrow();
    expect(a!.apply({ kind: "point.replace", index: 0, next: { u: .4 } })).toBe(false);
    b!.select(2); expect(cores[1]!.presentation.selected).toBe(2);
  } finally { for (const release of releases) release(); for (const device of devices) { const scene = device.scene(); if (scene) device.disposeHead(scene); }
    for (const life of lives) life.abort(); await s.dispose(); s.library.close(); }
});

test("no registered flat adapter creates no canvas, UV host, input or feature-view slot", async () => {
  const s = await profileContextStudio();
  try {
    const empty = editorComposition();
    const core = { documents: { live: "absent" }, app: { actionRegistry: () => empty.registry, subscribe: () => () => {} } } as never;
    const attachment = createPanelUV({ core, named: {}, instance: "none", signal: new AbortController().signal, check: () => ({ available: true }) },
      { canvases: () => { throw Error("No raster read"); }, albedo: () => { throw Error("No albedo read"); } });
    expect(attachment.snapshot().uv).toBeUndefined(); expect(attachment.input().uv).toBeUndefined();
    expect(attachment.uvCommandCapability("fit").available).toBe(false);
    const rt = new StudioRuntime({ ...s.port, viewport: { ...s.port.viewport, snapshot: () => attachment.snapshot() } }, { toast() {}, record() {}, announce() {} } as never);
    expect(featureViewContext(rt, "eye-makeup").uv).toBeUndefined();
    const viewport = createBrowserViewportDevice({ headHost: document.createElement("div"), queryContext: () => { throw Error("No hit"); } });
    expect(viewport.capture()).toEqual({}); expect(viewport.attachment.snapshot().uv).toBeUndefined();
    expect(viewport.surfaceGuides({} as never)).toEqual([]); expect(viewport.surfaceSteps({} as never, {} as never)).toEqual([]);
  } finally { await s.dispose(); s.library.close(); }
});

test("a synthetic feature supplies a flat adapter through the same registration without a makeup projection", () => {
  let made = 0, disposed = 0;
  const life = new AbortController(), view = { mode: "both" as const, side: "low" as const, u: 0, v: 0, span: 1 };
  const editors: BrowserEditorAdapters = { flat: { create(_canvas, binding) {
    made++; expect(binding.state).toBe(core); expect(binding.source).toBe("uv:synthetic");
    return { snapshot: () => view, draw() {}, resize() {}, cancelInput() {}, inputCapture: () => false,
      viewCommand: () => true, hitAt: () => undefined, dispose: () => { disposed++; } };
  } } };
  const registry = editorComposition([{ ...SYNTHETIC_LAYERED, editors } as typeof SYNTHETIC_LAYERED]).registry;
  const core = { documents: { live: SYNTHETIC_LAYERED.id }, app: { actionRegistry: () => registry, subscribe: () => () => {} } } as never;
  const attachment = createPanelUV({ core, named: {}, instance: "synthetic", signal: life.signal, check: () => ({ available: true }) },
    { canvases: () => [], albedo: () => undefined });
  expect(made).toBe(1); expect(attachment.snapshot().uv?.phase).toBe("ready"); expect(attachment.uvCommand("fit")).toBe(true);
  life.abort(); expect(disposed).toBe(1); expect(attachment.uvCommand("fit")).toBe(false);
});
