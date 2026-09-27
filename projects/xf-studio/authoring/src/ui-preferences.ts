import { applyLayoutAction, isLayoutAction, layoutCapability, parseLayoutLibrary, type LayoutAction, type LayoutLibrary } from "./layout-library";

/** Workspace-only preferences. A dock implementation owns the meaning of `state`. */
export type ThemePreference = "system" | "light" | "dark";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DockLayout = { format: string; version: number; state: JsonValue };
/** How a guided tour ended, or that its offer was declined; kept so an offer is made only once. */
export type TourRecord = "completed" | "skipped" | "declined";
/**
 * `inputHints`: contextual shortcut hints and target tooltips in the viewports (on by default).
 * `tours`: guided tour progress by tour ID (absent until a tour ends or its offer is declined).
 * `researchTools`: the Studio's research and calibration tools (lighting calibration, the glitter model studies, compiler plans,
 * developer IDs), off by default so the everyday interface shows only what a person uses (UI-85). Stored only once turned on.
 * `modules`: which Studio modules show (view-graph-design.md §4.2), by module ID, only where the person chose; a module not listed
 * follows its manifest's default. Presentation state: the application never reads it, and a hidden module's actions stay dispatchable.
 * `expanded`: whether each foldable heading, row or group is open (view-state.ts), by its view key (`<namespace>:<path>` or
 * `<namespace>.<path>`, e.g. `character:head/Hair`, `expressions.mouth`); absent: the control's own default. Least recently set first,
 * bounded per namespace and in all, so a row whose mod isn't loaded keeps its state until it shows again. The older `folded` list
 * (headings folded, open by default) is read into it. Presentation state, never Undo; per workspace, independent of saved layouts.
 * `scroll`: each remembered scroll container's anchor (scroll-anchor.ts): the element at its top edge and how far it is scrolled past,
 * by the container's view key (e.g. `panel:character`), least recently set first. Presentation state, never Undo.
 * `layouts`: the saved layouts (layout-library.ts, view-graph-design.md §4.5); `layout` is the active one's live arrangement. Absent until
 * the person first saves, renames or otherwise changes a layout.
 */
export type UIPreferences = { schema: "xfs/ui-preferences-1"; theme: ThemePreference; inputHints: boolean; layout?: DockLayout;
  tours?: Record<string, TourRecord>; researchTools?: boolean; modules?: Record<string, boolean>; expanded?: Record<string, boolean>;
  scroll?: Record<string, ScrollAnchor>; layouts?: LayoutLibrary;
  /**
   * The grid size of choice pictures per feature type (choice-previews-design.md §7.1: `s`, `m`, `l`), by the picture kind
   * (choice-preview.ts `PreviewKind`, e.g. `hair`); absent: the type's default. Presentation state, never Undo.
   */
  choiceSizes?: Record<string, ChoiceSize> };
export type ChoiceSize = "s" | "m" | "l";
/**
 * Where a scroll container was (scroll-anchor.ts): `key` is the view key of the element at its top edge and `offset` how many pixels
 * of it were scrolled past that edge; `near` the elements before it (nearest first, each with its own offset), tried in turn when it
 * is gone; `top` the plain scroll position, the last resort.
 */
export type ScrollAnchor = { key?: string; offset?: number; near?: { key: string; offset: number }[]; top: number };
export type UIPreferenceAction =
  | { kind: "theme.set"; theme: ThemePreference }
  | { kind: "inputHints.set"; enabled: boolean }
  | { kind: "researchTools.set"; enabled: boolean }
  | { kind: "modules.set"; module: string; shown: boolean }
  | { kind: "layout.set"; layout?: DockLayout }
  | { kind: "expanded.set"; keys: readonly string[]; expanded: boolean }
  | { kind: "scroll.set"; key: string; anchor?: ScrollAnchor }
  | { kind: "choiceSize.set"; type: string; size: ChoiceSize }
  | { kind: "tours.record"; tourId: string; outcome: TourRecord }
  | LayoutAction;
export type UIPreferenceCapability = { available: boolean; reason?: string };

const MAX_LAYOUT_BYTES = 128 * 1024;
const MAX_NODES = 8192;
const MAX_DEPTH = 32;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const MAX_TOURS = 64;
const tourId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(value);
const tourRecord = (value: unknown): value is TourRecord => value === "completed" || value === "skipped" || value === "declined";
const MAX_MODULES = 64;
const moduleId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/.test(value);
/** Remembered open states: at most this many per namespace, and in all (least recently set go first). */
const MAX_EXPANDED_PER_NAMESPACE = 192;
const MAX_EXPANDED = 512;
const MAX_SCROLL = 64;
const MAX_NEAR = 4;
const MAX_OFFSET = 1_000_000;
const MAX_CHOICE_TYPES = 32;
const choiceType = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value);
const choiceSize = (value: unknown): value is ChoiceSize => value === "s" || value === "m" || value === "l";
/**
 * A view key (view-state.ts): a namespace (a panel or feature id), a colon or dot, then its own path; no control characters, bounded.
 * Author and mod names may be in any script.
 */
