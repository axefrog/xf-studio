// Unit checks for bridge 0.8.19's npc.substitute (core/NpcSubstitute.cpp) against fake game steps: the look reading and cast
// matching, the look_match report and its confirmation, the resident key, the swap order (the original held, the actor requested,
// the original removed only once the actor stands there), waiting for a moment V cannot see, every way a swap is undone, the
// five-actor bound, restore, and the refusals. Part of `xfb_selftest --unit`.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <set>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/Dispatcher.hpp"
#include "core/Events.hpp"
#include "core/Npc.hpp"

namespace
{
using json = nlohmann::json;
namespace n = xfb::npc;

int gFailures = 0;

void Check(const char* aName, bool aOk, const std::string& aDetail = {})
{
    if (!aOk)
    {
        ++gFailures;
    }
    std::printf("%s unit: npc substitute %s%s%s\n", aOk ? "PASS" : "FAIL", aName, aDetail.empty() ? "" : " ", aDetail.c_str());
    std::fflush(stdout);
}

std::string CodeOf(const std::function<void()>& aFn)
{
    try
    {
        aFn();
    }
    catch (const xfb::MethodError& e)
    {
        return e.code;
    }
    catch (const std::exception& e)
    {
        return std::string("other:") + e.what();
    }
    return "";
}

std::vector<json> Events(xfb::EventLog& aLog, const std::string& aKind)
{
    std::vector<json> out;
    const auto read = aLog.Read(0, 1000, {aKind});
    for (const auto& e : read["events"])
    {
        out.push_back(e);
    }
    return out;
}

// V at the origin facing +Y with a camera at her eyes: a person at (0, 10) is in view, one at (0, -10) is behind her.
struct Fake
{
    std::vector<std::string> calls;
    json v = json{{"phase", "gameplay"}, {"position", {0.0, 0.0, 0.0}}, {"yaw", 0.0}, {"busy", ""},
                  {"camera", {{"position", {0.0, 0.0, 1.6}}, {"forward", {0.0, 1.0, 0.0}}, {"fov", 70.0}, {"aspect", 1.7777}}}};
    std::map<std::string, json> street; // id -> readLook answer
    std::map<std::string, json> npcs;   // who -> poll row
    std::set<std::string> held;         // originals held still
    std::set<std::string> removed;
    std::string lookedAt;
    bool spawnThrows = false, removeThrows = false;
    std::vector<std::string> restored;
    bool inCrowd = false;
    int nextEntity = 100;
    // 0.8.19 (review fixes)
    bool vThrows = false;                 // V cannot be read
    bool stateThrows = false;             // the original's state cannot be read
    int reattachFails = 0;                // the next n reattach calls answer "not found now"
    std::set<std::string> unresolvable;   // originals that cannot be found: reattach answers false, the kill step leaves them held
    bool restoreNever = false;            // a fresh crowd person never joins the crowd
    int cancelFails = 0;                  // the next n restore cancels fail (a negative number: every one fails)
    std::string removeCode = "npc_protected";

