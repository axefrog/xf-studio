#pragma once

// The one way the plugin calls a game or script function: as if script code had called it.
// See ScriptCall.cpp for why (the first in-game crash) and how (Cyber Engine Tweaks' recipe).

#include <string>
#include <vector>

#include <RED4ext/RED4ext.hpp>

namespace xfb::plugin
{
// Calls aFn with aContext as its instance, or, when aContext is null (a static or global
// function), with the bridge's static context. aValues holds one pointer per parameter, each
// pointing at a value of that parameter's type: the caller has checked the function's signature
// first. aOut receives the return value and must be given when the function returns one.
// Game thread only. Throws MethodError: "failed" off the game thread or for a malformed call,
// "game_not_ready" when no static context can be made, "call_failed" when the game refuses it.
void CallFunction(RED4ext::CBaseFunction* aFn, RED4ext::IScriptable* aContext, const std::vector<void*>& aValues,
                  void* aOut, const std::string& aWhat, const std::string& aCid);

// Game thread, once per tick: remembers which thread may call (CallFunction refuses any other).
void NoteGameThread();
} // namespace xfb::plugin
