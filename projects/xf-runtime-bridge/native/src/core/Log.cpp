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

namespace
{
// Length of the valid UTF-8 sequence starting at aText[aIndex], or 0 if it is not valid
// (bad lead byte, missing continuation, overlong form, surrogate or above U+10FFFF).
size_t Utf8SequenceLength(std::string_view aText, size_t aIndex)
{
    const auto byte = [&](size_t aOffset) { return static_cast<unsigned char>(aText[aIndex + aOffset]); };
    const auto lead = byte(0);
    size_t length = 0;
    unsigned char low = 0x80;
    unsigned char high = 0xBF;
    if (lead >= 0xC2 && lead <= 0xDF)
    {
        length = 2;
    }
    else if (lead >= 0xE0 && lead <= 0xEF)
    {
        length = 3;
        low = lead == 0xE0 ? 0xA0 : 0x80;  // no overlong forms
        high = lead == 0xED ? 0x9F : 0xBF; // no UTF-16 surrogates
    }
    else if (lead >= 0xF0 && lead <= 0xF4)
    {
        length = 4;
        low = lead == 0xF0 ? 0x90 : 0x80;  // no overlong forms
        high = lead == 0xF4 ? 0x8F : 0xBF; // nothing above U+10FFFF
    }
    else
    {
        return 0;
    }
    if (aIndex + length > aText.size())
    {
        return 0;
    }
    if (byte(1) < low || byte(1) > high)
    {
        return 0;
    }
    for (size_t i = 2; i < length; ++i)
    {
        if (byte(i) < 0x80 || byte(i) > 0xBF)
        {
            return 0;
        }
    }
    return length;
}
} // namespace

std::string Sanitize(std::string_view aText, size_t aMaxBytes)
{
    std::string out;
    out.reserve((aText.size() < aMaxBytes ? aText.size() : aMaxBytes) + 16);
    size_t i = 0;
    while (i < aText.size())
    {
        const auto c = static_cast<unsigned char>(aText[i]);
        if (c < 0x80)
        {
            if (out.size() + 1 > aMaxBytes)
            {
                break;
            }
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
            ++i;
            continue;
        }
        const auto length = Utf8SequenceLength(aText, i);
        if (length == 0)
        {
            // Invalid UTF-8 becomes '?', so every logged line is valid UTF-8.
            if (out.size() + 1 > aMaxBytes)
            {
                break;
            }
            out.push_back('?');
            ++i;
            continue;
        }
        // Cut only on a character boundary: never keep part of a multi-byte character.
        if (out.size() + length > aMaxBytes)
        {
            break;
        }
        out.append(aText.substr(i, length));
        i += length;
    }
    if (i < aText.size())
    {
        out += " [cut ";
        out += std::to_string(aText.size() - i);
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
           std::string_view aMessage) noexcept
{
    // Logging must never throw into its caller (thread entries, natives and game callbacks log
    // from their catch blocks), so an allocation or sink failure drops the line instead.
    try
    {
        if (aLevel < gMinLevel.load())
        {
            return;
        }

        std::string line;
        line.reserve(96 + (aMessage.size() < kMaxMessageBytes ? aMessage.size() : kMaxMessageBytes));
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
    catch (...)
    {
    }
}
} // namespace log
} // namespace xfb
