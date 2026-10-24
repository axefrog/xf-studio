// Bridge 0.8.12: the live-direction toolkit (research/runtime/runtime-bridge-design.md §3.21). The decisions, bookkeeping, undos
// and events are core/DmService.cpp and core/Dm080.cpp, shared with the self-test host; this file only fills their game steps
// with calls into the redscript layer (redscript-dm/XFRuntimeBridgeDm.reds, the -writes package only) and owns the watchers'
// micro-action runner, which sends each action through the dispatcher on a worker thread of its own, so every gate a client's
// request meets applies to it too. Every method and the tick run on the game thread, so each step is a direct call behind the
// game gate (ScriptCall checks the script layer before every call).

#include <Windows.h>

#include <algorithm>

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Natives/Generated/red/ResourceReferenceScriptToken.hpp>

#include "core/DmMicro.hpp"
#include "core/DmService.hpp"
#include "core/Events.hpp"
#include "core/Log.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

dm::Service& Service()
{
    static dm::Service service;
    return service;
}

std::unique_ptr<dm::MicroRunner>& MicroSlot()
{
    static std::unique_ptr<dm::MicroRunner> runner;
    return runner;
}

dm::MicroRunner& Micro()
{
    auto& slot = MicroSlot();
    if (!slot)
    {
        slot = std::make_unique<dm::MicroRunner>(
            [](const std::string& aMethod, const json& aParams, const std::string& aCid, const std::string& aToken) -> json {
                auto& state = Get();
                if (!state.bridge)
                {
                    return json{{"ok", false}, {"error", {{"code", "no_bridge"}, {"message", "the bridge is not running"}}}};
                }
                const json request{{"v", kProtocolVersion}, {"id", aCid}, {"token", aToken}, {"method", aMethod}, {"params", aParams}, {"cid", aCid}};
                const auto handled = state.bridge->GetDispatcher().Handle(request.dump(), GetCurrentProcessId());
                return json::parse(handled.line, nullptr, false);
            },
            [](const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData) {
                Get().events.Push("dm." + aKind, aLevel, "dm", aText, aData);
            });
    }
    return *slot;
}

// Optional numbers and flags as the script takes them: a number below zero (or -1 for a flag) is "unchanged".
float Opt(const std::optional<double>& aValue)
{
    return aValue ? static_cast<float>(*aValue) : -1.0f;
}
int32_t Tri(const std::optional<bool>& aValue)
{
    return aValue ? (*aValue ? 1 : 0) : -1;
}

// A ResRef is the path's hash (RaRef<CResource>); redscript has no string-to-ResRef conversion at run time.
RED4ext::red::ResourceReferenceScriptToken ResRefOf(const std::string& aPath)
{
    RED4ext::red::ResourceReferenceScriptToken path;
    if (!aPath.empty())
    {
        path.resource = RED4ext::RaRef<RED4ext::CResource>(RED4ext::ResourcePath(aPath.c_str()));
    }
    return path;
}

