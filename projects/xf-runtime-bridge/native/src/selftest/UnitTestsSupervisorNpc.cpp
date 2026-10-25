// Unit checks for bridge 0.8.19's supervisor NPC actors (core/Supervisor.cpp): an XF actor's entry (hold_position, idle_safe, the
// alive, not_in_combat and not_lost invariants, the release, return_last_safe, handover and pause_world policies), the
// actor-keyed collection (V plus four actors, or five actors), per-actor evaluation and cancellation, and the adapter's reading.
// Runs with `xfb_selftest --unit-supervisor` and as part of `--unit`.
#include "core/Supervisor.hpp"
#include <cstdio>

namespace
{
using namespace xfb;
using namespace xfb::supervisor;
int checks = 0, failures = 0;
void Check(bool ok, const char* label) { ++checks; if (!ok) { ++failures; std::printf("SUPERVISOR NPC FAIL %s\n", label); } }
template<class F> void Refuses(F fn, const char* code, const char* label)
{
    try { fn(); Check(false, label); } catch (const MethodError& e) { Check(e.code == code, label); }
}
Observation V() { Observation o; o.valid = true; o.entity = "V-entity"; o.phase = "gameplay"; return o; }
json PlayerEntry()
{
    return {{"schema", "xfb/supervisor-entry-1"}, {"actor", {{"kind", "player"}, {"ref", "V"}}},
        {"goal", {{"kind", "hold_position"}, {"at", {0, 0, 0}}, {"radius_m", 1}}},
        {"invariants", {"not_in_combat", "no_contact", "not_on_road", "alive"}},
        {"policy", {{"goal", "return_last_safe"}, {"not_in_combat", "pause_world"}, {"no_contact", "return_last_safe"}, {"not_on_road", "handover"}, {"alive", "handover"}}}};
}
json NpcEntry(const std::string& ref)
{
    return {{"schema", "xfb/supervisor-entry-1"}, {"actor", {{"kind", "npc"}, {"ref", ref}}},
        {"goal", {{"kind", "hold_position"}, {"at", {10, 20, 0}}, {"radius_m", 1}}},
        {"invariants", {"alive", "not_in_combat", "not_lost"}},
        {"policy", {{"goal", "return_last_safe"}, {"alive", "release"}, {"not_in_combat", "pause_world"}, {"not_lost", "release"}}}};
}
Observation Npc(const std::string& ref, Point at, bool lost = false)
{
    json item{{"who", ref}, {"valid", !lost}, {"streamed", !lost}, {"entity", "E-" + ref}, {"position", {at[0], at[1], at[2]}}, {"yaw", 0.0}, {"dead", false}, {"in_combat", false}};
    return ReadNpcObservation(item, V());
}
}
int SupervisorNpcUnitTests()
{
    checks = failures = 0;
    const auto npcBit = WriteClassBit(Access::WriteNpc), playerBit = WriteClassBit(Access::WritePlayer), worldBit = WriteClassBit(Access::WriteWorld);
    const auto e = NpcEntry("a2");
    Check(Parse(e).actor.Key() == "npc:a2" && Parse(NpcEntry("A2")).actor.ref == "a2", "an XF actor's entry parses, its key is kind:ref");
    Check(Parse(NpcEntry("p2")).actor.kind == "npc", "a picked passer-by's reference parses (and is never armed, below)");
    for (const char* invariant : {"no_contact", "not_on_road"}) {
        auto b = e; b["invariants"] = {invariant}; b["policy"] = {{invariant, "release"}}; b["goal"] = {{"kind", "idle_safe"}};
        Refuses([&] { Parse(b); }, "bad_params", "V's invariants are not an actor's");
    }
    for (const char* action : {"stop_behaviours", "release_holds", "withdraw_nearby"}) {
        auto b = e; b["policy"]["alive"] = action;
        Refuses([&] { Parse(b); }, "bad_params", "V's policies are not an actor's");
    }
    { auto b = PlayerEntry(); b["policy"]["alive"] = "release"; Refuses([&] { Parse(b); }, "bad_params", "release is an actor's policy, not V's"); }
    { auto b = PlayerEntry(); b["invariants"] = {"alive", "not_lost"}; b["policy"] = {{"alive", "handover"}, {"not_lost", "handover"}}; b["goal"] = {{"kind", "idle_safe"}}; Refuses([&] { Parse(b); }, "bad_params", "not_lost is an actor's invariant, not V's"); }
    { auto b = e; b["goal"] = {{"kind", "idle_safe"}}; b["policy"].erase("goal"); Check(Parse(b).goal.kind == "idle_safe", "an actor takes idle_safe too"); }
    Check(RequiredWriteClasses(Parse(e)) == (npcBit | worldBit), "an actor's entry needs the NPC class (and world for pause), not the player class");
    Refuses([&] { RequireCapabilities(Parse(e), playerBit | worldBit); }, "permission_denied", "the player class does not arm an actor's entry");
    Check(RequireCapabilities(Parse(e), npcBit | worldBit) == (npcBit | worldBit), "the actor entry's caller grant is the NPC class");

    Service bank;
    Refuses([&] { bank.Set(e, V(), 0, 1, 7, {}, npcBit | worldBit); }, "supervisor_unavailable", "V's reading is not the actor's");
    Refuses([&] { bank.Set(e, Npc("a2", {10, 20, 0}, true), 0, 1, 7, {}, npcBit | worldBit); }, "supervisor_unavailable", "a lost actor can't be armed");
    Refuses([&] { bank.Set(NpcEntry("p2"), Npc("p2", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit); }, "actor_unavailable", "a picked passer-by is never armed");
    bank.Set(e, Npc("a2", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
    Check(bank.Active("npc:a2") && !bank.Active("player:V") && bank.State("npc:a2")["entry"]["actor"]["ref"] == "a2", "an actor's entry is armed under its own key");
    // V and four more: five entries; a sixth is refused; replacing one at the limit is fine.
    bank.Set(PlayerEntry(), V(), 0, 1, 7, {}, playerBit | worldBit | WriteClassBit(Access::WriteNpc) | WriteClassBit(Access::WriteDm));
    for (const char* ref : {"a3", "a4", "a5"}) bank.Set(NpcEntry(ref), Npc(ref, {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
    Check(bank.ActiveKeys().size() == kMaxEntries && kMaxEntries == 5 && bank.StateAll()["count"] == 5 && bank.StateAll()["limit"] == 5, "V plus four actors fill the five entries");
    Refuses([&] { bank.Set(NpcEntry("a6"), Npc("a6", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit); }, "supervisor_limit", "a sixth entry is refused");
    bank.Set(NpcEntry("a3"), Npc("a3", {10, 20, 0}), 1, 1, 7, {}, npcBit | worldBit);
    Check(bank.ActiveKeys().size() == 5, "replacing an entry at the limit is allowed");
    bank.Clear("test", "npc:a5");
    Check(!bank.Active("npc:a5") && bank.Active("npc:a4") && bank.Active("player:V") && bank.StateAll()["count"] == 4, "clearing one actor leaves the others");
    bank.Set(NpcEntry("a6"), Npc("a6", {10, 20, 0}), 2, 1, 7, {}, npcBit | worldBit);
    Check(bank.Active("npc:a6"), "a slot freed by a clear is usable");
    const auto before = bank.Generation("npc:a4");
    bank.Clear("all");
    Check(bank.ActiveKeys().empty() && !bank.StateAll()["active"].get<bool>() && bank.Generation("npc:a4") > before, "clearing all ends every entry and cancels their queued work");
    // Five actors and no V.
    {
        Service five;
        for (const char* ref : {"a1", "a2", "a3", "a4", "a5"}) five.Set(NpcEntry(ref), Npc(ref, {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
        Check(five.ActiveKeys().size() == 5, "five actors can be supervised without V");
        Refuses([&] { five.Set(PlayerEntry(), V(), 0, 1, 7, {}, playerBit | worldBit | npcBit | WriteClassBit(Access::WriteDm)); }, "supervisor_limit", "...and then V's entry is the sixth");
    }

    // Per-actor evaluation: a fight, a loss, a death and a departure each select that actor's own policy once.
    Service s;
    s.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
    s.Set(NpcEntry("a3"), Npc("a3", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
    for (int i = 1; i <= 10; ++i) { s.Tick(Npc("a2", {10, 20, 0}), i * .4, 1, 7); s.Tick(Npc("a3", {10, 20, 0}), i * .4, 1, 7); }
    Check(!s.State("npc:a2")["last_safe"].is_null() && s.State("npc:a2")["last_safe"]["quiet_s"].get<double>() >= 3, "an actor's quiet anchor matures like V's");
    auto fighting = Npc("a2", {10, 20, 0}); fighting.combat = true;
    const auto fight = s.Tick(fighting, 4.4, 1, 7);
    Check(fight.size() == 1 && fight[0].actor == "npc:a2" && fight[0].violation == "not_in_combat" && fight[0].action == "pause_world", "a fight selects the actor's policy and names the actor");
    s.Require(fight[0], fighting, 4.4, 1, 7);
    Check(s.Tick(Npc("a3", {10, 20, 0}), 4.4, 1, 7).empty() && s.State("npc:a3")["violations"].empty(), "another actor is not affected by it");
    Check(s.Tick(fighting, 4.8, 1, 7).empty(), "a persistent fight does not repeat the action");
    Refuses([&] { s.Require(fight[0], Npc("a2", {10, 20, 0}), 4.8, 1, 7); }, "precondition_failed", "a fight that ended is not acted on at the executing frame");
    auto moved = Npc("a3", {14, 20, 0});
    const auto drift = s.Tick(moved, 4.8, 1, 7);
    Check(drift.size() == 1 && drift[0].violation == "goal" && drift[0].action == "return_last_safe" && !drift[0].safe.is_null(), "leaving the hold radius returns to the observed quiet point");
    s.Require(drift[0], moved, 4.8, 1, 7);
    auto dead = Npc("a2", {10, 20, 0}); dead.dead = true;
    const auto death = s.Tick(dead, 5.2, 1, 7);
    Check(death.size() == 1 && death[0].violation == "alive" && death[0].action == "release", "a dead actor selects release");
    Refuses([&] { s.Require(death[0], Npc("a2", {10, 20, 0}), 5.2, 1, 7); }, "precondition_failed", "a dead actor that is back is not acted on");
    // Lost.
    auto gone = Npc("a3", {0, 0, 0}, true);
    Check(gone.lost && !gone.valid, "a missing or unstreamed actor reads as lost");
    const auto lost = s.Tick(gone, 5.6, 1, 7);
    Check(lost.size() == 1 && lost[0].violation == "not_lost" && lost[0].action == "release" && s.Active("npc:a3"), "not_lost: a lost actor selects its policy once and the entry survives to act");
    s.Require(lost[0], gone, 5.6, 1, 7);
    Check(s.Tick(gone, 6.0, 1, 7).empty(), "a lost actor does not repeat the action");
    Refuses([&] { s.Require(lost[0], Npc("a3", {10, 20, 0}), 6.0, 1, 7); }, "precondition_failed", "an actor that is back is not released");
    // Return with no anchor refuses on the executing frame.
    {
        Service fresh;
        fresh.Set(NpcEntry("a8"), Npc("a8", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
        const auto far = fresh.Tick(Npc("a8", {14, 20, 0}), 0, 1, 7);
        Check(far.size() == 1 && far[0].action == "return_last_safe" && far[0].safe.is_null(), "a departure before any quiet anchor has nowhere to return to");
        Refuses([&] { fresh.Require(far[0], Npc("a8", {14, 20, 0}), 0, 1, 7); }, "precondition_failed", "so the return refuses on the executing frame");
    }
    // No not_lost invariant: nothing can be observed, supervision ends.
    auto plain = NpcEntry("a7"); plain["invariants"] = {"alive"}; plain["policy"] = {{"goal", "return_last_safe"}, {"alive", "release"}};
    s.Set(plain, Npc("a7", {10, 20, 0}), 7, 1, 7, {}, npcBit);
    s.Tick(Npc("a7", {0, 0, 0}, true), 7.4, 1, 7);
    Check(!s.Active("npc:a7") && s.State("npc:a7")["reason"] == "actor_lost", "without not_lost a lost actor ends its supervision");

    // The owner.
    auto swapped = Npc("a2", {10, 20, 0}); swapped.entity = "E-another";
    Service t;
    t.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
    t.Tick(swapped, 0, 1, 7);
    Check(!t.Active("npc:a2"), "a handle that now names another entity cancels");
    t.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 1, 1, 7, {}, npcBit | worldBit);
    t.Set(PlayerEntry(), V(), 1, 1, 7, {}, playerBit | worldBit | npcBit | WriteClassBit(Access::WriteDm));
    t.Input("raw:IK_MouseX");
    Check(!t.Active("player:V") && t.Active("npc:a2"), "V's input ends V's entry only");
    t.Contact({{"event", "contact.car_hit_player"}}, 1.5);
    Check(t.State("npc:a2")["contact_receipts"] == 0, "contact receipts belong to V's entry");
    t.Tick(Npc("a2", {10, 20, 0}), 2, 2, 7);
    Check(!t.Active("npc:a2"), "a load cancels the actor's entry");
    t.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 3, 3, 7, {}, npcBit | worldBit);
    auto paused = Npc("a2", {10, 20, 0}); paused.paused = true;
    t.Tick(paused, 3, 3, 7);
    Check(!t.Active("npc:a2"), "a world pause cancels the actor's entry");
    t.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 4, 3, 7, {}, npcBit | worldBit);
    t.Tick(Npc("a2", {10, 20, 0}), 4, 3, 8);
    Check(!t.Active("npc:a2"), "a changed connection owner cancels the actor's entry");
    t.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 5, 3, 8, {}, npcBit | worldBit);
    t.Set(NpcEntry("a3"), Npc("a3", {10, 20, 0}), 5, 3, 8, {}, npcBit | worldBit);
    t.Clear("kill");
    Refuses([&] { t.Require(Work{"npc:a2", 1, 1, 0, "alive", "release", nullptr}, Npc("a2", {10, 20, 0}), 5, 3, 8); }, "precondition_failed", "a cleared entry's queued work fails its guard");

    // Receipts name the actor.
    {
        std::vector<json> receipts;
        Service r([&](const std::string& event, const json& data) { auto copy = data; copy["event"] = event; receipts.push_back(copy); });
        r.Set(NpcEntry("a2"), Npc("a2", {10, 20, 0}), 0, 1, 7, {}, npcBit | worldBit);
        auto c = Npc("a2", {10, 20, 0}); c.combat = true;
        const auto w = r.Tick(c, 0, 1, 7);
        r.Result(w.at(0), "world.pause", {{"ok", true}});
        r.Flush();
        bool named = !receipts.empty();
        for (const auto& receipt : receipts) named = named && receipt.at("actor").at("kind") == "npc" && receipt.at("actor").at("ref") == "a2";
        Check(named && receipts.size() >= 3, "set, violation and action receipts name the actor (they feed game.catchup)");
    }

    // Reading the adapter.
    const auto read = ReadNpcObservation(json{{"who", "a2"}, {"valid", true}, {"streamed", true}, {"entity", "E"}, {"position", {1, 2, 3}}, {"yaw", 90.0}, {"dead", false}, {"in_combat", true}}, V());
    Check(read.valid && !read.lost && read.combat && read.actor == "npc:a2" && read.phase == "gameplay" && read.position[1] == 2, "the adapter's reading becomes an observation");
    Check(ReadNpcObservation(json{{"who", "a2"}, {"valid", true}, {"streamed", false}, {"entity", "E"}, {"position", {1, 2, 3}}, {"yaw", 0.0}}, V()).lost, "an actor that is not streamed in is lost");
    Check(ReadNpcObservation(json{{"who", "a2"}, {"valid", false}}, V()).lost, "an actor the registry cannot resolve is lost");
    Check(Observation{}.actor == "player:V", "an observation is V's unless it names an actor");
    Check(t.StateAll()["schema"] == "xfb/supervisor-state-2" && t.State("npc:a99")["active"] == false, "state reads one actor or all; an unknown actor is inactive");
    std::printf("SUPERVISOR NPC UNIT: %d checks, %d failures\n", checks, failures);
    return failures;
}
