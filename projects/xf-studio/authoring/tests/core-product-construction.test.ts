/** Slice 13a exercises the real product constructors, without the released makeup fixture adapter. */
import { expect, test } from "bun:test";
import { createTrustedAuthoringCore } from "../src/app/trusted-authoring-core";
import { createProfileAuthoring } from "../src/app/profiles/profile-authoring";
import { authoringPresentation, type ProjectionFeature } from "../src/app/authoring/feature-projections";
import { createHistoryService, lookScope } from "../src/platform/core/history-service";
import { freshWorkspace } from "../src/app/workspace/workspace-state";
import { CollectionOwner } from "../src/library/collection-owner";
import { LookSessions } from "../src/library/look-sessions";
import { DocumentOutbox } from "../src/platform/core/document-outbox";
import { libraryStores, openLibraryDatabase } from "../src/library/host/library-files";
import type { DocumentStorePort } from "../src/platform/api/document-store";
import { editorCollection, editorComposition, FIXTURE_LOOK, SYNTHETIC_ID, SYNTHETIC_LAYERED } from "./fixtures/editor-composition";
import { STUDIO_OWNERS } from "../src/compose/studio-registry";
import { Registry, type AnyOwner } from "../src/platform/core/registry";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { registeredEditorAdapters } from "../src/preview/browser/editor-adapters";
import { createRegisteredPreview } from "../src/preview/browser/preview-capabilities";
import { createTrustedStudioBootstrap } from "../src/app/trusted-studio-bootstrap";
import { UIPreferenceActions } from "../src/app/ui-preferences";
import { ViewportAttachment } from "../src/app/viewport-attachment";
const productRegistry = (features: readonly AnyOwner[]) => new Registry<AnyOwner>([...STUDIO_OWNERS.filter(owner => owner.owner === "system"), ...features]);

for (const synthetic of [false, true]) test(`real product core constructs with ${synthetic ? "synthetic" : "zero"} features and a neutral document`, () => {
  const fixture = editorComposition(synthetic ? [SYNTHETIC_LAYERED] : []);
  const composition = { registry: productRegistry(fixture.registry.owners()), documents: { parts: fixture.parts } };
  const core = createTrustedAuthoringCore({ ...freshWorkspace(), liveFeatures: synthetic ? { [SYNTHETIC_ID]: { part: SYNTHETIC_LAYERED.part.starter() } } : undefined },
    { selectedCollection: () => "neutral" }, composition);
  try {
    expect(core.document).toBe(core.lookDocument);
    expect(core.document.features.features()).toEqual(synthetic ? [SYNTHETIC_ID] : []);
    expect(core.projections.size).toBe(0); expect(authoringPresentation(core)).toBeUndefined();
    expect("recipe" in core.document).toBe(false); expect("geometry" in core).toBe(false);
    expect(registeredEditorAdapters(core)).toBeUndefined();
    expect(createRegisteredPreview(core, { signal: core.signal, initialSize: 512, frame: run => run(), changed() {}, refresh() {}, refreshSelection() {},
      refreshQuality() {}, drawUV() {}, report() {} })).toBeUndefined();
    if (synthetic) {
      expect(core.app.dispatch({ kind: "synthetic.setValue", look: { collection: "local", look: "local" }, id: "first", value: 7 } as never).ok).toBe(true);
      expect(core.document.features.read(SYNTHETIC_ID)).toMatchObject({ layers: [{ id: "first", value: 7 }, { id: "second", value: 2 }] });
      expect(core.document.history.undo()).toBe(true); expect(core.document.history.redo()).toBe(true);
    }
  } finally { core.app.dispose(); core.dispose(); }
  expect(core.signal.aborted).toBe(true);
});

