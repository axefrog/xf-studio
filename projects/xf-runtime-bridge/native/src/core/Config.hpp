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
// Write classes for [bridge] allow_write_classes (photo, world, character).
inline constexpr uint32_t kWritePhoto = 1;
inline constexpr uint32_t kWriteWorld = 2;
inline constexpr uint32_t kWriteCharacter = 4;

struct Config
{
    // [bridge]
    bool bridgeEnabled = false;      // no pipe, no session file unless true
    bool allowWrites = false;        // write-class methods refused unless true
    uint32_t writeClasses = kWritePhoto | kWriteWorld | kWriteCharacter; // allow_write_classes, after allow_writes
    bool allowCreatorLeave = false;  // cc.confirm / cc.back refused unless true (pending a maintainer decision)
    uint32_t requestTimeoutMs = 2000; // wait for the game thread
    uint32_t maxRequestsPerSecond = 20;
    uint32_t idleDisconnectSeconds = 120;

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
// ["photo", "world", "character"] for the classes aConfig allows.
std::vector<std::string> WriteClassList(const Config& aConfig);
} // namespace xfb
