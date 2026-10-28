import { createTrustedAuthoringCore, type StudioComposition } from "../trusted-authoring-core";
import { authoringAttachment } from "../authoring/authoring-attachment";
import { LookEditContexts, type LookEditHandle, type LookEditContextDeps } from "../../library/look-edit-contexts";
import { NO_LOOK_SCOPE, REMOVED_LOOK } from "../../library/look-editor";
import { createAuthoringProjections, followAuthoringProjections } from "../authoring/feature-projections";
import { sameLook, type LookRef } from "../../library/collection-documents";
import { emptyLookHistory } from "../../platform/core/look-history";

type Factory = typeof createTrustedAuthoringCore;
type Core = ReturnType<Factory>;
type Attachment = Pick<Core, "projections" | "projectionServices" | "app">;
export type ProfileLookEditContexts = LookEditContexts<Attachment>;

/** The phase-2 root input now follows an explicitly drawn context; all editable documents live in the keyed owner. */
export function createProfileAuthoring(workspace: Parameters<Factory>[0], ports: Parameters<Factory>[1], composition: StudioComposition,
  deps: Omit<LookEditContextDeps<Attachment>, "history" | "composition" | "attach" | "shown"> & { shown?(): void }) {
  const base = createTrustedAuthoringCore({ ...workspace,
    history: emptyLookHistory(), liveFeatures: undefined, liveLocked: undefined }, { ...ports, scope: NO_LOOK_SCOPE, activate: false }, composition);
  base.document.setBlocked(REMOVED_LOOK);
  let handle: LookEditHandle<Attachment> | undefined, life: AbortController | undefined;
  let current: Pick<Core, "document" | "lookDocument" | "projections" | "projectionServices" | "app"> = base;
  let compatibility: Core["app"] | undefined;
  const contexts = new LookEditContexts<Attachment>({ ...deps, memory: workspace.featureMemory, newId: ports.newId, history: base.history, composition,
    attach: (editing, ref) => {
      const { projections, services } = createAuthoringProjections(editing, { ...ports,
        resetStack: previous => { if (handle && sameLook(ref, handle.context.ref)) ports.resetStack?.(previous); } }, composition);
      const app = base.app.fork({ document: editing.document, ...services, collection: undefined, files: undefined,
        characterContext: undefined, characterDetails: undefined, savedV: undefined });
      editing.signal.addEventListener("abort", () => app.dispose(), { once: true });
      return { projections, projectionServices: services, app };
    },
    shown: ref => { if (handle && sameLook(ref, handle.context.ref)) deps.shown?.(); } });
  const document = authoringAttachment(() => current.document, { subscribe: ["restore"], onReplacing: undefined });
  const projected = followAuthoringProjections(base.projections, () => current.projections, composition);
  const application = authoringAttachment(() => current.app, { subscribe: [] });
  // Attach belongs to composition and is shared with keyed contexts. Collection/file/character overrides remain bound locally.
  const app = new Proxy(application.port, { get(target, key) {
    if (key === "attach") return base.app.attach.bind(base.app);
    if (key === "setPreviewUnavailable") return base.app.setPreviewUnavailable.bind(base.app);
    return Reflect.get(target, key);
  } });
  const core: Core = { ...base, document: document.port, lookDocument: document.port, projections: projected.projections, app };
  const drawn = {
    ref: () => handle ? { ...handle.context.ref } : undefined,
    show(ref: LookRef | undefined): boolean {
      if (ref && handle && sameLook(ref, handle.context.ref)) return true;
      if (!ref && !handle) return true;
      const nextLife = new AbortController();
      let next: LookEditHandle<Attachment> | undefined;
      try { if (ref) next = contexts.acquire(ref, nextLife.signal); }
      catch (error) { nextLife.abort(); deps.report?.(error); return false; }
      if (ref && !next) { nextLife.abort(); return false; }
      current.app.settleEdits(); contexts.commit(); document.changing(); projected.changing();
      const oldLife = life, oldCompatibility = compatibility;
      handle = next; life = nextLife;
      // Only this facade follows the root's collection/files and shown V. It shares the look's in-progress edits, never a writer.
      compatibility = next ? base.app.fork({ document: next.context.document, ...next.context.projectionServices }, next.context.app) : undefined;
      current = next ? { ...next.context, app: compatibility! } : base;
      document.changed(); projected.changed(); application.changed();
      oldCompatibility?.dispose(); oldLife?.abort();
      deps.shown?.();
      return true;
    },
    commit: () => contexts.commit(),
    dispose() {
      current.app.settleEdits(); contexts.commit();
      document.dispose(); projected.dispose(); application.dispose();
      compatibility?.dispose(); life?.abort(); contexts.dispose(); base.app.dispose(); base.dispose();
    },
  };
  return { core, contexts, drawn, empty: base };
}
