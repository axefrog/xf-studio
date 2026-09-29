#pragma once

// The session event stream (bridge 0.6): what happened in the game session, in order, for an agent to read or tail
// (session.events; the tools' session.log merges it with their own command log). Events come from the bridge itself
// (every write accepted or refused, the kill switch, a handover and its resume, re-arming), from behaviours (started,
// progress, stopped and why), and from notes: session.note from a client, or XFBridge_Note from inside the game (a CET
// or redscript button, such as the XF HUD panel's later).
//
// Bounded by design: a ring of kMaxEvents; a reader that falls behind is told how many it missed (dropped). Text is
// cleaned like ui.message's (one line, valid UTF-8, at most kMaxText characters); data is a small JSON object, cut when
// its text would exceed kMaxData bytes. Thread-safe: pushed from the pipe thread, the game thread and natives.

#include <chrono>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb
{
class Dispatcher;

class EventLog
{
public:
    static constexpr size_t kMaxEvents = 1000;
    static constexpr size_t kMaxText = 300;
    static constexpr size_t kMaxData = 4096;

    // Adds an event: kind (write, refused, kill, handover, resume, behaviour, note, rearm, ...), level (info, warn, done,
    // ask), source (bridge, client, game, behaviour), a one-line text and optional data. Returns its sequence number.
    uint64_t Push(const std::string& aKind, const std::string& aLevel, const std::string& aSource, const std::string& aText,
                  nlohmann::json aData = nullptr);

    // Events after aSince (0: from the oldest kept), at most aLimit, optionally only the given kinds:
    // {events: [{seq, at, t_ms, kind, level, source, text, data?}], next (the last seq returned, or aSince), latest,
    //  dropped (events after aSince that are no longer kept)}.
    nlohmann::json Read(uint64_t aSince, size_t aLimit, const std::vector<std::string>& aKinds = {}) const;

    uint64_t Latest() const;
    void Clear();

private:
    struct Event
    {
        uint64_t seq;
        std::string at; // UTC, ISO 8601
        int64_t tMs;    // milliseconds since the log started (steady clock)
        std::string kind, level, source, text;
        nlohmann::json data;
    };
    mutable std::mutex m_mutex;
    std::deque<Event> m_events;
    uint64_t m_next = 1;
    std::chrono::steady_clock::time_point m_start = std::chrono::steady_clock::now();
};

// session.events {since, limit, kinds}: parameters checked (throws MethodError bad_params).
struct EventsRequest
{
    uint64_t since = 0;
    size_t limit = 100;
    std::vector<std::string> kinds;
};
EventsRequest ParseEventsRequest(const nlohmann::json& aParams);

// session.note {text, level, data}: a note into the stream (notify class: changes nothing in the game).
struct NoteRequest
{
    std::string text;
    std::string level = "info";
    nlohmann::json data;
};
NoteRequest ParseNoteRequest(const nlohmann::json& aParams);

// Registers session.events (read) and session.note (notify) on a dispatcher, for the plugin and the self-test host alike.
void RegisterEventMethods(Dispatcher& aDispatcher, EventLog& aLog);
} // namespace xfb
