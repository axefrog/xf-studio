// Bridge methods that need the game. Every game-thread method runs from the Running-state
// OnUpdate callback (see Main.cpp) and reaches the game only through RTTI lookups by name. Every
// call, native or script, goes through CallFunction (ScriptCall.cpp), which calls the way script
// code does: with a caller frame and a context that is never null (the first in-game run crashed
// without one).
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

#include <map>
#include <set>
#include <mutex>
#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>
#include <RED4ext/Scripting/Natives/Vector4.hpp>
#include <RED4ext/Scripting/Natives/Generated/red/ResourceReferenceScriptToken.hpp>

#include <cstdio>
#include <initializer_list>
#include <thread>
#include <vector>

#include "core/LivePose.hpp"
#include "core/OptionsExchange.hpp"
#include "core/Params.hpp"
#include "core/Showroom.hpp"
#include "core/Writes.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/LivePoseMemory.hpp"
#include "plugin/Plugin.hpp"
#include "plugin/ScriptCall.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

// ScriptGameInstance reads CGameEngine::Get()->framework->gameInstance; refuse cleanly instead
// of dereferencing null early on.
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
    std::vector<const char*> params;
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

// A function's bare name: script functions compiled by redscript can be registered under a
// decorated name ("Status;String", possibly "Class::Status;String") rather than the bare short name
// CClass::GetFunction compares, so both the short and full names are reduced before comparing.
std::string BareName(const RED4ext::CName& aName)
{
    std::string name = aName.ToString() ? aName.ToString() : "";
    if (const auto colons = name.rfind("::"); colons != std::string::npos)
    {
        name = name.substr(colons + 2);
    }
    if (const auto semicolon = name.find(';'); semicolon != std::string::npos)
    {
        name = name.substr(0, semicolon);
    }
    return name;
}

// First in-game run (26 Sep 2026): our redscript class was in RTTI with no functions on it at
// all (staticFuncs and funcs both empty), so script static functions are looked for among the
// global functions too, registered as "<Class>::<Name>;<Params>" with or without the module
// prefix. A hit is cached per class and name, since game.wait polls game.status every 500 ms.
std::string ShortClassName(const std::string& aClassName)
{
    const auto dot = aClassName.rfind('.');
    return dot == std::string::npos ? aClassName : aClassName.substr(dot + 1);
}

bool GlobalMatches(const std::string& aFullName, const std::string& aClassName, const char* aFunction)
{
    const auto head = aFullName.substr(0, aFullName.find(';'));
    const auto colons = head.rfind("::");
    if (colons == std::string::npos || head.substr(colons + 2) != aFunction)
    {
        return false;
    }
    const auto owner = head.substr(0, colons);
    return owner == aClassName || owner == ShortClassName(aClassName) || ShortClassName(owner) == ShortClassName(aClassName);
}

RED4ext::CBaseFunction* FindGlobalStatic(const std::string& aClassName, const char* aFunction)
{
    static std::mutex cacheMutex;
    static std::map<std::string, RED4ext::CBaseFunction*> cache;
    const auto key = aClassName + "::" + aFunction;
    {
        std::lock_guard lock(cacheMutex);
        if (const auto it = cache.find(key); it != cache.end())
        {
            return it->second;
        }
    }
    RED4ext::DynArray<RED4ext::CBaseFunction*> globals;
    RED4ext::CRTTISystem::Get()->GetGlobalFunctions(globals);
    RED4ext::CBaseFunction* found = nullptr;
    for (auto* fn : globals)
    {
        const auto* full = fn ? fn->fullName.ToString() : nullptr;
        if (full && GlobalMatches(full, aClassName, aFunction))
        {
            found = fn;
            break;
        }
    }
    if (found)
    {
        std::lock_guard lock(cacheMutex);
        cache[key] = found;
    }
    return found;
}

RED4ext::CBaseFunction* FindByName(RED4ext::CClass* aClass, const std::string& aClassName, const char* aFunction)
{
    if (auto* fn = aClass->GetFunction(aFunction))
    {
        return fn;
    }
    const auto matches = [&](RED4ext::CClassFunction* aFn)
    { return BareName(aFn->shortName) == aFunction || BareName(aFn->fullName) == aFunction; };
    for (auto* fn : aClass->staticFuncs)
    {
        if (matches(fn))
        {
            return fn;
        }
    }
    for (auto* fn : aClass->funcs)
    {
        if (matches(fn))
        {
            return fn;
        }
    }
    return FindGlobalStatic(aClassName, aFunction);
}

void LogFunctionNames(RED4ext::CClass* aClass, const std::string& aClassName, const std::string& aCid)
{
    // Once per class per session: game.wait polls every 500 ms and would repeat the whole list.
    static std::mutex loggedMutex;
    static std::set<std::string> logged;
    {
        std::lock_guard lock(loggedMutex);
        if (!logged.insert(aClassName).second)
        {
            return;
        }
    }
    std::string names;
    const auto add = [&](RED4ext::CClassFunction* aFn)
    {
        if (names.size() > 3000)
        {
            return;
        }
        if (!names.empty())
        {
            names += ",";
        }
        names += std::string(aFn->shortName.ToString() ? aFn->shortName.ToString() : "?") + "|" +
                 (aFn->fullName.ToString() ? aFn->fullName.ToString() : "?");
    };
    for (auto* fn : aClass->staticFuncs)
    {
        add(fn);
    }
    for (auto* fn : aClass->funcs)
    {
        add(fn);
    }
    RED4ext::DynArray<RED4ext::CBaseFunction*> globals;
    RED4ext::CRTTISystem::Get()->GetGlobalFunctions(globals);
    std::string related;
    const auto shortName = ShortClassName(aClassName);
    for (auto* fn : globals)
    {
        const auto* full = fn ? fn->fullName.ToString() : nullptr;
        if (full && std::string(full).find(shortName) != std::string::npos && related.size() < 3000)
        {
            related += (related.empty() ? "" : ",") + std::string(full);
        }
    }
    log::Warn("rtti.script_globals", "class=" + aClassName + " globals=" + std::to_string(globals.size) +
                                         " related=" + related,
              aCid);
    log::Warn("rtti.script_functions", "class=" + aClassName + " static=" + std::to_string(aClass->staticFuncs.size) +
                                           " member=" + std::to_string(aClass->funcs.size) + " names=" + names,
              aCid);
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
    auto* fn = FindByName(cls, aClass, aFunction);
    if (!fn)
    {
        LogFunctionNames(cls, aClass, aCid);
        log::Warn("rtti.missing_function", std::string("class=") + aClass + " function=" + aFunction, aCid);
        throw MethodError("rtti_missing", std::string("function not found: ") + aClass + "." + aFunction);
    }
    RequireSignature(fn, std::string(aClass) + "." + aFunction, aSignature, aCid);
    return fn;
}

bool CallBool(RED4ext::IScriptable* aInstance, const char* aClass, const char* aFunction, const std::string& aCid)
{
    auto* fn = FindClassFunction(aClass, aFunction, {false, "Bool", {}}, aCid);
    bool value = false;
    CallFunction(fn, aInstance, {}, &value, std::string(aClass) + "." + aFunction, aCid);
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
    CallFunction(getPlayer, nullptr, {&gameInstance}, &player, kGetPlayer, aContext.cid);
    if (!player)
    {
        log::Debug("game.player_position", "available=false", aContext.cid);
        return json{{"available", false}, {"reason", "no player (main menu or loading)"}};
    }

    auto* fn = FindClassFunction("entEntity", "GetWorldPosition", {false, "Vector4", {}}, aContext.cid);
    RED4ext::Vector4 position;
    CallFunction(fn, player.GetPtr(), {}, &position, "entEntity.GetWorldPosition", aContext.cid);
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
    CallFunction(getter, nullptr, {&gameInstance}, &system, "ScriptGameInstance.GetPhotoModeSystem", aContext.cid);
    if (!system)
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
    auto* fn = FindByName(cls, "XFRuntimeBridge.XFBridgeQuery", "DescribeJson");
    if (!fn)
    {
        LogFunctionNames(cls, "XFRuntimeBridge.XFBridgeQuery", aContext.cid);
        throw MethodError("script_layer_missing", "XFBridgeQuery.DescribeJson not found");
    }
    RequireSignature(fn, "XFRuntimeBridge.XFBridgeQuery.DescribeJson", {true, "String", {"String"}}, aContext.cid);
    RED4ext::CString cid(aContext.cid);
    RED4ext::CString out;
    CallFunction(fn, nullptr, {&cid}, &out, "XFRuntimeBridge.XFBridgeQuery.DescribeJson", aContext.cid);
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

// ---- Phase 2: game actions ------------------------------------------------------------------
//
// Every method below validates its parameters in core/Params.cpp (shared with the self-test),
// then calls one static function of our own redscript layer (redscript/XFRuntimeBridgeActions
// .reds) with typed arguments. That layer is linted against the game's 2.31 script bundle, so
// the game names it uses are checked at build time; here the plugin checks the script
// function's own signature, which catches a stale Scripts folder. Each script function answers
// a JSON object: {"ok":true,...} or {"ok":false,"code","message"}.

std::chrono::milliseconds Timeout()
{
    return std::chrono::milliseconds(Get().config.requestTimeoutMs);
}

RED4ext::CBaseFunction* FindScriptFunction(const std::string& aClass, const char* aFunction,
                                           const Signature& aSignature, const std::string& aCid)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    const auto className = "XFRuntimeBridge." + aClass;
    auto* cls = rtti->GetClass(className.c_str());
    if (!cls)
    {
        throw MethodError("script_layer_missing", "redscript class " + className + " not found (scripts not compiled?)");
    }
    auto* fn = FindByName(cls, className, aFunction);
    if (!fn)
    {
        LogFunctionNames(cls, className, aCid);
        throw MethodError("script_layer_missing", className + "." + aFunction + " not found (stale Scripts folder?)");
    }
    RequireSignature(fn, className + "." + aFunction, aSignature, aCid);
    return fn;
}

