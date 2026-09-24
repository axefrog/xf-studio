/** Render the desktop icon set from the shared XF mark: `bun icon/make-icon.ts` (run from desktop/). */
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dir;
const master = readFileSync(resolve(here, "icon.svg"), "utf8");
const small = readFileSync(resolve(here, "icon-small.svg"), "utf8");
const render = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size }, background: "rgba(0,0,0,0)" }).render().asPng();

const pngs = new Map<number, Buffer>();
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  const png = Buffer.from(render(size <= 24 ? small : master, size));
  pngs.set(size, png);
  writeFileSync(resolve(here, `icon-${size}.png`), png);
}

// Windows ICO container holding PNG-compressed images (supported since Vista).
const sizes = [16, 24, 32, 48, 256];
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const png = pngs.get(size)!, entry = 6 + 16 * i;
  header.writeUInt8(size === 256 ? 0 : size, entry); header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
writeFileSync(resolve(here, "icon.ico"), Buffer.concat([header, ...sizes.map(s => pngs.get(s)!)]));
console.log(`Wrote ${pngs.size} PNGs and icon.ico (${sizes.join("/")} px).`);
