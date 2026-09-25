#include "core/PipeServer.hpp"

#include <Windows.h>
#include <sddl.h>

#include "core/Log.hpp"
#include "core/Win32.hpp"

namespace xfb
{
namespace
{
constexpr DWORD kBufferBytes = 64 * 1024;
constexpr DWORD kWriteTimeoutMs = 5000;

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
} // namespace

PipeServer::~PipeServer()
{
    Stop();
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

    m_pipe = pipe;
    m_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    m_dropEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    m_pipeName = aPipeName;
    m_idleDisconnectSeconds = aIdleDisconnectSeconds;
    m_handler = std::move(aHandler);
    m_running.store(true);
    m_thread = std::thread([this] { Run(); });
    return true;
}

void PipeServer::Stop()
{
    if (!m_running.exchange(false))
    {
        return;
    }
    SetEvent(static_cast<HANDLE>(m_stopEvent));
    if (m_thread.joinable())
    {
        m_thread.join();
    }
    CloseHandle(static_cast<HANDLE>(m_pipe));
    CloseHandle(static_cast<HANDLE>(m_stopEvent));
    CloseHandle(static_cast<HANDLE>(m_dropEvent));
    m_pipe = m_stopEvent = m_dropEvent = nullptr;
}

void PipeServer::DropClient()
{
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
    const auto connectEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    log::Info("bridge.listen", "pipe=" + win32::Narrow(m_pipeName) + " instances=1 remote_clients=rejected");

    while (m_running.load())
    {
        OVERLAPPED overlapped{};
        overlapped.hEvent = connectEvent;
        ResetEvent(connectEvent);

        bool connected = false;
        if (ConnectNamedPipe(pipe, &overlapped))
        {
            connected = true;
        }
        else
        {
            const auto error = GetLastError();
            if (error == ERROR_PIPE_CONNECTED)
            {
                connected = true;
            }
            else if (error == ERROR_IO_PENDING)
            {
                const auto wait = WaitIo(connectEvent, stop, nullptr, INFINITE);
                if (wait == WAIT_OBJECT_0)
                {
                    DWORD ignored = 0;
                    connected = GetOverlappedResult(pipe, &overlapped, &ignored, FALSE) != FALSE;
                }
                else
                {
                    CancelAndDrain(pipe, overlapped);
                    break; // stop requested
                }
            }
            else
            {
                log::Error("bridge.connect_failed", win32::LastErrorText(error));
                if (WaitForSingleObject(stop, 1000) == WAIT_OBJECT_0)
                {
                    break;
                }
                continue;
            }
        }

        if (!connected)
        {
            DisconnectNamedPipe(pipe);
            continue;
        }

        ULONG clientPid = 0;
        GetNamedPipeClientProcessId(pipe, &clientPid);
        m_connections.fetch_add(1);
        m_hasClient.store(true);
        ResetEvent(static_cast<HANDLE>(m_dropEvent));
        log::Info("bridge.client_connected", "client_pid=" + std::to_string(clientPid) +
                                                 " connection=" + std::to_string(m_connections.load()));

        ServeClient(clientPid);

        FlushFileBuffers(pipe);
        DisconnectNamedPipe(pipe);
        m_hasClient.store(false);
        log::Info("bridge.client_disconnected", "client_pid=" + std::to_string(clientPid));
    }

    CloseHandle(connectEvent);
    log::Info("bridge.stopped", "connections_served=" + std::to_string(m_connections.load()));
}

void PipeServer::ServeClient(uint32_t aClientPid)
{
    const auto pipe = static_cast<HANDLE>(m_pipe);
    const auto stop = static_cast<HANDLE>(m_stopEvent);
    const auto drop = static_cast<HANDLE>(m_dropEvent);
    const auto readEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    std::string pending;
    std::string chunk(4096, '\0');

    for (;;)
    {
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
                break;
            }
            if (wait == WAIT_OBJECT_0 + 2)
            {
                CancelAndDrain(pipe, overlapped);
                log::Warn("bridge.client_dropped", "reason=kill_switch");
                break;
            }
            if (wait == WAIT_TIMEOUT)
            {
                CancelAndDrain(pipe, overlapped);
                log::Info("bridge.client_idle", "idle_seconds=" + std::to_string(m_idleDisconnectSeconds));
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
            }
            break;
        }

        pending.append(chunk.data(), bytes);

        size_t newline;
        bool stopClient = false;
        while ((newline = pending.find('\n')) != std::string::npos)
        {
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
            auto response = m_handler(line, aClientPid);
            response.push_back('\n');
            if (!WriteAll(response))
            {
                stopClient = true;
                break;
            }
        }
        if (stopClient)
        {
            break;
        }
        if (pending.size() > kMaxLineBytes)
        {
            log::Warn("bridge.message_too_large", "bytes=" + std::to_string(pending.size()) +
                                                      " limit=" + std::to_string(kMaxLineBytes));
            WriteAll(R"({"v":1,"id":null,"ok":false,"error":{"code":"too_large","message":"message exceeds 65536 bytes"}})"
                     "\n");
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
                log::Warn("bridge.write_timeout", "bytes=" + std::to_string(toWrite));
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
