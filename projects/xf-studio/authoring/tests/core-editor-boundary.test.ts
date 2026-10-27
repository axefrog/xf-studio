import { describe, expect, test } from "bun:test";
import type { FeatureEditorHost } from "../src/platform/api";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { createSyntheticEditor, editorCollection, FIXTURE_LOOK, SYNTHETIC_ID, SYNTHETIC_LAYERED,
  syntheticEditorComposition, zeroFeatureComposition, type SyntheticPart } from "./fixtures/editor-composition";

test("asset-free compositions use the existing action, part and live-feature registries", () => {
  const zero = zeroFeatureComposition();
  expect(zero.registry.owners()).toEqual([]);
  expect(zero.parts.features()).toEqual([]);
  expect(zero.live.export()).toEqual({});
  expect(zero.parts.readCollection(editorCollection())).toEqual(editorCollection());
  const synthetic = syntheticEditorComposition();
  expect(synthetic.registry.owner(SYNTHETIC_ID)).toBe(SYNTHETIC_LAYERED);
  expect(synthetic.parts.feature(SYNTHETIC_ID)?.createEditor).toBe(createSyntheticEditor);
  expect(synthetic.parts.readCollection(editorCollection(true))).toEqual(editorCollection(true));
  expect(synthetic.parts.join(SYNTHETIC_ID, synthetic.parts.chunks(SYNTHETIC_ID, SYNTHETIC_LAYERED.part.starter())))
    .toEqual(SYNTHETIC_LAYERED.part.starter());
});

test("a registered editor observes its feature, snapshots detached data and releases on the look owner's abort", () => {
  const composition = syntheticEditorComposition(), document = composition.live.document(SYNTHETIC_ID)!;
  const history = createHistoryService(), id = lookScope(FIXTURE_LOOK), life = new AbortController();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const scope = history.open(id, {
    read: feature => composition.live.read(feature),
    apply: values => { composition.live.restore(values); return true; }, settled: changed,
    fingerprint: keys => composition.live.content(keys),
  }, { parts: composition.parts });
  const host: FeatureEditorHost = { look: FIXTURE_LOOK, scope: id, signal: life.signal,
    snapshot: () => { const state = document.export(); return { part: state.part, editor: state.editor }; },
    subscribe: listener => { listeners.add(listener); life.signal.addEventListener("abort", () => listeners.delete(listener), { once: true }); } };
  try {
    // Use the registered factory, exactly as slice 4's core will. Its output is opaque to the host.
    const editor = composition.parts.feature(SYNTHETIC_ID)!.createEditor!(host);
    expect(editor.snapshot()).toEqual({ look: FIXTURE_LOOK, scope: id, present: false, layers: [], selected: null });
    document.set(SYNTHETIC_LAYERED.part.starter(), { selected: "first" }); changed();
    const snapshot = editor.snapshot() as ReturnType<ReturnType<typeof createSyntheticEditor>["snapshot"]>;
    expect(snapshot.layers).toHaveLength(2);
    expect(snapshot.selected).toBe("first");
    // A caller can even mutate a detached result at runtime without changing the document or cached projection.
    Object.assign(snapshot.layers[0], { value: 99 });
    expect((document.part as SyntheticPart).layers[0].value).toBe(1);
    expect(editor.snapshot()).not.toEqual(snapshot);
    const action = { kind: "synthetic.setValue" as const, id: "first", value: 7 }, spec = SYNTHETIC_LAYERED.actions[action.kind];
    const state = { part: document.part as SyntheticPart, editor: { selected: "first" } };
    expect(spec.capability(state, action).available).toBe(true);
    scope.checkpoint([SYNTHETIC_ID], spec.label(action));
    const result = spec.apply(state, action); document.set(result.part, result.editor); changed();
    expect((editor.snapshot() as typeof snapshot).layers[0].value).toBe(7);
    expect(scope.undo()).toBe(true);
    expect((editor.snapshot() as typeof snapshot).layers[0].value).toBe(1);
    expect(scope.redo()).toBe(true);
    expect((editor.snapshot() as typeof snapshot).layers[0].value).toBe(7);
    life.abort();
    expect(listeners.size).toBe(0);
    expect(() => editor.snapshot()).toThrow("Synthetic editor released.");
    expect(() => createSyntheticEditor(host)).toThrow("Synthetic editor released.");
    // Editors do not close the shared scope; only the look owner does that.
    expect(history.scope(id)).toBe(scope);
  } finally { life.abort(); history.close(id); }
});

describe("CORE-03 later-slice construction gates (no shell-mount claim)", () => {
  // Slice 2's three active construction gates now live in look-document.test.ts.
  test.todo("slice 3: an empty registry cold-loads a writable workspace with no mandatory live-recipe projection", () => {});
  test.todo("slice 3: zero-feature and synthetic collections round-trip workspace drafts and SQLite without adding makeup", () => {});
  test.todo("slice 3: released eye-makeup workspace and collection formats retain compatibility", () => {});
  test.todo("slice 4: zero-feature trusted editor construction opens and releases a look scope without constructing makeup", () => {});
  test.todo("slice 4: a synthetic layered editor is constructed through its registered factory with no core feature-ID branch", () => {});
  test.todo("slice 4: two requesters for one look share its editor/history; another look has independent selection and history", () => {});
  test.todo("slice 4: releasing one requester preserves the other; final release aborts editors and closes their scope", () => {});
  test.todo("slice 4: failed persistence retains the dirty editor until retry succeeds, then final release disposes it", () => {});
});
