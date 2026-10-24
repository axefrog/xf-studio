#include <RED4ext/RED4ext.hpp>
#include "plugin/HandlersInputChoices.hpp"
#include "plugin/InputDispatch.hpp"
#include "plugin/Plugin.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/ScriptCall.hpp"
#include "core/Win32.hpp"

namespace xfb::plugin
{
using json = nlohmann::json;
namespace
{
double Now() { return static_cast<double>(win32::MonotonicMs()) / 1000.0; }
uint64_t World() { return Get().scriptLayer.Describe().value("detaches", uint64_t{0}); }
std::string Context() { return ScriptCall("XFInputActions", "Context", {}, {}, "input-context").value("phase", std::string()); }
std::mutex contextMutex;
std::string cachedContext;
std::string CachedContext() { std::scoped_lock lock(contextMutex); return cachedContext; }
void Guard()
{
    auto& s = Get();
    if (!s.scriptLayer.Ready()) throw MethodError("game_loading", "Wait for the live player session.");
    if (!s.bridge || !s.config.allowTestHooks) throw MethodError("test_hooks_off", "The autonomous test bridge is off.");
    if (!s.bridge->HasClient()) throw MethodError("test_run_required", "The input test's client disconnected.");
    const auto state = InputService().State();
    if (!state.value("run_id", std::string()).empty() && state.value("connection", uint64_t{0}) != s.bridge->ConnectionsAccepted())
        throw MethodError("stale_context", "The input test belongs to an earlier connection.");
    s.bridge->GetDispatcher().RequireWritesOpen();
}
input::Ops Ops()
{
    input::Ops ops;
    ops.guard = [] { RequireGameThread(); Guard(); };
    ops.connection = [] { return Get().bridge ? Get().bridge->ConnectionsAccepted() : uint64_t{0}; };
    ops.seedOffers = [] { ScriptCall("XFInputActions", "ObserveChoices", {}, {}, "input-seed"); };
    ops.hub = [] { return ScriptCall("XFInputActions", "HubState", {}, {}, "input-hub"); };
    ops.choice = [](int32_t hub, int32_t generation, int32_t index, bool apply) {
        Guard(); Get().restore.MarkWrite();
        ScriptCall("XFBridgeActions", "SaveLock", {}, {}, "input-choice-lock");
        Guard();
        return ScriptCall("XFInputActions", "ChoiceStep", {"Int32", "Int32", "Int32", "Bool"}, {&hub, &generation, &index, &apply}, "input-choice");
    };
    ops.photo = [] { return ScriptCall("XFInputActions", "PhotoState", {}, {}, "input-photo"); };
    ops.exitAttempt = [](int32_t gen, bool comparison) {
        auto* cls = RED4ext::CRTTISystem::Get()->GetClass("gameuiTryExitPhotomodeEvent");
        auto* base = RED4ext::CRTTISystem::Get()->GetClass("redEvent");
        if (!cls || !base || !cls->IsA(base) || cls->GetSize() != 0x40)
            throw MethodError("input_unavailable", "The expected native photo exit Event type is unavailable.");
        Guard(); Get().restore.MarkWrite();
        ScriptCall("XFBridgeActions", "SaveLock", {}, {}, "input-photo-lock");
        Guard();
        return ScriptCall("XFInputActions", comparison ? "PhotoExitControl" : "PhotoExitAttempt", {"Int32"}, {&gen}, "input-photo-exit");
    };
    ops.inputReady = [] { return InputDispatchStatus().value("available", false); };
    ops.inputStatus = InputDispatchStatus;
    ops.physicalHeld = PhysicalInputHeld;
    ops.dispatch = DispatchInput;
    ops.releaseGuard = [] { RequireGameThread(); Get().scriptLayer.Require("native-input-release"); };
    // No receiver is retained. This guard alone cannot establish load-safe neutralisation:
    // InputDispatchStatus remains unavailable until the native lifetime contract is known.
    return ops;
}
uint64_t LockGeneration()
{
    static std::mutex mutex;
    static json previous = nullptr;
    static uint64_t generation = 0;
    std::scoped_lock lock(mutex);
    const nlohmann::json signature{{"world", World()}, {"lock", SaveLockJson()}, {"session", Get().session.sessionId}};
    if (signature != previous) { previous = signature; ++generation; }
    InputService().SetLock(generation, SaveAnywayOffered() && !Get().saveAnywayRunning.load());
    return generation;
}
}
input::Service& InputService() { static input::Service service(Get().events); return service; }
void RegisterInputChoices(Dispatcher& d)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    input::RegisterMethods(d, InputService(), Get().config.allowTestHooks,
#ifdef XFB_ENGINE_INPUT_TESTS
                          true,
#else
                          false,
#endif
                          Now, World, Context, Ops);
#else
    (void)d;
#endif
}
void TickInputChoices(bool ready)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    auto& s = Get();
    bool open = ready && s.bridge && s.config.allowTestHooks;
    if (open) { try { Guard(); } catch (...) { open = false; } }
    LockGeneration();
    static std::string session;
    if (session != s.session.sessionId) { InputService().Stop("session_changed", Ops()); session = s.session.sessionId; }
    if (InputService().State().value("run_id", std::string()).empty()) return;
    const auto context = open ? Context() : "";
    { std::scoped_lock lock(contextMutex); cachedContext = context; }
    InputService().Tick(Now(), World(), context, open, Ops());
