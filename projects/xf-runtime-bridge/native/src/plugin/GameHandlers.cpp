// Bridge methods that need the game. Every game-thread method runs from the Running-state
// OnUpdate callback (see Main.cpp) and reaches the game only through RTTI lookups by name.
//
// Why RTTI by name, plus a signature check: if a patch removes or renames a function, the lookup
// fails; if it changes the function's shape (static flag, parameter count or types, return
// type), the check below refuses the call. Either way the method returns a clear error
// (rtti_missing or rtti_signature) instead of calling with the wrong stack layout. The check
// cannot catch a function that keeps its signature but changes what it needs or does; the
// runtime pin in Main.cpp (RED4ext refuses the plugin on any other game build) is the main guard.
// Names and signatures were checked against red-dump-json (a8e52990, a pre-2.3 dump; re-check on 2.31):
//   GetPlayer;GameInstance(ScriptGameInstance) -> handle:PlayerPuppet, static   (globals.json)
//   entEntity.GetWorldPosition() -> Vector4                                     (classes/entEntity.json)
//   ScriptGameInstance.GetPhotoModeSystem(ScriptGameInstance) -> handle:gamePhotoModeSystem, static
//   gamePhotoModeSystem.IsPhotoModeActive/CanPhotoModeBeEnabled/IsExitLocked() -> Bool
// The GetPlayer call pattern is RED4ext.SDK examples/native_globals_redscript/Main.cpp:19-23 (tag 1.0.0).

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>
#include <RED4ext/Scripting/Natives/Vector4.hpp>

#include <initializer_list>

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

std::string TypeName(const RED4ext::CProperty* aProperty)
{
    if (!aProperty || !aProperty->type)
    {
        return "<none>";
    }
    const auto* text = aProperty->type->GetName().ToString();
    return text ? text : "<unnamed>";
}

bool TypeIs(const RED4ext::CProperty* aProperty, const char* aExpected)
{
    return aProperty && aProperty->type && aProperty->type->GetName() == RED4ext::CName(aExpected);
}

// What the code below will put on the stack and read back. nullptr return type = no return value.
struct Signature
{
    bool isStatic;
    const char* returnType;
    std::initializer_list<const char*> params;
};

// Refuses the call unless the function has exactly the static flag, parameter types and
// return type the caller was written for.
void RequireSignature(const RED4ext::CBaseFunction* aFn, const std::string& aWhat, const Signature& aExpected,
                      const std::string& aCid)
{
    std::string problem;
    if (static_cast<bool>(aFn->flags.isStatic) != aExpected.isStatic)
    {
        problem = std::string("static=") + (aFn->flags.isStatic ? "true" : "false") +
                  " expected=" + (aExpected.isStatic ? "true" : "false");
    }
    else if (aFn->params.size != aExpected.params.size())
    {
        problem = "params=" + std::to_string(aFn->params.size) + " expected=" + std::to_string(aExpected.params.size());
    }
    else if ((aFn->returnType == nullptr) != (aExpected.returnType == nullptr) ||
             (aExpected.returnType && !TypeIs(aFn->returnType, aExpected.returnType)))
    {
        problem = "return=" + TypeName(aFn->returnType) +
                  " expected=" + (aExpected.returnType ? aExpected.returnType : "<none>");
    }
    else
    {
        uint32_t index = 0;
        for (const auto* expected : aExpected.params)
        {
            const auto* actual = aFn->params[index];
            if (!TypeIs(actual, expected))
            {
                problem = "param" + std::to_string(index) + "=" + TypeName(actual) + " expected=" + expected;
                break;
            }
            ++index;
        }
    }
    if (!problem.empty())
    {
        log::Warn("rtti.signature_mismatch", "function=" + aWhat + " " + problem, aCid);
        throw MethodError("rtti_signature", "signature changed, call refused: " + aWhat + " (" + problem + ")");
    }
}

RED4ext::CBaseFunction* FindClassFunction(const char* aClass, const char* aFunction, const Signature& aSignature,
                                          const std::string& aCid)
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
    RequireSignature(fn, std::string(aClass) + "." + aFunction, aSignature, aCid);
    return fn;
}

bool CallBool(RED4ext::ScriptInstance aInstance, const char* aClass, const char* aFunction, const std::string& aCid)
{
    auto* fn = FindClassFunction(aClass, aFunction, {false, "Bool", {}}, aCid);
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
    constexpr const char* kGetPlayer = "GetPlayer;GameInstance";
    auto* getPlayer = RED4ext::CRTTISystem::Get()->GetFunction(kGetPlayer);
    if (!getPlayer)
    {
        log::Warn("rtti.missing_function", std::string("global=") + kGetPlayer, aContext.cid);
        throw MethodError("rtti_missing", std::string("global not found: ") + kGetPlayer);
    }
    RequireSignature(getPlayer, kGetPlayer, {true, "handle:PlayerPuppet", {"ScriptGameInstance"}}, aContext.cid);

    RED4ext::ScriptGameInstance gameInstance;
    RED4ext::Handle<RED4ext::IScriptable> player;
    if (!RED4ext::ExecuteGlobalFunction(kGetPlayer, &player, gameInstance))
    {
        throw MethodError("call_failed", std::string("global call failed: ") + kGetPlayer);
    }
    if (!player)
    {
        log::Debug("game.player_position", "available=false", aContext.cid);
        return json{{"available", false}, {"reason", "no player (main menu or loading)"}};
    }

    auto* fn = FindClassFunction("entEntity", "GetWorldPosition", {false, "Vector4", {}}, aContext.cid);
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
    auto* getter = FindClassFunction("ScriptGameInstance", "GetPhotoModeSystem",
                                     {true, "handle:gamePhotoModeSystem", {"ScriptGameInstance"}}, aContext.cid);
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
    log::Debug("game.photomode_state", SerializeJson(state), aContext.cid);
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
    RequireSignature(fn, "XFRuntimeBridge.XFBridgeQuery.DescribeJson", {true, "String", {"String"}}, aContext.cid);
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
        return json{{"raw", text}}; // serialised with invalid UTF-8 replaced (SerializeJson)
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
