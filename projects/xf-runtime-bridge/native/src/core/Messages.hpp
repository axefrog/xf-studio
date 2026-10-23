#pragma once

// ui.message: short messages from the coordinator (or a session script) shown under the bridge's
// in-game CET line, so the player can follow a session without leaving the game. The plugin keeps
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
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb
{
struct MessageRequest
{
    std::string text;
    int32_t seconds = 8;
    std::string level = "info"; // info, ask, warn, done
    // Remove the lines first (with no text: only that). 0.8.2 (session 9's B6): a question still waiting is withdrawn too, unless
    // keepAsks (a capture's clear keeps it, RB-103: the player can still answer once the picture is taken).
    bool clear = false;
    // 0.7 (session 7, in-game driving): an ask's answer buttons, 1 to kMaxChoices labels. 0.8 (session 8: Ready, Yes and No
    // on every question confused the maintainer): an ask without them gets DefaultChoices(), one "Done". Only asks carry
    // choices.
    std::vector<std::string> choices;
    bool keepAsks = false;  // with clear: a question still waiting stays (0.8.2; before, clear_asks asked for the opposite)
    uint64_t withdraw = 0;  // remove this one message first (an ask's undo)
};

// What became of an ask (session.wait's question_gone, RB-103): "pending" (showing, unanswered), "answered" (with the
// answer), "gone" (withdrawn, cleared or expired without an answer) or "unknown" (no such message was posted).
struct AskState
{
    std::string state;
    int32_t choice = -1;
    std::string label;
};

// The ask the player can answer now: the latest unanswered ask still showing (pinned: newer lines never push it out).
struct PendingAsk
{
    uint64_t id = 0;
    std::string text;
    std::vector<std::string> choices;
    int64_t remainingMs = 0;
};

// 0.8 (the UI review): an ask the player has answered stays in place, question and all, with "Answered: <label>" where its
// keys were, until the next message arrives (or its time runs out), so nothing on screen jumps.
struct AnsweredAsk
{
    uint64_t id = 0;
    std::string text;
    std::string label;
};

// One line of plain text, at most aMaxChars Unicode characters: control characters (newlines, tabs)
// become spaces, runs of spaces collapse, the ends are trimmed, and invalid UTF-8 becomes U+FFFD.
// aTruncated says whether characters were cut. 0.8 (the UI review): a cut text backs up to its last word boundary (when
// one lies in its last third) and ends with an ellipsis, so it never stops mid-word.
std::string CleanMessageText(const std::string& aText, size_t aMaxChars, bool* aTruncated = nullptr);

// 0.8: a surface's own copy of a text (the ink panel's font, CET's Latin-1 font, the overlay's baked glyphs), applied when
// the text is handed to that surface; the board keeps the original.
using SurfaceText = std::string (*)(const std::string&);

// ui.message's undo from its answer: a posted line or question is withdrawn by its id; a clear has none to undo.
nlohmann::json UiMessageUndo(const nlohmann::json& aPosted);
// ui.ask.state {id}'s answer (RB-96, RB-103).
nlohmann::json AskStateJson(uint64_t aId, const AskState& aState);

// 0.8.5: the soft sound for a new question ([ui] question_sound, played by the plugin's Running tick). Take answers true once
// for each new question: a pending ask newer than any it has answered for (message ids only grow). Info lines are never
// asks, a question already sounded or answered stays quiet, and 0 means none is pending. Skip marks the questions up to
// aPendingAskId as sounded without a sound (the switch off, the bridge stopped), so they don't sound late.
class QuestionChime
{
public:
    bool Take(uint64_t aPendingAskId)
    {
        if (aPendingAskId == 0 || aPendingAskId <= m_last)
        {
            return false;
        }
        m_last = aPendingAskId;
        return true;
    }
    void Skip(uint64_t aPendingAskId)
    {
        m_last = aPendingAskId > m_last ? aPendingAskId : m_last;
    }

private:
    uint64_t m_last = 0;
};

class MessageBoard
{
public:
    static constexpr size_t kMaxMessages = 4;
    static constexpr size_t kMaxChars = 600; // 0.7 (session 7): the CET label and the ink panel wrap long lines; 200 cut the coordinator short
    static constexpr int32_t kMaxSeconds = 600;
    static constexpr size_t kMaxChoices = 4;
    static constexpr size_t kMaxChoiceChars = 24;
    static constexpr int32_t kAnsweredSeconds = 6; // an answered ask stays at least this long (0.8: until the next message)

    static std::vector<std::string> DefaultChoices();

    using Clock = std::chrono::steady_clock;

    // Shows a message (after clear or withdraw, if asked). Answers {id, shown, text, level, seconds, truncated,
    // dropped (ids pushed out), active}; {cleared: n, active} for a clear without text. A clear withdraws a question that
    // is still waiting for its answer unless keepAsks (RB-103: a capture's clear must not take the question away). 0.8.2
    // (session 9's B6): one question at a time: a new ask withdraws any question still waiting (withdrawn: [ids]; a
    // session_wait on one ends with question_gone), so questions never stack.
    nlohmann::json Post(const MessageRequest& aRequest, Clock::time_point aNow = Clock::now());
    // The messages still showing, oldest first: {"messages":[{id, text, level, remaining_ms, choices?, answered?}],
    // pending_ask?, answered_ask?}, or an empty string when there are none (what XFBridge_Messages answers). aSurface, when
    // given, turns every text and label into that surface's copy (0.8: the CET layer's Latin-1 copy).
    std::string Snapshot(Clock::time_point aNow = Clock::now(), SurfaceText aSurface = nullptr);
    // The messages still showing, oldest first, as (level, text): what the ink HUD panel draws (bridge 0.5.3, XFBridge_Hud).
    std::vector<std::pair<std::string, std::string>> Lines(Clock::time_point aNow = Clock::now());
    // Removes every message; returns how many were showing.
    size_t Clear();
    size_t Active(Clock::time_point aNow = Clock::now());

    // 0.7: the ask the player can answer now, if any.
    bool Pending(PendingAsk& aOut, Clock::time_point aNow = Clock::now());
    // 0.8: the newest answered ask still showing, if any.
    bool Answered(AnsweredAsk& aOut, Clock::time_point aNow = Clock::now());
    // The player's answer to ask aId (0: the pending one) with choice aChoice (0-based). On success the ask keeps its text
    // and shows "Answered: <choice>" in place of its keys until the next message (at least kAnsweredSeconds), and the answer
    // is {ok: true, message_id, choice, label, text}; otherwise {ok: false, why} (no such ask showing, already answered,
    // choice out of range).
    nlohmann::json Answer(uint64_t aId, int32_t aChoice, Clock::time_point aNow = Clock::now());
    // 0.8.9 (session 15: a stray F6 just after a question changed answered the new one): an answer by a key (aByKey) within
    // kKeyGuard of the question appearing is ignored, {ok: false, why, too_soon: true}; buttons and clicks aren't held back.
    nlohmann::json Answer(uint64_t aId, int32_t aChoice, bool aByKey, Clock::time_point aNow = Clock::now());
    static constexpr std::chrono::milliseconds kKeyGuard{500};
    // RB-96/RB-103: what became of ask aId (session.wait reads it through ui.ask.state).
    AskState StateOf(uint64_t aId, Clock::time_point aNow = Clock::now());
    static constexpr size_t kAnsweredKept = 64;

private:
    struct Message
    {
        uint64_t id;
        std::string text;
        std::string level;
        Clock::time_point expires;
        std::vector<std::string> choices; // an unanswered ask's; empty once answered
        Clock::time_point posted{};       // 0.8.9: when it appeared (the answer keys' guard)
        std::string answered;             // 0.8: an answered ask's answer label (its text stays the question)
    };
    void DropExpired(Clock::time_point aNow);
    bool PendingLocked(PendingAsk& aOut, Clock::time_point aNow) const;
    bool AnsweredLocked(AnsweredAsk& aOut, Clock::time_point aNow) const;

    std::mutex m_mutex;
    std::deque<Message> m_messages;
    uint64_t m_next = 1;
    // The last kAnsweredKept answers by ask id (the "Answered: ..." line fades after kAnsweredSeconds).
    std::deque<std::pair<uint64_t, AskState>> m_answered;
};
} // namespace xfb
