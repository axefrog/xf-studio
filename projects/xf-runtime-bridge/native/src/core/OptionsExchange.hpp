#pragma once

// game.options.read's second half: the engine's render options (GameOptions such as
// Editor/Characters/Hair/GlobalLight/R), which no game script can read. Cyber Engine Tweaks can
// (GameOptions.Get, from the option list it collects at start-up), so the bridge asks the CET layer:
//
//   bridge thread   Request(names) -> seq          the method, then WaitFor(seq)
//   CET (onUpdate)  XFBridge_OptionsWanted()        Pending(): {"seq":n,"names":[...]}, or ""
//   CET             XFBridge_OptionsReport(json)    Report(): {"seq":n,"values":{"cat/name":"text"|null}}
//
// Only one request is pending at a time (a newer one replaces it). Report checks everything it is
// given: the size, that it is a JSON object for the pending seq, and that every key was asked for
// and every value is a short string or null. It never throws. Cancel (the kill switch) releases
// any waiter and refuses later reports. Game-independent, so the self-test host and the unit tests
// use exactly this class.

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

    // The answer's values for aSeq once it arrives, or nullopt after aTimeout or Cancel.
    std::optional<nlohmann::json> WaitFor(uint64_t aSeq, std::chrono::milliseconds aTimeout);

    // Withdraws a request nobody answered (the waiter timed out).
    void Withdraw(uint64_t aSeq);

    // Kill switch: releases waiters, clears the pending request and refuses everything after.
    void Cancel();

private:
    mutable std::mutex m_mutex;
    std::condition_variable m_changed;
    uint64_t m_seq = 0;
    bool m_pending = false;
    bool m_cancelled = false;
    std::vector<std::string> m_names;
    uint64_t m_answeredSeq = 0;
    nlohmann::json m_answer;
};
} // namespace xfb
