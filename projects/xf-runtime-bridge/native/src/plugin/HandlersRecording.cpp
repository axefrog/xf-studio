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
uint64_t World() { return Get().scriptLayer.Describe().value("detaches", uint64_t{0}); }
uint64_t Connection() { return Get().bridge ? Get().bridge->ConnectionsAccepted() : 0; }
void Guard()
{
    auto& s = Get();
    s.scriptLayer.Require("source-recording");
    if (!s.config.allowTestHooks || !s.bridge || !s.bridge->HasClient() || s.bridge->GetDispatcher().IsKilled())
        throw MethodError("test_hooks_off", "Recorder owner or test gate closed.");
}
}
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
        RED4ext::CString name(channel.c_str());
        std::string joined;
        for (const auto& a : actors) joined += (joined.empty() ? "" : ",") + a;
        RED4ext::CString whos(joined.c_str());
        return ScriptCall("XFRecording", "Sample", {"String", "String"}, {&name, &whos}, "source-recorder");
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
