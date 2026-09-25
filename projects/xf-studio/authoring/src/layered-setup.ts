/**
 * Readers for a layered material's resources as WolvenKit serializes them: the `.mlsetup` (`Multilayer_Setup`: an ordered list of
 * `Multilayer_Layer`, plus `ratio` and `useNormal`) and each layer's `.mltemplate` (`Multilayer_LayerTemplate`: four surface maps,
 * `tilingMultiplier`, colour-mask levels and named override tables). Pure: callers pass parsed JSON; the host loads the resources
 * through the resolver (so a mod's copy of a setup or template at the vanilla path wins, as in game) and the renderer's layered
 * adapter interprets the values (layered-material.ts).
 *
 * A layer names its colour, normal strength and roughness/metalness levels by CName; the values live in its template's override tables
 * (knowledge/materials-and-shaders.md §4.6). Field order and types: RED4ext SDK `Multilayer_Layer.hpp`, `Multilayer_LayerTemplate.hpp`
 * [source]; value shapes: WolvenKit CLI 9.0.1 output for the game 2.31 earring setups and their templates [resource].
 */
import type { DepotRef } from "./depot-path";
import { asArray, cname, depotRef, isObject, type JsonObject } from "./red-json";

/** The CName-selected values of a layer. */
export const LAYER_OVERRIDES = ["colorScale", "normalStrength", "roughLevelsIn", "roughLevelsOut", "metalLevelsIn", "metalLevelsOut"] as const;
export type LayerOverride = typeof LAYER_OVERRIDES[number];

/** One `Multilayer_Layer` as stored: numbers, the template and microblend references, and the CNames of its overrides. */
export type SetupLayer = {
  template: DepotRef | null; microblend: DepotRef | null;
  opacity: number; matTile: number; mbTile: number; offsetU: number; offsetV: number;
  microblendContrast: number; microblendNormalStrength: number; microblendOffsetU: number; microblendOffsetV: number;
  names: Record<LayerOverride, string>;
};
export type SetupValues = { ratio: number; useNormal: boolean; layers: SetupLayer[] };
/** A layer template's maps and tables. */
export type TemplateValues = {
  textures: { color: DepotRef | null; normal: DepotRef | null; roughness: DepotRef | null; metalness: DepotRef | null };
  tilingMultiplier: number;
  colorMaskLevelsIn: [number, number]; colorMaskLevelsOut: [number, number];
  colorScale: Map<string, [number, number, number]>;
  normalStrength: Map<string, number>;
  levels: Record<"roughLevelsIn" | "roughLevelsOut" | "metalLevelsIn" | "metalLevelsOut", Map<string, [number, number]>>;
  /** The template's own `defaultOverrides` selection. */
  defaults: Record<LayerOverride, string>;
};

/** The engine's layer limit [wiki: `multilayered/README.md`]; a longer stack is cut. */
export const MAX_SETUP_LAYERS = 20;

const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const elements = (value: unknown): number[] => isObject(value) ? asArray(value.Elements).map(item => Number(item)) : asArray(value).map(item => Number(item));
const pairOf = (value: unknown, fallback: [number, number]): [number, number] => {
  const items = elements(value);
  return items.length === 2 && items.every(Number.isFinite) ? [items[0]!, items[1]!] : fallback;
};
/** A CName as stored, keeping `None` (a layer that selects nothing) distinct from an absent field. */
const nameOf = (value: unknown) => typeof value === "string" ? value : isObject(value) && typeof value.$value === "string" ? value.$value : "";

/**
 * A serialized `Multilayer_Setup`, or null when it is not one. Serializers omit a field at its type default, so an absent number reads
 * as the class default the game's setups imply: opacity, tiles and contrast 1, offsets and microblend normal strength 0 [hypothesis
 * for the absent-field defaults; every inspected setup writes all fields].
 */
export function readSetup(root: JsonObject | null | undefined): SetupValues | null {
  if (!root || root.$type !== "Multilayer_Setup") return null;
  const layers = asArray(root.layers).filter(isObject).slice(0, MAX_SETUP_LAYERS).map((layer): SetupLayer => ({
    template: depotRef(layer.material), microblend: depotRef(layer.microblend),
    opacity: number(layer.opacity, 1), matTile: number(layer.matTile, 1), mbTile: number(layer.mbTile, 1),
    offsetU: number(layer.offsetU, 0), offsetV: number(layer.offsetV, 0),
    microblendContrast: number(layer.microblendContrast, 1), microblendNormalStrength: number(layer.microblendNormalStrength, 0),
    microblendOffsetU: number(layer.microblendOffsetU, 0), microblendOffsetV: number(layer.microblendOffsetV, 0),
    names: Object.fromEntries(LAYER_OVERRIDES.map(key => [key, nameOf(layer[key])])) as Record<LayerOverride, string>,
  }));
  return { ratio: number(root.ratio, 1), useNormal: root.useNormal === undefined ? true : root.useNormal === 1 || root.useNormal === true, layers };
}

