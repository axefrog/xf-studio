#include "core/Messages.hpp"

#include <algorithm>
#include <vector>

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
    // Each kept character's first byte, so a cut can back up by characters (0.8).
    std::string out;
    std::vector<size_t> starts;
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
        if (starts.size() + needed > aMaxChars)
        {
            truncated = true;
            break;
        }
        if (pendingSpace)
        {
            starts.push_back(out.size());
            out.push_back(' ');
            pendingSpace = false;
        }
        starts.push_back(out.size());
        out += piece;
    }
    if (truncated && aMaxChars >= 2)
    {
        // 0.8 (the UI review): room for the ellipsis, then back to the last space if one lies in the last third, so the text
        // never stops mid-word; trailing spaces go.
        size_t keep = std::min(starts.size(), aMaxChars - 1);
        size_t space = keep;
        while (space > 0 && out[starts[space - 1]] != ' ')
        {
            --space;
        }
        if (space > 0 && space - 1 >= (keep * 2) / 3)
        {
            keep = space - 1;
        }
        while (keep > 0 && out[starts[keep - 1]] == ' ')
        {
            --keep;
        }
        out.resize(keep < starts.size() ? starts[keep] : out.size());
        out += "\xE2\x80\xA6"; // U+2026
    }
    if (aTruncated)
    {
        *aTruncated = truncated;
    }
    return out;
}

json UiMessageUndo(const json& aPosted)
{
    if (aPosted.contains("id"))
    {
        return json{{"method", "ui.message"}, {"params", {{"withdraw", aPosted["id"]}}}};
    }
    return nullptr;
}

json AskStateJson(uint64_t aId, const AskState& aState)
{
    json out{{"id", aId}, {"state", aState.state}};
    if (aState.state == "answered")
    {
        out["answer"] = {{"choice", aState.choice}, {"label", aState.label}};
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
    bool withdrawn = false;
    if (aRequest.withdraw != 0)
    {
        const auto before = m_messages.size();
        m_messages.erase(std::remove_if(m_messages.begin(), m_messages.end(), [&](const Message& aMessage) { return aMessage.id == aRequest.withdraw; }),
                         m_messages.end());
        withdrawn = m_messages.size() != before;
    }
    if (aRequest.clear)
    {
        // RB-103: a clear (a capture's, a session step's) takes the lines down but leaves a question that is still waiting
        // for the player's answer, unless the caller withdraws questions too.
        const auto before = m_messages.size();
        m_messages.erase(std::remove_if(m_messages.begin(), m_messages.end(),
                                        [&](const Message& aMessage) { return aRequest.clearAsks || aMessage.choices.empty(); }),
                         m_messages.end());
        cleared = before - m_messages.size();
    }
    bool truncated = false;
    const auto text = CleanMessageText(aRequest.text, kMaxChars, &truncated);
    if (text.empty())
    {
        json out{{"cleared", cleared}, {"active", m_messages.size()}};
        if (aRequest.withdraw != 0)
        {
            out["withdrawn"] = withdrawn;
        }
        if (aRequest.clear && !aRequest.clearAsks)
        {
            PendingAsk kept;
            if (PendingLocked(kept, aNow))
            {
                out["kept_question"] = kept.id;
            }
        }
        return out;
    }
    const auto seconds = std::clamp<int32_t>(aRequest.seconds, 1, kMaxSeconds);
    std::vector<std::string> choices;
    if (aRequest.level == "ask")
    {
        for (const auto& choice : aRequest.choices.empty() ? DefaultChoices() : aRequest.choices)
        {
            if (choices.size() < kMaxChoices)
            {
                const auto clean = CleanMessageText(choice, kMaxChoiceChars);
                if (!clean.empty())
                {
                    choices.push_back(clean);
                }
            }
        }
    }
    // Pinned (0.7): the newest unanswered ask stays; the oldest other line makes room. A new ask takes the pin over.
    uint64_t pinned = 0;
    if (choices.empty())
    {
        for (auto it = m_messages.rbegin(); it != m_messages.rend(); ++it)
        {
            if (!it->choices.empty())
            {
                pinned = it->id;
                break;
            }
        }
    }
    // 0.8: an answered ask stays until the next message; this is it.
    m_messages.erase(std::remove_if(m_messages.begin(), m_messages.end(), [](const Message& aMessage) { return !aMessage.answered.empty(); }),
                     m_messages.end());
    json dropped = json::array();
    while (m_messages.size() >= kMaxMessages)
    {
        auto victim = m_messages.begin();
        if (victim->id == pinned && m_messages.size() > 1)
        {
            ++victim;
        }
        dropped.push_back(victim->id);
        m_messages.erase(victim);
    }
    const auto id = m_next++;
    m_messages.push_back({id, text, aRequest.level, aNow + std::chrono::seconds(seconds), choices});
    json out{{"id", id},       {"shown", true},         {"text", text}, {"level", aRequest.level}, {"seconds", seconds},
             {"truncated", truncated}, {"dropped", dropped}, {"active", m_messages.size()}};
    if (!choices.empty())
    {
        out["choices"] = choices;
    }
    if (aRequest.clear)
    {
        out["cleared"] = cleared;
    }
    return out;
}

std::string MessageBoard::Snapshot(Clock::time_point aNow, SurfaceText aSurface)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    if (m_messages.empty())
    {
        return {};
    }
    const auto surface = [aSurface](const std::string& aText) { return aSurface ? aSurface(aText) : aText; };
    const auto labels = [&surface](const std::vector<std::string>& aList) {
        json out = json::array();
        for (const auto& label : aList)
        {
            out.push_back(surface(label));
        }
        return out;
    };
    json list = json::array();
    for (const auto& message : m_messages)
    {
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(message.expires - aNow).count();
        json line{{"id", message.id}, {"text", surface(message.text)}, {"level", message.level}, {"remaining_ms", remaining}};
        if (!message.choices.empty())
        {
            line["choices"] = labels(message.choices);
        }
        if (!message.answered.empty())
        {
            line["answered"] = surface(message.answered);
        }
        list.push_back(line);
    }
    json out{{"messages", list}};
    PendingAsk ask;
    if (PendingLocked(ask, aNow))
    {
        out["pending_ask"] = {{"id", ask.id}, {"text", surface(ask.text)}, {"choices", labels(ask.choices)}};
    }
    AnsweredAsk answered;
    if (AnsweredLocked(answered, aNow))
    {
        out["answered_ask"] = {{"id", answered.id}, {"text", surface(answered.text)}, {"label", surface(answered.label)}};
    }
    return out.dump(-1, ' ', false, json::error_handler_t::replace);
}

