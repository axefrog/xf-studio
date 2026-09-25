#pragma once

// Process-wide plugin state. Created in Main(Load), torn down in Main(Unload).

#include <atomic>
#include <filesystem>
#include <memory>
#include <string>

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>

#include "core/Bridge.hpp"
#include "core/Config.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Layers.hpp"
#include "core/Log.hpp"
#include "core/Session.hpp"

namespace xfb::plugin
{
// Writes our structured lines through RED4ext's per-plugin logger:
// red4ext/logs/xfruntimebridge-<timestamp>.log, rotating_file_sink_mt bounded by RED4ext's
// [logging] max_file_size (MB) and max_files. We filter levels ourselves and emit debug lines
// at Info, because RED4ext's default level (info) would otherwise drop them and we must not
// change the user's RED4ext config.
class Red4extSink : public ILogSink
{
public:
    Red4extSink(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk);
    void Write(Level aLevel, const std::string& aLine) override;

private:
    RED4ext::v1::PluginHandle m_handle;
    const RED4ext::v1::Sdk* m_sdk;
};

struct State
{
    RED4ext::v1::PluginHandle handle = nullptr;
    const RED4ext::v1::Sdk* sdk = nullptr;
    std::unique_ptr<Red4extSink> sink;

    std::filesystem::path pluginDir;
    Config config;
    Session session;
    GameThreadQueue queue;
    LayerRegistry layers;
    std::unique_ptr<Bridge> bridge;

    std::string gameProductVersion; // sdk->runtime (product version, e.g. 2.3.1)
    std::string gameFileVersion;    // exe version resource (e.g. 3.0.80.51928)
    std::atomic<int> gameState{-1}; // RED4ext::EGameStateType, -1 before BaseInitialization
    std::atomic<uint64_t> runningTicks{0};
};

State& Get();
std::string GameStateName(int aState);
nlohmann::json InfoJson();
} // namespace xfb::plugin
