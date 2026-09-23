import type { Layer, Recipe } from "./recipe";

/** Editor-only selections keyed by stable layer/field identities. */
export type FieldSelection = Record<string, string>;
export function parseFieldSelection(value: unknown, recipe: Recipe): FieldSelection {
  const input = value && typeof value === "object" ? value as FieldSelection : {};
  return Object.fromEntries(recipe.layers.flatMap(l =>
    Object.hasOwn(input, l.id) && l.fields.some(f => f.id === input[l.id]) ? [[l.id, input[l.id]]] : []));
}
export function selectedWarp(layer: Layer | undefined, selection: FieldSelection) {
  return layer?.fields.find(f => Object.hasOwn(selection, layer.id) && f.id === selection[layer.id]) ?? layer?.fields[0];
}
