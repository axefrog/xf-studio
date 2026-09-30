// Unit checks for bridge 0.8's NPC direction (core/Npc.hpp) against fake game steps: the pure pieces (offsets, targets,
// character counts, known parameters), the refusal order (parameters, V's state, limits and range before any game step),
// the undo each write answers with, and the tick: npc.spawned, arrival by distance or by the command's Success, a failed or
// timed-out move stopped, a follow's limit, lines and gestures ending, the hub's answer, time-out and walk-away, the
// automatic release on combat and a handover, a load dropping everything without a game call, walk_away, and the kill
// switch's one-step release. Part of `xfb_selftest --unit`.

#include <cmath>
#include <cstdio>
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

int gNpcFailures = 0;

void Check(const char* aName, bool aOk, const std::string& aDetail = {})
{
    if (!aOk)
    {
        ++gNpcFailures;
    }
    std::printf("%s unit: npc %s%s%s\n", aOk ? "PASS" : "FAIL", aName, aDetail.empty() ? "" : " ", aDetail.c_str());
    std::fflush(stdout);
}

bool Near(double aA, double aB, double aEps = 1e-6)
{
    return std::abs(aA - aB) <= aEps;
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

// A fake street: V at (0, 0, 0) facing +Y; every game step recorded; actors' positions set by the test.
struct Fake
{
    std::vector<std::string> calls;
    json v = json{{"phase", "gameplay"}, {"position", {0.0, 0.0, 0.0}}, {"yaw", 0.0}, {"busy", ""}};
    std::map<std::string, json> npcs; // who -> poll entry
    json hub = json{{"id", 0}, {"answer", -1}};
    n::Ops Ops()
    {
        n::Ops ops;
        ops.v = [this] {
            calls.push_back("v");
            return v;
        };
        ops.list = [this](double, int32_t) {
            calls.push_back("list");
            return json{{"npcs", json::array({{{"id", "E1"}, {"record", "Character.CorpoWoman"}}})}};
        };
        ops.pick = [this](const std::string& aWho, const std::string&) {
            calls.push_back("pick " + aWho);
            return json{{"record", "Character.CorpoWoman"}, {"position", {2.0, 2.0, 0.0}}};
        };
        ops.spawn = [this](const std::string& aWho, const std::string& aRecord, const n::Vec3& aAt, double, const std::string&, bool) {
            calls.push_back("spawn " + aWho + " " + aRecord);
            npcs[aWho] = json{{"who", aWho}, {"exists", false}, {"spawned", false}, {"position", {aAt[0], aAt[1], aAt[2]}}};
            return json{{"entity", "E-" + aWho}, {"position", {aAt[0], aAt[1], aAt[2]}}};
        };
        ops.command = [this](const std::string& aWho, const n::Command& aCommand) {
            calls.push_back("command " + aWho + " " + aCommand.kind);
            return json{{"sent", true}, {"before", {{"position", {1.0, 2.0, 0.0}}, {"yaw", 45.0}}}};
        };
        ops.say = [this](const std::string& aWho, const n::Line& aLine) {
            calls.push_back("say " + aWho + " " + std::to_string(aLine.number));
            return json{{"line_id", aLine.number}};
        };
        ops.hide = [this](const std::string& aWho, int32_t aLine) {
            calls.push_back("hide " + aWho + " " + std::to_string(aLine));
            return json::object();
        };
        ops.look = [this](const std::string& aWho, const n::Target&, bool aOff) {
            calls.push_back(std::string("look ") + aWho + (aOff ? " off" : " on"));
            return json::object();
        };
        ops.face = [this](const std::string& aWho, int32_t aCategory, int32_t aIdle) {
            calls.push_back("face " + aWho + " " + std::to_string(aCategory) + "/" + std::to_string(aIdle));
            return json::object();
        };
        ops.act = [this](const std::string& aWho, const std::string& aClip, bool aOff) {
            calls.push_back("act " + aWho + (aOff ? " off" : " " + aClip));
            return json::object();
        };
        ops.hub = [this](const n::Hub& aHub, bool aShow) {
            calls.push_back(std::string("hub ") + (aShow ? "show " : "hide ") + std::to_string(aHub.id));
            return json::object();
        };
        ops.release = [this](const std::string& aWho, const std::string& aHow) {
            calls.push_back("release " + aWho + " " + aHow);
            npcs.erase(aWho);
            return json::object();
        };
        ops.releaseAll = [this](const std::string& aReason) {
            calls.push_back("releaseAll " + aReason);
            npcs.clear();
            return json{{"released", 1}};
        };
        ops.poll = [this](const std::string&) {
            calls.push_back("poll");
            json list = json::array();
            for (const auto& [who, entry] : npcs)
            {
                list.push_back(entry);
            }
            return json{{"v", v}, {"npcs", list}, {"hub", hub}};
        };
        return ops;
    }
    bool Called(const std::string& aPrefix) const
    {
        for (const auto& call : calls)
        {
            if (call.rfind(aPrefix, 0) == 0)
            {
                return true;
            }
        }
        return false;
    }
};

std::vector<json> Events(xfb::EventLog& aLog, const std::string& aKind)
{
    std::vector<json> out;
    const auto read = aLog.Read(0, 1000, {aKind}); // kept: iterating a temporary's member would dangle
    for (const auto& e : read["events"])
    {
        out.push_back(e);
    }
    return out;
}

// Ticks the service long enough for one poll.
void Poll(n::Service& aService, Fake& aFake, const n::Ops& aOps, n::TickInput aInput = {})
{
    aService.Tick(n::kPollSeconds + 0.01, aInput, aOps);
    (void)aFake;
}

void PureTests()
{
    const auto p = n::OffsetPoint({0, 0, 5}, 0.0, 5.0, 1.0);
    Check("an offset: 5 m ahead of a yaw-0 facing is +Y, 1 m right is +X", Near(p[0], 1.0) && Near(p[1], 5.0) && Near(p[2], 5.0));
    const auto q = n::OffsetPoint({0, 0, 0}, 90.0, 2.0, 0.0);
    Check("an offset: yaw 90 faces -X", Near(q[0], -2.0) && Near(q[1], 0.0, 1e-9));
    Check("characters, not bytes", n::CountChars("\xC3\xA9\xC3\xA9x") == 3);
    Check("targets: v, a handle, a point, an offset only where allowed",
          n::ParseTarget("v", "to", false).kind == n::Target::Kind::V && n::ParseTarget("a12", "to", false).who == "a12" &&
              n::ParseTarget(json::array({1, 2, 3}), "to", false).kind == n::Target::Kind::Point &&
              n::ParseTarget(json{{"ahead_m", 3}}, "at", true).kind == n::Target::Kind::Offset &&
              CodeOf([] { n::ParseTarget(json{{"ahead_m", 3}}, "to", false); }) == "bad_params" &&
              CodeOf([] { n::ParseTarget("judy", "to", false); }) == "bad_params");
    Check("unknown parameters are refused", CodeOf([] { n::RequireKnown("npc.move", json{{"who", "a1"}, {"teleport", true}}); }) == "bad_params");
    Check("tables: every cast is a base-game civilian clone or marked research", [] {
        for (const auto& cast : n::Casts())
        {
            if (!cast.research && cast.record.rfind("Character.xfs_actor_", 0) != 0)
            {
                return false;
            }
        }
        return n::FindCast("judy") == nullptr && n::FindCast("woman_corpo") != nullptr;
    }());
    Check("styles map to the game's line types", n::StyleLineType("subtitle") == 1 && n::StyleLineType("holocall") == 2 && n::StyleLineType("overhead") == 4 && n::StyleLineType("x") == -1);
}

void RefusalTests()
{
    n::Service service;
    Fake fake;
    const auto ops = fake.Ops();
    Check("spawn: an unknown cast is refused before any game step", CodeOf([&] { service.Spawn(json{{"cast", "judy"}, {"at", json{{"ahead_m", 3}}}}, ops); }) == "cast_unknown" && fake.calls.empty());
    fake.v["busy"] = "in_combat";
    Check("spawn: V in combat refuses before the spawn step", CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops); }) == "in_combat" && !fake.Called("spawn"));
    fake.v["busy"] = "";
    fake.v["phase"] = "photo_mode";
    Check("spawn: photo mode refuses (not_in_world)", CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops); }) == "not_in_world");
    fake.v["phase"] = "gameplay";
    Check("spawn: beyond 30 m refused too_far", CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", json::array({40, 0, 0})}}, ops); }) == "too_far" && !fake.Called("spawn"));
    const auto a1 = service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
    service.Spawn(json{{"cast", "man_corpo"}, {"at", json{{"ahead_m", 4}}}}, ops);
    service.Spawn(json{{"cast", "man_lowlife"}, {"at", json{{"ahead_m", 5}}}}, ops);
    Check("spawn: handles a1..a3, the undo releases", a1["who"] == "a1" && a1["undo"] == json{{"method", "npc.release"}, {"params", {{"who", "a1"}, {"how", "despawn"}}}});
    Check("spawn: a fourth actor is refused limit", CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops); }) == "limit");
    Check("spawn: faces V (yaw towards the origin from 3 m ahead is 180)", Near(std::abs(a1["yaw"].get<double>()), 180.0, 1e-6));
    Check("an unknown handle is refused npc_unknown", CodeOf([&] { service.Move(json{{"who", "a9"}, {"to", "v"}}, ops); }) == "npc_unknown");
    Check("a target actor that hasn't appeared can't be walked to", CodeOf([&] { service.Move(json{{"who", "a1"}, {"to", "a2"}}, ops); }) == "npc_not_spawned");
    // A pick: look, face, say; never move or act.
    const auto p1 = service.Pick(json{{"id", "E1"}}, ops);
    Check("pick: p1 with a leave undo", p1["who"] == "p1" && p1["undo"]["params"]["how"] == "leave");
    Check("pick: moving someone else's NPC is refused not_ours", CodeOf([&] { service.Move(json{{"who", "p1"}, {"to", "v"}}, ops); }) == "not_ours");
    Check("pick: gestures too", CodeOf([&] { service.Act(json{{"who", "p1"}, {"gesture", "wave"}}, ops); }) == "not_ours");
    const auto look = service.Look(json{{"who", "p1"}, {"at", "v"}}, ops);
    Check("look: the undo turns it off", look["undo"] == json{{"method", "npc.look"}, {"params", {{"who", "p1"}, {"off", true}}}});
    const auto face = service.Face(json{{"who", "p1"}, {"expression", "joy"}}, ops);
    Check("face: joy is 3/5, the undo turns it off", fake.Called("face p1 3/5") && face["undo"]["params"]["off"] == true);
    const auto line = service.Say(json{{"who", "p1"}, {"text", "Hello there."}}, ops);
    Check("say: a line id and an undo that hides it", line["line"] == "l1" && line["undo"] == json{{"method", "npc.say"}, {"params", {{"who", "p1"}, {"hide", "l1"}}}});
    const auto trigger = service.Say(json{{"who", "p1"}, {"trigger", "greeting"}}, ops);
    Check("say: a voice line alone has no undo", trigger["undo"].is_null());
    Check("say: too long", CodeOf([&] { service.Say(json{{"who", "p1"}, {"text", std::string(201, 'x')}}, ops); }) == "line_too_long");
    Check("say: unknown trigger", CodeOf([&] { service.Say(json{{"who", "p1"}, {"trigger", "start_combat"}}, ops); }) == "trigger_unknown");
    const auto place = service.Place(json{{"who", "a1"}, {"at", json::array({1, 1, 0})}, {"yaw", 10}}, ops);
    Check("place: the undo puts the actor back where it stood", place["undo"]["method"] == "npc.place" && place["undo"]["params"]["at"] == json::array({1.0, 2.0, 0.0}) && place["undo"]["params"]["yaw"] == 45.0);
    Check("release: a pick can only leave", CodeOf([&] { service.Release(json{{"who", "p1"}, {"how", "despawn"}}, ops); }) == "bad_params");
    Check("save holds name the actors", service.Holds().size() == 1 && service.Holds()[0].get<std::string>().find("3 XF actor") == 0);
}

