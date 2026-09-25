#include "core/GameThreadQueue.hpp"

namespace xfb
{
GameThreadQueue::GameThreadQueue(size_t aCapacity)
    : m_capacity(aCapacity)
{
}

QueueResult GameThreadQueue::Run(Task aTask, std::chrono::milliseconds aTimeout, nlohmann::json& aResult,
                                 std::string& aError)
{
    if (m_closed.load() || !m_pumping.load())
    {
        return QueueResult::NotPumping;
    }

    auto item = std::make_shared<Item>();
    item->task = std::move(aTask);
    {
        std::scoped_lock _(m_mutex);
        if (m_items.size() >= m_capacity)
        {
            return QueueResult::QueueFull;
        }
        m_items.push_back(item);
    }

    std::unique_lock lock(item->mutex);
    if (!item->done.wait_for(lock, aTimeout, [&] { return item->finished; }))
    {
        // Not finished in time. If the game thread has not taken it yet, it never will.
        item->cancelled = true;
        return QueueResult::Timeout;
    }
    if (item->failed)
    {
        aError = item->error;
        return m_closed.load() && item->error == "closed" ? QueueResult::NotPumping : QueueResult::Failed;
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
            std::scoped_lock _(m_mutex);
            if (m_items.empty())
            {
                break;
            }
            item = m_items.front();
            m_items.pop_front();
        }
        {
            std::scoped_lock _(item->mutex);
            if (item->cancelled)
            {
                continue; // the waiter gave up before we started: do not run it
            }
        }

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
            std::scoped_lock _(item->mutex);
            item->result = std::move(result);
            item->failed = failed;
            item->error = std::move(error);
            item->finished = true;
        }
        item->done.notify_all();
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

void GameThreadQueue::Close()
{
    m_closed.store(true);
    m_pumping.store(false);
    std::deque<std::shared_ptr<Item>> pending;
    {
        std::scoped_lock _(m_mutex);
        pending.swap(m_items);
    }
    for (auto& item : pending)
    {
        {
            std::scoped_lock _(item->mutex);
            item->failed = true;
            item->error = "closed";
            item->finished = true;
        }
        item->done.notify_all();
    }
}
} // namespace xfb
