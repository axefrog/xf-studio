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
--   * Stop the bridge (the kill switch), while it listens.
-- Buttons only queue an action; init.lua carries it out in onUpdate, never while drawing.

local panel = {}

local GREY = { 0.65, 0.65, 0.65, 1.0 }
local GREEN = { 0.4, 0.9, 0.5, 1.0 }
local AMBER = { 1.0, 0.7, 0.2, 1.0 }
local RED = { 1.0, 0.4, 0.4, 1.0 }

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

-- state: init.lua's state (info from XFBridge_Info, pluginPresent, pending, message).
-- queue(name, argument): asks init.lua to run an action on the next update.
function panel.draw(state, queue)
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
      if ImGui.Button("Stop the bridge") then
        queue("kill")
      end
    end
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
