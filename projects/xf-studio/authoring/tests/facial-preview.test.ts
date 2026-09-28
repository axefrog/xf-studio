/**
 * The facial preview service (facial-preview.ts; design §5.2, §9 "Solver port") with a fake device and sink: newest wins and nothing
 * stale is queued, a slow solve shows "updating" in place, the blink composes into the request, the idle is explained with one next
 * step, and every unavailable state says why in plain words.
 */
import { expect, test } from "bun:test";
import { combineFacePoses, FacialPreview, FRAME_MS, SLOW_SOLVE_MS, type FacialDevicePort, type FacialMotion, type FacialSolved, type FacialTimer } from "../src/facial-preview";
import type { TransitionSetting } from "../src/platform/core/transition-settings";
import { f32 } from "../src/engines/facial-rig/vector";
import { FACIAL_STATE_SCHEMA, type FacialHostState, type FacialSolveRequest } from "../src/platform/api/facial";

const JOINTS = [{ name: "root", parent: -1, t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, { name: "jaw", parent: 0, t: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }];
const readyState = (patch: Partial<FacialHostState> = {}): FacialHostState => ({ schema: FACIAL_STATE_SCHEMA,
  rig: { phase: "ready", controls: [], joints: JOINTS }, solver: { phase: "ready" }, blink: { available: true, closedTime: 0.1, duration: 0.5, rate: 60 },
  expressions: { phase: "ready", count: 0 }, samples: [], ...patch });
/** A solved pose moving the jaw joint by `amount` (REDengine +X). */
const solved = (amount: number, frames = 1): FacialSolved => ({ ok: true, frames, ...(frames > 1 ? { rate: 60 } : {}), ms: 0.7, skipped: [],
  pose: { q: Float32Array.from({ length: frames * 8 }, (_, i) => i % 4 === 3 ? 1 : 0), t: Float32Array.from({ length: frames * 6 }, (_, i) => i % 6 === 3 ? amount : 0) } });

function harness(state = readyState()) {
  let now = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timer: FacialTimer = { set: (run, ms) => { const id = next++; timers.set(id, { at: now + ms, run }); return id; }, clear: id => timers.delete(id as number), now: () => now };
  const advance = (ms: number) => { now += ms; for (const [id, entry] of [...timers]) if (entry.at <= now) { timers.delete(id); entry.run(); } };
  const requests: FacialSolveRequest[] = [], answers: ((value: FacialSolved) => void)[] = [];
  const device: FacialDevicePort = {
    state: async () => state, expressions: async () => ({ phase: "ready", items: [] }),
    solve: request => { requests.push(request); return new Promise(resolve => answers.push(resolve)); },
  };
  const held: { frames: number; jaw?: number; rate?: number; repeat?: number; continues?: boolean }[] = [];
  let released = 0;
  const sink = { setRig: () => {}, hold: (pose: { frames: ReadonlyMap<number, { t: readonly number[] }>[]; rate?: number; repeat?: number; continues?: boolean }) =>
    held.push({ frames: pose.frames.length, jaw: pose.frames[0]?.get(1)?.t[0], rate: pose.rate, repeat: pose.repeat, ...(pose.continues ? { continues: true } : {}) }),
    release: () => { released++; } };
  let pose: Record<string, number> | undefined, motion: FacialMotion = { idle: false, blink: 0, blinkPlaying: false, blinkRepeatSeconds: 2.45 };
  const preview = new FacialPreview(device, timer);
  preview.follow(() => pose, () => motion);
  return { preview, requests, answers, held, sink, timer, advance, get released() { return released; },
    setPose(value: Record<string, number> | undefined) { pose = value; preview.changed(); },
    setMotion(value: Partial<FacialMotion>) { motion = { ...motion, ...value }; preview.changed(); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("newest wins: one solve in flight, edits meanwhile solve once more with the latest vector, nothing stale is queued", async () => {
  const h = harness();
  h.preview.start(); await settle();
  h.preview.attachScene(h.sink);
  expect(h.preview.snapshot().phase).toBe("idle");
  h.setPose({ jaw_mid_open: 0.1 });
  h.setPose({ jaw_mid_open: 0.2 });
  h.setPose({ jaw_mid_open: 0.3 });
  expect(h.requests.map(request => request.controls)).toEqual([{ jaw_mid_open: 0.1 }]);
  h.answers[0]!(solved(0.01)); await settle();
  // The answer for 0.1 is shown (the last exact pose), then only the newest state is asked for.
  expect(h.held.length).toBe(1);
  expect(h.requests.map(request => request.controls)).toEqual([{ jaw_mid_open: 0.1 }, { jaw_mid_open: 0.3 }]);
  h.answers[1]!(solved(0.03)); await settle();
  expect(h.held.length).toBe(2);
  expect(h.held[1]!.jaw).toBeCloseTo(0.03, 6);
  expect(h.requests.length).toBe(2);
  expect(h.preview.snapshot()).toMatchObject({ phase: "ready", latency: { count: 2, solver: 0.7 } });
  // An unchanged state asks for nothing; releasing the expression releases the face.
  h.preview.changed();
  expect(h.requests.length).toBe(2);
  h.setPose(undefined);
  expect(h.released).toBe(1);
});

test("a slow solve shows updating in place; a superseded answer is ignored; a failure says why and offers Try again", async () => {
  const h = harness();
  h.preview.start(); await settle();
  h.preview.attachScene(h.sink);
  h.setPose({ lips_l_corner_up: 0.3 });
  h.advance(SLOW_SOLVE_MS + 1);
  expect(h.preview.snapshot().phase).toBe("updating");
  h.answers[0]!({ ok: false, code: "superseded", message: "newer" }); await settle();
  expect(h.preview.snapshot().phase).toBe("ready");
  expect(h.held.length).toBe(0);
  h.setPose({ lips_l_corner_up: 0.4 });
  h.answers[1]!({ ok: false, code: "failed", message: "The facial solver couldn't solve that pose." }); await settle();
  expect(h.preview.snapshot()).toMatchObject({ phase: "failed", reason: "The facial solver couldn't solve that pose.", next: "retry" });
  // Try again asks the host for its state first (a stopped solver is started again there, CORE-101), then solves.
  h.preview.retry(); await settle();
  expect(h.requests.length).toBe(3);
});

test("the blink composes into the request; Play blink holds the solved clip at its rate, repeating", async () => {
  const h = harness();
  h.preview.start(); await settle();
  h.preview.attachScene(h.sink);
  h.setPose({ lips_l_corner_up: 0.3 });
  h.answers[0]!(solved(0)); await settle();
  h.setMotion({ blink: 0.6 });
  expect(h.requests[1]).toEqual({ controls: { lips_l_corner_up: 0.3 }, blink: { closure: 0.6 } });
  h.answers[1]!(solved(0)); await settle();
  h.setMotion({ blinkPlaying: true });
  expect(h.requests[2]!.blink).toEqual({ play: true });
  h.answers[2]!(solved(0, 31)); await settle();
  expect(h.held.at(-1)).toMatchObject({ frames: 31, rate: 60, repeat: 2.45 });
  // While the idle plays, the blink is left out and the drawer says why, with one click to stop it.
  h.setMotion({ idle: true, blinkPlaying: false });
  expect(h.requests.at(-1)).toEqual({ controls: { lips_l_corner_up: 0.3 } });
  expect(h.preview.snapshot()).toMatchObject({ reason: expect.stringContaining("idle is playing"), next: "stop-idle" });
});

test("every unavailable state is plain words with a next step", async () => {
  const unconfigured = harness(readyState({ rig: { phase: "unconfigured", reason: "Set your game folder." } }));
  unconfigured.preview.start(); await settle();
  expect(unconfigured.preview.snapshot()).toMatchObject({ phase: "unavailable", reason: "Set your game folder.", next: "game-setup" });
  const noSolver = harness(readyState({ solver: { phase: "missing", reason: "The live face preview needs the facial solver." } }));
  noSolver.preview.start(); await settle();
  noSolver.preview.attachScene(noSolver.sink);
  noSolver.setPose({ jaw_mid_open: 0.2 });
  // Editing still works (the part is saved); nothing is sent to a solver that isn't there.
  expect(noSolver.requests.length).toBe(0);
  // No solver on this computer: the expression still saves and exports, so the one next step is Expression sets.
  expect(noSolver.preview.snapshot()).toMatchObject({ phase: "unavailable", next: "export" });
  const noHead = harness();
  noHead.preview.start(); await settle();
  noHead.setPose({ jaw_mid_open: 0.2 });
  expect(noHead.preview.snapshot().reason).toContain("once it's ready");
});

test("several posers combine by summing and clamping", () => {
  expect(combineFacePoses([undefined, {}])).toBeUndefined();
  const one = { a: 0.2 };
  expect(combineFacePoses([one, undefined])).toBe(one);
  expect(combineFacePoses([{ a: 0.7, b: 0.1 }, { a: 0.5 }])).toEqual({ a: 1, b: 0.1 });
});

test("controls the host found move nothing are marked inert in the snapshot, and the built-in samples pass through", async () => {
  const control = (name: string) => ({ name, track: 1, group: "mouth" as const, label: name, text: name, side: null, partner: null, pair: null, direction: false });
  const sample = { id: "xf-sample:test", name: "Test", summary: "AU12 lip corner puller", controls: { jaw_mid_open: 0.1 }, links: {} };
  const preview = new FacialPreview({ state: async () => readyState({ rig: { phase: "ready", controls: [control("jaw_mid_open"), control("lips_corner_sticky")],
    joints: JOINTS, inert: ["lips_corner_sticky"] }, samples: [sample] }), expressions: async () => ({ phase: "ready", items: [] }),
    solve: async () => solved(0) });
  preview.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  const snapshot = preview.snapshot();
  expect(snapshot.controls!.map(item => [item.name, !!item.inert])).toEqual([["jaw_mid_open", false], ["lips_corner_sticky", true]]);
  expect(snapshot.samples).toEqual([sample]);
  // The marked list is reused while the host's lists are unchanged.
  expect(preview.snapshot().controls).toBe(snapshot.controls);
  preview.dispose();
});

test("two-way controls: the names' proposals (marked proposed) until the solver confirms its own pairs, which replace them", async () => {
  const control = (name: string) => ({ name, track: 1, group: "gaze" as const, label: name, text: name, side: null, partner: null, pair: null, direction: false });
  const controls = ["eye_l_dir_in", "eye_l_dir_out", "eye_r_dir_in", "eye_r_dir_out", "eye_l_dir_up", "eye_l_dir_dn", "nose_l_breathe_in", "nose_l_breathe_out"].map(control);
  let state = readyState({ rig: { phase: "ready", controls, joints: JOINTS }, solver: { phase: "missing", reason: "No solver here." } });
  const preview = new FacialPreview({ state: async () => state, expressions: async () => ({ phase: "ready", items: [] }), solve: async () => solved(0) });
  preview.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  const before = preview.snapshot().axes!;
  expect(before.map(axis => [axis.key, !!axis.proposed])).toEqual([["eye_l_dir_out~eye_l_dir_in", true], ["eye_r_dir_in~eye_r_dir_out", true], ["eye_l_dir_dn~eye_l_dir_up", true]]);
  // Gaze pairs link to each other as before (one value moves both eyes the same way).
  expect(before[0]!.link?.counterpart).toBe("eye_r_dir_in~eye_r_dir_out");
  // The solver ran: its list wins (here it confirmed the nostril too and rejected vertical gaze).
  state = readyState({ rig: { phase: "ready", controls, joints: JOINTS, axes: [
    { negative: "eye_l_dir_out", positive: "eye_l_dir_in", direction: "lateral", frame: "world" },
    { negative: "eye_r_dir_in", positive: "eye_r_dir_out", direction: "lateral", frame: "world" },
    { negative: "nose_l_breathe_out", positive: "nose_l_breathe_in", direction: "lateral", frame: "outward" }] } });
  preview.retry();
  await new Promise(resolve => setTimeout(resolve, 10));
  const after = preview.snapshot().axes!;
  expect(after.map(axis => [axis.key, !!axis.proposed])).toEqual([["eye_l_dir_out~eye_l_dir_in", false], ["eye_r_dir_in~eye_r_dir_out", false], ["nose_l_breathe_out~nose_l_breathe_in", false]]);
  preview.dispose();
});

/** A harness whose changes animate by `setting` (and follow at once while `continuous`); `frames(ms)` runs the clock, answering every solve. */
async function animated(setting: TransitionSetting) {
  const h = harness();
  let continuous = false, current = setting;
  h.preview.animate({ setting: () => current, continuous: () => continuous });
  h.preview.start(); await settle();
  h.preview.attachScene(h.sink);
  let answered = 0;
  const answer = async () => { while (answered < h.answers.length) { h.answers[answered++]!(solved(0.01)); await settle(); } };
  return { ...h, answer, get released() { return h.released; },
    async frames(ms: number) { for (let t = 0; t < ms; t += FRAME_MS) { h.advance(FRAME_MS); await answer(); } },
    setContinuous(value: boolean) { continuous = value; },
    setSetting(value: TransitionSetting) { current = value; h.preview.changed(); } };
}
const jawOf = (request: FacialSolveRequest | undefined) => request?.controls.jaw_mid_open ?? 0;

test("with the transition on, a new expression eases from the face on screen, one solve a frame, and ends on its exact solve", async () => {
  const h = await animated({ enabled: true, seconds: 1, easing: "linear" });
  h.setPose({ jaw_mid_open: f32(0.4) });
  // At the moment of the change the face is still at rest: nothing to solve yet, and no jump.
  expect(h.requests.length).toBe(0);
  await h.frames(500);
  const halfway = h.requests.at(-1)!;
  expect(jawOf(halfway)).toBeGreaterThan(0.18);
  expect(jawOf(halfway)).toBeLessThan(0.21);
  // About one solve a frame (not one per answer), each a little further along.
  expect(h.requests.length).toBeGreaterThan(20);
  expect(h.requests.length).toBeLessThan(35);
  const values = h.requests.map(jawOf);
  for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  await h.frames(600);
  expect(h.requests.at(-1)!.controls).toEqual({ jaw_mid_open: f32(0.4) });
  const count = h.requests.length;
  await h.frames(200);
  expect(h.requests.length).toBe(count);
  expect(h.preview.snapshot()).toMatchObject({ phase: "ready", transition: { enabled: true, seconds: 1, easing: "linear" } });
});

test("a change mid-transition starts from the blended face, returning to rest ends released, and 0 s or off cuts", async () => {
  const h = await animated({ enabled: true, seconds: 1, easing: "inOut" });
  h.setPose({ jaw_mid_open: 1 });
  await h.frames(400);
  const before = jawOf(h.requests.at(-1));
  h.setPose({ lips_l_corner_up: f32(0.5) });
  await h.frames(FRAME_MS * 2);
  // The next frames start where the face was: the jaw is still near its blended value, easing out.
  const after = h.requests.at(-1)!;
  expect(Math.abs(jawOf(after) - before)).toBeLessThan(0.05);
  expect(after.controls.lips_l_corner_up ?? 0).toBeLessThan(0.05);
  await h.frames(1100);
  expect(h.requests.at(-1)!.controls).toEqual({ lips_l_corner_up: f32(0.5) });
  // Back to rest eases down, then releases the face.
  h.setPose(undefined);
  expect(h.released).toBe(0);
  await h.frames(1100);
  expect(h.released).toBe(1);
  // 0 s cuts: the target is asked for at once.
  h.setSetting({ enabled: true, seconds: 0, easing: "linear" });
  h.setPose({ jaw_mid_open: f32(0.3) });
  expect(h.requests.at(-1)!.controls).toEqual({ jaw_mid_open: f32(0.3) });
  // Turning it off mid-way cuts to the target.
  h.setSetting({ enabled: true, seconds: 2, easing: "linear" });
  h.setPose({ jaw_mid_open: f32(0.9) });
  await h.frames(300);
  expect(jawOf(h.requests.at(-1))).toBeLessThan(0.5);
  h.setSetting({ enabled: false, seconds: 2, easing: "linear" });
  await h.answer();
  expect(h.requests.at(-1)!.controls).toEqual({ jaw_mid_open: f32(0.9) });
});

test("a change inside a form control follows at once; while the idle hides the face every change cuts", async () => {
  const h = await animated({ enabled: true, seconds: 1, easing: "linear" });
  h.setContinuous(true);
  h.setPose({ jaw_mid_open: f32(0.2) });
  expect(h.requests.at(-1)!.controls).toEqual({ jaw_mid_open: f32(0.2) });
  h.setContinuous(false);
  await h.answer();
  h.setMotion({ idle: true });
  const count = h.requests.length;
  h.setPose({ jaw_mid_open: f32(0.7) });
  await h.answer();
  expect(h.requests.length).toBe(count + 1);
  expect(h.requests.at(-1)!.controls).toEqual({ jaw_mid_open: f32(0.7) });
  await h.frames(300);
  expect(h.requests.length).toBe(count + 1);
});

test("the blink clip carries on through a transition instead of restarting at every frame", async () => {
  const h = await animated({ enabled: true, seconds: 0.5, easing: "linear" });
  h.setMotion({ blinkPlaying: true });
  h.setPose({ jaw_mid_open: f32(0.5) });
  const answerClip = async () => { for (let i = h.held.length; i < h.answers.length; i++) { h.answers[i]!(solved(0.01, 31)); await settle(); } };
  for (let t = 0; t < 300; t += FRAME_MS) { h.advance(FRAME_MS); await answerClip(); }
  expect(h.requests.every(request => request.blink && "play" in request.blink)).toBe(true);
  expect(h.held.length).toBeGreaterThan(3);
  // The first hold starts the clip; every later one over a changed face carries on.
  expect(h.held[0]!.continues).toBeUndefined();
  expect(h.held.slice(1).every(pose => pose.continues)).toBe(true);
});

test("the installed expressions are asked for only once the Expressions view shows, then until they are read (PREV-179)", async () => {
  let now = 0, asked = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timer: FacialTimer = { set: (run, ms) => { const id = next++; timers.set(id, { at: now + ms, run }); return id; }, clear: id => timers.delete(id as number), now: () => now };
  const advance = (ms: number) => { now += ms; for (const [id, entry] of [...timers]) if (entry.at <= now) { timers.delete(id); entry.run(); } };
  // The host hasn't been asked, so its installed expressions stay "preparing" until the first ask.
  const device: FacialDevicePort = { state: async () => readyState({ expressions: { phase: asked ? "ready" : "preparing", count: asked ? 1 : 0 } }),
    expressions: async () => (++asked < 2 ? { phase: "preparing", items: [] } : { phase: "ready", items: [] }), solve: async () => solved(0) };
  const preview = new FacialPreview(device, timer);
  preview.start(); await settle();
  expect(asked).toBe(0);
  // Nothing to wait for while nobody wants them: the state isn't polled.
  expect(timers.size).toBe(0);
  expect(preview.snapshot().startPoints.phase).toBe("preparing");
  preview.installed(); await settle();
  expect(asked).toBe(1);
  expect(timers.size).toBe(1);
  advance(10_000); await settle();
  expect(asked).toBe(2);
  expect(preview.snapshot().startPoints.phase).toBe("ready");
  expect(timers.size).toBe(0);
  preview.installed(); await settle();
  expect(asked).toBe(2);
  preview.dispose();
});
