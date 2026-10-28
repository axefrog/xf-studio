import { createLayeredEditorAdapters } from "../src/preview/browser/layered-editor-adapters";
import { EYE_REGION } from "./fixtures/eye-region";
/**
 * The scene editors (src/preview/browser/scene-editors.ts; profiles phase 4a-vi, experiment 043 §13): the on-head editor mounted per view
 * on the head shown for it, naming that view's look; the UV editor naming the drawn view's. They replace UI-boundary exception 17 (the
 * composition root wiring the editors' hooks).
 */
import { expect, test } from "bun:test";
import * as THREE from "three";
import { createSceneEditors, type SceneEditorPorts } from "../src/preview/browser/scene-editors";
import type { AttachedHead } from "../src/preview/browser/browser-head-attachment";

function editors() {
  const log: string[] = [], attached: Record<string, unknown> = {};
  // The view drawn now (none: the shown tab holds no view).
  let drawn: string | undefined = "main";
  const layer = { id: "L1" };
  let hooks: Record<string, (...args: unknown[]) => unknown> = {};
  let controls = true;
  const listeners = new Set<() => void>();
  const plate = { geometry: new THREE.PlaneGeometry(1, 1) };
  const factory = { feature: "eye-makeup" };
  const adapters = createLayeredEditorAdapters(EYE_REGION, { surface: ((_scene: unknown, given: unknown) => { hooks = given as unknown as typeof hooks; log.push("mount"); return { setEnabled: (on: boolean) => log.push(`enabled:${on}`) }; }) as never });
  const resources = adapters.surface!.create({} as never);
  const ports = { adapters,
    surfaces: new Map([["eye-makeup", factory]]), look: { feature: "eye-makeup", preview: {} },
    core: { documents: { live: "eye-makeup" }, projections: new Map([["eye-makeup", {
      geometry: { layer: () => layer, recipe: () => ({ layers: [layer] }) }, presentation: { selected: 0, layer: () => layer, selectedField: () => ({ id: "F1" }) } }]]),
      app: { dispatch: (action: { kind: string; instance?: string }) => { log.push(`dispatch:${action.kind}@${action.instance}`); return { ok: true }; },
        beginGesture: (source: string, id: string, look?: { look: string }) => { log.push(`begin:${source}:${id}:${look?.look}`); return true; },
        applyGesture: (source: string) => { log.push(`apply:${source}`); return true; }, endGesture: (source: string, cancel?: boolean) => { log.push(`end:${source}:${!!cancel}`); },
        surfaceEdge: () => null } },
    // The input layer names a view's look and its actions (here after the view).
    naming: { look: (view: string | undefined) => view === undefined || view === "empty" ? undefined : ({ collection: "c", look: view === "twin" ? "look-of-main" : `look-of-${view}` }),
      complete: (action: object, view: string | undefined) => ({ ...action, instance: view }) },
    drawn: () => drawn,
    viewport: { mountSurface: (surface: never, binding: never) => resources.mount(surface, binding),
      surfaceOutline: (surface: never) => resources.outline(surface), unmountSurface: () => log.push("unmount") },
    attach: (services: Record<string, unknown>) => Object.assign(attached, services), message: (source: string, text: string) => log.push(`message:${source}:${text}`),
  } as unknown as SceneEditorPorts;
  const head = { scene: { feature: (renderer: unknown) => renderer === factory ? { surface: plate } : undefined },
    surfaceControls: () => controls, onSurfaceControls: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } } as unknown as AttachedHead;
  return { made: createSceneEditors(ports), log, attached, head, hooks: () => hooks, listeners, draw(view: string | undefined) { drawn = view; },
    setControls(on: boolean) { controls = on; for (const listener of [...listeners]) listener(); } };
}

test("mounted for a view, the on-head editor names that view's look, follows the head's Surface controls, and its release unmounts it", () => {
  const e = editors();
  const release = e.made.mount(e.head, "side");
  expect(e.log).toEqual(["mount", "enabled:true"]);
  expect(e.attached.surfaceOutline).toBeDefined();
  // Its gestures come from the view and edit the look that view's panel names; its selections are named from that panel too.
  e.hooks().begin!(); e.hooks().apply!({}); e.hooks().finish!(); e.hooks().cancel!();
  e.hooks().select!(2); e.hooks().selectField!("F2");
  expect(e.log.slice(2)).toEqual(["begin:side:L1:look-of-side", "apply:side", "end:side:false", "end:side:true",
    "dispatch:point.select@side", "dispatch:field.select@side"]);
  // The view's Surface controls tool, through the head.
  e.setControls(false);
  expect(e.log.at(-1)).toBe("enabled:false");
  // Released: unmounted (a gesture still open is settled by the viewport), the outline withdrawn, the tool no longer followed.
  release();
  expect(e.log.at(-1)).toBe("unmount");
  expect(e.attached.surfaceOutline).toBeUndefined();
  expect(e.listeners.size).toBe(0);
  release();
  expect(e.log.filter(entry => entry === "unmount")).toHaveLength(1);
});

test("a head whose scene has no edited surface mounts nothing", () => {
  const e = editors();
  const bare = { ...e.head, scene: { feature: () => undefined } } as unknown as AttachedHead;
  e.made.mount(bare, "main")();
  expect(e.log).toEqual([]);
});

test("64101571 surface wiring parity: selection, captured view, controls, outline and idempotent release", () => {
  const e = editors(), release = e.made.mount(e.head, "side"), hooks = e.hooks();
  const reads = { layer: hooks.layer!(), selected: hooks.selected!(), field: hooks.selectedField!(), layers: hooks.layers!(), outline: e.attached.surfaceOutline };
  hooks.begin!(); e.draw("other"); hooks.apply!({}); hooks.select!(2); hooks.selectField!("F2"); hooks.finish!(); hooks.cancel!(); hooks.message!("unchanged");
  e.setControls(false); e.setControls(true); release(); release();
  expect({ reads, log: e.log, outlineAfter: e.attached.surfaceOutline, subscriptionsAfter: e.listeners.size }).toMatchSnapshot();
});
