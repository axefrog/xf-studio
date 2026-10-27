#pragma once

// Request handling for the bridge protocol (version 1).
//
// Request  (one JSON object per line):
//   {"v":1, "id":<number|string|null>, "token":"<session token>", "method":"ping", "cid":"optional", "params":{...}}
// Response (one JSON object per line):
//   {"v":1, "id":<same, or null>, "cid":"<cid>", "ok":true, "result":{...}}
//   {"v":1, "id":<same, or null>, "cid":"<cid>", "ok":false, "error":{"code":"...", "message":"..."}}
//
// Order of checks: nesting pre-scan -> parse -> rate limit -> token -> version -> kill switch
// -> allowlist -> write gate -> run. The transport already bounded the line to 64 KiB.
// Only registered methods exist (the allowlist); nothing evaluates code sent by a client.
// Every refusal is logged. Malformed and unauthenticated requests are marked "rejected" so the
// transport can drop a connection that sends too many of them.

#include <atomic>
#include <array>
#include <chrono>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

#include "core/Config.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Session.hpp"

namespace xfb
{
// The same classes as the tools' permission classes (tools/api/catalogue.ts). Every write class is
// refused unless [bridge] allow_writes = true, and then only if allow_write_classes lists it.
enum class Access
{
    Read,           // observes; never changes the game
    Write,          // a write outside the write classes (diagnostic probes); needs allow_writes only
    WritePhoto,     // photo mode only; gone when it closes
    WriteWorld,     // clock and freeze
    WriteCharacter, // the mirror screen's options
    WriteInventory, // V's clothing and inventory (inventory.*); off unless allow_write_classes lists "inventory"
    WriteSave,      // manual saves and loading (game.save, game.load); off unless the list has "save"
    WriteShowroom,  // XF Finish Showroom props and light rigs (showroom.*); off unless the list has "showroom"
    WritePlayer,    // 0.6: reversible player changes (teleport, look, crouch, weapons, menus, behaviours that move V); "player"
    ActPlayer,      // 0.6: irreversible actions in the world (using devices, dialogue, consuming); "act"
    WriteNpc,       // 0.8: NPC direction (npc.*: XF actors, commands, lines, gestures, dialogue choices); "npc"
    WriteDm,        // 0.8.12: the live-direction toolkit (props, vehicles, doors, sounds, phone, tracker, lights, watchers); "dm"
    Notify,         // shows a message in the bridge's own in-game label (ui.message); not a write, never changes the game
    Display,        // changes only the bridge's canvas; permitted on observer connections
    Control         // changes only the bridge itself (bridge.kill); always allowed, never touches the game
};

std::string_view AccessName(Access aAccess);
// The name allow_write_classes lists for a write class ("photo", ..., "player", "act"); empty for the others.
std::string_view ConfigClassName(Access aAccess);
bool IsWrite(Access aAccess);
// The config bit for a write class (0 for Read, Write and Control).
uint32_t WriteClassBit(Access aAccess);

enum class RunOn
{
    BridgeThread, // pure bookkeeping; never touches game objects
    GameThread    // marshalled through GameThreadQueue
};

struct MethodContext
{
    std::string cid;
    nlohmann::json params;
    std::string rawParams; // exact params slice, including whitespace, for canvas's byte cap and digest
    uint64_t connection = 0; // transport-issued identity; never supplied by a client or inferred from PID
    uint32_t clientPid = 0;
    bool readOnlyConnection = false;
    // Authenticated client may narrow config permissions. Missing claims are forbidden for arming.
    std::optional<uint32_t> callerWriteClasses;
};

// Thrown by a method to return a specific error code.
class MethodError : public std::runtime_error
{
public:
    MethodError(std::string aCode, const std::string& aMessage)
        : std::runtime_error(aMessage)
        , code(std::move(aCode))
    {
    }
    std::string code;
    nlohmann::json detail;
};

struct MethodSpec
{
    std::string name;
    Access access = Access::Read;
    RunOn runOn = RunOn::BridgeThread;
    std::string summary;
    std::function<nlohmann::json(const MethodContext&)> fn;
};

struct DispatchResult
{
    std::string line;      // response JSON, without the newline
    bool rejected = false; // malformed, unauthenticated or reader pacing abuse
    uint32_t backoffMs = 0; // transport-only; never supplied by request data
    bool throttled = false;
};

// One connection's pipe-thread request budget. Never shared by concurrent readers.
// Clamp independently of writer tuning: at most eight slots, 20/s and a 40-request
// burst each. The transport's endpoint backoff still survives reconnection.
class ReaderRequestBudget
{
public:
    static constexpr uint32_t kMaxRate = 20;
    explicit ReaderRequestBudget(uint32_t rate = kMaxRate);
    bool Take(std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now());
private:
    double m_rate, m_tokens;
    // Initialise on first Take(now), using the same clock as the owning dispatcher.
    std::optional<std::chrono::steady_clock::time_point> m_lastRefill;
};

// Deepest array/object nesting allowed in a request. nlohmann/json parses iteratively, but
// copying, comparing and serialising a value recurse, so a deeply nested value (for example a
// 20 KB "id" of nested arrays) would overflow the thread's stack. Checked before parsing.
inline constexpr size_t kMaxJsonDepth = 32;

// Deepest [ ] / { } nesting in aText, ignoring brackets inside strings. Stops scanning once the
// depth exceeds aLimit. Never recurses, so it is safe on any input.
size_t JsonNestingDepth(std::string_view aText, size_t aLimit);

// Serialises for the wire or the log. Invalid UTF-8 in strings becomes U+FFFD instead of
// throwing (nlohmann's default), so a method returning raw game text cannot throw here.
std::string SerializeJson(const nlohmann::json& aValue);

class Dispatcher
{
public:
    // Inject only pacing time; queue deadlines, emergency receipts and audit timestamps
    // keep their real monotonic clock even when a test freezes token refill.
    using PacingClock = std::function<std::chrono::steady_clock::time_point()>;
    Dispatcher(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue,
               PacingClock aPacingClock = std::chrono::steady_clock::now);

