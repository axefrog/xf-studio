#pragma once

// Player control, phase 1 (bridge 0.6; research/runtime/player-control-design.md): parameter checks and the pure steps the
// plugin and the self-test host share. The game side is the redscript layer's XFPlayer (XFRuntimeBridgePlayer.reds).

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Dispatcher.hpp"

namespace xfb::player
{
using json = nlohmann::json;
using Vec3 = std::array<double, 3>;

inline constexpr double kMaxTeleportM = 50.0;
inline constexpr int kTeleportsPerSecond = 2;

// player.teleport: {position [x, y, z]} or {offset {forward, right, up}} (metres from V, along her facing); {yaw} (absolute
// degrees, the game's yaw) or {turn} (relative); ground "snap" (default: walkable ground within 2 m) or "exact"; far.
struct TeleportRequest
{
    std::optional<Vec3> position;
    std::optional<Vec3> offset; // forward, right, up
    std::optional<double> yaw;
    std::optional<double> turn;
    bool exact = false;
    bool farOk = false;
};
TeleportRequest ParseTeleport(const json& aParams);
// The destination and facing from V's position and yaw (degrees; she faces (-sin, cos)).
std::pair<Vec3, std::optional<double>> Destination(const TeleportRequest& aRequest, const Vec3& aFrom, double aYaw);
// A teleport's undo (0.8.1, RB-127): back to where V stood (aBefore), facing the same way, ground exact; with far: true
// when that spot is more than kMaxTeleportM from where she is now (aNow), since the replay would otherwise be refused
// too_far like any long teleport.
json TeleportUndo(const Vec3& aBefore, double aYaw, const Vec3& aNow);

// player.look: {yaw, pitch} (degrees; relative: true adds them to the current view) or {at [x, y, z]}; mode "instant" or
// "smooth"; duration_s (smooth, 0.05-5, default 1).
struct LookRequest
{
    std::optional<double> yaw;
    std::optional<double> pitch;
    bool relative = false;
    std::optional<Vec3> at;
    bool smooth = false;
    double duration = 1.0;
};
LookRequest ParseLook(const json& aParams);
// The point 10 m along the wanted view from the camera, and the wanted yaw and pitch, given the camera now.
struct LookTarget
{
    Vec3 point;
    double yaw;
    double pitch;
};
LookTarget LookTargetFor(const LookRequest& aRequest, const Vec3& aCamera, double aYaw, double aPitch);
double YawOf(const Vec3& aForward);
double PitchOf(const Vec3& aForward);

// 0.8.3 (session 10's L2a: a five-second smooth player.look took 1.5 s, the game's own look-at keeps its own pace): the path
// both smooth looks follow (behave.look since 0.8.2, player.look since 0.8.3). DirectionOf is the view direction for a yaw
// and pitch (the game's yaw: 0 faces +Y, positive turns left); LookArc the direction a fraction (0-1, eased in and out with
// a smoothstep, as the game's look-at is) along the great circle from aFrom to aTo (unit vectors), whose angle to aTo only
// ever shrinks; opposite directions turn through the horizontal, the way a head turns round. The look steers along it with
// one short look-at to the next place every kLookArcStepS, so it takes its duration whatever pace the game keeps.
inline constexpr double kLookArcStepS = 0.1;
Vec3 DirectionOf(double aYaw, double aPitch);
Vec3 LookArc(const Vec3& aFrom, const Vec3& aTo, double aFraction);

// player.action: name crouch, stand, weapon.draw, weapon.holster, weapon.slot (slot 1-3), menu.open (menu), menu.close.
struct ActionRequest
{
    std::string name;   // as the redscript layer takes it: crouch, stand, weapon.draw, weapon.holster, weapon.slot,
                        // menu.inventory, menu.map, ..., menu.close
    int32_t arg = 0;
    Access access = Access::WritePlayer;
    json undo;          // {method, params} or null
    std::string undoNote;
};
ActionRequest ParseAction(const json& aParams);

// 0.8.2 (the re-check's second finding): player.stop's count. A multi-step player write (player.look, player.teleport) reads
// it when it starts and checks it on the game thread right before each later step that moves V or her view, so a stop that
// came in between (on the control pipe, beside the write) ends the write there: a look stopped during its one-tick wait
// doesn't start its look-at afterwards. player.stop, a handover and the kill switch move it on before their own game step.
class StopCount
{
public:
    uint64_t Current() const;
    void Stop();
    // Throws MethodError "stopped" when a stop came after aSeen (Current() when the write started).
    void Require(uint64_t aSeen, const std::string& aWhat) const;
    bool StoppedSince(uint64_t aSeen) const;

private:
    std::atomic<uint64_t> m_count{0};
};

// Teleports at most kTeleportsPerSecond (design §4.3); thread-safe. Throws MethodError rate_limited when over.
class TeleportPacer
{
public:
    void Take();

private:
    std::mutex m_mutex;
    std::chrono::steady_clock::time_point m_times[kTeleportsPerSecond]{};
    size_t m_next = 0;
};
} // namespace xfb::player
