// xfb_selftest: hosts the bridge core outside the game with a simulated main thread.
//
// It exercises exactly the transport, protocol, token check, allowlist, write gate, rate
// limit, game-thread marshalling and kill switch the plugin uses. Game-thread methods return
// clearly marked simulated values; nothing here proves anything about the game itself.
//
// Usage: xfb_selftest --runtime-dir <dir> [--seconds N] [--allow-writes] [--write-classes <list>] [--no-pump]
//        xfb_selftest --unit        (in-process checks only; no pipe)

#include <Windows.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "core/Bridge.hpp"
#include "core/BuildInfo.hpp"
#include "core/Layers.hpp"
#include "core/Log.hpp"
#include "core/Params.hpp"
#include "core/Win32.hpp"
#include "core/Writes.hpp"

#include <functional>
#include <map>
#include <mutex>

int RunUnitTests();

namespace
{
using json = nlohmann::json;

class StdoutSink : public xfb::ILogSink
{
public:
    void Write(xfb::Level, const std::string& aLine) override
    {
        std::printf("[%s] %s\n", xfb::win32::UtcNowIso8601().c_str(), aLine.c_str());
        std::fflush(stdout);
    }
};

std::atomic<bool> gStop{false};

BOOL WINAPI OnConsoleCtrl(DWORD)
{
    gStop.store(true);
    return TRUE;
}
} // namespace

