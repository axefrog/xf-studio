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
    // 0.8: center and bottom_center too (session 8: "center" was refused, so the panel stayed where it was).
    static const std::vector<std::string> anchors{"top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"};
    return anchors;
}

const std::vector<std::string>& Variants()
{
    static const std::vector<std::string> variants{"custom", "apartment", "clothes", "default", "interaction"};
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
                {"nameplates", aSettings.nameplates}, {"cet_label", aSettings.cetLabel}, {"modal", aSettings.modal}};
}

bool AnchorOk(const std::string& aAnchor)
{
    return Contains(Anchors(), aAnchor);
}

bool LayerOk(const std::string& aLayer)
{
    return aLayer == "hud" || aLayer == "photo_menu" || aLayer == "notifications" || aLayer == "top";
}

bool LayerIsHud(const std::string& aLayer)
{
    return aLayer == "hud" || aLayer == "photo_menu";
}

HudSettings ApplyHudParams(const HudSettings& aCurrent, const HudSettings& aDefaults, const json& aParams)
{
    RequireOnly(aParams, {"show", "anchor", "x", "y", "scale", "layer", "nameplates", "cet_label", "modal", "reset"}, "ui.hud");
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
            Bad("'layer' must be photo_menu, hud, notifications or top");
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
    if (Has(aParams, "modal"))
    {
        next.modal = Boolean(aParams, "modal");
    }
    return next;
}

Status Summarize(const BridgeView& aView)
{
    // 0.8 (the UI review): one wording for the ink panel, the XF box, the CET label and the CET window, no jargon
    // ("listening", "writes ON", "client", "an XF tool"). Session 8's maintainer asked what "Waiting for XF Studio · changes
    // allowed" meant: not connected now says so.
    Status out;
    const auto whole = [&out](const std::string& aTone, const std::string& aText) {
        out.tone = aTone;
        out.text = aText;
        out.connection = aText;
        out.connectionTone = aTone;
    };
    if (!aView.pluginEnabled)
    {
        whole("off", "Switched off in the bridge's settings.");
    }
    else if (aView.killed)
    {
        whole("killed", "Stopped. Reconnect in the XF Runtime Bridge window (open the CET overlay), or restart the game.");
        out.connection = "Stopped.";
        out.chip = "Stopped";
    }
    else if (!aView.listening)
    {
        whole("idle", "Not ready yet. Restart the game if this stays.");
    }
    else
    {
        // 0.8.2 (session 9): the session, not each momentary connection (the coordinator's CLI connects per call).
        const bool connected = aView.hasClient || aView.inSession;
        out.connection = connected ? "XF Studio connected" : "XF Studio not connected";
        out.connectionTone = connected ? "ok" : "idle";
        if (!aView.allowWrites)
        {
            out.changes = "read-only";
            out.changesTone = "ok";
            out.chip = "Read-only";
        }
        else if (aView.writesPaused)
        {
            out.changes = "changes paused";
            out.changesTone = "paused";
            out.chip = "Paused";
        }
        else
        {
            out.changes = "changes allowed";
            out.changesTone = "write";
            out.chip = "Changes allowed";
        }
        out.tone = out.changesTone;
        out.text = out.connection + " \xC2\xB7 " + out.changes;
    }
    out.label = "XF Runtime Bridge \xC2\xB7 " + out.text;
    return out;
}

StatusSurface ChooseStatusSurface(const SurfaceFacts& aFacts)
{
    if (!aFacts.sessionLive)
    {
        return StatusSurface::None;
    }
    if (aFacts.inkShowing)
    {
        return StatusSurface::InkPanel;
    }
    return aFacts.xfBoxDrawing ? StatusSurface::XfBox : StatusSurface::CetLine;
}

const char* SurfaceName(StatusSurface aSurface)
{
    switch (aSurface)
    {
    case StatusSurface::InkPanel:
        return "ink_panel";
    case StatusSurface::XfBox:
        return "xf_box";
    case StatusSurface::None:
        return "none";
    case StatusSurface::CetLine:
        break;
    }
    return "cet_line";
}

