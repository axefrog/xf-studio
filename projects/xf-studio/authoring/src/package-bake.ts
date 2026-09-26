// Package bake: compile every preset of a collection into its route's raw maps plus a plan and
// compiled record. Shared by the package builder and tools/bake_collection.ts. Packaging and game
// installation are separate operations.
//
// Texture space. With a plate UV window (the package builder derives it from the plate it packages),
// flat and faceted presets compile into that window at 2048 × 512 and also write a head-UV coverage
// reference that the independent verifier maps back through the plate's UVs. The reference is cropped
// from the head-atlas raster, not the window rasterizer, so the two never share a fault (PIPE-32).
// Without a window (the Experiment 005 oracle's bake adapter) every preset keeps the historical 1024
// head-UV layout, and the written plan says so: each preset's `uvSpace` is "head" (PIPE-34).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACCENT_TEXTURE_SIZE, GLITTER_WINDOW_TEXTURE, HEAD_TEXTURE_SIZE, ROUTE_CHANNELS, WINDOW_TEXTURE, type ExportRoute, type TextureChannel } from "./engines/layered-makeup/finish-export";
import { compileGlitterPreset } from "./glitter-route";
import type { UvWindow } from "./engines/layered-makeup/plate-uv-window";
import { compilePreset, presetCoverage, type TextureSpace } from "./engines/layered-makeup/preset-compiler";
import { planCollection } from "./preset-collection";

export type CollectionPlan = ReturnType<typeof planCollection>;
/** The flat route's channels, kept for callers that predate the other routes. */
export const BAKED_CHANNELS = ROUTE_CHANNELS.flat;
export type BakedChannel = TextureChannel;
/**
 * A raw map: `width` × `height` texels; `side` is kept for square maps (head UV and the Fresnel gradient). A
 * diagnostic glitter map is its whole supplied chain (`levels` levels, largest first, concatenated), because its
 * nested levels are drawn, not reduced from level 0.
 */
export interface BakedMap { channel: BakedChannel; file: string; bytes: number; sha256: string; width: number; height: number; side?: number; levels?: number }
/**
 * Head-UV linear coverage of the preset's included layers (1 byte per texel), for the verifier's mapping
 * check: texels [x0, x0 + width) × [y0, y0 + height) of a `grid`² head atlas, covering the window.
 */
export interface BakedReference { file: string; bytes: number; sha256: string; grid: number; x0: number; y0: number; width: number; height: number }
export interface BakedRecord {
  id: string; revision: number; route: ExportRoute;
  /** `plate-window`: maps cover `window`; `head`: maps cover the whole head atlas (`size` square). */
  uvSpace: "plate-window" | "head"; width: number; height: number; size?: number; window?: UvWindow;
  maps: BakedMap[]; reference?: BakedReference;
  /** A diagnostic glitter accent's layer alone, on the same crop: the verifier samples the accent mask against it at the plate's UVs. */
  accentReference?: BakedReference;
  metadata: unknown; recipeSha256: string;
}
/** Side of head-UV maps (the Fresnel route, head-UV diagnostics and the oracle layout). */
export const PACKAGE_MAP_SIZE = HEAD_TEXTURE_SIZE;
/**
 * Head-atlas grid of the coverage reference written beside each window preset: 4096, so its texels
 * (about 0.14 × 0.10 mm on the lids) are at least as fine as the window's and sharp edges compare fairly.
 * Only the window's rectangle plus two texels is written.
 */
