#pragma once

#include "core/Dispatcher.hpp"

namespace xfb::plugin
{
// Registers the plugin's bridge methods (bridge.info, game.*, player.position, photomode.state,
// script.describe, layers.status, diag.write_probe) on the dispatcher.
void RegisterMethods(Dispatcher& aDispatcher);
} // namespace xfb::plugin
