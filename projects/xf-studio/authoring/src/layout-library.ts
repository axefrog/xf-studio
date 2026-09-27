import type { DockLayout, UIPreferences } from "./ui-preferences";

/**
 * Saved layouts (research/authoring/view-graph-design.md §4.5): named dock arrangements, each optionally with the modules it shows,
 * kept in the workspace's UI preferences beside the live arrangement. Pure presentation state: the dock document is opaque here (the
 * dock engine owns its meaning and applies it through its recovery gate), and nothing touches a look, a collection, Undo or an export.
 *
 * The active layout's working state is the live arrangement (`UIPreferences.layout`, and `modules` when it remembers them). Switching
 * away keeps a changed working state with the layout (`working`); switching back returns to it, Revert brings the saved one back and
 * Update makes the working state the saved one. A workspace without a library shows one layout, `FIRST_LAYOUT_NAME`, holding the live
 * arrangement: the library is written only by the first action that changes it, so an untouched workspace keeps its bytes.
 */
export const LAYOUT_LIBRARY = "xfs/layout-library-1";
export type LayoutSizeClass = "wide" | "compact";
/** Which modules show, by module ID (unknown IDs, from another build, are kept as they are). */
export type LayoutModules = Record<string, boolean>;
export type LayoutWorking = { dock: DockLayout; modules?: LayoutModules };
export type SavedLayout = {
  id: string; name: string;
  /** The saved arrangement. */
  dock: DockLayout;
  /** Present when the layout remembers which modules show: switching to it shows and hides modules to match. */
  modules?: LayoutModules;
  /** The size class it is switched to automatically when the window enters it (one layout per class). */
  autoSize?: LayoutSizeClass;
  /** The arrangement it was left with when it differed from the saved one (never on the active layout: that is the live one). */
  working?: LayoutWorking;
};
export type LayoutLibrary = { schema: typeof LAYOUT_LIBRARY; layouts: SavedLayout[]; active: string;
  /** The size class last seen, so a window that opens in another class counts as crossing into it. */
  seen?: LayoutSizeClass };

export const MAX_LAYOUTS = 24;
export const MAX_LAYOUT_NAME = 48;
export const MAX_LIBRARY_BYTES = 256 * 1024;
const MAX_MODULE_ENTRIES = 64;
export const FIRST_LAYOUT_NAME = "My layout";
const FIRST_ID = "l1";

/**
 * Every layout action carries `shown`, the modules showing now (the presentation knows each manifest's default), wherever it may take
 * a snapshot of the live state; `modified`, where the live arrangement is left, says whether it differs from the saved one (the dock
 * engine's question, answered by the presentation).
 */
export type LayoutAction =
  | { kind: "layouts.saveAs"; name: string; remember: boolean; autoSize?: LayoutSizeClass; shown: LayoutModules }
  | { kind: "layouts.update"; shown: LayoutModules }
  | { kind: "layouts.revert" }
  | { kind: "layouts.switch"; id: string; modified: boolean; shown: LayoutModules }
  | { kind: "layouts.rename"; id: string; name: string; shown: LayoutModules }
  | { kind: "layouts.duplicate"; id: string; shown: LayoutModules }
  | { kind: "layouts.delete"; id: string; shown: LayoutModules }
  | { kind: "layouts.insert"; layout: SavedLayout; index: number; activate: boolean; modified: boolean; shown: LayoutModules }
  | { kind: "layouts.setModules"; remember: boolean; shown: LayoutModules }
  | { kind: "layouts.setAutoSize"; size: LayoutSizeClass | null; shown: LayoutModules }
  | { kind: "layouts.seen"; size: LayoutSizeClass };
export const isLayoutAction = (action: { kind: string }): action is LayoutAction => action.kind.startsWith("layouts.");
export type LayoutPreferences = Pick<UIPreferences, "layout" | "modules" | "layouts">;
type Capability = { available: boolean; reason?: string };
type ParseDock = (value: unknown) => DockLayout | undefined;

