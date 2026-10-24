#pragma once

// Bridge 0.8: the micro-action runner. A watcher that fires hands its actions (a short list of bridge commands) to this
// runner, which sends them one by one, in order, through the bridge's own dispatcher on a worker thread of its own: every
// gate a client's request meets (the kill switch, allow_writes, the write classes, the panel's pause, a handover, the
// rate limit, the script gate) applies to them too, and the game thread is never blocked waiting for one. Each action's
// answer (with its undo) becomes a "micro" event in the session's stream. A delay_s before an action waits on a condition
// variable, so Cancel (the kill switch, a load, watch.disarm all) interrupts it at once.
//
// Shared by the plugin and the self-test host; the thread starts with the first batch and Stop joins it (the plugin's
// unload, before the dispatcher goes).

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include "core/Dm080.hpp"

namespace xfb::dm
{
class MicroRunner
{
public:
    // Sends one command through the dispatcher and answers its response object ({ok, result} or {ok: false, error}).
    using Execute = std::function<json(const std::string& aMethod, const json& aParams, const std::string& aCid, const std::string& aToken)>;
    using Report = std::function<void(const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData)>;

    MicroRunner(Execute aExecute, Report aReport);
    ~MicroRunner();
    MicroRunner(const MicroRunner&) = delete;
    MicroRunner& operator=(const MicroRunner&) = delete;

    // Queues a batch (at most 16 waiting; the oldest is dropped with an event past that).
    void Enqueue(MicroBatch aBatch);
    // Drops every queued batch and ends the running one before its next action (a delay is cut short). Answers how many
    // actions were dropped.
    size_t Cancel(const std::string& aWhy);
    size_t CancelWatch(const std::string& aWatch);
    // Cancels and joins the worker; later batches are refused.
    void Stop();
    size_t Pending() const;
    uint64_t Ran() const;

private:
    void Run();

    Execute m_execute;
    Report m_report;
    mutable std::mutex m_mutex;
    std::condition_variable m_cv;
    std::deque<MicroBatch> m_queue;
    std::thread m_thread;
    bool m_started = false;
    bool m_stopping = false;
    uint64_t m_generation = 0;
    std::string m_runningWatch;
    size_t m_remaining = 0;
    bool m_runningCancelled = false;
    std::atomic<uint64_t> m_ran{0};
};
} // namespace xfb::dm
