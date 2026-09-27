// xfb_selftest: hosts the bridge core outside the game with a simulated main thread.
//
// It exercises exactly the transport, protocol, token check, allowlist, write gate, rate
// limit, game-thread marshalling and kill switch the plugin uses. Game-thread methods return
// clearly marked simulated values; nothing here proves anything about the game itself.
//
// Usage: xfb_selftest --runtime-dir <dir> [--seconds N] [--allow-writes] [--write-classes <list>] [--no-pump]
//                    [--allow-creator-leave] [--allow-live-pose] [--idle-seconds N] [--no-cet]
//                    [--rearm-after-ms N]
// --rearm-after-ms re-arms the bridge N ms after a kill switch (once its restore has run), as the in-game
// panel's Reconnect does (the plugin's HandleRearm), up to three times.
//        xfb_selftest --unit        (in-process checks only; no pipe)

#include <Windows.h>

#include <algorithm>
#include <cmath>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "core/Bridge.hpp"
#include "core/BuildInfo.hpp"
#include "core/Layers.hpp"
#include "core/LivePose.hpp"
#include "core/Log.hpp"
#include "core/Messages.hpp"
#include "core/OptionsExchange.hpp"
#include "core/Params.hpp"
#include "core/Win32.hpp"
#include "core/Writes.hpp"

