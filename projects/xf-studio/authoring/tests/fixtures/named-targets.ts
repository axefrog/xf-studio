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

/** The look a look history scope names (`look:<collection>/<look>`). */
export function lookOfScope(scope: string): LookRef | undefined {
  if (!scope.startsWith("look:")) return undefined;
  const id = scope.slice("look:".length), at = id.indexOf("/");
  return at < 0 ? undefined : { collection: id.slice(0, at), look: id.slice(at + 1) };
}

export type FixtureCore = { app: StudioApplication; views: ViewGraph; history: HistoryService; document: Pick<AuthoringDocument, "scopeId"> };

/**
 * The fixture's resolver: one tab, the core's views (the main view focused first), one scene per view showing the document's look and
 * the character context's V, every subject and look existing. `collection`: the collection a scene without a look names.
 */
export function fixtureTargets(core: FixtureCore, options: { character?: () => string | undefined; collection?: () => string | undefined } = {}): TargetResolver {
  core.app.attach({ scenes: { gen: () => 0 } });
  if (core.history.focus.topView(core.views.viewIds()) === undefined) core.history.focus.focusView(MAIN_VIEW);
  const character = options.character ?? (() => "local");
  return new TargetResolver({
    session: {
      tab: () => "t-fixture",
      views: () => core.views.viewIds().map((id: ViewId) => ({ id, scene: core.views.node(id, "scene").id })),
      scene: id => {
        const node = core.views.viewIds().map(view => core.views.node(view, "scene")).find(item => item.id === id);
        if (!node) return undefined;
        const look = lookOfScope(core.document.scopeId), v = character();
        return { kind: node.kind ?? "character", ...(v ? { subject: { kind: CHARACTER_KIND, id: v } } : {}), ...(look ? { look } : {}), gen: 0 };
      },
      panel: () => undefined,
    },
    focus: core.history.focus,
    acting: scopes => core.history.acting(scopes)?.id,
    exists: { subject: () => true, look: () => true },
    context: () => ({ kind: "view" }),
    ...(options.collection ? { collection: options.collection } : {}),
  });
}

/** The application with its entry points naming the targets they leave out, as the presentation port does. */
export function named<App extends StudioApplication>(app: App, targets: TargetResolver): App {
  const name = <A extends { kind: string }>(action: A): A => targets.complete(action, app.descriptor(action.kind));
  const overrides: Partial<Record<keyof StudioApplication, unknown>> = {
    dispatch: (action: StudioAction) => app.dispatch(name(action)),
    capability: (action: StudioAction) => app.capability(name(action)),
    contextCapability: (target: Parameters<StudioApplication["contextCapability"]>[0], action: StudioAction) => app.contextCapability(target, name(action)),
    controlEdit: (id: string, action: Parameters<StudioApplication["controlEdit"]>[1]) => app.controlEdit(id, name(action)),
    featureControlEdit: (feature: string, id: string, action: { kind: string }) => app.featureControlEdit(feature, id, name(action)),
    consequences: (subject: Parameters<StudioApplication["consequences"]>[0]) =>
      app.consequences("action" in subject ? { ...subject, action: name(subject.action) } : subject),
    choicesFor: (target: Parameters<StudioApplication["choicesFor"]>[0], kind: StudioAction["kind"], field: string, base?: Record<string, unknown>) =>
      app.choicesFor(target, kind, field, base, targets.named()),
    actionsFor: (target: Parameters<StudioApplication["actionsFor"]>[0]) => app.actionsFor(target, targets.named()),
    contextFor: (hit: Parameters<StudioApplication["contextFor"]>[0]) => app.contextFor(hit, targets.named()),
    contextQuery: (hit: Parameters<StudioApplication["contextQuery"]>[0]) => app.contextQuery(hit, targets.named()),
    history: (scope?: string) => app.history(scope ?? targets.editing()),
    historyTimeline: (scope?: string) => app.historyTimeline(scope ?? targets.editing()),
  };
  return new Proxy(app, {
    get(target, key, receiver) {
      if (typeof key === "string" && key in overrides) return overrides[key as keyof StudioApplication];
      const value = Reflect.get(target, key, receiver === undefined ? target : target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A fixture core's application, naming its targets through the fixture resolver. */
export function namedCore<C extends FixtureCore>(core: C, options?: Parameters<typeof fixtureTargets>[1]): C & { targets: TargetResolver } {
  const targets = fixtureTargets(core, options);
  return { ...core, app: named(core.app, targets), targets };
}
