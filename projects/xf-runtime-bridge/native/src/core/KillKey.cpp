#include "core/KillKey.hpp"
#include "core/LayoutGuard.hpp"
#include "core/Win32.hpp"

#include <algorithm>
#include <cctype>
#include <map>
#include <set>
#include <vector>

#include <nlohmann/json.hpp>

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
    chord.ctrl = false; // 0.8.4: the default chord holds Ctrl and Shift; a parsed one has only the modifiers it names
    chord.shift = false;
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
        aError = "'" + keyName.substr(0, 24) + "' isn't a key the stop key can use (End, Home, Insert, Delete, PageUp, PageDown, Pause, "
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

bool Watch::Poll(const Chord& aChord, bool aArmed, const std::function<bool(int)>& aIsDown, const std::function<bool()>& aStillArmed)
{
    if (!aChord.enabled || !aArmed || !aIsDown)
    {
        // Disarmed: nothing is read, and the next armed press needs a release first.
        m_needRelease = true;
        m_wasDown = true;
        return false;
    }
    const bool down = aIsDown(aChord.vk) && (!aChord.ctrl || aIsDown(0x11)) && (!aChord.shift || aIsDown(0x10)) && (!aChord.alt || aIsDown(0x12));
    if (m_needRelease)
    {
        if (!down)
        {
            m_needRelease = false;
            m_wasDown = false;
        }
        return false;
    }
    const bool pressed = down && !m_wasDown;
    m_wasDown = down;
    return pressed && (!aStillArmed || aStillArmed());
}
std::string Spelling(const Chord& aChord)
{
    if (!aChord.enabled)
    {
        return "off";
    }
    std::string out;
    for (const char c : aChord.label)
    {
        if (c != ' ')
        {
            out.push_back(c);
        }
    }
    return out;
}

std::string WithKillKey(const std::string& aIni, const std::string& aValue)
{
    const std::string eol = aIni.find("\r\n") != std::string::npos ? "\r\n" : "\n";
    std::vector<std::string> lines;
    size_t start = 0;
    while (start < aIni.size())
    {
        auto end = aIni.find('\n', start);
        if (end == std::string::npos)
        {
            end = aIni.size();
        }
        auto line = aIni.substr(start, end - start);
        if (!line.empty() && line.back() == '\r')
        {
            line.pop_back();
        }
        lines.push_back(line);
        start = end + 1;
    }
    const auto trimmed = [](const std::string& aLine) {
        const auto first = aLine.find_first_not_of(" \t");
        return first == std::string::npos ? std::string() : aLine.substr(first);
    };
    const std::string setting = "kill_key = " + aValue;
    const auto join = [&eol](const std::vector<std::string>& aLines) {
        std::string out;
        for (const auto& line : aLines)
        {
            out += line + eol;
        }
        return out;
    };
    bool inUi = false;
    bool hasUi = false;
    size_t uiEnd = 0; // the index after [ui]'s last non-blank line
    // The review of 0.8.4: the reader applies the last kill_key it meets (in any [ui] section), so that is the one replaced.
    size_t lastKill = lines.size();
    for (size_t i = 0; i < lines.size(); ++i)
    {
        const auto t = trimmed(lines[i]);
        if (!t.empty() && t[0] == '[')
        {
            inUi = Squash(t) == "[ui]";
            if (inUi)
            {
                hasUi = true;
                uiEnd = i + 1;
            }
            continue;
        }
        if (!inUi || t.empty())
        {
            continue;
        }
        uiEnd = i + 1;
        const auto eq = t.find('=');
        if (t[0] == ';' || t[0] == '#' || eq == std::string::npos)
        {
            continue;
        }
        if (Squash(t.substr(0, eq)) == "kill_key")
        {
            lastKill = i;
        }
    }
    if (lastKill < lines.size())
    {
        lines[lastKill] = setting;
        return join(lines);
    }
    if (hasUi)
    {
        lines.insert(lines.begin() + static_cast<std::ptrdiff_t>(uiEnd), setting);
    }
    else
    {
        if (!lines.empty() && !lines.back().empty())
        {
            lines.push_back("");
        }
        lines.push_back("[ui]");
        lines.push_back(setting);
    }
    return join(lines);
}

