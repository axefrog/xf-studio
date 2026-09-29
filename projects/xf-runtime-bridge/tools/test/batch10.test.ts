// Bridge 0.6 (session 6's findings and the standing directives) through the command API against the self-test host (the
// real bridge core and pipe with a simulated game, selftest/Sim060.cpp) and a synthetic window for captures. Proves nothing
// about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { calibrate, modelFromFov, onRay, poseOf, project } from "../scene/camera.ts";
import { buildReport, frameStats, judgeAfter, judgeBefore, subjectBox } from "../scene/report.ts";
import { drawLabel, renderSheet } from "../capture/sheet.ts";
import { decodePng } from "../capture/image.ts";
import { HOOK_TIMEOUT_MS, openSyntheticWindow, projectDir, sleep, startSelftestHost, tempDir, type Host, type Synthetic } from "./helpers.ts";

const fixture = join(projectDir, "tools", "test", "fixtures", "showroom-manifest.json");
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
const ALL = "photo,world,character,save,showroom,inventory,player";
type Any = any;

const apiFor = (host: Host, extra: Record<string, unknown> = {}) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b10-cap-"), "captures"), auditDir: tempDir("xfb-b10-audit-"), idleCloseMs: 300, ...extra });

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

describe("0.6 offline pieces: the camera model, the report, the sheet", () => {
  // The simulated photo-mode camera: 10 degrees down, a vertical field of view of 30, 16:9 (Sim060.cpp).
  const p = -10 * (Math.PI / 180);
  const camera = { position: [100, 198, 11.7], forward: [0, Math.cos(p), Math.sin(p)], right: [1, 0, 0], up: [0, -Math.sin(p), Math.cos(p)], fov: 30, aspect: 16 / 9 };
  const ndc = (point: number[]) => {
    const d = point.map((v, i) => v - camera.position[i]!);
    const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    const depth = dot(d, camera.forward), t = Math.tan((camera.fov * Math.PI) / 360);
    return { x: dot(d, camera.right) / depth / (t * camera.aspect), y: dot(d, camera.up) / depth / t, z: depth, w: 1 };
  };
  const c1 = camera.position.map((v, i) => v + camera.forward[i]!);
  const calibration = { center: ndc(c1), up: ndc(c1.map((v, i) => v + camera.up[i]! * 0.1)), right: ndc(c1.map((v, i) => v + camera.right[i]! * 0.1)) };

  test("the game's calibration points give the projection's scale and say the field of view is vertical", () => {
    const model = calibrate(poseOf(camera)!, calibration);
    expect(model.by).toBe("game");
    expect(model.fov_axis).toBe("vertical");
    expect(near(model.scale, modelFromFov(poseOf(camera)!).scale, 1e-6)).toBe(true);
    // A point on the view ray lands at the centre; one 30 cm above it at 2 m, above the centre (y up is negative).
    const onAxis = onRay(model, 2);
    expect(project(model, onAxis)).toMatchObject({ x: 0, y: 0, in_frame: true });
    const above = project(model, [onAxis[0], onAxis[1], onAxis[2] + 0.3]);
    expect(above.y).toBeLessThan(-0.05);
    expect(project(model, [100, 190, 11])).toMatchObject({ behind: true, in_frame: false });
  });

  test("the report: bounds, fraction in frame, margins, occlusion warnings; light shares per kind", () => {
    const raw = {
      phase: "photo_mode",
      camera,
      calibration,
      v: { position: [100, 200.5, 10], head: [100, 200.5, 11.62], forward: [0, -1, 0], face: [100, 200.42, 11.665], occlusion: { checked: true, blocked: false } },
      npcs: [{ id: "a", name: "A", position: [104.5, 202, 10], head: [104.5, 202, 11.62], forward: [0, -1, 0], occlusion: { checked: true, blocked: true, hit_distance: 1.5, target_distance: 5 } }],
      showroom: { pieces: [{ index: 0, label: "Gloss A", position: [100, 200.41, 9.57], yaw: 180, eyes: onRay(calibrate(poseOf(camera)!, calibration), 2.5), occlusion: { checked: true, blocked: false } }], rigs: [] },
      lights: { photo: [{ light: 1, found: true, position: [100, 199.5, 12.2], forward: [0, 1, -0.3], to_face: { checked: true, blocked: false } }, { light: 2, found: false, why: "off" }] },
    };
    const report = buildReport(raw, {}, { showroom: null, photoMenu: null }) as Any;
    const piece = report.subjects.find((s: Any) => s.id === "piece:0");
    expect(near(piece.centre.x, 0, 0.01) && near(piece.centre.y, 0.02, 0.05)).toBe(true);
    expect(piece.in_frame).toBe(1);
    expect(Math.min(piece.margins.left, piece.margins.right, piece.margins.top, piece.margins.bottom)).toBeGreaterThan(0.2);
    const npc = report.subjects.find((s: Any) => s.id === "a");
    expect(npc.occluded).toBe(true);
    expect(report.warnings.join(" ")).toContain("a is blocked");
    expect(report.lights.focus).toBe("piece:0");
    const photo = report.lights.each.filter((l: Any) => l.kind === "photo");
    expect(photo.map((l: Any) => l.on)).toEqual([true, false]);
    expect(photo[0].share).toBe(1);
    expect(judgeBefore(report, { subject: "piece:0", in_frame_margin: 0.05, unoccluded: true, lit_by: "photo" }).every((r) => r.ok === true)).toBe(true);
    const failed = judgeBefore(report, { subject: "a", in_frame_margin: 0.45, unoccluded: true, lit_by: "rig" });
    expect(failed.filter((r) => !r.ok).map((r) => r.check)).toEqual(["in_frame_margin", "unoccluded", "lit_by"]);
  });

  test("frame statistics: luminance, clipped and crushed shares of a region", () => {
    const width = 160, height = 90, rgb = new Uint8Array(width * height * 3).fill(128);
    for (let y = 0; y < 45; y++) for (let x = 0; x < width; x++) rgb.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
    const stats = frameStats({ width, height, rgb }, { left: -0.5, right: 0.5, top: -0.5, bottom: 0.5 })!;
    expect(stats.clipped_highlights).toBeGreaterThan(0.45);
    expect(stats.crushed_shadows).toBe(0);
    expect(judgeAfter(stats, { luminance: [0.9, 1] })[0]!.ok).toBe(false);
    expect(judgeAfter(stats, { max_clipped: 0.6 })[0]!.ok).toBe(true);
    expect(subjectBox([0, 0, 0], [0, 0, 1.62], [0, 1, 0], "body")).toHaveLength(8);
  });

  test("the sheet's labels are drawn, cut to their cell, under each picture", () => {
    const cell = { width: 64, height: 36, rgb: new Uint8Array(64 * 36 * 3).fill(90) };
    const sheet = renderSheet([{ label: "Gloss A", pixels: cell, source: "a" }, { label: "A LABEL MUCH LONGER THAN ITS CELL", pixels: cell, source: "b" }], { columns: 2, maxWidth: 200, title: "T" });
    expect(sheet.cells).toHaveLength(2);
    expect(sheet.pixels.width).toBe(sheet.layout.width);
    const scratch = { width: 20, height: 20, rgb: new Uint8Array(20 * 20 * 3) };
    drawLabel(scratch, "I", 0, 0, 1);
    expect(Array.from(scratch.rgb).some((v) => v > 200)).toBe(true);
  });
});

