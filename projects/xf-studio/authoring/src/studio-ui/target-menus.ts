import { captureRuntime, capturedItems } from "./captured-runtime";
import type { StudioCapability, StudioTarget } from "../app/studio-application";
import type { PresentationAction } from "../app/studio-presentation";
import type { StudioBoundContext } from "../app/studio-context-targets";
import { chordLabel, keyBindingById, shortcutLabel, TARGET_LABELS } from "../app/input-bindings";
import type { ViewportHostKind } from "../app/viewport-attachment";
import { scaleText } from "./dom";
import { isIconName, type IconName } from "./icons";
import { menuFromSections, openMenu, openValuePopover, type MenuAnchor, type MenuItem, type MenuSection } from "./menu";
import type { StudioRuntime } from "./runtime";
import type { ModuleService } from "../platform/api";

/** Module-owned row targets use the same menu sections and captured-runtime gate as feature rows. */
export function moduleTargetMenu(facade:ModuleService, definition:{title:string;label:string;items:readonly {label:string;action:{kind:string}}[]},
  dispatch:(action:{kind:string})=>void,anchor:MenuAnchor,options:Omit<Parameters<typeof openMenu>[2],"label">) {
  const items=menuFromSections([{label:definition.label,items:definition.items.map(item=>({kind:"action" as const,label:item.label,
    capability:facade.capability(item.action),run:()=>dispatch(item.action)}))}]);
  return openMenu(items,anchor,{...options,label:definition.title});
}

type Query = ReturnType<StudioRuntime["port"]["authoring"]["contextQuery"]>;
type Option = Query["options"][number];
export const CONTEXT_LABELS: Readonly<Record<string, [string, IconName?]>> = {
  "preset.add": ["Add preset", "plus"], "preset.restore": ["Restore removed preset", "reset"],
  "collection.undoOpen": ["Reopen previous collection", "undo"], "collection.rename": ["Rename collection…", "rename"],
  "preset.select": ["Edit this preset", "target"], "preset.copy": ["Duplicate preset", "duplicate"],
  "preset.remove": ["Remove preset", "trash"], "preset.rename": ["Rename…", "rename"], "preset.move": ["Move to position…", "arrowDown"],
};
const labels = CONTEXT_LABELS;
/** Recovery wording for destructive menu entries, from the action's Undo policy: verb first either way (C-8). */
export const undoHint = (undo: string, id: string) => id.endsWith(".remove") || id === "preset.remove"
  ? undo === "recovery" ? "Restore from the Presets panel" : `Undo with ${shortcutLabel("shell.undo")}` : undefined;
/** Row reorder chords from the catalogue ("Alt+↑", "Alt+↓"). */
const reorderKey = (index: 0 | 1) => chordLabel(keyBindingById("rows.reorder").chords[index]);

/** Menu items for an application-bound context. Every dispatch rechecks the binding. */
export function contextItems(rt: StudioRuntime, query: Query, anchor: MenuAnchor): MenuItem[] {
  // A stale or missing target needs no heading of its own: each entry is disabled with that reason.
  const items: MenuItem[] = [];
  for (const option of query.options) {
    const [label, iconName] = option.label ? [option.label, option.icon && isIconName(option.icon) ? option.icon : undefined] : labels[option.id] ?? [option.id];
    if (!option.requiresInput) {
      const action = option.action;
      items.push({ kind: "action", label, icon: iconName,
        capability: option.capability, checked: option.checked,
        // Danger only where Undo or recovery can't bring it back ([c-buttons], release-readiness-audit.md C-22).
        danger: option.id.endsWith(".remove") && option.undo === "none", hint: undoHint(option.undo, option.id),
        run: () => dispatchBound(rt, query.context, action) });
      continue;
    }
    items.push({ kind: "action", label, icon: iconName, capability: option.capability,
      run: () => openInput(rt, query.context, option, anchor) });
  }
  return items;
}
function dispatchBound(rt: StudioRuntime, context: StudioBoundContext, action: PresentationAction) {
  const result = rt.port.authoring.dispatchContext(context, action);
  if (!result.ok) rt.feedback.toast("warning", "Context menu", result.message);
}

