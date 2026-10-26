#include "core/CetPanel.hpp"
#include "core/Dispatcher.hpp"
#include "core/Params.hpp"

#include <algorithm>

namespace xfb::cetpanel
{
json Channel::Request(const json& aParams, std::optional<bool> aCetOpen, bool aWritesAllowed, bool aWritesPaused)
{
    params::RequireOnly(aParams, {"diagnostics_open", "press"});
    const auto diagnostics = params::CheckBoolean(aParams, "diagnostics_open");
    const auto press = params::CheckText(aParams, "press", 32);
    if (!diagnostics && !press)
    {
        params::CheckFail("give diagnostics_open, press or both");
    }
    if (press && *press != "pause_changes" && *press != "resume_changes")
    {
        params::CheckFail("'press' is pause_changes or resume_changes");
    }
    if (press && !aWritesAllowed)
    {
        throw MethodError("writes_disabled", "this build's config.ini has allow_writes = false, so the CET window has no Pause changes button and "
                                             "there is nothing to pause");
    }
    std::scoped_lock _(m_mutex);
    if (m_pending.size() >= kMaxPending)
    {
        throw MethodError("cet_not_answering", "the CET layer hasn't taken the last " + std::to_string(m_pending.size()) +
                                                   " requests: is Cyber Engine Tweaks running with the bridge's CET mod?");
    }
    json request{{"id", m_nextId++}};
    if (diagnostics) request["diagnostics_open"] = *diagnostics;
    if (press) request["press"] = *press;
    m_pending.push_back(request);

    const json drawnOpen = m_report.is_object() && m_report.contains("diagnostics_open") && m_report["diagnostics_open"].is_boolean()
                               ? m_report["diagnostics_open"]
                               : json(nullptr);
    json undo = json::object();
    if (diagnostics) undo["diagnostics_open"] = drawnOpen.is_boolean() ? drawnOpen.get<bool>() : false;
    if (press) undo["press"] = aWritesPaused ? "pause_changes" : "resume_changes";

    json applies = json::array();
    if (diagnostics)
    {
        applies.push_back(aCetOpen == true ? "the DIAGNOSTICS header opens or closes with the CET window's next frame, once; the player's own clicks rule after it"
                                           : "CET's overlay is closed (or not reported yet): the DIAGNOSTICS header takes it the next time the CET window draws");
    }
    if (press)
    {
        applies.push_back("the press runs the button's own action (XFBridge_PauseWrites) on the CET layer's next update, within about 0.25 s, "
                          "whether or not CET's overlay is open; bridge_info's cet_panel.last_press says how it went");
    }
    return json{{"queued", true},
                {"id", request["id"]},
                {"request", request},
                {"cet_overlay_open", aCetOpen ? json(*aCetOpen) : json(nullptr)},
                {"cet_layer", m_report.is_null() ? "the CET layer hasn't reported yet (CET not running, or the bridge's CET mod not loaded): the request waits"
                                                 : "reporting"},
                {"applies", applies},
                {"previous", {{"diagnostics_open", drawnOpen}, {"writes_paused", aWritesPaused}}},
                {"undo", {{"method", "cet.panel"}, {"params", undo}}}};
}

std::string Channel::Exchange(const std::string& aReport)
{
    std::scoped_lock _(m_mutex);
    if (!aReport.empty() && aReport.size() <= 8192)
    {
        auto parsed = json::parse(aReport, nullptr, false);
        if (!parsed.is_discarded() && parsed.is_object())
        {
            m_report = std::move(parsed);
            const auto& applied = m_report.value("applied_id", json(0));
            if (applied.is_number_unsigned() || applied.is_number_integer())
            {
                const auto through = applied.get<int64_t>();
                m_pending.erase(std::remove_if(m_pending.begin(), m_pending.end(), [through](const json& r) { return r["id"].get<int64_t>() <= through; }),
                                m_pending.end());
            }
        }
    }
    return m_pending.empty() ? std::string() : json(m_pending).dump();
}

json Channel::Report() const
{
    std::scoped_lock _(m_mutex);
    if (m_report.is_null()) return nullptr;
    auto out = m_report;
    out["pending"] = m_pending.size();
    return out;
}
} // namespace xfb::cetpanel
