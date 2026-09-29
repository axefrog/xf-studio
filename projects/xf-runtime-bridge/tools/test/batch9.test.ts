// Bridge 0.5.3, TEMPORARY TEST FEATURES (the ink UI demos) through the command API against the self-test host (the real
// bridge core and pipe with a simulated game): ui.hud and the frame the redscript overlay draws (Demo A, and Demo B's
// switch), and world.pin / world.pin.clear (Demo C). The frame format and the parameter checks are also unit-tested in
// native/src/selftest/UnitTests.cpp (InkUiTests). Proves nothing about the game: what ink draws is session 7's to see.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { HOOK_TIMEOUT_MS, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b9-cap-"), "captures"), auditDir: tempDir("xfb-b9-audit-"), idleCloseMs: 300 });

type Frame = { show: boolean; anchor: string; x: number; y: number; scale: number; layer: string; nameplates: boolean; cet_label: boolean; live: boolean; tone: string; status: string; messages: { level: string; text: string }[] };

async function frame(api: CommandApi): Promise<Frame> {
  const response = await api.callBridge("selftest.hud", {}, "t-hud");
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response.ok ? response.result : {}) as Frame;
}

async function bridge(api: CommandApi, method: string, params: Record<string, unknown> = {}) {
  const response = await api.callBridge(method, params, "t-b9");
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response.ok ? response.result : {}) as Record<string, unknown>;
}

const HEAD = "axefrog\\appearance_studio\\collections\\4426018f6966620881cdcb78569544ab\\showroom\\xfs_showroom.ent";

describe("bridge 0.5.3 Demo A: the ink HUD panel (ui.hud)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom"], 90);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("the panel shows by default, top right, with the bridge's state; ui.message lines reach its frame", async () => {
    const start = await frame(api);
    expect(start).toMatchObject({ show: true, anchor: "top_right", layer: "hud", nameplates: true, cet_label: true, live: true, tone: "write" });
    expect(start.status).toMatch(/changes allowed/);
    const posted = await api.run("ui.message", { text: "Press the photo-mode key", level: "ask", seconds: 30 });
    expect(posted.ok, JSON.stringify(posted)).toBe(true);
    const after = await frame(api);
    expect(after.messages).toEqual([{ level: "ask", text: "Press the photo-mode key" }]);
    await api.run("ui.message", { clear: true });
  });

  test("ui.hud moves, scales and hides it, and its undo puts every setting back", async () => {
    const moved = await api.run("ui.hud", { anchor: "bottom_left", x: 40, y: 120, scale: 1.25, cet_label: false });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    if (!moved.ok) return;
    const result = moved.result as { changed: boolean; settings: Record<string, unknown>; undo: { method: string; params: Record<string, unknown> } };
    expect(result.changed).toBe(true);
    expect(await frame(api)).toMatchObject({ anchor: "bottom_left", x: 40, y: 120, scale: 1.25, cet_label: false });
    const hidden = await api.run("ui.hud", { show: false });
    expect(hidden.ok && (await frame(api)).show).toBe(false);
    // Undo the move first (its settings still include show: true), then everything is as it started.
    const undone = await api.run(result.undo.method, result.undo.params);
    expect(undone.ok, JSON.stringify(undone)).toBe(true);
    expect(await frame(api)).toMatchObject({ show: true, anchor: "top_right", x: 72, y: 300, scale: 1, cet_label: true });
  });

  test("ui.hud with nothing only reads; reset goes back to the configured panel; bad values are refused in plain words", async () => {
    const read = await api.run("ui.hud", {});
    expect(read.ok && (read.result as { changed: boolean; undo: unknown }).changed).toBe(false);
    await api.run("ui.hud", { layer: "top", nameplates: false });
    expect(await frame(api)).toMatchObject({ layer: "top", nameplates: false });
    const reset = await api.run("ui.hud", { reset: true });
    expect(reset.ok, JSON.stringify(reset)).toBe(true);
    expect(await frame(api)).toMatchObject({ layer: "hud", nameplates: true });
    const badAnchor = await api.run("ui.hud", { anchor: "middle" });
    expect(!badAnchor.ok && badAnchor.error.code).toBe("bad_input");
    const bad = await api.callBridge("ui.hud", { scale: 9 }, "t-bad");
    expect(!bad.ok && bad.error.code).toBe("bad_params");
  });

  test("while the script layer is detached (a save loading) the frame says live 0, so the overlay makes no world queries", async () => {
    await bridge(api, "selftest.script_layer", { event: "detach" });
    expect((await frame(api)).live).toBe(false);
    await bridge(api, "selftest.script_layer", { event: "attach" });
    await bridge(api, "selftest.script_layer", { event: "player_attach" });
    expect((await frame(api)).live).toBe(true);
  });

  test("ui.hud is a notify command: it works on a read-only bridge, where world.pin is refused", async () => {
    expect(findCommand("ui.hud")!.permission).toBe("notify");
    const readOnly = await startSelftestHost([], 20);
    const other = apiFor(readOnly);
    try {
      const moved = await other.run("ui.hud", { show: false });
      expect(moved.ok, JSON.stringify(moved)).toBe(true);
      const frameRead = await other.callBridge("selftest.hud", {}, "t-ro");
      expect(frameRead.ok && (frameRead.result as Frame).tone).toBe("ok");
      const pin = await other.run("world.pin", { at: "v", label: "XF" });
      expect(pin.ok).toBe(false);
    } finally {
      other.close();
      await readOnly.stop();
    }
  }, HOOK_TIMEOUT_MS);
});

