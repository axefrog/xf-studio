// Unit checks for bridge 0.8.12's live-direction toolkit (core/Dm080.cpp: the parameter checks, undos, watchers, the session's
// phone call, timed lines, tracker and light patterns; core/DmService.cpp: the commands' refusal order, registry, release and
// tick). Run with `xfb_selftest --unit`; same PASS/FAIL line format as UnitTests.cpp.

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
#include <string>
#include <vector>

#include "core/Dispatcher.hpp"
#include "core/DmService.hpp"
#include "core/DmMicro.hpp"
#include <chrono>
#include <condition_variable>
#include <future>
#include <mutex>
#include "core/Events.hpp"

namespace
{
using json = nlohmann::json;
namespace d = xfb::dm;

int gFailures = 0;

void Check(const char* aName, bool aOk)
{
    if (!aOk)
    {
        ++gFailures;
    }
    std::printf("%s unit: %s\n", aOk ? "PASS" : "FAIL", aName);
    std::fflush(stdout);
}

std::string Code(const std::function<void()>& aCall)
{
    try
    {
        aCall();
        return "ok";
    }
    catch (const xfb::MethodError& e)
    {
        return e.code;
    }
    catch (const std::exception& e)
    {
        return std::string("exception: ") + e.what();
    }
}

bool Near(double aA, double aB, double aEps = 1e-6)
{
    return std::fabs(aA - aB) <= aEps;
}

// --- the parameter checks ---------------------------------------------------------------------------------------------

void ParseTests()
{
    Check("dm: a prop spawns from a template path or a record, one of them",
          d::ParseSpawn(json{{"template", "base\\gameplay\\x\\prop.ent"}}).kind == "prop" && d::ParseSpawn(json{{"record", "Props.sample_box"}}).record == "Props.sample_box" &&
              Code([] { d::ParseSpawn(json::object()); }) == "bad_params" &&
              Code([] { d::ParseSpawn(json{{"template", "base\\x.ent"}, {"record", "Props.a"}}); }) == "bad_params");
    Check("dm: a vehicle needs a record and no template; the template path is checked",
          d::ParseSpawn(json{{"kind", "vehicle"}, {"record", "Vehicle.v_test"}}).kind == "vehicle" &&
              Code([] { d::ParseSpawn(json{{"kind", "vehicle"}, {"template", "base\\x.ent"}}); }) == "bad_params" &&
              Code([] { d::ParseSpawn(json{{"template", "..\\x.ent"}}); }) == "bad_params" && Code([] { d::ParseSpawn(json{{"template", "base\\x.mesh"}}); }) == "bad_params" &&
              Code([] { d::ParseSpawn(json{{"template", "base\\x y.ent"}}); }) == "bad_params" && Code([] { d::ParseSpawn(json{{"record", "not a record"}}); }) == "bad_params" &&
              d::TemplatePathOk("base\\gameplay\\devices\\lamp_01.ent") && !d::TemplatePathOk("\\base\\x.ent") && !d::TemplatePathOk(std::string(210, 'a') + ".ent"));
    Check("dm: a place is an offset from V or a world point, never both, and a facing is a yaw or face_v",
          d::ParseWhere(json{{"offset", {{"forward", 3.0}, {"right", -1.0}}}}).forward == 3.0 && d::ParseWhere(json{{"at", {10, 20, 30}}}).mode == d::Where::Mode::World &&
              d::ParseWhere(json::object()).forward == 2.0 && Code([] { d::ParseWhere(json{{"at", {1, 2, 3}}, {"offset", {{"forward", 1.0}}}}); }) == "bad_params" &&
              Code([] { d::ParseWhere(json{{"yaw", 10.0}, {"face_v", true}}); }) == "bad_params" && Code([] { d::ParseWhere(json{{"offset", {{"sideways", 1.0}}}}); }) == "bad_params" &&
              Code([] { d::ParseWhere(json{{"offset", {{"forward", 61.0}}}}); }) == "bad_params");
    Check("dm: a target is a word, spawn:<n>, EntityID(n) or digits; nothing else",
          d::TargetOk("v", {"v"}) && d::TargetOk("spawn:3", {}) && d::TargetOk("EntityID(1234)", {}) && d::TargetOk("1234", {}) && !d::TargetOk("v", {"look_at"}) &&
              !d::TargetOk("spawn:0", {}) && !d::TargetOk("spawn:x", {}) && !d::TargetOk("EntityID()", {}) && !d::TargetOk("EntityID(1a)", {}) && !d::TargetOk("look at", {"look_at"}) &&
              d::SpawnHandleOf("spawn:12") == 12 && d::SpawnHandleOf("v") == 0 && d::SpawnHandleOf("spawn:") == 0);
    Check("dm: a colour is [r, g, b] or #rrggbb, whole numbers in range",
          d::ParseColour(json{{"c", {1, 2, 3}}}, "c", {0, 0, 0})[2] == 3 && d::ParseColour(json{{"c", "#ff8000"}}, "c", {0, 0, 0})[1] == 128 &&
              d::ParseColour(json::object(), "c", {9, 9, 9})[0] == 9 && Code([] { d::ParseColour(json{{"c", {1, 2, 256}}}, "c", {0, 0, 0}); }) == "bad_params" &&
              Code([] { d::ParseColour(json{{"c", "#ff80"}}, "c", {0, 0, 0}); }) == "bad_params" && Code([] { d::ParseColour(json{{"c", {1, 2}}}, "c", {0, 0, 0}); }) == "bad_params");
    Check("dm: a door needs something to change and cannot be open and locked",
          d::ParseDoor(json{{"target", "look_at"}, {"locked", true}}).locked.value_or(false) && Code([] { d::ParseDoor(json{{"target", "look_at"}}); }) == "bad_params" &&
              Code([] { d::ParseDoor(json{{"target", "look_at"}, {"open", true}, {"locked", true}}); }) == "bad_params" &&
              Code([] { d::ParseDoor(json{{"locked", true}}); }) == "bad_params" && Code([] { d::ParseDoor(json{{"target", "mounted"}, {"locked", true}}); }) == "bad_params");
    Check("dm: a vehicle takes lights, engine, or a door with its state; the door and state come together",
          d::ParseVehicle(json{{"target", "mounted"}, {"engine", true}}).engine.value_or(false) &&
              d::ParseVehicle(json{{"target", "mounted"}, {"door", "trunk"}, {"door_state", "open"}}).door == "trunk" &&
              Code([] { d::ParseVehicle(json{{"target", "mounted"}}); }) == "bad_params" && Code([] { d::ParseVehicle(json{{"target", "mounted"}, {"door", "trunk"}}); }) == "bad_params" &&
              Code([] { d::ParseVehicle(json{{"target", "mounted"}, {"door", "wing"}, {"door_state", "open"}}); }) == "bad_params");
    Check("dm: a sound event is letters, digits and _, plays on V by default, loops until stopped, and stop takes an id or all",
          d::ParsePlay(json{{"event", "ui_phone_sms"}}).on == "v" && d::ParsePlay(json{{"event", "x"}, {"loop", true}}).seconds == 3600.0 &&
              Code([] { d::ParsePlay(json{{"event", "bad event"}}); }) == "bad_params" && Code([] { d::ParsePlay(json{{"event", "x"}, {"at", {1, 2, 3}}}); }) == "bad_params" &&
              d::ParseStop(json{{"all", true}}).all && d::ParseStop(json{{"id", 3}}).id == 3 && Code([] { d::ParseStop(json::object()); }) == "bad_params" &&
              Code([] { d::ParseStop(json{{"id", 3}, {"all", true}}); }) == "bad_params");
    Check("dm: a radio station is 0 to 13 or a name; a voice line names its context",
          d::ParseRadio(json{{"target", "mounted"}, {"station", "jazz"}}).station.value_or(-1) == 10 && d::ParseRadio(json{{"target", "mounted"}, {"station", 4}}).station.value_or(-1) == 4 &&
              d::ParseRadio(json{{"target", "mounted"}, {"on", false}}).on.has_value() && Code([] { d::ParseRadio(json{{"target", "mounted"}, {"station", 14}}); }) == "bad_params" &&
              Code([] { d::ParseRadio(json{{"target", "mounted"}, {"station", "polka"}}); }) == "bad_params" && Code([] { d::ParseRadio(json{{"target", "mounted"}}); }) == "bad_params" &&
              d::RadioStations().size() == 14 && d::ParseVoice(json{{"target", "look_at"}, {"context", "greeting"}}).context == "greeting" &&
              Code([] { d::ParseVoice(json{{"target", "look_at"}}); }) == "bad_params");
    Check("dm: a light's cone comes in pairs and a pattern is one of six kinds",
          d::ParseLightSpawn(json{{"inner", 20}, {"outer", 45}}).outer.value_or(0) == 45 && Code([] { d::ParseLightSpawn(json{{"inner", 20}}); }) == "bad_params" &&
              Code([] { d::ParseLightSpawn(json{{"inner", 50}, {"outer", 20}}); }) == "bad_params" && Code([] { d::ParseLightSpawn(json{{"pattern", "disco"}}); }) == "bad_params" &&
              d::ParseLightSpawn(json{{"pattern", "strobe"}}).pattern.low == 0.0 && d::ParseLightSpawn(json{{"pattern", {{"kind", "pulse"}, {"period", 2.0}}}}).pattern.period == 2.0 &&
              d::ParseLightSpawn(json{{"template", "base\\fx\\lamp.ent"}}).templatePath == "base\\fx\\lamp.ent" && Code([] { d::ParseLightSpawn(json{{"template", "lamp"}}); }) == "bad_params");
    Check("dm: light.set needs an id and something to change",
          d::ParseLightSet(json{{"id", 2}, {"intensity", 5.0}}).handle == 2 && Code([] { d::ParseLightSet(json{{"id", 2}}); }) == "bad_params" &&
              Code([] { d::ParseLightSet(json{{"intensity", 5.0}}); }) == "bad_params" && Code([] { d::ParseLightSet(json{{"id", 2}, {"inner", 10}}); }) == "bad_params" &&
              d::ParseLightSet(json{{"id", 2}, {"on", false}}).on.has_value());
    Check("dm: a message is a contact and text; a call is a contact id, 1 to 16 lines, a mode",
          d::ParseText(json{{"contact", "Test Sender"}, {"text", "hello"}}).contact == "Test Sender" && Code([] { d::ParseText(json{{"contact", "x"}}); }) == "bad_params" &&
              Code([] { d::ParseText(json{{"contact", "x"}, {"text", "y"}, {"open_s", 5}}); }) == "bad_params" &&
              d::ParseCall(json{{"contact", "test_fixer"}, {"lines", json::array({json{{"text", "first"}}})}}).lines.size() == 1 &&
              d::ParseCall(json{{"contact", "test_fixer"}, {"mode", "video"}, {"lines", json::array({json{{"text", "a"}, {"speaker", "S"}, {"seconds", 2.0}}})}}).video &&
              Code([] { d::ParseCall(json{{"contact", "test_fixer"}, {"lines", json::array()}}); }) == "bad_params" &&
              Code([] { d::ParseCall(json{{"contact", "bad id"}, {"lines", json::array({json{{"text", "a"}}})}}); }) == "bad_params" &&
              Code([] { d::ParseCall(json{{"contact", "test_fixer"}, {"lines", json::array({json{{"words", "a"}}})}}); }) == "bad_params");
    {
        json lines = json::array();
        for (int i = 0; i < 17; ++i)
        {
            lines.push_back(json{{"text", "line"}});
        }
        Check("dm: a call refuses 17 lines", Code([&] { d::ParseCall(json{{"contact", "test_fixer"}, {"lines", lines}}); }) == "bad_params");
    }
    Check("dm: a quest has an id, a title and up to 8 objectives with unique ids",
          d::ParseQuestSet(json{{"id", "q1"}, {"title", "A test quest"}, {"objectives", json::array({json{{"id", "a"}, {"text", "Do it"}}})}}).quest.objectives.size() == 1 &&
              Code([] { d::ParseQuestSet(json{{"id", "q 1"}, {"title", "t"}}); }) == "bad_params" &&
              Code([] { d::ParseQuestSet(json{{"id", "q1"}, {"title", "t"}, {"objectives", json::array({json{{"id", "a"}, {"text", "x"}}, json{{"id", "a"}, {"text", "y"}}})}}); }) == "bad_params" &&
              Code([] { d::ParseQuestSet(json{{"id", "q1"}, {"title", "t"}, {"objectives", json::array({json{{"id", "a"}, {"text", "x"}, {"pin_id", 3}}})}}); }) == "bad_params" &&
              d::ParseObjective(json{{"quest", "q1"}, {"objective", "a"}, {"state", "done"}}).state.value_or("") == "done" &&
              Code([] { d::ParseObjective(json{{"quest", "q1"}, {"objective", "a"}}); }) == "bad_params");
    {
        // A quest round-trips through its record (the undo).
        auto set = d::ParseQuestSet(json{{"id", "q1"}, {"title", "T"}, {"objectives", json::array({json{{"id", "a"}, {"text", "Go there"}, {"optional", true},
                                                                                                     {"area", {{"at", {1, 2, 3}}, {"radius_m", 4.0}, {"complete_on_enter", true}}}}})}});
        const auto again = d::QuestFromJson(d::QuestJson(set.quest));
        Check("dm: a quest comes back from its record, area link and all",
              again.id == "q1" && again.objectives.size() == 1 && again.objectives[0].optional && again.objectives[0].area && again.objectives[0].area->completeOnEnter &&
                  Near(again.objectives[0].area->radius, 4.0));
    }
    Check("dm: notify styles, and a subtitle needs a speaker",
          d::ParseNotify(json{{"style", "warning"}, {"text", "x"}}).style == "warning" && d::ParseNotify(json{{"style", "subtitle"}, {"text", "x"}, {"speaker", "S"}}).speaker == "S" &&
              Code([] { d::ParseNotify(json{{"style", "subtitle"}, {"text", "x"}}); }) == "bad_params" && Code([] { d::ParseNotify(json{{"style", "popup"}, {"text", "x"}}); }) == "bad_params" &&
              Code([] { d::ParseNotify(json{{"style", "xp"}, {"text", "x"}}); }) == "bad_params" && Code([] { d::ParseNotify(json{{"style", "warning"}, {"text", "x"}, {"speaker", "S"}}); }) == "bad_params" &&
              d::NotifyStyles().size() == 7);
    Check("dm: digest events are 0 to 32 and kinds are plain names",
          d::ParseDigest(json{{"events", 4}}).events == 4 && d::ParseDigest(json{{"kinds", json::array({"dm.watch"})}}).kinds.size() == 1 &&
              Code([] { d::ParseDigest(json{{"events", 33}}); }) == "bad_params" && Code([] { d::ParseDigest(json{{"kinds", json::array({"bad kind"})}}); }) == "bad_params" &&
              d::HpBand(100) == "full" && d::HpBand(62) == "high" && d::HpBand(30) == "mid" && d::HpBand(12) == "low" && d::HpBand(3) == "critical" && d::HpBand(-1) == "unknown");
}

// --- the undos ------------------------------------------------------------------------------------------------------------

void UndoTests()
{
    const auto spawn = d::SpawnUndo(4);
    Check("dm: a spawn's undo removes its handle", spawn["method"] == "world.despawn" && spawn["params"]["id"] == 4);
    {
        const auto undos = d::DespawnUndo(json::array({json{{"kind", "prop"}, {"template", "base\\x.ent"}, {"position", {1, 2, 3}}, {"yaw", 90.0}, {"label", "box"}},
                                                       json{{"kind", "vehicle"}, {"record", "Vehicle.v_test"}, {"position", {4, 5, 6}}, {"yaw", 0.0}},
                                                       json{{"kind", "light"}, {"position", {0, 0, 0}}, {"yaw", 0.0}}}));
        Check("dm: a despawn's undo spawns each prop and vehicle again where it stood, and leaves lights to light.spawn",
              undos.size() == 2 && undos[0]["method"] == "world.spawn" && undos[0]["params"]["template"] == "base\\x.ent" && undos[0]["params"]["ground"] == false &&
                  undos[0]["params"]["at"][2] == 3 && undos[0]["params"]["yaw"] == 90.0 && undos[0]["params"]["label"] == "box" && undos[1]["params"]["kind"] == "vehicle" &&
                  d::DespawnUndo(json::array()).empty());
    }
    {
        const auto request = d::ParseDoor(json{{"target", "look_at"}, {"open", true}});
        const json step{{"target_id", "EntityID(8102)"}, {"before", {{"open", false}, {"locked", true}, {"sealed", false}}}};
        const auto undo = d::DoorUndo(step, request);
        Check("dm: opening a locked door is undone by closing and locking it again",
              undo["method"] == "world.door" && undo["params"]["target"] == "EntityID(8102)" && undo["params"]["open"] == false && undo["params"]["locked"] == true);
        const json same{{"target_id", "EntityID(8101)"}, {"before", {{"open", true}, {"locked", false}, {"sealed", false}}}};
        Check("dm: a door change that changed nothing has no undo", d::DoorUndo(same, request).is_null() && d::DoorUndo(json::object(), request).is_null());
    }
    {
        const auto request = d::ParseVehicle(json{{"target", "mounted"}, {"engine", true}, {"lights", true}, {"door", "trunk"}, {"door_state", "open"}});
        const json step{{"target_id", "EntityID(8201)"}, {"before", {{"engine", false}, {"doors", {{"trunk", "closed"}}}}}};
        const auto undo = d::VehicleUndo(step, request);
        Check("dm: a vehicle change is undone engine, doors and lights (the other way) back",
              undo["method"] == "vehicle.set" && undo["params"]["engine"] == false && undo["params"]["lights"] == false && undo["params"]["door"] == "trunk" &&
                  undo["params"]["door_state"] == "closed");
        const auto lock = d::ParseVehicle(json{{"target", "mounted"}, {"door", "all"}, {"door_state", "locked"}});
        Check("dm: locking is undone by unlocking", d::VehicleUndo(step, lock)["params"]["door_state"] == "unlocked");
    }
    {
        const auto request = d::ParseRadio(json{{"target", "mounted"}, {"station", 9}, {"on", true}});
        const json step{{"target_id", "EntityID(8201)"}, {"before", {{"station", 4}, {"on", false}}}};
        const auto undo = d::RadioUndo(step, request);
        Check("dm: a radio change is undone to its station and state", undo["params"]["station"] == 4 && undo["params"]["on"] == false &&
                                                                      d::RadioUndo(json{{"target_id", "x"}, {"before", {{"station", 9}, {"on", true}}}}, request).is_null());
    }
    {
        const json before{{"colour", {1, 2, 3}}, {"intensity", 50.0}, {"radius", 4.0}, {"inner", 10.0}, {"outer", 30.0}, {"on", true}};
        const auto undo = d::LightSetUndo(2, before, std::nullopt);
        Check("dm: a light's undo puts its values and its steady pattern back",
              undo["method"] == "light.set" && undo["params"]["id"] == 2 && undo["params"]["intensity"] == 50.0 && undo["params"]["pattern"]["kind"] == "steady");
        d::LightPattern pulse;
        pulse.kind = "pulse";
        Check("dm: a light's undo restores the pattern it ran", d::LightSetUndo(2, json::object(), pulse)["params"]["pattern"]["kind"] == "pulse");
    }
}

// --- light patterns ---------------------------------------------------------------------------------------------------------

void PatternTests()
{
    d::LightPattern pulse;
    pulse.kind = "pulse";
    pulse.period = 2.0;
    pulse.low = 0.2;
    Check("dm: a pulse swings between its low share and full over its period",
          Near(d::PatternValue(pulse, 0.0), 1.0, 1e-9) && Near(d::PatternValue(pulse, 1.0), 0.2, 1e-9) && Near(d::PatternValue(pulse, 2.0), 1.0, 1e-9));
    d::LightPattern strobe = d::ParsePattern("strobe");
    Check("dm: a strobe is on for half its period and dark for the other half",
          d::PatternValue(strobe, 0.0) == 1.0 && d::PatternValue(strobe, 0.15) == 0.0 && d::PatternValue(strobe, 0.2) == 1.0);
    d::LightPattern broken = d::ParsePattern("broken");
    bool inRange = true, sawDrop = false;
    for (int i = 0; i < 2000; ++i)
    {
        const double v = d::PatternValue(broken, i * 0.01);
        inRange = inRange && v >= 0.0 && v <= 1.0;
        sawDrop = sawDrop || v < 1.0;
    }
    Check("dm: a broken tube mostly holds and drops out in bursts, the same way for the same seed",
          inRange && sawDrop && d::PatternValue(broken, 3.7) == d::PatternValue(broken, 3.7));
    d::LightPattern candle = d::ParsePattern("candle");
    bool candleOk = true;
    for (int i = 0; i < 500; ++i)
    {
        const double v = d::PatternValue(candle, i * 0.05);
        candleOk = candleOk && v >= candle.low + (1.0 - candle.low) * 0.75 - 1e-9 && v <= 1.0 + 1e-9;
    }
    Check("dm: a candle wanders in the top quarter of its range; steady and flicker leave the intensity to the engine",
          candleOk && d::PatternValue(d::ParsePattern("steady"), 1.0) == 1.0 && d::PatternValue(d::ParsePattern("flicker"), 1.0) == 1.0);
}

// --- watchers ------------------------------------------------------------------------------------------------------------------

d::Sample At(double aX, double aY)
{
    d::Sample sample;
    sample.valid = true;
    sample.v = {aX, aY, 10.0};
    return sample;
}

d::WatchSpec Watch(const json& aParams)
{
    return d::ParseWatch(aParams, {});
}

void WatcherTests()
{
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "w1"}, {"kind", "enter"}, {"at", {100, 200, 10}}, {"radius_m", 5.0}, {"now", false}}), 0.0);
        const auto none = engine.Evaluate(At(120, 200), 0.1);
        const auto fired = engine.Evaluate(At(101, 200), 0.2);
        Check("dm: an enter watcher fires once V crosses into the radius and is gone after (not repeating)", none.empty() && fired.size() == 1 && fired[0].id == "w1" && engine.Empty());
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "w2"}, {"kind", "enter"}, {"at", {100, 200, 10}}, {"radius_m", 5.0}, {"repeat", true}, {"cooldown_s", 1.0}}), 0.0);
        const auto first = engine.Evaluate(At(101, 200), 0.1);
        const auto inside = engine.Evaluate(At(101, 201), 0.2);
        engine.Evaluate(At(130, 200), 0.3);
        const auto early = engine.Evaluate(At(101, 200), 0.5);
        engine.Evaluate(At(130, 200), 1.0);
        const auto later = engine.Evaluate(At(101, 200), 1.6);
        Check("dm: an enter watcher that already holds fires on its first sample, repeats on a new entry and keeps its cooldown",
              first.size() == 1 && inside.empty() && early.empty() && later.size() == 1 && !engine.Empty());
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "w3"}, {"kind", "leave"}, {"at", {100, 200, 10}}, {"radius_m", 5.0}}), 0.0);
        const auto outsideStart = engine.Evaluate(At(130, 200), 0.1);
        engine.Evaluate(At(101, 200), 0.2);
        const auto left = engine.Evaluate(At(120, 200), 0.3);
        Check("dm: a leave watcher waits for V to have been inside, then fires when she is out", outsideStart.empty() && left.size() == 1);
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "g"}, {"kind", "gaze"}, {"target", "spawn:1"}, {"seconds", 1.0}, {"cone_deg", 10.0}, {"max_m", 20.0}}), 0.0);
        d::Sample sample = At(100, 200);
        sample.camPos = {100, 200, 11.6};
        sample.camFwd = {0, 1, 0};
        sample.entities["spawn:1"] = {100, 205, 11.6};
        std::vector<d::Fired> fired;
        double dwellAt = -1.0;
        for (int i = 1; i <= 15; ++i)
        {
            const auto now = i * 0.1;
            auto out = engine.Evaluate(sample, now);
            if (!out.empty() && fired.empty())
            {
                fired = out;
                dwellAt = now;
            }
        }
        Check("dm: a gaze watcher fires after the dwell, not before", fired.size() == 1 && dwellAt >= 1.0 - 1e-6 && dwellAt <= 1.2);
        d::WatcherEngine glance;
        glance.Arm(Watch(json{{"id", "g2"}, {"kind", "gaze"}, {"target", "spawn:1"}, {"seconds", 1.0}, {"cone_deg", 10.0}}), 0.0);
        d::Sample away = sample;
        away.camFwd = {1, 0, 0};
        bool any = false;
        for (int i = 1; i <= 30; ++i)
        {
            any = any || !glance.Evaluate(i % 2 == 0 ? away : sample, i * 0.1).empty();
        }
        Check("dm: a glance that keeps breaking resets the gaze dwell", !any);
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "a"}, {"kind", "weapon"}, {"edge", "on"}, {"now", false}}), 0.0);
        engine.Arm(Watch(json{{"id", "b"}, {"kind", "combat"}, {"edge", "on"}, {"now", false}}), 0.0);
        engine.Arm(Watch(json{{"id", "c"}, {"kind", "vehicle"}, {"edge", "off"}, {"now", false}}), 0.0);
        d::Sample sample = At(0, 0);
        sample.vehicle = true;
        const auto none = engine.Evaluate(sample, 0.1);
        sample.weapon = true;
        sample.combat = true;
        sample.vehicle = false;
        const auto fired = engine.Evaluate(sample, 0.2);
        Check("dm: weapon, combat and vehicle watchers fire on their edge", none.empty() && fired.size() == 3);
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "t"}, {"kind", "timer"}, {"seconds", 2.0}}), 10.0);
        Check("dm: a timer needs no sample and fires at its time", engine.Advance(11.0).empty() && engine.Advance(12.1).size() == 1 && engine.Empty() && !engine.NeedsSamples());
        engine.Arm(Watch(json{{"id", "e"}, {"kind", "enter"}, {"at", {0, 0, 0}}, {"expires_s", 5.0}}), 0.0);
        const auto expired = engine.Advance(5.5);
        Check("dm: a watcher expires without firing and says so", expired.size() == 1 && expired[0].expired && engine.Empty());
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "k"}, {"kind", "clock"}, {"clock", "00:10"}}), 0.0);
        d::Sample before = At(0, 0);
        before.tod = 86400.0 - 300.0;
        engine.Evaluate(before, 0.1);
        d::Sample after = At(0, 0);
        after.tod = 700.0;
        const auto fired = engine.Evaluate(after, 0.2);
        Check("dm: a clock watcher fires when the time of day passes its mark, past midnight too", fired.size() == 1);
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "i"}, {"kind", "interact"}, {"caption", "open"}}), 0.0);
        engine.Arm(Watch(json{{"id", "c"}, {"kind", "choice"}, {"index", 1}}), 0.0);
        const auto wants = engine.Wants();
        d::Sample sample = At(0, 0);
        sample.events.push_back(json{{"type", "interact"}, {"caption", "Use"}, {"target", "EntityID(1)"}});
        const auto miss = engine.Evaluate(sample, 0.1);
        sample.events = {json{{"type", "interact"}, {"caption", "Open door"}, {"target", "EntityID(1)"}}, json{{"type", "choice"}, {"index", 0}, {"caption", "x"}}};
        const auto wrongIndex = engine.Evaluate(sample, 0.2);
        sample.events = {json{{"type", "choice"}, {"index", 1}, {"caption", "y"}}};
        const auto choice = engine.Evaluate(sample, 0.3);
        Check("dm: interact and choice watchers match the caption part and the index",
              miss.empty() && wrongIndex.size() == 1 && wrongIndex[0].id == "i" && choice.size() == 1 && choice[0].id == "c");
        Check("dm: watchers on events ask the sample for events and for what V looks at", wants.events && wants.lookAt);
    }
    Check("dm: a watcher's kind and its needs are checked",
          Code([] { Watch(json{{"kind", "enter"}}); }) == "bad_params" && Code([] { Watch(json{{"kind", "enter"}, {"at", {1, 2, 3}}, {"target", "spawn:1"}}); }) == "bad_params" &&
              Code([] { Watch(json{{"kind", "gaze"}}); }) == "bad_params" && Code([] { Watch(json{{"kind", "timer"}}); }) == "bad_params" &&
              Code([] { Watch(json{{"kind", "clock"}}); }) == "bad_params" && Code([] { Watch(json{{"kind", "clock"}, {"clock", "25:00"}}); }) == "bad_params" &&
              Code([] { Watch(json{{"kind", "dance"}}); }) == "bad_params" && Code([] { Watch(json{{"kind", "weapon"}, {"target", "any"}}); }) == "bad_params" &&
              d::ParseWatch(json{{"kind", "interact"}, {"target", "any"}}, {}).entity == "any" && Watch(json{{"kind", "clock"}, {"clock", "07:30"}}).clockSeconds == 7.5 * 3600.0);
    {
        const d::ActionCheck check = [](const std::string& aMethod) -> std::string { return aMethod == "notify.show" || aMethod == "light.set" ? "" : "not allowed"; };
        const auto ok = d::ParseWatch(json{{"kind", "weapon"}, {"actions", json::array({json{{"method", "notify.show"}, {"params", {{"style", "warning"}, {"text", "x"}}}, {"delay_s", 1.0}}})}}, check);
        Check("dm: a watcher's micro-actions are checked against the dispatcher and kept in order",
              ok.actions.size() == 1 && ok.actions[0].delayS == 1.0 &&
                  Code([&] { d::ParseWatch(json{{"kind", "weapon"}, {"actions", json::array({json{{"method", "game.save"}}})}}, check); }) == "bad_params" &&
                  Code([&] { d::ParseWatch(json{{"kind", "weapon"}, {"actions", json::array({json{{"method", "audio.stop"}}})}}, check); }) == "bad_params" &&
                  Code([&] { d::ParseWatch(json{{"kind", "weapon"}, {"actions", json::array({json{{"method", "Notify.Show"}}})}}, check); }) == "bad_params");
        json nine = json::array();
        for (int i = 0; i < 9; ++i)
        {
            nine.push_back(json{{"method", "notify.show"}});
        }
        Check("dm: a watcher carries at most 8 actions, none that re-arm with actions of their own or run away with save, load, kill or handover",
              Code([&] { d::ParseWatch(json{{"kind", "weapon"}, {"actions", nine}}, check); }) == "bad_params" &&
                  d::MicroMethodDenied("game.save") && d::MicroMethodDenied("game.load") && d::MicroMethodDenied("bridge.kill") && d::MicroMethodDenied("bridge.handover") &&
                  d::MicroMethodDenied("selftest.dm") && !d::MicroMethodDenied("notify.show") && d::MicroAccessAllowed("write-dm") && d::MicroAccessAllowed("read") &&
                  !d::MicroAccessAllowed("write-save") && !d::MicroAccessAllowed("write-inventory") && !d::MicroAccessAllowed("control"));
        const d::ActionCheck any = [](const std::string&) -> std::string { return ""; };
        Check("dm: a watcher armed by an action cannot carry actions of its own",
              Code([&] {
                  d::ParseWatch(json{{"kind", "weapon"},
                                     {"actions", json::array({json{{"method", "watch.arm"}, {"params", {{"kind", "weapon"}, {"actions", json::array({json{{"method", "notify.show"}}})}}}}})}},
                                any);
              }) == "bad_params");
    }
    {
        d::WatcherEngine engine;
        for (int i = 0; i < 16; ++i)
        {
            engine.Arm(Watch(json{{"id", "w" + std::to_string(i)}, {"kind", "weapon"}}), 0.0);
        }
        const auto over = Code([&] { engine.Arm(Watch(json{{"id", "extra"}, {"kind", "weapon"}}), 0.0); });
        engine.Arm(Watch(json{{"id", "w3"}, {"kind", "combat"}}), 0.0);
        Check("dm: sixteen watchers at most, and an armed id is replaced, not doubled", over == "too_many" && engine.Count() == 16);
    }
}

