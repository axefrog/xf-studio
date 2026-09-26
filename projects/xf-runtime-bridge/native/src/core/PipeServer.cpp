#include "core/PipeServer.hpp"

#include <Windows.h>
#include <sddl.h>

#include <algorithm>
#include <chrono>

#include "core/Log.hpp"
#include "core/Win32.hpp"

namespace xfb
{
namespace
{
constexpr DWORD kBufferBytes = 64 * 1024;
constexpr DWORD kWriteTimeoutMs = 5000;
constexpr DWORD kFirstBackoffMs = 100;
constexpr DWORD kMaxBackoffMs = 5000;

// Waits for an overlapped operation, the stop event or (optionally) the drop event.
// Returns WAIT_OBJECT_0 for the I/O, +1 for stop, +2 for drop, or WAIT_TIMEOUT.
DWORD WaitIo(HANDLE aIoEvent, HANDLE aStop, HANDLE aDrop, DWORD aTimeoutMs)
{
    HANDLE handles[3] = {aIoEvent, aStop, aDrop};
    const DWORD count = aDrop ? 3 : 2;
    return WaitForMultipleObjects(count, handles, FALSE, aTimeoutMs);
}

void CancelAndDrain(HANDLE aPipe, OVERLAPPED& aOverlapped)
{
    CancelIoEx(aPipe, &aOverlapped);
    DWORD ignored = 0;
    GetOverlappedResult(aPipe, &aOverlapped, &ignored, TRUE);
}

bool IsSignalled(HANDLE aEvent)
{
    return WaitForSingleObject(aEvent, 0) == WAIT_OBJECT_0;
}

const char* ReasonName(int aReason)
{
    static constexpr const char* kNames[] = {"client_closed", "stopped",     "kill_switch", "idle",
                                             "read_failed",   "write_failed", "too_large",   "too_many_rejected"};
    return aReason >= 0 && aReason < 8 ? kNames[aReason] : "unknown";
}

constexpr const char* kTooLargeReply =
    R"({"v":1,"id":null,"cid":"-","ok":false,"error":{"code":"too_large","message":"message exceeds 65536 bytes"}})"
    "\n";
constexpr const char* kInternalErrorReply =
    R"({"v":1,"id":null,"cid":"-","ok":false,"error":{"code":"failed","message":"internal error"}})";
} // namespace

PipeServer::~PipeServer()
{
    Stop();
}

void PipeServer::SetIdleCallback(std::function<void()> aOnIdle)
{
    m_onIdle = std::move(aOnIdle);
}

bool PipeServer::Start(const std::wstring& aPipeName, uint32_t aIdleDisconnectSeconds, Handler aHandler,
                       std::string& aError)
{
    if (m_running.load())
    {
        aError = "already running";
        return false;
    }

    std::string userSid;
    if (!win32::CurrentUserSid(userSid))
    {
        aError = "could not read the current user SID: " + win32::LastErrorText(GetLastError());
        return false;
    }

    // Protected DACL: full access for the current user only. Without an explicit DACL a
    // named pipe also grants read access to Everyone and the anonymous account.
    const auto sddl = L"D:P(A;;GA;;;" + win32::Widen(userSid) + L")";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
    {
        aError = "could not build the pipe security descriptor: " + win32::LastErrorText(GetLastError());
        return false;
    }
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};

    const auto pipe = CreateNamedPipeW(aPipeName.c_str(),
                                       PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                                       PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                                       1, kBufferBytes, kBufferBytes, 0, &attributes);
    const auto createError = GetLastError();
    LocalFree(descriptor);
    if (pipe == INVALID_HANDLE_VALUE)
    {
        aError = "CreateNamedPipe failed: " + win32::LastErrorText(createError);
        return false;
    }

    const auto stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    const auto dropEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!stopEvent || !dropEvent)
    {
        aError = "CreateEvent failed: " + win32::LastErrorText(GetLastError());
        CloseHandle(pipe);
        if (stopEvent)
        {
            CloseHandle(stopEvent);
        }
        if (dropEvent)
        {
            CloseHandle(dropEvent);
        }
        return false;
    }

    {
        std::scoped_lock _(m_handleMutex);
        m_pipe = pipe;
        m_stopEvent = stopEvent;
        m_dropEvent = dropEvent;
    }
    m_pipeName = aPipeName;
    m_idleDisconnectSeconds = aIdleDisconnectSeconds;
    m_handler = std::move(aHandler);
    m_running.store(true);
    m_thread = std::thread(
        [this]
        {
            // Thread entry: nothing may escape (std::terminate would take the game down).
            try
            {
                Run();
            }
            catch (const std::exception& e)
            {
                log::Error("bridge.thread_failed", std::string("thread=pipe what=") + e.what());
            }
            catch (...)
            {
                log::Error("bridge.thread_failed", "thread=pipe what=unknown");
            }
            m_hasClient.store(false);
        });
    return true;
}

