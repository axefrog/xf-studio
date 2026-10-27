-- GetMod("XF_Runtime_Bridge").Canvas.ForModule("holotable").Feed(batch), from onUpdate, never onDraw.
-- The native fixes both producer and world; no pipe, write permission or game mutation.
local Canvas = {}
local arrayFields = { items=true, views=true, lines=true, points=true, world=true, screen=true,
  offset=true, offset_px=true, rect=true, dash=true, size=true, values=true }
-- Serialize tables recursively so every schema array keeps its shape, including nested empty arrays.
-- Keys and scalars still use CET's JSON encoder; producer text never undergoes string replacement.
local function encode(value, field, depth, seen)
  if type(value) ~= "table" then return json.encode(value) end
  if depth > 32 or seen[value] then error("Canvas JSON must be an acyclic tree at most 32 levels deep") end
  if next(value) == nil then return arrayFields[field] and "[]" or json.encode(value) end
  seen[value] = true
  local count, length = 0, #value
  local array = length > 0
  for key in pairs(value) do
    count = count + 1
    if type(key) ~= "number" or key < 1 or key > length or key % 1 ~= 0 then array = false end
  end
  array = array and count == length
  local parts = {}
  if array then
    for n=1,length do parts[#parts+1] = encode(value[n],field,depth+1,seen) end
  else
    for key,child in pairs(value) do
      if type(key) ~= "string" then error("Canvas object keys must be strings") end
      parts[#parts+1] = json.encode(key) .. ":" .. encode(child,key,depth+1,seen)
    end
  end
  seen[value] = nil
  return (array and "[" or "{") .. table.concat(parts,",") .. (array and "]" or "}")
end
function Canvas.ForModule(module)
  if type(module) ~= "string" or #module < 1 or #module > 24 or module:find("[^a-z0-9_-]") then
    error("Canvas module must match [a-z0-9_-]{1,24}")
  end
  local function call(action, value)
    local encoded, payload = pcall(encode,value or {},nil,0,{})
    if not encoded then return {ok=false,error={code="bad_batch",message=tostring(payload)}} end
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
