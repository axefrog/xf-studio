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
#include <array>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/Messages.hpp"

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
// place (bridge 0.4) puts the light somewhere after its values are set:
//   "camera"                                   switch it off and on again, which makes photo mode place it
//                                              where the camera is now (session 3: a light is placed at the
//                                              camera when it switches on)
//   {azimuth, elevation, distance}             about V's head, aimed at it: degrees from V's facing
//                                              (counter-clockwise seen from above, so 90 is V's left, -180
//                                              to 180), degrees above level (-80 to 80) and metres (0.2 to 10);
//                                              defaults 0, 15 and 1.2
//   {world: [x, y, z]}                         a world position (the undo), aimed at V's head
// The last two move the light's own entity (research: whether photo mode keeps it there is read back).
struct LightPlacement
{
    enum class Kind
    {
        Camera,
        Around,
        World,
    };
    Kind kind = Kind::Around;
    float azimuth = 0.0f;
    float elevation = 15.0f;
    float distance = 1.2f;
    std::array<float, 3> world{};
};
struct LightRequest
{
    int32_t light = 1;
    int32_t selectAfter = 0; // 0 = leave the light selected
    std::vector<Attribute> attributes;
    std::optional<LightPlacement> place;
};
LightRequest ParseLight(const json& aParams);
json PlacementJson(const LightPlacement& aPlacement);

// photo.expression.set: {faceId}.
int32_t ParseExpression(const json& aParams);

// Which photo-mode entity a face method works on: V's stand-in, or the head item photo mode gives it
// (the face graph is expected on the head; research/animation/expression-editor-design.md R1/R2).
enum class FaceTarget : int32_t
{
    Puppet = 0,
    Head = 1,
};
const char* FaceTargetName(FaceTarget aTarget);

// face.rig.read: {target: "head" (default) | "puppet", components: [names]}. components lists the
// components to look up by name (letters, digits and '_', 1-64 characters, at most 16, no
// repeats); without it the photo-mode head's known face components (DefaultFaceComponents).
struct FaceRigRequest
{
    FaceTarget target = FaceTarget::Head;
    std::vector<std::string> components;
};
std::vector<std::string> DefaultFaceComponents();
FaceRigRequest ParseFaceRig(const json& aParams);

// photo.expression.index: {index: 0-100000, target: "puppet" (default), unlisted, force}. target "head" is
// refused (no_effect): session 4 found the face rig on the stand-in, none on the head item. Without
// unlisted = true the plugin refuses an index that isn't one of the expression list's face table indices,
// and (0.5.1, RB-72) one known only by list position (unverified) unless force = true
// (writes::CheckFaceIndex).
struct ExpressionIndexRequest
{
    int32_t index = 0;
    FaceTarget target = FaceTarget::Puppet;
    bool unlisted = false;
    bool force = false;
};
ExpressionIndexRequest ParseExpressionIndex(const json& aParams);

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

// cc.confirm and cc.back take no parameters. Both, and cc.open, are refused unless [bridge]
// allow_creator_leave = true: false by default and in the default and -diagnostic packages; the
// -writes package (the dedicated test profile only) sets it, as approved on 26 September 2026 for
// sessions that end by loading the safety save.
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

// cc.apply: {option, index} or {option, value}. option is the option's internal name, its on-screen
// label or its UI slot (the one active option in that slot, e.g. piercings_color); value is a value's
// internal name or on-screen label (index is then -1). The redscript layer resolves both. With index,
// expect_option and expect_value (0.5.1, RB-71) are the row and the value's internal name the caller read
// (cc.apply by label reads them first): the script refuses (stale_match) when the option now resolves to
// another row or the value at that index has another name, so an index never lands in another row's list.
struct CharacterRequest
{
    std::string option;
    int32_t index = 0;
    std::string value;
    std::string expectOption;
    std::string expectValue;
};
CharacterRequest ParseCharacterApply(const json& aParams);

