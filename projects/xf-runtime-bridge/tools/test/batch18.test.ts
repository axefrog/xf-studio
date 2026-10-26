// Bridge 0.8.4: session 11's findings on the tools' side, offline: game_wait lets the main pipe go between its polls (two
// processes against the self-test host), a showroom sweep hides photo mode's menu for its captures and puts it back, the
// save's test hook (test.save.delay) with the kill switch landing inside the save, and the CET comment box's word wrap (the
// panel's own Lua under fengari, when the toolchain has it). Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BridgeResponse } from "../bridge-lib.ts";
import type { CommandContext } from "../api/catalogue.ts";
import { findCommand, saveClientTimeoutMs } from "../api/catalogue.ts";
import { REFUSALS } from "../api/catalogue080.ts";
import { CommandApi, type CommandOutcome } from "../api/command-api.ts";
import { runShowroomRotate, SWEEP_CAPTURE } from "../showroom/commands.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const codeOf = (outcome: CommandOutcome) => (outcome.ok ? "ok" : outcome.error.code);
const answer = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });
const ALL = "photo,world,character,save,showroom,inventory,player";
const fixture = join(projectDir, "tools", "test", "fixtures", "showroom-manifest.json");
const apiFor = (host: Host) => new CommandApi({ runtimeDir: host.dir, auditDir: join(host.dir, "logs"), captureRoot: join(host.dir, "captures") });

describe("0.8.4 E (session 11): game_wait lets the main pipe go between its polls", () => {
  test("with a fake transport: each poll opens the pipe and closes it again", async () => {
    const dir = tempDir("xfb-084-wait-");
    let opened = 0, closed = 0;
    const api = new CommandApi({
      runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), idleCloseMs: 60_000,
      transport: async () => {
        opened++;
        return { call: async () => answer({ phase: "gameplay" }), close: () => void closed++ };
      },
    });
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.json"), JSON.stringify({ sid: "s", pid: process.pid, pipe: "\\\\.\\pipe\\none", token: "t", protocol: 1 }));
    const out = await api.run("game.wait", { phase: "photo_mode", timeout_ms: 1600 });
    expect(codeOf(out)).toBe("wait_timeout");
    expect(opened).toBeGreaterThanOrEqual(3);
    expect(closed).toBeGreaterThanOrEqual(opened - 1);
    api.close();
  });

  describe("two processes against the self-test host", () => {
    let host: Host;
    beforeAll(async () => {
      host = await startSelftestHost([], 120);
    }, HOOK_TIMEOUT_MS);
    afterAll(async () => {
      await host?.stop();
    });

    test("while another process's game_wait polls, game_status here answers at once (session 11: bridge_busy after 8 s)", async () => {
      const script = `const { CommandApi } = await import(${JSON.stringify(join(projectDir, "tools", "api", "command-api.ts"))});
const api = new CommandApi({ runtimeDir: ${JSON.stringify(host.dir)}, auditDir: ${JSON.stringify(join(host.dir, "logs-child"))} });
console.log("waiting");
const out = await api.run("game.wait", { phase: "photo_mode", timeout_ms: 6000 });
console.log("done " + (out.ok ? "ok" : out.error.code));
api.close();`;
      const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let printed = decoder.decode((await reader.read()).value);
      expect(printed).toContain("waiting");
      await sleep(800); // the child's wait is polling now
      const api = apiFor(host);
      const took: number[] = [];
      const codes: string[] = [];
      for (let i = 0; i < 4; i++) {
        const started = performance.now();
        const status = await api.run("game.status", {});
        took.push(Math.round(performance.now() - started));
        codes.push(codeOf(status));
        api.close(); // a separate connection each time, as separate CLI calls make
        await sleep(300);
      }
      expect(codes).toEqual(["ok", "ok", "ok", "ok"]);
      expect(Math.max(...took)).toBeLessThan(2500);
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        printed += decoder.decode(chunk.value);
      }
      await child.exited;
      expect(printed).toContain("done wait_timeout"); // the wait itself went on undisturbed
    }, 30_000);
  });
});

