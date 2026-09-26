// In-process checks of the bridge core pieces that are hard to reach through the pipe:
// UTF-8-safe log sanitising, the JSON nesting pre-scan, lossless-or-replaced serialisation and
// the game-thread queue's task states. Run with `xfb_selftest --unit`; prints PASS/FAIL lines.

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <functional>
#include <thread>

#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Log.hpp"
#include "core/Params.hpp"

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
}
} // namespace

int RunUnitTests()
{
    SanitizeTests();
    NestingTests();
    SerializeTests();
    QueueTests();
    ParamsTests();
    std::printf(gFailures == 0 ? "UNIT OK\n" : "UNIT FAILED %d\n", gFailures);
    return gFailures == 0 ? 0 : 1;
}