for (const synthetic of [false, true]) test(`real base/keyed profiles construct with ${synthetic ? "synthetic" : "zero"} features, sharing and A/B/A`, async () => {
  let projections = 0;
  // Prove an unrelated registered projection is opaque to the core and has the same keyed/root handoff.
  const module = { ...SYNTHETIC_LAYERED, authoring: { create(editing) { projections++;
    return { value: { snapshot: () => editing.editors.get(SYNTHETIC_ID)!.snapshot() }, services: {} };
  } } } satisfies ProjectionFeature;
  const fixture = editorComposition(synthetic ? [module] : []);
  const composition = { registry: productRegistry(fixture.registry.owners()), documents: { parts: fixture.parts } };
  const database = openLibraryDatabase(":memory:"), stores = libraryStores(database, fixture.parts);
  const documents: DocumentStorePort = { list: async kind => stores.documents.list(kind), read: async refs => stores.documents.read(refs),
    revisions: async refs => stores.documents.revisions(refs), transact: async request => stores.documents.transact(request) };
  const outbox = new DocumentOutbox(documents, memoryOutboxStorage(), { retryMs: 5 }); outbox.open();
  const owner = new CollectionOwner({ documents, outbox }); await owner.load();
  const first = editorCollection(synthetic).presets[0]!, second = { ...structuredClone(first), id: "00000000-0000-4000-8000-000000000003", name: "Other" };
  expect(owner.dispatch({ kind: "collection.create", id: FIXTURE_LOOK.collection, name: "Editors", looks: [first, second] }).ok).toBe(true);
  const history = createHistoryService(), life = new AbortController(), sessions = new LookSessions(owner, outbox);
  const profile = createProfileAuthoring(freshWorkspace(), { selectedCollection: () => "neutral", history }, composition, { owner, sessions, outbox });
  const workspace = freshWorkspace();
  const viewport = new ViewportAttachment<string>({ moveHost() {}, measure: () => ({ width: 300, height: 600 }), resize() {}, cancelInput() {},
    inputCapture: () => false, headView: () => undefined, uvView: () => undefined, uvCommand: () => false, hitAt: () => undefined,
    queryContext: hit => profile.core.app.contextQuery(hit) }, ["head"]);
  const bootstrap = createTrustedStudioBootstrap({ core: profile.core, viewport, preferences: new UIPreferenceActions(workspace.uiPreferences),
    previewReadiness: { readiness: () => ({ phase: "ready", size: 512, pending: 0, waiting: false, estimatedBytes: 0, layers: [] }), subscribe: () => () => {} },
    fileDevice: { pick: async () => undefined, download() {} }, savedAppearance: { has: () => false, read: () => undefined, load: () => ({}), ready: () => false },
    onRecipeImported() {}, naming: () => ({ look: profile.drawn.ref(), collection: FIXTURE_LOOK.collection, scope: profile.core.document.scopeId }),
    collections: { owner, scene: { look: () => profile.drawn.ref(), setLook: ref => { profile.drawn.show(ref); }, subscribe: () => () => {} },
      transport: { list: async () => [], get: async () => { throw Error("unused"); }, package: async () => { throw Error("unused"); } }, flushLook: () => profile.contexts.commit() } });
  const port = bootstrap.mount(value => value);
  try {
    expect(port.feature("eye-makeup")).toBeUndefined();
    expect(port.features().map(feature => feature.id)).toEqual(synthetic ? [SYNTHETIC_ID] : []);
    expect(port.viewport.snapshot().uv).toBeUndefined();
    expect(port.files.capability({ kind: "recipe.export" }).available).toBe(false);
    expect(profile.empty.document.locked).toBeDefined();
    expect("recipe" in profile.empty.document).toBe(false);
    const a = profile.contexts.acquire(FIXTURE_LOOK, life.signal)!.context;
    const peer = profile.contexts.acquire(FIXTURE_LOOK, life.signal)!.context;
    const other = { collection: FIXTURE_LOOK.collection, look: second.id };
    const b = profile.contexts.acquire(other, life.signal)!.context;
    expect(peer).toBe(a); expect(a.document).not.toBe(b.document);
    expect(a.document.history).toBe(history.scope(lookScope(FIXTURE_LOOK))!);
    expect(profile.drawn.show(FIXTURE_LOOK)).toBe(true);
    expect(profile.core.document.features).toBe(a.document.features);
    const scoped = a.document.history;
    if (synthetic) {
      const root = profile.core.projections.get(SYNTHETIC_ID) as { snapshot(): unknown };
      expect(root.snapshot()).toEqual(a.editors.get(SYNTHETIC_ID)!.snapshot());
      expect(profile.core.app.dispatch({ kind: "synthetic.setValue", look: FIXTURE_LOOK, id: "first", value: 9 } as never).ok).toBe(true);
      expect(profile.drawn.show(other)).toBe(true);
      expect(root.snapshot()).toEqual(b.editors.get(SYNTHETIC_ID)!.snapshot());
      expect(profile.drawn.show(FIXTURE_LOOK)).toBe(true);
      expect(root.snapshot()).toEqual(a.editors.get(SYNTHETIC_ID)!.snapshot());
      expect(projections).toBe(3); // base and two looks; reacquiring and A/B/A build nothing extra.
      expect(a.document.history.undo()).toBe(true);
      expect(a.document.features.read(SYNTHETIC_ID)).toEqual(b.document.features.read(SYNTHETIC_ID));
    } else {
      expect(profile.core.projections.size).toBe(0);
      expect(profile.drawn.show(other)).toBe(true); expect(profile.drawn.show(FIXTURE_LOOK)).toBe(true);
    }
    expect(a.document.history).toBe(scoped);
    expect(profile.drawn.show(undefined)).toBe(true);
    expect(profile.core.document.locked).toBeDefined();
  } finally { bootstrap.dispose(); life.abort(); profile.drawn.dispose(); await outbox.settle(); outbox.stop(); database.close(); }
});
