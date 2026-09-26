// Capture, crop and downscale, checked against synthetic windows of known size and content
// (tools/test/synthetic-window.ps1). No game involved.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureWindow, CaptureError, recrop } from "../capture/capture.ts";
import { decodePng, downscaleArea, encodePng, fitSize } from "../capture/image.ts";
import { resolveRegion } from "../capture/regions.ts";
import type { Pixels } from "../capture/win32.ts";
import { openSyntheticWindow, tempDir, type Synthetic } from "./helpers.ts";

const at = (p: Pixels, x: number, y: number) => Array.from(p.rgb.subarray((y * p.width + x) * 3, (y * p.width + x) * 3 + 3));
const close = (actual: number[], expected: number[], tolerance = 2) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

describe("image operations", () => {
  test("PNG round trip keeps every pixel", () => {
    const rgb = new Uint8Array(37 * 23 * 3).map((_, i) => (i * 7919) % 256);
    const decoded = decodePng(encodePng({ width: 37, height: 23, rgb }));
    expect(decoded.width).toBe(37);
    expect(decoded.height).toBe(23);
    expect(Buffer.compare(Buffer.from(decoded.rgb), Buffer.from(rgb))).toBe(0);
  });

  test("fitSize never upscales and keeps the aspect ratio", () => {
    expect(fitSize(3840, 1600, { maxWidth: 1280, maxHeight: 1280 })).toEqual({ width: 1280, height: 533, factor: 1 / 3 });
    expect(fitSize(1920, 1080, { maxWidth: 1280, maxHeight: 1280 })).toEqual({ width: 1280, height: 720, factor: 2 / 3 });
    expect(fitSize(800, 600, { maxWidth: 1280 })).toEqual({ width: 800, height: 600, factor: 1 });
    expect(fitSize(1000, 500, { scale: 0.25 })).toEqual({ width: 250, height: 125, factor: 0.25 });
  });

  test("area filter averages a 1-pixel checkerboard to grey (nearest would alias to black or white)", () => {
    const w = 64;
    const rgb = new Uint8Array(w * w * 3);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) rgb.fill((x + y) % 2 ? 255 : 0, (y * w + x) * 3, (y * w + x) * 3 + 3);
    for (const size of [32, 21, 7]) {
      const small = downscaleArea({ width: w, height: w, rgb }, size, size);
      // At most one unpaired source pixel per output pixel: its share of the covered area.
      const bound = 255 / ((w / size) * (w / size)) + 1;
      for (let i = 0; i < small.rgb.length; i++) expect(Math.abs(small.rgb[i] - 127.5)).toBeLessThanOrEqual(bound);
    }
  });

  test("area filter preserves the mean exactly for a non-integer ratio", () => {
    const rgb = new Uint8Array(10 * 1 * 3);
    for (let x = 0; x < 10; x++) rgb.fill(x * 20, x * 3, x * 3 + 3);
    const small = downscaleArea({ width: 10, height: 1, rgb }, 4, 1);
    // Output 0 covers source 0..2.5: (0 + 20 + 40 * 0.5) / 2.5 = 16.
    expect(small.rgb[0]).toBe(16);
  });
});

describe("regions follow the window's aspect ratio", () => {
  const cases: [string, number, number][] = [
    ["16:9", 1920, 1080],
    ["21:9 (3840x1600)", 3840, 1600],
    ["32:9", 5120, 1440],
  ];
  for (const [label, w, h] of cases) {
    test(`face and eyes are centred and sized by height on ${label}`, () => {
      const face = resolveRegion({ name: "face" }, w, h);
      expect(face.width).toBe(Math.round(0.5 * h));
      expect(Math.abs(face.x + face.width / 2 - w / 2)).toBeLessThanOrEqual(1);
      const eyes = resolveRegion({ name: "eyes" }, w, h);
      expect(eyes.height).toBe(Math.round(0.2 * h));
      const centre = resolveRegion({ name: "center-16x9" }, w, h);
      expect(Math.abs(centre.width / centre.height - 16 / 9)).toBeLessThan(0.01);
      expect(centre.height).toBe(Math.min(h, Math.round((w * 9) / 16)));
    });
  }

  test("pixel and normalised rectangles resolve and clip", () => {
    expect(resolveRegion({ pixels: { x: 100, y: 50, width: 200, height: 100 } }, 3840, 1600)).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(resolveRegion({ normalized: { x: 0.25, y: 0.5, width: 0.5, height: 0.25 } }, 3840, 1600)).toEqual({ x: 960, y: 800, width: 1920, height: 400 });
    expect(resolveRegion({ pixels: { x: 3800, y: 1500, width: 500, height: 500 } }, 3840, 1600)).toEqual({ x: 3800, y: 1500, width: 40, height: 100 });
    expect(() => resolveRegion({ pixels: { x: 5000, y: 0, width: 10, height: 10 } }, 3840, 1600)).toThrow();
    expect(() => resolveRegion({ normalized: { x: 1.5, y: 0, width: 0.1, height: 0.1 } }, 3840, 1600)).toThrow();
  });
});

