#include "core/Scene.hpp"

#include <algorithm>

#include "core/Params.hpp"

namespace xfb::scene
{
using json = nlohmann::json;

const std::vector<std::string>& Parts()
{
    static const std::vector<std::string> parts{"camera", "v", "npcs", "showroom", "lights", "world", "ui"};
    return parts;
}

ReadRequest ParseRead(const json& aParams)
{
    params::RequireOnly(aParams, {"parts", "radius", "max_npcs", "occlusion", "points", "piece_eyes"});
    ReadRequest request;
    if (const auto it = aParams.find("parts"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > Parts().size())
        {
            params::CheckFail("'parts' must be a list of camera, v, npcs, showroom, lights, world and ui");
        }
        for (const auto& part : *it)
        {
            if (!part.is_string() || std::find(Parts().begin(), Parts().end(), part.get<std::string>()) == Parts().end())
            {
                params::CheckFail("each of 'parts' must be camera, v, npcs, showroom, lights, world or ui");
            }
            if (std::find(request.parts.begin(), request.parts.end(), part.get<std::string>()) == request.parts.end())
            {
                request.parts.push_back(part.get<std::string>());
            }
        }
    }
    request.radius = static_cast<float>(params::CheckNumber(aParams, "radius", 0.0, 60.0).value_or(20.0));
    request.maxNpcs = static_cast<int32_t>(params::CheckInteger(aParams, "max_npcs", 0, 32).value_or(8));
    request.occlusion = params::CheckBoolean(aParams, "occlusion").value_or(true);
    if (const auto it = aParams.find("points"); it != aParams.end() && !it->is_null())
    {
        if (!it->is_array() || it->size() > 32)
        {
            params::CheckFail("'points' must be a list of at most 32 world points [x, y, z]");
        }
        for (const auto& point : *it)
        {
            const auto value = params::CheckPoint(json{{"point", point}}, "point");
            request.points.push_back(*value);
        }
    }
    if (const auto eyes = params::CheckPoint(aParams, "piece_eyes", 3.0))
    {
        request.pieceEyes = *eyes;
    }
    return request;
}

std::string PartsText(const ReadRequest& aRequest)
{
    std::string out;
    for (const auto& part : aRequest.parts)
    {
        out += (out.empty() ? "" : ",") + part;
    }
    return out;
}
} // namespace xfb::scene
