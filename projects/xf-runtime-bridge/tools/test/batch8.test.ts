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
    expect(performance.now() - started).toBeGreaterThan(600); // after a burst of 36, 14 more at 18 a second
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
    const pacer = new RequestPacer(10, 10, () => now);
    const waits = Array.from({ length: 12 }, () => pacer.take());
    expect(waits.slice(0, 10).every((w) => w === 0)).toBe(true);
    expect(waits[10]).toBe(100);
    expect(waits[11]).toBe(200);
    now = 5000;
    expect(pacer.take()).toBe(0);
    expect(rateLimitWaits(4000)).toEqual([150, 300, 600, 1000, 1000]);
  });
});

describe("bridge 0.5.2: the wardrobe (outfits decide what each clothing area shows)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom,inventory"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("with an outfit that leaves the head empty, an equipped helmet is equipped but hidden, and the answer says so", async () => {
    await phase(api, "gameplay");
    const outfit = await api.run("wardrobe.equip", { set: 1 });
    expect(outfit.ok, JSON.stringify(outfit)).toBe(true);
    if (outfit.ok) expect(outfit.result).toMatchObject({ changed: true, shown: true, undo: { method: "wardrobe.equip", params: { restore: { set: 0 } } } });
    const helmet = await api.run("inventory.equip", { item: "Items.Helmet_01_basic_01", add_if_missing: true });
    expect(helmet.ok, JSON.stringify(helmet)).toBe(true);
    if (helmet.ok) expect(helmet.result).toMatchObject({ equipped: true, hidden_by_outfit: true, outfit: { set: 1, area: "Head", shows: "hidden" } });
    const state = await api.run("wardrobe.state", {});
    expect(state.ok && (state.result as { areas: { area: string; shows: string; equipped: string }[] }).areas.find((a) => a.area === "Head")).toMatchObject({ shows: "hidden", equipped: "Items.Helmet_01_basic_01" });
  });

  test("the helmet into the outfit (item), then show: equipped, then the undo restores the outfit exactly", async () => {
    const before = await api.run("wardrobe.state", {});
    expect(before.ok).toBe(true);
    const into = await api.run("wardrobe.equip", { item: "Items.Helmet_01_basic_01" });
    expect(into.ok, JSON.stringify(into)).toBe(true);
    if (!into.ok) return;
    const result = into.result as { shown: boolean; state: { areas: { area: string; shows: string; outfit_item: string }[] }; undo: { params: Record<string, unknown> } };
    expect(result.shown).toBe(true);
    expect(result.state.areas.find((a) => a.area === "Head")).toMatchObject({ shows: "outfit", outfit_item: "Items.Helmet_01_basic_01" });
    const undone = await api.run("wardrobe.equip", result.undo.params);
    expect(undone.ok, JSON.stringify(undone)).toBe(true);
    const after = await api.run("wardrobe.state", {});
    if (before.ok && after.ok) expect((after.result as { areas: unknown }).areas).toEqual((before.result as { areas: unknown }).areas);

    const shown = await api.run("wardrobe.equip", { area: "Head", show: "equipped" });
    expect(shown.ok && (shown.result as { state: { areas: { area: string; shows: string }[] } }).state.areas.find((a) => a.area === "Head")?.shows).toBe("equipped");
  });

  test("refusals: item with no outfit active, both set and clear, an unknown outfit, an item nobody has; nothing to clear is a no-op", async () => {
    const off = await api.run("wardrobe.equip", { clear: true });
    expect(off.ok, JSON.stringify(off)).toBe(true);
    const noop = await api.run("wardrobe.equip", { clear: true });
    expect(noop.ok && (noop.result as { changed: boolean; undo: unknown }).changed).toBe(false);
    const item = await api.run("wardrobe.equip", { item: "Items.Helmet_01_basic_01" });
    expect(!item.ok && item.error.code).toBe("no_active_outfit");
    const both = await api.run("wardrobe.equip", { set: 1, clear: true });
    expect(!both.ok && both.error.code).toBe("bad_params");
    const unknown = await api.run("wardrobe.equip", { set: 5 });
    expect(!unknown.ok && unknown.error.code).toBe("bad_params");
    await api.run("wardrobe.equip", { set: 2 });
    const nobody = await api.run("wardrobe.equip", { item: "Items.Glasses_99" });
    expect(!nobody.ok && nobody.error.code).toBe("not_in_inventory");
  });

  test("the kill switch puts the wardrobe back as it was before the bridge's first change", async () => {
    const killed = await api.run("bridge.kill", {});
    expect(killed.ok, JSON.stringify(killed)).toBe(true);
    for (let i = 0; i < 40 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await new Promise((r) => setTimeout(r, 50));
    const line = host.log.find((l) => l.includes("bridge.kill_restored")) ?? "";
    expect(line).toContain("wardrobe_restored");
    expect(line).toContain('"set":0');
  });

  test("the inventory write class gates both, and wardrobe.state is a read", async () => {
    const { findCommand } = await import("../api/catalogue.ts");
    expect(findCommand("wardrobe.equip")!.permission).toBe("write-inventory");
    expect(findCommand("wardrobe.state")!.permission).toBe("read");
    const locked = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world"], 20);
    const other = apiFor(locked);
    const refused = await other.run("wardrobe.equip", { set: 1 });
    expect(!refused.ok && refused.error.code).toBe("write_class_disabled");
    other.close();
    await locked.stop();
  });
});

describe("bridge 0.5.2: placing the photo-mode camera (research)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes"], 60);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("the camera goes distance_m from V's eyes at the azimuth, aimed at them; held says whether photo mode kept it", async () => {
    await phase(api, "photo_mode");
    const moved = await api.run("photo.camera.place", { target: "v", distance_m: 2, azimuth_deg: 0 });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    if (moved.ok) {
      const r = moved.result as { position: number[]; look_at: number[]; held: boolean; undo: unknown; note?: string };
      expect(Math.hypot(r.position[0]! - r.look_at[0]!, r.position[1]! - r.look_at[1]!, r.position[2]! - r.look_at[2]!)).toBeCloseTo(2, 3);
      expect(r.held).toBe(false); // the simulated photo mode places its camera itself unless camera_holds
      expect(r.note).toMatch(/didn't keep/);
    }
    await api.callBridge("selftest.phase", { phase: "photo_mode", camera_holds: true }, "t-phase");
    const held = await api.run("photo.camera.place", { look_at: [0, 3, 1.6], position: [0.5, 1, 1.7] });
    expect(held.ok && (held.result as { held: boolean }).held).toBe(true);
    if (held.ok) expect((held.result as { undo: { params: { position: number[] } } }).undo.params.position).toEqual([0, 0, 1.6]);
  });

  test("refusals: two targets, position with distance, the camera on its target, outside photo mode", async () => {
    const two = await api.run("photo.camera.place", { target: "v", piece: 0 });
    expect(!two.ok && two.error.code).toBe("bad_input");
    const both = await api.run("photo.camera.place", { target: "v", position: [0, 0, 0], distance_m: 1 });
    expect(!both.ok && both.error.code).toBe("bad_input");
    const same = await api.run("photo.camera.place", { look_at: [1, 1, 1], position: [1, 1, 1.01] });
    expect(!same.ok && same.error.code).toBe("bad_params");
    await phase(api, "gameplay");
    const out = await api.run("photo.camera.place", { look_at: [0, 3, 1.6], position: [0, 0, 1.6] });
    expect(!out.ok && out.error.code).toBe("not_in_photo_mode");
  });
});
