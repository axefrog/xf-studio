#include <Windows.h>
#include <RED4ext/RED4ext.hpp>
#include "core/Supervisor.hpp"
#include "core/Recording.hpp"
#include "core/DmMicro.hpp"
#include "core/Params.hpp"
#include "plugin/Supervisor.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
namespace
{
using json = nlohmann::json;
using supervisor::Work;
std::atomic<bool> gWatchOwed{false};
uint64_t World() { return Get().scriptLayer.Describe().value("detaches", uint64_t{0}); }
uint64_t Connection() { return Get().bridge ? Get().bridge->ConnectionsAccepted() : 0; }
supervisor::Service& Owner()
{
    static supervisor::Service service([](const std::string& event, const json& data) {
        auto payload = data; payload["event"] = event;
        Get().events.Push(event, event == "supervisor.violation" ? "warn" : "info", "supervisor", "While you were away: " + event, payload);
        RecordingIngress("supervisor", SerializeJson(payload));
    });
    return service;
}
supervisor::Observation Observe()
{
    RED4ext::CString channel("v"), actors("");
    auto sample = ScriptCall("XFRecording", "Sample", {"String", "String"}, {&channel, &actors}, "supervisor-read");
    sample.update(ScriptCall("XFSupervisor", "Read", {}, {}, "supervisor-read"));
    return supervisor::ReadObservation(sample);
}
void Gate()
{
    auto& s = Get();
    if (!s.config.allowTestHooks || !s.bridge || !s.bridge->HasClient()) throw MethodError("test_hooks_off", "Supervisor needs autonomous hooks and a connected owner");
    s.scriptLayer.Require("supervisor");
    auto& d = s.bridge->GetDispatcher(); d.RequireWritesOpen(); d.RequireWriteClass(Access::WritePlayer);
}
bool Near(const json& item, const supervisor::Point& v)
{
    try { return item.value("present", true) && item.contains("position") && supervisor::Distance(item.at("position").get<supervisor::Point>(), v) <= 30; }
    catch (...) { return false; }
}
// Internal envelopes never come from client data. The only methods are built below.
json Pack(const Work& w, const json& params)
{
    return {{"generation", w.generation}, {"incident", w.incident}, {"contact", w.contact}, {"violation", w.violation}, {"action", w.action}, {"safe", w.safe}, {"params", params}};
}
std::unique_ptr<dm::MicroRunner>& RunnerSlot() { static std::unique_ptr<dm::MicroRunner> runner; return runner; }
dm::MicroRunner& Runner()
{
    auto& runner = RunnerSlot();
    if (!runner) runner = std::make_unique<dm::MicroRunner>(
        [](const std::string& method, const json& p, const std::string& cid, const std::string& token) {
            Work w{p.at("generation").get<uint64_t>(), p.at("incident").get<uint64_t>(), p.at("contact").get<uint64_t>(),
                   p.at("violation").get<std::string>(), p.at("action").get<std::string>(), p.at("safe")};
            json response;
            try {
                auto& s = Get();
                if (!s.bridge) throw MethodError("no_bridge", "Supervisor lost its dispatcher");
                auto guard = [w, method, params = p.at("params")] {
                    Gate();
                    const auto o = Observe(); Owner().Require(w, o, recording::Now(), World(), Connection());
                    // Despawn only bridge-owned actors/props still within 30 m on this frame.
                    if (w.action == "withdraw_nearby") {
                        const auto items = method == "npc.release" ? SupervisorNpcs() : SupervisorProps();
                        bool found = false;
                        for (const auto& item : items) {
                            const bool same = method == "npc.release" ? item.at("who") == params.at("who") : item.at("handle") == params.at("id");
                            found |= same && Near(item, o.position);
                        }
                        if (!found) throw MethodError("precondition_failed", "Owned target moved away or disappeared");
                    }
                };
                const json request{{"v", kProtocolVersion}, {"id", cid}, {"cid", cid}, {"token", token}, {"method", method}, {"params", p.at("params")}};
                response = json::parse(s.bridge->GetDispatcher().HandleGuarded(request.dump(), GetCurrentProcessId(), guard).line);
            } catch (const MethodError& e) { response = {{"ok", false}, {"error", {{"code", e.code}, {"message", e.what()}}}}; }
            catch (const std::exception& e) { response = {{"ok", false}, {"error", {{"code", "failed"}, {"message", e.what()}}}}; }
            Owner().Result(w, method, response);
            Owner().Flush();
            return response;
        }, [](const std::string&, const std::string&, const std::string&, const json&) {});
    return *runner;
}
void Enqueue(const Work& w, const supervisor::Observation& o)
{
    dm::MicroBatch batch; batch.watch = "supervisor"; batch.seq = w.incident; batch.sessionToken = Get().session.token;
    auto add = [&](const std::string& method, json p) { batch.actions.push_back({method, Pack(w, p), 0}); };
    if (w.action == "stop_behaviours") add("behave.stop", {{"all", true}});
    else if (w.action == "release_holds") add("player.stop", json::object());
    else if (w.action == "handover") add("bridge.handover", {{"on", true}, {"note", "Supervisor: " + w.violation}});
    else if (w.action == "pause_world") add("world.pause", {{"paused", true}});
    else if (w.action == "return_last_safe" && !w.safe.is_null()) {
        add("player.stop", json::object());
        add("player.teleport", {{"position", w.safe.at("at")}, {"yaw", w.safe.at("yaw")}});
        batch.actions.back().delayS = .4; // player.stop's behaviour cleanup runs on the next game tick
    } else if (w.action == "withdraw_nearby") {
        for (const auto& item : SupervisorNpcs()) if (Near(item, o.position)) add("npc.release", {{"who", item.at("who")}, {"how", "despawn"}});
        for (const auto& item : SupervisorProps()) if (Near(item, o.position)) add("world.despawn", {{"id", item.at("handle")}});
    }
    if (batch.actions.empty()) { Owner().Result(w, "none", {{"ok", false}, {"error", {{"code", w.action == "return_last_safe" ? "no_safe_position" : "no_owned_target"}}}}); return; }
    // One bounded worker, no delay/burst loop, and a terminal result for every admitted intervention.
    if (Runner().Pending() + batch.actions.size() > 16) { Owner().Result(w, "none", {{"ok", false}, {"error", {{"code", "supervisor_busy"}}}}); return; }
    Runner().Enqueue(std::move(batch));
}
}
#endif
void RegisterSupervisor(Dispatcher& d)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    d.SetSafetyCancellation(CancelSupervisor);
    d.Register({"supervisor.set", Access::WritePlayer, RunOn::BridgeThread, "Replace V's bounded safety supervisor.", [&d](const MethodContext& c) {
        Gate();
        // Validate everything before replacing the current owner or its input watch.
        const auto entry = supervisor::Parse(c.params);
        if (entry.actor.kind != "player") throw MethodError("actor_unavailable", "Only V's actor adapter is active in this slice");
        const auto generation = Owner().State().at("generation").get<uint64_t>();
        return d.RunWrite(GameTimeout(), [c, generation] {
            Gate();
            auto observed = Observe();
            if (!Owner().Active()) observed.input.clear(); // explicit re-arm starts a new watch
            auto out = Owner().Set(c.params, observed, recording::Now(), World(), Connection(), generation);
            gWatchOwed = true;
            try { bool on = true; ScriptCall("XFSupervisor", "Watch", {"Bool"}, {&on}, c.cid); }
            catch (...) { CancelSupervisor("input_watch_failed"); throw; }
            Owner().Flush(); return out;
        }, "supervisor.set");
    }});
    d.Register({"supervisor.state", Access::Read, RunOn::BridgeThread, "Read the supervisor entry and quiet-position evidence.", [](const MethodContext& c) {
        params::RequireOnly(c.params, {});
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        return Owner().State();
    }});
    d.Register({"supervisor.clear", Access::Control, RunOn::BridgeThread, "Cancel supervisor ownership without touching game objects.", [](const MethodContext& c) {
        params::RequireOnly(c.params, {});
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Supervisor test gate closed");
        auto out = Owner().Clear("cleared"); Owner().Flush(); return out;
    }});
