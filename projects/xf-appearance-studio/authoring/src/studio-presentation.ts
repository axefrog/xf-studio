import type { CollectionViewPort } from "./collection-application";
import type { ReadonlyDeep } from "./read-only";
import type { StudioApplication } from "./studio-application";
import type { StudioFileOperations } from "./studio-file-operations";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";

/** The complete current UI entry point. Construct it only in the trusted composition root. */
export type StudioPresentationPort<Slot> = {
  readonly authoring: Pick<StudioApplication,
    "actionKinds" | "requestKinds" | "actionDescriptors" | "requestDescriptors" |
    "gestureDescriptors" | "descriptorsFor" | "targetCapability" | "contextCapability" |
    "choicesFor" | "contextFor" | "contextOptionsFor" | "contextQuery" |
    "boundActionCapability" | "dispatchContext" | "capability" | "actionsFor" | "dispatch" |
    "controlBegin" | "controlEdit" | "controlCommit" | "controlCancel" |
    "requestCapability" | "execute" | "canBeginGesture" | "gestureCapability" |
    "beginGesture" | "applyGesture" | "endGesture"> & {
      snapshot(): ReadonlyDeep<ReturnType<StudioApplication["snapshot"]>>;
    };
  readonly library: CollectionViewPort;
  readonly files: Pick<StudioFileOperations, "capability" | "execute"> & {
    snapshot(): ReadonlyDeep<ReturnType<StudioFileOperations["snapshot"]>>;
  };
  readonly viewport: Pick<ViewportAttachment<Slot>, "attach" | "rehost" |
    "resize" | "cancelInput" | "uvCommandCapability" | "uvCommand" | "contextAt"> & {
      snapshot(): ReadonlyDeep<ReturnType<ViewportAttachment<Slot>["snapshot"]>>;
    };
  readonly preferences: Pick<UIPreferenceActions, "capability" | "dispatch"> & {
    snapshot(): ReadonlyDeep<ReturnType<UIPreferenceActions["snapshot"]>>;
  };
  snapshot(): ReadonlyDeep<{
    authoring: ReturnType<StudioApplication["snapshot"]>;
    library: ReturnType<CollectionViewPort["view"]>;
    files: ReturnType<StudioFileOperations["snapshot"]>;
    viewport: ReturnType<ViewportAttachment<Slot>["snapshot"]>;
    preferences: ReturnType<UIPreferenceActions["snapshot"]>;
  }>;
  subscribe(listener: () => void): () => void;
};

/** Method wrappers prevent a presentation consumer from receiving trusted service objects. */
export function createStudioPresentation<Slot>(sources: {
  authoring: StudioApplication;
  library: CollectionViewPort;
  files: StudioFileOperations;
  viewport: ViewportAttachment<Slot>;
  preferences: UIPreferenceActions;
}): StudioPresentationPort<Slot> {
  const a = sources.authoring, l = sources.library, f = sources.files,
    v = sources.viewport, p = sources.preferences;
  const authoring: StudioPresentationPort<Slot>["authoring"] = {
    snapshot: () => a.snapshot(), actionKinds: () => a.actionKinds(),
    requestKinds: () => a.requestKinds(), actionDescriptors: () => a.actionDescriptors(),
    requestDescriptors: () => a.requestDescriptors(), gestureDescriptors: () => a.gestureDescriptors(),
    descriptorsFor: target => a.descriptorsFor(target),
    targetCapability: target => a.targetCapability(target),
    contextCapability: (target, action) => a.contextCapability(target, action),
    choicesFor: (target, kind, field, base) => a.choicesFor(target, kind, field, base),
    contextFor: hit => a.contextFor(hit),
    contextOptionsFor: context => a.contextOptionsFor(context),
    contextQuery: hit => a.contextQuery(hit),
    boundActionCapability: (context, action) => a.boundActionCapability(context, action),
    dispatchContext: (context, action) => a.dispatchContext(context, action),
    capability: action => a.capability(action), actionsFor: target => a.actionsFor(target),
    dispatch: action => a.dispatch(action),
    controlBegin: (id, layerId) => a.controlBegin(id, layerId),
    controlEdit: (id, action) => a.controlEdit(id, action),
    controlCommit: id => a.controlCommit(id), controlCancel: id => a.controlCancel(id),
    requestCapability: request => a.requestCapability(request), execute: request => a.execute(request),
    canBeginGesture: (source, layerId) => a.canBeginGesture(source, layerId),
    gestureCapability: (source, target) => a.gestureCapability(source, target),
    beginGesture: (source, layerId) => a.beginGesture(source, layerId),
    applyGesture: (source, proposal) => a.applyGesture(source, proposal),
    endGesture: (source, cancel) => a.endGesture(source, cancel),
  };
  const library: CollectionViewPort = {
    view: () => l.view(), subscribe: listener => l.subscribe(listener),
    capability: action => l.capability(action), dispatch: action => l.dispatch(action),
    fileCapability: action => l.fileCapability(action), fileExecute: action => l.fileExecute(action),
    execute: request => l.execute(request), currentLayerCount: () => l.currentLayerCount(),
  };
  const files: StudioPresentationPort<Slot>["files"] = {
    snapshot: () => f.snapshot(), capability: action => f.capability(action),
    execute: action => f.execute(action),
  };
  const viewport: StudioPresentationPort<Slot>["viewport"] = {
    snapshot: () => v.snapshot(), attach: (kind, slot) => v.attach(kind, slot),
    rehost: (kind, slot) => v.rehost(kind, slot), resize: kind => v.resize(kind),
    cancelInput: kind => v.cancelInput(kind),
    uvCommandCapability: command => v.uvCommandCapability(command),
    uvCommand: command => v.uvCommand(command),
    contextAt: (kind, x, y) => v.contextAt(kind, x, y),
  };
  const preferences: StudioPresentationPort<Slot>["preferences"] = {
    snapshot: () => p.snapshot(), capability: action => p.capability(action),
    dispatch: action => p.dispatch(action),
  };
  return Object.freeze({ authoring: Object.freeze(authoring), library: Object.freeze(library),
    files: Object.freeze(files), viewport: Object.freeze(viewport), preferences: Object.freeze(preferences),
    snapshot: () => ({ authoring: a.snapshot(), library: l.view(), files: f.snapshot(),
      viewport: v.snapshot(), preferences: p.snapshot() }),
    subscribe(listener: () => void) {
      const unsubs = [a.subscribe(listener), l.subscribe(listener), f.subscribe(listener),
        v.subscribe(listener), p.subscribe(listener)];
      return () => { for (const unsubscribe of unsubs) unsubscribe(); };
    },
  });
}
