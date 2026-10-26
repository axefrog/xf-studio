#include "core/CetPanel.hpp"
#include "core/Dispatcher.hpp"
#include "core/Params.hpp"

#include <algorithm>

namespace xfb::cetpanel
{
const char* PauseOriginName(PauseOrigin aOrigin)
{
    switch (aOrigin)
    {
    case PauseOrigin::Player:
        return "player";
    case PauseOrigin::Bridge:
        return "bridge";
    case PauseOrigin::None:
        break;
    }
    return "none";
}

Channel::Record* Channel::Find(uint64_t aId)
{
    for (auto& r : m_records)
    {
        if (r.id == aId) return &r;
    }
    return nullptr;
}

size_t Channel::PendingLocked() const
{
    return static_cast<size_t>(std::count_if(m_records.begin(), m_records.end(),
                                             [](const Record& r) { return r.headerStatus == "pending" || r.pressStatus == "pending" || r.pressStatus == "claimed"; }));
}

void Channel::CancelLocked(const std::string& aWhy, const std::string* aOnlyOtherThan)
{
    for (auto& r : m_records)
    {
        if (aOnlyOtherThan && r.generation == *aOnlyOtherThan) continue;
        bool cancelled = false;
        if (r.headerStatus == "pending") { r.headerStatus = "cancelled"; cancelled = true; }
        if (r.pressStatus == "pending" || r.pressStatus == "claimed") { r.pressStatus = "cancelled"; cancelled = true; }
        if (cancelled) r.why = aWhy;
        if (m_claimed && *m_claimed == r.id && cancelled) m_claimed.reset();
    }
}

json Channel::Brief(const Record& r) const
{
    json out{{"id", r.id}};
    if (r.header)
    {
        out["diagnostics_open"] = *r.header;
        out["header"] = r.headerStatus;
        out["header_previous"] = r.headerPrevious;
    }
    if (!r.press.empty())
    {
        out["press"] = r.press;
        out["press_status"] = r.pressStatus;
        out["paused_before"] = r.pressPrevious;
        if (!r.answer.is_null()) out["answer"] = r.answer;
    }
    if (!r.why.empty()) out["why"] = r.why;
    return out;
}

json Channel::Request(const json& aParams, const Context& aContext)
{
    params::RequireOnly(aParams, {"diagnostics_open", "press", "undo"});
    auto diagnostics = params::CheckBoolean(aParams, "diagnostics_open");
    auto press = params::CheckText(aParams, "press", 32);
    std::unique_lock lock(m_mutex);
    json undoNotes = json::array();
    std::optional<uint64_t> undoOf;
    if (aParams.is_object() && aParams.contains("undo"))
    {
        if (diagnostics || press) params::CheckFail("'undo' takes no other option: it puts back what that request changed");
        const auto& value = aParams["undo"];
        if (!value.is_number_unsigned() && !(value.is_number_integer() && value.get<int64_t>() > 0)) params::CheckFail("'undo' is a request id");
        undoOf = value.get<uint64_t>();
        auto* r = Find(*undoOf);
        if (!r) params::CheckFail("no such request (only the last " + std::to_string(kKeptRecords) + " are kept)");
        // What that request changed, put back from what the CET layer captured when it applied it.
        if (r->header)
        {
            if (r->headerStatus == "pending")
            {
                r->headerStatus = "cancelled";
                r->why = "cancelled by its undo";
                undoNotes.push_back("its header change hadn't been applied yet, so it is cancelled");
            }
            else if (r->headerStatus == "applied" && r->headerPrevious.is_boolean())
            {
                diagnostics = r->headerPrevious.get<bool>();
            }
            else if (r->headerStatus == "applied")
            {
                undoNotes.push_back("the header's state before it was unknown (the window hadn't drawn it), so the header is left as it is");
            }
        }
        if (!r->press.empty())
        {
            if (r->pressStatus == "pending")
            {
                r->pressStatus = "cancelled";
                r->why = "cancelled by its undo";
                undoNotes.push_back("its press hadn't run yet, so it is cancelled");
            }
            else if ((r->pressStatus == "done" || r->pressStatus == "claimed") && r->pressPrevious.is_boolean())
            {
                press = r->pressPrevious.get<bool>() ? "pause_changes" : "resume_changes";
            }
            else
            {
                undoNotes.push_back("its press didn't run (" + r->pressStatus + "), so there is nothing to put back");
            }
        }
        if (!diagnostics && !press)
        {
            return json{{"queued", false}, {"undo_of", *undoOf}, {"notes", undoNotes}};
        }
    }
    if (!diagnostics && !press)
    {
        params::CheckFail("give diagnostics_open, press or both (or undo with a request id)");
    }
    if (press && *press != "pause_changes" && *press != "resume_changes")
    {
        params::CheckFail("'press' is pause_changes or resume_changes");
    }
    if (press && !aContext.pressAllowed)
    {
        throw MethodError("test_hooks_off", "pressing the CET window's pause button is a test feature: it needs a build with the autonomous test hooks "
                                            "and [bridge] allow_test_hooks = true (the header works in every build)");
    }
    if (press && !aContext.writesAllowed)
    {
        throw MethodError("writes_disabled", "this build's config.ini has allow_writes = false, so the CET window has no Pause changes button and "
                                             "there is nothing to pause");
    }
    if (press && *press == "resume_changes" && aContext.writesPaused && aContext.pausedBy == PauseOrigin::Player)
    {
        throw MethodError("paused_by_player", "the player paused changes with the CET window's own button; only the player resumes them");
    }
    if (PendingLocked() >= kMaxPending)
    {
        throw MethodError("cet_not_answering", "the CET layer hasn't taken the last " + std::to_string(PendingLocked()) +
                                                   " requests: is Cyber Engine Tweaks running with the bridge's CET mod?");
    }
    Record record;
    record.id = m_nextId++;
    record.generation = aContext.generation;
    if (diagnostics)
    {
        // A newer header request replaces any older one still waiting.
        for (auto& r : m_records)
        {
            if (r.headerStatus == "pending") { r.headerStatus = "superseded"; }
        }
        record.header = *diagnostics;
        record.headerStatus = "pending";
    }
    if (press)
    {
        record.press = *press;
        record.pressStatus = "pending";
    }
    m_records.push_back(record);
    while (m_records.size() > kKeptRecords) m_records.pop_front();

    json request{{"id", record.id}};
    if (diagnostics) request["diagnostics_open"] = *diagnostics;
    if (press) request["press"] = *press;
    json applies = json::array();
    if (diagnostics)
    {
        applies.push_back(aContext.cetOpen == true ? "the DIAGNOSTICS header opens or closes with the CET window's next frame, once; the player's own clicks rule after it"
                                                   : "CET's overlay is closed (or not reported yet): the DIAGNOSTICS header takes it the next time the CET window draws");
    }
    if (press)
    {
        applies.push_back("the press runs the button's own action (XFBridge_PauseWrites) once the CET layer claims it, within about 0.25 s, "
                          "whether or not CET's overlay is open; a kill, a new client or the client going cancels it first");
    }
    json out{{"queued", true},
             {"id", record.id},
             {"request", request},
             {"cet_overlay_open", aContext.cetOpen ? json(*aContext.cetOpen) : json(nullptr)},
             {"cet_layer", m_report.is_null() ? "the CET layer hasn't reported yet (CET not running, or the bridge's CET mod not loaded): the request waits"
                                              : "reporting"},
             {"applies", applies},
             {"previous", {{"writes_paused", aContext.writesPaused}, {"paused_by", PauseOriginName(aContext.writesPaused ? aContext.pausedBy : PauseOrigin::None)}}},
             {"undo", {{"method", "cet.panel"}, {"params", {{"undo", record.id}}}}},
             {"undo_note", "puts back what the CET layer captured when it applied this request; a header state the window never drew stays unknown, "
                           "and the header is then left as it is"}};
    if (undoOf)
    {
        out["undo_of"] = *undoOf;
        out["notes"] = undoNotes;
    }
    return out;
}

std::string Channel::Exchange(const std::string& aReport, const Context& aContext)
{
    std::scoped_lock _(m_mutex);
    if (aContext.killed) CancelLocked("the bridge was stopped");
    else if (!aContext.ownerConnected) CancelLocked("the client that asked went away");
    else CancelLocked("a new client connected", &aContext.generation);

    json parsed = aReport.empty() || aReport.size() > 8192 ? json() : json::parse(aReport, nullptr, false);
    if (parsed.is_object() && parsed.contains("claim"))
    {
        // The CET layer is about to run a press: it runs only if this request may still run now.
        const auto& value = parsed["claim"];
        auto* r = value.is_number_unsigned() || value.is_number_integer() ? Find(value.get<uint64_t>()) : nullptr;
        json answer{{"claimed", false}};
        if (!r || r->press.empty()) answer["why"] = "unknown";
        else if (r->pressStatus != "pending") answer["why"] = r->pressStatus == "cancelled" ? "cancelled: " + r->why : "already " + r->pressStatus;
        else if (r->press == "resume_changes" && aContext.writesPaused && aContext.pausedBy == PauseOrigin::Player)
        {
            r->pressStatus = "refused";
            r->why = "paused_by_player";
            answer["why"] = "paused_by_player";
        }
        else
        {
            r->pressStatus = "claimed";
            r->pressPrevious = aContext.writesPaused;
            m_claimed = r->id;
            answer = json{{"claimed", true}, {"id", r->id}};
        }
        return answer.dump();
    }
    if (parsed.is_object())
    {
        m_report = parsed;
        // Completion: the draws that applied header requests, with the header as drawn before (or unknown).
        const auto& done = parsed.value("header_done", json::array());
        if (done.is_array())
        {
            for (const auto& d : done)
            {
                if (!d.is_object() || !(d.value("id", json()).is_number())) continue;
                auto* r = Find(d["id"].get<uint64_t>());
                if (!r || r->headerStatus != "pending") continue;
                if (d.value("superseded", false)) { r->headerStatus = "superseded"; continue; }
                r->headerStatus = "applied";
                r->headerPrevious = d.contains("previous") && d["previous"].is_boolean() ? d["previous"] : json(nullptr);
            }
        }
    }
    json pending = json::array();
    for (const auto& r : m_records)
    {
        json item{{"id", r.id}};
        if (r.headerStatus == "pending") item["diagnostics_open"] = *r.header;
        if (r.pressStatus == "pending") item["press"] = r.press;
        if (item.size() > 1) pending.push_back(item);
    }
    return pending.empty() ? std::string() : pending.dump();
}

ClaimUse Channel::TakeClaim(bool aPaused, const Context& aContext)
{
    std::scoped_lock _(m_mutex);
    if (!m_claimed) return {};
    auto* r = Find(*m_claimed);
    if (!r || r->pressStatus != "claimed" || (r->press == "pause_changes") != aPaused)
    {
        return {}; // not this call's press: the player's own click
    }
    const auto id = r->id;
    m_claimed.reset();
    if (aContext.killed || !aContext.ownerConnected || r->generation != aContext.generation)
    {
        r->pressStatus = "cancelled";
        r->why = aContext.killed ? "the bridge was stopped" : "the client that asked went away";
        return {ClaimUse::Kind::Cancelled, id};
    }
    return {ClaimUse::Kind::Press, id};
}

void Channel::NotePress(uint64_t aId, const json& aAnswer)
{
    std::scoped_lock _(m_mutex);
    if (auto* r = Find(aId))
    {
        r->pressStatus = "done";
        r->answer = aAnswer;
    }
}

json Channel::Report() const
{
    std::scoped_lock _(m_mutex);
    if (m_report.is_null() && m_records.empty()) return nullptr;
    json out = m_report.is_object() ? m_report : json::object();
    out["reported"] = m_report.is_object();
    json recent = json::array();
    const size_t from = m_records.size() > 8 ? m_records.size() - 8 : 0;
    for (size_t i = from; i < m_records.size(); ++i) recent.push_back(Brief(m_records[i]));
    out["requests"] = recent;
    out["pending"] = PendingLocked();
    return out;
}
} // namespace xfb::cetpanel
