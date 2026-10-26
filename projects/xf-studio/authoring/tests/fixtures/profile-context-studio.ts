/** Asset-free real composition for P3-ii: the production context owner, application registry, collection/file facades and resolver. */
import { createProfileAuthoring } from "../../src/app/profiles/profile-authoring";
import { createProfileServices, createTargetResolver, sceneCommands } from "../../src/app/profiles/profile-window";
import { sessionOfWorkspace } from "../../src/app/profiles/profiles-migration-data";
import { profileSessionOf, type ProfileSessionData } from "../../src/app/profiles/profile-session";
import { createTrustedStudioBootstrap } from "../../src/app/trusted-studio-bootstrap";
import type { StudioPickedFile } from "../../src/app/studio-file-operations";
import { ViewportAttachment } from "../../src/app/viewport-attachment";
import { UIPreferenceActions } from "../../src/app/ui-preferences";
import { CreatorCatalogue } from "../../src/character/creator-catalogue";
import { STUDIO_COMPOSITION } from "../../src/compose/studio-registry";
import { STUDIO_CATALOGUE } from "../../src/compose/views";
import { createStudioSubjects } from "../../src/compose/subjects";
import { panelCommands } from "../../src/compose/panel-commands";
import { DocumentOutbox } from "../../src/platform/core/document-outbox";
import { createHistoryService } from "../../src/platform/core/history-service";
import { characterRef } from "../../src/platform/api/characters";
import { MAIN_VIEW, type ViewRecord } from "../../src/platform/api/view-graph";
import { createStudioViewGraph, sessionViewGraph } from "../../src/preview/preview-view-graph";
import type { LookRef } from "../../src/library/collection-documents";
import type { CollectionTransport } from "../../src/library/collection-service";
import { fixtureHost } from "./creator-host";
import { freshWorkspace, initialRecipe } from "./eye-region";
import { openSession, seededRandom } from "./profile-sessions";
import { memoryOutboxStorage } from "./platform-doubles";
import { openTestLibrary, type TestLibrary } from "./library-file";
import { libraryPort, libraryVersions, storedLook } from "./profile-studio";

