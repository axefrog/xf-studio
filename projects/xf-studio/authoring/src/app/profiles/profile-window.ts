/**
 * A window's profile services (profiles design §1.1, §7; phase 1): the owners every document reaches the library through (the outbox), and
 * the session the window opens on. The composition root builds them once and shares them; nothing here holds a current V, look or view.
 *
 * - **Owners.** Profiles (`ProfileService`), Vs (`CharacterService`, one context per V a scene shows), collections and looks
 *   (`CollectionOwner`, and `LookSessions` per look shown or edited). Each loads what the library holds before the window shows anything.
 * - **The session** is the workspace's (`profiles.sessions`, made by the profiles migration). A window that has none to open (another
 *   window holds an unmigrated workspace, or the workspace can't be written) opens a session made for it from the library's first profile,
 *   stored nowhere.
 * - **What a scene shows** must exist: a scene whose V was deleted gets a new default V (listed in the profile), so the 3D view always has
 *   one to show.
 */
import type { SubjectRegistryPort } from "../../platform/api/subjects";
import { characterRef } from "../../platform/api/characters";
import type { DocumentStorePort } from "../../platform/api/document-store";
import type { DocumentOutbox } from "../../platform/core/document-outbox";
import type { HistoryService } from "../../platform/core/history-service";
import { CharacterService } from "../../character/character-service";
import type { CreatorCatalogue } from "../../character/creator-catalogue";
import { CollectionOwner, type CollectionVersionsPort } from "../../library/collection-owner";
import { LookSessions } from "../../library/look-sessions";
import type { LookRef } from "../../library/collection-documents";
import { MAIN_VIEW } from "../../platform/api/view-graph";
import { documentKey } from "../../platform/api/document-commands";
import { CHARACTER_KIND } from "../../platform/api/characters";
import type { FocusService } from "../../platform/core/focus";
import type { ViewGraph } from "../../platform/core/view-graph";
import { CHARACTER_DOCUMENT } from "../../character/character-document";
import { LOOK_WORKING, lookRef as lookDocument } from "../../library/collection-documents";
import type { PanelContext } from "./bindings";
import { TargetResolver } from "./targets";
import { SceneCommands } from "./scene-commands";
import type { WorkspaceState } from "../workspace/workspace-state";
import { ProfileService } from "./profile-service";
import { ProfileSessionState } from "./profile-session-state";
import { FIRST_TAB_NAME, sessionOfWorkspace } from "./profiles-migration-data";

export type ProfileServices = {
  readonly profiles: ProfileService;
  readonly characters: CharacterService;
  readonly collections: CollectionOwner;
  readonly looks: LookSessions;
  /** Reads what the library holds into every owner. */
  load(signal?: AbortSignal): Promise<void>;
};

export function createProfileServices(deps: { documents: DocumentStorePort; outbox: DocumentOutbox; subjects: SubjectRegistryPort; catalogue: CreatorCatalogue;
  history: HistoryService; versions?: CollectionVersionsPort; report?: (error: unknown) => void }): ProfileServices {
  const profiles = new ProfileService({ documents: deps.documents, outbox: deps.outbox, subjects: deps.subjects });
  const characters = new CharacterService({ documents: deps.documents, outbox: deps.outbox, catalogue: deps.catalogue, history: deps.history, profiles,
    ...(deps.report ? { report: deps.report } : {}) });
  const collections = new CollectionOwner({ documents: deps.documents, outbox: deps.outbox, ...(deps.versions ? { versions: deps.versions } : {}),
    ...(deps.report ? { report: deps.report } : {}) });
  const looks = new LookSessions(collections, deps.outbox);
  return { profiles, characters, collections, looks,
    load: async signal => { await Promise.all([profiles.load(signal), characters.load(signal), collections.load(signal)]); } };
}

/**
 * The session this window opens on: the workspace's (its first profile's, phase 1 opening one profile), else one made from the library's
 * first profile (its first V and its first collection's first look), stored nowhere (`stored` false).
 */
export function openProfileSession(workspace: WorkspaceState, services: Pick<ProfileServices, "profiles" | "collections">,
  focus: FocusService, random: () => number = Math.random): { state: ProfileSessionState; stored: boolean } {
  const sessions = workspace.profiles?.sessions ?? {}, first = Object.keys(sessions)[0];
  if (workspace.migration?.state === "done" && first) return { state: new ProfileSessionState(first, sessions[first]!, random, focus), stored: true };
  const profile = services.profiles.list()[0];
  const character = profile?.subjects.find(subject => subject.kind === "character")?.id;
  const collection = profile?.collections.map(id => services.collections.collection(id)).find(view => view?.looks.length);
  const look: LookRef | undefined = collection ? { collection: collection.id, look: collection.looks[0]! } : undefined;
  const session = sessionOfWorkspace(workspace, { tab: FIRST_TAB_NAME, ...(character ? { character } : {}), ...(look ? { look } : {}) }, random);
  return { state: new ProfileSessionState(profile?.id ?? "", session, random, focus), stored: false };
}

/** `scene.setLook` and `scene.setSubject` over the session's scenes, checking that a look or V still exists (profiles design §3.6). */
export function sceneCommands(state: ProfileSessionState, services: Pick<ProfileServices, "characters" | "collections">): SceneCommands {
  return new SceneCommands({ scene: id => state.knownScene(id), setLook: (scene, look) => state.setLook(scene, look), setSubject: (scene, subject) => state.setSubject(scene, subject) },
    { look: ref => services.collections.look(ref)?.state === "live", subject: ref => ref.kind === CHARACTER_KIND && !!services.characters.document(ref.id) });
}

/**
 * The window's input-layer resolution (app/profiles/targets.ts) over its session, view graph, focus and owners: what each panel, key
 * binding and palette command acts on, and the captures gestures and menus hold. `contexts`: each panel type's context (§3.1, §5).
 */
export function createTargetResolver(deps: { state: ProfileSessionState; graph: ViewGraph; history: Pick<HistoryService, "acting">;
  services: Pick<ProfileServices, "characters" | "collections" | "looks">; contexts: (type: string) => PanelContext; collection?: () => string | undefined }): TargetResolver {
  const { state, graph, services } = deps;
  return new TargetResolver({
    session: {
      tab: () => state.tabId(),
      views: () => graph.viewIds().map(id => ({ id, scene: graph.node(id, "scene").id })),
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

/** The main view's scene in a session's graph (the drawn view, phase 1). */
export function drawnScene(state: ProfileSessionState): string {
  const graph = state.graph();
  return (graph.views.find(view => view.id === MAIN_VIEW) as { scene?: string } | undefined)?.scene ?? graph.scenes[0]?.id ?? "";
}

/**
 * The V a scene shows, made when it has none (or its V was deleted): a new default V, listed in the session's profile, shown on the scene.
 * Answers its ID (null when no V could be made: this window may not write).
 */
export async function sceneCharacter(state: ProfileSessionState, scene: string, services: Pick<ProfileServices, "profiles" | "characters">): Promise<string | null> {
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
