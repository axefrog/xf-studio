// Bridge 0.4.2 (session 4's fixes) through the command API against the self-test host (the real bridge
// core and pipe with a simulated game), plus the label matcher on session 4's names. Framing and
// photo.open's focus rule are in framing.test.ts. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { isMatch, matchLabel } from "../api/labels.ts";
import { startSelftestHost, tempDir, type Host } from "./helpers.ts";

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b6-cap-"), "captures"), auditDir: tempDir("xfb-b6-audit-"), idleCloseMs: 300 });

async function phase(api: CommandApi, name: string) {
  const response = await api.callBridge("selftest.phase", { phase: name }, "t-phase");
  expect(response.ok, JSON.stringify(response)).toBe(true);
}

// Session 4's hairstyle names (the creator's values with CCXL hair packs installed).
const HAIR = ["01", "LONG PAK - #011", "MEDIUM PAK - #007", "Grace - Side Swept Bob - V4", "Kala - Messy Pixie", "lLrn - Viessa Bun", "VALBY CURTAIN BOB", "VIV LOOSE WAVES", 'Nola - hair "Elise"', 'Nola - hair "Vivian"'];
const hair = HAIR.map((text, index) => ({ index, texts: [text] }));

describe("matching a value by the name the game shows", () => {
  test("exact, then normalised, then contained, then every word; the stage and index are reported", () => {
    expect(matchLabel(hair, "valby curtain bob")).toEqual({ index: 6, text: "VALBY CURTAIN BOB", matched_by: "exact" });
    expect(matchLabel(hair, "Kala Messy-Pixie")).toMatchObject({ index: 4, matched_by: "normalised" });
    expect(matchLabel(hair, "viessa")).toMatchObject({ index: 5, matched_by: "contains" });
    expect(matchLabel(hair, "Grace Bob V4")).toMatchObject({ index: 3, matched_by: "words" });
    expect(matchLabel(hair, "long pak 011")).toMatchObject({ index: 1, matched_by: "normalised" });
    expect(matchLabel(hair, "pak 011 long")).toMatchObject({ index: 1, matched_by: "words" });
  });

  test("several hits in a stage are refused with the candidates, never resolved by a looser stage", () => {
    const nola = matchLabel(hair, "Nola");
    expect(isMatch(nola)).toBe(false);
    if (!isMatch(nola)) expect(nola).toMatchObject({ ambiguous: true, candidates: [{ index: 8 }, { index: 9 }] });
    const pak = matchLabel(hair, "pak");
    expect(!isMatch(pak) && pak.ambiguous).toBe(true);
    expect(matchLabel(hair, "pixie cut blue")).toEqual({ ambiguous: false, candidates: [] });
  });
});

