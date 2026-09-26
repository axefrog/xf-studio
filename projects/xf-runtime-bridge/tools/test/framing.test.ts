// photo.frame's two routes against simulated worlds, photo.open's key helpers, and capture.burst.
// No game, and nothing here sends a key (helpers.ts sets XFB_NO_INPUT=1).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { frame, frameByCapture, readingProblem, screenSpace, type FramingAdapter, type SubjectReading } from "../api/framing.ts";
import { captureBurst } from "../capture/capture.ts";
import type { Pixels } from "../capture/win32.ts";
import { INPUT_SIZE, keyboardInput, readPhotoModeBinding, sendKeyToWindow, virtualKey } from "../input/photo-key.ts";
import { runScript, SCRIPT_SCHEMA, type SessionScript } from "../session.ts";
import { openSyntheticWindow, startSelftestHost, tempDir, type Host, type Synthetic } from "./helpers.ts";

const DEG = Math.PI / 180;

/**
 * A pinhole camera at (0, 0, 1.6) looking along +Y, a window of 1920 x 800 (aspect 2.4), and V's head
 * moved by the pose tab through a skewed, scaled mapping the framing loop has to learn. ProjectPoint
 * answers in pixels with y downwards, unlike the self-test host's NDC.
 */
class World {
  fov = 40;
  yaw = 0;
  lr = 0;
  ud = 0;
  width = 1920;
  height = 800;
  headWidth = 0.155;
  head() {
    const theta = (200 + this.yaw) * DEG;
    const f = { x: Math.sin(theta), y: Math.cos(theta) };
    return { x: -0.6 + 1.1 * this.lr + 0.2 * this.ud + f.x * 0.03, y: 8 + 0.3 * this.lr + f.y * 0.03, z: 1.5 + 0.9 * this.ud, f };
  }
  project(p: { x: number; y: number; z: number }) {
    const t = Math.tan((this.fov * DEG) / 2);
    const depth = p.y;
    return { x: this.width / 2 + ((p.x / (depth * t)) * this.height) / 2, y: this.height / 2 - (((p.z - 1.6) / (depth * t)) * this.height) / 2, z: depth, w: 1 };
  }
  reading(offset: { up: number; forward: number; right: number }): SubjectReading {
    const h = this.head();
    const r = { x: h.f.y, y: -h.f.x };
    const target = { x: h.x + h.f.x * offset.forward + r.x * offset.right, y: h.y + h.f.y * offset.forward + r.y * offset.right, z: h.z + offset.up };
    return {
      subject: "photo_puppet",
      slot: "Head",
      approximate: false,
      head: { x: h.x, y: h.y, z: h.z },
      target,
      subject_forward: { x: h.f.x, y: h.f.y, z: 0 },
      camera: { position: { x: 0, y: 0, z: 1.6 }, forward: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, fov: this.fov, aspect: 2.4 },
      screen: {
        target: this.project(target),
        head: this.project(h),
        center: this.project({ x: 0, y: 5, z: 1.6 }),
        up: this.project({ ...target, z: target.z + 0.1 }),
        right: this.project({ ...target, x: target.x + 0.1 }),
      },
      pose: { fov: { value: this.fov, min: 1, max: 120 }, yaw: { value: this.yaw, min: -180, max: 180 }, left_right: { value: this.lr, min: -5, max: 5 }, up_down: { value: this.ud, min: -5, max: 5 } },
    };
  }
  set(values: { fov?: number; subject?: { yaw?: number; left_right?: number; up_down?: number } }) {
    const applied = [];
    if (values.fov !== undefined) {
      applied.push({ name: "fov", before: this.fov, after: values.fov, before_known: true });
      this.fov = values.fov;
    }
    const s = values.subject ?? {};
    for (const [name, key] of [
      ["yaw", "yaw"],
      ["left_right", "lr"],
      ["up_down", "ud"],
    ] as const) {
      if (s[name] !== undefined) {
        applied.push({ name: `subject.${name}`, before: this[key], after: s[name]!, before_known: true });
        this[key] = s[name]!;
      }
    }
    return applied;
  }
  /** A 960 x 400 picture: a static textured background, V's head (an ellipse) and shoulders, textured. */
  render(): Pixels {
    const w = 960;
    const h = 400;
    const k = w / this.width;
    const head = this.head();
    const top = this.project({ x: head.x, y: head.y, z: head.z + 0.12 });
    const centre = this.project(head);
    const t = Math.tan((this.fov * DEG) / 2);
    const pxPerM = (this.height / 2 / (head.y * t)) * k;
    const rx = (this.headWidth / 2) * pxPerM;
    const ry = 0.12 * pxPerM;
    const cx = centre.x * k;
    const cy = (top.y * k + centre.y * k) / 2 + ry * 0.3;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        let v = 60 + ((x * 7 + y * 13) % 17) * 3; // static background texture
        const inHead = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
        const inBody = y > cy + ry * 0.9 && Math.abs(x - cx) < rx * 2.4;
        if (inHead || inBody) v = 170 + (Math.floor((x - cx) / 3) % 2) * 30 + (Math.floor((y - cy) / 4) % 2) * 20;
        rgb[i] = rgb[i + 1] = rgb[i + 2] = Math.max(0, Math.min(255, v));
      }
    }
    return { width: w, height: h, rgb };
  }
}

