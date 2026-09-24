import { expect, test } from "bun:test";
import { ViewportAttachment, retainedViewportAspect, visibleViewportSize,
  type ViewportAttachmentPort, type ViewportHostKind } from "../src/viewport-attachment";

test("rehosting keeps the same hosts, cancels the target gesture and resizes only the moved viewport", () => {
  const head = { id: "head" }, uv = { id: "uv" }, events: string[] = [];
  const hosts = { head, uv }, locations: Record<ViewportHostKind, string> = { head: "original", uv: "original" };
  const sizes = { head: { width: 600, height: 400 }, uv: { width: 500, height: 240 } };
  const port: ViewportAttachmentPort<string> = {
    moveHost: (kind, slot) => { events.push(`${kind}:move:${slot}`); locations[kind] = slot; },
    measure: kind => sizes[kind], resize: kind => events.push(`${kind}:resize`),
    cancelInput: kind => events.push(`${kind}:cancel`), inputCapture: kind => kind === "uv",
    headView: () => ({ position: [0, 1, 2], target: [0, 1, 0], fov: 30 }),
    uvView: () => ({ mode: "both", side: "low", u: 0, v: 0, span: 1 }),
    hitAt: () => undefined, queryContext: () => { throw Error("No hit expected"); },
  };
  const attachment = new ViewportAttachment(port);
  let changes = 0; attachment.subscribe(() => changes++);
  attachment.setReady("uv"); attachment.rehost("uv", "floating");
  attachment.setReady("head"); attachment.attach("head", "docked");
  expect(hosts).toEqual({ head, uv });
  expect(locations).toEqual({ head: "docked", uv: "floating" });
  expect(events).toEqual(["uv:cancel", "uv:move:floating", "uv:resize",
    "head:cancel", "head:move:docked", "head:resize"]);
  const detached = attachment.snapshot();
  expect(detached.head).toMatchObject({ phase: "ready", width: 600, height: 400, captured: false });
  expect(detached.uv).toMatchObject({ phase: "ready", width: 500, height: 240, captured: true });
  detached.uv.view!.span = 9;
  expect(attachment.snapshot().uv.view?.span).toBe(1);
  expect(changes).toBe(4);
});

test("hidden hosts skip device resizes and retain a finite camera aspect until visible", () => {
  const events: string[] = [], sizes = { head: { width: 0, height: 0 }, uv: { width: 0, height: 200 } };
  const attachment = new ViewportAttachment<string>({
    moveHost: () => {}, measure: kind => sizes[kind], resize: kind => events.push(kind),
    cancelInput: () => {}, inputCapture: () => false, headView: () => undefined, uvView: () => undefined,
    hitAt: () => undefined, queryContext: () => { throw Error("No hit expected"); },
  });
  attachment.resize();
  expect(events).toEqual([]);
  expect(visibleViewportSize(0, 400)).toBeUndefined();
  expect(retainedViewportAspect(0, 0, 1.5)).toBe(1.5);
  expect(retainedViewportAspect(0, 0, Number.NaN)).toBe(1);
  sizes.head = { width: 750, height: 500 }; sizes.uv = { width: 360, height: 180 };
  attachment.resize();
  expect(events).toEqual(["head", "uv"]);
  expect(retainedViewportAspect(750, 500, 1)).toBe(1.5);
  attachment.setError("head", "Head asset unavailable");
  expect(attachment.snapshot().head).toMatchObject({ phase: "error", error: "Head asset unavailable" });
});
