// The deep review of bridge 0.7.0 (research/authoring/code-health.md, RB-96..RB-118), through the command API against the
// self-test host and offline: session.wait's early answer, question_gone and game notes; a capture's clear keeping the
// question; cyberware.equip's refusals and kept undo, a swap's exact undo; save holds for the weather and cyberware;
// photo.scene.set putting rows back; free-space probes that fail; the theme generator's root blocks and token hash; the
// world-object lint. Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import type { CommandContext } from "../api/catalogue.ts";
import { withOverlayCleared } from "../api/catalogue060.ts";
import { findFreeSpace } from "../showroom/commands.ts";
import { buildTheme, generated, STUDIO_CSS } from "../overlay/theme.ts";
import { inlineNativeResults, lintRedscriptSources } from "../lint-world-objects.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const ALL = "photo,world,character,save,showroom,inventory,player";
type Any = any;

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b13-cap-"), "captures"), auditDir: tempDir("xfb-b13-audit-"), idleCloseMs: 300 });

async function ok(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<Any> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} ${JSON.stringify(out)}`).toBe(true);
  return out.ok ? (out.result as Any) : null;
}

async function refused(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<{ code: string; message: string }> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} should be refused: ${JSON.stringify(out)}`).toBe(false);
  // The plain message and the bridge's own text (detail), together.
  return out.ok ? { code: "", message: "" } : { code: out.error.code, message: `${out.error.message} ${(out.error as { detail?: string }).detail ?? ""}` };
}

async function bridge(api: CommandApi, method: string, params: Record<string, unknown> = {}): Promise<Any> {
  const response = await api.callBridge(method, params, `t-${method}`);
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return response.ok ? response.result : null;
}

