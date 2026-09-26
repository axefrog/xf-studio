#pragma once

// Parameter checking for the phase-2 bridge methods. Game-independent, so the plugin and the
// self-test host run exactly the same checks: a request is refused with code "bad_params" and a
// plain message before anything reaches the game thread.
//
// Photo-mode attribute keys (Uint32, gameuiPhotoModeMenuController.OnAttributeUpdated). The
// numbers come from installed community mods that drive photo mode through the same function
// (Photo Mode Preferences, Photo Mode Pose Selector, Equipment-EX, Photo Mode Ex); the game's own
// 2.31 scripts confirm 35, 36, 55, 63 and 72. They are graded [source] until the first in-game
// session's menu capture (photo.state with menu) confirms each one on 2.31. The redscript layer
// additionally checks every value against the range or option list the game set up for that item.

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace xfb::params
{
using json = nlohmann::json;

namespace key
{
inline constexpr int32_t kFov = 1;
inline constexpr int32_t kRoll = 2;
inline constexpr int32_t kFocalDistance = 3;
inline constexpr int32_t kAperture = 4;
inline constexpr int32_t kSubjectYaw = 7;
inline constexpr int32_t kSubjectLeftRight = 8;
inline constexpr int32_t kSubjectNearFar = 9;
inline constexpr int32_t kLookAt = 15;
inline constexpr int32_t kDepthOfField = 26;
inline constexpr int32_t kExpression = 28;
inline constexpr int32_t kAutofocus = 33;
inline constexpr int32_t kSubjectUpDown = 37;
inline constexpr int32_t kLightSelect = 43;
inline constexpr int32_t kLightBrightness = 47;
inline constexpr int32_t kLightRange = 48;
inline constexpr int32_t kLightInnerAngle = 49;
inline constexpr int32_t kLightOuterAngle = 50;
inline constexpr int32_t kLightHue = 51;
inline constexpr int32_t kLightSaturation = 52;
inline constexpr int32_t kLightLuminosity = 53;
inline constexpr int32_t kLookAtPart = 74;
} // namespace key

struct Attribute
{
    int32_t key;
    float value;
    std::string name; // the parameter it came from, for messages and results
};

// photo.camera.set: {fov, roll, focal_distance, aperture, dof, autofocus, look_at, look_at_part,
// subject: {yaw, left_right, near_far, up_down}, reset}. reset = true restores every camera and
// subject setting to its value when photo mode opened, and cannot be combined with values.
struct CameraRequest
{
    bool reset = false;
    std::vector<Attribute> attributes;
};
CameraRequest ParseCamera(const json& aParams);

// The keys photo.camera.set may reset.
std::vector<int32_t> CameraKeys();

// photo.light.set: {light: 1-3, brightness, range, inner_angle, outer_angle, hue, saturation, luminosity}.
struct LightRequest
{
    int32_t light = 1;
    std::vector<Attribute> attributes;
};
LightRequest ParseLight(const json& aParams);

// photo.expression.set: {faceId}.
int32_t ParseExpression(const json& aParams);

// photo.hud.hide: {hidden} (default true).
bool ParseHudHidden(const json& aParams);

// photo.state: {menu, options}.
struct PhotoStateRequest
{
    bool menu = false;
    bool options = false;
};
PhotoStateRequest ParsePhotoState(const json& aParams);

// cc.apply: {option, index}.
struct CharacterRequest
{
    std::string option;
    int32_t index = 0;
};
CharacterRequest ParseCharacterApply(const json& aParams);

// player.appearance: {option, check: [{group, option, fpp}]}.
struct AppearanceCheck
{
    std::string group;
    std::string option;
    bool fpp = false;
};
struct AppearanceRequest
{
    std::string option;
    std::vector<AppearanceCheck> checks;
};
AppearanceRequest ParseAppearance(const json& aParams);

// world.time.set: {hours, minutes, seconds} or {total_seconds}.
struct TimeRequest
{
    int32_t hours = 0;
    int32_t minutes = 0;
    int32_t seconds = 0;
    int32_t totalSeconds = -1; // >= 0: restore this exact time instead
};
TimeRequest ParseTime(const json& aParams);

// world.pause: {paused}.
bool ParsePause(const json& aParams);

// Refuses parameters a method doesn't know (typos must not be silently ignored). Also used for
// methods without parameters.
void RequireOnly(const json& aParams, std::initializer_list<const char*> aKnown);

json AttributesJson(const std::vector<Attribute>& aAttributes);
} // namespace xfb::params
