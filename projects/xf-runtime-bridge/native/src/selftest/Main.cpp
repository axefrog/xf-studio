// xfb_selftest: hosts the bridge core outside the game with a simulated main thread.
//
// It exercises exactly the transport, protocol, token check, allowlist, write gate, rate
// limit, game-thread marshalling and kill switch the plugin uses. Game-thread methods return
// clearly marked simulated values; nothing here proves anything about the game itself.
//
// Usage: xfb_selftest --runtime-dir <dir> [--seconds N] [--allow-writes] [--no-pump]

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "core/Bridge.hpp"
#include "core/Layers.hpp"
#include "core/Log.hpp"
#include "core/Win32.hpp"

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
    bool pump = true;
    for (int i = 1; i < argc; ++i)
    {
        const std::wstring arg = argv[i];
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
    SetEnvironmentVariableW(L"XFB_RUNTIME_DIR", runtimeDir.c_str());
    SetConsoleCtrlHandler(OnConsoleCtrl, TRUE);

    StdoutSink sink;
    xfb::log::SetSink(&sink);
    xfb::log::SetMinLevel(xfb::Level::Debug);

    xfb::Config config;
    config.bridgeEnabled = true;
    config.allowWrites = allowWrites;
    config.maxRequestsPerSecond = 20;
    config.requestTimeoutMs = 1000;

    xfb::Session session;
    std::string error;
    if (!xfb::CreateSession(session, error))
    {
        std::fprintf(stderr, "session: %s\n", error.c_str());
        return 1;
    }
    xfb::log::SetSessionId(session.sessionId);
    xfb::log::Info("selftest.start", "pid=" + std::to_string(session.processId) +
                                         " allow_writes=" + (allowWrites ? "true" : "false") +
                                         " pump=" + (pump ? "true" : "false"));

    xfb::GameThreadQueue queue;
    xfb::LayerRegistry layers;
    layers.Announce("selftest", "simulated host; no game");
    xfb::Bridge bridge(config, session, queue);
    auto& dispatcher = bridge.GetDispatcher();

    dispatcher.Register({"bridge.info", xfb::Access::Read, xfb::RunOn::BridgeThread, "Versions and bridge status.",
                         [&](const xfb::MethodContext&) {
                             return json{{"host", "selftest"},
                                         {"plugin_version", XFB_VERSION_STRING},
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
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }

    queue.Close();
    bridge.Stop("selftest_exit");
    xfb::log::Info("selftest.exit", "requests=" + std::to_string(dispatcher.RequestCount()));
    xfb::log::SetSink(nullptr);
    return 0;
}
