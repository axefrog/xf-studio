/**
 * The shell's side of feature views (UI-73): it builds each feature view's `FeatureViewContext` from the
 * feature's facade and its own presentation services, and renders what the view contributes (target menus,
 * palette commands) generically. Only the shell imports this module; a feature's view sees only the
 * context's type (`feature-view.ts`).
 */
import type { StudioAction } from "../../studio-application";
import type { Command } from "../commands";
import { ViewportInputHints } from "../input-hints";
import { menuFromSections, openMenu, type MenuItem, type MenuSection } from "../menu";
import { Frame, type StudioRuntime } from "../runtime";
import { readinessText } from "../readiness-text";
import { contextItems, viewportMenu } from "../target-menus";
import type { FacadeOf, FeatureMenuItem, FeaturePresetRequest, FeatureTargetMenu, FeatureViewBinding, FeatureViewContext, MenuTarget, ModuleViewContext } from "./feature-view";
import type { PartPresetRequest } from "../../part-presets";

type Action = { kind: string };
/** Only the keys that carry a value, so a rendered entry has exactly the fields its contribution gave. */
const defined = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;

/** A feature view's context over `port.feature(owner)`. Refuses an owner the port does not register. */
export function featureViewContext<K extends string>(rt: StudioRuntime, owner: K): FeatureViewContext<FacadeOf<K>> {
  return context(rt, owner) as unknown as FeatureViewContext<FacadeOf<K>>;
}
function context(rt: StudioRuntime, owner: string): FeatureViewContext {
  const port = rt.port, facade = port.feature(owner);
  if (!facade) throw Error(`The ${owner} view has no registered feature.`);
  // Every feature's own kinds: `platform` refuses them, so a view reaches its kinds only through its facade.
  const featureKinds = new Set<string>(port.features().flatMap(info => port.feature(info.id)?.kinds() ?? []));
  const dispatch = (action: Action, options?: Parameters<StudioRuntime["report"]>[2]) =>
    rt.report(action.kind, facade.dispatch(action), options);
  const render = (target: MenuTarget, item: FeatureMenuItem<Action>): MenuItem => item.kind === "submenu"
    ? { kind: "submenu", label: item.label, ...defined({ icon: item.icon }), items: () => item.items().map(entry => render(target, entry)) }
    : { kind: "action", label: item.label, ...defined({ icon: item.icon }),
      capability: item.capability ?? facade.contextCapability(target, item.action),
      ...defined({ shortcut: item.shortcut, hint: item.hint, checked: item.checked }), run: () => { dispatch(item.action); } };
  const targetSections = (target: MenuTarget, menu: FeatureTargetMenu<Action>, anchor: Parameters<typeof openMenu>[1]): MenuSection[] => [
    { label: menu.label, detail: menu.detail, items: contextItems(rt, port.authoring.contextQuery(target), anchor) },
    { items: menu.items.map(item => render(target, item)) }];
  return Object.freeze({
    facade,
    dispatch,
    range: (kind, field, variant) => rt.range(kind as StudioAction["kind"], field, variant),
    platform: (action, options) => featureKinds.has(action.kind)
      ? rt.report(action.kind, { ok: false, code: "invalid_value", message: "That command belongs to a feature's own controls." }, options)
      : rt.dispatch(action, options),
    undoAction: () => rt.undoAction(),
    feedback: Object.freeze({
      toast: (...args: Parameters<StudioRuntime["feedback"]["toast"]>) => rt.feedback.toast(...args),
      announce: (...args: Parameters<StudioRuntime["feedback"]["announce"]>) => rt.feedback.announce(...args),
      record: (...args: Parameters<StudioRuntime["feedback"]["record"]>) => rt.feedback.record(...args),
    }),
    anchors: Object.freeze({ register: (...args: Parameters<StudioRuntime["anchors"]["register"]>) => rt.anchors.register(...args) }),
    reveal: (panel, focus) => rt.dock.reveal(panel, focus),
    openSettings: section => rt.settings.open(section),
    links: Object.freeze({ open: (link: Parameters<typeof port.links.open>[0]) => port.links.open(link) }),
    changed: () => rt.changed(),
    targetSections,
    targetMenu: (target, menu, anchor, invoker) =>
      openMenu(menuFromSections(targetSections(target, menu, anchor)), anchor, { label: menu.title, invoker }),
    uv: Object.freeze({
      attach: (slot: HTMLElement) => port.viewport.attach("uv", slot),
      resize: () => port.viewport.resize("uv"),
      command: (command: Parameters<typeof port.viewport.uvCommand>[0]) => port.viewport.uvCommand(command),
      commandCapability: (command: Parameters<typeof port.viewport.uvCommandCapability>[0]) => port.viewport.uvCommandCapability(command),
      menu: (anchor: Parameters<typeof openMenu>[1], at?: { x: number; y: number }, invoker?: Element) => viewportMenu(rt, "uv", anchor, at, invoker),
      hints: (slot: HTMLElement, host: HTMLElement) => new ViewportInputHints(port.viewport, "uv", slot, host),
    }),
    readiness: () => readinessText(new Frame(port)),
    facial: Object.freeze({ snapshot: () => port.facial.snapshot(), retry: () => port.facial.retry() }),
    presets: Object.freeze({
      list: () => port.presets.list(owner),
      capability: (request: FeaturePresetRequest) => port.presets.capability({ ...request, feature: owner } as PartPresetRequest),
      execute: (request: FeaturePresetRequest) => port.presets.execute({ ...request, feature: owner } as PartPresetRequest),
    }),
  } satisfies FeatureViewContext);
}

