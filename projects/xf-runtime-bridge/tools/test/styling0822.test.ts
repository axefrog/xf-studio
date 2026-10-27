// Bridge 0.8.22: the in-game styling, built from the Studio's "In-game surfaces" table (the style guide's section 09,
// projects/xf-studio/authoring/src/studio-ui/style-guide/in-game-theme.ts). Offline: the generator and what it writes, the
// overlay host's source (five baked fonts, bars on XfLine, time-based motion), the CET layer under fengari (font scale per
// role, BeginChild and its fallback, the dot's pulse on the foreground draw list, the chips), the ink panel's new answer flash,
// the motion setting and the chip labels in the plugin's sources. Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CET_SCALE_RANGE, IMGUI_COLOUR_SLOTS, IN_GAME_THEME, XF_COLOUR_SLOTS } from "../../../xf-studio/authoring/src/studio-ui/style-guide/in-game-theme";
import { buildTheme, generated, LUA_OUT, MAPPING, NATIVE_OUT, ruleDeclaration, STUDIO_CSS, themeHash } from "../overlay/theme.ts";
import { FLASH_EASE_S, FLASH_HOLD_S, FLASH_TOTAL_S, flashFrame, restOpacity, simulate } from "../overlay/ink-flash.ts";
import { projectDir, tempDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(STUDIO_CSS, "utf8");
const FENGARI = process.env.XFB_FENGARI ?? "D:/Dev/tools/fengari/0.1.5/node_modules/fengari";
const IMGUI_HEADER = join(projectDir, "build", "dependency-sources", "imgui-src", "imgui.h");

const runLua = (code: string): string => {
  const require = createRequire(import.meta.url);
  const { lua, lauxlib, lualib, to_luastring } = require(FENGARI);
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) return `load: ${lua.lua_tojsstring(L, -1)}`;
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) return `run: ${lua.lua_tojsstring(L, -1)}`;
  return lua.lua_tojsstring(L, -1);
};

