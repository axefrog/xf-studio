#include "core/KillKey.hpp"
#include "core/LayoutGuard.hpp"

#include <algorithm>
#include <cctype>
#include <vector>

namespace xfb::killkey
{
namespace
{
struct KeyName
{
    const char* label; // as shown
    int vk;
    std::vector<std::string> names; // accepted spellings, lower case, without spaces
};

const std::vector<KeyName>& Keys()
{
    static const std::vector<KeyName> keys = [] {
        std::vector<KeyName> out{
            {"End", 0x23, {"end", "ik_end"}},
            {"Home", 0x24, {"home", "ik_home"}},
            {"Insert", 0x2D, {"insert", "ins", "ik_insert"}},
            {"Delete", 0x2E, {"delete", "del", "ik_delete"}},
            {"Page Up", 0x21, {"pageup", "pgup", "ik_pageup"}},
            {"Page Down", 0x22, {"pagedown", "pgdn", "ik_pagedown"}},
            {"Pause", 0x13, {"pause", "break", "ik_pause"}},
            {"Scroll Lock", 0x91, {"scrolllock", "ik_scrolllock"}},
            {"Numpad *", 0x6A, {"numpad*", "numpadmultiply", "multiply", "ik_multiply"}},
            {"Numpad /", 0x6F, {"numpad/", "numpaddivide", "divide", "ik_divide"}},
            {"Numpad -", 0x6D, {"numpad-", "numpadminus", "subtract", "ik_subtract"}},
            {"Numpad +", 0x6B, {"numpad+", "numpadplus", "add", "ik_add"}},
            {"Numpad .", 0x6E, {"numpad.", "numpaddecimal", "decimal", "ik_decimal"}},
        };
        static const char* fLabels[] = {"F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"};
        for (int i = 0; i < 12; ++i)
        {
            std::string lower = "f" + std::to_string(i + 1);
            out.push_back({fLabels[i], 0x70 + i, {lower, "ik_" + lower}});
        }
        static const char* numpadLabels[] = {"Numpad 0", "Numpad 1", "Numpad 2", "Numpad 3", "Numpad 4",
                                             "Numpad 5", "Numpad 6", "Numpad 7", "Numpad 8", "Numpad 9"};
        for (int i = 0; i < 10; ++i)
        {
            const auto digit = std::to_string(i);
            out.push_back({numpadLabels[i], 0x60 + i, {"numpad" + digit, "ik_numpad" + digit}});
        }
        static const char* letters[] = {"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
                                        "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"};
        for (int i = 0; i < 26; ++i)
        {
            const std::string lower(1, static_cast<char>('a' + i));
            out.push_back({letters[i], 'A' + i, {lower, "ik_" + lower}});
        }
        static const char* digits[] = {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"};
        for (int i = 0; i < 10; ++i)
        {
            out.push_back({digits[i], '0' + i, {digits[i], std::string("ik_") + digits[i]}});
        }
        return out;
    }();
    return keys;
}

std::string Squash(const std::string& aText)
{
    std::string out;
    for (const char c : aText)
    {
        if (!std::isspace(static_cast<unsigned char>(c)))
        {
            out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
        }
    }
    return out;
}
} // namespace

bool Parse(const std::string& aText, Chord& aOut, std::string& aError)
{
    const auto text = Squash(aText);
    if (text.empty())
    {
        aError = "no key given";
        return false;
    }
    if (text == "off" || text == "none" || text == "false")
    {
        aOut = Chord{};
        aOut.enabled = false;
        aOut.label.clear();
        return true;
    }
    if (text.size() > 48)
    {
        aError = "too long";
        return false;
    }
    // Split on '+', but a trailing "numpad+" (or "+" as the last part after "numpad") belongs to the key.
    std::vector<std::string> parts;
    std::string current;
    for (size_t i = 0; i < text.size(); ++i)
    {
        const char c = text[i];
        if (c == '+' && !(current == "numpad" || current == "ik_numpad") && !current.empty())
        {
            parts.push_back(current);
            current.clear();
        }
        else
        {
            current.push_back(c);
        }
    }
    if (current.empty())
    {
        aError = "the key is missing after the last +";
        return false;
    }
    parts.push_back(current);
    Chord chord;
    for (size_t i = 0; i + 1 < parts.size(); ++i)
    {
        const auto& m = parts[i];
        if (m == "ctrl" || m == "control" || m == "ik_lcontrol" || m == "ik_control")
        {
            chord.ctrl = true;
        }
        else if (m == "shift" || m == "ik_lshift" || m == "ik_shift")
        {
            chord.shift = true;
        }
        else if (m == "alt" || m == "ik_alt")
        {
            chord.alt = true;
        }
        else
        {
            aError = "'" + m.substr(0, 24) + "' isn't a modifier (Ctrl, Shift or Alt)";
            return false;
        }
    }
    const auto& keyName = parts.back();
    const auto found = std::find_if(Keys().begin(), Keys().end(), [&](const KeyName& k) {
        return std::find(k.names.begin(), k.names.end(), keyName) != k.names.end();
    });
    if (found == Keys().end())
    {
        aError = "'" + keyName.substr(0, 24) + "' isn't a key the kill key can use (End, Home, Insert, Delete, PageUp, PageDown, Pause, "
                                             "ScrollLock, F1-F12, A-Z, 0-9, Numpad0-9, Numpad*, Numpad/, Numpad-, Numpad+, Numpad.)";
        return false;
    }
    chord.vk = found->vk;
    chord.label = std::string(chord.ctrl ? "Ctrl + " : "") + (chord.shift ? "Shift + " : "") + (chord.alt ? "Alt + " : "") + found->label;
    chord.enabled = true;
    aOut = chord;
    return true;
}

bool GameBinds(int aVk)
{
    if ((aVk >= 'A' && aVk <= 'Z') || (aVk >= '0' && aVk <= '9'))
    {
        return true;
    }
    // F1, F3, F4, F5, F9 and Home (r6/config/inputUserMappings.xml, game 2.31).
    return aVk == 0x70 || aVk == 0x72 || aVk == 0x73 || aVk == 0x74 || aVk == 0x78 || aVk == 0x24;
}

bool Watch::Poll(const Chord& aChord, const std::function<bool(int)>& aIsDown)
{
    if (!aChord.enabled || !aIsDown)
    {
        m_wasDown = false;
        return false;
    }
    const bool down = aIsDown(aChord.vk) && (!aChord.ctrl || aIsDown(0x11)) && (!aChord.shift || aIsDown(0x10)) && (!aChord.alt || aIsDown(0x12));
    const bool pressed = down && !m_wasDown;
    m_wasDown = down;
    return pressed;
}
} // namespace xfb::killkey
