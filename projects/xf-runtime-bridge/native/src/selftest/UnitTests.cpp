// In-process checks of the bridge core pieces that are hard to reach through the pipe:
// UTF-8-safe log sanitising, the JSON nesting pre-scan, lossless-or-replaced serialisation and
// the game-thread queue's task states, the kill switch's ordering against queued writes and its
// once-only restore, the write logic shared with the plugin (core/Writes.cpp), config write classes
// and the dispatcher's write gate. Run with `xfb_selftest --unit`; prints PASS/FAIL lines.

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <cstdio>
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
#include "core/Log.hpp"
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
    Check("photo.expression.index takes head and unlisted",
          p::ParseExpressionIndex(json::parse(R"({"index":56,"target":"head","unlisted":true})")).unlisted);
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
} // namespace

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
    std::printf(gFailures == 0 ? "UNIT OK\n" : "UNIT FAILED %d\n", gFailures);
    return gFailures == 0 ? 0 : 1;
}
