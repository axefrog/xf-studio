// Bridge 0.8.20: what V witnessed (core/Incidents.hpp; research/story-engine/runtime-requirements.md S7). The autonomous build's
// redscript taps call XFBridge_IncidentSeen with one observation or a one-second tick; the core groups them, and a closed
// incident that V perceived becomes one report, delivered to three places and nowhere else:
//   * test.events (the probe ring), kind witness.report, the game-events feed (S1);
//   * session.events, kind witness.report, a short summary (game.catchup reads it);
//   * the recorder's incidents channel, the whole report, while a run wants the channel.
// Passive: nothing here calls into the game, and the taps only read.
//
// 0.8.21, the engine's declared incidents (core/Incidents.hpp): incidents.declare / incidents.close, the sight sampler's plan and
// samples (XFBridge_IncidentSightPlan, then a {"sight": true} message through XFBridge_IncidentSeen), the spawn link (npc.spawn and
// npc.substitute's incident parameter, through npc::IncidentLink), and the closes a kill, a load, a handover and the taps going off
// bring. A declared incident ends in a witness.report, a witness.gap or a witness.unwitnessed event, delivered to the same three places.

#include <atomic>
#include <cmath>

#include <RED4ext/RED4ext.hpp>

#include "core/Incidents.hpp"
#include "core/Npc.hpp"
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
    json brief = {{"incident", aReport["incident"]},     {"world", aReport["world"]},       {"kind", aReport["kind"]},         {"modes", modes},
                  {"confidence", aReport["confidence"]}, {"v_involved", aReport["v_involved"]},
                  {"participants", aReport["participants"].size()}, {"place", aReport["place"]["position"]},
                  {"district_v", aReport["place"]["district_v"]}, {"when", aReport["when"]}, {"closed", aReport["closed"]}};
    if (aReport.contains("declared"))
    {
        brief["declared"] = aReport["declared"]; // the engine's id, kind and roles (at most five actors)
    }
    return brief;
}

