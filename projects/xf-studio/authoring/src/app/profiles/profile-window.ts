/**
 * A window's profile services (profiles design §1.1, §7; phase 1): the owners every document reaches the library through (the outbox), and
 * the session the window opens on. The composition root builds them once and shares them; nothing here holds a current V, look or view.
 *
 * - **Owners.** Profiles (`ProfileService`), Vs (`CharacterService`, one context per V a scene shows), collections and looks
 *   (`CollectionOwner`, and `LookSessions` per look shown or edited). Each loads what the library holds before the window shows anything.
 * - **The session** is the workspace's (`profiles.sessions`, made by the profiles migration), held by `ProfileSessions`, the one owner of
 *   its tabs, view graph and focus. A window that has none to open (another window holds an unmigrated workspace, or the workspace can't be
 *   written) opens a session made for it from the library's first profile, stored nowhere.
 * - **What a scene shows** may be empty. U6 presents the profile's choices; an explicitly empty scene never makes a V during loading.
 */
import type { SubjectRef, SubjectRegistryPort } from "../../platform/api/subjects";
import { characterRef } from "../../platform/api/characters";
import type { DocumentStorePort } from "../../platform/api/document-store";
import type { DocumentOutbox } from "../../platform/core/document-outbox";
import type { HistoryService } from "../../platform/core/history-service";
import { hostRandom } from "../../platform/core/random";
import { CharacterService } from "../../character/character-service";
import type { CreatorCatalogue } from "../../character/creator-catalogue";
import { CollectionOwner, type CollectionVersionsPort } from "../../library/collection-owner";
import { LookSessions } from "../../library/look-sessions";
import type { LookRef } from "../../library/collection-documents";
import { viewTitles, type ViewGraphData } from "../../platform/api/view-graph";
import { documentKey } from "../../platform/api/document-commands";
import { CHARACTER_KIND } from "../../platform/api/characters";
import { targetPresent } from "../../platform/api/target-status";
import type { ViewGraph, ViewGraphOwner } from "../../platform/core/view-graph";
import { CHARACTER_DOCUMENT } from "../../character/character-document";
import { LOOK_WORKING, lookRef as lookDocument } from "../../library/collection-documents";
import type { PanelContext, ConstraintRule } from "./bindings";
import { TargetResolver } from "./targets";
import { SceneCommands } from "./scene-commands";
import type { WorkspaceState } from "../workspace/makeup-workspace";
import { ProfileService } from "./profile-service";
import { ProfileSessions } from "./profile-sessions";
import type { ProfileSessionData } from "./profile-session";
import { FIRST_TAB_NAME, sessionOfWorkspace, type InitialProfileLayout } from "./profiles-migration-data";
import { LayoutDefaults, type ContributedDefaultsSource, type ContributedLayoutDefault } from "./layout-defaults";
import type { FragmentKnowledge, SceneCandidate, SubstitutionContext } from "./layout-fragment";
import { TabDefaults } from "./tab-defaults";
import { upgradePhaseOneSession } from "./profile-session-upgrade";
import type { BindingTargetOption } from "./panel-bindings";
import { bindingKey } from "./bindings";

export type ProfileServices = {
  readonly profiles: ProfileService;
  /** The default layouts: the modules' (read-only) and the person's own (`layout-default` documents). */
  readonly defaults: LayoutDefaults;
  readonly characters: CharacterService;
  readonly collections: CollectionOwner;
  readonly looks: LookSessions;
  /** Reads what the library holds into every owner. */
  load(signal?: AbortSignal): Promise<void>;
};

