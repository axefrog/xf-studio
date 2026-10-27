import { expect, test } from "bun:test";
import { AuthoringDocument, type DocumentState } from "../src/app/authoring/authoring-document";
import { featureId, LOOK_HISTORY_1, type FeatureModule, type LookHistoryData } from "../src/platform/api";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { CONTROL_TRANSACTION } from "../src/platform/core/history-transaction";
import { emptyLookHistory } from "../src/platform/core/look-history";
import { LiveFeatures } from "../src/platform/core/live-features";
import { editorComposition, FIXTURE_LOOK, SYNTHETIC_ID, SYNTHETIC_LAYERED, zeroFeatureComposition, type SyntheticPart } from "./fixtures/editor-composition";
import { AuthoringDocument as MakeupDocument } from "./fixtures/makeup-document";
import { freshWorkspace } from "./fixtures/eye-region";

const MARKER = featureId("synthetic-marker");
const marker: FeatureModule = { owner: "feature", id: MARKER, label: "Marker", api: 1, stage: "dev", actions: {},
  part: { current: "test/marker-1", accepts: ["test/marker-1"], maxBytes: 64,
    parse(envelope) { const count = (envelope.body as { count?: unknown })?.count;
      if (typeof count !== "number" || !Number.isInteger(count)) throw Error("Invalid marker."); return { count }; },
    serialize: body => ({ schema: "test/marker-1", body }), empty: () => ({ count: 0 }), starter: () => ({ count: 0 }), summary: () => ({}) },
  editor: { empty: () => ({}), parse: () => ({}), serialize: () => ({}) },
};
function fixture(initial: DocumentState = { features: { [SYNTHETIC_ID]: { part: SYNTHETIC_LAYERED.part.starter(), editor: { selected: "second" } } } },
  history = createHistoryService(), scope = lookScope(FIXTURE_LOOK)) {
  const composition = editorComposition([SYNTHETIC_LAYERED as FeatureModule, marker]), life = new AbortController();
  const document = new AuthoringDocument(initial, { features: composition.live, parts: composition.parts }, { signal: life.signal, history, scope, activate: false });
  return { ...composition, life, history, document, layers: composition.live.document(SYNTHETIC_ID)!, marker: composition.live.document(MARKER)! };
}

test("slice 2: a zero-feature authoring document snapshots and restores a sparse look without a recipe", () => {
  const zero = zeroFeatureComposition(), history = createHistoryService(), life = new AbortController(), scope = lookScope(FIXTURE_LOOK);
  const document = new AuthoringDocument({}, { features: zero.live, parts: zero.parts }, { signal: life.signal, history, scope, activate: false });
  try {
    expect(document.snapshot()).toEqual({ features: {}, history: emptyLookHistory() });
    expect("recipe" in document).toBe(false);
    expect(document.history.canUndo()).toBe(false);
    const original = document.history;
    document.restore(document.export());
    expect(document.history).toBe(original);
    document.restore({}, "look:next/empty");
    expect(history.scope(scope)).toBeUndefined();
    expect(history.scope("look:next/empty")).toBe(document.history);
    expect(document.snapshot()).toEqual({ features: {}, history: emptyLookHistory() });
  } finally { life.abort(); }
  expect(history.scope("look:next/empty")).toBeUndefined();
  expect(() => document.export()).toThrow();
});

