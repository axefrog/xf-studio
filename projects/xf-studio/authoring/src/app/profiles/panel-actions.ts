/** Registered panel commands: contribution metadata is injected live; the session remains the sole state/history owner. */
import { refusal, type Capability } from "../../platform/api/capability";
import type { PanelContext } from "../../platform/api/subjects";
import type { DockLayout } from "../ui-preferences";
import { rewriteDock, viewOfPanel } from "./profiles-migration-data";
import { panelBindingOf, type PanelBinding } from "./profile-session";
import { TabRefusal, type PanelTabTarget, type PanelTarget, type ProfileSessions } from "./profile-sessions";
import { resolveBinding, bindingKey, bindingKindCompatible, bindingRules, bindingTarget, captureCurrent, type BindingWorld, type ConstraintRule, type Target } from "./bindings";
import type { OwnerTargetStatus } from "../../platform/api/target-status";
import type { BindingTargetOption, PanelBindingSnapshot, PanelBindingsPort } from "./panel-bindings";
import { openIn } from "./panel-dock";
import { frozenData } from "./frozen-data";

function bindingStatuses(world: BindingWorld, target: Target): Partial<Record<"view" | "scene" | "subject" | "look", OwnerTargetStatus>> {
  return { ...(target.view ? { view: { owner: { kind: "view", id: target.view }, state: world.views[target.view] ? "present" as const : "purged" as const } } : {}),
    ...(target.scene ? { scene: { owner: { kind: "scene", id: target.scene }, state: world.scenes[target.scene] ? "present" as const : "purged" as const } } : {}),
    ...(target.subject ? { subject: world.subject(target.subject) } : {}), ...(target.look ? { look: world.look(target.look) } : {}) };
}

export type PanelAction =
  | { kind: "panels.add"; destination: PanelTabTarget; type: string; binding?: PanelBinding;
      source?: { view: string; scene: string; sceneGen: number; shareScene: boolean } }
  | { kind: "panels.show" | "panels.remove" | "panels.reveal"; destination: PanelTarget }
  | { kind: "panels.setBinding"; destination: PanelTarget; binding: PanelBinding; choice?: number }
  | { kind: "panels.setTypeVisible"; destination: PanelTabTarget; type: string; visible: boolean; instances: readonly PanelTarget[] };
export type PanelType = { readonly id: string; readonly context?: PanelContext; readonly binding?: PanelBinding;
  readonly title?: string; readonly icon?: string; readonly description?: string; readonly owner?: string; readonly slot?: string; readonly order?: number };
export type PanelActionsDeps = {
  types(): readonly PanelType[];
  factory(): DockLayout | null;
  world(): BindingWorld;
  readonly rules?: readonly ConstraintRule[];
  access?(): Capability;
  bindingTargets?(): readonly BindingTargetOption[];
  captureBinding?(instance: string, binding: PanelBinding, signal: AbortSignal): () => Capability;
};