export const viewKey = (value: unknown): value is string => typeof value === "string" && value.length <= 200 &&
  /^[a-z0-9][a-z0-9-]{0,31}[.:][^\u0000-\u001f\u007f]+$/u.test(value);
/** A view key's namespace: what comes before its first colon or dot (the bound per namespace goes by it). */
export const viewNamespace = (key: string) => /^[a-z0-9-]+/.exec(key)?.[0] ?? "";
/** An element key inside a scroll container: any text without control characters, bounded. */
const anchorKey = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
const offset = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_OFFSET;
export function parseScrollAnchor(value: unknown): ScrollAnchor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!offset(candidate.top) || candidate.top < 0) return undefined;
  const result: ScrollAnchor = { top: Math.round(candidate.top) };
  if (anchorKey(candidate.key) && offset(candidate.offset ?? 0)) { result.key = candidate.key; result.offset = Math.round((candidate.offset as number | undefined) ?? 0); }
  if (Array.isArray(candidate.near)) {
    const near = candidate.near.filter((entry): entry is { key: string; offset: number } => !!entry && typeof entry === "object" &&
      anchorKey((entry as Record<string, unknown>).key) && offset((entry as Record<string, unknown>).offset)).slice(0, MAX_NEAR)
      .map(entry => ({ key: entry.key, offset: Math.round(entry.offset) }));
    if (near.length) result.near = near;
  }
  return result;
}
/** The keys under `prefix` whose remembered state is folded (e.g. a panel's folded headings). */
export function foldedKeys(preferences: Pick<UIPreferences, "expanded"> | undefined, prefix = ""): string[] {
  return Object.entries(preferences?.expanded ?? {}).filter(([key, open]) => !open && key.startsWith(prefix)).map(([key]) => key);
}
/** Least recently set first: setting moves a key to the end, then the oldest go while its namespace or the whole map is over its bound. */
function remember<T>(map: Record<string, T> | undefined, entries: readonly (readonly [string, T | undefined])[], perNamespace: number, total: number) {
  const result = new Map(Object.entries(map ?? {}));
  for (const [key, value] of entries) { result.delete(key); if (value !== undefined) result.set(key, value); }
  const counts = new Map<string, number>();
  for (const key of result.keys()) counts.set(viewNamespace(key), (counts.get(viewNamespace(key)) ?? 0) + 1);
  for (const key of [...result.keys()]) {
    const namespace = viewNamespace(key);
    if ((counts.get(namespace) ?? 0) > perNamespace || result.size > total) { result.delete(key); counts.set(namespace, counts.get(namespace)! - 1); }
  }
  return result.size ? Object.fromEntries(result) : undefined;
}

export function defaultUIPreferences(): UIPreferences {
  return { schema: "xfs/ui-preferences-1", theme: "system", inputHints: true };
}

/** The selected preference is independent of the current OS colour scheme. */
export function effectiveTheme(theme: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  return theme === "system" ? systemPrefersDark ? "dark" : "light" : theme;
}

function theme(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** Bounded, lossless JSON validation; no dock-tree or positioning assumptions. */
function jsonCopy(value: unknown): JsonValue | undefined {
  const seen = new WeakSet<object>();
  let nodes = 0;
  function copy(item: unknown, depth: number): JsonValue | undefined {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return undefined;
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") return item.length <= MAX_LAYOUT_BYTES ? item : undefined;
    if (typeof item === "number") return Number.isFinite(item) ? item : undefined;
    if (!item || typeof item !== "object" || seen.has(item)) return undefined;
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(item)) return undefined;
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > MAX_NODES || Object.keys(item).length !== item.length) return undefined;
      const result: JsonValue[] = [];
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) return undefined;
        const child = copy(item[i], depth + 1);
        if (child === undefined) return undefined;
        result.push(child);
      }
      seen.delete(item);
      return result;
    }
    const result: { [key: string]: JsonValue } = {}, keys = Object.keys(item);
    if (keys.length > MAX_NODES) return undefined;
    for (const key of keys) {
      if (key.length > 256 || unsafeKeys.has(key)) return undefined;
      const child = copy((item as Record<string, unknown>)[key], depth + 1);
      if (child === undefined) return undefined;
      result[key] = child;
    }
    seen.delete(item);
    return result;
  }
  try {
    const result = copy(value, 0);
    if (result === undefined) return undefined;
    const encoded = JSON.stringify(result);
    return encoded && new TextEncoder().encode(encoded).length <= MAX_LAYOUT_BYTES
      ? result : undefined;
  } catch { return undefined; }
}

