#include "core/OptionsExchange.hpp"

#include <algorithm>

namespace xfb
{
using json = nlohmann::json;

uint64_t OptionsExchange::Request(std::vector<std::string> aNames)
{
    std::scoped_lock _(m_mutex);
    m_names = std::move(aNames);
    m_pending = !m_cancelled;
    m_outcome = {};
    return ++m_seq;
}

std::string OptionsExchange::Pending() const
{
    std::scoped_lock _(m_mutex);
    if (!m_pending || m_cancelled)
    {
        return {};
    }
    return json{{"seq", m_seq}, {"names", m_names}}.dump();
}

bool OptionsExchange::Refuse(const std::string& aReason, std::string* aWhy, bool aEndsPending)
{
    if (aWhy)
    {
        *aWhy = aReason;
    }
    if (aEndsPending)
    {
        {
            std::scoped_lock _(m_mutex);
            if (m_cancelled || !m_pending)
            {
                return false;
            }
            m_pending = false;
            m_refusedSeq = m_seq;
            m_outcome = {};
            m_outcome.refusal = aReason;
        }
        m_changed.notify_all();
    }
    return false;
}

bool OptionsExchange::Report(const std::string& aJson, std::string* aWhy)
{
    // Too large or not JSON: nothing in it can be trusted, not even its seq, but only one request is
    // ever pending, so the answer is taken as that request's and ends it with the reason (RB-47).
    if (aJson.size() > kMaxReportBytes)
    {
        return Refuse("the answer was too large (" + std::to_string(aJson.size()) + " bytes, at most " +
                          std::to_string(kMaxReportBytes) + ")",
                      aWhy, true);
    }
    json parsed;
    try
    {
        parsed = json::parse(aJson);
    }
    catch (const std::exception&)
    {
        return Refuse("the answer wasn't JSON", aWhy, true);
    }
    // A Lua table with no keys encodes as [] or {} (CET's json can't tell an empty list from an empty
    // map), so an empty one of either kind counts as no values and nothing skipped.
    if (parsed.is_object() && parsed.contains("values") && parsed["values"].is_array() && parsed["values"].empty())
    {
        parsed["values"] = json::object();
    }
    if (parsed.is_object() && parsed.contains("skipped") && parsed["skipped"].is_object() && parsed["skipped"].empty())
    {
        parsed["skipped"] = json::array();
    }
    if (!parsed.is_object() || !parsed.contains("seq") || !parsed["seq"].is_number_unsigned() || !parsed.contains("values") ||
        !parsed["values"].is_object() || (parsed.contains("skipped") && !parsed["skipped"].is_array()))
    {
        return Refuse("the answer wasn't {seq, values}", aWhy, true);
    }
    std::unique_lock lock(m_mutex);
    if (m_cancelled || !m_pending || parsed["seq"].get<uint64_t>() != m_seq)
    {
        lock.unlock();
        // An answer to an older or unknown request leaves the pending one alone.
        return Refuse("no such pending request", aWhy, false);
    }
    const auto asked = [this](const std::string& aName) {
        return std::find(m_names.begin(), m_names.end(), aName) != m_names.end();
    };
    OptionsOutcome outcome;
    json values = json::object();
    std::string refusal;
    for (const auto& [key, value] : parsed["values"].items())
    {
        if (!asked(key))
        {
            refusal = "it named an option that wasn't asked for";
            break;
        }
        if (value.is_null())
        {
            values[key] = nullptr;
        }
        else if (value.is_string())
        {
            if (value.get<std::string>().size() > kMaxValueChars)
            {
                values[key] = nullptr;
                outcome.tooLong.push_back(key);
            }
            else
            {
                values[key] = value;
            }
        }
        else
        {
            refusal = "a value wasn't text or null";
            break;
        }
    }
    if (refusal.empty() && parsed.contains("skipped"))
    {
        for (const auto& name : parsed["skipped"])
        {
            if (!name.is_string() || !asked(name.get<std::string>()))
            {
                refusal = "it skipped an option that wasn't asked for";
                break;
            }
            outcome.skipped.push_back(name.get<std::string>());
        }
    }
    lock.unlock();
    if (!refusal.empty())
    {
        return Refuse("the answer was refused: " + refusal, aWhy, true);
    }
    lock.lock();
    if (m_cancelled || !m_pending || parsed["seq"].get<uint64_t>() != m_seq)
    {
        lock.unlock();
        return Refuse("no such pending request", aWhy, false);
    }
    m_answer = std::move(values);
    m_outcome = std::move(outcome);
    m_answeredSeq = m_seq;
    m_pending = false;
    lock.unlock();
    m_changed.notify_all();
    return true;
}

std::optional<json> OptionsExchange::WaitFor(uint64_t aSeq, std::chrono::milliseconds aTimeout, OptionsOutcome* aOutcome)
{
    std::unique_lock lock(m_mutex);
    const bool ended = m_changed.wait_for(
        lock, aTimeout, [&] { return m_cancelled || m_answeredSeq == aSeq || m_refusedSeq == aSeq || m_seq != aSeq; });
    if (aOutcome)
    {
        *aOutcome = {};
        if (ended && !m_cancelled && m_seq == aSeq && (m_answeredSeq == aSeq || m_refusedSeq == aSeq))
        {
            *aOutcome = m_outcome;
        }
    }
    if (!ended || m_cancelled || m_answeredSeq != aSeq)
    {
        return std::nullopt;
    }
    return m_answer;
}

void OptionsExchange::Withdraw(uint64_t aSeq)
{
    std::scoped_lock _(m_mutex);
    if (m_seq == aSeq)
    {
        m_pending = false;
    }
}

void OptionsExchange::Cancel()
{
    {
        std::scoped_lock _(m_mutex);
        m_cancelled = true;
        m_pending = false;
    }
    m_changed.notify_all();
}

void OptionsExchange::Reset()
{
    std::scoped_lock _(m_mutex);
    m_cancelled = false;
    m_pending = false;
    m_outcome = {};
}

json RenderOptionsResult(const std::vector<std::string>& aNames, const std::optional<json>& aValues,
                         const OptionsOutcome& aOutcome, int aWaitMs)
{
    if (!aValues)
    {
        if (!aOutcome.refusal.empty())
        {
            return json{{"available", false}, {"reason", "the CET layer answered, but " + aOutcome.refusal}};
        }
        return json{{"available", false},
                    {"reason", "the CET layer didn't answer within " + std::to_string(aWaitMs / 1000) +
                                   " s (its overlay or a loading screen may be holding it)"}};
    }
    json missing = json::array();
    for (const auto& name : aNames)
    {
        const auto it = aValues->find(name);
        if (it == aValues->end() || it->is_null() || (it->is_string() && it->get<std::string>().empty()))
        {
            missing.push_back(name);
        }
    }
    json out{{"available", true}, {"source", "Cyber Engine Tweaks GameOptions.Get"}, {"values", *aValues}, {"missing", missing}};
    if (!aOutcome.tooLong.empty())
    {
        out["too_long"] = aOutcome.tooLong;
    }
    if (!aOutcome.skipped.empty())
    {
        out["skipped"] = aOutcome.skipped;
    }
    if (!aOutcome.tooLong.empty() || !aOutcome.skipped.empty())
    {
        out["note"] = "values longer than " + std::to_string(OptionsExchange::kMaxValueChars) +
                      " characters (too_long) or left out by the CET layer (skipped) are reported as missing";
    }
    return out;
}
} // namespace xfb
