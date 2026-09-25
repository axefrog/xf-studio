import { expect, test } from "bun:test";
import { createBrowserViewportDevice } from "../src/browser-viewport-device";
import type { createScene } from "../src/scene";
import type { createSurfaceEditor } from "../src/surface-editor";
import type { createUVEditor } from "../src/uv-editor";

test("a toolbar-free browser viewport mounts once and rehosts live editors", async () => {
  const events: string[] = [];
  const head = { clientWidth: 600, clientHeight: 400, contains: () => false };
  const uv = { clientWidth: 400, clientHeight: 300, contains: () => false };
  const uvView = { mode: "both" as const, side: "low" as const, u: 0, v: 0, span: 1 };
  const camera = { position: [0, 1, 2] as [number, number, number],
    target: [0, 1, 0] as [number, number, number], fov: 30 };
  const uvEditor = {
    resize: () => events.push("uv:resize"), cancelInput: () => events.push("uv:cancel"),
    inputCapture: () => true, dispose: () => events.push("uv:dispose"),
    snapshot: () => uvView, viewCommand: () => true, hitAt: () => undefined,
    draw: () => {}, diagnostics: () => ({}),
  } as unknown as ReturnType<typeof createUVEditor>;
  const surfaceEditor = {
    resize: () => events.push("head:resize"), cancelInput: () => events.push("head:cancel"),
    inputCapture: () => false, dispose: () => events.push("head:dispose"),
    hitAt: () => undefined,
  } as unknown as ReturnType<typeof createSurfaceEditor>;
  const viewer = { cameraState: () => camera, resize: () => events.push("scene:resize") };
  let sceneLoads = 0, uvControls: unknown;
  const device = createBrowserViewportDevice({
    headHost: head as unknown as HTMLElement, uvHost: uv as unknown as HTMLElement,
    queryContext: () => { throw Error("No hit expected"); },
    sceneFactory: (async () => { sceneLoads++; return viewer; }) as unknown as typeof createScene,
    uvFactory: ((_canvas, controls) => { uvControls = controls; return uvEditor; }) as typeof createUVEditor,
    surfaceFactory: (() => surfaceEditor) as typeof createSurfaceEditor,
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
  expect(() => device.mountSurface({} as Parameters<typeof createSurfaceEditor>[1])).toThrow();
  expect(device.mountUV({} as HTMLCanvasElement, undefined,
    {} as Parameters<typeof createUVEditor>[2], uvView)).toBe(uvEditor);
  expect(uvControls).toBeUndefined();
  expect(attachment.snapshot().uv).toMatchObject({ phase: "ready", captured: true, view: uvView });
  await device.loadHead([]);
  expect(device.mountSurface({} as Parameters<typeof createSurfaceEditor>[1])).toBe(surfaceEditor);
  device.headReady();
  expect(attachment.snapshot().head).toMatchObject({ phase: "ready", view: camera });
  const slot = { append(node: unknown) { events.push(node === head ? "head:move" : "uv:move"); } };
  attachment.rehost("head", slot as unknown as HTMLElement);
  attachment.rehost("uv", slot as unknown as HTMLElement);
  expect(sceneLoads).toBe(1);
  expect(device.scene()).toBe(viewer as unknown as Awaited<ReturnType<typeof createScene>>);
  expect(events).toEqual(["uv:resize", "head:resize", "head:cancel", "head:move",
    "scene:resize", "head:resize", "uv:cancel", "uv:move", "uv:resize"]);
});
