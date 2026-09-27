#include "core/Params.hpp"

#include <algorithm>
#include <cmath>

#include "core/Dispatcher.hpp"
#include "core/LivePose.hpp"

namespace xfb::params
{
namespace
{
[[noreturn]] void Bad(const std::string& aMessage)
{
    throw MethodError("bad_params", aMessage);
}

std::string Format(double aValue)
{
    auto text = std::to_string(aValue);
    while (!text.empty() && text.back() == '0')
    {
        text.pop_back();
    }
    if (!text.empty() && text.back() == '.')
    {
        text.pop_back();
    }
    return text;
}

std::optional<double> Number(const json& aParams, const char* aKey, double aMin, double aMax)
{
    const auto it = aParams.find(aKey);
    if (it == aParams.end() || it->is_null())
    {
        return std::nullopt;
    }
    if (!it->is_number())
    {
        Bad(std::string("'") + aKey + "' must be a number");
    }
    const double value = it->get<double>();
    if (!std::isfinite(value) || value < aMin || value > aMax)
    {
        Bad(std::string("'") + aKey + "' must be between " + Format(aMin) + " and " + Format(aMax));
    }
    return value;
}

std::optional<int64_t> Integer(const json& aParams, const char* aKey, int64_t aMin, int64_t aMax)
{
    const auto it = aParams.find(aKey);
    if (it == aParams.end() || it->is_null())
    {
        return std::nullopt;
    }
    const auto outOfRange = [&] {
        Bad(std::string("'") + aKey + "' must be between " + std::to_string(aMin) + " and " + std::to_string(aMax));
    };
    // Range-checked in the value's own type before any conversion: a huge unsigned value would wrap
    // in int64_t, and converting an out-of-range double to an integer is undefined behaviour.
    if (it->is_number_unsigned())
    {
        const auto value = it->get<uint64_t>();
        if (aMax < 0 || value > static_cast<uint64_t>(aMax) || static_cast<int64_t>(value) < aMin)
        {
            outOfRange();
        }
        return static_cast<int64_t>(value);
    }
    if (it->is_number_integer())
    {
        const auto value = it->get<int64_t>();
        if (value < aMin || value > aMax)
        {
            outOfRange();
        }
        return value;
    }
    if (!it->is_number_float())
    {
        Bad(std::string("'") + aKey + "' must be a whole number");
    }
    const double value = it->get<double>();
    if (!std::isfinite(value) || std::floor(value) != value)
    {
        Bad(std::string("'") + aKey + "' must be a whole number");
    }
    if (value < static_cast<double>(aMin) || value > static_cast<double>(aMax))
    {
        outOfRange();
    }
    return static_cast<int64_t>(value);
}

std::optional<bool> Boolean(const json& aParams, const char* aKey)
{
    const auto it = aParams.find(aKey);
    if (it == aParams.end() || it->is_null())
    {
        return std::nullopt;
    }
    if (!it->is_boolean())
    {
        Bad(std::string("'") + aKey + "' must be true or false");
    }
    return it->get<bool>();
}

// Printable text without control characters, 1 to aMaxLength bytes.
std::optional<std::string> Text(const json& aParams, const char* aKey, size_t aMaxLength)
{
    const auto it = aParams.find(aKey);
    if (it == aParams.end() || it->is_null())
    {
        return std::nullopt;
    }
    if (!it->is_string())
    {
        Bad(std::string("'") + aKey + "' must be text");
    }
    auto value = it->get<std::string>();
    if (value.empty() || value.size() > aMaxLength)
    {
        Bad(std::string("'") + aKey + "' must be 1 to " + std::to_string(aMaxLength) + " characters");
    }
    for (const auto c : value)
    {
        if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f)
        {
            Bad(std::string("'") + aKey + "' contains control characters");
        }
    }
    return value;
}

void Add(std::vector<Attribute>& aOut, const json& aParams, const char* aName, int32_t aKey, double aMin, double aMax)
{
    if (const auto value = Number(aParams, aName, aMin, aMax))
    {
        aOut.push_back({aKey, static_cast<float>(*value), aName});
    }
}

void AddFlag(std::vector<Attribute>& aOut, const json& aParams, const char* aName, int32_t aKey)
{
    if (const auto value = Boolean(aParams, aName))
    {
        aOut.push_back({aKey, *value ? 1.0f : 0.0f, aName});
    }
}

void AddOption(std::vector<Attribute>& aOut, const json& aParams, const char* aName, int32_t aKey)
{
    if (const auto value = Integer(aParams, aName, 0, 1000))
    {
        aOut.push_back({aKey, static_cast<float>(*value), aName});
    }
}
} // namespace

