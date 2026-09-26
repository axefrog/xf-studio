/**
 * The layered-makeup engine's per-layer optical models (feature-module platform §2, CORE-09). A layer's optical
 * blocks name their own model: `flakes.model` (a Glitter model; classic flakes store none) and `optics.model`
 * (the game-matched finish model, with its Colour-shift settings). Each model is registered once, with its
 * validator; a feature registers the models its layers may hold (its region's `models`) and passes that registry
 * to every read and edit.
 *
 * - The in-memory recipe has no recipe-level model gate: every registered model is valid on any layer whose
 *   finish it suits, and a model ID the registry does not know is a newer build's.
 * - A feature's older portable forms may gate models per form (`check`'s `holds`); eye makeup's recipe files do
 *   (`recipe-schema.ts`).
 *
 * "Version the model whenever appearance changes" applies per layer model: a changed look gets a new model ID
 * here, never a whole-recipe schema bump.
 */
import { isDirectGlint } from "./direct-glint-settings";
import type { Finish } from "./finish";
import { hasGameOptics } from "./finish-export";
import { NewerDataError } from "../../platform/api";
import { validStudioIrregularSettings } from "./flake-field";

/** Which optical block of a layer a model describes. */
export type ModelSlot = "flakes" | "optics";
export interface LayerModel {
  readonly slot: ModelSlot;
  /** The stored model ID. Absent for classic flakes, the one model stored without a `model` field. */
  readonly id?: string;
  /** Whether `value` is a valid block of this model on a layer with this finish. */
  valid(value: unknown, finish: Finish): boolean;
}
type OpticalLayer = { finish: Finish; flakes?: unknown; optics?: unknown };

const num = (x: unknown, a: number, b: number) => typeof x === "number" && Number.isFinite(x) && x >= a && x <= b;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const glitter = (id: string, valid: (value: unknown) => boolean): LayerModel =>
  ({ slot: "flakes", id, valid: (value, finish) => finish === "glitter" && valid(value) });
const direct = (id: string) => glitter(id, value => isDirectGlint(value) && value.model === id);

/** Classic flakes: any finish; stored without a model ID. */
export const CLASSIC_FLAKES: LayerModel = Object.freeze({ slot: "flakes", valid: (value: unknown) => record(value) &&
  Number.isInteger(value.cells) && num(value.cells, 32, 256) && num(value.density, 0, 1) && num(value.tilt, 0, 1) &&
  Number.isInteger(value.seed) && num(value.seed, 0, 2147483647) });
export const IRREGULAR_GLITTER: LayerModel = Object.freeze(glitter("irregular-planar-1", validStudioIrregularSettings));
export const DIRECT_GLINT_1: LayerModel = Object.freeze(direct("uv-cell-direct-1"));
export const DIRECT_GLINT_2: LayerModel = Object.freeze(direct("uv-cell-direct-2"));
export const DIRECT_GLINT_3: LayerModel = Object.freeze(direct("uv-cell-direct-3"));
/** The game-matched finish model: Glossy, Shimmer and Colour-shifting (with its shift colour and strength). */
export const GAME_MATCHED_OPTICS: LayerModel = Object.freeze({ slot: "optics", id: "game-matched-1", valid: (value: unknown, finish: Finish) => {
  if (!record(value) || value.model !== "game-matched-1" || !hasGameOptics(finish)) return false;
  const keys = Object.keys(value).sort().join();
  if (finish !== "iridescent") return keys === "model";
  const s = value.shift;
  return keys === "model,shift" && record(s) && Object.keys(s).sort().join() === "color,strength" &&
    typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color) && num(s.strength, 0, 1);
} });

export class LayerModelRegistry {
  private readonly models = new Map<string, LayerModel>();
  constructor(models: readonly LayerModel[]) {
    for (const model of models) {
      const key = LayerModelRegistry.key(model.slot, model.id);
      if (model.id === "" || this.models.has(key)) throw Error(`Layer model ${key} is registered twice or has an empty ID.`);
      if (model.id === undefined && model.slot !== "flakes") throw Error("Only classic flakes are stored without a model ID.");
      this.models.set(key, model);
    }
  }
  private static key(slot: ModelSlot, id: string | undefined) { return `${slot}:${id ?? ""}`; }
  /** The registered model a stored block names (flakes without a `model` field are classic), or undefined. */
  of(slot: ModelSlot, value: unknown): LayerModel | undefined {
    if (!record(value)) return undefined;
    if (!("model" in value)) return slot === "flakes" ? this.models.get(LayerModelRegistry.key(slot, undefined)) : undefined;
    return typeof value.model === "string" && value.model ? this.models.get(LayerModelRegistry.key(slot, value.model)) : undefined;
  }
  /**
   * Validate a layer's optical blocks, throwing the messages recipe reads have always produced. With `holds`
   * (an older form's gate), only models it holds are valid. Without it (the in-memory recipe), a model ID this
   * registry does not know is named as coming from a newer build.
   */
  check(layer: OpticalLayer, holds?: (model: LayerModel) => boolean) {
    if (!holds) for (const slot of ["flakes", "optics"] as const) {
      const value = layer[slot];
      if (record(value) && typeof value.model === "string" && value.model && !this.of(slot, value))
        throw new NewerDataError(`This look uses a finish model from a newer version of XF Studio (${value.model}).`);
    }
    if (layer.flakes !== undefined) {
      const f = layer.flakes;
      if (!record(f)) throw Error("Invalid flake settings.");
      const model = this.of("flakes", f);
      if (!model || !model.valid(f, layer.finish) || (holds && !holds(model)))
        throw Error("model" in f ? "Invalid experimental Glitter settings." : "Invalid flake settings.");
    }
    if (layer.optics !== undefined) {
      const model = this.of("optics", layer.optics);
      if (!model || !model.valid(layer.optics, layer.finish) || (holds && !holds(model)))
        throw Error("Invalid game-matched finish settings.");
    }
  }
}