// cc.open: {mode: "mirror" (default) | "ripperdoc", edit_mode: "edit_tag" (default) | "new_game",
// timeout_ms: 500-15000 (default 5000)}. With edit_mode edit_tag the appearance screen opens with the
// mode's edit tag (gameuiCharacterCustomizationEditTag HairDresser or Ripperdoc), which decides which rows
// can be changed (the vanilla eye shape, nose and skin rows carry NewGame and Ripperdoc only) and freezes
// the world while the screen is open. With edit_mode new_game (0.5.1, RB-66) it opens with the NewGame tag,
// as Character Customization Anywhere's F12 actually ran in session 4 (its field writes never reach the
// game on 2.31): every row is editable, the world isn't frozen, and the voice switcher shows; mode is then
// only "mirror" (ripperdoc would add nothing). Which of the two avoids session 4's stuck, half-open creator
// is session 5's question. Refused, like cc.confirm and cc.back, unless allow_creator_leave = true.
enum class CreatorMode : int32_t
{
    Mirror = 1,    // gameuiCharacterCustomizationEditTag.HairDresser
    Ripperdoc = 2, // gameuiCharacterCustomizationEditTag.Ripperdoc
};
enum class CreatorEditMode : int32_t
{
    EditTag = 0, // the mode's tag: HairDresser (mirror) or Ripperdoc
    NewGame = 1, // gameuiCharacterCustomizationEditTag.NewGame
};
const char* CreatorModeName(CreatorMode aMode);
const char* CreatorEditModeName(CreatorEditMode aEditMode);
struct CreatorOpenRequest
{
    CreatorMode mode = CreatorMode::Mirror;
    CreatorEditMode editMode = CreatorEditMode::EditTag;
    int32_t timeoutMs = 5000;
};
CreatorOpenRequest ParseCreatorOpen(const json& aParams);
// The edit tag the script layer opens the screen with: 0 NewGame, 1 HairDresser, 2 Ripperdoc (the
// gameuiCharacterCustomizationEditTag values).
int32_t CreatorEditTagCode(const CreatorOpenRequest& aRequest);

// cc.page: {page}: points the open appearance screen's preview camera at one body region, as hovering
// a row does (the menu's own RequestCameraChange). page is a name from CreatorPages; slot is the
// camera slot it stands for ("" for default: the menu's own starting slot).
struct CreatorPageRequest
{
    std::string page;
    std::string slot;
};
std::vector<std::pair<std::string, std::string>> CreatorPages();
CreatorPageRequest ParseCreatorPage(const json& aParams);

// game.options.read: {settings (default true), render_options (default true), groups: [settings
// groups, a subset of SettingsGroups], names: [render options "Category/Sub/Name", at most 128]}.
// settings are the game's user settings (graphics and display), read in script; render options are
// the engine's GameOptions, which only the CET layer can read (core/OptionsExchange.hpp).
struct GameOptionsRequest
{
    bool settings = true;
    bool renderOptions = true;
    std::vector<std::string> groups;
    std::vector<std::string> names;
};
std::vector<std::string> SettingsGroups();
std::vector<std::string> DefaultRenderOptions();
GameOptionsRequest ParseGameOptions(const json& aParams);

// photo.pose.set: one of
//   {record: "PhotoModePoses.<id>" or "<id>"}                 the pose record (its labels, found in the menu)
//   {pose: "<on-screen label>", category: "<on-screen label>"} labels as the menu shows them (category optional)
//   {category_value: n, pose_value: n}                         option data, as photo.state lists it (the undo)
// Selecting goes through the menu (attribute 5 then 6), as photo.expression.set does.
struct PoseSetRequest
{
    std::string record;
    std::string pose;
    std::string category;
    int32_t categoryValue = -1;
    int32_t poseValue = -1;
};
PoseSetRequest ParsePoseSet(const json& aParams);

