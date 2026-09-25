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
                                : nlohmann::json{{"enabled", false}, {"listening", false}}}};
}
} // namespace xfb::plugin