json StatusJson(const BridgeView& aView)
{
    const auto status = Summarize(aView);
    return json{{"tone", status.tone},
                {"text", status.text},
                {"label", status.label},
                {"connection", status.connection},
                {"connection_tone", status.connectionTone},
                {"changes", status.changes},
                {"changes_tone", status.changesTone},
                {"chip", status.chip}};
}

namespace
{
// The next code point of UTF-8 text at aPos (its byte length), or 0 bytes for an invalid sequence.
size_t NextCodePoint(const std::string& aText, size_t aPos, uint32_t& aCp)
{
    const auto lead = static_cast<unsigned char>(aText[aPos]);
    const size_t length = lead < 0x80 ? 1 : (lead & 0xE0) == 0xC0 ? 2 : (lead & 0xF0) == 0xE0 ? 3 : (lead & 0xF8) == 0xF0 ? 4 : 0;
    if (length == 0 || aPos + length > aText.size())
    {
        return 0;
    }
    uint32_t cp = length == 1 ? lead : length == 2 ? (lead & 0x1Fu) : length == 3 ? (lead & 0x0Fu) : (lead & 0x07u);
    for (size_t k = 1; k < length; ++k)
    {
        const auto next = static_cast<unsigned char>(aText[aPos + k]);
        if ((next & 0xC0) != 0x80)
        {
            return 0;
        }
        cp = (cp << 6) | (next & 0x3Fu);
    }
    if ((length == 2 && cp < 0x80) || (length == 3 && cp < 0x800) || (length == 4 && cp < 0x10000) || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF))
    {
        return 0;
    }
    aCp = cp;
    return length;
}

// Walks the text and hands each code point to aPut (control characters as a space, invalid bytes as 0xFFFFFFFF).
template<typename Put>
std::string Remap(const std::string& aText, Put aPut)
{
    std::string out;
    out.reserve(aText.size());
    size_t i = 0;
    while (i < aText.size())
    {
        uint32_t cp = 0;
        const size_t length = NextCodePoint(aText, i, cp);
        if (length == 0)
        {
            aPut(out, 0xFFFFFFFFu, std::string());
            i += 1;
            continue;
        }
        const std::string raw = aText.substr(i, length);
        i += length;
        if (cp < 0x20 || cp == 0x7F || (cp >= 0x80 && cp < 0xA0))
        {
            out.push_back(' ');
            continue;
        }
        aPut(out, cp, raw);
    }
    return out;
}

// 0.8.2: the ink font's glyphs (core/InkUi.hpp InkHas): the code points all four raj styles map, read from the game's .fnt
// resources' cmap tables (2.31). The 0.8 keep-list assumed whole blocks and held 113 code points the fonts lack (U+00A4,
// å, æ, ÿ, ő's neighbours, most of General Punctuation), each drawn as a blank gap.
constexpr std::pair<uint32_t, uint32_t> kInkGlyphs[] = {
    {0x0020, 0x007E}, {0x00A0, 0x00A3}, {0x00A5, 0x00A9}, {0x00AB, 0x00AB}, {0x00AE, 0x00B1}, {0x00B4, 0x00B4}, {0x00B6, 0x00B8},
    {0x00BB, 0x00BB}, {0x00BF, 0x00C4}, {0x00C6, 0x00CF}, {0x00D1, 0x00DD}, {0x00DF, 0x00E4}, {0x00E7, 0x00EF}, {0x00F1, 0x00F6},
    {0x00F8, 0x00FD}, {0x0100, 0x0107}, {0x010C, 0x010F}, {0x0112, 0x0113}, {0x0118, 0x011B}, {0x011E, 0x011F}, {0x012A, 0x012B},
    {0x0130, 0x0131}, {0x0141, 0x0144}, {0x0147, 0x0148}, {0x014C, 0x0153}, {0x0158, 0x015B}, {0x015E, 0x0161}, {0x0164, 0x0165},
    {0x016A, 0x016B}, {0x016E, 0x0171}, {0x0179, 0x017E}, {0x039C, 0x039C}, {0x03A3, 0x03A3}, {0x200B, 0x200B}, {0x2011, 0x2011},
    {0x2013, 0x2014}, {0x2018, 0x201A}, {0x201C, 0x201E}, {0x2022, 0x2022}, {0x2026, 0x2026}, {0x20AC, 0x20AC}, {0x2122, 0x2122},
    {0x2206, 0x2206}, {0x2212, 0x2212}, {0x2264, 0x2264},
};

