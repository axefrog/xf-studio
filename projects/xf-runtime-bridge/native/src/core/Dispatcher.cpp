#include "core/Dispatcher.hpp"

#include "core/Log.hpp"

#include <set>
#include <cmath>
#include <cctype>
#include <algorithm>
#include <utility>

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

// A bounded envelope scan skips params without constructing its JSON tree. Only small scalar routing
// fields are decoded. Duplicate routing fields use the last value, matching the existing DOM parser.
// This is not validation: malformed envelopes still go through the normal refusal path after admission.
json RoutingFields(const std::string& raw)
{
    json fields=json::object(); int depth=0; bool quoted=false,escaped=false; size_t begin=0;
    for(size_t n=0;n<raw.size();++n){const char c=raw[n];
        if(quoted){if(escaped){escaped=false;continue;}if(c=='\\'){escaped=true;continue;}
            if(c!='"')continue;quoted=false;
            if(depth!=1)continue;
            size_t colon=n+1;while(colon<raw.size()&&std::isspace(static_cast<unsigned char>(raw[colon])))++colon;
            if(colon>=raw.size()||raw[colon]!=':')continue;
            if(n-begin>128)continue;
            const auto key=json::parse(raw.substr(begin,n-begin+1),nullptr,false);
            if(!key.is_string())continue;const auto name=key.get<std::string>();
            if(name!="method"&&name!="token"&&name!="id"&&name!="cid")continue;
            size_t start=colon+1;while(start<raw.size()&&std::isspace(static_cast<unsigned char>(raw[start])))++start;
            size_t end=start;bool str=start<raw.size()&&raw[start]=='"',esc=false;
            if(str){++end;for(;end<raw.size();++end){if(esc){esc=false;continue;}if(raw[end]=='\\'){esc=true;continue;}if(raw[end]=='"'){++end;break;}}}
            else while(end<raw.size()&&raw[end]!=','&&raw[end]!='}'&&!std::isspace(static_cast<unsigned char>(raw[end])))++end;
            fields[name]=nullptr;
            if(end-start<=(name=="id"?65536u:256u)){auto value=json::parse(raw.substr(start,end-start),nullptr,false);if(!value.is_discarded()&&value.is_primitive())fields[name]=std::move(value);}
        }else if(c=='"'){quoted=true;begin=n;}else if(c=='{'||c=='[')++depth;else if(c=='}'||c==']')--depth;
    }
    return fields;
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
    case Access::WritePhoto:
        return "write-photo";
    case Access::WriteWorld:
        return "write-world";
    case Access::WriteCharacter:
        return "write-character";
    case Access::WriteInventory:
        return "write-inventory";
    case Access::WriteSave:
        return "write-save";
    case Access::WriteShowroom:
        return "write-showroom";
    case Access::WritePlayer:
        return "write-player";
    case Access::ActPlayer:
        return "act-player";
    case Access::WriteNpc:
        return "write-npc";
    case Access::WriteDm:
        return "write-dm";
    case Access::Notify:
        return "notify";
    case Access::Display:
        return "display";
    case Access::Control:
        return "control";
    }
    return "read";
}

bool IsWrite(Access aAccess)
{
    return aAccess == Access::Write || WriteClassBit(aAccess) != 0;
}

uint32_t WriteClassBit(Access aAccess)
{
    switch (aAccess)
    {
    case Access::WritePhoto:
        return kWritePhoto;
    case Access::WriteWorld:
        return kWriteWorld;
    case Access::WriteCharacter:
        return kWriteCharacter;
    case Access::WriteInventory:
        return kWriteInventory;
    case Access::WriteSave:
        return kWriteSave;
    case Access::WriteShowroom:
        return kWriteShowroom;
    case Access::WritePlayer:
        return kWritePlayer;
    case Access::ActPlayer:
        return kActPlayer;
    case Access::WriteNpc:
        return kWriteNpc;
    case Access::WriteDm:
        return kWriteDm;
    default:
        return 0;
    }
}

