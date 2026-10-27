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
// What each kind of actor may select. V's sets are the 0.8.15 ones; an XF actor takes alive, not_in_combat and (0.8.19) not_lost,
// and four policies: release (npc.release, despawn), return_last_safe (npc.place), handover and pause_world. spawn parses with
// the union, and is refused when armed.
const std::set<std::string> playerInvariants{"not_in_combat", "no_contact", "not_on_road", "alive"};
const std::set<std::string> npcInvariants{"not_in_combat", "alive", "not_lost"};
const std::set<std::string> playerActions{"stop_behaviours", "release_holds", "withdraw_nearby", "return_last_safe", "pause_world", "handover"};
const std::set<std::string> npcActions{"release", "return_last_safe", "pause_world", "handover"};
bool KnownInvariant(const std::string& kind, const std::string& name)
{
    if (kind == "player") return playerInvariants.count(name) > 0;
    if (kind == "npc") return npcInvariants.count(name) > 0;
    return playerInvariants.count(name) > 0 || npcInvariants.count(name) > 0;
}
bool KnownAction(const std::string& kind, const std::string& name)
{
    if (kind == "player") return playerActions.count(name) > 0;
    if (kind == "npc") return npcActions.count(name) > 0;
    return playerActions.count(name) > 0 || npcActions.count(name) > 0;
}
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
        if (!v.is_string() || !KnownInvariant(kind, v.get<std::string>()) || !e.invariants.insert(v.get<std::string>()).second)
            throw MethodError("bad_params", "Unknown or duplicate invariant");
    }
    const auto& policy = p.at("policy");
    if (!policy.is_object() || policy.size() > 5) throw MethodError("bad_params", "Expected violation-to-action policy");
    for (const auto& [v, action] : policy.items()) {
        if ((!e.invariants.count(v) && !(v == "goal" && e.goal.kind == "hold_position")) || !action.is_string() || !KnownAction(kind, action.get<std::string>()))
            throw MethodError("bad_params", "Policy must select a fixed action for an enabled violation");
        e.policy[v] = action.get<std::string>();
    }
    for (const auto& v : e.invariants) if (!e.policy.count(v)) throw MethodError("bad_params", "Each invariant needs a policy");
    if (e.goal.kind == "hold_position" && !e.policy.count("goal")) throw MethodError("bad_params", "hold_position needs a goal policy");
    e.tickHz = Number(p, "tick_hz", 3, 1, 5); e.quietS = Number(p, "safe_after_s", 3, 1, 30); e.plain = p;
    e.plain["actor"]["ref"] = e.actor.ref; // state shows the canonical reference, as the receipts do
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
    o.actor = "player:V";
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
    // V's entry needs the player class; an XF actor's own actions (place, release) are NPC writes.
    uint32_t mask = WriteClassBit(entry.actor.kind == "npc" ? Access::WriteNpc : Access::WritePlayer);
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
Observation ReadNpcObservation(const json& item, const Observation& global)
{
    Observation o;
    o.actor = "npc:" + item.value("who", std::string());
    o.phase = global.phase; o.paused = global.paused;
    o.entity = item.value("entity", std::string());
    const bool here = item.value("valid", false) && item.value("streamed", true) && !o.entity.empty() && item.contains("position") && item.contains("yaw");
    if (!here) { o.lost = true; return o; }
    o.position = Position(item.at("position")); o.yaw = item.at("yaw").get<double>();
    o.combat = item.value("in_combat", false); o.dead = item.value("dead", false);
    o.valid = std::isfinite(o.yaw);
    o.lost = !o.valid;
    return o;
}
const Service::Slot* Service::Find(const std::string& key) const { const auto it = m_slots.find(key); return it == m_slots.end() ? nullptr : &it->second; }
Service::Slot* Service::Find(const std::string& key) { const auto it = m_slots.find(key); return it == m_slots.end() ? nullptr : &it->second; }
void Service::EmitLocked(const Slot& s, const std::string& event, json data) const
{
    data["schema"] = "xfb/supervisor-event-1"; data["generation"] = s.generation;
    data["actor"] = {{"kind", s.entry.actor.kind}, {"ref", s.entry.actor.ref}};
    data["world_generation"] = s.world;
    data["connection"] = s.connection;
    data["receipt_seq"] = receiptSequence.fetch_add(1) + 1;
    data["source_s"] = recording::Now(); // creation time survives delayed sink flushes / recording starts
    // Bounded pending ingress, drained after each public plugin operation.
    if (m_events.size() < 256) m_events.emplace_back(event, std::move(data));
    else { ++m_dropped; ++m_pendingDrops; }
}
json Service::StateLocked(const Slot& s) const
{
    return {{"schema", "xfb/supervisor-state-1"}, {"active", s.active}, {"generation", s.generation + m_epoch},
        {"entry", s.entry.plain}, {"reason", s.reason}, {"world_generation", s.world}, {"connection", s.connection},
        {"last_evaluated_s", s.last}, {"last_safe", s.safe}, {"contact_receipts", s.contact}, {"violations", s.violations}, {"event_drops", m_dropped},
        {"traffic_risk", "unknown"}, {"notes", {"Road containment INCONCLUSIVE; unknown causes no intervention", "Last safe means observed quiet under partial contact coverage, never no-contact proof"}},
        {"coverage", {{"continuous_contact", false}, {"no_contact_proof", false}, {"input", "mapped movement/camera/buttons; Codeware raw mouse/stick axes when present; no complete hardware coverage"}}}};
}
json Service::State() const { return State("player:V"); }
json Service::State(const std::string& key) const
{
    std::scoped_lock lock(m_mutex);
    if (const auto* s = Find(key)) return StateLocked(*s);
    Slot none; // an entry never set: inactive, generation 0
    return StateLocked(none);
}
json Service::StateAll() const
{
    std::scoped_lock lock(m_mutex);
    json entries = json::array(); size_t active = 0;
    for (const auto& [key, s] : m_slots) if (s.active) { entries.push_back(StateLocked(s)); ++active; }
    return {{"schema", "xfb/supervisor-state-2"}, {"active", active > 0}, {"count", active}, {"limit", kMaxEntries}, {"entries", entries}, {"event_drops", m_dropped}};
}
json Service::SnapshotHolds(uint64_t world) const
{
    std::unique_lock lock(m_mutex,std::try_to_lock);if(!lock.owns_lock())return nullptr;json out=json::array();
    for(const auto& [key,s]:m_slots)if(s.active&&s.world==world)out.push_back({{"id",key},{"kind",s.entry.goal.kind},
      {"radius_m",s.entry.goal.kind=="hold_position"?json(s.entry.goal.radius):json(nullptr)},{"pos",s.entry.goal.kind=="hold_position"?json(s.entry.goal.at):json(nullptr)}});
    return out;
}
bool Service::Active() const { std::scoped_lock lock(m_mutex); for (const auto& [key, s] : m_slots) if (s.active) return true; return false; }
bool Service::Active(const std::string& key) const { std::scoped_lock lock(m_mutex); const auto* s = Find(key); return s && s->active; }
bool Service::Due(double now) const { std::scoped_lock lock(m_mutex); for (const auto& [key, s] : m_slots) if (s.active && now >= s.next) return true; return false; }
bool Service::Due(const std::string& key, double now) const { std::scoped_lock lock(m_mutex); const auto* s = Find(key); return s && s->active && now >= s->next; }
std::vector<std::string> Service::ActiveKeys() const
{
    std::scoped_lock lock(m_mutex); std::vector<std::string> keys;
    for (const auto& [key, s] : m_slots) if (s.active) keys.push_back(key);
    return keys;
}
uint64_t Service::Generation(const std::string& key) const { std::scoped_lock lock(m_mutex); const auto* s = Find(key); return m_epoch + (s ? s->generation : 0); }
json Service::Set(const json& p, const Observation& o, double now, uint64_t world, uint64_t connection, std::optional<uint64_t> expected, uint32_t callerWriteClasses)
{
    auto entry = Parse(p);
    const auto key = entry.actor.Key();
    if (entry.actor.kind == "spawn") throw MethodError("actor_unavailable", "Spawned-object references are a reserved adapter, not commissioned yet");
    if (entry.actor.kind == "npc" && entry.actor.ref[0] != 'a') throw MethodError("actor_unavailable", "Only XF actors (a1, a2, ...) can be supervised, never picked passers-by");
    if (o.actor != key) throw MethodError("supervisor_unavailable", "The reading is for another actor");
    if (entry.actor.kind == "player") {
        if (!o.valid || o.dead || o.phase != "gameplay" || o.paused || !o.input.empty()) throw MethodError("supervisor_unavailable", "V must be alive, observed, in unpaused gameplay without player takeover");
    } else if (!o.valid || o.lost || o.dead || o.phase != "gameplay" || o.paused) {
        throw MethodError("supervisor_unavailable", "The actor must exist, be streamed in and alive, in unpaused gameplay");
    }
    std::scoped_lock lock(m_mutex);
    auto* slot = Find(key);
    if (expected && *expected != m_epoch + (slot ? slot->generation : 0)) throw MethodError("interrupted", "Supervisor was cleared while set awaited the game frame");
    if (!slot || !slot->active) {
        size_t active = 0; for (const auto& [k, s] : m_slots) if (s.active) ++active;
        if (active >= kMaxEntries) throw MethodError("supervisor_limit", "The supervisor already holds " + std::to_string(kMaxEntries) + " entries (supervisor_clear one first)");
    }
    if (!slot) {
        // Inactive slots only keep their generation counter; drop the oldest ones so handles that will never return do not pile up.
        for (auto it = m_slots.begin(); it != m_slots.end() && m_slots.size() >= 16;) it = !it->second.active && it->first != "player:V" ? m_slots.erase(it) : std::next(it);
        slot = &m_slots[key];
    }
    if (slot->active) ClearLocked(*slot, "replaced");
    slot->entry = std::move(entry); ++slot->generation; slot->active = true; slot->reason = "running";
    slot->callerWriteClasses = callerWriteClasses;
    slot->entity = o.entity; slot->world = world; slot->connection = connection; slot->next = now; slot->last = now;
    slot->seenContact = slot->contact; slot->safe = nullptr; slot->candidateKnown = false; slot->violations.clear();
    EmitLocked(*slot, "supervisor.set", {{"at_s", now}, {"traffic_risk", "unknown"}});
    return StateLocked(*slot);
}
void Service::ClearLocked(Slot& s, const std::string& why)
{
    const bool was = s.active;
    s.active = false; ++s.generation; s.reason = why; s.safe = nullptr; s.candidateKnown = false;
    if (was) EmitLocked(s, "supervisor.cleared", {{"reason", why}});
}
json Service::Clear(const std::string& why)
{
    std::scoped_lock lock(m_mutex);
    ++m_epoch;
    for (auto& [key, s] : m_slots) if (s.active) ClearLocked(s, why);
    if (const auto* v = Find("player:V")) return StateLocked(*v);
    Slot none; return StateLocked(none);
}
json Service::Clear(const std::string& why, const std::string& key)
{
    std::scoped_lock lock(m_mutex);
    auto* s = Find(key);
    if (!s) { // nothing armed: a set for this actor that is still waiting for its frame is cancelled all the same
        s = &m_slots[key];
        const auto colon = key.find(':');
        s->entry.actor = {key.substr(0, colon), colon == std::string::npos ? std::string() : key.substr(colon + 1)};
    }
    ClearLocked(*s, why); return StateLocked(*s);
}
void Service::Input(const std::string& action) { std::scoped_lock lock(m_mutex); if (auto* s = Find("player:V"); s && s->active) ClearLocked(*s, "player_input:" + action); }
void Service::Contact(const json& event, double now)
{
    const auto name = event.value("event", std::string());
    if (name.rfind("contact.", 0) != 0 || name == "contact.coverage") return;
    std::scoped_lock lock(m_mutex);
    auto* s = Find("player:V");
    if (!s || !s->active) return;
    ++s->contact; s->candidateKnown = false;
    EmitLocked(*s, "supervisor.contact", {{"at_s", now}, {"receipt", event}, {"contact_seq", s->contact}});
}
bool Service::Violated(const Slot& s, const std::string& v, const Observation& o)
{
    if (v == "not_in_combat") return o.combat;
    if (v == "alive") return o.dead;
    if (v == "not_lost") return o.lost;
    if (v == "not_on_road") return o.road == "road";
    if (v == "no_contact") return s.contact > s.seenContact;
    if (v == "goal") return Distance(o.position, s.entry.goal.at) > s.entry.goal.radius ||
        (s.entry.goal.facing && std::abs(std::remainder(o.yaw - *s.entry.goal.facing, 360.0)) > 15);
    return false;
}
std::vector<Work> Service::Tick(const Observation& o, double now, uint64_t world, uint64_t connection)
{
    std::scoped_lock lock(m_mutex); std::vector<Work> work;
    auto* sp = Find(o.actor);
    if (!sp || !sp->active) return work;
    auto& s = *sp; const bool npc = s.entry.actor.kind == "npc";
    // A lost XF actor is a violation of not_lost when the entry asks for it; otherwise nothing can be observed and supervision ends.
    const bool lostEdge = npc && o.lost && s.entry.invariants.count("not_lost") > 0;
    if (world != s.world || connection != s.connection || o.phase != "gameplay" || o.paused || (!npc && (!o.valid || o.entity != s.entity || !o.input.empty())) ||
        (npc && !o.lost && (!o.valid || o.entity != s.entity)) || (npc && o.lost && !lostEdge)) {
        ClearLocked(s, !npc && !o.input.empty() ? "player_input:" + o.input : npc && o.lost ? "actor_lost" : "owner_or_game_changed"); return work;
    }
    if (now < s.next) return work;
    // Never burst after a stalled game tick. A gap cannot commission quiet dwell time.
    if (now - s.last > 2.0 / s.entry.tickHz) s.candidateKnown = false;
    s.last = now; s.next = now + 1.0 / s.entry.tickHz;
    if (!o.lost && !o.combat && !o.dead && o.road != "road" && (s.entry.goal.kind != "hold_position" || !Violated(s, "goal", o)) && s.contact == s.seenContact) {
        if (!s.candidateKnown || Distance(o.position, s.candidate) > .15) { s.candidate = o.position; s.quietAt = now; s.candidateKnown = true; }
        if (now - s.quietAt >= s.entry.quietS && (s.safe.is_null() || Distance(o.position, s.safe.at("at").get<Point>()) > .15)) {
            s.safe = {{"at", s.candidate}, {"yaw", o.yaw}, {"observed_at_s", now}, {"quiet_s", now - s.quietAt}, {"traffic_risk", o.road}, {"no_contact_proof", false}};
            EmitLocked(s, "supervisor.safe_position", s.safe);
        }
    } else s.candidateKnown = false;
    std::set<std::string> current;
    for (const auto& [violation, action] : s.entry.policy) {
        // A lost actor has no position, health or combat state to judge: only not_lost is evaluated then.
        if (o.lost && violation != "not_lost") continue;
        if (!Violated(s, violation, o)) continue;
        current.insert(violation);
        // Contacts are receipts, not a continuous boolean: each new receipt batch is an edge.
        if (s.violations.count(violation) && violation != "no_contact") continue;
        Work w{s.entry.actor.Key(), s.generation, ++s.incident, s.contact, violation, action, s.safe};
        w.callerWriteClasses = s.callerWriteClasses;
        EmitLocked(s, "supervisor.violation", {{"at_s", now}, {"incident", w.incident}, {"violation", violation}, {"policy", action}, {"position", o.lost ? json(nullptr) : json(o.position)}});
        work.push_back(std::move(w));
    }
    s.violations = std::move(current); s.seenContact = s.contact;
    return work;
}
void Service::Require(const Work& w, const Observation& o, double now, uint64_t world, uint64_t connection, bool changing) const
{
    std::scoped_lock lock(m_mutex);
    const auto* sp = Find(w.actor);
    if (!sp || !sp->active) throw MethodError("precondition_failed", "Supervisor owner, input, world or fresh observation changed");
    const auto& s = *sp; const bool npc = s.entry.actor.kind == "npc";
    // The one reading a lost actor may act on is the not_lost violation itself (its release has nothing to observe).
    const bool lostOk = npc && o.lost && w.violation == "not_lost";
    if (w.generation != s.generation || world != s.world || connection != s.connection || o.actor != w.actor ||
        (!lostOk && (!o.valid || o.entity != s.entity)) || o.phase != "gameplay" || o.paused || (!npc && !o.input.empty()) || now - s.last > 2.0 / s.entry.tickHz)
        throw MethodError("precondition_failed", "Supervisor owner, input, world or fresh observation changed");
    if (!changing) return; // settlement observes the result; it cannot re-apply the policy
    if (w.violation == "no_contact" ? s.contact < w.contact : !Violated(s, w.violation, o))
        throw MethodError("precondition_failed", "Supervisor violation no longer observed on the executing frame");
    if (w.action == "return_last_safe" && (w.safe.is_null() || o.dead || o.combat || o.lost))
        throw MethodError("precondition_failed", "No recorded quiet position, or the actor is dead, lost or in combat");
}
void Service::Result(const Work& w, const std::string& method, const json& response)
{
    std::scoped_lock lock(m_mutex);
    const auto* s = Find(w.actor);
    Slot none; const auto colon = w.actor.find(':');
    none.entry.actor = {w.actor.substr(0, colon), colon == std::string::npos ? std::string() : w.actor.substr(colon + 1)}; none.generation = w.generation;
    EmitLocked(s ? *s : none, "supervisor.action", {{"entry_generation", w.generation}, {"incident", w.incident}, {"violation", w.violation}, {"action", w.action}, {"method", method}, {"response", response}});
}
void Service::Flush()
{
    std::scoped_lock flushLock(m_flushMutex);
    std::vector<std::pair<std::string, json>> events;
    { std::scoped_lock lock(m_mutex); events.swap(m_events);
      if (m_pendingDrops) {
          uint64_t generation = 0, world = 0; if (const auto* v = Find("player:V")) { generation = v->generation; world = v->world; }
          events.emplace_back("supervisor.gap", json{{"event", "supervisor.gap"}, {"source_s", recording::Now()}, {"receipt_seq", receiptSequence.fetch_add(1) + 1}, {"dropped", m_pendingDrops}, {"generation", generation}, {"world_generation", world}}); m_pendingDrops = 0; }
    }
    if (m_emit) for (const auto& [event, data] : events) m_emit(event, data);
}
}