describe("0.8.22 the theme generator reads the Studio's in-game table", () => {
  const theme = buildTheme(css);

  test("it writes every slot the table has: the pinned ImGui 1.92.9 colours and the XF semantic slots, nothing else", () => {
    const written = theme.colors.map((c) => c.name).sort();
    expect(written).toEqual([...IMGUI_COLOUR_SLOTS, ...XF_COLOUR_SLOTS].sort());
    expect(MAPPING.length + IN_GAME_THEME.ruleColours.length).toBe(written.length);
    // 63 ImGui slots and 17 XF slots (the brief said 66 ImGui slots; the pinned enum has 63).
    expect(IMGUI_COLOUR_SLOTS.length).toBe(63);
    expect(XF_COLOUR_SLOTS.length).toBe(18);
  });

  test("Border takes --line-strong and CheckMark --signal; the soft line is the XfLine alias; every new alias slot the table marks is written", () => {
    const token = (name: string) => theme.colors.find((c) => c.name === name)!.token;
    expect(token("Border")).toBe("--line-strong");
    expect(token("CheckMark")).toBe("--signal");
    expect(token("XfLine")).toBe("--line");
    expect(token("CheckboxSelectedBg")).toBe("--signal-bg");
    const added = IN_GAME_THEME.colours.filter((c) => c.added).map((c) => c.slot);
    expect(added.length).toBe(24); // the brief counted 19; the table marks 17 ImGui aliases and 6 XF ones
    for (const slot of added) expect(theme.colors.some((c) => c.name === slot), slot).toBe(true);
  });

  test("every slot of the pinned imgui.h enum is written, and nothing is written that the header lacks", () => {
    if (!existsSync(IMGUI_HEADER)) return; // the dependency sources are fetched by the build
    const header = readFileSync(IMGUI_HEADER, "utf8");
    const start = header.search(/^enum ImGuiCol_$/m);
    const enumText = header.slice(start, header.indexOf("ImGuiCol_COUNT", start)); // the obsolete aliases follow COUNT
    const names = [...enumText.matchAll(/ImGuiCol_(\w+)\s*(?:,|=|\/)/g)].map((m) => m[1]!).filter((n) => n !== "COUNT" && n !== "_COUNT");
    const imgui = new Set(names);
    for (const name of IMGUI_COLOUR_SLOTS) expect(imgui.has(name), `imgui.h lacks ${name}`).toBe(true);
    for (const name of imgui) expect(IMGUI_COLOUR_SLOTS as readonly string[]).toContain(name);
  });

  test("the metrics, rule values and type roles come from the table and the stylesheet", () => {
    expect(theme.metrics.map((m) => m.name).sort()).toEqual(IN_GAME_THEME.metrics.map((m) => m.name).sort());
    const value = (name: string) => theme.values.find((v) => v.name === name)!.value;
    expect(value("DisabledAlpha")).toBe(0.45);
    expect(value("SweepSeconds")).toBe(1.1);
    expect(value("PulsePeriodMs")).toBe(IN_GAME_THEME.motion.pulsePeriodMs);
    expect(value("SettleGapMs")).toBe(IN_GAME_THEME.motion.settleGapMs);
    expect(value("LabelledBarAlpha")).toBe(0.3);
    expect(theme.metrics.find((m) => m.name === "ScrollbarSize")!.value).toBe(8);
    // five roles; sizes 15, 11, 13, 12, 12; the CET scale is the size over the 13 px body, inside the spec's range
    expect(theme.types.map((t) => [t.role, t.size])).toEqual([["title", 15], ["eyebrow", 11], ["body", 13], ["label", 12], ["value", 12]]);
    for (const t of theme.types) {
      expect(t.scale).toBeGreaterThanOrEqual(CET_SCALE_RANGE[0]);
      expect(t.scale).toBeLessThanOrEqual(CET_SCALE_RANGE[1]);
    }
    expect(theme.types.find((t) => t.role === "body")!.scale).toBe(1);
    expect(theme.types.map((t) => [t.role, t.weight])).toEqual(IN_GAME_THEME.type.map((t) => [t.role, t.weight]));
    // UI-190 (main 6084c397): the Studio keeps the number on :root, no longer on .btn:disabled
    expect(ruleDeclaration(css, ":root", "--disabled-alpha")).toBe(".45");
    expect(value("DisabledAlpha")).toBe(0.45);
  });

  test("a number the Studio moves to a custom property of :root (--disabled-alpha) reads the same, and moving it does not change the tables' hash", () => {
    expect(ruleDeclaration([":root { --a: 1; }", ":root { --disabled-alpha: .45; }", ".btn:disabled { cursor: not-allowed; }"].join(String.fromCharCode(10)), ":root", "--disabled-alpha")).toBe(".45");
    expect(ruleDeclaration([":root { --disabled-alpha: .45; }", "@media print { :root { --disabled-alpha: .9; } }"].join(String.fromCharCode(10)), ":root", "--disabled-alpha")).toBe(".45");
    const moved = theme.values.map((v) => (v.name === "DisabledAlpha" ? { ...v, source: ":root --disabled-alpha" } : v));
    expect(themeHash({ ...theme, values: moved })).toBe(theme.tokens_sha256);
    expect(themeHash({ ...theme, values: moved.map((v) => (v.name === "DisabledAlpha" ? { ...v, value: 0.5 } : v)) })).not.toBe(theme.tokens_sha256);
  });

  test("the committed tables are what the generator writes, and --check fails on a stylesheet that would change them", () => {
    const { native, lua } = generated();
    expect(read("native", "src", "core", "overlay", "ThemeTable.inc")).toBe(native);
    expect(read("cet", "xf_runtime_bridge", "theme.lua")).toBe(lua);
    expect(NATIVE_OUT.replace(/\\/g, "/")).toContain("core/overlay/ThemeTable.inc");
    expect(LUA_OUT.replace(/\\/g, "/")).toContain("xf_runtime_bridge/theme.lua");
    const changed = join(tempDir("xfb-b22-css-"), "studio.css");
    writeFileSync(changed, `${css}\n:root { --signal: oklch(.5 .2 20); }\n`);
    const run = spawnSync("bun", [join(projectDir, "tools", "overlay", "theme.ts"), "--check", "--css", changed], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("out of date");
  }, 30_000); // spawns the generator as a separate Bun process: about 12 s under full-suite load

  test("the native table has one line per entry, the CET table loads and carries the type roles", () => {
    const native = read("native", "src", "core", "overlay", "ThemeTable.inc");
    expect((native.match(/^XF_THEME_COLOR\(/gm) ?? []).length).toBe(81);
    expect((native.match(/^XF_THEME_METRIC\(/gm) ?? []).length).toBe(IN_GAME_THEME.metrics.length);
    expect((native.match(/^XF_THEME_VALUE\(/gm) ?? []).length).toBe(8);
    expect((native.match(/^XF_THEME_TYPE\(/gm) ?? []).length).toBe(5);
    expect(native).toContain('XF_THEME_FONT(display, L"bahnschrift.ttf")');
    // review 4: the Studio's weights (600 for the title and eyebrow roles) reach the native table and CET's
    expect(native).toContain("XF_THEME_TYPE(title, display, 15.0f, 600, false)");
    expect(native).toContain("XF_THEME_TYPE(eyebrow, display, 11.0f, 600, true)");
    expect(native).toContain("XF_THEME_TYPE(body, ui, 13.0f, 400, false)");
    expect(read("cet", "xf_runtime_bridge", "theme.lua")).toContain('title = { face = "display", size = 15, weight = 600,');
    if (!existsSync(FENGARI)) return;
    const out = runLua(`local t = (function() ${read("cet", "xf_runtime_bridge", "theme.lua")} end)()
      return table.concat({ t.types.title.scale, t.types.eyebrow.scale, t.types.body.scale, t.values.PulsePeriodMs, t.values.DisabledAlpha,
        tostring(t.colors.CheckboxSelectedBg ~= nil), tostring(t.colors.XfLine ~= nil), t.metrics.ScrollbarSize }, ",")`);
    expect(out).toBe("1.1538,0.8462,1,2400,0.45,true,true,8");
  });
});

describe("0.8.22 the overlay host's source", () => {
  const overlay = read("native", "src", "plugin", "Overlay.cpp");
  const section = (from: string, to: string) => overlay.slice(overlay.indexOf(from), overlay.indexOf(to, overlay.indexOf(from)));

  test("five fonts, one per type role, baked in BuildFonts only and never per frame", () => {
    const build = section("void BuildFonts()", "void SrvAlloc");
    for (const role of ["title", "eyebrow", "body", "label", "value"]) expect(build).toContain(`"${role}"`);
    expect((build.match(/roleFont\(/g) ?? []).length).toBe(5); // one call per role
    // Fonts are made nowhere but LoadFont; LoadFont is called only from BuildFonts; BuildFonts runs at start and on a resize.
    expect((overlay.match(/AddFontFromFileTTF|AddFontDefault/g) ?? []).length).toBe(2);
    expect((overlay.match(/\bLoadFont\(/g) ?? []).length).toBe(2); // the definition and the lambda in BuildFonts
    expect((overlay.match(/\bBuildFonts\(\)/g) ?? []).length).toBe(3); // the definition, Initialise, and DrawFrame's height change
    expect(overlay).toContain("if (gR.height != gR.fontHeight)");
    const draw = section("void DrawPanel(double aSeconds)", "// RB-99: whether Dear ImGui asks");
    expect(draw).not.toContain("LoadFont");
    expect(draw).not.toContain("BuildFonts");
    expect(draw).not.toContain("std::vector"); // nothing allocates per frame in the panel
    expect(draw).not.toContain("new ");
  });

  test("DisabledAlpha and ScrollbarSize come from the table", () => {
    const theme = section("void ApplyTheme", "// A face's font at a pixel size");
    expect(theme).toContain('style.ScrollbarSize = ThemeMetricOf("ScrollbarSize"');
    expect(theme).toContain('style.DisabledAlpha = xfb::overlay::ThemeValueOf("DisabledAlpha"');
  });

  test("components: heading with the brand mark, key-value rows, cards, the chamfered chip, bars on XfLine", () => {
    for (const name of ["void Heading()", "void KeyValue(", "bool BeginCard(", "void EndCard()", "void Chip(", "void Eyebrow(", "void Bar(", "void ChamferPoints("]) expect(overlay).toContain(name);
    const bar = section("void Bar(", "// A card: a child");
    expect(bar).toContain("c.line"); // the track is XfLine
    expect(bar).toContain('ThemeValueOf("LabelledBarAlpha"'); // a labelled bar's fill is 30 % with no end cap
    expect(bar).not.toMatch(/AddRect\(/); // no border, no cap
    const chip = section("void Chip(", "// The status dot");
    expect(chip).toContain("ChamferPoints(points, min, max, gR.metrics.bevelSmall)");
    expect(chip).toContain("ChipBorderAlpha");
    expect(section("void ChamferPoints(", "enum class Tone")).toContain("aMax.x - aBevel");
  });

  test("the pulse and the settle share the one clock (ImGui::GetTime), are time-based and stand still when motion is reduced", () => {
    const draw = section("void DrawPanel(double aSeconds)", "// RB-99: whether Dear ImGui asks");
    expect(draw).toContain("const double clock = ImGui::GetTime();");
    expect(draw).toContain("gHost->Motion()");
    expect(draw).toContain("xfb::overlay::PulseAlpha(clock, motion.reduced)");
    expect(draw).toContain("gR.statusSettle.Note(tone, clock * 1000.0, motion.reduced)");
    expect(draw).not.toContain("DeltaTime"); // no frame-counted animation
    expect(overlay).toContain("motion.reduced, aSeconds"); // the bars' sweep follows the same setting
  });

  test("the motion setting reaches the plugin: config.ini, the config line, the host, XFBridge_Info", () => {
    expect(read("native", "config", "config.ini")).toMatch(/^motion = auto$/m);
    expect(read("native", "src", "core", "Config.cpp")).toContain('key == "overlay.motion"');
    expect(read("native", "src", "plugin", "Main.cpp")).toContain("SetMotion(motion)");
    const plugin = read("native", "src", "plugin", "Plugin.cpp");
    expect(plugin).toContain('{"motion", MotionNow(state).effective}');
    expect(plugin).toContain("win32::ClientAreaAnimation()");
    expect(read("native", "src", "core", "Win32.cpp")).toContain("SPI_GETCLIENTAREAANIMATION");
    // the animation is skippable when frame generation is on
    expect(read("native", "src", "core", "overlay", "Motion.cpp")).toContain('"frame_generation"');
  });

  test("review 2: frame generation is looked for by the game thread, bounded, whether or not the overlay draws", () => {
    const main = read("native", "src", "plugin", "Main.cpp");
    const plugin = read("native", "src", "plugin", "Plugin.cpp");
    expect((main.match(/RefreshFrameGeneration\(&win32::FrameGenerationModules\)/g) ?? []).length).toBe(2); // at load and in the tick
    expect(plugin).toContain("RefreshFrameGeneration(&win32::FrameGenerationModules)"); // with each info refresh
    // the tick's refresh sits outside the overlay-enabled block
    const tick = main.indexOf("frame generation is looked for here whether or not the overlay draws");
    expect(tick).toBeGreaterThan(0);
    expect(main.indexOf("if (state.overlayHost.Enabled())", tick)).toBeGreaterThan(tick);
    expect(overlay).toContain("win32::FrameGenerationModules()"); // one list of modules, shared
    expect(overlay).not.toContain("std::vector<std::string> FrameGenerationModules()");
  });

  test("review 4: the Studio's weight reaches LoadFont and the approximation is said once per bake", () => {
    expect(overlay).toContain("ImFont* LoadFont(const char* aFace, float aSize, int aWeight)");
    expect(overlay).toContain("type->weight");
    expect(overlay).toContain('log::Info("overlay.fonts", "weights_asked=');
    expect(overlay).toContain("stb_truetype");
  });

  test("the status carries the short chip labels", () => {
    const ink = read("native", "src", "core", "InkUi.cpp");
    for (const label of ["Read-only", "Changes allowed", "Paused", "Stopped"]) expect(ink).toContain(`out.chip = "${label}"`);
    expect(ink).toContain('{"chip", status.chip}');
  });
});

// CET's ImGui, stubbed, recording the calls this layer cares about. The game runs LuaJIT; fengari is Lua 5.3.
const IMGUI = (flags: { child?: boolean; fontScale?: boolean; childMode?: "throws" | "hidden" } = {}) => `
  calls, curY, T, pc, pv = {}, 0, 0, 0, 0
  local function rec(s) calls[#calls + 1] = s end
  local function item(kind, text, h) curY = curY + (h or 14); rec(kind .. ":" .. tostring(text)) end
  ImGuiCol = setmetatable({}, { __index = function(_, k) return k end })
  ImGuiStyleVar = setmetatable({}, { __index = function(_, k) return k end })
  ImGuiWindowFlags, ImGuiCond = ImGuiCol, ImGuiCol
  ImGuiInputTextFlags = { EnterReturnsTrue = 32, ReadOnly = 16384 }
  ImGuiKey = setmetatable({}, { __index = function(_, k) return k end })
  bit32 = { bor = function() return 0 end }
  unpack = table.unpack
  local base = {
    Begin = function(name) rec("begin:" .. tostring(name)); return true end,
    GetFontSize = function() return 13 end,
    GetTime = function() return T end,
    GetCursorPosX = function() return 12 end,
    GetCursorPosY = function() return curY end,
    SetCursorPosX = function() end,
    SetCursorPosY = function(v) curY = v end,
    GetCursorScreenPos = function() return 50, 60 end,
    GetWindowPos = function() return 10, 10 end,
    GetWindowSize = function() return 400, 300 end,
    GetTextLineHeight = function() return 14 end,
    GetWindowDrawList = function() return "wl" end,
    GetForegroundDrawList = function() return "fg" end,
    GetColorU32 = function(r, g, b, a) return string.format("%.3f", a) end,
    ImDrawListAddCircleFilled = function(list, x, y, r, c) rec("dot@" .. list .. ":" .. tostring(c) .. " r=" .. tostring(r)) end,
    ImDrawListAddCircle = function(list, x, y, r, c) rec("ring@" .. list) end,
    ImDrawListAddRectFilled = function() rec("rectfilled") end,
    ImDrawListAddRect = function() rec("rect") end,
    ImDrawListAddQuadFilled = function() rec("quad") end,
    CalcTextSize = function(s) return #s * 7, 14 end,
    Button = function(label) item("button", label, 22); return false end,
    SameLine = function() end,
    Indent = function() end,
    Unindent = function() end,
    Dummy = function(w, h) curY = curY + (h or 0); rec("dummy") end,
    Text = function(t) item("text", t) end,
    TextColored = function(r, g, b, a, t) item("text", t) end,
    TextDisabled = function(t) item("disabled", t) end,
    TextWrapped = function(t) item("wrapped", t) end,
    IsItemHovered = function() return false end,
    IsItemActive = function() return false end,
    IsKeyPressed = function() return false end,
    IsKeyDown = function() return false end,
    InputTextMultiline = function(label, text) return text, false end,
    CollapsingHeader = function(label) rec("header:" .. label); return false end,
    BeginDisabled = function() end,
    EndDisabled = function() end,
    PushStyleColor = function() pc = pc + 1 end,
    PopStyleColor = function(n) pc = pc - (n or 1) end,
    PushStyleVar = function() pv = pv + 1 end,
    PopStyleVar = function(n) pv = pv - (n or 1) end,
  }
  ${flags.fontScale === false ? "" : 'base.SetWindowFontScale = function(s) rec("scale:" .. tostring(s)) end'}
  ${flags.child === false ? "" : flags.childMode === "throws" ? 'base.BeginChild = function(id) error("bad argument #5 to BeginChild") end; base.EndChild = function() rec("endchild") end'
    : flags.childMode === "hidden" ? 'base.BeginChild = function(id) rec("child:" .. tostring(id)); return false end; base.EndChild = function() rec("endchild") end'
    : 'base.BeginChild = function(id) rec("child:" .. tostring(id)); return true end; base.EndChild = function() rec("endchild") end'}
  ImGui = setmetatable(base, { __index = function(_, k)
    ${flags.child === false ? 'if k == "BeginChild" or k == "EndChild" then return nil end' : ""}
    return function() return false end
  end })
`;

describe.skipIf(!existsSync(FENGARI))("0.8.22 the CET layer under fengari", () => {
  const panel = read("cet", "xf_runtime_bridge", "panel.lua");
  const theme = read("cet", "xf_runtime_bridge", "theme.lua");
  const THEME_NAV_R = () => runLua(`local t = (function() ${theme} end)(); return string.format("%.4f", t.colors.NavCursor.dark[1])`);
  const init = read("cet", "xf_runtime_bridge", "init.lua");
  const run = (stub: string, body: string) =>
    runLua(`${stub}
      local panel = (function() ${panel} end)()
      local THEME = (function() ${theme} end)()
      local function info(extra)
        local i = { plugin_version = "0.8.22", answer_keys = {}, bridge = { enabled = true, listening = true, killed = false, allow_writes = true },
          status = { tone = "write", connection = "XF Studio connected", connection_tone = "ok", chip = "Changes allowed" }, overlay = { theme = "dark", motion = "full" },
          kill_key = { enabled = true, label = "Ctrl + Shift + End", default = "Ctrl + Shift + End", is_default = true, warnings = {}, notes = {} } }
        for k, v in pairs(extra or {}) do i[k] = v end
        return i
      end
      local function state(extra)
        local s = { info = info(), comment = "", pluginPresent = true, drawFailed = {}, noteDraw = function(name, why) calls[#calls + 1] = "failed:" .. name end }
        for k, v in pairs(extra or {}) do s[k] = v end
        return s
      end
      local function draw(s) calls, curY = {}, 0; panel.draw(s, function() end, THEME); return table.concat(calls, "|") end
      ${body}`);

  test("each role's text is drawn at its font scale and the scale goes back to 1 after it", () => {
    const out = run(IMGUI(), `return draw(state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done" } } }))`);
    // title 15/13 around the heading's text, eyebrow 11/13 around the chip and the labels, label 12/13 around the version
    expect(out).toContain("scale:1.1538");
    expect(out).toContain("scale:0.8462");
    // The removed version footer no longer introduces label-role text in this window.
    // every non-1 scale is followed, before the next non-1 scale, by a reset to 1
    const scales = [...out.matchAll(/scale:([\d.]+)/g)].map((m) => Number(m[1]));
    for (let i = 0; i < scales.length; i++) if (scales[i] !== 1) expect(scales[i + 1]).toBe(1);
    // and the window ends at scale 1
    expect(scales[scales.length - 1]).toBe(1);
    // every scale used is inside the spec's range
    for (const s of scales) expect(s === 1 || (s >= CET_SCALE_RANGE[0] && s <= CET_SCALE_RANGE[1])).toBe(true);
  });

  test("a CET without SetWindowFontScale draws everything at its own size and does not fail", () => {
    const out = run(IMGUI({ fontScale: false }), `return draw(state())`);
    expect(out).toContain("begin:XF Runtime Bridge");
    expect(out).not.toContain("failed:");
    expect(out).not.toContain("scale:");
  });

  test("cards are child windows (BeginChild/EndChild balanced) with the eyebrow flush inside; without BeginChild the content draws plain", () => {
    const withChild = run(IMGUI(), `local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done", "Not yet" } } })
      draw(s); return draw(s)`);
    expect((withChild.match(/child:/g) ?? []).length).toBe((withChild.match(/endchild/g) ?? []).length);
    expect(withChild).toContain("child:##xf_card_question");
    expect(withChild).not.toContain("child:##xf_card_keys");
    expect(withChild).toContain("text:QUESTION FROM XF STUDIO");
    expect(withChild).toContain("text:KEYS");
    const without = run(IMGUI({ child: false }), `local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done", "Not yet" } } })
      draw(s); return draw(s)`);
    expect(without).not.toContain("child:");
    expect(without).toContain("text:QUESTION FROM XF STUDIO");
    expect(without).toContain("button:Done##xf_answer_1");
    expect(without).toContain("text:KEYS");
  });

  test("review 1: a BeginChild that rejects the call pops exactly what was pushed, is named once, and the content draws plain from then on", () => {
    const out = run(IMGUI({ childMode: "throws" }), `local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done", "Not yet" } } })
      local a = draw(s); local netA = pc .. "," .. pv
      local b = draw(s); local netB = pc .. "," .. pv
      local failures = 0
      for _ in string.gmatch(a .. "|" .. b, "failed:card question at BeginChild") do failures = failures + 1 end
      return table.concat({ netA, netB, failures, tostring(string.find(a, "button:Done##xf_answer_1", 1, true) ~= nil), tostring(string.find(b, "button:Done##xf_answer_1", 1, true) ~= nil),
        tostring(string.find(a .. b, "endchild", 1, true) == nil), tostring(s.childFailed) }, ";")`);
    // the style stack is balanced after both frames, one log line in all, the answers drawn each time, no EndChild without a begin
    expect(out).toBe("0,0;0,0;1;true;true;true;true");
  });

  test("review 1: a child that says it is not visible still gets its EndChild, its pops, and no content", () => {
    const out = run(IMGUI({ childMode: "hidden" }), `local s = state({ pendingAsk = { id = 1, text = "Ready?", choices = { "Done" } } })
      local a = draw(s)
      local begins, ends = 0, 0
      for _ in string.gmatch(a, "child:") do begins = begins + 1 end
      for _ in string.gmatch(a, "endchild") do ends = ends + 1 end
      return table.concat({ pc .. "," .. pv, begins > 0 and begins == ends and "paired" or "unpaired:" .. begins .. "/" .. ends,
        tostring(string.find(a, "button:Done##xf_answer_1", 1, true) == nil), tostring(s.childFailed) }, ";")`);
    expect(out).toBe("0,0;paired;true;nil");
  });

  test("review 3: a colour ImGui renamed (NavCursor was NavHighlight before 1.91.4) is found under its older name, and the exact name wins when both exist", () => {
    const run2 = (cols: string) => runLua(`${IMGUI()}
      ImGuiCol = { ${cols} }
      local pushed = {}
      ImGui.PushStyleColor = function(index, r) pushed[#pushed + 1] = index .. "=" .. string.format("%.4f", r) end
      local panel = (function() ${panel} end)()
      local THEME = (function() ${theme} end)()
      local n = panel.pushTheme(THEME, "dark")
      table.sort(pushed)
      return n .. ":" .. table.concat(pushed, ",")`);
    const focus = THEME_NAV_R();
    const old = run2("Text = 0, NavHighlight = 7");
    expect(old).toBe(`2:0=${runLua(`local t = (function() ${theme} end)(); return string.format("%.4f", t.colors.Text.dark[1])`)},7=${focus}`);
    const both = run2("Text = 0, NavHighlight = 7, NavCursor = 9");
    expect(both).toContain("9=");
    expect(both).not.toContain("7=");
    expect(run2("Text = 0")).toMatch(/^1:/);
    // the aliases are only the renames: nothing else is mapped
    expect(panel).toContain("NavCursor = \"NavHighlight\"");
  });

  test("the heading, the status line and the mode chip: brand mark, 'XF Runtime Bridge', the plugin's chip in capitals, the version", () => {
    const out = run(IMGUI(), `return draw(state())`);
    expect(out).toContain("quad"); // the chamfered brand mark
    expect(out).toContain("begin:XF Runtime Bridge 0.8.22###xf_runtime_bridge");
    expect(out).not.toContain("text:XF Runtime Bridge");
    expect(out).toContain("text:TEST"); // the info chip
    expect(out).toContain("text:XF Studio connected."); // the plugin's connection sentence
    expect(out).toContain("text:CHANGES ALLOWED"); // status.chip
    expect(out).not.toContain("disabled:0.8.22");
    const readOnly = run(IMGUI(), `return draw(state({ info = info({ status = { tone = "ok", connection = "XF Studio connected", connection_tone = "ok", chip = "Read-only" },
      bridge = { enabled = true, listening = true, killed = false, allow_writes = false } }) }))`);
    expect(readOnly).toContain("text:READ-ONLY");
  });

  test("the status dot's pulse: alpha follows 1 - 0.4 (0.5 - 0.5 cos(2 pi t / 2.4 s)) on the shared clock, drawn on the draw list", () => {
    const alphaAt = (t: number, motion = "full") =>
      Number(run(IMGUI(), `T = ${t}; local s = state({ info = info({ overlay = { theme = "dark", motion = "${motion}" } }) })
        local c = draw(s); return string.match(c, "dot@wl:([%d.]+) r=") or "none"`));
    expect(alphaAt(0)).toBeCloseTo(1, 2);
    expect(alphaAt(1.2)).toBeCloseTo(0.6, 2);
    expect(alphaAt(2.4)).toBeCloseTo(1, 2);
    expect(alphaAt(0.6)).toBeCloseTo(1 - 0.4 * (0.5 - 0.5 * Math.cos((2 * Math.PI * 0.6) / 2.4)), 2);
    // reduced motion: full alpha at any moment
    expect(alphaAt(1.2, "reduced")).toBeCloseTo(1, 3);
    // stopped, paused and off do not pulse (a stopped bridge does not breathe)
    const stopped = Number(run(IMGUI(), `T = 1.2; local s = state({ info = info({ status = { tone = "killed", connection = "Stopped.", connection_tone = "killed", chip = "Stopped" },
      bridge = { enabled = true, listening = true, killed = true } }) }); local c = draw(s); return string.match(c, "dot@wl:([%d.]+) r=") or "none"`));
    expect(stopped).toBeCloseTo(1, 3);
    const paused = run(IMGUI(), `T = 1.2; local s = state({ info = info({ status = { tone = "paused", connection = "XF Studio connected", connection_tone = "ok", chip = "Paused" } }) }); return draw(s)`);
    expect(paused).toContain("ring@wl");
    expect(paused).toContain("text:PAUSED");
  });

  test("the settle runs once per change, at most once per 2 s, and never under reduced motion", () => {
    const strength = (script: string) => runLua(`${IMGUI()}
      local panel = (function() ${panel} end)()
      local THEME = (function() ${theme} end)()
      local slot = {}
      ${script}`);
    expect(strength(`panel.noteSettle(THEME, slot, "ok", 0, false); return tostring(panel.settleNow(THEME, slot, 10))`)).toBe("0.0");
    expect(strength(`panel.noteSettle(THEME, slot, "ok", 0, false); panel.noteSettle(THEME, slot, "paused", 1000, false); return string.format("%.3f", panel.settleNow(THEME, slot, 1000))`)).toBe("1.000");
    expect(strength(`panel.noteSettle(THEME, slot, "ok", 0, false); panel.noteSettle(THEME, slot, "paused", 1000, false)
      return tostring(panel.settleNow(THEME, slot, 1700))`)).toBe("0.0"); // over after 600 ms
    expect(strength(`panel.noteSettle(THEME, slot, "ok", 0, false); local a = panel.noteSettle(THEME, slot, "paused", 1000, false)
      local b = panel.noteSettle(THEME, slot, "ok", 2500, false); local c = panel.noteSettle(THEME, slot, "write", 3100, false)
      return tostring(a) .. tostring(b) .. tostring(c)`)).toBe("truefalsetrue");
    expect(strength(`panel.noteSettle(THEME, slot, "ok", 0, true); local a = panel.noteSettle(THEME, slot, "paused", 1000, true)
      return tostring(a) .. tostring(panel.settleNow(THEME, slot, 1000))`)).toBe("false0.0");
  });

  test("the CET line's dot: the foreground draw list, pulsing with the same clock, still under reduced motion", () => {
    const line = (t: number, motion: string) => runLua(`${IMGUI()}
      ImGuiWindowFlags = setmetatable({ NoDecoration = 1, NoInputs = 2, AlwaysAutoResize = 4, NoSavedSettings = 8, NoFocusOnAppearing = 16 }, { __index = function() return 0 end })
      ImGuiCond = { Always = 1 }
      bit32 = { bor = function() return 0 end }
      ImGui.PushTextWrapPos = function() end; ImGui.PopTextWrapPos = function() end
      handlers, DECODE = {}, {}
      registerForEvent = function(name, fn) handlers[name] = fn end
      registerHotkey = function() end
      spdlog = { info = function() end, warning = function() end, error = function() end, debug = function() end }
      GetVersion = function() return "1.37.1" end
      json = { decode = function(s) return DECODE[s] end, encode = function() return "{}" end }
      package.preload["panel"] = function() return (function() ${panel} end)() end
      package.preload["theme"] = function() return (function() ${theme} end)() end
      package.preload["canvas"] = function() return (function() ${read("cet", "xf_runtime_bridge", "canvas.lua")} end)() end
      Game = setmetatable({ XFBridge_Info = function() return "INFO" end, XFBridge_Hud = function() return "xfhud\\t1\\nsurface\\tcet_line\\nkeys\\t1\\n" end,
        XFBridge_Messages = function() return "" end }, { __index = function() return function() return "" end end })
      DECODE.INFO = { plugin_version = "0.8.22", bridge = { enabled = true, listening = true, killed = false },
        overlay = { theme = "dark", motion = "${motion}" }, status = { label = "XF Runtime Bridge · XF Studio connected · read-only", tone = "ok" } }
      local mod = (function() ${init} end)()
      handlers.onInit(); handlers.onUpdate(1)
      T = ${t}
      calls = {}
      handlers.onDraw()
      return table.concat(calls, "|")`);
    const alpha = (frame: string) => Number(/dot@fg:([\d.]+) r=/.exec(frame)?.[1]);
    expect(alpha(line(0, "full"))).toBeCloseTo(1, 2);
    expect(alpha(line(1.2, "full"))).toBeCloseTo(0.6, 2);
    expect(alpha(line(1.2, "reduced"))).toBeCloseTo(1, 3);
  });

  test("a CET that lacks the colours the newer ImGui has (CheckboxSelectedBg, tab overlines) pushes only the ones it knows", () => {
    const out = runLua(`${IMGUI()}
      ImGuiCol = { Text = 0, WindowBg = 1, Border = 2 }
      local pushed = {}
      ImGui.PushStyleColor = function(index) pushed[#pushed + 1] = index end
      local panel = (function() ${panel} end)()
      local THEME = (function() ${theme} end)()
      local colours = panel.pushTheme(THEME, "dark")
      return tostring(colours) .. "," .. table.concat(pushed, ",")`);
    // the order of pairs() is not fixed: the count and the set
    const [count, ...indexes] = out.split(",");
    expect(Number(count)).toBe(3);
    expect(indexes.map(Number).sort()).toEqual([0, 1, 2]);
  });
});

describe("0.8.22 the ink panel's answer flash", () => {
  test("one hold in the danger colour for 0.45 s and an ease back over 0.25 s, replacing the 0.15 s alternation", () => {
    expect(FLASH_HOLD_S).toBe(0.45);
    expect(FLASH_EASE_S).toBe(0.25);
    expect(FLASH_TOTAL_S).toBeCloseTo(0.7, 10);
    expect(flashFrame(0)).toEqual({ colour: "danger", opacity: 1 });
    expect(flashFrame(0.44)).toEqual({ colour: "danger", opacity: 1 });
    expect(flashFrame(0.46)!.colour).toBe("rest");
    expect(flashFrame(0.46)!.opacity).toBeLessThan(0.6);
    expect(flashFrame(0.69)!.opacity).toBeGreaterThan(0.95);
    expect(flashFrame(0.7)).toBeNull();
    expect(restOpacity(0.45)).toBeCloseTo(0.3, 10);
    expect(restOpacity(0.7)).toBe(1);
    // monotone ease
    let previous = 0;
    for (let t = 0.45; t <= 0.7; t += 0.005) {
      const o = restOpacity(t);
      expect(o).toBeGreaterThanOrEqual(previous);
      previous = o;
    }
  });

  test("the colour changes twice in 0.7 s (about 2.9 a second at the very most, once to the danger colour and once back), never the old 3.3 a second sustained", () => {
    for (const fps of [30, 60, 120]) {
      const r = simulate(fps);
      expect(r.changes).toBe(2);
      expect(r.maxOpacityStep).toBeLessThan(0.35); // a fade, never a flash
    }
    // The old flash: red and yellow every 0.15 s for 0.9 s = 6 changes in 0.9 s.
    expect(6 / 0.9).toBeGreaterThan(3.3);
  });

  test("the redscript carries the same numbers as the mirror, and no 0.15 alternation any more", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toMatch(/func FlashHold\(\) -> Float \{\s*return 0\.45;/);
    expect(ink).toMatch(/func FlashEase\(\) -> Float \{\s*return 0\.25;/);
    expect(ink).toContain("this.m_flash = XFInkStyle.FlashHold() + XFInkStyle.FlashEase();");
    expect(ink).not.toContain("this.m_flash / 0.15");
    expect(ink).not.toContain("this.m_flash = 0.9;");
    // the hold binds the danger style; the ease only rises the resting colour's opacity (no hex, no token of the Studio's)
    const step = ink.slice(ink.indexOf("public func Step(dt: Float)"), ink.indexOf("private func ChipOpacity"));
    expect(step).toContain('n"MainColors.Red"');
    expect(step).toContain("XFInkStyle.FlashRestOpacity(elapsed)");
    expect(ink).toMatch(/return 0\.3;/);
    expect(ink).toContain("1.0 - (1.0 - t) * (1.0 - t)");
    expect(ink).toContain("return 0.3 + 0.7 * eased;");
  });
});

describe("0.8.22 documentation hooks", () => {
  test("knowledge/ink-ui.md points at the Studio's theme table and its offline tests", () => {
    const page = readFileSync(join(projectDir, "..", "..", "knowledge", "ink-ui.md"), "utf8");
    expect(page).toContain("projects/xf-studio/authoring/src/studio-ui/style-guide/in-game-theme.ts");
    expect(page).toContain("tests/in-game-theme.test.ts");
    expect(page).toContain("`CheckboxSelectedBg`");
  });

  test("the version is 0.8.23 in the build and the tools", () => {
    expect(read("native", "CMakeLists.txt")).toMatch(/VERSION 0\.8\.23/);
    expect(JSON.parse(read("package.json")).version).toBe("0.8.23");
  });
});