namespace
{
// A TweakDB record name: letters, digits, '_' and '.', 3 to 128 characters, at least one dot.
bool RecordNameOk(const std::string& aName)
{
    if (aName.size() < 3 || aName.size() > 128 || aName.find('.') == std::string::npos || aName.front() == '.' || aName.back() == '.')
    {
        return false;
    }
    return std::all_of(aName.begin(), aName.end(), [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
    });
}

// A save name or label: letters, digits, spaces, '.', '_' and '-', 1 to 64 characters.
bool SaveNameOk(const std::string& aName)
{
    return !aName.empty() && aName.size() <= 64 && std::all_of(aName.begin(), aName.end(), [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ' || c == '.' || c == '_' || c == '-';
    });
}

std::string Slot(const json& aParams)
{
    const auto slot = Text(aParams, "slot", 32);
    if (!slot)
    {
        return {};
    }
    const auto slots = ClothingSlots();
    if (std::find(slots.begin(), slots.end(), *slot) == slots.end())
    {
        Bad("'slot' must be one of Head, Face, OuterChest, InnerChest, Legs, Feet or Outfit");
    }
    return *slot;
}

std::string ItemName(const json& aParams)
{
    const auto item = Text(aParams, "item", 128);
    if (!item)
    {
        return {};
    }
    if (!RecordNameOk(*item))
    {
        Bad("'item' must be an item record name such as Items.Helmet_01_basic_01");
    }
    return *item;
}
} // namespace

MessageRequest ParseMessage(const json& aParams)
{
    RequireOnly(aParams, {"text", "seconds", "level", "clear"});
    MessageRequest request;
    const auto it = aParams.find("text");
    if (it != aParams.end() && !it->is_null())
    {
        if (!it->is_string())
        {
            Bad("'text' must be text");
        }
        request.text = it->get<std::string>();
        if (request.text.empty() || request.text.size() > 500)
        {
            Bad("'text' must be 1 to 500 characters");
        }
    }
    request.seconds = static_cast<int32_t>(Integer(aParams, "seconds", 1, MessageBoard::kMaxSeconds).value_or(8));
    if (const auto level = Text(aParams, "level", 8))
    {
        if (*level != "info" && *level != "ask" && *level != "warn" && *level != "done")
        {
            Bad("'level' must be info, ask, warn or done");
        }
        request.level = *level;
    }
    request.clear = Boolean(aParams, "clear").value_or(false);
    if (request.text.empty() && !request.clear)
    {
        Bad("give text (the message) or clear: true");
    }
    if (!request.text.empty() && CleanMessageText(request.text, MessageBoard::kMaxChars).empty())
    {
        Bad("'text' has nothing to show (only spaces or control characters)");
    }
    return request;
}

std::vector<std::string> ClothingSlots()
{
    return {"Head", "Face", "OuterChest", "InnerChest", "Legs", "Feet", "Outfit"};
}

InventoryEquipRequest ParseInventoryEquip(const json& aParams)
{
    RequireOnly(aParams, {"item", "slot", "add_if_missing"});
    InventoryEquipRequest request;
    request.item = ItemName(aParams);
    if (request.item.empty())
    {
        Bad("'item' is required (an item record name such as Items.Helmet_01_basic_01)");
    }
    request.slot = Slot(aParams);
    request.addIfMissing = Boolean(aParams, "add_if_missing").value_or(false);
    return request;
}

InventoryUnequipRequest ParseInventoryUnequip(const json& aParams)
{
    RequireOnly(aParams, {"item", "slot", "remove_added"});
    InventoryUnequipRequest request;
    request.item = ItemName(aParams);
    request.slot = Slot(aParams);
    if (request.item.empty() == request.slot.empty())
    {
        Bad("give slot or item (one of them)");
    }
    request.removeAdded = Boolean(aParams, "remove_added").value_or(false);
    if (request.removeAdded && request.item.empty())
    {
        Bad("'remove_added' needs item (only an item the bridge added can be removed)");
    }
    return request;
}

GameSaveRequest ParseGameSave(const json& aParams)
{
    RequireOnly(aParams, {"name", "override_lock", "timeout_ms"});
    GameSaveRequest request;
    if (const auto name = Text(aParams, "name", 64))
    {
        if (!SaveNameOk(*name))
        {
            Bad("'name' may use letters, digits, spaces, '.', '_' and '-' only");
        }
        request.name = *name;
    }
    request.overrideLock = Boolean(aParams, "override_lock").value_or(false);
    request.timeoutMs = static_cast<int32_t>(Integer(aParams, "timeout_ms", 2000, 60000).value_or(20000));
    return request;
}

GameLoadRequest ParseGameLoad(const json& aParams)
{
    RequireOnly(aParams, {"latest", "name"});
    GameLoadRequest request;
    request.latest = Boolean(aParams, "latest").value_or(false);
    if (const auto name = Text(aParams, "name", 64))
    {
        if (!SaveNameOk(*name))
        {
            Bad("'name' may use letters, digits, spaces, '.', '_' and '-' only");
        }
        request.name = *name;
    }
    if (request.latest == !request.name.empty())
    {
        Bad("give latest: true or a save's name (one of them)");
    }
    return request;
}

void RequireOnly(const json& aParams, std::initializer_list<const char*> aKnown)
{
    if (!aParams.is_object())
    {
        Bad("parameters must be an object");
    }
    for (const auto& [name, value] : aParams.items())
    {
        bool known = false;
        for (const auto* candidate : aKnown)
        {
            known = known || name == candidate;
        }
        if (!known)
        {
            Bad("unknown parameter '" + name.substr(0, 64) + "'");
        }
    }
}

