/**
 * Starter shapes (profiles design §6, contributed defaults): the contour a new layer starts from, as plain data. A feature's
 * region contributes several (`region.ts`); the person can save any layer's shape as their own (`app/starters`). A shape holds
 * what makes a layer's outline and how it feathers (points, path mode, feather, softness, strength, mirroring) and, where it
 * names them, its opacity and a plain finish. It never holds a colour, a name, an ID or any optical block: those stay the new
 * layer's own, so applying a shape cannot change what a finish means.
 *
 * Pure: no ID source, clock or randomness. A new layer takes its shape at creation only; nothing here touches an existing layer.
 */
import { readLayers, MAX_FEATHER, MIN_FEATHER, type Layer, type Point, type Softness, type Strength } from "./recipe";
import type { Finish } from "./finish";
import type { LayerModelRegistry } from "./layer-models";

/** The finishes a shape may name: plain ones, which need no optical block. Others are left to the layer. */
export const STARTER_FINISHES: readonly Finish[] = Object.freeze(["matte", "regular"]);
export type StarterShape = Readonly<{
  points: readonly Point[];
  pathMode: Layer["pathMode"];
  feather: number;
  softness: Softness;
  strength: Strength;
  symmetry: boolean;
  /** Absent: the new layer keeps its own opacity. */
  opacity?: number;
  /** Absent: the new layer keeps its own finish. */
  finish?: Finish;
}>;

/** A starter a feature contributes: read-only, in menu order. `id` is stable and never reused. */
export type ContributedStarter = Readonly<{ id: string; name: string; description: string; shape: StarterShape }>;

/** A layer with `shape` applied: its ID, name, colour, enabled state, optical blocks and warp fields stay `base`'s. */
export function layerWithShape(base: Layer, shape: StarterShape): Layer {
  const layer = structuredClone(base) as Layer;
  const own = structuredClone(shape) as { -readonly [K in keyof StarterShape]: StarterShape[K] };
  layer.points = own.points as Point[];
  layer.pathMode = own.pathMode; layer.feather = own.feather; layer.softness = own.softness; layer.strength = own.strength;
  layer.symmetry = own.symmetry;
  if (own.opacity !== undefined) layer.opacity = own.opacity;
  if (own.finish !== undefined) {
    layer.finish = own.finish;
    delete layer.flakes; delete layer.optics;
  }
  layer.fields = [];
  return layer;
}

/** The shape of a layer, as "Save shape as starter" keeps it (a finish only where it is a plain one). */
export function shapeOfLayer(layer: Layer): StarterShape {
  const finish = STARTER_FINISHES.includes(layer.finish) ? layer.finish : undefined;
  return structuredClone({ points: layer.points, pathMode: layer.pathMode, feather: layer.feather, softness: layer.softness, strength: layer.strength,
    symmetry: layer.symmetry, opacity: layer.opacity, ...(finish ? { finish } : {}) }) as StarterShape;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const SHAPE_KEYS: ReadonlySet<string> = new Set(["points", "pathMode", "feather", "softness", "strength", "symmetry", "opacity", "finish"]);
/**
 * A stored or supplied shape, validated by the layer rules (point count and range, handles, feather, softness, strength) against
 * `base` (the layer it would be applied to) and the feature's models; unknown fields are refused, never dropped. Undefined: it isn't one.
 */
export function readStarterShape(value: unknown, base: Layer, models: LayerModelRegistry): StarterShape | undefined {
  if (!object(value) || Object.keys(value).some(key => !SHAPE_KEYS.has(key))) return undefined;
  if (value.finish !== undefined && !STARTER_FINISHES.includes(value.finish as Finish)) return undefined;
  if (typeof value.feather !== "number" || value.feather < MIN_FEATHER || value.feather > MAX_FEATHER) return undefined;
  try {
    const layer = layerWithShape(base, value as unknown as StarterShape);
    readLayers([layer], models);
    return structuredClone(shapeFields(layer, value as unknown as StarterShape));
  } catch { return undefined; }
}
/** The shape's own fields of `layer`, naming opacity and finish only where `shape` did. */
function shapeFields(layer: Layer, shape: StarterShape): StarterShape {
  return { points: layer.points, pathMode: layer.pathMode, feather: layer.feather, softness: layer.softness, strength: layer.strength,
    symmetry: layer.symmetry, ...(shape.opacity === undefined ? {} : { opacity: layer.opacity }), ...(shape.finish === undefined ? {} : { finish: layer.finish }) };
}