    void Register(MethodSpec aSpec);
    // 0.8.12: the access class a registered method has (the watchers' micro-actions check it), or nothing for an unknown name.
    std::optional<Access> AccessOf(const std::string& aMethod) const;

    // Never throws: an unexpected failure is logged and answered with code "failed". aControlRoute (0.8.1, RB-121): the
    // request came on the control pipe, which answers only IsControlRouteMethod's methods (refused not_on_control_route).
    // A non-null budget denotes a read-only connection; its owner is the pipe worker.
    DispatchResult Handle(const std::string& aLine, uint32_t aClientPid, bool aControlRoute = false,
                          ReaderRequestBudget* aReaderBudget = nullptr, uint64_t aConnection = 0) noexcept;
    // Trusted in-process caller only. Propagates an execution-frame guard to every queued step;
    // never accepted from request data. Cleanup inside RestoreScope remains unconditional.
    using ExecutionGuard = std::function<void(bool changing)>;
    DispatchResult HandleGuarded(const std::string&, uint32_t, ExecutionGuard) noexcept;
    void SetSafetyCancellation(std::function<void(const std::string&)> fn) { m_safetyCancellation = std::move(fn); }

    // RB-122 (0.8.1): one game-thread step that changes the game, on this dispatcher's queue: like RunGameTask, and the step
    // also passes RequireWritesOpen on the game thread right before it runs, so a kill, a pause or a handover that came
    // after the request was accepted refuses it. Every changing step of a multi-step write goes through here; reads use
    // RunGameTask, and steps inside a RestoreScope (putting something back) skip the write gate.
    nlohmann::json RunWrite(std::chrono::milliseconds aTimeout, const std::function<nlohmann::json()>& aTask,
                            const std::string& aLabel) const;
    // Admit bookkeeping on the bridge thread, then perform a guarded read on the game thread.
    nlohmann::json RunRead(const std::function<nlohmann::json()>& aTask, const std::string& aLabel) const;

    // Kill switch: every later request is refused with "killed" until the bridge is re-armed from the
    // game (Bridge::Rearm) or the game restarts.
    void Kill(const std::string& aReason);
    bool IsKilled() const;
    std::string KillReason() const;
    // Re-arm: accept requests again. Only Bridge::Rearm calls it, after the listener has stopped.
    void Revive();

    // The in-game panel's pause: while paused, every write is refused with writes_paused. It can only
    // take access away: with allow_writes = false in config.ini nothing changes, and resuming gives back
    // exactly what config.ini allows (research/runtime/runtime-bridge-design.md §4).
    void SetWritesPaused(bool aPaused);
    bool WritesPaused() const;

    // For multi-step writes, before each step that changes the game (RB-53): throws MethodError killed
    // or writes_paused when the kill switch or the panel's pause came after the request was accepted.
    // 0.6: also handed_over while the session is handed over to the player. RunWrite makes the same check on the game
    // thread right before the step runs (0.8.1, RB-122).
    void RequireWritesOpen() const;

    // 0.6: a method whose write class depends on its parameters (behave.start, player.action) checks it here: throws
    // MethodError write_class_disabled unless allow_write_classes lists that class. Registered as Access::Write, so the
    // dispatcher has already checked allow_writes, the pause and the handover.
    void RequireWriteClass(Access aAccess) const;

    // 0.6, session.handover / session.resume: while handed over, every write is refused with handed_over, so the player
    // has the game to themselves; nothing else changes (reads, notes, the kill switch still work). Unlike the panel's pause
    // (the player's own switch, which no pipe method can undo), a client that handed over may resume.
    // The note travels with the handover (0.8.22, Borg 4: the commit tripwire's handover read as a bare handed_over): every
    // refusal it causes, and its session event, carry it, until session.resume.
    void SetHandover(bool aOn, const std::string& aNote = {});
    bool HandedOver() const;
    std::string HandoverNote() const;

    // 0.6: the session event stream (core/Events.hpp). The dispatcher reports every write it answers (ok or refused),
    // the kill switch and handovers through this sink; unset, nothing is reported.
    using EventSink = std::function<void(const std::string& aKind, const std::string& aLevel, const std::string& aText, const nlohmann::json& aData)>;
    void SetEventSink(EventSink aSink);
    void SetConnectionReader(std::function<uint64_t()> reader) { m_connectionReader = std::move(reader); }

