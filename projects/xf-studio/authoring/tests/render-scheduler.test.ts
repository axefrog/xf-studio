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
    /** Let time pass without a refresh (work done inside a frame). */
    advance(ms: number) { time += ms; },
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

test("a request made inside a frame never shortens the next frame's dt, so playback keeps real time while orbiting (UI-45)", () => {
  const clock = manualClock(), frames: number[] = [], starts: number[] = [];
  let playing = true, orbiting = true;
  const scheduler = createRenderScheduler({ clock: clock.clock, animating: () => playing,
    // The controls update 5 ms into the frame and report a change, as a damped orbit step does.
    frame: (dt, now) => { frames.push(dt); starts.push(now); clock.advance(5); if (orbiting) scheduler.invalidate(); } });
  scheduler.invalidate();
  for (let i = 0; i < 10; i++) clock.step(16);
  // Each frame's dt is the whole time since the previous frame began (21 ms here), so the idle advances by exactly
  // the time that passed; before the fix it counted only from the request, losing the 5 ms spent before it.
  for (let i = 1; i < frames.length; i++) expect(frames[i]!).toBeCloseTo((starts[i]! - starts[i - 1]!) / 1000, 9);
  expect(frames.slice(1).reduce((sum, dt) => sum + dt, 0)).toBeCloseTo((starts.at(-1)! - starts[0]!) / 1000, 9);
  playing = false;
  clock.step(16);
  // The request inside the last frame still draws one more; then the orbit settles and the loop stops.
  expect(clock.pending).toBe(true);
  orbiting = false;
  clock.step(16);
  expect(clock.pending).toBe(false);
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

/**
 * A source check, not a behavioural one, so its reach is limited:
 * - It decides what is a mutator by name (a `set`/`apply`/`animate`/`restore`/`update`/`reconcile` prefix, or the
 *   listed exceptions). A new method that changes the picture under another name (say `toggleX` or `loadY`) is not
 *   caught; add it to the exception list, or name it with one of the prefixes.
 * - It reads the `api` object literal's keys by indentation and layout, so a reformatted `scene.ts` (a nested
 *   object, a spread, a key on the same line as another) can hide keys from it. The count floor catches only a
 *   wholesale miss.
 * - It proves a mutator is wrapped, not that the wrapped call changes anything or that a change made elsewhere
 *   (a closure, an event handler, an async continuation) requests a frame. Those are covered by the trigger tests
 *   above and the browser check.
 */
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
  expect(details).toContain("eyes.visible = !resolvedEyeballs().length && !layeredEyes().length;");
  // Layered stacks (piercings, eye designs) bake inside the same wrapped call, so the frame that follows draws the baked maps.
  expect(details).toContain("const bakeLimits = bakeLayered();");
  // Showing or hiding piercings draws a frame; trying a style reaches the scene as new details (setCharacterDetails).
  expect(wrapped).toContain("setPiercings");
  // The frame loop is the scheduler's, not an always-on animation loop.
  expect(source).not.toContain("setAnimationLoop");
  expect(source).toContain("bindRenderTriggers(invalidate, { controls, element: renderer.domElement, lighting })");
  expect(source).toContain("playing.onChange = invalidate");
});

