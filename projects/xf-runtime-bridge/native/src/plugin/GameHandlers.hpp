#pragma once

#include "core/Dispatcher.hpp"
#include "plugin/Supervisor.hpp"

#include <chrono>
#include <functional>
#include <initializer_list>
#include <string>

namespace xfb::plugin
{
// Bridge 0.6 (Handlers060.cpp): scene.read, the session event stream's handover, behaviours, player control phase 1 and
// input.probe. Called by RegisterMethods.
void RegisterRecording(Dispatcher&);
void TickRecording(bool ready);
void StopRecording(const std::string& reason);
void RegisterMethods060(Dispatcher& aDispatcher);
// Bridge 0.7 (Handlers070.cpp): cyberware, world state and probes, the weather, ui.state, game.saves, photo.scene.set and the
// overlay host's state.
void RegisterMethods070(Dispatcher& aDispatcher);
// The senses for the Story Engine (HandlersSenses.cpp): world.facts, world.district, player.status. Called by RegisterMethods.
void RegisterMethodsSenses(Dispatcher& aDispatcher);
// scene.read's npc_detail (HandlersSenses.cpp): gives each NPC row of aOut its character record's detail when aWanted.
void AddNpcDetail(nlohmann::json& aOut, bool aWanted, const std::string& aCid);
// Game thread, every Running tick: runs the behaviours (core/Behaviours.hpp) through the redscript layer.
void TickBehaviours(double aDt, bool aScriptsReady);
// Game thread, from RestoreAfterKill (RB-90): writes back the first values photo.camera.preset saw for every camera preset
// flat it rewrote this game run (TweakDB changes outlive loads until the game restarts), then forgets them.
void RestorePresetsAfterKill();
// Bridge 0.8 (HandlersNpc.cpp): the npc.* methods, their game-thread tick (timers, a poll four times a second while anything
// is held, the automatic release) and the kill switch's release of every NPC the bridge holds.
void RegisterMethodsNpc(Dispatcher& aDispatcher);
void TickNpc(double aDt, bool aScriptsReady);
void RestoreNpcAfterKill();
// Bridge 0.8 (HandlersNpc.cpp): bridge.handover's release of every NPC the bridge directs, one game-thread step after the
// handover flag is set (npc.auto_released with reason handover): {released, hub_withdrawn, voice_lines_hidden}.
nlohmann::json ReleaseNpcsForHandover(const std::string& aCid);

// Bridge 0.8.12 (HandlersDm080.cpp): the live-direction toolkit's dm.* methods, its game-thread tick (watchers, the phone call,
// timed lines, light patterns, the release on a pause or a handover), the kill switch's release of everything it holds, its
// holds for game.save, and the watchers' micro-action worker, stopped before the dispatcher goes.
void RegisterMethodsDm(Dispatcher& aDispatcher);
void TickDm(double aDt, bool aScriptsReady);
void RestoreDmAfterKill();
// bridge.handover's release of everything the toolkit holds, one game-thread step after the handover flag is set.
nlohmann::json ReleaseDmForHandover(const std::string& aCid);
// What a save would keep from the toolkit, as plain names (an array of strings; empty when nothing).
nlohmann::json DmHolds();
void StopDm();

// Shared with Handlers060.cpp: a redscript layer call (XFRuntimeBridge.<class>.<function>(cid, ...) -> JSON), the game-thread
// step timeout, and a write method marked for the kill switch's restore.
nlohmann::json ScriptCall(const std::string& aClass, const char* aFunction, std::initializer_list<const char*> aTypes,
                          std::initializer_list<void*> aValues, const std::string& aCid);
std::chrono::milliseconds GameTimeout();
MethodSpec MarkedWrite(std::string aName, Access aAccess, RunOn aRunOn, std::string aSummary, std::function<nlohmann::json(const MethodContext&)> aFn);
// 0.8.2: bridge.handover's clearing of the showroom's light rigs, after the write gate has closed; the caller holds a
// RestoreScope (removing what the bridge spawned puts the scene back).
nlohmann::json ClearShowroomForHandover(const std::string& aWhat, const std::string& aCid);

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

// 0.8.7: the XF Runtime Bridge window's Save anyway (XFBridge_SaveAnyway): one manual save past the bridge's save lock, refused
// only once the bridge is stopped. Blocks for the save's steps; never call it on the game thread.
nlohmann::json PlayerSaveAnyway(const std::string& aCid);
} // namespace xfb::plugin