export type ContextRestart = { library: TestLibrary; session: ProfileSessionData; profile: string; looks: LookRef[]; vs: string[] };
export async function profileContextStudio(options: { restart?: ContextRestart; pick?: () => Promise<StudioPickedFile | undefined>; package?: CollectionTransport["package"] } = {}) {
  const library = options.restart?.library ?? openTestLibrary(), transport = libraryPort(library), storage = memoryOutboxStorage();
  const outbox = new DocumentOutbox(transport, storage, { retryMs: 5 }); outbox.open();
  const history = createHistoryService(), workspace = freshWorkspace(), host = await fixtureHost();
  const services = createProfileServices({ documents: transport, outbox, history, subjects: createStudioSubjects(),
    catalogue: new CreatorCatalogue(host.port), versions: libraryVersions(library) });
  await services.load();
  let data: ProfileSessionData, profile: string, looks: LookRef[], vs: string[];
  if (options.restart) ({ session: data, profile, looks, vs } = options.restart);
  else {
    const made = await services.profiles.dispatch({ kind: "profile.create", name: "P3 contexts" });
    if (!made.ok) throw Error(made.reason); profile = made.profile;
    looks = [];
    for (const n of [0, 1]) {
      const collection = crypto.randomUUID(), inputs = Array.from({ length: n ? 1 : 2 }, (_, i) => storedLook({ name: `Look ${n}-${i}`, recipe: initialRecipe() }));
      const answer = services.collections.dispatch({ kind: "collection.create", id: collection, name: `Collection ${n}`, looks: inputs });
      if (!answer.ok) throw Error(answer.reason);
      looks.push(...inputs.map(look => ({ collection, look: look.id })));
    }
    vs = [];
    for (const body of ["female", "male", "female"] as const) {
      const answer = await services.characters.create({ source: { kind: "default", bodyGender: body } });
      if (!answer.ok) throw Error(answer.reason); vs.push(answer.character);
    }
    const seed = sessionOfWorkspace(workspace, { tab: "Contexts", character: vs[0], look: looks[0] }, seededRandom(27));
    const graph = createStudioViewGraph(workspace.preview, seed.views);
    graph.addView(MAIN_VIEW, {}, { title: "Second" }); graph.addView(MAIN_VIEW, {}, { title: "Third" });
    const raw = sessionViewGraph(graph), views = raw.views as readonly ViewRecord[], tab = seed.tabs[0]!.id;
    data = { ...seed, tabs: [{ ...seed.tabs[0]!, dock: null, panels: [
      ...views.map((view, i) => ({ id: `presets--scene${i}`, type: "presets", binding: { policy: "pinned" as const, target: { scene: view.scene } } })),
      { id: "presets--shared", type: "presets", binding: { policy: "pinned", target: { look: looks[0]! } } },
      { id: "presets--unseen", type: "presets", binding: { policy: "pinned", target: { look: looks[2]! } } },
      { id: "presets--follow", type: "presets" },
      ...vs.map((id, i) => ({ id: `character--target${i}`, type: "character", binding: { policy: "pinned" as const, target: { subject: characterRef(id) } } })),
    ] }], views: { ...raw, views: views.map(view => ({ ...view, tab })), scenes: raw.scenes.map(scene => {
      const index = views.findIndex(view => view.scene === scene.id);
      return { ...scene, gen: 0, look: looks[index]!, subject: characterRef(vs[index]!) };
    }) } };
  }
  const session = openSession(profileSessionOf(data)!, { profile, history }), notes: string[] = [], failures: unknown[] = [];
  let resets = 0, shows = 0;
  const authoring = createProfileAuthoring(workspace, { history, views: session.graph, selectedCollection: () => "fixture", resetStack: () => { resets++; } },
    STUDIO_COMPOSITION, { owner: services.collections, sessions: services.looks, outbox, note: text => notes.push(text), report: error => failures.push(error), shown: () => { shows++; } });
  const core = authoring.core, targets = createTargetResolver({ state: session, history, services, contexts: type => STUDIO_CATALOGUE.context(type) });
  core.app.attach({ scenes: sceneCommands(session, services), panels: panelCommands(session, targets), targetCheck: targets });
  const drawn = session.session().views.views[0]!.id, scene = session.graph.node(drawn, "scene").id;
  const viewport = new ViewportAttachment<string>({ moveHost: () => {}, measure: () => ({ width: 300, height: 600 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined, uvView: () => undefined, uvCommand: () => false,
    hitAt: () => undefined, queryContext: hit => core.app.contextQuery(hit) });
  const boot = createTrustedStudioBootstrap({ core, preferences: new UIPreferenceActions(workspace.uiPreferences), viewport,
    previewReadiness: { readiness: () => ({ phase: "ready", size: 512, pending: 0, waiting: false, estimatedBytes: 0, layers: [] }), subscribe: () => () => {} },
    fileDevice: { pick: options.pick ?? (async () => undefined), download: () => {}, bakeMask: async () => new Blob() },
    collections: { owner: services.collections, scene: { look: () => session.scene(scene).look, setLook: ref => session.setLook(scene, ref), subscribe: listener => session.subscribe(listener) },
      transport: { list: async () => library.collections.list(), get: async id => library.collections.get(id), package: options.package ?? (async () => { throw Error("Not used"); }) }, flushLook: () => authoring.contexts.commit() },
    naming: () => ({ look: session.scene(scene).look, collection: session.scene(scene).look?.collection, scene, sceneGen: session.scene(scene).gen, view: drawn, scope: history.focus.editing() ?? undefined }),
    targets, bound: { session, targets, looks: authoring.contexts, empty: authoring.empty, context: type => STUDIO_CATALOGUE.context(type), character: id => {
      if (!services.characters.character(id)) return undefined;
      const context = services.characters.context(id, { showSave: () => {} }); context.start(); return context;
    } },
    savedAppearance: { has: () => false, read: () => undefined, load: () => ({}), ready: () => false }, onRecipeImported: () => {} });
  authoring.drawn.show(session.scene(scene).look);
  const off = session.subscribe(() => authoring.drawn.show(session.scene(scene).look));
  const port = boot.mount(port => port), lives: AbortController[] = [];
  const bind = (id: string) => { const life = new AbortController(); lives.push(life); return { life, context: port.editing!.acquire(id, life.signal)! }; };
  const settle = async () => { authoring.contexts.commit(); return outbox.settle(); };
  const stored = (): ContextRestart => ({ library, session: profileSessionOf(JSON.parse(JSON.stringify(session.session())))!, profile, looks, vs });
  let disposed = false;
  const dispose = async () => { if (disposed) return; disposed = true; for (const life of lives) life.abort(); off(); await settle(); boot.files.dispose(); boot.collection.dispose(); authoring.drawn.dispose();
    for (const id of vs) await services.characters.release(id); outbox.stop(); };
  return { library, transport, outbox, storage, services, history, session, authoring, core, port, targets, looks, vs, drawn, scene, bind, settle, stored, dispose,
    failures, notes, counters: () => ({ resets, shows }) };
}
