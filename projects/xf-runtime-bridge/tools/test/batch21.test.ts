// Bridge 0.8.7: session 14's fixes and the session-15 probes. The CET layer runs under fengari (Lua 5.3; the game runs LuaJIT)
// with stubs of CET's ImGui and globals that record every call; the redscript and native layers are read from the source; the
// photo-menu panel's safe zones are checked through their TypeScript mirror (tools/overlay/ink-place.ts). Proves nothing about
// the game.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { avoidZones, type Rect } from "../overlay/ink-place.ts";
import { findCommand } from "../api/catalogue.ts";
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

// CET's ImGui, stubbed as in batch20, plus a window whose position and size the test moves, and SetNextWindowPos recorded.
const IMGUI = `
  calls, y, cx, clicks, padding = {}, 0, 26, {}, 26
  winX, winY, winW, winH = 100, 100, 300, 200
  local function rec(s) calls[#calls + 1] = s end
  local function item(kind, label, h) y = y + h; cx = padding; rec(kind .. ":" .. tostring(label)) end
  local any = setmetatable({}, { __index = function(_, k) return k end })
  ImGuiCol, ImGuiStyleVar, ImGuiWindowFlags, ImGuiCond = any, any, any, any
  ImGuiInputTextFlags = setmetatable({ EnterReturnsTrue = 32, ReadOnly = 16384 }, { __index = function() return nil end })
  ImGuiKey = setmetatable({}, { __index = function(_, k) return k end })
  bit32 = { bor = function() return 0 end }
  unpack = table.unpack
  ImGui = setmetatable({
    Begin = function(name) rec("begin:" .. tostring(name)); cx = padding; return true end,
    GetFontSize = function() return 14 end,
    GetTime = function() return 100 end,
    GetCursorPosY = function() return y end,
    SetCursorPosY = function(v) y = v end,
    GetCursorPosX = function() return cx end,
    SetCursorPosX = function(v) rec("setX:" .. tostring(v)); cx = v end,
    GetWindowPos = function() return winX, winY end,
    GetWindowSize = function() return winW, winH end,
    SetNextWindowPos = function(px, py, cond) rec("nextpos:" .. tostring(px) .. "," .. tostring(py)) end,
    PushClipRect = function(a, b, c, d, i) rec("clip") end,
    PopClipRect = function() rec("unclip") end,
    PushStyleVar = function(i, a, b) end,
    PushStyleColor = function(i, r, g, b, a) end,
    CalcTextSize = function(s) return #s * 7, 14 end,
    Button = function(label) item("button", label, 22); return clicks[label] == true end,
    SameLine = function(a, b) rec("sameline") end,
    Bullet = function() rec("bullet@" .. tostring(cx)); cx = cx + 14 end,
    Indent = function(v) rec("indent:" .. tostring(v)) end,
    Unindent = function(v) rec("unindent:" .. tostring(v)) end,
    Text = function(t) item("text", t, 14) end,
    TextColored = function(r, g, b, a, t) item("text", t, 14) end,
    TextDisabled = function(t) item("disabledtext", t, 14) end,
    TextWrapped = function(t) rec("wrapped@" .. tostring(cx) .. ":" .. tostring(t)); y = y + 14; cx = padding end,
    IsItemHovered = function() return false end,
    BeginDisabled = function() end,
    EndDisabled = function() end,
    InputTextMultiline = function(label, text) return text, false end,
  }, { __index = function() return function() return false end end })
`;

