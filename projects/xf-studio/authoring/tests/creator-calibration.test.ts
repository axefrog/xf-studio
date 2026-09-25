import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fitExposure, oklab, hueDegrees, passMarks, patchMean, type Rgba8Image } from "../src/creator-calibration";
import { displayTransform, encodeGradingLut, neutralGradingLut, type GradingLut } from "../src/grading-lut";
import { encodePng } from "../src/png";

/** A warm, darkening LUT (like the vanilla grade's cast) so the fit is not trivially neutral. */
function warmLut(): GradingLut {
  const base = neutralGradingLut(16), data = new Float32Array(base.data);
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i]! * 0.9; data[i + 1] = data[i + 1]! * 0.8; data[i + 2] = data[i + 2]! * 0.65; }
  return { size: 16, data };
}
/** A 40×40 image with named 8×8 patches, each the display of a scene colour through `k` and the LUT. */
function render(scene: Record<string, [number, number, number]>, k: number, lut: GradingLut): { image: Rgba8Image; boxes: Record<string, [number, number, number, number]> } {
  const width = 40, height = 40, data = new Uint8Array(width * height * 4).fill(255), boxes: Record<string, [number, number, number, number]> = {};
  Object.entries(scene).forEach(([name, colour], index) => {
    const x = (index % 4) * 10, y = Math.floor(index / 4) * 10;
    boxes[name] = [x, y, 8, 8];
    const display = name === "background" ? [0, 0, 0] : displayTransform(colour, k, lut).map(v => Math.round(v * 255));
    for (let row = y; row < y + 8; row++) for (let column = x; column < x + 8; column++) data.set([...display, 255], (row * width + column) * 4);
  });
  return { image: { width, height, data }, boxes };
}
const SCENE: Record<string, [number, number, number]> = {
  forehead: [0.5, 0.4, 0.33], cheek_left: [0.6, 0.47, 0.4], cheek_right: [0.35, 0.28, 0.24], chin: [0.45, 0.36, 0.3],
  hair_front_left: [0.08, 0.06, 0.05], brow_inner_left: [0.1, 0.07, 0.05], lash_left: [0.03, 0.025, 0.02], background: [0, 0, 0],
};

test("patch means read pixel or fractional boxes", () => {
  const { image, boxes } = render(SCENE, 0.5, neutralGradingLut(16));
  const forehead = patchMean(image, boxes.forehead!);
  expect(forehead.pixels).toBe(64);
  expect(patchMean(image, [0, 0, 0.2, 0.2]).pixels).toBe(64);
  expect(() => patchMean(image, [100, 100, 8, 8])).toThrow("outside");
  expect(hueDegrees(oklab([1, 0, 0]))).toBeCloseTo(29.2, 0);
});

test("the forehead fit recovers the game's exposure through the LUT, and matched renders pass", () => {
  const lut = warmLut(), game = render(SCENE, 0.8, lut), studio = render(SCENE, 0.5, lut);
  const measure = (image: Rgba8Image) => Object.fromEntries(Object.entries(game.boxes).map(([name, box]) => [name, patchMean(image, box)]));
  const g = measure(game.image), s = measure(studio.image);
  const fit = fitExposure(g.forehead!, s.forehead!, lut, 0.5);
  expect(Math.abs(fit.exposure - 0.8) / 0.8).toBeLessThan(0.03);
  const { exposure, marks } = passMarks(g, s, lut, 0.5, g);
  expect(exposure).toBeCloseTo(fit.exposure, 9);
  const mark = (measure: string) => marks.find(item => item.measure === measure)!;
  expect(mark("Background (game)").pass).toBe(true);
  expect(mark("Left/right cheek luminance ratio").pass).toBe(true);
  expect(mark("hair hue (OKLab)").pass).toBe(true);
  expect(mark("Skin ΔE OKLab after the k fit").pass).toBe(true);
  expect(mark("Two hair-page frames").pass).toBe(true);
  // A Studio render whose left/right balance is wrong fails the cheek ratio.
  const lopsided = measure(render({ ...SCENE, cheek_left: [0.3, 0.24, 0.2] }, 0.5, lut).image);
  expect(passMarks(g, lopsided, lut, 0.5).marks.find(item => item.measure === "Left/right cheek luminance ratio")!.pass).toBe(false);
});

test("the command-line tool reads PNGs and prints the fitted exposure without writing anything", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-calibrate-"));
  try {
    const lut = warmLut(), game = render(SCENE, 0.8, lut), studio = render(SCENE, 0.5, lut);
    writeFileSync(join(dir, "game.png"), encodePng(game.image, { alpha: false }));
    writeFileSync(join(dir, "studio.png"), encodePng(studio.image, { alpha: false }));
    writeFileSync(join(dir, "patches.json"), JSON.stringify({ game: game.boxes }));
    writeFileSync(join(dir, "lut.bin"), encodeGradingLut(lut));
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "..", "tools", "calibrate-creator-capture.ts"), "--game", join(dir, "game.png"),
      "--studio", join(dir, "studio.png"), "--patches", join(dir, "patches.json"), "--lut", join(dir, "lut.bin"), "--k", "0.5"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(out).toContain("Fitted creator exposure: 0.8");
    expect(out).toContain("pass  Left/right cheek luminance ratio");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).sort()).toEqual(["game.png", "lut.bin", "patches.json", "studio.png"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
