#pragma once

// The self-test host's simulated senses (world.facts, world.district, player.status): the same names, access classes and
// parameter checks (core/Senses) as the plugin, with a simulated world instead of the game. Proves nothing about the game.

#include <functional>
#include <string>

#include "core/Dispatcher.hpp"

namespace xfb::selftest
{
struct SimSensesHooks
{
    std::function<std::string()> phase; // the simulated game phase (selftest.phase)
};

// Also registers selftest.senses, a test control: {district: "place"|"district"|"none", vehicle: bool, scanning: bool}.
void RegisterSimSenses(Dispatcher& aDispatcher, SimSensesHooks aHooks);
} // namespace xfb::selftest
