#include "core/Dispatcher.hpp"

#include "core/Log.hpp"

namespace xfb
{
namespace
{
using json = nlohmann::json;

constexpr const char* kInternalError =
    R"({"v":1,"id":null,"cid":"-","ok":false,"error":{"code":"failed","message":"internal error"}})";

json ErrorResponse(const json& aId, const std::string& aCid, const std::string& aCode, const std::string& aMessage)
{
    return json{{"v", kProtocolVersion},
                {"id", aId},
                {"cid", aCid},
                {"ok", false},
                {"error", {{"code", aCode}, {"message", aMessage}}}};
}

// Compares without early exit so response timing does not reveal how much of a token matched.
bool ConstantTimeEquals(const std::string& aLeft, const std::string& aRight)
{
    if (aLeft.size() != aRight.size())
    {
        return false;
    }
    unsigned char diff = 0;
    for (size_t i = 0; i < aLeft.size(); ++i)
    {
        diff |= static_cast<unsigned char>(aLeft[i] ^ aRight[i]);
    }
    return diff == 0;
}

// Only scalar ids are echoed; anything else (arrays, objects) is answered with id null.
bool IsEchoableId(const json& aId)
{
    return aId.is_number() || aId.is_string() || aId.is_null();
}
} // namespace

std::string_view AccessName(Access aAccess)
{
    switch (aAccess)
    {
    case Access::Read:
        return "read";
    case Access::Write:
        return "write";
    case Access::Control:
        return "control";
    }
    return "read";
}

size_t JsonNestingDepth(std::string_view aText, size_t aLimit)
{
    size_t depth = 0;
    size_t deepest = 0;
    bool inString = false;
    bool escaped = false;
    for (const auto c : aText)
    {
        if (inString)
        {
            if (escaped)
            {
                escaped = false;
            }
            else if (c == '\\')
            {
                escaped = true;
            }
            else if (c == '"')
            {
                inString = false;
            }
            continue;
        }
        switch (c)
        {
        case '"':
            inString = true;
            break;
        case '[':
        case '{':
            if (++depth > deepest)
            {
                deepest = depth;
                if (deepest > aLimit)
                {
                    return deepest;
                }
            }
            break;
        case ']':
        case '}':
            if (depth > 0)
            {
                --depth;
            }
            break;
        default:
            break;
        }
    }
    return deepest;
}

std::string SerializeJson(const json& aValue)
{
    return aValue.dump(-1, ' ', false, json::error_handler_t::replace);
}

json RunGameTask(GameThreadQueue& aQueue, std::chrono::milliseconds aTimeout, const std::function<json()>& aTask,
                 const std::string& aLabel)
{
    json envelope;
    std::string error;
    const auto result = aQueue.Run(
        [aTask]() -> json {
            try
            {
                return json{{"ok", true}, {"result", aTask()}};
            }
            catch (const MethodError& e)
            {
                return json{{"ok", false}, {"code", e.code}, {"message", e.what()}};
            }
        },
        aTimeout, envelope, error, aLabel);
    switch (result)
    {
    case QueueResult::Done:
        if (envelope.value("ok", false))
        {
            return envelope["result"];
        }
        throw MethodError(envelope.value("code", std::string("failed")), envelope.value("message", std::string()));
    case QueueResult::Timeout:
        throw MethodError("timeout", "the game thread did not start the step in time; it was cancelled (" + aLabel + ")");
    case QueueResult::TimeoutAfterStart:
        throw MethodError("timeout_after_start",
                          "a game-thread step started but did not finish in time (" + aLabel + "); it may still complete");
    case QueueResult::QueueFull:
        throw MethodError("busy", "too many requests are waiting for the game thread");
    case QueueResult::NotPumping:
        throw MethodError("game_not_running", "the game is not in its Running state");
    case QueueResult::Failed:
        break;
    }
    throw MethodError("failed", error.empty() ? "game-thread step failed" : error);
}

bool IsValidCid(const std::string& aCid)
{
    if (aCid.empty() || aCid.size() > 64)
    {
        return false;
    }
    for (const auto c : aCid)
    {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' ||
                        c == '_' || c == '.' || c == ':';
        if (!ok)
        {
            return false;
        }
    }
    return true;
}

Dispatcher::Dispatcher(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue)
    : m_config(aConfig)
    , m_session(aSession)
    , m_queue(aQueue)
    , m_tokens(aConfig.maxRequestsPerSecond * 2.0)
    , m_lastRefill(std::chrono::steady_clock::now())
{
    Register({"ping", Access::Read, RunOn::BridgeThread, "Liveness check; answers without touching the game.",
              [this](const MethodContext&) {
                  return json{{"pong", true},
                              {"sid", m_session.sessionId},
                              {"protocol", kProtocolVersion},
                              {"plugin_version", XFB_VERSION_STRING}};
              }});
    Register({"bridge.methods", Access::Read, RunOn::BridgeThread, "Lists the allowlisted methods.",
              [this](const MethodContext&) { return Describe(); }});
}

void Dispatcher::Register(MethodSpec aSpec)
{
    auto name = aSpec.name;
    m_methods[name] = std::move(aSpec);
}

void Dispatcher::Kill(const std::string& aReason)
{
    {
        std::scoped_lock _(m_mutex);
        if (m_killed.load())
        {
            return;
        }
        m_killReason = aReason;
    }
    m_killed.store(true);
    log::Warn("bridge.killed", "reason=" + aReason);
}

bool Dispatcher::IsKilled() const
{
    return m_killed.load();
}

std::string Dispatcher::KillReason() const
{
    std::scoped_lock _(m_mutex);
    return m_killReason;
}

json Dispatcher::Describe() const
{
    json methods = json::array();
    for (const auto& [name, spec] : m_methods)
    {
        const bool enabled = spec.access != Access::Write || m_config.allowWrites;
        methods.push_back({{"name", name},
                           {"access", AccessName(spec.access)},
                           {"thread", spec.runOn == RunOn::GameThread ? "game" : "bridge"},
                           {"enabled", enabled},
                           {"summary", spec.summary}});
    }
    return json{{"methods", methods}, {"allow_writes", m_config.allowWrites}};
}

uint64_t Dispatcher::RequestCount() const
{
    return m_requests.load();
}

bool Dispatcher::TakeRateToken()
{
    std::scoped_lock _(m_mutex);
    const auto now = std::chrono::steady_clock::now();
    const auto elapsed = std::chrono::duration<double>(now - m_lastRefill).count();
    m_lastRefill = now;
    const double capacity = m_config.maxRequestsPerSecond * 2.0;
    m_tokens = std::min(capacity, m_tokens + elapsed * m_config.maxRequestsPerSecond);
    if (m_tokens < 1.0)
    {
        return false;
    }
    m_tokens -= 1.0;
    return true;
}

std::string Dispatcher::NextCid()
{
    return "n" + std::to_string(m_cidCounter.fetch_add(1) + 1);
}

DispatchResult Dispatcher::Handle(const std::string& aLine, uint32_t aClientPid) noexcept
{
    try
    {
        return HandleUnchecked(aLine, aClientPid);
    }
    catch (const std::exception& e)
    {
        log::Error("bridge.handle_failed", std::string("what=") + e.what() +
                                               " client_pid=" + std::to_string(aClientPid));
    }
    catch (...)
    {
        log::Error("bridge.handle_failed", "what=unknown client_pid=" + std::to_string(aClientPid));
    }
    try
    {
        return {kInternalError, false};
    }
    catch (...)
    {
        return {};
    }
}

DispatchResult Dispatcher::HandleUnchecked(const std::string& aLine, uint32_t aClientPid)
{
    const auto started = std::chrono::steady_clock::now();
    m_requests.fetch_add(1);
    const auto pidText = " client_pid=" + std::to_string(aClientPid);

    // Every refusal is logged under its own event name; `rejected` marks malformed or
    // unauthenticated requests, which count towards the transport's per-connection limit.
    const auto refuse = [&](const char* aEvent, const json& aId, const std::string& aCid, const std::string& aCode,
                            const std::string& aMessage, bool aRejected, const std::string& aDetail = {}) {
        log::Warn(aEvent, "code=" + aCode + (aDetail.empty() ? "" : " " + aDetail) + pidText, aCid);
        return DispatchResult{SerializeJson(ErrorResponse(aId, aCid, aCode, aMessage)), aRejected};
    };

    const auto depth = JsonNestingDepth(aLine, kMaxJsonDepth);
    if (depth > kMaxJsonDepth)
    {
        return refuse("bridge.bad_request", nullptr, "-", "bad_request",
                      "request nests deeper than " + std::to_string(kMaxJsonDepth) + " levels", true,
                      "reason=too_deep bytes=" + std::to_string(aLine.size()));
    }

    json request;
    try
    {
        request = json::parse(aLine);
    }
    catch (const std::exception&)
    {
        return refuse("bridge.bad_request", nullptr, "-", "bad_request", "request is not valid JSON (UTF-8)", true,
                      "reason=invalid_json bytes=" + std::to_string(aLine.size()));
    }
    if (!request.is_object())
    {
        return refuse("bridge.bad_request", nullptr, "-", "bad_request", "request must be a JSON object", true,
                      "reason=not_object");
    }

    const auto idIt = request.find("id");
    const json id = idIt != request.end() && IsEchoableId(*idIt) ? *idIt : json(nullptr);
    std::string cid;
    const auto cidIt = request.find("cid");
    if (cidIt != request.end() && cidIt->is_string() && IsValidCid(cidIt->get<std::string>()))
    {
        cid = cidIt->get<std::string>();
    }
    else
    {
        cid = NextCid();
    }

    const auto tokenIt = request.find("token");
    const bool authenticated = tokenIt != request.end() && tokenIt->is_string() &&
                               ConstantTimeEquals(tokenIt->get<std::string>(), m_session.token);

    // The rate limit covers every well-formed request, authenticated or not, so a client
    // guessing tokens is throttled too. The reply is the same either way.
    if (!TakeRateToken())
    {
        return refuse("bridge.rate_limited", id, cid, "rate_limited",
                      "more than " + std::to_string(m_config.maxRequestsPerSecond) + " requests per second",
                      !authenticated, authenticated ? "" : "authenticated=false");
    }

    // Token before anything else: an unauthenticated caller learns nothing about the bridge.
    if (!authenticated)
    {
        return refuse("bridge.unauthorized", id, cid, "unauthorized", "missing or wrong session token", true);
    }

    const auto versionIt = request.find("v");
    if (versionIt != request.end() && *versionIt != kProtocolVersion)
    {
        return refuse("bridge.bad_version", id, cid, "bad_version", "this bridge speaks protocol 1", false);
    }

    if (m_killed.load())
    {
        return refuse("bridge.killed_refused", id, cid, "killed", "bridge stopped by kill switch: " + KillReason(),
                      false);
    }

    const auto methodIt = request.find("method");
    if (methodIt == request.end() || !methodIt->is_string())
    {
        return refuse("bridge.bad_request", id, cid, "bad_request", "missing method", true, "reason=no_method");
    }
    const auto methodName = methodIt->get<std::string>();
    const auto specIt = m_methods.find(methodName);
    if (specIt == m_methods.end())
    {
        return refuse("bridge.unknown_method", id, cid, "unknown_method", "method is not on the allowlist", false,
                      "method=" + methodName);
    }
    const auto& spec = specIt->second;
    const std::string accessName(AccessName(spec.access));

    log::Info("bridge.request", "method=" + methodName + " access=" + accessName + pidText, cid);

    if (spec.access == Access::Write && !m_config.allowWrites)
    {
        return refuse("bridge.write_refused", id, cid, "writes_disabled",
                      "write methods are off; set [bridge] allow_writes = true in config.ini", false,
                      "method=" + methodName + " reason=allow_writes_false");
    }

    MethodContext context;
    context.cid = cid;
    context.clientPid = aClientPid;
    const auto paramsIt = request.find("params");
    context.params = paramsIt != request.end() && paramsIt->is_object() ? *paramsIt : json::object();

    json response;
    std::string code = "ok";
    try
    {
        if (spec.runOn == RunOn::BridgeThread)
        {
            response = {{"v", kProtocolVersion}, {"id", id}, {"cid", cid}, {"ok", true}, {"result", spec.fn(context)}};
        }
        else
        {
            auto fn = spec.fn;
            json envelope;
            std::string error;
            const auto grace = GameThreadQueue::kDefaultRunningGrace;
            const auto result = m_queue.Run(
                [fn, context]() -> json {
                    try
                    {
                        return json{{"ok", true}, {"result", fn(context)}};
                    }
                    catch (const MethodError& e)
                    {
                        return json{{"ok", false}, {"code", e.code}, {"message", e.what()}};
                    }
                },
                std::chrono::milliseconds(m_config.requestTimeoutMs), envelope, error,
                "method=" + methodName + " cid=" + cid, grace);

            switch (result)
            {
            case QueueResult::Done:
                if (envelope.value("ok", false))
                {
                    response = {
                        {"v", kProtocolVersion}, {"id", id}, {"cid", cid}, {"ok", true}, {"result", envelope["result"]}};
                }
                else
                {
                    code = envelope.value("code", std::string("failed"));
                    response = ErrorResponse(id, cid, code, envelope.value("message", std::string()));
                }
                break;
            case QueueResult::Timeout:
                code = "timeout";
                response = ErrorResponse(id, cid, code,
                                         "the game thread did not start the request within " +
                                             std::to_string(m_config.requestTimeoutMs) +
                                             " ms; it was cancelled and will never run");
                break;
            case QueueResult::TimeoutAfterStart:
                code = "timeout_after_start";
                response = ErrorResponse(
                    id, cid, code,
                    "the request started on the game thread but had not finished after " +
                        std::to_string(m_config.requestTimeoutMs + grace.count()) + " ms (" + error +
                        "); it may still complete, and the plugin log records it (game.task_completed_late)");
                break;
            case QueueResult::QueueFull:
                code = "busy";
                response = ErrorResponse(id, cid, code, "too many requests are waiting for the game thread");
                break;
            case QueueResult::NotPumping:
                code = "game_not_running";
                response = ErrorResponse(id, cid, code, "the game is not in its Running state yet");
                break;
            case QueueResult::Failed:
                code = "failed";
                response = ErrorResponse(id, cid, code, error);
                break;
            }
        }
    }
    catch (const MethodError& e)
    {
        code = e.code;
        response = ErrorResponse(id, cid, e.code, e.what());
    }
    catch (const std::exception& e)
    {
        code = "failed";
        response = ErrorResponse(id, cid, code, e.what());
    }

    const auto elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    const auto level = code == "ok" ? Level::Info : Level::Warn;
    log::Write(level, "native", cid, "bridge.response",
               "method=" + methodName + " code=" + code + " ms=" + std::to_string(elapsedMs));
    if (code == "ok" && log::MinLevel() == Level::Debug)
    {
        log::Debug("bridge.result", "method=" + methodName + " result=" + SerializeJson(response["result"]), cid);
    }
    return {SerializeJson(response), false};
}
} // namespace xfb
