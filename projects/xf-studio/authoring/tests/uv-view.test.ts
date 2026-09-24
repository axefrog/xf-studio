import { expect, test } from "bun:test";
import { initialRecipe } from "../src/recipe";
import { defaultUVView, fitUVView, parseUVView, pixelToUV, reflectUV, uvAspect, uvRegion, uvToPixel } from "../src/uv-view";
import { freshWorkspace, parseWorkspace } from "../src/workspace-state";

test("UV mapping is invertible and isotropic across both crops, sizes and mirrored instances", () => {
  for (const mode of ["both", "single"] as const) for (const width of [260, 400, 600]) {
    const view = fitUVView({ ...defaultUVView(), mode }, initialRecipe().layers[0]), region = uvRegion(view), height = width / uvAspect(mode);
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
  expect(parseWorkspace(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
  const legacy = JSON.parse(JSON.stringify(workspace)); delete legacy.uvView;
  expect(parseWorkspace(legacy).uvView).toEqual(defaultUVView());
  for (const bad of [null, {}, { ...workspace.uvView, span: 0 }, { ...workspace.uvView, u: Infinity }, { ...workspace.uvView, mode: "future" }])
    expect(parseUVView(bad)).toEqual(defaultUVView());
  const copied = parseUVView(workspace.uvView); copied.u = .2;
  expect(workspace.uvView.u).toBe(.63);
});
