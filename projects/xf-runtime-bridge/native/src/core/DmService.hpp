#pragma once

// Bridge 0.8.12: the live-direction toolkit's commands (research/runtime/runtime-bridge-design.md §3.21). Game-independent: the
// parameter checks (core/Dm080), the refusal order, the registry of what the bridge brought in (spawned props, vehicles and
// lights, sounds, the doors, vehicles and radios it changed), the undo each write answers with, the events the tick raises,
// and the one release step shared by the kill switch, the pause, a handover and a load. The plugin (plugin/HandlersDm080.cpp)
// fills Ops with calls into the redscript layer (redscript-dm/XFRuntimeBridgeDm.reds, class XFDm*); the self-test host
// (selftest/SimDm080.cpp) with a simulated world; the unit tests with fakes.
//
// Every command is in the dm class (write-dm), listed only by the test profile's -writes build; the reads (world.spawned,
// quest.state, phone.state, watch.list, game.digest) change nothing.
//
// Threads: every method and the tick run on the game thread (RunOn::GameThread), so the
// game steps (Ops) are direct calls. The write gate (bridge 0.8.1, RB-122): each write is one game-thread step the dispatcher
// checks against the kill switch, the pause and a handover right before it runs. The tick's forward steps (lines shown, the
// call started, the tracker drawn, a light's pattern) check TickInput::writesOpen first; its put-back steps (everything
// released) run whatever the gate says. A handover releases everything in its own request (ReleaseAllNow), the pause on the
// next tick, the kill switch in its restore (RestoreAfterKill), a load by forgetting (DropAll: the world takes the entities).

#include <array>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/Dispatcher.hpp"
#include "core/Dm080.hpp"

namespace xfb
{
class EventLog;
}

namespace xfb::dm
{
using Vec3 = std::array<double, 3>;

// ---- the game steps ----------------------------------------------------------------------------------------------------

struct SpawnStep
{
    std::string kind; // prop or vehicle
    std::string templatePath, record, appearance, label;
    Vec3 at{};
    double yaw = 0.0;
    bool ground = true;
    int32_t handle = 0;
};
struct DoorStep
{
    std::string target;
    std::optional<bool> open, locked, sealed;
};
struct VehicleStep
{
    std::string target;
    std::optional<bool> lights, engine;
    std::string door, doorState;
};
struct RadioStep
{
    std::string target;
    std::optional<int32_t> station;
    std::optional<bool> on;
};
struct LightStep
{
    int32_t handle = 0;
    std::string templatePath, label;
    Vec3 at{};
    double yaw = 0.0;
    std::array<int32_t, 3> colour{255, 244, 229};
    double intensity = 100.0;
    double radius = 8.0;
    std::optional<double> inner, outer;
};
struct LightSetStep
{
    std::string entity;
    std::optional<std::array<int32_t, 3>> colour;
    std::optional<double> intensity, radius, inner, outer;
    std::optional<bool> on;
    // The engine's own flicker (SetFlickerParams): strength 0 puts it out.
    std::optional<double> flickerStrength;
    double flickerPeriod = 1.0;
    double fadeS = 0.0;
};

// What the service needs from the game. Every step throws MethodError to refuse (nothing changed) or fail.
struct Ops
{
    // V now: {phase, position: [x, y, z], yaw, head?, camera?, busy, busy_state} (the NPC layer's XFNpcV.Where).
    std::function<json()> v;
    // A prop or vehicle brought in (never saved): {entity (decimal id), position, yaw, grounded}. Refuses codeware_missing,
    // not_ready, record_missing, template_missing, spawn_refused, not_streamed.
    std::function<json(const SpawnStep&)> spawn;
    // Removes something the bridge brought in: {despawned}. Never refuses for an entity that is gone already.
    std::function<json(const std::string& aEntity)> despawn;
    // A door: {target_id, before: {open, locked, sealed}, after: {...}}. Refuses not_a_door, target_missing.
    std::function<json(const DoorStep&)> door;
    // A vehicle: {target_id, before: {engine, doors: {name: state}}}. Refuses not_a_vehicle, target_missing.
    std::function<json(const VehicleStep&)> vehicle;
    // A sound event on V, the world, what V looks at or an entity: {on_id}.
    std::function<json(const std::string& aEvent, const std::string& aOn, const std::string& aEmitter)> audioPlay;
    std::function<json(const std::string& aEvent, const std::string& aOn, const std::string& aEmitter)> audioStop;
    // A radio device or vehicle: {target_id, before: {station, on}}. Refuses no_radio, target_missing.
    std::function<json(const RadioStep&)> radio;
    // A voiceset line from an NPC: {target_id}. Refuses not_an_npc, target_missing.
    std::function<json(const std::string& aTarget, const std::string& aContext)> voice;
    // A light brought in: {entity, components}. Refuses codeware_missing, carrier_missing, template_missing, no_light_component.
    std::function<json(const LightStep&)> lightSpawn;
    // A light's setting: {before: {colour, intensity, radius, inner, outer, on}}. Refuses target_missing, no_light_component.
    std::function<json(const LightSetStep&)> lightSet;
    // The game's own message surfaces: {shown}. Refuses hud_missing.
    std::function<json(const NotifyRequest&)> notify;
    std::function<json(const std::string& aStyle)> notifyHide; // "" hides every banner and centred message
    // A message toast from a name: {shown}. Refuses hud_missing.
    std::function<json(const std::string& aContact, const std::string& aText)> phoneText;
    // The journal's contacts: {contacts: [{id, name}], calling: bool, reason}.
    std::function<json()> phoneContacts;
    // The reading for the watchers and the call: aEntities maps a key to an entity id (spawn:<n> resolved by the service).
    std::function<json(const SampleWants&, const std::map<std::string, std::string>& aEntities)> sample;
    // Entity existence only: must never change subscriptions or consume watcher events.
    std::function<json(const std::map<std::string, std::string>&)> presence;
    std::function<void(const TimedLine&)> showLine;
    std::function<void(uint64_t aLineId)> hideLine;
    std::function<void(const std::string& aContact, const std::string& aMode, bool aRejectable)> callRing;
    std::function<void(const std::string& aContact, const std::string& aMode)> callStart;
    std::function<bool(const std::string& aContact)> callEnd;
    std::function<void(const std::vector<Quest>& aQuests)> tracker;
    std::function<void(const std::string& aEntity, double aIntensity)> lightIntensity;
    // Everything the script holds, in one step (the kill switch, a pause, a handover): {released: n, ...}. Idempotent.
    std::function<json(const std::string& aReason, int32_t aRemovedBefore)> releaseAll;
    // game.digest's game part: {v: {...}, world: {...}}.
    std::function<json(bool aSky)> digest;
    // The watchers' micro-actions (the host's runner), and the check of one action's method.
    std::function<void(MicroBatch)> micro;
    std::function<size_t(const std::string& aWhy)> microCancel;
    std::function<size_t(const std::string& aWatch)> microCancelWatch;
    std::function<size_t()> microPending;
    std::function<std::string(const std::string& aMethod)> actionCheck;
};

// Where the dispatcher and the script gate stand, for the tick.
struct TickInput
{
    bool gateOpen = true;    // the game's scripts may be called now
    bool killed = false;     // the kill switch fired (the restore releases; the tick only stops)
    bool paused = false;     // the panel's pause
    bool handedOver = false; // session.handover
    uint64_t detaches = 0;   // the script layer's detaches so far (a change is a load: everything is dropped)
    // RB-122: checked right before the tick's forward steps; false skips them. Unset: open.
    std::function<bool()> writesOpen;
};

// ---- the service -------------------------------------------------------------------------------------------------------

class Service
{
public:
    using OpsFor = std::function<Ops(const std::string& aCid)>;

