// Bridge methods that need the game. Every game-thread method runs from the Running-state
// OnUpdate callback (see Main.cpp) and reaches the game only through RTTI lookups by name.
//
// Why RTTI by name: if a patch renames or removes a function, the lookup fails at runtime and
// the method returns a clear error; nothing crashes and no script compilation breaks.
// Names used here were checked against red-dump-json (a8e52990, a pre-2.3 dump; re-check on 2.31):
//   GetPlayer;GameInstance -> handle:PlayerPuppet        (globals.json)
//   entEntity.GetWorldPosition() -> Vector4               (classes/entEntity.json)
//   ScriptGameInstance.GetPhotoModeSystem(self) -> handle:gamePhotoModeSystem (classes/ScriptGameInstance.json)
//   gamePhotoModeSystem.IsPhotoModeActive/CanPhotoModeBeEnabled/IsExitLocked -> Bool
// The GetPlayer call pattern is RED4ext.SDK examples/native_globals_redscript/Main.cpp:19-23 (tag 1.0.0).

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>
#include <RED4ext/Scripting/Natives/Vector4.hpp>

#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

// ExecuteFunction and ScriptGameInstance read CGameEngine::Get()->framework->gameInstance
// (SDK Scripting/Utils-inl.hpp:52-59); refuse cleanly instead of dereferencing null early on.
void RequireGameInstance()
{
    auto* engine = RED4ext::CGameEngine::Get();
    if (!engine || !engine->framework || !engine->framework->gameInstance)
    {
        throw MethodError("game_not_ready", "the game instance does not exist yet");
    }
}

RED4ext::CBaseFunction* FindClassFunction(const char* aClass, const char* aFunction, const std::string& aCid)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* cls = rtti->GetClass(aClass);
    if (!cls)
    {
        log::Warn("rtti.missing_class", std::string("class=") + aClass, aCid);
        throw MethodError("rtti_missing", std::string("class not found: ") + aClass);
    }
    auto* fn = cls->GetFunction(aFunction);
    if (!fn)
    {
        log::Warn("rtti.missing_function", std::string("class=") + aClass + " function=" + aFunction, aCid);
        throw MethodError("rtti_missing", std::string("function not found: ") + aClass + "." + aFunction);
    }
    return fn;
}

bool CallBool(RED4ext::ScriptInstance aInstance, const char* aClass, const char* aFunction, const std::string& aCid)
{
    auto* fn = FindClassFunction(aClass, aFunction, aCid);
    bool value = false;
    RED4ext::StackArgs_t args;
    if (!RED4ext::ExecuteFunction(aInstance, fn, &value, args))
    {
        throw MethodError("call_failed", std::string("call failed: ") + aClass + "." + aFunction);
    }
    return value;
}

json PlayerPosition(const MethodContext& aContext)
{
    RequireGameInstance();
    RED4ext::ScriptGameInstance gameInstance;
    RED4ext::Handle<RED4ext::IScriptable> player;
    if (!RED4ext::ExecuteGlobalFunction("GetPlayer;GameInstance", &player, gameInstance))
    {
        throw MethodError("rtti_missing", "global GetPlayer;GameInstance not found or failed");
    }
    if (!player)
    {
        log::Debug("game.player_position", "available=false", aContext.cid);
        return json{{"available", false}, {"reason", "no player (main menu or loading)"}};
    }

    auto* fn = FindClassFunction("entEntity", "GetWorldPosition", aContext.cid);
    RED4ext::Vector4 position;
    RED4ext::StackArgs_t args;
    if (!RED4ext::ExecuteFunction(player.GetPtr(), fn, &position, args))
    {
        throw MethodError("call_failed", "entEntity.GetWorldPosition failed");
    }
    log::Debug("game.player_position",
               "x=" + std::to_string(position.X) + " y=" + std::to_string(position.Y) + " z=" +
                   std::to_string(position.Z),
               aContext.cid);
    return json{{"available", true}, {"x", position.X}, {"y", position.Y}, {"z", position.Z}, {"w", position.W}};
}

