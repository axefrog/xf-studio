#pragma once

// Local-only transport: one Windows named pipe instance, one client at a time,
// newline-delimited UTF-8 JSON messages in both directions.
//
// Safety properties, all enforced here:
//  - PIPE_REJECT_REMOTE_CLIENTS: SMB/network clients are refused by the OS;
//  - an explicit DACL granting access only to the user running the game (no Everyone read);
//  - FILE_FLAG_FIRST_PIPE_INSTANCE: fails if another process already owns the name;
//  - bounded message size and an idle timeout; overlapped I/O so Stop() never hangs.

#include <atomic>
#include <cstdint>
#include <functional>
#include <string>
#include <thread>

namespace xfb
{
class PipeServer
{
public:
    // Called on the server thread for every complete line; returns the response line (no newline).
    // aClientPid is the connected process id (GetNamedPipeClientProcessId), for audit logs.
    using Handler = std::function<std::string(const std::string& aLine, uint32_t aClientPid)>;

    static constexpr size_t kMaxLineBytes = 64 * 1024;

    ~PipeServer();

    bool Start(const std::wstring& aPipeName, uint32_t aIdleDisconnectSeconds, Handler aHandler,
               std::string& aError);
    void Stop();

    // Closes the current client connection (kill switch) without stopping the server.
    void DropClient();

    bool IsRunning() const;
    bool HasClient() const;
    uint64_t ConnectionsAccepted() const;

private:
    void Run();
    void ServeClient(uint32_t aClientPid);
    bool WriteAll(const std::string& aData);

    std::wstring m_pipeName;
    uint32_t m_idleDisconnectSeconds = 120;
    Handler m_handler;
    std::thread m_thread;
    void* m_pipe = nullptr;       // HANDLE
    void* m_stopEvent = nullptr;  // HANDLE, manual reset
    void* m_dropEvent = nullptr;  // HANDLE, auto reset
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_hasClient{false};
    std::atomic<uint64_t> m_connections{0};
};
} // namespace xfb
