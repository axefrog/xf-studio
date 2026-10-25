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
    size_t limit = 20;
};
ListQuery ParseListQuery(const json& aParams); // throws xfb::MethodError bad_params

struct Stats
{
    uint64_t observed = 0, accepted = 0, droppedRate = 0, droppedInvalid = 0, droppedNoPlace = 0;
    uint64_t opened = 0, closed = 0, merged = 0, evictedOpen = 0;
    uint64_t reports = 0, reportsDropped = 0, unwitnessed = 0, belowScore = 0, participantsDropped = 0;
};

class Service
{
public:
    explicit Service(Config aConfig = Config());

    Outcome Observe(const Observation& aObservation, double aWallS);
    // The one-second poll: closes the incidents that went quiet. Reports of the ones it closed.
    std::vector<json> Tick(double aSimS, double aWallS);
    std::vector<json> CloseAll(const std::string& aReason);
    void NoteInvalid();
    void SetWorld(uint64_t aWorld);
    uint64_t World() const;

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
    struct Incident
    {
        uint64_t number = 0;
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
        bool reported = false, reportDropped = false;
        uint64_t continues = 0;
        std::vector<uint64_t> merged;
    };

    void AdvanceClock(double aSimS, std::vector<json>& aReports);
    void CloseEverything(const std::string& aReason, std::vector<json>& aReports);
    void CloseExpired(double aSimS, std::vector<json>& aReports);
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
    double m_lastWall = 0;
    Stats m_stats;
};

// incidents.list {state?, witnessed?, v_involved?, limit?, tap?}: the recent incidents, newest first, and whether each was witnessed.
// A read: nothing here changes the game. Refused (test_hooks_off) unless the build's config allows test hooks and the build carries
// the taps. tap switches the observation tap off or on (default on); aSync runs first (the plugin closes the incidents of a world
// that has gone, so a list never shows a past world's incident as open).
struct MethodHooks
{
    bool allowTestHooks = false;
    bool taps = false; // this build carries the taps (the autonomous -writes build)
    std::function<bool()> tapOn;
    std::function<void(bool)> setTap;
    std::function<void()> sync;
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
