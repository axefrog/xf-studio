// Bridge 0.8, part A (bridge-080a): session 8's findings and the UI review's fixes on the tools' side, offline and against
// the self-test host: busy refusals naming the state, the three unexplained codes, the MCP server's version, every command's
// refusal codes, the wardrobe as V looks under Equipment-EX, the projection under photo mode's camera and the lateral
// check, the showroom's free-space report, the sweep's frames without the overlay, cyberware changes that holster first,
// ui.message's one default answer, the panel's anchors, and a load from the main menu's timeout. Proves nothing about the
// game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { CATALOGUE, findCommand, loadClientTimeoutMs, SAVE_DETAILS_WAIT_MS, type CommandContext } from "../api/catalogue.ts";
import { BRIDGE_MESSAGES, busyState, plainBridgeError } from "../api/errors.ts";
import { OUTFIT_SLOT_AREAS, reconcileWardrobe, REFUSALS } from "../api/catalogue080.ts";
import { SERVER_VERSION } from "../mcp/server.ts";
import { modelForRead, poseOf, projectionConsistency } from "../scene/camera.ts";
import { runShowroomRotate, SWEEP_CAPTURE } from "../showroom/commands.ts";
import { HOOK_TIMEOUT_MS, projectDir, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const ALL = "photo,world,character,save,showroom,inventory,player";
type Any = any;
const fixture = join(projectDir, "tools", "test", "fixtures", "showroom-manifest.json");

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b14-cap-"), "captures"), auditDir: tempDir("xfb-b14-audit-"), idleCloseMs: 300 });

async function ok(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<Any> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} ${JSON.stringify(out)}`).toBe(true);
  return out.ok ? (out.result as Any) : null;
}

async function phase(api: CommandApi, value: string, extra: Record<string, unknown> = {}) {
  const response = await api.callBridge("selftest.phase", { phase: value, ...extra }, "t-phase");
  expect(response.ok, JSON.stringify(response)).toBe(true);
}

describe("0.8 offline", () => {
  test("session 8's D3: a busy refusal names the state it saw", () => {
    const detail = "V can't be moved now (player_busy: locomotion:Jump)";
    expect(busyState(detail)).toBe("locomotion:Jump");
    const plain = plainBridgeError("player_busy", detail);
    expect(plain.message).toContain("jumping");
    expect(plain.message).toContain("locomotion:Jump");
    expect(plainBridgeError("player_busy", "V can't be moved now (player_busy: falling)").message).toContain("falling");
    // Without a named state the general sentence stays.
    expect(plainBridgeError("player_busy", "busy").message).toContain("player_state's busy_state");
  });

  test("the MCP work's three codes (and main-menu loading's) have plain words", () => {
    for (const code of ["quest_scene", "arms_drawn", "not_equippable", "metadata_pending"]) {
      expect(plainBridgeError(code).message).not.toContain("didn't explain");
      expect(BRIDGE_MESSAGES[code]).toBeDefined();
    }
  });

  test("the MCP server says the tools' own version (package.json), not 0.3.0", () => {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(pkg.version).toBe("0.8.0");
  });

  test("every command lists its own refusal codes, and every listed code has plain words or is a tools code", () => {
    const tools = new Set(["bad_input", "too_many", "expectation_failed", "no_showroom", "showroom_manifest_missing", "showroom_manifest_bad", "framing_bound", "no_projection",
      "no_response", "no_capture", "not_found", "photo_not_allowed", "key_unsupported", "no_window", "photo_open_timeout", "interrupted", "wait_timeout", "question_gone",
      "capture_no_window", "capture_minimized", "capture_blank", "capture_failed", "tweakxl_missing", "no_such_pin", "too_many_pins", "pin_refused"]);
    for (const command of CATALOGUE) {
      expect(Array.isArray(command.refusals), command.name).toBe(true);
      for (const code of command.refusals ?? []) {
        expect(tools.has(code) || BRIDGE_MESSAGES[code] !== undefined, `${command.name}: ${code}`).toBe(true);
      }
    }
    expect(Object.keys(REFUSALS).sort()).toEqual(CATALOGUE.map((c) => c.name).sort());
    expect(findCommand("cyberware.equip")!.refusals).toContain("arms_drawn");
    expect(findCommand("world.weather.set")!.refusals).toContain("quest_scene");
  });

  test("session 8's H2: under Equipment-EX the Head area shows the outfit's helmet, not hidden", () => {
    const h2 = {
      active: true,
      manager: "script",
      managed_by: "EquipmentEx",
      areas: [
        { area: "Head", equipped: "Items.Helmet_01_basic_01", hidden: true, outfit_item: "", shows: "hidden" },
        { area: "Face", equipped: "Items.bc_earrings_pack_thin_hoops_silver", hidden: true, outfit_item: "", shows: "hidden" },
        { area: "OuterChest", equipped: "", hidden: true, outfit_item: "", shows: "hidden" },
        { area: "InnerChest", equipped: "", hidden: true, outfit_item: "", shows: "hidden" },
        { area: "Legs", equipped: "", hidden: true, outfit_item: "", shows: "hidden" },
        { area: "Feet", equipped: "Items.axellysse_chunky_heels_white", hidden: true, outfit_item: "", shows: "hidden" },
      ],
      script_outfit: {
        active: true,
        name: "EquipmentEx",
        parts: [
          { item: "Items.bc_earrings_pack_thin_hoops_silver", slot: "OutfitSlots.EarRight" },
          { item: "Items.axellysse_chunky_heels_white", slot: "OutfitSlots.Feet" },
          { item: "Items.veegee_chic_elegant_pt6_pants_white", slot: "OutfitSlots.LegsMiddle" },
          { item: "Items.axellysse_summer_top_white", slot: "OutfitSlots.TorsoInner" },
          { item: "Items.lw_mani_red", slot: "OutfitSlots.FingernailsLeft" },
          { item: "Items.Helmet_01_basic_01", slot: "OutfitSlots.Head" },
        ],
      },
    };
    const out = reconcileWardrobe(h2) as Any;
    const area = (name: string) => out.areas.find((a: Any) => a.area === name);
    expect(area("Head")).toMatchObject({ shows: "script_outfit", hidden: false, vanilla_hidden: true, outfit_items: ["Items.Helmet_01_basic_01"], shown_by: "EquipmentEx" });
    expect(area("Feet").outfit_items).toEqual(["Items.axellysse_chunky_heels_white"]);
    expect(area("InnerChest").outfit_items).toEqual(["Items.axellysse_summer_top_white"]);
    expect(area("Legs").outfit_items).toEqual(["Items.veegee_chic_elegant_pt6_pants_white"]);
    // Earrings sit in an accessory slot: the Face area stays hidden, and says who hides it.
    expect(area("Face")).toMatchObject({ hidden: true, shown_by: "EquipmentEx" });
    expect(area("OuterChest").hidden).toBe(true);
    // Not a script outfit: unchanged.
    const plain = { manager: "wardrobe", areas: [{ area: "Head", hidden: true }] };
    expect(reconcileWardrobe(plain)).toBe(plain);
    expect(OUTFIT_SLOT_AREAS.BodyOuter).toEqual(["OuterChest", "Legs"]);
  });

  test("session 8's G3: under photo mode's camera the model, never the game's projection; a lateral mismatch is caught", () => {
    const pose = poseOf({ position: [0, 0, 1.7], forward: [0, 1, 0], fov: 40, aspect: 2.4 })!;
    const model = modelForRead(pose, { center: { x: 0, y: 0 }, up: { x: 0, y: -0.1 }, right: { x: 0.1, y: 0 } } as never, "photo");
    expect(model.game_projection).toBe("not_used");
    expect(model.by).toBe("fov");
    // The drone case: center and far agree (the gameplay camera sits on the drone's axis), the points right of it don't.
    const drone = {
      center: { x: 960, y: 540, z: 0, w: 1 },
      up: { x: 960, y: 530, z: 0, w: 1 },
      right: { x: 970, y: 540, z: 0, w: 1 },
      far: { x: 960, y: 540, z: 0, w: 1 },
      far_right: { x: 1100, y: 540, z: 0, w: 1 },
    };
    const check = projectionConsistency(drone as never, 2.4);
    expect(check.consistent).toBe(false);
    expect(check.note).toContain("same angle");
    const good = { ...drone, far_right: { x: 970, y: 540, z: 0, w: 1 } };
    expect(projectionConsistency(good as never, 2.4).consistent).toBe(true);
  });

  test("a load from the main menu may wait for the save's details: the client waits long enough, and the header agrees", () => {
    const writes = readFileSync(join(projectDir, "native", "src", "core", "Writes.hpp"), "utf8");
    expect(writes).toContain(`kSaveDetailsWaitMs = ${SAVE_DETAILS_WAIT_MS};`);
    expect(findCommand("game.load")!.bridge!.timeoutMs!({})).toBe(loadClientTimeoutMs());
    expect(loadClientTimeoutMs()).toBeGreaterThanOrEqual(5000 + SAVE_DETAILS_WAIT_MS);
  });
});

describe("0.8 against the self-test host", () => {
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

  test("session 8: an ask without choices has one Done button; the CET copy has no Polish letters; the frame names the answered ask", async () => {
    const plain = await ok(api, "ui.message", { text: "Stand still, then press Done.", level: "ask", seconds: 60 });
    expect(plain.choices).toEqual(["Done"]);
    await ok(api, "ui.message", { withdraw: plain.id });
    const ask = await ok(api, "ui.message", { text: "Łódź: fully visible?", level: "ask", seconds: 60, choices: ["Fully visible", "Partly cut off"] });
    const cet = (await api.callBridge("selftest.messages", { surface: "cet" }, "t-cet")) as Any;
    expect(cet.ok && cet.result.pending_ask.text).toBe("Lódz: fully visible?");
    await api.callBridge("selftest.ink_drawn", { id: ask.id, shown: true }, "t-ink");
    const frame = (await api.callBridge("selftest.hud", {}, "t-hud")) as Any;
    expect(frame.result.ink_shows).toBe(ask.id);
    expect(frame.result.status_all.label).toBe("XF Runtime Bridge · XF Studio connected · changes allowed");
    await api.callBridge("selftest.answer", { id: ask.id, choice: 1, via: "ink_key" }, "t-answer");
    const after = (await api.callBridge("selftest.hud", {}, "t-hud2")) as Any;
    expect(after.result.answered).toMatchObject({ id: ask.id, label: "Partly cut off" });
    expect(after.result.messages.map((m: Any) => m.text)).toContain("Łódź: fully visible?");
    await ok(api, "ui.message", { clear: true, clear_asks: true });
  });

  test("ui.hud takes center and bottom_center; the default is top left, 40 by 360", async () => {
    const read = await ok(api, "ui.hud", {});
    expect(read.settings).toMatchObject({ anchor: "top_left", x: 40, y: 360 });
    const centred = await ok(api, "ui.hud", { anchor: "center", x: 0, y: -100 });
    expect(centred.settings.anchor).toBe("center");
    await ok(api, "ui.hud", { anchor: "bottom_center" });
    await ok(api, "ui.hud", { reset: true });
  });

  test("session 8's G6: the showroom says the free space was checked, with each head's clearance, when nothing moved", async () => {
    await phase(api, "gameplay");
    const out = await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], anchor: "v", distance_m: 2 });
    expect(out.space_check).toMatchObject({ checked: true });
    expect(out.space_check.heads[0]).toMatchObject({ index: 0, checked: true, moved_m: 0 });
    expect(typeof out.space_check.heads[0].clear).toBe("boolean");
    const off = await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], anchor: "v", distance_m: 2, avoid_walls: false });
    expect(off.space_check).toMatchObject({ checked: false, why: "avoid_walls: false" });
  });

  test("session 8's G4: every sweep frame is taken with the overlays hidden, as capture_screenshot's are", async () => {
    await ok(api, "showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], anchor: "v", distance_m: 2 });
    const calls: string[] = [];
    const context = {
      api: {
        callBridge: async (method: string, params: Record<string, unknown>, cid: string, timeout?: number) => {
          calls.push(`${method}${method === "ui.hud" ? `:${String(params.show)}` : method === "overlay.hide" ? `:${String(params.hidden)}` : ""}`);
          return api.callBridge(method, params, cid, timeout);
        },
        session: () => true,
        captureTarget: () => ({ hwnd: 0n }),
      },
      cid: "t-sweep",
      captureRoot: tempDir("xfb-b14-sweep-"),
    } as unknown as CommandContext;
    const original = SWEEP_CAPTURE.capture;
    let frames = 0;
    SWEEP_CAPTURE.capture = ((options: Any) => {
      frames++;
      calls.push("capture");
      return { view: { path: join(options.outDir, `${options.name}.png`), width: 8, height: 8 }, full: null } as Any;
    }) as never;
    try {
      const out = await runShowroomRotate({ sweep: { steps: 2, capture: true, settle_ms: 0 } }, context);
      expect(frames).toBe(2);
      expect((out.value as Any).frames[0].overlay).toMatchObject({ panel_hidden: true });
    } finally {
      SWEEP_CAPTURE.capture = original;
    }
    // Before each capture: the panel and the overlay host hidden; after it: both back.
    const first = calls.indexOf("capture");
    expect(calls.slice(0, first)).toEqual(expect.arrayContaining(["ui.hud:false", "overlay.hide:true"]));
    expect(calls.slice(first)).toEqual(expect.arrayContaining(["overlay.hide:false"]));
    await ok(api, "showroom.clear", {});
  });

  test("session 8's E4: with the arm cyberware drawn a change holsters it first (holster_first), or refuses arms_drawn when told not to", async () => {
    await phase(api, "gameplay");
    await ok(api, "cyberware.equip", { item: "Items.MantisBlades", add_if_missing: true });
    await ok(api, "player.action", { name: "weapon.arms" });
    const state = await ok(api, "cyberware.state", { areas: ["ArmsCW"] });
    expect(state.arms.drawn).toBe(true);
    const refused = await api.run("cyberware.equip", { item: "Items.StrongArms", add_if_missing: true, holster_first: false });
    expect(!refused.ok && refused.error.code).toBe("arms_drawn");
    const swapped = await ok(api, "cyberware.equip", { item: "Items.StrongArms", add_if_missing: true });
    expect(swapped.holstered_first).toBe(true);
    expect((await ok(api, "cyberware.state", { areas: ["ArmsCW"] })).arms).toMatchObject({ item: "Items.StrongArms", drawn: false });
    await ok(api, swapped.undo.method, swapped.undo.params);
  });
});