    explicit Service(OpsFor aOpsFor = {});
    void SetOpsFor(OpsFor aOpsFor);
    // The game steps for one request's correlation id (the registered methods call this).
    Ops OpsForCid(const std::string& aCid) const;
    void SetEvents(EventLog* aEvents);

    json Spawn(const json& aParams, const Ops& aOps);
    json Despawn(const json& aParams, const Ops& aOps);
    json Spawned(const json& aParams, const Ops& aOps);
    json Present(const Ops& aOps) const;
    json Door(const json& aParams, const Ops& aOps);
    json Vehicle(const json& aParams, const Ops& aOps);
    json AudioPlay(const json& aParams, const Ops& aOps);
    json AudioStop(const json& aParams, const Ops& aOps);
    json AudioRadio(const json& aParams, const Ops& aOps);
    json AudioVoice(const json& aParams, const Ops& aOps);
    json PhoneTextSend(const json& aParams, const Ops& aOps);
    json PhoneCallStart(const json& aParams, const Ops& aOps);
    json PhoneEnd(const json& aParams, const Ops& aOps);
    json PhoneState(const json& aParams, const Ops& aOps);
    json QuestSet(const json& aParams, const Ops& aOps);
    json QuestObjective(const json& aParams, const Ops& aOps);
    json QuestClear(const json& aParams, const Ops& aOps);
    json QuestState(const json& aParams, const Ops& aOps);
    json NotifyShow(const json& aParams, const Ops& aOps);
    json NotifyHide(const json& aParams, const Ops& aOps);
    json LightSpawn(const json& aParams, const Ops& aOps);
    json LightSet(const json& aParams, const Ops& aOps);
    json LightRemove(const json& aParams, const Ops& aOps);
    json WatchArm(const json& aParams, const Ops& aOps);
    json WatchDisarm(const json& aParams, const Ops& aOps);
    json WatchList(const json& aParams, const Ops& aOps);
    json GameDigest(const json& aParams, const Ops& aOps);

