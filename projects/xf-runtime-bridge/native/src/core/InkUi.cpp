// TEMPORARY TEST FEATURE (bridge 0.5.3): the ink UI demos' game-independent parts (core/InkUi.hpp).

#include "core/InkUi.hpp"

#include <cmath>
#include <cstdio>
#include <sstream>

#include "core/Dispatcher.hpp"
#include "core/Messages.hpp"

namespace xfb::inkui
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

bool Has(const json& aParams, const char* aKey)
{
    const auto it = aParams.find(aKey);
    return it != aParams.end() && !it->is_null();
}

double Number(const json& aParams, const char* aKey, double aMin, double aMax)
{
    const auto& value = aParams.at(aKey);
    if (!value.is_number())
    {
        Bad(std::string("'") + aKey + "' must be a number");
    }
    const double number = value.get<double>();
    if (!std::isfinite(number) || number < aMin || number > aMax)
    {
        char range[96];
        std::snprintf(range, sizeof(range), "%g to %g", aMin, aMax);
        Bad(std::string("'") + aKey + "' must be between " + range);
    }
    return number;
}

bool Boolean(const json& aParams, const char* aKey)
{
    const auto& value = aParams.at(aKey);
    if (!value.is_boolean())
    {
        Bad(std::string("'") + aKey + "' must be true or false");
    }
    return value.get<bool>();
}

std::string Word(const json& aParams, const char* aKey, size_t aMax)
{
    const auto& value = aParams.at(aKey);
    if (!value.is_string() || value.get<std::string>().empty() || value.get<std::string>().size() > aMax)
    {
        Bad(std::string("'") + aKey + "' must be a short word");
    }
    return value.get<std::string>();
}

std::string Num(double aValue)
{
    char text[48];
    std::snprintf(text, sizeof(text), "%.6g", aValue);
    return text;
}

const std::vector<std::string>& Anchors()
{
    static const std::vector<std::string> anchors{"top_left", "top_right", "bottom_left", "bottom_right", "top_center", "center_left", "center_right"};
    return anchors;
}

const std::vector<std::string>& Variants()
{
    static const std::vector<std::string> variants{"custom", "apartment", "clothes", "default"};
    return variants;
}

template<typename T>
bool Contains(const std::vector<T>& aList, const T& aValue)
{
    for (const auto& item : aList)
    {
        if (item == aValue)
        {
            return true;
        }
    }
    return false;
}

std::string Joined(const std::vector<std::string>& aList)
{
    std::string out;
    for (const auto& item : aList)
    {
        out += (out.empty() ? "" : ", ") + item;
    }
    return out;
}
} // namespace

json ToJson(const HudSettings& aSettings)
{
    return json{{"show", aSettings.show},   {"anchor", aSettings.anchor}, {"x", aSettings.x},
                {"y", aSettings.y},         {"scale", aSettings.scale},   {"layer", aSettings.layer},
                {"nameplates", aSettings.nameplates}, {"cet_label", aSettings.cetLabel}};
}

bool AnchorOk(const std::string& aAnchor)
{
    return Contains(Anchors(), aAnchor);
}

bool LayerOk(const std::string& aLayer)
{
    return aLayer == "hud" || aLayer == "notifications" || aLayer == "top";
}

HudSettings ApplyHudParams(const HudSettings& aCurrent, const HudSettings& aDefaults, const json& aParams)
{
    RequireOnly(aParams, {"show", "anchor", "x", "y", "scale", "layer", "nameplates", "cet_label", "reset"}, "ui.hud");
    if (Has(aParams, "reset") && Boolean(aParams, "reset"))
    {
        if (aParams.size() > 1)
        {
            Bad("reset: true goes back to the configured panel and can't be combined with other values");
        }
        return aDefaults;
    }
    HudSettings next = aCurrent;
    if (Has(aParams, "show"))
    {
        next.show = Boolean(aParams, "show");
    }
    if (Has(aParams, "anchor"))
    {
        next.anchor = Word(aParams, "anchor", 16);
        if (!AnchorOk(next.anchor))
        {
            Bad("'anchor' must be one of " + Joined(Anchors()));
        }
    }
    if (Has(aParams, "x"))
    {
        next.x = Number(aParams, "x", -kMaxOffset, kMaxOffset);
    }
    if (Has(aParams, "y"))
    {
        next.y = Number(aParams, "y", -kMaxOffset, kMaxOffset);
    }
    if (Has(aParams, "scale"))
    {
        next.scale = Number(aParams, "scale", kMinScale, kMaxScale);
    }
    if (Has(aParams, "layer"))
    {
        next.layer = Word(aParams, "layer", 16);
        if (!LayerOk(next.layer))
        {
            Bad("'layer' must be hud, notifications or top");
        }
    }
    if (Has(aParams, "nameplates"))
    {
        next.nameplates = Boolean(aParams, "nameplates");
    }
    if (Has(aParams, "cet_label"))
    {
        next.cetLabel = Boolean(aParams, "cet_label");
    }
    return next;
}