dm::Ops OpsFor(const std::string& aCid)
{
    dm::Ops ops;
    ops.v = [aCid] { return ScriptCall("XFNpcV", "Where", {}, {}, aCid); };
    ops.spawn = [aCid](const dm::SpawnStep& aStep) {
        RED4ext::CString kind(aStep.kind.c_str());
        auto path = ResRefOf(aStep.templatePath);
        RED4ext::CString record(aStep.record.c_str());
        RED4ext::CString appearance(aStep.appearance.c_str());
        float x = static_cast<float>(aStep.at[0]), y = static_cast<float>(aStep.at[1]), z = static_cast<float>(aStep.at[2]);
        float yaw = static_cast<float>(aStep.yaw);
        bool ground = aStep.ground;
        int32_t handle = aStep.handle;
        return ScriptCall("XFDmSpawn", "Spawn",
                          {"String", "redResourceReferenceScriptToken", "String", "String", "Float", "Float", "Float", "Float", "Bool", "Int32"},
                          {&kind, &path, &record, &appearance, &x, &y, &z, &yaw, &ground, &handle}, aCid);
    };
    ops.despawn = [aCid](const std::string& aEntity) {
        RED4ext::CString entity(aEntity.c_str());
        return ScriptCall("XFDmSpawn", "Despawn", {"String"}, {&entity}, aCid);
    };
    ops.door = [aCid](const dm::DoorStep& aStep) {
        RED4ext::CString target(aStep.target.c_str());
        int32_t open = Tri(aStep.open), locked = Tri(aStep.locked), sealed = Tri(aStep.sealed);
        return ScriptCall("XFDmWorld", "Door", {"String", "Int32", "Int32", "Int32"}, {&target, &open, &locked, &sealed}, aCid);
    };
    ops.vehicle = [aCid](const dm::VehicleStep& aStep) {
        RED4ext::CString target(aStep.target.c_str());
        int32_t lights = Tri(aStep.lights), engine = Tri(aStep.engine);
        RED4ext::CString door(aStep.door.c_str());
        RED4ext::CString state(aStep.doorState.c_str());
        return ScriptCall("XFDmWorld", "Vehicle", {"String", "Int32", "Int32", "String", "String"}, {&target, &lights, &engine, &door, &state}, aCid);
    };
    ops.audioPlay = [aCid](const std::string& aEvent, const std::string& aOn, const std::string& aEmitter) {
        RED4ext::CString event(aEvent.c_str()), on(aOn.c_str()), emitter(aEmitter.c_str());
        return ScriptCall("XFDmWorld", "Play", {"String", "String", "String"}, {&event, &on, &emitter}, aCid);
    };
    ops.audioStop = [aCid](const std::string& aEvent, const std::string& aOn, const std::string& aEmitter) {
        RED4ext::CString event(aEvent.c_str()), on(aOn.c_str()), emitter(aEmitter.c_str());
        return ScriptCall("XFDmWorld", "Stop", {"String", "String", "String"}, {&event, &on, &emitter}, aCid);
    };
    ops.radio = [aCid](const dm::RadioStep& aStep) {
        RED4ext::CString target(aStep.target.c_str());
        int32_t station = aStep.station ? *aStep.station : -1;
        int32_t on = Tri(aStep.on);
        return ScriptCall("XFDmWorld", "Radio", {"String", "Int32", "Int32"}, {&target, &station, &on}, aCid);
    };
    ops.voice = [aCid](const std::string& aTarget, const std::string& aContext) {
        RED4ext::CString target(aTarget.c_str()), context(aContext.c_str());
        return ScriptCall("XFDmWorld", "Voice", {"String", "String"}, {&target, &context}, aCid);
    };
    ops.lightSpawn = [aCid](const dm::LightStep& aStep) {
        auto path = ResRefOf(aStep.templatePath);
        bool carrier = aStep.templatePath.empty();
        float x = static_cast<float>(aStep.at[0]), y = static_cast<float>(aStep.at[1]), z = static_cast<float>(aStep.at[2]);
        float yaw = static_cast<float>(aStep.yaw);
        int32_t red = aStep.colour[0], green = aStep.colour[1], blue = aStep.colour[2];
        float intensity = static_cast<float>(aStep.intensity), radius = static_cast<float>(aStep.radius);
        float inner = Opt(aStep.inner), outer = Opt(aStep.outer);
        int32_t handle = aStep.handle;
        return ScriptCall("XFDmSpawn", "LightSpawn",
                          {"redResourceReferenceScriptToken", "Bool", "Float", "Float", "Float", "Float", "Int32", "Int32", "Int32", "Float", "Float", "Float", "Float", "Int32"},
                          {&path, &carrier, &x, &y, &z, &yaw, &red, &green, &blue, &intensity, &radius, &inner, &outer, &handle}, aCid);
    };
    ops.lightSet = [aCid](const dm::LightSetStep& aStep) {
        RED4ext::CString entity(aStep.entity.c_str());
        int32_t red = aStep.colour ? (*aStep.colour)[0] : -1, green = aStep.colour ? (*aStep.colour)[1] : 0, blue = aStep.colour ? (*aStep.colour)[2] : 0;
        float intensity = Opt(aStep.intensity), radius = Opt(aStep.radius), inner = Opt(aStep.inner), outer = Opt(aStep.outer);
        int32_t on = Tri(aStep.on);
        float flicker = Opt(aStep.flickerStrength), period = static_cast<float>(aStep.flickerPeriod), fade = static_cast<float>(aStep.fadeS);
        return ScriptCall("XFDmLight", "Set",
                          {"String", "Int32", "Int32", "Int32", "Float", "Float", "Float", "Float", "Int32", "Float", "Float", "Float"},
                          {&entity, &red, &green, &blue, &intensity, &radius, &inner, &outer, &on, &flicker, &period, &fade}, aCid);
    };
    ops.lightIntensity = [aCid](const std::string& aEntity, double aIntensity) {
        RED4ext::CString entity(aEntity.c_str());
        float intensity = static_cast<float>(aIntensity);
        ScriptCall("XFDmLight", "Intensity", {"String", "Float"}, {&entity, &intensity}, aCid);
    };
    ops.notify = [aCid](const dm::NotifyRequest& aRequest) {
        RED4ext::CString style(aRequest.style.c_str()), title(aRequest.title.c_str()), text(aRequest.text.c_str());
        float seconds = static_cast<float>(aRequest.seconds);
        return ScriptCall("XFDmHud", "Notify", {"String", "String", "String", "Float"}, {&style, &title, &text, &seconds}, aCid);
    };
    ops.notifyHide = [aCid](const std::string& aStyle) {
        RED4ext::CString style(aStyle.c_str());
        return ScriptCall("XFDmHud", "NotifyHide", {"String"}, {&style}, aCid);
    };
    ops.phoneText = [aCid](const std::string& aContact, const std::string& aText) {
        RED4ext::CString contact(aContact.c_str()), text(aText.c_str());
        return ScriptCall("XFDmPhone", "Text", {"String", "String"}, {&contact, &text}, aCid);
    };
    ops.phoneContacts = [aCid] { return ScriptCall("XFDmPhone", "Contacts", {}, {}, aCid); };
    ops.presence = [aCid](const std::map<std::string, std::string>& entities) {
        std::string joined;
        for (const auto& [key, id] : entities) joined += (joined.empty() ? "" : ",") + key + "=" + id;
        RED4ext::CString text(joined.c_str());
        return ScriptCall("XFDmSense", "Presence", {"String"}, {&text}, aCid);
    };
    ops.sample = [aCid](const dm::SampleWants& aWants, const std::map<std::string, std::string>& aEntities) {
        std::string wants;
        const auto add = [&wants](const std::string& aToken) { wants += (wants.empty() ? "" : ",") + aToken; };
        if (aWants.lookAt)
        {
            add("look");
        }
        if (aWants.occlusion)
        {
            add("occ");
        }
        if (aWants.events)
        {
            add("events");
        }
        if (!aWants.callContact.empty())
        {
            add("call:" + aWants.callContact);
        }
        std::string entities;
        for (const auto& [key, id] : aEntities)
        {
            entities += (entities.empty() ? "" : ",") + key + "=" + id;
        }
        RED4ext::CString wantsText(wants.c_str()), entitiesText(entities.c_str());
        return ScriptCall("XFDmSense", "Sample", {"String", "String"}, {&wantsText, &entitiesText}, aCid);
    };
    ops.showLine = [aCid](const dm::TimedLine& aLine) {
        int32_t number = static_cast<int32_t>(aLine.id & 0xFFFFFFFFULL);
        int32_t type = aLine.type;
        RED4ext::CString speaker(aLine.speaker.c_str()), text(aLine.text.c_str());
        float seconds = static_cast<float>(std::max(0.5, aLine.end - aLine.start));
        ScriptCall("XFDmLines", "Show", {"Int32", "Int32", "String", "String", "Float"}, {&number, &type, &speaker, &text, &seconds}, aCid);
    };
    ops.hideLine = [aCid](uint64_t aLineId) {
        int32_t number = static_cast<int32_t>(aLineId & 0xFFFFFFFFULL);
        ScriptCall("XFDmLines", "Hide", {"Int32"}, {&number}, aCid);
    };
    ops.callRing = [aCid](const std::string& aContact, const std::string& aMode, bool aRejectable) {
        RED4ext::CString contact(aContact.c_str()), mode(aMode.c_str());
        bool rejectable = aRejectable;
        ScriptCall("XFDmPhone", "Ring", {"String", "String", "Bool"}, {&contact, &mode, &rejectable}, aCid);
    };
    ops.callStart = [aCid](const std::string& aContact, const std::string& aMode) {
        RED4ext::CString contact(aContact.c_str()), mode(aMode.c_str());
        ScriptCall("XFDmPhone", "Start", {"String", "String"}, {&contact, &mode}, aCid);
    };
    ops.callEnd = [aCid](const std::string& aContact) {
        RED4ext::CString contact(aContact.c_str());
        return ScriptCall("XFDmPhone", "End", {"String"}, {&contact}, aCid).value("ended", false);
    };
    ops.tracker = [aCid](const std::vector<dm::Quest>& aQuests) {
        // The quest's title, then one line per objective: state, a tab, "o" for optional or "-", a tab, the words.
        std::string spec;
        if (!aQuests.empty())
        {
            const auto& quest = aQuests.front();
            spec = quest.title;
            for (const auto& objective : quest.objectives)
            {
                if (objective.state == "hidden")
                {
                    continue;
                }
                spec += "\n" + objective.state + "\t" + (objective.optional ? "o" : "-") + "\t" + objective.text;
            }
        }
        RED4ext::CString text(spec.c_str());
        ScriptCall("XFDmHud", "Tracker", {"String"}, {&text}, aCid);
    };
    ops.releaseAll = [aCid](const std::string& aReason, int32_t aRemovedBefore) {
        RED4ext::CString reason(aReason.c_str());
        return ScriptCall("XFDmSense", "ReleaseAll", {"String", "Int32"}, {&reason, &aRemovedBefore}, aCid);
    };
    ops.digest = [aCid](bool aSky) {
        bool sky = aSky;
        return ScriptCall("XFDmSense", "Digest", {"Bool"}, {&sky}, aCid);
    };
    ops.micro = [](dm::MicroBatch aBatch) {
        aBatch.sessionToken = Get().session.token;
        Micro().Enqueue(std::move(aBatch));
    };
    ops.microCancel = [](const std::string& aWhy) { return MicroSlot() ? MicroSlot()->Cancel(aWhy) : size_t{0}; };
    ops.microCancelWatch = [](const std::string& aWatch) { return MicroSlot() ? MicroSlot()->CancelWatch(aWatch) : size_t{0}; };
    ops.microPending = [] { return MicroSlot() ? MicroSlot()->Pending() : size_t{0}; };
    ops.actionCheck = [](const std::string& aMethod) -> std::string {
        auto& state = Get();
        if (!state.bridge)
        {
            return "the bridge is not running";
        }
        const auto access = state.bridge->GetDispatcher().AccessOf(aMethod);
        if (!access)
        {
            return "no such bridge method";
        }
        if (!dm::MicroAccessAllowed(std::string(AccessName(*access))))
        {
            return "its class (" + std::string(AccessName(*access)) + ") can't run from a watcher";
        }
        return {};
    };
    return ops;
}
} // namespace

