// Bridge 0.5.1 (deep review 5's bridge findings, RB-66..75) through the command API against the self-test host
// (the real bridge core and pipe with a simulated game). The pause-menu redirect's decision, the photo-time
// route and the face-index check are also unit-tested in native/src/selftest/UnitTests.cpp; framing's restore
// and yaw units are in framing.test.ts. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { HOOK_TIMEOUT_MS, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b7-cap-"), "captures"), auditDir: tempDir("xfb-b7-audit-"), idleCloseMs: 300 });

async function sim(api: CommandApi, params: Record<string, unknown>) {
  const response = await api.callBridge("selftest.phase", params, "t-phase");
  expect(response.ok, JSON.stringify(response)).toBe(true);
}

async function clock(api: CommandApi): Promise<number> {
  const status = await api.callBridge("game.status", {}, "t-status");
  expect(status.ok, JSON.stringify(status)).toBe(true);
  return (status.ok ? (status.result as { world_time_seconds: number }).world_time_seconds : NaN) as number;
}

async function menuValue(api: CommandApi, key: number): Promise<number | undefined> {
  const state = await api.callBridge("photo.state", { menu: true }, "t-menu");
  expect(state.ok, JSON.stringify(state)).toBe(true);
  return state.ok ? (state.result as { menu: { key: number; value?: number }[] }).menu.find((m) => m.key === key)?.value : undefined;
}