export class PanelActions {
  private nextChoice = 0;
  private readonly choices = new Map<number, { readonly action: Extract<PanelAction, { kind: "panels.setBinding" }>; readonly current: () => Capability }>();
  constructor(private readonly session: ProfileSessions, private readonly deps: PanelActionsDeps) {}
  types(): readonly PanelType[] { return structuredClone(this.deps.types()); }
  /** Projection keeps every retained instance; catalogue metadata and factory slots stay keyed by type. */
  projection(tab: string) {
    const types = this.deps.types(), instances = this.session.tab(tab)?.panels ?? [], dock = this.session.dock(tab);
    return structuredClone(instances.map(instance => ({ ...instance, contribution: types.find(type => type.id === instance.type),
      open: { wide: openIn(dock, instance.id, "wide"), compact: openIn(dock, instance.id, "compact") } })));
  }
  /** U1/U2 service seam. Snapshot is a non-mutating read; capture is explicitly the lifetime of an open chooser. */
  bindings(): PanelBindingsPort { return { snapshot: instance => this.bindingSnapshot(instance), capture: (instance, signal) => this.captureBindings(instance, signal) }; }
  heldBindingChoices() { return this.choices.size; }
  private bindingSnapshot(instance: string): PanelBindingSnapshot {
    const panel = this.session.panel(instance), world = this.deps.world(), type = this.deps.types().find(type => type.id === panel?.type);
    const context = type?.context ?? { kind: "profile" }, binding = panel?.binding ?? { policy: "follow-focus" as const };
    const destination = panel ? this.session.panelTarget(instance) : undefined;
    const capability = !panel ? refusal("missing_target", "That panel no longer exists.") : !type ? refusal("unavailable", "This panel's contribution is unavailable.")
      : panel.type === "view" || context.kind === "profile" ? refusal("incompatible_mode", "This panel has no editable binding.") : this.deps.access?.() ?? { available: true };
    const resolution = resolveBinding(world, { tab: panel?.tab ?? "", binding, context, rules: this.deps.rules });
    const target = bindingTarget(world, binding, resolution.target);
    const options = this.deps.bindingTargets?.() ?? [];
    const pinKind = (pin: Extract<PanelBinding, { policy: "pinned" }>["target"]) => "view" in pin ? "view" : "scene" in pin ? "scene" : "subject" in pin ? "subject" : "look";
    const currentOption = binding.policy === "pinned" ? options.find(option => bindingKey(option.binding) === bindingKey(binding)) : undefined;
    const name = currentOption?.name ?? (context.kind === "look" && target.look ? world.look(target.look).label : undefined)
      ?? (context.kind === "subject" && target.subject ? world.subject(target.subject).label : undefined)
      ?? options.find(option => "view" in option.binding.target && option.binding.target.view === target.view)?.name
      ?? (resolution.state === "resolved" ? "No target" : resolution.reason);
    const candidates = options.filter(option => bindingKindCompatible(context, pinKind(option.binding.target))).map(option => {
      const resolved = resolveBinding(world, { tab: panel?.tab ?? "", binding: option.binding, context, rules: this.deps.rules });
      const assigned = bindingTarget(world, option.binding, resolved.target), statuses = bindingStatuses(world, assigned), kind = pinKind(option.binding.target);
      const allowed = capability.available && destination ? this.capability({ kind: "panels.setBinding", destination, binding: option.binding }) : capability;
      return { ...option, target: assigned, status: statuses[kind]!, statuses, outsideTab: !!option.tabs?.length && !option.tabs.some(tab => tab.id === panel?.tab),
        shownInTab: !!option.tabs?.some(tab => tab.id === panel?.tab),
        current: binding.policy === "pinned" && bindingKey(binding) === bindingKey(option.binding),
        rules: bindingRules(world, context, option.binding, assigned, this.deps.rules), capability: allowed };
    });
    const follow = capability.available && destination ? this.capability({ kind: "panels.setBinding", destination, binding: { policy: "follow-focus" } }) : capability;
    return structuredClone({ instance, ...(destination ? { destination } : {}), capability,
      current: { binding, name, named: binding.policy === "pinned" || resolution.state !== "resolved" || resolution.named, resolution, target },
      follow: { capability: follow }, candidates, ...(!candidates.some(candidate => candidate.capability.available)
        ? { noCandidate: refusal("missing_target", "No compatible target is available for this panel.") } : {}) });
  }
  private captureBindings(instance: string, signal: AbortSignal): PanelBindingSnapshot {
    const snapshot = this.bindingSnapshot(instance), destination = snapshot.destination;
    if (!destination) return snapshot;
    const capture = (binding: PanelBinding): Extract<PanelAction, { kind: "panels.setBinding" }> => {
      const choice = ++this.nextChoice, action = structuredClone({ kind: "panels.setBinding" as const, destination, binding, choice });
      // Neither the returned candidate nor its action may share nested references with private validation state.
      const validationBinding = frozenData(binding);
      const target = bindingTarget(this.deps.world(), validationBinding), current = this.deps.captureBinding?.(instance, validationBinding, signal)
        ?? (() => signal.aborted ? refusal("missing_target", "That chooser was closed.") : captureCurrent(this.deps.world(), { target, revisions: {} }, () => undefined));
      if (!signal.aborted) {
        this.choices.set(choice, { action: structuredClone(action), current });
        signal.addEventListener("abort", () => this.choices.delete(choice), { once: true });
      }
      return action;
    };
    return { ...snapshot, follow: { ...snapshot.follow, ...(snapshot.follow.capability.available ? { action: capture({ policy: "follow-focus" }) } : {}) },
      candidates: snapshot.candidates.map(candidate => ({ ...candidate, ...(candidate.capability.available ? { action: capture(candidate.binding) } : {}) })) };
  }
  private factory(tab: string, adding?: { id: string; type: string }): DockLayout | null {
    const factory = this.deps.factory(), panels = this.session.tab(tab)?.panels ?? [];
    // Factory slots need one deterministic sibling anchor; this projection never serializes the tab's actual instance arrangement.
    return factory ? rewriteDock(factory, type => {
      if (adding?.type === type) return adding.id;
      const view = viewOfPanel(type);
      return panels.find(panel => view ? panel.type === "view" && panel.binding?.policy === "pinned" && "view" in panel.binding.target
        && panel.binding.target.view === view : panel.type === type)?.id ?? type;
    }) : null;
  }
  capability(action: PanelAction): Capability {
    try { this.check(action); return { available: true }; }
    catch (error) { if (error instanceof TabRefusal) return refusal(error.code, error.message); throw error; }
  }
  private check(action: PanelAction) {
    const access = this.deps.access?.();
    if (access && !access.available) throw new TabRefusal("unavailable", access.reason ?? "This workspace is read-only.");
    if (!action.destination || typeof action.destination !== "object") throw new TabRefusal("missing_target", "Name the destination panel or tab.");
    this.session.checkPanelTarget(action.destination);
    if (action.kind === "panels.setBinding" && action.choice !== undefined) {
      const choice = this.choices.get(action.choice);
      const parsed = panelBindingOf(action.binding), old = choice?.action.destination, now = action.destination;
      if (!choice || !parsed || bindingKey(choice.action.binding) !== bindingKey(parsed) || old?.profile !== now.profile || old.tab !== now.tab
        || old.tabVersion !== now.tabVersion || old.instance !== now.instance || old.version !== now.version)
        throw new TabRefusal("missing_target", "That binding choice was released or changed. Open the chooser again.");
      const current = choice.current();
      if (!current.available) throw new TabRefusal(current.code ?? "missing_target", current.reason ?? "That binding choice changed.");
      if (parsed.policy === "pinned" && this.deps.bindingTargets && !this.deps.bindingTargets().some(option => bindingKey(option.binding) === bindingKey(parsed)))
        throw new TabRefusal("missing_target", "That target is no longer a choice in this profile. Open the chooser again.");
    }
    const instance = "instance" in action.destination && typeof action.destination.instance === "string" ? this.session.panel(action.destination.instance) : undefined;
    const type = "type" in action ? action.type : instance?.type;
    const contribution = this.deps.types().find(item => item.id === type);
    if (!contribution) throw new TabRefusal("unavailable", "This panel's contribution is unavailable.");
    if (action.kind !== "panels.add" && action.kind !== "panels.setTypeVisible" && !instance) throw new TabRefusal("missing_target", "Name a panel instance.");
    if (action.kind === "panels.setTypeVisible") {
      const actual = this.session.instances(action.type, action.destination.tab).map(panel => panel.id).sort();
      if (!Array.isArray(action.instances) || action.instances.some(target => {
        this.session.checkPanelTarget(target); return target.tab !== action.destination.tab || this.session.panel(target.instance)?.type !== action.type;
      }) || JSON.stringify(action.instances.map(target => target.instance).sort()) !== JSON.stringify(actual))
        throw new TabRefusal("missing_target", "The panel list changed. Open the command again.");
      if (action.visible && !actual.length && action.type === "view") throw new TabRefusal("incompatible_mode", "Choose a scene for the new 3D view.");
    }
    if (action.kind === "panels.reveal" && !(["wide", "compact"] as const).some(size => openIn(this.session.dock(action.destination.tab), instance!.id, size)))
      throw new TabRefusal("missing_target", "Show this panel first.");
    if (action.kind === "panels.add" && action.type === "view") {
      const source = action.source, view = source && this.deps.world().views[source.view], scene = view && this.deps.world().scenes[view.scene];
      if (!source || !view || view.scene !== source.scene || scene?.gen !== source.sceneGen || typeof source.shareScene !== "boolean")
        throw new TabRefusal("missing_target", "Choose an available scene for the new 3D view.");
    }
    const binding = action.kind === "panels.setBinding" ? action.binding : action.kind === "panels.add" ? action.binding ?? contribution.binding
      : action.kind === "panels.setTypeVisible" && action.visible && !action.instances.length ? contribution.binding : undefined;
    if (binding !== undefined || action.kind === "panels.setBinding") {
      if (!panelBindingOf(binding)) throw new TabRefusal("invalid_value", "That binding can't be read.");
      if (type === "view") throw new TabRefusal("incompatible_mode", "A 3D pane keeps its view identity.");
      const context = contribution?.context ?? { kind: "profile" };
      if (context.kind === "profile") throw new TabRefusal("incompatible_mode", "This panel works on the profile and has no binding.");
      if (binding?.policy === "pinned") {
        const target = binding.target, pin = "view" in target ? "view" : "scene" in target ? "scene" : "subject" in target ? "subject" : "look";
        const world = this.deps.world(), resolved = resolveBinding(world, { tab: action.destination.tab, binding, context, rules: this.deps.rules });
        const assigned = bindingTarget(world, binding, resolved.target), scene = resolved.target?.scene;
        for (const rule of bindingRules(world, context, binding, assigned, this.deps.rules)) if (!rule.capability.available)
          throw new TabRefusal(rule.capability.code ?? "incompatible_mode", rule.capability.reason ?? `The ${rule.id} rule refuses this target.`);
        // A retained scene/view is a valid panel anchor even while its assigned document needs recovery. Missing anchors and direct
        // document pins are still refused; accepting the scene does not authorize edits of its removed subject/look.
        if (resolved.state === "dangling" && !(scene && (pin === "scene" || pin === "view"))) {
          const status = "subject" in target ? world.subject(target.subject) : "look" in target ? world.look(target.look) : undefined;
          throw new TabRefusal(status?.state === "pending" ? "not_ready" : status?.state === "unavailable" ? "unavailable" : "missing_target", status?.reason ?? resolved.reason);
        }
        if (resolved.state === "empty" && !resolved.missing) throw new TabRefusal("incompatible_mode", resolved.reason);
      }
    }
  }
  dispatch(action: PanelAction): undefined {
    this.check(action);
    const tab = action.destination.tab;
    switch (action.kind) {
      case "panels.add":
        if (action.type === "view") this.session.addViewPane(tab, action.source!.view, { scene: action.source!.shareScene, lights: action.source!.shareScene });
        else this.session.addPanel(tab, action.type, { binding: action.binding ?? this.deps.types().find(type => type.id === action.type)?.binding,
          factory: id => this.factory(tab, { id, type: action.type }) });
        break;
      case "panels.show": case "panels.remove": this.session.setPanelsOpen(tab, [action.destination.instance], action.kind === "panels.show",
        panel => this.factory(tab, { id: panel.id, type: panel.type })); break;
      case "panels.setBinding": this.session.setPanelBinding(tab, action.destination.instance, action.binding); break;
      case "panels.reveal": this.session.revealPanel(tab, action.destination.instance); break;
      case "panels.setTypeVisible":
        if (action.visible && !action.instances.length) this.session.addPanel(tab, action.type, { binding: this.deps.types().find(type => type.id === action.type)?.binding,
          factory: id => this.factory(tab, { id, type: action.type }) });
        else this.session.setPanelsOpen(tab, action.instances.map(target => target.instance), action.visible, panel => this.factory(tab, { id: panel.id, type: panel.type }));
        break;
    }
    return undefined;
  }
}
