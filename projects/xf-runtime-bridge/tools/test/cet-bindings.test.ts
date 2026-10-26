// Bridge 0.8.22 (Borg 4: every card drew plain, "stack index -1, expected userdata, received nil"): the CET layer under fengari
// against CET 1.37.1's own ImGui binding table (tools/test/fixtures/cet-1.37.1-imgui.json, read from sol_imgui.h by
// tools/overlay/cet-bindings.ts). Each ImGui function checks its arguments as sol2 does with SOL_ALL_SAFETIES_ON (an overload
// of exactly that arity whose every parameter takes its argument; integers must be integral, bools booleans) and its caller as
// CET's wrapper does: CET looks up the calling function's environment for __logger, and LuaJIT drops the frame of a function
// that tail-calls, so a tail call into ImGui from a function pcall called finds pcall's environment and fails. fengari (Lua 5.3)
// keeps that frame, so the harness treats a caller executing OP_TAILCALL as gone, as LuaJIT does. Enums carry CET's members
// only (a missing one is nil); their values are placeholders. Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { BINDINGS_OUT, cetHeader, imguiTailCalls, parseBindings, renderBindings, type CetBindings, type Kind } from "../overlay/cet-bindings.ts";
import { projectDir } from "./helpers.ts";

const FENGARI = process.env.XFB_FENGARI ?? "D:/Dev/tools/fengari/0.1.5/node_modules/fengari";
const bindings = JSON.parse(readFileSync(BINDINGS_OUT, "utf8")) as CetBindings;
const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8").replace(/\r\n/g, "\n");
const CET_ERROR = "stack index -1, expected userdata, received nil: value is not a userdata";
const NO_MATCH = "sol: no matching function call takes this number of arguments and the specified types";

/** Runs Lua with CET 1.37.1's ImGui installed over the behaviour table IMPL (which the code defines before calling __cet()). */
function runCet(code: string): string {
  const require = createRequire(import.meta.url);
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require(FENGARI);
  const { OpCodesI } = require(join(FENGARI, "src", "lopcodes.js"));
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const tokens = new Map<string, { label: string }>();
  const token = (label: string) => { let t = tokens.get(label); if (!t) tokens.set(label, (t = { label })); return t; };
  const fail = (message: string) => { lua.lua_pushstring(L, to_luastring(message)); return lua.lua_error(L); };
  const isLua = (level: number, ar: any) => {
    if (!lua.lua_getstack(L, level, ar)) return false;
    lua.lua_getinfo(L, to_luastring("S"), ar);
    const what = to_jsstring(ar.what);
    return what === "Lua" || what === "main";
  };
  // CET's wrapper: the caller's environment must be the mod's. A Lua caller that is tail-calling us is gone under LuaJIT.
  const callerIsMod = () => {
    const ar = new lua.lua_Debug();
    if (!isLua(1, ar)) return false;
    const ci = ar.i_ci, ins = ci.l_code[ci.l_savedpc - 1];
    if (ins && ins.opcode === OpCodesI.OP_TAILCALL) return isLua(2, new lua.lua_Debug());
    return true;
  };
  const accepts = (kind: Kind, i: number): boolean => {
    const t = lua.lua_type(L, i);
    switch (kind) {
      case "string": return t === lua.LUA_TSTRING;
      case "number": return t === lua.LUA_TNUMBER;
      case "integer": return t === lua.LUA_TNUMBER && Number.isInteger(lua.lua_tonumber(L, i));
      case "boolean": return t === lua.LUA_TBOOLEAN;
      case "table": return t === lua.LUA_TTABLE;
      case "any": return true;
      default: return t === lua.LUA_TLIGHTUSERDATA || t === lua.LUA_TUSERDATA;
    }
  };
  const typeName = (i: number) => to_jsstring(lua.lua_typename(L, lua.lua_type(L, i)));
  const binding = (name: string) => () => {
    if (!callerIsMod()) return fail(CET_ERROR);
    const n = lua.lua_gettop(L);
    const overloads = bindings.functions[name]!;
    let chosen = undefined as undefined | (typeof overloads)[number];
    if (overloads.length === 1) {
      const only = overloads[0]!;
      for (let p = 0; p < only.params.length; p++) {
        if (!accepts(only.params[p]!, p + 1)) return fail(`stack index ${p + 1}, expected ${only.params[p]}, received ${typeName(p + 1)}`);
      }
      chosen = only;
    } else {
      chosen = overloads.find((o) => o.params.length === n && o.params.every((k, p) => accepts(k, p + 1)));
      if (!chosen) return fail(NO_MATCH);
    }
    const base = lua.lua_gettop(L);
    lua.lua_getglobal(L, to_luastring("IMPL"));
    lua.lua_pushstring(L, to_luastring(name));
    lua.lua_rawget(L, -2);
    lua.lua_remove(L, -2);
    if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION) {
      for (let i = 1; i <= n; i++) {
        if (lua.lua_type(L, i) === lua.LUA_TLIGHTUSERDATA) lua.lua_pushstring(L, to_luastring(lua.lua_touserdata(L, i).label));
        else lua.lua_pushvalue(L, i);
      }
      lua.lua_call(L, n, lua.LUA_MULTRET);
    } else {
      lua.lua_pop(L, 1);
      for (const kind of chosen.results) {
        if (kind === "boolean") lua.lua_pushboolean(L, false);
        else if (kind === "number" || kind === "integer") lua.lua_pushinteger(L, 0);
        else if (kind === "string") lua.lua_pushstring(L, to_luastring(""));
        else if (kind === "table") lua.lua_newtable(L);
        else lua.lua_pushlightuserdata(L, token(name));
      }
    }
    const count = lua.lua_gettop(L) - base;
    // A draw list is a userdata in CET: the behaviour's label becomes one.
    for (let r = 0; r < count; r++) {
      const at = base + 1 + r;
      if (chosen.results[r] === "drawlist" && lua.lua_type(L, at) === lua.LUA_TSTRING) {
        const label = to_jsstring(lua.lua_tostring(L, at));
        lua.lua_pushlightuserdata(L, token(label));
        lua.lua_replace(L, at);
      }
    }
    return count;
  };
  lua.lua_pushjsfunction(L, () => {
    lua.lua_newtable(L);
    for (const name of Object.keys(bindings.functions)) {
      lua.lua_pushjsfunction(L, binding(name));
      lua.lua_setfield(L, -2, to_luastring(name));
    }
    lua.lua_setglobal(L, to_luastring("ImGui"));
    for (const [enumName, members] of Object.entries(bindings.enums)) {
      lua.lua_newtable(L);
      const flags = /Flags$/.test(enumName);
      let bit = 0;
      members.forEach((member, index) => {
        const value = flags ? (member === "None" ? 0 : 2 ** bit++) : index;
        if (value > 0x7fffffff) lua.lua_pushnumber(L, value); else lua.lua_pushinteger(L, value);
        lua.lua_setfield(L, -2, to_luastring(member));
      });
      lua.lua_setglobal(L, to_luastring(enumName));
    }
    // CET's sandbox has bit32 (LuaJIT's bit); the layer must not need it, so the harness leaves it out.
    lua.lua_pushnil(L);
    lua.lua_setglobal(L, to_luastring("bit32"));
    return 0;
  });
  lua.lua_setglobal(L, to_luastring("__cet"));
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) return `load: ${lua.lua_tojsstring(L, -1)}`;
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `run: ${lua.lua_tojsstring(L, -1) ?? String(lua.lua_touserdata(L, -1))}`;
  return lua.lua_tojsstring(L, -1);
}

