// Global native functions for redscript and CET.
//
// Registered in the RTTI post-register callback the way RED4ext.SDK's
// examples/native_globals_redscript does (tag 1.0.0, Main.cpp:64-83): CGlobalFunction::Create,
// flags {isNative, isStatic}, AddParam/SetReturnType, CRTTISystem::RegisterFunction.
// Redscript declares them in Scripts/XFRuntimeBridge/Natives.reds; CET reaches them as
// Game.XFBridge_* (CET RTTIHelper::ResolveFunction searches global functions by short name).
//
// All of them run on the thread that calls them (the game's script thread). None of them
// touches game objects; they only read and write bridge bookkeeping.

#include <RED4ext/RED4ext.hpp>

#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

std::string ToStd(const RED4ext::CString& aText)
{
    return std::string(aText.c_str(), aText.Length());
}

std::string CleanLayer(const std::string& aLayer)
{
    // Layers name themselves; keep them short and plain for the log format.
    std::string out;
    for (const auto c : aLayer)
    {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
        {
            out.push_back(c);
        }
        if (out.size() >= 16)
        {
            break;
        }
    }
    return out.empty() ? "unknown" : out;
}

// XFBridge_Ping(layer: String, cid: String) -> String
void Ping(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    RED4ext::CString layer;
    RED4ext::CString cid;
    RED4ext::GetParameter(aFrame, &layer);
    RED4ext::GetParameter(aFrame, &cid);
    aFrame->code++; // skip ParamEnd

    const auto layerName = CleanLayer(ToStd(layer));
    const auto cidText = ToStd(cid);
    log::Info("native.ping", "from=" + layerName, cidText);

    if (aOut)
    {
        const auto reply = json{{"ok", true},
                                {"sid", Get().session.sessionId},
                                {"cid", cidText},
                                {"from", layerName},
                                {"plugin_version", XFB_VERSION_STRING}};
        *aOut = RED4ext::CString(reply.dump());
    }
}

// XFBridge_Info() -> String (JSON)
void Info(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, RED4ext::CString* aOut, int64_t)
{
    aFrame->code++; // skip ParamEnd
    if (aOut)
    {
        *aOut = RED4ext::CString(InfoJson().dump());
    }
}

// XFBridge_Log(layer: String, level: String, cid: String, message: String) -> Void
void LogFromScript(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, void*, int64_t)
{
    RED4ext::CString layer;
    RED4ext::CString level;
    RED4ext::CString cid;
    RED4ext::CString message;
    RED4ext::GetParameter(aFrame, &layer);
    RED4ext::GetParameter(aFrame, &level);
    RED4ext::GetParameter(aFrame, &cid);
    RED4ext::GetParameter(aFrame, &message);
    aFrame->code++; // skip ParamEnd

    Level parsed = Level::Info;
    ParseLevel(ToStd(level), parsed);
    log::Write(parsed, CleanLayer(ToStd(layer)), ToStd(cid), "script.log", ToStd(message));
}

// XFBridge_Announce(layer: String, detail: String) -> Void
void Announce(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, void*, int64_t)
{
    RED4ext::CString layer;
    RED4ext::CString detail;
    RED4ext::GetParameter(aFrame, &layer);
    RED4ext::GetParameter(aFrame, &detail);
    aFrame->code++; // skip ParamEnd

    const auto layerName = CleanLayer(ToStd(layer));
    const auto detailText = Sanitize(ToStd(detail), 512);
    Get().layers.Announce(layerName, detailText);
    log::Info("layer.announce", "layer=" + layerName + " detail=" + detailText);
}

// XFBridge_Kill(reason: String) -> Bool   (kill switch for the CET hotkey)
void Kill(RED4ext::IScriptable*, RED4ext::CStackFrame* aFrame, bool* aOut, int64_t)
{
    RED4ext::CString reason;
    RED4ext::GetParameter(aFrame, &reason);
    aFrame->code++; // skip ParamEnd

    auto& state = Get();
    const bool hadBridge = state.bridge != nullptr;
    if (hadBridge)
    {
        state.bridge->Kill("script:" + Sanitize(ToStd(reason), 64));
    }
    else
    {
        log::Info("bridge.kill_ignored", "reason=bridge_not_enabled");
    }
    if (aOut)
    {
        *aOut = hadBridge;
    }
}

void RegisterGlobal(RED4ext::CRTTISystem* aRtti, const char* aName, auto aFunction, const char* aReturnType,
                    std::initializer_list<const char*> aStringParams)
{
    auto* func = RED4ext::CGlobalFunction::Create(aName, aName, aFunction);
    func->flags = {.isNative = true, .isStatic = true};
    for (const auto* param : aStringParams)
    {
        func->AddParam("String", param);
    }
    if (aReturnType)
    {
        func->SetReturnType(aReturnType);
    }
    aRtti->RegisterFunction(func);
    log::Debug("rtti.register", std::string("global=") + aName);
}
} // namespace

void RegisterTypes()
{
    log::Info("rtti.register_types", "phase=register");
}

void PostRegisterTypes()
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    RegisterGlobal(rtti, "XFBridge_Ping", &Ping, "String", {"layer", "cid"});
    RegisterGlobal(rtti, "XFBridge_Info", &Info, "String", {});
    RegisterGlobal(rtti, "XFBridge_Log", &LogFromScript, nullptr, {"layer", "level", "cid", "message"});
    RegisterGlobal(rtti, "XFBridge_Announce", &Announce, nullptr, {"layer", "detail"});
    RegisterGlobal(rtti, "XFBridge_Kill", &Kill, "Bool", {"reason"});
    log::Info("rtti.register_types", "phase=post_register natives=5");
}
} // namespace xfb::plugin
