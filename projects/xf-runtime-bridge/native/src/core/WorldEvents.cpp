#include "core/WorldEvents.hpp"
#include "core/Events.hpp"
#include "core/Params.hpp"
#include <algorithm>
#include <cmath>
namespace xfb::worldevents {
using json = nlohmann::json;
Feed::Feed(size_t capacity, unsigned rate) : m_capacity(std::clamp<size_t>(capacity, 1, 2048)), m_rate(std::clamp(rate, 1u, 20u)) {}
std::optional<json> Feed::Push(const std::string& kind, json data, double s, uint64_t world, bool admitted) {
    const auto it = std::find(Kinds.begin(), Kinds.end(), kind);
    if (it == Kinds.end() || !data.is_object() || !std::isfinite(s) || s < 0 || data.dump().size() > 4096) return {};
    auto& budget = m_budget[static_cast<size_t>(it - Kinds.begin())];
    const auto drop = [&] { ++budget.pending; ++budget.total; };
    if (kind == "session") {
        if (data.contains("codeware") && data["codeware"].is_boolean()) m_codeware = data["codeware"].get<bool>() ? 1 : 0;
        const auto phase = data.find("phase");
        if (phase != data.end() && phase->is_string() && ((m_codeware == 1 && *phase == "start") || (m_codeware == 0 && *phase == "attach"))) ++m_session;
    }
    std::unique_lock lock(m_mutex, std::try_to_lock);
    if (!lock.owns_lock()) { drop(); return {}; }
    if (!admitted) {
        const double second = std::floor(s);
        if (budget.second != second) { budget.second = second; budget.count = 0; }
        if (budget.count >= m_rate) { drop(); return {}; }
        ++budget.count;
    }
    json gameTime = nullptr;
    if (const auto t = data.find("game_time_s"); t != data.end() && t->is_number() && std::isfinite(t->get<double>()) && t->get<double>() >= 0) gameTime = *t;
    data.erase("game_time_s"); data.erase("world_feed");
    json row{{"seq", m_next++}, {"kind", kind}, {"s", s}, {"game_time_s", gameTime}, {"world_generation", world},
             {"session_counter", m_session.load()}, {"dropped", budget.pending.exchange(0)}, {"data", std::move(data)}};
    m_rows.push_back(row);
    if (m_rows.size() > m_capacity) { m_rows.pop_front(); ++m_evicted; }
    return row;
}
bool Feed::Admit(const std::string& kind, double s) {
    const auto it = std::find(Kinds.begin(), Kinds.end(), kind);
    if (it == Kinds.end() || !std::isfinite(s) || s < 0) return false;
    auto& b = m_budget[static_cast<size_t>(it - Kinds.begin())];
    std::unique_lock lock(m_mutex, std::try_to_lock);
    if (!lock.owns_lock()) { NoteDrop(kind); return false; }
    const auto second = std::floor(s);
    if (b.second != second) { b.second = second; b.count = 0; }
    if (b.count >= m_rate) { NoteDrop(kind); return false; }
    ++b.count; return true;
}
void Feed::NoteDrop(const std::string& kind) {
    const auto it = std::find(Kinds.begin(), Kinds.end(), kind);
    if (it == Kinds.end()) return;
    auto& b = m_budget[static_cast<size_t>(it - Kinds.begin())]; ++b.pending; ++b.total;
}
json Feed::Read(const json& params) const {
    const auto request = ParseEventsRequest(params);
    params::CheckInteger(params, "limit", 1, 100);
    for (const auto& kind : request.kinds) if (std::find(Kinds.begin(), Kinds.end(), kind) == Kinds.end()) params::CheckFail("unknown world event kind");
    std::scoped_lock lock(m_mutex);
    json rows = json::array(), dropped = json::object();
    auto next = request.since;
    size_t bytes = 0; bool byteLimited = false;
    for (const auto& row : m_rows) {
        const auto seq = row["seq"].get<uint64_t>();
        if (seq < request.since) continue;
        if (rows.size() >= request.limit) break;
        if (request.kinds.empty() || std::find(request.kinds.begin(), request.kinds.end(), row["kind"].get<std::string>()) != request.kinds.end()) {
            const auto size = SerializeJson(row).size();
            if (bytes + size > 48 * 1024) { byteLimited = true; break; }
            bytes += size; rows.push_back(row);
        }
        next = seq + 1;
    }
    for (size_t i = 0; i < Kinds.size(); ++i) dropped[Kinds[i]] = m_budget[i].total.load();
    const uint64_t oldest = m_rows.empty() ? m_next : m_rows.front()["seq"].get<uint64_t>();
    return {{"events", rows}, {"next", next}, {"latest", m_next - 1}, {"evicted", m_evicted},
            {"missed", request.since > 0 && request.since < oldest ? oldest - request.since : 0}, {"dropped", dropped},
            {"byte_limited", byteLimited}, {"capacity", m_capacity}, {"rate_per_kind_s", m_rate},
            {"coverage", {{"session_callbacks", m_codeware == 1 ? "codeware" : m_codeware == 0 ? "script_layer_only" : "unreported"},
                          {"session_limit", m_codeware == 1 ? "none" : "no early load/start or save notifications without Codeware"},
                          {"evidence", "source/offline"}}}};
}
void Register(Dispatcher& d, Feed& feed) {
    d.Register({"world.events", Access::Read, RunOn::BridgeThread, "Passive bounded world event feed", [&feed](const MethodContext& c) { return feed.Read(c.params); }});
}
}
