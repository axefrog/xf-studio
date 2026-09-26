// Test helper, run as its own Bun process by tests/plate-reach.test.ts (PIPE-32): bakes a collection into a UV
// window with `rasterWindow` deliberately mirrored (its rows reversed: V mirrored inside the window), a common-mode
// fault in the window code. It loads the real source through a runtime plugin that renames the real
// `rasterWindow` and exports a mirrored wrapper, so nothing else in the test run sees the fault.
//
//   bun tests/mirrored-window-bake.ts <collection.json> <out-dir> <window-json> <mirror|none>
import { plugin } from "bun";

const [collectionFile, outDir, windowJson, mode] = process.argv.slice(2);
if (!collectionFile || !outDir || !windowJson || (mode !== "mirror" && mode !== "none"))
  throw Error("Usage: bun tests/mirrored-window-bake.ts <collection.json> <out-dir> <window-json> <mirror|none>");

if (mode === "mirror") plugin({
  name: "mirror rasterWindow",
  setup(build) {
    build.onLoad({ filter: /[\\/]engines[\\/]layered-makeup[\\/]recipe\.ts$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      if (!source.includes("export function rasterWindow(")) throw Error("rasterWindow not found");
      return { loader: "ts", contents: source.replace("export function rasterWindow(", "function realRasterWindow(") + `
export function rasterWindow(l: Layer, width: number, height: number, window: { u0: number; u1: number; v0: number; v1: number }) {
  const data = realRasterWindow(l, width, height, window), out = new Uint8ClampedArray(data.length), row = width * 4;
  for (let y = 0; y < height; y++) out.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}
` };
    });
  },
});

const { bakeCollection } = await import("../src/package-bake");
await bakeCollection(await Bun.file(collectionFile).json(), outDir, () => {}, { window: JSON.parse(windowJson) });
