// XF Runtime Bridge: RED4ext plugin entry points.
//
// Loader contract (RED4ext v1.30.0, SDK tag 1.0.0):
//  - Supports() returns the API version; Query() fills PluginInfo; Main() gets Load/Unload.
//    (RED4ext src/dll/Systems/PluginSystem.cpp:223-321; SDK examples/*/Main.cpp)
//  - runtime = RED4EXT_V1_RUNTIME_VERSION_LATEST (2.31, 3.0.80.51928): RED4ext refuses the
//    plugin on any other game build (PluginSystem.cpp:270-294), which is what we want for code
//    that calls into the game through the SDK.
//  - Game-state callbacks: an OnUpdate that returns true is removed from the list
//    (StateSystem.cpp:128-160), so the Running OnUpdate returns false to stay registered.
//  - Scripts: sdk->scripts->Add(handle, L"Scripts") adds <plugin dir>/Scripts to redscript's
//    compilation (v1/Funcs.cpp:123-139, ScriptCompilationSystem.cpp:101-134), so the .reds files
//    that declare our natives only compile when this DLL is loaded.
//
// Every function the game or RED4ext calls (exports, state callbacks, RTTI callbacks) runs its
// body inside a catch-all: a C++ exception must never unwind into game code. A failure while
// loading leaves the plugin loaded with the bridge off (fail closed), because returning false
// after RTTI callbacks were registered would leave RED4ext holding pointers into an unloaded DLL.

// RED4ext.hpp first: it includes Common.hpp, which switches the SDK to header-only mode.
#include <RED4ext/RED4ext.hpp>

#include <RED4ext/Api/ApiVersion.hpp>
#include <RED4ext/Api/v1/EMainReason.hpp>
#include <RED4ext/Api/v1/PluginInfo.hpp>
#include <RED4ext/Api/v1/Runtime.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>
#include <RED4ext/Api/v1/Version.hpp>

#include "core/BuildInfo.hpp"
#include "core/Win32.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/LivePoseMemory.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"
#include "plugin/ScriptCall.hpp"

