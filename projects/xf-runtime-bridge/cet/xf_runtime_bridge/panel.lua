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
--   * Stop the bridge (the kill switch), on its own row in the danger colour (0.8, the UI review), while it listens, with the
--     bridge's own kill key beside it (0.8.3, [ui] kill_key: it works in the game without CET). 0.8.4 (the maintainer: make
--     it configurable): Change... takes the next key pressed, with Ctrl, Shift or Alt held, and Reset to default puts
--     Ctrl + Shift + End back (XFBridge_KillKey saves either to config.ini); what else may react to the key is said under it.
--   * A commentary box (0.7; XFBridge_Comment): Send, or Ctrl+Enter (0.8, session 8's request; 0.8.2: read from the box's own
--     validation, since Ctrl+Enter ends the box's editing before anything after it can see the key). 0.8.4 (session 11: long
--     text ran out of view sideways): the text wraps at words (see drawComment).
-- Buttons only queue an action; init.lua carries it out in onUpdate, never while drawing.
-- 0.7: the window takes the XF Studio theme (theme.lua, generated from the Studio's tokens): dark by default, light when
-- the plugin's [overlay] theme says so; never switched automatically. init.lua themes its label through panel.pushTheme.

local panel = {}

local GREY = { 0.65, 0.65, 0.65, 1.0 }
local GREEN = { 0.4, 0.9, 0.5, 1.0 }
local AMBER = { 1.0, 0.7, 0.2, 1.0 }
local RED = { 1.0, 0.4, 0.4, 1.0 }
local DEFAULTS = { GREY = GREY, GREEN = GREEN, AMBER = AMBER, RED = RED }
local WRAP_EM = 28

local function coloured(colour, text)
  ImGui.TextColored(colour[1], colour[2], colour[3], colour[4], text)
end

local drawKillKey -- 0.8.4, defined with the kill-key controls below

local function wrapped(text)
  ImGui.PushTextWrapPos(ImGui.GetFontSize() * WRAP_EM)
  ImGui.TextWrapped(text)
  ImGui.PopTextWrapPos()
end

-- A theme colour by token (theme.lua), or the fallback.
function panel.colour(theme, which, name, fallback)
  local entry = theme and theme.colors and theme.colors[name]
  return (entry and entry[which]) or fallback
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

-- What this build may do to the game. Amber only while changes are allowed or paused (0.8, the UI review).
local function changesLine(bridge)
  if not bridge or not bridge.enabled or bridge.killed then
    return nil
  end
  if not bridge.allow_writes then
    return GREEN, "Read-only: this build can't change the game."
  end
  if bridge.writes_paused then
    return AMBER, "Changes are paused."
  end
  return AMBER, "Changes allowed (XF test profile)."
end

-- The XF Studio theme: pushes the ImGui colours and metrics the theme table maps from the Studio's tokens, and answers how
-- many colours and style values were pushed (both must be popped). Names this CET's ImGui doesn't have are skipped.
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
  return colours, vars
end

-- A key's name as the panels show it ("IK_F6" to "F6").
local function keyLabel(key)
  return (string.gsub(tostring(key), "^IK_", ""))
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

-- A button that ignores a click while the layout settles.
local function button(label)
  local pressed = ImGui.Button(label)
  return pressed and not settling
end

-- The style's horizontal frame padding and item spacing in pixels (the theme's metrics, as pushTheme scaled them).
local function spacing(theme)
  local m = theme and theme.metrics or {}
  local k = ImGui.GetFontSize() / (m.FontSize or 13)
  return (m.FramePaddingX or 8) * k, (m.ItemSpacingX or 8) * k
end

