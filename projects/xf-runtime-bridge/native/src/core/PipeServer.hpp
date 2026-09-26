#pragma once

// Local-only transport: one Windows named pipe instance, one client at a time,
// newline-delimited UTF-8 JSON messages in both directions.
//
// Safety properties, all enforced here:
//  - PIPE_REJECT_REMOTE_CLIENTS: SMB/network clients are refused by the OS;
//  - an explicit DACL granting access only to the user running the game (no Everyone read);
//  - FILE_FLAG_FIRST_PIPE_INSTANCE: fails if another process already owns the name;
//  - bounded message size, an idle timeout, and a connection drop after
//    kMaxRejectedPerConnection malformed or unauthenticated requests;
//  - overlapped I/O, and every wait except the fixed kLingerMs window also watches the stop
//    event, so Stop() is bounded: it never waits for a client to read (no FlushFileBuffers),
//    and if the thread takes longer than kStopBudgetMs it warns and cancels the pipe's I/O.

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

namespace xfb
{
struct PipeReply
{
    std::string line;      // response, without the newline
    bool rejected = false; // malformed or unauthenticated; counts towards the per-connection limit
};

class PipeServer
{
public:
    // Called on the server thread for every complete line.
    // aClientPid is the connected process id (GetNamedPipeClientProcessId), for audit logs.
    using Handler = std::function<PipeReply(const std::string& aLine, uint32_t aClientPid)>;

    static constexpr size_t kMaxLineBytes = 64 * 1024;
    static constexpr uint32_t kMaxRejectedPerConnection = 5;
    static constexpr uint32_t kRejectPenaltyMs = 1000; // no new connection this long after a too-many-rejected drop
    static constexpr uint32_t kLingerMs = 500;      // after a server-side drop, let the client read its last reply
    static constexpr uint32_t kStopBudgetMs = 1000; // Stop() warns and cancels I/O past this
    static_assert(kLingerMs < kStopBudgetMs, "the linger window must fit inside the stop budget");

    ~PipeServer();

    bool Start(const std::wstring& aPipeName, uint32_t aIdleDisconnectSeconds, Handler aHandler,
               std::string& aError);
    void Stop();

    // Closes the current client connection (kill switch) without stopping the server.
    // Safe from any thread, including while Stop() runs.
    void DropClient();

    // Called on the server thread when a client is dropped for sending nothing for
    // aIdleDisconnectSeconds (not when a client closes its end). Set before Start.
    void SetIdleCallback(std::function<void()> aOnIdle);

    bool IsRunning() const;
    bool HasClient() const;
    uint64_t ConnectionsAccepted() const;

private:
    enum class EndReason
    {
        ClientClosed,
        Stopped,
        Dropped,
        Idle,
        ReadFailed,
        WriteFailed,
        TooLarge,
        TooManyRejected
    };

    void Run();
    EndReason ServeClient(uint32_t aClientPid);
    void Linger();
    bool WriteAll(const std::string& aData);

    std::wstring m_pipeName;
    uint32_t m_idleDisconnectSeconds = 120;
    Handler m_handler;
    std::function<void()> m_onIdle;
    std::thread m_thread;
    void* m_pipe = nullptr;      // HANDLE
    void* m_stopEvent = nullptr; // HANDLE, manual reset
    void* m_dropEvent = nullptr; // HANDLE, auto reset; guarded by m_handleMutex outside the server thread
    std::mutex m_handleMutex;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_hasClient{false};
    std::atomic<uint64_t> m_connections{0};
};
} // namespace xfb
