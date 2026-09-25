/** Workspace-only preferences. A dock implementation owns the meaning of `state`. */
export type ThemePreference = "system" | "light" | "dark";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DockLayout = { format: string; version: number; state: JsonValue };
/** `inputHints`: contextual shortcut hints and target tooltips in the viewports (on by default). */
export type UIPreferences = { schema: "xfs/ui-preferences-1"; theme: ThemePreference; inputHints: boolean; layout?: DockLayout };
export type UIPreferenceAction =
  | { kind: "theme.set"; theme: ThemePreference }
  | { kind: "inputHints.set"; enabled: boolean }
  | { kind: "layout.set"; layout?: DockLayout };
export type UIPreferenceCapability = { available: boolean; reason?: string };

const MAX_LAYOUT_BYTES = 128 * 1024;
const MAX_NODES = 8192;
const MAX_DEPTH = 32;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

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
    const layout = parseDockLayout(candidate.layout);
    if (layout) result.layout = layout;
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
    if (action.kind === "theme.set" && !theme(action.theme))
      return { available: false, reason: "Choose System, Light or Dark." };
    if (action.kind === "inputHints.set" && typeof action.enabled !== "boolean")
      return { available: false, reason: "Viewport hints are either shown or hidden." };
    if (action.kind === "layout.set" && action.layout !== undefined && !parseDockLayout(action.layout))
      return { available: false, reason: "The panel layout is not a supported bounded JSON document." };
    return { available: true };
  }
  dispatch(action: UIPreferenceAction) {
    const allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason);
    if (action.kind === "theme.set") this.value.theme = action.theme;
    else if (action.kind === "inputHints.set") this.value.inputHints = action.enabled;
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
