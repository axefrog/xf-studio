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
import { cachedPlateReach, cachedPlateStatus, discardCachedPlate, EyePlateError, ensureEyePlate, eyePlateRouteKey, FEMININE_ONLY,
  packagePlateRecord, unavailablePlate, type EyePlateRoute, type EyePlateTools, type UnavailablePlate } from "./eye-plate-service";
import { EYE_PLATE_MASCULINE_RECIPE, EYE_PLATE_RECIPE, type EyePlateRecipe } from "./eye-plate-recipe";
import { EYE_PLATE_HEAD_SETTING } from "./eye-plate-head-choice";
import { EYE_MAKEUP_MOD } from "./mod-branding";
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
  /** Which body's plate (the feminine plate by default). */
  readonly recipe?: EyePlateRecipe;
};

/** Why the masculine plate can't be used, in plain words with the one next step, by the plate service's code. */
export function masculineUnavailable(code: string): UnavailablePlate {
  const labels = EYE_PLATE_MASCULINE_RECIPE.source.supported.map(item => item.label).join(", ");
  const why: Record<string, string> = {
    plate_source_missing: "XF Studio couldn't find the male player head in your game files. Verify the game files in your launcher, then build again to include a masculine V.",
    plate_source_unsupported: `your game's male player head isn't one XF Studio has checked (it supports ${labels}). Update XF Studio to include a masculine V.`,
    plate_source_modded: `an installed head mod changes the male head in a way ${EYE_MAKEUP_MOD.modName} doesn't support yet. To include a masculine V, set “${EYE_PLATE_HEAD_SETTING.label}” to “${EYE_PLATE_HEAD_SETTING.options["base-game"]}” in Settings › Game, then build again.`,
    plate_source_incomplete: "XF Studio couldn't read every mod that might change the male head. Build again once your mods can be read to include a masculine V.",
    plate_override: "the developer plate override has no masculine plate.",
  };
  return { unavailable: { code, message: `${FEMININE_ONLY}: ${why[code] ?? "XF Studio couldn't prepare the masculine eye plate this time. Build again to include a masculine V."}` } };
}

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
  const recipe = options.recipe ?? EYE_PLATE_RECIPE;
  return {
    cached() {
      if (options.override) return null;
      return cachedPlateReach(options.cacheRoot, options.route.gameRoot || null, routeKey, recipe)?.plate ?? null;
    },
    async prepare(signal) {
      if (options.override) return overridePlate(options.override, tools());
      try {
        const plate = await ensureEyePlate({ gameRoot: options.route.gameRoot, cacheRoot: options.cacheRoot, tools: tools(), signal, recipe,
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

/**
 * The masculine V's eye plate as an optional host prerequisite: the same preparation from the male head the route loads,
 * but a plate that can't be prepared never stops the Build. Its value then says why (`UnavailablePlate`), the plan makes the
 * mod for a feminine V only and says so. Only cancellation stops the Build. Check plans on the last preparation for this
 * route: a ready plate, a recorded reason it couldn't be, or nothing yet.
 */
export function masculineEyePlatePrerequisite(options: Omit<EyePlatePrerequisiteOptions, "recipe">): HostPrerequisite {
  const plate = eyePlatePrerequisite({ ...options, override: undefined, recipe: EYE_PLATE_MASCULINE_RECIPE });
  const routeKey = eyePlateRouteKeyFor(options);
  const unavailable = (code: string): PreparedPrerequisite => { const value = masculineUnavailable(code); return { builder: value, plan: value }; };
  return {
    cached() {
      if (options.override) return masculineUnavailable("plate_override");
      const ready = plate.cached();
      if (ready) return ready;
      const status = cachedPlateStatus(options.cacheRoot, options.route.gameRoot || null, routeKey, EYE_PLATE_MASCULINE_RECIPE);
      return status && status.state !== "ready" && status.code && ["plate_source_missing", "plate_source_unsupported", "plate_source_modded"].includes(status.code)
        ? masculineUnavailable(status.code) : null;
    },
    async prepare(signal) {
      if (options.override) return unavailable("plate_override");
      try { return await plate.prepare(signal); }
      catch (error) {
        if (signal.aborted || (error as { code?: unknown })?.code === "plate_cancelled") throw error;
        // The feminine route already logged the failure; here it only decides what the mod leaves out.
        return unavailable(error instanceof EyePlateError ? error.code : "plate_failed");
      }
    },
    discard(prepared) { if (!unavailablePlate(prepared.plan)) plate.discard(prepared); },
  };
}