// The behaviours the tests read (recorded calls, a cursor that moves); everything else answers CET's defaults.
// Optional scrollModel: auto-fit uses the last measured content height, constraints cap the window, and a 24px title bar
// leaves a clipped content viewport. Items still lay out outside it, but only visible items submit draw receipts.
// This checks the Lua layout's overflow/reachability with CET-bound scroll calls, not Dear ImGui's renderer or game input.
const IMPL = `
  calls, curY, T, pc, pv = {}, 0, 0, 0, 0
  local function rec(s) calls[#calls + 1] = s end
  local function item(kind, text, h)
    local top, bottom = curY, curY + (h or 14)
    curY = bottom
    local visible = true
    if scrollModel then
      local m = scrollModel
      m.contentBottom = math.max(m.contentBottom or 0, bottom)
      local viewportBottom = m.offset + m.height - 24
      visible = bottom > m.offset and top < viewportBottom
      m.items[kind .. ":" .. tostring(text)] = { top = top, bottom = bottom, fullyVisible = top >= m.offset and bottom <= viewportBottom }
    end
    if visible then rec(kind .. ":" .. tostring(text)) end
  end
  unpack = table.unpack
  IMPL = {
    Begin = function(name)
      if scrollModel then
        local m = scrollModel
        m.height = math.min((m.contentHeight or 276) + 24, m.cap or math.huge)
        m.maxScroll = math.max(0, (m.contentHeight or 0) - (m.height - 24))
        m.offset = math.max(0, math.min(m.offset, m.maxScroll))
        m.contentBottom, m.items = 0, {}
      end
      rec("begin:" .. tostring(name)); return true
    end,
    End = function()
      if scrollModel then scrollModel.contentHeight = math.max(scrollModel.contentBottom, curY) end
      rec("end")
    end,
    BeginChild = function(id, w, h, childFlags, windowFlags) rec("child:" .. id .. ":" .. tostring(childFlags) .. ":" .. tostring(windowFlags)); return true end,
    EndChild = function() rec("endchild") end,
    GetFontSize = function() return 13 end,
    GetTime = function() return T end,
    GetCursorPosX = function() return 12 end,
    GetCursorPosY = function() return curY end,
    SetCursorPosY = function(v) curY = v end,
    GetCursorScreenPos = function() return 50, 60 end,
    GetWindowPos = function() return 10, 10 end,
    GetWindowSize = function() return 400, scrollModel and scrollModel.height or 300 end,
    GetScrollMaxY = function() return scrollModel and scrollModel.maxScroll or 0 end,
    SetScrollY = function(value)
      if scrollModel then scrollModel.offset = math.max(0, math.min(value, scrollModel.maxScroll)) end
    end,
    GetTextLineHeight = function() return 14 end,
    GetWindowDrawList = function() return "wl" end,
    GetForegroundDrawList = function() return "fg" end,
    GetColorU32 = function(r, g, b, a) return math.floor((a or 1) * 1000 + 0.5) end,
    ImDrawListAddRectFilled = function(list, x1, y1, x2, y2, c) rec("rectfilled@" .. list .. ":" .. tostring(x2 - x1)) end,
    ImDrawListAddCircleFilled = function(list, x, y, r) rec("dot@" .. list .. ":" .. x .. "," .. y .. "," .. r) end,
    ImDrawListAddCircle = function(list) rec("ring@" .. list) end,
    CalcTextSize = function(s) return #s * 7, 14 end,
    Button = function(label) item("button", label, 22); return false end,
    Dummy = function(w, h) curY = curY + (h or 0) end,
    Text = function(t) item("text", t) end,
    TextColored = function(r, g, b, a, t) item("text", t) end,
    TextDisabled = function(t) item("disabled", t) end,
    TextWrapped = function(t) item("wrapped", t) end,
    InputTextMultiline = function(label, text, capacity, w, h) rec("field:" .. w .. "," .. h); return text, false end,
    SetNextWindowSizeConstraints = function(a,b,w,h)
      if scrollModel then scrollModel.cap = h end
      rec("cap:" .. w .. "," .. h)
    end,
    SetNextWindowPos = function(x,y) rec("pos:" .. x .. "," .. y) end,
    SameLine = function(x,gap) rec("same:" .. tostring(x) .. "," .. tostring(gap)) end,
    CollapsingHeader = function(label) rec("header:" .. label); return true end,
    SetNextItemOpen = function(open) rec("setnextopen:" .. tostring(open)) end,
    PushStyleColor = function() pc = pc + 1 end,
    PopStyleColor = function(n) pc = pc - (n or 1) end,
    PushStyleVar = function(i,a,b) pv = pv + 1; rec("var:" .. i .. ":" .. a .. "," .. tostring(b)) end,
    PopStyleVar = function(n) pv = pv - (n or 1) end,
    SetWindowFontScale = function(s) rec("scale:" .. tostring(s)) end,
  }
  __cet()
  GetDisplayResolution = function() return 2560, 1600 end
`;