export function createProfileServices(deps: { documents: DocumentStorePort; outbox: DocumentOutbox; subjects: SubjectRegistryPort; catalogue: CreatorCatalogue;
  history: HistoryService; versions?: CollectionVersionsPort; report?: (error: unknown) => void; now?: () => number;
  /** The modules' default layouts and what the build has (`compose/layout-defaults.ts`). */
  layouts?: { contributed: readonly ContributedLayoutDefault[] | ContributedDefaultsSource; known: FragmentKnowledge; writable?: () => boolean; note?: (message: string) => void } }): ProfileServices {
  const profiles = new ProfileService({ documents: deps.documents, outbox: deps.outbox, subjects: deps.subjects });
  const characters = new CharacterService({ documents: deps.documents, outbox: deps.outbox, catalogue: deps.catalogue, history: deps.history, profiles,
    now: deps.now, ...(deps.report ? { report: deps.report } : {}) });
  const collections = new CollectionOwner({ documents: deps.documents, outbox: deps.outbox, ...(deps.versions ? { versions: deps.versions } : {}),
    now: deps.now, ...(deps.report ? { report: deps.report } : {}) });
  const looks = new LookSessions(collections, deps.outbox);
  const defaults = new LayoutDefaults({ documents: deps.documents, outbox: deps.outbox, ...deps.layouts, ...(deps.report ? { report: deps.report } : {}) });
  return { profiles, characters, collections, looks, defaults,
    load: async signal => { await Promise.all([profiles.load(signal), characters.load(signal), collections.load(signal), defaults.load(signal)]); } };
}

/**
 * The session this window opens on: the workspace's (its first profile's, phase 1 opening one profile), else one made from the library's
 * first profile (its first V and its first collection's first look), stored nowhere (`stored` false). `graph` makes the view graph over its
 * views (the composition's rules and recovery), recording through the session; `stored` is the graph as the session stores it.
 */
export function openProfileSession(workspace: WorkspaceState, services: Pick<ProfileServices, "profiles" | "collections">,
  deps: { history: HistoryService; graph(data: ViewGraphData, owner: ViewGraphOwner): ViewGraph; stored?(graph: ViewGraph): ViewGraphData;
    initial?: InitialProfileLayout },
  random: () => number = hostRandom().next): { state: ProfileSessions; stored: boolean } {
  const open = (profile: string, data: ProfileSessionData) =>
    new ProfileSessions({ profile, data, history: deps.history, graph: deps.graph, ...(deps.stored ? { stored: deps.stored } : {}), random });
  const sessions = workspace.profiles?.sessions ?? {}, first = Object.keys(sessions)[0];
  if (workspace.migration?.state === "done" && first)
    return { state: open(first, upgradePhaseOneSession(sessions[first]!, workspace.uiPreferences, random, deps.initial)), stored: true };
  const profile = services.profiles.list()[0];
  const character = profile?.subjects.find(subject => subject.kind === "character")?.id;
  const collection = profile?.collections.map(id => services.collections.collection(id)).find(view => view?.looks.length);
  const look: LookRef | undefined = collection ? { collection: collection.id, look: collection.looks[0]! } : undefined;
  // No stored session: show the contributed factory arrangement in memory. Legacy dock preferences are migration input,
  // not a usable profile session; opening this fallback must neither consume nor rewrite them.
  const fallback = deps.initial ? { ...workspace, uiPreferences: { ...workspace.uiPreferences, layout: undefined } } : workspace;
  const initial = deps.initial ? { origin: deps.initial.origin, dock: deps.initial.dock } : undefined;
  const session = sessionOfWorkspace(fallback, { tab: FIRST_TAB_NAME, ...(character ? { character } : {}), ...(look ? { look } : {}) }, random, initial);
  return { state: open(profile?.id ?? "", session), stored: false };
}

/**
 * The layout tabs' actions over the window's session and the default layouts (`TabDefaults`): a new tab's slots are filled from the
 * session's profile (its subjects, and the live looks of its collections in profile order) and its scenes (decision M2 of experiment
 * 044: a V another tab shows shares that tab's scene by default, the scene of the most recently focused view first).
 */
export function tabDefaults(state: ProfileSessions, services: Pick<ProfileServices, "profiles" | "collections" | "characters" | "defaults">,
  build: { keepsState?(type: string): boolean; known?: FragmentKnowledge } = {}): TabDefaults {
  return new TabDefaults({ sessions: state, defaults: services.defaults, ...build, candidates: () => substitutionContext(state, services) });
}

