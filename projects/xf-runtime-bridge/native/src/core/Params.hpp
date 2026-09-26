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
inline constexpr int32_t kLightState = 44; // STATE: option data 0 Off, 1 On (first session's photo.state dump)
inline constexpr int32_t kLightType = 45;  // option data 1 Spot, 2 Ambient (same dump)
inline constexpr int32_t kLightShadow = 46; // SHADOW: option data 0 Off, 1 On (same dump)
inline constexpr int32_t kChromaticAberration = 13; // -2 to 2 (same dump)
inline constexpr int32_t kGrain = 25;                // 0 to 1 (same dump)
inline constexpr int32_t kCameraPreset = 23; // PRESET: 0 Customization, 1-9 photo_mode.std_preset_1..9 (same dump)
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

// photo.camera.set: {camera_preset, fov, roll, focal_distance, aperture, dof, autofocus, look_at,
// look_at_part, grain, chromatic_aberration, subject: {yaw, left_right, near_far, up_down}, reset}. camera_preset (key 23) comes
// first, so the other values apply to the camera where the preset put it. reset = true restores every camera and
// subject setting to its value when photo mode opened, and cannot be combined with values.
struct CameraRequest
{
    bool reset = false;
    std::vector<Attribute> attributes;
};
CameraRequest ParseCamera(const json& aParams);

// The photo.camera.set parameter for a camera key ("fov", "subject.yaw"); empty if it isn't one.
std::string CameraParamName(int32_t aKey);

// The keys photo.camera.set may reset.
std::vector<int32_t> CameraKeys();

// photo.light.set: {light: 1-3, on, type, shadow, brightness, range, inner_angle, outer_angle, hue,
// saturation, luminosity, select_after: 1-3}. on switches the light on or off (key 44, data 1 or 0),
// type picks "spot" or "ambient" (key 45, data 1 or 2) and shadow switches its shadow (key 46); these
// are applied first, in that order, then the values.
// select_after selects that light in the menu once the values are set (the undo uses it to put the
// menu's selection back).
struct LightRequest
{
    int32_t light = 1;
    int32_t selectAfter = 0; // 0 = leave the light selected
    std::vector<Attribute> attributes;
};
LightRequest ParseLight(const json& aParams);

// photo.expression.set: {faceId}.
int32_t ParseExpression(const json& aParams);

// photo.hud.hide: {hidden (default true), cursor (default true)}. cursor = true makes the call hide
// or show the menu's mouse cursor together with the photo-mode interface; false leaves the cursor
// as it is.
struct HudRequest
{
    bool hidden = true;
    bool cursor = true;
};
HudRequest ParseHud(const json& aParams);
bool ParseHudHidden(const json& aParams); // hidden only (kept for callers that ignore the cursor)

// photo.enter: {route}. No route (or "auto") is refused with code photo_key_needed and a plain
// message: the only route built so far, the quest node, opens a restricted photo mode (first
// session, 26 Sep 2026: first-person camera only, no V tab), so the player's photo-mode key is the
// way in until a proper route exists. route = "quest" keeps that node for research only. A later
// route is added here as a new name; "auto" will then pick the best proven one, so callers that
// send nothing or "auto" keep working.
enum class PhotoEnterRoute
{
    Quest,
};
PhotoEnterRoute ParsePhotoEnter(const json& aParams);

// cc.confirm and cc.back take no parameters. Both are refused unless [bridge] allow_creator_leave =
// true (default false, in every package, until the maintainer decides whether the bridge may
// confirm the creator on a test save).
bool CreatorLeaveAllowed(bool aConfigFlag); // throws creator_leave_disabled when the flag is off

// photo.subject: {up, forward, right} in metres: the point to report, relative to V's head slot, along
// the world's up axis and V's own forward and right directions (each -2 to 2, default 0).
struct SubjectRequest
{
    float up = 0.0f;
    float forward = 0.0f;
    float right = 0.0f;
};
SubjectRequest ParseSubject(const json& aParams);

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
