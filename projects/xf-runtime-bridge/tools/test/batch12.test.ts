// Bridge 0.7 (research/runtime/bridge-hook-inventory.md, session 7's findings): the new hooks through the command API
// against the self-test host (selftest/Sim070.cpp and Main.cpp), in-game driving (asks, answers, comments, session.wait),
// and the offline pieces: the theme table against the Studio's tokens, the projection check, sweep cells. Proves nothing
// about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { sweepCells } from "../api/catalogue060.ts";
import { calibrate, poseOf, projectionConsistency } from "../scene/camera.ts";
import { buildTheme, generated, LUA_OUT, MAPPING, NATIVE_OUT, oklchToSrgb, parseRootTokens, STUDIO_CSS } from "../overlay/theme.ts";
import { HOOK_TIMEOUT_MS, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const ALL = "photo,world,character,save,showroom,inventory,player";
type Any = any;

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b12-cap-"), "captures"), auditDir: tempDir("xfb-b12-audit-"), idleCloseMs: 300 });

async function phase(api: CommandApi, value: string) {
  const response = await api.callBridge("selftest.phase", { phase: value }, "t-phase");
  expect(response.ok, JSON.stringify(response)).toBe(true);
}

async function ok(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<Any> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} ${JSON.stringify(out)}`).toBe(true);
  return out.ok ? (out.result as Any) : null;
}

async function refused(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<string> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} should be refused: ${JSON.stringify(out)}`).toBe(false);
  return out.ok ? "" : out.error.code;
}

describe("0.7 offline: the theme, the projection check, sweeps", () => {
  test("the generated theme tables match the Studio's tokens (they never drift)", () => {
    const { native, lua } = generated();
    expect(readFileSync(NATIVE_OUT, "utf8").replace(/\r\n/g, "\n")).toBe(native);
    expect(readFileSync(LUA_OUT, "utf8").replace(/\r\n/g, "\n")).toBe(lua);
  });

  test("every mapped token exists in both themes, and dark is the Studio's dark", () => {
    const css = readFileSync(STUDIO_CSS, "utf8");
    const tokens = parseRootTokens(css);
    for (const m of MAPPING) expect(tokens.has(m.token), m.token).toBe(true);
    const theme = buildTheme(css);
    const window = theme.colors.find((c) => c.name === "WindowBg")!;
    expect(window.dark[0]).toBeLessThan(0.3);
    expect(window.light[0]).toBeGreaterThan(0.8);
    expect(theme.metrics.find((m) => m.name === "Rounding")!.value).toBe(2);
  });

  test("oklch converts to sRGB: white, black and the signal yellow", () => {
    expect(oklchToSrgb("oklch(1 0 0)").slice(0, 3).every((v) => Math.abs(v - 1) < 1e-3)).toBe(true);
    expect(oklchToSrgb("oklch(0 0 0)").slice(0, 3).every((v) => Math.abs(v) < 1e-3)).toBe(true);
    const [r, g, b] = oklchToSrgb("oklch(.89 .16 100)");
    expect(r > 0.9 && g > 0.8 && b < 0.4).toBe(true);
    expect(oklchToSrgb("oklch(.5 .1 212 / .1)")[3]).toBe(0.1);
  });

  test("the game's projection is used only when two points on the camera's axis land together (session 7's drone camera)", () => {
    const pose = poseOf({ position: [0, 0, 1.6], forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], fov: 40, aspect: 2.4 })!;
    const good = { center: { x: 0, y: 0, z: 1, w: 1 }, up: { x: 0, y: 0.27, z: 1, w: 1 }, right: { x: 0.11, y: 0, z: 1, w: 1 }, far: { x: 0, y: 0, z: 5, w: 1 } };
    expect(projectionConsistency(good as never, 2.4).consistent).toBe(true);
    expect(calibrate(pose, good as never).by).toBe("game");
    const drone = { ...good, far: { x: -0.6, y: 0.25, z: 5, w: 1 } };
    const check = projectionConsistency(drone as never, 2.4);
    expect(check.consistent).toBe(false);
    const model = calibrate(pose, drone as never);
    expect(model.game_projection).toBe("inconsistent");
    expect(model.by).toBe("fov");
  });

  test("a sweep's captured steps become cells labelled by angle", () => {
    const answer = { swept: [0], from_deg: -60, to_deg: 60, steps: 3, returned: true, frames: [
      { step: 1, angle_deg: -60, capture: { full: "a.full.png", view: "a.png" } },
      { step: 2, angle_deg: 0 },
      { step: 3, angle_deg: 60, capture: { view: "c.png" } },
    ] };
    expect(sweepCells(answer)).toEqual([{ label: "-60 deg", path: "a.full.png" }, { label: "60 deg", path: "c.png" }]);
    expect(sweepCells(answer.frames as never)).toHaveLength(2);
  });
});

