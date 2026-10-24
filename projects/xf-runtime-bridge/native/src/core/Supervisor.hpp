#pragma once

// One owner, plain versioned entries and fixed actions. No game objects or executable data.
#include "core/Dispatcher.hpp"
#include <array>
#include <set>
#include <vector>

namespace xfb::supervisor
{
using json = nlohmann::json;
using Point = std::array<double, 3>;
struct Actor { std::string kind, ref; }; // player:V, npc:aN/pN, spawn:N; only player adapter commissioned here
struct Goal { std::string kind; Point at{}; double radius = 1; std::optional<double> facing; };
struct Entry
{
    Actor actor;
    Goal goal;
    std::set<std::string> invariants;
    std::map<std::string, std::string> policy;
    double tickHz = 3, quietS = 3;
    json plain;
};
Entry Parse(const json&);
struct Observation
{
    bool valid = false, combat = false, dead = false, paused = false;
    Point position{};
    double yaw = 0;
    std::string entity, phase, road = "unknown", input;
};
Observation ReadObservation(const json&);
double Distance(const Point&, const Point&);
struct Work
{
    uint64_t generation = 0, incident = 0, contact = 0;
    std::string violation, action;
    json safe = nullptr;
};
class Service
{
public:
    using Emit = std::function<void(const std::string&, const json&)>;
    explicit Service(Emit emit = {}) : m_emit(std::move(emit)) {}
    json Set(const json&, const Observation&, double now, uint64_t world, uint64_t connection, std::optional<uint64_t> expected = {});
    json State() const;
    json Clear(const std::string& reason);
    bool Active() const;
    bool Due(double now) const;
    void Contact(const json&, double now);
    void Input(const std::string&);
    std::vector<Work> Tick(const Observation&, double now, uint64_t world, uint64_t connection);
    // Called again on every executing frame, including later steps of a teleport.
    void Require(const Work&, const Observation&, double now, uint64_t world, uint64_t connection) const;
    void Result(const Work&, const std::string& method, const json& response);
    void Flush(); // invoke sinks outside the owner lock (recorder and worker have their own locks)
private:
    bool Violated(const std::string&, const Observation&) const;
    json StateLocked() const;
    void ClearLocked(const std::string&);
    void EmitLocked(const std::string&, json) const;
    mutable std::mutex m_mutex;
    std::mutex m_flushMutex;
    Emit m_emit;
    Entry m_entry;
    bool m_active = false;
    uint64_t m_generation = 0, m_incident = 0, m_world = 0, m_connection = 0;
    uint64_t m_contact = 0, m_seenContact = 0;
    double m_next = 0, m_last = 0, m_quietAt = 0;
    Point m_candidate{};
    bool m_candidateKnown = false;
    json m_safe = nullptr;
    std::string m_entity, m_reason = "not_set";
    std::set<std::string> m_violations;
    mutable std::vector<std::pair<std::string, json>> m_events;
    mutable uint64_t m_dropped = 0, m_pendingDrops = 0;
};
}