// Calls XFRuntimeBridge.<aClass>.<aFunction>(cid: String, <aTypes...>) -> String and returns the
// answer without its "ok" field, or throws the MethodError it reports.
json CallScript(const std::string& aClass, const char* aFunction, std::initializer_list<const char*> aTypes,
                std::initializer_list<void*> aValues, const std::string& aCid)
{
    RequireGameInstance();
    std::vector<const char*> types{"String"};
    types.insert(types.end(), aTypes.begin(), aTypes.end());
    auto* fn = FindScriptFunction(aClass, aFunction, {true, "String", types}, aCid);

    RED4ext::CString cid(aCid.c_str());
    std::vector<void*> values{&cid};
    values.insert(values.end(), aValues.begin(), aValues.end());
    RED4ext::CString out;
    CallFunction(fn, nullptr, values, &out, "XFRuntimeBridge." + aClass + "." + aFunction, aCid);
    const std::string text(out.c_str(), out.Length());
    json parsed;
    try
    {
        parsed = json::parse(text);
    }
    catch (const std::exception&)
    {
        log::Warn("script.bad_json", "function=" + aClass + "." + aFunction + " text=" + Sanitize(text, 512), aCid);
        throw MethodError("failed", "the script layer answered something that isn't JSON");
    }
    if (!parsed.is_object())
    {
        throw MethodError("failed", "the script layer answered something that isn't a JSON object");
    }
    if (!parsed.value("ok", false))
    {
        throw MethodError(parsed.value("code", std::string("failed")), parsed.value("message", std::string()));
    }
    parsed.erase("ok");
    return parsed;
}

bool CallScriptHasOption(const params::AppearanceCheck& aCheck, const std::string& aCid)
{
    auto* fn = FindScriptFunction("XFCharacter", "HasOption", {true, "Bool", {"String", "String", "Bool"}}, aCid);
    RED4ext::CString group(aCheck.group.c_str());
    RED4ext::CString option(aCheck.option.c_str());
    bool fpp = aCheck.fpp;
    bool present = false;
    CallFunction(fn, nullptr, {&group, &option, &fpp}, &present, "XFRuntimeBridge.XFCharacter.HasOption", aCid);
    return present;
}

void XFBridgeEnsureSaveLock(const std::string& aCid)
{
    CallScript("XFBridgeActions", "SaveLock", {}, {}, aCid);
}

json SetPhotoAttribute(int32_t aKey, float aValue, const std::string& aCid)
{
    return CallScript("XFPhoto", "SetAttribute", {"Int32", "Float"}, {&aKey, &aValue}, aCid);
}

// Sets attributes in order; on a failure, says which ones were already applied.
json SetPhotoAttributes(const std::vector<params::Attribute>& aAttributes, const std::string& aCid)
{
    json applied = json::array();
    for (const auto& attribute : aAttributes)
    {
        try
        {
            auto result = SetPhotoAttribute(attribute.key, attribute.value, aCid);
            result["name"] = attribute.name;
            applied.push_back(result);
        }
        catch (const MethodError& e)
        {
            std::string done;
            for (const auto& item : applied)
            {
                done += (done.empty() ? "" : ", ") + item.value("name", std::string());
            }
            throw MethodError(e.code, attribute.name + ": " + e.what() +
                                          (done.empty() ? " (nothing was changed)" : " (already changed: " + done + ")"));
        }
    }
    return applied;
}

json GameStatus(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    auto& state = Get();
    json out{{"plugin_game_state", GameStateName(state.gameState.load())},
             {"game_version", {{"product", state.gameProductVersion}, {"file", state.gameFileVersion}}},
             {"allow_writes", state.config.allowWrites},
             {"write_classes", WriteClassList(state.config)},
             {"writes_paused", state.bridge && state.bridge->GetDispatcher().WritesPaused()},
             {"allow_live_pose", state.config.allowLivePose}};
    if (!state.queue.IsPumping())
    {
        out["phase"] = state.gameState.load() == 3 ? "shutting_down" : "starting";
        return out;
    }
    // While the game's scripts can't be called (a save loading, the game starting), the plugin answers by itself
    // (RB-76): game.wait polls this through a load, and session 5's crash was this very call made just after the
    // script layer detached. Checked again on the game thread, right before the call, since the detach can come
    // while the request waits in the queue.
    const auto cid = aContext.cid;
    if (!state.scriptLayer.Ready())
    {
        out.update(writes::StatusWhileLoading(state.scriptLayer.Phase(), state.scriptLayer.Describe()));
        return out; // no game-thread step at all: the engine may not tick during a load
    }
    auto answer = RunGameTask(
        state.queue, Timeout(),
        [cid]() -> json {
            auto& layer = Get().scriptLayer;
            if (!layer.Ready())
            {
                return writes::StatusWhileLoading(layer.Phase(), layer.Describe());
            }
            auto status = CallScript("XFBridgeActions", "Status", {}, {}, cid);
            status["script_layer"] = layer.Describe();
            return status;
        },
        "game.status", false);
    out.update(answer);
    return out;
}

json PlayerAppearance(const MethodContext& aContext)
{
    const auto request = params::ParseAppearance(aContext.params);
    RED4ext::CString option(request.option.c_str());
    auto out = CallScript("XFCharacter", "Appearance", {"String"}, {&option}, aContext.cid);
    if (!request.checks.empty())
    {
        json checks = json::array();
        for (const auto& check : request.checks)
        {
            checks.push_back({{"group", check.group},
                              {"option", check.option},
                              {"fpp", check.fpp},
                              {"present", CallScriptHasOption(check, aContext.cid)}});
        }
        out["checks"] = checks;
    }
    return out;
}

json PhotoState(const MethodContext& aContext)
{
    const auto request = params::ParsePhotoState(aContext.params);
    bool menu = request.menu;
    bool options = request.options;
    return CallScript("XFPhoto", "State", {"Bool", "Bool"}, {&menu, &options}, aContext.cid);
}