/** A serialized `Multilayer_LayerTemplate`, or null when it is not one. */
export function readTemplate(root: JsonObject | null | undefined): TemplateValues | null {
  if (!root || root.$type !== "Multilayer_LayerTemplate") return null;
  const overrides = isObject(root.overrides) ? root.overrides : {};
  const table = <T>(key: string, value: (entry: JsonObject) => T | null) => {
    const out = new Map<string, T>();
    for (const entry of asArray(overrides[key]).filter(isObject)) {
      const name = nameOf(entry.n), read = value(entry);
      if (name && read !== null && !out.has(name)) out.set(name, read);
    }
    return out;
  };
  const rgb = (entry: JsonObject): [number, number, number] | null => {
    const items = elements(entry.v);
    return items.length >= 3 && items.slice(0, 3).every(Number.isFinite) ? [items[0]!, items[1]!, items[2]!] : null;
  };
  const levels = (key: string) => table(key, entry => { const items = elements(entry.v); return items.length === 2 && items.every(Number.isFinite) ? [items[0]!, items[1]!] as [number, number] : null; });
  const selection = isObject(root.defaultOverrides) ? root.defaultOverrides : {};
  return {
    textures: { color: depotRef(root.colorTexture), normal: depotRef(root.normalTexture), roughness: depotRef(root.roughnessTexture), metalness: depotRef(root.metalnessTexture) },
    tilingMultiplier: number(root.tilingMultiplier, 1),
    colorMaskLevelsIn: pairOf(root.colorMaskLevelsIn, [0, 1]), colorMaskLevelsOut: pairOf(root.colorMaskLevelsOut, [0, 1]),
    colorScale: table("colorScale", rgb), normalStrength: table("normalStrength", entry => typeof entry.v === "number" && Number.isFinite(entry.v) ? entry.v : null),
    levels: { roughLevelsIn: levels("roughLevelsIn"), roughLevelsOut: levels("roughLevelsOut"), metalLevelsIn: levels("metalLevelsIn"), metalLevelsOut: levels("metalLevelsOut") },
    defaults: Object.fromEntries(LAYER_OVERRIDES.map(key => [key, cname(selection[key])])) as Record<LayerOverride, string>,
  };
}

/** Neutral values for a layer whose template is missing or lacks a name: white colour, no normal, identity levels. */
export const NEUTRAL_OVERRIDES = { colorScale: [1, 1, 1] as [number, number, number], normalStrength: 0, levels: [1, 0] as [number, number] };

/**
 * The values a layer's CNames select from its template's tables. A name the table lacks falls back to the template's own
 * `defaultOverrides` selection, then to the table's `null` entry, then to a neutral value [hypothesis: the engine's lookup miss is not
 * read; the game's setups name entries their templates have]. Returns the values and the names they came from (`?` marks a neutral value).
 */
export function layerOverrides(layer: SetupLayer, template: TemplateValues | null) {
  const pick = <T>(key: LayerOverride, table: Map<string, T> | undefined, neutral: T): [T, string] => {
    for (const name of [layer.names[key], template?.defaults[key], "null"]) if (name && table?.has(name)) return [table.get(name)!, name];
    return [neutral, `${layer.names[key] || "None"}?`];
  };
  const [colorScale, colorName] = pick("colorScale", template?.colorScale, NEUTRAL_OVERRIDES.colorScale);
  const [normalStrength, normalName] = pick("normalStrength", template?.normalStrength, NEUTRAL_OVERRIDES.normalStrength);
  const levels = (key: "roughLevelsIn" | "roughLevelsOut" | "metalLevelsIn" | "metalLevelsOut") => pick(key, template?.levels[key], NEUTRAL_OVERRIDES.levels);
  const [roughLevelsIn, roughInName] = levels("roughLevelsIn"), [roughLevelsOut, roughOutName] = levels("roughLevelsOut");
  const [metalLevelsIn, metalInName] = levels("metalLevelsIn"), [metalLevelsOut, metalOutName] = levels("metalLevelsOut");
  return { colorScale, normalStrength, roughLevelsIn, roughLevelsOut, metalLevelsIn, metalLevelsOut,
    names: { colorScale: colorName, normalStrength: normalName, roughLevelsIn: roughInName, roughLevelsOut: roughOutName, metalLevelsIn: metalInName, metalLevelsOut: metalOutName } };
}
