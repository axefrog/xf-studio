#pragma once

// 0.8.22: cet.panel, the CET window's own controls driven by a tool (the styling batch's ST rows): the DIAGNOSTICS header opened
// or closed, and the Pause changes / Resume changes button pressed. The plugin only queues the request; the CET layer takes it
// about four times a second through XFBridge_CetPanel, which also carries its report back (what it last drew: the header's
// state, the chip and tone, and how the last press went), so bridge.info can say what the window shows. A header change is
// applied with ImGui.SetNextItemOpen right before the header, once, so the player's own clicks rule after it; a press runs the
// button's own action (XFBridge_PauseWrites), as a click would, whether or not CET's overlay is open.
//
// Game-independent: the plugin and the self-test host use it; the unit tests check the queue, the report and the undo.

#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::cetpanel
{
using json = nlohmann::json;

inline constexpr size_t kMaxPending = 8;

class Channel
{
public:
    // cet.panel {diagnostics_open?, press?}: validates and queues one request for the CET layer. aCetOpen is CET's overlay as the
    // CET layer last reported it (nullopt: unknown). The answer says when each part applies and carries the undo (the header as
    // the window last drew it; the pause state as it was).
    json Request(const json& aParams, std::optional<bool> aCetOpen, bool aWritesAllowed, bool aWritesPaused);
    // XFBridge_CetPanel: the CET layer's report in (a JSON object as text; empty or malformed is ignored), the requests it has not
    // applied yet out (a JSON array as text, oldest first). The report's applied_id retires every request up to it.
    std::string Exchange(const std::string& aReport);
    // bridge.info's cet_panel: the CET layer's last report and how many requests wait; null until the layer has reported.
    json Report() const;

private:
    mutable std::mutex m_mutex;
    uint64_t m_nextId = 1;
    std::vector<json> m_pending;
    json m_report; // null until the first report
};
} // namespace xfb::cetpanel
