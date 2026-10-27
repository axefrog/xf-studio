// Offline consumer-route checks. Lua executes the actual panel/init/module; host tests use
// the native owner with simulated adapters. Neither establishes engine delivery or a real save.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { findCommand } from "../api/catalogue.ts";
import { PLUGIN_DIR, stageVariant, VARIANTS } from "../packaging.ts";
import { HOOK_TIMEOUT_MS, projectDir, selftestExe, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring } = require("fengari");
function runLua(body: string): string {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  try {
    const code = `${luaFixture}\n${body}`;
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK)
      throw new Error(lua.lua_tojsstring(L, -1));
    return lua.lua_tojsstring(L, -1);
  } finally { lua.lua_close(L); }
}

const luaFixture = `
  handlers, DECODE, encoded, stages = {}, {}, {}, {}
  local clock, frame, takes, saves, physical, visible, expanded = 100, 0, 0, 0, false, true, true
  local armed, gates, valid, queueAllowed, missingModule = true, true, true, true, false
  local drawn, y = {}, 0
  local any = setmetatable({}, { __index = function(_, k) return k end })
  ImGuiCol, ImGuiStyleVar, ImGuiWindowFlags, ImGuiCond = any, any, any, any
  ImGuiInputTextFlags = { EnterReturnsTrue = 32, ReadOnly = 16384 }
  bit32 = { bor = function() return 0 end }; unpack = table.unpack
  ImGui = setmetatable({
    BeginChild = function() return true end, EndChild = function() end,
    Begin = function() return expanded end, GetFontSize = function() return 14 end,
    GetTime = function() return clock end, GetFrameCount = function() return frame end,
    GetCursorPosY = function() return y end, SetCursorPosY = function(v) y = v end,
    GetCursorPosX = function() return 26 end, GetWindowPos = function() return 100, 100 end,
    GetWindowSize = function() return 300, 200 end, GetCursorScreenPos = function() return 100, 100 end,
    CalcTextSize = function(s) return #s * 7, 14 end, GetTextLineHeight = function() return 14 end,
    Text = function(s) drawn[#drawn+1] = tostring(s); y = y + 14 end,
    TextColored = function(r,g,b,a,s) drawn[#drawn+1] = tostring(s); y = y + 14 end,
    TextDisabled = function(s) y = y + 14 end, TextWrapped = function(s) y = y + 14 end,
    Button = function(label) y = y + 22; return label == "Save anyway" and physical end,
    IsItemVisible = function() return visible end, IsItemHovered = function() return false end,
    GetItemRectMin = function() return 100, 100 end, GetItemRectMax = function() return 200, 122 end,
    InputTextMultiline = function(label, text) return text, false end,
  }, { __index = function() return function() return false end end })
  registerForEvent = function(name, fn) handlers[name] = fn end
  registerHotkey = function() end
  spdlog = { info = function() end, warning = function() end, debug = function() end, error = function() end }
  GetVersion = function() return "1.37.1" end
  json = { encode = function(v) encoded[#encoded+1] = v; return tostring(#encoded) end,
           decode = function(s) return DECODE[s] end }
  package.preload.panel = function() return (function() ${read("cet", "xf_runtime_bridge", "panel.lua")} end)() end
  package.preload.theme = function() error("no theme") end
  package.preload.canvas = function() return (function() ${read("cet", "xf_runtime_bridge", "canvas.lua")} end)() end
  package.preload["test-input"] = function() if missingModule then error("not packaged") end; return (function() ${read("cet", "xf_runtime_bridge", "test-input.lua")} end)() end
  DECODE.INFO = { plugin_version = "0.8.13", answer_keys = {},
    bridge = { enabled = true, listening = true, killed = false, allow_writes = true },
    status = { label = "Connected", tone = "ok" },
    save_lock = { save_anyway = true, running = false, refusals = 1, last_seq = 0 } }
  DECODE.MSGS = { messages = {} }; DECODE.SAVED = { started = true }
  Game = setmetatable({
    XFBridge_Info = function() return "INFO" end, XFBridge_Hud = function() return "" end,
    XFBridge_Messages = function() return "MSGS" end,
    XFBridge_TestUiTake = function(raw)
      takes = takes + 1
      if not armed or not gates or not valid or not DECODE.INFO.save_lock.save_anyway then return "NONE" end
      local draw = encoded[tonumber(raw)]
      assert(draw.visible and draw.settled and draw.frame == frame and #draw.rect == 4)
      armed = false; DECODE.TOKEN = { request_id = 7, run_id = "fixture" }; return "TOKEN"
    end,
    XFBridge_TestUiReport = function(raw)
      local r = encoded[tonumber(raw)]
      stages[#stages+1] = r.stage or "activated"
      DECODE.REPORT = { accepted = gates and valid and (r.stage ~= "dequeued" or queueAllowed) }; return "REPORT"
    end,
    XFBridge_SaveAnyway = function(source) saves = saves + 1; assert(source == "cet-panel" or source == "cet-panel-test:7"); return "SAVED" end,
  }, { __index = function() return function() return "" end end })
  local function init() local mod = (function() ${read("cet", "xf_runtime_bridge", "init.lua")} end)(); handlers.onInit(); handlers.onUpdate(1) end
  local function draw() frame = frame + 1; y = 0; drawn = {}; handlers.onDraw() end
  local function open() handlers.onOverlayOpen(); draw() end
  local function result() return takes .. "," .. saves .. "," .. table.concat(stages, ":") end
`;

