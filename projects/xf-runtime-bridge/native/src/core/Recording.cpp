#include "core/Recording.hpp"
#include <Windows.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <set>
#include <fstream>
#include <ctime>
#include <cstdio>

namespace xfb::recording
{
double Now()
{
    static const double frequency = [] { LARGE_INTEGER f; QueryPerformanceFrequency(&f); return static_cast<double>(f.QuadPart); }();
    LARGE_INTEGER t; QueryPerformanceCounter(&t); return static_cast<double>(t.QuadPart) / frequency;
}
namespace
{
unsigned EventBit(const std::string& channel) { return channel == "subtitles" ? 1 : channel == "voice" ? 2 : channel == "face" ? 4 : channel == "ui" ? 8 : channel == "contacts" ? 16 : channel == "supervisor" ? 32 : channel == "incidents" ? 64 : 0; }
void Keys(const json& p, const std::set<std::string>& keys)
{
    if (!p.is_object()) throw MethodError("bad_params", "Expected an object.");
    for (auto it = p.begin(); it != p.end(); ++it)
        if (!keys.count(it.key())) throw MethodError("bad_params", "Unknown recorder parameter: " + it.key());
}
uint64_t Integer(const json& p, const char* key, uint64_t fallback, uint64_t max)
{
    if (!p.contains(key)) return fallback;
    const auto& v = p.at(key);
    if (!v.is_number_integer() || v.get<double>() < 0 || v.get<double>() > static_cast<double>(max))
        throw MethodError("bad_params", std::string(key) + " is outside its integer bounds.");
    return v.get<uint64_t>();
}
std::string UtcAt(std::chrono::system_clock::time_point value)
{
    using namespace std::chrono;
    const auto at = floor<milliseconds>(value);
    const auto seconds = floor<std::chrono::seconds>(at);
    const auto utc = system_clock::to_time_t(seconds);
    std::tm tm{}; gmtime_s(&tm, &utc);
    char text[32];
    std::snprintf(text, sizeof(text), "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ",
                  tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec,
                  static_cast<long long>((at - seconds).count()));
    return text;
}
json ClockSync(std::optional<double> anchor = {})
{
    // Bracket the UTC read with QPC. The interval (not timestamp precision or OS accuracy) is the uncertainty.
    const double before = Now();
    const auto utc = std::chrono::system_clock::now();
    const double after = Now();
    const double s = anchor.value_or(before);
    return {{"s", s}, {"at", UtcAt(utc + std::chrono::duration_cast<std::chrono::system_clock::duration>(std::chrono::duration<double>(s - before)))},
            {"uncertainty_ms", (after - before) * 1000.0}};
}
}
Service::Service() : m_ring(std::make_unique<std::array<Record, kCapacity>>()) {}
Service::~Service() { Stop("shutdown", Now()); JoinWriter(); }
void Service::SetDirectory(const std::filesystem::path& directory)
{
    std::scoped_lock lock(m_mutex);
    if (m_active || m_writerBusy) throw MethodError("recording_busy", "Writer is still active.");
    m_root = directory;
}
void Service::JoinWriter() { if (m_writer.joinable()) m_writer.join(); }
void Service::WriteFiles()
{
    uint64_t cursor = 0, chunk = 0, chunkBytes = 0, total = 0, lost = 0;
    json chunks = json::array();
    std::ofstream file;
    try
    {
        std::filesystem::create_directories(m_output);
        for (;;)
        {
            const auto page = Read({{"run", m_run}, {"since", cursor}}, Now());
            lost += page.at("lost").get<uint64_t>();
            for (const auto& row : page.at("records"))
            {
                auto line = SerializeJson(row) + "\n";
                if (!file.is_open() || chunkBytes + line.size() > 1024 * 1024)
                {
                    if (file.is_open()) { file.flush(); if (!file) throw std::runtime_error("chunk flush failed"); file.close(); }
                    auto name = "chunk-" + std::to_string(++chunk) + ".jsonl";
                    file.open(m_output / name, std::ios::binary | std::ios::out | std::ios::trunc);
                    if (!file) throw std::runtime_error("chunk open failed");
                    chunks.push_back({{"file", name}, {"bytes", 0}, {"sync", ClockSync()}}); chunkBytes = 0;
                }
                file << line;
                if (!file) throw std::runtime_error("chunk write failed");
                chunkBytes += line.size(); total += line.size(); chunks.back()["bytes"] = chunkBytes;
            }
            if (file.is_open()) { file.flush(); if (!file) throw std::runtime_error("chunk flush failed"); }
            cursor = page.at("next").get<uint64_t>();
            if (!page.value("active", true) && cursor == page.at("latest").get<uint64_t>())
            {
                if (file.is_open()) { file.close(); if (!file) throw std::runtime_error("chunk close failed"); }
                auto manifest = Read({{"run", m_run}, {"since", cursor}}, Now());
                manifest.erase("records"); manifest["chunks"] = chunks; manifest["file_bytes"] = total;
                manifest["writer_pending"] = false; manifest["file_lost"] = lost;
                manifest["complete"] = lost == 0 && manifest.at("sample_ticks") > 0 && manifest.at("dropped") == 0 && manifest.at("missed_deadlines") == 0 && manifest.at("invalid") == 0 &&
                                       manifest.value("complete_coverage", true);
                std::ofstream out(m_output / "manifest.json.tmp", std::ios::binary);
                out << SerializeJson(manifest) << '\n'; out.flush();
                if (!out) throw std::runtime_error("manifest write failed");
                out.close(); std::filesystem::rename(m_output / "manifest.json.tmp", m_output / "manifest.json");
                break;
            }
            // Drain the current backlog before waiting. Five rows every 250 ms would cap the
            // writer at 20 rows/s, below the default three 10 Hz sources even without taps.
            if (cursor < page.at("latest").get<uint64_t>()) continue;
            std::unique_lock lock(m_mutex);
            m_wake.wait_for(lock, std::chrono::milliseconds(250), [this] { return !m_active || m_startedGeneration.load() != CancellationGeneration(); });
        }
    }
    catch (const std::exception& e)
    {
        std::scoped_lock lock(m_mutex); m_fileError = e.what(); Stop("file_error", Now());
    }
    if (file.is_open()) file.close(); // all file I/O finishes before a new Start can join this thread
    std::scoped_lock lock(m_mutex); m_writerBusy = false;
}
json Service::Status(double now) const
{
    const double elapsed = std::max(0.0, (m_active ? now : m_end) - m_start);
    json counts = json::object();
    for (const auto& [channel, n] : m_counts)
    {
        counts[channel] = {{"attempts", n[0]}, {"valid", n[1]}, {"actual_hz", elapsed > 0 ? static_cast<double>(n[0]) / elapsed : 0},
                           {"valid_hz", elapsed > 0 ? static_cast<double>(n[1]) / elapsed : 0}};
        if (const auto it = m_notReadyCounts.find(channel); it != m_notReadyCounts.end()) counts[channel]["not_ready"] = it->second;
        if (channel == "subtitles" || channel == "voice") counts[channel]["ready"] = m_tapReady.count(channel) > 0;
    }
    // Review (Medium 5): the selected tap channels that have not once been ready in this run.
    json tapNotReady = json::array();
    for (const auto& channel : m_channels)
        if ((channel == "subtitles" || channel == "voice") && !m_tapReady.count(channel)) tapNotReady.push_back(channel);
    return {{"schema", "xfb/recording-1"}, {"plugin_version", XFB_VERSION_STRING}, {"run", m_run}, {"session", m_session}, {"pid", GetCurrentProcessId()},
        {"world_generation", m_world}, {"connection", m_connection}, {"active", m_active}, {"reason", m_reason},
        {"clock", "QueryPerformanceCounter_seconds"}, {"source_now_s", now}, {"start_s", m_start}, {"end_s", m_active ? json(nullptr) : json(m_end)},
        {"start_at", m_startSync.is_object() ? m_startSync.at("at") : json(nullptr)}, {"start_sync", m_startSync},
        {"actor_identity_cap", kActorIdentityCap}, {"actor_identities", m_actorIdentities.size()}, {"actor_identity_omitted", m_identityOmitted},
        {"requested_hz", 10}, {"actual_hz", elapsed > 0 ? static_cast<double>(m_samples) / elapsed : 0}, {"channel_stats", counts},
        {"sample_ticks", m_samples}, {"missed_deadlines", m_missed}, {"dropped", m_dropped + m_ingressDropped.load()}, {"invalid", m_invalid}, {"not_ready", m_notReady}, {"tap_not_ready", tapNotReady}, {"complete_coverage", tapNotReady.empty()}, {"bytes", m_bytes},
        {"largest_gap_s", m_gap}, {"age_s", m_samples ? json(std::max(0.0, now - m_last)) : json(nullptr)},
        {"latest", m_latest}, {"channels", m_channels}, {"actors", m_actors}, {"capacity", kCapacity},
        {"output", m_output.string()}, {"writer_pending", m_writerBusy}, {"file_error", m_fileError},
        {"coverage", "source_snapshots + subtitle/controller + script_voice_requests + facial_submissions + UI_consumers + partial contact callbacks; not continuous no-contact, rendered, evaluated face or audible proof"}};
}
json Service::ObserverStatus(const std::string& session) const
{
    struct Snapshot
    {
        bool active;
        uint64_t run, world, latest, ack, cap;
        double start, until;
        std::vector<std::string> channels;
        std::string reason;
        json sync;
    };
    const auto state = [&] {
        std::scoped_lock lock(m_mutex);
        return Snapshot{m_active, m_run, m_world, m_latest, m_ack, m_cap, m_start, m_until, m_channels, m_reason, m_startSync};
    }();
    // Construct/encode the response only after releasing the recorder's lock.
    const bool hasRun = state.run != 0;
    return {{"active", state.active}, {"run", hasRun ? json(state.run) : json(nullptr)}, {"session", session},
        {"world", hasRun ? json(state.world) : json(nullptr)}, {"channels", state.channels},
        {"start", hasRun ? state.sync : json(nullptr)},
        {"latest", hasRun ? json(state.latest) : json(nullptr)},
        {"stop_reason", hasRun && !state.active ? json(state.reason) : json(nullptr)},
        {"requested_hz", hasRun ? json(10) : json(nullptr)},
        {"duration_s", hasRun ? json(state.until - state.start) : json(nullptr)},
        {"byte_cap", hasRun ? json(state.cap) : json(nullptr)}, {"ack", hasRun ? json(state.ack) : json(nullptr)}};
}
json Service::Start(const json& p, double now, uint64_t world, uint64_t connection, const std::string& session,
                    std::optional<uint64_t> generation)
{
    const auto admitted = generation.value_or(CancellationGeneration());
    std::scoped_lock lock(m_mutex);
    if (admitted != CancellationGeneration()) throw MethodError("interrupted", "Recorder start was cancelled before execution.");
    Keys(p, {"channels", "actors", "rate_hz", "duration_s", "byte_cap"});
    if (m_active || m_writerBusy || m_ack < m_latest) throw MethodError("recording_busy", "Stop and drain the previous recording before starting another.");
    if (Integer(p, "rate_hz", 10, 10) != 10) throw MethodError("bad_params", "This recorder samples at 10 Hz.");
    const auto duration = Integer(p, "duration_s", 60, 1800);
    const auto cap = Integer(p, "byte_cap", 64 * 1024 * 1024, 512 * 1024 * 1024);
    if (!duration || cap < kPayload) throw MethodError("bad_params", "duration_s must be positive; byte_cap at least 8192.");
    auto channels = p.value("channels", json::array({"v", "actors", "camera", "contacts", "supervisor"}));
    auto actors = p.value("actors", json::array());
    if (!channels.is_array() || channels.empty() || channels.size() > 10 || !actors.is_array() || actors.size() > 16)
        throw MethodError("bad_params", "Choose 1 to 10 channels and at most 16 actor handles.");
    std::vector<std::string> selected, whos;
    for (const auto& c : channels)
    {
        if (!c.is_string() || (c != "v" && c != "actors" && c != "camera" && c != "subtitles" && c != "voice" && c != "face" && c != "ui" && c != "contacts" && c != "supervisor" && c != "incidents")) throw MethodError("bad_params", "Unknown recorder channel.");
        const auto s = c.get<std::string>();
        if (std::find(selected.begin(), selected.end(), s) != selected.end()) throw MethodError("bad_params", "Duplicate channel.");
        selected.push_back(s);
    }
    for (const auto& a : actors)
    {
        if (!a.is_string()) throw MethodError("bad_params", "Expected actor handle.");
        auto s = a.get<std::string>();
        if (s.size() < 2 || s.size() > 16 || (s[0] != 'a' && s[0] != 'p') || s.find_first_not_of("0123456789", 1) != std::string::npos ||
            std::find(whos.begin(), whos.end(), s) != whos.end()) throw MethodError("bad_params", "Expected distinct a/p numeric handles.");
        whos.push_back(s);
    }
    m_channels = std::move(selected); m_actors = std::move(whos);
    m_counts.clear(); m_notReadyCounts.clear(); m_tapReady.clear(); m_notReady = 0;
    ++m_run; m_world = world; m_connection = connection; m_session = session;
    m_latest = m_ack = m_dropped = m_missed = m_samples = m_bytes = m_invalid = 0;
    m_start = m_next = now; m_until = now + static_cast<double>(duration); m_last = m_gap = m_end = 0;
    m_startSync = ClockSync(now); m_actorIdentities.clear(); m_recentGaps.clear(); m_identityOmitted = 0;
    m_ingressDropped.store(0); m_nextHeartbeat = now; m_nextUiHeartbeat = 0; m_lastUi.clear();
    // Identity first: a reader that sees the channel wanted must see this run's identity.
    m_identityRun.store(m_run); m_identityWorld.store(m_world); m_identityConnection.store(m_connection);
    unsigned mask = 0; for (const auto& c : m_channels) mask |= EventBit(c); m_eventMask.store(mask);
    m_cap = cap; m_active = true; m_reason.clear(); m_startedGeneration.store(admitted);
    if (admitted != CancellationGeneration())
    {
        Stop("cancelled", now);
        throw MethodError("interrupted", "Recorder start was cancelled during execution.");
    }
    m_fileError.clear(); m_output.clear();
    if (!m_root.empty())
    {
        JoinWriter();
        m_output = m_root / m_session / ("run-" + std::to_string(m_run));
        m_writerBusy = true;
        m_writer = std::thread([this] { WriteFiles(); });
    }
    return Status(now);
}
json Service::Stop(const std::string& reason, double now)
{
    std::scoped_lock lock(m_mutex);
    if (m_active) { m_eventMask.store(0); m_active = false; m_reason = reason; m_end = now; m_wake.notify_all(); }
    return Status(now);
}
void Service::RequestStop(const char* reason) { m_requested.store(reason); ++m_cancelGeneration; m_eventMask.store(0); m_wake.notify_all(); }
void Service::Tick(double now, uint64_t world, uint64_t connection, bool live, uint64_t tick, const Ops& ops)
{
    std::scoped_lock lock(m_mutex);
    if (!m_active) return;
    if (m_startedGeneration.load() != CancellationGeneration()) { Stop(m_requested.load(), now); return; }
    if (!live || world != m_world || connection != m_connection) { Stop(world != m_world ? "world_changed" : "owner_or_live_gate_closed", now); return; }
    if (now >= m_until) { Stop("duration", now); return; }
    if (now + 1e-9 < m_next) return;
    const auto previousMissed=m_missed;
    m_missed += static_cast<uint64_t>(std::max(0.0, std::floor((now - m_next + 1e-9) / 0.1)));
    if(m_missed!=previousMissed){if(m_recentGaps.size()==8)m_recentGaps.pop_front();m_recentGaps.push_back({{"channel","recorder"},{"from_s",m_samples?m_last:m_next},{"to_s",now},{"reason","missed_deadline"}});}
    m_next = m_start + (std::floor((now - m_start + 1e-9) / 0.1) + 1) * 0.1;
    if (m_samples) m_gap = std::max(m_gap, now - m_last);
    m_last = now; ++m_samples;
    const bool heartbeat = now >= m_nextHeartbeat;
    if (heartbeat) m_nextHeartbeat = now + 1.0;
    for (const auto& channel : m_channels)
    {
        if (EventBit(channel) && channel != "ui" && !heartbeat) continue; // event channels have a 1 Hz coverage heartbeat only
        if (m_startedGeneration.load() != CancellationGeneration()) { Stop(m_requested.load(), Now()); break; }
        const double at = Now();
        json payload; bool valid = false;
        try { ops.guard(); payload = ops.sample(channel, m_actors); valid = !payload.is_null() && payload.value("valid", true); }
        catch (const MethodError& e) { payload = {{"error", e.code}, {"message", std::string(e.what()).substr(0, 200)}}; }
        catch (...) { payload = {{"error", "sample_failed"}}; }
        const double end = Now();
        if (channel == "v" && payload.is_object() && !payload.contains("game_time_s")) payload["game_time_s"] = nullptr;
        if ((channel == "v" || channel == "actors") && payload.is_object())
        {
            // The script has already resolved these puppets in this sample. No additional game call or timer.
            auto identityOf = [&](json& actor) {
                if (!actor.is_object() || !actor.contains("identity")) return;
                auto identity = std::move(actor["identity"]); actor.erase("identity");
                if (!identity.is_object() || !actor.contains("entity") || !actor["entity"].is_string()) return;
                const auto entity = actor["entity"].get<std::string>();
                if (entity.empty() || entity.size() > 20 || entity.find_first_not_of("0123456789") != std::string::npos || m_actorIdentities.count(entity)) return;
                if (m_actorIdentities.size() >= kActorIdentityCap) { ++m_identityOmitted; return; }
                identity["event"] = "actor.identity"; identity["entity"] = entity;
                if (Append("actor.identity", SerializeJson(identity), at, end, tick, true)) m_actorIdentities[entity] = {{"record",identity.value("record",json())},{"affiliation",identity.value("affiliation",json()).is_object()?identity["affiliation"].value("record",json()):identity.value("affiliation",json())},{"crowd",identity.value("crowd",json())}};
            };
            if (channel == "v") identityOf(payload);
            else if (payload.contains("actors") && payload["actors"].is_array())
                for (auto& actor : payload["actors"]) { if (!m_active) break; identityOf(actor); }
            if (!m_active) break;
        }
        if ((channel == "subtitles" || channel == "voice") && payload.is_object())
        {
            if (valid) m_tapReady.insert(channel);
            else if (!m_tapReady.count(channel) && now - m_start < kTapNotReadyS && payload.value("controller_count", -1) == 0 &&
                     payload.value("source_listeners", -1) == 3 && payload.value("registry_overflow", true) == false)
            {
                // Not invalid: the HUD's subtitle controllers haven't been created yet after the world started.
                payload["reason"] = "not_ready";
                valid = true;
                ++m_notReady; ++m_notReadyCounts[channel];
            }
        }
        if (channel == "ui" && valid && payload.is_object())
        {
            // The polled UI snapshot is recorded when it changes, plus a heartbeat every kUiHeartbeat seconds that
            // proves the observer is still reading; a still screen must not write 10 records a second.
            auto text = SerializeJson(payload);
            const bool changed = text != m_lastUi;
            if (!changed && now + 1e-9 < m_nextUiHeartbeat) continue;
            m_lastUi = std::move(text); m_nextUiHeartbeat = now + kUiHeartbeat;
            payload["reason"] = changed ? "change" : "heartbeat";
        }
        Append(channel, SerializeJson(payload), at, end, tick, valid);
        if (!m_active) break;
    }
}
bool Service::Wants(const std::string& channel) const { return m_startedGeneration.load() == CancellationGeneration() && (m_eventMask.load() & EventBit(channel)) != 0; }
std::string Service::Identity(const std::string& channel) const
{
    // Atomics only: the caller is a game or UI thread that must not wait for the writer.
    if (!Wants(channel)) return {};
    return "r" + std::to_string(m_identityRun.load()) + ".w" + std::to_string(m_identityWorld.load()) + ".c" + std::to_string(m_identityConnection.load());
}
bool Service::Append(const std::string& channel, const std::string& text, double at, double end, uint64_t tick, bool valid)
{
    ++m_counts[channel][0]; if (valid) ++m_counts[channel][1];
    if (!valid) {++m_invalid; if(m_recentGaps.size()==8)m_recentGaps.pop_front();m_recentGaps.push_back({{"channel",channel},{"from_s",at},{"to_s",end},{"reason","invalid"}});}
    ++m_latest;
    if (text.size() >= kPayload) { ++m_dropped; return false; }
    const auto bytes = text.size() + 768;
    if (m_bytes + bytes > m_cap) { ++m_dropped; Stop("byte_cap", at); return false; }
    m_bytes += bytes;
    auto& r = (*m_ring)[(m_latest - 1) % kCapacity];
    if (r.run == m_run && r.seq > m_ack) ++m_dropped;
    r.run = m_run; r.seq = m_latest; r.tick = tick; r.at = at; r.end = end; r.valid = valid;
    std::memcpy(r.channel.data(), channel.c_str(), channel.size() + 1);
    std::memcpy(r.payload.data(), text.c_str(), text.size() + 1);
    m_wake.notify_all();
    return true;
}
bool Service::Ingress(const std::string& channel, const std::string& payload, double now,
                      uint64_t world, uint64_t connection, uint64_t tick)
{
    if (!Wants(channel)) return false;
    std::unique_lock lock(m_mutex, std::try_to_lock);
    if (!lock.owns_lock()) { ++m_ingressDropped; return false; }
    if (!m_active || m_startedGeneration.load() != CancellationGeneration()) return false;
    if (world != m_world || connection != m_connection) { Stop("owner_or_world_changed", now); return false; }
    if (now >= m_until) { Stop("duration", now); return false; }
    // Script callbacks only; reject before parsing. Never use this on audio/render hooks.
    if (payload.size() >= kPayload || JsonNestingDepth(payload, 12) > 12) { ++m_invalid; ++m_dropped; return false; }
    const auto parsed = json::parse(payload, nullptr, false);
    if (!parsed.is_object() || !parsed.contains("event") || !parsed["event"].is_string() ||
        (parsed.contains("valid") && !parsed["valid"].is_boolean())) { ++m_invalid; ++m_dropped; return false; }
    return Append(channel, payload, now, now, tick, parsed.value("valid", true));
}
json Service::SnapshotData(double now,uint64_t world) const
{
    std::optional<Record> v,actors;json result;
    {std::unique_lock lock(m_mutex,std::try_to_lock);if(!lock.owns_lock())return {{"available",false}};
     result={{"world",m_world},{"active",m_active&&m_startedGeneration.load()==CancellationGeneration()&&world==m_world},
       {"run",m_run?json(m_run):json(nullptr)},{"channels",m_channels},{"gaps",m_recentGaps},{"v",nullptr},{"actors",json::array()}};
     if(world!=m_world)return result;
     for(uint64_t n=m_latest,seen=0;n>0&&seen<kCapacity&&(!v||!actors);--n,++seen){const auto& row=(*m_ring)[(n-1)%kCapacity];
       if(row.seq!=n||row.run!=m_run)continue;
       if(!v&&std::string_view(row.channel.data())=="v")v=row;
       if(!actors&&std::string_view(row.channel.data())=="actors")actors=row;
     }
     if(m_ingressDropped.load()||m_dropped){if(result["gaps"].size()>=8)result["gaps"].erase(0);result["gaps"].push_back({{"channel","recorder"},{"from_s",m_last},{"to_s",now},{"reason","dropped"}});}
    }
    // At most two existing 8 KiB payloads; never encode/parse the whole recorder ring.
    if(v){result["v"]=json::parse(v->payload.data(),nullptr,false);result["v_s"]=v->at;if(!result["v"].is_object())result["v"]=nullptr;else if(!v->valid)result["v"]["valid"]=false;}
    if(actors){auto value=json::parse(actors->payload.data(),nullptr,false);if(value.is_object()&&value.contains("actors")&&value["actors"].is_array()){
        result["actors"]=value["actors"];
        // A failed channel sample cannot make an otherwise complete inner actor look resolved.
        if(!actors->valid)for(auto& actor:result["actors"])if(actor.is_object())actor["valid"]=false;
      }result["actors_s"]=actors->at;}
    {std::unique_lock lock(m_mutex,std::try_to_lock);if(!lock.owns_lock())return {{"available",false}};if(world!=m_world||result["run"]!=m_run){result["active"]=false;return result;}
     for(auto& actor:result["actors"]){if(!actor.is_object())continue;const auto id=actor.value("entity",std::string());if(const auto found=m_actorIdentities.find(id);found!=m_actorIdentities.end())actor["identity"]=found->second;}
    }
    return result;
}
json Service::Read(const json& p, double now, bool acknowledge)
{
    std::scoped_lock lock(m_mutex);
    if (m_startedGeneration.load() != CancellationGeneration()) Stop(m_requested.load(), now);
    Keys(p, {"run", "since", "limit"});
    if (Integer(p, "run", 0, UINT64_MAX) != m_run || !m_run) throw MethodError("recording_changed", "Use the run returned by start.");
    const auto since = Integer(p, "since", 0, UINT64_MAX), limit = Integer(p, "limit", 5, 5);
    if (since > m_latest || !limit) throw MethodError("bad_params", "Invalid recording cursor or limit.");
    if (acknowledge) m_ack = std::max(m_ack, since);
    auto out = Status(now); auto rows = json::array(); uint64_t next = since, lost = 0;
    const auto first = m_latest > kCapacity ? m_latest - kCapacity + 1 : 1;
    if (next + 1 < first) { lost += first - next - 1; next = first - 1; }
    while (next < m_latest && rows.size() < limit)
    {
        ++next; const auto& r = (*m_ring)[(next - 1) % kCapacity];
        if (r.run != m_run || r.seq != next) { ++lost; continue; }
        rows.push_back({{"schema", "xfb/source-record-1"}, {"pid", GetCurrentProcessId()}, {"run", m_run}, {"session", m_session}, {"world_generation", m_world},
            {"seq", r.seq}, {"tick", r.tick}, {"channel", r.channel.data()}, {"source_s", r.at}, {"source_end_s", r.end},
            {"simulation_s", nullptr}, {"age_s", std::max(0.0, now - r.at)}, {"valid", r.valid}, {"dropped", m_dropped + m_ingressDropped.load()},
            {"data", json::parse(r.payload.data())}});
    }
    out["records"] = std::move(rows); out["next"] = next; out["lost"] = lost; return out;
}
void RegisterMethods(Dispatcher& d, Service& s, bool hooks, std::function<uint64_t()> world,
                     std::function<uint64_t()> connection, std::function<std::string()> session, std::function<void()> guard)
{
    const auto enabled = [hooks] { if (!hooks) throw MethodError("test_hooks_off", "Recorder needs allow_test_hooks."); };
    d.Register({"recorder.status", Access::Read, RunOn::BridgeThread, "Observe the current or last recorder run without acknowledging records.",
        [&s, enabled, session](const MethodContext& c) { enabled(); Keys(c.params, {}); return s.ObserverStatus(session()); }});
    d.Register({"test.record.start", Access::Read, RunOn::BridgeThread, "Start bounded source recording.",
        [&, enabled, world, connection, session, guard](const MethodContext& c) {
            enabled();
            const auto generation = s.CancellationGeneration();
            return d.RunRead([&s, c, generation, world, connection, session, guard] {
                guard(); return s.Start(c.params, Now(), world(), connection(), session(), generation);
            }, "test.record.start");
        }});
    d.Register({"test.record.read", Access::Read, RunOn::BridgeThread, "Drain source records without a game read.",
        [&, enabled](const MethodContext& c) { enabled(); return s.Read(c.params, Now(), !c.readOnlyConnection); }});
    d.Register({"test.record.stop", Access::Control, RunOn::BridgeThread, "Stop recording; retained rows remain drainable.",
        [&, enabled](const MethodContext& c) { enabled(); Keys(c.params, {}); s.RequestStop("cancelled"); return json{{"stop_requested", true}}; }});
}
}
