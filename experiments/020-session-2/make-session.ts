// Writes session-2.collection.json: one diagnostic collection for the second in-game session.
// It combines experiment 017's depth, gloss, shimmer and metal-ramp presets (built with the
// plate-local UV window that is now the default) with experiment 019's placement pair
// ("Lines · new" / "Lines · old"). Deterministic; rerun after either source changes.
//
//   bun experiments/020-session-2/make-session.ts
//
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const depth = read("017-plate-depth/depth-candidate.collection.json");
const uv = read("019-uv-window/uv-window.collection.json");
const lines = uv.presets.filter((preset: { name: string }) => preset.name.startsWith("Lines"));
if (lines.length !== 2) throw Error("Expected the two Lines presets in experiment 019.");
const shortName: Record<string, string> = { "Lines · new density": "Lines · new", "Lines · old density": "Lines · old" };
const presets = [...depth.presets, ...lines.map((preset: { name: string }) => ({ ...preset, name: shortName[preset.name] ?? preset.name }))];
const diagnostics = { schema: depth.diagnostics.schema, presets: { ...depth.diagnostics.presets } };
for (const preset of lines) {
  const entry = uv.diagnostics.presets[preset.id];
  if (entry) diagnostics.presets[preset.id] = entry;
}
for (const preset of presets) if (preset.name.length > 24) throw Error(`Preset name too long for the selector: ${preset.name}`);
const collection = { schema: depth.schema, id: "0200a5e5-2e55-4c02-9d0b-0000000000d0", name: "XF session 2 (diagnostic)", presets, diagnostics };
writeFileSync(resolve(import.meta.dir, "session-2.collection.json"), JSON.stringify(collection, null, 2) + "\n");
console.log(`Wrote ${presets.length} presets.`);
