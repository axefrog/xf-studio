#pragma once

// Small Win32 helpers shared by the plugin and the self-test. No game headers here.

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>

namespace xfb::win32
{
std::string Narrow(std::wstring_view aText);
std::wstring Widen(std::string_view aText);

// Cryptographically random bytes as lowercase hex (BCryptGenRandom, system RNG).
bool RandomHex(size_t aBytes, std::string& aOut);

// String SID of the user running this process, e.g. "S-1-5-21-...".
bool CurrentUserSid(std::string& aOut);

// Folder that holds this module (the plugin DLL or the self-test exe).
std::filesystem::path ModuleDirectory(const void* aAddressInModule);

// Four-part file version from a PE version resource, e.g. "3.0.80.51928".
bool FileVersion(const std::filesystem::path& aPath, std::string& aOut);
std::filesystem::path ProcessImagePath();

// %LOCALAPPDATA%\XFStudio\runtime-bridge. There is deliberately no environment override: only
// the self-test uses another folder, passed explicitly to CreateSession.
std::filesystem::path RuntimeDirectory();

// Writes a file via a temporary sibling and an atomic replace.
bool WriteFileAtomic(const std::filesystem::path& aPath, std::string_view aContent, std::string& aError);

// 0.8.4 (the review: the kill key's save truncated config.ini first, and a read failure became empty content): the whole file,
// or false with aMissing true when it doesn't exist and false on any other failure (the caller must then write nothing).
bool ReadFileExact(const std::filesystem::path& aPath, std::string& aOut, bool& aMissing, std::string& aError, uint64_t aMaxBytes = 4u * 1024 * 1024);

// 0.8.5 (session 12's K5: config.ini.bak landed in MO2's overwrite folder, which every profile shares, because MO2's virtual
// file system puts new files under the game's folder there): replaces an existing settings file safely without leaving a new
// file beside it. The old file is copied first into aWorkDir (the bridge's runtime folder, outside the game's folder) as
// "<name>.<UTC time>.bak", refused if that fails, keeping the newest aKeepBackups such copies of that name. The new content
// is written and flushed to "<name>.tmp" in aWorkDir and moved over the original (MOVEFILE_REPLACE_EXISTING |
// MOVEFILE_WRITE_THROUGH), an atomic rename when both are on one volume. Across volumes Windows can only copy, which isn't
// atomic, so then the temporary file is written beside the original instead and moved over it (under MO2 it passes through
// the overwrite folder and the move takes it out again: session 12's K5 left no .tmp there); aDone.tempBeside says so.
// Then the file is read back and compared. On any failure before the move the original is untouched; a read-back that
// differs is reported (the backup still holds the old file).
struct SettingsReplace
{
    std::filesystem::path backup; // the copy of the old file
    bool tempBeside = false;      // the temporary file was written beside the original (another volume)
};
bool ReplaceSettingsFile(const std::filesystem::path& aPath, std::string_view aContent, const std::filesystem::path& aWorkDir, size_t aKeepBackups,
                         SettingsReplace& aDone, std::string& aError);

// 0.8.3: a file's SHA-256 as lowercase hex (BCrypt), read in 1 MB pieces; files over aMaxBytes are refused.
// aCancelled (0.8.3, the review) is asked before each megabyte; answering true stops the hash ("cancelled"), and it may
// also throw, which is passed on after the handles are closed.
bool FileSha256(const std::filesystem::path& aPath, std::string& aHex, std::string& aError, uint64_t aMaxBytes = 512ull * 1024 * 1024,
                const std::function<bool()>& aCancelled = {});

std::string LastErrorText(uint32_t aError);
std::string UtcNowIso8601();
uint64_t MonotonicMs();
} // namespace xfb::win32
