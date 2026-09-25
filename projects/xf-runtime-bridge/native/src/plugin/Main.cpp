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

// RED4ext.hpp first: it includes Common.hpp, which switches the SDK to header-only mode.
#include <RED4ext/RED4ext.hpp>

#include <RED4ext/Api/ApiVersion.hpp>
#include <RED4ext/Api/v1/EMainReason.hpp>
#include <RED4ext/Api/v1/PluginInfo.hpp>
#include <RED4ext/Api/v1/Runtime.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>
#include <RED4ext/Api/v1/Version.hpp>

#include "core/Win32.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"

namespace
{
using namespace xfb;
using namespace xfb::plugin;

constexpr uint64_t kHeartbeatTicks = 60ull * 60ull * 10ull; // about every 10 minutes at 60 fps
constexpr size_t kMaxTasksPerTick = 4;

void OnStateEvent(int aState, const char* aEvent)
{
    Get().gameState.store(aState);
    log::Info("game.state", std::string("state=") + GameStateName(aState) + " event=" + aEvent);
}

bool OnBaseInitEnter(RED4ext::CGameApplication*)
{
    OnStateEvent(0, "enter");
    return true;
}
bool OnBaseInitExit(RED4ext::CGameApplication*)
{
    OnStateEvent(0, "exit");
    return true;
}
bool OnInitEnter(RED4ext::CGameApplication*)
{
    OnStateEvent(1, "enter");
    return true;
}
bool OnInitExit(RED4ext::CGameApplication*)
{
    OnStateEvent(1, "exit");
    return true;
}

bool OnRunningEnter(RED4ext::CGameApplication*)
{
    OnStateEvent(2, "enter");
    Get().queue.SetPumping(true);
    return true;
}

bool OnRunningUpdate(RED4ext::CGameApplication*)
{
    auto& state = Get();
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
    return false; // stay registered (RED4ext removes callbacks that return true)
}

bool OnRunningExit(RED4ext::CGameApplication*)
{
    Get().queue.SetPumping(false);
    OnStateEvent(2, "exit");
    return true;
}

bool OnShutdownEnter(RED4ext::CGameApplication*)
{
    OnStateEvent(3, "enter");
    auto& state = Get();
    state.queue.Close();
    if (state.bridge)
    {
        state.bridge->Stop("game_shutdown");
    }
    return true;
}
bool OnShutdownExit(RED4ext::CGameApplication*)
{
    OnStateEvent(3, "exit");
    return true;
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

std::string SemVerText(const RED4ext::v1::SemVer* aVersion)
{
    if (!aVersion)
    {
        return "unknown";
    }
    return std::to_string(aVersion->major) + "." + std::to_string(aVersion->minor) + "." +
           std::to_string(aVersion->patch);
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

    state.gameProductVersion = SemVerText(aSdk->runtime);
    win32::FileVersion(win32::ProcessImagePath(), state.gameFileVersion);

    log::Info("plugin.load", std::string("name=\"XF Runtime Bridge\" version=") + XFB_VERSION_STRING +
                                 " protocol=" + std::to_string(kProtocolVersion) + " sdk=" +
                                 std::to_string(RED4EXT_VER_MAJOR) + "." + std::to_string(RED4EXT_VER_MINOR) + "." +
                                 std::to_string(RED4EXT_VER_PATCH) + " game_product=" + state.gameProductVersion +
                                 " game_file=" + state.gameFileVersion + " pid=" +
                                 std::to_string(state.session.processId));
    log::Info("plugin.config", DescribeConfig(state.config));
    for (const auto& warning : state.config.warnings)
    {
        log::Warn("plugin.config_warning", warning);
    }

    RegisterStates(aHandle, aSdk);

    auto* rtti = RED4ext::CRTTISystem::Get();
    rtti->AddRegisterCallback(&RegisterTypes);
    rtti->AddPostRegisterCallback(&PostRegisterTypes);
    log::Info("plugin.rtti_callbacks", "registered=true");

    if (aSdk->scripts && aSdk->scripts->Add(aHandle, L"Scripts"))
    {
        log::Info("plugin.scripts", "path=<plugin dir>/Scripts added_to_redscript=true");
    }
    else
    {
        log::Error("plugin.scripts", "path=<plugin dir>/Scripts added_to_redscript=false (folder missing?)");
    }

    if (state.config.bridgeEnabled)
    {
        state.bridge = std::make_unique<Bridge>(state.config, state.session, state.queue);
        RegisterMethods(state.bridge->GetDispatcher());
        if (state.bridge->Start(error))
        {
            log::Info("bridge.enabled", std::string("allow_writes=") + (state.config.allowWrites ? "true" : "false"));
        }
        else
        {
            log::Error("bridge.start_failed", error);
            state.bridge.reset();
        }
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
} // namespace

RED4EXT_C_EXPORT bool RED4EXT_CALL Main(RED4ext::v1::PluginHandle aHandle, RED4ext::v1::EMainReason aReason,
                                        const RED4ext::v1::Sdk* aSdk)
{
    switch (aReason)
    {
    case RED4ext::v1::EMainReason::Load:
        return Load(aHandle, aSdk);
    case RED4ext::v1::EMainReason::Unload:
        Unload();
        break;
    }
    return true;
}

RED4EXT_C_EXPORT void RED4EXT_CALL Query(RED4ext::v1::PluginInfo* aInfo)
{
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