test("slice 2: synthetic and second plain-data parts share one look history, including cross-part Undo/Redo and absent-part restoration", () => {
  const f = fixture(), scope = f.document.history;
  try {
    const original = f.document.export();
    // Snapshots do not alias live state or the caller's retained input.
    (original.features[SYNTHETIC_ID].part as SyntheticPart).layers[0].value = 99;
    expect((f.layers.part as SyntheticPart).layers[0].value).toBe(1);
    scope.checkpoint([SYNTHETIC_ID, MARKER], { label: "Both parts", actionKind: "test.both" });
    f.layers.set({ layers: [{ id: "first", value: 7 }] }, { selected: "first" }); f.marker.set({ count: 3 }, {});
    expect(scope.data().entries[0].scope).toBe("look");
    const observed: ReturnType<AuthoringDocument["export"]>[] = [];
    f.document.subscribe(change => { if (change === "part") observed.push(f.document.export()); });
    expect(scope.undo()).toBe(true);
    expect(f.marker.part).toBeUndefined();
    expect(f.layers.editor).toEqual({ selected: "first" });
    expect((f.layers.part as SyntheticPart).layers).toHaveLength(2);
    expect(observed).toHaveLength(1);
    expect(observed[0].features[MARKER]).toBeUndefined();
    expect(scope.redo()).toBe(true);
    expect(f.marker.part).toEqual({ count: 3 });
    expect((f.layers.part as SyntheticPart).layers[0].value).toBe(7);
    expect(observed).toHaveLength(2);
    const last = scope.timeline().steps.at(-1)!.id;
    expect(scope.jumpTo(scope.timeline().startId)).toBe(true);
    expect(f.marker.part).toBeUndefined();
    expect(scope.jumpTo(last)).toBe(true);
    const persisted = f.document.export(), restored = fixture(persisted);
    try { expect(restored.document.history.undo()).toBe(true); expect(restored.marker.part).toBeUndefined(); }
    finally { restored.life.abort(); }
    const transaction = scope.begin([SYNTHETIC_ID, MARKER], CONTROL_TRANSACTION);
    f.marker.set({ count: 10 }, {});
    transaction.cancel();
    expect(f.marker.part).toEqual({ count: 3 });
    expect(scope.canRedo()).toBe(false);
  } finally { f.life.abort(); }
});

test("slice 2: eye-makeup document adapter retains part/history and selection parity", () => {
  const workspace = freshWorkspace(), resets: string[] = [], document = new MakeupDocument(workspace, undefined, { resetStack: previous => resets.push(previous.layers[0].id) });
  try {
    document.active = 1; document.selected = 2;
    const initial = document.export();
    document.checkpoint();
    document.recipe = { ...document.recipe, layers: [...document.recipe.layers].reverse() };
    document.active = 0; document.selected = 1;
    const selectedId = document.recipe.layers[0].id;
    expect(document.history.undo()).toBe(true);
    expect(document.recipe).toEqual(initial.recipe);
    expect(document.recipe.layers[document.active].id).toBe(selectedId);
    expect(document.selected).toBe(1);
    expect(resets).toEqual([selectedId]);
    expect(document.history.redo()).toBe(true);
    expect(document.active).toBe(0);
    const restored = document.export(); document.restore(restored);
    expect(document.export()).toEqual(restored);
    expect(document.history.canRedo()).toBe(false);
  } finally { document.dispose(); }
});

test("slice 2: invalid multi-part replay refuses atomically with state, timeline and notifications unchanged", () => {
  const history: LookHistoryData = { schema: LOOK_HISTORY_1, entries: [{ scope: "look", before: { [SYNTHETIC_ID]: ["s"], [MARKER]: ["m"] } }],
    chunks: { s: { id: "first", value: 0 }, m: { count: "damaged" } } };
  const f = fixture({ features: { [SYNTHETIC_ID]: { part: SYNTHETIC_LAYERED.part.starter() }, [MARKER]: { part: { count: 3 } } }, history });
  try {
    const before = f.document.export(), timeline = f.document.history.timeline(), changes: string[] = [];
    f.document.subscribe(change => changes.push(change));
    expect(f.document.history.undo()).toBe(false);
    expect(f.document.export()).toEqual(before);
    expect(f.document.history.timeline()).toEqual(timeline);
    expect(changes).toEqual([]);
    expect(() => f.live.restore({ [SYNTHETIC_ID]: { layers: [] }, [MARKER]: { count: "bad" } })).toThrow();
    expect(f.document.export()).toEqual(before);
    expect(changes).toEqual([]);
  } finally { f.life.abort(); }
});

