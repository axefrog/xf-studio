#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Memory/SharedPtr.hpp>
#include <RED4ext/Scripting/Natives/inkLayer.hpp>
#include <RED4ext/Scripting/Natives/inkMultiChildren.hpp>
#include <RED4ext/Scripting/Natives/Generated/ink/CompoundWidget.hpp>
#include <RED4ext/Scripting/Natives/Generated/ink/InitialLoadingScreenLogicController.hpp>
#include <RED4ext/Scripting/Natives/Generated/ink/WidgetLibraryItemInstance.hpp>
#include <RED4ext/Scripting/Natives/Generated/ink/VirtualWindow.hpp>
#include "plugin/Lifecycle.hpp"
#include "plugin/Plugin.hpp"
#include "core/Lifecycle.hpp"
#include "core/Params.hpp"
#include "core/Win32.hpp"
#include <mutex>
#include <cstring>
#include <unordered_set>

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;
std::mutex mutex;
lifecycle::Snapshot snapshot;
std::string unavailable = "autonomous lifecycle observer not installed";
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
// Codeware 613a1cb, src/Red/InkSystem.hpp and RawInputHook.hpp. The original callback
// supplies the live ink owner/thread; no global pointer acquisition or VM calls during detach.
struct LayerManager { uint8_t pad[0x38]; RED4ext::DynArray<RED4ext::Handle<RED4ext::ink::Layer>> layers; };
struct InkSystem { uint8_t pad[0x380]; RED4ext::DynArray<RED4ext::SharedPtr<LayerManager>> managers; };
static_assert(offsetof(InkSystem, managers) == 0x380);
using Process = void (*)(InkSystem*, uint64_t, void*);
Process original = nullptr;
uintptr_t hookAddress = 0;
std::atomic<bool> enabled = false;
std::atomic<DWORD> observedThread = 0;
RED4ext::WeakHandle<RED4ext::ink::Widget> engagement;
bool engagementKnown = false;
uint64_t nextSample = 0;
uintptr_t previousOwner = 0;

bool Visible(RED4ext::Handle<RED4ext::ink::Widget> widget)
{
    if (!widget) return false;
    for (unsigned depth = 0; widget && depth < 32; ++depth) {
        if (!widget->visible || widget->opacity <= 0) return false;
        if (!widget->parentWidget.instance) return true;
        widget = RED4ext::Handle<RED4ext::ink::Widget>(widget->parentWidget);
        if (!widget) return false;
    }
    return false;
}
bool Within(RED4ext::Handle<RED4ext::ink::Widget> widget, const RED4ext::Handle<RED4ext::ink::Widget>& root)
{
    if (!root) return false;
    for (unsigned depth = 0; widget && depth < 32; ++depth) {
        if (widget.instance == root.instance) return true;
        widget = RED4ext::Handle<RED4ext::ink::Widget>(widget->parentWidget);
    }
    return false;
}

