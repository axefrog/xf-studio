import type { Clock } from "../../src/platform/core/clock";
import { emptyChoicesPort } from "../../src/app/profiles/empty-choices";
import { starterParts } from "../../src/app/workspace/collection-workspace";
import { defaultViewGraph } from "../../src/preview/preview-view-graph";
import { layoutTabsPort } from "../../src/app/profiles/tab-presentation";
import { tabDefaults } from "../../src/app/profiles/profile-window";
import type { ModuleService } from "../../src/platform/api";
/** Asset-free real composition for P3-ii: the production context owner, application registry, collection/file facades and resolver. */
import { ShapeStarters } from "../../src/app/starters/shape-starters";
import { StarterActions } from "../../src/app/starters/starter-actions";
import { readStarterShape } from "../../src/engines/layered-makeup/starter-shape";
import type { DiagnosticsActions } from "../../src/diagnostics/actions";
import type { Recipe } from "../../src/engines/layered-makeup/recipe";
import { createProfileAuthoring } from "../../src/app/profiles/profile-authoring";
import { createProfileServices, createTargetResolver, sceneCommands, historyScopeDetails, historyScopeName, panelBindingTargets } from "../../src/app/profiles/profile-window";
import { sessionOfWorkspace } from "../../src/app/profiles/profiles-migration-data";
import { profileSessionOf, type ProfileSessionData } from "../../src/app/profiles/profile-session";
import { createTrustedStudioBootstrap } from "../../src/app/trusted-studio-bootstrap";
import type { StudioFilePort, StudioPickedFile } from "../../src/app/studio-file-operations";
import type { ModInstallActions } from "../../src/installation/mod-install-actions";
import type { PartPresetService } from "../../src/library/part-presets";
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
export async function profileContextStudio(options: { clock?: Clock; now?: () => number; restart?: ContextRestart; pick?: () => Promise<StudioPickedFile | undefined>; package?: CollectionTransport["package"]; diagnostics?: DiagnosticsActions; starters?: boolean; recipe?: () => Recipe; modInstall?: ModInstallActions; presets?: PartPresetService; modules?: readonly ModuleService[]; viewPanels?: boolean; available?: (type: string) => boolean; generation?: (type: string) => number; panelViewport?: Parameters<typeof createTrustedStudioBootstrap<HTMLElement>>[0]["panelViewport"] } = {}) {
  const library = options.restart?.library ?? openTestLibrary(undefined, { clock: options.clock }), transport = libraryPort(library), storage = memoryOutboxStorage();
  const outbox = new DocumentOutbox(transport, storage, { retryMs: 5 }); outbox.open();
  const history = createHistoryService(), workspace = freshWorkspace(), host = await fixtureHost();
  const services = createProfileServices({ documents: transport, outbox, now: options.now ?? (options.clock ? () => options.clock!.now() : undefined), history, subjects: createStudioSubjects(),
    catalogue: new CreatorCatalogue(host.port), versions: libraryVersions(library) });
  await services.load();
  let data: ProfileSessionData, profile: string, looks: LookRef[], vs: string[];
  if (options.restart) ({ session: data, profile, looks, vs } = options.restart);
  else {
    const made = await services.profiles.dispatch({ kind: "profile.create", name: "P3 contexts" });
    if (!made.ok) throw Error(made.reason); profile = made.profile;
    looks = [];
    for (const n of [0, 1]) {
      const collection = crypto.randomUUID(), inputs = Array.from({ length: n ? 1 : 2 }, (_, i) => storedLook({ name: `Look ${n}-${i}`, recipe: options.recipe?.() ?? initialRecipe() }));
      const answer = services.collections.dispatch({ kind: "collection.create", id: collection, name: `Collection ${n}`, looks: inputs });
      if (!answer.ok) throw Error(answer.reason);
      looks.push(...inputs.map(look => ({ collection, look: look.id })));
      const member = await services.profiles.dispatch({ kind: "profile.addCollection", profile, base: services.profiles.profile(profile)!.revision, collection });
      if (!member.ok) throw Error(member.reason);
    }
    vs = [];
    for (const body of ["female", "male", "female"] as const) {
      const answer = await services.characters.create({ source: { kind: "default", bodyGender: body }, profile: { id: profile, base: services.profiles.profile(profile)!.revision } });
      if (!answer.ok) throw Error(answer.reason); vs.push(answer.character);
    }
    const seed = sessionOfWorkspace(workspace, { tab: "Contexts", character: vs[0], look: looks[0] }, seededRandom(27));
    const graph = createStudioViewGraph(workspace.preview, seed.views);
    graph.addView(MAIN_VIEW, {}, { title: "Second" }); graph.addView(MAIN_VIEW, {}, { title: "Third" });
    const raw = sessionViewGraph(graph), views = raw.views as readonly ViewRecord[], tab = seed.tabs[0]!.id;
    data = { ...seed, tabs: [{ ...seed.tabs[0]!, dock: null, panels: [
      ...(options.viewPanels ? views.map((view, i) => ({ id: `view--scene${i}`, type: "view", binding: { policy: "pinned" as const, target: { view: view.id } } })) : []),
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
  const core = authoring.core, targets = createTargetResolver({ state: session, history, services, available: options.available, generation: options.generation, contexts: type => STUDIO_CATALOGUE.context(type) });
  if (options.presets) core.app.attach({ presets: options.presets });
  const panelActions = panelCommands(session, targets, undefined, { bindingTargets: () => panelBindingTargets(session, services, targets.world()) });
  const layoutDefaults = tabDefaults(session, services);
  core.app.attach({ scenes: sceneCommands(session, services), panels: panelActions, tabs: layoutDefaults, targetCheck: targets,
    historyScopeDetails: scope => historyScopeDetails(scope, { services, history }) });
  let drawn = session.session().views.views[0]!.id;
  const scene = session.graph.node(drawn, "scene").id, sceneOf = () => session.graph.viewIds().includes(drawn) ? session.graph.node(drawn, "scene").id : undefined;
  let starters: ShapeStarters | undefined;
  let starterActions: StarterActions | undefined;
  if (options.starters) {
    const region = STUDIO_COMPOSITION.region;
    starters = new ShapeStarters({ documents: transport, outbox, feature: region.id, label: region.label, contributed: region.starters,
      fallback: region.defaultStarter, read: value => readStarterShape(value, region.newLayer(), region.models), choice: { get: () => undefined, set: () => {} } });
    await starters.load();
    starterActions = new StarterActions({ starters, feature: region.id, label: region.label, thumbnail: region.thumbnail });
    core.app.attach({ starters: starterActions, starterShapes: starters });
  }
  const collectionTransport: CollectionTransport = { list: async () => library.collections.list(), get: async id => library.collections.get(id),
    package: options.package ?? (async () => { throw Error("Not used"); }) };
  const fileDevice: StudioFilePort = { pick: options.pick ?? (async () => undefined), download: () => {}, bakeMask: async () => new Blob() };
  const viewport = new ViewportAttachment<HTMLElement>({ moveHost: () => {}, measure: () => ({ width: 300, height: 600 }), resize: () => {},
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined, uvView: () => undefined, uvCommand: () => false,
    hitAt: () => undefined, queryContext: hit => core.app.contextQuery(hit) }, ["head", "uv"]);
  const emptyChoices = emptyChoicesPort({ session, resolver: targets, services, panels: panelActions,
    ownerType: (instance, route) => route === "look" ? "presets" : route === "subject" ? "view" : STUDIO_CATALOGUE.primary(session.panel(instance)?.type ?? "")?.id,
    starter: () => starterParts(core.documents), createLookCapability: () => ({ available: true }), access: () => ({ available: true }),
    baseline: () => defaultViewGraph(workspace.preview), dispatch: action => core.app.dispatch(action) });
  const boot = createTrustedStudioBootstrap({ core, emptyChoices, diagnostics: options.diagnostics, modInstall: options.modInstall, preferences: new UIPreferenceActions(workspace.uiPreferences), viewport,
    previewReadiness: { readiness: () => ({ phase: "ready", size: 512, pending: 0, waiting: false, estimatedBytes: 0, layers: [] }), subscribe: () => () => {} },
    fileDevice,
    collections: { owner: services.collections, scene: { look: () => { const id = sceneOf(); return id ? session.knownScene(id)?.look : undefined; }, setLook: ref => { const id = sceneOf(); if (id) session.setLook(id, ref); }, subscribe: listener => session.subscribe(listener) },
      transport: collectionTransport, flushLook: () => authoring.contexts.commit() },
    naming: () => targets.namedView(drawn),
    modules: options.modules, panelViewport: options.panelViewport,
    focus: session.focus, starters: starterActions?.port(),
    scopeName: scope => historyScopeName(scope, { services, history }),
    panelInstance: (panel, tab) => session.instance(panel, tab),
    panelTargets: { bindings: panelActions.bindings(), target: id => session.panelTarget(id), tabTarget: id => session.panelTabTarget(id), capture: id => targets.structural(id) },
    tabs: layoutTabsPort(session, layoutDefaults, services),
    targets, bound: { available: options.available, session, targets, looks: authoring.contexts, empty: authoring.empty, context: type => STUDIO_CATALOGUE.context(type), character: id => {
      if (!services.characters.character(id)) return undefined;
      const context = services.characters.context(id, { showSave: () => {} }); context.start(); return context;
    } },
    savedAppearance: { has: () => false, read: () => undefined, load: () => ({}), ready: () => false }, onRecipeImported: () => {} });
  authoring.drawn.show(session.scene(scene).look);
  const draw = (view: string) => { drawn = view; authoring.drawn.show(sceneOf() ? session.knownScene(sceneOf()!)?.look : undefined); };
  const off = session.subscribe(() => authoring.drawn.show(sceneOf() ? session.knownScene(sceneOf()!)?.look : undefined));
  const port = boot.mount(port => port), lives: AbortController[] = [];
  const bind = (id: string) => { const life = new AbortController(); lives.push(life); return { life, context: port.editing!.acquire(id, life.signal)! }; };
  const settle = async () => { authoring.contexts.commit(); return outbox.settle(); };
  const stored = (): ContextRestart => ({ library, session: profileSessionOf(JSON.parse(JSON.stringify(session.session())))!, profile, looks, vs });
  let disposed = false;
  const dispose = async () => { if (disposed) return; disposed = true; for (const life of lives) life.abort(); off(); await settle(); boot.dispose(); authoring.drawn.dispose();
    for (const id of vs) await services.characters.release(id); outbox.stop(); };
  return { emptyChoices, panelActions, library, transport, outbox, storage, services, history, session, authoring, core, port, targets, looks, vs, get drawn() { return drawn; }, draw, scene, bind, collectionTransport, fileDevice, starters, settle, stored, dispose,
    failures, notes, counters: () => ({ resets, shows }) };
}