export const REFERENCE_GRID = 4096;
export function referenceCrop(window: UvWindow, grid = REFERENCE_GRID) {
  const x0 = Math.max(0, Math.floor(window.u0 * grid) - 2), y0 = Math.max(0, Math.floor(window.v0 * grid) - 2);
  const x1 = Math.min(grid, Math.ceil(window.u1 * grid) + 2), y1 = Math.min(grid, Math.ceil(window.v1 * grid) + 2);
  return { grid, x0, y0, width: x1 - x0, height: y1 - y0 };
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export interface BakeOptions {
  /** The packaged plate's UV window; absent keeps every preset on head UV (the oracle's historical layout). */
  readonly window?: UvWindow;
}

/**
 * One diagnostic glitter preset (glitter-route.ts): every channel's whole chain in one raw file, the accent's head-UV
 * chain when it has one, and the head-UV coverage reference of its pigment layers for the verifier's mapping gate (and of
 * the accent's layer alone, for its placement at the plate's UVs).
 */
function bakeGlitter(preset: CollectionPlan["presets"][number], out: string, window: UvWindow): BakedRecord {
  const knob = preset.diagnostics?.glitter;
  if (!knob) throw Error(`Glitter preset ${preset.id} has no glitter knob.`);
  const chains = compileGlitterPreset(preset.recipe, knob, window), maps: BakedMap[] = [];
  const channels: TextureChannel[] = [...ROUTE_CHANNELS.glitter, ...(chains.accent ? ["accent" as const] : [])];
  for (const channel of channels) {
    const levels = channel === "accent" ? chains.accent! : chains[channel as "diffuse" | "roughness" | "metalness" | "normal" | "flakes"];
    const data = Buffer.concat(levels), file = `${preset.appearance}_${channel}.raw`;
    const size = channel === "accent" ? { width: ACCENT_TEXTURE_SIZE, height: ACCENT_TEXTURE_SIZE, side: ACCENT_TEXTURE_SIZE } : { ...GLITTER_WINDOW_TEXTURE };
    writeFileSync(resolve(out, file), data);
    maps.push({ channel, file, bytes: data.byteLength, sha256: sha256(data), ...size, levels: levels.length });
  }
  const crop = referenceCrop(window), reference = presetCoverage(preset.recipe, crop), referenceFile = `${preset.appearance}_reference.raw`;
  writeFileSync(resolve(out, referenceFile), reference);
  let accentReference: BakedReference | undefined;
  if (knob.accent) {
    const layers = preset.recipe.layers.filter(layer => layer.id === knob.accent!.layer);
    const data = presetCoverage({ ...preset.recipe, layers }, crop), file = `${preset.appearance}_accent_reference.raw`;
    writeFileSync(resolve(out, file), data);
    accentReference = { file, bytes: data.byteLength, sha256: sha256(data), ...crop };
  }
  return { id: preset.id, revision: preset.revision, route: "glitter", uvSpace: "plate-window", ...GLITTER_WINDOW_TEXTURE, window, maps,
    reference: { file: referenceFile, bytes: reference.byteLength, sha256: sha256(reference), ...crop }, ...(accentReference ? { accentReference } : {}),
    metadata: { adapter: "mesh-decal-glitter-diagnostic-v1", diagnostic: true, levels: chains.stats, ...(chains.accentStats ? { accent: chains.accentStats } : {}),
      limitations: ["Diagnostic only: flakes come from the preset's glitter knob; the Glitter finish itself has no export route.",
        "Nested flake mips are drawn per level; how the game's filtering, TAA and upscalers treat them needs in-game evidence."] },
    recipeSha256: sha256(JSON.stringify(preset.recipe)) };
}

/**
 * Write `<appearance>_<channel>.raw` (and `<appearance>_reference.raw` for window presets), `plan.json`
 * and `compiled.json` into `outDir`. `beforePreset` runs before each compile so a caller can yield or stop.
 */
export async function bakeCollection(value: unknown, outDir: string,
  beforePreset: (index: number) => void | Promise<void> = () => {}, options: BakeOptions = {}): Promise<{ plan: CollectionPlan; records: BakedRecord[] }> {
  const planned = planCollection(value), out = resolve(outDir);
  // The oracle layout: every map on head UV, so the plan may not claim the plate window for any preset.
  const plan: CollectionPlan = options.window ? planned
    : { ...planned, presets: planned.presets.map(preset => ({ ...preset, uvSpace: "head" as const })) };
  mkdirSync(out, { recursive: true });
  const records: BakedRecord[] = [];
  for (const [index, preset] of plan.presets.entries()) {
    await beforePreset(index);
    const windowed = !!options.window && preset.uvSpace === "plate-window";
    if (preset.route === "glitter") {
      if (!windowed) throw Error(`Diagnostic glitter preset ${preset.id} needs the plate's UV window.`);
      records.push(bakeGlitter(preset, out, options.window!));
      continue;
    }
    const space: TextureSpace = windowed ? { kind: "window", ...WINDOW_TEXTURE, window: options.window! } : { kind: "head", size: PACKAGE_MAP_SIZE };
    const compiled = compilePreset(preset.recipe, space);
    if (compiled.route !== preset.route) throw Error(`Preset ${preset.id} compiled as ${compiled.route}, planned as ${preset.route}`);
    const maps: BakedMap[] = [];
    for (const channel of ROUTE_CHANNELS[compiled.route]) {
      const data = compiled.maps[channel]!, file = `${preset.appearance}_${channel}.raw`, dims = compiled.dims[channel]!;
      writeFileSync(resolve(out, file), data);
      maps.push({ channel, file, bytes: data.byteLength, sha256: sha256(data), width: dims.width, height: dims.height,
        ...(dims.width === dims.height ? { side: dims.width } : {}) });
    }
    let reference: BakedReference | undefined;
    if (windowed) {
      const crop = referenceCrop(options.window!), data = presetCoverage(preset.recipe, crop), file = `${preset.appearance}_reference.raw`;
      writeFileSync(resolve(out, file), data);
      reference = { file, bytes: data.byteLength, sha256: sha256(data), ...crop };
    }
    const grid = compiled.space.kind === "window"
      ? { uvSpace: "plate-window" as const, width: compiled.space.width, height: compiled.space.height, window: compiled.space.window }
      : { uvSpace: "head" as const, width: compiled.space.size, height: compiled.space.size, size: compiled.space.size };
    records.push({ id: preset.id, revision: preset.revision, route: compiled.route, ...grid, maps, ...(reference ? { reference } : {}),
      metadata: compiled.metadata, recipeSha256: sha256(JSON.stringify(preset.recipe)) });
  }
  writeFileSync(resolve(out, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  writeFileSync(resolve(out, "compiled.json"), JSON.stringify(records, null, 2) + "\n");
  return { plan, records };
}