for (const [w, h] of [
  [3840, 1600],
  [1920, 1080],
] as const) {
  describe(`capture of a synthetic ${w}x${h} window`, () => {
    let window: Synthetic;
    let out: string;
    beforeAll(async () => {
      window = await openSyntheticWindow(w, h);
      out = tempDir("xfb-capture-");
    });
    afterAll(() => {
      window?.close();
      rmSync(out, { recursive: true, force: true });
    });

    test("full frame: full-resolution file, 1280-px view, manifest", () => {
      const record = captureWindow({ target: { hwnd: window.hwnd }, name: "full", outDir: out });
      expect(record.source.window).toEqual({ width: w, height: h });
      expect(record.crop).toMatchObject({ x: 0, y: 0, width: w, height: h, region: "full" });
      expect(record.full).toMatchObject({ width: w, height: h });
      expect(Math.max(record.view.width, record.view.height)).toBe(1280);
      expect(record.scale.filter).toBe("area");
      const full = decodePng(new Uint8Array(readFileSync(record.full.path)));
      expect(at(full, 0, 0)).toEqual([40, 40, 40]);
      expect(at(full, 150, 100)).toEqual([255, 0, 0]);
      expect(at(full, w / 2, h / 2)).toEqual([0, 0, 255]);
      expect(at(full, w - 1, h - 1)).toEqual([0, 255, 0]);
      const sidecar = JSON.parse(readFileSync(record.full.path.replace(/\.full\.png$/, ".json"), "utf8"));
      expect(sidecar.source.window).toEqual({ width: w, height: h });
      expect(sidecar.scale.factor).toBeCloseTo(1280 / w, 5);
      const view = decodePng(new Uint8Array(readFileSync(record.view.path)));
      const f = 1280 / w;
      expect(close(at(view, Math.round(200 * f), Math.round(100 * f)), [255, 0, 0])).toBe(true);
    });

    test("pixel crop of the checkerboard, downscaled by half, averages to grey", () => {
      const record = captureWindow({ target: { hwnd: window.hwnd }, region: { pixels: { x: 400, y: 100, width: 256, height: 256 } }, view: { scale: 0.5 }, name: "checker", outDir: out });
      expect(record.full).toMatchObject({ width: 256, height: 256 });
      expect(record.view).toMatchObject({ width: 128, height: 128 });
      const view = decodePng(new Uint8Array(readFileSync(record.view.path)));
      for (const [x, y] of [[0, 0], [64, 64], [127, 127]]) expect(close(at(view, x, y), [128, 128, 128], 1)).toBe(true);
    });

    test("normalised crop keeps exactly that fraction", () => {
      const record = captureWindow({ target: { hwnd: window.hwnd }, region: { normalized: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, name: "norm", outDir: out });
      expect(record.full).toMatchObject({ width: w / 2, height: h / 2 });
      const full = decodePng(new Uint8Array(readFileSync(record.full.path)));
      expect(at(full, w / 4, h / 4)).toEqual([0, 0, 255]); // the window centre
    });

    test("named face region is centred and small enough to view at full size", () => {
      const record = captureWindow({ target: { hwnd: window.hwnd }, region: { name: "face" }, name: "face", outDir: out });
      expect(record.crop.width).toBe(Math.round(0.5 * h));
      expect(record.crop.region).toBe("face");
      expect(Math.max(record.view.width, record.view.height)).toBeLessThanOrEqual(1280);
    });

    test("recrop of the saved original needs no new capture", () => {
      const first = captureWindow({ target: { hwnd: window.hwnd }, name: "orig", outDir: out });
      const again = recrop({ path: first.full.path, region: { pixels: { x: 100, y: 50, width: 200, height: 100 } }, root: out });
      expect(again.source.route).toBe("file");
      expect(again.source.derived_from?.path).toBe(first.full.path);
      expect(again.full).toMatchObject({ width: 200, height: 100 });
      const px = decodePng(new Uint8Array(readFileSync(again.full.path)));
      expect(at(px, 0, 0)).toEqual([255, 0, 0]);
    });
  });
}

describe("capture refusals", () => {
  test("recrop refuses files outside the capture folder", () => {
    const outside = join(tempDir("xfb-outside-"), "x.full.png");
    writeFileSync(outside, encodePng({ width: 1, height: 1, rgb: new Uint8Array(3) }));
    expect(() => recrop({ path: outside, root: tempDir("xfb-root-") })).toThrow(CaptureError);
  });

  test("a missing window is a plain error", () => {
    expect(() => captureWindow({ target: { hwnd: 0x7ffffff0n } })).toThrow(/no longer exists/);
  });
});

// Routes that need the window on screen: a small, non-activating, top-most window shown for about
// two seconds on the primary monitor.
describe("on-screen routes", () => {
  let window: Synthetic;
  let out: string;
  beforeAll(async () => {
    // (780, 420) keeps a 480x270 window inside any primary monitor of at least 1280x720.
    window = await openSyntheticWindow(480, 270, { x: 780, y: 420, topMost: true, seconds: 15 });
    out = tempDir("xfb-onscreen-");
  });
  afterAll(() => {
    window?.close();
    rmSync(out, { recursive: true, force: true });
  });

  for (const route of ["printwindow", "screen"] as const) {
    test(`${route} route reads the window's pixels`, () => {
      const record = captureWindow({ target: { hwnd: window.hwnd }, route, name: route, outDir: out });
      expect(record.source.route).toBe(route);
      const full = decodePng(new Uint8Array(readFileSync(record.full.path)));
      expect(at(full, 150, 100)).toEqual([255, 0, 0]);
      expect(at(full, 240, 135)).toEqual([0, 0, 255]);
      expect(at(full, 479, 269)).toEqual([0, 255, 0]);
    });
  }
});