describe.skipIf(!existsSync(FENGARI))("0.8.7 the CET layer: the CET line's dot, the window's buttons, its corner and Save anyway", () => {
  const init = read("cet", "xf_runtime_bridge", "init.lua");
  const panel = read("cet", "xf_runtime_bridge", "panel.lua");
  const run = (body: string) =>
    runLua(`${IMGUI}
      handlers, DECODE, logged, nativeCalls = {}, {}, {}, {}
      registerForEvent = function(name, fn) handlers[name] = fn end
      registerHotkey = function() end
      spdlog = { info = function(s) logged[#logged + 1] = s end, warning = function(s) logged[#logged + 1] = s end, error = function() end, debug = function() end }
      GetVersion = function() return "1.37.1" end
      json = { decode = function(s) return DECODE[s] end, encode = function() return "{}" end }
      package.preload["panel"] = function() return (function() ${panel} end)() end
      package.preload["theme"] = function() error("no theme") end
      Game = setmetatable({
        XFBridge_Info = function() return "INFO" end,
        XFBridge_Hud = function() return "xfhud\\t1\\nsurface\\tcet_line\\nkeys\\t1\\n" end,
        XFBridge_Messages = function() return "MSGS" end,
        XFBridge_SaveAnyway = function(source) nativeCalls[#nativeCalls + 1] = "SaveAnyway:" .. tostring(source); return "SAVED" end,
      }, { __index = function() return function() return "" end end })
      DECODE.INFO = { plugin_version = "0.8.7", answer_keys = { "IK_F6", "IK_F7" },
        bridge = { enabled = true, listening = true, killed = false, allow_writes = true }, status = { label = "XF Runtime Bridge · XF Studio connected", tone = "ok" },
        save_lock = { save_anyway = true, running = false, refusals = 1, last_seq = 0 } }
      DECODE.MSGS = { messages = { { id = 5, text = "Ready?", level = "ask" } }, pending_ask = { id = 5, text = "Ready?", choices = { "Done", "Not yet" } } }
      DECODE.SAVED = { started = true }
      local mod = (function() ${init} end)()
      handlers.onInit()
      handlers.onUpdate(1)
      local function draw() calls, y, cx = {}, 0, padding; handlers.onDraw(); return table.concat(calls, "|") end
      ${body}`);

  test("T3/P5: where the padding can't hold even the dot, the words hang past it, and the mod's log says why once", () => {
    const out = run(`
      padding = 4
      local a = draw()
      draw()
      local n = 0
      for _, line in ipairs(logged) do if string.find(line, "status dot hangs", 1, true) then n = n + 1 end end
      return a .. "@@" .. n`);
    const [frame, count] = out.split("@@");
    expect(frame).toMatch(/bullet@4\|sameline\|wrapped@18:XF Runtime Bridge/);
    expect(frame).toContain("indent:14");
    expect(count).toBe("1");
  });

  test("F-key hints: the window's answer buttons name no key (CET has the keyboard while the window shows); the CET line keeps them", () => {
    const out = run(`
      handlers.onOverlayOpen()
      return draw()`);
    expect(out).toContain("button:Done##xf_answer_1");
    expect(out).toContain("button:Not yet##xf_answer_2");
    expect(out).not.toMatch(/\(F6\)|\(F7\)/);
    expect(panel).not.toContain("keyLabel(");
  });

  test("the window keeps its top-left corner when its height changes, and follows a drag", () => {
    const out = run(`
      handlers.onOverlayOpen()
      draw()                                   -- the corner noted: 100, 100
      winH, winY = 260, 70                     -- auto-resize moved the top edge
      draw()
      local restored = draw()                  -- put back where the corner was
      winX, winY = 400, 300                    -- the player drags it (same size)
      draw()
      local dragged = draw()
      return restored .. "@@" .. dragged`);
    const [restored, dragged] = out.split("@@");
    expect(restored).toMatch(/^nextpos:100,100\|begin:XF Runtime Bridge\|/);
    expect(dragged).not.toContain("nextpos:");
  });

  test("friction: Save anyway shows only while the plugin offers it, and a click asks the plugin to save, saying so", () => {
    const out = run(`
      handlers.onOverlayOpen()
      local offered = draw()
      clicks["Save anyway"] = true
      draw()
      clicks = {}
      handlers.onUpdate(0)
      local after = draw()
      DECODE.INFO.save_lock.save_anyway = false
      handlers.onUpdate(3)
      local hidden = draw()
      return offered .. "@@" .. table.concat(nativeCalls, ",") .. "@@" .. after .. "@@" .. hidden`);
    const [offered, calls, after, hidden] = out.split("@@");
    expect(offered).toContain("button:Save anyway");
    expect(calls).toBe("SaveAnyway:cet-panel");
    expect(after).toContain("Saving... The XF Runtime Bridge window says when it's done.");
    expect(hidden).not.toContain("button:Save anyway");
  });
});