    static json Person(const std::string& aId, const std::string& aRecord, const std::string& aAppearance, const std::string& aGender, double aY, double aYaw = 90.0)
    {
        return json{{"entity", aId}, {"record", aRecord}, {"class", "NPCPuppet"}, {"appearance", aAppearance}, {"variant", ""}, {"gender", aGender}, {"body_type", aGender},
                    {"crowd", true}, {"position", {0.0, aY, 0.0}}, {"yaw", aYaw}};
    }
    void Appear(const std::string& aWho, const std::string& aAppearance, const std::string& aVariant = "")
    {
        auto& row = npcs[aWho];
        row["exists"] = true;
        row["spawned"] = true;
        row["appearance"] = aAppearance;
        row["variant"] = aVariant;
        row["yaw"] = row.value("asked_yaw", 0.0);
    }
    int Index(const std::string& aPrefix) const
    {
        for (size_t i = 0; i < calls.size(); ++i)
        {
            if (calls[i].rfind(aPrefix, 0) == 0)
            {
                return static_cast<int>(i);
            }
        }
        return -1;
    }
    int Count(const std::string& aPrefix) const
    {
        int c = 0;
        for (const auto& call : calls)
        {
            c += call.rfind(aPrefix, 0) == 0 ? 1 : 0;
        }
        return c;
    }
    n::Ops Ops()
    {
        n::Ops ops;
        ops.v = [this]() -> json {
            if (vThrows)
            {
                throw xfb::MethodError("not_ready", "V could not be read");
            }
            return v;
        };
        ops.originalState = [this](const std::string& aId) -> json {
            calls.push_back("originalState " + aId);
            if (stateThrows)
            {
                throw xfb::MethodError("not_ready", "the original could not be read");
            }
            const auto it = street.find(aId);
            if (it == street.end() || removed.count(aId))
            {
                return json{{"found", false}};
            }
            return json{{"found", true}, {"position", it->second["position"]}, {"yaw", it->second.value("yaw", 0.0)},
                        {"reasons", it->second.contains("reasons") ? it->second["reasons"] : json::array()}, {"community", it->second.contains("stub")}};
        };
        ops.pick = [this](const std::string& aWho, const std::string&) -> json {
            calls.push_back("pick " + aWho);
            return json{{"record", "Character.CorpoWoman"}, {"position", {0.0, -10.0, 0.0}}};
        };
        ops.lookedAt = [this]() -> json {
            calls.push_back("lookedAt");
            if (lookedAt.empty())
            {
                throw xfb::MethodError("npc_not_found", "V isn't looking at an NPC");
            }
            return json{{"id", lookedAt}};
        };
        ops.readLook = [this](const std::string& aId) -> json {
            calls.push_back("readLook " + aId);
            const auto it = street.find(aId);
            if (it == street.end() || removed.count(aId))
            {
                throw xfb::MethodError("npc_not_found", "no NPC with that id is near V now");
            }
            if (it->second.contains("refuse"))
            {
                throw xfb::MethodError(it->second["refuse"].get<std::string>(), "refused by the game step");
            }
            return it->second;
        };
        ops.detachOriginal = [this](const std::string& aId) -> json {
            calls.push_back("detach " + aId);
            held.insert(aId);
            return json{{"detached", true}};
        };
        ops.reattachOriginal = [this](const std::string& aId) -> json {
            calls.push_back("reattach " + aId);
            if (unresolvable.count(aId) || reattachFails > 0)
            {
                if (reattachFails > 0)
                {
                    --reattachFails;
                }
                return json{{"reattached", false}};
            }
            held.erase(aId);
            return json{{"reattached", true}};
        };
        ops.removeOriginal = [this](const std::string& aId) -> json {
            calls.push_back("remove " + aId);
            if (removeThrows)
            {
                throw xfb::MethodError(removeCode, "the original became protected");
            }
            removed.insert(aId);
            held.erase(aId);
            return json{{"removed", true}, {"method", "fake"}};
        };
        ops.spawn = [this](const std::string& aWho, const std::string& aRecord, const n::Vec3& aAt, double aYaw, const std::string& aAppearance, bool aOutOfView, int32_t, bool) -> json {
            calls.push_back("spawn " + aWho + " " + aRecord + " " + aAppearance + (aOutOfView ? " out_of_view" : " in_view"));
            if (spawnThrows)
            {
                throw xfb::MethodError("spawn_refused", "the game's entity spawner refused the actor");
            }
            npcs[aWho] = json{{"who", aWho}, {"exists", false}, {"spawned", false}, {"position", {aAt[0], aAt[1], aAt[2]}}, {"asked_yaw", aYaw}};
            return json{{"entity", "E-" + aWho}, {"position", {aAt[0], aAt[1], aAt[2]}}};
        };
        ops.release = [this](const std::string& aWho, const std::string& aHow) -> json {
            calls.push_back("release " + aWho + " " + aHow);
            npcs.erase(aWho);
            return json::object();
        };
        ops.releaseAll = [this](const std::string& aReason) -> json {
            calls.push_back("releaseAll " + aReason);
            npcs.clear();
            json unresolved = json::array();
            for (const auto& id : std::set<std::string>(held))
            {
                if (unresolvable.count(id))
                {
                    unresolved.push_back(id);
                    continue;
                }
                calls.push_back("reattach " + id);
                held.erase(id);
            }
            return json{{"released", 1}, {"unresolved", unresolved}};
        };
        ops.command = [this](const std::string& aWho, const n::Command& aCommand) -> json {
            calls.push_back("command " + aWho + " " + aCommand.kind);
            return json{{"sent", true}, {"before", {{"position", {0.0, 0.0, 0.0}}, {"yaw", 0.0}}}};
        };
        ops.poll = [this](const std::string& aWhos) -> json {
            json list = json::array();
            size_t start = 0;
            while (!aWhos.empty() && start <= aWhos.size())
            {
                const auto comma = aWhos.find(',', start);
                const auto who = aWhos.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
                const auto it = npcs.find(who);
                list.push_back(it == npcs.end() ? json{{"who", who}, {"exists", false}} : it->second);
                if (comma == std::string::npos)
                {
                    break;
                }
                start = comma + 1;
            }
            return json{{"v", v}, {"camera", v["camera"]}, {"npcs", list}, {"hub", json{{"id", 0}, {"answer", -1}}}};
        };
        ops.prepare = [this](const std::string&) -> json { return json::object(); };
        ops.restore = [this](const std::string& aRecord, const std::string& aAppearance, const n::Vec3& aAt, double aYaw) -> json {
            calls.push_back("restore " + aRecord + " " + aAppearance + " at " + std::to_string(static_cast<int>(aAt[1])));
            restored.push_back(aRecord);
            (void)aYaw;
            return json{{"entity", "R-" + std::to_string(nextEntity++)}};
        };
        ops.restoreStep = [this](const std::string&, bool aSend) -> json {
            calls.push_back(std::string("restoreStep") + (aSend ? " send" : ""));
            return json{{"spawned", true}, {"in_crowd", !restoreNever && (inCrowd || aSend)}};
        };
        ops.restoreCancel = [this](const std::string& aEntity) -> json {
            calls.push_back("restoreCancel " + aEntity);
            if (cancelFails != 0)
            {
                if (cancelFails > 0)
                {
                    --cancelFails;
                }
                return json{{"cancelled", false}};
            }
            return json{{"cancelled", true}};
        };
        return ops;
    }
};

void Step(n::Service& aService, const n::Ops& aOps, double aSeconds, n::TickInput aInput = {})
{
    for (double t = 0.0; t < aSeconds; t += 0.3)
    {
        aService.Tick(0.3, aInput, aOps);
    }
}

void PureTests()
{
    using L = n::OriginalLook;
    auto look = [](const std::string& aRecord, const std::string& aAppearance, const std::string& aGender) {
        L l;
        l.record = aRecord;
        l.appearance = aAppearance;
        l.gender = aGender;
        return l;
    };
    const auto exact = n::MatchLook(look("Character.CorpoWoman", "citizen__corporat_wa_01", "Female"), "");
    Check("match: the very record the cast is a clone of is exact", exact.cast == "woman_corpo" && exact.report["expected_level"] == "exact" && exact.report["record"]["match"] == "clone_of_same_record");
    Check("match: the original's appearance is asked for verbatim", exact.appearance == "citizen__corporat_wa_01" && exact.report["appearance"]["requested"] == "citizen__corporat_wa_01");
    const auto family = n::MatchLook(look("Character.Corpo_Woman_Citizen_4", "corpo_wa_07", "Female"), "");
    Check("match: another corpo record is the same family: close", family.cast == "woman_corpo" && family.report["expected_level"] == "close" && family.report["record"]["match"] == "same_family");
    const auto gender = n::MatchLook(look("Character.Citizen_Street_Man_07", "street_ma_07_a", "Male"), "");
    Check("match: no family known: the street default of the gender, approximate", gender.cast == "man_lowlife" && gender.report["expected_level"] == "approximate" && gender.report["record"]["match"] == "gender_only");
    const auto nearest = n::MatchLook(look("Character.Nightlife_Male_3", "nightlife_ma_03", "Male"), "");
    Check("match: a family with no cast of that gender borrows the nearest body: approximate", nearest.cast == "man_youngster" && nearest.report["record"]["match"] == "nearest_in_family" && nearest.report["expected_level"] == "approximate");
    Check("match: the creole woman is the masked cast's template", n::MatchLook(look("Character.CreoleWoman", "citizen__creole_wa_caribbean_29", "Female"), "").cast == "woman_masked");
    const auto fromNames = n::MatchLook(look("Character.Lowlife_Male_x", "king_of_the_stoop_ma_012", ""), "");
    Check("match: with no game gender, the template-style names decide", fromNames.cast == "man_lowlife");
    Check("match: a person whose gender can't be told is unmatched", CodeOf([&] { n::MatchLook(look("Character.Something", "x", ""), ""); }) == "look_unmatched");
    Check("match: a cast named by the caller is used", n::MatchLook(look("Character.Something", "x", ""), "woman_nightlife").cast == "woman_nightlife");
    Check("match: fighters and research casts can't stand in", CodeOf([&] { n::MatchLook(look("Character.X", "x", "Male"), "fighter_melee"); }) == "cast_unknown" && CodeOf([&] { n::MatchLook(look("Character.X", "x", "Male"), "research_crowd_record"); }) == "cast_unknown");
    Check("match: the report lists what is not attempted", exact.report["not_matched"].size() >= 3 && exact.report["level"].is_null() && exact.report["confirmed"] == false);

    L original = look("Character.CorpoWoman", "citizen__corporat_wa_01", "Female");
    original.position = {1.0, 2.0, 0.0};
    original.yaw = 90.0;
    original.variant = "red";
    const auto good = n::ConfirmLook(exact.report, original, "citizen__corporat_wa_01", "red", {1.2, 2.0, 0.0}, 95.0);
    Check("confirm: the same appearance and variant keep the expected level", good["level"] == "exact" && good["confirmed"] == true && good["appearance"]["match"] == "exact" && good["colour_variant"]["match"] == "exact");
    Check("confirm: how far it moved and how far it turned", std::abs(good["position"]["moved_m"].get<double>() - 0.2) < 1e-9 && std::abs(good["heading"]["difference_deg"].get<double>() - 5.0) < 1e-9);
    const auto fell = n::ConfirmLook(exact.report, original, "some_other_look", "red", {1.0, 2.0, 0.0}, 90.0);
    Check("confirm: an appearance the template fell back from is approximate", fell["level"] == "approximate" && fell["appearance"]["match"] == "fell_back");
    const auto variant = n::ConfirmLook(exact.report, original, "citizen__corporat_wa_01", "blue", {1.0, 2.0, 0.0}, 90.0);
    Check("confirm: a different colour variant downgrades exact to close", variant["level"] == "close" && variant["colour_variant"]["match"] == "different");
    const auto unread = n::ConfirmLook(exact.report, original, "", "", {1.0, 2.0, 0.0}, 90.0);
    Check("confirm: an appearance the game did not report leaves it unconfirmed", unread["confirmed"] == false && unread["level"].is_null() && unread["appearance"]["match"] == "unconfirmed");

    Check("hash: FNV-1a 64 of nothing and of 'a' (the published vectors)", n::Fnv64Hex("") == "cbf29ce484222325" && n::Fnv64Hex("a") == "af63dc4c8601ec8c");
    L crowd = original;
    crowd.variant.clear();
    const auto key1 = n::ResidentFor(crowd, "citizen__corporat_wa_01", {10.04, 20.0, -0.01});
    const auto key2 = n::ResidentFor(crowd, "citizen__corporat_wa_01", {10.0, 20.0, 0.0});
    const auto key3 = n::ResidentFor(crowd, "citizen__corporat_wa_01", {10.2, 20.0, 0.0});
    Check("resident: a crowd person's key is a hash of record, appearance and spot (to 0.1 m)", key1["kind"] == "crowd" && key1["key"] == key2["key"] && key1["key"] != key3["key"] && key1["key"].get<std::string>().rfind("xfr1-", 0) == 0 && key1["key"].get<std::string>().size() == 5 + 16);
    Check("resident: the key is ours and says so", key1["ours"] == true && key1["scope"].get<std::string>().find("ours, not the game's") == 0 && key1["community"].is_null());
    L community = crowd;
    community.hasStub = true;
    community.spawner = "EntityID(777)";
    community.entry = "bench_sitter";
    community.ordinal = 2;
    const auto ckey = n::ResidentFor(community, "citizen__corporat_wa_01", {10.0, 20.0, 0.0});
    Check("resident: a community NPC keeps the game's own pair and its index", ckey["kind"] == "community" && ckey["key"] == "xfc1-EntityID_777_-bench_sitter-2" && ckey["hash"] == key2["hash"]);
    community.ordinal = -1;
    const auto unindexed = n::ResidentFor(community, "citizen__corporat_wa_01", {10.0, 20.0, 0.0});
    Check("resident: a stub with no readable index falls back to the hash, and still reports the stub", unindexed["kind"] == "crowd" && unindexed["key"] == key2["key"] && unindexed["community"]["entry"] == "bench_sitter");
    const auto respawn = n::RespawnFor("woman_corpo", "a", {1, 2, 0}, 90.0, "quiet");
    Check("respawn: npc.spawn parameters that bring the look back, facing the same way", respawn["method"] == "npc.spawn" && respawn["params"]["cast"] == "woman_corpo" && respawn["params"]["at"] == json::array({1.0, 2.0, 0.0}) &&
                                                                                           std::abs(respawn["params"]["face"][0].get<double>() - (-4.0)) < 1e-9 && std::abs(respawn["params"]["face"][1].get<double>() - 2.0) < 1e-9);
    const auto reading = n::LookFromJson(json{{"entity", "E"}, {"record", "R"}, {"position", {1, 2, 3}}, {"yaw", 5.0}, {"stub", {{"spawner", "S"}, {"entry", "E1"}, {"ordinal", 4}}}});
    Check("look: a reading becomes a look, the stub with its index", reading.hasStub && reading.ordinal == 4 && reading.position[2] == 3.0 && reading.yaw == 5.0);
    Check("look: no stub, no community", !n::LookFromJson(json{{"entity", "E"}, {"stub", nullptr}}).hasStub);
}

struct Rig
{
    Fake fake;
    xfb::EventLog log;
    n::Service service;
    n::Ops ops;
    Rig()
    {
        service.SetEvents(&log);
        fake.street["P-behind"] = Fake::Person("P-behind", "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
        fake.street["P-front"] = Fake::Person("P-front", "Character.LowlifeMale", "king_of_the_stoop_ma_012", "Male", 10.0);
        ops = fake.Ops();
    }
};

void RefusalTests()
{
    Rig r;
    Check("refuse: no source is bad_params", CodeOf([&] { r.service.Substitute(json::object(), r.ops); }) == "bad_params");
    Check("refuse: two sources are bad_params", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"look_at", true}}, r.ops); }) == "bad_params");
    Check("refuse: an unknown parameter", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"teleport", true}}, r.ops); }) == "bad_params");
    Check("refuse: an XF actor's handle is not a passer-by", CodeOf([&] { r.service.Substitute(json{{"who", "a1"}}, r.ops); }) == "bad_params");
    Check("refuse: an unknown pick handle", CodeOf([&] { r.service.Substitute(json{{"who", "p9"}}, r.ops); }) == "npc_unknown");
    Check("refuse: reactions must be quiet or game", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"reactions", "loud"}}, r.ops); }) == "bad_params");
    Check("refuse: max_wait_s is bounded", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"max_wait_s", 500}}, r.ops); }) == "bad_params");
    r.fake.v["busy"] = "in_combat";
    Check("refuse: V in combat, before any game step", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "in_combat" && r.fake.calls.empty());
    r.fake.v["busy"] = "";
    r.fake.street["P-behind"]["refuse"] = "npc_protected";
    Check("refuse: the game step's protection (quest, vendor, police, child, scene...) reaches the caller, and nothing is held or spawned",
          CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "npc_protected" && r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0);
    r.fake.street["P-behind"]["refuse"] = "npc_busy";
    Check("refuse: busy (combat, workspot, hostile) the same way", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "npc_busy" && r.fake.Count("spawn") == 0);
    r.fake.street["P-behind"]["refuse"] = "too_far";
    Check("refuse: too far the same way", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "too_far");
    r.fake.street["P-behind"].erase("refuse");
    Check("refuse: nobody with that id", CodeOf([&] { r.service.Substitute(json{{"id", "nobody"}}, r.ops); }) == "npc_not_found");
    Check("refuse: look_at with nothing in the crosshair", CodeOf([&] { r.service.Substitute(json{{"look_at", true}}, r.ops); }) == "npc_not_found");
    r.fake.street["P-gender"] = Fake::Person("P-gender", "Character.Something", "x", "", -10.0);
    Check("refuse: a person of unknown gender is unmatched, nothing is held", CodeOf([&] { r.service.Substitute(json{{"id", "P-gender"}}, r.ops); }) == "look_unmatched" && r.fake.Count("detach") == 0);
    Check("refuse: a fighter cast can't stand in", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"cast", "fighter_pistol"}}, r.ops); }) == "cast_unknown");
    Check("refuse: no refusal changed the game", r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0 && r.fake.Count("remove") == 0 && r.service.ActorCount() == 0);
    // One of the bridge's own actors is never a passer-by.
    const auto spawned = r.service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, r.ops);
    r.fake.street["E-a1"] = Fake::Person("E-a1", "Character.xfs_actor_woman_corpo", "x", "Female", -10.0);
    Check("refuse: an XF actor's entity is not replaced", CodeOf([&] { r.service.Substitute(json{{"id", spawned["entity"].get<std::string>()}}, r.ops); }) == "npc_protected");
}

