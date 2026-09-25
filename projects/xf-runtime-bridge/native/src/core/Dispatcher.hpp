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
enum class Access
{
    Read,    // observes; never changes the game
    Write,   // changes the game; refused unless [bridge] allow_writes = true
    Control  // changes only the bridge itself (bridge.kill); always allowed, never touches the game
};

std::string_view AccessName(Access aAccess);

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

    // Kill switch: every later request is refused with "killed" until the game restarts.
    void Kill(const std::string& aReason);
    bool IsKilled() const;
    std::string KillReason() const;

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
    std::atomic<uint64_t> m_requests{0};
    std::atomic<uint64_t> m_cidCounter{0};

    // Token bucket: capacity = 2 s of the configured rate.
    double m_tokens = 0.0;
    std::chrono::steady_clock::time_point m_lastRefill;
};

// Accepts client-provided correlation ids only if they are short and plain.
bool IsValidCid(const std::string& aCid);
} // namespace xfb
