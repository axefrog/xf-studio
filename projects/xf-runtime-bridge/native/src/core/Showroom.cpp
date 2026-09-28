#include "core/Showroom.hpp"

#include <cctype>
#include <cmath>

#include "core/Dispatcher.hpp"

namespace xfb::showroom
{
namespace
{
[[noreturn]] void Bad(const std::string& aMessage)
{
    throw MethodError("bad_params", aMessage);
}

void RequireOnly(const json& aParams, std::initializer_list<const char*> aKnown, const std::string& aWhere)
{
    if (!aParams.is_object())
    {
        Bad(aWhere + " must be an object");
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
            Bad("unknown parameter '" + name.substr(0, 64) + "' in " + aWhere);
        }
    }
}

double Number(const json& aObject, const char* aKey, double aMin, double aMax, const std::string& aWhere)
{
    const auto it = aObject.find(aKey);
    if (it == aObject.end() || !it->is_number())
    {
        Bad(std::string("'") + aKey + "' is required in " + aWhere + " and must be a number");
    }
    const double value = it->get<double>();
    if (!std::isfinite(value) || value < aMin || value > aMax)
    {
        Bad(std::string("'") + aKey + "' in " + aWhere + " is out of range");
    }
    return value;
}

int32_t Index(const json& aObject, int32_t aMin, const std::string& aWhere)
{
    const auto it = aObject.find("index");
    if (it == aObject.end() || !it->is_number_integer())
    {
        Bad("'index' is required in " + aWhere + " and must be a whole number");
    }
    const auto value = it->get<int64_t>();
    if (value < aMin || value >= static_cast<int64_t>(kMaxPieces))
    {
        Bad("'index' in " + aWhere + " must be between " + std::to_string(aMin) + " and " + std::to_string(kMaxPieces - 1));
    }
    return static_cast<int32_t>(value);
}

std::string Text(const json& aObject, const char* aKey, size_t aMax, bool aRequired, const std::string& aWhere)
{
    const auto it = aObject.find(aKey);
    if (it == aObject.end() || it->is_null())
    {
        if (aRequired)
        {
            Bad(std::string("'") + aKey + "' is required in " + aWhere);
        }
        return {};
    }
    if (!it->is_string())
    {
        Bad(std::string("'") + aKey + "' in " + aWhere + " must be text");
    }
    auto value = it->get<std::string>();
    if ((aRequired && value.empty()) || value.size() > aMax)
    {
        Bad(std::string("'") + aKey + "' in " + aWhere + " must be 1 to " + std::to_string(aMax) + " characters");
    }
    for (const auto c : value)
    {
        if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f)
        {
            Bad(std::string("'") + aKey + "' in " + aWhere + " contains control characters");
        }
    }
    return value;
}

bool Hex32(const std::string& aText, size_t aFrom)
{
    if (aText.size() < aFrom + 32)
    {
        return false;
    }
    for (size_t i = aFrom; i < aFrom + 32; ++i)
    {
        const auto c = aText[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
        {
            return false;
        }
    }
    return true;
}
} // namespace

const char* KindName(Kind aKind)
{
    return aKind == Kind::Piece ? "pieces" : "lights";
}

bool TemplateOk(Kind aKind, const std::string& aPath)
{
    static const std::string prefix = "axefrog\\appearance_studio\\collections\\";
    const std::string leaf = aKind == Kind::Piece ? "\\showroom\\xfs_showroom.ent" : "\\showroom\\xfs_showroom_rig.ent";
    return aPath.size() == prefix.size() + 32 + leaf.size() && aPath.compare(0, prefix.size(), prefix) == 0 && Hex32(aPath, prefix.size()) &&
           aPath.compare(prefix.size() + 32, leaf.size(), leaf) == 0;
}

bool AppearanceOk(Kind aKind, const std::string& aName)
{
    if (aKind == Kind::Piece)
    {
        return aName.size() == 5 + 32 && aName.compare(0, 5, "xfs_p") == 0 && Hex32(aName, 5);
    }
    return aName == "xfs_rig_creator" || aName == "xfs_rig_creator_face" || aName == "xfs_rig_key";
}