// A Latin-1 character the ink font lacks, in plain letters (Latin Extended-A uses kLatinExtendedA, punctuation CetPunctuation).
const char* InkLatin1(uint32_t aCp)
{
    switch (aCp)
    {
    case 0xAA:
        return "a";
    case 0xAC:
        return "-";
    case 0xAD:
        return ""; // a soft hyphen draws nothing
    case 0xB2:
        return "2";
    case 0xB3:
        return "3";
    case 0xB5:
        return "u";
    case 0xB9:
        return "1";
    case 0xBA:
        return "o";
    case 0xBC:
        return "1/4";
    case 0xBD:
        return "1/2";
    case 0xBE:
        return "3/4";
    case 0xC5:
        return "A";
    case 0xD0:
        return "D";
    case 0xDE:
        return "Th";
    case 0xE5:
        return "a";
    case 0xE6:
        return "ae";
    case 0xF0:
        return "d";
    case 0xF7:
        return "/";
    case 0xFE:
        return "th";
    case 0xFF:
        return "y";
    default:
        return nullptr;
    }
}
}

bool InkHas(uint32_t aCp)
{
    for (const auto& [first, last] : kInkGlyphs)
    {
        if (aCp >= first && aCp <= last)
        {
            return true;
        }
    }
    return false;
}

namespace
{

// Latin Extended-A (U+0100 to U+017F) in Basic Latin or Latin-1 letters, one entry per code point.
const char* const kLatinExtendedA[128] = {
    "A", "a", "A", "a", "A", "a", "C", "c", "C", "c", "C", "c", "C", "c", "D", "d", //
    "D", "d", "E", "e", "E", "e", "E", "e", "E", "e", "E", "e", "G", "g", "G", "g", //
    "G", "g", "G", "g", "H", "h", "H", "h", "I", "i", "I", "i", "I", "i", "I", "i", //
    "I", "i", "IJ", "ij", "J", "j", "K", "k", "k", "L", "l", "L", "l", "L", "l", "L", //
    "l", "L", "l", "N", "n", "N", "n", "N", "n", "n", "N", "n", "O", "o", "O", "o", //
    "\xC3\x96", "\xC3\xB6", "OE", "oe", "R", "r", "R", "r", "R", "r", "S", "s", "S", "s", "S", "s", //
    "S", "s", "T", "t", "T", "t", "T", "t", "U", "u", "U", "u", "U", "u", "U", "u", //
    "\xC3\x9C", "\xC3\xBC", "U", "u", "W", "w", "Y", "y", "Y", "Z", "z", "Z", "z", "Z", "z", "s", //
};

const char* CetPunctuation(uint32_t aCp)
{
    switch (aCp)
    {
    case 0x2010:
    case 0x2011:
    case 0x2012:
    case 0x2013:
    case 0x2014:
    case 0x2015:
        return "-";
    case 0x2018:
    case 0x2019:
    case 0x201A:
    case 0x201B:
    case 0x2032:
        return "'";
    case 0x201C:
    case 0x201D:
    case 0x201E:
    case 0x201F:
    case 0x2033:
        return "\"";
    case 0x2022:
        return "\xC2\xB7";
    case 0x2026:
        return "...";
    case 0x2039:
        return "<";
    case 0x203A:
        return ">";
    case 0x20AC:
        return "EUR";
    case 0x2122:
        return "TM";
    case 0x0218:
        return "S";
    case 0x0219:
        return "s";
    case 0x021A:
        return "T";
    case 0x021B:
        return "t";
    default:
        return nullptr;
    }
}
} // namespace

