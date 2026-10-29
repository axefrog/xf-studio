import { expect, test } from "bun:test";
import * as THREE from "three";
import { acquireUploadBudget, UPLOAD_TEXELS } from "../src/platform/scene/gpu-upload-budget";
import { withMapUpload } from "../src/platform/scene/gpu-work";
import { beginContextGeneration, endContextGeneration } from "../src/platform/scene/context-generation";
import { offerUploadSource, uploadStep } from "../src/character/render/character-detail-loader";
import { recordingRenderer } from "./fixtures/recording-gl";
import { morphTextureSteps } from "../src/platform/scene/morph-textures";

function fenced<T extends object>(renderer: T) {
  const fences: { signalled: boolean; deleted: boolean }[] = [];
  let lost = false;
  const gl = { isContextLost: () => lost, UNSIGNALED: 0, SYNC_STATUS: 2, SYNC_GPU_COMMANDS_COMPLETE: 3,
    fenceSync: () => { const fence = { signalled: false, deleted: false }; fences.push(fence); return fence; },
    getSyncParameter: (fence: typeof fences[number]) => fence.signalled ? 1 : 0,
    deleteSync: (fence: typeof fences[number]) => { fence.deleted = true; }, flush() {} };
  return { renderer: Object.assign(renderer, { getContext: () => gl }), fences, lose: (value: boolean) => { lost = value; } };
}

test.each(["render", "compile", "compileAsync", "initTexture", "copyTextureToTexture", "copyFramebufferToTexture", "initRenderTarget", "setRenderTarget",
  "clear", "clearColor", "clearDepth", "clearStencil"] as const)("later %s work closes upload admission despite spare credit, coalescing passes (PREV-196 High)", method => {
  const device = fenced({ [method]: (..._args: unknown[]) => {} }), budget = acquireUploadBudget(device.renderer);
  try {
    device.fences[0]!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
    budget.sent(1); // Almost the entire window is free; its credit must not bypass later work.
    const submit = () => device.renderer[method]!({});
    submit(); submit(); submit();
    expect(device.fences).toHaveLength(1); // Notifications are lazy: no fence per pass.
    for (let frame = 0; frame < 15; frame++) expect(budget.canSend(1)).toBe(false);
    expect(device.fences).toHaveLength(2); // One barrier for all three submissions, not one for every poll.
    device.fences[1]!.signalled = true;
    for (let band = 0; band < 4; band++) { expect(budget.canSend(1)).toBe(true); budget.sent(1); }
    expect(device.fences).toHaveLength(2);
    // New GPU work after that barrier was inserted needs a newer completion, too.
    submit();
    expect(budget.canSend(1)).toBe(false);
    expect(device.fences).toHaveLength(3);
  } finally { budget.dispose(); }
  expect(device.fences.every(fence => fence.deleted)).toBe(true);
});

test.each([1, 15])("continuous draws with %i-frame fence reports keep a pending barrier and admit several bands per burst (PREV-196 starvation)", latency => {
  let frame = 0, releasing = false, sent = 0;
  const fences: { ready: number; deleted: boolean }[] = [];
  const gl = { isContextLost: () => false, UNSIGNALED: 0, SYNC_STATUS: 2, SYNC_GPU_COMMANDS_COMPLETE: 3,
    fenceSync() { const fence = { ready: frame + latency, deleted: false }; fences.push(fence); return fence; },
    getSyncParameter: (fence: typeof fences[number]) => frame >= fence.ready ? 1 : 0,
    deleteSync(fence: typeof fences[number]) {
      // Cancellation may delete a pending fence; ongoing rendering must never replace one before it completes.
      expect(releasing || frame >= fence.ready).toBe(true); fence.deleted = true;
    }, flush() {} };
  const renderer = { getContext: () => gl, render() {} }, budget = acquireUploadBudget(renderer);
  const bursts: number[] = [];
  try {
    for (; sent < 24 && frame < 200; frame++) {
      renderer.render(); // Includes the frame in which the previous fence first reports completion.
      let bands = 0;
      while (bands < 3 && sent < 24 && budget.canSend(UPLOAD_TEXELS / 8)) { budget.sent(UPLOAD_TEXELS / 8); sent++; bands++; }
      if (bands) bursts.push(bands);
      budget.checkpoint();
    }
    expect(sent).toBe(24);
    expect(bursts).toEqual(Array(8).fill(3));
    expect(frame).toBeLessThan(200);
  } finally { releasing = true; budget.dispose(); }
  expect(fences.every(fence => fence.deleted)).toBe(true);
});

test("draws during a pending barrier wait do not replace it, and still need completion after its admitted burst", () => {
  const device = fenced({ render() {} }), budget = acquireUploadBudget(device.renderer);
  try {
    device.fences[0]!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
    device.renderer.render();
    expect(budget.canSend(1)).toBe(false);
    const pending = device.fences[1]!;
    for (let frame = 0; frame < 15; frame++) {
      device.renderer.render(); expect(budget.canSend(1)).toBe(false);
      expect(device.fences).toHaveLength(2); expect(pending.deleted).toBe(false);
    }
    pending.signalled = true;
    device.renderer.render();
    for (let band = 0; band < 4; band++) { expect(budget.canSend(1)).toBe(true); budget.sent(1); }
    expect(device.fences).toHaveLength(2);
    budget.checkpoint(); // Ends the completion's burst; the intervening draws have not been forgotten.
    expect(device.fences).toHaveLength(3);
    expect(budget.canSend(1)).toBe(false);
    expect(device.fences).toHaveLength(4);
  } finally { budget.dispose(); }
  expect(device.fences.every(fence => fence.deleted)).toBe(true);
});