test("slice 2: invalid loads preserve the scope and state; restoring a look discards its Redo", () => {
  const f = fixture();
  try {
    const scope = f.document.history, before = f.document.export(), changes: string[] = [];
    f.document.subscribe(change => changes.push(change));
    expect(() => f.document.restore({ ...before, history: { ...emptyLookHistory(), entries: [{ scope: "look", before: { unregistered: null } }] } }, "look:other/look")).toThrow();
    expect(() => f.document.restore({ features: { [SYNTHETIC_ID]: { part: { layers: [] } }, [MARKER]: { part: { count: "bad" } } } })).toThrow();
    expect(f.document.history).toBe(scope);
    expect(f.document.export()).toEqual(before);
    expect(changes).toEqual([]);
    scope.checkpoint([SYNTHETIC_ID]); f.layers.set({ layers: [] }, { selected: null }); scope.undo();
    expect(scope.canRedo()).toBe(true);
    f.document.restore(f.document.export());
    expect(scope.canRedo()).toBe(false);
  } finally { f.life.abort(); }
});

test("slice 2: look histories and selections are isolated; opening or restoring an unseen context does not select it", () => {
  const f = fixture(), second = fixture(undefined, f.history, "look:other/look");
  try {
    expect(f.history.focus.recent()).toEqual([]);
    f.document.restore(f.document.export());
    expect(f.history.focus.recent()).toEqual([]);
    f.document.history.checkpoint([SYNTHETIC_ID]); f.layers.set({ layers: [] }, { selected: null });
    const selected = f.history.focus.recent(), third = fixture(undefined, f.history, "look:third/look");
    try { expect(f.history.focus.recent()).toEqual(selected); }
    finally { third.life.abort(); }
    second.document.restore(second.document.export());
    expect(f.history.focus.recent()).toEqual(selected);
    expect(second.document.history.canUndo()).toBe(false);
    expect(second.layers.editor).toEqual({ selected: "second" });
    second.life.abort();
    expect(f.document.history.canUndo()).toBe(true);
    expect(f.history.scope(f.document.scopeId)).toBe(f.document.history);
  } finally { f.life.abort(); second.life.abort(); }
});

test("slice 2: unknown live state and an already-aborted context fail without replacing an existing scope", () => {
  const f = fixture(), life = new AbortController(), scope = f.document.history;
  try {
    const zero = zeroFeatureComposition(); life.abort();
    expect(() => new AuthoringDocument({}, { features: zero.live, parts: zero.parts }, { signal: life.signal, history: f.history, scope: scope.id })).toThrow();
    expect(() => f.document.restore({ features: { unknown: { part: { count: 1 } } } })).toThrow();
    expect(f.history.scope(scope.id)).toBe(scope);
    expect((f.layers.part as SyntheticPart).layers[0].value).toBe(1);
  } finally { life.abort(); f.life.abort(); }
});

test("slice 2: an in-place part change publishes its snapshot and invalidates Redo", () => {
  const f = fixture(), observed: ReturnType<AuthoringDocument["export"]>[] = [];
  try {
    f.document.history.checkpoint([SYNTHETIC_ID]); f.layers.set({ layers: [] }, { selected: null });
    expect(f.document.history.undo()).toBe(true);
    expect(f.document.history.canRedo()).toBe(true);
    f.document.subscribe(change => { if (change === "part") observed.push(f.document.export()); });
    (f.layers.part as SyntheticPart).layers[0].value = 4;
    f.document.changed([SYNTHETIC_ID]);
    expect(observed).toHaveLength(1);
    expect((observed[0].features[SYNTHETIC_ID].part as SyntheticPart).layers[0].value).toBe(4);
    expect(f.document.history.canRedo()).toBe(false);
  } finally { f.life.abort(); }
});