namespace
{
using namespace xfb;
using namespace xfb::plugin;

constexpr uint64_t kHeartbeatTicks = 60ull * 60ull * 10ull; // about every 10 minutes at 60 fps
constexpr uint64_t kRearmPatienceTicks = 600;                 // about 10 s at 60 fps for the old listener and restore

void RecordRearm(State& aState, bool aOk, const std::string& aMessage)
{
    std::scoped_lock _(aState.rearmMutex);
    aState.lastRearm = nlohmann::json{{"ok", aOk}, {"message", aMessage}, {"at_tick", aState.runningTicks.load()}};
}

// Reconnect after the kill switch (XFBridge_Rearm), on the game thread between queue drains. Waits (a few
// seconds at most) until the old listener has stopped and the kill switch's restore has run, then gives
// the bridge a new session (new token, pipe name and session id) and starts it again.
void HandleRearm(State& aState)
{
    if (!aState.rearmRequested.load() || !aState.bridge)
    {
        return;
    }
    const auto waited = aState.runningTicks.load() - aState.rearmRequestedAt.load();
    const auto refusal = aState.bridge->RearmRefusal();
    const bool waitable = !refusal.empty() && aState.bridge->GetDispatcher().IsKilled();
    if ((waitable || aState.restore.Pending()) && waited < kRearmPatienceTicks)
    {
        return; // the listener is still closing, or the restore hasn't run yet: try again next tick
    }
    aState.rearmRequested.store(false);
    if (!refusal.empty())
    {
        RecordRearm(aState, false, refusal);
        log::Warn("bridge.rearm_refused", "why=" + refusal);
        return;
    }
    if (!aState.restore.Reset())
    {
        const std::string why = "the kill switch's restore hasn't finished; try again in a moment";
        RecordRearm(aState, false, why);
        log::Warn("bridge.rearm_refused", "why=restore_pending");
        return;
    }
    aState.options.Reset();
    std::string error;
    const bool ok = aState.bridge->Rearm(
        [&aState](std::string& aError) {
            if (!CreateSession(aState.session, aError))
            {
                return false;
            }
            log::SetSessionId(aState.session.sessionId);
            log::Info("bridge.new_session", "reason=rearm pid=" + std::to_string(aState.session.processId));
            return true;
        },
        aState.queue.IsPumping() || aState.gameState.load() == 2, error);
    RecordRearm(aState, ok, ok ? "reconnected: a new session is listening; clients read the new session.json" : error);
    if (!ok)
    {
        log::Error("bridge.rearm_failed", error);
    }
}
constexpr size_t kMaxTasksPerTick = 4;

// Runs a callback body; logs and swallows anything it throws. Returns aFallback on failure.
template<typename F>
bool Guarded(const char* aWhere, bool aFallback, F&& aBody) noexcept
{
    try
    {
        return aBody();
    }
    catch (const std::exception& e)
    {
        log::Error("plugin.callback_failed", std::string("where=") + aWhere + " what=" + e.what());
    }
    catch (...)
    {
        log::Error("plugin.callback_failed", std::string("where=") + aWhere + " what=unknown");
    }
    return aFallback;
}

void OnStateEvent(int aState, const char* aEvent)
{
    Get().gameState.store(aState);
    log::Info("game.state", std::string("state=") + GameStateName(aState) + " event=" + aEvent);
}

bool OnBaseInitEnter(RED4ext::CGameApplication*)
{
    return Guarded("BaseInitialization.enter", true, [] {
        OnStateEvent(0, "enter");
        return true;
    });
}
bool OnBaseInitExit(RED4ext::CGameApplication*)
{
    return Guarded("BaseInitialization.exit", true, [] {
        OnStateEvent(0, "exit");
        return true;
    });
}
bool OnInitEnter(RED4ext::CGameApplication*)
{
    return Guarded("Initialization.enter", true, [] {
        OnStateEvent(1, "enter");
        return true;
    });
}
bool OnInitExit(RED4ext::CGameApplication*)
{
    return Guarded("Initialization.exit", true, [] {
        OnStateEvent(1, "exit");
        return true;
    });
}

bool OnRunningEnter(RED4ext::CGameApplication*)
{
    return Guarded("Running.enter", true, [] {
        OnStateEvent(2, "enter");
        Get().queue.SetPumping(true);
        return true;
    });
}

bool OnRunningUpdate(RED4ext::CGameApplication*)
{
    // false keeps the callback registered (RED4ext removes callbacks that return true),
    // including after a failure.
    return Guarded("Running.update", false, [] {
        auto& state = Get();
        NoteGameThread();
        const auto tick = state.runningTicks.fetch_add(1) + 1;
        if (tick == 1)
        {
            log::Info("game.running_first_tick", "game thread is pumping bridge requests");
        }
        else if (tick % kHeartbeatTicks == 0)
        {
            log::Debug("game.heartbeat", "running_ticks=" + std::to_string(tick));
        }
        const auto ran = state.queue.Drain(kMaxTasksPerTick);
        if (ran > 0)
        {
            log::Debug("game.drained", "tasks=" + std::to_string(ran));
        }
        // Every call this tick makes into the game's scripts waits for a live scripted session (RB-76: session 5
        // crashed on a script call made just after the script layer detached for a load).
        const bool scriptsReady = state.scriptLayer.Ready();
        if (state.scriptLayer.TakeDetaches() > 0 && state.relockOwed.exchange(false))
        {
            // The session game.save released the lock in is gone, and with it every change the lock protected.
            log::Info("game.save_relock_dropped", "reason=session_detached (a load discards the bridge's changes)", "save-relock");
        }
        // Kill switch: Bridge::Kill closes the queue before RestoreReady() is true, so no queued
        // write can run after this undo; RestoreOnce runs it here directly, once, after a write,
        // and only once the game's scripts can be called (it waits through a load).
        if (state.bridge && state.bridge->RestoreReady())
        {
            state.options.Cancel(); // no render-option request survives the kill switch
        }
        state.restore.Tick(state.bridge && state.bridge->RestoreReady() && scriptsReady, &RestoreAfterKill,
                           [](const std::string& aWhat) { log::Warn("bridge.kill_restore_failed", "what=" + aWhat, "kill-restore"); });
        // A save lock game.save released and couldn't retake through the queue (RB-52). Runs even after
        // the kill switch: the lock is the one thing the kill switch keeps. Waits for the scripts, like the restore.
        if (scriptsReady)
        {
            try
            {
                RetakeOwedSaveLock();
            }
            catch (const std::exception& e)
            {
                log::Warn("game.save_relock_failed", std::string("what=") + e.what(), "save-relock");
            }
        }
        HandleRearm(state);
        // A client dropped for idleness can't be driving photo mode any more: give the cursor back
        // (RB-34). Only after a write, since only a write hides it. Between sessions there is no cursor flag to
        // release (the registry holding it goes with the session).
        if (state.bridge && state.bridge->TakeIdleDisconnect() && state.restore.WritesUsed() && !state.restore.Done())
        {
            if (!scriptsReady)
            {
                log::Info("bridge.idle_cursor_release_skipped", "reason=scripts_not_ready", "idle-release");
            }
            else
            {
                try
                {
                    ReleaseCursorAfterIdle();
                }
                catch (const std::exception& e)
                {
                    log::Warn("bridge.idle_cursor_release_failed", std::string("what=") + e.what(), "idle-release");
                }
            }
        }
        return false;
    });
}

bool OnRunningExit(RED4ext::CGameApplication*)
{
    return Guarded("Running.exit", true, [] {
        Get().queue.SetPumping(false);
        OnStateEvent(2, "exit");
        return true;
    });
}

bool OnShutdownEnter(RED4ext::CGameApplication*)
{
    return Guarded("Shutdown.enter", true, [] {
        OnStateEvent(3, "enter");
        auto& state = Get();
        state.queue.Close();
        if (state.bridge)
        {
            state.bridge->Stop("game_shutdown");
        }
        return true;
    });
}
bool OnShutdownExit(RED4ext::CGameApplication*)
{
    return Guarded("Shutdown.exit", true, [] {
        OnStateEvent(3, "exit");
        return true;
    });
}

void RegisterStates(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk)
{
    static RED4ext::v1::GameState baseInit{&OnBaseInitEnter, nullptr, &OnBaseInitExit};
    static RED4ext::v1::GameState init{&OnInitEnter, nullptr, &OnInitExit};
    static RED4ext::v1::GameState running{&OnRunningEnter, &OnRunningUpdate, &OnRunningExit};
    static RED4ext::v1::GameState shutdown{&OnShutdownEnter, nullptr, &OnShutdownExit};

    const bool ok = aSdk->gameStates->Add(aHandle, RED4ext::EGameStateType::BaseInitialization, &baseInit) &&
                    aSdk->gameStates->Add(aHandle, RED4ext::EGameStateType::Initialization, &init) &&
                    aSdk->gameStates->Add(aHandle, RED4ext::EGameStateType::Running, &running) &&
                    aSdk->gameStates->Add(aHandle, RED4ext::EGameStateType::Shutdown, &shutdown);
    if (ok)
    {
        log::Info("plugin.states_registered", "states=BaseInitialization,Initialization,Running,Shutdown");
    }
    else
    {
        log::Error("plugin.states_failed", "gameStates->Add returned false");
    }
}

void OnRegisterTypes()
{
    Guarded("rtti.register", true, [] {
        RegisterTypes();
        return true;
    });
}

void OnPostRegisterTypes()
{
    Guarded("rtti.post_register", true, [] {
        PostRegisterTypes();
        return true;
    });
}

std::string SemVerText(const RED4ext::v1::SemVer* aVersion)
{
    if (!aVersion)
    {
        return "unknown";
    }
    return std::to_string(aVersion->major) + "." + std::to_string(aVersion->minor) + "." +
           std::to_string(aVersion->patch);
}

void StartBridge(State& aState)
{
    std::string error;
    aState.bridge = std::make_unique<Bridge>(aState.config, aState.session, aState.queue);
    RegisterMethods(aState.bridge->GetDispatcher());
    if (aState.bridge->Start(error))
    {
        log::Info("bridge.enabled", std::string("allow_writes=") + (aState.config.allowWrites ? "true" : "false"));
    }
    else
    {
        log::Error("bridge.start_failed", error);
        aState.bridge.reset();
    }
}

bool Load(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk)
{
    auto& state = Get();
    state.handle = aHandle;
    state.sdk = aSdk;
    state.sink = std::make_unique<Red4extSink>(aHandle, aSdk);
    log::SetSink(state.sink.get());

    std::string error;
    if (!CreateSession(state.session, error))
    {
        log::Error("plugin.session_failed", error);
        // Keep going: natives and logging still work without a session id.
    }
    log::SetSessionId(state.session.sessionId.empty() ? "-" : state.session.sessionId);

    state.pluginDir = win32::ModuleDirectory(reinterpret_cast<const void*>(&Load));
    state.config = LoadConfig(state.pluginDir / L"config.ini");
    log::SetMinLevel(state.config.logLevel);
    {
        // The ink HUD panel's starting settings (bridge 0.5.3, temporary test feature; ui.hud changes them).
        inkui::HudSettings hud;
        hud.show = state.config.hudPanel;
        hud.cetLabel = state.config.cetLabel;
        hud.nameplates = state.config.nameplates;
        state.hud.SetDefaults(hud);
    }

    state.gameProductVersion = SemVerText(aSdk->runtime);
    win32::FileVersion(win32::ProcessImagePath(), state.gameFileVersion);

    log::Info("plugin.load", std::string("name=\"XF Runtime Bridge\" version=") + XFB_VERSION_STRING +
                                 " build=" + std::string(BuildCommit()) + (BuildDirty() ? "+dirty" : "") +
                                 " protocol=" + std::to_string(kProtocolVersion) + " sdk=" +
                                 std::to_string(RED4EXT_VER_MAJOR) + "." + std::to_string(RED4EXT_VER_MINOR) + "." +
                                 std::to_string(RED4EXT_VER_PATCH) + " game_product=" + state.gameProductVersion +
                                 " game_file=" + state.gameFileVersion + " pid=" +
                                 std::to_string(state.session.processId));
    // The same marker tools/package.ts reads from the DLL file, so a log names its exact build.
    log::Info("plugin.build", BuildMarker());
    log::Info("plugin.config", DescribeConfig(state.config));
    for (const auto& warning : state.config.warnings)
    {
        log::Warn("plugin.config_warning", warning);
    }

    // Every engine address a game call needs, resolved now rather than lazily at the first call, where a
    // missing one would end the game (RB-32). Without them the bridge still runs, refusing game methods.
    ResolveScriptCallAddresses();
    // Every game-thread method and step waits for a live scripted session, checked right before it runs (RB-76).
    SetGameGate([](const std::string& aWhat) { Get().scriptLayer.Require(aWhat); });
    live::ResolveAddresses(); // the live-pose commands' own engine addresses (refused for the session if missing)

    RegisterStates(aHandle, aSdk);

    auto* rtti = RED4ext::CRTTISystem::Get();
    rtti->AddRegisterCallback(&OnRegisterTypes);
    rtti->AddPostRegisterCallback(&OnPostRegisterTypes);
    log::Info("plugin.rtti_callbacks", "registered=true");

    if (aSdk->scripts && aSdk->scripts->Add(aHandle, L"Scripts"))
    {
        log::Info("plugin.scripts", "path=<plugin dir>/Scripts added_to_redscript=true");
    }
    else
    {
        log::Error("plugin.scripts", "path=<plugin dir>/Scripts added_to_redscript=false (folder missing?)");
    }

    if (state.config.bridgeEnabled && !state.session.token.empty())
    {
        StartBridge(state);
    }
    else if (state.config.bridgeEnabled)
    {
        log::Error("bridge.start_failed", "no session (see plugin.session_failed); the bridge stays off");
    }
    else
    {
        log::Info("bridge.disabled", "set [bridge] enabled = true in config.ini to open the local pipe");
    }
    return true;
}

void Unload()
{
    auto& state = Get();
    log::Info("plugin.unload", "requests_served=" +
                                   std::to_string(state.bridge ? state.bridge->GetDispatcher().RequestCount() : 0));
    state.queue.Close();
    if (state.bridge)
    {
        state.bridge->Stop("plugin_unload");
        state.bridge.reset();
    }
    log::SetSink(nullptr);
    state.sink.reset();
}

// Fail closed: whatever went wrong, no pipe stays open.
void DisableBridgeAfterFailure() noexcept
{
    try
    {
        auto& state = Get();
        state.queue.Close();
        if (state.bridge)
        {
            state.bridge->Stop("load_failed");
            state.bridge.reset();
        }
    }
    catch (...)
    {
    }
}
} // namespace