// --- the session: the phone call, lines, tracker, light patterns -----------------------------------------------------------

struct FakeGame
{
    std::vector<std::string> log;
    json sample = json::object();
    std::vector<d::TimedLine> shown;
    std::vector<uint64_t> hidden;
    std::vector<std::vector<d::Quest>> trackerCalls;
    std::vector<std::pair<int32_t, double>> lights;
    std::vector<d::MicroBatch> batches;
    std::vector<std::string> events;
    bool refuseRing = false;
    bool trackerFails = false;
};

d::SessionOps OpsOf(FakeGame& aGame)
{
    d::SessionOps ops;
    ops.sample = [&aGame](const d::SampleWants& aWants) {
        aGame.log.push_back("sample:" + aWants.callContact);
        return aGame.sample;
    };
    ops.showLine = [&aGame](const d::TimedLine& aLine) { aGame.shown.push_back(aLine); };
    ops.hideLine = [&aGame](uint64_t aId) { aGame.hidden.push_back(aId); };
    ops.callRing = [&aGame](const std::string& aContact, const std::string& aMode, bool) {
        if (aGame.refuseRing)
        {
            throw xfb::MethodError("contact_unknown", "no such contact");
        }
        aGame.log.push_back("ring:" + aContact + ":" + aMode);
    };
    ops.callStart = [&aGame](const std::string& aContact, const std::string&) { aGame.log.push_back("start:" + aContact); };
    ops.callEnd = [&aGame](const std::string& aContact) { aGame.log.push_back("end:" + aContact); return true; };
    ops.tracker = [&aGame](const std::vector<d::Quest>& aQuests) {
        if (aGame.trackerFails)
        {
            throw xfb::MethodError("hud_missing", "no tracker");
        }
        aGame.trackerCalls.push_back(aQuests);
    };
    ops.lightIntensity = [&aGame](int32_t aHandle, double aValue) { aGame.lights.push_back({aHandle, aValue}); };
    ops.event = [&aGame](const std::string& aKind, const std::string&, const std::string& aText, const json&) { aGame.events.push_back(aKind + ": " + aText); };
    ops.micro = [&aGame](d::MicroBatch aBatch) { aGame.batches.push_back(std::move(aBatch)); };
    return ops;
}

