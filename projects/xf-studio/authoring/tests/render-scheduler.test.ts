import { expect, test } from "bun:test";
import * as THREE from "three";
import { bindRenderTriggers, CANVAS_TRIGGERS, createRenderScheduler, invalidating } from "../src/render-scheduler";
import { IdleAnimation } from "../src/idle-animation";

/** A manual frame clock: `step()` runs the pending animation frame, like one display refresh. */
function manualClock() {
  let pending: (() => void) | undefined, handle = 0, time = 0, cancelled = 0;
  return {
    clock: { request(callback: () => void) { pending = callback; return ++handle; }, cancel() { pending = undefined; cancelled++; }, now: () => time },
    step(ms = 16) { time += ms; const run = pending; pending = undefined; run?.(); return !!run; },
    /** Run frames until the loop stops (at most `limit`); returns how many ran. */
    drain(limit = 100) { let n = 0; while (n < limit && this.step()) n++; return n; },
    get pending() { return !!pending; },
    get cancelled() { return cancelled; },
  };
}

function fixture(animating = () => false) {
  const clock = manualClock(), frames: number[] = [];
  let onFrame: (() => void) | undefined;
  const scheduler = createRenderScheduler({ clock: clock.clock, animating: () => animating(),
    frame: dt => { frames.push(dt); onFrame?.(); } });
  return { clock, frames, scheduler, setOnFrame: (fn: () => void) => { onFrame = fn; } };
}

test("an idle viewport draws nothing; one request draws exactly one frame, then the loop stops (UI-38)", () => {
  const { clock, frames, scheduler } = fixture();
  expect(clock.pending).toBe(false);
  expect(scheduler.running).toBe(false);
  scheduler.invalidate(); scheduler.invalidate(); scheduler.invalidate();
  expect(scheduler.running).toBe(true);
  expect(clock.drain()).toBe(1);
  expect(frames.length).toBe(1);
  expect(scheduler.running).toBe(false);
  // Many display refreshes later, still nothing drawn.
  for (let i = 0; i < 10; i++) clock.step();
  expect(frames.length).toBe(1);
  expect(scheduler.stats()).toMatchObject({ frames: 1, requests: 3, running: false });
});

test("a request made while a frame runs (a damped orbit step) draws the next frame too", () => {
  const { clock, frames, scheduler, setOnFrame } = fixture();
  let dampingSteps = 5;
  setOnFrame(() => { if (dampingSteps-- > 0) scheduler.invalidate(); });
  scheduler.invalidate();
  expect(clock.drain()).toBe(6);
  expect(frames.length).toBe(6);
  expect(scheduler.running).toBe(false);
});

test("while something animates (idle, blink study) every refresh draws; it stops when the animation does", () => {
  let playing = true;
  const { clock, frames, scheduler } = fixture(() => playing);
  scheduler.invalidate();
  for (let i = 0; i < 30; i++) clock.step();
  expect(frames.length).toBe(30);
  // dt is the real frame interval, in seconds.
  expect(frames[5]).toBeCloseTo(0.016, 9);
  playing = false;
  clock.step();
  expect(clock.pending).toBe(false);
  expect(frames.length).toBe(31);
  expect(scheduler.stats().interval.medianMs).toBeCloseTo(16, 9);
});

test("waking from idle measures dt from the request, not from the last frame drawn long ago", () => {
  const { clock, frames, scheduler } = fixture();
  scheduler.invalidate(); clock.step();
  for (let i = 0; i < 100; i++) clock.step(); // 1.6 s idle, no frames.
  scheduler.invalidate(); clock.step(16);
  expect(frames.at(-1)).toBeCloseTo(0.016, 9);
});

test("dispose cancels a pending frame and ignores later requests", () => {
  const { clock, frames, scheduler } = fixture(() => true);
  scheduler.invalidate();
  scheduler.dispose();
  expect(clock.cancelled).toBe(1);
  scheduler.invalidate();
  expect(clock.drain()).toBe(0);
  expect(frames.length).toBe(0);
});

