#include "core/Params.hpp"

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
                {"fov", "roll", "focal_distance", "aperture", "dof", "autofocus", "look_at", "look_at_part", "subject",
                 "reset"});
    CameraRequest request;
    request.reset = Boolean(aParams, "reset").value_or(false);
    Add(request.attributes, aParams, "fov", key::kFov, 1, 180);
    Add(request.attributes, aParams, "roll", key::kRoll, -360, 360);
    Add(request.attributes, aParams, "focal_distance", key::kFocalDistance, 0, 1000);
    Add(request.attributes, aParams, "aperture", key::kAperture, 0, 100);
    AddFlag(request.attributes, aParams, "dof", key::kDepthOfField);
    AddFlag(request.attributes, aParams, "autofocus", key::kAutofocus);
    AddOption(request.attributes, aParams, "look_at", key::kLookAt);
    AddOption(request.attributes, aParams, "look_at_part", key::kLookAtPart);
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
        Bad("give at least one camera setting (fov, roll, focal_distance, aperture, dof, autofocus, look_at, "
            "look_at_part or subject), or reset = true");
    }
    return request;
}

std::string CameraParamName(int32_t aKey)
{
    switch (aKey)
    {
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
    return {key::kFov,         key::kRoll,     key::kFocalDistance, key::kAperture,     key::kDepthOfField,
            key::kAutofocus,   key::kLookAt,   key::kLookAtPart,    key::kSubjectYaw,   key::kSubjectLeftRight,
            key::kSubjectNearFar, key::kSubjectUpDown};
}

LightRequest ParseLight(const json& aParams)
{
    RequireOnly(aParams,
                {"light", "brightness", "range", "inner_angle", "outer_angle", "hue", "saturation", "luminosity",
                 "select_after"});
    LightRequest request;
    request.light = static_cast<int32_t>(Integer(aParams, "light", 1, 3).value_or(1));
    request.selectAfter = static_cast<int32_t>(Integer(aParams, "select_after", 1, 3).value_or(0));
    Add(request.attributes, aParams, "brightness", key::kLightBrightness, 0, 100);
    Add(request.attributes, aParams, "range", key::kLightRange, 0, 100);
    Add(request.attributes, aParams, "inner_angle", key::kLightInnerAngle, 0, 180);
    Add(request.attributes, aParams, "outer_angle", key::kLightOuterAngle, 0, 180);
    Add(request.attributes, aParams, "hue", key::kLightHue, 0, 360);
    Add(request.attributes, aParams, "saturation", key::kLightSaturation, 0, 100);
    Add(request.attributes, aParams, "luminosity", key::kLightLuminosity, 0, 100);
    if (request.attributes.empty())
    {
        Bad("give at least one light setting: brightness, range, inner_angle, outer_angle, hue, saturation or "
            "luminosity");
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

bool ParseHudHidden(const json& aParams)
{
    RequireOnly(aParams, {"hidden"});
    return Boolean(aParams, "hidden").value_or(true);
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
    RequireOnly(aParams, {"option", "index"});
    CharacterRequest request;
    const auto option = Text(aParams, "option", 128);
    const auto index = Integer(aParams, "index", 0, 100000);
    if (!option || !index)
    {
        Bad("'option' (the option's name or on-screen label) and 'index' (0 = first value) are required");
    }
    request.option = *option;
    request.index = static_cast<int32_t>(*index);
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