std::vector<std::string> MessageBoard::DefaultChoices()
{
    // 0.8 (session 8): one button. A question that needs Yes or No, or a choice, passes its own labels.
    return {"Done"};
}

bool MessageBoard::AnsweredLocked(AnsweredAsk& aOut, Clock::time_point aNow) const
{
    for (auto it = m_messages.rbegin(); it != m_messages.rend(); ++it)
    {
        if (!it->answered.empty() && it->expires > aNow)
        {
            aOut.id = it->id;
            aOut.text = it->text;
            aOut.label = it->answered;
            return true;
        }
    }
    return false;
}

bool MessageBoard::Answered(AnsweredAsk& aOut, Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    return AnsweredLocked(aOut, aNow);
}

bool MessageBoard::PendingLocked(PendingAsk& aOut, Clock::time_point aNow) const
{
    for (auto it = m_messages.rbegin(); it != m_messages.rend(); ++it)
    {
        if (!it->choices.empty() && it->expires > aNow)
        {
            aOut.id = it->id;
            aOut.text = it->text;
            aOut.choices = it->choices;
            aOut.remainingMs = std::chrono::duration_cast<std::chrono::milliseconds>(it->expires - aNow).count();
            return true;
        }
    }
    return false;
}

bool MessageBoard::Pending(PendingAsk& aOut, Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    return PendingLocked(aOut, aNow);
}

json MessageBoard::Answer(uint64_t aId, int32_t aChoice, Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    PendingAsk pending;
    const uint64_t id = aId != 0 ? aId : (PendingLocked(pending, aNow) ? pending.id : 0);
    for (auto& message : m_messages)
    {
        if (message.id != id)
        {
            continue;
        }
        if (message.choices.empty())
        {
            return json{{"ok", false}, {"why", "that message has no answer buttons, or was answered already"}, {"message_id", id}};
        }
        if (aChoice < 0 || static_cast<size_t>(aChoice) >= message.choices.size())
        {
            return json{{"ok", false}, {"why", "no such choice"}, {"message_id", id}};
        }
        const auto label = message.choices[static_cast<size_t>(aChoice)];
        json out{{"ok", true}, {"message_id", id}, {"choice", aChoice}, {"label", label}, {"text", message.text}};
        m_answered.emplace_back(id, AskState{"answered", aChoice, label});
        while (m_answered.size() > kAnsweredKept)
        {
            m_answered.pop_front();
        }
        // 0.8 (the UI review): the question stays as it was, with the answer where its keys were, until the next message.
        message.choices.clear();
        message.answered = label;
        message.expires = std::max(message.expires, aNow + std::chrono::seconds(kAnsweredSeconds));
        return out;
    }
    return json{{"ok", false}, {"why", id == 0 ? "no question is waiting for an answer" : "that question isn't showing any more"}, {"message_id", id}};
}

AskState MessageBoard::StateOf(uint64_t aId, Clock::time_point aNow)
{
    std::scoped_lock _(m_mutex);
    DropExpired(aNow);
    for (const auto& [id, state] : m_answered)
    {
        if (id == aId)
        {
            return state;
        }
    }
    for (const auto& message : m_messages)
    {
        if (message.id == aId && !message.choices.empty())
        {
            return {"pending"};
        }
    }
    return {aId == 0 || aId >= m_next ? "unknown" : "gone"};
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