#else
    (void)d;
#endif
}
void CancelSupervisor(const std::string& reason)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    Owner().Clear(reason);
#else
    (void)reason;
#endif
}
bool SupervisorWanted(const std::string& channel)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    return (channel == "contacts" || channel == "supervisor") && Owner().Active();
#else
    (void)channel; return false;
#endif
}
void SupervisorIngress(const std::string& channel, const nlohmann::json& event)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    // VM ingress may run inside the recorder's sample. Only copy/cancel here; flush outside
    // recorder/VM locks on the supervisor tick or worker, avoiding a recorder -> sink lock cycle.
    if (channel == "contacts") Owner().Contact(event, recording::Now());
    else if (channel == "supervisor" && event.value("event", std::string()) == "supervisor.input") Owner().Input(event.value("action", std::string("unknown")));
#else
    (void)channel; (void)event;
#endif
}
void TickSupervisor(bool ready)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!ready) { if (Owner().Active()) CancelSupervisor("game_loading"); gWatchOwed = false; Owner().Flush(); return; }
    try {
        if (Owner().Active()) {
            Gate();
            if (Owner().Due(recording::Now())) {
                const auto o = Observe();
                for (const auto& w : Owner().Tick(o, recording::Now(), World(), Connection())) {
                    try { Enqueue(w, o); }
                    catch (const std::exception& e) { Owner().Result(w, "plan", {{"ok", false}, {"error", {{"code", "plan_unavailable"}, {"message", e.what()}}}}); }
                }
            }
        }
    } catch (const std::exception&) { CancelSupervisor("gate_or_read_unavailable"); }
    if (!Owner().Active() && gWatchOwed.exchange(false)) {
        try { bool on = false; ScriptCall("XFSupervisor", "Watch", {"Bool"}, {&on}, "supervisor-clear"); } catch (...) {}
    }
    Owner().Flush();
#else
    (void)ready;
#endif
}
void StopSupervisor()
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    CancelSupervisor("shutdown");
    if (RunnerSlot()) RunnerSlot()->Stop();
    Owner().Flush();
#endif
}
}
