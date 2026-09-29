// Bridge 0.6.1: deep review 6's findings (RB-79..92) through the command API against the self-test host (the real bridge
// core and pipe with a simulated game, selftest/Sim060.cpp), plus the offline pieces of scene.report and capture.sheet.
// Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { tailLines } from "../api/catalogue060.ts";
import { boundsOf, calibrate, framing, poseOf } from "../scene/camera.ts";
import { aspectMismatch, buildReport, frameStats, judgeAfter, judgeBefore, lightsAt, subjectBox } from "../scene/report.ts";
import { maxCellWidth, renderSheet, shrinkCell } from "../capture/sheet.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const fixture = join(projectDir, "tools", "test", "fixtures", "showroom-manifest.json");
const ALL = "photo,world,character,save,showroom,inventory,player";
type Any = any;

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b11-cap-"), "captures"), auditDir: tempDir("xfb-b11-audit-"), idleCloseMs: 300 });

async function phase(api: CommandApi, value: string, extra: Record<string, unknown> = {}) {
  const response = await api.callBridge("selftest.phase", { phase: value, ...extra }, "t-phase");
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

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 6000): Promise<T> {
  const start = performance.now();
  let value = await read();
  while (!done(value) && performance.now() - start < ms) {
    await sleep(100);
    value = await read();
  }
  return value;
}

const player = (api: CommandApi, params: Record<string, unknown>) => api.callBridge("selftest.player", params, "t-player");
const stopOf = async (api: CommandApi, id: number) =>
  (await until(() => ok(api, "session.events", { kinds: ["behaviour"] }), (e: Any) => e.events.some((x: Any) => x.data?.id === id && x.data?.reason))).events.find(
    (x: Any) => x.data?.id === id && x.data?.reason,
  );

