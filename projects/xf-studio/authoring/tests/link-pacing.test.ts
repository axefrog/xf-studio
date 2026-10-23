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

test("an upload is sent only once the GPU process has caught up with the last one (gpu-gate.ts); without fences the gate is always idle", async () => {
  const { gpuGate } = await import("../src/platform/scene/gpu-gate");
  let signaled = false, deleted = 0;
  const gl = { fenceSync: () => ({}), flush() {}, getSyncParameter: () => signaled ? 1 : 0, deleteSync() { deleted++; }, isContextLost: () => false,
    SIGNALED: 1, SYNC_STATUS: 2, SYNC_GPU_COMMANDS_COMPLETE: 3 } as unknown as WebGL2RenderingContext;
  const gate = gpuGate(gl);
  expect(gate.idle()).toBe(true);
  gate.mark();
  expect(gate.idle()).toBe(false);
  signaled = true;
  expect(gate.idle()).toBe(true);
  expect(deleted).toBe(1);
  expect(gpuGate(undefined).idle()).toBe(true);
});
