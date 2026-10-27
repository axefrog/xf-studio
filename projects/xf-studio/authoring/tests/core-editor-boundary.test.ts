import { describe, expect, test } from "bun:test";
import type { FeatureEditorHost } from "../src/platform/api";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { createSyntheticEditor, editorCollection, editorComposition, FIXTURE_LOOK, SYNTHETIC_ID, SYNTHETIC_LAYERED,
  syntheticEditorComposition, zeroFeatureComposition, type SyntheticPart } from "./fixtures/editor-composition";
import { AuthoringDocument } from "../src/app/authoring/authoring-document";
import { collectionDraft, liveFeatureStates, newLook, starterLook } from "../src/app/workspace/collection-workspace";
import { freshWorkspace, loadWorkspace, parseWorkspace, serializeWorkspace, workspaceKeys } from "../src/app/workspace/workspace-state";
import { encodeWorkspaceAt } from "../src/app/workspace/workspace-budget";
import { lookContent, lookStored } from "../src/library/look-editor";
import { libraryStores, openLibraryDatabase } from "../src/library/host/library-files";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { parseWorkspace as parseMakeup, serializeWorkspace as serializeMakeup } from "../src/app/workspace/makeup-workspace";
import { smallWorkspaceV1, looseWorkspaceV1 } from "./fixtures/workspace-v1-fixtures";
import { join } from "node:path";
import { tempDir } from "./temp-dir";

import { createAuthoringEditing } from "../src/app/trusted-authoring-core";
import { LookEditContexts } from "../src/library/look-edit-contexts";
import { CollectionOwner } from "../src/library/collection-owner";
import { LookSessions } from "../src/library/look-sessions";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";

async function editableLooks(synthetic = true) {
  const fixture = synthetic ? syntheticEditorComposition() : zeroFeatureComposition();
  const composition = { registry: fixture.registry, documents: { parts: fixture.parts } };
  const database = openLibraryDatabase(":memory:"), stores = libraryStores(database, fixture.parts);
  const documents: import("../src/platform/api/document-store").DocumentStorePort = { list: async kind => stores.documents.list(kind),
    read: async (refs: Parameters<typeof stores.documents.read>[0]) => stores.documents.read(refs),
    revisions: async (refs: Parameters<typeof stores.documents.revisions>[0]) => stores.documents.revisions(refs),
    transact: async (request: Parameters<typeof stores.documents.transact>[0]) => stores.documents.transact(request) };
  const outbox = new DocumentOutbox(documents, memoryOutboxStorage(), { retryMs: 5 }); outbox.open();
  const owner = new CollectionOwner({ documents, outbox }); await owner.load();
  const first = editorCollection(synthetic).presets[0], second = { ...structuredClone(first), id: "00000000-0000-4000-8000-000000000003", name: "Other" };
  const made = owner.dispatch({ kind: "collection.create", id: FIXTURE_LOOK.collection, name: "Editors", looks: [first, second] });
  if (!made.ok) throw Error(made.reason);
  await outbox.settle();
  const sessions = new LookSessions(owner, outbox), history = createHistoryService();
  const contexts = new LookEditContexts({ composition, history, owner, sessions, outbox });
  return { contexts, history, owner, outbox, composition, other: { collection: FIXTURE_LOOK.collection, look: second.id },
    async close() { contexts.dispose(); await outbox.settle(); outbox.stop(); database.close(); } };
}
function setSynthetic(editing: ReturnType<typeof createAuthoringEditing>, value: number, selected: string | null = "first") {
  const document = editing.document.features.document(SYNTHETIC_ID)!;
  const action = { kind: "synthetic.setValue" as const, id: "first", value }, spec = SYNTHETIC_LAYERED.actions[action.kind];
  editing.document.history.checkpoint([SYNTHETIC_ID], spec.label(action));
  const result = spec.apply({ part: document.part as SyntheticPart, editor: { selected } }, action);
  document.set(result.part, result.editor);
}
function syntheticSnapshot(editing: ReturnType<typeof createAuthoringEditing>) {
  return editing.editors.get(SYNTHETIC_ID)!.snapshot() as ReturnType<ReturnType<typeof createSyntheticEditor>["snapshot"]>;
}

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

