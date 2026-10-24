#pragma once

// Hands work from the bridge thread to the game's main thread and waits for the answer.
//
// Game objects and scripts may only be touched on the main thread. The plugin drains this
// queue from its Running-state OnUpdate callback (once per engine tick); the self-test drains
// it from a simulated loop.
//
// Every task has one atomic state: Queued -> Running -> Done, or Queued -> Cancelled. The game
// thread moves it to Running and the waiter moves it to Cancelled, each with a compare-and-swap,
// so exactly one of them wins:
//  - a task still queued when its waiter times out is Cancelled and never runs (Timeout);
//  - a task already running when the timeout expires is waited for a bounded grace period; if
//    it still has not finished, the waiter reports TimeoutAfterStart, and the game thread logs
//    the late completion (game.task_completed_late) when it does finish.

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

namespace xfb
{
enum class QueueResult
{
    Done,
    Timeout,           // not started in time; cancelled, never runs
    TimeoutAfterStart, // started, but not finished within timeout + grace; it may still finish
    QueueFull,         // too many requests already waiting
    NotPumping,        // the game thread is not draining (not Running, or the queue is closed)
    Failed,            // the task threw
    Deferred           // 0.8.2: closed before it could start, so its cleanup went on the cleanup lane (Run's aOnClosed)
};

class GameThreadQueue
{
public:
    using Task = std::function<nlohmann::json()>;

    static constexpr std::chrono::milliseconds kDefaultRunningGrace{1000};

    explicit GameThreadQueue(size_t aCapacity = 16);

    // Bridge thread: queue a task and wait up to aTimeout for its result. If the task has
    // already started when aTimeout expires, wait up to aRunningGrace more before giving up.
    // aLabel names the task in the late-completion log line.
    // 0.8.2 (the review): aOnClosed, when given, is posted to the cleanup lane whenever the closed queue keeps the task from
    // starting (refused at the door, or cancelled by Close() while queued), decided under the queue's lock, so a kill can
    // never slip between a check and the enqueue: such a task either runs, has started, or its cleanup is posted (Deferred).
    QueueResult Run(Task aTask, std::chrono::milliseconds aTimeout, nlohmann::json& aResult, std::string& aError,
                    const std::string& aLabel = "-", std::chrono::milliseconds aRunningGrace = kDefaultRunningGrace, Task aOnClosed = {}, bool aReadOnly = false);

    // Game thread: run at most aMaxTasks queued tasks. Returns how many ran.
    size_t Drain(size_t aMaxTasks);
    size_t Pending() const;

    // The game thread says whether it is currently draining (set by state callbacks).
    void SetPumping(bool aPumping);
    bool IsPumping() const;
    uint64_t TicksSeen() const;

    // Tasks that finished after their waiter had already reported TimeoutAfterStart.
    uint64_t LateCompletions() const;

    // Refuses new tasks, cancels every queued task (its waiter gets NotPumping) and releases
    // the waiter of a running task at once (TimeoutAfterStart). Safe from any thread; used on
    // kill, bridge stop and plugin unload so that nothing waits on the game thread afterwards.
    void Close();
    // True once Close() has returned (or is running): no task can start after that, except one
    // the game thread had already taken, which finishes inside that same Drain call.
    bool IsClosed() const;
    // Re-arming the bridge after the kill switch: accepts tasks again. Only from the game thread,
    // between Drain calls, once the old bridge's threads have stopped (nothing waits on the queue).
    // Close() left nothing queued; Reopen() clears anything that remains, releasing its waiter, and sets
    // pumping to aPumping (Close() cleared it; the game thread is still running).
    void Reopen(bool aPumping);

    // 0.8.2 (the re-check's sixth finding): the cleanup lane. A step that puts something back (inside a RestoreScope) and
    // finds the queue closed by the kill switch is posted here instead of being refused, so a write cut short by the kill
    // still undoes its half-done change (a pose category changed during photo.pose.set's settle). Accepted while the queue
    // is closed, never waited for (the bridge thread goes on), at most kCleanupCapacity at a time; the game thread runs
    // them with DrainCleanup, before the kill switch's restore, whenever the game's scripts can be called.
    static constexpr size_t kCleanupCapacity = 32;
    bool PostCleanup(Task aTask, const std::string& aLabel);
    // As PostCleanup, with m_mutex already held.
    bool PostCleanupLocked(Task aTask, const std::string& aLabel);
    size_t DrainCleanup(size_t aMaxTasks);
    size_t PendingCleanups() const;

private:
    enum State : int
    {
        Queued = 0,
        Running,
        Done,
        Cancelled
    };

    struct Item
    {
        Task task;
        bool readOnly = false;
        std::string label;
        std::atomic<int> state{Queued};
        std::mutex mutex;
        std::condition_variable done;
        bool closed = false;    // Close() released the waiter
        bool abandoned = false; // the waiter gave up while the task was running
        bool failed = false;
        std::string error;
        nlohmann::json result;
    };

    size_t m_capacity;
    mutable std::mutex m_mutex;
    std::deque<std::shared_ptr<Item>> m_items;
    std::shared_ptr<Item> m_current; // the task the game thread is running, if any
    std::deque<std::pair<Task, std::string>> m_cleanup; // 0.8.2, under m_mutex
    std::atomic<bool> m_pumping{false};
    std::atomic<bool> m_closed{false};
    std::atomic<uint64_t> m_ticks{0};
    std::atomic<uint64_t> m_late{0};
};
} // namespace xfb
