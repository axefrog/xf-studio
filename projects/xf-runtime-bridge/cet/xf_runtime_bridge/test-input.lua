-- Autonomous candidate only. This seam covers rendered activation, not pointer hit-testing.
local adapter = {}
local function native(name, value)
  local ok, answer = pcall(function() return Game[name](json.encode(value)) end)
  if not ok then return nil end
  local parsed, result = pcall(json.decode, tostring(answer))
  return parsed and result or nil
end
function adapter.activate(target, settled, state)
  if target ~= "save_anyway" or not state.overlayOpen or not settled then return false end
  if not ImGui.IsItemVisible or not ImGui.GetItemRectMin or not ImGui.GetItemRectMax or not ImGui.GetFrameCount then return false end
  if not ImGui.IsItemVisible() then return false end
  local x1, y1 = ImGui.GetItemRectMin()
  local x2, y2 = ImGui.GetItemRectMax()
  if type(x1) ~= "number" or type(y1) ~= "number" or type(x2) ~= "number" or type(y2) ~= "number" or x2 <= x1 or y2 <= y1 then return false end
  local token = native("XFBridge_TestUiTake", { target = target, visible = true, settled = true, overlay_open = true, rect = { x1, y1, x2, y2 }, frame = ImGui.GetFrameCount() })
  if type(token) ~= "table" or type(token.request_id) ~= "number" then return false end
  -- Disarmed natively before queueing, including when a physical click happened on this frame.
  local receipt = native("XFBridge_TestUiReport", { request_id = token.request_id, run_id = token.run_id, activated = true, frame = ImGui.GetFrameCount(), rect = { x1, y1, x2, y2 } })
  if not receipt or not receipt.accepted then return false end
  return token
end
function adapter.stage(stage, token, detail)
  if type(token) ~= "table" then return false end
  local receipt = native("XFBridge_TestUiReport", { request_id = token.request_id, run_id = token.run_id, stage = stage, detail = detail or {} })
  return receipt and receipt.accepted == true
end
-- Read-only U recording; all calls remain in the autonomous-only adapter.
local elapsed, last = 0, {}
function adapter.advance(dt) elapsed = elapsed + math.max(0, dt or 0) end
function adapter.ui(surface, body)
  if surface ~= "cet_line" and surface ~= "cet_window" then return end
  if last[surface] and elapsed - last[surface] < 0.1 then return end
  local ok, enabled = pcall(function() return Game.XFBridge_RecordEnabled("ui") end)
  if not ok or not enabled then return end
  last[surface] = elapsed
  body.event, body.surface, body.controller = "ui.consumer", surface, "CET.ImGui"
  body.clip_rect, body.pointer_hit_target = nil, nil
  body.geometry = "ImGui_current_draw"
  body.valid = body.drawn == false or type(body.rect) == "table"
  local encoded, text = pcall(json.encode, body)
  if not encoded or #text >= 8192 then text = '{"event":"ui.truncated","valid":false}' end
  pcall(function() Game.XFBridge_Record("ui", text) end)
end
function adapter.windowRect()
  local ok, rect = pcall(function()
    local function xy(a, b)
      if type(a) == "number" then return a, b end
      return a.x or a.X or a[1], a.y or a.Y or a[2]
    end
    local x, y = xy(ImGui.GetWindowPos())
    local w, h = xy(ImGui.GetWindowSize())
    return { x, y, x + w, y + h }
  end)
  return ok and rect or nil
end

return adapter