std::string_view ConfigClassName(Access aAccess)
{
    switch (aAccess)
    {
    case Access::WritePhoto:
        return "photo";
    case Access::WriteWorld:
        return "world";
    case Access::WriteCharacter:
        return "character";
    case Access::WriteInventory:
        return "inventory";
    case Access::WriteSave:
        return "save";
    case Access::WriteShowroom:
        return "showroom";
    case Access::WritePlayer:
        return "player";
    case Access::ActPlayer:
        return "act";
    case Access::WriteNpc:
        return "npc";
    case Access::WriteDm:
        return "dm";
    default:
        return {};
    }
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

namespace
{
std::mutex gGateMutex;
GameGate gGate;

// RB-122 (0.8.1): how many RestoreScopes are open on this thread. Steps queued inside one put something back (a relock, a
// withdrawal, the selection after a failure), so Dispatcher::RunWrite doesn't refuse them on a closed write gate.
thread_local int tRestoreDepth = 0;
thread_local bool tReadOnly = false;
thread_local bool tEmergency = false;
thread_local uint64_t tConnection = 0;
thread_local ReaderRequestBudget* tReaderBudget = nullptr;
thread_local std::function<bool()> tReaderGameToken;
thread_local bool tReaderGameCharged = false;
struct ReaderScope {
    bool previous = tReadOnly, previousEmergency = tEmergency;
    ReaderRequestBudget* previousBudget = tReaderBudget;
    std::function<bool()> previousGameToken = std::move(tReaderGameToken);
    bool previousCharged = tReaderGameCharged;
    ReaderScope(ReaderRequestBudget* budget, std::function<bool()> gameToken) {
        tReadOnly = budget != nullptr; tEmergency = false; tReaderBudget = budget;
        tReaderGameToken = std::move(gameToken); tReaderGameCharged = false;
    }
    ~ReaderScope() {
        tReadOnly = previous; tEmergency = previousEmergency; tReaderBudget = previousBudget;
        tReaderGameToken = std::move(previousGameToken); tReaderGameCharged = previousCharged;
    }
};

// Charge once per observer request, before its first queued game-thread step.
// Covers both direct GameThread methods and bridge-thread methods using RunGameTask.
void RequireReaderGameToken()
{
    if (!tReadOnly || tEmergency || tReaderGameCharged) return;
    if (!tReaderGameToken())
        throw MethodError("rate_limited", "readers exhausted shared game-thread request pacing");
    tReaderGameCharged = true;
}
thread_local json tWhen;
thread_local Dispatcher::ExecutionGuard tExecutionGuard;
struct ExecutionScope {
    Dispatcher::ExecutionGuard previous;
    explicit ExecutionScope(Dispatcher::ExecutionGuard guard) : previous(std::move(tExecutionGuard)) { tExecutionGuard = std::move(guard); }
    ~ExecutionScope() { tExecutionGuard = std::move(previous); }
};
// Own a copy on each dispatch thread; concurrent control/micro-action requests cannot borrow it.
struct WhenScope {
    json previous;
    explicit WhenScope(const json& when) : previous(tWhen) { tWhen = when; }
    ~WhenScope() { tWhen = std::move(previous); }
};

void ValidateWhen(const json& when)
{
    if (!when.is_object() || when.empty() || when.size() > 5)
        throw MethodError("bad_params", "when must be a nonempty object of phase, vehicle, combat, photo_mode or spawned");
    for (const auto& [key, value] : when.items()) {
        if (key == "phase") {
            const std::set<std::string> phases{"gameplay", "photo_mode", "main_menu", "menu", "paused", "character_menu"};
            if (!value.is_string() || !phases.count(value.get<std::string>()))
                throw MethodError("bad_params", "when.phase is not a supported phase");
        } else if (key == "vehicle" || key == "combat" || key == "photo_mode") {
            if (!value.is_boolean()) throw MethodError("bad_params", "when flags must be booleans");
        } else if (key == "spawned") {
            if (!value.is_array() || value.empty() || value.size() > 16)
                throw MethodError("bad_params", "when.spawned must contain 1 to 16 returned spawn handles");
            for (const auto& handle : value)
                if (!handle.is_number_integer() || handle.get<int64_t>() < 1 || handle.get<int64_t>() > INT32_MAX)
                    throw MethodError("bad_params", "when.spawned needs positive spawn handles");
        } else throw MethodError("bad_params", "Unknown when condition: " + key);
    }
}

// The control pipe's methods (0.8.1, RB-121): the emergency controls and the steps a handover takes.
const std::set<std::string>& ControlMethods()
{
    static const std::set<std::string> methods{"bridge.kill", "behave.stop", "player.stop", "test.record.stop", "supervisor.clear", "bridge.handover",
                                               "game.status", "photo.hud.hide", "showroom.clear", "ui.message"};
    return methods;
}

// Only cancellation/ownership controls bypass observer roles and aggregate pacing.
// Handover helper writes remain available on the separately restricted control route.
bool IsEmergencyMethod(const std::string& method)
{
    return method == "bridge.kill" || method == "behave.stop" || method == "player.stop" ||
           method == "test.record.stop" || method == "supervisor.clear" || method == "bridge.handover";
}

json RunTask(GameThreadQueue& aQueue, std::chrono::milliseconds aTimeout, const std::function<json()>& aTask,
             const std::string& aLabel, bool aGated, const Dispatcher* aWriteGate, bool aDeferWhenClosed = false, bool aChanging = false);
} // namespace

void SetGameGate(GameGate aGate)
{
    std::scoped_lock _(gGateMutex);
    gGate = std::move(aGate);
}

void RequireGameGate(const std::string& aWhat)
{
    GameGate gate;
    {
        std::scoped_lock _(gGateMutex);
        gate = gGate;
    }
    if (gate)
    {
        gate(aWhat);
    }
}

RestoreScope::RestoreScope()
{
    ++tRestoreDepth;
}

RestoreScope::~RestoreScope()
{
    --tRestoreDepth;
}

bool RestoreScope::Active()
{
    return tRestoreDepth > 0;
}

bool IsControlRouteMethod(const std::string& aMethod)
{
    return ControlMethods().count(aMethod) != 0;
}

json RunGameTask(GameThreadQueue& aQueue, std::chrono::milliseconds aTimeout, const std::function<json()>& aTask,
                 const std::string& aLabel, bool aGated, bool aChanging)
{
    return RunTask(aQueue, aTimeout, aTask, aLabel, aGated, nullptr, false, aChanging);
}

json Dispatcher::RunWrite(std::chrono::milliseconds aTimeout, const std::function<json()>& aTask, const std::string& aLabel) const
{
    // A step that puts something back is never refused; any other changing step passes the write gate on the game thread.
    // 0.8.2: a put-back step that finds the queue closed by the kill switch goes on the cleanup lane instead (RunTask).
    const bool restoring = RestoreScope::Active();
    const auto when = restoring ? json() : tWhen;
    return RunTask(m_queue, aTimeout, [this, aTask, when] {
        RequirePrecondition(when);
        return aTask();
    }, aLabel, true, restoring ? nullptr : this, restoring);
}

json Dispatcher::RunRead(const std::function<json()>& aTask, const std::string& aLabel) const
{
    return RunGameTask(m_queue, std::chrono::milliseconds(m_config.requestTimeoutMs), aTask, aLabel);
}

namespace
{
json RunTask(GameThreadQueue& aQueue, std::chrono::milliseconds aTimeout, const std::function<json()>& aTask,
             const std::string& aLabel, bool aGated, const Dispatcher* aWriteGate, bool aDeferWhenClosed, bool aChanging)
{
    RequireReaderGameToken();
    const auto executionGuard = RestoreScope::Active() ? Dispatcher::ExecutionGuard{} : tExecutionGuard;
    // 0.8.2 (the re-check's sixth finding, and the review's): the kill switch closes the queue, which used to refuse a write's
    // own put-back step too (photo.pose.set killed during its settle left the category changed). A put-back step (RestoreScope)
    // passes its cleanup to Run, which posts it to the cleanup lane whenever the closed queue keeps it from starting, decided
    // under the queue's lock (so a kill between a check and the enqueue can't lose it); the game thread runs the lane before the
    // kill switch's restore, and the step still checks the game gate there, so it never calls into a session that has gone.
    GameThreadQueue::Task onClosed;
    if (aDeferWhenClosed)
    {
        onClosed = [aTask, aGated, aLabel]() -> json {
            if (aGated)
            {
                RequireGameGate(aLabel);
            }
            return aTask();
        };
    }
    json envelope;
    std::string error;
    // RB-122: a changing step checks the kill switch, the pause and a handover on the game thread, right before it runs.
    // Safe to keep the pointer: Run returns only once the task has run, has started (past this check) or will never run.
    const auto result = aQueue.Run(
        [aTask, aGated, aLabel, aWriteGate, executionGuard, aChanging]() -> json {
            try
            {
                if (aGated)
                {
                    RequireGameGate(aLabel);
                }
                if (aWriteGate)
                {
                    aWriteGate->RequireWritesOpen();
                }
                if (executionGuard) executionGuard(aChanging || aWriteGate != nullptr);
                return json{{"ok", true}, {"result", aTask()}};
            }
            catch (const MethodError& e)
            {
                return json{{"ok", false}, {"code", e.code}, {"message", e.what()}};
            }
        },
        aTimeout, envelope, error, aLabel, GameThreadQueue::kDefaultRunningGrace, std::move(onClosed), tReadOnly && !tEmergency);
    switch (result)
    {
    case QueueResult::Deferred:
        return json{{"deferred_to_cleanup", true}};
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
        // 0.8.2: a write refused because the kill switch closed the queue says so (it used to read "not running").
        if (aWriteGate && aWriteGate->IsKilled())
        {
            throw MethodError("killed", "the kill switch stopped the bridge before this step ran (" + aLabel + ")");
        }
        throw MethodError("game_not_running", "the game is not in its Running state");
    case QueueResult::Failed:
        break;
    }
    throw MethodError("failed", error.empty() ? "game-thread step failed" : error);
}
} // namespace

void Dispatcher::SetPreconditionReader(PreconditionReader aReader) { m_preconditionReader = std::move(aReader); }

void Dispatcher::RequirePrecondition(const json& aWhen) const
{
    if (aWhen.is_null()) return;
    if (!m_preconditionReader) throw MethodError("precondition_unavailable", "Execution-frame conditions need the autonomous test candidate");
    const auto observed = m_preconditionReader(aWhen);
    bool match = true;
    for (const auto& [key, expected] : aWhen.items()) {
        if (key == "spawned") {
            for (const auto& handle : expected) {
                const auto id = std::to_string(handle.get<int32_t>());
                match = match && observed.contains("spawned") && observed["spawned"].value(id, false);
            }
        } else match = match && observed.contains(key) && observed[key] == expected;
    }
    if (!match) throw MethodError("precondition_failed", SerializeJson(json{{"when", aWhen}, {"observed", observed}}));
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

Dispatcher::Dispatcher(const Config& aConfig, const Session& aSession, GameThreadQueue& aQueue, PacingClock aPacingClock)
    : m_config(aConfig)
    , m_session(aSession)
    , m_queue(aQueue)
    , m_pacingClock(std::move(aPacingClock))
    , m_tokens(aConfig.maxRequestsPerSecond * 2.0)
    , m_lastRefill(m_pacingClock())
    , m_readerTokens(std::clamp<uint32_t>(aConfig.maxRequestsPerSecond, 1, ReaderRequestBudget::kMaxRate) * (2.0 * kMaxReadOnlyConnections))
    , m_readerLastRefill(m_lastRefill)
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

std::optional<Access> Dispatcher::AccessOf(const std::string& aMethod) const
{
    const auto it = m_methods.find(aMethod);
    if (it == m_methods.end())
    {
        return std::nullopt;
    }
    return it->second.access;
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
    if (m_safetyCancellation) m_safetyCancellation("kill");
    log::Warn("bridge.killed", "reason=" + aReason);
    if (m_eventSink)
    {
        try
        {
            m_eventSink("kill", "warn", "the kill switch stopped the bridge: " + aReason, json{{"reason", aReason}});
        }
        catch (...)
        {
        }
    }
}

bool Dispatcher::IsKilled() const
{
    return m_killed.load();
}

void Dispatcher::Revive()
{
    m_commandEpoch.fetch_add(1);
    {
        std::scoped_lock _(m_mutex);
        m_killReason.clear();
    }
    m_killed.store(false);
    log::Info("bridge.revived", "requests are accepted again");
}

void Dispatcher::SetWritesPaused(bool aPaused)
{
    const bool changed = m_writesPaused.exchange(aPaused) != aPaused;
    if (aPaused && m_safetyCancellation) m_safetyCancellation("writes_paused");
    if (changed)
    {
        log::Warn("bridge.writes_paused", std::string("paused=") + (aPaused ? "true" : "false"));
    }
}

bool Dispatcher::WritesPaused() const
{
    return m_writesPaused.load();
}

void Dispatcher::RequireWritesOpen() const
{
    if (m_killed.load())
    {
        throw MethodError("killed", "the kill switch stopped the bridge part-way; the next step wasn't taken (" + KillReason() + ")");
    }
    if (m_writesPaused.load())
    {
        throw MethodError("writes_paused", "changes were paused in the game's XF bridge panel part-way; the next step wasn't taken");
    }
    if (m_handover.load())
    {
        const auto note = HandoverNote();
        throw MethodError("handed_over", "the session was handed over to the player part-way" + (note.empty() ? std::string() : " (" + note + ")") +
                                             "; the next step wasn't taken");
    }
}

void Dispatcher::RequireWriteClass(Access aAccess) const
{
    if (!IsWrite(aAccess))
    {
        return;
    }
    if (!m_config.allowWrites)
    {
        throw MethodError("writes_disabled", "write methods are off; set [bridge] allow_writes = true in config.ini");
    }
    if (const auto bit = WriteClassBit(aAccess); bit != 0 && (m_config.writeClasses & bit) == 0)
    {
        throw MethodError("write_class_disabled", std::string(AccessName(aAccess)) + " changes are off; add " + std::string(ConfigClassName(aAccess)) +
                                                      " to [bridge] allow_write_classes in config.ini");
    }
}

void Dispatcher::SetHandover(bool aOn, const std::string& aNote)
{
    {
        // A handover already in force keeps its first reason unless a new one is given; a resume clears it.
        std::scoped_lock _(m_mutex);
        if (!aOn) m_handoverNote.clear();
        else if (!aNote.empty() || !m_handover.load()) m_handoverNote = aNote;
    }
    const bool changed = m_handover.exchange(aOn) != aOn;
    if (aOn && m_safetyCancellation) m_safetyCancellation("handover");
    if (changed)
    {
        log::Warn("bridge.handover", std::string("on=") + (aOn ? "true" : "false") + (aNote.empty() ? "" : " note=" + aNote));
        if (m_eventSink)
        {
            try
            {
                m_eventSink(aOn ? "handover" : "resume", aOn ? "ask" : "info",
                            aOn ? "the session is handed over to the player" + (aNote.empty() ? std::string() : ": " + aNote)
                                : "the session is resumed" + (aNote.empty() ? std::string() : ": " + aNote),
                            json{{"note", aNote}});
            }
            catch (...)
            {
            }
        }
    }
}

bool Dispatcher::HandedOver() const
{
    return m_handover.load();
}

void Dispatcher::SetEventSink(EventSink aSink)
{
    m_eventSink = std::move(aSink);
}

std::string Dispatcher::HandoverNote() const
{
    std::scoped_lock _(m_mutex);
    return m_handoverNote;
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
        const auto bit = WriteClassBit(spec.access);
        const bool enabled = !IsWrite(spec.access) || (m_config.allowWrites && !m_writesPaused.load() &&
                                                       (bit == 0 || (m_config.writeClasses & bit) != 0));
        methods.push_back({{"name", name},
                           {"access", AccessName(spec.access)},
                           {"thread", spec.runOn == RunOn::GameThread ? "game" : "bridge"},
                           {"enabled", enabled},
                           {"summary", spec.summary}});
    }
    return json{{"methods", methods},
                {"allow_writes", m_config.allowWrites},
                {"writes_paused", m_writesPaused.load()},
                {"write_classes", WriteClassList(m_config)}};
}

int64_t Dispatcher::MsSinceLastRequest() const
{
    const auto last = m_lastRequestMs.load();
    if (last < 0)
    {
        return -1;
    }
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
    return now - last;
}

uint64_t Dispatcher::RequestCount() const
{
    return m_requests.load();
}

bool Dispatcher::TakeReaderLogToken(std::atomic<int64_t>& next, int64_t now)
{
    auto expected = next.load(std::memory_order_relaxed);
    return now >= expected && next.compare_exchange_strong(expected, now + 1000, std::memory_order_relaxed);
}

bool Dispatcher::TakeRateToken(bool aReadOnly)
{
    std::scoped_lock _(m_mutex);
    const auto now = m_pacingClock();
    const auto elapsed = std::chrono::duration<double>(now - m_lastRefill).count();
    m_lastRefill = now;
    const double capacity = m_config.maxRequestsPerSecond * 2.0;
    m_tokens = std::min(capacity, m_tokens + elapsed * m_config.maxRequestsPerSecond);
    if (m_tokens < 1.0 + (aReadOnly ? m_config.maxRequestsPerSecond : 0))
    {
        return false;
    }
    m_tokens -= 1.0;
    return true;
}

bool DisplayRequestBudget::Take(std::chrono::steady_clock::time_point now)
{
    const auto previous=m_last.value_or(now);
    m_tokens=std::min(24.0,m_tokens+std::max(0.0,std::chrono::duration<double>(now-previous).count())*16.0);
    m_last=std::max(previous,now);if(m_tokens<1)return false;m_tokens-=1;return true;
}
int DisplayRequestBudget::RetryAfterMs() const { return static_cast<int>(std::ceil(std::max(0.0,1.0-m_tokens)*1000.0/16.0)); }

std::optional<int> ModuleDisplayBudgets::Admit(const std::string& module,std::chrono::steady_clock::time_point now)
{
    std::scoped_lock lock(m_mutex);
    for(auto it=m_budgets.begin();it!=m_budgets.end();)if(now-it->second.first>=std::chrono::seconds(2))it=m_budgets.erase(it);else ++it;
    auto found=m_budgets.find(module);if(found==m_budgets.end()){
        if(m_budgets.size()>=64)return 1000;
        found=m_budgets.emplace(module,std::make_pair(now,DisplayRequestBudget{})).first;
    }
    found->second.first=now;if(!found->second.second.Take(now))return std::max(1,found->second.second.RetryAfterMs());return {};
}

ReaderRequestBudget::ReaderRequestBudget(uint32_t rate)
    : m_rate(std::clamp<uint32_t>(rate, 1, kMaxRate)), m_tokens(m_rate * 2.0)
{
}

bool Dispatcher::TakeReaderRequestToken()
{
    if (!tReaderBudget->Take(m_pacingClock())) return false;
    std::scoped_lock _(m_mutex);
    const auto now = m_pacingClock();
    const double rate = std::clamp<uint32_t>(m_config.maxRequestsPerSecond, 1, ReaderRequestBudget::kMaxRate) * static_cast<double>(kMaxReadOnlyConnections);
    m_readerTokens = std::min(rate * 2.0, m_readerTokens + std::chrono::duration<double>(now - m_readerLastRefill).count() * rate);
    m_readerLastRefill = now;
    if (m_readerTokens < 1.0) return false;
    m_readerTokens -= 1.0;
    return true;
}

bool ReaderRequestBudget::Take(std::chrono::steady_clock::time_point now)
{
    const auto previous = m_lastRefill.value_or(now);
    const auto elapsed = std::max(0.0, std::chrono::duration<double>(now - previous).count());
    m_lastRefill = std::max(now, previous);
    m_tokens = std::min(m_rate * 2.0, m_tokens + elapsed * m_rate);
    if (m_tokens < 1.0) return false;
    m_tokens -= 1.0;
    return true;
}

std::string Dispatcher::NextCid()
{
    return "n" + std::to_string(m_cidCounter.fetch_add(1) + 1);
}

DispatchResult Dispatcher::HandleGuarded(const std::string& line, uint32_t pid, ExecutionGuard guard) noexcept
{
    ExecutionScope scope(std::move(guard));
    return Handle(line, pid);
}

DispatchResult Dispatcher::Handle(const std::string& aLine, uint32_t aClientPid, bool aControlRoute, ReaderRequestBudget* aReaderBudget, uint64_t aConnection, DisplayRequestBudget* aDisplayBudget) noexcept
{
    ReaderScope readerScope(aReaderBudget, [this] { return TakeRateToken(true); });
    struct ConnectionScope { uint64_t previous = tConnection; ~ConnectionScope() { tConnection = previous; } } connectionScope;
    tConnection = aConnection;
    try
    {
        // Authenticate and identify the class from the small envelope before parsing a batch DOM.
        const auto fields=RoutingFields(aLine);
        const auto method=fields.value("method",json());
        const auto spec=method.is_string()?m_methods.find(method.get<std::string>()):m_methods.end();
        if(spec!=m_methods.end()&&spec->second.access==Access::Display){
            auto* budget=aReaderBudget?&aReaderBudget->display:aDisplayBudget;
            bool admitted; int retry;
            if(budget){admitted=budget->Take(m_pacingClock());retry=budget->RetryAfterMs();}
            else {std::scoped_lock lock(m_mutex);admitted=m_directDisplay.Take(m_pacingClock());retry=m_directDisplay.RetryAfterMs();}
            if(!admitted){
                // No endpoint penalty: a refused display attempt must leave this reader's reads usable.
                // Still authenticate without revealing methods or drawing state to an untrusted client.
                const bool authenticated=fields.contains("token")&&fields["token"].is_string()&&ConstantTimeEquals(fields["token"].get<std::string>(),m_session.token);
                const auto id=fields.value("id",json()); const auto cid=fields.value("cid",json());
                const auto replyCid=cid.is_string()&&IsValidCid(cid.get<std::string>())?cid.get<std::string>():NextCid();
                auto response=ErrorResponse(IsEchoableId(id)?id:json(nullptr),replyCid,authenticated?"rate":"unauthorized",authenticated?"Canvas display attempt budget exhausted":"missing or wrong session token");
                if(authenticated)response["error"]["retry_after_ms"]=std::max(1,retry);
                m_requests.fetch_add(1);
                const auto logAt=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
                if(TakeReaderLogToken(m_nextReaderRefusalLogMs,logAt))log::Warn(authenticated?"canvas.rate":"bridge.unauthorized","scope=display_attempts",replyCid);
                return {SerializeJson(response),!authenticated,!authenticated&&aReaderBudget?50u:0u,!authenticated&&aReaderBudget!=nullptr};
            }
        }
        return HandleUnchecked(aLine, aClientPid, aControlRoute);
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

DispatchResult Dispatcher::HandleUnchecked(const std::string& aLine, uint32_t aClientPid, bool aControlRoute)
{
    const auto started = std::chrono::steady_clock::now();
    m_requests.fetch_add(1);
    const auto pidText = " client_pid=" + std::to_string(aClientPid);

    // Refusals have their own event names; reader floods are sampled before the sink.
    // `rejected` includes malformed/unauthenticated requests and reader pacing abuse.
    const auto refuse = [&](const char* aEvent, const json& aId, const std::string& aCid, const std::string& aCode,
                            const std::string& aMessage, bool aRejected, const std::string& aDetail = {}) {
        const auto nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(started.time_since_epoch()).count();
        // Sample before entering the sink: suppressed floods cannot contend on its game-thread mutex.
        if (!tReadOnly || TakeReaderLogToken(m_nextReaderRefusalLogMs, nowMs))
            log::Warn(aEvent, "code=" + aCode + (aDetail.empty() ? "" : " " + aDetail) + pidText, aCid);
        const bool throttled = tReadOnly && (aRejected || aCode == "rate_limited" || aCode == "bad_version" || aCode == "unknown_method");
        return DispatchResult{SerializeJson(ErrorResponse(aId, aCid, aCode, aMessage)), aRejected,
                              tReadOnly ? 50u : 0u, throttled};
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

    // Each reader connection has a bounded pipe-thread budget, including unauthenticated attempts.
    // Writers retain their existing aggregate bucket. Reader game work also uses it at enqueue.
    // Authenticated emergency cancellation never waits behind exhausted read pacing.
    const auto methodForPacing = request.value("method", json());
    const bool emergency = authenticated && methodForPacing.is_string() &&
        IsEmergencyMethod(methodForPacing.get<std::string>());
    const auto pacingSpec = methodForPacing.is_string() ? m_methods.find(methodForPacing.get<std::string>()) : m_methods.end();
    const bool display = authenticated && pacingSpec != m_methods.end() && pacingSpec->second.access == Access::Display;
    if (!emergency && !display && !(tReadOnly ? TakeReaderRequestToken() : TakeRateToken(false)))
    {
        return refuse("bridge.rate_limited", id, cid, "rate_limited",
                      tReadOnly ? "observer request budget exhausted" :
                          "more than " + std::to_string(m_config.maxRequestsPerSecond) + " requests per second",
                      tReadOnly || !authenticated, authenticated ? "" : "authenticated=false");
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
    // RB-121 (0.8.1): the control pipe answers only the emergency controls and a handover's steps, beside whatever the main
    // pipe is still serving.
    if (aControlRoute && !IsControlRouteMethod(methodName))
    {
        return refuse("bridge.not_control", id, cid, "not_on_control_route",
                      "the control pipe takes only the emergency controls (kill, stops, handover); send this on the main pipe", false,
                      "method=" + methodName);
    }

    // Readers cannot acquire recorder leases or overwrite the legacy singleton
    // save-list/CET request exchanges. Those reads remain writer-only this round.
    // test.events may observe the tap but cannot switch it.
    if (tReadOnly && ((!IsEmergencyMethod(methodName) && spec.access != Access::Read && spec.access != Access::Display) ||
                     methodName == "npc.pick" || methodName == "test.record.start" || methodName == "game.saves" || methodName == "game.options.read" ||
                     (methodName == "test.events" && request.contains("params") &&
                      request["params"].is_object() && request["params"].contains("stims")))) {
        return refuse("bridge.read_only_refused", id, cid, "read_only_connection",
                      "This connection observes only; use the writer connection for changes, recorder leases or exclusive save/options reads", false);
    }

    tEmergency = IsEmergencyMethod(methodName);
    std::optional<size_t> readerEmergencySlot;
    std::string readerEmergencyKey;
    uint64_t readerEmergencyEpoch = 0;
    const auto readerEmergencyUntil = started + std::chrono::milliseconds(1000);
    if (tReadOnly && tEmergency) {
        static constexpr std::array<std::string_view, 6> methods{
            "bridge.kill", "behave.stop", "player.stop", "test.record.stop", "supervisor.clear", "bridge.handover"};
        const auto index = static_cast<size_t>(std::find(methods.begin(), methods.end(), methodName) - methods.begin());
        const auto params = request.find("params");
        readerEmergencyKey = SerializeJson(params != request.end() && params->is_object() ? *params : json::object());
        readerEmergencyEpoch = m_commandEpoch.load();
        std::scoped_lock lock(m_readerEmergencyMutex);
        auto& previous = m_readerEmergencies.at(index);
        if (previous.key == readerEmergencyKey && previous.epoch == readerEmergencyEpoch && started < previous.until) {
            // Receipt of admission only: neither a second execution nor proof the async stop finished.
            const json response{{"v", kProtocolVersion}, {"id", id}, {"cid", cid}, {"ok", true},
                {"result", {{"coalesced", true}, {"method", methodName},
                            {"note", "Matching cancellation already admitted; consult state for completion."}}}};
            return {SerializeJson(response), false, 100, true};
        }
        previous = {readerEmergencyKey, readerEmergencyUntil, readerEmergencyEpoch};
        readerEmergencySlot = index;
    } else if (spec.access != Access::Read || methodName == "npc.pick" || methodName == "test.record.start") {
        // A new changing command invalidates old receipts, including an in-flight reader stop.
        m_commandEpoch.fetch_add(1);
    }
    const auto nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(started.time_since_epoch()).count();
    const bool logDetails = !tReadOnly || !tEmergency || TakeReaderLogToken(m_nextReaderEmergencyLogMs, nowMs);
    if (logDetails) log::Info("bridge.request", "method=" + methodName + " access=" + accessName + pidText, cid);
    m_lastRequestMs.store(std::chrono::duration_cast<std::chrono::milliseconds>(started.time_since_epoch()).count());

    // The session event stream hears every refused write too (0.6).
    const auto refusedEvent = [&](const std::string& aCode, const std::string& aWhy = {}) {
        if (m_eventSink)
        {
            try
            {
                json data{{"method", methodName}, {"code", aCode}, {"cid", cid}};
                if (!aWhy.empty()) data["why"] = aWhy;
                m_eventSink("refused", "warn", methodName + " refused: " + aCode + (aWhy.empty() ? std::string() : " (" + aWhy + ")"), data);
            }
            catch (...)
            {
            }
        }
    };
    if (IsWrite(spec.access) && !m_config.allowWrites)
    {
        refusedEvent("writes_disabled");
        return refuse("bridge.write_refused", id, cid, "writes_disabled",
                      "write methods are off; set [bridge] allow_writes = true in config.ini", false,
                      "method=" + methodName + " reason=allow_writes_false");
    }
    if (IsWrite(spec.access) && m_writesPaused.load())
    {
        refusedEvent("writes_paused");
        return refuse("bridge.write_refused", id, cid, "writes_paused",
                      "writes are paused in the game's XF bridge panel (Cyber Engine Tweaks overlay); resume them there",
                      false, "method=" + methodName + " reason=writes_paused");
    }
    if (IsWrite(spec.access) && m_handover.load())
    {
        const auto note = HandoverNote();
        refusedEvent("handed_over", note);
        return refuse("bridge.write_refused", id, cid, "handed_over",
                      "the session is handed over to the player (session.handover" + (note.empty() ? std::string() : ": " + note) +
                          "); nothing changes until session.resume",
                      false, "method=" + methodName + " reason=handed_over");
    }
    if (const auto bit = WriteClassBit(spec.access); bit != 0 && (m_config.writeClasses & bit) == 0)
    {
        refusedEvent("write_class_disabled");
        return refuse("bridge.write_refused", id, cid, "write_class_disabled",
                      accessName + " methods are off; add " + std::string(ConfigClassName(spec.access)) +
                          " to [bridge] allow_write_classes in config.ini",
                      false, "method=" + methodName + " reason=class_not_allowed");
    }

    MethodContext context;
    context.readOnlyConnection = tReadOnly;
    context.cid = cid;
    context.clientPid = aClientPid;
    context.connection = tConnection;
    const auto paramsIt = request.find("params");
    context.params = paramsIt != request.end() && paramsIt->is_object() ? *paramsIt : json::object();
    if (methodName == "canvas.feed") {
        // Find the top-level params value, preserving the exact bytes and duplicate keys for canvas validation.
        size_t valueStart = 0; int paramsDepth = 0; bool inString = false, escape = false;
        for (size_t i = 0; i < aLine.size(); ++i) {
            const char c = aLine[i];
            if (inString) { if (escape) escape = false; else if (c == '\\') escape = true; else if (c == '"') inString = false; continue; }
            if (c == '"') {
                if (paramsDepth == 1) {
                    size_t end = i + 1; bool quoted = false;
                    for (; end < aLine.size(); ++end) { if (quoted) quoted = false; else if (aLine[end] == '\\') quoted = true; else if (aLine[end] == '"') break; }
                    const auto key = json::parse(aLine.substr(i, end - i + 1), nullptr, false);
                    size_t colon = aLine.find_first_not_of(" \t\r\n", end + 1);
                    if (key == "params" && colon != std::string::npos && aLine[colon] == ':') {
                        valueStart = aLine.find_first_not_of(" \t\r\n", colon + 1);
                        if (valueStart == std::string::npos || aLine[valueStart] != '{') break;
                        size_t j = valueStart; int nested = 0; bool text = false, escaped = false;
                        for (; j < aLine.size(); ++j) { char ch = aLine[j]; if (text) { if (escaped) escaped = false; else if (ch == '\\') escaped = true; else if (ch == '"') text = false; }
                            else if (ch == '"') text = true; else if (ch == '{' || ch == '[') ++nested; else if ((ch == '}' || ch == ']') && --nested == 0) { ++j; break; } }
                        context.rawParams = aLine.substr(valueStart, j - valueStart); break;
                    }
                }
                inString = true;
            } else if (c == '{' || c == '[') ++paramsDepth; else if (c == '}' || c == ']') --paramsDepth;
        }
    }

    json response;
    std::string code = "ok";
    try
    {
        if (request.contains("caller_write_classes")) {
            const auto& claims = request.at("caller_write_classes");
            if (!claims.is_array() || claims.size() > 10) throw MethodError("bad_params", "Invalid caller write-class claim");
            uint32_t mask = 0;
            for (const auto& name : claims) {
                bool known = false;
                for (auto access : {Access::WritePhoto, Access::WriteWorld, Access::WriteCharacter, Access::WriteInventory, Access::WriteSave,
                                    Access::WriteShowroom, Access::WritePlayer, Access::ActPlayer, Access::WriteNpc, Access::WriteDm}) {
                    if (name.is_string() && name.get<std::string>() == ConfigClassName(access)) {
                        const auto bit = WriteClassBit(access);
                        if (mask & bit) throw MethodError("bad_params", "Duplicate caller write class");
                        mask |= bit; known = true; break;
                    }
                }
                if (!known) throw MethodError("bad_params", "Unknown caller write class");
            }
            context.callerWriteClasses = mask;
            if (const auto bit = WriteClassBit(spec.access); bit && !(mask & bit))
                throw MethodError("permission_denied", "The arming caller did not allow this action's write class");
        }
        json when;
        if (context.params.contains("when")) {
            when = context.params["when"];
            ValidateWhen(when);
            if (!IsWrite(spec.access)) throw MethodError("bad_params", "when is only accepted on actions");
            if (methodName.rfind("behave.", 0) == 0)
                throw MethodError("precondition_unavailable", "Long-lived behaviours do not carry execution-frame conditions; use a guarded player/photo action");
            context.params.erase("when");
        }
        WhenScope whenScope(when);
        if (spec.runOn == RunOn::BridgeThread)
        {
            if (tExecutionGuard) RunWrite(std::chrono::milliseconds(m_config.requestTimeoutMs), [] { return json::object(); }, "supervisor.admission");
            response = {{"v", kProtocolVersion}, {"id", id}, {"cid", cid}, {"ok", true}, {"result", spec.fn(context)}};
        }
        else
        {
            RequireReaderGameToken();
            auto fn = spec.fn;
            json envelope;
            std::string error;
            const auto grace = GameThreadQueue::kDefaultRunningGrace;
            // RB-122: a write is checked against the kill switch, the panel's pause and a handover again on the game thread,
            // right before it runs: one accepted just before the player paused must not change the game on the next tick.
            // `this` outlives the task: Run returns only once it has run, has started (past this check) or will never run.
            const Dispatcher* writeGate = IsWrite(spec.access) ? this : nullptr;
            const auto executionGuard = tExecutionGuard;
            const auto result = m_queue.Run(
                [this, fn, context, methodName, writeGate, when, executionGuard]() -> json {
                    try
                    {
                        // Checked here, on the game thread just before the call, not when the request was queued (RB-76).
                        RequireGameGate(methodName);
                        if (writeGate)
                        {
                            writeGate->RequireWritesOpen();
                        }
                        RequirePrecondition(when);
                        if (executionGuard) executionGuard(writeGate != nullptr);
                        return json{{"ok", true}, {"result", fn(context)}};
                    }
                    catch (const MethodError& e)
                    {
                        return json{{"ok", false}, {"code", e.code}, {"message", e.what()}};
                    }
                },
                std::chrono::milliseconds(m_config.requestTimeoutMs), envelope, error,
                "method=" + methodName + " cid=" + cid, grace, {}, tReadOnly && !tEmergency);

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
        if (tReadOnly && e.code == "rate_limited")
            return refuse("bridge.rate_limited", id, cid, e.code, e.what(), true);
        code = e.code;
        response = ErrorResponse(id, cid, e.code, e.what());
        if (e.detail.is_object()) response["error"].update(e.detail);
    }
    catch (const std::exception& e)
    {
        code = "failed";
        response = ErrorResponse(id, cid, code, e.what());
    }

    const auto elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
    const auto level = code == "ok" ? Level::Info : Level::Warn;
    if (!tReadOnly && code == "ok" && m_eventSink &&
        (methodName == "world.probe" || methodName == "scene.read" || methodName == "world.district"))
    {
        try {
            m_eventSink("observe.result", "info", methodName + " observed",
                json{{"command", methodName}, {"cid", cid}, {"connection", m_connectionReader ? m_connectionReader() : 0}, {"result", response.at("result")}});
        } catch (...) {} // publishing must never change the caller's response
    }
    if (logDetails) log::Write(level, "native", cid, "bridge.response",
               "method=" + methodName + " code=" + code + " ms=" + std::to_string(elapsedMs));
    // The session event stream (0.6): every write the bridge answered, with its outcome and, when it gave one, its undo.
    if (IsWrite(spec.access) && m_eventSink)
    {
        json data{{"method", methodName}, {"code", code}, {"cid", cid}, {"ms", elapsedMs}};
        if (code == "ok" && response.contains("result") && response["result"].is_object() && response["result"].contains("undo"))
        {
            data["undo"] = response["result"]["undo"];
        }
        try
        {
            m_eventSink(code == "ok" ? "write" : "refused", code == "ok" ? "info" : "warn",
                        methodName + (code == "ok" ? " done" : " refused: " + code), data);
        }
        catch (...)
        {
        }
    }
    if (logDetails && code == "ok" && log::MinLevel() == Level::Debug)
    {
        log::Debug("bridge.result", "method=" + methodName + " result=" + SerializeJson(response["result"]), cid);
    }
    if (readerEmergencySlot && code != "ok") {
        std::scoped_lock lock(m_readerEmergencyMutex);
        auto& entry = m_readerEmergencies[*readerEmergencySlot];
        if (entry.key == readerEmergencyKey && entry.epoch == readerEmergencyEpoch && entry.until == readerEmergencyUntil)
            entry.until = {}; // failed cancellation must remain retryable
    }
    return {SerializeJson(response), false, tReadOnly && tEmergency ? 100u : 0u, false};
}
} // namespace xfb