const panel = read("cet", "xf_runtime_bridge", "panel.lua");
const theme = read("cet", "xf_runtime_bridge", "theme.lua");
const init = read("cet", "xf_runtime_bridge", "init.lua");
const drawPanel = (body: string) => runCet(`${IMPL}
  local panel = (function() ${panel} end)()
  local THEME = (function() ${theme} end)()
  local function state(extra)
    local s = { comment = "", pluginPresent = true, drawFailed = {}, noteDraw = function(name, why) calls[#calls + 1] = "failed:" .. name .. ": " .. why end,
      info = { plugin_version = "0.8.22", answer_keys = {}, bridge = { enabled = true, listening = true, killed = false, allow_writes = true, requests = 3 },
        status = { tone = "write", connection = "XF Studio connected", connection_tone = "ok", chip = "Changes allowed" },
        overlay = { theme = "dark", motion = "full", phase = "drawing", frames = 10, cpu_ms = 0.2, cpu_ms_max = 0.4 },
        kill_key = { enabled = true, label = "Ctrl + Shift + End", default = "Ctrl + Shift + End", is_default = true, warnings = {}, notes = {} } } }
    for k, v in pairs(extra or {}) do s[k] = v end
    return s
  end
  local function draw(s) calls, curY = {}, 0; panel.draw(s, function() end, THEME); return table.concat(calls, "|") end
  ${body}`);

const skip = !existsSync(FENGARI);

describe("0.8.22 CET 1.37.1's ImGui binding table", () => {
  test("the committed table is what sol_imgui.h at v1.37.1 gives (when the CET clone is here)", () => {
    const header = cetHeader();
    if (header === null) return; // the clone is optional; the committed table stands
    expect(renderBindings(parseBindings(header))).toBe(readFileSync(BINDINGS_OUT, "utf8").replace(/\r\n/g, "\n"));
  });

  test("it has what the cards use, with the overloads the header binds", () => {
    const sig = (name: string) => bindings.functions[name]!.map((o) => o.params.join(","));
    expect(sig("BeginChild")).toEqual(["string", "string,number", "string,number,number", "string,number,number,integer", "string,number,number,integer,integer",
      "string,number,number,boolean", "string,number,number,boolean,integer"]);
    expect(sig("PushStyleVar")).toEqual(["integer,number", "integer,number,number"]);
    expect(sig("PushStyleColor")).toEqual(["integer,integer", "integer,number,number,number,number"]);
    expect(bindings.functions.GetWindowPos![0]!.results).toEqual(["number", "number"]);
    expect(bindings.functions.GetWindowDrawList![0]!.results).toEqual(["drawlist"]);
    expect(bindings.enums.ImGuiChildFlags).toContain("Borders");
    expect(bindings.enums.ImGuiChildFlags).not.toContain("Border"); // renamed in Dear ImGui 1.91.1
    for (const m of ["WindowPadding", "DisabledAlpha", "ScrollbarSize", "FrameBorderSize", "Alpha"]) expect(bindings.enums.ImGuiStyleVar).toContain(m);
    expect(bindings.enums.ImGuiCol).toContain("Border");
    expect(bindings.enums.ImGuiWindowFlags).toContain("NoScrollWithMouse");
    expect(bindings.enums.ImGuiInputTextFlags).not.toContain("WordWrap"); // 1.92 only: the panel tests for it
  });

  test("the lint finds a tail call into ImGui and nothing else", () => {
    const code = [
      "local function a() return ImGui.BeginChild(\"x\", 1, 2, 1, 0) end",
      "local function b() return ImGui.GetFontSize() * 28 end",
      "local function c() return (ImGui.CalcTextSize(\"x\")) end",
      "local function d()",
      "  return ImGui.GetWindowDrawList()",
      "end",
      "-- return ImGui.Text(\"in a comment\")",
      "local function e() local v = ImGui.GetTime(); return v end",
    ].join("\n");
    expect(imguiTailCalls(code)).toEqual([1, 5]);
    for (const file of ["init.lua", "panel.lua", "test-input.lua"]) expect(imguiTailCalls(read("cet", "xf_runtime_bridge", file)), file).toEqual([]);
  });
});

