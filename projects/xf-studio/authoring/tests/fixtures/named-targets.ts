import { statusWorld } from "./target-status";
/**
 * The input layer for tests that drive the application directly (profiles design §3.6): actions are named with the targets the real
 * resolver (app/profiles/targets.ts) reaches over a fixture session, the way the presentation port names them. The fixture's one scene
 * shows the look its editor document shows (`document.scopeId`) and the V its character context shows, and never changes `gen`.
 *
 * `named(app, targets)` hands back the application with its action entry points naming what they leave out, the history reads following
 * the editing context, and everything else unchanged.
 */
import { CHARACTER_KIND } from "../../src/platform/api/characters";
import { MAIN_VIEW, type ViewId } from "../../src/platform/api/view-graph";
import type { HistoryService } from "../../src/platform/core/history-service";
import type { ViewGraph } from "../../src/platform/core/view-graph";
import type { StudioApplication, StudioAction } from "../../src/app/studio-application";
import type { AuthoringDocument } from "../../src/app/authoring/authoring-document";
import type { LookRef } from "../../src/library/collection-documents";
import { TargetResolver } from "../../src/app/profiles/targets";
import { SceneCommands } from "../../src/app/profiles/scene-commands";
import { nameTargets, type Unnamed } from "../../src/app/action-targets";
import type { PresentationSubject } from "../../src/app/action-consequences";
import type { createTrustedAuthoringCore } from "../../src/app/trusted-authoring-core";

/** The look a look history scope names (`look:<collection>/<look>`). */
export function lookOfScope(scope: string): LookRef | undefined {
  if (!scope.startsWith("look:")) return undefined;
  const id = scope.slice("look:".length), at = id.indexOf("/");
  return at < 0 ? undefined : { collection: id.slice(0, at), look: id.slice(at + 1) };
}

export type FixtureCore = { app: StudioApplication; views: ViewGraph; history: HistoryService; document: Pick<AuthoringDocument, "scopeId"> };

/** A scene double a fixture's collection service follows (fixtures/profile-studio.ts `testScene`). */
export type FixtureScene = { look(): LookRef | undefined; setLook(ref: LookRef | undefined): void };

/**
 * The fixture's resolver and scenes: one tab, the core's views (the main view focused first), one scene per view showing `scene`'s look
 * (else the document's) and the character context's V (`character`, else `local`), every subject and look existing; `scene.setLook`
 * shows a look on `scene` and raises the scene's `gen`. `collection`: the collection a scene without a look names.
 */
export function fixtureTargets(core: FixtureCore, options: { scene?: FixtureScene; character?: () => string | undefined; collection?: () => string | undefined } = {}): TargetResolver {
  let gen = 0;
  const lookNow = () => options.scene ? options.scene.look() : lookOfScope(core.document.scopeId);
  const character = options.character ?? (() => "local");
  const shown = (id: string) => {
    const node = core.views.viewIds().map(view => core.views.node(view, "scene")).find(item => item.id === id);
    if (!node) return undefined;
    const look = lookNow(), v = character();
    return { kind: node.kind ?? "character", ...(v ? { subject: { kind: CHARACTER_KIND, id: v } } : {}), ...(look ? { look } : {}), gen };
  };
  core.app.attach({ scenes: new SceneCommands({
    scene: shown,
    setLook: (_scene, look) => { gen++; options.scene?.setLook(look); },
    setSubject: () => { gen++; },
  }, { look: () => true, subject: () => true }) });
  if (core.history.focus.topView(core.views.viewIds()) === undefined) core.history.focus.focusView(MAIN_VIEW);
  const resolver = new TargetResolver({
    session: {
      tab: () => "t-fixture",
      views: () => core.views.viewIds().map((id: ViewId) => ({ id, scene: core.views.node(id, "scene").id })),
      scene: shown,
      panel: () => undefined,
    },
    focus: core.history.focus,
    acting: scopes => core.history.acting(scopes)?.id,
    status: statusWorld(),
    context: () => ({ kind: "view" }),
    ...(options.collection ? { collection: options.collection } : {}),
  });
  core.app.attach({ targetCheck: resolver });
  return resolver;
}