    // Test candidate: a read-only snapshot taken on the executing game frame. No cached state.
    using PreconditionReader = std::function<nlohmann::json(const nlohmann::json&)>;
    void SetPreconditionReader(PreconditionReader aReader);
    void RequirePrecondition(const nlohmann::json& aWhen) const;

    nlohmann::json Describe() const;
    uint64_t RequestCount() const;
    // 0.8.2: milliseconds since the last authenticated request (any method, either pipe), or -1 before the first.
    int64_t MsSinceLastRequest() const;

private:
    DispatchResult HandleUnchecked(const std::string& aLine, uint32_t aClientPid, bool aControlRoute);
    bool TakeRateToken(bool aReadOnly);
    bool TakeReaderRequestToken();
    static bool TakeReaderLogToken(std::atomic<int64_t>& next, int64_t now);
    std::string NextCid();

    const Config& m_config;
    const Session& m_session;
    GameThreadQueue& m_queue;
    PacingClock m_pacingClock;
    std::map<std::string, MethodSpec> m_methods;

    mutable std::mutex m_mutex;
    std::string m_killReason;
    std::string m_handoverNote; // m_mutex; the note of the handover in force
    std::atomic<bool> m_killed{false};
    std::atomic<bool> m_writesPaused{false};
    std::atomic<bool> m_handover{false};
    EventSink m_eventSink;
    std::function<uint64_t()> m_connectionReader;
    PreconditionReader m_preconditionReader;
    std::function<void(const std::string&)> m_safetyCancellation;
    std::atomic<uint64_t> m_requests{0};
    std::atomic<int64_t> m_lastRequestMs{-1}; // steady clock, milliseconds since its epoch
    std::atomic<uint64_t> m_cidCounter{0};

    // Fixed-size reader flood controls. No game thread ever acquires this mutex.
    struct ReaderEmergency {
        std::string key;
        std::chrono::steady_clock::time_point until{};
        uint64_t epoch = 0;
    };
    std::mutex m_readerEmergencyMutex;
    std::array<ReaderEmergency, 6> m_readerEmergencies;
    std::atomic<uint64_t> m_commandEpoch{0};
    std::atomic<int64_t> m_nextReaderRefusalLogMs{0}, m_nextReaderEmergencyLogMs{0};

    // Token bucket: capacity = 2 s of the configured rate.
    double m_tokens = 0.0;
    std::chrono::steady_clock::time_point m_lastRefill;
    // Separate observer ceiling (8 * connection budget), including reconnect bursts.
    // Does not borrow writer/game-thread tokens. Same mutex; fixed-size state.
    double m_readerTokens = 0.0;
    std::chrono::steady_clock::time_point m_readerLastRefill;
};

// Runs aTask on the game thread through aQueue and waits for it, like a RunOn::GameThread method.
// For bridge-thread methods that need several game-thread steps with a pause between them (for
// example selecting a photo-mode light, then setting it a few frames later). Throws MethodError
// with the same codes a game-thread method would answer (timeout, busy, game_not_running, ...).
// aGated = false only for a step that decides for itself what to do while the game's scripts can't be called
// (game.status answers "loading" from the plugin's side then). For reads and steps that put things back; a step that
// changes the game goes through Dispatcher::RunWrite (0.8.1, RB-122).
nlohmann::json RunGameTask(GameThreadQueue& aQueue, std::chrono::milliseconds aTimeout,
                           const std::function<nlohmann::json()>& aTask, const std::string& aLabel, bool aGated = true, bool aChanging = false);

// The game gate (bridge 0.5.2, RB-76): a process-wide check run on the game thread right before every game-thread
// method and every gated RunGameTask step, after the task was queued, so a request queued before the game's
// scripts detached (a save loading) and run after it is refused instead of calling into a session being torn
// down. It throws a MethodError (game_loading) to refuse. The plugin sets it to its ScriptLayer; the self-test
// host to its simulated one. No gate set: everything runs.
using GameGate = std::function<void(const std::string& aWhat)>;
void SetGameGate(GameGate aGate);
void RequireGameGate(const std::string& aWhat);

// RB-122 (0.8.1): while one is open on a thread, the steps that thread queues through Dispatcher::RunWrite put something
// back (a relock, a withdrawn request, the menu's selection after a failure, a category restored), so they run whatever the
// write gate says: refusing them would leave the game half changed.
class RestoreScope
{
public:
    RestoreScope();
    ~RestoreScope();
    RestoreScope(const RestoreScope&) = delete;
    RestoreScope& operator=(const RestoreScope&) = delete;
    static bool Active();
};

// RB-121 (0.8.1): the methods the control pipe answers: bridge.kill, behave.stop, player.stop, bridge.handover and the steps
// a handover takes (game.status, photo.hud.hide, showroom.clear, ui.message).
bool IsControlRouteMethod(const std::string& aMethod);

// Accepts client-provided correlation ids only if they are short and plain.
bool IsValidCid(const std::string& aCid);
} // namespace xfb
