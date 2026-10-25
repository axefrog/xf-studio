import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { findCommand } from "../api/catalogue.ts";
import { plainBridgeError } from "../api/errors.ts";
import { validate } from "../api/schema.ts";
import { packageScripts } from "../redscript-natives.ts";
import { projectDir } from "./helpers.ts";

const read = (...path: string[]) => readFileSync(join(projectDir, ...path), "utf8");
const require = createRequire(import.meta.url);
const runLua = (code: string): string => {
  const { lua, lauxlib, lualib, to_luastring } = require("fengari");
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  try {
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) return `load: ${lua.lua_tojsstring(L, -1)}`;
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `run: ${lua.lua_tojsstring(L, -1)}`;
    return lua.lua_tojsstring(L, -1);
  } finally { lua.lua_close(L); }
};

test("bridge-emitted target IDs pass every target-bearing undo schema verbatim", () => {
  for (const target of ["dynamic: '10230711'", "static: '18446744073709551615'"]) {
    for (const [method, params] of [["vehicle.set", { target, engine: false, lights: false }], ["audio.radio", { target, station: 1, on: false }],
      ["world.door", { target, open: false }], ["audio.play", { event: "fixture", on: target }]] as const)
      expect(validate(findCommand(method)!.input, params), method).toEqual([]);
  }
  for (const target of ["dynamic: '-1'", "dynamic: '1';x", "static: ''"])
    expect(validate(findCommand("vehicle.set")!.input, { target, engine: true }).length).toBeGreaterThan(0);
});

test("save refusal headline names only the actual holders, including nested descriptions", () => {
  const result = plainBridgeError("bridge_effects_active", "the bridge still holds something that a save would keep (DM entities (1)); nothing was saved. Release them.", "game.save");
  expect(result.message).toContain("DM entities (1)");
  for (const other of ["crouch", "outfit", "weather", "cyberware"]) expect(result.message).not.toContain(other);
});

test("normal packages omit every F/U recording seam; autonomous packages retain their owners", () => {
  const normal = packageScripts(projectDir, "writes", false).map(s => s.text).join("\n");
  expect(normal).not.toContain("XFRecordingUi");
  expect(normal).not.toContain("XFRecordingTap");
  expect(normal).not.toContain("xfbRecordedFace");
  const testSources = packageScripts(projectDir, "writes", true).map(s => s.text).join("\n");
  expect(testSources).toContain("XFRecordingUi");
  expect(testSources).toContain("face.bridge_resend");
  expect(validate(findCommand("test.record.start")!.input, { channels: ["v", "actors", "camera", "subtitles", "voice", "face", "ui"] })).toEqual([]);
});

test("CET U adapter uses drawn geometry, throttles per surface and reports unavailable geometry invalid", () => {
  const source = JSON.stringify(read("cet", "xf_runtime_bridge", "test-input.lua"));
  const result = runLua(`
    local enabled, count, observed = false, 0, nil
    json = { encode = function(body) observed = body; return '{}' end }
    Game = { XFBridge_RecordIdentity = function(channel) assert(channel == 'ui'); return enabled and 'r1.w1.c1' or '' end,
      XFBridge_Record = function(channel, body) count = count + 1; return true end }
    ImGui = { GetWindowPos = function() return { x = 20, y = 30 } end, GetWindowSize = function() return 100, 80 end }
    local adapter = assert(load(${source}))()
    adapter.ui('cet_line', { drawn = true, rect = adapter.windowRect() }); assert(count == 0)
    enabled = true
    adapter.ui('cet_line', { drawn = true, texts = { 'actual line' }, rect = adapter.windowRect() })
    assert(count == 1 and observed.valid and observed.rect[3] == 120 and observed.rect[4] == 110)
    assert(observed.texts[1] == 'actual line')
    adapter.ui('cet_line', { drawn = true }); assert(count == 1)
    adapter.ui('cet_window', { drawn = true, save_button_drawn = true }); assert(count == 2 and not observed.valid)
    adapter.advance(0.11)
    adapter.ui('cet_window', { drawn = false, save_button_drawn = false }); assert(count == 3 and observed.valid)
    return 'ok'
  `);
  expect(result).toBe("ok");
});
