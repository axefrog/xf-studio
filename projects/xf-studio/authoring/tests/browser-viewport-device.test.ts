import { createLayeredEditorAdapters } from "../src/preview/browser/layered-editor-adapters";
import { expect, test } from "bun:test";
import type * as THREE from "three";
import { createBrowserViewportDevice } from "../src/preview/browser/browser-viewport-device";
import type { createSceneRuntime } from "../src/platform/scene/scene-host";
import type { createSurfaceEditor } from "../src/legacy/eye-makeup/browser/surface-editor";
import { EYE_REGION } from "./fixtures/eye-region";
import { freshWorkspace } from "./fixtures/eye-region";
import { createTrustedAuthoringCore } from "./fixtures/makeup-core";
import { STUDIO_COMPOSITION } from "../src/compose/studio-registry";

test("a toolbar-free browser viewport mounts once and rehosts live editors", async () => {
  const core = createTrustedAuthoringCore(freshWorkspace(), { selectedCollection: () => "fixture" }, STUDIO_COMPOSITION);
  const events: string[] = [];
  const head = { clientWidth: 600, clientHeight: 400, contains: () => false };
  const camera = { position: [0, 1, 2] as [number, number, number],
    target: [0, 1, 0] as [number, number, number], fov: 30 };
  const surfaceEditor = {
    resize: () => events.push("head:resize"), cancelInput: () => events.push("head:cancel"),
    inputCapture: () => false, dispose: () => events.push("head:dispose"),
    hitAt: () => undefined,
  } as unknown as ReturnType<typeof createSurfaceEditor>;
  const viewer = { cameraState: () => camera, resize: () => events.push("scene:resize"), slot: "viewer" };
  let sceneLoads = 0, devices = 0;
  const shown: unknown[] = [];
  const device = createBrowserViewportDevice({
    headHost: head as unknown as HTMLElement,
    queryContext: () => { throw Error("No hit expected"); },
    sceneFactory: (async () => { sceneLoads++; return viewer; }) as unknown as typeof createSceneRuntime,
    // The head pane's renderer device: made with the first head built, which it shows when asked.
    deviceFactory: (() => { devices++; return { show: (slot: unknown) => shown.push(slot) }; }) as never,
    surface: createLayeredEditorAdapters(EYE_REGION, { surface: (() => surfaceEditor) as typeof createSurfaceEditor }).surface,
  });
  const attachment = device.attachment;
  expect(attachment.snapshot().head.phase).toBe("loading");
  // Not-ready head states are typed: progress, neutral or error, each with its own words.
  device.headPending("preparing", "Preparing the 3D preview…", .4);
  expect(attachment.snapshot().head).toMatchObject({ phase: "preparing", message: "Preparing the 3D preview…", progress: .4 });
  device.headPending("unavailable", "The 3D preview needs your Cyberpunk 2077 game folder.");
  expect(attachment.snapshot().head).toMatchObject({ phase: "unavailable", progress: null });
  expect(attachment.snapshot().head.error).toBeUndefined();
  device.failHead("The 3D preview couldn't be loaded. Try again.");
  expect(attachment.snapshot().head).toMatchObject({ phase: "error", error: "The 3D preview couldn't be loaded. Try again." });
  expect(attachment.snapshot().head.message).toBeUndefined();
  device.headPending("loading", "Loading the 3D head…");
  expect(() => device.mountSurface({} as THREE.SkinnedMesh, { state: core, signal: new AbortController().signal, source: "main", look: () => undefined, complete: action => action as never, check: () => ({ available: true }), message: () => {} })).toThrow();
  expect(attachment.snapshot().uv).toBeUndefined();
  // A head is built hidden, then shown on the pane's device.
  device.showHead(await device.buildHead());
  expect(device.mountSurface({} as THREE.SkinnedMesh, { state: core, signal: new AbortController().signal, source: "main", look: () => undefined, complete: action => action as never, check: () => ({ available: true }), message: () => {} })).toBe(surfaceEditor);
  device.headReady();
  expect(attachment.snapshot().head).toMatchObject({ phase: "ready", view: camera });
  const slot = { append(node: unknown) { events.push(node === head ? "head:move" : "uv:move"); } };
  attachment.rehost("head", slot as unknown as HTMLElement);
  expect(sceneLoads).toBe(1);
  expect({ devices, shown }).toEqual({ devices: 1, shown: ["viewer"] });
  expect(device.scene()).toBe(viewer as unknown as Awaited<ReturnType<typeof createSceneRuntime>>);
  expect(events).toEqual(["head:resize", "head:cancel", "head:move", "scene:resize", "head:resize"]);
  core.app.dispose(); core.dispose();
});

test("the viewport releases the shared device once after its caller releases the runtimes", async () => {
  const life = new AbortController(), events = new EventTarget(), log: string[] = [];
  const head = { clientWidth: 600, clientHeight: 400, contains: () => false };
  let runtimes = 0, contexts = 0;
  const viewer = { slot: "fixture", dispose() { runtimes--; log.push("runtime"); } };
  const viewport = createBrowserViewportDevice({ signal: life.signal, headHost: head as unknown as HTMLElement,
    window: events, queryContext: () => { throw Error("No hit expected"); },
    deviceFactory: (() => { contexts++; return { show() {}, dispose() { log.push(`device:${runtimes}`); contexts--; } }; }) as never,
    sceneFactory: (async () => { runtimes++; return viewer; }) as unknown as typeof createSceneRuntime });
  // The same order used by startup: the runtime owner first, then the viewport's shared device.
  life.signal.addEventListener("abort", () => { viewer.dispose(); viewport.dispose(); }, { once: true });
  await viewport.buildHead();
  expect([runtimes, contexts]).toEqual([1, 1]);
  events.dispatchEvent(Object.assign(new Event("keydown"), { altKey: true }));
  expect(viewport.attachment.input().modifiers.alt).toBe(true);
  life.abort(); viewport.dispose();
  expect([runtimes, contexts]).toEqual([0, 0]); expect(log).toEqual(["runtime", "device:0"]);
  events.dispatchEvent(Object.assign(new Event("keyup"), { altKey: false }));
  expect(viewport.attachment.input().modifiers.alt).toBe(true);
  expect(viewport.scene()).toBeUndefined();
  await expect(viewport.buildHead()).rejects.toMatchObject({ name: "AbortError" });
  expect(contexts).toBe(0);
});