describe("autonomous CET Save anyway rendered activation", () => {
  test("one drawn token queues once, drains through onUpdate and the existing native; physical overlap consumes once", () => {
    for (const click of [false, true]) {
      const out = runLua(`init(); physical = ${click}; open(); physical = false; draw(); handlers.onUpdate(0); draw(); return result()`);
      expect(out).toMatch(/^3,1,activated:queued:dequeued:native$/);
    }
  });
  test("closed, collapsed, hidden and missing ImGui visibility APIs cannot consume", () => {
    for (const setup of ["", "handlers.onOverlayOpen(); expanded = false", "handlers.onOverlayOpen(); visible = false", "handlers.onOverlayOpen(); ImGui.IsItemVisible = false"]) {
      expect(runLua(`init(); ${setup}; draw(); handlers.onUpdate(0); return result()`)).toBe("0,0,");
    }
  });
  test("unoffered, expired and gates-off fixtures cannot queue a save", () => {
    for (const setup of ["DECODE.INFO.save_lock.save_anyway = false", "valid = false", "gates = false"]) {
      expect(runLua(`init(); ${setup}; open(); handlers.onUpdate(0); return tostring(saves) .. ':' .. table.concat(stages, ':')`)).toBe("0:");
    }
  });
  test("the actual 0.4 s settling guard blocks both synthetic and physical activation", () => {
    expect(runLua(`init(); armed = false; open()
      -- Drive the real layout guard on the state used by panel.body by changing the drawn question.
      DECODE.MSGS = { messages = {}, pending_ask = { id = 8, text = "Question?", choices = {"Yes"} } }
      handlers.onUpdate(1); physical = true; armed = true; clock = 100.1; draw(); handlers.onUpdate(0)
      local before = saves; physical = false; clock = 100.6; draw(); handlers.onUpdate(0)
      return before .. ',' .. saves`)).toBe("0,1");
  });
  test("stop/expiry between rendered activation and onUpdate refuses the test action", () => {
    expect(runLua(`init(); open(); queueAllowed = false; handlers.onUpdate(0); return result()`)).toBe("1,0,activated:queued:dequeued");
  });
  test("lost activation receipt never queues, and a missing module preserves the physical button path", () => {
    expect(runLua(`init(); local report = Game.XFBridge_TestUiReport; Game.XFBridge_TestUiReport = function() return 'NONE' end; open(); handlers.onUpdate(0); return tostring(saves)`)).toBe("0");
    expect(runLua(`missingModule = true; init(); physical = true; open(); physical = false; handlers.onUpdate(0); return result()`)).toBe("0,1,");
  });
});

