// Unit checks for bridge 0.8's NPC direction (core/Npc.hpp) against fake game steps: the pure pieces (offsets, targets,
// character counts, known parameters), the refusal order (parameters, V's state, limits and range before any game step),
// the undo each write answers with, and the tick: npc.spawned, arrival by distance or by the command's Success, a failed or
// timed-out move stopped, a follow's limit, lines and gestures ending, the hub's answer, time-out and walk-away, the
// automatic release on combat and a handover, a load dropping everything without a game call, walk_away, and the kill
// switch's one-step release; and the Story Engine's staging needs: stand-ins that can die and are hostile, handed back in a
// fight (V15), the view test, an out-of-sight spawn and the dissolve release (V16), the write gate on the tick's forward
// step and the handover's release in its own request (0.8.6's rules). Part of `xfb_selftest --unit`.

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
    bool walkable = true;    // ground: every probe walkable at the asked point
    bool rayBlocked = false; // ray: static geometry between every two points
    int groundProbes = 0;
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
        ops.spawn = [this](const std::string& aWho, const std::string& aRecord, const n::Vec3& aAt, double, const std::string&, bool, int32_t aAttitude, bool aImmortal) {
            calls.push_back("spawn " + aWho + " " + aRecord + " attitude=" + std::to_string(aAttitude) + (aImmortal ? " immortal" : " mortal"));
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
            return json{{"v", v}, {"camera", v.value("camera", json())}, {"npcs", list}, {"hub", hub}};
        };
        ops.ground = [this](const n::Vec3& aPoint) {
            ++groundProbes;
            calls.push_back("ground");
            return walkable ? json{{"walkable", true}, {"streamed", true}, {"point", {aPoint[0], aPoint[1], aPoint[2]}}} : json{{"walkable", false}, {"streamed", true}};
        };
        ops.ray = [this](const n::Vec3&, const n::Vec3&) {
            calls.push_back("ray");
            return json{{"blocked", rayBlocked}};
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

// The live DM's additions: a facing held away from V, a voice with no body, npc.turned and npc.blocked, masked casts.
void DirectorTests()
{
    xfb::EventLog log;
    n::Service service;
    service.SetEvents(&log);
    Fake fake;
    const auto ops = fake.Ops();
    const auto spawned = service.Spawn(json{{"cast", "man_masked"}, {"at", json{{"ahead_m", 4}}}}, ops);
    Check("masked cast: its first masked look by default", spawned["appearance"] == "king_of_the_stoop_ma_king_of_the_stoop_ma_012");
    const auto second = service.Spawn(json{{"cast", "man_masked"}, {"at", json{{"ahead_m", 5}}}, {"variant", 1}}, ops);
    Check("masked cast: variant picks another", second["appearance"] == "king_of_the_stoop_ma_king_of_the_stoop_ma_03");
    Check("masked cast: a variant past its looks is refused", CodeOf([&] { service.Spawn(json{{"cast", "woman_masked"}, {"at", json{{"ahead_m", 3}}}, {"variant", 3}}, ops); }) == "bad_params");
    service.Release(json{{"who", "a2"}}, ops);
    fake.npcs["a1"]["exists"] = true;
    fake.npcs["a1"]["spawned"] = true;
    fake.npcs["a1"]["position"] = {0.0, 4.0, 0.0};
    fake.npcs["a1"]["yaw"] = 180.0; // facing V (at the origin, 4 m to its -Y)
    Poll(service, fake, ops);
    const auto away = service.Turn(json{{"who", "a1"}, {"away_from", "v"}, {"hold", true}}, ops);
    Check("turn away: the goal faces away from V (yaw 0: +Y) and the undo ends the hold", std::abs(away["yaw_goal"].get<double>()) < 0.01 && away["hold"] == true &&
                                                                                            away["undo"] == json{{"method", "npc.turn"}, {"params", {{"who", "a1"}, {"off", true}}}});
    fake.npcs["a1"]["yaw"] = 0.0;
    fake.npcs["a1"]["command_state"] = "Success";
    Poll(service, fake, ops);
    auto turned = Events(log, "npc.turned");
    Check("npc.turned when it faces away (reached, hold, away)", turned.size() == 1 && turned[0]["data"]["reached"] == true && turned[0]["data"]["away"] == true && turned[0]["data"]["hold"] == true);
    // V circles round to +Y of the actor: the held facing turns it away again.
    fake.v["position"] = {0.0, 8.0, 0.0};
    fake.npcs["a1"]["command_state"] = "NotExecuting";
    fake.calls.clear();
    service.Tick(1.1, {}, ops);
    Check("hold: V moving round it turns it away again", fake.Called("command a1 turn"));
    fake.npcs["a1"]["yaw"] = 180.0;
    fake.npcs["a1"]["command_state"] = "Success";
    Poll(service, fake, ops);
    turned = Events(log, "npc.turned");
    Check("hold: the re-turn is reported (again)", turned.size() == 2 && turned[1]["data"]["again"] == true);
    // A walk suspends the hold; after arrival it turns away again.
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 10, 0})}, {"stop_m", 1}}, ops);
    fake.npcs["a1"]["position"] = {0.0, 9.5, 0.0};
    fake.npcs["a1"]["yaw"] = 0.0; // walked facing +Y: now facing away from V? V at (0, 8): away is +Y, so it already does
    fake.v["position"] = {0.0, 12.0, 0.0}; // V ahead of it now: away is -Y
    fake.npcs["a1"]["command_state"] = "Executing";
    Poll(service, fake, ops);
    fake.calls.clear();
    service.Tick(1.1, {}, ops);
    Check("hold: after the walk ends it turns away again", Events(log, "npc.arrived").size() == 1 && fake.Called("command a1 turn"));
    const auto off = service.Turn(json{{"who", "a1"}, {"off", true}}, ops);
    Check("turn off: the hold ends", off["was_holding"] == true && !service.Status(json::object())["npcs"][0].contains("facing"));
    Check("turn: to and away_from together are refused", CodeOf([&] { service.Turn(json{{"who", "a1"}, {"to", "v"}, {"away_from", "v"}}, ops); }) == "bad_params");
    // Blocked: no headway for 4 s.
    fake.npcs["a1"]["command_state"] = "Executing";
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 20, 0})}}, ops);
    for (int i = 0; i < 20; ++i)
    {
        Poll(service, fake, ops);
    }
    const auto blocked = Events(log, "npc.blocked");
    Check("blocked: no headway for 4 s raises npc.blocked once (stuck), the walk goes on", blocked.size() == 1 && blocked[0]["data"]["reason"] == "stuck" &&
                                                                                           service.Status(json::object())["npcs"][0].contains("motion"));
    fake.npcs["a1"]["command_state"] = "Failure";
    Poll(service, fake, ops);
    Check("blocked: a failed walk is final (no_path) with npc.move_failed", Events(log, "npc.blocked").size() == 2 && Events(log, "npc.blocked")[1]["data"]["final"] == true &&
                                                                                Events(log, "npc.move_failed").size() == 1);
    // A voice with no body.
    Check("voice: needs a speaker", CodeOf([&] { service.Say(json{{"text", "Hello."}}, ops); }) == "bad_params");
    Check("voice: no voice triggers", CodeOf([&] { service.Say(json{{"speaker", "A voice"}, {"trigger", "greeting"}}, ops); }) == "bad_params");
    Check("voice: not overhead", CodeOf([&] { service.Say(json{{"speaker", "A voice"}, {"text", "Hi."}, {"style", "overhead"}}, ops); }) == "bad_params");
    fake.v["busy"] = "in_combat";
    fake.calls.clear();
    const auto voice = service.Say(json{{"speaker", "A voice"}, {"text", "Can you hear me?"}, {"seconds", 1}}, ops);
    Check("voice: shown even in a fight, ownerless by default, with an undo that hides it", voice["voice"] == true && voice["style"] == "ownerless" && fake.Called("say  ") &&
                                                                                                voice["undo"] == json{{"method", "npc.say"}, {"params", {{"hide", voice["line"]}}}});
    fake.v["busy"] = "";
    fake.calls.clear();
    service.Tick(1.05, {}, ops);
    const auto said = Events(log, "npc.said");
    Check("voice: npc.said with the speaker when its time ends, hidden", !said.empty() && said.back()["data"]["voice"] == true && said.back()["data"]["speaker"] == "A voice" &&
                                                                          fake.Called("hide  "));
    const auto kept = service.Say(json{{"speaker", "A voice"}, {"text", "Still there?"}, {"style", "holocall"}, {"seconds", 10}}, ops);
    fake.v["busy"] = "in_combat";
    Poll(service, fake, ops);
    Check("voice: a fight releases the actors but the voice line stays", Events(log, "npc.auto_released").size() == 1 && service.Status(json::object())["voice_lines"].size() == 1);
    fake.v["busy"] = "";
    n::TickInput handover;
    handover.handedOver = true;
    fake.calls.clear();
    service.Tick(0.01, handover, ops);
    Check("voice: a handover takes it down", fake.Called("hide  " + kept["line"].get<std::string>().substr(1)) && !service.Active());
}
// A first-person camera at V's eyes (V at the origin), level, looking along a yaw.
json CameraAt(double aYaw, const n::Vec3& aAt = {0.0, 0.0, 0.0})
{
    const double r = aYaw * 3.14159265358979323846 / 180.0;
    return json{{"position", {aAt[0], aAt[1], aAt[2] + 1.6}}, {"forward", {-std::sin(r), std::cos(r), 0.0}}, {"fov", 70.0}, {"aspect", 16.0 / 9.0}};
}

