#pragma once

// Bridge 0.8: NPC direction (research/runtime/npc-direction-design.md; knowledge/npc-direction.md). Game-independent: the
// parameter checks, the refusal order, the session's actors and picks, the undo each write answers with, the events the
// tick raises (arrived, said, choice, released, ...), and the one stop step shared by release, the kill switch, a pause, a
// handover and a load. The plugin (plugin/HandlersNpc.cpp) fills Ops with calls into the redscript layer
// (redscript/XFRuntimeBridgeNpc.reds); the self-test host (selftest/SimNpc.cpp) with a simulated street; the unit tests
// with fakes.
//
//   npc.list (read)       NPCs near V: record, crowd, protected with reasons, busy, ours
//   npc.pick (read)       adopts an unprotected NPC for look, face and say (a handle p1, p2, ...)
//   npc.status (read)     the session's actors, picks, lines, hub and what each holds
//   npc.spawn             an XF actor (TweakXL clone of a vanilla civilian) through Codeware, never persistent (a1, a2, a3)
//   npc.move / follow / turn / place / stop   AI commands on our own actors
//   npc.say               a text line (subtitle, overhead, holocall) and/or a vanilla voiceset trigger
//   npc.look / face / act gaze, facial reaction, body gesture (the XF gesture carrier)
//   npc.choices           a dialogue hub in the game's own widget; the pick arrives as an npc.choice event (session.wait)
//   npc.release           ends an actor (despawn, walk_away, dissolve) or a pick (leave)
// Every write is in the npc class (write-npc), listed only by the test profile's -writes build.
//
// The Story Engine's staging needs (research/story-engine/runtime-requirements.md): V15, an actor that can be killed and
// that is hostile (or neutral) to V, handed back to its own AI when a fight starts instead of being removed; V16, a spawn at a
// walkable spot out of V's sight (outside the camera's view, or behind static geometry) and a release that despawns only
// once the actor is out of sight ("dissolve").
//
// Threads: every method and the tick run on the game thread (RunOn::GameThread; the plugin's Running update), so the game
// steps (Ops) are direct calls that never wait for another thread. The (recursive) mutex guards the bookkeeping for
// readers on other threads; a game step may run while it is held.
//
// The write gate (bridge 0.8.1, RB-122): each npc write is one game-thread step, which the dispatcher checks against the kill
// switch, the pause and a handover on the game thread right before it runs (the check Dispatcher::RunWrite makes for each
// step of a multi-step write). The tick's own forward step (a held facing turning again) checks TickInput::writesOpen right
// before it runs; its put-back steps (lines hidden, a hub withdrawn, a walk stopped, a release) run inside a RestoreScope
// whatever the gate says. A handover releases everything in its own request (Service::ReleaseAllNow), the pause on the next
// tick, the kill switch in its restore (RestoreAfterKill).

#include <array>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/Dispatcher.hpp"

namespace xfb
{
class EventLog;
}