// Wide outer bounds only; the redscript layer checks each value against the exact range the
// game set up for the item (e.g. FOV 5-90, roll -180-180 in photomode.tweak).
CameraRequest ParseCamera(const json& aParams)
{
    RequireOnly(aParams,
                {"camera_preset", "fov", "roll", "focal_distance", "aperture", "dof", "autofocus", "look_at", "look_at_part",
                 "grain", "chromatic_aberration", "subject", "reset"});
    CameraRequest request;
    request.reset = Boolean(aParams, "reset").value_or(false);
    if (const auto preset = Integer(aParams, "camera_preset", 0, 9))
    {
        request.attributes.push_back({key::kCameraPreset, static_cast<float>(*preset), "camera_preset"});
    }
    Add(request.attributes, aParams, "fov", key::kFov, 1, 180);
    Add(request.attributes, aParams, "roll", key::kRoll, -360, 360);
    Add(request.attributes, aParams, "focal_distance", key::kFocalDistance, 0, 1000);
    Add(request.attributes, aParams, "aperture", key::kAperture, 0, 100);
    AddFlag(request.attributes, aParams, "dof", key::kDepthOfField);
    AddFlag(request.attributes, aParams, "autofocus", key::kAutofocus);
    AddOption(request.attributes, aParams, "look_at", key::kLookAt);
    AddOption(request.attributes, aParams, "look_at_part", key::kLookAtPart);
    Add(request.attributes, aParams, "grain", key::kGrain, 0, 1);
    Add(request.attributes, aParams, "chromatic_aberration", key::kChromaticAberration, -2, 2);
    if (const auto it = aParams.find("subject"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_object())
        {
            Bad("'subject' must be an object with yaw, left_right, near_far and up_down");
        }
        RequireOnly(*it, {"yaw", "left_right", "near_far", "up_down"});
        Add(request.attributes, *it, "yaw", key::kSubjectYaw, -360, 360);
        Add(request.attributes, *it, "left_right", key::kSubjectLeftRight, -1000, 1000);
        Add(request.attributes, *it, "near_far", key::kSubjectNearFar, -1000, 1000);
        Add(request.attributes, *it, "up_down", key::kSubjectUpDown, -1000, 1000);
        for (auto& attribute : request.attributes)
        {
            if (attribute.key == key::kSubjectYaw || attribute.key == key::kSubjectLeftRight ||
                attribute.key == key::kSubjectNearFar || attribute.key == key::kSubjectUpDown)
            {
                attribute.name = "subject." + attribute.name;
            }
        }
    }
    if (request.reset && !request.attributes.empty())
    {
        Bad("'reset' restores the values photo mode opened with; don't combine it with new values");
    }
    if (!request.reset && request.attributes.empty())
    {
        Bad("give at least one camera setting (camera_preset, fov, roll, focal_distance, aperture, dof, autofocus, "
            "look_at, look_at_part, grain, chromatic_aberration or subject), or reset = true");
    }
    return request;
}

std::string CameraParamName(int32_t aKey)
{
    switch (aKey)
    {
    case key::kCameraPreset:
        return "camera_preset";
    case key::kFov:
        return "fov";
    case key::kRoll:
        return "roll";
    case key::kFocalDistance:
        return "focal_distance";
    case key::kAperture:
        return "aperture";
    case key::kDepthOfField:
        return "dof";
    case key::kAutofocus:
        return "autofocus";
    case key::kLookAt:
        return "look_at";
    case key::kLookAtPart:
        return "look_at_part";
    case key::kGrain:
        return "grain";
    case key::kChromaticAberration:
        return "chromatic_aberration";
    case key::kSubjectYaw:
        return "subject.yaw";
    case key::kSubjectLeftRight:
        return "subject.left_right";
    case key::kSubjectNearFar:
        return "subject.near_far";
    case key::kSubjectUpDown:
        return "subject.up_down";
    default:
        return {};
    }
}

std::vector<int32_t> CameraKeys()
{
    // The preset first: resetting it moves the camera, and the other keys then reset on top.
    return {key::kCameraPreset, key::kFov, key::kRoll, key::kFocalDistance, key::kAperture, key::kDepthOfField,
            key::kAutofocus,   key::kLookAt,   key::kLookAtPart,    key::kGrain,        key::kChromaticAberration,
            key::kSubjectYaw,  key::kSubjectLeftRight, key::kSubjectNearFar, key::kSubjectUpDown};
}

namespace
{
LightPlacement ParsePlacement(const json& aValue)
{
    LightPlacement place;
    if (aValue.is_string())
    {
        if (aValue.get<std::string>() != "camera")
        {
            Bad("'place' must be \"camera\", {azimuth, elevation, distance} or {world: [x, y, z]}");
        }
        place.kind = LightPlacement::Kind::Camera;
        return place;
    }
    if (!aValue.is_object())
    {
        Bad("'place' must be \"camera\", {azimuth, elevation, distance} or {world: [x, y, z]}");
    }
    if (aValue.contains("camera"))
    {
        RequireOnly(aValue, {"camera"});
        if (aValue["camera"] != true)
        {
            Bad("'place.camera' must be true");
        }
        place.kind = LightPlacement::Kind::Camera;
        return place;
    }
    if (aValue.contains("world"))
    {
        RequireOnly(aValue, {"world"});
        const auto& world = aValue["world"];
        if (!world.is_array() || world.size() != 3)
        {
            Bad("'place.world' must be [x, y, z]");
        }
        for (size_t i = 0; i < 3; ++i)
        {
            if (!world[i].is_number() || !std::isfinite(world[i].get<double>()) || std::abs(world[i].get<double>()) > 100000.0)
            {
                Bad("'place.world' must hold three numbers (world metres)");
            }
            place.world[i] = world[i].get<float>();
        }
        place.kind = LightPlacement::Kind::World;
        return place;
    }
    RequireOnly(aValue, {"azimuth", "elevation", "distance"});
    place.kind = LightPlacement::Kind::Around;
    place.azimuth = static_cast<float>(Number(aValue, "azimuth", -180, 180).value_or(0.0));
    place.elevation = static_cast<float>(Number(aValue, "elevation", -80, 80).value_or(15.0));
    place.distance = static_cast<float>(Number(aValue, "distance", 0.2, 10).value_or(1.2));
    return place;
}
} // namespace

