import { activeLayout, autoSwitchTarget, layoutLibraryOf, layoutNameProblem, MAX_LAYOUT_NAME, nextLayoutName,
  type LayoutAction, type LayoutLibrary, type LayoutModules, type LayoutPreferences, type LayoutSizeClass, type SavedLayout } from "../layout-library";
import type { StudioModule } from "../platform/api";
import type { Command } from "./commands";
import type { DockView, PanelSpec } from "./dock/dock-view";
import type { PanelId, Rect } from "./dock/layout";
import { restoreDockPreference, sameDockState, serializeDockState } from "./dock/persist";
import type { Feedback } from "./feedback";
import { COMPACT_BREAKPOINT } from "./layout-defaults";
import { openValuePopover, type MenuAnchor, type MenuItem } from "./menu";
import type { Port } from "./runtime";
import type { ViewCatalogue } from "./views/contribution";

/** What the saved-layouts controller needs from the shell: the dock, the modules and the panels, never the application. */
export type LayoutHost = {
  port: Port; feedback: Feedback; dock: DockView; catalogue: ViewCatalogue;
  modules: readonly StudioModule[];
  shownModules(): string[];
  /** The panels of hidden modules (withdrawn from the dock). */
  parkedPanels(): PanelId[];
  /** Every panel's spec, in catalogue order. */
  panelSpecs(): PanelSpec[];
  /** The dock's work area, for the recovery gate. */
  area(): Rect;
  /** Before modules may hide: finish an open gesture or form edit. */
  finishInput(): void;
  /** After the live arrangement or modules changed: derive the rest (view tools) and repaint. */
  changed(): void;
};

const SIZE_TEXT: Record<LayoutSizeClass, string> = { wide: `wide windows (${COMPACT_BREAKPOINT} px and wider)`, compact: `compact windows (narrower than ${COMPACT_BREAKPOINT} px)` };
const quoted = (name: string) => `“${name}”`;

/**
 * Saved layouts in the presentation (view-graph-design.md §4.5): the Layouts menu, its palette commands and automatic switching by
 * window size. Every change is a `layouts.*` preference action; the controller then loads the live arrangement into the dock and lets
 * the shell derive the rest, exactly as a module toggle does. It decides one thing itself: whether the live arrangement differs from
 * the saved one, by comparing both through the dock's recovery gate.
 */