void CopyUi(InkSystem* system)
{
    if (!enabled.load()) return;
    const DWORD thread = GetCurrentThreadId();
    DWORD expected = 0;
    if (!observedThread.compare_exchange_strong(expected, thread) && expected != thread) {
        enabled.store(false);
        std::scoped_lock lock(mutex); snapshot.observed = false;
        unavailable = "native ink callback changed thread; observer disabled pending commissioning";
        return;
    }
    const auto now = GetTickCount64();
    if (!enabled.load() || now < nextSample) return;
    nextSample = now + 100;
    lifecycle::Snapshot s; s.atMs = now; s.thread = GetCurrentThreadId(); s.observed = true; s.complete = true;
    RED4ext::Handle<RED4ext::ink::Widget> menu;
    { std::scoped_lock lock(mutex); menu = RED4ext::Handle<RED4ext::ink::Widget>(engagement); s.engagementKnown = engagementKnown; }
    const bool menuVisible = Visible(menu);
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* initial = rtti ? rtti->GetClass("inkInitialLoadingScreenLogicController") : nullptr;
    auto* compound = rtti ? rtti->GetClass("inkCompoundWidget") : nullptr;
    auto* loading = rtti ? rtti->GetClass("inkLoadingLayer") : nullptr;
    if (!system || !initial || initial->GetSize() != 0x2c8 || !compound || !loading || system->managers.size > 8) s.complete = false;
    std::unordered_set<void*> widgets, controllers;
    uintptr_t owner = 0;
    auto scan = [&](auto&& self, RED4ext::Handle<RED4ext::ink::Widget> widget, unsigned depth) -> void {
        if (!widget || !widgets.insert(widget.instance).second) return;
        if (widgets.size() > 512 || depth > 32) { s.complete = false; return; }
        auto inspect = [&](const RED4ext::Handle<RED4ext::ink::WidgetLogicController>& controller) {
            if (!controller || !controllers.insert(controller.instance).second || !controller->GetNativeType()->IsA(initial)) return;
            ++s.initialCount; owner = reinterpret_cast<uintptr_t>(controller.instance);
            auto* c = reinterpret_cast<RED4ext::ink::InitialLoadingScreenLogicController*>(controller.instance);
            // R8 §4, hash-pinned 2.31 flags. Never write flags or read opaque event bytes.
            const auto* bytes = reinterpret_cast<const uint8_t*>(c);
            s.loadingReady = bytes[0x2bd] != 0; s.animationReady = bytes[0x2be] != 0;
            s.consumed = bytes[0x2bf] != 0; s.automatic = bytes[0x1a1] != 0;
            uintptr_t subscription = 0; std::memcpy(&subscription, bytes + 0x240, sizeof(subscription));
            s.subscribed = subscription != 0;
            RED4ext::Handle<RED4ext::ink::Widget> panel(c->skipButtonPanel.widget);
            s.panelResolved = static_cast<bool>(panel); s.panelVisible = Visible(panel);
        };
        inspect(widget->logicController);
        if (widget->secondaryControllers.size > 32) { s.complete = false; return; }
        for (const auto& controller : widget->secondaryControllers) inspect(controller);
        if (widget->GetNativeType()->IsA(compound)) {
            auto* c = reinterpret_cast<RED4ext::ink::CompoundWidget*>(widget.instance);
            const auto children = c->children;
            if (children) {
                if (children->children.size > 512) { s.complete = false; return; }
                for (const auto& child : children->children) self(self, child, depth + 1);
            }
        }
    };
    if (s.complete) for (const auto& manager : system->managers) {
        if (!manager || manager->layers.size > 64) { s.complete = false; break; }
        for (const auto& entry : manager->layers) {
            const auto layer = entry; // Keep only scoped SDK handles on the owning callback thread.
            if (!layer || !layer->active) continue;
            const RED4ext::Handle<RED4ext::ink::Widget> window(layer->window);
            const auto root = layer->libraryItem ? layer->libraryItem->rootWidget : RED4ext::Handle<RED4ext::ink::Widget>();
            if (menuVisible && (Within(menu, window) || Within(menu, root))) s.engagementVisible = true;
            if (!layer->GetNativeType()->IsA(loading)) continue;
            if (!root && !window) { s.complete = false; continue; }
            if (layer->libraryItem) scan(scan, layer->libraryItem->rootWidget, 0);
            if (window) scan(scan, window, 0);
        }
    }
    if (menuVisible && !s.engagementVisible) s.complete = false;
    json before, after;
    {
        std::scoped_lock lock(mutex);
        if (!enabled.load()) return;
        before = lifecycle::Describe(snapshot, snapshot.atMs);
        after = lifecycle::Describe(s, s.atMs);
        for (auto* key : {"generation", "ui_thread", "age_ms"}) { before.erase(key); after.erase(key); }
        s.generation = snapshot.generation + (before != after || owner != previousOwner ? 1 : 0);
        previousOwner = owner; snapshot = s;
    }
    if (before != after) Get().events.Push("lifecycle.prompt", "info", "ui", "Observed lifecycle prompt state changed", lifecycle::Describe(s, now));
}