type App = StudioApplication;
type Action = Unnamed<StudioAction>;
/** The application as the fixture's input layer drives it: its action entry points take actions whose targets it names. */
export type NamedApplication = Omit<App, "dispatch" | "capability" | "contextCapability" | "controlBegin" | "controlEdit" | "featureControlBegin" | "featureControlEdit" | "consequences" |
  "choicesFor" | "actionsFor" | "contextFor" | "contextQuery" | "boundActionCapability" | "dispatchContext" | "beginGesture" | "canBeginGesture"> & {
  dispatch(action: Action): ReturnType<App["dispatch"]>;
  capability(action: Action): ReturnType<App["capability"]>;
  contextCapability(target: Parameters<App["contextCapability"]>[0], action: Action): ReturnType<App["contextCapability"]>;
  controlBegin(id: string, layerId: string): boolean;
  controlEdit(id: string, action: Unnamed<Parameters<App["controlEdit"]>[1]>): ReturnType<App["controlEdit"]>;
  featureControlBegin(feature: string, id: string): boolean;
  featureControlEdit(feature: string, id: string, action: { kind: string }): ReturnType<App["featureControlEdit"]>;
  consequences(subject: PresentationSubject): ReturnType<App["consequences"]>;
  choicesFor(target: Parameters<App["choicesFor"]>[0], kind: StudioAction["kind"], field: string, base?: Record<string, unknown>): ReturnType<App["choicesFor"]>;
  actionsFor(target: Parameters<App["actionsFor"]>[0]): ReturnType<App["actionsFor"]>;
  contextFor(hit: Parameters<App["contextFor"]>[0]): ReturnType<App["contextFor"]>;
  contextQuery(hit: Parameters<App["contextQuery"]>[0]): ReturnType<App["contextQuery"]>;
  boundActionCapability(context: Parameters<App["boundActionCapability"]>[0], action: Action): ReturnType<App["boundActionCapability"]>;
  dispatchContext(context: Parameters<App["dispatchContext"]>[0], action: Action): ReturnType<App["dispatchContext"]>;
  canBeginGesture(source: Parameters<App["canBeginGesture"]>[0], layerId: string): ReturnType<App["canBeginGesture"]>;
  beginGesture(source: Parameters<App["beginGesture"]>[0], layerId: string): ReturnType<App["beginGesture"]>;
};

/** The application with its entry points naming the targets they leave out, as the presentation port does. */
export function named(app: App, targets: TargetResolver): NamedApplication {
  const name = <A extends { kind: string }>(action: A): A => targets.complete(action, app.descriptor(action.kind));
  // A control run captures what it acts on when it begins, as the port's runs do: its edits name that, never a later resolution.
  const runs = new Map<string, ReturnType<TargetResolver["named"]>>();
  const begin = (id: string) => { const named = targets.named(); runs.set(id, named); return named; };
  const nameRun = <A extends { kind: string }>(id: string, action: A): A => nameTargets(action, app.descriptor(action.kind), runs.get(id) ?? targets.named());
  const end = (id: string) => { runs.delete(id); };
  const overrides: Record<string, unknown> = {
    dispatch: (action: StudioAction) => app.dispatch(name(action)),
    capability: (action: StudioAction) => app.capability(name(action)),
    contextCapability: (target: Parameters<App["contextCapability"]>[0], action: StudioAction) => app.contextCapability(target, name(action)),
    controlBegin: (id: string, layerId: string) => app.controlBegin(id, layerId, begin(id).look),
    controlEdit: (id: string, action: Parameters<App["controlEdit"]>[1]) => app.controlEdit(id, nameRun(id, action)),
    controlCommit: (id: string) => { end(id); app.controlCommit(id); },
    controlCancel: (id: string) => { end(id); app.controlCancel(id); },
    featureControlBegin: (feature: string, id: string) => app.featureControlBegin(feature, id, begin(id).look),
    featureControlEdit: (feature: string, id: string, action: { kind: string }) => app.featureControlEdit(feature, id, nameRun(id, action)),
    featureControlCommit: (id: string) => { end(id); app.featureControlCommit(id); },
    featureControlCancel: (id: string) => { end(id); app.featureControlCancel(id); },
    consequences: (subject: Parameters<App["consequences"]>[0]) =>
      app.consequences("action" in subject ? { ...subject, action: name(subject.action) } : subject),
    choicesFor: (target: Parameters<App["choicesFor"]>[0], kind: StudioAction["kind"], field: string, base?: Record<string, unknown>) =>
      app.choicesFor(target, kind, field, base, targets.named()),
    actionsFor: (target: Parameters<App["actionsFor"]>[0]) => app.actionsFor(target, targets.named()),
    contextFor: (hit: Parameters<App["contextFor"]>[0]) => app.contextFor(hit, targets.named()),
    contextQuery: (hit: Parameters<App["contextQuery"]>[0]) => app.contextQuery(hit, targets.named()),
    canBeginGesture: (source: Parameters<App["canBeginGesture"]>[0], layerId: string) => app.canBeginGesture(source, layerId, targets.named().look),
    beginGesture: (source: Parameters<App["beginGesture"]>[0], layerId: string) => app.beginGesture(source, layerId, targets.named().look),
    history: (scope?: string) => app.history(scope ?? targets.editing()),
    historyTimeline: (scope?: string) => app.historyTimeline(scope ?? targets.editing()),
  };
  return new Proxy(app, {
    get(target, key) {
      if (typeof key === "string" && Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as NamedApplication;
}

/** A fixture core's application, naming its targets through the fixture resolver. */
/** `application`: the trusted application itself, for wiring a presentation port (which names targets through `targets`). */
export function namedCore<C extends FixtureCore>(core: C, options?: Parameters<typeof fixtureTargets>[1]): Omit<C, "app"> & { app: NamedApplication;
  application: StudioApplication; targets: TargetResolver } {
  const targets = fixtureTargets(core, options);
  return { ...core, app: named(core.app, targets), application: core.app, targets };
}
export type TestAction = Unnamed<StudioAction>;
/** A trusted core whose application names its targets (`namedCore` over `createTrustedAuthoringCore`). */
export type NamedTrustedCore = Omit<ReturnType<typeof createTrustedAuthoringCore>, "app"> & { app: NamedApplication; application: StudioApplication;
  targets: TargetResolver };