PlaceRequest ParsePlace(const json& aParams, Kind aKind)
{
    RequireOnly(aParams, {"items", "replace"}, "the parameters");
    PlaceRequest request;
    request.kind = aKind;
    const auto items = aParams.find("items");
    const size_t limit = aKind == Kind::Piece ? kMaxPieces : kMaxRigs;
    if (items == aParams.end() || !items->is_array() || items->empty() || items->size() > limit)
    {
        Bad("'items' must list 1 to " + std::to_string(limit) + " " + KindName(aKind));
    }
    if (const auto replace = aParams.find("replace"); replace != aParams.end() && !replace->is_null())
    {
        if (!replace->is_boolean())
        {
            Bad("'replace' must be true or false");
        }
        request.replace = replace->get<bool>();
    }
    for (size_t i = 0; i < items->size(); ++i)
    {
        const auto& item = (*items)[i];
        const auto where = "item " + std::to_string(i + 1);
        RequireOnly(item, {"index", "template", "appearance", "label", "x", "y", "z", "yaw"}, where);
        Placement placement;
        placement.index = Index(item, aKind == Kind::Piece ? 0 : -1, where);
        placement.templatePath = Text(item, "template", 200, true, where);
        if (!TemplateOk(aKind, placement.templatePath))
        {
            Bad("'template' in " + where + " is not the XF Finish Showroom's " + (aKind == Kind::Piece ? "head" : "light rig") + " entity");
        }
        placement.appearance = Text(item, "appearance", 64, true, where);
        if (!AppearanceOk(aKind, placement.appearance))
        {
            Bad("'appearance' in " + where + " is not one of the showroom's " + (aKind == Kind::Piece ? "presets (xfs_p…)" : "rigs (xfs_rig_…)"));
        }
        placement.label = Text(item, "label", 80, false, where);
        placement.x = Number(item, "x", -100000, 100000, where);
        placement.y = Number(item, "y", -100000, 100000, where);
        placement.z = Number(item, "z", -10000, 10000, where);
        placement.yaw = Number(item, "yaw", -360, 360, where);
        for (const auto& earlier : request.items)
        {
            if (aKind == Kind::Piece && earlier.index == placement.index)
            {
                Bad("piece index " + std::to_string(placement.index) + " is given twice");
            }
        }
        request.items.push_back(placement);
    }
    return request;
}

std::vector<Turn> ParseTurn(const json& aParams)
{
    RequireOnly(aParams, {"turns"}, "the parameters");
    const auto turns = aParams.find("turns");
    if (turns == aParams.end() || !turns->is_array() || turns->empty() || turns->size() > kMaxPieces)
    {
        Bad("'turns' must list 1 to " + std::to_string(kMaxPieces) + " pieces");
    }
    std::vector<Turn> out;
    for (size_t i = 0; i < turns->size(); ++i)
    {
        const auto& item = (*turns)[i];
        const auto where = "turn " + std::to_string(i + 1);
        RequireOnly(item, {"index", "yaw"}, where);
        out.push_back({Index(item, 0, where), Number(item, "yaw", -360, 360, where)});
    }
    return out;
}

std::string ParseClear(const json& aParams)
{
    RequireOnly(aParams, {"what"}, "the parameters");
    const auto what = aParams.value("what", std::string("all"));
    if (what != "all" && what != "pieces" && what != "lights")
    {
        Bad("'what' must be all, pieces or lights");
    }
    return what;
}

json Place(const PlaceRequest& aRequest, const Ops& aOps)
{
    json out{{"kind", KindName(aRequest.kind)}};
    if (aRequest.replace)
    {
        aOps.guard();
        out["cleared"] = aOps.clear(KindName(aRequest.kind));
    }
    json placed = json::array();
    for (const auto& item : aRequest.items)
    {
        aOps.guard();
        try
        {
            auto spawned = aOps.spawn(aRequest.kind, item);
            placed.push_back({{"index", item.index},
                              {"label", item.label},
                              {"appearance", item.appearance},
                              {"entity", spawned.value("entity", std::string())},
                              {"position", {item.x, item.y, item.z}},
                              {"yaw", item.yaw}});
        }
        catch (const MethodError& e)
        {
            if (placed.empty())
            {
                throw;
            }
            throw MethodError(e.code, std::string(e.what()) + " (after " + std::to_string(placed.size()) +
                                          " were placed; showroom.clear removes them)");
        }
    }
    out["placed"] = placed;
    json state;
    for (int i = 0; i < kSpawnPolls; ++i)
    {
        aOps.settle();
        state = aOps.status();
        if (state.value("pending", 0) == 0)
        {
            break;
        }
    }
    out["state"] = state;
    if (state.value("pending", 0) != 0)
    {
        out["note"] = "some entities were still spawning when the wait ended; showroom.state shows when they are in";
    }
    out["undo"] = {{"method", "showroom.clear"}, {"params", {{"what", KindName(aRequest.kind)}}}};
    return out;
}

json TurnPieces(const std::vector<Turn>& aTurns, const Ops& aOps)
{
    json turned = json::array();
    json back = json::array();
    for (const auto& turn : aTurns)
    {
        aOps.guard();
        auto result = aOps.turn(turn.index, turn.yaw);
        turned.push_back(result);
        if (result.contains("previous_yaw") && result["previous_yaw"].is_number())
        {
            back.push_back({{"index", turn.index}, {"yaw", result["previous_yaw"]}});
        }
    }
    json out{{"turned", turned}};
    out["undo"] = back.empty() ? json(nullptr) : json{{"method", "showroom.turn"}, {"params", {{"turns", back}}}};
    return out;
}

json Clear(const std::string& aWhat, const Ops& aOps)
{
    aOps.guard();
    auto out = aOps.clear(aWhat);
    out["what"] = aWhat;
    out["undo"] = nullptr;
    out["undo_note"] = "showroom.spawn and showroom.light place them again";
    return out;
}
} // namespace xfb::showroom