namespace
{
// The game's name for a key (ik_end, ik_f12, ik_numpad0, ...: lower case), from the accepted spellings.
std::string GameName(int aVk)
{
    for (const auto& key : Keys())
    {
        if (key.vk != aVk)
        {
            continue;
        }
        for (const auto& name : key.names)
        {
            if (name.rfind("ik_", 0) == 0)
            {
                return name;
            }
        }
    }
    return {};
}

std::string KeyLabel(int aVk)
{
    const auto found = std::find_if(Keys().begin(), Keys().end(), [aVk](const KeyName& k) { return k.vk == aVk; });
    return found == Keys().end() ? std::string("the key") : std::string(found->label);
}

std::string Lower(std::string aText)
{
    std::transform(aText.begin(), aText.end(), aText.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return aText;
}

// The mapping names in one input-mapping file that bind each key (lower-case IK name -> mapping names, in file order).
std::map<std::string, std::vector<std::string>> MappingsByKey(const std::string& aXml)
{
    std::map<std::string, std::vector<std::string>> out;
    size_t at = 0;
    while ((at = aXml.find("<mapping", at)) != std::string::npos)
    {
        const auto close = aXml.find("</mapping>", at);
        const auto end = close == std::string::npos ? aXml.size() : close;
        std::string name = "a mapping";
        const auto nameAt = aXml.find("name=\"", at);
        if (nameAt != std::string::npos && nameAt < end)
        {
            const auto nameEnd = aXml.find('"', nameAt + 6);
            if (nameEnd != std::string::npos && nameEnd < end)
            {
                name = aXml.substr(nameAt + 6, std::min<size_t>(nameEnd - nameAt - 6, 64));
            }
        }
        size_t id = at;
        while ((id = aXml.find("id=\"IK_", id)) != std::string::npos && id < end)
        {
            const auto idEnd = aXml.find('"', id + 4);
            if (idEnd == std::string::npos || idEnd > end)
            {
                break;
            }
            auto& names = out[Lower(aXml.substr(id + 4, idEnd - id - 4))];
            if (std::find(names.begin(), names.end(), name) == names.end())
            {
                names.push_back(name);
            }
            id = idEnd;
        }
        at = end;
    }
    return out;
}

std::string Joined(const std::vector<std::string>& aNames, size_t aMax)
{
    std::string out;
    for (size_t i = 0; i < aNames.size() && i < aMax; ++i)
    {
        out += (out.empty() ? "" : ", ") + aNames[i];
    }
    if (aNames.size() > aMax)
    {
        out += " and " + std::to_string(aNames.size() - aMax) + " more";
    }
    return out;
}

// 0.8.5 (session 12's K3: the note listed "Dodge_Button, LeftY_Axis_Vehicle, … and 8 more"): the game's common actions in plain
// words, as a verb for many keys ("dodge") and for one ("dodges"), in the order a list names them. The mapping names are the
// game's 2.31 r6/config/inputUserMappings.xml; any other action is only counted.
struct PlainAction
{
    const char* mapping; // lower case
    const char* plural;
    const char* singular;
};

const std::vector<PlainAction>& PlainActions()
{
    static const std::vector<PlainAction> actions{
        {"dodge_button", "dodge", "dodges"},
        {"crouch_button", "crouch", "crouches"},
        {"togglecrouch_button", "crouch", "crouches"},
        {"sprint_button", "sprint", "sprints"},
        {"togglesprint_button", "sprint", "sprints"},
        {"lefty_axis_vehicle", "steer vehicles", "steers vehicles"},
        {"lefty_axis_vehicle_rockfb", "steer vehicles", "steers vehicles"},
        {"switchitem_button", "switch weapons", "switches weapons"},
        {"weaponwheel_button", "open the weapon wheel", "opens the weapon wheel"},
        {"vehicle_shoot_tertiary", "fire vehicle weapons", "fires vehicle weapons"},
        {"vehicle_mountedweapons_switchweapons_button", "switch vehicle weapons", "switches vehicle weapons"},
        {"activatefreecam", "move photo mode's camera", "moves photo mode's camera"},
        {"cameramultspeed", "move photo mode's camera", "moves photo mode's camera"},
        {"camerareducespeed", "move photo mode's camera", "moves photo mode's camera"},
        {"braindanceswitchlayer_button", "switch braindance layers", "switches braindance layers"},
    };
    return actions;
}

// "dodge, crouch and steer vehicles" (aSingular: "dodges, ..."), at most aMax plain names, the most common first; the rest
// (other plain names and actions without one) in aOthers.
std::string PlainList(const std::vector<std::string>& aMappings, bool aSingular, size_t aMax, size_t& aOthers)
{
    std::vector<size_t> found;
    aOthers = 0;
    for (const auto& name : aMappings)
    {
        const auto lower = Lower(name);
        const auto& actions = PlainActions();
        const auto it = std::find_if(actions.begin(), actions.end(), [&](const PlainAction& a) { return lower == a.mapping; });
        if (it == actions.end())
        {
            ++aOthers;
            continue;
        }
        // One entry per plain name (sprint and toggle sprint read the same).
        const std::string plural = it->plural;
        const auto first = std::find_if(actions.begin(), actions.end(), [&](const PlainAction& a) { return plural == a.plural; });
        const auto index = static_cast<size_t>(first - actions.begin());
        if (std::find(found.begin(), found.end(), index) == found.end())
        {
            found.push_back(index);
        }
    }
    std::sort(found.begin(), found.end());
    if (found.size() > aMax)
    {
        aOthers += found.size() - aMax;
        found.resize(aMax);
    }
    std::string out;
    for (size_t i = 0; i < found.size(); ++i)
    {
        const auto& action = PlainActions()[found[i]];
        out += (i == 0 ? "" : (i + 1 == found.size() ? " and " : ", ")) + std::string(aSingular ? action.singular : action.plural);
    }
    return out;
}

std::string Actions(size_t aCount)
{
    return std::to_string(aCount) + (aCount == 1 ? " game action" : " game actions");
}

void AddOnce(std::vector<std::string>& aList, const std::string& aItem)
{
    if (std::find(aList.begin(), aList.end(), aItem) == aList.end())
    {
        aList.push_back(aItem);
    }
}

// Left and right Shift, Ctrl and Alt as the generic keys (CET records whichever Windows reported).
int Generic(int aVk)
{
    if (aVk == 0xA0 || aVk == 0xA1)
    {
        return 0x10;
    }
    if (aVk == 0xA2 || aVk == 0xA3)
    {
        return 0x11;
    }
    if (aVk == 0xA4 || aVk == 0xA5)
    {
        return 0x12;
    }
    return aVk;
}
} // namespace

std::vector<std::pair<std::string, std::string>> InputMappingFiles(const std::filesystem::path& aGameRoot)
{
    std::vector<std::pair<std::string, std::string>> files;
    const auto add = [&files](const std::string& aName, const std::filesystem::path& aPath) {
        std::string text;
        std::string why;
        bool missing = false;
        if (win32::ReadFileExact(aPath, text, missing, why))
        {
            files.emplace_back(aName, std::move(text));
        }
    };
    add("r6/config/inputUserMappings.xml", aGameRoot / L"r6" / L"config" / L"inputUserMappings.xml");
    const auto input = aGameRoot / L"r6" / L"input";
    std::error_code ec;
    int entries = 0;
    for (std::filesystem::recursive_directory_iterator it(input, std::filesystem::directory_options::skip_permission_denied, ec), end;
         !ec && it != end && entries < 2000 && files.size() < 257; it.increment(ec), ++entries)
    {
        if (it.depth() >= 8)
        {
            it.disable_recursion_pending();
        }
        std::error_code fileEc;
        if (it->is_regular_file(fileEc) && it->path().extension() == L".xml")
        {
            add("r6/input/" + win32::Narrow(std::filesystem::relative(it->path(), input, fileEc).generic_wstring()), it->path());
        }
    }
    return files;
}

Conflicts FindConflicts(const Chord& aChord, const std::vector<std::pair<std::string, std::string>>& aMappingFiles, const std::string& aCetBindingsJson)
{
    Conflicts out;
    if (!aChord.enabled)
    {
        return out;
    }
    const auto keyName = GameName(aChord.vk);
    const auto keyLabel = KeyLabel(aChord.vk);
    std::vector<std::string> modifierNames;
    std::vector<std::string> modifierUses;
    for (const auto& [file, xml] : aMappingFiles)
    {
        const auto byKey = MappingsByKey(xml);
        if (const auto found = byKey.find(keyName); !keyName.empty() && found != byKey.end())
        {
            // 0.8.5: the game's actions in plain words, the rest counted.
            size_t others = 0;
            const auto plain = PlainList(found->second, false, 3, others);
            const auto what = plain.empty() ? Actions(others) : plain + (others > 0 ? " and " + std::to_string(others) + " more" : std::string());
            out.warnings.push_back("The game uses " + keyLabel + " too (" + what + ", in " + file +
                                   "), so pressing it also does that. To avoid it, press Change... and pick another key.");
        }
        const auto modifier = [&](bool aUsed, const char* aLabel, std::initializer_list<const char*> aNames) {
            if (!aUsed)
            {
                return;
            }
            for (const auto* name : aNames)
            {
                if (const auto found = byKey.find(name); found != byKey.end())
                {
                    AddOnce(modifierNames, aLabel);
                    for (const auto& use : found->second)
                    {
                        AddOnce(modifierUses, use);
                    }
                }
            }
        };
        modifier(aChord.ctrl, "Ctrl", {"ik_lcontrol", "ik_rcontrol", "ik_control"});
        modifier(aChord.shift, "Shift", {"ik_lshift", "ik_rshift", "ik_shift"});
        modifier(aChord.alt, "Alt", {"ik_alt", "ik_lalt", "ik_ralt"});
    }
    if (!modifierNames.empty())
    {
        // 0.8.5 (session 12's K3): plain words, not the game's mapping names: "Ctrl and Alt also dodge, crouch and steer vehicles
        // on their own (and 8 more game actions); ...". Without a known action, only the count.
        const bool many = modifierNames.size() > 1;
        size_t others = 0;
        const auto plain = PlainList(modifierUses, !many, 3, others);
        std::string keys; // "Ctrl", "Ctrl and Alt", "Ctrl, Shift and Alt"
        for (size_t i = 0; i < modifierNames.size(); ++i)
        {
            keys += (i == 0 ? "" : (i + 1 == modifierNames.size() ? " and " : ", ")) + modifierNames[i];
        }
        std::string note;
        if (plain.empty())
        {
            note = keys + (many ? " are game keys on their own (" : " is a game key on its own (") + Actions(others) + ")";
        }
        else
        {
            note = keys + " also " + plain + (many ? " on their own" : " on its own") +
                   (others > 0 ? " (and " + std::to_string(others) + " more)" : std::string());
        }
        out.notes.push_back(note + "; holding " + (many ? "them" : "it") + " for the stop key only matters while V moves.");
    }
    // CET's hotkeys: {"mod": {"id": code}} (or the older {"mod.id": code}); a code packs up to four virtual keys, 16 bits each,
    // the first in the top bits (CET VKBindings::DecodeVKCodeBind).
    const auto bindings = nlohmann::json::parse(aCetBindingsJson, nullptr, false);
    if (bindings.is_object())
    {
        std::set<int> ours{aChord.vk};
        if (aChord.ctrl)
        {
            ours.insert(0x11);
        }
        if (aChord.shift)
        {
            ours.insert(0x10);
        }
        if (aChord.alt)
        {
            ours.insert(0x12);
        }
        const auto check = [&](const std::string& aMod, const std::string& aId, const nlohmann::json& aCode) {
            if (Lower(aMod) == "xf_runtime_bridge" || !aCode.is_number_unsigned())
            {
                return;
            }
            const auto code = aCode.get<uint64_t>();
            std::set<int> keys;
            for (int i = 0; i < 4; ++i)
            {
                const int vk = static_cast<int>((code >> (48 - 16 * i)) & 0xFFFF);
                if (vk != 0)
                {
                    keys.insert(Generic(vk));
                }
            }
            if (keys.empty() || !keys.count(aChord.vk) || !std::includes(ours.begin(), ours.end(), keys.begin(), keys.end()))
            {
                return;
            }
            out.warnings.push_back("Cyber Engine Tweaks' hotkey " + aMod.substr(0, 48) + " / " + aId.substr(0, 48) + " uses " +
                                   (keys == ours ? std::string("the same keys") : std::string("part of these keys")) + ", so it reacts too. To avoid it, press Change... and pick another key, or rebind that hotkey in CET's Bindings.");
        };
        for (const auto& [mod, value] : bindings.items())
        {
            if (value.is_object())
            {
                for (const auto& [id, code] : value.items())
                {
                    check(mod, id, code);
                }
            }
            else if (const auto dot = mod.find('.'); dot != std::string::npos)
            {
                check(mod.substr(0, dot), mod.substr(dot + 1), value);
            }
        }
    }
    return out;
}

} // namespace xfb::killkey