// Polls photo.state on the game thread until photo mode is (in)active, for up to aWaitMs.
bool WaitForPhotoMode(bool aActive, int aWaitMs, const std::string& aCid)
{
    for (int waited = 0; waited <= aWaitMs; waited += 100)
    {
        const auto state = RunGameTask(
            Get().queue, Timeout(),
            [aCid] {
                bool menu = false;
                bool options = false;
                return CallScript("XFPhoto", "State", {"Bool", "Bool"}, {&menu, &options}, aCid);
            },
            "photo.wait");
        if (state.value("active", false) == aActive)
        {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return false;
}

// Opens photo mode by running the game's own quest node for it (questOpenPhotoMode_NodeType
// inside a questUIManagerNodeDefinition) through Codeware's QuestsSystem.ExecuteNode, the route
// Codeware provides for running a single quest node from a mod [source: Codeware
// src/App/Quest/QuestsSystemEx.hpp, scripts/Quest/QuestsSystem.reds; the node's fields from
// RED4ext.SDK quest/OpenPhotoMode_NodeType.hpp]. Without Codeware the method says so; nothing is
// hooked. Whether the node opens photo mode outside a quest is a first-session check.
json PhotoEnterOnGameThread(const std::string& aCid)
{
    RequireGameInstance();
    const auto status = CallScript("XFBridgeActions", "Status", {}, {}, aCid);
    const auto phase = status.value("phase", std::string());
    if (phase == "photo_mode")
    {
        return json{{"changed", false}, {"note", "photo mode was already open"}};
    }
    if (phase != "gameplay")
    {
        throw MethodError("not_in_gameplay", "photo mode can only be opened from normal play (the game is in '" + phase + "')");
    }
    if (!status.value("photo_mode_can_open", false))
    {
        throw MethodError("unavailable", "the game doesn't allow photo mode right now (combat, a scene or a vehicle?)");
    }

    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* questsClass = rtti->GetClass("questQuestsSystem");
    auto* execute = questsClass ? questsClass->GetFunction("ExecuteNode") : nullptr;
    if (!execute)
    {
        throw MethodError("unsupported",
                          "opening photo mode needs Codeware (QuestsSystem.ExecuteNode); open it with the game's photo mode key instead");
    }
    RequireSignature(execute, "questQuestsSystem.ExecuteNode", {false, nullptr, {"handle:questNodeDefinition", "CName"}}, aCid);
    auto* getter = FindClassFunction("ScriptGameInstance", "GetQuestsSystem",
                                     {true, "handle:questQuestsSystem", {"ScriptGameInstance"}}, aCid);

    auto* nodeClass = rtti->GetClass("questUIManagerNodeDefinition");
    auto* typeClass = rtti->GetClass("questOpenPhotoMode_NodeType");
    auto* nodeBase = rtti->GetClass("questNodeDefinition");
    auto* typeBase = rtti->GetClass("questIUIManagerNodeType");
    if (!nodeClass || !typeClass || !nodeBase || !typeBase || !nodeClass->IsA(nodeBase) || !typeClass->IsA(typeBase))
    {
        throw MethodError("rtti_missing", "the photo-mode quest node types are missing or changed in this game version");
    }
    auto* typeProperty = nodeClass->GetProperty("type");
    auto* tppProperty = typeClass->GetProperty("alwaysAllowTPP");
    auto* fppProperty = typeClass->GetProperty("forceFppMode");
    auto* lockProperty = typeClass->GetProperty("lockExitUntilScreenshot");
    if (!typeProperty || !tppProperty || !fppProperty || !lockProperty ||
        typeProperty->type->GetName() != RED4ext::CName("handle:questIUIManagerNodeType") ||
        tppProperty->type->GetName() != RED4ext::CName("Bool") || fppProperty->type->GetName() != RED4ext::CName("Bool") ||
        lockProperty->type->GetName() != RED4ext::CName("Bool"))
    {
        throw MethodError("rtti_signature", "the photo-mode quest node's fields changed in this game version");
    }

    // Instances as RedLib creates them (Codeware lib/Red/Utils/Handles.hpp:68).
    RED4ext::Handle<RED4ext::ISerializable> nodeType(reinterpret_cast<RED4ext::ISerializable*>(typeClass->CreateInstance(true)));
    RED4ext::Handle<RED4ext::ISerializable> node(reinterpret_cast<RED4ext::ISerializable*>(nodeClass->CreateInstance(true)));
    if (!nodeType || !node)
    {
        throw MethodError("failed", "could not create the photo-mode quest node");
    }
    tppProperty->SetValue<bool>(nodeType.GetPtr(), true);
    fppProperty->SetValue<bool>(nodeType.GetPtr(), false);
    lockProperty->SetValue<bool>(nodeType.GetPtr(), false);
    typeProperty->SetValue<RED4ext::Handle<RED4ext::ISerializable>>(node.GetPtr(), nodeType);

    RED4ext::ScriptGameInstance gameInstance;
    RED4ext::Handle<RED4ext::IScriptable> quests;
    CallFunction(getter, nullptr, {&gameInstance}, &quests, "ScriptGameInstance.GetQuestsSystem", aCid);
    if (!quests)
    {
        throw MethodError("unavailable", "the quest system is not available");
    }
    RED4ext::CName socket;
    CallFunction(execute, quests.GetPtr(), {&node, &socket}, nullptr, "questQuestsSystem.ExecuteNode", aCid);
    log::Info("photo.enter_requested", "route=quest_node questOpenPhotoMode_NodeType alwaysAllowTPP=true undo=photo.exit", aCid);
    return json{{"changed", true}};
}

// photo.enter refuses unless route = "quest" (params::ParsePhotoEnter): the quest node opened a
// restricted photo mode in the first session (first-person camera only, no V tab), so until a proper
// route exists the player presses the photo-mode key and game.wait follows.
json PhotoEnter(const MethodContext& aContext)
{
    params::ParsePhotoEnter(aContext.params);
    const auto cid = aContext.cid;
    auto result = RunGameTask(Get().queue, Timeout(), [cid] { return PhotoEnterOnGameThread(cid); }, "photo.enter");
    if (result.value("changed", false))
    {
        result["active"] = WaitForPhotoMode(true, 3000, cid);
        result["route"] = "quest";
        result["route_detail"] = "quest node questOpenPhotoMode_NodeType through Codeware QuestsSystem.ExecuteNode";
        result["research_only"] = "this route opens a restricted photo mode (first-person camera only, no V tab)";
        if (!result["active"].get<bool>())
        {
            result["note"] = "the request was sent, but photo mode had not opened after 3 s";
        }
    }
    result["undo"] = {{"method", "photo.exit"}, {"params", json::object()}};
    return result;
}

json PhotoExit(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    const auto cid = aContext.cid;
    auto result = RunGameTask(
        Get().queue, Timeout(), [cid] { return CallScript("XFPhoto", "Exit", {}, {}, cid); }, "photo.exit");
    if (result.value("changed", false))
    {
        result["active"] = !WaitForPhotoMode(false, 3000, cid);
    }
    // Reopening is photo.open in the tools (it presses the photo-mode key); the plugin can't.
    result["undo"] = nullptr;
    result["undo_note"] = "photo.open (or the player's photo mode key) opens photo mode again; its settings start fresh";
    return result;
}

json PhotoCameraSet(const MethodContext& aContext)
{
    const auto request = params::ParseCamera(aContext.params);
    if (request.reset)
    {
        const auto cid = aContext.cid;
        return writes::CameraReset(params::CameraKeys(), [&cid](int32_t aKey) {
            return CallScript("XFPhoto", "ResetAttribute", {"Int32"}, {&aKey}, cid);
        });
    }
    const auto applied = SetPhotoAttributes(request.attributes, aContext.cid);
    std::vector<std::string> unknown;
    json out{{"applied", applied}};
    writes::AttachUndo(out, "photo.camera.set", writes::UndoParams(applied, &unknown), unknown);
    return out;
}

// Selecting a light and changing its values happen a few frames apart: photo mode loads the
// newly selected light's values into the sliders after the switch (Photo Mode Preferences waits
// two frames for the same reason, init.lua:767-790). The wait counts game ticks, not time, so it
// holds at any frame rate; the sequence and its undo are core/Writes.cpp (unit-tested).
constexpr uint64_t kLightSettleTicks = 3;

json PhotoLightSet(const MethodContext& aContext)
{
    const auto request = params::ParseLight(aContext.params);
    const auto cid = aContext.cid;
    auto& queue = Get().queue;
    writes::LightOps ops;
    ops.set = [&queue, cid](int32_t aKey, float aValue) {
        return RunGameTask(queue, Timeout(), [cid, aKey, aValue] { return SetPhotoAttribute(aKey, aValue, cid); },
                           aKey == params::key::kLightSelect ? "photo.light.select" : "photo.light.set");
    };
    ops.settle = [&queue] {
        if (!writes::WaitTicks(queue, kLightSettleTicks, Timeout()))
        {
            throw MethodError("timeout", "photo mode didn't load the selected light's values in time");
        }
    };
    // Moving a light's entity (research): XFPhoto.PlaceLight, then XFPhoto.LightPosition a few ticks later.
    ops.place = [&queue, cid](int32_t aLight, const params::LightPlacement& aPlacement) {
        return RunGameTask(
            queue, Timeout(),
            [cid, aLight, aPlacement] {
                int32_t light = aLight;
                int32_t mode = aPlacement.kind == params::LightPlacement::Kind::World ? 2 : 1;
                float a = mode == 2 ? aPlacement.world[0] : aPlacement.azimuth;
                float b = mode == 2 ? aPlacement.world[1] : aPlacement.elevation;
                float c = mode == 2 ? aPlacement.world[2] : aPlacement.distance;
                return CallScript("XFPhoto", "PlaceLight", {"Int32", "Int32", "Float", "Float", "Float"}, {&light, &mode, &a, &b, &c}, cid);
            },
            "photo.light.place");
    };
    ops.position = [&queue, cid](int32_t aLight) {
        return RunGameTask(
            queue, Timeout(),
            [cid, aLight] {
                int32_t light = aLight;
                return CallScript("XFPhoto", "LightPosition", {"Int32"}, {&light}, cid);
            },
            "photo.light.position");
    };
    return writes::LightSet(request, ops);
}

// ui.message: a short line under the bridge's in-game label (core/Messages.hpp), drawn by the CET layer.
// Notify class: never touches the game, so no game-thread step.
json UiMessage(const MethodContext& aContext)
{
    const auto request = params::ParseMessage(aContext.params);
    auto out = Get().messages.Post(request);
    out["undo"] = {{"method", "ui.message"}, {"params", {{"clear", true}}}};
    out["undo_note"] = "messages also disappear by themselves after their seconds, and the kill switch clears them";
    if (!Get().layers.Has("cet"))
    {
        out["note"] = "the bridge's CET layer hasn't announced itself, so nothing may be drawn (is Cyber Engine Tweaks loaded?)";
    }
    return out;
}

// inventory.* and game.* (bridge 0.4): multi-step, so they run on the bridge thread and send each game step
// through the queue (core/Writes.cpp holds the sequences, unit-tested).
constexpr uint64_t kInventorySettleTicks = 4;

writes::InventoryOps InventoryOpsFor(const std::string& aCid)
{
    auto& queue = Get().queue;
    writes::InventoryOps ops;
    ops.slot = [&queue, aCid](const std::string& aSlot, const std::string& aItem) {
        return RunGameTask(
            queue, Timeout(),
            [aCid, aSlot, aItem] {
                RED4ext::CString slot(aSlot.c_str());
                RED4ext::CString item(aItem.c_str());
                return CallScript("XFInventory", "Slot", {"String", "String"}, {&slot, &item}, aCid);
            },
            "inventory.slot");
    };
    ops.removeAdded = [&queue, aCid](const std::string& aItem) {
        return RunGameTask(
            queue, Timeout(),
            [aCid, aItem] {
                RED4ext::CString item(aItem.c_str());
                return CallScript("XFInventory", "RemoveAdded", {"String"}, {&item}, aCid);
            },
            "inventory.remove");
    };
    ops.settle = [&queue] {
        if (!writes::WaitTicks(queue, kInventorySettleTicks, Timeout()))
        {
            throw MethodError("timeout", "the game didn't tick while the equipment request was handled");
        }
    };
    return ops;
}

json InventoryEquipMethod(const MethodContext& aContext)
{
    const auto request = params::ParseInventoryEquip(aContext.params);
    const auto cid = aContext.cid;
    auto ops = InventoryOpsFor(cid);
    ops.equip = [cid, request] {
        return RunGameTask(
            Get().queue, Timeout(),
            [cid, request] {
                RED4ext::CString item(request.item.c_str());
                RED4ext::CString slot(request.slot.c_str());
                bool add = request.addIfMissing;
                return CallScript("XFInventory", "Equip", {"String", "String", "Bool"}, {&item, &slot, &add}, cid);
            },
            "inventory.equip");
    };
    return writes::InventoryEquip(request, ops);
}

json InventoryUnequipMethod(const MethodContext& aContext)
{
    const auto request = params::ParseInventoryUnequip(aContext.params);
    const auto cid = aContext.cid;
    auto ops = InventoryOpsFor(cid);
    ops.unequip = [cid, request] {
        return RunGameTask(
            Get().queue, Timeout(),
            [cid, request] {
                RED4ext::CString slot(request.slot.c_str());
                RED4ext::CString item(request.item.c_str());
                return CallScript("XFInventory", "Unequip", {"String", "String"}, {&slot, &item}, cid);
            },
            "inventory.unequip");
    };
    return writes::InventoryUnequip(request, ops);
}

std::function<void()> WritesGuard();

// wardrobe.state (0.5.2): the active outfit and what each clothing area shows.
json WardrobeState(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    return CallScript("XFWardrobe", "State", {}, {}, aContext.cid);
}

// wardrobe.equip (0.5.2): one wardrobe change (or the undo's exact restore) through the equipment system's own
// requests (redscript XFWardrobe), then the wardrobe read until it shows it (writes::WardrobeEquip).
json WardrobeEquipMethod(const MethodContext& aContext)
{
    const auto request = params::ParseWardrobeEquip(aContext.params);
    const auto cid = aContext.cid;
    auto& queue = Get().queue;
    writes::WardrobeOps ops;
    ops.change = [&queue, cid, request] {
        return RunGameTask(
            queue, Timeout(),
            [cid, request] {
                if (request.mode == "restore")
                {
                    // Begin, one slot each, then apply: all in this one game-thread step.
                    int32_t set = request.set;
                    CallScript("XFWardrobe", "RestoreBegin", {"Int32"}, {&set}, cid);
                    for (const auto& slot : request.slots)
                    {
                        RED4ext::CString area(slot.area.c_str());
                        RED4ext::CString item(slot.item.c_str());
                        bool hidden = slot.hidden;
                        CallScript("XFWardrobe", "RestoreSlot", {"String", "String", "Bool"}, {&area, &item, &hidden}, cid);
                    }
                    return CallScript("XFWardrobe", "RestoreFinish", {}, {}, cid);
                }
                RED4ext::CString mode(request.mode.c_str());
                int32_t set = request.set;
                RED4ext::CString item(request.item.c_str());
                RED4ext::CString area(request.area.c_str());
                return CallScript("XFWardrobe", "Change", {"String", "Int32", "String", "String"}, {&mode, &set, &item, &area}, cid);
            },
            "wardrobe.equip");
    };
    ops.state = [&queue, cid] {
        return RunGameTask(queue, Timeout(), [cid] { return CallScript("XFWardrobe", "State", {}, {}, cid); }, "wardrobe.state");
    };
    ops.settle = [&queue] {
        if (!writes::WaitTicks(queue, 3, Timeout()))
        {
            throw MethodError("timeout", "the game didn't tick while the wardrobe changed");
        }
    };
    WritesGuard()();
    return writes::WardrobeEquip(request, ops);
}

// Multi-step writes check the kill switch and the panel's pause again before each step that changes the
// game (RB-53); the dispatcher only checks them when the request arrives.
std::function<void()> WritesGuard()
{
    return [] {
        if (auto& state = Get(); state.bridge)
        {
            state.bridge->GetDispatcher().RequireWritesOpen();
        }
    };
}

json GameSaveMethod(const MethodContext& aContext)
{
    const auto request = params::ParseGameSave(aContext.params);
    const auto cid = aContext.cid;
    auto& queue = Get().queue;
    writes::SaveOps ops;
    ops.prepare = [&queue, cid, request] {
        return RunGameTask(
            queue, Timeout(),
            [cid, request] {
                bool override = request.overrideLock;
                return CallScript("XFGame", "SavePrepare", {"Bool"}, {&override}, cid);
            },
            "game.save.prepare");
    };
    ops.status = [&queue, cid] {
        return RunGameTask(queue, Timeout(), [cid] { return CallScript("XFGame", "SavingLocked", {}, {}, cid); }, "game.save.status");
    };
    ops.save = [&queue, cid, request] {
        return RunGameTask(
            queue, Timeout(),
            [cid, request] {
                RED4ext::CString label(request.name.c_str());
                return CallScript("XFGame", "Save", {"String"}, {&label}, cid);
            },
            "game.save");
    };
    // Takes the bridge's save lock back through the queue; when that can't happen now (the kill switch
    // closed the queue, a timeout), the next Running tick retakes it directly (Main.cpp, RB-52).
    ops.relock = [&queue, cid] {
        try
        {
            RunGameTask(queue, Timeout(), [cid] { return CallScript("XFGame", "Retake", {}, {}, cid); }, "game.save.relock");
        }
        catch (const std::exception& e)
        {
            Get().relockOwed.store(true);
            log::Warn("game.save_relock_deferred", std::string("what=") + e.what() + " (retaken on the next game tick)", cid);
        }
    };
    ops.guard = WritesGuard();
    ops.sleep = [](std::chrono::milliseconds aFor) { std::this_thread::sleep_for(aFor); };
    return writes::GameSave(request, ops);
}

json GameLoadMethod(const MethodContext& aContext)
{
    const auto request = params::ParseGameLoad(aContext.params);
    const auto cid = aContext.cid;
    auto& queue = Get().queue;
    writes::LoadOps ops;
    ops.latest = [&queue, cid] {
        return RunGameTask(
            queue, Timeout(),
            [cid] {
                auto result = CallScript("XFGame", "LoadLatest", {}, {}, cid);
                // In the same game-thread step (RB-76): no script call until the loaded session is ready.
                Get().scriptLayer.OnLoadRequested();
                return result;
            },
            "game.load.latest");
    };
    ops.list = [&queue, cid] {
        return RunGameTask(queue, Timeout(), [cid] { return CallScript("XFGame", "ListSaves", {}, {}, cid); }, "game.load.list");
    };
    ops.saves = [&queue, cid] {
        return RunGameTask(queue, Timeout(), [cid] { return CallScript("XFGame", "Saves", {}, {}, cid); }, "game.load.saves");
    };
    ops.load = [&queue, cid](const std::string& aName) {
        return RunGameTask(
            queue, Timeout(),
            [cid, aName] {
                RED4ext::CString name(aName.c_str());
                auto result = CallScript("XFGame", "LoadNamed", {"String"}, {&name}, cid);
                Get().scriptLayer.OnLoadRequested(); // as for the latest save (RB-76)
                return result;
            },
            "game.load");
    };
    ops.guard = WritesGuard();
    ops.sleep = [](std::chrono::milliseconds aFor) { std::this_thread::sleep_for(aFor); };
    return writes::GameLoad(request, ops);
}

json PhotoHudHide(const MethodContext& aContext)
{
    const auto request = params::ParseHud(aContext.params);
    bool visible = !request.hidden;
    bool cursor = request.cursor;
    return writes::HudResult(CallScript("XFPhoto", "SetUiVisible", {"Bool", "Bool"}, {&visible, &cursor}, aContext.cid));
}

// Read-only: where V's head (plus an offset) is in the world and on screen, and the photo-mode
// camera's transform, field of view and aspect ratio (XFPhoto.Subject). photo.frame (tools) centres
// and sizes the shot from this without hand-tuned offsets.
json PhotoSubject(const MethodContext& aContext)
{
    const auto request = params::ParseSubject(aContext.params);
    float up = request.up;
    float forward = request.forward;
    float right = request.right;
    return CallScript("XFPhoto", "Subject", {"Float", "Float", "Float"}, {&up, &forward, &right}, aContext.cid);
}

json PhotoExpressionSet(const MethodContext& aContext)
{
    const auto face = params::ParseExpression(aContext.params);
    return writes::ExpressionResult(SetPhotoAttribute(params::key::kExpression, static_cast<float>(face), aContext.cid));
}

// ---- V's photo-mode face: face.rig.read (read) and photo.expression.index (write-photo) --------
//
// face.rig.read finds components on the photo-mode stand-in or its head item by name through the
// redscript layer (XFFace.Component: Entity.FindComponentByName, vanilla 2.31), then reads their
// animation setup here, through the game's own reflection: a property is read only when it exists
// with the expected kind of type, so a changed layout is reported, never guessed. No game function is
// called on the component; resource references are reported as their path hashes (FNV-1a64 of the
// depot path, which the Studio labels from its resolver).

constexpr uint32_t kMaxSetupEntries = 64;

std::string TypeNameOf(const RED4ext::CBaseRTTIType* aType)
{
    if (!aType)
    {
        return "<none>";
    }
    const auto* text = aType->GetName().ToString();
    return text ? text : "<unnamed>";
}

// Where a property's value lives, or null when the property is missing, isn't of aKind, or keeps its
// value in a script value holder (native component data never does).
void* PropertyValue(RED4ext::CClass* aClass, void* aInstance, const char* aName, RED4ext::ERTTIType aKind, json& aProblems)
{
    auto* property = aClass ? aClass->GetProperty(aName) : nullptr;
    if (!property || !property->type)
    {
        aProblems.push_back(std::string(aName) + ": missing");
        return nullptr;
    }
    if (property->type->GetType() != aKind || property->flags.inValueHolder)
    {
        aProblems.push_back(std::string(aName) + ": unexpected type " + TypeNameOf(property->type));
        return nullptr;
    }
    return property->GetValuePtr<void>(aInstance);
}

// A resource reference (rRef or raRef): both keep the path hash first (RED4ext.SDK ResourceReference
// and ResourceAsyncReference, path at offset 0). Null when unset.
json ResourceHash(RED4ext::CClass* aClass, void* aInstance, const char* aName, RED4ext::ERTTIType aKind, json& aProblems)
{
    const auto* value = static_cast<const uint64_t*>(PropertyValue(aClass, aInstance, aName, aKind, aProblems));
    if (!value)
    {
        return nullptr;
    }
    if (*value == 0)
    {
        return nullptr;
    }
    char hex[19];
    std::snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(*value));
    return json{{"hash", std::to_string(*value)}, {"hex", hex}};
}

// animAnimSetup {gameplay, cinematics: array<animAnimSetupEntry {animSet (raRef), priority}>}.
json AnimSetup(RED4ext::CClass* aClass, void* aInstance, const char* aName, json& aProblems)
{
    auto* property = aClass ? aClass->GetProperty(aName) : nullptr;
    if (!property || !property->type || property->type->GetType() != RED4ext::ERTTIType::Class ||
        property->flags.inValueHolder)
    {
        aProblems.push_back(std::string(aName) + ": missing or not a structure");
        return nullptr;
    }
    auto* setupClass = static_cast<RED4ext::CClass*>(property->type);
    void* setup = property->GetValuePtr<void>(aInstance);
    json out = json::object();
    for (const char* list : {"gameplay", "cinematics"})
    {
        auto* listProperty = setupClass->GetProperty(list);
        if (!listProperty || !listProperty->type || listProperty->type->GetType() != RED4ext::ERTTIType::Array)
        {
            aProblems.push_back(std::string(aName) + "." + list + ": missing or not a list");
            continue;
        }
        auto* arrayType = static_cast<RED4ext::CRTTIBaseArrayType*>(listProperty->type);
        auto* entryType = arrayType->GetInnerType();
        if (!entryType || entryType->GetType() != RED4ext::ERTTIType::Class)
        {
            aProblems.push_back(std::string(aName) + "." + list + ": entries are not structures");
            continue;
        }
        auto* entryClass = static_cast<RED4ext::CClass*>(entryType);
        void* array = listProperty->GetValuePtr<void>(setup);
        const auto length = arrayType->GetLength(array);
        json entries = json::array();
        for (uint32_t i = 0; i < length && i < kMaxSetupEntries; ++i)
        {
            void* entry = arrayType->GetElement(array, i);
            if (!entry)
            {
                break;
            }
            json item{{"anim_set", ResourceHash(entryClass, entry, "animSet", RED4ext::ERTTIType::ResourceAsyncReference, aProblems)}};
            if (auto* priority = static_cast<const uint8_t*>(
                    PropertyValue(entryClass, entry, "priority", RED4ext::ERTTIType::Fundamental, aProblems)))
            {
                item["priority"] = *priority;
            }
            entries.push_back(item);
        }
        out[list] = entries;
        if (length > kMaxSetupEntries)
        {
            out[std::string(list) + "_truncated_from"] = length;
        }
    }
    return out;
}

json DescribeComponent(RED4ext::IScriptable* aComponent)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* cls = aComponent->GetType();
    json out{{"class", TypeNameOf(cls)}};
    json problems = json::array();
    auto* animated = rtti->GetClass("entAnimatedComponent");
    auto* extension = rtti->GetClass("entAnimationSetupExtensionComponent");
    if (cls && animated && cls->IsA(animated))
    {
        out["kind"] = "animated";
        out["facial_setup"] = ResourceHash(cls, aComponent, "facialSetup", RED4ext::ERTTIType::ResourceAsyncReference, problems);
        out["graph"] = ResourceHash(cls, aComponent, "graph", RED4ext::ERTTIType::ResourceReference, problems);
        out["rig"] = ResourceHash(cls, aComponent, "rig", RED4ext::ERTTIType::ResourceReference, problems);
        out["animations"] = AnimSetup(cls, aComponent, "animations", problems);
    }
    else if (cls && extension && cls->IsA(extension))
    {
        out["kind"] = "animation_setup_extension";
        out["animations"] = AnimSetup(cls, aComponent, "animations", problems);
    }
    else
    {
        out["kind"] = "other";
    }
    if (!problems.empty())
    {
        out["unreadable"] = problems;
    }
    return out;
}

