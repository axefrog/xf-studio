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

// 0.8.4: replaces an existing settings file safely: the old file copied to aBackup first (refused if that fails), the new
// content written and flushed to a temporary sibling, moved over the original (MOVEFILE_REPLACE_EXISTING |
// MOVEFILE_WRITE_THROUGH), then read back and compared. On any failure before the move the original is untouched; a
// read-back that differs is reported (the backup still holds the old file). Works the same through MO2's virtual file
// system, which hooks these calls [hypothesis: checked in game by session 12's K5].
bool ReplaceSettingsFile(const std::filesystem::path& aPath, std::string_view aContent, const std::filesystem::path& aBackup, std::string& aError);

// 0.8.3: a file's SHA-256 as lowercase hex (BCrypt), read in 1 MB pieces; files over aMaxBytes are refused.
// aCancelled (0.8.3, the review) is asked before each megabyte; answering true stops the hash ("cancelled"), and it may
// also throw, which is passed on after the handles are closed.
bool FileSha256(const std::filesystem::path& aPath, std::string& aHex, std::string& aError, uint64_t aMaxBytes = 512ull * 1024 * 1024,
                const std::function<bool()>& aCancelled = {});

std::string LastErrorText(uint32_t aError);
std::string UtcNowIso8601();
uint64_t MonotonicMs();
} // namespace xfb::win32
