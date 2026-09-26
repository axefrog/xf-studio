// File and hashing side of the plate UV footprint (plate-uv-window.ts): the eye plate cache writes it beside
// each derived plate, and Check and Build read it back through the plate manifest's `uv` record.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parsePlateUvFootprint, type PlateUvFootprint } from "./engines/layered-makeup/plate-uv-window";
import type { PlateReachInput } from "./plate-reach";

/** The footprint's file name inside a plate cache entry, beside `plate-manifest.json`. */
export const PLATE_UV_FILE = "plate-uv.json";

/** SHA-256 of the footprint's compact JSON (key order as written by `plateUvFootprint`). */
export const plateUvFootprintSha256 = (footprint: PlateUvFootprint) => createHash("sha256").update(JSON.stringify(footprint)).digest("hex");

/** The plate manifest's record of its footprint file. */
export type PlateUvManifestRecord = { file: string; sha256: string; bounds: PlateUvFootprint["bounds"]; window: PlateUvFootprint["window"] };
export const plateUvManifestRecord = (footprint: PlateUvFootprint): PlateUvManifestRecord =>
  ({ file: PLATE_UV_FILE, sha256: plateUvFootprintSha256(footprint), bounds: footprint.bounds, window: footprint.window });

/** A server-side footprint with its hash, as the package filter takes it. */
export const plateReachInput = (footprint: PlateUvFootprint): PlateReachInput => ({ footprint, sha256: plateUvFootprintSha256(footprint) });

/**
 * The footprint a plate manifest records, read from beside it and checked against the recorded hash, window and
 * bounds. `null` when the manifest records none (a plate cached before footprints were recorded). Throws on a
 * damaged or mismatched file.
 */
export function readManifestPlateReach(manifestFile: string, manifest?: { uv?: PlateUvManifestRecord }): PlateReachInput | null {
  const value = manifest ?? JSON.parse(readFileSync(manifestFile, "utf8").replace(/^﻿/, ""));
  const record = value?.uv as PlateUvManifestRecord | undefined;
  if (!record) return null;
  if (typeof record.file !== "string" || basename(record.file) !== record.file) throw Error("The plate manifest's UV footprint record is damaged.");
  const footprint = parsePlateUvFootprint(JSON.parse(readFileSync(join(dirname(manifestFile), record.file), "utf8").replace(/^﻿/, "")));
  const plate = plateReachInput(footprint);
  if (plate.sha256 !== record.sha256 || JSON.stringify(footprint.window) !== JSON.stringify(record.window) ||
      JSON.stringify(footprint.bounds) !== JSON.stringify(record.bounds))
    throw Error("The plate's UV footprint does not match its manifest.");
  return plate;
}