describe("0.7 review, offline: the theme generator, the world-object lint, free-space probes", () => {
  test("RB-104: a rule outside :root changes nothing, and --check passes on it", () => {
    const css = readFileSync(STUDIO_CSS, "utf8");
    const extra = `${css}\n.xf-review-extra { color: red; --text: oklch(.5 .2 20); }\n`;
    expect(generated(extra).native).toBe(generated(css).native);
    const file = join(tempDir("xfb-b13-css-"), "studio.css");
    writeFileSync(file, extra);
    const run = spawnSync("bun", [join(projectDir, "tools", "overlay", "theme.ts"), "--check", "--css", file], { encoding: "utf8" });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  test("RB-116: every plain :root block is read, a later one overriding", () => {
    const css = readFileSync(STUDIO_CSS, "utf8");
    const theme = buildTheme(`${css}\n:root { --sp-5: 14px; }\n`);
    expect(theme.metrics.find((m) => m.name === "WindowPaddingX")!.value).toBe(14);
  });

  test("RB-104: a mapped token set in a theme-qualified :root rule is refused (the generator wouldn't see it)", () => {
    const css = readFileSync(STUDIO_CSS, "utf8");
    expect(() => buildTheme(`${css}\n:root[data-theme="dark"] { --text: oklch(1 0 0); }\n`)).toThrow(/outside a plain :root/);
    expect(() => buildTheme(css)).not.toThrow(); // --pv-shade's own overrides are not mapped
  });

  test("RB-113: the world-object lint finds a native's answer inline in string building, and the sources have none", () => {
    const old = [
      "public static func Subject(object: ref<GameObject>, camera: Vector4, occlusion: Bool) -> String {",
      "  let forward = object.GetWorldForward();",
      '  let out = "\\"position\\":" + XFScene.Arr(object.GetWorldPosition());',
      '  out += ",\\"yaw\\":" + XFJson.Num(object.GetWorldYaw());',
      "}",
      "public static func Other(player: ref<PlayerPuppet>) -> String {",
      '  return "x" + XFScene.Arr(player.GetWorldPosition());',
      "}",
      "public static func Light(entity: ref<Entity>) -> String {",
      "  let light = entity as GameObject;",
      '  return "{" + XFScene.Arr(light.GetWorldPosition()) + "}";',
      "}",
    ].join("\n");
    const found = inlineNativeResults(old, "fixture.reds");
    expect(found.map((f) => [f.line, f.variable])).toEqual([[3, "object"], [4, "object"], [11, "light"]]);
    expect(lintRedscriptSources()).toEqual([]);
  });

  test("RB-117: a failed probe is reported for that head as not checked; an older bridge checks nothing", async () => {
    const placements = [{ index: 0, position: [0, 1, 0] as [number, number, number], yaw: 0, eyes: [0, 1, 1.6] as [number, number, number] }];
    const contextFor = (code: string) => ({ api: { callBridge: async () => ({ ok: false, error: { code, message: "busy" } }) }, cid: "t" }) as unknown as CommandContext;
    const transient = await findFreeSpace(contextFor("rate_limited"), placements, [0, 0, 1.6], [0, 1, 0]);
    expect(transient).toHaveLength(1);
    expect(transient[0]).toMatchObject({ index: 0, to: null, checked: false });
    expect(await findFreeSpace(contextFor("unknown_method"), placements, [0, 0, 1.6], [0, 1, 0])).toEqual([]);
  });
});

describe("0.7 review against the self-test host", () => {
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

  test("RB-96: an answer given before session.wait starts is returned at once", async () => {
    const ask = await ok(api, "ui.message", { text: "Answered before the wait?", level: "ask", seconds: 60 });
    await bridge(api, "selftest.answer", { id: ask.id, choice: 1, via: "ink_key" });
    const started = Date.now();
    const out = await ok(api, "session.wait", { message_id: ask.id, timeout_s: 10, poll_ms: 200 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(out.answer).toMatchObject({ label: "Yes", message_id: ask.id, via: "ink_key" });
    expect(out.answered_before_wait).toBe(true);
  });

  test("RB-103: a clear (a capture's) keeps the waiting question; withdrawing it ends session.wait with question_gone", async () => {
    await ok(api, "ui.message", { clear: true, clear_asks: true });
    const ask = await ok(api, "ui.message", { text: "Keep me through the capture", level: "ask", seconds: 60 });
    await ok(api, "ui.message", { text: "an info line" });
    const context = { api, cid: "t-cap", captureRoot: tempDir("xfb-b13-c-") } as CommandContext;
    const { overlay } = await withOverlayCleared(context, () => 1);
    expect(overlay.messages_cleared).toBe(1);
    const lines = (await bridge(api, "selftest.messages")).messages as Any[];
    expect(lines.map((l) => l.id)).toEqual([ask.id]);
    expect(ask.undo).toEqual({ method: "ui.message", params: { withdraw: ask.id } });
    const waiting = api.run("session.wait", { message_id: ask.id, timeout_s: 20, poll_ms: 200 });
    await sleep(500);
    // The command API runs one command at a time, so the withdrawal goes straight to the bridge while the wait runs.
    await bridge(api, ask.undo.method, ask.undo.params);
    const out = await waiting;
    expect(out.ok && (out.result as Any).question_gone).toBe(true);
    const short = await ok(api, "ui.message", { text: "Gone in a second", level: "ask", seconds: 1 });
    const expired = await ok(api, "session.wait", { message_id: short.id, timeout_s: 10, poll_ms: 200 });
    expect(expired.question_gone).toBe(true);
  }, 30_000);

  test("RB-115: notes end a wait only when they come from the game, never a client's own", async () => {
    const waiting = api.run("session.wait", { kinds: ["note"], timeout_s: 20, poll_ms: 200 });
    await sleep(400);
    await bridge(api, "session.note", { text: "a client's own note" });
    await sleep(600);
    await bridge(api, "selftest.answer", { note: "Mark this moment" });
    const out = await waiting;
    const result = (out.ok ? out.result : {}) as Any;
    expect(result.events.map((e: Any) => e.text)).toEqual(["Mark this moment"]);
  }, 30_000);

  test("RB-101: an item V can't equip is refused and leaves nothing added; a failed read-back keeps the undo", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    const refusal = await refused(api, "cyberware.equip", { item: "Items.ProjectileLauncher", add_if_missing: true });
    expect(refusal.code).toBe("not_equippable");
    expect((await bridge(api, "selftest.cyberware")).inventory).not.toContain("Items.ProjectileLauncher");
    await bridge(api, "selftest.cyberware", { fail_settle: "game_loading" });
    const out = await ok(api, "cyberware.equip", { item: "Items.MantisBlades" });
    expect(out.equipped).toBe("unknown");
    expect(out.settle_error.code).toBe("game_loading");
    expect(out.undo).toMatchObject({ method: "cyberware.unequip", params: { area: "ArmsCW" } });
    await ok(api, out.undo.method, out.undo.params);
  });

  test("RB-109: a swap with an added item undoes to the exact earlier copy and removes the added one", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    await ok(api, "cyberware.equip", { item: "Items.MantisBlades" });
    const swap = await ok(api, "cyberware.equip", { item: "Items.StrongArms", add_if_missing: true });
    expect(swap.undo.params).toMatchObject({ item: "Items.MantisBlades", remove_added_item: "Items.StrongArms" });
    expect(typeof swap.undo.params.id).toBe("string");
    const undone = await ok(api, swap.undo.method, swap.undo.params);
    expect(undone).toMatchObject({ equipped: true, removed: true });
    expect((await bridge(api, "selftest.cyberware")).inventory).not.toContain("Items.StrongArms");
  });

  test("RB-102: a held weather and changed cyberware each refuse game.save (bridge_effects_active)", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    // Mantis Blades are in the arms since the test above (the slot was empty at the start): cyberware changed.
    const cyber = await refused(api, "game.save", { name: "with cyberware", override_lock: true });
    expect(cyber.code).toBe("bridge_effects_active");
    expect(cyber.message).toContain("cyberware changed by the bridge");
    const off = await ok(api, "cyberware.unequip", { area: "ArmsCW" });
    expect(off.emptied).toBe(true);
    const rain = await ok(api, "world.weather.set", { name: "24h_weather_rain", blend_s: 0 });
    const weather = await refused(api, "game.save", { name: "with weather", override_lock: true });
    expect(weather.code).toBe("bridge_effects_active");
    expect(weather.message).toContain("weather held by the bridge");
    expect(weather.message).not.toContain("cyberware changed by the bridge");
    await ok(api, rain.undo.method, rain.undo.params);
  });

  test("RB-111: photo.scene.set puts rows already set back when a later row fails", async () => {
    await bridge(api, "selftest.phase", { phase: "photo_mode" });
    const out = await refused(api, "photo.scene.set", { npcs: { label: "Off" }, weather: { label: "Blizzard" } });
    expect(out.code).toBe("bad_params");
    expect(out.message).toContain("put back");
    const world = await ok(api, "world.state", {});
    expect(world.photo_mode.rows.find((r: Any) => r.key === 54).value).toBe(1);
    await bridge(api, "selftest.phase", { phase: "gameplay" });
  });

  test("RB-118: game.saves still answers through its final step", async () => {
    const saves = await ok(api, "game.saves", { limit: 1 });
    expect(saves.saves).toHaveLength(1);
  });
});
