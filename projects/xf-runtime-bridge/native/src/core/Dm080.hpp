#pragma once

// Bridge 0.8.12's live-direction toolkit, game-independent (research/runtime/bridge-hook-inventory.md, "0.8.12 live-direction
// toolkit"): parameter checks and undos, and the session bookkeeping that runs in the game at tick rate (watchers and their
// micro-actions, timed subtitle lines, the phone call's state machine, the quest tracker's records, animated lights). Shared
// by the plugin (plugin/HandlersDm080.cpp, which gives it the redscript layer as its game steps) and the self-test host
// (selftest/SimDm080.cpp, which gives it a simulated world), so both refuse, undo and fire the same way. The commands
// themselves, their refusal order and the registry of what the bridge brought in are core/DmService.hpp.
//
// Commands (all in the "dm" write class, off unless allow_write_classes lists it; only the -writes package does):
//   world.spawn / world.despawn / world.spawned   props (entity template or record) and vehicles (record), never saved
//   world.door / vehicle.set                      a door's open, locked and sealed state; a vehicle's lights, engine, doors
//   audio.play / audio.stop / audio.radio / audio.voice   sound events, a radio device's station, a voiceset line
//   phone.text / phone.call / phone.end / phone.state     a message toast and a real call from a journal contact with lines
//   quest.set / quest.objective / quest.clear / quest.state   an XF quest in the HUD tracker (journal-free)
//   notify.show / notify.hide                     the game's own banners, centred messages, quest toasts and subtitle lines
//   light.spawn / light.set / light.remove        a light and its colour, intensity, angles and pattern
//   watch.arm / watch.disarm / watch.list         in-game watchers that log events and run micro-actions without the agent
//   game.digest                                   one compact read of V, the world, what the bridge placed, watchers, events