describe.skipIf(skip)("0.8.22 the CET layer against CET 1.37.1's bindings under fengari", () => {
  test("the harness reproduces the game's message: a tail call into ImGui from a pcall'd function, and only that", () => {
    const out = runCet(`${IMPL}
      local okTail, whyTail = pcall(function() return ImGui.BeginChild("##c", 10, 10, 1, 0) end)
      local okHeld, whyHeld = pcall(function() local shown = ImGui.BeginChild("##c", 10, 10, 1, 0); return shown end)
      local okNested = pcall(function() local function inner() return ImGui.GetFontSize() end; local v = inner(); return v end)
      return tostring(okTail) .. "|" .. tostring(whyTail) .. "|" .. tostring(okHeld) .. "|" .. tostring(okNested)`);
    expect(out).toBe(`false|${CET_ERROR}|true|true`);
  });

  test("a nil enum member, a bool where CET wants an int and a fractional int fail as sol fails them", () => {
    const out = runCet(`${IMPL}
      local a = select(2, pcall(function() ImGui.PushStyleVar(ImGuiStyleVar.NoSuchVar, 1) end))
      local b = select(2, pcall(function() ImGui.IsKeyPressed(ImGuiKey.Escape, 0) end))
      local c = select(2, pcall(function() ImGui.PopStyleVar(1.5) end))
      local d = pcall(function() ImGui.PushStyleVar(ImGuiStyleVar.WindowPadding, 1.5, 2.5) end)
      return tostring(a) .. "|" .. tostring(b) .. "|" .. tostring(c) .. "|" .. tostring(d)`);
    expect(out).toBe(`${NO_MATCH}|${NO_MATCH}|${NO_MATCH}|true`);
  });

  test("the 0.8.22 card draws as a child window: int child flags, window flags without bit32, nothing named as failed", () => {
    const out = drawPanel(`local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done", "Not yet" } } })
      draw(s); local frame = draw(s)
      return frame .. "|net:" .. pc .. "," .. pv .. "|childFailed:" .. tostring(s.childFailed)`);
    expect(out).not.toContain("failed:");
    expect(out).toContain("|net:0,0|childFailed:nil");
    // Borders is the first non-None member of ImGuiChildFlags; NoScrollbar and NoScrollWithMouse are distinct bits, combined
    const borders = 2 ** 0;
    const flags = bindings.enums.ImGuiWindowFlags!.filter((m) => m !== "None");
    const windowFlags = 2 ** flags.indexOf("NoScrollbar") + 2 ** flags.indexOf("NoScrollWithMouse");
    for (const id of ["question"]) expect(out).toContain(`child:##xf_card_${id}:${borders}:${windowFlags}`);
    expect((out.match(/child:/g) ?? []).length).toBe((out.match(/endchild/g) ?? []).length);
    // the question's 2 px accent edge, on the window's own draw list (no longer always the foreground one)
    expect(out).toContain("rectfilled@wl:2");
    expect(out).toContain("button:Done##xf_answer_1");
  });

  test("a card whose step fails names the step, its arguments and the push counts, pops them and draws plain", () => {
    const out = drawPanel(`IMPL.BeginChild = function() error("rejected") end
      local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done" } } })
      local a = draw(s); local b = draw(s)
      return a .. "|net:" .. pc .. "," .. pv .. "|again:" .. tostring(string.find(b, "failed:", 1, true) ~= nil)`);
    expect(out).toMatch(/failed:card question at BeginChild\("##xf_card_question", [\d.]+, [\d.]+, 1, \d+\): .*rejected \(before it: 1 style vars and 1 colours pushed, all popped again\)/);
    expect(out).toContain("|net:0,0|again:false");
    expect(out).toContain("button:Done##xf_answer_1");
  });

  test("a CET whose ImGuiChildFlags says Border (before 1.91.1) or has none still gets an int border flag", () => {
    const flag = (setup: string) => runCet(`${IMPL} ${setup}
      local panel = (function() ${panel} end)()
      return tostring(panel.childBorders()) .. "," .. tostring(panel.flags(1, 4, 4, nil, 2))`);
    expect(flag("ImGuiChildFlags = { None = 0, Border = 1 }")).toBe("1,7");
    expect(flag("ImGuiChildFlags = nil")).toBe("1,7");
    expect(flag("ImGuiChildFlags = { Borders = 8 }")).toBe("8,7");
  });

  test("init.lua's line and window draw against the bindings, and report CET's overlay state at onInit", () => {
    const out = runCet(`${IMPL}
      handlers, DECODE, natives = {}, {}, {}
      registerForEvent = function(name, fn) handlers[name] = fn end
      registerHotkey = function() end
      logs = {}
      local function logLine(line) logs[#logs + 1] = line end
      spdlog = { info = logLine, warning = logLine, error = logLine, debug = logLine }
      GetVersion = function() return "1.37.1" end
      json = { decode = function(s) return DECODE[s] end, encode = function() return "{}" end }
      package.preload["panel"] = function() return (function() ${panel} end)() end
      package.preload["theme"] = function() return (function() ${theme} end)() end
      Game = setmetatable({ XFBridge_Info = function() return "INFO" end, XFBridge_Hud = function() return "xfhud\\t1\\nsurface\\tcet_line\\nkeys\\t1\\n" end,
        XFBridge_Messages = function() return "" end, XFBridge_Ping = function() return "pong" end,
        XFBridge_CetOverlay = function(open) natives[#natives + 1] = "cet_overlay:" .. tostring(open); return true end },
        { __index = function() return function() return "" end end })
      DECODE.INFO = { plugin_version = "0.8.22", bridge = { enabled = true, listening = true, killed = false }, overlay = { theme = "dark", motion = "full" },
        status = { label = "XF Runtime Bridge", tone = "ok" } }
      local mod = (function() ${init} end)()
      handlers.onInit(); handlers.onUpdate(1)
      calls = {}; handlers.onDraw(); local line = table.concat(calls, "|")
      handlers.onOverlayOpen(); handlers.onUpdate(1)
      calls = {}; handlers.onDraw(); local window = table.concat(calls, "|")
      handlers.onOverlayClose(); DECODE.INFO.bridge.killed = true; DECODE.INFO.status.tone = "killed"
      handlers.onUpdate(1); calls = {}; handlers.onDraw(); local stopped = table.concat(calls, "|")
      return stopped .. "~~" .. table.concat(natives, ",") .. "~~" .. line .. "~~" .. window .. "~~" .. table.concat(logs, " / ")`);
    const [stopped, natives, line, window, logs] = out.split("~~");
    if (logs === undefined) throw new Error(out.slice(0, 2000));
    expect(logs).not.toContain("draw call failed");
    expect(natives).toBe("cet_overlay:false,cet_overlay:true,cet_overlay:false");
    expect(line).toContain("pos:16,16");
    expect(line).toContain(`var:${bindings.enums.ImGuiStyleVar!.indexOf("WindowPadding")}:12.0,8.0`);
    expect(line).toContain("same:26.0,nil");
    expect(line).toContain("dot@fg:54.0,68.4,4.0");
    expect(stopped).toContain("Stopped \u00b7 reconnect in the CET window");
    expect(stopped).not.toContain("wrapped:");
    expect(stopped?.match(/text:XF Runtime Bridge/g)?.length).toBe(1);
    expect(line).toContain("begin:XF Runtime Bridge##indicator");
    expect(window).toContain("begin:XF Runtime Bridge");
    expect(out).not.toContain("failed:");
    expect(out).not.toMatch(/^run:/);
  });

  test("0.8.23: one build-version title, ordered sections, only the question in a card, and Danger last", () => {
    const out = drawPanel(`local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done" } } })
      s.info.plugin_version = "0.8.23"; s.info.save_lock = { save_anyway = true }
      return draw(s)`);
    expect(out).toContain("begin:XF Runtime Bridge 0.8.23###xf_runtime_bridge");
    const names = ["text:STATUS", "text:QUESTION FROM XF STUDIO", "text:SESSION", "text:SAVES", "text:COMMENT FOR XF STUDIO", "text:KEYS", "text:DANGER"];
    const positions = names.map((n) => out.indexOf(n));
    expect(positions.every((n) => n >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a,b) => a-b));
    expect(out.match(/XF Runtime Bridge/g)?.length).toBe(1);
    expect(out).not.toContain("Version ");
    expect(out).not.toContain("child:##xf_card_keys");
    expect(out).not.toContain("child:##xf_card_diagnostics");
    expect(out).toContain("button:Save anyway");
    expect(out.indexOf("button:Stop the bridge")).toBeGreaterThan(out.indexOf("button:Send##xf_comment_send"));
  });

  test("0.8.23: submits the 70 percent height constraint, scroll-compatible flags and a three-line field", () => {
    const out = drawPanel(`return draw(state())`);
    expect(out).toContain("cap:396.0,1120.0"); // 1600px display, theme's 13px font
    expect(out).toContain("field:312.0,54.0"); // 3 x 14px lines + 2 x 6px padding; Send occupies the row's right
    expect(out).toContain("button:Send##xf_comment_send");
    const body = panel.slice(panel.indexOf("function panel.body"));
    expect(body).toContain("ImGuiWindowFlags.AlwaysAutoResize");
    expect(body).not.toMatch(/ImGuiWindowFlags.NoScroll(?:bar|WithMouse)/);
    expect(out).toContain(`var:${bindings.enums.ImGuiStyleVar!.indexOf("FrameBorderSize")}:1,nil`);
    expect(out).toContain(`var:${bindings.enums.ImGuiStyleVar!.indexOf("ItemSpacing")}:8.0,8.0`);
    expect(out).not.toContain("failed:");
  });

  test("review Low: simulated overflow clips Danger at the top and makes it reachable by scrolling inside the height cap", () => {
    for (const displayHeight of [1080, 1600]) {
      const out = drawPanel(`GetDisplayResolution = function() return 2560, ${displayHeight} end
        scrollModel = { offset = 0, items = {} }
        local s = state()
        for i = 1, 200 do s.info.kill_key.warnings[i] = "A key warning." end
        local scrollToBottom = false
        local begin = IMPL.Begin
        IMPL.Begin = function(name, flags)
          local shown = begin(name, flags)
          if scrollToBottom then ImGui.SetScrollY(ImGui.GetScrollMaxY()) end
          return shown
        end
        draw(s); local top = draw(s) -- auto-fit has measured the overflowing content
        local topDanger = string.find(top, "button:Stop the bridge", 1, true) ~= nil
        local overflow = (scrollModel.maxScroll or 0) > 0
        local capped = scrollModel.height == ${displayHeight} * 0.7
        scrollToBottom = true; local bottom = draw(s)
        local bottomDanger = string.find(bottom, "button:Stop the bridge", 1, true) ~= nil
        local danger = scrollModel.items["button:Stop the bridge"] or {}
        return table.concat({ tostring(capped), tostring(overflow), tostring(topDanger), tostring(bottomDanger),
          tostring(danger.fullyVisible == true), tostring((scrollModel.offset or 0) > 0) }, ",")`);
      expect(out).toBe("true,true,false,true,true,true");
    }
  });

  test("0.8.23: a primary or danger button failure restores the style and window stacks", () => {
    for (const label of ["Reconnect", "Stop the bridge"]) {
      const out = drawPanel(`local s = state(); s.info.bridge.killed = ${label === "Reconnect" ? "true" : "false"}
        IMPL.Button = function(text) if text == "${label}" then error("button rejected") end; return false end
        local ok = pcall(function() draw(s) end)
        return tostring(ok) .. ":" .. pc .. "," .. pv .. "|" .. table.concat(calls, "|")`);
      expect(out).toStartWith("false:0,0|");
      expect(out).toEndWith("end");
    }
  });

  test("0.8.23: Status Resume and Diagnostics growth keep the click-settle guard on controls below them", () => {
    const out = drawPanel(`local s = state(); local queued = {}
      local function frame()
        calls, curY = {}, 0
        panel.draw(s, function(name) queued[#queued + 1] = name end, THEME)
      end
      IMPL.CollapsingHeader = function() return false end
      frame(); queued = {}
      IMPL.Button = function(label) curY = curY + 22; return label == "Mark this moment" or label == "Stop the bridge" end
      s.info.bridge.writes_paused = true
      T = T + 0.1; frame(); local guarded = #queued
      T = T + 0.5; frame(); local settled = #queued
      queued = {}; IMPL.Button = function(label) curY = curY + 22; return label == "Stop the bridge" end
      IMPL.CollapsingHeader = function() return true end
      T = T + 0.1; frame()
      local killed = false; for _, name in ipairs(queued) do if name == "kill" then killed = true end end
      return guarded .. "," .. settled .. "," .. tostring(killed)`);
    expect(out).toBe("0,2,false");
  });

  // cet.panel's CET side against a stand-in plugin that keeps the protocol: requests are sent until completed (a header until a
  // draw reports it in header_done; a press until it is claimed), a press runs only after a claim the plugin grants.
  const panelRig = (opts: { requests: string; info: string; claim?: "granted" | "refused"; open?: boolean }) => `${IMPL}
      handlers, DECODE, natives, reports, claims, diagnostics = {}, {}, {}, {}, {}, {}
      registerForEvent = function(name, fn) handlers[name] = fn end
      registerHotkey = function() end
      logs = {}
      local function logLine(line) logs[#logs + 1] = line end
      spdlog = { info = logLine, warning = logLine, error = logLine, debug = logLine }
      GetVersion = function() return "1.37.1" end
      local headerDone = {}
      json = {
        decode = function(s) return DECODE[s] end,
        encode = function(t)
          if t.claim then claims[#claims + 1] = t.claim; return "CLAIM" end
          if t.diagnostics_set ~= nil then return t.diagnostics_set and "DIAG_ON" or "DIAG_OFF" end
          reports[#reports + 1] = t
          for _, d in ipairs(t.header_done or {}) do headerDone[d.id] = d end
          return "REPORT"
        end }
      package.preload["panel"] = function() return (function() ${panel} end)() end
      package.preload["theme"] = function() return (function() ${theme} end)() end
      Game = setmetatable({ XFBridge_Info = function() return "INFO" end, XFBridge_Hud = function() return "xfhud\\t1\\nsurface\\tcet_line\\nkeys\\t1\\n" end,
        XFBridge_Messages = function() return "" end, XFBridge_Ping = function() return "pong" end,
        XFBridge_CetPanel = function(body)
          if body == "DIAG_ON" or body == "DIAG_OFF" then
            diagnostics[#diagnostics + 1] = body; return "DIAG_OK"
          end
          if body == "CLAIM" then return "${opts.claim === "refused" ? "CLAIM_NO" : "CLAIM_OK"}" end
          -- the stand-in keeps a header request until a draw completes it, and a press until it is claimed
          local pending = {}
          for _, r in ipairs(DECODE.ALL) do
            local keep = {}
            if r.diagnostics_open ~= nil and not headerDone[r.id] then keep.diagnostics_open = r.diagnostics_open end
            if r.press and #claims == 0 then keep.press = r.press end
            if next(keep) then keep.id = r.id; pending[#pending + 1] = keep end
          end
          DECODE.PENDING = pending
          return #pending > 0 and "PENDING" or ""
        end,
        XFBridge_PauseWrites = function(paused) natives[#natives + 1] = "pause:" .. tostring(paused); return "PAUSED" end },
        { __index = function() return function() return "" end end })
      DECODE.INFO = ${opts.info}
      DECODE.ALL = ${opts.requests}
      DECODE.PAUSED = { changed = true, writes_paused = true }
      DECODE.DIAG_OK = { applied = true }
      DECODE.CLAIM_OK = { claimed = true }
      DECODE.CLAIM_NO = { claimed = false, why = "cancelled: the bridge was stopped" }
      local function boot() return (function() ${init} end)() end
      local mod = boot()
      handlers.onInit()
      ${opts.open ? "handlers.onOverlayOpen()" : ""}`;
  const INFO = (extra = "") => `{ plugin_version = "0.8.22", bridge = { enabled = true, listening = true, killed = false, allow_writes = true }, overlay = { theme = "dark", motion = "full" },
        status = { label = "XF Runtime Bridge", tone = "write", chip = "Changes allowed" } ${extra} }`;

  test("cet.panel: the header opens once through SetNextItemOpen right before it, a draw completes it with the state before, and a press runs once after its claim", () => {
    const out = runCet(`${panelRig({ requests: `{ { id = 1, diagnostics_open = true }, { id = 2, press = "pause_changes" } }`, info: INFO(), open: true })}
      handlers.onUpdate(0.3) -- polls: the requests come in, the press is queued
      handlers.onUpdate(0.3) -- claims and runs the press; polls again (the same requests are sent again: no second press)
      handlers.onUpdate(0.3)
      calls = {}; handlers.onDraw(); local first = table.concat(calls, "|")
      calls = {}; handlers.onDraw(); local second = table.concat(calls, "|")
      handlers.onUpdate(0.3) -- reports the completed header
      local r = reports[#reports]
      local done = r.header_done and r.header_done[1] or {}
      return table.concat(natives, ",") .. "~~" .. #claims .. "~~" .. first .. "~~" .. second .. "~~" ..
        table.concat({ tostring(done.id), tostring(done.previous), tostring(r.diagnostics_open), tostring(r.chip), tostring(r.surface),
          tostring(r.last_press and r.last_press.id), tostring(r.last_press and r.last_press.answer and r.last_press.answer.writes_paused) }, ",") ..
        "~~" .. table.concat(logs, " / ")`);
    const [natives, claims, first, second, report, logs] = out.split("~~");
    if (logs === undefined) throw new Error(out.slice(0, 2000));
    expect(natives).toBe("pause:true"); // once, though the request came three times
    expect(claims).toBe("1");
    expect(first).toMatch(/setnextopen:true\|(scale:[\d.]+\|)?header:DIAGNOSTICS##xf_diagnostics/);
    expect(second).not.toContain("setnextopen:");
    expect(second).not.toContain("child:##xf_card_diagnostics");
    expect(second).toContain("Diagnostics is shown in the XF box.");
    // the header before the request was never drawn: its earlier state is unknown (nil), and the report says it was applied
    expect(report).toBe("1,nil,true,Changes allowed,cet_window,2,true");
    expect(logs).not.toContain("draw call failed");
  });

  test("0.8.23 Diagnostics: the disclosure notifies the existing native ingress on update, once per change", () => {
    const out = runCet(`${panelRig({ requests: `{ { id = 1, diagnostics_open = true } }`, info: INFO(), open: true })}
      handlers.onUpdate(0.3); handlers.onDraw()
      local before = #diagnostics
      handlers.onUpdate(0.3); handlers.onDraw(); handlers.onUpdate(0.3)
      IMPL.CollapsingHeader = function() return false end
      handlers.onDraw(); handlers.onUpdate(0.3)
      return before .. "|" .. table.concat(diagnostics, ",")`);
    expect(out).toBe("0|DIAG_ON,DIAG_OFF");
  });

  test("review Medium: close, queue a close request, reopen and undo restores the known Diagnostics state", () => {
    const out = runCet(`${panelRig({ requests: `{ { id = 1, diagnostics_open = true } }`, info: INFO(), open: true })}
      local headerOpen, nextOpen = false, nil
      IMPL.SetNextItemOpen = function(value) nextOpen = value end
      IMPL.CollapsingHeader = function()
        if nextOpen ~= nil then headerOpen, nextOpen = nextOpen, nil end
        return headerOpen
      end
      handlers.onUpdate(0.3); handlers.onDraw(); handlers.onUpdate(0.3) -- open and report
      handlers.onOverlayClose()
      DECODE.ALL = { { id = 2, diagnostics_open = false } }
      handlers.onUpdate(0.3) -- receive the close request while CET is closed
      handlers.onOverlayOpen(); handlers.onDraw(); handlers.onUpdate(0.3)
      local previous = nil
      for _, done in ipairs(reports[#reports].header_done or {}) do if done.id == 2 then previous = done.previous end end
      -- Channel::Request({undo:2}) only queues a header change when the reported previous value is known.
      DECODE.ALL = previous ~= nil and { { id = 3, diagnostics_open = previous } } or {}
      handlers.onUpdate(0.3); handlers.onDraw(); handlers.onUpdate(0.3)
      return tostring(previous) .. "," .. tostring(headerOpen) .. "|" .. table.concat(diagnostics, ",")`);
    expect(out).toBe("true,true|DIAG_ON,DIAG_OFF,DIAG_ON");
  });

  test("review Medium: reopening re-notifies an open native card once, and leaves an unchanged closed card alone", () => {
    for (const open of [true, false]) {
      const out = runCet(`${panelRig({ requests: `{}`, info: INFO(), open: true })}
        IMPL.CollapsingHeader = function() return ${open} end
        handlers.onUpdate(0.3); handlers.onDraw(); handlers.onUpdate(0.3)
        handlers.onOverlayClose(); handlers.onOverlayOpen()
        handlers.onDraw(); handlers.onUpdate(0.3); handlers.onDraw(); handlers.onUpdate(0.3)
        return table.concat(diagnostics, ",")`);
      expect(out).toBe(open ? "DIAG_ON,DIAG_ON" : "");
    }
  });

  test("cet.panel: a press whose claim is refused (a kill came first) never reaches XFBridge_PauseWrites; a stopped bridge queues none", () => {
    const refused = runCet(`${panelRig({ requests: `{ { id = 3, press = "pause_changes" } }`, info: INFO(), claim: "refused" })}
      handlers.onUpdate(0.3); handlers.onUpdate(0.3); handlers.onUpdate(0.3)
      local r = reports[#reports]
      return table.concat(natives, ",") .. "~~" .. #claims .. "~~" .. tostring(r.last_press and r.last_press.refused)`);
    expect(refused).toBe("~~1~~cancelled: the bridge was stopped");
    const killed = runCet(`${panelRig({ requests: `{ { id = 4, press = "pause_changes" } }`, info: INFO().replace("killed = false", "killed = true") })}
      handlers.onUpdate(0.3); handlers.onUpdate(0.3)
      return table.concat(natives, ",") .. "~~" .. #claims`);
    expect(killed).toBe("~~0");
  });

  test("cet.panel: a header request survives a CET reload until a draw applies it, and the window's earlier state is captured", () => {
    const out = runCet(`${panelRig({ requests: `{ { id = 5, diagnostics_open = true } }`, info: INFO() })}
      handlers.onUpdate(0.3) -- received, overlay closed: not drawn
      mod = boot(); handlers.onInit(); handlers.onOverlayOpen() -- Reload all mods: a fresh layer, nothing remembered
      handlers.onUpdate(0.3) -- the plugin sends it again
      calls = {}; handlers.onDraw(); local first = table.concat(calls, "|")
      handlers.onUpdate(0.3)
      local r = reports[#reports]
      local done = r.header_done and r.header_done[1] or {}
      return tostring(string.find(first, "setnextopen:true", 1, true) ~= nil) .. "," .. tostring(done.id)`);
    expect(out).toBe("true,5");
    // A header over a window that drew it closed: the state before is captured as false.
    const known = runCet(`${panelRig({ requests: `{}`, info: INFO(), open: true })}
      IMPL.CollapsingHeader = function(label) calls[#calls + 1] = "header:" .. label; return false end
      handlers.onUpdate(0.3); calls = {}; handlers.onDraw() -- drawn closed
      DECODE.ALL = { { id = 6, diagnostics_open = true } }
      handlers.onUpdate(0.3); calls = {}; handlers.onDraw(); handlers.onUpdate(0.3)
      local r = reports[#reports]
      local done = r.header_done and r.header_done[#r.header_done] or {}
      return tostring(done.id) .. "," .. tostring(done.previous)`);
    expect(known).toBe("6,false");
  });
});
