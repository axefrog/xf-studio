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
    Failed             // the task threw
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
    QueueResult Run(Task aTask, std::chrono::milliseconds aTimeout, nlohmann::json& aResult, std::string& aError,
                    const std::string& aLabel = "-", std::chrono::milliseconds aRunningGrace = kDefaultRunningGrace);

    // Game thread: run at most aMaxTasks queued tasks. Returns how many ran.
    size_t Drain(size_t aMaxTasks);

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
    std::atomic<bool> m_pumping{false};
    std::atomic<bool> m_closed{false};
    std::atomic<uint64_t> m_ticks{0};
    std::atomic<uint64_t> m_late{0};
};
} // namespace xfb
