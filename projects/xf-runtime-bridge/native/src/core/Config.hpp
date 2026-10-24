#pragma once

// Plugin configuration, read once at load from config.ini beside the DLL.
// Missing file or keys fall back to the safe defaults below (bridge off, writes off).

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

#include "core/KillKey.hpp"
#include "core/Log.hpp"

namespace xfb
{
// Write classes for [bridge] allow_write_classes (photo, world, character, inventory, save, showroom). The default
// (no allow_write_classes key) is the first three: inventory, save and showroom must be listed by name.
inline constexpr uint32_t kWritePhoto = 1;
inline constexpr uint32_t kWriteWorld = 2;
inline constexpr uint32_t kWriteCharacter = 4;
inline constexpr uint32_t kWriteInventory = 8; // V's clothing and inventory; only with the maintainer's approval
inline constexpr uint32_t kWriteSave = 16;     // manual saves and loading
inline constexpr uint32_t kWriteShowroom = 32; // XF Finish Showroom props and light rigs (showroom.*); the test profile only
inline constexpr uint32_t kWritePlayer = 64;   // 0.6: reversible player changes (player.*, behaviours that move V); "player"
inline constexpr uint32_t kActPlayer = 128;    // 0.6: irreversible actions in the world (devices, dialogue, consuming); "act"
inline constexpr uint32_t kWriteNpc = 256;     // 0.8: NPC direction (npc.*: XF actors, commands, lines, gestures, choices); "npc", test profile only
inline constexpr uint32_t kWriteDm = 512;      // 0.8.12: the live-direction toolkit (props, vehicles, doors, sounds, phone, tracker, lights, watchers); "dm", test profile only

// 0.8.5: the game's own new-message sound (MessengerDialogViewController plays it through AudioSystem.Play when a message
// arrives in an open conversation; 2.31 scripts).
inline constexpr const char* kQuestionSoundDefault = "ui_messenger_recieved";

struct Config
{
    // [bridge]
    bool bridgeEnabled = false;      // no pipe, no session file unless true
    bool allowWrites = false;        // write-class methods refused unless true
    uint32_t writeClasses = kWritePhoto | kWriteWorld | kWriteCharacter; // allow_write_classes, after allow_writes
    bool allowCreatorLeave = false;  // cc.open / cc.confirm / cc.back refused unless true (only the -writes package sets it)
    bool allowLivePose = false;      // pose.live.apply refused unless true (only the -writes package sets it)
    bool allowTestHooks = false;     // 0.8.4: test.save.delay refused unless true (only the -writes package sets it)
    uint32_t requestTimeoutMs = 2000; // wait for the game thread
    uint32_t maxRequestsPerSecond = 20;
    uint32_t idleDisconnectSeconds = 120;

    // [ui] (bridge 0.5.3, temporary test features): the ink HUD panel (Demo A) shown at start, the CET layer's CET line and
    // message lines, and the showroom's pedestal nameplates (Demo B). ui.hud changes each while the game runs.
    bool hudPanel = true;
    // 0.8.6: where the ink panel draws ([ui] layer): photo_menu (default: the HUD layer in play, inside photo mode's menu while
    // photo mode is open), hud (the HUD layer only; the XF box in photo mode), notifications or top (research).
    std::string hudLayer = "photo_menu";
    bool cetLabel = true;
    bool nameplates = true;
    // 0.7 (session 7, in-game driving): the keys that answer an ask's choices in the ink panel, in order (EInputKey names;
    // the 2.31 defaults bind F1, F3, F4, F5 and F9 but not F6, F7, F8 or F11; F10 is kept for the overlay's interact key).
    // 0.8 (the UI review asked for F9 in place of F11 if it is free): F9 is the game's quick load in 2.31
    // (r6/config/inputUserMappings.xml, overridableUI quickLoad), so F11 stays.
    std::vector<std::string> answerKeys{"IK_F6", "IK_F7", "IK_F8", "IK_F11"};
    // 0.8.3: the bridge's own kill key (core/KillKey.hpp; default End, "off" for none), read by the plugin itself without CET.
    killkey::Chord killKey;
    // 0.8.5: a soft sound when a new question appears ([ui] question_sound: true, false, or the name of a game sound event),
    // played once per question through the game's audio system (XFBridgeSound.Question). true is the messenger's own
    // new-message sound; empty is off.
    std::string questionSound = kQuestionSoundDefault;

    // [overlay] (0.7, the ImGui overlay host P0: research/runtime/imgui-overlay-feasibility.md §8): off by default; draw-only
    // (a diagnostic panel); refuses in HDR. theme: dark (default) or light, chosen by hand, never switched automatically.
    bool overlayEnabled = false;
    std::string overlayTheme = "dark";
    uint32_t overlayScalePercent = 100; // 50-300, on top of the back buffer's height / 1080
    // 0.8 (the UI review): the XF box's diagnostic lines (frames, CPU time, the back buffer, frame-generation modules,
    // the script gate, requests and the moving bar) only when asked for; the -diagnostic package turns them on.
    bool overlayDiagnostics = false;

    // [log]
    Level logLevel = Level::Debug; // baseline is verbose by design; bounded by RED4ext rotation

    // [capture]
    std::filesystem::path captureRoot; // empty = <runtime dir>/captures

    // Where the values came from, for the load log.
    std::filesystem::path sourcePath;
    bool fileFound = false;
    std::vector<std::string> warnings;
};

// Parses a tiny INI subset: [section], key = value, ';' or '#' comments.
Config ParseConfig(const std::string& aText);
Config LoadConfig(const std::filesystem::path& aPath);
std::string DescribeConfig(const Config& aConfig);
// ["photo", "world", "character", "inventory", "save", "showroom"]: the classes aConfig allows.
std::vector<std::string> WriteClassList(const Config& aConfig);
} // namespace xfb
