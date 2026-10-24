#pragma once

// 0.8.13: one bounded autonomous-test owner. Submissions are never results. Game adapters are
// injected; the retail input adapter deliberately remains unavailable until its ABI is validated.
#include <functional>
#include <mutex>
#include <nlohmann/json.hpp>
#include "core/Dispatcher.hpp"
#include "core/Events.hpp"

namespace xfb::input
{
using json = nlohmann::json;
struct Ops
{
    std::function<void()> guard; // live AND writes-open, immediately before each game call
    std::function<uint64_t()> connection; // transport epoch; a reconnect invalidates pending proof
    std::function<void()> seedOffers;
    std::function<json()> hub;
    std::function<json(int32_t, int32_t, int32_t, bool)> choice;
    std::function<json()> photo;
    std::function<json(int32_t, bool)> exitAttempt; // bool: comparison callback, otherwise queued native event
    std::function<bool()> inputReady;
    std::function<bool(const std::string&)> physicalHeld;
    std::function<void(const std::string&, const std::string&, float)> dispatch;
};
class Service
{
public:
    explicit Service(EventLog& aEvents) : m_events(aEvents) {}
    json Arm(const json& aParams, double aNow, uint64_t aWorld, const std::string& aContext, uint64_t aConnection = 0);
    json Submit(const std::string& aKind, const json& aParams, double aNow, const Ops& aOps);
    void Tick(double aNow, uint64_t aWorld, const std::string& aContext, bool aOpen, const Ops& aOps);
    void Stop(const std::string& aReason, const Ops& aOps);
    json State() const;
    // Called only at the rendered, visible button, after ImGui.Button and its settling guard.
    json TakeUi(double aNow, uint64_t aWorld, uint64_t aLock, bool aOffered);
    bool ReportUi(const json& aReport);
    bool ValidateUi(double aNow, uint64_t aWorld, uint64_t aLock, bool aOffered) const;
    void Observe(const std::string& aKind, json aData);
    void SetLock(uint64_t aGeneration, bool aOffered);
private:
    void CheckRun(const json& aParams, double aNow) const;
    void Finish(const std::string& aReason, json aData = json::object());
    void Neutralize(const Ops& aOps);
    EventLog& m_events;
    mutable std::recursive_mutex m_mutex;
    std::string m_run, m_context, m_held, m_heldKind;
    double m_expires = 0, m_deadline = 0;
    uint64_t m_world = 0, m_lock = 0, m_serial = 0, m_cursor = 0, m_sourceSeq = 0;
    uint64_t m_connection = 0;
    bool m_offered = false;
    json m_job = nullptr, m_result = nullptr, m_offer = nullptr, m_photoReceipt = nullptr;
};
void RegisterMethods(Dispatcher& aDispatcher, Service& aService, bool aHooks, bool aEngineGate,
                     std::function<double()> aNow, std::function<uint64_t()> aWorld,
                     std::function<std::string()> aContext, std::function<Ops()> aOps);
} // namespace xfb::input
