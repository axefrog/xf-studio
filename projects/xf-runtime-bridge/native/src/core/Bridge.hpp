#pragma once

// Owns the bridge endpoint for one game process: session, pipe server, dispatcher,
// discovery file and kill-switch watcher. Shared by the RED4ext plugin and the self-test.

#include <atomic>
#include <condition_variable>
#include <functional>
#include <memory>
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
    // 0.8.2: the plugin creates its bridge here, so the allocation's size and the constructor come from one translation unit
    // (0.8.1's DLL allocated a Bridge of an older layout in a stale Main.obj and the constructor overran it).
    static std::unique_ptr<Bridge> Create(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue);

    // Starts listening and writes session.json. Call only when [bridge] enabled = true.
    bool Start(std::string& aError);
    // Stops listening and removes session.json. Safe to call more than once.
    void Stop(const std::string& aReason);
    // Kill switch (hotkey, KILL file or bridge.kill): refuse everything, close the game-thread
    // queue (queued writes never run), drop the client, remove session.json; the watcher thread
    // then stops the listener.
    void Kill(const std::string& aReason);
    // Install before Start. Pure nonblocking notification; never game/file work on the kill route.
    void SetStopObserver(std::function<void()> aObserver) { m_stopObserver = std::move(aObserver); }
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
    // Whether a client holds the pipe now (the ink HUD panel's status line, bridge 0.5.3).
    bool HasClient() const;
    uint64_t ConnectionsAccepted() const;
    // 0.8.2 (session 9: "XF Studio not connected" flickered between the coordinator's calls, each its own connection): the
    // status follows the session, not each connection: a client on either pipe now, a request in the last kSessionQuietMs,
    // or a session runner holding the session lock (checked at most once a second).
    static constexpr int64_t kSessionQuietMs = 180000;
    bool InSession() const;

private:
    void Watch();
    void StopListener(const std::string& aReason);
    void RemoveSessionFile();

    const Config& m_config;
    const Session& m_session;
    GameThreadQueue& m_queue;
    Dispatcher m_dispatcher;
    PipeServer m_server;
    // RB-121 (0.8.1): a second pipe, <pipe>-control, served on its own thread, answering only the emergency controls and a
    // handover's steps (IsControlRouteMethod), so a stop or a handover is read at once while the main pipe still serves a
    // long request (a five-second look). session.json names it (control_pipe).
    PipeServer m_control;

    std::thread m_watcher;
    std::function<void()> m_stopObserver;
    std::mutex m_watchMutex;
    std::condition_variable m_watchWake;
    std::atomic<bool> m_watching{false};
    std::atomic<bool> m_sessionFileWritten{false};
    std::atomic<bool> m_idleDisconnect{false};
    std::atomic<uint32_t> m_rearms{0};
    mutable std::atomic<int64_t> m_runnerCheckedMs{-1};
    mutable std::atomic<bool> m_runnerActive{false};
};
} // namespace xfb
