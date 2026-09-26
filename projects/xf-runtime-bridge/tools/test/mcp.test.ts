// The stdio MCP server end to end: the official SDK client starts tools/mcp-server.ts, which talks
// to build/Release/xfb_selftest.exe (the real bridge core and pipe with a simulated game) and
// captures a synthetic window. Proves the frontend, the command API and the pipe together;
// proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawnSync } from "node:child_process";
import { CATALOGUE, toolName } from "../api/catalogue.ts";
import { parsePermissionFlags } from "../mcp/server.ts";
import { acquireSessionLock, LOCK_FILE, lockPath, processStartTime, putBackLock, readSessionLock, sessionRunningMessage } from "../session-lock.ts";
import { CommandApi } from "../api/command-api.ts";
import { PipeConnectError } from "../bridge-lib.ts";
import { BridgeClient } from "../bridge-lib.ts";
import { decodePng } from "../capture/image.ts";
import { openSyntheticWindow, projectDir, sleep, startSelftestHost, tempDir, type Host, type Synthetic } from "./helpers.ts";

type Mcp = { client: Client; close: () => Promise<void> };

async function startMcp(args: string[]): Promise<Mcp> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(projectDir, "tools", "mcp-server.ts"), ...args],
    cwd: projectDir,
    stderr: "pipe",
    // photo_open must never press a key on the test machine.
    env: { ...(process.env as Record<string, string>), XFB_NO_INPUT: "1" },
  });
  const client = new Client({ name: "xfb-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

const call = async (mcp: Mcp, name: string, args: Record<string, unknown> = {}) =>
  (await mcp.client.callTool({ name, arguments: args })) as CallToolResult;
const text = (result: CallToolResult) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");
const json = (result: CallToolResult) => JSON.parse(text(result)) as { result: any; undo?: string; cid: string };

/** Sets the self-test host's simulated phase over a direct connection (after the MCP server's idle close). */
async function setPhase(host: Host, phase: string) {
  await sleep(3500); // the command API closes an idle pipe after 3 s; the bridge takes one client at a time
  const direct = new BridgeClient(host.session, 3000);
  await direct.connect();
  const r = await direct.call("selftest.phase", { phase }, `t-phase-${phase}`);
  direct.close();
  expect(r.ok).toBe(true);
  await sleep(200);
}

describe("MCP server against a read-only bridge", () => {
  let host: Host;
  let mcp: Mcp;
  const root = tempDir("xfb-mcp-ro-");
  beforeAll(async () => {
    host = await startSelftestHost([], 90);
    mcp = await startMcp(["--runtime-dir", host.dir, "--capture-root", join(root, "captures")]);
  });
  afterAll(async () => {
    await mcp?.close();
    await host?.stop();
  });

  test("lists exactly the catalogue, with server instructions", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((t) => t.name)).toEqual(CATALOGUE.map(toolName));
    expect(mcp.client.getInstructions()).toContain("XF Runtime Bridge");
    expect(mcp.client.getServerVersion()?.name).toBe("xf-runtime-bridge");
  });

  test("bridge_ping and game_status answer through the pipe", async () => {
    const ping = await call(mcp, "bridge_ping");
    expect(ping.isError).toBeFalsy();
    expect(json(ping).result.pong).toBe(true);
    const status = await call(mcp, "game_status");
    expect(json(status).result.phase).toBe("gameplay");
    const wait = await call(mcp, "game_wait", { phase: ["gameplay"], timeout_ms: 2000 });
    expect(json(wait).result.phase).toBe("gameplay");
  });

  test("writes are refused in plain words while allow_writes is off, and nothing changes", async () => {
    const result = await call(mcp, "photo_enter");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Changing the game is switched off in this setup");
    expect(text(result)).toContain("writes_disabled");
    expect(json(await call(mcp, "game_status")).result.phase).toBe("gameplay");
    expect(host.log.some((l) => l.includes("evt=bridge.write_refused") && l.includes("method=photo.enter"))).toBe(true);
  });

  test("bad input never reaches the game", async () => {
    const before = host.log.filter((l) => l.includes("evt=bridge.request")).length;
    const result = await call(mcp, "photo_camera_set", { fov: "wide" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("must be a number");
    const unknown = await call(mcp, "system_exec");
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('no tool called "system_exec"');
    expect(host.log.filter((l) => l.includes("evt=bridge.request")).length).toBe(before);
  });

  test("the audit log records the refused write with its undo note", () => {
    const logs = join(root, "logs");
    expect(existsSync(logs)).toBe(true);
    const lines = readdirSync(logs).flatMap((f) => readFileSync(join(logs, f), "utf8").trim().split("\n")).map((l) => JSON.parse(l));
    expect(lines.some((l) => l.command === "photo.enter" && l.event === "request" && l.permission === "write-photo" && l.undo)).toBe(true);
    expect(lines.some((l) => l.command === "photo.enter" && l.event === "refused" && l.code === "writes_disabled")).toBe(true);
  });
});

describe("MCP server against a bridge with writes allowed", () => {
  let host: Host;
  let mcp: Mcp;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes"], 120);
    mcp = await startMcp(["--runtime-dir", host.dir, "--capture-root", join(tempDir("xfb-mcp-rw-"), "captures")]);
  });
  afterAll(async () => {
    await mcp?.close();
    await host?.stop();
  });

  test("photo-mode commands need photo mode, and each write returns its undo", async () => {
    let result = await call(mcp, "photo_camera_set", { preset: "face" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("This only works in photo mode");
    result = await call(mcp, "face_rig_read");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("This only works in photo mode");

    // photo.enter refuses without a route (the quest node opens a restricted photo mode) and points at
    // photo_open; photo_open refuses plainly when it can't send the key safely (here: the self-test host
    // has no game window, and the MCP process runs with key input switched off).
    result = await call(mcp, "photo_enter");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("photo_key_needed");
    expect(text(result)).toContain("photo_open");
    result = await call(mcp, "photo_open");
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/no_window|input_disabled/);
    result = await call(mcp, "photo_enter", { route: "quest" });
    expect(result.isError).toBeFalsy();
    expect(json(result).result.undo).toEqual({ method: "photo.exit", params: {} });
    expect(json(result).undo).toBe("photo.exit.");

    result = await call(mcp, "photo_camera_set", { preset: "face", subject: { up_down: 0.1 } });
    expect(result.isError).toBeFalsy();
    const applied = json(result).result.applied as { name: string; value: number }[];
    expect(applied.map((a) => a.name).sort()).toEqual(["fov", "subject.up_down", "subject.yaw"]);
    expect(json(result).result.undo.method).toBe("photo.camera.set");
    const presetResult = result;

    result = await call(mcp, "photo_camera_set", { fov: 500 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("at most 180");

    // Each undo restores what the call changed (RB-18): the camera values the preset changed, the
    // light's values and the menu's light selection (light 1 was selected when photo mode opened).
    expect(json(presetResult).result.undo.params).toEqual({ fov: 0, subject: { up_down: 0, yaw: 0 } });
    result = await call(mcp, "photo_camera_set", { reset: true });
    const resetUndo = json(result).result.undo;
    expect(resetUndo).toMatchObject({ method: "photo.camera.set", params: { fov: 15, subject: { yaw: 180 } } });
    expect(resetUndo.params.subject.up_down).toBeCloseTo(0.1, 5);

    result = await call(mcp, "photo_light_set", { light: 2, brightness: 40, hue: 200 });
    expect(json(result).result.undo).toEqual({ method: "photo.light.set", params: { light: 2, brightness: 0, hue: 0, select_after: 1 } });
    result = await call(mcp, "photo_light_set", json(result).result.undo.params);
    expect(json(result).result.selected).toBe(1);
    // Light on/off, type and shadow: applied first, and undone as a flag and a type name.
    result = await call(mcp, "photo_light_set", { light: 1, on: true, type: "spot", shadow: true, brightness: 80 });
    expect(result.isError).toBeFalsy();
    expect((json(result).result.applied as { key: number }[]).map((a) => a.key)).toEqual([44, 45, 46, 47]);
    expect(json(result).result.undo_note).toContain("type"); // the simulated menu had no type yet (0)
    expect(json(result).result.undo.params).toMatchObject({ light: 1, on: false, shadow: false, brightness: 0 });
    result = await call(mcp, "photo_hud_hide", {});
    expect(json(result).result.cursor_hidden).toBe(true);
    expect(json(result).result.undo).toEqual({ method: "photo.hud.hide", params: { hidden: false, cursor: true } });
    result = await call(mcp, "photo_hud_hide", { hidden: false });
    expect(json(result).result.cursor_hidden).toBe(false);
    result = await call(mcp, "photo_expression_set", { faceId: 9 });
    expect(json(result).result.after).toBe(9);

    // The expression design's R1/R2 commands: a face index straight to the face animation (only listed
    // indices unless unlisted), undone by selecting the menu's own expression again; and the face rig read.
    result = await call(mcp, "photo_expression_index", { index: 60 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("bad_params");
    result = await call(mcp, "photo_expression_index", { index: 3, target: "head" });
    expect(result.isError, text(result)).toBeFalsy();
    expect(json(result).result).toMatchObject({ target: "head", index: 3, menu_value_known: true });
    expect(json(result).result.undo).toEqual({ method: "photo.expression.set", params: { faceId: 9 } });
    result = await call(mcp, "photo_expression_index", { index: 60, unlisted: true });
    expect(result.isError, text(result)).toBeFalsy();
    expect(json(result).result.target).toBe("puppet");
    result = await call(mcp, "face_rig_read");
    expect(result.isError, text(result)).toBeFalsy();
    const rig = json(result).result;
    expect(rig.target).toBe("head");
    expect(rig.components.map((c: { name: string }) => c.name)).toEqual(["face_rig", "man_face_base_animations", "PhotomodeAnimations"]);
    expect(rig.components[0]).toMatchObject({ found: true, kind: "animated", rig: { hex: "3333333333333333" } });
    expect(rig.components[2].animations.gameplay[0]).toMatchObject({ priority: 128 });
    result = await call(mcp, "face_rig_read", { target: "puppet", components: ["face_rig"] });
    expect(json(result).result.components).toEqual([{ name: "face_rig", found: false }]);
    result = await call(mcp, "face_rig_read", { components: ["face rig"] });
    expect(result.isError).toBe(true);

    // photo_frame against the self-test host's simulated camera: centres the face and sizes it by
    // projection, and undoes to the values before it.
    result = await call(mcp, "photo_camera_set", { reset: true });
    result = await call(mcp, "photo_subject", { up: 0.045, forward: 0.08 });
    expect(result.isError).toBeFalsy();
    expect(json(result).result.slot).toBe("Head");
    result = await call(mcp, "photo_frame", { target: "face", look_at: "off" });
    expect(result.isError, text(result)).toBeFalsy();
    const framed = json(result).result;
    expect(framed.method).toBe("project");
    expect(framed.converged).toBe(true);
    expect(Math.abs(framed.residual.x)).toBeLessThan(0.011);
    expect(Math.abs(framed.residual.size - 1)).toBeLessThan(0.05);
    expect(framed.undo.method).toBe("photo.camera.set");
    expect(framed.undo.params).toHaveProperty("look_at");
    result = await call(mcp, "photo_frame", { target: "eyes", xf_preset: true, yaw_offset: 15 });
    expect(result.isError, text(result)).toBeFalsy();
    expect(json(result).result.camera_preset).toBe(8);
    expect(json(result).result.undo.params).toHaveProperty("camera_preset");

    result = await call(mcp, "photo_exit");
    expect(json(result).result.active).toBe(false);
    expect(json(result).result.undo_note).toContain("photo.open");
  });

  test("character and world commands are refused outside their screens", async () => {
    let result = await call(mcp, "cc_apply", { option: "XF", index: 3 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("appearance screen");
    // Leaving the creator is off unless allow_creator_leave (this host runs without it).
    result = await call(mcp, "cc_confirm");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("creator_leave_disabled");
    result = await call(mcp, "world_time_set", { hours: 20, minutes: 30 });
    expect(json(result).result.undo).toEqual({ method: "world.time.set", params: { total_seconds: 12 * 3600 } });
    result = await call(mcp, "world_time_set", { total_seconds: 12 * 3600 });
    expect(json(result).result.after_total_seconds).toBe(12 * 3600);
    result = await call(mcp, "world_pause", { paused: true });
    expect(json(result).result.undo).toEqual({ method: "world.pause", params: { paused: false } });
    // Pausing again changes nothing, so there is nothing to undo (RB-18: from the previous state).
    result = await call(mcp, "world_pause", { paused: true });
    expect(json(result).result.undo).toBeNull();
    result = await call(mcp, "world_pause", { paused: false });
    expect(json(result).result.undo).toEqual({ method: "world.pause", params: { paused: true } });
  });

  test("cc_apply works while the appearance screen is open", async () => {
    await setPhase(host, "character_menu");
    const status = await call(mcp, "game_status");
    expect(json(status).result.phase).toBe("character_menu");
    const look = await call(mcp, "player_appearance", { option: "XF" });
    expect(json(look).result.character_menu_open).toBe(true);
    let result = await call(mcp, "cc_apply", { option: "XF", index: 4 });
    expect(result.isError).toBeFalsy();
    expect(json(result).result.after).toBe(4);
    expect(json(result).result.undo.method).toBe("cc.apply");
    result = await call(mcp, "cc_apply", { option: "XF", index: 40 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("aren't valid");
    await setPhase(host, "gameplay");
  }, 20000);

  test("the kill switch stops everything, and later calls say so plainly", async () => {
    const result = await call(mcp, "bridge_kill");
    expect(json(result).result.killed).toBe(true);
    await sleep(800);
    const after = await call(mcp, "bridge_ping");
    expect(after.isError).toBe(true);
    expect(text(after)).toMatch(/isn't running|connection is gone|closed|switched off/);
  });
});

describe("RB-34: an idle disconnect gives the cursor back", () => {
  test("a client dropped for idleness releases the hidden cursor; an active one doesn't", async () => {
    const host = await startSelftestHost(["--allow-writes", "--idle-seconds", "1"], 30);
    try {
      let client = new BridgeClient(host.session, 3000);
      await client.connect();
      expect((await client.call("selftest.phase", { phase: "photo_mode" }, "t-idle-1")).ok).toBe(true);
      const hidden = await client.call("photo.hud.hide", {}, "t-idle-2");
      expect(hidden.ok && (hidden.result as { cursor_hidden: boolean }).cursor_hidden).toBe(true);
      // Still talking (under the 1 s limit): nothing released.
      await sleep(600);
      let status = await client.call("game.status", {}, "t-idle-3");
      expect((status.result as { cursor_hidden: boolean }).cursor_hidden).toBe(true);
      // Silent past the limit: the bridge drops the client and the next tick gives the cursor back.
      await sleep(1800);
      client.close();
      client = new BridgeClient(host.session, 3000);
      await client.connect();
      status = await client.call("game.status", {}, "t-idle-4");
      expect((status.result as { cursor_hidden: boolean }).cursor_hidden).toBe(false);
      client.close();
      expect(host.log.some((line) => line.includes("evt=bridge.client_idle"))).toBe(true);
      expect(host.log.some((line) => line.includes("evt=bridge.idle_cursor_released"))).toBe(true);
    } finally {
      await host.stop();
    }
  }, 30000);
});

describe("MCP server permissions, no bridge, and captures", () => {
  let synthetic: Synthetic;
  let mcp: Mcp;
  const root = tempDir("xfb-mcp-cap-");
  const noBridgeDir = tempDir("xfb-mcp-none-");
  beforeAll(async () => {
    synthetic = await openSyntheticWindow(3840, 1600);
    mcp = await startMcp(["--read-only", "--runtime-dir", noBridgeDir, "--capture-root", join(root, "captures"), "--capture-hwnd", String(synthetic.hwnd)]);
  });
  afterAll(async () => {
    await mcp?.close();
    synthetic?.close();
  });

  test("--read-only exposes only read and control tools", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.length).toBe(CATALOGUE.filter((c) => c.permission === "read" || c.permission === "control").length);
    expect(tools.some((t) => t.name === "photo_enter")).toBe(false);
    const refused = await call(mcp, "photo_enter");
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('no tool called "photo_enter"');
  });

  test("while a session runner holds its lock, bridge tools refuse plainly; captures still work", async () => {
    // A live process that isn't this one: the test runner's parent.
    writeFileSync(join(noBridgeDir, LOCK_FILE), JSON.stringify({ pid: process.ppid, script: "session-2", started_at: new Date().toISOString() }));
    try {
      const refused = await call(mcp, "game_status");
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("A scripted session (session-2");
      expect(text(refused)).toContain("session_running");
      const wait = await call(mcp, "game_wait", { phase: ["gameplay"], timeout_ms: 1000 });
      expect(text(wait)).toContain("session_running");
      const shot = await call(mcp, "capture_screenshot", { region: "eyes", name: "during-session" });
      expect(shot.isError).toBeFalsy();
      const kill = await call(mcp, "bridge_kill");
      expect(text(kill)).not.toContain("session_running");
      // A lock whose process has gone is stale and ignored.
      writeFileSync(join(noBridgeDir, LOCK_FILE), JSON.stringify({ pid: 0x3ffffff0, script: "old", started_at: "" }));
      expect(text(await call(mcp, "game_status"))).toContain("no_bridge");
    } finally {
      rmSync(join(noBridgeDir, LOCK_FILE), { force: true });
    }
    expect(text(await call(mcp, "game_status"))).toContain("no_bridge");
  });

  test("without a running bridge, game tools explain how to start it", async () => {
    const result = await call(mcp, "game_status");
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("The game bridge isn't running");
    expect(text(result)).toContain("no_bridge");
  });

  test("capture_screenshot returns a preview image at most 1280 px wide and the full-resolution path", async () => {
    const result = await call(mcp, "capture_screenshot", { region: "face", name: "mcp-face" });
    expect(result.isError).toBeFalsy();
    const image = result.content.find((c) => c.type === "image") as { data: string; mimeType: string } | undefined;
    expect(image?.mimeType).toBe("image/png");
    const preview = decodePng(new Uint8Array(Buffer.from(image!.data, "base64")));
    const record = json(result).result;
    // The face region is 0.5 x 0.62 window heights: 800 x 992 at 1600 px high, under the 1280 limit.
    expect(record.crop).toMatchObject({ width: 800, height: 992, region: "face" });
    expect(preview.width).toBe(record.view.width);
    expect(Math.max(preview.width, preview.height)).toBeLessThanOrEqual(1280);
    expect(existsSync(record.full.path)).toBe(true);

    const full = await call(mcp, "capture_screenshot", { name: "mcp-full" });
    const fullRecord = json(full).result;
    expect(fullRecord.source.window).toEqual({ width: 3840, height: 1600 });
    expect(fullRecord.view).toMatchObject({ width: 1280, height: 533 });
    expect(fullRecord.full).toMatchObject({ width: 3840, height: 1600 });

    const recropped = await call(mcp, "capture_recrop", { path: fullRecord.full.path, region: "eyes", name: "mcp-eyes" });
    expect(recropped.isError).toBeFalsy();
    expect(json(recropped).result.crop).toMatchObject({ width: 992, height: 448 });
  }, 30000);
});

describe("MCP permission flags", () => {
  test("--read-only and --allow are exclusive; an empty or missing --allow list is refused", () => {
    expect(parsePermissionFlags([])).toEqual({});
    expect(parsePermissionFlags(["--read-only"])).toEqual({ allow: ["read", "control"] });
    for (const args of [["--read-only", "--allow", "read"], ["--allow", "read", "--read-only"], ["--allow", ""], ["--allow", " , "], ["--allow"], ["--allow", "--no-inline-images"], ["--allow", "read", "--allow", "write-world"], ["--allow", "read,constructor"], ["--allow", "read,write-everything"]]) {
      expect("error" in parsePermissionFlags(args), args.join(" ")).toBe(true);
    }
  });

  test("a partial --allow list exposes exactly those classes, plus the kill switch", async () => {
    expect(parsePermissionFlags(["--allow", "read, write-photo"])).toEqual({ allow: ["read", "write-photo", "control"] });
    const mcp = await startMcp(["--allow", "read,write-photo", "--runtime-dir", tempDir("xfb-mcp-partial-")]);
    try {
      const { tools } = await mcp.client.listTools();
      const expected = CATALOGUE.filter((c) => ["read", "write-photo", "control"].includes(c.permission)).map((c) => toolName(c.name));
      expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
      expect(tools.some((t) => t.name === "world_time_set" || t.name === "cc_apply")).toBe(false);
      expect(tools.some((t) => t.name === "bridge_kill")).toBe(true);
      const refused = await call(mcp, "world_pause", { paused: true });
      expect(refused.isError).toBe(true);
    } finally {
      await mcp.close();
    }
  }, 20000);

  test("the server refuses to start on conflicting flags, in plain words", () => {
    const run = spawnSync(process.execPath, [join(projectDir, "tools", "mcp-server.ts"), "--read-only", "--allow", "read,write-photo"], { encoding: "utf8", timeout: 15000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("not both");
    const empty = spawnSync(process.execPath, [join(projectDir, "tools", "mcp-server.ts"), "--allow", ""], { encoding: "utf8", timeout: 15000 });
    expect(empty.status).toBe(2);
  }, 30000);
});

describe("session runner lock", () => {
  test("one runner at a time; a stale lock is taken over; release removes only its own lock", () => {
    const dir = tempDir("xfb-lock-");
    const first = acquireSessionLock(dir, "session-2");
    expect("release" in first).toBe(true);
    expect(readSessionLock(dir)?.pid).toBe(process.pid);
    (first as { release: () => void }).release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);

    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, script: "other", started_at: "" }));
    const blocked = acquireSessionLock(dir, "session-3");
    expect("heldBy" in blocked && blocked.heldBy.script).toBe("other");

    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 0x3ffffff0, script: "gone", started_at: "" }));
    expect(readSessionLock(dir)).toBeNull();
    const taken = acquireSessionLock(dir, "session-3");
    expect("release" in taken).toBe(true);
    expect(readSessionLock(dir)?.script).toBe("session-3");
    (taken as { release: () => void }).release();
  });

  test("RB-30: a reused PID doesn't keep a lock alive; the lock names its runner's start time", () => {
    const dir = tempDir("xfb-lock-pid-");
    const parentStarted = processStartTime(process.ppid);
    expect(typeof parentStarted === "string" && /^\d+$/.test(parentStarted)).toBe(true);
    expect(processStartTime(0x3ffffff0)).toBeNull();
    // Same PID, different start time: another process now has that PID.
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, script: "reused", started_at: "", process_started: "1" }));
    expect(readSessionLock(dir)).toBeNull();
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.ppid, script: "live", started_at: "", process_started: parentStarted }));
    expect(readSessionLock(dir)?.script).toBe("live");
    rmSync(join(dir, LOCK_FILE), { force: true });
    const mine = acquireSessionLock(dir, "session-2");
    expect(readSessionLock(dir)?.process_started).toBe(processStartTime(process.pid) as string);
    (mine as { release: () => void }).release();
    const message = sessionRunningMessage({ pid: 1, script: "s", started_at: "" }, lockPath(dir));
    expect(message).toContain(lockPath(dir));
    expect(message).toContain("KILL file");
  });

  test("RB-33: putting a moved-aside lock back never replaces a lock a third runner wrote meanwhile", () => {
    const dir = tempDir("xfb-lock-back-");
    const path = lockPath(dir);
    const aside = `${path}.stale-test`;
    writeFileSync(aside, "second runner");
    writeFileSync(path, "third runner");
    expect(putBackLock(aside, path)).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("third runner");
    expect(existsSync(aside)).toBe(false);
    rmSync(path, { force: true });
    writeFileSync(aside, "second runner");
    expect(putBackLock(aside, path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("second runner");
    expect(existsSync(aside)).toBe(false);
  });

  test("RB-30: bridge.kill falls back to the KILL file while another client holds the pipe", async () => {
    const dir = tempDir("xfb-kill-file-");
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\none`, sid: "s", token: "t" }));
    const api = new CommandApi({
      runtimeDir: dir,
      auditDir: join(dir, "logs"),
      transport: async () => {
        throw new PipeConnectError("pipe busy (another client is connected)", "busy");
      },
    });
    const outcome = await api.run("bridge.kill");
    expect(outcome.ok).toBe(true);
    expect(existsSync(join(dir, "KILL"))).toBe(true);
    expect(JSON.stringify(outcome)).toContain("kill_file");
    const other = await api.run("game.status");
    expect(other.ok).toBe(false); // only the kill switch falls back
    api.close();
  });
});
