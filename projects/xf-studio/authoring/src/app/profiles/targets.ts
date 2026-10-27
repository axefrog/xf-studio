/**
 * The input layer's target resolution (profiles design §3.3, §3.6): what a panel instance, a key binding or a palette command acts on,
 * resolved from the session, focus and the owners' reads with the pure functions in `bindings.ts`, and named in the action before it is
 * dispatched. Captures freeze a resolution while a gesture, menu, popover or asynchronous picker is open; aborting their signal releases
 * them. Nothing here edits anything, and no application service reads focus: they take what this names, and validate it.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import type { ViewId } from "../../platform/api/view-graph";
import type { SubjectRef } from "../../platform/api/subjects";
import { CHARACTER_KIND } from "../../platform/api/characters";
import type { BoundTargetStatus, OwnerTargetStatus } from "../../platform/api/target-status";
import type { FocusService } from "../../platform/core/focus";
import { lookScope } from "../../platform/core/history-service";
import { characterScope } from "../../character/character-history";
import type { LookRef } from "../../library/collection-documents";
import { nameTargets, type NamedTargets } from "../action-targets";
import type { ActionDescriptor } from "../../platform/api/actions";
import { type BindingWorld, type CaptureData, captureCurrent, type ConstraintRule, type PanelContext, type Resolution, resolveBinding,
  type Target, bindingTarget } from "./bindings";
import type { PanelBinding, TabId } from "./profile-session";
import { frozenData } from "./frozen-data";

/** One frozen resolution (§3.3): what it named, until its signal is aborted. */
export type Capture = { readonly id: number; readonly instance?: string; readonly data: CaptureData; readonly named: NamedTargets;
  readonly released: () => boolean };

export type TargetResolverDeps = {
  /**
   * The session: its shown tab, each view's scene and tab (default: the shown one), each scene's kind, subject, look and `gen`, and its
   * panel instances, each with its tab (default: the shown one).
   */
  readonly session: {
    tab(): TabId;
    views(): readonly { readonly id: ViewId; readonly scene: string; readonly tab?: TabId }[];
    scene(id: string): { readonly kind: string; readonly subject?: SubjectRef; readonly look?: LookRef; readonly gen: number } | undefined;
    panel(instance: string): { readonly type: string; readonly binding?: PanelBinding; readonly tab?: TabId } | undefined;
  };
  /** Session versions and live availability fence shell captures, including rebind-away-and-back. */
  origin?(instance?: string, tab?: string): unknown;
  readonly focus: Pick<FocusService, "viewOrder" | "recent" | "focusedPanel">;
  /** The first editing context that can act now (the history service's `acting`), by scope ID. */
  acting(scopes: readonly string[]): string | undefined;
  /** Detached owner facts distinguish retained work, purge and recovery from unassigned slots. */
  readonly status: Pick<BindingWorld, "subject" | "look">;
  available?(type: string): boolean;
  /** A panel type's context (§3.1, §5); unknown types follow the focused view's whole chain. */
  context(type: string): PanelContext;
  readonly rules?: readonly ConstraintRule[];
  /** The library documents a target edits, by document key, with their revisions now (frozen by captures). */
  revisions?(target: Target): Readonly<Record<string, number>>;
  revision?(key: string): number | undefined;
  /** The collection a resolution names when its scene shows no look (the Presets panel's collection, phase 1). */
  collection?(): string | undefined;
};

/** Every panel of the session's tab resolves from the whole chain of the view it follows. */
const WHOLE_CHAIN: PanelContext = { kind: "view" };

/** Live reads project their small typed records; only captures pay for a deep, frozen owned graph. */
function statusData(status: OwnerTargetStatus): OwnerTargetStatus {
  const restore = status.restore;
  return { ...status, owner: { ...status.owner }, ...(restore ? { restore: { ...restore,
    ...(restore.issue ? { issue: { ...restore.issue } } : {}) } } : {}) };
}

