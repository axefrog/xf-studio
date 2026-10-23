// Bridge 0.8.5: the UI review's N1-N4 and fixes 8-9 in the XF Runtime Bridge window and the CET line, "stop key" in every
// player-facing text, and the question sound's wiring. The window's own Lua runs under fengari (Lua 5.3; the game runs
// LuaJIT) with a stub of CET's ImGui that records every call and lays items out in rows. Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { projectDir } from "./helpers.ts";

const FENGARI = process.env.XFB_FENGARI ?? "D:/Dev/tools/fengari/0.1.5/node_modules/fengari";
const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");

describe.skipIf(!existsSync(FENGARI))("0.8.5 the XF Runtime Bridge window (panel.lua under fengari)", () => {
  const run = (body: string): string => {
    const require = createRequire(import.meta.url);
    const { lua, lauxlib, lualib, to_luastring } = require(FENGARI);
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    const code = `local panel = (function() ${read("cet", "xf_runtime_bridge", "panel.lua")} end)()\n${body}`;
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) return `load: ${lua.lua_tojsstring(L, -1)}`;
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `run: ${lua.lua_tojsstring(L, -1)}`;
    return lua.lua_tojsstring(L, -1);
  };

  // CET's ImGui, stubbed: 14 px text at 7 px a character, padding and gaps of 8 px (the theme's defaults when none is given),
  // so the text width (28 em) is 392 px. Each item's row width and the cursor's height are tracked; every call is recorded.
  const STUB = `
    local calls, rows, keyRows = {}, {}, {}
    local x, y, same, disabled = 0, 0, false, 0
    local frameTime = 10
    local any = setmetatable({}, { __index = function(_, k) return k end })
    ImGuiCol, ImGuiStyleVar, ImGuiWindowFlags = any, any, any
    ImGuiInputTextFlags = setmetatable({ EnterReturnsTrue = 32, ReadOnly = 16384 }, { __index = function() return nil end })
    ImGuiKey = setmetatable({}, { __index = function(_, k) return k end })
    -- An item starts a new row (adding its height) unless SameLine came just before it.
    local function item(kind, label, width, h)
      if not same then
        x = 0
        rows[#rows + 1] = 0
        y = y + h
      end
      same = false
      x = x + width
      rows[#rows] = math.max(rows[#rows], x)
      if string.find(tostring(label), "xf_killkey", 1, true) then keyRows[#rows] = true end
      calls[#calls + 1] = kind .. ":" .. tostring(label) .. (disabled > 0 and " [disabled]" or "")
    end
    ImGui = setmetatable({
      Begin = function() calls[#calls + 1] = "begin"; return true end,
      SetNextWindowBgAlpha = function(a) calls[#calls + 1] = "bgalpha:" .. tostring(a) end,
      PushStyleVar = function(i, v) calls[#calls + 1] = "var:" .. tostring(i) .. "=" .. tostring(v) end,
      PushStyleColor = function(i, r, g, b, a) calls[#calls + 1] = "colour:" .. tostring(i) .. "=" .. table.concat({ r, g, b, a }, ",") end,
      GetFontSize = function() return 14 end,
      GetTime = function() return frameTime end,
      GetCursorPosY = function() return y end,
      CalcTextSize = function(s) return #s * 7, 14 end,
      Button = function(label) item("button", label, #(string.gsub(label, "##.*$", "")) * 7 + 16, 22); return false end,
      SameLine = function() calls[#calls + 1] = "sameline"; same = true; x = x + 8 end,
      Text = function(t) item("text", t, #t * 7, 14) end,
      TextColored = function(r, g, b, a, t) item("text", t .. " {" .. table.concat({ r, g, b, a }, ",") .. "}", #t * 7, 14) end,
      TextDisabled = function(t) item("disabledtext", t, #t * 7, 14) end,
      TextWrapped = function(t) item("text", t, 0, 14) end,
      Dummy = function(w, h) item("dummy", h, 0, h) end,
      BeginDisabled = function(on) disabled = disabled + 1; calls[#calls + 1] = "disable:" .. tostring(on) end,
      EndDisabled = function() disabled = disabled - 1 end,
      InputTextMultiline = function(label, text) return text, false end,
      IsItemActive = function() return false end,
      IsItemHovered = function() return false end,
      IsKeyPressed = function() return false end,
      IsKeyDown = function() return false end,
    }, { __index = function() return function() return false end end })
    local function queue() end
    local THEME = { colors = { XfTextMuted = { dark = { 0.5, 0.5, 0.5, 1 } }, TextDisabled = { dark = { 0.3, 0.3, 0.3, 1 } },
      XfDanger = { dark = { 0.9, 0.4, 0.4, 1 } } }, metrics = {} }
    local function state(extra)
      local s = { info = { plugin_version = "0.8.6", answer_keys = { "IK_F6", "IK_F7", "IK_F8", "IK_F11" },
        bridge = { enabled = true, listening = true, killed = false, allow_writes = true },
        status = { connection = "Connected to XF Studio", connection_tone = "ok" },
        kill_key = { enabled = true, label = "Ctrl + Alt + Page Down", default = "Ctrl + Shift + End", is_default = false, warnings = {},
          notes = { "Ctrl and Alt also dodge, crouch and steer vehicles on their own (and 4 more); holding them for the stop key only matters while V moves." },
          unseen = "Other mods that read the keyboard directly can't be seen from here." } },
        comment = "", keysArmed = true, killKeyChanged = true, killKeySaved = "The stop key is now Ctrl + Alt + Page Down, saved for next time." }
      for k, v in pairs(extra or {}) do s[k] = v end
      return s
    end
    -- Draws one frame; answers its calls and the index of the Keys heading.
    local function draw(s)
      calls, rows, keyRows, x, y, same = {}, {}, {}, 0, 0, false
      frameTime = frameTime + 1
      panel.draw(s, queue, THEME)
      local from = nil
      for i, call in ipairs(calls) do
        if call == "text:Keys" then from = i end
      end
      return calls, from
    end
  `;

  test("N1: the Stop key row never runs past the window's text width, with Reset shown, and the capture prompt's line keeps its height", () => {
    const out = run(`${STUB}
      local idle = state({ killKeySaved = false }) -- 0.8.6 (P2): a saved line would fill the reserved line
      draw(idle)
      local widest, keyRowCount = 0, 0
      for i in pairs(keyRows) do widest = math.max(widest, rows[i]); keyRowCount = keyRowCount + 1 end
      local idleY = y
      local idleCalls = table.concat(calls, "|")
      local capturing = state({ killKeyCapture = true })
      draw(capturing)
      local capY = y
      local capCalls = table.concat(calls, "|")
      local prompt = string.find(capCalls, "Press the new key", 1, true) ~= nil
      local dummy = string.find(idleCalls, "dummy:14", 1, true) ~= nil
      local resetBoth = string.find(idleCalls, "Reset to Ctrl + Shift + End", 1, true) ~= nil and string.find(capCalls, "Reset to Ctrl + Shift + End", 1, true) ~= nil
      return table.concat({ tostring(widest > 0 and widest <= 392), keyRowCount, tostring(idleY == capY), tostring(prompt), tostring(dummy), tostring(resetBoth) }, ",")`);
    // "Stop key", the keycap and Change... on one row (321 px), Reset to Ctrl + Shift + End (205 px) on the next.
    expect(out).toBe("true,2,true,true,true,true");
  });

  test("N3: Keys is a heading line of its own, the key is a keycap (never disabled) and the notes are muted, not disabled", () => {
    const out = run(`${STUB}
      local c, from = draw(state({}))
      local heading = c[from - 1] ~= "sameline" and c[from + 1] ~= "sameline"
      local cap, capDisabled = false, false
      local mutedNotes, disabledNotes = 0, 0
      for _, call in ipairs(c) do
        if string.find(call, "##xf_killkey_cap", 1, true) then cap = true; capDisabled = string.find(call, "[disabled]", 1, true) ~= nil end
        if string.find(call, "stop key only matters", 1, true) or string.find(call, "saved for next time", 1, true) or string.find(call, "can't be seen", 1, true) then
          if string.find(call, "{0.5,0.5,0.5,1}", 1, true) then mutedNotes = mutedNotes + 1 end
          if string.find(call, "disabledtext:", 1, true) == 1 then disabledNotes = disabledNotes + 1 end
        end
      end
      return table.concat({ tostring(heading), tostring(cap), tostring(capDisabled), mutedNotes, disabledNotes }, ",")`);
    expect(out).toBe("true,true,false,3,0");
  });

  test("N4 and fix 8: the window's background is fully opaque, and Stop the bridge is a danger button (clear fill, danger text and border)", () => {
    const out = run(`${STUB}
      local c = draw(state({}))
      local opaque, beforeBegin = false, false
      local stopAt, fill, text, border = nil, false, false, false
      for i, call in ipairs(c) do
        if call == "bgalpha:1" or call == "bgalpha:1.0" then opaque = true end
        if call == "begin" and opaque then beforeBegin = true end
        if string.find(call, "button:Stop the bridge", 1, true) == 1 then stopAt = i end
      end
      for i = (stopAt or 1) - 8, (stopAt or 1) - 1 do
        local call = c[i] or ""
        if call == "colour:Button=0,0,0,0" then fill = true end
        if call == "colour:Text=0.9,0.4,0.4,1" then text = true end
        if call == "colour:Border=0.9,0.4,0.4,1" then border = true end
      end
      local alpha = string.find(table.concat(c, "|"), "var:Alpha=1", 1, true) ~= nil
      return table.concat({ tostring(opaque), tostring(beforeBegin), tostring(alpha), tostring(fill), tostring(text), tostring(border) }, ",")`);
    expect(out).toBe("true,true,true,true,true,true");
  });
});

