#pragma once

// 0.8.3: the bridge's own kill key ([ui] kill_key). CET drops a mod's bindings at any launch without the mod (session 9), so
// the CET hotkey alone can't be relied on; the maintainer's standing rule is to make the integration self-contained. The
// plugin reads the key itself on the game thread, once a tick, from the keyboard's state (GetAsyncKeyState), and only while
// the game's own window is in front and CET's overlay is closed (the XF Runtime Bridge window has its Stop button there,
// and typing in a CET text box must never stop the bridge). That works in normal play, photo mode, menus and loading
// screens alike, without CET, Codeware or an input binding, and it only reads the keyboard: nothing is sent anywhere.
// The CET hotkey stays an optional second route.
//
// Game-independent: the plugin polls it, the self-test checks the parsing and the press detection.

#include <functional>
#include <string>
#include <vector>

namespace xfb::killkey
{
// The default (0.8.4, the maintainer: "'End' is something that other mods (or even the game) could easily compete for"):
// Ctrl + Shift + End. End is unbound in the game's 2.31 defaults (r6/config/inputUserMappings.xml binds no End, Pause,
// Scroll Lock, Insert, Delete, Page Up or Page Down, nor F2, F6-F8 or F10-F12; inputContexts.xml names no key of its own,
// only mappings), the chord is far less likely to be another mod's hotkey than a bare key, and it isn't one of the ink
// panel's answer keys (F6, F7, F8, F11). Ctrl and Shift are game keys on their own (dodge and crouch, sprint), which only
// matters while V moves. Ctrl + Alt + End is avoided: remote-desktop clients send it as Ctrl + Alt + Delete.
inline constexpr const char* kDefault = "Ctrl + Shift + End";

struct Chord
{
    bool enabled = true;
    bool ctrl = true;
    bool shift = true;
    bool alt = false;
    int vk = 0x23; // a Windows virtual-key code (VK_END)
    std::string label = kDefault; // as the XF Runtime Bridge window shows it ("Ctrl + Shift + End")
};

// "End", "Ctrl+End", "ctrl + shift + F12", "IK_End" (the game's own key names work too), or "off" / "none" for no key.
// Modifiers: Ctrl, Shift, Alt. Keys: End, Home, Insert, Delete, PageUp, PageDown, Pause, ScrollLock, F1-F12, A-Z, 0-9,
// Numpad0-Numpad9, NumpadMultiply (Numpad*), NumpadDivide (Numpad/), NumpadMinus (Numpad-), NumpadPlus (Numpad+),
// NumpadDecimal (Numpad.). False, with a plain reason, for anything else (the default then stays).
bool Parse(const std::string& aText, Chord& aOut, std::string& aError);
// Whether the game's 2.31 default key bindings use this key (r6/config/inputUserMappings.xml: letters, digits, F1, F3, F4,
// F5, F9 and Home), for the load log's warning: such a key also does its game action when it stops the bridge.
bool GameBinds(int aVk);

// 0.8.4: how config.ini spells a chord ("Ctrl+Shift+End", "off"); Parse reads it back to the same chord.
std::string Spelling(const Chord& aChord);

// 0.8.4: config.ini's text with [ui] kill_key set to aValue: the existing line replaced in place (everything else kept, the
// file's line endings too), or added at the end of [ui], or a [ui] section added at the end when there is none.
std::string WithKillKey(const std::string& aIni, const std::string& aValue);

// 0.8.4: what else may react to the chord, in plain words, from the files the game and CET read (only read; any may be
// empty): the game's own bindings (r6/config/inputUserMappings.xml, and Input Loader's r6/input/*.xml, which the game merges
// in) and CET's hotkeys (bin/x64/plugins/cyber_engine_tweaks/bindings.json; the bridge's own entry is skipped). warnings:
// the chord's key is bound by the game, or a CET hotkey uses the same keys (or a part of them that includes the key).
// notes: modifiers the game uses on their own. Other mods that read the keyboard directly can't be seen in any file.
struct Conflicts
{
    std::vector<std::string> warnings;
    std::vector<std::string> notes;
};
Conflicts FindConflicts(const Chord& aChord, const std::vector<std::pair<std::string, std::string>>& aMappingFiles, const std::string& aCetBindingsJson);
inline constexpr const char* kUnseenNote =
    "Other mods that read the keyboard directly can't be seen from here; if the key does something else in your game, choose another.";

// The press detection: Poll answers true once when the chord goes down (its key and every modifier it names) while the watch
// is armed, never again until the key has been let go. Extra modifiers held don't stop it. 0.8.3 (the review: a focus change
// made a press): while not armed (the game's window not in front, CET's overlay open, the bridge stopped) the keyboard isn't
// read, and once armed again a press counts only after the chord has been seen released, so holding the key elsewhere and
// coming back fires nothing. aStillArmed is asked right before answering true (the plugin checks the window and CET's overlay
// again); a press it refuses is used up, as if it had fired.
class Watch
{
public:
    bool Poll(const Chord& aChord, bool aArmed, const std::function<bool(int)>& aIsDown, const std::function<bool()>& aStillArmed = {});

private:
    bool m_wasDown = false;
    bool m_needRelease = true;
};
} // namespace xfb::killkey