namespace xfb::npc
{
using json = nlohmann::json;
using Vec3 = std::array<double, 3>;

inline constexpr size_t kMaxActors = 3;
inline constexpr size_t kMaxPicks = 4;
inline constexpr double kMaxRangeM = 30.0;       // spawn, move and place targets: within this of V
inline constexpr double kListDefaultM = 15.0;
inline constexpr double kListMaxM = 40.0;
inline constexpr size_t kMaxLineChars = 200;      // npc.say's text, in characters
inline constexpr size_t kMaxChoiceChars = 90;     // one choice's text
inline constexpr size_t kMaxTitleChars = 40;      // the hub's title (the speaker's name)
inline constexpr double kHubRangeM = 4.0;         // npc.choices: V within this of the speaker when it shows
inline constexpr double kHubLeaveM = 8.0;         // ... and it is withdrawn when V walks further than this
inline constexpr double kPollSeconds = 0.25;      // the tick reads the game four times a second while anything is held
inline constexpr double kMoveMaxS = 60.0;
inline constexpr double kFollowMaxS = 300.0;
inline constexpr double kChoicesMaxS = 120.0;
inline constexpr double kWalkAwayM = 15.0;        // release walk_away: this far from V, then despawned
inline constexpr double kWalkAwayMaxS = 20.0;
inline constexpr double kArriveSlackM = 0.6;      // arrival by distance: within stop_m plus this (AMM's Director: < 1 m)
inline constexpr int32_t kHubIdBase = 58460000;    // the dialogue hub ids the bridge uses ("XF" 0x58 0x46)
inline constexpr double kFacingToleranceDeg = 25.0; // a held facing is turned back when it drifts further than this
inline constexpr double kTurnedToleranceDeg = 15.0; // a turn has arrived (npc.turned) within this of its goal
inline constexpr double kFacingReissueS = 1.0;      // a held facing re-turns at most once a second
// 0.8.11 (session 17's N3: the smile did not show): a held face is sent again, since nothing says the first send took (an actor
// still loading its animation graph, a graph that dropped it): after 0.8 s, after 2.5 s more, then every 5 s.
inline constexpr double kFaceFirstS = 0.8;
inline constexpr double kFaceSecondS = 2.5;
inline constexpr double kFaceSteadyS = 5.0;
inline constexpr double kBlockedAfterS = 4.0;       // a walk that gains less than kProgressM for this long is blocked
inline constexpr double kProgressM = 0.3;
// V16: an out-of-sight spawn (npc.spawn at "out_of_sight") and the dissolve release.
inline constexpr double kHiddenMinM = 12.0;    // default nearest distance from V
inline constexpr double kHiddenMaxM = 25.0;    // default farthest (at most kMaxRangeM)
inline constexpr double kViewMarginDeg = 10.0; // a spot this close outside the view still counts as in view
inline constexpr size_t kMaxHiddenProbes = 24; // ground probes an out-of-sight spawn may make before it gives up
inline constexpr double kDissolveM = 15.0;     // dissolve: despawned only this far from V (and out of sight)
inline constexpr double kDissolveWalkM = 20.0; // dissolve with walk: it walks off to this far from V
// 0.8.10 (session 16's N3 and N5: she walked backwards away from V): a walk whose way lies further than this from the actor's
// facing begins with a turn on the spot (the game's own walks do; the move command alone left her facing V).
inline constexpr double kTurnFirstDeg = 80.0;
inline constexpr double kTurnFirstMaxS = 3.0; // then the walk starts anyway
// 0.8.10: a spawn that was asked for relative to V (ahead_m, side_m) needs a sight line from her head, else the nearest spot that has one.
inline constexpr double kSightEyeM = 1.6;
inline constexpr double kSightChestM = 1.2;
inline constexpr double kSightSearchM = 4.0; // how far from the asked spot the search for a visible one may go
inline constexpr size_t kMaxSightProbes = 30; // ground probes that search may make

// --- the tables -------------------------------------------------------------------------------------

// An XF actor: our TweakXL clone of a base-game civilian (tweaks/test-profile/xf_npc_actors.yaml), never a named character or
// a Phantom Liberty template (design §10 decision 2). research casts exist only for the session-9 comparison (N4).
struct Cast
{
    std::string name;   // what npc.spawn's cast names
    std::string record; // Character.xfs_actor_<name>, or the vanilla crowd record for research_crowd
    std::string rig;    // woman_average or man_average: which gesture clips play
    std::string label;  // a plain default speaker name for subtitles and the hub title
    bool research = false;
    // Appearances (the entity template's appearance names) npc.spawn uses by default, in order (variant picks one); empty:
    // the game picks. masked: every one of them covers the mouth (a respirator or a kerchief), for text lines without
    // lip sync (the live-DM casting data).
    std::vector<std::string> appearances;
    bool masked = false;
};
// V15: the record with the game's own reactions for a cast (reactions "game"): Character.xfs_actor_<cast>_reactive, the same
// clone with the base civilian's reaction preset (tweaks/test-profile/xf_npc_actors.yaml); "" for the research casts.
std::string ReactiveRecord(const Cast& aCast);
const std::vector<Cast>& Casts();
const Cast* FindCast(const std::string& aName);

struct Expression
{
    std::string name;
    int32_t category = 0;
    int32_t idle = 0;
};
// AnimFeature_FacialReaction pairs (AMM init.lua:2832-2857 [source]); "off" is category 0, idle 0 (the game's reset).
const std::vector<Expression>& Expressions();
const Expression* FindExpression(const std::string& aName);

// Vanilla voiceset triggers npc.say may play in the NPC's own voice (allow-listed; the words are the voice's own).
const std::vector<std::string>& VoiceTriggers();

struct Gesture
{
    std::string name;
    std::string clipWoman; // the clip SendJumpToAnimEnt jumps to on woman_average
    std::string clipMan;   // ... on man_average
    double seconds = 3.0;  // how long it plays before npc.act_done (the workspot is left then)
};
// The XF gesture carrier's list. The carrier itself (a workspot entity built with WolvenKit) isn't built yet, so npc.act answers
// carrier_missing in the game until a -writes package is made with --npc-carrier <archive>.
const std::vector<Gesture>& Gestures();
const Gesture* FindGesture(const std::string& aName);

// npc.say's styles: the scnDialogLineType each draws with (orphans.script:7396-7410 [source]). ownerless (OwnerlessRegular)
// is the one type the subtitle controller shows without a speaker entity (baseSubtitlesControllers.script:523-533), so it
// carries a voice with no body; holocall and subtitle need a speaker, and a voice line gives them V as the carrier.
int32_t StyleLineType(const std::string& aStyle); // -1 for an unknown style
// The difference between two yaws in degrees, in [-180, 180].
double YawDifference(double aA, double aB);

// V's camera as the game reports it (XFNpcV.Where, XFNpc.Poll: GetActiveCameraWorldTransform, Forward, FOV, AspectRatio).
struct Camera
{
    bool known = false;
    Vec3 position{};
    Vec3 forward{0.0, 1.0, 0.0};
    double fov = 60.0;
    double aspect = 16.0 / 9.0;
};
// From {camera: {position, forward, fov, aspect}}; known false without one.
Camera CameraFrom(const json& aReading);
// Whether a point is in the camera's view, widened by aMarginDeg. Which axis the game's fov measures isn't settled
// (tools/scene/camera.ts), so the wider reading counts: the horizontal half-angle is the larger of fov / 2 and the angle a
// vertical fov gives at the aspect; vertically, the fov / 2 or the narrower reading's, whichever is larger. An unknown camera
// sees everything (nothing counts as hidden from it).
bool InView(const Camera& aCamera, const Vec3& aPoint, double aMarginDeg);
// Spots to try for an out-of-sight spawn, best first: behind the camera, then round to the sides, never inside the view (with
// the margin), at aMin, the middle and aMax metres from V.
std::vector<Vec3> HiddenCandidates(const Vec3& aV, const Camera& aCamera, double aMin, double aMax);

// --- targets -------------------------------------------------------------------------------------------

// Where a command points: V, one of the session's NPCs (a handle), a world point, or (spawn) an offset from V.
struct Target
{
    enum class Kind
    {
        None,
        V,
        Who,
        Point,
        Offset
    };
    Kind kind = Kind::None;
    std::string who;
    Vec3 point{};
    double ahead = 0.0; // Offset: metres along V's facing
    double side = 0.0;  // Offset: metres to V's right (negative: left)
};
// "v", a handle ("a1", "p2"), [x, y, z] or (allowOffset) {ahead_m, side_m}. Throws bad_params.
Target ParseTarget(const json& aValue, const std::string& aKey, bool aAllowOffset);
json TargetJson(const Target& aTarget);
const char* TargetKindName(Target::Kind aKind);

// The world point aAhead metres along a facing of aYaw degrees (the game's yaw: 0 faces +Y, 90 faces -X) and aSide metres to
// its right, from aFrom. Z stays aFrom's.
Vec3 OffsetPoint(const Vec3& aFrom, double aYaw, double aAhead, double aSide);
double Distance(const Vec3& aA, const Vec3& aB);
double HorizontalDistance(const Vec3& aA, const Vec3& aB);
// The number of Unicode characters in UTF-8 text (invalid bytes count one each).
size_t CountChars(const std::string& aText);

// --- the game steps --------------------------------------------------------------------------------------

// A command for an actor's AI (AIMoveToCommand, AIFollowTargetCommand, AIRotateToCommand, AITeleportCommand, or a stop).
struct Command
{
    std::string kind; // move, follow, turn, place, stop
    Target target;    // move/follow/turn: where; place: a point
    int32_t gait = 0; // moveMovementType: 0 Walk, 1 Run, 2 Sprint
    double distance = 1.6; // move: desiredDistanceFromTarget; follow: desiredDistance
    double yaw = 0.0;      // place: the facing (hasYaw)
    bool hasYaw = false;
    bool faceV = false;    // move: V as the facing target (0.8.11: off unless asked; the engine keeps it after the move ends)
};

struct Line
{
    int32_t number = 0;   // the line's id (l<number>); the script builds its CRUID from it
    bool voice = false;   // a voice with no body (no NPC; npc.say without who): no speaker entity of its own
    std::string text;     // "" for a trigger only
    std::string trigger;  // "" for text only
    std::string style = "subtitle";
    std::string speaker;  // the speaker's name under a subtitle
    double seconds = 4.0;
};

struct Hub
{
    int32_t id = 0;
    std::string who;
    std::string title;
    std::vector<std::string> choices;
};

// What the service needs from the game. Every step throws MethodError to refuse (nothing changed) or fail.
struct Ops
{
    // V now: {position: [x, y, z], yaw, busy: "" or a refusal code (in_combat, in_vehicle, in_scene, not_v, player_busy),
    //  busy_state, phase}.
    std::function<json()> v;
    // NPCs within aRadius of V (at most aMax): {npcs: [{id, record, class, distance, position, crowd, protected, reasons, busy,
    //  dead}], found}.
    std::function<json(double aRadius, int32_t aMax)> list;
    // Adopts the NPC with entity id aId under the handle aWho: {record, class, crowd, position} or refuses npc_protected (with
    // the reasons in the message), npc_busy, too_far, npc_not_found.
    std::function<json(const std::string& aWho, const std::string& aId)> pick;
    // Spawns aRecord at aAt facing aYaw under the handle aWho, snapped to walkable ground, non-persistent, tagged:
    // {entity, position}. aAttitude (V15): 0 friendly, 1 neutral, 2 hostile towards V; aImmortal: god mode (today's default).
    // Both apply when the actor first exists. Refuses codeware_missing, record_missing, not_walkable, not_streamed, too_far.
    std::function<json(const std::string& aWho, const std::string& aRecord, const Vec3& aAt, double aYaw, const std::string& aAppearance, bool aOutOfView,
                       int32_t aAttitude, bool aImmortal)>
        spawn;
    // V16: walkable ground near a point (within 2 m, human navmesh): {walkable, point, streamed}. Never refuses.
    std::function<json(const Vec3& aPoint)> ground;
    // V16: whether static geometry blocks the straight line between two points: {blocked}. Never refuses.
    std::function<json(const Vec3& aFrom, const Vec3& aTo)> ray;
    // Sends (or, kind stop, cancels) an AI command on an actor: {sent, before: {position, yaw}} (place and stop report where
    // the actor was). Refuses npc_lost, not_walkable, no_ai.
    std::function<json(const std::string& aWho, const Command& aCommand)> command;
    // Shows a line (and/or plays a trigger) from aWho, or (aWho empty, aLine.voice) a voice with no body: {line_id}.
    // Refuses npc_lost.
    std::function<json(const std::string& aWho, const Line& aLine)> say;
    // Hides a line by its number: {hidden}.
    std::function<json(const std::string& aWho, int32_t aLine)> hide;
    // Look-at on a target, or off: {looking}.
    std::function<json(const std::string& aWho, const Target& aAt, bool aOff)> look;
    // A facial reaction (category 0 resets): {category, idle}.
    std::function<json(const std::string& aWho, int32_t aCategory, int32_t aIdle)> face;
    // A body gesture through the XF gesture carrier, or off: {playing}. Refuses carrier_missing.
    std::function<json(const std::string& aWho, const std::string& aClip, bool aOff)> act;
    // Shows (aShow) or withdraws a dialogue hub: {shown} / {withdrawn}. Refuses choices_busy (a vanilla hub or an interaction
    // prompt is up), too_far.
    std::function<json(const Hub& aHub, bool aShow)> hub;
    // Ends an actor or a pick in the game: how despawn (delete) or leave (a pick back to its own AI; its look and face
    // reset): {released}. Never refuses for a missing entity (it's gone already).
    std::function<json(const std::string& aWho, const std::string& aHow)> release;
    // Everything the bridge holds on NPCs, in one step (the kill switch): hubs withdrawn, lines hidden, commands cancelled,
    // look-ats removed, faces reset, gestures stopped, actors deleted: {released: n, ...}.
    std::function<json(const std::string& aReason)> releaseAll;
    // The tick's reading, for the handles in aWhos (comma list), changing nothing: {v: {position, busy}, camera: {position,
    //  forward, fov, aspect}, npcs: [{who, exists, spawned, dead, position, yaw, command_state, prepared (actors), gesture_ready,
    //  busy and protected (picks)}], hub: {id, answer (-1 none), shown, withdrawn ("busy": the game's own prompt or dialogue
    //  came up)}}.
    std::function<json(const std::string& aWhos)> poll;
    // An actor's first moment in the world: its attitude towards V and (unless mortal) god mode. Sent by the tick behind the
    // write gate when the poll reports it unprepared.
    std::function<json(const std::string& aWho)> prepare;
    // A gesture's start once its carrier exists (enter the workspot, jump to the clip). Sent by the tick behind the write gate.
    std::function<json(const std::string& aWho)> startAct;
};

// Where the dispatcher and the script gate stand, for the tick.
struct TickInput
{
    bool gateOpen = true;    // the game's scripts may be called now
    bool killed = false;     // the kill switch fired (the restore releases; the tick only stops)
    bool paused = false;     // the panel's pause
    bool handedOver = false; // session.handover
    uint64_t detaches = 0;   // the script layer's detaches so far (a change is a load: everything is dropped)
    // RB-122: checked right before each of the tick's forward steps (a held facing's re-turn); false skips the step. Unset:
    // open.
    std::function<bool()> writesOpen;
};

// --- the service -----------------------------------------------------------------------------------------

class Service
{
public:
    void SetEvents(EventLog* aEvents);

