#pragma once

// Bridge 0.8.20: what V witnessed, as reports tied to their incidents (research/story-engine/runtime-requirements.md S7; built on
// S1, the event feed, and S2, perception). The redscript taps (redscript-probes/autonomous/XFRuntimeBridgeIncidents.reds, the
// autonomous test build only) hand over small observations: one thing the game's own systems did (a stimulus broadcast, a death,
// a combat target, a reprimand, a vehicle theft, an allow-listed voice request), with the people and vehicles in it and what V's
// senses made of each (distance, in V's view, a static-geometry ray). This file groups the observations into incidents, decides
// what V saw and heard, and builds one report when an incident closes. No game headers: the plugin and the self-test run it.
//
// PASSIVE. Nothing here, and nothing in the taps, changes anyone's ties, beliefs, attitudes or state; the report only says what
// V perceived. "Was told" (an incident V hears of in dialogue) is not sensed and is not reported; the report says so.
//
// Grouping (an observation joins the first rule that fits; otherwise it opens an incident):
//   1. an open incident that already holds one of its people (V does not count: every incident V takes part in would merge);
//      if it shares people with several open incidents they are merged into the oldest;
//   2. the nearest open incident whose last place is within joinRadiusM of its place.
// An incident closes quietS simulation seconds after its last observation, or maxOpenS after it began (a longer one is split,
// and the next part names what it continues), or when the world changes. The simulation clock comes with every observation and
// every tick (a one-second script poll), so a paused game neither closes nor ages an incident.
//
// Kind, from the people's roles and the evidence (first match): police_stop (a reprimand), theft (a vehicle theft), accident (a
// collision or a vehicle hit with no attacker), street_fight (someone who both attacked and was attacked, or two attackers and a
// victim), assault (an attacker and a victim), gunfire (shots or an explosion with no known victim), other.
//
// Perception, per observation (V's own samples, taken when the game raised it): SAW when a person other than V was in V's view,
// within seeRangeM and unoccluded by static geometry (a ray from the camera); HEARD when V was within the observation's audible
// radius (the stimulus' own radius where the game gives one; 0 means not audible). An incident is witnessed when any of its
// observations was seen or heard; only a witnessed incident whose evidence reaches minScore is reported.
//
// Declared incidents (0.8.21): the game raises almost none of the Story Engine's incident kinds (no NPC theft, no stall
// collection), so the engine stages its own with XF actors and declares them (incidents.declare {id, kind, roles, at?, ttl_s}) so
// that reports carry its kind and id. A declared incident opens at once and holds its actors by handle (a1, a2): any stimulus or
// observation that names one of them joins it (declared membership takes precedence over the grouping above; an ordinary incident
// that shares people with it merges into it, and a declared incident is never merged into another or joined by strangers near it).
// It closes on incidents.close {id}, when its TTL (simulation seconds) runs out, or with a reason on a kill, a load, a handover or
// the taps going off; not on quiet, and not at maxOpenS. While one is open the plugin samples V's sight of its actors at a low
// bounded rate (2 Hz from the script, at most maxSightPerSecond accepted, over at most maxDeclared incidents) with the same view
// cone and static-geometry ray as the taps, so a silent staged incident can still be "saw". Closing gives exactly one
// witness.report carrying declared {id, kind, roles} (whatever its evidence score), or a witness.gap; an incident V never perceived
// gives one explicit witness.unwitnessed event with the reason (no_samples, actors_missing, no_view, out_of_range, not_in_view,
// occluded, unchecked). Still passive: nothing here changes the game.
//
// Bounds: at most maxOpen open incidents (the least recently active is closed to make room), maxClosed kept, maxParticipants a
// head, maxObservationsPerSecond and maxReportsPerMinute accepted (the rest counted), strings and counts checked on the way in.

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <iterator>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::incidents
{
using json = nlohmann::json;

enum Role : uint32_t
{
    kAggressor = 1,
    kVictim = 2,
    kSource = 4,
    kSpeaker = 8,
    kVehicle = 16,
    kThief = 32,
    kOfficer = 64,
    kSubject = 128,
};
// The role names on the wire and in reports, in bit order.
inline constexpr const char* kRoleNames[] = {"aggressor", "victim", "source", "speaker", "vehicle", "thief", "officer", "subject"};
uint32_t RoleFromName(const std::string& aName); // 0 for a name that isn't one

enum class Kind
{
    Theft,
    Assault,
    Accident,
    StreetFight,
    PoliceStop,
    Gunfire,
    Other,
};
const char* KindName(Kind aKind);

// What an evidence name stands for: how much it counts towards a report, and whether the game itself makes a noise of it.
struct EvidenceInfo
{
    const char* name;
    double weight;
};
// nullptr for a name the taps do not send.
const EvidenceInfo* FindEvidence(const std::string& aName);

struct Config
{
    double quietS = 12.0;       // an incident closes this many simulation seconds after its last observation
    double maxOpenS = 120.0;    // ... or this long after it began
    double joinRadiusM = 35.0;  // an observation with no shared person joins an incident whose last place is this near
    double seeRangeM = 80.0;    // farthest a person in view and unoccluded counts as seen
    double minScore = 1.0;      // evidence a report needs (one shot, one blow or one death is 1; a voice request is 0.25)
    size_t maxOpen = 32;
    size_t maxClosed = 64;
    size_t maxParticipants = 16;
    int maxObservationsPerSecond = 40; // accepted per wall-clock second; the rest are counted, not kept
    size_t maxReportsPerMinute = 20;
    size_t maxPendingReports = 64;      // reports over the minute's allowance wait here and go out as it recovers
    int maxBuiltPerSecond = 24;         // observations the taps may build in a wall-clock second (Admit)
    int maxWeakBuiltPerSecond = 12;     // of those, the weak kinds (barks, screams, bodies): the rest is kept for direct acts
    int maxPerKeyPerSecond = 2;         // of one kind of evidence from one entity: a burst of V's shots cannot starve the rest
    // 0.8.21: declared incidents.
    size_t maxDeclared = 4;             // open at once; also the incidents the sight sampler looks at
    size_t maxRoles = 5;                // actors in one (the bridge directs five at most)
    double ttlMinS = 1.0;               // ttl_s, in simulation seconds
    double ttlDefaultS = 60.0;
    double ttlMaxS = 300.0;
    int maxSightPerSecond = 3;          // sight samples accepted per wall-clock second (the script sends 2)
};
json ConfigJson(const Config& aConfig);

enum class Los
{
    Clear = 0,
    Blocked = 1,
    Unchecked = 2,
};

// One person or vehicle in an observation, with V's samples of it.
struct Fact
{
    std::string id;          // the entity id as the other recorder channels write it
    std::string who;         // an XF actor's handle (a1, p2), or empty
    std::string record;      // the character's or vehicle's TweakDB record
    std::string affiliation; // the character record's affiliation, or empty
    uint32_t roles = 0;
    bool isV = false;
    bool crowd = false;
    bool hasPos = false;
    double pos[3] = {0, 0, 0};
    double dist = -1;        // V to it, metres; negative when unknown
    bool inView = false;     // inside V's camera view
    Los los = Los::Unchecked;
};

struct Observation
{
    std::string evidence;    // one of FindEvidence's names
    std::string type;        // the stimulus type or voice trigger, for the report
    std::vector<Fact> who;   // at most kMaxFacts
    bool hasPos = false;
    double pos[3] = {0, 0, 0};
    double radius = 0;       // audible radius in metres; 0 is silent
    double vDist = -1;       // V to pos, metres; negative when unknown
    double simS = 0;         // the simulation clock, seconds
    double gameS = -1;       // the game clock's time stamp, seconds
    std::string district;    // the district V was in
    std::string view;        // "gameplay" or "photo": whose camera the view samples used
};
inline constexpr size_t kMaxFacts = 4;

// Checks and converts an observation's wire form; nullopt and why on refusal.
std::optional<Observation> ParseObservation(const json& aWire, std::string& aWhy);

// What V perceived of one observation.
struct Perception
{
    bool saw = false;
    bool heard = false;
    double sawDist = -1;
    std::string sawVia;
    double heardDist = -1;
    bool participantOnly = false; // every person in it is V: V's own act, nothing for V to perceive
};
Perception Perceive(const Observation& aObservation, const Config& aConfig);

struct Outcome
{
    bool accepted = false;
    std::string reason;        // why not: rate, invalid, no_place
    std::string incident;      // the incident it joined or opened
    std::vector<json> reports; // reports of incidents this call closed
};

struct ListQuery
{
    std::string state = "any"; // open, closed or any
    std::optional<bool> witnessed;
    std::optional<bool> vInvolved;
    std::optional<bool> declared; // 0.8.21: only the engine's declared incidents (true) or only the game's own (false)
    std::string declaredId;       // 0.8.21: the incident declared under this id
    size_t limit = 20;
};
ListQuery ParseListQuery(const json& aParams); // throws xfb::MethodError bad_params

struct Stats
{
    uint64_t observed = 0, accepted = 0, droppedRate = 0, droppedInvalid = 0, droppedNoPlace = 0;
    uint64_t opened = 0, closed = 0, merged = 0, evictedOpen = 0;
    uint64_t reports = 0, reportsQueued = 0, reportsDelayed = 0, reportGaps = 0, unwitnessed = 0, belowScore = 0, participantsDropped = 0;
    // The taps' admission (Admit): what was let through to be built, and what was not, by reason.
    uint64_t tapAdmitted = 0, tapDroppedCap = 0, tapDroppedWeak = 0, tapDroppedRepeat = 0;
    // 0.8.21: declared incidents and the sight sampler.
    uint64_t declared = 0, declaredClosed = 0, declaredUnwitnessed = 0, joinedBySpawn = 0;
    uint64_t sightSamples = 0, sightDroppedRate = 0, sightDroppedInvalid = 0;
};

// --- declared incidents (0.8.21) -----------------------------------------------------------------------------------------------

// The engine's own text (an id, a kind, a role) is carried verbatim, so it is checked as safe text: 1 to aMax characters of ASCII
// letters, digits and _ - . : / + (and, when aAllowSpace, single inner spaces); nothing else, no control characters, no quotes.
bool SafeText(const std::string& aText, size_t aMax, bool aAllowSpace);
// An XF actor's handle: a, then digits (a1, a12). V, "v" and a picked passer-by's handle (p1) are not.
bool IsActorHandle(const std::string& aHandle);

struct ActorInfo
{
    bool exists = false; // one of the bridge's own actors now (or one whose spawn is under way)
    bool hasPos = false;
    double pos[3] = {0, 0, 0};
};
using ActorLookup = std::function<ActorInfo(const std::string& aHandle)>;

struct Declaration
{
    std::string id;   // the engine's, verbatim
    std::string kind; // the engine's, verbatim
    std::vector<std::pair<std::string, std::string>> roles; // handle -> role, in the order given
    bool hasAt = false;
    double at[3] = {0, 0, 0};
    double ttlS = 60.0;
    bool atFromActors = false; // no 'at': the centroid of the actors' known places
};
// incidents.declare's parameters, checked. Throws xfb::MethodError: bad_params (a field that isn't what it should be, V or a pick
// named, an overlong or unsafe text), npc_not_found (a handle that isn't one of the bridge's actors), no_place (no 'at' and no
// actor with a known place).
Declaration ParseDeclaration(const json& aParams, const ActorLookup& aLookup, const Config& aConfig);

struct DeclareOutcome
{
    json declared;             // the answer: incident, id, kind, roles, at, ttl
    std::vector<json> reports; // reports of the incidents this call closed (one evicted to make room)
};
struct CloseOutcome
{
    bool found = false;
    std::string incident;
    std::string outcome;       // report, report_queued, gap or unwitnessed
    std::string unwitnessedReason;
    std::vector<json> reports; // the report, the gap or the unwitnessed event
};

// One look at V's sight of the declared incidents' actors (the script's 2 Hz sampler): each actor as the taps' Fact (distance, in
// the camera's view, the static ray), and whose camera it was.
inline constexpr size_t kMaxSightFacts = 8;
struct SightSample
{
    std::vector<Fact> who;
    double simS = 0;
    double gameS = -1;
    std::string district;
    std::string view; // "gameplay", or "photo" (no view of V's own: nothing can be seen)
};
// The wire form: {sight: true, sim, game?, dist?, view?, who: [Fact...]} with at most kMaxSightFacts people.
std::optional<SightSample> ParseSight(const json& aWire, std::string& aWhy);
struct SightOutcome
{
    bool accepted = false;
    std::string reason;        // rate or invalid
    std::vector<json> reports; // reports of incidents the clock closed
};

class Service
{
public:
    explicit Service(Config aConfig = Config());

    Outcome Observe(const Observation& aObservation, double aWallS);
    // Whether the taps may build one more observation of this evidence from this entity now (before any work is done on it). Bounded
    // per wall-clock second: maxBuiltPerSecond in all, maxWeakBuiltPerSecond of the weak kinds, maxPerKeyPerSecond of one key (the
    // evidence and the entity). Every refusal is counted by reason in the stats.
    bool Admit(const std::string& aEvidence, const std::string& aKey, double aWallS);
    // Reports that waited for the minute's allowance and can go now (witness.report with delayed true). The plugin calls this every
    // tick, whether or not the taps are on, so a queued report never depends on later evidence arriving.
    std::vector<json> Drain(double aWallS);
    // Terminal shutdown (kill, taps off, unload): every report still waiting is settled now. With the transport up each goes out at once
    // (witness.report, delayed, ignoring the minute's allowance: at most maxPendingReports); with it down each becomes a witness.gap
    // (reason transport_down, closed_by the cause) that is also kept for incidents.list's retained_gaps. Nothing stays pending.
    std::vector<json> ResolvePending(bool aTransportUp, const std::string& aCause);
    size_t PendingCount() const;
    // The one-second poll: closes the incidents that went quiet. Reports of the ones it closed.
    std::vector<json> Tick(double aSimS, double aWallS);
    std::vector<json> CloseAll(const std::string& aReason);
    void NoteInvalid();
    void SetWorld(uint64_t aWorld);
    uint64_t World() const;

    // --- 0.8.21: declared incidents -------------------------------------------------------------------------------------------
    // Opens the incident at once (the least recently active ordinary incident is closed to make room) and returns our inc-N beside the
    // engine's id. Throws MethodError: duplicate_id (open, or still among the kept closed ones), incident_limit (too many open, too many roles).
    DeclareOutcome Declare(const Declaration& aDeclaration, double aWallS);
    // Closes the incident declared under aId (found false when none is open); the report, the gap or the unwitnessed event is in
    // reports, and also in the outcome's name.
    CloseOutcome CloseDeclared(const std::string& aId, const std::string& aReason, double aWallS);
    // Closes every open declared incident with a reason (kill, load, handover); the others carry on.
    std::vector<json> CloseAllDeclared(const std::string& aReason);
    // The spawn link: adds an actor (a handle) to an open declared incident under a role. Throws MethodError: incident_unknown (none
    // open under that id), incident_limit (the incident holds maxRoles), bad_params (an unsafe role). LeaveDeclared undoes it (a spawn that failed).
    json JoinDeclared(const std::string& aId, const std::string& aWho, const std::string& aRole, const ActorInfo& aActor);
    void LeaveDeclared(const std::string& aId, const std::string& aWho);
    size_t DeclaredOpen() const;
    // The actors the sampler should look at now: those of at most maxDeclared open declared incidents, each once.
    std::vector<std::string> SightPlan() const;
    // One sight sample; bounded to maxSightPerSecond a wall-clock second.
    SightOutcome Sight(const SightSample& aSample, double aWallS);

    json List(const ListQuery& aQuery) const;
    // {open, kept, reports, ...} for the recorder's coverage heartbeat.
    json Coverage() const;
    Stats GetStats() const;
    Config GetConfig() const { return m_config; }

private:
    struct Participant
    {
        Fact fact;
        double nearest = -1;
        int seen = 0;
    };
    // 0.8.21: what a declared incident adds. Sight counters are per sample taken (an actor missing from the sample counts once).
    struct Declared
    {
        bool on = false;
        std::string id, kind;
        std::vector<std::pair<std::string, std::string>> roles; // handle -> role
        bool hasAt = false;
        double at[3] = {0, 0, 0};
        double ttlS = 60.0;
        bool anchored = false; // the TTL runs from anchorSim; set at once when the clock is known, else by the first clock that arrives
        double anchorSim = 0;  // the fixed start of the TTL: never moved by a merge (startSim is the evidence timeline and is)
        int samples = 0, inRange = 0, inView = 0, blocked = 0, unchecked = 0, noView = 0, missing = 0;
    };
    struct Incident
    {
        uint64_t number = 0;
        Declared declared;
        uint64_t world = 0;
        bool open = true;
        std::string closeReason;
        std::vector<Participant> parts;
        uint64_t partsDropped = 0;
        std::map<std::string, int> evidence;
        double score = 0;
        int observations = 0;
        double startSim = 0, lastSim = 0, startGame = -1, lastGame = -1;
        double firstPos[3] = {0, 0, 0}, lastPos[3] = {0, 0, 0}, sumPos[3] = {0, 0, 0};
        int posN = 0;
        std::string district;
        bool saw = false, heard = false, heardNonVoice = false;
        int sawN = 0, heardN = 0;
        double sawFirstSim = -1, heardFirstSim = -1, sawNearest = -1, heardNearest = -1, heardRadius = 0;
        std::string sawVia;
        bool vInvolved = false;
        bool reported = false, reportPending = false, reportGap = false;
        uint64_t continues = 0;
        std::vector<uint64_t> merged;
    };

    void AdvanceClock(double aSimS, std::vector<json>& aReports);
    void CloseDeclaredExpired(std::vector<json>& aReports);
    void RetainGap(const json& aGap);
    // Closes the least recently active ordinary incident; false when only declared ones are open.
    bool EvictOne(std::vector<json>& aReports);
    void AbsorbPeople(Incident& aIncident, const std::vector<Fact>& aWho);
    void ApplyPerception(Incident& aIncident, const Perception& aPerception, const Observation& aObservation);
    static json DeclaredJson(const Incident& aIncident);
    static std::string UnwitnessedReason(const Incident& aIncident);
    json UnwitnessedEvent(const Incident& aIncident) const;
    Incident* FindDeclaredOpen(const std::string& aId);
    void CloseEverything(const std::string& aReason, std::vector<json>& aReports);
    void CloseExpired(double aSimS, std::vector<json>& aReports);
    void CloseOverlong(std::vector<json>& aReports);
    void PurgeReportTimes();
    void DrainPending(std::vector<json>& aReports);
    json BuildReport(const Incident& aIncident) const;
    void Close(Incident& aIncident, const std::string& aReason, std::vector<json>& aReports);
    void MergeInto(Incident& aInto, Incident& aFrom);
    void Absorb(Incident& aIncident, const Observation& aObservation);
    static Kind Resolve(const Incident& aIncident);
    double Confidence(const Incident& aIncident) const;
    json Describe(const Incident& aIncident) const;
    bool Witnessed(const Incident& aIncident) const { return aIncident.saw || aIncident.heard; }

    Config m_config;
    mutable std::mutex m_mutex;
    std::vector<Incident> m_open;
    std::deque<Incident> m_closed;
    uint64_t m_next = 1;
    uint64_t m_world = 0;
    double m_lastSim = 0;
    bool m_haveSim = false;
    int64_t m_rateSecond = -1;
    int m_rateCount = 0;
    std::deque<double> m_reportTimes; // wall seconds of recent reports
    struct Pending
    {
        uint64_t number;
        json report;
    };
    std::deque<Pending> m_pending;    // witnessed incidents whose report waits for the allowance, oldest first
    std::deque<json> m_gaps;          // witness.gap events, kept (64) for incidents.list's retained_gaps and the next catch-up
    int64_t m_sightSecond = -1;
    int m_sightCount = 0;
    int64_t m_admitSecond = -1;
    int m_admitTotal = 0, m_admitWeak = 0;
    std::vector<std::pair<std::string, int>> m_admitKeys;
    double m_lastWall = 0;
    Stats m_stats;
};

// incidents.list {state?, witnessed?, v_involved?, limit?, tap?}: the recent incidents, newest first, and whether each was witnessed.
// A read: nothing here changes the game. Refused (test_hooks_off) unless the build's config allows test hooks and the build carries
// the taps. tap switches the observation tap off or on (default on); aSync runs first (the plugin closes the incidents of a world
// that has gone, so a list never shows a past world's incident as open).
//
// 0.8.21, incidents.declare {id, kind, roles, at?, ttl_s} and incidents.close {id}: the engine's own staged incidents (see the top of
// this file). The same gates as incidents.list, and refused while the taps are off (tap_off) or the session is handed over
// (handed_over). Hooks: emit hands the reports and events a call produced to the plugin's delivery; actor looks up an XF actor by
// handle; handedOver says whether the session is handed over.
struct MethodHooks
{
    bool allowTestHooks = false;
    bool taps = false; // this build carries the taps (the autonomous -writes build)
    std::function<bool()> tapOn;
    std::function<void(bool)> setTap;
    std::function<void()> sync;
    std::function<void(std::vector<json>)> emit;
    ActorLookup actor;
    std::function<bool()> handedOver;
    std::function<double()> wall;
};
} // namespace xfb::incidents

namespace xfb
{
class Dispatcher;
}
namespace xfb::incidents
{
void RegisterMethods(Dispatcher& aDispatcher, Service& aService, MethodHooks aHooks);
} // namespace xfb::incidents
