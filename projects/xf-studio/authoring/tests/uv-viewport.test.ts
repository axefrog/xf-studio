import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialRecipe } from "../src/engines/layered-makeup/recipe";
import { canvasResolution } from "../src/canvas-resolution";
import { defaultUVView, fitUVView, frameAspect, MAX_UV_VIEW_SPAN, MIN_UV_VIEW_SPAN, panUVView, parseUVView, pixelToUV, reflectUV,
  uvAspect, uvToPixel, uvViewRegion, uvViewScale, zoomUVView, type UVInsets, type UVView } from "../src/uv-view";

// The UV viewport fills its whole pane; these are the pane shapes it must handle: docked narrow and
// wide, a floating square, a tall strip and a tiny pane where the insets would not fit.
const PANES = [[300, 520], [1100, 360], [640, 640], [220, 900], [90, 70]] as const;
const HINT_INSETS: UVInsets = { top: 8, right: 8, bottom: 58, left: 8 };
const NONE: UVInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Insets taking more than half a side are scaled down, as uvViewScale does. */
function safeArea(width: number, height: number, insets: UVInsets) {
  const k = (a: number, b: number, size: number) => a + b > size / 2 ? size / 2 / (a + b) : 1;
  const kx = k(insets.left, insets.right, width), ky = k(insets.top, insets.bottom, height);
  return { left: insets.left * kx, top: insets.top * ky,
    width: width - (insets.left + insets.right) * kx, height: height - (insets.top + insets.bottom) * ky };
}
function fittedBoundsPx(view: UVView, width: number, height: number, insets: UVInsets, mode: UVView["mode"], side: UVView["side"]) {
  const layer = initialRecipe().layers[0], region = uvViewRegion(view, width, height, insets);
  const points = [false, true].flatMap(mirror => layer.points.map(p => reflectUV(p, mirror)))
    .filter(p => mode === "both" || (side === "low" ? p.u <= .5 : p.u >= .5)).map(p => uvToPixel(p, region, width, height));
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test("Fit fills the pane's safe area with a small margin at every pane shape; a single eye fills the pane", () => {
  const layer = initialRecipe().layers[0];
  for (const [width, height] of PANES) for (const insets of [NONE, HINT_INSETS]) for (const mode of ["both", "single"] as const)
    for (const side of ["low", "high"] as const) {
      const view = fitUVView({ ...defaultUVView(), mode, side }, layer);
      const b = fittedBoundsPx(view, width, height, insets, mode, side);
      const safe = safeArea(width, height, insets);
      // Content stays inside the safe area (never under the hint band)...
      expect(b.minX).toBeGreaterThanOrEqual(safe.left - 1e-9); expect(b.maxX).toBeLessThanOrEqual(safe.left + safe.width + 1e-9);
      expect(b.minY).toBeGreaterThanOrEqual(safe.top - 1e-9); expect(b.maxY).toBeLessThanOrEqual(safe.top + safe.height + 1e-9);
      // ...and fills its limiting side up to the fit margin (80%, since the frame is the bounds × 1.25),
      // unless the minimum frame size or aspect limit made the frame larger than the content.
      const fill = Math.max((b.maxX - b.minX) / safe.width, (b.maxY - b.minY) / safe.height);
      expect(fill).toBeLessThanOrEqual(.8 + 1e-9);
      expect(fill).toBeGreaterThan(.55);
      // The fitted frame (centred on the content's bounds) is centred in the safe area.
      const centre = uvToPixel(view, uvViewRegion(view, width, height, insets), width, height);
      expect(centre.x).toBeCloseTo(safe.left + safe.width / 2, 8);
      expect(centre.y).toBeCloseTo(safe.top + safe.height / 2, 8);
    }
  const both = fitUVView(defaultUVView(), layer), single = fitUVView({ ...defaultUVView(), mode: "single" }, layer);
  for (const [width, height] of PANES) expect(uvViewScale(single, width, height).scale).toBeGreaterThan(uvViewScale(both, width, height).scale * 1.4);
});

test("Wheel zoom stays anchored under the cursor at any pane size, inset and DPR", () => {
  for (const [width, height] of PANES) for (const insets of [NONE, HINT_INSETS]) for (const dpr of [1, 1.25, 2]) {
    // DPR only changes the backing buffer; the mapping is in CSS pixels, so it must not move the anchor.
    const css = canvasResolution(width, height, dpr);
    for (const cursor of [{ x: 3, y: 4 }, { x: css.cssWidth * .7, y: css.cssHeight * .35 }, { x: css.cssWidth - 1, y: css.cssHeight - 1 }])
      for (const factor of [1.2, 1 / 1.2, 4]) {
        const view = fitUVView(defaultUVView(), initialRecipe().layers[0]);
        const anchor = pixelToUV(cursor, uvViewRegion(view, css.cssWidth, css.cssHeight, insets), css.cssWidth, css.cssHeight);
        const zoomed = zoomUVView(view, anchor, factor);
        const after = uvToPixel(anchor, uvViewRegion(zoomed, css.cssWidth, css.cssHeight, insets), css.cssWidth, css.cssHeight);
        expect(after.x).toBeCloseTo(cursor.x, 8); expect(after.y).toBeCloseTo(cursor.y, 8);
        expect(uvViewScale(zoomed, width, height, insets).scale / uvViewScale(view, width, height, insets).scale).toBeCloseTo(factor, 10);
        expect(frameAspect(zoomed)).toBe(frameAspect(view));
      }
  }
});

test("Zoom limits apply to the frame's larger side, so tall and wide frames stay within the persisted bounds", () => {
  for (const aspect of [.1, .5, 1, uvAspect("both"), 10]) {
    const view: UVView = { ...defaultUVView(), aspect, span: aspect >= 1 ? 1 : aspect };
    const inMost = zoomUVView(view, { u: .5, v: .3 }, 1e9), outMost = zoomUVView(view, { u: .5, v: .3 }, 1e-9);
    expect(Math.max(inMost.span, inMost.span / aspect)).toBeCloseTo(MIN_UV_VIEW_SPAN, 12);
    expect(Math.max(outMost.span, outMost.span / aspect)).toBeCloseTo(MAX_UV_VIEW_SPAN, 9);
    expect(parseUVView(inMost)).toEqual(inMost); expect(parseUVView(outMost)).toEqual(outMost);
  }
});

test("Pan follows the pointer over the whole pane and clamps the view centre to the legal range", () => {
  const view = fitUVView(defaultUVView(), initialRecipe().layers[0]);
  for (const [width, height] of PANES) {
    const region = uvViewRegion(view, width, height, HINT_INSETS), grab = { x: width * .6, y: height * .4 }, under = pixelToUV(grab, region, width, height);
    // A drag keeps the grabbed UV under the pointer, wherever in the pane it starts.
    const drop = { x: width * .45, y: height * .55 };
    const panned = panUVView(view, -(drop.x - grab.x) / width * region.w, -(drop.y - grab.y) / height * region.h);
    const back = uvToPixel(under, uvViewRegion(panned, width, height, HINT_INSETS), width, height);
    expect(back.x).toBeCloseTo(drop.x, 8); expect(back.y).toBeCloseTo(drop.y, 8);
    expect(panned.span).toBe(view.span); expect(panned.aspect).toBe(view.aspect);
  }
  const far = panUVView(view, 100, -100);
  expect(far.u).toBe(2); expect(far.v).toBe(-1);
  expect(parseUVView(far)).toEqual(far);
});

test("Pixel ↔ UV round-trips at several pane sizes and DPRs, and resizing keeps the frame visible and centred", () => {
  const view = { ...fitUVView({ ...defaultUVView(), mode: "single" }, initialRecipe().layers[0]) };
  const frame = { u0: view.u - view.span / 2, u1: view.u + view.span / 2, v0: view.v - view.span / frameAspect(view) / 2, v1: view.v + view.span / frameAspect(view) / 2 };
  for (const [width, height] of PANES) for (const dpr of [1, 1.5, 3]) {
    const r = canvasResolution(width, height, dpr), region = uvViewRegion(view, r.cssWidth, r.cssHeight, HINT_INSETS);
    for (const uv of [{ u: .2, v: .3 }, { u: -.4, v: 1.7 }, { u: view.u, v: view.v }]) {
      const back = pixelToUV(uvToPixel(uv, region, r.cssWidth, r.cssHeight), region, r.cssWidth, r.cssHeight);
      expect(back.u).toBeCloseTo(uv.u, 12); expect(back.v).toBeCloseTo(uv.v, 12);
    }
    // The persisted frame is always fully inside the pane, whatever its size.
    expect(region.u).toBeLessThanOrEqual(frame.u0 + 1e-12); expect(region.u + region.w).toBeGreaterThanOrEqual(frame.u1 - 1e-12);
    expect(region.v).toBeLessThanOrEqual(frame.v0 + 1e-12); expect(region.v + region.h).toBeGreaterThanOrEqual(frame.v1 - 1e-12);
    // The CSS mapping ignores DPR: backing pixels are a pure multiple of it.
    expect(r.scaleX).toBeCloseTo(r.pixelWidth / r.cssWidth, 12);
  }
});

test("Stored views from the fixed-box canvas keep their meaning: same crop in a box-shaped pane, contained in any other", () => {
  // Views saved before frames had an aspect have none; the mode's historical box proportions apply.
  const stored = { mode: "single", side: "high", u: .63, v: .24, span: .19 } as const;
  const parsed = parseUVView(JSON.parse(JSON.stringify(stored)));
  expect(parsed).toEqual(stored); expect("aspect" in parsed).toBe(false);
  const box = uvViewRegion(parsed, 720, 520);
  expect(box.u).toBeCloseTo(stored.u - stored.span / 2, 12); expect(box.w).toBeCloseTo(stored.span, 12);
  expect(box.h).toBeCloseTo(stored.span / uvAspect("single"), 12);
  for (const [width, height] of PANES) {
    const r = uvViewRegion(parsed, width, height);
    expect(r.u).toBeLessThanOrEqual(box.u + 1e-12); expect(r.u + r.w).toBeGreaterThanOrEqual(box.u + box.w - 1e-12);
    expect(r.v).toBeLessThanOrEqual(box.v + 1e-12); expect(r.v + r.h).toBeGreaterThanOrEqual(box.v + box.h - 1e-12);
  }
  // A frame aspect round-trips; an unusable one is rejected like any other damaged field.
  const fitted = fitUVView(defaultUVView(), initialRecipe().layers[0]);
  expect(fitted.aspect).toBeGreaterThan(0);
  expect(parseUVView(JSON.parse(JSON.stringify(fitted)))).toEqual(fitted);
  for (const aspect of [0, -1, 11, Infinity, "wide"]) expect(parseUVView({ ...fitted, aspect })).toEqual(defaultUVView());
});

test("Hint overlays never take layout space: they cannot resize a viewport canvas", () => {
  // Regression: a hover changed the hint text, the in-flow strip grew, the canvas shrank, the hover
  // was lost and the strip changed back, looping. Strips and warnings are now absolute overlays with
  // a clamped height, and the UV editor reserves their band through fixed CSS insets instead.
  const css = readFileSync(resolve(import.meta.dir, "../public/studio.css"), "utf8");
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...css.matchAll(new RegExp(`(?:^|\\n|\\}|,)\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g"))].map(m => m[1]).join(";");
  };
  expect(rule(".viewport-bottom")).toContain("position: absolute");
  expect(rule(".viewport-top")).toContain("position: absolute");
  const strip = rule(".viewport-bottom > .input-hints");
  expect(strip).toContain("max-height: var(--hint-strip-max)"); expect(strip).toContain("overflow: hidden");
  expect(rule(".viewport-slot")).toContain("position: absolute");
  expect(rule(".uv-slot > .device-uv")).toContain("position: absolute");
  expect(rule(".uv-stage")).toMatch(/--uv-safe-bottom: calc\(var\(--sp-4\) \+ var\(--hint-strip-max\)/);
  expect(css).toContain('@property --uv-safe-bottom { syntax: "<length>"');
  // Both viewport panels mount their strips inside those overlays, never as layout children.
  const panels = readFileSync(resolve(import.meta.dir, "../src/studio-ui/panels/viewports.ts"), "utf8") +
    readFileSync(resolve(import.meta.dir, "../src/features/eye-makeup/view/uv.ts"), "utf8");
  expect(panels.match(/h\("div", \{ class: "viewport-bottom" \}, hints\.strip/g)?.length).toBe(2);
  expect(panels).not.toMatch(/element\.append\([^)]*hints\.strip/);
});
