// XF Finish Showroom (bridge 0.5): the layout, rig and spill arithmetic, and showroom.* through the command API against the
// self-test host (the real bridge core and pipe with a simulated game). Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { choosePieces, facingOf, lightAt, planLayout, readShowroom, spacingFor, spill, toLocal, toWorld, yawFacing, type Vec3 } from "../showroom/plan.ts";
import { normalise } from "../showroom/commands.ts";
import { projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const fixture = join(projectDir, "tools", "test", "fixtures", "showroom-manifest.json");
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-sr-cap-"), "captures"), auditDir: tempDir("xfb-sr-audit-"), idleCloseMs: 300 });

describe("showroom plan (offline arithmetic)", () => {
  const showroom = readShowroom(fixture);

  test("the manifest is read and checked: its own entities, presets and three rigs", () => {
    expect(showroom.pieces.map((p) => p.name)).toEqual(["Gloss A · as before", "Gloss B · skin rough", "Gloss C · all rough"]);
    expect(showroom.entity).toMatch(/^axefrog\\appearance_studio\\collections\\[0-9a-f]{32}\\showroom\\xfs_showroom\.ent$/);
    expect(showroom.rigs.creator.lights).toHaveLength(15);
    expect(showroom.rigs.key.lights.map((l) => l.name)).toEqual(["Main_Face"]);
    expect(() => readShowroom(join(projectDir, "package.json"))).toThrow(/xfs\/showroom-package-1/);
  });

  test("presets are chosen by name (loosely), ID or appearance, all by default, and unknown names are refused with the list", () => {
    expect(choosePieces([showroom])).toHaveLength(3);
    expect(choosePieces([showroom], ["gloss c all rough", showroom.pieces[0]!.id]).map((p) => p.name)).toEqual(["Gloss C · all rough", "Gloss A · as before"]);
    expect(() => choosePieces([showroom], ["Matte"])).toThrow(/No showroom preset is called "Matte".*Gloss A/);
  });

  test("yaw turns a head's +Y: yaw 0 faces +Y, 90 faces −X, and the frame maps round-trip", () => {
    expect(facingOf(0).map((v) => Math.round(v) + 0)).toEqual([0, 1, 0]);
    expect(facingOf(90).map((v) => Math.round(v) + 0)).toEqual([-1, 0, 0]);
    for (const d of [[1, 0, 0], [0, -1, 0], [0.6, 0.8, 0]] as Vec3[]) {
      const back = facingOf(yawFacing(d));
      expect(near(back[0], d[0]) && near(back[1], d[1])).toBe(true);
    }
    const p: Vec3 = [10, 20, 3], local: Vec3 = [0.3, -0.04, 1.64];
    const round = toLocal(p, 37, toWorld(p, 37, local));
    expect(round.every((v, i) => near(v, local[i]!, 1e-9))).toBe(true);
  });

  test("an arc stands every head at the distance, spacing apart along it, facing the anchor, left to right as seen", () => {
    const anchor = { origin: [100, 200, 11.7] as Vec3, forward: [0, 1, -0.2] as Vec3, ground: 10 };
    const arc = planLayout(anchor, 5, "arc", 0.7, 2.5);
    for (const p of arc) {
      expect(near(Math.hypot(p.position[0] - 100, p.position[1] - 200), 2.5)).toBe(true);
      expect(p.position[2]).toBe(10);
      const toAnchor: Vec3 = [100 - p.position[0], 200 - p.position[1], 0], face = facingOf(p.yaw), l = Math.hypot(toAnchor[0], toAnchor[1]);
      expect(near(face[0], toAnchor[0] / l) && near(face[1], toAnchor[1] / l)).toBe(true);
    }
    expect(arc[0]!.position[0]).toBeLessThan(arc[4]!.position[0]); // left (−X) first when looking along +Y
    expect(near(Math.hypot(arc[1]!.position[0] - arc[2]!.position[0], arc[1]!.position[1] - arc[2]!.position[1]), 0.7, 0.01)).toBe(true);
    expect(near(Math.abs(normalise(arc[2]!.yaw)), 180)).toBe(true); // the middle head faces back along the view
    // lateral moves the lineup along the arc to the anchor's right: one head 0.45 m right of the view's centre, still facing it.
    const beside = planLayout(anchor, 1, "arc", 0.7, 2.2, 0.45)[0]!;
    expect(beside.position[0]).toBeGreaterThan(100.4);
    expect(near(Math.hypot(beside.position[0] - 100, beside.position[1] - 200), 2.2)).toBe(true);
    const row = planLayout(anchor, 3, "row", 0.7, 2.5);
    expect(row.map((p) => p.position[1])).toEqual([202.5, 202.5, 202.5]);
    expect(row.map((p) => p.position[0])).toEqual([99.3, 100, 100.7]);
  });

  test("the key light reaches only its own head; the full creator rig spills onto neighbours until they are about 3 m apart", () => {
    const head = showroom.headJoint;
    expect(showroom.rigs.creator.lights.reduce((s, l) => s + lightAt(l, head), 0)).toBeGreaterThan(0);
    const row = (spacing: number) => [0, 1, 2].map((i) => ({ index: i, position: [i * spacing, 0, 0] as Vec3, yaw: 0 }));
    expect(Math.max(...spill(showroom.rigs.key.lights, row(0.6), head).map((s) => s.share))).toBe(0);
    expect(Math.max(...spill(showroom.rigs.creator.lights, row(0.7), head).map((s) => s.share))).toBeGreaterThan(0.3);
    expect(Math.max(...spill(showroom.rigs.creator.lights, row(3.2), head).map((s) => s.share))).toBeLessThan(0.02);
    const needed = spacingFor(showroom.rigs.creator.lights, head, 3);
    expect(needed).toBeGreaterThan(1.5);
    expect(needed).toBeLessThan(3.5);
  });

  test("the catalogue's showroom commands are the showroom class, bridge-backed where the plugin answers", () => {
    for (const name of ["showroom.spawn", "showroom.light", "showroom.rotate", "showroom.clear"]) expect(findCommand(name)!.permission).toBe("write-showroom");
    expect(findCommand("showroom.state")!.permission).toBe("read");
    expect(findCommand("showroom.clear")!.bridge?.method).toBe("showroom.clear");
  });
});

describe("showroom.* against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("spawn sets the heads in an arc in front of V, each facing her, and waits until they are in", async () => {
    const out = await api.run("showroom.spawn", { manifest: fixture });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    if (!out.ok) return;
    const result = out.result as any;
    expect(result.anchor).toBe("v");
    expect(result.placed).toHaveLength(3);
    expect(result.state.pending).toBe(0);
    expect(result.state.pieces.map((p: any) => p.label)).toEqual(["Gloss A · as before", "Gloss B · skin rough", "Gloss C · all rough"]);
    // V stands at (100, 200) facing +Y in the simulation: the middle head is 2.5 m ahead, facing back at her.
    const middle = result.pieces[1];
    expect(near(middle.position[0], 100) && near(middle.position[1], 202.5)).toBe(true);
    expect(near(Math.abs(normalise(middle.yaw)), 180)).toBe(true);
    expect(result.undo).toEqual({ method: "showroom.clear", params: { what: "pieces" } });
  });

  test("a creator rig per head warns how much the neighbours' rigs add; the key light doesn't", async () => {
    const creator = await api.run("showroom.light", { manifest: fixture, rig: "creator" });
    expect(creator.ok, JSON.stringify(creator)).toBe(true);
    if (creator.ok) {
      const result = creator.result as any;
      expect(result.rigs).toHaveLength(3);
      expect(result.spill_worst).toBeGreaterThan(0.05);
      expect(result.warning).toMatch(/at least [0-9.]+ m apart/);
      expect(result.state.lights).toHaveLength(3);
    }
    const key = await api.run("showroom.light", { manifest: fixture, rig: "key" });
    expect(key.ok && (key.result as any).warning === undefined && (key.result as any).spill_worst === 0).toBe(true);
    const v = await api.run("showroom.light", { manifest: fixture, rig: "creator", target: "v", replace: false });
    expect(v.ok && (v.result as any).rigs[0].for === -1).toBe(true);
  });

  test("rotate turns the heads relative to how they were set out; a sweep steps through and returns them", async () => {
    const turned = await api.run("showroom.rotate", { yaw_deg: 30 });
    expect(turned.ok, JSON.stringify(turned)).toBe(true);
    const state = (await api.callBridge("showroom.state", {}, "t")) as any;
    for (const p of state.result.pieces) expect(near(normalise(p.yaw - p.base_yaw), 30)).toBe(true);
    const sweep = await api.run("showroom.rotate", { pieces: [0], sweep: { from_deg: -20, to_deg: 20, steps: 3, settle_ms: 0 } });
    expect(sweep.ok, JSON.stringify(sweep)).toBe(true);
    if (sweep.ok) expect((sweep.result as any).frames.map((f: any) => f.angle_deg)).toEqual([-20, 0, 20]);
    const after = (await api.callBridge("showroom.state", {}, "t")) as any;
    expect(near(normalise(after.result.pieces[0].yaw - after.result.pieces[0].base_yaw), 30)).toBe(true);
    const neither = await api.run("showroom.rotate", {});
    expect(!neither.ok && neither.error.code).toBe("bad_input");
  });

  test("the bridge itself refuses anything but the showroom's own templates", async () => {
    const refused = await api.callBridge("showroom.place", { items: [{ index: 0, template: "base\\characters\\entities\\player\\player_wa_fpp.ent", appearance: "xfs_p0170d3e01f014a519c3e000000000005", x: 100, y: 202, z: 10, yaw: 0 }] }, "t");
    expect(!refused.ok && refused.error.code).toBe("bad_params");
  });

  test("clear removes lights or everything; loading a save leaves nothing behind", async () => {
    const lights = await api.run("showroom.clear", { what: "lights" });
    expect(lights.ok && (lights.result as any).removed_lights).toBe(4);
    await api.run("showroom.spawn", { manifest: fixture, presets: ["Gloss B · skin rough"] });
    const loaded = await api.run("game.load", { latest: true, discard_unsaved: true });
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    await sleep(500);
    const state = (await api.callBridge("showroom.state", {}, "t")) as any;
    expect(state.result.pieces).toEqual([]);
  });

  test("the kill switch removes the showroom", async () => {
    await api.run("showroom.spawn", { manifest: fixture });
    const killed = await api.run("bridge.kill", {});
    expect(killed.ok).toBe(true);
    for (let i = 0; i < 40 && !host.log.some((l) => l.includes("showroom_cleared")); i++) await sleep(100);
    expect(host.log.some((l) => l.includes("bridge.kill_restored") && l.includes("showroom_cleared"))).toBe(true);
  });
});

describe("showroom refusals", () => {
  test("without the showroom write class nothing spawns, in plain words", async () => {
    const host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world"], 30);
    const api = apiFor(host);
    try {
      const out = await api.run("showroom.spawn", { manifest: fixture });
      expect(!out.ok && out.error.code).toBe("write_class_disabled");
      if (!out.ok) expect(out.error.message).toContain("showroom");
    } finally {
      api.close();
      await host.stop();
    }
  });

  test("without Codeware the showroom says what to install and spawns nothing", async () => {
    const host = await startSelftestHost(["--allow-writes", "--write-classes", "showroom", "--no-codeware"], 30);
    const api = apiFor(host);
    try {
      const out = await api.run("showroom.spawn", { manifest: fixture });
      expect(!out.ok && out.error.code).toBe("codeware_missing");
      if (!out.ok) expect(out.error.message).toMatch(/Codeware 1\.20 or newer.*never installs/);
      const light = await api.run("showroom.light", { manifest: fixture });
      expect(!light.ok && light.error.code).toBe("codeware_missing");
    } finally {
      api.close();
      await host.stop();
    }
  });
});
