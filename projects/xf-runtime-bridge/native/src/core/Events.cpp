#include "core/Events.hpp"

#include <algorithm>

#include "core/Dispatcher.hpp"
#include "core/Recording.hpp"
#include "core/Messages.hpp"
#include "core/Params.hpp"
#include "core/Win32.hpp"

namespace xfb
{
using json = nlohmann::json;
namespace
{
// Copy a structured leading prefix. Traversal/allocation stop at the byte budget, including inside arrays/strings.
std::optional<json> Prefix(const json& value, size_t& left, bool& cut, unsigned depth = 0)
{
    if (depth > kMaxJsonDepth) { cut = true; return {}; }
    if (value.is_object() || value.is_array())
    {
        if (left < 2) { cut = true; return {}; }
        left -= 2;
        json out = value.is_object() ? json::object() : json::array();
        for (auto it = value.begin(); it != value.end(); ++it)
        {
            size_t overhead = out.empty() ? 0 : 1;
            if (value.is_object()) {
                if (it.key().size() > left) { cut = true; break; }
                overhead += SerializeJson(json(it.key())).size() + 1;
            }
            if (overhead > left) { cut = true; break; }
            size_t budget = left - overhead;
            auto item = Prefix(it.value(), budget, cut, depth + 1);
            if (!item) break;
            left = budget;
            if (value.is_object()) out[it.key()] = std::move(*item); else out.push_back(std::move(*item));
            if (cut) break;
        }
        return out;
    }
    if (value.is_string())
    {
        if (left < 2) { cut = true; return {}; }
        const auto& s = value.get_ref<const std::string&>();
        size_t low = 0, high = std::min(s.size(), left);
        while (low < high) {
            const size_t mid = (low + high + 1) / 2;
            if (SerializeJson(json(s.substr(0, mid))).size() <= left) low = mid; else high = mid - 1;
        }
        // Keep complete UTF-8 codepoints, rather than replacing a split character.
        while (low && low < s.size() && (static_cast<unsigned char>(s[low]) & 0xc0) == 0x80) --low;
        auto out = json(s.substr(0, low));
        left -= SerializeJson(out).size(); cut = cut || low != s.size(); return out;
    }
    const auto text = SerializeJson(value);
    if (text.size() > left) { cut = true; return {}; }
    left -= text.size(); return value;
}
}

uint64_t EventLog::Push(const std::string& aKind, const std::string& aLevel, const std::string& aSource, const std::string& aText,
                        json aData)
{
    Event event;
    event.kind = CleanMessageText(aKind, 32);
    event.level = CleanMessageText(aLevel, 16);
    event.source = CleanMessageText(aSource, 32);
    event.text = CleanMessageText(aText, kMaxText);
    if (!aData.is_null())
    {
        if (aKind == "observe.result" && aData.is_object() && aData.contains("result"))
        {
            auto result = std::move(aData["result"]); aData["result"] = nullptr; aData["truncated"] = false;
            // Compute the actual envelope overhead with worst-case sequence/timing widths before insertion.
            const json envelope{{"seq", UINT64_MAX}, {"at", "0000-00-00T00:00:00.000Z"}, {"t_ms", INT64_MAX},
                {"source_s", -1.7976931348623157e308}, {"kind", event.kind}, {"level", event.level},
                {"source", event.source}, {"text", event.text}, {"data", aData}};
            const size_t overhead = SerializeJson(envelope).size();
            size_t budget = overhead < kMaxObserveBytes ? kMaxObserveBytes - overhead + 4 : 0;
            bool cut = false;
            aData["result"] = Prefix(result, budget, cut).value_or(json(nullptr));
            aData["truncated"] = cut;
            event.data = std::move(aData);
        }
        else
        {
            // Small by design: a data object whose text would exceed kMaxData is replaced by a note saying so.
            const auto text = SerializeJson(aData);
            event.data = text.size() <= kMaxData ? std::move(aData) : json{{"cut", true}, {"bytes", text.size()}};
        }
    }
    event.at = win32::UtcNowIso8601();
    event.sourceS = recording::Now();
    std::scoped_lock _(m_mutex);
    event.tMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - m_start).count();
    event.seq = m_next++;
    m_events.push_back(std::move(event));
    while (m_events.size() > kMaxEvents)
    {
        m_events.pop_front();
    }
    return m_next - 1;
}