const layoutId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
const moduleId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(value);
const sizeClass = (value: unknown): value is LayoutSizeClass => value === "wide" || value === "compact";
/** A layout name, trimmed; undefined when empty, too long or holding control characters. */
export function layoutName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= MAX_LAYOUT_NAME && !/[\u0000-\u001f\u007f]/.test(name) ? name : undefined;
}
function parseModules(value: unknown): LayoutModules | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([id, shown]) => moduleId(id) && typeof shown === "boolean").slice(0, MAX_MODULE_ENTRIES));
}
function parseWorking(value: unknown, parseDock: ParseDock): LayoutWorking | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>, dock = parseDock(input.dock);
  if (!dock) return undefined;
  const modules = input.modules === undefined ? undefined : parseModules(input.modules);
  return { dock, ...(modules ? { modules } : {}) };
}
/** One saved layout, validated; undefined for anything malformed. */
export function parseSavedLayout(value: unknown, parseDock: ParseDock): SavedLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>, name = layoutName(input.name), dock = parseDock(input.dock);
  if (!layoutId(input.id) || !name || !dock) return undefined;
  const modules = input.modules === undefined ? undefined : parseModules(input.modules);
  const working = input.working === undefined ? undefined : parseWorking(input.working, parseDock);
  return { id: input.id, name, dock, ...(modules ? { modules } : {}), ...(sizeClass(input.autoSize) ? { autoSize: input.autoSize } : {}),
    ...(working ? { working } : {}) };
}
/**
 * The stored library, validated and bounded; undefined when absent or holding no readable layout (the workspace then shows its one
 * first layout). A damaged entry is dropped, not the library: presentation state never invalidates authored work.
 */
export function parseLayoutLibrary(value: unknown, parseDock: ParseDock): LayoutLibrary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (input.schema !== LAYOUT_LIBRARY || !Array.isArray(input.layouts)) return undefined;
  const layouts: SavedLayout[] = [], ids = new Set<string>(), sizes = new Set<LayoutSizeClass>();
  for (const entry of input.layouts.slice(0, MAX_LAYOUTS)) {
    const layout = parseSavedLayout(entry, parseDock);
    if (!layout || ids.has(layout.id)) continue;
    ids.add(layout.id);
    // One layout per size class: a later claim is dropped.
    if (layout.autoSize) { if (sizes.has(layout.autoSize)) delete layout.autoSize; else sizes.add(layout.autoSize); }
    layouts.push(layout);
  }
  if (!layouts.length) return undefined;
  const active = layoutId(input.active) && ids.has(input.active) ? input.active : layouts[0]!.id;
  // The active layout's working state is the live arrangement.
  delete layouts.find(layout => layout.id === active)!.working;
  return { schema: LAYOUT_LIBRARY, layouts, active, ...(sizeClass(input.seen) ? { seen: input.seen } : {}) };
}

/** The library as the person sees it: the stored one, or the first layout holding the live arrangement. */
export function layoutLibraryOf(prefs: LayoutPreferences, shown: LayoutModules = {}): LayoutLibrary {
  if (prefs.layouts) return prefs.layouts;
  return { schema: LAYOUT_LIBRARY,
    layouts: [{ id: FIRST_ID, name: FIRST_LAYOUT_NAME, dock: prefs.layout ?? { format: "none", version: 1, state: {} }, modules: { ...shown } }], active: FIRST_ID };
}
export const activeLayout = (library: LayoutLibrary) => library.layouts.find(layout => layout.id === library.active)!;
const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
/** A name no other layout has: `base`, else `base 2`, `base 3`… (kept within the length limit). */
export function uniqueLayoutName(library: LayoutLibrary, base: string, except?: string): string {
  const taken = (name: string) => library.layouts.some(layout => layout.id !== except && sameName(layout.name, name));
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`, name = `${base.slice(0, MAX_LAYOUT_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!taken(name)) return name;
  }
}
/** The name offered for a new layout ("Layout 2", "Layout 3"…). */
export const nextLayoutName = (library: LayoutLibrary) => uniqueLayoutName(library, `Layout ${library.layouts.length + 1}`);
/** Why a name can't be used for a layout, or undefined when it can. */
export function layoutNameProblem(library: LayoutLibrary, value: unknown, except?: string): string | undefined {
  const name = layoutName(value);
  if (!name) return typeof value === "string" && value.trim().length > MAX_LAYOUT_NAME ? `Keep the name to ${MAX_LAYOUT_NAME} characters.` : "Give the layout a name.";
  return library.layouts.some(layout => layout.id !== except && sameName(layout.name, name)) ? `A layout is already called “${name}”.` : undefined;
}
/**
 * The layout to switch to automatically for a window in `size`: on a crossing into it, or when the window opens in a class other than
 * the one last seen (`crossing` false: the Studio just started). A manual choice is never overridden within a class.
 */
export function autoSwitchTarget(library: LayoutLibrary | undefined, size: LayoutSizeClass, crossing: boolean): SavedLayout | undefined {
  if (!library || (!crossing && (!library.seen || library.seen === size))) return undefined;
  const target = library.layouts.find(layout => layout.autoSize === size);
  return target && target.id !== library.active ? target : undefined;
}