int wmain(int argc, wchar_t** argv)
{
    std::wstring runtimeDir;
    int seconds = 30;
    bool allowWrites = false;
    std::wstring writeClasses = L"photo,world,character";
    bool pump = true;
    for (int i = 1; i < argc; ++i)
    {
        const std::wstring arg = argv[i];
        if (arg == L"--unit")
        {
            return RunUnitTests();
        }
        if (arg == L"--runtime-dir" && i + 1 < argc)
        {
            runtimeDir = argv[++i];
        }
        else if (arg == L"--seconds" && i + 1 < argc)
        {
            seconds = std::stoi(argv[++i]);
        }
        else if (arg == L"--allow-writes")
        {
            allowWrites = true;
        }
        else if (arg == L"--write-classes" && i + 1 < argc)
        {
            writeClasses = argv[++i];
        }
        else if (arg == L"--no-pump")
        {
            pump = false;
        }
        else
        {
            std::fwprintf(stderr, L"unknown argument: %ls\n", arg.c_str());
            return 2;
        }
    }
    if (runtimeDir.empty())
    {
        std::fwprintf(stderr, L"--runtime-dir is required (the self-test never uses the real runtime folder)\n");
        return 2;
    }
    SetConsoleCtrlHandler(OnConsoleCtrl, TRUE);

    StdoutSink sink;
    xfb::log::SetSink(&sink);
    xfb::log::SetMinLevel(xfb::Level::Debug);

    xfb::Config config;
    config.bridgeEnabled = true;
    config.allowWrites = allowWrites;
    // The same parser as the plugin's config.ini ([bridge] allow_write_classes).
    config.writeClasses =
        xfb::ParseConfig("[bridge]\nallow_write_classes = " + xfb::win32::Narrow(writeClasses) + "\n").writeClasses;
    config.maxRequestsPerSecond = 20;
    config.requestTimeoutMs = 1000;

    xfb::Session session;
    std::string error;
    // The runtime folder is passed explicitly; the plugin has no such override.
    if (!xfb::CreateSession(session, error, std::filesystem::path(runtimeDir)))
    {
        std::fprintf(stderr, "session: %s\n", error.c_str());
        return 1;
    }
    xfb::log::SetSessionId(session.sessionId);
    xfb::log::Info("selftest.start", "pid=" + std::to_string(session.processId) +
                                         " allow_writes=" + (allowWrites ? "true" : "false") +
                                         " pump=" + (pump ? "true" : "false") + " " + std::string(xfb::BuildMarker()));

    xfb::GameThreadQueue queue;
    xfb::LayerRegistry layers;
    layers.Announce("selftest", "simulated host; no game");
    xfb::Bridge bridge(config, session, queue);
    auto& dispatcher = bridge.GetDispatcher();

    dispatcher.Register({"bridge.info", xfb::Access::Read, xfb::RunOn::BridgeThread, "Versions and bridge status.",
                         [&](const xfb::MethodContext&) {
                             return json{{"host", "selftest"},
                                         {"plugin_version", XFB_VERSION_STRING},
                                         {"build_commit", std::string(xfb::BuildCommit())},
                                         {"sid", session.sessionId},
                                         {"bridge", bridge.Status()}};
                         }});
    dispatcher.Register({"game.version", xfb::Access::Read, xfb::RunOn::BridgeThread, "Game version (simulated).",
                         [](const xfb::MethodContext&) {
                             return json{{"simulated", true}, {"product", "0.0.0"}, {"file", "0.0.0.0"}};
                         }});
    dispatcher.Register({"layers.status", xfb::Access::Read, xfb::RunOn::BridgeThread,
                         "What each layer has announced.",
                         [&](const xfb::MethodContext&) { return layers.Snapshot(); }});
    dispatcher.Register({"player.position", xfb::Access::Read, xfb::RunOn::GameThread,
                         "Player world position (simulated).", [](const xfb::MethodContext& aContext) {
                             xfb::log::Info("selftest.game_thread", "player.position on simulated main thread",
                                            aContext.cid);
                             return json{{"simulated", true}, {"available", true}, {"x", 1.0}, {"y", 2.0}, {"z", 3.0}};
                         }});
    dispatcher.Register({"game.state", xfb::Access::Read, xfb::RunOn::BridgeThread, "Game state (simulated).",
                         [&](const xfb::MethodContext&) {
                             return json{{"simulated", true}, {"state", "Running"}, {"running_ticks", queue.TicksSeen()}};
                         }});
    dispatcher.Register({"photomode.state", xfb::Access::Read, xfb::RunOn::GameThread, "Photo mode (simulated).",
                         [](const xfb::MethodContext&) {
                             return json{{"simulated", true}, {"active", false}, {"can_enable", true},
                                         {"exit_locked", false}};
                         }});
    dispatcher.Register({"script.describe", xfb::Access::Read, xfb::RunOn::GameThread,
                         "Redscript layer (simulated).", [](const xfb::MethodContext& aContext) {
                             return json{{"simulated", true}, {"layer", "redscript"}, {"cid", aContext.cid}};
                         }});
    dispatcher.Register({"selftest.throw", xfb::Access::Read, xfb::RunOn::GameThread,
                         "Raises a method error on the game thread.", [](const xfb::MethodContext&) -> json {
                             throw xfb::MethodError("not_in_game", "simulated: no player");
                         }});
    dispatcher.Register({"selftest.write", xfb::Access::Write, xfb::RunOn::GameThread,
                         "A write-class method, to prove the write gate.",
                         [](const xfb::MethodContext&) { return json{{"simulated", true}, {"wrote", true}}; }});
    // Occupies the simulated game thread for params.ms (at most 5000), for the timeout checks.
    dispatcher.Register({"selftest.slow", xfb::Access::Read, xfb::RunOn::GameThread,
                         "Sleeps on the simulated game thread for params.ms.",
                         [](const xfb::MethodContext& aContext) {
                             const auto ms = std::clamp(aContext.params.value("ms", 0), 0, 5000);
                             std::this_thread::sleep_for(std::chrono::milliseconds(ms));
                             xfb::log::Info("selftest.slow_done", "ms=" + std::to_string(ms), aContext.cid);
                             return json{{"slept_ms", ms}};
                         }});
    // Returns text that is not valid UTF-8, as raw game strings can be.
    dispatcher.Register({"selftest.bad_utf8", xfb::Access::Read, xfb::RunOn::BridgeThread,
                         "Returns a string with invalid UTF-8 bytes.", [](const xfb::MethodContext&) {
                             return json{{"text", std::string("ok\xFF\xFE")}};
                         }});

    // Phase-2 methods, simulated: the same names, access classes and parameter checks
    // (core/Params.cpp) as the plugin, and the same write logic (core/Writes.cpp: undo
    // parameters, the light sequence, the kill switch's once-only restore), with a simulated game
    // (phase, photo-mode attributes, freeze, clock) instead of the game. selftest.phase switches
    // the simulated phase so clients can test phase refusals.
    struct Simulated
    {
        std::mutex mutex;
        std::string phase = "gameplay";
        bool hudHidden = false;
        bool frozen = false;
        int32_t clock = 12 * 3600;
        std::map<int32_t, float> attributes; // photo-mode attribute values; 0 when photo mode opened
    };
    static Simulated sim;
    static xfb::writes::RestoreOnce restore;
    const auto phase = [] {
        std::scoped_lock _(sim.mutex);
        return sim.phase;
    };
    const auto requirePhase = [phase](const char* aWanted, const char* aCode) {
        if (phase() != aWanted)
        {
            throw xfb::MethodError(aCode, std::string("simulated: the game is in '") + phase() + "'");
        }
    };
    // One simulated attribute change, answered like XFPhoto.SetAttribute.
    const auto simulatedSet = [](int32_t aKey, float aValue) {
        std::scoped_lock _(sim.mutex);
        if (sim.phase != "photo_mode")
        {
            throw xfb::MethodError("not_in_photo_mode", "simulated: photo mode is not open");
        }
        const float before = sim.attributes[aKey];
        sim.attributes[aKey] = aValue;
        return json{{"simulated", true}, {"key", aKey}, {"before", before}, {"before_known", true}, {"after", aValue}};
    };
    // Marks the write for the kill switch's restore, like the plugin's WriteMethod wrapper.
    const auto simWrite = [](const char* aName, xfb::Access aAccess, xfb::RunOn aRunOn, const char* aSummary,
                             std::function<json(const xfb::MethodContext&)> aFn) {
        return xfb::MethodSpec{aName, aAccess, aRunOn, aSummary, [aFn](const xfb::MethodContext& aContext) {
                                   restore.MarkWrite();
                                   return aFn(aContext);
                               }};
    };
    namespace p = xfb::params;
    namespace w = xfb::writes;
    dispatcher.Register({"selftest.phase", xfb::Access::Read, xfb::RunOn::BridgeThread,
                         "Sets the simulated game phase (self-test only).", [](const xfb::MethodContext& aContext) {
                             std::scoped_lock _(sim.mutex);
                             sim.phase = aContext.params.value("phase", std::string("gameplay"));
                             return json{{"phase", sim.phase}};
                         }});
    dispatcher.Register({"game.status", xfb::Access::Read, xfb::RunOn::BridgeThread, "Game phase (simulated).",
                         [phase](const xfb::MethodContext& aContext) {
                             p::RequireOnly(aContext.params, {});
                             std::scoped_lock _(sim.mutex);
                             return json{{"simulated", true},
                                         {"phase", sim.phase},
                                         {"player_present", sim.phase == "gameplay" || sim.phase == "photo_mode"},
                                         {"photo_mode_active", sim.phase == "photo_mode"},
                                         {"world_frozen", sim.frozen},
                                         {"ui_hidden", sim.hudHidden},
                                         {"game_version", {{"product", "0.0.0"}, {"file", "0.0.0.0"}}}};
                         }});
    dispatcher.Register({"player.appearance", xfb::Access::Read, xfb::RunOn::GameThread,
                         "Character state (simulated).", [phase](const xfb::MethodContext& aContext) {
                             const auto request = p::ParseAppearance(aContext.params);
                             json out{{"simulated", true}, {"character_menu_open", phase() == "character_menu"}};
                             if (phase() == "character_menu")
                             {
                                 out["options"] = json::array({{{"name", "xfs_selector"}, {"label", "XF"}, {"index", 0}, {"count", 13}}});
                             }
                             out["checks"] = json::array();
                             for (const auto& check : request.checks)
                             {
                                 out["checks"].push_back({{"group", check.group}, {"option", check.option}, {"present", false}});
                             }
                             return out;
                         }});
    dispatcher.Register({"photo.state", xfb::Access::Read, xfb::RunOn::GameThread, "Photo mode (simulated).",
                         [phase](const xfb::MethodContext& aContext) {
                             const auto request = p::ParsePhotoState(aContext.params);
                             json out{{"simulated", true}, {"active", phase() == "photo_mode"}, {"can_open", phase() == "gameplay"}};
                             if (request.menu)
                             {
                                 out["menu"] = json::array({{{"key", 1}, {"label", "Field of view"}, {"kind", "slider"}, {"min", 5}, {"max", 90}}});
                             }
                             return out;
                         }});
    dispatcher.Register(simWrite("photo.enter", xfb::Access::WritePhoto, xfb::RunOn::BridgeThread, "Opens photo mode (simulated).",
                                 [](const xfb::MethodContext& aContext) {
                                     p::RequireOnly(aContext.params, {});
                                     std::scoped_lock _(sim.mutex);
                                     if (sim.phase != "gameplay" && sim.phase != "photo_mode")
                                     {
                                         throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                     }
                                     const bool changed = sim.phase != "photo_mode";
                                     if (changed)
                                     {
                                         sim.attributes.clear(); // photo mode opens with its defaults
                                     }
                                     sim.phase = "photo_mode";
                                     return json{{"simulated", true}, {"changed", changed}, {"active", true},
                                                 {"undo", {{"method", "photo.exit"}, {"params", json::object()}}}};
                                 }));
    dispatcher.Register(simWrite("photo.exit", xfb::Access::WritePhoto, xfb::RunOn::BridgeThread, "Leaves photo mode (simulated).",
                                 [](const xfb::MethodContext& aContext) {
                                     p::RequireOnly(aContext.params, {});
                                     std::scoped_lock _(sim.mutex);
                                     const bool changed = sim.phase == "photo_mode";
                                     if (changed)
                                     {
                                         sim.phase = "gameplay";
                                         sim.hudHidden = false; // leaving photo mode always shows its menu again
                                     }
                                     return json{{"simulated", true}, {"changed", changed}, {"active", false},
                                                 {"undo", {{"method", "photo.enter"}, {"params", json::object()}}}};
                                 }));
    dispatcher.Register(simWrite("photo.camera.set", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Camera (simulated).",
                                 [requirePhase, simulatedSet](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseCamera(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     if (request.reset)
                                     {
                                         return w::CameraReset(p::CameraKeys(), [&simulatedSet](int32_t aKey) {
                                             return simulatedSet(aKey, 0.0f);
                                         });
                                     }
                                     json applied = json::array();
                                     for (const auto& attribute : request.attributes)
                                     {
                                         auto result = simulatedSet(attribute.key, attribute.value);
                                         result["name"] = attribute.name;
                                         applied.push_back(result);
                                     }
                                     std::vector<std::string> unknown;
                                     json out{{"simulated", true}, {"applied", applied}};
                                     w::AttachUndo(out, "photo.camera.set", w::UndoParams(applied, &unknown), unknown);
                                     return out;
                                 }));
    dispatcher.Register(simWrite("photo.light.set", xfb::Access::WritePhoto, xfb::RunOn::BridgeThread, "Light (simulated).",
                                 [requirePhase, simulatedSet, &queue](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseLight(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     w::LightOps ops;
                                     ops.set = simulatedSet;
                                     ops.settle = [&queue] {
                                         if (!w::WaitTicks(queue, 3, std::chrono::milliseconds(1000)))
                                         {
                                             throw xfb::MethodError("timeout", "simulated: no game ticks");
                                         }
                                     };
                                     auto out = w::LightSet(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    dispatcher.Register(simWrite("photo.hud.hide", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Photo UI (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const bool hidden = p::ParseHudHidden(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     std::scoped_lock _(sim.mutex);
                                     const bool was = sim.hudHidden;
                                     sim.hudHidden = hidden;
                                     return json{{"simulated", true}, {"hidden", hidden}, {"was_hidden", was},
                                                 {"undo", {{"method", "photo.hud.hide"}, {"params", {{"hidden", was}}}}}};
                                 }));
    dispatcher.Register(simWrite("photo.expression.set", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Expression (simulated).",
                                 [requirePhase, simulatedSet](const xfb::MethodContext& aContext) {
                                     const auto face = p::ParseExpression(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     return w::ExpressionResult(simulatedSet(p::key::kExpression, static_cast<float>(face)));
                                 }));
    dispatcher.Register(simWrite("cc.apply", xfb::Access::WriteCharacter, xfb::RunOn::GameThread, "Character option (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseCharacterApply(aContext.params);
                                     requirePhase("character_menu", "not_in_character_menu");
                                     if (request.index >= 13)
                                     {
                                         throw xfb::MethodError("bad_params", "simulated: option has values 0 to 12");
                                     }
                                     return json{{"simulated", true}, {"option", request.option}, {"before", 0}, {"after", request.index},
                                                 {"undo", {{"method", "cc.apply"}, {"params", {{"option", request.option}, {"index", 0}}}}}};
                                 }));
    dispatcher.Register(simWrite("world.time.set", xfb::Access::WriteWorld, xfb::RunOn::GameThread, "Clock (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseTime(aContext.params);
                                     requirePhase("gameplay", "not_in_gameplay");
                                     std::scoped_lock _(sim.mutex);
                                     const auto before = sim.clock;
                                     sim.clock = request.totalSeconds >= 0 ? request.totalSeconds
                                                                           : request.hours * 3600 + request.minutes * 60 + request.seconds;
                                     return json{{"simulated", true}, {"before_total_seconds", before}, {"after_total_seconds", sim.clock},
                                                 {"undo", {{"method", "world.time.set"}, {"params", {{"total_seconds", before}}}}}};
                                 }));
    dispatcher.Register(simWrite("world.pause", xfb::Access::WriteWorld, xfb::RunOn::GameThread, "World freeze (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const bool paused = p::ParsePause(aContext.params);
                                     if (paused)
                                     {
                                         requirePhase("gameplay", "not_in_gameplay");
                                     }
                                     std::scoped_lock _(sim.mutex);
                                     const bool was = sim.frozen;
                                     sim.frozen = paused;
                                     return w::PauseResult(json{{"simulated", true}, {"frozen", paused}, {"was_frozen", was}});
                                 }));
    // The kill switch's restore, simulated like XFBridgeActions.RestoreAfterKill: unfreeze and
    // show the photo-mode menu; the save lock would stay.
    const auto simulatedRestore = [] {
        std::scoped_lock _(sim.mutex);
        json out{{"simulated", true}, {"world_unfrozen", sim.frozen}, {"photo_ui_shown", sim.hudHidden}};
        sim.frozen = false;
        sim.hudHidden = false;
        xfb::log::Info("bridge.kill_restored", xfb::SerializeJson(out), "kill-restore");
    };
    const auto restoreFailed = [](const std::string& aWhat) {
        xfb::log::Warn("bridge.kill_restore_failed", "what=" + aWhat, "kill-restore");
    };

    if (!bridge.Start(error))
    {
        xfb::log::Error("selftest.bridge_failed", error);
        return 1;
    }

    queue.SetPumping(pump);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (!gStop.load() && std::chrono::steady_clock::now() < deadline && bridge.IsListening())
    {
        if (pump)
        {
            queue.Drain(4); // the plugin does this once per engine tick
            restore.Tick(bridge.RestoreReady(), simulatedRestore, restoreFailed);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }
    // The loop ends as soon as the kill switch fires; the plugin's next tick would restore here.
    if (pump)
    {
        restore.Tick(bridge.RestoreReady(), simulatedRestore, restoreFailed);
    }

    queue.Close();
    bridge.Stop("selftest_exit");
    xfb::log::Info("selftest.exit", "requests=" + std::to_string(dispatcher.RequestCount()) +
                                        " late_game_tasks=" + std::to_string(queue.LateCompletions()));
    xfb::log::SetSink(nullptr);
    return 0;
}
