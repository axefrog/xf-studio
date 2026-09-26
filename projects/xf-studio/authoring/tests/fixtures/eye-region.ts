/**
 * The layered-makeup engine bound to eye makeup's region, for tests: the engine takes the region explicitly
 * (`engines/layered-makeup/region.ts`), and these helpers pass eye makeup's (`features/eye-makeup/region.ts`)
 * exactly as the feature, the preview and the exporter do. Tests of other regions call the engine directly.
 */
import { EYE_MAKEUP_REGION, initialRecipe, newLayerTemplate, starterRecipe } from "../../src/features/eye-makeup/region";
import * as recipe from "../../src/engines/layered-makeup/recipe";
import * as stack from "../../src/engines/layered-makeup/layer-stack";
import * as actions from "../../src/engines/layered-makeup/recipe-actions";
import * as shapes from "../../src/engines/layered-makeup/shape-transform";
import * as compiler from "../../src/engines/layered-makeup/preset-compiler";
import * as keys from "../../src/engines/layered-makeup/makeup-dependencies";
import * as catalogue from "../../src/engines/layered-makeup/finish-catalogue";
import { finishDescription as describeFinish, type Finish } from "../../src/engines/layered-makeup/finish";
import { rasterRegion } from "../../src/engines/layered-makeup/region";
import { readRecipe } from "../../src/recipe-schema";
import { freshWorkspace as fresh } from "../../src/workspace-state";
import type { IrregularFlakes } from "../../src/engines/layered-makeup/flake-field";
import type { ReadonlyDeep } from "../../src/read-only";
import type { GlitterChoices } from "../../src/engines/layered-makeup/glitter-model";
import * as client from "../../src/raster-client";
import * as stackRender from "../../src/engines/layered-makeup/render/makeup-stack";
import * as port from "../../src/authoring-eye-makeup";

export { EYE_MAKEUP_REGION, initialRecipe, newLayerTemplate, starterRecipe };
export const EYE_REGION = EYE_MAKEUP_REGION;
export const EYE_MIRROR = EYE_MAKEUP_REGION.mirror;
export const EYE_MODELS = EYE_MAKEUP_REGION.models;
export const EYE_FINE_GLITTER = EYE_MAKEUP_REGION.fineGlitter;
/** Eye makeup's region as the raster worker receives it. */
export const EYE_RASTER_REGION = rasterRegion(EYE_MAKEUP_REGION);
/** The fine-Glitter regions (they were `STUDIO_FINE_REGIONS` in the engine). */
export const STUDIO_FINE_REGIONS = EYE_MAKEUP_REGION.fineGlitter.regions;
/** Eye makeup's texture grids (they were constants in `finish-export.ts`). */
export const WINDOW_TEXTURE = EYE_MAKEUP_REGION.textures.window;
export const GLITTER_WINDOW_TEXTURE = EYE_MAKEUP_REGION.textures.glitterWindow;
export const ACCENT_TEXTURE_SIZE = EYE_MAKEUP_REGION.textures.accent;
export const HEAD_TEXTURE_SIZE = EYE_MAKEUP_REGION.textures.head;

type Layer = recipe.Layer;
export const coverage = (u: number, v: number, l: Layer, polygon?: recipe.Point[]) =>
  polygon ? recipe.coverage(u, v, l, EYE_MIRROR, polygon) : recipe.coverage(u, v, l, EYE_MIRROR);
export const raster = (l: Layer, size: number) => recipe.raster(l, size, EYE_MIRROR);
export const createRasterJob = (l: Layer, size: number) => recipe.createRasterJob(l, size, EYE_MIRROR);
export const rasterWindow = (l: Layer, width: number, height: number, area: { u0: number; u1: number; v0: number; v1: number }) =>
  recipe.rasterWindow(l, width, height, area, EYE_MIRROR);
export const layerCoverageSampler = (l: Layer) => recipe.layerCoverageSampler(l, EYE_MIRROR);

export const editLayers = (value: recipe.Recipe, activeId: string | undefined, command: stack.LayerCommand) =>
  stack.editLayers(value, activeId, command, EYE_REGION);
