import { decodePng } from "../../src/formats/png";

export type PaintBox = { x: number; y: number; width: number; height: number; visible: boolean };
export type StartupPaintLayout = {
  width: number; height: number;
  regions: Record<"header" | "workspace" | "status", PaintBox>;
  controls: Record<"commands" | "newTab" | "panelMenu", PaintBox>;
};

/** Compare composited pixels with the same page's hidden-shell background, independently of DOM text or paint timing. */
export function assertStartupPaint(png: Uint8Array, backgroundPng: Uint8Array, layout: StartupPaintLayout): void {
  const image = decodePng(png), background = decodePng(backgroundPng);
  if (image.width !== background.width || image.height !== background.height) throw Error("Startup capture dimensions changed.");
  if (!(layout.width > 0 && layout.height > 0)) throw Error("Startup viewport has no area.");
  const scaleX = image.width / layout.width, scaleY = image.height / layout.height;
  // Icon-only controls (the dock menu is three 2px squares) need a smaller floor than a whole shell region.
  for (const [boxes, pixelFloor] of [[layout.regions, 24], [layout.controls, 8]] as const) for (const [name, box] of Object.entries(boxes)) {
    if (!box.visible || !(box.width > 0 && box.height > 0)) throw Error(`Startup ${name} is not visible.`);
    const left = Math.max(0, Math.floor(box.x * scaleX)), top = Math.max(0, Math.floor(box.y * scaleY));
    const right = Math.min(image.width, Math.ceil((box.x + box.width) * scaleX)), bottom = Math.min(image.height, Math.ceil((box.y + box.height) * scaleY));
    if (right <= left || bottom <= top) throw Error(`Startup ${name} is outside the capture.`);
    let foreground = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const at = (y * image.width + x) * 4;
      // Ignore tiny colour drift from compositing/antialiasing. Alpha alone is not visible content.
      for (let channel = 0; channel < 3; channel++) if (Math.abs(image.data[at + channel]! - background.data[at + channel]!) > 12) { foreground++; break; }
    }
    const minimum = Math.max(Math.ceil(pixelFloor * scaleX * scaleY), Math.ceil((right - left) * (bottom - top) * .005));
    if (foreground < minimum) throw Error(`Startup ${name} has insufficient non-background pixels (${foreground} < ${minimum}).`);
  }
}
