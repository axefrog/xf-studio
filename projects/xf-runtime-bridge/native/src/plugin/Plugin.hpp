#pragma once

// Process-wide plugin state. Created in Main(Load), torn down in Main(Unload).

#include <atomic>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>

#include "core/Behaviours.hpp"
#include "core/Bridge.hpp"
#include "core/Events.hpp"
#include "core/Player.hpp"
#include "core/Config.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/InkUi.hpp"
#include "core/Layers.hpp"
#include "core/Log.hpp"
#include "core/Messages.hpp"
#include "core/OptionsExchange.hpp"
#include "core/ScriptLayer.hpp"
#include "core/Session.hpp"
#include "core/Writes.hpp"

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

    // Marked by every write; after the kill switch it undoes what the bridge left on (world
    // freeze, hidden photo UI; not the save lock) once, from a game-thread tick (core/Writes.hpp).
    writes::RestoreOnce restore;

    // game.save with override_lock: set when the save lock couldn't be taken back through the queue
    // (the kill switch closed it, a timeout); the next Running tick retakes it directly (RB-52).
    std::atomic<bool> relockOwed{false};

    // Whether the game's scripts may be called now (bridge 0.5.2, RB-76): moved by our redscript layer's lifecycle
    // (XFBridge_ScriptLayer) and by game.load; checked right before every script call (ScriptCall.cpp, the
    // dispatcher's game gate) and before the Running tick's own calls (Main.cpp).
    ScriptLayer scriptLayer;

    // game.options.read's render options: requested by the bridge, answered by the CET layer
    // (XFBridge_OptionsWanted / XFBridge_OptionsReport). Cancelled by the kill switch.
    OptionsExchange options;

    // ui.message: the coordinator's short messages under the in-game label, read by the CET layer
    // (XFBridge_Messages). Cleared by the kill switch; a killed bridge shows none.
    MessageBoard messages;

    // Bridge 0.6: the session event stream (session.events; XFBridge_Note adds notes from the game), the behaviour runner
    // (behave.*, ticked on the game thread from the Running update) and player.teleport's pacer (2 a second).
    EventLog events;
    behave::Runner behaviours;
    player::TeleportPacer teleports;

    // Bridge 0.5.3, temporary test feature: the ink HUD panel's settings (ui.hud), read with the bridge's state and the
    // message lines by the redscript layer through XFBridge_Hud (core/InkUi.hpp). Defaults from [ui] in config.ini.
    inkui::HudPanel hud;

    // Reconnect after the kill switch (the CET panel's button, XFBridge_Rearm): requested from script,
    // carried out by the next Running ticks once the old listener has stopped and the kill switch's
    // restore has run (Main.cpp). The outcome is reported through XFBridge_Info (last_rearm).
    std::atomic<bool> rearmRequested{false};
    std::atomic<uint64_t> rearmRequestedAt{0}; // running tick of the request
    std::mutex rearmMutex;
    nlohmann::json lastRearm; // {ok, message, at_tick} or null; guarded by rearmMutex
};

State& Get();
std::string GameStateName(int aState);
nlohmann::json InfoJson();
// XFBridge_Hud's answer: the panel's settings, the bridge's state and the message lines as a text frame (core/InkUi.hpp).
std::string HudFrame();
} // namespace xfb::plugin