describe("bridge 0.5.1 against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--allow-creator-leave"], 90);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("RB-66: cc.open opens with the NewGame tag when asked (edit_mode new_game), and with the mode's own tag by default", async () => {
    await sim(api, { phase: "gameplay" });
    const tagged = await api.run("cc.open", {});
    expect(tagged.ok, JSON.stringify(tagged)).toBe(true);
    if (tagged.ok) expect(tagged.result).toMatchObject({ opened: true, edit_mode: "HairDresser", route: "pause_menu" });
    await api.run("cc.back", {});
    await sim(api, { phase: "gameplay" });
    const newGame = await api.run("cc.open", { edit_mode: "new_game" });
    expect(newGame.ok, JSON.stringify(newGame)).toBe(true);
    if (newGame.ok) expect(newGame.result).toMatchObject({ opened: true, edit_mode: "NewGame" });
    await api.run("cc.back", {});
    const both = await api.run("cc.open", { edit_mode: "new_game", mode: "ripperdoc" });
    expect(!both.ok && both.error.code).toBe("bad_params");
  });

  test("RB-69: a request the menu never picks up says the pause menu may open instead", async () => {
    await sim(api, { phase: "gameplay", creator_opens: false });
    const timedOut = await api.run("cc.open", { timeout_ms: 500 });
    expect(!timedOut.ok && timedOut.error.code).toBe("creator_open_timeout");
    expect(!timedOut.ok && `${timedOut.error.message} ${timedOut.error.detail ?? ""}`).toContain("pause menu may open");
    await sim(api, { phase: "gameplay" });
  });

  test("RB-67, RB-75: the photo-mode time's undo, replayed after photo mode closes, never reaches the world's clock", async () => {
    await sim(api, { phase: "gameplay" });
    const worldBefore = await clock(api);
    await sim(api, { phase: "photo_mode" });
    const set = await api.run("world.time.set", { hours: 2, minutes: 0 });
    expect(set.ok, JSON.stringify(set)).toBe(true);
    const undo = set.ok ? (set.result as { undo: { method: string; params: Record<string, unknown> } }).undo : null;
    expect(undo).toEqual({ method: "world.time.set", params: { hours: 12, minutes: 0, target: "photo" } });
    if (set.ok) expect(JSON.stringify(set.result)).not.toContain("puts it back");
    await sim(api, { phase: "gameplay" });
    const replayed = await api.run("world.time.set", undo!.params);
    expect(replayed.ok, JSON.stringify(replayed)).toBe(true);
    if (replayed.ok) expect(replayed.result).toMatchObject({ changed: false, route: "photo_time", undo: null });
    expect(await clock(api)).toBe(worldBefore);
    // target world is refused in photo mode; the world's clock is set outside it.
    await sim(api, { phase: "photo_mode" });
    const world = await api.run("world.time.set", { hours: 3, target: "world" });
    expect(!world.ok && world.error.code).toBe("not_in_gameplay");
    await sim(api, { phase: "gameplay" });
  });

  test("RB-70, RB-75: photo mode's slider in hours takes hours; a slider not named for the time is refused", async () => {
    await sim(api, { phase: "photo_mode", photo_time_hours: true });
    const hours = await api.run("world.time.set", { hours: 2, minutes: 30 });
    expect(hours.ok, JSON.stringify(hours)).toBe(true);
    if (hours.ok) expect(hours.result).toMatchObject({ unit: "hours", after_minutes: 150, undo: { params: { hours: 12, minutes: 0, target: "photo" } } });
    await sim(api, { phase: "photo_mode", photo_time_label: "GAME SPEED" });
    const speed = await api.run("world.time.set", { hours: 2 });
    expect(!speed.ok && speed.error.code).toBe("unavailable");
    await sim(api, { phase: "gameplay" });
  });

  test("RB-71: cc.apply by index with the row read before is refused once the slot's row in use changed", async () => {
    await sim(api, { phase: "character_menu", creator_row: "makeupLips_09" });
    const stale = await api.run("cc.apply", { option: "makeupLips_color", index: 6, expect_option: "makeupLips_08" });
    expect(!stale.ok && stale.error.code).toBe("stale_match");
    const wrongValue = await api.run("cc.apply", { option: "xfs_selector", index: 3, expect_value: "xfs_value_04" });
    expect(!wrongValue.ok && wrongValue.error.code).toBe("stale_match");
    const fresh = await api.run("cc.apply", { option: "makeupLips_color", index: 6, expect_option: "makeupLips_09", expect_value: "xfs_value_06" });
    expect(fresh.ok, JSON.stringify(fresh)).toBe(true);
    // By label, the row and value read go with the index (the answer is the same as before).
    const byLabel = await api.run("cc.apply", { option: "hairstyle", label: "valby curtain bob" });
    expect(byLabel.ok, JSON.stringify(byLabel)).toBe(true);
    if (byLabel.ok) expect(byLabel.result).toMatchObject({ index: 7, label: "VALBY CURTAIN BOB" });
    await sim(api, { phase: "gameplay" });
  });

  test("RB-72: photo.state marks a table index found by position as unverified, and photo.expression.index refuses it unless forced", async () => {
    await sim(api, { phase: "photo_mode" });
    const state = await api.run("photo.state", { options: true });
    const options = state.ok ? (state.result as { menu: { key: number; options?: { table_index: number; table_index_by: string; table_index_verified: boolean }[] }[] }).menu.find((m) => m.key === 28)?.options : undefined;
    expect(options?.[56]).toMatchObject({ table_index: 60, table_index_by: "label", table_index_verified: true });
    expect(options?.[58]).toMatchObject({ table_index: 62, table_index_by: "position", table_index_verified: false });
    const refused = await api.run("photo.expression.index", { index: 62 });
    expect(!refused.ok && refused.error.code).toBe("unverified_index");
    const forced = await api.run("photo.expression.index", { index: 62, force: true });
    expect(forced.ok, JSON.stringify(forced)).toBe(true);
    if (forced.ok) expect(forced.result).toMatchObject({ index_by: "position" });
    const verified = await api.run("photo.expression.index", { index: 60 });
    if (verified.ok) expect(verified.result).toMatchObject({ index_by: "label" });
    await sim(api, { phase: "gameplay" });
  });

  test("RB-68, RB-75: a frame refused at its lens's limit puts back the camera preset, roll and look-at it set, and returns the undo", async () => {
    await sim(api, { phase: "photo_mode" });
    const before = { preset: await menuValue(api, 23), roll: await menuValue(api, 2), lookAt: await menuValue(api, 15) };
    const refused = await api.run("photo.frame", { target: "eyes", xf_preset: true, look_at: "off", lens: "wide", span_m: 2 });
    expect(!refused.ok && refused.error.code).toBe("framing_bound");
    expect(!refused.ok && refused.error.message).toContain("put back");
    const detail = !refused.ok && refused.error.detail ? JSON.parse(refused.error.detail) : {};
    expect(detail.undo?.method).toBe("photo.camera.set");
    expect(detail.undo?.params).toMatchObject({ camera_preset: before.preset, look_at: before.lookAt });
    expect(detail.restored).toBe(true);
    expect({ preset: await menuValue(api, 23), roll: await menuValue(api, 2), lookAt: await menuValue(api, 15) }).toEqual(before);
    await sim(api, { phase: "gameplay" });
  });

  test("the catalogue documents cc.open's edit_mode, world.time.set's target, cc.apply's expect_* and the index force", () => {
    const open = findCommand("cc.open")!.input as { properties: Record<string, { enum?: string[] }> };
    expect(open.properties.edit_mode.enum).toEqual(["edit_tag", "new_game"]);
    const time = findCommand("world.time.set")!;
    expect((time.input as { properties: Record<string, { enum?: string[] }> }).properties.target.enum).toEqual(["world", "photo"]);
    expect(time.description).not.toContain("puts back when it closes");
    const apply = findCommand("cc.apply")!.input as { properties: Record<string, unknown> };
    expect(Object.keys(apply.properties)).toEqual(expect.arrayContaining(["expect_option", "expect_value"]));
    const index = findCommand("photo.expression.index")!.input as { properties: Record<string, unknown> };
    expect(index.properties).toHaveProperty("force");
  });
});