const adapterFor = (world: World, withSubject = true): FramingAdapter => ({
  subject: async (offset) => {
    if (!withSubject) throw new Error("photo.subject isn't available");
    return world.reading(offset);
  },
  setCamera: async (values) => world.set(values),
  grab: async () => world.render(),
  pose: async () => ({ fov: world.fov, yaw: world.yaw, lr: world.lr, ud: world.ud }),
});

describe("photo.frame", () => {
  test("screen spaces: NDC, 0-1 and pixels all map to window heights from the centre, y down", () => {
    const world = new World();
    const pixels = world.reading({ up: 0, forward: 0, right: 0 });
    expect(screenSpace(pixels).kind).toBe("pixels");
    const ndc: SubjectReading = { ...pixels, screen: { target: { x: 0.5, y: 0.5 }, head: { x: 0.5, y: 0.5 }, center: { x: 0, y: 0 }, up: { x: 0.5, y: 0.6 }, right: { x: 0.6, y: 0.5 } } };
    const s = screenSpace(ndc);
    expect(s.kind).toBe("ndc");
    // NDC (0.5, 0.5) is right of and above the centre: x = 0.5 * 2.4 / 2 heights, y = -0.25.
    expect(s.toFrame({ x: 0.5, y: 0.5 })).toEqual({ x: 0.6, y: -0.25 });
    const unit: SubjectReading = { ...pixels, screen: { target: { x: 0.6, y: 0.4 }, head: { x: 0.6, y: 0.4 }, center: { x: 0.5, y: 0.5 }, up: { x: 0.6, y: 0.3 }, right: { x: 0.7, y: 0.4 } } };
    expect(screenSpace(unit).kind).toBe("unit");
    expect(readingProblem({ ...pixels, target: { x: 0, y: -3, z: 1.6 } })).toContain("in front");
  });

  test("the projection route faces the camera, centres the face and sizes it in a few steps", async () => {
    const world = new World();
    const result = await frame(adapterFor(world), { target: "face" });
    expect(result.method).toBe("project");
    expect(result.converged).toBe(true);
    expect(Math.hypot(result.residual.x, result.residual.y)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(result.residual.size - 1)).toBeLessThan(0.05);
    // V faces the camera: the head's forward points back at the camera within a couple of degrees.
    const h = world.head();
    const toCamera = Math.atan2(-h.x, -h.y);
    const facing = Math.atan2(h.f.x, h.f.y);
    expect(Math.abs(((facing - toCamera) / DEG + 540) % 360 - 180)).toBeLessThan(2);
    expect(result.steps.length).toBeLessThanOrEqual(14);
    // The undo holds the values from before the call.
    expect(result.undo).toEqual({ method: "photo.camera.set", params: { fov: 40, subject: { yaw: 0, left_right: 0, up_down: 0 } } });
  });

  test("the projection route honours position, span and yaw_offset", async () => {
    const world = new World();
    const result = await frame(adapterFor(world), { target: "eyes", position: { x: 0.4, y: 0.45 }, span_m: 0.3, yaw_offset: 20 });
    expect(result.converged).toBe(true);
    const r = world.reading(result.offset);
    const p = r.screen.target;
    expect(Math.abs(p.x / world.width - 0.4)).toBeLessThan(0.01);
    expect(Math.abs(p.y / world.height - 0.45)).toBeLessThan(0.012);
    const h = world.head();
    const toCamera = Math.atan2(-h.x, -h.y);
    const facing = Math.atan2(h.f.x, h.f.y);
    expect(Math.abs(Math.abs(((facing - toCamera) / DEG + 540) % 360 - 180) - 20)).toBeLessThan(2.5);
  });

  test("without photo.subject, the capture route finds the head in captures and brings it near the target", async () => {
    const world = new World();
    world.lr = 0.3;
    const result = await frame(adapterFor(world, false), { target: "face", max_steps: 6 });
    expect(result.method).toBe("capture");
    expect(result.notes.join(" ")).toContain("projection route wasn't available");
    // Coarse: check where the head centre landed, in window fractions.
    const head = world.project(world.head());
    expect(Math.abs(head.x / world.width - 0.5)).toBeLessThan(0.06);
    expect(result.steps.some((s) => s.kind === "measure")).toBe(true);
    expect(result.undo?.params).toHaveProperty("subject");
  });

  test("the capture route refuses in plain words when nothing moves", async () => {
    const world = new World();
    const still: FramingAdapter = { ...adapterFor(world, false), setCamera: async () => [] };
    await expect(frameByCapture(still, { target: "face" }, { fov: 40, lr: 0, ud: 0, yaw: 0 })).rejects.toThrow(/didn't show up as moving/);
  });
});

describe("photo.open's key", () => {
  test("the binding comes from UserSettings.json's key bindings, else IK_N", () => {
    const dir = tempDir("xfb-keys-");
    const file = join(dir, "UserSettings.json");
    writeFileSync(file, JSON.stringify({ version: 1, data: [{ group_name: "/key_bindings/SettingsLocomotion", options: [{ name: "photoMode", type: "name", value: "IK_F9", default_value: "IK_N" }] }] }));
    expect(readPhotoModeBinding(file)).toEqual({ name: "IK_F9", source: "user_settings" });
    expect(readPhotoModeBinding(join(dir, "missing.json"))).toEqual({ name: "IK_N", source: "default" });
    writeFileSync(file, "not json");
    expect(readPhotoModeBinding(file).source).toBe("default");
  });

  test("key names map to virtual keys; the INPUT record is a scan-code press", () => {
    expect(virtualKey("IK_N")).toBe(0x4e);
    expect(virtualKey("IK_7")).toBe(0x37);
    expect(virtualKey("IK_F9")).toBe(0x78);
    expect(virtualKey("IK_Pad_A")).toBeNull();
    const up = keyboardInput(0x31, true);
    const view = new DataView(up.buffer);
    expect(up.length).toBe(INPUT_SIZE);
    expect(view.getUint32(0, true)).toBe(1); // INPUT_KEYBOARD
    expect(view.getUint16(10, true)).toBe(0x31);
    expect(view.getUint32(12, true)).toBe(0x0008 | 0x0002); // scan code, key up
  });

  test("tests can't press keys: the real sender refuses while XFB_NO_INPUT is set", async () => {
    await expect(sendKeyToWindow({ hwnd: 1n, pid: 1 }, 0x4e, "sendinput")).rejects.toThrow(/switched off/);
  });
});

describe("photo.open and the session runner, against the self-test host", () => {
  let host: Host;
  let synthetic: Synthetic;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes"], 60);
    synthetic = await openSyntheticWindow(640, 360);
  });
  afterAll(async () => {
    synthetic?.close();
    await host?.stop();
  });

  test("photo.open refuses outside gameplay, and with a fake key sender opens photo mode and waits for it", async () => {
    const sent: number[] = [];
    let api: CommandApi;
    api = new CommandApi({
      runtimeDir: host.dir,
      captureRoot: join(tempDir("xfb-open-"), "captures"),
      captureTarget: { hwnd: synthetic.hwnd },
      idleCloseMs: 300,
      keySender: async (_target, vk, route) => {
        sent.push(vk);
        // The "game" reacts to the key: photo mode opens.
        await api.callBridge("selftest.phase", { phase: "photo_mode" }, "t-key");
        return { route, focused_by_bridge: false, scan_code: 0x31 };
      },
    });
    // Refused without the write gate (a read-only host), outside gameplay (nothing sent), a no-op in
    // photo mode, and from gameplay the key goes
    // to the target window and photo.open waits until photo mode is open.
    const readOnly = await startSelftestHost([], 20);
    const gated = new CommandApi({ runtimeDir: readOnly.dir, captureRoot: join(tempDir("xfb-open-ro-"), "captures"), captureTarget: { hwnd: synthetic.hwnd }, keySender: async () => { throw new Error("must not send"); } });
    const refused = await gated.run("photo.open", {});
    expect(!refused.ok && refused.error.code).toBe("writes_disabled");
    gated.close();
    await readOnly.stop();
    await api.callBridge("selftest.phase", { phase: "character_menu" }, "t-phase");
    let outcome = await api.run("photo.open", {});
    expect(!outcome.ok && outcome.error.code).toBe("not_in_gameplay");
    expect(sent).toEqual([]);
    await api.callBridge("selftest.phase", { phase: "gameplay" }, "t-phase");
    outcome = await api.run("photo.open", {});
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (outcome.ok) expect(outcome.result).toMatchObject({ changed: true, undo: { method: "photo.exit", params: {} } });
    expect(sent).toHaveLength(1);
    outcome = await api.run("photo.open", {});
    expect(outcome.ok && (outcome.result as { changed: boolean }).changed).toBe(false);
    expect(sent).toHaveLength(1);
    await api.run("photo.exit", {});
    api.close();
  }, 20000);

  test("a frame step and a burst step run in a session and record their files", async () => {
    const api = new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-fs-"), "captures"), captureTarget: { hwnd: synthetic.hwnd }, idleCloseMs: 300 });
    const out = tempDir("xfb-fs-out-");
    const script: SessionScript = {
      schema: SCRIPT_SCHEMA,
      name: "frame-burst",
      steps: [
        { do: "run", label: "enter", command: "photo.enter", input: { route: "quest" } },
        { do: "frame", label: "frame-face", target: "face" },
        { do: "burst", label: "burst", frames: 3, interval_ms: 50, region: "center-16x9", max_width: 320 },
        { do: "ask", label: "later", text: "Open the creator.", replaced_by: "cc.open" },
      ],
      restore: [{ do: "run", label: "restore-exit", command: "photo.exit", continue_on_error: true }],
    };
    const result = await runScript(script, { api, outDir: out, log: () => {} });
    expect(result.outcome).toBe("paused");
    const framed = result.records.find((r) => r.label === "frame-face")!;
    expect(framed.ok).toBe(true);
    expect((framed.result as { method: string }).method).toBe("project");
    const burst = result.records.find((r) => r.label === "burst")!;
    expect(burst.ok).toBe(true);
    expect(existsSync(join(out, burst.files!.sheet))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(out, burst.files!.manifest), "utf8"));
    expect(manifest.frames).toHaveLength(3);
    expect(manifest.frames[1].diff_previous.mean).toBeLessThan(1); // a still window
    expect(result.records.find((r) => r.label === "later")!.replaced_by).toBe("cc.open");
    expect(result.next).toBeUndefined(); // paused at the last step: the session continues by hand
    await api.run("photo.exit", {});
    api.close();
  }, 30000);
});