test("slice 3: editor-only memory stays sparse, and resetting a blank document removes its previous memory", () => {
  const module = { ...SYNTHETIC_LAYERED, editor: {
    empty: () => ({ collapsed: false }), parse: (value: unknown) => ({ collapsed: (value as { collapsed?: boolean })?.collapsed === true }),
    serialize: (value: unknown) => value,
  } };
  const composition = editorComposition([module]), model = { parts: composition.parts }, life = new AbortController();
  const initial = lookContent({ id: FIXTURE_LOOK.look, name: "Sparse", parts: {}, memory: {} }, model);
  const document = new AuthoringDocument({ features: { [SYNTHETIC_ID]: { editor: { collapsed: true } } } },
    { features: composition.live, parts: composition.parts }, { signal: life.signal });
  try {
    const first = lookStored(initial, document.export(), model)!;
    expect(first.look.parts).toEqual({});
    expect(first.lookMemory[SYNTHETIC_ID]).toEqual({ editor: { collapsed: true } });
    document.restore({});
    const cleared = lookStored({ look: first.look, memory: first.lookMemory }, document.export(), model)!;
    expect(cleared.look.parts).toEqual({});
    expect(cleared.lookMemory[SYNTHETIC_ID]).toBeUndefined();
  } finally { life.abort(); }
});

