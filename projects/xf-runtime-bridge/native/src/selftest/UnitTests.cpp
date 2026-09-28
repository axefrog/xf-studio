// In-process checks of the bridge core pieces that are hard to reach through the pipe:
// UTF-8-safe log sanitising, the JSON nesting pre-scan, lossless-or-replaced serialisation and
// the game-thread queue's task states, the kill switch's ordering against queued writes and its
// once-only restore, the write logic shared with the plugin (core/Writes.cpp), config write classes
// and the dispatcher's write gate. Run with `xfb_selftest --unit`; prints PASS/FAIL lines.

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cmath>
#include <cstring>
#include <string>
#include <functional>
#include <limits>
#include <map>
#include <vector>
#include <thread>

#include "core/Bridge.hpp"
#include "core/Config.hpp"
#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/LivePose.hpp"
#include "core/Log.hpp"
#include "core/Messages.hpp"
#include "core/OptionsExchange.hpp"
#include "core/Params.hpp"
#include "core/ScriptFrame.hpp"
#include "core/Session.hpp"
#include "core/Writes.hpp"

namespace
{
using json = nlohmann::json;
using namespace std::chrono_literals;

int gFailures = 0;

void Check(const char* aName, bool aOk, const std::string& aDetail = {})
{
    if (!aOk)
    {
        ++gFailures;
    }
    std::printf("%s unit: %s%s%s\n", aOk ? "PASS" : "FAIL", aName, aDetail.empty() ? "" : " ", aDetail.c_str());
    std::fflush(stdout);
}

bool IsValidUtf8(const std::string& aText)
{
    if (aText.empty())
    {
        return true;
    }
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, aText.data(), static_cast<int>(aText.size()), nullptr,
                               0) > 0;
}

std::string Nested(size_t aDepth)
{
    return std::string(aDepth, '[') + std::string(aDepth, ']');
}

long long MsSince(std::chrono::steady_clock::time_point aStart)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - aStart).count();
}

// Simulated game thread: waits until a task is queued, then runs exactly one.
void DrainOne(xfb::GameThreadQueue& aQueue, std::chrono::milliseconds aDelay)
{
    std::this_thread::sleep_for(aDelay);
    const auto deadline = std::chrono::steady_clock::now() + 2s;
    while (aQueue.Drain(1) == 0 && std::chrono::steady_clock::now() < deadline)
    {
        std::this_thread::sleep_for(1ms);
    }
}

void SanitizeTests()
{
    const std::string e = "\xC3\xA9"; // U+00E9, two bytes
    const auto cut = xfb::Sanitize(e + e + e, 5);
    Check("Sanitize cuts on a character boundary", cut == e + e + " [cut 2 bytes]" && IsValidUtf8(cut), cut);

    const std::string emoji = "\xF0\x9F\x98\x80"; // U+1F600, four bytes
    const auto emojiCut = xfb::Sanitize("ab" + emoji, 4);
    Check("Sanitize never keeps part of a 4-byte character", emojiCut == "ab [cut 4 bytes]", emojiCut);

    const auto invalid = xfb::Sanitize(std::string("x\xFF\xFEy\xC3"), 64);
    Check("Sanitize replaces invalid UTF-8 with '?'", invalid == "x??y?" && IsValidUtf8(invalid), invalid);

    const auto surrogate = xfb::Sanitize(std::string("\xED\xA0\x80"), 64); // UTF-16 surrogate, invalid in UTF-8
    Check("Sanitize rejects encoded surrogates", surrogate == "???", surrogate);

    const auto controls = xfb::Sanitize(std::string("a\nb\x01" "c\x7F"), 64);
    Check("Sanitize replaces control characters", controls == "a b?c?", controls);
}

