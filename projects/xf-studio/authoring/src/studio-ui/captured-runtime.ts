/** A shell surface owns a concrete input until dismissal; a child surface captures before its parent closes. */
import { StudioRuntime } from "./runtime";
import type { MenuItem } from "./menu";
export function captureRuntime(runtime: StudioRuntime) {
  const life = new AbortController();
  if (runtime.instance?.captureSignal?.aborted) life.abort();
  const port = runtime.port.capture?.(life.signal) ?? runtime.port;
  const captured = new StudioRuntime(port, runtime.feedback, runtime.views, runtime.instance, runtime.anchors);
  captured.dock = runtime.dock; captured.settings = runtime.settings;
  captured.subscribe(() => runtime.changed());
  let active = !life.signal.aborted;
  const release = () => { if (!active) return; active = false; life.abort();
    runtime.instance?.captureSignal?.removeEventListener("abort", release);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", release); };
  if (typeof window !== "undefined") window.addEventListener("pagehide", release, { once: true });
  runtime.instance?.captureSignal?.addEventListener("abort", release, { once: true });
  return { runtime: captured, signal: life.signal, active: () => active,
    release };
}
/** Fence retained callbacks as well as clicks. U7 supplies refusal/focus presentation through existing feedback. */
export function capturedItems(items: MenuItem[], active: () => boolean): MenuItem[] {
  return items.map(item => item.kind === "submenu" ? { ...item, items: () => active() ? capturedItems(item.items(), active) : [] }
    : item.kind === "action" ? { ...item, run: () => { if (active()) item.run(); },
      ...(item.secondary ? { secondary: (Array.isArray(item.secondary) ? item.secondary : [item.secondary]).map(action => ({ ...action, run: () => { if (active()) action.run(); } })) } : {}) } : item);
}
