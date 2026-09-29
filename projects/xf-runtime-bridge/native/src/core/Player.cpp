#include "core/Player.hpp"

#include <algorithm>
#include <cmath>
#include <mutex>

#include "core/Params.hpp"

namespace xfb::player
{
namespace
{
constexpr double kDeg = 3.14159265358979323846 / 180.0;
}

TeleportRequest ParseTeleport(const json& aParams)
{
    params::RequireOnly(aParams, {"position", "offset", "yaw", "turn", "ground", "far"});
    TeleportRequest request;
    request.position = params::CheckPoint(aParams, "position");
    if (const auto it = aParams.find("offset"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_object())
        {
            params::CheckFail("'offset' must be {forward, right, up} in metres");
        }
        params::RequireOnly(*it, {"forward", "right", "up"});
        request.offset = Vec3{params::CheckNumber(*it, "forward", -50.0, 50.0).value_or(0.0), params::CheckNumber(*it, "right", -50.0, 50.0).value_or(0.0),
                              params::CheckNumber(*it, "up", -10.0, 10.0).value_or(0.0)};
    }
    request.yaw = params::CheckNumber(aParams, "yaw", -360.0, 360.0);
    request.turn = params::CheckNumber(aParams, "turn", -360.0, 360.0);
    if (request.yaw && request.turn)
    {
        params::CheckFail("give yaw (absolute) or turn (relative), not both");
    }
    if (request.position && request.offset)
    {
        params::CheckFail("give position or offset, not both");
    }
    if (!request.position && !request.offset && !request.yaw && !request.turn)
    {
        params::CheckFail("give position [x, y, z] or offset {forward, right, up}, and/or yaw or turn");
    }
    if (const auto ground = params::CheckText(aParams, "ground", 8))
    {
        if (*ground != "snap" && *ground != "exact")
        {
            params::CheckFail("'ground' must be snap (walkable ground within 2 m, the default) or exact");
        }
        request.exact = *ground == "exact";
    }
    request.farOk = params::CheckBoolean(aParams, "far").value_or(false);
    return request;
}

std::pair<Vec3, std::optional<double>> Destination(const TeleportRequest& aRequest, const Vec3& aFrom, double aYaw)
{
    Vec3 to = aFrom;
    if (aRequest.position)
    {
        to = *aRequest.position;
    }
    else if (aRequest.offset)
    {
        const double c = std::cos(aYaw * kDeg), s = std::sin(aYaw * kDeg);
        const auto& o = *aRequest.offset;
        // V faces (-sin, cos); her right is (cos, sin).
        to = {aFrom[0] - s * o[0] + c * o[1], aFrom[1] + c * o[0] + s * o[1], aFrom[2] + o[2]};
    }
    std::optional<double> yaw;
    if (aRequest.yaw)
    {
        yaw = *aRequest.yaw;
    }
    else if (aRequest.turn)
    {
        yaw = aYaw + *aRequest.turn;
    }
    if (yaw)
    {
        double v = std::fmod(*yaw + 180.0, 360.0);
        yaw = (v < 0 ? v + 360.0 : v) - 180.0;
    }
    return {to, yaw};
}

LookRequest ParseLook(const json& aParams)
{
    params::RequireOnly(aParams, {"yaw", "pitch", "relative", "at", "mode", "duration_s"});
    LookRequest request;
    request.yaw = params::CheckNumber(aParams, "yaw", -360.0, 360.0);
    request.pitch = params::CheckNumber(aParams, "pitch", -170.0, 170.0);
    request.relative = params::CheckBoolean(aParams, "relative").value_or(false);
    request.at = params::CheckPoint(aParams, "at");
    if (request.at && (request.yaw || request.pitch))
    {
        params::CheckFail("give at [x, y, z] or yaw and pitch, not both");
    }
    if (!request.at && !request.yaw && !request.pitch)
    {
        params::CheckFail("give yaw and/or pitch (degrees; relative: true adds them), or at [x, y, z]");
    }
    if (!request.relative && request.pitch && std::abs(*request.pitch) > 85.0)
    {
        params::CheckFail("'pitch' must be between -85 and 85 degrees");
    }
    if (const auto mode = params::CheckText(aParams, "mode", 8))
    {
        if (*mode != "instant" && *mode != "smooth")
        {
            params::CheckFail("'mode' must be instant or smooth");
        }
        request.smooth = *mode == "smooth";
    }
    request.duration = params::CheckNumber(aParams, "duration_s", 0.05, 5.0).value_or(request.smooth ? 1.0 : 0.05);
    return request;
}

double YawOf(const Vec3& aForward)
{
    return std::atan2(-aForward[0], aForward[1]) / kDeg;
}

double PitchOf(const Vec3& aForward)
{
    const double l = std::sqrt(aForward[0] * aForward[0] + aForward[1] * aForward[1] + aForward[2] * aForward[2]);
    return std::asin(std::clamp(l > 0 ? aForward[2] / l : 0.0, -1.0, 1.0)) / kDeg;
}

LookTarget LookTargetFor(const LookRequest& aRequest, const Vec3& aCamera, double aYaw, double aPitch)
{
    if (aRequest.at)
    {
        const Vec3 d{(*aRequest.at)[0] - aCamera[0], (*aRequest.at)[1] - aCamera[1], (*aRequest.at)[2] - aCamera[2]};
        return {*aRequest.at, YawOf(d), PitchOf(d)};
    }
    double yaw = aRequest.yaw ? (aRequest.relative ? aYaw + *aRequest.yaw : *aRequest.yaw) : aYaw;
    double pitch = aRequest.pitch ? (aRequest.relative ? aPitch + *aRequest.pitch : *aRequest.pitch) : aPitch;
    pitch = std::clamp(pitch, -85.0, 85.0);
    const Vec3 d{-std::sin(yaw * kDeg) * std::cos(pitch * kDeg), std::cos(yaw * kDeg) * std::cos(pitch * kDeg), std::sin(pitch * kDeg)};
    return {{aCamera[0] + d[0] * 10.0, aCamera[1] + d[1] * 10.0, aCamera[2] + d[2] * 10.0}, yaw, pitch};
}

ActionRequest ParseAction(const json& aParams)
{
    params::RequireOnly(aParams, {"name", "slot", "menu"});
    const auto name = params::CheckText(aParams, "name", 32);
    if (!name)
    {
        params::CheckFail("'name' is required: crouch, stand, weapon.draw, weapon.holster, weapon.slot, menu.open or menu.close");
    }
    ActionRequest request;
    request.name = *name;
    const auto menuOf = [&]() {
        const auto menu = params::CheckText(aParams, "menu", 16);
        static const char* const menus[] = {"inventory", "map", "journal", "perks", "crafting", "wardrobe"};
        if (!menu || std::none_of(std::begin(menus), std::end(menus), [&](const char* m) { return *menu == m; }))
        {
            params::CheckFail("menu.open needs 'menu': inventory, map, journal, perks, crafting or wardrobe");
        }
        return *menu;
    };
    if (*name == "crouch" || *name == "stand")
    {
        request.undo = {{"method", "player.action"}, {"params", {{"name", *name == "crouch" ? "stand" : "crouch"}}}};
        request.undoNote = "stand lifts the bridge's crouch (only the bridge's own; player.stop and the kill switch lift it too)";
    }
    else if (*name == "weapon.draw" || *name == "weapon.holster")
    {
        request.undo = {{"method", "player.action"}, {"params", {{"name", *name == "weapon.draw" ? "weapon.holster" : "weapon.draw"}}}};
        request.undoNote = *name == "weapon.draw" ? "weapon.holster puts it away" : "weapon.draw takes out the last used weapon";
    }
    else if (*name == "weapon.slot")
    {
        request.arg = static_cast<int32_t>(params::CheckInteger(aParams, "slot", 1, 3).value_or(0));
        if (request.arg == 0)
        {
            params::CheckFail("weapon.slot needs 'slot' 1-3");
        }
        request.undo = {{"method", "player.action"}, {"params", {{"name", "weapon.holster"}}}};
        request.undoNote = "weapon.holster puts it away";
    }
    else if (*name == "menu.open")
    {
        request.name = "menu." + menuOf();
        request.undo = {{"method", "player.action"}, {"params", {{"name", "menu.close"}}}};
        request.undoNote = "menu.close closes it (the player's own Back does too)";
    }
    else if (*name == "menu.close")
    {
        request.undoNote = "nothing to undo";
    }
    else
    {
        params::CheckFail("unknown action '" + *name + "': crouch, stand, weapon.draw, weapon.holster, weapon.slot, menu.open or menu.close "
                          "(jump, sprint and dodge need an input channel, research)");
    }
    return request;
}

void TeleportPacer::Take()
{
    std::scoped_lock _(m_mutex);
    const auto now = std::chrono::steady_clock::now();
    auto& oldest = m_times[m_next];
    if (oldest.time_since_epoch().count() != 0 && now - oldest < std::chrono::seconds(1))
    {
        throw MethodError("rate_limited", "at most " + std::to_string(kTeleportsPerSecond) + " teleports a second");
    }
    oldest = now;
    m_next = (m_next + 1) % kTeleportsPerSecond;
}
} // namespace xfb::player