describe("CORE-03 later-slice construction gates (no shell-mount claim)", () => {
  // Slice 2's three active construction gates now live in look-document.test.ts.
  test("slice 3: an empty registry cold-loads a writable workspace with no mandatory live-recipe projection", () => {
    const zero = zeroFeatureComposition(), model = { parts: zero.parts }, loaded = loadWorkspace({ getItem: () => null }, true, model);
    expect(loaded.writable).toBe(true);
    expect(loaded.error).toBeUndefined();
    for (const key of ["recipe", "active", "selected", "fieldSelection", "glitterChoices"]) expect(key in loaded.state).toBe(false);
    expect(serializeWorkspace(loaded.state, model)).toMatchObject({ look: { parts: {}, memory: {} }, features: {} });
    expect(parseWorkspace(JSON.parse(encodeWorkspaceAt(loaded.state, 0, model).encoded), model)).toEqual(loaded.state);
    expect(newLook("empty", "Empty", model).parts).toEqual({});
    expect(starterLook("empty", "Empty", model).parts).toEqual({});
    const synthetic = syntheticEditorComposition(), starting = { parts: synthetic.parts, live: SYNTHETIC_ID };
    expect(newLook("synthetic", "Synthetic", starting).parts[SYNTHETIC_ID].body).toEqual(SYNTHETIC_LAYERED.part.empty());
    expect(loadWorkspace({ getItem: () => null }, true, starting).state.liveFeatures?.[SYNTHETIC_ID]?.part).toEqual(SYNTHETIC_LAYERED.part.starter());
    const raw = JSON.stringify(serializeWorkspace(loaded.state, model));
    expect(loadWorkspace({ getItem: key => key === workspaceKeys(true).workspace ? raw : null }, true, model).writable).toBe(true);
    expect(loadWorkspace({ getItem: () => "damaged" }, true, model).writable).toBe(false);
  });
  test("slice 3: zero-feature and synthetic collections round-trip workspace drafts and SQLite without adding makeup", () => {
    for (const synthetic of [false, true]) {
      const composition = synthetic ? syntheticEditorComposition() : zeroFeatureComposition(), model = { parts: composition.parts };
      const collection = editorCollection(synthetic), draft = collectionDraft(collection, model), look = draft.collection.presets[0];
      look.parts["unknown-detail"] = { schema: "test/future-1", body: { retained: true } };
      const memory = { "unknown-detail": { editor: { retained: true } } };
      const initial = lookContent({ ...look, memory }, model), life = new AbortController();
      const document = new AuthoringDocument(initial.state, { features: composition.live, parts: composition.parts }, { signal: life.signal });
      try {
        if (synthetic) {
          document.history.checkpoint([SYNTHETIC_ID]);
          composition.live.document(SYNTHETIC_ID)!.set({ layers: [{ id: "first", value: 7 }] }, { selected: "first" });
        }
        const written = lookStored(initial, document.export(), model)!;
        look.parts = written.look.parts; draft.memory[look.id] = written.lookMemory;
        const state = freshWorkspace(document.export());
        state.otherFeatures = { parts: { "unknown-detail": look.parts["unknown-detail"] }, memory };
        const loose = serializeWorkspace(state, model), looseRestored = parseWorkspace(loose, model);
        expect(serializeWorkspace(looseRestored, model)).toEqual(loose);
        expect(looseRestored.liveFeatures).toEqual(state.liveFeatures);
        expect(looseRestored.history).toEqual(state.history);
        state.collections = draft;
        const stored = serializeWorkspace(state, model), path = join(tempDir("xfs-core-workspace-"), "library.sqlite");
        let database = openLibraryDatabase(path);
        try {
          const stores = libraryStores(database, composition.parts);
          expect(stores.documents.put("test-workspace", "fixture", stored, 0).ok).toBe(true);
          stores.collections.save({ collection: draft.collection });
        } finally { database.close(); }
        database = openLibraryDatabase(path);
        try {
          const stores = libraryStores(database, composition.parts), loaded = parseWorkspace(stores.documents.get("test-workspace", "fixture")!.value, model);
          expect("recipe" in loaded).toBe(false);
          expect(serializeWorkspace(loaded, model)).toEqual(stored);
          expect(stores.collections.get(collection.id).collection.presets[0].parts).toEqual(look.parts);
          expect(loaded.collections!.collection.presets[0].id).toBe(FIXTURE_LOOK.look);
          expect(loaded.collections!.memory[look.id]["unknown-detail"]).toEqual(memory["unknown-detail"]);
          expect(loaded.liveFeatures?.["eye-makeup"]).toBeUndefined();
          expect(loaded.collections!.collection.presets[0].parts["eye-makeup"]).toBeUndefined();
          const next = synthetic ? syntheticEditorComposition() : zeroFeatureComposition(), restoredLife = new AbortController();
          const restored = new AuthoringDocument({ features: loaded.liveFeatures, history: loaded.history },
            { features: next.live, parts: next.parts }, { signal: restoredLife.signal });
          try {
            expect(restored.history.undo()).toBe(synthetic);
            if (synthetic) expect((next.live.read(SYNTHETIC_ID) as SyntheticPart).layers[0].value).toBe(1);
          } finally { restoredLife.abort(); }
        } finally { database.close(); }
      } finally { life.abort(); }
    }
  });
  test("slice 3: released eye-makeup workspace and collection formats retain compatibility", () => {
    for (const fixture of [smallWorkspaceV1(), looseWorkspaceV1()]) {
      const neutral = parseWorkspace(fixture, STUDIO_DOCUMENTS), makeup = parseMakeup(fixture, STUDIO_DOCUMENTS);
      const stored = serializeWorkspace(neutral, STUDIO_DOCUMENTS);
      expect("recipe" in neutral).toBe(false);
      expect(stored).toEqual(serializeMakeup(makeup, STUDIO_DOCUMENTS));
      expect(serializeWorkspace(parseWorkspace(stored, STUDIO_DOCUMENTS), STUDIO_DOCUMENTS)).toEqual(stored);
      expect(neutral.liveFeatures?.[STUDIO_DOCUMENTS.live]?.part).toEqual(makeup.recipe);
      expect(makeup.history).toEqual(neutral.history);
      const preset = neutral.collections?.collection.presets[0];
      if (preset) {
        expect(STUDIO_DOCUMENTS.parts.writeMinimal(neutral.collections!.collection).schema).toBe("xfas/collection-1");
        expect(liveFeatureStates(preset, neutral.collections!.memory[preset.id], STUDIO_DOCUMENTS)?.[STUDIO_DOCUMENTS.live]).toBeDefined();
      }
    }
  });
  test("slice 4: zero-feature trusted editing opens and releases a look scope without constructing makeup", async () => {
    const fixture = zeroFeatureComposition(), history = createHistoryService(), life = new AbortController(), scope = lookScope(FIXTURE_LOOK);
    const editing = createAuthoringEditing({}, { history, signal: life.signal, look: FIXTURE_LOOK, scope, activate: false },
      { registry: fixture.registry, documents: { parts: fixture.parts } });
    expect(editing.editors.size).toBe(0);
    expect(editing.document.export().features).toEqual({});
    expect("recipe" in editing.document).toBe(false);
    expect(history.scope(scope)).toBe(editing.document.history);
    life.abort(); expect(editing.signal.aborted).toBe(true); expect(history.scope(scope)).toBeUndefined();
    expect(() => editing.document.export()).toThrow();
    const w = await editableLooks(false);
    try {
      const requester = new AbortController(), held = w.contexts.acquire(FIXTURE_LOOK, requester.signal)!;
      expect(held.context.editors.size).toBe(0);
      expect(held.context.document.export().features).toEqual({});
      requester.abort(); expect(w.contexts.held()).toEqual([]);
      expect(w.history.scope(scope)).toBeUndefined();
    } finally { await w.close(); }
  });
  test("slice 4: synthetic construction uses its registered factory and observes edits, selection and replay", () => {
    let constructions = 0;
    const module = { ...SYNTHETIC_LAYERED, createEditor(host: FeatureEditorHost) { constructions++; return createSyntheticEditor(host); } };
    const fixture = editorComposition([module]), history = createHistoryService(), life = new AbortController();
    const editing = createAuthoringEditing({ features: { [SYNTHETIC_ID]: { part: module.part.starter() } } },
      { history, signal: life.signal, look: FIXTURE_LOOK, scope: lookScope(FIXTURE_LOOK) },
      { registry: fixture.registry, documents: { parts: fixture.parts } });
    try {
      expect(constructions).toBe(1);
      expect(syntheticSnapshot(editing)).toMatchObject({ look: FIXTURE_LOOK, scope: lookScope(FIXTURE_LOOK), present: true, selected: null });
      setSynthetic(editing, 7);
      expect(syntheticSnapshot(editing).layers[0].value).toBe(7);
      expect(syntheticSnapshot(editing).selected).toBe("first");
      expect(editing.document.history.undo()).toBe(true); expect(syntheticSnapshot(editing).layers[0].value).toBe(1);
      expect(editing.document.history.redo()).toBe(true); expect(syntheticSnapshot(editing).layers[0].value).toBe(7);
      const snapshot = syntheticSnapshot(editing); Object.assign(snapshot.layers[0], { value: 99 });
      expect(syntheticSnapshot(editing).layers[0].value).toBe(7);
    } finally { life.abort(); }
    expect(() => syntheticSnapshot(editing)).toThrow();
  });
  test("slice 4: a failed or aborted factory unwinds every constructed editor and history target", () => {
    for (const abort of [false, true]) {
      const life = new AbortController(), history = createHistoryService(), failure = Error("Factory unavailable.");
      let retained: ReturnType<typeof createSyntheticEditor> | undefined;
      const module = { ...SYNTHETIC_LAYERED, createEditor(host: FeatureEditorHost) {
        retained = createSyntheticEditor(host);
        if (abort) { life.abort(); return retained; }
        throw failure;
      } };
      const fixture = editorComposition([module]);
      const construct = () => createAuthoringEditing({}, { history, signal: life.signal, scope: lookScope(FIXTURE_LOOK), look: FIXTURE_LOOK },
        { registry: fixture.registry, documents: { parts: fixture.parts } });
      if (abort) expect(construct).toThrow(); else expect(construct).toThrow(failure);
      expect(history.scope(lookScope(FIXTURE_LOOK))).toBeUndefined(); expect(() => retained!.snapshot()).toThrow();
      life.abort();
    }
  });
  test("slice 4: two requesters share one editor/history while another look keeps independent selection and history", async () => {
    const w = await editableLooks(), a = new AbortController(), b = new AbortController(), c = new AbortController();
    try {
      const first = w.contexts.acquire(FIXTURE_LOOK, a.signal)!, again = w.contexts.acquire(FIXTURE_LOOK, b.signal)!;
      const other = w.contexts.acquire(w.other, c.signal)!;
      expect(again.context).toBe(first.context);
      expect(other.context.document).not.toBe(first.context.document);
      expect(other.context.editors.get(SYNTHETIC_ID)).not.toBe(first.context.editors.get(SYNTHETIC_ID));
      setSynthetic(first.context, 7);
      expect(syntheticSnapshot(again.context)).toMatchObject({ selected: "first", layers: [{ id: "first", value: 7 }, { id: "second", value: 2 }] });
      expect(syntheticSnapshot(other.context).selected).toBeNull(); expect(other.context.document.history.state().depth).toBe(0);
      setSynthetic(other.context, 9, "second");
      expect(syntheticSnapshot(first.context).selected).toBe("first"); expect(syntheticSnapshot(other.context).selected).toBe("second");
      expect(first.context.document.history.undo()).toBe(true);
      expect(syntheticSnapshot(first.context).layers[0].value).toBe(1); expect(syntheticSnapshot(other.context).layers[0].value).toBe(9);
      expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBe(first.context.document.history);
      expect(w.history.scope(lookScope(w.other))).toBe(other.context.document.history);
    } finally { a.abort(); b.abort(); c.abort(); await w.close(); }
  });
  test("slice 4: releasing one requester preserves the other; final release aborts editors and closes the scope", async () => {
    const w = await editableLooks(), a = new AbortController(), b = new AbortController();
    try {
      const first = w.contexts.acquire(FIXTURE_LOOK, a.signal)!, second = w.contexts.acquire(FIXTURE_LOOK, b.signal)!;
      const editor = first.context.editors.get(SYNTHETIC_ID)!, history = first.context.document.history;
      first.release(); first.release(); a.abort();
      expect(w.contexts.held()).toEqual([{ ref: FIXTURE_LOOK, wants: 1, dirty: false }]);
      expect(second.context.signal.aborted).toBe(false); setSynthetic(second.context, 7);
      expect(syntheticSnapshot(second.context).layers[0].value).toBe(7);
      b.abort(); expect(w.contexts.held()).toEqual([]); expect(second.context.signal.aborted).toBe(true);
      expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBeUndefined(); expect(() => editor.snapshot()).toThrow();
      expect(history.undo()).toBe(false);
      const cancelled = new AbortController(); cancelled.abort(); expect(w.contexts.acquire(FIXTURE_LOOK, cancelled.signal)).toBeUndefined();
      const nextLife = new AbortController(), next = w.contexts.acquire(FIXTURE_LOOK, nextLife.signal)!;
      expect(next.context).not.toBe(first.context); expect(syntheticSnapshot(next.context).layers[0].value).toBe(7);
      expect(next.context.document.history.undo()).toBe(true); expect(syntheticSnapshot(next.context).layers[0].value).toBe(1); nextLife.abort();
    } finally { a.abort(); b.abort(); await w.close(); }
  });
  test("slice 4: failed persistence retains the dirty editor through reacquire, then retry stores and releases it", async () => {
    const w = await editableLooks(), a = new AbortController(), b = new AbortController();
    const update = w.owner.updateLook.bind(w.owner); let fail = true;
    w.owner.updateLook = (...args) => fail ? { ok: false, code: "unavailable", reason: "Persistence is unavailable." } : update(...args);
    try {
      const first = w.contexts.acquire(FIXTURE_LOOK, a.signal)!; setSynthetic(first.context, 7); a.abort();
      expect(w.contexts.held()).toEqual([{ ref: FIXTURE_LOOK, wants: 0, dirty: true }]);
      expect(first.context.signal.aborted).toBe(false);
      expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBe(first.context.document.history);
      const again = w.contexts.acquire(FIXTURE_LOOK, b.signal)!;
      expect(again.context).toBe(first.context); expect(syntheticSnapshot(again.context).layers[0].value).toBe(7); b.abort();
      fail = false; expect(w.contexts.commit()).toBe(true); await w.outbox.settle();
      expect(w.contexts.held()).toEqual([]); expect(first.context.signal.aborted).toBe(true);
      expect(() => syntheticSnapshot(first.context)).toThrow(); expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBeUndefined();
      const nextLife = new AbortController(), next = w.contexts.acquire(FIXTURE_LOOK, nextLife.signal)!;
      expect(syntheticSnapshot(next.context).layers[0].value).toBe(7);
      expect(next.context.document.history.undo()).toBe(true); expect(syntheticSnapshot(next.context).layers[0].value).toBe(1); nextLife.abort();
    } finally { fail = false; a.abort(); b.abort(); await w.close(); }
  });
  test("slice 4: shutdown retains a failed writer for an outbox-triggered retry and refuses new acquisition", async () => {
    const w = await editableLooks(), life = new AbortController(), update = w.owner.updateLook.bind(w.owner);
    let fail = true;
    w.owner.updateLook = (...args) => fail ? { ok: false, code: "unavailable", reason: "Persistence is unavailable." } : update(...args);
    try {
      const held = w.contexts.acquire(FIXTURE_LOOK, life.signal)!; setSynthetic(held.context, 7);
      w.contexts.dispose(); expect(held.context.signal.aborted).toBe(false);
      expect(w.contexts.acquire(w.other, life.signal)).toBeUndefined();
      fail = false;
      // An unrelated successful owner command is the next real outbox event; no private retry hook.
      expect(w.owner.dispatch({ kind: "collection.rename", collection: FIXTURE_LOOK.collection,
        base: w.owner.collection(FIXTURE_LOOK.collection)!.revision, name: "Retry" }).ok).toBe(true);
      await w.outbox.settle();
      expect(w.contexts.held()).toEqual([]); expect(held.context.signal.aborted).toBe(true);
      expect(w.history.scope(lookScope(FIXTURE_LOOK))).toBeUndefined();
      life.abort(); expect(w.contexts.held()).toEqual([]);
    } finally { fail = false; life.abort(); await w.close(); }
  });
});
