#pragma once

// Plugin configuration, read once at load from config.ini beside the DLL.
// Missing file or keys fall back to the safe defaults below (bridge off, writes off).

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

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

struct Config
{
    // [bridge]
    bool bridgeEnabled = false;      // no pipe, no session file unless true
    bool allowWrites = false;        // write-class methods refused unless true
    uint32_t writeClasses = kWritePhoto | kWriteWorld | kWriteCharacter; // allow_write_classes, after allow_writes
    bool allowCreatorLeave = false;  // cc.open / cc.confirm / cc.back refused unless true (only the -writes package sets it)
    bool allowLivePose = false;      // pose.live.apply refused unless true (only the -writes package sets it)
    uint32_t requestTimeoutMs = 2000; // wait for the game thread
    uint32_t maxRequestsPerSecond = 20;
    uint32_t idleDisconnectSeconds = 120;

    // [ui] (bridge 0.5.3, temporary test features): the ink HUD panel (Demo A) shown at start, the CET layer's status label and
    // message lines, and the showroom's pedestal nameplates (Demo B). ui.hud changes each while the game runs.
    bool hudPanel = true;
    bool cetLabel = true;
    bool nameplates = true;

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
