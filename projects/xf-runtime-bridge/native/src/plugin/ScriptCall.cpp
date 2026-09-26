// Calling game and script functions from the plugin, the way script code calls them.
//
// Why this exists. The first in-game run (26 Sep 2026, game 2.31) crashed with a read at 0x0 at
// Cyberpunk2077.exe+0x1e28769 whenever the plugin called our redscript through
// RED4ext::ExecuteFunction(nullptr instance, ...) and that script then used TweakDBInterface.GetInt
// or TDBID.ToStringDEBUG. The faulting code is the cold path of rtti::Function::InternalCallNative
// (the game's address library names it, bin/x64/cyberpunk2077_addresses.json, RVA 0x14619c): a
// NON-static native called with no context asks the function for its "invokable" (virtual +0x20)
// and dereferences the null it gets. RED4ext.SDK reconstructs the same branch in
// CBaseFunction::ExecuteNative (Scripting/Functions-inl.hpp: `if (!context) {
// GetInvokable()->Execute(...) }`). Script declares TweakDBInterface and TDBID functions `static`,
// but the engine registers them as native member functions (flags isNative only: all 1015
// gamedataTweakDBInterface functions and gamedataTDBIDHelper.ToStringDEBUG in red-dump-json), so
// the VM passes them the calling script's own context. We had given the script none: the
// ExecuteFunction instance became the frame's context, and it was null. The game's own scripts
// never run without one, and every other caller passes one: CET a dummy entEntity instance
// (src/reverse/RTTIHelper.cpp:805-811, v1.37.1), RED4ext.SDK's ExecuteGlobalFunction the player
// system (Scripting/Utils-inl.hpp), red4ext-rs the class's system or the player system
// (src/systems/rtti.rs resolve_static_context, v0.10.0).
//
// How. Cyber Engine Tweaks' call recipe (RTTIHelper::ExecuteFunction, RTTIHelper.cpp:765-812,
// MIT), which runs every Lua call into the game on this game build:
//   - a caller frame whose bytecode passes each argument by pointer (core/ScriptFrame.cpp);
//   - that frame's function set to a named dummy, because "some functions expect a non-empty call
//     stack" (CET's comment); ours is `$XFBridge`, so a script error names the bridge as caller;
//   - rtti::Function's internal execute (RED4ext.SDK hash CBaseFunction_InternalExecute) with a
//     context that is never null: the instance for member functions, otherwise one entEntity
//     instance made once, as CET does, and held by a handle that is never released.
// Only on the game thread (the Running-state update): script and game objects are not
// thread-safe.

#include "plugin/ScriptCall.hpp"

#include <Windows.h>

#include <atomic>
#include <string>
#include <vector>

#include <RED4ext/Detail/AddressHashes.hpp>
#include <RED4ext/Scripting/Functions.hpp>
#include <RED4ext/Scripting/Stack.hpp>

#include "core/Dispatcher.hpp"
#include "core/Log.hpp"
#include "core/ScriptFrame.hpp"