#include <functional>
#include <limits>
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
    bool allowCreatorLeave = false;
    uint32_t idleSeconds = 120;
    bool cet = true;
    bool allowLivePose = false;
    int rearmAfterMs = -1;
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
        else if (arg == L"--allow-creator-leave")
        {
            allowCreatorLeave = true;
        }
        else if (arg == L"--allow-live-pose")
        {
            allowLivePose = true;
        }
        else if (arg == L"--rearm-after-ms" && i + 1 < argc)
        {
            rearmAfterMs = std::clamp(std::stoi(argv[++i]), 0, 60000);
        }
        else if (arg == L"--no-cet")
        {
            cet = false; // game.options.read then answers that the CET layer isn't there
        }
        else if (arg == L"--idle-seconds" && i + 1 < argc)
        {
            // Below config.ini's 5 s minimum on purpose: the idle test shouldn't wait long.
            idleSeconds = static_cast<uint32_t>(std::clamp(std::stoi(argv[++i]), 1, 3600));
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
    config.allowCreatorLeave = allowCreatorLeave;
    config.allowLivePose = allowLivePose;
    config.maxRequestsPerSecond = 20;
    config.requestTimeoutMs = 1000;
    config.idleDisconnectSeconds = idleSeconds;

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
    if (cet)
    {
        layers.Announce("cet", "simulated CET layer (answers render options from the pump loop)");
    }
    static xfb::OptionsExchange options;
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
        bool cursorHidden = false;
        bool frozen = false;
        int32_t faceIndex = -1; // the last photo.expression.index applied (-1: none)
        int32_t clock = 12 * 3600;
        bool creatorOpens = true;   // selftest.phase {creator_opens: false} simulates a request the menu never picks up
        int creatorOpenTicks = -1;  // >= 0: the simulated menu opens the screen after this many more ticks
        std::string creatorMode;
        int creatorChanges = 0; // change events on the simulated appearance screen since it opened (cc.confirm, RB-51)
        bool saveLock = false;
        std::map<int32_t, float> attributes; // photo-mode attribute values; 0 when photo mode opened
        std::string player = "v";            // selftest.phase {player: "johnny"}: a stand-in, not V
        // Photo-mode poses: two categories (0 Idle, 900 XF Live) and their poses; the XF carrier is pose 7 of 900.
        int32_t poseCategory = 0;
        int32_t pose = 1;
        // The simulated carrier clip: 71 joints, a rotation and a translation constant key each, laid out
        // in one block like the game's buffer (core/LivePose.hpp).
        std::vector<xfb::livepose::RawConstKey> carrier;
        std::vector<xfb::livepose::RawConstKey> carrierOriginal;
        bool carrierWritten = false;
        // Photo-mode lights' positions (the simulated entities), placed at the camera when first switched on.
        std::map<int32_t, std::array<double, 3>> lights;
        // V's clothing: slot -> item, the inventory, the items the bridge added, and an equip request the
        // simulated equipment system handles a couple of ticks later.
        std::map<std::string, std::string> worn;
        std::vector<std::string> inventory{"Items.Jacket_01_basic_01"};
        std::vector<std::string> added;
        std::string pendingSlot;
        std::string pendingItem;
        int pendingTicks = -1;
        // Saves: the game's list (newest first), the bridge's save lock as the game sees it, and a save or
        // load in progress (ticks until it finishes).
        std::vector<std::string> saves{"ManualSave-3", "AutoSave-1", "QuickSave-0"};
        bool gameSaveLock = false;
        bool relockAfterSave = false;
        int unlockTicks = -1;
        std::string saveState = "none";
        int saveTicks = -1;
        bool savesReady = false;
        int listTicks = -1;
        int loadTicks = -1;
    };
    static Simulated sim;
    static xfb::writes::RestoreOnce restore;
    {
        namespace lp = xfb::livepose;
        for (uint16_t joint = 0; joint < 71; ++joint)
        {
            lp::RawConstKey rotation{};
            bool wSign = false;
            const float angle = 0.01f * static_cast<float>(joint % 7);
            lp::EncodeRotation({std::sin(angle / 2), 0.0f, 0.0f, std::cos(angle / 2)}, rotation.x, rotation.y, rotation.z, wSign);
            rotation.header = lp::Header(joint, lp::Rotation, wSign);
            sim.carrier.push_back(rotation);
            lp::RawConstKey translation{lp::Header(joint, lp::Translation, false), 0, 0.0f, joint == 2 ? 1.0f : 0.1f, 0.0f};
            sim.carrier.push_back(translation);
        }
        sim.carrierOriginal = sim.carrier;
    }
    // The simulated rig's joint names: Root, Trajectory, Hips, then joint_3 ... (RightForeArm is 40).
    const auto jointNames = [] {
        std::vector<std::string> names{"Root", "Trajectory", "Hips"};
        for (int i = 3; i < 71; ++i)
        {
            names.push_back(i == 40 ? std::string("RightForeArm") : "joint_" + std::to_string(i));
        }
        return names;
    }();
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
    // One simulated attribute change, answered like XFPhoto.SetAttribute. 2.31's menu has no light type row
    // (setting 45): it answers unavailable, as the game did in session 3. A light switched on is placed at
    // the simulated camera (0, 0, 1.6), as photo mode does.
    const auto simulatedSet = [](int32_t aKey, float aValue) {
        std::scoped_lock _(sim.mutex);
        if (sim.phase != "photo_mode")
        {
            throw xfb::MethodError("not_in_photo_mode", "simulated: photo mode is not open");
        }
        if (aKey == xfb::params::key::kLightType)
        {
            throw xfb::MethodError("unavailable", "photo-mode setting 45 is not in the menu right now");
        }
        const float before = sim.attributes[aKey];
        sim.attributes[aKey] = aValue;
        sim.gameSaveLock = true;
        if (aKey == xfb::params::key::kLightState && aValue > 0.5f && before < 0.5f)
        {
            sim.lights[static_cast<int32_t>(sim.attributes[xfb::params::key::kLightSelect]) + 1] = {0.0, 0.0, 1.6};
        }
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
                             if (sim.phase == "character_menu")
                             {
                                 sim.creatorChanges = 0; // a freshly opened simulated screen
                             }
                             sim.creatorOpens = aContext.params.value("creator_opens", true);
                             sim.player = aContext.params.value("player", std::string("v"));
                             return json{{"phase", sim.phase}, {"creator_opens", sim.creatorOpens}, {"player", sim.player}};
                         }});
    // The in-game panel's write switch, which the self-test can't press: pauses or resumes writes.
    dispatcher.Register({"selftest.pause_writes", xfb::Access::Read, xfb::RunOn::BridgeThread,
                         "Pauses or resumes writes, as the CET panel does (self-test only).",
                         [&dispatcher](const xfb::MethodContext& aContext) {
                             dispatcher.SetWritesPaused(aContext.params.value("paused", true));
                             return json{{"writes_paused", dispatcher.WritesPaused()}};
                         }});
    dispatcher.Register({"game.status", xfb::Access::Read, xfb::RunOn::BridgeThread, "Game phase (simulated).",
                         [phase, &config, &dispatcher](const xfb::MethodContext& aContext) {
                             p::RequireOnly(aContext.params, {});
                             std::scoped_lock _(sim.mutex);
                             return json{{"simulated", true},
                                         {"allow_writes", config.allowWrites},
                                         {"writes_paused", dispatcher.WritesPaused()},
                                         {"write_classes", xfb::WriteClassList(config)},
                                         {"phase", sim.phase},
                                         {"player_present", sim.phase == "gameplay" || sim.phase == "photo_mode"},
                                         {"photo_mode_active", sim.phase == "photo_mode"},
                                         {"photo_mode_can_open", sim.phase == "gameplay"},
                                         {"world_frozen", sim.frozen},
                                         {"ui_hidden", sim.hudHidden},
                                         {"cursor_hidden", sim.cursorHidden},
                                         {"face_index", sim.faceIndex},
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
                                     p::ParsePhotoEnter(aContext.params); // refuses unless route = "quest"
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
                                     return json{{"simulated", true}, {"changed", changed}, {"active", true}, {"route", "quest"},
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
                                         sim.cursorHidden = false;
                                         sim.faceIndex = -1;
                                     }
                                     return json{{"simulated", true}, {"changed", changed}, {"active", false}, {"undo", nullptr},
                                                 {"undo_note", "photo.open (or the player's photo mode key) opens photo mode again; its settings start fresh"}};
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
                                     // The simulated light entities: V's head at (0.4, 6.0, 1.62) facing the camera (-Y).
                                     ops.place = [](int32_t aLight, const p::LightPlacement& aPlace) {
                                         std::scoped_lock _(sim.mutex);
                                         const auto found = sim.lights.find(aLight);
                                         if (found == sim.lights.end())
                                         {
                                             throw xfb::MethodError("unavailable", "simulated: light " + std::to_string(aLight) + " has never been switched on");
                                         }
                                         const auto before = found->second;
                                         const double head[3] = {0.4, 6.0, 1.62};
                                         std::array<double, 3> after{};
                                         if (aPlace.kind == p::LightPlacement::Kind::World)
                                         {
                                             after = {aPlace.world[0], aPlace.world[1], aPlace.world[2]};
                                         }
                                         else
                                         {
                                             const double pi = 3.14159265358979;
                                             const double az = aPlace.azimuth * pi / 180.0;
                                             const double el = aPlace.elevation * pi / 180.0;
                                             const double fx = -std::sin(az); // V faces -Y; +azimuth turns counter-clockwise
                                             const double fy = -std::cos(az);
                                             after = {head[0] + aPlace.distance * std::cos(el) * fx, head[1] + aPlace.distance * std::cos(el) * fy,
                                                      head[2] + aPlace.distance * std::sin(el)};
                                         }
                                         found->second = after;
                                         const auto vec = [](const std::array<double, 3>& v) { return json{{"x", v[0]}, {"y", v[1]}, {"z", v[2]}}; };
                                         return json{{"simulated", true}, {"before", vec(before)}, {"after", vec(after)}, {"head", vec({head[0], head[1], head[2]})}};
                                     };
                                     ops.position = [](int32_t aLight) {
                                         std::scoped_lock _(sim.mutex);
                                         const auto found = sim.lights.find(aLight);
                                         if (found == sim.lights.end())
                                         {
                                             throw xfb::MethodError("unavailable", "simulated: no such light");
                                         }
                                         return json{{"position", {{"x", found->second[0]}, {"y", found->second[1]}, {"z", found->second[2]}}}};
                                     };
                                     auto out = w::LightSet(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    dispatcher.Register(simWrite("photo.hud.hide", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Photo UI (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseHud(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     std::scoped_lock _(sim.mutex);
                                     const bool was = sim.hudHidden;
                                     const bool wasCursor = sim.cursorHidden;
                                     sim.hudHidden = request.hidden;
                                     if (request.cursor)
                                     {
                                         sim.cursorHidden = request.hidden;
                                     }
                                     return w::HudResult(json{{"simulated", true},
                                                              {"hidden", request.hidden},
                                                              {"was_hidden", was},
                                                              {"cursor_hidden", sim.cursorHidden},
                                                              {"was_cursor_hidden", wasCursor}});
                                 }));
    // V's head and the camera, simulated like XFPhoto.Subject: a fixed camera at (0, 0, 1.6) looking
    // along +Y, and V's head placed by the pose tab's offsets (keys 8, 9, 37) and rotation (key 7)
    // through a slightly skewed mapping, projected with a vertical field of view (key 1, 35 until
    // set) at aspect 2.4. Enough to drive tools/api/framing.ts end to end offline.
    dispatcher.Register({"photo.subject", xfb::Access::Read, xfb::RunOn::GameThread, "V's head and the camera (simulated).",
                         [requirePhase](const xfb::MethodContext& aContext) {
                             const auto request = p::ParseSubject(aContext.params);
                             requirePhase("photo_mode", "not_in_photo_mode");
                             std::scoped_lock _(sim.mutex);
                             const auto attr = [](int32_t aKey, double aDefault) {
                                 const auto it = sim.attributes.find(aKey);
                                 return it == sim.attributes.end() ? aDefault : static_cast<double>(it->second);
                             };
                             const double fovSet = attr(p::key::kFov, 35.0);
                             const double fov = fovSet > 0.0 ? fovSet : 35.0;
                             const double lr = attr(p::key::kSubjectLeftRight, 0.0);
                             const double nf = attr(p::key::kSubjectNearFar, 0.0);
                             const double ud = attr(p::key::kSubjectUpDown, 0.0);
                             const double pi = 3.14159265358979;
                             const double theta = (150.0 + attr(p::key::kSubjectYaw, 0.0)) * pi / 180.0;
                             const double fx = std::sin(theta);
                             const double fy = std::cos(theta);
                             const double rx = fy;
                             const double ry = -fx;
                             const double root[3] = {0.4 + 0.95 * lr - 0.05 * ud, 6.0 + nf + 0.1 * lr, ud};
                             const double head[3] = {root[0] + fx * 0.03, root[1] + fy * 0.03, root[2] + 1.62};
                             const double target[3] = {head[0] + fx * request.forward + rx * request.right,
                                                       head[1] + fy * request.forward + ry * request.right, head[2] + request.up};
                             const double cam[3] = {0.0, 0.0, 1.6};
                             const double aspect = 2.4;
                             const double t = std::tan(fov * pi / 360.0);
                             const auto project = [&](double aX, double aY, double aZ) {
                                 const double vx = aX - cam[0];
                                 const double vy = aY - cam[1];
                                 const double vz = aZ - cam[2];
                                 return json{{"x", vx / (vy * t * aspect)}, {"y", vz / (vy * t)}, {"z", vy}, {"w", 1.0}};
                             };
                             const auto vec = [](double aX, double aY, double aZ) { return json{{"x", aX}, {"y", aY}, {"z", aZ}}; };
                             return json{{"simulated", true},
                                         {"subject", "photo_puppet"},
                                         {"slot", "Head"},
                                         {"approximate", false},
                                         {"head", vec(head[0], head[1], head[2])},
                                         {"target", vec(target[0], target[1], target[2])},
                                         {"subject_forward", vec(fx, fy, 0.0)},
                                         {"offset", {{"up", request.up}, {"forward", request.forward}, {"right", request.right}}},
                                         {"camera",
                                          {{"position", vec(cam[0], cam[1], cam[2])},
                                           {"forward", vec(0, 1, 0)},
                                           {"right", vec(1, 0, 0)},
                                           {"up", vec(0, 0, 1)},
                                           {"fov", fov},
                                           {"aspect", aspect}}},
                                         {"screen",
                                          {{"target", project(target[0], target[1], target[2])},
                                           {"head", project(head[0], head[1], head[2])},
                                           {"center", project(cam[0], cam[1] + 5.0, cam[2])},
                                           {"up", project(target[0], target[1], target[2] + 0.1)},
                                           {"right", project(target[0] + 0.1, target[1], target[2])}}}};
                         }});
    dispatcher.Register(simWrite("photo.expression.set", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Expression (simulated).",
                                 [requirePhase, simulatedSet](const xfb::MethodContext& aContext) {
                                     const auto face = p::ParseExpression(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     return w::ExpressionResult(simulatedSet(p::key::kExpression, static_cast<float>(face)));
                                 }));
    // V's photo-mode face, simulated like XFFace: the head item has a face rig and two animation-setup
    // components with made-up hashes; the stand-in has none of them.
    dispatcher.Register({"face.rig.read", xfb::Access::Read, xfb::RunOn::GameThread, "Face components (simulated).",
                         [requirePhase](const xfb::MethodContext& aContext) {
                             const auto request = p::ParseFaceRig(aContext.params);
                             requirePhase("photo_mode", "not_in_photo_mode");
                             const bool head = request.target == p::FaceTarget::Head;
                             const auto hash = [](uint64_t aValue) {
                                 char hex[19];
                                 std::snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(aValue));
                                 return json{{"hash", std::to_string(aValue)}, {"hex", hex}};
                             };
                             json components = json::array();
                             for (const auto& name : request.components)
                             {
                                 json entry{{"name", name}, {"found", false}};
                                 if (head && name == "face_rig")
                                 {
                                     entry = {{"name", name}, {"found", true}, {"class", "entAnimatedComponent"}, {"kind", "animated"},
                                              {"facial_setup", hash(0x1111111111111111ull)}, {"graph", hash(0x2222222222222222ull)},
                                              {"rig", hash(0x3333333333333333ull)},
                                              {"animations", {{"gameplay", json::array()}, {"cinematics", json::array()}}}};
                                 }
                                 else if (head && (name == "man_face_base_animations" || name == "PhotomodeAnimations"))
                                 {
                                     entry = {{"name", name}, {"found", true}, {"class", "entAnimationSetupExtensionComponent"},
                                              {"kind", "animation_setup_extension"},
                                              {"animations", {{"gameplay", json::array({{{"anim_set", hash(0x4444444444444444ull)}, {"priority", 128}}})},
                                                              {"cinematics", json::array()}}}};
                                 }
                                 components.push_back(entry);
                             }
                             return json{{"simulated", true},
                                         {"target", p::FaceTargetName(request.target)},
                                         {"class", head ? "gameItemObject" : "PlayerPuppet"},
                                         {"components", components}};
                         }});
    dispatcher.Register(simWrite("photo.expression.index", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Face index (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseExpressionIndex(aContext.params);
                                     requirePhase("photo_mode", "not_in_photo_mode");
                                     std::scoped_lock _(sim.mutex);
                                     // The simulated expression list offers 0-14, like vanilla photo mode.
                                     if (!request.unlisted && request.index > 14)
                                     {
                                         throw xfb::MethodError("bad_params", "simulated: index " + std::to_string(request.index) +
                                                                                  " is not one of the photo-mode expression values");
                                     }
                                     const auto menu = sim.attributes.find(p::key::kExpression);
                                     const bool known = menu != sim.attributes.end();
                                     sim.faceIndex = request.index;
                                     return w::ExpressionIndexResult(json{{"simulated", true},
                                                                          {"target", p::FaceTargetName(request.target)},
                                                                          {"index", request.index},
                                                                          {"unlisted", request.unlisted},
                                                                          {"menu_value", known ? menu->second : -1.0f},
                                                                          {"menu_value_known", known}});
                                 }));
    dispatcher.Register(simWrite("cc.apply", xfb::Access::WriteCharacter, xfb::RunOn::GameThread, "Character option (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseCharacterApply(aContext.params);
                                     requirePhase("character_menu", "not_in_character_menu");
                                     // The simulated option has 13 values, internal names xfs_value_00..12 and on-screen
                                     // labels 01..13, like the creator's two-digit positions.
                                     int32_t index = request.index;
                                     std::string matchedBy = "index";
                                     if (index < 0)
                                     {
                                         matchedBy = "value";
                                         for (int32_t i = 0; i < 13; ++i)
                                         {
                                             char name[16];
                                             std::snprintf(name, sizeof(name), "xfs_value_%02d", i);
                                             const bool numeric = !request.value.empty() &&
                                                                  request.value.find_first_not_of("0123456789") == std::string::npos &&
                                                                  request.value.size() < 6;
                                             if (request.value == name || (numeric && std::stoi(request.value) == i + 1))
                                             {
                                                 index = i;
                                             }
                                         }
                                         if (index < 0)
                                         {
                                             throw xfb::MethodError("bad_params", "simulated: no value of '" + request.option + "' is named or labelled '" +
                                                                                      request.value + "'");
                                         }
                                     }
                                     if (index >= 13)
                                     {
                                         throw xfb::MethodError("bad_params", "simulated: option has values 0 to 12");
                                     }
                                     if (index != 0)
                                     {
                                         std::scoped_lock _(sim.mutex);
                                         ++sim.creatorChanges;
                                     }
                                     return json{{"simulated", true}, {"option", request.option}, {"before", 0}, {"after", index}, {"matched_by", matchedBy},
                                                 {"undo", {{"method", "cc.apply"}, {"params", {{"option", request.option}, {"index", 0}}}}}};
                                 }));
    // The creator's Confirm and Back, simulated: gated like the plugin, then the appearance screen closes.
    const auto simLeave = [&config](bool aKeep) {
        return [&config, aKeep](const xfb::MethodContext& aContext) {
            p::RequireOnly(aContext.params, {});
            p::CreatorLeaveAllowed(config.allowCreatorLeave);
            std::scoped_lock _(sim.mutex);
            if (sim.phase != "character_menu")
            {
                throw xfb::MethodError("not_in_character_menu", "simulated: the game is in '" + sim.phase + "'");
            }
            // The plugin's own choice of route (core/Writes.cpp), from the simulated screen's state.
            const auto route = w::ChooseLeave(aKeep, json{{"changes", sim.creatorChanges}, {"unchanged", sim.creatorChanges == 0}});
            sim.phase = "gameplay";
            const bool nothing = route == w::LeaveRoute::NothingToConfirm;
            json out{{"simulated", true}, {"kept", route == w::LeaveRoute::Confirm}, {"changed", sim.creatorChanges > 0},
                     {"changes", sim.creatorChanges}, {"closed_with", route == w::LeaveRoute::Confirm ? "confirm" : "back"}, {"undo", nullptr}};
            if (nothing)
            {
                out["note"] = "nothing to confirm: no option changed on this screen, so it was closed with Back (nothing was discarded)";
            }
            return out;
        };
    };
    // cc.open, simulated with the plugin's own sequence (core/Writes.cpp): the simulated menu opens the
    // screen a few ticks after the request, unless selftest.phase said creator_opens: false.
    dispatcher.Register(simWrite("cc.open", xfb::Access::WriteCharacter, xfb::RunOn::BridgeThread, "Creator open (simulated).",
                                 [&config, &queue](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseCreatorOpen(aContext.params);
                                     p::CreatorLeaveAllowed(config.allowCreatorLeave);
                                     w::CreatorOpenOps ops;
                                     ops.prepare = [] {
                                         std::scoped_lock _(sim.mutex);
                                         if (sim.phase == "character_menu")
                                         {
                                             return json{{"already_open", true}};
                                         }
                                         if (sim.phase != "gameplay")
                                         {
                                             throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                         }
                                         if (sim.player != "v")
                                         {
                                             throw xfb::MethodError("not_v", "simulated: the player is Johnny right now, not V");
                                         }
                                         sim.saveLock = true;
                                         return json{{"save_lock_requested", true}};
                                     };
                                     ops.settle = [&queue] {
                                         if (!w::WaitTicks(queue, 3, std::chrono::milliseconds(1000)))
                                         {
                                             throw xfb::MethodError("timeout", "simulated: no game ticks");
                                         }
                                     };
                                     ops.open = [&request] {
                                         std::scoped_lock _(sim.mutex);
                                         if (!sim.saveLock)
                                         {
                                             throw xfb::MethodError("save_lock_not_held", "simulated: no save lock");
                                         }
                                         if (sim.phase != "gameplay")
                                         {
                                             // The moment passed between the two steps (selftest.phase in between).
                                             throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                         }
                                         sim.creatorMode = p::CreatorModeName(request.mode);
                                         sim.creatorOpenTicks = sim.creatorOpens ? 2 : std::numeric_limits<int>::max(); // never picked up: pending until withdrawn
                                         return json{{"requested", true}, {"edit_mode", request.mode == p::CreatorMode::Ripperdoc ? "Ripperdoc" : "HairDresser"},
                                                     {"saving_locked", true}, {"route", "menu_event"}};
                                     };
                                     // Through the game-thread queue, as in the plugin: after the kill switch closes it, a poll
                                     // or the withdrawal fails at once instead of waiting out the timeout.
                                     ops.phase = [&queue] {
                                         return xfb::RunGameTask(
                                                    queue, std::chrono::milliseconds(1000),
                                                    [] {
                                                        std::scoped_lock _(sim.mutex);
                                                        return json{{"phase", sim.phase}};
                                                    },
                                                    "cc.open.wait")
                                             .value("phase", std::string());
                                     };
                                     ops.cancel = [&queue]() -> json {
                                         try
                                         {
                                             return xfb::RunGameTask(
                                                 queue, std::chrono::milliseconds(1000),
                                                 [] {
                                                     std::scoped_lock _(sim.mutex);
                                                     const bool waiting = sim.creatorOpenTicks >= 0;
                                                     sim.creatorOpenTicks = -1;
                                                     return json{{"withdrawn", true}, {"taken", false}, {"outcome", waiting ? "withdrawn" : "none"}};
                                                 },
                                                 "cc.open.cancel");
                                         }
                                         catch (const xfb::MethodError&)
                                         {
                                             return json::object();
                                         }
                                     };
                                     ops.sleep = [](std::chrono::milliseconds aFor) { std::this_thread::sleep_for(aFor); };
                                     auto out = w::CreatorOpen(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    dispatcher.Register(simWrite("cc.page", xfb::Access::WriteCharacter, xfb::RunOn::GameThread, "Creator camera (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseCreatorPage(aContext.params);
                                     requirePhase("character_menu", "not_in_character_menu");
                                     return json{{"simulated", true}, {"page", request.page}, {"slot", request.slot},
                                                 {"undo", {{"method", "cc.page"}, {"params", {{"page", "default"}}}}}};
                                 }));
    // game.options.read, simulated: a few settings like the game's user settings, and the render options
    // through the same OptionsExchange the plugin uses, answered by a simulated CET layer in the pump loop.
    dispatcher.Register({"game.options.read", xfb::Access::Read, xfb::RunOn::BridgeThread, "Game options (simulated).",
                         [&layers](const xfb::MethodContext& aContext) {
                             const auto request = p::ParseGameOptions(aContext.params);
                             json out{{"simulated", true}};
                             if (request.settings)
                             {
                                 const std::map<std::string, json> all{
                                     {"/graphics/presets",
                                      {{"ResolutionScaling", {{"type", "string_list"}, {"value", "DLSS"}, {"index", 1}}},
                                       {"DLSS", {{"type", "string_list"}, {"value", "DLAA"}, {"index", 6}}}}},
                                     {"/graphics/advanced", {{"SubsurfaceScatteringQuality", {{"type", "string_list"}, {"value", "High"}, {"index", 2}}}}},
                                     {"/graphics/raytracing",
                                      {{"RayTracing", {{"type", "bool"}, {"value", true}}},
                                       {"RayTracedPathTracing", {{"type", "bool"}, {"value", false}}},
                                       {"RayTracedLighting", {{"type", "string_list"}, {"value", "Ultra"}, {"index", 2}}}}},
                                     {"/graphics/basic", {{"FilmGrain", {{"type", "bool"}, {"value", false}}}}},
                                     {"/graphics/performance", {{"CrowdDensity", {{"type", "name_list"}, {"value", "High"}, {"index", 2}}}}},
                                     {"/video/display", {{"HDRModes", {{"type", "string_list"}, {"value", "SDR"}, {"index", 0}}}}}};
                                 json groups = json::object();
                                 for (const auto& group : request.groups)
                                 {
                                     groups[group] = all.at(group);
                                 }
                                 out["settings"] = {{"groups", groups}};
                             }
                             if (request.renderOptions)
                             {
                                 if (!layers.Has("cet"))
                                 {
                                     out["render_options"] = {{"available", false}, {"reason", "simulated: no CET layer"}};
                                 }
                                 else
                                 {
                                     const auto seq = options.Request(request.names);
                                     xfb::OptionsOutcome outcome;
                                     const auto values = options.WaitFor(seq, std::chrono::milliseconds(3000), &outcome);
                                     if (!values)
                                     {
                                         options.Withdraw(seq);
                                     }
                                     out["render_options"] = xfb::RenderOptionsResult(request.names, values, outcome, 3000);
                                 }
                             }
                             return out;
                         }});
    dispatcher.Register(simWrite("cc.confirm", xfb::Access::WriteCharacter, xfb::RunOn::GameThread, "Creator confirm (simulated).", simLeave(true)));
    dispatcher.Register(simWrite("cc.back", xfb::Access::WriteCharacter, xfb::RunOn::GameThread, "Creator back (simulated).", simLeave(false)));
    // photo.pose.set, simulated with the plugin's own sequence (writes::PoseSet): categories 0 "Idle" and 900
    // "XF Live"; the record PhotoModePoses.xfs_live_carrier is pose 7 "XF Live Carrier" in 900.
    dispatcher.Register(simWrite("photo.pose.set", xfb::Access::WritePhoto, xfb::RunOn::BridgeThread, "Pose (simulated).",
                                 [&queue](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParsePoseSet(aContext.params);
                                     const auto categoryOf = [](const std::string& aText) {
                                         return aText == "XF Live" ? 900 : aText == "Idle" ? 0 : -1;
                                     };
                                     w::PoseSetOps ops;
                                     auto poseText = std::make_shared<std::string>(request.pose);
                                     ops.category = [&request, categoryOf, poseText] {
                                         std::scoped_lock _(sim.mutex);
                                         if (sim.phase != "photo_mode")
                                         {
                                             throw xfb::MethodError("not_in_photo_mode", "simulated: photo mode is not open");
                                         }
                                         json out{{"before_known", true}, {"before_category", sim.poseCategory}, {"before_pose", sim.pose}};
                                         int32_t wanted = request.categoryValue;
                                         if (!request.record.empty())
                                         {
                                             if (request.record != xfb::livepose::kCarrierRecord)
                                             {
                                                 throw xfb::MethodError("bad_params", "simulated: no photo-mode pose record named " + request.record);
                                             }
                                             wanted = 900;
                                             *poseText = xfb::livepose::kCarrierPoseLabel;
                                             out["pose_text"] = *poseText;
                                         }
                                         else if (!request.category.empty())
                                         {
                                             wanted = categoryOf(request.category);
                                             if (wanted < 0)
                                             {
                                                 throw xfb::MethodError("bad_params", "simulated: no pose category labelled '" + request.category + "'");
                                             }
                                         }
                                         if (wanted < 0 || wanted == sim.poseCategory)
                                         {
                                             out["changed"] = false;
                                             out["category_value"] = sim.poseCategory;
                                             return out;
                                         }
                                         if (wanted != 0 && wanted != 900)
                                         {
                                             throw xfb::MethodError("bad_params", "simulated: category_value is 0 or 900");
                                         }
                                         sim.poseCategory = wanted;
                                         sim.pose = wanted == 900 ? 7 : 1;
                                         out["changed"] = true;
                                         out["category_value"] = wanted;
                                         out["category_text"] = wanted == 900 ? "XF Live" : "Idle";
                                         return out;
                                     };
                                     ops.settle = [&queue] {
                                         if (!w::WaitTicks(queue, 5, std::chrono::milliseconds(1000)))
                                         {
                                             throw xfb::MethodError("timeout", "simulated: no game ticks");
                                         }
                                     };
                                     ops.pose = [&request, poseText] {
                                         std::scoped_lock _(sim.mutex);
                                         int32_t wanted = request.poseValue;
                                         if (wanted < 0)
                                         {
                                             if (*poseText == xfb::livepose::kCarrierPoseLabel && sim.poseCategory == 900)
                                             {
                                                 wanted = 7;
                                             }
                                             else if (*poseText == "Stand 01" && sim.poseCategory == 0)
                                             {
                                                 wanted = 1;
                                             }
                                             else
                                             {
                                                 throw xfb::MethodError("bad_params", "simulated: no pose labelled '" + *poseText + "' in the current category");
                                             }
                                         }
                                         const bool changed = wanted != sim.pose;
                                         sim.pose = wanted;
                                         return json{{"changed", changed}, {"pose_value", wanted},
                                                     {"pose_text", wanted == 7 ? xfb::livepose::kCarrierPoseLabel : "Stand 01"}};
                                     };
                                     ops.restoreCategory = [](int32_t aValue) {
                                         std::scoped_lock _(sim.mutex);
                                         sim.poseCategory = aValue;
                                     };
                                     auto out = w::PoseSet(ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    // pose.live.read and pose.live.apply against the simulated carrier, through the same checks and plan as
    // the plugin (core/LivePose.cpp); the "memory" is sim.carrier.
    const auto simulatedCarrier = [](xfb::livepose::BufferCounts& aCounts, xfb::livepose::BufferSpans& aSpans) {
        aCounts.numFrames = 2;
        aCounts.numJoints = 71;
        aCounts.numTracks = 13;
        aCounts.numConstAnimKeys = static_cast<uint32_t>(sim.carrier.size());
        aCounts.numConstTrackKeys = 13;
        aCounts.dataBytes = static_cast<uint32_t>(sim.carrier.size() * 16 + 13 * 8);
        const auto begin = reinterpret_cast<uintptr_t>(sim.carrier.data());
        aSpans.constKeys = {begin, begin + sim.carrier.size() * 16};
        aSpans.constTracks = {aSpans.constKeys.end, aSpans.constKeys.end + 13 * 8};
    };
    dispatcher.Register({"pose.live.read", xfb::Access::Read, xfb::RunOn::GameThread, "Live carrier layout (simulated).",
                         [simulatedCarrier, jointNames](const xfb::MethodContext& aContext) {
                             namespace lp = xfb::livepose;
                             const auto request = p::ParsePoseLiveRead(aContext.params);
                             std::scoped_lock _(sim.mutex);
                             if (sim.phase != "photo_mode" || request.set != lp::kCarrierSet)
                             {
                                 throw xfb::MethodError("carrier_not_loaded", "simulated: the animation set " + request.set + " isn't loaded");
                             }
                             if (request.clip != lp::kCarrierClip)
                             {
                                 throw xfb::MethodError("clip_not_found", "simulated: the set has 1 clip, none named " + request.clip);
                             }
                             lp::BufferCounts counts;
                             lp::BufferSpans spans;
                             simulatedCarrier(counts, spans);
                             auto problems = lp::CheckSpans(counts, spans);
                             const auto keyProblems = lp::CheckConstKeys(counts, sim.carrier);
                             problems.insert(problems.end(), keyProblems.begin(), keyProblems.end());
                             if (!problems.empty())
                             {
                                 throw xfb::MethodError("layout_unrecognised", "simulated: " + problems.front());
                             }
                             json out{{"simulated", true}, {"found", true}, {"set", request.set}, {"clip", request.clip}, {"layout", "ok"},
                                      {"buffer", {{"num_frames", 2}, {"num_joints", 71}, {"num_const_anim_keys", sim.carrier.size()}}},
                                      {"keys_hash", lp::KeysHash(sim.carrier)}, {"keys", lp::DescribeKeys(sim.carrier, jointNames)},
                                      {"joint_names", jointNames}, {"bridge_wrote", sim.carrierWritten}};
                             const auto contract = lp::CheckCarrier(counts, sim.carrier);
                             out["carrier_contract"] = contract.empty() ? json("ok") : json(contract);
                             if (!request.expectHash.empty())
                             {
                                 out["expect_hash"] = request.expectHash;
                                 out["matches_offline"] = request.expectHash == out["keys_hash"].get<std::string>();
                             }
                             return out;
                         }});
    dispatcher.Register(simWrite("pose.live.apply", xfb::Access::WritePhoto, xfb::RunOn::GameThread, "Live carrier write (simulated).",
                                 [&config, jointNames](const xfb::MethodContext& aContext) {
                                     namespace lp = xfb::livepose;
                                     const auto request = p::ParsePoseLiveApply(aContext.params);
                                     p::LivePoseAllowed(config.allowLivePose);
                                     std::scoped_lock _(sim.mutex);
                                     if (request.restore)
                                     {
                                         const bool was = sim.carrierWritten;
                                         sim.carrier = sim.carrierOriginal;
                                         sim.carrierWritten = false;
                                         return json{{"simulated", true}, {"restored", was}, {"undo", nullptr}};
                                     }
                                     if (sim.phase != "photo_mode" || sim.poseCategory != 900 || sim.pose != 7)
                                     {
                                         throw xfb::MethodError("carrier_not_selected", "simulated: the XF live carrier isn't the selected photo-mode pose");
                                     }
                                     std::vector<lp::JointRotation> rotations;
                                     for (const auto& [name, rotation] : request.joints)
                                     {
                                         const auto it = std::find(jointNames.begin(), jointNames.end(), name);
                                         if (it == jointNames.end())
                                         {
                                             throw xfb::MethodError("bad_params", "simulated: the carrier's rig has no joint named '" + name + "'");
                                         }
                                         rotations.push_back({static_cast<uint16_t>(it - jointNames.begin()), rotation});
                                     }
                                     const auto writes = lp::PlanApply(sim.carrier, rotations, request.hips, 2);
                                     for (const auto& write : writes)
                                     {
                                         sim.carrier[write.keyIndex] = write.value;
                                     }
                                     sim.carrierWritten = true;
                                     return json{{"simulated", true}, {"applied", writes.size()}, {"keys_hash", lp::KeysHash(sim.carrier)},
                                                 {"undo", {{"method", "pose.live.apply"}, {"params", {{"restore", true}}}}}};
                                 }));
    dispatcher.Register(simWrite("world.time.set", xfb::Access::WriteWorld, xfb::RunOn::GameThread, "Clock (simulated).",
                                 [requirePhase](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseTime(aContext.params);
                                     std::scoped_lock _(sim.mutex);
                                     // Normal play, or with the appearance screen open (as XFWorld.SetTime).
                                     if (sim.phase != "gameplay" && sim.phase != "character_menu")
                                     {
                                         throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                     }
                                     const auto before = sim.clock;
                                     sim.clock = request.totalSeconds >= 0 ? request.totalSeconds
                                                                           : request.hours * 3600 + request.minutes * 60 + request.seconds;
                                     return json{{"simulated", true}, {"phase", sim.phase}, {"before_total_seconds", before}, {"after_total_seconds", sim.clock},
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
    // Bridge 0.4 -----------------------------------------------------------------------------------------
    // ui.message with the plugin's own board; selftest.messages reads what the CET layer would draw.
    static xfb::MessageBoard messages;
    dispatcher.Register({"ui.message", xfb::Access::Notify, xfb::RunOn::BridgeThread, "Message line (simulated CET layer).",
                         [](const xfb::MethodContext& aContext) {
                             auto out = messages.Post(p::ParseMessage(aContext.params));
                             out["simulated"] = true;
                             out["undo"] = {{"method", "ui.message"}, {"params", {{"clear", true}}}};
                             return out;
                         }});
    dispatcher.Register({"selftest.messages", xfb::Access::Read, xfb::RunOn::BridgeThread, "The message lines the CET layer would draw (self-test only).",
                         [](const xfb::MethodContext&) {
                             const auto text = messages.Snapshot();
                             return text.empty() ? json{{"messages", json::array()}} : json::parse(text);
                         }});
    // V's clothing: items named *Helmet*, *Hat* or *Cap* go in Head, *Glasses* or *Mask* in Face, anything
    // else in OuterChest; Items.Missing_01 doesn't exist.
    const auto slotOf = [](const std::string& aItem) -> std::string {
        if (aItem == "Items.Missing_01")
        {
            return {};
        }
        if (aItem.find("Helmet") != std::string::npos || aItem.find("Hat") != std::string::npos || aItem.find("Cap") != std::string::npos)
        {
            return "Head";
        }
        if (aItem.find("Glasses") != std::string::npos || aItem.find("Mask") != std::string::npos)
        {
            return "Face";
        }
        return "OuterChest";
    };
    const auto inventoryOps = [&queue, slotOf] {
        w::InventoryOps ops;
        ops.slot = [slotOf](const std::string& aSlot, const std::string& aItem) {
            std::scoped_lock _(sim.mutex);
            const auto slot = aItem.empty() ? aSlot : slotOf(aItem);
            const auto item = sim.worn.count(slot) ? sim.worn[slot] : std::string();
            return json{{"slot", slot}, {"item", item}, {"empty", item.empty()}, {"matches", !aItem.empty() && item == aItem}};
        };
        ops.removeAdded = [](const std::string& aItem) {
            std::scoped_lock _(sim.mutex);
            if (std::find(sim.added.begin(), sim.added.end(), aItem) == sim.added.end())
            {
                throw xfb::MethodError("not_added_by_bridge", "simulated: '" + aItem + "' wasn't added by the bridge");
            }
            sim.added.erase(std::find(sim.added.begin(), sim.added.end(), aItem));
            sim.inventory.erase(std::find(sim.inventory.begin(), sim.inventory.end(), aItem));
            return json{{"removed", true}};
        };
        ops.settle = [&queue] {
            if (!w::WaitTicks(queue, 2, std::chrono::milliseconds(1000)))
            {
                throw xfb::MethodError("timeout", "simulated: no game ticks");
            }
        };
        return ops;
    };
    dispatcher.Register(simWrite("inventory.equip", xfb::Access::WriteInventory, xfb::RunOn::BridgeThread, "Equip (simulated).",
                                 [inventoryOps, slotOf](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseInventoryEquip(aContext.params);
                                     auto ops = inventoryOps();
                                     ops.equip = [&request, slotOf] {
                                         std::scoped_lock _(sim.mutex);
                                         if (sim.phase != "gameplay")
                                         {
                                             throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                         }
                                         const auto slot = slotOf(request.item);
                                         if (slot.empty())
                                         {
                                             throw xfb::MethodError("bad_params", "simulated: '" + request.item + "' isn't a clothing item record");
                                         }
                                         if (!request.slot.empty() && request.slot != slot)
                                         {
                                             throw xfb::MethodError("bad_params", "simulated: '" + request.item + "' goes in the " + slot + " slot");
                                         }
                                         bool added = false;
                                         if (std::find(sim.inventory.begin(), sim.inventory.end(), request.item) == sim.inventory.end())
                                         {
                                             if (!request.addIfMissing)
                                             {
                                                 throw xfb::MethodError("not_in_inventory", "simulated: V doesn't have '" + request.item + "'");
                                             }
                                             sim.inventory.push_back(request.item);
                                             sim.added.push_back(request.item);
                                             added = true;
                                         }
                                         const auto previous = sim.worn.count(slot) ? sim.worn[slot] : std::string();
                                         const bool already = previous == request.item;
                                         if (!already)
                                         {
                                             sim.pendingSlot = slot;
                                             sim.pendingItem = request.item;
                                             sim.pendingTicks = 2;
                                         }
                                         sim.gameSaveLock = true;
                                         return json{{"item", request.item}, {"slot", slot}, {"added", added}, {"already_equipped", already}, {"previous", previous}};
                                     };
                                     auto out = w::InventoryEquip(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    dispatcher.Register(simWrite("inventory.unequip", xfb::Access::WriteInventory, xfb::RunOn::BridgeThread, "Unequip (simulated).",
                                 [inventoryOps, slotOf](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseInventoryUnequip(aContext.params);
                                     auto ops = inventoryOps();
                                     ops.unequip = [&request, slotOf] {
                                         std::scoped_lock _(sim.mutex);
                                         if (sim.phase != "gameplay")
                                         {
                                             throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                         }
                                         const auto slot = request.item.empty() ? request.slot : slotOf(request.item);
                                         const auto previous = sim.worn.count(slot) ? sim.worn[slot] : std::string();
                                         if (!request.item.empty() && !previous.empty() && previous != request.item)
                                         {
                                             throw xfb::MethodError("bad_params", "simulated: the slot holds '" + previous + "'");
                                         }
                                         if (!previous.empty())
                                         {
                                             sim.pendingSlot = slot;
                                             sim.pendingItem.clear();
                                             sim.pendingTicks = 2;
                                         }
                                         return json{{"slot", slot}, {"previous", previous}, {"was_empty", previous.empty()}};
                                     };
                                     auto out = w::InventoryUnequip(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    dispatcher.Register(simWrite("game.save", xfb::Access::WriteSave, xfb::RunOn::BridgeThread, "Manual save (simulated).",
                                 [&queue, &dispatcher](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseGameSave(aContext.params);
                                     w::SaveOps ops;
                                     ops.guard = [&dispatcher] { dispatcher.RequireWritesOpen(); };
                                     ops.prepare = [&request] {
                                         std::scoped_lock _(sim.mutex);
                                         if (sim.phase != "gameplay")
                                         {
                                             throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                         }
                                         const bool own = sim.gameSaveLock || sim.saveLock;
                                         if (own && !request.overrideLock)
                                         {
                                             throw xfb::MethodError("bridge_save_lock", "simulated: the bridge keeps saving locked");
                                         }
                                         if (own)
                                         {
                                             sim.relockAfterSave = true;
                                             sim.unlockTicks = 2;
                                         }
                                         return json{{"lock_released", own}};
                                     };
                                     ops.status = [&queue] {
                                         return xfb::RunGameTask(
                                             queue, std::chrono::milliseconds(1000),
                                             [] {
                                                 std::scoped_lock _(sim.mutex);
                                                 return json{{"locked", sim.gameSaveLock || sim.saveLock}, {"state", sim.saveState}};
                                             },
                                             "game.save.status");
                                     };
                                     ops.save = [&request] {
                                         std::scoped_lock _(sim.mutex);
                                         if (sim.gameSaveLock || sim.saveLock)
                                         {
                                             throw xfb::MethodError("saving_locked", "simulated: saving is locked");
                                         }
                                         sim.saveState = "pending";
                                         sim.saveTicks = request.name == "never answered" ? -1 : 3;
                                         return json{{"requested", true}};
                                     };
                                     ops.relock = [] {
                                         std::scoped_lock _(sim.mutex);
                                         sim.gameSaveLock = true;
                                         sim.relockAfterSave = false;
                                         sim.unlockTicks = -1;
                                     };
                                     ops.sleep = [](std::chrono::milliseconds aFor) { std::this_thread::sleep_for(aFor); };
                                     auto out = w::GameSave(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    dispatcher.Register(simWrite("game.load", xfb::Access::WriteSave, xfb::RunOn::BridgeThread, "Load (simulated).",
                                 [&queue, &dispatcher](const xfb::MethodContext& aContext) {
                                     const auto request = p::ParseGameLoad(aContext.params);
                                     const auto refuse = [] {
                                         if (sim.phase != "gameplay" && sim.phase != "menu" && sim.phase != "paused")
                                         {
                                             throw xfb::MethodError("not_in_gameplay", "simulated: the game is in '" + sim.phase + "'");
                                         }
                                     };
                                     w::LoadOps ops;
                                     ops.guard = [&dispatcher] { dispatcher.RequireWritesOpen(); };
                                     ops.latest = [refuse] {
                                         std::scoped_lock _(sim.mutex);
                                         refuse();
                                         sim.phase = "loading";
                                         sim.loadTicks = 4;
                                         return json{{"requested", true}, {"route", "latest"}};
                                     };
                                     ops.list = [refuse] {
                                         std::scoped_lock _(sim.mutex);
                                         refuse();
                                         sim.savesReady = false;
                                         sim.listTicks = 2;
                                         return json{{"requested", true}};
                                     };
                                     ops.saves = [&queue] {
                                         return xfb::RunGameTask(
                                             queue, std::chrono::milliseconds(1000),
                                             [] {
                                                 std::scoped_lock _(sim.mutex);
                                                 return json{{"ready", sim.savesReady}, {"saves", sim.savesReady ? json(sim.saves) : json::array()}};
                                             },
                                             "game.load.saves");
                                     };
                                     ops.load = [refuse](const std::string& aName) {
                                         std::scoped_lock _(sim.mutex);
                                         refuse();
                                         // As XFGame.LoadNamed: the exact name, looked up in the list the game just sent.
                                         const auto at = std::find(sim.saves.begin(), sim.saves.end(), aName);
                                         if (!sim.savesReady || at == sim.saves.end() || std::count(sim.saves.begin(), sim.saves.end(), aName) != 1)
                                         {
                                             throw xfb::MethodError("save_not_found", "simulated: the game's save list no longer has '" + aName + "'");
                                         }
                                         sim.phase = "loading";
                                         sim.loadTicks = 4;
                                         return json{{"requested", true}, {"route", "name"}, {"name", aName}, {"index", at - sim.saves.begin()}};
                                     };
                                     ops.sleep = [](std::chrono::milliseconds aFor) { std::this_thread::sleep_for(aFor); };
                                     auto out = w::GameLoad(request, ops);
                                     out["simulated"] = true;
                                     return out;
                                 }));
    // What the simulated save and inventory state looks like (self-test only).
    dispatcher.Register({"selftest.state", xfb::Access::Read, xfb::RunOn::BridgeThread, "Simulated clothing, saves and lights (self-test only).",
                         [](const xfb::MethodContext&) {
                             std::scoped_lock _(sim.mutex);
                             json lights = json::object();
                             for (const auto& [light, at] : sim.lights)
                             {
                                 lights[std::to_string(light)] = {at[0], at[1], at[2]};
                             }
                             return json{{"worn", sim.worn}, {"inventory", sim.inventory}, {"added", sim.added}, {"saves", sim.saves},
                                         {"save_lock", sim.gameSaveLock || sim.saveLock}, {"save_state", sim.saveState}, {"phase", sim.phase},
                                         {"lights", lights}};
                         }});

    // The kill switch's restore, simulated like XFBridgeActions.RestoreAfterKill: unfreeze and
    // show the photo-mode menu; the save lock would stay.
    const auto simulatedRestore = [] {
        std::scoped_lock _(sim.mutex);
        json out{{"simulated", true}, {"world_unfrozen", sim.frozen}, {"photo_ui_shown", sim.hudHidden}, {"cursor_shown", sim.cursorHidden}};
        if (sim.creatorOpenTicks >= 0)
        {
            out["creator_open_withdrawn"] = true;
        }
        if (sim.carrierWritten)
        {
            out["carrier_restored"] = true;
            sim.carrier = sim.carrierOriginal;
            sim.carrierWritten = false;
        }
        // A save with override_lock cut off by the kill switch: its lock goes back on (RB-52).
        if (sim.relockAfterSave)
        {
            sim.relockAfterSave = false;
            sim.gameSaveLock = true;
            sim.unlockTicks = -1;
            out["save_lock_retaken"] = true;
        }
        sim.creatorOpenTicks = -1;
        sim.frozen = false;
        sim.hudHidden = false;
        sim.cursorHidden = false;
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
    int rearms = 0;
    std::chrono::steady_clock::time_point killedAt{};
    while (!gStop.load() && std::chrono::steady_clock::now() < deadline &&
           (bridge.IsListening() || (rearmAfterMs >= 0 && rearms < 3)))
    {
        // As the plugin's HandleRearm: once the kill switch's restore has run and the listener has stopped,
        // re-arm with a new session (the in-game panel's Reconnect), after --rearm-after-ms.
        if (rearmAfterMs >= 0 && bridge.RestoreReady())
        {
            if (killedAt == std::chrono::steady_clock::time_point{})
            {
                killedAt = std::chrono::steady_clock::now();
            }
            const bool due = std::chrono::steady_clock::now() - killedAt >= std::chrono::milliseconds(rearmAfterMs);
            if (pump)
            {
                restore.Tick(bridge.RestoreReady(), simulatedRestore, restoreFailed);
            }
            if (due && bridge.RearmRefusal().empty() && !restore.Pending())
            {
                restore.Reset();
                options.Reset();
                std::string rearmError;
                const bool ok = bridge.Rearm(
                    [&session, &runtimeDir](std::string& aError) {
                        if (!xfb::CreateSession(session, aError, std::filesystem::path(runtimeDir)))
                        {
                            return false;
                        }
                        xfb::log::SetSessionId(session.sessionId);
                        return true;
                    },
                    pump, rearmError);
                ++rearms;
                killedAt = {};
                xfb::log::Info("selftest.rearm", std::string("ok=") + (ok ? "true" : "false") + " error=" + rearmError);
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(16));
            continue;
        }
        if (pump)
        {
            queue.Drain(4); // the plugin does this once per engine tick
            {
                // The simulated equipment system, save system and loading screen.
                std::scoped_lock _(sim.mutex);
                if (sim.pendingTicks > 0 && --sim.pendingTicks == 0)
                {
                    if (sim.pendingItem.empty())
                    {
                        sim.worn.erase(sim.pendingSlot);
                    }
                    else
                    {
                        sim.worn[sim.pendingSlot] = sim.pendingItem;
                    }
                    sim.pendingTicks = -1;
                }
                if (sim.unlockTicks > 0 && --sim.unlockTicks == 0)
                {
                    sim.gameSaveLock = false;
                    sim.saveLock = false;
                    sim.unlockTicks = -1;
                }
                if (sim.saveTicks > 0 && --sim.saveTicks == 0)
                {
                    sim.saves.insert(sim.saves.begin(), "ManualSave-" + std::to_string(sim.saves.size() + 1));
                    sim.saveState = "saved";
                    sim.saveTicks = -1;
                    if (sim.relockAfterSave)
                    {
                        sim.gameSaveLock = true;
                        sim.relockAfterSave = false;
                    }
                }
                if (sim.listTicks > 0 && --sim.listTicks == 0)
                {
                    sim.savesReady = true;
                    sim.listTicks = -1;
                }
                if (sim.loadTicks > 0 && --sim.loadTicks == 0)
                {
                    // A loaded save: gameplay again, every bridge lock and change gone.
                    sim.phase = "gameplay";
                    sim.gameSaveLock = false;
                    sim.saveLock = false;
                    sim.worn.clear();
                    sim.loadTicks = -1;
                }
            }
            {
                // The simulated menu picks up a cc.open request a couple of ticks later.
                std::scoped_lock _(sim.mutex);
                if (sim.creatorOpenTicks > 0)
                {
                    --sim.creatorOpenTicks;
                }
                else if (sim.creatorOpenTicks == 0)
                {
                    sim.creatorOpenTicks = -1;
                    if (sim.phase == "gameplay")
                    {
                        sim.phase = "character_menu";
                        sim.creatorChanges = 0;
                    }
                }
            }
            // The simulated CET layer answers a render-option request as init.lua does: known names
            // get their value as text, unknown ones are left out.
            if (cet)
            {
                const auto pending = options.Pending();
                if (!pending.empty())
                {
                    const auto request = json::parse(pending);
                    json values = json::object();
                    for (const auto& name : request["names"])
                    {
                        const auto text = name.get<std::string>();
                        if (text.rfind("Editor/Characters/", 0) == 0 || text.rfind("Developer/FeatureToggles/", 0) == 0)
                        {
                            values[text] = text.find("Use") != std::string::npos || text.find("FeatureToggles") != std::string::npos
                                               ? "true"
                                               : "0.500000";
                        }
                    }
                    std::string why;
                    if (!options.Report(json{{"seq", request["seq"]}, {"values", values}}.dump(), &why))
                    {
                        xfb::log::Warn("selftest.options_report_refused", "why=" + why);
                    }
                }
            }
            if (bridge.RestoreReady())
            {
                options.Cancel();
                messages.Clear(); // a killed bridge shows no messages (XFBridge_Messages in the plugin)
            }
            restore.Tick(bridge.RestoreReady(), simulatedRestore, restoreFailed);
            // As the plugin's tick: a client dropped for idleness gives the cursor back (RB-34).
            if (bridge.TakeIdleDisconnect() && restore.WritesUsed() && !restore.Done())
            {
                std::scoped_lock _(sim.mutex);
                xfb::log::Info("bridge.idle_cursor_released",
                               std::string("{\"simulated\":true,\"cursor_shown\":") + (sim.cursorHidden ? "true" : "false") + "}",
                               "idle-release");
                sim.cursorHidden = false;
            }
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
