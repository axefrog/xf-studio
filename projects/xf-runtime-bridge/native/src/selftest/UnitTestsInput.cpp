#include "core/InputChoices.hpp"
#include <cstdio>
#include <vector>

namespace
{
using namespace xfb;
using json = nlohmann::json;
int checks = 0, failures = 0;
void Check(bool ok, const char* label) { ++checks; if (!ok) { ++failures; std::printf("INPUT FAIL %s\n", label); } }
template<class F> void Refuses(F fn, const char* code) { try { fn(); Check(false, code); } catch (const MethodError& e) { Check(e.code == code, code); } }
struct Fixture
{
    EventLog events;
    input::Service service{events};
    input::Ops ops;
    json hub{{"id", 20}, {"generation", 1}, {"index", 0}, {"count", 3}, {"shown", true}, {"busy", false}};
    json photo{{"generation", 30}, {"shown", true}, {"changed", true}, {"confirmation", false}};
    bool applied = false, available = false, physical = false, receipt = true, held = true, throwDispatch = false;
    int actions = 0, reads = 0, guarded = 0;
    std::vector<std::string> dispatched;
    Fixture()
    {
        ops.guard = [this] { ++guarded; };
        ops.hub = [this] { ++reads; return hub; };
        ops.choice = [this](int32_t, int32_t, int32_t, bool apply) {
            ++actions; applied = apply;
            if (!apply) hub["index"] = hub["index"].get<int>() + 1;
            return json{{"applied", apply}};
        };
        ops.photo = [this] { return photo; };
        ops.exitAttempt = [this](int32_t gen, bool) {
            if (receipt) service.Observe("input.photo.callback", {{"generation", gen}, {"held", held}, {"confirmation", !held}});
            return json{{"submitted", true}};
        };
        ops.inputReady = [this] { return available; };
        ops.physicalHeld = [this](const std::string&) { return physical; };
        ops.dispatch = [this](const std::string& key, const std::string& kind, float value) {
            dispatched.push_back(key + ":" + kind + ":" + std::to_string(value));
            if (kind == "release" || (kind == "axis" && value == 0)) Check(RestoreScope::Active(), "neutralisation uses RestoreScope");
            if (throwDispatch) { throwDispatch = false; throw MethodError("adapter_error", "uncertain submission"); }
        };
    }
    void Arm(const std::string& phase = "gameplay") { service.Arm({{"run_id", "fixture"}, {"context", phase}}, 0, 1, phase); }
    json Choice(bool commit = true) { return {{"run_id", "fixture"}, {"hub", 20}, {"generation", 1}, {"index", 1}, {"commit", commit}}; }
    json Ui() { return {{"run_id", "fixture"}, {"target", "save_anyway"}, {"lock_generation", 1}}; }
    json Pulse(const std::string& control = "confirm") { return {{"run_id", "fixture"}, {"control", control}, {"duration_ms", 100}}; }
    void Tick(double now = 0.1, uint64_t world = 1, const std::string& phase = "gameplay", bool open = true) { service.Tick(now, world, phase, open, ops); }
    std::string Reason() { return service.State()["last"].value("reason", std::string()); }
};
}
int InputUnitTests()
{
    {
        Fixture f;
        Refuses([&] { f.service.Submit("choice", f.Choice(), 0, f.ops); }, "test_run_required");
        Refuses([&] { f.service.Arm({{"run_id", "x"}, {"context", "menu"}}, 0, 1, "gameplay"); }, "stale_context");
        f.Arm(); auto p = f.Choice(); p["index"] = -1;
        Refuses([&] { f.service.Submit("choice", p, 0, f.ops); }, "bad_params");
    }
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(false), 0, f.ops);
        f.Tick(); Check(f.actions == 1 && !f.applied && f.hub["index"] == 1, "one scroll per update");
        f.Tick(0.2); Check(f.Reason() == "selected" && !f.applied, "highlight is not a commitment");
    }
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(), 0, f.ops);
        f.Tick(); Check(!f.applied, "scroll cannot apply in same update");
        f.Tick(0.2); Check(f.applied && f.service.State()["last"].is_null(), "submission is not an authoritative answer");
        f.events.Push("npc.choice", "ask", "game", "fixture", {{"hub", 21}, {"index", 1}});
        f.Tick(0.3); Check(f.service.State()["last"].is_null(), "another hub cannot prove answer");
        f.events.Push("npc.choice", "ask", "game", "fixture", {{"hub", 20}, {"index", 1}, {"label", "second"}});
        f.Tick(0.4); Check(f.Reason() == "committed", "matching npc.choice proves our answer");
    }
    for (const auto* reason : {"generation", "withdrawn", "busy"})
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(), 0, f.ops); f.Tick();
        if (std::string(reason) == "generation") f.hub["generation"] = 2;
        else if (std::string(reason) == "withdrawn") f.hub["shown"] = false;
        else f.hub["busy"] = true;
        f.Tick(0.2); Check(!f.applied && !f.service.State()["last"].is_null(), reason);
    }
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(), 0, f.ops);
        for (int i = 0; i < 1001; ++i) f.events.Push("noise", "info", "game", "fixture");
        f.Tick(); Check(f.Reason() == "inconclusive", "event ring loss invalidates proof");
    }
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(), 0, f.ops);
        f.ops.choice = [](int32_t, int32_t, int32_t, bool) { return json{{"deferred", true}, {"applied", false}}; };
        for (int i = 0; i < 40; ++i) f.Tick(0.1);
        Check(f.service.State()["last"].is_null() && f.service.State()["pending"]["steps"] == 0, "same engine timestamp defers without exhausting steps");
        f.hub["count"] = 4; f.Tick(0.2); Check(f.Reason() == "choice_changed", "choice count change invalidates selection");
    }
    {
        Fixture f; f.Arm("photo_mode");
        f.service.Submit("photo", {{"run_id", "fixture"}, {"controller_generation", 30}, {"route", "callback"}}, 0, f.ops);
        f.Tick(0.1, 1, "photo_mode"); f.Tick(0.2, 1, "gameplay");
        Check(f.Reason() == "callback" && f.service.State()["last"]["coverage"] == "consumer_callback", "immediate photo exit preserves comparison receipt");
    }
    {
        Fixture f; f.Arm("photo_mode"); f.receipt = false;
        f.service.Submit("photo", {{"run_id", "fixture"}, {"controller_generation", 30}}, 0, f.ops);
        f.Tick(0.1, 1, "photo_mode");
        f.service.Observe("input.photo.callback", {{"generation", 31}}); f.photo["generation"] = 31;
        f.Tick(0.2, 1, "photo_mode"); Check(f.Reason() == "inconclusive", "stale controller callback cannot prove delivery");
    }
    for (bool held : {true, false})
    {
        Fixture f; f.Arm("photo_mode"); f.held = held;
        f.service.Submit("photo", {{"run_id", "fixture"}, {"controller_generation", 30}}, 0, f.ops);
        f.Tick(0.1, 1, "photo_mode"); f.Tick(0.2, 1, "photo_mode");
        Check(f.Reason() == "callback" && f.service.State()["last"]["held"] == held, "photo callback distinguishes held and prompt");
    }
    {
        Fixture f; f.Arm("photo_mode"); f.receipt = false;
        f.service.Submit("photo", {{"run_id", "fixture"}, {"controller_generation", 30}}, 0, f.ops);
        f.Tick(0.1, 1, "photo_mode"); f.Tick(3, 1, "photo_mode");
        Check(f.Reason() == "inconclusive", "no callback cannot pass");
    }
    {
        Fixture f; f.Arm(); Refuses([&] { f.service.Submit("ui", f.Ui(), 0, f.ops); }, "ui_target_unavailable");
        f.service.SetLock(1, true); f.service.Submit("ui", f.Ui(), 0, f.ops);
        f.service.SetLock(2, true); Check(f.service.TakeUi(0.1, 1, 2, true).is_null(), "new offer cannot consume stale lock token");
        Check(f.Reason() == "activation_expired", "stale UI token expires");
    }
    {
        Fixture f; f.Arm(); f.service.SetLock(1, true); f.service.Submit("ui", f.Ui(), 0, f.ops);
        const auto t = f.service.TakeUi(0.1, 1, 1, true);
        Check(t.is_object() && f.service.TakeUi(0.2, 1, 1, true).is_null(), "button token consumed exactly once");
        Check(f.service.ReportUi({{"request_id", t["request_id"]}, {"run_id", "fixture"}, {"activated", true}}), "activation accepted");
        Check(!f.service.ReportUi({{"request_id", t["request_id"]}, {"run_id", "fixture"}, {"activated", true}}), "duplicate receipt rejected");
        Check(f.Reason() == "activated", "activation receipt is separate from save outcome");
        Check(f.service.ValidateUi(0.2, 1, 1, true), "current activation may drain");
        Check(!f.service.ValidateUi(3, 1, 1, true) && !f.service.ValidateUi(0.2, 2, 1, true) && !f.service.ValidateUi(0.2, 1, 2, true) && !f.service.ValidateUi(0.2, 1, 1, false), "expired/world/offer changes cannot drain");
        const auto report = [&](const char* stage) { return f.service.ReportUi({{"request_id", t["request_id"]}, {"run_id", "fixture"}, {"stage", stage}}); };
        Check(!report("native") && report("queued") && !report("queued") && report("dequeued") && !report("dequeued") && report("native"), "UI stages ordered and once only");
        f.service.Stop("kill", f.ops);
        Check(!report("native") && !f.service.ValidateUi(0.2, 1, 1, true), "stop disarms consumed UI activation");
    }
    {
        Fixture f; f.Arm(); f.service.SetLock(1, true); f.service.Submit("ui", f.Ui(), 0, f.ops); f.Tick(3);
        Check(f.service.TakeUi(3, 1, 1, true).is_null(), "undrawn button expires without saving");
    }
    for (const auto* stop : {"kill", "pause", "handover", "load", "error", "disconnect"})
    for (const auto* control : {"confirm", "move_y"})
    {
        Fixture f; f.Arm(); f.available = true; f.service.Submit("pulse", f.Pulse(control), 0, f.ops);
        f.service.Stop(stop, f.ops);
        Check(f.dispatched.size() == 2 && f.service.State()["held"] == "", stop);
    }
    {
        Fixture f; f.Arm(); Refuses([&] { f.service.Submit("pulse", f.Pulse(), 0, f.ops); }, "input_unavailable");
        Check(f.dispatched.empty(), "uncommissioned adapter receives no call");
        f.available = true; f.physical = true;
        Refuses([&] { f.service.Submit("pulse", f.Pulse(), 0, f.ops); }, "input_overlap");
        f.physical = false; auto p = f.Pulse(); p["duration_ms"] = 151;
        Refuses([&] { f.service.Submit("pulse", p, 0, f.ops); }, "bad_params");
        f.throwDispatch = true;
        Refuses([&] { f.service.Submit("pulse", f.Pulse(), 0, f.ops); }, "adapter_error");
        Check(f.dispatched.size() == 2 && f.service.State()["held"] == "", "error after submission releases owned key");
        f.service.Submit("pulse", f.Pulse(), 0, f.ops); f.Tick(0.2);
        Check(f.Reason() == "released", "pulse deadline releases");
    }
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(), 0, f.ops);
        f.ops.connection = [] { return uint64_t{2}; };
        f.Tick(); Check(f.actions == 0 && f.Reason() == "connection_changed", "a reconnect invalidates pending proof before action");
    }
    for (int mode = 0; mode < 4; ++mode)
    {
        Fixture f; f.Arm(); f.service.Submit("choice", f.Choice(), 0, f.ops);
        f.Tick(mode == 0 ? 31 : 0.1, mode == 1 ? 2 : 1, mode == 2 ? "menu" : "gameplay", mode != 3);
        Check(f.actions == 0 && f.service.State()["run_id"] == "", "expiry, load, context and closed gate disarm before game calls");
    }
    {
        Fixture f; f.Arm();
        json offer{{"generation", 1}, {"truncated", false}, {"hubs", json::array({json{{"id", 7}, {"choices", json::array({"one", "two"})}}})}};
        f.service.Observe("choice.offer", offer);
        json attempt{{"generation", 1}, {"success", true}, {"dialog", true}, {"index", 1}, {"caption", "two"}, {"active_hub", 7}};
        f.service.Observe("choice.attempt", attempt); f.service.Observe("choice.attempt", attempt);
        auto results = f.events.Read(0, 100, {"choice.result"});
        Check(results["events"].size() == 2, "identical consecutive attempts preserved");
        Check(results["events"][0]["data"]["hub_attribution"] == "correlated", "unique offer is correlation only");
        offer["hubs"].push_back(offer["hubs"][0]); f.service.Observe("choice.offer", offer); f.service.Observe("choice.attempt", attempt);
        results = f.events.Read(0, 100, {"choice.result"});
        Check(results["events"].back()["data"]["hub_attribution"] == "ambiguous", "two hubs remain ambiguous");
        attempt["success"] = false; f.service.Observe("choice.attempt", attempt);
        results = f.events.Read(0, 100, {"choice.result"});
        Check(results["events"].back()["data"]["success"] == false, "failed native attempt preserved");
    }
    std::printf("INPUT UNIT: %d checks, %d failures\n", checks, failures);
    return failures;
}
