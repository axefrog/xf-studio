/**
 * Eye makeup's Build prerequisite on either host: the built-in eye plate, cut from the head the saved launch
 * route loads and kept in the host's private cache (or, on localhost only, the `XFS_PACKAGE_PLATE` developer
 * override). The package host service (platform/export/product-host) prepares it before the builder starts,
 * plans on its UV footprint, and hands the builder its directory and manifest; Check plans on the plate the
 * last Build prepared for the same game, route and head choice (PIPE-36). Host only.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cachedPlateReach, discardCachedPlate, EyePlateError, ensureEyePlate, eyePlateRouteKey, packagePlateRecord, type EyePlateRoute,
  type EyePlateTools } from "./eye-plate-service";
import { createInstalledHeadSource } from "./eye-plate-head-resolver";
import { createWolvenKitEyePlateTools } from "./eye-plate-wolvenkit";
import { plateReachInput, readManifestPlateReach } from "./plate-uv-footprint-io";
import { plateUvFootprint } from "./engines/layered-makeup/plate-uv-window";
import { PLATE_STEMS } from "./package-resource-builder";
import { hostFailure } from "./diagnostics/host-log";
import type { HostPrerequisite, PreparedPrerequisite } from "./platform/export/product-host";

export type EyePlatePrerequisiteOptions = {
  readonly route: EyePlateRoute;
  readonly cacheRoot: string;
  readonly wolvenKitCli: string;
  readonly headOverride?: "base-game";
  /** Localhost developer override: a plate directory used as it is (no cache, no manifest). */
  readonly override?: string;
  /** Test seam: the WolvenKit adapter the plate is cut with. */
  readonly tools?: (wolvenKitCli: string) => EyePlateTools;
};

/** A failure the person sees as it is, with its code. */
const coded = (code: string, message: string) => Object.assign(Error(message), { code });
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

/** The route and head choice a plate prepared for these settings is recorded under (PIPE-36). */
export const eyePlateRouteKeyFor = (options: Pick<EyePlatePrerequisiteOptions, "route" | "headOverride">) =>
  options.route.gameRoot ? eyePlateRouteKey(options.route, options.headOverride) : null;

/** The override plate, its provenance and UV footprint, read with the host's own WolvenKit serialize of its mesh. */
async function overridePlate(directory: string, tools: EyePlateTools): Promise<PreparedPrerequisite> {
  let valid = false;
  try { valid = statSync(directory).isDirectory(); } catch { /* Missing override. */ }
  if (!valid) throw coded("package_input_missing", "The XFS_PACKAGE_PLATE developer override does not name a directory.");
  const stems = PLATE_STEMS.filter(stem => isFile(join(directory, stem + ".mesh")) && isFile(join(directory, stem + ".morphtarget")));
  if (stems.length !== 1) throw coded("package_input_missing", "The XFS_PACKAGE_PLATE developer override must hold exactly one eye plate mesh.");
  const mesh = join(directory, stems[0] + ".mesh"), morph = join(directory, stems[0] + ".morphtarget");
  const work = mkdtempSync(resolve(tmpdir(), "xfs-plate-uv-"));
  try {
    const json = await tools.serialize({ file: mesh, outDir: work });
    const reach = plateReachInput(plateUvFootprint(JSON.parse(readFileSync(json, "utf8").replace(/^﻿/, "")).Data.RootChunk));
    return { builder: { directory }, plan: { ...reach, record: { source: "override", meshSha256: sha256(mesh), morphSha256: sha256(morph) } } };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** The eye plate as a host prerequisite for these settings. */
export function eyePlatePrerequisite(options: EyePlatePrerequisiteOptions): HostPrerequisite {
  const tools = () => (options.tools ?? createWolvenKitEyePlateTools)(options.wolvenKitCli);
  const routeKey = eyePlateRouteKeyFor(options);
  return {
    cached() {
      if (options.override) return null;
      return cachedPlateReach(options.cacheRoot, options.route.gameRoot || null, routeKey)?.plate ?? null;
    },
    async prepare(signal) {
      if (options.override) return overridePlate(options.override, tools());
      try {
        const plate = await ensureEyePlate({ gameRoot: options.route.gameRoot, cacheRoot: options.cacheRoot, tools: tools(), signal,
          headSource: createInstalledHeadSource({ ...options.route, wolvenKitCli: options.wolvenKitCli }, join(options.cacheRoot, "resolver")),
          headOverride: options.headOverride, routeKey: routeKey ?? undefined });
        const reach = readManifestPlateReach(plate.manifestFile, plate.manifest);
        if (!reach) throw Error("The prepared eye plate has no recorded UV footprint.");
        return { builder: { directory: plate.directory, manifest: plate.manifestFile },
          plan: { ...reach, record: packagePlateRecord(plate.manifest) } };
      } catch (error) {
        if (error instanceof EyePlateError) {
          if (error.code !== "plate_cancelled")
            hostFailure("eye-plate", error.code, "The eye plate couldn't be prepared.", { code: error.code, message: error.message, detail: error.detail?.slice(-3000) });
          throw error;
        }
        hostFailure("eye-plate", "plate_failed", "The eye plate couldn't be prepared.", error);
        throw coded("package_build_failed", "The built-in eye plate could not be prepared. No candidate was published.");
      }
    },
    discard(prepared) {
      const manifest = (prepared.builder as { manifest?: unknown }).manifest;
      if (typeof manifest === "string") discardCachedPlate(options.cacheRoot, manifest);
    },
  };
}
