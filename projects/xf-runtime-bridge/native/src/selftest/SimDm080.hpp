#pragma once

// The self-test host's simulated world for bridge 0.8.12's live-direction toolkit (core/DmService.hpp): the same dm methods,
// access classes, parameter checks, bookkeeping, undos, events and tick as the plugin (the shared dm::Service), with simulated
// props, vehicles, doors, a street NPC, sounds, a phone with contacts, a HUD, and a quest tracker instead of the game.
// selftest.dm steers it (a contact list, the call's fact as the player's answer would set it, what V looks at, combat, the
// weapon, an interaction or dialogue event, the HUD up or down, Codeware present or not). Proves nothing about the game.

#include <functional>
#include <memory>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Dispatcher.hpp"
#include "core/Events.hpp"

namespace xfb::selftest
{
struct SimDmHooks
{
    std::function<std::string()> phase;
    // V: {position, yaw, busy} (Sim060's player).
    std::function<nlohmann::json()> player;
    std::function<void()> markWrite;
    std::function<void()> takeSaveLock;
    std::function<bool()> scriptsReady;
    std::function<uint64_t()> detaches;
    std::function<bool()> killed;
    std::function<bool()> paused;
    std::function<bool()> handedOver;
    // RB-122: the tick's forward steps check the write gate (Dispatcher::RequireWritesOpen) right before they run.
    std::function<bool()> writesOpen;
    // The session token the watchers' micro-actions send with, and the pid they claim.
    std::function<std::string()> token;
    EventLog* events = nullptr;
};

class SimDm
{
public:
    SimDm(Dispatcher& aDispatcher, SimDmHooks aHooks);
    ~SimDm();
    // The simulated world at tick rate (entities appear), then the shared service's tick.
    void Tick(double aDt);
    // A load: every simulated entity goes with the world.
    void OnDetach();
    // The kill switch's restore (the plugin's RestoreDmAfterKill); adds to aOut.
    void RestoreAfterKill(nlohmann::json& aOut);
    // What a save would keep (the plugin's DmHolds).
    nlohmann::json Holds();
    // bridge.handover's release (the plugin's ReleaseDmForHandover), on the game thread.
    nlohmann::json ReleaseForHandover();
    // The watchers' micro-action worker ends (the plugin's StopDm); called before the dispatcher goes.
    void Stop();

    struct State; // public for the file's own helpers

private:
    std::unique_ptr<State> m_state;
};
} // namespace xfb::selftest