void RegisterMethodsDm(Dispatcher& aDispatcher)
{
    Service().SetEvents(&Get().events);
    Service().SetOpsFor(&OpsFor);
    dm::RegisterMethods(aDispatcher, Service(), [](MethodSpec aSpec) { return MarkedWrite(aSpec.name, aSpec.access, aSpec.runOn, aSpec.summary, aSpec.fn); });
}

void TickDm(double aDt, bool aScriptsReady)
{
    auto& state = Get();
    dm::TickInput input;
    input.gateOpen = aScriptsReady;
    if (state.bridge)
    {
        auto& dispatcher = state.bridge->GetDispatcher();
        input.killed = dispatcher.IsKilled();
        input.paused = dispatcher.WritesPaused();
        input.handedOver = dispatcher.HandedOver();
        // RB-122: the tick's forward steps check the write gate right before they run.
        input.writesOpen = [&dispatcher] {
            try
            {
                dispatcher.RequireWritesOpen();
                return true;
            }
            catch (const MethodError&)
            {
                return false;
            }
        };
    }
    input.detaches = state.scriptLayer.Describe().value("detaches", uint64_t{0});
    Service().Tick(aDt, input);
}

json ReleaseDmForHandover(const std::string& aCid)
{
    // A game-thread step that puts things back: run inside a RestoreScope by the caller (bridge.handover), after its flag is set,
    // so no dm write can come in between.
    return RunGameTask(
        Get().queue, GameTimeout(), [aCid] { return Service().ReleaseAllNow("handover", OpsFor(aCid)); }, "bridge.handover.dm_release");
}

void RestoreDmAfterKill()
{
    log::Info("bridge.kill_released_dm", SerializeJson(Service().RestoreAfterKill(OpsFor("kill-restore"))), "kill-restore");
}

json DmHolds()
{
    return Service().Holds();
}

json DmGuardPresent()
{
    return Service().Present(OpsFor("action-guard"));
}

void StopDm()
{
    if (MicroSlot())
    {
        MicroSlot()->Stop();
    }
}
} // namespace xfb::plugin