json FaceRigRead(const MethodContext& aContext)
{
    const auto request = params::ParseFaceRig(aContext.params);
    int32_t target = static_cast<int32_t>(request.target);
    auto out = CallScript("XFFace", "Describe", {"Int32"}, {&target}, aContext.cid);
    auto* fn = FindScriptFunction("XFFace", "Component", {true, "handle:IScriptable", {"String", "Int32", "CName"}}, aContext.cid);
    json components = json::array();
    for (const auto& name : request.components)
    {
        RED4ext::CString cid(aContext.cid.c_str());
        RED4ext::CName componentName(name.c_str());
        RED4ext::Handle<RED4ext::IScriptable> component;
        CallFunction(fn, nullptr, {&cid, &target, &componentName}, &component, "XFRuntimeBridge.XFFace.Component", aContext.cid);
        json entry{{"name", name}, {"found", static_cast<bool>(component)}};
        if (component)
        {
            entry.update(DescribeComponent(component.GetPtr()));
        }
        components.push_back(entry);
    }
    out["components"] = components;
    out["hashes"] = "resource path hashes (FNV-1a64 of the lower-case depot path), as decimal text and hex";
    log::Debug("face.rig_read", "target=" + std::string(params::FaceTargetName(request.target)) +
                                    " components=" + std::to_string(request.components.size()),
               aContext.cid);
    return out;
}