describe("0.6 the wardrobe under Equipment-EX and the vanilla wardrobe", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 120);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("wardrobe.state says who decides: Equipment-EX's outfit reads active with set 0 (session 6), with its parts", async () => {
    await phase(api, "gameplay", { script_outfit: true });
    const state = await ok(api, "wardrobe.state");
    expect(state).toMatchObject({ set: 0, active: true, manager: "script", managed_by: "EquipmentEx", script_outfit: { present: true, active: true } });
    expect(state.script_outfit.parts).toEqual([{ slot: "OutfitSlots.Torso", item: "Items.Jacket_01_basic_01" }]);
    expect(state.areas.every((a: Any) => a.hidden)).toBe(true);
  });

  test("an equipped helmet is hidden by it, and the answer names the route that works", async () => {
    const helmet = await ok(api, "inventory.equip", { item: "Items.Helmet_01_basic_01", add_if_missing: true });
    expect(helmet).toMatchObject({ hidden_by_outfit: true, outfit: { manager: "script", managed_by: "EquipmentEx" } });
    expect(helmet.outfit_note).toContain("suspend: true");
    expect(await refused(api, "wardrobe.equip", { area: "Head", show: "equipped" })).toBe("outfit_managed_elsewhere");
    expect(await refused(api, "wardrobe.equip", { set: 1 })).toBe("outfit_managed_elsewhere");
  });

  test("item goes into Equipment-EX's outfit; the undo puts its parts back exactly", async () => {
    const into = await ok(api, "wardrobe.equip", { item: "Items.Helmet_01_basic_01" });
    expect(into.shown).toBe(true);
    expect(into.state.script_outfit.parts.map((p: Any) => p.item)).toContain("Items.Helmet_01_basic_01");
    expect(into.undo.params.restore.script_outfit).toEqual({ active: true, parts: [{ slot: "OutfitSlots.Torso", item: "Items.Jacket_01_basic_01" }] });
    const undone = await ok(api, "wardrobe.equip", into.undo.params);
    expect(undone.shown).toBe(true);
    expect(undone.state.script_outfit.parts).toEqual([{ slot: "OutfitSlots.Torso", item: "Items.Jacket_01_basic_01" }]);
  });

  test("suspend takes the outfit off with the story's own request (equipped gear shows); resume puts it back", async () => {
    const off = await ok(api, "wardrobe.equip", { suspend: true });
    expect(off).toMatchObject({ shown: true, manager_before: "script", undo: { method: "wardrobe.equip", params: { resume: true } } });
    expect(off.state.manager).toBe("none");
    expect(off.state.areas.find((a: Any) => a.area === "Head").shows).toBe("equipped");
    const on = await ok(api, "wardrobe.equip", off.undo.params);
    expect(on.state).toMatchObject({ manager: "script", suspended_by_bridge: false });
    const again = await ok(api, "wardrobe.equip", { resume: true });
    expect(again.changed).toBe(false);
  });

  test("the vanilla wardrobe with no outfit: an area's hidden state is put back exactly (session 6's T9)", async () => {
    await phase(api, "gameplay", { script_outfit: false });
    await ok(api, "wardrobe.equip", { area: "Head", show: "hidden" });
    const before = await ok(api, "wardrobe.state");
    expect(before.areas.find((a: Any) => a.area === "Head").hidden).toBe(true);
    const shown = await ok(api, "wardrobe.equip", { area: "Head", show: "equipped" });
    expect(shown.state.areas.find((a: Any) => a.area === "Head").hidden).toBe(false);
    const undone = await ok(api, "wardrobe.equip", shown.undo.params);
    expect(undone.shown).toBe(true);
    expect(undone.state.areas.find((a: Any) => a.area === "Head")).toMatchObject({ hidden: true, shows: "hidden" });
  });

  test("the kill switch resumes an outfit the bridge suspended", async () => {
    await phase(api, "gameplay", { script_outfit: true });
    await ok(api, "wardrobe.equip", { suspend: true });
    await ok(api, "bridge.kill");
    for (let i = 0; i < 40 && !host.log.some((l) => l.includes("bridge.kill_restored")); i++) await sleep(50);
    expect(host.log.find((l) => l.includes("bridge.kill_restored")) ?? "").toContain("wardrobe_resumed");
  });
});

