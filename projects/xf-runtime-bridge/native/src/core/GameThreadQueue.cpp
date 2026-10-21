#include "core/GameThreadQueue.hpp"

#include "core/Log.hpp"

namespace xfb
{
GameThreadQueue::GameThreadQueue(size_t aCapacity)
    : m_capacity(aCapacity)
{
}

QueueResult GameThreadQueue::Run(Task aTask, std::chrono::milliseconds aTimeout, nlohmann::json& aResult,
                                 std::string& aError, const std::string& aLabel,
                                 std::chrono::milliseconds aRunningGrace, Task aOnClosed)
{
    const auto defer = [&]() -> QueueResult {
        // Under m_mutex: the closure is settled here, before or after any Close().
        if (!PostCleanupLocked(std::move(aOnClosed), aLabel))
        {
            aError = "closed, and the cleanup lane is full";
            return QueueResult::NotPumping;
        }
        return QueueResult::Deferred;
    };
    if (aOnClosed && m_closed.load())
    {
        std::scoped_lock _(m_mutex);
        return defer();
    }
    if (m_closed.load() || !m_pumping.load())
    {
        return QueueResult::NotPumping;
    }

    auto item = std::make_shared<Item>();
    item->task = std::move(aTask);
    item->label = aLabel;
    {
        std::scoped_lock _(m_mutex);
        // Checked again under the lock: Close() sets m_closed before it takes the lock, so a
        // task is either refused here or swapped out (and released) by Close().
        if (m_closed.load())
        {
            return aOnClosed ? defer() : QueueResult::NotPumping;
        }
        if (m_items.size() >= m_capacity)
        {
            return QueueResult::QueueFull;
        }
        m_items.push_back(item);
    }

    const auto settled = [&] { return item->state.load() == Done || item->closed; };
    std::unique_lock lock(item->mutex);
    if (!item->done.wait_for(lock, aTimeout, settled))
    {
        // Not finished in time. If the game thread has not taken it yet, it never will.
        int expected = Queued;
        if (item->state.compare_exchange_strong(expected, Cancelled))
        {
            return QueueResult::Timeout;
        }
        // Already running on the game thread: wait a bounded grace period for it to finish.
        if (!item->done.wait_for(lock, aRunningGrace, settled))
        {
            item->abandoned = true;
            aError = "running beyond the timeout";
            return QueueResult::TimeoutAfterStart;
        }
    }

    if (item->state.load() != Done)
    {
        // Close() released us. A task it cancelled never runs; a running one may still finish.
        int expected = Queued;
        if (item->state.compare_exchange_strong(expected, Cancelled) || expected == Cancelled)
        {
            aError = "closed";
            if (aOnClosed)
            {
                // Close() cancelled it before the game thread took it: it never runs, so its cleanup goes on the lane.
                std::scoped_lock _(m_mutex);
                return defer();
            }
            return QueueResult::NotPumping;
        }
        item->abandoned = true;
        aError = "the bridge stopped while the task was running";
        return QueueResult::TimeoutAfterStart;
    }
    if (item->failed)
    {
        aError = item->error;
        return QueueResult::Failed;
    }
    aResult = std::move(item->result);
    return QueueResult::Done;
}

size_t GameThreadQueue::Drain(size_t aMaxTasks)
{
    m_ticks.fetch_add(1);
    size_t ran = 0;
    while (ran < aMaxTasks)
    {
        std::shared_ptr<Item> item;
        {
            // Taken, started and published as current under one lock, so Close() either finds
            // the task still queued (and cancels it) or sees it as the running task.
            std::scoped_lock _(m_mutex);
            if (m_closed.load() || m_items.empty())
            {
                break;
            }
            item = m_items.front();
            m_items.pop_front();
            int expected = Queued;
            if (!item->state.compare_exchange_strong(expected, Running))
            {
                continue; // the waiter gave up (or Close cancelled it) before we started: never run it
            }
            m_current = item;
        }

        const auto started = std::chrono::steady_clock::now();
        nlohmann::json result;
        std::string error;
        bool failed = false;
        try
        {
            result = item->task();
        }
        catch (const std::exception& e)
        {
            failed = true;
            error = e.what();
        }
        catch (...)
        {
            failed = true;
            error = "unknown exception";
        }
        ++ran;

        {
            std::scoped_lock _(m_mutex);
            m_current.reset();
        }
        bool late = false;
        {
            std::scoped_lock _(item->mutex);
            item->result = std::move(result);
            item->failed = failed;
            item->error = std::move(error);
            item->state.store(Done);
            late = item->abandoned;
        }
        item->done.notify_all();

        if (late)
        {
            m_late.fetch_add(1);
            const auto ms =
                std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started)
                    .count();
            log::Warn("game.task_completed_late", "task=" + item->label + " ran_ms=" + std::to_string(ms) +
                                                      " failed=" + (failed ? "true" : "false") +
                                                      " note=the client was already told timeout_after_start");
        }
    }
    return ran;
}

