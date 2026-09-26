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

bool OptionsExchange::Report(const std::string& aJson, std::string* aWhy)
{
    const auto refuse = [aWhy](const char* aReason) {
        if (aWhy)
        {
            *aWhy = aReason;
        }
        return false;
    };
    if (aJson.size() > kMaxReportBytes)
    {
        return refuse("too large");
    }
    json parsed;
    try
    {
        parsed = json::parse(aJson);
    }
    catch (const std::exception&)
    {
        return refuse("not JSON");
    }
    // A Lua table with no keys encodes as [] (CET's json), so an empty list counts as no values.
    if (parsed.is_object() && parsed.contains("values") && parsed["values"].is_array() && parsed["values"].empty())
    {
        parsed["values"] = json::object();
    }
    if (!parsed.is_object() || !parsed.contains("seq") || !parsed["seq"].is_number_unsigned() || !parsed.contains("values") ||
        !parsed["values"].is_object())
    {
        return refuse("not {seq, values}");
    }
    std::unique_lock lock(m_mutex);
    if (m_cancelled || !m_pending || parsed["seq"].get<uint64_t>() != m_seq)
    {
        return refuse("no such pending request");
    }
    json values = json::object();
    for (const auto& [key, value] : parsed["values"].items())
    {
        if (std::find(m_names.begin(), m_names.end(), key) == m_names.end())
        {
            return refuse("an option that wasn't asked for");
        }
        if (!(value.is_null() || (value.is_string() && value.get<std::string>().size() <= kMaxValueChars)))
        {
            return refuse("a value that isn't a short text or null");
        }
        values[key] = value;
    }
    m_answer = std::move(values);
    m_answeredSeq = m_seq;
    m_pending = false;
    lock.unlock();
    m_changed.notify_all();
    return true;
}

std::optional<json> OptionsExchange::WaitFor(uint64_t aSeq, std::chrono::milliseconds aTimeout)
{
    std::unique_lock lock(m_mutex);
    const bool answered =
        m_changed.wait_for(lock, aTimeout, [&] { return m_cancelled || m_answeredSeq == aSeq || m_seq != aSeq; });
    if (!answered || m_cancelled || m_answeredSeq != aSeq)
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
} // namespace xfb