function openInput(origin: StudioRuntime, inputContext: StudioBoundContext, option: Extract<Option, { requiresInput: true }>, anchor: MenuAnchor) {
  // A child owns an independent application facade. Validate the parent's original hit before
  // transferring it, then bind the same hit in the child instead of retaining the parent's identity.
  const allowed = origin.port.authoring.contextOptionsFor(inputContext).find(item => item.id === option.id)?.capability;
  if (!allowed?.available) { origin.feedback.toast("warning", "Context menu", allowed?.reason ?? "That menu is no longer available."); return; }
  const held = captureRuntime(origin), rt = held.runtime;
  const valuePopover: typeof openValuePopover = (field, anchor, options) => openValuePopover(field, anchor, { ...options, signal: held.signal, onClose: () => { options.onClose?.(); held.release(); } });
  const port = rt.port, context = port.authoring.contextFor(inputContext.hit), hit = context.hit;
  const bound = (action: PresentationAction) => port.authoring.boundActionCapability(context, action);
  const commit = (action: PresentationAction) => dispatchBound(rt, context, action);
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  if (option.input) {
    const { title, apply, format, field: inputField, ...field } = option.input;
    const range = rt.range(option.actionKind, inputField ?? "value", option.variant);
    const make = (value: string | number) => port.authoring.contextInputAction(context, option.id, value);
    valuePopover({ ...field, ...(field.kind === "range" ? range : {}),
      ...(format ? { format: format === "percent" ? percent : scaleText(range.min, range.max) } : {}) } as Parameters<typeof openValuePopover>[0], anchor,
      { title, apply, validate: value => { const action = make(value); return action ? bound(action) : { available: false, reason: "That menu is no longer available." }; },
        commit: value => { const action = make(value); if (action) commit(action); } });
  } else if (option.id === "preset.rename" && hit.kind === "preset") {
    const preset = port.library.summary().draft?.presets.find(item => item.id === hit.id);
    const make = (name: string): PresentationAction => ({ kind: "preset.edit", command: { kind: "rename", id: hit.id, name } });
    valuePopover({ kind: "text", label: "Preset name", value: preset?.name ?? "", maxLength: 120 }, anchor,
      { title: "Rename preset", apply: "Rename", validate: value => bound(make(String(value))), commit: value => commit(make(String(value))) });
  } else if (option.id === "preset.move" && hit.kind === "preset") {
    const presets = port.library.summary().draft?.presets ?? [], index = presets.findIndex(item => item.id === hit.id);
    const make = (position: number): PresentationAction => ({ kind: "preset.edit", command: { kind: "move", id: hit.id, to: position - 1 } });
    valuePopover({ kind: "integer", label: `Position (1–${presets.length})`, value: index + 1, min: 1, max: presets.length }, anchor,
      { title: "Move preset", apply: "Move", validate: value => bound(make(Number(value))), commit: value => commit(make(Number(value))) });
  } else if (option.id === "collection.rename") {
    const name = port.library.summary().draft?.name ?? "";
    const make = (value: string): PresentationAction => ({ kind: "collection.rename", name: value });
    valuePopover({ kind: "text", label: "Collection name", value: name, maxLength: 120 }, anchor,
      { title: "Rename collection", apply: "Rename", validate: value => bound(make(String(value))), commit: value => commit(make(String(value))) });
  }
}

/** Extra platform commands for a known target (a preset), checked with the hit target's identity, not the selection. */
export function targetAction(rt: StudioRuntime, target: StudioTarget, action: PresentationAction, label: string,
  iconName?: IconName, extra: Partial<Extract<MenuItem, { kind: "action" }>> = {}): MenuItem {
  const capability: StudioCapability = rt.port.authoring.contextCapability(target, action);
  return { kind: "action", label, icon: iconName, capability, ...extra, run: () => { rt.dispatch(action); } };
}

/*
 * Context menus are actionable, not informational: every menu below is built from sections, and
 * `menuFromSections` drops any section with no action. Target-specific actions come first, then
 * view actions. Nothing here decides availability; each entry carries the application's capability.
 * A feature's own targets (eye makeup's layers) get their menus from its view (`FeatureTargetMenu`,
 * rendered by `views/feature-context.ts`).
 */
