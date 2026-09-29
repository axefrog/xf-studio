// The command catalogue is the single source of truth: these checks keep every frontend and the
// native plugin in step with it. No game and no bridge host involved.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGUE,
  findCommand,
  loadClientTimeoutMs,
  PERMISSIONS,
  SAVE_LIST_WAIT_MS,
  SAVE_UNLOCK_WAIT_MS,
  saveClientTimeoutMs,
  SERVER_STEP_MS,
  toolName,
} from "../api/catalogue.ts";
import type { BridgeResponse } from "../bridge-lib.ts";
import { verticalOnlyStep } from "../api/framing.ts";
import { CommandApi } from "../api/command-api.ts";
import { CAMERA_PRESETS, expandCamera } from "../api/presets.ts";
import { validate, type JsonSchema } from "../api/schema.ts";
import { toolsFor } from "../mcp/server.ts";
import { projectDir, tempDir } from "./helpers.ts";

const pluginSource = ["native/src/plugin/GameHandlers.cpp", "native/src/plugin/Handlers060.cpp", "native/src/core/Dispatcher.cpp", "native/src/core/Bridge.cpp", "native/src/core/Events.cpp"]
  .map((file) => readFileSync(join(projectDir, file), "utf8"))
  .join("\n");
const selftestSource = ["native/src/selftest/Main.cpp", "native/src/selftest/Sim060.cpp", "native/src/core/Events.cpp"]
  .map((file) => readFileSync(join(projectDir, file), "utf8"))
  .join("\n");

/** The access class a method is registered with in C++ source, as the tools name it ("write-photo"). */
function nativeAccess(source: string, method: string): string | null {
  const name = method.replaceAll(".", "\\.");
  const match =
    new RegExp(`(?:WriteMethod|MarkedWrite|marked)\\("${name}",\\s*Access::(\\w+)`).exec(source) ??
    new RegExp(`simWrite\\("${name}",\\s*xfb::Access::(\\w+)`).exec(source) ??
    new RegExp(`\\{"${name}",\\s*(?:xfb::)?Access::(\\w+)`).exec(source);
  return match ? match[1].replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() : null;
}

function walk(schema: JsonSchema, visit: (schema: JsonSchema, path: string) => void, path = "input") {
  visit(schema, path);
  for (const [key, child] of Object.entries(schema.properties ?? {})) walk(child, visit, `${path}.${key}`);
  if (schema.items) walk(schema.items, visit, `${path}[]`);
}