test("a frame that throws still ends cleanly and the next request draws again", () => {
  const clock = manualClock();
  let fail = true, drawn = 0;
  const scheduler = createRenderScheduler({ clock: clock.clock, animating: () => false,
    frame: () => { if (fail) throw Error("boom"); drawn++; } });
  scheduler.invalidate();
  expect(() => clock.step()).toThrow("boom");
  expect(scheduler.running).toBe(false);
  fail = false; scheduler.invalidate(); clock.step();
  expect(drawn).toBe(1);
});

test("controls changes, canvas input, restored contexts and lighting notices request frames; unbinding stops them", () => {
  const controls = new EventTarget(), canvas = new EventTarget();
  const lightingListeners = new Set<() => void>();
  const lighting = { subscribe(listener: () => void) { lightingListeners.add(listener); return () => lightingListeners.delete(listener); } };
  let requests = 0;
  const unbind = bindRenderTriggers(() => requests++, { controls: controls as never, element: canvas, lighting });
  controls.dispatchEvent(new Event("change"));
  expect(requests).toBe(1);
  for (const type of CANVAS_TRIGGERS) canvas.dispatchEvent(new Event(type));
  expect(requests).toBe(1 + CANVAS_TRIGGERS.length);
  expect(CANVAS_TRIGGERS).toEqual(expect.arrayContaining(["pointermove", "pointerdown", "pointerup", "wheel", "webglcontextrestored"]));
  for (const listener of lightingListeners) listener(); // Preset, body or the LUT arriving.
  expect(requests).toBe(2 + CANVAS_TRIGGERS.length);
  unbind();
  controls.dispatchEvent(new Event("change"));
  canvas.dispatchEvent(new Event("pointermove"));
  expect(lightingListeners.size).toBe(0);
  expect(requests).toBe(2 + CANVAS_TRIGGERS.length);
});

test("wrapped mutators request a frame after they run, keep their results, and still request one when they throw", () => {
  const target = { value: 0, set(v: number) { this.value = v; return v * 2; }, fail() { throw Error("no"); }, read() { return this.value; } };
  let requests = 0;
  const wrapped = invalidating(target, ["set", "fail"], () => requests++);
  expect(wrapped.set(4)).toBe(8);
  expect(target.value).toBe(4);
  expect(requests).toBe(1);
  expect(() => wrapped.fail()).toThrow("no");
  expect(requests).toBe(2);
  expect("read" in wrapped).toBe(false);
  expect(() => invalidating(target, ["value"], () => {})).toThrow("not a method");
});

test("the creator lighting options request a frame once wrapped onto the device (they don't notify listeners)", () => {
  let applied = 0, requests = 0;
  const lighting = { setCreatorOptions(_: unknown) { applied++; } };
  Object.assign(lighting, invalidating(lighting, ["setCreatorOptions"], () => requests++));
  lighting.setCreatorOptions({});
  expect([applied, requests]).toEqual([1, 1]);
});

test("the idle reports every change other than playback: enable, pause, seek, contributions, bones joining and leaving", () => {
  const body = new THREE.Group(), head = new THREE.Bone(); head.name = "Head"; body.add(head);
  const preview = new THREE.Group(), target = new THREE.Bone(); target.name = "Head"; preview.add(target);
  const clip = new THREE.AnimationClip("idle", 1, [new THREE.VectorKeyframeTrack("Head.position", [0, 1], [0, 0, 0, 0, 1, 0])]);
  const idle = new IdleAnimation(body, clip, [target], {});
  const changes: string[] = [];
  let step = "";
  idle.onChange = () => changes.push(step);
  const act = (name: string, run: () => void) => { step = name; run(); };
  act("enable", () => idle.setEnabled(true));
  act("update", () => idle.update(0.1));
  act("pause", () => idle.setPaused(true));
  act("seek", () => idle.seek(0.5));
  act("parts", () => idle.setContributions({ body: false }));
  const late = new THREE.Bone(); late.name = "Head"; preview.add(late);
  act("attach", () => idle.attach([late]));
  act("detach", () => idle.detach([late]));
  act("disable", () => idle.setEnabled(false));
  expect(changes).toEqual(["enable", "pause", "seek", "parts", "attach", "detach", "disable"]);
});

