-- XF Runtime Bridge: CET (Cyber Engine Tweaks) layer.
--
-- Proves: CET events, per-mod logging, calls into the RED4ext natives (Game.XFBridge_*) and into
-- the redscript layer, a kill-switch hotkey, and the CET line (top left) with the coordinator's messages under it
-- (ui.message, bridge 0.4). 0.8.2 (the maintainer's decision after session 9): one status surface at a time; the CET line
-- (one line with a coloured dot at the far top left) is the fallback, drawn only when neither the ink panel nor the XF box
-- (the small box with the yellow heading) can show (the plugin says which: the HUD frame's surface record; none while a
-- loading screen shows, 0.8.3). The XF Runtime Bridge window (panel.lua) stays the interactive place.
-- CET has no networking (its sandbox exposes no sockets or HTTP), so the external bridge lives
-- in the RED4ext plugin; this layer only reports to it and shows its state.
--
-- Logs: bin/x64/plugins/cyber_engine_tweaks/mods/XF_Runtime_Bridge/XF_Runtime_Bridge.log
-- (CET per-mod rotating log, 5 MiB x 3) and, through XFBridge_Log, the plugin's RED4ext log
-- with layer=cet. Every call here is pcall-guarded: if the plugin is missing, the mod says so
-- once and keeps running.

-- 0.8.2: CET names the mod after its folder, XF_Runtime_Bridge, so its Bindings group reads "XF Runtime Bridge".
local MOD = "XF_Runtime_Bridge"
local REFRESH_SECONDS = 2.0
local PENDING_REFRESH_SECONDS = 0.5
local OPTIONS_POLL_SECONDS = 0.25
local MESSAGES_POLL_SECONDS = 0.25
-- The message lines wrap at this width (pixels), so they stay in the top-left corner, clear of the
-- centre of the screen where every framing and capture region sits. The XF box sits right of it (x 700).
local MESSAGE_WRAP_PX = 640
-- 0.8 (the UI review): each level's colour is a theme token (theme.lua, from XF Studio's own tokens); these are the
-- fallbacks for a package without the theme.
local MESSAGE_TOKENS = { info = "Text", ask = "XfAccentText", warn = "XfWarning", done = "XfSuccess" }
local MESSAGE_COLORS = {
  info = { 0.92, 0.92, 0.92, 1.0 },
  ask = { 1.0, 0.82, 0.3, 1.0 },
  warn = { 1.0, 0.45, 0.4, 1.0 },
  done = { 0.45, 0.95, 0.55, 1.0 },
}
local MUTED = { 0.69, 0.71, 0.73, 1.0 }
-- 0.8: the status line's tone (the plugin's core/InkUi.cpp Summarize): amber only while changes are allowed or paused.
local TONE_TOKENS = { ok = "XfSuccess", write = "XfWarning", paused = "XfWarning", killed = "XfDanger", off = "TextDisabled", idle = "TextDisabled" }
local TONE_COLORS = {
  ok = { 0.4, 0.9, 0.5, 1.0 },
  write = { 1.0, 0.7, 0.2, 1.0 },
  paused = { 1.0, 0.7, 0.2, 1.0 },
  killed = { 1.0, 0.35, 0.35, 1.0 },
  off = { 0.6, 0.6, 0.6, 1.0 },
  idle = { 0.6, 0.6, 0.6, 1.0 },
}
local MIDDLE_DOT = " \194\183 " -- U+00B7, which CET's Latin-1 font has
-- The plugin refuses a value longer than this, and an answer larger than its 64 KiB limit
-- (core/OptionsExchange.hpp); such values are left out and named under "skipped" instead (RB-47).
local MAX_OPTION_VALUE_CHARS = 256
local MAX_OPTIONS_ANSWER_BYTES = 60000

-- The in-game panel (panel.lua) ships in the test packages only; without it the overlay shows the plain
-- details window below.
local hasPanel, panel = pcall(require, "panel")
if not hasPanel or type(panel) ~= "table" then
  panel = nil