describe("autonomous package isolation", () => {
  test("normal variants omit test module/declarations; only explicit writes candidate accepts a test DLL", () => {
    const work = tempDir("xfb-input-pack-");
    const dll = join(work, "XFRuntimeBridge.dll");
    writeFileSync(join(work, "xfb_companion_probe.exe"), "stand-in companion");
    writeFileSync(dll, "normal DLL");
    const stage = (variant: typeof VARIANTS[number], autonomousTests = false) => stageVariant({ projectDir, dll, variant, autonomousTests, stageDir: join(work, variant), version: "0.0.0", commit: "0".repeat(40) });
    for (const variant of VARIANTS) {
      const m = stage(variant);
      expect(m.autonomous_test_hooks).toBe(false);
      expect(m.files.some(f => /test-input|TestUi|XFRuntimeBridgeInput|XFRuntimeBridgeRecording/.test(f.path))).toBe(false);
    }
    expect(() => stage("writes", true)).toThrow("require");
    writeFileSync(dll, "XFB_AUTONOMOUS_TEST_HOOKS=1");
    for (const variant of VARIANTS) expect(() => stage(variant)).toThrow("explicit autonomous");
    expect(() => stage("diagnostic", true)).toThrow();
    const m = stage("writes", true);
    expect(m.native_count).toBe(38);
    expect(m.files.map(f => f.path)).toContain(`${PLUGIN_DIR}/Scripts/XFRuntimeBridgeRecording.reds`);
    expect(m.files.map(f => f.path)).toContain(`${PLUGIN_DIR}/Scripts/XFRuntimeBridgeTestUi.reds`);
    expect(m.files.some(f => f.path.endsWith("/test-input.lua"))).toBe(true);
  }, 30_000);
});