/** A feature view's palette commands, rendered as the shell's commands (capability and dispatch through its facade). */
export function featureCommands(binding: FeatureViewBinding, ctx: FeatureViewContext): Command[] {
  return (binding.commands?.(ctx as never) ?? []).map(command => ({
    id: command.id, title: command.title, group: command.group,
    ...defined({ icon: command.icon, shortcut: command.shortcut, keywords: command.keywords }),
    capability: () => command.action ? ctx.facade.capability(command.action) : { available: false, reason: command.unavailable },
    run: () => { if (command.action) ctx.dispatch(command.action); },
  }));
}

/** A module view's context over `port.module(owner)`. Refuses an owner the composition registered no service for. */
export function moduleViewContext(rt: StudioRuntime, owner: string): ModuleViewContext {
  const facade = rt.port.module(owner);
  if (!facade) throw Error(`The ${owner} view has no registered module service.`);
  return Object.freeze({
    facade,
    dispatch: async (action: { kind: string }, options?: Parameters<StudioRuntime["report"]>[2]) => {
      let outcome: Awaited<ReturnType<typeof facade.dispatch>>;
      try { outcome = await facade.dispatch(action); }
      catch { outcome = { ok: false, code: "unavailable", message: "That didn't work. Try again." }; }
      const ok = rt.report(action.kind, outcome.ok ? { ok: true as const }
        : { ok: false as const, code: outcome.code ?? "invalid_value", message: outcome.message ?? "That can't be done now." }, options);
      rt.changed();
      return ok;
    },
    feedback: Object.freeze({
      toast: (...args: Parameters<StudioRuntime["feedback"]["toast"]>) => rt.feedback.toast(...args),
      announce: (...args: Parameters<StudioRuntime["feedback"]["announce"]>) => rt.feedback.announce(...args),
      record: (...args: Parameters<StudioRuntime["feedback"]["record"]>) => rt.feedback.record(...args),
    }),
    anchors: Object.freeze({ register: (...args: Parameters<StudioRuntime["anchors"]["register"]>) => rt.anchors.register(...args) }),
    reveal: (panel: string, focus?: boolean) => rt.dock.reveal(panel, focus),
    openSettings: (section?: Parameters<StudioRuntime["settings"]["open"]>[0]) => rt.settings.open(section),
    links: Object.freeze({ open: (link: Parameters<typeof rt.port.links.open>[0]) => rt.port.links.open(link) }),
    changed: () => rt.changed(),
  } satisfies ModuleViewContext);
}