void NestingTests()
{
    Check("nesting depth of [[[]]] is 3", xfb::JsonNestingDepth("[[[]]]", 32) == 3);
    Check("brackets inside strings do not count", xfb::JsonNestingDepth(R"({"a":"[[[[{{{{"})", 32) == 1);
    Check("escaped quotes keep the string open", xfb::JsonNestingDepth(R"({"a":"\"[[[[\\"})", 32) == 1);
    Check("depth 32 is allowed", xfb::JsonNestingDepth(Nested(32), xfb::kMaxJsonDepth) == 32);
    Check("depth 33 is over the limit", xfb::JsonNestingDepth(Nested(33), xfb::kMaxJsonDepth) > xfb::kMaxJsonDepth);
    const auto deep = xfb::JsonNestingDepth(Nested(100000), xfb::kMaxJsonDepth);
    Check("a 100000-deep value stops at the first level past the limit", deep == xfb::kMaxJsonDepth + 1,
          std::to_string(deep));
}

void SerializeTests()
{
    std::string serialized;
    bool threw = false;
    try
    {
        serialized = xfb::SerializeJson(json{{"text", std::string("ok\xFF\xFE")}});
    }
    catch (...)
    {
        threw = true;
    }
    Check("SerializeJson replaces invalid UTF-8 instead of throwing",
          !threw && serialized.find("\xEF\xBF\xBD") != std::string::npos && IsValidUtf8(serialized), serialized);
}

void QueueTests()
{
    // A task still queued when its waiter times out is cancelled and never runs.
    {
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::atomic<bool> ran{false};
        json result;
        std::string error;
        const auto outcome = queue.Run(
            [&] {
                ran = true;
                return json(1);
            },
            50ms, result, error, "unit.queued");
        const auto drained = queue.Drain(4);
        Check("queued task that timed out reports timeout and never runs",
              outcome == xfb::QueueResult::Timeout && drained == 0 && !ran.load());
    }

    // A task already running at the timeout is waited for within the grace period.
    {
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::thread game([&] { DrainOne(queue, 20ms); });
        json result;
        std::string error;
        const auto outcome = queue.Run(
            [] {
                std::this_thread::sleep_for(120ms);
                return json(42);
            },
            50ms, result, error, "unit.grace", 1000ms);
        game.join();
        Check("running task that finishes within the grace period returns its result",
              outcome == xfb::QueueResult::Done && result == json(42) && queue.LateCompletions() == 0);
    }

    // A task still running after timeout + grace: timeout_after_start, then a logged late completion.
    {
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::thread game([&] { DrainOne(queue, 10ms); });
        json result;
        std::string error;
        const auto started = std::chrono::steady_clock::now();
        const auto outcome = queue.Run(
            [] {
                std::this_thread::sleep_for(400ms);
                return json(7);
            },
            50ms, result, error, "unit.late", 50ms);
        const auto waited = MsSince(started);
        game.join();
        Check("running task past the grace period reports timeout_after_start",
              outcome == xfb::QueueResult::TimeoutAfterStart && waited < 300, std::to_string(waited) + " ms");
        Check("its completion afterwards is counted as late", queue.LateCompletions() == 1);
    }

    // Close releases a queued waiter at once and refuses later tasks.
    {
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::thread closer([&] {
            std::this_thread::sleep_for(50ms);
            queue.Close();
        });
        json result;
        std::string error;
        std::atomic<bool> ran{false};
        const auto started = std::chrono::steady_clock::now();
        const auto outcome = queue.Run(
            [&] {
                ran = true;
                return json(1);
            },
            5000ms, result, error, "unit.close_queued");
        const auto waited = MsSince(started);
        closer.join();
        queue.Drain(4);
        Check("Close releases a queued waiter at once; the task never runs",
              outcome == xfb::QueueResult::NotPumping && waited < 1000 && !ran.load(), std::to_string(waited) + " ms");
        const auto later = queue.Run([] { return json(1); }, 50ms, result, error, "unit.after_close");
        Check("after Close every task is refused", later == xfb::QueueResult::NotPumping);
    }

    // Close releases the waiter of a running task at once (bounded bridge stop).
    {
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::thread game([&] { DrainOne(queue, 0ms); });
        std::thread closer([&] {
            std::this_thread::sleep_for(50ms);
            queue.Close();
        });
        json result;
        std::string error;
        const auto started = std::chrono::steady_clock::now();
        const auto outcome = queue.Run(
            [] {
                std::this_thread::sleep_for(300ms);
                return json(1);
            },
            5000ms, result, error, "unit.close_running");
        const auto waited = MsSince(started);
        game.join();
        closer.join();
        Check("Close releases the waiter of a running task at once",
              outcome == xfb::QueueResult::TimeoutAfterStart && waited < 250 && queue.LateCompletions() == 1,
              std::to_string(waited) + " ms");
    }
}
// Kill switch (RB-13): Bridge::Kill closes the game-thread queue synchronously, so a write that
// is already queued never runs, and the undo (which the game thread starts only once
// RestoreReady() is true) can never be followed by a bridge write.
void KillTests()
{
    xfb::Config config;
    config.bridgeEnabled = true;
    config.allowWrites = true;
    xfb::Session session;
    std::string error;
    wchar_t temp[MAX_PATH]{};
    GetTempPathW(MAX_PATH, temp);
    // Never written: the bridge is not started, so no session.json or KILL file is involved.
    if (!xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-kill-not-created"))
    {
        Check("kill test session", false, error);
        return;
    }
    xfb::GameThreadQueue queue;
    queue.SetPumping(true);
    xfb::Bridge bridge(config, session, queue);
    xfb::writes::RestoreOnce restore;
    restore.MarkWrite(); // a write ran earlier in the session
    int restoreRuns = 0;

    std::atomic<bool> queued{false};
    std::atomic<bool> writeRan{false};
    std::atomic<bool> restored{false};
    std::atomic<bool> writeAfterRestore{false};
    xfb::QueueResult outcome = xfb::QueueResult::Done;
    std::thread writer([&] {
        json result;
        std::string werror;
        queued = true;
        outcome = queue.Run(
            [&] {
                writeRan = true;
                if (restored.load())
                {
                    writeAfterRestore = true;
                }
                return json(1);
            },
            5000ms, result, werror, "unit.write_before_kill");
    });
    while (!queued.load())
    {
        std::this_thread::sleep_for(1ms);
    }
    std::this_thread::sleep_for(50ms); // the write is in the queue, not yet drained

    Check("before the kill the undo may not run", !bridge.RestoreReady());
    const auto started = std::chrono::steady_clock::now();
    bridge.Kill("unit");
    const auto killMs = MsSince(started);
    Check("Kill closes the queue before it returns, without blocking",
          queue.IsClosed() && bridge.RestoreReady() && killMs < 100, std::to_string(killMs) + " ms");
    writer.join();
    Check("the queued write's waiter is released as not run", outcome == xfb::QueueResult::NotPumping);

    // Simulated game-thread ticks, in the plugin's order (Main.cpp OnRunningUpdate): drain, then
    // the restore through RestoreOnce once the bridge is ready.
    for (int tick = 0; tick < 5; ++tick)
    {
        queue.Drain(4);
        restore.Tick(bridge.RestoreReady(), [&] {
            ++restoreRuns;
            restored = true;
        });
    }
    json result;
    const auto late = queue.Run([&] {
        writeAfterRestore = true;
        return json(1);
    }, 50ms, result, error, "unit.write_after_kill");
    queue.Drain(4);
    Check("no queued write runs after kill", !writeRan.load() && !writeAfterRestore.load() && restored.load());
    Check("the restore ran exactly once over five ticks", restoreRuns == 1, std::to_string(restoreRuns));
    Check("writes sent after the kill are refused", late == xfb::QueueResult::NotPumping);
}
// The kill switch's restore trigger (RB-16): once per process, only after a write, only when ready.
void RestoreOnceTests()
{
    {
        xfb::writes::RestoreOnce restore;
        int runs = 0;
        const auto run = [&] { ++runs; };
        restore.Tick(true, run);
        Check("no restore without a write, even when killed", runs == 0 && !restore.Done());
        restore.MarkWrite();
        restore.Tick(false, run);
        Check("no restore before the bridge is ready (killed and queue closed)", runs == 0);
        const bool ran = restore.Tick(true, run);
        restore.Tick(true, run);
        restore.MarkWrite();
        restore.Tick(true, run);
        Check("restore runs once when ready after a write, never again", ran && runs == 1 && restore.Done());
    }
    {
        xfb::writes::RestoreOnce restore;
        restore.MarkWrite();
        int calls = 0;
        std::string reported;
        bool threw = false;
        try
        {
            restore.Tick(true, [&] {
                ++calls;
                throw xfb::MethodError("rtti_missing", "script layer gone");
            }, [&](const std::string& aWhat) { reported = aWhat; });
            restore.Tick(true, [&] { ++calls; });
        }
        catch (...)
        {
            threw = true;
        }
        Check("a failing restore is reported, never thrown, and not retried",
              !threw && calls == 1 && reported == "script layer gone", reported);
    }
    {
        // Through a fake script caller, the way Main.cpp calls it: Bridge::Kill, then ticks.
        xfb::Config config;
        config.allowWrites = true;
        xfb::Session session;
        std::string error;
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-restore-not-created");
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        xfb::Bridge bridge(config, session, queue);
        xfb::writes::RestoreOnce restore;
        std::vector<std::string> scriptCalls;
        const auto fakeScript = [&] { scriptCalls.push_back("XFBridgeActions.RestoreAfterKill"); };
        restore.MarkWrite();
        for (int tick = 0; tick < 3; ++tick)
        {
            queue.Drain(4);
            restore.Tick(bridge.RestoreReady(), fakeScript);
        }
        const bool quietBefore = scriptCalls.empty();
        bridge.Kill("unit");
        for (int tick = 0; tick < 3; ++tick)
        {
            queue.Drain(4);
            restore.Tick(bridge.RestoreReady(), fakeScript);
        }
        Check("the plugin's trigger calls the script restore once, only after the kill",
              quietBefore && scriptCalls.size() == 1, std::to_string(scriptCalls.size()));
    }
}

json Attr(const char* aName, double aBefore, double aAfter, bool aKnown = true)
{
    return json{{"name", aName}, {"before", aBefore}, {"after", aAfter}, {"before_known", aKnown}};
}

// Undo values (RB-18).
void UndoTests()
{
    namespace w = xfb::writes;
    {
        std::vector<std::string> unknown;
        const auto undo = w::UndoParams(json::array({Attr("fov", 20, 30), Attr("subject.yaw", -1, 150), Attr("look_at", -1, 2, false),
                                                     Attr("dof", 1, 0), Attr("look_at_part", -1, 1)}),
                                        &unknown);
        Check("undo keeps a real -1 slider value and the booleans",
              undo["fov"] == 20.0 && undo["subject"]["yaw"] == -1.0 && undo["dof"] == true, undo.dump());
        Check("an unknown or -1 option value is left out and named",
              !undo.contains("look_at") && !undo.contains("look_at_part") && unknown.size() == 2, undo.dump());
    }
    {
        std::vector<std::string> unknown;
        const auto undo = w::UndoParams(json::array({Attr("on", 0, 1), Attr("type", 2, 1), Attr("shadow", 1, 0), Attr("brightness", 50, 80),
                                                     Attr("camera_preset", 0, 7)}),
                                        &unknown);
        Check("light undo turns the switch back into a flag and the type into its name",
              undo["on"] == false && undo["type"] == "ambient" && undo["shadow"] == true && undo["brightness"] == 50.0 && unknown.empty(),
              undo.dump());
        Check("camera_preset undo is the earlier preset number", undo["camera_preset"] == 0, undo.dump());
        std::vector<std::string> unknownType;
        const auto none = w::UndoParams(json::array({Attr("type", -1, 1)}), &unknownType);
        Check("a light type the menu didn't show is left out of the undo and named",
              !none.contains("type") && unknownType.size() == 1 && unknownType[0] == "type", none.dump());
    }
    {
        const auto both = w::HudResult(json{{"hidden", true}, {"was_hidden", false}, {"cursor_hidden", true}, {"was_cursor_hidden", false}});
        Check("hud undo shows the menu and the cursor again",
              both["undo"]["params"] == json{{"hidden", false}, {"cursor", true}} && !both.contains("undo_note"), both.dump());
        const auto mixed = w::HudResult(json{{"hidden", true}, {"was_hidden", true}, {"cursor_hidden", true}, {"was_cursor_hidden", false}});
        Check("hud undo with menu and cursor in different states restores the menu only and says so",
              mixed["undo"]["params"] == json{{"hidden", true}, {"cursor", false}} && mixed.contains("undo_note"), mixed.dump());
    }
    {
        json out;
        w::AttachUndo(out, "photo.camera.set", json::object(), {"look_at"});
        Check("no known value: undo is null with a note", out["undo"].is_null() && out["undo_note"].get<std::string>().find("look_at") != std::string::npos,
              out.dump());
    }
    {
        const auto frozen = w::PauseResult(json{{"frozen", true}, {"was_frozen", false}});
        const auto again = w::PauseResult(json{{"frozen", true}, {"was_frozen", true}});
        const auto thawed = w::PauseResult(json{{"frozen", false}, {"was_frozen", true}});
        const auto legacy = w::PauseResult(json{{"frozen", true}});
        Check("world.pause undo returns to the earlier state",
              frozen["undo"]["params"]["paused"] == false && thawed["undo"]["params"]["paused"] == true, frozen.dump());
        Check("world.pause that changed nothing, or an unknown earlier state, has no undo",
              again["undo"].is_null() && legacy["undo"].is_null(), again.dump());
    }
    {
        const auto known = w::ExpressionResult(json{{"key", 28}, {"before", 9}, {"after", 60}, {"before_known", true}});
        const auto unknown = w::ExpressionResult(json{{"key", 28}, {"before", -1}, {"after", 60}, {"before_known", false}});
        const auto minusOne = w::ExpressionResult(json{{"key", 28}, {"before", -1}, {"after", 60}});
        Check("expression undo is the earlier faceId", known["undo"]["params"]["faceId"] == 9, known.dump());
        Check("an expression before of -1 gives no undo parameters", unknown["undo"].is_null() && minusOne["undo"].is_null(),
              minusOne.dump());
    }
    {
        const auto reset = w::CameraResetResult(json::array({json{{"key", 1}, {"before", 30}, {"after", 15}, {"before_known", true}},
                                                             json{{"key", 7}, {"before", 180}, {"after", 180}, {"before_known", true}},
                                                             json{{"key", 15}, {"before", -1}, {"after", 0}, {"before_known", false}}}));
        Check("reset: true returns an undo for what it changed",
              reset["undo"]["method"] == "photo.camera.set" && reset["undo"]["params"] == json{{"fov", 30.0}} &&
                  reset["reset"][0]["name"] == "fov" && reset["undo_note"].get<std::string>().find("look_at") != std::string::npos,
              reset.dump());
        const auto nothing = w::CameraResetResult(json::array({json{{"key", 1}, {"before", 15}, {"after", 15}}}));
        Check("a reset that changed nothing has no undo", nothing["undo"].is_null(), nothing.dump());

        // RB-29: a failing key doesn't stop the reset; the answer is partial with an undo.
        const auto partial = w::CameraReset({1, 2, 3}, [](int32_t aKey) -> json {
            if (aKey == 2)
            {
                throw xfb::MethodError("write_mismatch", "the menu showed another value");
            }
            if (aKey == 3)
            {
                throw xfb::MethodError("unavailable", "not in this menu");
            }
            return json{{"key", aKey}, {"before", 30}, {"after", 15}, {"before_known", true}};
        });
        Check("reset: a failed key is reported and the others still reset",
              partial.value("partial", false) && partial["errors"].size() == 1 && partial["errors"][0]["name"] == "roll" &&
                  partial["errors"][0]["code"] == "write_mismatch" && partial["reset"].size() == 1 &&
                  partial["undo"]["params"] == json{{"fov", 30.0}},
              partial.dump());
        std::string allFailed;
        try
        {
            w::CameraReset({1, 2}, [](int32_t) -> json { throw xfb::MethodError("failed", "no"); });
        }
        catch (const xfb::MethodError& e)
        {
            allFailed = e.code + "|" + e.what();
        }
        Check("reset: nothing reset and a failure throws, naming every key",
              allFailed.rfind("failed|nothing was reset", 0) == 0 && allFailed.find("fov") != std::string::npos &&
                  allFailed.find("roll") != std::string::npos,
              allFailed);
        const auto skipped = w::CameraReset({3}, [](int32_t) -> json { throw xfb::MethodError("unavailable", "no"); });
        Check("reset: keys photo mode doesn't offer are skipped quietly",
              !skipped.contains("partial") && skipped["reset"].empty() && skipped["undo"].is_null(), skipped.dump());
    }
}

// The light sequence (RB-18, RB-20) against a fake photo mode.
struct FakePhoto
{
    std::map<int32_t, float> values;
    std::vector<std::string> calls;
    int32_t failKey = -1;
    bool failSettle = false;
    int settles = 0;
    xfb::writes::LightOps Ops()
    {
        xfb::writes::LightOps ops;
        ops.set = [this](int32_t aKey, float aValue) {
            calls.push_back(std::to_string(aKey) + "=" + std::to_string(static_cast<int>(aValue)));
            if (aKey == failKey)
            {
                throw xfb::MethodError("write_mismatch", "simulated failure");
            }
            const float before = values[aKey];
            values[aKey] = aValue;
            return json{{"key", aKey}, {"before", before}, {"before_known", true}, {"after", aValue}};
        };
        ops.settle = [this] {
            ++settles;
            calls.push_back("settle");
            if (failSettle)
            {
                throw xfb::MethodError("timeout", "photo mode didn't load the selected light's values in time");
            }
        };
        return ops;
    }
};

std::string LightError(FakePhoto& aFake, const xfb::params::LightRequest& aRequest, std::string* aCode = nullptr)
{
    try
    {
        xfb::writes::LightSet(aRequest, aFake.Ops());
    }
    catch (const xfb::MethodError& e)
    {
        if (aCode)
        {
            *aCode = e.code;
        }
        return e.what();
    }
    return {};
}

void LightTests()
{
    namespace p = xfb::params;
    {
        FakePhoto fake;
        fake.values[p::key::kLightSelect] = 0; // light 1 selected
        fake.values[p::key::kLightBrightness] = 40;
        const auto out = xfb::writes::LightSet(p::ParseLight(json::parse(R"({"light":2,"brightness":80})")), fake.Ops());
        Check("light set selects, waits for photo mode, then sets",
              fake.calls.size() == 3 && fake.calls[0] == "43=1" && fake.calls[1] == "settle" && fake.calls[2] == "47=80",
              json(fake.calls).dump());
        Check("its undo restores the value and the previous selection",
              out["undo"]["params"] == json{{"brightness", 40.0}, {"light", 2}, {"select_after", 1}}, out["undo"].dump());
        FakePhoto undoFake = fake;
        undoFake.calls.clear();
        xfb::writes::LightSet(p::ParseLight(out["undo"]["params"]), undoFake.Ops());
        Check("running that undo puts the value and the menu's selection back",
              undoFake.values[p::key::kLightBrightness] == 40 && undoFake.values[p::key::kLightSelect] == 0,
              json(undoFake.calls).dump());
    }
    {
        FakePhoto fake;
        fake.values[p::key::kLightSelect] = 1; // light 2 already selected: no wait, no select_after
        const auto out = xfb::writes::LightSet(p::ParseLight(json::parse(R"({"light":2,"hue":30})")), fake.Ops());
        Check("the same light needs no wait and no selection undo", fake.settles == 0 && !out["undo"]["params"].contains("select_after"),
              out.dump());
    }
    {
        FakePhoto fake;
        fake.failKey = p::key::kLightBrightness;
        std::string code;
        const auto message = LightError(fake, p::ParseLight(json::parse(R"({"light":3,"brightness":80})")), &code);
        Check("a failure after the selection says so and puts the selection back",
              code == "write_mismatch" && message.find("no light value was changed") != std::string::npos &&
                  message.find("light 1 is selected again") != std::string::npos && fake.values[p::key::kLightSelect] == 0,
              message);
    }
    {
        FakePhoto fake;
        fake.failKey = p::key::kLightHue;
        const auto message = LightError(fake, p::ParseLight(json::parse(R"({"light":2,"brightness":10,"hue":90})")));
        Check("a failure part-way names what already changed",
              message.find("hue: ") == 0 && message.find("already changed: brightness") != std::string::npos, message);
    }
    {
        FakePhoto fake;
        fake.failSettle = true;
        std::string code;
        const auto message = LightError(fake, p::ParseLight(json::parse(R"({"light":2,"brightness":10})")), &code);
        Check("no game ticks: the light values aren't touched (they could be another light's)",
              code == "timeout" && fake.values.count(p::key::kLightBrightness) == 0 &&
                  message.find("light 1 is selected again") != std::string::npos,
              message);
    }
}

void WaitTicksTests()
{
    xfb::GameThreadQueue queue;
    queue.SetPumping(true);
    std::atomic<bool> stop{false};
    std::thread game([&] {
        while (!stop.load())
        {
            queue.Drain(1);
            std::this_thread::sleep_for(5ms);
        }
    });
    const auto started = std::chrono::steady_clock::now();
    const bool ok = xfb::writes::WaitTicks(queue, 3, 1000ms);
    const auto waited = MsSince(started);
    stop = true;
    game.join();
    Check("WaitTicks returns after three game ticks", ok && waited >= 10 && waited < 500, std::to_string(waited) + " ms");
    xfb::GameThreadQueue idle;
    Check("WaitTicks gives up when the game thread doesn't tick", !xfb::writes::WaitTicks(idle, 3, 100ms));
}

// Write classes (RB-26): config parsing and the dispatcher's gate.
void WriteClassTests()
{
    Check("allow_write_classes defaults to all three", xfb::ParseConfig("").writeClasses == 7u);
    const auto some = xfb::ParseConfig("[bridge]\nallow_write_classes = photo, WORLD\n");
    Check("allow_write_classes takes a list", some.writeClasses == (xfb::kWritePhoto | xfb::kWriteWorld));
    const auto typo = xfb::ParseConfig("[bridge]\nallow_write_classes = photo, charcter\n");
    Check("an unknown class is ignored with a warning (a typo only takes a class away)",
          typo.writeClasses == xfb::kWritePhoto && typo.warnings.size() == 1);
    Check("an empty list allows no class", xfb::ParseConfig("[bridge]\nallow_write_classes =\n").writeClasses == 0u);

    xfb::Config config;
    config.allowWrites = true;
    config.writeClasses = xfb::kWritePhoto;
    config.maxRequestsPerSecond = 200;
    xfb::Session session;
    std::string error;
    wchar_t temp[MAX_PATH]{};
    GetTempPathW(MAX_PATH, temp);
    xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-classes-not-created");
    xfb::GameThreadQueue queue;
    xfb::Dispatcher dispatcher(config, session, queue);
    int ran = 0;
    for (const auto& [name, access] : std::vector<std::pair<std::string, xfb::Access>>{{"t.photo", xfb::Access::WritePhoto},
                                                                                        {"t.world", xfb::Access::WriteWorld},
                                                                                        {"t.character", xfb::Access::WriteCharacter},
                                                                                        {"t.probe", xfb::Access::Write}})
    {
        dispatcher.Register({name, access, xfb::RunOn::BridgeThread, "unit", [&](const xfb::MethodContext&) {
                                 ++ran;
                                 return json{{"ok", true}};
                             }});
    }
    const auto call = [&](const char* aMethod) {
        const auto line = json{{"v", 1}, {"id", 1}, {"token", session.token}, {"method", aMethod}}.dump();
        const auto reply = json::parse(dispatcher.Handle(line, 0).line);
        return reply.value("ok", false) ? std::string("ok") : reply["error"].value("code", std::string());
    };
    const auto photo = call("t.photo");
    const auto world = call("t.world");
    const auto character = call("t.character");
    const auto probe = call("t.probe");
    Check("the dispatcher allows only the listed write classes",
          photo == "ok" && world == "write_class_disabled" && character == "write_class_disabled" && probe == "ok" && ran == 2,
          photo + " " + world + " " + character + " " + probe);
    config.allowWrites = false;
    Check("allow_writes = false still refuses every class first", call("t.photo") == "writes_disabled");
    Check("access names match the tools' permission classes",
          xfb::AccessName(xfb::Access::WritePhoto) == "write-photo" && xfb::AccessName(xfb::Access::WriteWorld) == "write-world" &&
              xfb::AccessName(xfb::Access::WriteCharacter) == "write-character");
}

// Phase-2 parameter checks: each refusal is bad_params with a plain message; accepted input is
// turned into the attribute keys the redscript layer receives.
std::string ParamsCode(const std::function<void()>& aParse)
{
    try
    {
        aParse();
        return "ok";
    }
    catch (const xfb::MethodError& e)
    {
        return e.code;
    }
}

void ParamsTests()
{
    namespace p = xfb::params;
    const auto camera = p::ParseCamera(json::parse(R"({"fov":20,"subject":{"yaw":180,"up_down":-2},"dof":false})"));
    Check("camera params map to attribute keys (fov 1, dof 26, subject yaw 7, up/down 37)",
          camera.attributes.size() == 4 && camera.attributes[0].key == 1 && camera.attributes[0].value == 20.0f &&
              camera.attributes[1].key == 26 && camera.attributes[1].value == 0.0f && camera.attributes[2].key == 7 &&
              camera.attributes[2].name == "subject.yaw" && camera.attributes[3].key == 37);
    Check("camera refuses an unknown parameter", ParamsCode([] { p::ParseCamera(json::parse(R"({"zoom":2})")); }) == "bad_params");
    Check("camera refuses fov out of bounds", ParamsCode([] { p::ParseCamera(json::parse(R"({"fov":500})")); }) == "bad_params");
    Check("camera refuses reset combined with values",
          ParamsCode([] { p::ParseCamera(json::parse(R"({"reset":true,"fov":30})")); }) == "bad_params");
    Check("camera refuses an empty request", ParamsCode([] { p::ParseCamera(json::object()); }) == "bad_params");
    Check("camera accepts reset alone", p::ParseCamera(json::parse(R"({"reset":true})")).reset);
    const auto light = p::ParseLight(json::parse(R"({"light":2,"hue":200,"brightness":50})"));
    Check("light params select light 2 and map brightness 47, hue 51",
          light.light == 2 && light.attributes.size() == 2 && light.attributes[0].key == 47 && light.attributes[1].key == 51);
    Check("light refuses light 4", ParamsCode([] { p::ParseLight(json::parse(R"({"light":4,"hue":1})")); }) == "bad_params");
    const auto lightOn = p::ParseLight(json::parse(R"({"light":1,"brightness":80,"type":"ambient","on":true})"));
    Check("light on (key 44 = 1) and type (key 45: ambient = 2) come first, then the values",
          lightOn.attributes.size() == 3 && lightOn.attributes[0].key == 44 && lightOn.attributes[0].value == 1.0f &&
              lightOn.attributes[1].key == 45 && lightOn.attributes[1].value == 2.0f && lightOn.attributes[2].key == 47);
    Check("light off is key 44 = 0 and spot is key 45 = 1",
          p::ParseLight(json::parse(R"({"on":false,"type":"spot"})")).attributes[0].value == 0.0f &&
              p::ParseLight(json::parse(R"({"on":false,"type":"spot"})")).attributes[1].value == 1.0f);
    Check("light refuses an unknown type", ParamsCode([] { p::ParseLight(json::parse(R"({"type":"area"})")); }) == "bad_params");
    Check("photo.enter without a route is refused with photo_key_needed",
          ParamsCode([] { p::ParsePhotoEnter(json::object()); }) == "photo_key_needed" &&
              ParamsCode([] { p::ParsePhotoEnter(json::parse(R"({"route":"auto"})")); }) == "photo_key_needed");
    Check("photo.enter keeps the quest route for research and refuses unknown routes",
          p::ParsePhotoEnter(json::parse(R"({"route":"quest"})")) == p::PhotoEnterRoute::Quest &&
              ParamsCode([] { p::ParsePhotoEnter(json::parse(R"({"route":"input"})")); }) == "bad_params");
    const auto preset = p::ParseCamera(json::parse(R"({"fov":20,"camera_preset":7})"));
    Check("camera_preset is key 23 and comes before the other camera values",
          preset.attributes.size() == 2 && preset.attributes[0].key == 23 && preset.attributes[0].value == 7.0f &&
              p::CameraKeys().front() == 23 && p::CameraParamName(23) == "camera_preset");
    Check("grain is key 25 and chromatic aberration key 13",
          p::ParseCamera(json::parse(R"({"grain":0,"chromatic_aberration":0})")).attributes[0].key == 25 &&
              p::ParseCamera(json::parse(R"({"grain":0,"chromatic_aberration":0})")).attributes[1].key == 13 &&
              ParamsCode([] { p::ParseCamera(json::parse(R"({"grain":2})")); }) == "bad_params");
    Check("camera_preset is 0 to 9", ParamsCode([] { p::ParseCamera(json::parse(R"({"camera_preset":10})")); }) == "bad_params");
    Check("light shadow is key 46 after on and type",
          p::ParseLight(json::parse(R"({"shadow":false,"on":true})")).attributes[1].key == 46);
    Check("cc.confirm and cc.back are refused while allow_creator_leave is off",
          ParamsCode([] { p::CreatorLeaveAllowed(false); }) == "creator_leave_disabled" && p::CreatorLeaveAllowed(true));
    Check("allow_creator_leave defaults to false and parses",
          !xfb::ParseConfig("").allowCreatorLeave && xfb::ParseConfig("[bridge]\nallow_creator_leave = true\n").allowCreatorLeave);
    const auto hud = p::ParseHud(json::parse(R"({"hidden":true,"cursor":false})"));
    Check("hud takes hidden and cursor (cursor defaults to true)", hud.hidden && !hud.cursor && p::ParseHud(json::object()).cursor);
    Check("subject offsets are metres within 2 of the head",
          p::ParseSubject(json::parse(R"({"up":0.07,"forward":0.09})")).forward == 0.09f &&
              ParamsCode([] { p::ParseSubject(json::parse(R"({"up":3})")); }) == "bad_params");
    Check("expression needs a whole faceId", ParamsCode([] { p::ParseExpression(json::parse(R"({"faceId":2.5})")); }) == "bad_params");
    Check("cc.apply needs option and index", ParamsCode([] { p::ParseCharacterApply(json::parse(R"({"option":"XF"})")); }) == "bad_params");
    Check("cc.apply refuses control characters in the option name",
          ParamsCode([] { p::ParseCharacterApply(json::parse("{\"option\":\"a\\u0001\",\"index\":1}")); }) == "bad_params");
    const auto time = p::ParseTime(json::parse(R"({"hours":0,"minutes":30})"));
    Check("time accepts hour 0", time.hours == 0 && time.minutes == 30 && time.totalSeconds == -1);
    Check("time refuses hours and total_seconds together",
          ParamsCode([] { p::ParseTime(json::parse(R"({"hours":1,"total_seconds":5})")); }) == "bad_params");
    Check("time refuses minute 60", ParamsCode([] { p::ParseTime(json::parse(R"({"hours":1,"minutes":60})")); }) == "bad_params");
    Check("pause needs paused", ParamsCode([] { p::ParsePause(json::object()); }) == "bad_params");
    Check("hud hide defaults to hidden", p::ParseHudHidden(json::object()));
    Check("appearance check list is bounded",
          ParamsCode([] { p::ParseAppearance(json{{"check", json::array({json::object()})}}); }) == "bad_params");
    Check("no-parameter methods refuse parameters", ParamsCode([] { p::RequireOnly(json{{"x", 1}}, {}); }) == "bad_params");
    // RB-23: out-of-range numbers are refused before any integer conversion.
    Check("a huge whole float is refused, not converted",
          ParamsCode([] { p::ParseExpression(json::parse(R"({"faceId":1e300})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseExpression(json::parse(R"({"faceId":-1e300})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseTime(json::parse(R"({"total_seconds":1e19})")); }) == "bad_params");
    Check("an unsigned value past int64 doesn't wrap into range",
          ParamsCode([] { p::ParseExpression(json::parse(R"({"faceId":18446744073709551615})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseTime(json::parse(R"({"total_seconds":18446744073709551615})")); }) == "bad_params");
    Check("infinity is refused", ParamsCode([] { p::ParseExpression(json{{"faceId", std::numeric_limits<double>::infinity()}}); }) == "bad_params");
    Check("a whole float in range is accepted", p::ParseExpression(json::parse(R"({"faceId":60.0})")) == 60);
    Check("light select_after is 1 to 3",
          p::ParseLight(json::parse(R"({"light":2,"hue":1,"select_after":1})")).selectAfter == 1 &&
              ParamsCode([] { p::ParseLight(json::parse(R"({"light":2,"hue":1,"select_after":4})")); }) == "bad_params");
}

// The caller frame's parameter code for native -> script calls (plugin/ScriptCall.cpp), byte for
// byte as Cyber Engine Tweaks writes it (RTTIHelper::ExecuteFunction): ExternalVar, type, value
// per argument, Nop for an omitted optional, then ParamEnd.
void ScriptFrameTests()
{
    namespace s = xfb::script;
    int typeA = 0;
    int typeB = 0;
    int valueA = 1;
    float valueB = 2.0f;
    uint8_t code[s::kCodeCapacity]{};
    const std::vector<s::Arg> two{{&typeA, &valueA, false}, {&typeB, &valueB, false}};
    const auto size = s::BuildParamCode(two, code, sizeof(code));
    const auto pointerAt = [&](size_t aAt) {
        const void* p = nullptr;
        std::memcpy(&p, code + aAt, sizeof(p));
        return p;
    };
    Check("two arguments take 2 x 17 bytes plus ParamEnd", size == 35 && s::CodeSize(two) == 35, std::to_string(size));
    Check("each argument is ExternalVar (0x1B), then its type and value pointers",
          code[0] == 0x1B && pointerAt(1) == &typeA && pointerAt(9) == &valueA && code[17] == 0x1B &&
              pointerAt(18) == &typeB && pointerAt(26) == &valueB);
    Check("the code ends with ParamEnd (0x26)", code[34] == 0x26);

    const auto none = s::BuildParamCode({}, code, sizeof(code));
    Check("no arguments is just ParamEnd", none == 1 && code[0] == 0x26);

    const std::vector<s::Arg> omitted{{nullptr, nullptr, true}, {&typeA, &valueA, false}};
    const auto withNop = s::BuildParamCode(omitted, code, sizeof(code));
    Check("an omitted optional argument is a Nop", withNop == 19 && code[0] == 0x00 && code[1] == 0x1B && code[18] == 0x26);

    Check("an argument without a value is refused", s::BuildParamCode({{&typeA, nullptr, false}}, code, sizeof(code)) == 0);
    Check("an argument without a type is refused", s::BuildParamCode({{nullptr, &valueA, false}}, code, sizeof(code)) == 0);
    const std::vector<s::Arg> many(16, s::Arg{&typeA, &valueA, false});
    Check("15 arguments fit the 264-byte buffer, 16 do not",
          s::BuildParamCode(std::vector<s::Arg>(15, s::Arg{&typeA, &valueA, false}), code, sizeof(code)) == 256 &&
              s::BuildParamCode(many, code, sizeof(code)) == 0);
    Check("a short buffer is refused, never overrun", s::BuildParamCode(two, code, 34) == 0);

    // RB-32: every address the call path needs is checked at load; a 0 turns script calls off.
    const std::vector<s::Address> addresses{{"A", 1}, {"B", 2}, {"C", 3}};
    std::vector<uintptr_t> resolved;
    const auto allThere = s::MissingAddresses(addresses, [](uint32_t aHash) -> uintptr_t { return 0x1000 + aHash; }, resolved);
    Check("resolved addresses: none missing, each result kept in order",
          allThere.empty() && resolved == std::vector<uintptr_t>{0x1001, 0x1002, 0x1003});
    const auto oneMissing = s::MissingAddresses(addresses, [](uint32_t aHash) -> uintptr_t { return aHash == 2 ? 0 : 0x1000 + aHash; }, resolved);
    Check("an address that resolves to 0 is named", oneMissing == std::vector<std::string>{"B"} && resolved[1] == 0);
    Check("without a resolver every address is missing",
          s::MissingAddresses(addresses, nullptr, resolved).size() == 3);
}

// face.rig.read and photo.expression.index (the expression design's R1/R2 commands).
void FaceTests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    const auto rig = p::ParseFaceRig(json::object());
    Check("face.rig.read defaults to the head item and its known face components",
          rig.target == p::FaceTarget::Head && rig.components == p::DefaultFaceComponents() && !rig.components.empty());
    const auto named = p::ParseFaceRig(json::parse(R"({"target":"puppet","components":["face_rig","xfs_PhotomodeAnimations"]})"));
    Check("face.rig.read takes a target and component names",
          named.target == p::FaceTarget::Puppet && named.components.size() == 2 && named.components[1] == "xfs_PhotomodeAnimations");
    Check("component names are letters, digits and underscores only",
          ParamsCode([] { p::ParseFaceRig(json::parse(R"({"components":["face rig"]})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseFaceRig(json::parse(R"({"components":["a\\b"]})")); }) == "bad_params");
    Check("component lists are 1 to 16 names without repeats",
          ParamsCode([] { p::ParseFaceRig(json::parse(R"({"components":[]})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseFaceRig(json{{"components", json(std::vector<std::string>(17, "x"))}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseFaceRig(json::parse(R"({"components":["a","a"]})")); }) == "bad_params");
    Check("an unknown face target is refused", ParamsCode([] { p::ParseFaceRig(json::parse(R"({"target":"body"})")); }) == "bad_params");

    const auto index = p::ParseExpressionIndex(json::parse(R"({"index":60})"));
    Check("photo.expression.index defaults to the stand-in and listed indices",
          index.index == 60 && index.target == p::FaceTarget::Puppet && !index.unlisted);
    Check("photo.expression.index takes unlisted",
          p::ParseExpressionIndex(json::parse(R"({"index":56,"target":"puppet","unlisted":true})")).unlisted);
    Check("0.4.2: photo.expression.index refuses the head item in plain words (no face rig there, session 4)",
          ParamsCode([] { p::ParseExpressionIndex(json::parse(R"({"index":60,"target":"head"})")); }) == "no_effect");

    const auto clock = w::TimeResult(json{{"before_total_seconds", 7200}, {"after_total_seconds", 0}});
    Check("world.time.set outside photo mode undoes to the exact earlier time",
          clock["undo"] == json{{"method", "world.time.set"}, {"params", {{"total_seconds", 7200}}}}, clock.dump());
    const auto photoTime = w::TimeResult(json{{"route", "photo_time"}, {"before_minutes", 243.592}, {"before_known", true}, {"after_minutes", 120}});
    Check("0.4.2: world.time.set in photo mode undoes to photo mode's earlier time of day, to the minute",
          photoTime["undo"] == json{{"method", "world.time.set"}, {"params", {{"hours", 4}, {"minutes", 4}}}}, photoTime.dump());
    const auto photoUnknown = w::TimeResult(json{{"route", "photo_time"}, {"before_minutes", -1.0}, {"before_known", false}});
    Check("0.4.2: no undo when photo mode's earlier time of day is unknown, with a note",
          photoUnknown["undo"].is_null() && photoUnknown.contains("undo_note"), photoUnknown.dump());
    Check("photo.expression.index needs a whole index from 0 to 100000",
          ParamsCode([] { p::ParseExpressionIndex(json::object()); }) == "bad_params" &&
              ParamsCode([] { p::ParseExpressionIndex(json::parse(R"({"index":-1})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseExpressionIndex(json::parse(R"({"index":100001})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseExpressionIndex(json::parse(R"({"index":1.5})")); }) == "bad_params");

    const auto known = w::ExpressionIndexResult(json{{"index", 60}, {"menu_value", 1.0}, {"menu_value_known", true}});
    Check("the face index's undo selects the menu's expression again",
          known["undo"] == json{{"method", "photo.expression.set"}, {"params", {{"faceId", 1}}}}, known.dump());
    const auto unknown = w::ExpressionIndexResult(json{{"index", 60}, {"menu_value", -1.0}, {"menu_value_known", false}});
    Check("no undo when the menu's expression is unknown, and a note says what to do",
          unknown["undo"].is_null() && unknown.contains("undo_note"), unknown.dump());
}
// Batch 3: cc.open's parameters and sequence, cc.page, cc.apply by value, game.options.read's
// parameters and the render-option exchange with the CET layer.
void CreatorAndOptionsTests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;

    // cc.apply: index or value, not both.
    const auto byValue = p::ParseCharacterApply(json::parse(R"({"option":"piercings_color","value":"gold"})"));
    Check("cc.apply takes a value instead of an index (index -1)", byValue.index == -1 && byValue.value == "gold");
    Check("cc.apply keeps index requests as they were",
          p::ParseCharacterApply(json::parse(R"({"option":"XF","index":4})")).index == 4 &&
              p::ParseCharacterApply(json::parse(R"({"option":"XF","index":4})")).value.empty());
    Check("cc.apply refuses index with value, and neither",
          ParamsCode([] { p::ParseCharacterApply(json::parse(R"({"option":"XF","index":1,"value":"01"})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseCharacterApply(json::parse(R"({"option":"XF"})")); }) == "bad_params");

    // cc.open parameters.
    const auto open = p::ParseCreatorOpen(json::object());
    Check("cc.open defaults to the mirror's edit mode and a 5 s wait", open.mode == p::CreatorMode::Mirror && open.timeoutMs == 5000);
    Check("cc.open takes the ripperdoc mode (edit tag 2)",
          static_cast<int32_t>(p::ParseCreatorOpen(json::parse(R"({"mode":"ripperdoc"})")).mode) == 2 &&
              static_cast<int32_t>(p::CreatorMode::Mirror) == 1);
    Check("cc.open refuses the new-game mode and waits outside 0.5-15 s",
          ParamsCode([] { p::ParseCreatorOpen(json::parse(R"({"mode":"new_game"})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseCreatorOpen(json::parse(R"({"timeout_ms":100})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseCreatorOpen(json::parse(R"({"timeout_ms":20000})")); }) == "bad_params");
    Check("the creator gate's refusal names opening too",
          [] {
              try
              {
                  p::CreatorLeaveAllowed(false);
              }
              catch (const xfb::MethodError& e)
              {
                  return std::string(e.what()).find("opening") != std::string::npos;
              }
              return false;
          }());

    // cc.page.
    const auto page = p::ParseCreatorPage(json::parse(R"({"page":"eyes"})"));
    Check("cc.page maps eyes to the creator's UI_Eyes slot and default to the starting view",
          page.slot == "UI_Eyes" && p::ParseCreatorPage(json::parse(R"({"page":"default"})")).slot.empty());
    Check("cc.page refuses unknown pages and raw slot names",
          ParamsCode([] { p::ParseCreatorPage(json::parse(R"({"page":"UI_Eyes"})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseCreatorPage(json::object()); }) == "bad_params");

    // cc.open's sequence.
    {
        std::vector<std::string> calls;
        int polls = 0;
        bool cancelled = false;
        w::CreatorOpenOps ops;
        ops.prepare = [&] {
            calls.push_back("prepare");
            return json{{"save_lock_requested", true}};
        };
        ops.settle = [&] { calls.push_back("settle"); };
        ops.open = [&] {
            calls.push_back("open");
            return json{{"requested", true}, {"edit_mode", "HairDresser"}, {"saving_locked", true}, {"route", "pause_menu"}};
        };
        ops.phase = [&] { return ++polls >= 3 ? std::string("character_menu") : std::string("gameplay"); };
        ops.cancel = [&] {
            cancelled = true;
            return json{{"withdrawn", true}, {"taken", false}};
        };
        ops.sleep = [](std::chrono::milliseconds) {};
        const auto out = w::CreatorOpen(p::ParseCreatorOpen(json::object()), ops);
        Check("cc.open prepares, settles, then asks, and waits for the appearance screen",
              calls == std::vector<std::string>{"prepare", "settle", "open"} && out["opened"] == true && out["changed"] == true &&
                  out["edit_mode"] == "HairDresser" && out["waited_ms"] == 200 && !cancelled,
              out.dump());
        Check("cc.open's undo is cc.back", out["undo"] == json{{"method", "cc.back"}, {"params", json::object()}}, out.dump());

        polls = 0;
        calls.clear();
        ops.phase = [&] {
            ++polls;
            return std::string("gameplay");
        };
        const auto timedOut = ParamsCode([&] { w::CreatorOpen(p::ParseCreatorOpen(json::parse(R"({"timeout_ms":500})")), ops); });
        Check("cc.open that never sees the screen withdraws the request and says so",
              timedOut == "creator_open_timeout" && cancelled && polls == 6, timedOut + " polls=" + std::to_string(polls));

        calls.clear();
        ops.prepare = [&] {
            calls.push_back("prepare");
            return json{{"already_open", true}};
        };
        const auto already = w::CreatorOpen(p::ParseCreatorOpen(json::object()), ops);
        Check("cc.open with the screen already open changes nothing and has no undo",
              already["changed"] == false && already["undo"].is_null() && calls == std::vector<std::string>{"prepare"}, already.dump());

        calls.clear();
        ops.prepare = [&]() -> json { throw xfb::MethodError("not_safe_now", "V is in combat"); };
        Check("a refused moment stops cc.open before the save lock settles or anything is asked",
              ParamsCode([&] { w::CreatorOpen(p::ParseCreatorOpen(json::object()), ops); }) == "not_safe_now" && calls.empty());
    }

    // game.options.read parameters.
    const auto options = p::ParseGameOptions(json::object());
    Check("game.options.read reads every settings group and the default render options",
          options.settings && options.renderOptions && options.groups == p::SettingsGroups() &&
              options.names == p::DefaultRenderOptions() && options.names.size() > 40 &&
              options.names.front() == "Editor/Characters/Hair/GlobalLight/R");
    Check("game.options.read takes a subset of the allowlisted settings groups",
          p::ParseGameOptions(json::parse(R"({"groups":["/graphics/raytracing"],"render_options":false})")).groups ==
              std::vector<std::string>{"/graphics/raytracing"} &&
              ParamsCode([] { p::ParseGameOptions(json::parse(R"({"groups":["/gameplay/hud"]})")); }) == "bad_params");
    Check("render option names are Category/Name with letters, digits and _ only",
          p::ParseGameOptions(json::parse(R"({"names":["Editor/Characters/Eyes/DiffuseBoost"]})")).names.size() == 1 &&
              ParamsCode([] { p::ParseGameOptions(json::parse(R"({"names":["NoCategory"]})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseGameOptions(json::parse(R"({"names":["A/B;rm"]})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseGameOptions(json::parse(R"({"names":["/A/B"]})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseGameOptions(json::parse(R"({"names":["A/B","A/B"]})")); }) == "bad_params");
    Check("game.options.read refuses reading nothing",
          ParamsCode([] { p::ParseGameOptions(json::parse(R"({"settings":false,"render_options":false})")); }) == "bad_params");

    // The render-option exchange with the CET layer.
    {
        xfb::OptionsExchange exchange;
        Check("nothing is pending before a request", exchange.Pending().empty());
        const auto seq = exchange.Request({"A/B", "C/D"});
        const auto pending = json::parse(exchange.Pending());
        Check("a request is pending with its seq and names", pending["seq"] == seq && pending["names"].size() == 2, pending.dump());
        std::string why;
        Check("an answer for another seq is refused and leaves the request pending",
              !exchange.Report(json{{"seq", seq + 1}, {"values", json::object()}}.dump(), &why) && !why.empty() &&
                  !exchange.Pending().empty(),
              why);
        Check("an answer naming an option that wasn't asked for is refused (and ends the request)",
              !exchange.Report(json{{"seq", seq}, {"values", {{"X/Y", "1"}}}}.dump()) && exchange.Pending().empty());
        const auto nonText = exchange.Request({"A/B", "C/D"});
        Check("an answer with a non-text value is refused",
              !exchange.Report(json{{"seq", nonText}, {"values", {{"A/B", 1}}}}.dump()));
        exchange.Request({"A/B", "C/D"});
        Check("an answer that isn't JSON is refused", !exchange.Report("{"));
        exchange.Request({"A/B", "C/D"});
        Check("an answer that is too large is refused", !exchange.Report(std::string(xfb::OptionsExchange::kMaxReportBytes + 1, ' ')));
        const auto answered = exchange.Request({"A/B", "C/D"});
        std::thread cet([&] {
            std::this_thread::sleep_for(20ms);
            exchange.Report(json{{"seq", answered}, {"values", {{"A/B", "0.300000"}}}}.dump());
        });
        const auto answer = exchange.WaitFor(answered, 2000ms);
        cet.join();
        Check("the waiter gets the CET layer's answer, and nothing is pending after it",
              answer && (*answer)["A/B"] == "0.300000" && !answer->contains("C/D") && exchange.Pending().empty());

        const auto empty = exchange.Request({"A/B"});
        Check("an empty Lua table (an empty list) counts as no values",
              exchange.Report(json{{"seq", empty}, {"values", json::array()}}.dump()) && exchange.WaitFor(empty, 10ms)->empty());

        const auto unanswered = exchange.Request({"A/B"});
        const auto start = std::chrono::steady_clock::now();
        Check("an unanswered request times out", !exchange.WaitFor(unanswered, 50ms) && MsSince(start) >= 45);
        exchange.Withdraw(unanswered);
        Check("a withdrawn request is no longer pending, and a late answer is refused",
              exchange.Pending().empty() && !exchange.Report(json{{"seq", unanswered}, {"values", json::object()}}.dump()));

        const auto last = exchange.Request({"A/B"});
        std::thread killer([&] {
            std::this_thread::sleep_for(20ms);
            exchange.Cancel();
        });
        const auto killedAt = std::chrono::steady_clock::now();
        const auto afterKill = exchange.WaitFor(last, 2000ms);
        killer.join();
        Check("the kill switch releases a waiter at once and refuses later requests",
              !afterKill && MsSince(killedAt) < 1000 && exchange.Pending().empty() &&
                  (exchange.Request({"A/B"}), exchange.Pending().empty()));
    }
}
// Batch 4: cc.open's fixes (RB-42, RB-43, RB-46), the options answer (RB-47), the write pause and re-arm
// pieces, photo.pose.set's sequence, and the live-pose layout checks, encoding and plan.
void Batch4Tests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    namespace lp = xfb::livepose;

    // cc.open.
    {
        std::vector<std::string> calls;
        json cancelAnswer{{"withdrawn", true}};
        bool cancelThrows = false;
        int cancels = 0;
        std::function<std::string()> phase = [] { return std::string("gameplay"); };
        w::CreatorOpenOps ops;
        ops.prepare = [&] {
            calls.push_back("prepare");
            return json{{"save_lock_requested", true}};
        };
        ops.settle = [&] { calls.push_back("settle"); };
        ops.open = [&] {
            calls.push_back("open");
            return json{{"requested", true}, {"edit_mode", "HairDresser"}, {"saving_locked", true}, {"route", "pause_menu"}};
        };
        ops.phase = [&] { return phase(); };
        ops.cancel = [&]() -> json {
            ++cancels;
            if (cancelThrows)
            {
                throw xfb::MethodError("timeout", "the game thread didn't answer");
            }
            return cancelAnswer;
        };
        ops.sleep = [](std::chrono::milliseconds) {};
        const auto run = [&](const char* aParams, std::string* aMessage = nullptr) {
            try
            {
                const auto out = w::CreatorOpen(p::ParseCreatorOpen(json::parse(aParams)), ops);
                return std::string(out.value("note", std::string()).empty() ? "opened" : "opened_late");
            }
            catch (const xfb::MethodError& e)
            {
                if (aMessage)
                {
                    *aMessage = e.what();
                }
                return e.code;
            }
        };

        // RB-42: the menu had taken the request, and the screen opens during the extra wait.
        int polls = 0;
        cancelAnswer = {{"withdrawn", false}, {"taken", true}};
        phase = [&] { return ++polls > 8 ? std::string("character_menu") : std::string("gameplay"); };
        Check("RB-42: a timed-out cc.open whose request the menu took waits a little longer and reports the late screen as opened",
              run(R"({"timeout_ms":500})") == "opened_late" && cancels == 1);

        // RB-42: taken, but the screen never shows: not "nothing opened".
        cancels = 0;
        std::string message;
        phase = [] { return std::string("gameplay"); };
        const auto uncertain = run(R"({"timeout_ms":500})", &message);
        Check("RB-42: taken but never seen answers creator_open_uncertain, pointing at game.status and cc.back",
              uncertain == "creator_open_uncertain" && message.find("cc.back") != std::string::npos &&
                  message.find("saving stays locked") != std::string::npos,
              uncertain + ": " + message);

        // A withdrawal the game can't confirm is uncertain too.
        cancelThrows = true;
        const auto unconfirmed = run(R"({"timeout_ms":500})", &message);
        Check("RB-42: a withdrawal that fails is reported as uncertain, never as nothing opened",
              unconfirmed == "creator_open_uncertain" && message.find("couldn't confirm") != std::string::npos, message);
        cancelThrows = false;

        // Still waiting: withdrawn, nothing opened.
        cancelAnswer = {{"withdrawn", true}, {"taken", false}};
        const auto timedOut = run(R"({"timeout_ms":500})", &message);
        Check("a request still waiting is withdrawn: creator_open_timeout, nothing opened, saving stays locked",
              timedOut == "creator_open_timeout" && message.find("nothing opened") != std::string::npos &&
                  message.find("saving stays locked") != std::string::npos,
              message);

        // RB-43: a phase poll that throws still withdraws the request.
        cancels = 0;
        phase = []() -> std::string { throw xfb::MethodError("timeout", "the game thread didn't answer"); };
        const auto pollThrew = run("{}", &message);
        Check("RB-43: a failing poll withdraws the request before the error goes back",
              pollThrew == "timeout" && cancels == 1 && message.find("withdrawn") != std::string::npos, message);

        // RB-43, RB-46: stage 2 refuses (or fails): withdrawn, and the answer says saving stays locked.
        cancels = 0;
        phase = [] { return std::string("gameplay"); };
        ops.open = [&]() -> json { throw xfb::MethodError("save_lock_not_held", "the game hasn't registered the bridge's save lock yet"); };
        const auto stage2 = run("{}", &message);
        Check("RB-46: a stage-2 refusal keeps its code and says that saving stays locked until a save is loaded",
              stage2 == "save_lock_not_held" && cancels == 1 && message.find("saving stays locked until a save is loaded") != std::string::npos,
              message);
        ops.open = [&]() -> json { throw xfb::MethodError("timeout_after_start", "the game started the request but didn't finish"); };
        cancelAnswer = {{"withdrawn", false}, {"taken", true}};
        const auto openFailed = run("{}", &message);
        Check("RB-43: an open call that fails part-way is withdrawn, and a request the menu took is reported as possibly opening",
              openFailed == "timeout_after_start" && message.find("may still open") != std::string::npos, message);

        // RB-45's refusal comes from the first step, before anything settles or is asked.
        calls.clear();
        ops.prepare = [&]() -> json { throw xfb::MethodError("not_v", "the player is Johnny right now, not V"); };
        Check("RB-45: not V (a Johnny section) stops cc.open in its first step", run("{}") == "not_v" && calls.empty());
    }

    // photo.pose.set's sequence.
    {
        std::vector<std::string> calls;
        w::PoseSetOps ops;
        json category{{"before_known", true}, {"before_category", 0}, {"before_pose", 3}, {"changed", true},
                      {"category_value", 900}, {"category_text", "XF Live"}};
        ops.category = [&] {
            calls.push_back("category");
            return category;
        };
        ops.settle = [&] { calls.push_back("settle"); };
        ops.pose = [&] {
            calls.push_back("pose");
            return json{{"changed", true}, {"pose_value", 7}, {"pose_text", "XF Live Carrier"}};
        };
        int restored = -1;
        ops.restoreCategory = [&](int32_t aValue) { restored = aValue; };
        const auto out = w::PoseSet(ops);
        Check("photo.pose.set selects the category, waits for the new list, then the pose",
              calls == std::vector<std::string>{"category", "settle", "pose"} && out["pose"] == "XF Live Carrier" && out["changed"] == true,
              out.dump());
        Check("its undo selects the earlier category and pose by option data",
              out["undo"]["method"] == "photo.pose.set" && out["undo"]["params"]["category_value"] == 0 &&
                  out["undo"]["params"]["pose_value"] == 3,
              out.dump());

        calls.clear();
        ops.pose = [&]() -> json { throw xfb::MethodError("bad_params", "no pose labelled 'X' in the current category"); };
        std::string message;
        try
        {
            w::PoseSet(ops);
        }
        catch (const xfb::MethodError& e)
        {
            message = e.what();
        }
        Check("a pose that isn't there puts the category back and says so",
              restored == 0 && message.find("the pose category was put back") != std::string::npos, message);

        calls.clear();
        category["changed"] = false;
        ops.pose = [&] {
            calls.push_back("pose");
            return json{{"changed", false}, {"pose_value", 3}, {"pose_text", "Stand 01"}};
        };
        const auto same = w::PoseSet(ops);
        Check("the pose already selected changes nothing, needs no wait and has no undo",
              calls == std::vector<std::string>{"category", "pose"} && same["undo"].is_null(), same.dump());

        Check("photo.pose.set takes one of record, pose (with category) or the option data",
              p::ParsePoseSet(json::parse(R"({"record":"xfs_live_carrier"})")).record == "PhotoModePoses.xfs_live_carrier" &&
                  p::ParsePoseSet(json::parse(R"({"pose":"Stand 01","category":"Idle"})")).category == "Idle" &&
                  p::ParsePoseSet(json::parse(R"({"category_value":0,"pose_value":3})")).poseValue == 3 &&
                  ParamsCode([] { p::ParsePoseSet(json::parse(R"({"record":"a","pose":"b"})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseSet(json::parse(R"({"category":"Idle"})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseSet(json::parse(R"({"pose_value":3})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseSet(json::parse(R"({"record":"a;b"})")); }) == "bad_params");
    }

    // RB-47: the options answer.
    {
        xfb::OptionsExchange exchange;
        const auto seq = exchange.Request({"A/B", "C/D", "E/F"});
        std::thread cet([&] {
            std::this_thread::sleep_for(10ms);
            exchange.Report(json{{"seq", seq}, {"values", {{"A/B", std::string(300, 'x')}, {"C/D", "1"}}}, {"skipped", {"E/F"}}}.dump());
        });
        xfb::OptionsOutcome outcome;
        const auto values = exchange.WaitFor(seq, 2000ms, &outcome);
        cet.join();
        Check("RB-47: an overlong value is kept as null and named, and the rest of the answer arrives",
              values && (*values)["A/B"].is_null() && (*values)["C/D"] == "1" && outcome.tooLong == std::vector<std::string>{"A/B"} &&
                  outcome.skipped == std::vector<std::string>{"E/F"},
              values ? values->dump() : "no answer");
        const auto result = xfb::RenderOptionsResult({"A/B", "C/D", "E/F"}, values, outcome, 3000);
        Check("RB-47: the result lists too_long and skipped, and counts them as missing",
              result["available"] == true && result["too_long"] == json::array({"A/B"}) && result["skipped"] == json::array({"E/F"}) &&
                  result["missing"].size() == 2,
              result.dump());

        const auto big = exchange.Request({"A/B"});
        const auto start = std::chrono::steady_clock::now();
        std::thread flood([&] {
            std::this_thread::sleep_for(10ms);
            exchange.Report(std::string(xfb::OptionsExchange::kMaxReportBytes + 10, ' '));
        });
        const auto none = exchange.WaitFor(big, 3000ms, &outcome);
        flood.join();
        const auto refused = xfb::RenderOptionsResult({"A/B"}, none, outcome, 3000);
        Check("RB-47: an answer too large to read ends the request at once with the real reason, not a 3 s timeout",
              !none && MsSince(start) < 1000 && outcome.refusal.find("too large") != std::string::npos &&
                  refused["reason"].get<std::string>().find("too large") != std::string::npos,
              refused.dump());

        const auto wrong = exchange.Request({"A/B"});
        std::string why;
        exchange.Report(json{{"seq", wrong}, {"values", {{"A/B", 1}}}}.dump(), &why);
        const auto afterWrong = exchange.WaitFor(wrong, 10ms, &outcome);
        Check("RB-47: a value that isn't text ends the request with that reason",
              !afterWrong && outcome.refusal.find("wasn't text") != std::string::npos, outcome.refusal);

        exchange.Cancel();
        Check("after the kill switch nothing is requested", (exchange.Request({"A/B"}), exchange.Pending().empty()));
        exchange.Reset();
        Check("re-arming accepts requests again", (exchange.Request({"A/B"}), !exchange.Pending().empty()));
    }

    // The write pause and re-arm pieces.
    {
        xfb::Config config;
        config.allowWrites = true;
        config.maxRequestsPerSecond = 200;
        xfb::Session session;
        std::string error;
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-pause-not-created");
        xfb::GameThreadQueue queue;
        xfb::Dispatcher dispatcher(config, session, queue);
        dispatcher.Register({"t.write", xfb::Access::WritePhoto, xfb::RunOn::BridgeThread, "unit",
                             [](const xfb::MethodContext&) { return json{{"ok", true}}; }});
        dispatcher.Register({"t.read", xfb::Access::Read, xfb::RunOn::BridgeThread, "unit",
                             [](const xfb::MethodContext&) { return json{{"ok", true}}; }});
        const auto call = [&](const char* aMethod) {
            const auto line = json{{"v", 1}, {"id", 1}, {"token", session.token}, {"method", aMethod}}.dump();
            const auto reply = json::parse(dispatcher.Handle(line, 0).line);
            return reply.value("ok", false) ? std::string("ok") : reply["error"].value("code", std::string());
        };
        dispatcher.SetWritesPaused(true);
        Check("paused writes are refused with writes_paused; reads still work",
              call("t.write") == "writes_paused" && call("t.read") == "ok" && dispatcher.Describe()["writes_paused"] == true);
        dispatcher.SetWritesPaused(false);
        Check("resuming gives back what config.ini allows", call("t.write") == "ok");
        config.allowWrites = false;
        dispatcher.SetWritesPaused(false);
        Check("resuming can't allow writes that config.ini doesn't", call("t.write") == "writes_disabled");
        config.allowWrites = true;

        dispatcher.Kill("unit");
        Check("killed: everything is refused", call("t.read") == "killed");
        dispatcher.Revive();
        Check("revived: requests are accepted again", call("t.read") == "ok" && !dispatcher.IsKilled());

        queue.SetPumping(true);
        queue.Close();
        json result;
        std::string qerror;
        Check("a closed queue refuses tasks", queue.Run([] { return json(1); }, 10ms, result, qerror) == xfb::QueueResult::NotPumping);
        queue.Reopen(true);
        std::atomic<bool> ran{false};
        std::thread game([&] {
            for (int i = 0; i < 50 && !ran.load(); ++i)
            {
                queue.Drain(4);
                std::this_thread::sleep_for(2ms);
            }
        });
        const auto reopened = queue.Run(
            [&] {
                ran = true;
                return json(2);
            },
            1000ms, result, qerror);
        game.join();
        Check("a reopened queue runs tasks again", reopened == xfb::QueueResult::Done && result == 2 && queue.IsPumping());

        xfb::writes::RestoreOnce restore;
        restore.MarkWrite();
        Check("the restore can't be reset while it is owed", restore.Pending() && !restore.Reset());
        restore.Tick(true, [] {});
        Check("after the restore ran, a reset forgets the last generation's writes",
              !restore.Pending() && restore.Reset() && !restore.WritesUsed() && !restore.Done());

        xfb::Bridge bridge(config, session, queue);
        Check("a bridge that wasn't killed refuses to re-arm", !bridge.RearmRefusal().empty());
    }

    // The live-pose layout checks, encoding and plan.
    {
        // Rotation round trip, including a negative w.
        const std::array<float, 4> q{0.2f, -0.3f, 0.1f, -0.927f};
        float x = 0, y = 0, z = 0;
        bool wSign = false;
        lp::EncodeRotation(q, x, y, z, wSign);
        const auto back = lp::DecodeRotation(x, y, z, wSign);
        const double length = std::sqrt(0.2 * 0.2 + 0.3 * 0.3 + 0.1 * 0.1 + 0.927 * 0.927);
        bool close = true;
        for (int i = 0; i < 4; ++i)
        {
            close = close && std::fabs(back[i] - q[i] / length) < 1e-5;
        }
        Check("the rotation encoding round-trips a unit quaternion (w's sign in bit 15)", close && wSign);
        Check("the header packs joint, channel and w sign like WolvenKit's reader",
              lp::Header(40, lp::Rotation, true) == (40 | 0x2000 | 0x8000) && lp::JointOf(0xA028) == 40 && lp::ChannelOf(0xA028) == 1 &&
                  lp::WSignOf(0xA028));

        // A carrier: 3 joints, one rotation and one translation each, then 2 constant track keys.
        std::vector<lp::RawConstKey> keys;
        for (uint16_t joint = 0; joint < 3; ++joint)
        {
            lp::RawConstKey rotation{};
            lp::EncodeRotation({0, 0, 0, 1}, rotation.x, rotation.y, rotation.z, wSign);
            rotation.header = lp::Header(joint, lp::Rotation, wSign);
            keys.push_back(rotation);
            keys.push_back({lp::Header(joint, lp::Translation, false), 0, 0.0f, 0.1f, 0.0f});
        }
        lp::BufferCounts counts;
        counts.numFrames = 2;
        counts.numJoints = 3;
        counts.numConstAnimKeys = 6;
        counts.numConstTrackKeys = 2;
        counts.dataBytes = 6 * 16 + 2 * 8;
        std::vector<uint8_t> block(counts.dataBytes);
        const auto base = reinterpret_cast<uintptr_t>(block.data());
        lp::BufferSpans spans;
        spans.constKeys = {base, base + 96};
        spans.constTracks = {base + 96, base + 112};
        Check("a key block that matches its counts passes", lp::CheckSpans(counts, spans).empty() &&
                                                                lp::CheckConstKeys(counts, keys).empty() &&
                                                                lp::CheckCarrier(counts, keys).empty());
        auto gap = spans;
        gap.constTracks = {base + 100, base + 116};
        auto shortSpan = spans;
        shortSpan.constKeys = {base, base + 80};
        auto wrongTotal = counts;
        wrongTotal.dataBytes = 200;
        auto missingSpan = spans;
        missingSpan.constKeys = {};
        Check("a gap between runs, a span of the wrong size, a total that disagrees or a missing span is refused",
              !lp::CheckSpans(counts, gap).empty() && !lp::CheckSpans(counts, shortSpan).empty() &&
                  !lp::CheckSpans(wrongTotal, spans).empty() && !lp::CheckSpans(counts, missingSpan).empty());
        auto badKeys = keys;
        badKeys[2].header = lp::Header(7, lp::Rotation, false); // joint 7 of 3
        auto twice = keys;
        twice[2].header = keys[0].header;
        auto outside = keys;
        outside[0].x = 2.0f;
        Check("keys naming a joint past the rig, a joint twice or a rotation outside the unit ball are refused",
              !lp::CheckConstKeys(counts, badKeys).empty() && !lp::CheckConstKeys(counts, twice).empty() &&
                  !lp::CheckConstKeys(counts, outside).empty());
        auto noRotation = keys;
        noRotation.erase(noRotation.begin() + 2); // joint 1's rotation
        auto animated = counts;
        animated.numAnimKeysRaw = 4;
        Check("the carrier contract wants one constant rotation key per joint and no animated keys",
              !lp::CheckCarrier(counts, noRotation).empty() && !lp::CheckCarrier(animated, keys).empty());

        // The same keys hashed by the carrier build (tools/live-pose/carrier.ts keysHash): the offline and live
        // hashes must agree byte for byte (tools/test/carrier.test.ts checks the same literal).
        Check("the keys hash matches the carrier build's for the same keys", lp::KeysHash(keys) == "b1a8348859a0a5c3", lp::KeysHash(keys));
        auto retimed = keys;
        retimed[0].time = 12345;
        Check("the keys hash ignores the time field and changes with a value",
              lp::KeysHash(keys) == lp::KeysHash(retimed) && lp::KeysHash(keys) != lp::KeysHash(outside) && lp::KeysHash(keys).size() == 16);
        const auto described = lp::DescribeKeys(keys, {"Root", "Trajectory", "Hips"});
        Check("decoded keys name the joint and give rotations as [x, y, z, w]",
              described[0]["name"] == "Root" && described[0]["rotation"].size() == 4 && described[1]["translation"].size() == 3,
              described[0].dump());

        const auto writes = lp::PlanApply(keys, {{1, {0.0f, 0.0f, 0.7071068f, 0.7071068f}}}, std::array<float, 3>{0.0f, 0.0f, 1.0f}, 2);
        const auto decoded = writes.empty() ? std::array<float, 4>{} : lp::DecodeRotation(writes[0].value.x, writes[0].value.y, writes[0].value.z,
                                                                                            lp::WSignOf(writes[0].value.header));
        Check("the plan writes the joint's rotation key and the Hips translation key, nothing else",
              writes.size() == 2 && writes[0].keyIndex == 2 && std::fabs(decoded[2] - 0.7071068f) < 1e-5 && writes[1].keyIndex == 5 &&
                  writes[1].value.z == 1.0f && lp::JointOf(writes[1].value.header) == 2);
        Check("a joint given twice or without a constant rotation key is refused",
              ParamsCode([&] { lp::PlanApply(keys, {{1, {0, 0, 0, 1}}, {1, {0, 0, 0, 1}}}, std::nullopt, 2); }) == "bad_params" &&
                  ParamsCode([&] { lp::PlanApply(noRotation, {{1, {0, 0, 0, 1}}}, std::nullopt, 2); }) == "bad_params");

        const auto apply = p::ParsePoseLiveApply(json::parse(R"({"joints":{"RightForeArm":[0,0,0.7071068,0.7071068]},"hips":[0,0,1]})"));
        Check("pose.live.apply takes joint rotations and the Hips translation", apply.joints.size() == 1 && apply.hips.has_value());
        Check("pose.live.apply refuses a rotation that isn't a unit quaternion, odd joint names, nothing, or restore with values",
              ParamsCode([] { p::ParsePoseLiveApply(json::parse(R"({"joints":{"A":[0,0,0,2]}})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseLiveApply(json::parse(R"({"joints":{"A;B":[0,0,0,1]}})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseLiveApply(json::object()); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseLiveApply(json::parse(R"({"restore":true,"hips":[0,0,0]})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseLiveApply(json::parse(R"({"hips":[0,0,9]})")); }) == "bad_params");
        Check("pose.live.apply is off unless allow_live_pose", ParamsCode([] { p::LivePoseAllowed(false); }) == "live_pose_disabled" &&
                                                                    ParamsCode([] { p::LivePoseAllowed(true); }) == "ok");
        const auto read = p::ParsePoseLiveRead(json::object());
        Check("pose.live.read defaults to the XF carrier and checks paths",
              read.set == lp::kCarrierSet && read.clip == lp::kCarrierClip &&
                  ParamsCode([] { p::ParsePoseLiveRead(json::parse(R"({"set":"a\\..\\b.anims"})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseLiveRead(json::parse(R"({"set":"a\\b.mesh"})")); }) == "bad_params" &&
                  ParamsCode([] { p::ParsePoseLiveRead(json::parse(R"({"expect_hash":"XYZ"})")); }) == "bad_params");
        Check("allow_live_pose is read from config.ini and off by default",
              !xfb::ParseConfig("").allowLivePose && xfb::ParseConfig("[bridge]\nallow_live_pose = true\n").allowLivePose);
    }
}
} // namespace

// Bridge 0.4: the message line, the new write classes, the light's type and placement, and the inventory,
// save and load sequences.
void MessageTests()
{
    bool cut = false;
    Check("message text: control characters become single spaces, the ends are trimmed",
          xfb::CleanMessageText("  Open\tthe\n\ncreator  ", 200) == "Open the creator");
    const auto longText = xfb::CleanMessageText(std::string(10, 'a') + "\xC3\xA9\xC3\xA9", 11, &cut);
    Check("message text is cut at a character boundary, never inside a UTF-8 sequence", longText == std::string(10, 'a') + "\xC3\xA9" && cut, longText);
    Check("invalid UTF-8 becomes U+FFFD", xfb::CleanMessageText("a\xFF" "b", 20) == "a\xEF\xBF\xBD" "b");
    Check("an overlong encoding is invalid too", xfb::CleanMessageText("\xC0\xAF", 20) == "\xEF\xBF\xBD\xEF\xBF\xBD");

    xfb::MessageBoard board;
    const auto t0 = xfb::MessageBoard::Clock::now();
    Check("an empty board draws nothing", board.Snapshot(t0).empty());
    json last;
    for (int i = 0; i < 6; ++i)
    {
        last = board.Post({"message " + std::to_string(i), 5, "info", false}, t0);
    }
    const auto shown = json::parse(board.Snapshot(t0));
    Check("at most four messages show; a new one pushes out the oldest",
          shown["messages"].size() == 4 && shown["messages"][0]["text"] == "message 2" && last["dropped"].size() == 1, shown.dump());
    Check("messages expire by themselves", board.Snapshot(t0 + std::chrono::seconds(6)).empty());
    board.Post({"ask the player", 60, "ask", false}, t0);
    Check("clear removes every message", board.Clear() == 1 && board.Active(t0) == 0);
    const auto cleared = board.Post({"", 8, "info", true}, t0);
    Check("a clear without text only clears", cleared.value("cleared", -1) == 0 && !cleared.contains("id"), cleared.dump());
    const auto capped = board.Post({"x", 99999, "info", false}, t0);
    Check("seconds are capped", capped["seconds"] == xfb::MessageBoard::kMaxSeconds);

    namespace p = xfb::params;
    Check("ui.message needs text or clear", ParamsCode([] { p::ParseMessage(json::object()); }) == "bad_params");
    Check("ui.message refuses a text of only spaces", ParamsCode([] { p::ParseMessage(json{{"text", " \n\t "}}); }) == "bad_params");
    Check("ui.message refuses an unknown level", ParamsCode([] { p::ParseMessage(json{{"text", "hi"}, {"level", "shout"}}); }) == "bad_params");
    const auto ask = p::ParseMessage(json{{"text", "Press Confirm"}, {"level", "ask"}, {"seconds", 30}});
    Check("ui.message takes text, level and seconds", ask.text == "Press Confirm" && ask.level == "ask" && ask.seconds == 30);
}

void Batch5ClassTests()
{
    const auto defaults = xfb::ParseConfig("");
    Check("inventory and save are off unless listed", (defaults.writeClasses & (xfb::kWriteInventory | xfb::kWriteSave)) == 0u);
    const auto listed = xfb::ParseConfig("[bridge]\nallow_write_classes = photo, save, Inventory\n");
    Check("inventory and save can be listed", listed.writeClasses == (xfb::kWritePhoto | xfb::kWriteSave | xfb::kWriteInventory) &&
                                                  xfb::WriteClassList(listed) == std::vector<std::string>{"photo", "inventory", "save"});
    Check("access names for the new classes", xfb::AccessName(xfb::Access::WriteInventory) == "write-inventory" &&
                                                 xfb::AccessName(xfb::Access::WriteSave) == "write-save" && xfb::AccessName(xfb::Access::Notify) == "notify" &&
                                                 !xfb::IsWrite(xfb::Access::Notify) && xfb::IsWrite(xfb::Access::WriteSave));

    xfb::Config config;
    config.allowWrites = true;
    config.writeClasses = xfb::kWritePhoto | xfb::kWriteWorld | xfb::kWriteCharacter;
    config.maxRequestsPerSecond = 200;
    xfb::Session session;
    std::string error;
    wchar_t temp[MAX_PATH]{};
    GetTempPathW(MAX_PATH, temp);
    xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-classes5-not-created");
    xfb::GameThreadQueue queue;
    xfb::Dispatcher dispatcher(config, session, queue);
    for (const auto& [name, access] : std::vector<std::pair<std::string, xfb::Access>>{
             {"t.inventory", xfb::Access::WriteInventory}, {"t.save", xfb::Access::WriteSave}, {"t.notify", xfb::Access::Notify}})
    {
        dispatcher.Register({name, access, xfb::RunOn::BridgeThread, "unit", [](const xfb::MethodContext&) { return json{{"ok", true}}; }});
    }
    const auto call = [&](const char* aMethod) {
        const auto line = json{{"v", 1}, {"id", 1}, {"token", session.token}, {"method", aMethod}}.dump();
        const auto reply = json::parse(dispatcher.Handle(line, 0).line);
        return reply.value("ok", false) ? std::string("ok") : reply["error"].value("code", std::string());
    };
    Check("the inventory and save classes are refused unless listed",
          call("t.inventory") == "write_class_disabled" && call("t.save") == "write_class_disabled" && call("t.notify") == "ok");
    config.allowWrites = false;
    dispatcher.SetWritesPaused(true);
    Check("a message is shown even with writes off or paused (it changes nothing in the game)", call("t.notify") == "ok");
}

void LightPlacementTests()
{
    namespace p = xfb::params;
    struct Fake : FakePhoto
    {
        std::map<int32_t, std::array<double, 3>> at;
        bool drift = false;
        xfb::writes::LightOps Ops()
        {
            auto ops = FakePhoto::Ops();
            const auto base = ops.set;
            ops.set = [this, base](int32_t aKey, float aValue) {
                if (aKey == p::key::kLightType)
                {
                    calls.push_back("45");
                    throw xfb::MethodError("unavailable", "photo-mode setting 45 is not in the menu right now");
                }
                return base(aKey, aValue);
            };
            ops.place = [this](int32_t aLight, const p::LightPlacement& aPlace) {
                calls.push_back("place " + std::to_string(aLight));
                const auto before = at[aLight];
                at[aLight] = aPlace.kind == p::LightPlacement::Kind::World ? std::array<double, 3>{aPlace.world[0], aPlace.world[1], aPlace.world[2]}
                                                                           : std::array<double, 3>{1.0, 2.0, 3.0};
                const auto vec = [](const std::array<double, 3>& v) { return json{{"x", v[0]}, {"y", v[1]}, {"z", v[2]}}; };
                return json{{"before", vec(before)}, {"after", vec(at[aLight])}};
            };
            ops.position = [this](int32_t aLight) {
                auto v = at[aLight];
                if (drift)
                {
                    v[0] += 1.0;
                }
                return json{{"position", {{"x", v[0]}, {"y", v[1]}, {"z", v[2]}}}};
            };
            return ops;
        }
    };
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        const auto out = xfb::writes::LightSet(p::ParseLight(json::parse(R"({"light":1,"on":true,"type":"spot","brightness":60})")), fake.Ops());
        Check("a missing light type row is skipped with a note, not a failure",
              out["applied"].size() == 2 && out["skipped"][0]["name"] == "type" && out.contains("note") && !out["undo"]["params"].contains("type"),
              out.dump());
    }
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        fake.at[1] = {9.0, 9.0, 9.0};
        const auto out =
            xfb::writes::LightSet(p::ParseLight(json::parse(R"({"light":1,"place":{"azimuth":30,"elevation":20,"distance":1.5}})")), fake.Ops());
        Check("place moves the light, reads it back and says it held",
              out["placement"]["route"] == "moved" && out["placement"]["held"] == true &&
                  std::find(fake.calls.begin(), fake.calls.end(), "place 1") != fake.calls.end(),
              out.dump());
        Check("its undo puts the light back where it was",
              out["undo"]["params"]["place"] == json{{"world", {9.0, 9.0, 9.0}}} && out["undo"]["params"]["light"] == 1, out["undo"].dump());
        const auto undone = xfb::writes::LightSet(p::ParseLight(out["undo"]["params"]), fake.Ops());
        Check("running that undo places it at the earlier world position", fake.at[1] == std::array<double, 3>{9.0, 9.0, 9.0}, undone.dump());
    }
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        fake.drift = true;
        const auto out = xfb::writes::LightSet(p::ParseLight(json::parse(R"({"light":1,"place":{"distance":1}})")), fake.Ops());
        Check("a light photo mode moves again is reported (held false, with the fallback named)",
              out["placement"]["held"] == false && out["placement"]["note"].get<std::string>().find("camera") != std::string::npos, out.dump());
    }
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        fake.values[p::key::kLightState] = 0;
        const auto out = xfb::writes::LightSet(p::ParseLight(json::parse(R"({"light":1,"place":"camera"})")), fake.Ops());
        std::string calls;
        for (const auto& c : fake.calls)
        {
            calls += c + " ";
        }
        Check("place camera switches the light off and on again, with a settle after each",
              calls == "43=0 44=0 settle 44=1 settle " && out["placement"]["route"] == "switched_again" && out["undo"]["params"]["on"] == false,
              calls + out.dump());
    }
    Check("place refuses a distance inside V's head",
          ParamsCode([] { p::ParseLight(json::parse(R"({"light":1,"place":{"distance":0.05}})")); }) == "bad_params");
    Check("place refuses an unknown name", ParamsCode([] { p::ParseLight(json::parse(R"({"light":1,"place":"sun"})")); }) == "bad_params");
    Check("place alone is a valid light change", ParamsCode([] { p::ParseLight(json::parse(R"({"light":2,"place":"camera"})")); }) == "ok");
}

struct FakeWardrobe
{
    std::map<std::string, std::string> worn;
    std::vector<std::string> added;
    std::vector<std::string> calls;
    int ticksToApply = 2;
    int pending = -1;
    std::string pendingSlot;
    std::string pendingItem;
    bool never = false;
    bool debugNames = false;
    xfb::writes::InventoryOps Ops(const std::string& aItem, const std::string& aSlot, bool aAdd)
    {
        xfb::writes::InventoryOps ops;
        ops.equip = [this, aItem, aSlot, aAdd] {
            calls.push_back("equip");
            const auto previous = worn.count(aSlot) ? worn[aSlot] : std::string();
            if (aAdd)
            {
                added.push_back(aItem);
            }
            pending = ticksToApply;
            pendingSlot = aSlot;
            pendingItem = aItem;
            return json{{"item", aItem}, {"slot", aSlot}, {"added", aAdd}, {"already_equipped", previous == aItem}, {"previous", previous}};
        };
        ops.unequip = [this, aSlot] {
            calls.push_back("unequip");
            const auto previous = worn.count(aSlot) ? worn[aSlot] : std::string();
            pending = ticksToApply;
            pendingSlot = aSlot;
            pendingItem.clear();
            return json{{"slot", aSlot}, {"previous", previous}, {"was_empty", previous.empty()}};
        };
        ops.slot = [this, aSlot](const std::string&, const std::string& aAsked) {
            const auto item = worn.count(aSlot) ? worn[aSlot] : std::string();
            // The script compares record IDs; a debug name that differs from the record's name (debugNames)
            // must not matter (RB-63).
            const auto shown = debugNames && !item.empty() ? "<TDBID:" + item + ">" : item;
            return json{{"slot", aSlot}, {"item", shown}, {"empty", item.empty()}, {"matches", !aAsked.empty() && item == aAsked}};
        };
        ops.removeAdded = [this](const std::string& aName) {
            calls.push_back("remove " + aName);
            return json{{"removed", true}};
        };
        ops.settle = [this] {
            if (pending > 0 && --pending == 0 && !never)
            {
                if (pendingItem.empty())
                {
                    worn.erase(pendingSlot);
                }
                else
                {
                    worn[pendingSlot] = pendingItem;
                }
            }
        };
        return ops;
    }
};

void InventoryAndSaveTests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    Check("inventory.equip needs an item record name",
          ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Helmet"}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}, {"slot", "Weapon"}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Items.Helmet_01; x"}}); }) == "bad_params");
    Check("inventory.unequip takes slot or item, and remove_added only with item",
          ParamsCode([] { p::ParseInventoryUnequip(json::object()); }) == "bad_params" &&
              ParamsCode([] { p::ParseInventoryUnequip(json{{"slot", "Head"}, {"item", "Items.Cap_01"}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseInventoryUnequip(json{{"slot", "Head"}, {"remove_added", true}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseInventoryUnequip(json{{"slot", "Head"}}); }) == "ok");
    Check("game.load takes latest or a name, not both",
          ParamsCode([] { p::ParseGameLoad(json{{"discard_unsaved", true}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseGameLoad(json{{"latest", true}, {"name", "ManualSave-1"}, {"discard_unsaved", true}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseGameLoad(json{{"name", "../../x"}, {"discard_unsaved", true}}); }) == "bad_params" &&
              ParamsCode([] { p::ParseGameLoad(json{{"name", "ManualSave-12"}, {"discard_unsaved", true}}); }) == "ok");
    {
        std::string message;
        try
        {
            p::ParseGameLoad(json{{"latest", true}});
        }
        catch (const xfb::MethodError& e)
        {
            message = std::string(e.code) + " " + e.what();
        }
        Check("RB-56: game.load without discard_unsaved: true is refused in plain words",
              message.find("bad_params") == 0 && message.find("discard_unsaved: true") != std::string::npos &&
                  ParamsCode([] { p::ParseGameLoad(json{{"latest", true}, {"discard_unsaved", false}}); }) == "bad_params",
              message);
    }
    Check("game.save's name is a plain label", ParamsCode([] { p::ParseGameSave(json{{"name", "before \"x\""}}); }) == "bad_params" &&
                                                   ParamsCode([] { p::ParseGameSave(json{{"name", "session 4 start"}}); }) == "ok");
    {
        FakeWardrobe wardrobe;
        const auto request = p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}, {"add_if_missing", true}});
        const auto out = w::InventoryEquip(request, wardrobe.Ops("Items.Helmet_01", "Head", true));
        Check("equip waits until the slot shows the item; an added item's undo unequips and removes it",
              out["equipped"] == true && out["undo"] == json{{"method", "inventory.unequip"}, {"params", {{"item", "Items.Helmet_01"}, {"remove_added", true}}}},
              out.dump());
        const auto undo = w::InventoryUnequip(p::ParseInventoryUnequip(out["undo"]["params"]), wardrobe.Ops("Items.Helmet_01", "Head", false));
        Check("running that undo empties the slot and removes the added item",
              wardrobe.worn.count("Head") == 0 && undo["removed"] == true && wardrobe.calls.back() == "remove Items.Helmet_01", undo.dump());
    }
    {
        FakeWardrobe wardrobe;
        wardrobe.worn["Head"] = "Items.Cap_01";
        const auto out = w::InventoryEquip(p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}}), wardrobe.Ops("Items.Helmet_01", "Head", false));
        Check("equip over another item: the undo equips that item again",
              out["undo"] == json{{"method", "inventory.equip"}, {"params", {{"item", "Items.Cap_01"}, {"slot", "Head"}}}}, out.dump());
    }
    {
        FakeWardrobe wardrobe;
        wardrobe.debugNames = true;
        const auto out = w::InventoryEquip(p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}, {"add_if_missing", true}}),
                                           wardrobe.Ops("Items.Helmet_01", "Head", true));
        const auto undo = w::InventoryUnequip(p::ParseInventoryUnequip(out["undo"]["params"]), wardrobe.Ops("Items.Helmet_01", "Head", false));
        Check("RB-63: equip and remove decide by the script's record-ID match, not the debug name it reports",
              out["equipped"] == true && undo["unequipped"] == true && undo["removed"] == true, out.dump() + undo.dump());
    }
    {
        FakeWardrobe wardrobe;
        wardrobe.never = true;
        const auto out = w::InventoryEquip(p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}}), wardrobe.Ops("Items.Helmet_01", "Head", false));
        Check("an equip the slot never shows says so (equipped false, a note)", out["equipped"] == false && out.contains("note"), out.dump());
    }

    // A fake clock the fakes' sleep (and each game step's cost) advances, for the steady-clock waits (RB-55).
    struct FakeClock
    {
        std::chrono::steady_clock::time_point at{};
        w::Clock Now()
        {
            return [this] { return at; };
        }
        void Advance(std::chrono::milliseconds aFor) { at += aFor; }
    };
    struct FakeSaves
    {
        bool bridgeLock = true;
        bool locked = true;
        int unlockAfter = 2;
        std::string state = "none";
        int saveAfter = 2;
        bool fail = false;
        int relocks = 0;
        int statusCalls = 0;
        int saves = 0;
        std::chrono::milliseconds statusCost{0}; // how long each status step takes (a hitching game)
        std::string throwAt;                      // "status", "save" or "guard2": that step throws
        bool killed = false;                      // the guard refuses from the start
        int guards = 0;
        FakeClock clock;
        w::SaveOps Ops(bool aOverride)
        {
            w::SaveOps ops;
            ops.guard = [this] {
                ++guards;
                if (killed || (throwAt == "guard2" && guards == 2))
                {
                    throw xfb::MethodError("killed", "the kill switch stopped the bridge part-way");
                }
            };
            ops.prepare = [this, aOverride] {
                if (bridgeLock && !aOverride)
                {
                    throw xfb::MethodError("bridge_save_lock", "the bridge keeps saving locked");
                }
                return json{{"lock_released", bridgeLock}};
            };
            ops.status = [this] {
                ++statusCalls;
                clock.Advance(statusCost);
                if (throwAt == "status" && state == "pending")
                {
                    throw xfb::MethodError("timeout_after_start", "a game-thread step started but did not finish in time");
                }
                if (locked && --unlockAfter <= 0)
                {
                    locked = false;
                }
                if (state == "pending" && --saveAfter <= 0)
                {
                    state = fail ? "failed" : "saved";
                }
                return json{{"locked", locked}, {"state", state}};
            };
            ops.save = [this] {
                ++saves;
                if (throwAt == "save")
                {
                    throw xfb::MethodError("failed", "save() threw");
                }
                state = "pending";
                return json{{"requested", true}};
            };
            ops.relock = [this] { ++relocks; };
            ops.sleep = [this](std::chrono::milliseconds aFor) { clock.Advance(aFor); };
            ops.now = clock.Now();
            return ops;
        }
    };
    const auto saveCode = [](FakeSaves& aFake, const json& aParams) {
        try
        {
            const auto out = w::GameSave(p::ParseGameSave(aParams), aFake.Ops(aParams.value("override_lock", false)));
            return out.value("saved", false) ? std::string("saved") : std::string("?");
        }
        catch (const xfb::MethodError& e)
        {
            return e.code;
        }
    };
    const json overrideLock{{"override_lock", true}};
    {
        FakeSaves fake;
        Check("game.save refuses while the bridge's save lock is held", saveCode(fake, json::object()) == "bridge_save_lock" && fake.relocks == 0);
        Check("with override_lock it waits for the lock to go, saves, and takes the lock back (RB-52: success)",
              saveCode(fake, overrideLock) == "saved" && fake.relocks == 1);
    }
    {
        FakeSaves fake;
        fake.bridgeLock = false;
        fake.locked = false;
        Check("a save that released nothing doesn't touch the lock", saveCode(fake, json::object()) == "saved" && fake.relocks == 0);
    }
    {
        FakeSaves fake;
        fake.unlockAfter = 1000;
        Check("a lock that doesn't go: nothing saved, the bridge's lock back on",
              saveCode(fake, overrideLock) == "saving_locked" && fake.relocks == 1 && fake.saves == 0);
    }
    {
        FakeSaves fake;
        fake.fail = true;
        Check("the game's failed answer is save_failed, and the lock is back on (RB-52)", saveCode(fake, overrideLock) == "save_failed" && fake.relocks == 1);
    }
    {
        FakeSaves fake;
        fake.saveAfter = 1000000;
        Check("no answer within the wait is save_uncertain, and the lock is back on (RB-52)",
              saveCode(fake, json{{"override_lock", true}, {"timeout_ms", 2000}}) == "save_uncertain" && fake.relocks == 1);
    }
    {
        FakeSaves fake;
        fake.throwAt = "save";
        Check("save() throwing takes the lock back (RB-52)", saveCode(fake, overrideLock) == "failed" && fake.relocks == 1);
    }
    {
        FakeSaves fake;
        fake.throwAt = "status";
        Check("a game-thread timeout while waiting for the answer takes the lock back (RB-52)",
              saveCode(fake, overrideLock) == "timeout_after_start" && fake.relocks == 1);
    }
    {
        FakeSaves fake;
        fake.throwAt = "guard2";
        Check("RB-53: the kill switch after the lock was released: no save asked, the lock back on (RB-52)",
              saveCode(fake, overrideLock) == "killed" && fake.saves == 0 && fake.relocks == 1);
    }
    {
        FakeSaves fake;
        fake.killed = true;
        Check("RB-53: killed or paused before the first step: nothing released, nothing saved",
              saveCode(fake, overrideLock) == "killed" && fake.saves == 0 && fake.relocks == 0 && fake.statusCalls == 0);
    }
    {
        FakeSaves fake;
        fake.saveAfter = 1000000;
        fake.statusCost = std::chrono::milliseconds(900);
        const auto code = saveCode(fake, json{{"override_lock", true}, {"timeout_ms", 2000}});
        // Counting loop turns would poll 11 times (2000 / 200 + 1), about 12 s of game time here.
        Check("RB-55: the answer wait is a steady-clock deadline: a hitching game (0.9 s a step) stops near 2 s, not after 11 polls",
              code == "save_uncertain" && fake.statusCalls <= 6, std::to_string(fake.statusCalls) + " status calls");
    }

    const std::vector<std::string> saves{"ManualSave-3", "AutoSave-1", "manualsave-9", "ManualSave-9"};
    Check("FindSave: exact first, then ignoring case, -1 none, -2 ambiguous",
          w::FindSave(saves, "AutoSave-1") == 1 && w::FindSave(saves, "autosave-1") == 1 && w::FindSave(saves, "Nope") == -1 &&
              w::FindSave(saves, "MANUALSAVE-9") == -2 && w::FindSave(saves, "ManualSave-9") == 3);
    {
        int polls = 0;
        int lists = 0;
        bool killed = false;
        std::string loaded;
        FakeClock clock;
        w::LoadOps ops;
        ops.guard = [&killed] {
            if (killed)
            {
                throw xfb::MethodError("writes_paused", "changes were paused part-way");
            }
        };
        ops.latest = [&loaded] {
            loaded = "latest";
            return json{{"requested", true}, {"route", "latest"}};
        };
        ops.list = [&lists, &polls] {
            ++lists;
            polls = 0;
            return json{{"requested", true}};
        };
        ops.saves = [&polls, &saves] { return ++polls < 3 ? json{{"ready", false}} : json{{"ready", true}, {"saves", saves}}; };
        ops.load = [&loaded](const std::string& aName) {
            loaded = aName;
            return json{{"requested", true}, {"route", "name"}};
        };
        ops.sleep = [&clock](std::chrono::milliseconds aFor) { clock.Advance(aFor); };
        ops.now = clock.Now();
        const json discard{{"discard_unsaved", true}};
        const auto withName = [&discard](const char* aName) {
            auto params = discard;
            params["name"] = aName;
            return p::ParseGameLoad(params);
        };
        const auto out = w::GameLoad(withName("autosave-1"), ops);
        Check("game.load by name waits for the game's list and hands the load step the exact name to look up (RB-58)",
              loaded == "AutoSave-1" && lists == 1 && out["undo"].is_null() && out.contains("undo_note"), out.dump());
        w::GameLoad(withName("ManualSave-3"), ops);
        Check("RB-58: every load by name fetches the game's list again", lists == 2 && loaded == "ManualSave-3");
        std::string message;
        try
        {
            w::GameLoad(withName("Missing-1"), ops);
        }
        catch (const xfb::MethodError& e)
        {
            message = std::string(e.code) + " " + e.what();
        }
        Check("a name that isn't there: save_not_found, listing some names", message.find("save_not_found") == 0 && message.find("ManualSave-3") != std::string::npos,
              message);
        auto latest = discard;
        latest["latest"] = true;
        Check("latest takes the quick-load path", w::GameLoad(p::ParseGameLoad(latest), ops)["route"] == "latest");
        killed = true;
        loaded.clear();
        std::string code;
        try
        {
            w::GameLoad(withName("AutoSave-1"), ops);
        }
        catch (const xfb::MethodError& e)
        {
            code = e.code;
        }
        Check("RB-53: paused or killed part-way, nothing is loaded", code == "writes_paused" && loaded.empty());
        killed = false;
        ops.saves = [] { return json{{"ready", false}}; };
        const auto started = clock.at;
        code.clear();
        try
        {
            w::GameLoad(withName("AutoSave-1"), ops);
        }
        catch (const xfb::MethodError& e)
        {
            code = e.code;
        }
        Check("RB-55: the list wait is a steady-clock deadline (kSaveListWaitMs)",
              code == "timeout" && clock.at - started >= std::chrono::milliseconds(w::kSaveListWaitMs) &&
                  clock.at - started < std::chrono::milliseconds(w::kSaveListWaitMs + 500));
    }
}

void Rb51To60Tests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    // RB-51: cc.confirm closes with Back only when certainly nothing changed.
    Check("RB-51: cc.confirm with no change event and every option as at open: nothing to confirm (Back, nothing discarded)",
          w::ChooseLeave(true, json{{"changes", 0}, {"unchanged", true}}) == w::LeaveRoute::NothingToConfirm);
    Check("RB-51: any change event confirms, even with the options back as they were",
          w::ChooseLeave(true, json{{"changes", 1}, {"unchanged", true}}) == w::LeaveRoute::Confirm);
    Check("RB-51: options differing from the open-time snapshot (a preset, randomize, the system route) confirm",
          w::ChooseLeave(true, json{{"changes", 0}, {"unchanged", false}}) == w::LeaveRoute::Confirm);
    Check("RB-51: unsure (no snapshot, a missing or odd value) confirms, never Back",
          w::ChooseLeave(true, json::object()) == w::LeaveRoute::Confirm && w::ChooseLeave(true, json{{"changes", "0"}, {"unchanged", true}}) == w::LeaveRoute::Confirm &&
              w::ChooseLeave(true, json{{"changes", 0}, {"unchanged", "true"}}) == w::LeaveRoute::Confirm &&
              w::ChooseLeave(true, json{{"changes", 0}}) == w::LeaveRoute::Confirm);
    Check("cc.back is always Back, and the script's mode codes", w::ChooseLeave(false, json{{"changes", 0}, {"unchanged", true}}) == w::LeaveRoute::Back &&
                                                                 w::LeaveRouteCode(w::LeaveRoute::Back) == 0 && w::LeaveRouteCode(w::LeaveRoute::Confirm) == 1 &&
                                                                 w::LeaveRouteCode(w::LeaveRoute::NothingToConfirm) == 2);

    // RB-53: the dispatcher's check for multi-step writes.
    {
        xfb::Config config;
        config.allowWrites = true;
        xfb::Session session;
        std::string error;
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-rb53-not-created");
        xfb::GameThreadQueue queue;
        xfb::Dispatcher dispatcher(config, session, queue);
        const auto code = [&dispatcher] {
            return ParamsCode([&dispatcher] { dispatcher.RequireWritesOpen(); });
        };
        const auto open = code();
        dispatcher.SetWritesPaused(true);
        const auto paused = code();
        dispatcher.SetWritesPaused(false);
        dispatcher.Kill("unit");
        const auto killed = code();
        Check("RB-53: RequireWritesOpen passes, then refuses writes_paused and killed", open == "ok" && paused == "writes_paused" && killed == "killed",
              open + " " + paused + " " + killed);
    }

    // RB-59 and RB-60: light placement undo and errors.
    struct Fake : FakePhoto
    {
        std::array<double, 3> at{4.0, 5.0, 6.0};
        bool failSettleAfterPlace = false;
        bool failPosition = false;
        bool placed = false;
        xfb::writes::LightOps Ops()
        {
            auto ops = FakePhoto::Ops();
            const auto baseSettle = ops.settle;
            ops.settle = [this, baseSettle] {
                if (failSettleAfterPlace && placed)
                {
                    throw xfb::MethodError("timeout", "photo mode didn't tick");
                }
                baseSettle();
            };
            ops.place = [this](int32_t, const p::LightPlacement&) {
                placed = true;
                const auto before = at;
                at = {1.0, 2.0, 3.0};
                return json{{"before", {{"x", before[0]}, {"y", before[1]}, {"z", before[2]}}}, {"after", {{"x", 1.0}, {"y", 2.0}, {"z", 3.0}}}};
            };
            ops.position = [this](int32_t) {
                if (failPosition)
                {
                    throw xfb::MethodError("unavailable", "the light's entity wasn't found");
                }
                return json{{"position", {{"x", at[0]}, {"y", at[1]}, {"z", at[2]}}}};
            };
            return ops;
        }
    };
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        fake.values[p::key::kLightState] = 1;
        const auto out = w::LightSet(p::ParseLight(json::parse(R"({"light":1,"place":"camera"})")), fake.Ops());
        Check("RB-59: place camera records the light's earlier position, and its undo puts it back there",
              out["undo"]["params"]["place"] == json{{"world", {4.0, 5.0, 6.0}}} && out["placement"]["before"]["x"] == 4.0, out.dump());
    }
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        fake.failPosition = true;
        const auto out = w::LightSet(p::ParseLight(json::parse(R"({"light":1,"place":{"distance":1.2}})")), fake.Ops());
        Check("RB-60: a failed read-back after a move is reported (now_unknown), with the undo, not a failure",
              out["placement"]["route"] == "moved" && out["placement"].contains("now_unknown") && !out["placement"].contains("held") &&
                  out["undo"]["params"]["place"] == json{{"world", {4.0, 5.0, 6.0}}},
              out.dump());
    }
    {
        Fake fake;
        fake.values[p::key::kLightSelect] = 0;
        fake.failSettleAfterPlace = true;
        std::string message;
        try
        {
            w::LightSet(p::ParseLight(json::parse(R"({"light":1,"place":{"distance":1.2}})")), fake.Ops());
        }
        catch (const xfb::MethodError& e)
        {
            message = e.what();
        }
        Check("RB-60: a failure after the light moved says so and names the undo that puts it back",
              message.find("the light was moved") != std::string::npos && message.find("\"world\":[4.0,5.0,6.0]") != std::string::npos &&
                  message.find("no light value was changed; the light was moved") != std::string::npos,
              message);
    }
}

int RunUnitTests()
{
    SanitizeTests();
    NestingTests();
    SerializeTests();
    QueueTests();
    KillTests();
    RestoreOnceTests();
    UndoTests();
    LightTests();
    WaitTicksTests();
    WriteClassTests();
    ParamsTests();
    ScriptFrameTests();
    FaceTests();
    CreatorAndOptionsTests();
    Batch4Tests();
    MessageTests();
    Batch5ClassTests();
    LightPlacementTests();
    InventoryAndSaveTests();
    Rb51To60Tests();
    std::printf(gFailures == 0 ? "UNIT OK\n" : "UNIT FAILED %d\n", gFailures);
    return gFailures == 0 ? 0 : 1;
}