json PhotoModeState(const MethodContext& aContext)
{
    RequireGameInstance();
    auto* getter = FindClassFunction("ScriptGameInstance", "GetPhotoModeSystem", aContext.cid);
    RED4ext::ScriptGameInstance gameInstance;
    RED4ext::Handle<RED4ext::IScriptable> system;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &gameInstance);
    if (!RED4ext::ExecuteFunction(static_cast<RED4ext::ScriptInstance>(nullptr), getter, &system, args) || !system)
    {
        throw MethodError("unavailable", "PhotoModeSystem is not available");
    }
    const auto instance = system.GetPtr();
    const json state{{"active", CallBool(instance, "gamePhotoModeSystem", "IsPhotoModeActive", aContext.cid)},
                     {"can_enable", CallBool(instance, "gamePhotoModeSystem", "CanPhotoModeBeEnabled", aContext.cid)},
                     {"exit_locked", CallBool(instance, "gamePhotoModeSystem", "IsExitLocked", aContext.cid)}};
    log::Debug("game.photomode_state", state.dump(), aContext.cid);
    return state;
}

// Calls our own redscript layer: XFRuntimeBridge.XFBridgeQuery.DescribeJson(cid) -> String.
// Proves the native -> script direction the future write actions will use.
json ScriptDescribe(const MethodContext& aContext)
{
    RequireGameInstance();
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* cls = rtti->GetClass("XFRuntimeBridge.XFBridgeQuery");
    if (!cls)
    {
        throw MethodError("script_layer_missing",
                          "redscript class XFRuntimeBridge.XFBridgeQuery not found (scripts not compiled?)");
    }
    auto* fn = cls->GetFunction("DescribeJson");
    if (!fn)
    {
        throw MethodError("script_layer_missing", "XFBridgeQuery.DescribeJson not found");
    }
    RED4ext::CString cid(aContext.cid);
    RED4ext::CString out;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &cid);
    if (!RED4ext::ExecuteFunction(static_cast<RED4ext::ScriptInstance>(nullptr), fn, &out, args))
    {
        throw MethodError("call_failed", "XFBridgeQuery.DescribeJson failed");
    }
    const std::string text(out.c_str(), out.Length());
    try
    {
        return json::parse(text);
    }
    catch (const std::exception&)
    {
        return json{{"raw", text}};
    }
}
} // namespace

void RegisterMethods(Dispatcher& aDispatcher)
{
    auto& state = Get();

    aDispatcher.Register({"bridge.info", Access::Read, RunOn::BridgeThread,
                          "Plugin, SDK, game and bridge versions and status.",
                          [](const MethodContext&) { return InfoJson(); }});

    aDispatcher.Register({"game.version", Access::Read, RunOn::BridgeThread,
                          "Game product version (RED4ext) and executable file version.",
                          [&state](const MethodContext&) {
                              return json{{"product", state.gameProductVersion}, {"file", state.gameFileVersion}};
                          }});

    aDispatcher.Register({"game.state", Access::Read, RunOn::BridgeThread,
                          "Current RED4ext game state and Running-state tick count.",
                          [&state](const MethodContext&) {
                              return json{{"state", GameStateName(state.gameState.load())},
                                          {"running_ticks", state.runningTicks.load()}};
                          }});

    aDispatcher.Register({"layers.status", Access::Read, RunOn::BridgeThread,
                          "What the redscript and CET layers have announced to the plugin.",
                          [&state](const MethodContext&) { return state.layers.Snapshot(); }});

    aDispatcher.Register({"player.position", Access::Read, RunOn::GameThread,
                          "Player world position (GetPlayer + entEntity.GetWorldPosition).", &PlayerPosition});

    aDispatcher.Register({"photomode.state", Access::Read, RunOn::GameThread,
                          "Photo mode active / can enable / exit locked (gamePhotoModeSystem).", &PhotoModeState});

    aDispatcher.Register({"script.describe", Access::Read, RunOn::GameThread,
                          "Calls the redscript layer (XFBridgeQuery.DescribeJson) from native code.",
                          &ScriptDescribe});

    // A write-class probe with no game effect: proves the write gate and audit log in game.
    aDispatcher.Register({"diag.write_probe", Access::Write, RunOn::GameThread,
                          "No-op write used to test the allow_writes gate; changes nothing.",
                          [](const MethodContext& aContext) {
                              log::Info("diag.write_probe", "no-op write executed on the game thread",
                                        aContext.cid);
                              return json{{"wrote", false}, {"note", "no-op probe"}};
                          }});
}
} // namespace xfb::plugin