void PipeServer::Stop()
{
    if (!m_running.exchange(false))
    {
        return;
    }
    const auto started = std::chrono::steady_clock::now();
    {
        std::scoped_lock _(m_handleMutex);
        SetEvent(static_cast<HANDLE>(m_stopEvent));
    }
    if (m_thread.joinable())
    {
        if (m_thread.get_id() == std::this_thread::get_id())
        {
            // Never join ourselves; the thread sees the stop event and ends on its own.
            log::Error("bridge.stop_from_server_thread", "detached=true");
            m_thread.detach();
            return;
        }
        // Every wait in the server thread also watches the stop event, so this should be quick.
        // If it is not, cancel all I/O on the pipe so any blocked call returns.
        if (WaitForSingleObject(static_cast<HANDLE>(m_thread.native_handle()), kStopBudgetMs) == WAIT_TIMEOUT)
        {
            log::Warn("bridge.stop_slow", "waited_ms=" + std::to_string(kStopBudgetMs) + " action=cancel_io");
            CancelIoEx(static_cast<HANDLE>(m_pipe), nullptr);
        }
        m_thread.join();
    }
    {
        std::scoped_lock _(m_handleMutex);
        CloseHandle(static_cast<HANDLE>(m_pipe));
        CloseHandle(static_cast<HANDLE>(m_stopEvent));
        CloseHandle(static_cast<HANDLE>(m_dropEvent));
        m_pipe = m_stopEvent = m_dropEvent = nullptr;
    }
    const auto elapsed =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    log::Info("bridge.server_stopped", "stop_ms=" + std::to_string(elapsed));
}

void PipeServer::DropClient()
{
    std::scoped_lock _(m_handleMutex);
    if (m_dropEvent)
    {
        SetEvent(static_cast<HANDLE>(m_dropEvent));
    }
}

bool PipeServer::IsRunning() const
{
    return m_running.load();
}

bool PipeServer::HasClient() const
{
    return m_hasClient.load();
}

uint64_t PipeServer::ConnectionsAccepted() const
{
    return m_connections.load();
}

void PipeServer::Run()
{
    const auto pipe = static_cast<HANDLE>(m_pipe);
    const auto stop = static_cast<HANDLE>(m_stopEvent);
    const auto drop = static_cast<HANDLE>(m_dropEvent);
    const auto connectEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!connectEvent)
    {
        log::Error("bridge.listen_failed", "CreateEvent: " + win32::LastErrorText(GetLastError()));
        return;
    }
    log::Info("bridge.listen", "pipe=" + win32::Narrow(m_pipeName) + " instances=1 remote_clients=rejected");

    DWORD backoffMs = 0;
    while (m_running.load() && !IsSignalled(stop))
    {
        OVERLAPPED overlapped{};
        overlapped.hEvent = connectEvent;
        ResetEvent(connectEvent);

        bool connected = false;
        DWORD error = ERROR_SUCCESS;
        if (ConnectNamedPipe(pipe, &overlapped))
        {
            connected = true;
        }
        else
        {
            error = GetLastError();
            if (error == ERROR_PIPE_CONNECTED)
            {
                connected = true;
            }
            else if (error == ERROR_IO_PENDING)
            {
                const auto wait = WaitIo(connectEvent, stop, nullptr, INFINITE);
                if (wait != WAIT_OBJECT_0)
                {
                    CancelAndDrain(pipe, overlapped);
                    break; // stop requested
                }
                DWORD ignored = 0;
                connected = GetOverlappedResult(pipe, &overlapped, &ignored, FALSE) != FALSE;
                error = connected ? ERROR_SUCCESS : GetLastError();
            }
        }

        if (!connected)
        {
            // Reset the instance before retrying (e.g. ERROR_NO_DATA: a client connected and left
            // before we accepted; without DisconnectNamedPipe every retry fails the same way).
            DisconnectNamedPipe(pipe);
            backoffMs = backoffMs == 0 ? kFirstBackoffMs : std::min<DWORD>(backoffMs * 2, kMaxBackoffMs);
            log::Warn("bridge.connect_failed", win32::LastErrorText(error) + " retry_ms=" + std::to_string(backoffMs));
            if (WaitForSingleObject(stop, backoffMs) == WAIT_OBJECT_0)
            {
                break;
            }
            continue;
        }
        backoffMs = 0;

        ULONG clientPid = 0;
        GetNamedPipeClientProcessId(pipe, &clientPid);
        m_connections.fetch_add(1);
        m_hasClient.store(true);
        ResetEvent(drop);
        log::Info("bridge.client_connected", "client_pid=" + std::to_string(clientPid) +
                                                 " connection=" + std::to_string(m_connections.load()));

        const auto reason = ServeClient(clientPid);
        if (reason == EndReason::Dropped || reason == EndReason::TooLarge || reason == EndReason::TooManyRejected)
        {
            Linger();
        }
        // No FlushFileBuffers: it waits until the client reads, which a client can refuse to do.
        DisconnectNamedPipe(pipe);
        m_hasClient.store(false);
        log::Info("bridge.client_disconnected", "client_pid=" + std::to_string(clientPid) +
                                                    " reason=" + ReasonName(static_cast<int>(reason)));
        if (reason == EndReason::TooManyRejected)
        {
            // Penalty before accepting again, so reconnecting does not reset the throttle:
            // at most kMaxRejectedPerConnection refusals (and log lines) per penalty period.
            if (WaitForSingleObject(stop, kRejectPenaltyMs) == WAIT_OBJECT_0)
            {
                break;
            }
        }
    }

    CloseHandle(connectEvent);
    log::Info("bridge.stopped", "connections_served=" + std::to_string(m_connections.load()));
}

