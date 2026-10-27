#include "core/Config.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <fstream>
#include <sstream>

#include "core/Win32.hpp"

namespace xfb
{
namespace
{
std::string Trim(std::string aText)
{
    const auto notSpace = [](unsigned char c) { return c != ' ' && c != '\t' && c != '\r' && c != '\n'; };
    aText.erase(aText.begin(), std::find_if(aText.begin(), aText.end(), notSpace));
    aText.erase(std::find_if(aText.rbegin(), aText.rend(), notSpace).base(), aText.end());
    return aText;
}

std::string Lower(std::string aText)
{
    std::transform(aText.begin(), aText.end(), aText.begin(),
                   [](unsigned char c) { return static_cast<char>(c >= 'A' && c <= 'Z' ? c + 32 : c); });
    return aText;
}

bool ParseBool(const std::string& aValue, bool& aOut)
{
    const auto value = Lower(aValue);
    if (value == "true" || value == "1" || value == "yes" || value == "on")
    {
        aOut = true;
        return true;
    }
    if (value == "false" || value == "0" || value == "no" || value == "off")
    {
        aOut = false;
        return true;
    }
    return false;
}

bool ParseU32(const std::string& aValue, uint32_t aMin, uint32_t aMax, uint32_t& aOut)
{
    uint32_t value = 0;
    const auto* begin = aValue.data();
    const auto* end = aValue.data() + aValue.size();
    const auto [ptr, ec] = std::from_chars(begin, end, value);
    if (ec != std::errc() || ptr != end || value < aMin || value > aMax)
    {
        return false;
    }
    aOut = value;
    return true;
}
// "IK_F6, IK_F7": 1 to 4 EInputKey names (IK_ then letters and digits); anything else keeps the default.
bool ParseKeyList(const std::string& aValue, std::vector<std::string>& aOut)
{
    std::vector<std::string> keys;
    std::string current;
    const auto take = [&]() {
        auto key = Trim(current);
        current.clear();
        if (key.empty())
        {
            return true;
        }
        if (key.size() < 4 || key.size() > 24 || key.rfind("IK_", 0) != 0)
        {
            return false;
        }
        for (const char c : key)
        {
            if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'))
            {
                return false;
            }
        }
        keys.push_back(key);
        return true;
    };
    for (const char c : aValue)
    {
        if (c == ',')
        {
            if (!take())
            {
                return false;
            }
        }
        else
        {
            current.push_back(c);
        }
    }
    if (!take() || keys.empty() || keys.size() > 4)
    {
        return false;
    }
    aOut = keys;
    return true;
}
} // namespace

Config ParseConfig(const std::string& aText)
{
    Config config;
    std::istringstream stream(aText);
    std::string line;
    std::string section;
    int lineNumber = 0;

    while (std::getline(stream, line))
    {
        ++lineNumber;
        line = Trim(line);
        if (line.empty() || line[0] == ';' || line[0] == '#')
        {
            continue;
        }
        if (line.front() == '[' && line.back() == ']')
        {
            section = Lower(Trim(line.substr(1, line.size() - 2)));
            continue;
        }
        const auto equals = line.find('=');
        if (equals == std::string::npos)
        {
            config.warnings.push_back("line " + std::to_string(lineNumber) + ": expected key = value");
            continue;
        }
        const auto key = section + "." + Lower(Trim(line.substr(0, equals)));
        auto value = Trim(line.substr(equals + 1));
        const auto comment = value.find_first_of(";#");
        if (comment != std::string::npos)
        {
            value = Trim(value.substr(0, comment));
        }

        bool ok = true;
        if (key == "bridge.enabled")
        {
            ok = ParseBool(value, config.bridgeEnabled);
        }
        else if (key == "bridge.allow_writes")
        {
            ok = ParseBool(value, config.allowWrites);
        }
        else if (key == "bridge.allow_creator_leave")
        {
            ok = ParseBool(value, config.allowCreatorLeave);
        }
        else if (key == "bridge.allow_live_pose")
        {
            ok = ParseBool(value, config.allowLivePose);
        }
        else if (key == "bridge.allow_test_hooks")
        {
            ok = ParseBool(value, config.allowTestHooks);
        }
        else if (key == "bridge.allow_write_classes")
        {
            // A comma-separated list; an unknown name is ignored with a warning, so a typo can
            // only take a class away, never add one. An empty value allows none.
            config.writeClasses = 0;
            std::string rest = value;
            while (!rest.empty())
            {
                const auto comma = rest.find(',');
                const auto name = Lower(Trim(rest.substr(0, comma)));
                rest = comma == std::string::npos ? std::string() : rest.substr(comma + 1);
                if (name == "photo")
                {
                    config.writeClasses |= kWritePhoto;
                }
                else if (name == "world")
                {
                    config.writeClasses |= kWriteWorld;
                }
                else if (name == "character")
                {
                    config.writeClasses |= kWriteCharacter;
                }
                else if (name == "inventory")
                {
                    config.writeClasses |= kWriteInventory;
                }
                else if (name == "save")
                {
                    config.writeClasses |= kWriteSave;
                }
                else if (name == "showroom")
                {
                    config.writeClasses |= kWriteShowroom;
                }
                else if (name == "player")
                {
                    config.writeClasses |= kWritePlayer;
                }
                else if (name == "act")
                {
                    config.writeClasses |= kActPlayer;
                }
                else if (name == "npc")
                {
                    config.writeClasses |= kWriteNpc;
                }
                else if (name == "dm")
                {
                    config.writeClasses |= kWriteDm;
                }
                else if (!name.empty())
                {
                    config.warnings.push_back("line " + std::to_string(lineNumber) + ": unknown write class '" +
                                              name.substr(0, 32) + "' ignored (photo, world, character, inventory, save, showroom, player, act, npc, dm)");
                }
            }
        }
        else if (key == "bridge.request_timeout_ms")
        {
            ok = ParseU32(value, 100, 30000, config.requestTimeoutMs);
        }
        else if (key == "bridge.max_requests_per_second")
        {
            ok = ParseU32(value, 1, 200, config.maxRequestsPerSecond);
        }
        else if (key == "bridge.max_read_only_connections")
        {
            ok = ParseU32(value, 0, 8, config.maxReadOnlyConnections);
        }
        else if (key == "bridge.idle_disconnect_seconds")
        {
            ok = ParseU32(value, 5, 3600, config.idleDisconnectSeconds);
        }
        else if (key == "ui.hud_panel")
        {
            ok = ParseBool(value, config.hudPanel);
        }
        else if (key == "ui.layer")
        {
            ok = value == "photo_menu" || value == "hud" || value == "notifications" || value == "top";
            if (ok)
            {
                config.hudLayer = value;
            }
        }
        else if (key == "ui.cet_label")
        {
            ok = ParseBool(value, config.cetLabel);
        }
        else if (key == "ui.nameplates")
        {
            ok = ParseBool(value, config.nameplates);
        }
        else if (key == "ui.answer_keys")
        {
            ok = ParseKeyList(value, config.answerKeys);
        }
        else if (key == "ui.kill_key")
        {
            std::string why;
            killkey::Chord chord;
            ok = killkey::Parse(value, chord, why);
            if (ok)
            {
                config.killKey = chord;
                if (chord.enabled && killkey::GameBinds(chord.vk))
                {
                    config.warnings.push_back("line " + std::to_string(lineNumber) + ": the stop key " + chord.label +
                                              " is also one of the game's own keys, so pressing it does that too; the default, Ctrl + Shift + End, is free");
                }
            }
            else
            {
                config.warnings.push_back("line " + std::to_string(lineNumber) + ": kill_key: " + why + "; the default (" + killkey::kDefault + ") stays");
                ok = true; // the warning says it; no second "bad value" line
            }
        }
        else if (key == "ui.question_sound")
        {
            // 0.8.5: true (the default sound), false, or a sound event's name (lower case letters, digits and _).
            bool on = false;
            if (ParseBool(value, on))
            {
                config.questionSound = on ? kQuestionSoundDefault : "";
            }
            else
            {
                ok = !value.empty() && value.size() <= 64 && std::isalpha(static_cast<unsigned char>(value[0])) &&
                     std::all_of(value.begin(), value.end(), [](unsigned char c) { return std::islower(c) || std::isdigit(c) || c == '_'; });
                if (ok)
                {
                    config.questionSound = value;
                }
            }
        }
        else if (key == "overlay.enabled")
        {
            ok = ParseBool(value, config.overlayEnabled);
        }
        else if (key == "overlay.canvas") { ok = ParseBool(value, config.canvasEnabled); }
        else if (key == "overlay.canvas_anchor_hz") { ok = ParseU32(value, 1, 20, config.canvasAnchorHz); }
        else if (key == "overlay.canvas_anchors_per_read") { ok = ParseU32(value, 4, 32, config.canvasAnchorsPerRead); }
        else if (key == "overlay.canvas_toggle" || key == "overlay.canvas_mode") {
            killkey::Chord chord; std::string why;
            ok = killkey::Parse(value, chord, why) && (!chord.enabled || (!chord.ctrl && !chord.shift && !chord.alt));
            if (ok) (key == "overlay.canvas_toggle" ? config.canvasToggle : config.canvasMode) = chord;
        }
        else if (key == "overlay.theme")
        {
            const auto theme = Lower(value);
            ok = theme == "dark" || theme == "light";
            if (ok)
            {
                config.overlayTheme = theme;
            }
        }
        else if (key == "overlay.scale_percent")
        {
            ok = ParseU32(value, 50, 300, config.overlayScalePercent);
        }
        else if (key == "overlay.diagnostics")
        {
            ok = ParseBool(value, config.overlayDiagnostics);
        }
        else if (key == "overlay.motion")
        {
            const auto motion = Lower(value);
            ok = motion == "auto" || motion == "reduced" || motion == "full";
            if (ok)
            {
                config.overlayMotion = motion;
            }
        }
        else if (key == "log.level")
        {
            ok = ParseLevel(Lower(value), config.logLevel);
        }
        else if (key == "capture.root")
        {
            config.captureRoot = win32::Widen(value);
            ok = value.empty() || config.captureRoot.is_absolute();
            if (!ok)
            {
                config.captureRoot.clear();
            }
        }
        else
        {
            config.warnings.push_back("line " + std::to_string(lineNumber) + ": unknown key '" + key + "'");
            continue;
        }
        if (!ok)
        {
            config.warnings.push_back("line " + std::to_string(lineNumber) + ": invalid value for '" + key +
                                      "', default kept");
        }
    }
    if (config.canvasToggle.enabled && config.canvasMode.enabled && config.canvasToggle.vk == config.canvasMode.vk) {
        config.canvasMode.enabled = false;
        config.warnings.push_back("canvas_mode disabled: it used the same key as canvas_toggle");
    }
    return config;
}

Config LoadConfig(const std::filesystem::path& aPath)
{
    std::ifstream file(aPath, std::ios::binary);
    if (!file)
    {
        Config config;
        config.sourcePath = aPath;
        return config;
    }
    std::ostringstream buffer;
    buffer << file.rdbuf();
    auto config = ParseConfig(buffer.str());
    config.sourcePath = aPath;
    config.fileFound = true;
    return config;
}

std::string DescribeConfig(const Config& aConfig)
{
    std::string text;
    text += "file_found=" + std::string(aConfig.fileFound ? "true" : "false");
    text += " bridge.enabled=" + std::string(aConfig.bridgeEnabled ? "true" : "false");
    text += " bridge.allow_writes=" + std::string(aConfig.allowWrites ? "true" : "false");
    std::string classes;
    for (const auto& name : WriteClassList(aConfig))
    {
        classes += (classes.empty() ? "" : ",") + name;
    }
    text += " bridge.allow_write_classes=" + (classes.empty() ? std::string("<none>") : classes);
    text += " bridge.allow_creator_leave=" + std::string(aConfig.allowCreatorLeave ? "true" : "false");
    text += " bridge.allow_live_pose=" + std::string(aConfig.allowLivePose ? "true" : "false");
    text += " bridge.allow_test_hooks=" + std::string(aConfig.allowTestHooks ? "true" : "false");
    text += " bridge.request_timeout_ms=" + std::to_string(aConfig.requestTimeoutMs);
    text += " bridge.max_requests_per_second=" + std::to_string(aConfig.maxRequestsPerSecond);
    text += " bridge.max_read_only_connections=" + std::to_string(aConfig.maxReadOnlyConnections);
    text += " bridge.idle_disconnect_seconds=" + std::to_string(aConfig.idleDisconnectSeconds);
    text += " ui.hud_panel=" + std::string(aConfig.hudPanel ? "true" : "false");
    text += " ui.layer=" + aConfig.hudLayer;
    text += " ui.cet_label=" + std::string(aConfig.cetLabel ? "true" : "false");
    text += " ui.nameplates=" + std::string(aConfig.nameplates ? "true" : "false");
    std::string keys;
    for (const auto& key : aConfig.answerKeys)
    {
        keys += (keys.empty() ? "" : ",") + key;
    }
    text += " ui.answer_keys=" + keys;
    // 0.8.3: no spaces in the log line's value ("Ctrl+End").
    std::string killKey = aConfig.killKey.enabled ? aConfig.killKey.label : std::string("off");
    killKey.erase(std::remove(killKey.begin(), killKey.end(), ' '), killKey.end());
    text += " ui.kill_key=" + killKey;
    text += " ui.question_sound=" + (aConfig.questionSound.empty() ? std::string("off") : aConfig.questionSound);
    text += " overlay.enabled=" + std::string(aConfig.overlayEnabled ? "true" : "false") + " overlay.theme=" + aConfig.overlayTheme +
            " overlay.scale_percent=" + std::to_string(aConfig.overlayScalePercent) + " overlay.diagnostics=" + (aConfig.overlayDiagnostics ? "true" : "false") + " overlay.motion=" + aConfig.overlayMotion;
    text += " log.level=" + std::string(LevelName(aConfig.logLevel));
    text += " capture.root=" + (aConfig.captureRoot.empty() ? std::string("<default>") : std::string("<custom>"));
    return text;
}
std::vector<std::string> WriteClassList(const Config& aConfig)
{
    std::vector<std::string> out;
    if (aConfig.writeClasses & kWritePhoto)
    {
        out.emplace_back("photo");
    }
    if (aConfig.writeClasses & kWriteWorld)
    {
        out.emplace_back("world");
    }
    if (aConfig.writeClasses & kWriteCharacter)
    {
        out.emplace_back("character");
    }
    if (aConfig.writeClasses & kWriteInventory)
    {
        out.emplace_back("inventory");
    }
    if (aConfig.writeClasses & kWriteSave)
    {
        out.emplace_back("save");
    }
    if (aConfig.writeClasses & kWriteShowroom)
    {
        out.emplace_back("showroom");
    }
    if (aConfig.writeClasses & kWritePlayer)
    {
        out.emplace_back("player");
    }
    if (aConfig.writeClasses & kActPlayer)
    {
        out.emplace_back("act");
    }
    if (aConfig.writeClasses & kWriteNpc)
    {
        out.emplace_back("npc");
    }
    if (aConfig.writeClasses & kWriteDm)
    {
        out.emplace_back("dm");
    }
    return out;
}
} // namespace xfb
