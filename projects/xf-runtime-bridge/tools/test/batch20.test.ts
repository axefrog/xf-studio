// Bridge 0.8.6: the UI review's remaining polish (UI-186 fix 6, UI-195 P1-P5) in the CET layer, run under fengari (Lua 5.3; the
// game runs LuaJIT) with stubs of CET's ImGui and globals that record every call; and the photo-menu panel's wiring in the
// redscript layer, read from the source. Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { projectDir } from "./helpers.ts";

const FENGARI = process.env.XFB_FENGARI ?? "D:/Dev/tools/fengari/0.1.5/node_modules/fengari";
const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");

const runLua = (code: string): string => {
  const require = createRequire(import.meta.url);
  const { lua, lauxlib, lualib, to_luastring } = require(FENGARI);
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) return `load: ${lua.lua_tojsstring(L, -1)}`;
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `run: ${lua.lua_tojsstring(L, -1)}`;
  return lua.lua_tojsstring(L, -1);
};

// CET's ImGui, stubbed as in batch19 (14 px text at 7 px a character), plus the cursor's x, the clip and a click to answer.
const IMGUI = `
  calls, y, cx, clicks = {}, 0, 26, {}
  local function rec(s) calls[#calls + 1] = s end
  local function item(kind, label, h) y = y + h; cx = 26; rec(kind .. ":" .. tostring(label)) end
  local any = setmetatable({}, { __index = function(_, k) return k end })
  ImGuiCol, ImGuiStyleVar, ImGuiWindowFlags, ImGuiCond = any, any, any, any
  ImGuiInputTextFlags = setmetatable({ EnterReturnsTrue = 32, ReadOnly = 16384 }, { __index = function() return nil end })
  ImGuiKey = setmetatable({}, { __index = function(_, k) return k end })
  bit32 = { bor = function() return 0 end }
  unpack = table.unpack
  ImGui = setmetatable({
    Begin = function(name) rec("begin:" .. tostring(name)); return true end,
    GetFontSize = function() return 14 end,
    GetTime = function() return 100 end,
    GetCursorPosY = function() return y end,
    SetCursorPosY = function(v) rec("setY:" .. tostring(v - y)); y = v end,
    GetCursorPosX = function() return cx end,
    SetCursorPosX = function(v) rec("setX:" .. tostring(v)); cx = v end,
    GetWindowPos = function() return 12, 12 end,
    GetWindowSize = function() return 600, 120 end,
    PushClipRect = function(a, b, c, d, i) rec("clip:" .. table.concat({ a, b, c, d, tostring(i) }, ",")) end,
    PopClipRect = function() rec("unclip") end,
    PushStyleVar = function(i, a, b) rec("var:" .. tostring(i) .. "=" .. tostring(a) .. (b and ("," .. tostring(b)) or "")) end,
    PushStyleColor = function(i, r, g, b, a) rec("colour:" .. tostring(i) .. "=" .. table.concat({ r, g, b, a }, ",")) end,
    CalcTextSize = function(s) return #s * 7, 14 end,
    Button = function(label) item("button", label, 22); return clicks[label] == true end,
    SameLine = function(a, b) rec("sameline:" .. tostring(a) .. "," .. tostring(b)) end,
    Bullet = function() rec("bullet@" .. tostring(cx)); cx = cx + 14 end,
    Indent = function(v) rec("indent:" .. tostring(v)) end,
    Unindent = function(v) rec("unindent:" .. tostring(v)) end,
    Text = function(t) item("text", t, 14) end,
    TextColored = function(r, g, b, a, t) item("text", t .. " {" .. table.concat({ r, g, b, a }, ",") .. "}", 14) end,
    TextDisabled = function(t) item("disabledtext", t, 14) end,
    TextWrapped = function(t) rec("wrapped@" .. tostring(cx) .. ":" .. tostring(t)); y = y + 14; cx = 26 end,
    Dummy = function(w, h) item("dummy", h, h) end,
    BeginDisabled = function() end,
    EndDisabled = function() end,
    InputTextMultiline = function(label, text) return text, false end,
  }, { __index = function() return function() return false end end })
`;