end
-- Bridge 0.7: the XF Studio theme (generated from the Studio's design tokens by tools/overlay/theme.ts).
local hasTheme, theme = pcall(require, "theme")
if not hasTheme or type(theme) ~= "table" then
  theme = nil
end

local state = {
  initialized = false,
  pluginPresent = nil, -- nil = unknown yet, true/false after the first native call
  info = nil,          -- decoded XFBridge_Info()
  sinceRefresh = 0,
  sinceOptionsPoll = 0,
  sinceMessagesPoll = 0,
  messages = {},   -- ui.message lines: { {text, level}, ... }, oldest first (XFBridge_Messages)
  pendingAsk = nil, -- 0.7: the ask waiting for the player's answer: { id, text, choices } (XFBridge_Messages' pending_ask)
  answeredAsk = nil, -- 0.8: the answered ask still showing: { id, text, label } (answered_ask)
  latestMessage = nil, -- 0.8.9: the newest ui.message line when no question holds the window's slot: { id, text, level }
  inkAsk = 0,        -- 0.8: the question the ink panel shows on screen now (the frame's inkask record), or 0
  comment = "",     -- 0.7: the commentary box's text
  commentSoft = {}, -- 0.8.4: where the box wrapped a space into a line break (panel.wrap)
  commentReload = nil, -- 0.8.4: rewrapped text for the box being edited, handed over in one read-only frame
  killKeyCapture = false, -- 0.8.4: Change... is waiting for the new stop key
  killKeyChanged = false, -- 0.8.4: the key was changed in this window (its notes then show)
  killKeySaved = nil,     -- 0.8.5: what the last change did, shown on the Keys line (0.8.6: in the prompt's reserved line)
  cetLabel = true, -- bridge 0.5.3: [ui] cet_label / ui.hud's cet_label (read from XFBridge_Hud's frame)
  surface = "cet_line", -- 0.8.2: the status surface the plugin chose (0.8.3: ink_panel, xf_box, cet_line, none)
  overlayOpen = false,
  cidCounter = 0,
  lastError = nil,
  actions = {},    -- queued by the panel's buttons, run in onUpdate (never while drawing)
  pending = nil,   -- "rearm" while a reconnect is under way
  message = nil,   -- the panel's last outcome, in plain words
  messageOk = true,
  -- 0.8.22, cet.panel (XFBridge_CetPanel): the last request applied, the header state wanted (applied once, before the header) and
  -- as last drawn, what the status surfaces last drew (chip, tone, which surface) and how the last requested press went.
  headerDone = {},  -- the draws that applied header requests: { id, previous } (or { id, superseded = true }), the last few
  pressSeen = {},   -- the press request ids already queued (a request sent again runs once)
  diagnosticsWanted = nil, -- { id, value }
  diagnosticsOpen = nil,
  drawnChip = nil,
  drawnTone = nil,
  drawnSurface = nil,
  lastPress = nil,
}

local hasTestInput, testInput = pcall(require, "test-input")
if hasTestInput and type(testInput) == "table" then state.testInput = testInput end

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

-- 0.8.22: a draw call the panel tried and this CET refused or answered differently is named once in the mod's log (the part that
-- needed it draws plain); the window and the line never go down for it.
state.noteDraw = function(name, why)
  log("info", "-", "CET: the " .. tostring(name) .. " draw call failed, so that part draws plain: " .. tostring(why))
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
    -- 0.8.22: the overlay's state is known from here on: closed, unless CET opens it. CET sends onOverlayOpen straight after
    -- onInit when its overlay is already open (a start with it open, Reload all mods), so a reload never leaves it unknown.
    callNative("XFBridge_CetOverlay", state.overlayOpen == true)
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

