#include "core/Bridge.hpp"

#include <Windows.h>

#include "core/Log.hpp"
#include "core/Win32.hpp"

namespace xfb
{
using json = nlohmann::json;

Bridge::Bridge(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue)
    : m_config(aConfig)
    , m_session(aSession)
    , m_queue(aQueue)
    , m_dispatcher(aConfig, aSession, aQueue)
{
    // Control, not read or write: it changes only the bridge (it can only take access away),
    // never the game, so it stays available when allow_writes = false.
    m_dispatcher.Register({"bridge.kill", Access::Control, RunOn::BridgeThread,
                           "Kill switch: refuse all further requests until the game restarts.",
                           [this](const MethodContext& aContext) {
                               Kill("client:" + std::to_string(aContext.clientPid));
                               return json{{"killed", true}};
                           }});
}

Bridge::~Bridge()
{
    Stop("destructor");
}

bool Bridge::Start(std::string& aError)
{
    if (KillFilePresent(m_session))
    {
        aError = "kill file present: " + win32::Narrow(m_session.KillFile().wstring());
        return false;
    }

    if (!m_server.Start(
            m_session.pipeName, m_config.idleDisconnectSeconds,
            [this](const std::string& aLine, uint32_t aPid) {
                auto result = m_dispatcher.Handle(aLine, aPid);
                return PipeReply{std::move(result.line), result.rejected};
            },
            aError))
    {
        return false;
    }

    const json discovery{{"protocol", kProtocolVersion},
                         {"sid", m_session.sessionId},
                         {"pid", m_session.processId},
                         {"pipe", win32::Narrow(m_session.pipeName)},
                         {"token", m_session.token},
                         {"started_at", m_session.startedAt},
                         {"plugin_version", XFB_VERSION_STRING},
                         {"allow_writes", m_config.allowWrites},
                         {"write_classes", WriteClassList(m_config)}};
    std::string writeError;
    if (!win32::WriteFileAtomic(m_session.SessionFile(),
                                discovery.dump(2, ' ', false, json::error_handler_t::replace), writeError))
    {
        m_server.Stop();
        aError = "could not write session.json: " + writeError;
        return false;
    }
    m_sessionFileWritten.store(true);
    log::Info("bridge.session_file", "written=true dir=%LOCALAPPDATA%/XFStudio/runtime-bridge");

    m_watching.store(true);
    m_watcher = std::thread(
        [this]
        {
            // Thread entry: nothing may escape (std::terminate would take the game down).
            try
            {
                Watch();
            }
            catch (const std::exception& e)
            {
                log::Error("bridge.thread_failed", std::string("thread=watcher what=") + e.what());
            }
            catch (...)
            {
                log::Error("bridge.thread_failed", "thread=watcher what=unknown");
            }
        });
    return true;
}

void Bridge::Stop(const std::string& aReason)
{
    if (m_watching.exchange(false))
    {
        m_watchWake.notify_all();
        if (m_watcher.joinable() && m_watcher.get_id() != std::this_thread::get_id())
        {
            m_watcher.join();
        }
    }
    StopListener(aReason);
    RemoveSessionFile();
}

void Bridge::StopListener(const std::string& aReason)
{
    // Release anything the pipe thread waits for on the game thread first, so the join in
    // PipeServer::Stop is bounded. The bridge is the queue's only producer, and once the bridge
    // stops (kill switch, shutdown or unload) it never starts again in this process.
    m_queue.Close();
    if (m_server.IsRunning())
    {
        log::Info("bridge.stopping", "reason=" + aReason);
        m_server.Stop();
    }
}

void Bridge::Kill(const std::string& aReason)
{
    m_dispatcher.Kill(aReason);
    // Close the game-thread queue here, synchronously (it never blocks): a write already queued
    // is cancelled and never runs, so nothing can run after the kill-switch undo, which the game
    // thread starts only once RestoreReady() is true.
    m_queue.Close();
    m_server.DropClient();
    RemoveSessionFile();
    m_watchWake.notify_all(); // the watcher stops the listener off this thread
}

Dispatcher& Bridge::GetDispatcher()
{
    return m_dispatcher;
}

bool Bridge::RestoreReady() const
{
    return m_dispatcher.IsKilled() && m_queue.IsClosed();
}

bool Bridge::IsListening() const
{
    return m_server.IsRunning() && !m_dispatcher.IsKilled();
}

json Bridge::Status() const
{
    return json{{"enabled", m_config.bridgeEnabled},
                {"listening", IsListening()},
                {"killed", m_dispatcher.IsKilled()},
                {"kill_reason", m_dispatcher.KillReason()},
                {"has_client", m_server.HasClient()},
                {"connections", m_server.ConnectionsAccepted()},
                {"requests", m_dispatcher.RequestCount()},
                {"allow_writes", m_config.allowWrites},
                {"write_classes", WriteClassList(m_config)},
                {"game_thread_pumping", m_queue.IsPumping()},
                {"late_game_tasks", m_queue.LateCompletions()}};
}

void Bridge::Watch()
{
    std::unique_lock lock(m_watchMutex);
    while (m_watching.load())
    {
        m_watchWake.wait_for(lock, std::chrono::milliseconds(500));
        if (!m_watching.load())
        {
            break;
        }
        if (!m_dispatcher.IsKilled() && KillFilePresent(m_session))
        {
            lock.unlock();
            Kill("kill_file");
            lock.lock();
        }
        if (m_dispatcher.IsKilled() && m_server.IsRunning())
        {
            lock.unlock();
            StopListener("kill_switch");
            log::Warn("bridge.listener_closed", "reason=kill_switch");
            lock.lock();
        }
    }
}

void Bridge::RemoveSessionFile()
{
    if (m_sessionFileWritten.exchange(false))
    {
        DeleteFileW(m_session.SessionFile().c_str());
        log::Info("bridge.session_file", "removed=true");
    }
}
} // namespace xfb