    json List(const json& aParams, const Ops& aOps);
    json Pick(const json& aParams, const Ops& aOps);
    json Status(const json& aParams) const;
    json Spawn(const json& aParams, const Ops& aOps);
    json Move(const json& aParams, const Ops& aOps);
    json Follow(const json& aParams, const Ops& aOps);
    json Turn(const json& aParams, const Ops& aOps);
    json Place(const json& aParams, const Ops& aOps);
    json Stop(const json& aParams, const Ops& aOps);
    json Say(const json& aParams, const Ops& aOps);
    json Look(const json& aParams, const Ops& aOps);
    json Face(const json& aParams, const Ops& aOps);
    json Act(const json& aParams, const Ops& aOps);
    json Choices(const json& aParams, const Ops& aOps);
    json Release(const json& aParams, const Ops& aOps);

    // Game thread, every tick: timers (lines, gestures, hub and command limits), a poll four times a second while anything is
    // held, the events it implies, and the automatic release on combat, a scene, a pause, a handover or a load.
    void Tick(double aDt, const TickInput& aInput, const Ops& aOps);
    // The kill switch's restore (game thread): one releaseAll step, then the bookkeeping cleared. Nothing when nothing is held.
    json RestoreAfterKill(const Ops& aOps);
    // A load or a detach: forgets everything without a game call (Codeware drops non-persistent entities with the world).
    void DropAll(const std::string& aReason);
    // A handover (bridge.handover {on: true}, on the game thread once its flag is set): everything released at once, each with
    // npc.auto_released {reason}: {released: [handles], hub_withdrawn, voice_lines_hidden}. Nothing when nothing is held.
    json ReleaseAllNow(const std::string& aReason, const Ops& aOps);

