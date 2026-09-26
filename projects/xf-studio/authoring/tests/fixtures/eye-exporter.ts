/**
 * Eye makeup's exporter and host-side devices bound to eye makeup's region, for tests (node only: this imports
 * the package pipeline). Browser-safe engine bindings are in `eye-region.ts`.
 */
import { EYE_MIRROR, EYE_REGION, inMemory } from "./eye-region";
import type * as recipe from "../../src/engines/layered-makeup/recipe";
import * as reach from "../../src/plate-reach";
import * as filter from "../../src/package-filter";
import * as preflight from "../../src/package-preflight";
import * as glitter from "../../src/glitter-route";
import * as bake from "../../src/package-bake";
import * as server from "../../src/package-server";
import * as build from "../../src/package-build-service";
import * as resources from "../../src/package-resource-builder";

export const presetReachesPlate = (value: Pick<recipe.Recipe, "layers">, footprint: Parameters<typeof reach.presetReachesPlate>[1]) =>
  reach.presetReachesPlate(value, footprint, EYE_MIRROR);
export const preparePackageCollection = (value: unknown, plate?: Parameters<typeof filter.preparePackageCollection>[2]) =>
  filter.preparePackageCollection(value, EYE_REGION, plate);
export const preflightPackageCollection = (value: unknown, plate?: Parameters<typeof preflight.preflightPackageCollection>[2]) =>
  preflight.preflightPackageCollection(value, EYE_REGION, plate);
export const compileGlitterPreset = (value: unknown, knob: Parameters<typeof glitter.compileGlitterPreset>[1],
  window: Parameters<typeof glitter.compileGlitterPreset>[2], dims?: { width: number; height: number }) =>
  glitter.compileGlitterPreset(inMemory(value), knob, window, EYE_REGION, dims);
export const mirrorCatalogue = (c: glitter.Catalogue, window: Parameters<typeof glitter.mirrorCatalogue>[1]) =>
  glitter.mirrorCatalogue(c, window, EYE_MIRROR);
export const bakeCollection = (value: unknown, outDir: string, beforePreset?: (index: number) => void | Promise<void>,
  options: Omit<bake.BakeOptions, "region"> = {}) => bake.bakeCollection(value, outDir, { ...options, region: EYE_REGION }, beforePreset);
export const PACKAGE_MAP_SIZE = bake.packageMapSize(EYE_REGION);
export const createPackageHandler = (tools?: Parameters<typeof server.createPackageHandler>[1], runner?: Parameters<typeof server.createPackageHandler>[2]) =>
  server.createPackageHandler(EYE_REGION, tools, runner);
export const runPackageCommand = (options: Omit<build.PackageCommandOptions, "region">) => build.runPackageCommand({ ...options, region: EYE_REGION });
export const buildPackageResources = (options: Omit<resources.ResourceBuildOptions, "region">) =>
  resources.buildPackageResources({ ...options, region: EYE_REGION });
