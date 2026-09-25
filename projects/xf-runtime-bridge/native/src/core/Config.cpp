#include "core/Config.hpp"

#include <algorithm>
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
        else if (key == "bridge.request_timeout_ms")
        {
            ok = ParseU32(value, 100, 30000, config.requestTimeoutMs);
        }
        else if (key == "bridge.max_requests_per_second")
        {
            ok = ParseU32(value, 1, 200, config.maxRequestsPerSecond);
        }
        else if (key == "bridge.idle_disconnect_seconds")
        {
            ok = ParseU32(value, 5, 3600, config.idleDisconnectSeconds);
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
    text += " bridge.request_timeout_ms=" + std::to_string(aConfig.requestTimeoutMs);
    text += " bridge.max_requests_per_second=" + std::to_string(aConfig.maxRequestsPerSecond);
    text += " bridge.idle_disconnect_seconds=" + std::to_string(aConfig.idleDisconnectSeconds);
    text += " log.level=" + std::string(LevelName(aConfig.logLevel));
    text += " capture.root=" + (aConfig.captureRoot.empty() ? std::string("<default>") : std::string("<custom>"));
    return text;
}
} // namespace xfb