void Detour(InkSystem* system, uint64_t value, void* buffer)
{
    // Observe before the original input callback, like Codeware's own read-only hook.
    try { CopyUi(system); } catch (...) { std::scoped_lock lock(mutex); snapshot.observed = false; }
    original(system, value, buffer);
}
#endif
}
void ObserveEngagementMenu(const RED4ext::Handle<RED4ext::ink::Widget>& widget)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!Get().config.allowTestHooks) return;
    std::scoped_lock lock(mutex);
    engagement = RED4ext::WeakHandle<RED4ext::ink::Widget>(widget); engagementKnown = true;
    snapshot.observed = false; ++snapshot.generation; // Invalidate prior menu lifetime immediately.
#else
    (void)widget;
#endif
}
json LifecycleStatus()
{
    std::scoped_lock lock(mutex);
    auto out = lifecycle::Describe(snapshot, GetTickCount64());
    out["observer_blocker"] = unavailable;
    out["coverage"] = "current native ink callback; bounded active loading trees and observed engagement menu; GSM acceptance unavailable";
    return out;
}
void InstallLifecycle(RED4ext::v1::PluginHandle handle, const RED4ext::v1::Sdk* sdk)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!Get().config.allowTestHooks || !sdk || !sdk->hooking) return;
    wchar_t path[32768]{}; GetModuleFileNameW(nullptr, path, 32768);
    std::string hash, error;
    if (!win32::FileSha256(path, hash, error, 64ull * 1024 * 1024) || hash != "a7de82945c03e041fc7339fcf9066224d98db2f5d80fea50f7947bb350a60991") {
        unavailable = "executable identity does not match R8 2.31; observer disabled"; return;
    }
    using Resolve = uintptr_t (*)(uint32_t);
    const auto module = GetModuleHandleW(L"RED4ext.dll");
    const auto resolve = module ? reinterpret_cast<Resolve>(GetProcAddress(module, "RED4ext_ResolveAddress")) : nullptr;
    const auto address = resolve ? resolve(673454961) : 0; // Codeware InkSystem_ProcessInputEvents
    HMODULE addressModule = nullptr;
    const bool inExe = address && GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        reinterpret_cast<LPCWSTR>(address), &addressModule) && addressModule == GetModuleHandleW(nullptr);
    if (!inExe || !sdk->hooking->Attach(handle, reinterpret_cast<void*>(address), reinterpret_cast<void*>(&Detour), reinterpret_cast<void**>(&original))) {
        unavailable = "native ink callback address/hook unavailable"; return;
    }
    hookAddress = address; unavailable.clear(); enabled.store(true);
#else
    (void)handle; (void)sdk;
#endif
}
void StopLifecycle()
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    enabled.store(false);
    if (hookAddress && Get().sdk && Get().sdk->hooking) {
        Get().sdk->hooking->Detach(Get().handle, reinterpret_cast<void*>(hookAddress)); hookAddress = 0;
    }
    std::scoped_lock lock(mutex); engagement = {}; snapshot.observed = false;
#endif
}
void InvalidateLifecycle()
{
    std::scoped_lock lock(mutex); snapshot.observed = false; ++snapshot.generation;
}
void RegisterLifecycle(Dispatcher& dispatcher)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    dispatcher.Register({"game.lifecycle.probe", Access::Read, RunOn::BridgeThread, "Read-only Start/UI_Skip plan; never invokes consumers.", [](const MethodContext& c) {
        if (!Get().config.allowTestHooks) throw MethodError("test_hooks_off", "Lifecycle probe requires allow_test_hooks.");
        params::RequireOnly(c.params, {"generation"});
        auto observed = LifecycleStatus();
        if (const auto generation = params::CheckInteger(c.params, "generation", 0, 9007199254740991LL); generation && *generation != observed["generation"].get<int64_t>())
            throw MethodError("precondition_failed", "Lifecycle snapshot changed; read the current detector generation.");
        auto out = lifecycle::Probe(observed);
        Get().events.Push("lifecycle.probe", "info", "bridge", "Read-only lifecycle route plan", out);
        return out;
    }});
#else
    (void)dispatcher;
#endif
}
}
