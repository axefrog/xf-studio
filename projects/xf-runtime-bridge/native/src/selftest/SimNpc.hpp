#pragma once

// The self-test host's simulated street for bridge 0.8's NPC direction (core/Npc.hpp): the same npc.* methods, access
// classes, parameter checks, bookkeeping, undos and events as the plugin (the shared npc::Service), with simulated NPCs,
// actors, AI commands, lines, gestures and a dialogue hub instead of the game. selftest.npc steers it (a vanilla hub up, a
// command that fails, an actor that dies or streams out, the player's pick). Proves nothing about the game.

#include <functional>
#include <memory>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Dispatcher.hpp"
#include "core/Events.hpp"

namespace xfb::selftest
{
struct SimNpcHooks
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
    EventLog* events = nullptr;
};

class SimNpc
{
public:
    SimNpc(Dispatcher& aDispatcher, SimNpcHooks aHooks);
    ~SimNpc();
    // The simulated world at tick rate (actors appear, walk, turn, follow), then the shared service's tick.
    void Tick(double aDt);
    // A load: every simulated actor goes with the world (Codeware drops non-persistent entities at detach).
    void OnDetach();
    // The kill switch's restore (the plugin's RestoreNpcAfterKill); adds to aOut.
    void RestoreAfterKill(nlohmann::json& aOut);
    // What a save would keep (XFGame.BridgeHolds' NPC line).
    nlohmann::json Holds();

    struct State; // public for the file's own helpers

private:
    std::unique_ptr<State> m_state;
};
} // namespace xfb::selftest