describe("catalogue", () => {
  test("names are unique, dotted, and map to valid MCP tool names", () => {
    const names = CATALOGUE.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const tools = CATALOGUE.map(toolName);
    expect(new Set(tools).size).toBe(tools.length);
    for (const command of CATALOGUE) {
      expect(command.name).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      expect(toolName(command)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(findCommand(command.name)).toBe(command);
      expect(findCommand(toolName(command))).toBe(command);
    }
  });

  test("every command has plain text, a known permission class and exactly one handler", () => {
    for (const command of CATALOGUE) {
      expect(command.title.length).toBeGreaterThan(3);
      expect(command.description.length).toBeGreaterThan(20);
      expect(PERMISSIONS[command.permission]).toBeDefined();
      expect(Boolean(command.bridge) !== Boolean(command.local)).toBe(true);
      // User-facing text stays free of developer jargon.
      expect(command.description).not.toMatch(/RTTI|redscript|nlohmann|stack trace|\bnull\b/i);
    }
  });

  test("every write and control command says how to undo it", () => {
    for (const command of CATALOGUE.filter((c) => c.permission !== "read")) {
      expect(command.undo, command.name).toBeTruthy();
    }
  });

  test("input schemas are closed objects with described fields", () => {
    for (const command of CATALOGUE) {
      expect(command.input.type).toBe("object");
      walk(command.input, (schema, path) => {
        if (schema.type === "object") expect(schema.additionalProperties, `${command.name} ${path}`).toBe(false);
        if (path !== "input") expect(schema.description, `${command.name} ${path}`).toBeTruthy();
      });
      expect(validate(command.input, { not_an_option: 1 }).length, command.name).toBeGreaterThan(0);
    }
  });

  test("every bridge command exists in the plugin and the self-test host with the matching access class", () => {
    for (const command of CATALOGUE.filter((c) => c.bridge)) {
      const method = command.bridge!.method;
      // The native access classes are the same as the tools' permission classes (RB-26).
      const expected = command.permission;
      expect(nativeAccess(pluginSource, method), `plugin ${method}`).toBe(expected);
      expect(nativeAccess(selftestSource, method) ?? nativeAccess(pluginSource, method), `selftest ${method}`).toBe(expected);
    }
  });

  test("the MCP tool list equals the catalogue, in order, with permissions as data", () => {
    const tools = toolsFor(CATALOGUE);
    expect(tools.map((t) => t.name)).toEqual(CATALOGUE.map(toolName));
    for (const [i, tool] of tools.entries()) {
      const command = CATALOGUE[i];
      expect(tool._meta).toEqual({ "xf/command": command.name, "xf/permission": command.permission });
      expect(tool.annotations?.readOnlyHint).toBe(command.permission === "read");
      expect(tool.inputSchema).toBe(command.input as never);
      expect(tool.description).toContain(PERMISSIONS[command.permission].label);
    }
    const readOnly = toolsFor(CATALOGUE, ["read", "control"]);
    expect(readOnly.every((t) => ["read", "control"].includes(String(t._meta?.["xf/permission"])))).toBe(true);
    expect(readOnly.some((t) => t.name === "bridge_kill")).toBe(true);
    expect(readOnly.some((t) => t.name === "cc_apply")).toBe(false);
  });

  test("input checks accept own schema keys only: inherited names such as constructor are unknown", () => {
    const camera = findCommand("photo.camera.set")!;
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      const input = JSON.parse(`{"${key}": 1, "fov": 20}`);
      expect(validate(camera.input, input), key).toContain(`"${key}" is not a known option.`);
    }
    const required: JsonSchema = { type: "object", properties: { toString: { type: "string" as const } }, required: ["toString"], additionalProperties: false };
    expect(validate(required, {})).toEqual(['"toString" is required.']);
    expect(validate(required, { toString: "x" })).toEqual([]);
  });

  test("camera presets expand into valid photo.camera.set input", () => {
    const camera = findCommand("photo.camera.set")!;
    for (const name of Object.keys(CAMERA_PRESETS)) {
      expect(validate(camera.input, { preset: name })).toEqual([]);
      const expanded = expandCamera({ preset: name });
      const { preset: _p, ...plain } = expanded;
      expect(validate(camera.input, plain), name).toEqual([]);
    }
    expect(expandCamera({ preset: "face", fov: 20, subject: { up_down: 1 } })).toEqual({ fov: 20, subject: { yaw: 180, up_down: 1 } });
    expect(() => expandCamera({ preset: "open-defaults", fov: 20 })).toThrow();
  });
});

describe("command API without a game", () => {
  const api = new CommandApi({ runtimeDir: tempDir("xfb-nobridge-"), captureRoot: join(tempDir("xfb-cap-"), "captures") });

  test("unknown command and bad input are refused in plain words before anything is sent", async () => {
    let outcome = await api.run("system.exec", {});
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("unknown_command");
    outcome = await api.run("photo.camera.set", { fov: "wide" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("bad_input");
      expect(outcome.error.message).toContain("must be a number");
    }
    outcome = await api.run("cc_apply", { option: "XF" });
    expect(!outcome.ok && outcome.error.code).toBe("bad_input");
    expect(!outcome.ok && outcome.error.message).toContain("Give index");
  });

  test("with no bridge session every game command answers no_bridge with a next step", async () => {
    const outcome = await api.run("game.status");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("no_bridge");
      expect(outcome.error.message).toMatch(/Start the game/);
    }
  });
});

