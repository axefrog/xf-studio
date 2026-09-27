/**
 * The facial preview service (facial-preview.ts; design §5.2, §9 "Solver port") with a fake device and sink: newest wins and nothing
 * stale is queued, a slow solve shows "updating" in place, the blink composes into the request, the idle is explained with one next
 * step, and every unavailable state says why in plain words.
 */
import { expect, test } from "bun:test";
import { combineFacePoses, FacialPreview, SLOW_SOLVE_MS, type FacialDevicePort, type FacialMotion, type FacialSolved, type FacialTimer } from "../src/facial-preview";
import { FACIAL_STATE_SCHEMA, type FacialHostState, type FacialSolveRequest } from "../src/platform/api/facial";

const JOINTS = [{ name: "root", parent: -1, t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, { name: "jaw", parent: 0, t: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }];
const readyState = (patch: Partial<FacialHostState> = {}): FacialHostState => ({ schema: FACIAL_STATE_SCHEMA,
  rig: { phase: "ready", controls: [], joints: JOINTS }, solver: { phase: "ready" }, blink: { available: true, closedTime: 0.1, duration: 0.5, rate: 60 },
  expressions: { phase: "ready", count: 0 }, ...patch });
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
  const held: { frames: number; jaw?: number; rate?: number; repeat?: number }[] = [];
  let released = 0;
  const sink = { setRig: () => {}, hold: (pose: { frames: ReadonlyMap<number, { t: readonly number[] }>[]; rate?: number; repeat?: number }) =>
    held.push({ frames: pose.frames.length, jaw: pose.frames[0]?.get(1)?.t[0], rate: pose.rate, repeat: pose.repeat }), release: () => { released++; } };
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
  h.preview.retry();
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
  expect(noSolver.preview.snapshot()).toMatchObject({ phase: "unavailable", next: "guide" });
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
