#include "core/Senses.hpp"
#include "core/LayoutGuard.hpp"

#include <algorithm>
#include <set>

#include "core/Params.hpp"

namespace xfb::senses
{
namespace p = xfb::params;

bool FactNameOk(const std::string& aName)
{
    return !aName.empty() && aName.size() <= kMaxFactNameLength && std::all_of(aName.begin(), aName.end(), [](char c) {
               return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.';
           });
}

FactsRequest ParseFacts(const json& aParams)
{
    p::RequireOnly(aParams, {"facts"});
    FactsRequest request;
    const auto it = aParams.find("facts");
    if (it == aParams.end() || it->is_null())
    {
        p::CheckFail("'facts' is required: a list of 1 to 128 quest fact names");
    }
    if (!it->is_array() || it->empty() || it->size() > kMaxFacts)
    {
        p::CheckFail("'facts' must be a list of 1 to 128 quest fact names");
    }
    std::set<std::string> seen;
    for (const auto& fact : *it)
    {
        if (!fact.is_string() || !FactNameOk(fact.get<std::string>()))
        {
            p::CheckFail("each of 'facts' must be a fact name (letters, digits, _ and .; at most 96 characters)");
        }
        const auto name = fact.get<std::string>();
        if (seen.insert(name).second)
        {
            request.facts.push_back(name);
        }
    }
    return request;
}

std::string Csv(const std::vector<std::string>& aNames)
{
    std::string out;
    for (const auto& name : aNames)
    {
        out += (out.empty() ? "" : ",") + name;
    }
    return out;
}

void FinishFacts(json& aOut, size_t aRequested)
{
    size_t nonzero = 0;
    if (aOut.contains("facts") && aOut["facts"].is_object())
    {
        for (const auto& [name, value] : aOut["facts"].items())
        {
            if (value.is_number() && value.get<double>() != 0.0)
            {
                ++nonzero;
            }
        }
    }
    aOut["requested"] = aRequested;
    aOut["nonzero"] = nonzero;
    aOut["note"] = "a fact the game never set reads 0, like one set to 0; the quest system doesn't say which";
}

void ParseDistrict(const json& aParams)
{
    p::RequireOnly(aParams, {});
}

const std::vector<std::string>& StatusParts()
{
    static const std::vector<std::string> parts{"vitals", "progress", "money", "heat", "vehicle", "inventory", "scanner"};
    return parts;
}

StatusRequest ParseStatus(const json& aParams)
{
    p::RequireOnly(aParams, {"parts"});
    StatusRequest request;
    if (const auto it = aParams.find("parts"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > StatusParts().size())
        {
            p::CheckFail("'parts' must be a list of vitals, progress, money, heat, vehicle, inventory and scanner");
        }
        for (const auto& part : *it)
        {
            if (!part.is_string() || std::find(StatusParts().begin(), StatusParts().end(), part.get<std::string>()) == StatusParts().end())
            {
                p::CheckFail("each of 'parts' must be vitals, progress, money, heat, vehicle, inventory or scanner");
            }
            if (std::find(request.parts.begin(), request.parts.end(), part.get<std::string>()) == request.parts.end())
            {
                request.parts.push_back(part.get<std::string>());
            }
        }
    }
    return request;
}

std::vector<std::string> NpcRecords(const json& aNpcs)
{
    std::vector<std::string> out;
    if (!aNpcs.is_array())
    {
        return out;
    }
    for (const auto& npc : aNpcs)
    {
        const auto it = npc.find("record");
        if (it == npc.end() || !it->is_string())
        {
            continue;
        }
        const auto name = it->get<std::string>();
        if (p::CheckRecordName(name) && std::find(out.begin(), out.end(), name) == out.end())
        {
            out.push_back(name);
        }
    }
    return out;
}

void MergeNpcDetail(json& aNpcs, const json& aCharacters)
{
    if (!aNpcs.is_array())
    {
        return;
    }
    for (auto& npc : aNpcs)
    {
        const auto it = npc.find("record");
        if (it == npc.end() || !it->is_string())
        {
            npc["character"] = nullptr; // a row without a record (a vehicle's class, say) has no character
            continue;
        }
        const auto found = aCharacters.is_object() ? aCharacters.find(it->get<std::string>()) : aCharacters.end();
        npc["character"] = (aCharacters.is_object() && found != aCharacters.end()) ? *found : json(nullptr);
    }
}
} // namespace xfb::senses