describe("0.6.1 offline: bounds behind the camera, honest checks, light direction, the window's shape (RB-88)", () => {
  // A level camera at the origin looking along +Y, vertical field of view 60, 16:9.
  const camera = { position: [0, 0, 1.6], forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], fov: 60, aspect: 16 / 9 };
  const model = calibrate(poseOf(camera)!, null);

  test("a box straddling the camera is clipped at the near plane: never reported wholly in frame", () => {
    // A body box centred 10 cm in front of the camera: half of it lies behind.
    const box = subjectBox([0, 0.1, 0], [0, 0.1, 1.62], [0, -1, 0], "body");
    const b = boundsOf(model, box)!;
    expect(b.behind).toBeGreaterThan(0);
    const f = framing(b, model.aspect);
    expect(f.fraction_in_frame).toBeLessThan(0.5);
    // Before 0.6.1 only the corners in front counted; a box wholly in front is unchanged by the clipping.
    const ahead = boundsOf(model, subjectBox([0, 3, 0], [0, 3, 1.62], [0, -1, 0], "face"))!;
    expect(ahead.behind).toBe(0);
    expect(framing(ahead, model.aspect).fraction_in_frame).toBe(1);
  });

  test("in_frame_margin fails for a subject reaching behind the camera; unoccluded without a ray is not_checked, never passed", () => {
    const raw = {
      phase: "gameplay",
      camera,
      v: { position: [0, 0.1, 0], head: [0, 0.1, 1.62], forward: [0, -1, 0] },
      showroom: { pieces: [{ index: 0, position: [0, 3, 0], yaw: 180, eyes: [0, 3, 1.6] }], rigs: [] },
    };
    const report = buildReport(raw, { bounds: "body" }, { showroom: null, photoMenu: null }) as Any;
    const v = report.subjects.find((s: Any) => s.id === "v");
    expect(v.behind_camera).toBeGreaterThan(0);
    expect(report.warnings.join(" ")).toContain("reaches behind the camera");
    const judged = judgeBefore(report, { subject: "v", in_frame_margin: 0, unoccluded: true });
    expect(judged.find((r) => r.check === "in_frame_margin")).toMatchObject({ ok: false, status: "failed" });
    // V in normal play has no occlusion ray (rays run only in photo mode): the check didn't run.
    expect(judged.find((r) => r.check === "unoccluded")).toMatchObject({ ok: null, status: "not_checked" });
    expect(judgeBefore(report, { subject: "piece:0", unoccluded: true })[0]).toMatchObject({ status: "not_checked" });
  });

  test("a photo-mode light pointing away doesn't reach the face; one aimed at it does; a known cone decides", () => {
    const face: [number, number, number] = [0, 2, 1.6];
    const raw = {
      lights: {
        photo: [
          { light: 1, found: true, position: [0, 1, 1.6], forward: [0, 1, 0] }, // aimed at the face
          { light: 2, found: true, position: [0, 1, 1.6], forward: [0, -1, 0] }, // pointing away
          { light: 3, found: true, position: [0, 1, 1.6], forward: [1, 0.6, 0] }, // about 59 degrees off its axis
        ],
      },
    };
    const each = lightsAt(face, raw, null, null);
    expect(each.map((l) => l.reaches_face)).toEqual([true, false, true]);
    expect(each[1]!.strength).toBe(0);
    // Light 3 selected with a 40-degree cone (±20): outside it.
    const narrow = lightsAt(face, raw, null, { selected: 3, outer_angle: 40, on: 1 });
    expect(narrow[2]!.reaches_face).toBe(false);
    // Light 1 selected with a range of 0.5 m: the face 1 m away is out of reach.
    expect(lightsAt(face, raw, null, { selected: 1, range: 0.5, on: 1 })[0]!.reaches_face).toBe(false);
  });

  test("lit_by with only lights of unknown reach is not_checked; frame checks on a picture of another shape are not_checked", () => {
    const report = { subjects: [{ kind: "v", id: "v", margins: null, in_frame: 1, occluded: null }], lights: { focus: "v", each: [{ kind: "photo", id: "photo:1", on: true, reaches_face: "unknown" }] } };
    expect(judgeBefore(report, { lit_by: "photo" })[0]).toMatchObject({ check: "lit_by", ok: null, status: "not_checked" });
    const width = 160, height = 120, rgb = new Uint8Array(width * height * 3).fill(128);
    // A 4:3 window for a 16:9 camera: the region can't be placed.
    const stats = frameStats({ width, height, rgb }, { left: -0.2, right: 0.2, top: -0.2, bottom: 0.2 }, 16 / 9)!;
    expect(stats.aspect_mismatch).toMatchObject({ window_aspect: 1.3333, render_aspect: 1.7778 });
    expect(judgeAfter(stats, { luminance: [0, 1], max_clipped: 0.5 }).map((r) => r.status)).toEqual(["not_checked", "not_checked"]);
    expect(aspectMismatch({ width: 1920, height: 1080 }, 16 / 9)).toBeNull();
    // Matching shapes still judge.
    expect(judgeAfter(frameStats({ width: 160, height: 90, rgb: new Uint8Array(160 * 90 * 3).fill(128) }, { left: -0.2, right: 0.2, top: -0.2, bottom: 0.2 }, 16 / 9), { luminance: [0.4, 0.6] })[0]).toMatchObject({ status: "passed" });
  });
});

describe("0.6.1 offline: capture.sheet shrinks each cell as it is decoded; session.log reads only the tail (RB-91)", () => {
  test("a 4K picture becomes a cell-sized one before the next is read, and the sheet looks the same", () => {
    const widest = maxCellWidth(48, { columns: 8, maxWidth: 2400 });
    expect(widest).toBe(Math.floor((2400 - 6 * 9) / 8));
    const big = { width: 3840, height: 2160, rgb: new Uint8Array(3840 * 2160 * 3).fill(77) };
    const small = shrinkCell(big, widest);
    expect(small.width).toBe(widest);
    expect(small.rgb.length).toBeLessThan(big.rgb.length / 40);
    const sheet = renderSheet([{ label: "a", pixels: small, source: "a" }], { columns: 1, maxWidth: 400 });
    expect(sheet.cells[0]!.width).toBeLessThanOrEqual(400);
    // A picture already small enough is kept as it is.
    expect(shrinkCell(small, widest)).toBe(small);
  });

  test("tailLines reads the last lines across chunk boundaries, skipping empty lines", () => {
    const dir = tempDir("xfb-b11-tail-");
    const file = join(dir, "commands-2026-09-29.jsonl");
    writeFileSync(file, "");
    for (let i = 0; i < 500; i++) appendFileSync(file, JSON.stringify({ i, pad: "x".repeat(i % 37) }) + (i % 50 === 0 ? "\n\n" : "\n"));
    const last = tailLines(file, 7, 256).map((l) => JSON.parse(l).i);
    expect(last).toEqual([493, 494, 495, 496, 497, 498, 499]);
    expect(tailLines(file, 1000, 128)).toHaveLength(500);
    expect(tailLines(file, 0)).toEqual([]);
  });
});

