/**
 * The presentation's feature facades (feature-module platform §4, step 5): `features()` lists the
 * registered modules, `feature(id)` gives each a typed facade over its own actions only, and eye makeup's
 * facade carries the editor view the port's `editor` used to be.
 */
import { expect, test } from "bun:test";
import { STUDIO_REGISTRY } from "../src/compose/studio-registry";
import { createStudioPresentation } from "../src/studio-presentation";
import { createTrustedAuthoringCore } from "../src/trusted-authoring-core";
import { freshWorkspace } from "../src/workspace-state";
import { trustedFixture } from "./studio-presentation-fixture";
import { withHair, type Hair } from "./fixtures/hair-feature";

test("the port lists the registered features and eye makeup's facade owns exactly its actions", () => {
  const { shell } = trustedFixture();
  expect(shell.features()).toEqual([{ id: "eye-makeup", label: "Eye makeup", stage: "stable" }]);
  const eye = shell.feature("eye-makeup");
  expect(eye.kinds() as readonly string[]).toEqual([...STUDIO_REGISTRY.kinds("eye-makeup")]);
  expect(shell.feature("hair")).toBeUndefined();
  // Another owner's kind is not this facade's: refused, never routed elsewhere.
  expect(eye.capability({ kind: "history.undo" } as never)).toMatchObject({ available: false, code: "invalid_value" });
  expect(eye.dispatch({ kind: "camera.front" } as never)).toMatchObject({ ok: false, code: "invalid_value" });
  expect(eye.limitsFor({ kind: "viewport" }, "camera.setFov" as never)).toEqual({});
  const layer = eye.view().layer()!;
  expect(eye.limitsFor({ kind: "layer", id: layer.id }, "layer.setOpacity")).toEqual(
    shell.authoring.limitsFor({ kind: "layer", id: layer.id }, "layer.setOpacity"));
  expect(eye.choicesFor({ kind: "layer", id: layer.id }, "layer.setFinish", "finish").map(choice => choice.value)).toEqual(
    shell.authoring.choicesFor({ kind: "layer", id: layer.id }, "layer.setFinish", "finish").map(choice => choice.value));
  // Its own actions dispatch as through the application; the view is the same cached object.
  expect(eye.view()).toBe(eye.view());
  expect(eye.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .4 })).toMatchObject({ ok: true });
  expect(eye.view().layer()!.opacity).toBe(.4);
  // Form-control transactions and catalogues moved onto the facade.
  expect(eye.controlBegin("opacity", layer.id)).toBe(true);
  expect(eye.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer.id, opacity: .6 })).toMatchObject({ ok: true });
  eye.controlCommit("opacity");
  expect(shell.authoring.history().undo?.label).toBe("Opacity");
  expect(eye.finishCatalogue()).toEqual(shell.authoring.finishCatalogue());
  expect(eye.layerExport(layer.id)).toEqual(shell.authoring.layerExport(layer.id));
});

test("a second feature gets a generic facade with a detached view of its live document", () => {
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, withHair());
  const port = createStudioPresentation({ authoring: core.app, editor: core.presentation,
    library: {} as never, files: {} as never, viewport: {} as never, preferences: {} as never,
    previewReadiness: { readiness: () => ({}) as never, subscribe: () => () => {} } });
  expect(port.features().map(feature => feature.id)).toEqual(["eye-makeup", "hair"]);
  const hair = port.feature("hair")!;
  expect(hair.kinds()).toEqual(["hair.setColour", "hair.addStrand", "hair.selectStrand"]);
  expect(hair.dispatch({ kind: "layer.setOpacity" })).toMatchObject({ ok: false, code: "invalid_value" });
  expect(hair.dispatch({ kind: "hair.addStrand", length: 3 } as never)).toMatchObject({ ok: true });
  const view = hair.view() as { part?: Hair; editor?: unknown };
  expect(view).toEqual({ part: { colour: "#000000", strands: [3] }, editor: { strand: 0 } });
  view.part!.strands.push(99);
  expect((core.document.others!.read("hair") as Hair).strands).toEqual([3]);
  // Eye makeup's facade is unchanged beside it: its view is the live document's cached read view.
  const eye = port.feature("eye-makeup"), before = eye.view().revision();
  expect(eye.dispatch({ kind: "layer.setOpacity", layerId: core.document.recipe.layers[0].id, opacity: .4 })).toMatchObject({ ok: true });
  expect(eye.view().revision()).toBeGreaterThan(before);
  expect(eye.view().recipe()).toBe(eye.view().recipe());
});
