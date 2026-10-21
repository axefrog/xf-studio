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
--     bridge's own kill key beside it (0.8.3, [ui] kill_key: it works in the game without CET).
--   * A commentary box (0.7; XFBridge_Comment): Send, or Ctrl+Enter (0.8, session 8's request; 0.8.2: read from the box's own
--     validation, since Ctrl+Enter ends the box's editing before anything after it can see the key).
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

-- The question's slot (0.8, the UI review): the pending question with its answers as primary buttons, each naming its key;
-- once answered, the same slot says what was sent, at the buttons' height, so nothing below it moves.
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
    local edge = panel.colour(theme, which, "XfAccentEdge", fill)
    local ink = panel.colour(theme, which, "XfAccentInk", { 0.09, 0.09, 0.05, 1.0 })
    ImGui.PushStyleColor(ImGuiCol.Button, fill[1], fill[2], fill[3], fill[4])
    ImGui.PushStyleColor(ImGuiCol.ButtonHovered, edge[1], edge[2], edge[3], edge[4])
    ImGui.PushStyleColor(ImGuiCol.ButtonActive, fill[1], fill[2], fill[3], fill[4])
    ImGui.PushStyleColor(ImGuiCol.Text, ink[1], ink[2], ink[3], ink[4])
    for i, label in ipairs(ask.choices) do
      if i > 1 then ImGui.SameLine() end
      local key = keys[i] and (" (" .. keyLabel(keys[i]) .. ")") or ""
      if ImGui.Button(tostring(label) .. key .. "##xf_answer_" .. tostring(i)) then
        queue("answer", { id = ask.id, choice = i - 1 })
      end
    end
    ImGui.PopStyleColor(4)
  else
    ImGui.AlignTextToFramePadding()
    coloured(panel.colour(theme, which, "XfTextMuted", GREY), "Sent: " .. tostring(answered.label) .. ". Waiting for the next question.")
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
  local flags = (ImGuiInputTextFlags and ImGuiInputTextFlags.EnterReturnsTrue) or 0
  local text, submitted = ImGui.InputTextMultiline("##xf_comment_" .. tostring(state.commentGen or 0), state.comment or "", 1000, width,
    ImGui.GetFontSize() * 4, flags)
  if type(text) == "string" then
    state.comment = text
  end
  local empty = not state.comment or not string.find(state.comment, "%S")
  if submitted and not empty then
    queue("comment", state.comment)
  end
  ImGui.BeginDisabled(empty)
  if ImGui.Button("Send##xf_comment_send") and not empty then
    queue("comment", state.comment)
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
    if live then
      drawQuestion(state, queue, theme, which)
    end

    if bridge and bridge.enabled then
      if bridge.killed then
        ImGui.Separator()
        if state.pending == "rearm" or (info and info.rearm_pending) then
          wrapped("Reconnecting... The bridge first puts back what it changed (a frozen world, a hidden menu), then starts again.")
        else
          wrapped("Reconnect starts the bridge again with a new connection key, without restarting the game. XF tools reconnect by themselves. If the bridge changed anything, saving stays locked until you load a save.")
          if ImGui.Button("Reconnect") then
            queue("rearm")
          end
        end
      elseif bridge.listening then
        ImGui.Separator()
        if bridge.allow_writes then
          if bridge.writes_paused then
            if ImGui.Button("Resume changes") then
              queue("pause", false)
            end
          else
            if ImGui.Button("Pause changes") then
              queue("pause", true)
            end
          end
          ImGui.SameLine()
        end
        if ImGui.Button("Mark this moment") then
          queue("mark")
        end
        -- 0.8 (the UI review): the kill switch on its own row, in the danger colour, away from the everyday buttons.
        ImGui.Spacing()
        ImGui.PushStyleColor(ImGuiCol.Text, RED[1], RED[2], RED[3], RED[4])
        local stop = ImGui.Button("Stop the bridge")
        ImGui.PopStyleColor(1)
        if stop then
          queue("kill")
        end
        -- 0.8.3: the bridge's own kill key ([ui] kill_key), which works in the game without CET.
        local killKey = info and type(info.kill_key) == "table" and info.kill_key or nil
        if killKey and killKey.enabled and type(killKey.label) == "string" then
          ImGui.SameLine()
          ImGui.TextDisabled("or press " .. killKey.label .. " in the game")
        end
      end
    end

    if live then
      drawComment(state, queue, theme, which)
    end

    if state.message then
      ImGui.Separator()
      wrapped(state.message)
    end

    if info then
      ImGui.Separator()
      ImGui.TextDisabled("XF Runtime Bridge " .. tostring(info.plugin_version))
    end
  end)
  ImGui.End()
  if not drew then error(err) end
end

return panel