d::CallRequest Call(int aLines = 2)
{
    json lines = json::array();
    for (int i = 0; i < aLines; ++i)
    {
        lines.push_back(json{{"text", "Line " + std::to_string(i + 1)}, {"speaker", "Caller"}, {"seconds", 2.0}});
    }
    return d::ParseCall(json{{"contact", "test_fixer"}, {"ring_s", 10.0}, {"lines", lines}});
}

bool Has(const FakeGame& aGame, const std::string& aEntry)
{
    return std::find(aGame.log.begin(), aGame.log.end(), aEntry) != aGame.log.end();
}

void SessionTests()
{
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        const auto out = session.Call(Call(), 0.0);
        const auto busy = Code([&] { session.Call(Call(), 0.1); });
        Check("dm: a call rings through the game's phone and is one at a time, with an undo that ends it",
              out["state"] == "ringing" && Has(game, "ring:test_fixer:audio") && busy == "busy" && out["undo"]["method"] == "phone.end");
        game.sample = json{{"v", {1, 2, 3}}, {"call_fact", 1}};
        session.Tick(0.5);
        game.sample = json{{"v", {1, 2, 3}}, {"call_fact", 2}};
        session.Tick(1.0);
        const auto answered = session.PhoneState(1.0);
        Check("dm: the player's pickup (the call's fact reads 2) starts the call and queues its lines",
              answered["call"]["state"] == "answered" && Has(game, "start:test_fixer") && game.log.back() != "ring:test_fixer:audio");
        session.Tick(1.7);
        session.Tick(3.9);
        const auto firstShown = game.shown.size();
        session.Tick(5.0);
        session.Tick(7.0);
        Check("dm: the lines come one after the other in the holocall style and are hidden when their time ends",
              firstShown >= 1 && game.shown.size() == 2 && game.shown[0].type == 2 && game.shown[0].speaker == "Caller" && game.shown[0].start < game.shown[1].start &&
                  game.hidden.size() >= 1 && Has(game, "end:test_fixer") == (session.PhoneState(7.0)["call"]["state"] == "ended"));
        session.Tick(9.5);
        Check("dm: the call ends after its last line, ends the game's call and frees the phone",
              session.PhoneState(9.5)["call"]["state"] == "ended" && Has(game, "end:test_fixer") && !session.CallLive() && game.hidden.size() == 2);
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.Call(Call(), 0.0);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 1}};
        session.Tick(0.5);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 3}};
        session.Tick(1.0);
        Check("dm: a rejected call (fact 3) is declined and ends the game's call", session.PhoneState(1.0)["call"]["state"] == "declined" && Has(game, "end:test_fixer"));
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.Call(Call(), 0.0);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 1}};
        session.Tick(0.5);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 0}};
        session.Tick(1.0);
        const auto byGame = session.PhoneState(1.0)["call"]["state"];
        FakeGame lateGame;
        d::Session late(OpsOf(lateGame));
        late.Call(Call(), 0.0);
        late.Tick(11.0);
        Check("dm: the game's own ring timeout (fact 1 then 0) and ours both make it missed",
              byGame == "missed" && late.PhoneState(11.0)["call"]["state"] == "missed" && lateGame.log.back() == "end:test_fixer");
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.Call(Call(), 0.0);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 0}};
        session.Tick(1.0);
        const auto stillRinging = session.PhoneState(1.0)["call"]["state"];
        session.Tick(3.5);
        Check("dm: a call whose ring the game never took (fact stays 0) is failed after a few seconds, not missed",
              stillRinging == "ringing" && session.PhoneState(3.5)["call"]["state"] == "failed");
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.Call(Call(), 0.0);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 2}};
        session.Tick(1.0);
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 0}};
        session.Tick(3.0);
        Check("dm: a running call whose fact falls to 0 ended on the player's side", session.PhoneState(3.0)["call"]["state"] == "hung_up" && !session.CallLive());
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        game.refuseRing = true;
        const auto refused = Code([&] { session.Call(Call(), 0.0); });
        game.refuseRing = false;
        Check("dm: a call the phone refuses leaves nothing behind", refused == "contact_unknown" && !session.CallLive() && session.PhoneState(0.0)["call"].is_null());
        const auto out = session.Call(Call(), 1.0);
        const auto ended = session.EndCall(2.0, "test");
        Check("dm: phone.end ends a ringing call and says what it was; ending nothing says so",
              out["state"] == "ringing" && ended["ended"] == true && ended["was"] == "ringing" && Has(game, "end:test_fixer") && session.EndCall(3.0, "test")["ended"] == false);
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        const auto first = session.Text(d::ParseText(json{{"contact", "Test Sender"}, {"text", "hello"}}), 0.0);
        for (int i = 0; i < 10; ++i)
        {
            session.Text(d::ParseText(json{{"contact", "Test Sender"}, {"text", "m" + std::to_string(i)}}), 1.0 + i);
        }
        const auto state = session.PhoneState(20.0);
        Check("dm: messages are kept (the last eight) with their age, and have no undo", first["undo"].is_null() && state["messages"].size() == 8 && state["messages"][7]["text"] == "m9");
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        const auto id = session.ShowLine("notify:1", "S", "Hello there", 1, 3.0, 10.0);
        session.Tick(10.0);
        session.Tick(11.0);
        const auto shownOnce = game.shown.size();
        session.Tick(13.5);
        Check("dm: a timed line shows at once, once, and is hidden when its seconds are up",
              id != 0 && shownOnce == 1 && game.hidden.size() == 1 && game.hidden[0] == id && game.shown[0].speaker == "S");
        session.ShowLine("notify:2", "S", "A", 1, 30.0, 14.0);
        session.ShowLine("call:1", "S", "B", 2, 30.0, 14.0);
        session.Tick(14.1);
        session.HideLinesPrefix("notify:");
        Check("dm: hiding the notify lines leaves a call's lines", game.hidden.size() == 2 && session.Busy());
        session.HideAllLines();
        Check("dm: hiding all lines hides every shown one", game.hidden.size() == 3 && !session.Busy());
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        const auto set = session.QuestSet(d::ParseQuestSet(json{{"id", "q1"}, {"title", "Quest"}, {"objectives", json::array({json{{"id", "a"}, {"text", "First"}}, json{{"id", "b"}, {"text", "Second"}}})}}), 0.0);
        Check("dm: a quest is drawn in the tracker as a record with an undo that clears it",
              game.trackerCalls.size() == 1 && game.trackerCalls[0].size() == 1 && game.trackerCalls[0][0].title == "Quest" && set["undo"]["method"] == "quest.clear" &&
                  set["tracker"]["drawn"] == true && set["previous"].is_null());
        const auto done = session.QuestObjective(d::ParseObjective(json{{"quest", "q1"}, {"objective", "a"}, {"state", "done"}}), 1.0);
        const auto drawnWithTick = game.trackerCalls.back()[0].objectives.size();
        session.QuestObjective(d::ParseObjective(json{{"quest", "q1"}, {"objective", "b"}, {"text", "Second, changed"}}), 2.0);
        const auto drawnAfter = game.trackerCalls.back()[0].objectives;
        Check("dm: a finished objective is drawn once with its tick, then left out of later drawings",
              done["quest_complete"] == false && drawnWithTick == 2 && drawnAfter.size() == 1 && drawnAfter[0].id == "b" && drawnAfter[0].text == "Second, changed" &&
                  done["undo"]["params"]["state"] == "active");
        const auto last = session.QuestObjective(d::ParseObjective(json{{"quest", "q1"}, {"objective", "b"}, {"state", "done"}}), 3.0);
        Check("dm: the last non-optional objective done completes the quest", last["quest_complete"] == true);
        const auto cleared = session.QuestClear("q1", false, 4.0);
        Check("dm: clearing a quest takes the tracker down and answers an undo that sets it again",
              game.trackerCalls.back().empty() && cleared["removed"] == 1 && cleared["undo"]["method"] == "quest.set" && session.QuestState()["quests"].empty() &&
                  Code([&] { session.QuestObjective(d::ParseObjective(json{{"quest", "q1"}, {"objective", "a"}, {"state", "active"}}), 5.0); }) == "not_found");
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        game.trackerFails = true;
        const auto out = session.QuestSet(d::ParseQuestSet(json{{"id", "q1"}, {"title", "Quest"}}), 0.0);
        Check("dm: a tracker the HUD cannot draw does not fail the quest, and the answer says so",
              out["tracker"]["drawn"] == false && out["tracker"]["why"] == "no tracker" && session.QuestState()["quests"].size() == 1);
        game.trackerFails = false;
        for (int i = 2; i <= 4; ++i)
        {
            session.QuestSet(d::ParseQuestSet(json{{"id", "q" + std::to_string(i)}, {"title", "Quest"}}), 1.0);
        }
        Check("dm: four quests at most", Code([&] { session.QuestSet(d::ParseQuestSet(json{{"id", "q5"}, {"title", "Quest"}}), 2.0); }) == "too_many");
        session.QuestSet(d::ParseQuestSet(json{{"id", "q2"}, {"title", "Quest again"}}), 3.0);
        Check("dm: the quest set last is the one the tracker shows", game.trackerCalls.back().size() == 1 && game.trackerCalls.back()[0].id == "q2");
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.QuestSet(d::ParseQuestSet(json{{"id", "q1"}, {"title", "Quest"}, {"objectives", json::array({json{{"id", "a"}, {"text", "Reach the place"},
                                                                                                         {"area", {{"at", {10, 10, 5}}, {"radius_m", 3.0}, {"complete_on_enter", true}}}}})}}), 0.0);
        const auto list = session.WatchList(0.0);
        Check("dm: an objective with an area arms a watcher that completes it on entry, and clearing the quest drops it",
              list["count"] == 1 && list["watchers"][0]["id"] == "quest.q1.a" && list["watchers"][0]["actions"][0]["method"] == "quest.objective" &&
                  (session.QuestClear("q1", false, 1.0), session.WatchList(1.0)["count"] == 0));
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        d::LightPattern pulse;
        pulse.kind = "pulse";
        pulse.period = 1.0;
        session.AnimateLight(3, 100.0, pulse, 0.0);
        for (int i = 0; i <= 40; ++i)
        {
            session.Tick(i * 0.05);
        }
        bool inRange = !game.lights.empty();
        for (const auto& [handle, value] : game.lights)
        {
            inRange = inRange && handle == 3 && value >= 100.0 * pulse.low - 1e-6 && value <= 100.0 + 1e-6;
        }
        Check("dm: an animated light's intensity follows its pattern, 30 Hz at most, only when it moved", inRange && game.lights.size() >= 10 && game.lights.size() <= 70 && session.AnimatedLights() == 1);
        d::LightPattern steady;
        session.AnimateLight(3, 100.0, steady, 3.0);
        Check("dm: a steady pattern stops the animation", session.AnimatedLights() == 0);
        for (int i = 1; i <= 4; ++i)
        {
            session.AnimateLight(i, 10.0, pulse, 4.0);
        }
        Check("dm: four animated lights at most", Code([&] { session.AnimateLight(5, 10.0, pulse, 4.0); }) == "too_many");
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.Call(Call(), 0.0);
        session.ShowLine("notify:1", "S", "x", 1, 30.0, 0.0);
        session.Tick(0.1);
        session.QuestSet(d::ParseQuestSet(json{{"id", "q1"}, {"title", "Quest"}}), 0.0);
        session.Arm(Watch(json{{"id", "w"}, {"kind", "weapon"}}), 0.0);
        const auto out = session.Reset(true);
        Check("dm: a reset takes the UI down through the game and forgets everything",
              out["watchers"] == 1 && out["call"] == "ringing" && Has(game, "end:test_fixer") && game.trackerCalls.back().empty() && game.hidden.size() == 1 && !session.Busy() &&
                  session.QuestState()["quests"].empty());
        FakeGame detached;
        d::Session loaded(OpsOf(detached));
        loaded.Call(Call(), 0.0);
        loaded.ShowLine("notify:1", "S", "x", 1, 30.0, 0.0);
        loaded.Tick(0.1);
        loaded.Reset(false);
        Check("dm: a reset for a load makes no game call: no end of the call, no line hidden",
              !Has(detached, "end:test_fixer") && detached.hidden.empty() && detached.trackerCalls.empty());
    }
    {
        FakeGame game;
        d::Session session(OpsOf(game));
        session.Arm(Watch(json{{"id", "t"}, {"kind", "timer"}, {"seconds", 1.0}, {"actions", json::array({json{{"method", "notify.show"}, {"params", {{"style", "warning"}, {"text", "x"}}}}})}}), 0.0);
        session.Tick(0.5);
        session.Tick(1.2);
        Check("dm: a fired watcher hands its actions to the micro-action runner as one batch, in order, and reports it",
              game.batches.size() == 1 && game.batches[0].watch == "t" && game.batches[0].actions.size() == 1 && game.batches[0].actions[0].method == "notify.show" &&
                  std::any_of(game.events.begin(), game.events.end(), [](const std::string& e) { return e.rfind("watch: watcher t fired", 0) == 0; }));
        FakeGame sampling;
        d::Session s2(OpsOf(sampling));
        s2.Arm(Watch(json{{"id", "e"}, {"kind", "enter"}, {"at", {0, 0, 0}}, {"hz", 4.0}}), 0.0);
        sampling.sample = json{{"v", {50, 50, 0}}};
        for (int i = 1; i <= 20; ++i)
        {
            s2.Tick(i * 0.05);
        }
        const auto samples = std::count_if(sampling.log.begin(), sampling.log.end(), [](const std::string& e) { return e.rfind("sample:", 0) == 0; });
        Check("dm: the session samples at its watchers' rate, not every tick", samples >= 3 && samples <= 6);
    }
}

