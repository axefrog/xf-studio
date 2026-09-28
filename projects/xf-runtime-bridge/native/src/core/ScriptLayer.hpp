#pragma once

// The script layer's readiness (bridge 0.5.2, RB-76): whether the plugin may call into the game's scripts now.
//
// Session 5 (29 September 2026) crashed the game on its main thread (null + 0x48 at Cyberpunk2077.exe+0x28b9b75)
// when game.wait's game.status ran XFBridgeActions.Status 0.1 s after XFBridgeSystem.OnDetach, while game.load's
// save was loading: the game instance the script reached was being torn down. So every script call waits for the
// script layer to be attached to a live session:
//
//   not_attached --attach--> attached --player_attach--> ready --detach--> detached --attach--> attached ...
//
// Scriptable systems attach when a session is created (at the main menu, and at every load, on a loading thread)
// and detach, on the main thread, before it is torn down; the player attaches last (the main menu has its own
// player puppet too) [runtime: plugin logs of 29 September 2026]. Only `ready` allows script calls. A load the
// bridge asked for (game.load) closes the gate at once, before the game detaches; if no detach follows within
// kLoadStartTimeout the load is taken as not started and the gate opens again (logged).
//
// The events come from our redscript layer (XFBridge_ScriptLayer, called from XFBridgeSystem's lifecycle
// functions) on whichever thread the game runs them; the gate is checked on the game thread right before each
// call, so a request queued before a detach and run after it is refused (the crash's exact sequence).

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

namespace xfb
{
class ScriptLayer
{
public:
    using Clock = std::chrono::steady_clock;
    static constexpr std::chrono::seconds kLoadStartTimeout{30};

    enum class State
    {
        NotAttached, // no scripted session yet (the game is starting)
        Attached,    // a session attached; its player hasn't yet
        Ready,       // attached, player attached: script calls allowed
        Detached,    // the session detached (a load or a return to the main menu is under way)
    };

    // "attach", "player_attach", "detach"; anything else is ignored (returns false). Any thread.
    bool OnEvent(const std::string& aEvent, Clock::time_point aNow = Clock::now());
    void OnAttach(Clock::time_point aNow = Clock::now());
    void OnPlayerAttach(Clock::time_point aNow = Clock::now());
    void OnDetach(Clock::time_point aNow = Clock::now());
    // game.load asked the game to load: the gate closes until the next session is ready.
    void OnLoadRequested(Clock::time_point aNow = Clock::now());

    // Whether a script call may run now (Ready, and no load requested that hasn't detached yet).
    bool Ready(Clock::time_point aNow = Clock::now());
    // Throws MethodError("game_loading") unless Ready; aWhat names the call for the message.
    void Require(const std::string& aWhat, Clock::time_point aNow = Clock::now());

    State Current() const;
    static const char* StateName(State aState);
    // The phase game.status answers while not ready: "starting" before the first attach, else "loading".
    std::string Phase(Clock::time_point aNow = Clock::now());
    // {state, ready, load_pending, attaches, detaches, since_ms}
    nlohmann::json Describe(Clock::time_point aNow = Clock::now());

    // Detaches seen since the last call (the plugin drops a save relock owed to the unloaded session).
    uint64_t TakeDetaches();

private:
    void ExpireLoad(Clock::time_point aNow);

    mutable std::mutex m_mutex;
    State m_state = State::NotAttached;
    bool m_loadPending = false;
    Clock::time_point m_loadRequestedAt{};
    Clock::time_point m_since = Clock::now();
    uint64_t m_attaches = 0;
    uint64_t m_detaches = 0;
    uint64_t m_detachesTaken = 0;
};
} // namespace xfb