// photo.expression.index: the plugin checks the index against the expression list's face table indices
// (writes::CheckFaceIndex; RB-72: one known only by list position needs force), then the script applies it,
// both in the same game-thread step.
json PhotoExpressionIndex(const MethodContext& aContext)
{
    const auto request = params::ParseExpressionIndex(aContext.params);
    const auto standing = writes::CheckFaceIndex(
        request, request.unlisted ? json::object() : CallScript("XFPhoto", "FaceIndexEntries", {}, {}, aContext.cid));
    int32_t target = static_cast<int32_t>(request.target);
    int32_t index = request.index;
    bool unlisted = request.unlisted;
    auto out = writes::ExpressionIndexResult(
        CallScript("XFFace", "ApplyIndex", {"Int32", "Int32", "Bool"}, {&target, &index, &unlisted}, aContext.cid));
    out["index_by"] = standing;
    return out;
}

json CharacterApply(const MethodContext& aContext)
{
    const auto request = params::ParseCharacterApply(aContext.params);
    RED4ext::CString option(request.option.c_str());
    int32_t index = request.index;
    RED4ext::CString value(request.value.c_str());
    RED4ext::CString expectOption(request.expectOption.c_str());
    RED4ext::CString expectValue(request.expectValue.c_str());
    auto result = CallScript("XFCharacter", "Apply", {"String", "Int32", "String", "String", "String"},
                             {&option, &index, &value, &expectOption, &expectValue}, aContext.cid);
    result["undo"] = {{"method", "cc.apply"},
                      {"params", {{"option", result.value("option", request.option)}, {"index", result.value("before", 0)}}},
                      {"note", "or press Back in the appearance screen and confirm, which discards every change made there"}};
    return result;
}

