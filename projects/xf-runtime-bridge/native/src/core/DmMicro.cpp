#include "core/DmMicro.hpp"

#include <chrono>

namespace xfb::dm
{
MicroRunner::MicroRunner(Execute aExecute, Report aReport)
    : m_execute(std::move(aExecute))
    , m_report(std::move(aReport))
{
}

MicroRunner::~MicroRunner()
{
    Stop();
}

void MicroRunner::Enqueue(MicroBatch aBatch)
{
    std::unique_lock lock(m_mutex);
    if (m_stopping)
    {
        return;
    }
    if (m_queue.size() >= 16)
    {
        const auto dropped = m_queue.front();
        m_queue.pop_front();
        lock.unlock();
        if (m_report)
        {
            m_report("micro", "warn", "watcher " + dropped.watch + "'s actions were dropped: too many batches waiting",
                     json{{"watch", dropped.watch}, {"dropped", dropped.actions.size()}});
        }
        lock.lock();
    }
    m_queue.push_back(std::move(aBatch));
    if (!m_started)
    {
        m_started = true;
        m_thread = std::thread([this] { Run(); });
    }
    m_cv.notify_all();
}

size_t MicroRunner::Cancel(const std::string& aWhy)
{
    size_t dropped = 0;
    {
        std::scoped_lock _(m_mutex);
        for (const auto& batch : m_queue)
        {
            dropped += batch.actions.size();
        }
        m_queue.clear();
        dropped += m_runningCancelled ? 0 : m_remaining;
        m_runningCancelled = true;
        ++m_generation;
    }
    m_cv.notify_all();
    if (dropped > 0 && m_report)
    {
        m_report("micro", "info", "queued micro-actions dropped (" + aWhy + ")", json{{"dropped", dropped}, {"why", aWhy}});
    }
    return dropped;
}

size_t MicroRunner::CancelWatch(const std::string& aWatch)
{
    size_t dropped = 0;
    {
        std::scoped_lock _(m_mutex);
        for (auto it = m_queue.begin(); it != m_queue.end();)
        {
            if (it->watch == aWatch)
            {
                dropped += it->actions.size();
                it = m_queue.erase(it);
            }
            else { ++it; }
        }
        if (m_runningWatch == aWatch && !m_runningCancelled)
        {
            dropped += m_remaining;
            m_runningCancelled = true;
        }
    }
    m_cv.notify_all();
    return dropped;
}

void MicroRunner::Stop()
{
    {
        std::scoped_lock _(m_mutex);
        m_stopping = true;
        m_queue.clear();
        ++m_generation;
    }
    m_cv.notify_all();
    if (m_thread.joinable())
    {
        m_thread.join();
    }
}

size_t MicroRunner::Pending() const
{
    std::scoped_lock _(m_mutex);
    size_t count = m_runningCancelled ? 0 : m_remaining;
    for (const auto& batch : m_queue)
    {
        count += batch.actions.size();
    }
    return count;
}

uint64_t MicroRunner::Ran() const
{
    return m_ran.load();
}

void MicroRunner::Run()
{
    for (;;)
    {
        MicroBatch batch;
        uint64_t generation = 0;
        {
            std::unique_lock lock(m_mutex);
            m_cv.wait(lock, [this] { return m_stopping || !m_queue.empty(); });
            if (m_stopping)
            {
                return;
            }
            batch = std::move(m_queue.front());
            m_queue.pop_front();
            generation = m_generation;
            m_runningWatch = batch.watch;
            m_remaining = batch.actions.size();
            m_runningCancelled = false;
        }
        for (size_t i = 0; i < batch.actions.size(); ++i)
        {
            const auto& action = batch.actions[i];
            if (action.delayS > 0.0)
            {
                std::unique_lock lock(m_mutex);
                const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(static_cast<int64_t>(action.delayS * 1000.0));
                m_cv.wait_until(lock, until, [&] { return m_stopping || m_generation != generation || m_runningCancelled; });
            }
            {
                std::scoped_lock _(m_mutex);
                if (m_stopping || m_generation != generation || m_runningCancelled)
                {
                    break;
                }
            }
            const auto cid = "m" + std::to_string(batch.seq) + "-" + std::to_string(i + 1);
            json data{{"watch", batch.watch}, {"index", i}, {"method", action.method}, {"cid", cid}};
            std::string level = "done";
            std::string text;
            try
            {
                const auto response = m_execute(action.method, action.params, cid, batch.sessionToken);
                const bool ok = response.value("ok", false);
                data["ok"] = ok;
                if (ok)
                {
                    const auto& result = response.contains("result") ? response["result"] : json(nullptr);
                    if (result.is_object() && result.contains("undo"))
                    {
                        data["undo"] = result["undo"];
                    }
                    text = "watcher " + batch.watch + " ran " + action.method;
                }
                else
                {
                    const auto error = response.value("error", json::object());
                    data["code"] = error.value("code", std::string("failed"));
                    data["message"] = error.value("message", std::string());
                    level = "warn";
                    text = "watcher " + batch.watch + "'s " + action.method + " was refused: " + data["code"].get<std::string>();
                }
            }
            catch (const std::exception& e)
            {
                data["ok"] = false;
                data["code"] = "failed";
                data["message"] = e.what();
                level = "warn";
                text = "watcher " + batch.watch + "'s " + action.method + " failed";
            }
            m_ran.fetch_add(1);
            {
                std::scoped_lock _(m_mutex);
                m_remaining = batch.actions.size() - i - 1;
            }
            if (m_report)
            {
                m_report("micro", level, text, data);
            }
        }
        {
            std::scoped_lock _(m_mutex);
            m_remaining = 0;
            m_runningWatch.clear();
        }
    }
}
} // namespace xfb::dm