test("the authored plate's light, skin and composite change only inside calls that request a frame, and idle costs nothing", async () => {
  const source = require("node:fs").readFileSync(require("node:path").resolve(import.meta.dir, "..", "src", "scene.ts"), "utf8") as string;
  const wrapped = [...source.slice(source.indexOf("...invalidating(api, [")).matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]!);
  // The skin light and the skin under the plate arrive and leave with the V's details (setCharacterDetails, wrapped).
  const refresh = source.slice(source.indexOf("  function refreshPlateUnderlay() {"), source.indexOf("  refreshPlateUnderlay();\n"));
  expect(refresh).toContain("makeup.setSkinLight(item?.skin?.handle.parameters ?? null);");
  const details = source.slice(source.indexOf("  function setCharacterDetails("), source.indexOf("  const ray = new THREE.Raycaster()"));
  expect(details.split("refreshPlateUnderlay();").length - 1).toBe(2);
  expect(source.split("refreshPlateUnderlay();").length - 1).toBe(3);
  for (const change of ["setCharacterDetails", "setNormals", "updateLayer", "setLayerCanvas", "setLayerCanvases", "reconcileLayerCanvases", "setWire"])
    expect(wrapped).toContain(change);
  // The normals toggle reaches the plate's facets; the composite is brought up to date inside the frame, before drawing.
  const normals = source.slice(source.indexOf("    setNormals: (v: boolean) => {"), source.indexOf("    setExposure:"));
  expect(normals).toContain("makeup.setNormals(v);");
  const frame = source.slice(source.indexOf("    frame(dt, now) {"), source.indexOf("  const invalidate = () => scheduler.invalidate();"));
  expect(frame.indexOf("makeup.prepareBlend(renderer);")).toBeGreaterThan(-1);
  expect(frame.indexOf("makeup.prepareBlend(renderer);")).toBeLessThan(frame.indexOf("lighting.render(camera);"));
  // A restored context (a canvas trigger, so a frame follows) prefilters the environment again and redraws the composite (PREV-58).
  expect(CANVAS_TRIGGERS).toContain("webglcontextrestored");
  expect(source).toContain("studio.restore(); makeup.contextRestored();");
  // …and bakes the shown V's layered parts again from their stacks (PREV-62).
  const restore = source.slice(source.indexOf("const restored = () => {"), source.indexOf("renderer.domElement.addEventListener(\"webglcontextrestored\", restored)"));
  expect(restore).toContain("layeredContextRestored(renderer);");
  expect(restore).toContain("handle.contextRestored()");
  expect(restore).toContain("bakeLayered();");
  expect(source).toContain(`renderer.domElement.addEventListener("webglcontextrestored", restored);`);
  // Behaviour: a skin-light change needs no composite pass, and an unchanged stack draws nothing more.
  const { createMakeupStack } = await import("../src/makeup-stack");
  const THREE = await import("three");
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0.25, 0.5, 0.75, 0.5, 0.25, 0.625], 2));
  const anchor = new THREE.SkinnedMesh(geometry), root = new THREE.Group();
  root.add(anchor);
  const stack = createMakeupStack(anchor, 1);
  let draws = 0, target: unknown = null;
  const renderer = { capabilities: { maxTextureSize: 4096 }, extensions: { has: () => true }, autoClear: true, getRenderTarget: () => target,
    setRenderTarget: (next: unknown) => { target = next; }, getClearColor: (out: InstanceType<typeof THREE.Color>) => out, getClearAlpha: () => 1,
    setClearColor: () => {}, clear: () => {}, render: () => { draws++; } } as unknown as import("three").WebGLRenderer;
  const n = 3;
  const underlay = () => ({ colour: new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.4), 3),
    roughness: new THREE.BufferAttribute(new Float32Array(n).fill(0.6), 1), metalness: new THREE.BufferAttribute(new Float32Array(n), 1) });
  stack.setCanvases([{ width: 16, height: 16 } as HTMLCanvasElement]);
  stack.setUnderlaySource(underlay);
  stack.updateLayer(0, (await import("../src/recipe")).initialRecipe().layers[0]!);
  stack.prepareBlend(renderer);
  // One composite update: the layer, the resolve and the 9 × 3 composite's four roughness levels (plate-composite.ts).
  expect(stack.blendDiagnostics().plate.compositeDraws).toEqual({ layerDraws: 1, resolves: 1, levelDraws: 4 });
  const once = draws;
  stack.setSkinLight({ lobes: { roughness0: 0.97, roughness1: 1.6, weight: 1 }, wrap: [0.3, 0.2, 0.2] });
  stack.setNormals(false);
  for (let frame = 0; frame < 5; frame++) stack.prepareBlend(renderer);
  expect(draws).toBe(once);
  stack.setCanvases([]);
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
