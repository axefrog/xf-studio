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
        ops.v = [this] { return v; };
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
            held.erase(aId);
            return json{{"reattached", true}};
        };
        ops.removeOriginal = [this](const std::string& aId) -> json {
            calls.push_back("remove " + aId);
            if (removeThrows)
            {
                throw xfb::MethodError("npc_protected", "the original became protected");
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
            for (const auto& id : held)
            {
                calls.push_back("reattach " + id);
            }
            held.clear();
            return json{{"released", 1}};
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
            return json{{"spawned", true}, {"in_crowd", inCrowd || aSend}};
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
        Rig r;
        r.fake.street["P-community"] = Fake::Person("P-community", "Character.CorpoWoman", "citizen__corporat_wa_01", "Female", -10.0);
        r.fake.street["P-community"]["stub"] = json{{"spawner", "EntityID(777)"}, {"entry", "bench_sitter"}, {"ordinal", 2}};
        const auto out = r.service.Substitute(json{{"id", "P-community"}}, r.ops);
        Check("resident: a community NPC's answer carries the game's own pair and the hash", out["resident"]["kind"] == "community" && out["resident"]["key"] == "xfc1-EntityID_777_-bench_sitter-2" && out["resident"]["hash"].get<std::string>().rfind("xfr1-", 0) == 0);
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
    return gFailures;
}
