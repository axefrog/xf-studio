#include "core/Showroom.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iterator>

#include "core/Dispatcher.hpp"
#include "core/Win32.hpp"

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

std::vector<std::string> ParseAnchorArchives(const json& aParams)
{
    RequireOnly(aParams, {"archives"}, "the parameters");
    std::vector<std::string> out;
    const auto it = aParams.find("archives");
    if (it == aParams.end() || it->is_null())
    {
        return out;
    }
    if (!it->is_array() || it->size() > 16)
    {
        Bad("'archives' must be a list of at most 16 showroom archive names");
    }
    for (const auto& name : *it)
    {
        const auto text = name.is_string() ? name.get<std::string>() : std::string();
        bool ok = text.size() == 13 + 32 && text.rfind("xfs_showroom_", 0) == 0;
        for (size_t i = 13; ok && i < text.size(); ++i)
        {
            ok = (text[i] >= '0' && text[i] <= '9') || (text[i] >= 'a' && text[i] <= 'f');
        }
        if (!ok)
        {
            Bad("each of 'archives' must be a showroom archive's name (xfs_showroom_ and 32 hex digits, no extension)");
        }
        out.push_back(text);
    }
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
json StagedShowrooms(const std::filesystem::path& aModFolder)
{
    json archives = json::array();
    std::error_code ec;
    size_t seen = 0;
    bool more = false;
    if (std::filesystem::is_directory(aModFolder, ec))
    {
        std::vector<std::filesystem::path> files;
        for (std::filesystem::directory_iterator it(aModFolder, ec), end; !ec && it != end; it.increment(ec))
        {
            // Wide names: other mods' files may have names the narrow code page can't hold.
            const auto name = it->path().filename().wstring();
            if (name.size() == 13 + 32 + 8 && name.rfind(L"xfs_showroom_", 0) == 0 && name.substr(45) == L".archive" &&
                std::all_of(name.begin() + 13, name.begin() + 45, [](wchar_t c) { return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'); }))
            {
                files.push_back(it->path());
            }
        }
        std::sort(files.begin(), files.end());
        for (const auto& file : files)
        {
            if (++seen > kMaxStagedArchives)
            {
                more = true;
                break;
            }
            const auto stem = file.stem().string(); // xfs_showroom_<key>
            json entry{{"archive", stem}, {"file", file.filename().string()}};
            std::error_code sizeError;
            entry["bytes"] = static_cast<uint64_t>(std::filesystem::file_size(file, sizeError));
            std::string hex, why;
            if (win32::FileSha256(file, hex, why))
            {
                entry["sha256"] = hex;
            }
            else
            {
                entry["sha256"] = nullptr;
                entry["sha256_error"] = why;
            }
            const auto sidecar = aModFolder / (stem + kManifestSuffix);
            entry["manifest"] = nullptr;
            std::error_code sidecarError;
            if (std::filesystem::is_regular_file(sidecar, sidecarError))
            {
                entry["manifest_file"] = sidecar.filename().string();
                const auto bytes = std::filesystem::file_size(sidecar, sidecarError);
                if (sidecarError || bytes > kMaxManifestBytes)
                {
                    entry["manifest_error"] = "too large or unreadable";
                }
                else
                {
                    std::ifstream in(sidecar, std::ios::binary);
                    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
                    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF && static_cast<unsigned char>(text[1]) == 0xBB &&
                        static_cast<unsigned char>(text[2]) == 0xBF)
                    {
                        text.erase(0, 3);
                    }
                    auto manifest = json::parse(text, nullptr, false);
                    if (manifest.is_discarded() || !manifest.is_object())
                    {
                        entry["manifest_error"] = "not JSON";
                    }
                    else if (manifest.value("schema", std::string()) != "xfs/showroom-package-1" || manifest.value("archive", std::string()) != stem)
                    {
                        entry["manifest_error"] = "not this archive's showroom manifest";
                    }
                    else
                    {
                        entry["manifest"] = std::move(manifest);
                    }
                }
            }
            archives.push_back(std::move(entry));
        }
    }
    return json{{"folder", "archive/pc/mod"},
                {"found", std::filesystem::is_directory(aModFolder, ec)},
                {"archives", std::move(archives)},
                {"more", more},
                {"how", "the game's own view of its archive/pc/mod folder (MO2's virtual folder when MO2 launched the game: the staged, "
                        "enabled mods)"}};
}
} // namespace xfb::showroom