export function parseDockLayout(value: unknown): DockLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.format !== "string" || candidate.format.length > 80 ||
        !/^[a-z][a-z0-9._/-]*$/.test(candidate.format) ||
        !Number.isSafeInteger(candidate.version) || (candidate.version as number) < 1 ||
        (candidate.version as number) > 65535 ||
        !candidate.state || typeof candidate.state !== "object") return undefined;
    const state = jsonCopy(candidate.state);
    return state === undefined ? undefined : { format: candidate.format, version: candidate.version as number, state };
  } catch { return undefined; }
}

/** Missing/older/malformed preferences do not invalidate an authored workspace. */
export function parseUIPreferences(value: unknown): UIPreferences {
  const result = defaultUIPreferences();
  if (!value || typeof value !== "object") return result;
  try {
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== result.schema) return result;
    if (theme(candidate.theme)) result.theme = candidate.theme;
    if (typeof candidate.inputHints === "boolean") result.inputHints = candidate.inputHints;
    if (candidate.researchTools === true) result.researchTools = true;
    const layout = parseDockLayout(candidate.layout);
    if (layout) result.layout = layout;
    const layouts = parseLayoutLibrary(candidate.layouts, parseDockLayout);
    if (layouts) result.layouts = layouts;
    if (candidate.modules && typeof candidate.modules === "object" && !Array.isArray(candidate.modules)) {
      const modules = Object.entries(candidate.modules).filter(([id, shown]) => moduleId(id) && typeof shown === "boolean").slice(0, MAX_MODULES);
      if (modules.length) result.modules = Object.fromEntries(modules) as Record<string, boolean>;
    }
    // The older `folded` list (headings folded) first, so a newer `expanded` entry for the same key wins.
    const legacy: [string, boolean][] = Array.isArray(candidate.folded) ? candidate.folded.filter(viewKey).map(key => [key, false]) : [];
    const expanded = candidate.expanded && typeof candidate.expanded === "object" && !Array.isArray(candidate.expanded)
      ? Object.entries(candidate.expanded).filter((entry): entry is [string, boolean] => viewKey(entry[0]) && typeof entry[1] === "boolean") : [];
    const open = remember<boolean>(undefined, [...legacy, ...expanded], MAX_EXPANDED_PER_NAMESPACE, MAX_EXPANDED);
    if (open) result.expanded = open;
    if (candidate.scroll && typeof candidate.scroll === "object" && !Array.isArray(candidate.scroll)) {
      const anchors = Object.entries(candidate.scroll).flatMap(([key, value]) => {
        const anchor = viewKey(key) ? parseScrollAnchor(value) : undefined;
        return anchor ? [[key, anchor] as const] : [];
      });
      const scroll = remember<ScrollAnchor>(undefined, anchors, MAX_SCROLL, MAX_SCROLL);
      if (scroll) result.scroll = scroll;
    }
    if (candidate.choiceSizes && typeof candidate.choiceSizes === "object" && !Array.isArray(candidate.choiceSizes)) {
      const sizes = Object.entries(candidate.choiceSizes).filter(([type, size]) => choiceType(type) && choiceSize(size)).slice(0, MAX_CHOICE_TYPES);
      if (sizes.length) result.choiceSizes = Object.fromEntries(sizes) as Record<string, ChoiceSize>;
    }
    if (candidate.tours && typeof candidate.tours === "object" && !Array.isArray(candidate.tours)) {
      const tours = Object.entries(candidate.tours).filter(([id, record]) => tourId(id) && tourRecord(record)).slice(0, MAX_TOURS);
      if (tours.length) result.tours = Object.fromEntries(tours) as Record<string, TourRecord>;
    }
  } catch { /* A broken presentation preference must not discard authored work. */ }
  return result;
}

