#include "core/Dispatcher.hpp"

#include "core/Log.hpp"

namespace xfb
{
namespace
{
using json = nlohmann::json;

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
} // namespace

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
        const bool enabled = spec.access == Access::Read || m_config.allowWrites;
        methods.push_back({{"name", name},
                           {"access", spec.access == Access::Read ? "read" : "write"},
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

std::string Dispatcher::Handle(const std::string& aLine, uint32_t aClientPid)
{
    const auto started = std::chrono::steady_clock::now();
    m_requests.fetch_add(1);

    json request;
    try
    {
        request = json::parse(aLine);
    }
    catch (const std::exception&)
    {
        log::Warn("bridge.bad_request", "reason=invalid_json bytes=" + std::to_string(aLine.size()) +
                                            " client_pid=" + std::to_string(aClientPid));
        return ErrorResponse(nullptr, "-", "bad_request", "request is not valid JSON").dump();
    }
    if (!request.is_object())
    {
        return ErrorResponse(nullptr, "-", "bad_request", "request must be a JSON object").dump();
    }

    const json id = request.contains("id") ? request["id"] : json(nullptr);
    std::string cid;
    if (request.contains("cid") && request["cid"].is_string() && IsValidCid(request["cid"].get<std::string>()))
    {
        cid = request["cid"].get<std::string>();
    }
    else
    {
        cid = NextCid();
    }

    if (request.contains("v") && request["v"] != kProtocolVersion)
    {
        return ErrorResponse(id, cid, "bad_version", "this bridge speaks protocol 1").dump();
    }

    // Token first: an unauthenticated caller learns nothing else about the bridge.
    const auto tokenIt = request.find("token");
    if (tokenIt == request.end() || !tokenIt->is_string() ||
        !ConstantTimeEquals(tokenIt->get<std::string>(), m_session.token))
    {
        log::Warn("bridge.unauthorized", "client_pid=" + std::to_string(aClientPid), cid);
        return ErrorResponse(id, cid, "unauthorized", "missing or wrong session token").dump();
    }

    if (m_killed.load())
    {
        return ErrorResponse(id, cid, "killed", "bridge stopped by kill switch: " + KillReason()).dump();
    }

    if (!TakeRateToken())
    {
        log::Warn("bridge.rate_limited", "client_pid=" + std::to_string(aClientPid), cid);
        return ErrorResponse(id, cid, "rate_limited",
                             "more than " + std::to_string(m_config.maxRequestsPerSecond) + " requests per second")
            .dump();
    }

    const auto methodIt = request.find("method");
    if (methodIt == request.end() || !methodIt->is_string())
    {
        return ErrorResponse(id, cid, "bad_request", "missing method").dump();
    }
    const auto methodName = methodIt->get<std::string>();
    const auto specIt = m_methods.find(methodName);
    if (specIt == m_methods.end())
    {
        log::Warn("bridge.unknown_method", "method=" + methodName, cid);
        return ErrorResponse(id, cid, "unknown_method", "method is not on the allowlist").dump();
    }
    const auto& spec = specIt->second;
    const auto accessName = spec.access == Access::Read ? "read" : "write";

    log::Info("bridge.request", "method=" + methodName + " access=" + accessName +
                                    " client_pid=" + std::to_string(aClientPid),
              cid);

    if (spec.access == Access::Write && !m_config.allowWrites)
    {
        log::Warn("bridge.write_refused", "method=" + methodName + " reason=allow_writes_false", cid);
        return ErrorResponse(id, cid, "writes_disabled",
                             "write methods are off; set [bridge] allow_writes = true in config.ini")
            .dump();
    }

    MethodContext context;
    context.cid = cid;
    context.clientPid = aClientPid;
    context.params = request.contains("params") && request["params"].is_object() ? request["params"] : json::object();

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
                std::chrono::milliseconds(m_config.requestTimeoutMs), envelope, error);

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
                                             std::to_string(m_config.requestTimeoutMs) + " ms; it was cancelled");
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
    if (code == "ok")
    {
        log::Debug("bridge.result", "method=" + methodName + " result=" + response["result"].dump(), cid);
    }
    return response.dump();
}
} // namespace xfb
