import { expect, test } from "bun:test";
import { encodePng, type RgbaImage } from "../src/formats/png";
import { assertStartupPaint, type PaintBox, type StartupPaintLayout } from "./fixtures/startup-paint";

const box = (x: number, y: number, width: number, height: number): PaintBox => ({ x, y, width, height, visible: true });
const layout: StartupPaintLayout = { width: 120, height: 120,
  regions: { header: box(0, 0, 120, 20), workspace: box(0, 20, 120, 80), status: box(0, 100, 120, 20) },
  controls: { commands: box(5, 3, 20, 14), newTab: box(35, 23, 20, 14), panelMenu: box(65, 43, 20, 14) } };

function image(scale = 1): RgbaImage {
  return { width: layout.width * scale, height: layout.height * scale, data: new Uint8Array(layout.width * layout.height * scale * scale * 4).fill(255) };
}
function ink(image: RgbaImage, area: PaintBox, colour = [30, 40, 50, 255]): void {
  const scale = image.width / layout.width;
  for (let y = area.y * scale; y < (area.y + area.height) * scale; y++) for (let x = area.x * scale; x < (area.x + area.width) * scale; x++) {
    image.data.set(colour, (y * image.width + x) * 4);
  }
}
function painted(scale = 1): RgbaImage {
  const result = image(scale);
  for (const area of Object.values(layout.controls)) ink(result, area);
  // Match the sparse ink of the real dock menu icon, without depending on a different panel background colour.
  const menu = layout.controls.panelMenu;
  ink(result, menu, [255, 255, 255, 255]);
  for (const offset of [2, 7, 12]) ink(result, box(menu.x + offset, menu.y + 6, 2, 2));
  ink(result, box(5, 103, 70, 10));
  return result;
}
const png = (image: RgbaImage) => encodePng(image, { alpha: false });

test("startup paint gate decodes shell regions and controls at device pixel scale", () => {
  for (const scale of [1, 2]) expect(() => assertStartupPaint(png(painted(scale)), png(image(scale)), layout)).not.toThrow();
});

test("startup paint gate rejects a blank shell and a boot message alone", () => {
  const blank = png(image());
  expect(() => assertStartupPaint(blank, blank, layout)).toThrow("header has insufficient non-background pixels");
  const boot = image(); ink(boot, box(30, 50, 60, 10));
  expect(() => assertStartupPaint(png(boot), blank, layout)).toThrow("header has insufficient non-background pixels");
});

test("startup paint gate requires foreground in every shell region", () => {
  const noStatus = image();
  for (const area of Object.values(layout.controls)) ink(noStatus, area);
  expect(() => assertStartupPaint(png(noStatus), png(image()), layout)).toThrow("status has insufficient non-background pixels");
});

test("startup paint gate requires visible controls with their own painted pixels", () => {
  const hiddenControl = { ...layout, controls: { ...layout.controls, commands: { ...layout.controls.commands, visible: false } } };
  expect(() => assertStartupPaint(png(painted()), png(image()), hiddenControl)).toThrow("commands is not visible");
  const noCommands = painted();
  // Keep the header painted elsewhere: a region's background/content cannot substitute for the expected control.
  ink(noCommands, layout.controls.commands, [255, 255, 255, 255]);
  ink(noCommands, box(90, 3, 20, 14));
  expect(() => assertStartupPaint(png(noCommands), png(image()), layout)).toThrow("commands has insufficient non-background pixels");
});
