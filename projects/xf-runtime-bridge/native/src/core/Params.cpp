#include "core/Params.hpp"

#include <algorithm>
#include <cmath>

#include "core/Dispatcher.hpp"

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

LightRequest ParseLight(const json& aParams)
{
    RequireOnly(aParams,
                {"light", "on", "type", "shadow", "brightness", "range", "inner_angle", "outer_angle", "hue",
                 "saturation", "luminosity", "select_after"});
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
    if (request.attributes.empty())
    {
        Bad("give at least one light setting: on, type, shadow, brightness, range, inner_angle, outer_angle, hue, "
            "saturation or luminosity");
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