export class TargetResolver {
  focusedInstance() { return this.deps.focus.focusedPanel(); }
  context(instance: string): PanelContext {
    const panel = this.deps.session.panel(instance);
    const context = panel ? this.deps.context(panel.type) : WHOLE_CHAIN;
    return { ...context, ...("subjects" in context ? { subjects: [...context.subjects] } : {}),
      ...("scenes" in context && context.scenes ? { scenes: [...context.scenes] } : {}) };
  }
  available(instance: string): boolean {
    const panel = this.deps.session.panel(instance);
    return !!panel && this.deps.available?.(panel.type) !== false;
  }
  /** Choices obey the same declared kinds and constraints as resolution, again at dispatch. */
  accepts(instance: string, target: Target): Capability {
    const context = this.context(instance), scene = target.scene ? this.readWorld().scenes[target.scene] : undefined;
    if (context.kind === "subject" && target.subject && !context.subjects.includes(target.subject.kind)
      || scene && "scenes" in context && context.scenes && !context.scenes.includes(scene.kind))
      return refusal("incompatible_mode", "This panel can't use that kind of target.");
    for (const rule of this.deps.rules ?? []) if (rule.applies(context)) {
      const allowed = rule.check(target); if (!allowed.available) return allowed;
    }
    return { available: true };
  }
  private captures = new Set<number>();
  private next = 0;
  constructor(private readonly deps: TargetResolverDeps) {}

