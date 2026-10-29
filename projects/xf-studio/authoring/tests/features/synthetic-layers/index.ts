/** Test-only feature: its own data, editor and action; no makeup compatibility projection. */
import { featureId, type FeatureModule, type PartCodec, type FeatureEditorHost } from "../../../src/platform/api";
import type { FeatureFiles } from "../../../src/app/feature-files";

export const ID = featureId("closure-layers");
export type Layers = { layers: { id: string; value: number }[] };
const schema = "test/closure-layers-1";
export const codec: PartCodec<Layers> = {
  current: schema, accepts: [schema], maxBytes: 4096,
  parse(envelope) {
    const value = envelope.body as Layers;
    if (envelope.schema !== schema || !value || !Array.isArray(value.layers) || value.layers.length > 8 ||
      value.layers.some(layer => !layer || typeof layer.id !== "string" || !layer.id || !Number.isFinite(layer.value)) ||
      new Set(value.layers.map(layer => layer.id)).size !== value.layers.length) throw Error("Invalid closure layers.");
    return structuredClone(value);
  },
  serialize: value => ({ schema, body: structuredClone(value) }),
  empty: () => ({ layers: [{ id: "first", value: 1 }, { id: "second", value: 2 }] }),
  starter: () => codec.empty(), summary: value => ({ layers: value.layers.length }),
};
function createEditor(host: FeatureEditorHost) {
  let value: unknown;
  const refresh = () => { host.signal.throwIfAborted(); value = host.snapshot(); };
  refresh(); host.subscribe(refresh);
  host.signal.addEventListener("abort", () => { value = undefined; }, { once: true });
  return { snapshot() { host.signal.throwIfAborted(); return structuredClone(value); } };
}
type Edit = { kind: "closure.setValue"; id: string; value: number };
const feature: FeatureModule<Edit, "look", typeof ID, Layers, Record<string, never>> = {
  owner: "feature", id: ID, api: 1, label: "Closure layers", stage: "dev", part: codec,
  editor: { empty: () => ({}), parse: () => ({}), serialize: () => ({}) }, createEditor,
  actions: { "closure.setValue": {
    descriptor: { scope: ["look"], undo: "part", effect: "content", payload: {
      id: { type: "string", required: true, from: "input" }, value: { type: "number", required: true, from: "input" } } },
    label: () => ({ label: "Closure value", actionKind: "closure.setValue" }),
    capability: (state, edit) => ({ available: Number.isFinite(edit.value) && state.part.layers.some(layer => layer.id === edit.id) }),
    apply: (state, edit) => ({ part: { layers: state.part.layers.map(layer => layer.id === edit.id ? { ...layer, value: edit.value } : { ...layer }) },
      editor: state.editor, changed: state.part.layers.some(layer => layer.id === edit.id && layer.value !== edit.value), effect: undefined }),
  } },
};
const files: FeatureFiles = { create(host) { return { portable: {
  name: "closure.layers.json", message: "Closure layers exported.", invalidMessage: "Expected closure layers.",
  parse(value) { try { return codec.parse(value as Parameters<typeof codec.parse>[0]); } catch { return undefined; } },
  serialize() { host.signal.throwIfAborted(); return codec.serialize(host.document.features.read(ID) as Layers); },
  // This deliberately bounded fixture proves the offered export; it makes no import/migration claim.
  load() { host.signal.throwIfAborted(); throw Error("This test composition exercises export only."); },
} }; } };
export const SYNTHETIC = { ...feature, files };