const candidate = readFileSync(selftestExe).includes(Buffer.from("XFB_AUTONOMOUS_TEST_HOOKS=1"));
describe.skipIf(!candidate)("input consumer routes through the native simulated host", () => {
  let host: Host, api: CommandApi;
  const call = async (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const r = await api.callBridge(method, params, "input-test");
    if (!r.ok) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  const command = async (name: string, input: Record<string, unknown> = {}): Promise<any> => {
    const r = await api.run(name, input);
    if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
    return r.result;
  };
  const terminal = async () => {
    for (let i = 0; i < 60; i++) {
      const s = await command("test.input.state");
      if (s.last) return s.last;
      await sleep(50);
    }
    throw new Error("input result missing");
  };
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--allow-test-hooks", "--write-classes", "player,npc,photo,save,act"]);
    api = new CommandApi({ runtimeDir: host.dir, auditDir: tempDir("xfb-input-audit-") });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => { await api?.close(); await host?.stop(); });
  test("XF select-only is not a commit; later apply requires matching npc.choice", async () => {
    const actor = await command("npc.spawn", { cast: "woman_corpo", ahead_m: 3 });
    await sleep(400);
    await command("npc.choices", { who: actor.who, choices: ["First", "Second"], max_s: 30 });
    await command("test.input.arm", { run_id: "xf", context: "gameplay" });
    const s = await command("test.input.state");
    const p = { run_id: "xf", hub: s.xf_hub.id, generation: s.xf_hub.generation, index: 1 };
    await command("test.npc.choice", { ...p, commit: false });
    expect(await terminal()).toMatchObject({ reason: "selected", committed: false });
    await command("test.npc.choice", p);
    for (let i = 0; i < 60; i++) {
      const last = (await command("test.input.state")).last;
      if (last?.reason === "committed") { expect(last.npc_choice).toMatchObject({ hub: p.hub, index: 1, label: "Second" }); return; }
      await sleep(50);
    }
    throw new Error("no matching native owner npc.choice");
  });
  test("event and callback comparison report separate coverage; real confirmation read-back", async () => {
    await call("selftest.phase", { phase: "photo_mode" });
    for (const route of ["event", "callback"]) {
      await call("selftest.input", { modal: route === "event", changed: true, new_controller: true });
      await command("test.input.arm", { run_id: route, context: "photo_mode" });
      const s = await command("test.input.state");
      await command("test.photo.exit_attempt", { run_id: route, controller_generation: s.photo.generation, route });
      expect(await terminal()).toMatchObject({ reason: "callback", held: route === "event", confirmation: route === "callback", coverage: route === "event" ? "native_exit_event" : "consumer_callback" });
    }
    await call("selftest.input", { cancel_confirmation: true });
    const events = (await call("session.events", { since: 0, limit: 500, kinds: ["input.photo.entry", "input.photo.held", "input.photo.callback", "input.photo.confirmation"] })).events;
    expect(events.filter((e: any) => e.kind === "input.photo.held")).toHaveLength(1);
    expect(events.filter((e: any) => e.kind === "input.photo.confirmation").map((e: any) => e.data.confirmation)).toEqual([true, false]);
    expect(events.findIndex((e: any) => e.kind === "input.photo.entry")).toBeLessThan(events.findIndex((e: any) => e.kind === "input.photo.callback"));
  });
  test("disconnect disarms the run before a later connection can use it", async () => {
    api.close();
    await sleep(150);
    expect((await command("test.input.state")).run_id).toBe("");
  });
  test("the simulated host cannot commission retail pulses or native quest choices", async () => {
    await call("selftest.phase", { phase: "gameplay" });
    await command("test.input.arm", { run_id: "uncommissioned", context: "gameplay" });
    expect((await command("test.input.state")).engine_input).toMatchObject({ available: false, coverage: "simulation_only" });
    for (const [method, params] of [
      ["test.input.pulse", { run_id: "uncommissioned", control: "confirm", duration_ms: 30 }],
      ["player.choice.select", { run_id: "uncommissioned", hub: 20, generation: 1, index: 1 }],
    ] as const) {
      const result = await api.callBridge(method, params, "native-refusal");
      expect(result).toMatchObject({ ok: false, error: { code: "input_unavailable" } });
    }
    const state = await command("test.input.state");
    expect(state.held).toBe("");
    expect(state.pending).toBeNull();
  });
  test("allow_test_hooks off refuses the test surface even in a candidate binary", async () => {
    const normal = await startSelftestHost(["--allow-writes", "--write-classes", "player,npc,photo,save"]);
    const client = new CommandApi({ runtimeDir: normal.dir, auditDir: tempDir("xfb-input-off-") });
    try {
      const r = await client.run("test.input.arm", { run_id: "off", context: "gameplay" });
      expect(r).toMatchObject({ ok: false, error: { code: "test_hooks_off" } });
    } finally { client.close(); await normal.stop(); }
  }, HOOK_TIMEOUT_MS);
});

test("photo comparison and lifecycle observe state without confirmed-exit stimulus", () => {
  const input = read("redscript-input", "XFRuntimeBridgeInput.reds");
  expect(input).toContain("QueueEvent(new TryExitPhotomodeEvent())");
  expect(input).toContain("this.OnTryExitPhotomode();");
  expect(input).not.toMatch(/OnExitConfirmed|SetHubAnswer|SetHubIndex/);
  const panel = read("redscript", "XFRuntimeBridgePhotoPanel.reds");
  for (const stage of ["show", "hide", "entry", "held", "return", "update"]) expect(panel).toContain(`XFBridgeInputPhotoObserve("${stage}")`);
  expect(panel).toContain('XFBridge_Event("input.photo.confirmation"');
  expect(findCommand("test.photo.exit_attempt")!.input.properties?.route).toBeDefined();
});
