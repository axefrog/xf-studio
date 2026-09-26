/**
 * Eye makeup's exporter and host-side devices bound to eye makeup's region, for tests (node only: this imports
 * the package pipeline). Browser-safe engine bindings are in `eye-region.ts`.
 */
import { EYE_MIRROR, EYE_REGION, inMemory } from "./eye-region";
import type * as recipe from "../../src/engines/layered-makeup/recipe";
import * as reach from "../../src/plate-reach";
import * as filter from "../../src/package-filter";
import * as glitter from "../../src/glitter-route";
import * as bake from "../../src/package-bake";
import * as resources from "../../src/package-resource-builder";
import { EYE_MAKEUP_EXPORTER } from "../../src/features/eye-makeup/export";
import { EYE_PLATE_PREREQUISITE } from "../../src/features/eye-makeup";

export const presetReachesPlate = (value: Pick<recipe.Recipe, "layers">, footprint: Parameters<typeof reach.presetReachesPlate>[1]) =>
  reach.presetReachesPlate(value, footprint, EYE_MIRROR);
export const preparePackageCollection = (value: unknown, plate?: Parameters<typeof filter.preparePackageCollection>[2]) =>
  filter.preparePackageCollection(value, EYE_REGION, plate);
export const compileGlitterPreset = (value: unknown, knob: Parameters<typeof glitter.compileGlitterPreset>[1],
  window: Parameters<typeof glitter.compileGlitterPreset>[2], dims?: { width: number; height: number }) =>
  glitter.compileGlitterPreset(inMemory(value), knob, window, EYE_REGION, dims);
export const mirrorCatalogue = (c: glitter.Catalogue, window: Parameters<typeof glitter.mirrorCatalogue>[1]) =>
  glitter.mirrorCatalogue(c, window, EYE_MIRROR);
export const bakeCollection = (value: unknown, outDir: string, beforePreset?: (index: number) => void | Promise<void>,
  options: Omit<bake.BakeOptions, "region"> = {}) => bake.bakeCollection(value, outDir, { ...options, region: EYE_REGION }, beforePreset);
export const PACKAGE_MAP_SIZE = bake.packageMapSize(EYE_REGION);
export const buildEyeMakeupResources = (options: Omit<resources.ResourceBuildOptions, "region">) =>
  resources.buildEyeMakeupResources({ ...options, region: EYE_REGION });
/**
 * Eye makeup's Check of a collection file on its own, as the exporter plans and preflights it (diagnostic knobs
 * honoured, as a developer's CLI would): its feature report with its details (`plateLiftsMm`, `plateUv`) spread in,
 * `modName` for its brand and the package-only snapshot's JSON.
 */
export function preflightPackageCollection(value: unknown, plate?: Parameters<typeof filter.preparePackageCollection>[2]) {
  const outcome = EYE_MAKEUP_EXPORTER.plan({ collection: value, prerequisites: plate ? { [EYE_PLATE_PREREQUISITE]: plate } : {}, diagnostics: true });
  EYE_MAKEUP_EXPORTER.preflight!(outcome);
  const details = outcome.check.details as { plateLiftsMm: number[]; plateUv: ReturnType<typeof filter.preparePackageCollection>["plateUv"] };
  return { ...outcome.check, ...details, modName: outcome.check.brand, packagedCollectionJson: outcome.packaged, plan: outcome.plan };
}