void TickTests()
{
    xfb::EventLog log;
    n::Service service;
    service.SetEvents(&log);
    Fake fake;
    const auto ops = fake.Ops();
    service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 10}}}}, ops);
    fake.npcs["a1"]["exists"] = true;
    fake.npcs["a1"]["spawned"] = true;
    Poll(service, fake, ops);
    Check("tick: npc.spawned once the actor exists", Events(log, "npc.spawned").size() == 1);
    Poll(service, fake, ops);
    Check("tick: npc.spawned only once", Events(log, "npc.spawned").size() == 1);
    service.Move(json{{"who", "a1"}, {"to", "v"}, {"stop_m", 1.6}}, ops);
    fake.npcs["a1"]["command_state"] = "Executing";
    fake.npcs["a1"]["position"] = {0.0, 5.0, 0.0};
    Poll(service, fake, ops);
    Check("tick: no arrival while far and executing", Events(log, "npc.arrived").empty());
    fake.npcs["a1"]["position"] = {0.0, 2.0, 0.0};
    Poll(service, fake, ops);
    Check("tick: arrival by distance (within stop_m plus slack) even while the command still executes", Events(log, "npc.arrived").size() == 1);
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 20, 0})}}, ops);
    fake.npcs["a1"]["command_state"] = "Success";
    Poll(service, fake, ops);
    Check("tick: arrival by the command's Success", Events(log, "npc.arrived").size() == 2);
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 20, 0})}}, ops);
    fake.npcs["a1"]["command_state"] = "Failure";
    fake.calls.clear();
    Poll(service, fake, ops);
    Check("tick: a failed command: npc.move_failed and a stop step", Events(log, "npc.move_failed").size() == 1 && fake.Called("command a1 stop"));
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 20, 0})}, {"max_s", 1}}, ops);
    fake.npcs["a1"]["command_state"] = "Executing";
    service.Tick(1.1, {}, ops);
    Check("tick: a move past max_s fails with timeout", Events(log, "npc.move_failed").size() == 2 && Events(log, "npc.move_failed")[1]["data"]["state"] == "timeout");
    service.Follow(json{{"who", "a1"}, {"target", "v"}, {"max_s", 1}}, ops);
    service.Tick(1.1, {}, ops);
    Check("tick: a follow ends at max_s (npc.follow_ended)", Events(log, "npc.follow_ended").size() == 1);
    // Lines and gestures end by themselves.
    const auto line = service.Say(json{{"who", "a1"}, {"text", "Short."}, {"seconds", 1}}, ops);
    service.Act(json{{"who", "a1"}, {"gesture", "wave"}, {"seconds", 0.5}}, ops);
    fake.calls.clear();
    service.Tick(1.05, {}, ops);
    Check("tick: a line's time ends: hidden and npc.said with its id", fake.Called("hide a1 " + line["line"].get<std::string>().substr(1)) && Events(log, "npc.said").size() == 1 &&
                                                                            Events(log, "npc.said")[0]["data"]["line"] == line["line"]);
    Check("tick: a gesture's time ends: stopped and npc.act_done", fake.Called("act a1 off") && Events(log, "npc.act_done").size() == 1);
    // The hub: shown near V, answered, one at a time, timed out.
    fake.npcs["a1"]["position"] = {0.0, 2.0, 0.0};
    Poll(service, fake, ops);
    const auto hub = service.Choices(json{{"who", "a1"}, {"choices", json::array({"Yes.", "No."})}, {"max_s", 5}}, ops);
    Check("choices: one at a time", CodeOf([&] { service.Choices(json{{"who", "a1"}, {"choices", json::array({"A", "B"})}}, ops); }) == "one_hub_at_a_time");
    fake.hub = json{{"id", hub["hub"]}, {"answer", 1}};
    Poll(service, fake, ops);
    const auto choice = Events(log, "npc.choice");
    Check("choices: the player's pick becomes npc.choice {hub, index, label}", choice.size() == 1 && choice[0]["data"]["index"] == 1 && choice[0]["data"]["label"] == "No." && choice[0]["data"]["hub"] == hub["hub"]);
    fake.hub = json{{"id", 0}, {"answer", -1}};
    const auto again = service.Choices(json{{"who", "a1"}, {"choices", json::array({"Yes.", "No."})}, {"max_s", 5}}, ops);
    service.Tick(5.1, {}, ops);
    Check("choices: timed out after max_s", Events(log, "npc.choice").size() == 2 && Events(log, "npc.choice")[1]["data"]["timeout"] == true && fake.Called("hub hide " + std::to_string(again["hub"].get<int>())));
    service.Choices(json{{"who", "a1"}, {"choices", json::array({"Yes.", "No."})}}, ops);
    fake.npcs["a1"]["position"] = {0.0, 9.0, 0.0};
    Poll(service, fake, ops);
    Check("choices: V walking away withdraws them (walked_away)", Events(log, "npc.choice").size() == 3 && Events(log, "npc.choice")[2]["data"]["walked_away"] == true);
    Check("choices: too far to show", CodeOf([&] { service.Choices(json{{"who", "a1"}, {"choices", json::array({"A", "B"})}}, ops); }) == "too_far");
    // walk_away: a move away from V, then released on arrival.
    fake.npcs["a1"]["position"] = {0.0, 3.0, 0.0};
    Poll(service, fake, ops);
    const auto away = service.Release(json{{"who", "a1"}, {"how", "walk_away"}}, ops);
    Check("walk_away: to a point 15 m further from V", Near(away["to"][1].get<double>(), 18.0, 1e-6));
    fake.npcs["a1"]["position"] = {0.0, 17.5, 0.0};
    fake.npcs["a1"]["command_state"] = "Executing";
    Poll(service, fake, ops);
    Check("walk_away: released there (npc.released how walk_away) and despawned", Events(log, "npc.released").size() == 1 && Events(log, "npc.released")[0]["data"]["how"] == "walk_away" && !service.Active());
}

