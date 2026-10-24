/**
 * Profiles phase 4a-v-b (experiment 043 §11): compiling ahead keeps only a few programs linking on the driver's threads at once, so the
 * page's own thread keeps a core (link-pacing.ts).
 */
import { expect, test } from "bun:test";
import { linkPacer, linksInFlight } from "../src/platform/scene/link-pacing";

test("a quarter of the cores link at once, two to six", () => {
  expect([linksInFlight(2), linksInFlight(8), linksInFlight(20), linksInFlight(64)]).toEqual([2, 2, 5, 6]);
});

test("a new program waits, a frame at a time, until fewer than the limit are linking; without the extension it never waits", async () => {
  let frames = 0;
  const programs = Array.from({ length: 5 }, () => ({ ready: false, isReady() { return this.ready; } }));
  const pacer = linkPacer({ parallel: true, limit: 2, frame: async () => { frames++; if (frames === 3) programs[0]!.ready = true; } });
  await pacer.admit(); pacer.add([programs[0]!]);
  await pacer.admit(); pacer.add([programs[1]!, programs[1]!]);
  expect(frames).toBe(0);
  // Two linking: the third waits until one is done (on the third frame).
  await pacer.admit();
  expect(frames).toBe(3);
  pacer.add([programs[2]!]);
  const serial = linkPacer({ parallel: false, limit: 1, frame: async () => { throw Error("never waits"); } });
  serial.add(programs); await serial.admit();
});

test("a wait for a link slot ends when its signal aborts: a superseded or lost-context preparation never waits for links that won't finish (4a-v-b review 2)", async () => {
  let frames = 0;
  const controller = new AbortController();
  // Links that never finish (a lost context's): the limit stays full.
  const never = Array.from({ length: 2 }, () => ({ isReady: () => false }));
  const pacer = linkPacer({ parallel: true, limit: 2, frame: async () => { frames++; if (frames === 3) controller.abort(); } });
  pacer.add(never);
  await pacer.admit(controller.signal);
  expect([frames, controller.signal.aborted]).toEqual([3, true]);
  // Aborted already: it doesn't wait at all.
  await pacer.admit(controller.signal);
  expect(frames).toBe(3);
});

/** A WebGL 2 stand-in with fences: each one's status set by the test, and every fence made and deleted counted. */
function fencing() {
  const made: { signaled: boolean | null; deleted: boolean }[] = [];
  let lost = false;
  const gl = { fenceSync: () => { const fence = { signaled: false as boolean | null, deleted: false }; made.push(fence); return fence; }, flush() {},
    getSyncParameter: (fence: { signaled: boolean | null }) => fence.signaled === null ? null : fence.signaled ? 0x9119 : 0x9118,
    deleteSync: (fence: { deleted: boolean }) => { fence.deleted = true; }, isContextLost: () => lost,
    SIGNALED: 0x9119, UNSIGNALED: 0x9118, SYNC_STATUS: 0x9114, SYNC_GPU_COMMANDS_COMPLETE: 0x9117 } as unknown as WebGL2RenderingContext;
  return { renderer: { getContext: () => gl }, made, lose(value: boolean) { lost = value; } };
}

test("an upload is sent only once the GPU process has caught up with the last one (gpu-gate.ts); without fences the gate is always idle", async () => {
  const { gpuGate } = await import("../src/platform/scene/gpu-gate");
  const { renderer, made } = fencing();
  const gate = gpuGate(renderer);
  expect(gate.idle()).toBe(true);
  gate.mark();
  expect(gate.idle()).toBe(false);
  made[0]!.signaled = true;
  expect(gate.idle()).toBe(true);
  expect(made.map(fence => fence.deleted)).toEqual([true]);
  expect(gpuGate({}).idle()).toBe(true);
});

test("the gate's fence belongs to its context generation: a loss and restore between two polls, or a status the context no longer reports, never closes it (4a-v-b review 1)", async () => {
  const { gpuGate } = await import("../src/platform/scene/gpu-gate");
  const { beginContextGeneration, endContextGeneration } = await import("../src/platform/scene/context-generation");
  const { renderer, made, lose } = fencing();
  const gate = gpuGate(renderer);
  gate.mark();
  expect(gate.idle()).toBe(false);
  // Lost and restored between two polls: the context reports nothing lost, and the old fence's status would never signal.
  lose(true); endContextGeneration(renderer); lose(false); beginContextGeneration(renderer);
  expect(gate.idle()).toBe(true);
  // The lost context's fence is forgotten, never deleted on the restored one.
  expect(made[0]!.deleted).toBe(false);
  // A fence the context no longer knows (its status reads null) counts as passed.
  gate.mark();
  made[1]!.signaled = null;
  expect(gate.idle()).toBe(true);
  // Marked while lost: no fence at all.
  lose(true);
  gate.mark();
  expect(made).toHaveLength(2);
  expect(gate.idle()).toBe(true);
});

test("a gate's last fence is deleted when its owner is done, and a drain deletes its own however it ends (4a-v-b review 7)", async () => {
  const { gpuDrained, gpuGate } = await import("../src/platform/scene/gpu-gate");
  const { renderer, made } = fencing();
  const gate = gpuGate(renderer);
  gate.mark(); gate.mark();
  gate.dispose();
  expect(made.map(fence => fence.deleted)).toEqual([true, true]);
  // A drain waits a frame at a time, at most `frames`, then deletes its fence.
  let frames = 0;
  expect(await gpuDrained(renderer, { frames: 3, frame: async () => { frames++; } })).toBe(3);
  expect(made[2]!.deleted).toBe(true);
  // One whose frame throws (the preparation was stopped) still deletes it.
  await expect(gpuDrained(renderer, { frames: 3, frame: async () => { throw new DOMException("Stopped.", "AbortError"); } })).rejects.toMatchObject({ name: "AbortError" });
  expect(made.every(fence => fence.deleted)).toBe(true);
  // Signalled after a frame: one frame waited.
  frames = 0;
  expect(await gpuDrained(renderer, { frames: 10, frame: async () => { frames++; made.at(-1)!.signaled = true; } })).toBe(1);
  expect(made.every(fence => fence.deleted)).toBe(true);
});