describe("0.8.5 copy, the CET line and the question sound", () => {
  // Quoted text in a source line, after any comment is cut off (a rough cut: enough for these files).
  const quoted = (source: string, comment: RegExp) =>
    source
      .split(/\r?\n/)
      .map((line) => line.replace(comment, ""))
      .flatMap((line) => line.match(/"[^"]*"/g) ?? []);

  test("N2: no player-facing text says kill key (the window, the notes, refusals, warnings and bridge_info's text)", () => {
    const lua = ["init.lua", "panel.lua"].flatMap((f) => quoted(read("cet", "xf_runtime_bridge", f), /--.*$/));
    const native = ["core/KillKey.cpp", "core/Config.cpp", "plugin/Plugin.cpp"].flatMap((f) => quoted(read("native", "src", f), /\/\/.*$/));
    const offenders = [...lua, ...native].filter((s) => /kill key/i.test(s));
    expect(offenders).toEqual([]);
    expect(native.some((s) => s.includes("for the stop key only matters while V moves"))).toBe(true);
  });

  test("fix 9: the CET line's later lines hang at the status words, not under the dot (0.8.6: the fallback when the dot does not fit in the padding)", () => {
    const init = read("cet", "xf_runtime_bridge", "init.lua");
    const body = init.slice(init.indexOf("local function drawLabelBody"), init.indexOf("local function drawLabel()"));
    expect(body).toMatch(/hang = ImGui\.GetCursorPosX\(\) - startX/);
    expect(body).toMatch(/ImGui\.Indent\(hang\)/);
    expect(body).toMatch(/ImGui\.Unindent\(hang\)/);
    expect(body.indexOf("ImGui.Indent(hang)")).toBeLessThan(body.indexOf("for _, message in ipairs(state.messages)"));
  });

  test("the question sound: config.ini switches it on, the plugin calls XFBridgeSound.Question with the event's name, and the script plays it once through the audio system", () => {
    const ini = read("native", "config", "config.ini");
    expect(ini).toMatch(/^question_sound = true$/m);
    const main = read("native", "src", "plugin", "Main.cpp");
    expect(main).toContain('ScriptCall("XFBridgeSound", "Question", {"String"}, {&event}, "question-sound")');
    expect(main).toContain("SoundNewQuestion(state, scriptsReady);");
    const reds = readdirSync(join(projectDir, "redscript")).filter((f) => f.endsWith(".reds")).map((f) => read("redscript", f)).join("\n");
    expect(reds).toMatch(/public abstract class XFBridgeSound \{\s+public static func Question\(cid: String, eventName: String\) -> String \{/);
    expect(reds).toMatch(/GameInstance\.GetAudioSystem\(game\)/);
    expect(reds).toMatch(/audio\.Play\(StringToName\(eventName\)\);/);
  });
});
