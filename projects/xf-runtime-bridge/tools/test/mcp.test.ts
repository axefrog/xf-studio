// The stdio MCP server end to end: the official SDK client starts tools/mcp-server.ts, which talks
// to build/Release/xfb_selftest.exe (the real bridge core and pipe with a simulated game) and
// captures a synthetic window. Proves the frontend, the command API and the pipe together;
// proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CATALOGUE, toolName } from "../api/catalogue.ts";
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

    result = await call(mcp, "photo_enter");
    expect(result.isError).toBeFalsy();
    expect(json(result).result.undo).toEqual({ method: "photo.exit", params: {} });
    expect(json(result).undo).toBe("photo.exit.");

    result = await call(mcp, "photo_camera_set", { preset: "face", subject: { up_down: 0.1 } });
    expect(result.isError).toBeFalsy();
    const applied = json(result).result.applied as { name: string; value: number }[];
    expect(applied.map((a) => a.name).sort()).toEqual(["fov", "subject.up_down", "subject.yaw"]);
    expect(json(result).result.undo.method).toBe("photo.camera.set");

    result = await call(mcp, "photo_camera_set", { fov: 500 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("at most 180");

    result = await call(mcp, "photo_light_set", { light: 2, brightness: 40, hue: 200 });
    expect(json(result).result.undo.params.light).toBe(2);
    result = await call(mcp, "photo_hud_hide", {});
    expect(json(result).result.undo).toEqual({ method: "photo.hud.hide", params: { hidden: false } });
    result = await call(mcp, "photo_expression_set", { faceId: 9 });
    expect(json(result).result.after).toBe(9);

    result = await call(mcp, "photo_exit");
    expect(json(result).result.active).toBe(false);
  });

  test("character and world commands are refused outside their screens", async () => {
    let result = await call(mcp, "cc_apply", { option: "XF", index: 3 });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("appearance screen");
    result = await call(mcp, "world_time_set", { hours: 20, minutes: 30 });
    expect(json(result).result.undo).toEqual({ method: "world.time.set", params: { total_seconds: 12 * 3600 } });
    result = await call(mcp, "world_time_set", { total_seconds: 12 * 3600 });
    expect(json(result).result.after_total_seconds).toBe(12 * 3600);
    result = await call(mcp, "world_pause", { paused: true });
    expect(json(result).result.undo).toEqual({ method: "world.pause", params: { paused: false } });
    await call(mcp, "world_pause", { paused: false });
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

describe("MCP server permissions, no bridge, and captures", () => {
  let synthetic: Synthetic;
  let mcp: Mcp;
  const root = tempDir("xfb-mcp-cap-");
  beforeAll(async () => {
    synthetic = await openSyntheticWindow(3840, 1600);
    mcp = await startMcp(["--read-only", "--runtime-dir", tempDir("xfb-mcp-none-"), "--capture-root", join(root, "captures"), "--capture-hwnd", String(synthetic.hwnd)]);
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
    expect(json(recropped).result.crop).toMatchObject({ width: 800, height: 320 });
  }, 30000);
});
