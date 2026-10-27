/** Asset-free CORE-03 compositions. No eye-makeup, engine, renderer, browser or host imports. */
import { COLLECTION_2, featureId, type EditorCodec, type FeatureEditor, type FeatureEditorHost,
  type FeatureModule, type LookCollection, type PartCodec } from "../../src/platform/api";
import { PartRegistry } from "../../src/platform/core/document";
import { LiveFeatures } from "../../src/platform/core/live-features";
import { Registry, type AnyOwner } from "../../src/platform/core/registry";

export const FIXTURE_LOOK = Object.freeze({ collection: "00000000-0000-4000-8000-000000000001", look: "00000000-0000-4000-8000-000000000002" });
export const SYNTHETIC_ID = featureId("synthetic-layers");
export const SYNTHETIC_SCHEMA = "test/synthetic-layers-1";
export type SyntheticPart = { layers: { id: string; value: number }[] };
export type SyntheticMemory = { selected: string | null };
type SyntheticAction = { kind: "synthetic.setValue"; id: string; value: number };
export type SyntheticSnapshot = { look: FeatureEditorHost["look"]; scope: string; present: boolean;
  layers: SyntheticPart["layers"]; selected: string | null };

const part: PartCodec<SyntheticPart> = {
  current: SYNTHETIC_SCHEMA, accepts: [SYNTHETIC_SCHEMA], maxBytes: 4096,
  parse(envelope) {
    const body = envelope.body as SyntheticPart | undefined;
    if (envelope.schema !== SYNTHETIC_SCHEMA || !body || !Array.isArray(body.layers) || body.layers.length > 8 ||
      body.layers.some(layer => !layer || typeof layer.id !== "string" || !layer.id || !Number.isFinite(layer.value)) ||
      new Set(body.layers.map(layer => layer.id)).size !== body.layers.length) throw Error("Invalid synthetic layers.");
    return { layers: body.layers.map(({ id, value }) => ({ id, value })) };
  },
  serialize: value => ({ schema: SYNTHETIC_SCHEMA, body: structuredClone(value) }),
  empty: () => ({ layers: [] }), starter: () => ({ layers: [{ id: "first", value: 1 }, { id: "second", value: 2 }] }),
  summary: value => ({ layers: value.layers.length }),
  chunks: value => value.layers,
  join: chunks => ({ layers: structuredClone(chunks) as SyntheticPart["layers"] }),
};
const editor: EditorCodec<SyntheticMemory, SyntheticPart> = {
  empty: () => ({ selected: null }),
  parse(value, part) {
    const selected = (value as Partial<SyntheticMemory> | undefined)?.selected;
    return { selected: typeof selected === "string" && part.layers.some(layer => layer.id === selected) ? selected : null };
  },
  serialize: value => ({ selected: value.selected }),
};

/** A small cached projection, deliberately different from makeup's document and facade. */
export function createSyntheticEditor(host: FeatureEditorHost): FeatureEditor<SyntheticSnapshot> {
  let cached: SyntheticSnapshot | undefined;
  const check = () => { if (host.signal.aborted) throw Error("Synthetic editor released."); };
  const refresh = () => {
    const state = host.snapshot(), parsed = state.part === undefined ? part.empty() : part.parse({ schema: SYNTHETIC_SCHEMA, body: state.part });
    cached = { look: { ...host.look }, scope: host.scope, present: state.part !== undefined,
      layers: parsed.layers, selected: editor.parse(state.editor, parsed).selected };
  };
  check(); refresh();
  host.subscribe(refresh);
  host.signal.addEventListener("abort", () => { cached = undefined; }, { once: true });
  return { snapshot() { check(); return structuredClone(cached!); } };
}

export const SYNTHETIC_LAYERED: FeatureModule<SyntheticAction, "look", typeof SYNTHETIC_ID, SyntheticPart, SyntheticMemory> = {
  owner: "feature", id: SYNTHETIC_ID, api: 1, label: "Synthetic layers", stage: "dev", part, editor,
  createEditor: createSyntheticEditor,
  actions: {
    "synthetic.setValue": {
      descriptor: { scope: ["look"], undo: "part", effect: "content", payload: {
        id: { type: "string", required: true, from: "input" }, value: { type: "number", required: true, from: "input" } } },
      label: () => ({ label: "Synthetic value", actionKind: "synthetic.setValue" }),
      capability: (state, action) => ({ available: Number.isFinite(action.value) && state.part.layers.some(layer => layer.id === action.id) }),
      apply: (state, action) => ({ part: { layers: state.part.layers.map(layer => layer.id === action.id ? { ...layer, value: action.value } : { ...layer }) },
        editor: { ...state.editor }, effect: undefined,
        changed: state.part.layers.some(layer => layer.id === action.id && layer.value !== action.value) }),
    },
  },
};

/** The existing registries hold the same module objects; no separate editor catalogue. */
export function editorComposition(features: readonly FeatureModule[] = []) {
  return { registry: new Registry<AnyOwner>(features), parts: new PartRegistry(features), live: new LiveFeatures(features) };
}
export const zeroFeatureComposition = () => editorComposition();
export const syntheticEditorComposition = () => editorComposition([SYNTHETIC_LAYERED as FeatureModule]);

/** A real sparse collection for later workspace/core gates; no recipe field or pretend makeup facade. */
export function editorCollection(synthetic = false): LookCollection {
  return { schema: COLLECTION_2, id: FIXTURE_LOOK.collection, name: "Editor boundary", presets: [
    { id: FIXTURE_LOOK.look, name: "Look", revision: 1, parts: synthetic ? { [SYNTHETIC_ID]: part.serialize(part.starter()) } : {} },
  ] };
}