json PlacementJson(const LightPlacement& aPlacement)
{
    switch (aPlacement.kind)
    {
    case LightPlacement::Kind::Camera:
        return "camera";
    case LightPlacement::Kind::World:
        return json{{"world", {aPlacement.world[0], aPlacement.world[1], aPlacement.world[2]}}};
    case LightPlacement::Kind::Around:
        break;
    }
    return json{{"azimuth", aPlacement.azimuth}, {"elevation", aPlacement.elevation}, {"distance", aPlacement.distance}};
}

LightRequest ParseLight(const json& aParams)
{
    RequireOnly(aParams,
                {"light", "on", "type", "shadow", "brightness", "range", "inner_angle", "outer_angle", "hue",
                 "saturation", "luminosity", "select_after", "place"});
    LightRequest request;
    request.light = static_cast<int32_t>(Integer(aParams, "light", 1, 3).value_or(1));
    request.selectAfter = static_cast<int32_t>(Integer(aParams, "select_after", 1, 3).value_or(0));
    // The switch and the type come first: photo mode may ignore values for a light that is off.
    AddFlag(request.attributes, aParams, "on", key::kLightState);
    if (const auto type = Text(aParams, "type", 16))
    {
        if (*type != "spot" && *type != "ambient")
        {
            Bad("'type' must be \"spot\" or \"ambient\"");
        }
        request.attributes.push_back({key::kLightType, *type == "spot" ? 1.0f : 2.0f, "type"});
    }
    AddFlag(request.attributes, aParams, "shadow", key::kLightShadow);
    Add(request.attributes, aParams, "brightness", key::kLightBrightness, 0, 100);
    Add(request.attributes, aParams, "range", key::kLightRange, 0, 100);
    Add(request.attributes, aParams, "inner_angle", key::kLightInnerAngle, 0, 180);
    Add(request.attributes, aParams, "outer_angle", key::kLightOuterAngle, 0, 180);
    Add(request.attributes, aParams, "hue", key::kLightHue, 0, 360);
    Add(request.attributes, aParams, "saturation", key::kLightSaturation, 0, 100);
    Add(request.attributes, aParams, "luminosity", key::kLightLuminosity, 0, 100);
    if (const auto it = aParams.find("place"); it != aParams.end() && !it->is_null())
    {
        request.place = ParsePlacement(*it);
    }
    if (request.attributes.empty() && !request.place)
    {
        Bad("give at least one light setting: on, type, shadow, brightness, range, inner_angle, outer_angle, hue, "
            "saturation, luminosity or place");
    }
    return request;
}

int32_t ParseExpression(const json& aParams)
{
    RequireOnly(aParams, {"faceId"});
    const auto face = Integer(aParams, "faceId", 0, 100000);
    if (!face)
    {
        Bad("'faceId' is required");
    }
    return static_cast<int32_t>(*face);
}

const char* FaceTargetName(FaceTarget aTarget)
{
    return aTarget == FaceTarget::Puppet ? "puppet" : "head";
}

namespace
{
FaceTarget ParseFaceTarget(const json& aParams, FaceTarget aDefault)
{
    const auto target = Text(aParams, "target", 16);
    if (!target)
    {
        return aDefault;
    }
    if (*target == "puppet")
    {
        return FaceTarget::Puppet;
    }
    if (*target == "head")
    {
        return FaceTarget::Head;
    }
    Bad("'target' must be \"puppet\" (V's photo-mode stand-in) or \"head\" (its head item)");
}

bool ComponentNameOk(const std::string& aName)
{
    if (aName.empty() || aName.size() > 64)
    {
        return false;
    }
    for (const auto c : aName)
    {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
        if (!ok)
        {
            return false;
        }
    }
    return true;
}
} // namespace

std::vector<std::string> DefaultFaceComponents()
{
    // The photo-mode head's face rig and its two sibling animation-setup components
    // (knowledge/facial-expressions.md, research/animation/expressions-evidence.md).
    return {"face_rig", "man_face_base_animations", "PhotomodeAnimations"};
}

FaceRigRequest ParseFaceRig(const json& aParams)
{
    RequireOnly(aParams, {"target", "components"});
    FaceRigRequest request;
    request.target = ParseFaceTarget(aParams, FaceTarget::Head);
    const auto it = aParams.find("components");
    if (it == aParams.end() || it->is_null())
    {
        request.components = DefaultFaceComponents();
        return request;
    }
    if (!it->is_array() || it->empty() || it->size() > 16)
    {
        Bad("'components' must be a list of 1 to 16 component names");
    }
    for (const auto& entry : *it)
    {
        if (!entry.is_string() || !ComponentNameOk(entry.get<std::string>()))
        {
            Bad("each component name is 1 to 64 letters, digits or '_'");
        }
        const auto name = entry.get<std::string>();
        for (const auto& seen : request.components)
        {
            if (seen == name)
            {
                Bad("component '" + name + "' is listed twice");
            }
        }
        request.components.push_back(name);
    }
    return request;
}

