// Bridge 0.8.20: what V witnessed (core/Incidents.hpp; research/story-engine/runtime-requirements.md S7). The autonomous build's
// redscript taps call XFBridge_IncidentSeen with one observation or a one-second tick; the core groups them, and a closed
// incident that V perceived becomes one report, delivered to three places and nowhere else:
//   * test.events (the probe ring), kind witness.report, the game-events feed (S1);
//   * session.events, kind witness.report, a short summary (game.catchup reads it);
//   * the recorder's incidents channel, the whole report, while a run wants the channel.
// Passive: nothing here calls into the game, and the taps only read.

#include <atomic>
#include <cmath>

#include <RED4ext/RED4ext.hpp>

#include "core/Incidents.hpp"
#include "core/Probes.hpp"
#include "core/Recording.hpp"
#include "core/Win32.hpp"
#include "plugin/GameHandlers.hpp"
#include "plugin/Natives.hpp"
#include "plugin/Plugin.hpp"

namespace xfb::plugin
{
namespace
{
using json = nlohmann::json;

incidents::Service& Incidents()
{
    static incidents::Service service;
    return service;
}

std::atomic<bool> gTap{true};

uint64_t World()
{
    return Get().scriptLayer.Describe().value("detaches", uint64_t{0});
}

bool Available()
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    return true;
#else
    return false;
#endif
}

// The short form the session events keep (their data is cut at 4 KiB; the whole report is in the other two places).
json Brief(const json& aReport)
{
    json modes = aReport["perceived"]["modes"];
    return {{"incident", aReport["incident"]},     {"world", aReport["world"]},       {"kind", aReport["kind"]},         {"modes", modes},
            {"confidence", aReport["confidence"]}, {"v_involved", aReport["v_involved"]},
            {"participants", aReport["participants"].size()}, {"place", aReport["place"]["position"]},
            {"district_v", aReport["place"]["district_v"]}, {"when", aReport["when"]}, {"closed", aReport["closed"]}};
}

void Deliver(std::vector<json> aReports)
{
    auto& s = Get();
    for (auto& report : aReports)
    {
        // A witness.gap is a witnessed incident whose report was lost: it goes to the same three places, as a warning.
        const bool gap = report.value("event", std::string("witness.report")) == "witness.gap";
        const std::string kind = gap ? "witness.gap" : "witness.report";
        const std::string text = gap ? "V witnessed " + report["incident"].get<std::string>() + " but its report was lost (queue full)"
                                     : "V witnessed " + report["incident"].get<std::string>() + ": " + report["kind"].get<std::string>();
        if (s.config.allowTestHooks)
        {
            s.probeEvents.Push(kind, report, static_cast<int64_t>(win32::MonotonicMs()));
        }
        s.events.Push(kind, gap ? "warn" : "info", "incidents", text, gap ? report : Brief(report));
        RecordingIngress("incidents", SerializeJson(report));
    }
}

// The incidents of a world that has gone are closed (and reported if V perceived them) before anything of the new one counts.
void SyncWorld()
{
    // Reports that waited for the minute's allowance go out on any contact with the service, not only on a tick.
    Deliver(Incidents().Drain(recording::Now()));
    const auto world = World();
    if (world != Incidents().World())
    {
        Deliver(Incidents().CloseAll("world_changed"));
        Incidents().SetWorld(world);
    }
}
} // namespace

bool IncidentTapOn()
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    auto& s = Get();
    return s.config.allowTestHooks && gTap.load() && s.bridge && !s.bridge->GetDispatcher().IsKilled();
#else
    return false;
#endif
}

// Whether the taps may build one more observation of this evidence from this entity (core Service::Admit); false when the taps are off.
bool IncidentAdmit(const std::string& aEvidence, const std::string& aKey)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!IncidentTapOn() || !Get().scriptLayer.Ready() || aEvidence.size() > 24 || aKey.size() > 64)
    {
        return false;
    }
    return Incidents().Admit(aEvidence, aKey, recording::Now());
#else
    (void)aEvidence; (void)aKey;
    return false;
#endif
}

bool IncidentSeen(const std::string& aPayload)
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!IncidentTapOn() || !Get().scriptLayer.Ready())
    {
        return false;
    }
    if (aPayload.size() > 4096 || JsonNestingDepth(aPayload, 6) > 6)
    {
        Incidents().NoteInvalid();
        return false;
    }
    const auto wire = json::parse(aPayload, nullptr, false);
    if (!wire.is_object())
    {
        Incidents().NoteInvalid();
        return false;
    }
    SyncWorld();
    const double wall = recording::Now();
    if (wire.contains("tick"))
    {
        const auto sim = wire.find("sim");
        if (sim == wire.end() || !sim->is_number() || !std::isfinite(sim->get<double>()))
        {
            Incidents().NoteInvalid();
            return false;
        }
        Deliver(Incidents().Tick(sim->get<double>(), wall));
        return true;
    }
    std::string why;
    const auto observation = incidents::ParseObservation(wire, why);
    if (!observation)
    {
        Incidents().NoteInvalid();
        return false;
    }
    auto outcome = Incidents().Observe(*observation, wall);
    Deliver(std::move(outcome.reports));
    return outcome.accepted;
#else
    (void)aPayload;
    return false;
#endif
}

json IncidentCoverage()
{
    return Incidents().Coverage();
}

void RegisterIncidents(Dispatcher& aDispatcher)
{
    incidents::MethodHooks hooks;
    hooks.allowTestHooks = Get().config.allowTestHooks;
    hooks.taps = Available();
    hooks.tapOn = [] { return gTap.load(); };
    // Switching the taps off closes what is open (and reports what V perceived), since the one-second poll that would close it stops.
    hooks.setTap = [](bool aOn) {
        const bool was = gTap.exchange(aOn);
        if (was && !aOn)
        {
            Deliver(Incidents().CloseAll("tap_off"));
        }
    };
    hooks.sync = [] { SyncWorld(); };
    incidents::RegisterMethods(aDispatcher, Incidents(), std::move(hooks));
}
} // namespace xfb::plugin