describe("capture.burst", () => {
  let synthetic: Synthetic;
  beforeAll(async () => {
    synthetic = await openSyntheticWindow(800, 450);
  });
  afterAll(() => synthetic?.close());

  test("takes the frames at the interval, writes each, a contact sheet and one manifest", async () => {
    const out = join(tempDir("xfb-burst-"), "captures");
    const record = await captureBurst({ target: { hwnd: synthetic.hwnd }, frames: 4, intervalMs: 120, name: "flicker", outDir: out, view: { maxWidth: 200 } });
    expect(record.frames).toHaveLength(4);
    expect(record.timing.mean_interval_ms).toBeGreaterThanOrEqual(100);
    expect(record.frames[0].diff_previous).toBeNull();
    expect(record.frames[3].diff_first!.changed_fraction).toBeLessThan(0.01);
    for (const frame of record.frames) expect(existsSync(frame.record.full.path)).toBe(true);
    expect(existsSync(record.contact_sheet.path)).toBe(true);
    expect(JSON.parse(readFileSync(record.manifest, "utf8")).schema).toBe("xfb/capture-burst-1");
  });

  test("refuses a burst outside 2 to 120 frames, in plain words", async () => {
    await expect(captureBurst({ target: { hwnd: synthetic.hwnd }, frames: 1, intervalMs: 0 })).rejects.toThrow(/2 to 120/);
  });
});