void GameThreadQueue::SetPumping(bool aPumping)
{
    m_pumping.store(aPumping);
}

bool GameThreadQueue::IsPumping() const
{
    return m_pumping.load();
}

uint64_t GameThreadQueue::TicksSeen() const
{
    return m_ticks.load();
}

bool GameThreadQueue::IsClosed() const
{
    return m_closed.load();
}

uint64_t GameThreadQueue::LateCompletions() const
{
    return m_late.load();
}

void GameThreadQueue::Close()
{
    m_closed.store(true);
    m_pumping.store(false);
    std::deque<std::shared_ptr<Item>> pending;
    std::shared_ptr<Item> current;
    {
        std::scoped_lock _(m_mutex);
        pending.swap(m_items);
        current = m_current;
    }
    for (auto& item : pending)
    {
        int expected = Queued;
        item->state.compare_exchange_strong(expected, Cancelled);
        {
            std::scoped_lock _(item->mutex);
            item->closed = true;
        }
        item->done.notify_all();
    }
    if (current)
    {
        {
            std::scoped_lock _(current->mutex);
            current->closed = true;
        }
        current->done.notify_all();
    }
}

bool GameThreadQueue::PostCleanup(Task aTask, const std::string& aLabel)
{
    std::scoped_lock _(m_mutex);
    return PostCleanupLocked(std::move(aTask), aLabel);
}

bool GameThreadQueue::PostCleanupLocked(Task aTask, const std::string& aLabel)
{
    if (m_cleanup.size() >= kCleanupCapacity)
    {
        log::Warn("game.cleanup_dropped", "task=" + aLabel + " reason=full");
        return false;
    }
    m_cleanup.emplace_back(std::move(aTask), aLabel);
    log::Info("game.cleanup_posted", "task=" + aLabel + " pending=" + std::to_string(m_cleanup.size()));
    return true;
}

size_t GameThreadQueue::DrainCleanup(size_t aMaxTasks)
{
    size_t ran = 0;
    while (ran < aMaxTasks)
    {
        std::pair<Task, std::string> item;
        {
            std::scoped_lock _(m_mutex);
            if (m_cleanup.empty())
            {
                break;
            }
            item = std::move(m_cleanup.front());
            m_cleanup.pop_front();
        }
        ++ran;
        try
        {
            item.first();
            log::Info("game.cleanup_ran", "task=" + item.second);
        }
        catch (const std::exception& e)
        {
            log::Warn("game.cleanup_failed", "task=" + item.second + " what=" + e.what());
        }
        catch (...)
        {
            log::Warn("game.cleanup_failed", "task=" + item.second + " what=unknown");
        }
    }
    return ran;
}

size_t GameThreadQueue::PendingCleanups() const
{
    std::scoped_lock _(m_mutex);
    return m_cleanup.size();
}

void GameThreadQueue::Reopen(bool aPumping)
{
    Close(); // releases anything still queued (nothing should be)
    std::scoped_lock _(m_mutex);
    m_items.clear();
    m_closed.store(false);
    m_pumping.store(aPumping);
}
} // namespace xfb
