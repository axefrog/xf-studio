/** Registered panel commands: contribution metadata is injected live; the session remains the sole state/history owner. */
import { refusal, type Capability } from "../../platform/api/capability";
import type { PanelContext } from "../../platform/api/subjects";
import type { DockLayout } from "../ui-preferences";
import { rewriteDock, viewOfPanel } from "./profiles-migration-data";
import { panelBindingOf, type PanelBinding } from "./profile-session";
import { TabRefusal, type PanelTabTarget, type PanelTarget, type ProfileSessions } from "./profile-sessions";
import { resolveBinding, type BindingWorld, type ConstraintRule } from "./bindings";
import { openIn } from "./panel-dock";

export type PanelAction =
  | { kind: "panels.add"; destination: PanelTabTarget; type: string; binding?: PanelBinding;
      source?: { view: string; scene: string; sceneGen: number; shareScene: boolean } }
  | { kind: "panels.show" | "panels.remove" | "panels.reveal"; destination: PanelTarget }
  | { kind: "panels.setBinding"; destination: PanelTarget; binding: PanelBinding }
  | { kind: "panels.setTypeVisible"; destination: PanelTabTarget; type: string; visible: boolean; instances: readonly PanelTarget[] };
export type PanelType = { readonly id: string; readonly context?: PanelContext; readonly binding?: PanelBinding;
  readonly title?: string; readonly icon?: string; readonly description?: string; readonly owner?: string; readonly slot?: string; readonly order?: number };
export type PanelActionsDeps = {
  types(): readonly PanelType[];
  factory(): DockLayout | null;
  world(): BindingWorld;
  readonly rules?: readonly ConstraintRule[];
  access?(): Capability;
};

export class PanelActions {
  constructor(private readonly session: ProfileSessions, private readonly deps: PanelActionsDeps) {}
  /** Projection keeps every retained instance; catalogue metadata and factory slots stay keyed by type. */
  projection(tab: string) {
    const types = this.deps.types(), instances = this.session.tab(tab)?.panels ?? [], dock = this.session.dock(tab);
    return structuredClone(instances.map(instance => ({ ...instance, contribution: types.find(type => type.id === instance.type),
      open: { wide: openIn(dock, instance.id, "wide"), compact: openIn(dock, instance.id, "compact") } })));
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
        const compatible = context.kind === "view" ? pin === "view" : context.kind === "scene" ? pin === "scene" || pin === "view"
          : context.kind === "subject" ? pin !== "look" : pin !== "subject";
        const world = this.deps.world(), resolved = resolveBinding(world, { tab: action.destination.tab, binding, context, rules: this.deps.rules });
        const subject = resolved.state === "resolved" || resolved.state === "empty" ? resolved.target?.subject : undefined;
        const scene = resolved.state === "resolved" || resolved.state === "empty" ? resolved.target?.scene : undefined;
        if (!compatible || context.kind === "subject" && (subject ? !context.subjects.includes(subject.kind) : scene && !context.subjects.includes(world.scenes[scene]!.kind))
          || scene && context.scenes && !context.scenes.includes(world.scenes[scene]!.kind))
          throw new TabRefusal("incompatible_mode", "This panel can't use that kind of target.");
        if (resolved.state === "dangling") throw new TabRefusal("missing_target", resolved.reason);
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
