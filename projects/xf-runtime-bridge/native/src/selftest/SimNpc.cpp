#include "selftest/SimNpc.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>
#include <set>
#include <vector>

#include "core/Npc.hpp"
#include "core/Params.hpp"

namespace xfb::selftest
{
namespace
{
using json = nlohmann::json;
using npc::Vec3;

Vec3 VecOf(const json& aValue)
{
    Vec3 out{};
    if (aValue.is_array() && aValue.size() == 3)
    {
        for (size_t i = 0; i < 3; ++i)
        {
            out[i] = aValue[i].get<double>();
        }
    }
    return out;
}

json Arr(const Vec3& aV)
{
    return json::array({aV[0], aV[1], aV[2]});
}

// A street NPC that was there before the bridge (crowd, a vendor, a quest NPC, one sitting in a workspot).
struct Street
{
    std::string id;
    std::string record;
    std::string cls;
    Vec3 position;
    bool crowd = true;
    std::vector<std::string> reasons; // protection reasons
    std::string busy;                 // "workspot", ...
    // 0.8.19 (npc.substitute): what defines the look, which way they face, and what was done to them.
    std::string appearance = "citizen__corporat_wa_01";
    std::string variant;
    std::string gender = "Female";
    double yaw = 180.0;
    std::string stubSpawner, stubEntry;
    int ordinal = -1;
    bool detached = false;
    bool removed = false;
    bool fresh = false;      // left by restore
    bool sentJoin = false;
};

struct Command
{
    std::string kind; // move, follow, turn, "" none
    std::string targetKind;
    std::string targetWho;
    Vec3 point{};
    int32_t gait = 0;
    double distance = 1.6;
    std::string state = "NotExecuting";
};

struct Actor
{
    std::string who;
    std::string kind; // actor or pick
    std::string record;
    std::string id;
    Vec3 position{};
    double yaw = 0.0;
    double spawnIn = 0.3;
    bool spawned = false;
    bool dead = false;
    bool lost = false;
    Command command;
    std::string look;
    int32_t faceCategory = 0;
    int32_t faceIdle = 0;
    std::string clip;
    std::set<int32_t> lines;
    std::string trigger; // the last voice trigger played
    std::string appearance, variant; // 0.8.19: what the polled actor wears (npc.substitute's look match)
    bool stuck = false;  // selftest.npc {stuck: who}: its walk makes no progress (npc.blocked)
    int32_t attitude = 0; // V15: 0 friendly, 1 neutral, 2 hostile
    bool immortal = true;
    bool prepared = false; // its attitude and god mode applied (ops.prepare, from the tick behind the write gate)
    int32_t prepares = 0;
};
} // namespace

struct SimNpc::State
{
    std::mutex mutex;
    SimNpcHooks hooks;
    npc::Service service;
    std::vector<Street> street{
        {"EntityID(9001)", "Character.CorpoWoman", "NPCPuppet", {104.0, 206.0, 10.0}, true, {}, ""},
        {"EntityID(9002)", "Character.CitizenVendorFood", "NPCPuppet", {96.0, 208.0, 10.0}, false, {"vendor"}, ""},
        {"EntityID(9003)", "Character.sts_quest_npc", "NPCPuppet", {100.0, 212.0, 10.0}, false, {"quest"}, ""},
        {"EntityID(9004)", "Character.LowlifeMale", "NPCPuppet", {103.0, 196.0, 10.0}, true, {}, "workspot"},
        // 0.8.19: crowd people for npc.substitute. 9005 is a plain lane walker behind V (out of her sight at yaw 0), a man whose
        // record has no matching clone; 9006 a community NPC with a stub, a woman of the corpo family, in front of V.
        {"EntityID(9005)", "Character.Citizen_Street_Man_07", "NPCPuppet", {100.0, 192.0, 10.0}, true, {}, "", "street_ma_07_a", "", "Male", 0.0},
        {"EntityID(9006)", "Character.CorpoWoman", "NPCPuppet", {98.0, 207.0, 10.0}, true, {}, "", "citizen__corporat_wa_01", "red", "Female", 90.0},
        // A community NPC (it carries the persistent stub): listed and read, never replaced.
        {"EntityID(9007)", "Character.CorpoWoman", "NPCPuppet", {96.0, 204.0, 10.0}, true, {}, "", "citizen__corporat_wa_02", "", "Female", 90.0, "EntityID(777)", "bench_sitter", 2},
    };
    std::string lookingAt;            // selftest.npc {looking_at: id}: the NPC V looks at (npc.substitute look_at)
    int32_t detaches = 0, reattaches = 0, removals = 0, restores = 0;
    std::string appearanceOverride;   // selftest.npc {appearance_override}: the engine falls back to this name for any spawn
    std::string variantOverride;
    bool removeRefuses = false;       // selftest.npc {remove_refuses}: removing the original is refused
    bool spawnNever = false;          // selftest.npc {spawn_never}: an actor never appears (spawn_now: who lets one in)
    int32_t reattachFails = 0;        // selftest.npc {reattach_fails: n}: the next n reattach calls answer "not found now"
    bool unresolvable = false;        // selftest.npc {unresolvable}: held originals cannot be found (reattach and the kill's step leave them held)
    bool stateFails = false;          // selftest.npc {state_fails}: the original's state cannot be read
    bool vFails = false;              // selftest.npc {v_fails}: V cannot be read
    bool restoreNever = false;        // selftest.npc {restore_never}: a fresh crowd person never joins the crowd
    int32_t cancelFails = 0;          // selftest.npc {cancel_fails: n}: the next n restore cancels fail
    int32_t cancels = 0;
    int32_t reattachCalls = 0;
    std::map<std::string, Actor> actors;
    std::map<int32_t, std::string> voiceLines; // voice lines showing: number -> "speaker|style"
    struct HubState
    {
        bool shown = false;
        int32_t id = 0;
        std::string who, title;
        std::vector<std::string> choices;
        int32_t answer = -1;
        std::string withdrawn; // "busy": the game's own prompt came up (selftest.npc {game_prompt: true})
    } hub;
    int32_t hubGeneration = 0;
    int32_t hubIndex = 0;
    bool codeware = true;
    bool recordsMissing = false;
    bool hubBusy = false;
    bool carrier = true;
    bool noGround = false;
    std::string failNextCommand;
    // V16: selftest.npc {sight_blocked}: every line-of-sight ray is blocked (a wall between the camera and everything);
    // {no_ground_far}: no walkable ground further than 8 m from V (so no out-of-sight spot exists).
    bool sightBlocked = false;
    bool noGroundFar = false;
    int32_t groundProbes = 0;
    double speedScale = 1.0; // selftest.npc {speed}: walk faster so tests run quickly
    uint64_t nextEntity = 5001;
    int32_t releasedAll = 0;
};

namespace
{
Vec3 PlayerPos(SimNpc::State& aState)
{
    return VecOf(aState.hooks.player().value("position", json::array({0, 0, 0})));
}

// The simulated first-person camera: at V's eyes, looking along her yaw (the game's yaw: 0 faces +Y, 90 faces -X), level.
json CameraOf(const json& aPlayer)
{
    const auto p = VecOf(aPlayer.value("position", json::array({0, 0, 0})));
    const double r = aPlayer.value("yaw", 0.0) * 3.14159265358979323846 / 180.0;
    return json{{"position", json::array({p[0], p[1], p[2] + 1.6})}, {"forward", json::array({-std::sin(r), std::cos(r), 0.0})}, {"fov", 70.0}, {"aspect", 16.0 / 9.0}};
}

npc::Ops MakeOps(SimNpc::State* aState)
{
    auto* s = aState;
    npc::Ops ops;
    ops.v = [s] {
        {
            std::scoped_lock _(s->mutex);
            if (s->vFails)
            {
                throw MethodError("not_ready", "simulated: V could not be read");
            }
        }
        auto p = s->hooks.player();
        p["phase"] = s->hooks.phase();
        p["camera"] = CameraOf(p);
        return p;
    };
    ops.ground = [s](const Vec3& aPoint) -> json {
        const auto v = PlayerPos(*s);
        std::scoped_lock _(s->mutex);
        ++s->groundProbes;
        if (s->noGroundFar && npc::HorizontalDistance(aPoint, v) > 8.0)
        {
            return json{{"walkable", false}, {"streamed", true}};
        }
        // The simulated street is one level: no walkable ground more than 2 m above or below V's.
        if (std::abs(aPoint[2] - v[2]) > 2.0)
        {
            return json{{"walkable", false}, {"streamed", true}};
        }
        return json{{"walkable", true}, {"streamed", true}, {"point", Arr({aPoint[0], aPoint[1], v[2]})}};
    };
    ops.ray = [s](const Vec3&, const Vec3&) -> json {
        std::scoped_lock _(s->mutex);
        return json{{"blocked", s->sightBlocked}};
    };
    ops.list = [s](double aRadius, int32_t aMax) {
        const auto v = PlayerPos(*s);
        std::scoped_lock _(s->mutex);
        json npcs = json::array();
        int32_t found = 0;
        for (const auto& n : s->street)
        {
            const double d = npc::Distance(n.position, v);
            if (d > aRadius || n.removed)
            {
                continue;
            }
            ++found;
            if (static_cast<int32_t>(npcs.size()) >= aMax)
            {
                continue;
            }
            npcs.push_back({{"id", n.id}, {"record", n.record}, {"class", n.cls}, {"distance", d}, {"position", Arr(n.position)}, {"appearance", n.appearance}, {"variant", n.variant}, {"yaw", n.yaw}, {"crowd", n.crowd},
                            {"protected", !n.reasons.empty()}, {"reasons", n.reasons}, {"busy", n.busy.empty() ? json(nullptr) : json(n.busy)}, {"dead", false},
                            {"pickable", n.crowd && n.reasons.empty() && n.busy.empty()}});
        }
        for (const auto& [who, a] : s->actors)
        {
            if (a.kind != "actor" || !a.spawned || a.lost)
            {
                continue;
            }
            const double d = npc::Distance(a.position, v);
            if (d > aRadius)
            {
                continue;
            }
            ++found;
            if (static_cast<int32_t>(npcs.size()) < aMax)
            {
                npcs.push_back({{"id", a.id}, {"record", a.record}, {"class", "NPCPuppet"}, {"distance", d}, {"position", Arr(a.position)}, {"crowd", false},
                                {"protected", false}, {"reasons", json::array()}, {"busy", nullptr}, {"dead", a.dead}, {"pickable", false}});
            }
        }
        return json{{"npcs", npcs}, {"found", found}, {"simulated", true}};
    };
    ops.pick = [s](const std::string& aWho, const std::string& aId) -> json {
        const auto v = PlayerPos(*s);
        std::scoped_lock _(s->mutex);
        for (const auto& n : s->street)
        {
            if (n.id != aId || n.removed)
            {
                continue;
            }
            if (!n.reasons.empty())
            {
                std::string reasons;
                for (const auto& r : n.reasons)
                {
                    reasons += (reasons.empty() ? "" : ", ") + r;
                }
                throw MethodError("npc_protected", "simulated: that NPC belongs to the game (" + reasons + "); the bridge leaves it alone");
            }
            if (!n.crowd)
            {
                throw MethodError("npc_protected", "simulated: only plain passers-by are picked; that NPC isn't one (not_crowd)");
            }
            if (!n.busy.empty())
            {
                throw MethodError("npc_busy", "simulated: that NPC is busy (" + n.busy + ")");
            }
            if (npc::Distance(n.position, v) > npc::kMaxRangeM)
            {
                throw MethodError("too_far", "simulated: that NPC is more than 40 m from V");
            }
            Actor a;
            a.who = aWho;
            a.kind = "pick";
            a.record = n.record;
            a.id = n.id;
            a.position = n.position;
            a.spawned = true;
            a.spawnIn = 0.0;
            s->actors[aWho] = a;
            return json{{"record", n.record}, {"class", n.cls}, {"crowd", n.crowd}, {"position", Arr(n.position)}, {"rig", "woman_average"}, {"label", "Stranger"}, {"simulated", true}};
        }
        throw MethodError("npc_not_found", "simulated: no NPC with that id near V (npc_list again)");
    };
    ops.spawn = [s](const std::string& aWho, const std::string& aRecord, const Vec3& aAt, double aYaw, const std::string& aAppearance, bool, int32_t aAttitude, bool aImmortal) -> json {
        std::scoped_lock _(s->mutex);
        if (!s->codeware)
        {
            throw MethodError("codeware_missing", "simulated: Codeware isn't loaded; install Codeware 1.20.5 to spawn XF actors");
        }
        if (s->recordsMissing && aRecord.rfind("Character.xfs_", 0) == 0)
        {
            throw MethodError("record_missing", "simulated: the XF actor records aren't in TweakDB (stage the -writes package with TweakXL)");
        }
        if (s->noGround)
        {
            s->noGround = false;
            throw MethodError("not_walkable", "simulated: there is no walkable ground within 2 m of that place");
        }
        s->hooks.takeSaveLock();
        Actor a;
        a.who = aWho;
        a.kind = "actor";
        a.record = aRecord;
        a.id = "EntityID(" + std::to_string(s->nextEntity++) + ")";
        a.position = aAt;
        a.yaw = aYaw;
        a.attitude = aAttitude;
        a.immortal = aImmortal;
        a.appearance = s->appearanceOverride.empty() ? aAppearance : s->appearanceOverride;
        a.variant = s->variantOverride;
        if (s->spawnNever)
        {
            a.spawnIn = 1e9;
        }
        s->actors[aWho] = a;
        return json{{"entity", a.id}, {"position", Arr(aAt)}, {"simulated", true}};
    };
    ops.command = [s](const std::string& aWho, const npc::Command& aCommand) -> json {
        std::scoped_lock _(s->mutex);
        const auto it = s->actors.find(aWho);
        if (it == s->actors.end() || it->second.lost || it->second.dead)
        {
            throw MethodError("npc_lost", "simulated: " + aWho + " isn't in the world any more");
        }
        auto& a = it->second;
        if (aCommand.kind != "stop" && !s->failNextCommand.empty())
        {
            const auto code = s->failNextCommand;
            s->failNextCommand.clear();
            throw MethodError(code, "simulated: the AI refused the command (" + code + ")");
        }
        json before{{"position", Arr(a.position)}, {"yaw", a.yaw}};
        s->hooks.takeSaveLock();
        if (aCommand.kind == "stop")
        {
            a.command = Command{};
            a.clip.clear();
            return json{{"sent", true}, {"before", before}};
        }
        if (aCommand.kind == "place")
        {
            a.position = aCommand.target.point;
            if (aCommand.hasYaw)
            {
                a.yaw = aCommand.yaw;
            }
            a.command = Command{};
            return json{{"sent", true}, {"before", before}};
        }
        Command c;
        c.kind = aCommand.kind;
        c.targetKind = npc::TargetKindName(aCommand.target.kind);
        c.targetWho = aCommand.target.who;
        c.point = aCommand.target.point;
        c.gait = aCommand.gait;
        c.distance = aCommand.distance;
        c.state = "Executing";
        a.command = c;
        return json{{"sent", true}, {"before", before}};
    };
    ops.say = [s](const std::string& aWho, const npc::Line& aLine) -> json {
        std::scoped_lock _(s->mutex);
        if (aWho.empty())
        {
            // A voice with no body.
            s->hooks.takeSaveLock();
            s->voiceLines[aLine.number] = aLine.speaker + "|" + aLine.style;
            return json{{"line_id", aLine.number}};
        }
        const auto it = s->actors.find(aWho);
        if (it == s->actors.end() || it->second.lost)
        {
            throw MethodError("npc_lost", "simulated: " + aWho + " isn't in the world any more");
        }
        s->hooks.takeSaveLock();
        if (!aLine.text.empty())
        {
            it->second.lines.insert(aLine.number);
        }
        if (!aLine.trigger.empty())
        {
            it->second.trigger = aLine.trigger;
        }
        return json{{"line_id", aLine.number}};
    };
    ops.hide = [s](const std::string& aWho, int32_t aLine) {
        std::scoped_lock _(s->mutex);
        if (aWho.empty())
        {
            s->voiceLines.erase(aLine);
        }
        const auto it = s->actors.find(aWho);
        if (it != s->actors.end())
        {
            it->second.lines.erase(aLine);
        }
        return json{{"hidden", true}};
    };
    ops.look = [s](const std::string& aWho, const npc::Target& aAt, bool aOff) -> json {
        std::scoped_lock _(s->mutex);
        const auto it = s->actors.find(aWho);
        if (it == s->actors.end() || it->second.lost)
        {
            throw MethodError("npc_lost", "simulated: " + aWho + " isn't in the world any more");
        }
        it->second.look = aOff ? std::string() : npc::TargetJson(aAt).dump();
        return json{{"looking", !aOff}};
    };
    ops.face = [s](const std::string& aWho, int32_t aCategory, int32_t aIdle) -> json {
        std::scoped_lock _(s->mutex);
        const auto it = s->actors.find(aWho);
        if (it == s->actors.end() || it->second.lost)
        {
            throw MethodError("npc_lost", "simulated: " + aWho + " isn't in the world any more");
        }
        it->second.faceCategory = aCategory;
        it->second.faceIdle = aIdle;
        return json{{"category", aCategory}, {"idle", aIdle}};
    };
    ops.act = [s](const std::string& aWho, const std::string& aClip, bool aOff) -> json {
        std::scoped_lock _(s->mutex);
        const auto it = s->actors.find(aWho);
        if (it == s->actors.end() || it->second.lost)
        {
            throw MethodError("npc_lost", "simulated: " + aWho + " isn't in the world any more");
        }
        if (!aOff && !s->carrier)
        {
            throw MethodError("carrier_missing", "simulated: the XF gesture carrier isn't loaded (stage the -writes package's archive)");
        }
        it->second.clip = aOff ? std::string() : aClip;
        return json{{"playing", !aOff}};
    };
    ops.hub = [s](const npc::Hub& aHub, bool aShow) -> json {
        const auto v = PlayerPos(*s);
        std::scoped_lock _(s->mutex);
        if (!aShow)
        {
            const bool was = s->hub.shown && s->hub.id == aHub.id;
            if (s->hub.id == aHub.id)
            {
                s->hub = SimNpc::State::HubState{};
            }
            return json{{"withdrawn", was}};
        }
        if (s->hubBusy)
        {
            throw MethodError("choices_busy", "simulated: the game shows its own dialogue choices or an interaction prompt right now");
        }
        const auto it = s->actors.find(aHub.who);
        if (it == s->actors.end() || it->second.lost)
        {
            throw MethodError("npc_lost", "simulated: " + aHub.who + " isn't in the world any more");
        }
        if (npc::Distance(it->second.position, v) > npc::kHubRangeM)
        {
            throw MethodError("too_far", "simulated: V is more than 4 m from " + aHub.who);
        }
        s->hub.shown = true;
        ++s->hubGeneration;
        s->hubIndex = 0;
        s->hub.id = aHub.id;
        s->hub.who = aHub.who;
        s->hub.title = aHub.title;
        s->hub.choices = aHub.choices;
        s->hub.answer = -1;
        s->hub.withdrawn.clear();
        return json{{"shown", true}};
    };
    ops.release = [s](const std::string& aWho, const std::string& aHow) {
        std::scoped_lock _(s->mutex);
        const auto it = s->actors.find(aWho);
        if (it != s->actors.end())
        {
            s->actors.erase(it);
        }
        return json{{"released", aWho}, {"how", aHow}};
    };
    // 0.8.19: npc.substitute's game steps.
    ops.lookedAt = [s]() -> json {
        std::scoped_lock _(s->mutex);
        if (s->lookingAt.empty())
        {
            throw MethodError("npc_not_found", "simulated: V isn't looking at an NPC");
        }
        return json{{"id", s->lookingAt}};
    };
    ops.readLook = [s](const std::string& aId) -> json {
        const auto v = PlayerPos(*s);
        std::scoped_lock _(s->mutex);
        for (const auto& n : s->street)
        {
            if (n.id != aId || n.removed)
            {
                continue;
            }
            if (!n.reasons.empty() || !n.crowd)
            {
                std::string reasons;
                for (const auto& r : n.reasons)
                {
                    reasons += (reasons.empty() ? "" : ", ") + r;
                }
                throw MethodError("npc_protected", "simulated: only plain passers-by are replaced; that NPC isn't one (" + (reasons.empty() ? std::string("not_crowd") : reasons) + ")");
            }
            if (!n.busy.empty())
            {
                throw MethodError("npc_busy", "simulated: that NPC is busy (" + n.busy + ")");
            }
            if (npc::Distance(n.position, v) > npc::kMaxRangeM)
            {
                throw MethodError("too_far", "simulated: that NPC is more than 30 m from V");
            }
            json out{{"entity", n.id}, {"record", n.record}, {"class", n.cls}, {"appearance", n.appearance}, {"variant", n.variant}, {"gender", n.gender},
                     {"body_type", n.gender}, {"crowd", n.crowd}, {"position", Arr(n.position)}, {"yaw", n.yaw}};
            if (!n.stubSpawner.empty())
            {
                out["stub"] = {{"spawner", n.stubSpawner}, {"entry", n.stubEntry}, {"ordinal", n.ordinal}};
            }
            return out;
        }
        throw MethodError("npc_not_found", "simulated: no NPC with that id near V (npc_list again)");
    };
    ops.detachOriginal = [s](const std::string& aId) -> json {
        std::scoped_lock _(s->mutex);
        for (auto& n : s->street)
        {
            if (n.id == aId && !n.removed)
            {
                n.detached = true;
                ++s->detaches;
                return json{{"detached", true}};
            }
        }
        throw MethodError("npc_not_found", "simulated: that NPC isn't near V any more");
    };
    ops.originalState = [s](const std::string& aId) -> json {
        std::scoped_lock _(s->mutex);
        if (s->stateFails)
        {
            throw MethodError("not_ready", "simulated: the original could not be read");
        }
        for (const auto& n : s->street)
        {
            if (n.id == aId && !n.removed)
            {
                return json{{"found", true}, {"position", Arr(n.position)}, {"yaw", n.yaw}, {"reasons", n.reasons}, {"community", !n.stubSpawner.empty()}};
            }
        }
        return json{{"found", false}};
    };
    ops.reattachOriginal = [s](const std::string& aId) -> json {
        std::scoped_lock _(s->mutex);
        ++s->reattachCalls;
        if (s->unresolvable || s->reattachFails > 0)
        {
            if (s->reattachFails > 0)
            {
                --s->reattachFails;
            }
            return json{{"reattached", false}, {"why", "simulated: not found now"}};
        }
        for (auto& n : s->street)
        {
            if (n.id == aId && n.detached)
            {
                n.detached = false;
                ++s->reattaches;
                return json{{"reattached", true}};
            }
        }
        return json{{"reattached", false}};
    };
    ops.removeOriginal = [s](const std::string& aId) -> json {
        std::scoped_lock _(s->mutex);
        if (s->removeRefuses)
        {
            throw MethodError("npc_protected", "simulated: the original became protected, so it was left alone");
        }
        for (auto& n : s->street)
        {
            if (n.id == aId && !n.removed)
            {
                n.removed = true;
                n.detached = false;
                ++s->removals;
                return json{{"removed", true}, {"method", "simulated"}};
            }
        }
        throw MethodError("npc_not_found", "simulated: the original isn't near V any more");
    };
    ops.restore = [s](const std::string& aRecord, const std::string& aAppearance, const Vec3& aAt, double aYaw) -> json {
        std::scoped_lock _(s->mutex);
        Street n;
        n.id = "EntityID(" + std::to_string(s->nextEntity++) + ")";
        n.record = aRecord;
        n.cls = "NPCPuppet";
        n.position = aAt;
        n.appearance = aAppearance;
        n.yaw = aYaw;
        n.fresh = true;
        s->street.push_back(n);
        ++s->restores;
        return json{{"entity", n.id}};
    };
    ops.restoreStep = [s](const std::string& aEntity, bool aSend) -> json {
        std::scoped_lock _(s->mutex);
        for (auto& n : s->street)
        {
            if (n.id == aEntity && n.fresh)
            {
                if (aSend)
                {
                    n.sentJoin = true;
                }
                return json{{"spawned", true}, {"in_crowd", n.sentJoin && !s->restoreNever}};
            }
        }
        return json{{"spawned", false}};
    };
    ops.restoreCancel = [s](const std::string& aEntity) -> json {
        std::scoped_lock _(s->mutex);
        if (s->cancelFails > 0)
        {
            --s->cancelFails;
            return json{{"cancelled", false}};
        }
        const auto before = s->street.size();
        s->street.erase(std::remove_if(s->street.begin(), s->street.end(), [&](const Street& n) { return n.fresh && n.id == aEntity; }), s->street.end());
        if (s->street.size() != before)
        {
            ++s->cancels;
        }
        return json{{"cancelled", true}};
    };
    ops.releaseAll = [s](const std::string& aReason) {
        std::scoped_lock _(s->mutex);
        const auto count = s->actors.size();
        json unresolved = json::array();
        for (auto& n : s->street)
        {
            if (n.detached && s->unresolvable)
            {
                unresolved.push_back(n.id); // stays held and owned: the caller retries
            }
            else if (n.detached)
            {
                n.detached = false;
                ++s->reattaches;
            }
        }
        s->street.erase(std::remove_if(s->street.begin(), s->street.end(), [s](const Street& n) { return n.fresh && (!n.sentJoin || s->restoreNever); }), s->street.end());
        s->actors.clear();
        s->voiceLines.clear();
        s->hub = SimNpc::State::HubState{};
        ++s->releasedAll;
        return json{{"released", count}, {"reason", aReason}, {"unresolved", unresolved}, {"simulated", true}};
    };
    ops.poll = [s](const std::string& aWhos) {
        const auto player = s->hooks.player();
        std::scoped_lock _(s->mutex);
        json npcs = json::array();
        size_t start = 0;
        while (start <= aWhos.size() && !aWhos.empty())
        {
            const auto comma = aWhos.find(',', start);
            const auto who = aWhos.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
            const auto it = s->actors.find(who);
            if (it == s->actors.end() || it->second.lost)
            {
                npcs.push_back({{"who", who}, {"exists", false}});
            }
            else
            {
                const auto& a = it->second;
                json entry{{"who", who}, {"exists", a.spawned}, {"spawned", a.spawned}, {"dead", a.dead}, {"position", Arr(a.position)}, {"yaw", a.yaw},
                           {"command_state", a.command.kind.empty() ? std::string("NotExecuting") : a.command.state}};
                if (a.kind == "actor")
                {
                    entry["prepared"] = a.prepared;
                    entry["gesture_ready"] = false; // the simulated carrier plays at once
                    entry["appearance"] = a.appearance;
                    entry["variant"] = a.variant;
                }
                else
                {
                    // A pick: the street NPC's own state now (selftest.npc {street: {id, busy, reasons}} changes it).
                    for (const auto& n : s->street)
                    {
                        if (n.id == a.id)
                        {
                            entry["busy"] = n.busy;
                            entry["protected"] = !n.reasons.empty() || !n.crowd;
                        }
                    }
                }
                npcs.push_back(entry);
            }
            if (comma == std::string::npos)
            {
                break;
            }
            start = comma + 1;
        }
        return json{{"v", {{"position", player.value("position", json::array({0, 0, 0}))}, {"busy", player.value("busy", std::string())}}},
                    {"camera", CameraOf(player)},
                    {"npcs", npcs},
                    {"hub", {{"id", s->hub.id}, {"answer", s->hub.answer}, {"shown", s->hub.shown}, {"withdrawn", s->hub.withdrawn}}}};
    };
    ops.prepare = [s](const std::string& aWho) -> json {
        std::scoped_lock _(s->mutex);
        const auto it = s->actors.find(aWho);
        if (it == s->actors.end() || it->second.lost)
        {
            throw MethodError("npc_lost", "simulated: " + aWho + " isn't in the world any more");
        }
        it->second.prepared = true;
        ++it->second.prepares;
        return json{{"prepared", true}};
    };
    ops.startAct = [](const std::string&) -> json {
        return json{{"playing", true}};
    };
    return ops;
}
} // namespace

SimNpc::SimNpc(Dispatcher& aDispatcher, SimNpcHooks aHooks)
    : m_state(std::make_unique<State>())
{
    m_state->hooks = std::move(aHooks);
    m_state->service.SetEvents(m_state->hooks.events);
    auto* s = m_state.get();
    npc::RegisterMethods(aDispatcher, s->service, [s](const std::string&) { return MakeOps(s); }, [s](MethodSpec aSpec) {
        auto fn = aSpec.fn;
        aSpec.fn = [s, fn](const MethodContext& aContext) {
            s->hooks.markWrite();
            auto out = fn(aContext);
            out["simulated"] = true;
            return out;
        };
        return aSpec;
    });
    // selftest.npc: steers the simulated street (self-test only).
    aDispatcher.Register({"selftest.npc", Access::Read, RunOn::BridgeThread, "Steers the simulated NPC street (self-test only).", [s](const MethodContext& aContext) {
                              const auto& p = aContext.params;
                              std::scoped_lock _(s->mutex);
                              if (p.contains("codeware"))
                              {
                                  s->codeware = p["codeware"].get<bool>();
                              }
                              if (p.contains("records_missing"))
                              {
                                  s->recordsMissing = p["records_missing"].get<bool>();
                              }
                              if (p.contains("game_prompt") && p["game_prompt"].get<bool>() && s->hub.shown)
                              {
                                  s->hub.shown = false; // the plugin's OnInteractionData wrap: the game's prompt comes first
                                  s->hub.withdrawn = "busy";
                              }
                              if (p.contains("reset_street"))
                              {
                                  // Every crowd person back as the street began: not removed, not held, restored people gone, counters at zero.
                                  s->street.erase(std::remove_if(s->street.begin(), s->street.end(), [](const Street& n) { return n.fresh; }), s->street.end());
                                  for (auto& n : s->street)
                                  {
                                      n.removed = false;
                                      n.detached = false;
                                  }
                                  s->detaches = s->reattaches = s->removals = s->restores = s->cancels = s->reattachCalls = 0;
                                  s->reattachFails = s->cancelFails = 0;
                                  s->unresolvable = s->stateFails = s->vFails = s->restoreNever = false;
                              }
                              if (p.contains("looking_at"))
                              {
                                  s->lookingAt = p["looking_at"].get<std::string>();
                              }
                              if (p.contains("appearance_override"))
                              {
                                  s->appearanceOverride = p["appearance_override"].get<std::string>();
                              }
                              if (p.contains("variant_override"))
                              {
                                  s->variantOverride = p["variant_override"].get<std::string>();
                              }
                              if (p.contains("remove_refuses"))
                              {
                                  s->removeRefuses = p["remove_refuses"].get<bool>();
                              }
                              if (p.contains("spawn_never"))
                              {
                                  s->spawnNever = p["spawn_never"].get<bool>();
                              }
                              if (p.contains("spawn_now"))
                              {
                                  const auto it = s->actors.find(p["spawn_now"].get<std::string>());
                                  if (it != s->actors.end())
                                  {
                                      it->second.spawnIn = 0.0;
                                      it->second.spawned = true;
                                  }
                              }
                              if (p.contains("reattach_fails"))
                              {
                                  s->reattachFails = p["reattach_fails"].get<int32_t>();
                              }
                              if (p.contains("unresolvable"))
                              {
                                  s->unresolvable = p["unresolvable"].get<bool>();
                              }
                              if (p.contains("state_fails"))
                              {
                                  s->stateFails = p["state_fails"].get<bool>();
                              }
                              if (p.contains("v_fails"))
                              {
                                  s->vFails = p["v_fails"].get<bool>();
                              }
                              if (p.contains("restore_never"))
                              {
                                  s->restoreNever = p["restore_never"].get<bool>();
                              }
                              if (p.contains("cancel_fails"))
                              {
                                  s->cancelFails = p["cancel_fails"].get<int32_t>();
                              }
                              if (p.contains("street"))
                              {
                                  const auto id = p["street"].value("id", std::string());
                                  for (auto& n : s->street)
                                  {
                                      if (n.id == id)
                                      {
                                          if (p["street"].contains("position"))
                                          {
                                              n.position = VecOf(p["street"]["position"]);
                                          }
                                          if (p["street"].contains("yaw"))
                                          {
                                              n.yaw = p["street"]["yaw"].get<double>();
                                          }
                                          if (p["street"].contains("appearance"))
                                          {
                                              n.appearance = p["street"]["appearance"].get<std::string>();
                                          }
                                          if (p["street"].contains("gender"))
                                          {
                                              n.gender = p["street"]["gender"].get<std::string>();
                                          }
                                          n.busy = p["street"].value("busy", n.busy);
                                          if (p["street"].contains("reasons"))
                                          {
                                              n.reasons = p["street"]["reasons"].get<std::vector<std::string>>();
                                          }
                                      }
                                  }
                              }
                              if (p.contains("hub_busy"))
                              {
                                  s->hubBusy = p["hub_busy"].get<bool>();
                              }
                              if (p.contains("carrier"))
                              {
                                  s->carrier = p["carrier"].get<bool>();
                              }
                              if (p.contains("no_ground"))
                              {
                                  s->noGround = p["no_ground"].get<bool>();
                              }
                              if (p.contains("speed"))
                              {
                                  s->speedScale = std::clamp(p["speed"].get<double>(), 0.1, 50.0);
                              }
                              if (p.contains("sight_blocked"))
                              {
                                  s->sightBlocked = p["sight_blocked"].get<bool>();
                              }
                              if (p.contains("no_ground_far"))
                              {
                                  s->noGroundFar = p["no_ground_far"].get<bool>();
                              }
                              if (p.contains("fail_next_command"))
                              {
                                  s->failNextCommand = p["fail_next_command"].get<std::string>();
                              }
                              if (p.contains("answer"))
                              {
                                  if (!s->hub.shown)
                                  {
                                      throw MethodError("no_hub", "simulated: no dialogue choices are showing");
                                  }
                                  s->hub.answer = p["answer"].get<int32_t>();
                              }
                              if (p.contains("kill"))
                              {
                                  const auto it = s->actors.find(p["kill"].get<std::string>());
                                  if (it != s->actors.end())
                                  {
                                      it->second.dead = true;
                                  }
                              }
                              if (p.contains("stuck"))
                              {
                                  const auto it = s->actors.find(p["stuck"].get<std::string>());
                                  if (it != s->actors.end())
                                  {
                                      it->second.stuck = true;
                                  }
                              }
                              if (p.contains("lose"))
                              {
                                  const auto it = s->actors.find(p["lose"].get<std::string>());
                                  if (it != s->actors.end())
                                  {
                                      it->second.lost = true;
                                  }
                              }
                              if (p.contains("teleport"))
                              {
                                  const auto who = p["teleport"].value("who", std::string());
                                  const auto it = s->actors.find(who);
                                  if (it != s->actors.end())
                                  {
                                      it->second.position = VecOf(p["teleport"]["position"]);
                                  }
                              }
                              json actors = json::array();
                              for (const auto& [who, a] : s->actors)
                              {
                                  actors.push_back({{"who", who},
                                                    {"kind", a.kind},
                                                    {"record", a.record},
                                                    {"spawned", a.spawned},
                                                    {"position", Arr(a.position)},
                                                    {"yaw", a.yaw},
                                                    {"command", a.command.kind},
                                                    {"command_state", a.command.state},
                                                    {"look", a.look},
                                                    {"face", {a.faceCategory, a.faceIdle}},
                                                    {"clip", a.clip},
                                                    {"lines", std::vector<int32_t>(a.lines.begin(), a.lines.end())},
                                                    {"trigger", a.trigger},
                                                    {"attitude", a.attitude},
                                                    {"immortal", a.immortal},
                                                    {"prepared", a.prepared},
                                                    {"prepares", a.prepares},
                                                    {"dead", a.dead}});
                              }
                              json voices = json::object();
                              for (const auto& [number, text] : s->voiceLines)
                              {
                                  voices["l" + std::to_string(number)] = text;
                              }
                              json street = json::array();
                              for (const auto& n : s->street)
                              {
                                  street.push_back({{"id", n.id}, {"record", n.record}, {"removed", n.removed}, {"detached", n.detached}, {"fresh", n.fresh}, {"sent_join", n.sentJoin},
                                                    {"position", Arr(n.position)}, {"yaw", n.yaw}});
                              }
                              return json{{"actors", actors},
                                          {"street", street},
                                          {"detaches", s->detaches},
                                          {"reattaches", s->reattaches},
                                          {"removals", s->removals},
                                          {"restores", s->restores},
                                          {"cancels", s->cancels},
                                          {"reattach_calls", s->reattachCalls},
                                          {"voice_lines", voices},
                                          {"hub", {{"shown", s->hub.shown}, {"id", s->hub.id}, {"title", s->hub.title}, {"choices", s->hub.choices}, {"answer", s->hub.answer}}},
                                          {"released_all", s->releasedAll},
                                          {"ground_probes", s->groundProbes}};
                          }});
}

SimNpc::~SimNpc() = default;

void SimNpc::Tick(double aDt)
{
    auto* s = m_state.get();
    const auto player = s->hooks.player();
    const auto v = VecOf(player.value("position", json::array({0, 0, 0})));
    {
        std::scoped_lock _(s->mutex);
        for (auto& [who, a] : s->actors)
        {
            if (a.kind == "actor" && !a.spawned)
            {
                a.spawnIn -= aDt;
                if (a.spawnIn <= 0.0)
                {
                    a.spawned = true;
                }
                continue;
            }
            if (a.command.kind.empty() || a.lost || a.dead)
            {
                continue;
            }
            Vec3 target = a.command.point;
            if (a.command.targetKind == "v")
            {
                target = v;
            }
            else if (a.command.targetKind == "who")
            {
                const auto other = s->actors.find(a.command.targetWho);
                if (other != s->actors.end())
                {
                    target = other->second.position;
                }
            }
            const double dx = target[0] - a.position[0], dy = target[1] - a.position[1];
            const double d = std::sqrt(dx * dx + dy * dy);
            if (a.command.kind == "turn")
            {
                a.yaw = std::atan2(-dx, dy) * 180.0 / 3.14159265358979323846;
                a.command.state = "Success";
                continue;
            }
            const double speed = a.stuck ? 0.0 : (a.command.gait == 2 ? 6.0 : a.command.gait == 1 ? 3.5 : 1.4) * s->speedScale;
            if (d <= a.command.distance)
            {
                if (a.command.kind == "move")
                {
                    a.command.state = "Success";
                }
                continue;
            }
            const double step = std::min(speed * aDt, d - a.command.distance);
            a.position[0] += dx / d * step;
            a.position[1] += dy / d * step;
            a.yaw = std::atan2(-dx, dy) * 180.0 / 3.14159265358979323846;
        }
    }
    npc::TickInput input;
    input.gateOpen = s->hooks.scriptsReady();
    input.killed = s->hooks.killed();
    input.paused = s->hooks.paused();
    input.handedOver = s->hooks.handedOver();
    input.detaches = s->hooks.detaches();
    input.writesOpen = s->hooks.writesOpen;
    s->service.Tick(aDt, input, MakeOps(s));
}

json SimNpc::ReleaseForHandover()
{
    RestoreScope restoring;
    return m_state->service.ReleaseAllNow("handover", MakeOps(m_state.get()));
}

void SimNpc::OnDetach()
{
    std::scoped_lock _(m_state->mutex);
    m_state->actors.clear();
    m_state->voiceLines.clear();
    m_state->hub = State::HubState{};
}

void SimNpc::RestoreAfterKill(json& aOut)
{
    // Always one step, even with nothing held natively (the script registry knows what it holds).
    aOut["npcs_released"] = m_state->service.RestoreAfterKill(MakeOps(m_state.get()));
}

json SimNpc::Holds()
{
    std::scoped_lock _(m_state->mutex);
    const auto count = std::count_if(m_state->actors.begin(), m_state->actors.end(), [](const auto& e) { return e.second.kind == "actor"; });
    json out = json::array();
    if (count > 0)
    {
        out.push_back(std::to_string(count) + " XF actor(s) spawned by the bridge (npc_release all)");
    }
    return out;
}
json SimNpc::InputHub()
{
    std::scoped_lock lock(m_state->mutex);
    const auto& s = *m_state;
    return {{"id", s.hub.id}, {"generation", s.hubGeneration}, {"index", s.hubIndex}, {"count", s.hub.choices.size()}, {"shown", s.hub.shown}, {"busy", s.hubBusy}};
}
json SimNpc::InputStep(int32_t hub, int32_t generation, int32_t index, bool apply)
{
    std::scoped_lock lock(m_state->mutex);
    auto& s = *m_state;
    if (!s.hub.shown || s.hubBusy || s.hub.id != hub || s.hubGeneration != generation || index < 0 || static_cast<size_t>(index) >= s.hub.choices.size())
        throw MethodError("stale_context", "The simulated XF hub changed.");
    if (apply)
    {
        if (s.hubIndex != index) throw MethodError("choice_changed", "The simulated highlight changed.");
        s.hub.answer = index; s.hub.shown = false;
    }
    else s.hubIndex = (s.hubIndex + 1) % static_cast<int32_t>(s.hub.choices.size());
    return {{"applied", apply}, {"handled", true}};
}
} // namespace xfb::selftest