#include <array>
#include <cstdint>
#include <deque>
#include <functional>
#include <initializer_list>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::dm
{
using json = nlohmann::json;

// ---- limits ------------------------------------------------------------------------------------------------------------

inline constexpr size_t kMaxSpawned = 24;          // props, vehicles and lights together
inline constexpr size_t kMaxLights = 8;
inline constexpr size_t kMaxAnimatedLights = 4;    // lights whose pattern the tick drives
inline constexpr size_t kMaxSounds = 16;
inline constexpr size_t kMaxWatchers = 16;
inline constexpr size_t kMaxActions = 8;           // micro-actions per watcher
inline constexpr size_t kMaxQuests = 4;
inline constexpr size_t kMaxObjectives = 8;
inline constexpr size_t kMaxCallLines = 16;
inline constexpr size_t kMaxTexts = 8;
inline constexpr size_t kMaxSubtitleLines = 64; // includes pending and failed hides; never evict owned lines

// Four attempts per cleanup request, with 1/2/4-second backoff. Exhaustion retains ownership.
// An explicit cleanup request starts a new budget; a load discards the old world.
struct CleanupRetry
{
    unsigned attempts = 0;
    double nextAt = 0.0;
    bool Due(double aNow) const { return attempts < 4 && aNow >= nextAt; }
    void Attempt(double aNow) { nextAt = aNow + static_cast<double>(1u << attempts); ++attempts; }
};
inline constexpr double kMaxSpawnDistance = 60.0;  // metres from V
inline constexpr double kMaxWatchSeconds = 3600.0;
inline constexpr size_t kMaxActionParamsBytes = 4096;

// ---- shared pieces ------------------------------------------------------------------------------------------------------

// Where a spawned thing goes: an offset from V along her facing (forward, right, up; the default two metres ahead), or a
// world point; facing a world yaw (degrees, the game's own yaw), V (face_v), or V's own facing.
struct Where
{
    enum class Mode
    {
        Offset,
        World
    };
    Mode mode = Mode::Offset;
    std::array<double, 3> point{};
    double forward = 2.0, right = 0.0, up = 0.0;
    std::optional<double> yaw;
    bool faceV = false;
};
// Reads at / offset / yaw / face_v from aParams (the keys a command accepts are its own business).
Where ParseWhere(const json& aParams);
json WhereJson(const Where& aWhere);

// A target in the world: "v", "look_at" (what V looks at now), "mounted" (V's vehicle), "spawn:<n>" (something the bridge
// spawned) or an entity id (its decimal hash, as world.spawned, game.digest and player.state answer it). aAllowed limits
// the words a command takes; ids and spawn handles are always allowed.
std::string ParseTarget(const json& aParams, const char* aKey, bool aRequired, std::initializer_list<const char*> aAllowed);
bool TargetOk(const std::string& aText, std::initializer_list<const char*> aAllowed);
// "spawn:<n>" to n, else 0.
int32_t SpawnHandleOf(const std::string& aTarget);

// Colour: [r, g, b] 0-255 or "#rrggbb".
std::array<int32_t, 3> ParseColour(const json& aParams, const char* aKey, std::array<int32_t, 3> aDefault);

// A depot path to an entity template: letters, digits, '\' '/' '_' '-' '.', ending .ent, at most 200 characters.
bool TemplatePathOk(const std::string& aPath);
// A sound event or voiceset context name: letters, digits and '_', 1 to 96 characters.
bool EventNameOk(const std::string& aName);
// A short id chosen by the caller (watchers, quests, objectives): letters, digits, '_', '-', '.', 1 to 48 characters.
bool IdOk(const std::string& aId);

// ---- props and vehicles -------------------------------------------------------------------------------------------------

struct SpawnRequest
{
    std::string kind = "prop"; // prop or vehicle
    std::string templatePath;  // a prop's entity template, or
    std::string record;        // a TweakDB record (a vehicle's, or a prop's)
    std::string appearance;
    Where where;
    std::string label;
    bool ground = true; // snap to the ground below (a static ray), else exactly where asked
};
SpawnRequest ParseSpawn(const json& aParams);
// world.spawn's undo: despawn the handle it answered.
json SpawnUndo(int32_t aHandle);
// world.despawn's undo: spawn each removed thing again from its spec ({kind, template?, record?, appearance?, position, yaw,
// label}); an empty list when nothing was removed. Lights come back through light.spawn, not here.
json DespawnUndo(const json& aRemoved);

struct DespawnRequest
{
    int32_t handle = -1; // -1 with all
    bool all = false;
};
DespawnRequest ParseDespawn(const json& aParams);

struct DoorRequest
{
    std::string target;
    std::optional<bool> open, locked, sealed;
};
DoorRequest ParseDoor(const json& aParams);
// From the script's step {target_id, before: {open, locked, sealed}}: the same door back as it was, or null when nothing
// changed.
json DoorUndo(const json& aStep, const DoorRequest& aRequest);

inline const std::vector<std::string>& VehicleDoors()
{
    static const std::vector<std::string> doors{"all", "seat_front_left", "seat_front_right", "seat_back_left", "seat_back_right", "trunk", "hood"};
    return doors;
}
struct VehicleRequest
{
    std::string target;
    std::optional<bool> lights, engine;
    std::string door;      // with door_state
    std::string doorState; // open, closed, locked, unlocked
};
VehicleRequest ParseVehicle(const json& aParams);
json VehicleUndo(const json& aStep, const VehicleRequest& aRequest);

// ---- audio --------------------------------------------------------------------------------------------------------------

struct PlayRequest
{
    std::string event;
    std::string on = "v"; // v, global, look_at, spawn:<n> or an entity id
    std::string emitter;  // an emitter name on the entity (optional)
    bool loop = false;    // tracked until audio.stop (and stopped by the kill switch); one-shots are tracked for seconds
    double seconds = 10.0;
};
PlayRequest ParsePlay(const json& aParams);

struct StopRequest
{
    int32_t id = -1;
    bool all = false;
};
StopRequest ParseStop(const json& aParams);

struct RadioRequest
{
    std::string target;
    std::optional<int32_t> station; // 0-13 (the game's radio station numbers), or by name
    std::optional<bool> on;
};
const std::vector<std::string>& RadioStations();
RadioRequest ParseRadio(const json& aParams);
json RadioUndo(const json& aStep, const RadioRequest& aRequest);

struct VoiceRequest
{
    std::string target;
    std::string context; // a voiceset context, such as greeting
};
VoiceRequest ParseVoice(const json& aParams);

// ---- lights -------------------------------------------------------------------------------------------------------------

struct LightPattern
{
    std::string kind = "steady"; // steady, flicker (the engine's own), pulse, strobe, broken, candle
    double period = 1.0;         // seconds
    double low = 0.2;            // the dimmest share of the intensity
    double strength = 0.5;       // flicker's strength
    uint32_t seed = 1;
};
struct LightRequest
{
    std::string templatePath; // an entity template with a light component; empty: the XF light carrier
    Where where;
    std::array<int32_t, 3> colour{255, 244, 229};
    double intensity = 100.0; // the component's intensity
    double radius = 8.0;
    std::optional<double> inner, outer; // a spot or area light's cone, full angles in degrees
    LightPattern pattern;
    std::string label;
};
LightRequest ParseLightSpawn(const json& aParams);

struct LightSetRequest
{
    int32_t handle = -1;
    std::optional<std::array<int32_t, 3>> colour;
    std::optional<double> intensity, radius, inner, outer;
    std::optional<bool> on;
    std::optional<LightPattern> pattern;
    double fadeS = 0.0;
};
LightSetRequest ParseLightSet(const json& aParams);
// The earlier values the script reported {colour, intensity, radius, inner, outer, on} and the earlier pattern, as a
// light.set that puts them back.
json LightSetUndo(int32_t aHandle, const json& aBefore, const std::optional<LightPattern>& aBeforePattern);
LightPattern ParsePattern(const json& aValue);
json PatternJson(const LightPattern& aPattern);
// The share (0-1) of a light's intensity at time aT seconds under its pattern (steady and flicker: 1; the engine flickers).
double PatternValue(const LightPattern& aPattern, double aT);

// ---- phone --------------------------------------------------------------------------------------------------------------

struct TextRequest
{
    std::string contact, text;
};
TextRequest ParseText(const json& aParams);

struct CallLine
{
    std::string speaker, text;
    double seconds = 3.0;
};
struct CallRequest
{
    std::string contact; // a journal contact's id (phone.state {contacts: true} lists them)
    std::vector<CallLine> lines;
    double ringS = 20.0;
    bool video = false; // the holocall frame (a camera feed the game stages for its own calls) instead of the audio call's avatar
    bool rejectable = true;
};
CallRequest ParseCall(const json& aParams);

// ---- quest scaffolding --------------------------------------------------------------------------------------------------

struct AreaLink
{
    std::array<double, 3> at{};
    double radius = 5.0;
    bool completeOnEnter = false;
};
struct Objective
{
    std::string id, text;
    std::string state = "active"; // active, done, failed, hidden
    bool optional = false;
    std::optional<AreaLink> area;
};
struct Quest
{
    std::string id, title, text;
    std::vector<Objective> objectives;
    bool show = true; // in the HUD's quest tracker
};
struct QuestSetRequest
{
    Quest quest;
    std::string notify; // "", new, update
};
QuestSetRequest ParseQuestSet(const json& aParams);
json QuestJson(const Quest& aQuest);
Quest QuestFromJson(const json& aValue); // a record QuestJson wrote (undo)

struct ObjectiveRequest
{
    std::string quest, objective;
    std::optional<std::string> state, text;
    bool notify = true;
};
ObjectiveRequest ParseObjective(const json& aParams);

// ---- notifications ------------------------------------------------------------------------------------------------------

inline const std::vector<std::string>& NotifyStyles()
{
    static const std::vector<std::string> styles{"quest_new", "quest_update", "quest_done", "quest_failed", "onscreen", "warning", "subtitle"};
    return styles;
}
struct NotifyRequest
{
    std::string style;
    std::string title, text, speaker;
    double seconds = 5.0;
};
NotifyRequest ParseNotify(const json& aParams);

// ---- watchers -----------------------------------------------------------------------------------------------------------

enum class WatchKind
{
    Enter,    // V inside a radius of a point or an entity
    Leave,    // V outside it again (after being inside, unless now)
    Gaze,     // V looks at an entity (in a cone of the camera's view, or the targeting system's look-at) for seconds
    Weapon,   // a weapon drawn (edge on) or put away (off)
    Combat,   // in combat (on) or out of it (off)
    Vehicle,  // in a vehicle (on) or out (off)
    Interact, // V uses something: a door, a device, a prop (the HUD's choice), optionally a given target or caption
    Choice,   // V picks a dialogue choice (optionally by caption or index)
    Timer,    // seconds after arming
    Clock     // the game's time of day passes a mark
};
const char* WatchKindName(WatchKind aKind);
const std::vector<std::string>& WatchKindNames();

struct MicroAction
{
    std::string method;
    json params = json::object();
    double delayS = 0.0;
};

struct WatchSpec
{
    std::string id;
    WatchKind kind = WatchKind::Timer;
    std::optional<std::array<double, 3>> point;
    std::string entity; // enter, leave, gaze, interact: an entity id or spawn:<n>
    double radius = 5.0;
    double seconds = 0.0; // gaze dwell, timer delay
    double coneDeg = 12.0;
    double maxM = 30.0;
    bool lookAt = false;  // gaze by the targeting system's look-at instead of the cone
    bool on = true;       // weapon, combat, vehicle: the edge
    std::optional<bool> now; // fire at once when it already holds on the first sample (default: true except for leave)
    std::string caption;  // interact, choice: part of the caption
    std::optional<int32_t> index; // choice
    double clockSeconds = -1.0;   // clock: the mark as seconds of the day
    double expiresS = 600.0;
    bool repeat = false;
    double cooldownS = 2.0;
    double hz = 10.0;
    std::vector<MicroAction> actions;
};
// aActionCheck answers a refusal for a micro-action's method (not allowed, unknown), or "" when it may run.
using ActionCheck = std::function<std::string(const std::string& aMethod)>;
WatchSpec ParseWatch(const json& aParams, const ActionCheck& aCheck);
json WatchSpecJson(const WatchSpec& aSpec);

// What a sample must read for the armed watchers and the phone call.
struct SampleWants
{
    bool lookAt = false;
    bool events = false; // the game's interaction and dialogue-choice events (the script listens only while this is asked)
    std::vector<std::string> entities;
    bool occlusion = false;
    std::string callContact; // the contact of the call ringing or running: its fact is read
};

// One reading of the game (the redscript layer's XFDmSense.Sample; the self-test host's simulated V).
struct Sample
{
    bool valid = false; // V in the world
    std::array<double, 3> v{};
    double yaw = 0.0;
    std::array<double, 3> camPos{}, camFwd{0, 1, 0};
    std::string lookAt; // an entity id, or ""
    bool combat = false, weapon = false, vehicle = false;
    double tod = -1.0; // game time of day in seconds
    int32_t callFact = -1; // phonecall_<contact>_with_player: 0 ended, 1 ringing, 2 talking, 3 declined; -1 not read
    std::map<std::string, std::array<double, 3>> entities;
    std::map<std::string, bool> visible; // occlusion checks where asked
    std::map<std::string, std::string> ids; // a requested key (spawn:<n>) to its entity id
    std::vector<json> events;
};
Sample SampleFromJson(const json& aValue);

struct Fired
{
    std::string id;
    WatchKind kind = WatchKind::Timer;
    json detail;
    std::vector<MicroAction> actions;
    bool expired = false;
};

class WatcherEngine
{
public:
    // Throws MethodError too_many (kMaxWatchers); an armed id is replaced (the earlier one is dropped).
    std::string Arm(WatchSpec aSpec, double aNow);
    bool Disarm(const std::string& aId);
    size_t DisarmAll();
    bool Empty() const;
    size_t Count() const;
    json List(double aNow) const;
    SampleWants Wants() const;
    // Seconds between samples the armed watchers need (the fastest one's), or 0 when none needs samples (timers only).
    double Interval() const;
    bool NeedsSamples() const;
    // Timers and expiry without a sample.
    std::vector<Fired> Advance(double aNow);
    // One sample: every watcher's condition, dwell, edges and cooldowns; fired and expired ones.
    std::vector<Fired> Evaluate(const Sample& aSample, double aNow);
    // Drops every watcher whose id starts with aPrefix (a quest's area links).
    size_t DisarmPrefix(const std::string& aPrefix);

private:
    struct Armed
    {
        WatchSpec spec;
        double armedAt = 0.0;
        double lastFired = -1e9;
        bool first = true;
        bool previous = false;
        bool seenInside = false;
        double dwell = 0.0;
        double lastSampleAt = -1.0;
        double lastTod = -1.0;
        int fires = 0;
    };
    bool Condition(Armed& aArmed, const Sample& aSample, double aNow, json& aDetail) const;
    std::vector<Armed> m_armed;
    uint32_t m_next = 1;
};

// ---- micro-actions ------------------------------------------------------------------------------------------------------

// Methods a micro-action may never call, whatever their class: saving, loading, the kill switch, handing over, and the
// creator's leave buttons. Everything else must also be allowed by its access class (read, notify, write-world, write-dm,
// write-player, write-photo, write-showroom; the plugin checks each against the dispatcher's list).
bool MicroMethodDenied(const std::string& aMethod);
bool MicroAccessAllowed(const std::string& aAccessName);

struct MicroBatch
{
    std::string watch;
    std::string sessionToken; // captured when enqueued, never borrowed from a later session
    uint64_t seq = 0;
    std::vector<MicroAction> actions;
};

// ---- timed subtitle lines -----------------------------------------------------------------------------------------------

struct TimedLine
{
    uint64_t id = 0; // the line's number (the script builds its CRUID from it)
    std::string owner; // "notify:<n>" or "call:<n>"
    std::string speaker, text;
    int32_t type = 1; // scnDialogLineType: 1 Regular, 2 Holocall, 9 OwnerlessRegular
    double start = 0.0, end = 0.0;
    bool shown = false;
    CleanupRetry hideRetry;
};

// ---- the session ---------------------------------------------------------------------------------------------------------

// The game steps a session needs, all called on the game thread (the plugin: the redscript layer; the self-test host: its
// simulation). Any may throw; the session logs and goes on, except the call's ring, whose refusal is the caller's.
struct SessionOps
{
    std::function<json(const SampleWants&)> sample;
    std::function<void(const TimedLine&)> showLine;
    std::function<void(uint64_t aLineId)> hideLine;
    // The phone call (PhoneSystem's requests): the incoming ring from a journal contact, the call's start once the player has
    // answered, and its end (also a ring withdrawn). aMode is audio or video.
    std::function<void(const std::string& aContact, const std::string& aMode, bool aRejectable)> callRing;
    std::function<void(const std::string& aContact, const std::string& aMode)> callStart;
    // False means queued, not yet acknowledged; ownership must be retained.
    std::function<bool(const std::string& aContact)> callEnd;
    // The quest tracker: the quest to show (title and lines: text, state, optional), or none.
    std::function<void(const std::vector<Quest>& aQuests)> tracker;
    std::function<void(int32_t aHandle, double aIntensity)> lightIntensity;
    std::function<void(const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData)> event;
    std::function<void(MicroBatch)> micro;
};

struct PhoneCall
{
    uint32_t id = 0;
    std::string contact;
    std::string mode = "audio";
    std::vector<CallLine> lines;
    std::string state = "none"; // ringing, answered, declined, missed, ended, cancelled, hung_up, failed
    std::string endState; // terminal state after an acknowledged end; state is "ending" meanwhile
    CleanupRetry endRetry;
    double ringUntil = 0.0, endsAt = 0.0, startedAt = 0.0;
    bool sawRing = false, sawTalk = false;
};
struct PhoneText
{
    uint32_t id = 0;
    std::string contact, text;
    double sentAt = 0.0;
};

class Session
{
public:
    explicit Session(SessionOps aOps);

    // The tick (the plugin's Running update, the self-test's pump): samples for watchers and the call at their rate, moves
    // the phone, shows and hides timed lines, drives light patterns. aNow is steady seconds.
    void Tick(double aNow);
    // Whether the tick has anything to do (demand: armed watchers, a call, lines, animated lights).
    bool Busy() const;
    bool CleanupPending() const;

    // Watchers.
    json Arm(const WatchSpec& aSpec, double aNow);
    json Disarm(const std::string& aId, bool aAll);
    json WatchList(double aNow) const;
    WatcherEngine& Watchers();

    // Timed lines (notify.show subtitle): answers the line id; hidden after seconds.
    uint64_t ShowLine(const std::string& aOwner, const std::string& aSpeaker, const std::string& aText, int32_t aType, double aSeconds, double aNow);
    bool HideLines(const std::string& aOwner);
    // Hides every timed line whose owner starts with aPrefix (the notify.show subtitles, not a call's).
    bool HideLinesPrefix(const std::string& aPrefix);
    size_t HideAllLines();

    // The phone.
    json Call(const CallRequest& aRequest, double aNow);
    json EndCall(double aNow, const std::string& aWhy);
    json Text(const TextRequest& aRequest, double aNow);
    json PhoneState(double aNow) const;
    bool CallLive() const;

    // Quests (journal-free: the tracker shows them; nothing reaches the journal or a save).
    json QuestSet(const QuestSetRequest& aRequest, double aNow);
    json QuestObjective(const ObjectiveRequest& aRequest, double aNow);
    json QuestClear(const std::string& aId, bool aAll, double aNow);
    json QuestState() const;
    size_t QuestCount() const;

    // Animated lights (their pattern driven by the tick): registered after light.spawn / light.set.
    void AnimateLight(int32_t aHandle, double aBaseIntensity, const LightPattern& aPattern, double aNow);
    void ForgetLight(int32_t aHandle);
    std::optional<LightPattern> LightPatternOf(int32_t aHandle) const;
    size_t AnimatedLights() const;

    // The kill switch, a detach (a load) or a handover's end: everything forgotten; the UI taken down through the ops
    // (lines hidden, the call ended, the tracker restored). aUi false for a detach (no game calls then).
    json Reset(bool aUi);

    // For game.digest: watchers, the phone, quests (small).
    json Digest(double aNow) const;
    uint64_t NextLineId();

private:
    void Report(const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData);
    void Fire(const std::vector<Fired>& aFired, const Sample* aSample, double aNow);
    json RenderTracker();
    std::set<std::string> m_drawnFinal; // quest/objective/state keys already drawn as finished (the tracker plays that once)
    void StartCallLines(double aNow);
    void ArmQuestAreas(const Quest& aQuest, double aNow);
    void TickCall(const Sample& aSample, double aNow);
    std::string FinishCall(const std::string& aState, bool aExplicit = false);
    bool HideLine(TimedLine& aLine, bool aExplicit);

    SessionOps m_ops;
    WatcherEngine m_watchers;
    std::deque<TimedLine> m_lines;
    std::map<std::string, Quest> m_quests;
    std::vector<std::string> m_questOrder;
    PhoneCall m_call;
    std::vector<PhoneText> m_texts;
    struct Animated
    {
        double base = 0.0;
        LightPattern pattern;
        double start = 0.0;
        double last = -1.0;
    };
    std::map<int32_t, Animated> m_animated;
    double m_lastSample = -1e9;
    double m_lastLight = -1e9;
    uint64_t m_batchSeq = 0;
    uint64_t m_lineCounter = 0;
    uint32_t m_phoneCounter = 0;
    double m_now = 0.0;
};

// ---- game.digest --------------------------------------------------------------------------------------------------------

struct DigestRequest
{
    size_t events = 8;
    std::vector<std::string> kinds; // empty: the default kinds
    bool sky = true;
};
DigestRequest ParseDigest(const json& aParams);
const std::vector<std::string>& DefaultDigestKinds();
// The HP band from a health percentage: full (>= 95), high (>= 60), mid (>= 30), low (>= 10), critical.
std::string HpBand(double aPercent);
} // namespace xfb::dm
