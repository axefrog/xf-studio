#pragma once

// game.options.read's second half: the engine's render options (GameOptions such as
// Editor/Characters/Hair/GlobalLight/R), which no game script can read. Cyber Engine Tweaks can
// (GameOptions.Get, from the option list it collects at start-up), so the bridge asks the CET layer:
//
//   bridge thread   Request(names) -> seq          the method, then WaitFor(seq)
//   CET (onUpdate)  XFBridge_OptionsWanted()        Pending(): {"seq":n,"names":[...]}, or ""
//   CET             XFBridge_OptionsReport(json)    Report(): {"seq":n,"values":{"cat/name":"text"|null},
//                                                             "skipped":["cat/name",...]}
//
// Only one request is pending at a time (a newer one replaces it). Report checks everything it is
// given: the size, that it is a JSON object for the pending seq, and that every key was asked for
// and every value is a string or null. A value longer than kMaxValueChars is kept as null and named
// under too_long rather than refusing the whole answer; skipped lists the names the CET layer left
// out on purpose (too long, or to keep the answer under the size limit). An answer that is refused
// while a request is pending (too large, not JSON, the wrong shape) ends that request at once with
// the reason, so the waiter reports it instead of waiting out its timeout (RB-47). It never throws.
// Cancel (the kill switch) releases any waiter and refuses later reports; Reset (re-arming the bridge
// after the kill switch) accepts requests again. Game-independent, so the self-test host and the unit
// tests use exactly this class.
//
// Trust (RB-48): XFBridge_OptionsWanted and XFBridge_OptionsReport are global natives, so any script
// running inside the game process (another CET mod, any redscript) can read the pending request and
// answer it first, with any text for the names asked for. That is accepted: such code already runs in
// the game with the same power as the bridge (it could change the options, or the game's memory), the
// answer is only ever reported as text, and it can't reach anything but this one read. The bridge's
// boundary is the Windows user (research/runtime/runtime-bridge-design.md §4).

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb
{
// Details of how a request ended, besides its values.
struct OptionsOutcome
{
    std::string refusal;                // why the CET layer's answer was refused ("" when it wasn't)
    std::vector<std::string> tooLong;   // values longer than kMaxValueChars (kept as null)
    std::vector<std::string> skipped;   // names the CET layer left out on purpose
};

class OptionsExchange
{
public:
    static constexpr size_t kMaxReportBytes = 64 * 1024;
    static constexpr size_t kMaxValueChars = 256;

    // Asks for these option names ("<category>/<name>"); returns the request's sequence number.
    uint64_t Request(std::vector<std::string> aNames);

    // The pending request as JSON text, or "" when nothing is pending (or after Cancel).
    std::string Pending() const;

    // Stores an answer. False (and nothing stored) unless it answers the pending request exactly.
    bool Report(const std::string& aJson, std::string* aWhy = nullptr);

    // The answer's values for aSeq once it arrives, or nullopt after aTimeout, Cancel or a refused
    // answer (aOutcome->refusal then says why).
    std::optional<nlohmann::json> WaitFor(uint64_t aSeq, std::chrono::milliseconds aTimeout,
                                          OptionsOutcome* aOutcome = nullptr);

    // Withdraws a request nobody answered (the waiter timed out).
    void Withdraw(uint64_t aSeq);

    // Kill switch: releases waiters, clears the pending request and refuses everything after.
    void Cancel();
    // Re-arm after the kill switch: requests are accepted again (nothing is pending).
    void Reset();

private:
    bool Refuse(const std::string& aReason, std::string* aWhy, bool aEndsPending);

    mutable std::mutex m_mutex;
    std::condition_variable m_changed;
    uint64_t m_seq = 0;
    bool m_pending = false;
    bool m_cancelled = false;
    std::vector<std::string> m_names;
    uint64_t m_answeredSeq = 0;
    nlohmann::json m_answer;
    OptionsOutcome m_outcome;
    uint64_t m_refusedSeq = 0;
};

// game.options.read's render_options block from a finished request: available with values, missing,
// too_long and skipped; or not available with a plain reason (no answer within aWaitMs, or the answer
// was refused and why). Shared by the plugin and the self-test host.
nlohmann::json RenderOptionsResult(const std::vector<std::string>& aNames, const std::optional<nlohmann::json>& aValues,
                                   const OptionsOutcome& aOutcome, int aWaitMs);
} // namespace xfb
