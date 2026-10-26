/** A 3D pane keeps its fixed view identity while that view's scene input changes. The renderer remains shared. */
import { Frame, StudioRuntime, type Port } from "../runtime";
import type { ViewContext, ViewPaneFactory } from "../views/panels";
import type { ViewPaneController } from "./view-panels";

export function instanceViewPane(root: StudioRuntime, context: ViewContext, instance: string, make: ViewPaneFactory): ViewPaneController {
  const life = new AbortController(), input = root.port.editing?.acquire(instance, life.signal);
  const current = () => input?.current() ?? root.port;
  // Service methods resolve the pane's own current input at invocation, never the root's drawn look.
  const service = (read: () => object) => new Proxy({}, { get: (_target, key) => {
    const value = Reflect.get(read(), key);
    return typeof value === "function" ? (...args: unknown[]) => Reflect.get(read(), key).apply(read(), args) : value;
  } });
  const services = new Map<PropertyKey, object>(), features = new Map<string, object>();
  const port = new Proxy({} as Port, { get: (_target, key: keyof Port) => {
    if (key === "feature") return (owner: string) => {
      let facade = features.get(owner); if (!facade) features.set(owner, facade = service(() => current().feature(owner)!)); return facade;
    };
    const value = current()[key];
    if (typeof value === "function") return (...args: unknown[]) => (current()[key] as Function).apply(current(), args);
    if (!value || typeof value !== "object") return value;
    let proxy = services.get(key); if (!proxy) services.set(key, proxy = service(() => current()[key] as object)); return proxy;
  } });
  const rt = new StudioRuntime(port, root.feedback, root.views, { id: instance, type: "view", signal: life.signal, captureSignal: life.signal }, root.anchors.scoped(instance, life.signal));
  Object.defineProperty(rt, "dock", { get: () => root.dock }); Object.defineProperty(rt, "settings", { get: () => root.settings });
  rt.subscribe(() => root.changed());
  let portOff = current().subscribe(() => root.changed());
  const off = input?.subscribe(() => { portOff(); portOff = current().subscribe(() => root.changed()); root.changed(); }), pane = make(rt, context, instance);
  rt.anchors.register("panel.head", pane.spec.element);
  return { ...pane, update: () => pane.update(new Frame(current(), root.views, root.dock?.tree)),
    dispose() { off?.(); portOff(); life.abort(); pane.dispose?.(); } };
}
