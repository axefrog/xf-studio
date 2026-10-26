import { createTrustedAuthoringCore, type StudioComposition } from "../trusted-authoring-core";
import { authoringAttachment } from "../authoring/authoring-attachment";
import { LookEditContexts, type LookEditHandle } from "../../library/look-edit-contexts";
import { NO_LOOK_SCOPE, REMOVED_LOOK } from "../../library/look-editor";
import { sameLook, type LookRef } from "../../library/collection-documents";
import { emptyRecipe } from "../../engines/layered-makeup/recipe";
import { emptyLookHistory } from "../../platform/core/look-history";

type Factory = typeof createTrustedAuthoringCore;
type Core = ReturnType<Factory>;

/** The phase-2 root input now follows an explicitly drawn context; all editable documents live in the keyed owner. */
export function createProfileAuthoring(workspace: Parameters<Factory>[0], ports: Parameters<Factory>[1], composition: StudioComposition,
  deps: Omit<ConstructorParameters<typeof LookEditContexts>[0], "core" | "workspace" | "composition" | "resetStack" | "shown"> & { shown?(): void }) {
  const base = createTrustedAuthoringCore({ ...workspace, recipe: emptyRecipe(), active: 0, selected: 0, fieldSelection: {},
    history: emptyLookHistory(), liveFeatures: undefined, liveLocked: undefined }, { ...ports, scope: NO_LOOK_SCOPE, activate: false }, composition);
  base.document.setBlocked(REMOVED_LOOK);
  let handle: LookEditHandle | undefined, life: AbortController | undefined;
  let current: Pick<Core, "document" | "geometry" | "presentation" | "recipe" | "eyeMakeup" | "gestures" | "controls" | "app"> = base;
  let compatibility: Core["app"] | undefined;
  const contexts = new LookEditContexts({ ...deps, core: base, workspace, composition,
    shown: ref => { if (handle && sameLook(ref, handle.context.ref)) deps.shown?.(); },
    resetStack: (ref, previous) => { if (handle && sameLook(ref, handle.context.ref)) ports.resetStack(previous); } });
  const document = authoringAttachment(() => current.document, { subscribe: ["restore"], subscribeEffects: undefined, onReplacing: undefined });
  const presentation = authoringAttachment(() => current.presentation, { subscribe: ["restore"] });
  const application = authoringAttachment(() => current.app, { subscribe: [] });
  // Attach belongs to composition and is shared with keyed contexts. Collection/file/character overrides remain bound locally.
  const app = new Proxy(application.port, { get(target, key) {
    if (key === "attach") return base.app.attach.bind(base.app);
    if (key === "setPreviewUnavailable") return base.app.setPreviewUnavailable.bind(base.app);
    return Reflect.get(target, key);
  } });
  const core: Core = { ...base, document: document.port, presentation: presentation.port, app,
    geometry: authoringAttachment(() => current.geometry).port, recipe: authoringAttachment(() => current.recipe).port,
    eyeMakeup: authoringAttachment(() => current.eyeMakeup).port, gestures: authoringAttachment(() => current.gestures).port,
    controls: authoringAttachment(() => current.controls).port };
  const drawn = {
    ref: () => handle ? { ...handle.context.ref } : undefined,
    show(ref: LookRef | undefined): boolean {
      if (ref && handle && sameLook(ref, handle.context.ref)) return true;
      if (!ref && !handle) return true;
      const nextLife = new AbortController();
      let next: LookEditHandle | undefined;
      try { if (ref) next = contexts.acquire(ref, nextLife.signal); }
      catch (error) { nextLife.abort(); deps.report?.(error); return false; }
      if (ref && !next) { nextLife.abort(); return false; }
      current.app.settleEdits(); contexts.commit(); document.changing();
      const oldLife = life, oldCompatibility = compatibility;
      handle = next; life = nextLife;
      // Only this facade follows the root's collection/files and shown V. It shares the look's in-progress edits, never a writer.
      compatibility = next ? base.app.fork({ document: next.context.document, eyeMakeup: next.context.eyeMakeup,
        gestures: next.context.gestures, controls: next.context.controls }, next.context.app) : undefined;
      current = next ? { ...next.context, app: compatibility! } : base;
      document.changed(); presentation.changed(); application.changed();
      oldCompatibility?.dispose(); oldLife?.abort();
      deps.shown?.();
      return true;
    },
    commit: () => contexts.commit(),
    dispose() {
      current.app.settleEdits(); contexts.commit();
      document.dispose(); presentation.dispose(); application.dispose();
      compatibility?.dispose(); life?.abort(); contexts.dispose(); base.app.dispose(); base.document.dispose();
    },
  };
  return { core, contexts, drawn, empty: base };
}