void Deliver(std::vector<json> aReports)
{
    auto& s = Get();
    for (auto& report : aReports)
    {
        // A witness.gap is a witnessed incident whose report was lost: it goes to the same three places, as a warning. A
        // witness.unwitnessed (0.8.21) is a declared incident V never perceived, with the reason: also the same three places.
        const std::string kind = report.value("event", std::string("witness.report"));
        const bool gap = kind == "witness.gap";
        const bool unseen = kind == "witness.unwitnessed";
        const std::string id = report["incident"].get<std::string>();
        std::string label = id;
        if (report.contains("declared"))
        {
            label += " (" + report["declared"].value("kind", std::string()) + " " + report["declared"].value("id", std::string()) + ")";
        }
        const std::string text = gap      ? "V witnessed " + label + " but its report was lost (queue full)"
                                 : unseen ? label + " went unwitnessed: " + report.value("reason", std::string())
                                          : "V witnessed " + label + ": " + report["kind"].get<std::string>();
        if (s.config.allowTestHooks)
        {
            s.probeEvents.Push(kind, report, static_cast<int64_t>(win32::MonotonicMs()));
        }
        s.events.Push(kind, gap ? "warn" : "info", "incidents", text, gap || unseen ? report : Brief(report));
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
        Deliver(Incidents().CloseAllDeclared("load")); // the engine's own say why; the rest follow with world_changed
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
    if (wire.contains("sight"))
    {
        // 0.8.21: the sampler's look at V's sight of the declared incidents' actors.
        std::string why;
        const auto sample = incidents::ParseSight(wire, why);
        if (!sample)
        {
            Incidents().NoteInvalid();
            return false;
        }
        auto outcome = Incidents().Sight(*sample, wall);
        Deliver(std::move(outcome.reports));
        return outcome.accepted;
    }
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

// The actors the script's sampler should look at now, as a comma list (a1,a2), or nothing: no declared incident is open, the taps are
// off or the scripts are not live. Asked every half second by the autonomous build's poll, so it is a lock and a short copy.
std::string IncidentSightPlan()
{
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
    if (!IncidentTapOn() || !Get().scriptLayer.Ready() || Incidents().DeclaredOpen() == 0)
    {
        return std::string();
    }
    SyncWorld();
    std::string plan;
    for (const auto& handle : Incidents().SightPlan())
    {
        plan += (plan.empty() ? "" : ",") + handle;
    }
    return plan;
#else
    return std::string();
#endif
}

// Every declared incident closed with a reason (bridge.handover; the kill switch through TickIncidents); the others carry on.
json CloseDeclaredIncidents(const std::string& aReason)
{
    const auto open = Incidents().DeclaredOpen();
    Deliver(Incidents().CloseAllDeclared(aReason));
    return json{{"closed", open}, {"reason", aReason}};
}

// Game thread, every tick. A declared incident does not outlive the kill switch or a handover, whichever way they were set; after a
// kill every report still waiting for the minute's allowance becomes a witness.gap that is kept (the transport is down). Otherwise the
// waiting reports go as the allowance recovers: housekeeping on wall-clock time that needs neither the taps nor later evidence.
void TickIncidents()
{
    auto& s = Get();
    if (s.bridge && s.bridge->GetDispatcher().IsKilled())
    {
        if (Incidents().DeclaredOpen() > 0)
        {
            CloseDeclaredIncidents("kill");
        }
        Deliver(Incidents().ResolvePending(false, "kill"));
        return;
    }
    Deliver(Incidents().Drain(recording::Now()));
    if (s.bridge && s.bridge->GetDispatcher().HandedOver() && Incidents().DeclaredOpen() > 0)
    {
        CloseDeclaredIncidents("handover");
    }
}

// The plugin is going away (game shutdown, unload): everything open closes with the reason, and every report still waiting is settled
// as a witness.gap kept in the service (the transport is going down). Idempotent.
void ShutdownIncidents(const std::string& aReason)
{
    Deliver(Incidents().CloseAll(aReason));
    Deliver(Incidents().ResolvePending(false, aReason));
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
            // Reports still waiting for the minute's allowance are settled now rather than left to it: the transport is up.
            Deliver(Incidents().ResolvePending(true, "tap_off"));
        }
    };
    hooks.sync = [] { SyncWorld(); };
    hooks.emit = [](std::vector<json> aReports) { Deliver(std::move(aReports)); };
    hooks.wall = [] { return recording::Now(); };
    hooks.handedOver = [] { return Get().bridge && Get().bridge->GetDispatcher().HandedOver(); };
    hooks.actor = [](const std::string& aHandle) {
        incidents::ActorInfo info;
        const auto view = NpcService().ActorOf(aHandle);
        info.exists = view.exists;
        info.hasPos = view.hasPos;
        std::copy(view.position.begin(), view.position.end(), info.pos);
        return info;
    };
    incidents::RegisterMethods(aDispatcher, Incidents(), std::move(hooks));
    // The spawn link: npc.spawn and npc.substitute's incident parameter. Test builds only; elsewhere the parameter is refused.
    if (Get().config.allowTestHooks && Available())
    {
        npc::IncidentLink link;
        link.join = [](const std::string& aIncident, const std::string& aWho, const std::string& aRole, const npc::ActorView& aView) {
            SyncWorld();
            incidents::ActorInfo info;
            info.exists = aView.exists;
            info.hasPos = aView.hasPos;
            std::copy(aView.position.begin(), aView.position.end(), info.pos);
            return Incidents().JoinDeclared(aIncident, aWho, aRole, info);
        };
        link.leave = [](const std::string& aIncident, const std::string& aWho) { Incidents().LeaveDeclared(aIncident, aWho); };
        NpcService().SetIncidentLink(std::move(link));
    }
}
} // namespace xfb::plugin
