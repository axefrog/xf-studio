// capture.sheet (bridge 0.6, session 6's friction: the coordinator hand-built a contact sheet for every comparison): a
// labelled grid of named captures written to disk, with a manifest saying which file is in which cell. Labels are drawn
// with a small built-in 5x7 pixel font (upper case, digits and common punctuation), so no font or image library is needed.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, downscaleArea, encodePng, fitSize } from "./image.ts";
import type { Pixels } from "./win32.ts";

// 5x7 glyphs, one string of 7 rows of 5 bits each (1 = ink), for the characters labels use.
const GLYPHS: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "°": ["01100", "10010", "10010", "01100", "00000", "00000", "00000"],
  "·": ["00000", "00000", "00000", "01100", "01100", "00000", "00000"],
};

/** The width in pixels a label takes at a scale (each glyph 5 wide plus a 1-pixel gap). */
export const labelWidth = (text: string, scale: number) => Math.max(0, text.length * 6 - 1) * scale;

/** Draws a label (upper-cased; unknown characters become '?') into pixels at (x, y), clipped to the picture. */
export function drawLabel(pixels: Pixels, text: string, x: number, y: number, scale = 2, colour: [number, number, number] = [235, 235, 235]) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] ?? GLYPHS["?"]!;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row]![col] !== "1") continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = cx + col * scale + dx, py = y + row * scale + dy;
            if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue;
            const i = (py * pixels.width + px) * 3;
            pixels.rgb[i] = colour[0];
            pixels.rgb[i + 1] = colour[1];
            pixels.rgb[i + 2] = colour[2];
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

export type SheetCell = { label: string; pixels: Pixels; source: string };
export type SheetLayout = { columns: number; cellWidth: number; cellHeight: number; labelHeight: number; gap: number; titleHeight: number; width: number; height: number };

/** Lays the cells out: every picture fitted into one cell size (the first picture's aspect), a label strip under each. */
export function layoutSheet(cells: readonly SheetCell[], options: { columns?: number; maxWidth?: number; title?: string; scale?: number }): SheetLayout {
  const columns = Math.max(1, Math.min(options.columns ?? Math.min(4, cells.length), cells.length));
  const rows = Math.ceil(cells.length / columns);
  const gap = 6, scale = options.scale ?? 2, labelHeight = 7 * scale + 8;
  const maxWidth = options.maxWidth ?? 2400;
  const first = cells[0]!.pixels;
  const cellWidth = Math.max(16, Math.min(first.width, Math.floor((maxWidth - gap * (columns + 1)) / columns)));
  const cellHeight = Math.max(9, Math.round((first.height * cellWidth) / first.width));
  const titleHeight = options.title ? 7 * scale + 12 : 0;
  return { columns, cellWidth, cellHeight, labelHeight, gap, titleHeight, width: columns * cellWidth + gap * (columns + 1), height: titleHeight + rows * (cellHeight + labelHeight) + gap * (rows + 1) };
}

/** The labelled grid as one picture. */
export function renderSheet(cells: readonly SheetCell[], options: { columns?: number; maxWidth?: number; title?: string; scale?: number } = {}): { pixels: Pixels; layout: SheetLayout; cells: { label: string; source: string; x: number; y: number; width: number; height: number }[] } {
  if (!cells.length) throw new RangeError("a sheet needs at least one picture");
  const layout = layoutSheet(cells, options);
  const scale = options.scale ?? 2;
  const pixels: Pixels = { width: layout.width, height: layout.height, rgb: new Uint8Array(layout.width * layout.height * 3).fill(20) };
  if (options.title) drawLabel(pixels, options.title, layout.gap, 6, scale, [255, 210, 120]);
  const placed = [];
  for (const [i, cell] of cells.entries()) {
    const col = i % layout.columns, row = Math.floor(i / layout.columns);
    const x0 = layout.gap + col * (layout.cellWidth + layout.gap);
    const y0 = layout.titleHeight + layout.gap + row * (layout.cellHeight + layout.labelHeight + layout.gap);
    const size = fitSize(cell.pixels.width, cell.pixels.height, { maxWidth: layout.cellWidth, maxHeight: layout.cellHeight });
    const small = downscaleArea(cell.pixels, size.width, size.height);
    const ox = x0 + Math.floor((layout.cellWidth - small.width) / 2), oy = y0 + Math.floor((layout.cellHeight - small.height) / 2);
    for (let y = 0; y < small.height; y++) pixels.rgb.set(small.rgb.subarray(y * small.width * 3, (y + 1) * small.width * 3), ((oy + y) * layout.width + ox) * 3);
    // The label, cut to the cell's width.
    const fits = Math.max(1, Math.floor((layout.cellWidth + scale) / (6 * scale)));
    const text = cell.label.length > fits ? cell.label.slice(0, Math.max(1, fits - 1)) + "." : cell.label;
    drawLabel(pixels, text, x0 + 2, y0 + layout.cellHeight + 4, scale);
    placed.push({ label: cell.label, source: cell.source, x: ox, y: oy, width: small.width, height: small.height });
  }
  return { pixels, layout, cells: placed };
}

/** Reads a capture's PNG (a .full.png or a viewing copy) for a sheet cell. */
export function readCell(path: string, label: string): SheetCell {
  const bytes = new Uint8Array(readFileSync(path));
  return { label, pixels: decodePng(bytes), source: path };
}

/** Writes the sheet and its manifest beside each other; returns both paths. */
export function writeSheet(dir: string, name: string, sheet: ReturnType<typeof renderSheet>, extra: Record<string, unknown> = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const png = join(dir, `${stamp}-${name}.sheet.png`);
  const manifest = join(dir, `${stamp}-${name}.sheet.json`);
  const bytes = encodePng(sheet.pixels);
  writeFileSync(png, bytes);
  writeFileSync(manifest, JSON.stringify({ schema: "xfb/capture-sheet-1", name, created_at: new Date().toISOString(), image: png, width: sheet.pixels.width, height: sheet.pixels.height, layout: sheet.layout, cells: sheet.cells, ...extra }, null, 2));
  return { png, manifest, width: sheet.pixels.width, height: sheet.pixels.height, bytes: bytes.length };
}
