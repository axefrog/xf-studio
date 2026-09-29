#pragma once

// Behaviours (bridge 0.6; research/runtime/runtime-bridge-design.md §8a): small routines an agent starts with a goal,
// parameters, limits and a stop condition, which then run in the plugin at tick rate and stream events back, so the
// agent works in turns of seconds while the game runs at frame rate.
//
// Safety (design §4): every behaviour stops on the kill switch (DropAll before the restore), is dropped without a script
// call when the game's scripts detach (a save loading: DropAll), pauses while the script gate is closed, stops on a
// handover, never outlives its max_s (at most 600 s; a glide 30 s), and gives back what it held when it ends: a turntable turns its
// heads back, a glide lifts the movement restriction it put on V, keep_framed leaves things where they are (its own undo
// is in its stop event). At most kMaxBehaviours run at once, one per target (a new one on the same target replaces it).
//
// The game-side steps are injected (Ops), so the plugin runs them through the redscript layer and the self-test host
// through its simulated world, with the same logic. Tick() runs on the game thread; Start/Stop/List on the pipe's thread.

#include <array>
#include <chrono>
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

namespace xfb
{
class EventLog;
}

namespace xfb::behave
{
using json = nlohmann::json;
using Vec3 = std::array<double, 3>;

inline constexpr size_t kMaxBehaviours = 4;
inline constexpr double kMaxSeconds = 600.0;
// A glide's own cap (player-control design §4.3: a motion lasts at most 30 s).
inline constexpr double kMaxGlideSeconds = 30.0;

// The game-side steps a behaviour may take. Each throws MethodError on a refusal (the behaviour stops with that code).
struct Ops
{
    // The active camera: {position, forward, right, up, fov, aspect} (arrays), as scene.read reports it.
    std::function<json()> camera;
    // The showroom's heads and rigs: {pieces: [{index, position, yaw, base_yaw}], rigs: [...]}.
    std::function<json()> showroom;
    // Moves (and turns) one showroom piece or rig: kind "pieces" or "lights".
    std::function<void(const std::string& aKind, int32_t aIndex, const Vec3& aPosition, double aYaw)> place;
    // V in normal play: {position, yaw, busy (a refusal code or ""), phase}.
    std::function<json()> player;
    std::function<void(const Vec3& aPosition, double aYaw)> teleportPlayer;
    // The player's camera turns towards a point over a duration (TargetingSystem.LookAt), or stops doing so.
    std::function<void(const Vec3& aPoint, double aDuration)> lookAt;
    std::function<void()> breakLookAt;
    // A walkable path (navmesh) from one point to another: the points, or throws no_path.
    std::function<std::vector<Vec3>(const Vec3& aFrom, const Vec3& aTo)> path;
    // A movement restriction on V (the status effect GameplayRestriction.NoMovement) on or off.
    std::function<void(bool aOn)> holdMovement;
    // photo.subject's reading of V's face in photo mode (keep_framed v).
    std::function<json()> subject;
    // A photo-mode attribute (V's placement for keep_framed v): returns the value the game took.
    std::function<float(int32_t aKey, float aValue)> setAttribute;
};

struct Behaviour;

class Runner
{
public:
    // Parameters: {kind, params, max_s, every_ticks}. Answers {id, kind, target, write_class, ...}; throws bad_params.
    // aRequireClass is the dispatcher's class check (write-photo, write-player, write-showroom per kind).
    json Start(const json& aParams, const std::function<void(Access)>& aRequireClass);
    // Stops one behaviour (id) or all; the stop happens on the next tick (a game step). Answers what was asked to stop.
    json Stop(const json& aParams);
    json List() const;
    // Game thread, every Running tick. aGateOpen: the game's scripts may be called now (behaviours wait otherwise).
    void Tick(double aDt, const Ops& aOps, bool aGateOpen);
    // Stops everything at once without game calls (a detach, a load): behaviours are dropped, never resumed.
    void DropAll(const std::string& aReason);
    // Stops everything through its own stop step on the next tick (the kill switch, a handover).
    void StopAll(const std::string& aReason);
    bool Active() const;
    void SetEvents(EventLog* aEvents);
    // The write class a kind needs.
    static Access ClassOf(const std::string& aKind, const json& aParams);

private:
    void Emit(Behaviour& aBehaviour, const std::string& aLevel, const std::string& aText, json aData = nullptr);

    mutable std::mutex m_mutex;
    std::vector<std::shared_ptr<Behaviour>> m_behaviours;
    uint64_t m_nextId = 1;
    EventLog* m_events = nullptr;
};

// behave.<kind>'s input as Runner::Start takes it: {kind, params: the input's own keys, max_s, every_ticks}.
json StartParams(const std::string& aKind, const json& aInput);

// Pure pieces, unit-tested.
// The point along a polyline at arc length aS, and the heading (degrees, the game's yaw: 0 along +Y, counter-clockwise)
// of the segment it lies on. aLength receives the polyline's length.
std::pair<Vec3, double> AlongPath(const std::vector<Vec3>& aPath, double aS, double& aLength);
// The game's yaw that faces the horizontal direction (dx, dy): 0 faces +Y, 90 faces -X.
double YawFacing(double aDx, double aDy);
// A point in an entity frame (position, yaw) in the world.
Vec3 ToWorld(const Vec3& aPosition, double aYaw, const Vec3& aLocal);
// The world point at frame position (x, y) (window heights from the centre, y down) and distance d along the ray, for a
// camera {position, forward, right, up, fov} read as a vertical field of view [hypothesis for x, y != 0; exact at 0, 0].
Vec3 OnCameraRay(const json& aCamera, double aDistance, double aX, double aY);
} // namespace xfb::behave
