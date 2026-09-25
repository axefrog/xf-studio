#pragma once

// Request handling for the bridge protocol (version 1).
//
// Request  (one JSON object per line):
//   {"v":1, "id":<any>, "token":"<session token>", "method":"ping", "cid":"optional", "params":{...}}
// Response (one JSON object per line):
//   {"v":1, "id":<same>, "cid":"<cid>", "ok":true, "result":{...}}
//   {"v":1, "id":<same>, "cid":"<cid>", "ok":false, "error":{"code":"...", "message":"..."}}
//
// Order of checks: parse -> token -> kill switch -> rate limit -> allowlist -> write gate -> run.
// Only registered methods exist (the allowlist); nothing evaluates code sent by a client.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Config.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Session.hpp"

namespace xfb
{
enum class Access
{
    Read,
    Write
};

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

class Dispatcher
{
public:
    Dispatcher(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue);

    void Register(MethodSpec aSpec);
    std::string Handle(const std::string& aLine, uint32_t aClientPid);

    // Kill switch: every later request is refused with "killed" until the game restarts.
    void Kill(const std::string& aReason);
    bool IsKilled() const;
    std::string KillReason() const;

    nlohmann::json Describe() const;
    uint64_t RequestCount() const;

private:
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