/** Candidate identities and names only. The binding world supplies owner status; no candidate acquires an editor or preview. */
export function panelBindingTargets(state: ProfileSessions, services: Pick<ProfileServices, "profiles" | "collections">,
  world: import("./bindings").BindingWorld): readonly BindingTargetOption[] {
  const data = state.session(), profile = services.profiles.profile(state.profile), options: BindingTargetOption[] = [], known = new Set<string>();
  const add = (option: BindingTargetOption) => { const key = bindingKey(option.binding); if (!known.has(key)) { known.add(key); options.push(option); } };
  for (const tab of data.tabs) {
    const views = data.views.views.filter(view => view.tab === tab.id), titles = viewTitles(views);
    views.forEach((view, index) => add({ binding: { policy: "pinned", target: { view: view.id } }, name: titles[index]!, tabs: [{ id: tab.id, name: tab.name }] }));
  }
  for (const scene of data.views.scenes) {
    const views = data.views.views.filter(view => view.scene === scene.id), tabs = data.tabs.filter(tab => views.some(view => view.tab === tab.id)).map(tab => ({ id: tab.id, name: tab.name }));
    const viewName = options.find(option => "view" in option.binding.target && option.binding.target.view === views[0]?.id)?.name;
    add({ binding: { policy: "pinned", target: { scene: scene.id } }, name: viewName ? `Scene of ${viewName}` : "Scene", tabs });
  }
  // Detached membership keeps resolving through existing scenes/pins, but is not a new direct choice (§1.4).
  const subjects = profile?.subjects ?? [];
  const looks = (profile?.collections ?? []).flatMap(collection => {
    const view = services.collections.collection(collection);
    return [...view?.looks ?? [], ...(view?.removed ?? []).map(removed => removed.look)].map(look => ({ collection, look }));
  });
  for (const tab of data.tabs) for (const panel of tab.panels) if (panel.binding?.policy === "pinned") {
    const pin = panel.binding.target;
    if ("view" in pin && !world.views[pin.view]) add({ binding: panel.binding, name: "Closed 3D view" });
    if ("scene" in pin && !world.scenes[pin.scene]) add({ binding: panel.binding, name: "Removed scene" });
  }
  const tabsShowing = (matches: (scene: typeof data.views.scenes[number]) => boolean) => data.tabs.filter(tab => data.views.views.some(view => view.tab === tab.id && data.views.scenes.some(scene => scene.id === view.scene && matches(scene)))).map(tab => ({ id: tab.id, name: tab.name }));
  for (const ref of subjects) add({ binding: { policy: "pinned", target: { subject: ref } }, name: world.subject(ref).label ?? `Unavailable ${ref.kind}`,
    parent: ref.kind, tabs: tabsShowing(scene => scene.subject?.kind === ref.kind && scene.subject.id === ref.id) });
  for (const ref of looks) add({ binding: { policy: "pinned", target: { look: ref } }, name: world.look(ref).label ?? "Unavailable look",
    parent: services.collections.collection(ref.collection)?.name ?? "Collection", tabs: tabsShowing(scene => scene.look?.collection === ref.collection && scene.look.look === ref.look) });
  return options;
}
/**
 * What a new tab can be filled from: the profile's subjects that still exist (a deleted V stays a member, design §1.4, but is never
 * offered), its live looks, and every scene the session shows, most recently focused first, each with the lights its view uses there.
 * It is read again when the action is dispatched, so a choice made before a V or look was deleted is refused then.
 */
export function substitutionContext(state: ProfileSessions, services: Pick<ProfileServices, "profiles" | "collections" | "characters">): SubstitutionContext {
  const profile = services.profiles.profile(state.profile), graph = state.graph, order = state.focus.viewOrder();
  const looks = (profile?.collections ?? []).flatMap(id => (services.collections.collection(id)?.looks ?? []).map(look => ({ collection: id, look })))
    .filter(ref => services.collections.look(ref)?.state === "live");
  const views = graph.viewIds().map((view, index) => ({ view, index })).sort((a, b) => (order[b.view] ?? 0) - (order[a.view] ?? 0) || a.index - b.index);
  const seen = new Set<string>(), scenes: SceneCandidate[] = [];
  for (const { view } of views) {
    const node = graph.node(view, "scene");
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const shown = state.scene(node.id);
    scenes.push({ scene: node.id, kind: node.kind ?? "", tab: state.viewTab(view), lights: graph.node(view, "lights").id, ...(shown.subject ? { subject: shown.subject } : {}),
      ...(shown.look ? { look: shown.look } : {}) });
  }
  return { subjects: (profile?.subjects ?? []).filter(subjectAvailable(services)), looks, scenes };
}

