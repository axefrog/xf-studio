#pragma once
// Passive, bounded feed. Producers never wait for a reader; counters cover rate and contention loss.
#include <array>
#include <atomic>
#include <deque>
#include <mutex>
#include <optional>
#include "core/Dispatcher.hpp"
namespace xfb::worldevents {
inline constexpr std::array<const char*, 12> Kinds{"session", "death", "combat", "heat", "dialogue", "journal", "fact", "call", "district", "vehicle", "vehicle.acquired", "time"};
// One synchronous callback's receipt, consumed once; no growing index or heuristic match.
class IncidentReceipt {
public:
    void Clear() { m_token.clear(); m_incident.clear(); }
    void Set(const std::string& token, const std::string& incident, uint64_t world = 0) {
        Clear(); if (!token.empty() && token.size() <= 32 && incident.size() <= 64) { m_token = token; m_incident = incident; m_world = world; }
    }
    std::string Take(const std::string& token, uint64_t world = 0) {
        auto value = !token.empty() && token == m_token && world == m_world ? m_incident : std::string(); Clear(); return value;
    }
private:
    std::string m_token, m_incident;
    uint64_t m_world = 0;
};
struct Epoch { uint64_t world = 0, session = 0; };
// Game-thread adapter owns one detector. Consumes existing V samples, never reads or polls the game.
class ClockJumps {
public:
    std::optional<nlohmann::json> Observe(const nlohmann::json& sample, double source, Epoch epoch, uint64_t run);
private:
    bool m_valid = false;
    double m_source = 0, m_game = 0;
    Epoch m_epoch;
    uint64_t m_run = 0;
};
class Feed {
public:
    explicit Feed(size_t capacity = 2048, unsigned rate = 20);
    // Linearize the native world read and session transition together, before deferred ring work.
    // This short producer-only lock is independent of readers and the ring's try-lock.
    Epoch CaptureEpoch(const std::string& kind, const nlohmann::json& data, const std::function<uint64_t()>& world);
    std::optional<nlohmann::json> Push(const std::string& kind, nlohmann::json data, double s, Epoch epoch, bool admitted = false);
    bool Admit(const std::string& kind, double s);
    void NoteDrop(const std::string& kind);
    nlohmann::json Read(const nlohmann::json& params) const;
private:
    mutable std::mutex m_mutex;
    std::deque<nlohmann::json> m_rows;
    struct Budget { double second = -1; unsigned count = 0; std::atomic<uint64_t> pending{0}, total{0}; };
    std::array<Budget, Kinds.size()> m_budget;
    size_t m_capacity;
    unsigned m_rate;
    uint64_t m_next = 1, m_evicted = 0;
    std::mutex m_epochMutex;
    uint64_t m_session = 0;
    std::atomic<int> m_codeware{-1};
};
void Register(Dispatcher&, Feed&);
}
