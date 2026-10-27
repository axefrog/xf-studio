/**
 * The Studio's collection and look wiring without a browser (profiles phase 1d-ii): a library in memory (its documents, released tables and
 * Save version, as the host composes them), the page's outbox over it, the collection owner and look sessions, the trusted authoring core
 * showing a scene's look through the look editor, and the collection application over them, as `compose/studio-startup.ts` wires them.
 * A second window (`window`) can share the library, as another workspace would.
 */
import { ProfileService } from "../../src/app/profiles/profile-service";
import { createStudioSubjects } from "../../src/compose/subjects";
import { createTrustedAuthoringCore } from "../../src/app/trusted-authoring-core";
import type { StudioApplication } from "../../src/app/studio-application";
import { fixtureTargets, named } from "./named-targets";
import { StudioFileOperations, type StudioPickedFile } from "../../src/app/studio-file-operations";
import { STUDIO_COMPOSITION, STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import type { Recipe } from "../../src/engines/layered-makeup/recipe";
import { CollectionApplication } from "../../src/library/collection-application";
import { CollectionService, type CollectionServiceDeps, type CollectionTransport } from "../../src/library/collection-service";
import type { AuthoringDocument } from "../../src/app/authoring/makeup-document";
import type { DocumentModel } from "../../src/app/workspace/collection-workspace";
import { type LookRef, lookRef, collectionRef } from "../../src/library/collection-documents";
import { CollectionOwner, type CollectionVersionsPort } from "../../src/library/collection-owner";
import { saveCollectionVersion } from "../../src/library/host/collection-store";
import { LookEditor, lookContent } from "../../src/library/look-editor";
import { LookSessions } from "../../src/library/look-sessions";
import { starterLook, withLivePart } from "../../src/app/workspace/collection-workspace";
import type { DocumentStorePort } from "../../src/platform/api/document-store";
import type { PackageBuildResult, PackageCheckResult } from "../../src/platform/api";
import { DocumentOutbox } from "../../src/platform/core/document-outbox";
import { createHistoryService, lookScope } from "../../src/platform/core/history-service";
import { freshWorkspace } from "./eye-region";
import { openTestLibrary, type TestLibrary } from "./library-file";
import { eyeBuild, eyeCheck } from "./package-results";
import { memoryOutboxStorage } from "./platform-doubles";

const MODEL = STUDIO_DOCUMENTS;

/** The library's document routes as a page reaches them. */
export function libraryPort(library: TestLibrary): DocumentStorePort {
  const store = library.documents;
  return { list: async kind => store.list(kind), transact: async request => store.transact(request), revisions: async refs => store.revisions(refs),
    read: async refs => store.read(refs) };
}
/** The host's Save version over the test library. */
export const libraryVersions = (library: TestLibrary): CollectionVersionsPort =>
  ({ save: async id => saveCollectionVersion(library.collections, library.documents, library.database, id) });

/** A scene that shows one look (`scene.setLook`), as the session's drawn scene does. */
export function testScene(initial?: LookRef) {
  let look = initial;
  const listeners = new Set<() => void>();
  return { look: () => look, setLook: (ref: LookRef | undefined) => { look = ref && { ...ref }; for (const listener of [...listeners]) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

export type StudioLookInput = { name: string; recipe?: Recipe };

/** A look's stored parts for a new working copy (the starter look, with `recipe` as its eye makeup when given). */
export function storedLook(input: StudioLookInput, id: string = crypto.randomUUID()) {
  const look = starterLook(id, input.name, MODEL), parts = input.recipe ? withLivePart(look, structuredClone(input.recipe), MODEL) : look.parts;
  return { id, name: input.name, parts: MODEL.parts.minimalLook({ ...look, parts }, false).parts };
}

export async function profileStudio(options: {
  /** The looks of the collection the scene shows (default: one look, "Look", on the four-layer sample recipe). Empty: no collection at all. */
  looks?: readonly StudioLookInput[];
  name?: string;
  /** Share another window's library. */
  library?: TestLibrary;
  /** Show this look instead of making a collection. */
  show?: LookRef;
  /** Check and Build answers (default: canned results for the collection sent). */
  check?: (input: unknown) => PackageCheckResult;
  /** A file the picker answers (import). */
  pick?: () => StudioPickedFile | undefined;
  /** Save version as the host answers it (default: the library's own, at once). */
  versions?: (library: CollectionVersionsPort) => CollectionVersionsPort;
  /** Where the editor's new items' IDs come from (default: random UUIDs). */
  newId?: () => string;
  /** A profile lists the collections made here (the Studio's membership edit, in the same command). */
  profile?: boolean;
  /** The part a new look starts from (the chosen starter's), as the composition root passes it. */
  starterPart?: () => unknown;
} = {}) {
  const library = options.library ?? openTestLibrary(), port = libraryPort(library), storage = memoryOutboxStorage();
  const outbox = new DocumentOutbox(port, storage, { retryMs: 5 });
  outbox.open();
  const owner = new CollectionOwner({ documents: port, outbox, versions: options.versions?.(libraryVersions(library)) ?? libraryVersions(library) });
  await owner.load();
  let ref = options.show;
  if (!ref && (options.looks ?? [{ name: "Look", recipe: freshWorkspace().recipe }]).length) {
    const id = crypto.randomUUID(), looks = (options.looks ?? [{ name: "Look", recipe: freshWorkspace().recipe }]).map(look => storedLook(look));
    const made = owner.dispatch({ kind: "collection.create", id, name: options.name ?? "Current", looks });
    if (!made.ok) throw Error(made.reason);
    ref = { collection: id, look: looks[0]!.id };
  }
  const scene = testScene(ref), history = createHistoryService(), sessions = new LookSessions(owner, outbox);
  const shownView = ref ? owner.look(ref) : null, first = shownView?.state === "live" ? lookContent(shownView, MODEL) : null;
  const workspace = freshWorkspace();
  let application: CollectionApplication | undefined;
  const core = createTrustedAuthoringCore({ ...workspace, ...(first ? first.state : {}) }, { history, resetStack: () => {},
    selectedCollection: () => application?.selectedPresetId() ?? "draft", ...(ref && first ? { scope: lookScope(ref) } : {}),
    ...(options.newId ? { newId: options.newId } : {}) }, STUDIO_COMPOSITION);
  const lookEditor = new LookEditor({ model: MODEL, sessions, document: core.document, restoring: look => outbox.recovering(lookRef(look)),
    store: () => outbox.store() });
  const downloads: { name: string; text: string }[] = [];
  let packageInput: unknown;
  const transport: CollectionTransport = {
    list: async () => library.collections.list(), get: async id => library.collections.get(id),
    package: async (action, input) => {
      packageInput = input;
      const check = options.check?.(input) ?? eyeCheck(input as { id: string }, { presets: ((input as { presets: { id: string }[] }).presets)
        .map(look => ({ id: look.id, revision: 1, appearance: "xfs_test" })) });
      return action === "check" ? check : eyeBuild(check) satisfies PackageBuildResult;
    },
  };
  const files = new StudioFileOperations({ pick: async () => options.pick?.(), download: (blob, name) => { void blob.text().then(text => downloads.push({ name, text })); },
    bakeMask: async () => new Blob() }, {
    recipe: () => core.document.recipe, selectedLayer: () => core.document.recipe.layers[core.document.active],
    importRecipe: (value, name, collection) => application!.importRecipe(value, name, collection),
    hasSavedV: () => false, savedV: () => undefined, loadSavedV: () => ({}), savedVReady: () => false,
    executeCollection: request => core.app.execute(request), recoverCollection: draft => application!.recover(draft),
  });
  let profiles: ProfileService | undefined, profile: string | undefined;
  if (options.profile) {
    profiles = new ProfileService({ documents: port, outbox, subjects: createStudioSubjects() });
    await profiles.load();
    const made = await profiles.dispatch({ kind: "profile.create", name: "Test profile" });
    if (!made.ok) throw Error(made.reason);
    profile = made.profile;
  }
  // The input layer (profiles design §3.6): actions name the scene's look, its collection and the editing context, as the port names them.
  const targets = fixtureTargets(core, { scene, collection: () => application?.service.draftIdentity()?.collectionId });
  const app = named(core.app, targets);
  application = new CollectionApplication({ model: MODEL, owner, scene, transport, flushLook: () => lookEditor.commit(),
    ...(options.starterPart ? { starterPart: options.starterPart } : {}),
    ...(profiles ? { membership: (collection: string) => profiles!.collectionMembership(profile!, collection) } : {}) }, core.document,
    app as unknown as StudioApplication, files);
  lookEditor.show(scene.look());
  scene.subscribe(() => lookEditor.show(scene.look()));
  const all = () => [...owner.list().flatMap(view => [collectionRef(view.id), ...[...view.looks, ...view.removed.map(item => item.look)]
    .map(look => lookRef({ collection: view.id, look }))])];
  return {
    library, port, outbox, storage, owner, sessions, scene, history, core, app, targets, document: core.document, lookEditor, collection: application, files,
    profiles, profile,
    service: application.service,
    downloads, packageInput: () => packageInput, transport,
    /** Writes the shown look, then waits until the library holds every change. */
    async settle() { lookEditor.commit(); return outbox.settle(all()); },
    /** The shown collection's ID. */
    shown: () => scene.look()?.collection,
    /** Choosing a preset of the shown collection: `scene.setLook` (its scene and `gen` named by the input layer). */
    choose: (look: string) => ({ kind: "scene.setLook" as const, look: { collection: application!.service.draftIdentity()!.collectionId, look } }),
  };
}
export type ProfileStudio = Awaited<ReturnType<typeof profileStudio>>;

/**
 * The collection service alone (no editor) over a library in memory holding `value` (a collection file of either schema) as a working
 * copy, its scene showing the first look. `recipe`: the editor's live recipe for that look. `transport` and `versions` stand in for the
 * host where a test needs to.
 */
export async function collectionServiceOver(value: unknown, options: { model?: DocumentModel; recipe?: Recipe; versions?: CollectionVersionsPort;
  package?: CollectionTransport["package"]; library?: TestLibrary } = {}) {
  const model = options.model ?? MODEL;
  const library = options.library ?? openTestLibrary(), port = libraryPort(library), outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5 });
  outbox.open();
  const owner = new CollectionOwner({ documents: port, outbox, versions: options.versions ?? libraryVersions(library) });
  await owner.load();
  const read = model.parts.readCollection(value, true, "keep");
  const plan = (value as { packagePlan?: unknown }).packagePlan;
  const made = owner.dispatch({ kind: "collection.create", id: read.id, name: read.name, looks: read.presets.map(look => ({ id: look.id, name: look.name,
    parts: model.parts.minimalLook(look).parts })), ...(plan !== undefined ? { packagePlan: plan } : {}) });
  if (!made.ok) throw Error(made.reason);
  const scene = testScene(read.presets[0] ? { collection: read.id, look: read.presets[0].id } : undefined);
  const recipe = options.recipe;
  const svc = new CollectionService({ model, owner, scene, transport: { list: async () => library.collections.list(), get: async id => library.collections.get(id),
    package: options.package ?? (async () => { throw Error("unused"); }) }, ...(recipe ? { readRecipe: () => ({ recipe, revision: 0 }) } : {}) });
  return { svc, owner, scene, library, outbox,
    /** The collection as the library last saved it as a version. */
    saved: () => { const list = library.collections.list(); return list.length ? library.collections.get(list.at(-1)!.id).collection : undefined; } };
}

/**
 * The collection wiring for a trusted bootstrap, made at once (nothing awaited): a working copy of `looks` in a library in memory (named
 * `name`, saved as version `saved` when given), shown on a scene, with a look editor over `document`. `deps` is what the bootstrap takes.
 */
export function bootstrapCollections(document: AuthoringDocument, input: { name?: string; looks: readonly StudioLookInput[]; saved?: number;
  transport?: Partial<CollectionTransport> }) {
  const library = openTestLibrary(), port = libraryPort(library), outbox = new DocumentOutbox(port, memoryOutboxStorage(), { retryMs: 5 });
  outbox.open();
  const owner = new CollectionOwner({ documents: port, outbox, versions: libraryVersions(library) });
  const id = crypto.randomUUID(), looks = input.looks.map(look => storedLook(look));
  const made = owner.dispatch({ kind: "collection.create", id, name: input.name ?? "Current", looks, ...(input.saved ? { saved: { revision: input.saved } } : {}) });
  if (!made.ok) throw Error(made.reason);
  const scene = testScene(looks[0] ? { collection: id, look: looks[0].id } : undefined);
  const lookEditor = new LookEditor({ model: MODEL, sessions: new LookSessions(owner, outbox), document });
  lookEditor.show(scene.look());
  scene.subscribe(() => lookEditor.show(scene.look()));
  const transport: CollectionTransport = { list: async () => library.collections.list(), get: async key => library.collections.get(key),
    package: async () => { throw Error("No package build."); }, ...input.transport };
  const deps: Omit<CollectionServiceDeps, "readRecipe" | "model"> = { owner, scene, transport, flushLook: () => lookEditor.commit() };
  return { library, outbox, owner, scene, lookEditor, deps, id, looks };
}