/** `scene.setLook` and `scene.setSubject` over the session's scenes, checking that a look or V still exists (profiles design §3.6). */
export function sceneCommands(state: ProfileSessions, services: Pick<ProfileServices, "characters" | "collections">): SceneCommands {
  return new SceneCommands({ scene: id => state.knownScene(id), setLook: (scene, look) => state.setLook(scene, look), setSubject: (scene, subject) => state.setSubject(scene, subject) },
    { look: ref => services.collections.look(ref)?.state === "live", subject: subjectAvailable(services) });
}
/** Whether a subject can be shown: one of a kind this build has, whose document exists (not deleted). */
const subjectAvailable = (services: Pick<ProfileServices, "characters">) => (ref: SubjectRef) =>
  ref.kind === CHARACTER_KIND && !!services.characters.document(ref.id);

/**
 * The window's input-layer resolution (app/profiles/targets.ts) over its session, view graph, focus and owners: what each panel, key
 * binding and palette command acts on, and the captures gestures and menus hold. `contexts`: each panel type's context (§3.1, §5).
 */
export function createTargetResolver(deps: { state: ProfileSessions; history: Pick<HistoryService, "acting">;
  services: Pick<ProfileServices, "characters" | "collections" | "looks">; contexts: (type: string) => PanelContext; rules?: readonly ConstraintRule[]; available?: (type: string) => boolean; generation?: (type: string) => number; collection?: () => string | undefined }): TargetResolver {
  const { state, services } = deps, graph = state.graph;
  return new TargetResolver({
    origin: (instance, tab = state.tabId()) => {
      if (!instance) return tab && state.tab(tab) ? state.panelTabTarget(tab) : null;
      const panel = state.panel(instance);
      return panel ? [state.panelTarget(instance), deps.available?.(panel.type) ?? true, deps.generation?.(panel.type) ?? 0] : null;
    },
    session: {
      tab: () => state.tabId(),
      views: () => graph.viewIds().map(id => ({ id, scene: graph.node(id, "scene").id, tab: state.viewTab(id) })),
      scene: id => {
        const scene = state.knownScene(id), kind = graph.viewIds().map(view => graph.node(view, "scene")).find(node => node.id === id)?.kind;
        return scene && kind !== undefined ? { kind, ...scene } : undefined;
      },
      panel: instance => state.panel(instance),
    },
    focus: state.focus,
    acting: scopes => deps.history.acting(scopes)?.id,
    status: {
      subject: ref => ref.kind === CHARACTER_KIND ? services.characters.targetStatus(ref.id)
        : { state: "unavailable", owner: { kind: ref.kind, id: ref.id }, reason: "This subject kind is not registered in this build." },
      look: ref => services.collections.targetStatus(ref),
    },
    available: deps.available,
    rules: deps.rules,
    // A 3D view's own panel instance (type `view`, pinned to its view) shows that view; every other type declares its context.
    context: type => type === "view" ? { kind: "view" } : deps.contexts(type),
    revisions: target => ({
      ...(target.subject?.kind === CHARACTER_KIND ? { [`${CHARACTER_DOCUMENT}/${target.subject.id}`]: services.characters.character(target.subject.id)?.revision ?? 0 } : {}),
      ...(target.look ? { [documentKey(lookDocument(target.look))]: services.looks.generation(target.look) } : {}),
    }),
    revision: key => {
      const slash = key.indexOf("/"), kind = key.slice(0, slash), id = key.slice(slash + 1);
      if (kind === CHARACTER_DOCUMENT) return services.characters.character(id)?.revision;
      if (kind === LOOK_WORKING) { const at = id.indexOf("/"); return services.looks.generation({ collection: id.slice(0, at), look: id.slice(at + 1) }); }
      return undefined;
    },
    ...(deps.collection ? { collection: deps.collection } : {}),
  });
}

/**
 * The view the window draws (experiment 044 P2-iii): the shown tab's most recently focused view, else its first (undefined: the shown tab
 * holds no view, or the session has no tab). It follows the shown tab: showing another tab, focusing another of its views, or closing the
 * view drawn moves it.
 */
export function drawnView(state: Pick<ProfileSessions, "graph" | "focus" | "tabId">): string | undefined {
  const graph = state.graph, tab = state.tabId(), views = graph.viewIds().filter(view => graph.tabOf(view) === tab);
  return state.focus.topView(views) ?? views[0];
}
/** The scene the window draws (empty: none, the shown tab holding no view). */
export function drawnScene(state: Pick<ProfileSessions, "graph" | "focus" | "tabId">): string {
  const view = drawnView(state);
  return view === undefined ? "" : state.graph.node(view, "scene").id;
}