describe("bridge 0.4.1 review fixes (tools side)", () => {
  test("RB-55: the client's save and load waits are derived from the server's worst case, with the server's own constants", () => {
    const writes = readFileSync(join(projectDir, "native/src/core/Writes.hpp"), "utf8");
    const queue = readFileSync(join(projectDir, "native/src/core/GameThreadQueue.hpp"), "utf8");
    const config = readFileSync(join(projectDir, "native/src/core/Config.hpp"), "utf8");
    expect(writes).toContain(`kSaveUnlockWaitMs = ${SAVE_UNLOCK_WAIT_MS};`);
    expect(writes).toContain(`kSaveListWaitMs = ${SAVE_LIST_WAIT_MS};`);
    const grace = Number(/kDefaultRunningGrace\{(\d+)\}/.exec(queue)?.[1]);
    const timeout = Number(/requestTimeoutMs\s*=\s*(\d+)/.exec(config)?.[1]);
    expect(SERVER_STEP_MS).toBe(timeout + grace);
    // game.save: timeout + unlock wait + 5 steps; game.load: list wait + 3 steps; each plus slack.
    expect(saveClientTimeoutMs(20000)).toBeGreaterThanOrEqual(20000 + SAVE_UNLOCK_WAIT_MS + 5 * SERVER_STEP_MS);
    expect(loadClientTimeoutMs()).toBeGreaterThanOrEqual(SAVE_LIST_WAIT_MS + 3 * SERVER_STEP_MS);
    expect(findCommand("game.save")!.bridge!.timeoutMs!({ timeout_ms: 60000 })).toBe(saveClientTimeoutMs(60000));
    expect(findCommand("game.load")!.bridge!.timeoutMs!({})).toBe(loadClientTimeoutMs());
  });

  test("RB-56: game.load's schema requires discard_unsaved", () => {
    const load = findCommand("game.load")!;
    expect(validate(load.input, { latest: true }).join(" ")).toContain("discard_unsaved");
    expect(validate(load.input, { latest: true, discard_unsaved: true })).toEqual([]);
  });

  test("RB-61: the vertical-only step refuses a vanishing or non-finite response instead of dividing by it", () => {
    expect(verticalOnlyStep({ x: 0, y: 0.2 }, 0, 0.1)).toBeCloseTo(0.5);
    expect(verticalOnlyStep({ x: 0, y: 1e-7 }, 0, 0.1)).toBeNull();
    expect(verticalOnlyStep({ x: 0, y: 0 }, 0, 0.1)).toBeNull();
    expect(verticalOnlyStep({ x: Number.NaN, y: 0.2 }, 0, 0.1)).toBeNull();
    expect(verticalOnlyStep({ x: 0, y: 0.2 }, Number.POSITIVE_INFINITY, 0.1)).toBeNull();
  });

  test("RB-62: the idle timer never closes the pipe under a call still in flight, and restarts after a rejected call", async () => {
    const dir = tempDir("xfb-rb62-");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, sid: "s1", pid: process.pid, pipe: "unused", token: "t" }));
    let closes = 0;
    const pending: ((r: BridgeResponse) => void)[] = [];
    const api = new CommandApi({
      runtimeDir: dir,
      auditDir: tempDir("xfb-rb62-audit-"),
      idleCloseMs: 40,
      transport: async () => ({
        call: (method) =>
          method === "throws"
            ? Promise.reject(new Error("pipe broke"))
            : method === "slow"
              ? new Promise<BridgeResponse>((resolve) => pending.push(resolve))
              : Promise.resolve({ v: 1, id: 1, cid: "c", ok: true, result: {} }),
        close: () => {
          closes++;
        },
      }),
    });
    const slow = api.callBridge("slow", {}, "c1");
    await Bun.sleep(5);
    await api.callBridge("fast", {}, "c2"); // finishes while the slow call still waits
    await Bun.sleep(120);
    expect(closes).toBe(0); // the fast call's end didn't start the timer under the slow one
    pending[0]!({ v: 1, id: 1, cid: "c1", ok: true, result: {} });
    await slow;
    await Bun.sleep(120);
    expect(closes).toBe(1); // idle after the last call
    const rejected = await api.callBridge("throws", {}, "c3");
    expect(rejected.ok).toBe(false);
    await Bun.sleep(120);
    expect(closes).toBeGreaterThanOrEqual(2); // a rejected call doesn't leave a connection open for good
    api.close();
  });
});
