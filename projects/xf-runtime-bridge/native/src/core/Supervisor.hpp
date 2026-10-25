#pragma once

// One owner, plain versioned entries and fixed actions. No game objects or executable data.
#include "core/Dispatcher.hpp"
#include <array>
#include <map>
#include <optional>
#include <set>
#include <vector>

namespace xfb::supervisor
{
using json = nlohmann::json;
using Point = std::array<double, 3>;
// player:V, npc:aN (an XF actor; a picked passer-by pN parses but is never armed), spawn:N (parses, never armed).
struct Actor { std::string kind, ref; std::string Key() const { return kind + ":" + ref; } };
inline constexpr size_t kMaxEntries = 5; // V plus four NPCs, or five NPCs
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
uint32_t RequiredWriteClasses(const Entry&);
uint32_t RequireCapabilities(const Entry&, std::optional<uint32_t> caller);
json CallerClasses(uint32_t mask);
struct Observation
{
    std::string actor = "player:V"; // which entry this reading is for
    bool lost = false;              // NPC adapters: the actor no longer exists or is not streamed in (valid is false then)
    bool valid = false, combat = false, dead = false, paused = false;
    Point position{};
    double yaw = 0;
    std::string entity, phase, road = "unknown", input;
};
Observation ReadObservation(const json&);
// 0.8.19: one XF actor's reading from the actor adapter ({who, valid, entity, position, yaw, dead, in_combat, streamed}), with
// the global phase and world-freeze taken from aGlobal (V's reading). An actor that is missing or not streamed in is `lost`.
Observation ReadNpcObservation(const json& aItem, const Observation& aGlobal);
double Distance(const Point&, const Point&);
struct Work
{
    std::string actor = "player:V";
    uint64_t generation = 0, incident = 0, contact = 0;
    std::string violation, action;
    json safe = nullptr;
    uint32_t callerWriteClasses = 0;
};
// Actor-keyed bounded collection (kMaxEntries active entries). Every entry has exactly one owner slot; V's slot keeps the 0.8.15
// behaviour and API unchanged (the no-key overloads act on V, or on every entry for Clear/Active/Due).
class Service
{
public:
    using Emit = std::function<void(const std::string&, const json&)>;
    explicit Service(Emit emit = {}) : m_emit(std::move(emit)) {}
    json Set(const json&, const Observation&, double now, uint64_t world, uint64_t connection, std::optional<uint64_t> expected = {}, uint32_t callerWriteClasses = 0);
    json State() const;                       // V's entry (the 0.8.15 shape)
    json State(const std::string& key) const; // one entry, "kind:ref"
    json StateAll() const;                    // every active entry
    json Clear(const std::string& reason);    // every entry
    json Clear(const std::string& reason, const std::string& key);
    bool Active() const;                      // any entry
    bool Active(const std::string& key) const;
    bool Due(double now) const;               // any entry
    bool Due(const std::string& key, double now) const;
    std::vector<std::string> ActiveKeys() const;
    uint64_t Generation(const std::string& key) const;
    void Contact(const json&, double now);    // V's entry only: contact receipts are V's
    void Input(const std::string&);           // V's entry only: V's takeover does not end an NPC's supervision
    std::vector<Work> Tick(const Observation&, double now, uint64_t world, uint64_t connection);
    // Called again on every executing frame, including later steps of a teleport.
    void Require(const Work&, const Observation&, double now, uint64_t world, uint64_t connection, bool changing = true) const;
    void Result(const Work&, const std::string& method, const json& response);
    void Flush(); // invoke sinks outside the owner lock (recorder and worker have their own locks)
private:
    struct Slot
    {
        Entry entry;
        bool active = false;
        uint32_t callerWriteClasses = 0;
        uint64_t generation = 0, incident = 0, world = 0, connection = 0, contact = 0, seenContact = 0;
        double next = 0, last = 0, quietAt = 0;
        Point candidate{};
        bool candidateKnown = false;
        json safe = nullptr;
        std::string entity, reason = "not_set";
        std::set<std::string> violations;
    };
    static bool Violated(const Slot&, const std::string&, const Observation&);
    json StateLocked(const Slot&) const;
    void ClearLocked(Slot&, const std::string&);
    void EmitLocked(const Slot&, const std::string&, json) const;
    const Slot* Find(const std::string& key) const;
    Slot* Find(const std::string& key);
    mutable std::mutex m_mutex;
    std::mutex m_flushMutex;
    Emit m_emit;
    std::map<std::string, Slot> m_slots;
    mutable std::vector<std::pair<std::string, json>> m_events;
    mutable uint64_t m_dropped = 0, m_pendingDrops = 0;
    uint64_t m_epoch = 0; // every clear-all bumps it: a set that was waiting for its frame sees the clear even when its slot never existed
};
}