ExpressionIndexRequest ParseExpressionIndex(const json& aParams)
{
    RequireOnly(aParams, {"index", "target", "unlisted"});
    ExpressionIndexRequest request;
    const auto index = Integer(aParams, "index", 0, 100000);
    if (!index)
    {
        Bad("'index' (the photo-mode face index, 0-100000) is required");
    }
    request.index = static_cast<int32_t>(*index);
    request.target = ParseFaceTarget(aParams, FaceTarget::Puppet);
    request.unlisted = Boolean(aParams, "unlisted").value_or(false);
    return request;
}

HudRequest ParseHud(const json& aParams)
{
    RequireOnly(aParams, {"hidden", "cursor"});
    HudRequest request;
    request.hidden = Boolean(aParams, "hidden").value_or(true);
    request.cursor = Boolean(aParams, "cursor").value_or(true);
    return request;
}

bool ParseHudHidden(const json& aParams)
{
    return ParseHud(aParams).hidden;
}

PhotoEnterRoute ParsePhotoEnter(const json& aParams)
{
    RequireOnly(aParams, {"route"});
    const auto route = Text(aParams, "route", 16).value_or("auto");
    if (route == "quest")
    {
        return PhotoEnterRoute::Quest;
    }
    if (route != "auto")
    {
        Bad("'route' must be \"auto\" or \"quest\"");
    }
    throw MethodError("photo_key_needed",
                      "the game offers no way to open the full photo mode from inside; photo.open presses the photo "
                      "mode key in the game window (or the player presses it; game.wait with phase photo_mode notices). "
                      "route \"quest\" opens a restricted photo mode and is for research only");
}

PoseSetRequest ParsePoseSet(const json& aParams)
{
    RequireOnly(aParams, {"record", "pose", "category", "category_value", "pose_value"});
    PoseSetRequest request;
    const auto record = Text(aParams, "record", 128);
    const auto pose = Text(aParams, "pose", 128);
    const auto category = Text(aParams, "category", 128);
    const auto categoryValue = Integer(aParams, "category_value", 0, 1000000);
    const auto poseValue = Integer(aParams, "pose_value", 0, 1000000);
    const int forms = (record ? 1 : 0) + (pose ? 1 : 0) + (poseValue ? 1 : 0);
    if (forms != 1)
    {
        Bad("give one of: 'record' (a pose record, e.g. PhotoModePoses.idle_stand_01), 'pose' (its on-screen label, "
            "optionally with 'category'), or 'category_value' and 'pose_value' (option data from photo.state)");
    }
    if (category && !pose)
    {
        Bad("'category' goes with 'pose'");
    }
    if (categoryValue.has_value() != poseValue.has_value())
    {
        Bad("'category_value' and 'pose_value' go together");
    }
    if (record)
    {
        for (const char c : *record)
        {
            const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
            if (!ok)
            {
                Bad("'record' takes letters, digits, '_' and '.' only");
            }
        }
        request.record = record->rfind("PhotoModePoses.", 0) == 0 ? *record : "PhotoModePoses." + *record;
    }
    request.pose = pose.value_or("");
    request.category = category.value_or("");
    request.categoryValue = categoryValue ? static_cast<int32_t>(*categoryValue) : -1;
    request.poseValue = poseValue ? static_cast<int32_t>(*poseValue) : -1;
    return request;
}

PoseLiveReadRequest ParsePoseLiveRead(const json& aParams)
{
    RequireOnly(aParams, {"set", "clip", "expect_hash"});
    PoseLiveReadRequest request;
    request.set = Text(aParams, "set", 216).value_or(livepose::kCarrierSet);
    request.clip = Text(aParams, "clip", 128).value_or(livepose::kCarrierClip);
    for (const char c : request.set)
    {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' ||
                        c == '.' || c == '\\' || c == '/';
        if (!ok)
        {
            Bad("'set' is a depot path (letters, digits, '_', '-', '.', and backslash or '/')");
        }
    }
    if (request.set.size() < 7 || request.set.compare(request.set.size() - 6, 6, ".anims") != 0 ||
        request.set.find("..") != std::string::npos)
    {
        Bad("'set' must be an animation set's depot path ending .anims");
    }
    for (const char c : request.clip)
    {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
        if (!ok)
        {
            Bad("'clip' takes letters, digits, '_', '-' and '.' only");
        }
    }
    request.expectHash = Text(aParams, "expect_hash", 16).value_or("");
    if (!request.expectHash.empty() &&
        (request.expectHash.size() != 16 || request.expectHash.find_first_not_of("0123456789abcdef") != std::string::npos))
    {
        Bad("'expect_hash' is 16 lowercase hex digits (the carrier build's keys_hash)");
    }
    return request;
}