// --- the service ---------------------------------------------------------------------------------------------------------------

struct FakeWorld
{
    std::string phase = "gameplay";
    std::string busy;
    std::vector<std::string> calls;
    int spawnCount = 0;
    std::map<std::string, json> doorState;
    json lastSpawnStep = json::object();
    bool failDespawn = false;
};

d::Ops FakeOps(FakeWorld& aWorld)
{
    d::Ops ops;
    ops.v = [&aWorld] { return json{{"phase", aWorld.phase}, {"position", {100.0, 200.0, 10.0}}, {"yaw", 0.0}, {"busy", aWorld.busy}}; };
    ops.spawn = [&aWorld](const d::SpawnStep& aStep) {
        ++aWorld.spawnCount;
        aWorld.calls.push_back("spawn:" + aStep.kind);
        aWorld.lastSpawnStep = json{{"at", {aStep.at[0], aStep.at[1], aStep.at[2]}}, {"yaw", aStep.yaw}, {"handle", aStep.handle}, {"ground", aStep.ground}};
        return json{{"entity", "EntityID(" + std::to_string(7000 + aWorld.spawnCount) + ")"}, {"position", {aStep.at[0], aStep.at[1], aStep.at[2]}}, {"yaw", aStep.yaw}, {"grounded", true}};
    };
    ops.despawn = [&aWorld](const std::string& aEntity) {
        aWorld.calls.push_back("despawn:" + aEntity);
        if (aWorld.failDespawn)
        {
            throw xfb::MethodError("failed", "boom");
        }
        return json{{"despawned", true}};
    };
    ops.door = [&aWorld](const d::DoorStep& aStep) {
        aWorld.calls.push_back("door:" + aStep.target + ":" + std::to_string(aStep.open ? (*aStep.open ? 1 : 0) : -1) + ":" + std::to_string(aStep.locked ? (*aStep.locked ? 1 : 0) : -1));
        auto& state = aWorld.doorState[aStep.target];
        if (state.is_null())
        {
            state = json{{"open", false}, {"locked", true}, {"sealed", false}};
        }
        const auto before = state;
        if (aStep.open)
        {
            state["open"] = *aStep.open;
        }
        if (aStep.locked)
        {
            state["locked"] = *aStep.locked;
        }
        if (aStep.sealed)
        {
            state["sealed"] = *aStep.sealed;
        }
        return json{{"target_id", aStep.target}, {"before", before}, {"after", state}};
    };
    ops.vehicle = [&aWorld](const d::VehicleStep& aStep) {
        aWorld.calls.push_back("vehicle:" + aStep.target + ":" + aStep.door + ":" + aStep.doorState + ":" + (aStep.lights ? (*aStep.lights ? "L1" : "L0") : "L-") + ":" +
                               (aStep.engine ? (*aStep.engine ? "E1" : "E0") : "E-"));
        return json{{"target_id", "EntityID(8201)"}, {"before", {{"engine", false}, {"doors", {{"trunk", "closed"}, {"hood", "closed"}}}}}};
    };
    ops.audioPlay = [&aWorld](const std::string& aEvent, const std::string& aOn, const std::string&) {
        aWorld.calls.push_back("play:" + aEvent + ":" + aOn);
        return json{{"on_id", aOn}};
    };
    ops.audioStop = [&aWorld](const std::string& aEvent, const std::string& aOn, const std::string&) {
        aWorld.calls.push_back("stop:" + aEvent + ":" + aOn);
        return json::object();
    };
    ops.radio = [&aWorld](const d::RadioStep& aStep) {
        aWorld.calls.push_back("radio:" + aStep.target);
        return json{{"target_id", "EntityID(8201)"}, {"before", {{"station", 4}, {"on", false}}}};
    };
    ops.notify = [&aWorld](const d::NotifyRequest& aRequest) {
        aWorld.calls.push_back("notify:" + aRequest.style + ":" + aRequest.text);
        return json{{"shown", true}};
    };
    ops.notifyHide = [&aWorld](const std::string& aStyle) {
        aWorld.calls.push_back("notify_hide:" + aStyle);
        return json{{"banners_hidden", true}};
    };
    ops.phoneText = [&aWorld](const std::string& aContact, const std::string&) {
        aWorld.calls.push_back("text:" + aContact);
        return json{{"shown", true}};
    };
    ops.phoneContacts = [] { return json{{"contacts", json::array({json{{"id", "test_fixer"}, {"name", "Test Fixer"}}})}, {"calling", true}}; };
    ops.sample = [&aWorld](const d::SampleWants&, const std::map<std::string, std::string>& aEntities) {
        aWorld.calls.push_back("sample:" + std::to_string(aEntities.size()));
        json ents = json::object();
        for (const auto& [key, id] : aEntities)
        {
            ents[key] = json{{"p", {101.0, 202.0, 10.0}}, {"id", id}};
        }
        return json{{"v", {100.0, 200.0, 10.0}}, {"ents", ents}};
    };
    ops.showLine = [&aWorld](const d::TimedLine& aLine) { aWorld.calls.push_back("line:" + aLine.text); };
    ops.hideLine = [&aWorld](uint64_t) { aWorld.calls.push_back("hide_line"); };
    ops.callRing = [&aWorld](const std::string& aContact, const std::string&, bool) { aWorld.calls.push_back("ring:" + aContact); };
    ops.callStart = [&aWorld](const std::string& aContact, const std::string&) { aWorld.calls.push_back("start:" + aContact); };
    ops.callEnd = [&aWorld](const std::string& aContact) { aWorld.calls.push_back("call_end:" + aContact); return true; };
    ops.tracker = [&aWorld](const std::vector<d::Quest>& aQuests) { aWorld.calls.push_back("tracker:" + std::to_string(aQuests.size())); };
    ops.lightIntensity = [&aWorld](const std::string& aEntity, double) { aWorld.calls.push_back("light_intensity:" + aEntity); };
    ops.lightSpawn = [&aWorld](const d::LightStep& aStep) {
        aWorld.calls.push_back("light_spawn");
        ++aWorld.spawnCount;
        return json{{"entity", "EntityID(" + std::to_string(7000 + aWorld.spawnCount) + ")"}, {"components", aStep.templatePath.empty() ? 0 : 1}};
    };
    ops.lightSet = [&aWorld](const d::LightSetStep& aStep) {
        aWorld.calls.push_back("light_set:" + aStep.entity + (aStep.flickerStrength ? ":flicker=" + std::to_string(*aStep.flickerStrength) : std::string()));
        return json{{"before", {{"colour", {255, 255, 255}}, {"intensity", 100.0}, {"radius", 8.0}, {"on", true}}}};
    };
    ops.releaseAll = [&aWorld](const std::string& aReason) {
        aWorld.calls.push_back("release_all:" + aReason);
        return json{{"entities_removed", 0}};
    };
    ops.digest = [](bool) { return json{{"v", {{"vitals", {{"health_percent", 62.0}}}}}, {"world", json::object()}}; };
    ops.micro = [&aWorld](d::MicroBatch aBatch) { aWorld.calls.push_back("micro:" + aBatch.watch); };
    ops.microCancel = [&aWorld](const std::string& aWhy) {
        aWorld.calls.push_back("micro_cancel:" + aWhy);
        return size_t{0};
    };
    ops.microCancelWatch = [&aWorld](const std::string& aId) {
        aWorld.calls.push_back("micro_cancel:watch_disarm " + aId);
        return size_t{0};
    };
    ops.actionCheck = [](const std::string&) -> std::string { return ""; };
    return ops;
}

