import { expect, test } from "bun:test";
import type { CollectionTransport } from "../src/collection-service";
import { PreviewQualityActions } from "../src/preview-quality-actions";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { createTrustedStudioBootstrap } from "../src/trusted-studio-bootstrap";
import { UIPreferenceActions } from "../src/ui-preferences";
import { ViewportAttachment } from "../src/viewport-attachment";
import { freshWorkspace } from "../src/workspace-state";

test("a presentation mounts from trusted services without loading legacy UI controls", async () => {
  expect(typeof document).toBe("undefined");
  const workspace = freshWorkspace();
  let core!: ReturnType<typeof createTrustedAuthoringCore>;
  let resets = 0, imports = 0;
  core = createTrustedAuthoringCore(workspace, {
    resetStack: () => { resets++; }, selectedCollection: () => "draft",
    controlAction: action => { core.recipe.dispatch(action); },
  });
  core.app.attach({ quality: new PreviewQualityActions(512,
    { assess: () => ({ accepted: true }), replace: () => {} }) });
  const viewport = new ViewportAttachment<string>({
    moveHost: () => {}, measure: () => ({ width: 400, height: 300 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined,
    uvView: () => workspace.uvView, uvCommand: () => true, hitAt: () => undefined,
    queryContext: hit => core.app.contextQuery(hit),
  });
  viewport.setReady("uv");
  const transport: CollectionTransport = {
    list: async () => [], get: async () => { throw Error("No saved collection."); },
    save: async () => { throw Error("No SQLite write."); },
    package: async () => { throw Error("No package build."); },
  };
  const downloads: string[] = [];
  const bootstrap = createTrustedStudioBootstrap({ workspace, core,
    preferences: new UIPreferenceActions(workspace.uiPreferences), viewport, transport,
    previewReadiness: { readiness: () => ({ phase: "ready", size: 1024,
      pending: 0, waiting: false, estimatedBytes: 1024, layers: [] }), subscribe: () => () => {} },
    onEditorRestored: () => { resets++; }, onRecipeImported: () => { imports++; },
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
  expect(shell.authoring.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(resets).toBe(2);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(4);
  expect((await shell.files.execute({ kind: "recipe.export" })).ok).toBe(true);
  expect(downloads).toEqual(["xfs.recipe.json"]);
  expect(shell.preferences.dispatch({ kind: "theme.set", theme: "dark" })).toBeUndefined();
  expect(shell.snapshot().preferences.theme).toBe("dark");
  expect(imports).toBe(0);
});
