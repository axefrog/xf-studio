#include "plugin/Plugin.hpp"

#include <RED4ext/Api/v1/Logger.hpp>
#include <RED4ext/Version.hpp>

#include "core/BuildInfo.hpp"

namespace xfb::plugin
{
Red4extSink::Red4extSink(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk)
    : m_handle(aHandle)
    , m_sdk(aSdk)
{
}

void Red4extSink::Write(Level aLevel, const std::string& aLine)
{
    if (!m_sdk || !m_sdk->logger)
    {
        return;
    }
    switch (aLevel)
    {
    case Level::Error:
        m_sdk->logger->Error(m_handle, aLine.c_str());
        break;
    case Level::Warn:
        m_sdk->logger->Warn(m_handle, aLine.c_str());
        break;
    default:
        m_sdk->logger->Info(m_handle, aLine.c_str());
        break;
    }
}

State& Get()
{
    static State state;
    return state;
}

std::string GameStateName(int aState)
{
    switch (aState)
    {
    case 0:
        return "BaseInitialization";
    case 1:
        return "Initialization";
    case 2:
        return "Running";
    case 3:
        return "Shutdown";
    default:
        return "PreInit";
    }
}

uint64_t State::InkShownAsk() const
{
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - inkShownAtMs.load() <= kInkShownMs ? inkShownAsk.load() : 0;
}

bool State::InkVisible() const
{
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - inkShownAtMs.load() <= kInkShownMs && inkVisible.load();
}

uint64_t State::InkKeysAsk() const
{
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - inkShownAtMs.load() <= kInkShownMs ? inkKeysAsk.load() : 0;
}

inkui::BridgeView BridgeViewNow()
{
    auto& state = Get();
    inkui::BridgeView view;
    view.pluginEnabled = state.config.bridgeEnabled;
    view.allowWrites = state.config.allowWrites;
    view.scriptReady = state.scriptLayer.Ready();
    if (state.bridge)
    {
        auto& dispatcher = state.bridge->GetDispatcher();
        view.killed = dispatcher.IsKilled();
        view.writesPaused = dispatcher.WritesPaused();
        view.listening = state.bridge->IsListening();
        view.hasClient = state.bridge->HasClient();
        view.inSession = state.bridge->InSession();
    }
    return view;
}

std::string HudFrame()
{
    // 0.8: made in one place (core BuildFrame), shared with the self-test's selftest.hud.
    auto& state = Get();
    return inkui::BuildFrame(state.hud.Current(), BridgeViewNow(), state.messages, state.config.answerKeys, state.InkShownAsk(),
                             static_cast<inkui::StatusSurface>(state.statusSurface.load()), state.InkKeysAsk());
}

nlohmann::json InfoJson()
{
    auto& state = Get();
    return nlohmann::json{
        {"plugin", "XF Runtime Bridge"},
        {"plugin_version", XFB_VERSION_STRING},
        {"build_commit", std::string(BuildCommit())},
        {"build_dirty", BuildDirty()},
        {"protocol", kProtocolVersion},
        {"sid", state.session.sessionId},
        {"sdk_version", std::to_string(RED4EXT_VER_MAJOR) + "." + std::to_string(RED4EXT_VER_MINOR) + "." +
                            std::to_string(RED4EXT_VER_PATCH)},
        {"game_product_version", state.gameProductVersion},
        {"game_file_version", state.gameFileVersion},
        {"game_state", GameStateName(state.gameState.load())},
        {"running_ticks", state.runningTicks.load()},
        {"bridge", state.bridge ? state.bridge->Status()
                                : nlohmann::json{{"enabled", state.config.bridgeEnabled}, {"listening", false}}},
        {"allow_creator_leave", state.config.allowCreatorLeave},
        {"allow_live_pose", state.config.allowLivePose},
        {"restore_pending", state.restore.Pending()},
        {"script_layer", state.scriptLayer.Describe()},
        {"rearm_pending", state.rearmRequested.load()},
        // 0.7: the overlay host's switches (the CET window takes its theme from here) and the answer keys.
        {"overlay", {{"enabled", state.config.overlayEnabled}, {"theme", state.config.overlayTheme}, {"phase", xfb::overlay::PhaseName(state.overlayHost.CurrentPhase())},
                     // 0.8 (the UI review): the CET label says so when frame generation keeps the overlay off.
                     {"off_for_frame_generation", state.overlayHost.OffForFrameGeneration()},
                     {"diagnostics", state.config.overlayDiagnostics}}},
        // 0.8 (the UI review): the status wording every surface shows, made in one place (core/InkUi.cpp Summarize).
        {"status", inkui::StatusJson(BridgeViewNow())},
        // 0.8.2: which status surface shows now (ink_panel, overlay_panel or status_label).
        {"status_surface", inkui::SurfaceName(static_cast<inkui::StatusSurface>(state.statusSurface.load()))},
        {"answer_keys", state.config.answerKeys},
        {"last_rearm", [&state] {
             std::scoped_lock _(state.rearmMutex);
             return state.lastRearm;
         }()}};
}
} // namespace xfb::plugin
