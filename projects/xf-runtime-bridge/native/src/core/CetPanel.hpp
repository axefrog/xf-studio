#pragma once

// 0.8.22: cet.panel, the CET window's own controls driven by a tool (the styling batch's ST rows): the DIAGNOSTICS header opened
// or closed, and the Pause changes / Resume changes button pressed. The plugin only queues the request; the CET layer takes it
// about four times a second through XFBridge_CetPanel, which also carries its report back (what it last drew: the header's
// state, the chip and tone), so bridge.info can say what the window shows.
//
// The review of 0.8.22 (one High, three Medium) set the rules:
//   - A press is a test feature: only builds with the autonomous test hooks and allow_test_hooks take one, and a remote Resume
//     changes never undoes a pause the player set with the button (paused_by_player). Header changes are notify, in every build.
//   - Every request belongs to the bridge session and the client connection it came from: a kill, the client going, or a new
//     client cancels what is still queued. A press runs only after the CET layer claims it (the claim checks all of that again)
//     and XFBridge_PauseWrites takes the claim, so a press queued in the CET layer before a kill is refused, not run.
//   - Receipt is not completion: a header request is sent again until the CET layer reports that a draw applied it (a CET
//     reload replays it), and a press is claimed once, so a replay never runs it twice.
//   - The undo is tied to the request: cet.panel {undo: id} puts back what the CET layer captured when it applied that request
//     (the header as drawn before, the pause state before the press). An earlier header state the window never drew stays
//     unknown, and the header is then left as it is.
//
// Game-independent: the plugin and the self-test host use it; the unit tests check the queue, the claims and the undo.

#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

namespace xfb::cetpanel
{
using json = nlohmann::json;

inline constexpr size_t kMaxPending = 8;
inline constexpr size_t kKeptRecords = 16;

enum class PauseOrigin
{
    None,
    Player, // the window's own button, clicked
    Bridge  // a press cet.panel asked for
};
const char* PauseOriginName(PauseOrigin aOrigin);

// What the plugin knows when a request comes in or the CET layer calls.
struct Context
{
    std::string generation;    // the bridge session and its client connection ("<sid>:<connection>")
    bool killed = false;
    bool ownerConnected = true;
    bool pressAllowed = false; // the autonomous test hooks, and allow_test_hooks
    bool writesAllowed = false;
    bool writesPaused = false;
    PauseOrigin pausedBy = PauseOrigin::None; // who paused, while paused
    std::optional<bool> cetOpen;              // CET's overlay as the CET layer reported it; nullopt unknown
};

// XFBridge_PauseWrites asks whether this call is a claimed press: Press (bridge-originated), Cancelled (the claim's session,
// client or the bridge itself went in between: refuse), or None (the player's own click).
struct ClaimUse
{
    enum class Kind
    {
        None,
        Press,
        Cancelled
    } kind = Kind::None;
    uint64_t id = 0;
};

class Channel
{
public:
    // cet.panel {diagnostics_open?, press?} or {undo: id}: validates, queues one request for the CET layer, answers when each part
    // applies and the undo.
    json Request(const json& aParams, const Context& aContext);
    // XFBridge_CetPanel: a report (a JSON object as text) in, the requests not completed yet out (a JSON array, oldest first, or ""
    // when none); a claim ({"claim": id}) answers {claimed, why} instead. Cancels what the context no longer allows.
    std::string Exchange(const std::string& aReport, const Context& aContext);
    // XFBridge_PauseWrites: whether this call runs a claimed press (aPaused is the call's value).
    ClaimUse TakeClaim(bool aPaused, const Context& aContext);
    // XFBridge_PauseWrites' answer to a claimed press.
    void NotePress(uint64_t aId, const json& aAnswer);
    // bridge.info's cet_panel: the CET layer's last report, the recent requests and how many wait; null before either exists.
    json Report() const;

private:
    struct Record
    {
        uint64_t id = 0;
        std::string generation;
        std::optional<bool> header;
        std::string headerStatus; // pending, applied, superseded, cancelled
        json headerPrevious;      // the header as the window drew it before (bool), or null when unknown
        std::string press;        // pause_changes or resume_changes
        std::string pressStatus;  // pending, claimed, done, refused, cancelled
        json pressPrevious;       // whether changes were paused before the press, or null
        json answer;
        std::string why;
    };
    Record* Find(uint64_t aId);
    void CancelLocked(const std::string& aWhy, const std::string* aOnlyOtherThan = nullptr);
    size_t PendingLocked() const;
    json Brief(const Record& aRecord) const;

    mutable std::mutex m_mutex;
    uint64_t m_nextId = 1;
    std::deque<Record> m_records;
    std::optional<uint64_t> m_claimed;
    json m_report; // null until the first report
};
} // namespace xfb::cetpanel
