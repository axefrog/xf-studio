#include "core/ScriptLayer.hpp"

#include "core/Dispatcher.hpp"
#include "core/Log.hpp"

namespace xfb
{
namespace
{
int64_t MsBetween(ScriptLayer::Clock::time_point aFrom, ScriptLayer::Clock::time_point aTo)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(aTo - aFrom).count();
}
} // namespace

bool ScriptLayer::OnEvent(const std::string& aEvent, Clock::time_point aNow)
{
    if (aEvent == "attach")
    {
        OnAttach(aNow);
    }
    else if (aEvent == "player_attach")
    {
        OnPlayerAttach(aNow);
    }
    else if (aEvent == "detach")
    {
        OnDetach(aNow);
    }
    else
    {
        return false;
    }
    return true;
}

void ScriptLayer::OnAttach(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    m_state = State::Attached;
    m_since = aNow;
    ++m_attaches;
    log::Info("script_layer.attached", "calls=waiting_for_player attaches=" + std::to_string(m_attaches));
}

void ScriptLayer::OnPlayerAttach(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    if (m_state == State::Detached || m_state == State::NotAttached)
    {
        // A player attach without our system's attach (a stale Scripts folder, or events out of order): stay closed.
        log::Warn("script_layer.player_without_attach", std::string("state=") + StateName(m_state));
        return;
    }
    if (m_state != State::Ready)
    {
        m_state = State::Ready;
        m_since = aNow;
    }
    log::Info("script_layer.ready", std::string("calls=on load_pending=") + (m_loadPending ? "true" : "false"));
}

void ScriptLayer::OnDetach(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    m_state = State::Detached;
    m_since = aNow;
    m_loadPending = false; // the load the bridge asked for has started
    ++m_detaches;
    log::Info("script_layer.detached", "calls=off detaches=" + std::to_string(m_detaches));
}

void ScriptLayer::OnLoadRequested(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    m_loadPending = true;
    m_loadRequestedAt = aNow;
    log::Info("script_layer.load_requested", "calls=off until the loaded session is ready");
}

void ScriptLayer::ExpireLoad(Clock::time_point aNow)
{
    if (m_loadPending && aNow - m_loadRequestedAt >= kLoadStartTimeout)
    {
        m_loadPending = false;
        log::Warn("script_layer.load_not_started",
                  "no detach within " + std::to_string(kLoadStartTimeout.count()) + " s of game.load; calls=on again");
    }
}

bool ScriptLayer::Ready(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    ExpireLoad(aNow);
    return m_state == State::Ready && !m_loadPending;
}

void ScriptLayer::Require(const std::string& aWhat, Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    ExpireLoad(aNow);
    if (m_state == State::Ready && !m_loadPending)
    {
        return;
    }
    const std::string why = m_loadPending            ? "a save is loading (game.load)"
                            : m_state == State::NotAttached ? "the game is still starting (the bridge's script layer hasn't attached)"
                            : m_state == State::Detached    ? "the game is between sessions (loading a save or returning to the main menu)"
                                                            : "the game is loading (the player hasn't attached yet)";
    log::Info("script_layer.call_refused", "what=" + aWhat + " state=" + StateName(m_state) +
                                               " load_pending=" + (m_loadPending ? "true" : "false"));
    throw MethodError("game_loading", why + "; nothing was called or changed. Wait for game.wait with phase gameplay, then try again");
}

ScriptLayer::State ScriptLayer::Current() const
{
    std::scoped_lock _(m_mutex);
    return m_state;
}

const char* ScriptLayer::StateName(State aState)
{
    switch (aState)
    {
    case State::NotAttached:
        return "not_attached";
    case State::Attached:
        return "attached";
    case State::Ready:
        return "ready";
    case State::Detached:
        return "detached";
    }
    return "unknown";
}

std::string ScriptLayer::Phase(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    ExpireLoad(aNow);
    return m_state == State::NotAttached ? "starting" : "loading";
}

nlohmann::json ScriptLayer::Describe(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    ExpireLoad(aNow);
    return nlohmann::json{{"state", StateName(m_state)},
                          {"ready", m_state == State::Ready && !m_loadPending},
                          {"load_pending", m_loadPending},
                          {"attaches", m_attaches},
                          {"detaches", m_detaches},
                          {"since_ms", MsBetween(m_since, aNow)}};
}

uint64_t ScriptLayer::TakeDetaches()
{
    std::scoped_lock _(m_mutex);
    const auto fresh = m_detaches - m_detachesTaken;
    m_detachesTaken = m_detaches;
    return fresh;
}
} // namespace xfb
