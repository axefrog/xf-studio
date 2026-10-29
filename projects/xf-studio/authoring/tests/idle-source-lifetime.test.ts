import { expect, test } from "bun:test";
import { loadIdleSource, FACE_POLL_MS } from "../src/platform/scene/idle-source";

// The body is ready while the host still solves its face. No game files, WebGL or actual timers.
const state = { schema: "xfs/idle-state-1", phase: "ready", source: "game", rig: { joints: [] }, ancestry: {}, face: { joints: [] },
  catalogue: { idles: [{ id: "closeup", body: "body", clip: "closeup", face: { file: "face", clip: "closeup" } }] }, facePending: true };

test.each(["sleep", "reply"] as const)("rig abort stops idle-face polling during %s, removing its timer and rejecting late replies (PREV-196 release)", async phase => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = ["fetch", "setTimeout", "clearTimeout"].map(key => ({ key, value: globals[key] }));
  const timers = new Map<number, () => void>(), reply = Promise.withResolvers<Response>();
  const polled = Promise.withResolvers<void>();
  let id = 0, requests = 0;
  const life = new AbortController();
  globals.setTimeout = (run: () => void, ms: number) => { expect(ms).toBe(FACE_POLL_MS); timers.set(++id, run); return id; };
  globals.clearTimeout = (id: number) => timers.delete(id);
  globals.fetch = async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBe(life.signal);
    if (++requests === 1) return Response.json(state);
    polled.resolve(); return reply.promise; // Deliberately ignores cancellation.
  };
  try {
    const source = await loadIdleSource({ signal: life.signal });
    const pending = source.face(source.first);
    const outcome = pending.then(() => "resolved", error => (error as Error).name);
    expect(timers.size).toBe(1);
    if (phase === "reply") {
      const [key, run] = [...timers][0]!; timers.delete(key); run();
      await polled.promise;
    }
    life.abort();
    expect(timers.size).toBe(0);
    reply.resolve(Response.json(state));
    expect(await outcome).toBe("AbortError");
    expect(timers.size).toBe(0);
    expect(requests).toBe(phase === "reply" ? 2 : 1);
    await expect(source.face(source.first)).rejects.toMatchObject({ name: "AbortError" });
    await expect(loadIdleSource({ signal: life.signal })).rejects.toMatchObject({ name: "AbortError" });
  } finally { life.abort(); for (const { key, value } of previous) globals[key] = value; }
});
