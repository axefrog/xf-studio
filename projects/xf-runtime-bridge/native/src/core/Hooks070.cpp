#include "core/Hooks070.hpp"

#include <algorithm>
#include <cmath>

#include "core/Dispatcher.hpp"
#include "core/Params.hpp"

namespace xfb::hooks
{
namespace p = xfb::params;

const std::vector<std::string>& CyberwareAreas()
{
    static const std::vector<std::string> areas{"ArmsCW",
                                                "HandsCW",
                                                "EyesCW",
                                                "FaceCW",
                                                "FrontalCortexCW",
                                                "SystemReplacementCW",
                                                "NervousSystemCW",
                                                "CardiovascularSystemCW",
                                                "ImmuneSystemCW",
                                                "IntegumentarySystemCW",
                                                "MusculoskeletalSystemCW",
                                                "LegsCW"};
    return areas;
}

namespace
{
bool KnownArea(const std::string& aName)
{
    const auto& areas = CyberwareAreas();
    return std::find(areas.begin(), areas.end(), aName) != areas.end();
}

std::string AreaList()
{
    std::string out;
    for (const auto& area : CyberwareAreas())
    {
        out += (out.empty() ? "" : ", ") + area;
    }
    return out;
}

std::string RecordName(const json& aParams, const char* aKey, bool aRequired)
{
    const auto text = p::CheckText(aParams, aKey, 128);
    if (!text)
    {
        if (aRequired)
        {
            p::CheckFail(std::string("'") + aKey + "' is required: an item record such as Items.StrongArms");
        }
        return {};
    }
    if (!p::CheckRecordName(*text))
    {
        p::CheckFail(std::string("'") + aKey + "' must be a record name such as Items.StrongArms");
    }
    return *text;
}
} // namespace

CyberwareStateRequest ParseCyberwareState(const json& aParams)
{
    p::RequireOnly(aParams, {"areas"});
    CyberwareStateRequest request;
    if (const auto it = aParams.find("areas"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > CyberwareAreas().size())
        {
            p::CheckFail("'areas' must be a list of cyberware areas (" + AreaList() + ")");
        }
        for (const auto& area : *it)
        {
            if (!area.is_string() || !KnownArea(area.get<std::string>()))
            {
                p::CheckFail("each of 'areas' must be one of " + AreaList());
            }
            request.areas.push_back(area.get<std::string>());
        }
    }
    return request;
}

std::string AreasCsv(const std::vector<std::string>& aAreas)
{
    std::string out;
    for (const auto& area : aAreas)
    {
        out += (out.empty() ? "" : ",") + area;
    }
    return out;
}

CyberwareEquipRequest ParseCyberwareEquip(const json& aParams)
{
    p::RequireOnly(aParams, {"item", "slot", "add_if_missing", "id", "remove_added_item"});
    CyberwareEquipRequest request;
    request.item = RecordName(aParams, "item", true);
    request.slot = static_cast<int32_t>(p::CheckInteger(aParams, "slot", 0, 9).value_or(-1));
    request.addIfMissing = p::CheckBoolean(aParams, "add_if_missing").value_or(false);
    if (const auto id = p::CheckText(aParams, "id", 24))
    {
        if (id->empty() || id->find_first_not_of("0123456789") != std::string::npos)
        {
            p::CheckFail("'id' must be an item copy's identity (digits), as an undo gives it");
        }
        request.id = *id;
    }
    request.removeAddedItem = RecordName(aParams, "remove_added_item", false);
    return request;
}

CyberwareUnequipRequest ParseCyberwareUnequip(const json& aParams)
{
    p::RequireOnly(aParams, {"area", "item", "slot", "remove_added"});
    CyberwareUnequipRequest request;
    request.item = RecordName(aParams, "item", false);
    if (const auto area = p::CheckText(aParams, "area", 40))
    {
        if (!KnownArea(*area))
        {
            p::CheckFail("'area' must be one of " + AreaList());
        }
        request.area = *area;
    }
    if (request.area.empty() && request.item.empty())
    {
        p::CheckFail("give area (a cyberware area such as ArmsCW) or item (the record in the slot)");
    }
    request.slot = static_cast<int32_t>(p::CheckInteger(aParams, "slot", 0, 9).value_or(-1));
    request.removeAdded = p::CheckBoolean(aParams, "remove_added").value_or(false);
    if (request.removeAdded && request.item.empty())
    {
        p::CheckFail("remove_added needs item: the record the bridge added");
    }
    return request;
}

json CyberwareEquipUndo(const json& aStep, const std::string& aItem)
{
    const auto area = aStep.value("area", std::string());
    const auto slot = aStep.value("slot", 0);
    const auto previous = aStep.value("previous", std::string());
    if (aStep.value("already_equipped", false))
    {
        return nullptr;
    }
    if (!previous.empty())
    {
        // RB-109: the exact earlier copy, and the copy the bridge added for this equip removed once it is out of the slot.
        json params{{"item", previous}, {"slot", slot}};
        if (const auto id = aStep.value("id", std::string()); !id.empty())
        {
            params["id"] = id;
        }
        if (aStep.value("added", false))
        {
            params["remove_added_item"] = aItem;
        }
        return json{{"method", "cyberware.equip"}, {"params", params}};
    }
    json params{{"area", area}, {"slot", slot}};
    if (aStep.value("added", false))
    {
        params["item"] = aItem;
        params["remove_added"] = true;
    }
    return json{{"method", "cyberware.unequip"}, {"params", params}};
}

json RunCyberwareEquip(const CyberwareEquipRequest& aRequest, const CyberwareEquipOps& aOps)
{
    // A refusal here changed nothing (the script refuses before its first change, or takes an added copy out again).
    const auto step = aOps.equip();
    auto out = step;
    out["undo"] = CyberwareEquipUndo(step, aRequest.item);
    out["undo_note"] = out["undo"].is_null() ? "it was already equipped: nothing changed"
                                             : "the result's undo puts the earlier item back (or empties the slot and removes an item the bridge added); loading the save undoes it too";
    const auto area = step.value("area", std::string());
    const auto slot = step.value("slot", 0);
    const auto fail = [&](const std::string& aCode, const std::string& aWhat) {
        out["equipped"] = "unknown";
        out["settle_error"] = {{"code", aCode}, {"message", aWhat}};
        out["note"] = "the equip request was sent, but reading the slot back failed (" + aWhat +
                      "); the undo above still puts things back, and cyberware_state shows what V has";
    };
    try
    {
        const auto now = aOps.settle(area, slot);
        const auto item = now.value("item", std::string());
        out["now"] = item;
        const bool equipped = item == aRequest.item;
        out["equipped"] = equipped;
        if (!equipped)
        {
            out["note"] = "the slot doesn't show the item yet: the game may still be applying it, or refused it (cyberware_state shows what V has)";
        }
        if (equipped && !aRequest.removeAddedItem.empty())
        {
            // A swap's undo: the copy the bridge added for the swap came out of the slot; remove it now.
            try
            {
                out["removed"] = aOps.removeAdded(aRequest.removeAddedItem).value("removed", false);
            }
            catch (const std::exception& e)
            {
                out["removed"] = false;
                out["remove_note"] = std::string("the added copy stays in V's inventory: ") + e.what();
            }
        }
    }
    catch (const MethodError& e)
    {
        fail(e.code, e.what());
    }
    catch (const std::exception& e)
    {
        fail("internal", e.what());
    }
    return out;
}

json CyberwareUnequipUndo(const json& aStep, bool aRemoved)
{
    const auto previous = aStep.value("previous", std::string());
    if (previous.empty() || aRemoved)
    {
        return nullptr;
    }
    return json{{"method", "cyberware.equip"}, {"params", {{"item", previous}, {"slot", aStep.value("slot", 0)}}}};
}

WorldStateRequest ParseWorldState(const json& aParams)
{
    p::RequireOnly(aParams, {"facts"});
    WorldStateRequest request;
    if (const auto it = aParams.find("facts"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > 16)
        {
            p::CheckFail("'facts' must be a list of at most 16 quest fact names");
        }
        for (const auto& fact : *it)
        {
            if (!fact.is_string() || fact.get<std::string>().empty() || fact.get<std::string>().size() > 96)
            {
                p::CheckFail("each of 'facts' must be a fact name (letters, digits, _ and .)");
            }
            const auto name = fact.get<std::string>();
            for (const char c : name)
            {
                if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.'))
                {
                    p::CheckFail("each of 'facts' must be a fact name (letters, digits, _ and .)");
                }
            }
            request.facts.push_back(name);
        }
    }
    return request;
}

WorldProbeRequest ParseWorldProbe(const json& aParams)
{
    p::RequireOnly(aParams, {"points", "around_v", "ring_m", "count", "radius_m", "down_m", "clearance_m", "sight_from"});
    WorldProbeRequest request;
    if (const auto it = aParams.find("points"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->empty() || it->size() > 16)
        {
            p::CheckFail("'points' must be a list of 1 to 16 world points [x, y, z]");
        }
        for (const auto& point : *it)
        {
            if (!point.is_array() || point.size() != 3 || !point[0].is_number() || !point[1].is_number() || !point[2].is_number())
            {
                p::CheckFail("each of 'points' must be [x, y, z] in metres");
            }
            std::array<double, 3> v{point[0].get<double>(), point[1].get<double>(), point[2].get<double>()};
            for (const auto c : v)
            {
                if (!std::isfinite(c) || std::abs(c) > 1e5)
                {
                    p::CheckFail("each of 'points' must be a world point within 100 km");
                }
            }
            request.points.push_back(v);
        }
    }
    request.aroundV = p::CheckBoolean(aParams, "around_v").value_or(false);
    request.ringM = p::CheckNumber(aParams, "ring_m", 0.5, 50.0).value_or(3.0);
    request.count = static_cast<int32_t>(p::CheckInteger(aParams, "count", 1, 15).value_or(8));
    request.radius = p::CheckNumber(aParams, "radius_m", 0.2, 10.0).value_or(2.0);
    request.down = p::CheckNumber(aParams, "down_m", 0.5, 100.0).value_or(10.0);
    request.clearance = p::CheckNumber(aParams, "clearance_m", 0.05, 3.0).value_or(0.0);
    request.sightFrom = p::CheckPoint(aParams, "sight_from", 1e5);
    if (request.points.empty() && !request.aroundV)
    {
        p::CheckFail("give points ([x, y, z] each) or around_v: true (a ring around V)");
    }
    if (!request.points.empty() && request.aroundV)
    {
        p::CheckFail("give points or around_v, not both");
    }
    return request;
}

std::vector<std::array<double, 3>> RingPoints(const std::array<double, 3>& aCentre, double aYawDeg, double aRadius, int32_t aCount)
{
    constexpr double kDeg = 3.14159265358979323846 / 180.0;
    std::vector<std::array<double, 3>> out;
    out.push_back(aCentre);
    for (int32_t i = 0; i < aCount; ++i)
    {
        const double a = (aYawDeg + 360.0 * i / aCount) * kDeg;
        // yaw 0 faces +Y; counter-clockwise seen from above: forward = (-sin, cos)
        out.push_back({aCentre[0] - std::sin(a) * aRadius, aCentre[1] + std::cos(a) * aRadius, aCentre[2]});
    }
    return out;
}

WeatherRequest ParseWeather(const json& aParams)
{
    p::RequireOnly(aParams, {"name", "blend_s", "cycle"});
    WeatherRequest request;
    if (const auto name = p::CheckText(aParams, "name", 96))
    {
        for (const char c : *name)
        {
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-'))
            {
                p::CheckFail("'name' must be a weather state's name, such as 24h_weather_rain (world_state lists them)");
            }
        }
        request.name = *name;
    }
    request.blend = p::CheckNumber(aParams, "blend_s", 0.0, 60.0).value_or(2.0);
    request.cycle = p::CheckBoolean(aParams, "cycle").value_or(false);
    if (request.name.empty() && !request.cycle)
    {
        p::CheckFail("give name (a weather state to hold) or cycle: true (give the weather back to the game's own cycle)");
    }
    return request;
}

json WeatherUndo(const json& aStep)
{
    const auto before = aStep.value("before", std::string());
    json params{{"cycle", true}, {"blend_s", 2.0}};
    if (!before.empty() && before != "None")
    {
        params["name"] = before;
    }
    return json{{"method", "world.weather.set"}, {"params", params}};
}

PhotoSceneRequest ParsePhotoScene(const json& aParams)
{
    p::RequireOnly(aParams, {"npcs", "weather", "game_speed"});
    PhotoSceneRequest request;
    const auto row = [&](const char* aKey, int32_t aAttribute) {
        const auto it = aParams.find(aKey);
        if (it == aParams.end() || it->is_null())
        {
            return;
        }
        PhotoSceneRow out;
        out.key = aAttribute;
        if (it->is_number())
        {
            out.value = it->get<double>();
        }
        else if (it->is_string() && !it->get<std::string>().empty() && it->get<std::string>().size() <= 64)
        {
            out.label = it->get<std::string>();
        }
        else if (it->is_object())
        {
            p::RequireOnly(*it, {"value", "label"});
            if (const auto value = p::CheckNumber(*it, "value", -1000.0, 1000.0))
            {
                out.value = *value;
            }
            if (const auto label = p::CheckText(*it, "label", 64))
            {
                out.label = *label;
            }
            if (!out.value && out.label.empty())
            {
                p::CheckFail(std::string("'") + aKey + "' needs value (the option's data from photo_state) or label (its text)");
            }
        }
        else
        {
            p::CheckFail(std::string("'") + aKey + "' must be a value (the option's data from photo_state), its label, or {value | label}");
        }
        request.rows.push_back(out);
    };
    row("npcs", kPhotoNpcs);
    row("weather", kPhotoWeather);
    if (const auto speed = p::CheckNumber(aParams, "game_speed", 0.0, 1.0))
    {
        request.rows.push_back({kPhotoGameSpeed, *speed, {}});
    }
    if (request.rows.empty())
    {
        p::CheckFail("give npcs, weather or game_speed (photo_state with options lists each row's choices)");
    }
    return request;
}

json RunPhotoScene(const PhotoSceneRequest& aRequest, const PhotoSceneOps& aOps)
{
    struct Applied
    {
        int32_t key;
        double before;
        bool known;
    };
    std::vector<Applied> done;
    json applied = json::array();
    json undo = json::object();
    try
    {
        for (const auto& row : aRequest.rows)
        {
            double value = row.value.value_or(0.0);
            json resolved = nullptr;
            if (!row.value)
            {
                resolved = aOps.resolve(row);
                value = resolved.value("value", 0.0);
            }
            auto set = aOps.set(row.key, value);
            if (!resolved.is_null())
            {
                set["matched_by"] = resolved.value("matched_by", std::string());
            }
            applied.push_back(set);
            const bool known = set.value("before_known", true);
            done.push_back({row.key, set.value("before", row.key == kPhotoGameSpeed ? 1.0 : 0.0), known});
            const char* name = row.key == kPhotoNpcs ? "npcs" : row.key == kPhotoWeather ? "weather" : "game_speed";
            if (known)
            {
                undo[name] = row.key == kPhotoGameSpeed ? json(set.value("before", 1.0)) : json{{"value", set.value("before", 0.0)}};
            }
        }
    }
    catch (const std::exception& e)
    {
        // RB-111: a later row failed; put the rows already set back, newest first, and say so in the refusal.
        std::string code = "internal";
        if (const auto* method = dynamic_cast<const MethodError*>(&e))
        {
            code = method->code;
        }
        std::string putBack, notBack;
        for (auto it = done.rbegin(); it != done.rend(); ++it)
        {
            const auto name = std::to_string(it->key);
            if (!it->known)
            {
                notBack += (notBack.empty() ? "" : ", ") + name + " (its earlier value wasn't reported)";
                continue;
            }
            try
            {
                aOps.set(it->key, it->before);
                putBack += (putBack.empty() ? "" : ", ") + name;
            }
            catch (const std::exception& back)
            {
                notBack += (notBack.empty() ? "" : ", ") + name + " (" + back.what() + ")";
            }
        }
        std::string message = e.what();
        if (!putBack.empty())
        {
            message += "; the rows already set were put back (menu keys " + putBack + ")";
        }
        if (!notBack.empty())
        {
            message += "; not put back: " + notBack;
        }
        throw MethodError(code, message);
    }
    return json{{"applied", applied},
                {"undo", undo.empty() ? json(nullptr) : json{{"method", "photo.scene.set"}, {"params", undo}}},
                {"undo_note", "the result's undo sets the rows back; closing photo mode drops them too"}};
}

json RunSaves(const SavesRequest& aRequest, const SavesOps& aOps)
{
    aOps.request();
    json answer;
    std::exception_ptr failure;
    try
    {
        const auto deadline = aOps.now() + std::chrono::milliseconds(aRequest.waitMs);
        size_t lastCount = 0;
        int stable = 0;
        while (aOps.now() < deadline)
        {
            aOps.sleep(std::chrono::milliseconds(200));
            answer = aOps.read(false);
            const auto count = answer.value("metadata", json::array()).size();
            const auto names = answer.value("names", json::array()).size();
            stable = count == lastCount ? stable + 1 : 0;
            lastCount = count;
            if (answer.value("ready", false) && (count >= names || stable >= 3))
            {
                break;
            }
        }
    }
    catch (...)
    {
        failure = std::current_exception();
    }
    // Always the final step: it stops collecting and lets go of the load menu's callbacks, whatever happened above.
    try
    {
        auto last = aOps.read(true);
        if (!failure)
        {
            answer = std::move(last);
        }
    }
    catch (...)
    {
        if (!failure)
        {
            failure = std::current_exception();
        }
    }
    if (failure)
    {
        std::rethrow_exception(failure);
    }
    return TrimSaves(answer, aRequest.limit);
}

SavesRequest ParseSaves(const json& aParams)
{
    p::RequireOnly(aParams, {"limit", "wait_ms"});
    SavesRequest request;
    request.limit = static_cast<int32_t>(p::CheckInteger(aParams, "limit", 1, 200).value_or(20));
    request.waitMs = static_cast<int32_t>(p::CheckInteger(aParams, "wait_ms", 500, 10000).value_or(3000));
    return request;
}

json TrimSaves(const json& aAnswer, int32_t aLimit)
{
    auto metadata = aAnswer.value("metadata", json::array());
    std::vector<json> list(metadata.begin(), metadata.end());
    std::stable_sort(list.begin(), list.end(), [](const json& a, const json& b) { return a.value("timestamp", 0.0) > b.value("timestamp", 0.0); });
    json saves = json::array();
    for (const auto& entry : list)
    {
        if (static_cast<int32_t>(saves.size()) >= aLimit)
        {
            break;
        }
        saves.push_back(entry);
    }
    const auto names = aAnswer.value("names", json::array());
    return json{{"ready", aAnswer.value("ready", false)},
                {"count", names.size()},
                {"with_metadata", metadata.size()},
                {"saves", saves},
                {"names", names},
                {"note", metadata.size() < names.size() ? "the game sends each save's details a moment after the list; wait_ms waits longer for them" : ""}};
}
} // namespace xfb::hooks