describe("0.6 the showroom on the camera ray, the scene report and pre-capture checks", () => {
  let host: Host;
  let api: CommandApi;
  let synthetic: Synthetic;
  beforeAll(async () => {
    synthetic = await openSyntheticWindow(1920, 1080);
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 120);
    api = apiFor(host, { captureTarget: { hwnd: synthetic.hwnd } });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
    synthetic?.close();
  });

  test("with the camera as anchor the middle head's eyes sit on the view ray, and the game's projection puts them at the centre", async () => {
    await phase(api, "photo_mode");
    const out = await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], distance_m: 2.5 });
    expect(out.height_from).toBe("camera_ray");
    const eyes = out.pieces[0].eyes;
    // The camera at (100, 198, 11.7) looks 10 degrees down: 2.5 m along it the eyes are 0.434 m below the camera's height.
    expect(near(eyes[1], 198 + 2.5 * Math.cos((10 * Math.PI) / 180), 1e-3) && near(eyes[2], 11.7 - 2.5 * Math.sin((10 * Math.PI) / 180), 1e-3)).toBe(true);
    expect(out.pieces[0].eyes_on_screen).toMatchObject({ by: "game", in_frame: true });
    expect(Math.abs(out.pieces[0].eyes_on_screen.x) < 1e-3 && Math.abs(out.pieces[0].eyes_on_screen.y) < 1e-3).toBe(true);
    const three = await ok(api, "showroom.spawn", { manifest: fixture, distance_m: 2.5, spacing_m: 0.5 });
    // The others keep the distance and the elevation angle: in frame, on a gentle curve through the centre (the camera is pitched).
    expect(three.pieces.every((p: Any) => p.eyes_on_screen.in_frame && Math.abs(p.eyes_on_screen.y) < 0.05)).toBe(true);
    expect(Math.abs(three.pieces[1].eyes_on_screen.x) < 1e-3).toBe(true);
    const given = await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], height_m: 1.9 });
    expect(given.height_from).toBe("given");
  });

  test("scene.report: the camera, V, NPCs (one behind a wall), the heads, lights at the focus head, world and UI", async () => {
    await ok(api, "showroom.spawn", { manifest: fixture, distance_m: 2.5, spacing_m: 0.5 });
    await ok(api, "showroom.light", { manifest: fixture, rig: "key" });
    const report = await ok(api, "scene.report", { manifest: fixture, focus: "piece:1" });
    expect(report.camera).toMatchObject({ mode: "photo", fov: 30, projection: { by: "game", fov_axis: "vertical" } });
    expect(near(report.camera.pitch_deg, -10, 0.01)).toBe(true);
    const ids = report.subjects.map((s: Any) => s.id);
    expect(ids).toContain("v");
    expect(ids).toContain("piece:1");
    const blocked = report.subjects.find((s: Any) => s.label === "Sim NPC B");
    expect(blocked.occluded).toBe(true);
    const rig = report.lights.each.filter((l: Any) => l.kind === "rig");
    expect(rig.length).toBeGreaterThan(0);
    expect(near(rig.reduce((s: number, l: Any) => s + l.share, 0), 1, 1e-3)).toBe(true);
    expect(report.world.time.hours).toBe(12);
    expect(report.ui.photo_mode).toBe(true);
    const framed = await ok(api, "scene.report", { include: ["subjects", "frame"], focus: "piece:1" });
    expect(framed.frame).toMatchObject({ subject: "piece:1" });
    expect(framed.frame.mean_luminance).toBeGreaterThan(0);
  });

  test("capture.screenshot's expectations: passing checks capture (the XF overlay cleared), failing ones refuse or warn", async () => {
    const good = await ok(api, "capture.screenshot", { expect: { subject: "piece:1", in_frame_margin: 0.05, unoccluded: true, lit_by: "rig" }, manifest: fixture, name: "good" });
    expect(good.expectations.ok).toBe(true);
    expect(good.overlay).toMatchObject({ cleared: true, panel_hidden: true });
    const hud = await ok(api, "ui.hud");
    expect(hud.show ?? hud.settings?.show).not.toBe(false);
    const dir = api.captureRoot;
    const count = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".full.png")).length : 0);
    const before = count();
    expect(await refused(api, "capture.screenshot", { expect: { subject: "piece:1", in_frame_margin: 0.49 }, name: "refused" })).toBe("expectation_failed");
    expect(count()).toBe(before);
    const warned = await ok(api, "capture.screenshot", { expect: { subject: "piece:1", in_frame_margin: 0.49 }, on_fail: "warn", name: "warned" });
    expect(warned.warnings.length).toBe(1);
    expect(count()).toBe(before + 1);
    // The synthetic window's centre is a dark blue square: bright expectations fail after the capture, dim ones pass.
    expect(await refused(api, "capture.screenshot", { expect: { subject: "piece:1", luminance: [0.5, 1] }, name: "bright" })).toBe("expectation_failed");
    // (the blue square's blue channel is at 255, which counts as clipped)
    const dim = await ok(api, "capture.screenshot", { expect: { subject: "piece:1", luminance: [0, 0.3], max_crushed: 0.01 }, name: "dim" });
    expect(dim.expectations.frame.mean_luminance).toBeLessThan(0.3);
  });

  test("capture.sheet: earlier captures and one taken now in a labelled grid with a manifest", async () => {
    const shots = readdirSync(api.captureRoot).filter((f) => f.endsWith(".full.png")).slice(0, 2);
    const sheet = await ok(api, "capture.sheet", { cells: [{ label: "first", path: shots[0] }, { label: "second", path: shots[1] }, { label: "now" }], title: "0.6 sheet", columns: 3, max_width: 1200, name: "t" });
    expect(sheet.cells).toHaveLength(3);
    expect(existsSync(sheet.sheet.png) && existsSync(sheet.sheet.manifest)).toBe(true);
    const png = decodePng(new Uint8Array(readFileSync(sheet.sheet.png)));
    expect(png.width).toBeLessThanOrEqual(1200);
    expect(JSON.parse(readFileSync(sheet.sheet.manifest, "utf8")).cells.map((c: Any) => c.label)).toEqual(["first", "second", "now"]);
    expect(await refused(api, "capture.sheet", { cells: [{ label: "outside", path: "C:/Windows/win.ini" }] })).toBe("bad_input");
  });

  test("showroom.light rig none removes the rigs and keeps the heads", async () => {
    const none = await ok(api, "showroom.light", { manifest: fixture, rig: "none" });
    expect(none.rig).toBe("none");
    const state = await ok(api, "showroom.state");
    expect(state.lights).toHaveLength(0);
    expect(state.pieces.length).toBeGreaterThan(0);
  });
});

