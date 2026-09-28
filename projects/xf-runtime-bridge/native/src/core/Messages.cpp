#include "core/Messages.hpp"

#include <algorithm>

namespace xfb
{
namespace
{
using json = nlohmann::json;

// The next UTF-8 code point at aText[aPos]: its length in bytes, or 0 for an invalid sequence.
size_t CodePointLength(const std::string& aText, size_t aPos, uint32_t& aCodePoint)
{
    const auto byte = [&](size_t i) { return static_cast<unsigned char>(aText[i]); };
    const unsigned char lead = byte(aPos);
    size_t length = 0;
    uint32_t cp = 0;
    if (lead < 0x80)
    {
        aCodePoint = lead;
        return 1;
    }
    if ((lead & 0xE0) == 0xC0)
    {
        length = 2;
        cp = lead & 0x1F;
    }
    else if ((lead & 0xF0) == 0xE0)
    {
        length = 3;
        cp = lead & 0x0F;
    }
    else if ((lead & 0xF8) == 0xF0)
    {
        length = 4;
        cp = lead & 0x07;
    }
    else
    {
        return 0;
    }
    if (aPos + length > aText.size())
    {
        return 0;
    }
    for (size_t i = 1; i < length; ++i)
    {
        if ((byte(aPos + i) & 0xC0) != 0x80)
        {
            return 0;
        }
        cp = (cp << 6) | (byte(aPos + i) & 0x3F);
    }
    // Overlong forms, surrogates and values past U+10FFFF are invalid.
    if ((length == 2 && cp < 0x80) || (length == 3 && cp < 0x800) || (length == 4 && cp < 0x10000) || cp > 0x10FFFF ||
        (cp >= 0xD800 && cp <= 0xDFFF))
    {
        return 0;
    }
    aCodePoint = cp;
    return length;
}
} // namespace

std::string CleanMessageText(const std::string& aText, size_t aMaxChars, bool* aTruncated)
{
    std::string out;
    size_t chars = 0;
    bool truncated = false;
    bool pendingSpace = false;
    size_t pos = 0;
    while (pos < aText.size())
    {
        uint32_t cp = 0;
        const size_t length = CodePointLength(aText, pos, cp);
        std::string piece;
        if (length == 0)
        {
            piece = "\xEF\xBF\xBD"; // U+FFFD for an invalid byte
            pos += 1;
        }
        else
        {
            piece = aText.substr(pos, length);
            pos += length;
        }
        const bool space = length != 0 && (cp < 0x20 || cp == 0x7F || cp == ' ' || (cp >= 0x80 && cp < 0xA0));
        if (space)
        {
            pendingSpace = !out.empty();
            continue;
        }
        const size_t needed = (pendingSpace ? 1 : 0) + 1;
        if (chars + needed > aMaxChars)
        {
            truncated = true;
            break;
        }
        if (pendingSpace)
        {
            out.push_back(' ');
            ++chars;
            pendingSpace = false;
        }
        out += piece;
        ++chars;
    }
    if (aTruncated)
    {
        *aTruncated = truncated;
    }
    return out;
}

void MessageBoard::DropExpired(Clock::time_point aNow)
{
    m_messages.erase(std::remove_if(m_messages.begin(), m_messages.end(), [aNow](const Message& aMessage) { return aMessage.expires <= aNow; }),
                     m_messages.end());
}

json MessageBoard::Post(const MessageRequest& aRequest, Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    size_t cleared = 0;
    if (aRequest.clear)
    {
        cleared = m_messages.size();
        m_messages.clear();
    }
    bool truncated = false;
    const auto text = CleanMessageText(aRequest.text, kMaxChars, &truncated);
    if (text.empty())
    {
        return json{{"cleared", cleared}, {"active", m_messages.size()}};
    }
    const auto seconds = std::clamp<int32_t>(aRequest.seconds, 1, kMaxSeconds);
    json dropped = json::array();
    while (m_messages.size() >= kMaxMessages)
    {
        dropped.push_back(m_messages.front().id);
        m_messages.pop_front();
    }
    const auto id = m_next++;
    m_messages.push_back({id, text, aRequest.level, aNow + std::chrono::seconds(seconds)});
    json out{{"id", id},       {"shown", true},         {"text", text}, {"level", aRequest.level}, {"seconds", seconds},
             {"truncated", truncated}, {"dropped", dropped}, {"active", m_messages.size()}};
    if (aRequest.clear)
    {
        out["cleared"] = cleared;
    }
    return out;
}

std::string MessageBoard::Snapshot(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    if (m_messages.empty())
    {
        return {};
    }
    json list = json::array();
    for (const auto& message : m_messages)
    {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(message.expires - aNow).count();
        list.push_back({{"id", message.id}, {"text", message.text}, {"level", message.level}, {"remaining_ms", remaining}});
    }
    return json{{"messages", list}}.dump(-1, ' ', false, json::error_handler_t::replace);
}

std::vector<std::pair<std::string, std::string>> MessageBoard::Lines(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    std::vector<std::pair<std::string, std::string>> out;
    for (const auto& message : m_messages)
    {
        out.emplace_back(message.level, message.text);
    }
    return out;
}

size_t MessageBoard::Clear()
{
    std::scoped_lock _(m_mutex);
    const auto count = m_messages.size();
    m_messages.clear();
    return count;
}

size_t MessageBoard::Active(Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    return m_messages.size();
}
} // namespace xfb
