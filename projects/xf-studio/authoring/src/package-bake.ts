// Package bake: compile every preset of a collection into its route's 1024-pixel raw maps plus
// a plan and compiled record. Shared by the package builder and tools/bake_collection.ts.
// Packaging and game installation are separate operations.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTE_CHANNELS, type ExportRoute, type TextureChannel } from "./finish-export";
import { compilePreset } from "./preset-compiler";
import { planCollection } from "./preset-collection";

export type CollectionPlan = ReturnType<typeof planCollection>;
/** The flat route's channels, kept for callers that predate the other routes. */
export const BAKED_CHANNELS = ROUTE_CHANNELS.flat;
export type BakedChannel = TextureChannel;
/** `side` is the map's square size; it equals the record size except for the small Fresnel gradient. */
export interface BakedMap { channel: BakedChannel; file: string; bytes: number; sha256: string; side: number }
export interface BakedRecord { id: string; revision: number; size: number; route: ExportRoute; maps: BakedMap[]; metadata: unknown; recipeSha256: string }
export const PACKAGE_MAP_SIZE = 1024;

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/**
 * Write `<appearance>_<channel>.raw`, `plan.json` and `compiled.json` into `outDir`.
 * `beforePreset` runs before each compile so a caller can yield or stop between presets.
 */
export async function bakeCollection(value: unknown, outDir: string,
  beforePreset: (index: number) => void | Promise<void> = () => {}): Promise<{ plan: CollectionPlan; records: BakedRecord[] }> {
  const plan = planCollection(value), out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const records: BakedRecord[] = [];
  for (const [index, preset] of plan.presets.entries()) {
    await beforePreset(index);
    const compiled = compilePreset(preset.recipe, PACKAGE_MAP_SIZE);
    if (compiled.route !== preset.route) throw Error(`Preset ${preset.id} compiled as ${compiled.route}, planned as ${preset.route}`);
    const maps: BakedMap[] = [];
    for (const channel of ROUTE_CHANNELS[compiled.route]) {
      const data = compiled.maps[channel]!, file = `${preset.appearance}_${channel}.raw`;
      writeFileSync(resolve(out, file), data);
      maps.push({ channel, file, bytes: data.byteLength, sha256: sha256(data), side: compiled.sides[channel]! });
    }
    records.push({ id: preset.id, revision: preset.revision, size: compiled.size, route: compiled.route, maps, metadata: compiled.metadata,
      recipeSha256: sha256(JSON.stringify(preset.recipe)) });
  }
  writeFileSync(resolve(out, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  writeFileSync(resolve(out, "compiled.json"), JSON.stringify(records, null, 2) + "\n");
  return { plan, records };
}