-- The question's slot (0.8, the UI review): the pending question with its answers as primary buttons, each naming its key;
-- once answered, the same slot says what was sent, at the buttons' height, so nothing below it moves. 0.8.4 (the UI
-- review's fixes 1-3): the hover is the Studio's primary hover (XfAccentHover; XfAccentEdge only as the border), the
-- buttons wrap onto a new row at the window's text width instead of widening it, and "Sent: ..." stays until the next
-- question takes its place.
local function drawQuestion(state, queue, theme, which)
  local ask = state.pendingAsk
  local answered = state.answeredAsk
  if not ask and not answered then return end
  ImGui.Separator()
  coloured(panel.colour(theme, which, "XfAccentText", AMBER), "Question from XF Studio")
  wrapped(tostring(ask and ask.text or answered.text))
  if ask then
    local keys = state.info and state.info.answer_keys or {}
    if state.keysArmed == false then keys = {} end -- 0.8.2: no key answers it now; the buttons do
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
    local pad, gap = spacing(theme)
    local limit = ImGui.GetFontSize() * WRAP_EM
    local used = 0
    for i, label in ipairs(ask.choices) do
      local key = keys[i] and (" (" .. keyLabel(keys[i]) .. ")") or ""
      local text = tostring(label) .. key
      local width = (ImGui.CalcTextSize(text)) + pad * 2
      if i > 1 and used + gap + width <= limit then
        ImGui.SameLine()
        used = used + gap + width
      else
        used = width
      end
      if button(text .. "##xf_answer_" .. tostring(i)) then
        queue("answer", { id = ask.id, choice = i - 1 })
      end
    end
    if bordered then ImGui.PopStyleVar(1) end
    ImGui.PopStyleColor(5)
  else
    ImGui.AlignTextToFramePadding()
    coloured(panel.colour(theme, which, "XfTextMuted", GREY), "Sent: " .. tostring(answered.label) .. ". Waiting for the next question.")
  end
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