Status Summarize(const BridgeView& aView)
{
    if (!aView.pluginEnabled)
    {
        return {"off", "Off: the bridge is switched off in its settings"};
    }
    if (aView.killed)
    {
        return {"killed", "Stopped by the kill switch. Reconnect in the XF panel or restart the game."};
    }
    if (!aView.listening)
    {
        return {"idle", "Not listening yet"};
    }
    const std::string client = aView.hasClient ? "XF Studio connected" : "Waiting for XF Studio";
    if (!aView.allowWrites)
    {
        return {"ok", client + " · read-only"};
    }
    if (aView.writesPaused)
    {
        return {"paused", client + " · changes paused"};
    }
    return {"write", client + " · changes allowed"};
}

std::string CleanField(const std::string& aText)
{
    std::string out = aText;
    for (auto& c : out)
    {
        if (c == '\t' || c == '\n' || c == '\r')
        {
            c = ' ';
        }
    }
    return out;
}

std::string Frame(const HudSettings& aSettings, const BridgeView& aView, const std::vector<MessageLine>& aMessages)
{
    const auto status = Summarize(aView);
    const bool show = aSettings.show && aView.pluginEnabled;
    std::string out = "xfhud\t" + std::to_string(kFrameVersion) + "\n";
    out += std::string("show\t") + (show ? "1" : "0") + "\n";
    out += "layer\t" + aSettings.layer + "\n";
    out += "anchor\t" + aSettings.anchor + "\n";
    out += "pos\t" + Num(aSettings.x) + "\t" + Num(aSettings.y) + "\n";
    out += "scale\t" + Num(aSettings.scale) + "\n";
    out += std::string("nameplates\t") + (aSettings.nameplates && aView.pluginEnabled ? "1" : "0") + "\n";
    out += std::string("cet_label\t") + (aSettings.cetLabel ? "1" : "0") + "\n";
    out += std::string("live\t") + (aView.scriptReady ? "1" : "0") + "\n";
    out += "tone\t" + status.tone + "\n";
    out += "status\t" + CleanField(status.text) + "\n";
    if (!aView.killed)
    {
        for (const auto& message : aMessages)
        {
            out += "msg\t" + CleanField(message.level) + "\t" + CleanField(message.text) + "\n";
        }
    }
    return out;
}

json ParseFrame(const std::string& aFrame)
{
    json out = json::object();
    json messages = json::array();
    std::istringstream lines(aFrame);
    std::string line;
    while (std::getline(lines, line))
    {
        std::vector<std::string> fields;
        std::string field;
        std::istringstream parts(line);
        while (std::getline(parts, field, '\t'))
        {
            fields.push_back(field);
        }
        if (fields.empty())
        {
            continue;
        }
        const auto& key = fields[0];
        if (key == "msg" && fields.size() >= 3)
        {
            messages.push_back({{"level", fields[1]}, {"text", fields[2]}});
        }
        else if (key == "pos" && fields.size() >= 3)
        {
            out["x"] = std::stod(fields[1]);
            out["y"] = std::stod(fields[2]);
        }
        else if (key == "scale" && fields.size() >= 2)
        {
            out["scale"] = std::stod(fields[1]);
        }
        else if ((key == "show" || key == "nameplates" || key == "cet_label" || key == "live") && fields.size() >= 2)
        {
            out[key] = fields[1] == "1";
        }
        else if (key == "xfhud" && fields.size() >= 2)
        {
            out["version"] = std::stoi(fields[1]);
        }
        else if (fields.size() >= 2)
        {
            out[key] = fields[1];
        }
    }
    out["messages"] = messages;
    return out;
}

void HudPanel::SetDefaults(const HudSettings& aDefaults)
{
    std::scoped_lock _(m_mutex);
    m_defaults = aDefaults;
    m_current = aDefaults;
}

