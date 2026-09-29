#pragma once

#include "core/Dispatcher.hpp"

#include <chrono>
#include <functional>
#include <initializer_list>
#include <string>

namespace xfb::plugin
{
// Bridge 0.6 (Handlers060.cpp): scene.read, the session event stream's handover, behaviours, player control phase 1 and
// input.probe. Called by RegisterMethods.
void RegisterMethods060(Dispatcher& aDispatcher);
// Game thread, every Running tick: runs the behaviours (core/Behaviours.hpp) through the redscript layer.
void TickBehaviours(double aDt, bool aScriptsReady);
// Game thread, from RestoreAfterKill (RB-90): writes back the first values photo.camera.preset saw for every camera preset
// flat it rewrote this game run (TweakDB changes outlive loads until the game restarts), then forgets them.
void RestorePresetsAfterKill();

// Shared with Handlers060.cpp: a redscript layer call (XFRuntimeBridge.<class>.<function>(cid, ...) -> JSON), the game-thread
// step timeout, and a write method marked for the kill switch's restore.
nlohmann::json ScriptCall(const std::string& aClass, const char* aFunction, std::initializer_list<const char*> aTypes,
                          std::initializer_list<void*> aValues, const std::string& aCid);
std::chrono::milliseconds GameTimeout();
MethodSpec MarkedWrite(std::string aName, Access aAccess, RunOn aRunOn, std::string aSummary, std::function<nlohmann::json(const MethodContext&)> aFn);

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