void SwapTests()
{
    {
        Rig r;
        const auto dry = r.service.Substitute(json{{"id", "P-behind"}, {"dry_run", true}}, r.ops);
        Check("dry run: reads and reports, holds nothing, spends no handle", dry["dry_run"] == true && dry["undo"].is_null() && r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0 && !dry.contains("who") &&
                                                                                 dry["respawn"]["method"] == "npc.spawn" && dry["resident"]["kind"] == "crowd" && dry["look_match"]["cast"] == "woman_corpo" &&
                                                                                 dry["original"]["record"] == "Character.CorpoWoman" && dry["original"]["heading"] == 90.0);
        const auto next = r.service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, r.ops);
        Check("dry run: the next actor is still a1", next["who"] == "a1");
    }
    {
        // Out of V's sight: the swap starts at once, the original is removed only when the actor stands there.
        Rig r;
        const auto out = r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        Check("swap: an original behind V starts at once", out["state"] == "spawning" && out["who"] == "a1" && out["swap"]["mode"] == "now" && out["swap"]["original_out_of_sight"] == true);
        Check("swap: order is read, hold, spawn - and the original is still there", r.fake.Index("readLook") < r.fake.Index("detach") && r.fake.Index("detach") < r.fake.Index("spawn") && r.fake.Count("remove") == 0 && r.fake.held.count("P-behind") == 1);
        Check("swap: what the game said when the original was held is in the answer (the crowd-adoption rows' evidence)", out["swap"]["hold"]["detached"] == true);
        Check("swap: the actor is the nearest cast, in the original's appearance, spawned out of view", r.fake.Index("spawn a1 Character.xfs_actor_woman_corpo citizen__corporat_wa_01 out_of_view") >= 0);
        Check("swap: the answer carries the resident, the respawn and the look report", out["resident"]["key"].get<std::string>().rfind("xfr1-", 0) == 0 && out["respawn"]["params"]["cast"] == "woman_corpo" &&
                                                                                         out["look_match"]["confirmed"] == false && out["original"]["appearance"] == "citizen__corporat_wa_01");
        Check("swap: the undo is a release of the actor", out["undo"]["method"] == "npc.release" && out["undo"]["params"]["who"] == "a1");
        Step(r.service, r.ops, 1.0);
        Check("swap: until the actor appears the original stays (no empty spot)", r.fake.Count("remove") == 0 && Events(r.log, "npc.substituted").empty());
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        Check("swap: the original is removed after the actor appears, once", r.fake.Index("remove P-behind") > r.fake.Index("spawn a1") && r.fake.Count("remove") == 1 && r.fake.removed.count("P-behind") == 1);
        const auto done = Events(r.log, "npc.substituted");
        Check("swap: npc.substituted carries the confirmed report, the resident, and that nobody saw it",
              done.size() == 1 && done[0]["data"]["look_match"]["confirmed"] == true && done[0]["data"]["look_match"]["level"] == "exact" && done[0]["data"]["in_view_at_swap"] == false && done[0]["data"]["hold"]["detached"] == true &&
                  done[0]["data"]["resident"]["key"] == out["resident"]["key"] && done[0]["data"]["removal"]["removed"] == true);
        const auto status = r.service.Status(json::object());
        Check("swap: status shows the actor's look and no swap left", status["swaps"].empty() && status["npcs"][0]["look_match"]["level"] == "exact" && status["npcs"][0]["substitute_of"] == "P-behind" && status["npcs"][0]["resident"]["ours"] == true);
    }
    {
        // The appearance falls back: reported, not hidden.
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "a_template_default");
        Step(r.service, r.ops, 1.0);
        const auto done = Events(r.log, "npc.substituted");
        Check("swap: an appearance the template did not have is reported fell_back, approximate", done.size() == 1 && done[0]["data"]["look_match"]["appearance"]["match"] == "fell_back" && done[0]["data"]["look_match"]["level"] == "approximate");
    }
    {
        // In V's sight: waited for, nothing touched.
        Rig r;
        const auto out = r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        Check("wait: an original in V's view is waited for", out["state"] == "waiting" && out["who"] == "a1" && out["resident"].is_null() && out.contains("resident_pending"));
        Check("wait: nothing is held, spawned or removed", r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0 && r.fake.Count("remove") == 0);
        Check("wait: the handle is not an actor yet", CodeOf([&] { r.service.Move(json{{"who", "a1"}, {"to", "v"}}, r.ops); }) == "npc_not_spawned");
        Check("wait: status shows the waiting swap", r.service.Status(json::object())["swaps"].size() == 1 && r.service.Status(json::object())["swaps"][0]["state"] == "waiting");
        Step(r.service, r.ops, 3.0);
        Check("wait: still in view after 3 s, still untouched", r.fake.Count("spawn") == 0 && r.fake.Count("detach") == 0);
        // It walks behind V.
        r.fake.street["P-front"]["position"] = json::array({0.0, -12.0, 0.0});
        r.fake.street["P-front"]["yaw"] = 270.0;
        Step(r.service, r.ops, 1.0);
        Check("wait: once hidden it is held and the actor spawns at where it is now, facing as it faces now",
              r.fake.Count("detach") == 1 && r.fake.Count("spawn a1 Character.xfs_actor_man_lowlife king_of_the_stoop_ma_012") == 1);
        r.fake.Appear("a1", "king_of_the_stoop_ma_012");
        Step(r.service, r.ops, 1.0);
        const auto done = Events(r.log, "npc.substituted");
        Check("wait: then the swap completes with the key fixed where the actor stands", done.size() == 1 && done[0]["data"]["resident"]["basis"]["spot"][1] == -12.0 && done[0]["data"]["waited_s"].get<double>() > 3.0);
    }
    {
        // Never hidden: given up, nothing changed.
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}, {"max_wait_s", 2}}, r.ops);
        Step(r.service, r.ops, 4.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("wait: an original that stays in view is given up on after max_wait_s, untouched", failed.size() == 1 && failed[0]["data"]["reason"] == "never_hidden" && r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0 &&
                                                                                                   r.service.Status(json::object())["swaps"].empty());
        Check("wait: the handle is free again (unknown)", CodeOf([&] { r.service.Move(json{{"who", "a1"}, {"to", "v"}}, r.ops); }) == "npc_unknown");
    }
    {
        Rig r;
        const auto out = r.service.Substitute(json{{"id", "P-front"}, {"in_view", true}}, r.ops);
        Check("in_view: swaps at once even in V's sight (probe 4), spawned in view", out["state"] == "spawning" && out["swap"]["original_out_of_sight"] == false && r.fake.Index("spawn a1 Character.xfs_actor_man_lowlife king_of_the_stoop_ma_012 in_view") >= 0);
        r.fake.Appear("a1", "king_of_the_stoop_ma_012");
        Step(r.service, r.ops, 1.0);
        const auto done = Events(r.log, "npc.substituted");
        Check("in_view: and reports that V could see it", done.size() == 1 && done[0]["data"]["in_view_at_swap"] == true);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        const auto cancelled = r.service.Release(json{{"who", "a1"}}, r.ops);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("cancel: releasing a waiting swap cancels it, the original untouched", cancelled["how"] == "cancelled" && failed.size() == 1 && failed[0]["data"]["reason"] == "cancelled" && r.fake.Count("detach") == 0 && r.service.Status(json::object())["swaps"].empty());
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.service.Release(json{{"who", "all"}}, r.ops);
        Check("cancel: release all does too", r.service.Status(json::object())["swaps"].empty() && Events(r.log, "npc.substitute_failed").size() == 2);
    }
    {
        // A spawn the game refuses: the original is given back, nothing is left.
        Rig r;
        r.fake.spawnThrows = true;
        Check("undo: a refused spawn refuses the call", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "spawn_refused");
        Check("undo: and the original was held and given back", r.fake.Index("detach") >= 0 && r.fake.Index("reattach P-behind") > r.fake.Index("detach") && r.fake.held.empty() && r.service.Status(json::object())["swaps"].empty() && r.service.ActorCount() == 0);
    }
    {
        // The actor never appears.
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        Step(r.service, r.ops, n::kSwapSpawnS + 2.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("undo: an actor that never appears is given up on: the original is given back, the actor released, nothing removed",
              failed.size() >= 1 && failed[0]["data"]["reason"] == "not_spawned" && failed[0]["data"]["original_returned"] == true && r.fake.held.empty() && r.fake.Count("remove") == 0 && r.fake.Index("release a1 despawn") >= 0);
    }
    {
        // The removal is refused (the original became protected): the actor goes, the original stays.
        Rig r;
        r.fake.removeThrows = true;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("undo: a refused removal undoes the swap: the actor released, the original given back", failed.size() == 1 && failed[0]["data"]["reason"] == "remove_refused" && r.fake.held.empty() && r.fake.Index("release a1 despawn") >= 0 && Events(r.log, "npc.substituted").empty());
    }
    {
        // The original is gone while waiting.
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.fake.street.erase("P-front");
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("undo: an original the game removed first ends the wait", failed.size() == 1 && failed[0]["data"]["reason"] == "original_lost");
    }
    {
        // The original became protected while waiting.
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.fake.street["P-front"]["refuse"] = "npc_protected";
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("undo: an original that became protected while waited for is left alone", failed.size() == 1 && failed[0]["data"]["reason"] == "npc_protected" && r.fake.Count("detach") == 0);
    }
    {
        // The original was gone before the actor appeared: the actor stays.
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.street.erase("P-behind");
        r.fake.removeThrows = false;
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        r.fake.removed.insert("P-behind");
        Step(r.service, r.ops, 1.0);
        Check("swap: an original the game recycled first still ends in a finished swap, said plainly", Events(r.log, "npc.substituted").size() == 1);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        Check("refuse: the same person twice", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "already_substituting");
    }
    {
        // A pick is the source; it is let go when the swap is done.
        Rig r;
        r.service.Pick(json{{"id", "P-behind"}}, r.ops);
        r.fake.npcs["p1"] = json{{"who", "p1"}, {"exists", true}, {"spawned", true}, {"position", {0.0, -10.0, 0.0}}, {"busy", ""}, {"protected", false}};
        const auto out = r.service.Substitute(json{{"who", "p1"}}, r.ops);
        r.fake.Appear(out["who"].get<std::string>(), "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        Check("pick: a picked person can be the source, and is let go once replaced", Events(r.log, "npc.substituted").size() == 1 && r.fake.Index("release p1 leave") >= 0);
    }
    {
        Rig r;
        r.fake.lookedAt = "P-behind";
        const auto out = r.service.Substitute(json{{"look_at", true}}, r.ops);
        Check("look_at: the person V is looking at", out["original"]["entity"] == "P-behind" && r.fake.Index("lookedAt") >= 0);
    }
    {
        Rig r;
        const auto out = r.service.Substitute(json{{"id", "P-behind"}, {"reactions", "game"}, {"label", "Passer-by"}}, r.ops);
        Check("reactions game: the civilian's own reactions (the _reactive clone), so it flinches as the crowd does (probe 6)", out["reactions"] == "game" && r.fake.Index("spawn a1 Character.xfs_actor_woman_corpo_reactive") >= 0);
    }
    {
        // A community NPC is never replaced: the answer is a refusal before anything is held or spent; the dry run reports it.
        Rig r;
        r.fake.street["P-community"] = Fake::Person("P-community", "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
        r.fake.street["P-community"]["stub"] = json{{"spawner", "EntityID(777)"}, {"entry", "bench_sitter"}, {"ordinal", 2}};
        Check("community: refused community_npc before anything is held, spawned or removed", CodeOf([&] { r.service.Substitute(json{{"id", "P-community"}}, r.ops); }) == "community_npc" &&
                                                                                                r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0 && r.fake.Count("remove") == 0);
        Check("community: and in view too (the swap would only have waited)", CodeOf([&] { r.service.Substitute(json{{"id", "P-community"}, {"in_view", true}}, r.ops); }) == "community_npc");
        const auto dry = r.service.Substitute(json{{"id", "P-community"}, {"dry_run", true}}, r.ops);
        Check("community: a dry run still reads it - the identity pair, the hash - and says it is not substitutable",
              dry["substitutable"] == false && dry["refusal"]["code"] == "community_npc" && dry["resident"]["kind"] == "community" && dry["resident"]["key"] == "xfc1-EntityID_777_-bench_sitter-2" &&
                  dry["resident"]["note"].get<std::string>().find("never replaces a community NPC") != std::string::npos && dry["original"]["community"]["entry"] == "bench_sitter");
        Check("community: no handle was spent", r.service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, r.ops)["who"] == "a1");
        const auto plain = r.service.Substitute(json{{"id", "P-behind"}, {"dry_run", true}}, r.ops);
        Check("community: a lane-crowd person is substitutable", plain["substitutable"] == true && !plain.contains("refusal"));
    }
    {
        // ...and again while waiting, and again immediately before the removal.
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.fake.street["P-front"]["stub"] = json{{"spawner", "S"}, {"entry", "E"}, {"ordinal", 0}};
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("community: an original found to be a community NPC while waited for ends the wait, untouched", failed.size() == 1 && failed[0]["data"]["reason"] == "community_npc" && r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.street["P-behind"]["stub"] = json{{"spawner", "S"}, {"entry", "E"}, {"ordinal", 0}};
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("community: immediately before the removal it is checked again: nothing is hidden, the actor goes, the original is given back",
              failed.size() == 1 && failed[0]["data"]["reason"] == "community_npc" && failed[0]["data"]["original_returned"] == true && r.fake.Count("remove ") == 0 && r.fake.held.empty() && r.fake.Index("release a1 despawn") >= 0);
    }
    {
        Rig r;
        r.fake.removeThrows = true;
        r.fake.removeCode = "community_npc"; // the game step's own last word
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("community: the removal step refusing it ends the swap as community_npc", failed.size() == 1 && failed[0]["data"]["reason"] == "community_npc" && r.fake.held.empty());
    }
}

void LimitTests()
{
    Rig r;
    for (int i = 0; i < 5; ++i)
    {
        const std::string id = "Q" + std::to_string(i);
        r.fake.street[id] = Fake::Person(id, "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", i % 2 == 0 ? -10.0 : 10.0);
        r.service.Substitute(json{{"id", id}}, r.ops);
    }
    Check("limit: five swaps (three spawning, two waiting) fill the five actors", r.service.ActorCount() == 3 && r.service.Status(json::object())["swaps"].size() == 5);
    r.fake.street["Q9"] = Fake::Person("Q9", "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
    Check("limit: a sixth is refused", CodeOf([&] { r.service.Substitute(json{{"id", "Q9"}}, r.ops); }) == "limit");
    Check("limit: and so is an npc.spawn", CodeOf([&] { r.service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, r.ops); }) == "limit");
    Check("limit: a dry run is not limited", r.service.Substitute(json{{"id", "Q9"}, {"dry_run", true}}, r.ops)["dry_run"] == true);
}

void TeardownTests()
{
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        n::TickInput paused;
        paused.paused = true;
        r.service.Tick(0.3, paused, r.ops);
        Check("pause: waiting and spawning swaps end, the held original is given back, the actor goes",
              r.service.Status(json::object())["swaps"].empty() && r.fake.held.empty() && r.fake.Index("release a2 despawn") >= 0 && Events(r.log, "npc.substitute_failed").size() == 2);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        const auto out = r.service.ReleaseAllNow("handover", r.ops);
        Check("handover: the same, in its own request", r.service.Status(json::object())["swaps"].empty() && r.fake.held.empty() && out["released"].size() >= 1);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        const auto out = r.service.RestoreAfterKill(r.ops);
        Check("kill: one game step gives every held original back, and the swaps are forgotten", r.fake.Index("releaseAll kill") >= 0 && r.fake.held.empty() && r.service.Status(json::object())["swaps"].empty() && out["forgotten"].size() >= 1);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.calls.clear();
        n::TickInput gone;
        gone.detaches = 1; // the first tick learns the count; a later change is a load
        r.service.Tick(0.3, gone, r.ops);
        gone.detaches = 2;
        r.service.Tick(0.3, gone, r.ops);
        Check("load: swaps are dropped with no game call (the world went with the original)", r.service.Status(json::object())["swaps"].empty() && r.fake.Count("reattach") == 0 && r.fake.Count("release") == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        n::TickInput closed;
        closed.gateOpen = false;
        r.service.Tick(0.3, closed, r.ops);
        Check("gate: nothing completes behind a closed script gate", r.fake.Count("remove") == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}}, r.ops);
        r.fake.v["busy"] = "in_combat";
        Step(r.service, r.ops, 0.6);
        Check("combat: V entering a fight ends a waiting swap", r.service.Status(json::object())["swaps"].empty() && !Events(r.log, "npc.substitute_failed").empty());
    }
}