    // Whether anything is held (actors, picks, a hub, lines).
    bool Active() const;
    // What a save would keep, as plain names (game.save refuses while this isn't empty): actors spawned.
    json Holds() const;
    size_t ActorCount() const;

private:
    struct Motion
    {
        std::string kind; // move, follow, turn, walk_away
        Target target;
        Vec3 point{};     // move: a point target, resolved once
        double stopM = 1.6;
        double age = 0.0;
        double maxS = 0.0;
        std::string lastState;
        // turn: the yaw it turns to (npc.turned when reached); fromHold: a held facing's own re-turn.
        double yawGoal = 0.0;
        bool hasYawGoal = false;
        bool away = false;
        bool fromHold = false;
        // move and walk_away: progress, for npc.blocked.
        double bestDistance = 1e9;
        double lastAge = 0.0;
        double sinceProgress = 0.0;
        bool blockedSent = false;
        // 0.8.10: a walk waiting for its turn on the spot (kTurnFirstDeg): sent once the actor faces yawGoal, or after kTurnFirstMaxS.
        std::optional<Command> pending;
    };
    // A held facing (npc.turn with hold): kept towards (or away from) a target until npc.turn off or the release.
    struct Facing
    {
        Target target;
        bool away = false;
        double sinceIssue = kFacingReissueS;
    };
    struct VoiceLine
    {
        int32_t number = 0;
        double left = 0.0;
        std::string speaker;
    };
    struct LineHeld
    {
        int32_t number = 0;
        double left = 0.0;
        bool textShown = false;
    };
    struct Npc
    {
        std::string who;
        std::string kind; // actor or pick
        std::string cast;
        std::string record;
        std::string rig;
        std::string label;
        std::string entity;
        bool spawned = false;
        bool announced = false;
        double sinceSpawn = 0.0;
        Vec3 position{};
        bool known = false;
        double yaw = 0.0;
        bool yawKnown = false;
        std::optional<Facing> facing;
        std::optional<Motion> motion;
        std::vector<LineHeld> lines;
        std::optional<Target> look;
        std::string face;
        double sinceFace = 0.0;   // 0.8.11: since the held face was last sent
        int faceSends = 0;        // 0.8.11: how many times it was sent again
        bool facingSet = false;   // 0.8.11: a move was sent with V (or another) as its facing target: cleared when it ends or the next command goes out
        std::string gesture;
        double gestureLeft = 0.0;
        std::string releasing; // walk_away while it walks off; dissolve until it is out of sight
        // V15: how it stands towards V, and whether it can die.
        std::string attitude = "friendly";
        bool immortal = true;
        std::string reactions = "quiet";
        bool handedBack = false; // a fight began: its own AI has it now; the bridge only watches until it is released
        bool deadKept = false;   // a mortal actor that died: its body stays until it is released
        // V16: dissolve.
        double dissolveM = kDissolveM;
        double dissolveAge = 0.0;
        // Stand-ins (V15) are handed back in a fight instead of being removed.
        bool StandsIn() const { return kind == "actor" && (!immortal || attitude != "friendly"); }
    };
    struct HubHeld
    {
        Hub hub;
        double age = 0.0;
        double maxS = kChoicesMaxS;
    };

