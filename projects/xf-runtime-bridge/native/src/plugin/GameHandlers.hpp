#pragma once

#include "core/Dispatcher.hpp"

namespace xfb::plugin
{
// Registers the plugin's bridge methods (bridge.info, game.*, player.position, photomode.state,
// script.describe, layers.status, diag.write_probe) on the dispatcher.
void RegisterMethods(Dispatcher& aDispatcher);

// Game thread, after the kill switch: undoes what the bridge's writes left switched on (world
// freeze, hidden photo-mode UI; the save lock is kept). Runs at most once; does nothing without writes.
// Called through State::restore (writes::RestoreOnce), which makes it run at most once and only
// once the queue is closed. Throws on failure; RestoreOnce logs it.
void RestoreAfterKill();

// Game thread, after the pipe dropped a client for idleness: gives the mouse cursor back if a bridge
// write hid it (RB-34). Throws on failure; the caller logs it.
void ReleaseCursorAfterIdle();

// Game thread, each Running tick: takes the bridge's save lock back when a game.save with override_lock
// couldn't retake it through the queue (State::relockOwed; RB-52). Throws on a failed script call.
void RetakeOwedSaveLock();
} // namespace xfb::plugin
