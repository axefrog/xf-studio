// Borg 2 regressions (0.8.17): the UI channel flood, stale catch-up "latest", event-armed captures cancelled by
// historical gaps, the supervisor's V reference case and the false heat alert.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { catchUp } from "../testing/timeline.ts";
import { EventCaptures } from "../testing/event-captures.ts";
import type { Json, TestApi } from "../testing/windows.ts";
import { projectDir } from "./helpers.ts";

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

test("1. the CET U adapter records a surface on change plus a low-rate heartbeat, not at the look rate", () => {
  const source = JSON.stringify(readFileSync(join(projectDir, "cet", "xf_runtime_bridge", "test-input.lua"), "utf8"));
  const result = runLua(`
    local enabled, records = true, {}
    json = { encode = function(body) records[#records + 1] = { reason = body.reason, surface = body.surface, drawn = body.drawn, text = body.texts and body.texts[1] }; return '{}' end }
    Game = { XFBridge_RecordEnabled = function() return enabled end, XFBridge_Record = function() return true end }
    ImGui = { GetWindowPos = function() return { x = 20, y = 30 } end, GetWindowSize = function() return 100, 80 end }
    local adapter = assert(load(${source}))()
    local function look(seconds)
      for _ = 1, math.floor(seconds / 0.1 + 0.5) do
        adapter.advance(0.1)
        adapter.ui('cet_line', { drawn = true, texts = { 'same line' }, rect = adapter.windowRect() })
        adapter.ui('cet_window', { drawn = false, save_button_drawn = false })
      end
    end
    look(20)
    -- 200 looks per surface used to be 400 records; now one change each plus a heartbeat about every 2 s.
    assert(#records >= 2 and #records <= 24, 'unchanged surfaces are not re-recorded each look: ' .. #records)
    assert(records[1].reason == 'change' and records[2].reason == 'change', 'the first look records the state')
    local heartbeats = 0
    for i = 3, #records do assert(records[i].reason == 'heartbeat', 'only heartbeats while nothing changes'); heartbeats = heartbeats + 1 end
    assert(heartbeats >= 16, 'a heartbeat keeps proving coverage: ' .. heartbeats)
    local before = #records
    adapter.advance(0.1)
    adapter.ui('cet_line', { drawn = true, texts = { 'new line' }, rect = adapter.windowRect() })
    assert(#records == before + 1 and records[#records].reason == 'change' and records[#records].text == 'new line', 'a change is recorded at once')
    -- A new recorder run starts with a fresh baseline, not after a heartbeat wait.
    enabled = false; adapter.advance(0.1); adapter.ui('cet_line', { drawn = true, texts = { 'new line' }, rect = adapter.windowRect() })
    assert(#records == before + 1)
    enabled = true; adapter.advance(0.1); adapter.ui('cet_line', { drawn = true, texts = { 'new line' }, rect = adapter.windowRect() })
    assert(#records == before + 2 and records[#records].reason == 'change')
    return 'ok'
  `);
  expect(result).toBe("ok");
});
