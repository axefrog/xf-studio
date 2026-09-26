// Compile one filtered collection snapshot into an intermediate build: baked maps, full
// mip chains, converted XBM/mesh/morph/app/customization resources, the pre-pack path
// gate, the packed archive and its ArchiveXL declaration, and build.json. Never installs.
//
// TypeScript port of experiments/005-preset-collection/build.py, which remains a research
// oracle. Differences, all deliberate: the bake runs in-process; the builder no longer
// writes PNG copies of the maps or asks WolvenKit for a PNG export, because only the old
// Python verifier read them; and it no longer round-trips the resources or exports the
// textures, because the independent verifier converts the unbundled archive members itself.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { archiveInventory } from "./archive-inventory-fs";
import type { LayeredMakeupRegion } from "./engines/layered-makeup/region";
import { bakeCollection, type BakedRecord, type CollectionPlan } from "./package-bake";
import { encodeDds, flatMipChain } from "./engines/layered-makeup/flat-mip-chain";
import { facetedMipChain, maskMipChain, normalRgba, uniformMipChain } from "./engines/layered-makeup/route-mip-chains";
import { liftPlate, type PlateLiftReport } from "./plate-lift";
import { plateUvFootprint, uvTransformConstants, type PlateUvFootprint, type StoredUvBounds, type UvTransformConstants,
  type UvWindow } from "./engines/layered-makeup/plate-uv-window";
import type { TextureChannel } from "./engines/layered-makeup/finish-export";
import { PackageToolError, type PackageResourceTools, type TextureImportSettings, type ToolStep } from "./package-build-wolvenkit";
import {
  appearanceResource, archiveXlDeclaration, assertBrandedPlan, customizationResource, HandleCounter,
  resourceJson, rewritePlateMesh, rewritePlateMorph,
} from "./package-resources";

/** Accepted plate stems: the host-derived built-in plate, then the historical Experiment 004 override name. */
/**
 * The plate's own UVs give another footprint than the one the collection was planned on (a cached plate recorded
 * under an older rule, or a plate changed during the Build). The CLI reports it as `package_plate_stale`, and the
 * hosts then discard that cached plate and build once more on a fresh one (PIPE-37).
 */
export class PlateFootprintChangedError extends Error {}

export const PLATE_STEMS = ["xfs_eye_plate", "xfas_eye_plate"] as const;

export interface ResourceBuildOptions {
  /** Filtered, package-only collection value (already validated by the preflight). */
  readonly collection: unknown;
  /** Fresh intermediate directory; must not exist. */
  readonly output: string;
  /** Directory holding exactly one plate mesh/morphtarget pair. */
  readonly plate: string;
  /** Eye makeup's layered-makeup region: its models, mirror and texture grids. */
  readonly region: LayeredMakeupRegion;
  readonly tools: PackageResourceTools;
  /**
   * The plate UV footprint the preflight planned on (which presets reach the plate). The plate this build
   * serializes must give exactly this footprint; absent only for callers that plan on no plate.
   */
  readonly plateUv?: PlateUvFootprint;
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
}

export interface BuildRecord {
  plan: CollectionPlan; compiled: BakedRecord[]; steps: { name: string; exitCode: number }[];
  plateStem: string; plateInputs: { path: string; sha256: string }[];
  /** The decal lift applied to the plate geometry (one render chunk per lift). */
  plateLift: PlateLiftReport;
  /**
   * The plate's stored UV0 bounds, the plate-local texture window derived from them and its material constants,
   * and the SHA-256 of the plate's whole UV footprint (bounds, window, vertex UVs and triangles).
   */
  plateUv: { bounds: StoredUvBounds; window: UvWindow; transform: UvTransformConstants; footprintSha256: string };
  artifacts: ReturnType<typeof archiveInventory>; archiveSha256: string;
  installed: false; gameRenderingVerified: false;
}