-- game.options.read: the engine's render options (GameOptions, e.g. Editor/Characters/Hair/GlobalLight/R)
-- can't be read from game scripts, but CET reads them (GameOptions.Get). The plugin names the options
-- it waits for (XFBridge_OptionsWanted: {"seq":n,"names":["Category/Name",...]} or ""), and this layer
-- answers once with their current values as text (XFBridge_OptionsReport). Read-only: nothing here
-- sets an option. Polled four times a second, and only while the bridge is on and not killed.
local function answerOptions()
  local bridge = state.info and state.info.bridge
  if not state.pluginPresent or not bridge or not bridge.enabled or bridge.killed then return end
  local ok, wanted = pcall(function() return Game.XFBridge_OptionsWanted() end)
  if not ok or type(wanted) ~= "string" or wanted == "" then return end
  local decoded, request = pcall(json.decode, wanted)
  if not decoded or type(request) ~= "table" or type(request.names) ~= "table" or type(request.seq) ~= "number" then return end
  local values = {}
  local skipped = {}
  local found = 0
  local size = 64
  for _, full in ipairs(request.names) do
    local category, name = string.match(tostring(full), "^(.+)/([^/]+)$")
    if category and name then
      local got, text = pcall(function() return GameOptions.Get(category, name) end)
      if got and type(text) == "string" and text ~= "" then
        -- Too long for the plugin, or past the answer's size limit: left out and named (RB-47).
        local cost = #full + #text + 8
        if #text > MAX_OPTION_VALUE_CHARS or size + cost > MAX_OPTIONS_ANSWER_BYTES then
          table.insert(skipped, full)
          size = size + #full + 4
        else
          values[full] = text
          found = found + 1
          size = size + cost
        end
      end
    end
  end
  local encoded, body = pcall(json.encode, { seq = request.seq, values = values, skipped = skipped })
  if not encoded then
    log("warn", "-", "render options: could not encode the answer: " .. tostring(body))
    return
  end
  local sent, stored = pcall(function() return Game.XFBridge_OptionsReport(body) end)
  log("debug", "-", string.format("render options answered: seq=%s found=%d of %d skipped=%d stored=%s", tostring(request.seq),
    found, #request.names, #skipped, tostring(sent and stored)))
end

-- 0.8.22, cet.panel: the report of what this layer drew goes in, and the requests not completed yet come back (a JSON array, oldest
-- first). Receipt is not completion (the review): a header request is completed only by the draw that applies it (header_done,
-- with the header as drawn before it, or nothing when it had never been drawn), so the plugin sends it again until then, a CET
-- reload included; a press is queued once per request id, and runs only once the plugin grants its claim (remote_pause), so a
-- request sent again never runs twice and one the kill switch cancelled never runs. A stopped bridge queues no press.
local HEADER_DONE_KEPT = 8
local function headerDone(entry)
  table.insert(state.headerDone, entry)
  while #state.headerDone > HEADER_DONE_KEPT do table.remove(state.headerDone, 1) end
end
state.headerDoneFor = headerDone -- panel.lua reports the draw that applied a header request

local function exchangePanel(bridge)
  local report = { header_done = state.headerDone, diagnostics_open = state.diagnosticsOpen,
    diagnostics_pending = state.diagnosticsWanted and state.diagnosticsWanted.value, chip = state.drawnChip, tone = state.drawnTone,
    surface = state.drawnSurface, last_press = state.lastPress, panel = panel ~= nil, cet_open = state.overlayOpen == true }
  local encoded, body = pcall(json.encode, report)
  if not encoded or type(body) ~= "string" then return end
  local ok, text = pcall(function() return Game.XFBridge_CetPanel(body) end)
  if not ok or type(text) ~= "string" or text == "" then return end
  local decoded, requests = pcall(json.decode, text)
  if not decoded or type(requests) ~= "table" then return end
  for _, request in ipairs(requests) do
    local id = type(request) == "table" and tonumber(request.id) or nil
    if id then
      if request.diagnostics_open ~= nil then
        local wanted = state.diagnosticsWanted
        if not wanted or wanted.id < id then
          if wanted then headerDone({ id = wanted.id, superseded = true }) end
          state.diagnosticsWanted = { id = id, value = request.diagnostics_open == true }
        end
      end
      if (request.press == "pause_changes" or request.press == "resume_changes") and not state.pressSeen[id] and not (bridge and bridge.killed) then
        state.pressSeen[id] = true
        table.insert(state.actions, { name = "remote_pause", request = { id = id, target = request.press } })
      end
    end
  end
end

-- ui.message: the lines the plugin holds (XFBridge_Messages answers {"messages":[{text, level, ...}]} or "").
-- A killed bridge answers none. Read-only; polled four times a second while the bridge is on.
local function pollMessages()
  local bridge = state.info and state.info.bridge
  -- 0.8.2: the CET line shows only when the plugin names it the status surface (a plugin without the record, or no answer:
  -- always), a stopped bridge included: while the HUD shows, its ink panel says how to reconnect.
  local hudOk, frame = false, nil
  if state.pluginPresent and bridge and bridge.enabled then
    hudOk, frame = pcall(function() return Game.XFBridge_Hud() end)
  end
  if state.pluginPresent and bridge and bridge.enabled then exchangePanel(bridge) end
  local surface = hudOk and type(frame) == "string" and string.match(frame, "\nsurface\t([%a_]+)\n") or nil
  state.surface = surface or "cet_line"
  if not state.pluginPresent or not bridge or not bridge.enabled or bridge.killed then
    state.messages = {}
    state.pendingAsk = nil
    state.answeredAsk = nil
    state.latestMessage = nil
    state.cetLabel = true -- cet_label never hides a stopped bridge's label (the window's Reconnect is named there)
    return
  end
  -- Bridge 0.5.3 (temporary test feature): the ink HUD panel's frame says whether this label should show (cet_label). A plugin
  -- without XFBridge_Hud (older builds) keeps the label.
  state.cetLabel = not (hudOk and type(frame) == "string" and string.find(frame, "\ncet_label\t0\n", 1, true) ~= nil)
  -- 0.8 (the UI review): while the ink panel shows the question on screen, this label keeps to the status and the keys.
  -- 0.8.2 (the review): whether the answer keys answer the pending question now (a plugin without the record: as before).
  local keys = hudOk and type(frame) == "string" and string.match(frame, "\nkeys\t(%d)\n") or nil
  state.keysArmed = keys ~= "0"
  local inkAsk = hudOk and type(frame) == "string" and string.match(frame, "\ninkask\t(%d+)\n") or nil
  state.inkAsk = tonumber(inkAsk) or 0
  local ok, text = pcall(function() return Game.XFBridge_Messages() end)
  if not ok or type(text) ~= "string" or text == "" then
    -- 0.8.2 (session 9: "Answer: F6 Done" stayed after the last answer): an empty board has no question either. 0.8.4 (the
    -- UI review's fix 2): what was sent stays in the window's question slot until the next question takes its place, so
    -- the buttons under it don't move.
    state.messages = {}
    state.pendingAsk = nil
    state.latestMessage = nil
    return
  end
  local decoded, answer = pcall(json.decode, text)
  if not decoded or type(answer) ~= "table" or type(answer.messages) ~= "table" then return end
  local lines = {}
  for _, message in ipairs(answer.messages) do
    if type(message) == "table" and type(message.text) == "string" then
      table.insert(lines, { id = message.id, text = message.text, level = MESSAGE_COLORS[message.level] and message.level or "info" })
    end
  end
  state.messages = lines
  local ask = answer.pending_ask
  if type(ask) == "table" and type(ask.id) == "number" and type(ask.choices) == "table" then
    state.pendingAsk = ask
  else
    state.pendingAsk = nil
  end
  local answered = answer.answered_ask
  if type(answered) == "table" and type(answered.id) == "number" and type(answered.label) == "string" then
    state.answeredAsk = answered
  elseif state.pendingAsk then
    state.answeredAsk = nil -- 0.8.4: the new question takes the slot; until then the last "Sent: ..." stays
  end
  -- 0.8.9 (session 15: the window kept an answered question while a newer line showed on the ink panel): the newest line
  -- (info included) takes the slot from an older answered question, so the window never shows something staler than the panel.
  local newest = nil
  for _, line in ipairs(lines) do
    if type(line.id) == "number" and (not newest or line.id > newest.id) then newest = line end
  end
  state.latestMessage = nil
  if not state.pendingAsk and newest and (not state.answeredAsk or newest.id > state.answeredAsk.id) then
    state.answeredAsk = nil
    state.latestMessage = nil
    state.latestMessage = newest
  end
end

-- The panel's actions, run from onUpdate. Each asks the plugin, then shows its answer in plain words.
local function decodeAnswer(ok, text)
  if not ok or type(text) ~= "string" then return nil end
  local decoded, answer = pcall(json.decode, text)
  if decoded and type(answer) == "table" then return answer end
  return nil
end

-- 0.8.6 (the UI review's P4: the window put the plugin's reason inside its own sentence, one of them naming the kill switch and
-- giving two conflicting steps): a refused or failed Reconnect in plain words with one next step, by the plugin's code
-- (XFBridge_Rearm's answer and last_rearm); the plugin's own reason goes only to the log. "Restart the game" only for a real
-- failure.
local REARM_AGAIN = "The bridge is still putting things back. Press Reconnect again in a moment."
local REARM_FAILED = "The bridge couldn't start again. Restart the game to start it."
local REARM_COPY = {
  still_closing = REARM_AGAIN,
  restore_pending = REARM_AGAIN,
  already_running = "The bridge is already running.",
  not_stopped = "The bridge is already running.",
  off = "The bridge is switched off in its settings, so there is nothing to reconnect.",
}

local function rearmCopy(code)
  return REARM_COPY[code] or REARM_FAILED
end

local function runAction(action)
  local cid = nextCid()
  if action.name == "rearm" then
    local answer = decodeAnswer(callNative("XFBridge_Rearm", "cet-panel"))
    if answer and answer.requested then
      state.pending = "rearm"
      state.message = "Reconnecting..."
      state.messageOk = true
      log("warn", cid, "panel: reconnect requested")
    else
      state.message = answer and rearmCopy(answer.code) or "The bridge didn't answer. Restart the game to start it again."
      state.messageOk = false
      log("warn", cid, "panel: reconnect refused: code=" .. tostring(answer and answer.code) .. " " .. tostring(answer and answer.reason))
    end
  elseif action.name == "pause" or action.name == "remote_pause" then
    local request = action.request
    local paused = action.argument == true
    if action.name == "remote_pause" then
      -- 0.8.22 (the review): a press cet.panel asked for runs only once the plugin grants its claim (its session, client and the
      -- bridge still the ones it was asked under, and not a resume over the player's own pause); XFBridge_PauseWrites then takes
      -- the claim, so the plugin knows the bridge paused, not the player.
      local encoded, body = pcall(json.encode, { claim = request.id })
      local claim = encoded and decodeAnswer(callNative("XFBridge_CetPanel", body)) or nil
      if not (claim and claim.claimed) then
        state.lastPress = { id = request.id, target = request.target, refused = claim and claim.why or "the plugin didn't answer" }
        log("info", cid, "panel: requested " .. tostring(request.target) .. " not run: " .. tostring(state.lastPress.refused))
        refreshInfo()
        return
      end
      paused = request.target == "pause_changes"
    end
    local answer = decodeAnswer(callNative("XFBridge_PauseWrites", paused))
    if answer and answer.reason then
      state.message = answer.reason
      state.messageOk = false
    elseif answer then
      state.message = answer.writes_paused and "Changes are paused: XF tools can still look, but can't change the game."
        or "Changes are allowed again."
      state.messageOk = true
    end
    log("info", cid, "panel: writes paused=" .. tostring(answer and answer.writes_paused))
    -- 0.8.22: a press cet.panel asked for says how it went (bridge.info cet_panel.last_press).
    if request then
      state.lastPress = { id = request.id, target = request.target, answer = answer or { error = "the plugin didn't answer" } }
    end
  elseif action.name == "diagnostics" then
    local encoded, body = pcall(json.encode, { diagnostics_set = action.argument == true })
    local answer = encoded and decodeAnswer(callNative("XFBridge_CetPanel", body)) or nil
    if not (answer and answer.applied) then
      state.message = answer and answer.reason or "Diagnostics couldn't open. Enable the XF overlay and restart the game."
    end
  elseif action.name == "mark" then
    -- 0.6: a marker in the session's event stream, for the coordinator to find (session.log); changes nothing.
    local ok, noted = callNative("XFBridge_Note", "ask", "The player marked this moment in the XF Runtime Bridge window")
    state.message = (ok and noted) and "Marked: the session log has a marker at this moment." or "The bridge didn't answer. Restart the game to start it again."
    state.messageOk = ok and noted
    log("info", cid, "panel: marker noted=" .. tostring(ok and noted))
  elseif action.name == "answer" then
    -- 0.7: the player's answer to the coordinator's question (the panel's buttons), into the session's event stream.
    local arg = action.argument or {}
    local answer = decodeAnswer(callNative("XFBridge_Answer", arg.id or 0, arg.choice or 0, "cet_button"))
    if answer and answer.ok then
      -- 0.8 (the UI review): the question's own slot says so ("Sent: ..."), from the answered ask; no extra line here.
      state.message = nil
    else
      state.message = answer and answer.why and ("The answer didn't go through: " .. tostring(answer.why) .. ". Wait for the next question.")
        or "The bridge didn't answer. Restart the game to start it again."
      state.messageOk = false
    end
    log("info", cid, "panel: answer id=" .. tostring(arg.id) .. " choice=" .. tostring(arg.choice) .. " ok=" .. tostring(answer and answer.ok))
    pollMessages()
  elseif action.name == "comment" then
    local text = tostring(action.argument or "")
    local ok, sent = callNative("XFBridge_Comment", text)
    if ok and sent then
      state.message = "Comment sent to the session log."
      state.messageOk = true
      state.comment = ""
      state.commentSoft = {}
      state.commentHistory = nil
      state.commentReload = nil
      state.commentGen = (state.commentGen or 0) + 1 -- a fresh box: ImGui keeps an active box's own text
    else
      state.message = "The comment didn't go through. Try Send again; if it fails again, restart the game."
      state.messageOk = false
    end
    log("info", cid, "panel: comment sent=" .. tostring(ok and sent) .. " chars=" .. tostring(#text))
  elseif action.name == "killkey" then
    -- 0.8.4: the stop key chosen in this window (Change... or Reset), saved by the plugin to config.ini's [ui] kill_key.
    -- 0.8.5 (session 12's K3: answering a question cleared the general message line, so "saved" was never seen): the outcome
    -- stays on the Keys line (killKeySaved). 0.8.6 (the UI review's P1 and P2): without the backup's folder (the README and
    -- config.ini's comment name it; the player can't act on a path), in the prompt's reserved line; a refusal replaces it there.
    local arg = action.argument or {}
    local answer = decodeAnswer(callNative("XFBridge_KillKey", arg.action or "get", arg.key or ""))
    if answer and answer.ok then
      local label = answer.kill_key and answer.kill_key.label or tostring(arg.key)
      state.killKeyChanged = true
      state.killKeyRefused = nil
      if answer.saved then
        state.killKeySaved = "The stop key is now " .. tostring(label) .. ", saved for next time."
      else
        state.killKeySaved = "The stop key is now " .. tostring(label) .. " until the game closes; it couldn't be saved for next time."
        log("warn", cid, "panel: stop key not saved: " .. tostring(answer.save_error))
      end
    elseif answer and answer.why then
      state.killKeyRefused = tostring(answer.why)
      state.killKeySaved = nil
    else
      state.message = "The bridge didn't answer. Restart the game to start it again."
      state.messageOk = false
    end
    log("warn", cid, "panel: stop key " .. tostring(arg.action) .. " " .. tostring(arg.key) .. " ok=" .. tostring(answer and answer.ok))
  elseif action.name == "saveanyway" then
    local arg = action.argument or {}
    local token = arg.test_token
    local accepted = token and state.testInput and state.testInput.stage("dequeued", token)
    if token and not accepted and not arg.physical then return end
    -- 0.8.7: the window's Save anyway, the player's own say-so to save past the bridge's save lock. The plugin makes one manual
    -- save as game.save {override_lock: true} would, on its own thread, and the outcome comes back on the status surface.
    local source = token and accepted and ("cet-panel-test:" .. tostring(token.request_id)) or "cet-panel"
    local answer = decodeAnswer(callNative("XFBridge_SaveAnyway", source))
    if token and accepted then state.testInput.stage("native", token, answer) end
    if answer and answer.started then
      state.message = "Saving... The XF Runtime Bridge window says when it's done."
      state.messageOk = true
    else
      state.message = answer and answer.why and ("The save didn't start: " .. tostring(answer.why) .. ".")
        or "The bridge didn't answer. Restart the game to start it again."
      state.messageOk = false
    end
    log("warn", cid, "panel: save anyway started=" .. tostring(answer and answer.started) .. " " .. tostring(answer and answer.why))
  elseif action.name == "kill" then
    local ok, killed = callNative("XFBridge_Kill", "cet-panel")
    state.message = (ok and killed) and "The bridge is stopped. Reconnect starts it again." or "The bridge wasn't running."
    state.messageOk = ok and killed
    log("warn", cid, "panel: kill switch pressed; killed=" .. tostring(ok and killed))
  end
  refreshInfo()
end

local function queueAction(name, argument)
  table.insert(state.actions, { name = name, argument = argument })
end

-- While a reconnect is under way: when the plugin reports it done, say how it went.
local function followPending()
  if state.pending ~= "rearm" or not state.info then return end
  if state.info.rearm_pending then return end
  local outcome = state.info.last_rearm
  state.pending = nil
  if type(outcome) == "table" and outcome.ok then
    state.message = "Reconnected. XF tools connect again by themselves."
    state.messageOk = true
  else
    state.message = type(outcome) == "table" and rearmCopy(outcome.code) or "The bridge didn't answer. Restart the game to start it again."
    state.messageOk = false
    log("warn", "-", "panel: reconnect failed: code=" .. tostring(type(outcome) == "table" and outcome.code or nil) .. " "
      .. tostring(type(outcome) == "table" and outcome.message or nil))
  end
end

registerForEvent("onUpdate", function(deltaTime)
  if state.testInput and state.testInput.advance then state.testInput.advance(deltaTime) end
  while #state.actions > 0 do
    runAction(table.remove(state.actions, 1))
  end
  state.sinceRefresh = state.sinceRefresh + deltaTime
  if state.sinceRefresh >= (state.pending and PENDING_REFRESH_SECONDS or REFRESH_SECONDS) then
    state.sinceRefresh = 0
    refreshInfo()
    followPending()
  end
  state.sinceOptionsPoll = state.sinceOptionsPoll + deltaTime
  if state.sinceOptionsPoll >= OPTIONS_POLL_SECONDS then
    state.sinceOptionsPoll = 0
    answerOptions()
  end
  state.sinceMessagesPoll = state.sinceMessagesPoll + deltaTime
  if state.sinceMessagesPoll >= MESSAGES_POLL_SECONDS then
    state.sinceMessagesPoll = 0
    pollMessages()
  end
end)

-- 0.7: the plugin hears about the CET overlay too (ui.state, the capture pre-check that keeps CET's windows out of pictures,
-- and the XF overlay host's rule of yielding to CET).
registerForEvent("onOverlayOpen", function()
  state.overlayOpen = true
  if panel then panel.opened(state) end
  callNative("XFBridge_CetOverlay", true)
  log("debug", "-", "overlay opened")
end)

registerForEvent("onOverlayClose", function()
  state.overlayOpen = false
  callNative("XFBridge_CetOverlay", false)
  log("debug", "-", "overlay closed")
end)

registerForEvent("onShutdown", function()
  log("info", "-", "onShutdown")
end)

-- Kill switch: bind it in CET's Bindings tab. The bridge refuses everything until it is reconnected (the
-- test builds' panel) or the game restarts. The ID, xf_bridge_kill, has never changed and must not: CET keys a binding by
-- the mod's name and this ID. CET drops a mod's bindings at a launch where the mod isn't installed (its
-- Developer.RemoveDeadBindings, on by default), so a launch of another profile without the bridge unbinds it (session 9).
-- 0.8.3: the bridge's own stop key ([ui] kill_key; 0.8.4: Ctrl + Shift + End by default, changed in the XF Runtime Bridge
-- window) works without CET or a binding; this hotkey is the optional second route.
registerHotkey("xf_bridge_kill", "Stop XF Runtime Bridge", function()
  local cid = nextCid()
  local ok, killed = callNative("XFBridge_Kill", "cet-hotkey")
  log("warn", cid, "kill switch hotkey pressed; bridge killed=" .. tostring(ok and killed))
  refreshInfo()
end)

-- 0.8 (the UI review): the status every surface shows, from the plugin (XFBridge_Info's status, made in core/InkUi.cpp), with
-- its tone; the CET layer's own words only when the plugin can't say.
local function bridgeStatus()
  if state.pluginPresent == false then
    return { label = "XF Runtime Bridge" .. MIDDLE_DOT .. "The bridge's plugin isn't loaded.", tone = "off" }
  end
  local status = state.info and state.info.status
  if type(status) == "table" and type(status.label) == "string" then
    return status
  end
  return { label = "XF Runtime Bridge" .. MIDDLE_DOT .. "Starting...", tone = "idle" }
end

-- A key's name as the panels show it ("IK_F6" to "F6").
local function keyLabel(key)
  return (string.gsub(tostring(key), "^IK_", ""))
end

-- 0.8.6 (the UI review's fix 6: one notation wherever a key is pressed, the game's own prompt style):
-- "[F6] Fully visible · [F7] Partly cut off, or click an answer in the XF Runtime Bridge window." The keys answer whenever
-- the ink panel has the question, even while the game hides the HUD.
local function answerHint(ask)
  local keys = state.info and state.info.answer_keys or {}
  if state.keysArmed == false then keys = {} end -- 0.8.2: no key answers it now (the ink panel is off, or no Codeware)
  local parts = {}
  for i, label in ipairs(ask.choices or {}) do
    if keys[i] then
      table.insert(parts, "[" .. keyLabel(keys[i]) .. "] " .. tostring(label))
    end
  end
  if #parts == 0 then
    return "Click an answer in the XF Runtime Bridge window (open the CET overlay)."
  end
  return table.concat(parts, MIDDLE_DOT) .. ", or click an answer in the XF Runtime Bridge window."
end

local function themeColour(which, token, fallback)
  return panel and panel.colour and panel.colour(theme, which, token, fallback) or fallback
end

local function colouredWrapped(colour, text)
  ImGui.PushStyleColor(ImGuiCol.Text, colour[1], colour[2], colour[3], colour[4])
  ImGui.TextWrapped(text)
  ImGui.PopStyleColor(1)
end

-- 0.8.6 (the UI review's P5: the status words sat 66 px in against 26 px on the right): the status dot sits in the window's
-- left padding, so the words start at the padding, as the right side ends there. 0.8.7 and 0.8.9 drew it with a widened clip
-- rect (PushClipRect, GetWindowSize, SetCursorPosX) and checked those with type(); in game (sessions 14 to 16) the check said
-- this CET lacks one of them every time ("the status dot hangs before the words ... lacks PushClipRect, GetWindowPos,
-- GetWindowSize or SetCursorPosX") although the installed CET registers all four names, and the hanging dot put the words 66 px
-- in. 0.8.11 (UI review of 0.8.11, fix 1) draws the dot on the foreground draw list instead, which no window clip cuts and which
-- needs only calls other mods use (GetForegroundDrawList, ImDrawListAddCircleFilled, GetColorU32, GetCursorScreenPos,
-- GetTextLineHeight). 0.8.23 reserves a slot for it inside the padding, before the title. Nothing is tested for by type():
-- calls run under pcall, and a failure is named once in the mod's log before a plain bullet takes its slot.
local function xyOf(a, b)
  if type(a) == "table" then return a.x or a[1], a.y or a[2] end
  return a, b
end

-- 0.8.22 (the Studio's status line): the dot is the Studio's 8 px (4 px radius at CET's 13 px body, scaled with its font size), in the
-- tone's slot, and breathes while the bridge is live (the success and changes-allowed tones; panel.pulseAlpha, one clock for
-- every pulsing element: ImGui.GetTime); paused is a ring, stopped, off and idle are still. It changes alpha only. Under
-- reduced motion (the plugin's info.overlay.motion) it is drawn at full alpha.
local function statusDot(toneName, tone)
  local k = ImGui.GetFontSize() / ((theme and theme.metrics and theme.metrics.FontSize) or 13)
  local radius = 4 * k
  local reduced = state.info and type(state.info.overlay) == "table" and state.info.overlay.motion == "reduced"
  local live = toneName == "ok" or toneName == "write"
  local alpha = 1.0
  if live and panel and panel.pulseAlpha then alpha = panel.pulseAlpha(theme, ImGui.GetTime(), reduced) end
  local why = nil
  local ok, err = pcall(function()
    local sx, sy = xyOf(ImGui.GetCursorScreenPos())
    local list = ImGui.GetForegroundDrawList()
    -- The visible lower-case body sits below the font's ascender: centre on its x-height.
    local x, y = sx + radius, sy + ImGui.GetTextLineHeight() * 0.6
    if toneName == "paused" then
      local ring = ImGui.GetColorU32(tone[1], tone[2], tone[3], tone[4])
      ImGui.ImDrawListAddCircle(list, x, y, radius - 0.75 * k, ring, 12, 1.5 * k)
    else
      local colour = ImGui.GetColorU32(tone[1], tone[2], tone[3], (tone[4] or 1.0) * alpha)
      ImGui.ImDrawListAddCircleFilled(list, x, y, radius, colour, 12)
    end
  end)
  if not ok then why = "the draw-list call raised: " .. tostring(err) end
  if why then
    if not state.dotFallbackLogged then
      state.dotFallbackLogged = true
      log("info", "-", "CET line: the status dot hangs before the words instead of in the padding: " .. why)
    end
    return false
  end
  return true
end

-- The CET line (0.8, the UI review): themed like the XF Runtime Bridge window; the status line (a bullet in its tone, the words
-- muted); then, while the ink panel shows the question, only how to answer it; otherwise the messages, the question in the
-- text colour, and how to answer it.
local function drawLabelBody(which)
  local drawnTexts = {}
  -- 0.8.22: a line takes its type role's font scale (the answer hint and the notes are label role, 0.92; the rest body, 1).
  local function draw(colour, text, role)
    drawnTexts[#drawnTexts + 1] = tostring(text)
    if role and panel and panel.inRole then
      panel.inRole(theme, role, function() colouredWrapped(colour, text) end)
    else
      colouredWrapped(colour, text)
    end
  end
  local status = bridgeStatus()
  -- 0.8.22 (cet.panel's report): what the line drew with.
  state.drawnChip = state.info and type(state.info.status) == "table" and state.info.status.chip or nil
  state.drawnTone = status.tone
  state.drawnSurface = "cet_line"
  local muted = themeColour(which, "XfTextMuted", MUTED)
  local tone = themeColour(which, TONE_TOKENS[status.tone] or "TextDisabled", TONE_COLORS[status.tone] or TONE_COLORS.off)
  local k = ImGui.GetFontSize() / ((theme and theme.metrics and theme.metrics.FontSize) or 13)
  local startX = ImGui.GetCursorPosX()
  if statusDot(status.tone, tone) then
    ImGui.Dummy(8 * k, ImGui.GetTextLineHeight())
  else
    ImGui.Bullet()
  end
  ImGui.SameLine(startX + 14 * k)
  -- Keep the status on one unwrapped row, separate from the window's longer explanation.
  local bridge = state.info and state.info.bridge or {}
  local sentence
  if bridge.killed or status.tone == "killed" then sentence = "Stopped" .. MIDDLE_DOT .. "reconnect in the CET window"
  else
    local connected = status.connection == "XF Studio connected" or string.find(status.label, "XF Studio connected", 1, true) ~= nil
    if connected then
      sentence = "Connected"
      if bridge.writes_paused then sentence = sentence .. MIDDLE_DOT .. "changes paused"
      elseif bridge.allow_writes then sentence = sentence .. MIDDLE_DOT .. "changes allowed" end
    else
      sentence = status.label
      local prefix = "XF Runtime Bridge" .. MIDDLE_DOT
      if string.sub(sentence, 1, #prefix) == prefix then sentence = string.sub(sentence, #prefix + 1) end
      sentence = string.gsub(sentence, "XF Studio not connected", "Not connected", 1)
      if sentence == "XF Runtime Bridge" then sentence = "Starting..." end
    end
  end
  local function plain(colour, text)
    drawnTexts[#drawnTexts + 1] = text
    ImGui.TextColored(colour[1], colour[2], colour[3], colour[4], text)
  end
  if panel and panel.inRole then
    panel.inRole(theme, "label", function() plain(themeColour(which, "Text", MUTED), "XF Runtime Bridge") end)
  else plain(themeColour(which, "Text", MUTED), "XF Runtime Bridge") end
  local titleWidth = ImGui.CalcTextSize("XF Runtime Bridge")
  if panel and panel.inRole then titleWidth = panel.inRole(theme, "label", function() return (ImGui.CalcTextSize("XF Runtime Bridge")) end) end
  ImGui.SameLine(startX + 14 * k + titleWidth + 6 * k)
  plain(muted, sentence)
  if bridge.killed or status.tone == "killed" then
    if state.testInput and state.testInput.ui then
      state.testInput.ui("cet_line", { drawn = true, texts = drawnTexts, rect = state.testInput.windowRect(), heading = "XF Runtime Bridge" })
    end
    return
  end
  local hang = 14 * k
  ImGui.Indent(hang)
  ImGui.PushTextWrapPos(MESSAGE_WRAP_PX)
  local ask = state.pendingAsk
  local answered = state.answeredAsk
  local inkShows = (ask and state.inkAsk == ask.id) or (not ask and answered and state.inkAsk == answered.id)
  if inkShows then
    draw(muted, ask and answerHint(ask) or ("Answered: " .. tostring(answered.label) .. "."), "label")
  else
    for _, message in ipairs(state.messages) do
      local isQuestion = ask and message.id == ask.id
      local token = isQuestion and "Text" or MESSAGE_TOKENS[message.level] or "Text"
      draw(themeColour(which, token, MESSAGE_COLORS[message.level] or MESSAGE_COLORS.info), message.text)
    end
    if ask then
      draw(muted, answerHint(ask), "label")
    elseif answered then
      draw(muted, "Answered: " .. tostring(answered.label) .. ".", "label")
    end
  end
  -- 0.8 (the UI review): why the XF box isn't there.
  if state.info and type(state.info.overlay) == "table" and state.info.overlay.off_for_frame_generation then
    draw(muted, "XF overlay is off while frame generation is on.", "label")
  end
  if hang > 0 then ImGui.Unindent(hang) end
  ImGui.PopTextWrapPos()
  if state.testInput and state.testInput.ui then
    state.testInput.ui("cet_line", { drawn = true, texts = drawnTexts, rect = state.testInput.windowRect(), heading = status.label })
  end
end

local function drawLabel()
  local which = (state.info and type(state.info.overlay) == "table" and state.info.overlay.theme == "light") and "light" or "dark"
  local colours, vars = 0, 0
  if panel and panel.pushTheme then
    colours, vars = panel.pushTheme(theme, which)
  end
  local k = ImGui.GetFontSize() / ((theme and theme.metrics and theme.metrics.FontSize) or 13)
  ImGui.PushStyleVar(ImGuiStyleVar.WindowPadding, 12 * k, 8 * k)
  vars = vars + 1
  ImGui.SetNextWindowPos(16, 16, ImGuiCond.Always)
  -- 0.8.22: the flags' union without bit32 (a member this CET lacks is left out; NoDecoration and NoInputs are composites).
  local flags = 0
  for _, name in ipairs({ "NoDecoration", "NoInputs", "AlwaysAutoResize", "NoSavedSettings", "NoFocusOnAppearing" }) do
    local v = ImGuiWindowFlags[name]
    if type(v) == "number" and v > 0 then
      local union, x, y, bit = 0, flags, math.floor(v), 1
      while x > 0 or y > 0 do
        if x % 2 == 1 or y % 2 == 1 then union = union + bit end
        x, y, bit = math.floor(x / 2), math.floor(y / 2), bit * 2
      end
      flags = union
    end
  end
  local ok, err = true, nil
  if ImGui.Begin("XF Runtime Bridge##indicator", flags) then
    ok, err = pcall(drawLabelBody, which)
  end
  ImGui.End()
  if vars > 0 then ImGui.PopStyleVar(vars) end
  if colours > 0 then ImGui.PopStyleColor(colours) end
  if not ok then error(err) end
end

registerForEvent("onDraw", function()
  local enabled = state.info and state.info.bridge and state.info.bridge.enabled

  if state.testInput and state.testInput.ui then
    if not (enabled and state.cetLabel and not state.overlayOpen and state.surface == "cet_line") then state.testInput.ui("cet_line", { drawn = false }) end
    if not state.overlayOpen then state.testInput.ui("cet_window", { drawn = false, save_button_drawn = false }) end
  end

  -- The CET line whenever the bridge is enabled and it is the status surface (0.8.2: the fallback, when neither the
  -- ink panel nor the XF box can show); while CET's overlay is open the XF Runtime Bridge window shows the status.
  if enabled and state.cetLabel and not state.overlayOpen and state.surface == "cet_line" then
    local drew, err = pcall(drawLabel)
    if not drew then
      state.lastError = tostring(err)
    end
  end

  -- The panel (test builds) or the plain details while the CET overlay is open.
  if state.overlayOpen and panel then
    local drew, err = pcall(panel.draw, state, queueAction, theme)
    if not drew then
      -- 0.8: panel.body ends its own window even when it fails, so nothing is ended here.
      state.lastError = tostring(err)
    end
  elseif state.overlayOpen then
    if ImGui.Begin("XF Runtime Bridge", ImGuiWindowFlags.AlwaysAutoResize) then
      local status = bridgeStatus()
      local color = TONE_COLORS[status.tone] or TONE_COLORS.off
      ImGui.TextColored(color[1], color[2], color[3], color[4], status.label)
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
  Canvas = require("canvas"),
  version = "0.8.24",
  -- For other CET mods: GetMod("XF_Runtime_Bridge").info()
  info = function() return state.info end,
}
