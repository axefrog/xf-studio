import type { FeatureEditor, ModuleRegistration } from "../platform/api";
import { createViewServices } from "./view-actions";
import { AuthoringDocument, type DocumentState } from "./authoring/authoring-document";
import type { DocumentModel } from "./workspace/collection-workspace";
import type { AnyOwner, Registry } from "../platform/core/registry";
import { LiveFeatures } from "../platform/core/live-features";
import { createHistoryService, type HistoryService } from "../platform/core/history-service";
import type { ViewGraph } from "../platform/core/view-graph";
import { StudioApplication } from "./studio-application";
import type { Recipe } from "../engines/layered-makeup/recipe";
import type { LayeredMakeupRegion } from "../engines/layered-makeup/region";
import type { WorkspaceState } from "./workspace/workspace-state";
import { createAuthoringProjections } from "./authoring/feature-projections";

/** The existing action and part registrations; editing does not require a primary feature or region. */
export type EditingComposition = { readonly registry: Registry<AnyOwner>; readonly documents: DocumentModel };
/** Optional product metadata does not participate in neutral editor construction. */
export type StudioComposition = EditingComposition & { readonly region?: LayeredMakeupRegion; readonly modules?: ModuleRegistration };

export type AuthoringEditing = ReturnType<typeof createAuthoringEditing>;
/** One authoritative look and the opaque editors supplied by its registered features. No application or renderer. */
export function createAuthoringEditing(state: DocumentState, ports: {
  signal: AbortSignal; history: HistoryService; scope?: string; activate?: boolean;
  look?: { readonly collection: string; readonly look: string };
  memory?: Readonly<Record<string, unknown>>; key?(): string; newId?(): string;
}, composition: EditingComposition) {
  const life = new AbortController();
  const abort = () => life.abort();
  if (ports.signal.aborted) abort();
  else ports.signal.addEventListener("abort", abort, { once: true });
  life.signal.addEventListener("abort", () => ports.signal.removeEventListener("abort", abort), { once: true });
  try {
    const features = new LiveFeatures(composition.documents.parts.features().map(id => composition.documents.parts.feature(id)!));
    const document = new AuthoringDocument(state, { features, parts: composition.documents.parts }, { ...ports, signal: life.signal });
    const look = Object.freeze({ ...(ports.look ?? { collection: "local", look: "local" }) });
    const editors = new Map<string, FeatureEditor>();
    for (const id of features.features()) {
      const factory = composition.documents.parts.feature(id)!.createEditor;
      if (!factory) continue;
      const alive = () => { if (life.signal.aborted) throw Error("This look's editing context has ended."); };
      const primary = features.document(id)!, owner = composition.registry.owner(id);
      const editor = factory({ look, scope: document.scopeId, signal: life.signal,
        editing: {
          state() { alive(); return primary.state(); }, set(part, editor, partChanged) { alive(); primary.set(part, editor, partChanged); },
          changed() { alive(); document.changed([id]); }, get history() { alive(); return document.history; },
          action(kind) { const route = composition.registry.route(kind); if (!route.ok || route.owner.id !== id) throw Error(`${kind} is not an action of ${id}.`); return route.spec; },
          gestures: owner?.owner === "feature" ? owner.gestures : undefined,
          memory: ports.memory?.[id], key: ports.key ?? (() => look.look), newId: ports.newId ?? (() => crypto.randomUUID()),
          onReplacing(listener) { alive(); const off = document.onReplacing(listener); life.signal.addEventListener("abort", off, { once: true }); },
          observeReplay(replay) { alive(); primary.observeReplay(replay, life.signal); },
        },
        snapshot() { alive(); const state = features.document(id)!.export(); return { part: state.part, editor: state.editor }; },
        subscribe(listener) {
          alive();
          const off = document.subscribe((change, details) => {
            if (change === "restore" || change === "part" && details?.features.includes(id)) listener();
          });
          life.signal.addEventListener("abort", off, { once: true });
        } });
      alive(); editors.set(id, editor);
    }
    return { document, lookDocument: document, editors: editors as ReadonlyMap<string, FeatureEditor>, signal: life.signal };
  } catch (error) { life.abort(); throw error; }
}

/** Trusted application composition with the remaining geometry/view projection over registered editing services. */
export function createTrustedAuthoringCore(workspace: WorkspaceState, ports: {
  resetStack?(previous: Recipe): void; selectedCollection(): string; newId?(): string;
  history?: HistoryService; scope?: string; activate?: boolean; views?: ViewGraph;
}, composition: StudioComposition) {
  const history = ports.history ?? createHistoryService(), life = new AbortController();
  const editing = createAuthoringEditing({ features: workspace.liveFeatures, history: workspace.history, locked: workspace.liveLocked },
    { ...ports, history, signal: life.signal, memory: workspace.featureMemory, key: ports.selectedCollection }, composition);
  try {
    const { projections, services } = createAuthoringProjections(editing, { ...ports, release: () => life.abort() }, composition);
    const { views, viewActions } = createViewServices(workspace.preview, workspace.views, composition.modules, history, ports.views);
    const app = new StudioApplication({ document: editing.document, ...services, signal: editing.signal, history, views, viewActions,
      ...(ports.newId ? { newId: ports.newId } : {}) }, composition.registry);
    return { ...editing, projections, projectionServices: services, app, history, documents: composition.documents, views, dispose: () => life.abort() };
  } catch (error) { life.abort(); throw error; }
}
