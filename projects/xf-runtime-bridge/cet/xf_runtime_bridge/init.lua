-- XF Runtime Bridge: CET (Cyber Engine Tweaks) layer.
--
-- Proves: CET events, per-mod logging, calls into the RED4ext natives (Game.XFBridge_*) and into
-- the redscript layer, a kill-switch hotkey, and a small always-visible status indicator.
-- CET has no networking (its sandbox exposes no sockets or HTTP), so the external bridge lives
-- in the RED4ext plugin; this layer only reports to it and shows its state.
--
-- Logs: bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/xf_runtime_bridge.log
-- (CET per-mod rotating log, 5 MiB x 3) and, through XFBridge_Log, the plugin's RED4ext log
-- with layer=cet. Every call here is pcall-guarded: if the plugin is missing, the mod says so
-- once and keeps running.

local MOD = "xf_runtime_bridge"
local REFRESH_SECONDS = 2.0

local state = {
  initialized = false,
  pluginPresent = nil, -- nil = unknown yet, true/false after the first native call
  info = nil,          -- decoded XFBridge_Info()
  sinceRefresh = 0,
  overlayOpen = false,
  cidCounter = 0,
  lastError = nil,
}

local function nextCid()
  state.cidCounter = state.cidCounter + 1
  return "cet-" .. tostring(state.cidCounter)
end

-- Writes to the CET mod log and, when the plugin is present, to the shared plugin log.
local function log(level, cid, message)
  local line = string.format("cid=%s %s", cid or "-", message)
  if level == "error" then
    spdlog.error(line)
  elseif level == "warn" then
    spdlog.warning(line) -- CET exposes spdlog.warning (there is no spdlog.warn)
  elseif level == "debug" then
    spdlog.debug(line)
  else
    spdlog.info(line)
  end
  if state.pluginPresent then
    pcall(function() Game.XFBridge_Log("cet", level, cid or "-", message) end)
  end
end

-- Calls a plugin native through CET's RTTI lookup; records whether the plugin is there.
local function callNative(name, ...)
  local args = { ... }
  -- unpack (not table.unpack): LuaJIT is Lua 5.1, and the CET sandbox whitelists `unpack`.
  local ok, result = pcall(function() return Game[name](unpack(args)) end)
  if ok then
    state.pluginPresent = true
    return true, result
  end
  if state.pluginPresent ~= false then
    spdlog.warning(string.format("native %s unavailable (XFRuntimeBridge.dll not loaded?): %s", name, tostring(result)))
  end
  state.pluginPresent = false
  state.lastError = tostring(result)
  return false, result
end

local function refreshInfo()
  local ok, text = callNative("XFBridge_Info")
  if not ok then return end
  local decoded, info = pcall(json.decode, text)
  if decoded then
    state.info = info
  else
    log("warn", "-", "XFBridge_Info returned invalid JSON")
  end
end

registerForEvent("onInit", function()
  state.initialized = true
  spdlog.info(string.format("onInit cet=%s", tostring(GetVersion())))

  local cid = nextCid()
  local ok, reply = callNative("XFBridge_Ping", "cet", cid)
  if ok then
    log("info", cid, "native ping reply: " .. tostring(reply))
    callNative("XFBridge_Announce", "cet", "onInit; CET " .. tostring(GetVersion()))
  end

  -- Redscript layer: CET maps the class XFRuntimeBridge.XFBridgeQuery to the Lua global
  -- XFRuntimeBridge_XFBridgeQuery ('.' becomes '_'). Guarded because that mapping is unverified.
  local describeCid = nextCid()
  local describeOk, described = pcall(function()
    return XFRuntimeBridge_XFBridgeQuery.DescribeJson(describeCid)
  end)
  if describeOk then
    log("info", describeCid, "redscript DescribeJson: " .. tostring(described))
  else
    log("warn", describeCid, "redscript DescribeJson not callable from CET: " .. tostring(described))
  end

  refreshInfo()
end)

