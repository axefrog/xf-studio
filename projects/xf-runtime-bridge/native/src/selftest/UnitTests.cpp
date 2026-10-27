// In-process checks of the bridge core pieces that are hard to reach through the pipe:
// UTF-8-safe log sanitising, the JSON nesting pre-scan, lossless-or-replaced serialisation and
// the game-thread queue's task states, the kill switch's ordering against queued writes and its
// once-only restore, the write logic shared with the plugin (core/Writes.cpp), config write classes
// and the dispatcher's write gate. Run with `xfb_selftest --unit`; prints PASS/FAIL lines.

#include <Windows.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cmath>
#include <cstring>
#include <string>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <limits>
#include <map>
#include <new>
#include <utility>
#include <vector>
#include <thread>

#include "core/Behaviours.hpp"
#include "core/Bridge.hpp"
#include "core/Events.hpp"
#include "core/PinViews.hpp"
#include "core/Hooks070.hpp"
#include "core/overlay/Host.hpp"
#include "core/CetPanel.hpp"
#include "core/Player.hpp"
#include "core/Scene.hpp"
#include "core/Config.hpp"
#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/InkUi.hpp"
#include "core/KillKey.hpp"
#include "core/Win32.hpp"
#include "core/LivePose.hpp"
#include "core/Log.hpp"
#include "core/Messages.hpp"
#include "core/Probes.hpp"
#include "core/OptionsExchange.hpp"
#include "core/Params.hpp"
#include "core/ScriptFrame.hpp"
#include "core/ScriptLayer.hpp"
#include "core/Session.hpp"
#include "core/Showroom.hpp"
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
    // 0.8.3 (two of these checks failed once right after a clean build): the game thread drains from the start and the
    // timeout is 300 ms, not 50, so a busy machine has to keep that thread from running for 300 ms to make the task miss its
    // start; the task still runs past the timeout (it sleeps 500 ms), which is what the check is about.
    {
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::thread game([&] { DrainOne(queue, 0ms); });
        json result;
        std::string error;
        const auto outcome = queue.Run(
            [] {
                std::this_thread::sleep_for(500ms);
                return json(42);
            },
            300ms, result, error, "unit.grace", 3000ms);
        game.join();
        Check("running task that finishes within the grace period returns its result",
              outcome == xfb::QueueResult::Done && result == json(42) && queue.LateCompletions() == 0);
    }

    // A task still running after timeout + grace: timeout_after_start, then a logged late completion.
    {
        // 0.8.3: drained from the start, a 300 ms timeout and grace, the task 1.5 s long: the answer comes after about 600 ms,
        // long before the task ends (the bound is the task's length, not a tight timing).
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        std::thread game([&] { DrainOne(queue, 0ms); });
        json result;
        std::string error;
        const auto started = std::chrono::steady_clock::now();
        const auto outcome = queue.Run(
            [] {
                std::this_thread::sleep_for(1500ms);
                return json(7);
            },
            300ms, result, error, "unit.late", 300ms);
        const auto waited = MsSince(started);
        game.join();
        Check("running task past the grace period reports timeout_after_start",
              outcome == xfb::QueueResult::TimeoutAfterStart && waited >= 550 && waited < 1400, std::to_string(waited) + " ms");
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
                std::this_thread::sleep_for(1500ms);
                return json(1);
            },
            5000ms, result, error, "unit.close_running");
        const auto waited = MsSince(started);
        game.join();
        closer.join();
        // 0.8.3: the bound is the task's length (1.5 s), not a tight 250 ms: released by the close, not by the task's end.
        Check("Close releases the waiter of a running task at once",
              outcome == xfb::QueueResult::TimeoutAfterStart && waited < 1200 && queue.LateCompletions() == 1,
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
    catch (const std::exception& e)
    {
        return std::string("exception: ") + e.what();
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
    Check("world.time.set outside photo mode undoes to the exact earlier time, on the world's clock",
          clock["undo"] == json{{"method", "world.time.set"}, {"params", {{"total_seconds", 7200}, {"target", "world"}}}}, clock.dump());

    // 0.5.1 (RB-67, RB-70, RB-75): which clock, photo mode's slider in minutes or hours, and the undo's target.
    const auto time = [](const char* aText) { return p::ParseTime(json::parse(aText)); };
    Check("world.time.set takes target world or photo, and photo only with hours and minutes",
          time(R"({"hours":2,"target":"photo"})").target == "photo" && time(R"({"total_seconds":5,"target":"world"})").target == "world" &&
              ParamsCode([] { p::ParseTime(json::parse(R"({"hours":2,"target":"moon"})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseTime(json::parse(R"({"total_seconds":5,"target":"photo"})")); }) == "bad_params");
    Check("RB-67: in photo mode the time is photo mode's own; outside it the world's clock",
          w::ChooseTimeRoute(time(R"({"hours":2})"), "photo_mode", true) == w::TimeRoute::Photo &&
              w::ChooseTimeRoute(time(R"({"hours":2})"), "gameplay", true) == w::TimeRoute::World &&
              w::ChooseTimeRoute(time(R"({"hours":2})"), "character_menu", true) == w::TimeRoute::World);
    Check("RB-67: a photo-mode time (the undo's target photo) replayed after photo mode closes changes nothing",
          w::ChooseTimeRoute(time(R"({"hours":2,"target":"photo"})"), "gameplay", true) == w::TimeRoute::PhotoClosed &&
              w::ChooseTimeRoute(time(R"({"hours":2,"target":"photo"})"), "character_menu", false) == w::TimeRoute::PhotoClosed);
    const auto closed = w::PhotoClosedTimeResult("gameplay");
    Check("RB-67: the no-op says nothing changed and has no undo",
          closed["changed"] == false && closed["undo"].is_null() && closed["note"].get<std::string>().find("world's clock was not touched") != std::string::npos,
          closed.dump());
    Check("RB-67: target world and total_seconds are refused in photo mode",
          ParamsCode([&] { w::ChooseTimeRoute(time(R"({"hours":2,"target":"world"})"), "photo_mode", true); }) == "not_in_gameplay" &&
              ParamsCode([&] { w::ChooseTimeRoute(time(R"({"total_seconds":7200})"), "photo_mode", true); }) == "bad_params");
    Check("RB-70: photo mode's time of day needs the photo write class, whatever the method's own class",
          ParamsCode([&] { w::ChooseTimeRoute(time(R"({"hours":2})"), "photo_mode", false); }) == "write_class_disabled" &&
              w::ChooseTimeRoute(time(R"({"hours":2})"), "gameplay", false) == w::TimeRoute::World);
    const json minutesSlider{{"seen", true}, {"kind", "slider"}, {"label", "TIME OF DAY"}, {"label_key", ""}, {"min", 0}, {"max", 1440}};
    const auto inMinutes = w::PlanPhotoTime(minutesSlider, time(R"({"hours":2,"minutes":30})"));
    Check("the time-of-day slider in minutes (0-1440, the first session's dump) takes 150 for 02:30",
          inMinutes.value == 150.0 && inMinutes.minutesPerUnit == 1.0);
    json hoursSlider = minutesSlider;
    hoursSlider["max"] = 24;
    const auto inHours = w::PlanPhotoTime(hoursSlider, time(R"({"hours":2,"minutes":30})"));
    Check("RB-75: a time-of-day slider in hours (0-24) takes 2.5 for 02:30",
          inHours.value == 2.5 && inHours.minutesPerUnit == 60.0);
    const auto hoursResult = w::PhotoTimeResult(json{{"label", "TIME OF DAY"}, {"before", 4.06}, {"before_known", true}, {"after", 2.5}}, inHours);
    Check("RB-75: the hours slider's answer is in minutes, and its undo in hours and minutes with target photo",
          hoursResult["before_minutes"].get<double>() > 243.5 && hoursResult["after_minutes"] == 150.0 && hoursResult["unit"] == "hours" &&
              hoursResult["undo"] == json{{"method", "world.time.set"}, {"params", {{"hours", 4}, {"minutes", 4}, {"target", "photo"}}}},
          hoursResult.dump());
    const auto minutesResult = w::PhotoTimeResult(json{{"before", 243.592}, {"before_known", true}, {"after", 150}}, inMinutes);
    Check("world.time.set in photo mode undoes to photo mode's earlier time of day, to the minute, with target photo",
          minutesResult["undo"] == json{{"method", "world.time.set"}, {"params", {{"hours", 4}, {"minutes", 4}, {"target", "photo"}}}},
          minutesResult.dump());
    const auto photoUnknown = w::PhotoTimeResult(json{{"before", -1.0}, {"before_known", false}, {"after", 150}}, inMinutes);
    Check("no undo when photo mode's earlier time of day is unknown, with a note",
          photoUnknown["undo"].is_null() && photoUnknown.contains("undo_note") && photoUnknown["before_minutes"].is_null(), photoUnknown.dump());
    Check("RB-70: attribute 70 is taken only as a slider named for the time over a day's range",
          [&] {
              json speed = minutesSlider;
              speed["label"] = "GAME SPEED";
              json keyed = minutesSlider;
              keyed["label"] = "HEURE";
              keyed["label_key"] = "UI-PhotoMode-TimeOfDay";
              json options = minutesSlider;
              options["kind"] = "options";
              json wide = minutesSlider;
              wide["max"] = 5000;
              const auto request = p::ParseTime(json::parse(R"({"hours":2})"));
              return ParamsCode([&] { w::PlanPhotoTime(speed, request); }) == "unavailable" &&
                     ParamsCode([&] { w::PlanPhotoTime(keyed, request); }) == "ok" &&
                     ParamsCode([&] { w::PlanPhotoTime(options, request); }) == "unavailable" &&
                     ParamsCode([&] { w::PlanPhotoTime(wide, request); }) == "unavailable" &&
                     ParamsCode([&] { w::PlanPhotoTime(json{{"seen", false}}, request); }) == "unavailable";
          }());

    // 0.5.1 (RB-72): photo.expression.index against the list's table indices.
    const json faceList{{"seen", true},
                        {"entries",
                         {{{"data", 0}, {"table_index", 0}, {"table_index_by", "label"}, {"table_index_verified", true}},
                          {{"data", 56}, {"table_index", 60}, {"table_index_by", "label"}, {"table_index_verified", true}},
                          {{"data", 57}, {"table_index", 61}, {"table_index_by", "position"}, {"table_index_verified", false}}}}};
    const auto faceIndex = [](const char* aText) { return p::ParseExpressionIndex(json::parse(aText)); };
    Check("RB-72: a table index found by the expression's name is accepted (index_by label)",
          w::CheckFaceIndex(faceIndex(R"({"index":60})"), faceList) == "label");
    Check("RB-72: an index known only by list position is refused unless force",
          ParamsCode([&] { w::CheckFaceIndex(faceIndex(R"({"index":61})"), faceList); }) == "unverified_index" &&
              w::CheckFaceIndex(faceIndex(R"({"index":61,"force":true})"), faceList) == "position");
    Check("RB-72: an index the list doesn't have is refused unless unlisted, and the menu value is not a table index",
          ParamsCode([&] { w::CheckFaceIndex(faceIndex(R"({"index":56})"), faceList); }) == "bad_params" &&
              w::CheckFaceIndex(faceIndex(R"({"index":56,"unlisted":true})"), json::object()) == "unlisted");
    Check("RB-72: a list not seen yet is unavailable",
          ParamsCode([&] { w::CheckFaceIndex(faceIndex(R"({"index":60})"), json{{"seen", false}}); }) == "unavailable");
    // 0.5.2 (RB-78): session 5's list had no table index at all (the face table read nothing).
    const json unreadable{{"seen", true}, {"face_table", {{"listed", 207}, {"readable", 0}, {"source", "names"}}},
                          {"entries", {{{"data", 0}}, {{"data", 56}}}}};
    Check("0.5.2 (RB-78): an unreadable face table says so (face_table_unreadable), and unlisted still applies",
          ParamsCode([&] { w::CheckFaceIndex(faceIndex(R"({"index":60})"), unreadable); }) == "face_table_unreadable" &&
              w::CheckFaceIndex(faceIndex(R"({"index":60,"unlisted":true})"), unreadable) == "unlisted");
    auto readable = faceList;
    readable["face_table"] = {{"listed", 3}, {"readable", 3}, {"source", "names"}};
    Check("0.5.2 (RB-78): a readable face table checks indices as before",
          w::CheckFaceIndex(faceIndex(R"({"index":60})"), readable) == "label");

    // 0.5.1 (RB-71): cc.apply by index with the row and value read before.
    const auto expected = p::ParseCharacterApply(json::parse(R"({"option":"makeupLips_color","index":6,"expect_option":"makeupLips_09","expect_value":"lips_09_06"})"));
    Check("RB-71: cc.apply carries the row and value read before applying by index",
          expected.expectOption == "makeupLips_09" && expected.expectValue == "lips_09_06" && expected.index == 6);
    Check("RB-71: expect_option and expect_value go only with index",
          ParamsCode([] { p::ParseCharacterApply(json::parse(R"({"option":"XF","value":"01","expect_value":"x"})")); }) == "bad_params");
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
    Check("0.5.1 (RB-66): cc.open's edit mode defaults to the mode's own tag (HairDresser 1, Ripperdoc 2)",
          open.editMode == p::CreatorEditMode::EditTag && p::CreatorEditTagCode(open) == 1 &&
              p::CreatorEditTagCode(p::ParseCreatorOpen(json::parse(R"({"mode":"ripperdoc"})"))) == 2);
    Check("0.5.1 (RB-66): edit_mode new_game opens with the NewGame tag (0), as CCA's F12 ran in session 4",
          p::CreatorEditTagCode(p::ParseCreatorOpen(json::parse(R"({"edit_mode":"new_game"})"))) == 0 &&
              p::CreatorEditTagCode(p::ParseCreatorOpen(json::parse(R"({"edit_mode":"new_game","mode":"mirror"})"))) == 0 &&
              std::string(p::CreatorEditModeName(p::CreatorEditMode::NewGame)) == "new_game");
    Check("0.5.1 (RB-66): edit_mode refuses other values and new_game with ripperdoc (it already allows every row)",
          ParamsCode([] { p::ParseCreatorOpen(json::parse(R"({"edit_mode":"hairdresser"})")); }) == "bad_params" &&
              ParamsCode([] { p::ParseCreatorOpen(json::parse(R"({"edit_mode":"new_game","mode":"ripperdoc"})")); }) == "bad_params");
    Check("cc.open refuses the new-game mode as a mode (it is an edit_mode) and waits outside 0.5-15 s",
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

        // RB-69: a request withdrawn while still waiting had its pause-menu event raised; the timeout says the
        // pause menu may open as usual.
        ops.prepare = [&] { return json{{"save_lock_requested", true}}; };
        ops.phase = [&] { return std::string("gameplay"); };
        ops.cancel = [&] { return json{{"withdrawn", true}, {"taken", false}, {"outcome", "withdrawn"}, {"pause_menu_may_open", true}}; };
        std::string message;
        try
        {
            w::CreatorOpen(p::ParseCreatorOpen(json::parse(R"({"timeout_ms":500})")), ops);
        }
        catch (const xfb::MethodError& e)
        {
            message = std::string(e.code) + ": " + e.what();
        }
        Check("0.5.1 (RB-69): a timed-out request withdrawn after its pause-menu event says the pause menu may open",
              message.rfind("creator_open_timeout", 0) == 0 && message.find("pause menu may open as usual") != std::string::npos &&
                  message.find("nothing opened") == std::string::npos,
              message);
    }

    // RB-69, RB-75: the pause menu's redirect decision, every way through.
    {
        const auto decide = [](bool aPending, double aAge, const char* aPrev, bool aRefused, double aWithdrawn) {
            return w::CreatorRedirect(
                json{{"pending", aPending}, {"age_s", aAge}, {"prev", aPrev}, {"refused", aRefused}, {"withdrawn_age_s", aWithdrawn}});
        };
        Check("the redirect: a fresh request from normal play switches to the mirror's scenario",
              decide(true, 0.2, "MenuScenario_Idle", false, -1) == "redirect" && decide(true, 3.0, "MenuScenario_Idle", false, -1) == "redirect");
        Check("the redirect: no request (the player's own Esc) opens the pause menu",
              decide(false, 0.0, "MenuScenario_Idle", false, -1) == "none" && w::CreatorRedirect(json::object()) == "none");
        Check("the redirect: an expired request (over 3 s, a negative age after an engine-time reset, or no age) opens the pause menu",
              decide(true, 3.01, "MenuScenario_Idle", false, -1) == "expired" && decide(true, -5.0, "MenuScenario_Idle", false, -1) == "expired" &&
                  w::CreatorRedirect(json{{"pending", true}, {"prev", "MenuScenario_Idle"}}) == "expired" &&
                  w::CreatorRedirect(json{{"pending", true}, {"age_s", "1"}, {"prev", "MenuScenario_Idle"}}) == "expired");
        Check("the redirect: a fresh request whose moment passed (refused) opens the pause menu",
              decide(true, 0.5, "MenuScenario_Idle", true, -1) == "refused");
        Check("0.5.1 (RB-69): the pause menu from another scenario (credits picker, debug hub) isn't redirected and the request waits",
              decide(true, 0.5, "MenuScenario_CreditsPickerPause", false, -1) == "foreign" && decide(true, 0.5, "", false, -1) == "foreign" &&
                  w::CreatorRedirect(json{{"pending", true}, {"age_s", 0.5}}) == "foreign");
        Check("0.5.1 (RB-69): a request withdrawn after its event lets the pause menu open (logged), only within the window",
              decide(false, 0.0, "MenuScenario_Idle", false, 1.0) == "withdrawn" && decide(false, 0.0, "MenuScenario_Idle", false, 4.0) == "none" &&
                  decide(false, 0.0, "MenuScenario_CreditsPickerPause", false, 1.0) == "none");
        Check("the redirect: wrong types never redirect",
              w::CreatorRedirect(json{{"pending", "yes"}, {"age_s", 0.1}, {"prev", "MenuScenario_Idle"}}) == "none" &&
                  w::CreatorRedirect(json{{"pending", true}, {"age_s", 0.1}, {"prev", 7}}) == "foreign");
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
        Check("a request still waiting is withdrawn: creator_open_timeout, nothing will open, saving stays locked",
              timedOut == "creator_open_timeout" && message.find("nothing will open") != std::string::npos &&
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
    // 0.8: a cut text ends with an ellipsis (U+2026), which takes one of the characters.
    Check("message text is cut at a character boundary, never inside a UTF-8 sequence", longText == std::string(10, 'a') + "\xE2\x80\xA6" && cut, longText);
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
    std::vector<std::string> askedIds; // the copy each slot read asked for (RB-125)
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
        ops.slot = [this, aSlot](const std::string&, const std::string& aAsked, const std::string& aId) {
            askedIds.push_back(aId);
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
        int32_t hold = 0;                         // 0.8.4: test.save.delay's one-shot hold
        int killAtGuard = -1;                     // 0.8.4: the guard refuses from this call on (a kill during the hold)
        FakeClock clock;
        w::SaveOps Ops(bool aOverride)
        {
            w::SaveOps ops;
            ops.guard = [this] {
                ++guards;
                if (killed || (throwAt == "guard2" && guards == 2) || (killAtGuard > 0 && guards >= killAtGuard))
                {
                    throw xfb::MethodError("killed", "the kill switch stopped the bridge part-way");
                }
            };
            ops.prepare = [this, aOverride] {
                if (throwAt == "prepare")
                {
                    // RB-119: the game thread released the lock, but the answer was lost (timeout after start).
                    throw xfb::MethodError("timeout_after_start", "a game-thread step started but did not finish in time");
                }
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
            ops.hold = [this] { return std::exchange(hold, 0); };
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
        fake.throwAt = "prepare";
        Check("RB-119: override_lock whose prepare answer is lost: the relock is already owned and runs (nothing saved)",
              saveCode(fake, overrideLock) == "timeout_after_start" && fake.relocks == 1 && fake.saves == 0);
    }
    {
        FakeSaves fake;
        fake.throwAt = "prepare";
        Check("RB-119: without override_lock prepare can't release, so a lost answer asks for no relock",
              saveCode(fake, json::object()) == "timeout_after_start" && fake.relocks == 0);
    }
    {
        FakeSaves fake;
        fake.bridgeLock = false;
        fake.locked = false;
        Check("RB-119: override_lock when prepare released nothing: saved, the relock disarmed",
              saveCode(fake, overrideLock) == "saved" && fake.relocks == 0);
    }
    {
        FakeSaves fake;
        fake.throwAt = "guard2";
        Check("RB-53: the kill switch after the lock was released: no save asked, the lock back on (RB-52)",
              saveCode(fake, overrideLock) == "killed" && fake.saves == 0 && fake.relocks == 1);
    }
    {
        // 0.8.4 (session 11's L1): the test hook holds the save after prepare; a kill during the hold stops it there.
        FakeSaves fake;
        fake.hold = 1000;
        fake.killAtGuard = 5;
        Check("0.8.4 test.save.delay: a kill during the hold after prepare: nothing saved, the released lock back on",
              saveCode(fake, overrideLock) == "killed" && fake.saves == 0 && fake.relocks == 1 && fake.guards == 5 && fake.hold == 0);
    }
    {
        FakeSaves fake;
        fake.hold = 300;
        const auto start = fake.clock.at;
        const auto code = saveCode(fake, overrideLock);
        Check("0.8.4 test.save.delay: without a kill the save goes on after the hold (the guard every 50 ms), and the hold is used once",
              code == "saved" && fake.guards == 8 && fake.hold == 0 && fake.relocks == 1 && fake.clock.at - start >= std::chrono::milliseconds(300));
        std::atomic<int32_t> slot{0};
        Check("0.8.4 test.save.delay is refused test_hooks_off unless config.ini allows test hooks, and bounded",
              ParamsCode([&] { w::TestSaveDelay(json{{"ms", 500}}, false, slot); }) == "test_hooks_off" && slot.load() == 0 &&
                  ParamsCode([&] { w::TestSaveDelay(json{{"ms", 10001}}, true, slot); }) == "bad_params" &&
                  ParamsCode([&] { w::TestSaveDelay(json::object(), true, slot); }) == "bad_params");
        const auto armed = w::TestSaveDelay(json{{"ms", 500}}, true, slot);
        Check("0.8.4 test.save.delay arms the slot and its undo puts the previous hold back",
              slot.load() == 500 && armed.value("armed_ms", 0) == 500 && armed["undo"]["params"]["ms"] == 0);
        Check("0.8.4 [bridge] allow_test_hooks: off by default, on when config.ini says so",
              !xfb::Config{}.allowTestHooks && xfb::ParseConfig("[bridge]\nallow_test_hooks = true\n").allowTestHooks &&
                  xfb::DescribeConfig(xfb::ParseConfig("[bridge]\nallow_test_hooks = true\n")).find("bridge.allow_test_hooks=true") != std::string::npos);
    }
    {
        // 0.8.7 (the Sol review of 0.8.7, finding 1): a save held after its prepare (test.save.delay) has released the bridge's
        // lock; a second save meanwhile, even one that finds no lock (override_lock false, the lock released), is refused before
        // any step, and the first saves and takes its lock back.
        FakeSaves first;
        first.hold = 200;
        std::atomic<bool> inHold{false};
        std::atomic<bool> secondDone{false};
        auto ops = first.Ops(true);
        ops.sleep = [&](std::chrono::milliseconds aFor) {
            first.clock.Advance(aFor);
            inHold = true;
            while (!secondDone)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        };
        std::string firstCode;
        std::thread holder([&] {
            try
            {
                firstCode = w::GameSave(p::ParseGameSave(overrideLock), ops).value("saved", false) ? "saved" : "?";
            }
            catch (const xfb::MethodError& e)
            {
                firstCode = e.code;
            }
        });
        while (!inHold)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        FakeSaves second;
        second.bridgeLock = false;
        second.locked = false;
        const auto secondCode = saveCode(second, json::object());
        secondDone = true;
        holder.join();
        Check("0.8.7 a save while another holds the lock released (Save anyway during a test.save.delay hold) is refused save_in_progress before any step; the first saves and relocks",
              secondCode == "save_in_progress" && second.saves == 0 && second.guards == 0 && firstCode == "saved" && first.relocks == 1 && first.saves == 1,
              secondCode + " / " + firstCode);
        Check("0.8.7 once the first save has finished, the next one runs", saveCode(second, json::object()) == "saved" && second.saves == 1);
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

// XF Finish Showroom (bridge 0.5): parameter checks (only the showroom's own templates and names), the showroom write class,
// and the place / turn / clear sequences against fake game steps.
void ShowroomTests()
{
    namespace s = xfb::showroom;
    const std::string head = "axefrog\\appearance_studio\\collections\\4426018f6966620881cdcb78569544ab\\showroom\\xfs_showroom.ent";
    const std::string rig = "axefrog\\appearance_studio\\collections\\4426018f6966620881cdcb78569544ab\\showroom\\xfs_showroom_rig.ent";
    const std::string preset = "xfs_p0170d3e01f014a519c3e000000000005";
    const auto item = [&](int aIndex, const std::string& aTemplate, const std::string& aAppearance) {
        return json{{"index", aIndex}, {"template", aTemplate}, {"appearance", aAppearance}, {"label", "Gloss A"},
                    {"x", 100.5}, {"y", 202.0}, {"z", 10.0}, {"yaw", 180.0}};
    };
    const auto place = s::ParsePlace(json{{"items", {item(0, head, preset), item(1, head, "xfs_p0170d3e01f014a519c3e000000000006")}}}, s::Kind::Piece);
    Check("showroom.place parses pieces, replace on by default", place.items.size() == 2 && place.replace && place.items[1].index == 1 &&
                                                                      place.items[0].templatePath == head && place.items[0].yaw == 180.0);
    Check("showroom.place refuses another entity (only the showroom's own head template)",
          ParamsCode([&] { s::ParsePlace(json{{"items", {item(0, "base\\characters\\entities\\player\\player_wa_fpp.ent", preset)}}}, s::Kind::Piece); }) == "bad_params");
    Check("showroom.place refuses the rig template as a head, and a rig name as a preset",
          ParamsCode([&] { s::ParsePlace(json{{"items", {item(0, rig, preset)}}}, s::Kind::Piece); }) == "bad_params" &&
              ParamsCode([&] { s::ParsePlace(json{{"items", {item(0, head, "xfs_rig_key")}}}, s::Kind::Piece); }) == "bad_params");
    Check("showroom.lights accepts the rig and its three profiles, index -1 for V",
          ParamsCode([&] { s::ParsePlace(json{{"items", {item(-1, rig, "xfs_rig_creator"), item(0, rig, "xfs_rig_creator_face"), item(1, rig, "xfs_rig_key")}}}, s::Kind::Rig); }) == "ok");
    Check("showroom.lights refuses an unknown profile", ParamsCode([&] { s::ParsePlace(json{{"items", {item(0, rig, "xfs_rig_disco")}}}, s::Kind::Rig); }) == "bad_params");
    Check("showroom.place refuses a duplicated index, an empty list, 25 pieces and an unknown field",
          ParamsCode([&] { s::ParsePlace(json{{"items", {item(0, head, preset), item(0, head, preset)}}}, s::Kind::Piece); }) == "bad_params" &&
              ParamsCode([&] { s::ParsePlace(json{{"items", json::array()}}, s::Kind::Piece); }) == "bad_params" &&
              ParamsCode([&] {
                  json many = json::array();
                  for (int i = 0; i < 25; ++i)
                  {
                      many.push_back(item(i % 24, head, preset));
                  }
                  s::ParsePlace(json{{"items", many}}, s::Kind::Piece);
              }) == "bad_params" &&
              ParamsCode([&] {
                  auto bad = item(0, head, preset);
                  bad["scale"] = 2;
                  s::ParsePlace(json{{"items", {bad}}}, s::Kind::Piece);
              }) == "bad_params");
    Check("showroom.place refuses a non-finite or out-of-range place and a yaw beyond 360", ParamsCode([&] {
                                                                                               auto bad = item(0, head, preset);
                                                                                               bad["yaw"] = 400;
                                                                                               s::ParsePlace(json{{"items", {bad}}}, s::Kind::Piece);
                                                                                           }) == "bad_params" &&
                                                                                               ParamsCode([&] {
                                                                                                   auto bad = item(0, head, preset);
                                                                                                   bad["z"] = 1e9;
                                                                                                   s::ParsePlace(json{{"items", {bad}}}, s::Kind::Piece);
                                                                                               }) == "bad_params");
    Check("showroom.turn and showroom.clear check their input",
          s::ParseTurn(json::parse(R"({"turns":[{"index":2,"yaw":-45}]})")).at(0).yaw == -45.0 &&
              ParamsCode([] { s::ParseTurn(json::parse(R"({"turns":[{"index":24,"yaw":0}]})")); }) == "bad_params" &&
              s::ParseClear(json::object()) == "all" && s::ParseClear(json::parse(R"({"what":"lights"})")) == "lights" &&
              ParamsCode([] { s::ParseClear(json::parse(R"({"what":"everything"})")); }) == "bad_params");
    Check("the showroom write class is off by default and read from allow_write_classes",
          (xfb::ParseConfig("").writeClasses & xfb::kWriteShowroom) == 0 &&
              (xfb::ParseConfig("[bridge]\nallow_write_classes = photo, showroom\n").writeClasses & xfb::kWriteShowroom) != 0 &&
              xfb::AccessName(xfb::Access::WriteShowroom) == "write-showroom" && xfb::IsWrite(xfb::Access::WriteShowroom) &&
              xfb::WriteClassBit(xfb::Access::WriteShowroom) == xfb::kWriteShowroom);

    // The sequences against fake steps.
    struct Fake
    {
        std::vector<std::string> steps;
        int pendingPolls = 2;
        int failAt = -1;
        int guards = 0;
        s::Ops Ops()
        {
            s::Ops ops;
            ops.guard = [this] { ++guards; };
            ops.spawn = [this](s::Kind, const s::Placement& aItem) {
                if (aItem.index == failAt)
                {
                    throw xfb::MethodError("too_far", "that place is more than 30 m from V");
                }
                steps.push_back("spawn " + std::to_string(aItem.index));
                return json{{"entity", std::to_string(500 + aItem.index)}};
            };
            ops.clear = [this](const std::string& aWhat) {
                steps.push_back("clear " + aWhat);
                return json{{"removed_pieces", 3}, {"removed_lights", 0}};
            };
            ops.turn = [this](int32_t aIndex, double aYaw) {
                steps.push_back("turn " + std::to_string(aIndex));
                return json{{"index", aIndex}, {"previous_yaw", 90.0}, {"yaw", aYaw}};
            };
            ops.status = [this] { return json{{"pending", pendingPolls > 0 ? pendingPolls-- : 0}}; };
            ops.settle = [this] { steps.push_back("settle"); };
            return ops;
        }
    };
    {
        Fake fake;
        const auto out = s::Place(place, fake.Ops());
        Check("showroom.place clears earlier pieces first, spawns each, waits until they are in, and undoes with showroom.clear",
              fake.steps.size() >= 4 && fake.steps[0] == "clear pieces" && fake.steps[1] == "spawn 0" && fake.steps[2] == "spawn 1" &&
                  fake.guards == 3 && out["placed"].size() == 2 && out["placed"][0]["entity"] == "500" &&
                  out["undo"]["method"] == "showroom.clear" && out["undo"]["params"]["what"] == "pieces" && !out.contains("note"),
              xfb::SerializeJson(out));
    }
    {
        Fake fake;
        fake.failAt = 1;
        std::string message;
        try
        {
            s::Place(place, fake.Ops());
        }
        catch (const xfb::MethodError& e)
        {
            message = std::string(e.code) + ": " + e.what();
        }
        Check("a refusal part-way keeps its code and says what was placed and how to remove it",
              message.rfind("too_far", 0) == 0 && message.find("after 1 were placed; showroom.clear removes them") != std::string::npos, message);
    }
    {
        Fake fake;
        fake.pendingPolls = 1000;
        const auto out = s::Place(place, fake.Ops());
        Check("entities still spawning when the wait ends are reported, not refused", out.contains("note"), xfb::SerializeJson(out));
    }
    {
        Fake fake;
        const auto out = s::TurnPieces(s::ParseTurn(json::parse(R"({"turns":[{"index":0,"yaw":30},{"index":1,"yaw":60}]})")), fake.Ops());
        Check("showroom.turn turns each piece and its undo turns them back to their earlier yaws",
              fake.steps.size() == 2 && out["undo"]["method"] == "showroom.turn" && out["undo"]["params"]["turns"].size() == 2 &&
                  out["undo"]["params"]["turns"][0]["yaw"] == 90.0,
              xfb::SerializeJson(out));
        const auto cleared = s::Clear("all", fake.Ops());
        Check("showroom.clear removes everything and says how to place it again", cleared["what"] == "all" && cleared["undo"].is_null(),
              xfb::SerializeJson(cleared));
    }
}

// 0.5.2 (RB-76): the script layer's gate, the dispatcher's game gate on the game thread, and game.status's own
// answer while loading.
std::string GateCode(xfb::ScriptLayer& aLayer, xfb::ScriptLayer::Clock::time_point aNow)
{
    try
    {
        aLayer.Require("test", aNow);
        return "ok";
    }
    catch (const xfb::MethodError& e)
    {
        return e.code;
    }
}

void ScriptLayerTests()
{
    using Clock = xfb::ScriptLayer::Clock;
    const auto t0 = Clock::now();
    xfb::ScriptLayer layer;
    Check("0.5.2 (RB-76): no script calls before the script layer attaches (the game starting)",
          !layer.Ready(t0) && GateCode(layer, t0) == "game_loading" && layer.Phase(t0) == "starting");
    layer.OnAttach(t0);
    Check("0.5.2 (RB-76): attached but no player yet (a save loading) still refuses",
          !layer.Ready(t0) && GateCode(layer, t0) == "game_loading" && layer.Phase(t0) == "loading");
    layer.OnPlayerAttach(t0);
    Check("0.5.2 (RB-76): the player attached: script calls allowed", layer.Ready(t0) && GateCode(layer, t0) == "ok");
    layer.OnDetach(t0);
    Check("0.5.2 (RB-76): a detach (session 5's crash moment) closes the gate at once",
          !layer.Ready(t0) && GateCode(layer, t0) == "game_loading" && layer.Describe(t0)["state"] == "detached");
    Check("0.5.2 (RB-76): the detach is counted once for the plugin's tick (it drops an owed save relock)",
          layer.TakeDetaches() == 1 && layer.TakeDetaches() == 0);
    layer.OnPlayerAttach(t0);
    Check("0.5.2 (RB-76): a player attach without the system's attach (out of order) keeps the gate closed", !layer.Ready(t0));
    layer.OnAttach(t0);
    layer.OnPlayerAttach(t0);
    Check("0.5.2 (RB-76): attach then player attach opens it again", layer.Ready(t0));
    layer.OnLoadRequested(t0);
    Check("0.5.2 (RB-76): game.load closes the gate before the game detaches",
          !layer.Ready(t0 + 1s) && layer.Describe(t0 + 1s)["load_pending"] == true);
    layer.OnDetach(t0 + 2s);
    Check("0.5.2 (RB-76): the load's detach clears the pending load; the gate stays closed until the new player",
          !layer.Ready(t0 + 2s) && layer.Describe(t0 + 2s)["load_pending"] == false);
    layer.OnAttach(t0 + 3s);
    layer.OnPlayerAttach(t0 + 20s);
    Check("0.5.2 (RB-76): the loaded session's player opens it", layer.Ready(t0 + 20s));
    layer.OnLoadRequested(t0 + 30s);
    Check("0.5.2 (RB-76): a requested load that never detaches reopens the gate after the timeout",
          !layer.Ready(t0 + 30s + xfb::ScriptLayer::kLoadStartTimeout - 1s) && layer.Ready(t0 + 30s + xfb::ScriptLayer::kLoadStartTimeout + 1s));
    Check("0.5.2 (RB-76): unknown events are ignored", !layer.OnEvent("reload", t0) && layer.Ready(t0 + 90s));

    const auto loading = xfb::writes::StatusWhileLoading("loading", layer.Describe());
    Check("0.5.2 (RB-76): game.status while loading answers from the plugin: phase loading, no photo mode, no player",
          loading["phase"] == "loading" && loading["answered_by"] == "plugin" && loading["photo_mode_can_open"] == false &&
              loading["player_present"] == false && loading.contains("script_layer"));

    // The dispatcher's game gate runs on the game thread right before the task, not when it was queued.
    xfb::GameThreadQueue queue;
    queue.SetPumping(true);
    xfb::ScriptLayer gateLayer;
    gateLayer.OnAttach();
    gateLayer.OnPlayerAttach();
    std::atomic<bool> detachFirst{false};
    std::atomic<int> ran{0};
    xfb::SetGameGate([&](const std::string& aWhat) {
        if (detachFirst.exchange(false))
        {
            gateLayer.OnDetach(); // the game detached between the queueing and the task (session 5)
        }
        gateLayer.Require(aWhat);
    });
    std::atomic<bool> stop{false};
    std::thread pump([&] {
        while (!stop.load())
        {
            queue.Drain(4);
            std::this_thread::sleep_for(2ms);
        }
    });
    std::string code = "ok";
    try
    {
        xfb::RunGameTask(queue, 1000ms, [&] { ++ran; return json::object(); }, "unit.gated");
    }
    catch (const xfb::MethodError& e)
    {
        code = e.code;
    }
    Check("0.5.2 (RB-76): a gated game-thread step runs while the session is up", code == "ok" && ran.load() == 1);
    detachFirst.store(true);
    code = "ok";
    try
    {
        xfb::RunGameTask(queue, 1000ms, [&] { ++ran; return json::object(); }, "unit.gated");
    }
    catch (const xfb::MethodError& e)
    {
        code = e.code;
    }
    Check("0.5.2 (RB-76): a step queued before a detach and run after it is refused game_loading and never runs",
          code == "game_loading" && ran.load() == 1);
    json answer;
    try
    {
        answer = xfb::RunGameTask(
            queue, 1000ms,
            [&] { return gateLayer.Ready() ? json{{"phase", "gameplay"}} : xfb::writes::StatusWhileLoading(gateLayer.Phase(), gateLayer.Describe()); },
            "unit.status", false);
    }
    catch (const xfb::MethodError& e)
    {
        answer = json{{"error", e.code}};
    }
    Check("0.5.2 (RB-76): an ungated step (game.status) decides for itself and answers loading", answer.value("phase", "") == "loading");
    stop.store(true);
    pump.join();
    xfb::SetGameGate({});
}

// 0.5.2: the wardrobe's parameters, what counts as the change having shown, the undo, and inventory.equip's
// outfit note; and photo.camera.set's exposure.
void WardrobeTests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    const auto parse = [](const char* aText) { return p::ParseWardrobeEquip(json::parse(aText)); };
    Check("0.5.2 wardrobe.equip: one change at a time (set, clear, item, area with show, restore)",
          parse(R"({"set":3})").mode == "set" && parse(R"({"clear":true})").mode == "clear" &&
              parse(R"({"item":"Items.Helmet_01_basic_01"})").mode == "item" && parse(R"({"area":"Head","show":"hidden"})").mode == "hidden" &&
              parse(R"({"restore":{"set":0}})").mode == "restore" &&
              ParamsCode([&] { parse(R"({"set":1,"clear":true})"); }) == "bad_params" &&
              ParamsCode([&] { parse("{}"); }) == "bad_params");
    Check("0.5.2 wardrobe.equip: bounds (outfits 1-7, clear only true, show needs an area, no Outfit area, a slot once)",
          ParamsCode([&] { parse(R"({"set":8})"); }) == "bad_params" && ParamsCode([&] { parse(R"({"set":0})"); }) == "bad_params" &&
              ParamsCode([&] { parse(R"({"clear":false})"); }) == "bad_params" &&
              ParamsCode([&] { parse(R"({"show":"equipped"})"); }) == "bad_params" &&
              ParamsCode([&] { parse(R"({"area":"Outfit","show":"hidden"})"); }) == "bad_params" &&
              ParamsCode([&] { parse(R"({"restore":{"set":1,"slots":[{"area":"Head"},{"area":"Head"}]}})"); }) == "bad_params");
    const auto restore = parse(R"({"restore":{"set":2,"slots":[{"area":"Head","item":"","hidden":true},{"area":"OuterChest","item":"Items.Jacket_01_basic_01","hidden":false}]}})");
    Check("0.5.2 wardrobe.equip: a restore keeps every area as given (an empty item is no outfit item)",
          restore.set == 2 && restore.slots.size() == 2 && restore.slots[0].item.empty() && restore.slots[0].hidden &&
              restore.slots[1].item == "Items.Jacket_01_basic_01");

    const json state{{"set", 2},
                     {"areas",
                      {{{"area", "Head"}, {"shows", "hidden"}, {"outfit_item", ""}, {"hidden", true}},
                       {{"area", "OuterChest"}, {"shows", "outfit"}, {"outfit_item", "Items.Jacket_01_basic_01"}, {"hidden", false}},
                       {{"area", "Legs"}, {"shows", "equipped"}, {"outfit_item", ""}, {"hidden", false}}}}};
    Check("0.5.2 wardrobe: the change has shown when the reading agrees (set, item, hidden, equipped, restore)",
          w::WardrobeShows(parse(R"({"set":2})"), state) && !w::WardrobeShows(parse(R"({"set":1})"), state) &&
              !w::WardrobeShows(parse(R"({"clear":true})"), state) &&
              w::WardrobeShows(parse(R"({"item":"Items.Jacket_01_basic_01"})"), state) &&
              w::WardrobeShows(parse(R"({"area":"Head","show":"hidden"})"), state) &&
              w::WardrobeShows(parse(R"({"area":"Legs","show":"equipped"})"), state) && w::WardrobeShows(restore, state));

    w::WardrobeOps ops;
    int settles = 0;
    ops.change = [] { return json{{"changed", true}, {"before", {{"set", 0}, {"slots", json::array()}}}}; };
    ops.state = [&] { return settles >= 2 ? state : json{{"set", 0}, {"areas", json::array()}}; };
    ops.settle = [&] { ++settles; };
    const auto out = w::WardrobeEquip(parse(R"({"set":2})"), ops);
    Check("0.5.2 wardrobe.equip waits until the outfit shows, and its undo restores the snapshot exactly",
          out["shown"] == true && settles == 2 &&
              out["undo"] == json{{"method", "wardrobe.equip"}, {"params", {{"restore", {{"set", 0}, {"slots", json::array()}}}}}}, out.dump());
    ops.change = [] { return json{{"changed", false}, {"before", {{"set", 0}}}}; };
    const auto noop = w::WardrobeEquip(parse(R"({"clear":true})"), ops);
    Check("0.5.2 wardrobe.equip clear with no outfit is a no-op with no undo", noop["changed"] == false && noop["undo"].is_null());

    w::InventoryOps inventory;
    inventory.equip = [] {
        return json{{"item", "Items.Helmet_01_basic_01"}, {"slot", "Head"}, {"added", true}, {"already_equipped", false}, {"previous", ""},
                    {"outfit", {{"set", 1}, {"area", "Head"}, {"shows", "hidden"}, {"outfit_item", ""}}}};
    };
    inventory.slot = [](const std::string&, const std::string&, const std::string&) { return json{{"slot", "Head"}, {"item", "Items.Helmet_01_basic_01"}, {"matches", true}}; };
    inventory.settle = [] {};
    const auto equipped = w::InventoryEquip(p::ParseInventoryEquip(json::parse(R"({"item":"Items.Helmet_01_basic_01","add_if_missing":true})")), inventory);
    Check("0.5.2 inventory.equip says when an active outfit hides the equipped item (sessions 4 and 5's helmet)",
          equipped["equipped"] == true && equipped["hidden_by_outfit"] == true && equipped["outfit"]["shows"] == "hidden" &&
              equipped["outfit_note"].get<std::string>().find("wardrobe.equip") != std::string::npos, equipped.dump());

    const auto camera = p::ParseCamera(json::parse(R"({"exposure":1.5,"contrast":0.2})"));
    Check("0.5.2 photo.camera.set takes exposure (menu 10) and contrast (11), named for the undo",
          camera.attributes.size() == 2 && camera.attributes[0].key == 10 && camera.attributes[0].name == "exposure" &&
              camera.attributes[1].key == 11 && p::CameraParamName(10) == "exposure");
}

// Bridge 0.5.3, TEMPORARY TEST FEATURES (core/InkUi.hpp): the ink HUD panel's settings and frame, and world.pin's checks.
void InkUiTests()
{
    namespace k = xfb::inkui;
    k::HudPanel panel;
    k::HudSettings defaults;
    defaults.show = false; // [ui] hud_panel = false
    panel.SetDefaults(defaults);
    Check("ui.hud starts from [ui] in config.ini", !panel.Current().show && panel.Current().cetLabel && panel.Current().nameplates);
    const auto read = panel.Configure(json::object());
    Check("ui.hud with no values only reads (changed false, no undo)", read["changed"] == false && read["undo"].is_null());
    const auto moved = panel.Configure(json{{"show", true}, {"anchor", "bottom_left"}, {"x", 40}, {"y", -20.5}, {"scale", 1.5}});
    Check("ui.hud shows and moves the panel; its undo puts back the earlier settings",
          moved["changed"] == true && moved["settings"]["anchor"] == "bottom_left" && moved["settings"]["y"] == -20.5 &&
              moved["undo"]["method"] == "ui.hud" && moved["undo"]["params"]["show"] == false && moved["undo"]["params"]["anchor"] == "top_left");
    panel.Configure(moved["undo"]["params"]);
    Check("ui.hud's undo, replayed, restores exactly the earlier settings", k::ToJson(panel.Current()) == k::ToJson(defaults));
    Check("ui.hud refuses an unknown anchor, layer, scale out of range, a non-boolean, an unknown key",
          ParamsCode([&] { panel.Configure(json{{"anchor", "middle"}}); }) == "bad_params" &&
              ParamsCode([&] { panel.Configure(json{{"layer", "menu"}}); }) == "bad_params" &&
              ParamsCode([&] { panel.Configure(json{{"scale", 9}}); }) == "bad_params" &&
              ParamsCode([&] { panel.Configure(json{{"show", "yes"}}); }) == "bad_params" &&
              ParamsCode([&] { panel.Configure(json{{"colour", "red"}}); }) == "bad_params");
    panel.Configure(json{{"show", true}, {"cet_label", false}});
    Check("ui.hud reset goes back to the configured panel, and can't be combined with values",
          panel.Configure(json{{"reset", true}})["settings"] == k::ToJson(defaults) &&
              ParamsCode([&] { panel.Configure(json{{"reset", true}, {"x", 3}}); }) == "bad_params");

    k::BridgeView view;
    view.pluginEnabled = true;
    view.listening = true;
    view.allowWrites = true;
    view.hasClient = true;
    view.scriptReady = true;
    Check("the status line: changes allowed (write), paused, read-only (ok), killed, off",
          k::Summarize(view).tone == "write" && [&] {
              auto paused = view;
              paused.writesPaused = true;
              auto read = view;
              read.allowWrites = false;
              auto killed = view;
              killed.killed = true;
              auto off = view;
              off.pluginEnabled = false;
              return k::Summarize(paused).tone == "paused" && k::Summarize(read).tone == "ok" && k::Summarize(killed).tone == "killed" &&
                     k::Summarize(off).tone == "off";
          }());
    k::HudSettings shown;
    const std::vector<k::MessageLine> lines{{"ask", "Press\tthe photo-mode key\nnow"}, {"done", "Captured"}};
    const auto frame = k::Frame(shown, view, lines);
    const auto parsed = k::ParseFrame(frame);
    Check("the frame starts with its version and carries settings, gate, tone and message lines",
          frame.rfind("xfhud\t1\n", 0) == 0 && parsed["version"] == 1 && parsed["show"] == true && parsed["anchor"] == "top_left" &&
              parsed["x"] == 40.0 && parsed["y"] == 360.0 && parsed["live"] == true && parsed["tone"] == "write" && parsed["messages"].size() == 2 &&
              parsed["messages"][0]["level"] == "ask");
    Check("message text never breaks the frame (tabs and newlines become spaces)",
          parsed["messages"][0]["text"] == "Press the photo-mode key now");
    auto killed = view;
    killed.killed = true;
    const auto killedFrame = k::ParseFrame(k::Frame(shown, killed, lines));
    Check("a killed bridge's frame shows its state and no messages", killedFrame["tone"] == "killed" && killedFrame["messages"].empty());
    auto disabled = view;
    disabled.pluginEnabled = false;
    const auto offFrame = k::ParseFrame(k::Frame(shown, disabled, {}));
    Check("with the bridge switched off the panel and nameplates are hidden", offFrame["show"] == false && offFrame["nameplates"] == false);
    auto loading = view;
    loading.scriptReady = false;
    Check("while the script gate is closed the frame says live 0 (the overlay skips world queries)",
          k::ParseFrame(k::Frame(shown, loading, {}))["live"] == false);

    const auto atPoint = k::ParsePin(json{{"position", {-1200.5, 300.0, 12.0}}, {"label", "  XF   test\npin  "}});
    Check("world.pin at a world point: label cleaned to one line, variant custom, no lift",
          atPoint.target == k::PinRequest::Target::Position && atPoint.label == "XF test pin" && atPoint.variant == "custom" &&
              atPoint.lift == 0.0 && atPoint.x == -1200.5);
    const auto onPiece = k::ParsePin(json{{"piece", 3}, {"label", "Gloss A"}, {"variant", "clothes"}});
    Check("world.pin on a showroom head: at its crown, 0.12 m above its eyes, by default (0.8.4)", onPiece.target == k::PinRequest::Target::Piece && onPiece.piece == 3 &&
                                                                           onPiece.lift == 0.12 && onPiece.variant == "clothes");
    Check("world.pin above V", k::ParsePin(json{{"at", "v"}, {"label", "V"}, {"lift_m", 1.0}}).lift == 1.0);
    const std::string longLabel(80, 'x');
    Check("world.pin cuts a long label to 48 characters (0.8: the last one an ellipsis)",
          k::ParsePin(json{{"at", "v"}, {"label", longLabel}}).label == std::string(47, 'x') + "\xE2\x80\xA6");
    Check("world.pin refuses no target, two targets, a bad position, a piece out of range, an empty label, an unknown variant",
          ParamsCode([&] { k::ParsePin(json{{"label", "x"}}); }) == "bad_params" &&
              ParamsCode([&] { k::ParsePin(json{{"at", "v"}, {"piece", 1}, {"label", "x"}}); }) == "bad_params" &&
              ParamsCode([&] { k::ParsePin(json{{"position", {1, 2}}, {"label", "x"}}); }) == "bad_params" &&
              ParamsCode([&] { k::ParsePin(json{{"position", {1, 2, 99999}}, {"label", "x"}}); }) == "bad_params" &&
              ParamsCode([&] { k::ParsePin(json{{"piece", 24}, {"label", "x"}}); }) == "bad_params" &&
              ParamsCode([&] { k::ParsePin(json{{"at", "v"}, {"label", " \t "}}); }) == "bad_params" &&
              ParamsCode([&] { k::ParsePin(json{{"at", "v"}, {"label", "x"}, {"variant", "fast_travel"}}); }) == "bad_params");
    Check("world.pin.clear: no id clears all, an id one; a bad id is refused",
          k::ParsePinClear(json::object()) == -1 && k::ParsePinClear(json{{"id", 4}}) == 4 &&
              ParamsCode([&] { k::ParsePinClear(json{{"id", 0}}); }) == "bad_params");
}

// Bridge 0.6: the wardrobe's managers, the session event stream, scene.read's parameters, behaviours' pure pieces and runner,
// player control's parameters and steps, the new write classes and the handover.
void Bridge060Tests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    namespace b = xfb::behave;
    namespace pl = xfb::player;
    const auto parse = [](const char* aText) { return p::ParseWardrobeEquip(json::parse(aText)); };

    // The wardrobe: suspend and resume, a restore with no outfit, a script outfit's parts.
    Check("0.6 wardrobe.equip: suspend and resume are changes of their own, true only",
          parse(R"({"suspend":true})").mode == "suspend" && parse(R"({"resume":true})").mode == "resume" &&
              ParamsCode([&] { parse(R"({"suspend":false})"); }) == "bad_params" &&
              ParamsCode([&] { parse(R"({"suspend":true,"resume":true})"); }) == "bad_params");
    Check("0.6 wardrobe: suspend has shown once no outfit decides; resume once one does again",
          w::WardrobeShows(parse(R"({"suspend":true})"), json{{"set", 0}, {"manager", "none"}}) &&
              !w::WardrobeShows(parse(R"({"suspend":true})"), json{{"set", 0}, {"manager", "script"}}) &&
              w::WardrobeShows(parse(R"({"resume":true})"), json{{"set", 0}, {"manager", "script"}}));
    const json noOutfit{{"set", 0}, {"manager", "none"}, {"areas", {{{"area", "Head"}, {"shows", "equipped"}, {"outfit_item", ""}, {"hidden", false}}}}};
    Check("0.6 wardrobe: a restore with no outfit (set 0) compares each area's hidden flag (session 6's T9)",
          !w::WardrobeShows(parse(R"({"restore":{"set":0,"slots":[{"area":"Head","item":"","hidden":true}]}})"), noOutfit) &&
              w::WardrobeShows(parse(R"({"restore":{"set":0,"slots":[{"area":"Head","item":"","hidden":false}]}})"), noOutfit));
    const auto scripted = parse(R"({"restore":{"set":0,"slots":[],"script_outfit":{"active":true,"parts":[{"slot":"OutfitSlots.Head","item":"Items.Cap_01_basic_01"}]}}})");
    Check("0.6 wardrobe.equip: a restore carries a script outfit's parts", scripted.scriptKnown && scripted.scriptActive && scripted.parts.size() == 1 &&
                                                                             scripted.parts[0].slot == "OutfitSlots.Head");
    const json eex{{"set", 0}, {"manager", "script"}, {"script_outfit", {{"active", true}, {"parts", {{{"slot", "OutfitSlots.Head"}, {"item", "Items.Cap_01_basic_01"}}}}}}};
    Check("0.6 wardrobe: a script outfit's restore has shown with exactly its parts; an item shows among them",
          w::WardrobeShows(scripted, eex) &&
              !w::WardrobeShows(parse(R"({"restore":{"set":0,"script_outfit":{"active":true,"parts":[]}}})"), eex) &&
              w::WardrobeShows(parse(R"({"item":"Items.Cap_01_basic_01"})"), eex));
    Check("0.6 wardrobe.equip: script outfit parts are record names, each slot once",
          ParamsCode([&] { parse(R"({"restore":{"set":0,"script_outfit":{"active":true,"parts":[{"slot":"x","item":"Items.A"}]}}})"); }) == "bad_params" &&
              ParamsCode([&] { parse(R"({"restore":{"set":0,"script_outfit":{"active":true,"parts":[{"slot":"S.A","item":"Items.A"},{"slot":"S.A","item":"Items.B"}]}}})"); }) == "bad_params");
    w::WardrobeOps ops;
    ops.change = [] { return json{{"changed", true}, {"manager_before", "script"}, {"before", {{"set", 0}}}}; };
    ops.state = [] { return json{{"set", 0}, {"manager", "none"}}; };
    ops.settle = [] {};
    const auto suspended = w::WardrobeEquip(parse(R"({"suspend":true})"), ops);
    Check("0.6 wardrobe.equip {suspend}: shown, and the undo is resume", suspended.value("shown", false) &&
                                                                        suspended["undo"]["params"].value("resume", false) &&
                                                                        suspended.value("manager_before", std::string()) == "script");

    // The session event stream.
    {
        xfb::EventLog log;
        for (int i = 0; i < static_cast<int>(xfb::EventLog::kMaxEvents) + 5; ++i)
        {
            log.Push(i % 2 ? "write" : "note", "info", "test", "event " + std::to_string(i));
        }
        const auto read = log.Read(0, 10);
        Check("0.6 events: a ring of kMaxEvents; a reader from 0 is told how many it missed",
              read["dropped"].get<uint64_t>() == 5 && read["events"].size() == 10 && read["events"][0]["seq"].get<uint64_t>() == 6);
        const auto notes = log.Read(0, 500, {"note"});
        Check("0.6 events: kinds filter, and next moves past what was skipped",
              std::all_of(notes["events"].begin(), notes["events"].end(), [](const json& e) { return e["kind"] == "note"; }) &&
                  notes["next"].get<uint64_t>() >= notes["events"].back()["seq"].get<uint64_t>());
        const auto seq = log.Push("note", "warn", "game", std::string("line\none\xFF"), json{{"big", std::string(5000, 'x')}});
        const auto last = log.Read(seq - 1, 1)["events"][0];
        Check("0.6 events: text cleaned to one valid line, oversized data cut", last["text"] == "line one\xEF\xBF\xBD" && last["data"].value("cut", false));
        Check("0.6 session.events / session.note parameters",
              ParamsCode([] { xfb::ParseEventsRequest(json{{"limit", 0}}); }) == "bad_params" &&
                  ParamsCode([] { xfb::ParseNoteRequest(json::object()); }) == "bad_params" &&
                  ParamsCode([] { xfb::ParseNoteRequest(json{{"text", "x"}, {"level", "shout"}}); }) == "bad_params" &&
                  xfb::ParseEventsRequest(json{{"kinds", {"note"}}}).kinds.size() == 1);
    }

    // scene.read's parameters.
    {
        namespace s = xfb::scene;
        const auto read = s::ParseRead(json{{"parts", {"camera", "npcs", "camera"}}, {"points", {{1, 2, 3}}}});
        Check("0.6 scene.read: parts once each, points, defaults", read.parts.size() == 2 && read.points.size() == 1 && read.radius == 20.0f &&
                                                                 read.maxNpcs == 8 && read.occlusion && s::PartsText(read) == "camera,npcs");
        Check("0.6 scene.read: refusals (unknown part, too many points, bad point, radius)",
              ParamsCode([] { s::ParseRead(json{{"parts", {"sky"}}}); }) == "bad_params" &&
                  ParamsCode([] { s::ParseRead(json{{"points", json::array({json::array({1, 2})})}}); }) == "bad_params" &&
                  ParamsCode([] { s::ParseRead(json{{"radius", 61}}); }) == "bad_params" &&
                  ParamsCode([] {
                      json many = json::array();
                      for (int i = 0; i < 33; ++i)
                      {
                          many.push_back({0, 0, 0});
                      }
                      s::ParseRead(json{{"points", many}});
                  }) == "bad_params");
    }

    // Behaviours: the pure pieces.
    {
        double length = 0.0;
        const auto [at, heading] = b::AlongPath({{0, 0, 0}, {0, 2, 0}, {2, 2, 0}}, 3.0, length);
        Check("0.6 behave: a point along a path and its heading", length == 4.0 && std::abs(at[0] - 1.0) < 1e-9 && std::abs(at[1] - 2.0) < 1e-9 &&
                                                                  std::abs(heading - (-90.0)) < 1e-9);
        Check("0.6 behave: yaw 0 faces +Y, 90 faces -X", std::abs(b::YawFacing(0, 1)) < 1e-9 && std::abs(b::YawFacing(-1, 0) - 90.0) < 1e-9);
        const auto eyes = b::ToWorld({10, 20, 0}, 90.0, {0, 1, 1.5});
        Check("0.6 behave: an entity-frame point in the world (turned 90 degrees)", std::abs(eyes[0] - 9.0) < 1e-9 && std::abs(eyes[1] - 20.0) < 1e-9);
        const json camera{{"position", {0, 0, 1}}, {"forward", {0, 1, 0}}, {"right", {1, 0, 0}}, {"up", {0, 0, 1}}, {"fov", 60.0}};
        const auto centre = b::OnCameraRay(camera, 2.0, 0.0, 0.0);
        const auto above = b::OnCameraRay(camera, 2.0, 0.0, -0.5);
        Check("0.6 behave: a point on the camera ray (centre exact; the frame's top edge at half the vertical field of view)",
              std::abs(centre[1] - 2.0) < 1e-9 && std::abs(centre[2] - 1.0) < 1e-9 &&
                  std::abs(std::atan2(above[2] - 1.0, above[1]) * 180.0 / 3.14159265358979 - 30.0) < 1e-6);
        const auto start = b::StartParams("turntable", json{{"deg_per_s", 45}, {"max_s", 5}});
        Check("0.6 behave: a command's input becomes {kind, params, max_s}", start["kind"] == "turntable" && start["params"]["deg_per_s"] == 45 &&
                                                                          start["max_s"] == 5 && !start["params"].contains("max_s"));
    }

    // Behaviours: the runner against fake game steps.
    {
        b::Runner runner;
        xfb::EventLog events;
        runner.SetEvents(&events);
        std::vector<std::pair<int, double>> turns;
        b::Ops fake;
        fake.showroom = [] {
            json piece = json::object();
            piece["index"] = 0;
            piece["position"] = json::array({0, 0, 0});
            piece["yaw"] = 10.0;
            json out = json::object();
            out["pieces"] = json::array({piece});
            return out;
        };
        fake.place = [&](const std::string&, int32_t aIndex, const b::Vec3&, double aYaw) { turns.push_back({aIndex, aYaw}); };
        std::vector<xfb::Access> asked;
        const auto allow = [&](xfb::Access aAccess) { asked.push_back(aAccess); };
        const auto started = runner.Start(b::StartParams("turntable", json{{"deg_per_s", 90}, {"revolutions", 0.25}, {"every_ticks", 1}}), allow);
        Check("0.6 behave.turntable: starts under the showroom class", started["write_class"] == "write-showroom" && asked.size() == 1 &&
                                                                     asked[0] == xfb::Access::WriteShowroom);
        for (int i = 0; i < 20 && runner.Active(); ++i)
        {
            runner.Tick(0.1, fake, true);
        }
        Check("0.6 behave.turntable: turns at its rate, stops after a quarter turn, then turns the head back",
              !runner.Active() && turns.size() >= 3 && std::abs(turns.back().second - 10.0) < 1e-9 && std::abs(turns[1].second - 28.0) < 1e-6);
        const auto stopEvent = events.Read(0, 100, {"behaviour"})["events"].back();
        Check("0.6 behave: the stop is an event with its reason", stopEvent["data"].value("reason", std::string()) == "done");

        turns.clear();
        runner.Start(b::StartParams("turntable", json{{"deg_per_s", 30}}), allow);
        runner.Tick(0.1, fake, true);
        runner.Tick(0.1, fake, false); // the script gate closed: nothing happens
        const auto during = turns.size();
        runner.StopAll("kill_switch");
        runner.Tick(0.1, fake, true);
        Check("0.6 behave: a closed gate pauses; the kill switch stops it through its stop step (turned back)",
              !runner.Active() && turns.size() == during + 1 && std::abs(turns.back().second - 10.0) < 1e-9);

        runner.Start(b::StartParams("turntable", json{{"deg_per_s", 30}}), allow);
        runner.Tick(0.1, fake, true);
        const auto beforeDrop = turns.size();
        runner.DropAll("session_detached");
        Check("0.6 behave: a detach drops behaviours without a game call", !runner.Active() && turns.size() == beforeDrop);

        Check("0.6 behave: refusals (unknown kind, zero rate, look without a target, keep_framed piece without its index)",
              ParamsCode([&] { runner.Start(json{{"kind", "dance"}}, allow); }) == "bad_params" &&
                  ParamsCode([&] { runner.Start(b::StartParams("turntable", json{{"deg_per_s", 0}}), allow); }) == "bad_params" &&
                  ParamsCode([&] { runner.Start(b::StartParams("look", json::object()), allow); }) == "bad_params" &&
                  ParamsCode([&] { runner.Start(b::StartParams("keep_framed", json{{"subject", "piece"}}), allow); }) == "bad_params");
        asked.clear();
        runner.Start(b::StartParams("keep_framed", json{{"piece", 0}}), allow);
        Check("0.6 behave.keep_framed on a head needs the photo and showroom classes", asked.size() == 2 && asked[0] == xfb::Access::WritePhoto &&
                                                                                      asked[1] == xfb::Access::WriteShowroom);
        runner.StopAll("test");
        runner.Tick(0.1, fake, true);
        const auto refuseClass = [](xfb::Access) { throw xfb::MethodError("write_class_disabled", "off"); };
        Check("0.6 behave: a write class that is off refuses the start", ParamsCode([&] { runner.Start(b::StartParams("look", json{{"yaw", 10}}), refuseClass); }) ==
                                                                          "write_class_disabled");
        for (int i = 0; i < 4; ++i)
        {
            runner.Start(b::StartParams("keep_framed", json{{"piece", i}}), allow);
        }
        Check("0.6 behave: at most four at once; the same target replaces", ParamsCode([&] { runner.Start(b::StartParams("keep_framed", json{{"piece", 5}}), allow); }) ==
                                                                              "behaviour_limit" &&
                                                                          ParamsCode([&] { runner.Start(b::StartParams("keep_framed", json{{"piece", 1}}), allow); }) == "ok");
        runner.DropAll("test");
    }

    // Player control's parameters and steps.
    {
        const auto offset = pl::ParseTeleport(json{{"offset", {{"forward", 2.0}}}, {"turn", 90.0}});
        const auto [to, yaw] = pl::Destination(offset, {100, 200, 10}, 0.0);
        Check("0.6 player.teleport: an offset along V's facing and a relative turn", std::abs(to[1] - 202.0) < 1e-9 && std::abs(to[0] - 100.0) < 1e-9 && yaw && std::abs(*yaw - 90.0) < 1e-9);
        const auto [to2, yaw2] = pl::Destination(pl::ParseTeleport(json{{"offset", {{"forward", 1.0}}}}), {0, 0, 0}, 90.0);
        Check("0.6 player.teleport: facing 90 means forward is -X", std::abs(to2[0] + 1.0) < 1e-9 && !yaw2);
        Check("0.6 player.teleport: refusals (nothing given, position and offset, yaw and turn, a bad ground)",
              ParamsCode([] { pl::ParseTeleport(json::object()); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseTeleport(json{{"position", {1, 2, 3}}, {"offset", {{"forward", 1}}}}); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseTeleport(json{{"yaw", 1}, {"turn", 2}}); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseTeleport(json{{"yaw", 1}, {"ground", "air"}}); }) == "bad_params" &&
                  pl::ParseTeleport(json{{"yaw", 1}, {"ground", "exact"}, {"far", true}}).exact);
        const auto look = pl::LookTargetFor(pl::ParseLook(json{{"yaw", 30}, {"pitch", -10}, {"relative", true}}), {0, 0, 0}, 10.0, 5.0);
        Check("0.6 player.look: relative angles add to the view, the point 10 m along it", std::abs(look.yaw - 40.0) < 1e-9 && std::abs(look.pitch + 5.0) < 1e-9 &&
                                                                                        std::abs(std::hypot(look.point[0], look.point[1], look.point[2]) - 10.0) < 1e-9);
        Check("0.6 player.look: refusals (nothing, at with angles, a steep absolute pitch, a bad mode)",
              ParamsCode([] { pl::ParseLook(json::object()); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseLook(json{{"at", {1, 2, 3}}, {"yaw", 1}}); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseLook(json{{"pitch", 89}}); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseLook(json{{"yaw", 1}, {"mode", "fast"}}); }) == "bad_params");
        const auto crouch = pl::ParseAction(json{{"name", "crouch"}});
        const auto menu = pl::ParseAction(json{{"name", "menu.open"}, {"menu", "map"}});
        Check("0.6 player.action: crouch undoes with stand, a menu with menu.close; weapon.slot and menu.open need their argument",
              crouch.undo["params"]["name"] == "stand" && menu.name == "menu.map" && menu.undo["params"]["name"] == "menu.close" &&
                  ParamsCode([] { pl::ParseAction(json{{"name", "weapon.slot"}}); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseAction(json{{"name", "menu.open"}, {"menu", "pause"}}); }) == "bad_params" &&
                  ParamsCode([] { pl::ParseAction(json{{"name", "jump"}}); }) == "bad_params");
        pl::TeleportPacer pacer;
        pacer.Take();
        pacer.Take();
        Check("0.6 player.teleport: at most two a second", ParamsCode([&] { pacer.Take(); }) == "rate_limited");
    }

    // The new write classes and the handover.
    {
        const auto config = xfb::ParseConfig("[bridge]\nallow_write_classes = photo, player, act\n");
        Check("0.6 allow_write_classes knows player and act", (config.writeClasses & xfb::kWritePlayer) && (config.writeClasses & xfb::kActPlayer) &&
                                                             xfb::WriteClassList(config).size() == 3);
        Check("0.6 access names for the player classes", xfb::AccessName(xfb::Access::WritePlayer) == "write-player" &&
                                                         xfb::ConfigClassName(xfb::Access::ActPlayer) == "act");
        xfb::Config open;
        open.allowWrites = true;
        open.writeClasses = xfb::kWritePhoto;
        xfb::Session session;
        session.token = "t";
        xfb::GameThreadQueue queue;
        xfb::Dispatcher dispatcher(open, session, queue);
        std::vector<std::string> kinds;
        std::vector<std::string> texts;
        dispatcher.SetEventSink([&](const std::string& aKind, const std::string&, const std::string& aText, const json&) {
            kinds.push_back(aKind);
            texts.push_back(aText);
        });
        dispatcher.Register({"t.write", xfb::Access::WritePhoto, xfb::RunOn::BridgeThread, "", [](const xfb::MethodContext&) { return json{{"undo", nullptr}}; }});
        const auto request = R"({"v":1,"id":1,"token":"t","method":"t.write"})";
        const auto ok = json::parse(dispatcher.Handle(request, 1).line);
        dispatcher.SetHandover(true, "test");
        const auto refused = json::parse(dispatcher.Handle(request, 1).line);
        dispatcher.SetHandover(false);
        const auto again = json::parse(dispatcher.Handle(request, 1).line);
        Check("0.6 handover: writes refused handed_over until resumed; every write, refusal and handover is an event",
              ok.value("ok", false) && refused["error"]["code"] == "handed_over" && again.value("ok", false) &&
                  std::find(kinds.begin(), kinds.end(), "handover") != kinds.end() && std::find(kinds.begin(), kinds.end(), "resume") != kinds.end() &&
                  std::count(kinds.begin(), kinds.end(), "write") == 2 && std::count(kinds.begin(), kinds.end(), "refused") == 1);
        {
            // 0.8.22 (Borg 4): the handover's reason travels with every refusal and its event, and a resume clears it.
            const std::string why = "handed over by the commit tripwire (free commit 3.4 GB under 4 GB)";
            dispatcher.SetHandover(true, why);
            dispatcher.SetHandover(true); // a second handover without a note keeps the first reason
            const auto withWhy = json::parse(dispatcher.Handle(request, 1).line);
            const bool eventSays = !texts.empty() && texts.back().find(why) != std::string::npos;
            const auto thrown = ParamsCode([&] { dispatcher.RequireWritesOpen(); });
            dispatcher.SetHandover(false);
            Check("0.8.22 handover: the reason is in the refusal, its event and the note until resume",
                  withWhy["error"]["code"] == "handed_over" && withWhy["error"]["message"].get<std::string>().find(why) != std::string::npos &&
                      eventSays && thrown == "handed_over" && dispatcher.HandoverNote().empty(),
                  withWhy.dump());
        }
        Check("0.6 RequireWriteClass: a class that is off is refused", ParamsCode([&] { dispatcher.RequireWriteClass(xfb::Access::WritePlayer); }) ==
                                                                      "write_class_disabled");
    }
}

// Bridge 0.6.1: the fixes of deep review 6 (RB-79..92) that live in the core.
void Bridge061Tests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;
    namespace b = xfb::behave;

    // RB-83: game.save refuses while the bridge holds something on V, before anything changes (with or without override).
    {
        int prepared = 0;
        w::SaveOps ops;
        ops.holds = [] { return json::array({"GameplayRestriction.NoMovement", "behaviours running (behave_list)"}); };
        ops.prepare = [&] {
            ++prepared;
            return json{{"lock_released", true}};
        };
        ops.status = [] { return json{{"locked", false}, {"state", "saved"}}; };
        ops.save = [] { return json{{"requested", true}}; };
        ops.relock = [] {};
        ops.sleep = [](std::chrono::milliseconds) {};
        std::string code = "ok", message;
        try
        {
            w::GameSave(p::ParseGameSave(json{{"override_lock", true}}), ops);
        }
        catch (const xfb::MethodError& e)
        {
            code = e.code;
            message = e.what();
        }
        Check("0.6.1 game.save refuses bridge_effects_active before prepare, naming what is held (RB-83)",
              code == "bridge_effects_active" && prepared == 0 && message.find("NoMovement") != std::string::npos &&
                  message.find("player_stop") != std::string::npos);
        ops.holds = [] { return json::array(); };
        Check("0.6.1 game.save goes ahead when nothing is held", ParamsCode([&] { w::GameSave(p::ParseGameSave(json::object()), ops); }) == "ok" && prepared == 1);
    }

    // RB-81: a glide is capped at 30 s; RB-79/81: V is checked every tick, and the player's own input ends it.
    {
        b::Runner runner;
        xfb::EventLog events;
        runner.SetEvents(&events);
        const auto allow = [](xfb::Access) {};
        Check("0.6.1 behave.glide.path: max_s above 30 is refused, the default is 30 (RB-81)",
              ParamsCode([&] { runner.Start(b::StartParams("glide_path", json{{"offset", {{"forward", 3}}}, {"max_s", 31}}), allow); }) == "bad_params" &&
                  runner.Start(b::StartParams("glide_path", json{{"offset", {{"forward", 3}}}}), allow)["max_s"] == 30.0);
        runner.DropAll("test");

        std::string busy, tookOver;
        int teleports = 0, reads = 0;
        bool holding = false;
        b::Ops fake;
        fake.player = [&] {
            ++reads;
            return json{{"position", {0, 0, 0}}, {"yaw", 0.0}, {"busy", busy}, {"took_over", tookOver}};
        };
        fake.path = [](const b::Vec3& aFrom, const b::Vec3& aTo) { return std::vector<b::Vec3>{aFrom, aTo}; };
        fake.holdMovement = [&](bool aOn) { holding = aOn; };
        fake.teleportPlayer = [&](const b::Vec3&, double) {
            // As XFPlayer.Step: the watch's input or a busy state refuses the step.
            if (!tookOver.empty())
            {
                throw xfb::MethodError("user_took_over", "moved");
            }
            if (!busy.empty())
            {
                throw xfb::MethodError(busy, "busy");
            }
            ++teleports;
        };
        const auto lastStop = [&] {
            const auto all = events.Read(0, 500, {"behaviour"})["events"];
            return all.empty() ? json() : all.back()["data"];
        };
        runner.Start(b::StartParams("glide_path", json{{"offset", {{"forward", 10}}}, {"every_ticks", 3}}), allow);
        runner.Tick(0.1, fake, true); // starting: path, hold
        runner.Tick(0.1, fake, true); // ticks 1 and 2 of every 3: V is read instead of stepped
        const int readsBefore = reads;
        runner.Tick(0.1, fake, true);
        runner.Tick(0.1, fake, true);
        Check("0.6.1 behave.glide.path: V is read on every tick without a step (RB-79)", reads - readsBefore >= 1 && teleports >= 1 && holding);
        busy = "player_busy";
        runner.Tick(0.1, fake, true);
        runner.Tick(0.1, fake, true);
        Check("0.6.1 behave.glide.path: a busy state (a fall) stops it on the next tick and gives the hold back",
              !runner.Active() && !holding && lastStop().value("reason", std::string()) == "player_busy");
        busy.clear();
        runner.Start(b::StartParams("glide_path", json{{"offset", {{"forward", 10}}}}), allow);
        runner.Tick(0.1, fake, true);
        runner.Tick(0.1, fake, true);
        tookOver = "MoveY";
        runner.Tick(0.1, fake, true);
        const auto stop = lastStop();
        Check("0.6.1 behave.glide.path: the player's own input ends it with user_took_over and a way back (RB-81)",
              !runner.Active() && !holding && stop.value("reason", std::string()) == "user_took_over" && stop.contains("undo") &&
                  stop.contains("travelled_m"));
    }

    // RB-84: an item's exact identity in a restore; a restore with an item the game no longer has puts the rest back.
    {
        const auto parse = [](const char* aText) { return p::ParseWardrobeEquip(json::parse(aText)); };
        const auto exact = parse(R"({"restore":{"set":2,"slots":[{"area":"Head","item":"Items.Cap_01_basic_01","id":"1234567890123","hidden":false}],"script_outfit":{"active":true,"parts":[{"slot":"OutfitSlots.Head","item":"Items.Cap_01_basic_01","id":"42"}]}}})");
        Check("0.6.1 wardrobe.equip: a restore carries each item's exact identity",
              exact.slots[0].id == "1234567890123" && exact.parts[0].id == "42" &&
                  ParamsCode([&] { parse(R"({"restore":{"set":0,"slots":[{"area":"Head","item":"Items.A","id":"x1"}]}})"); }) == "bad_params" &&
                  ParamsCode([&] { parse(R"({"restore":{"set":0,"slots":[{"area":"Head","item":"Items.A","id":"123456789012345678901"}]}})"); }) == "bad_params");
        const auto request = parse(R"({"restore":{"set":0,"slots":[],"script_outfit":{"active":true,"parts":[{"slot":"OutfitSlots.Head","item":"Items.Cap_01_basic_01"},{"slot":"OutfitSlots.Feet","item":"Items.Boots_gone"}]}}})");
        w::WardrobeOps ops;
        ops.change = [] { return json{{"changed", true}, {"not_restored", {"OutfitSlots.Feet: Items.Boots_gone"}}, {"before", {{"set", 0}}}}; };
        ops.state = [] {
            return json{{"set", 0}, {"manager", "script"}, {"script_outfit", {{"active", true}, {"parts", {{{"slot", "OutfitSlots.Head"}, {"item", "Items.Cap_01_basic_01"}}}}}}};
        };
        ops.settle = [] {};
        const auto out = w::WardrobeEquip(request, ops);
        Check("0.6.1 wardrobe.equip {restore}: a missing part is named in not_restored and the rest counts as shown (RB-84)",
              out.value("shown", false) && out["not_restored"].size() == 1 && out["not_restored"][0] == "OutfitSlots.Feet: Items.Boots_gone");
    }

    // RB-89: the kill switch's restore waits while behaviours still run (Main.cpp gates it on the runner being idle).
    {
        b::Runner runner;
        runner.Start(b::StartParams("turntable", json{{"deg_per_s", 30}}), [](xfb::Access) {});
        w::RestoreOnce restore;
        restore.MarkWrite();
        int restored = 0;
        const auto tick = [&] { restore.Tick(!runner.Active(), [&] { ++restored; }); };
        tick(); // a kill landed after this tick's behaviours ran: they still run, so no restore yet
        const int early = restored;
        b::Ops fake;
        fake.showroom = [] { return json::object(); };
        fake.place = [](const std::string&, int32_t, const b::Vec3&, double) {};
        runner.StopAll("kill_switch");
        runner.Tick(0.1, fake, true);
        tick();
        Check("0.6.1 kill switch: the restore runs only after every behaviour's stop step (RB-89)", early == 0 && restored == 1);
    }
}

// Bridge 0.7: in-game driving (asks with answers, pinning, 600 characters), the answer keys and overlay config, the new hooks'
// parameters and undos, and the overlay host's game-independent half (refusals, the three-slot hand-off, the descriptor
// list, the theme table).
void Bridge070Tests()
{
    namespace h = xfb::hooks;
    namespace o = xfb::overlay;
    namespace p = xfb::params;
    namespace k = xfb::inkui;
    const auto t0 = xfb::MessageBoard::Clock::now();
    {
        xfb::MessageBoard board;
        xfb::MessageBoard defaults;
        const auto plain = defaults.Post({"Is V in the apartment?", 60, "ask", false}, t0);
        Check("0.8 an ask without choices gets one Done button (session 8: Ready, Yes and No confused the maintainer)",
              plain["choices"] == json::array({"Done"}), plain.dump());
        const auto ask = board.Post({"Is V in the apartment?", 60, "ask", false, {"Ready", "Yes", "No"}}, t0);
        for (int i = 0; i < 5; ++i)
        {
            board.Post({"info " + std::to_string(i), 60, "info", false}, t0);
        }
        xfb::PendingAsk pending;
        Check("0.7 the newest unanswered ask stays pinned while newer lines push the others out",
              board.Pending(pending, t0) && pending.id == ask["id"].get<uint64_t>() && board.Active(t0) == 4);
        const auto wrong = board.Answer(0, 7, t0);
        Check("0.7 an answer with no such choice is refused", !wrong.value("ok", true));
        const auto answered = board.Answer(0, 1, t0);
        Check("0.7 answering the pending ask names the choice and the question", answered.value("ok", false) && answered["label"] == "Yes" &&
                                                                                    answered["message_id"] == ask["id"], answered.dump());
        Check("0.7 an answered ask stops waiting and can't be answered twice", !board.Pending(pending, t0) && !board.Answer(ask["id"].get<uint64_t>(), 0, t0).value("ok", true));
        // 0.8.9 (session 15: a stray F6 answered the next question): a key within 0.5 s of the question is ignored; a button isn't.
        board.Post({"Key check?", 60, "ask", false, {"A", "B"}}, t0);
        const auto early = board.Answer(0, 0, true, t0 + std::chrono::milliseconds(200));
        const auto later = board.Answer(0, 1, true, t0 + std::chrono::milliseconds(600));
        board.Post({"Button check?", 60, "ask", false, {"A", "B"}}, t0);
        const auto button = board.Answer(0, 1, false, t0 + std::chrono::milliseconds(100));
        Check("0.8.9 an answer key within 0.5 s of its question is ignored (too_soon), works after; a button isn't held back",
              !early.value("ok", true) && early.value("too_soon", false) && later.value("ok", false) && later["label"] == "B" && button.value("ok", false),
              early.dump() + later.dump() + button.dump());
    {
        // 0.8.11 (UI review of 0.8.11, fix 6): the guard starts again when the question's keys become armed on a surface.
        xfb::MessageBoard armBoard;
        const auto a0 = xfb::MessageBoard::Clock::now();
        armBoard.Post({"Armed late?", 60, "ask", false, {"A", "B"}}, a0);
        const auto a1 = a0 + std::chrono::seconds(20);
        const auto armStray = armBoard.Answer(0, 0, true, a1 + std::chrono::milliseconds(100));
        Check("0.8.11 a question that waited is answered by a key at once if nothing armed it since (the old rule)", armStray.value("ok", false), armStray.dump());
        armBoard.Post({"Behind the phone?", 60, "ask", false, {"A", "B"}}, a0);
        xfb::PendingAsk armPending;
        armBoard.Pending(armPending, a0);
        armBoard.NoteArmed(armPending.id, a1);
        const auto armEarly = armBoard.Answer(0, 0, true, a1 + std::chrono::milliseconds(200));
        const auto armLate = armBoard.Answer(0, 1, true, a1 + std::chrono::milliseconds(600));
        Check("0.8.11 a question whose keys became armed later ignores a key for 0.5 s from then, not from when it was posted",
              !armEarly.value("ok", true) && armEarly.value("too_soon", false) && armLate.value("ok", false), armEarly.dump() + armLate.dump());
        armBoard.Post({"Button?", 60, "ask", false, {"A", "B"}}, a0);
        armBoard.Pending(armPending, a0);
        armBoard.NoteArmed(armPending.id, a1);
        const auto armClick = armBoard.Answer(0, 1, false, a1 + std::chrono::milliseconds(50));
        Check("0.8.11 a armClick is not held back by it", armClick.value("ok", false), armClick.dump());
    }
        xfb::MessageRequest custom{"Which light?", 30, "ask", false, {"Key", "Fill", "Rim"}};
        const auto posted = board.Post(custom, t0);
        Check("0.7 an ask takes its own choices", posted["choices"] == json::array({"Key", "Fill", "Rim"}));
        Check("0.7 the snapshot names the pending ask for the CET window", json::parse(board.Snapshot(t0)).contains("pending_ask"));
        Check("0.7 an expired ask isn't pending", !board.Pending(pending, t0 + std::chrono::seconds(31)));
        const auto longPost = board.Post({std::string(900, 'a'), 5, "info", false}, t0);
        Check("0.7 messages show up to 600 characters (0.8: the 600th an ellipsis)",
              longPost["text"].get<std::string>() == std::string(599, 'a') + "\xE2\x80\xA6" && longPost["truncated"] == true);
        Check("0.7 choices go with asks only", ParamsCode([] { p::ParseMessage(json{{"text", "hi"}, {"choices", {"A"}}}); }) == "bad_params");
        Check("0.7 at most four choices", ParamsCode([] { p::ParseMessage(json{{"text", "hi"}, {"level", "ask"}, {"choices", {"A", "B", "C", "D", "E"}}}); }) == "bad_params");
        Check("0.7 a message may be up to 2000 characters long when sent", ParamsCode([] { p::ParseMessage(json{{"text", std::string(1500, 'b')}}); }) == "ok");
    }
    {
        const auto config = xfb::ParseConfig("[ui]\nanswer_keys = IK_F7, IK_F8\n[overlay]\nenabled = true\ntheme = light\nscale_percent = 150\n");
        Check("0.7 config: answer keys, overlay switch, theme and scale", config.answerKeys == std::vector<std::string>{"IK_F7", "IK_F8"} && config.overlayEnabled &&
                                                                               config.overlayTheme == "light" && config.overlayScalePercent == 150 && config.warnings.empty());
        const auto bad = xfb::ParseConfig("[ui]\nanswer_keys = F7; rm\n[overlay]\ntheme = neon\n");
        Check("0.7 config: a bad key list or theme keeps the defaults", bad.answerKeys.size() == 4 && bad.answerKeys[0] == "IK_F6" && bad.overlayTheme == "dark" &&
                                                                               bad.warnings.size() == 2);
        Check("0.7 config: the overlay is off by default", !xfb::ParseConfig("").overlayEnabled);
    }
    {
        k::HudSettings settings;
        k::BridgeView view;
        view.pluginEnabled = true;
        view.listening = true;
        k::AskView ask;
        ask.id = 9;
        ask.keyed = {{"IK_F6", "Ready"}, {"IK_F7", "Yes"}};
        const auto frame = k::ParseFrame(k::Frame(settings, view, {{"ask", "Ready?"}}, &ask));
        Check("0.7 the HUD frame carries the ask's keys", frame["ask"]["id"] == 9 && frame["ask"]["choices"].size() == 2 && frame["ask"]["choices"][1]["key"] == "IK_F7",
              frame.dump());
        view.killed = true;
        Check("0.7 a killed bridge's frame has no ask", !k::ParseFrame(k::Frame(settings, view, {}, &ask)).contains("ask"));
    }
    {
        Check("0.7 cyberware.state refuses an unknown area", ParamsCode([] { h::ParseCyberwareState(json{{"areas", {"Clothing"}}}); }) == "bad_params");
        Check("0.7 cyberware.equip needs a record", ParamsCode([] { h::ParseCyberwareEquip(json{{"item", "not a record"}}); }) == "bad_params");
        Check("0.7 cyberware.unequip needs area or item", ParamsCode([] { h::ParseCyberwareUnequip(json::object()); }) == "bad_params");
        Check("0.7 remove_added needs the item", ParamsCode([] { h::ParseCyberwareUnequip(json{{"area", "ArmsCW"}, {"remove_added", true}}); }) == "bad_params");
        const auto swap = h::CyberwareEquipUndo(json{{"area", "ArmsCW"}, {"slot", 0}, {"previous", "Items.StrongArms"}, {"added", false}}, "Items.MantisBlades");
        Check("0.7 an equip's undo puts the earlier item back", swap["method"] == "cyberware.equip" && swap["params"]["item"] == "Items.StrongArms");
        const auto empty = h::CyberwareEquipUndo(json{{"area", "ArmsCW"}, {"slot", 0}, {"previous", ""}, {"added", true}}, "Items.MantisBlades");
        Check("0.7 an equip into an empty slot undoes by emptying it and removing what the bridge added",
              empty["method"] == "cyberware.unequip" && empty["params"]["remove_added"] == true && empty["params"]["item"] == "Items.MantisBlades");
        Check("0.7 an equip of what was there has no undo", h::CyberwareEquipUndo(json{{"already_equipped", true}}, "Items.X").is_null());
        Check("0.7 an unequip's undo equips the item again, unless it was removed",
              h::CyberwareUnequipUndo(json{{"area", "ArmsCW"}, {"slot", 0}, {"previous", "Items.StrongArms"}}, false)["method"] == "cyberware.equip" &&
                  h::CyberwareUnequipUndo(json{{"previous", "Items.StrongArms"}}, true).is_null());
        Check("0.7 world.probe needs points or around_v, not both", ParamsCode([] { h::ParseWorldProbe(json::object()); }) == "bad_params" &&
                                                                        ParamsCode([] { h::ParseWorldProbe(json::parse(R"({"points":[[1,2,3]],"around_v":true})")); }) == "bad_params");
        const auto ring = h::RingPoints({0, 0, 0}, 0.0, 2.0, 4);
        Check("0.7 a ring starts at V and its first point is straight ahead (+Y at yaw 0)",
              ring.size() == 5 && std::abs(ring[1][1] - 2.0) < 1e-9 && std::abs(ring[1][0]) < 1e-9 && std::abs(ring[2][0] + 2.0) < 1e-9);
        Check("0.7 world.state refuses a fact name with odd characters", ParamsCode([] { h::ParseWorldState(json{{"facts", {"a b"}}}); }) == "bad_params");
        Check("0.7 the weather needs name or cycle", ParamsCode([] { h::ParseWeather(json::object()); }) == "bad_params");
        const auto weatherUndo = h::WeatherUndo(json{{"before", "24h_weather_sunny"}});
        Check("0.7 the weather's undo sets the earlier state with the cycle on", weatherUndo["params"]["name"] == "24h_weather_sunny" && weatherUndo["params"]["cycle"] == true);
        Check("0.7 photo.scene.set needs a row", ParamsCode([] { h::ParsePhotoScene(json::object()); }) == "bad_params");
        const auto scene = h::ParsePhotoScene(json{{"npcs", {{"label", "Off"}}}, {"game_speed", 0.5}});
        Check("0.7 photo.scene.set: a label row and a speed", scene.rows.size() == 2 && scene.rows[0].key == 54 && scene.rows[0].label == "Off" && scene.rows[1].key == 71);
        const auto saves = h::TrimSaves(json{{"ready", true}, {"names", {"a", "b", "c"}}, {"metadata", {{{"name", "a"}, {"timestamp", 1}}, {{"name", "b"}, {"timestamp", 3}}}}}, 1);
        const auto three = h::TrimSaves(json{{"ready", true}, {"names", {"a", "b", "c"}}, {"metadata", {{{"name", "a"}, {"timestamp", 1}}, {{"name", "b"}, {"timestamp", 3}}}}}, 3);
        Check("0.7 game.saves keeps the newest and says when details are missing (0.8.2: of the limit asked for)",
              saves["saves"].size() == 1 && saves["saves"][0]["name"] == "b" && saves["note"].get<std::string>().empty() &&
                  !three["note"].get<std::string>().empty());
    }
    {
        o::DeviceFacts facts;
        facts.deviceData = facts.swapChain = facts.directQueue = facts.sameDevice = true;
        facts.format = "R8G8B8A8_UNORM";
        facts.windowClass = "W2ViewportClass";
        facts.bufferCount = 3;
        Check("0.7 overlay: an SDR 8-bit game window may be drawn on", o::RefusalFor(facts).empty());
        auto hdr = facts;
        hdr.hdrMode = 1;
        Check("0.7 overlay: HDR is refused", o::RefusalFor(hdr).find("HDR") != std::string::npos);
        auto wide = facts;
        wide.format = "R16G16B16A16_FLOAT";
        Check("0.7 overlay: a float back buffer is refused", !o::RefusalFor(wide).empty());
        auto other = facts;
        other.windowClass = "Chrome_WidgetWin_1";
        Check("0.7 overlay: another window is refused", !o::RefusalFor(other).empty());

        o::OverlayHost host;
        Check("0.7 overlay: off by default, nothing drawn", !host.Enabled() && !host.ShouldDraw() && host.Snapshot()["phase"] == "disabled");
        {
            // 0.8.22 (Borg 4): CET's overlay is tracked with the host disabled, and is null (unknown) until the CET layer reports.
            o::OverlayHost off;
            const bool unknown = off.Snapshot()["cet_open"].is_null() && !off.CetOpenKnown();
            off.SetCetOpen(true);
            const bool open = off.Snapshot()["cet_open"] == true && !off.Enabled();
            off.SetCetOpen(false);
            Check("0.8.22 overlay: cet_open is null until reported, then follows CET with the host disabled",
                  unknown && open && off.Snapshot()["cet_open"] == false);
            // overlay.set on a host off at load: theme, motion and diagnostics apply; switching on needs a restart.
            const auto applied = o::SetLive(off, json{{"theme", "light"}, {"motion", "reduced"}, {"diagnostics", true}});
            const auto restart = ParamsCode([&] { o::SetLive(off, json{{"enabled", true}}); });
            Check("0.8.22 overlay.set: live in memory with an undo of exactly the keys given; enabled needs a restart when off at load",
                  applied["theme"] == "light" && off.Theme() == o::ThemeKind::Light && off.Diagnostics() && applied["motion"]["setting"] == "reduced" &&
                      applied["motion"]["effective"] == "reduced" && applied["in_memory"] == true &&
                      applied["undo"]["params"] == json{{"theme", "dark"}, {"motion", "auto"}, {"diagnostics", false}} && restart == "needs_restart" &&
                      off.Snapshot()["theme"] == "light" && off.Snapshot()["diagnostics"] == true,
                  applied.dump());
            const auto generation = off.ThemeGeneration();
            o::SetLive(off, applied["undo"]["params"]);
            o::SetLive(off, json{{"theme", "dark"}}); // the same theme again: no restyle
            Check("0.8.22 overlay.set: the undo puts the values back and bumps the theme generation once; bad values are refused",
                  off.Theme() == o::ThemeKind::Dark && !off.Diagnostics() && off.MotionSettingNow() == o::MotionSetting::Auto && off.ThemeGeneration() == generation + 1 &&
                      ParamsCode([&] { o::SetLive(off, json{{"theme", "blue"}}); }) == "bad_params" && ParamsCode([&] { o::SetLive(off, json::object()); }) == "bad_params" &&
                      ParamsCode([&] { o::SetLive(off, json{{"motion", "fast"}}); }) == "bad_params" && ParamsCode([&] { o::SetLive(off, json{{"scale", 2}}); }) == "bad_params");
        }
        {
            // overlay.set on a host enabled at load: drawing switches off and back on live, the hooks staying.
            o::OverlayHost on;
            on.Configure(true, o::ThemeKind::Dark, 100);
            on.NoteHooks(true, true, true, "");
            on.NoteInit(facts, "");
            const auto offNow = o::SetLive(on, json{{"enabled", false}});
            const bool stopped = !on.ShouldDraw() && !on.CanShowPanel() && on.Snapshot()["enabled"] == false && on.Snapshot()["enabled_at_load"] == true && on.Enabled();
            o::SetLive(on, offNow["undo"]["params"]);
            Check("0.8.22 overlay.set: enabled false stops drawing with the hooks kept; its undo draws again", stopped && on.ShouldDraw() && on.Snapshot()["enabled"] == true,
                  offNow.dump());
            // The test-only diagnostics figure: refused without test hooks; with them both bars draw it and the state says so.
            const auto noHooks = ParamsCode([&] { o::SetLive(on, json{{"diagnostics_cpu_ms", 0.8}}); });
            on.NoteFrame(150.0); // a measured 0.15 ms
            const auto figure = o::SetLive(on, json{{"diagnostics_cpu_ms", 0.8}}, true);
            const auto withFigure = on.Snapshot();
            const bool drawn = std::abs(on.DisplayCpuMs() - 0.8) < 1e-9 && withFigure["cpu_ms"] == 0.8 && withFigure["cpu_ms_override"] == 0.8 &&
                               std::abs(withFigure["cpu_ms_measured"].get<double>() - 0.15) < 1e-9 && figure["undo"]["params"] == json{{"diagnostics_cpu_ms", nullptr}};
            o::SetLive(on, figure["undo"]["params"], true);
            const auto cleared = on.Snapshot();
            {
                // 0.8.22 cet.panel, after its review: a header in every build, a press only with test hooks; requests belong to their
                // session and client; a header is sent until a draw applies it; a press runs once, after a claim; the undo is the
                // captured earlier state, unknown kept unknown; a remote resume never undoes the player's pause.
                namespace cp = xfb::cetpanel;
                const auto ctx = [](bool pressAllowed = true, bool paused = false, cp::PauseOrigin by = cp::PauseOrigin::None) {
                    cp::Context c;
                    c.generation = "s:1";
                    c.pressAllowed = pressAllowed;
                    c.writesAllowed = true;
                    c.writesPaused = paused;
                    c.pausedBy = by;
                    c.cetOpen = false;
                    return c;
                };
                cp::Channel panel;
                const bool unreported = panel.Report().is_null();
                const auto pressNoHooks = ParamsCode([&] { panel.Request(json{{"press", "pause_changes"}}, ctx(false)); });
                const auto header = panel.Request(json{{"diagnostics_open", true}}, ctx(false)); // headers need no test hooks
                const auto first = json::parse(panel.Exchange("", ctx()));
                // Receipt is not completion: the header is sent again until a draw reports it applied (a CET reload replays it).
                const auto again = json::parse(panel.Exchange(json{{"chip", "Changes allowed"}}.dump(), ctx()));
                const auto applied = panel.Exchange(json{{"header_done", json::array({{{"id", header["id"]}}})}}.dump(), ctx()); // previous unknown
                const auto record = panel.Report()["requests"][0];
                Check("0.8.22 cet.panel review: headers in every build, presses only with test hooks; a header is sent until a draw applies it",
                      unreported && pressNoHooks == "test_hooks_off" && first.size() == 1 && again.size() == 1 && applied.empty() && record["header"] == "applied" &&
                          record["header_previous"].is_null() && header["undo"]["params"] == json{{"undo", header["id"]}},
                      record.dump());
                // The undo of a header whose earlier state was never drawn leaves it alone, and says so.
                const auto undoUnknown = panel.Request(json{{"undo", header["id"]}}, ctx());
                // A header applied over a drawn state undoes to that state.
                const auto closeIt = panel.Request(json{{"diagnostics_open", false}}, ctx());
                panel.Exchange(json{{"header_done", json::array({{{"id", closeIt["id"]}, {"previous", true}}})}}.dump(), ctx());
                const auto undoKnown = panel.Request(json{{"undo", closeIt["id"]}}, ctx());
                Check("0.8.22 cet.panel review: the undo puts back the captured header state, and an unknown one stays unknown",
                      undoUnknown["queued"] == false && undoUnknown["notes"][0].get<std::string>().find("unknown") != std::string::npos &&
                          undoKnown["request"]["diagnostics_open"] == true && undoKnown["undo_of"] == closeIt["id"],
                      undoKnown.dump());
                // A press runs once, after its claim; a replay after a CET reload is refused; the undo restores the pause state before it.
                const auto pause = panel.Request(json{{"press", "pause_changes"}}, ctx());
                const auto claim = json::parse(panel.Exchange(json{{"claim", pause["id"]}}.dump(), ctx()));
                const auto use = panel.TakeClaim(true, ctx());
                panel.NotePress(use.id, json{{"writes_paused", true}});
                const auto replay = json::parse(panel.Exchange(json{{"claim", pause["id"]}}.dump(), ctx(true, true, cp::PauseOrigin::Bridge)));
                const auto click = panel.TakeClaim(false, ctx()); // no claim: the player's own click
                const auto undoPress = panel.Request(json{{"undo", pause["id"]}}, ctx(true, true, cp::PauseOrigin::Bridge));
                Check("0.8.22 cet.panel review: a press runs once after its claim, a replay is refused, and its undo restores the earlier pause state",
                      claim["claimed"] == true && use.kind == cp::ClaimUse::Kind::Press && replay["claimed"] == false &&
                          click.kind == cp::ClaimUse::Kind::None && undoPress["request"]["press"] == "resume_changes",
                      replay.dump());
                // The player's pause: a remote resume is refused at the request and at the claim.
                cp::Channel player;
                const auto refusedNow = ParamsCode([&] { player.Request(json{{"press", "resume_changes"}}, ctx(true, true, cp::PauseOrigin::Player)); });
                const auto resume = player.Request(json{{"press", "resume_changes"}}, ctx(true, true, cp::PauseOrigin::Bridge));
                const auto refusedAtClaim = json::parse(player.Exchange(json{{"claim", resume["id"]}}.dump(), ctx(true, true, cp::PauseOrigin::Player)));
                Check("0.8.22 cet.panel review (High): a remote resume never undoes a pause the player set",
                      refusedNow == "paused_by_player" && refusedAtClaim["claimed"] == false && refusedAtClaim["why"] == "paused_by_player");
                // A kill, the client going or a new client cancels what is queued; a claim cancelled before PauseWrites takes it is refused.
                cp::Channel killed;
                const auto queuedPress = killed.Request(json{{"press", "pause_changes"}}, ctx());
                auto stoppedCtx = ctx();
                stoppedCtx.killed = true;
                const auto afterKill = killed.Exchange("", stoppedCtx);
                const auto lateClaim = json::parse(killed.Exchange(json{{"claim", queuedPress["id"]}}.dump(), stoppedCtx));
                cp::Channel owner;
                const auto ownersPress = owner.Request(json{{"press", "pause_changes"}}, ctx());
                auto otherCtx = ctx();
                otherCtx.generation = "s:2";
                const auto afterNewClient = owner.Exchange("", otherCtx);
                cp::Channel race;
                const auto racePress = race.Request(json{{"press", "pause_changes"}}, ctx());
                race.Exchange(json{{"claim", racePress["id"]}}.dump(), ctx());
                const auto raced = race.TakeClaim(true, stoppedCtx);
                Check("0.8.22 cet.panel review: a kill or a new client cancels queued presses, and a claim taken after a kill is refused",
                      afterKill.empty() && lateClaim["claimed"] == false && afterNewClient.empty() && raced.kind == cp::ClaimUse::Kind::Cancelled &&
                          killed.Report()["requests"][0]["press_status"] == "cancelled",
                      lateClaim.dump());
                cp::Channel full;
                for (size_t i = 0; i < cp::kMaxPending; ++i) full.Request(json{{"press", "pause_changes"}}, ctx()); // presses wait too
                Check("0.8.22 cet.panel: a CET layer that never takes them is said once the queue is full",
                      ParamsCode([&] { full.Request(json{{"press", "pause_changes"}}, ctx()); }) == "cet_not_answering" &&
                          ParamsCode([&] { full.Request(json{{"press", "pause"}}, ctx()); }) == "bad_params" &&
                          ParamsCode([&] { full.Request(json{{"undo", 999}}, ctx()); }) == "bad_params");
            }
            Check("0.8.22 overlay.set diagnostics_cpu_ms: test hooks only; the figure replaces the measured time in the bars and the state, null clears it",
                  noHooks == "test_hooks_off" && drawn && cleared["cpu_ms_override"].is_null() && std::abs(on.DisplayCpuMs() - 0.15) < 1e-9 &&
                      ParamsCode([&] { o::SetLive(on, json{{"diagnostics_cpu_ms", -1}}, true); }) == "bad_params",
                  withFigure.dump());
        }
        host.Configure(true, o::ThemeKind::Dark, 100);
        host.NoteHooks(true, true, true, "");
        Check("0.7 overlay: hooked, waiting for the first present", host.Snapshot()["phase"] == "waiting" && !host.ShouldDraw());
        host.NoteInit(facts, "");
        Check("0.7 overlay: drawing after a clean first present", host.ShouldDraw());
        const auto now = std::chrono::steady_clock::now();
        host.HideForCapture(true, 500, now);
        Check("0.7 overlay: hidden for a capture, and back by itself", !host.ShouldDraw(now + std::chrono::milliseconds(100)) && host.ShouldDraw(now + std::chrono::milliseconds(600)));
        host.SetCetOpen(true);
        Check("0.7 overlay: yields while CET's overlay is open", !host.ShouldDraw(now + std::chrono::seconds(1)));
        host.RequestDiagnostics(true);
        Check("0.8.23 CET diagnostics: the native card can draw beside CET", host.DiagnosticsRequested() && host.ShouldDraw(now + std::chrono::seconds(1)));
        host.RequestDiagnostics(false);
        Check("0.8.23 CET diagnostics: closing the card restores CET yield", !host.ShouldDraw(now + std::chrono::seconds(1)));
        host.RequestDiagnostics(true);
        host.SetCetOpen(false);
        Check("0.8.23 CET diagnostics: closing CET clears its transient request", !host.DiagnosticsRequested() && host.Snapshot()["cet_diagnostics"] == false);
        host.SetCetOpen(true);
        Check("0.8.23 CET diagnostics: reopening CET starts without the old card", !host.ShouldDraw(now + std::chrono::seconds(1)));
        host.SetCetOpen(false);
        host.SetPassThrough(true);
        Check("0.7 overlay: the pass-through switch stops drawing without unhooking", !host.ShouldDraw(now + std::chrono::seconds(1)) && host.Snapshot()["hooks"]["present"] == true);
        host.SetPassThrough(false);
        host.SetKilled(true);
        Check("0.7 overlay: the kill switch stops drawing", !host.ShouldDraw(now + std::chrono::seconds(1)));
        o::OverlayHost missing;
        missing.Configure(true, o::ThemeKind::Light, 100);
        missing.NoteHooks(false, false, false, "GpuApi::Present");
        Check("0.7 overlay: a missing address leaves it unhooked, with the reason", missing.Snapshot()["phase"] == "unhooked" && missing.Snapshot()["missing"] == "GpuApi::Present" &&
                                                                                       missing.Snapshot()["theme"] == "light");

        o::TripleBuffer<int> hand;
        Check("0.7 hand-off: nothing to take before a publish", !hand.Take());
        hand.Back() = 1;
        hand.Publish();
        hand.Back() = 2;
        hand.Publish();
        Check("0.7 hand-off: the reader takes the newest", hand.Take() && hand.Front() == 2 && !hand.Take());
        hand.Back() = 3;
        hand.Publish();
        Check("0.7 hand-off: and the next one after it", hand.Take() && hand.Front() == 3);

        o::DescriptorFreeList list(2);
        const auto a = list.Alloc(), b = list.Alloc();
        Check("0.7 descriptors: full after its capacity, a freed slot is reused", a == 0 && b == 1 && list.Alloc() == -1 && list.Free(0) && list.Alloc() == 0 && !list.Free(5));

        float rgba[4] = {};
        size_t colours = 0;
        o::ThemeColors(colours);
        Check("0.7 theme: the table maps ImGui's colours from the Studio's tokens", colours >= 40 && o::ThemeColorOf("WindowBg", o::ThemeKind::Dark, rgba) && rgba[0] < 0.3f &&
                                                                                        o::ThemeColorOf("WindowBg", o::ThemeKind::Light, rgba) && rgba[0] > 0.8f);
        Check("0.7 theme: dark is the default and light is chosen by name", o::ThemeFromName("") == o::ThemeKind::Dark && o::ThemeFromName("light") == o::ThemeKind::Light);
        Check("0.7 theme: the Studio's body text size", o::ThemeMetricOf("FontSize", 0.0f) == 13.0f);
    }
}

// The deep review of bridge 0.7.0 (research/authoring/code-health.md, RB-96..RB-118): the question board's clear, withdraw and
// state (session.wait's early answer and question_gone), cyberware.equip's sequence keeping its undo, the exact copy and the
// added copy in a swap's undo, photo.scene.set putting rows back, game.saves' final step, and the overlay host's checks
// after a resize, its hook rule and its glyph limit.
void Bridge070ReviewTests()
{
    namespace h = xfb::hooks;
    namespace o = xfb::overlay;
    namespace p = xfb::params;
    const auto t0 = xfb::MessageBoard::Clock::now();
    {
        xfb::MessageBoard board;
        const auto ask = board.Post({"Ready for the next frame?", 60, "ask", false}, t0);
        const auto askId = ask["id"].get<uint64_t>();
        board.Post({"a line", 60, "info", false}, t0);
        Check("RB-96 a posted question is pending", board.StateOf(askId, t0).state == "pending");
        // 0.8.2: a capture's clear (keep_asks) keeps the question; a plain clear withdraws it (Session9Tests).
        const auto cleared = board.Post({"", 8, "info", true, {}, true}, t0);
        xfb::PendingAsk pending;
        Check("RB-103 a capture's clear (keep_asks) takes the lines down but keeps the waiting question", cleared.value("cleared", 0) == 1 && board.Pending(pending, t0) &&
                                                                                        pending.id == askId && cleared.value("kept_question", 0ull) == askId,
              cleared.dump());
        board.Answer(askId, 0, t0);
        const auto answered = board.StateOf(askId, t0);
        Check("RB-96 an answered question says so with its answer, even after its line fades",
              answered.state == "answered" && answered.label == "Done" && board.StateOf(askId, t0 + std::chrono::seconds(30)).state == "answered");
        const auto second = board.Post({"And now?", 60, "ask", false}, t0)["id"].get<uint64_t>();
        const auto withdrawn = board.Post({"", 8, "info", false, {}, false, second}, t0);
        Check("RB-103 a withdrawn question is gone", withdrawn.value("withdrawn", false) && board.StateOf(second, t0).state == "gone");
        const auto third = board.Post({"Still there?", 5, "ask", false}, t0)["id"].get<uint64_t>();
        Check("RB-103 a question that ran out of time is gone", board.StateOf(third, t0 + std::chrono::seconds(6)).state == "gone");
        const auto fourth = board.Post({"Last one", 60, "ask", false}, t0)["id"].get<uint64_t>();
        board.Post({"", 8, "info", true}, t0);
        Check("RB-103 a plain clear withdraws a waiting question too (0.8.2: the default)", board.StateOf(fourth, t0).state == "gone" && board.Active(t0) == 0);
        Check("RB-96 an id never posted is unknown", board.StateOf(9999, t0).state == "unknown");
        const auto undo = xfb::UiMessageUndo(json{{"id", 7}});
        Check("RB-103 a message's undo withdraws it by id", undo["params"]["withdraw"] == 7 && xfb::UiMessageUndo(json{{"cleared", 1}}).is_null());
        Check("RB-103 clear_asks goes with clear", ParamsCode([] { p::ParseMessage(json{{"clear_asks", true}}); }) == "bad_params" &&
                                                       ParamsCode([] { p::ParseMessage(json{{"withdraw", 3}}); }) == "ok");
    }
    {
        // RB-101: cyberware.equip keeps its undo when reading the slot back fails.
        h::CyberwareEquipRequest request;
        request.item = "Items.MantisBlades";
        h::CyberwareEquipOps ops;
        ops.equip = [] { return json{{"area", "ArmsCW"}, {"slot", 0}, {"added", true}, {"previous", ""}}; };
        ops.settle = [](const std::string&, int32_t) -> json { throw xfb::MethodError("game_loading", "a save started loading"); };
        ops.removeAdded = [](const std::string&) { return json{{"removed", true}}; };
        const auto out = h::RunCyberwareEquip(request, ops);
        Check("RB-101 a failed read-back answers equipped unknown with the undo", out["equipped"] == "unknown" && out["undo"]["method"] == "cyberware.unequip" &&
                                                                                     out["undo"]["params"]["remove_added"] == true && out["settle_error"]["code"] == "game_loading",
              out.dump());
        ops.equip = []() -> json { throw xfb::MethodError("not_equippable", "the game says V can't equip it"); };
        Check("RB-101 a refusal in the equip step passes through (nothing changed)", ParamsCode([&] { h::RunCyberwareEquip(request, ops); }) == "not_equippable");

        // RB-109: a swap's undo names the exact earlier copy and removes the copy the bridge added.
        const auto swap = h::CyberwareEquipUndo(json{{"area", "ArmsCW"}, {"slot", 0}, {"previous", "Items.StrongArms"}, {"id", "123456789"}, {"added", true}},
                                                "Items.MantisBlades");
        Check("RB-109 a swap's undo carries the earlier copy's id and removes the added item",
              swap["params"]["id"] == "123456789" && swap["params"]["remove_added_item"] == "Items.MantisBlades", swap.dump());
        const auto parsed = h::ParseCyberwareEquip(swap["params"]);
        Check("RB-109 cyberware.equip takes the undo's id and remove_added_item", parsed.id == "123456789" && parsed.removeAddedItem == "Items.MantisBlades");
        Check("RB-109 an id is digits only", ParamsCode([] { h::ParseCyberwareEquip(json{{"item", "Items.StrongArms"}, {"id", "12a"}}); }) == "bad_params");
        int removed = 0;
        ops.equip = [] { return json{{"area", "ArmsCW"}, {"slot", 0}, {"added", false}, {"previous", "Items.MantisBlades"}}; };
        ops.settle = [](const std::string&, int32_t) { return json{{"item", "Items.StrongArms"}}; };
        ops.removeAdded = [&](const std::string& aItem) {
            removed += aItem == "Items.MantisBlades" ? 1 : 100;
            return json{{"removed", true}};
        };
        h::CyberwareEquipRequest back = parsed;
        const auto undone = h::RunCyberwareEquip(back, ops);
        Check("RB-109 running that undo equips the earlier copy, then removes the added one", undone["equipped"] == true && undone["removed"] == true && removed == 1,
              undone.dump());
    }
    {
        // RB-111: photo.scene.set puts rows already set back when a later row fails.
        const auto request = h::ParsePhotoScene(json{{"npcs", {{"label", "Off"}}}, {"weather", {{"label", "Blizzard"}}}});
        std::map<int32_t, double> rows{{54, 1.0}, {69, 0.0}};
        h::PhotoSceneOps ops;
        ops.resolve = [](const h::PhotoSceneRow& aRow) -> json {
            if (aRow.label == "Off")
            {
                return json{{"value", 0.0}, {"matched_by", "exact"}};
            }
            throw xfb::MethodError("bad_params", "no option labelled " + aRow.label);
        };
        ops.set = [&](int32_t aKey, double aValue) {
            const auto before = rows[aKey];
            rows[aKey] = aValue;
            return json{{"before", before}, {"before_known", true}, {"after", aValue}};
        };
        std::string message;
        try
        {
            h::RunPhotoScene(request, ops);
        }
        catch (const xfb::MethodError& e)
        {
            message = std::string(e.code) + ": " + e.what();
        }
        Check("RB-111 a failed row puts the rows already set back and says so", rows[54] == 1.0 && message.find("bad_params") == 0 && message.find("put back") != std::string::npos,
              message);
    }
    {
        // RB-118: game.saves' final step runs even when a read throws.
        h::SavesOps ops;
        int reads = 0;
        bool done = false;
        auto now = std::chrono::steady_clock::now();
        ops.request = [](int32_t) {};
        ops.read = [&](bool aDone) -> json {
            if (aDone)
            {
                done = true;
                return json{{"ready", true}};
            }
            if (++reads == 2)
            {
                throw xfb::MethodError("game_loading", "a save started loading");
            }
            return json{{"ready", false}, {"names", json::array()}};
        };
        ops.sleep = [&](std::chrono::milliseconds aMs) { now += aMs; };
        ops.now = [&] { return now; };
        const auto code = ParamsCode([&] { h::RunSaves(h::SavesRequest{}, ops); });
        Check("RB-118 game.saves stops collecting in its final step even after a failed read", code == "game_loading" && done && reads == 2);
    }
    {
        o::DeviceFacts first;
        first.deviceData = first.swapChain = first.directQueue = first.sameDevice = true;
        first.format = "R8G8B8A8_UNORM";
        first.windowClass = "W2ViewportClass";
        first.bufferCount = 3;
        auto same = first;
        same.width = 1920;
        same.height = 1080;
        Check("RB-97 a resize to a new size alone goes on drawing", o::RefusalAfterResize(first, same).empty());
        auto hdr = same;
        hdr.format = "R10G10B10A2_UNORM";
        Check("RB-97 HDR switched on without a restart refuses after the resize", o::RefusalAfterResize(first, hdr).find("after a resize") == 0);
        auto hdrMode = same;
        hdrMode.hdrMode = 2;
        Check("RB-97 an HDR mode reported after the resize refuses", !o::RefusalAfterResize(first, hdrMode).empty());
        auto bgra = same;
        bgra.format = "B8G8R8A8_UNORM";
        Check("RB-97 a changed 8-bit format refuses too (the pipeline keeps the first)", o::RefusalAfterResize(first, bgra).find("format") != std::string::npos);
        auto two = same;
        two.bufferCount = 2;
        Check("RB-97 a changed buffer count refuses", o::RefusalAfterResize(first, two).find("back buffers") != std::string::npos);

        o::OverlayHost host;
        host.Configure(true, o::ThemeKind::Dark, 100);
        host.NoteHooks(true, true, false, "");
        Check("RB-107 without the render-shutdown hook the host stays unhooked and says why",
              host.Snapshot()["phase"] == "unhooked" && host.Snapshot()["missing"].get<std::string>().find("render shutdown") != std::string::npos);
        host.NoteHooks(true, true, true, "");
        host.NoteInit(first, "");
        host.NoteInit(hdr, o::RefusalAfterResize(first, hdr));
        Check("RB-97 a refusal after a resize moves the host to refused", host.Snapshot()["phase"] == "refused" && !host.ShouldDraw());
        host.NoteFrame(1500.0);
        Check("RB-108 the panel's figures come from atomics", host.Frames() == 1 && std::abs(host.CpuMs() - 1.5) < 1e-9 && std::abs(host.CpuMsMax() - 1.5) < 1e-9);

        const std::string baked = "Ready? \xE2\x80\x94 caf\xC3\xA9 \xE2\x82\xAC" "5";
        Check("RB-99 baked text passes unchanged", o::LimitToGlyphs(baked) == baked);
        Check("RB-99 glyphs outside the baked ranges become the mark (0.8: U+00A4)", o::LimitToGlyphs("\xE6\x97\xA5\xF0\x9F\x98\x80x") == "\xC2\xA4\xC2\xA4x");
        Check("RB-99 invalid UTF-8 and control characters are replaced", o::LimitToGlyphs("a\xFF\tb") == "a\xC2\xA4 b");
        bool covered = true;
        for (const auto& [lo, hi] : o::GlyphRanges())
        {
            covered = covered && lo <= hi && hi <= 0xFFFF;
        }
        Check("RB-99 the ranges fit Dear ImGui's 16-bit glyph type; U+FFFD becomes the mark too (Segoe UI lacks it)",
              covered && o::LimitToGlyphs("\xEF\xBF\xBD") == "\xC2\xA4");
    }
}

// Bridge 0.8 (bridge-080a): session 8's findings and the UI review's fixes.
size_t Chars(const std::string& aText)
{
    size_t n = 0;
    for (const auto c : aText)
    {
        n += (static_cast<unsigned char>(c) & 0xC0) != 0x80 ? 1 : 0;
    }
    return n;
}

void Bridge080Tests()
{
    namespace k = xfb::inkui;
    namespace o = xfb::overlay;
    namespace b = xfb::behave;
    const auto t0 = xfb::MessageBoard::Clock::now();

    // The UI review's 10: a cut text backs up to a word and adds an ellipsis.
    bool cut = false;
    Check("0.8 a cut text ends at a word with an ellipsis", xfb::CleanMessageText("The quick brown fox jumps", 12, &cut) == "The quick\xE2\x80\xA6" && cut);
    Check("0.8 a text with no space near the cut is cut mid-word, ellipsis added",
          xfb::CleanMessageText(std::string(30, 'z'), 10) == std::string(9, 'z') + "\xE2\x80\xA6");
    Check("0.8 an uncut text has no ellipsis", xfb::CleanMessageText("short", 10, &cut) == "short" && !cut);

    // Session 8's I7 and the UI review: one mark on every surface; CET gets a Latin-1 copy.
    const std::string mixed = "\xC5\x81\xC3\xB3" "d\xC5\xBA \xE2\x80\x94 \xE6\x9D\xB1\xE4\xBA\xAC \xF0\x9F\x8C\x86";
    // 0.8.2 (session 9's B4): the ink mark is the bullet, which the game's ink font has (it lacks U+00A4).
    Check("0.8 the ink panel keeps the Polish letters and the em dash, marks the rest (0.8.2: with the bullet)",
          k::ForInk(mixed) == "\xC5\x81\xC3\xB3" "d\xC5\xBA \xE2\x80\x94 \xE2\x80\xA2\xE2\x80\xA2 \xE2\x80\xA2", k::ForInk(mixed));
    Check("0.8.2 the ink copy: what the font lacks becomes its plain letters (\xC3\xA5 a, \xC3\xA6 ae, \xC4\x88 C), U+00A4 the bullet, invalid bytes too",
          k::ForInk("\xC3\xA5\xC3\xA6\xC4\x88 \xC2\xA4\xFF \xC5\x91") == "aaeC \xE2\x80\xA2\xE2\x80\xA2 \xC5\x91", k::ForInk("\xC3\xA5\xC3\xA6\xC4\x88 \xC2\xA4\xFF \xC5\x91"));
    Check("0.8.2 the ink font's table: the bullet and the Polish letters in, U+00A4 and U+00E5 out",
          k::InkHas(0x2022) && k::InkHas(0x0142) && k::InkHas(0x017C) && k::InkHas(0x00E9) && !k::InkHas(0x00A4) && !k::InkHas(0x00E5) && !k::InkHas(0x6771));
    Check("0.8 the CET copy transliterates Polish and punctuation to Latin-1, marks the rest",
          k::ForCet(mixed) == "L\xC3\xB3" "dz - \xC2\xA4\xC2\xA4 \xC2\xA4", k::ForCet(mixed));
    Check("0.8 the CET copy: zolc gesla jazn, the ellipsis, OE, euro",
          k::ForCet("\xC5\xBC\xC3\xB3\xC5\x82\xC4\x87 g\xC4\x99\xC5\x9Bl\xC4\x85 ja\xC5\xBA\xC5\x84\xE2\x80\xA6 \xC5\x92 \xE2\x82\xAC" "5") ==
              "z\xC3\xB3lc gesla jazn... OE EUR5");
    Check("0.8 the CET copy keeps Latin-1 (caf\xC3\xA9) and turns invalid bytes into the mark", k::ForCet("caf\xC3\xA9\xFF") == "caf\xC3\xA9\xC2\xA4");
    Check("0.8 CET and the overlay use the same mark (0.8.2: the ink panel its own)",
          std::string(k::kReplacementMark) == "\xC2\xA4" && o::LimitToGlyphs("\xE6\x97\xA5") == k::kReplacementMark && std::string(k::kInkReplacementMark) == "\xE2\x80\xA2");

    // Session 8's item 17: a 600-character question reaches the ink panel and the CET layer whole.
    {
        xfb::MessageBoard board;
        std::string question;
        while (Chars(question) < 590)
        {
            question += "word ";
        }
        question += "end?";
        const auto posted = board.Post({question, 60, "ask", false}, t0);
        const auto text = posted["text"].get<std::string>();
        k::HudSettings settings;
        k::BridgeView view;
        view.pluginEnabled = view.listening = view.allowWrites = view.hasClient = view.scriptReady = true;
        const auto frame = k::ParseFrame(k::BuildFrame(settings, view, board, {"IK_F6", "IK_F7"}, 0));
        const auto cet = json::parse(board.Snapshot(t0, &k::ForCet));
        Check("0.8 a 594-character question is kept whole (no cut)", !posted["truncated"].get<bool>() && Chars(text) == Chars(question));
        Check("0.8 the ink frame and the CET copy carry it whole", frame["messages"][0]["text"] == text && cet["pending_ask"]["text"] == text);
        const auto full = board.Post({std::string(700, 'q'), 60, "info", false}, t0);
        const auto cetText = json::parse(board.Snapshot(t0, &k::ForCet))["messages"].back()["text"].get<std::string>();
        Check("0.8 the cap is 600 characters; the CET copy writes the ellipsis as three dots", Chars(full["text"].get<std::string>()) == 600 &&
                                                                                              cetText == std::string(599, 'q') + "...");
    }

    // The UI review's 9: an answered ask keeps its question, shows the answer where its keys were, until the next message.
    {
        xfb::MessageBoard board;
        const auto ask = board.Post({"Fully visible?", 60, "ask", false, {"Fully visible", "Partly cut off"}}, t0);
        const auto id = ask["id"].get<uint64_t>();
        k::HudSettings settings;
        k::BridgeView view;
        view.pluginEnabled = view.listening = view.allowWrites = view.hasClient = view.scriptReady = true;
        const auto before = k::ParseFrame(k::BuildFrame(settings, view, board, {"IK_F6", "IK_F7", "IK_F8", "IK_F11"}, id));
        Check("0.8 the frame carries the ask's keys and the ink panel's report of it", before["ask"]["choices"].size() == 2 &&
                                                                                        before["ask"]["choices"][0]["key"] == "IK_F6" && before.value("ink_shows", 0ull) == id);
        Check("0.8 a report for another question isn't passed on", !k::ParseFrame(k::BuildFrame(settings, view, board, {"IK_F6"}, id + 7)).contains("ink_shows"));
        board.Answer(id, 1, t0);
        xfb::AnsweredAsk answered;
        const auto after = k::ParseFrame(k::BuildFrame(settings, view, board, {"IK_F6", "IK_F7"}, id));
        Check("0.8 once answered: the question stays, the answer replaces the keys",
              board.Answered(answered, t0) && answered.label == "Partly cut off" && after["messages"][0]["text"] == "Fully visible?" &&
                  !after.contains("ask") && after["answered"]["label"] == "Partly cut off" && after["answered"]["id"] == id);
        const auto snap = json::parse(board.Snapshot(t0 + std::chrono::seconds(20)));
        Check("0.8 the answered ask outlasts the old six seconds", snap["answered_ask"]["label"] == "Partly cut off" && !snap.contains("pending_ask"));
        board.Post({"Next step", 8, "info", false}, t0);
        Check("0.8 the next message takes the answered ask away", !board.Answered(answered, t0) && board.Active(t0) == 1 &&
                                                                   board.StateOf(id, t0).state == "answered");
    }

    // The UI review's 3, 4 and 14: one wording, plain words, the colour meaning.
    {
        k::BridgeView view;
        view.pluginEnabled = view.listening = view.allowWrites = view.hasClient = true;
        const auto connected = k::Summarize(view);
        Check("0.8 the status: XF Studio connected · changes allowed, amber",
              connected.text == "XF Studio connected \xC2\xB7 changes allowed" && connected.label == "XF Runtime Bridge \xC2\xB7 XF Studio connected \xC2\xB7 changes allowed" &&
                  connected.tone == "write" && connected.connection == "XF Studio connected" && connected.connectionTone == "ok" && connected.changesTone == "write");
        auto readOnly = view;
        readOnly.allowWrites = false;
        auto waiting = view;
        waiting.hasClient = false;
        auto off = view;
        off.pluginEnabled = false;
        auto idle = view;
        idle.listening = false;
        auto killed = view;
        killed.killed = true;
        Check("0.8 the status: read-only green, not connected grey, off grey, not ready grey, stopped red",
              k::Summarize(readOnly).tone == "ok" && k::Summarize(readOnly).text == "XF Studio connected \xC2\xB7 read-only" &&
                  k::Summarize(waiting).text == "XF Studio not connected \xC2\xB7 changes allowed" && k::Summarize(waiting).connectionTone == "idle" &&
                  k::Summarize(off).text == "Switched off in the bridge's settings." && k::Summarize(off).tone == "off" &&
                  k::Summarize(idle).text == "Not ready yet. Restart the game if this stays." && k::Summarize(idle).tone == "idle" &&
                  k::Summarize(killed).tone == "killed" &&
                  k::Summarize(killed).text == "Stopped. Reconnect in the XF Runtime Bridge window (open the CET overlay), or restart the game.");
        bool plain = true;
        for (const auto& v : {view, readOnly, waiting, off, idle, killed})
        {
            const auto status = k::Summarize(v);
            for (const auto* word : {"listening", "writes ON", "client", "an XF tool", "config.ini"})
            {
                plain = plain && status.text.find(word) == std::string::npos && status.connection.find(word) == std::string::npos;
            }
        }
        Check("0.8 no jargon in any state (listening, writes ON, client, an XF tool, config.ini)", plain);
        Check("0.8 the CET layer reads the same wording (StatusJson)", k::StatusJson(view)["label"] == connected.label && k::StatusJson(view)["changes_tone"] == "write");
        Check("0.8 key labels drop IK_", k::KeyLabel("IK_F6") == "F6" && k::KeyLabel("F9") == "F9");
    }

    // Session 8's item 1: every documented anchor, center among them; the default top left below the XF box.
    {
        k::HudPanel panel;
        panel.SetDefaults({});
        Check("0.8 the default panel: top left, 40 by 360 of the visible screen", panel.Current().anchor == "top_left" && panel.Current().x == 40.0 &&
                                                                                   panel.Current().y == 360.0);
        bool all = true;
        for (const auto* anchor : {"top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"})
        {
            all = all && panel.Configure(json{{"anchor", anchor}})["settings"]["anchor"] == anchor;
        }
        Check("0.8 ui.hud takes all nine anchors, center included", all);
        Check("0.8 center takes negative offsets from the middle", panel.Configure(json{{"anchor", "center"}, {"x", -300}, {"y", -120}})["settings"]["x"] == -300.0);
    }

    // Session 8's I5c: Streamline's proxies resolved to their native objects before the device check.
    {
        Check("0.8 overlay: one object is one device", o::MatchDevices({10, 0}, {10, 0}).same && !o::MatchDevices({10, 0}, {10, 0}).throughProxy);
        Check("0.8 overlay: a proxy swap chain's device and the engine's native device match through the proxy",
              o::MatchDevices({20, 10}, {10, 0}).same && o::MatchDevices({20, 10}, {10, 0}).throughProxy && o::MatchDevices({10, 0}, {30, 10}).same &&
                  o::MatchDevices({20, 10}, {30, 10}).same);
        Check("0.8 overlay: two different native devices, or an unknown one, never match",
              !o::MatchDevices({20, 11}, {30, 10}).same && !o::MatchDevices({0, 0}, {10, 0}).same && !o::MatchDevices({20, 0}, {30, 0}).same);
        o::DeviceFacts facts;
        facts.deviceData = facts.swapChain = facts.directQueue = true;
        facts.format = "R8G8B8A8_UNORM";
        facts.windowClass = "W2ViewportClass";
        facts.bufferCount = 3;
        facts.sameDevice = false;
        Check("0.8 overlay: a device that doesn't match even through the proxy is still refused, and says so",
              o::RefusalFor(facts).find("Streamline") != std::string::npos);
        facts.sameDevice = true;
        facts.proxy = "streamline";
        Check("0.8 overlay: through Streamline's proxy the host may draw", o::RefusalFor(facts).empty());
        o::OverlayHost host;
        host.Configure(true, o::ThemeKind::Dark, 100);
        host.NoteHooks(true, true, true, "");
        host.NoteFrameGeneration({"sl.dlss_g.dll"});
        host.NoteInit(facts, "");
        Check("0.8 overlay: drawing with frame generation isn't 'off for frame generation'; the answer names the proxy",
              !host.OffForFrameGeneration() && host.Snapshot()["swap_chain_proxy"] == "streamline");
        auto refused = facts;
        refused.sameDevice = false;
        host.NoteInit(refused, o::RefusalFor(refused));
        Check("0.8 overlay: refused while a frame-generation module is loaded tells the CET label", host.OffForFrameGeneration());
        Check("0.8 config: the overlay's diagnostics are off unless asked for", !xfb::ParseConfig("").overlayDiagnostics &&
                                                                                 xfb::ParseConfig("[overlay]\ndiagnostics = true\n").overlayDiagnostics);
    }

    // Session 8's D4: the camera turning away from a look's point ends it user_took_over (camera_drift).
    {
        b::Runner runner;
        xfb::EventLog events;
        runner.SetEvents(&events);
        const auto allow = [](xfb::Access) {};
        double camYaw = 0.0; // degrees, 0 = +Y, 90 = -X
        b::Ops fake;
        fake.camera = [&] {
            const double r = camYaw * 3.14159265358979 / 180.0;
            return json{{"position", {0, 0, 0}}, {"forward", {-std::sin(r), std::cos(r), 0.0}}};
        };
        fake.lookAt = [](const b::Vec3&, double) {};
        fake.watchInput = [](bool) {};
        fake.player = [] { return json{{"position", {0, 0, 0}}, {"yaw", 0.0}, {"busy", ""}, {"took_over", ""}}; };
        runner.Start(b::StartParams("look", json{{"turn", {{"yaw", 90}}}, {"duration_s", 4}}), allow);
        runner.Tick(0.1, fake, true); // starting
        for (int i = 0; i < 4; ++i)
        {
            camYaw += 10.0; // the look turning the camera towards its point
            runner.Tick(0.1, fake, true);
        }
        Check("0.8 behave.look: turning towards its point keeps it running", runner.Active());
        camYaw -= 12.0; // the player's mouse turns it back
        runner.Tick(0.1, fake, true);
        const auto all = events.Read(0, 100, {"behaviour"})["events"];
        const auto stop = all.empty() ? json() : all.back()["data"];
        Check("0.8 behave.look: the camera turning away ends it user_took_over, input camera_drift",
              !runner.Active() && stop.value("reason", std::string()) == "user_took_over" && stop.value("input", std::string()) == "camera_drift", stop.dump());
        runner.Start(b::StartParams("look", json{{"turn", {{"yaw", 90}}}}), allow);
        camYaw = 0.0;
        runner.Tick(0.1, fake, true);
        camYaw = -5.0; // at once, inside the grace time: not yet the player's
        runner.Tick(0.1, fake, true);
        Check("0.8 behave.look: a wobble in the first quarter second doesn't end it", runner.Active());
        runner.DropAll("test");
    }

    // Session 8's H1: game.saves asks for the newest limit saves' details and stops once they are in.
    {
        namespace h = xfb::hooks;
        h::SavesOps ops;
        int32_t asked = 0;
        int reads = 0;
        auto now = std::chrono::steady_clock::now();
        ops.request = [&](int32_t aLimit) { asked = aLimit; };
        ops.read = [&](bool aDone) -> json {
            ++reads;
            json metadata = json::array();
            for (int i = 0; i < std::min(reads, 5); ++i)
            {
                metadata.push_back({{"index", i}, {"name", "Save-" + std::to_string(i)}, {"timestamp", 100 - i}});
            }
            json names = json::array();
            for (int i = 0; i < 40; ++i)
            {
                names.push_back("Save-" + std::to_string(i));
            }
            return json{{"ready", true}, {"names", names}, {"metadata", aDone ? metadata : metadata}};
        };
        ops.sleep = [&](std::chrono::milliseconds aMs) { now += aMs; };
        ops.now = [&] { return now; };
        h::SavesRequest request;
        request.limit = 3;
        const auto out = h::RunSaves(request, ops);
        Check("0.8 game.saves asks the game for the newest limit saves' details", asked == 3);
        Check("0.8 game.saves stops once the asked-for details are in (not after the whole list)", reads <= 5 && out["saves"].size() == 3, out.dump());
    }

    // Loading from the main menu: the load step is tried again while the save's details arrive.
    {
        namespace w = xfb::writes;
        namespace p = xfb::params;
        auto now = std::chrono::steady_clock::now();
        int tries = 0;
        std::string loaded;
        w::LoadOps ops;
        ops.guard = [] {};
        ops.latest = [] { return json{{"route", "main_menu_continue"}}; };
        ops.list = [] { return json{{"requested", true}}; };
        ops.saves = [] { return json{{"ready", true}, {"saves", {"ManualSave-9", "AutoSave-1"}}}; };
        ops.load = [&](const std::string& aName) -> json {
            if (++tries < 3)
            {
                throw xfb::MethodError("metadata_pending", "details not in yet");
            }
            loaded = aName;
            return json{{"route", "main_menu_load"}, {"modded", true}};
        };
        ops.sleep = [&](std::chrono::milliseconds aMs) { now += aMs; };
        ops.now = [&] { return now; };
        const auto out = w::GameLoad(p::ParseGameLoad(json{{"name", "ManualSave-9"}, {"discard_unsaved", true}}), ops);
        Check("0.8 game.load at the main menu waits for the save's details, then loads it", loaded == "ManualSave-9" && tries == 3 && out["route"] == "main_menu_load");
        tries = -1000;
        const auto code = ParamsCode([&] { w::GameLoad(p::ParseGameLoad(json{{"name", "AutoSave-1"}, {"discard_unsaved", true}}), ops); });
        Check("0.8 game.load gives up with timeout when the details never come, having loaded nothing", code == "timeout" && loaded == "ManualSave-9");
    }
}

// Bridge 0.8.1: the wave-4 review's native fixes (RB-122, RB-123, RB-125, RB-127; RB-119's checks are with the save's).
void Bridge081Tests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;

    // RB-122: a write accepted before the player paused (or handed over) is refused on the game thread, right before it runs.
    {
        xfb::Config config;
        config.allowWrites = true;
        xfb::Session session;
        std::string error;
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-rb122-not-created");
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        xfb::Dispatcher dispatcher(config, session, queue);
        std::atomic<int> single{0}, first{0}, second{0}, restored{0}, reads{0};
        dispatcher.Register({"unit.write", xfb::Access::Write, xfb::RunOn::GameThread, "a one-step write", [&](const xfb::MethodContext&) {
                                 ++single;
                                 return json::object();
                             }});
        dispatcher.Register({"unit.read", xfb::Access::Read, xfb::RunOn::GameThread, "a read", [&](const xfb::MethodContext&) {
                                 ++reads;
                                 return json::object();
                             }});
        // A multi-step write as the handlers write them: each changing step through RunWrite, and on a refusal a step that
        // puts things back inside a RestoreScope (never refused by the write gate).
        dispatcher.Register({"unit.multi", xfb::Access::Write, xfb::RunOn::BridgeThread, "a two-step write", [&](const xfb::MethodContext&) {
                                 dispatcher.RunWrite(1000ms, [&] { ++first; return json::object(); }, "unit.first");
                                 try
                                 {
                                     dispatcher.RunWrite(1000ms, [&] { ++second; return json::object(); }, "unit.second");
                                 }
                                 catch (const xfb::MethodError&)
                                 {
                                     xfb::RestoreScope restoring;
                                     dispatcher.RunWrite(1000ms, [&] { ++restored; return json::object(); }, "unit.restore");
                                     throw;
                                 }
                                 return json::object();
                             }});
        // The game gate runs on the game thread right before each task: here it plays the player's switch flipping
        // between the queueing and the run, on the gate call given.
        std::atomic<int> gateCalls{0};
        std::atomic<int> flipOn{-1};
        std::function<void()> flip;
        xfb::SetGameGate([&](const std::string&) {
            if (++gateCalls == flipOn.load() && flip)
            {
                flip();
            }
        });
        std::atomic<bool> stop{false};
        std::thread pump([&] {
            while (!stop.load())
            {
                queue.Drain(4);
                std::this_thread::sleep_for(1ms);
            }
        });
        const auto send = [&](const std::string& aMethod) {
            const auto line = json{{"v", 1}, {"id", 1}, {"token", session.token}, {"method", aMethod}}.dump();
            const auto reply = json::parse(dispatcher.Handle(line, 1).line);
            return reply.value("ok", false) ? std::string("ok") : reply["error"].value("code", std::string("?"));
        };
        const auto arm = [&](int aCall, std::function<void()> aFlip) {
            gateCalls = 0;
            flip = std::move(aFlip);
            flipOn = aCall;
        };

        arm(-1, {});
        const auto plain = send("unit.write");
        arm(1, [&] { dispatcher.SetWritesPaused(true); });
        const auto paused = send("unit.write");
        Check("RB-122: a one-step write paused between its queueing and its run is refused writes_paused and never runs",
              plain == "ok" && paused == "writes_paused" && single.load() == 1, plain + " " + paused);
        const auto read = send("unit.read");
        Check("RB-122: reads still run while changes are paused", read == "ok" && reads.load() == 1, read);
        dispatcher.SetWritesPaused(false);

        arm(1, [&] { dispatcher.SetHandover(true); });
        const auto handedFirst = send("unit.multi");
        Check("RB-122: a multi-step write's first step is checked on the game thread too (handed_over, nothing ran)",
              handedFirst == "handed_over" && first.load() == 0 && second.load() == 0 && restored.load() == 0, handedFirst);
        dispatcher.SetHandover(false);

        arm(2, [&] { dispatcher.SetWritesPaused(true); });
        const auto pausedSecond = send("unit.multi");
        Check("RB-122: every changing step is checked, however many came before; the put-back step (RestoreScope) still runs",
              pausedSecond == "writes_paused" && first.load() == 1 && second.load() == 0 && restored.load() == 1, pausedSecond);
        dispatcher.SetWritesPaused(false);

        arm(-1, {});
        const auto clean = send("unit.multi");
        Check("RB-122: with nothing in between, every step runs", clean == "ok" && first.load() == 2 && second.load() == 1 && restored.load() == 1, clean);

        // Real multi-step handlers (core/Writes.cpp) with their steps bound as the plugin binds them.
        dispatcher.SetWritesPaused(false);
        arm(-1, {});
        {
            // photo.pose.set: the category changes, photo mode settles for a few ticks, the player pauses, then the pose
            // step is refused and the category is put back.
            int category = 1;
            int poseSelected = 0;
            w::PoseSetOps ops;
            ops.category = [&] {
                return dispatcher.RunWrite(1000ms, [&] {
                    const int before = category;
                    category = 7;
                    return json{{"changed", true}, {"before_known", true}, {"before_category", before}, {"before_pose", 0},
                                {"category_value", 7}, {"category_text", "XF"}};
                }, "unit.pose.category");
            };
            ops.settle = [&] { dispatcher.SetWritesPaused(true); };
            ops.pose = [&] {
                return dispatcher.RunWrite(1000ms, [&] { ++poseSelected; return json{{"changed", true}, {"pose_value", 3}}; }, "unit.pose.pose");
            };
            ops.restoreCategory = [&](int32_t aValue) {
                dispatcher.RunWrite(1000ms, [&, aValue] { category = aValue; return json::object(); }, "unit.pose.restore");
            };
            const auto code = ParamsCode([&] { w::PoseSet(ops); });
            Check("RB-122: photo.pose.set paused during its settle selects no pose and puts the category back",
                  code == "writes_paused" && poseSelected == 0 && category == 1, code + " category=" + std::to_string(category));
            dispatcher.SetWritesPaused(false);
        }
        {
            // photo.light.set: the light is selected, photo mode loads it, the player pauses, then the value step is
            // refused and the earlier selection comes back.
            int selected = 0; // light 1
            int values = 0;
            w::LightOps ops;
            ops.set = [&](int32_t aKey, float aValue) {
                return dispatcher.RunWrite(1000ms, [&, aKey, aValue] {
                    if (aKey == xfb::params::key::kLightSelect)
                    {
                        const int before = selected;
                        selected = static_cast<int>(aValue);
                        return json{{"before", before}, {"after", aValue}};
                    }
                    ++values;
                    return json{{"before", 0.0}, {"after", aValue}};
                }, "unit.light.set");
            };
            ops.settle = [&] { dispatcher.SetWritesPaused(true); };
            const auto code = ParamsCode([&] { w::LightSet(xfb::params::ParseLight(json{{"light", 2}, {"brightness", 50}}), ops); });
            Check("RB-122: photo.light.set paused after its selection sets no value and selects the earlier light again",
                  code == "writes_paused" && values == 0 && selected == 0, code + " selected=" + std::to_string(selected));
            dispatcher.SetWritesPaused(false);
        }
        // Round 3b: the condition is observed after the game gate, on the executing frame.
        std::atomic<bool> combat{false};
        dispatcher.SetPreconditionReader([&](const json&) {
            return json{{"phase", "gameplay"}, {"combat", combat.load()}, {"vehicle", false}, {"spawned", {{"7", true}}}};
        });
        const auto guarded = [&](const std::string& method, const json& when) {
            return json::parse(dispatcher.Handle(json{{"v", 1}, {"id", 1}, {"token", session.token}, {"method", method},
                {"params", {{"when", when}}}}.dump(), 1).line);
        };
        auto beforeSingle = single.load();
        arm(1, [&] { combat = true; });
        const auto stale = guarded("unit.write", {{"combat", false}});
        Check("timeline: changed after queueing refuses before action with observed state",
            !stale["ok"].get<bool>() && stale["error"]["code"] == "precondition_failed" && single == beforeSingle &&
            json::parse(stale["error"]["message"].get<std::string>())["observed"]["combat"] == true, stale.dump());
        combat = false;
        arm(-1, {});
        Check("timeline: all plain-data conditions compare on one frame",
            guarded("unit.write", {{"phase", "gameplay"}, {"vehicle", false}, {"combat", false}, {"spawned", json::array({7})}})["ok"] == true);
        beforeSingle = single.load();
        Check("timeline: a missing spawn prevents action", guarded("unit.write", {{"spawned", json::array({8})}})["error"]["code"] == "precondition_failed" && single == beforeSingle);
        Check("timeline: unknown condition refuses before action", guarded("unit.write", {{"eval", "code"}})["error"]["code"] == "bad_params" && single == beforeSingle);
        const auto beforeFirst = first.load(), beforeSecond = second.load(), beforeRestore = restored.load();
        arm(2, [&] { combat = true; });
        Check("timeline: multi-step actions recheck each changing frame and allow restoration",
            guarded("unit.multi", {{"combat", false}})["error"]["code"] == "precondition_failed" && first == beforeFirst + 1 && second == beforeSecond && restored == beforeRestore + 1);
        arm(-1, {});
        Check("timeline: guard does not leak into the next request", send("unit.write") == "ok");
        dispatcher.SetPreconditionReader({});
        Check("timeline: an unavailable reader refuses closed", guarded("unit.write", {{"combat", false}})["error"]["code"] == "precondition_unavailable");
        stop.store(true);
        pump.join();
        xfb::SetGameGate({});
    }

    // RB-123: scene.read's points.
    {
        namespace scene = xfb::scene;
        Check("RB-123: scene.read refuses a null point before reading it",
              ParamsCode([] { scene::ParseRead(json{{"points", json::array({nullptr})}}); }) == "bad_params" &&
                  ParamsCode([] { scene::ParseRead(json{{"points", json::array({json::array({1, 2, 3}), nullptr})}}); }) == "bad_params");
        Check("RB-123: and points that aren't three finite numbers within 1e6 m",
              ParamsCode([] { scene::ParseRead(json{{"points", json::array({json::array({1, 2})})}}); }) == "bad_params" &&
                  ParamsCode([] { scene::ParseRead(json{{"points", json::array({json::array({1, 2, "x"})})}}); }) == "bad_params" &&
                  ParamsCode([] { scene::ParseRead(json{{"points", json::array({json::array({1, 2, 2e6})})}}); }) == "bad_params");
        const auto ok = scene::ParseRead(json{{"points", json::array({json::array({1, 2, 3})})}});
        Check("RB-123: a good point is read", ok.points.size() == 1 && ok.points[0][2] == 3.0);
    }

    // RB-125: inventory undo names the exact copy.
    {
        Check("RB-125: inventory.equip's id is the decimal identity an undo gives",
              ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Items.Cap_01"}, {"id", "1234567890123"}}); }) == "ok" &&
                  p::ParseInventoryEquip(json{{"item", "Items.Cap_01"}, {"id", "42"}}).id == "42" &&
                  ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Items.Cap_01"}, {"id", "12a"}}); }) == "bad_params" &&
                  ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Items.Cap_01"}, {"id", 42}}); }) == "bad_params" &&
                  ParamsCode([] { p::ParseInventoryEquip(json{{"item", "Items.Cap_01"}, {"id", std::string(21, '1')}}); }) == "bad_params");
        FakeWardrobe wardrobe;
        wardrobe.worn["Head"] = "Items.Cap_01";
        auto ops = wardrobe.Ops("Items.Helmet_01", "Head", false);
        const auto equip = ops.equip;
        ops.equip = [equip] {
            auto step = equip();
            step["previous_id"] = "987654321";
            return step;
        };
        const auto out = w::InventoryEquip(p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}}), ops);
        Check("RB-125: equip over another item: the undo equips that exact copy (its id)",
              out["undo"] == json{{"method", "inventory.equip"}, {"params", {{"item", "Items.Cap_01"}, {"slot", "Head"}, {"id", "987654321"}}}}, out.dump());
        const auto again = w::InventoryEquip(p::ParseInventoryEquip(out["undo"]["params"]), wardrobe.Ops("Items.Cap_01", "Head", false));
        Check("RB-125: the undo's parameters parse and run", again["equipped"] == true, again.dump());

        FakeWardrobe other;
        other.worn["Head"] = "Items.Cap_01";
        auto odd = other.Ops("Items.Helmet_01", "Head", false);
        const auto oddEquip = odd.equip;
        odd.equip = [oddEquip] {
            auto step = oddEquip();
            step["previous_id"] = "not digits";
            step["exact"] = false;
            return step;
        };
        const auto loose = w::InventoryEquip(p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}, {"id", "55"}}), odd);
        Check("RB-125: an identity that isn't digits is left out; a copy that wasn't found says so",
              !loose["undo"]["params"].contains("id") && loose["exact"] == false && loose.value("exact_note", std::string()).find("55") != std::string::npos,
              loose.dump());

        FakeWardrobe worn;
        worn.worn["Head"] = "Items.Cap_01";
        auto unequipOps = worn.Ops("Items.Cap_01", "Head", false);
        const auto unequip = unequipOps.unequip;
        unequipOps.unequip = [unequip] {
            auto step = unequip();
            step["previous_id"] = "31337";
            return step;
        };
        const auto off = w::InventoryUnequip(p::ParseInventoryUnequip(json{{"slot", "Head"}}), unequipOps);
        {
            FakeWardrobe polled;
            auto pollOps = polled.Ops("Items.Helmet_01", "Head", false);
            const auto pollEquip = pollOps.equip;
            pollOps.equip = [pollEquip] {
                auto step = pollEquip();
                step["id"] = "424242";
                return step;
            };
            w::InventoryEquip(p::ParseInventoryEquip(json{{"item", "Items.Helmet_01"}}), pollOps);
            Check("RB-125: the wait after an equip reads the slot for the exact copy the equip step chose",
                  !polled.askedIds.empty() && std::all_of(polled.askedIds.begin(), polled.askedIds.end(), [](const std::string& aId) { return aId == "424242"; }));
        }
        Check("RB-125: unequip's undo equips the exact copy again",
              off["undo"] == json{{"method", "inventory.equip"}, {"params", {{"item", "Items.Cap_01"}, {"slot", "Head"}, {"id", "31337"}}}}, off.dump());
    }

    // RB-127: a long teleport's undo carries far.
    {
        namespace pl = xfb::player;
        const auto farUndo = pl::TeleportUndo({100, 200, 10}, 45.0, {100, 290, 10});
        const auto nearUndo = pl::TeleportUndo({100, 200, 10}, 45.0, {100, 230, 10});
        Check("RB-127: a teleport's undo beyond 50 m has far: true, a short one doesn't",
              farUndo["params"].value("far", false) && !nearUndo["params"].contains("far") && farUndo["params"]["ground"] == "exact" &&
                  farUndo["params"]["yaw"] == 45.0 && farUndo["method"] == "player.teleport",
              farUndo.dump() + " " + nearUndo.dump());
        Check("RB-127: the undo parses as a teleport the bridge accepts", ParamsCode([&] { pl::ParseTeleport(farUndo["params"]); }) == "ok" &&
                                                                              pl::ParseTeleport(farUndo["params"]).farOk);
    }
}

// 0.8.2: the re-check's findings (native side) and session 9's bridge fixes.
void Bridge082Tests()
{
    namespace p = xfb::params;
    namespace w = xfb::writes;

    // A dispatcher with a pump thread draining the queue and the cleanup lane, as the plugin's Running update does.
    struct Rig
    {
        xfb::Config config;
        xfb::Session session;
        xfb::GameThreadQueue queue;
        std::unique_ptr<xfb::Dispatcher> dispatcher;
        std::atomic<bool> stop{false};
        std::thread pump;
        Rig()
        {
            config.allowWrites = true;
            std::string error;
            wchar_t temp[MAX_PATH]{};
            GetTempPathW(MAX_PATH, temp);
            xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-082-not-created");
            queue.SetPumping(true);
            dispatcher = std::make_unique<xfb::Dispatcher>(config, session, queue);
            pump = std::thread([this] {
                while (!stop.load())
                {
                    queue.Drain(4);
                    queue.DrainCleanup(4);
                    std::this_thread::sleep_for(1ms);
                }
            });
        }
        ~Rig()
        {
            stop.store(true);
            pump.join();
        }
        void Kill()
        {
            dispatcher->Kill("unit");
            queue.Close();
        }
    };
    const auto waitFor = [](const std::function<bool()>& aDone) {
        const auto deadline = std::chrono::steady_clock::now() + 2s;
        while (!aDone() && std::chrono::steady_clock::now() < deadline)
        {
            std::this_thread::sleep_for(2ms);
        }
        return aDone();
    };
    xfb::SetGameGate({});

    // Re-check finding 6: the kill switch during photo.pose.set's settle. The pose step is refused; the category's put-back
    // goes on the cleanup lane (the queue is closed) and the game thread runs it.
    {
        Rig rig;
        auto& d = *rig.dispatcher;
        std::atomic<int> category{1};
        std::atomic<int> poseSelected{0};
        w::PoseSetOps ops;
        ops.category = [&] {
            return d.RunWrite(1000ms, [&] {
                const int before = category.exchange(7);
                return json{{"changed", true}, {"before_known", true}, {"before_category", before}, {"before_pose", 0}, {"category_value", 7}, {"category_text", "XF"}};
            }, "unit.pose.category");
        };
        ops.settle = [&] { rig.Kill(); };
        ops.pose = [&] { return d.RunWrite(1000ms, [&] { ++poseSelected; return json{{"changed", true}}; }, "unit.pose.pose"); };
        ops.restoreCategory = [&](int32_t aValue) { d.RunWrite(1000ms, [&, aValue] { category = aValue; return json::object(); }, "unit.pose.restore"); };
        std::string message;
        try
        {
            w::PoseSet(ops);
        }
        catch (const xfb::MethodError& e)
        {
            message = std::string(e.code) + ": " + e.what();
        }
        const bool restored = waitFor([&] { return category.load() == 1; });
        Check("0.8.2 (re-check 6): photo.pose.set killed during its settle selects no pose, and the category's put-back runs on the cleanup lane",
              message.rfind("killed:", 0) == 0 && poseSelected == 0 && restored && message.find("put back") != std::string::npos,
              message + " category=" + std::to_string(category.load()));
        Check("0.8.2 (re-check 6): a forward write after the kill is still refused (never on the cleanup lane)",
              ParamsCode([&] { d.RunWrite(200ms, [&] { category = 9; return json::object(); }, "unit.forward"); }) == "killed" && category.load() == 1 &&
                  rig.queue.PendingCleanups() == 0);
    }
    {
        xfb::GameThreadQueue queue;
        queue.Close();
        size_t accepted = 0;
        for (size_t i = 0; i < xfb::GameThreadQueue::kCleanupCapacity + 3; ++i)
        {
            accepted += queue.PostCleanup([] { return json::object(); }, "unit.cap") ? 1 : 0;
        }
        const auto ran = queue.DrainCleanup(100);
        std::atomic<int> after{0};
        queue.PostCleanup([]() -> json { throw std::runtime_error("x"); }, "unit.throw");
        queue.PostCleanup([&] { ++after; return json::object(); }, "unit.after");
        queue.DrainCleanup(100);
        Check("0.8.2: the cleanup lane is bounded, accepted while closed, and a failing step doesn't stop the next",
              accepted == xfb::GameThreadQueue::kCleanupCapacity && ran == xfb::GameThreadQueue::kCleanupCapacity && after == 1 && queue.PendingCleanups() == 0,
              std::to_string(accepted) + " " + std::to_string(ran));
    }

    // Re-check finding 4: place "camera" switches the light off and on; the switch on is the placement, so it is gated.
    struct LightFake : FakePhoto
    {
        std::map<int32_t, std::array<double, 3>> at;
        xfb::Dispatcher* d = nullptr;
        std::atomic<int> placed{0};
        xfb::writes::LightOps Ops(std::function<void()> aSettle)
        {
            auto ops = FakePhoto::Ops();
            const auto base = ops.set;
            // By value: a step put on the cleanup lane runs after this call has returned.
            ops.set = [this, base](int32_t aKey, float aValue) { return d->RunWrite(1000ms, [base, aKey, aValue] { return base(aKey, aValue); }, "unit.light.set"); };
            ops.settle = aSettle;
            ops.place = [this](int32_t aLight, const p::LightPlacement& aPlace) {
                return d->RunWrite(1000ms, [this, aLight, aPlace] {
                    ++placed;
                    calls.push_back("place " + std::to_string(aLight));
                    const auto before = at[aLight];
                    at[aLight] = {aPlace.world[0], aPlace.world[1], aPlace.world[2]};
                    const auto vec = [](const std::array<double, 3>& v) { return json{{"x", v[0]}, {"y", v[1]}, {"z", v[2]}}; };
                    return json{{"before", vec(before)}, {"after", vec(at[aLight])}};
                }, "unit.light.place");
            };
            ops.position = [this](int32_t aLight) {
                const auto v = at[aLight];
                return json{{"position", {{"x", v[0]}, {"y", v[1]}, {"z", v[2]}}}};
            };
            return ops;
        }
    };
    {
        Rig rig;
        LightFake fake;
        fake.d = rig.dispatcher.get();
        fake.values[p::key::kLightSelect] = 0;
        fake.values[p::key::kLightState] = 0; // off
        fake.at[1] = {9.0, 9.0, 9.0};
        bool paused = false;
        const auto code = ParamsCode([&] {
            w::LightSet(p::ParseLight(json{{"light", 1}, {"place", "camera"}}), fake.Ops([&] {
                if (!paused)
                {
                    paused = true;
                    rig.dispatcher->SetWritesPaused(true);
                }
            }));
        });
        Check("0.8.2 (re-check 4): a light that was off, placed at the camera and paused during the settle, stays off (the switch on is gated)",
              code == "writes_paused" && fake.values[p::key::kLightState] == 0.0f &&
                  std::find(fake.calls.begin(), fake.calls.end(), std::to_string(p::key::kLightState) + "=1") == fake.calls.end(),
              code);
    }
    {
        Rig rig;
        LightFake fake;
        fake.d = rig.dispatcher.get();
        fake.values[p::key::kLightSelect] = 0;
        fake.values[p::key::kLightState] = 1; // on
        fake.at[1] = {9.0, 9.0, 9.0};
        bool paused = false;
        const auto code = ParamsCode([&] {
            w::LightSet(p::ParseLight(json{{"light", 1}, {"place", "camera"}}), fake.Ops([&] {
                if (!paused)
                {
                    paused = true;
                    // In the game photo mode moves the light as it switches; here the pause comes first, so only the
                    // light's earlier state may come back.
                    fake.at[1] = {1.0, 2.0, 3.0};
                    rig.dispatcher->SetWritesPaused(true);
                }
            }));
        });
        Check("0.8.2 (re-check 4): a light that was on comes back on and to where it stood (its earlier state, not the placement)",
              code == "writes_paused" && fake.values[p::key::kLightState] == 1.0f && fake.at[1] == std::array<double, 3>{9.0, 9.0, 9.0}, code);
    }

    {
        // 0.8.2 (the review): the kill switch during the settle between the switch-off and the switch-on. The real settle
        // fails then (WaitTicks sees the closed queue); the light, which was on, comes back on and to where it stood, through
        // the cleanup lane. 0.8.2's first fix kept the settle outside the guard and left the light dark; a settle that only
        // paused (as the tests above) didn't show it.
        Rig rig;
        LightFake fake;
        fake.d = rig.dispatcher.get();
        fake.values[p::key::kLightSelect] = 0;
        fake.values[p::key::kLightState] = 1; // on
        fake.at[1] = {9.0, 9.0, 9.0};
        bool killed = false;
        const auto code = ParamsCode([&] {
            w::LightSet(p::ParseLight(json{{"light", 1}, {"place", "camera"}}), fake.Ops([&] {
                if (!killed)
                {
                    killed = true;
                    fake.at[1] = {1.0, 2.0, 3.0};
                    rig.Kill();
                    throw xfb::MethodError("timeout", "photo mode didn't load the selected light's values in time");
                }
            }));
        });
        const bool restored = waitFor([&] { return fake.placed.load() >= 1; });
        Check("0.8.2 (review 3): killed during the settle, a light that was on comes back on and in place through the cleanup lane",
              code == "timeout" && restored && fake.values[p::key::kLightState] == 1.0f && fake.at[1] == std::array<double, 3>{9.0, 9.0, 9.0}, code);
    }

    // Review 2: a put-back step cancelled by the kill switch while queued goes on the cleanup lane (decided under the lock).
    {
        xfb::Config config;
        xfb::Session session;
        std::string error;
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        xfb::CreateSession(session, error, std::filesystem::path(temp) / L"xfb-unit-082-defer");
        xfb::GameThreadQueue queue;
        queue.SetPumping(true); // pumping, but nothing drains: the step waits in the queue
        xfb::Dispatcher dispatcher(config, session, queue);
        xfb::SetGameGate({});
        std::atomic<int> ran{0};
        json answer;
        std::thread restorer([&] {
            xfb::RestoreScope restoring;
            answer = dispatcher.RunWrite(5000ms, [&] { ++ran; return json::object(); }, "unit.restore.queued");
        });
        std::this_thread::sleep_for(50ms);
        dispatcher.Kill("unit");
        queue.Close();
        restorer.join();
        const auto pending = queue.PendingCleanups();
        queue.DrainCleanup(4);
        Check("0.8.2 (review 2): a put-back step the kill switch cancelled while it waited is posted to the cleanup lane, and runs there",
              answer.value("deferred_to_cleanup", false) && pending == 1 && ran == 1, answer.dump());
        xfb::GameThreadQueue closed;
        closed.Close();
        json result;
        std::string closedError;
        const auto refused = closed.Run([] { return json::object(); }, 100ms, result, closedError, "unit.forward");
        const auto deferred = closed.Run([] { return json::object(); }, 100ms, result, closedError, "unit.restore", xfb::GameThreadQueue::kDefaultRunningGrace,
                                         [] { return json::object(); });
        Check("0.8.2 (review 2): a closed queue refuses a forward step and defers a put-back one",
              refused == xfb::QueueResult::NotPumping && deferred == xfb::QueueResult::Deferred && closed.PendingCleanups() == 1);
    }

    // Re-check finding 2: player.stop between a look's steps ends it there.
    {
        Rig rig;
        auto& d = *rig.dispatcher;
        xfb::player::StopCount stops;
        std::atomic<int> turned{0}, looked{0};
        const auto seen = stops.Current();
        d.RunWrite(1000ms, [&] { stops.Require(seen, "unit.look"); ++turned; return json::object(); }, "unit.look.turn");
        stops.Stop(); // player.stop on the control pipe during the one-tick wait
        const auto code = ParamsCode([&] { d.RunWrite(1000ms, [&] { stops.Require(seen, "unit.look"); ++looked; return json::object(); }, "unit.look.at"); });
        const auto fresh = stops.Current();
        const auto again = ParamsCode([&] { d.RunWrite(1000ms, [&] { stops.Require(fresh, "unit.look"); ++looked; return json::object(); }, "unit.look.at"); });
        Check("0.8.2 (re-check 2): a stop between a look's steps refuses the look-at (stopped), and a look started after it runs",
              turned == 1 && code == "stopped" && again == "ok" && looked == 1 && stops.StoppedSince(seen) && !stops.StoppedSince(fresh), code + " " + again);
    }
}


// 0.8.2: session 9's bridge fixes and the surfaces' rule (core pieces).
void Session9Tests()
{
    namespace p = xfb::params;
    namespace k = xfb::inkui;
    namespace h = xfb::hooks;
    namespace b = xfb::behave;
    const auto t0 = xfb::MessageBoard::Clock::now();

    // One question at a time (B6), a clear withdraws a waiting one, keep_asks keeps it (a capture's clear).
    {
        xfb::MessageBoard board;
        const auto first = board.Post({"First question?", 60, "ask", false}, t0)["id"].get<uint64_t>();
        const auto second = board.Post({"Second question?", 60, "ask", false}, t0);
        xfb::PendingAsk pending;
        Check("0.8.2 a new question withdraws the one still waiting (one pending ask at a time)",
              board.StateOf(first, t0).state == "gone" && second["withdrawn"] == json::array({first}) && board.Pending(pending, t0) &&
                  pending.id == second["id"].get<uint64_t>(),
              second.dump());
        board.Answer(pending.id, 0, t0);
        xfb::PendingAsk none;
        Check("0.8.2 answering it reveals no older question underneath", !board.Pending(none, t0));
        const auto third = board.Post({"Third?", 60, "ask", false}, t0)["id"].get<uint64_t>();
        board.Post({"", 8, "info", true, {}, true}, t0);
        Check("0.8.2 keep_asks: a capture's clear keeps the waiting question", board.StateOf(third, t0).state == "pending");
        board.Post({"", 8, "info", true}, t0);
        Check("0.8.2 a plain clear withdraws the waiting question", board.StateOf(third, t0).state == "gone" && board.Active(t0) == 0);
        Check("0.8.2 keep_asks goes with clear; clear_asks is still accepted (true only)",
              ParamsCode([] { p::ParseMessage(json{{"keep_asks", true}}); }) == "bad_params" &&
                  ParamsCode([] { p::ParseMessage(json{{"clear", true}, {"clear_asks", true}}); }) == "ok" &&
                  ParamsCode([] { p::ParseMessage(json{{"clear", true}, {"clear_asks", false}}); }) == "bad_params" &&
                  p::ParseMessage(json{{"clear", true}, {"keep_asks", true}}).keepAsks);
        std::string message;
        try
        {
            p::ParseMessage(json{{"text", "Which?"}, {"level", "ask"}, {"choices", {"A label well over twenty-four characters"}}});
        }
        catch (const xfb::MethodError& e)
        {
            message = e.what();
        }
        Check("0.8.2 (D2) a choice over 24 characters is refused, and the refusal says why and how long it may be",
              message.find("24 characters") != std::string::npos && message.find("button label") != std::string::npos, message);
        Check("0.8.2 a choice of exactly 24 characters is fine",
              ParamsCode([] { p::ParseMessage(json{{"text", "Which?"}, {"level", "ask"}, {"choices", {std::string(24, 'x')}}}); }) == "ok");
    }

    // game.saves (I1): limit applies to names, one entry per save.
    {
        const auto twice = json{{"index", 0}, {"name", "AutoSave-17"}, {"timestamp", 9}};
        const auto saves = h::TrimSaves(json{{"ready", true},
                                             {"names", {"AutoSave-17", "AutoSave-16", "AutoSave-15", "ManualSave-1"}},
                                             {"metadata", {twice, twice, {{"index", 1}, {"name", "AutoSave-16"}, {"timestamp", 8}}}}},
                                        2);
        Check("0.8.2 (I1) game.saves: the newest save once, names cut to limit, count the whole list",
              saves["saves"].size() == 2 && saves["saves"][0]["name"] == "AutoSave-17" && saves["saves"][1]["name"] == "AutoSave-16" &&
                  saves["names"] == json::array({"AutoSave-17", "AutoSave-16"}) && saves["count"] == 4 && saves["with_metadata"] == 2 &&
                  saves["note"].get<std::string>().empty(),
              saves.dump());
    }

    // The surfaces' rule and the frame's surface record.
    {
        Check("0.8.2 surfaces: the ink panel while it is on screen, else the XF box, else the CET line",
              k::ChooseStatusSurface({true, true}) == k::StatusSurface::InkPanel && k::ChooseStatusSurface({false, true}) == k::StatusSurface::XfBox &&
                  k::ChooseStatusSurface({false, false}) == k::StatusSurface::CetLine && k::ChooseStatusSurface({true, false}) == k::StatusSurface::InkPanel);
        Check("0.8.3 surfaces: none at all while no session is live (session 10: the XF box drew over the press-any-key screen)",
              k::ChooseStatusSurface({false, true, false}) == k::StatusSurface::None && k::ChooseStatusSurface({true, true, false}) == k::StatusSurface::None &&
                  k::ChooseStatusSurface({false, false, false}) == k::StatusSurface::None && std::string(k::SurfaceName(k::StatusSurface::None)) == "none");
        k::BridgeView view;
        view.pluginEnabled = true;
        view.listening = true;
        xfb::MessageBoard board;
        const auto frame = k::ParseFrame(k::BuildFrame(k::HudSettings{}, view, board, {"IK_F6"}, 0, k::StatusSurface::XfBox));
        Check("0.8.2 surfaces: the frame names the surface (the CET layer draws its line only for cet_line)",
              frame.value("surface", std::string()) == "xf_box" &&
                  k::ParseFrame(k::BuildFrame(k::HudSettings{}, view, board, {"IK_F6"}, 0))["surface"] == "cet_line",
              frame.dump());
        // Review 5: keys are offered only while they answer the question.
        board.Post({"Which?", 60, "ask", false, {"Yes", "No"}}, t0);
        xfb::PendingAsk pendingAsk;
        board.Pending(pendingAsk);
        const auto armed = k::ParseFrame(k::BuildFrame(k::HudSettings{}, view, board, {"IK_F6", "IK_F7"}, 0, k::StatusSurface::XfBox, pendingAsk.id));
        const auto unarmed = k::ParseFrame(k::BuildFrame(k::HudSettings{}, view, board, {"IK_F6", "IK_F7"}, 0, k::StatusSurface::XfBox, 0));
        Check("0.8.2 (review 5) the frame says whether the keys answer the question, and the XF box's line follows it",
              armed.value("keys", std::string()) == "1" && unarmed.value("keys", std::string()) == "0" &&
                  k::AnswerHint({"Yes", "No"}, {"IK_F6", "IK_F7"}, true) == "[F6] Yes   [F7] No" &&
                  k::AnswerHint({"Yes", "No"}, {"IK_F6", "IK_F7"}, false) == "Answer in the XF Runtime Bridge window (open the CET overlay).",
              armed.dump());
        // Connection status follows the session (session 9): a request a moment ago counts as connected.
        view.hasClient = false;
        view.inSession = true;
        const auto status = k::Summarize(view);
        view.inSession = false;
        Check("0.8.2 status: in a session (a recent request or the session lock) it says connected between calls",
              status.connection == "XF Studio connected" && k::Summarize(view).connection == "XF Studio not connected", status.connection);
    }

    // The session lock read by the plugin (status follows the session).
    {
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        xfb::Session session;
        session.runtimeDir = std::filesystem::path(temp) / L"xfb-unit-082-lock";
        std::filesystem::create_directories(session.runtimeDir);
        const auto lockFile = session.runtimeDir / L"session-runner.lock";
        const auto write = [&](const std::string& aText) {
            std::ofstream out(lockFile, std::ios::binary | std::ios::trunc);
            out << aText;
        };
        std::filesystem::remove(lockFile);
        const bool none = xfb::SessionRunnerActive(session);
        write(json{{"pid", GetCurrentProcessId()}, {"script", "unit"}}.dump());
        const bool mine = xfb::SessionRunnerActive(session);
        FILETIME created{}, exited{}, kernel{}, user{};
        GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user);
        const auto started = std::to_string((static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime);
        write(json{{"pid", GetCurrentProcessId()}, {"process_started", started}}.dump());
        const bool same = xfb::SessionRunnerActive(session);
        write(json{{"pid", GetCurrentProcessId()}, {"process_started", "1"}}.dump());
        const bool reused = xfb::SessionRunnerActive(session);
        write(json{{"pid", 4294967290ull}}.dump());
        const bool gone = xfb::SessionRunnerActive(session);
        write("not json");
        const bool bad = xfb::SessionRunnerActive(session);
        std::filesystem::remove_all(session.runtimeDir);
        Check("0.8.2 status: the session lock counts while its process runs (the same process: review 8); a missing, stale, reused-PID or unreadable lock doesn't",
              !none && mine && same && !reused && !gone && !bad);
    }

    // game.load's press-any-key screen: the puppet before the player.
    {
        xfb::ScriptLayer layer;
        layer.OnEvent("attach");
        const bool before = layer.Describe()["waiting_for_input"].get<bool>();
        layer.OnEvent("puppet");
        const auto waiting = layer.Describe();
        layer.OnEvent("player_attach");
        const auto ready = layer.Describe();
        layer.OnEvent("detach");
        layer.OnEvent("puppet"); // detached: no screen to wait on
        Check("0.8.2 load: puppet attachment never invents a press-any-key prompt during an in-game load",
              !before && waiting["waiting_for_input"] == false && waiting["puppet_attached"] == true && waiting["prompt_state"] == "unobserved" && ready["waiting_for_input"] == false && layer.Describe()["waiting_for_input"] == false &&
                  xfb::writes::StatusWhileLoading("loading", waiting)["waiting_for_input"] == false,
              waiting.dump());
    }

    // showroom.anchor's archives.
    {
        namespace s = xfb::showroom;
        const std::string key(32, 'a');
        Check("0.8.2 showroom.anchor: archive names (xfs_showroom_ and 32 hex digits) up to 16, nothing else",
              s::ParseAnchorArchives(json::object()).empty() && s::ParseAnchorArchives(json{{"archives", {"xfs_showroom_" + key}}}).size() == 1 &&
                  ParamsCode([&] { s::ParseAnchorArchives(json{{"archives", {"xfs_showroom_" + key + ".archive"}}}); }) == "bad_params" &&
                  ParamsCode([&] { s::ParseAnchorArchives(json{{"archives", {"..\\\\x"}}}); }) == "bad_params" &&
                  ParamsCode([&] { s::ParseAnchorArchives(json{{"archives", json::array({json(1)})}}); }) == "bad_params" &&
                  ParamsCode([&] { s::ParseAnchorArchives(json{{"other", 1}}); }) == "bad_params");
    }

    // behave.look takes its duration (D2: 4 s ran in 1.2 s): steered along its arc, reached only near the end.
    {
        b::Runner runner;
        b::Ops fake;
        double yaw = 0.0; // the camera's yaw, turned instantly towards each look-at point (a fast game look-at)
        int lookAts = 0;
        fake.camera = [&] {
            const double r = yaw * 3.14159265358979 / 180.0;
            return json{{"position", {0.0, 0.0, 1.7}}, {"forward", {-std::sin(r), std::cos(r), 0.0}}, {"right", {std::cos(r), std::sin(r), 0.0}},
                        {"up", {0, 0, 1}}, {"fov", 60.0}};
        };
        fake.lookAt = [&](const b::Vec3& aPoint, double) {
            ++lookAts;
            yaw = std::atan2(-aPoint[0], aPoint[1]) * 180.0 / 3.14159265358979;
        };
        fake.player = [] { return json{{"busy", ""}, {"phase", "gameplay"}}; };
        runner.Start(b::StartParams("look", json{{"turn", {{"yaw", 90}}}, {"duration_s", 4}}), [](xfb::Access) {});
        double t = 0.0;
        double halfway = -1.0;
        while (runner.Active() && t < 10.0)
        {
            runner.Tick(0.05, fake, true);
            t += 0.05;
            if (halfway < 0.0 && t >= 2.0)
            {
                halfway = yaw;
            }
        }
        Check("0.8.2 (D2) behave.look of 90 degrees over 4 s: half way at 2 s, done after about 4 s, steered in short steps",
              !runner.Active() && t >= 3.6 && t <= 4.6 && std::abs(halfway - 45.0) < 8.0 && lookAts >= 30,
              "t=" + std::to_string(t) + " halfway=" + std::to_string(halfway) + " lookAts=" + std::to_string(lookAts));
    }
    {
        // The review's case: from yaw 0, pitch 80 to yaw 180, pitch 0 over 4 s. Easing yaw and pitch apart moved the view away
        // from the point (100 to about 107 degrees) and the drift check stopped the look as the player's own input; on the
        // great circle the angle to the point only shrinks.
        b::Runner runner;
        xfb::EventLog events;
        runner.SetEvents(&events);
        b::Ops fake;
        const double k = 3.14159265358979 / 180.0;
        b::Vec3 forward{0.0, std::cos(80.0 * k), std::sin(80.0 * k)};
        const b::Vec3 camera{0.0, 0.0, 1.7};
        fake.camera = [&] { return json{{"position", camera}, {"forward", forward}, {"right", {1, 0, 0}}, {"up", {0, 0, 1}}, {"fov", 60.0}}; };
        fake.lookAt = [&](const b::Vec3& aPoint, double) {
            const b::Vec3 d{aPoint[0] - camera[0], aPoint[1] - camera[1], aPoint[2] - camera[2]};
            const double n = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
            forward = {d[0] / n, d[1] / n, d[2] / n}; // a camera that follows each step at once, yaw and pitch
        };
        fake.player = [] { return json{{"busy", ""}, {"phase", "gameplay"}}; };
        runner.Start(b::StartParams("look", json{{"yaw", 180}, {"pitch", 0}, {"duration_s", 4}}), [](xfb::Access) {});
        double t = 0.0;
        double worst = 0.0, previous = 1e9;
        const b::Vec3 target{0.0, -1.0, 0.0};
        while (runner.Active() && t < 10.0)
        {
            runner.Tick(0.05, fake, true);
            t += 0.05;
            const double angle = std::acos(std::clamp(forward[0] * target[0] + forward[1] * target[1] + forward[2] * target[2], -1.0, 1.0)) / k;
            worst = std::max(worst, angle - previous);
            previous = angle;
        }
        const auto stop = events.Read(0, 100, {"behaviour"})["events"].back();
        Check("0.8.2 (review 4) behave.look from yaw 0, pitch 80 to yaw 180, pitch 0: the angle to the point never grows, and the look ends reached",
              stop["data"].value("reason", std::string()) == "reached" && worst <= 1e-6 && t >= 3.6,
              stop.dump() + " worst=" + std::to_string(worst) + " t=" + std::to_string(t));
    }
}

// 0.8.3: session 10's bridge findings (core pieces): the bridge's own kill key, the staged showroom's discovery through the
// game's own folder, inventory.list's parameters, the smooth look's arc (player.look shares behave.look's).
void Bridge083Tests()
{
    namespace kk = xfb::killkey;
    // The kill key: parsing, the default, the warning for a key the game binds, and the press detection.
    {
        kk::Chord chord;
        std::string why;
        const bool end = kk::Parse("End", chord, why);
        kk::Chord ctrlEnd;
        const bool chordOk = kk::Parse(" ctrl + End ", ctrlEnd, why);
        kk::Chord numpadPlus;
        const bool plusOk = kk::Parse("Ctrl+Numpad+", numpadPlus, why);
        kk::Chord gameName;
        const bool gameNameOk = kk::Parse("IK_Multiply", gameName, why);
        kk::Chord off;
        const bool offOk = kk::Parse("off", off, why);
        kk::Chord bad;
        std::string badWhy;
        const bool badOk = kk::Parse("Hyper+End", bad, badWhy);
        std::string unknownWhy;
        const bool unknownOk = kk::Parse("Space", bad, unknownWhy);
        Check("0.8.3 kill key: End, Ctrl + End, Ctrl + Numpad +, the game's own names and off parse; other modifiers and keys are refused plainly",
              end && chord.vk == 0x23 && !chord.ctrl && chord.label == "End" && chordOk && ctrlEnd.ctrl && ctrlEnd.vk == 0x23 &&
                  ctrlEnd.label == "Ctrl + End" && plusOk && numpadPlus.ctrl && numpadPlus.vk == 0x6B && gameNameOk && gameName.vk == 0x6A &&
                  gameName.label == "Numpad *" && offOk && !off.enabled && !badOk && badWhy.find("modifier") != std::string::npos && !unknownOk &&
                  unknownWhy.find("isn't a key") != std::string::npos,
              ctrlEnd.label + " / " + badWhy + " / " + unknownWhy);
        Check("0.8.4 kill key: the default is Ctrl + Shift + End (End is free in the game's 2.31 bindings; F9, Home and letters are bound)",
              std::string(kk::kDefault) == "Ctrl + Shift + End" && xfb::Config{}.killKey.vk == 0x23 && xfb::Config{}.killKey.ctrl &&
                  xfb::Config{}.killKey.shift && !xfb::Config{}.killKey.alt && xfb::Config{}.killKey.enabled && !kk::GameBinds(0x23) &&
                  kk::GameBinds(0x78) && kk::GameBinds(0x24) && kk::GameBinds('W') && !kk::GameBinds(0x6A));
        {
            // 0.8.4: the window's Change... writes the chord's spelling into config.ini, which reads it back the same.
            bool roundTrip = true;
            for (const char* text : {"Ctrl + Shift + End", "End", "Alt + Page Up", "Ctrl + Numpad +", "Shift + Numpad *", "Scroll Lock", "F12", "off"})
            {
                kk::Chord first, second;
                std::string parseWhy;
                roundTrip = roundTrip && kk::Parse(text, first, parseWhy) && kk::Parse(kk::Spelling(first), second, parseWhy) && first.vk == second.vk &&
                            first.ctrl == second.ctrl && first.shift == second.shift && first.alt == second.alt && first.enabled == second.enabled &&
                            first.label == second.label;
            }
            Check("0.8.4 kill key: config.ini's spelling of every chord reads back as the same chord", roundTrip && kk::Spelling(xfb::Config{}.killKey) == "Ctrl+Shift+End");
            const std::string ini = "; head\n[bridge]\nenabled = true\n\n[ui]\n; the key\nkill_key = End\nhud_panel = true\n\n[log]\nlevel = debug\n";
            const auto replaced = kk::WithKillKey(ini, "Ctrl+F12");
            const auto inserted = kk::WithKillKey("[ui]\nhud_panel = true\n\n[log]\nlevel = info\n", "Pause");
            const auto added = kk::WithKillKey("[bridge]\nenabled = true", "off");
            const auto crlf = kk::WithKillKey("[ui]\r\nkill_key = End\r\n", "Ctrl+Shift+End");
            Check("0.8.4 kill key: config.ini's kill_key line is replaced in place, added to [ui], or [ui] is added; the rest and the line endings stay",
                  replaced == "; head\n[bridge]\nenabled = true\n\n[ui]\n; the key\nkill_key = Ctrl+F12\nhud_panel = true\n\n[log]\nlevel = debug\n" &&
                      inserted == "[ui]\nhud_panel = true\nkill_key = Pause\n\n[log]\nlevel = info\n" && added == "[bridge]\nenabled = true\n\n[ui]\nkill_key = off\n" &&
                      crlf == "[ui]\r\nkill_key = Ctrl+Shift+End\r\n" && xfb::ParseConfig(replaced).killKey.ctrl && xfb::ParseConfig(replaced).killKey.vk == 0x7B,
                  replaced + "|" + inserted + "|" + added);
            const std::string xml = "<bindings>\n<mapping name=\"FastForward_Button\" type=\"Button\" >\n <button id=\"IK_Home\" />\n</mapping>\n"
                                    "<mapping name=\"Dodge_Button\" type=\"Button\" >\n <button id=\"IK_Pad_B_CIRCLE\" />\n <button id=\"IK_LControl\" overridableUI=\"dodgeDash\" />\n</mapping>\n"
                                    "<mapping name=\"Sprint_Button\" type=\"Button\" >\n <button id=\"IK_LShift\" />\n</mapping>\n</bindings>\n";
            const std::vector<std::pair<std::string, std::string>> files{{"r6/config/inputUserMappings.xml", xml}};
            kk::Chord home, chordDefault, ctrlF12;
            std::string parseWhy;
            kk::Parse("Home", home, parseWhy);
            kk::Parse("Ctrl+F12", ctrlF12, parseWhy);
            const auto homeConflicts = kk::FindConflicts(home, files, "");
            const auto defaultConflicts = kk::FindConflicts(chordDefault, files, "");
            // CET: 0x7B (F12) alone, Ctrl (0x11) + F12, another mod's End, and the bridge's own entry (skipped).
            const std::string cet = "{\"ModA\": {\"shot\": " + std::to_string(0x007B000000000000ULL) + "}, \"ModB\": {\"both\": " +
                                    std::to_string(0x0011007B00000000ULL) + ", \"other\": " + std::to_string(0x0023000000000000ULL) +
                                    "}, \"xf_runtime_bridge\": {\"stop\": " + std::to_string(0x0011007B00000000ULL) + "}, \"Old.key\": " +
                                    std::to_string(0x00A2007B00000000ULL) + "}";
            const auto cetConflicts = kk::FindConflicts(ctrlF12, {}, cet);
            const auto joinedCet = [&] {
                std::string out;
                for (const auto& w : cetConflicts.warnings)
                {
                    out += w + "|";
                }
                return out;
            }();
            Check("0.8.4 kill key conflicts: a key the game binds warns; modifiers the game uses are a note; End alone is clear (0.8.5: in plain words)",
                  homeConflicts.warnings.size() == 1 && homeConflicts.warnings[0].find("The game uses Home too (1 game action, in r6/config/inputUserMappings.xml)") != std::string::npos &&
                      homeConflicts.notes.empty() && defaultConflicts.warnings.empty() && defaultConflicts.notes.size() == 1 &&
                      defaultConflicts.notes[0] == "Ctrl and Shift also dodge and sprint on their own; holding them for the stop key only matters while V moves.",
                  (homeConflicts.warnings.empty() ? std::string() : homeConflicts.warnings[0]) + "|" + (defaultConflicts.notes.empty() ? std::string() : defaultConflicts.notes[0]));
            {
                // 0.8.5 (session 12's K3): the game's 2.31 actions on Ctrl and Alt, as the note lists them, and one modifier alone.
                const std::string game = "<bindings>\n"
                                         "<mapping name=\"Crouch_Button\"><button id=\"IK_RControl\" /></mapping>\n"
                                         "<mapping name=\"Dodge_Button\"><button id=\"IK_LControl\" /></mapping>\n"
                                         "<mapping name=\"SwitchItem_Button\"><button id=\"IK_Alt\" /></mapping>\n"
                                         "<mapping name=\"WeaponWheel_Button\"><button id=\"IK_Alt\" /></mapping>\n"
                                         "<mapping name=\"LeftY_Axis_Vehicle\"><button id=\"IK_LControl\" /></mapping>\n"
                                         "<mapping name=\"LeftY_Axis_Vehicle_RockFB\"><button id=\"IK_LControl\" /></mapping>\n"
                                         "<mapping name=\"Vehicle_Shoot_Tertiary\"><button id=\"IK_LControl\" /></mapping>\n"
                                         "<mapping name=\"tank_minigame_AEAMS\"><button id=\"IK_LControl\" /></mapping>\n"
                                         "<mapping name=\"PageDown_Thing\"><button id=\"IK_PageDown\" /></mapping>\n</bindings>\n";
                const std::vector<std::pair<std::string, std::string>> gameFiles{{"r6/config/inputUserMappings.xml", game}};
                kk::Chord ctrlAltPgDn, ctrlOnlyEnd, altEnd;
                std::string chordWhy;
                kk::Parse("Ctrl+Alt+PageDown", ctrlAltPgDn, chordWhy);
                kk::Parse("Ctrl+End", ctrlOnlyEnd, chordWhy);
                kk::Parse("Alt+End", altEnd, chordWhy);
                const auto both = kk::FindConflicts(ctrlAltPgDn, gameFiles, "");
                const auto ctrlOnly = kk::FindConflicts(ctrlOnlyEnd, gameFiles, "");
                const auto altOnly = kk::FindConflicts(
                    altEnd, {{"x.xml", "<mapping name=\"Unknown_A\"><button id=\"IK_Alt\" /></mapping><mapping name=\"Unknown_B\"><button id=\"IK_LAlt\" /></mapping>"}}, "");
                const auto all = [](const kk::Conflicts& aC) {
                    std::string out;
                    for (const auto& n : aC.notes)
                    {
                        out += n + "|";
                    }
                    for (const auto& w : aC.warnings)
                    {
                        out += w + "|";
                    }
                    return out;
                };
                Check("0.8.5 stop key notes name game actions in plain words (the most common first, the rest counted), never the game's mapping names",
                      both.notes.size() == 1 &&
                          both.notes[0] == "Ctrl and Alt also dodge, crouch and steer vehicles on their own (and 4 more); holding them for the stop key only matters while V moves." &&
                          both.warnings.size() == 1 && both.warnings[0].find("The game uses Page Down too (1 game action,") == 0 && ctrlOnly.notes.size() == 1 &&
                          ctrlOnly.notes[0] == "Ctrl also dodges, crouches and steers vehicles on its own (and 2 more); holding it for the stop key only matters while V moves." &&
                          altOnly.notes.size() == 1 &&
                          altOnly.notes[0] == "Alt is a game key on its own (2 game actions); holding it for the stop key only matters while V moves." &&
                          all(both).find("_Button") == std::string::npos && all(both).find("_Axis") == std::string::npos && all(both).find("kill key") == std::string::npos,
                      all(both) + all(ctrlOnly) + all(altOnly));
            }
            // The review of 0.8.4: the effective (last) kill_key is the one replaced, across repeated [ui] sections.
            const std::string twice = "[ui]\nkill_key = End\n\n[log]\nlevel = info\n\n[ui]\nkill_key = Home\n";
            const auto rewritten = kk::WithKillKey(twice, "Ctrl+F12");
            Check("0.8.4 (review) kill key: the last kill_key (the one the reader applies) is replaced, so the saved key survives a relaunch",
                  rewritten == "[ui]\nkill_key = End\n\n[log]\nlevel = info\n\n[ui]\nkill_key = Ctrl+F12\n" && xfb::ParseConfig(rewritten).killKey.vk == 0x7B &&
                      xfb::ParseConfig(rewritten).killKey.ctrl,
                  rewritten);
            {
                // The review of 0.8.4: the settings file is replaced only after a whole read, with a backup, and read back; nested
                // Input Loader folders are walked.
                wchar_t tempDir[MAX_PATH]{};
                GetTempPathW(MAX_PATH, tempDir);
                const auto dir = std::filesystem::path(tempDir) / (L"xfb-unit-killkey-" + std::to_wstring(GetCurrentProcessId()));
                std::filesystem::remove_all(dir);
                std::filesystem::create_directories(dir / L"r6" / L"config");
                std::filesystem::create_directories(dir / L"r6" / L"input" / L"SomeMod" / L"deeper");
                std::ofstream(dir / L"r6" / L"config" / L"inputUserMappings.xml", std::ios::binary) << "<bindings></bindings>";
                std::ofstream(dir / L"r6" / L"input" / L"SomeMod" / L"deeper" / L"keys.xml", std::ios::binary)
                    << "<bindings><mapping name=\"SomeMod_Toggle\" type=\"Button\"><button id=\"IK_Home\" /></mapping></bindings>";
                std::ofstream(dir / L"r6" / L"input" / L"notes.txt", std::ios::binary) << "IK_Home";
                kk::Chord nestedHome;
                std::string nestedWhy;
                kk::Parse("Home", nestedHome, nestedWhy);
                const auto mappingFiles = kk::InputMappingFiles(dir);
                const auto nested = kk::FindConflicts(nestedHome, mappingFiles, "");
                Check("0.8.4 (review) kill key conflicts: Input Loader's nested folders are read (r6/input/SomeMod/deeper/keys.xml), other mappingFiles not",
                      mappingFiles.size() == 2 && nested.warnings.size() == 1 && nested.warnings[0].find("r6/input/SomeMod/deeper/keys.xml") != std::string::npos &&
                          nested.warnings[0].find("1 game action") != std::string::npos && nested.warnings[0].find("Change...") != std::string::npos,
                      nested.warnings.empty() ? std::to_string(mappingFiles.size()) : nested.warnings[0]);
                const auto iniPath = dir / L"config.iniPath";
                const auto work = dir / L"runtime" / L"settings-backups";
                std::string text, ioWhy;
                bool missing = false;
                xfb::win32::SettingsReplace done;
                const bool readMissing = !xfb::win32::ReadFileExact(iniPath, text, missing, ioWhy) && missing;
                const bool refusedWithoutOriginal = !xfb::win32::ReplaceSettingsFile(iniPath, "[ui]\nkill_key = F12\n", work, 3, done, ioWhy) && !std::filesystem::exists(iniPath);
                std::ofstream(iniPath, std::ios::binary) << "[ui]\nkill_key = End\nhud_panel = true\n";
                const bool swapped = xfb::win32::ReplaceSettingsFile(iniPath, "[ui]\nkill_key = F12\nhud_panel = true\n", work, 3, done, ioWhy);
                std::string now, old;
                xfb::win32::ReadFileExact(iniPath, now, missing, ioWhy);
                xfb::win32::ReadFileExact(done.backup, old, missing, ioWhy);
                // 0.8.5 (session 12's K5): nothing new beside the file; the backups in the work folder, the newest 3 kept.
                const auto filesIn = [](const std::filesystem::path& aDir, const std::wstring& aPrefix) {
                    size_t n = 0;
                    std::error_code ec;
                    for (std::filesystem::directory_iterator it(aDir, ec), end; !ec && it != end; it.increment(ec))
                    {
                        const auto name = it->path().filename().wstring();
                        std::error_code fileEc;
                        n += it->is_regular_file(fileEc) && name.starts_with(aPrefix) ? 1 : 0;
                    }
                    return n;
                };
                const auto firstBackup = done.backup;
                const bool firstBeside = done.tempBeside;
                for (int k = 0; k < 4; ++k)
                {
                    Sleep(2); // distinct millisecond stamps
                    xfb::win32::ReplaceSettingsFile(iniPath, "[ui]\nkill_key = F" + std::to_string(k + 1) + "\n", work, 3, done, ioWhy);
                }
                const auto backups = filesIn(work, L"config.iniPath.");
                const auto beside = filesIn(dir, L"");
                Check("0.8.4 (review) config.iniPath: a missing file reads as missing; nothing is written without an original; a replace keeps a backup and reads back "
                      "(0.8.5: the backup and the temporary file in the work folder, never beside the file; the newest 3 backups kept)",
                      readMissing && refusedWithoutOriginal && swapped && now == "[ui]\nkill_key = F12\nhud_panel = true\n" &&
                          old == "[ui]\nkill_key = End\nhud_panel = true\n" && firstBackup.parent_path() == work && !firstBeside && beside == 1 && backups == 3 &&
                          !std::filesystem::exists(firstBackup) && !std::filesystem::exists(work / L"config.iniPath.tmp"),
                      ioWhy + " backups=" + std::to_string(backups) + " beside=" + std::to_string(beside));
                std::filesystem::remove_all(dir);
            }
            // 0.8.4 (the UI review's fix 4): the XF box stands where the ink panel does, on any screen.
            const auto closeTo = [](std::pair<float, float> aGot, float aX, float aY) { return std::abs(aGot.first - aX) < 0.5f && std::abs(aGot.second - aY) < 0.5f; };
            const auto wide = xfb::overlay::PanelOrigin("top_left", 40, 360, 3840, 1600, 360, 200);
            const auto small = xfb::overlay::PanelOrigin("top_left", 40, 360, 1280, 720, 120, 80);
            const auto right = xfb::overlay::PanelOrigin("top_right", 60, 60, 3840, 1600, 400, 200);
            const auto bottom = xfb::overlay::PanelOrigin("bottom_left", 0, 0, 1920, 1080, 180, 100);
            const auto unknown = xfb::overlay::PanelOrigin("nowhere", 40, 360, 3840, 1600, 360, 200);
            const auto clamped = xfb::overlay::PanelOrigin("center", 9000, 0, 1920, 1080, 180, 100);
            Check("0.8.4 the XF box's place follows the ink panel's anchor, offsets and floors, scaled with the screen, and stays on screen",
                  closeTo(wide, 40, 360) && closeTo(small, 40.0f / 3, 120) && closeTo(right, 3840 - 860.0f * 1600 / 2160 - 400, 60) &&
                      closeTo(bottom, 0.5f * 8, 1080 - 520.0f * 1080 / 2160 - 100) && closeTo(unknown, 40, 360) && closeTo(clamped, 1920 - 4 - 180, 490),
                  std::to_string(right.first) + "," + std::to_string(bottom.first) + "," + std::to_string(bottom.second) + "," + std::to_string(clamped.first));
            Check("0.8.4 kill key conflicts: CET hotkeys with the same keys or a part including the key warn (left Ctrl counts as Ctrl); the bridge's own and other keys don't",
                  cetConflicts.warnings.size() == 3 && joinedCet.find("ModA / shot") != std::string::npos && joinedCet.find("ModB / both") != std::string::npos &&
                      joinedCet.find("Old / key") != std::string::npos && joinedCet.find("xf_runtime_bridge") == std::string::npos &&
                      joinedCet.find("ModB / other") == std::string::npos && kk::FindConflicts(ctrlF12, {}, "not json").warnings.empty(),
                  joinedCet);
        }
        const auto parsed = xfb::ParseConfig("[ui]\nkill_key = Ctrl + End\n");
        const auto warned = xfb::ParseConfig("[ui]\nkill_key = W\n");
        const auto refused = xfb::ParseConfig("[ui]\nkill_key = Space\n");
        const auto none = xfb::ParseConfig("[ui]\nkill_key = off\n");
        Check("0.8.3 kill key in config.ini: a chord is read; a game key warns; an unknown key warns and keeps End; off switches it off",
              parsed.killKey.ctrl && parsed.killKey.vk == 0x23 && parsed.warnings.empty() && warned.killKey.vk == 'W' && warned.warnings.size() == 1 &&
                  refused.killKey.vk == 0x23 && refused.warnings.size() == 1 && refused.warnings[0].find("End") != std::string::npos && !none.killKey.enabled &&
                  xfb::DescribeConfig(parsed).find("ui.kill_key=Ctrl+End") != std::string::npos,
              refused.warnings.empty() ? std::string() : refused.warnings[0]);
        {
            // 0.8.5: [ui] question_sound: on by default (the messenger's new-message sound), true, false or a sound event's name;
            // anything else is a bad value and keeps the default. The chime: once per new question, never for 0 or an older id,
            // and questions skipped while it was off stay quiet.
            const auto quiet = xfb::ParseConfig("[ui]\nquestion_sound = false\n");
            const auto named = xfb::ParseConfig("[ui]\nquestion_sound = ui_menu_tutorial_open\n");
            const auto badSound = xfb::ParseConfig("[ui]\nquestion_sound = Ui Sound!\n");
            xfb::QuestionChime chime;
            const bool first = chime.Take(3);
            const bool again = chime.Take(3);
            const bool noQuestion = chime.Take(0);
            const bool older = chime.Take(2);
            chime.Skip(5);
            const bool skipped = chime.Take(5);
            const bool next = chime.Take(6);
            Check("0.8.5 question_sound: on by default, off with false, a named event kept, a bad name refused; one sound per new question",
                  xfb::Config{}.questionSound == "ui_messenger_recieved" && quiet.questionSound.empty() && named.questionSound == "ui_menu_tutorial_open" &&
                      badSound.questionSound == "ui_messenger_recieved" && !badSound.warnings.empty() && xfb::DescribeConfig(quiet).find("ui.question_sound=off") != std::string::npos &&
                      first && !again && !noQuestion && !older && !skipped && next,
                  xfb::DescribeConfig(named));
        }
        // Press detection: once per press, only with every modifier the chord names, never while disarmed (the window not in
        // front, CET's overlay open, the bridge stopped).
        std::map<int, bool> keys;
        const auto reader = [&keys](int aVk) { return keys[aVk]; };
        kk::Watch watch;
        int fired = 0;
        keys[0x23] = true;
        fired += watch.Poll(ctrlEnd, true, reader) ? 1 : 0; // End without Ctrl: nothing
        keys[0x11] = true;
        fired += watch.Poll(ctrlEnd, true, reader) ? 1 : 0; // Ctrl + End: once
        fired += watch.Poll(ctrlEnd, true, reader) ? 1 : 0; // still held: not again
        keys[0x23] = false;
        fired += watch.Poll(ctrlEnd, true, reader) ? 1 : 0;
        keys[0x23] = true;
        fired += watch.Poll(ctrlEnd, true, reader) ? 1 : 0; // pressed again: once more
        const int afterSecond = fired;
        kk::Watch idle;
        const bool notInFront = idle.Poll(chord, false, reader);
        const bool switchedOff = idle.Poll(off, true, reader);
        Check("0.8.3 kill key: one kill per press, only with its modifiers; nothing while disarmed or the key is off",
              afterSecond == 2 && !notInFront && !switchedOff, std::to_string(afterSecond));
        // The review: End held in another window (disarmed), then the game comes to the front with End still down: no kill;
        // let go and press again: one kill. A press the last check refuses (CET opened in between) is used up.
        std::map<int, bool> held{{0x23, true}};
        const auto heldReader = [&held](int aVk) { return held[aVk]; };
        kk::Watch focus;
        int focusFired = 0;
        focusFired += focus.Poll(chord, false, heldReader) ? 1 : 0; // held while another window is in front
        focusFired += focus.Poll(chord, true, heldReader) ? 1 : 0;  // the game in front, End still down
        focusFired += focus.Poll(chord, true, heldReader) ? 1 : 0;
        const int whileHeld = focusFired;
        held[0x23] = false;
        focusFired += focus.Poll(chord, true, heldReader) ? 1 : 0;
        held[0x23] = true;
        focusFired += focus.Poll(chord, true, heldReader) ? 1 : 0; // a real press: one kill
        const int afterPress = focusFired;
        kk::Watch lastWatch;
        held[0x23] = false;
        lastWatch.Poll(chord, true, heldReader);
        held[0x23] = true;
        const bool lastCheck = lastWatch.Poll(chord, true, heldReader, [] { return false; }); // CET opened at that moment
        const bool stillHeld = lastWatch.Poll(chord, true, heldReader, [] { return true; });
        Check("0.8.3 (review) kill key: End held elsewhere then the game in front fires nothing; a release and a press fire once; "
              "a press the last check refuses is used up",
              whileHeld == 0 && afterPress == 1 && !lastCheck && !stillHeld, std::to_string(whileHeld) + "/" + std::to_string(afterPress));
    }

    // The staged showroom: the game's own archive/pc/mod (a temporary folder here), the archive's SHA-256, a self-describing
    // build's manifest beside it, a manifest that names another archive refused, other mods' files ignored.
    {
        wchar_t temp[MAX_PATH]{};
        GetTempPathW(MAX_PATH, temp);
        const auto dir = std::filesystem::path(temp) / (L"xfb-unit-staged-" + std::to_wstring(GetCurrentProcessId()));
        std::filesystem::remove_all(dir);
        std::filesystem::create_directories(dir);
        const std::string a = "xfs_showroom_4426018f6966620881cdcb78569544ab", b = "xfs_showroom_d11f5a7fd3192b9e4f6dd14f343578b8";
        std::ofstream(dir / (a + ".archive"), std::ios::binary) << "abc";
        std::ofstream(dir / (b + ".archive"), std::ios::binary) << "xyz";
        std::ofstream(dir / (a + ".showroom.json"), std::ios::binary) << "\xEF\xBB\xBF{\"schema\":\"xfs/showroom-package-1\",\"archive\":\"" << a << "\",\"pieces\":[]}";
        std::ofstream(dir / (b + ".showroom.json"), std::ios::binary) << "{\"schema\":\"xfs/showroom-package-1\",\"archive\":\"" << a << "\"}";
        std::ofstream(dir / L"other_mod.archive", std::ios::binary) << "1";
        std::ofstream(dir / L"xfs_showroom_NOTHEX.archive", std::ios::binary) << "1";
        std::ofstream(dir / L"\x00C5sa_\x6771\x4EAC.archive", std::ios::binary) << "1"; // a name the narrow code page may not hold
        const auto out = xfb::showroom::StagedShowrooms(dir);
        const auto& list = out["archives"];
        Check("0.8.3 showroom.staged: the game folder's showroom archives with their SHA-256 and a self-describing build's manifest",
              out["found"] == true && list.size() == 2 && list[0]["archive"] == a && list[0]["bytes"] == 3 &&
                  list[0]["sha256"] == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" && list[0]["manifest"].is_object() &&
                  list[0]["manifest"]["archive"] == a && list[1]["archive"] == b && list[1]["manifest"].is_null() &&
                  list[1].value("manifest_error", std::string()).find("not this archive") != std::string::npos,
              out.dump());
        // The review: a sidecar nested past the request limit, and one whose schema is null, each fail their own entry only;
        // the listing stops when cancelled and hashes no more than its limit.
        const std::string c = "xfs_showroom_" + std::string(32, 'c'), d = "xfs_showroom_" + std::string(32, 'd');
        std::ofstream(dir / (c + ".archive"), std::ios::binary) << "c";
        std::ofstream(dir / (d + ".archive"), std::ios::binary) << "d";
        std::ofstream(dir / (c + ".showroom.json"), std::ios::binary)
            << "{\"schema\":\"xfs/showroom-package-1\",\"archive\":\"" << c << "\",\"x\":" << std::string(40, '[') << std::string(40, ']') << "}";
        std::ofstream(dir / (d + ".showroom.json"), std::ios::binary) << "{\"schema\":null,\"archive\":\"" << d << "\"}";
        const auto four = xfb::showroom::StagedShowrooms(dir);
        const auto byName = [](const json& aList, const std::string& aArchive) {
            for (const auto& entry : aList["archives"])
            {
                if (entry["archive"] == aArchive)
                {
                    return entry;
                }
            }
            return json::object();
        };
        Check("0.8.3 (review) showroom.staged: a sidecar nested too deep and one with a null schema fail their own entries; the others stand",
              four["archives"].size() == 4 && byName(four, a)["manifest"].is_object() && byName(four, c)["manifest"].is_null() &&
                  byName(four, c).value("manifest_error", std::string()).find("nests deeper") != std::string::npos && byName(four, d)["manifest"].is_null() &&
                  byName(four, d).value("manifest_error", std::string()).find("not this archive") != std::string::npos,
              four.dump().substr(0, 600));
        std::string cancelledCode;
        try
        {
            xfb::showroom::StagedShowrooms(dir, [] { return true; });
        }
        catch (const xfb::MethodError& e)
        {
            cancelledCode = e.code;
        }
        const auto bounded = xfb::showroom::StagedShowrooms(dir, {}, 4);
        Check("0.8.3 (review) showroom.staged: a cancelled listing stops (interrupted); past the hashing limit an archive is listed unhashed",
              cancelledCode == "interrupted" && byName(bounded, a)["sha256"].is_string() && byName(bounded, c)["sha256"].is_string() &&
                  byName(bounded, b)["sha256"].is_null() && byName(bounded, b).value("sha256_error", std::string()).find("not hashed") != std::string::npos,
              cancelledCode + " " + bounded.dump().substr(0, 400));
        const auto missing = xfb::showroom::StagedShowrooms(dir / L"none");
        Check("0.8.3 showroom.staged: a missing folder answers found false and no archives", missing["found"] == false && missing["archives"].empty(), missing.dump());
        std::filesystem::remove_all(dir);
    }

    // inventory.list's parameters.
    {
        const auto all = xfb::params::ParseInventoryList(json::object());
        const auto jackets = xfb::params::ParseInventoryList(json{{"slot", "OuterChest"}, {"limit", 5}});
        std::string badSlot, badLimit;
        try
        {
            xfb::params::ParseInventoryList(json{{"slot", "Weapon"}});
        }
        catch (const xfb::MethodError& e)
        {
            badSlot = e.what();
        }
        try
        {
            xfb::params::ParseInventoryList(json{{"limit", 500}});
        }
        catch (const xfb::MethodError& e)
        {
            badLimit = e.what();
        }
        Check("0.8.3 inventory.list: every clothing slot by default (limit 100), one slot by name, other slots and limits refused",
              all.slot.empty() && all.limit == 100 && jackets.slot == "OuterChest" && jackets.limit == 5 && !badSlot.empty() && !badLimit.empty());
    }

    // The smooth look's arc (behave.look's since 0.8.2, player.look's since 0.8.3): it starts at the view, ends at the point,
    // only ever comes closer to it, and a duration_s of 5 takes 50 steps of kLookArcStepS (session 10's L2a took 1.5 s).
    {
        namespace pl = xfb::player;
        const double k = 3.14159265358979323846 / 180.0;
        const auto from = pl::DirectionOf(0.0, 0.0);
        const auto to = pl::DirectionOf(90.0, -10.0);
        double previous = 1e9, worst = -1.0;
        const double duration = 5.0;
        int steps = 0;
        for (int step = 1;; ++step)
        {
            const double next = std::min(1.0, step * pl::kLookArcStepS / duration);
            const auto d = pl::LookArc(from, to, next);
            const double angle = std::acos(std::clamp(d[0] * to[0] + d[1] * to[1] + d[2] * to[2], -1.0, 1.0)) / k;
            worst = std::max(worst, angle - previous);
            previous = angle;
            steps = step;
            if (next >= 1.0)
            {
                break;
            }
        }
        const auto start = pl::LookArc(from, to, 0.0);
        const auto half = pl::LookArc(from, to, 0.5);
        const double halfAngle = std::acos(std::clamp(half[0] * to[0] + half[1] * to[1] + half[2] * to[2], -1.0, 1.0)) / k;
        const auto back = pl::LookArc(from, pl::DirectionOf(180.0, 0.0), 0.5);
        Check("0.8.3 the smooth look's arc: from the view to the point, never wider on the way, 50 steps for 5 s, eased half way",
              std::abs(start[0] - from[0]) < 1e-9 && std::abs(start[1] - from[1]) < 1e-9 && previous < 1e-6 && worst <= 1e-9 && steps == 50 &&
                  std::abs(halfAngle - 45.25) < 1.0 && std::abs(back[2]) < 1e-9 && std::abs(std::hypot(back[0], back[1]) - 1.0) < 1e-9,
              "steps=" + std::to_string(steps) + " half=" + std::to_string(halfAngle));
    }
}

// 0.8.2: the crash investigation's offline checks (run under AddressSanitizer by the build record's ASan step).
//
// RunPipeStress: both pipes (the main one and <pipe>-control) started and stopped over and over, with clients connecting to
// both from the moment the names exist, a kill racing the start in some rounds and two threads stopping at once in others;
// each round builds the bridge through Bridge::Create as the plugin does, and tears it down again.
// RunLayoutRepro: what 0.8.1's stale Main.obj did: a Bridge constructed in an allocation of 0x2F8 bytes (the size the old
// object file asked for). Under AddressSanitizer this stops at once with a heap-buffer-overflow in the constructor; without
// it the overrun corrupts the heap silently, as the game's three launches showed.
namespace
{
std::wstring Widen(const std::string& aText)
{
    return std::wstring(aText.begin(), aText.end());
}

void StressClient(const std::wstring& aPipe, const std::string& aToken, int aWhich, std::atomic<bool>& aStop, std::atomic<int>& aAnswers)
{
    const std::wstring name = (aWhich % 2) ? aPipe + L"-control" : aPipe;
    const std::string line = json{{"v", 1}, {"id", aWhich}, {"token", aToken}, {"method", (aWhich % 2) ? "behave.stop" : "stress.ping"}}.dump() + "\n";
    while (!aStop.load())
    {
        HANDLE pipe = CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        if (pipe == INVALID_HANDLE_VALUE)
        {
            std::this_thread::sleep_for(std::chrono::microseconds(200));
            continue;
        }
        DWORD written = 0;
        if (WriteFile(pipe, line.data(), static_cast<DWORD>(line.size()), &written, nullptr))
        {
            char buffer[512];
            DWORD read = 0;
            if (ReadFile(pipe, buffer, sizeof(buffer), &read, nullptr) && read > 0)
            {
                ++aAnswers;
            }
        }
        CloseHandle(pipe);
    }
}
} // namespace

// Bridge 0.8.6: the ink panel inside photo mode's menu (ui.hud's photo_menu layer and modal, the frame's modal record, the
// ink layer's events), [ui] layer, and the UI review's fix 6 (one key notation: "[F6] Done" wherever a key is pressed).
void Bridge086Tests()
{
    namespace k = xfb::inkui;
    k::HudPanel panel;
    panel.SetDefaults(k::HudSettings{});
    Check("0.8.6 the panel's default layer is photo_menu (the HUD in play, photo mode's menu while it is open), modal off",
          panel.Current().layer == "photo_menu" && !panel.Current().modal && k::LayerIsHud("photo_menu") && k::LayerIsHud("hud") &&
              !k::LayerIsHud("top") && k::LayerOk("photo_menu"));
    const auto modal = panel.Configure(json{{"modal", true}, {"layer", "photo_menu"}});
    Check("0.8.6 ui.hud takes modal; its undo turns it off again",
          modal["changed"] == true && modal["settings"]["modal"] == true && modal["undo"]["params"]["modal"] == false, modal.dump());
    Check("0.8.6 ui.hud refuses a modal that isn't true or false, and an unknown layer names photo_menu",
          ParamsCode([&] { panel.Configure(json{{"modal", "on"}}); }) == "bad_params" &&
              ParamsCode([&] { panel.Configure(json{{"layer", "photo"}}); }) == "bad_params");
    k::BridgeView view;
    view.pluginEnabled = true;
    view.listening = true;
    view.scriptReady = true;
    xfb::MessageBoard board;
    const auto on = k::ParseFrame(k::BuildFrame(panel.Current(), view, board, {"IK_F6"}, 0));
    view.killed = true;
    const auto stopped = k::ParseFrame(k::BuildFrame(panel.Current(), view, board, {"IK_F6"}, 0));
    view.killed = false;
    Check("0.8.6 the frame carries modal while it is on, never while the bridge is stopped, and its layer",
          on.value("modal", false) == true && stopped.value("modal", true) == false && on.value("layer", std::string()) == "photo_menu",
          on.dump() + " " + stopped.dump());
    panel.DropModal();
    Check("0.8.6 the kill switch drops modal (DropModal), keeping every other setting",
          !panel.Current().modal && panel.Current().layer == "photo_menu" && panel.Current().show);
    Check("0.8.6 (fix 6) a pressed key reads [F6] Done on the XF box and the CET line, as on the ink panel",
          k::KeyPrompt("IK_F6", "Done") == "[F6] Done" && k::KeyPrompt("F11", "Not yet") == "[F11] Not yet" &&
              k::AnswerHint({"Done", "Not yet"}, {"IK_F6", "IK_F7"}, true) == "[F6] Done   [F7] Not yet");
    const auto data = k::InkEventData(R"({"created":true,"children":[{"name":"options_panel"}]})");
    const auto raw = k::InkEventData("not json");
    Check("0.8.6 the ink events: ink_tree, ink_pointer and ink_input only; data a JSON object, else its first characters as raw",
          k::InkEventKindOk("ink_tree") && k::InkEventKindOk("ink_pointer") && k::InkEventKindOk("ink_input") &&
              !k::InkEventKindOk("write") && !k::InkEventKindOk("kill") && !k::InkEventKindOk("") && data["created"] == true &&
              data["children"][0]["name"] == "options_panel" && raw["raw"] == "not json" && k::InkEventData("").is_null(),
          data.dump() + " " + raw.dump());
    {
        // The Sol review of 0.8.6: every choice is in the frame, with a key only where answer_keys gives one.
        xfb::MessageBoard asks;
        asks.Post({"Which?", 60, "ask", false, {"Yes", "No", "Maybe"}});
        const auto one = k::ParseFrame(k::BuildFrame(k::HudSettings{}, view, asks, {"IK_F6"}, 0));
        Check("0.8.6 (Sol review) the frame carries every choice; one beyond the answer keys has the key -, which no key press matches",
              one["ask"]["choices"].size() == 3 && one["ask"]["choices"][0]["key"] == "IK_F6" && one["ask"]["choices"][1]["key"] == "-" &&
                  one["ask"]["choices"][2]["label"] == "Maybe" && std::string(k::kNoKey) == "-",
              one.dump());
    }
    const auto config = xfb::ParseConfig("");
    const auto hud = xfb::ParseConfig("[ui]\nlayer = hud\n");
    const auto bad = xfb::ParseConfig("[ui]\nlayer = photo\n");
    Check("0.8.6 [ui] layer: photo_menu by default, hud (the XF box in photo mode) by choice, an unknown one warned and the default kept",
          config.hudLayer == "photo_menu" && hud.hudLayer == "hud" && hud.warnings.empty() && bad.hudLayer == "photo_menu" &&
              bad.warnings.size() == 1);
}

int RunPipeStress(int aRounds)
{
    wchar_t temp[MAX_PATH]{};
    GetTempPathW(MAX_PATH, temp);
    std::atomic<int> answers{0};
    int started = 0;
    for (int round = 0; round < aRounds; ++round)
    {
        xfb::Config config;
        config.bridgeEnabled = true;
        config.idleDisconnectSeconds = 2;
        xfb::Session session;
        std::string error;
        const auto dir = std::filesystem::path(temp) / (L"xfb-pipe-stress-" + std::to_wstring(GetCurrentProcessId()));
        std::filesystem::create_directories(dir);
        if (!xfb::CreateSession(session, error, dir))
        {
            std::printf("STRESS FAILED: session: %s\n", error.c_str());
            return 1;
        }
        xfb::GameThreadQueue queue;
        queue.SetPumping(true);
        auto bridge = xfb::Bridge::Create(config, session, queue);
        bridge->GetDispatcher().Register({"stress.ping", xfb::Access::Read, xfb::RunOn::BridgeThread, "stress", [](const xfb::MethodContext&) {
                                              return json{{"pong", true}};
                                          }});
        std::atomic<bool> stop{false};
        std::vector<std::thread> clients;
        for (int c = 0; c < 4; ++c)
        {
            clients.emplace_back([&, c] { StressClient(session.pipeName, session.token, c, stop, answers); });
        }
        std::thread killer;
        if (round % 3 == 1)
        {
            killer = std::thread([&] {
                std::this_thread::sleep_for(std::chrono::microseconds(50 * (round % 7)));
                bridge->Kill("stress");
            });
        }
        if (bridge->Start(error))
        {
            ++started;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(round % 5));
        if (killer.joinable())
        {
            killer.join();
        }
        if (round % 3 == 2)
        {
            std::thread other([&] { bridge->Stop("stress_other"); });
            bridge->Stop("stress");
            other.join();
        }
        else
        {
            bridge->Stop("stress");
        }
        bridge.reset();
        stop.store(true);
        for (auto& client : clients)
        {
            client.join();
        }
        std::filesystem::remove_all(dir);
    }
    std::printf("STRESS OK rounds=%d started=%d answers=%d\n", aRounds, started, answers.load());
    return 0;
}

int RunLayoutRepro()
{
    xfb::Config config;
    xfb::Session session;
    xfb::GameThreadQueue queue;
    std::printf("sizeof(Bridge)=0x%zx; 0.8.1's Main.obj allocated 0x2F8\n", sizeof(xfb::Bridge));
    std::fflush(stdout);
    void* memory = ::operator new(0x2F8);
    auto* bridge = new (memory) xfb::Bridge(config, session, queue); // writes past the allocation's end
    bridge->~Bridge();
    ::operator delete(memory);
    std::printf("REPRO RAN WITHOUT A REPORT (not an AddressSanitizer build?)\n");
    return 2;
}
// Bridge 0.8's NPC direction (selftest/UnitTestsNpc.cpp): answers its own failure count.
int RunNpcUnitTests();
int RunNpcSubstituteUnitTests();

// 0.8.7: the test probes' ring (test.events) and the companion probe (test.companion.probe), run for real against the companion
// built beside this self-test: its containment (in its job before it resumes, kill-on-close, one process, the memory cap) and
// what it reports.
void Bridge087Tests()
{
    namespace pr = xfb::probes;
    Check("0.8.7 probe kinds: a-z, 0-9, _ . : / only, 1 to 40 long",
          pr::KindOk("death") && pr::KindOk("dialogue.hub") && pr::KindOk("session") && !pr::KindOk("") && !pr::KindOk("Death") &&
              !pr::KindOk("a b") && !pr::KindOk(std::string(41, 'a')));

    pr::ProbeRing ring(32, 3);
    for (int i = 0; i < 5; ++i)
    {
        ring.Push("death", json{{"i", i}}, 10'000);
    }
    ring.Push("heat", json{{"value", 1}}, 10'000);
    ring.Push("death", json{{"i", 9}}, 11'000); // the next second: kept, carrying the two dropped before it
    const auto read = ring.Read(0, 100);
    Check("0.8.7 the probe ring keeps 3 a second per kind, counts the rest, and the kind's next record says how many it missed",
          read["events"].size() == 5 && read["dropped"]["death"] == 2 && read["events"][4]["data"].value("dropped_before", 0) == 2 &&
              read["events"][3]["kind"] == "heat" && read["latest"] == 5,
          read.dump());
    const auto later = ring.Read(read["next"].get<uint64_t>(), 100);
    Check("0.8.7 the probe ring reads on from a cursor", later["events"].empty() && later["next"] == read["next"], later.dump());

    // 0.8.9 (the Sol review of 0.8.9, finding 3): world.pin's drawn_by from many threads at once: each view's bit is set
    // once, reported new exactly once, and none is lost.
    {
        xfb::PinViews views;
        std::atomic<int> firsts{0};
        std::vector<std::thread> workers;
        for (int t = 0; t < 8; ++t)
        {
            workers.emplace_back([&views, &firsts, t] {
                for (int i = 0; i < 4000; ++i)
                {
                    const uint32_t bit = 1u << ((t + i) % 8);
                    if ((views.Or(7, bit) & bit) == 0)
                    {
                        ++firsts;
                    }
                }
            });
        }
        for (auto& w : workers)
        {
            w.join();
        }
        const auto all = views.Or(7, 0);
        views.Reset(7);
        Check("0.8.9 the pins' views from eight threads: every bit set, each reported new exactly once; a reset clears the pin",
              all == 0xFFu && firsts.load() == 8 && views.Or(7, 0) == 0 && views.Or(8, 0) == 0);
    }

    // 0.8.9: kinds keeps only those kinds or families, and the cursor still moves past what it skipped.
    pr::ProbeRing mixed(64, 100);
    mixed.Push("dialogue.index", json{{"index", 0}}, 1'000);
    mixed.Push("death", json{{"i", 1}}, 1'000);
    mixed.Push("dialogue.hub", json{{"count", 1}}, 1'000);
    mixed.Push("heat", json{{"value", 1}}, 1'000);
    const auto deaths = mixed.Read(0, 100, {"death"});
    const auto dialogue = mixed.Read(0, 100, {"dialogue"});
    Check("0.8.9 test.events kinds: one kind, or a family (dialogue takes dialogue.hub and dialogue.index); next moves past the rest",
          deaths["events"].size() == 1 && deaths["events"][0]["kind"] == "death" && deaths["next"] == 5 && dialogue["events"].size() == 2 &&
              dialogue["events"][1]["kind"] == "dialogue.hub" && mixed.Read(0, 100, {"dial"})["events"].empty(),
          deaths.dump() + dialogue.dump());

    pr::ProbeRing small(16, 100);
    for (int i = 0; i < 20; ++i)
    {
        small.Push("journal", json{{"i", i}}, 5'000);
    }
    const auto evicted = small.Read(1, 100);
    Check("0.8.7 the probe ring holds its capacity, says how many it evicted and how many a reader behind it missed",
          small.Size() == 16 && evicted["evicted"] == 4 && evicted["missed"] == 4 && evicted["events"][0]["seq"] == 5, evicted.dump());

    Check("0.8.7 test.companion.probe takes mode probe, sleep or stop, seconds 1-3600 and memory_mb 16-1024, nothing else",
          pr::ParseCompanion(json::object()).mode == "probe" && pr::ParseCompanion(json{{"mode", "sleep"}, {"seconds", 5}}).seconds == 5 &&
              ParamsCode([] { pr::ParseCompanion(json{{"mode", "run"}}); }) == "bad_params" &&
              ParamsCode([] { pr::ParseCompanion(json{{"memory_mb", 4096}}); }) == "bad_params" &&
              ParamsCode([] { pr::ParseCompanion(json{{"shell", true}}); }) == "bad_params");

    // The real companion, beside this self-test, looking at a folder of two archives made here.
    const auto here = xfb::win32::ModuleDirectory(reinterpret_cast<const void*>(&Bridge087Tests));
    const auto exe = here / "xfb_companion_probe.exe";
    const auto folder = here / "companion-probe-test";
    std::error_code ec;
    std::filesystem::create_directories(folder, ec);
    for (const char* name : {"a.archive", "b.archive"})
    {
        std::ofstream(folder / name) << "x";
    }
    try
    {
        const auto probe = pr::RunCompanion(pr::CompanionRequest{}, exe, folder / "a.archive", folder, 10'000);
        const auto& report = probe.value("report", json::object());
        Check("0.8.7 the companion runs in its job before it resumes (the job named at creation), with kill-on-close, one process and the 64 MB cap",
              probe.value("in_job", false) && probe.value("route", std::string()) == "atomic" && report.value("in_job", false) &&
                  report.value("kill_on_close", false) && report.value("active_process_limit", 0) == 1 && report.value("memory_limit_mb", 0) == 64 &&
                  probe.value("exit_code", -1) == 0 && probe.value("sha256", std::string()).size() == 64,
              probe.dump());
        Check("0.8.7 the companion reports what it sees: the file it was asked about and the folder's two archives",
              report.value("file_seen", false) && report.value("folder_archives", -1) == 2, probe.dump());
        const auto missing = pr::RunCompanion(pr::CompanionRequest{}, exe, folder / "none.archive", folder, 10'000);
        Check("0.8.7 a file the companion can't see says so (file_seen false, the system's error)",
              !missing["report"].value("file_seen", true) && missing["report"].value("file_error", 0) == 2, missing.dump());

        pr::CompanionRequest sleep;
        sleep.mode = "sleep";
        sleep.seconds = 60;
        const auto asleep = pr::RunCompanion(sleep, exe, {}, {}, 0);
        const auto twice = ParamsCode([&] { pr::RunCompanion(sleep, exe, {}, {}, 0); });
        const auto stopped = pr::RunCompanion(pr::CompanionRequest{"stop"}, exe, {}, {}, 0);
        Check("0.8.7 a sleeping companion keeps its job; a second is refused; stop closes the job and kill-on-close ends it",
              asleep.value("in_job", false) && twice == "companion_running" && stopped.value("stopped", false) && stopped.value("ended_by_job_close", false),
              asleep.dump() + " / " + twice + " / " + stopped.dump());
        const auto none = pr::RunCompanion(pr::CompanionRequest{"stop"}, exe, {}, {}, 0);
        Check("0.8.7 stop with no sleeping companion says so", !none.value("stopped", true), none.dump());
    }
    catch (const std::exception& e)
    {
        Check("0.8.7 the companion probe runs", false, e.what());
    }
    Check("0.8.7 a companion that isn't in the plugin's folder is refused in plain words",
          ParamsCode([&] { pr::RunCompanion(pr::CompanionRequest{}, here / "no-such-companion.exe", {}, {}, 1000); }) == "not_in_this_package");
    std::filesystem::remove_all(folder, ec);
}

// 0.8.11 (UI review of 0.8.11, fix 2): Save anyway's failures read in plain words with a next step, never the raw reason.
void Bridge0811Tests()
{
    namespace w = xfb::writes;
    for (const std::string code : {"save_in_progress", "busy", "not_in_gameplay", "bridge_effects_active", "saving_locked", "bridge_save_lock",
                                   "save_failed", "save_uncertain", "killed", "game_not_ready", "something_new", ""})
    {
        const auto copy = w::SaveAnywayFailureCopy(code);
        Check(("0.8.11 Save anyway failure '" + code + "' reads in plain words (no code names, a next step)").c_str(),
              !copy.empty() && copy.find("game_save") == std::string::npos && copy.find('_') == std::string::npos &&
                  (copy.find("Try again") != std::string::npos || copy.find("load") != std::string::npos || copy.find("Use ") != std::string::npos ||
                   copy.find("Leave ") != std::string::npos || copy.find("Look ") != std::string::npos),
              copy);
    }
    Check("0.8.11 another save in progress says so", w::SaveAnywayFailureCopy("save_in_progress").find("Another save") == 0);
}

// UnitTestsSenses.cpp: the senses' parameter checks and merge helpers; answers the number of failed checks.
int SensesUnitTests();
// UnitTestsDm.cpp: the live-direction toolkit (parameter checks, undos, watchers, the session and the service); answers the number of failed checks.
int DmUnitTests();

int InputUnitTests();
int RecordingUnitTests();
int SupervisorUnitTests();
// UnitTestsIncidents.cpp: what V witnessed (0.8.20); answers the number of failed checks.
int IncidentUnitTests();
// UnitTestsOverlay.cpp: the in-game styling (the theme table, the motion rule, the chip labels) (0.8.22); answers the number of failed checks.
int OverlayUnitTests();
int CanvasUnitTests();

int RunUnitTests()
{
    {
        using namespace xfb;
        // Deterministic burst/refill checks, with no waiting or writer tuning loophole.
        ReaderRequestBudget capped(1000);
        const auto at = std::chrono::steady_clock::time_point{};
        int admitted = 0;
        for (int i = 0; i < 41; ++i) admitted += capped.Take(at);
        Check("observer pacing: connection burst clamps at forty", admitted == 40);
        Check("observer pacing: twenty per second refill", capped.Take(at + 50ms) && !capped.Take(at + 50ms));
        Check("observer pacing: backwards clock adds no credit", !capped.Take(at));

        Config config; config.maxRequestsPerSecond = 2;
        Session session; session.token = "observer-pacing";
        auto pacingNow = at;
        GameThreadQueue queue; Dispatcher dispatcher(config, session, queue, [&] { return pacingNow; });
        auto call = [&](const char* method, ReaderRequestBudget* budget) {
            return json::parse(dispatcher.Handle(json{{"token", session.token}, {"method", method}}.dump(), 1, false, budget).line);
        };
        ReaderRequestBudget first(2), second(2);
        for (int i = 0; i < 4; ++i) call("ping", &first);
        Check("observer pacing: exhausted connection refuses", call("ping", &first)["error"]["code"] == "rate_limited");
        Check("observer pacing: same-PID second connection has independent credit", call("ping", &second)["ok"] == true);
        int writerAdmitted = 0;
        for (int i = 0; i < 5; ++i) writerAdmitted += call("ping", nullptr).value("ok", false);
        Check("observer pacing: passive reads leave full writer burst unchanged", writerAdmitted == 4);

        // Reconnecting cannot mint unlimited aggregate observer credit.
        int freshAdmitted = 0;
        for (int i = 0; i < 50; ++i) {
            ReaderRequestBudget fresh(2);
            freshAdmitted += call("ping", &fresh).value("ok", false);
        }
        Check("observer pacing: aggregate ceiling bounds reconnect bursts", freshAdmitted == 27);
        pacingNow += 1s;
        Check("observer pacing: connection refill follows injected time", call("ping", &first)["ok"] == true &&
            call("ping", &first)["ok"] == true && call("ping", &first)["error"]["code"] == "rate_limited");
        freshAdmitted = 0;
        for (int i = 0; i < 20; ++i) {
            ReaderRequestBudget fresh(2);
            freshAdmitted += call("ping", &fresh).value("ok", false);
        }
        Check("observer pacing: aggregate refills exactly sixteen tokens per second", freshAdmitted == 14);
        writerAdmitted = 0;
        for (int i = 0; i < 3; ++i) writerAdmitted += call("ping", nullptr).value("ok", false);
        Check("observer pacing: writer refills exactly two tokens per second", writerAdmitted == 2);
    }
    {
        using namespace xfb;
        Config config; config.maxRequestsPerSecond = 2;
        Session session; session.token = "game-pacing";
        auto pacingNow = std::chrono::steady_clock::time_point{};
        GameThreadQueue queue; queue.SetPumping(true); Dispatcher dispatcher(config, session, queue, [&] { return pacingNow; });
        int ran = 0;
        dispatcher.Register({"fixture.direct", Access::Read, RunOn::GameThread, "", [&](const MethodContext&) { ++ran; return json::object(); }});
        dispatcher.Register({"fixture.steps", Access::Read, RunOn::BridgeThread, "", [&](const MethodContext&) {
            dispatcher.RunRead([&] { ++ran; return json::object(); }, "first");
            return RunGameTask(queue, 1s, [&] { ++ran; return json::object(); }, "second");
        }});
        auto call = [&](const char* method, ReaderRequestBudget* budget) {
            auto work = std::async(std::launch::async, [&] {
                return dispatcher.Handle(json{{"token", session.token}, {"method", method}}.dump(), 1, false, budget);
            });
            const auto until = std::chrono::steady_clock::now() + 3s;
            while (work.wait_for(1ms) != std::future_status::ready && std::chrono::steady_clock::now() < until) queue.Drain(4);
            return work.get();
        };
        ReaderRequestBudget first(2), second(2), third(2);
        Check("observer pacing: direct game read admitted", json::parse(call("fixture.direct", &first).line)["ok"] == true);
        Check("observer pacing: multistep read charged once", json::parse(call("fixture.steps", &second).line)["ok"] == true && ran == 3);
        const auto refused = call("fixture.steps", &third);
        Check("observer pacing: shared game admission unchanged across connections", json::parse(refused.line)["error"]["code"] == "rate_limited" && ran == 3 && refused.rejected && refused.throttled && refused.backoffMs == 50);
        Check("observer pacing: direct game read also refuses before enqueue", json::parse(call("fixture.direct", &third).line)["error"]["code"] == "rate_limited" && ran == 3);
        Check("observer pacing: game reads preserve writer reserve", json::parse(call("ping", nullptr).line)["ok"] == true && json::parse(call("ping", nullptr).line)["ok"] == true);
        Check("observer pacing: writer limit still enforced", json::parse(call("ping", nullptr).line)["error"]["code"] == "rate_limited");
        pacingNow += 500ms;
        Check("observer pacing: partial shared refill preserves writer reserve", json::parse(call("fixture.direct", &third).line)["error"]["code"] == "rate_limited" && ran == 3);
        pacingNow += 1s;
        Check("observer pacing: shared game refill follows injected time", json::parse(call("fixture.direct", &third).line)["ok"] == true && ran == 4);
    }
    {
        using namespace xfb;
        Config config; config.allowWrites = true; config.maxRequestsPerSecond = 20;
        Session session; session.token = "multiclient";
        GameThreadQueue queue(2); queue.SetPumping(true);
        Dispatcher dispatcher(config, session, queue);
        ReaderRequestBudget readerBudget(config.maxRequestsPerSecond);
        int writes = 0;
        dispatcher.Register({"test.events", Access::Read, RunOn::BridgeThread, "", [&](const MethodContext&) { ++writes; return json::object(); }});
        dispatcher.Register({"fixture.write", Access::Write, RunOn::BridgeThread, "", [&](const MethodContext&) { ++writes; return json::object(); }});
        dispatcher.Register({"fixture.notify", Access::Notify, RunOn::BridgeThread, "", [&](const MethodContext&) { ++writes; return json::object(); }});
        dispatcher.Register({"test.record.start", Access::Read, RunOn::BridgeThread, "", [&](const MethodContext&) { ++writes; return json::object(); }});
        for (const auto method : {"game.saves", "game.options.read", "npc.pick"})
            dispatcher.Register({method, Access::Read, RunOn::BridgeThread, "", [&](const MethodContext&) { ++writes; return json::object(); }});
        dispatcher.Register({"bridge.kill", Access::Control, RunOn::BridgeThread, "", [](const MethodContext&) { return json::object(); }});
        auto request = [&](const char* method, bool reader) {
            return json::parse(dispatcher.Handle(json{{"token", session.token}, {"method", method}}.dump(), 1, false, reader ? &readerBudget : nullptr).line);
        };
        for (const auto method : {"fixture.write", "fixture.notify", "test.record.start", "game.saves", "game.options.read", "npc.pick"})
            Check("multiclient: native reader refuses mutation/lease", request(method, true)["error"]["code"] == "read_only_connection");
        const auto stims = json::parse(dispatcher.Handle(json{{"token", session.token}, {"method", "test.events"}, {"params", {{"stims", true}}}}.dump(), 1, false, &readerBudget).line);
        Check("multiclient: read-class stim mutation refused", stims["error"]["code"] == "read_only_connection");
        Check("multiclient: reader refusals never call handlers", writes == 0);
        bool limited = false;
        for (int i = 0; i < 50; ++i) if (request("ping", true).contains("error")) { limited = true; break; }
        Check("multiclient: reader connection pacing reaches limit", limited);
        Check("multiclient: writer retains reserved rate tokens", request("fixture.write", false)["ok"] == true);
        for (int i = 0; i < 50; ++i) request("ping", false);
        Check("multiclient: emergency survives exhausted aggregate bucket", request("bridge.kill", true)["ok"] == true);
        Check("multiclient: connection config bounds", ParseConfig("[bridge]\nmax_read_only_connections=8").maxReadOnlyConnections == 8 &&
            ParseConfig("[bridge]\nmax_read_only_connections=9").maxReadOnlyConnections == Config{}.maxReadOnlyConnections &&
            ParseConfig("[bridge]\nmax_read_only_connections=0").maxReadOnlyConnections == 0);

        std::vector<int> order;
        auto enqueue = [&](int value, bool reader) { return std::thread([&, value, reader] {
            json result; std::string error;
            queue.Run([&, value] { order.push_back(value); return json(); }, 2s, result, error, "priority", 1s, {}, reader);
        }); };
        const auto awaitPending = [&](size_t count) {
            const auto deadline = std::chrono::steady_clock::now() + 1s;
            while (queue.Pending() < count && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(1ms);
        };
        auto reader = enqueue(1, true); awaitPending(1);
        json refusedResult; std::string refusedError;
        Check("multiclient: readers cannot consume final queue slot", queue.Run([] { return json(); }, 1ms,
              refusedResult, refusedError, "capacity", 1ms, {}, true) == QueueResult::QueueFull);
        auto writer = enqueue(2, false); awaitPending(2);
        Check("multiclient: game frame task budget unchanged", queue.Drain(1) == 1 && order == std::vector<int>{2});
        queue.Drain(1); reader.join(); writer.join();
        Check("multiclient: queued reader follows writer", order == std::vector<int>({2, 1}));
    }

    {
        using namespace xfb;
        Config config; config.bridgeEnabled = true;
        Session session; std::string error;
        const auto dir = std::filesystem::current_path() / ("xfb-multiclient-unit-" + std::to_string(GetCurrentProcessId()));
        const bool owned = std::filesystem::create_directory(dir);
        Check("multiclient: isolated native transport fixture", owned && CreateSession(session, error, dir));
        if (owned) {
            GameThreadQueue queue; queue.SetPumping(true);
            Bridge bridge(config, session, queue);
            const bool started = bridge.Start(error);
            Check("multiclient: bounded reader pool starts", started, error);
            if (started) {
                auto open = [](const std::wstring& name) { return CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr); };
                const auto writer = open(session.pipeName);
                const auto readerName = session.pipeName + L"-read-0";
                const auto reader = open(readerName);
                const auto deadline = std::chrono::steady_clock::now() + 1s;
                while (!bridge.HasClient() && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(1ms);
                const auto generation = bridge.ConnectionsAccepted();
                Check("multiclient: writer plus reader admitted independently", writer != INVALID_HANDLE_VALUE && reader != INVALID_HANDLE_VALUE && bridge.HasClient());
                if (reader != INVALID_HANDLE_VALUE) CloseHandle(reader);
                auto replacement = open(readerName);
                const auto readerDeadline = std::chrono::steady_clock::now() + 1s;
                while (replacement == INVALID_HANDLE_VALUE && std::chrono::steady_clock::now() < readerDeadline) {
                    std::this_thread::sleep_for(1ms); replacement = open(readerName);
                }
                Check("multiclient: reader disconnect releases only its slot", replacement != INVALID_HANDLE_VALUE && bridge.HasClient() && bridge.ConnectionsAccepted() == generation && !bridge.TakeIdleDisconnect());
                if (replacement != INVALID_HANDLE_VALUE) {
                    DWORD written = 0;
                    const auto floodBegan = std::chrono::steady_clock::now();
                    const bool sent = WriteFile(replacement, "\n\n\n\n\n", 5, &written, nullptr) && written == 5;
                    bool connected = true;
                    const auto floodDeadline = floodBegan + 3s;
                    while (connected && std::chrono::steady_clock::now() < floodDeadline) {
                        DWORD available = 0;
                        connected = PeekNamedPipe(replacement, nullptr, 0, nullptr, &available, nullptr) != FALSE;
                        if (connected) std::this_thread::sleep_for(1ms);
                    }
                    Check("reader flood: blank lines incur backoff and disconnect", sent && !connected && MsSince(floodBegan) >= 500);
                    Check("reader flood: blank-line abuse never releases writer ownership", bridge.HasClient() && bridge.ConnectionsAccepted() == generation);
                    CloseHandle(replacement);
                }
                if (writer != INVALID_HANDLE_VALUE) CloseHandle(writer);
                const auto closedDeadline = std::chrono::steady_clock::now() + 1s;
                while (bridge.HasClient() && std::chrono::steady_clock::now() < closedDeadline) std::this_thread::sleep_for(1ms);
                Check("multiclient: writer disconnect releases owner", !bridge.HasClient());
            }
            bridge.Stop("unit");
            std::filesystem::remove(dir / "session.json");
            std::filesystem::remove(dir);
        }
    }
    {
        using namespace xfb;
        ReaderBackoff penalty;
        penalty.Observe(10000, 0, true);
        Check("reader flood: first strike backs off 50 ms", penalty.Remaining(10000) == 50);
        penalty.Reconnect(10010);
        Check("reader flood: reconnect does not clear pending penalty", penalty.Remaining(10010) == 100);
        penalty.Observe(11000, 0, true);
        Check("reader flood: strike history survives reconnect and elapsed cooldown", penalty.Remaining(11000) == 100);
        for (int i = 0; i < 20; ++i) penalty.Observe(12000 + i, 0, true);
        Check("reader flood: escalating delay caps at one second", penalty.Remaining(12019) == 1000);
        penalty.Observe(20000, 0, true);
        Check("reader flood: quiet period resets strikes", penalty.Remaining(20000) == 50);

        struct Sink : ILogSink {
            std::atomic<int> rateWarnings{0};
            void Write(Level, const std::string& line) override {
                if (line.find("evt=bridge.rate_limited") != std::string::npos) ++rateWarnings;
            }
        } sink;
        Config config; config.maxRequestsPerSecond = 1;
        Session session; session.token = "reader-flood";
        GameThreadQueue queue;
        Dispatcher dispatcher(config, session, queue);
        std::atomic<int> limited{0}, badMetadata{0};
        log::SetSink(&sink);
        const auto began = std::chrono::steady_clock::now();
        std::vector<std::thread> readers;
        for (int i = 0; i < 8; ++i) readers.emplace_back([&] {
            ReaderRequestBudget readerBudget(config.maxRequestsPerSecond);
            for (int j = 0; j < 100; ++j) {
                const auto result = dispatcher.Handle(R"({"token":"reader-flood","method":"ping"})", 1, false, &readerBudget);
                const auto response = json::parse(result.line);
                if (!response.value("ok", false) && response["error"]["code"] == "rate_limited") {
                    ++limited;
                    if (!result.rejected || !result.throttled || result.backoffMs < 50) ++badMetadata;
                }
            }
        });
        for (auto& reader : readers) reader.join();
        const auto elapsed = MsSince(began);
        log::SetSink(nullptr);
        Check("reader flood: authenticated pacing refusals incur endpoint strikes", limited > 700 && badMetadata == 0);
        Check("reader flood: eight readers share sampled refusal logging", sink.rateWarnings > 0 && sink.rateWarnings <= 1 + elapsed / 1000);
        Check("reader flood: writer pacing reserve survives abuse", json::parse(dispatcher.Handle(R"({"token":"reader-flood","method":"ping"})", 2).line)["ok"] == true);

        ReaderRequestBudget readerBudget(config.maxRequestsPerSecond);
        const auto badVersion = dispatcher.Handle(R"({"v":2,"token":"reader-flood","method":"bridge.kill"})", 1, false, &readerBudget);
        const auto missingRoute = dispatcher.Handle(R"({"token":"reader-flood","method":"bridge.kill"})", 1, false, &readerBudget);
        Check("reader flood: invalid emergency envelopes cannot bypass backoff", badVersion.backoffMs >= 50 && badVersion.throttled &&
              json::parse(badVersion.line)["error"]["code"] == "bad_version");
        Check("reader flood: unavailable emergency routes cannot bypass backoff", missingRoute.backoffMs >= 50 && missingRoute.throttled &&
              json::parse(missingRoute.line)["error"]["code"] == "unknown_method");

        int stops = 0;
        dispatcher.Register({"behave.stop", Access::Control, RunOn::BridgeThread, "", [&](const MethodContext&) { ++stops; return json{{"stopping", 1}}; }});
        auto cancel = [&](bool reader, bool control = false) {
            return dispatcher.Handle(R"({"token":"reader-flood","method":"behave.stop","params":{"all":true}})", 1, control, reader ? &readerBudget : nullptr);
        };
        const auto first = cancel(true), repeated = cancel(true);
        Check("reader flood: first emergency bypasses exhausted ordinary pacing", json::parse(first.line)["ok"] == true && stops == 1);
        Check("reader flood: matching emergency coalesces without executing twice", json::parse(repeated.line)["result"]["coalesced"] == true && repeated.throttled && repeated.backoffMs == 100);
        const auto control = cancel(false, true);
        Check("reader flood: control cancellation is independent and never backs off", json::parse(control.line)["ok"] == true && control.backoffMs == 0 && !control.throttled && stops == 2);
        cancel(true);
        Check("reader flood: intervening control invalidates stale reader receipts", stops == 3);
        // New sessions must invalidate receipts even when ordinary credit is exhausted.
        dispatcher.Revive();
        cancel(true);
        Check("reader flood: rearm invalidates stale emergency receipts", stops == 4);
        int failed = 0;
        dispatcher.Register({"player.stop", Access::Control, RunOn::BridgeThread, "", [&](const MethodContext&) -> json {
            if (++failed == 1) throw MethodError("failed", "fixture"); return json();
        }});
        const auto retry = R"({"token":"reader-flood","method":"player.stop"})";
        dispatcher.Handle(retry, 1, false, &readerBudget);
        dispatcher.Handle(retry, 1, false, &readerBudget);
        Check("reader flood: failed emergency remains retryable", failed == 2);
    }
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
    ShowroomTests();
    ScriptLayerTests();
    WardrobeTests();
    InkUiTests();
    Bridge060Tests();
    Bridge061Tests();
    Bridge070Tests();
    Bridge080Tests();
    Bridge070ReviewTests();
    Bridge081Tests();
    Bridge082Tests();
    Session9Tests();
    Bridge083Tests();
    Bridge086Tests();
    Bridge087Tests();
    Bridge0811Tests();
    gFailures += RunNpcUnitTests();
    gFailures += RunNpcSubstituteUnitTests();
    gFailures += SensesUnitTests();
    gFailures += DmUnitTests();
    gFailures += InputUnitTests();
    gFailures += RecordingUnitTests();
    gFailures += IncidentUnitTests();
    gFailures += OverlayUnitTests();
    gFailures += CanvasUnitTests();
    gFailures += SupervisorUnitTests();
    std::printf(gFailures == 0 ? "UNIT OK\n" : "UNIT FAILED %d\n", gFailures);
    return gFailures == 0 ? 0 : 1;
}