// pose.live.read: {set, clip, expect_hash}: a loaded animation set by depot path (letters, digits, '_',
// '-', '.', and backslash or '/' separators, ending .anims) and a clip in it; both default to the XF
// carrier (core/LivePose.hpp). expect_hash is the offline decode's keys hash, compared and reported.
// Read-only.
struct PoseLiveReadRequest
{
    std::string set;
    std::string clip;
    std::string expectHash;
};
PoseLiveReadRequest ParsePoseLiveRead(const json& aParams);

// pose.live.apply: {joints: {"<joint name or index>": [x, y, z, w], ...}, hips: [x, y, z]} or
// {restore: true}. Rotations are unit quaternions (a length within 1% of 1, normalised here), at most
// 128 joints; hips is the Hips joint's translation in metres (each within 3 m). Writes the XF carrier
// clip only, and only with [bridge] allow_live_pose = true (LivePoseAllowed).
struct PoseLiveApplyRequest
{
    bool restore = false;
    std::vector<std::pair<std::string, std::array<float, 4>>> joints; // name or decimal index -> rotation
    std::optional<std::array<float, 3>> hips;
};
PoseLiveApplyRequest ParsePoseLiveApply(const json& aParams);
bool LivePoseAllowed(bool aConfigFlag); // throws live_pose_disabled when the flag is off

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

// world.time.set: {hours, minutes, seconds} or {total_seconds}, and target "world" | "photo" (0.5.1, RB-67):
// which clock. Without a target the phase decides (photo mode's own time of day in photo mode, the world's
// clock otherwise); the photo-mode undo names target "photo", so it can never reach the world's clock after
// photo mode closes (writes::ChooseTimeRoute). target photo takes hours and minutes only.
struct TimeRequest
{
    int32_t hours = 0;
    int32_t minutes = 0;
    int32_t seconds = 0;
    int32_t totalSeconds = -1; // >= 0: restore this exact time instead
    std::string target;        // "", "world" or "photo"
};
TimeRequest ParseTime(const json& aParams);

// world.pause: {paused}.
bool ParsePause(const json& aParams);

// ui.message: {text (1-500 characters; shown cut to MessageBoard::kMaxChars on one line), seconds (1-600,
// default 8), level ("info" default, "ask", "warn", "done"), clear (true removes every message; with no
// text, only that)}.
MessageRequest ParseMessage(const json& aParams);

// The clothing slots inventory.* works on (gamedataEquipmentArea names); nothing else is touched.
std::vector<std::string> ClothingSlots();

// inventory.equip: {item: a TweakDB item record (Items.Helmet_01_basic_01), slot (one of ClothingSlots,
// checked against the item's own), add_if_missing (default false: an item V doesn't have is refused)}.
struct InventoryEquipRequest
{
    std::string item;
    std::string slot;
    bool addIfMissing = false;
};
InventoryEquipRequest ParseInventoryEquip(const json& aParams);

// inventory.unequip: {slot or item (one of them), remove_added (default false: also remove the item from
// V's inventory, only if the bridge added it this session)}.
struct InventoryUnequipRequest
{
    std::string slot;
    std::string item;
    bool removeAdded = false;
};
InventoryUnequipRequest ParseInventoryUnequip(const json& aParams);

// game.save: {name (a label for the logs, 1-64 letters, digits, spaces, '.', '_', '-'; the game names the
// save itself), override_lock (default false), timeout_ms (2000-60000, default 20000)}.
struct GameSaveRequest
{
    std::string name;
    bool overrideLock = false;
    int32_t timeoutMs = 20000;
};
GameSaveRequest ParseGameSave(const json& aParams);

// game.load: {latest: true} or {name: a save's name in the game's list (ManualSave-12)}, and always
// discard_unsaved: true (refused without it, RB-56).
struct GameLoadRequest
{
    bool latest = false;
    std::string name;
    bool discardUnsaved = false;
};
GameLoadRequest ParseGameLoad(const json& aParams);

// Refuses parameters a method doesn't know (typos must not be silently ignored). Also used for
// methods without parameters.
void RequireOnly(const json& aParams, std::initializer_list<const char*> aKnown);

json AttributesJson(const std::vector<Attribute>& aAttributes);
} // namespace xfb::params