describe("0.7 against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  }, HOOK_TIMEOUT_MS);

  test("cyberware: read, equip Mantis Blades (added), its undo empties the slot and removes it", async () => {
    await phase(api, "gameplay");
    const before = await ok(api, "cyberware.state", { areas: ["ArmsCW"] });
    expect(before.arms.holster_state).toBe("holstered_default");
    expect(await refused(api, "cyberware.equip", { item: "Items.StrongArms" })).toBe("not_in_inventory");
    const equipped = await ok(api, "cyberware.equip", { item: "Items.StrongArms", add_if_missing: true });
    expect(equipped.equipped).toBe(true);
    expect(equipped.undo).toMatchObject({ method: "cyberware.unequip", params: { area: "ArmsCW", remove_added: true, item: "Items.StrongArms" } });
    const now = await ok(api, "cyberware.state", { areas: ["ArmsCW"] });
    expect(now.arms).toMatchObject({ item: "Items.StrongArms", holster_state: "holstered_strong", creator_group: "holstered_strong_tpp" });
    const undone = await ok(api, equipped.undo.method, equipped.undo.params);
    expect(undone.removed).toBe(true);
    expect((await ok(api, "cyberware.state", { areas: ["ArmsCW"] })).arms.holster_state).toBe("holstered_default");
  });

  test("cyberware: a swap's undo puts the earlier item back; refused outside normal play", async () => {
    await phase(api, "gameplay");
    await ok(api, "cyberware.equip", { item: "Items.MantisBlades" });
    const swap = await ok(api, "cyberware.equip", { item: "Items.NanoWires", add_if_missing: true });
    expect(swap.undo).toMatchObject({ method: "cyberware.equip", params: { item: "Items.MantisBlades" } });
    await ok(api, swap.undo.method, swap.undo.params);
    expect((await ok(api, "cyberware.state", {})).arms.item).toBe("Items.MantisBlades");
    await phase(api, "photo_mode");
    expect(await refused(api, "cyberware.equip", { item: "Items.StrongArms", add_if_missing: true })).toBe("not_in_gameplay");
    await phase(api, "gameplay");
    expect(await refused(api, "cyberware.equip", { item: "Items.Helmet_01_basic_01" })).toBe("bad_params");
  });

  test("the arms drawn: player.action weapon.arms, undone by weapon.holster", async () => {
    await phase(api, "gameplay");
    const drawn = await ok(api, "player.action", { name: "weapon.arms" });
    expect(drawn.undo).toMatchObject({ method: "player.action", params: { name: "weapon.holster" } });
  });

  test("world.state, world.probe (points and a ring) and the weather with its undo and the kill-switch restore path", async () => {
    await phase(api, "gameplay");
    const world = await ok(api, "world.state", { facts: ["tutorial_ripperdoc_eyes_passed"] });
    expect(world.facts.tutorial_ripperdoc_eyes_passed).toBe(1);
    expect(world.weather.states).toContain("24h_weather_rain");
    const probe = await ok(api, "world.probe", { points: [[100, 202, 10.5], [100, 400, 10]] });
    expect(probe.probes[0]).toMatchObject({ navmesh_streamed: true });
    expect(probe.probes[1].navmesh_streamed).toBe(false);
    // 0.7 (session 7 finding 12): free space and a sight line at a point beside the simulated wall.
    const wall = await ok(api, "world.probe", { points: [[101.5, 198.8, 11]], clearance_m: 0.5, sight_from: [101.5, 202, 11] });
    expect(wall.probes[0].clearance.blocked).toBeGreaterThan(0);
    expect(wall.probes[0].sight.blocked).toBe(true);
    const open = await ok(api, "world.probe", { points: [[95, 205, 11]], clearance_m: 0.5 });
    expect(open.probes[0].clearance.blocked).toBe(0);
    const ring = await ok(api, "world.probe", { around_v: true, count: 4, ring_m: 2 });
    expect(ring.probes).toHaveLength(5);
    expect(await refused(api, "world.weather.set", { name: "24h_weather_blizzard" })).toBe("bad_params");
    const rain = await ok(api, "world.weather.set", { name: "24h_weather_rain", blend_s: 0 });
    expect(rain.undo).toMatchObject({ method: "world.weather.set", params: { name: "24h_weather_sunny", cycle: true } });
    expect((await ok(api, "world.state", {})).weather).toMatchObject({ name: "24h_weather_rain", set_by_bridge: true });
    await ok(api, rain.undo.method, rain.undo.params);
    expect((await ok(api, "world.state", {})).weather).toMatchObject({ name: "24h_weather_sunny", set_by_bridge: false });
  });

  test("ui.state, game.saves, overlay.state and hiding the overlay for a capture", async () => {
    const ui = await ok(api, "ui.state", {});
    expect(ui).toHaveProperty("cet_overlay");
    expect(ui.overlay_host.phase).toBe("drawing");
    const saves = await ok(api, "game.saves", { limit: 2 });
    expect(saves.saves.map((s: Any) => s.name)).toEqual(["AutoSave-12", "ManualSave-3"]);
    const overlay = await ok(api, "overlay.state", {});
    expect(overlay).toMatchObject({ enabled: true, phase: "drawing", theme: "dark", drawing_now: true });
    const hidden = await api.callBridge("overlay.hide", { hidden: true, ms: 2000 }, "t-hide");
    expect(hidden.ok && (hidden.result as Any).hidden_for_capture).toBe(true);
    expect((await ok(api, "overlay.state", {})).drawing_now).toBe(false);
    await api.callBridge("overlay.hide", { hidden: false }, "t-show");
    expect((await ok(api, "overlay.state", {})).drawing_now).toBe(true);
  });

  test("0.8.22 overlay.set: theme, motion, diagnostics and drawing live, in memory, with an undo; overlay.state shows the values in force", async () => {
    const set = await ok(api, "overlay.set", { theme: "light", motion: "full", diagnostics: true, enabled: false });
    expect(set).toMatchObject({ theme: "light", diagnostics: true, enabled: false, enabled_at_load: true, in_memory: true,
      previous: { theme: "dark", enabled: true }, undo: { method: "overlay.set" } });
    expect(set.motion.setting).toBe("full");
    expect(await ok(api, "overlay.state", {})).toMatchObject({ theme: "light", diagnostics: true, enabled: false, switched_off: true, drawing_now: false });
    expect((await api.callBridge("overlay.set", { theme: "blue" }, "t-bad")).ok).toBe(false);
    await ok(api, set.undo.method, set.undo.params);
    expect(await ok(api, "overlay.state", {})).toMatchObject({ theme: "dark", enabled: true, switched_off: false, drawing_now: true });
  });

  test("0.8.22 the test figure for the diagnostics bars, and cet.panel queued for the CET layer with its undo", async () => {
    const figure = await ok(api, "overlay.set", { diagnostics_cpu_ms: 0.8 });
    expect(figure.undo.params).toEqual({ diagnostics_cpu_ms: null });
    expect(await ok(api, "overlay.state", {})).toMatchObject({ cpu_ms: 0.8, cpu_ms_override: 0.8 });
    await ok(api, figure.undo.method, figure.undo.params);
    expect((await ok(api, "overlay.state", {})).cpu_ms_override).toBe(null);
    const panel = await ok(api, "cet.panel", { diagnostics_open: true, press: "pause_changes" });
    expect(panel).toMatchObject({ queued: true, cet_overlay_open: null, undo: { method: "cet.panel", params: { diagnostics_open: false, press: "resume_changes" } } });
    expect(panel.applies.join(" ")).toContain("next time");
    expect((await api.callBridge("cet.panel", { press: "pause" }, "t-bad-press")).ok).toBe(false);
  });

  test("photo.scene.set: NPCs off by label, the game speed, the undo; refused outside photo mode", async () => {
    await phase(api, "gameplay");
    expect(await refused(api, "photo.scene.set", { game_speed: 0.5 })).toBe("not_in_photo_mode");
    await phase(api, "photo_mode");
    const set = await ok(api, "photo.scene.set", { npcs: { label: "Off" }, game_speed: 0.25 });
    expect(set.undo).toMatchObject({ method: "photo.scene.set", params: { npcs: { value: 1 }, game_speed: 1 } });
    await ok(api, set.undo.method, set.undo.params);
    await phase(api, "gameplay");
  });

  test("in-game driving: an ask with answers, the player's answer, session.wait returns it with its message id", async () => {
    // 0.8 (session 8): an ask without choices shows one Done button; this one passes the answers it wants.
    const plain = await ok(api, "ui.message", { text: "Tell me when you're ready.", level: "ask", seconds: 5 });
    expect(plain.choices).toEqual(["Done"]);
    await ok(api, "ui.message", { withdraw: plain.id });
    const posted = await ok(api, "ui.message", { text: "Is V standing in the street?", level: "ask", seconds: 120, choices: ["Ready", "Yes", "No"] });
    expect(posted.choices).toEqual(["Ready", "Yes", "No"]);
    const hud = await api.callBridge("selftest.hud", {}, "t-hud");
    const frame = (hud.ok ? hud.result : {}) as Any;
    expect(frame.ask.id).toBe(posted.id);
    expect(frame.ask.choices.map((c: Any) => c.key)).toEqual(["IK_F6", "IK_F7", "IK_F8"]);
    const waiting = api.run("session.wait", { message_id: posted.id, timeout_s: 20, poll_ms: 200 });
    await sleep(600);
    const answered = await api.callBridge("selftest.answer", { id: posted.id, choice: 1, via: "ink_key" }, "t-answer");
    expect(answered.ok && (answered.result as Any).label).toBe("Yes");
    const out = await waiting;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const result = (out.ok ? out.result : {}) as Any;
    expect(result.answer).toMatchObject({ label: "Yes", choice: 1, message_id: posted.id, via: "ink_key" });
  });

  test("in-game driving: a comment ends a wait; a wait with nothing times out", async () => {
    const waiting = api.run("session.wait", { timeout_s: 20, poll_ms: 200 });
    await sleep(500);
    await api.callBridge("selftest.answer", { comment: "The helmet clips the left ear" }, "t-comment");
    const out = await waiting;
    expect(out.ok && (out.result as Any).comments).toEqual(["The helmet clips the left ear"]);
    const idle = await ok(api, "session.wait", { timeout_s: 1, poll_ms: 200 });
    expect(idle.timed_out).toBe(true);
  });

  test("custom choices, pinning, and 600 characters", async () => {
    await ok(api, "ui.message", { clear: true });
    const ask = await ok(api, "ui.message", { text: "Which light reads best?", level: "ask", choices: ["Key", "Fill", "Rim"], seconds: 60 });
    for (let i = 0; i < 5; i++) await ok(api, "ui.message", { text: `note ${i}` });
    const read = await api.callBridge("selftest.messages", {}, "t-lines");
    const lines = ((read.ok ? read.result : {}) as Any).messages;
    expect(lines.some((l: Any) => l.id === ask.id)).toBe(true);
    const long = await ok(api, "ui.message", { text: "x".repeat(700) });
    expect(long.text.length).toBe(600);
    expect(await refused(api, "ui.message", { text: "info with choices", choices: ["A"] })).toBe("bad_params");
  });

  test("RB-94: something put on V between prepare and the save refuses the save in its own step", async () => {
    await phase(api, "gameplay");
    expect(await refused(api, "game.save", { name: "hold arrives", override_lock: true })).toBe("bridge_effects_active");
  });

  test("showroom.light rig none takes no manifest (session 7)", async () => {
    await phase(api, "gameplay");
    const out = await api.run("showroom.light", { rig: "none" });
    expect(!out.ok && out.error.code === "bad_input").toBe(false);
  });
});