describe.skipIf(!existsSync(FENGARI))("0.8.6 the XF Runtime Bridge window's Keys section (UI-195 P2, P3)", () => {
  const panel = read("cet", "xf_runtime_bridge", "panel.lua");
  const run = (body: string) =>
    runLua(`${IMGUI}
      local panel = (function() ${panel} end)()
      local queued = {}
      local function queue(name, arg) queued[#queued + 1] = name end
      local THEME = { colors = { XfTextMuted = { dark = { 0.5, 0.5, 0.5, 1 } }, XfDanger = { dark = { 0.9, 0.4, 0.4, 1 } },
        XfAccentText = { dark = { 1, 0.8, 0.3, 1 } } }, metrics = {} }
      local function state(extra)
        local s = { info = { plugin_version = "0.8.6", answer_keys = { "IK_F6" },
          bridge = { enabled = true, listening = true, killed = false, allow_writes = true },
          status = { connection = "Connected to XF Studio", connection_tone = "ok" },
          kill_key = { enabled = true, label = "Ctrl + Alt + Page Down", default = "Ctrl + Shift + End", is_default = false,
            warnings = {}, notes = {} } }, comment = "" }
        for k, v in pairs(extra or {}) do s[k] = v end
        return s
      end
      local function draw(s) calls, y, cx = {}, 0, 26; panel.draw(s, queue, THEME); return table.concat(calls, "|") end
      ${body}`);

  test("P2: after a change the reserved line holds the saved line, in place of the prompt and at its height; a refusal takes its place in red", () => {
    const out = run(`
      local changed = state({ killKeyChanged = true, killKeySaved = "The stop key is now Ctrl + Alt + Page Down, saved for next time." })
      local a = draw(changed); local ya = y
      local capturing = state({ killKeyChanged = true, killKeySaved = changed.killKeySaved, killKeyCapture = true })
      local b = draw(capturing); local yb = y
      local idle = state({}); local c = draw(idle); local yc = y
      local refused = state({ killKeyChanged = true, killKeyRefused = "F6 answers questions, so it can't stop the bridge." })
      local d = draw(refused); local yd = y
      local savedInSlot = string.find(a, "text:The stop key is now Ctrl + Alt + Page Down, saved for next time. {0.5,0.5,0.5,1}", 1, true) ~= nil
      local noDummyAfterChange = string.find(a, "dummy:", 1, true) == nil
      local promptNotSaved = string.find(b, "Press the new key", 1, true) ~= nil and string.find(b, "saved for next time", 1, true) == nil
      local emptyKeepsBand = string.find(c, "dummy:14", 1, true) ~= nil
      local red = string.find(d, "can't stop the bridge. {0.9,0.4,0.4,1}", 1, true) ~= nil
      return table.concat({ tostring(savedInSlot), tostring(noDummyAfterChange), tostring(promptNotSaved), tostring(emptyKeepsBand),
        tostring(red), tostring(ya == yb and yb == yc and yc == yd) }, ",")`);
    expect(out).toBe("true,true,true,true,true,true");
  });

  test("P3: a click on the keycap starts Change... (the prompt shows on the next frame); it has a tooltip and the theme's hover", () => {
    const out = run(`
      local s = state({})
      clicks["Ctrl + Alt + Page Down##xf_killkey_cap"] = true
      draw(s)
      clicks = {}
      local next = draw(s)
      local hoverKept = true
      for _, c in ipairs(calls) do if string.find(c, "colour:ButtonHovered", 1, true) then hoverKept = false end end
      return tostring(s.killKeyCapture) .. "," .. tostring(string.find(next, "Press the new key", 1, true) ~= nil) .. "," .. tostring(hoverKept)`);
    expect(out).toBe("true,true,true");
    expect(panel).toContain('ImGui.SetTooltip("Click to change the stop key")');
  });
});

