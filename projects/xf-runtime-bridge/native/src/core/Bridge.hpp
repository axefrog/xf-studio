#pragma once

// Owns the bridge endpoint for one game process: session, pipe server, dispatcher,
// discovery file and kill-switch watcher. Shared by the RED4ext plugin and the self-test.

#include <atomic>
#include <condition_variable>
#include <functional>
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
    // Kill switch (hotkey, KILL file or bridge.kill): refuse everything, close the game-thread
    // queue (queued writes never run), drop the client, remove session.json; the watcher thread
    // then stops the listener.
    void Kill(const std::string& aReason);
    // Re-arm after the kill switch (the in-game panel's Reconnect), from the game thread between queue
    // drains. Refuses (false, aError) unless the bridge was killed and its listener has stopped; the
    // caller also makes sure the kill switch's restore has run. Then: the old watcher is joined, the
    // KILL file removed, aRenew gives the session a new identity (new token, pipe name and session id,
    // so no client of the old session can talk to the new one), the queue reopens (aPumping), the
    // dispatcher accepts requests again and the listener starts with a new session.json. If starting
    // fails, the bridge stays killed.
    bool Rearm(const std::function<bool(std::string&)>& aRenew, bool aPumping, std::string& aError);
    // Why a re-arm would be refused now ("" when it wouldn't): not killed, or still stopping.
    std::string RearmRefusal() const;
    uint32_t Rearms() const;
    // True once the kill switch has fired and the queue is closed: the kill-switch undo may run
    // on the game thread, and no bridge write can run after it.
    bool RestoreReady() const;
    // True once after the pipe dropped a client for idleness (idle_disconnect_seconds): the game
    // thread then gives the mouse cursor back (RB-34). Clears the flag.
    bool TakeIdleDisconnect();

    Dispatcher& GetDispatcher();
    nlohmann::json Status() const;
    bool IsListening() const;

private:
    void Watch();
    void StopListener(const std::string& aReason);
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
    std::atomic<bool> m_idleDisconnect{false};
    std::atomic<uint32_t> m_rearms{0};
};
} // namespace xfb
