import { expect, test } from "bun:test";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";
import { defaultUVView, fitUVView, parseUVView, pixelToUV, reflectUV, uvRegion, uvToPixel, uvViewRegion } from "../src/uv-view";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";
import { storedWorkspace } from "./fixtures/looks";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

test("UV mapping is invertible and isotropic across both crops, pane sizes, insets and mirrored instances", () => {
  for (const mode of ["both", "single"] as const) for (const [width, height] of [[260, 112], [400, 700], [1200, 380], [333.3, 333.3]]) {
    const view = fitUVView({ ...defaultUVView(), mode }, initialRecipe().layers[0]);
    const region = uvViewRegion(view, width, height, { top: 8, right: 8, bottom: 58, left: 8 });
    for (const point of [{ u: .303, v: .231 }, { u: .64, v: .26 }, { u: -.05, v: 1.1 }]) for (const mirror of [false, true]) {
      const shown = reflectUV(point, mirror), p = uvToPixel(shown, region, width, height), back = reflectUV(pixelToUV(p, region, width, height), mirror);
      expect(Math.abs(back.u - point.u)).toBeLessThan(1e-12);
      expect(Math.abs(back.v - point.v)).toBeLessThan(1e-12);
      const x = uvToPixel({ u: shown.u + .01, v: shown.v }, region, width, height), y = uvToPixel({ u: shown.u, v: shown.v + .01 }, region, width, height);
      expect(Math.abs((x.x - p.x) - (y.y - p.y))).toBeLessThan(1e-10);
    }
  }
});

test("single-eye fitting enlarges the shape without mutating it and mirrors the crop exactly", () => {
  const layer = initialRecipe().layers[0], before = structuredClone(layer);
  const both = fitUVView(defaultUVView(), layer), low = fitUVView({ ...both, mode: "single", side: "low" }, layer), high = fitUVView({ ...low, side: "high" }, layer);
  expect(low.span).toBeLessThan(both.span / 2);
  expect(Math.abs(1 - low.u - high.u)).toBeLessThan(1e-12);
  expect(Math.abs(low.span - high.span)).toBeLessThan(1e-12);
  for (const p of layer.points) {
    const pos = uvToPixel(p, uvRegion(low), 720, 520);
    expect(pos.x).toBeGreaterThan(0); expect(pos.x).toBeLessThan(720);
    expect(pos.y).toBeGreaterThan(0); expect(pos.y).toBeLessThan(520);
  }
  expect(layer).toEqual(before);
  layer.symmetry = false;
  expect(fitUVView({ ...high, mode: "single" }, layer).u).toBe(.625);
  layer.fields[0] = { id: "outside", u: 0, v: .2, du: -.1, dv: 0, radius: .07 };
  const edgeView = fitUVView({ ...low, side: "low" }, layer);
  const outsideAtlas = uvToPixel({ u: -.1, v: .2 }, uvRegion(edgeView), 720, 520);
  expect(outsideAtlas.x).toBeGreaterThan(0); expect(outsideAtlas.x).toBeLessThan(720);
  expect(parseUVView(edgeView)).toEqual(edgeView);
});

test("view state persists independently of recipe and legacy workspaces have the original crop", () => {
  const workspace = freshWorkspace();
  workspace.uvView = { mode: "single", side: "high", u: .63, v: .24, span: .19 };
  expect(parseWorkspace(storedWorkspace(workspace), STUDIO_DOCUMENTS)).toEqual(workspace);
  const legacy = storedWorkspace(workspace); delete legacy.uvView;
  expect(parseWorkspace(legacy, STUDIO_DOCUMENTS).uvView).toEqual(defaultUVView());
  for (const bad of [null, {}, { ...workspace.uvView, span: 0 }, { ...workspace.uvView, u: Infinity }, { ...workspace.uvView, mode: "future" }])
    expect(parseUVView(bad)).toEqual(defaultUVView());
  const copied = parseUVView(workspace.uvView); copied.u = .2;
  expect(workspace.uvView.u).toBe(.63);
});

test("selection visibility reports whether the selected point or warp origin is inside the UV view", async () => {
  const { selectionVisibility, defaultUVView } = await import("../src/uv-view");
  const layer = { symmetry: false, points: [{ u: .3, v: .28 }, { u: .9, v: .9 }], fields: [{ id: "w", u: .31, v: .27 }] };
  const view = defaultUVView();
  expect(selectionVisibility(view, 720 / 310, layer, 0, "w")).toEqual({ point: { index: 0, visible: true }, field: { id: "w", visible: true } });
  expect(selectionVisibility(view, 720 / 310, layer, 1).point).toEqual({ index: 1, visible: false });
  // A mirrored layer counts as visible when its reflected instance is in view.
  const single = { ...view, mode: "single" as const, u: .75, span: .3 };
  expect(selectionVisibility(single, 720 / 520, layer, 0).point?.visible).toBe(false);
  expect(selectionVisibility(single, 720 / 520, { ...layer, symmetry: true }, 0).point?.visible).toBe(true);
  expect(selectionVisibility(view, 1, layer, 7)).toEqual({});
});