#else
    (void)ready;
#endif
}
void StopInputChoices(const std::string& reason)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    InputService().Stop(reason, Ops());
#else
    (void)reason;
#endif
}
nlohmann::json TakeTestUi(const nlohmann::json& draw)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (InputService().State().value("run_id", std::string()).empty()) return nullptr;
    Guard();
    auto& s = Get();
    if ((s.config.writeClasses & kWriteSave) == 0) throw MethodError("write_class_disabled", "The save class is off.");
    if (!s.cetOverlayOpen.load()) return nullptr;
    // CET draws on its render callback: never execute game scripts here. The game-thread
    // tick publishes this context, and the live/world/write gates are checked again now.
    if (CachedContext() != InputService().State().value("context", std::string())) return nullptr;
    if (draw.value("target", std::string()) != "save_anyway" || !draw.value("visible", false) || !draw.value("settled", false) || !draw.value("overlay_open", false) || !draw.contains("rect") || !draw["rect"].is_array() || draw["rect"].size() != 4 || !draw.contains("frame") || !draw["frame"].is_number_integer()) return nullptr;
    const auto gen = LockGeneration();
    return InputService().TakeUi(Now(), World(), gen, SaveAnywayOffered() && !s.saveAnywayRunning.load());
#else
    (void)draw;
    return nullptr;
#endif
}
nlohmann::json ReportTestUi(const nlohmann::json& report)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    Guard();
    auto& s = Get();
    if ((s.config.writeClasses & kWriteSave) == 0) return {{"accepted", false}};
    if (report.value("stage", std::string()) == "dequeued" &&
        (!s.cetOverlayOpen.load() || CachedContext() != InputService().State().value("context", std::string()) ||
         !InputService().ValidateUi(Now(), World(), LockGeneration(), SaveAnywayOffered() && !s.saveAnywayRunning.load())))
        return {{"accepted", false}};
    return {{"accepted", InputService().ReportUi(report)}};
#else
    (void)report;
    return {{"accepted", false}};
#endif
}
nlohmann::json TestUiSaveRequest(const std::string& source)
{
    json correlation = json::object();
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (source.starts_with("cet-panel-test:"))
    {
        Guard();
        auto& s = Get();
        const auto state = InputService().State();
        const auto receipt = state.value("last", json(nullptr));
        if (!s.cetOverlayOpen.load() || (s.config.writeClasses & kWriteSave) == 0 ||
            CachedContext() != state.value("context", std::string()) ||
            !InputService().ValidateUi(Now(), World(), LockGeneration(), SaveAnywayOffered() && !s.saveAnywayRunning.load()) ||
            receipt.is_null() || receipt.value("ui_stage", std::string()) != "dequeued" ||
            source != "cet-panel-test:" + std::to_string(receipt.value("request_id", uint64_t{0})))
            throw MethodError("activation_expired", "The button test expired or stopped before the save began.");
        correlation = {{"request_id", receipt["request_id"]}, {"run_id", receipt["run_id"]}, {"world_generation", receipt["world_generation"]}, {"coverage", "rendered_button_activation"}};
    }
#else
    (void)source;
#endif
    return correlation;
}
}
