#pragma once

// Owns the bridge endpoint for one game process: session, pipe server, dispatcher,
// discovery file and kill-switch watcher. Shared by the RED4ext plugin and the self-test.

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include "core/Config.hpp"
#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/PipeServer.hpp"
#include "core/Session.hpp"

namespace xfb
{
class Bridge
{
public:
    Bridge(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue);
    ~Bridge();

    // Starts listening and writes session.json. Call only when [bridge] enabled = true.
    bool Start(std::string& aError);
    // Stops listening and removes session.json. Safe to call more than once.
    void Stop(const std::string& aReason);
    // Kill switch (hotkey, KILL file or bridge.kill): refuse everything, drop the client,
    // remove session.json; the watcher thread then stops the listener.
    void Kill(const std::string& aReason);

    Dispatcher& GetDispatcher();
    nlohmann::json Status() const;
    bool IsListening() const;

private:
    void Watch();
    void RemoveSessionFile();

    const Config& m_config;
    const Session& m_session;
    GameThreadQueue& m_queue;
    Dispatcher m_dispatcher;
    PipeServer m_server;

    std::thread m_watcher;
    std::mutex m_watchMutex;
    std::condition_variable m_watchWake;
    std::atomic<bool> m_watching{false};
    std::atomic<bool> m_sessionFileWritten{false};
};
} // namespace xfb
