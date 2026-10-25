#include "core/Supervisor.hpp"
#include <cmath>
#include <regex>
#include "core/Recording.hpp"

namespace xfb::supervisor
{
namespace
{
// Process-unique receipt identity, including between recording runs and entry replacements.
std::atomic<uint64_t> receiptSequence{0};
void Keys(const json& p, std::initializer_list<const char*> keys)
{
    if (!p.is_object()) throw MethodError("bad_params", "Supervisor data must be an object");
    for (const auto& [k, v] : p.items()) {
        bool known = false; for (auto key : keys) known |= k == key;
        if (!known) throw MethodError("bad_params", "Unknown supervisor field: " + k);
    }
}
double Number(const json& p, const char* key, double fallback, double low, double high)
{
    if (!p.contains(key)) return fallback;
    const auto& v = p.at(key);
    if (!v.is_number() || !std::isfinite(v.get<double>()) || v.get<double>() < low || v.get<double>() > high)
        throw MethodError("bad_params", std::string("Invalid supervisor number: ") + key);
    return v.get<double>();
}
Point Position(const json& p)
{
    if (!p.is_array() || p.size() != 3) throw MethodError("bad_params", "Expected a three-number world point");
    Point out{};
    for (size_t i = 0; i < 3; ++i) {
        if (!p[i].is_number() || !std::isfinite(p[i].get<double>()) || std::abs(p[i].get<double>()) > 100000)
            throw MethodError("bad_params", "Invalid world coordinate");
        out[i] = p[i].get<double>();
    }
    return out;
}
const std::set<std::string> invariants{"not_in_combat", "no_contact", "not_on_road", "alive"};
const std::set<std::string> actions{"stop_behaviours", "release_holds", "withdraw_nearby", "return_last_safe", "pause_world", "handover"};
}
double Distance(const Point& a, const Point& b) { return std::hypot(std::hypot(a[0]-b[0], a[1]-b[1]), a[2]-b[2]); }
Entry ParseImpl(const json& p)
{
    Keys(p, {"schema", "actor", "goal", "invariants", "policy", "tick_hz", "safe_after_s"});
    if (p.value("schema", std::string()) != "xfb/supervisor-entry-1") throw MethodError("bad_params", "Expected xfb/supervisor-entry-1");
    const auto& a = p.at("actor"); Keys(a, {"kind", "ref"});
    Entry e; e.actor = {a.at("kind").get<std::string>(), a.at("ref").get<std::string>()};
    // The V reference is case-insensitive ("V" or "v"); the entry and its receipts always carry the canonical "V".
    // NPC handles are lower case ("a1"); "A1" is the same handle.
    if (e.actor.kind == "player" && e.actor.ref == "v") e.actor.ref = "V";
    if (e.actor.kind == "npc" && e.actor.ref.size() > 1 && (e.actor.ref[0] == 'A' || e.actor.ref[0] == 'P')) e.actor.ref[0] = static_cast<char>(e.actor.ref[0] + 32);
    const auto& kind = e.actor.kind; const auto& ref = e.actor.ref;
    if (!((kind == "player" && ref == "V") || (kind == "npc" && std::regex_match(ref, std::regex("[ap][0-9]{1,15}"))) ||
          (kind == "spawn" && std::regex_match(ref, std::regex("[1-9][0-9]{0,8}")))))
        throw MethodError("bad_params", "Actor must identify V, a returned NPC handle or a spawned object handle");
    const auto& g = p.at("goal"); Keys(g, {"kind", "at", "radius_m", "facing"});
    e.goal.kind = g.at("kind").get<std::string>();
    if (e.goal.kind == "hold_position") {
        e.goal.at = Position(g.at("at")); e.goal.radius = Number(g, "radius_m", 1, .2, 10);
        if (g.contains("facing")) e.goal.facing = Number(g, "facing", 0, -360, 360);
    } else if (e.goal.kind != "idle_safe" || g.size() != 1) throw MethodError("bad_params", "Invalid supervisor goal");
    const auto& inv = p.at("invariants");
    if (!inv.is_array() || inv.size() > 4) throw MethodError("bad_params", "Choose at most four invariants");
    for (const auto& v : inv) {
        if (!v.is_string() || !invariants.count(v.get<std::string>()) || !e.invariants.insert(v.get<std::string>()).second)
            throw MethodError("bad_params", "Unknown or duplicate invariant");
    }
    const auto& policy = p.at("policy");
    if (!policy.is_object() || policy.size() > 5) throw MethodError("bad_params", "Expected violation-to-action policy");
    for (const auto& [v, action] : policy.items()) {
        if ((!e.invariants.count(v) && !(v == "goal" && e.goal.kind == "hold_position")) || !action.is_string() || !actions.count(action.get<std::string>()))
            throw MethodError("bad_params", "Policy must select a fixed action for an enabled violation");
        e.policy[v] = action.get<std::string>();
    }
    for (const auto& v : e.invariants) if (!e.policy.count(v)) throw MethodError("bad_params", "Each invariant needs a policy");
    if (e.goal.kind == "hold_position" && !e.policy.count("goal")) throw MethodError("bad_params", "hold_position needs a goal policy");
    e.tickHz = Number(p, "tick_hz", 3, 1, 5); e.quietS = Number(p, "safe_after_s", 3, 1, 30); e.plain = p;
    return e;
}
Entry Parse(const json& p)
{
    try { return ParseImpl(p); }
    catch (const json::exception&) { throw MethodError("bad_params", "Missing or wrongly typed supervisor field"); }
}
Observation ReadObservation(const json& j)
{
    Observation o;
    if (!j.value("valid", false)) return o;
    o.position = Position(j.at("position")); o.yaw = j.at("yaw").get<double>();
    const auto& v = j.at("vitals");
    o.combat = v.at("in_combat").get<bool>(); o.dead = v.at("dead").get<bool>();
    o.phase = j.at("phase").get<std::string>(); o.paused = j.value("world_frozen", false);
    o.entity = j.at("entity").get<std::string>(); o.input = j.value("input", std::string());
    o.road = j.value("road", std::string("unknown"));
    o.valid = !o.entity.empty() && std::isfinite(o.yaw); return o;
}
uint32_t RequiredWriteClasses(const Entry& entry)
{
    uint32_t mask = WriteClassBit(Access::WritePlayer);
    for (const auto& [violation, action] : entry.policy) {
        if (action == "pause_world") mask |= WriteClassBit(Access::WriteWorld);
        if (action == "withdraw_nearby") mask |= WriteClassBit(Access::WriteNpc) | WriteClassBit(Access::WriteDm);
    }
    return mask;
}
uint32_t RequireCapabilities(const Entry& entry, std::optional<uint32_t> caller)
{
    const auto required = RequiredWriteClasses(entry);
    if (!caller || (*caller & required) != required)
        throw MethodError("permission_denied", "Supervisor arming needs explicit caller capabilities for every selected policy");
    return *caller;
}
json CallerClasses(uint32_t mask)
{
    json result = json::array();
    for (auto access : {Access::WritePhoto, Access::WriteWorld, Access::WriteCharacter, Access::WriteInventory, Access::WriteSave,
                        Access::WriteShowroom, Access::WritePlayer, Access::ActPlayer, Access::WriteNpc, Access::WriteDm})
        if (mask & WriteClassBit(access)) result.push_back(ConfigClassName(access));
    return result;
}
void Service::EmitLocked(const std::string& event, json data) const
{
    data["schema"] = "xfb/supervisor-event-1"; data["generation"] = m_generation;
    data["actor"] = {{"kind", m_entry.actor.kind}, {"ref", m_entry.actor.ref}};
    data["world_generation"] = m_world;
    data["connection"] = m_connection;
    data["receipt_seq"] = receiptSequence.fetch_add(1) + 1;
    data["source_s"] = recording::Now(); // creation time survives delayed sink flushes / recording starts
    // Bounded pending ingress, drained after each public plugin operation.
    if (m_events.size() < 256) m_events.emplace_back(event, std::move(data));
    else { ++m_dropped; ++m_pendingDrops; }
}
json Service::StateLocked() const
{
    return {{"schema", "xfb/supervisor-state-1"}, {"active", m_active}, {"generation", m_generation},
        {"entry", m_entry.plain}, {"reason", m_reason}, {"world_generation", m_world}, {"connection", m_connection},
        {"last_evaluated_s", m_last}, {"last_safe", m_safe}, {"contact_receipts", m_contact}, {"violations", m_violations}, {"event_drops", m_dropped},
        {"traffic_risk", "unknown"}, {"notes", {"Road containment INCONCLUSIVE; unknown causes no intervention", "Last safe means observed quiet under partial contact coverage, never no-contact proof"}},
        {"coverage", {{"continuous_contact", false}, {"no_contact_proof", false}, {"input", "mapped movement/camera/buttons; Codeware raw mouse/stick axes when present; no complete hardware coverage"}}}};
}
json Service::State() const { std::scoped_lock lock(m_mutex); return StateLocked(); }
bool Service::Active() const { std::scoped_lock lock(m_mutex); return m_active; }
bool Service::Due(double now) const { std::scoped_lock lock(m_mutex); return m_active && now >= m_next; }
json Service::Set(const json& p, const Observation& o, double now, uint64_t world, uint64_t connection, std::optional<uint64_t> expected, uint32_t callerWriteClasses)
{
    auto entry = Parse(p);
    if (entry.actor.kind != "player") throw MethodError("actor_unavailable", "This slice commissions V only; NPC and spawn references are reserved adapters");
    if (!o.valid || o.dead || o.phase != "gameplay" || o.paused || !o.input.empty()) throw MethodError("supervisor_unavailable", "V must be alive, observed, in unpaused gameplay without player takeover");
    std::scoped_lock lock(m_mutex);
    if (expected && *expected != m_generation) throw MethodError("interrupted", "Supervisor was cleared while set awaited the game frame");
    if (m_active) ClearLocked("replaced");
    m_entry = std::move(entry); ++m_generation; m_active = true; m_reason = "running";
    m_callerWriteClasses = callerWriteClasses;
    m_entity = o.entity; m_world = world; m_connection = connection; m_next = now; m_last = now;
    m_seenContact = m_contact; m_safe = nullptr; m_candidateKnown = false; m_violations.clear();
    EmitLocked("supervisor.set", {{"at_s", now}, {"traffic_risk", "unknown"}});
    return StateLocked();
}
void Service::ClearLocked(const std::string& why)
{
    const bool was = m_active;
    m_active = false; ++m_generation; m_reason = why; m_safe = nullptr; m_candidateKnown = false;
    if (was) EmitLocked("supervisor.cleared", {{"reason", why}});
}
json Service::Clear(const std::string& why) { std::scoped_lock lock(m_mutex); ClearLocked(why); return StateLocked(); }
void Service::Input(const std::string& action) { std::scoped_lock lock(m_mutex); ClearLocked("player_input:" + action); }
void Service::Contact(const json& event, double now)
{
    const auto name = event.value("event", std::string());
    if (name.rfind("contact.", 0) != 0 || name == "contact.coverage") return;
    std::scoped_lock lock(m_mutex);
    if (!m_active) return;
    ++m_contact; m_candidateKnown = false;
    EmitLocked("supervisor.contact", {{"at_s", now}, {"receipt", event}, {"contact_seq", m_contact}});
}
bool Service::Violated(const std::string& v, const Observation& o) const
{
    if (v == "not_in_combat") return o.combat;
    if (v == "alive") return o.dead;
    if (v == "not_on_road") return o.road == "road";
    if (v == "no_contact") return m_contact > m_seenContact;
    if (v == "goal") return Distance(o.position, m_entry.goal.at) > m_entry.goal.radius ||
        (m_entry.goal.facing && std::abs(std::remainder(o.yaw - *m_entry.goal.facing, 360.0)) > 15);
    return false;
}
std::vector<Work> Service::Tick(const Observation& o, double now, uint64_t world, uint64_t connection)
{
    std::scoped_lock lock(m_mutex); std::vector<Work> work;
    if (!m_active) return work;
    if (world != m_world || connection != m_connection || !o.valid || o.entity != m_entity || o.phase != "gameplay" || o.paused || !o.input.empty()) {
        ClearLocked(!o.input.empty() ? "player_input:" + o.input : "owner_or_game_changed"); return work;
    }
    if (now < m_next) return work;
    // Never burst after a stalled game tick. A gap cannot commission quiet dwell time.
    if (now - m_last > 2.0 / m_entry.tickHz) m_candidateKnown = false;
    m_last = now; m_next = now + 1.0 / m_entry.tickHz;
    if (!o.combat && !o.dead && o.road != "road" && (m_entry.goal.kind != "hold_position" || !Violated("goal", o)) && m_contact == m_seenContact) {
        if (!m_candidateKnown || Distance(o.position, m_candidate) > .15) { m_candidate = o.position; m_quietAt = now; m_candidateKnown = true; }
        if (now - m_quietAt >= m_entry.quietS && (m_safe.is_null() || Distance(o.position, m_safe.at("at").get<Point>()) > .15)) {
            m_safe = {{"at", m_candidate}, {"yaw", o.yaw}, {"observed_at_s", now}, {"quiet_s", now - m_quietAt}, {"traffic_risk", o.road}, {"no_contact_proof", false}};
            EmitLocked("supervisor.safe_position", m_safe);
        }
    } else m_candidateKnown = false;
    std::set<std::string> current;
    for (const auto& [violation, action] : m_entry.policy) {
        if (!Violated(violation, o)) continue;
        current.insert(violation);
        // Contacts are receipts, not a continuous boolean: each new receipt batch is an edge.
        if (m_violations.count(violation) && violation != "no_contact") continue;
        Work w{m_generation, ++m_incident, m_contact, violation, action, m_safe};
        w.callerWriteClasses = m_callerWriteClasses;
        EmitLocked("supervisor.violation", {{"at_s", now}, {"incident", w.incident}, {"violation", violation}, {"policy", action}, {"position", o.position}});
        work.push_back(std::move(w));
    }
    m_violations = std::move(current); m_seenContact = m_contact;
    return work;
}
void Service::Require(const Work& w, const Observation& o, double now, uint64_t world, uint64_t connection, bool changing) const
{
    std::scoped_lock lock(m_mutex);
    if (!m_active || w.generation != m_generation || world != m_world || connection != m_connection ||
        !o.valid || o.entity != m_entity || o.phase != "gameplay" || o.paused || !o.input.empty() || now - m_last > 2.0 / m_entry.tickHz)
        throw MethodError("precondition_failed", "Supervisor owner, input, world or fresh observation changed");
    if (!changing) return; // settlement observes the result; it cannot re-apply the policy
    if (w.violation == "no_contact" ? m_contact < w.contact : !Violated(w.violation, o))
        throw MethodError("precondition_failed", "Supervisor violation no longer observed on the executing frame");
    if (w.action == "return_last_safe" && (w.safe.is_null() || o.dead || o.combat))
        throw MethodError("precondition_failed", "No recorded quiet position, or V is dead/in combat");
}
void Service::Result(const Work& w, const std::string& method, const json& response)
{
    std::scoped_lock lock(m_mutex);
    EmitLocked("supervisor.action", {{"entry_generation", w.generation}, {"incident", w.incident}, {"violation", w.violation}, {"action", w.action}, {"method", method}, {"response", response}});
}
void Service::Flush()
{
    std::scoped_lock flushLock(m_flushMutex);
    std::vector<std::pair<std::string, json>> events;
    { std::scoped_lock lock(m_mutex); events.swap(m_events);
      if (m_pendingDrops) { events.emplace_back("supervisor.gap", json{{"event", "supervisor.gap"}, {"source_s", recording::Now()}, {"receipt_seq", receiptSequence.fetch_add(1) + 1}, {"dropped", m_pendingDrops}, {"generation", m_generation}, {"world_generation", m_world}}); m_pendingDrops = 0; }
    }
    if (m_emit) for (const auto& [event, data] : events) m_emit(event, data);
}
}
