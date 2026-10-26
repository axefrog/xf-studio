#pragma once

// Process-wide plugin state. Created in Main(Load), torn down in Main(Unload).

#include <atomic>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>

#include "core/Behaviours.hpp"
#include "core/CetPanel.hpp"
#include "core/LayoutGuard.hpp"
#include "core/PinViews.hpp"
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
#include "core/Probes.hpp"
#include "core/ScriptLayer.hpp"
#include "core/Session.hpp"
#include "core/Writes.hpp"
#include "core/overlay/Host.hpp"

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
    // 0.8.5: which questions have had their sound ([ui] question_sound); the Running tick's only (game thread).
    QuestionChime questionChime;

    // Bridge 0.6: the session event stream (session.events; XFBridge_Note adds notes from the game), the behaviour runner
    // (behave.*, ticked on the game thread from the Running update) and player.teleport's pacer (2 a second).
    EventLog events;
    behave::Runner behaviours;
    player::TeleportPacer teleports;
    // 0.8.2: player.stop's count (core/Player.hpp StopCount), checked by player.look's and player.teleport's later steps.
    player::StopCount playerStops;

    // Bridge 0.5.3, temporary test feature: the ink HUD panel's settings (ui.hud), read with the bridge's state and the
    // message lines by the redscript layer through XFBridge_Hud (core/InkUi.hpp). Defaults from [ui] in config.ini.
    inkui::HudPanel hud;

    // 0.7: whether Cyber Engine Tweaks' overlay is open (XFBridge_CetOverlay from the CET layer), and whether the CET layer
    // has reported it at all (older CET layers never do).
    std::atomic<bool> cetOverlayOpen{false};
    std::atomic<bool> cetOverlaySeen{false};
    // 0.8.22: cet.panel's requests to the CET window and the CET layer's report of what it drew (XFBridge_CetPanel).
    cetpanel::Channel cetPanel;

    // 0.8 (the UI review: the question showed three times): the question the ink panel reports drawing on screen now
    // (XFBridge_InkDrawn, about five times a second while it draws one) and when, in steady-clock milliseconds; stale after
    // kInkShownMs. The CET label then shows only the status and the answer keys.
    static constexpr int64_t kInkShownMs = 1500;
    std::atomic<uint64_t> inkShownAsk{0};
    std::atomic<int64_t> inkShownAtMs{0};
    // 0.8.2: whether the ink panel reported itself on screen (its HUD shown), with the same staleness; and the status surface
    // chosen this tick (core/InkUi.hpp ChooseStatusSurface).
    std::atomic<bool> inkVisible{false};
    std::atomic<int> statusSurface{static_cast<int>(inkui::StatusSurface::None)};
    bool InkVisible() const;
    // 0.8.2 (the review): the question the ink panel holds with its answer keys (reported whether or not it is on screen), so
    // its keys answer it; 0 when stale or none.
    std::atomic<uint64_t> inkKeysAsk{0};
    uint64_t InkKeysAsk() const;
    uint64_t InkShownAsk() const;

    // 0.8.3: the bridge's own kill key's press detection (game thread only; Main.cpp PollKillKey).
    killkey::Watch killKeyWatch;
    // 0.8.4: the kill key can be changed from the XF Runtime Bridge window (XFBridge_KillKey) while the game runs, so after
    // load config.killKey is read and written only under this lock, with what else may react to it (core FindConflicts).
    std::mutex killKeyMutex;
    killkey::Conflicts killKeyConflicts;
    std::atomic<bool> killKeyChanged{false}; // the press detection starts afresh (a release first) after a change
    killkey::Chord KillKey();

    // 0.8.4, test hook (test.save.delay; the -writes package only): the next game.save's hold after prepare, in ms; taken once.
    std::atomic<int32_t> saveHoldMs{0};

    // 0.7: the XF ImGui overlay host (P0, draw-only; core/overlay/Host.hpp, plugin/Overlay.cpp), configured from [overlay].
    xfb::overlay::OverlayHost overlayHost;

    // Reconnect after the kill switch (the CET panel's button, XFBridge_Rearm): requested from script,
    // carried out by the next Running ticks once the old listener has stopped and the kill switch's
    // restore has run (Main.cpp). The outcome is reported through XFBridge_Info (last_rearm).
    std::atomic<bool> rearmRequested{false};
    std::atomic<uint64_t> rearmRequestedAt{0}; // running tick of the request
    std::mutex rearmMutex;
    nlohmann::json lastRearm; // {ok, code (0.8.6), message, at_tick} or null; guarded by rearmMutex

    // 0.8.7: the player's own saves refused while the bridge's save lock held (XFBridge_SaveRefused: how many, when, in steady
    // milliseconds), and the XF Runtime Bridge window's Save anyway (XFBridge_SaveAnyway): one at a time, on its own thread
    // (joined at unload), with its outcome for the window (a sequence number and plain text, under saveAnywayMutex).
    std::atomic<uint64_t> saveRefusals{0};
    std::atomic<int64_t> saveRefusedAtMs{0};
    std::atomic<bool> saveAnywayRunning{false};
    std::mutex saveAnywayMutex;
    std::thread saveAnywayThread;
    uint64_t saveAnywaySeq = 0;
    std::string saveAnywayLast;

    // 0.8.7, test probes ([bridge] allow_test_hooks; core/Probes.hpp): the game-events and save-identity probes' ring
    // (XFBridge_Event, test.events), and their switches (XFBridge_ProbeFlags: 2 the stim tap, 4 the BeforeSave write armed).
    probes::ProbeRing probeEvents;
    std::atomic<int32_t> probeSwitches{0};

    // 0.8.9 (the Sol review, finding 3): the views that have drawn each XF pin, OR-ed under one lock (XFBridge_PinDrawn).
    PinViews pinViews;
};

State& Get();
std::string GameStateName(int aState);
nlohmann::json InfoJson();
// XFBridge_Hud's answer: the panel's settings, the bridge's state and the message lines as a text frame (core/InkUi.hpp).
std::string HudFrame();
// 0.8: the bridge's state as every panel's status line reads it (core/InkUi.hpp Summarize).
inkui::BridgeView BridgeViewNow();
// 0.8.4: what else may react to a kill key, from the game's input files and CET's hotkeys (read only).
killkey::Conflicts ReadKillKeyConflicts(const killkey::Chord& aChord);
// 0.8.4: bridge_info's kill_key: the key, its config.ini spelling, the default, and the warnings and notes about it.
nlohmann::json KillKeyJson();
// 0.8.4 (XFBridge_KillKey): sets the kill key from a chord's text (the window's Change..., or the default for Reset), saves it
// to config.ini's [ui] kill_key, and answers {ok, kill_key, saved, save_error?, why?}. A refused text changes nothing.
nlohmann::json SetKillKey(const std::string& aText, const std::string& aSource);
// 0.8.7: whether the XF Runtime Bridge window offers Save anyway now, and bridge_info's save_lock (the offer, the refusals of
// the player's saves, the last outcome of Save anyway).
bool SaveAnywayOffered();
nlohmann::json SaveLockJson();
} // namespace xfb::plugin