PipeServer::EndReason PipeServer::ServeClient(uint32_t aClientPid)
{
    const auto pipe = static_cast<HANDLE>(m_pipe);
    const auto stop = static_cast<HANDLE>(m_stopEvent);
    const auto drop = static_cast<HANDLE>(m_dropEvent);
    const auto readEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!readEvent)
    {
        log::Warn("bridge.read_failed", "CreateEvent: " + win32::LastErrorText(GetLastError()));
        return EndReason::ReadFailed;
    }
    std::string pending;
    std::string chunk(4096, '\0');
    uint32_t rejected = 0;
    EndReason reason = EndReason::ClientClosed;

    for (;;)
    {
        // Checked every round, not only while a read waits: a client that keeps data flowing
        // completes every read at once and must still not delay a stop or a kill. Drop first:
        // bridge.kill sets it before its reply is written, and the watcher may already be
        // stopping the server; the drop path lingers so the client still reads that reply.
        if (IsSignalled(drop))
        {
            log::Warn("bridge.client_dropped", "reason=kill_switch client_pid=" + std::to_string(aClientPid));
            reason = EndReason::Dropped;
            break;
        }
        if (IsSignalled(stop))
        {
            reason = EndReason::Stopped;
            break;
        }

        OVERLAPPED overlapped{};
        overlapped.hEvent = readEvent;
        ResetEvent(readEvent);

        DWORD bytes = 0;
        bool ok = ReadFile(pipe, chunk.data(), static_cast<DWORD>(chunk.size()), nullptr, &overlapped) != FALSE;
        auto error = ok ? ERROR_SUCCESS : GetLastError();
        if (!ok && error == ERROR_IO_PENDING)
        {
            const auto wait = WaitIo(readEvent, stop, drop, m_idleDisconnectSeconds * 1000);
            if (wait == WAIT_OBJECT_0 + 1)
            {
                CancelAndDrain(pipe, overlapped);
                reason = EndReason::Stopped;
                break;
            }
            if (wait == WAIT_OBJECT_0 + 2)
            {
                CancelAndDrain(pipe, overlapped);
                log::Warn("bridge.client_dropped", "reason=kill_switch client_pid=" + std::to_string(aClientPid));
                reason = EndReason::Dropped;
                break;
            }
            if (wait == WAIT_TIMEOUT)
            {
                CancelAndDrain(pipe, overlapped);
                log::Info("bridge.client_idle", "idle_seconds=" + std::to_string(m_idleDisconnectSeconds));
                reason = EndReason::Idle;
                if (m_onIdle)
                {
                    m_onIdle(); // sets a flag only; the thread's own catch-all covers it
                }
                break;
            }
            ok = true;
        }
        if (ok)
        {
            ok = GetOverlappedResult(pipe, &overlapped, &bytes, FALSE) != FALSE;
            error = ok ? ERROR_SUCCESS : GetLastError();
        }
        if (!ok)
        {
            if (error != ERROR_BROKEN_PIPE && error != ERROR_PIPE_NOT_CONNECTED)
            {
                log::Warn("bridge.read_failed", win32::LastErrorText(error));
                reason = EndReason::ReadFailed;
            }
            break;
        }

        pending.append(chunk.data(), bytes);

        size_t newline;
        bool endClient = false;
        while ((newline = pending.find('\n')) != std::string::npos)
        {
            if (IsSignalled(drop))
            {
                log::Warn("bridge.client_dropped", "reason=kill_switch client_pid=" + std::to_string(aClientPid));
                reason = EndReason::Dropped;
                endClient = true;
                break;
            }
            if (IsSignalled(stop))
            {
                reason = EndReason::Stopped;
                endClient = true;
                break;
            }
            std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            if (!line.empty() && line.back() == '\r')
            {
                line.pop_back();
            }
            if (line.empty())
            {
                continue;
            }
            PipeReply reply;
            try
            {
                reply = m_handler(line, aClientPid);
            }
            catch (...)
            {
                log::Error("bridge.handler_failed", "client_pid=" + std::to_string(aClientPid));
                reply = {kInternalErrorReply, true};
            }
            reply.line.push_back('\n');
            if (!WriteAll(reply.line))
            {
                reason = EndReason::WriteFailed;
                endClient = true;
                break;
            }
            if (reply.rejected && ++rejected >= kMaxRejectedPerConnection)
            {
                log::Warn("bridge.client_dropped", "reason=too_many_rejected rejected=" + std::to_string(rejected) +
                                                       " client_pid=" + std::to_string(aClientPid));
                reason = EndReason::TooManyRejected;
                endClient = true;
                break;
            }
        }
        if (endClient)
        {
            break;
        }
        if (pending.size() > kMaxLineBytes)
        {
            log::Warn("bridge.message_too_large", "bytes=" + std::to_string(pending.size()) +
                                                      " limit=" + std::to_string(kMaxLineBytes) +
                                                      " client_pid=" + std::to_string(aClientPid));
            WriteAll(kTooLargeReply);
            reason = EndReason::TooLarge;
            break;
        }
    }
    CloseHandle(readEvent);
    return reason;
}