describe.skipIf(!existsSync(FENGARI))("0.8.6 init.lua: the CET line and Reconnect's copy (UI-186 fix 6, UI-195 P1, P4, P5)", () => {
  const init = read("cet", "xf_runtime_bridge", "init.lua");
  const panel = read("cet", "xf_runtime_bridge", "panel.lua");
  // init.lua loaded as CET would load it: its events and hotkey recorded, Game's natives answering fixed text that a stub
  // json.decode turns into tables, panel.lua found by require.
  const run = (body: string) =>
    runLua(`${IMGUI}
      handlers, DECODE, rearmAnswer = {}, {}, "REARM"
      registerForEvent = function(name, fn) handlers[name] = fn end
      registerHotkey = function() end
      spdlog = { info = function() end, warning = function() end, error = function() end, debug = function() end }
      GetVersion = function() return "1.37.1" end
      json = { decode = function(s) return DECODE[s] end, encode = function() return "{}" end }
      package.preload["panel"] = function() return (function() ${panel} end)() end
      package.preload["theme"] = function() error("no theme") end
      Game = setmetatable({
        XFBridge_Info = function() return "INFO" end,
        XFBridge_Hud = function() return "xfhud\\t1\\nsurface\\tcet_line\\nkeys\\t1\\n" end,
        XFBridge_Messages = function() return "MSGS" end,
        XFBridge_Rearm = function() return rearmAnswer end,
      }, { __index = function() return function() return "" end end })
      DECODE.INFO = { plugin_version = "0.8.6", answer_keys = { "IK_F6", "IK_F7" },
        bridge = { enabled = true, listening = true, killed = false }, status = { label = "XF Runtime Bridge · XF Studio connected", tone = "ok" } }
      DECODE.MSGS = { messages = { { id = 5, text = "Ready?", level = "ask" } }, pending_ask = { id = 5, text = "Ready?", choices = { "Done", "Not yet" } } }
      local mod = (function() ${init} end)()
      handlers.onInit()
      handlers.onUpdate(1)
      local function draw() calls, y, cx = {}, 0, 26; handlers.onDraw(); return table.concat(calls, "|") end
      ${body}`);

  test("fix 6: the CET line writes [F6] Done, as the ink panel and the XF box do, and says to click in the window", () => {
    const out = run(`return draw()`);
    expect(out).toContain("wrapped@26:[F6] Done · [F7] Not yet, or click an answer in the XF Runtime Bridge window.");
    expect(out).not.toContain("Answer: F6");
  });

  test("P5: the status dot hangs in the window's left padding (clip widened), so the words start at the padding like every later line", () => {
    const out = run(`return draw()`);
    // A bullet one font size (14) left of the text's start (26), no frame padding, the clip the window's rectangle; then the
    // words at 26 with no hanging indent.
    expect(out).toMatch(/clip:12,12,612,132,false\|var:FramePadding=0,0\|colour:Text=[^|]+\|setX:12\|bullet@12\|.*unclip\|sameline:0,0\|colour:Text=[^|]+\|wrapped@26:XF Runtime Bridge/);
    expect(out).not.toContain("indent:");
  });

  test("P4: a refused or failed Reconnect says what to do in plain words, by the plugin's code; never the plugin's own reason", () => {
    const out = run(`
      DECODE.INFO.bridge.killed = true
      handlers.onUpdate(3)
      handlers.onOverlayOpen()
      local results = {}
      for _, code in ipairs({ "still_closing", "restore_pending", "already_running", "failed", "anything_new" }) do
        DECODE.REARM = { requested = false, code = code, reason = "the kill switch's restore hasn't finished; try again in a moment" }
        clicks["Reconnect"] = true
        draw()
        clicks = {}
        handlers.onUpdate(0)
        local frame = draw()
        results[#results + 1] = string.match(frame, "wrapped@%d+:(The bridge[^|]*)") or "?"
      end
      return table.concat(results, "/")`);
    expect(out).toBe(
      [
        "The bridge is still putting things back. Press Reconnect again in a moment.",
        "The bridge is still putting things back. Press Reconnect again in a moment.",
        "The bridge is already running.",
        "The bridge couldn't start again. Restart the game to start it.",
        "The bridge couldn't start again. Restart the game to start it.",
      ].join("/"),
    );
    expect(init).not.toMatch(/"The bridge couldn't start again: "/);
  });

  test("P1: the saved line names no path; the README and config.ini's comment say where the old config.ini is kept", () => {
    expect(init).not.toContain("backup_folder");
    expect(init).toContain('"The stop key is now " .. tostring(label) .. ", saved for next time."');
    expect(read("native", "config", "config.ini")).toMatch(/%LOCALAPPDATA%\\XFStudio\\runtime-bridge\\settings-backups/);
    expect(read("README.md")).toMatch(/settings-backups/);
  });
});