describe("bridge 0.5.3 Demo C: XF map pins (world.pin, world.pin.clear)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom"], 90);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("a pin at a world point, above V and above a showroom head (following it), each with its undo", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    const atPoint = await api.run("world.pin", { position: [-1200.5, 300, 12], label: "  XF   test\npin " });
    expect(atPoint.ok, JSON.stringify(atPoint)).toBe(true);
    if (atPoint.ok) {
      expect(atPoint.result).toMatchObject({ id: 1, label: "XF test pin", variant: "custom", bound: "position", position: [-1200.5, 300, 12] });
      expect((atPoint.result as { undo: unknown }).undo).toEqual({ method: "world.pin.clear", params: { id: 1 } });
    }
    const aboveV = await api.run("world.pin", { at: "v", label: "V was here", variant: "apartment" });
    expect(aboveV.ok && (aboveV.result as { position: number[] }).position[2]).toBeCloseTo(12.25, 5);

    await bridge(api, "showroom.place", { items: [{ index: 0, template: HEAD, appearance: "xfs_p0170d3e01f014a519c3e000000000005", label: "Gloss A", x: 100, y: 203, z: 10, yaw: 180 }] });
    const onHead = await api.run("world.pin", { piece: 0, label: "Gloss A", variant: "clothes" });
    expect(onHead.ok, JSON.stringify(onHead)).toBe(true);
    if (onHead.ok) expect(onHead.result).toMatchObject({ target: "piece", bound: "object", variant: "clothes" });
    const missing = await api.run("world.pin", { piece: 5, label: "none" });
    expect(!missing.ok && missing.error.code).toBe("no_such_piece");

    const cleared = await api.run("world.pin.clear", { id: 2 });
    expect(cleared.ok && (cleared.result as { removed: number[] }).removed).toEqual([2]);
    const again = await api.run("world.pin.clear", { id: 2 });
    expect(!again.ok && again.error.code).toBe("no_such_pin");
    expect(((await bridge(api, "selftest.state")).pins as unknown[]).length).toBe(2);
  });

  test("refusals: no target or two, an unknown variant, outside the world, more than 8 pins", async () => {
    const none = await api.run("world.pin", { label: "x" });
    expect(!none.ok && none.error.code).toBe("bad_params");
    const two = await api.run("world.pin", { at: "v", piece: 0, label: "x" });
    expect(!two.ok && two.error.code).toBe("bad_params");
    const variant = await api.run("world.pin", { at: "v", label: "x", variant: "fast_travel" });
    expect(!variant.ok && variant.error.code).toBe("bad_input");
    await bridge(api, "selftest.phase", { phase: "main_menu" });
    const menu = await api.run("world.pin", { at: "v", label: "x" });
    expect(!menu.ok && menu.error.code).toBe("not_in_world");
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    const all = await api.run("world.pin.clear", {});
    expect(all.ok, JSON.stringify(all)).toBe(true);
    for (let i = 0; i < 8; i++) expect((await api.run("world.pin", { position: [i, 0, 0], label: `pin ${i}` })).ok).toBe(true);
    const ninth = await api.run("world.pin", { position: [9, 0, 0], label: "pin 9" });
    expect(!ninth.ok && ninth.error.code).toBe("too_many_pins");
  });

  test("loading a save removes every pin", async () => {
    expect(((await bridge(api, "selftest.state")).pins as unknown[]).length).toBe(8);
    const loaded = await api.run("game.load", { latest: true, discard_unsaved: true });
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    const waited = await api.run("game.wait", { phase: ["gameplay"], timeout_ms: 10000 });
    expect(waited.ok, JSON.stringify(waited)).toBe(true);
    for (let i = 0; i < 40 && ((await bridge(api, "selftest.state")).pins as unknown[]).length > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect((await bridge(api, "selftest.state")).pins).toEqual([]);
  });

  test("the kill switch removes every pin", async () => {
    expect((await api.run("world.pin", { at: "v", label: "before the kill" })).ok).toBe(true);
    const killed = await api.run("bridge.kill", {});
    expect(killed.ok, JSON.stringify(killed)).toBe(true);
    for (let i = 0; i < 40 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await new Promise((r) => setTimeout(r, 50));
    expect(host.log.find((l) => l.includes("bridge.kill_restored")) ?? "").toContain('"pins_cleared":1');
  });

  test("both pin commands are in the world write class; a bridge without it refuses them", async () => {
    expect(findCommand("world.pin")!.permission).toBe("write-world");
    expect(findCommand("world.pin.clear")!.permission).toBe("write-world");
    const locked = await startSelftestHost(["--allow-writes", "--write-classes", "photo"], 20);
    const other = apiFor(locked);
    try {
      const refused = await other.run("world.pin", { at: "v", label: "x" });
      expect(!refused.ok && refused.error.code).toBe("write_class_disabled");
    } finally {
      other.close();
      await locked.stop();
    }
  }, HOOK_TIMEOUT_MS);
});
