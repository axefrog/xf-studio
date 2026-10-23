// The senses for the Story Engine (research/story-engine/runtime-requirements.md S2 to S6): world.facts, world.district,
// player.status, and scene.read's npc_detail. Read-only: nothing here changes the game. Every game call goes through the
// redscript layer (XFSenses; ScriptCall: a caller frame and a context, the game gate checked by the dispatcher right before
// a game-thread method); parameters are core/Senses.cpp, shared with the self-test host.

#include <RED4ext/RED4ext.hpp>

#include "core/Log.hpp"
#include "core/Scene.hpp"
#include "core/Senses.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;
namespace s = xfb::senses;

json WorldFacts(const MethodContext& aContext)
{
    const auto request = s::ParseFacts(aContext.params);
    RED4ext::CString names(s::Csv(request.facts).c_str());
    auto out = ScriptCall("XFSenses", "Facts", {"String"}, {&names}, aContext.cid);
    s::FinishFacts(out, request.facts.size());
    return out;
}

json WorldDistrict(const MethodContext& aContext)
{
    s::ParseDistrict(aContext.params);
    return ScriptCall("XFSenses", "District", {}, {}, aContext.cid);
}

json PlayerStatus(const MethodContext& aContext)
{
    const auto request = s::ParseStatus(aContext.params);
    std::string joined;
    for (const auto& part : request.parts)
    {
        joined += (joined.empty() ? "" : ",") + part;
    }
    RED4ext::CString parts(joined.c_str());
    return ScriptCall("XFSenses", "Status", {"String"}, {&parts}, aContext.cid);
}
} // namespace

// scene.read's npc_detail (Handlers060.cpp calls this on the answer it built): one script call for all the distinct character
// records of the rows, each row given its "character" (null when the game has no such record).
void AddNpcDetail(nlohmann::json& aOut, bool aWanted, const std::string& aCid)
{
    if (!aWanted)
    {
        return;
    }
    aOut["npc_detail"] = true;
    if (!aOut.contains("npcs"))
    {
        return;
    }
    const auto records = s::NpcRecords(aOut["npcs"]);
    nlohmann::json characters = nlohmann::json::object();
    if (!records.empty())
    {
        RED4ext::CString csv(s::Csv(records).c_str());
        const auto detail = ScriptCall("XFSenses", "Characters", {"String"}, {&csv}, aCid);
        characters = detail.value("characters", nlohmann::json::object());
    }
    s::MergeNpcDetail(aOut["npcs"], characters);
}

void RegisterMethodsSenses(Dispatcher& aDispatcher)
{
    aDispatcher.Register({"world.facts", Access::Read, RunOn::GameThread, "Up to 128 named quest facts in one read.", &WorldFacts});
    aDispatcher.Register({"world.district", Access::Read, RunOn::GameThread, "V's district, subdistrict and place from the game's district system.", &WorldDistrict});
    aDispatcher.Register({"player.status", Access::Read, RunOn::GameThread, "V's health, level, street cred, money, wanted level, vehicle, inventory summary and scanner.", &PlayerStatus});
}
} // namespace xfb::plugin