// After the server ends a connection itself (kill switch, oversize or too many rejected
// requests), give the client a short window to read its last reply before DisconnectNamedPipe
// discards unread data. Anything it sends meanwhile is ignored. The window is fixed at
// kLingerMs and deliberately ignores the stop event: a kill stops the listener at once, and
// the client must still receive the bridge.kill reply. It is always shorter than kStopBudgetMs.
void PipeServer::Linger()
{
    const auto pipe = static_cast<HANDLE>(m_pipe);
    const auto readEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!readEvent)
    {
        return;
    }
    char scratch[4096];
    const auto deadline = GetTickCount64() + kLingerMs;
    for (;;)
    {
        const auto now = GetTickCount64();
        if (now >= deadline)
        {
            break;
        }
        OVERLAPPED overlapped{};
        overlapped.hEvent = readEvent;
        ResetEvent(readEvent);
        if (!ReadFile(pipe, scratch, sizeof(scratch), nullptr, &overlapped))
        {
            if (GetLastError() != ERROR_IO_PENDING)
            {
                break; // the client closed its end
            }
            if (WaitForSingleObject(readEvent, static_cast<DWORD>(deadline - now)) != WAIT_OBJECT_0)
            {
                CancelAndDrain(pipe, overlapped);
                break;
            }
        }
        DWORD ignored = 0;
        if (!GetOverlappedResult(pipe, &overlapped, &ignored, FALSE))
        {
            break;
        }
    }
    CloseHandle(readEvent);
}

bool PipeServer::WriteAll(const std::string& aData)
{
    const auto pipe = static_cast<HANDLE>(m_pipe);
    const auto stop = static_cast<HANDLE>(m_stopEvent);
    const auto writeEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!writeEvent)
    {
        return false;
    }
    size_t offset = 0;
    bool success = true;
    while (offset < aData.size())
    {
        OVERLAPPED overlapped{};
        overlapped.hEvent = writeEvent;
        ResetEvent(writeEvent);
        DWORD written = 0;
        const auto toWrite = static_cast<DWORD>(aData.size() - offset);
        bool ok = WriteFile(pipe, aData.data() + offset, toWrite, nullptr, &overlapped) != FALSE;
        if (!ok && GetLastError() == ERROR_IO_PENDING)
        {
            const auto wait = WaitIo(writeEvent, stop, nullptr, kWriteTimeoutMs);
            if (wait != WAIT_OBJECT_0)
            {
                CancelAndDrain(pipe, overlapped);
                log::Warn("bridge.write_timeout", "bytes=" + std::to_string(toWrite) +
                                                      (wait == WAIT_OBJECT_0 + 1 ? " reason=stop" : " reason=timeout"));
                success = false;
                break;
            }
            ok = true;
        }
        if (!ok || !GetOverlappedResult(pipe, &overlapped, &written, FALSE))
        {
            success = false;
            break;
        }
        offset += written;
    }
    CloseHandle(writeEvent);
    return success;
}
} // namespace xfb
