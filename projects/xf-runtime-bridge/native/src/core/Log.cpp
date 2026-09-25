#include "core/Log.hpp"

#include <mutex>

namespace xfb
{
namespace
{
std::mutex gSinkMutex;
ILogSink* gSink = nullptr;
std::atomic<Level> gMinLevel{Level::Info};
std::string gSessionId = "-";
} // namespace

std::string_view LevelName(Level aLevel)
{
    switch (aLevel)
    {
    case Level::Debug:
        return "debug";
    case Level::Info:
        return "info";
    case Level::Warn:
        return "warn";
    case Level::Error:
        return "error";
    }
    return "info";
}

bool ParseLevel(std::string_view aText, Level& aOut)
{
    if (aText == "debug" || aText == "trace")
    {
        aOut = Level::Debug;
    }
    else if (aText == "info")
    {
        aOut = Level::Info;
    }
    else if (aText == "warn" || aText == "warning")
    {
        aOut = Level::Warn;
    }
    else if (aText == "error" || aText == "critical")
    {
        aOut = Level::Error;
    }
    else
    {
        return false;
    }
    return true;
}

std::string Sanitize(std::string_view aText, size_t aMaxBytes)
{
    std::string out;
    const auto limit = aText.size() < aMaxBytes ? aText.size() : aMaxBytes;
    out.reserve(limit + 16);
    for (size_t i = 0; i < limit; ++i)
    {
        const auto c = static_cast<unsigned char>(aText[i]);
        if (c == '\n' || c == '\r' || c == '\t')
        {
            out.push_back(' ');
        }
        else if (c < 0x20 || c == 0x7F)
        {
            out.push_back('?');
        }
        else
        {
            out.push_back(static_cast<char>(c));
        }
    }
    if (aText.size() > aMaxBytes)
    {
        out += " [cut ";
        out += std::to_string(aText.size() - aMaxBytes);
        out += " bytes]";
    }
    return out;
}

namespace log
{
void SetSink(ILogSink* aSink)
{
    std::scoped_lock _(gSinkMutex);
    gSink = aSink;
}

void SetMinLevel(Level aLevel)
{
    gMinLevel.store(aLevel);
}

Level MinLevel()
{
    return gMinLevel.load();
}

void SetSessionId(std::string aSessionId)
{
    std::scoped_lock _(gSinkMutex);
    gSessionId = std::move(aSessionId);
}

const std::string& SessionId()
{
    return gSessionId;
}

void Write(Level aLevel, std::string_view aLayer, std::string_view aCid, std::string_view aEvent,
           std::string_view aMessage)
{
    if (aLevel < gMinLevel.load())
    {
        return;
    }

    std::string line;
    line.reserve(96 + aMessage.size());
    line += "sid=";
    {
        std::scoped_lock _(gSinkMutex);
        line += gSessionId;
    }
    line += " lvl=";
    line += LevelName(aLevel);
    line += " layer=";
    line += Sanitize(aLayer, 16);
    line += " cid=";
    line += aCid.empty() ? std::string("-") : Sanitize(aCid, 64);
    line += " evt=";
    line += Sanitize(aEvent, 64);
    if (!aMessage.empty())
    {
        line += ' ';
        line += Sanitize(aMessage, kMaxMessageBytes);
    }

    std::scoped_lock _(gSinkMutex);
    if (gSink)
    {
        gSink->Write(aLevel, line);
    }
}
} // namespace log
} // namespace xfb
