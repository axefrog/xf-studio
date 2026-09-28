// Bridge 0.5.2 (session 5's findings) through the command API against the self-test host (the real bridge core and
// pipe with a simulated game). The script layer's gate is also unit-tested in native/src/selftest/UnitTests.cpp.
// Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BridgeClient } from "../bridge-lib.ts";
import { CommandApi, RequestPacer, rateLimitWaits, type BridgeTransport } from "../api/command-api.ts";
import { startSelftestHost, tempDir, type Host } from "./helpers.ts";

const apiFor = (host: Host, options: Record<string, unknown> = {}) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b8-cap-"), "captures"), auditDir: tempDir("xfb-b8-audit-"), idleCloseMs: 300, ...options });

async function layer(api: CommandApi, event: string) {
  const response = await api.callBridge("selftest.script_layer", { event }, "t-layer");
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return response.ok ? (response.result as { state: string; ready: boolean }) : null;
}

async function phase(api: CommandApi, value: string) {
  const response = await api.callBridge("selftest.phase", { phase: value }, "t-phase");
  expect(response.ok, JSON.stringify(response)).toBe(true);
}

describe("bridge 0.5.2: no script call while the game is loading (RB-76, session 5's crash)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom,inventory"], 120);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("while the script layer is detached, game.status answers loading from the plugin and every game call is refused game_loading", async () => {
    await phase(api, "photo_mode");
    await layer(api, "detach");
    const status = await api.run("game.status", {});
    expect(status.ok, JSON.stringify(status)).toBe(true);
    if (status.ok) expect(status.result).toMatchObject({ phase: "loading", answered_by: "plugin", photo_mode_can_open: false, script_layer: { state: "detached", ready: false } });
    const read = await api.run("photo.state", {});
    expect(!read.ok && read.error.code).toBe("game_loading");
    const write = await api.run("photo.camera.set", { fov: 30 });
    expect(!write.ok && write.error.code).toBe("game_loading");
    if (!write.ok) expect(write.error.message).toMatch(/loading/);
    // A write that runs its steps from the bridge thread (showroom.place's first step) is refused before it spawns anything.
    const place = await api.callBridge("showroom.place", { items: [] }, "t-place");
    expect(place.ok).toBe(false);

    await layer(api, "attach");
    const attached = await api.run("game.status", {});
    if (attached.ok) expect(attached.result).toMatchObject({ phase: "loading", script_layer: { state: "attached" } });
    await layer(api, "player_attach");
    const ready = await api.run("game.status", {});
    expect(ready.ok && (ready.result as { phase: string }).phase).toBe("photo_mode");
    const again = await api.run("photo.camera.set", { fov: 30 });
    expect(again.ok, JSON.stringify(again)).toBe(true);
  });

  test("a game.status queued before the detach and run after it answers loading instead of calling the script (the crash's exact sequence)", async () => {
    await phase(api, "gameplay");
    await layer(api, "detach_before_next_task");
    const status = await api.run("game.status", {});
    expect(status.ok, JSON.stringify(status)).toBe(true);
    if (status.ok) expect(status.result).toMatchObject({ phase: "loading", script_layer: { state: "detached" } });
    expect(host.log.some((line) => line.includes("selftest.status_while_loading"))).toBe(true);
    await layer(api, "attach");
    await layer(api, "player_attach");
  });

  test("game.load closes the gate at once; game.wait follows the load through loading to gameplay", async () => {
    await phase(api, "gameplay");
    const loaded = await api.run("game.load", { latest: true, discard_unsaved: true });
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    const during = await api.run("photo.state", {});
    // Either the gate (load requested, not yet ready) or, if the simulated load already ended, a normal answer.
    if (!during.ok) expect(during.error.code).toBe("game_loading");
    const waited = await api.run("game.wait", { phase: ["gameplay"], timeout_ms: 10000 });
    expect(waited.ok, JSON.stringify(waited)).toBe(true);
    const status = await api.run("game.status", {});
    if (status.ok) expect(status.result).toMatchObject({ phase: "gameplay", script_layer: { ready: true } });
    expect(host.log.some((line) => line.includes("script_layer.load_requested"))).toBe(true);
    expect(host.log.some((line) => line.includes("script_layer.detached"))).toBe(true);
  });
});

describe("bridge 0.5.2: pacing and rate limits (RB-77)", () => {
  let host: Host;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes"], 60);
  });
  afterAll(async () => {
    await host?.stop();
  });

  test("the plugin's limit still refuses a raw burst, but the command API paces itself and never meets it", async () => {
    const raw = new BridgeClient(host.session, 5000);
    await raw.connect();
    const answers = await Promise.all(Array.from({ length: 60 }, (_, i) => raw.call("bridge.ping", {}, `t-burst-${i}`)));
    raw.close();
    expect(answers.some((a) => !a.ok && a.error?.code === "rate_limited")).toBe(true);
    await new Promise((r) => setTimeout(r, 2500)); // let the plugin's bucket refill
    const api = apiFor(host);
    const started = performance.now();
    for (let i = 0; i < 50; i++) {
      const status = await api.callBridge("game.status", {}, `t-paced-${i}`);
      expect(status.ok, JSON.stringify(status)).toBe(true);
    }
    expect(api.rateLimitRetries).toBe(0);
    expect(performance.now() - started).toBeGreaterThan(1500); // 50 requests at 16 a second, after a burst of 16
    api.close();
  });

  test("a request refused rate_limited is retried with growing waits (a restore after framing included), then passed on", async () => {
    let refusals = 2;
    const calls: string[] = [];
    const transport: BridgeTransport = {
      call: async (method) => {
        calls.push(method);
        if (refusals > 0) {
          refusals--;
          return { v: 1, id: 1, cid: "t", ok: false, error: { code: "rate_limited", message: "more than 20 requests per second" } };
        }
        return { v: 1, id: 1, cid: "t", ok: true, result: { applied: [] } };
      },
      close: () => undefined,
    };
    const api = apiFor(host, { transport: async () => transport });
    const restored = await api.callBridge("photo.camera.set", { fov: 35 }, "t-restore");
    expect(restored.ok).toBe(true);
    expect(calls.length).toBe(3);
    expect(api.rateLimitRetries).toBe(2);

    refusals = 1000;
    const short = apiFor(host, { transport: async () => transport, rateLimitPatienceMs: 400 });
    const refused = await short.callBridge("photo.camera.set", { fov: 35 }, "t-refused");
    expect(!refused.ok && refused.error.code).toBe("rate_limited");
    expect(short.rateLimitRetries).toBe(rateLimitWaits(400).length);
    api.close();
    short.close();
  });

  test("the pacer allows a burst, then spaces requests at its rate", () => {
    let now = 0;
    const pacer = new RequestPacer(10, () => now);
    const waits = Array.from({ length: 12 }, () => pacer.take());
    expect(waits.slice(0, 10).every((w) => w === 0)).toBe(true);
    expect(waits[10]).toBe(100);
    expect(waits[11]).toBe(200);
    now = 5000;
    expect(pacer.take()).toBe(0);
    expect(rateLimitWaits(4000)).toEqual([150, 300, 600, 1000, 1000]);
  });
});