const TEXTURE_GROUPS: readonly (readonly [string, TextureImportSettings])[] = [
  ["dds-colour", { IsGamma: true, TextureGroup: "TEXG_Generic_Color", RawFormat: "TRF_TrueColor", Compression: "TCM_QualityColor",
    GenerateMipMaps: false, IsStreamable: true, PremultiplyAlpha: false }],
  ["dds-scalar", { IsGamma: false, TextureGroup: "TEXG_Generic_Grayscale", RawFormat: "TRF_Grayscale", Compression: "TCM_QualityR",
    GenerateMipMaps: false, IsStreamable: true, PremultiplyAlpha: false }],
  ["dds-normal", { IsGamma: false, TextureGroup: "TEXG_Generic_Normal", RawFormat: "TRF_TrueColor", Compression: "TCM_Normalmap",
    GenerateMipMaps: false, IsStreamable: true, PremultiplyAlpha: false }],
];
/** Import group of each texture channel: sRGB colour, linear scalar or tangent normal. */
export const CHANNEL_GROUP: Record<TextureChannel, "dds-colour" | "dds-scalar" | "dds-normal"> = {
  diffuse: "dds-colour", gradient: "dds-colour", roughness: "dds-scalar", metalness: "dds-scalar", mask: "dds-scalar", normal: "dds-normal",
  flakes: "dds-scalar", accent: "dds-scalar",
};
/** Split a diagnostic glitter map's concatenated chain into its levels (each channel's bytes per texel). */
function chainLevels(data: Uint8Array, width: number, height: number, levels: number, bytesPerTexel: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let offset = 0;
  for (let level = 0; level < levels; level++) {
    const length = Math.max(1, width >> level) * Math.max(1, height >> level) * bytesPerTexel;
    out.push(data.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== data.length) throw Error("A glitter map's chain does not match its recorded levels.");
  return out;
}
const TEXEL_BYTES: Record<TextureChannel, number> = { diffuse: 4, gradient: 4, normal: 2, roughness: 1, metalness: 1, mask: 1, flakes: 1, accent: 1 };
const FOLDERS = ["logs", "baked", "source-json", "models-json", "app-json", "cc-json",
  "input/dds-colour", "input/dds-scalar", "input/dds-normal", "archive", "package/archive/pc/mod"];

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));

/** The one plate stem present as a complete mesh/morphtarget pair in `plate`, or an error. */
export function plateStem(plate: string): string {
  const stems = PLATE_STEMS.filter(stem => isFile(join(plate, stem + ".mesh")) && isFile(join(plate, stem + ".morphtarget")));
  if (stems.length !== 1) throw Error(`Plate directory must contain exactly one mesh/morphtarget pair: ${plate}`);
  return stems[0];
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new PackageToolError("package_build_cancelled", "Package Build was cancelled.");
}