describe("0.6 the session event stream, notes and handovers", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 90);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("writes (with their undo), refusals and notes are in the stream; session.log merges the tools' own record", async () => {
    await phase(api, "photo_mode");
    await ok(api, "photo.camera.set", { fov: 30 });
    await ok(api, "session.note", { text: "a marker between steps", level: "done" });
    const events = await ok(api, "session.events", { since: 0 });
    const write = events.events.find((e: Any) => e.kind === "write" && e.data.method === "photo.camera.set");
    expect(write.data.undo.method).toBe("photo.camera.set");
    expect(events.events.some((e: Any) => e.kind === "note" && e.text === "a marker between steps")).toBe(true);
    const log = await ok(api, "session.log", { tail: 20 });
    expect(log.events.some((e: Any) => e.source === "tools" && e.kind === "note")).toBe(true);
    expect(log.events.some((e: Any) => e.source === "bridge" && e.kind === "write")).toBe(true);
    const since = await ok(api, "session.events", { since: events.next });
    expect(since.events).toHaveLength(0);
  });

  test("session.handover: writes refused handed_over, behaviours stopped, the stream says so; session.resume gives writes back", async () => {
    await ok(api, "showroom.spawn", { manifest: fixture });
    await ok(api, "behave.turntable", { deg_per_s: 30 });
    const handed = await ok(api, "session.handover", { lights: "clear", note: "judge Shimmer by hand" });
    expect(handed.handed_over).toBe(true);
    expect(handed.steps.map((s: Any) => s.step)).toContain("clear the showroom's rigs");
    expect(await refused(api, "photo.camera.set", { fov: 40 })).toBe("handed_over");
    const list = await until(() => ok(api, "behave.list"), (l: Any) => l.behaviours.length === 0);
    expect(list.behaviours).toHaveLength(0);
    const log = await ok(api, "session.log", { tail: 50, sources: ["bridge"] });
    expect(log.events.some((e: Any) => e.kind === "handover")).toBe(true);
    expect(log.events.some((e: Any) => e.kind === "refused" && e.data?.code === "handed_over")).toBe(true);
    await ok(api, "session.resume", { note: "done" });
    await ok(api, "photo.camera.set", { fov: 40 });
    const tail = await ok(api, "session.log", { tail: 5, sources: ["bridge"], kinds: ["resume"] });
    expect(tail.events.length).toBe(1);
  });
});

