-- XF Runtime Bridge: the in-game panel (Cyber Engine Tweaks overlay). Test builds only: the -diagnostic
-- and -writes packages carry this file; the distribution package doesn't, and init.lua then shows its
-- plain details window instead.
--
-- It shows, in plain words, whether the bridge is listening and whether an XF tool is connected, and
-- whether this build may change the game. It offers only what the player can do right now:
--   * Reconnect after the kill switch, without restarting the game (XFBridge_Rearm: the plugin starts a
--     fresh session with a new connection key once it has put back what it changed; XF tools reconnect
--     by themselves).
--   * Pause and resume changes, where this build allows changes at all (XFBridge_PauseWrites). Pausing can
--     only take access away: resuming gives back exactly what the bridge's config.ini allows.
--   * Mark this moment (0.6): a marker in the session's event stream (XFBridge_Note), for the coordinator's session.log; the
--     coordinator also treats it as "ready".
--   * 0.7 (session 7, in-game driving): the coordinator's pending question with one button per answer (Ready, Yes, No by
--     default; XFBridge_Answer), and a commentary box with Send (XFBridge_Comment), both into the session's event stream,
--     where session.wait returns them.
--   * Stop the bridge (the kill switch), while it listens.
-- Buttons only queue an action; init.lua carries it out in onUpdate, never while drawing.
-- 0.7: the window takes the XF Studio theme (theme.lua, generated from the Studio's tokens): dark by default, light when
-- the plugin's [overlay] theme says so; never switched automatically.

local panel = {}

local GREY = { 0.65, 0.65, 0.65, 1.0 }
local GREEN = { 0.4, 0.9, 0.5, 1.0 }
local AMBER = { 1.0, 0.7, 0.2, 1.0 }
local RED = { 1.0, 0.4, 0.4, 1.0 }
local DEFAULTS = { GREY = GREY, GREEN = GREEN, AMBER = AMBER, RED = RED }

local function coloured(colour, text)
  ImGui.TextColored(colour[1], colour[2], colour[3], colour[4], text)
end

local function wrapped(text)
  ImGui.PushTextWrapPos(ImGui.GetFontSize() * 28)
  ImGui.TextWrapped(text)
  ImGui.PopTextWrapPos()
end

-- The connection, in one line and one colour.
local function connectionLine(state)
  if state.pluginPresent == false then
    return GREY, "The bridge's plugin isn't loaded."
  end
  local info = state.info
  local bridge = info and info.bridge
  if not bridge then
    return GREY, "Starting..."
  end
  if not bridge.enabled then
    return GREY, "Off in this build (config.ini: enabled = false)."
  end
  if bridge.killed then
    return RED, "Stopped by the kill switch."
  end
  if not bridge.listening then
    return RED, "Not listening (see the plugin log)."
  end
  if bridge.has_client then
    return GREEN, "Connected to an XF tool."
  end
  return GREEN, "Listening; no XF tool connected."
end

-- What this build may do to the game.
local function changesLine(bridge)
  if not bridge or not bridge.enabled then
    return nil
  end
  if not bridge.allow_writes then
    return GREY, "Read-only: this build can't change the game."
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

local function pushTheme(theme, which)
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

local function xfColour(theme, which, name, fallback)
  local entry = theme and theme.colors and theme.colors[name]
  return (entry and entry[which]) or fallback
end

-- The pending question and its answer buttons, then the commentary box.
local function drawDriving(state, queue, theme, which)
  local ask = state.pendingAsk
  if ask then
    ImGui.Separator()
    coloured(xfColour(theme, which, "XfAccentText", AMBER), "Question from XF Studio")
    wrapped(tostring(ask.text))
    for i, label in ipairs(ask.choices) do
      if i > 1 then ImGui.SameLine() end
      if ImGui.Button(tostring(label) .. "##xf_answer_" .. tostring(i)) then
        queue("answer", { id = ask.id, choice = i - 1 })
      end
    end
  end
  ImGui.Separator()
  ImGui.Text("Comment for XF Studio")
  local width = ImGui.GetFontSize() * 26
  local text, changed = ImGui.InputTextMultiline("##xf_comment", state.comment or "", 1000, width, ImGui.GetFontSize() * 4)
  if changed then
    state.comment = text
  end
  if ImGui.Button("Send##xf_comment_send") and state.comment and #state.comment > 0 then
    queue("comment", state.comment)
  end
end

-- state: init.lua's state (info from XFBridge_Info, pluginPresent, pending, message, pendingAsk, comment).
-- queue(name, argument): asks init.lua to run an action on the next update.
-- theme: theme.lua's table, or nil.
function panel.draw(state, queue, theme)
  local which = "dark"
  local overlay = state.info and state.info.overlay
  if type(overlay) == "table" and overlay.theme == "light" then
    which = "light"
  end
  local colours, vars = pushTheme(theme, which)
  local ok, err = pcall(panel.body, state, queue, theme, which)
  if vars > 0 then ImGui.PopStyleVar(vars) end
  if colours > 0 then ImGui.PopStyleColor(colours) end
  if not ok then error(err) end
end

function panel.body(state, queue, theme, which)
  -- The status colours from the theme's semantic tokens (success, warning, danger, faint text).
  GREY = xfColour(theme, which, "TextDisabled", DEFAULTS.GREY)
  GREEN = xfColour(theme, which, "XfSuccess", DEFAULTS.GREEN)
  AMBER = xfColour(theme, which, "XfWarning", DEFAULTS.AMBER)
  RED = xfColour(theme, which, "XfDanger", DEFAULTS.RED)
  if not ImGui.Begin("XF Runtime Bridge", ImGuiWindowFlags.AlwaysAutoResize) then
    ImGui.End()
    return
  end
  local info = state.info
  local bridge = info and info.bridge

  local colour, text = connectionLine(state)
  coloured(colour, text)
  local changesColour, changesText = changesLine(bridge)
  if changesText then
    coloured(changesColour, changesText)
  end

  if bridge and bridge.enabled then
    ImGui.Separator()
    if bridge.killed then
      if state.pending == "rearm" or (info and info.rearm_pending) then
        wrapped("Reconnecting... The bridge first puts back what it changed (a frozen world, a hidden menu), then starts again.")
      else
        wrapped("Reconnect starts the bridge again with a new connection key, without restarting the game. XF tools reconnect by themselves. If the bridge changed anything, saving stays locked until you load a save.")
        if ImGui.Button("Reconnect") then
          queue("rearm")
        end
      end
    elseif bridge.listening then
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
      ImGui.SameLine()
      if ImGui.Button("Stop the bridge") then
        queue("kill")
      end
    end
  end

  if bridge and bridge.enabled and bridge.listening and not bridge.killed then
    drawDriving(state, queue, theme, which)
  end

  if state.message then
    ImGui.Separator()
    wrapped(state.message)
  end

  if info then
    ImGui.Separator()
    ImGui.TextDisabled(string.format("Plugin %s  |  %s requests  |  %s reconnects", tostring(info.plugin_version),
      tostring(bridge and bridge.requests or 0), tostring(bridge and bridge.rearms or 0)))
  end
  ImGui.End()
end

return panel