export async function buildPackageResources(options: ResourceBuildOptions): Promise<BuildRecord> {
  const out = resolve(options.output), plate = resolve(options.plate);
  const log = options.log ?? (() => {});
  if (existsSync(out)) throw Error(`Output already exists: ${out}`);
  const stem = plateStem(plate);
  for (const folder of FOLDERS) mkdirSync(join(out, ...folder.split("/")), { recursive: true });
  const steps: BuildRecord["steps"] = [];
  const step = async (name: string, run: () => Promise<ToolStep>) => {
    checkCancelled(options.signal);
    try {
      const result = await run();
      writeFileSync(join(out, "logs", `${name}.log`), result.log, "utf8");
      steps.push({ name, exitCode: result.exitCode });
      log(`${name} complete`);
    } catch (error) {
      if (error instanceof PackageToolError) writeFileSync(join(out, "logs", `${name}.log`), error.log, "utf8");
      throw error;
    }
  };

  // 1. The plate's own UVs decide the texture window, so serialize it before compiling (after one yield, so an
  //    immediate cancel stops before any conversion).
  await new Promise(done => setImmediate(done));
  await step("serialize-owned-models", () => options.tools.serialize(plate, join(out, "source-json")));
  const sourceMesh = readJson(join(out, "source-json", stem + ".mesh.json"));
  const footprint = plateUvFootprint(sourceMesh.Data.RootChunk), { bounds, window } = footprint;
  const footprintSha256 = sha256(JSON.stringify(footprint));
  // The collection was filtered against a plate footprint (presets that never reach the plate were omitted); it must be this plate's.
  if (options.plateUv && sha256(JSON.stringify(options.plateUv)) !== footprintSha256)
    throw new PlateFootprintChangedError("The eye plate's recorded UV footprint differs from the plate itself.");
  const plateUv = { bounds, window, transform: uvTransformConstants(window), footprintSha256 };
  writeFileSync(join(out, "logs", "plate-uv.log"), JSON.stringify(plateUv) + "\n", "utf8");

  // 2. Compile each preset's route maps in-process, yielding between presets so a cancel is seen.
  const baked = join(out, "baked");
  const { records } = await bakeCollection(options.collection, baked, { window, region: options.region }, async () => {
    await new Promise(done => setImmediate(done));
    checkCancelled(options.signal);
  });
  writeFileSync(join(out, "logs", "bake.log"),
    `Compiled ${records.length} authored presets; ${records.reduce((n, r) => n + r.maps.length, 0)} map inputs. No installation.\n`, "utf8");
  steps.push({ name: "bake", exitCode: 0 });
  log("bake complete");
  // The build record keeps the plan exactly as written to plan.json.
  const plan: CollectionPlan = readJson(join(baked, "plan.json"));
  const compiled: BakedRecord[] = readJson(join(baked, "compiled.json"));
  assertBrandedPlan(plan);
  const archive = join(out, "archive");
  const modelDir = join(archive, ...dirname(plan.mesh).split("/"));
  const appDir = join(archive, ...dirname(plan.app).split("/"));
  const textureDir = join(archive, ...plan.depot.split("/"), "textures");
  for (const path of [modelDir, appDir, textureDir]) mkdirSync(path, { recursive: true });

  // 3. Full mip chains for each route, written as the DDS inputs WolvenKit imports without regenerating mips.
  const groupsUsed = new Set<string>();
  plan.presets.forEach((preset, i) => {
    const record = compiled[i];
    if (record.id !== preset.id || record.route !== preset.route) throw Error(`Compiled record ${i} does not match preset ${preset.id}`);
    if (record.uvSpace !== preset.uvSpace) throw Error(`Compiled record ${i} is on ${record.uvSpace} UV, planned ${preset.uvSpace}`);
    const raw = {} as Partial<Record<TextureChannel, Uint8Array>>;
    for (const map of record.maps) {
      const data = new Uint8Array(readFileSync(join(baked, map.file)));
      if (sha256(data) !== map.sha256) throw Error(`Baked ${map.channel} map changed after compiling: ${map.file}`);
      raw[map.channel] = data;
    }
    const chains: Partial<Record<TextureChannel, readonly Uint8Array[]>> = {};
    if (record.route === "glitter") {
      // Nested chains are drawn per level by the compiler (glitter-route.ts), not reduced here.
      for (const map of record.maps)
        chains[map.channel] = chainLevels(raw[map.channel]!, map.width, map.height, map.levels!, TEXEL_BYTES[map.channel]);
      chains.normal = chains.normal!.map(normalRgba);
    } else if (record.route === "fresnel") {
      chains.mask = maskMipChain(raw.mask!, record.width, record.height);
      chains.gradient = uniformMipChain(raw.gradient!, record.maps.find(m => m.channel === "gradient")!.width);
    } else if (record.route === "faceted") {
      const chain = facetedMipChain(raw.diffuse!, raw.roughness!, raw.metalness!, raw.normal!, record.width, record.height);
      Object.assign(chains, { diffuse: chain.diffuse, roughness: chain.roughness, metalness: chain.metalness, normal: chain.normal.map(normalRgba) });
    } else Object.assign(chains, flatMipChain(raw.diffuse!, raw.roughness!, raw.metalness!, record.width, record.height));
    for (const map of record.maps) {
      const group = CHANNEL_GROUP[map.channel];
      const format = group === "dds-colour" ? "rgba8-srgb" : group === "dds-normal" ? "rgba8-unorm" : "r8";
      writeFileSync(join(out, "input", group, `${preset.appearance}_${map.channel}.dds`),
        encodeDds(chains[map.channel]!, { width: map.width, height: map.height }, format));
      groupsUsed.add(group);
    }
  });
  for (const [group, settings] of TEXTURE_GROUPS)
    if (groupsUsed.has(group)) await step("import-" + group, () => options.tools.importTextures(join(out, "input", group), textureDir, settings));

  // 4. Lift the plate off the skin like the vanilla face decals (positions only; one chunk per planned lift),
  //    then rewrite its appearances/materials (window entries carry the UV transform) and the morph's base mesh.
  const handles = new HandleCounter();
  const lifted = liftPlate(sourceMesh, readJson(join(out, "source-json", stem + ".morphtarget.json")), plan.plate.liftsMm);
  writeFileSync(join(out, "logs", "plate-lift.log"), JSON.stringify(lifted.report) + "\n", "utf8");
  const mesh = rewritePlateMesh(lifted.mesh, plan, handles, plateUv.transform);
  writeFileSync(join(out, "models-json", plan.mesh.slice(plan.mesh.lastIndexOf("/") + 1) + ".json"), resourceJson(mesh), "utf8");
  const morph = rewritePlateMorph(lifted.morph, plan);
  writeFileSync(join(out, "models-json", plan.morph.slice(plan.morph.lastIndexOf("/") + 1) + ".json"), resourceJson(morph), "utf8");
  await step("deserialize-models", () => options.tools.deserialize(join(out, "models-json"), modelDir));

  // 5. The .app template and the character-customization selector.
  const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  writeFileSync(join(out, "app-json", fileName(plan.app) + ".json"), resourceJson(appearanceResource(plan, handles)), "utf8");
  writeFileSync(join(out, "cc-json", fileName(plan.customization) + ".json"), resourceJson(customizationResource(plan, handles)), "utf8");
  await step("deserialize-app", () => options.tools.deserialize(join(out, "app-json"), appDir));
  await step("deserialize-customization", () => options.tools.deserialize(join(out, "cc-json"), appDir));

  // 6. Pre-pack gate: the physical tree must equal the planned canonical resource paths exactly.
  checkCancelled(options.signal);
  const artifacts = archiveInventory(archive, plan);
  const packageDir = join(out, "package", "archive", "pc", "mod");
  await step("pack", () => options.tools.pack(archive, packageDir));
  const packed = join(packageDir, "archive.archive");
  if (!isFile(packed) || readdirSync(packageDir).length !== 1) throw Error("WolvenKit did not produce exactly one packed archive.");
  const archiveFile = join(packageDir, plan.namespace + ".archive");
  renameSync(packed, archiveFile);
  writeFileSync(join(packageDir, plan.namespace + ".archive.xl"), archiveXlDeclaration(plan), "utf8");
  const plateInputs = [".mesh", ".morphtarget"].map(suffix => join(plate, stem + suffix))
    .map(path => ({ path, sha256: sha256(readFileSync(path)) }));
  const record: BuildRecord = { plan, compiled, steps, plateStem: stem, plateInputs, plateLift: lifted.report, plateUv, artifacts,
    archiveSha256: sha256(readFileSync(archiveFile)), installed: false, gameRenderingVerified: false };
  writeFileSync(join(out, "build.json"), JSON.stringify(record) + "\n", "utf8");
  log(`BUILD ${out}`);
  return record;
}