bool Called(const FakeWorld& aWorld, const std::string& aPrefix)
{
    return std::any_of(aWorld.calls.begin(), aWorld.calls.end(), [&](const std::string& c) { return c.rfind(aPrefix, 0) == 0; });
}

size_t CallCount(const FakeWorld& aWorld, const std::string& aPrefix)
{
    return static_cast<size_t>(std::count_if(aWorld.calls.begin(), aWorld.calls.end(), [&](const std::string& c) { return c.rfind(aPrefix, 0) == 0; }));
}

struct Rig
{
    FakeWorld world;
    xfb::EventLog events;
    d::Service service;
    Rig()
        : service([this](const std::string&) { return FakeOps(world); })
    {
        service.SetEvents(&events);
    }
    d::Ops Ops() { return FakeOps(world); }
};

void ServiceTests()
{
    {
        Rig rig;
        const auto out = rig.service.Spawn(json{{"template", "base\\gameplay\\x\\prop.ent"}, {"offset", {{"forward", 3.0}, {"right", 1.0}}}, {"label", "box"}}, rig.Ops());
        // V at (100, 200) facing yaw 0 (+Y): forward 3 is (100, 203); right 1 is (101, 203).
        Check("dm: a spawn lands where the offset says, from V's facing, and answers its handle, target and undo",
              out["handle"] == 1 && out["target"] == "spawn:1" && Near(rig.world.lastSpawnStep["at"][0].get<double>(), 101.0) && Near(rig.world.lastSpawnStep["at"][1].get<double>(), 203.0) &&
                  out["undo"]["method"] == "world.despawn" && out["undo"]["params"]["id"] == 1 && out["spawned"] == 1);
        const auto second = rig.service.Spawn(json{{"template", "base\\x.ent"}, {"at", {110, 210, 10}}, {"face_v", true}}, rig.Ops());
        // From (110, 210) V is at (100, 200): direction (-10, -10): yaw = atan2(10, -10) = 135 degrees.
        Check("dm: a spawn that faces V turns towards her; the handle counts up", second["handle"] == 2 && Near(rig.world.lastSpawnStep["yaw"].get<double>(), 135.0, 1e-6));
        const auto held = rig.service.Holds();
        Check("dm: a save is refused while spawned things exist (the holds name them)", held.size() == 1 && held[0].get<std::string>().find("2 spawned things") != std::string::npos);
        const auto listing = rig.service.Spawned(json::object(), rig.Ops());
        Check("dm: world.spawned lists them with where each stands now",
              listing["count"] == 2 && listing["spawned"][0]["present"] == true && Near(listing["spawned"][0]["position"][1].get<double>(), 202.0) && listing["limit"] == 24);
    }
    {
        Rig rig;
        rig.world.phase = "main_menu";
        const auto menu = Code([&] { rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops()); });
        rig.world.phase = "gameplay";
        const auto far = Code([&] { rig.service.Spawn(json{{"template", "base\\x.ent"}, {"at", {500, 500, 10}}}, rig.Ops()); });
        rig.world.busy = "not_v";
        const auto notV = Code([&] { rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops()); });
        Check("dm: a spawn is refused outside normal play, further than 60 m, and when the player isn't V; nothing is called",
              menu == "not_in_world" && far == "too_far" && notV == "not_v" && rig.world.spawnCount == 0 && rig.service.Holds().empty());
        rig.world.busy = "in_combat";
        const auto combat = Code([&] { rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops()); });
        Check("dm: combat does not stop a spawn (the toolkit is for directing a scene, not only for quiet streets)", combat == "ok");
    }
    {
        Rig rig;
        for (size_t i = 0; i < d::kMaxSpawned; ++i)
        {
            rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        }
        Check("dm: 24 spawned things at most, props, vehicles and lights together",
              Code([&] { rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops()); }) == "limit" && Code([&] { rig.service.LightSpawn(json{{"template", "base\\lamp.ent"}}, rig.Ops()); }) == "limit");
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\a.ent"}, {"label", "a"}}, rig.Ops());
        rig.service.Spawn(json{{"kind", "vehicle"}, {"record", "Vehicle.v_test"}}, rig.Ops());
        const auto one = rig.service.Despawn(json{{"id", 1}}, rig.Ops());
        Check("dm: despawning one answers a single undo that spawns it again; the registry forgets it",
              one["removed"] == 1 && one["undo"]["method"] == "world.spawn" && one["undo"]["params"]["template"] == "base\\a.ent" && Called(rig.world, "despawn:EntityID(7001)") &&
                  rig.service.Spawned(json::object(), rig.Ops())["count"] == 1);
        const auto unknown = Code([&] { rig.service.Despawn(json{{"id", 1}}, rig.Ops()); });
        const auto all = rig.service.Despawn(json{{"all", true}}, rig.Ops());
        Check("dm: an unknown handle is refused; all answers undo_all", unknown == "target_unknown" && all["removed"] == 1 && all["undo"].is_null() == false && rig.service.Holds().empty());
        rig.service.Spawn(json{{"template", "base\\a.ent"}}, rig.Ops());
        rig.service.Spawn(json{{"template", "base\\b.ent"}}, rig.Ops());
        rig.world.failDespawn = true;
        const auto both = rig.service.Despawn(json{{"all", true}}, rig.Ops());
        Check("dm: failed despawns keep ownership and save protection without a false undo",
              both["removed"] == 0 && both.contains("failure") && !both.contains("undo_all") && !rig.service.Holds().empty());
        rig.world.failDespawn = false;
        Check("dm: failed despawns can be retried", rig.service.Despawn(json{{"all", true}}, rig.Ops())["removed"] == 2 && rig.service.Holds().empty());
    }
    {
        Rig rig;
        rig.service.LightSpawn(json{{"template", "base\\lamp.ent"}, {"intensity", 50.0}, {"pattern", {{"kind", "flicker"}, {"strength", 0.4}}}}, rig.Ops());
        Check("dm: a light with the engine's flicker sets it on spawn", Called(rig.world, "light_set:EntityID(7001):flicker=0.4"));
        const auto set = rig.service.LightSet(json{{"id", 1}, {"intensity", 20.0}, {"pattern", "steady"}}, rig.Ops());
        Check("dm: a steady pattern puts the engine's flicker out; the undo restores intensity and the earlier pattern",
              Called(rig.world, "light_set:EntityID(7001):flicker=0.0") && set["undo"]["params"]["intensity"] == 100.0);
        rig.service.LightSet(json{{"id", 1}, {"pattern", "pulse"}}, rig.Ops());
        auto& session = rig.service.SessionForTest(rig.Ops());
        Check("dm: a pulse is driven by the tick, not the engine", session.AnimatedLights() == 1);
        rig.service.Spawn(json{{"template", "base\\lamp_prop.ent"}}, rig.Ops());
        Check("dm: any spawned thing may be steered (a lamp from world_spawn), the script refusing one with no light component",
              Code([&] { rig.service.LightSet(json{{"id", 2}, {"on", false}}, rig.Ops()); }) == "ok" && Code([&] { rig.service.LightSet(json{{"id", 9}, {"on", false}}, rig.Ops()); }) == "target_unknown");
        const auto removed = rig.service.LightRemove(json{{"id", 1}}, rig.Ops());
        Check("dm: removing a light forgets its pattern and answers an undo that brings it back",
              removed["removed"] == 1 && removed["undo"]["method"] == "light.spawn" && session.AnimatedLights() == 0 && Code([&] { rig.service.LightRemove(json{{"id", 2}}, rig.Ops()); }) == "target_unknown");
        const auto lightViaDespawn = Code([&] {
            rig.service.LightSpawn(json{{"template", "base\\lamp.ent"}}, rig.Ops());
            rig.service.Despawn(json{{"id", 3}}, rig.Ops());
        });
        Check("dm: world.despawn leaves lights to light.remove", lightViaDespawn == "use_light_remove");
    }
    {
        Rig rig;
        const auto door = rig.service.Door(json{{"target", "EntityID(8102)"}, {"open", true}}, rig.Ops());
        const auto again = rig.service.Door(json{{"target", "EntityID(8102)"}, {"locked", true}}, rig.Ops());
        const auto held = rig.service.Holds();
        Check("dm: a door change answers its undo and is held (a save is refused)",
              door["undo"]["method"] == "world.door" && door["undo"]["params"]["open"] == false && door["undo"]["params"]["locked"] == true && again["target_id"] == "EntityID(8102)" &&
                  held.size() == 1 && held[0].get<std::string>().find("door") != std::string::npos);
        rig.world.calls.clear();
        const auto out = rig.service.RestoreAfterKill(rig.Ops());
        // The first state seen is open false, locked true, sealed false: all put back by the kill switch's restore.
        Check("dm: the kill switch puts a door back as the first change found it, before it takes the script's holds down",
              out["released"] == true && Called(rig.world, "door:EntityID(8102):0:1") && Called(rig.world, "release_all:kill") && rig.service.Holds().empty() && !rig.service.Active());
    }
    {
        Rig rig;
        rig.service.Vehicle(json{{"target", "mounted"}, {"engine", true}, {"lights", true}, {"door", "trunk"}, {"door_state", "open"}}, rig.Ops());
        rig.world.calls.clear();
        rig.service.RestoreAfterKill(rig.Ops());
        Check("dm: the kill switch puts a vehicle back: its engine and lights (taken to be the other way), then each door",
              Called(rig.world, "vehicle:EntityID(8201):::L0:E0") && Called(rig.world, "vehicle:EntityID(8201):trunk:closed") && Called(rig.world, "vehicle:EntityID(8201):hood:closed"));
        rig.service.Vehicle(json{{"target", "mounted"}, {"door", "all"}, {"door_state", "locked"}}, rig.Ops());
        Check("dm: a vehicle target must resolve in the script, not here", Code([&] { rig.service.Vehicle(json{{"target", "spawn:9"}, {"engine", true}}, rig.Ops()); }) == "target_unknown");
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        rig.service.Door(json{{"target", "spawn:1"}, {"open", true}}, rig.Ops());
        Check("dm: a spawn handle as a target becomes the entity id the script knows", Called(rig.world, "door:EntityID(7001):1"));
        const auto a = rig.service.AudioPlay(json{{"event", "ui_test"}, {"loop", true}}, rig.Ops());
        const auto b = rig.service.AudioPlay(json{{"event", "ui_other"}, {"on", "spawn:1"}}, rig.Ops());
        Check("dm: sounds are tracked with ids; a looped one has an undo that stops it",
              a["id"] == 1 && b["id"] == 2 && a["undo"]["method"] == "audio.stop" && Called(rig.world, "play:ui_other:EntityID(7001)"));
        const auto stopped = rig.service.AudioStop(json{{"id", 1}}, rig.Ops());
        Check("dm: stopping a sound stops it on what it played on; an unknown id is refused",
              stopped["stopped"] == 1 && Called(rig.world, "stop:ui_test:v") && Code([&] { rig.service.AudioStop(json{{"id", 1}}, rig.Ops()); }) == "not_found");
        const auto all = rig.service.AudioStop(json{{"all", true}}, rig.Ops());
        Check("dm: stopping all stops each tracked sound (sounds are not held: a save may go ahead past them)", all["tracked"] == 1 && rig.service.Holds().size() == 2);
        for (int i = 0; i < 16; ++i)
        {
            rig.service.AudioPlay(json{{"event", "ui_loop"}, {"loop", true}}, rig.Ops());
        }
        Check("dm: sixteen tracked sounds at most", Code([&] { rig.service.AudioPlay(json{{"event", "ui_loop"}, {"loop", true}}, rig.Ops()); }) == "limit");
    }
    {
        Rig rig;
        const auto text = rig.service.PhoneTextSend(json{{"contact", "Test Sender"}, {"text", "hello"}}, rig.Ops());
        const auto state = rig.service.PhoneState(json{{"contacts", true}}, rig.Ops());
        Check("dm: a message toast is shown and listed; phone.state can list the journal's contacts",
              text["undo"].is_null() && Called(rig.world, "text:Test Sender") && state["messages"].size() == 1 && state["contacts"]["contacts"][0]["id"] == "test_fixer" &&
                  rig.service.PhoneState(json::object(), rig.Ops()).contains("contacts") == false);
        const auto call = rig.service.PhoneCallStart(json{{"contact", "test_fixer"}, {"lines", json::array({json{{"text", "Hello"}}})}}, rig.Ops());
        Check("dm: a call rings through the game and the registry holds it until it ends", call["state"] == "ringing" && Called(rig.world, "ring:test_fixer") && rig.service.Active());
        const auto ended = rig.service.PhoneEnd(json::object(), rig.Ops());
        Check("dm: phone.end ends it", ended["ended"] == true && Called(rig.world, "call_end:test_fixer"));
    }
    {
        Rig rig;
        const auto set = rig.service.QuestSet(json{{"id", "q1"}, {"title", "Find it"}, {"notify", "new"}, {"objectives", json::array({json{{"id", "a"}, {"text", "Look"}}})}}, rig.Ops());
        Check("dm: a quest set with notify new raises the game's new-quest toast with its title", set["notified"] == "quest_new" && Called(rig.world, "notify:quest_new:Find it") && Called(rig.world, "tracker:1"));
        const auto upd = rig.service.QuestObjective(json{{"quest", "q1"}, {"objective", "a"}, {"state", "done"}}, rig.Ops());
        Check("dm: the last objective done raises the quest-complete toast; the toast is skipped for notify false",
              upd["notified"] == "quest_done" && Called(rig.world, "notify:quest_done:Look") &&
                  rig.service.QuestObjective(json{{"quest", "q1"}, {"objective", "a"}, {"state", "active"}, {"notify", false}}, rig.Ops()).contains("notified") == false);
        const auto failed = rig.service.QuestObjective(json{{"quest", "q1"}, {"objective", "a"}, {"state", "failed"}}, rig.Ops());
        Check("dm: a failed objective raises the quest-failed toast", failed["notified"] == "quest_failed");
        Check("dm: quest.clear takes id or all, one of them", Code([&] { rig.service.QuestClear(json::object(), rig.Ops()); }) == "bad_params" &&
                                                                 Code([&] { rig.service.QuestClear(json{{"id", "q1"}, {"all", true}}, rig.Ops()); }) == "bad_params" &&
                                                                 rig.service.QuestClear(json{{"all", true}}, rig.Ops())["removed"] == 1);
    }
    {
        Rig rig;
        const auto banner = rig.service.NotifyShow(json{{"style", "warning"}, {"text", "Careful"}}, rig.Ops());
        Check("dm: a banner goes to the game's message board; its undo takes it down", banner["undo"]["method"] == "notify.hide" && Called(rig.world, "notify:warning:Careful"));
        const auto toast = rig.service.NotifyShow(json{{"style", "quest_update"}, {"text", "Updated"}}, rig.Ops());
        Check("dm: a quest toast has no undo", toast["undo"].is_null());
        const auto sub = rig.service.NotifyShow(json{{"style", "subtitle"}, {"speaker", "Narrator"}, {"text", "Words"}, {"seconds", 2.0}}, rig.Ops());
        Check("dm: a subtitle is a timed line the session shows and hides, not a game call here", sub["line"].is_number() && !Called(rig.world, "notify:subtitle"));
        rig.service.NotifyHide(json::object(), rig.Ops());
        Check("dm: notify.hide takes the banners down and the subtitle lines", Called(rig.world, "notify_hide:") && Code([&] { rig.service.NotifyHide(json{{"style", "popup"}}, rig.Ops()); }) == "bad_params");
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        const auto armed = rig.service.WatchArm(json{{"id", "g"}, {"kind", "gaze"}, {"target", "spawn:1"}, {"seconds", 1.0}}, rig.Ops());
        Check("dm: a watcher arms and lists with an undo that disarms it", armed["undo"]["method"] == "watch.disarm" && rig.service.WatchList(json::object(), rig.Ops())["count"] == 1);
        const auto gone = rig.service.WatchDisarm(json{{"id", "g"}}, rig.Ops());
        Check("dm: disarming drops the watcher and the micro-actions waiting; an unknown id is refused",
              gone["disarmed"] == 1 && Called(rig.world, "micro_cancel:watch_disarm g") && rig.service.WatchDisarm(json{{"id", "g"}}, rig.Ops())["disarmed"] == 0 &&
                  Code([&] { rig.service.WatchDisarm(json::object(), rig.Ops()); }) == "bad_params");
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        rig.service.Door(json{{"target", "EntityID(8102)"}, {"open", true}}, rig.Ops());
        d::TickInput input;
        input.gateOpen = true;
        input.detaches = 1;
        rig.service.Tick(0.1, input);
        rig.world.calls.clear();
        input.paused = true;
        rig.service.Tick(0.1, input);
        Check("dm: the pause releases everything on the next tick: doors back, then the script's holds",
              Called(rig.world, "door:EntityID(8102):0:1") && Called(rig.world, "release_all:paused") && !rig.service.Active() && rig.service.Holds().empty());
        rig.world.calls.clear();
        rig.service.Tick(0.1, input);
        Check("dm: after release only unconditional micro cancellation runs", rig.world.calls.size() == 1 && Called(rig.world, "micro_cancel:"));
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        d::TickInput input;
        input.gateOpen = true;
        input.detaches = 1;
        rig.service.Tick(0.1, input);
        input.handedOver = true;
        rig.world.calls.clear();
        rig.service.Tick(0.1, input);
        Check("dm: a handover releases on the tick too, as its own request has done already", Called(rig.world, "release_all:handover"));
        Rig other;
        other.service.Spawn(json{{"template", "base\\x.ent"}}, other.Ops());
        const auto out = other.service.ReleaseAllNow("handover", other.Ops());
        Check("dm: the handover's own release answers what it released; releasing nothing says so",
              out["released"] == true && out["reason"] == "handover" && !other.service.Active() && other.service.ReleaseAllNow("handover", other.Ops())["nothing_held"] == true);
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        rig.service.Door(json{{"target", "EntityID(8102)"}, {"open", true}}, rig.Ops());
        d::TickInput input;
        input.gateOpen = true;
        input.detaches = 1;
        rig.service.Tick(0.1, input);
        rig.world.calls.clear();
        input.detaches = 2; // a load
        rig.service.Tick(0.1, input);
        Check("dm: a load forgets everything without a single game call (the world took it)",
              rig.world.calls.empty() == false ? Called(rig.world, "micro_cancel:") && rig.world.calls.size() == 1 : true);
        Check("dm: and nothing is held afterwards", !rig.service.Active() && rig.service.Holds().empty());
        input.gateOpen = false;
        input.paused = true;
        rig.service.Spawn(json{{"template", "base\\x.ent"}}, rig.Ops());
        rig.world.calls.clear();
        rig.service.Tick(0.1, input);
        Check("dm: with the script gate closed the tick only cancels micro-actions", rig.world.calls.size() == 1 && Called(rig.world, "micro_cancel:"));
    }
    {
        Rig rig;
        d::TickInput input;
        input.gateOpen = true;
        input.detaches = 1;
        rig.service.Tick(0.1, input);
        rig.service.QuestSet(json{{"id", "q1"}, {"title", "Quest"}}, rig.Ops());
        rig.service.NotifyShow(json{{"style", "subtitle"}, {"speaker", "S"}, {"text", "x"}, {"seconds", 5.0}}, rig.Ops());
        bool open = true;
        input.writesOpen = [&open] { return open; };
        rig.world.calls.clear();
        open = false;
        for (int i = 0; i < 5; ++i)
        {
            rig.service.Tick(0.2, input);
        }
        Check("dm: the tick's forward steps (lines shown) wait while the write gate is closed", !Called(rig.world, "line:"));
        open = true;
        rig.service.Tick(0.2, input);
        Check("dm: and go ahead when it opens", Called(rig.world, "line:x"));
    }
    {
        Rig rig;
        rig.service.Spawn(json{{"template", "base\\x.ent"}, {"label", "box"}}, rig.Ops());
        rig.service.QuestSet(json{{"id", "q1"}, {"title", "Quest"}, {"objectives", json::array({json{{"id", "a"}, {"text", "Look"}}})}}, rig.Ops());
        rig.service.Door(json{{"target", "EntityID(8102)"}, {"open", true}}, rig.Ops());
        const auto digest = rig.service.GameDigest(json{{"events", 5}, {"kinds", json::array({"dm.world", "dm.quest"})}}, rig.Ops());
        Check("dm: the digest gathers the game's read, what the bridge placed and changed, the quests and the recent events",
              digest["v"]["vitals"]["health_percent"] == 62.0 && digest["placed"].size() == 1 && digest["placed"][0]["label"] == "box" && digest["changed"].size() == 1 &&
                  digest["quests"].size() == 1 && digest["quests"][0]["objectives"]["a"] == "active" && digest["events"].is_array() && digest["events"].size() >= 3);
        const auto few = rig.service.GameDigest(json{{"events", 1}, {"kinds", json::array({"dm.world"})}}, rig.Ops());
        Check("dm: the digest keeps only the asked number and kinds of events", few["events"].size() == 1 && few["events"][0]["kind"] == "dm.world");
    }
}
void ReviewTests()
{
    {
        Rig rig;
        d::TickInput paused;
        paused.paused = true;
        for (int cycle = 0; cycle < 6; ++cycle)
        {
            rig.service.NotifyShow(json{{"style", "warning"}, {"text", "new activity"}}, rig.Ops());
            rig.service.Tick(0.1, paused);
        }
        Check("dm fix 2: independent successful cleanup cycles each get a fresh budget", CallCount(rig.world, "release_all:") == 6 && !rig.service.Active());
    }

    {
        Rig rig;
        auto ops = rig.Ops();
        std::vector<std::future<void>> readers;
        auto probe = [&] {
            auto reader = std::async(std::launch::async, [&] { (void)rig.service.Holds(); });
            const bool unlocked = reader.wait_for(std::chrono::seconds(2)) == std::future_status::ready;
            readers.push_back(std::move(reader)); // even a regression can return from the adapter without joining under its lock
            Check("dm fix 3: adapter allows another thread to read service bookkeeping", unlocked);
        };
        auto door = ops.door;
        ops.door = [&](const d::DoorStep& step) { probe(); return door(step); };
        ops.audioStop = [&](const std::string&, const std::string&, const std::string&) { probe(); return json::object(); };
        ops.despawn = [&](const std::string&) { probe(); return json{{"despawned", true}}; };
        ops.lightSpawn = [](const d::LightStep&) { return json{{"entity", "EntityID(7001)"}, {"pending", true}}; };
        ops.lightSet = [&](const d::LightSetStep&) { probe(); return json::object(); };
        ops.hideLine = [&](uint64_t) { probe(); };
        ops.callEnd = [&](const std::string&) { probe(); return true; };
        ops.tracker = [&](const std::vector<d::Quest>&) { probe(); };
        ops.releaseAll = [&](const std::string&) { probe(); return json::object(); };
        auto sample = ops.sample;
        ops.sample = [&](const d::SampleWants& wants, const std::map<std::string, std::string>& entities) { probe(); return sample(wants, entities); };
        rig.service.SetOpsFor([&](const std::string&) { probe(); return ops; });
        rig.service.LightSpawn(json{{"template", "base\\lamp.ent"}}, ops);
        rig.service.NotifyShow(json{{"style", "subtitle"}, {"speaker", "XF"}, {"text", "owned"}}, ops);
        rig.service.SessionForTest(ops).Call(Call(1), 0.0);
        rig.service.QuestSet(json{{"id", "lock-test"}, {"title", "Owned quest"}}, ops);
        rig.service.AudioPlay(json{{"event", "loop"}, {"loop", true}}, ops);
        rig.service.Door(json{{"target", "EntityID(8102)"}, {"open", true}}, ops);
        rig.service.Tick(0.1, {});
        rig.service.ReleaseAllNow("lock-test", ops);
        for (auto& reader : readers) { reader.get(); }
        Check("dm fix 3: release reconciles snapshots after unlocked adapters", !rig.service.Active() && rig.service.Holds().empty());
    }

    {
        Rig rig;
        auto ops = rig.Ops();
        unsigned attempts = 0;
        ops.releaseAll = [&](const std::string&) -> json { ++attempts; throw xfb::MethodError("failed", "permanent cleanup failure"); };
        rig.service.SetOpsFor([&](const std::string&) { return ops; });
        rig.service.NotifyShow(json{{"style", "warning"}, {"text", "retry"}}, ops);
        d::TickInput paused;
        paused.paused = true;
        rig.service.Tick(0.1, paused);
        rig.service.Tick(0.1, paused);
        Check("dm fix 2: cleanup backs off between attempts", attempts == 1);
        for (int i = 0; i < 200; ++i) { rig.service.Tick(0.5, paused); }
        Check("dm fix 2: automatic cleanup stops at four attempts with ownership and hold retained", attempts == 4 && rig.service.Active() && !rig.service.Holds().empty());
        rig.service.ReleaseAllNow("explicit retry", ops);
        Check("dm fix 2: explicit cleanup starts a fresh retry budget", attempts == 5);
        rig.service.DropAll("load");
        Check("dm fix 2: load clears exhausted cleanup", !rig.service.Active() && rig.service.Holds().empty());
    }
    {
        Rig rig;
        rig.service.Vehicle(json{{"target", "mounted"}, {"door", "trunk"}, {"door_state", "locked"}}, rig.Ops());
        d::TickInput paused;
        paused.paused = true;
        rig.service.Tick(0.1, paused);
        const auto cleanups = CallCount(rig.world, "release_all:");
        for (int i = 0; i < 100; ++i) { rig.service.Tick(0.5, paused); }
        Check("dm fix 2: a dormant lock hold schedules no more game cleanup", cleanups == 1 && CallCount(rig.world, "release_all:") == 1 && !rig.service.Holds().empty());
    }
    {
        FakeGame game;
        auto ops = OpsOf(game);
        size_t attempts = 0;
        bool fail = true;
        ops.hideLine = [&](uint64_t) { ++attempts; if (fail) { throw xfb::MethodError("failed", "hide failed"); } };
        d::Session session(ops);
        for (size_t i = 0; i < d::kMaxSubtitleLines; ++i) { session.ShowLine("notify", "XF", "owned", 1, 1.0, 0.0); }
        session.Tick(0.1);
        session.Tick(1.1);
        session.Tick(1.2);
        Check("dm fix 2: subtitle hides back off", attempts == d::kMaxSubtitleLines);
        for (int i = 2; i < 100; ++i) { session.Tick(i); }
        Check("dm fix 2: failed subtitle hides exhaust a bounded budget without eviction", attempts == 4 * d::kMaxSubtitleLines && session.Busy());
        Check("dm fix 2/14: outstanding subtitles are capped including failed hides", Code([&] { session.ShowLine("notify", "XF", "overflow", 1, 1.0, 100.0); }) == "limit");
        fail = false;
        Check("dm fix 2: explicit retry hides every retained subtitle", session.HideAllLines() == d::kMaxSubtitleLines && !session.Busy());
    }
    {
        FakeGame game;
        game.sample = json{{"v", {0, 0, 0}}, {"call_fact", 2}};
        d::Session session(OpsOf(game));
        for (size_t i = 0; i < d::kMaxSubtitleLines - d::kMaxCallLines; ++i) { session.ShowLine("notify", "XF", "owned", 1, 20.0, 0.0); }
        session.Call(Call(16), 0.0);
        Check("dm fix 2: ringing calls reserve their subtitle capacity", Code([&] { session.ShowLine("notify", "XF", "overflow", 1, 1.0, 0.0); }) == "limit");
        session.Tick(0.1);
        Check("dm fix 2: answering a reserved call stays within the subtitle cap", session.Reset(false)["lines"] == d::kMaxSubtitleLines);
    }
    {
        FakeGame game;
        auto ops = OpsOf(game);
        int attempts = 0;
        ops.callEnd = [&](const std::string&) -> bool { ++attempts; throw xfb::MethodError("failed", "end failed"); };
        d::Session session(ops);
        session.Call(Call(1), 0.0);
        session.EndCall(0.1, "explicit");
        for (int i = 1; i < 100; ++i) { session.Tick(i); }
        Check("dm fix 1/2: failed call termination exhausts retries while remaining owned", attempts == 4 && session.CallLive() && session.CleanupPending());
        session.EndCall(100.0, "retry");
        Check("dm fix 1/2: explicit end retries an exhausted pending call", attempts == 5 && session.CallLive());
    }

    for (const int endCase : {0, 1, 2})
    {
        Rig rig;
        auto ops = rig.Ops();
        int attempts = 0;
        bool acknowledged = false;
        ops.callEnd = [&](const std::string&) {
            if (++attempts == 1) { throw xfb::MethodError("not_ready", "end failed"); }
            return acknowledged;
        };
        if (endCase == 2) { ops.sample = [](const d::SampleWants&, const std::map<std::string, std::string>&) { return json{{"v", {0, 0, 0}}, {"call_fact", 2}}; }; }
        rig.service.SetOpsFor([&](const std::string&) { return ops; });
        auto& session = rig.service.SessionForTest(ops);
        session.Call(Call(1), 0.0);
        if (endCase == 2) { session.Tick(0.1); session.Tick(5.0); }
        else if (endCase == 1) { session.Tick(121.0); }
        else { Check("dm fix 1: explicit failed end reports pending", session.EndCall(0.1, "explicit")["pending"] == true); }
        Check("dm fix 1: failed explicit/timeout end stays owned and active", attempts == 1 && session.CallLive() && rig.service.Active() && !rig.service.Holds().empty());
        session.Tick(122.0);
        Check("dm fix 1: queue acceptance alone does not end ownership", attempts == 2 && session.PhoneState(122.0)["call"]["state"] == "ending");
        acknowledged = true;
        session.Tick(124.1);
        Check("dm fix 1: only acknowledgment clears pending end", !session.CallLive() && !rig.service.Active() && session.PhoneState(123.0)["call"]["state"] == (endCase == 2 ? "ended" : endCase == 1 ? "missed" : "cancelled"));
    }
    {
        FakeGame game;
        auto ops = OpsOf(game);
        bool fail = true;
        ops.hideLine = [&](uint64_t id) {
            if (fail) { throw xfb::MethodError("failed", "hide failed"); }
            game.hidden.push_back(id);
        };
        d::Session session(ops);
        session.ShowLine("notify:1", "XF", "retry", 1, 2.0, 0.0);
        session.Tick(0.1);
        Check("dm review 5/14: failed explicit subtitle hide stays owned", !session.HideLinesPrefix("notify:") && session.Busy());
        session.Tick(3.0);
        Check("dm review 5/14: failed expired subtitle hide stays owned", session.Busy() && game.hidden.empty());
        Check("dm review 5/14: failed reset retains subtitle cleanup", session.Reset(true)["cleanup_pending"] == true && session.Busy());
        fail = false;
        session.Tick(4.1);
        Check("dm review 5/14: subtitle retry forgets only confirmed hides", !session.Busy() && game.hidden.size() == 1);
    }
    {
        Rig rig;
        rig.service.NotifyShow(json{{"style", "warning"}, {"text", "retry"}}, rig.Ops());
        auto ops = rig.Ops();
        ops.releaseAll = [](const std::string&) -> json { throw xfb::MethodError("failed", "HUD cleanup failed"); };
        const auto failed = rig.service.ReleaseAllNow("handover", ops);
        Check("dm review 5/11: failed script cleanup retains activity and save hold", failed["released"] == false && rig.service.Active() && !rig.service.Holds().empty());
        Check("dm review 5/11: confirmed script cleanup clears the hold", rig.service.ReleaseAllNow("retry", rig.Ops())["released"] == true && rig.service.Holds().empty());
    }
    {
        d::WatcherEngine engine;
        engine.Arm(Watch(json{{"id", "repeat"}, {"kind", "timer"}, {"seconds", 1}, {"repeat", true}, {"cooldown_s", 3}, {"expires_s", 5}}), 0);
        const auto first = engine.Advance(1.1);
        const auto early = engine.Advance(2.2);
        const auto second = engine.Advance(4.2);
        const auto expired = engine.Advance(5.1);
        Check("dm review 8: repeat timers respect cooldown and fixed expiry", first.size() == 1 && early.empty() && second.size() == 1 && expired.size() == 1 && expired[0].expired && engine.Empty());
        engine.Arm(Watch(json{{"id", "late"}, {"kind", "timer"}, {"seconds", 1}, {"expires_s", 2}}), 0);
        const auto late = engine.Advance(3);
        Check("dm review 8: expiry precedes an overdue first tick", late.size() == 1 && late[0].expired);
    }
    {
        Rig rig;
        rig.service.Vehicle(json{{"target", "mounted"}, {"door", "trunk"}, {"door_state", "locked"}}, rig.Ops());
        rig.service.ReleaseAllNow("handover", rig.Ops());
        Check("dm review 4: unknown vehicle lock baseline retains save hold after release", !rig.service.Holds().empty());
        rig.world.calls.clear();
        rig.service.ReleaseAllNow("handover", rig.Ops());
        Check("dm review 4: retaining a lock hold does not repeatedly restore the vehicle", !Called(rig.world, "vehicle:"));
        rig.service.DropAll("load");
        Check("dm review 4: only load clears the unknown lock hold", rig.service.Holds().empty());
    }
    {
        Rig rig;
        rig.service.Door(json{{"target", "EntityID(8102)"}, {"open", true}}, rig.Ops());
        auto ops = rig.Ops();
        ops.door = [](const d::DoorStep&) -> json { throw xfb::MethodError("failed", "restore failed"); };
        rig.service.ReleaseAllNow("handover", ops);
        Check("dm review 5: failed restoration retains its hold", !rig.service.Holds().empty());
        rig.service.ReleaseAllNow("handover", rig.Ops());
        Check("dm review 5: successful retry clears restoration hold", rig.service.Holds().empty());
        rig.service.LightSpawn(json{{"template", "base\\lamp.ent"}}, rig.Ops());
        rig.world.failDespawn = true;
        Check("dm review 5: failed light removal retains ownership", rig.service.LightRemove(json{{"all", true}}, rig.Ops())["removed"] == 0 && !rig.service.Holds().empty());
        rig.service.ReleaseAllNow("handover", rig.Ops());
        Check("dm review 5: failed release deletion retains ownership", !rig.service.Holds().empty());
        rig.world.failDespawn = false;
        rig.service.ReleaseAllNow("handover", rig.Ops());
        Check("dm review 5: release deletion retries successfully", rig.service.Holds().empty());
    }
    for (const auto& reason : {"kill", "paused", "handover"})
    {
        Rig rig;
        rig.service.AudioPlay(json{{"event", "loop"}, {"loop", true}}, rig.Ops());
        const auto out = rig.service.ReleaseAllNow(reason, rig.Ops());
        Check("dm review 7: every teardown stops tracked audio", out["sounds_stopped"] == 1 && Called(rig.world, "stop:loop:") && !rig.service.Active());
    }
    {
        Rig rig;
        rig.service.NotifyShow(json{{"style", "warning"}, {"text", "owned"}}, rig.Ops());
        Check("dm review 11: banner-only use is active", rig.service.Active());
        rig.service.ReleaseAllNow("handover", rig.Ops());
        Check("dm review 11: banner-only use reaches script teardown", Called(rig.world, "release_all:handover") && !rig.service.Active());
    }
    {
        Rig rig;
        auto ops = rig.Ops();
        size_t pending = 1;
        ops.microPending = [&] { return pending; };
        ops.microCancel = [&](const std::string&) { auto old = pending; pending = 0; return old; };
        rig.service.SetOpsFor([&](const std::string&) { return ops; });
        rig.service.SessionForTest(ops);
        Check("dm review 3: a delayed micro-action alone is active", rig.service.Active());
        rig.service.RestoreAfterKill(ops);
        Check("dm review 3: teardown cancels a delayed action without other resources", pending == 0 && !rig.service.Active());
        ops.microCancelWatch = [&](const std::string& id) { return id == "fired" ? size_t{1} : size_t{0}; };
        Check("dm review 9: disarm cancels a fired one-shot's batch", rig.service.WatchDisarm(json{{"id", "fired"}}, ops)["micro_dropped"] == 1);
        Check("dm review 9: disarm stays idempotent after a batch finishes", rig.service.WatchDisarm(json{{"id", "finished"}}, ops)["disarmed"] == 0);
    }
    {
        Rig rig;
        auto ops = rig.Ops();
        ops.lightSpawn = [](const d::LightStep&) { return json{{"entity", "EntityID(7001)"}, {"pending", true}}; };
        int attempts = 0;
        bool configured = false;
        ops.lightSet = [&](const d::LightSetStep& step) -> json {
            if (++attempts == 1) { throw xfb::MethodError("target_missing", "streaming"); }
            configured = step.colour == std::array<int32_t,3>{1,2,3} && step.intensity == 42 && step.radius == 7 && step.inner == 10 && step.outer == 30;
            return json::object();
        };
        rig.service.SetOpsFor([&](const std::string&) { return ops; });
        rig.service.LightSpawn(json{{"template", "base\\lamp.ent"}, {"colour", {1,2,3}}, {"intensity", 42}, {"radius", 7}, {"inner", 10}, {"outer", 30}}, ops);
        rig.service.Tick(0.1, {});
        rig.service.Tick(0.1, {});
        Check("dm review 10: asynchronous light applies all settings after streaming", configured && rig.service.Spawned(json::object(), ops)["spawned"][0]["pending"] == false);
        ops.lightSet = [](const d::LightSetStep&) -> json { throw xfb::MethodError("target_missing", "streaming"); };
        ops.despawn = [](const std::string&) -> json { throw xfb::MethodError("failed", "delete failed"); };
        Rig late;
        late.service.SetOpsFor([&](const std::string&) { return ops; });
        late.service.LightSpawn(json{{"template", "base\\lamp.ent"}}, ops);
        for (int i=0; i<12; ++i) { late.service.Tick(0.5, {}); }
        Check("dm review 10: light streaming has a bounded failure", late.service.Spawned(json::object(), ops)["spawned"][0]["error"] == "not_streamed");
        ops.despawn = [](const std::string&) { return json{{"despawned", true}}; };
        late.service.ReleaseAllNow("retry", ops);
        Check("dm review 10/14: a failed light can be removed and forgotten", late.service.Spawned(json::object(), ops)["spawned"].empty());
    }
    {
        std::mutex mutex;
        std::condition_variable cv;
        std::vector<std::string> ran;
        d::MicroRunner runner([&](const std::string& method, const json&, const std::string&, const std::string& token) {
            std::scoped_lock lock(mutex);
            ran.push_back(method + ":" + token);
            cv.notify_all();
            return json{{"ok", true}};
        }, {});
        d::MicroBatch a;
        a.watch = "a";
        a.sessionToken = "old-session";
        d::MicroAction action;
        action.method = "a";
        action.delayS = 30.0;
        a.actions.push_back(action);
        runner.Enqueue(a);
        Check("dm fix 5: worker has entered A's cancellable delay", runner.WaitForDelay("a", std::chrono::seconds(2)));
        auto b = a;
        b.watch = "b";
        b.actions[0].method = "b";
        b.actions[0].delayS = 0.0;
        runner.Enqueue(b);
        const auto pending = runner.Pending();
        const auto cancelled = runner.CancelWatch("a");
        std::unique_lock lock(mutex);
        const bool completed = cv.wait_for(lock, std::chrono::seconds(2), [&] { return !ran.empty(); });
        Check("dm review 3/9: running delays count, cancellation is per watcher and execution uses originating token", pending == 2 && cancelled == 1 && completed && ran == std::vector<std::string>{"b:old-session"});
        lock.unlock();
        auto c = a;
        c.watch = "c";
        c.actions[0].method = "c";
        runner.Enqueue(c);
        Check("dm fix 5: worker has entered C's delay before global cancellation", runner.WaitForDelay("c", std::chrono::seconds(2)));
        const auto dropped = runner.Cancel("kill");
        Check("dm fix 5: global cancellation counts the running delay", dropped == 1 && runner.Pending() == 0);
        auto fence = b;
        fence.watch = "fence";
        fence.actions[0].method = "fence";
        runner.Enqueue(fence);
        lock.lock();
        const bool fenced = cv.wait_for(lock, std::chrono::seconds(2), [&] { return ran.size() >= 2; });
        Check("dm fix 5: a later action fences cancellation without running C", fenced && ran == std::vector<std::string>{"b:old-session", "fence:old-session"});
        lock.unlock();
        runner.Stop();
    }
}

} // namespace

int DmUnitTests()
{
    try { ReviewTests(); }
    catch (const std::exception& e) { std::printf("DM review fixture: %s\n", e.what()); Check("dm review tests completed without an unexpected exception", false); }
    ParseTests();
    UndoTests();
    PatternTests();
    WatcherTests();
    SessionTests();
    ServiceTests();
    return gFailures;
}