// cc.confirm / cc.back: the creator menu's own Confirm (keeps the look) and Back-and-confirm (discards
// every change), refused unless [bridge] allow_creator_leave = true.
json CreatorLeave(const MethodContext& aContext, bool aKeep)
{
    params::RequireOnly(aContext.params, {});
    params::CreatorLeaveAllowed(Get().config.allowCreatorLeave);
    // Read what changed, choose the route (core/Writes.cpp, unit-tested; RB-51), then leave: both on the
    // game thread in the same step, so nothing can change in between.
    const auto state = CallScript("XFCharacter", "LeaveState", {}, {}, aContext.cid);
    int32_t mode = writes::LeaveRouteCode(writes::ChooseLeave(aKeep, state));
    auto result = CallScript("XFCharacter", "Leave", {"Int32"}, {&mode}, aContext.cid);
    result["undo"] = nullptr;
    result["undo_note"] = aKeep ? "the look is kept in the running game; load the safety save to undo it"
                                : "every change made on the appearance screen was discarded; nothing to undo";
    return result;
}

// cc.open: opens the appearance screen from normal play (research/runtime/runtime-bridge-design.md §3.6,
// knowledge/photo-mode.md §3.1). The redscript layer checks the moment (V in the world; no combat,
// scene, vehicle or menu), requests the save lock, and after a few ticks refuses unless the game
// reports saving locked; then it asks the idle menu scenario, through the game's own menu-event
// blackboard, to switch to the mirror's scenario with that scenario's own menu data. The vanilla
// scenario does the rest. Behind allow_creator_leave, like Confirm and Back; the sequence and its
// undo are core/Writes.cpp (unit-tested).
constexpr uint64_t kCreatorSettleTicks = 3;

json CreatorOpenMethod(const MethodContext& aContext)
{
    const auto request = params::ParseCreatorOpen(aContext.params);
    params::CreatorLeaveAllowed(Get().config.allowCreatorLeave);
    const auto cid = aContext.cid;
    // The edit tag the screen opens with: 0 NewGame (edit_mode new_game, RB-66), 1 HairDresser, 2 Ripperdoc.
    const int32_t mode = params::CreatorEditTagCode(request);
    auto& queue = Get().queue;
    writes::CreatorOpenOps ops;
    ops.prepare = [&queue, cid, mode] {
        return RunGameTask(
            queue, Timeout(),
            [cid, mode] {
                int32_t m = mode;
                return CallScript("XFCharacter", "OpenPrepare", {"Int32"}, {&m}, cid);
            },
            "cc.open.prepare");
    };
    ops.settle = [&queue] {
        if (!writes::WaitTicks(queue, kCreatorSettleTicks, Timeout()))
        {
            throw MethodError("timeout", "the game didn't tick after the save-lock request; nothing was opened");
        }
    };
    ops.open = [&queue, cid, mode] {
        return RunGameTask(
            queue, Timeout(),
            [cid, mode] {
                int32_t m = mode;
                return CallScript("XFCharacter", "Open", {"Int32"}, {&m}, cid);
            },
            "cc.open.request");
    };
    ops.phase = [&queue, cid] {
        return RunGameTask(queue, Timeout(), [cid] { return CallScript("XFBridgeActions", "Status", {}, {}, cid); }, "cc.open.wait")
            .value("phase", std::string());
    };
    ops.cancel = [&queue, cid]() -> json {
        try
        {
            return RunGameTask(queue, Timeout(), [cid] { return CallScript("XFCharacter", "CancelOpen", {}, {}, cid); },
                               "cc.open.cancel");
        }
        catch (const MethodError& e)
        {
            log::Warn("cc.open_cancel_failed", std::string("what=") + e.what(), cid);
            return json::object();
        }
    };
    ops.sleep = [](std::chrono::milliseconds aFor) { std::this_thread::sleep_for(aFor); };
    return writes::CreatorOpen(request, ops);
}

// cc.page: the open appearance screen's preview camera to one body region, as hovering a row does.
json CreatorPage(const MethodContext& aContext)
{
    const auto request = params::ParseCreatorPage(aContext.params);
    RED4ext::CString slot(request.slot.c_str());
    auto result = CallScript("XFCharacter", "Page", {"String"}, {&slot}, aContext.cid);
    result["page"] = request.page;
    result["undo"] = {{"method", "cc.page"}, {"params", {{"page", "default"}}}};
    result["undo_note"] = "the camera's earlier region isn't readable, so the undo returns it to the screen's starting view";
    return result;
}

// game.options.read: the user settings (graphics, display) from the redscript layer, and the engine's
// render options from the CET layer through core/OptionsExchange (only CET can read those).
constexpr auto kRenderOptionsWait = std::chrono::milliseconds(3000);

json RenderOptions(const std::vector<std::string>& aNames, const std::string& aCid)
{
    auto& state = Get();
    if (!state.layers.Has("cet"))
    {
        return json{{"available", false},
                    {"reason", "the bridge's CET layer hasn't announced itself (Cyber Engine Tweaks reads these options)"}};
    }
    const auto seq = state.options.Request(aNames);
    OptionsOutcome outcome;
    const auto values = state.options.WaitFor(seq, kRenderOptionsWait, &outcome);
    if (!values)
    {
        state.options.Withdraw(seq);
        log::Warn("options.no_answer", "seq=" + std::to_string(seq) + (outcome.refusal.empty() ? "" : " refused=" + outcome.refusal),
                  aCid);
    }
    return RenderOptionsResult(aNames, values, outcome, static_cast<int>(kRenderOptionsWait.count()));
}

json GameOptionsRead(const MethodContext& aContext)
{
    const auto request = params::ParseGameOptions(aContext.params);
    const auto cid = aContext.cid;
    json out = json::object();
    if (request.settings)
    {
        std::string groups;
        for (const auto& group : request.groups)
        {
            groups += (groups.empty() ? "" : ",") + group;
        }
        out["settings"] = RunGameTask(
            Get().queue, Timeout(),
            [cid, groups] {
                RED4ext::CString text(groups.c_str());
                return CallScript("XFSettings", "Read", {"String"}, {&text}, cid);
            },
            "game.options.settings");
    }
    if (request.renderOptions)
    {
        out["render_options"] = RenderOptions(request.names, cid);
    }
    return out;
}

json CreatorConfirm(const MethodContext& aContext)
{
    return CreatorLeave(aContext, true);
}

json CreatorBack(const MethodContext& aContext)
{
    return CreatorLeave(aContext, false);
}

// world.time.set (0.5.1): the phase and the request choose the clock (writes::ChooseTimeRoute; RB-67, RB-70), in
// the same game-thread step as the change. Photo mode's own time of day (attribute 70) is planned and answered
// by core/Writes.cpp from the slider's description, and set through the menu like any photo attribute.
json WorldTimeSet(const MethodContext& aContext)
{
    const auto request = params::ParseTime(aContext.params);
    const auto phase = CallScript("XFBridgeActions", "Status", {}, {}, aContext.cid).value("phase", std::string());
    const bool photoAllowed = (Get().config.writeClasses & kWritePhoto) != 0;
    const auto route = writes::ChooseTimeRoute(request, phase, photoAllowed);
    if (route == writes::TimeRoute::PhotoClosed)
    {
        log::Info("world.time_photo_closed", "a photo-mode time with photo mode closed; nothing changed (phase=" + phase + ")", aContext.cid);
        return writes::PhotoClosedTimeResult(phase);
    }
    if (route == writes::TimeRoute::Photo)
    {
        const auto plan = writes::PlanPhotoTime(CallScript("XFWorld", "PhotoTimeSlider", {}, {}, aContext.cid), request);
        auto out = writes::PhotoTimeResult(SetPhotoAttribute(70, static_cast<float>(plan.value), aContext.cid), plan);
        log::Info("world.time_photo", "photo-mode time of day " + out["before_minutes"].dump() + " -> " + out["after_minutes"].dump() +
                                          " minutes (attribute 70); undo=" + out["undo"].dump(),
                  aContext.cid);
        return out;
    }
    int32_t hours = request.hours;
    int32_t minutes = request.minutes;
    int32_t seconds = request.seconds;
    int32_t total = request.totalSeconds;
    return writes::TimeResult(CallScript("XFWorld", "SetTime", {"Int32", "Int32", "Int32", "Int32"},
                                         {&hours, &minutes, &seconds, &total}, aContext.cid));
}

json WorldPause(const MethodContext& aContext)
{
    bool paused = params::ParsePause(aContext.params);
    return writes::PauseResult(CallScript("XFWorld", "SetFrozen", {"Bool"}, {&paused}, aContext.cid));
}

