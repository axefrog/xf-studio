#pragma once

// ui.message: short messages from the coordinator (or a session script) shown under the bridge's
// in-game status label, so the player can follow a session without leaving the game. The plugin keeps
// them here; the CET layer polls XFBridge_Messages() a few times a second and draws them.
//
// Bounded by design: at most kMaxMessages at once (a new one pushes out the oldest), each at most
// kMaxChars characters on one line (control characters become spaces, invalid UTF-8 is replaced, a
// long text is cut at a character boundary), each shown for 1 to kMaxSeconds seconds. The kill switch
// clears them, and a killed bridge shows none.

#include <chrono>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

namespace xfb
{
struct MessageRequest
{
    std::string text;
    int32_t seconds = 8;
    std::string level = "info"; // info, ask, warn, done
    bool clear = false;         // remove every message first (with no text: only that)
};

// One line of plain text, at most aMaxChars Unicode characters: control characters (newlines, tabs)
// become spaces, runs of spaces collapse, the ends are trimmed, and invalid UTF-8 becomes U+FFFD.
// aTruncated says whether characters were cut.
std::string CleanMessageText(const std::string& aText, size_t aMaxChars, bool* aTruncated = nullptr);

class MessageBoard
{
public:
    static constexpr size_t kMaxMessages = 4;
    static constexpr size_t kMaxChars = 200;
    static constexpr int32_t kMaxSeconds = 600;

    using Clock = std::chrono::steady_clock;

    // Shows a message (after clear, if asked). Answers {id, shown, text, level, seconds, truncated,
    // dropped (ids pushed out), active}; {cleared: n, active: 0} for a clear without text.
    nlohmann::json Post(const MessageRequest& aRequest, Clock::time_point aNow = Clock::now());
    // The messages still showing, oldest first: {"messages":[{id, text, level, remaining_ms}]}, or an
    // empty string when there are none (what XFBridge_Messages answers).
    std::string Snapshot(Clock::time_point aNow = Clock::now());
    // Removes every message; returns how many were showing.
    size_t Clear();
    size_t Active(Clock::time_point aNow = Clock::now());

private:
    struct Message
    {
        uint64_t id;
        std::string text;
        std::string level;
        Clock::time_point expires;
    };
    void DropExpired(Clock::time_point aNow);

    std::mutex m_mutex;
    std::deque<Message> m_messages;
    uint64_t m_next = 1;
};
} // namespace xfb