    // 0.8.11: aOps.command, then the facing bookkeeping (see the definition).
    json Send(const std::string& aWho, const Command& aCommand, const Ops& aOps);
    void Emit(const std::string& aKind, const std::string& aLevel, const std::string& aText, json aData);
    // The refusal order's step 2 (design §5.2): V in the world, on foot, out of combat, scenes and dialogue. Returns V.
    json RequireV(const Ops& aOps) const;
    Npc& Ours(const std::string& aWho, bool aActorOnly);
    Vec3 Resolve(const Target& aTarget, const json& aV) const;
    void CheckRange(const Vec3& aPoint, const json& aV) const;
    // Stops everything held on one NPC (lines, look, face, gesture, motion, its hub) through Ops; never throws.
    json StopHeld(Npc& aNpc, const Ops& aOps, bool aKeepLines);
    void ReleaseOne(const std::string& aWho, const std::string& aHow, const std::string& aReason, const Ops& aOps);
    // 0.8.10: the turn on the spot a walk toward aToward begins with when the way lies more than kTurnFirstDeg off the actor's
    // facing (nothing when it faces that way, or its facing is not known); aGoal is the yaw the turn ends at.
    static std::optional<Command> TurnBeforeWalk(const Npc& aNpc, const Vec3& aToward, double& aGoal);
    // 0.8.10: starts aWalk for aNpc: its turn first when TurnBeforeWalk asks (aMotion then holds the walk as pending), else the
    // walk itself. Throws what the game step throws. Called with the mutex held.
    void BeginWalk(Npc& aNpc, const Command& aWalk, const Vec3& aToward, Motion& aMotion, const Ops& aOps);
    void ReleaseEverything(const std::string& aReason, const Ops& aOps);
    json NpcJson(const Npc& aNpc) const;
    void OnPoll(const json& aReading, const Ops& aOps, const TickInput& aInput);
    // A hub past its max_s: withdrawn with npc.choice {timeout} (after the poll has read a pending answer).
    void ExpireHub(const Ops& aOps);
    // V16: whether a point (an actor's feet) is out of V's sight: outside the camera's view, or with static geometry between the
    // camera and both its head and its feet.
    bool OutOfSight(const Camera& aCamera, const Vec3& aPoint, const Ops& aOps) const;
    // V16: a walkable spot out of V's sight between aMin and aMax metres from her: {point, probes}, or throws no_hidden_spot.
    json FindHiddenSpot(const json& aV, double aMin, double aMax, const Ops& aOps) const;
    // 0.8.10 (session 16's N4: an actor asked for 2 m ahead of V at a vending machine stood where V could not see her): for a
    // spawn asked for relative to V, the walkable spot the actor will stand on with a sight line from V's head to her chest:
    // the asked one when it has it, else the nearest that has, within kSightSearchM. {moved, point, probes}; throws
    // no_visible_spot when there is none. Answers {moved: false} without a probe when this build can't ray or probe the ground.
    json FindVisibleSpot(const json& aV, const Vec3& aAsked, const Ops& aOps) const;
    // V15: a fight began: a stand-in's direction ends (lines, look, face, gesture, walk, its hub) and its own AI has it.
    void HandBack(Npc& aNpc, const std::string& aReason, const Ops& aOps);
    // Refuses a command for an actor the bridge no longer directs (handed back to its AI, or dead).
    static void RequireDirected(const Npc& aNpc);