describe("0.6 behaviours at tick rate", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 120);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("turntable: the heads turn half a revolution, stop, and turn back; the stream records how it ended", async () => {
    await phase(api, "photo_mode");
    await ok(api, "showroom.spawn", { manifest: fixture });
    const started = await ok(api, "behave.turntable", { deg_per_s: 360, revolutions: 0.5 });
    expect(started).toMatchObject({ kind: "turntable", write_class: "write-showroom", undo: { method: "behave.stop" } });
    const mid = await until(() => ok(api, "showroom.state"), (s: Any) => s.pieces.some((p: Any) => Math.abs(p.yaw - p.base_yaw) > 5), 3000);
    expect(mid.pieces.some((p: Any) => Math.abs(p.yaw - p.base_yaw) > 5)).toBe(true);
    await until(() => ok(api, "behave.list"), (l: Any) => l.behaviours.length === 0);
    const state = await ok(api, "showroom.state");
    expect(state.pieces.every((p: Any) => near(p.yaw, p.base_yaw, 1e-3))).toBe(true);
    const events = await ok(api, "session.events", { kinds: ["behaviour"] });
    expect(events.events.some((e: Any) => e.data?.id === started.id && e.data?.reason === "done")).toBe(true);
  });

  test("keep_framed on a head: moved onto the camera's view ray at its distance (exact from the camera's pose)", async () => {
    await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], lateral_m: 0.8 });
    const started = await ok(api, "behave.keep.framed", { subject: "piece", piece: 0, distance_m: 2 });
    expect(started.write_class).toBe("write-photo");
    const read = await until(() => ok(api, "scene.read", { parts: ["camera", "showroom"] }), (r: Any) => {
      const eyes = r.showroom.pieces[0]?.eyes;
      return eyes && Math.abs(eyes[0] - 100) < 1e-3;
    });
    const eyes = read.showroom.pieces[0].eyes;
    const model = calibrate(poseOf(read.camera)!, read.calibration);
    const at = project(model, eyes);
    expect(Math.abs(at.x) < 1e-3 && Math.abs(at.y) < 1e-3 && near(at.depth, 2, 1e-2)).toBe(true);
    await ok(api, "behave.stop", { id: started.id });
  });

  test("keep_framed on V in photo mode: her placement is steered until her face sits where asked", async () => {
    const started = await ok(api, "behave.keep.framed", { subject: "v", at: { x: 0.05, y: 0.05 }, tolerance: 0.01 });
    const list = await until(() => ok(api, "behave.list"), (l: Any) => {
      const b = l.behaviours.find((x: Any) => x.id === started.id);
      return b?.summary?.error && Math.abs(b.summary.error.x) <= 0.01 && Math.abs(b.summary.error.y) <= 0.01;
    }, 8000);
    const b = list.behaviours.find((x: Any) => x.id === started.id);
    expect(Math.abs(b.summary.error.x) <= 0.01 && Math.abs(b.summary.error.y) <= 0.01).toBe(true);
    await ok(api, "behave.stop", { id: started.id });
    const stopped = await until(() => ok(api, "session.events", { kinds: ["behaviour"] }), (e: Any) => e.events.some((x: Any) => x.data?.id === started.id && x.data?.reason));
    const end = stopped.events.find((x: Any) => x.data?.id === started.id && x.data?.reason);
    expect(end.data.undo.method).toBe("photo.camera.set");
  });

  test("look and glide in normal play: the view turns 90 degrees, V glides 3 m along a path and gets her movement back", async () => {
    await phase(api, "gameplay");
    const look = await ok(api, "behave.look", { turn: { yaw: 90 }, duration_s: 0.3 });
    await until(() => ok(api, "behave.list"), (l: Any) => !l.behaviours.some((b: Any) => b.id === look.id));
    const state = await ok(api, "player.state");
    expect(near(state.yaw, 90, 2)).toBe(true);
    const start = state.position;
    const glide = await ok(api, "behave.glide.path", { offset: { forward: 3 }, speed_m_s: 6 });
    const during = await until(() => ok(api, "player.state"), (s: Any) => s.bridge_effects.includes("GameplayRestriction.NoMovement"), 2000);
    expect(during.bridge_effects).toContain("GameplayRestriction.NoMovement");
    await until(() => ok(api, "behave.list"), (l: Any) => !l.behaviours.some((b: Any) => b.id === glide.id));
    const after = await ok(api, "player.state");
    expect(near(Math.hypot(after.position[0] - start[0], after.position[1] - start[1]), 3, 0.05)).toBe(true);
    expect(after.bridge_effects).toHaveLength(0);
    const events = await ok(api, "session.events", { kinds: ["behaviour"] });
    const end = events.events.find((e: Any) => e.data?.id === glide.id && e.data?.reason);
    expect(end.data).toMatchObject({ reason: "arrived", undo: { method: "player.teleport" } });
  });

  test("the kill switch stops every behaviour", async () => {
    await phase(api, "photo_mode");
    await ok(api, "showroom.spawn", { manifest: fixture });
    await ok(api, "behave.turntable", { deg_per_s: 45 });
    await sleep(200);
    await ok(api, "bridge.kill");
    const stopped = (l: string) => l.includes("behave.stopped") && l.includes("reason=kill_switch");
    for (let i = 0; i < 60 && !host.log.some(stopped); i++) await sleep(50);
    expect(host.log.some(stopped)).toBe(true);
  });
});

