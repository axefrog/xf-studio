#pragma once

// Hands work from the bridge thread to the game's main thread and waits for the answer.
//
// Game objects and scripts may only be touched on the main thread. The plugin drains this
// queue from its Running-state OnUpdate callback (once per engine tick); the self-test drains
// it from a simulated loop. A request the game thread has not started before the timeout is
// cancelled and will never run, so a late write can never happen after the client gave up.

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>

#include <nlohmann/json.hpp>

namespace xfb
{
enum class QueueResult
{
    Done,
    Timeout,       // not started in time; cancelled, never runs
    QueueFull,     // too many requests already waiting
    NotPumping,    // the game thread is not draining (not in the Running state)
    Failed         // the task threw
};

class GameThreadQueue
{
public:
    using Task = std::function<nlohmann::json()>;

    explicit GameThreadQueue(size_t aCapacity = 16);

    // Bridge thread: queue a task and wait up to aTimeout for its result.
    QueueResult Run(Task aTask, std::chrono::milliseconds aTimeout, nlohmann::json& aResult, std::string& aError);

    // Game thread: run at most aMaxTasks queued tasks. Returns how many ran.
    size_t Drain(size_t aMaxTasks);

    // The game thread says whether it is currently draining (set by state callbacks).
    void SetPumping(bool aPumping);
    bool IsPumping() const;
    uint64_t TicksSeen() const;

    // Unblocks every waiter with NotPumping and refuses new tasks (plugin unload).
    void Close();

private:
    struct Item
    {
        Task task;
        std::mutex mutex;
        std::condition_variable done;
        bool finished = false;
        bool cancelled = false;
        bool failed = false;
        std::string error;
        nlohmann::json result;
    };

    size_t m_capacity;
    mutable std::mutex m_mutex;
    std::deque<std::shared_ptr<Item>> m_items;
    std::atomic<bool> m_pumping{false};
    std::atomic<bool> m_closed{false};
    std::atomic<uint64_t> m_ticks{0};
};
} // namespace xfb