  /** The session as resolution reads it, now. */
  world(): BindingWorld {
    const world = this.readWorld();
    return { ...world, scenes: Object.fromEntries(Object.entries(world.scenes).map(([id, scene]) => [id, { kind: scene.kind, gen: scene.gen,
      ...(scene.subject ? { subject: { ...scene.subject } } : {}), ...(scene.look ? { look: { ...scene.look } } : {}) }])),
    subject: ref => statusData(world.subject(ref)), look: ref => statusData(world.look(ref)) };
  }
  /** Call-scoped owner reads. Project references when they leave this resolver; captures take their own deep copy. */
  private readWorld(): BindingWorld {
    const { session, focus, status } = this.deps, tab = session.tab();
    const views: Record<ViewId, { tab: TabId; scene: string }> = {}, scenes: BindingWorld["scenes"] = {};
    for (const view of session.views()) {
      views[view.id] = { tab: view.tab ?? tab, scene: view.scene };
      const scene = session.scene(view.scene);
      if (scene) (scenes as Record<string, unknown>)[view.scene] = scene;
    }
    return { views, scenes, focus: focus.viewOrder(), subject: ref => status.subject(ref), look: ref => status.look(ref) };
  }
  /**
   * What `instance` resolves to through its binding, among the views of its own tab; without one (a key binding or palette command outside
   * any panel), the whole chain of the most recently focused view in the shown tab.
   */
  resolve(instance?: string): Resolution {
    return this.resolveIn(this.readWorld(), instance);
  }
  private resolveIn(world: BindingWorld, instance?: string): Resolution {
    const panel = instance === undefined ? undefined : this.deps.session.panel(instance);
    if (panel && this.deps.available?.(panel.type) === false)
      return { state: "dangling", missing: "view", reason: "This panel's contribution is unavailable. Enable its experiment to use it again." };
    return resolveBinding(world, { tab: panel?.tab ?? this.deps.session.tab(), ...(panel?.binding ? { binding: panel.binding } : {}),
      context: panel ? this.deps.context(panel.type) : WHOLE_CHAIN, ...(this.deps.rules ? { rules: this.deps.rules } : {}) });
  }
  /** U5 seam: complete detached status facts, including references the editable chain cannot resolve. */
  describe(instance: string): { readonly instance: string; readonly resolution: Resolution; readonly target: Target;
    readonly statuses: Readonly<Record<"view" | "scene" | "subject" | "look", BoundTargetStatus>>; readonly available: boolean } {
    const panel = this.deps.session.panel(instance), world = this.readWorld(), resolution = this.resolveIn(world, instance);
    const pin = panel?.binding?.policy === "pinned" ? panel.binding.target : undefined;
    const partial = resolution.target ?? {};
    const view = partial.view ?? (pin && "view" in pin ? pin.view : undefined);
    const scene = partial.scene ?? (view ? world.views[view]?.scene : undefined) ?? (pin && "scene" in pin ? pin.scene : undefined);
    const record = scene ? world.scenes[scene] : undefined;
    const subject = partial.subject ?? record?.subject ?? (pin && "subject" in pin ? pin.subject : undefined);
    const look = partial.look ?? record?.look ?? (pin && "look" in pin ? pin.look : undefined);
    const available = !!panel && this.deps.available?.(panel.type) !== false;
    const slot = (kind: "view" | "scene", id: string | undefined, present: boolean): BoundTargetStatus => ({ instance,
      owner: { kind, id: id ?? instance }, state: !available ? "unavailable" : id === undefined ? "empty" : present ? "present" : "purged" });
    const statuses = { view: slot("view", view, !!(view && world.views[view])), scene: slot("scene", scene, !!record),
      subject: subject ? { ...statusData(world.subject(subject)), instance } : { instance, state: "empty" as const, owner: { kind: "subject", id: scene ?? instance } },
      look: look ? { ...statusData(world.look(look)), instance } : { instance, state: "empty" as const, owner: { kind: "look", id: scene ?? instance } } };
    const context = this.context(instance);
    if (resolution.state === "empty" && !resolution.missing && context.kind !== "profile")
      statuses[context.kind] = { ...statuses[context.kind], state: "unavailable", reason: resolution.reason, restore: undefined };
    if (!available) for (const key of ["view", "scene", "subject", "look"] as const) statuses[key] = { ...statuses[key], state: "unavailable",
      reason: "This panel's contribution is unavailable. Enable its experiment to use it again.", restore: undefined };
    return { instance, resolution, available, statuses, target: { ...(view ? { view } : {}), ...(scene ? { scene } : {}),
      ...(record ? { sceneGen: record.gen } : {}), ...(subject ? { subject: { ...subject } } : {}), ...(look ? { look: { ...look } } : {}) } };
  }
  /** The editing context Undo acts on now (§3.7): the newest that can act, if any. */
  editing(): string | undefined { return this.deps.acting(this.deps.focus.recent()); }
  /**
   * The history scope Ctrl+Z acts on with focus in `instance`: a 3D view's is the look its scene shows (decided, §3.7); a V's panel's (the
   * Character panel) is that V's (`character:<id>`), and none while it shows no V; any other panel's is the editing context.
   */
  undoScope(instance?: string): string | undefined {
    const panel = instance === undefined ? undefined : this.deps.session.panel(instance);
    if (!panel) return this.editing();
    const subjects = this.deps.context(panel.type).kind === "subject";
    if (panel.type === "view" || subjects) {
      const resolved = this.resolve(instance), target = resolved.state === "resolved" ? resolved.target : {};
      if (subjects) return target.subject?.kind === CHARACTER_KIND ? characterScope(target.subject.id) : undefined;
      if (target.look) return lookScope(target.look);
    }
    return this.editing();
  }
  /** What a resolution names, by target field (`bindings.ts` `Target` to the actions' fields), with the editing context as `scope`. */
  named(instance?: string): NamedTargets {
    const resolved = this.resolve(instance);
    return this.namedOf(resolved.target ?? {},
      instance === undefined ? undefined : this.deps.session.panel(instance)?.tab, instance === undefined);
  }
  /** The drawn compatibility input names a view explicitly, even before its pane exists. */
  namedView(view: ViewId | undefined): NamedTargets { return this.namedOf(this.viewTarget(view), view === undefined ? undefined : this.readWorld().views[view]?.tab, false); }
  private viewTarget(view: ViewId | undefined): Target {
    const world = this.readWorld(), found = view === undefined ? undefined : world.views[view], scene = found && world.scenes[found.scene];
    return found && scene ? { view, scene: found.scene, sceneGen: scene.gen, ...(scene.subject ? { subject: scene.subject } : {}), ...(scene.look ? { look: scene.look } : {}) } : {};
  }
  private namedOf(target: Target, tab?: TabId, fallback = true): NamedTargets {
    const scope = this.editing(), collection = target.look?.collection ?? (fallback ? this.deps.collection?.() : undefined);
    return { ...(target.view !== undefined ? { view: target.view } : {}), ...(target.scene !== undefined ? { scene: target.scene, sceneGen: target.sceneGen } : {}),
      ...(target.subject?.kind === CHARACTER_KIND ? { character: target.subject.id } : {}), ...(target.look ? { look: { ...target.look } } : {}),
      ...(collection ? { collection } : {}), ...(scope ? { scope } : {}), tab: tab ?? this.deps.session.tab() };
  }
  /** `action` with the targets its descriptor declares and it leaves out named: from a capture when given, else from `instance`'s resolution. */
  complete<A extends object>(action: A, descriptor: Pick<ActionDescriptor, "payload"> | undefined, from: { instance?: string; capture?: Capture } = {}): A {
    return nameTargets(action, descriptor, from.capture ? from.capture.named : this.named(from.instance));
  }

  /** Structural shell navigation has no document-revision dependency. */
  structural(instance: string): () => Capability {
    const panel = this.deps.session.panel(instance), tab = panel?.tab, origin = JSON.stringify(this.deps.origin?.(instance, tab));
    return () => !panel || !this.deps.session.panel(instance) || origin !== JSON.stringify(this.deps.origin?.(instance, tab))
      ? refusal("missing_target", "That panel changed. Open the command again.") : { available: true };
  }