test("every scene method that changes what is drawn is wrapped to request a frame; readers are not", () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(import.meta.dir, "..", "src", "scene.ts"), "utf8") as string;
  const body = source.slice(source.indexOf("  const api = {"), source.indexOf("  // Every call that changes what is drawn"));
  const keys = [...body.matchAll(/^    (?:\/\/.*\n    )?([A-Za-z]+)(?::|,)/gm)].map(match => match[1]!);
  const wrapped = [...source.slice(source.indexOf("...invalidating(api, [")).matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]!);
  expect(keys.length).toBeGreaterThan(40);
  const mutators = keys.filter(key => /^(set|apply|animate|restore|update|reconcile)/.test(key) || ["eyeShape", "front", "resize", "onFrame"].includes(key));
  expect(mutators.filter(key => !wrapped.includes(key))).toEqual([]);
  // Reading state, evidence or timing never draws a frame (a measurement must not keep the viewport busy).
  for (const reader of ["cameraState", "frameTiming", "characterDetailsEvidence", "eyeAppearance", "eyeShapeOptions", "piercingSelection", "pick"])
    expect(wrapped).not.toContain(reader);
  // Every eye change draws a frame: a V's eyes arrive and leave with its details (the core eye hides or returns in
  // the same call), the roughness switch, and a save's facial shapes; the eye evidence is a reader.
  for (const eyeChange of ["setCharacterDetails", "setEyeOptics", "applySavedV", "eyeShape"]) expect(wrapped).toContain(eyeChange);
  const details = source.slice(source.indexOf("  function setCharacterDetails("), source.indexOf("  const ray = new THREE.Raycaster()"));
  expect(details).toContain("eyes.visible = true;");
  expect(details).toContain("eyes.visible = !resolvedEyeballs().length;");
  // The frame loop is the scheduler's, not an always-on animation loop.
  expect(source).not.toContain("setAnimationLoop");
  expect(source).toContain("bindRenderTriggers(invalidate, { controls, element: renderer.domElement, lighting })");
  expect(source).toContain("playing.onChange = invalidate");
});

test("face details request frames when they arrive, leave or change normals, and draw between the skin and the makeup plates", async () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(import.meta.dir, "..", "src", "scene.ts"), "utf8") as string;
  const wrapped = [...source.slice(source.indexOf("...invalidating(api, [")).matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]!);
  for (const change of ["setCharacterDetails", "setNormals", "applySavedV", "setStage"]) expect(wrapped).toContain(change);
  // The normals toggle reaches every loaded decal; a new V's decals take the current setting.
  const normals = source.slice(source.indexOf("    setNormals: (v: boolean) => {"), source.indexOf("    setExposure:"));
  expect(normals).toContain("decal.handle.setNormals(v)");
  expect(source).toContain("for (const item of next.components) for (const decal of item.decals ?? []) decal.handle.setNormals(normalsEnabled);");
  const { faceDecalRenderOrder } = await import("../src/scene");
  const normal = [0, 1, 2, 399, 5000].map(index => faceDecalRenderOrder("EMP_Normal", index));
  // Above the opaque skin (0), below the editable makeup plates (10 and up), the eye shell (99), brows (100) and lashes (101).
  expect(normal[0]!).toBeGreaterThan(0);
  expect(normal.every((order, i) => i === 0 || order >= normal[i - 1]!)).toBe(true);
  expect(faceDecalRenderOrder("EMP_Front", 0)).toBeGreaterThan(normal[3]!);
  expect(faceDecalRenderOrder("EMP_Front", 5000)).toBeLessThan(10);
  // An unknown or absent priority is the engine's default.
  expect(faceDecalRenderOrder(null, 1)).toBe(faceDecalRenderOrder("EMP_Normal", 1));
});