RED4EXT_C_EXPORT bool RED4EXT_CALL Main(RED4ext::v1::PluginHandle aHandle, RED4ext::v1::EMainReason aReason,
                                        const RED4ext::v1::Sdk* aSdk)
{
    try
    {
        switch (aReason)
        {
        case RED4ext::v1::EMainReason::Load:
            return Load(aHandle, aSdk);
        case RED4ext::v1::EMainReason::Unload:
            Unload();
            break;
        }
    }
    catch (const std::exception& e)
    {
        log::Error("plugin.main_failed", std::string("what=") + e.what() + " bridge=disabled");
        DisableBridgeAfterFailure();
    }
    catch (...)
    {
        log::Error("plugin.main_failed", "what=unknown bridge=disabled");
        DisableBridgeAfterFailure();
    }
    return true;
}

RED4EXT_C_EXPORT void RED4EXT_CALL Query(RED4ext::v1::PluginInfo* aInfo)
{
    // Constant data only; nothing here can throw.
    aInfo->name = L"XF Runtime Bridge";
    aInfo->author = L"XF Studio";
    aInfo->version = RED4EXT_V1_SEMVER(XFB_VERSION_MAJOR, XFB_VERSION_MINOR, XFB_VERSION_PATCH);
    aInfo->runtime = RED4EXT_V1_RUNTIME_VERSION_LATEST;
    aInfo->sdk = RED4EXT_V1_SDK_VERSION_CURRENT;
}

RED4EXT_C_EXPORT uint32_t RED4EXT_CALL Supports()
{
    return RED4EXT_API_VERSION_1;
}