-- 0.8.4: Change... and Reset to default under the kill switch, and what else may react to the key (bridge_info's kill_key:
-- warnings from the game's bindings and CET's hotkeys; notes; after a change, what can't be seen from here).
drawKillKey = function(state, queue, theme, which, killKey)
  if not killKey then return end
  ImGui.Separator()
  -- One row, the same height while capturing: the label, the key as a keycap, then Change... (or the capture prompt).
  ImGui.AlignTextToFramePadding()
  ImGui.Text("Keys")
  ImGui.SameLine()
  coloured(panel.colour(theme, which, "XfTextMuted", GREY), "Stop key")
  ImGui.SameLine()
  ImGui.BeginDisabled(true)
  ImGui.Button((killKey.enabled and tostring(killKey.label) or "Off") .. "##xf_killkey_cap")
  ImGui.EndDisabled()
  ImGui.SameLine()
  if state.killKeyCapture then
    coloured(panel.colour(theme, which, "XfAccentText", AMBER), "Press a key, with Ctrl, Shift or Alt if you like. Esc cancels.")
    local chord = panel.capturedChord()
    if chord == "cancel" then
      state.killKeyCapture = false
    elseif chord then
      state.killKeyCapture = false
      queue("killkey", { action = "set", key = chord })
    end
  else
    if button("Change...##xf_killkey_change") then state.killKeyCapture = true end
    if killKey.is_default == false then
      ImGui.SameLine()
      if button("Reset to " .. tostring(killKey.default) .. "##xf_killkey_reset") then
        queue("killkey", { action = "reset" })
      end
    end
  end
  if state.killKeyRefused then
    ImGui.PushTextWrapPos(ImGui.GetFontSize() * WRAP_EM)
    ImGui.TextColored(RED[1], RED[2], RED[3], RED[4], tostring(state.killKeyRefused))
    ImGui.PopTextWrapPos()
  end
  for _, warning in ipairs(type(killKey.warnings) == "table" and killKey.warnings or {}) do
    ImGui.PushTextWrapPos(ImGui.GetFontSize() * WRAP_EM)
    ImGui.TextColored(AMBER[1], AMBER[2], AMBER[3], AMBER[4], tostring(warning))
    ImGui.PopTextWrapPos()
  end
  if state.killKeyChanged then
    for _, note in ipairs(type(killKey.notes) == "table" and killKey.notes or {}) do
      ImGui.PushTextWrapPos(ImGui.GetFontSize() * WRAP_EM)
      ImGui.TextDisabled(tostring(note))
      ImGui.PopTextWrapPos()
    end
    if type(killKey.unseen) == "string" then
      ImGui.PushTextWrapPos(ImGui.GetFontSize() * WRAP_EM)
      ImGui.TextDisabled(killKey.unseen)
      ImGui.PopTextWrapPos()
    end
  end
end

-- The commentary box: Send, disabled while the box is empty, or Ctrl+Enter while typing (session 8's request).
-- 0.8.2 (session 9's C2: Ctrl+Enter only took the box out of editing): in a multi-line box Dear ImGui treats Ctrl+Enter as
-- "done" and ends the editing inside the widget call, so by the time the code after it ran, the box was no longer active and
-- the key went unseen. EnterReturnsTrue makes the call itself answer true for that Ctrl+Enter (plain Enter still starts a
-- new line), and the text is taken every frame.
local function drawComment(state, queue, theme, which)
  ImGui.Separator()
  ImGui.Text("Comment for XF Studio")
  local width = ImGui.GetFontSize() * WRAP_EM
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
    state.commentSoft = panel.carrySoft(before, text, state.commentSoft)
    state.comment = text
    if not nativeWrap and text ~= before then
      -- Wrap to the box's width, less its padding and a scrollbar's room.
      local wrapped, soft = panel.wrap(text, state.commentSoft, function(line) return (ImGui.CalcTextSize(line)) end,
        width - ImGui.GetFontSize() * 2)
      state.commentSoft = soft
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

-- state: init.lua's state (info from XFBridge_Info, pluginPresent, pending, message, pendingAsk, answeredAsk, comment).
-- queue(name, argument): asks init.lua to run an action on the next update.
-- theme: theme.lua's table, or nil.
function panel.draw(state, queue, theme)
  local which = "dark"
  local overlay = state.info and state.info.overlay
  if type(overlay) == "table" and overlay.theme == "light" then
    which = "light"
  end
  local colours, vars = panel.pushTheme(theme, which)
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
  if not ImGui.Begin("XF Runtime Bridge", ImGuiWindowFlags.AlwaysAutoResize) then
    ImGui.End()
    return
  end
  local drew, err = pcall(function()
    local info = state.info
    local bridge = info and info.bridge

    local colour, text = connectionLine(state)
    coloured(colour, text)
    local changesColour, changesText = changesLine(bridge)
    if changesText then
      coloured(changesColour, changesText)
    end

    local live = bridge and bridge.enabled and bridge.listening and not bridge.killed
    local slotTop = ImGui.GetCursorPosY()
    if live then
      drawQuestion(state, queue, theme, which)
    end
    panel.noteLayout(state, ImGui.GetCursorPosY() - slotTop)

    if bridge and bridge.enabled then
      if bridge.killed then
        ImGui.Separator()
        if state.pending == "rearm" or (info and info.rearm_pending) then
          wrapped("Reconnecting... The bridge first puts back what it changed (a frozen world, a hidden menu), then starts again.")
        else
          -- 0.8.4 (the UI review's fix 7): the button, and the one thing the player needs to know, only when it applies.
          if button("Reconnect") then
            queue("rearm")
          end
          if info and info.writes_used then
            wrapped("Saving stays locked until you load a save.")
          end
        end
      elseif bridge.listening then
        ImGui.Separator()
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
        -- 0.8 (the UI review): the kill switch on its own row, in the danger colour, away from the everyday buttons.
        ImGui.Spacing()
        ImGui.PushStyleColor(ImGuiCol.Text, RED[1], RED[2], RED[3], RED[4])
        local stop = button("Stop the bridge")
        ImGui.PopStyleColor(1)
        if stop then
          queue("kill")
        end
        -- 0.8.3: the bridge's own kill key ([ui] kill_key), which works in the game without CET. 0.8.4 (the UI review's
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

    if state.message then
      ImGui.Separator()
      wrapped(state.message)
    end

    if info then
      ImGui.Separator()
      ImGui.TextDisabled("Version " .. tostring(info.plugin_version)) -- 0.8.4 (the UI review's fix 10): the title already names it
    end
  end)
  ImGui.End()
  if not drew then error(err) end
end

return panel