describe("0.6.1 player control: busy states, pre-emption, the glide's cap, ground checks, handover, saves (RB-79..83)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("refusals in a vehicle, a scene, a Johnny section and while busy (a fall, death) (RB-92)", async () => {
    await phase(api, "gameplay");
    for (const code of ["in_vehicle", "in_scene", "not_v", "player_busy"]) {
      await player(api, { busy: code });
      expect(await refused(api, "player.teleport", { turn: 10 })).toBe(code);
      expect(await refused(api, "player.action", { name: "crouch" })).toBe(code);
      await sleep(600); // two teleports a second
    }
    await player(api, { busy: "" });
  });

  test("a glide started while V is busy stops at once with the reason, and gives nothing held back wrong", async () => {
    await player(api, { busy: "player_busy" });
    const glide = await ok(api, "behave.glide.path", { offset: { forward: 2 } });
    const end = await stopOf(api, glide.id);
    expect(end.data.reason).toBe("player_busy");
    await player(api, { busy: "" });
    expect((await ok(api, "player.state")).bridge_effects).toHaveLength(0);
  });

  test("a glide is checked on every tick: a fall mid-way stops it and lifts the movement hold (RB-79)", async () => {
    const glide = await ok(api, "behave.glide.path", { offset: { forward: 20 }, speed_m_s: 1 });
    await until(() => ok(api, "player.state"), (s: Any) => s.bridge_effects.includes("GameplayRestriction.NoMovement"), 2000);
    await player(api, { busy: "player_busy" });
    const end = await stopOf(api, glide.id);
    expect(end.data).toMatchObject({ reason: "player_busy", undo: { method: "player.teleport" } });
    await player(api, { busy: "", position: [100, 200, 10] });
    expect((await ok(api, "player.state")).bridge_effects).toHaveLength(0);
  });

  test("the player's own input ends a glide (user_took_over), and max_s is capped at 30 s (RB-81)", async () => {
    const glide = await ok(api, "behave.glide.path", { offset: { forward: 20 }, speed_m_s: 1 });
    expect(glide.max_s).toBe(30);
    await until(() => ok(api, "player.state"), (s: Any) => s.bridge_effects.includes("GameplayRestriction.NoMovement"), 2000);
    await player(api, { input: "MoveY" });
    const end = await stopOf(api, glide.id);
    expect(end.data.reason).toBe("user_took_over");
    expect(end.data.travelled_m).toBeLessThan(20);
    expect((await ok(api, "player.state")).bridge_effects).toHaveLength(0);
    await player(api, { position: [100, 200, 10] });
    expect(await refused(api, "behave.glide.path", { offset: { forward: 2 }, max_s: 31 })).toBe("bad_params");
  });

  test("ground exact needs the world loaded too (RB-80); a turn in place doesn't move V", async () => {
    await sleep(600);
    expect(await refused(api, "player.teleport", { position: [-5, 200, 10], ground: "exact", far: true })).toBe("not_streamed");
    await sleep(600);
    const turned = await ok(api, "player.teleport", { turn: 15, ground: "exact" });
    expect(turned.target).toEqual([100, 200, 10]);
    await sleep(600);
    await ok(api, "player.teleport", turned.undo.params);
  });

  test("session.handover gives V back: a bridge crouch is lifted in the same step (RB-82)", async () => {
    await ok(api, "player.action", { name: "crouch" });
    expect((await ok(api, "player.state")).bridge_effects).toContain("GameplayRestriction.ForceCrouch");
    const handed = await ok(api, "session.handover", { note: "crouch released?" });
    const step = handed.steps.find((s: Any) => s.step.startsWith("give V back"));
    expect(step).toMatchObject({ ok: true });
    expect(step.removed).toContain("GameplayRestriction.ForceCrouch");
    const state = await ok(api, "player.state");
    expect(state.bridge_effects).toHaveLength(0);
    expect(state.psm.locomotion_name).toBe("Default");
    await ok(api, "session.resume");
  });

  test("game.save refuses while a glide holds V, even with override_lock; after player.stop it saves (RB-83)", async () => {
    const glide = await ok(api, "behave.glide.path", { offset: { forward: 20 }, speed_m_s: 0.5 });
    await until(() => ok(api, "player.state"), (s: Any) => s.bridge_effects.includes("GameplayRestriction.NoMovement"), 2000);
    const out = await api.run("game.save", { override_lock: true });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe("bridge_effects_active");
      expect(out.error.message).toContain("player_stop");
      expect(out.error.detail ?? "").toContain("NoMovement");
    }
    await ok(api, "player.stop");
    await stopOf(api, glide.id);
    await until(() => ok(api, "behave.list"), (l: Any) => l.behaviours.length === 0);
    await player(api, { position: [100, 200, 10] });
    const saved = await ok(api, "game.save", { override_lock: true, name: "after glide" });
    expect(saved.saved).toBe(true);
  });
});