describe("bridge 0.4.2 against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--allow-creator-leave"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("cc.apply by label reads the option's values, applies the match by index and names it", async () => {
    await phase(api, "character_menu");
    const applied = await api.run("cc.apply", { option: "hairstyle", label: "Grace Bob V4" });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    if (applied.ok) expect(applied.result).toMatchObject({ index: 4, label: "Grace - Side Swept Bob - V4", label_matched_by: "words", after: 4 });
    const ambiguous = await api.run("cc.apply", { option: "hairstyle", label: "nola" });
    expect(!ambiguous.ok && ambiguous.error.code).toBe("bad_input");
    expect(!ambiguous.ok && ambiguous.error.message).toContain("Elise");
    const none = await api.run("cc.apply", { option: "hairstyle", label: "mohawk" });
    expect(!none.ok && none.error.message).toContain("player_appearance");
    const both = await api.run("cc.apply", { option: "hairstyle", label: "kala", index: 3 });
    expect(!both.ok && both.error.code).toBe("bad_input");
    // index and value still go straight to the bridge.
    const byIndex = await api.run("cc.apply", { option: "xfs_selector", index: 2 });
    expect(byIndex.ok, JSON.stringify(byIndex)).toBe(true);
  });

  test("player.appearance outside the creator says only the flags are live and gives the last reading (none yet here)", async () => {
    await phase(api, "gameplay");
    const read = await api.run("player.appearance", {});
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (read.ok) expect(read.result).toMatchObject({ character_menu_open: false, last_creator_reading: null, note: expect.stringContaining("cc.open") });
  });

  test("photo.state lists each expression's menu value and table index; photo.expression.set takes a label", async () => {
    await phase(api, "photo_mode");
    const state = await api.run("photo.state", { options: true });
    expect(state.ok, JSON.stringify(state)).toBe(true);
    const expressions = state.ok ? (state.result as { menu: { key: number; options?: { data: number; text: string; table_index: number }[] }[] }).menu.find((m) => m.key === 28) : undefined;
    expect(expressions?.options?.[56]).toMatchObject({ data: 56, text: "Static: Sleeping", table_index: 60, table_index_by: "label" });
    const set = await api.run("photo.expression.set", { label: "static sleeping" });
    expect(set.ok, JSON.stringify(set)).toBe(true);
    if (set.ok) expect(set.result).toMatchObject({ label: "Static: Sleeping", menu_value: 56, table_index: 60, after: 56, undo: { method: "photo.expression.set", params: { faceId: 0 } } });
    const byValue = await api.run("photo.expression.set", { faceId: 1 });
    expect(byValue.ok, JSON.stringify(byValue)).toBe(true);
    const neither = await api.run("photo.expression.set", {});
    expect(!neither.ok && neither.error.code).toBe("bad_input");
    const unknown = await api.run("photo.expression.set", { label: "Grinning Madly" });
    expect(!unknown.ok && unknown.error.code).toBe("bad_input");
  });

  test("photo.expression.index on the head item is refused in plain words; the stand-in is the default", async () => {
    const head = await api.run("photo.expression.index", { index: 60, target: "head" });
    expect(!head.ok && head.error.code).toBe("no_effect");
    expect(!head.ok && head.error.message).toContain("stand-in");
    const puppet = await api.run("photo.expression.index", { index: 5 });
    expect(puppet.ok, JSON.stringify(puppet)).toBe(true);
  });

  test("world.time.set in photo mode sets photo mode's own time of day, with an undo in hours and minutes", async () => {
    const first = await api.run("world.time.set", { hours: 2, minutes: 0 });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    if (first.ok) expect(first.result).toMatchObject({ route: "photo_time", after_minutes: 120, undo: { method: "world.time.set", params: { hours: 12, minutes: 0 } } });
    const second = await api.run("world.time.set", { hours: 23, minutes: 30 });
    if (second.ok) expect(second.result).toMatchObject({ before_minutes: 120, undo: { params: { hours: 2, minutes: 0 } } });
    const exact = await api.run("world.time.set", { total_seconds: 7200 });
    expect(!exact.ok && exact.error.code).toBe("bad_params");
    // Outside photo mode it is the world clock again, undone to the exact second.
    await phase(api, "gameplay");
    const world = await api.run("world.time.set", { hours: 3 });
    expect(world.ok, JSON.stringify(world)).toBe(true);
    if (world.ok) expect((world.result as { undo: { params: Record<string, number> } }).undo.params).toHaveProperty("total_seconds");
  });

  test("cc.open reports the pause-menu route (Character Customization Anywhere's)", async () => {
    await phase(api, "gameplay");
    const opened = await api.run("cc.open", {});
    expect(opened.ok, JSON.stringify(opened)).toBe(true);
    if (opened.ok) expect(opened.result).toMatchObject({ opened: true, route: "pause_menu" });
    await api.run("cc.back", {});
  });

  test("the catalogue documents the light's azimuth frame, the lens and the ±180 yaw_offset", () => {
    const light = JSON.stringify(findCommand("photo.light.set")!.input);
    expect(light).toContain("not from the camera");
    const frame = findCommand("photo.frame")!.input as { properties: Record<string, { minimum?: number; maximum?: number; enum?: string[] }> };
    expect(frame.properties.yaw_offset).toMatchObject({ minimum: -180, maximum: 180 });
    expect(frame.properties.lens.enum).toEqual(["portrait", "wide", "keep"]);
  });
});
