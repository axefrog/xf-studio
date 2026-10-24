#include "core/Dm080.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <initializer_list>

#include "core/Dispatcher.hpp"
#include "core/Params.hpp"

namespace xfb::dm
{
namespace p = xfb::params;

namespace
{
constexpr double kPi = 3.14159265358979323846;

[[noreturn]] void Bad(const std::string& aMessage)
{
    throw MethodError("bad_params", aMessage);
}

bool IsDigits(const std::string& aText)
{
    return !aText.empty() && std::all_of(aText.begin(), aText.end(), [](char c) { return c >= '0' && c <= '9'; });
}

bool NameChars(const std::string& aText, size_t aMax, const char* aExtra)
{
    if (aText.empty() || aText.size() > aMax)
    {
        return false;
    }
    return std::all_of(aText.begin(), aText.end(), [aExtra](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' ||
               (aExtra != nullptr && std::strchr(aExtra, c) != nullptr && c != '\0');
    });
}

std::string Lower(std::string aText)
{
    std::transform(aText.begin(), aText.end(), aText.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return aText;
}

void RequireObject(const json& aValue, const std::string& aWhere)
{
    if (!aValue.is_object())
    {
        Bad("'" + aWhere + "' must be an object");
    }
}

void RequireOnlyIn(const json& aValue, std::initializer_list<const char*> aKnown, const std::string& aWhere)
{
    RequireObject(aValue, aWhere);
    for (const auto& [name, value] : aValue.items())
    {
        bool known = false;
        for (const auto* candidate : aKnown)
        {
            known = known || name == candidate;
        }
        if (!known)
        {
            Bad("unknown parameter '" + name.substr(0, 64) + "' in " + aWhere);
        }
    }
}

// A required text of 1..aMax characters without control characters.
std::string RequiredText(const json& aParams, const char* aKey, size_t aMax, const std::string& aWhat)
{
    const auto text = p::CheckText(aParams, aKey, aMax);
    if (!text)
    {
        Bad("'" + std::string(aKey) + "' is required: " + aWhat);
    }
    return *text;
}

std::string OptionalText(const json& aParams, const char* aKey, size_t aMax)
{
    return p::CheckText(aParams, aKey, aMax).value_or(std::string());
}

std::string OneOf(const json& aParams, const char* aKey, const std::vector<std::string>& aValues, const std::string& aDefault)
{
    const auto text = p::CheckText(aParams, aKey, 48);
    if (!text)
    {
        if (aDefault.empty())
        {
            std::string list;
            for (const auto& value : aValues)
            {
                list += (list.empty() ? "" : ", ") + value;
            }
            Bad("'" + std::string(aKey) + "' is required: one of " + list);
        }
        return aDefault;
    }
    if (std::find(aValues.begin(), aValues.end(), *text) == aValues.end())
    {
        std::string list;
        for (const auto& value : aValues)
        {
            list += (list.empty() ? "" : ", ") + value;
        }
        Bad("'" + std::string(aKey) + "' must be one of " + list);
    }
    return *text;
}

std::string Clock(double aSeconds)
{
    if (aSeconds < 0.0)
    {
        return "";
    }
    const auto total = static_cast<int64_t>(std::floor(aSeconds)) % 86400;
    char buffer[16];
    std::snprintf(buffer, sizeof(buffer), "%02d:%02d", static_cast<int>(total / 3600), static_cast<int>((total / 60) % 60));
    return buffer;
}

double Distance(const std::array<double, 3>& aA, const std::array<double, 3>& aB)
{
    const double dx = aA[0] - aB[0], dy = aA[1] - aB[1], dz = aA[2] - aB[2];
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

uint32_t Mix(uint32_t aX)
{
    aX ^= aX >> 16;
    aX *= 0x7feb352dU;
    aX ^= aX >> 15;
    aX *= 0x846ca68bU;
    aX ^= aX >> 16;
    return aX;
}

json Arr(const std::array<double, 3>& aPoint)
{
    return json::array({std::round(aPoint[0] * 100.0) / 100.0, std::round(aPoint[1] * 100.0) / 100.0, std::round(aPoint[2] * 100.0) / 100.0});
}
} // namespace

// ---- shared pieces ------------------------------------------------------------------------------------------------------

Where ParseWhere(const json& aParams)
{
    Where where;
    const bool hasAt = aParams.contains("at") && !aParams["at"].is_null();
    const bool hasOffset = aParams.contains("offset") && !aParams["offset"].is_null();
    if (hasAt && hasOffset)
    {
        Bad("give at (a world point) or offset (from V), not both");
    }
    if (hasAt)
    {
        where.mode = Where::Mode::World;
        where.point = *p::CheckPoint(aParams, "at", 1e5);
    }
    else if (hasOffset)
    {
        const auto& offset = aParams["offset"];
        RequireOnlyIn(offset, {"forward", "right", "up"}, "offset");
        where.forward = p::CheckNumber(offset, "forward", -kMaxSpawnDistance, kMaxSpawnDistance).value_or(0.0);
        where.right = p::CheckNumber(offset, "right", -kMaxSpawnDistance, kMaxSpawnDistance).value_or(0.0);
        where.up = p::CheckNumber(offset, "up", -20.0, 20.0).value_or(0.0);
    }
    where.yaw = p::CheckNumber(aParams, "yaw", -360.0, 360.0);
    where.faceV = p::CheckBoolean(aParams, "face_v").value_or(false);
    if (where.yaw && where.faceV)
    {
        Bad("give yaw or face_v, not both");
    }
    return where;
}

json WhereJson(const Where& aWhere)
{
    json out;
    if (aWhere.mode == Where::Mode::World)
    {
        out["at"] = Arr(aWhere.point);
    }
    else
    {
        out["offset"] = {{"forward", aWhere.forward}, {"right", aWhere.right}, {"up", aWhere.up}};
    }
    if (aWhere.yaw)
    {
        out["yaw"] = *aWhere.yaw;
    }
    if (aWhere.faceV)
    {
        out["face_v"] = true;
    }
    return out;
}

bool TargetOk(const std::string& aText, std::initializer_list<const char*> aAllowed)
{
    for (const auto* word : aAllowed)
    {
        if (aText == word)
        {
            return true;
        }
    }
    if (aText.rfind("spawn:", 0) == 0)
    {
        const auto rest = aText.substr(6);
        return IsDigits(rest) && rest.size() <= 6 && rest != "0";
    }
    // An entity id as the bridge answers it (player.state, scene.read: EntityID(123)), or its digits alone.
    if (aText.rfind("EntityID(", 0) == 0 && aText.size() > 10 && aText.back() == ')')
    {
        const auto inner = aText.substr(9, aText.size() - 10);
        return IsDigits(inner) && inner.size() <= 20;
    }
    return IsDigits(aText) && aText.size() <= 20;
}

int32_t SpawnHandleOf(const std::string& aTarget)
{
    if (aTarget.rfind("spawn:", 0) != 0)
    {
        return 0;
    }
    const auto rest = aTarget.substr(6);
    return IsDigits(rest) && rest.size() <= 6 ? static_cast<int32_t>(std::stoi(rest)) : 0;
}

std::string ParseTarget(const json& aParams, const char* aKey, bool aRequired, std::initializer_list<const char*> aAllowed)
{
    const auto text = p::CheckText(aParams, aKey, 32);
    if (!text)
    {
        if (aRequired)
        {
            std::string words;
            for (const auto* word : aAllowed)
            {
                words += std::string(words.empty() ? "" : ", ") + word;
            }
            Bad("'" + std::string(aKey) + "' is required: " + (words.empty() ? "" : words + ", ") +
                "spawn:<n> (something the bridge spawned) or an entity id (EntityID(123), as world_spawned, scene_read and player_state give it)");
        }
        return {};
    }
    if (!TargetOk(*text, aAllowed))
    {
        std::string words;
        for (const auto* word : aAllowed)
        {
            words += std::string(words.empty() ? "" : ", ") + word;
        }
        Bad("'" + std::string(aKey) + "' must be " + (words.empty() ? "" : words + ", ") + "spawn:<n> or an entity id such as EntityID(123)");
    }
    return *text;
}

std::array<int32_t, 3> ParseColour(const json& aParams, const char* aKey, std::array<int32_t, 3> aDefault)
{
    const auto it = aParams.find(aKey);
    if (it == aParams.end() || it->is_null())
    {
        return aDefault;
    }
    std::array<int32_t, 3> out{};
    if (it->is_string())
    {
        const auto text = it->get<std::string>();
        if (text.size() != 7 || text[0] != '#' || !std::all_of(text.begin() + 1, text.end(), [](char c) { return std::isxdigit(static_cast<unsigned char>(c)) != 0; }))
        {
            Bad("'" + std::string(aKey) + "' must be [r, g, b] (0-255) or \"#rrggbb\"");
        }
        for (int i = 0; i < 3; ++i)
        {
            out[static_cast<size_t>(i)] = static_cast<int32_t>(std::stoi(text.substr(1 + static_cast<size_t>(i) * 2, 2), nullptr, 16));
        }
        return out;
    }
    if (!it->is_array() || it->size() != 3)
    {
        Bad("'" + std::string(aKey) + "' must be [r, g, b] (0-255) or \"#rrggbb\"");
    }
    for (size_t i = 0; i < 3; ++i)
    {
        const auto& v = (*it)[i];
        if (!v.is_number_integer() || v.get<int64_t>() < 0 || v.get<int64_t>() > 255)
        {
            Bad("'" + std::string(aKey) + "' must be three whole numbers from 0 to 255");
        }
        out[i] = static_cast<int32_t>(v.get<int64_t>());
    }
    return out;
}

bool TemplatePathOk(const std::string& aPath)
{
    if (aPath.size() < 5 || aPath.size() > 200 || aPath.front() == '\\' || aPath.front() == '/')
    {
        return false;
    }
    if (Lower(aPath.substr(aPath.size() - 4)) != ".ent" || aPath.find("..") != std::string::npos)
    {
        return false;
    }
    return std::all_of(aPath.begin(), aPath.end(), [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' || c == '\\' || c == '/';
    });
}

bool EventNameOk(const std::string& aName)
{
    return NameChars(aName, 96, nullptr);
}

bool IdOk(const std::string& aId)
{
    return NameChars(aId, 48, "-.");
}

// ---- props and vehicles -------------------------------------------------------------------------------------------------

SpawnRequest ParseSpawn(const json& aParams)
{
    p::RequireOnly(aParams, {"kind", "template", "record", "appearance", "at", "offset", "yaw", "face_v", "label", "ground"});
    SpawnRequest request;
    request.kind = OneOf(aParams, "kind", {"prop", "vehicle"}, "prop");
    if (const auto path = p::CheckText(aParams, "template", 200))
    {
        if (!TemplatePathOk(*path))
        {
            Bad("'template' must be an entity template's depot path ending in .ent (letters, digits, \\ / _ - .), such as base\\gameplay\\devices\\...\\x.ent");
        }
        request.templatePath = *path;
    }
    if (const auto record = p::CheckText(aParams, "record", 128))
    {
        if (!p::CheckRecordName(*record))
        {
            Bad("'record' must be a TweakDB record name such as Vehicle.v_standard2_archer_hella_player");
        }
        request.record = *record;
    }
    if (request.kind == "vehicle" && request.record.empty())
    {
        Bad("a vehicle needs record: its TweakDB record, such as Vehicle.v_standard2_archer_hella_player");
    }
    if (request.kind == "vehicle" && !request.templatePath.empty())
    {
        Bad("a vehicle spawns from its record only; leave template out");
    }
    if (request.templatePath.empty() == request.record.empty())
    {
        Bad("give template (an entity template path) or record (a TweakDB record), one of them");
    }
    if (const auto appearance = p::CheckText(aParams, "appearance", 64))
    {
        if (!NameChars(*appearance, 64, "-."))
        {
            Bad("'appearance' must be an appearance name (letters, digits, _ - .)");
        }
        request.appearance = *appearance;
    }
    request.where = ParseWhere(aParams);
    request.label = OptionalText(aParams, "label", 48);
    request.ground = p::CheckBoolean(aParams, "ground").value_or(true);
    return request;
}

json SpawnUndo(int32_t aHandle)
{
    return json{{"method", "world.despawn"}, {"params", {{"id", aHandle}}}};
}

json DespawnUndo(const json& aRemoved)
{
    json undos = json::array();
    if (aRemoved.is_array())
    {
        for (const auto& spec : aRemoved)
        {
            if (!spec.is_object() || spec.value("kind", std::string()) == "light" || spec.value("kind", std::string()) == "emitter")
            {
                continue; // lights and emitters come back through light.spawn / audio.play, not world.spawn
            }
            json params{{"kind", spec.value("kind", std::string("prop"))}, {"ground", false}};
            if (const auto t = spec.value("template", std::string()); !t.empty())
            {
                params["template"] = t;
            }
            if (const auto r = spec.value("record", std::string()); !r.empty())
            {
                params["record"] = r;
            }
            if (const auto a = spec.value("appearance", std::string()); !a.empty())
            {
                params["appearance"] = a;
            }
            if (spec.contains("position"))
            {
                params["at"] = spec["position"];
            }
            if (spec.contains("yaw"))
            {
                params["yaw"] = spec["yaw"];
            }
            if (const auto l = spec.value("label", std::string()); !l.empty())
            {
                params["label"] = l;
            }
            undos.push_back(json{{"method", "world.spawn"}, {"params", params}});
        }
    }
    return undos;
}

DespawnRequest ParseDespawn(const json& aParams)
{
    p::RequireOnly(aParams, {"id", "all"});
    DespawnRequest request;
    request.all = p::CheckBoolean(aParams, "all").value_or(false);
    request.handle = static_cast<int32_t>(p::CheckInteger(aParams, "id", 1, 1000000).value_or(-1));
    if (request.all == (request.handle > 0))
    {
        Bad("give id (what world_spawn answered) or all: true, one of them");
    }
    return request;
}

DoorRequest ParseDoor(const json& aParams)
{
    p::RequireOnly(aParams, {"target", "open", "locked", "sealed"});
    DoorRequest request;
    request.target = ParseTarget(aParams, "target", true, {"look_at"});
    request.open = p::CheckBoolean(aParams, "open");
    request.locked = p::CheckBoolean(aParams, "locked");
    request.sealed = p::CheckBoolean(aParams, "sealed");
    if (!request.open && !request.locked && !request.sealed)
    {
        Bad("give open, locked or sealed (true or false)");
    }
    if (request.open.value_or(false) && (request.locked.value_or(false) || request.sealed.value_or(false)))
    {
        Bad("an open door can't be locked or sealed; open it, or close and lock it");
    }
    return request;
}

json DoorUndo(const json& aStep, const DoorRequest& aRequest)
{
    const auto before = aStep.value("before", json::object());
    const auto id = aStep.value("target_id", std::string());
    if (!before.is_object() || id.empty())
    {
        return nullptr;
    }
    json params{{"target", id}};
    bool changes = false;
    const auto put = [&](const char* aKey, const std::optional<bool>& aAsked) {
        if (aAsked && before.contains(aKey) && before[aKey].is_boolean() && before[aKey].get<bool>() != *aAsked)
        {
            params[aKey] = before[aKey].get<bool>();
            changes = true;
        }
    };
    put("open", aRequest.open);
    put("locked", aRequest.locked);
    put("sealed", aRequest.sealed);
    // Opening unlocks and unseals a door (the quest action does both): the undo relocks or reseals it too.
    if (aRequest.open.value_or(false))
    {
        for (const char* key : {"locked", "sealed"})
        {
            if (before.value(key, false))
            {
                params[key] = true;
                changes = true;
            }
        }
        if (params.value("locked", false) || params.value("sealed", false))
        {
            params["open"] = false;
        }
    }
    return changes ? json{{"method", "world.door"}, {"params", params}} : json(nullptr);
}

VehicleRequest ParseVehicle(const json& aParams)
{
    p::RequireOnly(aParams, {"target", "lights", "engine", "door", "door_state"});
    VehicleRequest request;
    request.target = ParseTarget(aParams, "target", true, {"look_at", "mounted"});
    request.lights = p::CheckBoolean(aParams, "lights");
    request.engine = p::CheckBoolean(aParams, "engine");
    const bool hasDoor = aParams.contains("door") && !aParams["door"].is_null();
    const bool hasState = aParams.contains("door_state") && !aParams["door_state"].is_null();
    if (hasDoor != hasState)
    {
        Bad("give door and door_state together (door_state: open, closed, locked or unlocked)");
    }
    if (hasDoor)
    {
        request.door = OneOf(aParams, "door", VehicleDoors(), "");
        request.doorState = OneOf(aParams, "door_state", {"open", "closed", "locked", "unlocked"}, "");
    }
    if (!request.lights && !request.engine && request.door.empty())
    {
        Bad("give lights, engine, or door with door_state");
    }
    return request;
}

json VehicleUndo(const json& aStep, const VehicleRequest& aRequest)
{
    const auto id = aStep.value("target_id", std::string());
    const auto before = aStep.value("before", json::object());
    if (id.empty())
    {
        return nullptr;
    }
    json params{{"target", id}};
    bool changes = false;
    if (aRequest.lights)
    {
        // The game has no script read of the headlights: the undo switches them back the other way.
        const bool was = before.contains("lights") && before["lights"].is_boolean() ? before["lights"].get<bool>() : !*aRequest.lights;
        if (was != *aRequest.lights)
        {
            params["lights"] = was;
            changes = true;
        }
    }
    if (aRequest.engine && before.contains("engine") && before["engine"].is_boolean() && before["engine"].get<bool>() != *aRequest.engine)
    {
        params["engine"] = before["engine"].get<bool>();
        changes = true;
    }
    if (!aRequest.door.empty())
    {
        std::string back;
        if (aRequest.doorState == "open" || aRequest.doorState == "closed")
        {
            const auto doors = before.value("doors", json::object());
            // "all": back to closed unless every door was open.
            if (aRequest.door == "all")
            {
                bool allOpen = !doors.empty();
                for (const auto& [name, state] : doors.items())
                {
                    allOpen = allOpen && state == "open";
                }
                back = allOpen ? "open" : "closed";
            }
            else
            {
                back = doors.value(aRequest.door, std::string(aRequest.doorState == "open" ? "closed" : "open"));
            }
        }
        else
        {
            back = aRequest.doorState == "locked" ? "unlocked" : "locked";
        }
        if (back != aRequest.doorState)
        {
            params["door"] = aRequest.door;
            params["door_state"] = back;
            changes = true;
        }
    }
    return changes ? json{{"method", "vehicle.set"}, {"params", params}} : json(nullptr);
}

// ---- audio --------------------------------------------------------------------------------------------------------------

PlayRequest ParsePlay(const json& aParams)
{
    p::RequireOnly(aParams, {"event", "on", "emitter", "loop", "seconds"});
    PlayRequest request;
    request.event = RequiredText(aParams, "event", 96, "a sound event name, such as ui_phone_sms");
    if (!EventNameOk(request.event))
    {
        Bad("'event' must be a sound event name (letters, digits and _)");
    }
    request.on = ParseTarget(aParams, "on", false, {"v", "global", "look_at"});
    if (request.on.empty())
    {
        request.on = "v";
    }
    if (const auto emitter = p::CheckText(aParams, "emitter", 64))
    {
        if (!EventNameOk(*emitter))
        {
            Bad("'emitter' must be an emitter name (letters, digits and _)");
        }
        request.emitter = *emitter;
    }
    request.loop = p::CheckBoolean(aParams, "loop").value_or(false);
    request.seconds = p::CheckNumber(aParams, "seconds", 0.5, 3600.0).value_or(request.loop ? 3600.0 : 10.0);
    return request;
}

StopRequest ParseStop(const json& aParams)
{
    p::RequireOnly(aParams, {"id", "all"});
    StopRequest request;
    request.all = p::CheckBoolean(aParams, "all").value_or(false);
    request.id = static_cast<int32_t>(p::CheckInteger(aParams, "id", 1, 1000000).value_or(-1));
    if (request.all == (request.id > 0))
    {
        Bad("give id (what audio_play answered) or all: true, one of them");
    }
    return request;
}

const std::vector<std::string>& RadioStations()
{
    static const std::vector<std::string> stations{"aggro_industrial", "electro_industrial", "hip_hop",        "aggro_techno", "downtempo",
                                                   "attitude_rock",    "pop",                "latino",         "metal",        "minimal_techno",
                                                   "jazz",             "growl",              "dark_star",      "impulse_fm"};
    return stations;
}

RadioRequest ParseRadio(const json& aParams)
{
    p::RequireOnly(aParams, {"target", "station", "on"});
    RadioRequest request;
    request.target = ParseTarget(aParams, "target", true, {"look_at", "mounted"});
    if (const auto it = aParams.find("station"); it != aParams.end() && !it->is_null())
    {
        if (it->is_number_integer())
        {
            const auto value = it->get<int64_t>();
            if (value < 0 || value >= static_cast<int64_t>(RadioStations().size()))
            {
                Bad("'station' must be 0 to 13, or a station's name");
            }
            request.station = static_cast<int32_t>(value);
        }
        else if (it->is_string())
        {
            const auto name = Lower(it->get<std::string>());
            const auto& all = RadioStations();
            const auto found = std::find(all.begin(), all.end(), name);
            if (found == all.end())
            {
                Bad("'station' must be one of aggro_industrial, electro_industrial, hip_hop, aggro_techno, downtempo, attitude_rock, pop, latino, metal, minimal_techno, jazz, growl, dark_star, impulse_fm (or 0-13)");
            }
            request.station = static_cast<int32_t>(found - all.begin());
        }
        else
        {
            Bad("'station' must be 0 to 13, or a station's name");
        }
    }
    request.on = p::CheckBoolean(aParams, "on");
    if (!request.station && !request.on)
    {
        Bad("give station, on, or both");
    }
    return request;
}

json RadioUndo(const json& aStep, const RadioRequest& aRequest)
{
    const auto id = aStep.value("target_id", std::string());
    const auto before = aStep.value("before", json::object());
    if (id.empty() || !before.is_object())
    {
        return nullptr;
    }
    json params{{"target", id}};
    bool changes = false;
    if (aRequest.station && before.contains("station") && before["station"].is_number_integer() && before["station"].get<int32_t>() != *aRequest.station)
    {
        params["station"] = before["station"].get<int32_t>();
        changes = true;
    }
    // Tuning a station turns the radio on, so a put-back of the station also puts the on state back.
    const std::optional<bool> turnedOn = aRequest.on ? aRequest.on : (aRequest.station ? std::optional<bool>(true) : std::nullopt);
    if (turnedOn && before.contains("on") && before["on"].is_boolean() && before["on"].get<bool>() != *turnedOn)
    {
        params["on"] = before["on"].get<bool>();
        changes = true;
    }
    return changes ? json{{"method", "audio.radio"}, {"params", params}} : json(nullptr);
}

VoiceRequest ParseVoice(const json& aParams)
{
    p::RequireOnly(aParams, {"target", "context"});
    VoiceRequest request;
    request.target = ParseTarget(aParams, "target", true, {"look_at"});
    request.context = RequiredText(aParams, "context", 96, "a voiceset context of the NPC's own voice, such as greeting");
    if (!EventNameOk(request.context))
    {
        Bad("'context' must be a voiceset context name (letters, digits and _)");
    }
    return request;
}

// ---- lights -------------------------------------------------------------------------------------------------------------

LightPattern ParsePattern(const json& aValue)
{
    LightPattern pattern;
    static const std::vector<std::string> kinds{"steady", "flicker", "pulse", "strobe", "broken", "candle"};
    if (aValue.is_string())
    {
        pattern.kind = aValue.get<std::string>();
        if (std::find(kinds.begin(), kinds.end(), pattern.kind) == kinds.end())
        {
            Bad("'pattern' must be steady, flicker, pulse, strobe, broken or candle (or {kind, period, low, strength})");
        }
        if (pattern.kind == "strobe")
        {
            pattern.low = 0.0;
            pattern.period = 0.2;
        }
        return pattern;
    }
    RequireOnlyIn(aValue, {"kind", "period", "low", "strength", "seed"}, "pattern");
    pattern.kind = OneOf(aValue, "kind", kinds, "");
    if (pattern.kind == "strobe")
    {
        pattern.low = 0.0;
        pattern.period = 0.2;
    }
    pattern.period = p::CheckNumber(aValue, "period", 0.05, 30.0).value_or(pattern.period);
    pattern.low = p::CheckNumber(aValue, "low", 0.0, 1.0).value_or(pattern.low);
    pattern.strength = p::CheckNumber(aValue, "strength", 0.0, 1.0).value_or(pattern.strength);
    pattern.seed = static_cast<uint32_t>(p::CheckInteger(aValue, "seed", 0, 1000000).value_or(1));
    return pattern;
}

json PatternJson(const LightPattern& aPattern)
{
    return json{{"kind", aPattern.kind}, {"period", aPattern.period}, {"low", aPattern.low}, {"strength", aPattern.strength}, {"seed", aPattern.seed}};
}

double PatternValue(const LightPattern& aPattern, double aT)
{
    const double low = std::clamp(aPattern.low, 0.0, 1.0);
    const double period = std::max(aPattern.period, 0.05);
    if (aPattern.kind == "pulse")
    {
        return low + (1.0 - low) * (0.5 + 0.5 * std::cos(2.0 * kPi * aT / period));
    }
    if (aPattern.kind == "strobe")
    {
        return std::fmod(std::max(aT, 0.0), period) < period * 0.5 ? 1.0 : low;
    }
    if (aPattern.kind == "broken")
    {
        // A failing tube: steady most of the time, dropping out in short bursts. Slots of a quarter period, one in six out,
        // and within an out slot a quick double flick.
        const auto slot = static_cast<uint32_t>(std::floor(std::max(aT, 0.0) / (period * 0.25)));
        const auto h = Mix(slot * 2654435761U ^ aPattern.seed);
        if (h % 6 != 0)
        {
            return 1.0;
        }
        const double inSlot = std::fmod(std::max(aT, 0.0), period * 0.25) / (period * 0.25);
        return (inSlot < 0.3 || (inSlot > 0.5 && inSlot < 0.65)) ? low : 1.0;
    }
    if (aPattern.kind == "candle")
    {
        const double s = static_cast<double>(aPattern.seed % 97);
        const double wave = 0.5 * std::sin(aT * 7.3 / period + s) + 0.3 * std::sin(aT * 13.1 / period + s * 0.7) + 0.2 * std::sin(aT * 23.7 / period + s * 1.3);
        const double unit = std::clamp(0.5 + 0.5 * wave, 0.0, 1.0);
        return low + (1.0 - low) * (0.75 + 0.25 * unit);
    }
    return 1.0; // steady, flicker (the engine flickers the component itself)
}

LightRequest ParseLightSpawn(const json& aParams)
{
    p::RequireOnly(aParams, {"template", "at", "offset", "yaw", "face_v", "colour", "intensity", "radius", "inner", "outer", "pattern", "label"});
    LightRequest request;
    if (const auto path = p::CheckText(aParams, "template", 200))
    {
        if (!TemplatePathOk(*path))
        {
            Bad("'template' must be an entity template's depot path ending in .ent (letters, digits, backslash, slash, _ - .) whose entity holds a light component");
        }
        request.templatePath = *path;
    }
    request.where = ParseWhere(aParams);
    request.colour = ParseColour(aParams, "colour", request.colour);
    request.intensity = p::CheckNumber(aParams, "intensity", 0.0, 100000.0).value_or(request.intensity);
    request.radius = p::CheckNumber(aParams, "radius", 0.1, 50.0).value_or(request.radius);
    request.inner = p::CheckNumber(aParams, "inner", 1.0, 179.0);
    request.outer = p::CheckNumber(aParams, "outer", 1.0, 179.0);
    if (request.inner.has_value() != request.outer.has_value())
    {
        Bad("give inner and outer together (full angles in degrees)");
    }
    if (request.inner && *request.outer < *request.inner)
    {
        Bad("'outer' must be at least 'inner' (full angles in degrees)");
    }
    if (const auto it = aParams.find("pattern"); it != aParams.end() && !it->is_null())
    {
        request.pattern = ParsePattern(*it);
    }
    request.label = OptionalText(aParams, "label", 48);
    return request;
}

LightSetRequest ParseLightSet(const json& aParams)
{
    p::RequireOnly(aParams, {"id", "colour", "intensity", "radius", "inner", "outer", "on", "pattern", "fade_s"});
    LightSetRequest request;
    request.handle = static_cast<int32_t>(p::CheckInteger(aParams, "id", 1, 1000000).value_or(-1));
    if (request.handle < 0)
    {
        Bad("'id' is required: what light_spawn answered");
    }
    if (aParams.contains("colour") && !aParams["colour"].is_null())
    {
        request.colour = ParseColour(aParams, "colour", {255, 255, 255});
    }
    request.intensity = p::CheckNumber(aParams, "intensity", 0.0, 100000.0);
    request.radius = p::CheckNumber(aParams, "radius", 0.1, 50.0);
    request.inner = p::CheckNumber(aParams, "inner", 1.0, 179.0);
    request.outer = p::CheckNumber(aParams, "outer", 1.0, 179.0);
    if (request.inner.has_value() != request.outer.has_value())
    {
        Bad("give inner and outer together (full angles in degrees)");
    }
    if (request.inner && *request.outer < *request.inner)
    {
        Bad("'outer' must be at least 'inner'");
    }
    request.on = p::CheckBoolean(aParams, "on");
    if (const auto it = aParams.find("pattern"); it != aParams.end() && !it->is_null())
    {
        request.pattern = ParsePattern(*it);
    }
    request.fadeS = p::CheckNumber(aParams, "fade_s", 0.0, 10.0).value_or(0.0);
    if (!request.colour && !request.intensity && !request.radius && !request.inner && !request.on && !request.pattern)
    {
        Bad("give something to change: colour, intensity, radius, inner and outer, on, or pattern");
    }
    return request;
}

json LightSetUndo(int32_t aHandle, const json& aBefore, const std::optional<LightPattern>& aBeforePattern)
{
    json params{{"id", aHandle}};
    for (const char* key : {"colour", "intensity", "radius", "inner", "outer", "on"})
    {
        if (aBefore.is_object() && aBefore.contains(key) && !aBefore[key].is_null())
        {
            params[key] = aBefore[key];
        }
    }
    if (params.contains("inner") != params.contains("outer"))
    {
        params.erase("inner");
        params.erase("outer");
    }
    params["pattern"] = PatternJson(aBeforePattern.value_or(LightPattern{}));
    return json{{"method", "light.set"}, {"params", params}};
}

// ---- phone --------------------------------------------------------------------------------------------------------------

TextRequest ParseText(const json& aParams)
{
    p::RequireOnly(aParams, {"contact", "text"});
    TextRequest request;
    request.contact = RequiredText(aParams, "contact", 48, "the sender's name as the message toast shows it");
    request.text = RequiredText(aParams, "text", 500, "the message");
    return request;
}

CallRequest ParseCall(const json& aParams)
{
    p::RequireOnly(aParams, {"contact", "lines", "ring_s", "mode", "rejectable"});
    CallRequest request;
    request.contact = RequiredText(aParams, "contact", 64, "a journal contact's id (phone_state {contacts: true} lists them)");
    if (!NameChars(request.contact, 64, "-."))
    {
        Bad("'contact' must be a journal contact's id (letters, digits, _ - .)");
    }
    const auto it = aParams.find("lines");
    if (it == aParams.end() || !it->is_array() || it->empty() || it->size() > kMaxCallLines)
    {
        Bad("'lines' is required: 1 to " + std::to_string(kMaxCallLines) + " lines, each {text, speaker?, seconds?}");
    }
    for (const auto& line : *it)
    {
        RequireOnlyIn(line, {"text", "speaker", "seconds"}, "lines[]");
        CallLine out;
        out.text = RequiredText(line, "text", 300, "the line's words");
        out.speaker = OptionalText(line, "speaker", 48);
        if (out.speaker.empty())
        {
            out.speaker = request.contact;
        }
        out.seconds = p::CheckNumber(line, "seconds", 0.5, 20.0).value_or(std::clamp(1.2 + 0.06 * static_cast<double>(out.text.size()), 1.5, 8.0));
        request.lines.push_back(out);
    }
    request.ringS = p::CheckNumber(aParams, "ring_s", 3.0, 120.0).value_or(request.ringS);
    request.video = OneOf(aParams, "mode", {"audio", "video"}, "audio") == "video";
    request.rejectable = p::CheckBoolean(aParams, "rejectable").value_or(true);
    return request;
}

// ---- quests -------------------------------------------------------------------------------------------------------------

namespace
{
const std::vector<std::string>& ObjectiveStates()
{
    static const std::vector<std::string> states{"active", "done", "failed", "hidden"};
    return states;
}

Objective ParseObjectiveItem(const json& aValue)
{
    RequireOnlyIn(aValue, {"id", "text", "state", "optional", "area"}, "objectives[]");
    Objective objective;
    objective.id = RequiredText(aValue, "id", 48, "a short id for the objective");
    if (!IdOk(objective.id))
    {
        Bad("an objective's id must be letters, digits, _ - . (1 to 48)");
    }
    objective.text = RequiredText(aValue, "text", 120, "the objective as the tracker shows it");
    objective.state = OneOf(aValue, "state", ObjectiveStates(), "active");
    objective.optional = p::CheckBoolean(aValue, "optional").value_or(false);
    if (const auto it = aValue.find("area"); it != aValue.end() && !it->is_null())
    {
        RequireOnlyIn(*it, {"at", "radius_m", "complete_on_enter"}, "area");
        AreaLink area;
        const auto at = p::CheckPoint(*it, "at", 1e5);
        if (!at)
        {
            Bad("an objective's area needs at: [x, y, z]");
        }
        area.at = *at;
        area.radius = p::CheckNumber(*it, "radius_m", 0.5, 200.0).value_or(5.0);
        area.completeOnEnter = p::CheckBoolean(*it, "complete_on_enter").value_or(false);
        objective.area = area;
    }
    return objective;
}
} // namespace

QuestSetRequest ParseQuestSet(const json& aParams)
{
    p::RequireOnly(aParams, {"id", "title", "text", "objectives", "show", "notify"});
    QuestSetRequest request;
    request.quest.id = RequiredText(aParams, "id", 48, "a short id for the quest");
    if (!IdOk(request.quest.id))
    {
        Bad("'id' must be letters, digits, _ - . (1 to 48)");
    }
    request.quest.title = RequiredText(aParams, "title", 80, "the quest's name as the tracker shows it");
    request.quest.text = OptionalText(aParams, "text", 300);
    if (const auto it = aParams.find("objectives"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > kMaxObjectives)
        {
            Bad("'objectives' must be a list of at most " + std::to_string(kMaxObjectives));
        }
        std::set<std::string> seen;
        for (const auto& item : *it)
        {
            auto objective = ParseObjectiveItem(item);
            if (!seen.insert(objective.id).second)
            {
                Bad("objective ids must be unique; '" + objective.id + "' is there twice");
            }
            request.quest.objectives.push_back(objective);
        }
    }
    request.quest.show = p::CheckBoolean(aParams, "show").value_or(true);
    request.notify = OneOf(aParams, "notify", {"none", "new", "update"}, "none");
    if (request.notify == "none")
    {
        request.notify.clear();
    }
    return request;
}

json QuestJson(const Quest& aQuest)
{
    json objectives = json::array();
    for (const auto& objective : aQuest.objectives)
    {
        json o{{"id", objective.id}, {"text", objective.text}, {"state", objective.state}};
        if (objective.optional)
        {
            o["optional"] = true;
        }
        if (objective.area)
        {
            o["area"] = {{"at", Arr(objective.area->at)}, {"radius_m", objective.area->radius}, {"complete_on_enter", objective.area->completeOnEnter}};
        }
        objectives.push_back(o);
    }
    json out{{"id", aQuest.id}, {"title", aQuest.title}, {"objectives", objectives}, {"show", aQuest.show}};
    if (!aQuest.text.empty())
    {
        out["text"] = aQuest.text;
    }
    return out;
}

Quest QuestFromJson(const json& aValue)
{
    json params = aValue;
    params.erase("notify");
    return ParseQuestSet(params).quest;
}

ObjectiveRequest ParseObjective(const json& aParams)
{
    p::RequireOnly(aParams, {"quest", "objective", "state", "text", "notify"});
    ObjectiveRequest request;
    request.quest = RequiredText(aParams, "quest", 48, "the quest's id");
    request.objective = RequiredText(aParams, "objective", 48, "the objective's id");
    if (aParams.contains("state") && !aParams["state"].is_null())
    {
        request.state = OneOf(aParams, "state", ObjectiveStates(), "");
    }
    if (const auto text = p::CheckText(aParams, "text", 120))
    {
        request.text = *text;
    }
    request.notify = p::CheckBoolean(aParams, "notify").value_or(true);
    if (!request.state && !request.text)
    {
        Bad("give state (active, done, failed, hidden), text, or both");
    }
    return request;
}

// ---- notifications ------------------------------------------------------------------------------------------------------

NotifyRequest ParseNotify(const json& aParams)
{
    p::RequireOnly(aParams, {"style", "title", "text", "speaker", "seconds"});
    NotifyRequest request;
    request.style = OneOf(aParams, "style", NotifyStyles(), "");
    request.title = OptionalText(aParams, "title", 80);
    request.speaker = OptionalText(aParams, "speaker", 48);
    request.seconds = p::CheckNumber(aParams, "seconds", 0.5, 30.0).value_or(request.style == "subtitle" ? 4.0 : 5.0);
    request.text = RequiredText(aParams, "text", 300, "the words to show");
    if (request.style == "subtitle" && request.speaker.empty())
    {
        Bad("a subtitle needs speaker: the name the line shows (the game reads V's own name otherwise)");
    }
    if (request.style != "subtitle" && !request.speaker.empty())
    {
        Bad("speaker belongs to style subtitle");
    }
    return request;
}

// ---- watchers -----------------------------------------------------------------------------------------------------------

const char* WatchKindName(WatchKind aKind)
{
    switch (aKind)
    {
    case WatchKind::Enter:
        return "enter";
    case WatchKind::Leave:
        return "leave";
    case WatchKind::Gaze:
        return "gaze";
    case WatchKind::Weapon:
        return "weapon";
    case WatchKind::Combat:
        return "combat";
    case WatchKind::Vehicle:
        return "vehicle";
    case WatchKind::Interact:
        return "interact";
    case WatchKind::Choice:
        return "choice";
    case WatchKind::Timer:
        return "timer";
    case WatchKind::Clock:
        return "clock";
    }
    return "timer";
}

const std::vector<std::string>& WatchKindNames()
{
    static const std::vector<std::string> names{"enter", "leave", "gaze", "weapon", "combat", "vehicle", "interact", "choice", "timer", "clock"};
    return names;
}

bool MicroMethodDenied(const std::string& aMethod)
{
    static const std::set<std::string> denied{"game.save", "game.load", "bridge.kill", "bridge.handover", "cc.open", "cc.confirm", "cc.back",
                                              "photo.open", "pose.live.apply", "diag.write_probe"};
    return denied.count(aMethod) > 0 || aMethod.rfind("selftest.", 0) == 0;
}

bool MicroAccessAllowed(const std::string& aAccessName)
{
    static const std::set<std::string> allowed{"read", "notify", "write-world", "write-dm", "write-player", "write-photo", "write-showroom"};
    return allowed.count(aAccessName) > 0;
}

WatchSpec ParseWatch(const json& aParams, const ActionCheck& aCheck)
{
    p::RequireOnly(aParams, {"id", "kind", "at", "target", "radius_m", "seconds", "cone_deg", "max_m", "look_at", "edge", "now", "caption", "index", "clock",
                             "expires_s", "repeat", "cooldown_s", "hz", "actions"});
    WatchSpec spec;
    if (const auto id = p::CheckText(aParams, "id", 48))
    {
        if (!IdOk(*id))
        {
            Bad("'id' must be letters, digits, _ - . (1 to 48)");
        }
        spec.id = *id;
    }
    const auto kind = OneOf(aParams, "kind", WatchKindNames(), "");
    const auto& names = WatchKindNames();
    spec.kind = static_cast<WatchKind>(std::find(names.begin(), names.end(), kind) - names.begin());
    spec.point = p::CheckPoint(aParams, "at", 1e5);
    spec.entity = ParseTarget(aParams, "target", false, {"any"});
    spec.radius = p::CheckNumber(aParams, "radius_m", 0.5, 500.0).value_or(5.0);
    spec.seconds = p::CheckNumber(aParams, "seconds", 0.0, kMaxWatchSeconds).value_or(0.0);
    spec.coneDeg = p::CheckNumber(aParams, "cone_deg", 1.0, 60.0).value_or(12.0);
    spec.maxM = p::CheckNumber(aParams, "max_m", 1.0, 300.0).value_or(30.0);
    spec.lookAt = p::CheckBoolean(aParams, "look_at").value_or(false);
    spec.on = OneOf(aParams, "edge", {"on", "off"}, "on") == "on";
    spec.now = p::CheckBoolean(aParams, "now");
    spec.caption = OptionalText(aParams, "caption", 64);
    if (const auto index = p::CheckInteger(aParams, "index", 0, 9))
    {
        spec.index = static_cast<int32_t>(*index);
    }
    if (const auto clock = p::CheckText(aParams, "clock", 5))
    {
        const auto digit = [&](size_t i) { return (*clock)[i] >= '0' && (*clock)[i] <= '9'; };
        if (clock->size() != 5 || (*clock)[2] != ':' || !digit(0) || !digit(1) || !digit(3) || !digit(4))
        {
            Bad("'clock' must be the time of day as HH:MM (00:00 to 23:59)");
        }
        const int h = ((*clock)[0] - '0') * 10 + ((*clock)[1] - '0');
        const int m = ((*clock)[3] - '0') * 10 + ((*clock)[4] - '0');
        if (h > 23 || m > 59)
        {
            Bad("'clock' must be the time of day as HH:MM (00:00 to 23:59)");
        }
        spec.clockSeconds = h * 3600.0 + m * 60.0;
    }
    spec.expiresS = p::CheckNumber(aParams, "expires_s", 1.0, kMaxWatchSeconds).value_or(600.0);
    spec.repeat = p::CheckBoolean(aParams, "repeat").value_or(false);
    spec.cooldownS = p::CheckNumber(aParams, "cooldown_s", 0.0, 600.0).value_or(2.0);
    spec.hz = p::CheckNumber(aParams, "hz", 1.0, 30.0).value_or(spec.kind == WatchKind::Gaze ? 20.0 : 10.0);

    switch (spec.kind)
    {
    case WatchKind::Enter:
    case WatchKind::Leave:
        if (spec.point.has_value() == !spec.entity.empty())
        {
            Bad("an enter or leave watcher needs at (a world point) or target (an entity or spawn:<n>), one of them");
        }
        if (spec.entity == "any")
        {
            Bad("target any belongs to interact watchers");
        }
        break;
    case WatchKind::Gaze:
        if (spec.entity.empty() || spec.entity == "any")
        {
            Bad("a gaze watcher needs target: an entity id or spawn:<n>");
        }
        if (spec.seconds > 600.0)
        {
            Bad("a gaze watcher's seconds (the dwell) is at most 600");
        }
        break;
    case WatchKind::Timer:
        if (spec.seconds <= 0.0)
        {
            Bad("a timer watcher needs seconds (0.1 to 3600)");
        }
        if (!aParams.contains("expires_s"))
        {
            spec.expiresS = std::min(kMaxWatchSeconds, spec.seconds + 60.0);
        }
        if (spec.seconds >= spec.expiresS)
        {
            Bad("a timer's seconds must come before its expires_s");
        }
        break;
    case WatchKind::Clock:
        if (spec.clockSeconds < 0.0)
        {
            Bad("a clock watcher needs clock: HH:MM");
        }
        break;
    default:
        break;
    }
    if (spec.kind != WatchKind::Interact && spec.entity == "any")
    {
        Bad("target any belongs to interact watchers");
    }

    if (const auto it = aParams.find("actions"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > kMaxActions)
        {
            Bad("'actions' must be a list of at most " + std::to_string(kMaxActions) + " bridge commands {method, params?, delay_s?}");
        }
        for (const auto& item : *it)
        {
            RequireOnlyIn(item, {"method", "params", "delay_s"}, "actions[]");
            MicroAction action;
            action.method = RequiredText(item, "method", 64, "a bridge method, such as notify.show");
            if (!std::all_of(action.method.begin(), action.method.end(), [](char c) {
                    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_';
                }))
            {
                Bad("an action's method must be a bridge method name (lower case, dots)");
            }
            if (MicroMethodDenied(action.method))
            {
                Bad("an action may not call " + action.method + " (saves, loads, the kill switch, handovers and the creator's buttons stay with the agent)");
            }
            if (aCheck)
            {
                if (const auto why = aCheck(action.method); !why.empty())
                {
                    Bad("action " + action.method + ": " + why);
                }
            }
            if (const auto params = item.find("params"); params != item.end() && !params->is_null())
            {
                if (!params->is_object())
                {
                    Bad("an action's params must be an object");
                }
                if (params->dump().size() > kMaxActionParamsBytes)
                {
                    Bad("an action's params must stay under 4 KiB");
                }
                if (action.method == "watch.arm" && params->contains("actions"))
                {
                    Bad("a watcher armed by an action can't carry actions of its own (one level only)");
                }
                action.params = *params;
            }
            action.delayS = p::CheckNumber(item, "delay_s", 0.0, 30.0).value_or(0.0);
            spec.actions.push_back(action);
        }
    }
    return spec;
}

json WatchSpecJson(const WatchSpec& aSpec)
{
    json out{{"id", aSpec.id}, {"kind", WatchKindName(aSpec.kind)}, {"expires_s", aSpec.expiresS}, {"repeat", aSpec.repeat}};
    if (aSpec.point)
    {
        out["at"] = Arr(*aSpec.point);
    }
    if (!aSpec.entity.empty())
    {
        out["target"] = aSpec.entity;
    }
    switch (aSpec.kind)
    {
    case WatchKind::Enter:
    case WatchKind::Leave:
        out["radius_m"] = aSpec.radius;
        break;
    case WatchKind::Gaze:
        out["seconds"] = aSpec.seconds;
        out[aSpec.lookAt ? "look_at" : "cone_deg"] = aSpec.lookAt ? json(true) : json(aSpec.coneDeg);
        out["max_m"] = aSpec.maxM;
        break;
    case WatchKind::Weapon:
    case WatchKind::Combat:
    case WatchKind::Vehicle:
        out["edge"] = aSpec.on ? "on" : "off";
        break;
    case WatchKind::Interact:
    case WatchKind::Choice:
        if (!aSpec.caption.empty())
        {
            out["caption"] = aSpec.caption;
        }
        if (aSpec.index)
        {
            out["index"] = *aSpec.index;
        }
        break;
    case WatchKind::Timer:
        out["seconds"] = aSpec.seconds;
        break;
    case WatchKind::Clock:
        out["clock"] = Clock(aSpec.clockSeconds);
        break;
    }
    json actions = json::array();
    for (const auto& action : aSpec.actions)
    {
        json a{{"method", action.method}, {"params", action.params}};
        if (action.delayS > 0.0)
        {
            a["delay_s"] = action.delayS;
        }
        actions.push_back(a);
    }
    out["actions"] = actions;
    return out;
}

Sample SampleFromJson(const json& aValue)
{
    Sample sample;
    if (!aValue.is_object())
    {
        return sample;
    }
    const auto point = [](const json& aArr, std::array<double, 3>& aOut) {
        if (aArr.is_array() && aArr.size() >= 3 && aArr[0].is_number() && aArr[1].is_number() && aArr[2].is_number())
        {
            aOut = {aArr[0].get<double>(), aArr[1].get<double>(), aArr[2].get<double>()};
            return true;
        }
        return false;
    };
    sample.valid = point(aValue.value("v", json()), sample.v);
    sample.yaw = aValue.value("yaw", 0.0);
    point(aValue.value("cam", json()), sample.camPos);
    point(aValue.value("fwd", json()), sample.camFwd);
    sample.lookAt = aValue.value("look", std::string());
    sample.combat = aValue.value("combat", false);
    sample.weapon = aValue.value("weapon", false);
    sample.vehicle = aValue.value("vehicle", false);
    sample.tod = aValue.value("tod", -1.0);
    sample.callFact = aValue.value("call_fact", -1);
    if (const auto it = aValue.find("ents"); it != aValue.end() && it->is_object())
    {
        for (const auto& [key, value] : it->items())
        {
            std::array<double, 3> at{};
            if (value.is_object() && point(value.value("p", json()), at))
            {
                sample.entities[key] = at;
                if (value.contains("vis") && value["vis"].is_boolean())
                {
                    sample.visible[key] = value["vis"].get<bool>();
                }
                if (const auto id = value.value("id", std::string()); !id.empty())
                {
                    sample.ids[key] = id;
                }
            }
        }
    }
    if (const auto it = aValue.find("ev"); it != aValue.end() && it->is_array())
    {
        for (const auto& event : *it)
        {
            if (event.is_object())
            {
                sample.events.push_back(event);
            }
        }
    }
    return sample;
}

// ---- the watcher engine -------------------------------------------------------------------------------------------------

std::string WatcherEngine::Arm(WatchSpec aSpec, double aNow)
{
    if (aSpec.id.empty())
    {
        aSpec.id = "w" + std::to_string(m_next++);
    }
    // The same id replaces the earlier watcher (re-arming a beat), never two at once.
    m_armed.erase(std::remove_if(m_armed.begin(), m_armed.end(), [&](const Armed& a) { return a.spec.id == aSpec.id; }), m_armed.end());
    if (m_armed.size() >= kMaxWatchers)
    {
        throw MethodError("too_many", "at most " + std::to_string(kMaxWatchers) + " watchers are armed at once; disarm one first (watch_disarm)");
    }
    Armed armed;
    armed.spec = std::move(aSpec);
    armed.armedAt = aNow;
    armed.lastSampleAt = aNow;
    m_armed.push_back(std::move(armed));
    return m_armed.back().spec.id;
}

bool WatcherEngine::Disarm(const std::string& aId)
{
    const auto before = m_armed.size();
    m_armed.erase(std::remove_if(m_armed.begin(), m_armed.end(), [&](const Armed& a) { return a.spec.id == aId; }), m_armed.end());
    return m_armed.size() != before;
}

size_t WatcherEngine::DisarmAll()
{
    const auto count = m_armed.size();
    m_armed.clear();
    return count;
}

size_t WatcherEngine::DisarmPrefix(const std::string& aPrefix)
{
    const auto before = m_armed.size();
    m_armed.erase(std::remove_if(m_armed.begin(), m_armed.end(), [&](const Armed& a) { return a.spec.id.rfind(aPrefix, 0) == 0; }), m_armed.end());
    return before - m_armed.size();
}

bool WatcherEngine::Empty() const
{
    return m_armed.empty();
}

size_t WatcherEngine::Count() const
{
    return m_armed.size();
}

json WatcherEngine::List(double aNow) const
{
    json out = json::array();
    for (const auto& armed : m_armed)
    {
        auto item = WatchSpecJson(armed.spec);
        item["remaining_s"] = std::max(0.0, std::round((armed.spec.expiresS - (aNow - armed.armedAt)) * 10.0) / 10.0);
        item["fired"] = armed.fires;
        if (armed.spec.kind == WatchKind::Gaze)
        {
            item["dwell_s"] = std::round(armed.dwell * 100.0) / 100.0;
        }
        out.push_back(item);
    }
    return out;
}

SampleWants WatcherEngine::Wants() const
{
    SampleWants wants;
    std::set<std::string> entities;
    for (const auto& armed : m_armed)
    {
        const auto& spec = armed.spec;
        switch (spec.kind)
        {
        case WatchKind::Enter:
        case WatchKind::Leave:
            if (!spec.entity.empty())
            {
                entities.insert(spec.entity);
            }
            break;
        case WatchKind::Gaze:
            entities.insert(spec.entity);
            if (spec.lookAt)
            {
                wants.lookAt = true;
            }
            else
            {
                wants.occlusion = true;
            }
            break;
        case WatchKind::Interact:
            wants.events = true;
            wants.lookAt = true;
            if (!spec.entity.empty() && spec.entity != "any")
            {
                entities.insert(spec.entity);
            }
            break;
        case WatchKind::Choice:
            wants.events = true;
            break;
        default:
            break;
        }
    }
    wants.entities.assign(entities.begin(), entities.end());
    return wants;
}

bool WatcherEngine::NeedsSamples() const
{
    return std::any_of(m_armed.begin(), m_armed.end(), [](const Armed& a) { return a.spec.kind != WatchKind::Timer; });
}

double WatcherEngine::Interval() const
{
    double hz = 0.0;
    for (const auto& armed : m_armed)
    {
        if (armed.spec.kind != WatchKind::Timer)
        {
            hz = std::max(hz, armed.spec.hz);
        }
    }
    return hz > 0.0 ? 1.0 / hz : 0.0;
}

std::vector<Fired> WatcherEngine::Advance(double aNow)
{
    std::vector<Fired> out;
    std::vector<std::string> done;
    for (auto& armed : m_armed)
    {
        if (armed.spec.kind == WatchKind::Timer && aNow - armed.armedAt >= armed.spec.seconds && armed.fires == 0)
        {
            Fired fired;
            fired.id = armed.spec.id;
            fired.kind = armed.spec.kind;
            fired.detail = {{"after_s", std::round((aNow - armed.armedAt) * 100.0) / 100.0}};
            fired.actions = armed.spec.actions;
            out.push_back(fired);
            ++armed.fires;
            armed.lastFired = aNow;
            if (!armed.spec.repeat)
            {
                done.push_back(armed.spec.id);
            }
            else
            {
                armed.armedAt = aNow; // a repeating timer runs again
                armed.fires = 0;
            }
            continue;
        }
        if (aNow - armed.armedAt >= armed.spec.expiresS)
        {
            Fired expired;
            expired.id = armed.spec.id;
            expired.kind = armed.spec.kind;
            expired.expired = true;
            expired.detail = {{"fired", armed.fires}};
            out.push_back(expired);
            done.push_back(armed.spec.id);
        }
    }
    for (const auto& id : done)
    {
        Disarm(id);
    }
    return out;
}

bool WatcherEngine::Condition(Armed& aArmed, const Sample& aSample, double aNow, json& aDetail) const
{
    const auto& spec = aArmed.spec;
    const auto position = [&](const std::string& aKey, std::array<double, 3>& aOut) {
        const auto it = aSample.entities.find(aKey);
        if (it == aSample.entities.end())
        {
            return false;
        }
        aOut = it->second;
        return true;
    };
    switch (spec.kind)
    {
    case WatchKind::Enter:
    case WatchKind::Leave:
    {
        if (!aSample.valid)
        {
            return false;
        }
        std::array<double, 3> centre{};
        if (spec.point)
        {
            centre = *spec.point;
        }
        else if (!position(spec.entity, centre))
        {
            aDetail["target_missing"] = true;
            return false;
        }
        const double distance = Distance(aSample.v, centre);
        aDetail["distance_m"] = std::round(distance * 100.0) / 100.0;
        const bool inside = distance <= spec.radius;
        if (spec.kind == WatchKind::Enter)
        {
            return inside;
        }
        if (inside)
        {
            aArmed.seenInside = true;
        }
        const bool now = spec.now.value_or(false);
        return !inside && (aArmed.seenInside || now);
    }
    case WatchKind::Gaze:
    {
        std::array<double, 3> target{};
        bool looking = false;
        if (!aSample.valid || !position(spec.entity, target))
        {
            aArmed.dwell = 0.0;
            return false;
        }
        const double distance = Distance(aSample.camPos, target);
        if (spec.lookAt)
        {
            // The targeting system's look-at object against the target's id (a spawn handle's id from the sample).
            const auto id = aSample.ids.count(spec.entity) ? aSample.ids.at(spec.entity) : spec.entity;
            looking = !aSample.lookAt.empty() && aSample.lookAt == id;
        }
        else
        {
            const std::array<double, 3> to{target[0] - aSample.camPos[0], target[1] - aSample.camPos[1], target[2] - aSample.camPos[2]};
            const double length = std::sqrt(to[0] * to[0] + to[1] * to[1] + to[2] * to[2]);
            const double fl = std::sqrt(aSample.camFwd[0] * aSample.camFwd[0] + aSample.camFwd[1] * aSample.camFwd[1] + aSample.camFwd[2] * aSample.camFwd[2]);
            if (length > 1e-6 && fl > 1e-6)
            {
                const double cosine = (to[0] * aSample.camFwd[0] + to[1] * aSample.camFwd[1] + to[2] * aSample.camFwd[2]) / (length * fl);
                const double angle = std::acos(std::clamp(cosine, -1.0, 1.0)) * 180.0 / kPi;
                aDetail["angle_deg"] = std::round(angle * 10.0) / 10.0;
                const auto vis = aSample.visible.find(spec.entity);
                const bool visible = vis == aSample.visible.end() || vis->second;
                looking = angle <= spec.coneDeg && visible;
            }
        }
        looking = looking && distance <= spec.maxM;
        aDetail["distance_m"] = std::round(distance * 100.0) / 100.0;
        const double dt = std::clamp(aNow - aArmed.lastSampleAt, 0.0, 0.5);
        aArmed.dwell = looking ? aArmed.dwell + dt : 0.0;
        aDetail["dwell_s"] = std::round(aArmed.dwell * 100.0) / 100.0;
        return looking && aArmed.dwell + 1e-9 >= spec.seconds;
    }
    case WatchKind::Weapon:
        return aSample.valid && aSample.weapon == spec.on;
    case WatchKind::Combat:
        return aSample.valid && aSample.combat == spec.on;
    case WatchKind::Vehicle:
        return aSample.valid && aSample.vehicle == spec.on;
    case WatchKind::Interact:
    case WatchKind::Choice:
    {
        for (const auto& event : aSample.events)
        {
            const auto type = event.value("type", std::string());
            if (spec.kind == WatchKind::Choice ? type != "choice" : (type != "interact" && type != "door"))
            {
                continue;
            }
            const auto caption = event.value("caption", std::string());
            if (!spec.caption.empty() && Lower(caption).find(Lower(spec.caption)) == std::string::npos)
            {
                continue;
            }
            if (spec.index && event.value("index", -1) != *spec.index)
            {
                continue;
            }
            if (spec.kind == WatchKind::Interact && !spec.entity.empty() && spec.entity != "any")
            {
                const auto target = event.value("target", std::string());
                // The watched entity by id, or a spawn handle whose id the sample resolved.
                const auto id = aSample.ids.count(spec.entity) ? aSample.ids.at(spec.entity) : spec.entity;
                const bool match = !target.empty() && target == id;
                if (!match)
                {
                    continue;
                }
            }
            aDetail["event"] = event;
            return true;
        }
        return false;
    }
    case WatchKind::Clock:
    {
        if (aSample.tod < 0.0)
        {
            return false;
        }
        const double last = aArmed.lastTod;
        const double mark = spec.clockSeconds;
        bool crossed = false;
        if (last >= 0.0)
        {
            if (aSample.tod >= last)
            {
                crossed = last < mark && mark <= aSample.tod;
            }
            else
            {
                crossed = mark > last || mark <= aSample.tod; // past midnight
            }
        }
        aArmed.lastTod = aSample.tod;
        aDetail["time"] = Clock(aSample.tod);
        return crossed;
    }
    case WatchKind::Timer:
        return false;
    }
    return false;
}

std::vector<Fired> WatcherEngine::Evaluate(const Sample& aSample, double aNow)
{
    std::vector<Fired> out = Advance(aNow);
    std::vector<std::string> done;
    for (auto& armed : m_armed)
    {
        if (armed.spec.kind == WatchKind::Timer)
        {
            continue;
        }
        json detail = json::object();
        const bool condition = Condition(armed, aSample, aNow, detail);
        armed.lastSampleAt = aNow;
        const bool eventKind = armed.spec.kind == WatchKind::Interact || armed.spec.kind == WatchKind::Choice || armed.spec.kind == WatchKind::Clock;
        bool fire = false;
        if (eventKind)
        {
            fire = condition;
        }
        else if (armed.first)
        {
            // Leave's condition already says whether an outside start counts (now); the rest fire at once only with now.
            fire = condition && (armed.spec.kind == WatchKind::Leave || armed.spec.now.value_or(true));
        }
        else
        {
            fire = condition && !armed.previous;
        }
        armed.first = false;
        armed.previous = condition;
        if (fire && aNow - armed.lastFired < armed.spec.cooldownS)
        {
            fire = false;
        }
        if (!fire)
        {
            continue;
        }
        Fired fired;
        fired.id = armed.spec.id;
        fired.kind = armed.spec.kind;
        fired.detail = detail;
        fired.actions = armed.spec.actions;
        out.push_back(fired);
        ++armed.fires;
        armed.lastFired = aNow;
        if (armed.spec.kind == WatchKind::Gaze)
        {
            armed.dwell = 0.0;
        }
        if (!armed.spec.repeat)
        {
            done.push_back(armed.spec.id);
        }
    }
    for (const auto& id : done)
    {
        Disarm(id);
    }
    return out;
}

// ---- the session ---------------------------------------------------------------------------------------------------------

Session::Session(SessionOps aOps)
    : m_ops(std::move(aOps))
{
}

WatcherEngine& Session::Watchers()
{
    return m_watchers;
}

uint64_t Session::NextLineId()
{
    // "XF" in the top bytes keeps the bridge's lines apart from the game's own line ids.
    return 0x5846000000000000ULL | ++m_lineCounter;
}

void Session::Report(const std::string& aKind, const std::string& aLevel, const std::string& aText, const json& aData)
{
    if (m_ops.event)
    {
        try
        {
            m_ops.event(aKind, aLevel, aText, aData);
        }
        catch (...)
        {
        }
    }
}

bool Session::CallLive() const
{
    return m_call.state == "ringing" || m_call.state == "answered";
}

bool Session::Busy() const
{
    return !m_watchers.Empty() || CallLive() || !m_lines.empty() || !m_animated.empty();
}

void Session::Fire(const std::vector<Fired>& aFired, const Sample* aSample, double aNow)
{
    for (const auto& fired : aFired)
    {
        json data{{"watch", fired.id}, {"type", WatchKindName(fired.kind)}, {"detail", fired.detail}};
        if (aSample != nullptr && aSample->valid)
        {
            data["v"] = Arr(aSample->v);
            data["yaw"] = std::round(aSample->yaw * 10.0) / 10.0;
        }
        if (aSample != nullptr && aSample->tod >= 0.0)
        {
            data["time"] = Clock(aSample->tod);
        }
        if (fired.expired)
        {
            data["expired"] = true;
            Report("watch", "info", "watcher " + fired.id + " (" + WatchKindName(fired.kind) + ") expired", data);
            continue;
        }
        data["actions"] = fired.actions.size();
        Report("watch", "done", "watcher " + fired.id + " fired: " + WatchKindName(fired.kind), data);
        if (!fired.actions.empty() && m_ops.micro)
        {
            MicroBatch batch;
            batch.watch = fired.id;
            batch.seq = ++m_batchSeq;
            batch.actions = fired.actions;
            try
            {
                m_ops.micro(std::move(batch));
            }
            catch (const std::exception& e)
            {
                Report("micro", "warn", "watcher " + fired.id + "'s actions couldn't be queued: " + e.what(), json{{"watch", fired.id}});
            }
        }
    }
    (void)aNow;
}

void Session::TickCall(const Sample& aSample, double aNow)
{
    if (aSample.callFact < 0)
    {
        return;
    }
    const auto contact = m_call.contact;
    const auto id = m_call.id;
    if (m_call.state == "ringing")
    {
        if (aSample.callFact == 1)
        {
            m_call.sawRing = true;
        }
        else if (aSample.callFact == 2)
        {
            m_call.state = "answered";
            m_call.sawTalk = true;
            try
            {
                if (m_ops.callStart)
                {
                    m_ops.callStart(contact, m_call.mode);
                }
            }
            catch (const std::exception& e)
            {
                Report("phone", "warn", std::string("the call couldn't be started on the phone: ") + e.what(), json{{"what", "start_failed"}, {"call", id}, {"error", e.what()}});
            }
            StartCallLines(aNow);
            Report("phone", "done", "the player answered " + contact, json{{"what", "answered"}, {"call", id}, {"contact", contact}});
        }
        else if (aSample.callFact == 3)
        {
            m_call.state = "declined";
            try
            {
                if (m_ops.callEnd)
                {
                    m_ops.callEnd(contact);
                }
            }
            catch (...)
            {
            }
            Report("phone", "done", "the player declined " + contact, json{{"what", "declined"}, {"call", id}, {"contact", contact}});
        }
        else if (aSample.callFact == 0 && m_call.sawRing)
        {
            // The game's own ring timeout ended it (PhoneTimeoutRequest) before ours did.
            m_call.state = "missed";
            Report("phone", "info", "the call from " + contact + " was missed", json{{"what", "missed"}, {"call", id}, {"contact", contact}, {"by", "the game's ring timeout"}});
        }
        else if (aSample.callFact == 0 && !m_call.sawRing && aNow - m_call.startedAt > 3.0)
        {
            m_call.state = "failed";
            try
            {
                if (m_ops.callEnd)
                {
                    m_ops.callEnd(contact);
                }
            }
            catch (...)
            {
            }
            Report("phone", "warn", "the phone never rang for " + contact + " (the game's phone system didn't take the call)",
                   json{{"what", "failed"}, {"call", id}, {"contact", contact}});
        }
    }
    else if (m_call.state == "answered" && aSample.callFact == 0 && aNow - m_call.startedAt > 1.0)
    {
        // Something other than the bridge ended it (the player hung up, or the game's own call took the phone).
        m_call.state = "hung_up";
        HideLines("call:" + std::to_string(id));
        Report("phone", "done", "the call from " + contact + " ended on the player's side", json{{"what", "hung_up"}, {"call", id}, {"contact", contact}});
    }
}

void Session::Tick(double aNow)
{
    m_now = aNow;
    // Timers and expiry need no sample.
    if (!m_watchers.Empty())
    {
        const auto advanced = m_watchers.Advance(aNow);
        if (!advanced.empty())
        {
            Fire(advanced, nullptr, aNow);
        }
    }
    const bool callLive = CallLive();
    const bool watchWants = m_watchers.NeedsSamples() && aNow - m_lastSample >= m_watchers.Interval() - 1e-6;
    const bool callWants = callLive && aNow - m_lastSample >= 0.2 - 1e-6;
    if ((watchWants || callWants) && m_ops.sample)
    {
        auto wants = m_watchers.Wants();
        if (callLive)
        {
            wants.callContact = m_call.contact;
        }
        Sample sample;
        bool ok = false;
        try
        {
            sample = SampleFromJson(m_ops.sample(wants));
            ok = true;
        }
        catch (const std::exception& e)
        {
            Report("watch", "warn", std::string("the watchers' sample failed: ") + e.what(), json{{"error", e.what()}});
        }
        m_lastSample = aNow;
        if (ok)
        {
            if (callLive)
            {
                TickCall(sample, aNow);
            }
            if (!m_watchers.Empty() && m_watchers.NeedsSamples())
            {
                const auto fired = m_watchers.Evaluate(sample, aNow);
                if (!fired.empty())
                {
                    Fire(fired, &sample, aNow);
                }
            }
        }
    }

    // The call's clocks.
    if (m_call.state == "ringing" && aNow >= m_call.ringUntil)
    {
        m_call.state = "missed";
        try
        {
            if (m_ops.callEnd)
            {
                m_ops.callEnd(m_call.contact);
            }
        }
        catch (...)
        {
        }
        Report("phone", "info", "the call from " + m_call.contact + " was missed", json{{"what", "missed"}, {"call", m_call.id}, {"contact", m_call.contact}});
    }
    if (m_call.state == "answered" && aNow >= m_call.endsAt)
    {
        m_call.state = "ended";
        try
        {
            if (m_ops.callEnd)
            {
                m_ops.callEnd(m_call.contact);
            }
        }
        catch (...)
        {
        }
        Report("phone", "done", "the call from " + m_call.contact + " ended", json{{"what", "ended"}, {"call", m_call.id}, {"contact", m_call.contact}});
    }

    // Timed lines.
    for (auto it = m_lines.begin(); it != m_lines.end();)
    {
        if (!it->shown && aNow >= it->start && aNow < it->end)
        {
            try
            {
                if (m_ops.showLine)
                {
                    m_ops.showLine(*it);
                }
            }
            catch (...)
            {
            }
            it->shown = true;
        }
        if (aNow >= it->end)
        {
            if (it->shown && m_ops.hideLine)
            {
                try
                {
                    m_ops.hideLine(it->id);
                }
                catch (...)
                {
                }
            }
            it = m_lines.erase(it);
            continue;
        }
        ++it;
    }

    // Light patterns at up to 30 Hz, only when a value moved.
    if (!m_animated.empty() && aNow - m_lastLight >= 1.0 / 30.0)
    {
        m_lastLight = aNow;
        for (auto& [handle, light] : m_animated)
        {
            const double value = light.base * PatternValue(light.pattern, aNow - light.start);
            if (light.last < 0.0 || std::abs(value - light.last) > std::max(0.01 * light.base, 1e-3))
            {
                light.last = value;
                try
                {
                    if (m_ops.lightIntensity)
                    {
                        m_ops.lightIntensity(handle, value);
                    }
                }
                catch (...)
                {
                }
            }
        }
    }
}

json Session::Arm(const WatchSpec& aSpec, double aNow)
{
    const auto id = m_watchers.Arm(aSpec, aNow);
    Report("watch", "info", "watcher " + id + " armed: " + WatchKindName(aSpec.kind), json{{"watch", id}, {"type", WatchKindName(aSpec.kind)}, {"armed", true}});
    return json{{"id", id}, {"kind", WatchKindName(aSpec.kind)}, {"expires_s", aSpec.expiresS}, {"armed", m_watchers.Count()},
                {"undo", {{"method", "watch.disarm"}, {"params", {{"id", id}}}}},
                {"undo_note", "the result's undo disarms it; it also ends when it fires (unless repeat), when it expires, by the kill switch and when a save loads"}};
}

json Session::Disarm(const std::string& aId, bool aAll)
{
    if (aAll)
    {
        const auto count = m_watchers.DisarmAll();
        return json{{"disarmed", count}, {"undo", nullptr}, {"undo_note", "arm them again with watch_arm"}};
    }
    const bool removed = m_watchers.Disarm(aId);
    if (!removed)
    {
        throw MethodError("not_found", "no watcher '" + aId + "' is armed (watch_list shows them)");
    }
    return json{{"disarmed", 1}, {"id", aId}, {"undo", nullptr}, {"undo_note", "arm it again with watch_arm"}};
}

json Session::WatchList(double aNow) const
{
    return json{{"watchers", m_watchers.List(aNow)}, {"count", m_watchers.Count()}, {"limit", kMaxWatchers}};
}

uint64_t Session::ShowLine(const std::string& aOwner, const std::string& aSpeaker, const std::string& aText, int32_t aType, double aSeconds, double aNow)
{
    TimedLine line;
    line.id = NextLineId();
    line.owner = aOwner;
    line.speaker = aSpeaker;
    line.text = aText;
    line.type = aType;
    line.start = aNow;
    line.end = aNow + aSeconds;
    m_lines.push_back(line);
    return line.id;
}

bool Session::HideLines(const std::string& aOwner)
{
    bool any = false;
    for (auto it = m_lines.begin(); it != m_lines.end();)
    {
        if (it->owner == aOwner || aOwner.empty())
        {
            if (it->shown && m_ops.hideLine)
            {
                try
                {
                    m_ops.hideLine(it->id);
                }
                catch (...)
                {
                }
            }
            any = true;
            it = m_lines.erase(it);
            continue;
        }
        ++it;
    }
    return any;
}

bool Session::HideLinesPrefix(const std::string& aPrefix)
{
    bool any = false;
    for (auto it = m_lines.begin(); it != m_lines.end();)
    {
        if (it->owner.rfind(aPrefix, 0) == 0)
        {
            if (it->shown && m_ops.hideLine)
            {
                try
                {
                    m_ops.hideLine(it->id);
                }
                catch (...)
                {
                }
            }
            any = true;
            it = m_lines.erase(it);
            continue;
        }
        ++it;
    }
    return any;
}

size_t Session::HideAllLines()
{
    const auto count = m_lines.size();
    HideLines({});
    return count;
}

json Session::Call(const CallRequest& aRequest, double aNow)
{
    if (CallLive())
    {
        throw MethodError("busy", "a call from " + m_call.contact + " is still " + m_call.state + "; end it first (phone_end)");
    }
    const std::string mode = aRequest.video ? "video" : "audio";
    // The ring first: the game's phone may refuse (a contact the journal doesn't have, a phone the player can't use now), and
    // a refusal leaves nothing behind.
    if (m_ops.callRing)
    {
        m_ops.callRing(aRequest.contact, mode, aRequest.rejectable);
    }
    m_call = PhoneCall{};
    m_call.id = ++m_phoneCounter;
    m_call.contact = aRequest.contact;
    m_call.mode = mode;
    m_call.lines = aRequest.lines;
    m_call.state = "ringing";
    m_call.startedAt = aNow;
    m_call.ringUntil = aNow + aRequest.ringS;
    Report("phone", "info", aRequest.contact + " is calling", json{{"what", "ringing"}, {"call", m_call.id}, {"contact", aRequest.contact}, {"mode", mode}});
    m_now = aNow;
    return json{{"call", m_call.id}, {"state", "ringing"}, {"contact", aRequest.contact}, {"mode", mode}, {"ring_s", aRequest.ringS}, {"lines", m_call.lines.size()},
                {"undo", {{"method", "phone.end"}, {"params", json::object()}}},
                {"undo_note", "the result's undo ends the call (the ring or the line stops, the phone is free); an unanswered call ends by itself"}};
}

void Session::StartCallLines(double aNow)
{
    double at = aNow + 0.6;
    for (const auto& line : m_call.lines)
    {
        TimedLine timed;
        timed.id = NextLineId();
        timed.owner = "call:" + std::to_string(m_call.id);
        timed.speaker = line.speaker;
        timed.text = line.text;
        timed.type = 2; // scnDialogLineType.Holocall: the call's own subtitle style
        timed.start = at;
        timed.end = at + line.seconds;
        m_lines.push_back(timed);
        at += line.seconds + 0.25;
    }
    m_call.endsAt = at + 0.4;
}

json Session::EndCall(double aNow, const std::string& aWhy)
{
    const auto was = m_call.state;
    if (!CallLive())
    {
        return json{{"ended", false}, {"state", was}, {"undo", nullptr}, {"undo_note", "no call was ringing or running"}};
    }
    m_call.state = "cancelled";
    HideLines("call:" + std::to_string(m_call.id));
    std::string phoneError;
    try
    {
        if (m_ops.callEnd)
        {
            m_ops.callEnd(m_call.contact);
        }
    }
    catch (const std::exception& e)
    {
        phoneError = e.what();
    }
    Report("phone", "info", "the call from " + m_call.contact + " was ended (" + aWhy + ")",
           json{{"what", "cancelled"}, {"call", m_call.id}, {"was", was}, {"why", aWhy}});
    m_now = aNow;
    json out{{"ended", true}, {"was", was}, {"undo", nullptr}, {"undo_note", "a call can't be resumed; start another with phone_call"}};
    if (!phoneError.empty())
    {
        out["phone_error"] = phoneError;
    }
    return out;
}

json Session::Text(const TextRequest& aRequest, double aNow)
{
    PhoneText text;
    text.id = ++m_phoneCounter;
    text.contact = aRequest.contact;
    text.text = aRequest.text;
    text.sentAt = aNow;
    m_texts.push_back(text);
    while (m_texts.size() > kMaxTexts)
    {
        m_texts.erase(m_texts.begin());
    }
    Report("phone", "info", "a message from " + text.contact + " was shown", json{{"what", "text"}, {"message", text.id}, {"contact", text.contact}});
    return json{{"message", text.id}, {"contact", text.contact}, {"undo", nullptr},
                {"undo_note", "a message toast can't be taken back; it fades by itself after about seven seconds"}};
}

json Session::PhoneState(double aNow) const
{
    json call = nullptr;
    if (m_call.id != 0)
    {
        call = {{"id", m_call.id}, {"contact", m_call.contact}, {"mode", m_call.mode}, {"state", m_call.state}};
        if (m_call.state == "ringing")
        {
            call["ring_left_s"] = std::max(0.0, std::round((m_call.ringUntil - aNow) * 10.0) / 10.0);
        }
        if (m_call.state == "answered")
        {
            call["ends_in_s"] = std::max(0.0, std::round((m_call.endsAt - aNow) * 10.0) / 10.0);
        }
    }
    json texts = json::array();
    for (const auto& text : m_texts)
    {
        texts.push_back({{"id", text.id}, {"contact", text.contact}, {"text", text.text}, {"ago_s", std::round((aNow - text.sentAt) * 10.0) / 10.0}});
    }
    return json{{"call", call}, {"messages", texts}};
}

json Session::RenderTracker()
{
    if (!m_ops.tracker)
    {
        return json{{"drawn", false}, {"why", "no tracker"}};
    }
    std::vector<Quest> shown;
    for (const auto& id : m_questOrder)
    {
        const auto it = m_quests.find(id);
        if (it != m_quests.end() && it->second.show)
        {
            shown.push_back(it->second);
        }
    }
    // The HUD's tracker holds one quest: the one set or updated last among those shown (like the game's tracked quest).
    if (shown.size() > 1)
    {
        shown.erase(shown.begin(), shown.end() - 1);
    }
    // A finished objective is drawn once, with its tick or cross (the game plays that animation and then drops the line); the
    // next drawing leaves it out. An objective that is active again can finish again.
    for (auto& quest : shown)
    {
        std::vector<Objective> kept;
        for (const auto& objective : quest.objectives)
        {
            const auto key = quest.id + "/" + objective.id + "/" + objective.state;
            if (objective.state == "done" || objective.state == "failed")
            {
                if (!m_drawnFinal.insert(key).second)
                {
                    continue;
                }
            }
            else
            {
                m_drawnFinal.erase(quest.id + "/" + objective.id + "/done");
                m_drawnFinal.erase(quest.id + "/" + objective.id + "/failed");
            }
            kept.push_back(objective);
        }
        quest.objectives = kept;
    }
    try
    {
        m_ops.tracker(shown);
    }
    catch (const std::exception& e)
    {
        Report("quest", "warn", std::string("the quest tracker couldn't be drawn: ") + e.what(), json{{"error", e.what()}});
        return json{{"drawn", false}, {"why", e.what()}};
    }
    return json{{"drawn", !shown.empty()}};
}

void Session::ArmQuestAreas(const Quest& aQuest, double aNow)
{
    m_watchers.DisarmPrefix("quest." + aQuest.id + ".");
    for (const auto& objective : aQuest.objectives)
    {
        if (!objective.area || objective.state != "active")
        {
            continue;
        }
        WatchSpec spec;
        spec.id = "quest." + aQuest.id + "." + objective.id;
        spec.kind = WatchKind::Enter;
        spec.point = objective.area->at;
        spec.radius = objective.area->radius;
        spec.expiresS = kMaxWatchSeconds;
        spec.hz = 4.0;
        if (objective.area->completeOnEnter)
        {
            MicroAction action;
            action.method = "quest.objective";
            action.params = {{"quest", aQuest.id}, {"objective", objective.id}, {"state", "done"}};
            spec.actions.push_back(action);
        }
        try
        {
            m_watchers.Arm(spec, aNow);
        }
        catch (const std::exception& e)
        {
            Report("quest", "warn", "objective " + objective.id + "'s area couldn't be watched: " + e.what(), json{{"quest", aQuest.id}, {"objective", objective.id}});
        }
    }
}

json Session::QuestSet(const QuestSetRequest& aRequest, double aNow)
{
    const auto& quest = aRequest.quest;
    json previous = nullptr;
    if (const auto it = m_quests.find(quest.id); it != m_quests.end())
    {
        previous = QuestJson(it->second);
    }
    else if (m_quests.size() >= kMaxQuests)
    {
        throw MethodError("too_many", "at most " + std::to_string(kMaxQuests) + " XF quests at once; clear one first (quest_clear)");
    }
    // The quest set or updated last is the one the tracker shows.
    m_questOrder.erase(std::remove(m_questOrder.begin(), m_questOrder.end(), quest.id), m_questOrder.end());
    m_questOrder.push_back(quest.id);
    m_quests[quest.id] = quest;
    ArmQuestAreas(quest, aNow);
    const auto tracker = RenderTracker();
    Report("quest", "info", "quest " + quest.id + (previous.is_null() ? " set" : " updated"), json{{"quest", quest.id}, {"what", previous.is_null() ? "set" : "updated"}});
    json undo = previous.is_null() ? json{{"method", "quest.clear"}, {"params", {{"id", quest.id}}}}
                                   : json{{"method", "quest.set"}, {"params", previous}};
    return json{{"quest", QuestJson(quest)}, {"previous", previous}, {"tracker", tracker}, {"undo", undo},
                {"undo_note", "the result's undo puts the earlier quest back (or clears a new one); nothing reaches the journal or a save"}};
}

json Session::QuestObjective(const ObjectiveRequest& aRequest, double aNow)
{
    const auto it = m_quests.find(aRequest.quest);
    if (it == m_quests.end())
    {
        throw MethodError("not_found", "no XF quest '" + aRequest.quest + "' (quest_state lists them)");
    }
    auto& quest = it->second;
    const auto objective = std::find_if(quest.objectives.begin(), quest.objectives.end(), [&](const Objective& o) { return o.id == aRequest.objective; });
    if (objective == quest.objectives.end())
    {
        throw MethodError("not_found", "quest '" + quest.id + "' has no objective '" + aRequest.objective + "'");
    }
    json before{{"state", objective->state}, {"text", objective->text}};
    m_questOrder.erase(std::remove(m_questOrder.begin(), m_questOrder.end(), quest.id), m_questOrder.end());
    m_questOrder.push_back(quest.id);
    if (aRequest.state)
    {
        objective->state = *aRequest.state;
    }
    if (aRequest.text)
    {
        objective->text = *aRequest.text;
    }
    ArmQuestAreas(quest, aNow);
    const auto tracker = RenderTracker();
    bool complete = std::any_of(quest.objectives.begin(), quest.objectives.end(), [](const Objective& o) { return !o.optional; });
    for (const auto& o : quest.objectives)
    {
        complete = complete && (o.optional || o.state == "done" || o.state == "hidden");
    }
    Report("quest", "info", "quest " + quest.id + ": objective " + objective->id + " is " + objective->state,
           json{{"quest", quest.id}, {"objective", objective->id}, {"state", objective->state}, {"quest_complete", complete}});
    json undoParams{{"quest", quest.id}, {"objective", objective->id}, {"notify", false}};
    if (aRequest.state)
    {
        undoParams["state"] = before["state"];
    }
    if (aRequest.text)
    {
        undoParams["text"] = before["text"];
    }
    return json{{"quest", quest.id}, {"objective", objective->id}, {"state", objective->state}, {"text", objective->text}, {"before", before},
                {"tracker", tracker}, {"quest_complete", complete}, {"undo", {{"method", "quest.objective"}, {"params", undoParams}}},
                {"undo_note", "the result's undo puts the objective's earlier state and text back"}};
}

json Session::QuestClear(const std::string& aId, bool aAll, double aNow)
{
    json removed = json::array();
    if (aAll)
    {
        for (const auto& id : m_questOrder)
        {
            if (const auto it = m_quests.find(id); it != m_quests.end())
            {
                removed.push_back(QuestJson(it->second));
                m_watchers.DisarmPrefix("quest." + id + ".");
            }
        }
        m_quests.clear();
        m_questOrder.clear();
    }
    else
    {
        const auto it = m_quests.find(aId);
        if (it == m_quests.end())
        {
            throw MethodError("not_found", "no XF quest '" + aId + "' (quest_state lists them)");
        }
        removed.push_back(QuestJson(it->second));
        m_quests.erase(it);
        m_questOrder.erase(std::remove(m_questOrder.begin(), m_questOrder.end(), aId), m_questOrder.end());
        m_watchers.DisarmPrefix("quest." + aId + ".");
    }
    for (auto it = m_drawnFinal.begin(); it != m_drawnFinal.end();)
    {
        const bool gone = aAll || it->rfind(aId + "/", 0) == 0;
        it = gone ? m_drawnFinal.erase(it) : std::next(it);
    }
    const auto tracker = RenderTracker();
    json out{{"removed", removed.size()}, {"quests", removed}, {"tracker", tracker}};
    if (removed.size() == 1)
    {
        out["undo"] = {{"method", "quest.set"}, {"params", removed[0]}};
        out["undo_note"] = "the result's undo sets the quest again";
    }
    else
    {
        out["undo"] = nullptr;
        json list = json::array();
        for (const auto& quest : removed)
        {
            list.push_back({{"method", "quest.set"}, {"params", quest}});
        }
        out["undo_list"] = list;
        out["undo_note"] = removed.empty() ? "nothing was set" : "undo_list sets each quest again";
    }
    (void)aNow;
    return out;
}

json Session::QuestState() const
{
    json quests = json::array();
    for (const auto& id : m_questOrder)
    {
        if (const auto it = m_quests.find(id); it != m_quests.end())
        {
            quests.push_back(QuestJson(it->second));
        }
    }
    return json{{"quests", quests}, {"note", "journal-free: the quests live in the bridge's session and the HUD's tracker, never in the journal or a save"}};
}

void Session::AnimateLight(int32_t aHandle, double aBaseIntensity, const LightPattern& aPattern, double aNow)
{
    if (aPattern.kind == "steady" || aPattern.kind == "flicker")
    {
        m_animated.erase(aHandle);
        return;
    }
    if (!m_animated.count(aHandle) && m_animated.size() >= kMaxAnimatedLights)
    {
        throw MethodError("too_many", "at most " + std::to_string(kMaxAnimatedLights) + " lights run a pattern at once");
    }
    Animated animated;
    animated.base = aBaseIntensity;
    animated.pattern = aPattern;
    animated.start = aNow;
    m_animated[aHandle] = animated;
}

void Session::ForgetLight(int32_t aHandle)
{
    m_animated.erase(aHandle);
}

std::optional<LightPattern> Session::LightPatternOf(int32_t aHandle) const
{
    const auto it = m_animated.find(aHandle);
    if (it == m_animated.end())
    {
        return std::nullopt;
    }
    return it->second.pattern;
}

size_t Session::AnimatedLights() const
{
    return m_animated.size();
}

json Session::Reset(bool aUi)
{
    json out{{"watchers", m_watchers.DisarmAll()}, {"lines", m_lines.size()}, {"quests", m_quests.size()}, {"lights_animated", m_animated.size()}};
    const bool callLive = CallLive();
    if (aUi)
    {
        HideLines({});
        if (callLive && m_ops.callEnd)
        {
            try
            {
                m_ops.callEnd(m_call.contact);
            }
            catch (...)
            {
            }
        }
        if (!m_quests.empty() && m_ops.tracker)
        {
            try
            {
                m_ops.tracker({});
            }
            catch (...)
            {
            }
        }
    }
    out["call"] = callLive ? m_call.state : "none";
    m_lines.clear();
    m_quests.clear();
    m_questOrder.clear();
    m_animated.clear();
    m_drawnFinal.clear();
    m_call = PhoneCall{};
    m_texts.clear();
    return out;
}

json Session::Digest(double aNow) const
{
    json watchers = json::array();
    for (const auto& item : m_watchers.List(aNow))
    {
        watchers.push_back({{"id", item["id"]}, {"kind", item["kind"]}, {"remaining_s", item["remaining_s"]}});
    }
    json quests = json::array();
    for (const auto& id : m_questOrder)
    {
        if (const auto it = m_quests.find(id); it != m_quests.end())
        {
            json objectives = json::object();
            for (const auto& o : it->second.objectives)
            {
                objectives[o.id] = o.state;
            }
            quests.push_back({{"id", id}, {"objectives", objectives}});
        }
    }
    json phone = nullptr;
    if (m_call.id != 0)
    {
        phone = {{"call", m_call.state}, {"contact", m_call.contact}};
    }
    return json{{"watchers", watchers}, {"quests", quests}, {"phone", phone}, {"lines", m_lines.size()}};
}

size_t Session::QuestCount() const
{
    return m_quests.size();
}

// ---- game.digest --------------------------------------------------------------------------------------------------------

const std::vector<std::string>& DefaultDigestKinds()
{
    // What happens without the agent's own command: watchers, their actions, the player's side of the phone, quests moved by an
    // area, the toolkit's releases, and the session's answers, comments, notes, kills and handovers.
    static const std::vector<std::string> kinds{"dm.watch", "dm.micro", "dm.phone", "dm.quest", "dm.released", "answer", "comment", "note", "kill", "handover", "resume"};
    return kinds;
}

DigestRequest ParseDigest(const json& aParams)
{
    p::RequireOnly(aParams, {"events", "kinds", "sky"});
    DigestRequest request;
    request.events = static_cast<size_t>(p::CheckInteger(aParams, "events", 0, 32).value_or(8));
    if (const auto it = aParams.find("kinds"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > 16)
        {
            Bad("'kinds' must be a list of event kinds (at most 16)");
        }
        for (const auto& kind : *it)
        {
            if (!kind.is_string() || !NameChars(kind.get<std::string>(), 32, "."))
            {
                Bad("each of 'kinds' must be an event kind such as watch");
            }
            request.kinds.push_back(kind.get<std::string>());
        }
    }
    request.sky = p::CheckBoolean(aParams, "sky").value_or(true);
    return request;
}

std::string HpBand(double aPercent)
{
    if (aPercent < 0.0)
    {
        return "unknown";
    }
    if (aPercent >= 95.0)
    {
        return "full";
    }
    if (aPercent >= 60.0)
    {
        return "high";
    }
    if (aPercent >= 30.0)
    {
        return "mid";
    }
    if (aPercent >= 10.0)
    {
        return "low";
    }
    return "critical";
}
} // namespace xfb::dm