std::string ForInk(const std::string& aText)
{
    // 0.8.2: what the font lacks becomes its plain form where it has one (each piece of which the font has), else the ink mark.
    auto out = Remap(aText, [](std::string& aOut, uint32_t aCp, const std::string& aRaw) {
        if (InkHas(aCp))
        {
            aOut += aRaw;
            return;
        }
        const char* plain = aCp == 0xC5 || aCp == 0xE5 || (aCp >= 0xA0 && aCp <= 0xFF) ? InkLatin1(aCp)
                            : aCp >= 0x100 && aCp <= 0x17F                             ? kLatinExtendedA[aCp - 0x100]
                                                                                       : CetPunctuation(aCp);
        if (plain && aCp == 0x2022)
        {
            plain = nullptr; // CET's plain form of the bullet is a middle dot; the ink font has the bullet itself
        }
        aOut += plain ? std::string(plain) : std::string(kInkReplacementMark);
    });
    return out;
}

std::string ForCet(const std::string& aText)
{
    return Remap(aText, [](std::string& aOut, uint32_t aCp, const std::string& aRaw) {
        if (aCp <= 0xFF)
        {
            aOut += aRaw;
        }
        else if (aCp >= 0x100 && aCp <= 0x17F)
        {
            aOut += kLatinExtendedA[aCp - 0x100];
        }
        else if (const char* ascii = CetPunctuation(aCp))
        {
            aOut += ascii;
        }
        else
        {
            aOut += kReplacementMark;
        }
    });
}

std::string KeyLabel(const std::string& aKey)
{
    return aKey.rfind("IK_", 0) == 0 ? aKey.substr(3) : aKey;
}

std::string KeyPrompt(const std::string& aKey, const std::string& aLabel)
{
    return "[" + KeyLabel(aKey) + "] " + aLabel;
}

bool InkEventKindOk(const std::string& aKind)
{
    return aKind == "ink_tree" || aKind == "ink_pointer" || aKind == "ink_input";
}

json InkEventData(const std::string& aText)
{
    if (aText.empty())
    {
        return nullptr;
    }
    auto parsed = json::parse(aText, nullptr, false);
    if (parsed.is_object())
    {
        return parsed;
    }
    return json{{"raw", CleanMessageText(aText, 200)}};
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

std::string Frame(const HudSettings& aSettings, const BridgeView& aView, const std::vector<MessageLine>& aMessages, const AskView* aAsk,
                  StatusSurface aSurface)
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
    out += "status\t" + CleanField(ForInk(status.text)) + "\n";
    out += std::string("surface\t") + SurfaceName(aSurface) + "\n";
    // 0.8.6: ui.hud's modal for the photo-menu panel (0.8.7: it holds photo mode's exit), never while stopped.
    out += std::string("modal\t") + (aSettings.modal && !aView.killed && aView.pluginEnabled ? "1" : "0") + "\n";
    if (!aView.killed)
    {
        for (const auto& message : aMessages)
        {
            out += "msg\t" + CleanField(message.level) + "\t" + CleanField(ForInk(message.text)) + "\n";
        }
        if (aAsk && aAsk->id != 0 && !aAsk->keyed.empty())
        {
            out += "ask\t" + std::to_string(aAsk->id);
            for (const auto& [key, label] : aAsk->keyed)
            {
                out += "\t" + CleanField(key) + "\t" + CleanField(ForInk(label));
            }
            out += "\n";
        }
        else if (aAsk && aAsk->answeredId != 0)
        {
            out += "answered\t" + std::to_string(aAsk->answeredId) + "\t" + CleanField(ForInk(aAsk->answeredLabel)) + "\n";
        }
        if (aAsk && aAsk->id != 0 && !aAsk->keyed.empty())
        {
            out += std::string("keys\t") + (aAsk->keysArmed ? "1" : "0") + "\n";
        }
        if (aAsk && aAsk->inkShown != 0)
        {
            out += "inkask\t" + std::to_string(aAsk->inkShown) + "\n";
        }
        if (aAsk)
        {
            out += "clears\t" + std::to_string(aAsk->clears) + "\n";
        }
    }
    return out;
}