test("actual map storage/bands do not invalidate admission; a draw or another texture upload inside the map scope still does", () => {
  const { renderer, fences } = fenced({ capabilities: { maxTextureSize: 16384 }, initTexture() {}, copyTextureToTexture() {}, render() {}, setRenderTarget(_target: unknown) {} });
  const budget = acquireUploadBudget(renderer), texture = new THREE.Texture({ width: 4096, height: 4096 });
  offerUploadSource(texture, { width: 4096, height: 4096, close() {} } as ImageBitmap);
  try {
    fences[0]!.signalled = true;
    for (let step = 0; step < 4; step++) {
      expect(budget.canSend(1)).toBe(true);
      expect(uploadStep(texture, renderer as unknown as THREE.WebGLRenderer)).toBe(false);
      budget.sent(step ? 4096 * 512 : 1);
      renderer.setRenderTarget(null); // Renderer-state restoration alone submits no costly work.
    }
    expect(fences).toHaveLength(1);
    withMapUpload(renderer, texture, () => renderer.render());
    expect(budget.canSend(1)).toBe(false);
    fences.at(-1)!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
    withMapUpload(renderer, texture, () => (renderer.initTexture as (...args: unknown[]) => void)(new THREE.Texture()));
    expect(budget.canSend(1)).toBe(false);
    // Map draining ignores later non-map work: morph rounds already have their own completion gate.
    budget.checkpoint(); fences.at(-1)!.signalled = true;
    expect(budget.idle()).toBe(true);
    expect(budget.canSend(1)).toBe(false);
  } finally { budget.dispose(); texture.dispose(); }
});

test("a real Three morph upload invalidates map admission after the opening barrier passed", () => {
  const recording = recordingRenderer(), { renderer, fences } = fenced(recording.renderer);
  const budget = acquireUploadBudget(renderer), geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(9), 3)];
  const steps = morphTextureSteps(renderer, geometry)!;
  try {
    fences[0]!.signalled = true;
    expect(budget.canSend(UPLOAD_TEXELS / 2)).toBe(true);
    steps.step(); steps.step(); // Allocate/fill memory only.
    expect(budget.canSend(1)).toBe(true);
    expect(steps.step()).toBe(true); // The real adapter uploads a Float32 morph texture.
    expect(recording.volumes.length).toBeGreaterThan(0);
    expect(budget.canSend(1)).toBe(false);
    fences.at(-1)!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
  } finally { steps.dispose(); budget.dispose(); geometry.dispose(); }
});

test("the last upload owner restores renderer methods; context restoration forgets a later busy-work barrier", () => {
  const device = fenced({ render() {} }), original = device.renderer.render;
  const a = acquireUploadBudget(device.renderer), b = acquireUploadBudget(device.renderer);
  try {
    device.fences[0]!.signalled = true;
    expect(a.canSend(1)).toBe(true);
    device.renderer.render();
    expect(b.canSend(1)).toBe(false);
    a.dispose();
    expect(device.renderer.render).not.toBe(original);
    device.lose(true); endContextGeneration(device.renderer);
    device.lose(false); beginContextGeneration(device.renderer);
    expect(b.canSend(1)).toBe(false);
    expect(device.fences[1]!.deleted).toBe(false); // Never delete the dead generation's fence on its replacement.
    device.fences.at(-1)!.signalled = true;
    expect(b.canSend(1)).toBe(true);
  } finally { a.dispose(); b.dispose(); }
  expect(device.renderer.render).toBe(original);
});

test("submission observation preserves receivers, returns and errors, and map scopes retire on exceptions", async () => {
  const failure = Error("partly submitted"), result = Promise.resolve("linked");
  let receiver: unknown;
  const device = fenced({ initTexture(..._args: unknown[]) {}, compileAsync() { receiver = this; return result; },
    render() { throw failure; } });
  const budget = acquireUploadBudget(device.renderer);
  try {
    device.fences[0]!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
    expect(device.renderer.compileAsync()).toBe(result);
    expect(receiver).toBe(device.renderer);
    expect(budget.canSend(1)).toBe(false);
    device.fences.at(-1)!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
    const texture = {};
    expect(() => withMapUpload(device.renderer, texture, () => device.renderer.render())).toThrow(failure);
    expect(budget.canSend(1)).toBe(false);
    device.fences.at(-1)!.signalled = true;
    expect(budget.canSend(1)).toBe(true);
    device.renderer.initTexture(texture); // The throwing scope is gone; this is non-map work again.
    expect(budget.canSend(1)).toBe(false);
    await result;
  } finally { budget.dispose(); }
});
