// Bridge 0.8: NPC direction (research/runtime/npc-direction-design.md). The decisions, bookkeeping, undos and events are
// core/Npc.cpp, shared with the self-test host; this file only fills its game steps with calls into the redscript layer
// (redscript/XFRuntimeBridgeNpc.reds, class XFNpc: Codeware's dynamic entities, AI commands, dialogue lines, look-ats,
// facial reactions, the XF gesture carrier and the dialogue hub). Every method runs on the game thread, where the tick runs
// too, so each step is a direct call behind the game gate (ScriptCall checks the script layer before every call).

#include <RED4ext/RED4ext.hpp>

#include "core/Npc.hpp"
#include "core/Log.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

npc::Service& Service()
{
    static npc::Service service;
    return service;
}

void TargetArgs(const npc::Target& aTarget, RED4ext::CString& aKind, RED4ext::CString& aWho, float& aX, float& aY, float& aZ)
{
    aKind = RED4ext::CString(npc::TargetKindName(aTarget.kind));
    aWho = RED4ext::CString(aTarget.who.c_str());
    aX = static_cast<float>(aTarget.point[0]);
    aY = static_cast<float>(aTarget.point[1]);
    aZ = static_cast<float>(aTarget.point[2]);
}

npc::Ops OpsFor(const std::string& aCid)
{
    npc::Ops ops;
    ops.v = [aCid] { return ScriptCall("XFNpcV", "Where", {}, {}, aCid); };
    ops.list = [aCid](double aRadius, int32_t aMax) {
        float radius = static_cast<float>(aRadius);
        int32_t max = aMax;
        return ScriptCall("XFNpc", "List", {"Float", "Int32"}, {&radius, &max}, aCid);
    };
    ops.pick = [aCid](const std::string& aWho, const std::string& aId) {
        RED4ext::CString who(aWho.c_str());
        RED4ext::CString id(aId.c_str());
        return ScriptCall("XFNpc", "Pick", {"String", "String"}, {&who, &id}, aCid);
    };
    ops.spawn = [aCid](const std::string& aWho, const std::string& aRecord, const npc::Vec3& aAt, double aYaw, const std::string& aAppearance, bool aOutOfView,
                       int32_t aAttitude, bool aImmortal) {
        RED4ext::CString who(aWho.c_str());
        RED4ext::CString record(aRecord.c_str());
        float x = static_cast<float>(aAt[0]), y = static_cast<float>(aAt[1]), z = static_cast<float>(aAt[2]), yaw = static_cast<float>(aYaw);
        RED4ext::CString appearance(aAppearance.c_str());
        bool outOfView = aOutOfView;
        int32_t attitude = aAttitude;
        bool immortal = aImmortal;
        return ScriptCall("XFNpc", "Spawn", {"String", "String", "Float", "Float", "Float", "Float", "String", "Bool", "Int32", "Bool"},
                          {&who, &record, &x, &y, &z, &yaw, &appearance, &outOfView, &attitude, &immortal}, aCid);
    };
    // V16: walkable ground near a point, and a static line-of-sight ray (XFNpcV: no Codeware needed).
    ops.ground = [aCid](const npc::Vec3& aPoint) {
        float x = static_cast<float>(aPoint[0]), y = static_cast<float>(aPoint[1]), z = static_cast<float>(aPoint[2]);
        return ScriptCall("XFNpcV", "Ground", {"Float", "Float", "Float"}, {&x, &y, &z}, aCid);
    };
    ops.ray = [aCid](const npc::Vec3& aFrom, const npc::Vec3& aTo) {
        float fx = static_cast<float>(aFrom[0]), fy = static_cast<float>(aFrom[1]), fz = static_cast<float>(aFrom[2]);
        float tx = static_cast<float>(aTo[0]), ty = static_cast<float>(aTo[1]), tz = static_cast<float>(aTo[2]);
        return ScriptCall("XFNpcV", "Ray", {"Float", "Float", "Float", "Float", "Float", "Float"}, {&fx, &fy, &fz, &tx, &ty, &tz}, aCid);
    };
    ops.command = [aCid](const std::string& aWho, const npc::Command& aCommand) {
        RED4ext::CString who(aWho.c_str());
        RED4ext::CString kind(aCommand.kind.c_str());
        RED4ext::CString targetKind, targetWho;
        float x = 0, y = 0, z = 0;
        TargetArgs(aCommand.target, targetKind, targetWho, x, y, z);
        int32_t gait = aCommand.gait;
        float distance = static_cast<float>(aCommand.distance);
        float yaw = static_cast<float>(aCommand.yaw);
        bool hasYaw = aCommand.hasYaw;
        bool faceV = aCommand.faceV;
        return ScriptCall("XFNpc", "Command",
                          {"String", "String", "String", "String", "Float", "Float", "Float", "Int32", "Float", "Float", "Bool", "Bool"},
                          {&who, &kind, &targetKind, &targetWho, &x, &y, &z, &gait, &distance, &yaw, &hasYaw, &faceV}, aCid);
    };
    ops.say = [aCid](const std::string& aWho, const npc::Line& aLine) {
        RED4ext::CString who(aWho.c_str());
        int32_t number = aLine.number;
        RED4ext::CString text(aLine.text.c_str());
        RED4ext::CString trigger(aLine.trigger.c_str());
        int32_t lineType = npc::StyleLineType(aLine.style);
        RED4ext::CString speaker(aLine.speaker.c_str());
        float seconds = static_cast<float>(aLine.seconds);
        return ScriptCall("XFNpc", "Say", {"String", "Int32", "String", "String", "Int32", "String", "Float"},
                          {&who, &number, &text, &trigger, &lineType, &speaker, &seconds}, aCid);
    };
    ops.hide = [aCid](const std::string& aWho, int32_t aLine) {
        RED4ext::CString who(aWho.c_str());
        int32_t line = aLine;
        return ScriptCall("XFNpc", "Hide", {"String", "Int32"}, {&who, &line}, aCid);
    };
    ops.look = [aCid](const std::string& aWho, const npc::Target& aAt, bool aOff) {
        RED4ext::CString who(aWho.c_str());
        RED4ext::CString targetKind, targetWho;
        float x = 0, y = 0, z = 0;
        TargetArgs(aAt, targetKind, targetWho, x, y, z);
        bool off = aOff;
        return ScriptCall("XFNpc", "Look", {"String", "String", "String", "Float", "Float", "Float", "Bool"}, {&who, &targetKind, &targetWho, &x, &y, &z, &off}, aCid);
    };
    ops.face = [aCid](const std::string& aWho, int32_t aCategory, int32_t aIdle) {
        RED4ext::CString who(aWho.c_str());
        int32_t category = aCategory, idle = aIdle;
        return ScriptCall("XFNpc", "Face", {"String", "Int32", "Int32"}, {&who, &category, &idle}, aCid);
    };
    ops.act = [aCid](const std::string& aWho, const std::string& aClip, bool aOff) {
        RED4ext::CString who(aWho.c_str());
        RED4ext::CString clip(aClip.c_str());
        bool off = aOff;
        return ScriptCall("XFNpc", "Act", {"String", "String", "Bool"}, {&who, &clip, &off}, aCid);
    };
    ops.hub = [aCid](const npc::Hub& aHub, bool aShow) {
        bool show = aShow;
        int32_t id = aHub.id;
        RED4ext::CString who(aHub.who.c_str());
        RED4ext::CString title(aHub.title.c_str());
        std::string joined;
        for (const auto& choice : aHub.choices)
        {
            joined += (joined.empty() ? "" : "\n") + choice; // choices are single lines (CleanMessageText)
        }
        RED4ext::CString choices(joined.c_str());
        return ScriptCall("XFNpc", "Hub", {"Bool", "Int32", "String", "String", "String"}, {&show, &id, &who, &title, &choices}, aCid);
    };
    ops.release = [aCid](const std::string& aWho, const std::string& aHow) {
        RED4ext::CString who(aWho.c_str());
        RED4ext::CString how(aHow.c_str());
        return ScriptCall("XFNpc", "Release", {"String", "String"}, {&who, &how}, aCid);
    };
    ops.releaseAll = [aCid](const std::string& aReason) {
        RED4ext::CString reason(aReason.c_str());
        return ScriptCall("XFNpc", "ReleaseAll", {"String"}, {&reason}, aCid);
    };
    ops.poll = [aCid](const std::string& aWhos) {
        RED4ext::CString whos(aWhos.c_str());
        return ScriptCall("XFNpc", "Poll", {"String"}, {&whos}, aCid);
    };
    return ops;
}

} // namespace