std::string AnswerHint(const std::vector<std::string>& aChoices, const std::vector<std::string>& aAnswerKeys, bool aKeysArmed)
{
    std::string hint;
    for (size_t i = 0; aKeysArmed && i < aChoices.size() && i < aAnswerKeys.size(); ++i)
    {
        hint += (hint.empty() ? "" : "   ") + KeyPrompt(aAnswerKeys[i], aChoices[i]);
    }
    return hint.empty() ? "Answer in the XF Runtime Bridge window (open the CET overlay)." : hint;
}

std::string BuildFrame(const HudSettings& aSettings, const BridgeView& aView, MessageBoard& aBoard, const std::vector<std::string>& aAnswerKeys,
                       uint64_t aInkShownAsk, StatusSurface aSurface, uint64_t aKeysAsk)
{
    std::vector<MessageLine> lines;
    AskView ask;
    if (!aView.killed)
    {
        for (auto& [level, text] : aBoard.Lines())
        {
            lines.push_back({level, text});
        }
        ask.clears = aBoard.Clears();
        PendingAsk pending;
        if (aBoard.Pending(pending))
        {
            ask.id = pending.id;
            // 0.8.6 (the Sol review): every choice, with its key where [ui] answer_keys gives one, kNoKey where it doesn't, so a
            // panel that can be clicked shows them all whatever the keys.
            for (size_t i = 0; i < pending.choices.size(); ++i)
            {
                ask.keyed.emplace_back(i < aAnswerKeys.size() ? aAnswerKeys[i] : std::string(kNoKey), pending.choices[i]);
            }
            ask.inkShown = aInkShownAsk == pending.id ? aInkShownAsk : 0;
            ask.keysArmed = aKeysAsk == pending.id;
        }
        else
        {
            AnsweredAsk answered;
            if (aBoard.Answered(answered))
            {
                ask.answeredId = answered.id;
                ask.answeredLabel = answered.label;
                ask.inkShown = aInkShownAsk == answered.id ? aInkShownAsk : 0;
            }
        }
    }
    return Frame(aSettings, aView, lines, &ask, aSurface);
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
        else if (key == "answered" && fields.size() >= 3)
        {
            out["answered"] = {{"id", std::stoull(fields[1])}, {"label", fields[2]}};
        }
        else if (key == "clears" && fields.size() >= 2)
        {
            out["clears"] = std::stoull(fields[1]);
        }
        else if (key == "inkask" && fields.size() >= 2)
        {
            out["ink_shows"] = std::stoull(fields[1]);
        }
        else if (key == "ask" && fields.size() >= 4)
        {
            json choices = json::array();
            for (size_t i = 2; i + 1 < fields.size(); i += 2)
            {
                choices.push_back({{"key", fields[i]}, {"label", fields[i + 1]}});
            }
            out["ask"] = {{"id", std::stoull(fields[1])}, {"choices", choices}};
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
        else if ((key == "show" || key == "nameplates" || key == "cet_label" || key == "live" || key == "modal") && fields.size() >= 2)
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

void HudPanel::DropModal()
{
    std::scoped_lock _(m_mutex);
    m_current.modal = false;
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
        request.lift = kPieceLift; // 0.8.4: at the crown; the game draws its marker above the point (session 11's G4)
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