void RestoreTests()
{
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}, {"restore", true}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        r.fake.npcs["a1"]["position"] = json::array({3.0, 4.0, 0.0});
        Step(r.service, r.ops, 0.6);
        const auto released = r.service.Release(json{{"who", "a1"}, {"how", "despawn"}}, r.ops);
        Check("restore: releasing leaves a fresh crowd person of the original record and look where the actor stood", r.fake.Index("restore Character.CorpoWoman citizen__corporat_wa_01 at 4") >= 0 && released["how"] == "despawn");
        Step(r.service, r.ops, 1.0);
        const auto restored = Events(r.log, "npc.restored");
        Check("restore: the crowd person is asked to join the crowd once, and npc.restored says whether it did", r.fake.Count("restoreStep send") == 1 && restored.size() == 1 && restored[0]["data"]["in_crowd"] == true);
        Check("restore: nothing is left in the bookkeeping", r.service.Status(json::object())["restoring"] == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}, {"restore", true}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        r.service.ReleaseAllNow("handover", r.ops);
        Check("restore: an automatic release (a handover, a fight, the kill switch, a load) leaves no one behind", r.fake.Count("restore ") == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        r.service.Release(json{{"who", "a1"}, {"restore", true}}, r.ops);
        Check("restore: npc.release can ask for it at release time", r.fake.Count("restore ") == 1);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}, {"restore", true}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        r.service.Release(json{{"who", "a1"}, {"restore", false}}, r.ops);
        Check("restore: and to decline it", r.fake.Count("restore ") == 0);
    }
    {
        Rig r;
        const auto plain = r.service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, r.ops);
        Check("restore: only a substituted actor knows who to leave behind", CodeOf([&] { r.service.Release(json{{"who", plain["who"].get<std::string>()}, {"restore", true}}, r.ops); }) == "bad_params");
        r.service.Pick(json{{"id", "E1"}}, r.ops);
        Check("restore: a pick has nothing to restore", CodeOf([&] { r.service.Release(json{{"who", "p1"}, {"restore", true}}, r.ops); }) == "bad_params");
    }
    {
        // dissolve: the restore happens when the actor is finally removed, not when the release is asked.
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}, {"restore", true}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        r.fake.npcs["a1"]["position"] = json::array({0.0, 2.0, 0.0});
        Step(r.service, r.ops, 0.6);
        r.service.Release(json{{"who", "a1"}, {"how", "dissolve"}, {"walk", false}}, r.ops);
        Check("restore: a dissolve leaves the crowd person only when the actor is removed", r.fake.Count("restore ") == 0);
        r.fake.npcs["a1"]["position"] = json::array({0.0, -25.0, 0.0});
        Step(r.service, r.ops, 1.0);
        Check("restore: ... which is out of V's sight, 15 m or more away", r.fake.Count("restore ") == 1 && r.fake.Index("release a1 despawn") >= 0);
    }
}