void RegisterMethodsNpc(Dispatcher& aDispatcher)
{
    Service().SetEvents(&Get().events);
    npc::RegisterMethods(aDispatcher, Service(), &OpsFor,
                         [](MethodSpec aSpec) { return MarkedWrite(aSpec.name, aSpec.access, aSpec.runOn, aSpec.summary, aSpec.fn); });
}

void TickNpc(double aDt, bool aScriptsReady)
{
    auto& state = Get();
    npc::TickInput input;
    input.gateOpen = aScriptsReady;
    if (state.bridge)
    {
        auto& dispatcher = state.bridge->GetDispatcher();
        input.killed = dispatcher.IsKilled();
        input.paused = dispatcher.WritesPaused();
        input.handedOver = dispatcher.HandedOver();
        // RB-122: the tick's one forward step (a held facing's re-turn) checks the gate right before it runs.
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
    Service().Tick(aDt, input, OpsFor("npc-tick"));
}

json ReleaseNpcsForHandover(const std::string& aCid)
{
    // A game-thread step that puts things back: run inside a RestoreScope by the caller (bridge.handover), after its flag is
    // set, so no npc write can come in between.
    return RunGameTask(
        Get().queue, GameTimeout(), [aCid] { return Service().ReleaseAllNow("handover", OpsFor(aCid)); }, "bridge.handover.npc_release");
}

void RestoreNpcAfterKill()
{
    if (!Service().Active())
    {
        return;
    }
    log::Info("bridge.kill_released_npcs", SerializeJson(Service().RestoreAfterKill(OpsFor("kill-restore"))), "kill-restore");
}
} // namespace xfb::plugin
