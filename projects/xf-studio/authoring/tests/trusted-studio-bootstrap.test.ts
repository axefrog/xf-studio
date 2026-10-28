import { expect, test } from "bun:test";
import { bootstrapCollections } from "./fixtures/profile-studio";
import { PreviewQualityActions } from "../src/legacy/eye-makeup/preview/preview-quality-actions";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { createTrustedStudioBootstrap } from "../src/app/trusted-studio-bootstrap";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { ViewportAttachment } from "../src/app/viewport-attachment";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";
import { fixtureTargets } from "./fixtures/named-targets";
import { profileContextStudio } from "./fixtures/profile-context-studio";

test("root mask capability and execution follow the drawn look across A/B/A switches", async () => {
  const w = await profileContextStudio();
  const baked: unknown[] = [], downloads: string[] = [];
  w.fileDevice.bakeMask = async value => { baked.push(value); return new Blob(); };
  w.fileDevice.download = (_blob, name) => { downloads.push(name); };
  try {
    const views = w.session.session().views.views;
    for (const [index, active] of [[0, 0], [1, 1], [0, 0]] as const) {
      w.draw(views[index]!.id);
      const eye = w.port.feature("eye-makeup"), layer = eye.view().recipe().layers[active]!;
      expect(eye.dispatch({ kind: "layer.select", layerId: layer.id }).ok).toBe(true);
      expect(w.port.files.capability({ kind: "mask.export" })).toEqual({ available: true });
      expect(await w.port.files.execute({ kind: "mask.export" })).toMatchObject({ ok: true });
      expect(baked.at(-1)).toEqual(layer);
      expect(downloads.at(-1)).toBe(`xfs-${layer.id}-alpha.png`);
    }
    expect(baked).toHaveLength(3);
    expect(baked[0]).not.toEqual(baked[1]);
    expect(baked[2]).toEqual(baked[0]);
    expect(w.failures).toEqual([]);
  } finally { await w.dispose(); }
});

test("a presentation mounts from trusted services without any page controls", async () => {
  expect(typeof document).toBe("undefined");
  const workspace = freshWorkspace();
  let core!: ReturnType<typeof createTrustedAuthoringCore>;
  let resets = 0, imports = 0;
  core = createTrustedAuthoringCore(workspace, {
    resetStack: () => { resets++; }, selectedCollection: () => "draft",
  }, STUDIO_COMPOSITION);
  core.app.attach({ quality: new PreviewQualityActions(512,
    { assess: () => ({ accepted: true }), replace: () => {} }) });
  const viewport = new ViewportAttachment<string>({
    moveHost: () => {}, measure: () => ({ width: 400, height: 300 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined,
    uvView: () => workspace.uvView, uvCommand: () => true, hitAt: () => undefined,
    queryContext: hit => core.app.contextQuery(hit, targets.named()),
  }, ["head", "uv"]);
  viewport.setReady("uv");
  const collections = bootstrapCollections(core.document, { looks: [{ name: "Look", recipe: workspace.recipe }] });
  // The input layer the composition root gives the port (profiles design §3.6): what each action names.
  const targets = fixtureTargets(core, { scene: collections.scene });
  const downloads: string[] = [];
  const bootstrap = createTrustedStudioBootstrap({ core: { ...core, document: core.lookDocument }, targets, focus: core.history.focus,
    preferences: new UIPreferenceActions(workspace.uiPreferences), viewport, collections: collections.deps,
    previewReadiness: { readiness: () => ({ phase: "ready", size: 1024,
      pending: 0, waiting: false, estimatedBytes: 1024, layers: [] }), subscribe: () => () => {} },
    onRecipeImported: () => { imports++; },
    savedAppearance: { has: () => false, read: () => undefined,
      load: () => { throw Error("No saved V device."); }, ready: () => false },
    fileDevice: { pick: async () => undefined,
      download: (_blob, name) => { downloads.push(name); },
      bakeMask: async () => new Blob() },
  });
  let mounts = 0;
  const shell = bootstrap.mount(port => { mounts++; return port; });
  expect(mounts).toBe(1);
  expect("document" in shell.authoring).toBe(false);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(4);
  expect(shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(5);
  expect(shell.authoring.dispatch({ kind: "history.undo" }).ok).toBe(true);
  expect(resets).toBe(2);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(4);
  expect((await shell.files.execute({ kind: "recipe.export" })).ok).toBe(true);
  expect(downloads).toEqual(["xfs.recipe.json"]);
  expect(shell.preferences.dispatch({ kind: "theme.set", theme: "dark" })).toBeUndefined();
  expect(shell.snapshot().preferences.theme).toBe("dark");
  expect(imports).toBe(0);
});

for (const fail of [false, true]) test(`bootstrap ${fail ? "construction failure" : "abort"} releases its collection subscriptions and file destination`, async () => {
  const life = new AbortController(), workspace = freshWorkspace();
  const core = createTrustedAuthoringCore(workspace, { selectedCollection: () => "fixture" }, STUDIO_COMPOSITION);
  const collections = bootstrapCollections(core.document, { looks: [{ name: "Look", recipe: workspace.recipe }] });
  let subscriptions = 0, published = 0;
  const scene = collections.deps.scene;
  const options: Parameters<typeof createTrustedStudioBootstrap<string>>[0] = { signal: life.signal, core: { ...core, document: core.lookDocument },
    preferences: new UIPreferenceActions(workspace.uiPreferences),
    viewport: new ViewportAttachment<string>({ moveHost() {}, measure: () => ({ width: 0, height: 0 }), resize() {}, cancelInput() {},
      inputCapture: () => false, headView: () => undefined, uvView: () => undefined, uvCommand: () => false, hitAt: () => undefined, queryContext: () => { throw Error("No hit expected"); } }),
    previewReadiness: { readiness: () => ({ phase: "ready", size: 512, pending: 0, waiting: false, estimatedBytes: 0, layers: [] }), subscribe: () => () => {} },
    collections: { ...collections.deps, scene: { ...scene, subscribe: listener => {
      subscriptions++; const off = scene.subscribe(listener); return () => { subscriptions--; off(); };
    } } },
    savedAppearance: { has: () => false, read: () => undefined, load: () => ({}), ready: () => false }, onRecipeImported() {},
    fileDevice: { pick: async () => undefined, download() {} },
    ...(fail ? { modules: [{ get module(): string { throw Error("Fixture construction failed"); } } as never] } : {}) };
  try {
    if (fail) expect(() => { createTrustedStudioBootstrap(options); }).toThrow("Fixture construction failed");
    else {
      const bootstrap = createTrustedStudioBootstrap(options);
      bootstrap.collection.service.subscribe(() => { published++; });
      expect(subscriptions).toBe(1);
      expect(bootstrap.files.capability({ kind: "recipe.export" }).available).toBe(true);
      life.abort();
      expect(bootstrap.files.capability({ kind: "recipe.export" }).available).toBe(false);
      expect(await bootstrap.collection.service.execute({ kind: "refresh" })).toMatchObject({ ok: false, code: "missing_target" });
      bootstrap.dispose();
      scene.setLook(undefined);
      expect(published).toBe(0);
    }
    expect(subscriptions).toBe(0);
    expect(() => createTrustedStudioBootstrap({ signal: AbortSignal.abort() } as never)).toThrow();
  } finally {
    life.abort(); collections.lookEditor.dispose(); await collections.outbox.settle(); collections.outbox.stop(); core.app.dispose(); core.dispose();
  }
});
