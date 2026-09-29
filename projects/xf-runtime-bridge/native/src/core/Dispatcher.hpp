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
#include <chrono>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
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
    Notify,         // shows a message in the bridge's own in-game label (ui.message); not a write, never changes the game
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
    uint32_t clientPid = 0;
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
    bool rejected = false; // malformed or unauthenticated
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
    Dispatcher(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue);

    void Register(MethodSpec aSpec);

    // Never throws: an unexpected failure is logged and answered with code "failed".
    DispatchResult Handle(const std::string& aLine, uint32_t aClientPid) noexcept;

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
    // 0.6: also handed_over while the session is handed over to the player.
    void RequireWritesOpen() const;

    // 0.6: a method whose write class depends on its parameters (behave.start, player.action) checks it here: throws
    // MethodError write_class_disabled unless allow_write_classes lists that class. Registered as Access::Write, so the
    // dispatcher has already checked allow_writes, the pause and the handover.
    void RequireWriteClass(Access aAccess) const;

    // 0.6, session.handover / session.resume: while handed over, every write is refused with handed_over, so the player
    // has the game to themselves; nothing else changes (reads, notes, the kill switch still work). Unlike the panel's pause
    // (the player's own switch, which no pipe method can undo), a client that handed over may resume.
    void SetHandover(bool aOn, const std::string& aNote = {});
    bool HandedOver() const;

    // 0.6: the session event stream (core/Events.hpp). The dispatcher reports every write it answers (ok or refused),
    // the kill switch and handovers through this sink; unset, nothing is reported.
    using EventSink = std::function<void(const std::string& aKind, const std::string& aLevel, const std::string& aText, const nlohmann::json& aData)>;
    void SetEventSink(EventSink aSink);

    nlohmann::json Describe() const;
    uint64_t RequestCount() const;

private:
    DispatchResult HandleUnchecked(const std::string& aLine, uint32_t aClientPid);
    bool TakeRateToken();
    std::string NextCid();

    const Config& m_config;
    const Session& m_session;
    GameThreadQueue& m_queue;
    std::map<std::string, MethodSpec> m_methods;

    mutable std::mutex m_mutex;
    std::string m_killReason;
    std::atomic<bool> m_killed{false};
    std::atomic<bool> m_writesPaused{false};
    std::atomic<bool> m_handover{false};
    EventSink m_eventSink;
    std::atomic<uint64_t> m_requests{0};
    std::atomic<uint64_t> m_cidCounter{0};

    // Token bucket: capacity = 2 s of the configured rate.
    double m_tokens = 0.0;
    std::chrono::steady_clock::time_point m_lastRefill;
};

// Runs aTask on the game thread through aQueue and waits for it, like a RunOn::GameThread method.
// For bridge-thread methods that need several game-thread steps with a pause between them (for
// example selecting a photo-mode light, then setting it a few frames later). Throws MethodError
// with the same codes a game-thread method would answer (timeout, busy, game_not_running, ...).
// aGated = false only for a step that decides for itself what to do while the game's scripts can't be called
// (game.status answers "loading" from the plugin's side then).
nlohmann::json RunGameTask(GameThreadQueue& aQueue, std::chrono::milliseconds aTimeout,
                           const std::function<nlohmann::json()>& aTask, const std::string& aLabel, bool aGated = true);

// The game gate (bridge 0.5.2, RB-76): a process-wide check run on the game thread right before every game-thread
// method and every gated RunGameTask step, after the task was queued, so a request queued before the game's
// scripts detached (a save loading) and run after it is refused instead of calling into a session being torn
// down. It throws a MethodError (game_loading) to refuse. The plugin sets it to its ScriptLayer; the self-test
// host to its simulated one. No gate set: everything runs.
using GameGate = std::function<void(const std::string& aWhat)>;
void SetGameGate(GameGate aGate);
void RequireGameGate(const std::string& aWhat);

// Accepts client-provided correlation ids only if they are short and plain.
bool IsValidCid(const std::string& aCid);
} // namespace xfb
