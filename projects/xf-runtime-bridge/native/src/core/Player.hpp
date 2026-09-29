#pragma once

// Player control, phase 1 (bridge 0.6; research/runtime/player-control-design.md): parameter checks and the pure steps the
// plugin and the self-test host share. The game side is the redscript layer's XFPlayer (XFRuntimeBridgePlayer.reds).

#include <array>
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