    // Game thread, every tick: the session (watchers, the call, timed lines, light patterns) while writes are open, and the
    // release of everything on a pause or a handover. A change in detaches forgets everything (a load).
    void Tick(double aDt, const TickInput& aInput);
    // The kill switch's restore (game thread): one releaseAll step, the bookkeeping cleared, the doors, vehicles and radios put
    // back. Nothing when nothing is held.
    json RestoreAfterKill(const Ops& aOps);
    // A load or a detach: forgets everything without a game call (the world takes the entities).
    void DropAll(const std::string& aReason);
    // A handover (on the game thread once its flag is set): everything released at once; {released: [...], ...}. Nothing when
    // nothing is held.
    json ReleaseAllNow(const std::string& aReason, const Ops& aOps);

    // Whether anything is held (spawned things, changes, a call, lines, quests, watchers, lights, sounds).
    bool Active() const;
    // What a save would keep, as plain names (game.save refuses while this isn't empty).
    json Holds() const;

    Session& SessionForTest(const Ops& aOps);

private:
    struct Item
    {
        int32_t handle = 0;
        std::string kind; // prop, vehicle, light
        std::string entity;
        std::string templatePath, record, appearance, label;
        Vec3 position{};
        double yaw = 0.0;
        // lights: the settings last asked for, for the undo of a removal.
        std::array<int32_t, 3> colour{255, 244, 229};
        double intensity = 0.0, radius = 0.0;
        std::optional<double> inner, outer;
        bool on = true;
        bool pending = false;
        double configureUntil = 0.0;
        std::string error;
        LightPattern pattern; // what runs now (steady, the engine's flicker or one the tick drives), for the undo
    };
    struct Sound
    {
        int32_t id = 0;
        std::string event, on, onId, emitter;
        bool loop = false;
        double endsAt = 0.0;
    };
    // The first state a door, vehicle or radio had before the bridge changed it (put back by the release).
    struct Change
    {
        std::string kind; // door, vehicle, radio
        std::string targetId;
        json original = json::object();
        json current = json::object(); // what the asked changes have made of it, as far as the bridge can tell
        bool dormant = false; // only a load-only hold remains; never schedule cleanup for it
        bool sticky = false;           // a change the bridge cannot read back (a vehicle door's lock): kept until a load
    };

    void Emit(const std::string& aKind, const std::string& aLevel, const std::string& aText, json aData);
    Session& SessionFor(const Ops& aOps);
    SessionOps MakeSessionOps(const Ops& aOps);
    // Remembers the host's tick-time steps once, so the tick can release what a command brought in before any session exists.
    void NoteOps(const Ops& aOps);
    // The refusal order's step 2: the game has a world V is in (normal play).
    json RequireWorld(const Ops& aOps);
    // The target as the script resolves it: spawn:<n> to the entity id; anything else as given.
    std::string ResolveTarget(const std::string& aTarget) const;
    Item* FindItem(int32_t aHandle);
    size_t CountItems(const std::string& aKind) const;
    // Remembers the first state seen, applies what was asked to the current state, and forgets the entry again once the current
    // state equals the original (a change undone by hand needs no put-back and no longer holds a save).
    void RememberChange(const std::string& aKind, const std::string& aTargetId, const json& aBefore, const std::string& aKey, const json& aAsked, bool aSticky);
    // Puts every changed door, vehicle and radio back and takes everything the script holds down; never throws.
    bool NeedsCleanup() const;
    json ReleaseEverything(const std::string& aReason, const Ops& aOps, bool aUi);
    json ItemJson(const Item& aItem) const;
    double Now() const;

    mutable std::recursive_mutex m_mutex;
    OpsFor m_opsFor;
    Ops m_tickOps;
    bool m_tickOpsBuilt = false;
    std::unique_ptr<Session> m_session;
    std::map<int32_t, Item> m_items;
    std::map<int32_t, Sound> m_sounds;
    std::map<std::string, Change> m_changes;
    bool m_notifications = false;
    bool m_cleanupPending = false;
    bool m_releaseRequested = false;
    CleanupRetry m_releaseRetry;
    std::map<std::string, json> m_releaseReceipts; // bounded reasons; consumed by explicit handover/kill, cleared by new work/load
    EventLog* m_events = nullptr;
    int32_t m_nextHandle = 1;
    int32_t m_nextSound = 1;
    int32_t m_nextNotify = 1;
    double m_clock = 0.0;
    uint64_t m_detaches = 0;
    bool m_detachesKnown = false;
};

// Registers world.spawn ... game.digest on a dispatcher with their access classes and threads, for the plugin and the self-test
// host alike: aMarkWrite wraps a write (the plugin's MarkedWrite: the kill switch's restore is owed after it, and write.done
// is logged with its undo).
void RegisterMethods(Dispatcher& aDispatcher, Service& aService, std::function<MethodSpec(MethodSpec)> aMarkWrite);
} // namespace xfb::dm