registerForEvent("onUpdate", function(deltaTime)
  state.sinceRefresh = state.sinceRefresh + deltaTime
  if state.sinceRefresh >= REFRESH_SECONDS then
    state.sinceRefresh = 0
    refreshInfo()
  end
end)

registerForEvent("onOverlayOpen", function()
  state.overlayOpen = true
  log("debug", "-", "overlay opened")
end)

registerForEvent("onOverlayClose", function()
  state.overlayOpen = false
  log("debug", "-", "overlay closed")
end)

registerForEvent("onShutdown", function()
  log("info", "-", "onShutdown")
end)

-- Kill switch: bind it in CET's Bindings tab. The bridge refuses everything until restart.
registerHotkey("xf_bridge_kill", "Kill XF Runtime Bridge (stop the local pipe)", function()
  local cid = nextCid()
  local ok, killed = callNative("XFBridge_Kill", "cet-hotkey")
  log("warn", cid, "kill switch hotkey pressed; bridge killed=" .. tostring(ok and killed))
  refreshInfo()
end)

local function bridgeSummary()
  if state.pluginPresent == false then
    return "plugin not loaded", { 0.6, 0.6, 0.6, 1.0 }
  end
  local bridge = state.info and state.info.bridge
  if not bridge then
    return "starting", { 0.6, 0.6, 0.6, 1.0 }
  end
  if bridge.killed then
    return "killed", { 1.0, 0.35, 0.35, 1.0 }
  end
  if not bridge.enabled then
    return "off", { 0.6, 0.6, 0.6, 1.0 }
  end
  if bridge.listening then
    local mode = bridge.allow_writes and "writes ON" or "read-only"
    local client = bridge.has_client and ", client connected" or ""
    local color = bridge.allow_writes and { 1.0, 0.7, 0.2, 1.0 } or { 0.4, 0.9, 0.5, 1.0 }
    return "listening (" .. mode .. client .. ")", color
  end
  return "not listening", { 1.0, 0.35, 0.35, 1.0 }
end

registerForEvent("onDraw", function()
  local text, color = bridgeSummary()
  local enabled = state.info and state.info.bridge and state.info.bridge.enabled

  -- Always-visible indicator whenever the bridge is enabled: green while listening read-only,
  -- amber with writes on, red once killed. Never hidden while the bridge can be used.
  if enabled and not state.overlayOpen then
    ImGui.SetNextWindowPos(12, 12, ImGuiCond.Always)
    local flags = bit32.bor(ImGuiWindowFlags.NoDecoration, ImGuiWindowFlags.NoInputs,
      ImGuiWindowFlags.AlwaysAutoResize, ImGuiWindowFlags.NoSavedSettings, ImGuiWindowFlags.NoFocusOnAppearing)
    if ImGui.Begin("XF Runtime Bridge##indicator", flags) then
      ImGui.TextColored(color[1], color[2], color[3], color[4], "XF bridge: " .. text)
    end
    ImGui.End()
  end

  -- Details while the CET overlay is open.
  if state.overlayOpen then
    if ImGui.Begin("XF Runtime Bridge", ImGuiWindowFlags.AlwaysAutoResize) then
      ImGui.TextColored(color[1], color[2], color[3], color[4], "Bridge: " .. text)
      if state.info then
        ImGui.Text("Plugin " .. tostring(state.info.plugin_version) .. "  sid " .. tostring(state.info.sid))
        ImGui.Text("Game " .. tostring(state.info.game_product_version) .. " (" .. tostring(state.info.game_file_version) .. ")")
        ImGui.Text("State " .. tostring(state.info.game_state) .. "  ticks " .. tostring(state.info.running_ticks))
        local bridge = state.info.bridge or {}
        ImGui.Text("Requests " .. tostring(bridge.requests or 0) .. "  connections " .. tostring(bridge.connections or 0))
      elseif state.lastError then
        ImGui.Text("Last error: " .. state.lastError)
      end
      ImGui.Text("CET " .. tostring(GetVersion()))
    end
    ImGui.End()
  end
end)

return {
  version = "0.1.0",
  -- For other CET mods: GetMod("xf_runtime_bridge").info()
  info = function() return state.info end,
}