const nextId = (library: LayoutLibrary) => `l${Math.max(0, ...library.layouts.map(layout => Number(/^l(\d+)$/.exec(layout.id)?.[1] ?? 0))) + 1}`;
/** The layout's module map with this build's current choices over it (entries this build doesn't know are kept). */
const withShown = (saved: LayoutModules | undefined, shown: LayoutModules): LayoutModules => ({ ...saved, ...shown });
/** Apply a layout's modules to the live preference (bounded like `UIPreferences.modules`). */
function applyModules(prefs: LayoutPreferences, modules: LayoutModules | undefined) {
  if (!modules) return;
  const merged = Object.entries({ ...prefs.modules, ...modules }).slice(0, MAX_MODULE_ENTRIES);
  if (merged.length) prefs.modules = Object.fromEntries(merged);
}
/** Make `target` the live arrangement: its working state when it has one, else its saved one. */
function goLive(prefs: LayoutPreferences, library: LayoutLibrary, target: SavedLayout) {
  const next = target.working ?? { dock: target.dock, modules: target.modules };
  prefs.layout = structuredClone(next.dock);
  if (target.modules) applyModules(prefs, next.modules ?? target.modules);
  delete target.working;
  library.active = target.id;
}
/** Leave the active layout: its changed working state stays with it. */
function leave(prefs: LayoutPreferences, library: LayoutLibrary, modified: boolean, shown: LayoutModules) {
  const current = activeLayout(library);
  if (modified && prefs.layout) current.working = { dock: structuredClone(prefs.layout), ...(current.modules ? { modules: withShown(current.modules, shown) } : {}) };
  else delete current.working;
}

/** Whether a layout action can run now, and why not in plain words. Validates the whole action, as dispatch revalidates. */
export function layoutCapability(prefs: LayoutPreferences, action: LayoutAction, parseDock: ParseDock): Capability {
  const refuse = (reason: string): Capability => ({ available: false, reason });
  if (action.kind === "layouts.seen") return sizeClass(action.size) ? { available: true } : refuse("Choose wide or compact.");
  if (action.kind !== "layouts.revert" && !parseModules(action.shown)) return refuse("Say which modules are shown.");
  if (!prefs.layout && action.kind !== "layouts.revert") return refuse("The panel layout isn't ready yet. Try again in a moment.");
  const library = layoutLibraryOf(prefs, action.kind === "layouts.revert" ? {} : action.shown);
  const known = (id: string) => library.layouts.some(layout => layout.id === id);
  switch (action.kind) {
    case "layouts.saveAs": {
      if (library.layouts.length >= MAX_LAYOUTS) return refuse(`You have ${MAX_LAYOUTS} layouts, the most XF Studio keeps. Delete one first.`);
      const problem = layoutNameProblem(library, action.name);
      if (problem) return refuse(problem);
      if (typeof action.remember !== "boolean" || (action.autoSize !== undefined && !sizeClass(action.autoSize))) return refuse("Choose the layout's options.");
      break;
    }
    case "layouts.revert": if (!prefs.layouts) return refuse("This layout has no other saved arrangement yet."); break;
    case "layouts.switch":
      if (!known(action.id)) return refuse("That layout no longer exists.");
      if (action.id === library.active) return refuse("This is the current layout.");
      break;
    case "layouts.rename": {
      if (!known(action.id)) return refuse("That layout no longer exists.");
      const problem = layoutNameProblem(library, action.name, action.id);
      if (problem) return refuse(problem);
      break;
    }
    case "layouts.duplicate":
      if (!known(action.id)) return refuse("That layout no longer exists.");
      if (library.layouts.length >= MAX_LAYOUTS) return refuse(`You have ${MAX_LAYOUTS} layouts, the most XF Studio keeps. Delete one first.`);
      break;
    case "layouts.delete":
      if (!known(action.id)) return refuse("That layout no longer exists.");
      if (library.layouts.length <= 1) return refuse("This is your only layout. Save another before deleting it.");
      break;
    case "layouts.insert":
      if (!parseSavedLayout(action.layout, parseDock)) return refuse("That layout can't be read.");
      if (library.layouts.length >= MAX_LAYOUTS) return refuse(`You have ${MAX_LAYOUTS} layouts, the most XF Studio keeps. Delete one first.`);
      break;
    case "layouts.setModules": if (typeof action.remember !== "boolean") return refuse("Choose whether the layout remembers modules."); break;
    case "layouts.setAutoSize": if (action.size !== null && !sizeClass(action.size)) return refuse("Choose wide, compact or never."); break;
  }
  // The library stays small: it is stored with the workspace.
  const next = applyLayoutAction(prefs, action, parseDock).layouts;
  if (next && JSON.stringify(next).length > MAX_LIBRARY_BYTES && JSON.stringify(next).length > JSON.stringify(prefs.layouts ?? "").length)
    return refuse("Your saved layouts are using all the space kept for them. Delete a layout first.");
  return { available: true };
}