json EventLog::Read(uint64_t aSince, size_t aLimit, const std::vector<std::string>& aKinds) const
{
    std::scoped_lock _(m_mutex);
    json events = json::array();
    uint64_t next = aSince;
    const uint64_t oldest = m_events.empty() ? m_next : m_events.front().seq;
    const uint64_t dropped = aSince + 1 < oldest ? oldest - (aSince + 1) : 0;
    for (const auto& event : m_events)
    {
        if (event.seq <= aSince)
        {
            continue;
        }
        if (events.size() >= aLimit)
        {
            break;
        }
        next = event.seq;
        if (!aKinds.empty() && std::find(aKinds.begin(), aKinds.end(), event.kind) == aKinds.end())
        {
            continue;
        }
        json item{{"seq", event.seq}, {"at", event.at}, {"t_ms", event.tMs}, {"kind", event.kind}, {"level", event.level},
                  {"source", event.source}, {"text", event.text}, {"source_s", event.sourceS}};
        if (!event.data.is_null())
        {
            item["data"] = event.data;
        }
        events.push_back(std::move(item));
    }
    return json{{"events", events}, {"next", next}, {"latest", m_next - 1}, {"dropped", dropped}};
}

uint64_t EventLog::Latest() const
{
    std::scoped_lock _(m_mutex);
    return m_next - 1;
}

void EventLog::Clear()
{
    std::scoped_lock _(m_mutex);
    m_events.clear();
}

EventsRequest ParseEventsRequest(const json& aParams)
{
    params::RequireOnly(aParams, {"since", "limit", "kinds"});
    EventsRequest request;
    request.since = static_cast<uint64_t>(params::CheckInteger(aParams, "since", 0, 1'000'000'000'000).value_or(0));
    request.limit = static_cast<size_t>(params::CheckInteger(aParams, "limit", 1, 500).value_or(100));
    if (const auto it = aParams.find("kinds"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > 16)
        {
            params::CheckFail("'kinds' must be a list of at most 16 event kinds");
        }
        for (const auto& kind : *it)
        {
            if (!kind.is_string() || kind.get<std::string>().empty() || kind.get<std::string>().size() > 32)
            {
                params::CheckFail("each of 'kinds' must be an event kind such as write, kill, behaviour or note");
            }
            request.kinds.push_back(kind.get<std::string>());
        }
    }
    return request;
}

NoteRequest ParseNoteRequest(const json& aParams)
{
    params::RequireOnly(aParams, {"text", "level", "data"});
    NoteRequest request;
    const auto text = params::CheckText(aParams, "text", 2000);
    if (!text)
    {
        params::CheckFail("'text' is required: the note, one line");
    }
    request.text = *text;
    if (const auto level = params::CheckText(aParams, "level", 8))
    {
        if (*level != "info" && *level != "warn" && *level != "ask" && *level != "done")
        {
            params::CheckFail("'level' must be info, warn, ask or done");
        }
        request.level = *level;
    }
    if (const auto it = aParams.find("data"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_object())
        {
            params::CheckFail("'data' must be an object");
        }
        request.data = *it;
    }
    return request;
}

void RegisterEventMethods(Dispatcher& aDispatcher, EventLog& aLog)
{
    aDispatcher.Register({"session.events", Access::Read, RunOn::BridgeThread,
                          "The session's event stream after a sequence number (writes, refusals, the kill switch, handovers, behaviours, notes).",
                          [&aLog](const MethodContext& aContext) {
                              const auto request = ParseEventsRequest(aContext.params);
                              return aLog.Read(request.since, request.limit, request.kinds);
                          }});
    aDispatcher.Register({"session.note", Access::Notify, RunOn::BridgeThread, "Adds a note to the session's event stream.",
                          [&aLog](const MethodContext& aContext) {
                              const auto request = ParseNoteRequest(aContext.params);
                              const auto seq = aLog.Push("note", request.level, "client", request.text, request.data);
                              return json{{"seq", seq}, {"undo", nullptr}, {"undo_note", "a note stays in the stream; it changes nothing in the game"}};
                          }});
}
} // namespace xfb
