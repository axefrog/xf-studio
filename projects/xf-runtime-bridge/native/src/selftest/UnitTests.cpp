// In-process checks of the bridge core pieces that are hard to reach through the pipe:
// UTF-8-safe log sanitising, the JSON nesting pre-scan, lossless-or-replaced serialisation and
// the game-thread queue's task states. Run with `xfb_selftest --unit`; prints PASS/FAIL lines.

#include <Windows.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

#include "core/Dispatcher.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Log.hpp"

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
} // namespace

int RunUnitTests()
{
    SanitizeTests();
    NestingTests();
    SerializeTests();
    QueueTests();
    std::printf(gFailures == 0 ? "UNIT OK\n" : "UNIT FAILED %d\n", gFailures);
    return gFailures == 0 ? 0 : 1;
}
