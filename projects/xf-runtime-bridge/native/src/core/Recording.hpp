#pragma once
#include "core/Dispatcher.hpp"
#include <array>
#include <map>
#include <set>
#include <memory>
#include <vector>
#include <filesystem>
#include <thread>
#include <condition_variable>

namespace xfb::recording
{
using json = nlohmann::json;
// One bounded owner. Producers copy bounded payloads; only Read encodes wire records.
inline constexpr size_t kCapacity = 512, kPayload = 8192;
inline constexpr size_t kActorIdentityCap = 2048;
inline constexpr double kUiHeartbeat = 2.0; // seconds between records of an unchanged UI snapshot
// 0.8.22 (B318-1 tripped on a load): the subtitle and voice taps find the HUD's subtitle controllers a moment after the world
// starts. Until a channel's tap has once been ready, a coverage sample with no controllers in a run's first kTapNotReadyS
// seconds is recorded as not_ready (a valid record with reason not_ready, counted apart), not as an invalid sample, and only
// when the rest of the tap is healthy (all three source listeners, no registry overflow). A tap channel that never became
// ready is listed in tap_not_ready, and such a run's coverage is incomplete (complete_coverage false, the manifest's complete).
inline constexpr double kTapNotReadyS = 2.0;
double Now(); // QueryPerformanceCounter seconds, shared with tools via recorded calibration bounds.
struct Ops
{
    std::function<void()> guard;
    std::function<json(const std::string&, const std::vector<std::string>&)> sample;
};
class Service
{
public:
    Service();
    ~Service();
    void SetDirectory(const std::filesystem::path& directory);
    void JoinWriter(); // unload only; never joins from a game tick
    uint64_t CancellationGeneration() const { return m_cancelGeneration.load(); }
    json Start(const json& params, double now, uint64_t world, uint64_t connection, const std::string& session,
               std::optional<uint64_t> generation = {});
    json Stop(const std::string& reason, double now);
    // Nonblocking emergency notification. reason must have static lifetime (a string literal).
    void RequestStop(const char* reason);
    json Read(const json& params, double now, bool acknowledge = true);
    // Observer discovery: copies guarded state, never applies pending stops or acknowledges records.
    json ObserverStatus(const std::string& session) const;
    void Tick(double now, uint64_t world, uint64_t connection, bool live, uint64_t tick, const Ops& ops);
    bool Wants(const std::string& channel) const; // atomic fast gate, no game access
    // Who is recording: "r<run>.w<world>.c<connection>" while an active run wants the channel, else empty. A stop and a
    // fast restart between two looks always change it, so an observer can drop state that belonged to the old run.
    std::string Identity(const std::string& channel) const;
    bool Ingress(const std::string& channel, const std::string& payload, double now,
                 uint64_t world, uint64_t connection, uint64_t tick);
private:
    bool Append(const std::string& channel, const std::string& payload, double at, double end, uint64_t tick, bool valid);
    struct Record
    {
        uint64_t seq = 0, tick = 0, run = 0;
        double at = 0, end = 0;
        std::array<char, 16> channel{};
        std::array<char, kPayload> payload{};
        bool valid = false;
    };
    json Status(double now) const;
    void WriteFiles();
    mutable std::recursive_mutex m_mutex;
    std::unique_ptr<std::array<Record, kCapacity>> m_ring;
    std::vector<std::string> m_channels, m_actors;
    std::map<std::string, std::array<uint64_t, 2>> m_counts;
    std::map<std::string, uint64_t> m_notReadyCounts; // 0.8.22: per channel
    std::set<std::string> m_tapReady;                 // the tap channels that have answered ready in this run
    uint64_t m_notReady = 0;
    std::string m_session, m_reason;
    json m_startSync;
    std::set<std::string> m_actorIdentities; // this run/world only; bounded by kActorIdentityCap
    uint64_t m_identityOmitted = 0;
    uint64_t m_run = 0, m_world = 0, m_connection = 0, m_latest = 0, m_ack = 0;
    uint64_t m_dropped = 0, m_missed = 0, m_samples = 0, m_bytes = 0, m_cap = 0, m_invalid = 0;
    double m_start = 0, m_end = 0, m_next = 0, m_until = 0, m_last = 0, m_gap = 0;
    bool m_active = false;
    std::atomic<const char*> m_requested{nullptr};
    std::atomic<uint64_t> m_cancelGeneration{0}, m_startedGeneration{0};
    std::atomic<unsigned> m_eventMask{0};
    std::atomic<uint64_t> m_ingressDropped{0};
    std::atomic<uint64_t> m_identityRun{0}, m_identityWorld{0}, m_identityConnection{0}; // set by Start; read without the lock
    double m_nextHeartbeat = 0, m_nextUiHeartbeat = 0;
    std::string m_lastUi; // the polled UI snapshot last recorded: unchanged snapshots wait for a heartbeat
    std::filesystem::path m_root, m_output;
    std::thread m_writer;
    std::condition_variable_any m_wake;
    bool m_writerBusy = false;
    std::string m_fileError;
};
void RegisterMethods(Dispatcher&, Service&, bool hooks, std::function<uint64_t()> world,
                     std::function<uint64_t()> connection, std::function<std::string()> session, std::function<void()> guard);
}