describe("0.8.6 the panel inside photo mode's menu (knowledge/photo-mode.md §15.6), read from the redscript source", () => {
  const reds = readdirSync(join(projectDir, "redscript")).filter((f) => f.endsWith(".reds")).map((f) => read("redscript", f)).join("\n");
  const natives = read("redscript", "Natives.reds");

  test("the route: built from OnShow under the menu controller's root as a Fill layer named xfPhotoLayer, ensured (never rebuilt), never in OnInitialize", () => {
    expect(reds).toMatch(/@wrapMethod\(gameuiPhotoModeMenuController\)\s+protected cb func OnShow\(reversedUI: Bool\) -> Bool \{\s+let result = wrappedMethod\(reversedUI\);/);
    expect(reds).toContain('layer.SetName(n"xfPhotoLayer")');
    expect(reds).toContain("layer.SetAnchor(inkEAnchor.Fill)");
    expect(reds).toMatch(/GetRootCompoundWidget\(\)/);
    expect(reds).not.toMatch(/@wrapMethod\(gameuiPhotoModeMenuController\)\s+protected cb func OnInitialize/);
    // Fronted once per open on a backward root, never per frame.
    expect(reds).toMatch(/Equals\(root\.GetChildOrder\(\), inkEChildOrder\.Backward\)/);
  });

  test("teardown: OnHide, the stop (a stopped frame) and a closed photo mode each release the camera's mouse and pop exactly the ModalPopup pushes made", () => {
    expect(reds).toMatch(/PushGameContext\(UIGameContext\.ModalPopup\)/);
    expect(reds).toMatch(/PopGameContext\(UIGameContext\.ModalPopup\)/);
    expect(reds).toMatch(/public func Release\(why: String\) -> Void \{/);
    expect(reds).toMatch(/this\.Hide\("photo_mode_closed"\)/);
    expect(reds).toMatch(/protected cb func OnHide\(\) -> Bool \{\s+\/\/.*\s+this\.XFBridgePhotoPanelHide\(\);/);
    expect(reds).toContain('"killed"');
  });

  // The Sol review of 0.8.6: teardown asks nothing of the game while the scripts' gate is shut, and a pop belongs to its session.
  test("Sol review 1: game input goes back only while the scripts are live, a push is popped only in its own session, and owed input is settled later", () => {
    const panel = read("redscript", "XFRuntimeBridgePhotoPanel.reds");
    const settle = panel.slice(panel.indexOf("private func Settle() -> Void {"), panel.indexOf("private func ClearPress()"));
    // The gate first, before anything that reaches the game.
    expect(settle.indexOf("if !XFBridge_Live() {")).toBeGreaterThan(0);
    expect(settle.indexOf("if !XFBridge_Live() {")).toBeLessThan(settle.indexOf("XFBridgeRegistry.Get()"));
    expect(settle).toMatch(/owner == now \{\s+this\.SetModal\(false\);\s+\} else \{\s+this\.m_modalPushed = false;/);
    const setModal = panel.slice(panel.indexOf("private func SetModal(on: Bool) -> Void {"), panel.indexOf("private func Pointer("));
    expect(setModal.indexOf("!XFBridge_Live()")).toBeLessThan(setModal.indexOf("GameInstance.GetUISystem"));
    const release = panel.slice(panel.indexOf("public func Release(why: String) -> Void {"), panel.indexOf("private func Settle()"));
    expect(release).not.toContain("SetModal(");
    expect(release).not.toContain("Block(");
    const update = panel.slice(panel.indexOf("public func Update(timeDelta: Float) -> Void {"), panel.indexOf("private func Apply("));
    expect(update).toMatch(/if !this\.m_open \{\s+\/\/[^\n]*\n\s+this\.Settle\(\);/);
    expect(update.indexOf('this.Hide("scripts_not_live")')).toBeLessThan(update.indexOf("XFPhoto.Active()"));
    const show = panel.slice(panel.indexOf("public func Show("), panel.indexOf("public func Hide("));
    expect(show.indexOf("this.Settle();")).toBeLessThan(show.indexOf("this.Ensure(root)"));
  });

  test("Sol review 2: an answer takes a click only as a press and a release on it, the press made while the panel holds the mouse", () => {
    const panel = read("redscript", "XFRuntimeBridgePhotoPanel.reds");
    expect(panel).toContain('chip.RegisterToCallback(n"OnPress", this, n"OnXFChipPress");');
    const press = panel.slice(panel.indexOf("protected cb func OnXFChipPress"), panel.indexOf("protected cb func OnXFChipRelease"));
    expect(press).toContain("!this.m_hoverTaken");
    expect(press).toContain("this.m_pressAsk = frame.askId;");
    const release = panel.slice(panel.indexOf("protected cb func OnXFChipRelease"), panel.indexOf("// ---- What the agent sees"));
    expect(release.indexOf("if pressAsk != frame.askId || pressChoice != choice {")).toBeLessThan(release.indexOf("XFBridge_Answer("));
    // Cleared on leaving the answer, the panel, a release, a hide or stop (Release) and a new question.
    const chipOut = panel.slice(panel.indexOf("protected cb func OnXFChipHoverOut"), panel.indexOf("protected cb func OnXFChipPress"));
    expect(chipOut).toContain("this.ClearPress();");
    expect(panel.slice(panel.indexOf("public func Release("), panel.indexOf("private func Settle()"))).toContain("this.ClearPress();");
    expect(panel).toMatch(/if this\.m_pressAsk > 0 && frame\.askId != this\.m_pressAsk \{\s+this\.ClearPress\(\);/);
  });

  test("Sol review 3: every choice shows, those beyond the answer keys without a key", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain('let keyed = keys && NotEquals(frame.askKeys[k], "-") && NotEquals(frame.askKeys[k], "");');
    expect(read("native", "src", "core", "InkUi.cpp")).toContain("for (size_t i = 0; i < pending.choices.size(); ++i)");
  });

  test("natives: XFBridge_InkEvent and XFBridge_MouseHeld are declared as the plugin registers them", () => {
    expect(natives).toContain("public static native func XFBridge_InkEvent(kind: String, text: String, data: String) -> Bool");
    expect(natives).toContain("public static native func XFBridge_MouseHeld() -> Bool");
    expect(read("native", "src", "plugin", "Natives.cpp")).toContain('log::Info("rtti.register_types", "phase=post_register natives=22");');
  });
});