/**
 * Apply a layout action (already allowed by `layoutCapability`) to a copy of the preferences: the live arrangement, the live modules and
 * the library change together, in one step. The presentation then loads the live arrangement into the dock.
 */
export function applyLayoutAction<T extends LayoutPreferences>(prefs: T, action: LayoutAction, parseDock: ParseDock): T {
  const next = structuredClone(prefs);
  if (action.kind === "layouts.seen") {
    // Recorded only once there is a library: a workspace that never saved a layout keeps its bytes.
    if (next.layouts) next.layouts.seen = action.size;
    return next;
  }
  const shown = action.kind === "layouts.revert" ? {} : action.shown;
  const library = structuredClone(layoutLibraryOf(next, shown));
  const current = activeLayout(library);
  switch (action.kind) {
    case "layouts.saveAs": {
      // "Save as": the arrangement goes into the new layout; the one left keeps its saved arrangement.
      delete current.working;
      const layout: SavedLayout = { id: nextId(library), name: layoutName(action.name)!, dock: structuredClone(next.layout!),
        ...(action.remember ? { modules: { ...shown } } : {}) };
      if (action.autoSize) { for (const other of library.layouts) if (other.autoSize === action.autoSize) delete other.autoSize; layout.autoSize = action.autoSize; }
      library.layouts.splice(library.layouts.indexOf(current) + 1, 0, layout);
      library.active = layout.id;
      break;
    }
    case "layouts.update":
      current.dock = structuredClone(next.layout!);
      if (current.modules) current.modules = withShown(current.modules, shown);
      delete current.working;
      break;
    case "layouts.revert": goLive(next, library, current); break;
    case "layouts.switch":
      leave(next, library, action.modified, shown);
      goLive(next, library, library.layouts.find(layout => layout.id === action.id)!);
      break;
    case "layouts.rename": library.layouts.find(layout => layout.id === action.id)!.name = layoutName(action.name)!; break;
    case "layouts.duplicate": {
      const source = library.layouts.find(layout => layout.id === action.id)!, live = source.id === library.active;
      const state: LayoutWorking = live ? { dock: next.layout!, ...(source.modules ? { modules: withShown(source.modules, shown) } : {}) }
        : source.working ?? { dock: source.dock, ...(source.modules ? { modules: source.modules } : {}) };
      const copy: SavedLayout = { id: nextId(library), name: uniqueLayoutName(library, `${source.name.slice(0, MAX_LAYOUT_NAME - 5).trimEnd()} copy`),
        dock: structuredClone(state.dock), ...(state.modules ? { modules: { ...state.modules } } : {}) };
      library.layouts.splice(library.layouts.indexOf(source) + 1, 0, copy);
      break;
    }
    case "layouts.delete": {
      const index = library.layouts.findIndex(layout => layout.id === action.id);
      if (action.id === library.active) goLive(next, library, library.layouts[index + 1] ?? library.layouts[index - 1]!);
      library.layouts.splice(index, 1);
      break;
    }
    case "layouts.insert": {
      const layout = parseSavedLayout(action.layout, parseDock)!;
      if (library.layouts.some(other => other.id === layout.id)) layout.id = nextId(library);
      layout.name = uniqueLayoutName(library, layout.name);
      if (layout.autoSize && library.layouts.some(other => other.autoSize === layout.autoSize)) delete layout.autoSize;
      library.layouts.splice(Math.max(0, Math.min(Math.trunc(action.index) || 0, library.layouts.length)), 0, layout);
      if (action.activate) { leave(next, library, action.modified, shown); goLive(next, library, layout); }
      break;
    }
    case "layouts.setModules":
      if (action.remember) current.modules = withShown(current.modules, shown); else delete current.modules;
      break;
    case "layouts.setAutoSize":
      for (const other of library.layouts) if (action.size && other.autoSize === action.size) delete other.autoSize;
      if (action.size) current.autoSize = action.size; else delete current.autoSize;
      break;
  }
  next.layouts = library;
  return next;
}