export const applyLayerAction = (value: recipe.Recipe, activeId: string | undefined, action: stack.LayerAction) =>
  stack.applyLayerAction(value, activeId, action, EYE_REGION);
export const applyRecipeAction = (state: actions.RecipeActionState, action: actions.RecipeAction, choices?: GlitterChoices, presetId?: string) =>
  actions.applyRecipeAction(state, action, EYE_MODELS, choices, presetId);
export const applyGestureEdit = (action: actions.GestureEdit) => actions.applyGestureEdit(action, EYE_MODELS);
export const applyRecipeGesture = (value: recipe.Recipe, action: actions.GestureEdit) => actions.applyRecipeGesture(value, action, EYE_MODELS);
export const transformLayer = (layer: Layer, command: shapes.ShapeTransform) => shapes.transformLayer(layer, command, EYE_MODELS);
export const shapeHit = (layer: Layer, uv: { u: number; v: number }) => shapes.shapeHit(layer, uv, EYE_MIRROR);

/** The compiler reads in-memory recipes; eye makeup's recipe files (with a `schema`) are read through its lineage first, as the exporter does. */
export const inMemory = (value: unknown) => value && typeof value === "object" && "schema" in value ? readRecipe(value) : value;
export const compileFlatPreset = (value: unknown, space?: number | compiler.TextureSpace) => compiler.compileFlatPreset(inMemory(value), EYE_REGION, space);
export const compileFacetedPreset = (value: unknown, space?: number | compiler.TextureSpace) =>
  compiler.compileFacetedPreset(inMemory(value), EYE_REGION, space);
export const compileFresnelPreset = (value: unknown, size?: number) => compiler.compileFresnelPreset(inMemory(value), EYE_REGION, size);
export const compilePreset = (value: unknown, space?: number | compiler.TextureSpace, headSize?: number) =>
  compiler.compilePreset(inMemory(value), EYE_REGION, space, headSize);
export const presetCoverage = (value: unknown, crop: Parameters<typeof compiler.presetCoverage>[2]) =>
  compiler.presetCoverage(inMemory(value), EYE_REGION, crop);

export const studioIrregularOpticalKey = (settings: IrregularFlakes, size: number) => keys.studioIrregularOpticalKey(settings, size, EYE_FINE_GLITTER);
export const previewOpticalKey = (layer: ReadonlyDeep<Layer>, size: number) => keys.previewOpticalKey(layer, size, EYE_FINE_GLITTER);
export const finishCatalogue = () => catalogue.finishCatalogue(EYE_REGION.wording);
export const glitterModelCatalogue = () => catalogue.glitterModelCatalogue(EYE_REGION.wording);
export const finishDescription = (finish: Finish) => describeFinish(finish, EYE_REGION.wording.surface);

/** A fresh workspace; by default on the historical four-layer sample recipe, as `freshWorkspace()` always was. */
export const freshWorkspace = (value: recipe.Recipe = initialRecipe()) => fresh(value);

// The live document port, the renderer and the raster client, as the composition root binds them.
export const eyeMakeupPort = (document: Parameters<typeof port.eyeMakeupPort>[0], published: Parameters<typeof port.eyeMakeupPort>[1],
  structureChanged?: Parameters<typeof port.eyeMakeupPort>[3], newId?: Parameters<typeof port.eyeMakeupPort>[4]) =>
  port.eyeMakeupPort(document, published, EYE_REGION, structureChanged, newId);
export const createMakeupStack = (anchor: Parameters<typeof stackRender.createMakeupStack>[0], anisotropy: number) =>
  stackRender.createMakeupStack(anchor, anisotropy, EYE_FINE_GLITTER);
export const createRasterClient = (makeWorker: Parameters<typeof client.createRasterClient>[0], publish: Parameters<typeof client.createRasterClient>[1],
  failed: Parameters<typeof client.createRasterClient>[2], size?: number) => client.createRasterClient(makeWorker, publish, failed, EYE_RASTER_REGION, size);