/** An in-process action boundary; no action changes a recipe or SQLite revision. */
export class UIPreferenceActions {
  private value: UIPreferences;
  private listeners = new Set<() => void>();
  constructor(initial?: unknown) { this.value = parseUIPreferences(initial); }
  snapshot(): Readonly<UIPreferences> { return structuredClone(this.value); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  capability(action: UIPreferenceAction): UIPreferenceCapability {
    if (isLayoutAction(action)) return layoutCapability(this.value, action, parseDockLayout);
    if (action.kind === "theme.set" && !theme(action.theme))
      return { available: false, reason: "Choose System, Light or Dark." };
    if (action.kind === "inputHints.set" && typeof action.enabled !== "boolean")
      return { available: false, reason: "Viewport hints are either shown or hidden." };
    if (action.kind === "researchTools.set" && typeof action.enabled !== "boolean")
      return { available: false, reason: "Research tools are either shown or hidden." };
    if (action.kind === "modules.set") {
      if (!moduleId(action.module) || typeof action.shown !== "boolean") return { available: false, reason: "Choose a module and whether it shows." };
      const known = this.value.modules ?? {};
      if (!Object.hasOwn(known, action.module) && Object.keys(known).length >= MAX_MODULES)
        return { available: false, reason: "Too many module choices are remembered already." };
    }
    // Always room: the least recently set open states and scroll anchors make way.
    if (action.kind === "expanded.set" && (!Array.isArray(action.keys) || !action.keys.length || action.keys.length > MAX_EXPANDED ||
        !action.keys.every(viewKey) || typeof action.expanded !== "boolean"))
      return { available: false, reason: "Choose which headings open or fold, and which way." };
    if (action.kind === "scroll.set" && (!viewKey(action.key) || (action.anchor !== undefined && !parseScrollAnchor(action.anchor))))
      return { available: false, reason: "A scroll position needs its place and a bounded position." };
    if (action.kind === "choiceSize.set") {
      if (!choiceType(action.type) || !choiceSize(action.size)) return { available: false, reason: "Choose a feature type and Small, Medium or Large." };
      if (!Object.hasOwn(this.value.choiceSizes ?? {}, action.type) && Object.keys(this.value.choiceSizes ?? {}).length >= MAX_CHOICE_TYPES)
        return { available: false, reason: "Too many picture sizes are remembered already." };
    }
    if (action.kind === "layout.set" && action.layout !== undefined && !parseDockLayout(action.layout))
      return { available: false, reason: "The panel layout is not a supported bounded JSON document." };
    if (action.kind === "tours.record") {
      if (!tourId(action.tourId) || !tourRecord(action.outcome)) return { available: false, reason: "Tour progress needs a tour and how it ended." };
      const known = this.value.tours ?? {};
      if (!Object.hasOwn(known, action.tourId) && Object.keys(known).length >= MAX_TOURS)
        return { available: false, reason: "Too many tours are remembered already." };
    }
    return { available: true };
  }
  dispatch(action: UIPreferenceAction) {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (isLayoutAction(action)) this.value = applyLayoutAction(this.value, action, parseDockLayout);
    else if (action.kind === "theme.set") this.value.theme = action.theme;
    else if (action.kind === "inputHints.set") this.value.inputHints = action.enabled;
    else if (action.kind === "researchTools.set") { if (action.enabled) this.value.researchTools = true; else delete this.value.researchTools; }
    else if (action.kind === "tours.record") this.value.tours = { ...this.value.tours, [action.tourId]: action.outcome };
    else if (action.kind === "modules.set") this.value.modules = { ...this.value.modules, [action.module]: action.shown };
    else if (action.kind === "choiceSize.set") this.value.choiceSizes = { ...this.value.choiceSizes, [action.type]: action.size };
    else if (action.kind === "expanded.set") {
      const open = remember(this.value.expanded, action.keys.map(key => [key, action.expanded] as const), MAX_EXPANDED_PER_NAMESPACE, MAX_EXPANDED);
      if (open) this.value.expanded = open; else delete this.value.expanded;
    } else if (action.kind === "scroll.set") {
      const scroll = remember(this.value.scroll, [[action.key, action.anchor && parseScrollAnchor(action.anchor)]], MAX_SCROLL, MAX_SCROLL);
      if (scroll) this.value.scroll = scroll; else delete this.value.scroll;
    }
    else {
      const layout = action.layout === undefined ? undefined : parseDockLayout(action.layout)!;
      if (layout) this.value.layout = layout;
      else delete this.value.layout;
    }
    for (const listener of this.listeners) listener();
  }
}

export type WorkArea = { x: number; y: number; width: number; height: number };
export type DockRecoveryContext = { workAreas: readonly WorkArea[]; panelIds: readonly string[] };
/** The panel engine must inspect its own geometry and recover or reject off-screen panels. */
export type DockRecoveryPort = (layout: DockLayout, context: DockRecoveryContext) =>
  { layout: unknown; onScreen: true } | undefined;

/** Never apply an opaque layout without its engine's current-screen recovery gate. */
export function recoverDockLayout(saved: unknown, context: DockRecoveryContext,
  recover?: DockRecoveryPort): DockLayout | undefined {
  const layout = parseDockLayout(saved);
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (!layout || !recover || !context.workAreas.length || context.workAreas.length > 16 ||
      context.workAreas.some(area => !finite(area.x) || !finite(area.y) ||
        !finite(area.width) || !finite(area.height) || area.width <= 0 || area.height <= 0) ||
      context.panelIds.some(id => typeof id !== "string" || !id || id.length > 128)) return undefined;
  try {
    const result = recover(layout, context);
    if (!result?.onScreen) return undefined;
    const candidate = parseDockLayout(result.layout);
    return candidate?.format === layout.format && candidate.version === layout.version ? candidate : undefined;
  } catch { return undefined; }
}