/** The head loader's scene targets, shared by startup and its device-free regression tests. */
export function sceneHeadTargets(state: ProfileSessions, services: Pick<ProfileServices, "profiles" | "characters">) {
  return {
    view: () => drawnView(state),
    of: (view: string) => state.graph.has(view) ? state.graph.node(view, "scene").id : undefined,
    has: (scene: string) => state.graph.viewsOf(scene).length > 0,
    // The stored assignment survives deletion. Only a usable V is offered to the renderer; recovery is resolved from the owner status.
    subject: (scene: string) => { const subject = state.knownScene(scene)?.subject;
      return subject?.kind === CHARACTER_KIND && targetPresent(services.characters.targetStatus(subject.id)) ? subject.id : undefined; },
    ensureSubject: (scene: string) => sceneCharacter(state, scene, services),
    subscribe: (listener: () => void) => { const offSession = state.subscribe(listener), offCharacters = services.characters.subscribe(listener);
      return () => { offSession(); offCharacters(); }; },
  };
}

/**
 * The V a scene shows, made only when the scene has no assigned target. An assigned target is never replaced by an ensure path,
 * including while removed, purged, unavailable or recovering. Answers null while that assignment cannot be shown.
 */
export async function sceneCharacter(state: ProfileSessions, scene: string, services: Pick<ProfileServices, "profiles" | "characters">): Promise<string | null> {
  const target = state.knownScene(scene);
  if (!target) return null;
  const shown = target.subject;
  if (shown) return shown.kind === CHARACTER_KIND && targetPresent(services.characters.targetStatus(shown.id)) ? shown.id : null;
  const profile = services.profiles.profile(state.profile);
  const made = await services.characters.create(profile ? { profile: { id: profile.id, base: profile.revision } } : {});
  if (!made.ok) return null;
  state.setSubject(scene, characterRef(made.character));
  return made.character;
}

/**
 * A history scope's name for people (profiles design §3.7: Undo names its editing context): a look's name, a V's label, an experiment
 * document's label, or "View and lighting"; undefined for a scope nothing names.
 */
export function historyScopeName(scope: string, deps: { services: Pick<ProfileServices, "characters" | "collections">; history: Pick<HistoryService, "documents"> }): string | undefined {
  const [kind, ...rest] = scope.split(":"), id = rest.join(":");
  if (kind === "look") { const at = id.indexOf("/"); return deps.services.collections.look({ collection: id.slice(0, at), look: id.slice(at + 1) })?.name; }
  if (kind === "character") { const v = deps.services.characters.character(id); return v ? `V · ${v.label}` : undefined; }
  if (kind === "doc") return deps.history.documents.snapshot(id).documentLabel;
  if (kind === "view") return "View and lighting";
  return undefined;
}

/** History navigation consumes the same recovery facts as bound inspectors, without opening their targets. */
export function historyScopeDetails(scope: string, deps: { services: Pick<ProfileServices, "characters" | "collections">; history: Pick<HistoryService, "documents"> }): import("../../platform/api/history").HistoryScopeDetails {
  const label = historyScopeName(scope, deps);
  if (scope.startsWith("look:")) {
    const key = scope.slice(5), at = key.indexOf("/"), status = deps.services.collections.targetStatus({ collection: key.slice(0, at), look: key.slice(at + 1) });
    return { label: status.label ?? label, status };
  }
  if (scope.startsWith("character:")) {
    const status = deps.services.characters.targetStatus(scope.slice(10));
    return { label: status.label ? `V · ${status.label}` : label, status };
  }
  return { label };
}

/** Only a workspace held by another window waits for that holder to migrate; startup failures show the in-memory session. */
export function profileWorkspaceLease(lease: Pick<import("../workspace/workspace-lease").WorkspaceLease, "snapshot" | "writable">, stored: boolean) {
  const snapshot = lease.snapshot();
  const heldElsewhere = snapshot.phase === "read-only" || snapshot.phase === "taking-over" || snapshot.phase === "waiting";
  return { ...snapshot, migrationPending: !stored && !lease.writable() && heldElsewhere };
}