HudSettings HudPanel::Current() const
{
    std::scoped_lock _(m_mutex);
    return m_current;
}

HudSettings HudPanel::Defaults() const
{
    std::scoped_lock _(m_mutex);
    return m_defaults;
}

json HudPanel::Configure(const json& aParams)
{
    std::scoped_lock _(m_mutex);
    const auto previous = m_current;
    const auto next = ApplyHudParams(m_current, m_defaults, aParams);
    m_current = next;
    const auto before = ToJson(previous);
    const auto after = ToJson(next);
    json out{{"settings", after}, {"previous", before}, {"changed", before != after}};
    out["undo"] = before != after ? json{{"method", "ui.hud"}, {"params", before}} : json(nullptr);
    return out;
}

PinRequest ParsePin(const json& aParams)
{
    RequireOnly(aParams, {"position", "piece", "at", "label", "variant", "lift_m"}, "world.pin");
    PinRequest request;
    const int targets = (Has(aParams, "position") ? 1 : 0) + (Has(aParams, "piece") ? 1 : 0) + (Has(aParams, "at") ? 1 : 0);
    if (targets != 1)
    {
        Bad("give exactly one of position [x, y, z], piece (a showroom head's index) or at: \"v\"");
    }
    if (Has(aParams, "position"))
    {
        const auto& position = aParams.at("position");
        if (!position.is_array() || position.size() != 3)
        {
            Bad("'position' must be [x, y, z] in metres");
        }
        double values[3];
        for (size_t i = 0; i < 3; ++i)
        {
            if (!position[i].is_number() || !std::isfinite(position[i].get<double>()) || std::abs(position[i].get<double>()) > kMaxCoordinate)
            {
                Bad("'position' must be three numbers within " + Num(kMaxCoordinate) + " m of the world's origin");
            }
            values[i] = position[i].get<double>();
        }
        request.target = PinRequest::Target::Position;
        request.x = values[0];
        request.y = values[1];
        request.z = values[2];
    }
    else if (Has(aParams, "piece"))
    {
        const auto& piece = aParams.at("piece");
        if (!piece.is_number_integer() || piece.get<int64_t>() < 0 || piece.get<int64_t>() > 23)
        {
            Bad("'piece' must be a showroom head's index, 0 to 23");
        }
        request.target = PinRequest::Target::Piece;
        request.piece = static_cast<int32_t>(piece.get<int64_t>());
        request.lift = 0.45;
    }
    else
    {
        if (!aParams.at("at").is_string() || aParams.at("at").get<std::string>() != "v")
        {
            Bad("'at' must be \"v\"");
        }
        request.target = PinRequest::Target::V;
        request.lift = 0.45;
    }
    if (!Has(aParams, "label") || !aParams.at("label").is_string())
    {
        Bad("'label' is required: the pin's name, 1 to " + std::to_string(kMaxLabelChars) + " characters");
    }
    const auto& raw = aParams.at("label").get_ref<const std::string&>();
    if (raw.size() > 400)
    {
        Bad("'label' is too long");
    }
    request.label = CleanMessageText(raw, kMaxLabelChars);
    if (request.label.empty())
    {
        Bad("'label' has nothing to show (only spaces or control characters)");
    }
    if (Has(aParams, "variant"))
    {
        request.variant = Word(aParams, "variant", 16);
        if (!VariantOk(request.variant))
        {
            Bad("'variant' must be one of " + Joined(Variants()));
        }
    }
    if (Has(aParams, "lift_m"))
    {
        request.lift = Number(aParams, "lift_m", -kMaxLift, kMaxLift);
    }
    return request;
}

bool VariantOk(const std::string& aVariant)
{
    return Contains(Variants(), aVariant);
}

const char* TargetName(PinRequest::Target aTarget)
{
    switch (aTarget)
    {
    case PinRequest::Target::Piece:
        return "piece";
    case PinRequest::Target::V:
        return "v";
    default:
        return "position";
    }
}

int64_t ParsePinClear(const json& aParams)
{
    RequireOnly(aParams, {"id"}, "world.pin.clear");
    if (!Has(aParams, "id"))
    {
        return -1;
    }
    const auto& id = aParams.at("id");
    if (!id.is_number_integer() || id.get<int64_t>() < 1 || id.get<int64_t>() > 1000000)
    {
        Bad("'id' must be a pin's id from world.pin's answer");
    }
    return id.get<int64_t>();
}
} // namespace xfb::inkui
