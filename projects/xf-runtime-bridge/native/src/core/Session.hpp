#pragma once

// One bridge session per game process: identity, secret and discovery file.
//
// Discovery: <runtime dir>/session.json (in game always %LOCALAPPDATA%\XFStudio\runtime-bridge)
// holds the pipe name and the per-session token. The folder is in the user's profile, so its
// default ACL limits it to the user (plus SYSTEM and administrators); the token never appears
// in any log. The security boundary is the Windows user: any process running as that user at
// medium integrity can read the token, just as it could read or change the game's memory.
// Kill switch: the file <runtime dir>/KILL stops the bridge while present.

#include <cstdint>
#include <filesystem>
#include <string>

namespace xfb
{
inline constexpr int kProtocolVersion = 1;

struct Session
{
    std::string sessionId;  // 16 hex chars; logged everywhere as sid=
    std::string token;      // 64 hex chars; secret, never logged
    std::wstring pipeName;  // \\.\pipe\xf-runtime-bridge-<pid>-<random>
    std::string startedAt;  // UTC ISO 8601
    uint32_t processId = 0;
    std::filesystem::path runtimeDir;

    std::filesystem::path SessionFile() const;
    std::filesystem::path KillFile() const;
};

// aRuntimeDirOverride is for the offline self-test only. The plugin never passes it, and no
// environment variable changes the folder, so in game it is always the LOCALAPPDATA one.
bool CreateSession(Session& aOut, std::string& aError, const std::filesystem::path& aRuntimeDirOverride = {});
bool KillFilePresent(const Session& aSession);
} // namespace xfb