void ReturnTests()
{
    {
        // A positive answer is what "returned" means; otherwise the cleanup stays owned and is retried.
        Rig r;
        r.fake.reattachFails = 2;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.service.Release(json{{"who", "a1"}}, r.ops); // the actor goes before the swap finishes
        Step(r.service, r.ops, 0.6);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("return: a reattach the game does not confirm is not reported as returned, and the cleanup stays owned",
              failed.size() == 1 && failed[0]["data"]["original_held"] == true && failed[0]["data"]["original_returned"] == false && failed[0]["data"]["return_pending"] == true &&
                  r.service.Status(json::object())["returning"] == 1 && r.fake.held.count("P-behind") == 1);
        Step(r.service, r.ops, 6.0);
        const auto back = Events(r.log, "npc.original_returned");
        Check("return: it is retried and reported only after a positive answer", back.size() == 1 && back[0]["data"]["original"] == "P-behind" && back[0]["data"]["attempts"].get<int>() >= 2 &&
                                                                              r.fake.held.empty() && r.service.Status(json::object())["returning"] == 0);
    }
    {
        Rig r;
        r.fake.reattachFails = 1000000;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.service.Release(json{{"who", "a1"}}, r.ops);
        Step(r.service, r.ops, n::kReturnMaxS + 3.0);
        const auto gaveUp = Events(r.log, "npc.original_unreturned");
        Check("return: retries are bounded in time, and giving up is said", gaveUp.size() == 1 && gaveUp[0]["data"]["reason"] == "not_found" && r.service.Status(json::object())["returning"] == 0 && Events(r.log, "npc.original_returned").empty());
    }
    {
        // A refused spawn: the call refuses, and the original it held is not forgotten.
        Rig r;
        r.fake.spawnThrows = true;
        r.fake.reattachFails = 1;
        Check("return: a refused spawn still refuses the call", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}}, r.ops); }) == "spawn_refused");
        Check("return: ...and the held original stays owned until it is given back", r.service.Status(json::object())["returning"] == 1 && r.fake.held.count("P-behind") == 1);
        Step(r.service, r.ops, 6.0);
        Check("return: ...which it then is", r.fake.held.empty() && Events(r.log, "npc.original_returned").size() == 1);
    }
    {
        // The retry list is bounded.
        Rig r;
        r.fake.reattachFails = 1000000;
        for (int i = 0; i < 9; ++i)
        {
            const std::string id = "R" + std::to_string(i);
            r.fake.street[id] = Fake::Person(id, "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
            const auto out = r.service.Substitute(json{{"id", id}}, r.ops);
            r.service.Release(json{{"who", out["who"].get<std::string>()}}, r.ops);
            r.service.Tick(0.3, {}, r.ops);
        }
        Check("return: at most kMaxReturns are kept, and letting one go is said", r.service.Status(json::object())["returning"] == n::kMaxReturns && Events(r.log, "npc.original_unreturned").size() == 1 &&
                                                                                    Events(r.log, "npc.original_unreturned")[0]["data"]["reason"] == "queue_full");
    }
    {
        // The kill switch: one step in the game even when the bookkeeping holds nothing; originals it cannot find stay owned.
        Rig empty;
        const auto none = empty.service.RestoreAfterKill(empty.ops);
        Check("kill: the game step runs even when nothing is held natively", empty.fake.Index("releaseAll kill") >= 0 && none["forgotten"].empty());
        Rig r;
        r.fake.unresolvable.insert("P-behind");
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        const auto out = r.service.RestoreAfterKill(r.ops);
        Check("kill: an original the script could not find is kept as owed", out["unresolved"].size() == 1 && r.service.Status(json::object())["returning"] == 1 && r.service.Active());
        n::TickInput killed;
        killed.killed = true;
        r.service.Tick(1.3, killed, r.ops);
        Check("kill: ...and is looked for again under the kill switch, without sending anything else", r.fake.Count("reattach P-behind") >= 1 && r.fake.Count("spawn") == 1);
        r.fake.unresolvable.clear();
        r.service.Tick(1.3, killed, r.ops);
        Check("kill: ...until it is found and given back", r.fake.held.empty() && Events(r.log, "npc.original_returned").size() == 1 && r.service.Status(json::object())["returning"] == 0);
        killed.gateOpen = false;
        Rig closed;
        closed.fake.unresolvable.insert("P-behind");
        closed.service.Substitute(json{{"id", "P-behind"}}, closed.ops);
        closed.service.RestoreAfterKill(closed.ops);
        closed.fake.calls.clear();
        closed.service.Tick(1.3, killed, closed.ops);
        Check("kill: a closed script gate waits", closed.fake.Count("reattach") == 0);
    }
    {
        Rig r;
        r.fake.unresolvable.insert("P-behind");
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.service.RestoreAfterKill(r.ops);
        n::TickInput gone;
        gone.detaches = 1;
        r.service.Tick(0.3, gone, r.ops);
        gone.detaches = 2;
        r.service.Tick(0.3, gone, r.ops);
        Check("load: owed returns are dropped with the world", r.service.Status(json::object())["returning"] == 0);
    }
}

