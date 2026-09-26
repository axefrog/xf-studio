/**
 * Eye makeup's Build prerequisite, the eye plate, as the builder reads it: which plate is packaged (the
 * host-derived built-in plate, or a developer override) with its provenance, and the plate's UV footprint
 * the plan is made on. Host only.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ExportRefusal, type ResourceTools } from "../../../platform/api";
import { EYE_PLATE_MANIFEST_SCHEMA, packagePlateRecord } from "../../../eye-plate-service";
import { plateReachInput, readManifestPlateReach } from "../../../plate-uv-footprint-io";
import { plateUvFootprint } from "../../../engines/layered-makeup/plate-uv-window";
import { plateStem } from "../../../package-resource-builder";
import { PackageToolError } from "../../../package-build-wolvenkit";
import type { PackagePlate } from "../../../package-action";
import type { PlateReachInput } from "../../../plate-reach";

/** What the host hands the builder for the plate: the plate directory and, for the built-in plate, its cache manifest. */
export type PlateBuilderInput = { readonly directory: string; readonly manifest?: string };
/**
 * The plate as a Build plans, builds and verifies on it: its files and provenance, the recipe's morph target
 * count (unknown for an override) and its UV footprint (`footprint`, `sha256`: the plan reads these).
 */
export type PlateBuildValue = PlateReachInput & PlateBuilderInput & {
  readonly stem: string; readonly mesh: string; readonly morph: string;
  readonly record: PackagePlate; readonly morphTargets?: number;
};

const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const refuse = (code: string, message: string): never => { throw new ExportRefusal(code, message); };

/** Canonical path of an input that must exist. */
function existing(path: string, label: string): string {
  if (!existsSync(path)) refuse("package_input_missing", `${label} is missing: ${resolve(path)}`);
  return realpathSync.native(resolve(path));
}

/** The builder-side plate input as the host passed it, or a refusal naming what is missing. */
export function plateBuilderInput(value: unknown): PlateBuilderInput {
  const input = value as Partial<PlateBuilderInput> | null;
  if (!input || typeof input.directory !== "string" || (input.manifest !== undefined && typeof input.manifest !== "string"))
    return refuse("package_input_missing", "Build requires the eye plate (--plate, and --plate-manifest for the built-in plate).");
  return { directory: input.directory, ...(input.manifest !== undefined ? { manifest: input.manifest } : {}) };
}

/**
 * Which eye plate is packaged: the host-derived built-in plate or a developer override, and the
 * plate recipe's morph target count for the verifier (unknown for an override).
 */
export function plateProvenance(manifestPath: string | undefined, mesh: string, morph: string): { record: PackagePlate; morphTargets?: number } {
  const meshSha256 = fileHash(mesh), morphSha256 = fileHash(morph);
  if (!manifestPath) return { record: { source: "override", meshSha256, morphSha256 } };
  const manifest = JSON.parse(readFileSync(existing(manifestPath, "Plate manifest"), "utf8"));
  const files = manifest?.files ?? {};
  if (manifest?.schema !== EYE_PLATE_MANIFEST_SCHEMA || files.mesh?.sha256 !== meshSha256 || files.morph?.sha256 !== morphSha256 ||
      !Number.isSafeInteger(manifest?.verification?.morphTargets))
    refuse("package_plate_mismatch", "The eye plate manifest does not match the plate resources.");
  return { record: packagePlateRecord(manifest), morphTargets: manifest.verification.morphTargets };
}

/** The UV footprint a plate manifest records; null when it records none (a plate cached before footprints were recorded). */
export function manifestPlateReach(manifestPath: string): PlateReachInput | null {
  const path = existing(manifestPath, "Plate manifest");
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
    if (manifest?.schema !== EYE_PLATE_MANIFEST_SCHEMA) refuse("package_plate_mismatch", "The eye plate manifest is not a valid plate manifest.");
    return readManifestPlateReach(path, manifest);
  } catch (error) {
    if (error instanceof ExportRefusal) throw error;
    return refuse("package_plate_mismatch", "The eye plate's recorded UV footprint is damaged. Build again to prepare the plate afresh.");
  }
}

/**
 * The packaged plate's UV footprint: the one its manifest records (hash-bound to the mesh through
 * `plateProvenance`), or, for a developer override or a plate cached before footprints were recorded, read
 * from the plate mesh through one WolvenKit serialize into a private work folder.
 */
async function packagedPlateReach(manifestPath: string | undefined, plate: string, stem: string, work: string,
  tools: ResourceTools): Promise<PlateReachInput> {
  const recorded = manifestPath ? manifestPlateReach(manifestPath) : null;
  if (recorded) return recorded;
  const input = join(work, "in"), output = join(work, "out");
  mkdirSync(input, { recursive: true });
  mkdirSync(output);
  try {
    // A copy of the mesh alone: the morph target is large, and only the mesh holds the UVs.
    copyFileSync(join(plate, stem + ".mesh"), join(input, stem + ".mesh"));
    try { await tools.serialize(input, output); }
    catch (error) {
      if (error instanceof PackageToolError && error.code !== "package_tool_failed") return refuse(error.code, error.message);
      return refuse("package_tool_failed", `WolvenKit failed while reading the eye plate: ${(error as Error).message}`);
    }
    const json = join(output, stem + ".mesh.json");
    if (!isFile(json)) refuse("package_tool_failed", "WolvenKit failed while reading the eye plate: it wrote no mesh document.");
    try { return plateReachInput(plateUvFootprint(JSON.parse(readFileSync(json, "utf8").replace(/^﻿/, "")).Data.RootChunk)); }
    catch (error) { return refuse("package_plate_invalid", `The eye plate mesh has no usable UVs: ${(error as Error).message}`); }
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Resolve the plate a Build packages: its files, provenance and UV footprint. `work` is a fresh private folder. */
export async function plateBuildValue(input: PlateBuilderInput, tools: ResourceTools, work: string): Promise<PlateBuildValue> {
  const directory = existing(input.directory, "Plate directory");
  const stem = (() => {
    try { return plateStem(directory); }
    catch { return refuse("package_plate_invalid", `Plate directory must hold exactly one mesh/morphtarget pair: ${directory}`); }
  })();
  const mesh = join(directory, stem + ".mesh"), morph = join(directory, stem + ".morphtarget");
  const { record, morphTargets } = plateProvenance(input.manifest, mesh, morph);
  const reach = await packagedPlateReach(input.manifest, directory, stem, work, tools);
  return { ...reach, directory, ...(input.manifest !== undefined ? { manifest: input.manifest } : {}), stem, mesh, morph, record,
    ...(morphTargets !== undefined ? { morphTargets } : {}) };
}