describe("0.6.1 the wardrobe under Equipment-EX: a restore with a part V no longer has; pins go with their heads; presets back on kill", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("an Equipment-EX restore puts back every part it can and names the missing one (RB-84)", async () => {
    await phase(api, "gameplay", { script_outfit: true });
    const restore = {
      set: 0,
      slots: [],
      script_outfit: {
        active: true,
        parts: [
          { slot: "OutfitSlots.Torso", item: "Items.Jacket_01_basic_01", id: "1234" },
          { slot: "OutfitSlots.Feet", item: "Items.Boots_gone_01" },
        ],
      },
    };
    const out = await ok(api, "wardrobe.equip", { restore });
    expect(out.shown).toBe(true);
    expect(out.not_restored).toEqual(["OutfitSlots.Feet: Items.Boots_gone_01"]);
    expect(out.state.script_outfit.parts).toEqual([{ slot: "OutfitSlots.Torso", item: "Items.Jacket_01_basic_01" }]);
  });

  test("an undo switches a script outfit that is off back on (RB-84: it could only switch it off)", async () => {
    const off = await ok(api, "wardrobe.equip", { suspend: true });
    expect(off.state.manager).toBe("none");
    const on = await ok(api, "wardrobe.equip", { restore: { set: 0, slots: [], script_outfit: { active: true, parts: [{ slot: "OutfitSlots.Torso", item: "Items.Jacket_01_basic_01" }] } } });
    expect(on.shown).toBe(true);
    expect(on.state.script_outfit).toMatchObject({ active: true });
    await ok(api, "wardrobe.equip", { resume: true });
  });

  test("showroom.clear takes the pins above its heads with them (RB-87)", async () => {
    await phase(api, "photo_mode");
    await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"] });
    await sleep(300);
    await until(() => api.run("world.pin", { piece: 0, label: "Gloss A" }), (r: Any) => r.ok, 3000);
    await ok(api, "world.pin", { position: [100, 205, 10], label: "Elsewhere" });
    const cleared = await ok(api, "showroom.clear", { what: "pieces" });
    expect(cleared.removed_pins).toBe(1);
    const state = await api.callBridge("selftest.state", {}, "t");
    expect(state.ok && (state.result as Any).pins.map((p: Any) => p.label)).toEqual(["Elsewhere"]);
  });

  test("the kill switch writes photo.camera.preset's rewrites back (RB-90)", async () => {
    await ok(api, "photo.camera.preset", { preset: 9, values: { dist: -2.5, fov: 20 } });
    await ok(api, "photo.camera.preset", { preset: 9, values: { dist: -3 } });
    await ok(api, "bridge.kill");
    for (let i = 0; i < 60 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await sleep(50);
    const line = host.log.find((l) => l.includes("bridge.kill_restored")) ?? "";
    expect(line).toContain("presets_restored");
    expect(line).toContain('"9":2');
  });
});