// photo.pose.set: selects a photo-mode pose through the menu (attribute 5, the category, then 6, the pose),
// as the player does; the sequence and its undo are core/Writes.cpp (writes::PoseSet). The redscript layer
// finds the category and pose by label (a pose record gives both) or by option data.
constexpr uint64_t kPoseSettleTicks = 5;

json PhotoPoseSet(const MethodContext& aContext)
{
    const auto request = params::ParsePoseSet(aContext.params);
    const auto cid = aContext.cid;
    auto& queue = Get().queue;
    auto resolvedPose = std::make_shared<std::string>(request.pose);
    writes::PoseSetOps ops;
    ops.category = [&queue, cid, request, resolvedPose] {
        auto result = RunGameTask(
            queue, Timeout(),
            [cid, request] {
                RED4ext::CString record(request.record.c_str());
                RED4ext::CString category(request.category.c_str());
                int32_t value = request.categoryValue;
                return CallScript("XFPose", "SelectCategory", {"String", "String", "Int32"}, {&record, &category, &value}, cid);
            },
            "photo.pose.category");
        if (result.contains("pose_text") && result["pose_text"].is_string() && resolvedPose->empty())
        {
            *resolvedPose = result["pose_text"].get<std::string>();
        }
        return result;
    };
    ops.settle = [&queue] {
        if (!writes::WaitTicks(queue, kPoseSettleTicks, Timeout()))
        {
            throw MethodError("timeout", "the game didn't tick after the pose category changed");
        }
    };
    ops.pose = [&queue, cid, request, resolvedPose] {
        return RunGameTask(
            queue, Timeout(),
            [cid, request, resolvedPose] {
                RED4ext::CString pose(resolvedPose->c_str());
                int32_t value = request.poseValue;
                return CallScript("XFPose", "SelectPose", {"String", "Int32"}, {&pose, &value}, cid);
            },
            "photo.pose.pose");
    };
    ops.restoreCategory = [&queue, cid](int32_t aValue) {
        RunGameTask(
            queue, Timeout(), [cid, aValue] { return SetPhotoAttribute(5, static_cast<float>(aValue), cid); },
            "photo.pose.restore");
    };
    return writes::PoseSet(ops);
}

// pose.live.read: finds a loaded animation set and clip (default: the XF carrier) and checks its key
// layout; read-only (plugin/LivePoseMemory.cpp, core/LivePose.cpp).
json PoseLiveRead(const MethodContext& aContext)
{
    return live::Read(params::ParsePoseLiveRead(aContext.params), aContext.cid);
}

// pose.live.apply: writes the XF carrier clip's constant keys, only with allow_live_pose, only in photo
// mode with the carrier selected; the undo (and the kill switch) put the carrier's own keys back.
json PoseLiveApply(const MethodContext& aContext)
{
    const auto request = params::ParsePoseLiveApply(aContext.params);
    params::LivePoseAllowed(Get().config.allowLivePose);
    if (!request.restore)
    {
        const auto selected = CallScript("XFPose", "CarrierSelected", {}, {}, aContext.cid);
        if (!selected.value("selected", false))
        {
            throw MethodError("carrier_not_selected",
                              "the XF live carrier isn't the selected photo-mode pose (" +
                                  selected.value("pose", std::string("none")) +
                                  " is); select it with photo.pose.set {record: \"xfs_live_carrier\"} first");
        }
        XFBridgeEnsureSaveLock(aContext.cid);
    }
    return live::Apply(request, aContext.cid);
}

// showroom.* (bridge 0.5): XF Finish Showroom's heads and light rigs, spawned through Codeware's static entity system by the
// redscript layer (XFRuntimeBridgeShowroom.reds; without Codeware its functions refuse with codeware_missing). Multi-step, so
// the sequences run on the bridge thread (core/Showroom.cpp) and send each game step through the queue.
constexpr uint64_t kShowroomSettleTicks = 3;

showroom::Ops ShowroomOpsFor(const std::string& aCid)
{
    auto& queue = Get().queue;
    showroom::Ops ops;
    ops.guard = [] {
        if (auto& state = Get(); state.bridge)
        {
            state.bridge->GetDispatcher().RequireWritesOpen();
        }
    };
    ops.spawn = [&queue, aCid](showroom::Kind aKind, const showroom::Placement& aItem) {
        return RunGameTask(
            queue, Timeout(),
            [aCid, aKind, aItem] {
                RED4ext::CString kind(showroom::KindName(aKind));
                // A ResRef is the path's hash (RaRef<CResource>); redscript has no string-to-ResRef conversion at run time.
                RED4ext::ResRef path;
                path.resource = RED4ext::RaRef<RED4ext::CResource>(RED4ext::ResourcePath(aItem.templatePath.c_str()));
                RED4ext::CString appearance(aItem.appearance.c_str());
                RED4ext::CString label(aItem.label.c_str());
                int32_t index = aItem.index;
                float x = static_cast<float>(aItem.x), y = static_cast<float>(aItem.y), z = static_cast<float>(aItem.z);
                float yaw = static_cast<float>(aItem.yaw);
                return CallScript("XFShowroom", "Spawn",
                                  {"String", "redResourceReferenceScriptToken", "String", "String", "Int32", "Float", "Float", "Float", "Float"},
                                  {&kind, &path, &appearance, &label, &index, &x, &y, &z, &yaw}, aCid);
            },
            "showroom.spawn");
    };
    ops.clear = [&queue, aCid](const std::string& aWhat) {
        return RunGameTask(
            queue, Timeout(),
            [aCid, aWhat] {
                RED4ext::CString what(aWhat.c_str());
                return CallScript("XFShowroom", "Clear", {"String"}, {&what}, aCid);
            },
            "showroom.clear");
    };
    ops.turn = [&queue, aCid](int32_t aIndex, double aYaw) {
        return RunGameTask(
            queue, Timeout(),
            [aCid, aIndex, aYaw] {
                int32_t index = aIndex;
                float yaw = static_cast<float>(aYaw);
                return CallScript("XFShowroom", "Turn", {"Int32", "Float"}, {&index, &yaw}, aCid);
            },
            "showroom.turn");
    };
    ops.status = [&queue, aCid] {
        return RunGameTask(queue, Timeout(), [aCid] { return CallScript("XFShowroom", "Status", {}, {}, aCid); }, "showroom.status");
    };
    ops.settle = [&queue] {
        if (!writes::WaitTicks(queue, kShowroomSettleTicks, Timeout()))
        {
            throw MethodError("timeout", "the game didn't tick while the showroom was spawning");
        }
    };
    return ops;
}

json ShowroomAnchor(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    return CallScript("XFShowroom", "Anchor", {}, {}, aContext.cid);
}

json ShowroomState(const MethodContext& aContext)
{
    params::RequireOnly(aContext.params, {});
    return CallScript("XFShowroom", "Status", {}, {}, aContext.cid);
}

json ShowroomPlace(const MethodContext& aContext)
{
    return showroom::Place(showroom::ParsePlace(aContext.params, showroom::Kind::Piece), ShowroomOpsFor(aContext.cid));
}

json ShowroomLights(const MethodContext& aContext)
{
    return showroom::Place(showroom::ParsePlace(aContext.params, showroom::Kind::Rig), ShowroomOpsFor(aContext.cid));
}

json ShowroomTurn(const MethodContext& aContext)
{
    return showroom::TurnPieces(showroom::ParseTurn(aContext.params), ShowroomOpsFor(aContext.cid));
}

json ShowroomClear(const MethodContext& aContext)
{
    return showroom::Clear(showroom::ParseClear(aContext.params), ShowroomOpsFor(aContext.cid));
}

// Wraps a write method: marks that the bridge changed something (so the kill switch restores it)
// and logs the change with its reversal.
MethodSpec WriteMethod(std::string aName, Access aAccess, RunOn aRunOn, std::string aSummary,
                       json (*aFn)(const MethodContext&))
{
    return {aName, aAccess, aRunOn, std::move(aSummary), [aName, aFn](const MethodContext& aContext) {
                Get().restore.MarkWrite();
                auto result = aFn(aContext);
                log::Info("write.done",
                          "method=" + aName + " undo=" + SerializeJson(result.contains("undo") ? result["undo"] : json("none")),
                          aContext.cid);
                return result;
            }};
}
} // namespace

void RestoreAfterKill()
{
    if (live::HasSnapshot())
    {
        try
        {
            log::Info("bridge.kill_restored_pose", SerializeJson(live::Restore("kill-restore", true)), "kill-restore");
        }
        catch (const std::exception& e)
        {
            log::Warn("bridge.kill_restore_pose_failed", std::string("what=") + e.what(), "kill-restore");
        }
    }
    const auto result = CallScript("XFBridgeActions", "RestoreAfterKill", {}, {}, "kill-restore");
    log::Info("bridge.kill_restored", SerializeJson(result), "kill-restore");
    // XF Finish Showroom's heads and light rigs go too (bridge 0.5); nothing to do when none were spawned.
    try
    {
        RED4ext::CString all("all");
        log::Info("bridge.kill_cleared_showroom", SerializeJson(CallScript("XFShowroom", "Clear", {"String"}, {&all}, "kill-restore")),
                  "kill-restore");
    }
    catch (const std::exception& e)
    {
        log::Warn("bridge.kill_clear_showroom_failed", std::string("what=") + e.what(), "kill-restore");
    }
}