export function layoutController(host: LayoutHost) {
  const { port, feedback, dock } = host;
  // A snapshot is a detached copy (structuredClone), so reading it as the plain preference shape is safe.
  const prefs = () => port.preferences.snapshot() as unknown as LayoutPreferences;
  const shown = (): LayoutModules => { const on = new Set(host.shownModules()); return Object.fromEntries(host.modules.map(module => [module.id, on.has(module.id)])); };
  const library = (): LayoutLibrary => layoutLibraryOf(prefs(), shown());
  const live = () => serializeDockState(dock.dockState);
  const restore = (saved: unknown) => restoreDockPreference(saved, host.area(), host.catalogue, host.parkedPanels()).state;

  /** Whether the active layout's live arrangement (or, if it remembers them, its modules) differs from its saved one. Cached per state. */
  let cache: { key: string; modified: boolean } | undefined;
  function modified(): boolean {
    const stored = prefs().layouts;
    if (!stored) return false;
    const active = activeLayout(stored), now = shown(), current = live();
    const key = JSON.stringify([active.id, active.dock, active.modules ?? null, now, current]);
    if (cache?.key === key) return cache.modified;
    const modules = !!active.modules && host.modules.some(module => module.id in active.modules! && active.modules![module.id] !== now[module.id]);
    const result = modules || !sameDockState(restore(active.dock), restore(current));
    cache = { key, modified: result };
    return result;
  }
  /** The live arrangement must be a stored preference before the library takes a snapshot of it. */
  function ensureLive() {
    if (prefs().layout) return;
    const layout = live();
    if (port.preferences.capability({ kind: "layout.set", layout }).available) port.preferences.dispatch({ kind: "layout.set", layout });
  }
  function dispatch(action: LayoutAction): boolean {
    ensureLive();
    const allowed = port.preferences.capability(action);
    if (!allowed.available) { feedback.toast("warning", "Layouts", allowed.reason ?? "The layouts could not be changed."); return false; }
    try { port.preferences.dispatch(action); }
    catch (error) { feedback.toast("warning", "Layouts", error instanceof Error ? error.message : "The layouts could not be changed."); return false; }
    return true;
  }
  /** Load the live arrangement (and the modules it shows) into the dock after an action that changed it. */
  function applyLive(message: string) {
    const parked = host.parkedPanels(), saved = prefs().layout;
    dock.load(restore(saved), host.panelSpecs().filter(spec => !parked.includes(spec.id)), message);
    host.changed();
  }

  function switchTo(id: string, auto?: LayoutSizeClass) {
    const from = activeLayout(library()), target = library().layouts.find(layout => layout.id === id);
    if (!target) return;
    host.finishInput();
    if (!dispatch({ kind: "layouts.switch", id, modified: modified(), shown: shown() })) return;
    applyLive(`Layout: ${target.name}`);
    if (auto) feedback.toast("info", "Layouts", `Switched to ${quoted(target.name)} for ${auto} windows.`,
      [{ label: `Back to ${quoted(from.name)}`, run: () => switchTo(from.id) }]);
    else feedback.record("info", "Layouts", `Switched to ${quoted(target.name)}.`);
  }
  function saveAs(anchor: MenuAnchor) {
    const current = library();
    openValuePopover({ kind: "text", label: "Name", value: nextLayoutName(current), maxLength: MAX_LAYOUT_NAME }, anchor, {
      title: "Save layout", apply: "Save",
      validate: value => { const problem = layoutNameProblem(library(), value); return problem ? { available: false, reason: problem } : { available: true }; },
      options: [
        { label: "Remember shown modules", checked: true, help: "Switching to this layout shows and hides modules to match. Your work is never affected." },
        { label: `Switch to it in ${dock.sizeClass} windows`, checked: false,
          help: `Chosen automatically whenever the window becomes ${dock.sizeClass}. You can still pick another layout at any time.` }],
      commit: (name, [remember, auto]) => saveNamed(String(name), !!remember, auto ? dock.sizeClass : undefined) });
  }
  /** Save the live arrangement as a new layout, which becomes the current one. */
  function saveNamed(name: string, remember: boolean, autoSize?: LayoutSizeClass) {
    if (!dispatch({ kind: "layouts.saveAs", name, remember, ...(autoSize ? { autoSize } : {}), shown: shown() })) return false;
    feedback.toast("success", "Layouts", `Saved layout ${quoted(activeLayout(library()).name)}.`);
    return true;
  }
  function update() {
    const name = activeLayout(library()).name;
    if (dispatch({ kind: "layouts.update", shown: shown() })) feedback.record("success", "Layouts", `Changes saved to ${quoted(name)}.`);
  }
  function revert() {
    const name = activeLayout(library()).name;
    host.finishInput();
    if (dispatch({ kind: "layouts.revert" })) applyLive(`${name} reverted to its saved arrangement`);
  }
  function rename(anchor: MenuAnchor) {
    const layout = activeLayout(library());
    openValuePopover({ kind: "text", label: "Name", value: layout.name, maxLength: MAX_LAYOUT_NAME }, anchor, {
      title: "Rename layout", apply: "Rename",
      validate: value => { const problem = layoutNameProblem(library(), value, layout.id); return problem ? { available: false, reason: problem } : { available: true }; },
      commit: name => { if (dispatch({ kind: "layouts.rename", id: layout.id, name: String(name), shown: shown() })) feedback.announce(`Layout renamed ${String(name).trim()}`); } });
  }
  function duplicate() {
    const layout = activeLayout(library());
    if (!dispatch({ kind: "layouts.duplicate", id: layout.id, shown: shown() })) return;
    const copy = library().layouts[library().layouts.findIndex(item => item.id === layout.id) + 1];
    feedback.toast("success", "Layouts", `${quoted(copy?.name ?? "Copy")} made from ${quoted(layout.name)}.`, copy ? [{ label: `Switch to ${quoted(copy.name)}`, run: () => switchTo(copy.id) }] : []);
  }
  /** Delete the active layout; the notice's Undo puts it back, with the arrangement it had, and returns to it. */
  function remove() {
    const before = library(), layout = activeLayout(before), index = before.layouts.indexOf(layout), changed = modified();
    const kept: SavedLayout = { ...structuredClone(layout), ...(changed ? { working: { dock: live(), ...(layout.modules ? { modules: { ...layout.modules, ...shown() } } : {}) } } : {}) };
    host.finishInput();
    if (!dispatch({ kind: "layouts.delete", id: layout.id, shown: shown() })) return;
    const now = activeLayout(library());
    applyLive(`Layout ${layout.name} deleted; showing ${now.name}`);
    feedback.toast("info", "Layouts", `Layout ${quoted(layout.name)} deleted. Showing ${quoted(now.name)}.`, [{ label: "Undo", run: () => {
      host.finishInput();
      if (dispatch({ kind: "layouts.insert", layout: kept, index, activate: true, modified: modified(), shown: shown() })) applyLive(`Layout ${layout.name} restored`);
    } }]);
  }
  function setRemember(remember: boolean) {
    if (dispatch({ kind: "layouts.setModules", remember, shown: shown() }))
      feedback.announce(remember ? "This layout remembers which modules are shown" : "This layout leaves modules as they are");
  }
  function setAuto(size: LayoutSizeClass | null) {
    if (dispatch({ kind: "layouts.setAutoSize", size, shown: shown() }))
      feedback.announce(size ? `Switches to this layout in ${size} windows` : "No automatic switching for this layout");
  }
  /** Reset this size class to the factory arrangement; a first layout is saved first, so Revert to saved brings the person's back. */
  function resetFactory() {
    if (!prefs().layouts) dispatch({ kind: "layouts.update", shown: shown() });
    dock.reset();
  }

  /** What is different about a layout, for its menu row: nothing when it is as saved and chosen by hand (the check marks the current one). */
  const describe = (layout: SavedLayout, active: boolean) => [
    (active ? modified() : !!layout.working) ? "Changed" : "",
    layout.autoSize ? `In ${layout.autoSize} windows` : ""].filter(Boolean).join(" · ");
  const unchanged = { available: false, reason: "No changes since it was saved." };

  return {
    library, modified, switchTo, saveAs, saveNamed, update, revert, rename, duplicate, remove, setRemember, setAuto, resetFactory,
    /** The header button's label and its tooltip ("Layout: <name>"). */
    label() {
      const name = activeLayout(library()).name;
      return { name, title: `Layout: ${name}`, accessible: `Layout: ${name}${modified() ? ", changed" : ""}` };
    },
    /** The Layouts menu: the layouts, then the current one's commands in groups, then the factory reset. */
    menuItems(anchor: MenuAnchor): MenuItem[] {
      const current = library(), active = activeLayout(current), changed = modified(), only = current.layouts.length <= 1;
      const row = (layout: SavedLayout): MenuItem => {
        const hint = describe(layout, layout.id === current.active);
        return { kind: "action", label: layout.name, icon: "layouts", checked: layout.id === current.active, ...(hint ? { hint } : {}),
          run: () => { if (layout.id !== current.active) switchTo(layout.id); } };
      };
      // Unavailable because nothing changed is information, not a problem: the reason is muted.
      const whenChanged = changed ? {} : { capability: unchanged };
      return [
        { kind: "heading", label: "Layouts" },
        ...current.layouts.map(row),
        { kind: "separator" },
        { kind: "action", label: "Save changes", icon: "save", ...whenChanged, run: update },
        { kind: "action", label: "Revert to saved", icon: "undo", ...whenChanged, run: revert },
        { kind: "separator" },
        { kind: "action", label: "Save as new layout…", icon: "plus", run: () => saveAs(anchor) },
        { kind: "action", label: "Rename…", icon: "rename", run: () => rename(anchor) },
        { kind: "action", label: "Delete", icon: "trash", danger: true,
          ...(only ? { capability: { available: false, reason: "This is your only layout. Save another before deleting it." } } : {}), run: remove },
        { kind: "separator" },
        { kind: "action", label: "Remember shown modules", icon: "category", checked: !!active.modules, run: () => setRemember(!active.modules) },
        { kind: "submenu", label: "Switch to it automatically", icon: "monitor", ...(active.autoSize ? { hint: `In ${active.autoSize} windows` } : {}), items: () => [
          { kind: "action", label: "Never", checked: !active.autoSize, run: () => setAuto(null) },
          ...(["wide", "compact"] as const).map((size): MenuItem => {
            const other = current.layouts.find(layout => layout.autoSize === size && layout.id !== active.id);
            return { kind: "action", label: `In ${SIZE_TEXT[size]}`, checked: active.autoSize === size, ...(other ? { hint: `Instead of ${quoted(other.name)}` } : {}),
              run: () => setAuto(size) };
          })] },
        { kind: "separator" },
        { kind: "action", label: "Reset to factory layout", icon: "reset", hint: "Revert to saved brings yours back", run: resetFactory },
      ];
    },
    /** The palette's Layout commands. */
    commands(): Command[] {
      const current = library(), active = activeLayout(current), changed = modified();
      // Run from the palette, the name popover opens under the header's Layouts button, where the layouts live (C-33); only while that
      // button isn't shown does it open near the top of the window.
      const centre = (): MenuAnchor => {
        const header = document.querySelector<HTMLElement>(".shell-header .layouts-btn");
        return header?.getClientRects().length ? header : { x: Math.round(window.innerWidth / 2 - 140), y: 120 };
      };
      const always = { capability: () => ({ available: true }) };
      const keywords = "layout workspace arrangement panels";
      return [
        ...current.layouts.map(layout => ({ id: `layout.switch.${layout.id}`, title: `Layout: ${layout.name}`, group: "Layout", icon: "layouts" as const, keywords: `${keywords} switch`,
          capability: () => layout.id === current.active ? { available: false, reason: "This is the current layout." } : { available: true }, run: () => switchTo(layout.id) })),
        { id: "layout.saveAs", title: "Save layout…", group: "Layout", icon: "save", keywords: `${keywords} save new name`, ...always, run: () => saveAs(centre()) },
        { id: "layout.update", title: `Save changes to layout ${quoted(active.name)}`, group: "Layout", icon: "save", keywords,
          capability: () => changed ? { available: true } : unchanged, run: update },
        { id: "layout.revert", title: `Revert layout ${quoted(active.name)} to saved`, group: "Layout", icon: "undo", keywords: `${keywords} restore undo`,
          capability: () => changed ? { available: true } : unchanged, run: revert },
        { id: "layout.rename", title: `Rename layout ${quoted(active.name)}…`, group: "Layout", icon: "rename", keywords, ...always, run: () => rename(centre()) },
        { id: "layout.delete", title: `Delete layout ${quoted(active.name)}`, group: "Layout", icon: "trash", keywords: `${keywords} remove`,
          capability: () => current.layouts.length > 1 ? { available: true } : { available: false, reason: "This is your only layout. Save another before deleting it." }, run: remove },
      ];
    },
    /**
     * The window's size class: at start (`crossing` false) and whenever it changes. A layout chosen for that class is switched to,
     * unless it is already showing; within a class nothing re-applies, so a manual choice wins until the class changes again.
     */
    sizeClass(size: LayoutSizeClass, crossing: boolean) {
      const stored = prefs().layouts, target = autoSwitchTarget(stored, size, crossing);
      if (target) switchTo(target.id, size);
      if (stored && stored.seen !== size) dispatch({ kind: "layouts.seen", size });
    },
  };
}
export type LayoutController = ReturnType<typeof layoutController>;
