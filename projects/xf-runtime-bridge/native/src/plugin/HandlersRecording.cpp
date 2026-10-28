#include <RED4ext/RED4ext.hpp>
#include "core/Recording.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Supervisor.hpp"

namespace xfb::plugin
{
 nlohmann::json DmGuardPresent();
namespace
{
recording::Service& Recorder() { static recording::Service s; return s; }
uint64_t World() { return Get().scriptLayer.WorldGeneration(); }
uint64_t Connection() { return Get().bridge ? Get().bridge->ConnectionsAccepted() : 0; }
void Guard()
{
    auto& s = Get();
    s.scriptLayer.Require("source-recording");
    if (!s.config.allowTestHooks || !s.bridge || !s.bridge->HasClient() || s.bridge->GetDispatcher().IsKilled())
        throw MethodError("test_hooks_off", "Recorder owner or test gate closed.");
}
}
nlohmann::json RecordingSnapshot(double now,uint64_t world) { return Recorder().SnapshotData(now,world); }
bool RecordingWanted(const std::string& channel)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    auto& s = Get();
    return s.config.allowTestHooks && s.scriptLayer.Ready() && s.bridge && s.bridge->HasClient() &&
           !s.bridge->GetDispatcher().IsKilled() && (Recorder().Wants(channel) || SupervisorWanted(channel));
#else
    (void)channel;
    return false;
#endif
}
std::string RecordingIdentity(const std::string& channel)
{
    if (!RecordingWanted(channel)) return {};
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    const auto identity = Recorder().Identity(channel);
    return identity.empty() ? std::string("supervisor") : identity; // wanted by the supervisor watch alone
#else
    return {};
#endif
}
bool RecordingIngress(const std::string& channel, const std::string& payload)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    auto& s = Get();
    if (!s.config.allowTestHooks || !s.scriptLayer.Ready() || !s.bridge || !s.bridge->HasClient() || s.bridge->GetDispatcher().IsKilled()) return false;
    if (payload.size() > recording::kPayload || JsonNestingDepth(payload, kMaxJsonDepth) > kMaxJsonDepth) return false;
    const auto event = nlohmann::json::parse(payload, nullptr, false);
    if (!event.is_object()) return false;
    SupervisorIngress(channel, event);
    return Recorder().Wants(channel) && Recorder().Ingress(channel, payload, recording::Now(), World(), Connection(), s.runningTicks.load());
#else
    (void)channel; (void)payload;
    return false;
#endif
}
void RegisterRecording(Dispatcher& d)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    d.SetPreconditionReader([](const nlohmann::json& when) {
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Action conditions need allow_test_hooks");
        auto state = ScriptCall("XFRecording", "GuardState", {}, {}, "action-guard");
        if (when.contains("spawned")) state["spawned"] = DmGuardPresent();
        return state;
    });
    Recorder().SetDirectory(Get().session.runtimeDir / "recordings");
    Get().bridge->SetStopObserver([] { CancelSupervisor("bridge_stopped"); Recorder().RequestStop("bridge_stopped"); });
    recording::RegisterMethods(d, Recorder(), Get().config.allowTestHooks, World, Connection,
                              [] { return Get().session.sessionId; }, Guard);
#else
    (void)d;
#endif
}
void TickRecording(bool ready)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    auto& s = Get();
    bool live = ready;
    try { Guard(); } catch (...) { live = false; }
    recording::Ops ops;
    ops.guard = Guard;
    ops.sample = [](const std::string& channel, const std::vector<std::string>& actors) {
        if (channel == "supervisor") return nlohmann::json{{"valid", true}, {"event", "supervisor.coverage"}, {"continuous_contact", false}, {"no_contact_proof", false}};
        if (channel == "events") return nlohmann::json{{"valid", true}, {"event", "world.coverage"}, {"feed", Get().worldEvents.Read({{"limit", 1}})["coverage"]}};
        if (channel == "incidents") return IncidentCoverage(); // 0.8.20: native bookkeeping only, no game read
        RED4ext::CString name(channel.c_str());
        std::string joined;
        for (const auto& a : actors) joined += (joined.empty() ? "" : ",") + a;
        RED4ext::CString whos(joined.c_str());
        auto& feed = Get().worldEvents;
        const auto epoch = channel == "v" ? feed.CaptureEpoch("time", nlohmann::json::object(), World) : worldevents::Epoch{};
        static worldevents::ClockJumps clock;
        nlohmann::json sample;
        try { sample = ScriptCall("XFRecording", "Sample", {"String", "String"}, {&name, &whos}, "source-recorder"); }
        catch (...) {
            // A failed V sample breaks continuity: no jump may be inferred across it.
            if (channel == "v") clock.Observe(nlohmann::json(), recording::Now(), epoch, Recorder().SamplingRun());
            throw;
        }
        if (channel == "v") {
            const auto after = feed.CaptureEpoch("time", nlohmann::json::object(), World);
            const auto source = recording::Now();
            if (auto data = clock.Observe(epoch.world == after.world && epoch.session == after.session ? sample : nlohmann::json(), source, epoch, Recorder().SamplingRun())) {
                if (auto event = feed.Push("time", std::move(*data), source, epoch)) {
                    (*event)["event"] = "world.time";
                    RecordingIngress("events", SerializeJson(*event));
                }
            }
        }
        return sample;
    };
    Recorder().Tick(recording::Now(), World(), Connection(), live, s.runningTicks.load(), ops);
#else
    (void)ready;
#endif
}
void StopRecording(const std::string& reason)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    Recorder().Stop(reason, recording::Now());
    if (reason == "plugin_unload") Recorder().JoinWriter();
#else
    (void)reason;
#endif
}
}
