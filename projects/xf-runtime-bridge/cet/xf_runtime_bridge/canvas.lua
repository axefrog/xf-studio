-- GetMod("XF_Runtime_Bridge").Canvas.ForModule("holotable").Feed(batch), from onUpdate, never onDraw.
-- The native fixes both producer and world; no pipe, write permission or game mutation.
local Canvas = {}
function Canvas.ForModule(module)
  if type(module) ~= "string" or #module < 1 or #module > 24 or module:find("[^a-z0-9_-]") then
    error("Canvas module must match [a-z0-9_-]{1,24}")
  end
  local function call(action, value)
    local payload = json.encode(value or {})
    -- CET's JSON encoder treats an empty table as an object. Only items is an empty array in this API.
    if action == "feed" and type(value) == "table" and type(value.items) == "table" and next(value.items) == nil then
      payload = payload:gsub('"items"%s*:%s*{}', '"items":[]')
    end
    local ok, raw = pcall(function() return Game.XFBridge_Canvas(module, action, payload) end)
    if not ok then return { ok = false, error = { code = "unavailable", message = tostring(raw) } } end
    local decoded, reply = pcall(json.decode, raw)
    if not decoded then return { ok = false, error = { code = "unavailable", message = tostring(reply) } } end
    return reply
  end
  return {
    Feed = function(batch) return call("feed", batch) end,
    Clear = function(layer) return call("clear", layer ~= nil and { layer = layer } or {}) end,
    View = function(settings) return call("view", settings) end,
    State = function() return call("state") end,
    Keys = function(settings) return call("keys", settings) end,
    Toggle = function() return call("toggle") end,
    Mode = function() return call("mode") end,
  }
end
local default = Canvas.ForModule("xf_runtime_bridge")
for key, value in pairs(default) do Canvas[key] = value end
return Canvas
