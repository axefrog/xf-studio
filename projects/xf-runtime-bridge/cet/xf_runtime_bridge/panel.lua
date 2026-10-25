-- XF Runtime Bridge: the in-game panel (Cyber Engine Tweaks overlay). Test builds only: the -diagnostic
-- and -writes packages carry this file; the distribution package doesn't, and init.lua then shows its
-- plain details window instead.
--
-- It shows, in plain words, whether XF Studio is connected and whether this build may change the game (the wording every
-- surface shows, made by the plugin: core/InkUi.cpp Summarize). It offers only what the player can do right now:
--   * The coordinator's pending question, directly under the status (0.8, the UI review), with one button per answer and its
--     key in the label (XFBridge_Answer); once answered, "Sent: <answer>. Waiting for the next question." in its place.
--   * Reconnect after the kill switch, without restarting the game (XFBridge_Rearm: the plugin starts a
--     fresh session with a new connection key once it has put back what it changed; XF tools reconnect
--     by themselves).
--   * Pause and resume changes, where this build allows changes at all (XFBridge_PauseWrites). Pausing can
--     only take access away: resuming gives back exactly what the bridge's config.ini allows.
--   * Mark this moment (0.6): a marker in the session's event stream (XFBridge_Note), for the coordinator's session.log; the
--     coordinator also treats it as "ready".
--   * Stop the bridge (the kill switch), on its own row as a danger button (0.8, the UI review; 0.8.5: danger text and border on
--     a clear fill, as the Studio's .btn.danger), while it listens, with the bridge's own stop key beside it (0.8.3, [ui]
--     kill_key: it works in the game without CET). 0.8.4 (the maintainer: make it configurable): the Keys section's Stop key
--     row, where Change... takes the next key pressed, with Ctrl, Shift or Alt held, and Reset puts Ctrl + Shift + End back
--     (XFBridge_KillKey saves either to config.ini); what else may react to the key is said under it. The player-facing name
--     is "stop key" everywhere (0.8.5, the UI review's N2); kill_key is only config.ini's field.
--   * A commentary box (0.7; XFBridge_Comment): Send, or Ctrl+Enter (0.8, session 8's request; 0.8.2: read from the box's own
--     validation, since Ctrl+Enter ends the box's editing before anything after it can see the key). 0.8.4 (session 11: long
--     text ran out of view sideways): the text wraps at words (see drawComment).
-- Buttons only queue an action; init.lua carries it out in onUpdate, never while drawing.
-- 0.7: the window takes the XF Studio theme (theme.lua, generated from the Studio's tokens): dark by default, light when
-- the plugin's [overlay] theme says so; never switched automatically. init.lua themes its label through panel.pushTheme.
--
-- 0.8.22: the Studio's "In-game surfaces" (the style guide's section 09), built from theme.lua alone (no colour or size literal
-- of this file's own except as a fallback where the theme is missing): the heading with the brand mark, the status line with
-- its live dot, the mode chip, the question as a card whose accent edge breathes while it waits, key-value rows, bars, cards
-- and the eyebrow labels. Text takes the type roles through SetWindowFontScale (body 1, title and the smaller roles by the
-- theme's scales, kept inside CET_SCALE_RANGE), set before a role's text and put back to 1 after it. The pulse and the settle
-- run on one clock (ImGui.GetTime) and stand still when the plugin says the motion is reduced (info.overlay.motion).
-- Every call that draws a shape goes through try(): a binding this CET lacks or answers differently is named once in the mod's
-- log (state.noteDraw) and that part draws plain, never taking the window down. Existence is tested with ~= nil, never type():
-- CET's bound functions are not Lua functions (init.lua's status dot found that out in game).

local panel = {}

local GREY = { 0.65, 0.65, 0.65, 1.0 }
local GREEN = { 0.4, 0.9, 0.5, 1.0 }
local AMBER = { 1.0, 0.7, 0.2, 1.0 }
local RED = { 1.0, 0.4, 0.4, 1.0 }
local DEFAULTS = { GREY = GREY, GREEN = GREEN, AMBER = AMBER, RED = RED }
local WRAP_EM = 28

-- Where the content is being drawn (0.8.22): the window's text width, or a card's inner width while one is open.
local cardWidth = nil -- the open card's outer width in pixels, or nil
local cardPad = 0     -- its horizontal padding

-- A theme colour by token (theme.lua), or the fallback.
function panel.colour(theme, which, name, fallback)
  local entry = theme and theme.colors and theme.colors[name]
  return (entry and entry[which]) or fallback
end

-- ---- 0.8.22: the Studio's type roles, motion and metrics ------------------------------------------------------------------------

local ROLE_DEFAULTS = { title = 1.1538, eyebrow = 0.8462, body = 1.0, label = 0.9231, value = 0.9231 }

-- The CET font scale of a type role: theme.lua's (the role's size over the body size, inside the spec's range), else the table above.
function panel.roleScale(theme, role)
  local entry = theme and theme.types and theme.types[role]
  return (entry and entry.scale) or ROLE_DEFAULTS[role] or 1.0
end

-- One metric of the theme in pixels at this font size (the Studio's pixels over its 13 px body, times CET's font size).
function panel.metric(theme, name, fallback)
  local m = theme and theme.metrics or {}
  return (m[name] or fallback) * (panel.k or 1)
end

local function setFontScale(scale)
  if ImGui.SetWindowFontScale ~= nil then
    pcall(function() ImGui.SetWindowFontScale(scale) end)
  end
end

-- Runs fn with a role's font scale in force and puts the scale back to 1 after it, whatever happens.
function panel.inRole(theme, role, fn)
  local scale = panel.roleScale(theme, role)
  if scale ~= 1.0 then setFontScale(scale) end
  local ok, a, b = pcall(fn)
  if scale ~= 1.0 then setFontScale(1.0) end
  if not ok then error(a, 0) end
  return a, b
end

-- The live pulse's alpha at time t seconds on the shared clock: 1 down to 1 - depth and back once per period, eased, never
-- stepped. reduced: always 1. (core/overlay/Motion.cpp PulseAlpha is the same arithmetic.)
function panel.pulseAlpha(theme, t, reduced)
  if reduced then return 1.0 end
  local v = theme and theme.values or {}
  local period, depth = v.PulsePeriodMs or 2400, v.PulseDepth or 0.4
  local phase = ((t or 0) * 1000.0 % period) / period
  return 1.0 - depth * (0.5 - 0.5 * math.cos(2 * math.pi * phase))
end

-- The settle wash's strength (1 down to 0) elapsedMs after it started; 0 before and after. (Motion.cpp SettleStrength.)
function panel.settleStrength(theme, elapsedMs)
  local v = theme and theme.values or {}
  local total = v.SettleMs or 600
  if elapsedMs == nil or elapsedMs < 0 or elapsedMs >= total then return 0.0 end
  local left = 1.0 - elapsedMs / total
  return left * left * left
end

-- One element's settle (slot is a table kept in the state): a change of state starts a settle unless motion is reduced or the last
-- one began less than SettleGapMs ago; the first state seen settles nothing. nowMs is the shared clock in milliseconds.
function panel.noteSettle(theme, slot, stateName, nowMs, reduced)
  local gap = (theme and theme.values and theme.values.SettleGapMs) or 2000
  if not slot.seen then
    slot.seen, slot.name = true, stateName
    return false
  end
  if slot.name == stateName then return false end
  slot.name = stateName
  if reduced or (slot.startedMs and nowMs - slot.startedMs < gap) then return false end
  slot.startedMs = nowMs
  return true
end

function panel.settleNow(theme, slot, nowMs)
  if not slot.startedMs then return 0.0 end
  return panel.settleStrength(theme, nowMs - slot.startedMs)
end

-- Whether motion stands still: the plugin's answer (info.overlay.motion: "reduced" or "full"), from [overlay] motion, Windows'
-- animation-effects setting and frame generation. Without the field, motion runs.
function panel.reduced(state)
  local overlay = state and state.info and state.info.overlay
  return type(overlay) == "table" and overlay.motion == "reduced"
end

-- A call that draws a shape or reads a binding this CET may lack: pcall'd; a failure is named once through state.noteDraw and
-- answers false, so the caller draws plain.
local function try(state, name, fn, ...)
  local ok, a, b, c = pcall(fn, ...)
  if ok then return true, a, b, c end
  if state then
    state.drawFailed = state.drawFailed or {}
    if not state.drawFailed[name] then
      state.drawFailed[name] = true
      if state.noteDraw then state.noteDraw(name, tostring(a)) end
    end
  end
  return false
end

-- Numbers from bindings, never nil or a boolean (a CET that answers oddly must not take the window down).
local function num(v, default)
  if type(v) == "number" then return v end
  return default or 0
end

local function curX() return num(ImGui.GetCursorPosX(), 0) end
local function curY() return num(ImGui.GetCursorPosY(), 0) end
local function lineHeight() return num(ImGui.GetTextLineHeight(), num(ImGui.GetFontSize(), 14)) end

-- The size of a text at the font scale now.
local function textSize(text)
  local w, h = ImGui.CalcTextSize(text)
  return num(w, 7 * #text), num(h, lineHeight())
end

local function xyOf(a, b)
  if type(a) == "table" then return a.x or a[1], a.y or a[2] end
  return a, b
end

local function u32(c, alpha)
  return ImGui.GetColorU32(c[1], c[2], c[3], (c[4] or 1.0) * (alpha or 1.0))
end

-- The window's draw list, else the foreground one.
local function drawList()
  if ImGui.GetWindowDrawList ~= nil then
    local ok, list = pcall(function() return ImGui.GetWindowDrawList() end)
    if ok and list then return list end
  end
  return ImGui.GetForegroundDrawList()
end

local function rectFilled(list, x1, y1, x2, y2, c, alpha)
  ImGui.ImDrawListAddRectFilled(list, x1, y1, x2, y2, u32(c, alpha))
end

local function rectLine(list, x1, y1, x2, y2, c, alpha)
  ImGui.ImDrawListAddRect(list, x1, y1, x2, y2, u32(c, alpha))
end

-- The text width a row may use now: the window's, or the open card's inner width.
local function limitWidth()
  if cardWidth then return cardWidth - cardPad * 2 end
  return ImGui.GetFontSize() * WRAP_EM
end

-- The wrap position in window-local coordinates (a child's own space inside a card).
local function wrapPos()
  if cardWidth then return cardWidth - cardPad end
  return ImGui.GetFontSize() * WRAP_EM
end

local function coloured(colour, text)
  ImGui.TextColored(colour[1], colour[2], colour[3], colour[4], text)
end

local drawKillKey -- 0.8.4, defined with the kill-key controls below

local function wrapped(text)
  ImGui.PushTextWrapPos(wrapPos())
  ImGui.TextWrapped(text)
  ImGui.PopTextWrapPos()
end

local function toneColour(tone)
  if tone == "ok" then return GREEN end
  if tone == "write" or tone == "paused" then return AMBER end
  if tone == "killed" then return RED end
  return GREY
end

-- The connection, in one line and one colour (the plugin's status.connection).
local function connectionLine(state)
  if state.pluginPresent == false then
    return GREY, "The bridge's plugin isn't loaded."
  end
  local info = state.info
  local status = info and info.status
  if type(status) ~= "table" or type(status.connection) ~= "string" then
    return GREY, "Starting..."
  end
  local text = status.connection
  if not string.find(text, "%.$") then
    text = text .. "."
  end
  return toneColour(status.connection_tone), text
end

-- The XF Studio theme: pushes the ImGui colours and metrics the theme table maps from the Studio's tokens, and answers how
-- many colours and style values were pushed (both must be popped). Names this CET's ImGui doesn't have are skipped (CET 1.37.1
-- carries Dear ImGui 1.91.1; theme.lua names every colour of 1.92.9, so the newer ones, such as CheckboxSelectedBg and the
-- tab overlines, find no ImGuiCol entry here and push nothing).
local STYLE_VARS = {
  { "WindowPadding", "WindowPaddingX", "WindowPaddingY" },
  { "FramePadding", "FramePaddingX", "FramePaddingY" },
  { "ItemSpacing", "ItemSpacingX", "ItemSpacingY" },
  { "ItemInnerSpacing", "ItemInnerSpacingX", "ItemInnerSpacingY" },
}
local ROUNDING_VARS = { "WindowRounding", "FrameRounding", "GrabRounding", "PopupRounding", "ScrollbarRounding", "TabRounding", "ChildRounding" }

function panel.pushTheme(theme, which)
  if not theme or not theme.colors then return 0, 0 end
  local colours, vars = 0, 0
  for name, entry in pairs(theme.colors) do
    local index = ImGuiCol[name]
    local c = entry[which]
    if index ~= nil and c then
      ImGui.PushStyleColor(index, c[1], c[2], c[3], c[4])
      colours = colours + 1
    end
  end
  local m = theme.metrics or {}
  local k = ImGui.GetFontSize() / (m.FontSize or 13)
  panel.k = k
  for _, v in ipairs(STYLE_VARS) do
    local index = ImGuiStyleVar[v[1]]
    if index ~= nil and m[v[2]] and m[v[3]] then
      ImGui.PushStyleVar(index, m[v[2]] * k, m[v[3]] * k)
      vars = vars + 1
    end
  end
  for _, name in ipairs(ROUNDING_VARS) do
    local index = ImGuiStyleVar[name]
    if index ~= nil and m.Rounding then
      ImGui.PushStyleVar(index, m.Rounding * k)
      vars = vars + 1
    end
  end
  -- 0.8.22: the Studio's disabled opacity (the .btn:disabled rule) and its thin scrollbars, where this CET has the style vars.
  local values = theme.values or {}
  if ImGuiStyleVar.DisabledAlpha ~= nil and values.DisabledAlpha then
    ImGui.PushStyleVar(ImGuiStyleVar.DisabledAlpha, values.DisabledAlpha)
    vars = vars + 1
  end
  if ImGuiStyleVar.ScrollbarSize ~= nil and m.ScrollbarSize then
    ImGui.PushStyleVar(ImGuiStyleVar.ScrollbarSize, m.ScrollbarSize * k)
    vars = vars + 1
  end
  return colours, vars
end

-- 0.8.4 (the UI review's fix 2: a question arriving or clearing moved the buttons under the pointer, so a click aimed at
-- Pause or Mark could land on Stop the bridge or on an answer): every button ignores clicks for SETTLE_S after the content
-- above it changed height. panel.body notes the question slot's height each frame (panel.noteLayout).
local SETTLE_S = 0.4
local settling = false

function panel.noteLayout(state, height)
  local now = ImGui.GetTime()
  if state.layoutHeight ~= nil and math.abs(height - state.layoutHeight) > 0.5 then
    state.layoutChangedAt = now
  end
  state.layoutHeight = height
  settling = state.layoutChangedAt ~= nil and now - state.layoutChangedAt < SETTLE_S
end

-- UI-221 fix 5: a new opening may shrink the question slot; content changes while open may only grow it.
function panel.opened(state)
  state.questionSlotHeight = nil
  state.layoutHeight = nil
  state.layoutChangedAt = nil
  state.cards = nil -- a card measures itself again
  settling = false
end

-- A button that ignores a click while the layout settles.
local function button(label, target, state)
  local pressed = ImGui.Button(label)
  local activated = false
  if target and state and state.testInput then
    activated = state.testInput.activate(target, not settling, state)
  end
  return (pressed or activated) and not settling, activated or nil, pressed and not settling
end

-- The style's horizontal frame padding and item spacing in pixels (the theme's metrics, as pushTheme scaled them).
local function spacing(theme)
  local m = theme and theme.metrics or {}
  local k = ImGui.GetFontSize() / (m.FontSize or 13)
  return (m.FramePaddingX or 8) * k, (m.ItemSpacingX or 8) * k
end

-- 0.8.5 (the UI review's N1): one wrap rule for rows of controls (the answer buttons, the Stop key row): an item goes on the
-- row while the row still fits the window's text width (WRAP_EM), else it starts the next row, so a control appearing never
-- widens the window. row = { used = 0 } per row; place(row, width) before drawing each item. 0.8.22: inside a card, the card's
-- inner width.
local function place(row, width, gap)
  local limit = limitWidth()
  if row.used > 0 and row.used + gap + width <= limit then
    ImGui.SameLine()
    row.used = row.used + gap + width
  else
    row.used = width
  end
end

-- ---- 0.8.22: the Studio's components -------------------------------------------------------------------------------------------

-- A tone's colours: text, wash and border (a chip's border is the tone at ChipBorderAlpha; the info chip's is XfSignalLine).
local function toneSlots(theme, which, tone)
  local c = function(name, fallback) return panel.colour(theme, which, name, fallback) end
  if tone == "ok" then return c("XfSuccess", GREEN), c("XfSuccessBg", nil), c("XfSuccess", GREEN), true end
  if tone == "write" or tone == "paused" or tone == "warning" then return c("XfWarning", AMBER), c("XfWarningBg", nil), c("XfWarning", AMBER), true end
  if tone == "killed" or tone == "danger" then return c("XfDanger", RED), c("XfDangerBg", nil), c("XfDanger", RED), true end
  if tone == "info" then return c("XfSignal", GREY), c("XfSignalBg", nil), c("XfSignalLine", GREY), false end
  return c("XfTextMuted", GREY), nil, c("XfLine", GREY), false
end

-- The status chip: eyebrow-role capitals in the tone inside the tone's wash and a 1 px border (square corners in CET: the host
-- draws the chamfer, CET keeps it square). hollow: no fill (paused). Takes the cursor's place as an item.
function panel.chip(state, theme, which, label, tone, hollow)
  local text, wash, edge, alphaBorder = toneSlots(theme, which, tone)
  local caps = string.upper(label)
  local borderAlpha = (theme and theme.values and theme.values.ChipBorderAlpha) or 0.5
  local padX, padY = panel.metric(theme, "ChipPaddingX", 8), panel.metric(theme, "ChipPaddingY", 2)
  panel.inRole(theme, "eyebrow", function()
    local tw, th = textSize(caps)
    local w, h = tw + padX * 2 + 2, th + padY * 2 + 2
    local cx, cy = curX(), curY()
    try(state, "chip", function()
      local sx, sy = xyOf(ImGui.GetCursorScreenPos())
      local list = drawList()
      if wash and not hollow then rectFilled(list, sx, sy, sx + w, sy + h, wash) end
      rectLine(list, sx, sy, sx + w, sy + h, edge, alphaBorder and borderAlpha or 1.0)
    end)
    ImGui.SetCursorPosX(cx + padX + 1)
    ImGui.SetCursorPosY(cy + padY + 1)
    coloured(text, caps)
    ImGui.SetCursorPosX(cx)
    ImGui.SetCursorPosY(cy)
    ImGui.Dummy(w, h)
  end)
end

-- The eyebrow: a small XfAccentEdge square, then a capitals label in XfTextMuted (or the named colour). SectionGap above a new
-- group, none when flush (the first line of a card).
function panel.eyebrow(state, theme, which, label, flush, colourName)
  if not flush then
    ImGui.SetCursorPosY(curY() + math.max(0, panel.metric(theme, "SectionGap", 16) - panel.metric(theme, "ItemSpacingY", 6)))
  end
  local colour = panel.colour(theme, which, colourName or "XfTextMuted", GREY)
  local edge = panel.colour(theme, which, "XfAccentEdge", AMBER)
  local square = 6 * (panel.k or 1)
  panel.inRole(theme, "eyebrow", function()
    local _, th = textSize("X")
    local cx = curX()
    try(state, "eyebrow_square", function()
      local sx, sy = xyOf(ImGui.GetCursorScreenPos())
      rectFilled(drawList(), sx, sy + (th - square) / 2, sx + square, sy + (th + square) / 2, edge)
    end)
    ImGui.SetCursorPosX(cx + square * 2)
    coloured(colour, string.upper(label))
    ImGui.SetCursorPosX(cx)
  end)
end

-- The status dot: an 8 px disc (the Studio's, scaled by CET's font size over 13) in the tone's slot, drawn on the window's draw
-- list at (x, y) in screen pixels; paused is a ring. alpha is the pulse. Answers whether it was drawn.
function panel.dot(state, theme, which, tone, x, y, alpha)
  local radius = 4 * (panel.k or 1)
  local colour = tone == "ok" and panel.colour(theme, which, "XfSuccess", GREEN)
    or (tone == "write" or tone == "paused") and panel.colour(theme, which, "XfWarning", AMBER)
    or tone == "killed" and panel.colour(theme, which, "XfDanger", RED)
    or panel.colour(theme, which, "TextDisabled", GREY)
  return (try(state, "dot", function()
    local list = drawList()
    if tone == "paused" then
      ImGui.ImDrawListAddCircle(list, x, y, radius - 0.75 * (panel.k or 1), u32(colour), 12, 1.5 * (panel.k or 1))
    else
      ImGui.ImDrawListAddCircleFilled(list, x, y, radius, u32(colour, alpha), 12)
    end
  end))
end

-- A card: a child window with ChildBg, a 1 px XfLine border and the card padding, holding what fn draws; edge (a colour name, or
-- nil) is a 2 px left edge that breathes (the pulse) while pulsing is true. Cards never nest. Where this CET has no BeginChild the
-- content is drawn plain under a rule. The child's height is the content's last frame (one frame to settle after a change).
function panel.card(state, theme, which, id, edgeName, pulsing, fn)
  state.cards = state.cards or {}
  local padX, padY = panel.metric(theme, "ChildPaddingX", 8), panel.metric(theme, "ChildPaddingY", 6)
  local width = ImGui.GetFontSize() * WRAP_EM
  if ImGui.BeginChild == nil or ImGui.EndChild == nil then
    ImGui.Separator()
    fn()
    return
  end
  local height = state.cards[id] or (ImGui.GetFontSize() * 2 + padY * 2)
  ImGui.PushStyleVar(ImGuiStyleVar.WindowPadding, padX, padY)
  local line = panel.colour(theme, which, "XfLine", GREY)
  ImGui.PushStyleColor(ImGuiCol.Border, line[1], line[2], line[3], line[4])
  ImGui.BeginChild("##xf_card_" .. id, width, height, true, bit32 and bit32.bor(ImGuiWindowFlags.NoScrollbar, ImGuiWindowFlags.NoScrollWithMouse) or 0)
  local savedWidth, savedPad = cardWidth, cardPad
  cardWidth, cardPad = width, padX
  local ok, err = pcall(function()
    fn()
    local itemSpacingY = panel.metric(theme, "ItemSpacingY", 6)
    state.cards[id] = curY() - itemSpacingY + padY
    if edgeName then
      try(state, "card_edge", function()
        local colour = panel.colour(theme, which, edgeName, AMBER)
        local wx, wy = xyOf(ImGui.GetWindowPos())
        local ww, wh = ImGui.GetWindowSize()
        local alpha = pulsing and panel.pulseAlpha(theme, ImGui.GetTime(), panel.reduced(state)) or 1.0
        rectFilled(drawList(), wx, wy, wx + 2 * (panel.k or 1), wy + wh, colour, alpha)
      end)
    end
  end)
  cardWidth, cardPad = savedWidth, savedPad
  ImGui.EndChild()
  ImGui.PopStyleColor(1)
  ImGui.PopStyleVar(1)
  if not ok then error(err, 0) end
end

-- 0.8.4 (session 11: the comment box didn't wrap): word wrap for the comment box. CET 1.37.1's Dear ImGui (1.91.1) has no
-- wrapping multi-line box (ImGuiInputTextFlags.WordWrap came in 1.92), and its Lua binding passes no callback, so the box
-- wraps itself: a space where a line runs past the box becomes a line break ("soft"), and soft breaks turn back into
-- spaces before rewrapping and before sending. A space and a line break are one character each, so the text keeps its
-- length and the cursor its place. While the box is being edited Dear ImGui keeps its own copy and ignores ours, except in
-- a read-only frame, where it reloads ours and keeps the cursor (imgui_widgets.cpp 1.91.1, InputTextEx): so a rewrap is shown
-- through one read-only frame. A key pressed in exactly that frame is lost (rare: one frame per wrapped line).

-- The soft breaks of the old text carried over to the new one: those before the edit stay, those after it move with it,
-- those inside it go, and only positions still holding a line break count. Positions are byte indexes (1-based).
function panel.carrySoft(old, new, soft)
  local ol, nl = #old, #new
  local limit = math.min(ol, nl)
  local a = 0
  while a < limit and string.byte(old, a + 1) == string.byte(new, a + 1) do a = a + 1 end
  local b = 0
  while b < limit - a and string.byte(old, ol - b) == string.byte(new, nl - b) do b = b + 1 end
  local out = {}
  for pos in pairs(soft or {}) do
    local moved = nil
    if pos <= a then
      moved = pos
    elseif pos > ol - b then
      moved = pos + (nl - ol)
    end
    if moved and string.sub(new, moved, moved) == "\n" then out[moved] = true end
  end
  return out
end

-- The review of 0.8.4: Dear ImGui's Undo and Redo put text back that the soft breaks were dropped with (select across a
-- wrapped line, delete, Ctrl+Z: the line break returns without its soft mark, and Send would submit a newline where the
-- player wrote a space). So the box remembers its last states (text and soft breaks): a text seen before gets its soft
-- breaks back, and text put back that sat at the same place in a remembered state gets that state's soft breaks there.
-- Only a line break the player typed (Enter this frame) is never taken for a soft one. Positions are byte indexes.
local HISTORY = 64

local function copySet(set)
  local out = {}
  for k in pairs(set or {}) do out[k] = true end
  return out
end

function panel.rememberSoft(state, text, soft)
  state.commentHistory = state.commentHistory or {}
  local history = state.commentHistory
  local last = history[#history]
  if last and last.text == text then
    last.soft = copySet(soft)
    return
  end
  history[#history + 1] = { text = text, soft = copySet(soft) }
  if #history > HISTORY then table.remove(history, 1) end
end

function panel.trackSoft(state, old, new, typedNewline)
  if old == new then return state.commentSoft or {} end
  local soft = panel.carrySoft(old, new, state.commentSoft)
  if typedNewline then return soft end
  local history = state.commentHistory or {}
  for i = #history, 1, -1 do
    if history[i].text == new then return copySet(history[i].soft) end
  end
  local ol, nl = #old, #new
  local limit = math.min(ol, nl)
  local a = 0
  while a < limit and string.byte(old, a + 1) == string.byte(new, a + 1) do a = a + 1 end
  local b = 0
  while b < limit - a and string.byte(old, ol - b) == string.byte(new, nl - b) do b = b + 1 end
  local inserted = string.sub(new, a + 1, nl - b)
  if not string.find(inserted, "\n", 1, true) then return soft end
  for i = #history, 1, -1 do
    local h = history[i]
    if string.sub(h.text, a + 1, a + #inserted) == inserted then
      for pos in pairs(h.soft) do
        if pos > a and pos <= a + #inserted then soft[pos] = true end
      end
      break
    end
  end
  return soft
end

-- The text with its soft breaks as spaces again (what is sent).
function panel.unwrap(text, soft)
  if not soft or next(soft) == nil then return text end
  local parts = {}
  for i = 1, #text do
    local c = string.sub(text, i, i)
    parts[i] = (soft[i] and c == "\n") and " " or c
  end
  return table.concat(parts)
end

-- Wraps the text at words to width (measure(s) answers a line's width), every soft break chosen afresh; hard breaks (the
-- player's Enter) stay. Answers the wrapped text and its soft breaks.
function panel.wrap(text, soft, measure, width)
  local base = panel.unwrap(text, soft)
  local out = {}
  local n = #base
  local lineStart = 1
  local lastSpace = nil
  local i = 1
  while i <= n + 1 do
    local c = i <= n and string.sub(base, i, i) or "\n"
    if c == " " or c == "\n" then
      if lastSpace and lastSpace >= lineStart and measure(string.sub(base, lineStart, i - 1)) > width then
        out[lastSpace] = true
        lineStart = lastSpace + 1
      end
      if c == "\n" then
        lineStart = i + 1
        lastSpace = nil
      else
        lastSpace = i
      end
    end
    i = i + 1
  end
  if next(out) == nil then return base, out end
  local parts = {}
  for k = 1, n do
    parts[k] = out[k] and "\n" or string.sub(base, k, k)
  end
  return table.concat(parts), out
end

-- 0.8.4: the keys Change... can take, by Dear ImGui's name, with config.ini's spelling (core/KillKey.cpp Parse).
local CAPTURE_KEYS = {
  { "End", "End" }, { "Home", "Home" }, { "Insert", "Insert" }, { "Delete", "Delete" }, { "PageUp", "PageUp" },
  { "PageDown", "PageDown" }, { "Pause", "Pause" }, { "ScrollLock", "ScrollLock" },
  { "KeypadMultiply", "NumpadMultiply" }, { "KeypadDivide", "NumpadDivide" }, { "KeypadSubtract", "NumpadMinus" },
  { "KeypadAdd", "NumpadPlus" }, { "KeypadDecimal", "NumpadDecimal" },
}
for i = 1, 12 do table.insert(CAPTURE_KEYS, { "F" .. i, "F" .. i }) end
for i = 0, 9 do
  table.insert(CAPTURE_KEYS, { "Keypad" .. i, "Numpad" .. i })
  table.insert(CAPTURE_KEYS, { tostring(i), tostring(i) })
end
for c = string.byte("A"), string.byte("Z") do table.insert(CAPTURE_KEYS, { string.char(c), string.char(c) }) end

local function keyDown(name)
  local index = ImGuiKey and ImGuiKey[name]
  return index ~= nil and ImGui.IsKeyDown(index)
end

-- The chord being pressed now, as config.ini spells it ("Ctrl+Shift+End"), or nil; "cancel" for Esc.
function panel.capturedChord()
  if keyDown("Escape") and ImGui.IsKeyPressed(ImGuiKey.Escape, false) then return "cancel" end
  for _, entry in ipairs(CAPTURE_KEYS) do
    local index = ImGuiKey and ImGuiKey[entry[1]]
    if index ~= nil and ImGui.IsKeyPressed(index, false) then
      local text = ""
      if keyDown("LeftCtrl") or keyDown("RightCtrl") then text = text .. "Ctrl+" end
      if keyDown("LeftShift") or keyDown("RightShift") then text = text .. "Shift+" end
      if keyDown("LeftAlt") or keyDown("RightAlt") then text = text .. "Alt+" end
      return text .. entry[2]
    end
  end
  return nil
end

-- 0.8.4: Change... and Reset under the kill switch, and what else may react to the key (bridge_info's kill_key: warnings from
-- the game's bindings and CET's hotkeys; notes; after a change, what can't be seen from here). 0.8.5 (the UI review's N1 and
-- N3): "Keys" is a heading line, like "Comment for XF Studio", with the Stop key row under it (room for the answer keys
-- later); the row wraps by the answer buttons' rule, so Reset appearing never widens the window; the key is a keycap (its
-- text in the text colour inside a frame, not a disabled button); the capture prompt has its own line under the row, whose
-- height is always kept, so nothing moves when it appears; the notes are in the muted text colour. 0.8.6 (the UI review's
-- P2 and P3): that line holds the latest outcome when no key is being taken, and a click on the keycap starts Change... too.
local CAPTURE_PROMPT = "Press the new key, with Ctrl, Shift or Alt if you like. Esc cancels."

-- The key as a keycap: a framed readout in the text colour (0.8.5). 0.8.6 (the UI review's P3: it looked more like a button
-- than Change... did, so people would click it): a click on it starts Change... too, turning the misreading into a shortcut,
-- and it answers the pointer like the window's other buttons (the theme's hover) with a tooltip saying so. Answers whether
-- it was clicked.
local function keycap(theme, which, label)
  local fill = panel.colour(theme, which, "FrameBg", { 0.08, 0.09, 0.1, 1.0 })
  local edge = panel.colour(theme, which, "XfLineStrong", GREY)
  local ink = panel.colour(theme, which, "Text", { 0.92, 0.92, 0.92, 1.0 })
  ImGui.PushStyleColor(ImGuiCol.Button, fill[1], fill[2], fill[3], fill[4])
  ImGui.PushStyleColor(ImGuiCol.Text, ink[1], ink[2], ink[3], ink[4])
  ImGui.PushStyleColor(ImGuiCol.Border, edge[1], edge[2], edge[3], edge[4])
  local bordered = ImGuiStyleVar and ImGuiStyleVar.FrameBorderSize ~= nil
  if bordered then ImGui.PushStyleVar(ImGuiStyleVar.FrameBorderSize, 1) end
  local clicked = button(label .. "##xf_killkey_cap")
  if bordered then ImGui.PopStyleVar(1) end
  ImGui.PopStyleColor(3)
  if ImGui.IsItemHovered() then
    ImGui.SetTooltip("Click to change the stop key")
  end
  return clicked
end

-- 0.8.6 (the UI review's P2: the reserved prompt line was an empty band after a change): the line under the Stop key row holds
-- the prompt while a key is being taken, else the latest outcome (a refusal, or the saved line), else nothing; its height is
-- the tallest of the three, so nothing below it moves when one replaces another.
function panel.keySlot(state)
  if state.killKeyCapture then return "prompt", CAPTURE_PROMPT end
  if state.killKeyRefused then return "refused", tostring(state.killKeyRefused) end
  if state.killKeyChanged and state.killKeySaved then return "saved", tostring(state.killKeySaved) end
  return nil, nil
end

local function mutedWrapped(theme, which, text)
  local muted = panel.colour(theme, which, "XfTextMuted", GREY)
  ImGui.PushTextWrapPos(wrapPos())
  ImGui.TextColored(muted[1], muted[2], muted[3], muted[4], tostring(text))
  ImGui.PopTextWrapPos()
end

-- 0.8.22: "Keys" is an eyebrow over a card (the Studio's keys card); the stop key row, the reserved line and the notes sit in it.
local function drawKeysBody(state, queue, theme, which, killKey)
  local pad, gap = spacing(theme)
  local row = { used = 0 }
  local capLabel = killKey.enabled and tostring(killKey.label) or "Off"
  ImGui.AlignTextToFramePadding()
  place(row, (ImGui.CalcTextSize("Stop key")), gap)
  coloured(panel.colour(theme, which, "XfTextMuted", GREY), "Stop key")
  place(row, (ImGui.CalcTextSize(capLabel)) + pad * 2, gap)
  local startChange = keycap(theme, which, capLabel)
  -- While a key is being taken, the row keeps its buttons (Change... disabled), so nothing in it moves either.
  place(row, (ImGui.CalcTextSize("Change...")) + pad * 2, gap)
  ImGui.BeginDisabled(state.killKeyCapture == true)
  if button("Change...##xf_killkey_change") then
    startChange = true
  end
  ImGui.EndDisabled()
  if startChange and not state.killKeyCapture then
    state.killKeyCapture = true
    state.killKeyRefused = nil
  end
  if killKey.is_default == false then
    local reset = "Reset to " .. tostring(killKey.default)
    place(row, (ImGui.CalcTextSize(reset)) + pad * 2, gap)
    ImGui.BeginDisabled(state.killKeyCapture == true)
    if button(reset .. "##xf_killkey_reset") and not state.killKeyCapture then
      queue("killkey", { action = "reset" })
    end
    ImGui.EndDisabled()
  end
  -- The reserved line under the row (0.8.6, P2): the prompt while a key is being taken, else the latest outcome; its height
  -- is the tallest of the prompt and the outcome kept now, so nothing below moves when one takes the other's place.
  local limit = limitWidth()
  local function wrappedHeight(text)
    local _, h = ImGui.CalcTextSize(text, false, limit)
    return (type(h) == "number" and h > 0) and h or ImGui.GetFontSize()
  end
  local slotHeight = wrappedHeight(CAPTURE_PROMPT)
  local kept = state.killKeyRefused or (state.killKeyChanged and state.killKeySaved) or nil
  if kept then slotHeight = math.max(slotHeight, wrappedHeight(tostring(kept))) end
  local kind, text = panel.keySlot(state)
  if kind then
    local colour = kind == "prompt" and panel.colour(theme, which, "XfAccentText", AMBER)
      or kind == "refused" and RED or panel.colour(theme, which, "XfTextMuted", GREY)
    ImGui.PushTextWrapPos(wrapPos())
    ImGui.TextColored(colour[1], colour[2], colour[3], colour[4], text)
    ImGui.PopTextWrapPos()
    local short = slotHeight - wrappedHeight(text)
    if short > 0.5 then
      ImGui.SetCursorPosY(ImGui.GetCursorPosY() + short)
    end
  else
    ImGui.Dummy(1, slotHeight)
  end
  if state.killKeyCapture then
    local chord = panel.capturedChord()
    if chord == "cancel" then
      state.killKeyCapture = false
    elseif chord then
      state.killKeyCapture = false
      queue("killkey", { action = "set", key = chord })
    end
  end
  for _, warning in ipairs(type(killKey.warnings) == "table" and killKey.warnings or {}) do
    ImGui.PushTextWrapPos(wrapPos())
    ImGui.TextColored(AMBER[1], AMBER[2], AMBER[3], AMBER[4], tostring(warning))
    ImGui.PopTextWrapPos()
  end
  if state.killKeyChanged then
    for _, note in ipairs(type(killKey.notes) == "table" and killKey.notes or {}) do
      mutedWrapped(theme, which, note)
    end
    if type(killKey.unseen) == "string" then
      mutedWrapped(theme, which, killKey.unseen)
    end
  end
end

drawKillKey = function(state, queue, theme, which, killKey)
  if not killKey then return end
  panel.eyebrow(state, theme, which, "Keys", false)
  panel.card(state, theme, which, "keys", nil, false, function()
    drawKeysBody(state, queue, theme, which, killKey)
  end)
end

-- The commentary box: Send, disabled while the box is empty, or Ctrl+Enter while typing (session 8's request).
-- 0.8.2 (session 9's C2: Ctrl+Enter only took the box out of editing): in a multi-line box Dear ImGui treats Ctrl+Enter as
-- "done" and ends the editing inside the widget call, so by the time the code after it ran, the box was no longer active and
-- the key went unseen. EnterReturnsTrue makes the call itself answer true for that Ctrl+Enter (plain Enter still starts a
-- new line), and the text is taken every frame.
local function drawComment(state, queue, theme, which)
  panel.eyebrow(state, theme, which, "Comment for XF Studio", false)
  local width = limitWidth()
  local nativeWrap = ImGuiInputTextFlags and ImGuiInputTextFlags.WordWrap -- Dear ImGui 1.92+, if a later CET offers it
  local flags = (ImGuiInputTextFlags and ImGuiInputTextFlags.EnterReturnsTrue) or 0
  local reloading = state.commentReload ~= nil
  if reloading then
    -- The read-only frame that hands the rewrapped text to the box being edited (see above).
    state.comment = state.commentReload
    state.commentReload = nil
    flags = flags + ((ImGuiInputTextFlags and ImGuiInputTextFlags.ReadOnly) or 0)
  elseif nativeWrap then
    flags = flags + nativeWrap
  end
  local before = state.comment or ""
  local text, submitted = ImGui.InputTextMultiline("##xf_comment_" .. tostring(state.commentGen or 0), before, 1000, width,
    ImGui.GetFontSize() * 4, flags)
  local editing = ImGui.IsItemActive()
  if type(text) == "string" and not reloading then
    local typedNewline = ImGuiKey ~= nil and (ImGui.IsKeyPressed(ImGuiKey.Enter, true) or ImGui.IsKeyPressed(ImGuiKey.KeypadEnter, true))
    state.commentSoft = panel.trackSoft(state, before, text, typedNewline)
    state.comment = text
    if not nativeWrap and text ~= before then
      -- Wrap to the box's width, less its padding and a scrollbar's room.
      local wrapped, soft = panel.wrap(text, state.commentSoft, function(line) return (ImGui.CalcTextSize(line)) end,
        width - ImGui.GetFontSize() * 2)
      state.commentSoft = soft
      panel.rememberSoft(state, wrapped, soft)
      if wrapped ~= text then
        if editing then
          state.commentReload = wrapped
        else
          state.comment = wrapped
        end
      end
    end
  end
  local message = panel.unwrap(state.comment or "", state.commentSoft)
  local empty = not string.find(message, "%S")
  if submitted and not empty and not reloading then
    queue("comment", message)
  end
  ImGui.BeginDisabled(empty)
  if button("Send##xf_comment_send") and not empty then
    queue("comment", message)
  end
  ImGui.EndDisabled()
  if ImGui.IsItemHovered() then
    ImGui.SetTooltip("Ctrl+Enter sends")
  end
end

-- The primary button (the one thing the player is asked for): XfAccent fill, the Studio's primary hover (XfAccentHover; XfAccentEdge
-- only as the border), XfAccentInk text. Answers a click as button() does.
local function primaryButton(theme, which, label, target, state)
  local fill = panel.colour(theme, which, "XfAccent", AMBER)
  local hover = panel.colour(theme, which, "XfAccentHover", fill)
  local edge = panel.colour(theme, which, "XfAccentEdge", fill)
  local ink = panel.colour(theme, which, "XfAccentInk", { 0.09, 0.09, 0.05, 1.0 })
  ImGui.PushStyleColor(ImGuiCol.Button, fill[1], fill[2], fill[3], fill[4])
  ImGui.PushStyleColor(ImGuiCol.ButtonHovered, hover[1], hover[2], hover[3], hover[4])
  ImGui.PushStyleColor(ImGuiCol.ButtonActive, fill[1], fill[2], fill[3], fill[4])
  ImGui.PushStyleColor(ImGuiCol.Text, ink[1], ink[2], ink[3], ink[4])
  ImGui.PushStyleColor(ImGuiCol.Border, edge[1], edge[2], edge[3], edge[4])
  local bordered = ImGuiStyleVar and ImGuiStyleVar.FrameBorderSize ~= nil
  if bordered then ImGui.PushStyleVar(ImGuiStyleVar.FrameBorderSize, 1) end
  local a, b, c = button(label, target, state)
  if bordered then ImGui.PopStyleVar(1) end
  ImGui.PopStyleColor(5)
  return a, b, c
end

-- The gap between groups (SectionGap, less the item spacing the cursor already carries).
local function sectionGap(theme)
  ImGui.SetCursorPosY(curY() + math.max(0, panel.metric(theme, "SectionGap", 16) - panel.metric(theme, "ItemSpacingY", 6)))
end

-- The question's slot (0.8, the UI review): the pending question with its answers as primary buttons (0.8.7, session 14:
-- without their keys, since this window shows only while CET's overlay is open, and CET then takes the keyboard, so a key
-- named on a button would do nothing);
-- once answered, the same slot says what was sent, at the buttons' height, so nothing below it moves. 0.8.4 (the UI
-- review's fixes 1-3): the hover is the Studio's primary hover (XfAccentHover; XfAccentEdge only as the border), the
-- buttons wrap onto a new row at the window's text width instead of widening it, and "Sent: ..." stays until the next
-- question takes its place. 0.8.22: a card edged XfAccentEdge whose edge breathes while the question waits and stands still once
-- answered (the Studio's question card); the newest plain line from XF Studio is a card without the edge.
local function drawQuestion(state, queue, theme, which)
  local ask = state.pendingAsk
  local answered = state.answeredAsk
  -- 0.8.9: with no question, the newest line from XF Studio (info included) holds the slot.
  local latest = not ask and not answered and state.latestMessage or nil
  if latest then
    sectionGap(theme)
    panel.card(state, theme, which, "message", nil, false, function()
      panel.eyebrow(state, theme, which, "From XF Studio", true, "XfAccentText")
      wrapped(tostring(latest.text))
    end)
    return
  end
  if not ask and not answered then return end
  sectionGap(theme)
  panel.card(state, theme, which, "question", "XfAccentEdge", ask ~= nil, function()
    panel.eyebrow(state, theme, which, "Question from XF Studio", true, "XfAccentText")
    wrapped(tostring(ask and ask.text or answered.text))
    if ask then
      local pad, gap = spacing(theme)
      local row = { used = 0 }
      for i, label in ipairs(ask.choices) do
        local text = tostring(label)
        place(row, (ImGui.CalcTextSize(text)) + pad * 2, gap)
        if primaryButton(theme, which, text .. "##xf_answer_" .. tostring(i)) then
          queue("answer", { id = ask.id, choice = i - 1 })
        end
      end
    else
      ImGui.AlignTextToFramePadding()
      coloured(panel.colour(theme, which, "XfTextMuted", GREY), "Sent: " .. tostring(answered.label) .. ". Waiting for the next question.")
    end
  end)
end

-- 0.8.7 (session 14's T2: the window's top edge moved when its height changed): the window's top-left corner stays put. A
-- frame whose size changed and whose corner moved with it is put back where the corner was; a move with no change of size is
-- the player dragging the window, and that becomes the corner to keep.
local function differs(a, b) return math.abs((a or 0) - (b or 0)) > 0.5 end

function panel.anchorBefore(state)
  local a = state.windowAnchor
  if a and a.restore and type(ImGui.SetNextWindowPos) == "function" then
    ImGui.SetNextWindowPos(a.x, a.y, ImGuiCond.Always)
    a.restore = false
  end
end

function panel.anchorAfter(state)
  if type(ImGui.GetWindowPos) ~= "function" or type(ImGui.GetWindowSize) ~= "function" then return end
  local x, y = ImGui.GetWindowPos()
  local w, h = ImGui.GetWindowSize()
  local a = state.windowAnchor
  if not a then
    state.windowAnchor = { x = x, y = y, w = w, h = h, restore = false }
    return
  end
  local resized = differs(w, a.w) or differs(h, a.h)
  local moved = differs(x, a.x) or differs(y, a.y)
  a.w, a.h = w, h
  if resized and moved then
    a.restore = true
  elseif moved then
    a.x, a.y = x, y
  end
end

-- ---- 0.8.22: the heading, the status block and the diagnostics -------------------------------------------------------------------

local function setPos(x, y)
  ImGui.SetCursorPosX(x)
  ImGui.SetCursorPosY(y)
end

-- The heading: the brand mark (the Studio's chamfered mark: XfAccent with XfAccentInk; the chamfer is two quads, a square where this
-- CET lacks the call), the title in the title role, an info chip saying this is a test build, and the version at the right in
-- TextDisabled. 24 px row (at 13 px body); ItemSpacingY below.
function panel.heading(state, theme, which, info)
  local k = panel.k or 1
  local markW, markH = 30 * k, 24 * k
  local bevel = panel.metric(theme, "BevelLarge", 7)
  local gap = panel.metric(theme, "ItemSpacingX", 8)
  local rowW = ImGui.GetFontSize() * WRAP_EM
  local cx, cy = curX(), curY()
  local accent = panel.colour(theme, which, "XfAccent", AMBER)
  local ink = panel.colour(theme, which, "XfAccentInk", { 0.09, 0.09, 0.05, 1.0 })
  try(state, "mark", function()
    local sx, sy = xyOf(ImGui.GetCursorScreenPos())
    local list = drawList()
    local col = u32(accent)
    local x2, y2 = sx + markW, sy + markH
    local ok = pcall(function()
      -- top-right and bottom-left corners cut by the bevel: two quads share the diagonal edge
      ImGui.ImDrawListAddQuadFilled(list, sx, sy, x2 - bevel, sy, sx + bevel, y2, sx, y2 - bevel, col)
      ImGui.ImDrawListAddQuadFilled(list, x2 - bevel, sy, x2, sy + bevel, x2, y2, sx + bevel, y2, col)
    end)
    if not ok then ImGui.ImDrawListAddRectFilled(list, sx, sy, x2, y2, col) end
  end)
  panel.inRole(theme, "title", function()
    local tw, th = textSize("XF")
    setPos(cx + (markW - tw) / 2, cy + (markH - th) / 2)
    coloured(ink, "XF")
    local _, lineH = textSize("XF Runtime Bridge")
    setPos(cx + markW + gap, cy + (markH - lineH) / 2)
    coloured(panel.colour(theme, which, "XfAccentText", AMBER), "XF Runtime Bridge")
  end)
  local titleW = panel.inRole(theme, "title", function() return (textSize("XF Runtime Bridge")) end)
  local chipX = cx + markW + gap + (type(titleW) == "number" and titleW or 0) + gap
  local _, eh = panel.inRole(theme, "eyebrow", function() return textSize("X") end)
  local chipH = (type(eh) == "number" and eh or ImGui.GetFontSize()) + panel.metric(theme, "ChipPaddingY", 2) * 2 + 2
  setPos(chipX, cy + (markH - chipH) / 2)
  panel.chip(state, theme, which, "test", "info", false)
  if info and info.plugin_version ~= nil then
    local version = tostring(info.plugin_version)
    panel.inRole(theme, "label", function()
      local vw, vh = textSize(version)
      setPos(math.max(chipX, cx + rowW - vw), cy + (markH - vh) / 2)
      ImGui.TextDisabled(version)
    end)
  end
  setPos(cx, cy + markH + panel.metric(theme, "ItemSpacingY", 6))
end

-- The mode chip's label and tone: the plugin's (status.chip, with the status tone), else worked out from the bridge's flags for a
-- plugin without the field.
local function chipOf(info, bridge)
  local status = info and info.status
  if type(status) == "table" and type(status.chip) == "string" then
    return status.chip ~= "" and status.chip or nil, status.tone
  end
  if not bridge or not bridge.enabled then return nil end
  if bridge.killed then return "Stopped", "killed" end
  if not bridge.allow_writes then return "Read-only", "ok" end
  if bridge.writes_paused then return "Paused", "paused" end
  return "Changes allowed", "write"
end

-- The status line (the Studio's): the dot in the tone's slot, pulsing while the bridge is live and motion runs, the plugin's
-- connection sentence in the muted colour (the danger colour once stopped), the settle wash behind the row when the tone has just
-- changed; under it the mode chip and what it means for the player.
function panel.statusBlock(state, theme, which, info, bridge)
  local now = ImGui.GetTime()
  local reduced = panel.reduced(state)
  local status = info and info.status
  local tone = state.pluginPresent == false and "off" or (type(status) == "table" and status.tone) or "idle"
  local _, sentence = connectionLine(state)
  state.settle = state.settle or {}
  panel.noteSettle(theme, state.settle, tone, now * 1000, reduced)
  local strength = panel.settleNow(theme, state.settle, now * 1000)
  local lineH = lineHeight()
  local k = panel.k or 1
  local drawn = try(state, "status_row", function()
    local sx, sy = xyOf(ImGui.GetCursorScreenPos())
    if strength > 0 then
      local wash = panel.colour(theme, which, "XfSignalBg", nil)
      if wash then
        rectFilled(drawList(), sx - 4 * k, sy - 2 * k, sx + ImGui.GetFontSize() * WRAP_EM, sy + (state.statusRowHeight or lineH) + 2 * k, wash, strength)
      end
    end
  end)
  local live = tone == "ok" or tone == "write"
  local sx, sy = xyOf(ImGui.GetCursorScreenPos())
  local dotDrawn = type(sx) == "number" and panel.dot(state, theme, which, tone, sx + 4 * k, sy + lineH / 2, live and panel.pulseAlpha(theme, now, reduced) or 1.0)
  local hang = 8 * k + panel.metric(theme, "ItemSpacingX", 8)
  if dotDrawn then
    ImGui.Indent(hang)
  else
    local c = panel.colour(theme, which, tone == "ok" and "XfSuccess" or (tone == "write" or tone == "paused") and "XfWarning" or tone == "killed" and "XfDanger" or "TextDisabled", GREY)
    ImGui.PushStyleColor(ImGuiCol.Text, c[1], c[2], c[3], c[4])
    ImGui.Bullet()
    ImGui.PopStyleColor(1)
    ImGui.SameLine()
  end
  local text = tone == "killed" and panel.colour(theme, which, "XfDanger", RED) or panel.colour(theme, which, "XfTextMuted", GREY)
  local top = curY()
  ImGui.PushTextWrapPos(wrapPos())
  coloured(text, sentence)
  ImGui.PopTextWrapPos()
  state.statusRowHeight = math.max(lineH, curY() - top - panel.metric(theme, "ItemSpacingY", 6))
  if dotDrawn then ImGui.Unindent(hang) end
  -- the chip row
  local label, chipTone = chipOf(info, bridge)
  if label and bridge and bridge.enabled then
    panel.chip(state, theme, which, label, chipTone, chipTone == "paused")
    local foot = (not bridge.allow_writes and not bridge.killed) and "This build can't change the game."
      or bridge.killed and nil
      or bridge.writes_paused and "Changes are paused."
      or "XF test profile"
    if foot then
      ImGui.SameLine()
      panel.inRole(theme, "label", function() coloured(panel.colour(theme, which, "TextDisabled", GREY), foot) end)
    end
  end
end

-- One key-value row: the label (label role, XfTextMuted) in a column as wide as 9 em, then the value (value role for figures).
local function keyValue(theme, which, label, value, figure)
  local column
  local start = curX() -- SameLine's offset is from the window's edge, so the card's padding is part of it
  panel.inRole(theme, "label", function()
    column = ImGui.GetFontSize() * 9
    coloured(panel.colour(theme, which, "XfTextMuted", GREY), label)
  end)
  ImGui.SameLine(start + column + panel.metric(theme, "ItemSpacingX", 8))
  panel.inRole(theme, figure and "value" or "body", function()
    ImGui.PushTextWrapPos(wrapPos())
    coloured(panel.colour(theme, which, "Text", { 0.92, 0.92, 0.92, 1.0 }), tostring(value))
    ImGui.PopTextWrapPos()
  end)
end

-- A value bar: a track in XfLine, the fill PlotHistogram (the warning or danger slot of a meter), square ends, no border. Labelled:
-- BarLabelled high with the figure inside in the value role and the fill at LabelledBarAlpha with no opaque cap, so the figure stays
-- readable across the filled and unfilled track. Thin: BarThin.
function panel.bar(state, theme, which, fraction, label, tone)
  local labelled = label ~= nil
  local height = panel.metric(theme, labelled and "BarLabelled" or "BarThin", labelled and 16 or 6)
  local width = limitWidth()
  local fill = panel.colour(theme, which, tone == "danger" and "XfDanger" or tone == "warning" and "XfWarning" or "PlotHistogram", GREEN)
  local alpha = labelled and ((theme and theme.values and theme.values.LabelledBarAlpha) or 0.3) or 1.0
  local cx, cy = curX(), curY()
  try(state, "bar", function()
    local sx, sy = xyOf(ImGui.GetCursorScreenPos())
    local list = drawList()
    rectFilled(list, sx, sy, sx + width, sy + height, panel.colour(theme, which, "XfLine", GREY))
    if fraction > 0 then
      rectFilled(list, sx, sy, sx + width * math.min(1, fraction), sy + height, fill, alpha)
    end
  end)
  if labelled then
    panel.inRole(theme, "value", function()
      local tw, th = textSize(label)
      setPos(cx + (width - tw) / 2, cy + (height - th) / 2)
      coloured(panel.colour(theme, which, "Text", { 0.92, 0.92, 0.92, 1.0 }), label)
    end)
    setPos(cx, cy)
  end
  ImGui.Dummy(width, height)
end

-- The diagnostics (collapsed by default: the window's actions, the question and the stop button never collapse): the plugin's
-- numbers as key-value rows and the overlay host's CPU time as a labelled meter against a 1 ms budget (warning past 75 %, danger
-- past 90 %, the figure always shown).
local function drawDiagnostics(state, theme, which, info)
  if not info then return end
  sectionGap(theme)
  local open = false
  panel.inRole(theme, "eyebrow", function() open = ImGui.CollapsingHeader("DIAGNOSTICS##xf_diagnostics") end)
  if not open then return end
  local overlay = type(info.overlay) == "table" and info.overlay or {}
  local bridge = type(info.bridge) == "table" and info.bridge or {}
  panel.card(state, theme, which, "diagnostics", nil, false, function()
    keyValue(theme, which, "Overlay", tostring(overlay.phase or "off") .. (overlay.off_for_frame_generation and " (off for frame generation)" or ""), false)
    if overlay.frames ~= nil then keyValue(theme, which, "Frames", string.format("%d", overlay.frames), true) end
    if overlay.cpu_ms ~= nil then keyValue(theme, which, "CPU", string.format("%.3f ms (max %.3f)", overlay.cpu_ms, overlay.cpu_ms_max or 0), true) end
    keyValue(theme, which, "Motion", tostring(overlay.motion or "full") .. (overlay.motion_reason and overlay.motion_reason ~= "" and (" (" .. tostring(overlay.motion_reason) .. ")") or ""), false)
    keyValue(theme, which, "Requests", string.format("%d", bridge.requests or 0), true)
    keyValue(theme, which, "Game", tostring(info.game_state or "?"), false)
    if type(overlay.cpu_ms) == "number" then
      local cpu = overlay.cpu_ms
      panel.bar(state, theme, which, cpu, string.format("%.2f ms of 1 ms", cpu), cpu > 0.9 and "danger" or cpu > 0.75 and "warning" or nil)
    end
  end)
end

-- state: init.lua's state (info from XFBridge_Info, pluginPresent, pending, message, pendingAsk, answeredAsk, comment).
-- queue(name, argument): asks init.lua to run an action on the next update.
-- theme: theme.lua's table, or nil.
function panel.draw(state, queue, theme)
  local which = "dark"
  local overlay = state.info and state.info.overlay
  if type(overlay) == "table" and overlay.theme == "light" then
    which = "light"
  end
  panel.k = ImGui.GetFontSize() / ((theme and theme.metrics and theme.metrics.FontSize) or 13)
  local colours, vars = panel.pushTheme(theme, which)
  if ImGuiStyleVar and ImGuiStyleVar.Alpha ~= nil then
    ImGui.PushStyleVar(ImGuiStyleVar.Alpha, 1.0)
    vars = vars + 1
  end
  local ok, err = pcall(panel.body, state, queue, theme, which)
  if vars > 0 then ImGui.PopStyleVar(vars) end
  if colours > 0 then ImGui.PopStyleColor(colours) end
  if not ok then error(err) end
end

function panel.body(state, queue, theme, which)
  -- The status colours from the theme's semantic tokens (success, warning, danger, faint text).
  GREY = panel.colour(theme, which, "TextDisabled", DEFAULTS.GREY)
  GREEN = panel.colour(theme, which, "XfSuccess", DEFAULTS.GREEN)
  AMBER = panel.colour(theme, which, "XfWarning", DEFAULTS.AMBER)
  RED = panel.colour(theme, which, "XfDanger", DEFAULTS.RED)
  -- 0.8.5 (the UI review's N4: the ink panel showed through in both themes): the window's background fully opaque, whatever the
  -- theme's overlay token (alpha 0.97) or CET's global alpha.
  ImGui.SetNextWindowBgAlpha(1.0)
  panel.anchorBefore(state)
  if not ImGui.Begin("XF Runtime Bridge", ImGuiWindowFlags.AlwaysAutoResize) then
    if state.testInput and state.testInput.ui then state.testInput.ui("cet_window", { drawn = false, collapsed = true, save_button_drawn = false, rect = state.testInput.windowRect() }) end
    ImGui.End()
    return
  end
  panel.anchorAfter(state)
  local recordSaveDrawn = false
  local drew, err = pcall(function()
    local info = state.info
    local bridge = info and info.bridge

    panel.heading(state, theme, which, info)
    panel.statusBlock(state, theme, which, info, bridge)

    local live = bridge and bridge.enabled and bridge.listening and not bridge.killed
    local slotTop = ImGui.GetCursorPosY()
    if live then
      drawQuestion(state, queue, theme, which)
    end
    local slotHeight = ImGui.GetCursorPosY() - slotTop
    state.questionSlotHeight = math.max(state.questionSlotHeight or 0, slotHeight)
    if slotHeight < state.questionSlotHeight then
      -- Submit the reserved area for auto-sizing, then exclude Dummy's own trailing item gap from the next row.
      ImGui.Dummy(1, state.questionSlotHeight - slotHeight)
      ImGui.SetCursorPosY(slotTop + state.questionSlotHeight)
    end
    panel.noteLayout(state, state.questionSlotHeight)

    if bridge and bridge.enabled then
      if bridge.killed then
        sectionGap(theme)
        if state.pending == "rearm" or (info and info.rearm_pending) then
          wrapped("Reconnecting... The bridge first puts back what it changed (a frozen world, a hidden menu), then starts again.")
        else
          -- 0.8.4 (the UI review's fix 7): the button, and the one thing the player needs to know, only when it applies.
          -- 0.8.22: Reconnect is the window's one primary once the bridge is stopped.
          if primaryButton(theme, which, "Reconnect") then
            queue("rearm")
          end
          if info and info.writes_used then
            wrapped("Saving stays locked until you load a save.")
          end
        end
      elseif bridge.listening then
        sectionGap(theme)
        if bridge.allow_writes then
          if bridge.writes_paused then
            if button("Resume changes") then
              queue("pause", false)
            end
          else
            if button("Pause changes") then
              queue("pause", true)
            end
          end
          ImGui.SameLine()
        end
        if button("Mark this moment") then
          queue("mark")
        end
        -- 0.8.7 (session 14's friction: the bridge's save lock refused the player's own save with only the game's "You can't
        -- save right now"): while the lock holds, the player can save anyway, on their own say-so (the -writes package only:
        -- the plugin offers it only where writes and the save class are allowed).
        local lock = info and type(info.save_lock) == "table" and info.save_lock or nil
        -- 0.8.11 (UI review of 0.8.11, fix 2): the reason first, in the muted colour, then the button on its own row with "or load
        -- a save" beside it, as the Stop row has its key hint.
        if lock and lock.save_anyway then
          ImGui.Spacing()
          coloured(panel.colour(theme, which, "XfTextMuted", GREY), "Saves are held: a test change would go into them.")
          recordSaveDrawn = true
          local activated, token, physical = button("Save anyway", "save_anyway", state)
          if activated then
            -- A simultaneous human click keeps its ordinary path, but consumes the token once.
            local accepted = token and state.testInput.stage("queued", token)
            if physical or accepted then queue("saveanyway", { test_token = token or nil, physical = physical }) end
          end
          if ImGui.IsItemHovered() then
            ImGui.SetTooltip("Makes a manual save now, past the XF Runtime Bridge's save lock. The test change goes into that save.")
          end
          ImGui.SameLine()
          coloured(panel.colour(theme, which, "XfTextMuted", GREY), "or load a save")
        end
        -- 0.8 (the UI review): the kill switch on its own row, in the danger colour, away from the everyday buttons. 0.8.5 (the
        -- UI review's fix 8): the Studio's danger button (.btn.danger): danger text and border on a clear fill. 0.8.22: its hover
        -- and press take the danger wash (XfDangerBg), as the Studio's.
        ImGui.Spacing()
        local wash = panel.colour(theme, which, "XfDangerBg", nil)
        ImGui.PushStyleColor(ImGuiCol.Button, 0, 0, 0, 0)
        ImGui.PushStyleColor(ImGuiCol.Text, RED[1], RED[2], RED[3], RED[4])
        ImGui.PushStyleColor(ImGuiCol.Border, RED[1], RED[2], RED[3], RED[4])
        local pushed = 3
        if wash then
          ImGui.PushStyleColor(ImGuiCol.ButtonHovered, wash[1], wash[2], wash[3], wash[4])
          ImGui.PushStyleColor(ImGuiCol.ButtonActive, wash[1], wash[2], wash[3], wash[4])
          pushed = 5
        end
        local stopBordered = ImGuiStyleVar and ImGuiStyleVar.FrameBorderSize ~= nil
        if stopBordered then ImGui.PushStyleVar(ImGuiStyleVar.FrameBorderSize, 1) end
        local stop = button("Stop the bridge")
        if stopBordered then ImGui.PopStyleVar(1) end
        ImGui.PopStyleColor(pushed)
        if stop then
          queue("kill")
        end
        -- 0.8.3: the bridge's own stop key ([ui] kill_key), which works in the game without CET. 0.8.4 (the UI review's
        -- fix 8): in the muted text colour (not the disabled one), with where it works as a tooltip.
        local killKey = info and type(info.kill_key) == "table" and info.kill_key or nil
        if killKey and killKey.enabled and type(killKey.label) == "string" then
          ImGui.SameLine()
          coloured(panel.colour(theme, which, "XfTextMuted", GREY), "or press " .. killKey.label .. " in the game")
          if ImGui.IsItemHovered() then
            ImGui.SetTooltip("Works in play, photo mode, menus and loading screens while the CET overlay is closed.")
          end
        end
      end
    end

    if live then
      drawComment(state, queue, theme, which)
    end

    -- 0.8.4 (the UI review): the Keys line, lower in the window, away from the Stop row.
    if bridge and bridge.enabled and bridge.listening and not bridge.killed then
      drawKillKey(state, queue, theme, which, info and type(info.kill_key) == "table" and info.kill_key or nil)
    end

    -- 0.8.22: the diagnostics, collapsed until opened.
    drawDiagnostics(state, theme, which, info)

    -- 0.8.7: Save anyway's outcome, once, in the message line.
    local saveLock = info and type(info.save_lock) == "table" and info.save_lock or nil
    if saveLock and saveLock.last and saveLock.last_seq ~= state.saveSeenSeq then
      state.saveSeenSeq = saveLock.last_seq
      state.message = tostring(saveLock.last)
    end

    if state.message then
      ImGui.Separator()
      wrapped(state.message)
    end

    if info then
      sectionGap(theme)
      panel.inRole(theme, "label", function()
        ImGui.TextDisabled("Version " .. tostring(info.plugin_version)) -- 0.8.4 (the UI review's fix 10): the title already names it
      end)
    end
  end)
  if state.testInput and state.testInput.ui then
    local lock = state.info and state.info.save_lock or nil
    state.testInput.ui("cet_window", { drawn = drew, heading = "XF Runtime Bridge", rect = state.testInput.windowRect(),
      save_button_drawn = recordSaveDrawn, save_button_text = recordSaveDrawn and "Save anyway" or nil,
      save_reason_text = recordSaveDrawn and "Saves are held: a test change would go into them." or nil,
      save_outcome_text = state.message, save_lock = lock })
  end
  ImGui.End()
  if not drew then error(err) end
end

return panel