PoseLiveApplyRequest ParsePoseLiveApply(const json& aParams)
{
    RequireOnly(aParams, {"joints", "hips", "restore"});
    PoseLiveApplyRequest request;
    request.restore = Boolean(aParams, "restore").value_or(false);
    const auto joints = aParams.find("joints");
    const auto hips = aParams.find("hips");
    const bool hasJoints = joints != aParams.end() && !joints->is_null();
    const bool hasHips = hips != aParams.end() && !hips->is_null();
    if (request.restore)
    {
        if (hasJoints || hasHips)
        {
            Bad("'restore' puts the carrier's own keys back and takes nothing else");
        }
        return request;
    }
    if (!hasJoints && !hasHips)
    {
        Bad("give 'joints' ({\"RightForeArm\": [x, y, z, w], ...}) and/or 'hips' ([x, y, z]), or 'restore': true");
    }
    const auto numbers = [](const json& aValue, size_t aCount, const std::string& aWhat) {
        if (!aValue.is_array() || aValue.size() != aCount)
        {
            Bad(aWhat + " must be a list of " + std::to_string(aCount) + " numbers");
        }
        std::vector<double> out;
        for (const auto& item : aValue)
        {
            if (!item.is_number() || !std::isfinite(item.get<double>()))
            {
                Bad(aWhat + " must be a list of " + std::to_string(aCount) + " finite numbers");
            }
            out.push_back(item.get<double>());
        }
        return out;
    };
    if (hasJoints)
    {
        if (!joints->is_object() || joints->empty() || joints->size() > 128)
        {
            Bad("'joints' maps 1 to 128 joint names (or indices) to rotations [x, y, z, w]");
        }
        for (const auto& [name, value] : joints->items())
        {
            if (name.empty() || name.size() > 64 ||
                name.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_") != std::string::npos)
            {
                Bad("joint names are letters, digits and '_' (or a joint index)");
            }
            const auto q = numbers(value, 4, "the rotation of '" + name + "'");
            const double length = std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
            if (std::fabs(length - 1.0) > 0.01)
            {
                Bad("the rotation of '" + name + "' must be a unit quaternion [x, y, z, w] (its length is " + Format(length) + ")");
            }
            request.joints.push_back({name, {static_cast<float>(q[0] / length), static_cast<float>(q[1] / length),
                                             static_cast<float>(q[2] / length), static_cast<float>(q[3] / length)}});
        }
    }
    if (hasHips)
    {
        const auto v = numbers(*hips, 3, "'hips'");
        for (const double c : v)
        {
            if (std::fabs(c) > 3.0)
            {
                Bad("'hips' values must be within 3 m");
            }
        }
        request.hips = std::array<float, 3>{static_cast<float>(v[0]), static_cast<float>(v[1]), static_cast<float>(v[2])};
    }
    return request;
}

bool LivePoseAllowed(bool aConfigFlag)
{
    if (!aConfigFlag)
    {
        throw MethodError("live_pose_disabled",
                          "writing the live-pose carrier is switched off ([bridge] allow_live_pose = false; only the test "
                          "profile's -writes package allows it)");
    }
    return true;
}

bool CreatorLeaveAllowed(bool aConfigFlag)
{
    if (!aConfigFlag)
    {
        throw MethodError("creator_leave_disabled",
                          "opening, confirming or backing out of the character creator is switched off ([bridge] "
                          "allow_creator_leave = false; only the test profile's -writes package allows it); the "
                          "player opens it, or presses Confirm or Back");
    }
    return true;
}

SubjectRequest ParseSubject(const json& aParams)
{
    RequireOnly(aParams, {"up", "forward", "right"});
    SubjectRequest request;
    request.up = static_cast<float>(Number(aParams, "up", -2, 2).value_or(0.0));
    request.forward = static_cast<float>(Number(aParams, "forward", -2, 2).value_or(0.0));
    request.right = static_cast<float>(Number(aParams, "right", -2, 2).value_or(0.0));
    return request;
}

PhotoStateRequest ParsePhotoState(const json& aParams)
{
    RequireOnly(aParams, {"menu", "options"});
    PhotoStateRequest request;
    request.options = Boolean(aParams, "options").value_or(false);
    request.menu = Boolean(aParams, "menu").value_or(false) || request.options;
    return request;
}

CharacterRequest ParseCharacterApply(const json& aParams)
{
    RequireOnly(aParams, {"option", "index", "value"});
    CharacterRequest request;
    const auto option = Text(aParams, "option", 128);
    const auto index = Integer(aParams, "index", 0, 100000);
    const auto value = Text(aParams, "value", 128);
    if (!option || (!index && !value))
    {
        Bad("'option' (the option's name, on-screen label or slot) and 'index' (0 = first value) or 'value' (the "
            "value's name or on-screen label) are required");
    }
    if (index && value)
    {
        Bad("give either 'index' or 'value', not both");
    }
    request.option = *option;
    request.index = index ? static_cast<int32_t>(*index) : -1;
    request.value = value.value_or("");
    return request;
}

const char* CreatorModeName(CreatorMode aMode)
{
    return aMode == CreatorMode::Ripperdoc ? "ripperdoc" : "mirror";
}

CreatorOpenRequest ParseCreatorOpen(const json& aParams)
{
    RequireOnly(aParams, {"mode", "timeout_ms"});
    CreatorOpenRequest request;
    const auto mode = Text(aParams, "mode", 16).value_or("mirror");
    if (mode == "ripperdoc")
    {
        request.mode = CreatorMode::Ripperdoc;
    }
    else if (mode != "mirror")
    {
        Bad("'mode' must be \"mirror\" (hair, make-up, eye colour, piercings and XF rows) or \"ripperdoc\" (also the face "
            "shape, skin and cyberware rows)");
    }
    request.timeoutMs = static_cast<int32_t>(Integer(aParams, "timeout_ms", 500, 15000).value_or(5000));
    return request;
}

std::vector<std::pair<std::string, std::string>> CreatorPages()
{
    // The creator's preview-camera slots (characterCreationBodyMorphMenu.GetSlotName, 2.31), by the
    // name the tools use. "default" is the menu's own starting slot.
    return {{"skin", "UI_Skin"},   {"hair", "UI_Hairs"}, {"eyes", "UI_Eyes"}, {"teeth", "UI_Teeth"},
            {"nose", "UI_Nose"},   {"lips", "UI_Lips"},  {"jaw", "UI_Jaw"},   {"head", "UI_HeadPreview"},
            {"nails", "UI_FingerNails"}, {"body", "UI_Preview"}, {"default", ""}};
}

CreatorPageRequest ParseCreatorPage(const json& aParams)
{
    RequireOnly(aParams, {"page"});
    const auto page = Text(aParams, "page", 16);
    if (!page)
    {
        Bad("'page' is required: skin, hair, eyes, teeth, nose, lips, jaw, head, nails, body or default");
    }
    for (const auto& [name, slot] : CreatorPages())
    {
        if (name == *page)
        {
            return {name, slot};
        }
    }
    Bad("'page' must be one of skin, hair, eyes, teeth, nose, lips, jaw, head, nails, body or default");
}

std::vector<std::string> SettingsGroups()
{
    // The user-settings groups game.options.read may read (r6/config/settings/platform/pc/options.json,
    // 2.31): the upscaler, ray and path tracing, the advanced graphics (subsurface scattering quality
    // among them), the basic camera effects, crowd density and the display (HDR).
    return {"/graphics/presets", "/graphics/advanced", "/graphics/raytracing", "/graphics/basic",
            "/graphics/performance", "/video/display"};
}

std::vector<std::string> DefaultRenderOptions()
{
    // The engine's character render options that decide how V looks in a capture, as named by the
    // hair and skin shader references (research/materials/shader-hair.md §6.4, knowledge/head-cc-rendering.md
    // §2): "<category>/<name>", the category being everything before the last '/'.
    std::vector<std::string> out;
    for (const char* light : {"GlobalLight", "LocalLight", "EnvProbe"})
    {
        for (const char* term : {"R", "TT", "TRT", "MultiScatter", "ScatterDepth"})
        {
            out.push_back(std::string("Editor/Characters/Hair/") + light + "/" + term);
        }
    }
    for (const char* name :
         {"Editor/Characters/Hair/AlphaShifts/R", "Editor/Characters/Hair/AlphaShifts/TT", "Editor/Characters/Hair/AlphaShifts/TRT",
          "Editor/Characters/Hair/RoughnessFactor", "Editor/Characters/Hair/AlbedoMultiplier",
          "Editor/Characters/Hair/SpecularRandom_Min", "Editor/Characters/Hair/SpecularRandom_Max",
          "Editor/Characters/Hair/AdditionalAreaRoughness", "Editor/Characters/Hair/ContactShadowClamp",
          "Editor/Characters/Hair/UseGlobalContactShadowsOnHair", "Editor/Characters/Hair/UseLocalContactShadowsOnHair",
          "Editor/Characters/Hair/UseReferenceImplementation", "Editor/Characters/Hair/MultiScatter/Wrap",
          "Editor/Characters/Hair/MultiScatter/DiffuseScatterFactor", "Editor/Characters/Hair/MultiScatter/ShadowFactorExp",
          "Editor/Characters/Hair/MultiScatter/Mask_Intensity", "Editor/Characters/Hair/Specular/Wrap",
          "Editor/Characters/Hair/Specular/Mask_Intensity", "Editor/Characters/Hair/TRT_Params/EXP_SCALE",
          "Editor/Characters/Hair/TRT_Params/EXP_BIAS", "Editor/Characters/Hair/Debug/DebugSwitch1",
          "Editor/Characters/Hair/Debug/DebugSwitch2", "Editor/Characters/Skin/SkinAmbientIntensity_Factor",
          "Editor/Characters/Skin/SkinAmbientMix_Factor", "Editor/Characters/Skin/AllowSkinAmbientMix",
          "Editor/Characters/Skin/SubsurfaceSpecularTintWeight", "Editor/Characters/Skin/SubsurfaceSpecularTint_R",
          "Editor/Characters/Skin/SubsurfaceSpecularTint_G", "Editor/Characters/Skin/SubsurfaceSpecularTint_B",
          "Editor/Characters/RimEnhancement/GlobalCharacterFresnel", "Editor/Characters/RimEnhancement/LightBlockerInfluence",
          "Editor/Characters/Eyes/DiffuseBoost", "Editor/Characters/Eyes/UseAOOnEyes",
          "Developer/FeatureToggles/CharacterSubsurfaceScattering", "Developer/FeatureToggles/CharacterRimEnhancement",
          "Developer/FeatureToggles/ContactShadows", "Developer/FeatureToggles/Hair"})
    {
        out.emplace_back(name);
    }
    return out;
}

namespace
{
bool RenderOptionNameOk(const std::string& aName)
{
    if (aName.size() < 3 || aName.size() > 128 || aName.front() == '/' || aName.back() == '/' ||
        aName.find('/') == std::string::npos || aName.find("//") != std::string::npos)
    {
        return false;
    }
    for (const auto c : aName)
    {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '/';
        if (!ok)
        {
            return false;
        }
    }
    return true;
}

std::vector<std::string> NameList(const json& aParams, const char* aKey, size_t aMax, const std::vector<std::string>& aAllowed,
                                  bool (*aShapeOk)(const std::string&), const char* aWhat)
{
    const auto it = aParams.find(aKey);
    if (!it->is_array() || it->empty() || it->size() > aMax)
    {
        Bad(std::string("'") + aKey + "' must be a list of 1 to " + std::to_string(aMax) + " " + aWhat);
    }
    std::vector<std::string> out;
    for (const auto& entry : *it)
    {
        if (!entry.is_string())
        {
            Bad(std::string("each entry of '") + aKey + "' must be text");
        }
        const auto name = entry.get<std::string>();
        if (aShapeOk && !aShapeOk(name))
        {
            Bad("'" + name.substr(0, 64) + "' isn't a " + aWhat + " name (\"Category/Sub/Name\": letters, digits and _)");
        }
        if (!aAllowed.empty() && std::find(aAllowed.begin(), aAllowed.end(), name) == aAllowed.end())
        {
            Bad("'" + name.substr(0, 64) + "' isn't one of the settings groups game.options.read reads");
        }
        if (std::find(out.begin(), out.end(), name) != out.end())
        {
            Bad("'" + name.substr(0, 64) + "' is listed twice");
        }
        out.push_back(name);
    }
    return out;
}
} // namespace

GameOptionsRequest ParseGameOptions(const json& aParams)
{
    RequireOnly(aParams, {"settings", "render_options", "groups", "names"});
    GameOptionsRequest request;
    request.settings = Boolean(aParams, "settings").value_or(true);
    request.renderOptions = Boolean(aParams, "render_options").value_or(true);
    if (!request.settings && !request.renderOptions)
    {
        Bad("'settings' and 'render_options' can't both be false: there would be nothing to read");
    }
    request.groups = aParams.contains("groups") && !aParams["groups"].is_null()
                         ? NameList(aParams, "groups", 6, SettingsGroups(), nullptr, "settings groups")
                         : SettingsGroups();
    request.names = aParams.contains("names") && !aParams["names"].is_null()
                        ? NameList(aParams, "names", 128, {}, &RenderOptionNameOk, "render option")
                        : DefaultRenderOptions();
    return request;
}

AppearanceRequest ParseAppearance(const json& aParams)
{
    RequireOnly(aParams, {"option", "check"});
    AppearanceRequest request;
    request.option = Text(aParams, "option", 128).value_or("");
    if (const auto it = aParams.find("check"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > 16)
        {
            Bad("'check' must be a list of at most 16 {group, option, fpp} entries");
        }
        for (const auto& entry : *it)
        {
            if (!entry.is_object())
            {
                Bad("each 'check' entry must be {group, option, fpp}");
            }
            RequireOnly(entry, {"group", "option", "fpp"});
            const auto group = Text(entry, "group", 128);
            const auto option = Text(entry, "option", 128);
            if (!group || !option)
            {
                Bad("each 'check' entry needs 'group' and 'option'");
            }
            request.checks.push_back({*group, *option, Boolean(entry, "fpp").value_or(false)});
        }
    }
    return request;
}

TimeRequest ParseTime(const json& aParams)
{
    RequireOnly(aParams, {"hours", "minutes", "seconds", "total_seconds"});
    TimeRequest request;
    const auto total = Integer(aParams, "total_seconds", 0, 2147483647LL);
    const auto hours = Integer(aParams, "hours", 0, 23);
    if (total && (hours || aParams.contains("minutes") || aParams.contains("seconds")))
    {
        Bad("give either hours/minutes/seconds or total_seconds, not both");
    }
    if (total)
    {
        request.totalSeconds = static_cast<int32_t>(*total);
        return request;
    }
    if (!hours)
    {
        Bad("'hours' (0-23) is required, or 'total_seconds' to restore an exact earlier time");
    }
    request.hours = static_cast<int32_t>(*hours);
    request.minutes = static_cast<int32_t>(Integer(aParams, "minutes", 0, 59).value_or(0));
    request.seconds = static_cast<int32_t>(Integer(aParams, "seconds", 0, 59).value_or(0));
    return request;
}

bool ParsePause(const json& aParams)
{
    RequireOnly(aParams, {"paused"});
    const auto paused = Boolean(aParams, "paused");
    if (!paused)
    {
        Bad("'paused' (true or false) is required");
    }
    return *paused;
}

json AttributesJson(const std::vector<Attribute>& aAttributes)
{
    json out = json::array();
    for (const auto& attribute : aAttributes)
    {
        out.push_back({{"name", attribute.name}, {"key", attribute.key}, {"value", attribute.value}});
    }
    return out;
}
} // namespace xfb::params