    mutable std::recursive_mutex m_mutex;
    std::map<std::string, Npc> m_npcs;
    std::optional<HubHeld> m_hub;
    std::vector<VoiceLine> m_voice; // lines from a voice with no body
    // What the current handover released (the tick's safety net or ReleaseAllNow), for bridge.handover's answer.
    json m_handoverDone;
    void NoteHandoverRelease();
    // Hides every voice line now (a handover, a pause, a scene, release all); never throws.
    void HideVoices(const Ops& aOps);
    EventLog* m_events = nullptr;
    uint32_t m_nextActor = 1;
    uint32_t m_nextPick = 1;
    int32_t m_nextLine = 1;
    int32_t m_nextHub = 1;
    double m_sincePoll = 0.0;
    uint64_t m_detaches = 0;
    bool m_detachesKnown = false;
};

// Parameter checks shared with the tools' tests: every npc.* method's known keys.
void RequireKnown(const std::string& aMethod, const json& aParams);

// Registers npc.* on a dispatcher with their access classes and threads, for the plugin and the self-test host alike:
// aOpsFor builds the game steps for a request's correlation id; aMarkWrite wraps a write (the plugin's MarkedWrite: the kill
// switch's restore is owed after it, and write.done is logged with its undo).
void RegisterMethods(Dispatcher& aDispatcher, Service& aService, std::function<Ops(const std::string& aCid)> aOpsFor,
                     std::function<MethodSpec(MethodSpec)> aMarkWrite);
} // namespace xfb::npc