export function presetSections(rt: StudioRuntime, presetId: string, anchor: MenuAnchor): MenuSection[] {
  const port = rt.port, draft = port.library.summary().draft;
  const presets = draft?.presets ?? [], index = presets.findIndex(preset => preset.id === presetId);
  const preset = presets[index];
  if (!preset) return [];
  const target: StudioTarget = { kind: "preset", id: presetId };
  const query = port.authoring.contextQuery({ kind: "preset", id: presetId });
  return [{ label: preset.name, detail: `${preset.layers} ${preset.layers === 1 ? "layer" : "layers"} · preset ${index + 1} of ${presets.length}`,
    items: contextItems(rt, query, anchor) },
  { items: [
    targetAction(rt, target, { kind: "preset.edit", command: { kind: "move", id: presetId, to: index - 1 } }, "Move up", "arrowUp", { shortcut: reorderKey(0) }),
    targetAction(rt, target, { kind: "preset.edit", command: { kind: "move", id: presetId, to: index + 1 } }, "Move down", "arrowDown", { shortcut: reorderKey(1) }),
  ] }];
}
export function presetMenu(origin: StudioRuntime, presetId: string, anchor: MenuAnchor, invoker?: Element) {
  const held = captureRuntime(origin), rt = held.runtime;
  const preset = rt.port.library.summary().draft?.presets.find(item => item.id === presetId);
  if (!preset) { held.release(); return; }
  if (!openMenu(capturedItems(menuFromSections(presetSections(rt, presetId, anchor)), held.active), anchor, { label: `${preset.name} preset actions`, invoker, signal: held.signal, onClose: held.release })) held.release();
}

export function collectionSections(rt: StudioRuntime, anchor: MenuAnchor): MenuSection[] {
  const query = rt.port.authoring.contextQuery({ kind: "collection" });
  return [{ label: rt.port.library.summary().draft?.name ?? "Collection", items: contextItems(rt, query, anchor) }];
}
export function collectionMenu(origin: StudioRuntime, anchor: MenuAnchor, invoker?: Element) {
  const held = captureRuntime(origin), rt = held.runtime;
  if (!openMenu(capturedItems(menuFromSections(collectionSections(rt, anchor)), held.active), anchor, { label: "Collection actions", invoker, signal: held.signal, onClose: held.release })) held.release();
}

/** View commands never edit, so they follow any target section. */
function viewSection(rt: StudioRuntime, kind: ViewportHostKind): MenuSection {
  const port = rt.port;
  if (kind === "uv") {
    const view = port.viewport.snapshot().uv?.view;
    const command = (id: "both" | "single" | "other" | "fit", label: string): MenuItem => ({ kind: "action", label, shortcut: shortcutLabel(`uv.${id}`),
      capability: port.viewport.uvCommandCapability(id), checked: id === "both" ? view?.mode === "both" : id === "single" ? view?.mode === "single" : undefined,
      run: () => { port.viewport.uvCommand(id); } });
    return { label: "UV view", items: [command("both", "Both eyes"), command("single", "Single eye"), command("other", "Other eye"), command("fit", "Fit shape")] };
  }
  // The same derived tool list as the view's toolbar (view-graph-design.md §3.9): research tools only with research tools on.
  return { label: "3D view", items: port.views.tools(undefined, rt.toolFilter()).filter(tool => tool.shown).map(tool => ({
    kind: "action" as const, label: tool.label, icon: isIconName(tool.icon) ? tool.icon : "dot",
    ...(tool.binding ? { shortcut: shortcutLabel(tool.binding) } : {}), ...(tool.state === "tools" ? { checked: !!tool.on } : {}),
    capability: tool.capability, run: () => { rt.dispatch(tool.action); } })) };
}

/**
 * Sections for a viewport position (pointer) or the selected point (keyboard). The hit section
 * comes first; bare skin, empty UV space and background have no target actions, so their menu
 * is the view section alone.
 */
export function viewportSections(rt: StudioRuntime, kind: ViewportHostKind, anchor: MenuAnchor, at?: { x: number; y: number }): MenuSection[] {
  const port = rt.port, sections: MenuSection[] = [];
  const query = at ? port.viewport.contextAt(kind, at.x, at.y) : undefined;
  if (query) {
    const detail = [port.authoring.contextDetail(query.context.hit), query.mirror ? "mirrored copy" : undefined].filter(Boolean).join(" · ") || undefined;
    sections.push({ label: TARGET_LABELS[kind][query.affordance], detail, items: contextItems(rt, query, anchor) });
  } else if (!at) {
    const selected = port.authoring.contextSelected();
    if (selected) sections.push({ label: selected.label, detail: selected.detail,
      items: contextItems(rt, port.authoring.contextQuery(selected.hit), anchor) });
  }
  sections.push(viewSection(rt, kind));
  return sections;
}
export function viewportMenu(origin: StudioRuntime, kind: ViewportHostKind, anchor: MenuAnchor, at?: { x: number; y: number }, invoker?: Element) {
  const held = captureRuntime(origin), rt = held.runtime;
  if (!openMenu(capturedItems(menuFromSections(viewportSections(rt, kind, anchor, at)), held.active), anchor, { label: `${kind === "head" ? "3D view" : "UV map"} commands`, invoker, signal: held.signal, onClose: held.release })) held.release();
}