void ReleaseTests()
{
    {
        xfb::EventLog log;
        n::Service service;
        service.SetEvents(&log);
        Fake fake;
        const auto ops = fake.Ops();
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        fake.npcs["a1"]["exists"] = true;
        fake.npcs["a1"]["spawned"] = true;
        service.Look(json{{"who", "a1"}, {"at", "v"}}, ops);
        fake.v["busy"] = "in_combat";
        fake.calls.clear();
        Poll(service, fake, ops);
        const auto autos = Events(log, "npc.auto_released");
        Check("combat: everything released with reason combat (look off, despawned)", autos.size() == 1 && autos[0]["data"]["reason"] == "combat" && fake.Called("look a1 off") && fake.Called("release a1 despawn") && !service.Active());
    }
    {
        xfb::EventLog log;
        n::Service service;
        service.SetEvents(&log);
        Fake fake;
        const auto ops = fake.Ops();
        n::TickInput input;
        service.Tick(0.01, input, ops); // first sight of the detach count
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        fake.calls.clear();
        input.detaches = 1;
        service.Tick(0.01, input, ops);
        Check("a load: dropped without any game step, npc.auto_released reason load", fake.calls.empty() && !service.Active() && Events(log, "npc.auto_released").size() == 1 &&
                                                                                          Events(log, "npc.auto_released")[0]["data"]["reason"] == "load");
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        service.Tick(0.01, input, ops);
        Check("a load: a new actor after it isn't dropped again", service.Active());
        input.handedOver = true;
        service.Tick(0.01, input, ops);
        Check("a handover releases (reason handover)", !service.Active() && Events(log, "npc.auto_released").back()["data"]["reason"] == "handover");
        input.handedOver = false;
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        input.killed = true;
        fake.calls.clear();
        service.Tick(1.0, input, ops);
        Check("killed: the tick leaves it to the restore (no game step)", fake.calls.empty() && service.Active());
        const auto restored = service.RestoreAfterKill(ops);
        Check("the kill switch: one releaseAll step, the bookkeeping cleared, each actor named", fake.calls == std::vector<std::string>{"releaseAll kill"} && !service.Active() &&
                                                                                                    restored["forgotten"].size() == 1);
    }
}
} // namespace

int RunNpcUnitTests()
{
    gNpcFailures = 0;
    PureTests();
    RefusalTests();
    TickTests();
    ReleaseTests();
    return gNpcFailures;
}
