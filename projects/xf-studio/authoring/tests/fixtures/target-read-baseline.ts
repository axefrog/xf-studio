/**
 * Frozen cost reference for the present-look/follow-focus path at c87a734e, before the ownership sweep. Deliberately independent of
 * the production resolver: sharing its projection code would let a costly copy slow both sides of the ratio. This is a timing oracle
 * for these fixtures only, not a second binding implementation. Semantic equality is checked before measuring.
 */
import type { NamedTargets } from "../../src/app/action-targets";
import type { BindingWorld, PanelContext, Resolution, Target } from "../../src/app/profiles/bindings";
import { captureCurrent } from "../../src/app/profiles/bindings";
import type { Capture, TargetResolverDeps } from "../../src/app/profiles/targets";
import { targetPresent } from "../../src/platform/api/target-status";
import type { profileContextStudio } from "./profile-context-studio";
import { STUDIO_CATALOGUE } from "../../src/compose/views";

/** The real fixture uses the same session/owner reads as createTargetResolver, without reaching into its private dependencies. */
export function studioReadDeps(w: Awaited<ReturnType<typeof profileContextStudio>>): TargetResolverDeps {
  const { session: state, services, history } = w, graph = state.graph;
  return {
    session: {
      tab: () => state.tabId(),
      views: () => graph.viewIds().map(id => ({ id, scene: graph.node(id, "scene").id, tab: state.viewTab(id) })),
      scene: id => {
        const scene = state.knownScene(id), kind = graph.viewIds().map(view => graph.node(view, "scene")).find(node => node.id === id)?.kind;
        return scene && kind !== undefined ? { kind, ...scene } : undefined;
      },
      panel: id => state.panel(id),
    },
    focus: state.focus, acting: scopes => history.acting(scopes)?.id,
    status: { subject: ref => services.characters.targetStatus(ref.id), look: ref => services.collections.targetStatus(ref) },
    context: type => STUDIO_CATALOGUE.context(type),
    revision: key => {
      const slash = key.indexOf("/"), kind = key.slice(0, slash), id = key.slice(slash + 1);
      if (kind === "character") return services.characters.character(id)?.revision;
      if (kind === "look-working") { const at = id.indexOf("/"); return services.looks.generation({ collection: id.slice(0, at), look: id.slice(at + 1) }); }
      return undefined;
    },
  };
}

export function targetReadBaseline(deps: TargetResolverDeps) {
  const world = (): BindingWorld => {
    const { session, focus, status } = deps, tab = session.tab();
    const views: Record<string, { tab: string; scene: string }> = {}, scenes: Record<string, BindingWorld["scenes"][string]> = {};
    for (const view of session.views()) {
      views[view.id] = { tab: view.tab ?? tab, scene: view.scene };
      const scene = session.scene(view.scene); if (scene) scenes[view.scene] = scene;
    }
    return { views, scenes, focus: focus.viewOrder(), subject: ref => status.subject(ref), look: ref => status.look(ref) };
  };
  // Keep the old call/eligibility structure too: an inlined, specialized loop is not a fair cost reference for a general resolver.
  const chainOfScene = (now: BindingWorld, id: string): Target | undefined => {
    const scene = now.scenes[id]; if (!scene) return undefined;
    return { scene: id, sceneGen: scene.gen,
      ...(scene.subject && targetPresent(now.subject(scene.subject)) ? { subject: scene.subject } : {}),
      ...(scene.look && targetPresent(now.look(scene.look)) ? { look: scene.look } : {}) };
  };
  const chainOfView = (now: BindingWorld, view: string): Target | undefined => {
    const record = now.views[view], scene = record && now.scenes[record.scene];
    return record && scene ? { view, ...chainOfScene(now, record.scene) } : undefined;
  };
  const eligible = (now: BindingWorld, view: string, tab: string, context: PanelContext): Target | undefined => {
    const record = now.views[view]; if (!record || record.tab !== tab) return undefined;
    const scene = now.scenes[record.scene];
    if (!scene || ("scenes" in context && context.scenes && !context.scenes.includes(scene.kind))) return undefined;
    const target = chainOfView(now, view); if (!target) return undefined;
    if (context.kind === "subject" && (target.subject ? !context.subjects.includes(target.subject.kind) : !context.subjects.includes(scene.kind))) return undefined;
    return target;
  };
  const resolve = (now: BindingWorld, instance: string): Resolution => {
    const panel = deps.session.panel(instance), tab = panel?.tab ?? deps.session.tab(), context = deps.context(panel!.type);
    const candidates = Object.keys(now.views).flatMap(view => { const target = eligible(now, view, tab, context); return target ? [target] : []; });
    let best: Target | undefined = candidates[0], at = 0;
    for (const target of candidates) { const seq = now.focus[target.view!] ?? 0; if (seq > at) { at = seq; best = target; } }
    if (!best?.look) throw Error("The cost reference requires a present look and eligible views.");
    return { state: "resolved", target: best, candidates: candidates.length, named: candidates.length > 1 };
  };
  return {
    named(instance: string): NamedTargets {
      const target = resolve(world(), instance).target!, scope = deps.acting(deps.focus.recent());
      return { ...(target.view !== undefined ? { view: target.view } : {}),
        ...(target.scene !== undefined ? { scene: target.scene, sceneGen: target.sceneGen } : {}),
        ...(target.subject?.kind === "character" ? { character: target.subject.id } : {}), ...(target.look ? { look: target.look } : {}),
        ...(target.look?.collection ? { collection: target.look.collection } : {}), ...(scope ? { scope } : {}),
        tab: deps.session.panel(instance)?.tab ?? deps.session.tab() };
    },
    describe(instance: string) {
      const panel = deps.session.panel(instance), now = world(), resolution = resolve(now, instance), target = resolution.target!;
      const { view, scene, subject, look } = target, record = scene ? now.scenes[scene] : undefined, available = !!panel;
      const slot = (kind: "view" | "scene", id: string | undefined) => ({ instance, owner: { kind, id: id ?? instance }, state: "present" });
      // c87a734e already cloned describe's complete result; leave that cost in the baseline.
      return structuredClone({ instance, resolution, available, statuses: {
        view: slot("view", view), scene: slot("scene", scene),
        subject: { ...now.subject(subject!), instance }, look: { ...now.look(look!), instance },
      }, target: { ...(view ? { view } : {}), ...(scene ? { scene } : {}), ...(record ? { sceneGen: record.gen } : {}),
        ...(subject ? { subject } : {}), ...(look ? { look } : {}) } });
    },
    current(capture: Capture) {
      if (capture.released()) throw Error("The cost reference requires a live capture.");
      return captureCurrent(world(), capture.data, key => deps.revision?.(key));
    },
  };
}
