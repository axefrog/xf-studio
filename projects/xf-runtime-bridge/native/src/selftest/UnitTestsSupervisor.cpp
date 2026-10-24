#include "core/Supervisor.hpp"
#include <cstdio>
#include <future>
#include <algorithm>
namespace
{
using namespace xfb;
using namespace xfb::supervisor;
int checks = 0, failures = 0;
void Check(bool ok, const char* label) { ++checks; if (!ok) { ++failures; std::printf("SUPERVISOR FAIL %s\n", label); } }
template<class F> void Refuses(F fn, const char* code) { try { fn(); Check(false, code); } catch (const MethodError& e) { Check(e.code == code, code); } }
json EntryData()
{
    return {{"schema", "xfb/supervisor-entry-1"}, {"actor", {{"kind", "player"}, {"ref", "V"}}},
        {"goal", {{"kind", "hold_position"}, {"at", {0, 0, 0}}, {"radius_m", 1}, {"facing", 0}}},
        {"invariants", {"not_in_combat", "no_contact", "not_on_road", "alive"}},
        {"policy", {{"goal", "return_last_safe"}, {"not_in_combat", "pause_world"}, {"no_contact", "return_last_safe"}, {"not_on_road", "handover"}, {"alive", "handover"}}}};
}
Observation V() { Observation o; o.valid = true; o.entity = "V-entity"; o.phase = "gameplay"; return o; }
}
int SupervisorUnitTests()
{
    auto p = EntryData(); auto o = V();
    Check(Parse(p).tickHz == 3 && Parse(p).quietS == 3, "bounded defaults");
    auto bad = p; bad["schema"] = "later"; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["policy"]["no_contact"] = "eval"; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["policy"].erase("alive"); Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["actor"]["ref"] = "anyone"; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["goal"]["at"] = {0, 0}; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["tick_hz"] = 60; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["safe_after_s"] = .1; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["schema"] = 1; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["invariants"] = {"alive", "alive"}; Refuses([&] { Parse(bad); }, "bad_params");
    bad = p; bad["goal"] = {{"kind", "idle_safe"}}; bad["policy"].erase("goal"); Check(Parse(bad).goal.kind == "idle_safe", "idle_safe plain goal");
    bad["actor"] = {{"kind", "npc"}, {"ref", "a2"}}; Check(Parse(bad).actor.kind == "npc", "NPC identity model supported");
    Service s; Refuses([&] { s.Set(bad, o, 0, 1, 1); }, "actor_unavailable");
    bad["actor"] = {{"kind", "spawn"}, {"ref", "12"}}; Check(Parse(bad).actor.kind == "spawn", "vehicle identity model supported");
    Refuses([&] { s.Set(bad, o, 0, 1, 1); }, "actor_unavailable");
    std::vector<json> receipts;
    Service service([&](const std::string& event, const json& data) { auto copy = data; copy["event"] = event; receipts.push_back(copy); });
    service.Set(p, o, 0, 1, 7);
    Check(service.Tick(o, 0, 1, 7).empty() && service.State()["traffic_risk"] == "unknown", "unknown road notes only, no action");
    for (int i = 1; i <= 10; ++i) service.Tick(o, i * .4, 1, 7);
    Check(!service.State()["last_safe"].is_null() && service.State()["last_safe"]["no_contact_proof"] == false, "quiet dwell matures with explicit partial coverage");
    o.combat = true;
    auto fight = service.Tick(o, 4.4, 1, 7); Check(fight.size() == 1 && fight[0].violation == "not_in_combat", "fight edge selects policy");
    service.Require(fight[0], o, 4.4, 1, 7); Check(true, "executing-frame fight still observed");
    Check(service.Tick(o, 4.8, 1, 7).empty(), "persistent fight does not produce action storm");
    o.combat = false; Refuses([&] { service.Require(fight[0], o, 4.8, 1, 7); }, "precondition_failed");
    service.Tick(o, 5.2, 1, 7);
    service.Contact({{"event", "contact.coverage"}}, 5.3); Check(service.State()["contact_receipts"] == 0, "coverage heartbeat is not contact");
    service.Contact({{"event", "contact.car_hit_player"}, {"other_entity", "car1"}, {"vehicle_hit_observed", true}}, 5.3);
    o.position = {1, 0, 0};
    auto contact = service.Tick(o, 5.6, 1, 7); Check(contact.size() == 1 && contact[0].violation == "no_contact" && !contact[0].safe.is_null(), "contact preserves previous quiet anchor");
    service.Require(contact[0], o, 5.6, 1, 7); Check(true, "contact latch survives tick consumption");
    service.Result(contact[0], "player.teleport", {{"ok", false}, {"error", {{"code", "busy"}}}});
    service.Input("raw:IK_MouseX"); Check(!service.Active() && service.State()["last_safe"].is_null(), "input immediately yields and clears anchor");
    Refuses([&] { service.Require(contact[0], o, 5.6, 1, 7); }, "precondition_failed");
    service.Flush();
    Check(std::any_of(receipts.begin(), receipts.end(), [](const json& e) { return e.at("event") == "supervisor.violation"; }), "violation receipt");
    Check(std::any_of(receipts.begin(), receipts.end(), [](const json& e) { return e.at("event") == "supervisor.action" && e.at("response").at("ok") == false; }), "action refusal receipt");
    o = V(); service.Set(p, o, 10, 1, 7); service.Tick(o, 10, 1, 7); service.Tick(o, 20, 1, 7);
    Check(service.State()["last_safe"].is_null(), "stalled tick cannot mature quiet dwell");
    o.position = {2, 0, 0}; auto drift = service.Tick(o, 20.4, 1, 7); Check(drift.size() == 1 && drift[0].violation == "goal", "hold radius deviation");
    Refuses([&] { service.Require(drift[0], o, 20.4, 1, 7); }, "precondition_failed");
    o = V(); o.yaw = 16; service.Set(p, o, 30, 1, 7); Check(service.Tick(o, 30, 1, 7).size() == 1, "optional facing deviation");
    o = V(); service.Set(p, o, 40, 1, 7); o.road = "road"; auto road = service.Tick(o, 40, 1, 7); Check(road.size() == 1 && road[0].violation == "not_on_road", "positive road only");
    o = V(); service.Set(p, o, 50, 1, 7); o.dead = true; Check(service.Tick(o, 50, 1, 7)[0].violation == "alive", "death invariant");
    o = V(); service.Set(p, o, 60, 1, 7); service.Tick(o, 60, 2, 7); Check(!service.Active(), "load generation cancels");
    service.Set(p, o, 70, 1, 7); service.Tick(o, 70, 1, 8); Check(!service.Active(), "connection owner changed cancels");
    service.Set(p, o, 80, 1, 7); o.paused = true; service.Tick(o, 80, 1, 7); Check(!service.Active(), "world pause cancels");
    o = V(); const auto generation = service.State()["generation"].get<uint64_t>(); service.Clear("clear_before_set");
    Refuses([&] { service.Set(p, o, 90, 1, 7, generation); }, "interrupted");
    {
        std::vector<json> overflow;
        Service bounded([&](const std::string& event, const json& data) { if (event == "supervisor.gap") overflow.push_back(data); });
        bounded.Set(p, V(), 0, 1, 1);
        for (int i = 0; i < 300; ++i) bounded.Contact({{"event", "contact.controller_report"}}, .1);
        bounded.Flush();
        Check(bounded.State()["event_drops"].get<int>() > 0 && overflow.size() == 1 && overflow[0]["dropped"].get<int>() > 0, "bounded ingress discloses overflow");
    }
    {
        // Queue the real dispatcher path, then invalidate the owner before that frame runs.
        Config config; config.allowWrites = true; config.maxRequestsPerSecond = 1000;
        Session session; session.token = "fixture"; GameThreadQueue queue; queue.SetPumping(true);
        Dispatcher dispatcher(config, session, queue); int changed = 0;
        dispatcher.Register({"guarded.action", Access::Write, RunOn::GameThread, "fixture", [&](const MethodContext&) { ++changed; return json::object(); }});
        std::atomic<bool> open{true};
        auto task = std::async(std::launch::async, [&] {
            return json::parse(dispatcher.HandleGuarded(SerializeJson({{"v", 1}, {"token", session.token}, {"method", "guarded.action"}}), 1,
                [&] { if (!open) throw MethodError("precondition_failed", "input"); }).line);
        });
        Check(task.wait_for(std::chrono::milliseconds(40)) == std::future_status::timeout, "guarded action waits for game frame");
        open = false; queue.Drain(1); const auto answer = task.get();
        Check(!answer.at("ok").get<bool>() && answer["error"]["code"] == "precondition_failed" && changed == 0, "input wins over admitted action on executing frame");
        std::promise<void> readDone, proceed;
        auto allowed = proceed.get_future();
        dispatcher.Register({"guarded.multistep", Access::Write, RunOn::BridgeThread, "fixture", [&](const MethodContext&) {
            dispatcher.RunRead([] { return json::object(); }, "read");
            readDone.set_value(); allowed.wait();
            return dispatcher.RunWrite(std::chrono::milliseconds(1000), [&] { ++changed; return json::object(); }, "later-write");
        }});
        open = true;
        auto steps = std::async(std::launch::async, [&] {
            return json::parse(dispatcher.HandleGuarded(SerializeJson({{"v", 1}, {"token", session.token}, {"method", "guarded.multistep"}}), 1,
                [&] { if (!open) throw MethodError("precondition_failed", "replaced"); }).line);
        });
        steps.wait_for(std::chrono::milliseconds(40)); queue.Drain(1); // guarded bridge-thread admission
        steps.wait_for(std::chrono::milliseconds(40)); queue.Drain(1); // handler's own read
        Check(readDone.get_future().wait_for(std::chrono::seconds(1)) == std::future_status::ready, "multi-step admitted and read");
        open = false; proceed.set_value(); steps.wait_for(std::chrono::milliseconds(40)); queue.Drain(1);
        const auto later = steps.get();
        Check(later["error"]["code"] == "precondition_failed" && changed == 0, "replacement wins before later RunWrite step");
        dispatcher.SetSafetyCancellation([&](const std::string& reason) { service.Clear(reason); });
        service.Set(p, V(), 100, 1, 7); dispatcher.SetWritesPaused(true); Check(!service.Active(), "dispatcher pause cancels synchronously");
        service.Set(p, V(), 101, 1, 7); dispatcher.SetHandover(true); Check(!service.Active(), "dispatcher handover cancels synchronously");
        service.Set(p, V(), 102, 1, 7); dispatcher.Kill("test"); Check(!service.Active(), "dispatcher kill cancels synchronously");
        Check(IsControlRouteMethod("supervisor.clear"), "clear is on emergency control route");
    }
    std::printf("SUPERVISOR UNIT: %d checks, %d failures\n", checks, failures); return failures;
}