void RetakeOwedSaveLock()
{
    if (!Get().relockOwed.exchange(false))
    {
        return;
    }
    const auto result = CallScript("XFGame", "Retake", {}, {}, "save-relock");
    log::Info("game.save_relocked", SerializeJson(result), "save-relock");
}

void ReleaseCursorAfterIdle()
{
    const auto result = CallScript("XFBridgeActions", "ReleaseCursor", {}, {}, "idle-release");
    log::Info("bridge.idle_cursor_released", SerializeJson(result), "idle-release");
}

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

    // Phase 2. Reads.
    aDispatcher.Register({"game.status", Access::Read, RunOn::BridgeThread,
                          "Game phase (main menu, loading, gameplay, photo mode, character menu, menu, paused), versions, "
                          "player, photo mode, clock and save-lock state.",
                          &GameStatus});
    aDispatcher.Register({"player.appearance", Access::Read, RunOn::GameThread,
                          "V's character-creator state; the option list only while the appearance screen is open.",
                          &PlayerAppearance});
    aDispatcher.Register({"photo.state", Access::Read, RunOn::GameThread,
                          "Photo mode flags; with menu=true every menu item's range, options and current value.",
                          &PhotoState});
    aDispatcher.Register({"photo.subject", Access::Read, RunOn::GameThread,
                          "V's head (plus an offset) in the world and on screen, and the photo-mode camera's transform and "
                          "field of view.",
                          &PhotoSubject});
    aDispatcher.Register({"game.options.read", Access::Read, RunOn::BridgeThread,
                          "Graphics and display settings (upscaler, ray and path tracing, SSS quality, HDR) and, through "
                          "the CET layer, the engine's character render options.",
                          &GameOptionsRead});
    aDispatcher.Register({"face.rig.read", Access::Read, RunOn::GameThread,
                          "The photo-mode stand-in's or head item's face components: facial setup, graph, rig and "
                          "animation sets (path hashes).",
                          &FaceRigRead});

    // Phase 2. Writes (refused unless allow_writes = true); each logs its reversal.
    aDispatcher.Register(WriteMethod("photo.enter", Access::WritePhoto, RunOn::BridgeThread,
                                     "Refuses (press the photo-mode key); route quest opens a restricted photo mode for research.", &PhotoEnter));
    aDispatcher.Register(WriteMethod("photo.exit", Access::WritePhoto, RunOn::BridgeThread, "Leaves photo mode.", &PhotoExit));
    aDispatcher.Register(WriteMethod("photo.camera.set", Access::WritePhoto, RunOn::GameThread,
                                     "Photo-mode camera and subject settings (FOV, roll, focus, DOF, V's placement), or reset.",
                                     &PhotoCameraSet));
    aDispatcher.Register(WriteMethod("photo.light.set", Access::WritePhoto, RunOn::BridgeThread, "Selects a photo-mode light and sets its values.",
                                     &PhotoLightSet));
    aDispatcher.Register(WriteMethod("photo.hud.hide", Access::WritePhoto, RunOn::GameThread, "Hides or shows the photo-mode interface and its mouse cursor.", &PhotoHudHide));
    aDispatcher.Register(WriteMethod("photo.expression.set", Access::WritePhoto, RunOn::GameThread, "Sets V's photo-mode expression by its value.",
                                     &PhotoExpressionSet));
    aDispatcher.Register(WriteMethod("photo.expression.index", Access::WritePhoto, RunOn::GameThread,
                                     "Applies a photo-mode face index directly (research); refuses unlisted indices unless asked.",
                                     &PhotoExpressionIndex));
    aDispatcher.Register(WriteMethod("cc.apply", Access::WriteCharacter, RunOn::GameThread,
                                     "Sets one character-creator option on the open appearance screen (never confirms).",
                                     &CharacterApply));
    aDispatcher.Register(WriteMethod("cc.open", Access::WriteCharacter, RunOn::BridgeThread,
                                     "Opens the appearance screen from normal play (save lock first); off unless allow_creator_leave.",
                                     &CreatorOpenMethod));
    aDispatcher.Register(WriteMethod("cc.page", Access::WriteCharacter, RunOn::GameThread,
                                     "Points the open appearance screen's camera at one body region.", &CreatorPage));
    aDispatcher.Register(WriteMethod("cc.confirm", Access::WriteCharacter, RunOn::GameThread,
                                     "Confirms the appearance screen (keeps the look); off unless allow_creator_leave.", &CreatorConfirm));
    aDispatcher.Register(WriteMethod("cc.back", Access::WriteCharacter, RunOn::GameThread,
                                     "Backs out of the appearance screen, discarding its changes; off unless allow_creator_leave.", &CreatorBack));
    aDispatcher.Register(WriteMethod("photo.pose.set", Access::WritePhoto, RunOn::BridgeThread,
                                     "Selects a photo-mode pose through the menu (by record, label or option data).", &PhotoPoseSet));
    aDispatcher.Register({"pose.live.read", Access::Read, RunOn::GameThread,
                          "Finds a loaded animation clip (default: the XF live carrier) and checks its key layout; "
                          "read-only.",
                          &PoseLiveRead});
    aDispatcher.Register(WriteMethod("pose.live.apply", Access::WritePhoto, RunOn::GameThread,
                                     "Writes joint rotations into the XF live carrier clip (research); off unless "
                                     "allow_live_pose.",
                                     &PoseLiveApply));
    aDispatcher.Register(WriteMethod("world.time.set", Access::WriteWorld, RunOn::GameThread,
                                     "Sets the in-game clock (normal play, the appearance screen, or photo mode's own time of day).",
                                     &WorldTimeSet));
    aDispatcher.Register(WriteMethod("world.pause", Access::WriteWorld, RunOn::GameThread, "Freezes or unfreezes the world (gameplay only).", &WorldPause));

    // Bridge 0.4: a message line under the in-game label, V's clothing, manual saves and loading.
    aDispatcher.Register({"ui.message", Access::Notify, RunOn::BridgeThread,
                          "Shows a short message under the bridge's in-game label (CET layer); clear removes them.", &UiMessage});
    aDispatcher.Register(WriteMethod("inventory.equip", Access::WriteInventory, RunOn::BridgeThread,
                                     "Equips a clothing item (adding it to V's inventory only if asked); off unless the inventory class is allowed.",
                                     &InventoryEquipMethod));
    aDispatcher.Register(WriteMethod("inventory.unequip", Access::WriteInventory, RunOn::BridgeThread,
                                     "Unequips a clothing slot (and removes an item the bridge added, if asked).", &InventoryUnequipMethod));
    // Bridge 0.5.2: the wardrobe (outfits decide what each clothing area shows), in the inventory write class.
    aDispatcher.Register({"wardrobe.state", Access::Read, RunOn::GameThread,
                          "The active wardrobe outfit, what each clothing area shows, and the stored outfits.", &WardrobeState});
    aDispatcher.Register(WriteMethod("wardrobe.equip", Access::WriteInventory, RunOn::BridgeThread,
                                     "Applies or clears a wardrobe outfit, shows an item in the active outfit, or restores a snapshot.",
                                     &WardrobeEquipMethod));
    aDispatcher.Register(WriteMethod("game.save", Access::WriteSave, RunOn::BridgeThread,
                                     "Makes one new manual save; refused while the bridge's save lock is held unless overridden.", &GameSaveMethod));
    aDispatcher.Register(WriteMethod("game.load", Access::WriteSave, RunOn::BridgeThread, "Loads the latest save or one save by name.",
                                     &GameLoadMethod));

    // Bridge 0.5: XF Finish Showroom (the showroom write class, listed only by the test profile's -writes build).
    aDispatcher.Register({"showroom.anchor", Access::Read, RunOn::GameThread,
                          "Where V and the camera are and which way they face, and whether Codeware is loaded (for placing the showroom).",
                          &ShowroomAnchor});
    aDispatcher.Register({"showroom.state", Access::Read, RunOn::GameThread,
                          "The XF Finish Showroom heads and light rigs the bridge spawned, where they are and whether they are in.", &ShowroomState});
    aDispatcher.Register(WriteMethod("showroom.place", Access::WriteShowroom, RunOn::BridgeThread,
                                     "Spawns XF Finish Showroom heads at the given places (Codeware static entities; nothing persists).", &ShowroomPlace));
    aDispatcher.Register(WriteMethod("showroom.lights", Access::WriteShowroom, RunOn::BridgeThread,
                                     "Spawns XF Finish Showroom light rigs at the given places.", &ShowroomLights));
    aDispatcher.Register(WriteMethod("showroom.turn", Access::WriteShowroom, RunOn::BridgeThread, "Turns showroom heads to the given yaws.", &ShowroomTurn));
    aDispatcher.Register(WriteMethod("showroom.clear", Access::WriteShowroom, RunOn::BridgeThread,
                                     "Removes the showroom's heads, light rigs or both.", &ShowroomClear));

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