  /** A binding choice validates the old structural destination and the chosen new chain, never the old dangling document. */
  bindingCapture(instance: string, binding: PanelBinding, signal: AbortSignal): () => Capability {
    binding = frozenData(binding);
    if (binding.policy === "follow-focus") {
      const structural = this.structural(instance);
      return () => signal.aborted ? refusal("missing_target", "That chooser was closed.") : structural();
    }
    const world = this.readWorld(), panel = this.deps.session.panel(instance);
    const resolution = resolveBinding(world, { tab: panel?.tab ?? this.deps.session.tab(), binding, context: this.context(instance), rules: this.deps.rules });
    const target = bindingTarget(world, binding, resolution.target), structural = this.structural(instance), capture = this.captureTarget(resolution.target ?? {}, signal, instance);
    // Owner versions move on local/external edits, never acknowledgement/progress. Recovery facts matter even without a live chain.
    const states = (now: BindingWorld) => JSON.stringify([target.subject ? state(now.subject(target.subject)) : null, target.look ? state(now.look(target.look)) : null]);
    const state = (status: import("../../platform/api/target-status").OwnerTargetStatus) => [status.state, status.content, status.revision];
    const before = states(world);
    return () => {
      if (signal.aborted) return refusal("missing_target", "That chooser was closed.");
      const origin = structural(); if (!origin.available) return origin;
      const current = this.current(capture);
      return !current.available ? current : states(this.readWorld()) !== before
        ? refusal("missing_target", "That target changed. Open the chooser again.") : { available: true };
    };
  }
  // ----- Captures -----
  /** Freeze what `instance` resolves to now (§3.3) until `signal` is aborted. */
  capture(instance: string | undefined, signal: AbortSignal): Capture {
    const resolved = this.resolve(instance), target = resolved.target ?? {};
    return this.captureTarget(target, signal, instance);
  }
  /** File requests at the root retain the explicitly drawn semantic chain, independently of focus. */
  captureView(view: ViewId | undefined, signal: AbortSignal): Capture { return this.captureTarget(this.viewTarget(view), signal); }
  /** Retain the already resolved writer's chain; a second resolution could follow focus to another writer. */
  captureNamed(named: NamedTargets, signal: AbortSignal, instance?: string): Capture {
    const { view, scene, sceneGen, look, character } = named;
    return this.captureTarget({ ...(view !== undefined ? { view } : {}), ...(scene !== undefined ? { scene, sceneGen } : {}),
      ...(look ? { look } : {}), ...(character ? { subject: { kind: CHARACTER_KIND, id: character } } : {}) }, signal, instance);
  }
  private captureTarget(source: Target, signal: AbortSignal, instance?: string): Capture {
    const target = frozenData(source);
    const id = ++this.next, tab = instance ? this.deps.session.panel(instance)?.tab : target.view ? this.readWorld().views[target.view]?.tab : this.deps.session.tab(),
      origin = JSON.stringify(this.deps.origin?.(instance, tab));
    let released = signal.aborted;
    if (!released) {
      this.captures.add(id);
      signal.addEventListener("abort", () => { released = true; this.captures.delete(id); }, { once: true });
    }
    return Object.freeze({ id, ...(instance !== undefined ? { instance } : {}), data: Object.freeze({ target, revisions: frozenData(this.deps.revisions?.(target) ?? {}) }),
      named: frozenData(this.namedOf(target, instance === undefined ? target.view === undefined ? undefined : this.readWorld().views[target.view]?.tab
        : this.deps.session.panel(instance)?.tab, instance === undefined)), released: () => released || origin !== JSON.stringify(this.deps.origin?.(instance, tab)) });
  }
  /** Whether a capture still names what it named (refused with `missing_target`, saying what changed), and was not released. */
  current(capture: Capture): Capability {
    if (capture.released()) return refusal("missing_target", "That menu was closed.");
    return captureCurrent(this.readWorld(), capture.data, key => this.deps.revision?.(key));
  }
  /**
   * Whether what an action names is still what it was resolved to (§3.3): its view still shows its scene, at the `gen` it names. The
   * same rule as a capture's (`captureCurrent`), so dispatch and captures can't disagree; owners call it through the application.
   */
  check(named: Pick<NamedTargets, "view" | "scene" | "sceneGen">): Capability {
    const target: Target = { ...(named.view !== undefined ? { view: named.view } : {}), ...(named.scene !== undefined ? { scene: named.scene } : {}),
      ...(named.sceneGen !== undefined ? { sceneGen: named.sceneGen } : {}) };
    return captureCurrent(this.readWorld(), { target, revisions: {} }, () => undefined);
  }
  /** How many captures are held (released ones are gone). */
  held(): number { return this.captures.size; }
}
