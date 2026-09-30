#pragma once

// The self-test host's simulated world for bridge 0.7's methods (cyberware, world state and probes, the weather, ui.state,
// game.saves, photo.scene.set, the overlay host): the same names, access classes and parameter checks (core/Hooks070) as
// the plugin, with simulated equipment, weather, saves and photo-mode rows instead of the game. Proves nothing about the
// game.

#include <functional>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Config.hpp"
#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"

namespace xfb::selftest
{
struct Sim070Hooks
{
    std::function<std::string()> phase;
    std::function<void()> markWrite;
    std::function<void()> takeSaveLock;
    // {id, text, choices} of the pending ask, or null (the message board).
    std::function<nlohmann::json()> pendingAsk;
    std::function<bool()> killed;
};

void RegisterSim070(Dispatcher& aDispatcher, GameThreadQueue& aQueue, const Config& aConfig, Sim070Hooks aHooks);
// The kill switch's restore of 0.7's state (the weather), as XFWeather.RestoreAfterKill does it; adds to aOut.
void Sim070RestoreAfterKill(nlohmann::json& aOut);
} // namespace xfb::selftest