describe("0.8.4 against the self-test host: sweeps in photo mode, the save's test hook", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL, "--allow-test-hooks"], 180);
    api = apiFor(host);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });
  const phase = async (value: string) => {
    const response = await api.callBridge("selftest.phase", { phase: value }, "t-phase");
    expect(response.ok).toBe(true);
  };

  test("G2 (session 11): a sweep in photo mode hides photo mode's menu for its captures and shows it again after", async () => {
    await phase("gameplay");
    expect(codeOf(await api.run("showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], anchor: "v", distance_m: 2 }))).toBe("ok");
    await phase("photo_mode");
    const calls: string[] = [];
    const context = {
      api: {
        callBridge: async (method: string, params: Record<string, unknown>, cid: string, timeout?: number) => {
          calls.push(method === "photo.hud.hide" ? `hud:${String(params.hidden)}` : method);
          return api.callBridge(method, params, cid, timeout);
        },
        session: () => true,
        captureTarget: () => ({ hwnd: 0n }),
      },
      cid: "t-sweep",
      captureRoot: tempDir("xfb-084-sweep-"),
    } as unknown as CommandContext;
    const original = SWEEP_CAPTURE.capture;
    SWEEP_CAPTURE.capture = ((options: Any) => {
      calls.push("capture");
      return { view: { path: join(options.outDir, `${options.name}.png`), width: 8, height: 8 }, full: null } as Any;
    }) as never;
    let out: Any;
    try {
      out = (await runShowroomRotate({ sweep: { steps: 2, capture: true, settle_ms: 0 } }, context)).value;
    } finally {
      SWEEP_CAPTURE.capture = original;
    }
    expect(out.photo_menu_hidden_for_sweep).toBe(true);
    const hud = calls.filter((c) => c.startsWith("hud:"));
    expect(hud).toEqual(["hud:true", "hud:false"]);
    expect(calls.indexOf("hud:true")).toBeLessThan(calls.indexOf("capture"));
    expect(calls.lastIndexOf("hud:false")).toBeGreaterThan(calls.lastIndexOf("capture"));
    const state = await api.run("game.status", {});
    expect(state.ok && [(state.result as Any).ui_hidden, (state.result as Any).cursor_hidden]).toEqual([false, false]);
    await phase("gameplay");
    await api.run("showroom.clear", {});
  });

  test("the review of 0.8.4: a sweep puts the menu and the cursor back each as it was (menu hidden, cursor shown)", async () => {
    await phase("gameplay");
    expect(codeOf(await api.run("showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], anchor: "v", distance_m: 2 }))).toBe("ok");
    await phase("photo_mode");
    // The menu hidden, the cursor shown: hide both, then show the cursor alone.
    expect((await api.callBridge("photo.hud.hide", { hidden: true, cursor: true }, "t-hud")).ok).toBe(true);
    expect((await api.callBridge("photo.hud.hide", { hidden: false, cursor: true }, "t-hud")).ok).toBe(true);
    expect((await api.callBridge("photo.hud.hide", { hidden: true, cursor: false }, "t-hud")).ok).toBe(true);
    const before = (await api.run("game.status", {})) as Any;
    expect([before.result.ui_hidden, before.result.cursor_hidden]).toEqual([true, false]);
    const context = { api, cid: "t-sweep3", captureRoot: tempDir("xfb-084-sweep3-") } as unknown as CommandContext;
    const original = SWEEP_CAPTURE.capture;
    SWEEP_CAPTURE.capture = ((options: Any) => ({ view: { path: join(options.outDir, `${options.name}.png`), width: 8, height: 8 }, full: null }) as Any) as never;
    try {
      const out = (await runShowroomRotate({ sweep: { steps: 1, capture: true, settle_ms: 0 } }, context)).value as Any;
      expect(out.photo_menu_hidden_for_sweep).toBe(true);
      expect(out.photo_menu_warning).toBeUndefined();
    } finally {
      SWEEP_CAPTURE.capture = original;
    }
    const after = (await api.run("game.status", {})) as Any;
    expect([after.result.ui_hidden, after.result.cursor_hidden]).toEqual([true, false]);
    await phase("gameplay");
    await api.run("showroom.clear", {});
  });

  test("a sweep outside photo mode needs no menu hidden and says so", async () => {
    await phase("gameplay");
    expect(codeOf(await api.run("showroom.spawn", { manifest: fixture, presets: ["Gloss A · as before"], anchor: "v", distance_m: 2 }))).toBe("ok");
    const context = { api, cid: "t-sweep2", captureRoot: tempDir("xfb-084-sweep2-") } as unknown as CommandContext;
    const original = SWEEP_CAPTURE.capture;
    SWEEP_CAPTURE.capture = ((options: Any) => ({ view: { path: join(options.outDir, `${options.name}.png`), width: 8, height: 8 }, full: null }) as Any) as never;
    try {
      const out = (await runShowroomRotate({ sweep: { steps: 1, capture: true, settle_ms: 0 } }, context)).value as Any;
      expect(out.photo_menu_hidden_for_sweep).toBe(false);
    } finally {
      SWEEP_CAPTURE.capture = original;
    }
    await api.run("showroom.clear", {});
  });

  test("L1 (session 11): test.save.delay holds the next save after prepare, so a kill from a second process lands inside it", async () => {
    await phase("gameplay");
    const armed = await api.run("test.save.delay", { ms: 4000 });
    expect(codeOf(armed)).toBe("ok");
    expect((armed as Any).result.armed_ms).toBe(4000);
    const started = performance.now();
    const save = api.run("game.save", { name: "XF L1 test", override_lock: true });
    await sleep(600);
    const second = apiFor(host);
    const kill = await second.run("bridge_kill", {});
    expect(codeOf(kill)).toBe("ok");
    const saved = await save;
    expect(codeOf(saved)).not.toBe("ok"); // nothing saved: the kill landed in the hold
    expect(performance.now() - started).toBeLessThan(3500);
    expect(host.log.join("\n")).toContain("game.save.held");
    second.close();
  }, 30_000);

  test("the catalogue: test.save.delay is a save-permission hook with its refusal, and the save's client timeout covers its longest hold", () => {
    const command = findCommand("test.save.delay")!;
    expect(command.permission).toBe("write-save");
    expect(REFUSALS["test.save.delay"]).toContain("test_hooks_off");
    expect(saveClientTimeoutMs(20000)).toBeGreaterThanOrEqual(20000 + 10000);
  });
});

describe("0.8.4 test hooks are off unless config.ini allows them", () => {
  let host: Host;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 60);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await host?.stop();
  });
  test("refused test_hooks_off without [bridge] allow_test_hooks", async () => {
    const api = apiFor(host);
    expect(codeOf(await api.run("test.save.delay", { ms: 1000 }))).toBe("test_hooks_off");
    api.close();
  });
});

// --- the CET comment box's word wrap, the panel's own Lua under fengari (Lua 5.3; the game runs LuaJIT) -------------------

const FENGARI = process.env.XFB_FENGARI ?? "D:/Dev/tools/fengari/0.1.5/node_modules/fengari";

describe.skipIf(!existsSync(FENGARI))("0.8.4 the CET comment box wraps at words (panel.lua under fengari)", () => {
  const run = (body: string): string => {
    const require = createRequire(import.meta.url);
    const { lua, lauxlib, lualib, to_luastring } = require(FENGARI);
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    const panelSource = readFileSync(join(projectDir, "cet", "xf_runtime_bridge", "panel.lua"), "utf8");
    const code = `local panel = (function() ${panelSource} end)()\n${body}`;
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) return `load: ${lua.lua_tojsstring(L, -1)}`;
    if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `run: ${lua.lua_tojsstring(L, -1)}`;
    return lua.lua_tojsstring(L, -1);
  };

  // A stub of CET's ImGui: every call recorded; Button answers whether its label was "clicked" this frame.
  const STUB = `
    local calls = {}
    local clicked = {}
    local buttonY = {}
    local frameTime = 10
    local y = 0
    local any = setmetatable({}, { __index = function() return 1 end })
    ImGuiCol, ImGuiStyleVar, ImGuiWindowFlags, ImGuiInputTextFlags = any, any, any, setmetatable({ EnterReturnsTrue = 32, ReadOnly = 16384 }, { __index = function() return nil end })
    ImGuiKey = setmetatable({}, { __index = function(_, k) return k end })
    ImGui = setmetatable({
      BeginChild = function() return true end, EndChild = function() end,
      Begin = function() return true end,
      GetFontSize = function() return 14 end,
      GetTime = function() return frameTime end,
      GetCursorPosY = function() return y end,
      SetCursorPosY = function(pos) y = pos end,
      CalcTextSize = function(s) return #s * 7, 14 end,
      Button = function(label) calls[#calls + 1] = "button:" .. label; buttonY[label] = y; y = y + 20; return clicked[label] == true end,
      SameLine = function() calls[#calls + 1] = "sameline" end,
      Text = function(t) calls[#calls + 1] = "text:" .. tostring(t); y = y + 16 end,
      TextColored = function(r, g, b, a, t) calls[#calls + 1] = "text:" .. tostring(t); y = y + 16 end,
      TextDisabled = function(t) calls[#calls + 1] = "text:" .. tostring(t); y = y + 16 end,
      TextWrapped = function(t) calls[#calls + 1] = "text:" .. tostring(t); y = y + 16 end,
      InputTextMultiline = function(label, text) return text, false end,
      IsItemActive = function() return false end,
      IsItemHovered = function() return false end,
      IsKeyPressed = function() return false end,
      IsKeyDown = function() return false end,
    }, { __index = function() return function() return false end end })
    local queued = {}
    local function queue(name, arg) queued[#queued + 1] = name end
    local function state(extra)
      local s = { info = { plugin_version = "0.8.6", answer_keys = { "IK_F6", "IK_F7", "IK_F8", "IK_F11" },
        bridge = { enabled = true, listening = true, killed = false, allow_writes = true },
        status = { connection = "Connected to XF Studio", connection_tone = "ok" },
        kill_key = { enabled = true, label = "Ctrl + Shift + End", default = "Ctrl + Shift + End", is_default = true, warnings = {}, notes = {} } },
        comment = "", keysArmed = true }
      for k, v in pairs(extra or {}) do s[k] = v end
      return s
    end
    local function draw(s) calls = {}; buttonY = {}; y = 0; frameTime = frameTime + 0.1; panel.draw(s, queue, nil); return calls end
  `;

  test("the window draws: four long answers wrap onto rows, the Keys line shows the key and Change..., and shorter content keeps the rows in place", () => {
    const out = run(`${STUB}
      local s = state({ pendingAsk = { id = 7, text = "Which one?", choices = { "Diamond and label", "Diamond only, no label", "Nothing at all here", "Something else entirely" } } })
      local c = draw(s)
      -- rows: count sameline calls directly before an answer button
      local same, answers = 0, 0
      for i, call in ipairs(c) do
        if string.find(call, "##xf_answer_", 1, true) then
          answers = answers + 1
          if c[i - 1] == "sameline" then same = same + 1 end
        end
      end
      local keys, change = false, false
      for _, call in ipairs(c) do
        if string.sub(call, 1, 9) == "text:KEYS" then keys = true end
        if string.find(call, "Change...", 1, true) then change = true end
      end
      local tallHeight = s.layoutHeight
      local tallY = buttonY
      local function rowsStayed()
        for _, label in ipairs({ "Pause changes", "Mark this moment", "Stop the bridge", "Send##xf_comment_send", "Change...##xf_killkey_change" }) do
          if tallY[label] == nil or buttonY[label] ~= tallY[label] then return false end
        end
        return s.layoutHeight == tallHeight
      end
      -- UI-221: answering keeps the tallest slot while open, so these controls do not move or need a new click guard.
      frameTime = frameTime + 1
      s.pendingAsk = nil
      s.answeredAsk = { id = 7, text = "Which one?", label = "Nothing at all here" }
      clicked["Mark this moment"] = true
      draw(s)
      local answeredStayed = rowsStayed()
      local accepted = #queued == 1 and queued[1] == "mark"
      clicked = {}
      s.answeredAsk = nil
      draw(s)
      local emptyStayed = rowsStayed()
      -- init.lua calls opened on the next overlay opening: only then may the reserved space shrink.
      panel.opened(s)
      draw(s)
      local reopenedShorter = buttonY["Mark this moment"] < tallY["Mark this moment"] and s.layoutHeight < tallHeight
      return table.concat({ answers, same, tostring(keys), tostring(change), tostring(answeredStayed), tostring(emptyStayed), tostring(accepted), tostring(reopenedShorter) }, ",")`);
    // 4 answers of 17 to 23 characters at 7 px each against a 392 px row (0.8.7: the window's buttons name no key): the first two
    // share a row, the third and the fourth another.
    expect(out).toBe("4,2,true,true,true,true,true,true");
  });

  test("a taller question moves the rows and ignores clicks for 400 ms, then accepts them", () => {
    const out = run(`${STUB}
      local s = state()
      draw(s)
      local oldY = buttonY["Mark this moment"]
      -- A question arriving in an already drawn empty window really does grow its slot.
      s.pendingAsk = { id = 7, text = "Which one?", choices = { "Diamond and label", "Diamond only, no label", "Nothing at all here", "Something else entirely" } }
      clicked["Mark this moment"] = true
      draw(s)
      local moved = buttonY["Mark this moment"] > oldY
      local ignored = #queued == 0
      frameTime = frameTime + 0.2
      draw(s) -- 300 ms since the move, still inside the guard
      local stillIgnored = #queued == 0
      frameTime = frameTime + 0.2
      draw(s) -- 600 ms since the move, outside the guard
      return table.concat({ tostring(moved), tostring(ignored), tostring(stillIgnored), tostring(#queued), tostring(queued[1]) }, ",")`);
    expect(out).toBe("true,true,true,1,mark");
  });

  test("the window draws stopped, capturing a key, and with a refused key, without errors", () => {
    const out = run(`${STUB}
      local stopped = state({})
      stopped.info.bridge.killed = true
      stopped.info.writes_used = true
      local a = table.concat(draw(stopped), "|")
      local capturing = state({ killKeyCapture = true })
      local b = table.concat(draw(capturing), "|")
      -- 0.8.6 (P2): a refusal takes the reserved line once the capture has ended (it can only arrive then).
      local refused = state({ killKeyRefused = "F6 answers XF Studio's questions." })
      local c = table.concat(draw(refused), "|")
      return tostring(string.find(a, "Saving stays locked", 1, true) ~= nil) .. "," .. tostring(string.find(a, "connection key", 1, true) == nil)
        .. "," .. tostring(string.find(b, "Press the new key", 1, true) ~= nil) .. "," .. tostring(string.find(c, "F6 answers", 1, true) ~= nil)
        .. "," .. tostring(string.find(b, "Version 0.8.6", 1, true) == nil)`);
    expect(out).toBe("true,true,true,true,true");
  });

  test("the review of 0.8.4: undo after deleting across a wrapped line gives the soft break back, so Send keeps the space", () => {
    const out = run(`
      local measure = function(line) return #line end
      local state = { commentSoft = {} }
      local function edit(old, new, typed)
        state.commentSoft = panel.trackSoft(state, old, new, typed)
        local wrapped, soft = panel.wrap(new, state.commentSoft, measure, 10)
        state.commentSoft = soft
        panel.rememberSoft(state, wrapped, soft)
        return wrapped
      end
      local typed = edit("", "aaaa bbbb cccc dddd eeee", false)          -- typed (pasted) in one go: wrapped
      local deleted = edit(typed, string.sub(typed, 1, 5) .. string.sub(typed, 15), false) -- select "bbbb<break>cccc", delete
      local undone = edit(deleted, typed, false)                           -- Ctrl+Z: the exact earlier text
      local a = panel.unwrap(undone, state.commentSoft)
      -- Undo after a rewrap: the restored span carries a line break whose earlier state is remembered at that place.
      state = { commentSoft = {} }
      local w1 = edit("", "aaaa bbbb cccc dddd eeee", false)
      local cut = string.sub(w1, 1, 5) .. string.sub(w1, 15)
      local w2 = edit(w1, cut, false)
      local changed = edit(w2, w2 .. " ffff", false)                         -- more typing, then undo puts the span back
      local restored = string.sub(changed, 1, 5) .. string.sub(w1, 6, 14) .. string.sub(changed, 6)
      state.commentSoft = panel.trackSoft(state, changed, restored, false)
      local b = panel.unwrap(restored, state.commentSoft)
      -- A line break the player typed with Enter is never taken for a soft one, even where one used to be.
      state = { commentSoft = {} }
      local w3 = edit("", "aaaa bbbb cccc", false)
      local joined = edit(w3, "aaaa bbbbcccc", false)
      state.commentSoft = panel.trackSoft(state, joined, "aaaa bbbb\\ncccc", true)
      local c = panel.unwrap("aaaa bbbb\\ncccc", state.commentSoft)
      return a .. "|" .. b .. "|" .. c`);
    expect(out).toBe("aaaa bbbb cccc dddd eeee|aaaa bbbb cccc dddd eeee ffff|aaaa bbbb\ncccc");
  });

  test("a long line breaks at spaces within the width; the text keeps its length; sending turns the breaks back into spaces", () => {
    const out = run(`
      local text = "the quick brown fox jumps over the lazy dog and keeps running far away"
      local wrapped, soft = panel.wrap(text, {}, function(line) return #line end, 20)
      local lines = {}
      for line in string.gmatch(wrapped .. "\\n", "([^\\n]*)\\n") do lines[#lines + 1] = line end
      local longest = 0
      for _, line in ipairs(lines) do if #line > longest then longest = #line end end
      return table.concat({ tostring(#wrapped == #text), tostring(longest <= 20), tostring(#lines),
        tostring(panel.unwrap(wrapped, soft) == text) }, ",")`);
    expect(out).toBe("true,true,4,true");
  });

  test("the player's own line breaks stay; a word longer than the line stays whole", () => {
    const out = run(`
      local text = "short line\\nanother short one here\\nsupercalifragilistic word"
      local wrapped, soft = panel.wrap(text, {}, function(line) return #line end, 12)
      local hard = 0
      for _ in string.gmatch(panel.unwrap(wrapped, soft), "\\n") do hard = hard + 1 end
      return tostring(hard) .. "|" .. wrapped`);
    expect(out).toBe("2|short line\nanother\nshort one\nhere\nsupercalifragilistic\nword");
  });

  test("an edit before a soft break moves it; deleting words rewraps (breaks are chosen afresh), the cursor's index unchanged", () => {
    const out = run(`
      local text = "aaaa bbbb cccc dddd eeee"
      local wrapped, soft = panel.wrap(text, {}, function(line) return #line end, 10)
      -- the player inserts "zz " at the start of the box
      local edited = "zz " .. wrapped
      local carried = panel.carrySoft(wrapped, edited, soft)
      local again, soft2 = panel.wrap(edited, carried, function(line) return #line end, 10)
      -- then deletes "zz " again: the breaks return to where they were
      local back = string.sub(again, 4)
      local carried2 = panel.carrySoft(again, back, soft2)
      local final = panel.wrap(back, carried2, function(line) return #line end, 10)
      return wrapped .. "|" .. again .. "|" .. final .. "|" .. tostring(#again == #edited)`);
    expect(out).toBe("aaaa bbbb\ncccc dddd\neeee|zz aaaa\nbbbb cccc\ndddd eeee|aaaa bbbb\ncccc dddd\neeee|true");
  });
});