namespace xfb::plugin
{
namespace
{
std::atomic<DWORD> gGameThread{0};

// Filled once at load by ResolveScriptCallAddresses (RB-32), before any call can run.
std::atomic<bool> gAddressesResolved{false};
std::atomic<uintptr_t> gInternalExecute{0};

using InternalExecute_t = bool (*)(RED4ext::CBaseFunction* aFunction, RED4ext::IScriptable* aContext,
                                   RED4ext::CStackFrame* aCallerFrame, void* aResult, void* aResultType);

// The dummy caller's body. It is never run; if it were, it would consume its ParamEnd like CET's.
void CallerBody(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, void*, int64_t)
{
    ++aFrame->code;
}

RED4ext::CBaseFunction* Caller()
{
    static RED4ext::CGlobalFunction* caller = RED4ext::CGlobalFunction::Create("$XFBridge", "$XFBridge", &CallerBody);
    return caller;
}

// The context for static and global functions. Made once and never freed (CET does the same):
// the handle below keeps a reference forever, so nothing that briefly wraps the context in a
// handle of its own can release it.
RED4ext::IScriptable* StaticContext()
{
    static RED4ext::IScriptable* context = []() -> RED4ext::IScriptable* {
        auto* cls = RED4ext::CRTTISystem::Get()->GetClass("entEntity");
        auto* instance = cls ? reinterpret_cast<RED4ext::IScriptable*>(cls->CreateInstance(true)) : nullptr;
        if (instance)
        {
            new RED4ext::Handle<RED4ext::IScriptable>(instance); // deliberately leaked
        }
        return instance;
    }();
    return context;
}

std::string NativeStatic(const char* aClass, const char* aFunction)
{
    auto* cls = RED4ext::CRTTISystem::Get()->GetClass(aClass);
    auto* fn = cls ? cls->GetFunction(aFunction) : nullptr;
    if (!fn)
    {
        return "missing";
    }
    return std::string(fn->flags.isNative ? "native" : "script") + (fn->flags.isStatic ? "_static" : "_member");
}

// Once per session: what the calls run with, and, as evidence for the crash analysis above, how
// this game build registers the two natives that crashed.
void LogCallContextOnce(RED4ext::IScriptable* aContext)
{
    static std::atomic<bool> logged{false};
    if (logged.exchange(true))
    {
        return;
    }
    const auto* type = aContext ? aContext->GetType() : nullptr;
    const auto* typeName = type ? type->GetName().ToString() : nullptr;
    log::Info("script.call_context",
              std::string("context=") + (typeName ? typeName : "<none>") + " caller=$XFBridge route=InternalExecute" +
                  " tweakdb_getint=" + NativeStatic("gamedataTweakDBInterface", "GetInt") +
                  " tdbid_tostringdebug=" + NativeStatic("gamedataTDBIDHelper", "ToStringDEBUG"));
}
} // namespace

void NoteGameThread()
{
    gGameThread.store(GetCurrentThreadId());
}

bool ResolveScriptCallAddresses()
{
    // Every engine address the call path below reaches through the SDK: the internal execute itself,
    // and what making the dummy caller ($XFBridge) and the static context (an entEntity held by a
    // handle) resolve on first use.
    namespace hashes = RED4ext::Detail::AddressHashes;
    const std::vector<script::Address> addresses{
        {"CBaseFunction_InternalExecute", hashes::CBaseFunction_InternalExecute},
        {"CGlobalFunction_ctor", hashes::CGlobalFunction_ctor},
        {"CClass_CreateInstance", hashes::CClass_CreateInstance},
        {"Handle_ctor", hashes::Handle_ctor},
    };
    using Resolve_t = uintptr_t (*)(uint32_t);
    Resolve_t resolve = nullptr;
    if (const auto red4ext = GetModuleHandleW(L"RED4ext.dll"))
    {
        resolve = reinterpret_cast<Resolve_t>(GetProcAddress(red4ext, "RED4ext_ResolveAddress"));
    }
    std::vector<uintptr_t> resolved;
    const auto missing = script::MissingAddresses(
        addresses, [resolve](uint32_t aHash) -> uintptr_t { return resolve ? resolve(aHash) : 0; }, resolved);
    if (!resolve || !missing.empty())
    {
        std::string names;
        for (const auto& name : missing)
        {
            names += (names.empty() ? "" : ",") + name;
        }
        log::Error("script.addresses_missing",
                   std::string("resolver=") + (resolve ? "RED4ext_ResolveAddress" : "<not found>") + " missing=" + names +
                       " script_calls=off (every game method is refused; update RED4ext or the bridge for this game)");
        gAddressesResolved.store(false);
        return false;
    }
    gInternalExecute.store(resolved[0]);
    gAddressesResolved.store(true);
    log::Info("script.addresses_resolved", "resolver=RED4ext_ResolveAddress count=" + std::to_string(resolved.size()) +
                                               " script_calls=on");
    return true;
}

bool ScriptCallsAvailable()
{
    return gAddressesResolved.load();
}

void CallFunction(RED4ext::CBaseFunction* aFn, RED4ext::IScriptable* aContext, const std::vector<void*>& aValues,
                  void* aOut, const std::string& aWhat, const std::string& aCid)
{
    if (!aFn)
    {
        throw MethodError("failed", "no function to call: " + aWhat);
    }
    if (!gAddressesResolved.load())
    {
        throw MethodError("script_calls_unavailable",
                          "an engine address the bridge needs to call the game is missing from this game version's "
                          "address library, so game calls are off this session: " + aWhat);
    }
    const auto gameThread = gGameThread.load();
    if (gameThread == 0 || gameThread != GetCurrentThreadId())
    {
        log::Warn("script.call_off_thread", "fn=" + aWhat, aCid);
        throw MethodError("failed", "a game call was attempted off the game thread: " + aWhat);
    }
    if (aValues.size() != aFn->params.size)
    {
        throw MethodError("failed", aWhat + " takes " + std::to_string(aFn->params.size) + " arguments, " +
                                        std::to_string(aValues.size()) + " given");
    }
    auto* resultType = aFn->returnType ? aFn->returnType->type : nullptr;
    if (resultType && !aOut)
    {
        throw MethodError("failed", aWhat + " returns a value but no place for it was given");
    }

    auto* context = aContext;
    if (!context)
    {
        context = StaticContext();
        if (!context)
        {
            throw MethodError("game_not_ready", "could not create the context for script calls");
        }
    }
    LogCallContextOnce(context);

    std::vector<script::Arg> args;
    args.reserve(aValues.size());
    for (uint32_t i = 0; i < aFn->params.size; ++i)
    {
        args.push_back({aFn->params[i]->type, aValues[i], false});
    }
    alignas(8) uint8_t code[script::kCodeCapacity]{};
    if (script::BuildParamCode(args, code, sizeof(code)) == 0)
    {
        throw MethodError("failed", "could not pass the arguments of " + aWhat);
    }
    RED4ext::CStackFrame caller(nullptr, reinterpret_cast<char*>(code));
    caller.func = Caller();

    // Resolved at load (ResolveScriptCallAddresses), never lazily: a lazy miss would end the game.
    const auto execute = reinterpret_cast<InternalExecute_t>(gInternalExecute.load());

    // Flushed as written, so after a crash the last script.call line names the call.
    log::Debug("script.call", "fn=" + aWhat + (aContext ? " on=instance" : " on=static"), aCid);
    const bool ok = execute(aFn, context, &caller, resultType ? aOut : nullptr, resultType);
    log::Debug("script.returned", "fn=" + aWhat + " ok=" + (ok ? "true" : "false"), aCid);
    if (!ok)
    {
        throw MethodError("call_failed", "the game refused the call: " + aWhat);
    }
}
} // namespace xfb::plugin
