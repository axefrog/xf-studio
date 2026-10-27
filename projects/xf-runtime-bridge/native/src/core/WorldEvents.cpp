#include "core/WorldEvents.hpp"
#include "core/Events.hpp"
#include "core/Params.hpp"
#include <algorithm>
#include <cmath>
namespace xfb::worldevents {
using json = nlohmann::json;
std::optional<json> ClockJumps::Observe(const json& sample, double source, Epoch epoch, uint64_t run) {
    const auto time = sample.is_object() ? sample.find("game_time_s") : sample.end();
    if (!sample.is_object() || !sample.value("valid", false) || time == sample.end() || !time->is_number() ||
        !std::isfinite(time->get<double>()) || time->get<double>() < 0 || !std::isfinite(source) || source < 0 || run == 0) {
        m_valid = false; return {};
    }
    const double game = time->get<double>(), elapsed = source - m_source, delta = game - m_game;
    // Deliberately generous relative to the game's accelerated clock. Long gaps have unknown coverage.
    const double threshold = std::max(300.0, elapsed * 60.0);
    const bool jump = m_valid && run == m_run && epoch.world == m_epoch.world && epoch.session == m_epoch.session &&
                      elapsed > 0 && elapsed <= 30 && std::abs(delta) > threshold;
    json data;
    if (jump) data = {{"what", "jump"}, {"source", "recorder.v"}, {"inferred", true}, {"cause", "unknown"},
                      {"previous_game_time_s", m_game}, {"game_time_s", game}, {"delta_game_s", delta},
                      {"elapsed_real_s", elapsed}, {"threshold_game_s", threshold}};
    m_valid = true; m_source = source; m_game = game; m_epoch = epoch; m_run = run;
    return jump ? std::optional<json>(std::move(data)) : std::nullopt;
}
Feed::Feed(size_t capacity, unsigned rate) : m_capacity(std::clamp<size_t>(capacity, 1, 2048)), m_rate(std::clamp(rate, 1u, 20u)) {}
Epoch Feed::CaptureEpoch(const std::string& kind, const json& data, const std::function<uint64_t()>& world) {
    std::scoped_lock lock(m_epochMutex);
    const auto generation = world();
    if (kind == "session") {
        if (data.contains("codeware") && data["codeware"].is_boolean()) m_codeware = data["codeware"].get<bool>() ? 1 : 0;
        const auto phase = data.find("phase");
        if (phase != data.end() && phase->is_string() && ((m_codeware == 1 && *phase == "start") || (m_codeware == 0 && *phase == "attach"))) ++m_session;
    }
    return {generation, m_session};
}
std::optional<json> Feed::Push(const std::string& kind, json data, double s, Epoch epoch, bool admitted) {
    const auto it = std::find(Kinds.begin(), Kinds.end(), kind);
    if (it == Kinds.end() || !data.is_object() || !std::isfinite(s) || s < 0 || data.dump().size() > 4096) return {};
    auto& budget = m_budget[static_cast<size_t>(it - Kinds.begin())];
    const auto drop = [&] { ++budget.pending; ++budget.total; };
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
    json row{{"seq", m_next++}, {"kind", kind}, {"s", s}, {"game_time_s", gameTime}, {"world_generation", epoch.world},
             {"session_counter", epoch.session}, {"dropped", budget.pending.exchange(0)}, {"data", std::move(data)}};
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