describe("0.8.7 the photo-menu panel (P5 clicks, P8/P9 modal, P11 safe zones), read from the redscript source", () => {
  const panel = read("redscript", "XFRuntimeBridgePhotoPanel.reds");

  test("P5: a press counts as click or photo mode's PhotoMode_CameraMouseMove (the left button's press there), on the answer or the global press", () => {
    expect(panel).toMatch(/return e\.IsAction\(n"click"\) \|\| e\.IsAction\(n"PhotoMode_CameraMouseMove"\);/);
    expect(panel).toContain('this.m_controller.RegisterToGlobalInputCallback(n"OnPostOnPress", this, n"OnXFGlobalPress");');
    expect(panel).toContain('this.m_controller.RegisterToGlobalInputCallback(n"OnPostOnRelease", this, n"OnXFGlobalRelease");');
    expect(panel).toContain('this.m_controller.UnregisterFromGlobalInputCallback(n"OnPostOnPress", this, n"OnXFGlobalPress");');
    // Both routes go through Arm and Complete; each press is logged with its route and actions.
    const chipPress = panel.slice(panel.indexOf("protected cb func OnXFChipPress"), panel.indexOf("protected cb func OnXFChipRelease"));
    expect(chipPress).toContain('this.Arm(e, this.m_view.ChipIndex(e.GetCurrentTarget()), "answer");');
    const globalPress = panel.slice(panel.indexOf("protected cb func OnXFGlobalPress"), panel.indexOf("protected cb func OnXFGlobalRelease"));
    expect(globalPress).toContain('this.Arm(e, hovered, "global");');
    expect(panel).toContain('this.PointerAt("press", e, choice,');
    // The second route of the same release stays quiet.
    expect(panel).toContain("if pressAsk == 0 && this.m_clickedFrame == this.m_frames {");
  });

  test("P5: a keyless answer (beyond the answer keys) is as clickable as the others", () => {
    const interactive = panel.slice(panel.indexOf("private func Interactive(on: Bool)"), panel.indexOf("// ---- Every frame"));
    expect(interactive).toMatch(/while i < this\.m_view\.ChipCount\(\) \{\s+this\.m_view\.Chip\(i\)\.SetInteractive\(on\);/);
    expect(read("redscript", "XFRuntimeBridgeInk.reds")).toContain('let keyed = keys && NotEquals(frame.askKeys[k], "-") && NotEquals(frame.askKeys[k], "");');
  });

  test("P8/P9: modal holds photo mode's exit at its script callback and takes nothing from the game; the camera keys are said to be out of reach", () => {
    expect(panel).toMatch(/@wrapMethod\(gameuiPhotoModeMenuController\)\s+protected cb func OnTryExitPhotomode\(\) -> Bool \{\s+if IsDefined\(this\.m_xfPhotoPanel\) && this\.m_xfPhotoPanel\.HoldExit\(\) \{\s+return false;\s+\}\s+return wrappedMethod\(\);/);
    const hold = panel.slice(panel.indexOf("public func HoldExit() -> Bool {"), panel.indexOf("// ---- Opening and closing"));
    expect(hold).toContain("!XFBridge_Live()");
    // The Sol review of 0.8.7, finding 3: a frame read at the moment of Esc; an unreadable one, or a stopped bridge, lets the exit work.
    expect(hold).toContain("let now = XFHudFrame.Parse(XFBridge_Hud());");
    expect(hold).toContain('if !now.valid || !now.modal || !now.show || !Equals(now.layer, "photo_menu") || Equals(now.tone, "killed") {');
    const handlers = read("native", "src", "plugin", "GameHandlers.cpp");
    expect(handlers).toContain('out["modal_cannot_hold"] = json::array({"photo_mode_camera_keys"});');
    expect(findCommand("ui.hud")!.description).toContain("camera keys are read natively and can't be held");
  });

  test("Sol review of 0.8.7, finding 3: an unreadable frame fails open: the last frame forgotten, everything released once, no hover retaken until a valid frame", () => {
    const update = panel.slice(panel.indexOf("public func Update(timeDelta: Float) -> Void {"), panel.indexOf("private func FrameLost()"));
    expect(update).toMatch(/if frame\.valid \{[\s\S]*this\.Apply\(frame\);\s+\} else \{\s+this\.FrameLost\(\);/);
    const lost = panel.slice(panel.indexOf("private func FrameLost()"), panel.indexOf("private func Apply("));
    expect(lost).toMatch(/if this\.m_frameBad \{\s+return;\s+\}\s+this\.m_frameBad = true;\s+this\.m_frame = null;\s+this\.Release\("frame_invalid"\);/);
    expect(panel).toContain("let wanted = this.m_hoverCount > 0 && this.m_showing && !this.m_killed && !this.m_frameBad;");
  });

  test("Sol review of 0.8.7, finding 4: giving up the mouse drops the press, and a release completes only while the panel holds the mouse", () => {
    const block = panel.slice(panel.indexOf("private func Block(on: Bool) -> Void {"), panel.indexOf("private func Pointer("));
    const giveBack = block.slice(block.indexOf("} else {"));
    expect(giveBack).toContain("this.m_hoverTaken = false;");
    expect(giveBack).toContain("this.ClearPress();");
    const complete = panel.slice(panel.indexOf("private func Complete("), panel.indexOf("protected cb func OnXFChipPress"));
    expect(complete.indexOf("if !this.m_hoverTaken {")).toBeGreaterThan(0);
    expect(complete.indexOf("if !this.m_hoverTaken {")).toBeLessThan(complete.indexOf("XFBridge_Answer("));
  });

  test("P11: the panel measures photo mode's menu, top bar and hint strips from the controller's widgets and keeps out of them; the laid-out event reports them", () => {
    const zones = panel.slice(panel.indexOf("public func XFBridgeZones("), panel.indexOf("// The vanilla menu area's hover block"));
    for (const field of ["m_menuArea", "m_additionalMenuArea", "m_radioButtons", "m_tabTitleText", "m_inputBottomRoot", "m_inputExit", "m_inputScreenshot"]) {
      expect(zones).toContain(`this.${field}`);
    }
    expect(panel).toContain("let kept = XFInkStyle.Avoid(placed, this.m_zones, this.m_visible, 24.0 * units);");
    expect(panel).toContain('out += "],\\"panel_rect\\":["');
    // The redscript's rule is the TypeScript mirror's.
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain("if z.Y + z.W >= v.Y + v.W * 0.8 {");
    expect(ink).toContain("if z.X >= v.X + v.Z * 0.5 {");
    expect(ink).toContain("if z.Y <= v.Y + v.W * 0.2 {");
  });

  test("P11 (the mirror, at session 14's 21:9 geometry): bottom_left goes above the hint strip, a panel on the menu goes left of it, top_right stays", () => {
    const visible: Rect = { x: 0, y: 0, w: 5184, h: 2160 };
    const hints: Rect = { x: 2, y: 1459, w: 5184, h: 700 };
    const menu: Rect = { x: 3499, y: 616, w: 1600, h: 1034 };
    const zones = [menu, hints];
    const bottomLeft = avoidZones({ x: 40, y: 1700, w: 700, h: 230 }, zones, visible, 24);
    expect(bottomLeft.y + bottomLeft.h).toBeLessThanOrEqual(hints.y - 24);
    expect(bottomLeft.x).toBe(40);
    const onMenu = avoidZones({ x: 3600, y: 800, w: 700, h: 230 }, zones, visible, 24);
    expect(onMenu.x + onMenu.w).toBeLessThanOrEqual(menu.x - 24);
    const topRight = avoidZones({ x: 4444, y: 40, w: 700, h: 230 }, zones, visible, 24);
    expect(topRight).toEqual({ x: 4444, y: 40, w: 700, h: 230 });
    // Pushed up out of the hints and then into the menu: the second pass moves it left too.
    const corner = avoidZones({ x: 4400, y: 1700, w: 700, h: 230 }, zones, visible, 24);
    expect(corner.y + corner.h).toBeLessThanOrEqual(hints.y - 24);
    expect(corner.x + corner.w).toBeLessThanOrEqual(menu.x - 24);
  });
});

describe("0.8.7 the pin mark, the save lock's notice, the probes", () => {
  test("U2: an off-screen or behind-camera pin keeps its mark at the screen's edge in its direction, whole on screen, and says so (at_edge); the mark has a dark halo and plate", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain("let edge = s.W <= 0.0 || AbsF(s.X) > 1.0 || AbsF(s.Y) > 1.0;");
    expect(ink).toContain("let dx = s.W <= 0.0 ? -s.X : s.X;");
    expect(ink).toContain("entry.markAtEdge = edge;");
    const pins = read("redscript", "XFRuntimeBridgePins.reds");
    expect(pins).toContain('halo.SetName(n"halo");');
    expect(pins).toContain('plate.SetName(n"plate");');
    expect(pins).toContain('\\"at_edge\\":');
  });

  test("friction: a refused save of the player's tells the plugin whether the bridge's lock was among the reasons; the status surface says why in plain words", () => {
    const actions = read("redscript", "XFRuntimeBridgeActions.reds");
    expect(actions).toMatch(/@wrapMethod\(UIInGameNotificationEvent\)\s+public final static func CreateSavingLockedEvent\(const locks: script_ref<array<gameSaveLock>>\) -> ref<UIInGameNotificationEvent> \{\s+let result = wrappedMethod\(locks\);\s+XFBridge_SaveRefused\(XFBridgeActions\.OwnSaveLockHeld\(\)\);/);
    const natives = read("native", "src", "plugin", "Natives.cpp");
    expect(natives).toContain('"XF Runtime Bridge is holding saves because of a test change. Load a save, or use Save anyway in the XF Runtime Bridge window."');
    // Save anyway: only where the window offers it (writes and the save class), never a pipe method.
    expect(natives).toContain("if (!SaveAnywayOffered())");
    expect(read("native", "src", "plugin", "Plugin.cpp")).toContain("(state.config.writeClasses & kWriteSave) == 0");
    expect(findCommand("save.anyway")).toBeUndefined();
    const handlers = read("native", "src", "plugin", "GameHandlers.cpp");
    expect(handlers).not.toMatch(/Register\(\{?"(game\.)?save\.anyway"/);
    expect(handlers).toContain("return SaveWith(request, aCid, true);");
  });

  test("the probes: their scripts live apart from the main ones (staged only in the -writes package), every native is declared as registered, and each test method is refused without the test hooks", () => {
    expect(readdirSync(join(projectDir, "redscript")).some((f) => /Probe/.test(f))).toBe(false);
    expect(readdirSync(join(projectDir, "redscript-probes")).sort()).toEqual(["XFRuntimeBridgeProbeEvents.reds", "XFRuntimeBridgeProbePersist.reds", "XFRuntimeBridgeProbeSave.reds"]);
    const declared = read("redscript", "Natives.reds");
    for (const line of [
      "public static native func XFBridge_SaveRefused(ours: Bool) -> Bool",
      "public static native func XFBridge_SaveAnyway(source: String) -> String",
      "public static native func XFBridge_Event(kind: String, data: String) -> Bool",
      "public static native func XFBridge_ProbeFlags() -> Int32",
    ]) {
      expect(declared).toContain(line);
    }
    const handlers = read("native", "src", "plugin", "GameHandlers.cpp");
    for (const method of ["test.events", "test.save.identity", "test.companion.probe"]) {
      expect(handlers).toContain(`RequireTestHooks("${method}");`);
      expect(findCommand(method)?.description).toContain("only in the -writes package");
    }
    // No probe hook calls into the game from the plugin: the redscript pushes records; XFBridge_Event refuses without the hooks.
    expect(read("native", "src", "plugin", "Natives.cpp")).toContain("if (!state.config.allowTestHooks || !probes::KindOk(what) || raw.size() > 4096)");
    // Spoiler-safe: the dialogue and journal records carry ids, states and counts, never text.
    const events = read("redscript-probes", "XFRuntimeBridgeProbeEvents.reds");
    expect(events).not.toMatch(/localizedName|\.title\b|GetText\(|ShowDialogLine/);
  });

  test("Sol review of 0.8.7, findings 2 and 5: the probes build nothing with the hooks off, read game systems only while the script gate is open, and keep journal hashes exact", () => {
    const events = read("redscript-probes", "XFRuntimeBridgeProbeEvents.reds");
    const emit = events.slice(events.indexOf("public static func Emit("), events.indexOf("public static func Id("));
    expect(emit.indexOf("if !XFProbeOut.On() {")).toBeLessThan(emit.indexOf("if XFBridge_Live() {"));
    expect(emit.indexOf("if XFBridge_Live() {")).toBeLessThan(emit.indexOf("GameInstance.GetTimeSystem"));
    expect(emit.indexOf("if XFBridge_Live() {")).toBeLessThan(emit.indexOf("GameInstance.GetSimTime"));
    const save = read("redscript-probes", "XFRuntimeBridgeProbeSave.reds");
    const point = save.slice(save.indexOf("public static func Point("), save.indexOf("public static func SaveIdentity("));
    expect(point.indexOf("if !XFProbeOut.On() {")).toBeLessThan(point.indexOf("XFProbeSave.Facts()"));
    expect(point).toContain('let facts = XFBridge_Live() ? "," + XFProbeSave.Facts() : "";');
    expect(save).not.toMatch(/Session\/BeforeStart"\) \|\| Equals/);
    expect(events).not.toContain("Cast<Float>(hash)");
    expect(events).toContain('+ s"\\(hash)" +');
  });

  test("Sol review of 0.8.7, finding 1: every save has one owner from its first check to its relock; a second is refused save_in_progress", () => {
    const writes = read("native", "src", "core", "Writes.cpp");
    const save = writes.slice(writes.indexOf("json GameSave(const params::GameSaveRequest& aRequest, const SaveOps& aOps)"));
    expect(save.indexOf("std::unique_lock<std::mutex> owner(SaveOwner(), std::try_to_lock);")).toBeLessThan(save.indexOf("RelockOnExit relock("));
    expect(read("native", "src", "plugin", "GameHandlers.cpp")).toContain("return writes::GameSave(request, ops);");
    expect(findCommand("game.save")!.refusals).toContain("save_in_progress");
  });

  test("the save-identity probe's facts are all xfs_probe_* and the pin's check is the plugin's FNV-1a", () => {
    const save = read("redscript-probes", "XFRuntimeBridgeProbeSave.reds");
    const facts = [...save.matchAll(/n"(xfs_[a-z_0-9]+)"/g)].map((m) => m[1]);
    expect(facts.length).toBeGreaterThan(5);
    expect(facts.every((f) => f.startsWith("xfs_probe_"))).toBe(true);
    expect(read("native", "src", "plugin", "GameHandlers.cpp")).toContain("uint32_t hash = 2166136261u;");
  });
});
