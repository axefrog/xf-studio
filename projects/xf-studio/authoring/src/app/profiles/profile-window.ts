/**
 * A window's profile services (profiles design §1.1, §7; phase 1): the owners every document reaches the library through (the outbox), and
 * the session the window opens on. The composition root builds them once and shares them; nothing here holds a current V, look or view.
 *
 * - **Owners.** Profiles (`ProfileService`), Vs (`CharacterService`, one context per V a scene shows), collections and looks
 *   (`CollectionOwner`, and `LookSessions` per look shown or edited). Each loads what the library holds before the window shows anything.
 * - **The session** is the workspace's (`profiles.sessions`, made by the profiles migration), held by `ProfileSessions`, the one owner of
 *   its tabs, view graph and focus. A window that has none to open (another window holds an unmigrated workspace, or the workspace can't be
 *   written) opens a session made for it from the library's first profile, stored nowhere.
 * - **What a scene shows** must exist: a scene whose V was deleted gets a new default V (listed in the profile), so the 3D view always has
 *   one to show.
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
import { MAIN_VIEW, type ViewGraphData } from "../../platform/api/view-graph";
import { documentKey } from "../../platform/api/document-commands";
import { CHARACTER_KIND } from "../../platform/api/characters";
import type { ViewGraph, ViewGraphOwner } from "../../platform/core/view-graph";
import { CHARACTER_DOCUMENT } from "../../character/character-document";
import { LOOK_WORKING, lookRef as lookDocument } from "../../library/collection-documents";
import type { PanelContext } from "./bindings";
import { TargetResolver } from "./targets";
import { SceneCommands } from "./scene-commands";
import type { WorkspaceState } from "../workspace/workspace-state";
import { ProfileService } from "./profile-service";
import { ProfileSessions, type TabAction } from "./profile-sessions";
import type { DockLayout, UIPreferenceActions } from "../ui-preferences";
import type { ProfileSessionData } from "./profile-session";
import { FIRST_TAB_NAME, sessionOfWorkspace } from "./profiles-migration-data";
import { LayoutDefaults, type ContributedLayoutDefault } from "./layout-defaults";
import type { FragmentKnowledge, SceneCandidate, SubstitutionContext } from "./layout-fragment";
import { TabDefaults } from "./tab-defaults";

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
  history: HistoryService; versions?: CollectionVersionsPort; report?: (error: unknown) => void;
  /** The modules' default layouts and what the build has (`compose/layout-defaults.ts`). */
  layouts?: { contributed: readonly ContributedLayoutDefault[]; known: FragmentKnowledge } }): ProfileServices {
  const profiles = new ProfileService({ documents: deps.documents, outbox: deps.outbox, subjects: deps.subjects });
  const characters = new CharacterService({ documents: deps.documents, outbox: deps.outbox, catalogue: deps.catalogue, history: deps.history, profiles,
    ...(deps.report ? { report: deps.report } : {}) });
  const collections = new CollectionOwner({ documents: deps.documents, outbox: deps.outbox, ...(deps.versions ? { versions: deps.versions } : {}),
    ...(deps.report ? { report: deps.report } : {}) });
  const looks = new LookSessions(collections, deps.outbox);
  const defaults = new LayoutDefaults({ documents: deps.documents, outbox: deps.outbox, ...(deps.layouts ? { contributed: deps.layouts.contributed, known: deps.layouts.known } : {}) });
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
    drawn?(): string | undefined },
  random: () => number = hostRandom().next): { state: ProfileSessions; stored: boolean } {
  const open = (profile: string, data: ProfileSessionData) =>
    new ProfileSessions({ profile, data, history: deps.history, graph: deps.graph, ...(deps.stored ? { stored: deps.stored } : {}),
      ...(deps.drawn ? { drawn: deps.drawn } : {}), random });
  const sessions = workspace.profiles?.sessions ?? {}, first = Object.keys(sessions)[0];
  if (workspace.migration?.state === "done" && first) return { state: open(first, sessions[first]!), stored: true };
  const profile = services.profiles.list()[0];
  const character = profile?.subjects.find(subject => subject.kind === "character")?.id;
  const collection = profile?.collections.map(id => services.collections.collection(id)).find(view => view?.looks.length);
  const look: LookRef | undefined = collection ? { collection: collection.id, look: collection.looks[0]! } : undefined;
  const session = sessionOfWorkspace(workspace, { tab: FIRST_TAB_NAME, ...(character ? { character } : {}), ...(look ? { look } : {}) }, random);
  return { state: open(profile?.id ?? "", session), stored: false };
}

/**
 * Until the tab strip (P2-iv) has the dock save straight to `tabs.arrange`, the dock saves through `layout.set` (the Layouts button reads
 * it) and this passes each save on to the shown tab (`arrange`, the `tabs.arrange` action). Only a change of the preference's arrangement
 * itself is a save, compared by value (a snapshot is a copy, and another preference changing is no save). An arrangement the session makes
 * for the shown tab otherwise (`tabs.arrange` from elsewhere, another tab shown, a reset) becomes the preference's, so the relay never
 * passes a stale one on. Returns the unsubscribe.
 */
export function relayDockSaves(preferences: Pick<UIPreferenceActions, "snapshot" | "subscribe" | "dispatch">, session: ProfileSessions,
  arrange: (action: Extract<TabAction, { kind: "tabs.arrange" }>) => void): () => void {
  const same = (a: DockLayout | null, b: DockLayout | null) => JSON.stringify(a) === JSON.stringify(b);
  /** The arrangement the preference and the shown tab last agreed on. */
  let relayed: DockLayout | null = preferences.snapshot().layout ?? null;
  const fromDock = preferences.subscribe(() => {
    const layout = preferences.snapshot().layout ?? null, tab = session.tabId();
    if (same(layout, relayed)) return;
    relayed = layout;
    if (tab && !same(layout, session.dock(tab))) arrange({ kind: "tabs.arrange", tab, layout });
  });
  const fromSession = session.subscribe(() => {
    const tab = session.tabId();
    if (!tab) return;
    const layout = session.dock(tab);
    if (same(layout, relayed)) return;
    relayed = layout;
    preferences.dispatch({ kind: "layout.set", ...(layout ? { layout } : {}) });
  });
  return () => { fromDock(); fromSession(); };
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
  services: Pick<ProfileServices, "characters" | "collections" | "looks">; contexts: (type: string) => PanelContext; collection?: () => string | undefined }): TargetResolver {
  const { state, services } = deps, graph = state.graph;
  return new TargetResolver({
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
    exists: {
      subject: ref => ref.kind === CHARACTER_KIND ? !!services.characters.document(ref.id) : false,
      look: ref => services.collections.look(ref)?.state === "live",
    },
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

/** The scene the window draws first: the main view's, else the first view's (empty: a session with no view). */
export function drawnScene(state: ProfileSessions): string {
  const graph = state.graph, view = graph.has(MAIN_VIEW) ? MAIN_VIEW : graph.viewIds()[0];
  return view === undefined ? "" : graph.node(view, "scene").id;
}

/**
 * The V a scene shows, made when it has none (or its V was deleted): a new default V, listed in the session's profile, shown on the scene.
 * Answers its ID (null when no V could be made: this window may not write).
 */
export async function sceneCharacter(state: ProfileSessions, scene: string, services: Pick<ProfileServices, "profiles" | "characters">): Promise<string | null> {
  const shown = state.scene(scene).subject;
  if (shown?.kind === "character" && services.characters.document(shown.id)) return shown.id;
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