void RestoreCleanupTests()
{
    auto restoring = [](Rig& r, const std::string& id, bool release = true) {
        r.fake.street[id] = Fake::Person(id, "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
        const auto out = r.service.Substitute(json{{"id", id}, {"restore", true}}, r.ops);
        const auto who = out["who"].get<std::string>();
        r.fake.Appear(who, "citizen__corporat_wa_01");
        Step(r.service, r.ops, 0.3);
        if (release)
        {
            r.service.Release(json{{"who", who}, {"how", "despawn"}}, r.ops);
        }
        return who;
    };
    {
        Rig r;
        r.fake.restoreNever = true;
        restoring(r, "Q0");
        Step(r.service, r.ops, n::kRestoreJoinS + 2.0);
        const auto restored = Events(r.log, "npc.restored");
        Check("restore: a fresh crowd person who never joined is deleted, not abandoned, and ownership is not claimed passed", restored.size() == 1 && restored[0]["data"]["in_crowd"] == false && restored[0]["data"]["removed"] == true &&
                                                                                                                              r.fake.Count("restoreCancel") == 1 && r.service.Status(json::object())["restoring"] == 0);
    }
    {
        Rig r;
        r.fake.restoreNever = true;
        r.fake.cancelFails = 3;
        restoring(r, "Q0");
        Step(r.service, r.ops, n::kRestoreJoinS + 6.0);
        const auto restored = Events(r.log, "npc.restored");
        Check("restore: a cancel the game refuses is retried until it works", restored.size() == 1 && restored[0]["data"]["removed"] == true && r.fake.Count("restoreCancel") == 4);
    }
    {
        Rig r;
        r.fake.restoreNever = true;
        r.fake.cancelFails = -1;
        restoring(r, "Q0");
        Step(r.service, r.ops, n::kRestoreJoinS + 12.0);
        const auto restored = Events(r.log, "npc.restored");
        Check("restore: ...a bounded number of times, and what is left is said", restored.size() == 1 && restored[0]["data"]["removed"] == false && r.fake.Count("restoreCancel") == 10 && r.service.Status(json::object())["restoring"] == 0);
    }
    {
        Rig r;
        restoring(r, "Q0");
        Step(r.service, r.ops, 1.0);
        Check("restore: one that joined the crowd is the game's: no cancel", Events(r.log, "npc.restored").size() == 1 && Events(r.log, "npc.restored")[0]["data"]["in_crowd"] == true && r.fake.Count("restoreCancel") == 0);
    }
    {
        Rig r;
        r.fake.restoreNever = true;
        restoring(r, "Q0");
        r.service.ReleaseAllNow("handover", r.ops);
        Check("restore: a handover, a pause or a fight deletes the ones still on their way", r.fake.Count("restoreCancel") == 1 && r.service.Status(json::object())["restoring"] == 0);
    }
    {
        Rig r;
        r.fake.restoreNever = true;
        for (int i = 0; i < n::kMaxRestores; ++i)
        {
            restoring(r, "Q" + std::to_string(i));
        }
        Check("restore: five are waited on at most", r.service.Status(json::object())["restoring"] == n::kMaxRestores);
        r.fake.street["Q9"] = Fake::Person("Q9", "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
        const auto out = r.service.Substitute(json{{"id", "Q9"}, {"restore", true}}, r.ops);
        r.fake.Appear(out["who"].get<std::string>(), "citizen__corporat_wa_01");
        Step(r.service, r.ops, 0.3);
        r.service.Release(json{{"who", out["who"].get<std::string>()}, {"how", "despawn"}}, r.ops);
        const auto released = Events(r.log, "npc.released");
        Check("restore: a sixth is refused, said in the release, and the release itself goes ahead",
              r.fake.Count("restore ") == n::kMaxRestores && released.back()["data"].contains("restore_failed") && r.service.Status(json::object())["restoring"] == n::kMaxRestores);
    }
    {
        Rig r;
        r.fake.restoreNever = true;
        restoring(r, "Q0");
        n::TickInput closed;
        const auto out = r.service.RestoreAfterKill(r.ops);
        Check("restore: the kill's one step takes the rest, whatever the bookkeeping says", r.fake.Index("releaseAll kill") >= 0 && r.service.Status(json::object())["restoring"] == 0);
        (void)out;
        (void)closed;
    }
}

void ObservationTests()
{
    {
        // A failed read of V stops a swap going forward, never going back.
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}, {"max_wait_s", 2}}, r.ops);
        r.fake.vThrows = true;
        Step(r.service, r.ops, 3.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("observation: a waiting swap still ends at max_wait_s when V cannot be read", failed.size() == 1 && failed[0]["data"]["reason"] == "never_hidden" && r.fake.Count("detach") == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.vThrows = true;
        Step(r.service, r.ops, n::kSwapSpawnS + 2.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("observation: a held original is given back at the spawn deadline although V cannot be read",
              failed.size() == 1 && failed[0]["data"]["reason"] == "not_spawned" && failed[0]["data"]["original_returned"] == true && r.fake.held.empty() && r.fake.Index("release a1 despawn") >= 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        r.fake.vThrows = true;
        Step(r.service, r.ops, n::kSwapRevisibleS - 2.0);
        Check("observation: with the actor there but V unreadable nothing is removed", r.fake.Count("remove ") == 0 && Events(r.log, "npc.substituted").empty());
        Step(r.service, r.ops, 4.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("observation: ...and the swap is rolled back after a bounded wait, not left held", failed.size() == 1 && failed[0]["data"]["reason"] == "observation_failed" && r.fake.held.empty() && r.fake.Count("remove ") == 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        r.fake.stateThrows = true;
        Step(r.service, r.ops, n::kSwapRevisibleS + 2.0);
        Check("observation: the original's state unreadable is the same: nothing removed, rolled back", Events(r.log, "npc.substitute_failed").size() == 1 && r.fake.Count("remove ") == 0 && r.fake.held.empty());
    }
    {
        // in_view asked: V's sight is not what decides, so an unreadable V does not stop it.
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}, {"in_view", true}}, r.ops);
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        r.fake.vThrows = true;
        Step(r.service, r.ops, 1.0);
        Check("observation: in_view true completes without a reading of V", Events(r.log, "npc.substituted").size() == 1);
    }
}

void RecheckTests()
{
    {
        // The original is in V's sight when the actor appears: wait, then remove once it looks away.
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.street["P-behind"]["position"] = json::array({0.0, 10.0, 0.0}); // walked into view
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 2.0);
        Check("recheck: an original in V's sight is not hidden: it waits", r.fake.Count("remove ") == 0 && Events(r.log, "npc.substituted").empty() && r.service.Status(json::object())["swaps"].size() == 1);
        r.fake.street["P-behind"]["position"] = json::array({0.0, -10.0, 0.0});
        Step(r.service, r.ops, 1.0);
        const auto done = Events(r.log, "npc.substituted");
        Check("recheck: ...and goes once V cannot see it", done.size() == 1 && r.fake.Count("remove P-behind") == 1);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.street["P-behind"]["position"] = json::array({0.0, 10.0, 0.0});
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, n::kSwapRevisibleS + 2.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("recheck: one that stays in sight is rolled back: the actor removed, the original given back, nothing hidden",
              failed.size() == 1 && failed[0]["data"]["reason"] == "became_visible" && failed[0]["data"]["original_returned"] == true && r.fake.Count("remove ") == 0 && r.fake.held.empty() && r.fake.Index("release a1 despawn") >= 0);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-front"}, {"in_view", true}}, r.ops);
        r.fake.Appear("a1", "king_of_the_stoop_ma_012");
        Step(r.service, r.ops, 1.0);
        const auto done = Events(r.log, "npc.substituted");
        Check("recheck: a swap asked to happen in view is not held back by it", done.size() == 1 && done[0]["data"]["in_view_at_swap"] == true);
    }
    {
        Rig r;
        r.service.Substitute(json{{"id", "P-behind"}}, r.ops);
        r.fake.street["P-behind"]["reasons"] = json::array({"quest"});
        r.fake.Appear("a1", "citizen__corporat_wa_01");
        Step(r.service, r.ops, 1.0);
        const auto failed = Events(r.log, "npc.substitute_failed");
        Check("recheck: an original that became protected is left alone, whatever V sees", failed.size() == 1 && failed[0]["data"]["reason"] == "npc_protected" && r.fake.Count("remove ") == 0 && r.fake.held.empty());
    }
}
// 0.8.21: npc.substitute's incident link: the actor's reserved handle joins the declared incident when the request is made, and leaves
// when the swap is refused.
void IncidentLinkTests()
{
    struct Joined
    {
        std::vector<std::string> joined, left;
    } seen;
    n::IncidentLink link;
    link.join = [&](const std::string& aIncident, const std::string& aWho, const std::string& aRole, const n::ActorView& aView) -> json {
        if (aIncident == "closed")
        {
            throw xfb::MethodError("incident_unknown", "no declared incident is open under that id");
        }
        seen.joined.push_back(aWho + ":" + aRole + (aView.hasPos ? ":placed" : ""));
        return json{{"incident", "inc-1"}, {"id", aIncident}, {"role", aRole}, {"who", aWho}};
    };
    link.leave = [&](const std::string&, const std::string& aWho) { seen.left.push_back(aWho); };
    {
        Rig r;
        r.service.SetIncidentLink(link);
        const auto out = r.service.Substitute(json{{"id", "P-behind"}, {"incident", "pocket-1"}, {"incident_role", "mark"}}, r.ops);
        Check("incident link: a substitute joins the incident under its role, by the handle it was given", out["who"] == "a1" && out["incident"]["role"] == "mark" && seen.joined == std::vector<std::string>({"a1:mark:placed"}));
        const auto plain = r.service.Substitute(json{{"id", "P-front"}, {"in_view", true}, {"incident", "pocket-1"}}, r.ops);
        Check("incident link: the role defaults to participant", plain["incident"]["role"] == "participant" && seen.joined.back() == "a2:participant:placed");
    }
    {
        Rig r;
        r.service.SetIncidentLink(link);
        seen = Joined{};
        Check("incident link: an incident that is not open is refused and nothing is held or spawned", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"incident", "closed"}}, r.ops); }) == "incident_unknown" &&
                                                                                                          r.fake.Count("detach") == 0 && r.fake.Count("spawn") == 0);
    }
    {
        Rig r;
        r.service.SetIncidentLink(link);
        seen = Joined{};
        r.fake.spawnThrows = true;
        const auto code = CodeOf([&] { r.service.Substitute(json{{"id", "P-front"}, {"in_view", true}, {"incident", "pocket-1"}}, r.ops); });
        Check("incident link: a swap the game refuses leaves the incident", code == "spawn_refused" && seen.joined.size() == 1 && seen.left == std::vector<std::string>({"a1"}), code);
    }
    {
        // 0.8.21 review: every failure and cancellation takes the role back out; a swap that happened keeps it
        const auto left = [&](Rig& r, const json& params, double steps, const char* also = nullptr) {
            r.service.SetIncidentLink(link);
            seen = Joined{};
            r.service.Substitute(params, r.ops);
            if (also) r.service.Release(json{{"who", also}}, r.ops);
            Step(r.service, r.ops, steps);
            return seen.left;
        };
        const std::vector<std::string> a1{"a1"};
        {
            Rig r;
            Check("incident link: a substitution cancelled while it waits takes the actor back out",
                  left(r, json{{"id", "P-front"}, {"incident", "pocket-1"}}, 0.3, "a1") == a1 && Events(r.log, "npc.substitute_failed").size() == 1);
        }
        {
            Rig r;
            Check("incident link: a substitution whose original never leaves V's sight takes it back out (never_hidden)",
                  left(r, json{{"id", "P-front"}, {"max_wait_s", 1}, {"incident", "pocket-1"}}, 3.0) == a1);
        }
        {
            Rig r;
            Check("incident link: an actor that never appears takes it back out (not_spawned)",
                  left(r, json{{"id", "P-behind"}, {"incident", "pocket-1"}}, n::kSwapSpawnS + 3.0) == a1 && Events(r.log, "npc.substitute_failed").size() == 1);
        }
        {
            Rig r;
            r.fake.removeThrows = true;
            r.service.SetIncidentLink(link);
            seen = Joined{};
            r.service.Substitute(json{{"id", "P-behind"}, {"incident", "pocket-1"}}, r.ops);
            r.fake.Appear("a1", "citizen__corporat_wa_01");
            Step(r.service, r.ops, 1.0);
            Check("incident link: a swap that fails after the actor appeared takes it out too (the swap did not happen)", seen.left == a1 && Events(r.log, "npc.substitute_failed").size() == 1);
        }
        {
            Rig r;
            r.service.SetIncidentLink(link);
            seen = Joined{};
            r.service.Substitute(json{{"id", "P-behind"}, {"incident", "pocket-1"}}, r.ops);
            r.fake.Appear("a1", "citizen__corporat_wa_01");
            Step(r.service, r.ops, 1.0);
            r.service.Release(json{{"who", "a1"}}, r.ops);
            Check("incident link: a swap that happened keeps the role, whatever happens to the actor later", Events(r.log, "npc.substituted").size() == 1 && seen.left.empty());
        }
    }
    {
        Rig r;
        Check("incident link: without a link the parameter is refused (test_hooks_off)", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"incident", "pocket-1"}}, r.ops); }) == "test_hooks_off");
        r.service.SetIncidentLink(link);
        Check("incident link: a dry run changes nothing, so it can't join", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"dry_run", true}, {"incident", "pocket-1"}}, r.ops); }) == "bad_params");
        Check("incident link: incident_role without incident is refused", CodeOf([&] { r.service.Substitute(json{{"id", "P-behind"}, {"incident_role", "x"}}, r.ops); }) == "bad_params");
    }
}
} // namespace

int RunNpcSubstituteUnitTests()
{
    gFailures = 0;
    PureTests();
    RefusalTests();
    SwapTests();
    LimitTests();
    TeardownTests();
    RestoreTests();
    ReturnTests();
    RestoreCleanupTests();
    ObservationTests();
    RecheckTests();
    IncidentLinkTests();
    return gFailures;
}