describe("0.6 player control, phase 1", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 90);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("player.state, teleport with an offset and a turn (held), its undo, and the ground checks", async () => {
    await phase(api, "gameplay");
    const state = await ok(api, "player.state");
    expect(state).toMatchObject({ position: [100, 200, 10], yaw: 0, busy: "", perspective: "fpp" });
    const moved = await ok(api, "player.teleport", { offset: { forward: 2 }, turn: 90 });
    expect(moved).toMatchObject({ target: [100, 202, 10], yaw: 90, held: true, snapped: true });
    await sleep(600);
    await ok(api, "player.teleport", moved.undo.params);
    expect((await ok(api, "player.state")).position).toEqual([100, 200, 10]);
    await sleep(600);
    expect(await refused(api, "player.teleport", { position: [100, 210, 15] })).toBe("no_ground");
    expect(await refused(api, "player.teleport", { position: [100, 300, 10] })).toBe("too_far");
    expect(await refused(api, "player.teleport", { position: [-5, 200, 10], far: true })).toBe("not_streamed");
  });

  test("player.look instantly and smoothly reaches within 2 degrees; the undo turns back", async () => {
    const instant = await ok(api, "player.look", { yaw: 45, pitch: -20 });
    expect(instant.within_2_deg).toBe(true);
    const smooth = await ok(api, "player.look", { yaw: -30, relative: true, mode: "smooth", duration_s: 0.4 });
    expect(smooth).toMatchObject({ mode: "smooth", within_2_deg: true });
    expect(near(smooth.reached.yaw, 15, 2)).toBe(true);
    const back = await ok(api, "player.look", smooth.undo.params);
    expect(near(back.reached.yaw, 45, 2)).toBe(true);
  });

  test("player.action: crouch and stand, weapons, menus; player.stop lifts the bridge's effects", async () => {
    const crouch = await ok(api, "player.action", { name: "crouch" });
    expect(crouch.undo).toEqual({ method: "player.action", params: { name: "stand" } });
    expect((await ok(api, "player.state")).bridge_effects).toContain("GameplayRestriction.ForceCrouch");
    await ok(api, "player.action", crouch.undo.params);
    expect((await ok(api, "player.state")).bridge_effects).toHaveLength(0);
    const draw = await ok(api, "player.action", { name: "weapon.draw" });
    expect((await ok(api, "player.state")).weapon_drawn).toBe(true);
    await ok(api, "player.action", draw.undo.params);
    await ok(api, "player.action", { name: "menu.open", menu: "inventory" });
    expect((await ok(api, "player.state")).menu).toBe("inventory");
    await ok(api, "player.action", { name: "menu.close" });
    await ok(api, "player.action", { name: "crouch" });
    const stop = await ok(api, "player.stop");
    expect(stop.removed).toContain("GameplayRestriction.ForceCrouch");
    expect(await refused(api, "player.action", { name: "menu.open" })).toBe("bad_params");
  });

  test("V's state refuses what the bridge won't do now: combat, photo mode", async () => {
    await api.callBridge("selftest.player", { busy: "in_combat" }, "t");
    expect(await refused(api, "player.teleport", { turn: 10 })).toBe("in_combat");
    expect(await refused(api, "player.action", { name: "crouch" })).toBe("in_combat");
    await api.callBridge("selftest.player", { busy: "" }, "t");
    await phase(api, "photo_mode");
    expect(await refused(api, "player.teleport", { turn: 10 })).toBe("player_busy");
    await phase(api, "gameplay");
  });

  test("interactions and the input probe are reads; the player class gates the rest", async () => {
    const list = await ok(api, "player.interact.list");
    expect(list.interaction.hub.choices[0]).toMatchObject({ index: 0, label: "Open", input_action: "Choice1" });
    const probe = await ok(api, "input.probe");
    expect(probe.functional_tests).toMatchObject({ class: "FunctionalTestsGameSystem", present: true });
    expect(probe.note).toContain("read-only");
    for (const name of ["player.teleport", "player.look", "player.action", "behave.look", "behave.glide.path"]) expect(findCommand(name)!.permission).toBe("write-player");
    const locked = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world"], 20);
    const other = apiFor(locked);
    expect(await refused(other, "player.teleport", { turn: 10 })).toBe("write_class_disabled");
    expect(await refused(other, "behave.look", { yaw: 10 })).toBe("write_class_disabled");
    expect((await ok(other, "player.state")).position).toEqual([100, 200, 10]);
    other.close();
    await locked.stop();
  }, HOOK_TIMEOUT_MS);
});

describe("0.6 photo.camera.preset (research: the preset-rewrite route)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 60);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("rewrites a preset's values, selects it, reads the camera back; the undo writes the earlier values back", async () => {
    expect(await refused(api, "photo.camera.preset", { preset: 9, values: { dist: -2.5 } })).toBe("not_in_photo_mode");
    await phase(api, "photo_mode");
    const first = await ok(api, "photo.camera.preset", { preset: 9, values: { dist: -2.5, fov: 20 } });
    expect(first).toMatchObject({ preset: 9, written: { dist: -2.5, fov: 20 }, before: { dist: -1.8, fov: 25 } });
    expect(first.camera_moved_m).toBeGreaterThan(0.5);
    expect(first.undo).toMatchObject({ method: "photo.camera.preset", params: { preset: 9, values: { dist: -1.8, fov: 25 }, select: false, camera_preset: 0 } });
    const undone = await ok(api, "photo.camera.preset", first.undo.params);
    expect(near(undone.written.dist, -1.8, 1e-5) && undone.written.fov === 25).toBe(true);
    expect(await refused(api, "photo.camera.preset", { values: { height: 1 } })).toBe("bad_input");
    expect(await refused(api, "photo.camera.preset", { select: false })).toBe("bad_params");
  });
});
