import { expect, test } from "bun:test";
import { trustedFixture } from "./studio-presentation-fixture";

test("replacement presentation can perform current cross-surface workflows without trusted objects", async () => {
  const { shell, packageInput, downloads, locations } = trustedFixture();
  expect(Object.keys(shell).sort()).toEqual(["authoring", "editor", "files", "installDetection", "library", "localSetup", "preferences",
    "previewReadiness", "previewSetup", "snapshot", "status", "subscribe", "viewport"]);
  expect("document" in shell.authoring).toBe(false);
  let notifications = 0; const unsubscribe = shell.subscribe(() => notifications++);
  const initial = shell.snapshot(), firstLayer = initial.authoring.document.recipe.layers[0];
  expect(initial.previewReadiness).toMatchObject({ phase: "ready", size: 1024 });
  (initial.authoring.document.recipe.layers[0] as any).name = "Tampered";
  expect(shell.snapshot().authoring.document.recipe.layers[0].name).not.toBe("Tampered");

  expect(shell.authoring.capability({ kind: "layer.edit", command: { kind: "add" } }).available).toBe(true);
  expect(shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(5);
  expect(shell.authoring.dispatch({ kind: "recipe.undo" }).ok).toBe(true);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(4);
  expect(shell.authoring.dispatch({ kind: "preset.edit", command: { kind: "copy",
    id: shell.library.view().draft!.selected! } }).ok).toBe(true);
  expect(shell.library.view().draft?.collection.presets).toHaveLength(2);
  expect(shell.authoring.dispatch({ kind: "preset.select", id: initial.library.draft!.selected! }).ok).toBe(true);

  expect(shell.viewport.uvCommandCapability("other").available).toBe(false);
  expect(shell.viewport.uvCommand("single")).toBe(true);
  expect(shell.viewport.uvCommand("other")).toBe(true);
  shell.viewport.rehost("uv", "floating");
  expect(locations).toContain("uv:floating");
  expect(shell.snapshot().viewport.uv.view).toMatchObject({ mode: "single", side: "high" });
  const query = shell.viewport.contextAt("uv", 20, 20)!;
  expect(query.options.some(option => option.id === "point.remove")).toBe(true);
  expect(shell.authoring.dispatch({ kind: "layer.setOpacity", layerId: firstLayer.id,
    opacity: .57 }).ok).toBe(true);
  expect(shell.authoring.dispatchContext(query.context, { kind: "point.remove",
    layerId: firstLayer.id, index: 0 })).toMatchObject({ ok: false, code: "missing_target" });

  expect(shell.authoring.dispatch({ kind: "quality.set", size: 1024 }).ok).toBe(true);
  expect(shell.snapshot().authoring.quality?.size).toBe(1024);
  expect((await shell.files.execute({ kind: "recipe.export" })).ok).toBe(true);
  expect(downloads).toContain("xfs.recipe.json");
  expect((await shell.files.execute({ kind: "package.check" })).ok).toBe(true);
  expect(shell.files.snapshot().package?.kind).toBe("packageCheck");
  expect(shell.snapshot().files.package?.freshness).toBe("current");
  expect(packageInput()?.id).toBe(shell.library.view().draft?.collection.id);
  expect(shell.authoring.dispatch({ kind: "layer.setOpacity", layerId: firstLayer.id,
    opacity: .42 }).ok).toBe(true);
  expect(shell.snapshot().files.package?.freshness).toBe("stale");
  expect(shell.preferences.capability({ kind: "theme.set", theme: "dark" }).available).toBe(true);
  shell.preferences.dispatch({ kind: "theme.set", theme: "dark" });
  expect(shell.snapshot().preferences.theme).toBe("dark");
  expect(notifications).toBeGreaterThan(0);
  unsubscribe();
});