// The Story Engine's staging needs (V15, V16) and the 0.8.6 rules on the tick and the handover.
void StagingTests()
{
    // The view test.
    const auto camera = n::CameraFrom(json{{"camera", CameraAt(0.0)}});
    Check("view: a camera is read with its forward normalised", camera.known && Near(camera.forward[1], 1.0));
    Check("view: straight ahead is in view, behind isn't", n::InView(camera, {0, 10, 1.6}, 0) && !n::InView(camera, {0, -10, 1.6}, 0));
    Check("view: far to the side isn't (84 degrees off), 27 degrees off is", !n::InView(camera, {10, 1, 1.6}, 0) && n::InView(camera, {5, 10, 1.6}, 0));
    Check("view: an unknown camera sees everything", n::InView(n::Camera{}, {0, -10, 0}, 0) && !n::CameraFrom(json::object()).known);
    const auto candidates = n::HiddenCandidates({0, 0, 0}, camera, 12, 25);
    bool noneInView = !candidates.empty();
    for (const auto& c : candidates)
    {
        noneInView = noneInView && !n::InView(camera, {c[0], c[1], c[2] + 1.0}, n::kViewMarginDeg);
    }
    Check("hidden spots: none in view, the first behind V at the nearest distance",
          noneInView && candidates[0][1] < -11.9 && Near(n::HorizontalDistance(candidates[0], {0, 0, 0}), 12.0, 1e-6));
    Check("reactions: a cast's game-reactions record, none for the research casts",
          n::ReactiveRecord(*n::FindCast("woman_corpo")) == "Character.xfs_actor_woman_corpo_reactive" && n::ReactiveRecord(*n::FindCast("research_npc_base")).empty());

    // V15: the spawn's stance.
    {
        xfb::EventLog log;
        n::Service service;
        service.SetEvents(&log);
        Fake fake;
        const auto ops = fake.Ops();
        Check("stance: an unknown attitude is refused",
              CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}, {"attitude", "angry"}}, ops); }) == "bad_params");
        Check("stance: the research casts have no game-reactions record",
              CodeOf([&] { service.Spawn(json{{"cast", "research_npc_base"}, {"at", json{{"ahead_m", 3}}}, {"reactions", "game"}}, ops); }) == "bad_params");
        const auto quiet = service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        Check("stance: today's default is friendly and immortal with quiet reactions",
              quiet["attitude"] == "friendly" && quiet["immortal"] == true && quiet["reactions"] == "quiet" &&
                  fake.Called("spawn a1 Character.xfs_actor_woman_corpo attitude=0 immortal") && !quiet.contains("stand_in_note"));
        const auto standIn = service.Spawn(
            json{{"cast", "man_lowlife"}, {"at", json{{"ahead_m", 4}}}, {"attitude", "hostile"}, {"immortal", false}, {"reactions", "game"}}, ops);
        Check("stance: a hostile, mortal stand-in with the game's reactions",
              standIn["attitude"] == "hostile" && standIn["immortal"] == false && standIn.contains("stand_in_note") &&
                  fake.Called("spawn a2 Character.xfs_actor_man_lowlife_reactive attitude=2 mortal"));
        fake.npcs["a1"]["exists"] = true;
        fake.npcs["a1"]["spawned"] = true;
        fake.npcs["a2"]["exists"] = true;
        fake.npcs["a2"]["spawned"] = true;
        Poll(service, fake, ops);
        service.Look(json{{"who", "a2"}, {"at", "v"}}, ops);
        fake.v["busy"] = "in_combat";
        fake.calls.clear();
        Poll(service, fake, ops);
        const auto back = Events(log, "npc.handed_back");
        Check("a fight: the stand-in is handed back (its look given back, not removed), the friendly actor released",
              back.size() == 1 && back[0]["data"]["who"] == "a2" && fake.Called("look a2 off") && !fake.Called("release a2") && fake.Called("release a1 despawn"));
        Poll(service, fake, ops);
        Check("a fight: handed back once, still watched", Events(log, "npc.handed_back").size() == 1 && service.Status(json::object())["npcs"][0]["handed_back"] == true);
        fake.v["busy"] = "";
        Check("after the fight: a handed-back actor isn't directed", CodeOf([&] { service.Move(json{{"who", "a2"}, {"to", "v"}}, ops); }) == "npc_handed_back");
        fake.npcs["a2"]["dead"] = true;
        Poll(service, fake, ops);
        const auto died = Events(log, "npc.died");
        Check("a mortal actor's death: npc.died with its body kept",
              died.size() == 1 && died[0]["data"]["kept_body"] == true && service.Status(json::object())["npcs"][0]["dead"] == true);
        Poll(service, fake, ops);
        Check("a body: npc.died once; lines refused npc_dead",
              Events(log, "npc.died").size() == 1 && CodeOf([&] { service.Say(json{{"who", "a2"}, {"text", "Hi."}}, ops); }) == "npc_dead");
        service.Release(json{{"who", "a2"}}, ops);
        Check("a body: released by npc_release", !service.Active());
    }

    // V16: an out-of-sight spawn.
    {
        n::Service service;
        Fake fake;
        const auto ops = fake.Ops();
        Check("out of sight: min_m only with out_of_sight",
              CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}, {"min_m", 5}}, ops); }) == "bad_params");
        Check("out of sight: no camera, no spot (no_hidden_spot)", CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", "out_of_sight"}}, ops); }) == "no_hidden_spot");
        fake.v["camera"] = CameraAt(0.0);
        const auto hidden = service.Spawn(json{{"cast", "woman_corpo"}, {"at", "out_of_sight"}}, ops);
        const auto at = hidden["asked_at"];
        Check("out of sight: behind V, 12 m away, out of view, after one probe",
              at[1].get<double>() < -11.9 && hidden["out_of_sight"]["probes"] == 1 &&
                  !n::InView(n::CameraFrom(fake.v), {at[0].get<double>(), at[1].get<double>(), 1.6}, 0));
        fake.walkable = false;
        fake.groundProbes = 0;
        Check("out of sight: no walkable ground refuses no_hidden_spot after a bounded search",
              CodeOf([&] { service.Spawn(json{{"cast", "woman_corpo"}, {"at", "out_of_sight"}, {"min_m", 10}, {"max_m", 20}}, ops); }) == "no_hidden_spot" &&
                  fake.groundProbes > 0 && fake.groundProbes <= static_cast<int>(n::kMaxHiddenProbes));
    }

    // V16: dissolve.
    {
        xfb::EventLog log;
        n::Service service;
        service.SetEvents(&log);
        Fake fake;
        const auto ops = fake.Ops();
        fake.v["camera"] = CameraAt(0.0);
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        fake.npcs["a1"]["exists"] = true;
        fake.npcs["a1"]["spawned"] = true;
        Poll(service, fake, ops);
        service.Face(json{{"who", "a1"}, {"expression", "joy"}}, ops);
        Check("dissolve: walk and distance_m only with dissolve", CodeOf([&] { service.Release(json{{"who", "a1"}, {"walk", false}}, ops); }) == "bad_params");
        fake.calls.clear();
        const auto out = service.Release(json{{"who", "a1"}, {"how", "dissolve"}}, ops);
        Check("dissolve: what it holds given back, a walk 20 m from V",
              fake.Called("face a1 0/0") && fake.Called("command a1 move") && Near(out["to"][1].get<double>(), 20.0, 1e-6));
        fake.npcs["a1"]["position"] = {0.0, 10.0, 0.0};
        fake.npcs["a1"]["command_state"] = "Executing";
        Poll(service, fake, ops);
        Check("dissolve: not while V can see it", service.Active() && Events(log, "npc.released").empty());
        fake.npcs["a1"]["position"] = {0.0, 19.0, 0.0};
        fake.calls.clear();
        Poll(service, fake, ops);
        Check("dissolve: the walk off ends; still in sight, so it waits there", fake.Called("command a1 stop") && service.Active());
        fake.rayBlocked = true;
        Poll(service, fake, ops);
        const auto released = Events(log, "npc.released");
        Check("dissolve: gone once a wall hides it (npc.released how dissolve, npc.dissolved)",
              !service.Active() && released.size() == 1 && released[0]["data"]["how"] == "dissolve" && Events(log, "npc.dissolved").size() == 1);
        // Without the walk: it stays until V walks away with her back to it.
        fake.rayBlocked = false;
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 3}}}}, ops);
        fake.npcs["a2"]["exists"] = true;
        fake.npcs["a2"]["spawned"] = true;
        Poll(service, fake, ops);
        fake.calls.clear();
        service.Release(json{{"who", "a2"}, {"how", "dissolve"}, {"walk", false}}, ops);
        Check("dissolve, no walk: no move", !fake.Called("command a2 move"));
        fake.v["camera"] = CameraAt(180.0);
        Poll(service, fake, ops);
        Check("dissolve, no walk: out of view but only 3 m from V: kept", service.Active());
        fake.v["position"] = {0.0, -20.0, 0.0};
        fake.v["camera"] = CameraAt(180.0, {0.0, -20.0, 0.0});
        Poll(service, fake, ops);
        Check("dissolve, no walk: V walked away with her back to it: gone", !service.Active());
    }

    // The tick's forward step and the write gate (RB-122); the handover's own release.
    {
        xfb::EventLog log;
        n::Service service;
        service.SetEvents(&log);
        Fake fake;
        const auto ops = fake.Ops();
        service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 4}}}}, ops);
        fake.npcs["a1"]["exists"] = true;
        fake.npcs["a1"]["spawned"] = true;
        fake.npcs["a1"]["position"] = {0.0, 4.0, 0.0};
        fake.npcs["a1"]["yaw"] = 180.0;
        Poll(service, fake, ops);
        service.Turn(json{{"who", "a1"}, {"to", "v"}, {"hold", true}}, ops);
        fake.npcs["a1"]["command_state"] = "Success";
        Poll(service, fake, ops);
        fake.v["position"] = {6.0, 4.0, 0.0}; // V walks round to its side: the held facing would turn it
        fake.npcs["a1"]["command_state"] = "NotExecuting";
        n::TickInput closed;
        closed.writesOpen = [] { return false; };
        fake.calls.clear();
        service.Tick(1.1, closed, ops);
        Check("the gate closed: a held facing's re-turn isn't sent", !fake.Called("command a1 turn") && service.Active());
        n::TickInput open;
        open.writesOpen = [] { return true; };
        service.Tick(1.1, open, ops);
        Check("the gate open: the re-turn goes", fake.Called("command a1 turn"));
        service.Say(json{{"speaker", "A voice"}, {"text", "Over here."}, {"seconds", 10}}, ops);
        fake.npcs["a1"]["position"] = {0.0, 1.5, 0.0};
        fake.v["position"] = {0.0, 0.0, 0.0};
        Poll(service, fake, ops);
        service.Choices(json{{"who", "a1"}, {"choices", json::array({"Yes.", "No."})}}, ops);
        fake.calls.clear();
        const auto handover = service.ReleaseAllNow("handover", ops);
        Check("the handover: everything released in its own step (actor, hub, voice line)",
              handover["released"] == json::array({"a1"}) && handover["hub_withdrawn"] == true && handover["voice_lines_hidden"] == 1 && !service.Active() &&
                  fake.Called("release a1 despawn") && Events(log, "npc.auto_released").back()["data"]["reason"] == "handover");
        Check("the handover: nothing held, nothing to do", service.ReleaseAllNow("handover", ops)["released"].empty());
    }
}
// The Sol review of 0.8.6+npc: turns and placements replace a walk's tracking, placement on walkable ground only, an answer
// read before the hub expires, a hub the game took down, picks given back when busy or protected, and the tick's gated
// forward steps (an actor's preparation).
void ReviewTests()
{
    xfb::EventLog log;
    n::Service service;
    service.SetEvents(&log);
    Fake fake;
    auto ops = fake.Ops();
    int prepares = 0;
    ops.prepare = [&](const std::string& aWho) {
        ++prepares;
        fake.npcs[aWho]["prepared"] = true;
        return json{{"prepared", true}};
    };
    service.Spawn(json{{"cast", "woman_corpo"}, {"at", json{{"ahead_m", 5}}}}, ops);
    fake.npcs["a1"]["exists"] = true;
    fake.npcs["a1"]["spawned"] = true;
    fake.npcs["a1"]["prepared"] = false;
    n::TickInput closed;
    closed.writesOpen = [] { return false; };
    service.Tick(n::kPollSeconds + 0.01, closed, ops);
    Check("review 2: an unprepared actor isn't prepared while the gate is closed", prepares == 0 && Events(log, "npc.spawned").size() == 1);
    Poll(service, fake, ops);
    Check("review 2: prepared by the tick once the gate is open, once", prepares == 1);
    Poll(service, fake, ops);
    Check("review 2: not prepared twice", prepares == 1);

    // Finding 4: a turn replaces a walk; the walk never reports npc.arrived.
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 20, 0})}}, ops);
    const auto turn = service.Turn(json{{"who", "a1"}, {"to", "v"}}, ops);
    Check("review 4: a turn during a walk says it replaced the walk", turn["replaced"] == "move");
    fake.npcs["a1"]["position"] = {0.0, 19.5, 0.0};
    fake.npcs["a1"]["command_state"] = "Success";
    Poll(service, fake, ops);
    Check("review 4: the abandoned walk reports no npc.arrived", Events(log, "npc.arrived").empty());
    service.Move(json{{"who", "a1"}, {"to", json::array({0, 25, 0})}}, ops);
    fake.npcs["a1"]["command_state"] = "Executing";
    service.Place(json{{"who", "a1"}, {"at", json::array({0, 10, 0})}}, ops);
    Check("review 4: a placement ends the walk's tracking", !service.Status(json::object())["npcs"][0].contains("motion"));

    // Finding 3: placement only on walkable, streamed ground, snapped to it.
    fake.walkable = false;
    Check("review 3: a place with no walkable ground near it is refused", CodeOf([&] { service.Place(json{{"who", "a1"}, {"at", json::array({0, 4, -10})}}, ops); }) == "not_walkable");
    fake.walkable = true;
    auto groundOps = ops;
    groundOps.ground = [](const n::Vec3& aPoint) { return json{{"walkable", true}, {"streamed", true}, {"point", {aPoint[0], aPoint[1], 0.25}}}; };
    const auto placed = service.Place(json{{"who", "a1"}, {"at", json::array({1, 4, 3})}}, groundOps);
    Check("review 3: the actor goes to the snapped ground, not the asked point", Near(placed["at"][2].get<double>(), 0.25) && Near(placed["asked_at"][2].get<double>(), 3.0));
    auto unstreamed = ops;
    unstreamed.ground = [](const n::Vec3&) { return json{{"walkable", false}, {"streamed", false}}; };
    Check("review 3: unstreamed ground is refused not_streamed", CodeOf([&] { service.Place(json{{"who", "a1"}, {"at", json::array({0, 4, 0})}}, unstreamed); }) == "not_streamed");

    // Finding 5: an answer given just before max_s counts.
    fake.npcs["a1"]["position"] = {0.0, 2.0, 0.0};
    Poll(service, fake, ops);
    const auto hub = service.Choices(json{{"who", "a1"}, {"choices", json::array({"Yes.", "No."})}, {"max_s", 5}}, ops);
    fake.hub = json{{"id", hub["hub"]}, {"answer", 0}};
    service.Tick(5.1, {}, ops);
    auto choices = Events(log, "npc.choice");
    Check("review 5: the pick read at max_s wins over the timeout", choices.size() == 1 && choices[0]["data"]["index"] == 0 && !choices[0]["data"].contains("timeout"));
    fake.hub = json{{"id", 0}, {"answer", -1}};
    // Finding 8: the game took our hub down for its own prompt.
    const auto again = service.Choices(json{{"who", "a1"}, {"choices", json::array({"Yes.", "No."})}}, ops);
    fake.hub = json{{"id", again["hub"]}, {"answer", -1}, {"shown", false}, {"withdrawn", "busy"}};
    Poll(service, fake, ops);
    choices = Events(log, "npc.choice");
    Check("review 8: a hub the game withdrew ends with npc.choice {withdrawn, choices_busy}",
          choices.size() == 2 && choices[1]["data"]["withdrawn"] == true && choices[1]["data"]["reason"] == "choices_busy" && !service.Status(json::object())["hub"].is_object());
    fake.hub = json{{"id", 0}, {"answer", -1}};

    // Finding 1: a pick that turns busy (or protected) is given back at once, its look taken back.
    service.Pick(json{{"id", "E1"}}, ops);
    fake.npcs["p1"] = json{{"who", "p1"}, {"exists", true}, {"spawned", true}, {"position", {2.0, 2.0, 0.0}}, {"busy", ""}, {"protected", false}};
    service.Look(json{{"who", "p1"}, {"at", "v"}}, ops);
    Poll(service, fake, ops);
    Check("review 1: a calm pick stays", service.Status(json::object())["npcs"].size() == 2);
    fake.npcs["p1"]["busy"] = "combat";
    fake.calls.clear();
    Poll(service, fake, ops);
    const auto autos = Events(log, "npc.auto_released");
    Check("review 1: a pick that starts fighting is given back (look off, left to its AI, never removed)",
          !autos.empty() && autos.back()["data"]["who"] == "p1" && autos.back()["data"]["reason"] == "npc_busy" && fake.Called("look p1 off") && fake.Called("release p1 leave"));
    service.Pick(json{{"id", "E1"}}, ops);
    fake.npcs["p2"] = json{{"who", "p2"}, {"exists", true}, {"spawned", true}, {"position", {2.0, 2.0, 0.0}}, {"busy", ""}, {"protected", true}};
    Poll(service, fake, ops);
    Check("review 1: a pick that turns protected is given back", Events(log, "npc.auto_released").back()["data"]["reason"] == "npc_protected");
    const auto p3 = service.Pick(json{{"id", "E1"}}, ops)["who"].get<std::string>();
    Check("review 1: picks are never moved, placed, turned or removed",
          CodeOf([&] { service.Place(json{{"who", p3}, {"at", json::array({0, 1, 0})}}, ops); }) == "not_ours" &&
              CodeOf([&] { service.Move(json{{"who", p3}, {"to", "v"}}, ops); }) == "not_ours" &&
              CodeOf([&] { service.Turn(json{{"who", p3}, {"to", "v"}}, ops); }) == "not_ours" &&
              CodeOf([&] { service.Release(json{{"who", p3}, {"how", "despawn"}}, ops); }) == "bad_params");
}
} // namespace

int RunNpcUnitTests()
{
    gNpcFailures = 0;
    PureTests();
    RefusalTests();
    TickTests();
    ReleaseTests();
    DirectorTests();
    StagingTests();
    ReviewTests();
    return gNpcFailures;
}