test.each(["document subscriber", "feature subscriber", "replay hook"])("slice 2: a throwing %s cannot roll back a committed history move", source => {
  const composition = editorComposition([marker]), live = new LiveFeatures(), history = createHistoryService(), life = new AbortController();
  const failure = Error("Observer failed"), fail = () => { throw failure; };
  live.add(marker, source === "replay hook" ? { restored: fail } : undefined);
  if (source === "feature subscriber") live.subscribe(change => { if (change.kind === "restore") fail(); });
  const document = new AuthoringDocument({ features: { [MARKER]: { part: { count: 1 } } } },
    { features: live, parts: composition.parts }, { signal: life.signal, history });
  const scope = document.history, part = live.document(MARKER)!, observed: unknown[] = [];
  try {
    scope.checkpoint([MARKER]); part.set({ count: 7 }, {});
    if (source === "document subscriber") document.subscribe(change => { if (change === "part") fail(); });
    document.subscribe(change => { if (change === "part") observed.push({ part: part.part, history: scope.state() }); });
    expect(() => scope.undo()).toThrow(failure);
    expect(part.part).toEqual({ count: 1 });
    expect(scope.state()).toMatchObject({ depth: 0, redoDepth: 1 });
    expect(observed).toMatchObject([{ part: { count: 1 }, history: { depth: 0, redoDepth: 1 } }]);
    expect(() => scope.redo()).toThrow(failure);
    expect(part.part).toEqual({ count: 7 });
    expect(scope.state()).toMatchObject({ depth: 1, redoDepth: 0 });
    expect(observed).toMatchObject([
      { part: { count: 1 }, history: { depth: 0, redoDepth: 1 } },
      { part: { count: 7 }, history: { depth: 1, redoDepth: 0 } },
    ]);
  } finally { life.abort(); }
});

test("slice 2: abort makes retained history refuse live reads and replay, and guards the document's subscriptions and mutations", () => {
  const f = fixture(), scope = f.document.history;
  scope.checkpoint([SYNTHETIC_ID]); f.layers.set({ layers: [{ id: "first", value: 7 }] }, { selected: "first" });
  scope.checkpoint([SYNTHETIC_ID]); f.layers.set({ layers: [{ id: "first", value: 9 }] }, { selected: "first" });
  expect(scope.undo()).toBe(true); // Abort with valid Redo also exercises scope retirement.
  const before = f.document.export(), start = scope.timeline().startId;
  f.life.abort();
  expect(f.history.scope(scope.id)).toBeUndefined();
  expect(scope.undo()).toBe(false);
  expect(scope.redo()).toBe(false);
  expect(scope.jumpTo(start)).toBe(false);
  expect(scope.revertTransaction(undefined)).toBe(false);
  expect(() => scope.checkpoint([SYNTHETIC_ID])).toThrow();
  expect(() => scope.begin([SYNTHETIC_ID], CONTROL_TRANSACTION)).toThrow();
  expect(scope.capability({ kind: "history.undo" }).available).toBe(false);
  expect(() => f.document.subscribe(() => {})).toThrow();
  expect(() => f.document.onReplacing(() => {})).toThrow();
  expect(() => f.document.setBlocked("Released")).toThrow();
  expect(() => f.document.changed()).toThrow();
  expect(() => f.document.replacing()).toThrow();
  expect(() => f.document.restore(before, "look:released/other")).toThrow();
  expect(f.live.export()).toEqual(before.features);
  expect(f.history.scope("look:released/other")).toBeUndefined();
});

test.each(["part load", "history publication"])("slice 2: abort during construction's %s unwinds the scope and subscriptions", source => {
  const composition = editorComposition([marker]), history = createHistoryService(), life = new AbortController(), scope = lookScope(FIXTURE_LOOK);
  const off = source === "part load" ? composition.live.subscribe(() => life.abort()) : history.subscribe(() => life.abort());
  try {
    expect(() => new AuthoringDocument({ features: { [MARKER]: { part: { count: 1 } } } },
      { features: composition.live, parts: composition.parts }, { signal: life.signal, history, scope })).toThrow();
    expect(life.signal.aborted).toBe(true);
    expect(history.scope(scope)).toBeUndefined();
    off();
    // Neither source can call back into a partially constructed, released document.
    expect(() => composition.live.document(MARKER)!.set({ count: 7 }, {})).not.toThrow();
    expect(history.scope(scope)).toBeUndefined();
  } finally { off(); life.abort(); }
});

test("slice 2: abort while a restore closes its old scope cannot register the replacement scope", () => {
  const f = fixture(), state = f.document.export(), old = f.document.scopeId;
  const off = f.history.subscribe(() => f.life.abort());
  try {
    expect(() => f.document.restore(state, "look:released/replacement")).toThrow();
    expect(f.history.scope(old)).toBeUndefined();
    expect(f.history.scope("look:released/replacement")).toBeUndefined();
  } finally { off(); f.life.abort(); }
});
